-- =============================================================================
-- Subscription expiry reminders (AI calls 7, 3 and 1 day before a service expires).
--
-- THIS MIGRATION DECIDES AND TRACKS REMINDERS; IT PLACES NO CALL. The sender (BolifyAI) is a separate step: until it exists the
-- API only prepares reminders ("dry run") and nothing leaves the server.
--
-- Source of truth for "when does this service expire": customer_services.renews_on (the "Renewal / Expiry Date" of the Excel
-- import), together with customer_services.service_status. No new subscription table. Invoice, payment and activation dates are
-- different things and are never used.
--
--  * reminder_call_settings        one row: the call window (Indian time) and whether customers with NO consent record may be called.
--  * customer_reminder_consent     the customer's call consent (ALLOWED with how it was obtained / DO_NOT_CALL). No row = unknown.
--  * subscription_reminders        one row per customer + service + expiry date + stage (7 / 3 / 1), UNIQUE event_key, so the same
--                                  reminder can never be queued twice for an expiry cycle. A changed expiry date is a new cycle.
--  * subscription_reminder_events  append-only log of every step (created, attempt, accepted, retry, failed, skipped, cancelled).
--  * sub_reminder_schedule()       the daily decider (service role, idempotent): creates the reminders due today.
--  * sub_reminder_claim()          takes due reminders for sending (SKIP LOCKED + lease). Re-checks everything at that moment: a
--                                  reminder is cancelled if the expiry date changed or the service was renewed, cancelled, paused or
--                                  expired, and skipped when the customer has no consent / asked not to be called, has no valid
--                                  mobile number, or the call window has passed. A late reminder is never sent after its window.
--  * sub_reminder_finish()         records the result: DRY_RUN / ACCEPTED / RETRY / FAILED / SKIPPED. ACCEPTED means the provider
--                                  took the request, NOT that a call was completed. At most 3 attempts (10 and 30 minutes apart).
--  * staff functions               set_customer_reminder_consent, set_customer_service_term, reminder settings, overview.
-- Dates use Indian time (Asia/Kolkata). Idempotent: safe to run again. No existing data is changed.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_call_settings (
  id boolean primary key default true check (id),
  window_start time not null default '10:00',
  window_end time not null default '19:00',
  allow_unknown_consent boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (window_start >= time '08:00' and window_end <= time '21:00' and window_start < window_end)
);
insert into public.reminder_call_settings (id) values (true) on conflict (id) do nothing;
alter table public.reminder_call_settings enable row level security;
revoke all on public.reminder_call_settings from public, anon, authenticated;

create table if not exists public.customer_reminder_consent (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  status text not null check (status in ('ALLOWED', 'DO_NOT_CALL')),
  note text check (length(note) <= 300),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now()
);
alter table public.customer_reminder_consent enable row level security;
revoke all on public.customer_reminder_consent from public, anon, authenticated;

create table if not exists public.subscription_reminders (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (length(event_key) <= 200),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null,
  expiry_date date not null,                        -- the expiry date this reminder was made for (a later change cancels it)
  stage integer not null check (stage in (7, 3, 1)),
  status text not null default 'SCHEDULED' check (status in
    ('SCHEDULED', 'PROCESSING', 'ACCEPTED', 'COMPLETED', 'FAILED', 'RETRY', 'SKIPPED', 'CANCELLED', 'DRY_RUN')),
  send_after timestamptz not null,                  -- the call window opens
  send_until timestamptz not null,                  -- ... and closes: a reminder is not sent after this
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  external_call_id text check (length(external_call_id) <= 200),
  response_code integer,
  phone_masked text,
  reason text check (length(reason) <= 500),        -- why skipped / cancelled / failed (sanitized, no secrets, no full numbers)
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists subscription_reminders_due_idx on public.subscription_reminders (status, next_attempt_at)
  where status in ('SCHEDULED', 'RETRY', 'PROCESSING', 'DRY_RUN');
create index if not exists subscription_reminders_customer_idx on public.subscription_reminders (customer_id, expiry_date);
create index if not exists subscription_reminders_call_idx on public.subscription_reminders (external_call_id) where external_call_id is not null;
alter table public.subscription_reminders enable row level security;
revoke all on public.subscription_reminders from public, anon, authenticated;

create table if not exists public.subscription_reminder_events (
  id bigint generated always as identity primary key,
  reminder_id uuid not null references public.subscription_reminders (id) on delete cascade,
  at timestamptz not null default now(),
  event text not null check (event in ('CREATED', 'ATTEMPT', 'DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED', 'CANCELLED')),
  attempt integer,
  response_code integer,
  detail text check (length(detail) <= 500)
);
create index if not exists subscription_reminder_events_reminder_idx on public.subscription_reminder_events (reminder_id, at);
alter table public.subscription_reminder_events enable row level security;
revoke all on public.subscription_reminder_events from public, anon, authenticated;

create table if not exists public.subscription_reminder_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.subscription_reminder_state enable row level security;
revoke all on public.subscription_reminder_state from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- The number to call, in +91 form, or null when neither the mobile nor the WhatsApp number is a valid Indian mobile.
create or replace function private.sub_reminder_phone(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select '+91' || coalesce(private.mobile10(c.phone), private.mobile10(c.whatsapp))
    from public.customers c
   where c.id = p_customer and coalesce(private.mobile10(c.phone), private.mobile10(c.whatsapp)) is not null
$$;
revoke all on function private.sub_reminder_phone(uuid) from public, anon, authenticated;

-- Why this reminder should no longer be sent (null = it is still valid): the expiry date changed or was removed, the service is
-- not live any more, or the customer is not a customer any more.
create or replace function private.sub_reminder_invalid(p_customer uuid, p_service text, p_expiry date)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when cs.customer_id is null then 'The service was removed from the customer.'
    when cs.renews_on is distinct from p_expiry then 'The expiry date changed (the service may have been renewed).'
    when coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) is distinct from 'LIVE'
      then 'The service is not live (' || coalesce(cs.service_status, 'not activated') || ').'
    when c.id is null or c.lifecycle_stage <> 'CUSTOMER' then 'The record is not an active customer.'
  end
  from (select 1) one
  left join public.customer_services cs on cs.customer_id = p_customer and cs.service_code = p_service
  left join public.customers c on c.id = p_customer
$$;
revoke all on function private.sub_reminder_invalid(uuid, text, date) from public, anon, authenticated;

create or replace function private.sub_reminder_log(p_reminder uuid, p_event text, p_attempt integer, p_code integer, p_detail text)
returns void language sql security definer set search_path = '' as $$
  insert into public.subscription_reminder_events (reminder_id, event, attempt, response_code, detail)
  values (p_reminder, p_event, p_attempt, p_code, left(p_detail, 500))
$$;
revoke all on function private.sub_reminder_log(uuid, text, integer, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The daily decider (service role). Idempotent: run it as often as you like.
-- ---------------------------------------------------------------------------
create or replace function public.sub_reminder_schedule(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.office_today());
  s public.reminder_call_settings;
  v_new integer := 0;
  v_cancelled integer := 0;
  v_ids uuid[];
begin
  select * into s from public.reminder_call_settings where id;

  -- Exactly 7, 3 and 1 day(s) before the expiry date (calendar days, Indian time). A day that was missed is NOT made up later:
  -- the next stage covers it. The window opens and closes at the times in the settings.
  with ins as (
    insert into public.subscription_reminders (event_key, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
     where cs.renews_on - v_today in (7, 3, 1)
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  v_new := cardinality(v_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_ids) x;

  -- Reminders that are no longer valid (renewed, date moved, cancelled ...) are withdrawn now, not only when they come due.
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
revoke all on function public.sub_reminder_schedule(date) from public, anon, authenticated;
grant execute on function public.sub_reminder_schedule(date) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The queue (service role)
-- ---------------------------------------------------------------------------
-- p_mode 'dry_run': claims SCHEDULED / RETRY reminders (they end as DRY_RUN, nothing is dialled).
-- p_mode 'live':    also claims DRY_RUN reminders that are still inside their window.
-- p_now exists for tests; leave it out.
create or replace function public.sub_reminder_claim(p_limit integer default 10, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Kolkata')::date;
  s public.reminder_call_settings;
  r public.subscription_reminders;
  v_ids uuid[];
  v_why text;
  v_phone text;
  v_consent text;
  v_claimed uuid[] := '{}';
begin
  select * into s from public.reminder_call_settings where id;

  -- A worker that stopped in the middle of a LIVE call attempt may or may not have placed the call: never repeat it, report it.
  -- (A dry-run attempt has no effect, so it simply goes back in the queue.)
  update public.subscription_reminders
     set status = case when p_mode = 'live' then 'FAILED' else 'SCHEDULED' end,
         reason = case when p_mode = 'live' then 'The result was never recorded (the server stopped). Not retried, to avoid calling the customer twice.' else reason end,
         locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  -- Withdraw reminders that are no longer valid.
  update public.subscription_reminders sr
     set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = v_now
   where sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN') and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null;

  -- A reminder whose window has closed is not sent late (and never in a burst the next day).
  update public.subscription_reminders
     set status = 'SKIPPED', reason = 'The call window for this reminder has passed.', locked_until = null, updated_at = v_now
   where status in ('SCHEDULED', 'RETRY') and send_until < v_now;

  select coalesce(array_agg(id), '{}') into v_ids from (
    select sr.id from public.subscription_reminders sr
     where sr.send_after <= v_now and sr.send_until >= v_now
       and ((sr.status in ('SCHEDULED', 'RETRY') and sr.next_attempt_at <= v_now) or (p_mode = 'live' and sr.status = 'DRY_RUN'))
     order by sr.send_after, sr.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  for r in select * from public.subscription_reminders where id = any (v_ids) order by send_after, created_at loop
    v_why := null;
    v_phone := private.sub_reminder_phone(r.customer_id);
    select coalesce((select k.status from public.customer_reminder_consent k where k.customer_id = r.customer_id), 'UNKNOWN') into v_consent;
    if v_consent = 'DO_NOT_CALL' then
      v_why := 'The customer asked not to be called.';
    elsif v_consent = 'UNKNOWN' and not s.allow_unknown_consent then
      v_why := 'No call consent is recorded for this customer.';
    elsif v_phone is null then
      v_why := 'The customer has no valid Indian mobile number.';
    end if;
    if v_why is not null then
      update public.subscription_reminders set status = 'SKIPPED', reason = v_why, locked_until = null, updated_at = v_now where id = r.id;
      perform private.sub_reminder_log(r.id, 'SKIPPED', r.attempts, null, v_why);
    else
      update public.subscription_reminders
         set status = 'PROCESSING', attempts = case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end,
             phone_masked = '+91XXXXXX' || right(v_phone, 4), reason = null, updated_at = v_now,
             locked_until = v_now + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 1800)))
       where id = r.id;
      perform private.sub_reminder_log(r.id, 'ATTEMPT', case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end, null, 'Claimed (' || p_mode || ')');
      v_claimed := v_claimed || r.id;
    end if;
  end loop;

  -- Only what the caller needs to place the call: no e-mail, no address, no payment data.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', sr.id, 'attempts', sr.attempts, 'stage', sr.stage, 'expiryDate', sr.expiry_date, 'daysLeft', sr.expiry_date - v_today,
             'phone', private.sub_reminder_phone(sr.customer_id), 'customerId', c.id,
             'firstName', split_part(btrim(c.name), ' ', 1), 'lastName', btrim(substr(btrim(c.name), length(split_part(btrim(c.name), ' ', 1)) + 1)),
             'company', c.company, 'serviceCode', sr.service_code, 'serviceName', sv.name, 'planName', cs.plan_name) order by sr.send_after, sr.created_at)
      from public.subscription_reminders sr
      join public.customers c on c.id = sr.customer_id
      left join public.crm_services sv on sv.code = sr.service_code
      left join public.customer_services cs on cs.customer_id = sr.customer_id and cs.service_code = sr.service_code
     where sr.id = any (v_claimed)), '[]'::jsonb);
end $$;
revoke all on function public.sub_reminder_claim(integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_claim(integer, text, integer, timestamptz) to service_role;

-- ACCEPTED = the provider took the request (it has a call id); it does NOT mean the call happened or was answered.
-- p_now exists for tests; leave it out.
create or replace function public.sub_reminder_finish(p_reminder uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_call_id text default null, p_now timestamptz default null)
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
revoke all on function public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_finish(uuid, text, text, integer, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Staff: consent, the term of a service, settings, and a read-only overview
-- ---------------------------------------------------------------------------
-- Records whether the customer may be called about renewals. ALLOWED needs a note saying how the consent was obtained.
-- UNKNOWN removes the record. Who may: anyone who may update that customer on the Support side.
create or replace function public.set_customer_reminder_consent(p_customer uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if p_status not in ('ALLOWED', 'DO_NOT_CALL', 'UNKNOWN') then
    raise exception 'VALIDATION_ERROR: Choose allowed, do not call, or unknown.' using errcode = 'P0001';
  end if;
  if not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status = 'ALLOWED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Say how the customer agreed to be called (for example "agreed on the phone on 3 March").' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if p_status = 'UNKNOWN' then
    delete from public.customer_reminder_consent where customer_id = p_customer;
  else
    insert into public.customer_reminder_consent (customer_id, status, note, changed_by, changed_at)
    values (p_customer, p_status, v_note, auth.uid(), now())
    on conflict (customer_id) do update set status = excluded.status, note = excluded.note, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  end if;
  perform private.write_audit('CUSTOMER_CALL_CONSENT_CHANGED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('status', p_status));
  perform private.log_customer_activity(p_customer, 'CALL_CONSENT_' || p_status, 'Renewal reminder call consent: ' || p_status || coalesce(' (' || v_note || ')', ''));
  return jsonb_build_object('customerId', p_customer, 'status', p_status);
end $$;
revoke all on function public.set_customer_reminder_consent(uuid, text, text) from public, anon;
grant execute on function public.set_customer_reminder_consent(uuid, text, text) to authenticated;

create or replace function public.customer_reminder_consent_get(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_build_object('status', k.status, 'note', k.note, 'changedAt', k.changed_at) from public.customer_reminder_consent k where k.customer_id = p_customer),
                  jsonb_build_object('status', 'UNKNOWN', 'note', null, 'changedAt', null));
end $$;
revoke all on function public.customer_reminder_consent_get(uuid) from public, anon;
grant execute on function public.customer_reminder_consent_get(uuid) to authenticated;

-- The start date, expiry / renewal date and status of one service of a customer (until now only the Excel import could set them).
-- A value left out (null) is not changed.
create or replace function public.set_customer_service_term(p_customer uuid, p_service text, p_started_on date default null, p_renews_on date default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cs public.customer_services;
  c public.customers;
begin
  if not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('LIVE', 'SETTING_UP', 'PAUSED', 'EXPIRED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown service status.' using errcode = 'P0001';
  end if;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if coalesce(p_renews_on, cs.renews_on) is not null and coalesce(p_started_on, cs.started_on) is not null
     and coalesce(p_renews_on, cs.renews_on) < coalesce(p_started_on, cs.started_on) then
    raise exception 'VALIDATION_ERROR: The expiry date is before the start date.' using errcode = 'P0001';
  end if;
  update public.customer_services
     set started_on = coalesce(p_started_on, started_on), renews_on = coalesce(p_renews_on, renews_on), service_status = coalesce(p_status, service_status)
   where customer_id = p_customer and service_code = p_service returning * into cs;
  select * into c from public.customers where id = p_customer;
  perform private.write_audit('CUSTOMER_SERVICE_TERM_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'started_on', cs.started_on, 'renews_on', cs.renews_on, 'status', cs.service_status));
  perform private.log_customer_activity(p_customer, 'SERVICE_TERM_CHANGED',
    format('%s: starts %s, renews / expires %s, status %s', p_service, coalesce(cs.started_on::text, '-'), coalesce(cs.renews_on::text, '-'), coalesce(cs.service_status, '-')));
  return jsonb_build_object('customerId', p_customer, 'service', p_service, 'startedOn', cs.started_on, 'renewsOn', cs.renews_on, 'status', cs.service_status);
end $$;
revoke all on function public.set_customer_service_term(uuid, text, date, date, text) from public, anon;
grant execute on function public.set_customer_service_term(uuid, text, date, date, text) to authenticated;

-- Super Admin: the call window and whether customers with no consent record may be called (off by default).
create or replace function public.set_reminder_call_settings(p_window_start time, p_window_end time, p_allow_unknown_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.reminder_call_settings;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change the reminder call settings.' using errcode = '42501';
  end if;
  if p_window_start is null or p_window_end is null or p_allow_unknown_consent is null
     or p_window_start < time '08:00' or p_window_end > time '21:00' or p_window_start >= p_window_end then
    raise exception 'VALIDATION_ERROR: The call window must be between 08:00 and 21:00 and end after it starts.' using errcode = 'P0001';
  end if;
  update public.reminder_call_settings
     set window_start = p_window_start, window_end = p_window_end, allow_unknown_consent = p_allow_unknown_consent, updated_by = auth.uid(), updated_at = now()
   where id returning * into s;
  perform private.write_audit('REMINDER_CALL_SETTINGS_CHANGED', 'reminder_call_settings', null, null, null,
    jsonb_build_object('window_start', s.window_start, 'window_end', s.window_end, 'allow_unknown_consent', s.allow_unknown_consent));
  return jsonb_build_object('windowStart', s.window_start, 'windowEnd', s.window_end, 'allowUnknownConsent', s.allow_unknown_consent);
end $$;
revoke all on function public.set_reminder_call_settings(time, time, boolean) from public, anon;
grant execute on function public.set_reminder_call_settings(time, time, boolean) to authenticated;

-- Super Admin: what the scheduler did. Counts by status and the latest reminders (phone numbers masked).
create or replace function public.sub_reminder_overview(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)));
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can read the reminder calls.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('windowStart', s.window_start, 'windowEnd', s.window_end, 'allowUnknownConsent', s.allow_unknown_consent) from public.reminder_call_settings s where s.id),
    'lastSchedule', (select value from public.subscription_reminder_state where key = 'last_schedule'),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.subscription_reminders where created_at >= v_since group by status) x), '{}'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'customer', t.name, 'service', t.service_code, 'stage', t.stage, 'expiryDate', t.expiry_date, 'status', t.status,
                                           'attempts', t.attempts, 'reason', t.reason, 'phone', t.phone_masked, 'callId', t.external_call_id, 'updatedAt', t.updated_at)
                       order by t.updated_at desc)
        from (select sr.*, c.name from public.subscription_reminders sr join public.customers c on c.id = sr.customer_id
               where sr.created_at >= v_since order by sr.updated_at desc limit 100) t), '[]'::jsonb));
end $$;
revoke all on function public.sub_reminder_overview(integer) from public, anon;
grant execute on function public.sub_reminder_overview(integer) to authenticated;
