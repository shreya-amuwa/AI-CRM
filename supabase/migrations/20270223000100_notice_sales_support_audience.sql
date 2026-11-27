-- =============================================================================
-- Notice Board: "Sales" and "Support" audiences (docs/NOTICE_BOARD.md). Run after 20270222000100_wallet_pin.sql. Additive and safe to run twice.
--
-- Send Notice gets two more audiences next to Entire company / Departments / Designations / Selected employees:
--   SALES    one department's Sales function: every Sales employee of that department, or only the ones the publisher ticks;
--   SUPPORT  the same for its Support function.
--
-- WHICH DEPARTMENTS. Nothing is hard-coded: a department is in the Sales list when it has at least one Sales team (teams.division), in the
--   Support list when it has a Support team or a Support side (departments.facet_of / facet_division, e.g. Wabatalk = D Talk Support). A new
--   department or team appears as soon as it exists. A side (facet) is shown under its base department, as everywhere else in the CRM.
-- WHO IS IN "WABASTORE SALES" (private.notice_division_members):
--   * the active Team Leads / Team Members of a Sales team of that department (their team's division);
--   * the active Department Heads of that department's Sales function: home department with side Sales or no side set (= the whole department),
--     or a Department Head granted that department's Sales function (department_access). A Support head, an HR person, an Operations Head who only
--     supervises the department, or an employee of another department is never in it.
--   The publisher is never a recipient of their own notice (as for every audience).
-- STORED. audience_type 'SALES' / 'SUPPORT', the department in audience_departments (exactly one), the ticked employees in audience_employees
--   (empty = the whole function). Recipients are resolved when the notice is released (at once, or at its publish time), exactly like the other
--   audiences, into company_notice_recipients - so the bell, the push, the unread count, the popup and the acknowledgement all work unchanged and
--   nobody is notified twice (primary key + the bell's dedupe key).
-- CHECKED HERE, not only in the screen: the department must be a Sales (Support) department, and every ticked employee must belong to its Sales
--   (Support) function; otherwise VALIDATION_ERROR. Who may publish is unchanged (Super Admin, HR, the CRM team: private.notice_check_scope).
-- VISIBILITY. Only the recipients read it (plus its publisher and the Super Admin). The other publishers see a whole-function notice in "All company
--   notices" like a department notice; a notice for ticked employees only is, like "Selected employees", not shown to them.
-- Nothing existing is changed: every older notice keeps its type and its recipients; the four existing audiences resolve exactly as before.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The audience type
-- ---------------------------------------------------------------------------
alter table public.company_notices drop constraint if exists company_notices_audience_type_check;
alter table public.company_notices add constraint company_notices_audience_type_check
  check (audience_type in ('COMPANY', 'DEPARTMENT', 'ROLE', 'EMPLOYEES', 'SALES', 'SUPPORT'));

-- ---------------------------------------------------------------------------
-- 2. Which departments are Sales / Support, and who works in one function of one department
-- ---------------------------------------------------------------------------
-- the (base) departments of a function: a team of that division, or a side of that division; the name shows the side when there is one
create or replace function private.notice_division_departments(p_division text)
returns table (department_id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select d.id,
         coalesce((select f.name || ' (' || d.name || ')' from public.departments f where f.facet_of = d.id and f.facet_division = p_division limit 1), d.name)
    from public.departments d
   where d.facet_of is null
     and (exists (select 1 from public.teams t where private.base_department(t.department_id) = d.id and t.division::text = p_division)
          or exists (select 1 from public.departments f where f.facet_of = d.id and f.facet_division = p_division))
$$;

-- the active employees of one function (SALES / SUPPORT) of one base department
create or replace function private.notice_division_members(p_department uuid, p_division text)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  -- Team Leads and Team Members: their team's division
  select p.id from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')
     and private.base_department(t.department_id) = p_department and t.division::text = p_division
  union
  -- Department Heads of that function: home department (a side counts as its base, with the side's function; no side set = the whole department)
  select p.id from public.profiles p join public.departments d on d.id = p.department_id
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
     and coalesce(d.facet_of, d.id) = p_department
     and (coalesce(d.facet_division, p.head_division) is null or coalesce(d.facet_division, p.head_division) = p_division)
  union
  -- ... or granted that department's function (Super Admin > Departments & functions)
  select p.id from public.department_access a join public.profiles p on p.id = a.profile_id
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
     and private.base_department(a.department_id) = p_department and a.division = p_division
$$;

-- ---------------------------------------------------------------------------
-- 3. The people an audience means (copy of 20270131000200; the SALES / SUPPORT branch is new, the others are unchanged)
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
           -- (20270223000100) one function of one department, optionally only the ticked people of it
           when 'SALES' then p.id in (select m.profile_id from unnest(p_departments) x(id) cross join lateral private.notice_division_members(x.id, 'SALES') m)
                             and (cardinality(p_employees) = 0 or p.id = any (p_employees))
           when 'SUPPORT' then p.id in (select m.profile_id from unnest(p_departments) x(id) cross join lateral private.notice_division_members(x.id, 'SUPPORT') m)
                               and (cardinality(p_employees) = 0 or p.id = any (p_employees))
           else false end
$$;

-- ---------------------------------------------------------------------------
-- 4. Who reads it: a notice for ticked employees only is not shown to the other publishers (copy of 20270205000100, one condition changed)
-- ---------------------------------------------------------------------------
create or replace function private.notice_visible(n public.company_notices)
returns boolean language sql stable security definer set search_path = '' as $$
  -- strictly true or false (a NULL here must never let anyone through)
  select coalesce(auth.uid() is not null and n.status <> 'DELETED' and (
    n.publisher_id = auth.uid()
    or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
    or (n.status <> 'SCHEDULED' and exists (select 1 from public.company_notice_recipients r where r.notice_id = n.id and r.profile_id = auth.uid()))
    -- the other publishers see the company's notices (not one addressed to selected employees only)
    -- (20270223000100) nor a Sales / Support notice for ticked employees only
    or (n.status <> 'SCHEDULED' and n.audience_type <> 'EMPLOYEES' and cardinality(n.audience_employees) = 0 and private.notice_publisher_role() is not null)), false)
$$;

-- the read receipts (copy of 20270205000100, the same condition changed)
create or replace function public.notice_receipts(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  n public.company_notices;
begin
  select * into n from public.company_notices where id = p_id;
  -- (20270202000100) the notice managers (Super Admin, HR, CRM team) see the receipts of every company-wide notice, and of their own
  -- (20270205000100) a deleted notice is not found
  -- (20270223000100) a Sales / Support notice for ticked employees only counts as "selected employees"
  if n.id is null or n.status = 'DELETED' or not (n.publisher_id = auth.uid() or coalesce(private.notice_publisher_role() = 'SUPER_ADMIN', false)
                          or (private.notice_publisher_role() is not null and n.audience_type <> 'EMPLOYEES' and cardinality(n.audience_employees) = 0)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'noticeId', n.id, 'status', n.status,
    'total', (select count(*) from public.company_notice_recipients where notice_id = n.id),
    'read', (select count(*) from public.company_notice_recipients where notice_id = n.id and read_at is not null),
    'unread', (select count(*) from public.company_notice_recipients where notice_id = n.id and read_at is null),
    'acknowledged', (select count(*) from public.company_notice_recipients where notice_id = n.id and acknowledged_at is not null),
    'notAcknowledged', (select count(*) from public.company_notice_recipients where notice_id = n.id and acknowledged_at is null),
    'readPercent', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where read_at is not null) / count(*), 1) end from public.company_notice_recipients where notice_id = n.id),
    'acknowledgedPercent', (select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where acknowledged_at is not null) / count(*), 1) end from public.company_notice_recipients where notice_id = n.id),
    'version', n.version,
    'push', (select jsonb_build_object('devices', count(*), 'accepted', count(*) filter (where status = 'ACCEPTED_BY_PUSH_SERVICE'),
               'pending', count(*) filter (where status in ('PENDING', 'PROCESSING', 'RETRY_PENDING')), 'failed', count(*) filter (where status in ('FAILED', 'EXPIRED')),
               'cancelled', count(*) filter (where status = 'CANCELLED'))
             from public.notification_deliveries where kind = 'COMPANY_NOTICE' and tag = 'notice-' || n.id),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('profileId', p.id, 'name', p.full_name,
               'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
               'notifiedAt', r.notified_at, 'readAt', r.read_at, 'acknowledgedAt', r.acknowledged_at, 'acknowledgedVersion', r.acknowledged_version)
               order by r.acknowledged_at nulls first, p.full_name)
             from public.company_notice_recipients r join public.profiles p on p.id = r.profile_id where r.notice_id = n.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5. What a publisher may choose (copy of 20270202000100; SALES / SUPPORT and their departments with their people are added)
-- ---------------------------------------------------------------------------
create or replace function private.notice_division_options(p_division text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', dd.department_id, 'name', dd.name,
           'employees', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role,
                                    'team', (select t.name from public.teams t where t.id = p.team_id)) order by p.full_name)
                                  from public.profiles p
                                 where p.id in (select m.profile_id from private.notice_division_members(dd.department_id, p_division) m)
                                   and p.id <> auth.uid()), '[]'::jsonb))
         order by dd.name), '[]'::jsonb)
    from private.notice_division_departments(p_division) dd
$$;

create or replace function public.notice_audience_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.notice_publisher_role();
begin
  if v_role is null then
    return jsonb_build_object('canPublish', false, 'role', null, 'audiences', '[]'::jsonb, 'departments', '[]'::jsonb, 'roles', '[]'::jsonb, 'employees', '[]'::jsonb,
                              'sales', '[]'::jsonb, 'support', '[]'::jsonb);
  end if;
  return jsonb_build_object(
    'canPublish', true, 'role', v_role,
    'audiences', '["COMPANY","DEPARTMENT","ROLE","EMPLOYEES","SALES","SUPPORT"]'::jsonb,
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d
                               ), '[]'::jsonb),
    'roles', '[{"id":"DEPARTMENT_HEAD","label":"Department Heads"},{"id":"OPERATIONS_HEAD","label":"Operations Heads"},{"id":"TEAM_HEAD","label":"Team Leads"},{"id":"TEAM_MEMBER","label":"Team Members"},{"id":"HR","label":"HR"},{"id":"SUPER_ADMIN","label":"Super Admin"}]'::jsonb,
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role,
                     'department', (select d.name from public.departments d where d.id = private.base_department(p.department_id)),
                     'departmentId', private.base_department(p.department_id)) order by p.full_name)
                   from public.profiles p where p.status = 'ACTIVE' and p.id <> auth.uid()
                   ), '[]'::jsonb),
    -- (20270223000100) the Sales / Support departments, each with the people of that function (read live: a new department or employee shows at once)
    'sales', private.notice_division_options('SALES'),
    'support', private.notice_division_options('SUPPORT'));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Publishing (copy of 20270131000200; changed where marked 20270223000100)
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
  -- (20270223000100) Sales / Support: one department of that function; ticked people only from its function
  if v_type in ('SALES', 'SUPPORT') then
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

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.notice_division_departments(text)', 'private.notice_division_members(uuid, text)', 'private.notice_division_options(text)',
    'private.notice_audience(text, uuid[], text[], uuid[], uuid)', 'private.notice_visible(public.company_notices)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.notice_audience_options()', 'public.notice_publish(jsonb)', 'public.notice_receipts(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
