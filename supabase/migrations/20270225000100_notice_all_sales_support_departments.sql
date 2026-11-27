-- =============================================================================
-- Notice Board: "All Sales Departments" / "All Support Departments" (docs/NOTICE_BOARD.md). Run after 20270224000100_notice_sales_support_audience.sql.
-- Additive and safe to run twice.
--
-- * Send Notice > Sales (Support) > department: besides one department, "All Sales Departments" ("All Support Departments").
-- * STORED as audience_type SALES / SUPPORT with NO department (audience_departments = '{}') and no ticked employees. The publisher must ask for it
--   explicitly (allDepartments: true); an empty choice without it is still refused, so nobody reaches every department by forgetting to choose one.
-- * WHO: every department of that function as the database knows it when the notice is released (private.notice_division_departments: a Sales /
--   Support team or side; nothing hard-coded), and in each the same people as a one-department notice. Sales-only people never get a Support notice
--   and the reverse; a head who works in several of them is one recipient (one row per person, primary key).
-- * Everything else (who may publish, visibility, edit, delete, bell, push, acknowledgements) is unchanged. Existing notices keep their audience:
--   no Sales / Support notice was ever stored without a department before this migration.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The people an audience means (copy of 20270224000100; the SALES / SUPPORT branches also take "all departments")
-- ---------------------------------------------------------------------------
create or replace function private.notice_audience(p_type text, p_departments uuid[], p_roles text[], p_employees uuid[], p_publisher uuid)
returns table (profile_id uuid) language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE' and p.id <> p_publisher
     and case p_type
           when 'COMPANY' then true
           when 'DEPARTMENT' then private.base_department(p.department_id) = any (p_departments)
           when 'ROLE' then (cardinality(p_departments) = 0 or private.base_department(p.department_id) = any (p_departments))
                            and (p.role::text = any (p_roles)
                                 or ('OPERATIONS_HEAD' = any (p_roles) and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head)
                                 or ('HR' = any (p_roles) and exists (select 1 from public.departments d where d.id = p.department_id and d.slug = 'hr')))
           when 'EMPLOYEES' then p.id = any (p_employees)
           -- (20270224000100) one function of one department, optionally only the ticked people of it
           -- (20270225000100) no department stored = "All Sales Departments": every Sales department as it is when the notice is released
           when 'SALES' then p.id in (select m.profile_id from (select unnest(p_departments) union select dd.department_id from private.notice_division_departments('SALES') dd
                                                                 where cardinality(p_departments) = 0) x(id)
                                      cross join lateral private.notice_division_members(x.id, 'SALES') m)
                             and (cardinality(p_employees) = 0 or p.id = any (p_employees))
           when 'SUPPORT' then p.id in (select m.profile_id from (select unnest(p_departments) union select dd.department_id from private.notice_division_departments('SUPPORT') dd
                                                                   where cardinality(p_departments) = 0) x(id)
                                        cross join lateral private.notice_division_members(x.id, 'SUPPORT') m)
                               and (cardinality(p_employees) = 0 or p.id = any (p_employees))
           else false end
$$;

-- ---------------------------------------------------------------------------
-- 2. Publishing (copy of 20270224000100; changed where marked 20270225000100)
-- ---------------------------------------------------------------------------
create or replace function public.notice_publish(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_role text := private.notice_publisher_role();
  v_key text := nullif(btrim(coalesce(p ->> 'clientRequestId', '')), '');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_body text := btrim(coalesce(p ->> 'body', ''));
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'GENERAL');
  v_pri text := coalesce(nullif(p ->> 'priority', ''), 'NORMAL');
  v_type text := coalesce(nullif(p ->> 'audienceType', ''), '');
  v_depts uuid[] := private.notice_uuid_array(p -> 'departmentIds');
  v_emps uuid[] := private.notice_uuid_array(p -> 'employeeIds');
  -- (20270225000100) "All Sales Departments" / "All Support Departments": asked for explicitly, never assumed from an empty choice
  v_all boolean := coalesce((p ->> 'allDepartments')::boolean, false);
  v_roles text[];
  v_files uuid[] := private.notice_uuid_array(p -> 'attachmentIds');
  v_publish timestamptz := coalesce(nullif(p ->> 'publishAt', '')::timestamptz, now());
  v_expires timestamptz := nullif(p ->> 'expiresAt', '')::timestamptz;
  v_n integer;
  n public.company_notices;
  x jsonb := '{}'::jsonb;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  perform private.notice_check_scope(v_role, me.id, v_type, v_depts, v_emps);   -- refuses anyone who may not publish
  if v_key is null or length(v_key) not between 8 and 80 then
    raise exception 'VALIDATION_ERROR: Invalid request id.' using errcode = '22023';
  end if;
  -- the same form sent twice: the first notice, nothing new
  select * into n from public.company_notices where publisher_id = me.id and client_request_id = v_key;
  if n.id is not null then
    return private.notice_json(n, true) || jsonb_build_object('duplicate', true);
  end if;
  select coalesce(array_agg(distinct rl), '{}') into v_roles from jsonb_array_elements_text(coalesce(p -> 'roles', '[]'::jsonb)) rl;
  if length(v_title) not between 3 and 200 then raise exception 'VALIDATION_ERROR: Give the notice a title (3-200 characters).' using errcode = '22023'; end if;
  if length(v_body) not between 1 and 10000 then raise exception 'VALIDATION_ERROR: Write the notice (up to 10000 characters).' using errcode = '22023'; end if;
  if v_cat not in ('GENERAL', 'HR', 'POLICY', 'EVENT', 'HOLIDAY', 'IT_SYSTEM', 'OPERATIONS', 'OTHER') then raise exception 'VALIDATION_ERROR: Choose a category.' using errcode = '22023'; end if;
  if v_pri not in ('NORMAL', 'IMPORTANT', 'URGENT') then raise exception 'VALIDATION_ERROR: Choose Normal, Important or Urgent.' using errcode = '22023'; end if;
  if v_type not in ('COMPANY', 'DEPARTMENT', 'ROLE', 'EMPLOYEES', 'SALES', 'SUPPORT') then raise exception 'VALIDATION_ERROR: Choose who receives the notice.' using errcode = '22023'; end if;
  if v_type = 'DEPARTMENT' and cardinality(v_depts) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one department.' using errcode = '22023'; end if;
  if v_type = 'ROLE' and (cardinality(v_roles) = 0 or not (v_roles <@ array['DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER', 'HR', 'SUPER_ADMIN'])) then
    raise exception 'VALIDATION_ERROR: Choose at least one designation.' using errcode = '22023';
  end if;
  if v_type = 'EMPLOYEES' and cardinality(v_emps) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one employee.' using errcode = '22023'; end if;
  if exists (select 1 from unnest(v_depts) d where not exists (select 1 from public.departments x where x.id = d)) then
    raise exception 'VALIDATION_ERROR: Choose the departments from the list.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_emps) e where not exists (select 1 from public.profiles x where x.id = e and x.status = 'ACTIVE')) then
    raise exception 'VALIDATION_ERROR: Choose the employees from the list.' using errcode = '22023';
  end if;
  -- (20270224000100) Sales / Support: one department of that function; ticked people only from its function
  if v_all and v_type not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: "All departments" is only for a Sales or Support notice.' using errcode = '22023';
  end if;
  if v_all then
    -- every department of the function, resolved from the database when the notice is released; no single department, no ticked people
    if cardinality(v_depts) > 0 or cardinality(v_emps) > 0 then
      raise exception 'VALIDATION_ERROR: Send to all % departments, or choose one department (not both).', initcap(v_type) using errcode = '22023';
    end if;
  elsif v_type in ('SALES', 'SUPPORT') then
    if cardinality(v_depts) <> 1 then
      raise exception 'VALIDATION_ERROR: Choose one % department.', initcap(v_type) using errcode = '22023';
    end if;
    if not exists (select 1 from private.notice_division_departments(v_type) dd where dd.department_id = v_depts[1]) then
      raise exception 'VALIDATION_ERROR: This is not a % department. Choose one from the list.', initcap(v_type) using errcode = '22023';
    end if;
    if exists (select 1 from unnest(v_emps) e where e not in (select m.profile_id from private.notice_division_members(v_depts[1], v_type) m)) then
      raise exception 'VALIDATION_ERROR: Choose only employees of the selected % department.', initcap(v_type) using errcode = '22023';
    end if;
  end if;
  if v_publish < now() - interval '5 minutes' or v_publish > now() + interval '366 days' then
    raise exception 'VALIDATION_ERROR: The publish date is now or within a year.' using errcode = '22023';
  end if;
  if v_expires is not null and v_expires <= greatest(v_publish, now()) then
    raise exception 'VALIDATION_ERROR: The expiry is after the publish date.' using errcode = '22023';
  end if;
  if cardinality(v_files) > 5 then raise exception 'VALIDATION_ERROR: Attach at most 5 files.' using errcode = '22023'; end if;
  if cardinality(v_files) > 0 then
    select count(*) into v_n from public.employee_issue_attachments a
     where a.id = any (v_files) and a.uploader_id = me.id and a.status = 'READY' and a.issue_id is null and a.bug_id is null and a.notice_id is null;
    if v_n <> cardinality(v_files) then
      raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = '22023';
    end if;
  end if;
  if not exists (select 1 from private.notice_audience(v_type, v_depts, v_roles, v_emps, me.id)) then
    raise exception 'VALIDATION_ERROR: Nobody is in this audience. Choose other departments, designations or employees.' using errcode = '22023';
  end if;

  insert into public.company_notices (reference, title, body, category, priority, audience_type, audience_departments, audience_roles, audience_employees,
                                      publisher_id, publisher_role, publish_at, expires_at, client_request_id)
  values ('NTC-' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY') || '-' || lpad(nextval('public.company_notice_ref_seq')::text, 5, '0'),
          v_title, v_body, v_cat, v_pri, v_type,
          case when v_type in ('DEPARTMENT', 'ROLE', 'SALES', 'SUPPORT') then v_depts else '{}' end, case when v_type = 'ROLE' then v_roles else '{}' end,
          case when v_type in ('EMPLOYEES', 'SALES', 'SUPPORT') then v_emps else '{}' end,
          me.id, v_role, greatest(v_publish, now()), v_expires, v_key)
  on conflict (publisher_id, client_request_id) do nothing
  returning * into n;
  if n.id is null then
    select * into n from public.company_notices where publisher_id = me.id and client_request_id = v_key;
    return private.notice_json(n, true) || jsonb_build_object('duplicate', true);
  end if;
  if cardinality(v_files) > 0 then
    update public.employee_issue_attachments set notice_id = n.id where id = any (v_files);
  end if;
  insert into public.company_notice_revisions (notice_id, version, action, edited_by, after)
  values (n.id, 1, 'PUBLISHED', me.id, jsonb_build_object('title', n.title, 'body', n.body, 'category', n.category, 'priority', n.priority, 'expiresAt', n.expires_at,
          'audience', n.audience_type));
  perform private.write_audit('COMPANY_NOTICE_PUBLISHED', 'company_notice', n.id, me.department_id, me.team_id,
    jsonb_build_object('reference', n.reference, 'audience', n.audience_type, 'role', v_role, 'priority', n.priority, 'publishAt', n.publish_at,
                       'departments', to_jsonb(n.audience_departments), 'employees', cardinality(n.audience_employees)));
  if n.publish_at <= now() then
    x := private.notice_release(n.id, coalesce((p ->> 'push')::boolean, true));
    select * into n from public.company_notices where id = n.id;
  end if;
  return private.notice_json(n, true) || jsonb_build_object('duplicate', false, 'deliveryIds', coalesce(x -> 'ids', '[]'::jsonb), 'notified', coalesce((x ->> 'notified')::integer, 0));
end $$;

revoke all on function private.notice_audience(text, uuid[], text[], uuid[], uuid) from public, anon, authenticated;
revoke all on function public.notice_publish(jsonb) from public, anon;
grant execute on function public.notice_publish(jsonb) to authenticated;

notify pgrst, 'reload schema';
