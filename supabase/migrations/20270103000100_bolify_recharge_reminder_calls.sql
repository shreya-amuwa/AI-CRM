-- =============================================================================================================================
-- BolifyAI panel recharge reminder calls: 7, 5 and 1 day before the expiry date (was 7, 3 and 1).
--
-- Extends the reminder engine of 20261112000100_subscription_reminders.sql (no second queue, no new customer or subscription table):
--   * The expiry / recharge date is still customer_services.renews_on of a LIVE service. For a subscription it is the date calculated from the
--     confirmed activation date (and moved forward by a renewal, 20261210000200); never an invoice, payment or Google Sheet date.
--   * One row per customer + service + expiry date + stage under the UNIQUE event_key (unchanged): running the daily job twice, or from two
--     servers at once, creates nothing twice, so a customer cannot get two calls for the same reminder.
--   * New: the CALL stages are 7, 5 and 1. Existing 3-day rows stay as history (the stage check keeps 3).
--   * New: what BolifyAI answered (sanitized: HTTP status, success, message without long numbers, call id) is kept on the reminder.
--   * New: a renewal, a changed expiry date or a service that is no longer live withdraws the pending reminders AT ONCE (trigger), not only at the
--     next run. The new expiry date gets its own reminders on the next daily run. History is never deleted.
--   * New: sub_reminder_call_result() records a call's result (answered, not answered, busy, failed, duration) by the provider's call id.
--     COMPLETED is set only from such a result, never because a request was sent.
--   * New: sub_reminder_calls() lists the reminder calls for the Super Admin and HR staff (filters: 7 / 5 / 1 day, pending, submitted, failed,
--     completed), paginated in the database.
-- Safe to run twice; paste as one script in the Supabase SQL editor.
-- =============================================================================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns and checks
-- ---------------------------------------------------------------------------
alter table public.subscription_reminders drop constraint if exists subscription_reminders_stage_check;
alter table public.subscription_reminders add constraint subscription_reminders_stage_check check (stage in (15, 7, 5, 3, 1, 0));

alter table public.subscription_reminders add column if not exists provider_response jsonb;          -- sanitized reply of BolifyAI (no key, no full number)
alter table public.subscription_reminders add column if not exists call_outcome text;                -- from the call result: COMPLETED, NOT_ANSWERED, BUSY, FAILED
alter table public.subscription_reminders add column if not exists call_duration_seconds integer;
alter table public.subscription_reminders add column if not exists call_result_at timestamptz;
alter table public.subscription_reminders drop constraint if exists subscription_reminders_call_outcome_check;
alter table public.subscription_reminders add constraint subscription_reminders_call_outcome_check
  check (call_outcome is null or call_outcome in ('COMPLETED', 'NOT_ANSWERED', 'BUSY', 'FAILED'));
alter table public.subscription_reminders drop constraint if exists subscription_reminders_call_duration_check;
alter table public.subscription_reminders add constraint subscription_reminders_call_duration_check
  check (call_duration_seconds is null or call_duration_seconds between 0 and 86400);

alter table public.subscription_reminder_events drop constraint if exists subscription_reminder_events_event_check;
alter table public.subscription_reminder_events add constraint subscription_reminder_events_event_check
  check (event in ('CREATED', 'ATTEMPT', 'DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED', 'CANCELLED', 'RESULT'));

-- the monitoring list reads the calls newest first
create index if not exists subscription_reminders_channel_send_idx on public.subscription_reminders (channel, send_after desc);

-- ---------------------------------------------------------------------------
-- 2. The daily decider: calls at 7, 5 and 1 day(s); e-mail and WhatsApp unchanged (15, 7, 3, 1, 0)
-- ---------------------------------------------------------------------------
drop function if exists public.sub_reminder_schedule(date, text[]);
create or replace function public.sub_reminder_schedule(p_today date default null, p_channels text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.office_today());
  s public.reminder_call_settings;
  v_new integer := 0;
  v_cancelled integer := 0;
  v_ids uuid[];
  v_msg_ids uuid[];
begin
  select * into s from public.reminder_call_settings where id;

  -- AI calls (BolifyAI): exactly 7, 5 and 1 day(s) before the expiry date, as Asia/Kolkata calendar days.
  with ins as (
    insert into public.subscription_reminders (event_key, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
     where cs.renews_on - v_today in (7, 5, 1)
       and (p_channels is null or 'CALL' = any (p_channels))
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  v_new := cardinality(v_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_ids) x;

  -- E-mail and WhatsApp: 15, 7, 3 and 1 day before the expiry date and on it (unchanged).
  with ins as (
    insert into public.subscription_reminders (event_key, channel, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || ch.channel || '|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           ch.channel, cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
      cross join (select 'EMAIL' as channel where s.email_enabled union all select 'WHATSAPP' where s.whatsapp_enabled) ch
     where cs.renews_on - v_today in (15, 7, 3, 1, 0)
       and (p_channels is null or ch.channel = any (p_channels))
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_msg_ids from ins;
  v_new := v_new + cardinality(v_msg_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_msg_ids) x;

  with gone as (
    update public.subscription_reminders sr
       set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = now()
     where sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN')
       and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null
    returning sr.id, sr.reason)
  select count(*)::int into v_cancelled from (select private.sub_reminder_log(id, 'CANCELLED', null, null, reason) from gone) g;

  insert into public.subscription_reminder_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'created', v_new, 'cancelled', v_cancelled), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'created', v_new, 'cancelled', v_cancelled);
end $$;
revoke all on function public.sub_reminder_schedule(date, text[]) from public, anon, authenticated;
grant execute on function public.sub_reminder_schedule(date, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A renewal or a changed expiry date withdraws the old pending reminders at once
-- ---------------------------------------------------------------------------
-- Only reminders that have not been sent (SCHEDULED, RETRY, DRY_RUN) are withdrawn, with the reason and an event; sent, failed and completed ones
-- stay as they are (history). The reminders for the new date are created by the next daily run.
create or replace function private.sub_reminder_service_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if new.renews_on is distinct from old.renews_on or new.service_status is distinct from old.service_status or new.activated_at is distinct from old.activated_at then
    with gone as (
      update public.subscription_reminders sr
         set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = now()
       where sr.customer_id = new.customer_id and sr.service_code = new.service_code
         and sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN')
         and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null
      returning sr.id, sr.reason)
    select count(*)::int into v_n from (select private.sub_reminder_log(id, 'CANCELLED', null, null, reason) from gone) g;
  end if;
  return null;
end $$;
revoke all on function private.sub_reminder_service_changed() from public, anon, authenticated;

drop trigger if exists customer_services_withdraw_reminders on public.customer_services;
create trigger customer_services_withdraw_reminders after update on public.customer_services
  for each row execute function private.sub_reminder_service_changed();

-- ---------------------------------------------------------------------------
-- 4. Recording a call attempt, now with the provider's (sanitized) answer
-- ---------------------------------------------------------------------------
-- p_response keeps only: httpStatus, success, message (300 characters, runs of 6+ digits hidden) and callId. Anything else is dropped, so a key
-- or a full phone number echoed by the provider is never stored. Callers that do not send p_response work as before.
create or replace function private.sub_reminder_clean_response(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p is null or jsonb_typeof(p) <> 'object' then null else jsonb_strip_nulls(jsonb_build_object(
    'httpStatus', case when jsonb_typeof(p -> 'httpStatus') = 'number' then (p ->> 'httpStatus')::numeric::int end,
    'success', case when jsonb_typeof(p -> 'success') = 'boolean' then (p ->> 'success')::boolean end,
    'message', nullif(left(regexp_replace(coalesce(p ->> 'message', ''), '\d{6,}', '[number]', 'g'), 300), ''),
    'callId', nullif(left(coalesce(p ->> 'callId', ''), 200), ''))) end
$$;
revoke all on function private.sub_reminder_clean_response(jsonb) from public, anon, authenticated;

drop function if exists public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz);
create or replace function public.sub_reminder_finish(p_reminder uuid, p_outcome text, p_detail text default null, p_response_code integer default null,
                                                      p_call_id text default null, p_now timestamptz default null, p_response jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.subscription_reminders;
  v_status text;
  c public.customers;
  v_now timestamptz := coalesce(p_now, now());
begin
  if p_outcome not in ('DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into r from public.subscription_reminders where id = p_reminder for update;
  if r.id is null or r.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This reminder is not being processed.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and r.attempts >= 3 then 'FAILED' else p_outcome end;
  update public.subscription_reminders
     set status = v_status,
         reason = case when v_status in ('ACCEPTED') then null else left(p_detail, 500) end,
         response_code = p_response_code,
         external_call_id = coalesce(left(p_call_id, 200), external_call_id),
         provider_response = coalesce(private.sub_reminder_clean_response(p_response), provider_response),
         accepted_at = case when v_status = 'ACCEPTED' then v_now else accepted_at end,
         next_attempt_at = case when v_status = 'RETRY' then v_now + (array[10, 30])[least(r.attempts, 2)] * interval '1 minute' else next_attempt_at end,
         locked_until = null, updated_at = v_now
   where id = r.id returning * into r;
  perform private.sub_reminder_log(r.id, case when v_status = 'ACCEPTED' then 'ACCEPTED' when v_status = 'DRY_RUN' then 'DRY_RUN'
                                              when v_status = 'RETRY' then 'RETRY' when v_status = 'SKIPPED' then 'SKIPPED' else 'FAILED' end,
                                   r.attempts, p_response_code, p_detail);
  if v_status in ('ACCEPTED', 'FAILED') then
    select * into c from public.customers where id = r.customer_id;
    perform private.write_audit(case when v_status = 'ACCEPTED' then 'SUBSCRIPTION_REMINDER_ACCEPTED' else 'SUBSCRIPTION_REMINDER_FAILED' end,
      'subscription_reminder', r.id, c.department_id, c.team_id,
      jsonb_build_object('customer', r.customer_id, 'service', r.service_code, 'stage', r.stage, 'expiry', r.expiry_date, 'attempts', r.attempts));
    perform private.log_customer_activity(r.customer_id, 'AUTOMATION_AI_CALL_' || v_status,
      format('Renewal reminder call (%s day%s before expiry on %s) for %s: %s', r.stage, case when r.stage = 1 then '' else 's' end, r.expiry_date, r.service_code,
             case when v_status = 'ACCEPTED' then 'request accepted by the calling service' else 'could not be placed' end));
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'attempts', r.attempts, 'nextAttemptAt', r.next_attempt_at);
end $$;
revoke all on function public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The result of a call (from the provider's call-status callback; server only)
-- ---------------------------------------------------------------------------
-- Matched by the provider's call id on a submitted (ACCEPTED) or already completed reminder call. COMPLETED: the call connected and ended, and the
-- reminder becomes COMPLETED. NOT_ANSWERED / BUSY: the reminder stays submitted with that outcome. FAILED: the provider says the call failed.
-- Receiving the same result again changes nothing (idempotent).
create or replace function public.sub_reminder_call_result(p_call_id text, p_outcome text, p_duration_seconds integer default null, p_detail text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.subscription_reminders;
  v_now timestamptz := coalesce(p_now, now());
  v_status text;
begin
  if p_outcome is null or p_outcome not in ('COMPLETED', 'NOT_ANSWERED', 'BUSY', 'FAILED') then
    raise exception 'VALIDATION_ERROR: The outcome must be COMPLETED, NOT_ANSWERED, BUSY or FAILED.' using errcode = 'P0001';
  end if;
  if p_duration_seconds is not null and (p_duration_seconds < 0 or p_duration_seconds > 86400) then
    raise exception 'VALIDATION_ERROR: The call duration is not valid.' using errcode = 'P0001';
  end if;
  select * into r from public.subscription_reminders
   where channel = 'CALL' and external_call_id = left(btrim(coalesce(p_call_id, '')), 200) and status in ('ACCEPTED', 'COMPLETED', 'FAILED')
   order by created_at desc limit 1 for update;
  if r.id is null then
    raise exception 'NOT_FOUND: No submitted reminder call has this call id.' using errcode = 'P0001';
  end if;
  if r.call_outcome is not distinct from p_outcome and r.call_duration_seconds is not distinct from p_duration_seconds then
    return jsonb_build_object('id', r.id, 'status', r.status, 'outcome', r.call_outcome, 'changed', false);
  end if;
  -- a completed call is never turned back by a later, older status
  v_status := case when r.status = 'COMPLETED' then 'COMPLETED' when p_outcome = 'COMPLETED' then 'COMPLETED' when p_outcome = 'FAILED' then 'FAILED' else r.status end;
  update public.subscription_reminders
     set call_outcome = case when r.status = 'COMPLETED' and p_outcome <> 'COMPLETED' then call_outcome else p_outcome end,
         call_duration_seconds = coalesce(p_duration_seconds, call_duration_seconds),
         call_result_at = v_now, status = v_status,
         completed_at = case when v_status = 'COMPLETED' then coalesce(completed_at, v_now) else completed_at end,
         reason = case when v_status = 'FAILED' and r.status <> 'FAILED' then left(coalesce(nullif(btrim(p_detail), ''), 'The calling service reported that the call failed.'), 500) else reason end,
         updated_at = v_now
   where id = r.id returning * into r;
  perform private.sub_reminder_log(r.id, 'RESULT', r.attempts, null,
    'Call result: ' || p_outcome || coalesce(' (' || p_duration_seconds || ' s)', '') || coalesce(': ' || left(regexp_replace(btrim(p_detail), '\d{6,}', '[number]', 'g'), 200), ''));
  return jsonb_build_object('id', r.id, 'status', r.status, 'outcome', r.call_outcome, 'changed', true);
end $$;
revoke all on function public.sub_reminder_call_result(text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_call_result(text, text, integer, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The reminder calls, for the Super Admin and HR staff (read only)
-- ---------------------------------------------------------------------------
-- p_filter: ALL, STAGE_7, STAGE_5, STAGE_1, PENDING (scheduled, retrying, being processed, dry run), SUBMITTED, FAILED, COMPLETED,
-- SKIPPED (skipped or cancelled). Phone numbers are masked. Dates are Asia/Kolkata calendar dates; timestamps are returned in UTC (ISO).
create or replace function public.sub_reminder_calls(p_filter text default 'ALL', p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_filter text := upper(coalesce(nullif(btrim(p_filter), ''), 'ALL'));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, least(coalesce(p_offset, 0), 100000));
  v_today date := private.office_today();
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only the Super Admin and HR staff can see the reminder calls.' using errcode = '42501';
  end if;
  if v_filter not in ('ALL', 'STAGE_7', 'STAGE_5', 'STAGE_1', 'PENDING', 'SUBMITTED', 'FAILED', 'COMPLETED', 'SKIPPED') then
    raise exception 'VALIDATION_ERROR: Unknown filter.' using errcode = 'P0001';
  end if;
  return (
    with calls as (
      select sr.* from public.subscription_reminders sr where sr.channel = 'CALL'),
    picked as (
      select * from calls sr
       where case v_filter
               when 'ALL' then true
               when 'STAGE_7' then sr.stage = 7
               when 'STAGE_5' then sr.stage = 5
               when 'STAGE_1' then sr.stage = 1
               when 'PENDING' then sr.status in ('SCHEDULED', 'RETRY', 'PROCESSING', 'DRY_RUN')
               when 'SUBMITTED' then sr.status = 'ACCEPTED'
               when 'FAILED' then sr.status = 'FAILED'
               when 'COMPLETED' then sr.status = 'COMPLETED'
               when 'SKIPPED' then sr.status in ('SKIPPED', 'CANCELLED')
             end)
    select jsonb_build_object(
      'today', v_today,
      'total', (select count(*) from picked),
      'counts', (select jsonb_build_object(
          'all', count(*), 'stage7', count(*) filter (where stage = 7), 'stage5', count(*) filter (where stage = 5), 'stage1', count(*) filter (where stage = 1),
          'pending', count(*) filter (where status in ('SCHEDULED', 'RETRY', 'PROCESSING', 'DRY_RUN')), 'submitted', count(*) filter (where status = 'ACCEPTED'),
          'failed', count(*) filter (where status = 'FAILED'), 'completed', count(*) filter (where status = 'COMPLETED'),
          'skipped', count(*) filter (where status in ('SKIPPED', 'CANCELLED'))) from calls),
      'lastSchedule', (select value from public.subscription_reminder_state where key = 'last_schedule'),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', p.id, 'customerId', p.customer_id, 'customer', c.name, 'company', c.company,
                 'phone', coalesce(p.phone_masked, (select '+91XXXXXX' || right(x, 4) from private.sub_reminder_phone(p.customer_id) x where x is not null)),
                 'serviceCode', p.service_code, 'serviceName', coalesce(sv.name, p.service_code), 'planName', cs.plan_name,
                 'expiryDate', p.expiry_date, 'daysLeft', p.expiry_date - v_today, 'stage', p.stage,
                 'scheduledDate', (p.send_after at time zone 'Asia/Kolkata')::date, 'submittedAt', p.accepted_at,
                 'status', p.status, 'attempts', p.attempts, 'responseCode', p.response_code, 'response', p.provider_response,
                 'callId', p.external_call_id, 'callOutcome', p.call_outcome, 'callDurationSeconds', p.call_duration_seconds,
                 'completedAt', p.completed_at, 'reason', p.reason, 'updatedAt', p.updated_at)
               order by p.send_after desc, p.created_at desc)
          from (select * from picked order by send_after desc, created_at desc limit v_limit offset v_offset) p
          join public.customers c on c.id = p.customer_id
          left join public.crm_services sv on sv.code = p.service_code
          left join public.customer_services cs on cs.customer_id = p.customer_id and cs.service_code = p.service_code), '[]'::jsonb)));
end $$;
revoke all on function public.sub_reminder_calls(text, integer, integer) from public, anon;
grant execute on function public.sub_reminder_calls(text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
