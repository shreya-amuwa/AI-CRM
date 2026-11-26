-- =============================================================================
-- Weekly department report: through the Operations Head when there is one, straight to HR when there is none (migration 20270217000100).
-- Synthetic departments and people only (prefix wdh):
--   wdh-a: a Department Head and an active Operations Head (department-level owner),
--   wdh-n: a Department Head and NO Operations Head.
-- Runs late and re-applies the earlier weekly-report migrations first, because older tests re-apply them.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Weekly report: Operations Head when there is one, otherwise straight to HR'
reset role;
\i supabase/migrations/20261230000200_weekly_report_operations_routing.sql
\i supabase/migrations/20270217000100_weekly_report_direct_to_hr.sql
\i supabase/migrations/20270217000100_weekly_report_direct_to_hr.sql

delete from notifications where type in ('REPORT_WEEKLY_SENT_TO_HR', 'REPORT_PACKAGE_SUBMITTED');
delete from work_report_packages where department_id in (select id from departments where slug like 'wdh-%');
delete from work_reports where author_id in (select id from profiles where email like 'wdh.%@example.com');
delete from department_function_owner where department_id in (select id from departments where slug like 'wdh-%');
delete from department_operations_owner where department_id in (select id from departments where slug like 'wdh-%');
delete from operations_head_departments where department_id in (select id from departments where slug like 'wdh-%');
delete from auth.users where email like 'wdh.%@example.com';
delete from test.users where name like 'wdh\_%';
delete from teams where department_id in (select id from departments where slug like 'wdh-%');
delete from departments where slug like 'wdh-%';
insert into departments (slug, name) values ('wdh-a', 'WDH With OH'), ('wdh-n', 'WDH No OH'), ('wdh-home', 'WDH Home'), ('wdh-home2', 'WDH Home Two');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'wdh-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'wdh-%';
insert into teams (department_id, name, division) select d.id, 'WDH HR Team', 'GENERAL' from departments d where d.slug = 'hr' and not exists (select 1 from teams t where t.department_id = d.id and t.name = 'WDH HR Team');

create or replace function test.wdhmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'wdh.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'WDH ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
create or replace function test.wdhweek() returns date language sql stable as $$ select date_trunc('week', private.office_today())::date - 14 $$;
create or replace function test.wdhpkg(p_dept text, p_week date) returns public.work_report_packages language sql stable security definer set search_path = '' as $$
  select * from public.work_report_packages where department_id = test.dept(p_dept) and period_start = p_week $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

select test.service(); select test.wdhmk('wdh_oh', 'DEPARTMENT_HEAD', 'wdh-home');
select test.service(); select test.wdhmk('wdh_oh2', 'DEPARTMENT_HEAD', 'wdh-home2');
select test.service(); select test.wdhmk('wdh_dha', 'DEPARTMENT_HEAD', 'wdh-a');
select test.service(); select test.wdhmk('wdh_dhn', 'DEPARTMENT_HEAD', 'wdh-n');
select test.service(); select test.wdhmk('wdh_tm', 'TEAM_MEMBER', 'wdh-n', 'Sales');
select test.service(); select test.create_auth_user('wdh_hr', 'wdh.hr@example.com', '{"full_name":"WDH hr"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'WDH HR Team')));
update profiles set created_at = now() - interval '90 days', approved_at = now() - interval '90 days' where id in (select id from test.users where name like 'wdh\_%');

set role authenticated;
select test.login('sa');
select set_operations_head(test.id('wdh_oh'), true, 'test');
select operations_head_scope_set(test.id('wdh_oh'), array[test.dept('wdh-a')], array[test.dept('wdh-a')]);
reset role;
select test.check(private.owner_of_department(test.dept('wdh-a')) = test.id('wdh_oh') and private.owner_of_department(test.dept('wdh-n')) is null,
  'fixture: wdh-a has an Operations Head, wdh-n has none');

\echo '   1. a department WITH an Operations Head: it still goes through them'
set role authenticated;
select test.login('wdh_dha');
select test.check((select w ->> 'routingIssue' is null and jsonb_array_length(w -> 'reviewers') = 1 from (select work_reports_weekly(test.wdhweek()) w) x), 'the head sees no routing note');
select test.check((work_report_weekly_save(test.wdhweek(), 'Week with OH', 'Assigned', 'Done', 'Fine', true) ->> 'status') = 'PENDING_OPERATIONS_HEAD', 'submitted to the Operations Head');
reset role;
select test.check((select status = 'PENDING_OPERATIONS_HEAD' and sent_to_hr_at is null from work_report_packages where department_id = test.dept('wdh-a') and period_start = test.wdhweek()), 'it is not with HR');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_PACKAGE_SUBMITTED' and recipient_id = test.id('wdh_oh'))
                  and not exists (select 1 from notifications where type = 'REPORT_WEEKLY_SENT_TO_HR' and recipient_id = test.id('wdh_hr')), 'the Operations Head is told; HR is not');
set role authenticated;
select test.login('wdh_hr');
select test.check((select count(*) = 0 from jsonb_array_elements(hr_reviews_overview(test.wdhweek()) -> 'departments') x where x ->> 'name' like 'WDH %'), 'HR does not see it before the Operations Head approves');
select test.login('wdh_dha');
select test.must_fail($$select work_report_weekly_save(test.wdhweek(), 'Again', null, null, null, true)$$, 'while the Operations Head is active it cannot be sent again or around them', 'already submitted');
select test.login('wdh_oh');
select test.check((work_report_weekly_review((select id from test.wdhpkg('wdh-a', test.wdhweek())), 'APPROVED', 'ok') ->> 'status') = 'SENT_TO_HR', 'the Operations Head approves and it goes to HR');
reset role;
select test.check((select oh_reviewer_id = test.id('wdh_oh') from work_report_packages where department_id = test.dept('wdh-a') and period_start = test.wdhweek()), 'their decision is recorded');

\echo '   2. a department WITHOUT an Operations Head: the Department Head sends it straight to HR'
set role authenticated;
select test.login('wdh_dhn');
select test.check((select w ->> 'routingIssue' like 'No active Operations Head is assigned to WDH No OH%goes directly to HR%' and jsonb_array_length(w -> 'reviewers') = 0
                     from (select work_reports_weekly(test.wdhweek()) w) x), 'the head is told it goes to HR directly');
select test.check((work_report_weekly_save(test.wdhweek(), 'Week no OH', 'Assigned', 'Done', 'Fine', true) ->> 'status') = 'SENT_TO_HR', 'submitting no longer fails: it is sent to HR');
reset role;
select test.check((select status = 'SENT_TO_HR' and sent_to_hr_at is not null and oh_reviewer_id is null and oh_reviewed_at is null
                     from work_report_packages where department_id = test.dept('wdh-n') and period_start = test.wdhweek()),
  'no Operations Head decision is recorded or invented');
select test.check((select count(*) = 1 from work_report_package_events e join work_report_packages k on k.id = e.package_id
                    where k.department_id = test.dept('wdh-n') and e.action = 'SENT_TO_HR_DIRECT' and e.to_status = 'SENT_TO_HR'), 'the history says it was sent directly to HR');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_WEEKLY_SENT_TO_HR' and recipient_id = test.id('wdh_hr') and body like '%directly to HR%'), 'HR is told');
select test.check((select count(*) = 0 from notifications where type = 'REPORT_PACKAGE_SUBMITTED' and recipient_id = test.id('wdh_oh')
                      and entity_id = (select id from work_report_packages where department_id = test.dept('wdh-n') and period_start = test.wdhweek())), 'no Operations Head is bothered with it');
set role authenticated;
select test.login('wdh_hr');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_reviews_overview(test.wdhweek()) -> 'departments') x where x ->> 'name' = 'WDH No OH'), 'HR sees it for review');
select test.login('wdh_dhn');
select test.must_fail($$select work_report_weekly_save(test.wdhweek(), 'Again', null, null, null, true)$$, 'it cannot be sent twice', 'already submitted');
select test.login('wdh_tm');
select test.must_fail($$select work_report_weekly_save(test.wdhweek(), 'x y z', null, null, null, true)$$, 'a Team Member cannot send a weekly report', 'FORBIDDEN');
select test.login('wdh_oh');
select test.must_fail(format($$select work_report_weekly_review('%s', 'APPROVED', null)$$, (select id from test.wdhpkg('wdh-n', test.wdhweek()))),
  'an unrelated Operations Head cannot decide on it', 'NOT_FOUND|FORBIDDEN');
select test.login('sa');
select test.check((select x ->> 'issue' = 'MISSING' and x ->> 'detail' like '%directly to HR%' from jsonb_array_elements(weekly_report_routing_review()) x where (x ->> 'departmentId')::uuid = test.dept('wdh-n')),
  'the Super Admin still sees the department has no Operations Head');

\echo '   3. the Operations Head leaves while a week waits: the Department Head can send it to HR'
reset role;
delete from work_report_packages where department_id = test.dept('wdh-a') and period_start = test.wdhweek();
set role authenticated;
select test.login('wdh_dha');
select test.check((work_report_weekly_save(test.wdhweek(), 'Week stranded', 'Assigned', 'Done', 'Fine', true) ->> 'status') = 'PENDING_OPERATIONS_HEAD', 'submitted to the Operations Head');
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('wdh_oh');
set role authenticated;
select test.login('wdh_dha');
select test.check((work_report_weekly_save(test.wdhweek(), 'Week stranded', 'Assigned', 'Done', 'Fine', true) ->> 'status') = 'SENT_TO_HR', 'a week waiting for a suspended Operations Head is no longer stuck: it goes to HR');
reset role;
select test.check((select oh_reviewer_id is null and sent_to_hr_at is not null from work_report_packages where department_id = test.dept('wdh-a') and period_start = test.wdhweek()), 'still no invented decision');
update profiles set status = 'ACTIVE' where id = test.id('wdh_oh');

\echo '   4. an Operations Head assigned later: the next weeks go through them, earlier weeks are untouched'
set role authenticated;
select test.login('sa');
select set_operations_head(test.id('wdh_oh2'), true, 'test');
select operations_head_scope_set(test.id('wdh_oh2'), array[test.dept('wdh-n')], array[test.dept('wdh-n')]);
reset role;
select test.check(private.owner_of_department(test.dept('wdh-n')) = test.id('wdh_oh2'), 'wdh-n now has an Operations Head');
set role authenticated;
select test.login('wdh_dhn');
select test.check((work_report_weekly_save(test.wdhweek() + 7, 'Next week', 'Assigned', 'Done', 'Fine', true) ->> 'status') = 'PENDING_OPERATIONS_HEAD', 'the next week goes to the new Operations Head');
reset role;
select test.check((select status = 'SENT_TO_HR' from work_report_packages where department_id = test.dept('wdh-n') and period_start = test.wdhweek()), 'the week already sent to HR is untouched');
\echo '   Weekly report direct-to-HR tests done'
