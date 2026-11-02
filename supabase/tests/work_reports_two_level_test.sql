-- =============================================================================
-- Work reports, two-level approval (migration 20261217000100):
--   Team Member -> Team Lead (stage 1) -> Department Head (stage 2) -> Fully approved.
-- Own synthetic departments and people (prefix wr2). Runs after work_reports_test.sql, which re-applies the first migration, so this
-- file applies the second one again first (the migrations are safe to run twice).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 91. Work reports: two-level approval'
reset role;
\i supabase/migrations/20261217000100_reports_two_level_approval.sql

delete from public.work_report_signals;
delete from public.work_report_packages where department_id in (select id from departments where slug like 'wr2-%');
delete from public.work_reports where department_id in (select id from departments where slug like 'wr2-%');
delete from public.work_tasks where department_id in (select id from departments where slug like 'wr2-%');
delete from auth.users where email like 'wr2.%@example.com';
delete from test.users where name like 'wr2\_%';
delete from teams where department_id in (select id from departments where slug like 'wr2-%');
delete from departments where slug like 'wr2-%';
insert into departments (slug, name) values ('wr2-home', 'WR2 Home'), ('wr2-a', 'WR2 Alpha'), ('wr2-b', 'WR2 Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'wr2-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'wr2-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.wr2mk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'wr2.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'WR2 ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   people: an Operations Head, Department Heads, Team Leads and Team Members'
select test.service(); select test.wr2mk('wr2_oh', 'DEPARTMENT_HEAD', 'wr2-home');
select test.service(); select test.wr2mk('wr2_dha', 'DEPARTMENT_HEAD', 'wr2-a');
select test.service(); select test.wr2mk('wr2_dhb', 'DEPARTMENT_HEAD', 'wr2-b');
select test.service(); select test.wr2mk('wr2_tl1', 'TEAM_HEAD', 'wr2-a', 'Sales');
select test.service(); select test.wr2mk('wr2_tl2', 'TEAM_HEAD', 'wr2-a', 'Support');
select test.service(); select test.wr2mk('wr2_tlb', 'TEAM_HEAD', 'wr2-b', 'Sales');
select test.service(); select test.wr2mk('wr2_m1', 'TEAM_MEMBER', 'wr2-a', 'Sales');
select test.service(); select test.wr2mk('wr2_m2', 'TEAM_MEMBER', 'wr2-a', 'Sales');
select test.service(); select test.wr2mk('wr2_m3', 'TEAM_MEMBER', 'wr2-a', 'Support');
select test.service(); select test.wr2mk('wr2_mb', 'TEAM_MEMBER', 'wr2-b', 'Sales');
select test.check((select count(*) = 10 from profiles where id in (select id from test.users where name like 'wr2\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');

set role authenticated;
select test.login('sa');
select set_operations_head(test.id('wr2_oh'), true, 'test');
select operations_head_scope_set(test.id('wr2_oh'), array[test.dept('wr2-a')], array[test.dept('wr2-a')]);
reset role;
select test.check(private.owner_of_department(test.dept('wr2-a')) = test.id('wr2_oh'), 'the Operations Head manages Alpha');

-- the task records (owner-run: the app roles have no table access); m1 has a completed and an open task, m2 and mb have their own
create or replace function test.wr2task(p_owner text, p_dept text, p_team text, p_title text, p_status text) returns uuid language sql security definer set search_path = '' as $$
  insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, status, progress, completed_at)
  values (test.dept(p_dept), test.team(p_dept, p_team), p_title, test.id('sa'), test.id(p_owner), p_status, case when p_status = 'COMPLETED' then 100 else 20 end,
          case when p_status = 'COMPLETED' then now() end)
  returning id
$$;
create or replace function test.wr2(p_id uuid) returns public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports where id = p_id $$;
create or replace function test.wr2_all() returns setof public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports where department_id in (select id from public.departments where slug like 'wr2-%') $$;
create or replace function test.wr2_events(p_id uuid) returns setof public.work_report_events language sql stable security definer set search_path = '' as $$ select * from public.work_report_events where report_id = p_id order by id $$;
grant execute on function test.wr2task(text, text, text, text, text), test.wr2(uuid), test.wr2_all(), test.wr2_events(uuid) to anon, authenticated;
create temp table wr2_ids (name text primary key, id uuid);
grant all on wr2_ids to anon, authenticated, service_role;
insert into wr2_ids values
  ('t1', test.wr2task('wr2_m1', 'wr2-a', 'Sales', 'Call the new leads', 'COMPLETED')),
  ('t2', test.wr2task('wr2_m1', 'wr2-a', 'Sales', 'Prepare the demo deck', 'IN_PROGRESS')),
  ('t3', test.wr2task('wr2_m2', 'wr2-a', 'Sales', 'Follow up the renewals', 'COMPLETED')),
  ('t4', test.wr2task('wr2_m2', 'wr2-a', 'Sales', 'Update the CRM notes', 'COMPLETED'));

-- ---------------------------------------------------------------------------
\echo '   Team Member: the simple report and the real task records'
set role authenticated;
select test.login('wr2_m1');
select test.check((select count(*) = 2 and bool_and(t ->> 'title' in ('Call the new leads', 'Prepare the demo deck')) from jsonb_array_elements(work_reports_my_tasks()) t), 'the task list holds only the member''s own tasks');
select test.check((select (t ->> 'status') = 'COMPLETED' from jsonb_array_elements(work_reports_my_tasks()) t where t ->> 'title' = 'Call the new leads'), 'with their real status');
insert into wr2_ids select 'm1a', (work_report_save(null, 'Daily report M1', current_date, 'WEEKLY', current_date - 3, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from wr2_ids where name = 't1'), (select id from wr2_ids where name = 't2')),
                     'completedTasks', jsonb_build_array((select id from wr2_ids where name = 't1')),
                     'challenges', 'dropped', 'attachments', jsonb_build_array(jsonb_build_object('url', 'https://example.com/x')))) ->> 'id')::uuid;
select test.check((select status = 'DRAFT' and tl_status is null and period_start = current_date and period_end = current_date and period_type = 'DAILY' from test.wr2((select id from wr2_ids where name = 'm1a'))),
  'a member report is for the report date only');
select test.check((select jsonb_array_length(content -> 'assignedTasks') = 2 and jsonb_array_length(content -> 'completedTasks') = 1
                      and not content ? 'challenges' and not content ? 'attachments' and content -> 'completedTasks' -> 0 ->> 'title' = 'Call the new leads'
                   from test.wr2((select id from wr2_ids where name = 'm1a'))), 'only the two task lists are kept, as a snapshot of the task records');
select test.check((work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'excerpt') = '1 of 2 assigned tasks completed', 'the list shows how many tasks were completed');
select test.must_fail(format($$select work_report_save(null, 'Foreign task', current_date, 'DAILY', current_date, current_date, '{"assignedTasks":["%s"]}')$$, (select id from wr2_ids where name = 't3')),
  'a task assigned to someone else cannot be reported', 'assigned to you');
select test.must_fail(format($$select work_report_save(null, 'Not done', current_date, 'DAILY', current_date, current_date, '{"assignedTasks":["%1$s"],"completedTasks":["%1$s"]}')$$, (select id from wr2_ids where name = 't2')),
  'a task that is not completed in the task records cannot be reported as completed', 'not marked completed');
select test.must_fail(format($$select work_report_save(null, 'Not assigned', current_date, 'DAILY', current_date, current_date, '{"completedTasks":["%s"]}')$$, (select id from wr2_ids where name = 't1')),
  'a completed task must be among the assigned ones', 'one of your assigned');
select test.must_fail($$select work_report_save(null, 'Bad id', current_date, 'DAILY', current_date, current_date, '{"assignedTasks":["nope"]}')$$, 'a task id must be valid', 'task list');
select test.must_fail($$select work_report_save(null, 'Future', current_date + 5, 'DAILY', current_date, current_date, '{}')$$, 'the report date cannot be in the future', 'future');
select test.must_fail($$select work_report_save(null, 'Old', current_date - 90, 'DAILY', current_date, current_date, '{}')$$, 'nor older than 60 days', '60 days');
select test.must_fail($$select work_report_save(null, 'x', current_date, 'DAILY', current_date, current_date, '{}')$$, 'a title is required', 'title');
select test.check(not exists (select 1 from notifications where type = 'REPORT_SUBMITTED' and entity_id = (select id from wr2_ids where name = 'm1a')), 'a draft notifies nobody');
select work_report_submit((select id from wr2_ids where name = 'm1a'));
select test.check((select status = 'SUBMITTED' and tl_status = 'PENDING' and dh_status is null and team_lead_name = 'WR2 tl1' and team_lead_id = test.id('wr2_tl1') from test.wr2((select id from wr2_ids where name = 'm1a'))),
  'submitted: waiting for the Team Lead, not yet for the Department Head');
select test.must_fail($$select work_report_submit((select id from wr2_ids where name = 'm1a'))$$, 'a report cannot be submitted twice', 'already submitted');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'the author cannot approve their own report', 'NOT_FOUND');
-- a report with no tasks at all is allowed (a day without tasks)
insert into wr2_ids select 'm1empty', (work_report_save(null, 'A day without tasks', current_date - 1, 'DAILY', current_date, current_date, '{}') ->> 'id')::uuid;
select test.check((select report_date = current_date - 1 and period_start = current_date - 1 from test.wr2((select id from wr2_ids where name = 'm1empty'))), 'another permitted date is accepted');
select work_report_submit((select id from wr2_ids where name = 'm1empty'));

select test.login('wr2_m2');
insert into wr2_ids select 'm2a', (work_report_save(null, 'Daily report M2', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from wr2_ids where name = 't3'), (select id from wr2_ids where name = 't4')),
                     'completedTasks', jsonb_build_array((select id from wr2_ids where name = 't3'), (select id from wr2_ids where name = 't4')))) ->> 'id')::uuid;
select work_report_submit((select id from wr2_ids where name = 'm2a'));
select test.must_fail($$select work_report_get((select id from wr2_ids where name = 'm1a'))$$, 'a Team Member cannot open a colleague''s report', 'NOT_FOUND');
select test.must_fail($$select work_reports_member_approvals()$$, 'nor the Department Head''s approval list', 'FORBIDDEN');
select test.must_fail($$select work_reports_team_box(current_date, current_date)$$, 'nor the Team Lead''s box', 'FORBIDDEN');
select test.login('wr2_m3');
insert into wr2_ids select 'm3a', (work_report_save(null, 'Support M3', current_date, 'DAILY', current_date, current_date, '{}') ->> 'id')::uuid;
select work_report_submit((select id from wr2_ids where name = 'm3a'));
select test.login('wr2_mb');
insert into wr2_ids select 'mba', (work_report_save(null, 'Beta report', current_date, 'DAILY', current_date, current_date, '{}') ->> 'id')::uuid;
select work_report_submit((select id from wr2_ids where name = 'mba'));
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_SUBMITTED' and recipient_id = test.id('wr2_tl1') and entity_id = (select id from wr2_ids where name = 'm1a')), 'the Team Lead is told once');
select test.check(not exists (select 1 from notifications where type in ('REPORT_SUBMITTED', 'REPORT_PENDING_DEPARTMENT_HEAD') and recipient_id in (test.id('wr2_dha'), test.id('wr2_oh'))), 'the Department Head and the Operations Head are not told yet');

-- ---------------------------------------------------------------------------
\echo '   stage 1: the Team Lead'
set role authenticated;
select test.login('wr2_dha');
select test.must_fail($$select work_report_get((select id from wr2_ids where name = 'm1a'))$$, 'the Department Head cannot open a report still waiting for the Team Lead', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'nor approve it (no skipping the Team Lead)', 'NOT_FOUND');
select test.check((work_reports_member_approvals() -> 'items') = '[]'::jsonb, 'the Department Head''s list is empty before any Team Lead approved');
select test.login('wr2_tl2');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'a Team Lead of another team cannot approve', 'NOT_FOUND');
select test.login('wr2_tl1');
select test.check((work_reports_context() ->> 'pendingReview')::int = 3, 'the Team Lead''s badge counts the three waiting reports');
select test.check((work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'status') = 'UNDER_REVIEW' and (work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'reviewStage') = 'TEAM_LEAD', 'opening a submitted report marks it under review, stage 1');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'REJECTED', '')$$, 'a rejection needs a reason', 'comment');
select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', 'Looks right');
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' and tl_status = 'APPROVED' and tl_reviewer_id = test.id('wr2_tl1') and tl_reviewer_name = 'WR2 tl1' and tl_reviewed_at is not null
                          and tl_comment = 'Looks right' and dh_status = 'PENDING' and dh_reviewed_at is null from test.wr2((select id from wr2_ids where name = 'm1a'))),
  'the Team Lead''s approval is recorded and the report waits for the Department Head: not final');
select test.check((work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'canReview')::boolean is false, 'the Team Lead cannot decide a second time');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'a Team Lead approval does not make it fully approved', 'not waiting');
select test.check((work_reports_team_box(current_date, current_date) -> 'counts' ->> 'pendingDh')::int = 1
  and (work_reports_team_box(current_date, current_date) -> 'counts' ->> 'approved')::int = 0, 'the team box counts it as waiting for the Department Head, not approved');
-- stage 1 rejection: the Department Head never sees it
select work_report_review((select id from wr2_ids where name = 'm1empty'), 'REJECTED', 'Not a real report');
select test.check((select status = 'REJECTED' and tl_status = 'REJECTED' and decision_stage = 'TEAM_LEAD' and dh_status is null from test.wr2((select id from wr2_ids where name = 'm1empty'))), 'a Team Lead rejection ends at stage 1');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_TL_APPROVED' and recipient_id = test.id('wr2_m1')), 'the member is told the Team Lead approved');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_PENDING_DEPARTMENT_HEAD' and recipient_id = test.id('wr2_dha') and entity_id = (select id from wr2_ids where name = 'm1a')), 'the Department Head is told it is waiting');
select test.check(not exists (select 1 from notifications where type = 'REPORT_PENDING_DEPARTMENT_HEAD' and recipient_id in (test.id('wr2_dhb'), test.id('wr2_oh'))), 'nobody else is');

-- ---------------------------------------------------------------------------
\echo '   stage 2: the Department Head'
set role authenticated;
select test.login('wr2_dha');
select test.check((work_reports_context() ->> 'pendingMemberApprovals')::int = 1 and (work_reports_context() ->> 'badge')::int = 1, 'the badge counts the report waiting for the Department Head');
select test.check(jsonb_array_length(work_reports_member_approvals('PENDING') -> 'items') = 1
  and (work_reports_member_approvals('PENDING') -> 'items' -> 0 ->> 'author') = 'WR2 m1' and (work_reports_member_approvals('PENDING') -> 'items' -> 0 ->> 'teamLead') = 'WR2 tl1'
  and (work_reports_member_approvals('PENDING') -> 'items' -> 0 ->> 'tlReviewedAt') is not null
  and jsonb_array_length(work_reports_member_approvals('PENDING') -> 'items' -> 0 -> 'content' -> 'assignedTasks') = 2, 'only the Team Lead-approved report is listed, with its Team Lead, approval date and tasks');
select test.check((work_reports_member_approvals() -> 'counts' ->> 'PENDING_DEPARTMENT_HEAD')::int = 1, 'and counted');
select test.check((work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'canReview')::boolean and (work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'reviewStage') = 'DEPARTMENT_HEAD', 'the Department Head can decide on it (stage 2)');
select test.check((work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'status') = 'PENDING_DEPARTMENT_HEAD', 'opening it does not change its status');
select test.must_fail($$select work_report_get((select id from wr2_ids where name = 'm1empty'))$$, 'a report the Team Lead rejected never reaches the Department Head', 'NOT_FOUND');
select test.must_fail($$select work_report_get((select id from wr2_ids where name = 'mba'))$$, 'nor does another department''s report', 'NOT_FOUND');
select test.check((select count(*) = 2 and bool_and((b -> 'counts' ->> 'approved')::int = 0) from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b), 'in the department box nothing is approved yet');
select test.check((select jsonb_array_length(b -> 'memberReports') = 1 and (b -> 'memberReports' -> 0 ->> 'status') = 'PENDING_DEPARTMENT_HEAD' and (b -> 'counts' ->> 'pendingDh')::int = 1 and (b -> 'counts' ->> 'pendingTl')::int = 1
                   from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b where b ->> 'lead' = 'WR2 tl1'),
  'the Team Lead box lists the pending report with its true status and counts the other (still with the Team Lead) as pending');
select test.check((select jsonb_array_length(b -> 'memberReports') = 0 from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b where b ->> 'lead' = 'WR2 tl2'), 'a report still with the Team Lead is counted but not listed');
select test.login('wr2_dhb');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'another department''s Department Head cannot approve it', 'NOT_FOUND');
select test.login('wr2_tl1');
select test.check((work_report_get((select id from wr2_ids where name = 'm1a')) ->> 'canReview')::boolean is false, 'the Team Lead cannot take the Department Head''s decision');
select test.login('sa');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'the Super Admin does not take part in the member approval chain', 'NOT_FOUND');
select test.login('wr2_oh');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', null)$$, 'neither does the Operations Head', 'NOT_FOUND');
select test.login('wr2_dha');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'REVISION_REQUIRED', ' ')$$, 'a revision request needs a comment', 'comment');
select work_report_review((select id from wr2_ids where name = 'm1a'), 'APPROVED', 'Approved for the record');
select test.check((select status = 'APPROVED' and dh_status = 'APPROVED' and dh_reviewer_id = test.id('wr2_dha') and dh_reviewed_at is not null and dh_comment = 'Approved for the record'
                          and tl_status = 'APPROVED' and tl_reviewer_id = test.id('wr2_tl1') from test.wr2((select id from wr2_ids where name = 'm1a'))),
  'fully approved, with both approvals kept');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm1a'), 'REJECTED', 'too late')$$, 'a fully approved report cannot be decided again', 'not waiting');
select test.check((select (b -> 'counts' ->> 'approved')::int = 1 and (b -> 'counts' ->> 'pendingDh')::int = 0 and (b -> 'memberReports' -> 0 ->> 'status') = 'APPROVED'
                   from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b where b ->> 'lead' = 'WR2 tl1'), 'now the Team Lead box shows it as fully approved');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_APPROVED' and recipient_id = test.id('wr2_m1') and title = 'Report fully approved'), 'the member is told it is fully approved');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_APPROVED' and recipient_id = test.id('wr2_tl1') and entity_id = (select id from wr2_ids where name = 'm1a')), 'and so is the Team Lead');
select test.check((select array_agg(action || ':' || coalesce(stage, '-') order by id) = array['CREATED:-', 'SUBMITTED:-', 'OPENED:TEAM_LEAD', 'APPROVED:TEAM_LEAD', 'APPROVED:DEPARTMENT_HEAD'] from test.wr2_events((select id from wr2_ids where name = 'm1a'))),
  'the history records each stage');

-- ---------------------------------------------------------------------------
\echo '   Department Head sends a report back: both stages repeat, the history stays'
set role authenticated;
select test.login('wr2_tl1');
select work_report_review((select id from wr2_ids where name = 'm2a'), 'APPROVED', null);
select test.login('wr2_dha');
select work_report_review((select id from wr2_ids where name = 'm2a'), 'REVISION_REQUIRED', 'Name the clients you followed up');
select test.check((select status = 'REVISION_REQUIRED' and decision_stage = 'DEPARTMENT_HEAD' and dh_status = 'REVISION_REQUIRED' and dh_comment = 'Name the clients you followed up'
                          and tl_status = 'APPROVED' and tl_reviewer_id = test.id('wr2_tl1') from test.wr2((select id from wr2_ids where name = 'm2a'))),
  'sent back by the Department Head: not approved, the Team Lead''s approval stays on record');
select test.check((work_reports_member_approvals() -> 'counts' ->> 'REVISION_REQUIRED')::int = 1, 'the Department Head still sees it, as revision required');
select test.login('wr2_m2');
select test.check((work_report_get((select id from wr2_ids where name = 'm2a')) ->> 'dhComment') = 'Name the clients you followed up'
  and (work_report_get((select id from wr2_ids where name = 'm2a')) ->> 'decisionStage') = 'DEPARTMENT_HEAD' and (work_report_get((select id from wr2_ids where name = 'm2a')) ->> 'canEdit')::boolean,
  'the member sees the Department Head''s comment and can revise');
select work_report_save((select id from wr2_ids where name = 'm2a'), 'Daily report M2 (revised)', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from wr2_ids where name = 't3'), (select id from wr2_ids where name = 't4')), 'completedTasks', jsonb_build_array((select id from wr2_ids where name = 't3'))));
select work_report_submit((select id from wr2_ids where name = 'm2a'));
select test.check((select status = 'SUBMITTED' and revision = 2 and tl_status = 'PENDING' and tl_reviewer_id is null and dh_status is null and dh_comment is null and review_comment is null from test.wr2((select id from wr2_ids where name = 'm2a'))),
  'resubmitted: back with the Team Lead as revision 2, both approvals cleared');
select test.check((select count(*) filter (where stage = 'TEAM_LEAD' and action = 'APPROVED') = 1 and count(*) filter (where stage = 'DEPARTMENT_HEAD' and action = 'REVISION_REQUESTED') = 1
                          and count(*) filter (where action = 'RESUBMITTED') = 1 from test.wr2_events((select id from wr2_ids where name = 'm2a'))), 'the first round stays in the history');
select test.login('wr2_dha');
select test.must_fail($$select work_report_get((select id from wr2_ids where name = 'm2a'))$$, 'the Department Head does not see it again until the Team Lead approves', 'NOT_FOUND');
select test.login('wr2_tl1');
select work_report_review((select id from wr2_ids where name = 'm2a'), 'APPROVED', 'Better');
select test.login('wr2_dha');
select test.check((work_reports_member_approvals('PENDING') -> 'items' -> 0 ->> 'revision')::int = 2, 'it is back in the Department Head''s pending list as revision 2');
select test.must_fail($$select work_report_review((select id from wr2_ids where name = 'm2a'), 'REJECTED', null)$$, 'a rejection needs a reason', 'comment');
select work_report_review((select id from wr2_ids where name = 'm2a'), 'REJECTED', 'Duplicate of last week');
select test.check((select status = 'REJECTED' and dh_status = 'REJECTED' and decision_stage = 'DEPARTMENT_HEAD' and tl_status = 'APPROVED' from test.wr2((select id from wr2_ids where name = 'm2a'))), 'a Department Head rejection is final and never approved');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_REJECTED' and recipient_id = test.id('wr2_m2')) and (select count(*) = 1 from notifications where type = 'REPORT_REJECTED' and recipient_id = test.id('wr2_tl1')), 'the employee and the Team Lead are told');

-- ---------------------------------------------------------------------------
\echo '   Operations Head: every status, only fully approved counted as approved'
set role authenticated;
select test.login('wr2_dha');
select work_report_package_submit(current_date - 1, current_date, 'WEEKLY', 'Days done');
select test.login('wr2_oh');
select test.check((select (d -> 'counts' ->> 'memberApproved')::int = 1 and (d -> 'counts' ->> 'memberPendingTl')::int = 1 and (d -> 'counts' ->> 'memberPendingDh')::int = 0
                          and (d -> 'counts' ->> 'memberRejected')::int = 2 and (d -> 'counts' ->> 'memberPending')::int = 1
                   from jsonb_array_elements(work_reports_operations(current_date - 1, current_date) -> 'departments') d), 'the department counts each status; one report is fully approved');
select test.check((select jsonb_agg(r ->> 'status' order by r ->> 'author') @> '["APPROVED", "REJECTED"]'::jsonb and count(*) = 3
                   from jsonb_array_elements(work_reports_operations_department(test.dept('wr2-a'), current_date - 1, current_date) -> 'teamLeads') b, jsonb_array_elements(b -> 'memberReports') r
                   where b ->> 'lead' = 'WR2 tl1'), 'the Team Lead box lists every member report with its true status');
select test.check((select count(*) = 1 from jsonb_array_elements(work_reports_operations_department(test.dept('wr2-a'), current_date - 1, current_date) -> 'teamLeads') b, jsonb_array_elements(b -> 'memberReports') r
                   where r ->> 'status' = 'APPROVED'), 'exactly one is fully approved');
select test.check((select count(*) = 1 from jsonb_array_elements(work_reports_operations_department(test.dept('wr2-a'), current_date - 1, current_date) -> 'teamLeads') b, jsonb_array_elements(b -> 'memberReports') r
                   where r ->> 'status' in ('SUBMITTED', 'UNDER_REVIEW') or r ->> 'status' = 'PENDING_DEPARTMENT_HEAD'), 'and the one still with the other Team Lead stays visible as pending');
select test.check((work_reports_operations_department(test.dept('wr2-a'), current_date + 10, current_date + 11) ->> 'released')::boolean is false, 'a period without a sent package still shows only counts');

-- ---------------------------------------------------------------------------
\echo '   live signals, grants and the migration run twice'
select test.login('wr2_tl1');
select test.check((select count(*) > 0 from work_report_signals), 'the Team Lead has live signals');
select test.check((select bool_and(recipient_id = test.id('wr2_tl1')) from work_report_signals), 'and only their own');
select test.login('wr2_mb');
select test.check((select count(*) = 1 and bool_and(recipient_id = test.id('wr2_mb')) from work_report_signals), 'another department''s member sees only the signal of their own submission');
select test.must_fail($$insert into work_report_signals (recipient_id, event) values (null, 'x')$$, 'nobody writes signals directly', 'permission denied');
select test.must_fail($$select count(*) from work_reports$$, 'the report table has no direct access', 'permission denied');
reset role;
select test.check((select count(*) = 0 from information_schema.role_table_grants where table_name in ('work_reports', 'work_report_events', 'work_report_packages') and grantee in ('anon', 'authenticated', 'public')), 'no table grants for the app roles');
select test.check((select count(*) = 0 from information_schema.role_table_grants where table_name = 'work_report_signals' and grantee in ('anon', 'public')) , 'signals are not readable anonymously');
select test.check(not exists (select 1 from pg_publication where pubname = 'supabase_realtime') or exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'work_report_signals'), 'the signals are published to Realtime');

-- a report approved under the old single-stage rules waits for the Department Head after the migration (and running it again changes nothing)
insert into public.work_reports (kind, author_id, author_name, department_id, team_id, title, report_date, period_start, period_end, status, submitted_at, reviewed_by, reviewed_by_name, reviewed_at, review_comment)
select 'MEMBER', test.id('wr2_m3'), 'WR2 m3', test.dept('wr2-a'), test.team('wr2-a', 'Support'), 'Legacy approved', current_date, current_date, current_date, 'APPROVED', now(), test.id('wr2_tl2'), 'WR2 tl2', now(), 'ok'
 where not exists (select 1 from public.work_reports where title = 'Legacy approved');
\i supabase/migrations/20261217000100_reports_two_level_approval.sql
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' and tl_status = 'APPROVED' and tl_reviewer_id = test.id('wr2_tl2') and dh_status = 'PENDING' from public.work_reports where title = 'Legacy approved'), 'an old single-stage approval becomes the Team Lead stage and waits for the Department Head');
\i supabase/migrations/20261217000100_reports_two_level_approval.sql
select test.check((select count(*) = 1 from public.work_reports where title = 'Legacy approved' and status = 'PENDING_DEPARTMENT_HEAD'), 'running the migration again changes nothing');
\echo '   work reports two-level approval: all checks passed'
