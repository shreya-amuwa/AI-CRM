-- =============================================================================
-- Sales CEO -> Sales Department Head lead assignment, the Department Head's received sheets, and the CEO's Crocodial access.
--
-- The bug: a Sales CEO (a Department Head with is_operations_head, shown as "CEO") opening Leads -> Lead Assign was offered the Team Leads of
-- their active department, never the Sales Department Heads, because sales_lead_assignees / sales_lead_sheet_assign only knew the active
-- department (private.my_department_id) and the team join.
--
--  * private.is_sales_ceo(): an active CEO with at least one scope covering SALES (a Support-only CEO is not one).
--  * private.sales_assign_departments(): where the caller may assign Sales leads: a Sales CEO -> every base department their scopes cover
--    for SALES; a Sales Department Head -> their active department (as before).
--  * private.sales_dept_heads(p_department): the active, non-CEO Department Heads whose own (home) department is p_department and whose
--    scope covers SALES there. A head whose home is another department is left out: their leads would land in that other department.
--  * sales_lead_assignees(): unchanged for a Department Head. A Sales CEO also gets the Sales Department Heads of every department they cover
--    (role "Department Head", with the department), first in the list. Every row now carries its department.
--  * sales_lead_sheet_assign(): the department is the recipient's, never sent by the browser: a Department Head recipient only for a Sales
--    CEO whose scope covers that department; the rest as before (a CEO may also give leads to the Sales Team Leads / Team Members of any
--    department they cover). Deduplication, the same-file check, the sheet row, the notification and the audit entry use that department.
--  * sales_sheets_received() / sales_sheet_forward(): a Department Head sees the sheets given to them (who, when, how many are still open)
--    and forwards the open leads of one to a Sales Team Lead or Team Member of that department (the existing owner rules still apply).
--  * private.can_assign_customer_owner(): also true, inside one of the functions above only, for a head whose scope covers the owner's
--    department for SALES (the department chosen by the function, never by the browser).
--  * croc_refresh_capabilities(): "rollout" is also true for a Department Head / CEO whose SALES scope covers a rolled-out department (it
--    looked at the home department only), plus "eligible" and "enabledDepartments" so the dashboards keep the Crocodial menu even when
--    nobody is connected yet.
--
-- Additive and safe to run twice. Nothing is deleted. Run after 20270302000100_ai_studio_hr_performance.sql.
-- =============================================================================

create or replace function private.is_sales_ceo()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head)
     and exists (select 1 from private.scopes_of(auth.uid()) s where s.division is null or s.division = 'SALES')
$$;
revoke all on function private.is_sales_ceo() from public, anon;
grant execute on function private.is_sales_ceo() to authenticated, service_role;

create or replace function private.sales_assign_departments()
returns table (department_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct s.department_id from private.scopes_of(auth.uid()) s
   where private.is_sales_ceo() and (s.division is null or s.division = 'SALES')
  union
  select private.my_department_id() where private.is_sales_head() or (private.my_role() = 'DEPARTMENT_HEAD' and private.dept_is_unified(private.my_department_id()))
$$;
revoke all on function private.sales_assign_departments() from public, anon;
grant execute on function private.sales_assign_departments() to authenticated, service_role;

create or replace function private.require_sales_assigner()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_sales_ceo() then perform private.require_sales_head(); end if;
end $$;
revoke all on function private.require_sales_assigner() from public, anon;
grant execute on function private.require_sales_assigner() to authenticated, service_role;

create or replace function private.sales_dept_heads(p_department uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head
     and private.base_department(p.department_id) = p_department
     and private.scope_covers(p.id, p_department, 'SALES')
     and private.lead_team_of(p.id) is not null
$$;
revoke all on function private.sales_dept_heads(uuid) from public, anon;
grant execute on function private.sales_dept_heads(uuid) to authenticated, service_role;

-- A head may make someone the owner of a lead in a department their SALES scope covers, but only while one of the functions below has
-- chosen that department (the setting is local to the transaction and cannot be set through the API).
create or replace function private.can_assign_customer_owner(p_owner uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_owner public.profiles;
  v_assign text := nullif(current_setting('app.sales_assign_department', true), '');
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into v_owner from public.profiles where id = p_owner and status = 'ACTIVE';
  if v_me.id is null or v_owner.id is null or (v_owner.team_id is null and private.lead_team_of(v_owner.id) is null) then
    return false;
  end if;
  if v_me.role = 'DEPARTMENT_HEAD' and v_assign is not null
     and private.base_department(v_owner.department_id)::text = v_assign
     and private.scope_covers(v_me.id, v_assign::uuid, 'SALES') then
    return true;
  end if;
  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then v_owner.department_id = private.scoped_department(v_me.id, v_me.department_id)
    when 'TEAM_HEAD' then v_owner.team_id = v_me.team_id
    when 'TEAM_MEMBER' then v_owner.id = v_me.id
    else false
  end;
end $$;

create or replace function private.sales_assignee_role(p public.profiles)
returns text language sql stable security definer set search_path = '' as $$
  select case when p.role = 'DEPARTMENT_HEAD' then 'Department Head' when p.sales_sub_role = 'TELECALLER' then 'Telecaller'
              when p.role = 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end
$$;
revoke all on function private.sales_assignee_role(public.profiles) from public, anon, authenticated;

create or replace function public.sales_lead_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ceo boolean := private.is_sales_ceo();
begin
  perform private.require_sales_assigner();
  return coalesce((select jsonb_agg(x order by x ->> 'sortKey', x ->> 'name') from (
    -- Sales Department Heads (a Sales CEO only)
    select jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'team', null, 'teamId', null, 'role', 'Department Head', 'kind', 'DEPARTMENT_HEAD',
        'subRole', p.sales_sub_role, 'mode', 'LEADS', 'openContacts', 0,
        'openLeads', (select count(*) from public.customers c where c.owner_id = p.id and c.lifecycle_stage = 'LEAD'),
        'departmentId', d.id, 'department', d.name, 'sortKey', '0' || d.name) as x
      from private.sales_assign_departments() a
      join public.departments d on d.id = a.department_id
      join private.sales_dept_heads(a.department_id) h on true
      join public.profiles p on p.id = h.profile_id
     where v_ceo and p.id <> auth.uid()
    union all
    -- the Sales Team Leads, Team Members and Telecallers (as before: the active department; a Sales CEO: every department they cover)
    select jsonb_build_object(
        'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
        'kind', case when p.sales_sub_role = 'TELECALLER' then 'TELECALLER' when p.role = 'TEAM_HEAD' then 'TEAM_LEAD' else 'TEAM_MEMBER' end,
        'subRole', p.sales_sub_role, 'mode', case when p.sales_sub_role = 'TELECALLER' then 'TELECALLER' else 'LEADS' end,
        'openContacts', case when p.sales_sub_role = 'TELECALLER'
          then (select count(*) from public.telecaller_contacts c where c.assigned_to = p.id and c.call_status = 'PENDING') else 0 end,
        'openLeads', (select count(*) from public.customers c where c.owner_id = p.id and c.lifecycle_stage = 'LEAD'),
        'departmentId', d.id, 'department', d.name,
        'sortKey', case when p.sales_sub_role = 'TELECALLER' then '3' when p.role = 'TEAM_HEAD' then '1' else '2' end || d.name)
      from public.profiles p
      join public.teams t on t.id = p.team_id
      join public.departments d on d.id = p.department_id
     where p.status = 'ACTIVE' and t.division = 'SALES'
       and (p.role = 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and (p.sales_sub_role is null or p.sales_sub_role = 'TELECALLER')))
       and (p.department_id = private.my_department_id()
            or (v_ceo and p.sales_sub_role is distinct from 'TELECALLER' and p.department_id in (select department_id from private.sales_assign_departments())))
  ) q), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_assignees() from public, anon;
grant execute on function public.sales_lead_assignees() to authenticated;

-- Check the rows of a sheet and, with p_commit, give the valid ones to the chosen person. p_rows: [{"row":2,"name","company","phone","email","remarks"}].
create or replace function public.sales_lead_sheet_assign(p_assignee uuid, p_file_name text, p_note text, p_rows jsonb, p_hash text, p_commit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles;
  v_team public.teams;
  v_ceo boolean := private.is_sales_ceo();
  v_dept uuid;
  v_head boolean := false;
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
  v_me_name text := (select full_name from public.profiles where id = auth.uid());
begin
  perform private.require_sales_assigner();
  select * into a from public.profiles where id = p_assignee;
  if a.id is not null and a.role = 'DEPARTMENT_HEAD' then
    -- a Sales Department Head: only for a Sales CEO, in a department their scope covers (the department is the head's own)
    v_dept := private.base_department(a.department_id);
    if not v_ceo or a.id = auth.uid()
       or v_dept not in (select department_id from private.sales_assign_departments())
       or a.id not in (select profile_id from private.sales_dept_heads(v_dept)) then
      raise exception 'VALIDATION_ERROR: Choose an active Sales Department Head of a department you cover.' using errcode = 'P0001';
    end if;
    v_head := true;
  else
    select * into v_team from public.teams where id = a.team_id;
    if a.id is null or a.status <> 'ACTIVE' or v_team.division is distinct from 'SALES'
       or not (a.role = 'TEAM_HEAD' or (a.role = 'TEAM_MEMBER' and (a.sales_sub_role is null or a.sales_sub_role = 'TELECALLER')))
       or not (a.department_id = private.my_department_id()
               or (v_ceo and a.sales_sub_role is distinct from 'TELECALLER' and a.department_id in (select department_id from private.sales_assign_departments()))) then
      raise exception 'VALIDATION_ERROR: Choose an active Sales Team Lead, Team Member or Telecaller of your department.' using errcode = 'P0001';
    end if;
    v_dept := a.department_id;
  end if;
  v_mode := case when a.sales_sub_role = 'TELECALLER' and not v_head then 'TELECALLER' else 'LEADS' end;
  if length(btrim(coalesce(p_file_name, ''))) < 1 or length(p_file_name) > 200 then raise exception 'VALIDATION_ERROR: The file name is missing.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'VALIDATION_ERROR: The sheet has no contact rows.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'VALIDATION_ERROR: A sheet can have at most 2,000 contacts.' using errcode = 'P0001'; end if;
  if length(coalesce(p_hash, '')) < 16 then raise exception 'VALIDATION_ERROR: The sheet could not be identified.' using errcode = 'P0001'; end if;

  -- what the CRM already knows in that department (one query, not one per row)
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

  -- one upload of a file at a time per department (a double click or a retry must not import it twice)
  if p_commit then perform pg_advisory_xact_lock(hashtext('sales_lead_sheet:' || v_dept::text || ':' || p_hash)); end if;
  select exists (select 1 from public.sales_lead_sheets s where s.department_id = v_dept and s.content_hash = p_hash) into v_exists;
  if p_commit and v_exists then raise exception 'CONFLICT: This sheet has already been uploaded and assigned.' using errcode = 'P0001'; end if;
  if p_commit and v_valid = 0 then raise exception 'VALIDATION_ERROR: The sheet has no valid contact to assign. Fix the rows listed and upload it again.' using errcode = 'P0001'; end if;

  if p_commit then
    if v_mode = 'TELECALLER' then
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
      perform set_config('app.sales_assign_department', v_dept::text, true);
      with ins as (
        insert into public.customers (owner_id, lifecycle_stage, lead_status, name, company, phone, email, lead_source, call_status, notes, source_sheet_id)
        select a.id, 'LEAD', 'NEW', x ->> 'name', x ->> 'company', x ->> 'phone', x ->> 'email', 'Excel sheet', 'PENDING', x ->> 'remarks', v_sheet
          from jsonb_array_elements(v_clean) x
        returning id)
      insert into public.customer_activities (customer_id, actor_id, type, note)
      select id, private.my_id(), 'LEAD_CREATED',
             'Lead added from the sheet ' || btrim(p_file_name) || case when v_head then ' (assigned by ' || coalesce(v_me_name, 'the CEO') || ')' else '' end from ins;
      perform set_config('app.sales_assign_department', '', true);
      perform private.notify(a.id, 'LEAD_SHEET_ASSIGNED', format('New leads: %s', btrim(p_file_name)),
        format('%s lead%s from a sheet were assigned to you%s.', v_valid, case when v_valid = 1 then '' else 's' end,
               case when v_head then ' by ' || coalesce(v_me_name, 'the CEO') else '' end), 'sales_lead_sheet', v_sheet);
      if a.role = 'TEAM_MEMBER' then
        for v_lead in select p.id from public.profiles p
                       where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and p.team_id = a.team_id and p.id <> private.my_id() and private.led_by(p.id, a.id) loop
          perform private.notify(v_lead, 'LEAD_SHEET_ASSIGNED', format('New leads for %s', a.full_name),
            format('%s lead%s from the sheet %s were assigned to %s.', v_valid, case when v_valid = 1 then '' else 's' end, btrim(p_file_name), a.full_name), 'sales_lead_sheet', v_sheet);
        end loop;
      end if;
    end if;
    perform private.write_audit('SALES_LEAD_SHEET_ASSIGNED', 'sales_lead_sheet', v_sheet, v_dept, a.team_id,
      jsonb_build_object('assignee', a.id, 'assigneeRole', private.sales_assignee_role(a), 'mode', v_mode, 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup,
                         'byCeo', v_ceo));
  end if;
  return jsonb_build_object('committed', v_sheet is not null, 'sheetId', v_sheet, 'mode', v_mode, 'alreadyAssigned', v_exists,
    'assignee', jsonb_build_object('id', a.id, 'name', a.full_name, 'role', private.sales_assignee_role(a), 'team', v_team.name,
                                   'departmentId', v_dept, 'department', (select name from public.departments where id = v_dept)),
    'issues', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_issues) x limit 300) q),
    'summary', jsonb_build_object('rows', jsonb_array_length(p_rows), 'valid', v_valid, 'invalid', v_invalid, 'duplicates', v_dup),
    'preview', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select x from jsonb_array_elements(v_clean) x limit 25) q));
end $$;
revoke all on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) from public, anon;
grant execute on function public.sales_lead_sheet_assign(uuid, text, text, jsonb, text, boolean) to authenticated;

-- a sheet the caller may manage: one of their assignment departments, or one they uploaded themselves
create or replace function private.sales_sheet_visible(s public.sales_lead_sheets)
returns boolean language sql stable security definer set search_path = '' as $$
  select s.department_id in (select department_id from private.sales_assign_departments()) or s.uploaded_by = auth.uid()
$$;
revoke all on function private.sales_sheet_visible(public.sales_lead_sheets) from public, anon, authenticated;

create or replace function public.sales_lead_sheet_issues(p_sheet uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sales_lead_sheets;
begin
  perform private.require_sales_assigner();
  select * into s from public.sales_lead_sheets where id = p_sheet;
  if s.id is null or not private.sales_sheet_visible(s) then
    raise exception 'NOT_FOUND: Lead sheet not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', s.id, 'fileName', s.file_name, 'kept', s.issues is not null, 'issues', coalesce(s.issues, '[]'::jsonb));
end $$;
revoke all on function public.sales_lead_sheet_issues(uuid) from public, anon;
grant execute on function public.sales_lead_sheet_issues(uuid) to authenticated;

create or replace function public.sales_lead_sheet_source_begin(p_sheet uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.sales_lead_sheets;
begin
  perform private.require_sales_assigner();
  select * into s from public.sales_lead_sheets where id = p_sheet;
  if s.id is null or s.uploaded_by is distinct from private.my_id() or not private.sales_sheet_visible(s) then
    raise exception 'NOT_FOUND: Lead sheet not found.' using errcode = 'P0001';
  end if;
  if s.source_stored_at is not null then raise exception 'CONFLICT: The original file is already stored.' using errcode = 'P0001'; end if;
  return jsonb_build_object('id', s.id, 'fileName', s.file_name, 'departmentId', s.department_id, 'contentHash', s.content_hash);
end $$;
revoke all on function public.sales_lead_sheet_source_begin(uuid) from public, anon;
grant execute on function public.sales_lead_sheet_source_begin(uuid) to authenticated;

create or replace function public.sales_lead_sheets_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_assigner();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'fileName', s.file_name, 'note', s.note, 'mode', s.mode, 'uploadedAt', s.uploaded_at, 'assignedAt', s.assigned_at,
      'uploadedBy', (select u.full_name from public.profiles u where u.id = s.uploaded_by), 'assigneeId', s.assigned_to,
      'assignedTo', (select t.full_name from public.profiles t where t.id = s.assigned_to),
      'assigneeRole', (select private.sales_assignee_role(t) from public.profiles t where t.id = s.assigned_to),
      'departmentId', s.department_id, 'department', (select d.name from public.departments d where d.id = s.department_id),
      'rows', s.total_rows, 'valid', s.valid_count, 'invalid', s.invalid_count, 'duplicates', s.duplicate_count, 'status', s.status,
      'hasSourceFile', s.source_stored_at is not null, 'issuesKept', s.issues is not null,
      'leadsNow', case when s.mode = 'LEADS' then (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage = 'LEAD') end,
      'converted', case when s.mode = 'LEADS' then (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage <> 'LEAD') end,
      'contactsPending', case when s.mode = 'TELECALLER' then (select count(*) from public.telecaller_contacts c where c.list_id = s.telecaller_list_id and c.call_status = 'PENDING') end,
      'contactsCalled', case when s.mode = 'TELECALLER' then (select count(*) from public.telecaller_contacts c where c.list_id = s.telecaller_list_id and c.call_status <> 'PENDING') end
    ) order by s.uploaded_at desc)
    from public.sales_lead_sheets s where private.sales_sheet_visible(s)), '[]'::jsonb);
end $$;
revoke all on function public.sales_lead_sheets_list() from public, anon;
grant execute on function public.sales_lead_sheets_list() to authenticated;

-- ---------------------------------------------------------------------------
-- The Department Head's side: sheets given to them, and forwarding their open leads
-- ---------------------------------------------------------------------------
create or replace function public.sales_sheets_received()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: This page is for Department Heads.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'fileName', s.file_name, 'note', s.note, 'assignedAt', s.assigned_at,
      'assignedBy', (select u.full_name from public.profiles u where u.id = s.uploaded_by),
      'assignedByRole', (select case when u.is_operations_head then 'CEO' else private.sales_assignee_role(u) end from public.profiles u where u.id = s.uploaded_by),
      'departmentId', s.department_id, 'department', (select d.name from public.departments d where d.id = s.department_id),
      'valid', s.valid_count,
      'openWithMe', (select count(*) from public.customers c where c.source_sheet_id = s.id and c.owner_id = auth.uid() and c.lifecycle_stage = 'LEAD'),
      'forwarded', (select count(*) from public.customers c where c.source_sheet_id = s.id and c.owner_id <> auth.uid()),
      'converted', (select count(*) from public.customers c where c.source_sheet_id = s.id and c.lifecycle_stage <> 'LEAD')
    ) order by s.assigned_at desc)
    from public.sales_lead_sheets s where s.assigned_to = auth.uid() and s.mode = 'LEADS'), '[]'::jsonb);
end $$;
revoke all on function public.sales_sheets_received() from public, anon;
grant execute on function public.sales_sheets_received() to authenticated;

-- Forward the open leads of a sheet the caller received (still owned by them, still leads) to a Sales Team Lead or Team Member of the sheet's
-- department. p_count: how many (the oldest rows first); null = all. The customer records stay the same rows: only the owner changes.
create or replace function public.sales_sheet_forward(p_sheet uuid, p_assignee uuid, p_count integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.sales_lead_sheets;
  a public.profiles;
  t public.teams;
  v_moved integer;
begin
  select * into s from public.sales_lead_sheets where id = p_sheet for update;
  if s.id is null or s.assigned_to is distinct from auth.uid() or s.mode <> 'LEADS'
     or not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD') then
    raise exception 'NOT_FOUND: Lead sheet not found.' using errcode = 'P0001';
  end if;
  if not private.scope_covers(auth.uid(), s.department_id, 'SALES') then
    raise exception 'FORBIDDEN: You no longer cover Sales in this department.' using errcode = '42501';
  end if;
  select * into a from public.profiles where id = p_assignee;
  select * into t from public.teams where id = a.team_id;
  if a.id is null or a.status <> 'ACTIVE' or t.division is distinct from 'SALES' or a.department_id is distinct from s.department_id
     or not (a.role = 'TEAM_HEAD' or (a.role = 'TEAM_MEMBER' and a.sales_sub_role is null)) then
    raise exception 'VALIDATION_ERROR: Choose an active Sales Team Lead or Team Member of %.', (select name from public.departments where id = s.department_id) using errcode = 'P0001';
  end if;
  if p_count is not null and (p_count < 1 or p_count > 2000) then raise exception 'VALIDATION_ERROR: Choose how many leads to forward (1 to 2,000).' using errcode = 'P0001'; end if;

  perform set_config('app.sales_assign_department', s.department_id::text, true);
  with picked as (
    select c.id from public.customers c
     where c.source_sheet_id = s.id and c.owner_id = auth.uid() and c.lifecycle_stage = 'LEAD'
     order by c.created_at, c.id limit coalesce(p_count, 2000)
     for update),
  moved as (update public.customers c set owner_id = a.id from picked where c.id = picked.id returning c.id)
  insert into public.customer_activities (customer_id, actor_id, type, note)
  select id, auth.uid(), 'LEAD_FORWARDED', 'Forwarded to ' || a.full_name || ' from the sheet ' || s.file_name from moved;
  get diagnostics v_moved = row_count;
  perform set_config('app.sales_assign_department', '', true);
  if v_moved = 0 then raise exception 'VALIDATION_ERROR: There are no open leads of this sheet with you to forward.' using errcode = 'P0001'; end if;

  perform private.notify(a.id, 'LEAD_SHEET_ASSIGNED', format('New leads: %s', s.file_name),
    format('%s lead%s from the sheet %s were forwarded to you.', v_moved, case when v_moved = 1 then '' else 's' end, s.file_name), 'sales_lead_sheet', s.id);
  perform private.write_audit('SALES_LEAD_SHEET_FORWARDED', 'sales_lead_sheet', s.id, s.department_id, a.team_id,
    jsonb_build_object('assignee', a.id, 'count', v_moved));
  return jsonb_build_object('moved', v_moved, 'assignee', jsonb_build_object('id', a.id, 'name', a.full_name, 'role', private.sales_assignee_role(a)));
end $$;
revoke all on function public.sales_sheet_forward(uuid, uuid, integer) from public, anon;
grant execute on function public.sales_sheet_forward(uuid, uuid, integer) to authenticated;

-- the Sales Team Leads / Team Members a Department Head can forward a received sheet to
create or replace function public.sales_forward_assignees(p_sheet uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.sales_lead_sheets;
begin
  select * into s from public.sales_lead_sheets where id = p_sheet;
  if s.id is null or s.assigned_to is distinct from auth.uid() then raise exception 'NOT_FOUND: Lead sheet not found.' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name, 'role', private.sales_assignee_role(p),
                     'openLeads', (select count(*) from public.customers c where c.owner_id = p.id and c.lifecycle_stage = 'LEAD'))
                     order by case when p.role = 'TEAM_HEAD' then 0 else 1 end, p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and t.division = 'SALES' and p.department_id = s.department_id
     and (p.role = 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and p.sales_sub_role is null))), '[]'::jsonb);
end $$;
revoke all on function public.sales_forward_assignees(uuid) from public, anon;
grant execute on function public.sales_forward_assignees(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Crocodial: the CEO's (and a multi-department head's) rollout check, and the menu's "eligible"
-- ---------------------------------------------------------------------------
create or replace function private.croc_enabled_sales_departments()
returns table (department_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select distinct d.id, d.name
    from public.departments d
    join public.crocodial_rollout ro on ro.department_id = d.id and ro.division = 'SALES' and ro.allowed
    join public.crocodial_department_links l on l.department_id = d.id and l.division = 'SALES' and l.enabled
    join public.crocodial_connections c on c.id = l.connection_id and c.enabled
   where private.croc_caller_active()
     and (private.my_role() = 'SUPER_ADMIN'
          or (private.my_role() = 'DEPARTMENT_HEAD' and exists (select 1 from private.scopes_of(auth.uid()) s
                                                                where s.department_id = d.id and (s.division is null or s.division = 'SALES')))
          or exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                      where p.id = auth.uid() and p.department_id = d.id and t.division::text = 'SALES'))
$$;
revoke all on function private.croc_enabled_sales_departments() from public, anon;
grant execute on function private.croc_enabled_sales_departments() to authenticated, service_role;

create or replace function public.croc_refresh_capabilities()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_kind text;
  v_self text;
  v_self_last timestamptz;
  v_team integer := 0;
  v_depts jsonb := '[]'::jsonb;
  v_all integer := 0;
  v_recent public.crocodial_refresh_requests;
  v_rollout boolean;
  v_enabled jsonb;
begin
  if v_me is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  v_kind := coalesce(private.croc_viewer_kind(), 'EMPLOYEE');
  if not private.croc_caller_active() then
    return jsonb_build_object('kind', v_kind, 'active', false, 'rollout', false, 'eligible', false, 'enabledDepartments', '[]'::jsonb,
                              'self', jsonb_build_object('state', 'NOT_ENABLED'), 'team', null, 'departments', '[]'::jsonb, 'all', null, 'recent', null);
  end if;
  -- Crocodial is switched on for a Sales department the caller works in or covers (home department, team, or a head's / CEO's scopes)
  select coalesce(jsonb_agg(jsonb_build_object('departmentId', e.department_id, 'name', e.name) order by e.name), '[]'::jsonb)
    into v_enabled from private.croc_enabled_sales_departments() e;
  v_rollout := jsonb_array_length(v_enabled) > 0;

  if exists (select 1 from private.croc_refresh_people('SELF')) then
    v_self := 'CONNECTED';
    select min(f.o_last_ok) into v_self_last from private.croc_refresh_people('SELF') x, private.croc_connection_freshness(x.connection_id) f;
  elsif exists (select 1 from public.crocodial_employee_mappings m where m.profile_id = v_me and m.status = 'PENDING') then
    v_self := 'PENDING_APPROVAL';
  elsif exists (select 1 from public.crocodial_employee_mappings m where m.profile_id = v_me and m.status = 'APPROVED' and m.ended_at is null) then
    v_self := 'NOT_ENABLED';
  else
    v_self := 'NOT_MAPPED';
  end if;

  if v_kind = 'TEAM_LEAD' then
    select count(distinct profile_id) into v_team from private.croc_refresh_people('TEAM');
  end if;
  if v_kind in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then
    select coalesce(jsonb_agg(jsonb_build_object('departmentId', g.department_id, 'name', d.name, 'people', g.n, 'lastSyncAt', g.last_ok) order by d.name), '[]'::jsonb),
           coalesce(sum(g.n), 0)
      into v_depts, v_all
      from (select x.department_id, count(distinct x.profile_id) as n,
                   (select min(f.o_last_ok) from private.croc_refresh_people('ALL') y, private.croc_connection_freshness(y.connection_id) f
                     where y.department_id = x.department_id) as last_ok
              from private.croc_refresh_people('ALL') x group by x.department_id) g
      join public.departments d on d.id = g.department_id;
  end if;

  select * into v_recent from public.crocodial_refresh_requests
   where requested_by = v_me and requested_at > now() - interval '10 minutes' order by requested_at desc limit 1;

  return jsonb_build_object('kind', v_kind, 'active', true, 'rollout', coalesce(v_rollout, false),
    -- the Crocodial menu: a manager whose Sales departments have Crocodial switched on (even before anyone is connected), or a connected person
    'eligible', v_self = 'CONNECTED' or (v_rollout and v_kind in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN', 'TEAM_LEAD')) or v_team > 0 or v_all > 0,
    'enabledDepartments', case when v_kind in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then v_enabled else '[]'::jsonb end,
    'self', jsonb_build_object('state', v_self, 'lastSyncAt', v_self_last),
    'team', case when v_kind = 'TEAM_LEAD' then jsonb_build_object('people', v_team) end,
    'departments', v_depts,
    'all', case when v_kind in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then jsonb_build_object('people', v_all) end,
    'recent', case when v_recent.id is not null then private.croc_refresh_json(v_recent) end);
end $$;
revoke all on function public.croc_refresh_capabilities() from public, anon;
grant execute on function public.croc_refresh_capabilities() to authenticated;

notify pgrst, 'reload schema';
