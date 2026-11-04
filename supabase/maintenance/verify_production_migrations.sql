-- =============================================================================
-- READ-ONLY: which of the recent migrations are really applied to THIS database, and do the fixes hold on the live data.
-- A migration being in GitHub does not mean it was pasted into the Supabase SQL editor. Run this whole file in the SQL editor; it only
-- SELECTs (no change, no lock beyond a normal read) and returns names of database objects and COUNTS - no customer data, no message text.
-- =============================================================================

-- 1. Applied or not: one object that only the migration creates
select m.migration, m.checks, case when m.present then 'APPLIED' else 'MISSING - run it in the SQL editor' end as state
  from (values
    ('20261216000100_chat_automatic_keys', 'function public.chat_key_register', to_regprocedure('public.chat_key_register(text)') is not null),
    ('20261218000100_operations_head_creation', 'table public.operations_head_departments', to_regclass('public.operations_head_departments') is not null),
    ('20261223000100_team_lead_ownership', 'column profiles.manager_id + function my_team_members',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'manager_id')
       and to_regprocedure('public.my_team_members()') is not null),
    ('20261223000200_client_chat_access', 'function public.chat_client_tab', to_regprocedure('public.chat_client_tab()') is not null),
    ('20261223000300_meta_verifier_departments', 'table public.meta_verifier_departments', to_regclass('public.meta_verifier_departments') is not null),
    ('20261223000400_employee_offboarding', 'table public.reassignment_queue', to_regclass('public.reassignment_queue') is not null),
    ('20261224000100_department_function_scopes', 'column operations_head_departments.division + table department_function_owner',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'operations_head_departments' and column_name = 'division')
       and to_regclass('public.department_function_owner') is not null),
    ('20261224000200_chat_company_readable', 'table public.chat_settings', to_regclass('public.chat_settings') is not null),
    ('20261224000300_task_delegation_detail', 'column work_tasks.assignment_note',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'work_tasks' and column_name = 'assignment_note'))
  ) as m(migration, checks, present)
 order by m.migration;

-- 2. Chat set-up failures ("Secure messaging could not be set up automatically"): who has a key, and whether the server could take one.
--    If 20261216000100 shows MISSING above, every automatic key registration fails - that is the message on the screenshots.
select count(*) filter (where p.status = 'ACTIVE') as active_staff,
       count(distinct k.profile_id) filter (where k.retired_at is null) as with_a_key,
       count(*) filter (where p.status = 'ACTIVE' and not exists (select 1 from public.chat_user_keys k2 where k2.profile_id = p.id and k2.retired_at is null)) as without_a_key
  from public.profiles p left join public.chat_user_keys k on k.profile_id = p.id;

-- 3. Team Lead ownership (20261223000100): ordinary Team Members without a direct Team Lead (the Department Head names one), and
--    open tasks given by a Team Lead to someone who is not their own member (should be 0 for tasks created after the migration)
select count(*) as members_without_a_named_lead
  from public.profiles m
 where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and not coalesce(m.is_technical_consultant, false) and not coalesce(m.is_meta_verifier, false)
   and m.manager_id is null;
select count(*) as open_tasks_to_a_specialist
  from public.work_tasks t join public.profiles a on a.id = t.assignee_id join public.profiles b on b.id = t.assigned_by
 where b.role = 'TEAM_HEAD' and t.status not in ('COMPLETED', 'NOT_COMPLETED')
   and (coalesce(a.is_technical_consultant, false) or coalesce(a.is_meta_verifier, false));

-- 4. Daily reports waiting with a Team Lead who is not the member's own lead (should be 0 after hierarchy_report(true))
select count(*) as pending_reports_with_another_lead
  from public.work_reports r join public.profiles m on m.id = r.author_id
 where r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and m.manager_id is not null
   and exists (select 1 from public.profiles l where l.id = m.manager_id and l.team_id is distinct from r.team_id);

-- 5. Offboarded / suspended people who still hold work or scopes (each should be 0, or listed in the Reassignment Required queue)
select (select count(*) from public.customers c join public.profiles p on p.id = c.owner_id where p.status in ('SUSPENDED', 'REVOKED')) as customers_owned_by_inactive,
       (select count(*) from public.work_tasks t join public.profiles p on p.id = t.assignee_id
         where p.status in ('SUSPENDED', 'REVOKED') and t.status not in ('COMPLETED', 'NOT_COMPLETED')) as open_tasks_of_inactive,
       (select count(*) from public.department_access a join public.profiles p on p.id = a.profile_id where p.status <> 'ACTIVE') as grants_of_inactive_heads;

-- 6. Operations Heads and Department Heads by function (20261224000100): how many reach Sales, Support or whole departments
select case when p.is_operations_head then 'Operations Head' else 'Department Head' end as kind,
       coalesce(p.head_division, 'SALES + SUPPORT') as function, count(*) as people
  from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE'
 group by 1, 2 order by 1, 2;
