-- Run this ONE file once in the Supabase SQL editor (safe to run again), AFTER run_this_telecaller.sql. It is the migration 20261119000100_business_associate.sql.

-- =============================================================================
-- Business Associate (a Sales sub-role): contacts handed over by Telecallers, requirement tracking, AI-assisted quotations (PDF),
-- demo meetings and AI-assisted Scope of Project documents (PDF). Backward compatible and safe to run again.
--
--   * A Telecaller CONVERTS a qualified lead (call status "Interested") into a contact (telecaller_lead_convert). The contact is a row in
--     ba_contacts that points at the SAME customers row (lead_id, unique: a lead converts once) and is assigned to one Business Associate
--     of the department. No customer record is copied; the lead keeps its owner and its place in the Sales pipeline.
--   * The Business Associate sees only the contacts assigned to them. The Department Head, the Super Admin and the Team Lead of the
--     team may READ them; nobody writes the tables directly - every change is a function that checks who is asking.
--   * service_prices is the approved price list (Super Admin / Department Head). A quotation takes its prices from it; any other price is
--     flagged on the quotation. Quotations are NOT invoices: nothing here touches invoices, payments or Accounts.
--   * Finalised quotations and scope documents are immutable; a change is a new revision / version. Each finalised document has a PDF in
--     the private bucket 'ba-documents' (the API stores it after the database allowed the finalisation).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. The dashboard value of a Business Associate, and who is one
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  if new.sales_sub_role is not null and (new.role is distinct from 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    new.sales_sub_role := null;
  end if;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case when v_slug = 'hr' then 'hr-head' else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' and new.sales_sub_role = 'TELECALLER' then 'telecaller'
      when v_division = 'SALES' and new.sales_sub_role = 'BUSINESS_ASSOCIATE' then 'business-associate'
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;
update public.profiles set updated_at = updated_at where role = 'TEAM_MEMBER' and sales_sub_role = 'BUSINESS_ASSOCIATE';

create or replace function private.is_business_associate()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = private.my_id() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.sales_sub_role = 'BUSINESS_ASSOCIATE')
$$;
create or replace function private.require_business_associate()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_business_associate() then raise exception 'FORBIDDEN: This page is for Business Associates.' using errcode = '42501'; end if;
end $$;
-- who may READ a contact and its documents: its Business Associate, the Super Admin, the Department Head of the department, the Team Lead of the team
create or replace function private.ba_can_read(p_assignee uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_assignee = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and p_department = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and p_team is not null and p_team = private.my_team_id())
$$;
revoke all on function private.is_business_associate(), private.require_business_associate(), private.ba_can_read(uuid, uuid, uuid) from public, anon;
grant execute on function private.is_business_associate(), private.require_business_associate(), private.ba_can_read(uuid, uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
-- The approved price list. A quotation line starts from these figures.
create table if not exists public.service_prices (
  service_code text primary key references public.crm_services(code) on delete cascade,
  unit_label text not null default 'one time' check (length(btrim(unit_label)) between 1 and 40),
  unit_price numeric(14,2) not null check (unit_price >= 0 and unit_price <= 1000000000),
  gst_rate numeric(5,2) not null default 0 check (gst_rate between 0 and 100),
  max_discount_pct numeric(5,2) not null default 0 check (max_discount_pct between 0 and 100),
  is_active boolean not null default true,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.ba_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.customers(id) on delete cascade,   -- one contact per lead: converting twice is refused
  department_id uuid not null references public.departments(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  telecaller_id uuid references public.profiles(id) on delete set null,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  stage text not null default 'NEW' check (stage in ('NEW', 'IN_PROGRESS', 'QUOTATION_PENDING', 'DEMO_SCHEDULED', 'SCOPE_PENDING', 'COMPLETED')),
  stage_changed_at timestamptz not null default now(),
  requirements text check (requirements is null or length(requirements) <= 5000),
  profile jsonb not null default '{}'::jsonb check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 40000),
  next_follow_up date,
  handover_note text check (handover_note is null or length(handover_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ba_contacts_assignee_idx on public.ba_contacts (assigned_to, stage, assigned_at desc);

create table if not exists public.ba_contact_events (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.ba_contacts(id) on delete cascade,
  kind text not null check (kind in ('ASSIGNED', 'REASSIGNED', 'NOTE', 'STAGE', 'REQUIREMENTS', 'QUOTATION', 'DEMO', 'SCOPE')),
  note text not null check (length(note) between 1 and 2000),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ba_contact_events_idx on public.ba_contact_events (contact_id, created_at desc);

create sequence if not exists public.ba_quotation_seq;
create table if not exists public.ba_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_no text not null,
  revision integer not null default 1 check (revision >= 1),
  contact_id uuid not null references public.ba_contacts(id) on delete cascade,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL')),
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  gst_applicable boolean not null default false,
  subtotal numeric(16,2) not null default 0,
  discount_total numeric(16,2) not null default 0,
  taxable_total numeric(16,2) not null default 0,
  tax_total numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  validity_days integer check (validity_days is null or validity_days between 1 and 365),
  valid_until date,
  payment_terms text check (payment_terms is null or length(payment_terms) <= 2000),
  timeline text check (timeline is null or length(timeline) <= 1000),
  notes text check (notes is null or length(notes) <= 3000),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 100000),
  price_flags jsonb not null default '[]'::jsonb,
  ai_generated boolean not null default false,
  ai_model text,
  ai_generated_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claim_by uuid references public.profiles(id) on delete set null,
  claim_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  pdf_bucket text, pdf_path text, pdf_provider text, pdf_ref text, pdf_etag text, pdf_size bigint,
  unique (quotation_no, revision)
);
create index if not exists ba_quotations_contact_idx on public.ba_quotations (contact_id, created_at desc);

create table if not exists public.ba_demos (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.ba_contacts(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text check (description is null or length(description) <= 3000),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  mode text not null check (mode in ('ONLINE', 'IN_PERSON')),
  location text check (location is null or length(location) <= 300),    -- the platform (online) or the place (in person)
  meeting_link text check (meeting_link is null or (meeting_link ~* '^https?://[^\s]+$' and length(meeting_link) <= 500)),
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  internal_notes text check (internal_notes is null or length(internal_notes) <= 3000),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED')),
  reschedule_count integer not null default 0,
  feedback text check (feedback is null or length(feedback) <= 3000),
  follow_up_notes text check (follow_up_notes is null or length(follow_up_notes) <= 3000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists ba_demos_assignee_idx on public.ba_demos (assigned_to, starts_at);
create index if not exists ba_demos_contact_idx on public.ba_demos (contact_id, starts_at desc);

create table if not exists public.ba_scope_docs (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.ba_contacts(id) on delete cascade,
  version integer not null check (version >= 1),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'FINAL')),
  title text not null default 'Scope of Project' check (length(btrim(title)) between 1 and 200),
  inputs jsonb not null default '{}'::jsonb check (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 60000),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 200000),
  ai_generated boolean not null default false,
  ai_model text,
  ai_generated_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  claim_by uuid references public.profiles(id) on delete set null,
  claim_at timestamptz,
  finalized_by uuid references public.profiles(id) on delete set null,
  finalized_at timestamptz,
  pdf_bucket text, pdf_path text, pdf_provider text, pdf_ref text, pdf_etag text, pdf_size bigint,
  unique (contact_id, version)
);

-- A finalised document never changes, and is never deleted by itself (only with its contact).
create or replace function private.tg_ba_final_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'FINAL' and pg_trigger_depth() < 2 then raise exception 'CONFLICT: A finalised document cannot be deleted.' using errcode = 'P0001'; end if;
    return old;
  end if;
  if old.status = 'FINAL' then raise exception 'CONFLICT: A finalised document cannot be changed. Create a new revision instead.' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists ba_quotations_immutable on public.ba_quotations;
create trigger ba_quotations_immutable before update or delete on public.ba_quotations for each row execute function private.tg_ba_final_immutable();
drop trigger if exists ba_scope_docs_immutable on public.ba_scope_docs;
create trigger ba_scope_docs_immutable before update or delete on public.ba_scope_docs for each row execute function private.tg_ba_final_immutable();

-- RLS: reads only (defence in depth; the app reads through the functions below)
alter table public.service_prices enable row level security;
alter table public.ba_contacts enable row level security;
alter table public.ba_contact_events enable row level security;
alter table public.ba_quotations enable row level security;
alter table public.ba_demos enable row level security;
alter table public.ba_scope_docs enable row level security;
revoke all on public.service_prices, public.ba_contacts, public.ba_contact_events, public.ba_quotations, public.ba_demos, public.ba_scope_docs from anon, authenticated;
drop policy if exists service_prices_select on public.service_prices;
create policy service_prices_select on public.service_prices for select to authenticated using (true);
drop policy if exists ba_contacts_select on public.ba_contacts;
create policy ba_contacts_select on public.ba_contacts for select to authenticated using (private.ba_can_read(assigned_to, department_id, team_id));
drop policy if exists ba_contact_events_select on public.ba_contact_events;
create policy ba_contact_events_select on public.ba_contact_events for select to authenticated
  using (exists (select 1 from public.ba_contacts c where c.id = contact_id and private.ba_can_read(c.assigned_to, c.department_id, c.team_id)));
drop policy if exists ba_quotations_select on public.ba_quotations;
create policy ba_quotations_select on public.ba_quotations for select to authenticated
  using (exists (select 1 from public.ba_contacts c where c.id = contact_id and private.ba_can_read(c.assigned_to, c.department_id, c.team_id)));
drop policy if exists ba_demos_select on public.ba_demos;
create policy ba_demos_select on public.ba_demos for select to authenticated
  using (exists (select 1 from public.ba_contacts c where c.id = contact_id and private.ba_can_read(c.assigned_to, c.department_id, c.team_id)));
drop policy if exists ba_scope_docs_select on public.ba_scope_docs;
create policy ba_scope_docs_select on public.ba_scope_docs for select to authenticated
  using (exists (select 1 from public.ba_contacts c where c.id = contact_id and private.ba_can_read(c.assigned_to, c.department_id, c.team_id)));
grant select on public.service_prices, public.ba_contacts, public.ba_contact_events, public.ba_quotations, public.ba_demos, public.ba_scope_docs to authenticated;

-- Private bucket for the PDFs (the API stores them after the database allowed it; downloads are signed and short-lived).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('ba-documents', 'ba-documents', false, 5242880, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.ba_event(p_contact uuid, p_kind text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.ba_contact_events (contact_id, kind, note, actor_id) values (p_contact, p_kind, left(p_note, 2000), private.my_id())
$$;
revoke all on function private.ba_event(uuid, text, text) from public, anon, authenticated;

-- Move a contact to a stage, only from the stages named (null: from any stage but Completed). Returns whether it moved.
create or replace function private.ba_advance(p_contact uuid, p_to text, p_from text[] default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
begin
  select * into c from public.ba_contacts where id = p_contact for update;
  if c.id is null or c.stage = p_to then return false; end if;
  if p_from is null then
    if c.stage = 'COMPLETED' then return false; end if;
  elsif not (c.stage = any (p_from)) then
    return false;
  end if;
  update public.ba_contacts set stage = p_to, stage_changed_at = now(), updated_at = now() where id = c.id;
  perform private.ba_event(c.id, 'STAGE', format('Stage changed to %s', initcap(replace(lower(p_to), '_', ' '))));
  return true;
end $$;
revoke all on function private.ba_advance(uuid, text, text[]) from public, anon, authenticated;

-- A contact the caller (the Business Associate) owns, locked for the change.
create or replace function private.ba_my_contact(p_id uuid)
returns public.ba_contacts language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  select * into c from public.ba_contacts where id = p_id and assigned_to = private.my_id() for update;
  if c.id is null then raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001'; end if;
  return c;
end $$;
revoke all on function private.ba_my_contact(uuid) from public, anon, authenticated;

create or replace function private.ba_contact_json(c public.ba_contacts)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'leadId', c.lead_id, 'name', l.name, 'company', l.company, 'phone', l.phone, 'email', l.email, 'leadSource', l.lead_source,
    'telecaller', (select p.full_name from public.profiles p where p.id = c.telecaller_id), 'telecallerId', c.telecaller_id,
    'assignedAt', c.assigned_at, 'businessAssociate', (select p.full_name from public.profiles p where p.id = c.assigned_to), 'assignedTo', c.assigned_to,
    'stage', c.stage, 'stageChangedAt', c.stage_changed_at, 'nextFollowUp', c.next_follow_up,
    'quotation', (select jsonb_build_object('id', q.id, 'number', q.quotation_no, 'revision', q.revision, 'status', q.status, 'total', q.total)
                    from public.ba_quotations q where q.contact_id = c.id order by q.created_at desc, q.id limit 1),
    'nextDemo', (select jsonb_build_object('id', d.id, 'startsAt', d.starts_at, 'status', d.status)
                   from public.ba_demos d where d.contact_id = c.id and d.status in ('SCHEDULED', 'RESCHEDULED') and d.ends_at >= now() order by d.starts_at limit 1),
    'scope', (select jsonb_build_object('id', s.id, 'version', s.version, 'status', s.status)
                from public.ba_scope_docs s where s.contact_id = c.id order by s.version desc limit 1))
    from public.customers l where l.id = c.lead_id
$$;
revoke all on function private.ba_contact_json(public.ba_contacts) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Price list (read by everyone who works with quotations; written by the Super Admin and the Department Head)
-- ---------------------------------------------------------------------------
create or replace function public.service_prices_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_business_associate() or private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'FORBIDDEN: You cannot open the price list.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('serviceCode', s.code, 'name', s.name, 'category', s.category,
            'unitLabel', p.unit_label, 'unitPrice', p.unit_price, 'gstRate', p.gst_rate, 'maxDiscountPct', p.max_discount_pct, 'isActive', coalesce(p.is_active, false),
            'priced', p.service_code is not null) order by s.sort_order, s.name)
          from public.crm_services s left join public.service_prices p on p.service_code = s.code where s.is_active), '[]'::jsonb);
end $$;

create or replace function public.service_price_save(p_code text, p_unit_label text, p_unit_price numeric, p_gst_rate numeric, p_max_discount numeric, p_active boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the Super Admin or a Department Head can change the price list.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.crm_services where code = p_code and is_active) then raise exception 'VALIDATION_ERROR: Unknown service.' using errcode = 'P0001'; end if;
  if p_unit_price is null or p_unit_price < 0 or p_unit_price > 1000000000 then raise exception 'VALIDATION_ERROR: Enter the unit price.' using errcode = 'P0001'; end if;
  if p_gst_rate is null or p_gst_rate < 0 or p_gst_rate > 100 then raise exception 'VALIDATION_ERROR: Enter the GST rate (0 to 100).' using errcode = 'P0001'; end if;
  if p_max_discount is null or p_max_discount < 0 or p_max_discount > 100 then raise exception 'VALIDATION_ERROR: Enter the largest discount allowed (0 to 100 %%).' using errcode = 'P0001'; end if;
  insert into public.service_prices (service_code, unit_label, unit_price, gst_rate, max_discount_pct, is_active, updated_by, updated_at)
  values (p_code, coalesce(nullif(btrim(p_unit_label), ''), 'one time'), round(p_unit_price, 2), round(p_gst_rate, 2), round(p_max_discount, 2), coalesce(p_active, true), private.my_id(), now())
  on conflict (service_code) do update set unit_label = excluded.unit_label, unit_price = excluded.unit_price, gst_rate = excluded.gst_rate,
    max_discount_pct = excluded.max_discount_pct, is_active = excluded.is_active, updated_by = excluded.updated_by, updated_at = now();
  perform private.write_audit('SERVICE_PRICE_SAVED', 'service_price', null, private.my_department_id(), null, jsonb_build_object('service', p_code, 'unitPrice', round(p_unit_price, 2), 'gstRate', p_gst_rate, 'maxDiscountPct', p_max_discount));
  return jsonb_build_object('serviceCode', p_code, 'unitPrice', round(p_unit_price, 2));
end $$;

-- ---------------------------------------------------------------------------
-- 4. Telecaller -> Business Associate: the Business Associates a department has, and the conversion of a qualified lead
-- ---------------------------------------------------------------------------
create or replace function public.ba_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  if not (private.is_telecaller() or private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD')) then
    raise exception 'FORBIDDEN: You cannot see the Business Associates.' using errcode = '42501';
  end if;
  v_dept := case when private.my_role() = 'SUPER_ADMIN' then null else private.my_department_id() end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'departmentId', p.department_id,
      'openContacts', (select count(*) from public.ba_contacts c where c.assigned_to = p.id and c.stage <> 'COMPLETED')) order by p.full_name)
    from public.profiles p where p.sales_sub_role = 'BUSINESS_ASSOCIATE' and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and (v_dept is null or p.department_id = v_dept)), '[]'::jsonb);
end $$;

-- A Telecaller converts a qualified lead (call status Interested) into a contact for a Business Associate of the department. One lead converts once.
-- Without a chosen Business Associate the one with the fewest open contacts gets it.
create or replace function public.telecaller_lead_convert(p_lead uuid, p_assignee uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  l public.customers;
  a public.profiles;
  c public.ba_contacts;
  v_existing uuid;
begin
  perform private.require_telecaller();
  select * into me from public.profiles where id = private.my_id();
  select * into l from public.customers where id = p_lead and owner_id = me.id and lifecycle_stage = 'LEAD' for update;
  if l.id is null then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  select id into v_existing from public.ba_contacts where lead_id = l.id;
  if v_existing is not null then raise exception 'CONFLICT: This lead has already been converted to a contact.' using errcode = 'P0001'; end if;
  if l.call_status is distinct from 'INTERESTED' then
    raise exception 'VALIDATION_ERROR: Only a qualified lead can be converted. Set its call status to Interested first.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 1000 then raise exception 'VALIDATION_ERROR: The hand-over note is too long (1,000 characters at most).' using errcode = 'P0001'; end if;
  if p_assignee is not null then
    select * into a from public.profiles where id = p_assignee;
    if a.id is null or a.sales_sub_role is distinct from 'BUSINESS_ASSOCIATE' or a.status <> 'ACTIVE' or a.role <> 'TEAM_MEMBER' or a.department_id is distinct from me.department_id then
      raise exception 'VALIDATION_ERROR: Choose an active Business Associate of your department.' using errcode = 'P0001';
    end if;
  else
    select p.* into a from public.profiles p
     where p.sales_sub_role = 'BUSINESS_ASSOCIATE' and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.department_id = me.department_id
     order by (select count(*) from public.ba_contacts x where x.assigned_to = p.id and x.stage <> 'COMPLETED'), p.created_at
     limit 1;
    if a.id is null then raise exception 'VALIDATION_ERROR: Your department has no Business Associate yet. Ask your Department Head to add one.' using errcode = 'P0001'; end if;
  end if;
  begin
    insert into public.ba_contacts (lead_id, department_id, team_id, telecaller_id, assigned_to, assigned_by, handover_note)
    values (l.id, a.department_id, a.team_id, me.id, a.id, me.id, nullif(btrim(coalesce(p_note, '')), ''))
    returning * into c;
  exception when unique_violation then
    raise exception 'CONFLICT: This lead has already been converted to a contact.' using errcode = 'P0001';
  end;
  perform private.ba_event(c.id, 'ASSIGNED', format('Converted by %s and assigned to %s.%s', me.full_name, a.full_name, coalesce(' Note: ' || c.handover_note, '')));
  insert into public.customer_activities (customer_id, type, note) values (l.id, 'LEAD_UPDATED', format('Converted to a contact for %s', a.full_name));
  perform private.notify(a.id, 'BA_CONTACT_ASSIGNED', format('New contact: %s', l.name), format('%s handed over %s%s.', me.full_name, l.name, coalesce(' (' || l.company || ')', '')), 'ba_contact', c.id);
  perform private.write_audit('BA_CONTACT_CREATED', 'ba_contact', c.id, c.department_id, c.team_id, jsonb_build_object('lead', l.id, 'assignedTo', a.id, 'telecaller', me.id));
  return jsonb_build_object('contactId', c.id, 'assignedTo', a.id, 'assigneeName', a.full_name);
end $$;

-- Super Admin / Department Head: give a contact to another Business Associate of the department.
create or replace function public.ba_contact_reassign(p_contact uuid, p_assignee uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  a public.profiles;
  v_old text;
begin
  if private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can reassign a contact.' using errcode = '42501'; end if;
  select * into c from public.ba_contacts where id = p_contact for update;
  if c.id is null or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id is distinct from private.my_department_id()) then raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001'; end if;
  select * into a from public.profiles where id = p_assignee;
  if a.id is null or a.sales_sub_role is distinct from 'BUSINESS_ASSOCIATE' or a.status <> 'ACTIVE' or a.department_id is distinct from c.department_id then
    raise exception 'VALIDATION_ERROR: Choose an active Business Associate of the department.' using errcode = 'P0001';
  end if;
  select full_name into v_old from public.profiles where id = c.assigned_to;
  if a.id = c.assigned_to then return jsonb_build_object('contactId', c.id, 'assignedTo', a.id); end if;
  update public.ba_contacts set assigned_to = a.id, team_id = a.team_id, updated_at = now() where id = c.id;
  update public.ba_demos set assigned_to = a.id, updated_at = now() where contact_id = c.id and status in ('SCHEDULED', 'RESCHEDULED') and starts_at > now();
  perform private.ba_event(c.id, 'REASSIGNED', format('Reassigned from %s to %s.', coalesce(v_old, 'a former colleague'), a.full_name));
  perform private.notify(a.id, 'BA_CONTACT_ASSIGNED', 'A contact was assigned to you', 'Open Tasks to see it.', 'ba_contact', c.id);
  perform private.write_audit('BA_CONTACT_REASSIGNED', 'ba_contact', c.id, c.department_id, a.team_id, jsonb_build_object('from', c.assigned_to, 'to', a.id));
  return jsonb_build_object('contactId', c.id, 'assignedTo', a.id);
end $$;

-- The Telecaller's lead list shows which leads were converted (additive key).
create or replace function private.telecaller_lead_json(c public.customers)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'email', c.email, 'address', c.address, 'leadSource', c.lead_source,
    'leadTemperature', c.lead_temperature, 'callStatus', c.call_status,
    'followUpDate', (c.next_follow_up_at at time zone 'Asia/Kolkata')::date, 'notes', c.notes, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
    'services', coalesce((select jsonb_agg(s.service_code order by s.service_code) from public.customer_services s where s.customer_id = c.id), '[]'::jsonb),
    'serviceNames', coalesce((select string_agg(cs.name, ', ' order by cs.name) from public.customer_services s join public.crm_services cs on cs.code = s.service_code where s.customer_id = c.id), ''),
    'converted', (select jsonb_build_object('contactId', k.id, 'convertedAt', k.assigned_at, 'businessAssociate', (select p.full_name from public.profiles p where p.id = k.assigned_to))
                    from public.ba_contacts k where k.lead_id = c.id))
$$;
revoke all on function private.telecaller_lead_json(public.customers) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tasks: the Business Associate's contacts
-- ---------------------------------------------------------------------------
create or replace function public.ba_contacts_list(p_search text default null, p_stage text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
  v_counts jsonb;
begin
  perform private.require_business_associate();
  if p_stage is not null and p_stage not in ('NEW', 'IN_PROGRESS', 'QUOTATION_PENDING', 'DEMO_SCHEDULED', 'SCOPE_PENDING', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Unknown stage.' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.ba_contacts c join public.customers l on l.id = c.lead_id
   where c.assigned_to = private.my_id() and (p_stage is null or c.stage = p_stage)
     and (v_q = '' or position(v_q in lower(l.name || ' ' || coalesce(l.company, '') || ' ' || coalesce(l.phone, '') || ' ' || coalesce(l.email, '') || ' ' || coalesce(l.lead_source, ''))) > 0);
  select coalesce(jsonb_object_agg(s.stage, s.n), '{}'::jsonb) into v_counts
    from (select stage, count(*) n from public.ba_contacts where assigned_to = private.my_id() group by stage) s;
  return jsonb_build_object('total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', v_counts,
    'items', coalesce((select jsonb_agg(private.ba_contact_json(x) order by x.assigned_at desc, x.id)
      from (select c.* from public.ba_contacts c join public.customers l on l.id = c.lead_id
             where c.assigned_to = private.my_id() and (p_stage is null or c.stage = p_stage)
               and (v_q = '' or position(v_q in lower(l.name || ' ' || coalesce(l.company, '') || ' ' || coalesce(l.phone, '') || ' ' || coalesce(l.email, '') || ' ' || coalesce(l.lead_source, ''))) > 0)
             order by c.assigned_at desc, c.id limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb));
end $$;

-- Everything about one contact: the client, the requirements, the notes and every document.
create or replace function public.ba_contact_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  l public.customers;
begin
  perform private.require_business_associate();
  select * into c from public.ba_contacts where id = p_id and assigned_to = private.my_id();
  if c.id is null then raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001'; end if;
  select * into l from public.customers where id = c.lead_id;
  return private.ba_contact_json(c) || jsonb_build_object(
    'address', l.address, 'notes', l.notes, 'leadTemperature', l.lead_temperature, 'callStatus', l.call_status, 'handoverNote', c.handover_note,
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.service_code, 'name', cs.name) order by cs.sort_order) from public.customer_services s join public.crm_services cs on cs.code = s.service_code where s.customer_id = l.id), '[]'::jsonb),
    'requirements', c.requirements, 'profile', c.profile,
    'events', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'note', e.note, 'at', e.created_at, 'by', (select p.full_name from public.profiles p where p.id = e.actor_id)) order by e.created_at desc)
                          from (select * from public.ba_contact_events where contact_id = c.id order by created_at desc limit 60) e), '[]'::jsonb),
    'quotations', coalesce((select jsonb_agg(private.ba_quotation_row(q) order by q.created_at desc) from public.ba_quotations q where q.contact_id = c.id), '[]'::jsonb),
    'demos', coalesce((select jsonb_agg(private.ba_demo_row(d) order by d.starts_at desc) from public.ba_demos d where d.contact_id = c.id), '[]'::jsonb),
    'scopes', coalesce((select jsonb_agg(private.ba_scope_row(s) order by s.version desc) from public.ba_scope_docs s where s.contact_id = c.id), '[]'::jsonb));
end $$;

-- Requirements, the client's business profile, the next follow-up and the stage (any field may be left out).
create or replace function public.ba_contact_update(p_id uuid, p_fields jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  v_stage text;
  v_follow date;
begin
  c := private.ba_my_contact(p_id);
  if jsonb_typeof(p_fields) <> 'object' then raise exception 'VALIDATION_ERROR: Nothing to update.' using errcode = 'P0001'; end if;
  if p_fields ? 'requirements' and length(coalesce(p_fields ->> 'requirements', '')) > 5000 then raise exception 'VALIDATION_ERROR: The requirements are too long (5,000 characters at most).' using errcode = 'P0001'; end if;
  if p_fields ? 'profile' and (jsonb_typeof(p_fields -> 'profile') <> 'object' or pg_column_size(p_fields -> 'profile') > 40000) then raise exception 'VALIDATION_ERROR: The business profile is not valid.' using errcode = 'P0001'; end if;
  if p_fields ? 'stage' then
    v_stage := p_fields ->> 'stage';
    if v_stage not in ('NEW', 'IN_PROGRESS', 'QUOTATION_PENDING', 'DEMO_SCHEDULED', 'SCOPE_PENDING', 'COMPLETED') then raise exception 'VALIDATION_ERROR: Unknown stage.' using errcode = 'P0001'; end if;
  end if;
  if p_fields ? 'nextFollowUp' then
    v_follow := nullif(p_fields ->> 'nextFollowUp', '')::date;
    if v_follow is not null and (v_follow < private.hr_today() - 1 or v_follow > private.hr_today() + 730) then raise exception 'VALIDATION_ERROR: Enter a valid follow-up date.' using errcode = 'P0001'; end if;
  end if;
  update public.ba_contacts set
    requirements = case when p_fields ? 'requirements' then nullif(btrim(p_fields ->> 'requirements'), '') else requirements end,
    profile = case when p_fields ? 'profile' then p_fields -> 'profile' else profile end,
    next_follow_up = case when p_fields ? 'nextFollowUp' then v_follow else next_follow_up end,
    updated_at = now()
  where id = c.id returning * into c;
  if p_fields ? 'requirements' then perform private.ba_event(c.id, 'REQUIREMENTS', 'Requirements updated.'); end if;
  -- the first piece of work moves a new contact to In progress; an explicit stage is the Business Associate's choice
  if v_stage is not null then
    update public.ba_contacts set stage = v_stage, stage_changed_at = now() where id = c.id and stage <> v_stage;
    if found then perform private.ba_event(c.id, 'STAGE', format('Stage set to %s.', initcap(replace(lower(v_stage), '_', ' ')))); end if;
  else
    perform private.ba_advance(c.id, 'IN_PROGRESS', array['NEW']);
  end if;
  return public.ba_contact_get(c.id);
end $$;

create or replace function public.ba_contact_note_add(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
begin
  c := private.ba_my_contact(p_id);
  if length(btrim(coalesce(p_note, ''))) < 1 or length(p_note) > 2000 then raise exception 'VALIDATION_ERROR: Write the note (2,000 characters at most).' using errcode = 'P0001'; end if;
  perform private.ba_event(c.id, 'NOTE', btrim(p_note));
  perform private.ba_advance(c.id, 'IN_PROGRESS', array['NEW']);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Quotations
-- ---------------------------------------------------------------------------
create or replace function private.ba_quotation_row(q public.ba_quotations)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', q.id, 'contactId', q.contact_id, 'number', q.quotation_no, 'revision', q.revision, 'status', q.status, 'total', q.total,
    'aiGenerated', q.ai_generated, 'reviewed', q.reviewed_at is not null, 'createdAt', q.created_at, 'updatedAt', q.updated_at, 'finalizedAt', q.finalized_at,
    'validUntil', q.valid_until, 'hasPdf', q.pdf_path is not null and q.status = 'FINAL', 'createdBy', (select p.full_name from public.profiles p where p.id = q.created_by))
$$;
revoke all on function private.ba_quotation_row(public.ba_quotations) from public, anon, authenticated;

create or replace function private.ba_demo_row(d public.ba_demos)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'contactId', d.contact_id, 'title', d.title, 'description', d.description, 'startsAt', d.starts_at, 'endsAt', d.ends_at,
    'mode', d.mode, 'location', d.location, 'meetingLink', d.meeting_link, 'assignedTo', d.assigned_to, 'assignee', (select p.full_name from public.profiles p where p.id = d.assigned_to),
    'internalNotes', d.internal_notes, 'status', d.status, 'rescheduleCount', d.reschedule_count, 'feedback', d.feedback, 'followUpNotes', d.follow_up_notes,
    'client', (select l.name from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = d.contact_id),
    'company', (select l.company from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = d.contact_id))
$$;
revoke all on function private.ba_demo_row(public.ba_demos) from public, anon, authenticated;

create or replace function private.ba_scope_row(s public.ba_scope_docs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'contactId', s.contact_id, 'version', s.version, 'status', s.status, 'title', s.title, 'aiGenerated', s.ai_generated,
    'reviewed', s.reviewed_at is not null, 'createdAt', s.created_at, 'updatedAt', s.updated_at, 'finalizedAt', s.finalized_at,
    'hasPdf', s.pdf_path is not null and s.status = 'FINAL', 'createdBy', (select p.full_name from public.profiles p where p.id = s.created_by))
$$;
revoke all on function private.ba_scope_row(public.ba_scope_docs) from public, anon, authenticated;

-- Worked out in the database, in whole paise: each line = quantity x unit price, less the line discount; GST on what is left (only when applicable).
-- p_items: [{"serviceCode","description","quantity","unitPrice","discountPct","gstRate"}]. Returns the cleaned lines, the totals and the flags.
create or replace function private.ba_quote_calc(p_items jsonb, p_gst boolean)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  it jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_flags jsonb := '[]'::jsonb;
  v_code text;
  v_qty numeric;
  v_price numeric;
  v_disc numeric;
  v_rate numeric;
  v_gross bigint;
  v_discp bigint;
  v_base bigint;
  v_gst bigint;
  v_sub bigint := 0; v_dsum bigint := 0; v_tax bigint := 0; v_taxable bigint := 0;
  sp public.service_prices;
  v_name text;
  v_n integer := 0;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'VALIDATION_ERROR: Add at least one service to the quotation.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'VALIDATION_ERROR: A quotation can have at most 30 lines.' using errcode = 'P0001'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    v_n := v_n + 1;
    v_code := it ->> 'serviceCode';
    select name into v_name from public.crm_services where code = v_code and is_active;
    if v_name is null then raise exception 'VALIDATION_ERROR: Line %: choose a service from the catalogue.', v_n using errcode = 'P0001'; end if;
    begin
      v_qty := (it ->> 'quantity')::numeric; v_price := (it ->> 'unitPrice')::numeric;
      v_disc := coalesce(nullif(it ->> 'discountPct', '')::numeric, 0); v_rate := coalesce(nullif(it ->> 'gstRate', '')::numeric, 0);
    exception when others then raise exception 'VALIDATION_ERROR: Line %: the quantity, price, discount and GST rate must be numbers.', v_n using errcode = 'P0001';
    end;
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then raise exception 'VALIDATION_ERROR: Line %: enter a quantity above 0.', v_n using errcode = 'P0001'; end if;
    if v_price is null or v_price < 0 or v_price > 1000000000 then raise exception 'VALIDATION_ERROR: Line %: enter the unit price.', v_n using errcode = 'P0001'; end if;
    if v_disc < 0 or v_disc > 100 then raise exception 'VALIDATION_ERROR: Line %: the discount must be between 0 and 100 %%.', v_n using errcode = 'P0001'; end if;
    if v_rate < 0 or v_rate > 100 then raise exception 'VALIDATION_ERROR: Line %: the GST rate must be between 0 and 100.', v_n using errcode = 'P0001'; end if;
    if length(coalesce(it ->> 'description', '')) > 1500 then raise exception 'VALIDATION_ERROR: Line %: the description is too long.', v_n using errcode = 'P0001'; end if;
    select * into sp from public.service_prices where service_code = v_code and is_active;
    if sp.service_code is null then
      v_flags := v_flags || jsonb_build_object('line', v_n, 'serviceCode', v_code, 'kind', 'NOT_IN_PRICE_LIST', 'message', format('%s has no approved price: the price was typed in.', v_name));
      if v_disc > 0 then raise exception 'VALIDATION_ERROR: Line %: a discount needs an approved price list entry that allows it.', v_n using errcode = 'P0001'; end if;
    else
      if v_price <> sp.unit_price then
        v_flags := v_flags || jsonb_build_object('line', v_n, 'serviceCode', v_code, 'kind', 'PRICE_DIFFERS', 'message', format('%s: the price differs from the approved price (%s).', v_name, sp.unit_price));
      end if;
      if v_disc > sp.max_discount_pct then
        raise exception 'FORBIDDEN: Line %: the discount is above the % %% the Department Head allows for %.', v_n, sp.max_discount_pct, v_name using errcode = '42501';
      end if;
      if p_gst and v_rate <> sp.gst_rate then
        v_flags := v_flags || jsonb_build_object('line', v_n, 'serviceCode', v_code, 'kind', 'GST_DIFFERS', 'message', format('%s: the GST rate differs from the approved rate (%s %%).', v_name, sp.gst_rate));
      end if;
    end if;
    v_gross := round(v_qty * v_price * 100)::bigint;
    v_discp := round(v_gross * v_disc / 100)::bigint;
    v_base := v_gross - v_discp;
    v_gst := case when p_gst then round(v_base * v_rate / 100)::bigint else 0 end;
    v_sub := v_sub + v_gross; v_dsum := v_dsum + v_discp; v_taxable := v_taxable + v_base; v_tax := v_tax + v_gst;
    v_lines := v_lines || jsonb_build_object('position', v_n, 'serviceCode', v_code, 'name', v_name, 'description', nullif(btrim(coalesce(it ->> 'description', '')), ''),
      'unitLabel', coalesce(sp.unit_label, 'one time'), 'quantity', v_qty, 'unitPrice', v_price, 'discountPct', v_disc, 'gstRate', case when p_gst then v_rate else 0 end,
      'amount', round(v_gross / 100.0, 2), 'discount', round(v_discp / 100.0, 2), 'taxable', round(v_base / 100.0, 2), 'gst', round(v_gst / 100.0, 2), 'total', round((v_base + v_gst) / 100.0, 2));
  end loop;
  return jsonb_build_object('lines', v_lines, 'flags', v_flags, 'subtotal', round(v_sub / 100.0, 2), 'discountTotal', round(v_dsum / 100.0, 2),
    'taxableTotal', round(v_taxable / 100.0, 2), 'taxTotal', round(v_tax / 100.0, 2), 'total', round((v_taxable + v_tax) / 100.0, 2));
end $$;
revoke all on function private.ba_quote_calc(jsonb, boolean) from public, anon, authenticated;

-- A quotation with everything the editor, the AI and the PDF need (the client's details are the lead's own).
create or replace function private.ba_quotation_full(q public.ba_quotations)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.ba_quotation_row(q) || jsonb_build_object(
    'items', q.items, 'gstApplicable', q.gst_applicable, 'subtotal', q.subtotal, 'discountTotal', q.discount_total, 'taxableTotal', q.taxable_total, 'taxTotal', q.tax_total,
    'validityDays', q.validity_days, 'paymentTerms', q.payment_terms, 'timeline', q.timeline, 'notes', q.notes, 'content', q.content, 'priceFlags', q.price_flags,
    'aiModel', q.ai_model, 'reviewedAt', q.reviewed_at,
    'client', (select jsonb_build_object('name', l.name, 'company', l.company, 'phone', l.phone, 'email', l.email, 'address', l.address, 'city', l.city, 'businessCategory', l.business_category)
                 from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = q.contact_id),
    'requirements', (select c.requirements from public.ba_contacts c where c.id = q.contact_id),
    'businessProfile', (select c.profile from public.ba_contacts c where c.id = q.contact_id))
$$;
revoke all on function private.ba_quotation_full(public.ba_quotations) from public, anon, authenticated;

-- Create (p_id null) or update a DRAFT quotation. p_data: items, gstApplicable, validityDays, paymentTerms, timeline, notes, content,
-- aiGenerated / aiModel (set by the API after an AI draft), reviewed (true: the Business Associate has read it).
create or replace function public.ba_quotation_save(p_id uuid, p_contact uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  q public.ba_quotations;
  v_calc jsonb;
  v_gst boolean;
  v_content jsonb;
  v_ai boolean;
  v_old_items jsonb;
  v_old_gst boolean;
  v_old_content jsonb;
begin
  if jsonb_typeof(p_data) <> 'object' then raise exception 'VALIDATION_ERROR: The quotation is not valid.' using errcode = 'P0001'; end if;
  if p_id is null then
    c := private.ba_my_contact(p_contact);
  else
    perform private.require_business_associate();
    select * into q from public.ba_quotations where id = p_id;
    if q.id is null then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
    c := private.ba_my_contact(q.contact_id);
    if q.status = 'FINAL' then raise exception 'CONFLICT: A finalised quotation cannot be changed. Create a new revision instead.' using errcode = 'P0001'; end if;
    v_old_items := q.items; v_old_gst := q.gst_applicable; v_old_content := q.content;
  end if;
  v_gst := coalesce((p_data ->> 'gstApplicable')::boolean, v_old_gst, false);
  v_calc := private.ba_quote_calc(coalesce(p_data -> 'items', v_old_items), v_gst);
  v_content := coalesce(p_data -> 'content', v_old_content, '{}'::jsonb);
  if jsonb_typeof(v_content) <> 'object' or pg_column_size(v_content) > 100000 then raise exception 'VALIDATION_ERROR: The quotation text is too long.' using errcode = 'P0001'; end if;
  v_ai := coalesce((p_data ->> 'aiGenerated')::boolean, false);
  if p_data ? 'validityDays' and nullif(p_data ->> 'validityDays', '') is not null and ((p_data ->> 'validityDays')::int < 1 or (p_data ->> 'validityDays')::int > 365) then
    raise exception 'VALIDATION_ERROR: The validity period must be between 1 and 365 days.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.ba_quotations (quotation_no, contact_id, items, gst_applicable, subtotal, discount_total, taxable_total, tax_total, total, validity_days, payment_terms, timeline, notes,
                                      content, price_flags, ai_generated, ai_model, ai_generated_at, created_by)
    values ('QT-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.ba_quotation_seq')::text, 5, '0'), c.id, v_calc -> 'lines', v_gst,
            (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'discountTotal')::numeric, (v_calc ->> 'taxableTotal')::numeric, (v_calc ->> 'taxTotal')::numeric, (v_calc ->> 'total')::numeric,
            nullif(p_data ->> 'validityDays', '')::int, nullif(btrim(p_data ->> 'paymentTerms'), ''), nullif(btrim(p_data ->> 'timeline'), ''), nullif(btrim(p_data ->> 'notes'), ''),
            v_content, v_calc -> 'flags', v_ai, case when v_ai then p_data ->> 'aiModel' end, case when v_ai then now() end, private.my_id())
    returning * into q;
    perform private.ba_event(c.id, 'QUOTATION', format('Quotation %s drafted.', q.quotation_no));
    perform private.write_audit('BA_QUOTATION_CREATED', 'ba_quotation', q.id, c.department_id, c.team_id, jsonb_build_object('contact', c.id, 'number', q.quotation_no));
  else
    update public.ba_quotations set
      items = v_calc -> 'lines', gst_applicable = v_gst, subtotal = (v_calc ->> 'subtotal')::numeric, discount_total = (v_calc ->> 'discountTotal')::numeric,
      taxable_total = (v_calc ->> 'taxableTotal')::numeric, tax_total = (v_calc ->> 'taxTotal')::numeric, total = (v_calc ->> 'total')::numeric, price_flags = v_calc -> 'flags',
      validity_days = case when p_data ? 'validityDays' then nullif(p_data ->> 'validityDays', '')::int else validity_days end,
      payment_terms = case when p_data ? 'paymentTerms' then nullif(btrim(p_data ->> 'paymentTerms'), '') else payment_terms end,
      timeline = case when p_data ? 'timeline' then nullif(btrim(p_data ->> 'timeline'), '') else timeline end,
      notes = case when p_data ? 'notes' then nullif(btrim(p_data ->> 'notes'), '') else notes end,
      content = v_content,
      ai_generated = ai_generated or v_ai, ai_model = case when v_ai then p_data ->> 'aiModel' else ai_model end, ai_generated_at = case when v_ai then now() else ai_generated_at end,
      -- new AI text always needs a fresh review; the Business Associate's own edit does not clear a review by itself
      reviewed_by = case when v_ai then null else reviewed_by end, reviewed_at = case when v_ai then null else reviewed_at end,
      updated_at = now()
    where id = q.id returning * into q;
  end if;
  if coalesce((p_data ->> 'reviewed')::boolean, false) and q.reviewed_at is null then
    update public.ba_quotations set reviewed_by = private.my_id(), reviewed_at = now() where id = q.id returning * into q;
  end if;
  perform private.ba_advance(c.id, 'QUOTATION_PENDING', array['NEW', 'IN_PROGRESS']);
  return private.ba_quotation_full(q);
end $$;

create or replace function public.ba_quotation_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  q public.ba_quotations;
begin
  perform private.require_business_associate();
  select q0.* into q from public.ba_quotations q0 join public.ba_contacts c on c.id = q0.contact_id where q0.id = p_id and c.assigned_to = private.my_id();
  if q.id is null then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
  return private.ba_quotation_full(q);
end $$;

create or replace function public.ba_quotations_list(p_contact uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_business_associate();
  return coalesce((select jsonb_agg(private.ba_quotation_row(q) || jsonb_build_object('client', l.name, 'company', l.company) order by q.created_at desc)
    from public.ba_quotations q join public.ba_contacts c on c.id = q.contact_id join public.customers l on l.id = c.lead_id
   where c.assigned_to = private.my_id() and (p_contact is null or q.contact_id = p_contact)), '[]'::jsonb);
end $$;

-- A new draft revision of a finalised quotation (same number, revision + 1). One open revision at a time.
create or replace function public.ba_quotation_revise(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.ba_quotations;
  n public.ba_quotations;
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  select * into q from public.ba_quotations where id = p_id;
  if q.id is null then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
  c := private.ba_my_contact(q.contact_id);
  if q.status <> 'FINAL' then raise exception 'VALIDATION_ERROR: Only a finalised quotation needs a new revision; edit the draft instead.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.ba_quotations x where x.quotation_no = q.quotation_no and x.status = 'DRAFT') then
    raise exception 'CONFLICT: There is already a draft revision of this quotation.' using errcode = 'P0001';
  end if;
  insert into public.ba_quotations (quotation_no, revision, contact_id, items, gst_applicable, subtotal, discount_total, taxable_total, tax_total, total, validity_days, payment_terms, timeline, notes, content, price_flags, created_by)
  select q.quotation_no, (select max(revision) + 1 from public.ba_quotations where quotation_no = q.quotation_no), q.contact_id, q.items, q.gst_applicable, q.subtotal, q.discount_total, q.taxable_total, q.tax_total, q.total,
         q.validity_days, q.payment_terms, q.timeline, q.notes, q.content, q.price_flags, private.my_id()
  returning * into n;
  perform private.ba_event(c.id, 'QUOTATION', format('Quotation %s revision %s started.', n.quotation_no, n.revision));
  return private.ba_quotation_full(n);
end $$;

-- Mark the draft as read and checked by the Business Associate (an AI draft cannot be finalised before this).
create or replace function public.ba_quotation_review(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.ba_quotations;
begin
  perform private.require_business_associate();
  select q0.* into q from public.ba_quotations q0 join public.ba_contacts c on c.id = q0.contact_id where q0.id = p_id and c.assigned_to = private.my_id() for update of q0;
  if q.id is null then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
  if q.status = 'FINAL' then raise exception 'CONFLICT: A finalised quotation cannot be changed.' using errcode = 'P0001'; end if;
  update public.ba_quotations set reviewed_by = private.my_id(), reviewed_at = now() where id = q.id returning * into q;
  return private.ba_quotation_full(q);
end $$;

-- Step 1 of "Generate PDF": check that the quotation may be finalised and claim it (so two clicks make one PDF). Returns what the PDF is drawn from.
create or replace function public.ba_quotation_finalize_begin(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.ba_quotations;
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  select * into q from public.ba_quotations where id = p_id for update;
  if q.id is null then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
  c := private.ba_my_contact(q.contact_id);
  if q.status = 'FINAL' then raise exception 'CONFLICT: This quotation is already finalised.' using errcode = 'P0001'; end if;
  if q.ai_generated and q.reviewed_at is null then raise exception 'VALIDATION_ERROR: Review the AI draft first and confirm that you have checked it.' using errcode = 'P0001'; end if;
  if jsonb_array_length(q.items) = 0 then raise exception 'VALIDATION_ERROR: Add at least one service.' using errcode = 'P0001'; end if;
  if q.validity_days is null then raise exception 'VALIDATION_ERROR: Enter the validity period of the quotation.' using errcode = 'P0001'; end if;
  if q.payment_terms is null then raise exception 'VALIDATION_ERROR: Enter the payment terms.' using errcode = 'P0001'; end if;
  if q.claim_at is not null and q.claim_at > now() - interval '10 minutes' and q.claim_by is distinct from private.my_id() then
    raise exception 'CONFLICT: This quotation is being finalised.' using errcode = 'P0001';
  end if;
  update public.ba_quotations set claim_by = private.my_id(), claim_at = now() where id = q.id returning * into q;
  return private.ba_quotation_full(q) || jsonb_build_object('departmentId', c.department_id, 'issuedOn', (now() at time zone 'Asia/Kolkata')::date);
end $$;

-- Step 2: the API stored the PDF; the quotation becomes FINAL with its file reference. Only the claimant, only for the expected file.
create or replace function public.ba_quotation_finalize_record(p_id uuid, p_bucket text, p_path text, p_provider text, p_ref text, p_etag text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.ba_quotations;
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  select * into q from public.ba_quotations where id = p_id for update;
  if q.id is null then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
  c := private.ba_my_contact(q.contact_id);
  if q.status = 'FINAL' then return private.ba_quotation_full(q); end if;
  if q.claim_by is distinct from private.my_id() or q.claim_at is null or q.claim_at < now() - interval '10 minutes' then
    raise exception 'CONFLICT: Start the finalisation again.' using errcode = 'P0001';
  end if;
  if p_bucket <> 'ba-documents' or p_path <> format('%s/%s/quotation-%s-r%s.pdf', c.department_id, c.id, q.quotation_no, q.revision) then
    raise exception 'VALIDATION_ERROR: The stored file is not the one expected.' using errcode = 'P0001';
  end if;
  update public.ba_quotations set status = 'FINAL', finalized_by = private.my_id(), finalized_at = now(), valid_until = (now() at time zone 'Asia/Kolkata')::date + validity_days,
         pdf_bucket = p_bucket, pdf_path = p_path, pdf_provider = p_provider, pdf_ref = p_ref, pdf_etag = p_etag, pdf_size = p_size, claim_by = null, claim_at = null
   where id = q.id returning * into q;
  perform private.ba_event(c.id, 'QUOTATION', format('Quotation %s revision %s finalised (PDF).', q.quotation_no, q.revision));
  perform private.write_audit('BA_QUOTATION_FINALIZED', 'ba_quotation', q.id, c.department_id, c.team_id, jsonb_build_object('contact', c.id, 'number', q.quotation_no, 'revision', q.revision, 'total', q.total));
  -- a finalised quotation takes the contact out of "Quotation pending"
  perform private.ba_advance(c.id, 'IN_PROGRESS', array['QUOTATION_PENDING', 'NEW']);
  return private.ba_quotation_full(q);
end $$;

-- Where a finalised PDF is stored, for an authorised reader (its Business Associate, the Department Head, the Super Admin, the Team Lead of the team).
create or replace function public.ba_quotation_file(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  q public.ba_quotations;
  c public.ba_contacts;
begin
  select * into q from public.ba_quotations where id = p_id;
  select * into c from public.ba_contacts where id = q.contact_id;
  if q.id is null or c.id is null or not private.ba_can_read(c.assigned_to, c.department_id, c.team_id) then raise exception 'NOT_FOUND: Quotation not found.' using errcode = 'P0001'; end if;
  if q.status <> 'FINAL' or q.pdf_path is null then raise exception 'NOT_FOUND: This quotation has no PDF yet.' using errcode = 'P0001'; end if;
  return jsonb_build_object('bucket', q.pdf_bucket, 'path', q.pdf_path, 'provider', q.pdf_provider, 'fileName', q.quotation_no || '-r' || q.revision || '.pdf');
end $$;

-- ---------------------------------------------------------------------------
-- 7. Demo schedule
-- ---------------------------------------------------------------------------
-- Create (p_id null) or change a demo. A change to the time of a booked demo is a reschedule. p_data: contactId (new only), title, description, startsAt,
-- endsAt, mode, location, meetingLink, internalNotes. The Business Associate cannot be in two demos at once (checked here, one person at a time).
create or replace function public.ba_demo_save(p_id uuid, p_contact uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  d public.ba_demos;
  v_start timestamptz;
  v_end timestamptz;
  v_mode text;
  v_loc text;
  v_link text;
  v_title text;
  v_old_start timestamptz;
  v_moved boolean := false;
begin
  perform private.require_business_associate();
  if jsonb_typeof(p_data) <> 'object' then raise exception 'VALIDATION_ERROR: The demo is not valid.' using errcode = 'P0001'; end if;
  if p_id is null then
    c := private.ba_my_contact(p_contact);
  else
    select * into d from public.ba_demos where id = p_id for update;
    if d.id is null then raise exception 'NOT_FOUND: Demo not found.' using errcode = 'P0001'; end if;
    c := private.ba_my_contact(d.contact_id);
    if d.status in ('COMPLETED', 'CANCELLED') then raise exception 'CONFLICT: A % demo cannot be changed.', lower(d.status) using errcode = 'P0001'; end if;
    v_old_start := d.starts_at;
  end if;
  v_title := btrim(coalesce(p_data ->> 'title', d.title, ''));
  v_mode := coalesce(p_data ->> 'mode', d.mode);
  v_loc := nullif(btrim(coalesce(case when p_data ? 'location' then p_data ->> 'location' else d.location end, '')), '');
  v_link := nullif(btrim(coalesce(case when p_data ? 'meetingLink' then p_data ->> 'meetingLink' else d.meeting_link end, '')), '');
  begin
    v_start := coalesce((p_data ->> 'startsAt')::timestamptz, d.starts_at);
    v_end := coalesce((p_data ->> 'endsAt')::timestamptz, d.ends_at);
  exception when others then raise exception 'VALIDATION_ERROR: Enter a valid date and time.' using errcode = 'P0001';
  end;
  if length(v_title) < 1 or length(v_title) > 200 then raise exception 'VALIDATION_ERROR: Enter the demo title.' using errcode = 'P0001'; end if;
  if v_mode is null or v_mode not in ('ONLINE', 'IN_PERSON') then raise exception 'VALIDATION_ERROR: Choose Online or In person.' using errcode = 'P0001'; end if;
  if v_start is null or v_end is null then raise exception 'VALIDATION_ERROR: Enter the date and the start and end time.' using errcode = 'P0001'; end if;
  if v_end <= v_start then raise exception 'VALIDATION_ERROR: The end time must be after the start time.' using errcode = 'P0001'; end if;
  if v_end - v_start > interval '12 hours' then raise exception 'VALIDATION_ERROR: A demo can last at most 12 hours.' using errcode = 'P0001'; end if;
  if v_mode = 'IN_PERSON' and v_loc is null then raise exception 'VALIDATION_ERROR: Enter where the demo takes place.' using errcode = 'P0001'; end if;
  if v_mode = 'ONLINE' and v_loc is null and v_link is null then raise exception 'VALIDATION_ERROR: Enter the meeting platform or the meeting link.' using errcode = 'P0001'; end if;
  if v_mode = 'IN_PERSON' then v_link := null; end if;
  if v_link is not null and v_link !~* '^https?://[^\s]+$' then raise exception 'VALIDATION_ERROR: The meeting link must start with http:// or https://.' using errcode = 'P0001'; end if;
  if p_id is null or v_start is distinct from v_old_start then
    if v_start < now() - interval '5 minutes' then raise exception 'VALIDATION_ERROR: Choose a time that has not passed yet.' using errcode = 'P0001'; end if;
  end if;
  -- one person at a time: the Business Associate's other booked demos must not overlap
  perform pg_advisory_xact_lock(hashtext('ba_demo:' || c.assigned_to::text));
  if exists (select 1 from public.ba_demos x where x.assigned_to = c.assigned_to and x.status in ('SCHEDULED', 'RESCHEDULED') and x.id is distinct from p_id
               and tstzrange(x.starts_at, x.ends_at) && tstzrange(v_start, v_end)) then
    raise exception 'CONFLICT: You already have a demo at that time. Choose another time.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.ba_demos (contact_id, title, description, starts_at, ends_at, mode, location, meeting_link, assigned_to, internal_notes, created_by)
    values (c.id, v_title, nullif(btrim(coalesce(p_data ->> 'description', '')), ''), v_start, v_end, v_mode, v_loc, v_link, c.assigned_to, nullif(btrim(coalesce(p_data ->> 'internalNotes', '')), ''), private.my_id())
    returning * into d;
    perform private.ba_event(c.id, 'DEMO', format('Demo "%s" scheduled for %s.', d.title, to_char(d.starts_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')));
    perform private.ba_advance(c.id, 'DEMO_SCHEDULED', array['NEW', 'IN_PROGRESS', 'QUOTATION_PENDING']);
  else
    v_moved := v_start is distinct from d.starts_at or v_end is distinct from d.ends_at;
    update public.ba_demos set title = v_title,
      description = case when p_data ? 'description' then nullif(btrim(coalesce(p_data ->> 'description', '')), '') else description end,
      starts_at = v_start, ends_at = v_end, mode = v_mode, location = v_loc, meeting_link = v_link,
      internal_notes = case when p_data ? 'internalNotes' then nullif(btrim(coalesce(p_data ->> 'internalNotes', '')), '') else internal_notes end,
      status = case when v_moved then 'RESCHEDULED' else status end, reschedule_count = reschedule_count + case when v_moved then 1 else 0 end, updated_at = now()
     where id = d.id returning * into d;
    if v_moved then
      perform private.ba_event(c.id, 'DEMO', format('Demo "%s" rescheduled from %s to %s.', d.title, to_char(v_old_start at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM'), to_char(d.starts_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH12:MI AM')));
    end if;
  end if;
  return private.ba_demo_row(d);
end $$;

-- Mark a demo completed (with feedback and follow-up notes) or cancelled.
create or replace function public.ba_demo_status(p_id uuid, p_status text, p_feedback text default null, p_follow_up text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.ba_demos;
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  if p_status not in ('COMPLETED', 'CANCELLED') then raise exception 'VALIDATION_ERROR: A demo can be marked completed or cancelled.' using errcode = 'P0001'; end if;
  select * into d from public.ba_demos where id = p_id for update;
  if d.id is null then raise exception 'NOT_FOUND: Demo not found.' using errcode = 'P0001'; end if;
  c := private.ba_my_contact(d.contact_id);
  if d.status in ('COMPLETED', 'CANCELLED') then raise exception 'CONFLICT: This demo is already %.', lower(d.status) using errcode = 'P0001'; end if;
  if length(coalesce(p_feedback, '')) > 3000 or length(coalesce(p_follow_up, '')) > 3000 then raise exception 'VALIDATION_ERROR: The notes are too long.' using errcode = 'P0001'; end if;
  if p_status = 'COMPLETED' and d.starts_at > now() then raise exception 'VALIDATION_ERROR: A demo that has not started cannot be marked completed.' using errcode = 'P0001'; end if;
  update public.ba_demos set status = p_status, feedback = coalesce(nullif(btrim(coalesce(p_feedback, '')), ''), feedback), follow_up_notes = coalesce(nullif(btrim(coalesce(p_follow_up, '')), ''), follow_up_notes), updated_at = now()
   where id = d.id returning * into d;
  perform private.ba_event(c.id, 'DEMO', format('Demo "%s" %s.', d.title, lower(p_status)));
  if p_status = 'COMPLETED' then
    perform private.ba_advance(c.id, 'SCOPE_PENDING', array['NEW', 'IN_PROGRESS', 'QUOTATION_PENDING', 'DEMO_SCHEDULED']);
  elsif not exists (select 1 from public.ba_demos x where x.contact_id = c.id and x.status in ('SCHEDULED', 'RESCHEDULED')) then
    perform private.ba_advance(c.id, 'IN_PROGRESS', array['DEMO_SCHEDULED']);
  end if;
  return private.ba_demo_row(d);
end $$;

-- The Business Associate's demos in a window (default: from a month ago to three months ahead), optionally one status or one contact.
create or replace function public.ba_demos_list(p_from timestamptz default null, p_to timestamptz default null, p_status text default null, p_contact uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_business_associate();
  if p_status is not null and p_status not in ('SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED') then raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(private.ba_demo_row(d) order by d.starts_at)
    from public.ba_demos d
   where d.assigned_to = private.my_id() and (p_contact is null or d.contact_id = p_contact) and (p_status is null or d.status = p_status)
     and d.starts_at >= coalesce(p_from, now() - interval '1 month') and d.starts_at < coalesce(p_to, now() + interval '3 months')), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 8. Scope of Project documents
-- ---------------------------------------------------------------------------
create or replace function private.ba_scope_full(s public.ba_scope_docs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.ba_scope_row(s) || jsonb_build_object('inputs', s.inputs, 'content', s.content, 'aiModel', s.ai_model, 'reviewedAt', s.reviewed_at,
    'client', (select jsonb_build_object('name', l.name, 'company', l.company) from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = s.contact_id))
$$;
revoke all on function private.ba_scope_full(public.ba_scope_docs) from public, anon, authenticated;

-- What the AI (and the editor) may know about one contact: the client's own details, the requirements, the profile, the services,
-- the notes and a short summary of the latest finalised quotation and the demos. Nothing about any other client.
create or replace function public.ba_scope_context(p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  l public.customers;
  q public.ba_quotations;
begin
  perform private.require_business_associate();
  select * into c from public.ba_contacts where id = p_contact and assigned_to = private.my_id();
  if c.id is null then raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001'; end if;
  select * into l from public.customers where id = c.lead_id;
  select * into q from public.ba_quotations where contact_id = c.id and status = 'FINAL' order by finalized_at desc limit 1;
  return jsonb_build_object(
    'contactId', c.id,
    'client', jsonb_build_object('name', l.name, 'company', l.company, 'address', l.address, 'city', l.city, 'businessCategory', l.business_category, 'leadSource', l.lead_source, 'notes', l.notes),
    'requirements', c.requirements, 'profile', c.profile,
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.service_code, 'name', cs.name, 'category', cs.category) order by cs.sort_order)
                            from public.customer_services s join public.crm_services cs on cs.code = s.service_code where s.customer_id = l.id), '[]'::jsonb),
    'catalogue', coalesce((select jsonb_agg(jsonb_build_object('code', cs.code, 'name', cs.name, 'category', cs.category) order by cs.sort_order) from public.crm_services cs where cs.is_active), '[]'::jsonb),
    'communicationNotes', coalesce((select jsonb_agg(e.note order by e.created_at) from (select note, created_at from public.ba_contact_events where contact_id = c.id and kind in ('NOTE', 'REQUIREMENTS') order by created_at desc limit 20) e), '[]'::jsonb),
    'quotation', case when q.id is null then null else jsonb_build_object('number', q.quotation_no, 'revision', q.revision, 'total', q.total, 'gstApplicable', q.gst_applicable,
                   'services', (select jsonb_agg(i ->> 'name') from jsonb_array_elements(q.items) i)) end,
    'demos', coalesce((select jsonb_agg(jsonb_build_object('title', d.title, 'status', d.status, 'feedback', d.feedback, 'followUpNotes', d.follow_up_notes) order by d.starts_at)
                         from public.ba_demos d where d.contact_id = c.id and d.status <> 'CANCELLED'), '[]'::jsonb),
    'previousVersions', coalesce((select jsonb_agg(jsonb_build_object('version', s.version, 'status', s.status)) from public.ba_scope_docs s where s.contact_id = c.id), '[]'::jsonb));
end $$;

-- Create the next DRAFT version (copying the latest version's inputs and content, unless p_data says otherwise) or update an open draft.
-- p_data: title, inputs, content, aiGenerated / aiModel (set by the API after an AI draft), reviewed.
create or replace function public.ba_scope_save(p_id uuid, p_contact uuid, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.ba_contacts;
  s public.ba_scope_docs;
  prev public.ba_scope_docs;
  v_ai boolean;
  v_inputs jsonb;
  v_content jsonb;
  v_old_inputs jsonb;
  v_old_content jsonb;
begin
  perform private.require_business_associate();
  if jsonb_typeof(p_data) <> 'object' then raise exception 'VALIDATION_ERROR: The document is not valid.' using errcode = 'P0001'; end if;
  if p_id is null then
    c := private.ba_my_contact(p_contact);
    if exists (select 1 from public.ba_scope_docs x where x.contact_id = c.id and x.status = 'DRAFT') then
      raise exception 'CONFLICT: There is already a draft version. Open it instead of starting another.' using errcode = 'P0001';
    end if;
    select * into prev from public.ba_scope_docs where contact_id = c.id order by version desc limit 1;
    v_old_inputs := prev.inputs; v_old_content := prev.content;
  else
    select * into s from public.ba_scope_docs where id = p_id for update;
    if s.id is null then raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001'; end if;
    c := private.ba_my_contact(s.contact_id);
    if s.status = 'FINAL' then raise exception 'CONFLICT: A finalised version cannot be changed. Start a new version instead.' using errcode = 'P0001'; end if;
    v_old_inputs := s.inputs; v_old_content := s.content;
  end if;
  v_inputs := coalesce(p_data -> 'inputs', v_old_inputs, '{}'::jsonb);
  v_content := coalesce(p_data -> 'content', v_old_content, '{}'::jsonb);
  if jsonb_typeof(v_inputs) <> 'object' or jsonb_typeof(v_content) <> 'object' or pg_column_size(v_inputs) > 60000 or pg_column_size(v_content) > 200000 then
    raise exception 'VALIDATION_ERROR: The document is too long.' using errcode = 'P0001';
  end if;
  v_ai := coalesce((p_data ->> 'aiGenerated')::boolean, false);
  if p_id is null then
    insert into public.ba_scope_docs (contact_id, version, title, inputs, content, ai_generated, ai_model, ai_generated_at, created_by)
    values (c.id, coalesce((select max(version) from public.ba_scope_docs where contact_id = c.id), 0) + 1, coalesce(nullif(btrim(p_data ->> 'title'), ''), 'Scope of Project'), v_inputs, v_content,
            v_ai, case when v_ai then p_data ->> 'aiModel' end, case when v_ai then now() end, private.my_id())
    returning * into s;
    perform private.ba_event(c.id, 'SCOPE', format('Scope of Project version %s started.', s.version));
    perform private.write_audit('BA_SCOPE_CREATED', 'ba_scope_doc', s.id, c.department_id, c.team_id, jsonb_build_object('contact', c.id, 'version', s.version));
  else
    update public.ba_scope_docs set title = coalesce(nullif(btrim(p_data ->> 'title'), ''), title), inputs = v_inputs, content = v_content,
      ai_generated = ai_generated or v_ai, ai_model = case when v_ai then p_data ->> 'aiModel' else ai_model end, ai_generated_at = case when v_ai then now() else ai_generated_at end,
      reviewed_by = case when v_ai then null else reviewed_by end, reviewed_at = case when v_ai then null else reviewed_at end, updated_at = now()
     where id = s.id returning * into s;
  end if;
  if coalesce((p_data ->> 'reviewed')::boolean, false) and s.reviewed_at is null then
    update public.ba_scope_docs set reviewed_by = private.my_id(), reviewed_at = now() where id = s.id returning * into s;
  end if;
  perform private.ba_advance(c.id, 'IN_PROGRESS', array['NEW']);
  return private.ba_scope_full(s);
end $$;

create or replace function public.ba_scope_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.ba_scope_docs;
begin
  perform private.require_business_associate();
  select s0.* into s from public.ba_scope_docs s0 join public.ba_contacts c on c.id = s0.contact_id where s0.id = p_id and c.assigned_to = private.my_id();
  if s.id is null then raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001'; end if;
  return private.ba_scope_full(s) || jsonb_build_object('client', (select jsonb_build_object('name', l.name, 'company', l.company) from public.ba_contacts c join public.customers l on l.id = c.lead_id where c.id = s.contact_id));
end $$;

create or replace function public.ba_scope_list(p_contact uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_business_associate();
  return coalesce((select jsonb_agg(private.ba_scope_row(s) order by s.version desc)
    from public.ba_scope_docs s join public.ba_contacts c on c.id = s.contact_id where c.assigned_to = private.my_id() and s.contact_id = p_contact), '[]'::jsonb);
end $$;

create or replace function public.ba_scope_review(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.ba_scope_docs;
begin
  perform private.require_business_associate();
  select s0.* into s from public.ba_scope_docs s0 join public.ba_contacts c on c.id = s0.contact_id where s0.id = p_id and c.assigned_to = private.my_id() for update of s0;
  if s.id is null then raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001'; end if;
  if s.status = 'FINAL' then raise exception 'CONFLICT: A finalised version cannot be changed.' using errcode = 'P0001'; end if;
  update public.ba_scope_docs set reviewed_by = private.my_id(), reviewed_at = now() where id = s.id returning * into s;
  return private.ba_scope_full(s);
end $$;

create or replace function public.ba_scope_finalize_begin(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.ba_scope_docs;
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  select * into s from public.ba_scope_docs where id = p_id for update;
  if s.id is null then raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001'; end if;
  c := private.ba_my_contact(s.contact_id);
  if s.status = 'FINAL' then raise exception 'CONFLICT: This version is already finalised.' using errcode = 'P0001'; end if;
  if s.ai_generated and s.reviewed_at is null then raise exception 'VALIDATION_ERROR: Review the AI draft first and confirm that you have checked it.' using errcode = 'P0001'; end if;
  if coalesce(s.content, '{}'::jsonb) = '{}'::jsonb then raise exception 'VALIDATION_ERROR: The document is empty. Generate or write the scope first.' using errcode = 'P0001'; end if;
  if s.claim_at is not null and s.claim_at > now() - interval '10 minutes' and s.claim_by is distinct from private.my_id() then
    raise exception 'CONFLICT: This version is being finalised.' using errcode = 'P0001';
  end if;
  update public.ba_scope_docs set claim_by = private.my_id(), claim_at = now() where id = s.id returning * into s;
  return private.ba_scope_full(s) || jsonb_build_object('departmentId', c.department_id,
    'serviceNames', coalesce((select jsonb_object_agg(cs.code, cs.name) from public.crm_services cs), '{}'::jsonb),
    'client', (select jsonb_build_object('name', l.name, 'company', l.company) from public.customers l where l.id = c.lead_id), 'issuedOn', (now() at time zone 'Asia/Kolkata')::date);
end $$;

create or replace function public.ba_scope_finalize_record(p_id uuid, p_bucket text, p_path text, p_provider text, p_ref text, p_etag text, p_size bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.ba_scope_docs;
  c public.ba_contacts;
begin
  perform private.require_business_associate();
  select * into s from public.ba_scope_docs where id = p_id for update;
  if s.id is null then raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001'; end if;
  c := private.ba_my_contact(s.contact_id);
  if s.status = 'FINAL' then return private.ba_scope_full(s); end if;
  if s.claim_by is distinct from private.my_id() or s.claim_at is null or s.claim_at < now() - interval '10 minutes' then
    raise exception 'CONFLICT: Start the finalisation again.' using errcode = 'P0001';
  end if;
  if p_bucket <> 'ba-documents' or p_path <> format('%s/%s/scope-v%s.pdf', c.department_id, c.id, s.version) then
    raise exception 'VALIDATION_ERROR: The stored file is not the one expected.' using errcode = 'P0001';
  end if;
  update public.ba_scope_docs set status = 'FINAL', finalized_by = private.my_id(), finalized_at = now(), pdf_bucket = p_bucket, pdf_path = p_path, pdf_provider = p_provider,
         pdf_ref = p_ref, pdf_etag = p_etag, pdf_size = p_size, claim_by = null, claim_at = null where id = s.id returning * into s;
  perform private.ba_event(c.id, 'SCOPE', format('Scope of Project version %s finalised (PDF).', s.version));
  perform private.write_audit('BA_SCOPE_FINALIZED', 'ba_scope_doc', s.id, c.department_id, c.team_id, jsonb_build_object('contact', c.id, 'version', s.version));
  perform private.ba_advance(c.id, 'IN_PROGRESS', array['SCOPE_PENDING', 'NEW']);
  return private.ba_scope_full(s);
end $$;

create or replace function public.ba_scope_file(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.ba_scope_docs;
  c public.ba_contacts;
begin
  select * into s from public.ba_scope_docs where id = p_id;
  select * into c from public.ba_contacts where id = s.contact_id;
  if s.id is null or c.id is null or not private.ba_can_read(c.assigned_to, c.department_id, c.team_id) then raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001'; end if;
  if s.status <> 'FINAL' or s.pdf_path is null then raise exception 'NOT_FOUND: This version has no PDF yet.' using errcode = 'P0001'; end if;
  return jsonb_build_object('bucket', s.pdf_bucket, 'path', s.pdf_path, 'provider', s.pdf_provider, 'fileName', 'scope-of-project-v' || s.version || '.pdf');
end $$;

-- ---------------------------------------------------------------------------
-- 9. The Business Associate's own leads (the same Sales leads as everywhere: customers in the LEAD stage, owned by the person)
-- ---------------------------------------------------------------------------
create or replace function public.ba_leads_list(p_search text default null, p_temperature text default null, p_call_status text default null, p_source text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
begin
  perform private.require_business_associate();
  if p_temperature is not null and p_temperature not in ('HOT', 'WARM', 'COLD') then raise exception 'VALIDATION_ERROR: Unknown lead temperature.' using errcode = 'P0001'; end if;
  if p_call_status is not null and p_call_status not in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED') then raise exception 'VALIDATION_ERROR: Unknown call status.' using errcode = 'P0001'; end if;
  select count(*) into v_total from public.customers c
   where c.owner_id = private.my_id() and c.lifecycle_stage = 'LEAD'
     and (p_temperature is null or c.lead_temperature = p_temperature) and (p_call_status is null or c.call_status = p_call_status) and (p_source is null or c.lead_source = p_source)
     and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.email, ''))) > 0);
  return jsonb_build_object('total', v_total, 'page', v_page, 'pageSize', v_size,
    'sources', coalesce((select jsonb_agg(distinct c.lead_source order by c.lead_source) from public.customers c where c.owner_id = private.my_id() and c.lifecycle_stage = 'LEAD' and c.lead_source is not null), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.telecaller_lead_json(x) order by x.created_at desc, x.id)
      from (select c.* from public.customers c
             where c.owner_id = private.my_id() and c.lifecycle_stage = 'LEAD'
               and (p_temperature is null or c.lead_temperature = p_temperature) and (p_call_status is null or c.call_status = p_call_status) and (p_source is null or c.lead_source = p_source)
               and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.email, ''))) > 0)
             order by c.created_at desc, c.id limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb));
end $$;

create or replace function public.ba_lead_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
begin
  perform private.require_business_associate();
  select * into c from public.customers where id = p_id and owner_id = private.my_id() and lifecycle_stage = 'LEAD';
  if c.id is null then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  return private.telecaller_lead_json(c);
end $$;

create or replace function public.ba_lead_save(p_id uuid, p_fields jsonb, p_services text[], p_temperature text, p_call_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  c public.customers;
begin
  perform private.require_business_associate();
  if p_temperature is null or p_temperature not in ('HOT', 'WARM', 'COLD') then raise exception 'VALIDATION_ERROR: Choose the lead temperature: Hot, Warm or Cold.' using errcode = 'P0001'; end if;
  if p_call_status is null or p_call_status not in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED') then raise exception 'VALIDATION_ERROR: Choose the call status.' using errcode = 'P0001'; end if;
  if p_id is null then
    v_id := public.create_lead(p_fields || jsonb_build_object('ownerId', private.my_id()), p_services);
  else
    perform 1 from public.customers where id = p_id and owner_id = private.my_id() and lifecycle_stage = 'LEAD';
    if not found then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
    perform public.update_lead(p_id, p_fields - 'ownerId', p_services);
  end if;
  update public.customers set lead_temperature = p_temperature, call_status = p_call_status where id = v_id returning * into c;
  if p_id is not null then
    insert into public.customer_activities (customer_id, type, note) values (v_id, 'LEAD_UPDATED', format('Temperature %s, call status %s', initcap(p_temperature), initcap(replace(lower(p_call_status), '_', ' '))));
  end if;
  return private.telecaller_lead_json(c);
end $$;

-- ---------------------------------------------------------------------------
-- 10. Home
-- ---------------------------------------------------------------------------
create or replace function public.ba_home()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.my_id();
  v_today date := private.hr_today();
begin
  perform private.require_business_associate();
  return jsonb_build_object(
    'today', v_today,
    'assignedContacts', (select count(*) from public.ba_contacts c where c.assigned_to = v_me),
    'newContacts', (select count(*) from public.ba_contacts c where c.assigned_to = v_me and c.stage = 'NEW'),
    'leadsInProgress', (select count(*) from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD' and coalesce(c.call_status, 'PENDING') not in ('COMPLETED', 'NOT_INTERESTED')),
    'quotationsDrafted', (select count(*) from public.ba_quotations q join public.ba_contacts c on c.id = q.contact_id where c.assigned_to = v_me and q.status = 'DRAFT'),
    'quotationsAwaitingReview', (select count(*) from public.ba_quotations q join public.ba_contacts c on c.id = q.contact_id where c.assigned_to = v_me and q.status = 'DRAFT' and q.ai_generated and q.reviewed_at is null),
    'upcomingDemos', (select count(*) from public.ba_demos d where d.assigned_to = v_me and d.status in ('SCHEDULED', 'RESCHEDULED') and d.ends_at >= now()),
    'scopeDocumentsGenerated', (select count(*) from public.ba_scope_docs s join public.ba_contacts c on c.id = s.contact_id where c.assigned_to = v_me),
    'followUpsDue', (select count(*) from public.ba_contacts c where c.assigned_to = v_me and c.stage <> 'COMPLETED' and c.next_follow_up <= v_today)
                  + (select count(*) from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD' and (c.next_follow_up_at at time zone 'Asia/Kolkata')::date <= v_today and coalesce(c.call_status, 'PENDING') not in ('COMPLETED', 'NOT_INTERESTED')),
    'stageCounts', coalesce((select jsonb_object_agg(s.stage, s.n) from (select stage, count(*) n from public.ba_contacts where assigned_to = v_me group by stage) s), '{}'::jsonb),
    'upcoming', coalesce((select jsonb_agg(private.ba_demo_row(d) order by d.starts_at) from (select * from public.ba_demos where assigned_to = v_me and status in ('SCHEDULED', 'RESCHEDULED') and ends_at >= now() order by starts_at limit 5) d), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('contactId', e.contact_id, 'client', e.client, 'kind', e.kind, 'note', e.note, 'at', e.created_at) order by e.created_at desc)
                          from (select ev.*, l.name as client from public.ba_contact_events ev join public.ba_contacts c on c.id = ev.contact_id join public.customers l on l.id = c.lead_id
                                 where c.assigned_to = v_me order by ev.created_at desc limit 8) e), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
do $$ declare f text; begin
  foreach f in array array[
    'service_prices_list()', 'service_price_save(text, text, numeric, numeric, numeric, boolean)', 'ba_assignees()', 'telecaller_lead_convert(uuid, uuid, text)', 'ba_contact_reassign(uuid, uuid)',
    'ba_contacts_list(text, text, integer, integer)', 'ba_contact_get(uuid)', 'ba_contact_update(uuid, jsonb)', 'ba_contact_note_add(uuid, text)',
    'ba_quotation_save(uuid, uuid, jsonb)', 'ba_quotation_get(uuid)', 'ba_quotations_list(uuid)', 'ba_quotation_revise(uuid)', 'ba_quotation_review(uuid)',
    'ba_quotation_finalize_begin(uuid)', 'ba_quotation_finalize_record(uuid, text, text, text, text, text, bigint)', 'ba_quotation_file(uuid)',
    'ba_demo_save(uuid, uuid, jsonb)', 'ba_demo_status(uuid, text, text, text)', 'ba_demos_list(timestamptz, timestamptz, text, uuid)',
    'ba_scope_context(uuid)', 'ba_scope_save(uuid, uuid, jsonb)', 'ba_scope_get(uuid)', 'ba_scope_list(uuid)', 'ba_scope_review(uuid)',
    'ba_scope_finalize_begin(uuid)', 'ba_scope_finalize_record(uuid, text, text, text, text, text, bigint)', 'ba_scope_file(uuid)',
    'ba_leads_list(text, text, text, text, integer, integer)', 'ba_lead_get(uuid)', 'ba_lead_save(uuid, jsonb, text[], text, text)', 'ba_home()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
