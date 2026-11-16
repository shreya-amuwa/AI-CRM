-- =============================================================================
-- Upload Leads: every Sales employee (Team Member with or without a Sales role, Team Lead, Sales Department Head) adds many leads at once from
-- an Excel / CSV file, from the Lead section of their own dashboard.
--
-- No second lead system: every new lead is made by the existing public.create_lead (the Add Lead function), so the ownership trigger
-- (private.tg_customers_before_write -> can_assign_customer_owner), the lead routing, audit and notification triggers all apply as for one lead.
--
--  * lead_upload_batches: one row per uploaded file (who, when, file, counts) = the upload history. customers.lead_upload_batch_id = Upload Batch ID.
--  * lead_upload_rows: the outcome of every row (CREATED / DUPLICATE / INVALID / FAILED) with the reason; the rows that were not created keep
--    the values that were sent, so they can be downloaded, fixed and uploaded again (the error log).
--  * Ownership: a lead belongs to the person who uploads it. An "Assigned Employee" column may name someone else only where the existing rule
--    already allows it (can_assign_customer_owner: a Team Member only themselves, a Team Lead their own members, a Department Head their department).
--  * Duplicates: the existing rule (private.find_duplicate_customer: same e-mail, or the same last 10 digits of the phone, in the lead's department)
--    plus the same phone / e-mail twice in one file. A duplicate is never created and never overwrites the existing record.
--  * Large files: the browser sends the file in chunks; each chunk is one transaction, and inside it each row is its own sub-transaction, so a row
--    that fails leaves no half-made lead and does not stop the others. A retried chunk does not create anything twice (one outcome per row).
--
-- Additive and safe to run twice: new tables, one nullable column, one trigger, new functions. Nothing is deleted or changed in existing data.
-- Run after 20270102000100_customers_rls_set_based.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.lead_upload_batches (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  client_request_id uuid not null,
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  file_type text not null check (file_type in ('XLSX', 'CSV')),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{16,128}$'),
  total_rows integer not null check (total_rows between 1 and 5000),
  status text not null default 'PROCESSING' check (status in ('PROCESSING', 'COMPLETED', 'INTERRUPTED')),
  created_count integer not null default 0,
  duplicate_count integer not null default 0,
  invalid_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create unique index if not exists lead_upload_batches_request_key on public.lead_upload_batches (uploaded_by, client_request_id);
create index if not exists lead_upload_batches_uploader_idx on public.lead_upload_batches (uploaded_by, created_at desc);
create index if not exists lead_upload_batches_hash_idx on public.lead_upload_batches (uploaded_by, content_hash);
alter table public.lead_upload_batches enable row level security;
revoke all on public.lead_upload_batches from public, anon, authenticated;

create table if not exists public.lead_upload_rows (
  batch_id uuid not null references public.lead_upload_batches (id) on delete cascade,
  row_number integer not null check (row_number between 1 and 1000000),
  outcome text not null check (outcome in ('CREATED', 'DUPLICATE', 'INVALID', 'FAILED')),
  message text check (length(message) <= 500),
  customer_id uuid references public.customers (id) on delete set null,
  data jsonb,
  created_at timestamptz not null default now(),
  primary key (batch_id, row_number)
);
alter table public.lead_upload_rows enable row level security;
revoke all on public.lead_upload_rows from public, anon, authenticated;

-- The Upload Batch ID of a lead. Set only by the upload (the trigger below); the browser has no column grant for it.
alter table public.customers add column if not exists lead_upload_batch_id uuid references public.lead_upload_batches (id) on delete set null;
create index if not exists customers_lead_upload_batch_idx on public.customers (lead_upload_batch_id) where lead_upload_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Who may upload: an active Sales employee (any Sales role, any level)
-- ---------------------------------------------------------------------------
create or replace function private.can_upload_leads()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
      left join public.teams t on t.id = p.team_id
      left join public.departments d on d.id = p.department_id
     where p.id = private.my_id() and p.status = 'ACTIVE' and coalesce(d.slug, '') not in ('hr', 'accounts')
       and ((p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and t.division = 'SALES')
            or (p.role = 'DEPARTMENT_HEAD' and private.is_sales_head())))
$$;
revoke all on function private.can_upload_leads() from public, anon;
grant execute on function private.can_upload_leads() to authenticated, service_role;

create or replace function private.require_lead_uploader()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_upload_leads() then
    raise exception 'FORBIDDEN: Uploading leads is for Sales employees.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_lead_uploader() from public, anon;
grant execute on function private.require_lead_uploader() to authenticated, service_role;

-- The department a lead of this owner lands in (the owner's own, or for a Department Head the department of the team their leads sit in).
create or replace function private.lead_department_of(p_owner uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when p.team_id is null then (select t.department_id from public.teams t where t.id = private.lead_team_of(p.id)) else p.department_id end
    from public.profiles p where p.id = p_owner
$$;
revoke all on function private.lead_department_of(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Upload Batch ID goes on the lead while (and only while) an upload of the caller is running in this transaction
-- ---------------------------------------------------------------------------
create or replace function private.tg_customers_lead_upload_batch()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v text := nullif(current_setting('crm.lead_upload_batch', true), '');
begin
  new.lead_upload_batch_id := null;
  if v is not null and exists (select 1 from public.lead_upload_batches b where b.id = v::uuid and b.uploaded_by = auth.uid() and b.status = 'PROCESSING') then
    new.lead_upload_batch_id := v::uuid;
    -- like a lead from a sheet: not called yet (the Telecaller's call list reads this)
    new.call_status := coalesce(new.call_status, 'PENDING');
  end if;
  return new;
end $$;
revoke all on function private.tg_customers_lead_upload_batch() from public, anon, authenticated;
drop trigger if exists customers_lead_upload_batch on public.customers;
create trigger customers_lead_upload_batch before insert on public.customers for each row execute function private.tg_customers_lead_upload_batch();

-- ---------------------------------------------------------------------------
-- 4. Checking the rows (used by the preview and by the import; saves nothing)
--
-- p_rows: [{ row, name, company, phone, email, city, businessCategory, leadSource, nextFollowUpAt, notes, services: [text], assignee, problem }]
-- (the API has already checked each row with the Add Lead rules; "problem" is what it found). Returns one entry per row:
-- { row, outcome: NEW | DUPLICATE | INVALID, message, ownerId, ownerName, services: [codes], fields }
-- ---------------------------------------------------------------------------
create or replace function private.lead_upload_evaluate(p_rows jsonb, p_batch uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_my_dept uuid;
  r jsonb;
  v_out jsonb := '[]'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_services jsonb;
  v_codes text[];
  v_bad text;
  s text;
  v_code text;
  v_assignee text;
  v_owner public.profiles;
  v_owner_cache jsonb := '{}'::jsonb;
  v_problem text;
  v_phone text;
  v_email text;
  v_dept uuid;
  v_name text;
  v_known_phone jsonb;
  v_known_email jsonb;
  v_seen_phone text[] := '{}';
  v_seen_email text[] := '{}';
  v_dup uuid;
  v_dup_row public.customers;
  e jsonb;
begin
  select * into v_me from public.profiles where id = private.my_id();
  v_my_dept := private.my_department_id();
  -- the service catalogue once: name or code (any case) -> code
  select coalesce(jsonb_object_agg(k, code), '{}'::jsonb) into v_services
    from (select lower(code) k, code from public.crm_services where is_active
          union select lower(btrim(name)), code from public.crm_services where is_active) x;

  -- pass 1: each row on its own (required values, services, owner)
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_problem := nullif(btrim(coalesce(r ->> 'problem', '')), '');
    v_codes := '{}';
    v_owner := null;
    v_dept := null;
    v_phone := right(regexp_replace(coalesce(r ->> 'phone', ''), '\D', '', 'g'), 10);
    v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
    if v_problem is null then
      if length(btrim(coalesce(r ->> 'name', ''))) = 0 then v_problem := 'Customer name is required.';
      elsif length(btrim(coalesce(r ->> 'company', ''))) = 0 then v_problem := 'Business name is required.';
      elsif v_phone !~ '^[6-9][0-9]{9}$' then v_problem := 'Enter a 10-digit mobile number (with or without +91).';
      elsif v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254) then v_problem := 'Enter a valid e-mail address.';
      end if;
    end if;
    if v_problem is null then
      v_bad := null;
      for s in select btrim(x) from jsonb_array_elements_text(coalesce(r -> 'services', '[]'::jsonb)) x where btrim(x) <> '' loop
        v_code := v_services ->> lower(s);
        if v_code is null then v_bad := s; exit; end if;
        if not v_code = any (v_codes) then v_codes := v_codes || v_code; end if;
      end loop;
      if v_bad is not null then v_problem := format('Unknown service "%s". Use a service name from the Add Lead form.', left(v_bad, 80));
      elsif coalesce(array_length(v_codes, 1), 0) = 0 then v_problem := 'Select at least one service.';
      end if;
    end if;
    if v_problem is null then
      v_assignee := lower(nullif(btrim(coalesce(r ->> 'assignee', '')), ''));
      if v_assignee is null or v_assignee = lower(coalesce(v_me.email, '')) then
        v_owner := v_me;
      elsif v_owner_cache ? v_assignee then
        if v_owner_cache ->> v_assignee like 'ERR:%' then v_problem := substr(v_owner_cache ->> v_assignee, 5);
        else select * into v_owner from public.profiles where id = (v_owner_cache ->> v_assignee)::uuid; end if;
      else
        -- an employee of the caller's own department, by e-mail or by full name (a name shared by two people must be given as an e-mail)
        select * into v_owner from public.profiles p
         where p.status = 'ACTIVE' and p.department_id = v_my_dept and (lower(p.email) = v_assignee or lower(btrim(p.full_name)) = v_assignee)
         order by (lower(p.email) = v_assignee) desc limit 1;
        if v_owner.id is null then
          v_problem := 'Assigned Employee: no active employee of your department has this name or e-mail.';
        elsif lower(v_owner.email) <> v_assignee
              and (select count(*) from public.profiles p where p.status = 'ACTIVE' and p.department_id = v_my_dept and lower(btrim(p.full_name)) = v_assignee) > 1 then
          v_problem := 'Assigned Employee: more than one employee has this name. Use their e-mail address.';
        elsif not private.can_assign_customer_owner(v_owner.id)
              or not exists (select 1 from public.teams t where t.id = coalesce(v_owner.team_id, private.lead_team_of(v_owner.id)) and t.division = 'SALES') then
          v_problem := 'Assigned Employee: you cannot assign leads to this employee. Leave it empty to keep the lead yourself.';
        end if;
        v_owner_cache := v_owner_cache || jsonb_build_object(v_assignee, case when v_problem is null then v_owner.id::text else 'ERR:' || v_problem end);
        if v_problem is not null then v_owner := null; end if;
      end if;
    end if;
    if v_problem is null and v_owner.id is not null then
      v_dept := private.lead_department_of(v_owner.id);
      if v_dept is null then v_problem := 'The lead owner does not belong to a Sales team.'; end if;
    end if;
    v_pending := v_pending || jsonb_build_object('row', (r ->> 'row')::int, 'problem', v_problem, 'ownerId', v_owner.id, 'ownerName', v_owner.full_name,
      'dept', v_dept, 'phone', v_phone, 'email', v_email, 'services', to_jsonb(v_codes),
      'fields', jsonb_build_object('name', btrim(coalesce(r ->> 'name', '')), 'company', btrim(coalesce(r ->> 'company', '')),
        'phone', nullif(btrim(coalesce(r ->> 'phone', '')), ''), 'email', v_email,
        'city', nullif(btrim(coalesce(r ->> 'city', '')), ''), 'businessCategory', nullif(btrim(coalesce(r ->> 'businessCategory', '')), ''),
        'leadSource', coalesce(nullif(btrim(coalesce(r ->> 'leadSource', '')), ''), 'Other'), 'nextFollowUpAt', nullif(r ->> 'nextFollowUpAt', ''),
        'notes', nullif(btrim(coalesce(r ->> 'notes', '')), '')));
  end loop;

  -- what the CRM already has, in one query per kind (not one per row): the existing duplicate rule, same department
  select coalesce(jsonb_object_agg(c.department_id::text || ':' || right(regexp_replace(c.phone, '\D', '', 'g'), 10), c.id), '{}'::jsonb) into v_known_phone
    from public.customers c
   where c.department_id in (select (x ->> 'dept')::uuid from jsonb_array_elements(v_pending) x where x ->> 'dept' is not null)
     and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) in (select x ->> 'phone' from jsonb_array_elements(v_pending) x where x ->> 'problem' is null);
  select coalesce(jsonb_object_agg(c.department_id::text || ':' || c.email, c.id), '{}'::jsonb) into v_known_email
    from public.customers c
   where c.department_id in (select (x ->> 'dept')::uuid from jsonb_array_elements(v_pending) x where x ->> 'dept' is not null)
     and c.email in (select x ->> 'email' from jsonb_array_elements(v_pending) x where x ->> 'problem' is null and x ->> 'email' is not null);

  -- pass 2: duplicates (in the file, then in the CRM)
  for e in select * from jsonb_array_elements(v_pending) loop
    if e ->> 'problem' is not null then
      v_out := v_out || jsonb_build_object('row', e -> 'row', 'outcome', 'INVALID', 'message', e ->> 'problem');
      continue;
    end if;
    if (e ->> 'phone') = any (v_seen_phone) or (e ->> 'email' is not null and (e ->> 'email') = any (v_seen_email)) then
      v_out := v_out || jsonb_build_object('row', e -> 'row', 'outcome', 'DUPLICATE', 'message', 'This mobile number or e-mail appears earlier in this file.');
      continue;
    end if;
    v_seen_phone := v_seen_phone || (e ->> 'phone');
    if e ->> 'email' is not null then v_seen_email := v_seen_email || (e ->> 'email'); end if;
    v_dup := coalesce((v_known_phone ->> ((e ->> 'dept') || ':' || (e ->> 'phone')))::uuid, (v_known_email ->> ((e ->> 'dept') || ':' || coalesce(e ->> 'email', '')))::uuid);
    if v_dup is not null then
      select * into v_dup_row from public.customers where id = v_dup;
      v_out := v_out || jsonb_build_object('row', e -> 'row', 'outcome', 'DUPLICATE', 'duplicateOf', case when private.can_view_customer(v_dup) then v_dup end,
        'message', case
          when p_batch is not null and v_dup_row.lead_upload_batch_id = p_batch then 'This mobile number or e-mail appears earlier in this file.'
          when private.can_view_customer(v_dup) then format('Already in the CRM: %s (%s). The existing record was not changed.', v_dup_row.name,
            case v_dup_row.lifecycle_stage when 'LEAD' then 'lead' when 'POTENTIAL' then 'potential customer' when 'ONBOARDING' then 'in onboarding' when 'LOST' then 'closed lead' else 'customer' end)
          else 'A customer or lead with this mobile number or e-mail already exists in the CRM. The existing record was not changed.' end);
      continue;
    end if;
    v_out := v_out || jsonb_build_object('row', e -> 'row', 'outcome', 'NEW', 'ownerId', e -> 'ownerId', 'ownerName', e -> 'ownerName',
      'services', e -> 'services', 'fields', e -> 'fields');
  end loop;
  return v_out;
end $$;
revoke all on function private.lead_upload_evaluate(jsonb, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Public functions (each checks the caller)
-- ---------------------------------------------------------------------------
-- Preview: what would happen to each row. Saves nothing.
create or replace function public.lead_upload_check(p_rows jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_lead_uploader();
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'VALIDATION_ERROR: The file has no lead rows.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'VALIDATION_ERROR: A file can have at most 5,000 leads. Split it into smaller files.' using errcode = 'P0001';
  end if;
  v := private.lead_upload_evaluate(p_rows, null);
  return jsonb_build_object(
    'rows', (select coalesce(jsonb_agg(x - 'fields' - 'services'), '[]'::jsonb) from jsonb_array_elements(v) x),
    'summary', jsonb_build_object('total', jsonb_array_length(v),
      'new', (select count(*) from jsonb_array_elements(v) x where x ->> 'outcome' = 'NEW'),
      'duplicates', (select count(*) from jsonb_array_elements(v) x where x ->> 'outcome' = 'DUPLICATE'),
      'invalid', (select count(*) from jsonb_array_elements(v) x where x ->> 'outcome' = 'INVALID')));
end $$;
revoke all on function public.lead_upload_check(jsonb) from public, anon;
grant execute on function public.lead_upload_check(jsonb) to authenticated;

create or replace function private.lead_upload_batch_json(b public.lead_upload_batches)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', b.id, 'fileName', b.file_name, 'fileType', b.file_type, 'status', b.status, 'totalRows', b.total_rows,
    'processedRows', (select count(*) from public.lead_upload_rows r where r.batch_id = b.id),
    'created', b.created_count, 'duplicates', b.duplicate_count, 'invalid', b.invalid_count, 'failed', b.failed_count,
    'createdAt', b.created_at, 'completedAt', b.completed_at)
$$;
revoke all on function private.lead_upload_batch_json(public.lead_upload_batches) from public, anon, authenticated;

-- Start an upload. The same request id returns the same batch (a double click or a retry starts nothing twice).
create or replace function public.lead_upload_start(p_request uuid, p_file_name text, p_file_type text, p_hash text, p_total integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.lead_upload_batches;
  v_prev public.lead_upload_batches;
  v_me public.profiles;
  v_team uuid;
begin
  perform private.require_lead_uploader();
  if p_request is null then raise exception 'VALIDATION_ERROR: The upload could not be identified. Reload the page and try again.' using errcode = 'P0001'; end if;
  select * into b from public.lead_upload_batches where uploaded_by = private.my_id() and client_request_id = p_request;
  if b.id is not null then return private.lead_upload_batch_json(b); end if;
  if length(btrim(coalesce(p_file_name, ''))) not between 1 and 200 then raise exception 'VALIDATION_ERROR: The file name is missing or too long.' using errcode = 'P0001'; end if;
  if p_file_type is null or p_file_type not in ('XLSX', 'CSV') then raise exception 'VALIDATION_ERROR: Upload an Excel (.xlsx) or CSV (.csv) file.' using errcode = 'P0001'; end if;
  if coalesce(p_hash, '') !~ '^[0-9a-f]{16,128}$' then raise exception 'VALIDATION_ERROR: The file could not be identified.' using errcode = 'P0001'; end if;
  if p_total is null or p_total not between 1 and 5000 then raise exception 'VALIDATION_ERROR: A file can have 1 to 5,000 leads.' using errcode = 'P0001'; end if;

  perform pg_advisory_xact_lock(hashtext('lead_upload_start:' || private.my_id()::text));
  -- the same file once: a file whose leads were already created is not imported again (fix it and it is a new file)
  select * into v_prev from public.lead_upload_batches
   where uploaded_by = private.my_id() and content_hash = p_hash and status = 'COMPLETED' and created_count > 0
   order by created_at desc limit 1;
  if v_prev.id is not null then
    raise exception 'CONFLICT: You already uploaded this file on %. Its leads are in your Leads list.', to_char(v_prev.created_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')
      using errcode = 'P0001';
  end if;
  -- an earlier upload of this file that never finished (closed tab, lost network) is closed; the leads it made stay and count as duplicates now
  update public.lead_upload_batches b2 set status = 'INTERRUPTED', completed_at = now(),
         created_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b2.id and r.outcome = 'CREATED'),
         duplicate_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b2.id and r.outcome = 'DUPLICATE'),
         invalid_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b2.id and r.outcome = 'INVALID'),
         failed_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b2.id and r.outcome = 'FAILED')
   where b2.uploaded_by = private.my_id() and b2.content_hash = p_hash and b2.status = 'PROCESSING';

  select * into v_me from public.profiles where id = private.my_id();
  v_team := coalesce(v_me.team_id, private.lead_team_of(v_me.id));
  insert into public.lead_upload_batches (uploaded_by, department_id, team_id, client_request_id, file_name, file_type, content_hash, total_rows)
  values (v_me.id, private.lead_department_of(v_me.id), v_team, p_request, btrim(p_file_name), p_file_type, p_hash, p_total)
  returning * into b;
  return private.lead_upload_batch_json(b);
end $$;
revoke all on function public.lead_upload_start(uuid, text, text, text, integer) from public, anon;
grant execute on function public.lead_upload_start(uuid, text, text, text, integer) to authenticated;

-- Import one chunk of rows (at most 200). Rows already done in this batch are skipped, so a retried chunk creates nothing twice.
create or replace function public.lead_upload_rows(p_batch uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.lead_upload_batches;
  v_eval jsonb;
  e jsonb;
  v_raw jsonb;
  v_id uuid;
  v_msg text;
  v_results jsonb := '[]'::jsonb;
  v_todo jsonb;
begin
  perform private.require_lead_uploader();
  select * into b from public.lead_upload_batches where id = p_batch and uploaded_by = private.my_id() for update;
  if b.id is null then raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001'; end if;
  if b.status <> 'PROCESSING' then raise exception 'CONFLICT: This upload is already finished. Start a new upload.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'VALIDATION_ERROR: No rows were sent.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 200 then raise exception 'VALIDATION_ERROR: Send at most 200 rows at a time.' using errcode = 'P0001'; end if;

  -- one import at a time per department, so two uploads (or an upload and itself) cannot both add the same person
  perform pg_advisory_xact_lock(hashtext('lead_upload_dept:' || coalesce(b.department_id::text, '')));

  -- the rows of this chunk not yet done (a retry sends rows that are already recorded)
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_todo from jsonb_array_elements(p_rows) x
   where not exists (select 1 from public.lead_upload_rows r where r.batch_id = b.id and r.row_number = (x ->> 'row')::int);
  if (select count(*) from public.lead_upload_rows r where r.batch_id = b.id) + jsonb_array_length(v_todo) > b.total_rows then
    raise exception 'VALIDATION_ERROR: More rows were sent than the file has.' using errcode = 'P0001';
  end if;
  v_eval := private.lead_upload_evaluate(v_todo, b.id);

  perform set_config('crm.lead_upload_batch', b.id::text, true);
  for e in select * from jsonb_array_elements(v_eval) loop
    select x -> 'raw' into v_raw from jsonb_array_elements(v_todo) x where (x ->> 'row')::int = (e ->> 'row')::int limit 1;
    if e ->> 'outcome' = 'NEW' then
      begin
        -- the Add Lead function itself: the owner trigger re-checks that the caller may give the lead to this owner
        v_id := public.create_lead((e -> 'fields') || jsonb_build_object('ownerId', e ->> 'ownerId', 'leadStatus', 'NEW'),
                                   array(select jsonb_array_elements_text(e -> 'services')));
        insert into public.customer_activities (customer_id, type, note) values (v_id, 'LEAD_UPLOADED', left('Uploaded from the file ' || b.file_name, 5000));
        insert into public.lead_upload_rows (batch_id, row_number, outcome, customer_id) values (b.id, (e ->> 'row')::int, 'CREATED', v_id);
        v_results := v_results || jsonb_build_object('row', e -> 'row', 'outcome', 'CREATED', 'leadId', v_id);
      exception when others then
        -- the row's lead (and anything it started) is rolled back; the reason is kept, without database details
        v_msg := case when sqlstate in ('P0001', '42501') then regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '')
                      when sqlstate = '23505' then 'A customer or lead with this mobile number or e-mail already exists in the CRM.'
                      else 'This row could not be saved. Check its values and upload it again.' end;
        insert into public.lead_upload_rows (batch_id, row_number, outcome, message, data) values (b.id, (e ->> 'row')::int, 'FAILED', left(v_msg, 500), v_raw);
        v_results := v_results || jsonb_build_object('row', e -> 'row', 'outcome', 'FAILED', 'message', left(v_msg, 500));
      end;
    else
      insert into public.lead_upload_rows (batch_id, row_number, outcome, message, data) values (b.id, (e ->> 'row')::int, e ->> 'outcome', left(e ->> 'message', 500), v_raw);
      v_results := v_results || jsonb_build_object('row', e -> 'row', 'outcome', e ->> 'outcome', 'message', left(e ->> 'message', 500));
    end if;
  end loop;
  perform set_config('crm.lead_upload_batch', '', true);

  update public.lead_upload_batches set
    created_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b.id and r.outcome = 'CREATED'),
    duplicate_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b.id and r.outcome = 'DUPLICATE'),
    invalid_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b.id and r.outcome = 'INVALID'),
    failed_count = (select count(*) from public.lead_upload_rows r where r.batch_id = b.id and r.outcome = 'FAILED')
  where id = b.id returning * into b;
  return jsonb_build_object('batch', private.lead_upload_batch_json(b), 'results', v_results);
end $$;
revoke all on function public.lead_upload_rows(uuid, jsonb) from public, anon;
grant execute on function public.lead_upload_rows(uuid, jsonb) to authenticated;

-- Finish an upload: the summary. Finishing twice returns the same summary.
create or replace function public.lead_upload_finish(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.lead_upload_batches;
  v_done integer;
  v_rec record;
begin
  perform private.require_lead_uploader();
  select * into b from public.lead_upload_batches where id = p_batch and uploaded_by = private.my_id() for update;
  if b.id is null then raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001'; end if;
  if b.status = 'PROCESSING' then
    select count(*) into v_done from public.lead_upload_rows r where r.batch_id = b.id;
    if v_done < b.total_rows then
      raise exception 'CONFLICT: % of % rows have been processed. Send the remaining rows before finishing.', v_done, b.total_rows using errcode = 'P0001';
    end if;
    update public.lead_upload_batches set status = 'COMPLETED', completed_at = now() where id = b.id returning * into b;
    -- one notification per person instead of one per lead (the insert trigger skips its per-lead "New customer" note during an upload):
    -- each owner the uploader gave leads to, and the Team Leads of the teams the leads went to
    for v_rec in
      select c.owner_id, count(*) n from public.lead_upload_rows r join public.customers c on c.id = r.customer_id
       where r.batch_id = b.id and r.outcome = 'CREATED' and c.owner_id <> private.my_id() group by c.owner_id
    loop
      perform private.notify(v_rec.owner_id, 'LEADS_UPLOADED', format('New leads: %s', b.file_name),
        format('%s lead%s from an uploaded file were assigned to you.', v_rec.n, case when v_rec.n = 1 then '' else 's' end), 'lead_upload_batch', b.id);
    end loop;
    for v_rec in
      select p.id owner_id, count(*) n from public.lead_upload_rows r join public.customers c on c.id = r.customer_id
        join public.profiles p on p.team_id = c.team_id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
       where r.batch_id = b.id and r.outcome = 'CREATED' group by p.id
    loop
      perform private.notify(v_rec.owner_id, 'LEADS_UPLOADED', format('New leads uploaded: %s', b.file_name),
        format('%s added %s lead%s from an uploaded file.', (select full_name from public.profiles where id = private.my_id()), v_rec.n,
               case when v_rec.n = 1 then '' else 's' end), 'lead_upload_batch', b.id);
    end loop;
    perform private.write_audit('LEAD_UPLOAD_COMPLETED', 'lead_upload_batch', b.id, b.department_id, b.team_id,
      jsonb_build_object('fileName', b.file_name, 'total', b.total_rows, 'created', b.created_count, 'duplicates', b.duplicate_count,
                         'invalid', b.invalid_count, 'failed', b.failed_count));
  end if;
  return private.lead_upload_batch_json(b);
end $$;
revoke all on function public.lead_upload_finish(uuid) from public, anon;
grant execute on function public.lead_upload_finish(uuid) to authenticated;

-- The caller's own upload history, newest first.
create or replace function public.lead_upload_history(p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_lead_uploader();
  return coalesce((select jsonb_agg(private.lead_upload_batch_json(b) order by b.created_at desc)
    from (select * from public.lead_upload_batches where uploaded_by = private.my_id() order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) b), '[]'::jsonb);
end $$;
revoke all on function public.lead_upload_history(integer) from public, anon;
grant execute on function public.lead_upload_history(integer) to authenticated;

-- The rows of one of the caller's uploads that were not created (duplicate, invalid, failed), with the reason and the values sent.
create or replace function public.lead_upload_issues(p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  b public.lead_upload_batches;
begin
  perform private.require_lead_uploader();
  select * into b from public.lead_upload_batches where id = p_batch and uploaded_by = private.my_id();
  if b.id is null then raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001'; end if;
  return jsonb_build_object('batch', private.lead_upload_batch_json(b),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('row', r.row_number, 'outcome', r.outcome, 'message', r.message, 'data', coalesce(r.data, '{}'::jsonb)) order by r.row_number)
                        from public.lead_upload_rows r where r.batch_id = b.id and r.outcome <> 'CREATED'), '[]'::jsonb));
end $$;
revoke all on function public.lead_upload_issues(uuid) from public, anon;
grant execute on function public.lead_upload_issues(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. During an upload the per-lead "New customer" notification to the Team Lead is skipped (lead_upload_finish sends one summary instead).
--    Everything else of this trigger is unchanged (latest definition: 20261006000300_domain_triggers.sql).
-- ---------------------------------------------------------------------------
create or replace function private.tg_customers_after_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
  v_changes jsonb;
begin
  if tg_op = 'INSERT' then
    perform private.write_audit('CUSTOMER_CREATED', 'customer', new.id, new.department_id, new.team_id,
      jsonb_build_object('name', new.name, 'owner_id', new.owner_id));
    if new.lead_upload_batch_id is null then
      for v_recipient in
        select p.id from public.profiles p
        where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id = new.team_id
      loop
        perform private.notify(v_recipient, 'CUSTOMER_CREATED', format('New customer: %s', new.name),
          coalesce(new.company, ''), 'customer', new.id, jsonb_build_object('owner_id', new.owner_id));
      end loop;
    end if;
    return null;
  end if;

  if tg_op = 'DELETE' then
    perform private.write_audit('CUSTOMER_DELETED', 'customer', old.id, old.department_id, old.team_id,
      jsonb_build_object('snapshot', to_jsonb(old) - 'search_text'));
    return null;
  end if;

  -- UPDATE: record only changed columns
  select coalesce(jsonb_object_agg(n.key, jsonb_build_object('from', o.value, 'to', n.value)), '{}'::jsonb)
    into v_changes
  from jsonb_each(to_jsonb(new) - array['updated_at', 'updated_by', 'search_text']) n
  join jsonb_each(to_jsonb(old)) o using (key)
  where n.value is distinct from o.value;

  if v_changes = '{}'::jsonb then
    return null;
  end if;

  if new.owner_id is distinct from old.owner_id then
    perform private.write_audit('CUSTOMER_REASSIGNED', 'customer', new.id, new.department_id, new.team_id,
      jsonb_build_object('changes', v_changes));
    perform private.notify(new.owner_id, 'CUSTOMER_ASSIGNED', format('Customer assigned to you: %s', new.name),
      '', 'customer', new.id);
  else
    perform private.write_audit('CUSTOMER_UPDATED', 'customer', new.id, new.department_id, new.team_id,
      jsonb_build_object('changes', v_changes));
    perform private.notify(new.owner_id, 'CUSTOMER_UPDATED', format('Customer updated: %s', new.name),
      '', 'customer', new.id);
  end if;
  return null;
end $$;
