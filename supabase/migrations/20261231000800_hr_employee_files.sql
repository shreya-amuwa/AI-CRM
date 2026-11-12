-- =============================================================================
-- HR employee files: documents HR uploads to an employee's profile (identity / KYC, employment papers, education
-- certificates, leave-application mails, leave-cancellation mails, other). Until now the profile kept only a browser
-- blob: URL, so every file was lost on refresh.
--
--  * The FILE goes to Cloudflare R2 (or Supabase Storage when R2 is not configured) through a single-use signed upload
--    the API issues after the database allowed it; the API then looks at the stored object (exists, size, first bytes
--    match the type) before the row becomes READY. Only METADATA is kept here - never the bytes.
--  * public.hr_employee_files    one row per file: employee (key + profile + HR record, resolved by private.hr_doc_employee,
--                                never taken from the browser), kind, optional leave reference and note, file name / type /
--                                size, where it is stored, who uploaded it, and a soft delete.
--
-- WHO (agreed with the owner):
--   * HR staff (Super Admin, HR Admin Head, HR Assistant; not HR Recruiters) - private.is_hr_staff() - upload, list, open
--     and delete any employee's files.
--   * The employee themself (a CRM login, i.e. profile_id = auth.uid()) can list and open their OWN ready files. They cannot
--     upload or delete. HR-only records (no login) have no self access.
--   * Nobody else. Row level security enforces the read rule on the table; writes go only through the functions below.
-- LIMITS: each file at most 5 MB; PDF, JPEG, PNG, Word (.docx) and e-mail (.eml) only; at most 10 uploads in progress per person.
-- RETENTION: kept until HR deletes it. Deleting marks the row deleted (kept for the audit trail) and the API removes the stored object.
--
-- Additive and safe to run again. Nothing existing is changed.
-- =============================================================================

create table if not exists public.hr_employee_files (
  id                uuid primary key default gen_random_uuid(),
  employee_key      text not null,
  profile_id        uuid references public.profiles (id) on delete set null,
  hr_record_id      text,
  kind              text not null check (kind in ('IDENTITY', 'EMPLOYMENT', 'EDUCATION', 'LEAVE_MAIL', 'LEAVE_CANCELLATION_MAIL', 'OTHER')),
  leave_ref         text check (leave_ref is null or length(leave_ref) between 1 and 100),
  note              text check (note is null or length(note) <= 500),
  file_name         text not null check (length(file_name) between 1 and 200),
  mime_type         text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'message/rfc822')),
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  status            text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  storage_bucket    text not null default 'hr-employee-files',
  storage_path      text not null unique,
  storage_provider  text check (storage_provider in ('SUPABASE', 'R2')),
  storage_ref       text,
  storage_etag      text,
  uploaded_by       uuid references public.profiles (id) on delete set null,
  uploaded_by_name  text,
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_by        uuid references public.profiles (id) on delete set null
);
create index if not exists hr_employee_files_employee_idx on public.hr_employee_files (employee_key, created_at desc) where status = 'READY' and deleted_at is null;
create index if not exists hr_employee_files_profile_idx on public.hr_employee_files (profile_id) where profile_id is not null;
create index if not exists hr_employee_files_pending_idx on public.hr_employee_files (created_at) where status = 'PENDING';

alter table public.hr_employee_files enable row level security;
revoke all on public.hr_employee_files from public, anon, authenticated;
-- reads only (and only the rows the policy allows); every write goes through the security definer functions below
grant select on public.hr_employee_files to authenticated;
drop policy if exists hr_employee_files_read on public.hr_employee_files;
create policy hr_employee_files_read on public.hr_employee_files for select to authenticated
  using ((select private.is_hr_staff())
         or (profile_id = (select auth.uid()) and status = 'READY' and deleted_at is null));

-- Private bucket (when files go to Supabase Storage; R2 uses the same logical bucket name). No browser access: the API signs short-lived links.
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('hr-employee-files', 'hr-employee-files', false, 5242880,
            array['application/pdf', 'image/jpeg', 'image/png',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'message/rfc822'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

create or replace function private.hr_file_require_staff()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can upload or delete employee documents.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.hr_file_require_staff() from public, anon, authenticated;

-- May the caller read this employee's files? HR staff: any employee. Anyone else: only their own CRM account.
create or replace function private.hr_file_can_read(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_staff()
      or (p_key is not null and auth.uid() is not null and p_key = auth.uid()::text
          and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'))
$$;
revoke all on function private.hr_file_can_read(text) from public, anon, authenticated;

create or replace function private.hr_file_json(f public.hr_employee_files)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'employeeKey', f.employee_key, 'kind', f.kind, 'leaveRef', f.leave_ref, 'note', f.note,
    'fileName', f.file_name, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes, 'uploadedBy', f.uploaded_by_name, 'createdAt', f.created_at)
$$;
revoke all on function private.hr_file_json(public.hr_employee_files) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Upload: book it (HR staff; the database checks the employee, kind, type and size)
-- ---------------------------------------------------------------------------
create or replace function public.hr_employee_file_begin(
  p_employee_key text, p_kind text, p_file_name text, p_mime text, p_size bigint, p_leave_ref text default null, p_note text default null)
returns public.hr_employee_files language plpgsql security definer set search_path = '' as $$
declare
  e record;
  me uuid := private.my_id();
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  v_leave text := nullif(btrim(coalesce(p_leave_ref, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_actor text;
  r public.hr_employee_files;
begin
  perform private.hr_file_require_staff();
  select * into e from private.hr_doc_employee(p_employee_key);
  if not found then
    raise exception 'NOT_FOUND: This employee is not in the HR directory.' using errcode = 'P0001';
  end if;
  if p_kind is null or p_kind not in ('IDENTITY', 'EMPLOYMENT', 'EDUCATION', 'LEAVE_MAIL', 'LEAVE_CANCELLATION_MAIL', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose what kind of document this is.' using errcode = 'P0001';
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime is null or p_mime not in ('application/pdf', 'image/jpeg', 'image/png',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'message/rfc822') then
    raise exception 'VALIDATION_ERROR: Upload a PDF, JPG, PNG, Word (.docx) or e-mail (.eml) file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  if v_leave is not null and length(v_leave) > 100 then
    raise exception 'VALIDATION_ERROR: The leave reference is too long.' using errcode = 'P0001';
  end if;
  if p_kind in ('LEAVE_MAIL', 'LEAVE_CANCELLATION_MAIL') and v_leave is null then
    raise exception 'VALIDATION_ERROR: A leave mail must name the leave it belongs to.' using errcode = 'P0001';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'VALIDATION_ERROR: The note can be at most 500 characters.' using errcode = 'P0001';
  end if;
  -- abandoned uploads of this person
  update public.hr_employee_files set status = 'FAILED'
   where status = 'PENDING' and uploaded_by = me and created_at < now() - interval '1 day';
  if (select count(*) from public.hr_employee_files f
       where f.status = 'PENDING' and f.uploaded_by = me and f.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  select full_name into v_actor from public.profiles where id = me;
  insert into public.hr_employee_files (id, employee_key, profile_id, hr_record_id, kind, leave_ref, note, file_name, mime_type, size_bytes,
                                        storage_path, uploaded_by, uploaded_by_name)
  values (v_id, e.employee_key, e.profile_id, e.hr_record_id, p_kind, v_leave, v_note, v_name, p_mime, p_size,
          format('%s/%s/%s', regexp_replace(e.employee_key, '[^A-Za-z0-9_-]', '_', 'g'), v_id, private.chat_clean_name(v_name)),
          me, v_actor)
  returning * into r;
  return r;
end $$;
revoke all on function public.hr_employee_file_begin(text, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.hr_employee_file_begin(text, text, text, text, bigint, text, text) to authenticated;

-- the caller's own PENDING upload (HR staff only)
create or replace function private.hr_file_own_pending(p_id uuid)
returns public.hr_employee_files language plpgsql stable security definer set search_path = '' as $$
declare
  r public.hr_employee_files;
begin
  perform private.hr_file_require_staff();
  select * into r from public.hr_employee_files f where f.id = p_id and f.status = 'PENDING' and f.uploaded_by = private.my_id();
  if r.id is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;
revoke all on function private.hr_file_own_pending(uuid) from public, anon, authenticated;

create or replace function public.hr_employee_file_pending(p_id uuid)
returns public.hr_employee_files language sql stable security definer set search_path = '' as $$
  select * from private.hr_file_own_pending(p_id)
$$;
revoke all on function public.hr_employee_file_pending(uuid) from public, anon;
grant execute on function public.hr_employee_file_pending(uuid) to authenticated;

create or replace function public.hr_employee_file_complete(p_id uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_employee_files;
begin
  r := private.hr_file_own_pending(p_id);
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.hr_employee_files set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag)
   where id = r.id returning * into r;
  perform private.write_audit('HR_EMPLOYEE_FILE_UPLOADED', 'hr_employee_file', r.id, null, null,
    jsonb_build_object('employeeKey', r.employee_key, 'kind', r.kind, 'fileName', r.file_name, 'size', r.size_bytes));
  return private.hr_file_json(r);
end $$;
revoke all on function public.hr_employee_file_complete(uuid, bigint, text) from public, anon;
grant execute on function public.hr_employee_file_complete(uuid, bigint, text) to authenticated;

create or replace function public.hr_employee_file_abort(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.hr_file_require_staff();
  update public.hr_employee_files set status = 'FAILED' where id = p_id and status = 'PENDING' and uploaded_by = private.my_id();
end $$;
revoke all on function public.hr_employee_file_abort(uuid) from public, anon;
grant execute on function public.hr_employee_file_abort(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading: an employee's files, and one file's download (checked again every time, every opening audited)
-- ---------------------------------------------------------------------------
create or replace function public.hr_employee_files_list(p_employee_key text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.hr_file_can_read(p_employee_key) then
    raise exception 'FORBIDDEN: You can only see your own HR documents.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.hr_file_json(f) order by f.created_at desc, f.id)
      from public.hr_employee_files f
     where f.employee_key = p_employee_key and f.status = 'READY' and f.deleted_at is null), '[]'::jsonb);
end $$;
revoke all on function public.hr_employee_files_list(text) from public, anon;
grant execute on function public.hr_employee_files_list(text) to authenticated;

create or replace function public.hr_employee_file_download(p_id uuid)
returns public.hr_employee_files language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_employee_files;
begin
  select * into r from public.hr_employee_files f where f.id = p_id and f.status = 'READY' and f.deleted_at is null;
  if r.id is null or not private.hr_file_can_read(r.employee_key) then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('HR_EMPLOYEE_FILE_OPENED', 'hr_employee_file', r.id, null, null,
    jsonb_build_object('employeeKey', r.employee_key, 'kind', r.kind, 'bySelf', not private.is_hr_staff()));
  return r;
end $$;
revoke all on function public.hr_employee_file_download(uuid) from public, anon;
grant execute on function public.hr_employee_file_download(uuid) to authenticated;

-- HR deletes a file: the row is kept (marked deleted) for the audit trail; the API removes the stored object.
create or replace function public.hr_employee_file_delete(p_id uuid)
returns public.hr_employee_files language plpgsql security definer set search_path = '' as $$
declare
  r public.hr_employee_files;
begin
  perform private.hr_file_require_staff();
  update public.hr_employee_files set deleted_at = now(), deleted_by = private.my_id()
   where id = p_id and status = 'READY' and deleted_at is null
  returning * into r;
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('HR_EMPLOYEE_FILE_DELETED', 'hr_employee_file', r.id, null, null,
    jsonb_build_object('employeeKey', r.employee_key, 'kind', r.kind, 'fileName', r.file_name));
  return r;
end $$;
revoke all on function public.hr_employee_file_delete(uuid) from public, anon;
grant execute on function public.hr_employee_file_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
