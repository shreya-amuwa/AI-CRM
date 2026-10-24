-- Run this ONE file once in the Supabase SQL editor (safe to run again), AFTER run_this_sales_department_head.sql. It is the migration 20261122000100_sales_lead_sheets_to_telecallers.sql.

-- =============================================================================
-- Lead Assign goes to the Telecaller.
--
-- The flow of a sheet: the Sales Department Head gives it to a TELECALLER, who calls the contacts; the interested ones become leads and
-- are handed on (Business Associate, ...). A sheet is no longer given straight to a Team Lead or Team Member.
--
--  * sales_lead_assignees: the active Telecallers of the department's Sales teams.
--  * sales_lead_sheet_assign: only a Telecaller can receive a sheet; the contacts go through the existing Telecaller contact-sheet workflow.
--    (name, company, phone, e-mail and remarks are read; a lead's temperature and source are set by the Telecaller after the call.)
--    Phones / e-mails twice in the sheet or already in the CRM are still listed and left out, never dropped silently.
--  * sales_team_people: every active Sales Team Lead / Team Member (the owner filter of the Lead List, the people an unassigned enquiry
--    can be given to).
-- Sheets assigned before this change keep their history. Additive / idempotent. Run the whole file at once.
-- =============================================================================

create or replace function public.sales_lead_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', 'Team Member', 'subRole', p.sales_sub_role, 'mode', 'TELECALLER',
      'openContacts', (select count(*) from public.telecaller_contacts c where c.assigned_to = p.id and c.call_status = 'PENDING')) order by p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.department_id = private.my_department_id() and t.division = 'SALES'
     and p.role = 'TEAM_MEMBER' and p.sales_sub_role = 'TELECALLER'), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_assignees() from public, anon;
grant execute on function public.sales_lead_assignees() to authenticated;

create or replace function public.sales_team_people()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
      'subRole', p.sales_sub_role) order by p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.department_id = private.my_department_id() and t.division = 'SALES' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')), '[]'::jsonb);
end $$;
revoke all on function public.sales_team_people() from public, anon;
grant execute on function public.sales_team_people() to authenticated;

drop function if exists public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean);
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
  v_row integer; v_name text; v_phone text; v_email text;
  v_valid integer := 0; v_invalid integer := 0; v_dup integer := 0;
  v_sheet uuid;
  v_list jsonb;
  v_exists boolean;
begin
  perform private.require_sales_head();
  select * into a from public.profiles where id = p_assignee;
  select * into v_team from public.teams where id = a.team_id;
  if a.id is null or a.status <> 'ACTIVE' or a.department_id is distinct from v_dept or v_team.division is distinct from 'SALES'
     or a.role <> 'TEAM_MEMBER' or a.sales_sub_role is distinct from 'TELECALLER' then
    raise exception 'VALIDATION_ERROR: A lead sheet goes to a Telecaller. Choose an active Telecaller of your department.' using errcode = 'P0001';
  end if;
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
    if v_name is null then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The contact name is missing.'); v_invalid := v_invalid + 1;
    elsif length(v_name) > 200 then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The contact name is too long.'); v_invalid := v_invalid + 1;
    elsif v_phone !~ '^\+?[0-9]{7,15}$' then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The phone number is missing or not valid (7 to 15 digits).'); v_invalid := v_invalid + 1;
    elsif v_email is not null and (v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(v_email) > 254) then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The e-mail address is not valid.'); v_invalid := v_invalid + 1;
    elsif length(coalesce(r ->> 'company', '')) > 200 or length(coalesce(r ->> 'remarks', '')) > 1000 then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'INVALID', 'message', 'The company or remarks text is too long.'); v_invalid := v_invalid + 1;
    elsif v_phone = any (v_seen_phone) or (v_email is not null and v_email = any (v_seen_email)) then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'DUPLICATE', 'message', 'This phone number or e-mail appears twice in the sheet.'); v_dup := v_dup + 1;
    elsif v_phone = any (v_known_phone) or (v_email is not null and v_email = any (v_known_email)) then v_issues := v_issues || jsonb_build_object('row', v_row, 'kind', 'DUPLICATE', 'message', 'This person is already in the CRM (same phone number or e-mail).'); v_dup := v_dup + 1;
    else
      v_seen_phone := v_seen_phone || v_phone;
      if v_email is not null then v_seen_email := v_seen_email || v_email; end if;
      v_valid := v_valid + 1;
      v_clean := v_clean || jsonb_build_object('row', v_row, 'name', v_name, 'company', nullif(btrim(coalesce(r ->> 'company', '')), ''), 'phone', v_phone, 'email', v_email,
        'remarks', nullif(btrim(coalesce(r ->> 'remarks', '')), ''));
    end if;
  end loop;

  select exists (select 1 from public.sales_lead_sheets s where s.department_id = v_dept and s.content_hash = p_hash) into v_exists;
  if p_commit and v_exists then raise exception 'CONFLICT: This sheet has already been uploaded and assigned.' using errcode = 'P0001'; end if;
  if p_commit and v_valid = 0 then raise exception 'VALIDATION_ERROR: The sheet has no valid contact to assign. Fix the rows listed and upload it again.' using errcode = 'P0001'; end if;

  if p_commit then
    -- the existing Telecaller workflow: the contacts go to the Telecaller's sheet list; they call, and the interested ones become leads
    v_list := public.telecaller_list_assign(a.id, p_file_name, p_note,
      (select jsonb_agg(jsonb_build_object('row', x ->> 'row', 'name', x ->> 'name', 'company', x ->> 'company', 'phone', x ->> 'phone', 'email', x ->> 'email', 'remarks', x ->> 'remarks')) from jsonb_array_elements(v_clean) x),
      p_hash, true);
    if not coalesce((v_list ->> 'committed')::boolean, false) then raise exception 'VALIDATION_ERROR: The sheet could not be assigned to the Telecaller.' using errcode = 'P0001'; end if;
    insert into public.sales_lead_sheets (department_id, uploaded_by, assigned_to, mode, telecaller_list_id, file_name, note, content_hash, total_rows, valid_count, invalid_count, duplicate_count)
    values (v_dept, private.my_id(), a.id, 'TELECALLER', (v_list ->> 'listId')::uuid, btrim(p_file_name),
            nullif(btrim(coalesce(p_note, '')), ''), p_hash, jsonb_array_length(p_rows), v_valid, v_invalid, v_dup)
    returning id into v_sheet;
    perform private.write_audit('SALES_LEAD_SHEET_ASSIGNED', 'sales_lead_sheet', v_sheet, v_dept, a.team_id,
      jsonb_build_object('assignee', a.id, 'mode', 'TELECALLER', 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup));
  end if;
  return jsonb_build_object('committed', v_sheet is not null, 'sheetId', v_sheet, 'mode', 'TELECALLER', 'alreadyAssigned', v_exists,
    'assignee', jsonb_build_object('id', a.id, 'name', a.full_name, 'role', 'Telecaller', 'team', v_team.name),
    'issues', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_issues) x limit 300) q),
    'summary', jsonb_build_object('rows', jsonb_array_length(p_rows), 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup),
    'preview', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_clean) x limit 25) q));
end $$;
revoke all on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) to authenticated;
