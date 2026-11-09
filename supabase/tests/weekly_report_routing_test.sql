-- =============================================================================
-- Weekly report and Department Head daily report routing to the Operations Head of the department AND function
-- (migration 20261230000200). Synthetic departments only:
--   wkr-a: Sales + Support teams, a Sales Department Head and a Support Department Head (the Wabastore shape),
--   wkr-b: Sales + Support teams, ONE Department Head for both functions,
--   wkr-c: a Support team; the wkr-a Sales head is also given its Support side (a Department Head in two departments),
--   wkr-n: a Department Head and no Operations Head at all.
-- Operations Heads: wkr_ohs (Sales of wkr-a and wkr-b), wkr_ohp (Support of wkr-a, wkr-b and wkr-c).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133. Weekly report routing: Sales / Support Operations Heads'
reset role;
\i supabase/migrations/20261230000200_weekly_report_operations_routing.sql
\i supabase/migrations/20261230000200_weekly_report_operations_routing.sql

delete from work_report_packages where department_id in (select id from departments where slug like 'wkr-%');
delete from work_reports where author_id in (select id from profiles where email like 'wkr.%@example.com');
delete from department_access where profile_id in (select id from profiles where email like 'wkr.%@example.com');
delete from department_function_owner where department_id in (select id from departments where slug like 'wkr-%');
delete from department_operations_owner where department_id in (select id from departments where slug like 'wkr-%');
delete from operations_head_departments where department_id in (select id from departments where slug like 'wkr-%');
delete from auth.users where email like 'wkr.%@example.com';
delete from test.users where name like 'wkr\_%';
delete from teams where department_id in (select id from departments where slug like 'wkr-%');
delete from departments where slug like 'wkr-%';
insert into departments (slug, name) values ('wkr-a', 'WKR Alpha'), ('wkr-b', 'WKR Beta'), ('wkr-c', 'WKR Gamma'), ('wkr-n', 'WKR None');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug in ('wkr-a', 'wkr-b');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug in ('wkr-a', 'wkr-b', 'wkr-c', 'wkr-n');

create or replace function test.wkmk(p_name text, p_role text, p_dept text, p_division text default null, p_team text default null, p_ops boolean default false)
returns uuid language sql as $$
  select test.create_auth_user(p_name, 'wkr.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'WKR ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_team is null then test.dept(p_dept) end,
      'provisioned_team_id', case when p_team is not null then test.team(p_dept, p_team) end,
      'provisioned_head_division', p_division, 'provisioned_operations_head', case when p_ops then true end))) $$;
create or replace function test.wkweek() returns date language sql stable as $$ select date_trunc('week', private.office_today())::date - 7 $$;
create or replace function test.wkhdr(p_department uuid) returns void language sql as $$
  select set_config('request.headers', jsonb_build_object('x-active-department', p_department::text)::text, false) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

select test.service(); select test.wkmk('wkr_dhs', 'DEPARTMENT_HEAD', 'wkr-a', 'SALES');
select test.service(); select test.wkmk('wkr_dhp', 'DEPARTMENT_HEAD', 'wkr-a', 'SUPPORT');
select test.service(); select test.wkmk('wkr_dhb', 'DEPARTMENT_HEAD', 'wkr-b');
select test.service(); select test.wkmk('wkr_dhn', 'DEPARTMENT_HEAD', 'wkr-n');
select test.service(); select test.wkmk('wkr_tms', 'TEAM_MEMBER', 'wkr-a', null, 'Sales');
select test.service(); select test.wkmk('wkr_tmp', 'TEAM_MEMBER', 'wkr-a', null, 'Support');
select test.service(); select test.wkmk('wkr_ohs', 'DEPARTMENT_HEAD', 'wkr-a', 'SALES', null, true);
select test.service(); select test.wkmk('wkr_ohp', 'DEPARTMENT_HEAD', 'wkr-a', 'SUPPORT', null, true);
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
select test.login('sa');
select operations_head_scope_apply(test.id('wkr_ohs'), 'SALES', jsonb_build_array(
  jsonb_build_object('departmentId', test.dept('wkr-a'), 'primary', true), jsonb_build_object('departmentId', test.dept('wkr-b'), 'primary', true)));
select operations_head_scope_apply(test.id('wkr_ohp'), 'SUPPORT', jsonb_build_array(
  jsonb_build_object('departmentId', test.dept('wkr-a'), 'primary', true), jsonb_build_object('departmentId', test.dept('wkr-b'), 'primary', true),
  jsonb_build_object('departmentId', test.dept('wkr-c'), 'primary', true)));
select department_access_set(test.id('wkr_dhs'), test.dept('wkr-c'), 'SUPPORT', true);
reset role;
select test.check(private.owner_of_department(test.dept('wkr-a')) is null, 'fixture: wkr-a has NO department-level owner, only a Sales and a Support Operations Head (what failed before)');
select test.check((select array_agg(x) = array[test.id('wkr_ohs')] from private.weekly_reviewer_ids(test.dept('wkr-a'), 'SALES') x)
                  and (select array_agg(x) = array[test.id('wkr_ohp')] from private.weekly_reviewer_ids(test.dept('wkr-a'), 'SUPPORT') x)
                  and not exists (select 1 from private.weekly_reviewer_ids(test.dept('wkr-a'), null)),
  'the resolver: Sales -> the Sales Operations Head, Support -> the Support one, the whole department -> nobody (no cross-function fallback)');
create temp table wk (k text primary key, v uuid);
grant all on wk to authenticated;

\echo '   1. Support Department Head -> Support Operations Head'
set role authenticated;
select test.login('wkr_dhp');
select test.check((select (w ->> 'function') = 'SUPPORT' and (w -> 'reviewers' -> 0 ->> 'id')::uuid = test.id('wkr_ohp') and w ->> 'routingIssue' is null
                     from (select work_reports_weekly(test.wkweek()) w) x), 'the Support head''s week: Support, reviewed by the Support Operations Head');
insert into wk select 'sup', (work_report_weekly_save(test.wkweek(), 'Support week', 'Tickets', 'Closed', 'Fine', true) ->> 'id')::uuid;
reset role;
select test.check((select division = 'SUPPORT' and status = 'PENDING_OPERATIONS_HEAD' from work_report_packages where id = (select v from wk where k = 'sup')), 'submitted as the Support week');
select test.check((select count(*) = 1 from notifications where entity_id = (select v from wk where k = 'sup') and recipient_id = test.id('wkr_ohp') and type = 'REPORT_PACKAGE_SUBMITTED')
                  and (select count(*) = 0 from notifications where entity_id = (select v from wk where k = 'sup') and recipient_id = test.id('wkr_ohs')),
  'the Support Operations Head is told; the Sales one is not');

\echo '   2. Sales Department Head -> Sales Operations Head (same department, same week)'
set role authenticated;
select test.login('wkr_dhs');
select test.nohdr();
insert into wk select 'sal', (work_report_weekly_save(test.wkweek(), 'Sales week', 'Leads', 'Won', 'Good', true) ->> 'id')::uuid;
reset role;
select test.check((select division = 'SALES' and status = 'PENDING_OPERATIONS_HEAD' from work_report_packages where id = (select v from wk where k = 'sal'))
                  and (select v from wk where k = 'sal') <> (select v from wk where k = 'sup'), 'the Sales week is its own package next to the Support week');

\echo '   6. the wrong Operations Head sees nothing and decides nothing'
set role authenticated;
select test.login('wkr_ohs');
select test.must_fail(format($$select work_report_weekly_review('%s', 'APPROVED', null)$$, (select v from wk where k = 'sup')), 'the Sales Operations Head cannot approve the Support week', 'NOT_FOUND');
select test.check((select count(*) = 0 from jsonb_array_elements(work_reports_weekly_pending()) x where (x -> 'package' ->> 'id')::uuid = (select v from wk where k = 'sup'))
                  and (select count(*) = 1 from jsonb_array_elements(work_reports_weekly_pending()) x where (x -> 'package' ->> 'id')::uuid = (select v from wk where k = 'sal')),
  'their pending list has the Sales week only');
select test.check((select bool_and(x ->> 'function' = 'SALES') and count(*) >= 2 from jsonb_array_elements(work_reports_weekly_board(test.wkweek()) -> 'departments') x
                    where x ->> 'slug' like 'wkr-%'), 'their weekly board lists only Sales scopes (wkr-a and wkr-b)');
select test.login('wkr_ohp');
select test.must_fail(format($$select work_report_weekly_review('%s', 'APPROVED', null)$$, (select v from wk where k = 'sal')), 'the Support Operations Head cannot approve the Sales week', 'NOT_FOUND');

\echo '   7. revision and approval, HR forwarding, notifications'
select test.must_fail(format($$select work_report_weekly_review('%s', 'REVISION_REQUIRED', '')$$, (select v from wk where k = 'sup')), 'a revision needs a comment', 'Write a comment');
select test.check((select work_report_weekly_review((select v from wk where k = 'sup'), 'REVISION_REQUIRED', 'Add the escalations') ->> 'status') = 'REVISION_REQUIRED',
  'the Support Operations Head asks for a revision');
reset role;
select test.check((select count(*) = 1 from notifications where entity_id = (select v from wk where k = 'sup') and recipient_id = test.id('wkr_dhp') and type = 'REPORT_WEEKLY_REVISION')
                  and (select count(*) = 0 from notifications where entity_id = (select v from wk where k = 'sup') and recipient_id = test.id('wkr_dhs') and type = 'REPORT_WEEKLY_REVISION'),
  'the revision goes back to the Support head only');
set role authenticated;
select test.login('wkr_dhp');
select test.check((select (work_report_weekly_save(test.wkweek(), 'Support week', 'Tickets', 'Closed', 'With the escalations', true) ->> 'revision')::int = 2), 'resubmitted (revision 2)');
select test.login('wkr_ohp');
select test.check((select work_report_weekly_review((select v from wk where k = 'sup'), 'APPROVED', 'Thanks') ->> 'status') = 'SENT_TO_HR', 'approved: sent to HR');
reset role;
select test.check((select count(*) >= 1 from notifications n where n.entity_id = (select v from wk where k = 'sup') and n.type = 'REPORT_WEEKLY_SENT_TO_HR'
                     and n.title like '%WKR Alpha Support%'), 'HR is told, with the department and function');
select test.check((select oh_reviewer_id = test.id('wkr_ohp') and (stats ->> 'members')::int = 1 from work_report_packages where id = (select v from wk where k = 'sup')),
  'who approved is kept, and the figures cover the Support people only (one Support member)');
set role authenticated;
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_reviews_overview(test.wkweek()) -> 'departments') x
                    where (x ->> 'packageId')::uuid = (select v from wk where k = 'sup') and x ->> 'function' = 'SUPPORT'), 'HR sees the Support week as Support');
reset role;
select test.check((select (private.hr_review_counts((select v from wk where k = 'sup')) ->> 'expected')::int = 1), 'and reviews only the Support people (one)');
set role authenticated;

\echo '   3. a Department Head of both functions, and a Department Head in two departments'
select test.login('wkr_dhb');
select test.check((select w -> 'functions' = '["SALES", "SUPPORT"]'::jsonb and w ->> 'function' = 'SALES' from (select work_reports_weekly(test.wkweek()) w) x),
  'the head of both functions in wkr-b (separate Operations Heads) sends a Sales and a Support week');
select test.must_fail($$select work_reports_weekly(test.wkweek(), 'ALL')$$, 'not one for the whole department (nobody could approve it)', 'not sent for that function');
insert into wk select 'b_sal', (work_report_weekly_save(test.wkweek(), 'Beta Sales', null, null, null, true, 'SALES') ->> 'id')::uuid;
insert into wk select 'b_sup', (work_report_weekly_save(test.wkweek(), 'Beta Support', null, null, null, true, 'SUPPORT') ->> 'id')::uuid;
reset role;
select test.check((select count(*) = 1 from notifications where entity_id = (select v from wk where k = 'b_sal') and recipient_id = test.id('wkr_ohs'))
                  and (select count(*) = 1 from notifications where entity_id = (select v from wk where k = 'b_sup') and recipient_id = test.id('wkr_ohp'))
                  and (select count(*) = 0 from notifications where entity_id = (select v from wk where k = 'b_sal') and recipient_id = test.id('wkr_ohp')),
  'each goes to its own Operations Head');
set role authenticated;
select test.login('wkr_dhs');
select test.wkhdr(test.dept('wkr-c'));
select test.check((select w ->> 'function' = 'SUPPORT' and (w ->> 'departmentId')::uuid = test.dept('wkr-c') and (w -> 'reviewers' -> 0 ->> 'id')::uuid = test.id('wkr_ohp')
                     from (select work_reports_weekly(test.wkweek()) w) x), 'the Sales head working in wkr-c (their Support department) reports that week to the Support Operations Head');
select test.must_fail($$select work_reports_weekly(test.wkweek(), 'SALES')$$, 'they cannot send a Sales week for wkr-c', 'Support function only');
insert into wk select 'c_sup', (work_report_weekly_save(test.wkweek(), 'Gamma Support', null, null, null, true) ->> 'id')::uuid;
select test.nohdr();
reset role;
select test.check((select department_id = test.dept('wkr-c') and division = 'SUPPORT' from work_report_packages where id = (select v from wk where k = 'c_sup')), 'saved for wkr-c Support');

\echo '   the Department Head''s own daily report goes to the Operations Head of their function'
set role authenticated;
select test.login('wkr_dhp');
insert into wk select 'daily', (work_report_save(null, 'Support head day', test.wkweek(), 'DAILY', test.wkweek(), test.wkweek(),
  jsonb_build_object('assignedTasks', '[]'::jsonb, 'completedTasks', '[]'::jsonb, 'remarks', 'Escalations reviewed')) ->> 'id')::uuid;
select test.check((select work_report_submit((select v from wk where k = 'daily')) ->> 'status') = 'SUBMITTED', 'the Support head''s daily report is submitted (it was refused before)');
reset role;
select test.check((select count(*) = 1 from notifications where entity_id = (select v from wk where k = 'daily') and recipient_id = test.id('wkr_ohp'))
                  and (select count(*) = 0 from notifications where entity_id = (select v from wk where k = 'daily') and recipient_id = test.id('wkr_ohs')),
  'the Support Operations Head is told, the Sales one is not');
set role authenticated;
select test.login('wkr_ohs');
select test.must_fail(format($$select work_report_review('%s', 'APPROVED', null)$$, (select v from wk where k = 'daily')), 'the Sales Operations Head cannot review it', null);
select test.must_fail(format($$select work_report_get('%s')$$, (select v from wk where k = 'daily')), 'nor open it (another function''s report is not theirs to read)', 'NOT_FOUND');
select test.login('wkr_ohp');
select test.check((select (work_report_get((select v from wk where k = 'daily')) ->> 'id')::uuid = (select v from wk where k = 'daily')), 'the Support Operations Head opens it');

\echo '   4. a department with no Operations Head: an explicit configuration issue, never an automatic approval'
select test.login('wkr_dhn');
select test.check((select w ->> 'routingIssue' like 'No active Operations Head is assigned to WKR None%' and jsonb_array_length(w -> 'reviewers') = 0
                     from (select work_reports_weekly(test.wkweek()) w) x), 'the head sees why it cannot be submitted');
select test.must_fail($$select work_report_weekly_save(test.wkweek(), 'None week', null, null, null, true)$$, 'submitting is refused, with the reason', 'No active Operations Head is assigned to WKR None');
select test.check((select work_report_weekly_save(test.wkweek(), 'None week', 'Kept', null, null, false) ->> 'status') = 'DRAFT', 'the draft is kept');
select test.login('sa');
select test.check((select x ->> 'issue' = 'MISSING' from jsonb_array_elements(weekly_report_routing_review()) x where (x ->> 'departmentId')::uuid = test.dept('wkr-n')),
  'the Super Admin''s routing review lists it as missing');
select test.check((select count(*) = 0 from jsonb_array_elements(weekly_report_routing_review()) x where x ->> 'department' like 'WKR %' and x ->> 'department' <> 'WKR None' and x ->> 'issue' is not null),
  'and nothing else of the WKR departments');
select test.login('wkr_dhn');
select test.must_fail($$select weekly_report_routing_review()$$, 'only the Super Admin opens it', 'FORBIDDEN|Super Admin');

\echo '   5. an inactive Operations Head is never resolved'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('wkr_ohs');
select test.check(not exists (select 1 from private.weekly_reviewer_ids(test.dept('wkr-a'), 'SALES')), 'the suspended Sales Operations Head is not resolved');
set role authenticated;
select test.login('sa');
select test.check((select x ->> 'issue' = 'INACTIVE' from jsonb_array_elements(weekly_report_routing_review()) x
                    where (x ->> 'departmentId')::uuid = test.dept('wkr-a') and x ->> 'function' = 'SALES'), 'the routing review says the named one is inactive');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('wkr_ohs');

\echo '   a package made before this migration is not changed'
insert into work_report_packages (department_id, period_type, period_start, period_end, title, status, submitted_by_name)
values (test.dept('wkr-n'), 'WEEKLY', test.wkweek() - 7, test.wkweek() - 1, 'Old whole-department week', 'HR_REVIEW_COMPLETED', 'Someone');
select test.check((select division is null and status = 'HR_REVIEW_COMPLETED' from work_report_packages where department_id = test.dept('wkr-n') and period_start = test.wkweek() - 7),
  'an existing whole-department package keeps its status and has no function');
select test.check((private.weekly_package(test.dept('wkr-n'), null, test.wkweek() - 7, test.wkweek() - 1)).title = 'Old whole-department week', 'and is still found for its week');
reset role;
