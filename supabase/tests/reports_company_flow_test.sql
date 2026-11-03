-- =============================================================================
-- Company-wide reporting: one standard report form, the daily cycle (Team Member -> Team Lead -> Department Head), the Daily Department
-- Summary, the weekly cycle (Department Head -> Operations Head -> HR), HR individual reviews, the consolidated report, and the Superadmin
-- leaderboard and AI analysis facts. Migrations 20261221000100 .. 20261221000400. Own synthetic departments and people (prefix rc).
-- Runs after the earlier work-report tests, which re-apply older migrations, so this file applies the four migrations again first.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 92. Company reporting: standard form, daily, weekly, HR reviews, consolidated report, leaderboard'
reset role;
\i supabase/migrations/20261221000100_reports_standard_form.sql
\i supabase/migrations/20261221000200_reports_weekly_cycle.sql
\i supabase/migrations/20261221000300_hr_performance_reviews.sql
\i supabase/migrations/20261221000400_performance_leaderboard.sql

delete from public.report_ai_analyses;
delete from notifications where type in ('REPORT_WEEKLY_SENT_TO_HR', 'REPORT_PACKAGE_SUBMITTED', 'REPORT_WEEKLY_APPROVED', 'REPORT_WEEKLY_REVISION', 'REPORT_CONSOLIDATED_SUBMITTED', 'REPORT_ANALYSIS_READY');
delete from public.hr_consolidated_reports;
delete from public.hr_performance_reviews where department_id in (select id from departments where slug like 'rc-%');
delete from public.work_report_signals;
delete from public.work_report_packages where department_id in (select id from departments where slug like 'rc-%');
delete from public.work_reports where department_id in (select id from departments where slug like 'rc-%');
delete from public.work_tasks where department_id in (select id from departments where slug like 'rc-%');
delete from public.leave_requests where employee_id in (select id from test.users where name like 'rc\_%');
delete from auth.users where email like 'rc.%@example.com';
delete from test.users where name like 'rc\_%';
delete from teams where department_id in (select id from departments where slug like 'rc-%');
delete from departments where slug like 'rc-%';
insert into departments (slug, name) values ('rc-home', 'RC Home'), ('rc-a', 'RC Alpha'), ('rc-b', 'RC Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'rc-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'rc-%';
insert into teams (department_id, name, division) select d.id, 'RC HR Team', 'GENERAL' from departments d where d.slug = 'hr' and not exists (select 1 from teams t where t.department_id = d.id and t.name = 'RC HR Team');

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.rcmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'rc.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'RC ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant usage on schema test to service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   people: Operations Head, Department Heads, Team Leads, Team Members, HR staff'
select test.service(); select test.rcmk('rc_oh', 'DEPARTMENT_HEAD', 'rc-home');
select test.service(); select test.rcmk('rc_dha', 'DEPARTMENT_HEAD', 'rc-a');
select test.service(); select test.rcmk('rc_dhb', 'DEPARTMENT_HEAD', 'rc-b');
select test.service(); select test.rcmk('rc_tl1', 'TEAM_HEAD', 'rc-a', 'Sales');
select test.service(); select test.rcmk('rc_tl2', 'TEAM_HEAD', 'rc-a', 'Support');
select test.service(); select test.rcmk('rc_tlb', 'TEAM_HEAD', 'rc-b', 'Sales');
select test.service(); select test.rcmk('rc_m1', 'TEAM_MEMBER', 'rc-a', 'Sales');
select test.service(); select test.rcmk('rc_m2', 'TEAM_MEMBER', 'rc-a', 'Sales');
select test.service(); select test.rcmk('rc_m3', 'TEAM_MEMBER', 'rc-a', 'Support');
select test.service(); select test.rcmk('rc_mb', 'TEAM_MEMBER', 'rc-b', 'Sales');
select test.service(); select test.create_auth_user('rc_hr1', 'rc.hr1@example.com', '{"full_name":"RC hr1"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RC HR Team')));
select test.service(); select test.create_auth_user('rc_hr2', 'rc.hr2@example.com', '{"full_name":"RC hr2"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RC HR Team')));
select test.check((select count(*) = 12 from profiles where id in (select id from test.users where name like 'rc\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');
-- the accounts are old enough to have been expected to report during last week
update profiles set created_at = now() - interval '90 days', approved_at = now() - interval '90 days' where id in (select id from test.users where name like 'rc\_%');

set role authenticated;
select test.login('sa');
select set_operations_head(test.id('rc_oh'), true, 'test');
select operations_head_scope_set(test.id('rc_oh'), array[test.dept('rc-a'), test.dept('rc-b')], array[test.dept('rc-a'), test.dept('rc-b')]);
reset role;
select test.check(private.owner_of_department(test.dept('rc-a')) = test.id('rc_oh') and private.owner_of_department(test.dept('rc-b')) = test.id('rc_oh'), 'the Operations Head manages Alpha and Beta');

-- the week under test: last week, Monday to Sunday
create or replace function test.rcweek() returns date language sql stable as $$ select date_trunc('week', private.office_today())::date - 7 $$;
grant execute on function test.rcweek() to anon, authenticated, service_role;

-- task records (owner-run): due inside last week
create or replace function test.rctask(p_owner text, p_dept text, p_team text, p_title text, p_status text, p_day int default 1) returns uuid language sql security definer set search_path = '' as $$
  insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, status, progress, completed_at, due_date, created_at)
  values (test.dept(p_dept), case when p_team is null then null else test.team(p_dept, p_team) end, p_title, test.id('sa'), test.id(p_owner), p_status,
          case when p_status = 'COMPLETED' then 100 else 20 end, case when p_status = 'COMPLETED' then now() end, test.rcweek() + p_day, now() - interval '30 days')
  returning id
$$;
create or replace function test.rc(p_id uuid) returns public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports where id = p_id $$;
create or replace function test.rcpkg(p_dept text) returns public.work_report_packages language sql stable security definer set search_path = '' as $$
  select * from public.work_report_packages where department_id = test.dept(p_dept) and period_start = test.rcweek() $$;
create or replace function test.rcrev(p_pkg uuid, p_subject text) returns public.hr_performance_reviews language sql stable security definer set search_path = '' as $$
  select * from public.hr_performance_reviews where package_id = p_pkg and subject_id = test.id(p_subject) $$;
create or replace function test.rcevents(p_id uuid) returns setof public.work_report_events language sql stable security definer set search_path = '' as $$ select * from public.work_report_events where report_id = p_id order by id $$;
grant execute on function test.rctask(text, text, text, text, text, int), test.rc(uuid), test.rcpkg(text), test.rcrev(uuid, text), test.rcevents(uuid) to anon, authenticated;
create temp table rc_ids (name text primary key, id uuid);
grant all on rc_ids to anon, authenticated, service_role;
create or replace function test.rcid(p_name text) returns uuid language sql stable as $$ select id from rc_ids where name = p_name $$;
grant execute on function test.rcid(text) to anon, authenticated, service_role;
insert into rc_ids values
  ('tm1', test.rctask('rc_m1', 'rc-a', 'Sales', 'Call new leads', 'COMPLETED')),
  ('tm2', test.rctask('rc_m1', 'rc-a', 'Sales', 'Prepare the deck', 'IN_PROGRESS')),
  ('tm3', test.rctask('rc_m1', 'rc-a', 'Sales', 'Update CRM notes', 'COMPLETED')),
  ('tm4', test.rctask('rc_m2', 'rc-a', 'Sales', 'Follow up renewals', 'COMPLETED')),
  ('tm5', test.rctask('rc_m2', 'rc-a', 'Sales', 'Send quotes', 'IN_PROGRESS')),
  ('tm6', test.rctask('rc_m2', 'rc-a', 'Sales', 'Book demos', 'IN_PROGRESS')),
  ('tt1', test.rctask('rc_tl1', 'rc-a', 'Sales', 'Review the pipeline', 'COMPLETED')),
  ('tt2', test.rctask('rc_tl1', 'rc-a', 'Sales', 'Coach the team', 'COMPLETED')),
  ('tt3', test.rctask('rc_tl1', 'rc-a', 'Sales', 'Plan the month', 'IN_PROGRESS')),
  ('tt4', test.rctask('rc_tl2', 'rc-a', 'Support', 'Audit the tickets', 'COMPLETED')),
  ('th1', test.rctask('rc_dha', 'rc-a', null, 'Budget review', 'COMPLETED')),
  ('th2', test.rctask('rc_dha', 'rc-a', null, 'Hiring plan', 'IN_PROGRESS')),
  ('tm3a', test.rctask('rc_m3', 'rc-a', 'Support', 'Close old tickets', 'COMPLETED'));
-- an approved full-day leave of the Support member on Tuesday: that day is not expected from them
insert into public.leave_requests (employee_id, department_id, leave_type, start_date, end_date, reason, status)
  values (test.id('rc_m3'), test.dept('rc-a'), 'FULL_DAY', test.rcweek() + 1, test.rcweek() + 1, 'Family event', 'APPROVED');

-- ---------------------------------------------------------------------------
\echo '   the standard form: Team Member, Team Lead and Department Head share it'
set role authenticated;
select test.login('rc_m1');
insert into rc_ids select 'm1a', (work_report_save(null, 'Monday report M1', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.rcid('tm1'), test.rcid('tm2'), test.rcid('tm3')), 'completedTasks', jsonb_build_array(test.rcid('tm1'), test.rcid('tm3')),
                     'remarks', 'Two follow-ups waiting for the customer.', 'challenges', 'dropped')) ->> 'id')::uuid;
select test.check((select status = 'DRAFT' and content ->> 'remarks' = 'Two follow-ups waiting for the customer.' and jsonb_array_length(content -> 'assignedTasks') = 3
                          and jsonb_array_length(content -> 'completedTasks') = 2 and not content ? 'challenges' from test.rc(test.rcid('m1a'))),
  'a Team Member report holds the assigned tasks, the completed tasks and the short remarks only');
select test.check((work_report_get(test.rcid('m1a')) ->> 'assignedCount')::int = 3 and (work_report_get(test.rcid('m1a')) ->> 'completedCount')::int = 2, 'the counts are on the report');
select test.must_fail($$select work_report_save(null, 'Same day', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(), '{}')$$, 'one report per person and day', 'already have a report');
select test.must_fail(format($$select work_report_save(null, 'Foreign', test.rcweek() + 1, 'DAILY', test.rcweek(), test.rcweek(), '{"assignedTasks":["%s"]}')$$, test.rcid('tm4')), 'a task assigned to a colleague cannot be reported', 'assigned to you');
select test.must_fail(format($$select work_report_save(null, 'Open one', test.rcweek() + 1, 'DAILY', test.rcweek(), test.rcweek(), '{"assignedTasks":["%1$s"],"completedTasks":["%1$s"]}')$$, test.rcid('tm2')), 'an open task cannot be reported as completed', 'not marked completed');
select test.must_fail(format($$select work_report_save(null, 'Long', test.rcweek() + 1, 'DAILY', test.rcweek(), test.rcweek(), jsonb_build_object('remarks', repeat('x', 501))::text::jsonb)$$), 'the remarks are short', '500 characters');
select test.must_fail($$select work_report_submit((work_report_save(null, 'Empty', test.rcweek() + 1, 'DAILY', test.rcweek(), test.rcweek(), '{}') ->> 'id')::uuid)$$ , 'an empty report cannot be submitted', 'assigned tasks or write a short remark');
select work_report_submit(test.rcid('m1a'));
select test.check((select status = 'SUBMITTED' and tl_status = 'PENDING' and team_lead_name = 'RC tl1' from test.rc(test.rcid('m1a'))), 'submitted: Pending Team Lead Approval, routed to the assigned Team Lead');

select test.login('rc_m2');
insert into rc_ids select 'm2a', (work_report_save(null, 'Monday report M2', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.rcid('tm4'), test.rcid('tm5'), test.rcid('tm6')), 'completedTasks', jsonb_build_array(test.rcid('tm4')))) ->> 'id')::uuid;
select work_report_submit(test.rcid('m2a'));
select test.login('rc_m3');
insert into rc_ids select 'm3a', (work_report_save(null, 'Monday report M3', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.rcid('tm3a')), 'completedTasks', jsonb_build_array(test.rcid('tm3a')))) ->> 'id')::uuid;
select work_report_submit(test.rcid('m3a'));

-- Team Lead: the same form, its own report, sent to the Department Head
select test.login('rc_tl1');
insert into rc_ids select 'tl1a', (work_report_save(null, 'Monday report TL1', test.rcweek(), 'WEEKLY', test.rcweek(), test.rcweek() + 6,
  jsonb_build_object('assignedTasks', jsonb_build_array(test.rcid('tt1'), test.rcid('tt2'), test.rcid('tt3')), 'completedTasks', jsonb_build_array(test.rcid('tt1'), test.rcid('tt2')),
                     'remarks', 'Team meeting held.')) ->> 'id')::uuid;
select test.check((select kind = 'TEAM_LEAD' and period_type = 'DAILY' and period_start = test.rcweek() and period_end = test.rcweek() and content ->> 'remarks' = 'Team meeting held.' from test.rc(test.rcid('tl1a'))),
  'a Team Lead report is the same daily form');
select test.must_fail(format($$select work_report_save(null, 'Their task', test.rcweek() + 1, 'DAILY', test.rcweek(), test.rcweek(), '{"assignedTasks":["%s"]}')$$, test.rcid('tm1')), 'a Team Lead cannot report a Team Member''s task', 'assigned to you');
select test.check((select count(*) = 3 from jsonb_array_elements(work_reports_my_tasks())), 'the Team Lead''s task list holds their own tasks');
select work_report_submit(test.rcid('tl1a'));
select test.check((select status = 'SUBMITTED' and tl_status is null and dh_status = 'PENDING' from test.rc(test.rcid('tl1a'))), 'the Team Lead report waits for the Department Head only (own Department Head status)');
select test.must_fail($$select work_report_review(test.rcid('tl1a'), 'APPROVED', null)$$, 'a Team Lead cannot approve their own report', 'NOT_FOUND');
select test.login('rc_tl2');
insert into rc_ids select 'tl2a', (work_report_save(null, 'Monday report TL2', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.rcid('tt4')), 'completedTasks', jsonb_build_array(test.rcid('tt4')))) ->> 'id')::uuid;
select work_report_submit(test.rcid('tl2a'));

-- Department Head: the same form
select test.login('rc_dha');
insert into rc_ids select 'dha', (work_report_save(null, 'Monday report DH', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.rcid('th1'), test.rcid('th2')), 'completedTasks', jsonb_build_array(test.rcid('th1')), 'remarks', 'Budget approved.')) ->> 'id')::uuid;
select test.check((select kind = 'DEPARTMENT_HEAD' and period_type = 'DAILY' and jsonb_array_length(content -> 'assignedTasks') = 2 from test.rc(test.rcid('dha'))), 'a Department Head report is the same form');
select work_report_submit(test.rcid('dha'));
select test.login('rc_oh');
select test.check((work_report_get(test.rcid('dha')) ->> 'status') = 'UNDER_REVIEW', 'the Department Head''s report goes to the Operations Head');
select work_report_review(test.rcid('dha'), 'APPROVED', null);
reset role;
select test.check((select status = 'APPROVED' from test.rc(test.rcid('dha'))), 'and is approved there');

-- ---------------------------------------------------------------------------
\echo '   daily cycle: Team Lead then Department Head'
set role authenticated;
select test.login('rc_tl1');
select work_report_review(test.rcid('m1a'), 'APPROVED', 'Good');
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' and tl_reviewer_id = test.id('rc_tl1') and tl_reviewed_at is not null from test.rc(test.rcid('m1a'))), 'Team Lead approval recorded, forwarded: not final');
select test.login('rc_dha');
select test.check((work_reports_context() ->> 'pendingMemberApprovals')::int = 1 and (work_reports_context() ->> 'pendingLeadReports')::int = 2, 'the Department Head''s pending counts: 1 member report, 2 Team Lead reports');
select work_report_review(test.rcid('m1a'), 'APPROVED', 'Approved');
select test.check((select status = 'APPROVED' and dh_reviewer_id = test.id('rc_dha') and dh_reviewed_at is not null from test.rc(test.rcid('m1a'))), 'Department Head approval: Fully Approved');
-- the Team Lead's own report has its own Department Head status
select work_report_review(test.rcid('tl1a'), 'APPROVED', 'Fine');
select test.check((select status = 'APPROVED' and dh_status = 'APPROVED' and dh_reviewer_id = test.id('rc_dha') and tl_status is null from test.rc(test.rcid('tl1a'))), 'the Team Lead report: Department Head approval recorded apart from any Team Lead approval');
select work_report_review(test.rcid('tl2a'), 'REVISION_REQUIRED', 'Add the closed count');
select test.check((select status = 'REVISION_REQUIRED' and dh_status = 'REVISION_REQUIRED' from test.rc(test.rcid('tl2a'))), 'a Team Lead report can be sent back by the Department Head');
select test.login('rc_tl2');
select work_report_submit(test.rcid('tl2a'));
select test.check((select revision = 2 and status = 'SUBMITTED' and dh_status = 'PENDING' from test.rc(test.rcid('tl2a'))), 'resubmitted: revision 2, waits again');
select test.check((select count(*) = 2 and bool_and(content is not null) from test.rcevents(test.rcid('tl2a')) e where action in ('SUBMITTED', 'RESUBMITTED')), 'each submission kept its own content in the history');

-- ---------------------------------------------------------------------------
\echo '   Daily Department Summary'
select test.login('rc_dha');
-- Monday: expected = 3 members + 2 Team Leads + the Department Head = 6; submitted = m1, m2, m3, tl1, tl2, dha = 6
select test.check((work_reports_daily_summary(test.rcweek()) ->> 'expected')::int = 6 and (work_reports_daily_summary(test.rcweek()) ->> 'submitted')::int = 6, 'expected and submitted come from the people and the individual reports');
select test.check((work_reports_daily_summary(test.rcweek()) ->> 'members')::int = 3 and (work_reports_daily_summary(test.rcweek()) ->> 'teamLeads')::int = 2, 'the Team Member and Team Lead totals');
select test.check((work_reports_daily_summary(test.rcweek()) ->> 'approved')::int = 3 and (work_reports_daily_summary(test.rcweek()) ->> 'pendingTl')::int = 2
  and (work_reports_daily_summary(test.rcweek()) ->> 'pendingDh')::int = 1, 'fully approved 3 (m1, tl1, dha); pending Team Lead 2 (m2, m3); pending Department Head 1 (tl2, resubmitted)');
select test.check((work_reports_daily_summary(test.rcweek()) ->> 'assignedTasks')::int = 13 and (work_reports_daily_summary(test.rcweek()) ->> 'completedTasks')::int = 8, 'task totals are counted once from the reports');
select test.check((work_reports_daily_summary(test.rcweek()) ->> 'compliance')::numeric = 100, 'compliance = submitted over expected');
select test.check((select count(*) = 2 from jsonb_array_elements(work_reports_daily_summary(test.rcweek()) -> 'teams')), 'a line per team');
-- Tuesday: nobody reported; the member on approved leave is not expected
select test.check((work_reports_daily_summary(test.rcweek() + 1) ->> 'expected')::int = 5 and (work_reports_daily_summary(test.rcweek() + 1) ->> 'submitted')::int = 0
  and (work_reports_daily_summary(test.rcweek() + 1) ->> 'compliance')::numeric = 0, 'an approved leave day is not expected (5 of 6)');
select test.check(jsonb_array_length(work_reports_daily_summary(test.rcweek() + 1) -> 'missing') = 5, 'and the people with no report are listed');
-- Sunday: not a working day
select test.check((work_reports_daily_summary(test.rcweek() + 6) ->> 'expected')::int = 0 and (work_reports_daily_summary(test.rcweek() + 6) ->> 'compliance') is null, 'a day off expects nothing; compliance is not computed');
select test.must_fail($$select work_reports_daily_summary(test.rcweek(), test.dept('rc-b'))$$, 'a Department Head cannot open another department', 'FORBIDDEN');
select test.login('rc_dhb');
select test.check((work_reports_daily_summary(test.rcweek() ) ->> 'submitted')::int = 0, 'another department''s summary holds only its own people');
select test.login('rc_oh');
select test.check((work_reports_daily_summary(test.rcweek(), test.dept('rc-a')) ->> 'submitted')::int = 6, 'the Operations Head opens a department they manage');
select test.must_fail($$select work_reports_daily_summary(test.rcweek(), test.dept('rc-home'))$$, 'but not one they do not manage', 'NOT_FOUND');
select test.login('rc_m1');
select test.must_fail($$select work_reports_daily_summary(test.rcweek())$$, 'a Team Member has no department summary', 'FORBIDDEN');
select test.login('rc_tl1');
select test.must_fail($$select work_reports_daily_summary(test.rcweek())$$, 'nor a Team Lead', 'FORBIDDEN');

-- the Department Head sees every submitted report of their teams, but decides only after the Team Lead approved
select test.login('rc_dha');
select test.check((work_report_get(test.rcid('m3a')) ->> 'status') = 'SUBMITTED' and (work_report_get(test.rcid('m3a')) ->> 'canReview')::boolean is false, 'the Department Head reads a member report still with the Team Lead, read only');
select test.must_fail(format($$select work_report_review('%s', 'APPROVED', null)$$, test.rcid('m3a')), 'and cannot decide on it before the Team Lead did', 'NOT_FOUND');
select test.check((select jsonb_array_length(b -> 'memberReports') = 1 and (b -> 'counts' ->> 'pendingTl')::int = 1 from jsonb_array_elements(work_reports_department(test.rcweek(), test.rcweek()) -> 'teams') b where b ->> 'lead' = 'RC tl2'), 'the Team Lead box lists it as pending Team Lead approval');
select test.login('rc_hr1');
select test.must_fail(format($$select work_report_get('%s')$$, test.rcid('m3a')), 'HR still cannot read it (the week is not approved)', 'NOT_FOUND');

-- finish the week's daily cycle: the remaining reports are decided
select test.login('rc_tl1'); select work_report_review(test.rcid('m2a'), 'APPROVED', null);
select test.login('rc_tl2'); select work_report_review(test.rcid('m3a'), 'REJECTED', 'Wrong day');
select test.login('rc_dha'); select work_report_review(test.rcid('m2a'), 'REVISION_REQUIRED', 'Add the demos');
select work_report_review(test.rcid('tl2a'), 'APPROVED', null);
reset role;
select test.check((select tl_status = 'APPROVED' and dh_status = 'REVISION_REQUIRED' and status = 'REVISION_REQUIRED' and decision_stage = 'DEPARTMENT_HEAD' from test.rc(test.rcid('m2a'))), 'a Department Head revision sends it back to the member with both stages to repeat');

-- ---------------------------------------------------------------------------
\echo '   weekly cycle: Department Head -> Operations Head -> HR'
set role authenticated;
select test.login('rc_dha');
select test.must_fail($$select work_reports_weekly(test.rcweek() + 1)$$, 'the week starts on a Monday', 'Monday');
select test.check((work_reports_weekly(test.rcweek()) -> 'stats' ->> 'submitted')::int = 6 and jsonb_array_length(work_reports_weekly(test.rcweek()) -> 'days') = 7, 'the preview is worked out from the daily reports: 7 days');
select test.check((work_reports_weekly(test.rcweek()) -> 'stats' ->> 'expected')::int = 35 and (work_reports_weekly(test.rcweek()) -> 'package' ->> 'status') = 'NOT_SUBMITTED', 'week expectation: 6 people x 6 working days - 1 leave day = 35');
select test.check((work_report_weekly_save(test.rcweek(), null, null, null, null, false) ->> 'status') = 'COMPILING', 'compiling the week creates the package without any text');
select test.check((work_report_weekly_save(test.rcweek(), 'Week 1 - Alpha', 'Assigned overview', 'Completed overview', 'Good week', false) ->> 'status') = 'DRAFT', 'a draft keeps the Department Head''s summary');
select test.check(not exists (select 1 from notifications where type = 'REPORT_PACKAGE_SUBMITTED'), 'a draft notifies nobody');
select test.must_fail($$select work_report_weekly_save(test.rcweek(), '', null, null, null, true)$$, 'a weekly report needs a title to be submitted', 'title');
select test.login('rc_m1');
select test.must_fail($$select work_report_weekly_save(test.rcweek(), 'x y z', null, null, null, true)$$, 'a Team Member cannot submit a weekly report', 'FORBIDDEN');
select test.login('rc_tl1');
select test.must_fail($$select work_reports_weekly(test.rcweek())$$, 'nor a Team Lead', 'FORBIDDEN');
select test.must_fail($$select work_report_package_submit(current_date, current_date, 'DAILY', null)$$, 'the older package call checks who is asking before it looks at the dates', 'FORBIDDEN');
select test.login('rc_dha');
select test.check((work_report_weekly_save(test.rcweek(), 'Week 1 - Alpha', 'Assigned overview', 'Completed overview', 'Good week', true) ->> 'status') = 'PENDING_OPERATIONS_HEAD', 'submitted to the Operations Head');
select test.must_fail($$select work_report_weekly_save(test.rcweek(), 'Again', null, null, null, true)$$, 'a submitted week cannot be changed or sent twice', 'already submitted');
reset role;
select test.check((select stats ->> 'submitted' = '6' and status = 'PENDING_OPERATIONS_HEAD' from test.rcpkg('rc-a')), 'the statistics are stored with the submission; the daily reports are untouched');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_PACKAGE_SUBMITTED' and recipient_id = test.id('rc_oh')), 'the Operations Head is told once');
select test.check((select count(*) = 6 from work_reports where department_id = test.dept('rc-a') and report_date = test.rcweek() and status <> 'DRAFT') , 'the daily reports are preserved, not copied');
select test.check(not exists (select 1 from notifications where type = 'REPORT_WEEKLY_SENT_TO_HR'), 'HR is not told before the Operations Head approves');

set role authenticated;
-- HR sees nothing yet
select test.login('rc_hr1');
select test.check((hr_reviews_overview(test.rcweek()) -> 'departments') = '[]'::jsonb, 'HR does not see a week the Operations Head has not approved');
select test.must_fail(format($$select hr_reviews_department('%s')$$, (select id from test.rcpkg('rc-a'))), 'nor open it', 'NOT_FOUND');
select test.must_fail(format($$select hr_review_save('%s', test.id('rc_m1'), 3, null, 'ok fine', null, null, false)$$, (select id from test.rcpkg('rc-a'))), 'nor review into it', 'NOT_FOUND');
select test.must_fail(format($$select work_report_get('%s')$$, test.rcid('m1a')), 'nor read a daily report of it', 'NOT_FOUND');
-- Operations Head
select test.login('rc_oh');
select test.check((select count(*) = 2 from jsonb_array_elements(work_reports_weekly_board(test.rcweek()) -> 'departments')) and (work_reports_weekly_board(test.rcweek()) ->> 'pendingApprovals')::int = 1, 'the board lists the departments the Operations Head manages, one waiting');
select test.check((select (d -> 'stats' ->> 'teamLeads')::int = 2 and (d -> 'stats' ->> 'members')::int = 3 and (d -> 'stats' ->> 'expected')::int = 35 and (d -> 'package' ->> 'status') = 'PENDING_OPERATIONS_HEAD'
                   from jsonb_array_elements(work_reports_weekly_board(test.rcweek()) -> 'departments') d where d ->> 'name' = 'RC Alpha'), 'each department box carries the figures and the weekly status');
select test.check((work_reports_operations_department(test.dept('rc-a'), test.rcweek(), test.rcweek() + 6) ->> 'released')::boolean
  and jsonb_array_length(work_reports_operations_department(test.dept('rc-a'), test.rcweek(), test.rcweek() + 6) -> 'teamLeads') = 2, 'the department opens down to the Team Leads once the week is submitted');
select test.check((select jsonb_array_length(t -> 'memberReports') = 2 and t ->> 'lead' = 'RC tl1' and jsonb_array_length(t -> 'leadReports') = 1
                   from jsonb_array_element(work_reports_operations_department(test.dept('rc-a'), test.rcweek(), test.rcweek() + 6) -> 'teamLeads', 0) t), 'then to the Team Lead''s own report and every Team Member report');
select test.check(jsonb_array_length(work_reports_weekly_pending()) = 1, 'one weekly report waits for approval');
select test.must_fail(format($$select work_report_weekly_review('%s', 'REVISION_REQUIRED', '')$$, (select id from test.rcpkg('rc-a'))), 'a revision needs a comment', 'comment');
select test.login('rc_dha');
select test.must_fail(format($$select work_report_weekly_review('%s', 'APPROVED', null)$$, (select id from test.rcpkg('rc-a'))), 'the Department Head cannot approve their own weekly report', 'FORBIDDEN');
select test.login('rc_dhb');
select test.must_fail(format($$select work_reports_weekly_pending()$$), 'a Department Head has no weekly approvals', 'FORBIDDEN');
select test.login('rc_oh');
select test.check((work_report_weekly_review((select id from test.rcpkg('rc-a')), 'REVISION_REQUIRED', 'Add the team-wise progress') ->> 'status') = 'REVISION_REQUIRED', 'the Operations Head sends it back');
reset role;
select test.check((select oh_reviewer_id = test.id('rc_oh') and oh_comment = 'Add the team-wise progress' and oh_reviewed_at is not null from test.rcpkg('rc-a')), 'reviewer, comment and time are kept');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_WEEKLY_REVISION' and recipient_id = test.id('rc_dha')), 'the Department Head is told');
select test.check(not exists (select 1 from notifications where type = 'REPORT_WEEKLY_SENT_TO_HR'), 'a revision never reaches HR');
set role authenticated;
select test.login('rc_hr1');
select test.check((hr_reviews_overview(test.rcweek()) -> 'departments') = '[]'::jsonb, 'still nothing for HR');
select test.login('rc_dha');
select test.check((work_reports_context() ->> 'weeklyPending')::int = 1, 'the Department Head''s badge counts the weekly report sent back');
select test.check((work_report_weekly_save(test.rcweek(), 'Week 1 - Alpha (revised)', 'Assigned overview', 'Completed overview', 'Team-wise progress added', true) ->> 'revision')::int = 2, 'resubmitted as revision 2');
select test.login('rc_oh');
select test.check((work_report_weekly_review((select id from test.rcpkg('rc-a')), 'APPROVED', 'Good') ->> 'status') = 'SENT_TO_HR', 'approved: sent to HR');
reset role;
select test.check((select oh_reviewer_id = test.id('rc_oh') and oh_reviewed_at is not null and sent_to_hr_at is not null from test.rcpkg('rc-a')), 'the Operations Head''s reviewer, time and comment are recorded');
select test.check((select count(*) = (select count(*) from private.hr_reviewer_ids()) and count(distinct recipient_id) = count(*) and count(*) >= 3 from notifications where type = 'REPORT_WEEKLY_SENT_TO_HR' and entity_id = (select id from test.rcpkg('rc-a'))), 'every HR staff member is told, once');
select test.check((select array_agg(action order by id) = array['COMPILED', 'SAVED', 'SUBMITTED', 'REVISION_REQUESTED', 'RESUBMITTED', 'APPROVED']
                     from public.work_report_package_events where package_id = (select id from test.rcpkg('rc-a'))), 'the weekly history keeps every step');
set role authenticated;
select test.login('rc_oh');
select test.must_fail(format($$select work_report_weekly_review('%s', 'APPROVED', null)$$, (select id from test.rcpkg('rc-a'))), 'a decided week cannot be decided again', 'not waiting');

-- Beta: submitted and approved too (it will stay partly reviewed)
select test.login('rc_mb');
insert into rc_ids select 'mba', (work_report_save(null, 'Beta Monday', test.rcweek(), 'DAILY', test.rcweek(), test.rcweek(), '{"remarks":"Calls made."}') ->> 'id')::uuid;
select work_report_submit(test.rcid('mba'));
select test.login('rc_dhb');
select work_report_weekly_save(test.rcweek(), 'Week 1 - Beta', null, null, null, true);
select test.login('rc_oh');
select work_report_weekly_review((select id from test.rcpkg('rc-b')), 'APPROVED', null);

-- ---------------------------------------------------------------------------
\echo '   HR performance reviews: each Team Lead and each Team Member separately'
select test.login('rc_m1');
select test.must_fail($$select hr_reviews_overview(null)$$, 'a Team Member cannot open the HR reviews', 'FORBIDDEN');
select test.login('rc_dha');
select test.must_fail($$select hr_reviews_overview(null)$$, 'nor a Department Head of another department', 'FORBIDDEN');
select test.login('rc_oh');
select test.must_fail($$select hr_reviews_overview(null)$$, 'nor the Operations Head', 'FORBIDDEN');
select test.login('rc_hr1');
select test.check((select count(*) = 2 from jsonb_array_elements(hr_reviews_overview(test.rcweek()) -> 'departments')), 'HR receives the approved weekly packages');
select test.check((select (d -> 'reviews' ->> 'expected')::int = 5 and (d -> 'reviews' ->> 'submitted')::int = 0 from jsonb_array_elements(hr_reviews_overview(test.rcweek()) -> 'departments') d where d ->> 'name' = 'RC Alpha'), 'five people to review in Alpha: 2 Team Leads and 3 Team Members');
select test.check((select jsonb_array_length(x -> 'teamLeads') = 2 from (select hr_reviews_department((select id from test.rcpkg('rc-a'))) x) q), 'HR opens the department: a box per Team Lead');
select test.check((select jsonb_array_length(l -> 'members') = 2 and (l -> 'stats' ->> 'submitted')::int = 1 from jsonb_array_elements(hr_reviews_department((select id from test.rcpkg('rc-a'))) -> 'teamLeads') l where l ->> 'name' = 'RC tl1'), 'each Team Lead box lists its Team Members, with the person''s figures');
select test.check((select (m -> 'stats' ->> 'tlApproved')::int = 1 and (m -> 'stats' ->> 'dhApproved')::int = 1 and (m -> 'stats' ->> 'revisionRequests')::int = 0
                     from jsonb_array_elements(hr_reviews_department((select id from test.rcpkg('rc-a'))) -> 'teamLeads' -> 0 -> 'members') m where m ->> 'name' = 'RC m1'), 'with the Team Lead and Department Head approval records');
select test.check((select (m -> 'stats' ->> 'revisionRequests')::int = 1 from jsonb_array_elements(hr_reviews_department((select id from test.rcpkg('rc-a'))) -> 'teamLeads' -> 0 -> 'members') m where m ->> 'name' = 'RC m2'), 'and the revision history');
select test.check(jsonb_array_length(hr_person_reports((select id from test.rcpkg('rc-a')), test.id('rc_m1'))) = 1, 'the daily report history of a person loads on demand');
select test.check((work_report_get(test.rcid('m1a')) ->> 'status') = 'APPROVED', 'HR reads the daily report (read only)');
select test.must_fail(format($$select work_report_review('%s', 'REJECTED', 'HR cannot do this')$$, test.rcid('m1a')), 'HR cannot change a report''s approval', 'NOT_FOUND|not waiting');
select test.must_fail(format($$select hr_review_save('%s', test.id('rc_mb'), 3, null, 'fine', null, null, false)$$, (select id from test.rcpkg('rc-a'))), 'a person of another department cannot be reviewed in this package', 'NOT_FOUND');
select test.must_fail(format($$select hr_review_save('%s', test.id('rc_m1'), 9, null, 'fine', null, null, false)$$, (select id from test.rcpkg('rc-a'))), 'a rating must be on the scale', 'scale');
select test.must_fail(format($$select hr_review_save('%s', test.id('rc_m1'), null, null, 'fine', null, null, true)$$, (select id from test.rcpkg('rc-a'))), 'a final review needs a rating', 'rating');
select test.check((hr_review_save((select id from test.rcpkg('rc-a')), test.id('rc_tl1'), 4, 'Reports daily', 'Strong delivery', 'Well led', 'Mentor others', false) ->> 'status') = 'DRAFT', 'a draft review is saved');
select test.check((select status = 'HR_REVIEW_IN_PROGRESS' from test.rcpkg('rc-a')), 'the first review moves the week to HR Review In Progress');
select test.check((select status = 'SENT_TO_HR' from test.rcpkg('rc-b')), 'another week is untouched');
select test.check((select status = 'APPROVED' from test.rc(test.rcid('m1a'))), 'a review never changes a report''s approval status');
select test.login('rc_hr2');
select test.check((hr_review_save((select id from test.rcpkg('rc-a')), test.id('rc_tl1'), 5, 'Reports daily', 'Strong delivery', 'Well led', 'Mentor others', true) ->> 'status') = 'SUBMITTED', 'a colleague can finish the draft and submit it');
select test.must_fail(format($$select hr_review_save('%s', test.id('rc_tl1'), 1, null, 'changed', null, null, false)$$, (select id from test.rcpkg('rc-a'))), 'a submitted review stays unchanged', 'already submitted');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_review_history(test.id('rc_tl1')))), 'it is in the person''s history');
select test.login('rc_hr1');
select hr_review_save((select id from test.rcpkg('rc-a')), test.id('rc_tl2'), 3, null, 'Steady', null, null, true);
select hr_review_save((select id from test.rcpkg('rc-a')), test.id('rc_m1'), 4, null, 'Good', null, 'Take the lead on demos', true);
select hr_review_save((select id from test.rcpkg('rc-a')), test.id('rc_m2'), 2, null, 'Reports need more detail', null, null, true);
-- the consolidated report before the last review: incomplete sections are named
select test.check((hr_consolidated_get(test.rcweek()) -> 'readiness' -> 'pending' -> 0 -> 'missingReviews' -> 0 ->> 'name') = 'RC m3', 'the preview names the missing review');
select test.check((hr_consolidated_get(test.rcweek()) ->> 'stage') = 'PARTIALLY_REVIEWED', 'the final performance status is Partially Reviewed');
select test.must_fail($$select hr_consolidated_save(test.rcweek(), 'too early', true)$$, 'nothing complete: nothing can be submitted yet', 'No department');
select test.check((hr_consolidated_save(test.rcweek(), 'Draft note', false) ->> 'status') = 'DRAFT', 'it can be saved as a draft while reviews remain');
select hr_review_save((select id from test.rcpkg('rc-a')), test.id('rc_m3'), 3, null, 'Fine', null, null, true);
reset role;
select test.check((select status = 'HR_REVIEW_COMPLETED' and hr_completed_at is not null from test.rcpkg('rc-a')), 'every person reviewed: HR Review Completed');
select test.check((select count(*) = 5 and bool_and(status = 'SUBMITTED') from public.hr_performance_reviews where package_id = (select id from test.rcpkg('rc-a'))), 'five separate review records, one per person');
select test.check((select count(distinct subject_id) = 5 from public.hr_performance_reviews where package_id = (select id from test.rcpkg('rc-a'))), 'never one generic rating');
set role authenticated;
select test.login('rc_hr1');
select hr_review_save((select id from test.rcpkg('rc-b')), test.id('rc_tlb'), 3, null, 'Steady', null, null, false);

-- ---------------------------------------------------------------------------
\echo '   consolidated report: only the completed departments are finalised'
select test.check((hr_consolidated_get(test.rcweek()) ->> 'stage') = 'PARTIALLY_REVIEWED', 'still partly reviewed (Beta)');
select test.check((select jsonb_array_length(hr_consolidated_get(test.rcweek()) -> 'readiness' -> 'complete') = 1 and jsonb_array_length(hr_consolidated_get(test.rcweek()) -> 'readiness' -> 'pending') = 1), 'one department complete, one pending');
select test.check((hr_consolidated_get(test.rcweek()) -> 'readiness' -> 'pending' -> 0 ->> 'department') = 'RC Beta', 'Beta is named as incomplete');
select test.check(exists (select 1 from jsonb_array_elements(hr_consolidated_get(test.rcweek()) -> 'readiness' -> 'pending' -> 0 -> 'missingReviews') m where m ->> 'name' = 'RC tlb' and (m ->> 'draft')::boolean), 'and which reviews are only drafts');
select test.login('rc_dha');
select test.must_fail($$select hr_consolidated_save(test.rcweek(), 'x', true)$$, 'only HR submits it', 'FORBIDDEN');
select test.login('rc_hr1');
select test.check((hr_consolidated_save(test.rcweek(), 'Week 1 company performance', true) ->> 'submittedDepartments')::int = 1, 'submitted: the one complete department goes to the Super Admin');
reset role;
select test.check((select status = 'SUBMITTED_TO_SUPERADMIN' from test.rcpkg('rc-a')), 'the complete week is Submitted to Superadmin');
select test.check((select status = 'HR_REVIEW_IN_PROGRESS' from test.rcpkg('rc-b')), 'the incomplete week is NOT marked as finalised: it stays in HR Review In Progress');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_CONSOLIDATED_SUBMITTED' and recipient_id = test.id('sa')), 'the Super Admin is notified once');
select test.check((select count(*) = 1 from public.hr_consolidated_packages cp join public.hr_consolidated_reports c on c.id = cp.consolidated_id where c.period_start = test.rcweek()), 'an auditable submission record points at the included package');
select test.check((select count(*) = 1 from audit_logs where action = 'HR_CONSOLIDATED_SUBMITTED' and entity_id = (select id from public.hr_consolidated_reports where period_start = test.rcweek())), 'and the audit log');
set role authenticated;
select test.login('rc_hr1');
select test.must_fail(format($$select hr_review_save('%s', test.id('rc_m1'), 1, null, 'changed', null, null, false)$$, (select id from test.rcpkg('rc-a'))), 'a submitted week is closed to review changes', 'already submitted');

-- ---------------------------------------------------------------------------
\echo '   Super Admin: company reports, leaderboard, AI analysis facts'
select test.login('sa');
select test.check((select jsonb_array_length(sa_consolidated_list()) = 1 and (sa_consolidated_list() -> 0 ->> 'status') = 'SUBMITTED_TO_SUPERADMIN'), 'the Super Admin receives the HR consolidated report');
select test.check((select jsonb_array_length(sa_consolidated_get((sa_consolidated_list() -> 0 ->> 'id')::uuid) -> 'departments') = 1), 'with its department');
select test.check((hr_reviews_department((select id from test.rcpkg('rc-a'))) -> 'teamLeads' -> 0 -> 'review' ->> 'rating') is not null, 'the HR ratings are shown with the person (apart from the figures)');
select test.login('rc_hr1');
select test.must_fail($$select sa_consolidated_list()$$, 'HR cannot open the Super Admin''s reports', 'FORBIDDEN');
select test.must_fail($$select report_leaderboard('{}')$$, 'nor the leaderboard', 'FORBIDDEN');
select test.login('rc_oh');
select test.must_fail($$select report_leaderboard('{}')$$, 'neither can the Operations Head', 'FORBIDDEN');
select test.login('rc_m1');
select test.must_fail($$select report_leaderboard('{}')$$, 'nor a Team Member', 'FORBIDDEN');
select test.must_fail($$select report_analysis_facts(current_date - 7, current_date)$$, 'nor the analysis', 'FORBIDDEN');
select test.login('sa');
select test.check((report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek())) -> 'period' ->> 'from')::date = test.rcweek(), 'the leaderboard follows the chosen period');
-- people with enough data are ranked, the others are Insufficient Data
select test.check((select count(*) >= 5 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'department', test.dept('rc-a'), 'category', 'ALL')) -> 'rows') r where r ->> 'status' = 'RANKED'),
  'the Alpha people are ranked');
select test.check((select (r -> 'breakdown' -> 0 ->> 'key') = 'taskCompletion' and jsonb_array_length(r -> 'breakdown') = 5 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'person', test.id('rc_m1'))) -> 'rows') r),
  'the score breakdown is shown');
select test.check((select (r ->> 'completionRate')::numeric = 66.7 and (r ->> 'assignedTasks')::int = 3 and (r ->> 'completedTasks')::int = 2 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'person', test.id('rc_m1'))) -> 'rows') r),
  'the task completion comes from the task records');
select test.check((select (r ->> 'hrRating')::numeric = 4 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'person', test.id('rc_m1'))) -> 'rows') r), 'the HR rating is shown next to the measures');
select test.check((select (r ->> 'reportsExpected')::int = 5 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'person', test.id('rc_m3'))) -> 'rows') r),
  'the leave day is not expected from the member on leave');
select test.check((select count(*) = 6 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'department', test.dept('rc-a'), 'category', 'TOP10')) -> 'rows') r), 'Top 10 follows the filters (the six ranked people of Alpha)');
select test.check((select bool_and((a ->> 'score')::numeric >= (b ->> 'score')::numeric) from (
    select r a, lead(r) over (order by ord) b from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'TOP10')) -> 'rows') with ordinality t(r, ord)) q where b is not null),
  'Top 10 is sorted best first');
select test.check((select bool_and((a ->> 'score')::numeric <= (b ->> 'score')::numeric) from (
    select r a, lead(r) over (order by ord) b from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'BOTTOM10')) -> 'rows') with ordinality t(r, ord)) q where b is not null),
  'Bottom 10 is sorted worst first');
select test.check(not exists (select 1 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'BOTTOM10')) -> 'rows') r where r ->> 'status' <> 'RANKED'),
  'Bottom 10 never contains Insufficient Data');
select test.check((select count(*) >= 1 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'BOTTOM10')) -> 'insufficientData') r where r ->> 'name' = 'RC hr1'),
  'people without enough data are listed apart as Insufficient Data (HR staff wrote no report)');
select test.check((select bool_and(r ->> 'role' = 'TEAM_MEMBER') from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'TOP_MEMBERS')) -> 'rows') r), 'Top Team Members holds only Team Members');
select test.check((select bool_and(r ->> 'role' = 'TEAM_LEAD') from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'LOWEST_LEADS')) -> 'rows') r), 'Lowest Team Leads holds only Team Leads');
select test.check((select count(*) >= 2 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'category', 'TOP_DEPARTMENTS')) -> 'rows')), 'departments are ranked');
select test.check((select bool_and(r ->> 'department' = 'RC Alpha') from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'department', test.dept('rc-a'), 'category', 'ALL')) -> 'rows') r), 'the department filter works');
select test.check((select count(*) = 1 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'person', test.id('rc_m2'), 'category', 'ALL')) -> 'rows')), 'the individual filter works');
select test.check((select bool_and(r ->> 'teamLead' = 'RC tl1' or r ->> 'id' = test.id('rc_tl1')::text) from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'teamLead', test.id('rc_tl1'), 'category', 'ALL')) -> 'rows') r), 'the Team Lead filter works');
select test.check((select bool_and(r ->> 'department' = 'RC Alpha') from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'departmentHead', test.id('rc_dha'), 'category', 'ALL')) -> 'rows') r), 'the Department Head filter works');
select test.check((select bool_and(r ->> 'department' in ('RC Alpha', 'RC Beta')) from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'operationsHead', test.id('rc_oh'), 'category', 'ALL')) -> 'rows') r), 'the Operations Head filter works');
select test.check((select count(*) = 0 from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'department', test.dept('rc-a'), 'ratingMin', 4.5, 'category', 'ALL')) -> 'rows') r where (r ->> 'hrRating')::numeric < 4.5), 'the HR rating filter works');
select test.check((report_leaderboard(jsonb_build_object('periodType', 'DAILY', 'from', test.rcweek())) -> 'period' ->> 'to')::date = test.rcweek(), 'a daily period is one day');
select test.check((report_leaderboard(jsonb_build_object('periodType', 'CUSTOM', 'from', test.rcweek(), 'to', test.rcweek() + 13)) -> 'period' ->> 'to')::date = test.rcweek() + 13, 'a custom range works');
select test.check((report_leaderboard(jsonb_build_object('periodType', 'MONTHLY', 'from', test.rcweek())) -> 'period' ->> 'type') = 'MONTHLY', 'a monthly period works');
select test.must_fail($$select report_leaderboard('{"periodType":"CUSTOM"}')$$, 'a custom range needs both dates', 'custom period');
select test.must_fail($$select report_leaderboard('{"category":"BEST"}')$$, 'an unknown category is refused', 'category');
select test.check((select r ->> 'trend' in ('IMPROVING', 'STABLE', 'DECLINING', 'NO_TREND') from jsonb_array_elements(report_leaderboard(jsonb_build_object('periodType', 'WEEKLY', 'from', test.rcweek(), 'person', test.id('rc_m1'))) -> 'rows') r), 'every row has a trend');
select test.check((report_leaderboard_options() -> 'departments') is not null and jsonb_array_length(report_leaderboard_options() -> 'people') > 5, 'the filter choices come from the database');
-- the employee profile
select test.check((report_employee_profile(test.id('rc_m1'), 'WEEKLY', test.rcweek()) ->> 'name') = 'RC m1' and jsonb_array_length(report_employee_profile(test.id('rc_m1'), 'WEEKLY', test.rcweek()) -> 'reports') = 1
  and jsonb_array_length(report_employee_profile(test.id('rc_m1'), 'WEEKLY', test.rcweek()) -> 'hrReviews') = 1 and jsonb_array_length(report_employee_profile(test.id('rc_m1'), 'WEEKLY', test.rcweek()) -> 'weeks') = 8, 'the employee profile has the reports, the HR reviews and the weekly history');
-- scoring settings
select test.must_fail($$select report_settings_update('{"taskCompletion":0,"compliance":0,"onTime":0,"approvalQuality":0,"hrRating":0}', 3, 3, array[1,2,3,4,5,6])$$, 'at least one weight is needed', 'weight');
select test.must_fail($$select report_settings_update('{"taskCompletion":50,"compliance":20,"onTime":10,"approvalQuality":10,"hrRating":500}', 3, 3, array[1,2,3,4,5,6])$$, 'a weight is at most 100', 'weight');
select test.check((report_settings_update('{"taskCompletion":40,"compliance":20,"onTime":10,"approvalQuality":10,"hrRating":20}', 3, 3, array[1,2,3,4,5,6]) -> 'weights' ->> 'taskCompletion')::int = 40, 'the Super Admin changes the weights');
select test.login('rc_hr1');
select test.must_fail($$select report_settings_update('{"taskCompletion":40,"compliance":20,"onTime":10,"approvalQuality":10,"hrRating":20}', 3, 3, array[1,2,3,4,5,6])$$, 'HR can read but not change them', 'FORBIDDEN');
select test.check((report_settings_get() ->> 'canEdit')::boolean is false, 'HR sees them read only');
select test.login('sa');
select report_settings_update('{"taskCompletion":35,"compliance":20,"onTime":10,"approvalQuality":10,"hrRating":25}', 3, 3, array[1,2,3,4,5,6]);

-- AI analysis facts: measurable and traceable
select test.check((report_analysis_facts(test.rcweek(), test.rcweek() + 6) -> 'counts' ->> 'people')::int >= 10, 'the facts count the people');
select test.check((report_analysis_facts(test.rcweek(), test.rcweek() + 6) -> 'thresholds' ->> 'lowCompletion')::int = 50, 'the thresholds are part of the facts');
select test.check((select bool_and(f ? 'factId' and f ? 'sources' and f ? 'subjectId') from jsonb_array_elements(report_analysis_facts(test.rcweek(), test.rcweek() + 6) -> 'missingReports') f), 'every fact names its record and its sources');
select test.check((select count(*) = 0 from jsonb_array_elements(report_analysis_facts(test.rcweek(), test.rcweek() + 6) -> 'repeatedRevisions') f where f ->> 'name' = 'RC m2'), 'one revision request is not called a repeated pattern (the threshold is 3)');
select test.check((select count(*) >= 1 from jsonb_array_elements(report_analysis_facts(test.rcweek(), test.rcweek() + 6) -> 'lowCompletion') f where f ->> 'name' = 'RC m2') , 'low completion: m2 completed 1 of 3 tasks');
reset role;
-- the writer (service key) stores the analysis; the consolidated report becomes AI Analysis Completed; the Super Admin is told once
select test.service();
set role service_role;
select report_analysis_store(test.rcweek(), test.rcweek() + 6, '{"x":1}', '{"summary":"s"}', 'RULES', 'NOT_CONFIGURED', null, null);
reset role;
select test.check((select status = 'AI_ANALYSIS_COMPLETED' from public.hr_consolidated_reports where period_start = test.rcweek()), 'AI Analysis Completed');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_ANALYSIS_READY' and recipient_id = test.id('sa')), 'the Super Admin is told the analysis is ready');
set role authenticated;
select test.login('sa');
select test.check((report_analysis_latest(test.rcweek(), test.rcweek() + 6) ->> 'source') = 'RULES', 'the stored analysis is read back, apart from the reports');
select test.login('rc_oh');
select test.must_fail($$select report_analysis_latest(current_date - 7, current_date)$$, 'only the Super Admin reads it', 'FORBIDDEN');
select test.must_fail($$select report_analysis_store(current_date - 7, current_date, '{}', '{}', 'AI', 'OK', null, null)$$, 'and no login can write one', 'permission denied');

-- ---------------------------------------------------------------------------
\echo '   nobody reads or writes the tables directly'
select test.login('rc_hr1');
select test.must_fail($$select * from public.hr_performance_reviews$$, 'the reviews table is closed', 'permission denied');
select test.must_fail($$select * from public.hr_consolidated_reports$$, 'so is the consolidated table', 'permission denied');
select test.must_fail($$select * from public.report_ai_analyses$$, 'and the analyses', 'permission denied');
select test.must_fail($$select * from public.report_settings$$, 'and the settings', 'permission denied');
select test.must_fail($$select * from public.work_report_package_events$$, 'and the weekly history', 'permission denied');
select test.must_fail($$update public.work_reports set status = 'APPROVED'$$, 'HR cannot edit a report', 'permission denied');
reset role;
\echo '--- 92. passed'
