-- Run this ONE file once in the Supabase SQL editor (safe to run again). It is the migration 20261215000100_consultant_meta_workflows.sql.
-- It needs the Meta Verifier, add-on and client onboarding journey migrations (up to 20261213000100) applied already.

-- =============================================================================
-- Two independent workflows for ONE customer: the Technical Consultant's and the Meta Verifier's.
-- Safe to run again; nothing is deleted or rewritten. Run after 20261213000100_work_reports.sql.
--
--   Technical Consultant = technical verification + add-on services + add-on purchase tracking + technical processing.
--   Meta Verifier        = normal customer onboarding (document verification and hand-over) only.
--
-- What was wrong: a customer on the Meta route was hidden from the Technical Consultant until the Meta Verifier handed it to the Department
-- Head, and the Technical Consultant could only work on a customer in the verification stage, so after any hand-over the add-ons, the
-- payment follow-up and the technical processing had no owner or status. There was one shared onboarding state for both roles.
--
-- Now (the same customers table and the same customer_onboarding record, nothing is copied):
--   * customer_workflow_status: ONE row per customer with two separate status fields, tc_status and meta_status. A role can change only
--     its own field (customer_workflow_set_tc / customer_workflow_set_meta); neither function reads or writes the other's field.
--   * customer_workflow_events: the history of every change of either field (system or person, who, when, note).
--   * Each field follows REAL events by itself (forwarded to support, documents reviewed, hand-over, add-on request, invoice, payment pending,
--     payment confirmed, processing started). A change made by a person stays until the underlying facts change again; ON HOLD (and for Meta
--     REJECTED) is never changed by the system.
--   * The Technical Consultant sees and keeps the customer from the moment Sales sends it, whatever the Meta Verifier does, and may work on the
--     add-ons at any time after that. Completing Meta onboarding never touches the Technical Consultant's status.
--   * Technical Consultant Completed is set only by a person, and only when no add-on request is still open (every purchase confirmed by
--     Accounts and processed) and the verification stage is closed. Technical Processing starts only when Accounts confirmed the payment.
--
-- The Meta Verifier status is built on the EXISTING Meta verification state (customer_onboarding.meta_status, moved by set_meta_verification and
-- required by the hand-over to the Department Head): the shared states are that field, mirrored, so there is one truth. Only what that field lacks
-- (On Hold, Verification Pending, Onboarding Pending before the verifier starts) lives in customer_workflow_status.
--
-- Accounts is unchanged: the add-on request, invoice, payment and confirmation functions are the same; this migration only READS them.
-- The Meta Verifier still has no part in add-ons (can_manage_addons is for the Technical Consultant).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.customer_workflow_status (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  -- Technical Consultant track
  tc_status text not null default 'NEW_LEAD' check (tc_status in (
    'NEW_LEAD', 'VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS', 'ADDON_SERVICES_RECOMMENDED', 'WAITING_FOR_CUSTOMER_PURCHASE',
    'PAYMENT_CONFIRMATION_PENDING', 'ADDON_PURCHASED', 'TECHNICAL_PROCESSING', 'COMPLETED', 'ON_HOLD')),
  tc_derived text not null default 'NEW_LEAD',          -- what the records say; a person's change stays until this changes
  tc_changed_at timestamptz not null default now(),
  tc_changed_by uuid references public.profiles (id) on delete set null,   -- null = the system
  tc_note text check (length(tc_note) <= 500),
  -- Meta Verifier track (null = this customer is not on the Meta route)
  meta_status text check (meta_status in (
    'ONBOARDING_PENDING', 'ONBOARDING_IN_PROGRESS', 'DOCUMENTS_PENDING', 'VERIFICATION_PENDING', 'ONBOARDING_COMPLETED', 'REJECTED', 'ON_HOLD')),
  meta_derived text,
  meta_changed_at timestamptz,
  meta_changed_by uuid references public.profiles (id) on delete set null,
  meta_note text check (length(meta_note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_workflow_status_tc_idx on public.customer_workflow_status (department_id, tc_status);
create index if not exists customer_workflow_status_meta_idx on public.customer_workflow_status (department_id, meta_status) where meta_status is not null;

create table if not exists public.customer_workflow_events (
  id bigint generated always as identity primary key,
  customer_id uuid not null references public.customers (id) on delete cascade,
  track text not null check (track in ('TECHNICAL_CONSULTANT', 'META_VERIFIER')),
  from_status text,
  to_status text not null,
  source text not null check (source in ('SYSTEM', 'USER')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  note text check (length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists customer_workflow_events_idx on public.customer_workflow_events (customer_id, id desc);

alter table public.customer_workflow_status enable row level security;
alter table public.customer_workflow_events enable row level security;
revoke all on public.customer_workflow_status, public.customer_workflow_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The statuses that follow the records
-- ---------------------------------------------------------------------------
-- An add-on request that still needs work: the customer has not finished buying or the Technical Consultant has not finished processing.
create or replace function private.wf_addon_open(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.addon_requests r where r.customer_id = p_customer
                  and (r.status in ('PENDING_VERIFICATION', 'APPROVED', 'INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS')
                       or (r.status in ('DRAFT', 'CHANGES_REQUESTED')
                           and coalesce((select o.addons_required from public.customer_onboarding o where o.customer_id = p_customer), false))))
$$;
revoke all on function private.wf_addon_open(uuid) from public, anon, authenticated;

-- The Technical Consultant status the records say. The verification stage and the add-on stage run side by side; the further one wins.
--   0 New lead  1 Verification pending  2 Verification in progress  3 Add-on services recommended  4 Waiting for customer purchase
--   5 Payment confirmation pending  6 Add-on purchased (Accounts confirmed)  7 Technical processing
create or replace function private.wf_tc_derive(p_customer uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  ladder constant text[] := array['NEW_LEAD', 'VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS', 'ADDON_SERVICES_RECOMMENDED',
                                  'WAITING_FOR_CUSTOMER_PURCHASE', 'PAYMENT_CONFIRMATION_PENDING', 'ADDON_PURCHASED', 'TECHNICAL_PROCESSING'];
  o public.customer_onboarding;
  r public.addon_requests;
  v_vp integer;
  v_ap integer := 0;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.customer_id is null or not o.with_consultant then return 'NEW_LEAD'; end if;
  if o.handover_stage <> 'CONSULTANT' then
    -- the first verification is finished: nothing bought yet. The consultant still has the add-ons to offer (or the customer declined).
    v_vp := case when o.addons_required is false then 4 else 3 end;
  elsif o.items_verified > 0 or o.items_rejected > 0 or o.returned_at is not null or o.consultant_started_at is not null then
    v_vp := 2;
  else
    v_vp := 1;
  end if;
  select * into r from public.addon_requests where customer_id = p_customer order by created_at desc, id desc limit 1;
  if r.id is not null and r.status not in ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED') then
    v_ap := case r.status
      when 'PENDING_VERIFICATION' then 4
      when 'APPROVED' then 4
      when 'INVOICE_GENERATED' then case when exists (select 1 from public.addon_payments pp where pp.request_id = r.id and pp.status = 'PENDING') then 5 else 4 end
      when 'PAYMENT_CONFIRMED' then 6
      else 7 end;                                  -- IN_PROGRESS, COMPLETED (the consultant still marks the customer Completed)
  end if;
  return ladder[greatest(v_vp, v_ap) + 1];
end $$;
revoke all on function private.wf_tc_derive(uuid) from public, anon, authenticated;

-- The Meta Verifier status the records say: only for a customer on the Meta route that Sales has sent; null otherwise. It mirrors the existing
-- Meta verification state (customer_onboarding.meta_status) and adds the steps that state does not have.
create or replace function private.wf_meta_derive(p_customer uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.customer_id is null or not o.with_consultant or private.onboarding_route(p_customer) <> 'META' then return null; end if;
  if o.handover_stage <> 'CONSULTANT' or o.meta_status = 'COMPLETED' then return 'ONBOARDING_COMPLETED'; end if;
  if o.meta_status = 'REJECTED' then return 'REJECTED'; end if;
  if o.meta_status = 'DOCUMENTS_REQUIRED' or o.returned_at is not null or o.items_rejected > 0 then return 'DOCUMENTS_PENDING'; end if;
  if o.consultant_started_at is null then return 'ONBOARDING_PENDING'; end if;
  if o.items_total > 0 and o.items_verified >= o.items_total then return 'VERIFICATION_PENDING'; end if;   -- all authorized, waiting to be completed / handed over
  return 'ONBOARDING_IN_PROGRESS';
end $$;
revoke all on function private.wf_meta_derive(uuid) from public, anon, authenticated;

-- Bring both fields up to date with the records. Each field is changed from its own facts only.
create or replace function private.wf_refresh(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  w public.customer_workflow_status;
  d_tc text;
  d_meta text;
begin
  insert into public.customer_workflow_status (customer_id, department_id)
  select c.id, c.department_id from public.customers c where c.id = p_customer
  on conflict (customer_id) do nothing;
  select * into w from public.customer_workflow_status where customer_id = p_customer for update;
  if w.customer_id is null then return; end if;

  d_tc := private.wf_tc_derive(p_customer);
  if d_tc is distinct from w.tc_derived then
    update public.customer_workflow_status set tc_derived = d_tc, updated_at = now() where customer_id = p_customer;
    -- ON HOLD is never changed by the system; a Completed customer is re-opened only by a new open add-on request
    if w.tc_status <> 'ON_HOLD' and d_tc <> w.tc_status and (w.tc_status <> 'COMPLETED' or private.wf_addon_open(p_customer)) then
      update public.customer_workflow_status set tc_status = d_tc, tc_changed_at = now(), tc_changed_by = null, tc_note = null where customer_id = p_customer;
      insert into public.customer_workflow_events (customer_id, track, from_status, to_status, source)
      values (p_customer, 'TECHNICAL_CONSULTANT', w.tc_status, d_tc, 'SYSTEM');
    end if;
  end if;

  d_meta := private.wf_meta_derive(p_customer);
  if d_meta is distinct from w.meta_derived then
    update public.customer_workflow_status set meta_derived = d_meta, updated_at = now() where customer_id = p_customer;
    if d_meta is not null and coalesce(w.meta_status, '') <> 'ON_HOLD' and d_meta is distinct from w.meta_status then
      update public.customer_workflow_status set meta_status = d_meta, meta_changed_at = now(), meta_changed_by = null, meta_note = null where customer_id = p_customer;
      insert into public.customer_workflow_events (customer_id, track, from_status, to_status, source)
      values (p_customer, 'META_VERIFIER', w.meta_status, d_meta, 'SYSTEM');
    end if;
  end if;
end $$;
revoke all on function private.wf_refresh(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Triggers: every real event refreshes the statuses
-- ---------------------------------------------------------------------------
create or replace function private.tg_customer_workflow_new()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_workflow_status (customer_id, department_id) values (new.id, new.department_id) on conflict (customer_id) do nothing;
  if found then
    insert into public.customer_workflow_events (customer_id, track, from_status, to_status, source) values (new.id, 'TECHNICAL_CONSULTANT', null, 'NEW_LEAD', 'SYSTEM');
  end if;
  return new;
end $$;
revoke all on function private.tg_customer_workflow_new() from public, anon, authenticated;
drop trigger if exists customers_workflow_new on public.customers;
create trigger customers_workflow_new after insert on public.customers for each row execute function private.tg_customer_workflow_new();

create or replace function private.tg_workflow_refresh_onboarding()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.wf_refresh(new.customer_id);
  return null;
end $$;
revoke all on function private.tg_workflow_refresh_onboarding() from public, anon, authenticated;
drop trigger if exists customer_onboarding_workflow on public.customer_onboarding;
create trigger customer_onboarding_workflow after insert or update of forwarded_to_support_at, returned_at, handover_stage, items_total, items_saved,
    items_verified, items_rejected, consultant_started_at, addons_required, addon_request_status, verification_route, meta_status
  on public.customer_onboarding for each row execute function private.tg_workflow_refresh_onboarding();

create or replace function private.tg_workflow_refresh_addon()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
begin
  if tg_table_name = 'addon_requests' then
    v_customer := new.customer_id;
  else
    select r.customer_id into v_customer from public.addon_requests r where r.id = new.request_id;
  end if;
  if v_customer is not null then perform private.wf_refresh(v_customer); end if;
  return null;
end $$;
revoke all on function private.tg_workflow_refresh_addon() from public, anon, authenticated;
drop trigger if exists addon_requests_workflow on public.addon_requests;
create trigger addon_requests_workflow after insert or update of status on public.addon_requests for each row execute function private.tg_workflow_refresh_addon();
drop trigger if exists addon_payments_workflow on public.addon_payments;
create trigger addon_payments_workflow after insert or update of status on public.addon_payments for each row execute function private.tg_workflow_refresh_addon();

-- ---------------------------------------------------------------------------
-- 4. The Technical Consultant keeps the customer, whatever the Meta Verifier does
-- ---------------------------------------------------------------------------
-- The customer is visible to the Technical Consultant from the moment Sales sends it (the policy on customers also requires that).
create or replace function private.consult_visible(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select true
$$;
revoke all on function private.consult_visible(uuid) from public, anon;
grant execute on function private.consult_visible(uuid) to authenticated, service_role;

-- Consultation (add-ons, "contacted", the customer's details) belongs to the Technical Consultant of the department at any time after Sales
-- sent the customer: in the verification stage, after the hand-over, and while the Meta Verifier is still onboarding. Verification itself
-- (can_review_onboarding) is unchanged: the Meta Verifier for a Meta customer, the Technical Consultant for the other route, closed at the hand-over.
create or replace function private.can_consult_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.forwarded_to_support_at is not null
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;
revoke all on function private.can_consult_customer(uuid) from public, anon;
grant execute on function private.can_consult_customer(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Who may read and who may change which status
-- ---------------------------------------------------------------------------
create or replace function private.wf_can_tc(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.customer_onboarding o on o.customer_id = c.id
     where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.with_consultant
       and (private.my_role() = 'SUPER_ADMIN'
         or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
         or c.department_id = private.my_support_department_id()))
$$;
revoke all on function private.wf_can_tc(uuid) from public, anon, authenticated;

create or replace function private.wf_can_meta(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.customer_onboarding o on o.customer_id = c.id
     where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.with_consultant
       and private.onboarding_route(c.id) = 'META'
       and (private.my_role() = 'SUPER_ADMIN'
         or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
         or c.department_id = private.my_verifier_department_id()))
$$;
revoke all on function private.wf_can_meta(uuid) from public, anon, authenticated;

create or replace function private.wf_json(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  w public.customer_workflow_status;
  o public.customer_onboarding;
  r public.addon_requests;
begin
  select * into w from public.customer_workflow_status where customer_id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into r from public.addon_requests where customer_id = p_customer order by created_at desc, id desc limit 1;
  return jsonb_build_object(
    'customerId', p_customer,
    'technicalConsultant', jsonb_build_object('status', coalesce(w.tc_status, 'NEW_LEAD'), 'since', w.tc_changed_at, 'note', w.tc_note,
        'by', (select p.full_name from public.profiles p where p.id = w.tc_changed_by), 'source', case when w.tc_changed_by is null then 'SYSTEM' else 'USER' end,
        'sentBySales', coalesce(o.with_consultant, false)),
    'metaVerifier', jsonb_build_object('applicable', w.meta_status is not null or private.wf_meta_derive(p_customer) is not null,
        'status', w.meta_status, 'since', w.meta_changed_at, 'note', w.meta_note,
        'by', (select p.full_name from public.profiles p where p.id = w.meta_changed_by), 'source', case when w.meta_changed_by is null then 'SYSTEM' else 'USER' end),
    'canSetTechnicalConsultant', private.wf_can_tc(p_customer),
    'canSetMetaVerifier', private.wf_can_meta(p_customer),
    'addon', jsonb_build_object('latestStatus', r.status, 'open', private.wf_addon_open(p_customer), 'addonsRequired', o.addons_required,
        'paymentPending', exists (select 1 from public.addon_payments pp where pp.request_id = r.id and pp.status = 'PENDING')),
    'onboarding', jsonb_build_object('handedOver', coalesce(o.handover_stage <> 'CONSULTANT', false), 'itemsTotal', o.items_total, 'itemsVerified', o.items_verified),
    'history', coalesce((select jsonb_agg(jsonb_build_object('track', e.track, 'from', e.from_status, 'to', e.to_status, 'source', e.source,
                'by', e.actor_name, 'note', e.note, 'at', e.created_at) order by e.id desc)
                from (select * from public.customer_workflow_events where customer_id = p_customer order by id desc limit 50) e), '[]'::jsonb));
end $$;
revoke all on function private.wf_json(uuid) from public, anon, authenticated;

create or replace function public.customer_workflow_get(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_view_addons(p_customer) and not private.wf_can_tc(p_customer) and not private.wf_can_meta(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  perform private.wf_refresh(p_customer);          -- the answer is always what the records say now
  return private.wf_json(p_customer);
end $$;

-- The two statuses of several customers (a list page): only the ones the caller may see.
create or replace function public.customer_workflow_statuses(p_ids uuid[])
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(w.customer_id, jsonb_build_object('technicalConsultant', w.tc_status, 'metaVerifier', w.meta_status)), '{}'::jsonb)
    from public.customer_workflow_status w
   where w.customer_id = any (p_ids[1:200])
     and (private.can_view_addons(w.customer_id) or private.wf_can_tc(w.customer_id) or private.wf_can_meta(w.customer_id))
$$;

-- ---------------------------------------------------------------------------
-- 6. Changing a status by hand (each role its own field only)
-- ---------------------------------------------------------------------------
create or replace function public.customer_workflow_set_tc(p_customer uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  o public.customer_onboarding;
  w public.customer_workflow_status;
  me public.profiles;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.wf_can_tc(p_customer) then
    if private.can_view_addons(p_customer) then
      raise exception 'FORBIDDEN: Only the Technical Consultant of the department changes this status.' using errcode = '42501';
    end if;
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status in ('NEW_LEAD', 'PAYMENT_CONFIRMATION_PENDING', 'ADDON_PURCHASED') then
    raise exception 'VALIDATION_ERROR: This status is set by the customer''s add-on request and Accounts'' payment confirmation, not by hand.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS', 'ADDON_SERVICES_RECOMMENDED', 'WAITING_FOR_CUSTOMER_PURCHASE',
                                          'TECHNICAL_PROCESSING', 'COMPLETED', 'ON_HOLD') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the note under 500 characters.' using errcode = 'P0001';
  end if;
  if p_status = 'ON_HOLD' and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give the reason for putting the customer on hold.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  perform private.wf_refresh(p_customer);
  select * into w from public.customer_workflow_status where customer_id = p_customer for update;
  if w.tc_status = p_status then
    raise exception 'CONFLICT: The customer already has this status.' using errcode = 'P0001';
  end if;
  -- processing starts only when every purchase is paid and confirmed; completion only when nothing is open
  if p_status in ('TECHNICAL_PROCESSING', 'COMPLETED') and private.wf_addon_open(p_customer)
     and exists (select 1 from public.addon_requests r where r.customer_id = p_customer and r.status in ('PENDING_VERIFICATION', 'APPROVED', 'INVOICE_GENERATED', 'DRAFT', 'CHANGES_REQUESTED')
                  and (r.status in ('PENDING_VERIFICATION', 'APPROVED', 'INVOICE_GENERATED') or coalesce(o.addons_required, false))) then
    raise exception 'CONFLICT: An add-on request is still waiting for the customer''s purchase or Accounts'' payment confirmation. Technical processing starts when Accounts confirms the payment.' using errcode = 'P0001';
  end if;
  if p_status = 'COMPLETED' then
    if o.handover_stage = 'CONSULTANT' then
      raise exception 'CONFLICT: The first verification is not finished yet.' using errcode = 'P0001';
    end if;
    if private.wf_addon_open(p_customer) then
      raise exception 'CONFLICT: An add-on purchase is still being processed. Complete it first.' using errcode = 'P0001';
    end if;
  end if;
  select * into me from public.profiles where id = auth.uid();
  update public.customer_workflow_status
     set tc_status = p_status, tc_changed_at = now(), tc_changed_by = me.id, tc_note = v_note, updated_at = now()
   where customer_id = p_customer;
  insert into public.customer_workflow_events (customer_id, track, from_status, to_status, source, actor_id, actor_name, note)
  values (p_customer, 'TECHNICAL_CONSULTANT', w.tc_status, p_status, 'USER', me.id, me.full_name, v_note);
  perform private.write_audit('CUSTOMER_TC_STATUS_SET', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('from', w.tc_status, 'to', p_status, 'note', v_note));
  return private.wf_json(p_customer);
end $$;

create or replace function public.customer_workflow_set_meta(p_customer uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  w public.customer_workflow_status;
  me public.profiles;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_existing text;
  v_new text;
begin
  if not private.wf_can_meta(p_customer) then
    if private.can_view_addons(p_customer) then
      if private.wf_meta_derive(p_customer) is null then
        raise exception 'CONFLICT: This customer is not on the Meta Verifier route (or has not been sent yet).' using errcode = 'P0001';
      end if;
      raise exception 'FORBIDDEN: Only the Meta Verifier of the department changes this status.' using errcode = '42501';
    end if;
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('ONBOARDING_PENDING', 'ONBOARDING_IN_PROGRESS', 'DOCUMENTS_PENDING', 'VERIFICATION_PENDING', 'ONBOARDING_COMPLETED', 'REJECTED', 'ON_HOLD') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the note under 500 characters.' using errcode = 'P0001';
  end if;
  if p_status in ('REJECTED', 'ON_HOLD', 'DOCUMENTS_PENDING') and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give the reason (it is shown to the client for documents and rejections).' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  perform private.wf_refresh(p_customer);
  select * into w from public.customer_workflow_status where customer_id = p_customer for update;
  if w.meta_status is not distinct from p_status then
    raise exception 'CONFLICT: The customer already has this status.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();

  -- The states the Meta verification already has are changed THROUGH it (one truth; its rules and the client's journey apply).
  v_existing := case p_status when 'ONBOARDING_IN_PROGRESS' then 'IN_PROGRESS' when 'DOCUMENTS_PENDING' then 'DOCUMENTS_REQUIRED'
                              when 'REJECTED' then 'REJECTED' when 'ONBOARDING_COMPLETED' then 'COMPLETED' end;
  if v_existing is not null then
    perform public.set_meta_verification(p_customer, v_existing, v_note);
    v_new := private.wf_meta_derive(p_customer);
  else
    v_new := p_status;                              -- On Hold, Verification Pending, Onboarding Pending: kept here
  end if;
  update public.customer_workflow_status
     set meta_status = v_new, meta_changed_at = now(), meta_changed_by = me.id, meta_note = v_note, meta_derived = private.wf_meta_derive(p_customer), updated_at = now()
   where customer_id = p_customer;
  insert into public.customer_workflow_events (customer_id, track, from_status, to_status, source, actor_id, actor_name, note)
  values (p_customer, 'META_VERIFIER', w.meta_status, v_new, 'USER', me.id, me.full_name, v_note);
  perform private.write_audit('CUSTOMER_META_STATUS_SET', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('from', w.meta_status, 'to', v_new, 'note', v_note));
  return private.wf_json(p_customer);
end $$;

revoke all on function public.customer_workflow_get(uuid) from public, anon;
revoke all on function public.customer_workflow_statuses(uuid[]) from public, anon;
revoke all on function public.customer_workflow_set_tc(uuid, text, text) from public, anon;
revoke all on function public.customer_workflow_set_meta(uuid, text, text) from public, anon;
grant execute on function public.customer_workflow_get(uuid) to authenticated;
grant execute on function public.customer_workflow_statuses(uuid[]) to authenticated;
grant execute on function public.customer_workflow_set_tc(uuid, text, text) to authenticated;
grant execute on function public.customer_workflow_set_meta(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Existing customers: one row each, brought up to date from the records (changes nothing that is already in flight)
-- ---------------------------------------------------------------------------
insert into public.customer_workflow_status (customer_id, department_id)
select c.id, c.department_id from public.customers c on conflict (customer_id) do nothing;
insert into public.customer_workflow_events (customer_id, track, from_status, to_status, source)
select w.customer_id, 'TECHNICAL_CONSULTANT', null, 'NEW_LEAD', 'SYSTEM' from public.customer_workflow_status w
 where not exists (select 1 from public.customer_workflow_events e where e.customer_id = w.customer_id);
do $$
declare
  r record;
begin
  for r in select o.customer_id from public.customer_onboarding o where o.with_consultant loop
    perform private.wf_refresh(r.customer_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
