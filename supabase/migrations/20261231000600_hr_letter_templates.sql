-- =============================================================================
-- HR letters: the Offer Letter joins the NDA and the Experience Letter, and the wording of the Offer and Experience Letters becomes a versioned
-- master template that HR leadership can edit. (The NDA stays the official PDF itself: its clauses are never edited.)
--
--  * public.hr_documents.doc_type accepts 'OFFER'. Each generated letter keeps, in hr_documents.fields, the exact wording it was made with
--    (fields.content) and the master version it started from (fields.templateVersion): a later edit of a master template never changes a letter
--    already issued (the stored PDF and its values are never rewritten).
--  * public.hr_letter_templates: one row per version of a master template (OFFER, EXPERIENCE). Rows are never updated or deleted; saving makes
--    the next version. Version 1 is the wording of the supplied official letters (shared/hrLetters.ts; the API test compares them).
--  * hr_letter_template_state / _version: HR staff read them. hr_letter_template_save: the Super Admin or the HR Admin Head (private.is_hr_leadership)
--    save a new version, only on top of the current one (no lost update), audited.
--  * hr_document_prefill / hr_document_record: the Offer Letter (any employee in the HR directory; no "has left" rule), the HR record's monthly
--    salary and working hours for the form, and the current master template.
--
-- Additive and safe to run twice. Nothing existing is changed or deleted. Run after 20261231000500_chat_receipts_light.sql.
-- =============================================================================

alter table public.hr_documents drop constraint if exists hr_documents_doc_type_check;
alter table public.hr_documents add constraint hr_documents_doc_type_check check (doc_type in ('NDA', 'EXPERIENCE', 'OFFER'));

create table if not exists public.hr_letter_templates (
  id              uuid primary key default gen_random_uuid(),
  doc_type        text not null check (doc_type in ('OFFER', 'EXPERIENCE')),
  version         integer not null check (version >= 1),
  content         jsonb not null check (jsonb_typeof(content) = 'object'),
  note            text check (length(note) <= 200),
  created_by      uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  unique (doc_type, version)
);
create index if not exists hr_letter_templates_current_idx on public.hr_letter_templates (doc_type, version desc);
alter table public.hr_letter_templates enable row level security;
-- no policy and no grant: read and written only through the functions below
revoke all on public.hr_letter_templates from anon, authenticated;

-- version 1: the supplied letters' wording (placeholders in {braces}, **bold**)
insert into public.hr_letter_templates (doc_type, version, content, note, created_by_name) values
  ('OFFER', 1, $json${"subject":"Offer Letter for the Position of **{designation}**","salutation":"Dear {name},","paragraphs":["With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** in the {department} Department at Amuwa Corporation, effective from **{joiningDate}**.","In this role, you will be responsible for providing Technical assistance, resolving system-related issues, and ensuring smooth operational support for {department}."],"responsibilitiesHeading":"Key Responsibilities","responsibilities":["Providing Technical support for systems, tools, and platforms used by the team","Resolving technical issues related to orders, dashboards, and internal processes","Assisting in troubleshooting technical-related technical concerns","Coordinating with internal teams for issue resolution","Maintaining system records and technical documentation","Ensuring smooth functioning of day-to-day technical operations","Supporting team members with basic technical guidance"],"termsHeading":"Employment Terms","terms":[{"label":"Designation","value":"{designation}"},{"label":"Department","value":"{department}"},{"label":"Employment Type","value":"{employmentType}"},{"label":"Date of Joining","value":"{joiningDate}"},{"label":"Salary","value":"{salary}"},{"label":"Working Hours","value":"As per company policy"},{"label":"Probation Period","value":"{probation}"},{"label":"Reporting To","value":"{reportingTo}"}],"closing":["This offer is subject to your acceptance and adherence to company policies, rules, and regulations.","We look forward to your contribution and a successful association with Amuwa Corporation."],"signOff":"For Amuwa Corporation,","acceptanceHeading":"Acceptance","acceptance":"I, **{name}**, hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above."}$json$::jsonb, 'The official Offer Letter (supplied format)', 'Amuwa Corporation'),
  ('EXPERIENCE', 1, $json${"greeting":"To Whom It May Concern,","paragraphs":["This is to certify that {title} {name} was employed with Amuwa Corporation as **{designation}** from {from} to {to}.","During {his} tenure with us, {he} demonstrated dedication, professionalism, and a strong work ethic. {He} performed {his} responsibilities efficiently and contributed positively to the growth of the organization.","We appreciate {his} efforts and the work {he} has done during {his} time with us.","We wish {him} all the best for {his} future endeavors and continued success in {his} career. Good luck for a bright future."],"signOff":"Sincerely,"}$json$::jsonb, 'The official Experience Letter (supplied format)', 'Amuwa Corporation')
on conflict (doc_type, version) do nothing;

create or replace function private.hr_letter_template_json(t public.hr_letter_templates, p_with_content boolean default true)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('type', t.doc_type, 'version', t.version, 'note', t.note, 'createdBy', t.created_by_name, 'createdAt', t.created_at)
         || case when p_with_content then jsonb_build_object('content', t.content) else '{}'::jsonb end
$$;
revoke all on function private.hr_letter_template_json(public.hr_letter_templates, boolean) from public, anon, authenticated;

create or replace function private.hr_letter_template_current(p_type text)
returns public.hr_letter_templates language sql stable security definer set search_path = '' as $$
  select t.* from public.hr_letter_templates t where t.doc_type = p_type order by t.version desc limit 1
$$;
revoke all on function private.hr_letter_template_current(text) from public, anon, authenticated;

create or replace function public.hr_letter_template_state(p_type text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_letter_templates;
begin
  perform private.hr_doc_require_staff();
  if p_type is null or p_type not in ('OFFER', 'EXPERIENCE') then
    raise exception 'VALIDATION_ERROR: Choose the Offer Letter or the Experience Letter.' using errcode = 'P0001';
  end if;
  t := private.hr_letter_template_current(p_type);
  if t.id is null then
    raise exception 'NOT_FOUND: This letter has no master template yet.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'current', private.hr_letter_template_json(t),
    'versions', coalesce((select jsonb_agg(private.hr_letter_template_json(v, false) order by v.version desc) from public.hr_letter_templates v where v.doc_type = p_type), '[]'::jsonb),
    'canEdit', private.is_hr_leadership());
end $$;
revoke all on function public.hr_letter_template_state(text) from public, anon;
grant execute on function public.hr_letter_template_state(text) to authenticated;

create or replace function public.hr_letter_template_version(p_type text, p_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_letter_templates;
begin
  perform private.hr_doc_require_staff();
  select * into t from public.hr_letter_templates where doc_type = p_type and version = p_version;
  if t.id is null then
    raise exception 'NOT_FOUND: This template version was not found.' using errcode = 'P0001';
  end if;
  return private.hr_letter_template_json(t);
end $$;
revoke all on function public.hr_letter_template_version(text, integer) from public, anon;
grant execute on function public.hr_letter_template_version(text, integer) to authenticated;

-- A new version of a master template. The server validated the wording (shared/validation.ts: the structure, the lengths and the placeholders);
-- the database checks who saves it, that it is built on the current version, and the basic shape again.
create or replace function public.hr_letter_template_save(p_type text, p_content jsonb, p_base_version integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cur public.hr_letter_templates;
  t public.hr_letter_templates;
  v_required text[];
begin
  perform private.hr_doc_require_staff();
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only the Super Admin or the HR Admin Head can change a master letter template.' using errcode = '42501';
  end if;
  if p_type is null or p_type not in ('OFFER', 'EXPERIENCE') then
    raise exception 'VALIDATION_ERROR: Choose the Offer Letter or the Experience Letter.' using errcode = 'P0001';
  end if;
  v_required := case p_type
    when 'OFFER' then array['subject', 'salutation', 'paragraphs', 'responsibilitiesHeading', 'responsibilities', 'termsHeading', 'terms', 'closing', 'signOff', 'acceptanceHeading', 'acceptance']
    else array['greeting', 'paragraphs', 'signOff'] end;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or not (p_content ?& v_required)
     or jsonb_typeof(p_content -> 'paragraphs') <> 'array' or jsonb_array_length(p_content -> 'paragraphs') = 0 or length(p_content::text) > 40000 then
    raise exception 'VALIDATION_ERROR: The template is incomplete.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 200 then
    raise exception 'VALIDATION_ERROR: Keep the note under 200 characters.' using errcode = 'P0001';
  end if;
  -- one change at a time: the version that was edited must still be the current one
  perform pg_advisory_xact_lock(hashtext('hr_letter_template:' || p_type));
  cur := private.hr_letter_template_current(p_type);
  if cur.id is null or p_base_version is distinct from cur.version then
    raise exception 'CONFLICT: Someone saved a newer version of this template. Reload it before saving.' using errcode = 'P0001';
  end if;
  if cur.content = p_content then
    raise exception 'VALIDATION_ERROR: Nothing was changed.' using errcode = 'P0001';
  end if;
  insert into public.hr_letter_templates (doc_type, version, content, note, created_by, created_by_name)
  values (p_type, cur.version + 1, p_content, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), (select full_name from public.profiles where id = auth.uid()))
  returning * into t;
  perform private.write_audit('HR_LETTER_TEMPLATE_SAVED', 'hr_letter_template', t.id, null, null,
    jsonb_build_object('type', p_type, 'version', t.version, 'from', cur.version));
  return private.hr_letter_template_json(t);
end $$;
revoke all on function public.hr_letter_template_save(text, jsonb, integer, text) from public, anon;
grant execute on function public.hr_letter_template_save(text, jsonb, integer, text) to authenticated;

-- The form's starting values: the record (now also its monthly salary and working hours) and, for the Offer / Experience Letter, the current
-- master template. Same checks as before (20261229000200); the Offer Letter can be made for any employee in the HR directory.
create or replace function public.hr_document_prefill(p_employee_key text, p_doc_type text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e record;
  h public.hr_employees;
  v_problems jsonb;
  t public.hr_letter_templates;
begin
  perform private.hr_doc_require_staff();
  if p_doc_type not in ('NDA', 'EXPERIENCE', 'OFFER') then
    raise exception 'VALIDATION_ERROR: Choose the NDA, the Offer Letter or the Experience Letter.' using errcode = 'P0001';
  end if;
  select * into e from private.hr_doc_employee(p_employee_key);
  if not found then
    raise exception 'NOT_FOUND: This employee is not in the HR directory.' using errcode = 'P0001';
  end if;
  select * into h from public.hr_employees where id = e.hr_record_id;
  v_problems := private.hr_doc_problems(p_doc_type, p_employee_key);
  if p_doc_type in ('OFFER', 'EXPERIENCE') then
    t := private.hr_letter_template_current(p_doc_type);
  end if;
  return jsonb_build_object(
    'employee', jsonb_build_object(
      'key', e.employee_key, 'code', e.employee_code, 'name', e.full_name, 'email', e.email, 'department', e.department_name,
      'designation', e.designation, 'joiningDate', e.joining_date, 'lastWorkingDate', e.left_date,
      'status', case when e.separated then 'Left' else coalesce(e.hr_status, 'Full-Time') end, 'separated', e.separated,
      'monthlySalary', nullif(btrim(coalesce(h.monthly_salary, '')), ''), 'workingHours', nullif(btrim(coalesce(h.working_hours, '')), '')),
    'problems', v_problems,
    'ready', jsonb_array_length(v_problems) = 0,
    'today', private.hr_today(),
    'template', case when t.id is null then null else private.hr_letter_template_json(t) end);
end $$;
revoke all on function public.hr_document_prefill(text, text) from public, anon;
grant execute on function public.hr_document_prefill(text, text) to authenticated;

-- Called by the server after it stored the PDF. As before, plus the Offer Letter: its wording and the master version it started from are kept
-- with it (the version must exist), so the letter stays exactly as issued whatever happens to the master template later.
create or replace function public.hr_document_record(
  p_employee_key text, p_doc_type text, p_fields jsonb, p_file_name text,
  p_provider text, p_bucket text, p_path text, p_ref text, p_etag text, p_size integer, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_problems jsonb;
  v_actor text;
  v_row public.hr_documents;
begin
  perform private.hr_doc_require_staff();
  if p_doc_type not in ('NDA', 'EXPERIENCE', 'OFFER') then
    raise exception 'VALIDATION_ERROR: Choose the NDA, the Offer Letter or the Experience Letter.' using errcode = 'P0001';
  end if;
  select * into e from private.hr_doc_employee(p_employee_key);
  if not found then
    raise exception 'NOT_FOUND: This employee is not in the HR directory.' using errcode = 'P0001';
  end if;
  v_problems := private.hr_doc_problems(p_doc_type, p_employee_key);
  if jsonb_array_length(v_problems) > 0 then
    raise exception 'VALIDATION_ERROR: %', v_problems -> 0 ->> 'message' using errcode = 'P0001';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or nullif(btrim(coalesce(p_fields ->> 'employeeName', '')), '') is null then
    raise exception 'VALIDATION_ERROR: The document values are missing.' using errcode = 'P0001';
  end if;
  if p_doc_type = 'EXPERIENCE' then
    if (p_fields ->> 'joiningDate')::date is distinct from e.joining_date then
      raise exception 'VALIDATION_ERROR: The joining date must be the one on the employee''s record.' using errcode = 'P0001';
    end if;
    if (p_fields ->> 'lastWorkingDate')::date < e.joining_date then
      raise exception 'VALIDATION_ERROR: The last working date is before the joining date.' using errcode = 'P0001';
    end if;
    if (p_fields ->> 'letterDate')::date < (p_fields ->> 'lastWorkingDate')::date then
      raise exception 'VALIDATION_ERROR: The letter date cannot be before the last working date.' using errcode = 'P0001';
    end if;
  end if;
  if p_doc_type in ('OFFER', 'EXPERIENCE') and p_fields ? 'templateVersion' then
    if jsonb_typeof(p_fields -> 'content') is distinct from 'object' or not exists (
         select 1 from public.hr_letter_templates t where t.doc_type = p_doc_type and t.version = (p_fields ->> 'templateVersion')::integer) then
      raise exception 'VALIDATION_ERROR: The letter''s template version is not known. Reload the page.' using errcode = 'P0001';
    end if;
  end if;
  if p_doc_type = 'OFFER' and not (p_fields ? 'templateVersion' and p_fields ? 'content' and p_fields ? 'joiningDate' and p_fields ? 'designation') then
    raise exception 'VALIDATION_ERROR: The offer letter values are missing.' using errcode = 'P0001';
  end if;
  if p_path is null or p_bucket is distinct from 'hr-documents' or p_size is null or p_size <= 0 or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: The stored file reference is not valid.' using errcode = 'P0001';
  end if;
  select full_name into v_actor from public.profiles where id = auth.uid();
  insert into public.hr_documents (doc_type, employee_key, profile_id, hr_record_id, employee_code, employee_name, fields, file_name,
                                   storage_provider, storage_bucket, storage_path, storage_ref, storage_etag, size_bytes, sha256, generated_by, generated_by_name)
  values (p_doc_type, e.employee_key, e.profile_id, e.hr_record_id, e.employee_code, e.full_name, p_fields, p_file_name,
          case when p_provider = 'R2' then 'R2' else 'SUPABASE' end, p_bucket, p_path, p_ref, p_etag, p_size, p_sha256, auth.uid(), v_actor)
  returning * into v_row;
  perform private.write_audit('HR_DOCUMENT_GENERATED', 'hr_document', v_row.id, null, null,
    jsonb_build_object('type', p_doc_type, 'employeeKey', e.employee_key, 'employeeCode', e.employee_code, 'fileName', p_file_name,
                       'templateVersion', p_fields -> 'templateVersion'));
  return jsonb_build_object('id', v_row.id, 'type', v_row.doc_type, 'employeeKey', v_row.employee_key, 'employeeCode', v_row.employee_code,
    'employeeName', v_row.employee_name, 'fileName', v_row.file_name, 'sizeBytes', v_row.size_bytes, 'fields', v_row.fields,
    'generatedBy', v_row.generated_by_name, 'createdAt', v_row.created_at);
end $$;
revoke all on function public.hr_document_record(text, text, jsonb, text, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.hr_document_record(text, text, jsonb, text, text, text, text, text, text, integer, text) to authenticated;

notify pgrst, 'reload schema';
