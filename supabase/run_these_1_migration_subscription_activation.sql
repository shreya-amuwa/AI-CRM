-- =============================================================================
-- Subscription duration, activation and expiry (see docs/SUBSCRIPTION_ACTIVATION.md). Paste the whole file into the Supabase SQL editor and run it once.
-- Safe to run again; nothing is deleted and nothing is sent. Needs the earlier migrations (up to 20261210000100).
-- =============================================================================

-- =============================================================================
-- Subscription duration, activation and expiry.
--
--   Sales picks the plan and the DURATION (1 / 2 / 3 / 6 months, 1 / 2 years, or a custom number of months or days), the amount and the message
--   credits. Sales never sets a start or an expiry date. The subscription STARTS when the team confirms that the panel was created and activated:
--   the person who confirms records the actual activation date, the panel creation date and (automatically) who did it, and the database
--   calculates the expiry date from the stored duration (calendar months and years, month ends and leap years included).
--
--   Sales  -> set_subscription_terms          plan, duration, amount, message credits (while nothing has started)
--   Team   -> confirm_subscription_activation the same prerequisites as "service ready" (payment confirmed, Meta verification, Relationship Manager,
--                                             authorized documents, login) + the dates. A second request changes nothing.
--   Heads  -> correct_subscription_dates      Super Admin / Department Head / support Team Head, a reason is required, old and new dates are kept
--   Team   -> confirm_subscription_renewal    needs a VERIFIED payment of this customer; the old cycle is kept (ENDED), a new cycle starts
--                                             (continuing from the old expiry while it is still running, or from the confirmed date once it has lapsed)
--   Team   -> resend_activation_email         the panel activation e-mail is queued once when the subscription starts; this retries or repeats it
--
-- Reused, not duplicated: customer_services (started_on = the activation date, renews_on = the expiry date, plan_name, price, platform,
-- panel_url), the service-setup rules of the onboarding journey, the e-mail outbox (automation_jobs), the expiry reminders (they already follow
-- customer_services.renews_on and one event per expiry date, stage and channel), client_notifications and the audit log.
-- New: subscription_cycles (every cycle kept), subscription_history (append-only), usage_alert_settings / usage_alert_log (70/80/90/100 %).
--
-- Direct writes of these columns by a signed-in user are refused by a trigger (only the functions above write them). Existing customers and
-- services keep working: a service with no duration behaves exactly as before.
-- Run after 20261209000600_department_head_handover_queue.sql. Safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.customer_services
  add column if not exists duration_code text,
  add column if not exists duration_months integer,
  add column if not exists duration_days integer,
  add column if not exists message_credits bigint,
  add column if not exists panel_created_on date,
  add column if not exists activated_by uuid references public.profiles (id) on delete set null,
  add column if not exists activation_confirmed_at timestamptz,
  add column if not exists subscription_cycle integer not null default 0;

alter table public.customer_services drop constraint if exists customer_services_duration_check;
alter table public.customer_services add constraint customer_services_duration_check check (
  (duration_code is null and duration_months is null and duration_days is null)
  or (duration_code in ('1M', '2M', '3M', '6M', '1Y', '2Y') and duration_months is not null and duration_days is null)
  or (duration_code = 'CUSTOM' and (duration_months is null) <> (duration_days is null)));
alter table public.customer_services drop constraint if exists customer_services_duration_range_check;
alter table public.customer_services add constraint customer_services_duration_range_check check (
  (duration_months is null or duration_months between 1 and 120) and (duration_days is null or duration_days between 1 and 3650));
alter table public.customer_services drop constraint if exists customer_services_message_credits_check;
alter table public.customer_services add constraint customer_services_message_credits_check check (message_credits is null or message_credits >= 0);
alter table public.customer_services drop constraint if exists customer_services_cycle_check;
alter table public.customer_services add constraint customer_services_cycle_check check (subscription_cycle >= 0);
alter table public.customer_services drop constraint if exists customer_services_dates_order_check;
alter table public.customer_services add constraint customer_services_dates_order_check check (
  panel_created_on is null or started_on is null or panel_created_on <= started_on);

-- Every cycle of a subscription, kept: the first activation and every renewal.
create table if not exists public.subscription_cycles (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  cycle_no integer not null check (cycle_no >= 1),
  kind text not null check (kind in ('INITIAL', 'RENEWAL')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),
  plan_name text check (length(plan_name) <= 120),
  price numeric(14,2) check (price >= 0),
  duration_code text not null,
  duration_months integer,
  duration_days integer,
  message_credits bigint check (message_credits >= 0),
  panel_created_on date,
  started_on date not null,
  expires_on date not null,
  activated_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  payment_id uuid references public.customer_payments (id) on delete restrict,
  ended_at timestamptz,
  primary key (customer_id, service_code, cycle_no),
  check (expires_on > started_on)
);
create unique index if not exists subscription_cycles_payment_key on public.subscription_cycles (payment_id) where payment_id is not null;
create unique index if not exists subscription_cycles_one_active_key on public.subscription_cycles (customer_id, service_code) where status = 'ACTIVE';
alter table public.subscription_cycles enable row level security;
revoke all on public.subscription_cycles from public, anon, authenticated;

-- What was changed, by whom, with the old and new values (append-only).
create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null,
  cycle_no integer,
  action text not null check (action in ('TERMS_SET', 'ACTIVATED', 'DATES_CORRECTED', 'RENEWED', 'EMAIL_RESENT')),
  old_values jsonb,
  new_values jsonb,
  reason text check (length(reason) <= 500),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscription_history_customer_idx on public.subscription_history (customer_id, created_at desc);
alter table public.subscription_history enable row level security;
revoke all on public.subscription_history from public, anon, authenticated;

create or replace function private.tg_subscription_history_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'The subscription history is append-only.' using errcode = '42501';
end $$;
revoke all on function private.tg_subscription_history_append_only() from public, anon, authenticated;
drop trigger if exists subscription_history_append_only on public.subscription_history;
create trigger subscription_history_append_only before update or delete on public.subscription_history
  for each row execute function private.tg_subscription_history_append_only();

-- the panel activation e-mail is its own job kind
alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT', 'ACCOUNT_CREATED', 'PANEL_CREDENTIALS',
                   'PANEL_LINK', 'SUBSCRIPTION_ACTIVATED'));

-- ---------------------------------------------------------------------------
-- 2. Nobody writes these columns directly (Sales or anyone else signed in): only the functions below do
-- ---------------------------------------------------------------------------
create or replace function private.tg_customer_services_protect_subscription()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A signed-in user's own statement (current_user stays 'authenticated'); the security-definer functions run as their owner and pass.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- (deleting the whole customer cascades to its services: that is the delete-customer function's business, not a user removing a service)
    if pg_trigger_depth() = 1 and (old.started_on is not null or old.subscription_cycle > 0) then
      raise exception 'CONFLICT: This subscription has started; the service cannot be removed from the customer.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.started_on is not null or new.renews_on is not null or new.activated_at is not null or new.panel_created_on is not null
       or new.activated_by is not null or new.activation_confirmed_at is not null or new.duration_code is not null
       or new.duration_months is not null or new.duration_days is not null or new.message_credits is not null or new.subscription_cycle <> 0 then
      raise exception 'FORBIDDEN: Subscription dates and terms are set only through the subscription workflow.' using errcode = '42501';
    end if;
  elsif new.started_on is distinct from old.started_on or new.renews_on is distinct from old.renews_on or new.activated_at is distinct from old.activated_at
     or new.panel_created_on is distinct from old.panel_created_on or new.activated_by is distinct from old.activated_by
     or new.activation_confirmed_at is distinct from old.activation_confirmed_at or new.duration_code is distinct from old.duration_code
     or new.duration_months is distinct from old.duration_months or new.duration_days is distinct from old.duration_days
     or new.message_credits is distinct from old.message_credits or new.subscription_cycle is distinct from old.subscription_cycle then
    raise exception 'FORBIDDEN: Subscription dates and terms are set only through the subscription workflow.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_customer_services_protect_subscription() from public, anon, authenticated;
drop trigger if exists customer_services_protect_subscription on public.customer_services;
create trigger customer_services_protect_subscription before insert or update or delete on public.customer_services
  for each row execute function private.tg_customer_services_protect_subscription();

-- ---------------------------------------------------------------------------
-- 3. Date arithmetic (one place)
-- ---------------------------------------------------------------------------
-- Calendar months and years: the same day of the month later, or the last day of a shorter month (31 Jan + 1 month = 28/29 Feb;
-- 29 Feb 2028 + 1 year = 28 Feb 2029). Custom days are plain days.
create or replace function private.subscription_expiry(p_start date, p_months integer, p_days integer)
returns date language sql immutable set search_path = '' as $$
  select case when p_months is not null then (p_start + make_interval(months => p_months))::date else p_start + p_days end
$$;
revoke all on function private.subscription_expiry(date, integer, integer) from public, anon, authenticated;

create or replace function private.duration_label(p_code text, p_months integer, p_days integer)
returns text language sql immutable set search_path = '' as $$
  select case p_code
    when '1M' then '1 month' when '2M' then '2 months' when '3M' then '3 months' when '6M' then '6 months'
    when '1Y' then '1 year' when '2Y' then '2 years'
    when 'CUSTOM' then case when p_months is not null then p_months || ' month' || case when p_months = 1 then '' else 's' end
                            else p_days || ' day' || case when p_days = 1 then '' else 's' end end
    end
$$;
revoke all on function private.duration_label(text, integer, integer) from public, anon, authenticated;

-- {"durationCode": "6M"} or {"durationCode": "CUSTOM", "customMonths": 5} / {"customDays": 45}  ->  (code, months, days)
create or replace function private.parse_duration(p jsonb)
returns table (code text, months integer, days integer) language plpgsql immutable set search_path = '' as $$
declare
  v_code text := upper(btrim(coalesce(p ->> 'durationCode', '')));
  v_m integer;
  v_d integer;
begin
  if v_code not in ('1M', '2M', '3M', '6M', '1Y', '2Y', 'CUSTOM') then
    raise exception 'VALIDATION_ERROR: Choose the subscription duration (1, 2, 3 or 6 months, 1 or 2 years, or custom).' using errcode = 'P0001';
  end if;
  if v_code = 'CUSTOM' then
    begin
      v_m := nullif(btrim(coalesce(p ->> 'customMonths', '')), '')::integer;
      v_d := nullif(btrim(coalesce(p ->> 'customDays', '')), '')::integer;
    exception when others then
      raise exception 'VALIDATION_ERROR: Enter the custom duration as a whole number of months or days.' using errcode = 'P0001';
    end;
    if (v_m is null) = (v_d is null) then
      raise exception 'VALIDATION_ERROR: Enter the custom duration either in months or in days, not both.' using errcode = 'P0001';
    end if;
    if v_m is not null and v_m not between 1 and 120 then
      raise exception 'VALIDATION_ERROR: A custom duration is 1 to 120 months.' using errcode = 'P0001';
    end if;
    if v_d is not null and v_d not between 1 and 3650 then
      raise exception 'VALIDATION_ERROR: A custom duration is 1 to 3650 days.' using errcode = 'P0001';
    end if;
    return query select v_code, v_m, v_d;
  else
    return query select v_code, case v_code when '1M' then 1 when '2M' then 2 when '3M' then 3 when '6M' then 6 when '1Y' then 12 else 24 end, null::integer;
  end if;
end $$;
revoke all on function private.parse_duration(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Who may do what
-- ---------------------------------------------------------------------------
-- Does the signed-in employee work on any service of this customer (support, the hand-over team, a delivery department)?
create or replace function private.may_work_any_service(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and private.may_set_service_setup(p_customer, cs.service_code))
$$;
revoke all on function private.may_work_any_service(uuid) from public, anon, authenticated;

-- The plan / duration / amount / credits: whoever owns the customer's record (the salesperson, their Team Head, the Department Head, the Super
-- Admin), until the subscription has started.
create or replace function private.may_set_subscription_terms(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_customer(p_customer)
$$;
revoke all on function private.may_set_subscription_terms(uuid) from public, anon, authenticated;

-- Correcting a confirmed date is for the heads.
create or replace function private.may_correct_subscription(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_super_admin()
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.my_role() = 'TEAM_HEAD' and private.may_work_any_service(c.id))
      from public.customers c where c.id = p_customer), false)
$$;
revoke all on function private.may_correct_subscription(uuid) from public, anon, authenticated;

-- What is still missing before a service can be marked ready / a subscription can start (null = nothing). The same checks the onboarding
-- journey makes for "service ready".
create or replace function private.service_ready_problem(p_customer uuid, p_service text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  v_missing text;
begin
  if coalesce((f ->> 'applies')::boolean, false) then
    if not coalesce((f ->> 'payment')::boolean, false) then
      return 'The payment is not confirmed yet.';
    end if;
    if not coalesce((f ->> 'metaDone')::boolean, false) then
      return 'Meta verification is not completed yet.';
    end if;
    if not coalesce((f ->> 'rmDone')::boolean, false) then
      return 'The Relationship Manager is not assigned yet.';
    end if;
  end if;
  if not coalesce((f ->> 'login')::boolean, false) then
    return 'The client has no login yet.';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
    from private.customer_items(p_customer) i
    join public.onboarding_item_services m on m.item_code = i.code and m.service_code = p_service
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
   where not coalesce(i.is_optional, false) and coalesce(e.status, '') <> 'VERIFIED';
  if v_missing is not null then
    return 'Authorize these first: ' || v_missing || '.';
  end if;
  return null;
end $$;
revoke all on function private.service_ready_problem(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A service that has a duration starts through the activation, not through "ready"
--    (same function as the journey's, plus that one rule and the shared prerequisites)
-- ---------------------------------------------------------------------------
create or replace function public.set_service_setup(p_customer uuid, p_service text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  f jsonb;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_problem text;
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if v_status not in ('IN_PROGRESS', 'READY') then
    raise exception 'VALIDATION_ERROR: Choose In progress or Ready.' using errcode = 'P0001';
  end if;
  if cs.setup_status = v_status then
    raise exception 'CONFLICT: This service is already %.', lower(replace(v_status, '_', ' ')) using errcode = 'P0001';
  end if;
  if cs.setup_status = 'READY' then
    if not private.is_super_admin() then
      raise exception 'CONFLICT: This service is already ready. Only the Super Admin can reopen it.' using errcode = 'P0001';
    end if;
  end if;
  f := private.client_facts(p_customer);
  if coalesce((f ->> 'applies')::boolean, false) then
    if not coalesce((f ->> 'payment')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The payment is not confirmed yet.' using errcode = 'P0001';
    end if;
    if not coalesce((f ->> 'metaDone')::boolean, false) then
      raise exception 'VALIDATION_ERROR: Meta verification is not completed yet.' using errcode = 'P0001';
    end if;
    if not coalesce((f ->> 'rmDone')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The Relationship Manager is not assigned yet.' using errcode = 'P0001';
    end if;
  end if;
  if v_status = 'READY' then
    if cs.duration_code is not null and cs.started_on is null then
      raise exception 'CONFLICT: This service has a subscription. Confirm the panel activation with its dates instead: the subscription starts on the confirmed activation date.' using errcode = 'P0001';
    end if;
    v_problem := private.service_ready_problem(p_customer, p_service);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
  end if;

  update public.customer_services
     set setup_status = v_status, setup_updated_at = now(), setup_updated_by = (select private.my_id()), setup_note = v_note,
         setup_completed_at = case when v_status = 'READY' then now() else null end,
         service_status = case when v_status = 'READY' then 'LIVE' else coalesce(service_status, 'SETTING_UP') end,
         activated_at = case when v_status = 'READY' then coalesce(activated_at, now()) else activated_at end
   where customer_id = p_customer and service_code = p_service;
  perform private.log_customer_activity(p_customer, 'SERVICE_SETUP', format('%s setup: %s', sv.name, lower(replace(v_status, '_', ' '))) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('SERVICE_SETUP_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'from', cs.setup_status, 'to', v_status, 'note', v_note));
  perform private.client_notify(p_customer, 'SERVICE_SETUP', case when v_status = 'READY' then format('%s is ready', sv.name) else format('%s setup has started', sv.name) end,
    case when v_status = 'READY' then 'The setup is complete. You can find it under My Services.' else coalesce(v_note, 'Our team is setting it up.') end,
    'service', null, format('SETUP|%s|%s|%s|%s', p_customer, p_service, v_status, extract(epoch from now())::bigint));
  return jsonb_build_object('service', p_service, 'status', v_status, 'note', v_note);
end $$;
revoke all on function public.set_service_setup(uuid, text, text, text) from public, anon;
grant execute on function public.set_service_setup(uuid, text, text, text) to authenticated;

-- The staff may no longer type renewal dates over a subscription that has terms: those dates come from the activation, the correction or the renewal.
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
  if (p_started_on is not null or p_renews_on is not null) and (cs.duration_code is not null or cs.subscription_cycle > 0) then
    raise exception 'CONFLICT: The dates of this subscription come from its activation. Use the subscription''s "Correct dates" (with a reason) or its renewal.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 6. How one subscription is shown (staff and client use the same builder)
-- ---------------------------------------------------------------------------
create or replace function private.subscription_status(cs public.customer_services)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when cs.service_status in ('PAUSED', 'CANCELLED') then cs.service_status
    when cs.started_on is not null and cs.renews_on is not null and cs.renews_on < private.office_today() then 'EXPIRED'
    when cs.started_on is not null then 'ACTIVE'
    when cs.service_status = 'EXPIRED' then 'EXPIRED'
    when cs.service_status = 'LIVE' or cs.activated_at is not null then 'ACTIVE'
    else 'NOT_STARTED' end
$$;
revoke all on function private.subscription_status(public.customer_services) from public, anon, authenticated;

create or replace function private.subscription_json(cs public.customer_services)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'service', cs.service_code, 'serviceName', s.name, 'category', s.category,
    'plan', cs.plan_name, 'amount', cs.price, 'panel', cs.platform,
    'durationCode', cs.duration_code, 'durationMonths', cs.duration_months, 'durationDays', cs.duration_days,
    'durationLabel', private.duration_label(cs.duration_code, cs.duration_months, cs.duration_days),
    'messageCredits', cs.message_credits,
    'status', private.subscription_status(cs),
    'termsComplete', cs.duration_code is not null and cs.plan_name is not null and cs.price is not null,
    'panelCreatedOn', cs.panel_created_on, 'startedOn', cs.started_on, 'expiresOn', cs.renews_on,
    'daysLeft', case when cs.started_on is not null and cs.renews_on is not null then greatest(cs.renews_on - private.office_today(), 0) end,
    'activatedAt', cs.activation_confirmed_at, 'activatedBy', (select p.full_name from public.profiles p where p.id = cs.activated_by),
    'cycle', cs.subscription_cycle)
  from public.crm_services s where s.code = cs.service_code
$$;
revoke all on function private.subscription_json(public.customer_services) from public, anon, authenticated;

-- Messages: the package (or the credits Sales entered), what the provider data says was used, and what is left.
create or replace function private.metric_num(m jsonb, k text)
returns numeric language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(m -> k) = 'number' then (m ->> k)::numeric end
$$;
revoke all on function private.metric_num(jsonb, text) from public, anon, authenticated;

create or replace function private.service_message_usage(p_customer uuid, p_service text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  u public.service_usage;
  v_total numeric;
  v_used numeric;
  v_reported boolean := false;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  select * into u from public.service_usage x
   where x.customer_id = p_customer and x.service_code = p_service and x.kind in ('WHATSAPP', 'RCS', 'VOICE') and x.period = ''
   order by x.updated_at desc limit 1;
  if u.id is not null then
    v_total := case u.kind when 'WHATSAPP' then nullif(coalesce(private.metric_num(u.metrics, 'packageMessages'), 0) + coalesce(private.metric_num(u.metrics, 'extraMessages'), 0), 0)
                           else private.metric_num(u.metrics, 'packageMessages') end;
    v_used := private.metric_num(u.metrics, 'sent');
    v_reported := v_used is not null;
  end if;
  v_total := coalesce(v_total, cs.message_credits);
  if v_total is null or v_total <= 0 then
    return null;
  end if;
  v_used := least(greatest(coalesce(v_used, 0), 0), v_total);
  return jsonb_build_object('total', v_total, 'used', v_used, 'remaining', v_total - v_used, 'percent', round(v_used / v_total * 100, 1),
                            'asOf', u.as_of, 'reported', v_reported);
end $$;
revoke all on function private.service_message_usage(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sales: the plan, duration, amount and message credits of each selected service (never a date)
-- ---------------------------------------------------------------------------
create or replace function public.set_subscription_terms(p_customer uuid, p_service text, p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  d record;
  v_plan text := left(nullif(btrim(coalesce(p_terms ->> 'plan', '')), ''), 120);
  v_panel text := left(nullif(btrim(coalesce(p_terms ->> 'panel', '')), ''), 120);
  v_amount numeric;
  v_credits bigint;
  v_old jsonb;
begin
  if not private.may_set_subscription_terms(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then
    raise exception 'VALIDATION_ERROR: Enter the subscription plan, duration and amount.' using errcode = 'P0001';
  end if;
  if p_terms ?| array['startedOn', 'expiresOn', 'startDate', 'expiryDate', 'activationDate', 'panelCreatedOn'] then
    raise exception 'FORBIDDEN: The start and expiry dates are set when the panel is activated, not by Sales.' using errcode = '42501';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if cs.started_on is not null or cs.subscription_cycle > 0 then
    raise exception 'CONFLICT: This subscription has started; its terms are fixed. Use a renewal for a new term.' using errcode = 'P0001';
  end if;
  if v_plan is null then
    raise exception 'VALIDATION_ERROR: Enter the subscription plan.' using errcode = 'P0001';
  end if;
  select * into d from private.parse_duration(p_terms);
  begin
    v_amount := nullif(btrim(coalesce(p_terms ->> 'amount', '')), '')::numeric;
    v_credits := nullif(btrim(coalesce(p_terms ->> 'messageCredits', '')), '')::bigint;
  exception when others then
    raise exception 'VALIDATION_ERROR: The amount and the message credits must be numbers (credits in whole messages).' using errcode = 'P0001';
  end;
  if v_amount is null or v_amount < 0 then
    raise exception 'VALIDATION_ERROR: Enter the subscription amount.' using errcode = 'P0001';
  end if;
  if v_credits is not null and v_credits < 0 then
    raise exception 'VALIDATION_ERROR: The message credits cannot be negative.' using errcode = 'P0001';
  end if;

  v_old := private.subscription_json(cs);
  update public.customer_services
     set plan_name = v_plan, price = v_amount, platform = v_panel, message_credits = v_credits,
         duration_code = d.code, duration_months = d.months, duration_days = d.days,
         billing_cycle = private.duration_label(d.code, d.months, d.days)
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  insert into public.subscription_history (customer_id, service_code, action, old_values, new_values, actor_id)
  values (p_customer, p_service, 'TERMS_SET', v_old - 'activatedAt', private.subscription_json(cs) - 'activatedAt', (select private.my_id()));
  perform private.write_audit('SUBSCRIPTION_TERMS_SET', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'plan', v_plan, 'duration', private.duration_label(d.code, d.months, d.days), 'amount', v_amount, 'messageCredits', v_credits));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_TERMS', format('%s: %s plan, %s, %s', p_service, v_plan, private.duration_label(d.code, d.months, d.days), v_amount));
  return private.subscription_json(cs);
end $$;
revoke all on function public.set_subscription_terms(uuid, text, jsonb) from public, anon;
grant execute on function public.set_subscription_terms(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The team: confirm that the panel was created and activated. This is the moment the subscription starts.
-- ---------------------------------------------------------------------------
create or replace function private.queue_activation_email(p_customer uuid, p_service text, p_cycle integer, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job uuid;
begin
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
  values (p_customer, 'EMAIL', 'SUBSCRIPTION_ACTIVATED', p_key,
          jsonb_build_object('service', p_service, 'cycle', p_cycle), (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  return v_job;
end $$;
revoke all on function private.queue_activation_email(uuid, text, integer, text) from public, anon, authenticated;

create or replace function public.confirm_subscription_activation(
  p_customer uuid, p_service text, p_activation_date date, p_panel_created_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  v_problem text;
  v_panel date;
  v_expiry date;
  v_today date := private.office_today();
  v_me uuid := (select private.my_id());
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  -- a repeated request (a double click, a retry, a second employee) changes nothing and never moves the start date
  if cs.started_on is not null or cs.subscription_cycle > 0 then
    return jsonb_build_object('alreadyActive', true, 'subscription', private.subscription_json(cs));
  end if;
  if cs.duration_code is null then
    raise exception 'VALIDATION_ERROR: The subscription duration has not been set for this service. Ask Sales to enter the plan, duration and amount first.' using errcode = 'P0001';
  end if;
  v_problem := private.service_ready_problem(p_customer, p_service);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
  if p_activation_date is null then
    raise exception 'VALIDATION_ERROR: Enter the subscription activation date.' using errcode = 'P0001';
  end if;
  if p_activation_date > v_today then
    raise exception 'VALIDATION_ERROR: The activation date cannot be in the future. Confirm it once the panel is actually active.' using errcode = 'P0001';
  end if;
  if p_activation_date < date '2020-01-01' then
    raise exception 'VALIDATION_ERROR: Enter a valid activation date.' using errcode = 'P0001';
  end if;
  v_panel := coalesce(p_panel_created_on, p_activation_date);
  if v_panel > p_activation_date then
    raise exception 'VALIDATION_ERROR: The panel creation date cannot be after the activation date.' using errcode = 'P0001';
  end if;
  v_expiry := private.subscription_expiry(p_activation_date, cs.duration_months, cs.duration_days);

  update public.customer_services
     set started_on = p_activation_date, renews_on = v_expiry, panel_created_on = v_panel, activated_by = v_me, activation_confirmed_at = now(),
         subscription_cycle = 1, setup_status = 'READY', setup_updated_at = now(), setup_updated_by = v_me, setup_note = coalesce(v_note, setup_note),
         setup_completed_at = now(), service_status = 'LIVE', activated_at = coalesce(activated_at, now())
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  insert into public.subscription_cycles (customer_id, service_code, cycle_no, kind, plan_name, price, duration_code, duration_months, duration_days,
                                          message_credits, panel_created_on, started_on, expires_on, activated_by)
  values (p_customer, p_service, 1, 'INITIAL', cs.plan_name, cs.price, cs.duration_code, cs.duration_months, cs.duration_days,
          cs.message_credits, v_panel, p_activation_date, v_expiry, v_me);
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, new_values, reason, actor_id)
  values (p_customer, p_service, 1, 'ACTIVATED', private.subscription_json(cs), v_note, v_me);
  perform private.write_audit('SUBSCRIPTION_ACTIVATED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'startedOn', p_activation_date, 'expiresOn', v_expiry, 'panelCreatedOn', v_panel,
                       'duration', private.duration_label(cs.duration_code, cs.duration_months, cs.duration_days)));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_ACTIVATED',
    format('%s: subscription started %s, expires %s', sv.name, p_activation_date, v_expiry));
  perform private.client_notify(p_customer, 'SUBSCRIPTION_ACTIVE', format('%s subscription is active', sv.name),
    format('Your subscription started on %s and runs until %s.', to_char(p_activation_date, 'DD Mon YYYY'), to_char(v_expiry, 'DD Mon YYYY')),
    'service', null, format('SUB|%s|%s|%s|START', p_customer, p_service, 1));
  -- the panel activation e-mail: queued only now, once per cycle
  perform private.queue_activation_email(p_customer, p_service, 1, format('SUBACT|%s|%s|%s', p_customer, p_service, 1));
  return jsonb_build_object('alreadyActive', false, 'subscription', private.subscription_json(cs));
end $$;
revoke all on function public.confirm_subscription_activation(uuid, text, date, date, text) from public, anon;
grant execute on function public.confirm_subscription_activation(uuid, text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The heads: correct a confirmed date (a reason is required; old and new values are kept)
-- ---------------------------------------------------------------------------
create or replace function public.correct_subscription_dates(
  p_customer uuid, p_service text, p_activation_date date, p_panel_created_on date, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_old jsonb;
  v_expiry date;
  v_panel date;
  v_today date := private.office_today();
begin
  if not private.may_correct_subscription(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'VALIDATION_ERROR: Give the reason for correcting the dates (at least a few words).' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if cs.subscription_cycle < 1 or cs.started_on is null then
    raise exception 'CONFLICT: This subscription has not started yet; confirm the activation instead.' using errcode = 'P0001';
  end if;
  if p_activation_date is null or p_activation_date > v_today or p_activation_date < date '2020-01-01' then
    raise exception 'VALIDATION_ERROR: Enter a valid activation date (not in the future).' using errcode = 'P0001';
  end if;
  v_panel := coalesce(p_panel_created_on, cs.panel_created_on, p_activation_date);
  if v_panel > p_activation_date then
    raise exception 'VALIDATION_ERROR: The panel creation date cannot be after the activation date.' using errcode = 'P0001';
  end if;
  if p_activation_date is not distinct from cs.started_on and v_panel is not distinct from cs.panel_created_on then
    raise exception 'CONFLICT: Those are the dates already recorded.' using errcode = 'P0001';
  end if;
  v_old := private.subscription_json(cs);
  v_expiry := private.subscription_expiry(p_activation_date, cs.duration_months, cs.duration_days);
  update public.customer_services
     set started_on = p_activation_date, renews_on = v_expiry, panel_created_on = v_panel
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  update public.subscription_cycles
     set started_on = p_activation_date, expires_on = v_expiry, panel_created_on = v_panel
   where customer_id = p_customer and service_code = p_service and cycle_no = cs.subscription_cycle;
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, old_values, new_values, reason, actor_id)
  values (p_customer, p_service, cs.subscription_cycle, 'DATES_CORRECTED', v_old, private.subscription_json(cs), v_reason, (select private.my_id()));
  perform private.write_audit('SUBSCRIPTION_DATES_CORRECTED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'from', jsonb_build_object('startedOn', v_old -> 'startedOn', 'expiresOn', v_old -> 'expiresOn'),
                       'to', jsonb_build_object('startedOn', p_activation_date, 'expiresOn', v_expiry), 'reason', v_reason));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_DATES_CORRECTED',
    format('%s: subscription dates corrected to %s - %s (%s)', p_service, p_activation_date, v_expiry, v_reason));
  perform private.client_notify(p_customer, 'SUBSCRIPTION_UPDATED', 'Your subscription dates were updated',
    format('Your subscription now runs from %s to %s.', to_char(p_activation_date, 'DD Mon YYYY'), to_char(v_expiry, 'DD Mon YYYY')),
    'service', null, format('SUB|%s|%s|%s|FIX|%s', p_customer, p_service, cs.subscription_cycle, extract(epoch from now())::bigint));
  return private.subscription_json(cs);
end $$;
revoke all on function public.correct_subscription_dates(uuid, text, date, date, text) from public, anon;
grant execute on function public.correct_subscription_dates(uuid, text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Renewal: needs a verified payment; the old cycle is kept; a new cycle starts
--     Policy: while the subscription is still running the renewal CONTINUES from the old expiry date (no days lost, none double counted);
--     once it has lapsed it starts on the activation date the team confirms. The new expiry is calculated from that start.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_subscription_renewal(
  p_customer uuid, p_service text, p_payment uuid, p_start date default null, p_terms jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  pay public.customer_payments;
  d record;
  v_dcode text;
  v_dmonths integer;
  v_ddays integer;
  v_old jsonb;
  v_start date;
  v_expiry date;
  v_cycle integer;
  v_today date := private.office_today();
  v_me uuid := (select private.my_id());
  v_plan text;
  v_amount numeric;
  v_credits bigint;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if cs.subscription_cycle < 1 or cs.started_on is null then
    raise exception 'CONFLICT: This subscription has not started yet; confirm the activation first.' using errcode = 'P0001';
  end if;
  if p_payment is null then
    raise exception 'VALIDATION_ERROR: Choose the verified payment that pays for this renewal.' using errcode = 'P0001';
  end if;
  select * into pay from public.customer_payments where id = p_payment and customer_id = p_customer;
  if pay.id is null or pay.status <> 'VERIFIED' then
    raise exception 'VALIDATION_ERROR: A renewal needs a payment of this customer that Accounts has verified.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.subscription_cycles x where x.payment_id = p_payment) then
    -- the same payment cannot extend the subscription twice: a repeated request changes nothing
    return jsonb_build_object('alreadyRenewed', true, 'subscription', private.subscription_json(cs));
  end if;
  if p_terms is not null and jsonb_typeof(p_terms) = 'object' and p_terms ?| array['startedOn', 'expiresOn', 'startDate', 'expiryDate'] then
    raise exception 'FORBIDDEN: The expiry date is calculated; enter only the duration.' using errcode = '42501';
  end if;
  -- the duration of the new term: the same as the last one unless the renewal names another
  if p_terms is not null and p_terms ? 'durationCode' then
    select x.code, x.months, x.days into v_dcode, v_dmonths, v_ddays from private.parse_duration(p_terms) x;
  else
    v_dcode := cs.duration_code; v_dmonths := cs.duration_months; v_ddays := cs.duration_days;
  end if;
  v_plan := coalesce(left(nullif(btrim(coalesce(p_terms ->> 'plan', '')), ''), 120), cs.plan_name);
  begin
    v_amount := coalesce(nullif(btrim(coalesce(p_terms ->> 'amount', '')), '')::numeric, cs.price);
    v_credits := coalesce(nullif(btrim(coalesce(p_terms ->> 'messageCredits', '')), '')::bigint, cs.message_credits);
  exception when others then
    raise exception 'VALIDATION_ERROR: The amount and the message credits must be numbers.' using errcode = 'P0001';
  end;
  if v_amount is not null and v_amount < 0 then
    raise exception 'VALIDATION_ERROR: The amount cannot be negative.' using errcode = 'P0001';
  end if;

  if cs.renews_on >= v_today then
    if p_start is not null and p_start <> cs.renews_on then
      raise exception 'VALIDATION_ERROR: The subscription is still running, so the renewal continues from its expiry date (%).', to_char(cs.renews_on, 'DD Mon YYYY') using errcode = 'P0001';
    end if;
    v_start := cs.renews_on;
  else
    v_start := coalesce(p_start, v_today);
    if v_start > v_today or v_start < date '2020-01-01' then
      raise exception 'VALIDATION_ERROR: Enter the date the renewed panel was activated (not in the future).' using errcode = 'P0001';
    end if;
  end if;
  v_expiry := private.subscription_expiry(v_start, v_dmonths, v_ddays);
  v_cycle := cs.subscription_cycle + 1;
  v_old := private.subscription_json(cs);

  update public.subscription_cycles set status = 'ENDED', ended_at = now()
   where customer_id = p_customer and service_code = p_service and status = 'ACTIVE';
  update public.customer_services
     set started_on = v_start, renews_on = v_expiry, subscription_cycle = v_cycle, plan_name = v_plan, price = v_amount, message_credits = v_credits,
         duration_code = v_dcode, duration_months = v_dmonths, duration_days = v_ddays, billing_cycle = private.duration_label(v_dcode, v_dmonths, v_ddays),
         panel_created_on = least(coalesce(panel_created_on, v_start), v_start),
         service_status = 'LIVE', activated_by = v_me, activation_confirmed_at = now()
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  insert into public.subscription_cycles (customer_id, service_code, cycle_no, kind, plan_name, price, duration_code, duration_months, duration_days,
                                          message_credits, panel_created_on, started_on, expires_on, activated_by, payment_id)
  values (p_customer, p_service, v_cycle, 'RENEWAL', cs.plan_name, cs.price, cs.duration_code, cs.duration_months, cs.duration_days,
          cs.message_credits, cs.panel_created_on, v_start, v_expiry, v_me, p_payment);
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, old_values, new_values, reason, actor_id)
  values (p_customer, p_service, v_cycle, 'RENEWED', v_old, private.subscription_json(cs), v_note, v_me);
  perform private.write_audit('SUBSCRIPTION_RENEWED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'cycle', v_cycle, 'startedOn', v_start, 'expiresOn', v_expiry, 'payment', p_payment));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_RENEWED', format('%s: renewed from %s until %s', sv.name, v_start, v_expiry));
  perform private.client_notify(p_customer, 'SUBSCRIPTION_RENEWED', format('%s subscription renewed', sv.name),
    format('Your subscription now runs from %s until %s.', to_char(v_start, 'DD Mon YYYY'), to_char(v_expiry, 'DD Mon YYYY')),
    'service', null, format('SUB|%s|%s|%s|START', p_customer, p_service, v_cycle));
  return jsonb_build_object('alreadyRenewed', false, 'subscription', private.subscription_json(cs));
end $$;
revoke all on function public.confirm_subscription_renewal(uuid, text, uuid, date, jsonb, text) from public, anon;
grant execute on function public.confirm_subscription_renewal(uuid, text, uuid, date, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The activation e-mail: what the sender needs (read at the moment of sending), and a retry
-- ---------------------------------------------------------------------------
create or replace function public.subscription_mail_data(p_customer uuid, p_service text, p_cycle integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'serviceName', s.name, 'plan', y.plan_name, 'durationLabel', private.duration_label(y.duration_code, y.duration_months, y.duration_days),
    'startedOn', y.started_on, 'expiresOn', y.expires_on, 'messageCredits', y.message_credits, 'panel', cs.platform, 'panelUrl', cs.panel_url,
    'panelAccount', cs.panel_account,
    'hasLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer),
    'mustSetPassword', exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer and a.password_changed_at is null))
    from public.subscription_cycles y
    join public.customer_services cs on cs.customer_id = y.customer_id and cs.service_code = y.service_code
    join public.crm_services s on s.code = y.service_code
   where y.customer_id = p_customer and y.service_code = p_service and y.cycle_no = p_cycle
$$;
revoke all on function public.subscription_mail_data(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.subscription_mail_data(uuid, text, integer) to service_role;

create or replace function public.resend_activation_email(p_customer uuid, p_service text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  j public.automation_jobs;
  v_key text;
  n integer;
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null or cs.subscription_cycle < 1 then
    raise exception 'CONFLICT: The panel activation e-mail is sent once the subscription has started.' using errcode = 'P0001';
  end if;
  v_key := format('SUBACT|%s|%s|%s', p_customer, p_service, cs.subscription_cycle);
  select * into j from public.automation_jobs where dedupe_key = v_key or dedupe_key like v_key || '|%' order by created_at desc limit 1 for update;
  if j.id is null then
    perform private.queue_activation_email(p_customer, p_service, cs.subscription_cycle, v_key);
  elsif j.status in ('QUEUED', 'SENDING') then
    raise exception 'CONFLICT: The e-mail is already on its way.' using errcode = 'P0001';
  elsif j.status in ('FAILED', 'SKIPPED', 'CANCELLED') then
    update public.automation_jobs set status = 'QUEUED', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null where id = j.id;
  elsif j.sent_at is not null and j.sent_at > now() - interval '10 minutes' then
    raise exception 'CONFLICT: The e-mail was sent a moment ago. Wait before sending it again.' using errcode = 'P0001';
  else
    select count(*) + 1 into n from public.automation_jobs where dedupe_key = v_key or dedupe_key like v_key || '|%';
    perform private.queue_activation_email(p_customer, p_service, cs.subscription_cycle, v_key || '|' || n);
  end if;
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, actor_id)
  values (p_customer, p_service, cs.subscription_cycle, 'EMAIL_RESENT', (select private.my_id()));
  perform private.write_audit('SUBSCRIPTION_EMAIL_RESENT', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('service', p_service));
  return jsonb_build_object('queued', true);
end $$;
revoke all on function public.resend_activation_email(uuid, text) from public, anon;
grant execute on function public.resend_activation_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. What the team sees
-- ---------------------------------------------------------------------------
create or replace function public.subscription_overview(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_terms boolean := private.may_set_subscription_terms(p_customer);
  v_correct boolean := private.may_correct_subscription(p_customer);
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer) or private.may_work_any_service(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'services', coalesce((
      select jsonb_agg(private.subscription_json(cs) || jsonb_build_object(
        'canSetTerms', v_terms and cs.started_on is null and cs.subscription_cycle = 0,
        'canActivate', private.may_set_service_setup(p_customer, cs.service_code) and cs.started_on is null and cs.subscription_cycle = 0,
        'blocker', case when cs.started_on is not null then null
                        when cs.duration_code is null then 'The subscription duration has not been set (Sales enters the plan, duration and amount).'
                        else private.service_ready_problem(p_customer, cs.service_code) end,
        'canCorrect', v_correct and cs.subscription_cycle > 0,
        'canRenew', private.may_set_service_setup(p_customer, cs.service_code) and cs.subscription_cycle > 0,
        'messages', private.service_message_usage(p_customer, cs.service_code),
        'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'attempts', j.attempts, 'recipient', j.recipient)
                    from public.automation_jobs j
                   where j.customer_id = p_customer and j.stage = 'SUBSCRIPTION_ACTIVATED' and j.context ->> 'service' = cs.service_code
                   order by j.created_at desc limit 1),
        'canResendEmail', private.may_set_service_setup(p_customer, cs.service_code) and cs.subscription_cycle > 0)
        order by cs.created_at, cs.service_code)
        from public.customer_services cs where cs.customer_id = p_customer), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'service', h.service_code, 'cycle', h.cycle_no, 'action', h.action, 'old', h.old_values, 'new', h.new_values,
                                          'reason', h.reason, 'by', (select p.full_name from public.profiles p where p.id = h.actor_id), 'at', h.created_at)
                       order by h.created_at desc)
        from (select * from public.subscription_history x where x.customer_id = p_customer order by x.created_at desc limit 40) h), '[]'::jsonb),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object('service', y.service_code, 'cycle', y.cycle_no, 'kind', y.kind, 'status', y.status, 'plan', y.plan_name,
                                          'durationLabel', private.duration_label(y.duration_code, y.duration_months, y.duration_days),
                                          'startedOn', y.started_on, 'expiresOn', y.expires_on) order by y.service_code, y.cycle_no)
        from public.subscription_cycles y where y.customer_id = p_customer), '[]'::jsonb),
    'payments', case when private.may_work_any_service(p_customer) then coalesce((
      select jsonb_agg(jsonb_build_object('id', pm.id, 'amount', pm.amount, 'paidAt', pm.paid_at, 'method', pm.method, 'used', exists (select 1 from public.subscription_cycles y where y.payment_id = pm.id))
                       order by pm.paid_at desc)
        from public.customer_payments pm where pm.customer_id = p_customer and pm.status = 'VERIFIED'), '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.subscription_overview(uuid) from public, anon;
grant execute on function public.subscription_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. What the client sees: My Subscription (read only)
-- ---------------------------------------------------------------------------
create or replace function public.client_subscriptions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'service', j ->> 'service', 'serviceName', j ->> 'serviceName', 'plan', j -> 'plan', 'durationLabel', j -> 'durationLabel',
        'status', j ->> 'status', 'panelCreated', (j ->> 'panelCreatedOn') is not null, 'panelCreatedOn', j -> 'panelCreatedOn',
        'startedOn', j -> 'startedOn', 'expiresOn', j -> 'expiresOn', 'daysLeft', j -> 'daysLeft',
        'messages', private.service_message_usage(v_customer, j ->> 'service'),
        'messageCredits', j -> 'messageCredits')
      order by cs.created_at, cs.service_code)
      from public.customer_services cs, lateral (select private.subscription_json(cs) as j) x
     where cs.customer_id = v_customer), '[]'::jsonb);
end $$;
revoke all on function public.client_subscriptions() from public, anon;
grant execute on function public.client_subscriptions() to authenticated;

-- the section is always open (it is where a client sees that the subscription has not started yet)
create or replace function private.client_access(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  s text;
  v_sections jsonb := '{}'::jsonb;
  v_reason text;
begin
  foreach s in array array['overview', 'journey', 'services', 'subscription', 'campaigns', 'explore', 'plans', 'calendar', 'documents', 'invoices', 'tickets', 'chat', 'notifications', 'docs'] loop
    v_reason := private.client_gate(f, s);
    v_sections := v_sections || jsonb_build_object(s, jsonb_build_object('enabled', v_reason is null, 'reason', v_reason));
  end loop;
  return jsonb_build_object('sections', v_sections);
end $$;
revoke all on function private.client_access(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. Message usage alerts: 70 / 80 / 90 / 100 % (the thresholds are settings), once per subscription cycle and threshold
-- ---------------------------------------------------------------------------
create table if not exists public.usage_alert_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  thresholds integer[] not null default array[70, 80, 90, 100],
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (cardinality(thresholds) between 1 and 8)
);
insert into public.usage_alert_settings (id) values (true) on conflict (id) do nothing;
alter table public.usage_alert_settings enable row level security;
revoke all on public.usage_alert_settings from public, anon, authenticated;

-- one row per customer, service, cycle (identified by its expiry date: a renewal or a corrected date is a new cycle) and threshold
create table if not exists public.usage_alert_log (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null,
  cycle_key text not null,
  threshold integer not null,
  percent numeric(6,1) not null,
  notified boolean not null,
  created_at timestamptz not null default now(),
  primary key (customer_id, service_code, cycle_key, threshold)
);
alter table public.usage_alert_log enable row level security;
revoke all on public.usage_alert_log from public, anon, authenticated;

create or replace function public.usage_alert_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.usage_alert_settings;
begin
  if (select private.my_id()) is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select * into s from public.usage_alert_settings where id;
  return jsonb_build_object('enabled', s.enabled, 'thresholds', to_jsonb(s.thresholds), 'canEdit', private.is_super_admin());
end $$;
revoke all on function public.usage_alert_settings_get() from public, anon;
grant execute on function public.usage_alert_settings_get() to authenticated;

create or replace function public.set_usage_alert_settings(p_enabled boolean, p_thresholds integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v integer[];
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change this.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v from unnest(coalesce(p_thresholds, '{}')) t;
  if cardinality(v) not between 1 and 8 or exists (select 1 from unnest(v) t where t not between 1 and 100) then
    raise exception 'VALIDATION_ERROR: Give 1 to 8 percentages between 1 and 100.' using errcode = 'P0001';
  end if;
  update public.usage_alert_settings set enabled = coalesce(p_enabled, enabled), thresholds = v, updated_by = (select private.my_id()), updated_at = now() where id;
  perform private.write_audit('USAGE_ALERT_SETTINGS_CHANGED', 'usage_alert_settings', null, null, null, jsonb_build_object('enabled', p_enabled, 'thresholds', to_jsonb(v)));
  return public.usage_alert_settings_get();
end $$;
revoke all on function public.set_usage_alert_settings(boolean, integer[]) from public, anon;
grant execute on function public.set_usage_alert_settings(boolean, integer[]) to authenticated;

create or replace function private.evaluate_usage_alerts(p_customer uuid, p_service text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.usage_alert_settings;
  cs public.customer_services;
  sv public.crm_services;
  c public.customers;
  u jsonb;
  v_pct numeric;
  v_key text;
  v_top integer;
  t integer;
  v_to uuid;
begin
  select * into s from public.usage_alert_settings where id;
  if not s.enabled then return; end if;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  -- no alert before the subscription has started (a service that has a duration but no activation yet)
  if cs.customer_id is null or (cs.duration_code is not null and cs.started_on is null) then return; end if;
  u := private.service_message_usage(p_customer, p_service);
  if u is null then return; end if;
  v_pct := (u ->> 'percent')::numeric;
  v_key := coalesce(cs.renews_on::text, 'open');
  for t in select x from unnest(s.thresholds) x order by x loop
    if v_pct >= t and not exists (select 1 from public.usage_alert_log l
                                   where l.customer_id = p_customer and l.service_code = p_service and l.cycle_key = v_key and l.threshold = t) then
      insert into public.usage_alert_log (customer_id, service_code, cycle_key, threshold, percent, notified) values (p_customer, p_service, v_key, t, v_pct, false)
      on conflict do nothing;
      v_top := t;
    end if;
  end loop;
  if v_top is null then return; end if;
  -- one message for the highest threshold that was just crossed (a jump from 60 % to 95 % is one alert, not three)
  update public.usage_alert_log set notified = true
   where customer_id = p_customer and service_code = p_service and cycle_key = v_key and threshold = v_top;
  select * into sv from public.crm_services where code = p_service;
  select * into c from public.customers where id = p_customer;
  perform private.client_notify(p_customer, 'USAGE_ALERT', format('%s: %s%% of your messages used', sv.name, v_top),
    format('You have used %s of %s messages (%s%%). %s message%s left. Contact us to add more before they run out.',
           to_char((u ->> 'used')::numeric, 'FM999G999G999'), to_char((u ->> 'total')::numeric, 'FM999G999G999'), v_top,
           to_char((u ->> 'remaining')::numeric, 'FM999G999G999'), case when (u ->> 'remaining')::numeric = 1 then '' else 's' end),
    'service', null, format('USAGE|%s|%s|%s|%s', p_customer, p_service, v_key, v_top));
  for v_to in select distinct x from unnest(array[c.owner_id, private.rm_of(p_customer)]) x where x is not null loop
    perform private.notify(v_to, 'USAGE_ALERT', format('Message usage %s%%: %s', v_top, coalesce(c.company, c.name)),
      format('%s has used %s%% of the %s messages.', sv.name, v_top, sv.name), 'customer', p_customer);
  end loop;
end $$;
revoke all on function private.evaluate_usage_alerts(uuid, text) from public, anon, authenticated;

create or replace function private.tg_service_usage_alerts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('WHATSAPP', 'RCS', 'VOICE') and new.period = '' then
    perform private.evaluate_usage_alerts(new.customer_id, new.service_code);
  end if;
  return null;
end $$;
revoke all on function private.tg_service_usage_alerts() from public, anon, authenticated;
drop trigger if exists service_usage_alerts on public.service_usage;
create trigger service_usage_alerts after insert or update of metrics on public.service_usage
  for each row execute function private.tg_service_usage_alerts();

-- ---------------------------------------------------------------------------
-- 15. Expiry reminders: 15, 7, 3 and 1 day before and ON the expiry date, by e-mail and WhatsApp (the AI calls keep 7, 3 and 1)
--     Each reminder is one row per customer, service, expiry date, stage and channel, so it is sent once per cycle; a renewal or a corrected
--     date is a new expiry date and therefore a new set. The wording of the new stages is DRAFT until the Super Admin approves it.
-- ---------------------------------------------------------------------------
alter table public.subscription_reminders drop constraint if exists subscription_reminders_stage_check;
alter table public.subscription_reminders add constraint subscription_reminders_stage_check check (stage in (15, 7, 3, 1, 0));
alter table public.reminder_message_templates drop constraint if exists reminder_message_templates_stage_check;
alter table public.reminder_message_templates add constraint reminder_message_templates_stage_check check (stage in (15, 7, 3, 1, 0));

insert into public.reminder_message_templates (channel, stage, subject, body) values
  ('EMAIL', 15, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa will expire on {{expiryDate}}, which is {{daysLeft}} days from now.\n\nPlease plan your renewal so that your service continues without a break. Reply to this e-mail or contact our support team and we will help you renew.'),
  ('EMAIL', 0, 'Your {{service}} subscription expires today',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa expires today, {{expiryDate}}.\n\nPlease renew today to keep your service running. Reply to this e-mail or call our support team and we will help right away.'),
  ('WHATSAPP', 15, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires on {{expiryDate}} ({{daysLeft}} days). Please plan your renewal. Reply here and our team will help you.'),
  ('WHATSAPP', 0, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires today ({{expiryDate}}). Please renew today so your service continues. Reply here for help.')
on conflict (channel, stage) do nothing;

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
  if p_channel not in ('EMAIL', 'WHATSAPP') or p_stage not in (15, 7, 3, 1, 0) then
    raise exception 'VALIDATION_ERROR: Choose e-mail or WhatsApp and stage 15, 7, 3, 1 or 0 (the expiry day).' using errcode = 'P0001';
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

  -- AI calls: exactly 7, 3 and 1 day(s) before the expiry date (unchanged).
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

  -- E-mail and WhatsApp: 15, 7, 3 and 1 day before the expiry date and on it. The date is customer_services.renews_on: for a subscription
  -- that is the date calculated from the confirmed activation date, never an account, invoice, payment or document date.
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

notify pgrst, 'reload schema';
