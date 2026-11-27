-- Support Recharges: Panel Recharge and Message Recharge records with a payment screenshot, for the Support dashboards.
--
-- Two kinds ('PANEL', 'MESSAGE') live in ONE table with a kind column; every list, summary and filter is per kind, so the two never mix.
-- WHO: only Support staff. A Support Team Member sees the recharges they recorded, a Support Team Lead those of their team, a Support
-- Department Head those of the department (the active Support function), the Super Admin all. Nobody else (Sales, HR, Accounts, other
-- departments, clients, anonymous callers) can read, write or open a screenshot.
-- STATUS (Pending, Verified, Completed, Rejected): only the Team Lead (own team), the Department Head (department) and the Super Admin may change it,
-- never on a record they recorded themselves (the Super Admin excepted). The recorder edits while it is Pending or Rejected (editing a Rejected one
-- sends it back to Pending); a manager edits until it is Completed.
-- SCREENSHOT: the payment proof is a file in a PRIVATE bucket; there is no public address. The API issues a short-lived signed upload and a
-- short-lived signed view link only after these functions allowed it (same pipeline as ticket attachments). Images (PNG, JPEG, WebP) and PDF,
-- at most 5 MB.
-- The tables have no grants: only the SECURITY DEFINER functions below read or write them (RLS on, no policies).
--
-- Nothing is deleted or rewritten. Safe to run again. Run after 20270228000100_wallet_pin_four_digits.sql (independent of it) in the SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.support_recharge_files (
  id uuid primary key default gen_random_uuid(),
  recharge_id uuid,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  status text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  storage_bucket text not null default 'support-recharge-files',
  storage_path text not null,
  storage_provider text check (storage_provider in ('SUPABASE', 'R2')),
  storage_ref text,
  storage_etag text,
  created_at timestamptz not null default now()
);
create index if not exists support_recharge_files_pending_idx on public.support_recharge_files (uploader_id, created_at) where status = 'PENDING';
create index if not exists support_recharge_files_recharge_idx on public.support_recharge_files (recharge_id) where recharge_id is not null;
alter table public.support_recharge_files enable row level security;
revoke all on public.support_recharge_files from public, anon, authenticated;

create table if not exists public.support_recharges (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity,
  kind text not null check (kind in ('PANEL', 'MESSAGE')),
  department_id uuid not null references public.departments (id),
  team_id uuid references public.teams (id) on delete set null,
  created_by uuid not null references public.profiles (id),
  client_request_id uuid,
  customer_name text not null check (length(customer_name) between 2 and 150),
  recharge_date date not null,
  gst_amount numeric(12, 2) not null default 0 check (gst_amount >= 0 and gst_amount <= 100000000),
  gst_details text check (gst_details is null or length(gst_details) <= 500),
  non_gst_amount numeric(12, 2) not null default 0 check (non_gst_amount >= 0 and non_gst_amount <= 100000000),
  non_gst_details text check (non_gst_details is null or length(non_gst_details) <= 500),
  total_amount numeric(12, 2) not null check (total_amount > 0 and total_amount <= 200000000),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED')),
  remarks text check (remarks is null or length(remarks) <= 1000),
  screenshot_id uuid references public.support_recharge_files (id),
  status_note text check (status_note is null or length(status_note) <= 500),
  status_by uuid references public.profiles (id),
  status_at timestamptz,
  updated_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- the total is always the two parts added together (the database does not trust a total typed in a browser)
  constraint support_recharges_total_ck check (total_amount = gst_amount + non_gst_amount)
);
create unique index if not exists support_recharges_request_uq on public.support_recharges (created_by, client_request_id) where client_request_id is not null;
create index if not exists support_recharges_kind_idx on public.support_recharges (kind, recharge_date desc, created_at desc);
create index if not exists support_recharges_department_idx on public.support_recharges (department_id, kind, status);
create index if not exists support_recharges_team_idx on public.support_recharges (team_id) where team_id is not null;
create index if not exists support_recharges_creator_idx on public.support_recharges (created_by, kind);
alter table public.support_recharges enable row level security;
revoke all on public.support_recharges from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_recharge_files_recharge_fk') then
    alter table public.support_recharge_files add constraint support_recharge_files_recharge_fk foreign key (recharge_id) references public.support_recharges (id);
  end if;
end $$;

-- Private bucket (no browser access: the API signs short-lived links after the database allowed it).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('support-recharge-files', 'support-recharge-files', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Who is who (decided here, from the signed-in person; nothing comes from a request)
-- ---------------------------------------------------------------------------
-- 'SUPER_ADMIN' | 'HEAD' (Support Department Head, active function) | 'LEAD' | 'MEMBER' | null (no access)
create or replace function private.recharge_role()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    return null;
  end if;
  if me.role = 'SUPER_ADMIN' then
    return 'SUPER_ADMIN';
  end if;
  if me.role = 'DEPARTMENT_HEAD' then
    -- the head of a department that has Support teams, working its Support side (or the whole department, as the other Support head pages do)
    return case when coalesce(private.active_head_division(), 'SUPPORT') = 'SUPPORT'
                 and exists (select 1 from public.teams t where t.department_id = private.my_department_id() and t.division::text = 'SUPPORT')
                then 'HEAD' end;
  end if;
  if me.role = 'TEAM_HEAD' and private.is_support_staff() then
    return 'LEAD';
  end if;
  if me.role = 'TEAM_MEMBER' and private.is_support_staff() then
    return 'MEMBER';
  end if;
  return null;
end $$;

-- may the caller read this recharge (and open its screenshot)?
create or replace function private.recharge_visible(r public.support_recharges)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
begin
  if v_role is null then
    return false;
  end if;
  if v_role = 'SUPER_ADMIN' then
    return true;
  end if;
  if v_role = 'HEAD' then
    return r.department_id = private.my_department_id();
  end if;
  if v_role = 'LEAD' then
    return r.created_by = auth.uid() or (r.team_id is not null and r.team_id = private.my_team_id());
  end if;
  return r.created_by = auth.uid();
end $$;

-- may the caller change the details of this recharge now?
create or replace function private.recharge_can_edit(r public.support_recharges)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
begin
  if v_role is null or not private.recharge_visible(r) then
    return false;
  end if;
  if v_role = 'SUPER_ADMIN' then
    return true;
  end if;
  if r.created_by = auth.uid() then
    return r.status in ('PENDING', 'REJECTED');
  end if;
  -- a Team Lead or Department Head works the records of their scope until the recharge is completed
  return v_role in ('LEAD', 'HEAD') and r.status <> 'COMPLETED';
end $$;

-- the statuses the caller may move this recharge to (empty: none)
create or replace function private.recharge_next_statuses(r public.support_recharges)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
  v_all text[] := array['PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED'];
begin
  if v_role is null or v_role = 'MEMBER' or not private.recharge_visible(r) then
    return '{}'::text[];
  end if;
  if v_role = 'SUPER_ADMIN' then
    return array_remove(v_all, r.status);
  end if;
  -- nobody approves their own record
  if r.created_by = auth.uid() then
    return '{}'::text[];
  end if;
  return case r.status
    when 'PENDING' then array['VERIFIED', 'COMPLETED', 'REJECTED']
    when 'VERIFIED' then array['COMPLETED', 'REJECTED', 'PENDING']
    when 'REJECTED' then array['PENDING']
    else '{}'::text[]
  end;
end $$;

create or replace function private.recharge_json(r public.support_recharges)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f public.support_recharge_files;
  v_by text;
  v_status_by text;
  v_team text;
  v_next text[] := private.recharge_next_statuses(r);
begin
  select * into f from public.support_recharge_files where id = r.screenshot_id and status = 'READY';
  select p.full_name into v_by from public.profiles p where p.id = r.created_by;
  select p.full_name into v_status_by from public.profiles p where p.id = r.status_by;
  select t.name into v_team from public.teams t where t.id = r.team_id;
  return jsonb_build_object(
    'id', r.id,
    'reference', (case r.kind when 'PANEL' then 'PRC-' else 'MRC-' end) || lpad(r.ref_no::text, 5, '0'),
    'kind', r.kind,
    'customerName', r.customer_name,
    'rechargeDate', r.recharge_date,
    'gstAmount', r.gst_amount,
    'gstDetails', r.gst_details,
    'nonGstAmount', r.non_gst_amount,
    'nonGstDetails', r.non_gst_details,
    'totalAmount', r.total_amount,
    'status', r.status,
    'remarks', r.remarks,
    'statusNote', r.status_note,
    'statusAt', r.status_at,
    'statusByName', v_status_by,
    'createdById', r.created_by,
    'createdByName', v_by,
    'teamName', v_team,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at,
    'screenshot', case when f.id is null then null
                  else jsonb_build_object('id', f.id, 'name', f.file_name, 'mime', f.mime_type, 'size', f.size_bytes) end,
    'canEdit', private.recharge_can_edit(r),
    'nextStatuses', to_jsonb(v_next)
  );
end $$;

-- the money and text of a request, checked once for create and update
create or replace function private.recharge_clean(p jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p ->> 'customerName', ''));
  v_date date;
  v_gst numeric;
  v_non numeric;
  v_total numeric;
  v_gd text := nullif(btrim(coalesce(p ->> 'gstDetails', '')), '');
  v_nd text := nullif(btrim(coalesce(p ->> 'nonGstDetails', '')), '');
  v_rem text := nullif(btrim(coalesce(p ->> 'remarks', '')), '');
begin
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'VALIDATION_ERROR: Enter the customer name (2 to 150 characters).' using errcode = 'P0001';
  end if;
  begin
    v_date := (p ->> 'rechargeDate')::date;
  exception when others then
    v_date := null;
  end;
  if v_date is null then
    raise exception 'VALIDATION_ERROR: Enter the recharge date.' using errcode = 'P0001';
  end if;
  if v_date > (now() at time zone 'Asia/Kolkata')::date + 1 or v_date < date '2020-01-01' then
    raise exception 'VALIDATION_ERROR: The recharge date is not valid (it cannot be in the future).' using errcode = 'P0001';
  end if;
  begin
    v_gst := coalesce(nullif(btrim(p ->> 'gstAmount'), '')::numeric, 0);
    v_non := coalesce(nullif(btrim(p ->> 'nonGstAmount'), '')::numeric, 0);
    v_total := nullif(btrim(p ->> 'totalAmount'), '')::numeric;
  exception when others then
    raise exception 'VALIDATION_ERROR: Amounts must be numbers.' using errcode = 'P0001';
  end;
  if v_gst < 0 or v_non < 0 or v_gst > 100000000 or v_non > 100000000 then
    raise exception 'VALIDATION_ERROR: Amounts cannot be negative or more than 10 crore.' using errcode = 'P0001';
  end if;
  if v_gst <> round(v_gst, 2) or v_non <> round(v_non, 2) then
    raise exception 'VALIDATION_ERROR: Amounts can have at most 2 decimal places.' using errcode = 'P0001';
  end if;
  if v_gst + v_non <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the GST amount, the non-GST amount or both (the total must be above zero).' using errcode = 'P0001';
  end if;
  if v_total is not null and v_total <> v_gst + v_non then
    raise exception 'VALIDATION_ERROR: The total recharge amount must equal the GST amount plus the non-GST amount.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_gd, '')) > 500 or length(coalesce(v_nd, '')) > 500 then
    raise exception 'VALIDATION_ERROR: GST / non-GST details can be at most 500 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_rem, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: Remarks can be at most 1000 characters.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('name', v_name, 'date', v_date, 'gst', v_gst, 'non', v_non, 'gd', v_gd, 'nd', v_nd, 'rem', v_rem);
end $$;

-- the screenshot a person just uploaded: READY, theirs, not yet attached to any recharge
create or replace function private.recharge_take_file(p_file uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  f public.support_recharge_files;
begin
  select * into f from public.support_recharge_files
   where id = p_file and uploader_id = auth.uid() and status = 'READY' and recharge_id is null;
  if f.id is null then
    raise exception 'VALIDATION_ERROR: The payment screenshot is not available any more. Please upload it again.' using errcode = 'P0001';
  end if;
  return f.id;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Create, update, status
-- ---------------------------------------------------------------------------
create or replace function public.recharge_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_role text := private.recharge_role();
  v_kind text := upper(btrim(coalesce(p ->> 'kind', '')));
  v_req uuid := private.try_uuid(p ->> 'requestId');
  v_file uuid := private.try_uuid(p ->> 'screenshotId');
  c jsonb;
  r public.support_recharges;
begin
  if v_role is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  if v_role = 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Recharges are recorded by the Support team. The Super Admin reviews them.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if me.department_id is null then
    raise exception 'FORBIDDEN: Your profile has no department.' using errcode = '42501';
  end if;
  if v_kind not in ('PANEL', 'MESSAGE') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  -- a double click or a retry returns the record already saved
  if v_req is not null then
    select * into r from public.support_recharges where created_by = me.id and client_request_id = v_req;
    if r.id is not null then
      return private.recharge_json(r);
    end if;
  end if;
  c := private.recharge_clean(p);
  if v_file is null then
    raise exception 'VALIDATION_ERROR: Upload the screenshot of the payment.' using errcode = 'P0001';
  end if;
  perform private.recharge_take_file(v_file);
  insert into public.support_recharges (kind, department_id, team_id, created_by, client_request_id, customer_name, recharge_date,
                                        gst_amount, gst_details, non_gst_amount, non_gst_details, total_amount, remarks, screenshot_id, updated_by)
  values (v_kind, coalesce(private.my_department_id(), me.department_id), me.team_id, me.id, v_req, c ->> 'name', (c ->> 'date')::date,
          (c ->> 'gst')::numeric, c ->> 'gd', (c ->> 'non')::numeric, c ->> 'nd', (c ->> 'gst')::numeric + (c ->> 'non')::numeric, c ->> 'rem', v_file, me.id)
  returning * into r;
  update public.support_recharge_files set recharge_id = r.id where id = v_file;
  perform private.write_audit('SUPPORT_RECHARGE_CREATED', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'total', r.total_amount, 'recharge_date', r.recharge_date));
  return private.recharge_json(r);
end $$;

create or replace function public.recharge_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  c jsonb;
  v_file uuid := private.try_uuid(p ->> 'screenshotId');
  v_status text;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_id for update;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  if not private.recharge_can_edit(r) then
    raise exception 'FORBIDDEN: This recharge can no longer be edited by you.' using errcode = '42501';
  end if;
  c := private.recharge_clean(p);
  if v_file is not null and v_file is distinct from r.screenshot_id then
    perform private.recharge_take_file(v_file);
    update public.support_recharge_files set recharge_id = r.id where id = v_file;
  else
    v_file := r.screenshot_id;
  end if;
  -- the recorder correcting a rejected recharge sends it back for checking
  v_status := case when r.status = 'REJECTED' and r.created_by = auth.uid() then 'PENDING' else r.status end;
  update public.support_recharges set
    customer_name = c ->> 'name', recharge_date = (c ->> 'date')::date,
    gst_amount = (c ->> 'gst')::numeric, gst_details = c ->> 'gd', non_gst_amount = (c ->> 'non')::numeric, non_gst_details = c ->> 'nd',
    total_amount = (c ->> 'gst')::numeric + (c ->> 'non')::numeric, remarks = c ->> 'rem', screenshot_id = v_file,
    status = v_status, status_note = case when v_status <> r.status then null else status_note end,
    updated_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  perform private.write_audit('SUPPORT_RECHARGE_UPDATED', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'total', r.total_amount, 'status', r.status));
  return private.recharge_json(r);
end $$;

create or replace function public.recharge_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  v_to text := upper(btrim(coalesce(p_status, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_from text;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_id for update;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  if v_to not in ('PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose a valid status.' using errcode = 'P0001';
  end if;
  if not (v_to = any (private.recharge_next_statuses(r))) then
    raise exception 'FORBIDDEN: You cannot move this recharge from % to %.', r.status, v_to using errcode = '42501';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'VALIDATION_ERROR: The note can be at most 500 characters.' using errcode = 'P0001';
  end if;
  if v_to = 'REJECTED' and length(coalesce(v_note, '')) < 3 then
    raise exception 'VALIDATION_ERROR: Say why the recharge is rejected.' using errcode = 'P0001';
  end if;
  v_from := r.status;
  update public.support_recharges set status = v_to, status_note = v_note, status_by = auth.uid(), status_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  perform private.write_audit('SUPPORT_RECHARGE_STATUS', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'from', v_from, 'to', v_to, 'total', r.total_amount));
  return private.recharge_json(r);
end $$;

-- ---------------------------------------------------------------------------
-- 4. Read: list with filters, pagination and the summary cards; one record
-- ---------------------------------------------------------------------------
-- The summary covers the same authorised records and filters as the table EXCEPT the status filter (so the cards still show every status).
create or replace function public.recharge_list(
  p_kind text, p_search text default null, p_status text default null, p_from date default null, p_to date default null,
  p_min numeric default null, p_max numeric default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
  v_kind text := upper(btrim(coalesce(p_kind, '')));
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
  v_sum jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  if v_kind not in ('PANEL', 'MESSAGE') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('PENDING', 'VERIFIED', 'COMPLETED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose a valid status.' using errcode = 'P0001';
  end if;
  if v_search is not null then
    v_search := '%' || replace(replace(replace(left(v_search, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with scoped as (
    select r.* from public.support_recharges r
     where r.kind = v_kind and private.recharge_visible(r)
       and (v_search is null or r.customer_name ilike v_search escape '\')
       and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
       and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
  )
  select jsonb_build_object(
           'totalRecharges', count(*), 'totalAmount', coalesce(sum(total_amount), 0), 'totalGst', coalesce(sum(gst_amount), 0),
           'totalNonGst', coalesce(sum(non_gst_amount), 0), 'pending', count(*) filter (where status = 'PENDING'),
           'verified', count(*) filter (where status = 'VERIFIED'), 'completed', count(*) filter (where status = 'COMPLETED'),
           'rejected', count(*) filter (where status = 'REJECTED'))
    into v_sum from scoped;

  select count(*) into v_total from public.support_recharges r
   where r.kind = v_kind and private.recharge_visible(r) and (v_status is null or r.status = v_status)
     and (v_search is null or r.customer_name ilike v_search escape '\')
     and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
     and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max);

  select coalesce(jsonb_agg(private.recharge_json(x) order by x.recharge_date desc, x.created_at desc), '[]'::jsonb) into v_items
    from (select r.* from public.support_recharges r
           where r.kind = v_kind and private.recharge_visible(r) and (v_status is null or r.status = v_status)
             and (v_search is null or r.customer_name ilike v_search escape '\')
             and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
             and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
           order by r.recharge_date desc, r.created_at desc limit v_limit offset v_offset) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset, 'summary', v_sum,
                            'role', v_role, 'canCreate', v_role in ('MEMBER', 'LEAD', 'HEAD'));
end $$;

create or replace function public.recharge_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_id;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  return private.recharge_json(r);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Screenshot upload and view (same steps as ticket files; the API signs the links after these allowed them)
-- ---------------------------------------------------------------------------
create or replace function public.recharge_begin_upload(p_file_name text, p_mime text, p_size bigint)
returns public.support_recharge_files language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  r public.support_recharge_files;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf') then
    raise exception 'VALIDATION_ERROR: The payment proof must be an image (PNG, JPEG or WebP) or a PDF.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.support_recharge_files set status = 'FAILED' where uploader_id = auth.uid() and status = 'PENDING' and created_at < now() - interval '1 day';
  if (select count(*) from public.support_recharge_files a where a.uploader_id = auth.uid() and a.status = 'PENDING' and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  insert into public.support_recharge_files (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, auth.uid(), v_name, p_mime, p_size, format('%s/%s/%s', auth.uid(), v_id, private.chat_clean_name(v_name)))
  returning * into r;
  return r;
end $$;

create or replace function private.recharge_own_pending(p_file uuid)
returns public.support_recharge_files language plpgsql stable security definer set search_path = '' as $$
declare
  r public.support_recharge_files;
begin
  select * into r from public.support_recharge_files a where a.id = p_file and a.status = 'PENDING' and a.uploader_id = auth.uid();
  if r.id is null or private.recharge_role() is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.recharge_pending_upload(p_attachment uuid)
returns public.support_recharge_files language sql stable security definer set search_path = '' as $$
  select * from private.recharge_own_pending(p_attachment)
$$;

create or replace function public.recharge_complete_upload(p_attachment uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharge_files;
begin
  r := private.recharge_own_pending(p_attachment);
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.support_recharge_files set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag) where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.file_name, 'mime', r.mime_type, 'size', r.size_bytes);
end $$;

create or replace function public.recharge_abort_upload(p_attachment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.support_recharge_files a set status = 'FAILED' where a.id = p_attachment and a.status = 'PENDING' and a.uploader_id = auth.uid();
end $$;

-- one screenshot: whoever may read its recharge (checked again every time and written to the audit log); a file not attached yet: its uploader only
create or replace function public.recharge_attachment_download(p_attachment uuid)
returns public.support_recharge_files language plpgsql security definer set search_path = '' as $$
declare
  f public.support_recharge_files;
  r public.support_recharges;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  select * into f from public.support_recharge_files a where a.id = p_attachment and a.status = 'READY';
  if f.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if f.recharge_id is null then
    if f.uploader_id <> auth.uid() then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    return f;
  end if;
  select * into r from public.support_recharges where id = f.recharge_id;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('SUPPORT_RECHARGE_SCREENSHOT_VIEWED', 'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('attachment_id', f.id, 'kind', r.kind));
  return f;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.recharge_role()', 'private.recharge_visible(public.support_recharges)', 'private.recharge_can_edit(public.support_recharges)',
    'private.recharge_next_statuses(public.support_recharges)', 'private.recharge_json(public.support_recharges)', 'private.recharge_clean(jsonb)',
    'private.recharge_take_file(uuid)', 'private.recharge_own_pending(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.recharge_create(jsonb)', 'public.recharge_update(uuid, jsonb)', 'public.recharge_set_status(uuid, text, text)',
    'public.recharge_list(text, text, text, date, date, numeric, numeric, integer, integer)', 'public.recharge_get(uuid)',
    'public.recharge_begin_upload(text, text, bigint)', 'public.recharge_pending_upload(uuid)', 'public.recharge_complete_upload(uuid, bigint, text)',
    'public.recharge_abort_upload(uuid)', 'public.recharge_attachment_download(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
