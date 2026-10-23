-- =============================================================================
-- Telecaller (a Sales sub-role): sub-role on the profile, contact lists assigned by the Department Head, call tracking, and leads with a
-- temperature. Backward compatible and safe to run again; nothing is deleted or rewritten.
--
--   * profiles.sales_sub_role: Telecaller, Business Associate, Influencer, Visit Sales, Business Partner. It is a CLASSIFICATION of a Sales
--     team member (the department and team stay as they are); empty for everybody who has none today. Only the Super Admin and the
--     Department Head of the department set it (set_sales_sub_role). Only Telecaller has a dashboard so far ('telecaller'); the others
--     get a 'sales-<role>' dashboard value that the app answers with a "not set up yet" page.
--   * customers.lead_temperature (HOT / WARM / COLD) and customers.call_status: the two are separate fields. A Telecaller's leads are the
--     existing Sales leads (customers in the LEAD stage), so they stay part of the Sales pipeline.
--   * telecaller_contact_lists / telecaller_contacts: the Excel contact sheet the Department Head assigns to one Telecaller and its contacts,
--     with the call status, last call, follow-up date and remarks the Telecaller records.
-- Nothing here is written directly by a user: every change goes through a function that checks who is asking.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The sub-role
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists sales_sub_role text;
alter table public.profiles drop constraint if exists profiles_sales_sub_role_check;
alter table public.profiles add constraint profiles_sales_sub_role_check
  check (sales_sub_role is null or sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE', 'INFLUENCER', 'VISIT_SALES', 'BUSINESS_PARTNER'));

-- The dashboard a person opens: a Sales Team Member with a sub-role gets its own value; a sub-role is cleared when the person is not (or is
-- no longer) a Team Member of a Sales team.
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
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

-- Set (or clear, with null) the Sales sub-role of a Sales Team Member. Super Admin, or the Department Head of that department.
create or replace function public.set_sales_sub_role(p_profile uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_division text;
begin
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  if not (private.my_role() = 'SUPER_ADMIN' or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can set a Sales role.' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('TELECALLER', 'BUSINESS_ASSOCIATE', 'INFLUENCER', 'VISIT_SALES', 'BUSINESS_PARTNER') then
    raise exception 'VALIDATION_ERROR: Choose Telecaller, Business Associate, Influencer, Visit Sales or Business Partner.' using errcode = 'P0001';
  end if;
  select division into v_division from public.teams where id = t.team_id;
  if p_role is not null and (t.role <> 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    raise exception 'VALIDATION_ERROR: A Sales role can only be given to a Team Member of a Sales team.' using errcode = 'P0001';
  end if;
  update public.profiles set sales_sub_role = p_role where id = t.id returning * into t;
  perform private.write_audit('SALES_SUB_ROLE_SET', 'profile', t.id, t.department_id, t.team_id, jsonb_build_object('salesSubRole', p_role));
  return jsonb_build_object('id', t.id, 'salesSubRole', t.sales_sub_role, 'defaultDashboard', t.default_dashboard);
end $$;
revoke all on function public.set_sales_sub_role(uuid, text) from public, anon;
grant execute on function public.set_sales_sub_role(uuid, text) to authenticated;

-- Everyone's dashboard value is recomputed (a no-op for people without a sub-role).
update public.profiles set updated_at = updated_at where role = 'TEAM_MEMBER';

-- Is the caller an active Telecaller?
create or replace function private.is_telecaller()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = private.my_id() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.sales_sub_role = 'TELECALLER')
$$;
revoke all on function private.is_telecaller() from public, anon;
grant execute on function private.is_telecaller() to authenticated, service_role;
create or replace function private.require_telecaller()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_telecaller() then raise exception 'FORBIDDEN: This page is for Telecallers.' using errcode = '42501'; end if;
end $$;
revoke all on function private.require_telecaller() from public, anon;
grant execute on function private.require_telecaller() to authenticated, service_role;
-- Super Admin, or the Department Head of a department (the people who assign contact sheets)
create or replace function private.require_sheet_assigner()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can assign contact sheets.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_sheet_assigner() from public, anon;
grant execute on function private.require_sheet_assigner() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Leads: temperature and call status (two different things)
-- ---------------------------------------------------------------------------
alter table public.customers add column if not exists lead_temperature text;
alter table public.customers add column if not exists call_status text;
alter table public.customers drop constraint if exists customers_lead_temperature_check;
alter table public.customers add constraint customers_lead_temperature_check check (lead_temperature is null or lead_temperature in ('HOT', 'WARM', 'COLD'));
alter table public.customers drop constraint if exists customers_call_status_check;
alter table public.customers add constraint customers_call_status_check
  check (call_status is null or call_status in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED'));
create index if not exists customers_telecaller_leads_idx on public.customers (owner_id, created_at desc) where lifecycle_stage = 'LEAD';

-- ---------------------------------------------------------------------------
-- 3. Contact sheets and contacts
-- ---------------------------------------------------------------------------
create table if not exists public.telecaller_contact_lists (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  note text check (note is null or length(note) <= 500),
  content_hash text not null,                                           -- a sheet already assigned to the same person is not assigned twice
  total_contacts integer not null check (total_contacts between 1 and 2000),
  source_bucket text, source_path text, source_provider text, source_ref text, source_etag text, source_size bigint, source_stored_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assigned_to, content_hash)
);
create index if not exists telecaller_lists_assignee_idx on public.telecaller_contact_lists (assigned_to, created_at desc);

create table if not exists public.telecaller_contacts (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.telecaller_contact_lists(id) on delete cascade,
  row_no integer not null,
  assigned_to uuid not null references public.profiles(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null check (length(btrim(name)) between 1 and 200),
  company text check (company is null or length(company) <= 200),
  phone text not null check (phone ~ '^\+?[0-9]{7,15}$'),
  email text check (email is null or (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254)),
  call_status text not null default 'PENDING' check (call_status in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED')),
  call_count integer not null default 0,
  last_called_at timestamptz,
  follow_up_date date,
  remarks text check (remarks is null or length(remarks) <= 1000),
  assigned_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (list_id, row_no)
);
create index if not exists telecaller_contacts_assignee_idx on public.telecaller_contacts (assigned_to, call_status);
create index if not exists telecaller_contacts_follow_up_idx on public.telecaller_contacts (assigned_to, follow_up_date) where follow_up_date is not null;

-- who may READ a sheet or its contacts: the person it is assigned to, the Super Admin, the Department Head of the department, the Team Lead of the team
create or replace function private.telecaller_can_read(p_assignee uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_assignee = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and p_department = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and p_team is not null and p_team = private.my_team_id())
$$;
revoke all on function private.telecaller_can_read(uuid, uuid, uuid) from public, anon;
grant execute on function private.telecaller_can_read(uuid, uuid, uuid) to authenticated, service_role;

alter table public.telecaller_contact_lists enable row level security;
alter table public.telecaller_contacts enable row level security;
revoke all on public.telecaller_contact_lists, public.telecaller_contacts from anon, authenticated;
drop policy if exists telecaller_lists_select on public.telecaller_contact_lists;
create policy telecaller_lists_select on public.telecaller_contact_lists for select to authenticated using (private.telecaller_can_read(assigned_to, department_id, team_id));
drop policy if exists telecaller_contacts_select on public.telecaller_contacts;
create policy telecaller_contacts_select on public.telecaller_contacts for select to authenticated using (private.telecaller_can_read(assigned_to, department_id, team_id));
grant select on public.telecaller_contact_lists, public.telecaller_contacts to authenticated;

-- Private bucket for the original Excel files (the API stores them after the database allowed the assignment; downloads would be signed).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('telecaller-sheets', 'telecaller-sheets', false, 1048576, array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Department Head / Super Admin: assign a contact sheet
-- ---------------------------------------------------------------------------
-- The Telecallers the caller may assign a sheet to: the active Telecallers of their department (the Super Admin: of the given department).
create or replace function public.telecaller_assignable(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
begin
  perform private.require_sheet_assigner();
  v_dept := case when private.my_role() = 'SUPER_ADMIN' then p_department else private.my_department_id() end;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name, 'departmentId', p.department_id,
                     'openContacts', (select count(*) from public.telecaller_contacts c where c.assigned_to = p.id and c.call_status = 'PENDING')) order by p.full_name)
                     from public.profiles p join public.teams t on t.id = p.team_id
                    where p.sales_sub_role = 'TELECALLER' and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and (v_dept is null or p.department_id = v_dept)), '[]'::jsonb);
end $$;

-- Check the rows of a sheet and, with p_commit and no problem found, assign the sheet. p_rows: [{"row": 2, "name": "...", "company": "...", "phone": "...", "email": "...", "remarks": "..."}].
-- Nothing is saved while any row has a problem; the answer lists every problem and a preview of the valid rows.
create or replace function public.telecaller_list_assign(p_assignee uuid, p_file_name text, p_note text, p_rows jsonb, p_hash text, p_commit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles;
  r jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_phone text;
  v_email text;
  v_name text;
  v_row integer;
  v_valid integer := 0;
  v_list uuid;
  v_dup boolean := false;
begin
  perform private.require_sheet_assigner();
  select * into a from public.profiles where id = p_assignee;
  if a.id is null or a.sales_sub_role is distinct from 'TELECALLER' or a.status <> 'ACTIVE' or a.role <> 'TEAM_MEMBER' then
    raise exception 'VALIDATION_ERROR: Choose an active Telecaller.' using errcode = 'P0001';
  end if;
  if private.my_role() = 'DEPARTMENT_HEAD' and a.department_id is distinct from private.my_department_id() then
    raise exception 'FORBIDDEN: You can only assign sheets to Telecallers of your own department.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_file_name, ''))) < 1 or length(p_file_name) > 200 then raise exception 'VALIDATION_ERROR: The file name is missing.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'VALIDATION_ERROR: The sheet has no contact rows.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'VALIDATION_ERROR: A sheet can have at most 2,000 contacts.' using errcode = 'P0001'; end if;
  if length(coalesce(p_hash, '')) < 16 then raise exception 'VALIDATION_ERROR: The sheet could not be identified.' using errcode = 'P0001'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((r ->> 'row')::int, 0);
    v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
    v_phone := regexp_replace(coalesce(r ->> 'phone', ''), '[\s().-]', '', 'g');
    v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
    if v_name is null then v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The contact name is missing.');
    elsif length(v_name) > 200 then v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The contact name is too long.');
    elsif v_phone !~ '^\+?[0-9]{7,15}$' then v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The phone number is missing or not valid (7 to 15 digits).');
    elsif v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254) then v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The e-mail address is not valid.');
    elsif length(coalesce(r ->> 'company', '')) > 200 or length(coalesce(r ->> 'remarks', '')) > 1000 then v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'The company or remarks text is too long.');
    elsif v_phone = any (v_seen) then v_errors := v_errors || jsonb_build_object('row', v_row, 'message', 'This phone number appears twice in the sheet.');
    else
      v_seen := v_seen || v_phone;
      v_valid := v_valid + 1;
      v_clean := v_clean || jsonb_build_object('row', v_row, 'name', v_name, 'company', nullif(btrim(coalesce(r ->> 'company', '')), ''), 'phone', v_phone, 'email', v_email, 'remarks', nullif(btrim(coalesce(r ->> 'remarks', '')), ''));
    end if;
    exit when jsonb_array_length(v_errors) >= 50;
  end loop;

  select exists (select 1 from public.telecaller_contact_lists l where l.assigned_to = a.id and l.content_hash = p_hash) into v_dup;
  if p_commit and v_dup then raise exception 'CONFLICT: This sheet has already been assigned to %.', a.full_name using errcode = 'P0001'; end if;

  if p_commit and jsonb_array_length(v_errors) = 0 then
    insert into public.telecaller_contact_lists (department_id, team_id, assigned_to, assigned_by, file_name, note, content_hash, total_contacts)
    values (a.department_id, a.team_id, a.id, private.my_id(), btrim(p_file_name), nullif(btrim(coalesce(p_note, '')), ''), p_hash, v_valid)
    returning id into v_list;
    insert into public.telecaller_contacts (list_id, row_no, assigned_to, department_id, team_id, name, company, phone, email, remarks)
    select v_list, (x ->> 'row')::int, a.id, a.department_id, a.team_id, x ->> 'name', x ->> 'company', x ->> 'phone', x ->> 'email', x ->> 'remarks'
      from jsonb_array_elements(v_clean) x;
    perform private.notify(a.id, 'CONTACT_SHEET_ASSIGNED', format('New contact sheet: %s', btrim(p_file_name)), format('%s contact%s assigned to you.', v_valid, case when v_valid = 1 then '' else 's' end), 'telecaller_list', v_list);
    perform private.write_audit('TELECALLER_SHEET_ASSIGNED', 'telecaller_list', v_list, a.department_id, a.team_id, jsonb_build_object('contacts', v_valid, 'assignee', a.id));
  end if;
  return jsonb_build_object('committed', v_list is not null, 'listId', v_list, 'alreadyAssigned', v_dup,
    'errors', v_errors, 'summary', jsonb_build_object('rows', jsonb_array_length(p_rows), 'valid', v_valid, 'invalid', jsonb_array_length(v_errors)),
    'preview', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_clean) x limit 25) q));
end $$;

-- The assigner may attach the original file to a sheet they assigned (the API then stores it and records the reference).
create or replace function public.telecaller_list_source_begin(p_list uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  l public.telecaller_contact_lists;
begin
  perform private.require_sheet_assigner();
  select * into l from public.telecaller_contact_lists where id = p_list;
  if l.id is null or not (private.my_role() = 'SUPER_ADMIN' or l.assigned_by = private.my_id()) then raise exception 'NOT_FOUND: Contact sheet not found.' using errcode = 'P0001'; end if;
  if l.source_stored_at is not null then raise exception 'CONFLICT: The original file is already stored.' using errcode = 'P0001'; end if;
  return jsonb_build_object('id', l.id, 'fileName', l.file_name, 'departmentId', l.department_id, 'contentHash', l.content_hash);
end $$;
create or replace function public.telecaller_list_record_source(p_list uuid, p_bucket text, p_path text, p_provider text, p_ref text, p_etag text, p_size bigint)
returns void language sql security definer set search_path = '' as $$
  update public.telecaller_contact_lists set source_bucket = p_bucket, source_path = p_path, source_provider = p_provider, source_ref = p_ref, source_etag = p_etag, source_size = p_size, source_stored_at = now()
   where id = p_list and source_stored_at is null
$$;

-- Sheets as the caller may see them: a Telecaller their own, a Team Lead those of their team, the Department Head those of the department, the Super Admin all.
create or replace function public.telecaller_lists(p_assignee uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_telecaller() or private.my_role() in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'FORBIDDEN: You cannot open contact sheets.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', l.id, 'fileName', l.file_name, 'note', l.note, 'assignedAt', l.created_at, 'hasSourceFile', l.source_stored_at is not null,
      'assignedBy', (select b.full_name from public.profiles b where b.id = l.assigned_by), 'assignedTo', (select t.full_name from public.profiles t where t.id = l.assigned_to), 'assigneeId', l.assigned_to,
      'total', l.total_contacts,
      'pending', (select count(*) from public.telecaller_contacts c where c.list_id = l.id and c.call_status = 'PENDING'),
      'called', (select count(*) from public.telecaller_contacts c where c.list_id = l.id and c.call_status <> 'PENDING'),
      'followUps', (select count(*) from public.telecaller_contacts c where c.list_id = l.id and c.call_status = 'FOLLOW_UP_REQUIRED')) order by l.created_at desc)
    from public.telecaller_contact_lists l
   where private.telecaller_can_read(l.assigned_to, l.department_id, l.team_id) and (p_assignee is null or l.assigned_to = p_assignee)), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Telecaller: the contacts and the call updates
-- ---------------------------------------------------------------------------
create or replace function public.telecaller_contacts_list(p_list uuid default null, p_search text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
  v_counts jsonb;
begin
  perform private.require_telecaller();
  if p_status is not null and p_status not in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Unknown call status.' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.telecaller_contacts c
   where c.assigned_to = private.my_id() and (p_list is null or c.list_id = p_list) and (p_status is null or c.call_status = p_status)
     and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || c.phone || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.remarks, ''))) > 0);
  select coalesce(jsonb_object_agg(s.call_status, s.n), '{}'::jsonb) into v_counts
    from (select call_status, count(*) n from public.telecaller_contacts c where c.assigned_to = private.my_id() and (p_list is null or c.list_id = p_list) group by call_status) s;
  return jsonb_build_object('total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', v_counts,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'listId', x.list_id, 'name', x.name, 'company', x.company, 'phone', x.phone, 'email', x.email, 'assignedAt', x.assigned_at,
        'callStatus', x.call_status, 'callCount', x.call_count, 'lastCalledAt', x.last_called_at, 'followUpDate', x.follow_up_date, 'remarks', x.remarks,
        'followUpDue', x.follow_up_date is not null and x.follow_up_date <= private.hr_today() and x.call_status not in ('COMPLETED', 'NOT_INTERESTED')) order by x.row_no)
      from (select c.* from public.telecaller_contacts c
             where c.assigned_to = private.my_id() and (p_list is null or c.list_id = p_list) and (p_status is null or c.call_status = p_status)
               and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || c.phone || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.remarks, ''))) > 0)
             order by c.list_id, c.row_no limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb));
end $$;

-- Record a call: the outcome, the remarks and the follow-up date. Only on a contact of the caller's own sheet.
create or replace function public.telecaller_contact_update(p_id uuid, p_status text, p_remarks text, p_follow_up date, p_called boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.telecaller_contacts;
  v_today date := private.hr_today();
begin
  perform private.require_telecaller();
  select * into c from public.telecaller_contacts where id = p_id and assigned_to = private.my_id() for update;
  if c.id is null then raise exception 'NOT_FOUND: Contact not found.' using errcode = 'P0001'; end if;
  if p_status not in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED') then raise exception 'VALIDATION_ERROR: Choose the call status.' using errcode = 'P0001'; end if;
  if p_status = 'FOLLOW_UP_REQUIRED' and p_follow_up is null then raise exception 'VALIDATION_ERROR: Enter the follow-up date.' using errcode = 'P0001'; end if;
  if p_follow_up is not null and (p_follow_up < v_today - 1 or p_follow_up > v_today + 730) then raise exception 'VALIDATION_ERROR: Enter a valid follow-up date.' using errcode = 'P0001'; end if;
  if length(coalesce(p_remarks, '')) > 1000 then raise exception 'VALIDATION_ERROR: The remarks are too long (1,000 characters at most).' using errcode = 'P0001'; end if;
  update public.telecaller_contacts
     set call_status = p_status,
         remarks = nullif(btrim(coalesce(p_remarks, '')), ''),
         follow_up_date = case when p_status in ('COMPLETED', 'NOT_INTERESTED') then null else p_follow_up end,
         call_count = call_count + case when coalesce(p_called, true) and p_status <> 'PENDING' then 1 else 0 end,
         last_called_at = case when coalesce(p_called, true) and p_status <> 'PENDING' then now() else last_called_at end,
         updated_by = private.my_id(), updated_at = now()
   where id = c.id returning * into c;
  return jsonb_build_object('id', c.id, 'callStatus', c.call_status, 'lastCalledAt', c.last_called_at, 'followUpDate', c.follow_up_date, 'remarks', c.remarks, 'callCount', c.call_count);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Telecaller: leads (the Sales leads the Telecaller owns)
-- ---------------------------------------------------------------------------
create or replace function private.telecaller_lead_json(c public.customers)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'email', c.email, 'address', c.address, 'leadSource', c.lead_source,
    'leadTemperature', c.lead_temperature, 'callStatus', c.call_status,
    'followUpDate', (c.next_follow_up_at at time zone 'Asia/Kolkata')::date, 'notes', c.notes, 'createdAt', c.created_at, 'updatedAt', c.updated_at,
    'services', coalesce((select jsonb_agg(s.service_code order by s.service_code) from public.customer_services s where s.customer_id = c.id), '[]'::jsonb),
    'serviceNames', coalesce((select string_agg(cs.name, ', ' order by cs.name) from public.customer_services s join public.crm_services cs on cs.code = s.service_code where s.customer_id = c.id), ''))
$$;
revoke all on function private.telecaller_lead_json(public.customers) from public, anon, authenticated;

create or replace function public.telecaller_leads_list(p_search text default null, p_temperature text default null, p_call_status text default null, p_source text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
begin
  perform private.require_telecaller();
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

create or replace function public.telecaller_lead_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
begin
  perform private.require_telecaller();
  select * into c from public.customers where id = p_id and owner_id = private.my_id() and lifecycle_stage = 'LEAD';
  if c.id is null then raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001'; end if;
  return private.telecaller_lead_json(c);
end $$;

-- Create (p_id null) or update a lead. The lead is the existing Sales lead (customers, stage LEAD), owned by the Telecaller; the temperature and
-- the call status are saved with it, each in its own column.
create or replace function public.telecaller_lead_save(p_id uuid, p_fields jsonb, p_services text[], p_temperature text, p_call_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_id;
  c public.customers;
begin
  perform private.require_telecaller();
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
-- 7. The Home page
-- ---------------------------------------------------------------------------
create or replace function public.telecaller_home()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
  v_me uuid := private.my_id();
begin
  perform private.require_telecaller();
  return jsonb_build_object(
    'today', v_today,
    'totalAssigned', (select count(*) from public.telecaller_contacts c where c.assigned_to = v_me),
    'callsPending', (select count(*) from public.telecaller_contacts c where c.assigned_to = v_me and c.call_status = 'PENDING'),
    'callsCompleted', (select count(*) from public.telecaller_contacts c where c.assigned_to = v_me and c.call_status <> 'PENDING'),
    'totalLeads', (select count(*) from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD'),
    'hotLeads', (select count(*) from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD' and c.lead_temperature = 'HOT'),
    'followUpsDueToday', (select count(*) from public.telecaller_contacts c where c.assigned_to = v_me and c.follow_up_date = v_today and c.call_status not in ('COMPLETED', 'NOT_INTERESTED'))
                       + (select count(*) from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD' and (c.next_follow_up_at at time zone 'Asia/Kolkata')::date = v_today and coalesce(c.call_status, 'PENDING') not in ('COMPLETED', 'NOT_INTERESTED')),
    'followUpsOverdue', (select count(*) from public.telecaller_contacts c where c.assigned_to = v_me and c.follow_up_date < v_today and c.call_status not in ('COMPLETED', 'NOT_INTERESTED'))
                      + (select count(*) from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD' and (c.next_follow_up_at at time zone 'Asia/Kolkata')::date < v_today and coalesce(c.call_status, 'PENDING') not in ('COMPLETED', 'NOT_INTERESTED')),
    -- today's focus: follow-ups due (contacts and leads), then the oldest calls still pending
    'focus', jsonb_build_object(
      'followUps', coalesce((select jsonb_agg(f order by f ->> 'date', f ->> 'name') from (
          select jsonb_build_object('kind', 'CONTACT', 'id', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'date', c.follow_up_date, 'overdue', c.follow_up_date < v_today) f
            from public.telecaller_contacts c where c.assigned_to = v_me and c.follow_up_date <= v_today + 7 and c.call_status not in ('COMPLETED', 'NOT_INTERESTED')
          union all
          select jsonb_build_object('kind', 'LEAD', 'id', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'date', (c.next_follow_up_at at time zone 'Asia/Kolkata')::date, 'overdue', (c.next_follow_up_at at time zone 'Asia/Kolkata')::date < v_today)
            from public.customers c where c.owner_id = v_me and c.lifecycle_stage = 'LEAD' and (c.next_follow_up_at at time zone 'Asia/Kolkata')::date <= v_today + 7 and coalesce(c.call_status, 'PENDING') not in ('COMPLETED', 'NOT_INTERESTED')
          order by 1 limit 8) q), '[]'::jsonb),
      'pendingCalls', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'company', x.company, 'phone', x.phone, 'assignedAt', x.assigned_at) order by x.assigned_at, x.row_no)
                                  from (select * from public.telecaller_contacts c where c.assigned_to = v_me and c.call_status = 'PENDING' order by c.assigned_at, c.row_no limit 6) x), '[]'::jsonb)));
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'telecaller_assignable(uuid)', 'telecaller_list_assign(uuid, text, text, jsonb, text, boolean)', 'telecaller_list_source_begin(uuid)', 'telecaller_lists(uuid)',
    'telecaller_contacts_list(uuid, text, text, integer, integer)', 'telecaller_contact_update(uuid, text, text, date, boolean)',
    'telecaller_leads_list(text, text, text, text, integer, integer)', 'telecaller_lead_get(uuid)', 'telecaller_lead_save(uuid, jsonb, text[], text, text)', 'telecaller_home()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.telecaller_list_record_source(uuid, text, text, text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.telecaller_list_record_source(uuid, text, text, text, text, text, bigint) to service_role;

notify pgrst, 'reload schema';
