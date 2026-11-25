-- =============================================================================
-- Task daily reports and performance approval (migration 20270209000100):
--   Team Member submits a daily report against a task -> Team Lead approves or returns it -> approved reports feed the performance figures ->
--   the Team Lead approves the member's performance, the Department Head approves the Team Lead's.
-- The complete workflow (task_daily_reports_flow.sql) is run for: an ordinary department built here (tdr-a, two Team Leads), International and Reseller
-- (the fixtures of unified_departments_test.sql, which must run first) - each time with the people of ANOTHER department as the outsiders.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 190. Task daily reports and performance approval'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270209000100_task_daily_reports_performance.sql
\i supabase/migrations/20270209000100_task_daily_reports_performance.sql
-- International / Reseller: the Team Lead alone evaluates members (20270210000100 replaces some of the functions above, so it is applied again after them)
\i supabase/migrations/20270210000100_unified_performance_hierarchy.sql

create or replace function test.u(p_key text) returns uuid language sql stable as $$ select test.id(current_setting('tdr.' || p_key)) $$;
grant execute on function test.u(text) to anon, authenticated, service_role;

\echo '   the tables are closed: row level security on, no write grants, histories append-only'
select test.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.task_daily_reports'::regclass, 'public.task_daily_report_history'::regclass, 'public.performance_records'::regclass, 'public.performance_record_history'::regclass)),
  'row level security is on for the four tables');
select test.check(not has_table_privilege('authenticated', 'public.task_daily_reports', 'insert') and not has_table_privilege('authenticated', 'public.task_daily_reports', 'update')
                  and not has_table_privilege('authenticated', 'public.performance_records', 'update') and not has_table_privilege('anon', 'public.performance_records', 'select'),
  'signed-in users cannot write the tables directly and signed-out users cannot read them');
select test.check(not has_function_privilege('anon', 'public.task_report_submit(uuid, date, text, integer, text, text, text)', 'execute')
                  and not has_function_privilege('anon', 'public.performance_overview(date, date, uuid)', 'execute'), 'signed-out users cannot call the functions');

-- a clean start (the suite can be run again on the same database)
delete from task_daily_reports where task_id in (select id from work_tasks where title like 'TDR %');
delete from performance_records where subject_id in (select id from profiles where department_id in (select id from departments where slug in ('international', 'reseller')));
delete from work_tasks where title like 'TDR %';

-- an ordinary department with two Team Leads (Sales and Support teams) and a second department to be the outsiders
delete from task_daily_reports where department_id in (select id from departments where slug like 'tdr-%');
delete from performance_records where department_id in (select id from departments where slug like 'tdr-%');
delete from work_tasks where department_id in (select id from departments where slug like 'tdr-%');
delete from auth.users where email like 'tdr.%@example.com';
delete from test.users where name like 'tdr\_%';
delete from teams where department_id in (select id from departments where slug like 'tdr-%');
delete from departments where slug like 'tdr-%';
insert into departments (slug, name) values ('tdr-a', 'TDR Alpha'), ('tdr-b', 'TDR Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'tdr-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug = 'tdr-a';
create or replace function test.tdrmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tdr.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'TDR ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on function test.tdrmk(text, text, text, text) to anon, authenticated, service_role;
select test.tdrmk('tdr_dha', 'DEPARTMENT_HEAD', 'tdr-a');
select test.tdrmk('tdr_tl1', 'TEAM_HEAD', 'tdr-a', 'Sales');
select test.tdrmk('tdr_tl2', 'TEAM_HEAD', 'tdr-a', 'Support');
select test.tdrmk('tdr_m1', 'TEAM_MEMBER', 'tdr-a', 'Sales');
select test.tdrmk('tdr_m2', 'TEAM_MEMBER', 'tdr-a', 'Support');
select test.tdrmk('tdr_dhb', 'DEPARTMENT_HEAD', 'tdr-b');
select test.tdrmk('tdr_tlb', 'TEAM_HEAD', 'tdr-b', 'Sales');
select test.tdrmk('tdr_mb', 'TEAM_MEMBER', 'tdr-b', 'Sales');
select test.check((select count(*) = 8 from profiles where id in (select id from test.users where name like 'tdr\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');
select test.check(private.direct_lead_of(test.id('tdr_m1')) = test.id('tdr_tl1') and private.direct_lead_of(test.id('tdr_m2')) = test.id('tdr_tl2'), 'each member reports to the Team Lead of their team');

-- ===== an existing (ordinary) department =====
select set_config('tdr.h', 'tdr_dha', false), set_config('tdr.l', 'tdr_tl1', false), set_config('tdr.m', 'tdr_m1', false), set_config('tdr.pl', 'tdr_tl2', false), set_config('tdr.pm', 'tdr_m2', false),
       set_config('tdr.oh', 'tdr_dhb', false), set_config('tdr.ol', 'tdr_tlb', false), set_config('tdr.om', 'tdr_mb', false), set_config('tdr.slug', 'tdr-a', false);
\set tag 'existing department'
\set strict false
\i supabase/tests/task_daily_reports_flow.sql

-- ===== International (a unified Sales + Support department) =====
select set_config('tdr.h', 'i_head', false), set_config('tdr.l', 'i_lead_a', false), set_config('tdr.m', 'i_m_a1', false), set_config('tdr.pl', 'i_lead_b', false), set_config('tdr.pm', 'i_m_b1', false),
       set_config('tdr.oh', 'r_head', false), set_config('tdr.ol', 'r_lead_a', false), set_config('tdr.om', 'r_m_a1', false), set_config('tdr.slug', 'international', false);
\set tag 'International'
\set strict true
\i supabase/tests/task_daily_reports_flow.sql

-- ===== Reseller =====
select set_config('tdr.h', 'r_head', false), set_config('tdr.l', 'r_lead_a', false), set_config('tdr.m', 'r_m_a1', false), set_config('tdr.pl', 'i_lead_b', false), set_config('tdr.pm', 'i_m_b1', false),
       set_config('tdr.oh', 'i_head', false), set_config('tdr.ol', 'i_lead_a', false), set_config('tdr.om', 'i_m_a1', false), set_config('tdr.slug', 'reseller', false);
\set tag 'Reseller'
\set strict true
\i supabase/tests/task_daily_reports_flow.sql

\echo '   departments never mix: every report and record belongs to the department of its author'
reset role;
select test.check(not exists (select 1 from task_daily_reports r join profiles p on p.id = r.author_id where r.department_id is distinct from p.department_id)
                  and not exists (select 1 from performance_records r join profiles p on p.id = r.subject_id where r.department_id is distinct from p.department_id), 'reports and records carry their author''s department');
select test.check((select count(distinct department_id) = 3 from task_daily_reports where department_id in (select id from departments where slug in ('tdr-a', 'international', 'reseller'))), 'each of the three departments has its own reports');
\echo '=== TASK DAILY REPORTS AND PERFORMANCE TESTS PASSED ==='
