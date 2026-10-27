-- =============================================================================
-- Subscription expiry reminders by E-MAIL and WHATSAPP (7, 3 and 1 day before a service expires), next to the AI-call reminders.
-- Builds on 20261112000100_subscription_reminders.sql. Safe to run again. Nothing is sent by this migration.
--
--  * subscription_reminders.channel   CALL (existing rows and behaviour unchanged) / EMAIL / WHATSAPP. One row per customer + service + expiry date +
--                                     stage + channel, each with its own UNIQUE event_key, so a channel is never queued twice for an expiry cycle.
--  * reminder_call_settings           email_enabled / whatsapp_enabled (on by default: with the server in dry run nothing leaves the server anyway).
--  * reminder_message_templates       the wording of each channel and stage, editable by the Super Admin, with an APPROVED flag. Seeded with DRAFT text
--                                     that is NOT approved: a live send needs an approved wording, so nothing goes out until the Super Admin approves it.
--  * customer_message_optout          a customer who must not get e-mail / WhatsApp reminders (staff record it; checked at the moment of sending).
--  * sub_message_claim / _finish      the queue for e-mail and WhatsApp (same rules as the calls: SKIP LOCKED + lease, re-checked at the moment of
--                                     sending, a window that has passed is never made up, at most 3 attempts, never repeated if the result was not recorded).
-- ACCEPTED means the provider took the request, not that the message was delivered or read.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Channel, settings
-- ---------------------------------------------------------------------------
alter table public.subscription_reminders add column if not exists channel text not null default 'CALL';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscription_reminders_channel_check' and conrelid = 'public.subscription_reminders'::regclass) then
    alter table public.subscription_reminders add constraint subscription_reminders_channel_check check (channel in ('CALL', 'EMAIL', 'WHATSAPP'));
  end if;
end $$;
comment on column public.subscription_reminders.external_call_id is 'The provider''s reference for the call / e-mail / WhatsApp request.';
comment on column public.subscription_reminders.phone_masked is 'The masked number or e-mail address the reminder was addressed to (never the full value).';

alter table public.reminder_call_settings add column if not exists email_enabled boolean not null default true;
alter table public.reminder_call_settings add column if not exists whatsapp_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. The wording (draft text, not approved)
-- ---------------------------------------------------------------------------
create table if not exists public.reminder_message_templates (
  channel text not null check (channel in ('EMAIL', 'WHATSAPP')),
  stage integer not null check (stage in (7, 3, 1)),
  subject text check (length(subject) <= 200),                      -- e-mail only
  body text not null check (length(body) between 1 and 2000),
  provider_template text check (length(provider_template) <= 120),  -- WhatsApp: the name of the approved template at the provider, if it needs one
  approved boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (channel, stage)
);
alter table public.reminder_message_templates enable row level security;
revoke all on public.reminder_message_templates from public, anon, authenticated;

-- DRAFT wording so the screens and the dry run have something to show. {{name}} {{service}} {{expiryDate}} {{daysLeft}} {{company}} are filled in per customer.
insert into public.reminder_message_templates (channel, stage, subject, body) values
  ('EMAIL', 7, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa will expire on {{expiryDate}}, which is {{daysLeft}} days from now.\n\nTo avoid any break in your service, please renew before that date. Reply to this e-mail or contact our support team and we will help you renew.'),
  ('EMAIL', 3, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nThis is a reminder that your {{service}} subscription will expire on {{expiryDate}}, in {{daysLeft}} days.\n\nPlease renew soon so that your service continues without interruption. Our support team is happy to help.'),
  ('EMAIL', 1, 'Your {{service}} subscription expires tomorrow',
   E'Dear {{name}},\n\nYour {{service}} subscription will expire tomorrow, on {{expiryDate}}.\n\nPlease renew today to keep your service running. Reply to this e-mail or call our support team and we will help right away.'),
  ('WHATSAPP', 7, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires on {{expiryDate}} ({{daysLeft}} days). Please renew in time to avoid any interruption. Reply here and our team will help you.'),
  ('WHATSAPP', 3, null,
   E'Hello {{name}}, a reminder: your {{service}} subscription expires on {{expiryDate}} ({{daysLeft}} days). Please renew soon so your service continues. Reply here for help.'),
  ('WHATSAPP', 1, null,
   E'Hello {{name}}, your {{service}} subscription expires tomorrow ({{expiryDate}}). Please renew today to keep it running. Reply here and we will help right away.')
on conflict (channel, stage) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Opt-out
-- ---------------------------------------------------------------------------
create table if not exists public.customer_message_optout (
  customer_id uuid not null references public.customers (id) on delete cascade,
  channel text not null check (channel in ('EMAIL', 'WHATSAPP')),
  note text check (length(note) <= 300),
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (customer_id, channel)
);
alter table public.customer_message_optout enable row level security;
revoke all on public.customer_message_optout from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The daily decider now also creates the e-mail and WhatsApp reminders
-- ---------------------------------------------------------------------------
-- p_channels limits what is created (null = every channel): each runner schedules only its own channel, so a channel that is switched off on the server
-- does not pile up reminders that nobody will ever claim. The old one-argument version is dropped so a call by name is never ambiguous.
drop function if exists public.sub_reminder_schedule(date);
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
       and (p_channels is null or 'CALL' = any (p_channels))
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  v_new := cardinality(v_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_ids) x;

  -- The same stages by e-mail and WhatsApp (when the channel is switched on in the settings): one row per channel, each with its own unique key, so a
  -- channel can never be queued twice for an expiry cycle and the call reminders are not affected. The wording must be approved before anything is sent.
  with ins as (
    insert into public.subscription_reminders (event_key, channel, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || ch.channel || '|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           ch.channel, cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
      cross join (select 'EMAIL' as channel where s.email_enabled union all select 'WHATSAPP' where s.whatsapp_enabled) ch
     where cs.renews_on - v_today in (7, 3, 1)
       and (p_channels is null or ch.channel = any (p_channels))
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_msg_ids from ins;
  v_new := v_new + cardinality(v_msg_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_msg_ids) x;

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
revoke all on function public.sub_reminder_schedule(date, text[]) from public, anon, authenticated;
grant execute on function public.sub_reminder_schedule(date, text[]) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The call queue only takes CALL reminders (everything else unchanged)
-- ---------------------------------------------------------------------------
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
   where channel = 'CALL' and status = 'PROCESSING' and locked_until < v_now;

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
     where sr.channel = 'CALL' and sr.send_after <= v_now and sr.send_until >= v_now
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

  -- Only what the caller needs to place the call. The calling service (BolifyAI) takes name, phone, e-mail, service and location,
  -- so the e-mail and the city are handed over now; no street address, no payment data.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', sr.id, 'attempts', sr.attempts, 'stage', sr.stage, 'expiryDate', sr.expiry_date, 'daysLeft', sr.expiry_date - v_today,
             'phone', private.sub_reminder_phone(sr.customer_id), 'customerId', c.id,
             'firstName', split_part(btrim(c.name), ' ', 1), 'lastName', btrim(substr(btrim(c.name), length(split_part(btrim(c.name), ' ', 1)) + 1)),
             'company', c.company, 'email', nullif(btrim(c.email), ''), 'location', nullif(btrim(c.city), ''),
             'serviceCode', sr.service_code, 'serviceName', sv.name, 'planName', cs.plan_name) order by sr.send_after, sr.created_at)
      from public.subscription_reminders sr
      join public.customers c on c.id = sr.customer_id
      left join public.crm_services sv on sv.code = sr.service_code
      left join public.customer_services cs on cs.customer_id = sr.customer_id and cs.service_code = sr.service_code
     where sr.id = any (v_claimed)), '[]'::jsonb);
end $$;
revoke all on function public.sub_reminder_claim(integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_reminder_claim(integer, text, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 6. The e-mail / WhatsApp queue (service role)
-- ---------------------------------------------------------------------------
-- p_mode 'dry_run': claims SCHEDULED / RETRY reminders (they end as DRY_RUN, nothing is sent). 'live': also claims DRY_RUN reminders still inside their
-- window, and ONLY those whose wording is approved (an unapproved channel / stage simply waits and is skipped when its window passes).
create or replace function public.sub_message_claim(p_channel text, p_limit integer default 10, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Asia/Kolkata')::date;
  s public.reminder_call_settings;
  r public.subscription_reminders;
  v_ids uuid[];
  v_why text;
  v_to text;
  v_masked text;
  v_claimed uuid[] := '{}';
begin
  if p_channel not in ('EMAIL', 'WHATSAPP') then
    raise exception 'VALIDATION_ERROR: Unknown channel.' using errcode = 'P0001';
  end if;
  select * into s from public.reminder_call_settings where id;
  if (p_channel = 'EMAIL' and not s.email_enabled) or (p_channel = 'WHATSAPP' and not s.whatsapp_enabled) then
    return '[]'::jsonb;
  end if;

  -- A worker that stopped in the middle of a LIVE send may or may not have sent it: never repeat it, report it. (A dry-run attempt has no effect.)
  update public.subscription_reminders
     set status = case when p_mode = 'live' then 'FAILED' else 'SCHEDULED' end,
         reason = case when p_mode = 'live' then 'The result was never recorded (the server stopped). Not retried, to avoid sending it twice.' else reason end,
         locked_until = null, updated_at = v_now
   where channel = p_channel and status = 'PROCESSING' and locked_until < v_now;

  update public.subscription_reminders sr
     set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = v_now
   where sr.channel = p_channel and sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN') and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null;

  update public.subscription_reminders
     set status = 'SKIPPED', reason = 'The sending window for this reminder has passed.', locked_until = null, updated_at = v_now
   where channel = p_channel and status in ('SCHEDULED', 'RETRY') and send_until < v_now;

  select coalesce(array_agg(id), '{}') into v_ids from (
    select sr.id from public.subscription_reminders sr
     where sr.channel = p_channel and sr.send_after <= v_now and sr.send_until >= v_now
       and ((sr.status in ('SCHEDULED', 'RETRY') and sr.next_attempt_at <= v_now) or (p_mode = 'live' and sr.status = 'DRY_RUN'))
       and (p_mode <> 'live' or exists (select 1 from public.reminder_message_templates t where t.channel = sr.channel and t.stage = sr.stage and t.approved))
     order by sr.send_after, sr.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  for r in select * from public.subscription_reminders where id = any (v_ids) order by send_after, created_at loop
    v_why := null;
    v_to := null;
    v_masked := null;
    if exists (select 1 from public.customer_message_optout o where o.customer_id = r.customer_id and o.channel = p_channel) then
      v_why := 'The customer asked not to receive these messages.';
    elsif p_channel = 'EMAIL' then
      select nullif(lower(btrim(c.email)), '') into v_to from public.customers c where c.id = r.customer_id;
      if v_to is null or v_to !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or length(v_to) > 254 then
        v_why := 'The customer has no valid e-mail address.';
      else
        v_masked := left(split_part(v_to, '@', 1), 1) || '***@' || split_part(v_to, '@', 2);
      end if;
    else
      select '+91' || coalesce(private.mobile10(c.whatsapp), private.mobile10(c.phone)) into v_to
        from public.customers c where c.id = r.customer_id and coalesce(private.mobile10(c.whatsapp), private.mobile10(c.phone)) is not null;
      if v_to is null then
        v_why := 'The customer has no valid Indian WhatsApp / mobile number.';
      else
        v_masked := '+91XXXXXX' || right(v_to, 4);
      end if;
    end if;
    if v_why is not null then
      update public.subscription_reminders set status = 'SKIPPED', reason = v_why, locked_until = null, updated_at = v_now where id = r.id;
      perform private.sub_reminder_log(r.id, 'SKIPPED', r.attempts, null, v_why);
    else
      update public.subscription_reminders
         set status = 'PROCESSING', attempts = case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end,
             phone_masked = v_masked, reason = null, updated_at = v_now,
             locked_until = v_now + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 1800)))
       where id = r.id;
      perform private.sub_reminder_log(r.id, 'ATTEMPT', case when r.status = 'DRY_RUN' then 1 else r.attempts + 1 end, null, 'Claimed (' || p_channel || ', ' || p_mode || ')');
      v_claimed := v_claimed || r.id;
    end if;
  end loop;

  -- Only what is needed to send the message (the address is returned here and nowhere else).
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', sr.id, 'channel', sr.channel, 'attempts', sr.attempts, 'stage', sr.stage, 'expiryDate', sr.expiry_date, 'daysLeft', sr.expiry_date - v_today,
             'to', case when sr.channel = 'EMAIL' then lower(btrim(c.email)) else '+91' || coalesce(private.mobile10(c.whatsapp), private.mobile10(c.phone)) end,
             'customerId', c.id, 'name', coalesce(nullif(btrim(c.name), ''), 'Customer'), 'firstName', split_part(btrim(c.name), ' ', 1), 'company', c.company,
             'serviceCode', sr.service_code, 'serviceName', sv.name, 'planName', cs.plan_name,
             'template', jsonb_build_object('subject', t.subject, 'body', t.body, 'providerTemplate', t.provider_template, 'approved', t.approved)) order by sr.send_after, sr.created_at)
      from public.subscription_reminders sr
      join public.customers c on c.id = sr.customer_id
      join public.reminder_message_templates t on t.channel = sr.channel and t.stage = sr.stage
      left join public.crm_services sv on sv.code = sr.service_code
      left join public.customer_services cs on cs.customer_id = sr.customer_id and cs.service_code = sr.service_code
     where sr.id = any (v_claimed)), '[]'::jsonb);
end $$;
revoke all on function public.sub_message_claim(text, integer, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_message_claim(text, integer, text, integer, timestamptz) to service_role;

-- ACCEPTED = the provider took the request (it may have a reference); it does NOT mean the message was delivered or read.
create or replace function public.sub_message_finish(p_reminder uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_ref text default null, p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.subscription_reminders;
  v_status text;
  c public.customers;
  v_now timestamptz := coalesce(p_now, now());
  v_label text;
begin
  if p_outcome not in ('DRY_RUN', 'ACCEPTED', 'RETRY', 'FAILED', 'SKIPPED') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into r from public.subscription_reminders where id = p_reminder and channel in ('EMAIL', 'WHATSAPP') for update;
  if r.id is null or r.status <> 'PROCESSING' then
    raise exception 'CONFLICT: This reminder is not being processed.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and r.attempts >= 3 then 'FAILED' else p_outcome end;
  update public.subscription_reminders
     set status = v_status,
         reason = case when v_status = 'ACCEPTED' then null else left(p_detail, 500) end,
         response_code = p_response_code,
         external_call_id = coalesce(left(p_ref, 200), external_call_id),
         accepted_at = case when v_status = 'ACCEPTED' then v_now else accepted_at end,
         next_attempt_at = case when v_status = 'RETRY' then v_now + (array[10, 30])[least(r.attempts, 2)] * interval '1 minute' else next_attempt_at end,
         locked_until = null, updated_at = v_now
   where id = r.id returning * into r;
  perform private.sub_reminder_log(r.id, case when v_status = 'ACCEPTED' then 'ACCEPTED' when v_status = 'DRY_RUN' then 'DRY_RUN'
                                              when v_status = 'RETRY' then 'RETRY' when v_status = 'SKIPPED' then 'SKIPPED' else 'FAILED' end,
                                   r.attempts, p_response_code, p_detail);
  if v_status in ('ACCEPTED', 'FAILED') then
    select * into c from public.customers where id = r.customer_id;
    v_label := case r.channel when 'EMAIL' then 'e-mail' else 'WhatsApp message' end;
    perform private.write_audit(case when v_status = 'ACCEPTED' then 'SUBSCRIPTION_REMINDER_ACCEPTED' else 'SUBSCRIPTION_REMINDER_FAILED' end,
      'subscription_reminder', r.id, c.department_id, c.team_id,
      jsonb_build_object('customer', r.customer_id, 'service', r.service_code, 'stage', r.stage, 'expiry', r.expiry_date, 'attempts', r.attempts, 'channel', r.channel));
    perform private.log_customer_activity(r.customer_id, 'AUTOMATION_' || r.channel || '_REMINDER_' || v_status,
      format('Renewal reminder %s (%s day%s before expiry on %s) for %s: %s', v_label, r.stage, case when r.stage = 1 then '' else 's' end, r.expiry_date, r.service_code,
             case when v_status = 'ACCEPTED' then 'accepted by the sending service' else 'could not be sent' end));
  end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'attempts', r.attempts, 'nextAttemptAt', r.next_attempt_at);
end $$;
revoke all on function public.sub_message_finish(uuid, text, text, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.sub_message_finish(uuid, text, text, integer, text, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- 7. Staff: opt-out; Super Admin: channels and wording; the overview
-- ---------------------------------------------------------------------------
-- Who may: anyone who may update that customer on the Support side (same as the call consent).
create or replace function public.set_customer_message_optout(p_customer uuid, p_channel text, p_optout boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 300), '');
begin
  if p_channel not in ('EMAIL', 'WHATSAPP') then
    raise exception 'VALIDATION_ERROR: Choose e-mail or WhatsApp.' using errcode = 'P0001';
  end if;
  if not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if coalesce(p_optout, false) then
    insert into public.customer_message_optout (customer_id, channel, note, changed_by, changed_at)
    values (p_customer, p_channel, v_note, auth.uid(), now())
    on conflict (customer_id, channel) do update set note = excluded.note, changed_by = excluded.changed_by, changed_at = excluded.changed_at;
  else
    delete from public.customer_message_optout where customer_id = p_customer and channel = p_channel;
  end if;
  perform private.write_audit('CUSTOMER_MESSAGE_OPTOUT_CHANGED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('channel', p_channel, 'optout', coalesce(p_optout, false)));
  perform private.log_customer_activity(p_customer, 'MESSAGE_OPTOUT_' || case when coalesce(p_optout, false) then 'ON' else 'OFF' end,
    'Renewal reminder ' || case p_channel when 'EMAIL' then 'e-mails' else 'WhatsApp messages' end || ': ' || case when coalesce(p_optout, false) then 'opted out' else 'allowed again' end || coalesce(' (' || v_note || ')', ''));
  return jsonb_build_object('customerId', p_customer, 'channel', p_channel, 'optout', coalesce(p_optout, false));
end $$;
revoke all on function public.set_customer_message_optout(uuid, text, boolean, text) from public, anon;
grant execute on function public.set_customer_message_optout(uuid, text, boolean, text) to authenticated;

create or replace function public.customer_message_optout_get(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'EMAIL', exists (select 1 from public.customer_message_optout o where o.customer_id = p_customer and o.channel = 'EMAIL'),
    'WHATSAPP', exists (select 1 from public.customer_message_optout o where o.customer_id = p_customer and o.channel = 'WHATSAPP'));
end $$;
revoke all on function public.customer_message_optout_get(uuid) from public, anon;
grant execute on function public.customer_message_optout_get(uuid) to authenticated;

-- Super Admin: switch the e-mail / WhatsApp reminders on or off.
create or replace function public.set_reminder_channels(p_email boolean, p_whatsapp boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.reminder_call_settings;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change the reminder channels.' using errcode = '42501';
  end if;
  if p_email is null or p_whatsapp is null then
    raise exception 'VALIDATION_ERROR: Choose on or off for each channel.' using errcode = 'P0001';
  end if;
  update public.reminder_call_settings set email_enabled = p_email, whatsapp_enabled = p_whatsapp, updated_by = auth.uid(), updated_at = now() where id returning * into s;
  perform private.write_audit('REMINDER_CHANNELS_CHANGED', 'reminder_call_settings', null, null, null, jsonb_build_object('email', s.email_enabled, 'whatsapp', s.whatsapp_enabled));
  return jsonb_build_object('emailEnabled', s.email_enabled, 'whatsappEnabled', s.whatsapp_enabled);
end $$;
revoke all on function public.set_reminder_channels(boolean, boolean) from public, anon;
grant execute on function public.set_reminder_channels(boolean, boolean) to authenticated;

-- Super Admin: the wording. Only these {{placeholders}} are allowed. A wording is used for a LIVE send only when approved; editing the text withdraws
-- the approval unless it is approved again in the same call.
create or replace function public.reminder_message_templates_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can read the reminder wording.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('channel', t.channel, 'stage', t.stage, 'subject', t.subject, 'body', t.body, 'providerTemplate', t.provider_template,
                                                        'approved', t.approved, 'updatedAt', t.updated_at) order by t.channel, t.stage desc)
                     from public.reminder_message_templates t), '[]'::jsonb);
end $$;
revoke all on function public.reminder_message_templates_get() from public, anon;
grant execute on function public.reminder_message_templates_get() to authenticated;

create or replace function public.set_reminder_message_template(p_channel text, p_stage integer, p_subject text, p_body text, p_provider_template text default null, p_approved boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_bad text;
  t public.reminder_message_templates;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change the reminder wording.' using errcode = '42501';
  end if;
  if p_channel not in ('EMAIL', 'WHATSAPP') or p_stage not in (7, 3, 1) then
    raise exception 'VALIDATION_ERROR: Choose e-mail or WhatsApp and stage 7, 3 or 1.' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 2000 then
    raise exception 'VALIDATION_ERROR: The message must be between 1 and 2,000 characters.' using errcode = 'P0001';
  end if;
  if p_channel = 'EMAIL' and v_subject is null then
    raise exception 'VALIDATION_ERROR: An e-mail needs a subject.' using errcode = 'P0001';
  end if;
  select m[1] into v_bad from regexp_matches(coalesce(v_subject, '') || ' ' || v_body, '\{\{\s*([A-Za-z0-9_]*)\s*\}\}', 'g') as m
   where m[1] not in ('name', 'service', 'expiryDate', 'daysLeft', 'company') limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_ERROR: Unknown placeholder {{%}}. Use {{name}}, {{service}}, {{expiryDate}}, {{daysLeft}} or {{company}}.', v_bad using errcode = 'P0001';
  end if;
  insert into public.reminder_message_templates (channel, stage, subject, body, provider_template, approved, updated_by, updated_at)
  values (p_channel, p_stage, case when p_channel = 'EMAIL' then left(v_subject, 200) end, v_body, nullif(left(btrim(coalesce(p_provider_template, '')), 120), ''), coalesce(p_approved, false), auth.uid(), now())
  on conflict (channel, stage) do update
     set subject = excluded.subject, body = excluded.body, provider_template = excluded.provider_template, approved = excluded.approved, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into t;
  perform private.write_audit('REMINDER_TEMPLATE_CHANGED', 'reminder_message_template', null, null, null, jsonb_build_object('channel', t.channel, 'stage', t.stage, 'approved', t.approved));
  return jsonb_build_object('channel', t.channel, 'stage', t.stage, 'approved', t.approved);
end $$;
revoke all on function public.set_reminder_message_template(text, integer, text, text, text, boolean) from public, anon;
grant execute on function public.set_reminder_message_template(text, integer, text, text, text, boolean) to authenticated;

-- The overview now covers every channel.
create or replace function public.sub_reminder_overview(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 14), 90)));
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can read the reminders.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'settings', (select jsonb_build_object('windowStart', s.window_start, 'windowEnd', s.window_end, 'allowUnknownConsent', s.allow_unknown_consent,
                                           'emailEnabled', s.email_enabled, 'whatsappEnabled', s.whatsapp_enabled) from public.reminder_call_settings s where s.id),
    'lastSchedule', (select value from public.subscription_reminder_state where key = 'last_schedule'),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from public.subscription_reminders where created_at >= v_since group by status) x), '{}'::jsonb),
    'countsByChannel', coalesce((select jsonb_object_agg(channel, m) from (
        select channel, jsonb_object_agg(status, n) m from (select channel, status, count(*) n from public.subscription_reminders where created_at >= v_since group by 1, 2) a group by channel) b), '{}'::jsonb),
    'approvedWording', coalesce((select jsonb_object_agg(channel, n) from (select channel, count(*) filter (where approved) n from public.reminder_message_templates group by channel) w), '{}'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'channel', t.channel, 'customer', t.name, 'service', t.service_code, 'stage', t.stage, 'expiryDate', t.expiry_date, 'status', t.status,
                                           'attempts', t.attempts, 'reason', t.reason, 'phone', t.phone_masked, 'callId', t.external_call_id, 'updatedAt', t.updated_at)
                       order by t.updated_at desc)
        from (select sr.*, c.name from public.subscription_reminders sr join public.customers c on c.id = sr.customer_id
               where sr.created_at >= v_since order by sr.updated_at desc limit 100) t), '[]'::jsonb));
end $$;
revoke all on function public.sub_reminder_overview(integer) from public, anon;
grant execute on function public.sub_reminder_overview(integer) to authenticated;

notify pgrst, 'reload schema';
