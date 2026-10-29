-- =============================================================================
-- The 2 migrations of the Client Onboarding Journey (payment -> login -> Meta verification -> Relationship Manager -> service setup -> completed),
-- in order. Paste the whole file into the Supabase SQL editor and run it once. Every part is safe to run again; nothing is deleted and nothing is sent.
--   1. 20261209000100_client_onboarding_journey.sql   journey state, stage rules, locked client sections (database-enforced), existing customers kept open
--   2. 20261209000200_client_stage_chat.sql           the client chat: Meta Verifier before Meta verification is completed, Relationship Manager afterwards
-- Needs the earlier migrations (up to 20261208000300) to be in place. Then deploy the app. See docs/CLIENT_ONBOARDING_JOURNEY.md.
-- =============================================================================

-- Client onboarding journey: Payment confirmation -> Client login -> Meta verification -> Relationship Manager -> Service setup -> Completed.
--
-- WHAT EXISTED (read before changing anything)
--   * customer_onboarding (1:1 with the customer): the document checklist, the Technical Consultant review (review_state), the hand-over
--     chain Consultant -> Department Head -> Team Lead -> Team Member (the Team Member is the customer's Relationship Manager), the
--     "client status" used by the e-mail / WhatsApp automations.
--   * customer_client_accounts: the client's Supabase Auth login, created by Accounts (accounts_client_login_begin -> create -> record_client_account,
--     20261205000300 / 20261208000300). The API now runs that same flow by itself when Accounts confirms the payment.
--   * The Meta Verifier role (profiles.is_meta_verifier) and the verification route (customer_onboarding.verification_route META | TECHNICAL).
--   * The client dashboard RPCs (client_*): every one starts with private.require_client(); nothing differed by stage.
--   * One CLIENT chat conversation per customer, whose staff side is decided live from the hand-over (support_member_of / support_lead_of).
--
-- WHAT THIS CHANGES (additive; no table is dropped, nothing is deleted)
--   1. customer_onboarding: the Meta verification status (PENDING, IN_PROGRESS, DOCUMENTS_REQUIRED, REJECTED, COMPLETED) with feedback,
--      timestamps and the assigned Meta Verifier (a Technical Consultant of the customer's department), and onboarding_completed_at.
--      customer_services: setup_status (PENDING, IN_PROGRESS, READY) with who and when.
--   2. private.client_facts / client_access / client_journey: ONE place that works out, from the stored records, where a customer is and which
--      dashboard sections are open. public.client_onboarding_journey() is what the dashboard shows.
--   3. Gating in the database: the client RPCs of a section that is not open yet refuse the call (so a hand-typed URL, a direct API call or a
--      direct PostgREST call all get the same answer). Each gated function is wrapped by public.<name>(), the original lives on as
--      private.open_<name>().
--   4. Staff actions with their own checks: set_meta_verification, assign_meta_verifier, set_service_setup. Completing Meta verification needs
--      every document authorized; a service becomes READY only after its prerequisites; the hand-over to the Department Head needs Meta
--      verification completed; onboarding completes by itself when every mandatory stage is done.
--   5. The Meta status and the existing "Meta verification completed" event (mark_meta_verification_completed, meta_completed_at) are one thing:
--      either path completes both. The hand-over to the Department Head is refused until it is completed.
--   6. Existing customers keep working: whoever already works with the dashboard (a customer, a handed-over onboarding, a completed status)
--      is marked completed and keeps every section.
--
-- Run after 20261208000300_client_credentials.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.customer_onboarding
  add column if not exists meta_status text not null default 'PENDING',
  add column if not exists meta_status_changed_at timestamptz,
  add column if not exists meta_status_auto boolean not null default false,
  add column if not exists meta_started_at timestamptz,
  add column if not exists meta_completed_at timestamptz,
  add column if not exists meta_completed_by uuid references public.profiles (id) on delete set null,
  add column if not exists meta_feedback text,
  add column if not exists meta_verifier_id uuid references public.profiles (id) on delete set null,
  add column if not exists meta_verifier_assigned_at timestamptz,
  add column if not exists meta_verifier_assigned_by uuid references public.profiles (id) on delete set null,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists journey_migrated_at timestamptz;
do $$
begin
  alter table public.customer_onboarding add constraint customer_onboarding_meta_status_check
    check (meta_status in ('PENDING', 'IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.customer_onboarding add constraint customer_onboarding_meta_feedback_check check (length(meta_feedback) <= 1000);
exception when duplicate_object then null;
end $$;
create index if not exists customer_onboarding_meta_verifier_idx on public.customer_onboarding (meta_verifier_id) where meta_verifier_id is not null;

alter table public.customer_services
  add column if not exists setup_status text,
  add column if not exists setup_updated_at timestamptz,
  add column if not exists setup_updated_by uuid references public.profiles (id) on delete set null,
  add column if not exists setup_completed_at timestamptz,
  add column if not exists setup_note text;
do $$
begin
  alter table public.customer_services add constraint customer_services_setup_status_check check (setup_status in ('PENDING', 'IN_PROGRESS', 'READY'));
exception when duplicate_object then null;
end $$;
do $$
begin
  alter table public.customer_services add constraint customer_services_setup_note_check check (length(setup_note) <= 500);
exception when duplicate_object then null;
end $$;

-- A client conversation belongs to one channel: the Relationship Manager's (every existing conversation) or the Meta verification's.
alter table public.chat_conversations add column if not exists channel text not null default 'RM' check (channel in ('RM', 'META'));

-- The client can be told about the journey in the notification bell.
alter table public.client_notifications drop constraint if exists client_notifications_entity_type_check;
alter table public.client_notifications add constraint client_notifications_entity_type_check
  check (entity_type in ('invoice', 'service', 'plan', 'ticket', 'service_request', 'plan_request', 'addon', 'announcement', 'calendar', 'document', 'chat', 'journey'));

-- ---------------------------------------------------------------------------
-- 2. Existing customers: what they already had stays (run once; the marker makes a second run do nothing)
-- ---------------------------------------------------------------------------
-- A service is READY when the old rule called it live: a status of LIVE (or one that was live once), an activation date, no onboarding record
-- (imported customers) or an onboarding already completed.
update public.customer_services cs
   set setup_status = case
         when cs.service_status in ('LIVE', 'PAUSED', 'EXPIRED', 'CANCELLED') or cs.activated_at is not null then 'READY'
         when o.customer_id is null then 'READY'
         when o.client_status = 'COMPLETED' or o.stage = 'COMPLETED' then 'READY'
         else 'PENDING' end,
       setup_completed_at = case
         when cs.service_status in ('LIVE', 'PAUSED', 'EXPIRED', 'CANCELLED') or cs.activated_at is not null or o.customer_id is null
              or o.client_status = 'COMPLETED' or o.stage = 'COMPLETED' then coalesce(cs.activated_at, cs.created_at) end
  from public.customers c
  left join public.customer_onboarding o on o.customer_id = c.id
 where c.id = cs.customer_id and cs.setup_status is null;

-- New services start PENDING unless they are already live (an import, an add-on the consultant approved) or belong to a customer.
create or replace function private.tg_customer_services_setup_default()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.setup_status is null then
    new.setup_status := case
      when new.activated_at is not null or new.service_status in ('LIVE', 'PAUSED', 'EXPIRED', 'CANCELLED') then 'READY'
      when (select c.lifecycle_stage from public.customers c where c.id = new.customer_id) = 'CUSTOMER'
           and not exists (select 1 from public.customer_onboarding o where o.customer_id = new.customer_id and o.onboarding_completed_at is null) then 'READY'
      else 'PENDING' end;
    if new.setup_status = 'READY' then
      new.setup_completed_at := coalesce(new.setup_completed_at, new.activated_at, now());
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_customer_services_setup_default() from public, anon, authenticated;
drop trigger if exists customer_services_setup_default on public.customer_services;
create trigger customer_services_setup_default before insert on public.customer_services
  for each row execute function private.tg_customer_services_setup_default();
alter table public.customer_services alter column setup_status set not null;

-- ---------------------------------------------------------------------------
-- 3. Who is who
-- ---------------------------------------------------------------------------
-- Does the customer go through Meta verification? Yes when any of its services is verified by Meta (the META route) or needs the Technical Consultant.
create or replace function private.meta_required(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.onboarding_route(p_customer) = 'META' or private.customer_journey(p_customer) in ('TECHNICAL', 'MIXED')
$$;
revoke all on function private.meta_required(uuid) from public, anon, authenticated;

-- May this employee be the Meta Verifier of the customer? An active Meta Verifier of the customer's department on the META route,
-- an active Technical Consultant of it on the other route (the person who verifies the documents there).
create or replace function private.is_verifier_for(p_profile uuid, p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.profiles p on p.department_id = c.department_id and p.status = 'ACTIVE'
     where c.id = p_customer and p.id = p_profile
       and case when private.onboarding_route(p_customer) = 'META' then p.is_meta_verifier else p.is_technical_consultant end)
$$;
revoke all on function private.is_verifier_for(uuid, uuid) from public, anon, authenticated;

-- The assigned Meta Verifier, when still an active employee.
create or replace function private.meta_verifier_of(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.customer_onboarding o join public.profiles p on p.id = o.meta_verifier_id
   where o.customer_id = p_customer and p.status = 'ACTIVE'
$$;
revoke all on function private.meta_verifier_of(uuid) from public, anon, authenticated;

-- The Relationship Manager: the Team Member the customer was handed to (only while still active).
create or replace function private.rm_of(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = private.support_member_of(p_customer) and p.status = 'ACTIVE'
$$;
revoke all on function private.rm_of(uuid) from public, anon, authenticated;

create or replace function private.rm_lead_of(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.id = private.support_lead_of(p_customer) and p.status = 'ACTIVE'
$$;
revoke all on function private.rm_lead_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Facts, access and the journey (one definition, used by the screen, the gates and the chat)
-- ---------------------------------------------------------------------------
-- The journey applies to a customer that is still onboarding. Customers without an onboarding record that are already customers
-- (imports, older customers) and customers whose onboarding is completed are outside it: every section is open.
create or replace function private.client_facts(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  v_applies boolean;
  v_required boolean;
  v_pay boolean;
  v_login boolean;
  v_meta text;
  v_meta_done boolean;
  v_rm uuid;
  v_lead uuid;
  v_rm_needed boolean;
  v_rm_done boolean;
  v_total integer;
  v_ready integer;
begin
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if c.id is null then
    return jsonb_build_object('applies', false);
  end if;
  -- Still onboarding: an unfinished onboarding record of a customer whose payment was confirmed through Accounts (or who is not a customer
  -- yet). A customer record that became a customer without it (imports, older customers) is outside the journey.
  v_applies := case when o.customer_id is not null
                    then o.onboarding_completed_at is null and (c.lifecycle_stage <> 'CUSTOMER' or o.accounts_confirmed_at is not null)
                    else c.lifecycle_stage <> 'CUSTOMER' end;
  v_required := private.meta_required(p_customer);
  -- outside the journey (an older or imported customer, or a completed onboarding) nothing is waiting for anything
  v_pay := not v_applies or (o.customer_id is not null and o.accounts_confirmed_at is not null);
  v_login := exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer);
  v_meta := case when o.meta_completed_at is not null then 'COMPLETED' else coalesce(o.meta_status, 'PENDING') end;
  v_meta_done := not v_applies or not v_required or v_meta = 'COMPLETED';
  v_rm := private.rm_of(p_customer);
  v_lead := private.rm_lead_of(p_customer);
  v_rm_needed := v_required or v_rm is not null;
  v_rm_done := not v_applies or not v_rm_needed or v_rm is not null;
  select count(*), count(*) filter (where cs.setup_status = 'READY') into v_total, v_ready
    from public.customer_services cs where cs.customer_id = p_customer;
  return jsonb_build_object(
    'applies', v_applies, 'payment', v_pay, 'login', v_login, 'metaRequired', v_required, 'meta', v_meta, 'metaDone', v_meta_done,
    'rm', v_rm, 'lead', v_lead, 'rmNeeded', v_rm_needed, 'rmDone', v_rm_done, 'servicesTotal', v_total, 'servicesReady', v_ready,
    'servicesDone', v_total > 0 and v_ready = v_total, 'completed', o.onboarding_completed_at is not null);
end $$;
revoke all on function private.client_facts(uuid) from public, anon, authenticated;

-- Why a section is closed (null = open). The texts are what the dashboard shows beside the disabled item.
create or replace function private.client_gate(f jsonb, p_section text)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if not coalesce((f ->> 'applies')::boolean, false) then
    return null;
  end if;
  if p_section in ('tickets', 'services', 'campaigns', 'calendar') then
    if not coalesce((f ->> 'payment')::boolean, false) then
      return 'Available after your payment is confirmed.';
    elsif not coalesce((f ->> 'metaDone')::boolean, false) then
      return 'Available after Meta verification is completed.';
    elsif not coalesce((f ->> 'rmDone')::boolean, false) then
      return 'Available after your Relationship Manager is assigned.';
    elsif p_section <> 'tickets' and coalesce((f ->> 'servicesReady')::int, 0) = 0 then
      return 'Available after service setup is completed.';
    end if;
    return null;
  elsif p_section in ('explore', 'plans') then
    return 'Available after onboarding is completed.';
  end if;
  return null;
end $$;
revoke all on function private.client_gate(jsonb, text) from public, anon, authenticated;

create or replace function private.client_access(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  s text;
  v_sections jsonb := '{}'::jsonb;
  v_reason text;
begin
  foreach s in array array['overview', 'journey', 'services', 'campaigns', 'explore', 'plans', 'calendar', 'documents', 'invoices', 'tickets', 'chat', 'notifications', 'docs'] loop
    v_reason := private.client_gate(f, s);
    v_sections := v_sections || jsonb_build_object(s, jsonb_build_object('enabled', v_reason is null, 'reason', v_reason));
  end loop;
  return jsonb_build_object('sections', v_sections);
end $$;
revoke all on function private.client_access(uuid) from public, anon, authenticated;

-- The gate every closed-section function calls first. Returns the customer.
create or replace function private.require_client_section(p_section text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := private.require_client();
  v_reason text := private.client_gate(private.client_facts(v), p_section);
begin
  if v_reason is not null then
    raise exception 'FORBIDDEN: %', v_reason using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function private.require_client_section(text) from public, anon, authenticated;

-- What the client sees: the five stages with their state, dates, the people involved and what is still needed.
create or replace function private.client_journey(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  a public.customer_client_accounts;
  f jsonb := private.client_facts(p_customer);
  v_complete boolean;
  v_pay boolean := coalesce((f ->> 'payment')::boolean, false);
  v_required boolean := coalesce((f ->> 'metaRequired')::boolean, false);
  v_meta text;
  v_meta_done boolean := coalesce((f ->> 'metaDone')::boolean, false);
  v_rm_done boolean := coalesce((f ->> 'rmDone')::boolean, false);
  v_rm_needed boolean := coalesce((f ->> 'rmNeeded')::boolean, false);
  v_svc_done boolean := coalesce((f ->> 'servicesDone')::boolean, false);
  v_verifier public.profiles;
  v_rmp public.profiles;
  v_lead public.profiles;
  v_s_pay text; v_s_meta text; v_s_rm text; v_s_svc text; v_s_done text;
  v_current text;
  v_services jsonb;
  v_outstanding jsonb;
  v_chat text;
  v_meta_hist boolean;
begin
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  v_complete := not coalesce((f ->> 'applies')::boolean, false);
  v_meta := coalesce(o.meta_status, 'PENDING');
  select * into v_verifier from public.profiles where id = private.meta_verifier_of(p_customer);
  select * into v_rmp from public.profiles where id = private.rm_of(p_customer);
  select * into v_lead from public.profiles where id = private.rm_lead_of(p_customer);

  -- stage states -------------------------------------------------------------
  v_s_pay := case when v_complete or v_pay then 'COMPLETED' else 'IN_PROGRESS' end;
  v_s_meta := case
    when v_complete or v_meta_done then 'COMPLETED'
    when not v_pay then 'PENDING'
    when v_meta = 'DOCUMENTS_REQUIRED' then 'ACTION_REQUIRED'
    when v_meta = 'REJECTED' then 'REJECTED'
    when v_meta = 'IN_PROGRESS' then 'IN_PROGRESS'
    else 'PENDING' end;
  v_s_rm := case
    when v_complete or (v_meta_done and v_rm_done) then 'COMPLETED'
    when v_meta_done then 'IN_PROGRESS'
    else 'PENDING' end;
  v_s_svc := case
    when v_complete or v_svc_done then 'COMPLETED'
    when v_meta_done and v_rm_done then 'IN_PROGRESS'
    else 'PENDING' end;
  v_s_done := case when v_complete then 'COMPLETED' else 'PENDING' end;
  v_current := case
    when v_s_pay <> 'COMPLETED' then 'PAYMENT'
    when v_s_meta <> 'COMPLETED' then 'META_VERIFICATION'
    when v_s_rm <> 'COMPLETED' then 'RELATIONSHIP_MANAGER'
    when v_s_svc <> 'COMPLETED' then 'SERVICE_SETUP'
    else 'COMPLETED' end;

  -- the Meta items still needed from the client (required items that are missing or were sent back)
  select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'label', i.label,
           'status', case when e.item_code is null then 'MISSING' else e.status end,
           'note', case when e.status = 'REJECTED' then e.review_note end) order by i.sort_order), '[]'::jsonb)
    into v_outstanding
    from private.client_items(p_customer) i
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
   where not coalesce(i.is_optional, false) and coalesce(e.status, 'MISSING') in ('MISSING', 'REJECTED');

  -- each purchased service on its own
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', s.code, 'name', s.name, 'category', s.category,
           'status', case when cs.setup_status = 'READY' then 'READY'
                          when not (v_meta_done and v_rm_done) and not v_complete then 'PENDING'
                          else cs.setup_status end,
           'waitingFor', case when cs.setup_status = 'READY' or v_complete then null
                              when not v_meta_done then 'Meta verification'
                              when not v_rm_done then 'Relationship Manager assignment' end,
           'readyAt', cs.setup_completed_at, 'note', cs.setup_note)
         order by cs.created_at, s.name), '[]'::jsonb)
    into v_services
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   where cs.customer_id = p_customer;

  -- the chat the client is routed to now; the Meta conversation stays listed (read only) once it has messages
  v_chat := case when v_meta_done then 'RM' else 'META' end;
  v_meta_hist := exists (select 1 from public.chat_conversations x where x.kind = 'CLIENT' and x.customer_id = p_customer and x.channel = 'META' and x.last_seq > 0);

  return jsonb_build_object(
    'stage', v_current,
    'completed', v_complete,
    'completedAt', o.onboarding_completed_at,
    'stages', jsonb_build_array(
      jsonb_build_object('key', 'PAYMENT', 'status', v_s_pay, 'current', v_current = 'PAYMENT',
        'completedAt', case when v_s_pay = 'COMPLETED' then o.accounts_confirmed_at end,
        'accountCreatedAt', a.created_at, 'accountEmail', a.email),
      jsonb_build_object('key', 'META_VERIFICATION', 'status', v_s_meta, 'current', v_current = 'META_VERIFICATION',
        'required', v_required, 'metaStatus', case when v_required then v_meta else 'NOT_REQUIRED' end,
        'startedAt', o.meta_started_at, 'completedAt', case when v_s_meta = 'COMPLETED' then o.meta_completed_at end,
        'feedback', case when v_meta in ('DOCUMENTS_REQUIRED', 'REJECTED') then o.meta_feedback end,
        'updatedAt', o.meta_status_changed_at,
        'outstanding', case when v_required and v_s_meta <> 'COMPLETED' then v_outstanding else '[]'::jsonb end,
        'verifier', case when v_verifier.id is null then null else jsonb_build_object('name', v_verifier.full_name, 'position', v_verifier.position) end),
      jsonb_build_object('key', 'RELATIONSHIP_MANAGER', 'status', v_s_rm, 'current', v_current = 'RELATIONSHIP_MANAGER',
        'required', v_rm_needed,
        'completedAt', case when v_s_rm = 'COMPLETED' then o.assigned_to_member_at end,
        'manager', case when v_s_rm = 'PENDING' or v_rmp.id is null then null
                        else jsonb_build_object('name', v_rmp.full_name, 'position', v_rmp.position) end,
        'teamLead', case when v_s_rm = 'PENDING' or v_lead.id is null then null
                         else jsonb_build_object('name', v_lead.full_name, 'position', v_lead.position) end),
      jsonb_build_object('key', 'SERVICE_SETUP', 'status', v_s_svc, 'current', v_current = 'SERVICE_SETUP',
        'completedAt', case when v_s_svc = 'COMPLETED' then (select max(cs.setup_completed_at) from public.customer_services cs where cs.customer_id = p_customer) end,
        'services', v_services),
      jsonb_build_object('key', 'COMPLETED', 'status', v_s_done, 'current', v_current = 'COMPLETED', 'completedAt', o.onboarding_completed_at)),
    'chat', jsonb_build_object('active', v_chat, 'channels', jsonb_build_array(
      jsonb_build_object('channel', 'META', 'label', 'Meta verification', 'open', v_required and not v_meta_done, 'visible', v_required or v_meta_hist,
        'with', case when v_verifier.id is null then null else jsonb_build_object('name', v_verifier.full_name, 'position', v_verifier.position) end),
      jsonb_build_object('channel', 'RM', 'label', 'Relationship Manager', 'open', v_meta_done and (v_rmp.id is not null or v_lead.id is not null), 'visible', v_meta_done,
        'with', case when v_rmp.id is null then null else jsonb_build_object('name', v_rmp.full_name, 'position', v_rmp.position) end))),
    'access', private.client_access(p_customer) -> 'sections');
end $$;
revoke all on function private.client_journey(uuid) from public, anon, authenticated;

create or replace function public.client_onboarding_journey()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return private.client_journey(v_customer);
end $$;
revoke all on function public.client_onboarding_journey() from public, anon;
grant execute on function public.client_onboarding_journey() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Completing onboarding (by itself, when every mandatory stage is done)
-- ---------------------------------------------------------------------------
create or replace function private.refresh_onboarding_completion(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  c public.customers;
begin
  if not coalesce((f ->> 'applies')::boolean, false) then
    return;
  end if;
  if coalesce((f ->> 'payment')::boolean, false) and coalesce((f ->> 'login')::boolean, false) and coalesce((f ->> 'metaDone')::boolean, false)
     and coalesce((f ->> 'rmDone')::boolean, false) and coalesce((f ->> 'servicesDone')::boolean, false) then
    update public.customer_onboarding set onboarding_completed_at = now()
     where customer_id = p_customer and onboarding_completed_at is null;
    if found then
      select * into c from public.customers where id = p_customer;
      perform private.log_customer_activity(p_customer, 'ONBOARDING_COMPLETED', 'Onboarding completed: payment, Meta verification, Relationship Manager and every service are done');
      perform private.write_audit('ONBOARDING_COMPLETED', 'customer', p_customer, c.department_id, c.team_id, '{}'::jsonb);
      perform private.client_notify(p_customer, 'ONBOARDING_COMPLETED', 'Your onboarding is complete',
        'Everything is set up. All the sections of your dashboard that match your services are now open.', 'journey', p_customer,
        format('JOURNEY|%s|COMPLETED', p_customer));
    end if;
  end if;
end $$;
revoke all on function private.refresh_onboarding_completion(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. The state machine of the Meta status (every path: the consultant's action, an authorization sent back, a hand-over)
-- ---------------------------------------------------------------------------
create or replace function private.tg_onboarding_journey_before()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    -- "Meta verification completed" is recorded in two places that must agree: the status and meta_completed_at (the existing event)
    if new.meta_completed_at is not null and old.meta_completed_at is null and new.meta_status <> 'COMPLETED' then
      new.meta_status := 'COMPLETED';
      new.meta_status_auto := false;
      new.meta_feedback := null;
    elsif new.meta_status = 'COMPLETED' and old.meta_status <> 'COMPLETED' and new.meta_completed_at is null then
      new.meta_completed_at := now();
    end if;
    -- the customer reached the verifier: verification starts
    if new.meta_status = 'PENDING' and new.forwarded_to_support_at is not null and old.forwarded_to_support_at is null then
      new.meta_status := 'IN_PROGRESS';
      new.meta_status_auto := true;
    end if;
    -- documents sent back to the client keep the verification open and tell the client what to do
    if new.meta_status = 'IN_PROGRESS' and new.items_rejected > 0 and coalesce(old.items_rejected, 0) = 0 then
      new.meta_status := 'DOCUMENTS_REQUIRED';
      new.meta_status_auto := true;
      new.meta_feedback := left(format('%s document%s or detail%s sent back for correction. Please open Documents and fix them.',
        new.items_rejected, case when new.items_rejected = 1 then '' else 's' end, case when new.items_rejected = 1 then ' was' else 's were' end), 1000);
    end if;
    if new.meta_status = 'DOCUMENTS_REQUIRED' and new.meta_status_auto and new.items_rejected = 0 and coalesce(old.items_rejected, 0) > 0 then
      new.meta_status := 'IN_PROGRESS';
      new.meta_feedback := null;
    end if;
    if new.meta_status is distinct from old.meta_status then
      new.meta_status_changed_at := now();
      if new.meta_status = 'IN_PROGRESS' and new.meta_started_at is null then
        new.meta_started_at := now();
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_onboarding_journey_before() from public, anon, authenticated;
drop trigger if exists customer_onboarding_journey_before on public.customer_onboarding;
create trigger customer_onboarding_journey_before before update on public.customer_onboarding
  for each row execute function private.tg_onboarding_journey_before();

-- The least busy active verifier of the customer's department (a Meta Verifier on the META route, a Technical Consultant on the other;
-- none: stays unassigned for a head to assign).
create or replace function private.pick_meta_verifier(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.customers c
    join public.profiles p on p.department_id = c.department_id and p.status = 'ACTIVE'
   where c.id = p_customer and private.is_verifier_for(p.id, p_customer)
   order by (select count(*) from public.customer_onboarding x where x.meta_verifier_id = p.id and x.meta_status <> 'COMPLETED' and x.onboarding_completed_at is null), p.created_at, p.id
   limit 1
$$;
revoke all on function private.pick_meta_verifier(uuid) from public, anon, authenticated;

create or replace function private.tg_onboarding_journey_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_label text;
  v_msg text;
  v_pick uuid;
begin
  select * into c from public.customers where id = new.customer_id;

  -- payment just confirmed: the verifier is assigned (if this customer goes through Meta verification)
  if new.accounts_confirmed_at is not null and new.meta_verifier_id is null
     and (tg_op = 'INSERT' or old.accounts_confirmed_at is null) and private.meta_required(new.customer_id) then
    v_pick := private.pick_meta_verifier(new.customer_id);
    if v_pick is not null then
      update public.customer_onboarding set meta_verifier_id = v_pick, meta_verifier_assigned_at = now(), meta_verifier_assigned_by = null
       where customer_id = new.customer_id;
      perform private.notify(v_pick, 'META_VERIFIER_ASSIGNED', format('New Meta verification: %s', coalesce(c.company, c.name)),
        'You are the Meta Verifier of this client. They can message you from their dashboard.', 'customer', new.customer_id);
    end if;
  end if;

  if tg_op = 'UPDATE' and new.meta_status is distinct from old.meta_status then
    v_label := case new.meta_status when 'IN_PROGRESS' then 'in progress' when 'DOCUMENTS_REQUIRED' then 'needs documents'
                 when 'REJECTED' then 'rejected' when 'COMPLETED' then 'completed' else lower(new.meta_status) end;
    perform private.log_customer_activity(new.customer_id, 'META_STATUS_CHANGED', format('Meta verification %s', v_label) || coalesce(' · ' || new.meta_feedback, ''));
    perform private.write_audit('META_VERIFICATION_STATUS_CHANGED', 'customer', new.customer_id, c.department_id, c.team_id,
      jsonb_build_object('from', old.meta_status, 'to', new.meta_status, 'auto', new.meta_status_auto, 'feedback', new.meta_feedback));
    if new.meta_status <> 'PENDING' then
      v_msg := case new.meta_status
        when 'IN_PROGRESS' then 'Your Meta verification is in progress.'
        when 'DOCUMENTS_REQUIRED' then 'Meta verification needs something from you: ' || coalesce(new.meta_feedback, 'please check the list in your Onboarding Journey.')
        when 'REJECTED' then 'Meta verification was not approved: ' || coalesce(new.meta_feedback, 'please check the feedback in your Onboarding Journey.')
        when 'COMPLETED' then 'Meta verification is completed. Your Relationship Manager takes over from here.' end;
      perform private.client_notify(new.customer_id, 'META_STATUS', 'Meta verification update', left(v_msg, 1000), 'journey', new.customer_id,
        format('JOURNEY|%s|META|%s|%s', new.customer_id, new.meta_status, extract(epoch from now())::bigint));
    end if;
  end if;

  if tg_op = 'UPDATE' and (new.meta_status is distinct from old.meta_status or new.team_member_id is distinct from old.team_member_id
       or new.handover_stage is distinct from old.handover_stage or new.accounts_confirmed_at is distinct from old.accounts_confirmed_at)
     or tg_op = 'INSERT' then
    perform private.refresh_onboarding_completion(new.customer_id);
  end if;
  return null;
end $$;
revoke all on function private.tg_onboarding_journey_after() from public, anon, authenticated;
drop trigger if exists customer_onboarding_journey_after on public.customer_onboarding;
create trigger customer_onboarding_journey_after after insert or update on public.customer_onboarding
  for each row execute function private.tg_onboarding_journey_after();

-- A login, a service becoming ready: the journey may complete.
create or replace function private.tg_journey_refresh_from_child()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_onboarding_completion(new.customer_id);
  return null;
end $$;
revoke all on function private.tg_journey_refresh_from_child() from public, anon, authenticated;
drop trigger if exists customer_services_journey_refresh on public.customer_services;
create trigger customer_services_journey_refresh after insert or update of setup_status on public.customer_services
  for each row execute function private.tg_journey_refresh_from_child();
drop trigger if exists customer_client_accounts_journey_refresh on public.customer_client_accounts;
create trigger customer_client_accounts_journey_refresh after insert on public.customer_client_accounts
  for each row execute function private.tg_journey_refresh_from_child();

-- ---------------------------------------------------------------------------
-- 7. Staff actions
-- ---------------------------------------------------------------------------
-- May the signed-in employee run the Meta verification of this customer? The consultant's own rules (department, support team, heads).
create or replace function private.may_run_meta(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_review_onboarding(p_customer)
$$;
revoke all on function private.may_run_meta(uuid) from public, anon, authenticated;

create or replace function public.set_meta_verification(p_customer uuid, p_status text, p_feedback text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_feedback text := left(nullif(btrim(coalesce(p_feedback, '')), ''), 1000);
  v_allowed text[];
begin
  if not private.may_run_meta(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not private.meta_required(p_customer) then
    raise exception 'CONFLICT: This customer does not go through Meta verification.' using errcode = 'P0001';
  end if;
  if v_status not in ('IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose In progress, Documents required, Rejected or Completed.' using errcode = 'P0001';
  end if;
  if o.meta_status = v_status then
    raise exception 'CONFLICT: Meta verification is already %.', lower(replace(v_status, '_', ' ')) using errcode = 'P0001';
  end if;
  v_allowed := case o.meta_status
    when 'PENDING' then array['IN_PROGRESS']
    when 'IN_PROGRESS' then array['DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED']
    when 'DOCUMENTS_REQUIRED' then array['IN_PROGRESS', 'REJECTED']
    when 'REJECTED' then array['IN_PROGRESS']
    else array[]::text[] end;
  if not (v_status = any (v_allowed)) then
    raise exception 'CONFLICT: Meta verification cannot move from % to %.', lower(replace(o.meta_status, '_', ' ')), lower(replace(v_status, '_', ' ')) using errcode = 'P0001';
  end if;
  if v_status in ('DOCUMENTS_REQUIRED', 'REJECTED') and v_feedback is null then
    raise exception 'VALIDATION_ERROR: Tell the client what is needed or why it was rejected.' using errcode = 'P0001';
  end if;
  if v_status = 'IN_PROGRESS' and o.items_rejected > 0 then
    raise exception 'VALIDATION_ERROR: Some documents are still sent back to the client. Wait for the corrections, or authorize them, first.' using errcode = 'P0001';
  end if;
  if v_status = 'COMPLETED' then
    if o.accounts_confirmed_at is null then
      raise exception 'VALIDATION_ERROR: The payment is not confirmed yet.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
      raise exception 'VALIDATION_ERROR: The client has no login yet.' using errcode = 'P0001';
    end if;
    if o.returned_at is not null or o.review_state <> 'VERIFIED' then
      raise exception 'VALIDATION_ERROR: Authorize every document and detail first. Meta verification cannot be completed while any is missing or sent back.' using errcode = 'P0001';
    end if;
  end if;

  update public.customer_onboarding
     set meta_status = v_status, meta_status_auto = false,
         meta_feedback = case when v_status in ('DOCUMENTS_REQUIRED', 'REJECTED') then v_feedback else null end,
         meta_completed_at = case when v_status = 'COMPLETED' then now() else meta_completed_at end,
         meta_completed_by = case when v_status = 'COMPLETED' then (select private.my_id()) else meta_completed_by end,
         meta_verifier_id = coalesce(meta_verifier_id, (select private.my_id())),
         meta_verifier_assigned_at = case when meta_verifier_id is null then now() else meta_verifier_assigned_at end,
         meta_verifier_assigned_by = case when meta_verifier_id is null then (select private.my_id()) else meta_verifier_assigned_by end
   where customer_id = p_customer;
  if v_status = 'COMPLETED' then
    -- the same event as mark_meta_verification_completed: the client's "Meta verification completed" message, once
    perform private.advance_client_status(p_customer, false);
    perform private.log_customer_activity(p_customer, 'META_VERIFICATION_COMPLETED', 'Meta verification marked as completed');
    perform private.write_audit('META_VERIFICATION_COMPLETED', 'customer', p_customer, c.department_id, c.team_id, '{}'::jsonb);
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  return jsonb_build_object('status', o.meta_status, 'feedback', o.meta_feedback, 'changedAt', o.meta_status_changed_at,
                            'completedAt', o.meta_completed_at, 'verifierId', o.meta_verifier_id);
end $$;
revoke all on function public.set_meta_verification(uuid, text, text) from public, anon;
grant execute on function public.set_meta_verification(uuid, text, text) to authenticated;

-- Assign the Meta Verifier. A verifier of the department (see private.is_verifier_for) can take it for themselves (p_verifier null); the
-- Department Head or Super Admin can name any active verifier of the department.
create or replace function public.assign_meta_verifier(p_customer uuid, p_verifier uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  me uuid := private.my_id();
  v_target uuid;
  v_name text;
  v_old uuid;
  v_conv uuid;
begin
  select * into c from public.customers where id = p_customer for update;
  if c.id is null or me is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  v_target := coalesce(p_verifier, me);
  if not (private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
          or (v_target = me and private.is_verifier_for(me, p_customer))) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or o.accounts_confirmed_at is null or not private.meta_required(p_customer) then
    raise exception 'CONFLICT: This customer does not go through Meta verification yet.' using errcode = 'P0001';
  end if;
  if o.meta_status = 'COMPLETED' then
    raise exception 'CONFLICT: Meta verification is completed; the verifier can no longer change.' using errcode = 'P0001';
  end if;
  select p.full_name into v_name from public.profiles p
   where p.id = v_target and private.is_verifier_for(p.id, p_customer);
  if v_name is null then
    raise exception 'VALIDATION_ERROR: Choose an active Meta Verifier of this department.' using errcode = 'P0001';
  end if;
  v_old := o.meta_verifier_id;
  if v_old is not distinct from v_target then
    return jsonb_build_object('verifierId', v_target, 'name', v_name);
  end if;
  update public.customer_onboarding
     set meta_verifier_id = v_target, meta_verifier_assigned_at = now(), meta_verifier_assigned_by = me
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'META_VERIFIER_ASSIGNED', format('Meta Verifier: %s', v_name));
  perform private.write_audit('META_VERIFIER_ASSIGNED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('from', v_old, 'to', v_target));
  perform private.notify(v_target, 'META_VERIFIER_ASSIGNED', format('New Meta verification: %s', coalesce(c.company, c.name)),
    'You are the Meta Verifier of this client. They can message you from their dashboard.', 'customer', p_customer);
  select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer and channel = 'META';
  if v_conv is not null then
    perform private.chat_system_message(v_conv, format('Your Meta Verifier is now %s.', v_name));
  end if;
  return jsonb_build_object('verifierId', v_target, 'name', v_name);
end $$;
revoke all on function public.assign_meta_verifier(uuid, uuid) from public, anon;
grant execute on function public.assign_meta_verifier(uuid, uuid) to authenticated;

-- Who may change the setup of this customer's service: the support team that looks after the customer (consultants, the hand-over
-- Team Lead / Team Member, the Department Head, the Super Admin) and, for a service another department delivers, that department's staff.
create or replace function private.may_set_service_setup(p_customer uuid, p_service text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_super_admin()
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()
        or (select private.my_id()) in (private.support_member_of(c.id), private.support_lead_of(c.id))
        or exists (select 1 from public.crm_services s join public.profiles p on p.department_id = s.delivery_department_id
                    where s.code = p_service and p.id = (select private.my_id()) and p.status = 'ACTIVE')
      from public.customers c where c.id = p_customer), false)
$$;
revoke all on function private.may_set_service_setup(uuid, text) from public, anon, authenticated;

create or replace function public.set_service_setup(p_customer uuid, p_service text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  cs public.customer_services;
  sv public.crm_services;
  f jsonb;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_missing text;
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
  select * into o from public.customer_onboarding where customer_id = p_customer;
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
    if not coalesce((f ->> 'login')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The client has no login yet.' using errcode = 'P0001';
    end if;
    -- authorization: every required document or detail of this service has been authorized by the team
    select string_agg(i.label, ', ' order by i.sort_order) into v_missing
      from private.customer_items(p_customer) i
      join public.onboarding_item_services m on m.item_code = i.code and m.service_code = p_service
      left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
     where not coalesce(i.is_optional, false) and coalesce(e.status, '') <> 'VERIFIED';
    if v_missing is not null then
      raise exception 'VALIDATION_ERROR: Authorize these first: %.', v_missing using errcode = 'P0001';
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

-- What the team sees of a customer's journey: Meta verification, verifier, Relationship Manager and each service.
create or replace function public.customer_journey_status(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
  f jsonb;
  v_can_meta boolean;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer) or private.may_set_service_setup(p_customer, '')) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  f := private.client_facts(p_customer);
  v_can_meta := private.may_run_meta(p_customer);
  return jsonb_build_object(
    'applies', coalesce((f ->> 'applies')::boolean, false),
    'metaRequired', coalesce((f ->> 'metaRequired')::boolean, false),
    'meta', jsonb_build_object('status', coalesce(o.meta_status, 'PENDING'), 'feedback', o.meta_feedback, 'changedAt', o.meta_status_changed_at,
        'startedAt', o.meta_started_at, 'completedAt', o.meta_completed_at,
        'verifier', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.meta_verifier_id),
        'canChange', v_can_meta and coalesce(o.meta_status, 'PENDING') <> 'COMPLETED',
        'canAssign', private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_department_id()))
                     or private.is_verifier_for(private.my_id(), p_customer),
        'readyToComplete', o.customer_id is not null and o.returned_at is null and o.review_state = 'VERIFIED' and o.accounts_confirmed_at is not null
                           and coalesce((f ->> 'login')::boolean, false)),
    'relationshipManager', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = private.rm_of(p_customer)),
    'completedAt', o.onboarding_completed_at,
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'status', cs.setup_status, 'note', cs.setup_note,
                  'updatedAt', cs.setup_updated_at, 'readyAt', cs.setup_completed_at,
                  'canChange', private.may_set_service_setup(p_customer, s.code)) order by cs.created_at, s.name)
                from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = p_customer), '[]'::jsonb));
end $$;
revoke all on function public.customer_journey_status(uuid) from public, anon;
grant execute on function public.customer_journey_status(uuid) to authenticated;

-- The verifiers a head can pick from.
create or replace function public.meta_verifier_candidates(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not (private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name) order by p.full_name)
                     from public.profiles p where p.department_id = c.department_id and private.is_verifier_for(p.id, p_customer)), '[]'::jsonb);
end $$;
revoke all on function public.meta_verifier_candidates(uuid) from public, anon;
grant execute on function public.meta_verifier_candidates(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The client login and the "completed" message are Accounts' and Meta's existing flows (20261205000300): nothing is redefined here.
--    The API starts the same Accounts flow when the payment is confirmed; the Meta status and meta_completed_at are kept in step by the trigger above.
--    The hand-over to the Department Head (and so the Relationship Manager) is 20261205000200's function plus one check: Meta verification first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.send_to_department_head(p_customer uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_head uuid;
  v_count integer := 0;
  v_meta boolean;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if o.handover_stage <> 'CONSULTANT' then
    raise exception 'CONFLICT: Already sent to the Department Head.' using errcode = 'P0001';
  end if;
  if o.returned_at is not null or o.review_state <> 'VERIFIED' then
    raise exception 'VALIDATION_ERROR: Authorize every document and detail first (including the WABA ID where it applies).' using errcode = 'P0001';
  end if;
  v_meta := private.onboarding_route(p_customer) = 'META';
  -- the Relationship Manager takes over only after Meta verification (the onboarding journey)
  if private.meta_required(p_customer) and o.meta_status <> 'COMPLETED' and o.meta_completed_at is null then
    raise exception 'VALIDATION_ERROR: Complete the Meta verification first. The Relationship Manager takes over only after it.' using errcode = 'P0001';
  end if;

  for v_head in
    select id from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = v.department_id
  loop
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    raise exception 'CONFLICT: This department has no active Department Head to send the customer to.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'DEPARTMENT_HEAD', stage = 'HANDOVER', to_department_head_at = now(),
         to_department_head_by = (select private.my_id()), handover_note = v_note
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_DEPARTMENT_HEAD', 'Verified and sent to the Department Head' || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_DEPARTMENT_HEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('note', v_note, 'route', case when v_meta then 'META' else 'TECHNICAL' end));
  -- the Technical Consultant's consultation follows some days later (a persistent follow-up; the delay is a setting)
  if v_meta then
    perform private.schedule_tc_followup(p_customer, 'The Meta Verifier verified the customer and handed it over. Contact the customer for the consultation and any add-on services.');
  end if;

  for v_head in
    select id from public.profiles where role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = v.department_id
  loop
    perform private.notify(v_head, 'HANDOVER_TO_DEPARTMENT_HEAD', format('New client to assign: %s', coalesce(v.company, v.name)),
      coalesce(v_note, case when v_meta then 'The Meta Verifier verified everything.' else 'The Technical Consultant verified everything.' end), 'customer', p_customer);
  end loop;
  perform private.notify(v.owner_id, 'HANDOVER_TO_DEPARTMENT_HEAD', format('Verified: %s', coalesce(v.company, v.name)),
    case when v_meta then 'The Meta Verifier verified the customer and sent it to the Department Head.' else 'The Technical Consultant verified the customer and sent it to the Department Head.' end, 'customer', p_customer);
end $function$;
revoke all on function public.send_to_department_head(uuid, text) from public, anon;
grant execute on function public.send_to_department_head(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The client's services: while the journey applies the status follows the setup, not the whole onboarding
-- ---------------------------------------------------------------------------
-- The same function the services list and the progress steps already share (20261206000400); the journey branch is the only addition:
-- a service of a customer who is still onboarding is "setting up" until the responsible team marks it READY.
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
  if coalesce((private.client_facts(p_customer) ->> 'applies')::boolean, false) then
    return case when cs.setup_status = 'READY' then coalesce(cs.service_status, 'LIVE')
                when cs.service_status in ('PAUSED', 'EXPIRED', 'CANCELLED') then cs.service_status
                else 'SETTING_UP' end;
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
       and (o.meta_completed_at is not null or (to_jsonb(o) ->> 'client_status') = 'COMPLETED') then
      return 'LIVE';
    end if;
    return 'SETTING_UP';
  end if;
  return case when coalesce((to_jsonb(o) ->> 'client_status') = 'COMPLETED' or o.stage = 'COMPLETED', true) then 'LIVE' else 'SETTING_UP' end;
end $$;
revoke all on function private.client_service_state(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Gate the closed sections. The original function moves to private.open_<name>(); public.<name>() checks the stage, then calls it.
-- ---------------------------------------------------------------------------
create or replace function private.gate_client_function(p_name text, p_argtypes text, p_section text, p_staff_passthrough boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_oid oid;
  v_args text;
  v_result text;
  v_vol text;
  v_names text[];
  v_call text;
  v_gate text;
  v_sig text := format('%I(%s)', p_name, p_argtypes);
  v_inner text := 'open_' || p_name;
begin
  if to_regprocedure(format('private.%I(%s)', v_inner, p_argtypes)) is null then
    v_oid := to_regprocedure(format('public.%s', v_sig));
    if v_oid is null then
      raise exception 'gate_client_function: public.% does not exist', v_sig;
    end if;
    execute format('alter function public.%s set schema private', v_sig);
    execute format('alter function private.%s rename to %I', v_sig, v_inner);
    execute format('revoke all on function private.%I(%s) from public, anon, authenticated', v_inner, p_argtypes);
  end if;
  v_oid := to_regprocedure(format('private.%I(%s)', v_inner, p_argtypes));
  select pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
         case p.provolatile when 's' then 'stable' when 'i' then 'immutable' else 'volatile' end, p.proargnames
    into v_args, v_result, v_vol, v_names
    from pg_proc p where p.oid = v_oid;
  select coalesce(string_agg(format('%I', n), ', '), '') into v_call from unnest(coalesce(v_names, '{}'::text[])) n;
  v_gate := case when p_staff_passthrough
    then format('if private.my_client_customer() is not null then perform private.require_client_section(%L); end if;', p_section)
    else format('perform private.require_client_section(%L);', p_section) end;
  execute format(
    'create or replace function public.%I(%s) returns %s language plpgsql %s security definer set search_path = '''' as $f$ begin %s %s end $f$',
    p_name, v_args, v_result, v_vol, v_gate,
    case when v_result = 'void' then format('perform private.%I(%s); return;', v_inner, v_call) else format('return private.%I(%s);', v_inner, v_call) end);
  execute format('revoke all on function public.%I(%s) from public, anon', p_name, p_argtypes);
  execute format('grant execute on function public.%I(%s) to authenticated', p_name, p_argtypes);
end $$;
revoke all on function private.gate_client_function(text, text, text, boolean) from public, anon, authenticated;

select private.gate_client_function(g.name, g.args, g.section, g.passthrough)
  from (values
    ('client_services', '', 'services', false),
    ('client_service_progress', '', 'services', false),
    ('client_campaigns', '', 'campaigns', false),
    ('client_calendar', 'date, date', 'calendar', false),
    ('client_service_catalog', '', 'explore', false),
    ('client_service_requests', '', 'explore', false),
    ('client_request_service', 'text, text', 'explore', false),
    ('client_cancel_service_request', 'uuid', 'explore', false),
    ('client_plans', '', 'plans', false),
    ('client_request_plan', 'uuid, text', 'plans', false),
    ('client_tickets', '', 'tickets', false),
    ('client_ticket', 'uuid', 'tickets', false),
    ('client_create_ticket', 'text, text, text, text, uuid[]', 'tickets', false),
    ('client_reply_ticket', 'uuid, text', 'tickets', false),
    ('client_send_ticket_message', 'uuid, text, uuid, uuid[]', 'tickets', false),
    ('client_ticket_seen', 'uuid', 'tickets', false),
    ('ticket_attachments', 'uuid', 'tickets', true),
    ('ticket_begin_upload', 'uuid, uuid, text, text, bigint', 'tickets', true),
    ('ticket_abort_upload', 'uuid', 'tickets', true),
    ('ticket_pending_upload', 'uuid', 'tickets', true),
    ('ticket_complete_upload', 'uuid, bigint, text', 'tickets', true),
    ('ticket_attachment_download', 'uuid', 'tickets', true)
  ) as g(name, args, section, passthrough);

-- The overview always opens (it carries the journey); a closed section shows nothing of its own.
create or replace function public.client_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  f jsonb := private.client_facts(v_customer);
  v_services jsonb := case when private.client_gate(f, 'services') is null then private.open_client_services() else '[]'::jsonb end;
  v_invoices jsonb := public.client_invoices();
  v_tickets jsonb := case when private.client_gate(f, 'tickets') is null then private.open_client_tickets() else '[]'::jsonb end;
  v_plan jsonb := case when private.client_gate(f, 'plans') is null then private.open_client_plans() -> 'current' else null end;
begin
  return jsonb_build_object(
    'profile', public.client_me(),
    'journey', private.client_journey(v_customer),
    'services', jsonb_build_object('total', jsonb_array_length(v_services),
      'live', (select count(*) from jsonb_array_elements(v_services) s where s ->> 'status' = 'LIVE'),
      'items', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select s from jsonb_array_elements(v_services) s limit 6) q)),
    'plan', v_plan,
    'invoices', jsonb_build_object('total', jsonb_array_length(v_invoices),
      'pending', (select count(*) from jsonb_array_elements(v_invoices) i where i ->> 'status' = 'Pending'),
      'recent', (select coalesce(jsonb_agg(i), '[]'::jsonb) from (select i from jsonb_array_elements(v_invoices) i limit 4) q)),
    'tickets', jsonb_build_object('total', jsonb_array_length(v_tickets),
      'open', (select count(*) from jsonb_array_elements(v_tickets) t where t ->> 'status' not in ('RESOLVED', 'CLOSED')),
      'recent', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select t from jsonb_array_elements(v_tickets) t limit 3) q)),
    'notifications', (select jsonb_build_object('unread', count(*) filter (where n.read_at is null),
        'recent', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body, 'readAt', x.read_at, 'createdAt', x.created_at, 'entityType', x.entity_type, 'entityId', x.entity_id))
                              from (select * from public.client_notifications where customer_id = v_customer order by created_at desc limit 4) x), '[]'::jsonb))
                        from public.client_notifications n where n.customer_id = v_customer),
    'renewals', (select coalesce(jsonb_agg(r order by r ->> 'renewsOn'), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'SERVICE', 'name', s ->> 'name', 'renewsOn', s ->> 'renewsOn') as r
          from jsonb_array_elements(v_services) s where s ->> 'renewsOn' is not null and (s ->> 'renewsOn')::date >= current_date
        union all select jsonb_build_object('kind', 'PLAN', 'name', v_plan ->> 'name', 'renewsOn', v_plan ->> 'renewsOn')
          where v_plan is not null and v_plan ->> 'renewsOn' is not null and (v_plan ->> 'renewsOn')::date >= current_date) q));
end $$;
revoke all on function public.client_overview() from public, anon;
grant execute on function public.client_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Existing customers: the journey starts for new ones; whoever already works with the dashboard keeps it
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o where o.journey_migrated_at is null loop
    -- Meta verification is completed for whoever it was already recorded for (the existing event, or the "completed" client status) and for
    -- whoever was already handed to the Department Head or is already a customer: their verification is behind them. A login alone proves
    -- nothing (Accounts now creates it as soon as the payment is verified).
    update public.customer_onboarding o
       set meta_status = case
             when o.meta_completed_at is not null or o.client_status = 'COMPLETED' or o.handover_stage <> 'CONSULTANT'
                  or (select c.lifecycle_stage from public.customers c where c.id = o.customer_id) = 'CUSTOMER' then 'COMPLETED'
             when o.forwarded_to_support_at is not null then 'IN_PROGRESS'
             else 'PENDING' end,
           meta_started_at = case when o.forwarded_to_support_at is not null then o.forwarded_to_support_at end,
           meta_completed_at = case when o.meta_completed_at is null and o.client_status = 'COMPLETED' then coalesce(o.client_status_changed_at, now()) else o.meta_completed_at end,
           meta_status_changed_at = now(),
           journey_migrated_at = now()
     where o.customer_id = r.customer_id;
    -- already a customer (everything was handed on), or working with live services and a login: the onboarding is complete
    update public.customer_onboarding o
       set onboarding_completed_at = now()
     where o.customer_id = r.customer_id and o.onboarding_completed_at is null
       and ((select c.lifecycle_stage from public.customers c where c.id = o.customer_id) = 'CUSTOMER'
            or (exists (select 1 from public.customer_client_accounts a where a.customer_id = o.customer_id)
                and exists (select 1 from public.customer_services cs where cs.customer_id = o.customer_id and cs.setup_status = 'READY')));
  end loop;
end $$;
alter table public.customer_onboarding alter column journey_migrated_at set default now();

notify pgrst, 'reload schema';


-- Stage-based client chat: the client talks to the Meta Verifier until Meta verification is completed, then to the Relationship Manager.
--
-- Same chat tables, same functions, same rules (identity from auth.uid(), read-only tables, history kept). What is added:
--   * chat_conversations.channel: 'RM' (every existing client conversation) or 'META'. A customer has at most one conversation per channel,
--     so the Meta verification history is kept apart from the Relationship Manager's and nothing is deleted or overwritten.
--   * Who is on the other side is never chosen by the caller: the META conversation's staff side is the customer's assigned Meta Verifier,
--     the RM conversation's is the customer's Team Member / Team Lead (as before). The client only names a channel, and the database answers
--     only for a channel that is open to them at their stage.
--   * Writing is allowed only while the channel is live: META until verification is completed (also when it is rejected or documents are
--     requested), RM once verification is completed and someone is assigned. A closed channel stays readable (history).
--
-- Run after 20261209000100_client_onboarding_journey.sql. Safe to run again.

drop index if exists public.chat_conversations_client_key;
create unique index if not exists chat_conversations_client_channel_key on public.chat_conversations (customer_id, channel) where kind = 'CLIENT';

-- Is Meta verification behind this customer? (Outside the journey, not needed, or completed.)
create or replace function private.meta_done(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((private.client_facts(p_customer) ->> 'metaDone')::boolean, true)
$$;
revoke all on function private.meta_done(uuid) from public, anon, authenticated;

-- Why nobody may write in this conversation right now (null = it is live).
create or replace function private.chat_block_reason(p_conversation uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  f jsonb;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or c.kind <> 'CLIENT' then
    return null;
  end if;
  f := private.client_facts(c.customer_id);
  if c.channel = 'META' then
    if not coalesce((f ->> 'metaRequired')::boolean, false) or coalesce((f ->> 'metaDone')::boolean, false) then
      return 'Meta verification is completed. This conversation is closed; your Relationship Manager continues with you.';
    end if;
    if private.meta_verifier_of(c.customer_id) is null then
      return 'A Meta Verifier has not been assigned yet. You will be able to write as soon as one is assigned.';
    end if;
    return null;
  end if;
  if not coalesce((f ->> 'metaDone')::boolean, false) then
    return 'This chat opens after Meta verification is completed.';
  end if;
  if private.rm_of(c.customer_id) is null and private.rm_lead_of(c.customer_id) is null then
    return 'Your team has not been assigned yet. You will be able to write as soon as a Relationship Manager is assigned.';
  end if;
  return null;
end $$;
revoke all on function private.chat_block_reason(uuid) from public, anon, authenticated;

-- How the signed-in user relates to a conversation: CLIENT, STAFF (the assigned people of that channel), MEMBER (internal), REVIEWER
-- (read only) or NULL (no access at all).
create or replace function private.chat_access(p_conversation uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  v_client uuid;
  me uuid;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null then
    return null;
  end if;
  if c.kind = 'CLIENT' then
    v_client := private.my_client_customer();
    if v_client is not null then
      if v_client is distinct from c.customer_id then
        return null;
      end if;
      -- the Relationship Manager's chat is not open to the client before Meta verification is done
      if c.channel = 'RM' and not private.meta_done(c.customer_id) then
        return null;
      end if;
      return 'CLIENT';
    end if;
    me := private.my_id();
    if me is null then
      return null;
    end if;
    if c.channel = 'META' then
      -- the verifier writes; the Relationship Manager and Team Lead who take over can read the history
      if me = private.meta_verifier_of(c.customer_id) or me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id) then
        return 'STAFF';
      end if;
    elsif (me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id)) and private.meta_done(c.customer_id) then
      return 'STAFF';
    end if;
    if private.chat_can_review(c.customer_id) then
      return 'REVIEWER';
    end if;
    return null;
  end if;
  me := private.my_id();
  if me is not null and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null) then
    return 'MEMBER';
  end if;
  return null;
end $$;
revoke all on function private.chat_access(uuid) from public, anon;
grant execute on function private.chat_access(uuid) to authenticated;

-- A conversation as the signed-in person sees it.
create or replace function private.chat_conversation_json(c public.chat_conversations, p_full boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  a text := private.chat_access(c.id);
  me uuid := auth.uid();
  v_from bigint := case when a = 'MEMBER' then private.chat_visible_from(c.id) else 0 end;
  v_title text;
  v_customer jsonb := null;
  v_team jsonb := null;
  v_verifier jsonb := null;
  v_members jsonb := null;
  v_admin boolean := false;
  v_peer_read bigint := null;
  v_block text := null;
  v_assigned boolean := null;
  v_read bigint := coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me), 0);
begin
  if a is null then
    return null;
  end if;
  if c.kind = 'CLIENT' then
    select jsonb_build_object('id', x.id, 'name', x.name, 'business', coalesce(nullif(btrim(x.company), ''), x.name), 'code', x.customer_code,
                              'hasLogin', exists (select 1 from public.customer_client_accounts ca where ca.customer_id = x.id))
      into v_customer from public.customers x where x.id = c.customer_id;
    v_team := private.chat_team_json(c.customer_id);
    v_verifier := (select jsonb_build_object('name', p.full_name, 'position', p.position) from public.profiles p where p.id = private.meta_verifier_of(c.customer_id));
    v_block := private.chat_block_reason(c.id);
    v_title := case when a = 'CLIENT' then (case when c.channel = 'META' then 'Meta verification' else 'Your Amuwa team' end) else v_customer ->> 'business' end;
    v_peer_read := case when a = 'CLIENT' then c.staff_read_seq else c.client_read_seq end;
    v_assigned := case when c.channel = 'META' then v_verifier is not null else (v_team -> 'teamMember') is not null or (v_team -> 'teamLead') is not null end;
    if a = 'CLIENT' then
      v_customer := null;
    end if;
  elsif c.kind = 'DIRECT' then
    select p.full_name into v_title from public.chat_members m join public.profiles p on p.id = m.profile_id
     where m.conversation_id = c.id and m.profile_id <> me limit 1;
    select r.last_read_seq into v_peer_read from public.chat_read_state r where r.conversation_id = c.id and r.user_id <> me limit 1;
  else
    v_title := c.title;
  end if;
  if a = 'MEMBER' then
    v_admin := exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null and m.role = 'ADMIN');
    if p_full or c.kind = 'GROUP' then
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', m.role, 'position', p.position,
                                                   'label', private.chat_role_label(p.role), 'department', d.name, 'me', p.id = me)
                               order by (m.role = 'ADMIN') desc, p.full_name), '[]'::jsonb)
        into v_members from public.chat_members m join public.profiles p on p.id = m.profile_id
        left join public.departments d on d.id = p.department_id
       where m.conversation_id = c.id and m.left_at is null;
    end if;
  end if;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'channel', case when c.kind = 'CLIENT' then c.channel end, 'access', a,
    'canWrite', a in ('CLIENT', 'STAFF', 'MEMBER') and v_block is null, 'blockReason', case when a in ('CLIENT', 'STAFF') then v_block end,
    'title', v_title,
    'customer', v_customer, 'team', v_team, 'verifier', v_verifier, 'members', v_members, 'isAdmin', v_admin,
    'assigned', v_assigned,
    'lastSeq', c.last_seq, 'lastMessageAt', c.last_message_at, 'lastMessagePreview', c.last_message_preview, 'lastSenderName', c.last_sender_name,
    'unread', private.chat_unread(c.id, me, v_from), 'readSeq', v_read, 'peerReadSeq', v_peer_read, 'createdAt', c.created_at);
end $$;
revoke all on function private.chat_conversation_json(public.chat_conversations, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- Opening conversations
-- ---------------------------------------------------------------------------
drop function if exists private.chat_ensure_client_conversation(uuid);
create or replace function private.chat_ensure_client_conversation(p_customer uuid, p_channel text default 'RM')
returns public.chat_conversations language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer and channel = p_channel;
  if c.id is null then
    insert into public.chat_conversations (kind, customer_id, channel) values ('CLIENT', p_customer, p_channel)
    on conflict (customer_id, channel) where kind = 'CLIENT' do nothing;
    select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer and channel = p_channel;
  end if;
  return c;
end $$;
revoke all on function private.chat_ensure_client_conversation(uuid, text) from public, anon;

-- The client's own conversation of a channel (created on first use). The customer always comes from the login; the client can only
-- name a channel, and gets only a channel that is open at their stage. No channel: the one they should be using now.
drop function if exists public.chat_client_conversation();
create or replace function public.chat_client_conversation(p_channel text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_channel text := upper(btrim(coalesce(p_channel, '')));
  c public.chat_conversations;
begin
  if v_channel = '' then
    v_channel := case when private.meta_done(v_customer) then 'RM' else 'META' end;
  end if;
  if v_channel not in ('META', 'RM') then
    raise exception 'VALIDATION_ERROR: Unknown chat.' using errcode = 'P0001';
  end if;
  if v_channel = 'META' and not private.meta_required(v_customer) and not exists (
       select 1 from public.chat_conversations x where x.kind = 'CLIENT' and x.customer_id = v_customer and x.channel = 'META') then
    raise exception 'NOT_FOUND: There is no Meta verification chat for your services.' using errcode = 'P0001';
  end if;
  c := private.chat_ensure_client_conversation(v_customer, v_channel);
  if private.chat_access(c.id) is null then
    raise exception 'FORBIDDEN: This chat opens after Meta verification is completed.' using errcode = '42501';
  end if;
  return private.chat_conversation_json(c, true);
end $$;
revoke all on function public.chat_client_conversation(text) from public, anon;
grant execute on function public.chat_client_conversation(text) to authenticated;

-- Staff: the conversation of a customer they look after, or review (Department Head). Which channel is decided by their relation to the
-- customer unless they ask for one; the answer is NOT_FOUND for a channel they have no part in.
drop function if exists public.chat_customer_conversation(uuid);
create or replace function public.chat_customer_conversation(p_customer uuid, p_channel text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_channel text := upper(btrim(coalesce(p_channel, '')));
  c public.chat_conversations;
begin
  -- coalesce: for someone who is not assigned the comparisons are NULL, and NOT NULL would not refuse
  if me is null or p_customer is null or v_channel not in ('', 'META', 'RM')
     or not coalesce(me in (private.support_member_of(p_customer), private.support_lead_of(p_customer), private.meta_verifier_of(p_customer)) or private.chat_can_review(p_customer), false) then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if v_channel = '' then
    v_channel := case
      when me = private.meta_verifier_of(p_customer) and not private.meta_done(p_customer) then 'META'
      when me in (private.support_member_of(p_customer), private.support_lead_of(p_customer)) then 'RM'
      when me = private.meta_verifier_of(p_customer) then 'META'
      when private.meta_done(p_customer) then 'RM'
      else 'META' end;
  end if;
  c := private.chat_ensure_client_conversation(p_customer, v_channel);
  if private.chat_access(c.id) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return private.chat_conversation_json(c, true);
end $$;
revoke all on function public.chat_customer_conversation(uuid, text) from public, anon;
grant execute on function public.chat_customer_conversation(uuid, text) to authenticated;

-- The customers this employee looks after: as Relationship Manager / Team Lead (RM chat) or as Meta Verifier (Meta chat).
create or replace function public.chat_my_clients(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by sort_at desc nulls last, name) from (
      select t.name, t.sort_at, jsonb_build_object(
        'customerId', t.id, 'name', t.name, 'business', t.business, 'code', t.code, 'channel', t.channel,
        'conversationId', t.conv_id, 'lastMessageAt', t.sort_at, 'lastMessagePreview', t.preview,
        'unread', case when t.conv_id is null then 0 else private.chat_unread(t.conv_id, me, 0) end,
        'hasLogin', t.has_login, 'role', t.role) as row
      from (
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name) as business, c.customer_code as code, 'RM'::text as channel,
               cv.id as conv_id, cv.last_message_at as sort_at, cv.last_message_preview as preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id) as has_login,
               case when me = private.support_member_of(c.id) then 'Relationship Manager' else 'Team Lead' end as role
          from public.customers c
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'RM'
         where c.department_id = private.my_department_id()
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (me = private.support_member_of(c.id) or me = private.support_lead_of(c.id))
           and private.meta_done(c.id)
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        union all
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name), c.customer_code, 'META',
               cv.id, cv.last_message_at, cv.last_message_preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id),
               'Meta Verifier'
          from public.customers c
          join public.customer_onboarding o on o.customer_id = c.id and o.meta_verifier_id = me
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'META'
         where c.department_id = private.my_department_id()
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        order by sort_at desc nulls last, name limit 200) t) x), '[]'::jsonb);
end $$;
revoke all on function public.chat_my_clients(text) from public, anon;
grant execute on function public.chat_my_clients(text) to authenticated;

-- Unread totals for the badges: internal chats, the employee's own clients, the review list (Department Head).
create or replace function public.chat_unread_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_client uuid := private.my_client_customer();
  v_internal integer := 0;
  v_clients integer := 0;
  v_review integer := 0;
begin
  if v_client is not null then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients
      from public.chat_conversations c where c.kind = 'CLIENT' and c.customer_id = v_client and private.chat_access(c.id) = 'CLIENT';
    return jsonb_build_object('total', v_clients, 'internal', 0, 'clients', v_clients, 'review', 0);
  end if;
  if private.my_id() is null then
    return jsonb_build_object('total', 0, 'internal', 0, 'clients', 0, 'review', 0);
  end if;
  select coalesce(sum(private.chat_unread(m.conversation_id, me, m.visible_from_seq)), 0) into v_internal
    from public.chat_members m where m.profile_id = me and m.left_at is null;
  select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients
    from public.chat_conversations c join public.customers cu on cu.id = c.customer_id
   where c.kind = 'CLIENT' and c.last_seq > 0 and cu.department_id = private.my_department_id()
     and private.chat_access(c.id) = 'STAFF';
  if private.my_role() in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_review
      from public.chat_conversations c where c.kind = 'CLIENT' and c.last_seq > 0 and private.chat_access(c.id) = 'REVIEWER';
  end if;
  return jsonb_build_object('total', v_internal + v_clients, 'internal', v_internal, 'clients', v_clients, 'review', v_review);
end $$;
revoke all on function public.chat_unread_summary() from public, anon;
grant execute on function public.chat_unread_summary() to authenticated;

-- Sending and files: the stage decides whether the conversation is live (see chat_block_reason).
create or replace function public.chat_send_message(
  p_conversation uuid, p_body text, p_client_msg_id uuid, p_reply_to uuid default null, p_attachments uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_existing public.chat_messages;
  v_msg public.chat_messages;
  v_seq bigint;
  v_name text;
  v_label text;
  v_kind text;
  v_atts jsonb := '[]'::jsonb;
  v_n integer := coalesce(array_length(p_attachments, 1), 0);
  v_found integer;
  v_cust public.customers;
  v_to uuid;
  v_read bigint;
  v_block text;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but only the client and their assigned team can write in it.' using errcode = '42501';
  end if;
  if p_client_msg_id is null then
    raise exception 'VALIDATION_ERROR: The message has no identifier. Please try again.' using errcode = 'P0001';
  end if;
  -- a retry or a double click: the message was already stored
  select * into v_existing from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
  if v_existing.id is not null then
    return private.chat_message_json(v_existing);
  end if;
  if v_n > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files to one message.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: A message can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if v_body = '' and v_n = 0 then
    raise exception 'VALIDATION_ERROR: Write a message first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_messages x where x.sender_id = me and x.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'VALIDATION_ERROR: You are sending messages too fast. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  if c.kind = 'CLIENT' then
    select * into v_cust from public.customers where id = c.customer_id;
    -- the stage decides whom the client may write to and when (Meta Verifier first, the Relationship Manager after verification)
    v_block := private.chat_block_reason(c.id);
    if v_block is not null then
      raise exception 'VALIDATION_ERROR: %', v_block using errcode = 'P0001';
    end if;
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = p_reply_to and r.conversation_id = c.id) then
    raise exception 'VALIDATION_ERROR: The message you are replying to was not found.' using errcode = 'P0001';
  end if;
  if v_n > 0 then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.file_name, 'mime', t.mime_type, 'size', t.size_bytes) order by t.created_at), '[]'::jsonb)
      into v_found, v_atts from public.chat_attachments t
     where t.id = any (p_attachments) and t.conversation_id = c.id and t.uploader_id = me and t.status = 'READY' and t.message_id is null;
    if v_found <> v_n then
      raise exception 'VALIDATION_ERROR: One of the files is not ready or was already sent. Upload it again.' using errcode = 'P0001';
    end if;
  end if;

  if a = 'CLIENT' then
    v_name := coalesce(nullif(btrim(v_cust.name), ''), 'Client');
    v_label := 'Client';
    v_kind := 'CLIENT';
  else
    select p.full_name into v_name from public.profiles p where p.id = me;
    v_kind := 'STAFF';
    v_label := case when c.kind <> 'CLIENT' then null when c.channel = 'META' then 'Meta Verifier'
                    when me = private.support_lead_of(c.customer_id) then 'Team Lead' else 'Relationship Manager' end;
  end if;

  -- the row lock orders concurrent senders: seq is assigned one at a time
  update public.chat_conversations
     set last_seq = last_seq + 1, last_message_at = now(), updated_at = now(),
         last_message_preview = left(regexp_replace(case when v_body = '' then '[file] ' || (v_atts -> 0 ->> 'name') else v_body end, '\s+', ' ', 'g'), 160),
         last_sender_name = v_name
   where id = c.id returning last_seq into v_seq;
  begin
    insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, sender_label, kind, body, reply_to, client_msg_id, attachments)
    values (c.id, v_seq, me, v_kind, v_name, v_label, 'TEXT', v_body, p_reply_to, p_client_msg_id, v_atts)
    returning * into v_msg;
  exception when unique_violation then
    -- two requests with the same client_msg_id raced: the other one won
    select * into v_msg from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
    return private.chat_message_json(v_msg);
  end;
  if v_n > 0 then
    update public.chat_attachments set message_id = v_msg.id where id = any (p_attachments);
  end if;
  -- the sender has read everything up to their own message
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  if c.kind = 'CLIENT' then
    if a = 'CLIENT' then
      update public.chat_conversations set client_read_seq = v_seq where id = c.id;
    else
      update public.chat_conversations set staff_read_seq = greatest(staff_read_seq, v_seq) where id = c.id;
    end if;
    -- bells: at most one per person per "unread run" (a new one only after they have read the chat)
    if a = 'CLIENT' then
      for v_to in select x from unnest(case when c.channel = 'META' then array[private.meta_verifier_of(c.customer_id)]
                                              else array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id)] end) x where x is not null loop
        select coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = v_to), 0) into v_read;
        perform private.notify_once(v_to, 'CHAT_CLIENT_MESSAGE', format('New message from %s', coalesce(v_cust.company, v_cust.name)),
          left(v_body, 200), 'chat', c.id, format('CHAT|%s|%s', c.id, v_read));
      end loop;
    else
      perform private.client_notify(c.customer_id, 'CHAT_MESSAGE', format('New message from %s', v_name), left(v_body, 200), 'chat', c.id,
        format('CHAT|%s|%s', c.id, (select c2.client_read_seq from public.chat_conversations c2 where c2.id = c.id) ));
    end if;
  end if;
  return private.chat_message_json(v_msg);
end $$;

-- (20261206000300's version, plus: nobody uploads into a closed conversation)
create or replace function public.chat_begin_upload(p_conversation uuid, p_file_name text, p_mime text, p_size bigint)
returns public.chat_attachments language plpgsql security definer set search_path = '' as $$
declare
  a text := private.chat_access(p_conversation);
  me uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  v_kind text;
  v_secure boolean;
  v_max bigint;
  r public.chat_attachments;
begin
  if a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but you cannot send files in it.' using errcode = '42501';
  end if;
  if private.chat_block_reason(p_conversation) is not null then
    raise exception 'VALIDATION_ERROR: %', private.chat_block_reason(p_conversation) using errcode = 'P0001';
  end if;
  select kind into v_kind from public.chat_conversations where id = p_conversation;
  v_secure := v_kind in ('DIRECT', 'GROUP');
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if v_secure then
    if p_mime is distinct from 'application/x-amuwa-e2ee' then
      raise exception 'VALIDATION_ERROR: Files in this chat are encrypted before they are sent. Reload the page and try again.' using errcode = 'P0001';
    end if;
  elsif p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                       'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                       'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be sent. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  v_max := case when v_secure then 5242944 else 5242880 end;
  if p_size is null or p_size < 1 or p_size > v_max then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_attachments t where t.uploader_id = me and t.status = 'PENDING' and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'FAILED' where uploader_id = me and status = 'PENDING' and created_at < now() - interval '1 day';
  insert into public.chat_attachments (id, conversation_id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, p_conversation, me, case when v_secure then 'encrypted-file' else v_name end, p_mime, p_size,
          format('%s/%s/%s', p_conversation, v_id, case when v_secure then 'file.enc' else private.chat_clean_name(v_name) end))
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- The conversations follow the stage
-- ---------------------------------------------------------------------------
-- A change of the hand-over team is told to the Relationship Manager's conversation (the Meta conversation is not touched).
create or replace function private.tg_chat_team_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_conv uuid;
  v_team jsonb;
begin
  begin
    -- the same function serves customers (id) and customer_onboarding (customer_id)
    v_customer := (to_jsonb(new) ->> case when tg_table_name = 'customers' then 'id' else 'customer_id' end)::uuid;
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = v_customer and channel = 'RM';
    if v_conv is not null then
      v_team := private.chat_team_json(v_customer);
      perform private.chat_system_message(v_conv, format('Your assigned team was updated. Relationship Manager: %s. Team Lead: %s.',
        coalesce(v_team -> 'teamMember' ->> 'name', 'not assigned yet'), coalesce(v_team -> 'teamLead' ->> 'name', 'not assigned yet')));
    end if;
  exception when others then
    -- chat must never stop a hand-over
    raise warning 'chat: could not record the team change for customer %: %', v_customer, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_chat_team_changed() from public, anon, authenticated;

-- The Meta verification conversation records each change of the status as a line (the client sees what happened and when).
create or replace function private.tg_chat_meta_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_text text;
begin
  begin
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = new.customer_id and channel = 'META';
    v_text := case new.meta_status
      when 'IN_PROGRESS' then 'Meta verification is in progress.'
      when 'DOCUMENTS_REQUIRED' then 'Documents required: ' || coalesce(new.meta_feedback, 'please check your Onboarding Journey.')
      when 'REJECTED' then 'Meta verification was not approved: ' || coalesce(new.meta_feedback, 'please check your Onboarding Journey.')
      when 'COMPLETED' then 'Meta verification is completed. This conversation is now closed and kept for reference. Your Relationship Manager continues with you in the Relationship Manager chat.'
      end;
    if v_conv is not null and v_text is not null then
      perform private.chat_system_message(v_conv, v_text);
    end if;
  exception when others then
    raise warning 'chat: could not record the Meta status for customer %: %', new.customer_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_chat_meta_changed() from public, anon, authenticated;
drop trigger if exists chat_meta_changed on public.customer_onboarding;
create trigger chat_meta_changed after update on public.customer_onboarding
  for each row when (old.meta_status is distinct from new.meta_status)
  execute function private.tg_chat_meta_changed();

do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'chat\_%' loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
