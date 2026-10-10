-- =============================================================================
-- Sales pipeline: Lead → Potential → Onboarding, and customer documents.
--
-- One customer = one row in public.customers for its whole life. The stage
-- is a column (lifecycle_stage); there are no per-stage copies. Everything
-- else (services, onboarding, documents, activity) references customers.id.
--
--   customers.lifecycle_stage   LEAD → POTENTIAL → ONBOARDING → CUSTOMER (or LOST)
--   customers.lead_status       NEW → CONTACTED → INTERESTED → READY_TO_BUY (while LEAD)
--   customer_services           services the customer is interested in / bought
--   customer_onboarding         1:1 onboarding record (stage, payment method, handover)
--   customer_documents          versioned file metadata; files live in the
--                               private Storage bucket "customer-documents"
--
-- Stage changes, payments and document state changes happen ONLY through the
-- SECURITY DEFINER workflow functions below, which re-check access with the
-- same hierarchy rules as the customers RLS policies and write audit rows.
-- Existing rows stay CUSTOMER, so "My Customers" keeps working unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Customers: lifecycle + lead + payment fields (additive, backward compatible)
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists lifecycle_stage text not null default 'CUSTOMER',
  add column if not exists lead_status text not null default 'NEW',
  add column if not exists whatsapp text,
  add column if not exists city text,
  add column if not exists business_category text,
  add column if not exists lead_source text,
  add column if not exists next_follow_up_at timestamptz,
  add column if not exists expected_budget numeric(14, 2),
  add column if not exists deal_amount numeric(14, 2),
  add column if not exists amount_received numeric(14, 2) not null default 0,
  add column if not exists payment_due_date date,
  add column if not exists stage_changed_at timestamptz not null default now(),
  add column if not exists source_lead_id text;

do $$
begin
  alter table public.customers add constraint customers_lifecycle_stage_check
    check (lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER', 'LOST'));
  alter table public.customers add constraint customers_lead_status_check
    check (lead_status in ('NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY'));
  alter table public.customers add constraint customers_whatsapp_check
    check (whatsapp is null or whatsapp ~ '^[0-9+()\-\s.]{5,25}$');
  alter table public.customers add constraint customers_lead_text_lengths
    check (length(city) <= 120 and length(business_category) <= 120 and length(lead_source) <= 60);
  alter table public.customers add constraint customers_money_check
    check (coalesce(expected_budget, 0) >= 0 and coalesce(deal_amount, 0) >= 0 and amount_received >= 0
           and (deal_amount is null or amount_received <= deal_amount));
  alter table public.customers add constraint customers_source_lead_key unique (source_lead_id);
exception when duplicate_object or duplicate_table then null;
end $$;

-- Pipeline queries filter by stage inside the caller's scope.
create index if not exists customers_owner_stage_idx on public.customers (owner_id, lifecycle_stage, updated_at desc);
create index if not exists customers_team_stage_idx on public.customers (team_id, lifecycle_stage, updated_at desc);
create index if not exists customers_department_stage_idx on public.customers (department_id, lifecycle_stage, updated_at desc);
create index if not exists customers_follow_up_idx on public.customers (next_follow_up_at) where lifecycle_stage = 'LEAD';
create index if not exists customers_payment_due_idx on public.customers (payment_due_date) where lifecycle_stage = 'POTENTIAL';

-- Clients may create LEAD or CUSTOMER rows; every later stage is reached
-- through a workflow function. Lead status only moves while a row is a LEAD.
create or replace function private.tg_customers_lifecycle_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.lifecycle_stage not in ('LEAD', 'CUSTOMER') then
      raise exception 'VALIDATION_ERROR: New records start as a lead or a customer.' using errcode = 'P0001';
    end if;
    new.stage_changed_at := now();
    return new;
  end if;
  if new.lifecycle_stage is distinct from old.lifecycle_stage then
    new.stage_changed_at := now();
  end if;
  if new.lead_status is distinct from old.lead_status and old.lifecycle_stage <> 'LEAD' then
    raise exception 'VALIDATION_ERROR: Lead status can only change while the customer is a lead.' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists customers_lifecycle_guard on public.customers;
create trigger customers_lifecycle_guard before insert or update on public.customers
  for each row execute function private.tg_customers_lifecycle_guard();

-- Column grants: lead fields are editable; stage, payment and source link are not.
grant insert (lifecycle_stage, lead_status, whatsapp, city, business_category, lead_source,
              next_follow_up_at, expected_budget) on public.customers to authenticated;
grant update (lead_status, whatsapp, city, business_category, lead_source,
              next_follow_up_at, expected_budget) on public.customers to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Access helper (same rule as the customers RLS policies)
-- ---------------------------------------------------------------------------
create or replace function private.can_access_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.my_role() = 'TEAM_HEAD' and c.team_id = private.my_team_id())
        or (private.my_role() = 'TEAM_MEMBER' and c.owner_id = private.my_id()))
  )
$$;
revoke all on function private.can_access_customer(uuid) from public, anon;
grant execute on function private.can_access_customer(uuid) to authenticated, service_role;

-- Loads a customer the caller may work on, locked for update, or raises NOT_FOUND
-- (no existence leak for customers outside the caller's scope).
create or replace function private.lock_accessible_customer(p_customer uuid)
returns public.customers language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
begin
  if not private.can_access_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  return v;
end $$;
revoke all on function private.lock_accessible_customer(uuid) from public, anon, authenticated;

create or replace function private.log_customer_activity(p_customer uuid, p_type text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.customer_activities (customer_id, type, note) values (p_customer, p_type, left(p_note, 5000))
$$;
revoke all on function private.log_customer_activity(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Services catalog + customer_services
-- ---------------------------------------------------------------------------
create table if not exists public.crm_services (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  name text not null check (length(name) between 2 and 120),
  category text not null check (length(category) between 2 and 60),
  sort_order integer not null default 0,
  is_active boolean not null default true
);

insert into public.crm_services (code, name, category, sort_order) values
  ('WHATSAPP_API_BLUE_TICK', 'WhatsApp API + Blue Tick', 'Messaging & AI', 10),
  ('RCS_REGISTRATION', 'RCS Registration', 'Messaging & AI', 20),
  ('AI_CALLING', 'AI Calling', 'Messaging & AI', 30),
  ('VOICE_MESSAGE_BULK', 'Voice Message (Bulk)', 'Messaging & AI', 40),
  ('AI_QR', 'AI QR', 'Messaging & AI', 50),
  ('CROCODILE_CHANNEL_WEBHOOK', 'Crocodile (Channel / Webhook)', 'Messaging & AI', 60),
  ('AI_CRM', 'AI CRM', 'Messaging & AI', 70),
  ('GBP_SETUP', 'Google Business Profile - Setup', 'Google & Social', 110),
  ('GBP_MANAGEMENT', 'Google Business Profile - Management', 'Google & Social', 120),
  ('META_ADS_MANAGEMENT', 'Meta Ads Management', 'Google & Social', 130),
  ('SOCIAL_MEDIA_MANAGEMENT', 'Social Media Management', 'Google & Social', 140),
  ('STARTER_PACKAGE', 'Starter Package', 'Google & Social', 150),
  ('GROWTH_PACKAGE', 'Growth Package', 'Google & Social', 160),
  ('AI_CHARACTER_VIDEO', 'AI Character Video', 'Video & Content', 210),
  ('BASIC_VIDEO_EDITING_REEL', 'Basic Video Editing (Reel)', 'Video & Content', 220),
  ('CONTENT_SHOOT', 'Content Shoot', 'Video & Content', 230),
  ('SINGLE_CREATIVE_DESIGN', 'Single Creative Design', 'Creative & Branding', 310),
  ('YEARLY_FESTIVAL_CREATIVE_PACKAGE', 'Yearly Festival Creative Package', 'Creative & Branding', 320),
  ('YEARLY_GOLD_RATE_PACKAGE', 'Yearly Gold Rate Package', 'Creative & Branding', 330),
  ('YEARLY_PROMOTIONAL_CREATIVE_PACKAGE', 'Yearly Promotional Creative Package', 'Creative & Branding', 340),
  ('BRANDING_PERSONAL_BRANDING', 'Branding / Personal Branding', 'Creative & Branding', 350)
on conflict (code) do nothing;

create table if not exists public.customer_services (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (customer_id, service_code)
);
create index if not exists customer_services_service_idx on public.customer_services (service_code, customer_id);

-- ---------------------------------------------------------------------------
-- 4. Onboarding (1:1 with the customer)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_onboarding (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  stage text not null default 'COLLECT_REQUIREMENTS'
    check (stage in ('SALES_CONSULTATION', 'COLLECT_REQUIREMENTS', 'SETUP', 'APPROVAL', 'HANDOVER', 'COMPLETED')),
  payment_method text check (payment_method in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  started_at timestamptz not null default now(),
  started_by uuid references public.profiles (id) on delete set null,
  target_handover_date date,
  forwarded_to_support_at timestamptz,
  forwarded_by uuid references public.profiles (id) on delete set null,
  -- Number of mandatory document types with a current file (kept by the document functions).
  mandatory_saved integer not null default 0 check (mandatory_saved >= 0),
  updated_at timestamptz not null default now()
);
create index if not exists customer_onboarding_progress_idx on public.customer_onboarding (mandatory_saved);
drop trigger if exists customer_onboarding_set_updated_at on public.customer_onboarding;
create trigger customer_onboarding_set_updated_at before update on public.customer_onboarding
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Documents: types (extensible) + versioned metadata
-- ---------------------------------------------------------------------------
create table if not exists public.document_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,59}$'),
  label text not null,
  description text not null default '',
  storage_folder text not null check (storage_folder ~ '^[a-z][a-z0-9_-]{1,30}$'),
  is_mandatory boolean not null default false,
  allowed_mime_types text[] not null,
  max_size_bytes bigint not null check (max_size_bytes between 1 and 52428800),
  sort_order integer not null default 0
);

insert into public.document_types (code, label, description, storage_folder, is_mandatory, allowed_mime_types, max_size_bytes, sort_order) values
  ('INVOICE', 'Invoice', 'Invoice issued to the customer.', 'invoices', true, array['application/pdf'], 10485760, 10),
  ('IMPORTANT_DOCUMENTS', 'All Important Documents',
   'Upload the customer''s important business documents, such as Aadhaar Card, PAN Card and other required documents, combined into a single PDF.',
   'onboarding', true, array['application/pdf'], 20971520, 20)
on conflict (code) do nothing;

create table if not exists public.customer_documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  document_type text not null references public.document_types (code) on delete restrict,
  -- Assigned when an upload succeeds, so failed attempts don't consume versions.
  version integer check (version >= 1),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'UPLOADED', 'SUPERSEDED', 'DELETED', 'FAILED')),
  storage_bucket text not null default 'customer-documents',
  storage_path text not null unique,
  original_file_name text not null check (length(original_file_name) between 1 and 255),
  mime_type text not null check (length(mime_type) <= 100),
  size_bytes bigint check (size_bytes > 0),
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  uploaded_at timestamptz,
  deleted_at timestamptz,
  deleted_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (customer_id, document_type, version),
  constraint customer_documents_stored_has_version check (status in ('PENDING', 'FAILED') or version is not null),
  constraint customer_documents_uploaded_has_size check (status <> 'UPLOADED' or (size_bytes is not null and uploaded_at is not null))
);
-- Exactly one current file per (customer, type); older versions are SUPERSEDED, never lost.
create unique index if not exists customer_documents_one_current_key
  on public.customer_documents (customer_id, document_type) where status = 'UPLOADED';
create index if not exists customer_documents_customer_idx on public.customer_documents (customer_id, document_type, version desc);
create index if not exists customer_documents_pending_idx on public.customer_documents (created_at) where status = 'PENDING';
drop trigger if exists customer_documents_set_updated_at on public.customer_documents;
create trigger customer_documents_set_updated_at before update on public.customer_documents
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Private storage bucket. No storage.objects policies are created on
--    purpose: browsers never touch the bucket directly. The API issues
--    single-path signed upload URLs and short-lived signed download URLs only
--    after the database has authorized the caller.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-documents', 'customer-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 7. RLS + grants
-- ---------------------------------------------------------------------------
alter table public.crm_services enable row level security;
alter table public.customer_services enable row level security;
alter table public.customer_onboarding enable row level security;
alter table public.document_types enable row level security;
alter table public.customer_documents enable row level security;
revoke all on public.crm_services, public.customer_services, public.customer_onboarding,
  public.document_types, public.customer_documents from anon, authenticated;

grant select on public.crm_services, public.document_types to authenticated;
drop policy if exists crm_services_select on public.crm_services;
create policy crm_services_select on public.crm_services for select to authenticated
  using ((select private.my_id()) is not null);
drop policy if exists document_types_select on public.document_types;
create policy document_types_select on public.document_types for select to authenticated
  using ((select private.my_id()) is not null);

-- Services follow the customer's visibility (the subquery is RLS-filtered).
grant select, insert, delete on public.customer_services to authenticated;
drop policy if exists customer_services_select on public.customer_services;
create policy customer_services_select on public.customer_services for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));
drop policy if exists customer_services_insert on public.customer_services;
create policy customer_services_insert on public.customer_services for insert to authenticated
  with check (exists (select 1 from public.customers c where c.id = customer_id));
drop policy if exists customer_services_delete on public.customer_services;
create policy customer_services_delete on public.customer_services for delete to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));

grant select on public.customer_onboarding to authenticated;
grant update (target_handover_date) on public.customer_onboarding to authenticated;
drop policy if exists customer_onboarding_select on public.customer_onboarding;
create policy customer_onboarding_select on public.customer_onboarding for select to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id));
drop policy if exists customer_onboarding_update on public.customer_onboarding;
create policy customer_onboarding_update on public.customer_onboarding for update to authenticated
  using (exists (select 1 from public.customers c where c.id = customer_id))
  with check (exists (select 1 from public.customers c where c.id = customer_id));

-- Document metadata is read-only for clients; every change goes through the
-- workflow functions (which also coordinate with Storage via the API).
grant select on public.customer_documents to authenticated;
drop policy if exists customer_documents_select on public.customer_documents;
create policy customer_documents_select on public.customer_documents for select to authenticated
  using (status <> 'DELETED' and exists (select 1 from public.customers c where c.id = customer_id));

create or replace function private.refresh_onboarding_progress(p_customer uuid)
returns void language sql security definer set search_path = '' as $$
  update public.customer_onboarding o set mandatory_saved = (
    select count(distinct d.document_type) from public.customer_documents d
    join public.document_types t on t.code = d.document_type and t.is_mandatory
    where d.customer_id = p_customer and d.status = 'UPLOADED')
  where o.customer_id = p_customer
$$;
revoke all on function private.refresh_onboarding_progress(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Lead functions (SECURITY INVOKER: the caller's RLS applies)
-- ---------------------------------------------------------------------------
create or replace function private.set_customer_services(p_customer uuid, p_codes text[])
returns void language plpgsql security invoker set search_path = '' as $$
begin
  if p_codes is null then return; end if;
  if exists (select 1 from unnest(p_codes) c where not exists (select 1 from public.crm_services s where s.code = c and s.is_active)) then
    raise exception 'VALIDATION_ERROR: Unknown service selected.' using errcode = 'P0001';
  end if;
  delete from public.customer_services where customer_id = p_customer and service_code <> all (p_codes);
  insert into public.customer_services (customer_id, service_code)
  select p_customer, c from unnest(p_codes) c on conflict do nothing;
end $$;
grant execute on function private.set_customer_services(uuid, text[]) to authenticated;

-- Creates a LEAD with its services in one transaction.
create or replace function public.create_lead(p_fields jsonb, p_services text[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;
  insert into public.customers (
    owner_id, lifecycle_stage, lead_status, name, company, phone, whatsapp, email, city,
    business_category, lead_source, next_follow_up_at, expected_budget, notes)
  values (
    (p_fields ->> 'ownerId')::uuid, 'LEAD', coalesce(p_fields ->> 'leadStatus', 'NEW'),
    p_fields ->> 'name', p_fields ->> 'company', p_fields ->> 'phone', p_fields ->> 'whatsapp',
    p_fields ->> 'email', p_fields ->> 'city', p_fields ->> 'businessCategory', p_fields ->> 'leadSource',
    (p_fields ->> 'nextFollowUpAt')::timestamptz, (p_fields ->> 'expectedBudget')::numeric, p_fields ->> 'notes')
  returning id into v_id;
  perform private.set_customer_services(v_id, p_services);
  insert into public.customer_activities (customer_id, type, note)
  values (v_id, 'LEAD_CREATED', 'Lead added' || coalesce(' from ' || nullif(p_fields ->> 'leadSource', ''), ''));
  return v_id;
end $$;

-- Partial update of lead fields (+ services when provided) in one transaction.
create or replace function public.update_lead(p_id uuid, p_fields jsonb, p_services text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.customers;
  v_new public.customers;
begin
  select * into v_old from public.customers where id = p_id;
  if v_old.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_services is not null and coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;

  update public.customers set
    name = case when p_fields ? 'name' then p_fields ->> 'name' else name end,
    company = case when p_fields ? 'company' then p_fields ->> 'company' else company end,
    phone = case when p_fields ? 'phone' then p_fields ->> 'phone' else phone end,
    whatsapp = case when p_fields ? 'whatsapp' then p_fields ->> 'whatsapp' else whatsapp end,
    email = case when p_fields ? 'email' then p_fields ->> 'email' else email end,
    city = case when p_fields ? 'city' then p_fields ->> 'city' else city end,
    business_category = case when p_fields ? 'businessCategory' then p_fields ->> 'businessCategory' else business_category end,
    lead_source = case when p_fields ? 'leadSource' then p_fields ->> 'leadSource' else lead_source end,
    lead_status = case when p_fields ? 'leadStatus' then p_fields ->> 'leadStatus' else lead_status end,
    next_follow_up_at = case when p_fields ? 'nextFollowUpAt' then (p_fields ->> 'nextFollowUpAt')::timestamptz else next_follow_up_at end,
    expected_budget = case when p_fields ? 'expectedBudget' then (p_fields ->> 'expectedBudget')::numeric else expected_budget end,
    notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else notes end
  where id = p_id
  returning * into v_new;
  if v_new.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;

  perform private.set_customer_services(p_id, p_services);
  if v_new.lead_status is distinct from v_old.lead_status then
    insert into public.customer_activities (customer_id, type, note)
    values (p_id, 'STATUS_' || v_new.lead_status, coalesce(nullif(p_fields ->> 'activityNote', ''),
            'Status changed to ' || initcap(replace(v_new.lead_status, '_', ' '))));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Stage transitions + payments (SECURITY DEFINER, explicit access checks)
-- ---------------------------------------------------------------------------
create or replace function public.move_customer_to_potential(p_id uuid, p_deal_amount numeric, p_due_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
begin
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be moved to Potential.' using errcode = 'P0001';
  end if;
  if coalesce(p_deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the deal amount before moving to Potential.' using errcode = 'P0001';
  end if;
  if p_due_date is null then
    raise exception 'VALIDATION_ERROR: Enter the payment due date.' using errcode = 'P0001';
  end if;
  update public.customers
     set lifecycle_stage = 'POTENTIAL', lead_status = 'READY_TO_BUY', deal_amount = p_deal_amount,
         amount_received = 0, payment_due_date = p_due_date
   where id = p_id;
  perform private.log_customer_activity(p_id, 'MOVED_TO_POTENTIAL',
    format('Moved to Potential · ₹%s due %s', p_deal_amount, to_char(p_due_date, 'DD Mon YYYY')));
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'LEAD', 'to', 'POTENTIAL', 'deal_amount', p_deal_amount, 'due', p_due_date));
end $$;

create or replace function public.record_customer_payment(p_id uuid, p_amount numeric, p_method text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
begin
  if v.lifecycle_stage <> 'POTENTIAL' then
    raise exception 'CONFLICT: Payments are recorded while the customer is in Potential.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if v.amount_received + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Amount received cannot exceed the deal amount (₹%).', v.deal_amount using errcode = 'P0001';
  end if;
  update public.customers set amount_received = amount_received + p_amount where id = p_id;
  perform private.log_customer_activity(p_id, 'PAYMENT_RECEIVED',
    format('₹%s received%s', p_amount, coalesce(' via ' || p_method, '')));
  perform private.write_audit('PAYMENT_RECORDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'total_received', v.amount_received + p_amount));
end $$;

-- Confirms payment and opens onboarding (Potential → Onboarding).
create or replace function public.start_customer_onboarding(
  p_id uuid, p_amount_received numeric, p_payment_method text, p_target_handover date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_received numeric;
begin
  if v.lifecycle_stage <> 'POTENTIAL' then
    raise exception 'CONFLICT: Only potential customers can start onboarding.' using errcode = 'P0001';
  end if;
  if p_payment_method is null or p_payment_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select how the customer paid.' using errcode = 'P0001';
  end if;
  v_received := v.amount_received + coalesce(p_amount_received, 0);
  if v_received <= 0 then
    raise exception 'VALIDATION_ERROR: Record the payment received before starting onboarding.' using errcode = 'P0001';
  end if;
  if v_received > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Amount received cannot exceed the deal amount (₹%).', v.deal_amount using errcode = 'P0001';
  end if;

  update public.customers set lifecycle_stage = 'ONBOARDING', amount_received = v_received where id = p_id;
  insert into public.customer_onboarding (customer_id, stage, payment_method, started_by, target_handover_date)
  values (p_id, 'COLLECT_REQUIREMENTS', p_payment_method, (select private.my_id()), p_target_handover)
  on conflict (customer_id) do update
    set stage = 'COLLECT_REQUIREMENTS', payment_method = excluded.payment_method,
        started_at = now(), started_by = excluded.started_by, target_handover_date = excluded.target_handover_date;
  perform private.refresh_onboarding_progress(p_id);

  perform private.log_customer_activity(p_id, 'PAYMENT_CONFIRMED',
    format('Payment ₹%s confirmed (%s)', v_received, replace(p_payment_method, '_', ' ')));
  perform private.log_customer_activity(p_id, 'MOVED_TO_ONBOARDING', 'Moved from Potential to Onboarding');
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'POTENTIAL', 'to', 'ONBOARDING', 'amount_received', v_received, 'method', p_payment_method));
end $$;

-- Mandatory documents complete → hand the customer to the support team.
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_missing text;
  v_recipient uuid;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  select string_agg(t.label, ', ' order by t.sort_order) into v_missing
  from public.document_types t
  where t.is_mandatory and not exists (
    select 1 from public.customer_documents d
    where d.customer_id = p_id and d.document_type = t.code and d.status = 'UPLOADED');
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Upload the mandatory documents first: %.', v_missing using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_onboarding where customer_id = p_id and forwarded_to_support_at is not null) then
    raise exception 'CONFLICT: Already forwarded to the support team.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set stage = 'SETUP', forwarded_to_support_at = now(), forwarded_by = (select private.my_id())
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'FORWARDED_TO_SUPPORT', 'Forwarded to the support team for setup');
  perform private.write_audit('ONBOARDING_FORWARDED', 'customer', p_id, v.department_id, v.team_id, '{}'::jsonb);

  -- Notify the support team heads of the same department.
  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
    where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and t.division = 'SUPPORT' and p.department_id = v.department_id
  loop
    perform private.notify(v_recipient, 'ONBOARDING_FORWARDED', format('Ready for setup: %s', coalesce(v.company, v.name)),
      'Mandatory documents are complete.', 'customer', p_id);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Document lifecycle (API coordinates these with Storage)
--   begin → (client uploads to signed URL) → complete | fail
-- ---------------------------------------------------------------------------
create or replace function public.begin_document_upload(
  p_customer uuid, p_type text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  t public.document_types;
  d public.customer_documents;
  v_id uuid := gen_random_uuid();
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Documents are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = p_type;
  if t.code is null then
    raise exception 'VALIDATION_ERROR: Unknown document type.' using errcode = 'P0001';
  end if;
  if p_mime is null or not (p_mime = any (t.allowed_mime_types)) then
    raise exception 'VALIDATION_ERROR: % must be a PDF file.', t.label using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File must be smaller than % MB.', t.max_size_bytes / 1048576 using errcode = 'P0001';
  end if;

  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_customer, p_type, null, 'PENDING',
          -- Opaque path: customer id + document id only (no names or PII).
          format('customers/%s/%s/%s.pdf', p_customer, t.storage_folder, v_id),
          left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'document.pdf'), '[\r\n\t/\\]', '_', 'g'), 255),
          p_mime, p_size, (select private.my_id()))
  returning * into d;
  return d;
end $$;

-- Called by the API after it has verified the object in Storage (size + PDF signature).
create or replace function public.complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  t public.document_types;
  v_replaced public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not private.can_access_customer(d.customer_id) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: Uploaded file size is not allowed.' using errcode = 'P0001';
  end if;
  v := private.lock_accessible_customer(d.customer_id);

  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = d.customer_id and document_type = d.document_type and status = 'UPLOADED'
  returning * into v_replaced;

  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = d.customer_id and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  perform private.write_audit(
    case when d.document_type = 'INVOICE' then (case when v_replaced.id is null then 'INVOICE_UPLOADED' else 'INVOICE_REPLACED' end)
         else (case when v_replaced.id is null then 'DOCUMENT_UPLOADED' else 'DOCUMENT_REPLACED' end) end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version,
                       'replaced_document_id', v_replaced.id, 'size_bytes', p_size));
  perform private.log_customer_activity(d.customer_id, 'DOCUMENT_UPLOADED',
    format('%s %s (v%s)', t.label, case when v_replaced.id is null then 'uploaded' else 'replaced' end, d.version));
  perform private.refresh_onboarding_progress(d.customer_id);
  return d;
end $$;

-- Marks a pending upload as failed; returns the storage path so the API can remove any partial object.
create or replace function public.fail_document_upload(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not private.can_access_customer(d.customer_id) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'FAILED' where id = p_document;
  return d.storage_path;
end $$;

-- Authorizes viewing/downloading one document and records it in the audit log.
create or replace function public.authorize_document_access(p_document uuid, p_action text)
returns table (storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
begin
  select * into d from public.customer_documents where id = p_document;
  if d.id is null or not private.can_access_customer(d.customer_id) or d.status not in ('UPLOADED', 'SUPERSEDED') then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = d.customer_id;
  perform private.write_audit(case when p_action = 'DOWNLOAD' then 'DOCUMENT_DOWNLOADED' else 'DOCUMENT_VIEWED' end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version));
  return query select d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;

-- Soft-deletes a document (metadata kept for the audit trail); returns the
-- storage path for the API to remove the object.
create or replace function public.delete_customer_document(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not private.can_access_customer(d.customer_id) or d.status not in ('UPLOADED', 'SUPERSEDED') then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  v := private.lock_accessible_customer(d.customer_id);
  if v.lifecycle_stage = 'ONBOARDING' and exists (
       select 1 from public.customer_onboarding o where o.customer_id = d.customer_id and o.forwarded_to_support_at is not null)
     and d.status = 'UPLOADED' then
    raise exception 'CONFLICT: Documents are locked after forwarding to support. Upload a replacement instead.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'DELETED', deleted_at = now(), deleted_by = (select private.my_id())
   where id = p_document;
  perform private.write_audit(case when d.document_type = 'INVOICE' then 'INVOICE_DELETED' else 'DOCUMENT_DELETED' end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version));
  perform private.log_customer_activity(d.customer_id, 'DOCUMENT_DELETED',
    format('%s v%s deleted', (select label from public.document_types where code = d.document_type), d.version));
  perform private.refresh_onboarding_progress(d.customer_id);
  return d.storage_path;
end $$;

-- Service role only: abandoned uploads (browser closed mid-upload) older than
-- an hour become FAILED; their paths are returned for storage cleanup.
create or replace function public.expire_stale_document_uploads()
returns setof text language sql security definer set search_path = '' as $$
  update public.customer_documents set status = 'FAILED'
   where status = 'PENDING' and created_at < now() - interval '1 hour'
  returning storage_path
$$;

-- ---------------------------------------------------------------------------
-- 11. Inbound webhook leads (crm_leads) → customers, without duplicates
-- ---------------------------------------------------------------------------
alter table public.crm_leads
  add column if not exists converted_customer_id uuid references public.customers (id) on delete set null;

create or replace function private.lead_status_from_stage(p_stage text)
returns text language sql immutable set search_path = '' as $$
  select case p_stage
    when 'Contacted' then 'CONTACTED'
    when 'Interested' then 'INTERESTED'
    when 'Demo' then 'INTERESTED'
    when 'Proposal' then 'READY_TO_BUY'
    when 'Negotiation' then 'READY_TO_BUY'
    else 'NEW' end
$$;

create or replace function private.customer_from_inbound_lead(p_lead public.crm_leads, p_owner uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_email text := lower(nullif(trim(p_lead.email), ''));
  v_phone text := nullif(trim(p_lead.phone), '');
begin
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_email := null; end if;
  if v_phone is not null and v_phone !~ '^[0-9+()\-\s.]{5,25}$' then v_phone := null; end if;
  if v_email is null and v_phone is null then
    raise exception 'VALIDATION_ERROR: This lead has no valid phone number or e-mail.' using errcode = 'P0001';
  end if;
  insert into public.customers (owner_id, lifecycle_stage, lead_status, name, company, phone, email,
                                lead_source, expected_budget, notes, source_lead_id)
  values (p_owner, 'LEAD', private.lead_status_from_stage(p_lead.stage), left(coalesce(nullif(trim(p_lead.name), ''), 'Inbound lead'), 200),
          left(nullif(trim(p_lead.company), ''), 200), v_phone, v_email, left(coalesce(p_lead.channel, 'Inbound'), 60),
          nullif(p_lead.value, 0), left(p_lead.notes, 5000), p_lead.id)
  on conflict (source_lead_id) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.customers where source_lead_id = p_lead.id;
  end if;
  update public.crm_leads set converted_customer_id = v_id, assigned_to = p_owner where id = p_lead.id;
  return v_id;
end $$;
revoke all on function private.customer_from_inbound_lead(public.crm_leads, uuid) from public, anon, authenticated;

-- A sales person takes an unassigned inbound lead of their department (or one
-- already assigned to them) into their pipeline.
create or replace function public.claim_inbound_lead(p_lead_id text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  l public.crm_leads;
  me public.profiles;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null or me.team_id is null then
    raise exception 'FORBIDDEN: Only team members and team heads can take leads.' using errcode = '42501';
  end if;
  select * into l from public.crm_leads where id = p_lead_id for update;
  if l.id is null or l.department is distinct from (select slug from public.departments where id = me.department_id) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  if l.converted_customer_id is not null then
    raise exception 'CONFLICT: This lead is already in a pipeline.' using errcode = 'P0001';
  end if;
  if l.assigned_to is not null and l.assigned_to <> me.id then
    raise exception 'FORBIDDEN: This lead is assigned to someone else.' using errcode = '42501';
  end if;
  return private.customer_from_inbound_lead(l, me.id);
end $$;

-- One-time backfill: leads already assigned to an active salesperson become
-- LEAD customers owned by them (idempotent via source_lead_id).
do $$
declare
  l public.crm_leads;
begin
  for l in
    select cl.* from public.crm_leads cl
    join public.profiles p on p.id = cl.assigned_to
    where cl.converted_customer_id is null and p.status = 'ACTIVE' and p.team_id is not null
      and coalesce(cl.stage, 'New') not in ('Won', 'Lost')
  loop
    begin
      perform private.customer_from_inbound_lead(l, l.assigned_to);
    exception when others then
      raise notice 'skipped inbound lead % (%)', l.id, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 12. Pipeline counts for the sidebar and filter tabs (RLS-scoped, one call)
-- ---------------------------------------------------------------------------
create or replace function public.customer_pipeline_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with c as (
    select c.lifecycle_stage, c.lead_status, c.amount_received, c.payment_due_date, o.mandatory_saved
    from public.customers c
    left join public.customer_onboarding o on o.customer_id = c.id
    where c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING')
  ), m as (select count(*) as n from public.document_types where is_mandatory)
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'LEAD'),
      'NEW', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'NEW'),
      'CONTACTED', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'CONTACTED'),
      'INTERESTED', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'INTERESTED'),
      'READY_TO_BUY', count(*) filter (where lifecycle_stage = 'LEAD' and lead_status = 'READY_TO_BUY')),
    -- Same predicates as the Potential list filters.
    'potential', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
      'AWAITING', count(*) filter (where lifecycle_stage = 'POTENTIAL' and amount_received = 0 and payment_due_date >= current_date),
      'PART_PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and amount_received > 0 and payment_due_date >= current_date),
      'OVERDUE', count(*) filter (where lifecycle_stage = 'POTENTIAL' and payment_due_date < current_date)),
    'onboarding', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
      'WAITING_ON_CLIENT', count(*) filter (where lifecycle_stage = 'ONBOARDING' and coalesce(mandatory_saved, 0) = 0),
      'COLLECTING', count(*) filter (where lifecycle_stage = 'ONBOARDING' and mandatory_saved > 0 and mandatory_saved < (select n from m)),
      'READY_FOR_HANDOVER', count(*) filter (where lifecycle_stage = 'ONBOARDING' and mandatory_saved >= (select n from m))),
    'mandatoryDocuments', (select n from m))
  from c
$$;

-- "My Customers" KPIs cover paying customers only (not leads / potential).
create or replace function public.customer_summary()
returns jsonb language sql stable security invoker set search_path = '' as $$
  with visible as (
    select status, segment, created_at from public.customers where lifecycle_stage in ('ONBOARDING', 'CUSTOMER'))
  select jsonb_build_object(
    'total', (select count(*) from visible),
    'active', (select count(*) from visible where status = 'ACTIVE'),
    'inactive', (select count(*) from visible where status = 'INACTIVE'),
    'prospect', (select count(*) from visible where status = 'PROSPECT'),
    'newThisMonth', (select count(*) from visible where created_at >= date_trunc('month', now())),
    'newLastMonth', (select count(*) from visible
                     where created_at >= date_trunc('month', now()) - interval '1 month'
                       and created_at < date_trunc('month', now())),
    'bySegment', (select coalesce(jsonb_object_agg(segment, n), '{}'::jsonb)
                  from (select segment, count(*) as n from visible group by segment) s)
  )
$$;

-- ---------------------------------------------------------------------------
-- 13. Function grants
-- ---------------------------------------------------------------------------
revoke all on function public.create_lead(jsonb, text[]) from public, anon;
revoke all on function public.update_lead(uuid, jsonb, text[]) from public, anon;
revoke all on function public.move_customer_to_potential(uuid, numeric, date) from public, anon;
revoke all on function public.record_customer_payment(uuid, numeric, text) from public, anon;
revoke all on function public.start_customer_onboarding(uuid, numeric, text, date) from public, anon;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
revoke all on function public.begin_document_upload(uuid, text, text, text, bigint) from public, anon;
revoke all on function public.complete_document_upload(uuid, bigint) from public, anon;
revoke all on function public.fail_document_upload(uuid) from public, anon;
revoke all on function public.authorize_document_access(uuid, text) from public, anon;
revoke all on function public.delete_customer_document(uuid) from public, anon;
revoke all on function public.claim_inbound_lead(text) from public, anon;
revoke all on function public.customer_pipeline_counts() from public, anon;
revoke all on function public.expire_stale_document_uploads() from public, anon, authenticated;

grant execute on function public.create_lead(jsonb, text[]) to authenticated;
grant execute on function public.update_lead(uuid, jsonb, text[]) to authenticated;
grant execute on function public.move_customer_to_potential(uuid, numeric, date) to authenticated;
grant execute on function public.record_customer_payment(uuid, numeric, text) to authenticated;
grant execute on function public.start_customer_onboarding(uuid, numeric, text, date) to authenticated;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;
grant execute on function public.begin_document_upload(uuid, text, text, text, bigint) to authenticated;
grant execute on function public.complete_document_upload(uuid, bigint) to authenticated;
grant execute on function public.fail_document_upload(uuid) to authenticated;
grant execute on function public.authorize_document_access(uuid, text) to authenticated;
grant execute on function public.delete_customer_document(uuid) to authenticated;
grant execute on function public.claim_inbound_lead(text) to authenticated;
grant execute on function public.customer_pipeline_counts() to authenticated;
grant execute on function public.expire_stale_document_uploads() to service_role;

-- Live updates for the pipeline screens (RLS-filtered per user).
do $$
begin
  begin
    alter publication supabase_realtime add table public.customers;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.customer_documents;
  exception when duplicate_object then null;
  end;
end $$;
