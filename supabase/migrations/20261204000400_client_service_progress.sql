-- Client dashboard: where each purchased service is, in steps that fit that service's journey.
--
--   WhatsApp API / Blue Tick (verified by a Meta Verifier):  order -> documents -> our verification -> Meta verification -> live
--   other services with a Technical Consultant:              order -> documents -> verified -> set-up with our team -> live
--   services our delivery team runs directly:               order -> documents verified -> with our delivery team -> live
--
-- The client reads it through client_service_progress(): their own customer only (private.require_client), only wording written for a
-- client - no staff names, notes, audit records, payment amounts or another customer's data. A service that is already live (or an older
-- customer who never went through these steps) shows every step done; the steps never contradict the status client_services() reports.
-- When a milestone is reached and the client has a login, a client notification is written, which is what the dashboard listens to
-- (Supabase Realtime), so the page updates without a refresh. Notifications are keyed, so a milestone is announced once.
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- 0. Whether a service is live (one definition for the services list and the progress steps)
-- ---------------------------------------------------------------------------
-- The team's explicit word wins (service_status / activated_at, set by Support or by an Excel import). Otherwise a customer who is
-- still in sales or onboarding is "setting up" - except a WhatsApp customer whose Meta verification was recorded as completed - and an
-- established customer (everything sent on, or imported) keeps the status it always had: live.
create or replace function private.client_service_state(p_customer uuid, p_service text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  sv public.crm_services;
  o public.customer_onboarding;
  c public.customers;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  if cs.customer_id is null then
    return 'SETTING_UP';
  end if;
  if cs.service_status is not null then
    return cs.service_status;
  end if;
  if cs.activated_at is not null then
    return 'LIVE';
  end if;
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into sv from public.crm_services where code = p_service;
  if c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING') then
    if sv.requires_technical_consultant and coalesce(o.verification_route, case when sv.requires_meta_verification then 'META' else 'TECHNICAL' end) = 'META'
       and (o.meta_completed_at is not null or o.client_status = 'COMPLETED') then
      return 'LIVE';
    end if;
    return 'SETTING_UP';
  end if;
  -- (before Phase C a WhatsApp customer was live once its status reached COMPLETED; that still holds)
  return case when coalesce(o.client_status = 'COMPLETED' or o.stage = 'COMPLETED', true) then 'LIVE' else 'SETTING_UP' end;
end $$;
revoke all on function private.client_service_state(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. The steps of one service
-- ---------------------------------------------------------------------------
create or replace function private.client_service_progress_one(
  p_customer uuid, p_service text, p_paid boolean, p_paid_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  sv public.crm_services;
  o public.customer_onboarding;
  v_journey text;
  v_status text;
  v_live boolean;
  v_keys text[];
  v_labels text[];
  v_done boolean[];
  v_at timestamptz[];
  v_hint text[];
  v_steps jsonb := '[]'::jsonb;
  v_prev_done boolean := true;
  v_current text := null;
  i integer;
  v_state text;
  v_docs_done boolean;
  v_verified boolean;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  select * into sv from public.crm_services where code = p_service;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if cs.customer_id is null or sv.code is null then
    return null;
  end if;

  -- the same status client_services() reports
  v_status := private.client_service_state(p_customer, p_service);
  v_live := v_status = 'LIVE';

  v_journey := case
    when not sv.requires_technical_consultant then 'DIRECT'
    when coalesce(o.verification_route, case when sv.requires_meta_verification then 'META' else 'TECHNICAL' end) = 'META' then 'META'
    else 'TECHNICAL' end;

  v_docs_done := coalesce(o.forwarded_to_support_at is not null or o.handover_stage <> 'CONSULTANT', false);
  v_verified := coalesce(o.handover_stage <> 'CONSULTANT' or (o.review_state = 'VERIFIED' and o.returned_at is null), false);

  if v_journey = 'META' then
    v_keys   := array['ORDER', 'DOCUMENTS', 'VERIFICATION', 'META', 'LIVE'];
    v_labels := array['Order confirmed', 'Documents received', 'Verification by our team', 'Meta verification', 'Service live'];
    v_done   := array[p_paid, v_docs_done, v_verified, coalesce(o.meta_completed_at is not null or o.client_status = 'COMPLETED', false), v_live];
    v_at     := array[p_paid_at, o.forwarded_to_support_at, o.to_department_head_at, o.meta_completed_at, cs.activated_at];
    v_hint   := array[
      'We confirm your order as soon as your payment is verified.',
      case when o.returned_at is not null then 'Some documents need to be corrected. Our team will contact you.' else 'We are collecting your documents.' end,
      case when coalesce(o.items_rejected, 0) > 0 then 'A document needs to be corrected. Please check your Documents.' else 'Our team is checking your documents.' end,
      'Your application is with Meta. This usually takes about 2-3 weeks.',
      'Your service goes live once everything is complete.'];
  elsif v_journey = 'TECHNICAL' then
    v_keys   := array['ORDER', 'DOCUMENTS', 'VERIFICATION', 'SETUP', 'LIVE'];
    v_labels := array['Order confirmed', 'Documents received', 'Verified by our team', 'Set-up with our team', 'Service live'];
    v_done   := array[p_paid, v_docs_done, v_verified, coalesce(o.handover_stage = 'TEAM_MEMBER', false), v_live];
    v_at     := array[p_paid_at, o.forwarded_to_support_at, o.to_department_head_at, o.assigned_to_member_at, cs.activated_at];
    v_hint   := array[
      'We confirm your order as soon as your payment is verified.',
      case when o.returned_at is not null then 'Some documents need to be corrected. Our team will contact you.' else 'We are collecting your documents.' end,
      case when coalesce(o.items_rejected, 0) > 0 then 'A document needs to be corrected. Please check your Documents.' else 'Our team is checking your documents.' end,
      'A member of our team is setting up your service.',
      'Your service goes live once everything is complete.'];
  else
    v_keys   := array['ORDER', 'DOCUMENTS', 'DELIVERY', 'LIVE'];
    v_labels := array['Order confirmed', 'Documents verified', 'With our delivery team', 'Service live'];
    v_done   := array[p_paid, coalesce(o.customer_id is null or o.items_total = 0 or (o.items_verified >= o.items_total and o.items_rejected = 0), true),
                      cs.sent_to_delivery_at is not null, v_live];
    v_at     := array[p_paid_at, null, cs.sent_to_delivery_at, cs.activated_at];
    v_hint   := array[
      'We confirm your order as soon as your payment is verified.',
      case when coalesce(o.items_rejected, 0) > 0 then 'A document needs to be corrected. Please check your Documents.' else 'We are collecting and checking your documents.' end,
      'Our delivery team will take your order forward.',
      'Your service goes live once everything is complete.'];
  end if;

  for i in 1 .. array_length(v_keys, 1) loop
    if v_live or (v_done[i] and v_prev_done) then
      v_state := 'DONE';
    elsif v_prev_done then
      v_state := 'CURRENT';
      v_current := v_keys[i];
      v_prev_done := false;
    else
      v_state := 'UPCOMING';
      v_prev_done := false;
    end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'key', v_keys[i], 'label', v_labels[i], 'state', v_state,
      'at', case when v_state = 'DONE' then v_at[i] end,
      'hint', case when v_state = 'CURRENT' then v_hint[i] end));
  end loop;

  return jsonb_build_object(
    'code', sv.code, 'name', sv.name, 'status', v_status, 'steps', v_steps,
    'current', case when v_live then null else v_current end,
    'headline', case when v_live then 'Live'
                     else (select s ->> 'label' from jsonb_array_elements(v_steps) s where s ->> 'state' = 'CURRENT' limit 1) end);
end $$;
revoke all on function private.client_service_progress_one(uuid, text, boolean, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. What the client reads
-- ---------------------------------------------------------------------------
create or replace function public.client_service_progress()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  v_paid_at timestamptz;
begin
  select * into c from public.customers where id = v_customer;
  select min(p.verified_at) into v_paid_at from public.customer_payments p where p.customer_id = v_customer and p.status = 'VERIFIED';
  return coalesce((
    select jsonb_agg(private.client_service_progress_one(v_customer, cs.service_code, c.amount_verified > 0, v_paid_at) order by cs.created_at, cs.service_code)
      from public.customer_services cs where cs.customer_id = v_customer), '[]'::jsonb);
end $$;
revoke all on function public.client_service_progress() from public, anon;
grant execute on function public.client_service_progress() to authenticated;

-- the services list reports the same status as the steps (so the two never disagree)
CREATE OR REPLACE FUNCTION public.client_services()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_customer uuid := private.require_client();
  v_complete boolean := true;
  v_plan_id uuid;
  v_plan_name text;
begin
  begin
    execute 'select coalesce(o.client_status = ''COMPLETED'' or o.stage = ''COMPLETED'', true) from public.customer_onboarding o where o.customer_id = $1'
      into v_complete using v_customer;
  exception when undefined_column or undefined_table then
    v_complete := true;
  end;
  v_complete := coalesce(v_complete, true);

  select p.id, p.name into v_plan_id, v_plan_name
    from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id
   where cp.customer_id = v_customer and cp.status = 'ACTIVE'
   order by cp.created_at desc
   limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'category', s.category, 'description', s.description,
      'purchasedAt', coalesce(cs.started_on::timestamptz, cs.created_at), 'activatedAt', cs.activated_at, 'renewsOn', cs.renews_on,
      'status', private.client_service_state(v_customer, cs.service_code),
      'plan', case when v_plan_id is not null and exists (
                select 1 from public.monthly_plan_services ps where ps.plan_id = v_plan_id and ps.service_code = s.code)
              then v_plan_name end,
      'planName', cs.plan_name, 'price', cs.price, 'billingCycle', cs.billing_cycle, 'platform', cs.platform,
      'panelAccount', cs.panel_account,
      'usage', (select jsonb_build_object('kind', u.kind, 'metrics', u.metrics, 'asOf', u.as_of, 'validUntil', u.valid_until)
                  from public.service_usage u where u.customer_id = v_customer and u.service_code = s.code and u.period = ''
                 order by u.updated_at desc limit 1),
      'monthly', (select coalesce(jsonb_agg(jsonb_build_object('month', m.period, 'metrics', m.metrics) order by m.period desc), '[]'::jsonb)
                    from (select * from public.service_usage u where u.customer_id = v_customer and u.service_code = s.code and u.kind = 'MONTHLY'
                           order by u.period desc limit 6) m),
      'campaignCount', (select count(*) from public.service_campaigns sc where sc.customer_id = v_customer and sc.service_code = s.code),
      'details', case when jsonb_typeof(cs.details) = 'object' then cs.details else '{}'::jsonb end)
      order by cs.created_at, s.name)
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   where cs.customer_id = v_customer), '[]'::jsonb);
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Milestones reach the client's dashboard as notifications (once each, only for customers who have a login)
-- ---------------------------------------------------------------------------
create or replace function private.tg_client_progress_onboarding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.customer_client_accounts a where a.customer_id = new.customer_id) then
    return null;
  end if;
  if old.forwarded_to_support_at is null and new.forwarded_to_support_at is not null then
    perform private.client_notify(new.customer_id, 'PROGRESS_DOCUMENTS', 'Documents received',
      'We have received your documents and our team has started checking them.', null, null, format('PROG|docs|%s', new.customer_id));
  end if;
  if old.handover_stage = 'CONSULTANT' and new.handover_stage <> 'CONSULTANT' then
    perform private.client_notify(new.customer_id, 'PROGRESS_VERIFIED', 'Your documents are verified',
      'Our team has verified your documents. We are taking your order forward.', null, null, format('PROG|verified|%s', new.customer_id));
  end if;
  if old.client_status is distinct from 'META_VERIFICATION' and new.client_status = 'META_VERIFICATION' then
    perform private.client_notify(new.customer_id, 'PROGRESS_META', 'Meta verification in progress',
      'Your application has been submitted to Meta. This usually takes about 2-3 weeks.', null, null, format('PROG|meta|%s', new.customer_id));
  end if;
  if old.meta_completed_at is null and new.meta_completed_at is not null then
    perform private.client_notify(new.customer_id, 'PROGRESS_META_DONE', 'Meta verification completed',
      'Meta has completed your verification.', null, null, format('PROG|metadone|%s', new.customer_id));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_progress_onboarding() from public, anon, authenticated;
drop trigger if exists customer_onboarding_client_progress on public.customer_onboarding;
create trigger customer_onboarding_client_progress after update on public.customer_onboarding
  for each row when (old.forwarded_to_support_at is distinct from new.forwarded_to_support_at or old.handover_stage is distinct from new.handover_stage
                     or old.client_status is distinct from new.client_status or old.meta_completed_at is distinct from new.meta_completed_at)
  execute function private.tg_client_progress_onboarding();

create or replace function private.tg_client_progress_service()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if not exists (select 1 from public.customer_client_accounts a where a.customer_id = new.customer_id) then
    return null;
  end if;
  select name into v_name from public.crm_services where code = new.service_code;
  if old.sent_to_delivery_at is null and new.sent_to_delivery_at is not null then
    perform private.client_notify(new.customer_id, 'PROGRESS_DELIVERY', format('%s: with our delivery team', v_name),
      'Our delivery team is taking your order forward.', 'service', null, format('PROG|delivery|%s|%s', new.customer_id, new.service_code));
  end if;
  if (old.activated_at is null and new.activated_at is not null) or (old.service_status is distinct from 'LIVE' and new.service_status = 'LIVE') then
    perform private.client_notify(new.customer_id, 'PROGRESS_LIVE', format('%s is live', v_name),
      'Your service is now live.', 'service', null, format('PROG|live|%s|%s', new.customer_id, new.service_code));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_progress_service() from public, anon, authenticated;
drop trigger if exists customer_services_client_progress on public.customer_services;
create trigger customer_services_client_progress after update on public.customer_services
  for each row when (old.sent_to_delivery_at is distinct from new.sent_to_delivery_at or old.activated_at is distinct from new.activated_at
                     or old.service_status is distinct from new.service_status)
  execute function private.tg_client_progress_service();

notify pgrst, 'reload schema';
