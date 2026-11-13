-- =============================================================================
-- Sales Sheet Upload: the Sales Department Head uploads a lead sheet to any Sales team member of their own department.
--
-- The Lead Assign upload (20261121000100, narrowed to Telecallers in 20261122000100) is the one Sales sheet-upload system; this extends it:
--  * sales_lead_assignees: the active Sales Team Leads, Team Members and Telecallers of the head's own department (a Business Associate,
--    Influencer, Visit Sales or Business Partner works from their own contact lists and is still not offered; Support is never offered).
--  * sales_lead_sheet_assign: the same checks as before (required name, a valid phone, a valid e-mail, lengths, duplicates in the sheet and in
--    the CRM, the same file never twice, a preview saves nothing). On commit:
--      - Telecaller: the contacts go to their call list (the existing Telecaller workflow, unchanged);
--      - Team Lead / Team Member: the valid rows become leads in that person's own pipeline ("My Leads"), owned by them, so the existing
--        lead-access rules apply (they, their Team Lead and the Department Head see them; nobody else). They are notified.
--    The rows that were left out (invalid / duplicate, with the values that were sent) are now kept with the sheet.
--  * sales_lead_sheet_issues(sheet): the rows left out of one sheet, for the upload history (the Sales head of that department only).
--  * sales_lead_sheets_list: the same history, plus whether the left-out rows are kept and the receiver's role.
--
-- Additive and safe to run twice. Nothing is deleted. Run after 20270101000100_superadmin_overview_departments.sql.
-- =============================================================================

alter table public.sales_lead_sheets add column if not exists issues jsonb;

-- The original file of a sheet may now be an .xls or a .csv too (the private bucket of the original sheets; only added to, never narrowed).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array(select distinct m from unnest(allowed_mime_types || array['application/vnd.ms-excel', 'text/csv']) m order by m)
     where id = 'telecaller-sheets' and allowed_mime_types is not null
       and not (allowed_mime_types @> array['application/vnd.ms-excel', 'text/csv']);
  end if;
end $$;

create or replace function public.sales_lead_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
      'subRole', p.sales_sub_role, 'mode', case when p.sales_sub_role = 'TELECALLER' then 'TELECALLER' else 'LEADS' end,
      'openContacts', case when p.sales_sub_role = 'TELECALLER'
        then (select count(*) from public.telecaller_contacts c where c.assigned_to = p.id and c.call_status = 'PENDING') else 0 end,
      'openLeads', (select count(*) from public.customers c where c.owner_id = p.id and c.lifecycle_stage = 'LEAD'))
      order by case when p.sales_sub_role = 'TELECALLER' then 2 when p.role = 'TEAM_HEAD' then 0 else 1 end, p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.department_id = private.my_department_id() and t.division = 'SALES'
     and (p.role = 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and (p.sales_sub_role is null or p.sales_sub_role = 'TELECALLER')))), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_assignees() from public, anon;
grant execute on function public.sales_lead_assignees() to authenticated;

-- Check the rows of a sheet and, with p_commit, give the valid ones to the chosen person. p_rows: [{"row":2,"name","company","phone","email","remarks"}].
-- Rows with a problem, and phone numbers / e-mails already in the CRM or twice in the sheet, are listed and left out - never dropped silently.
create or replace function public.sales_lead_sheet_assign(p_assignee uuid, p_file_name text, p_note text, p_rows jsonb, p_hash text, p_commit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles;
  v_team public.teams;
  v_dept uuid := private.my_department_id();
  r jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_clean jsonb := '[]'::jsonb;
  v_seen_phone text[] := '{}';
  v_seen_email text[] := '{}';
  v_phones text[];
  v_emails text[];
  v_known_phone text[];
  v_known_email text[];
  v_mode text;
  v_row integer; v_name text; v_phone text; v_email text; v_problem text; v_kind text;
  v_valid integer := 0; v_invalid integer := 0; v_dup integer := 0;
  v_sheet uuid;
  v_list jsonb;
  v_exists boolean;
  v_lead uuid;
begin
  perform private.require_sales_head();
  select * into a from public.profiles where id = p_assignee;
  select * into v_team from public.teams where id = a.team_id;
  if a.id is null or a.status <> 'ACTIVE' or a.department_id is distinct from v_dept or v_team.division is distinct from 'SALES'
     or not (a.role = 'TEAM_HEAD' or (a.role = 'TEAM_MEMBER' and (a.sales_sub_role is null or a.sales_sub_role = 'TELECALLER'))) then
    raise exception 'VALIDATION_ERROR: Choose an active Sales Team Lead, Team Member or Telecaller of your department.' using errcode = 'P0001';
  end if;
  v_mode := case when a.sales_sub_role = 'TELECALLER' then 'TELECALLER' else 'LEADS' end;
  if length(btrim(coalesce(p_file_name, ''))) < 1 or length(p_file_name) > 200 then raise exception 'VALIDATION_ERROR: The file name is missing.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'VALIDATION_ERROR: The sheet has no contact rows.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'VALIDATION_ERROR: A sheet can have at most 2,000 contacts.' using errcode = 'P0001'; end if;
  if length(coalesce(p_hash, '')) < 16 then raise exception 'VALIDATION_ERROR: The sheet could not be identified.' using errcode = 'P0001'; end if;

  -- what the CRM already knows (one query, not one per row)
  select array_agg(distinct regexp_replace(coalesce(x ->> 'phone', ''), '[\s().-]', '', 'g')), array_agg(distinct lower(nullif(btrim(coalesce(x ->> 'email', '')), '')))
    into v_phones, v_emails from jsonb_array_elements(p_rows) x;
  select array_agg(regexp_replace(c.phone, '[\s().-]', '', 'g')) filter (where c.phone is not null),
         array_agg(c.email) filter (where c.email is not null)
    into v_known_phone, v_known_email from public.customers c
   where c.department_id = v_dept
     and (regexp_replace(coalesce(c.phone, ''), '[\s().-]', '', 'g') = any (v_phones) or c.email = any (v_emails));
  v_known_phone := coalesce(v_known_phone, '{}'); v_known_email := coalesce(v_known_email, '{}');

  for r in select * from jsonb_array_elements(p_rows) loop
    v_row := coalesce((r ->> 'row')::int, 0);
    v_name := nullif(btrim(coalesce(r ->> 'name', '')), '');
    v_phone := regexp_replace(coalesce(r ->> 'phone', ''), '[\s().-]', '', 'g');
    v_email := lower(nullif(btrim(coalesce(r ->> 'email', '')), ''));
    v_problem := null; v_kind := 'INVALID';
    if v_name is null then v_problem := 'The contact name is missing.';
    elsif length(v_name) > 200 then v_problem := 'The contact name is too long.';
    elsif v_phone !~ '^\+?[0-9]{7,15}$' then v_problem := 'The phone number is missing or not valid (7 to 15 digits).';
    elsif v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254) then v_problem := 'The e-mail address is not valid.';
    elsif length(coalesce(r ->> 'company', '')) > 200 or length(coalesce(r ->> 'remarks', '')) > 1000 then v_problem := 'The company or remarks text is too long.';
    elsif v_phone = any (v_seen_phone) or (v_email is not null and v_email = any (v_seen_email)) then v_problem := 'This phone number or e-mail appears twice in the sheet.'; v_kind := 'DUPLICATE';
    elsif v_phone = any (v_known_phone) or (v_email is not null and v_email = any (v_known_email)) then v_problem := 'This person is already in the CRM (same phone number or e-mail).'; v_kind := 'DUPLICATE';
    end if;
    if v_problem is not null then
      -- the values that were sent go with the problem, so the left-out row can be found and fixed in the file
      v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', v_kind, 'message', v_problem,
        'name', left(coalesce(r ->> 'name', ''), 200), 'phone', left(coalesce(r ->> 'phone', ''), 40), 'email', left(coalesce(r ->> 'email', ''), 254),
        'company', left(coalesce(r ->> 'company', ''), 200));
      if v_kind = 'DUPLICATE' then v_dup := v_dup + 1; else v_invalid := v_invalid + 1; end if;
    else
      v_seen_phone := v_seen_phone || v_phone;
      if v_email is not null then v_seen_email := v_seen_email || v_email; end if;
      v_valid := v_valid + 1;
      v_clean := v_clean || jsonb_build_object('row', v_row, 'name', v_name, 'company', nullif(btrim(coalesce(r ->> 'company', '')), ''), 'phone', v_phone, 'email', v_email,
        'remarks', nullif(btrim(coalesce(r ->> 'remarks', '')), ''));
    end if;
  end loop;

  -- one upload of a file at a time (a double click or a retry must not import it twice)
  if p_commit then perform pg_advisory_xact_lock(hashtext('sales_lead_sheet:' || v_dept::text || ':' || p_hash)); end if;
  select exists (select 1 from public.sales_lead_sheets s where s.department_id = v_dept and s.content_hash = p_hash) into v_exists;
  if p_commit and v_exists then raise exception 'CONFLICT: This sheet has already been uploaded and assigned.' using errcode = 'P0001'; end if;
  if p_commit and v_valid = 0 then raise exception 'VALIDATION_ERROR: The sheet has no valid contact to assign. Fix the rows listed and upload it again.' using errcode = 'P0001'; end if;

  if p_commit then
    if v_mode = 'TELECALLER' then
      -- the existing Telecaller workflow: the contacts go to the Telecaller's sheet list; they call, and the interested ones become leads
      v_list := public.telecaller_list_assign(a.id, p_file_name, p_note,
        (select jsonb_agg(jsonb_build_object('row', x ->> 'row', 'name', x ->> 'name', 'company', x ->> 'company', 'phone', x ->> 'phone', 'email', x ->> 'email', 'remarks', x ->> 'remarks')) from jsonb_array_elements(v_clean) x),
        p_hash, true);
      if not coalesce((v_list ->> 'committed')::boolean, false) then raise exception 'VALIDATION_ERROR: The sheet could not be assigned to the Telecaller.' using errcode = 'P0001'; end if;
    end if;
    insert into public.sales_lead_sheets (department_id, uploaded_by, assigned_to, mode, telecaller_list_id, file_name, note, content_hash, total_rows, valid_count, invalid_count, duplicate_count, issues)
    values (v_dept, private.my_id(), a.id, v_mode, case when v_mode = 'TELECALLER' then (v_list ->> 'listId')::uuid end, btrim(p_file_name),
            nullif(btrim(coalesce(p_note, '')), ''), p_hash, jsonb_array_length(p_rows), v_valid, v_invalid, v_dup, v_issues)
    returning id into v_sheet;
    if v_mode = 'LEADS' then
      -- leads in the person's own pipeline: owned by them (the department and team follow the owner), so the usual lead-access rules apply
      with ins as (
        insert into public.customers (owner_id, lifecycle_stage, lead_status, name, company, phone, email, lead_source, call_status, notes, source_sheet_id)
        select a.id, 'LEAD', 'NEW', x ->> 'name', x ->> 'company', x ->> 'phone', x ->> 'email', 'Excel sheet', 'PENDING', x ->> 'remarks', v_sheet
          from jsonb_array_elements(v_clean) x
        returning id)
      insert into public.customer_activities (customer_id, actor_id, type, note)
      select id, private.my_id(), 'LEAD_CREATED', 'Lead added from the sheet ' || btrim(p_file_name) from ins;
      perform private.notify(a.id, 'LEAD_SHEET_ASSIGNED', format('New leads: %s', btrim(p_file_name)),
        format('%s lead%s from a sheet were assigned to you.', v_valid, case when v_valid = 1 then '' else 's' end), 'sales_lead_sheet', v_sheet);
      -- a Team Member's own Team Lead hears about it too (the strict team rule: only the lead who leads this member)
      if a.role = 'TEAM_MEMBER' then
        for v_lead in select p.id from public.profiles p
                       where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and p.team_id = a.team_id and p.id <> private.my_id() and private.led_by(p.id, a.id) loop
          perform private.notify(v_lead, 'LEAD_SHEET_ASSIGNED', format('New leads for %s', a.full_name),
            format('%s lead%s from the sheet %s were assigned to %s.', v_valid, case when v_valid = 1 then '' else 's' end, btrim(p_file_name), a.full_name), 'sales_lead_sheet', v_sheet);
        end loop;
      end if;
    end if;
    perform private.write_audit('SALES_LEAD_SHEET_ASSIGNED', 'sales_lead_sheet', v_sheet, v_dept, a.team_id,
      jsonb_build_object('assignee', a.id, 'mode', v_mode, 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup));
  end if;
  return jsonb_build_object('committed', v_sheet is not null, 'sheetId', v_sheet, 'mode', v_mode, 'alreadyAssigned', v_exists,
    'assignee', jsonb_build_object('id', a.id, 'name', a.full_name,
      'role', case when a.sales_sub_role = 'TELECALLER' then 'Telecaller' when a.role = 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end, 'team', v_team.name),
    'issues', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_issues) x limit 300) q),
    'summary', jsonb_build_object('rows', jsonb_array_length(p_rows), 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup),
    'preview', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_clean) x limit 25) q));
end $$;
revoke all on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) to authenticated;

-- The rows left out of one uploaded sheet (sheets uploaded before this change have none kept: an empty list).
create or replace function public.sales_lead_sheet_issues(p_sheet uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sales_lead_sheets;
begin
  perform private.require_sales_head();
  select * into s from public.sales_lead_sheets where id = p_sheet;
  if s.id is null or s.department_id is distinct from private.my_department_id() then
    raise exception 'NOT_FOUND: Lead sheet not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', s.id, 'fileName', s.file_name, 'kept', s.issues is not null, 'issues', coalesce(s.issues, '[]'::jsonb));
end $$;
revoke all on function public.sales_lead_sheet_issues(uuid) from public, anon;
grant execute on function public.sales_lead_sheet_issues(uuid) to authenticated;

-- Previous uploads and where they stand (as before, plus the receiver's role and whether the left-out rows are kept).
create or replace function public.sales_lead_sheets_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'fileName', s.file_name, 'note', s.note, 'mode', s.mode, 'uploadedAt', s.uploaded_at, 'assignedAt', s.assigned_at,
      'uploadedBy', (select u.full_name from public.profiles u where u.id = s.uploaded_by), 'assigneeId', s.assigned_to,
      'assignedTo', (select t.full_name from public.profiles t where t.id = s.assigned_to),
      'assigneeRole', (select case when t.sales_sub_role = 'TELECALLER' then 'Telecaller' when t.role = 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end
                         from public.profiles t where t.id = s.assigned_to),
      'rows', s.total_rows, 'valid', s.valid_count, 'invalid', s.invalid_count, 'duplicates', s.duplicate_count, 'status', s.status,
      'hasSourceFile', s.source_stored_at is not null, 'issuesKept', s.issues is not null,
      'leadsNow', case when s.mode = 'LEADS' then (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage = 'LEAD') end,
      'converted', case when s.mode = 'LEADS' then (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage <> 'LEAD') end,
      'contactsPending', case when s.mode = 'TELECALLER' then (select count(*) from public.telecaller_contacts c where c.list_id = s.telecaller_list_id and c.call_status = 'PENDING') end,
      'contactsCalled', case when s.mode = 'TELECALLER' then (select count(*) from public.telecaller_contacts c where c.list_id = s.telecaller_list_id and c.call_status <> 'PENDING') end
    ) order by s.uploaded_at desc)
    from public.sales_lead_sheets s where s.department_id = private.my_department_id()), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_sheets_list() from public, anon;
grant execute on function public.sales_lead_sheets_list() to authenticated;

notify pgrst, 'reload schema';
