-- =============================================================================
-- AI Studio cross-team task assignment and multi-task daily reports (migration 20270219000100).
-- Two teams: Team Lead A (xt_lead_a) with Employee A (xt_mem_a) on "XT Web"; Team Lead B (xt_lead_b) with Employee C (xt_mem_c) on "XT Sales".
-- Team Lead B gives Employee A a task of XT Sales (cross-team); Employee A reports on three tasks of three projects in one daily report.
-- Own people and projects; removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 194. AI Studio: cross-team tasks and multi-task daily reports'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270219000100_ai_studio_cross_team_multi_task.sql
\i supabase/migrations/20270219000100_ai_studio_cross_team_multi_task.sql

delete from ai_studio_daily_reports where author_id in (select id from test.users where name like 'xt\_%');
delete from ai_studio_tasks where title like 'XT %';
delete from ai_studio_projects where name like 'XT %';
delete from performance_records where subject_id in (select id from test.users where name like 'xt\_%');
delete from auth.users where email like 'xt.%@example.com';
delete from test.users where name like 'xt\_%';

create or replace function test.xtmk(p_name text, p_role text) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'xt.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'XT ' || initcap(replace(substr(p_name, 4), '_', ' '))),
    jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role, 'provisioned_team_id', test.team('ai-studio', 'AI Studio Team'))) $$;
select test.xtmk('xt_lead_a', 'TEAM_HEAD'), test.xtmk('xt_lead_b', 'TEAM_HEAD'), test.xtmk('xt_lead_c', 'TEAM_HEAD'),
       test.xtmk('xt_mem_a', 'TEAM_MEMBER'), test.xtmk('xt_mem_c', 'TEAM_MEMBER');
update profiles set manager_id = test.id('xt_lead_a') where id = test.id('xt_mem_a');
update profiles set manager_id = test.id('xt_lead_b') where id = test.id('xt_mem_c');
insert into ai_studio_projects (name) values ('XT Web'), ('XT Sales'), ('XT Internal');
insert into ai_studio_project_members (project_id, profile_id)
select p.id, u.id from ai_studio_projects p, test.users u
 where (p.name = 'XT Web' and u.name in ('xt_lead_a', 'xt_mem_a')) or (p.name = 'XT Sales' and u.name in ('xt_lead_b', 'xt_mem_c'))
    or (p.name = 'XT Internal' and u.name in ('xt_lead_a', 'xt_mem_a'));
create temp table xt (k text primary key, v uuid);
grant all on xt to authenticated;
insert into xt select 'web', id from ai_studio_projects where name = 'XT Web';
insert into xt select 'sales', id from ai_studio_projects where name = 'XT Sales';
insert into xt select 'internal', id from ai_studio_projects where name = 'XT Internal';
-- a task of Employee C (somebody else's task, for the refusals)
with ins as (insert into ai_studio_tasks (project_id, title, assigned_by, assignee_id) select (select v from xt where k = 'sales'), 'XT Employee C task', test.id('xt_lead_b'), test.id('xt_mem_c') returning id)
insert into xt select 'T_C', id from ins;
create temp table xt_before as select id, manager_id, team_id, department_id, role, position from profiles where id = test.id('xt_mem_a');
grant select on xt_before to authenticated;

\echo '   01 standard assignment still works'
set role authenticated;
select test.login('xt_lead_a');
insert into xt select 'T_WEB', (ai_studio_task_assign((select v from xt where k = 'web'), test.id('xt_mem_a'), 'XT Website mobile responsiveness', null, 'HIGH', current_date + 3) ->> 'id')::uuid;
insert into xt select 'T_INT', (ai_studio_task_assign((select v from xt where k = 'internal'), test.id('xt_mem_a'), 'XT API testing', null, 'MEDIUM', current_date + 5) ->> 'id')::uuid;
reset role;
select test.check((select assignment_type = 'STANDARD' and owner_lead_id = test.id('xt_lead_a') and assignee_lead_id = test.id('xt_lead_a') from ai_studio_tasks where id = (select v from xt where k = 'T_WEB')),
  'a Team Lead''s task for their own member is a standard assignment');

\echo '   02 cross-team assignment'
set role authenticated;
select test.login('xt_lead_b');
select test.check((select (p ->> 'assignmentType') = 'CROSS_TEAM' and (p ->> 'eligible')::boolean and p ->> 'team' = 'XT Lead A''s team' and not (p ->> 'myTeam')::boolean
                          and (p #>> '{workload,active}')::int = 2 and (p #>> '{workload,highPriority}')::int = 1 and not (p ? 'tasks')
                     from jsonb_array_elements(ai_studio_assignees((select v from xt where k = 'sales')) -> 'people') p where (p ->> 'id')::uuid = test.id('xt_mem_a')),
  'Team Lead B sees Employee A (another team) as eligible for a cross-team task, with a workload summary (counts only)');
select test.check((select bool_and(p ->> 'role' = 'TEAM_MEMBER') and not bool_or((p ->> 'id')::uuid = test.id('xt_lead_b'))
                     from jsonb_array_elements(ai_studio_assignees((select v from xt where k = 'sales')) -> 'people') p), 'a Team Lead''s choices are Team Members only, never themselves');
insert into xt select 'T_X', (ai_studio_task_assign((select v from xt where k = 'sales'), test.id('xt_mem_a'), 'XT Campaign follow-up logic', 'Stop follow-ups after a positive reply', 'URGENT', current_date + 2) ->> 'id')::uuid;
reset role;
select test.check((select assignment_type = 'CROSS_TEAM' and assigned_by = test.id('xt_lead_b') and owner_lead_id = test.id('xt_lead_b') and assignee_lead_id = test.id('xt_lead_a')
                          and assignee_team_id = (select team_id from xt_before) from ai_studio_tasks where id = (select v from xt where k = 'T_X')),
  'the task is cross-team; it keeps the project-owning team (Lead B) and the employee''s Team Lead and team at that moment');
select test.check((select p.manager_id = b.manager_id and p.team_id is not distinct from b.team_id and p.department_id = b.department_id and p.role = b.role and p.position is not distinct from b.position
                     from profiles p, xt_before b where p.id = b.id) and private.direct_lead_of(test.id('xt_mem_a')) = test.id('xt_lead_a')
                  and not private.ai_studio_on_project((select v from xt where k = 'sales'), test.id('xt_mem_a')),
  'Employee A keeps their Team Lead, team, department and designation, and is not added to the XT Sales project');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('xt_mem_a') and type = 'AI_STUDIO_TASK_ASSIGNED_CROSS_TEAM' and title = 'New Cross-Team Task Assigned'
                     and body like 'You have been assigned "XT Campaign follow-up logic" under the "XT Sales" project by XT Lead B.%Priority: Urgent')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('xt_lead_a') and type = 'AI_STUDIO_CROSS_TEAM_ASSIGNMENT' and title = 'Cross-Team Assignment — Team Member'
                     and body like 'XT Mem A from your team has been assigned a task by XT Lead B from XT Lead B''s team.%XT Sales%'),
  'the employee and their own Team Lead are notified with the agreed wording');
select test.check((select count(*) = 1 from audit_logs where action = 'AI_STUDIO_TASK_ASSIGNED_CROSS_TEAM' and entity_id = (select v from xt where k = 'T_X')), 'the cross-team assignment is audited');

\echo '   03 refusals'
set role authenticated;
select test.login('xt_lead_c');
select test.must_fail(format($$select ai_studio_task_assign(%L, %L, 'XT not mine', null, 'LOW', null)$$, (select v from xt where k = 'sales'), test.id('xt_mem_a')),
  'a Team Lead who is not on the project cannot give its tasks to another team', 'only on a project you are on');
select test.login('xt_lead_b');
select test.must_fail(format($$select ai_studio_task_assign(%L, (select id from profiles where department_id <> private.ai_studio_department() and role = 'TEAM_MEMBER' and status = 'ACTIVE' limit 1), 'XT outsider', null, 'LOW', null)$$, (select v from xt where k = 'sales')),
  'nobody outside AI Studio can be given an AI Studio task', 'active Team Lead or Team Member of AI Studio');
select test.must_fail(format($$select ai_studio_task_assign(%L, %L, 'XT a lead', null, 'LOW', null)$$, (select v from xt where k = 'sales'), test.id('xt_lead_a')),
  'a Team Lead does not give another Team Lead tasks', 'gives tasks to Team Members');
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('xt_mem_c');
set role authenticated;
select test.login('xt_lead_b');
select test.check(not exists (select 1 from jsonb_array_elements(ai_studio_assignees((select v from xt where k = 'sales')) -> 'people') p where (p ->> 'id')::uuid = test.id('xt_mem_c')),
  'an inactive employee is not offered');
select test.must_fail(format($$select ai_studio_task_assign(%L, %L, 'XT inactive', null, 'LOW', null)$$, (select v from xt where k = 'sales'), test.id('xt_mem_c')), 'nor accepted', 'active Team Lead or Team Member');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('xt_mem_c');

\echo '   04-06 who sees and who changes the cross-team task'
set role authenticated;
select test.login('xt_mem_a');
select test.check((select count(*) = 3 from jsonb_array_elements(ai_studio_tasks_list('mine') -> 'items') i where i ->> 'title' like 'XT %')
                  and (select count(*) = 1 and bool_and(i ->> 'assignmentType' = 'CROSS_TEAM' and i ->> 'ownerTeam' = 'XT Lead B''s team')
                         from jsonb_array_elements(ai_studio_tasks_page('mine', null, null, null, 1, 25, 'CROSS_TEAM') -> 'items') i where i ->> 'title' like 'XT %')
                  and (select count(*) = 2 from jsonb_array_elements(ai_studio_tasks_page('mine', null, null, null, 1, 25, 'STANDARD') -> 'items') i where i ->> 'title' like 'XT %'),
  'Employee A sees both standard and cross-team tasks, and can filter My Team / Cross-Team');
select test.check((select (p ->> 'viaTask')::boolean and not (p ->> 'mine')::boolean and (p #>> '{tasks,total}')::int = 1
                     from jsonb_array_elements(ai_studio_projects_list()) p where p ->> 'name' = 'XT Sales'),
  'XT Sales appears in Employee A''s projects through the task only (one task: theirs)');
select test.login('xt_lead_b');
select test.check((ai_studio_task_get((select v from xt where k = 'T_X')) ->> 'canEdit')::boolean, 'Team Lead B (who gave it) may change the task');
select test.must_fail(format($$select ai_studio_task_get(%L)$$, (select v from xt where k = 'T_WEB')), 'but cannot open Employee A''s other tasks', 'not found');
select test.check(not exists (select 1 from jsonb_array_elements(ai_studio_tasks_list('team') -> 'items') i where (i ->> 'id')::uuid in ((select v from xt where k = 'T_WEB'), (select v from xt where k = 'T_INT')))
                  and exists (select 1 from jsonb_array_elements(ai_studio_tasks_list('team') -> 'items') i where (i ->> 'id')::uuid = (select v from xt where k = 'T_X')),
  'Team Lead B''s team list holds the task they gave Employee A, none of Employee A''s other tasks');
select test.login('xt_lead_a');
select test.check((select (j ->> 'canEdit')::boolean = false and j ->> 'assignmentType' = 'CROSS_TEAM' and j ->> 'ownerTeam' = 'XT Lead B''s team'
                     from (select ai_studio_task_get((select v from xt where k = 'T_X')) j) x),
  'Team Lead A (the employee''s own) sees the cross-team task, its owner team, and may not change it');
select test.must_fail(format($$select ai_studio_task_edit(%L, 'XT changed', null, 'LOW', null)$$, (select v from xt where k = 'T_X')), 'nor through the API', 'Only the Team Lead who gave this cross-team task');
select test.check((select count(*) = 3 from jsonb_array_elements(ai_studio_tasks_list('team') -> 'items') i where i ->> 'title' like 'XT %'),
  'Team Lead A''s team list shows Employee A''s whole workload, cross-team task included');
select test.login('xt_lead_c');
select test.must_fail(format($$select ai_studio_task_get(%L)$$, (select v from xt where k = 'T_X')), 'an unrelated Team Lead sees nothing of it', 'not found');
select test.login('xt_lead_b');
select test.check((select j ->> 'priority' = 'HIGH' and j ->> 'dueDate' = (current_date + 4)::text
                     from (select ai_studio_task_edit((select v from xt where k = 'T_X'), 'XT Campaign follow-up logic', 'Stop follow-ups after a positive reply', 'HIGH', current_date + 4) j) x),
  'Team Lead B changes the priority and the deadline');
reset role;
select test.check((select details -> 'priority' ->> 'from' = 'URGENT' and details -> 'priority' ->> 'to' = 'HIGH' and details ? 'dueDate' and note like 'Priority changed from Urgent to High.%'
                     from ai_studio_task_updates where task_id = (select v from xt where k = 'T_X') and kind = 'EDITED' order by seq desc limit 1)
                  and (select count(*) = 1 from notifications where recipient_id = test.id('xt_lead_a') and type = 'AI_STUDIO_CROSS_TEAM_CHANGED')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('xt_mem_a') and type = 'AI_STUDIO_TASK_PRIORITY'),
  'the change is in the history with the old and new values; the employee and their own Team Lead are told');

\echo '   07-12 the multi-task daily report'
-- Employee A completes the web task earlier in the day, then reports three tasks of three projects
set role authenticated;
select test.login('xt_mem_a');
select ai_studio_task_update((select v from xt where k = 'T_WEB'), 'COMPLETED', 100, 'Fixed the mobile layout and the navigation');
select test.check((select count(*) = 3 and bool_or(t ->> 'status' = 'COMPLETED') and bool_or(t ->> 'assignmentType' = 'CROSS_TEAM')
                     from jsonb_array_elements(ai_studio_daily_context(current_date) -> 'tasks') t where t ->> 'title' like 'XT %'),
  'the form offers the three tasks: the one completed today, the cross-team one and the other');
reset role;
insert into attendance_records (profile_id, attendance_date, punch_in_at, punch_out_at)
values (test.id('xt_mem_a'), current_date - 1, (current_date - 1 + time '10:00') at time zone 'Asia/Kolkata', (current_date - 1 + time '16:00') at time zone 'Asia/Kolkata')
on conflict (profile_id, attendance_date) do update set punch_in_at = excluded.punch_in_at, punch_out_at = excluded.punch_out_at;
set role authenticated;
select test.login('xt_mem_a');
select test.check((ai_studio_daily_context(current_date - 1) ->> 'workedMinutes')::int = 360, 'yesterday''s attendance: 6 hours of net working time (for the warning)');
create temp table xt_entries as select jsonb_build_array(
  jsonb_build_object('taskId', (select v from xt where k = 'T_X'), 'workCompleted', 'Stopped follow-ups after a positive reply', 'minutesSpent', 180, 'reportedProgress', 80, 'blockers', 'Integration testing is pending', 'nextAction', 'Test with live leads'),
  jsonb_build_object('taskId', (select v from xt where k = 'T_WEB'), 'workCompleted', 'Fixed the mobile layout and navigation', 'minutesSpent', 150),
  jsonb_build_object('taskId', (select v from xt where k = 'T_INT'), 'workCompleted', 'Tested the API responses', 'minutesSpent', 90, 'reportedProgress', 50)) as j;
grant select on xt_entries to authenticated;
select test.must_fail($$select ai_studio_daily_report_save(null, current_date, 'A full day', null, null, null, (select j || jsonb_build_array(j -> 0) from xt_entries), true)$$,
  '09 the same task twice is refused', 'already in the report once');
select test.must_fail($$select ai_studio_daily_report_save(null, current_date, 'A full day', null, null, null,
  (select jsonb_set(j, '{2,reportedProgress}', '100') from xt_entries), true)$$, 'an open task is not completed from the report (0 to 99%)', 'Complete the task from the task itself');
select test.must_fail($$select ai_studio_daily_report_save(null, current_date, 'A full day', null, null, null, (select j #- '{2,minutesSpent}' from xt_entries), true)$$,
  'every task needs its time spent', 'Task 3');
select test.must_fail($$select ai_studio_daily_report_save(null, current_date, 'A full day', null, null, null,
  (select jsonb_set(jsonb_set(j, '{0,minutesSpent}', '1000'), '{1,minutesSpent}', '600') from xt_entries), true)$$, 'the hours cannot add up to more than 24', 'more than 24 hours');
select test.must_fail(format($$select ai_studio_daily_report_save(null, current_date, 'A full day', null, null, null, jsonb_build_array(jsonb_build_object('taskId', %L, 'workCompleted', 'Not mine', 'minutesSpent', 10, 'reportedProgress', 10)), true)$$,
  (select v from xt where k = 'T_C')), 'a task of somebody else is refused', 'not one of your tasks');
reset role;
select test.check(not exists (select 1 from ai_studio_daily_reports where author_id = test.id('xt_mem_a')), 'nothing was written by the refused attempts (all or nothing)');
set role authenticated;
select test.login('xt_mem_a');
-- a draft, then the same call again (a second click), then the submission
insert into xt select 'R', (ai_studio_daily_report_save(null, current_date, 'A full day', 'Helped onboard a colleague', null, 'Live lead testing', (select j from xt_entries), false) ->> 'id')::uuid;
select test.check((ai_studio_daily_report_save(null, current_date, 'A full day', 'Helped onboard a colleague', null, 'Live lead testing', (select j from xt_entries), false) ->> 'id')::uuid = (select v from xt where k = 'R'),
  '10 saving again finds the same report (one per day)');
select test.check((select (j ->> 'status') = 'PENDING_TL_APPROVAL' and (j ->> 'totalMinutes')::int = 420 and jsonb_array_length(j -> 'entries') = 3
                     from (select ai_studio_daily_report_save((select v from xt where k = 'R'), current_date, 'A full day', 'Helped onboard a colleague', null, 'Live lead testing', (select j from xt_entries), true) j) x),
  '07 one report with three task entries, 7 hours in all, sent to Team Lead A');
select test.must_fail($$select ai_studio_daily_report_save(null, current_date, 'Again', null, null, null, (select j from xt_entries), true)$$, '10 submitting again is refused (no duplicate)', 'already submitted');
reset role;
select test.check((select count(*) = 1 from ai_studio_daily_reports where author_id = test.id('xt_mem_a') and report_date = current_date)
                  and (select count(*) = 3 from ai_studio_report_entries where report_id = (select v from xt where k = 'R')), 'one report row, three entries');
select test.check((select progress = 80 and status = 'IN_PROGRESS' from ai_studio_tasks where id = (select v from xt where k = 'T_X'))
                  and (select progress = 50 from ai_studio_tasks where id = (select v from xt where k = 'T_INT'))
                  and (select status = 'COMPLETED' and progress = 100 and completion_note = 'Fixed the mobile layout and the navigation' from ai_studio_tasks where id = (select v from xt where k = 'T_WEB')),
  '11 progress follows the report (80%, 50%); the completed task keeps its completion details');
select test.check((select count(*) = 3 from ai_studio_task_updates where report_id = (select v from xt where k = 'R') and kind = 'REPORT')
                  and (select count(*) = 1 from ai_studio_task_updates where report_id = (select v from xt where k = 'R') and kind = 'BLOCKER' and task_id = (select v from xt where k = 'T_X'))
                  and (select details ->> 'progressFrom' = '0' and details ->> 'progressTo' = '80' from ai_studio_task_updates where report_id = (select v from xt where k = 'R') and task_id = (select v from xt where k = 'T_X') and kind = 'REPORT'),
  'each task''s history records the linked report (0 -> 80%) and the blocker');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('xt_lead_b') and type = 'AI_STUDIO_TASK_BLOCKER')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('xt_lead_a') and type = 'AI_STUDIO_TASK_BLOCKER'),
  'the blocker is told to Team Lead B (who gave it) and Team Lead A (the employee''s own)');

\echo '   12-13 who reads the report'
set role authenticated;
select test.login('xt_lead_b');
select test.must_fail(format($$select ai_studio_report_get(%L)$$, (select v from xt where k = 'R')), '12 Team Lead B cannot open Employee A''s whole report', 'not found');
select test.check((select jsonb_array_length(j -> 'reportEntries') = 1 and j #>> '{reportEntries,0,workCompleted}' = 'Stopped follow-ups after a positive reply'
                          and (j #>> '{reportEntries,0,minutesSpent}')::int = 180
                     from (select ai_studio_task_get((select v from xt where k = 'T_X')) j) x),
  '12 but reads, in their task, the entry about it (work, time, blockers)');
select test.login('xt_lead_a');
select test.check((select jsonb_array_length(j -> 'entries') = 3 and (j ->> 'canReview')::boolean from (select ai_studio_report_get((select v from xt where k = 'R')) j) x),
  'Team Lead A reads and reviews the whole report, cross-team work included');
select test.check((ai_studio_report_review((select v from xt where k = 'R'), 'APPROVE', 'Good day') ->> 'status') = 'PENDING_DH_APPROVAL', 'and approves it (on to the Department Head)');
select test.login('ai_dh');
select test.check((select jsonb_array_length(j -> 'entries') = 3 from (select ai_studio_report_get((select v from xt where k = 'R')) j) x), 'the Department Head reads the whole report');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_reports_list('department', (select v from xt where k = 'sales')) -> 'items') i where (i ->> 'id')::uuid = (select v from xt where k = 'R')),
  'a project filter finds the multi-task report through its entries');
select test.login('xt_lead_c');
select test.must_fail(format($$select ai_studio_report_get(%L)$$, (select v from xt where k = 'R')), 'an unrelated Team Lead reads nothing', 'not found');

\echo '   stale reports never lower newer progress'
select test.login('xt_mem_a');
select ai_studio_task_update((select v from xt where k = 'T_INT'), 'IN_PROGRESS', 90, 'Finished the validation fixes');
reset role;
-- yesterday's report, written later, says 60% (the task existed yesterday)
update ai_studio_tasks set created_at = now() - interval '3 days' where id = (select v from xt where k = 'T_INT');
set role authenticated;
select test.login('xt_mem_a');
select ai_studio_daily_report_save(null, current_date - 1, 'Yesterday', null, null, null,
  jsonb_build_array(jsonb_build_object('taskId', (select v from xt where k = 'T_INT'), 'workCompleted', 'Wrote the first API tests', 'minutesSpent', 120, 'reportedProgress', 60)), true);
reset role;
select test.check((select progress = 90 from ai_studio_tasks where id = (select v from xt where k = 'T_INT')), 'a later-written report of 60% leaves the task at its newer 90%');

\echo '   13 older single-task reports'
reset role;
with ins as (
  insert into ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, status, submitted_at)
  values (test.id('xt_mem_a'), 'XT Mem A', 'MEMBER', (select v from xt where k = 'web'), (select v from xt where k = 'T_WEB'), current_date - 2, 'Old single-task report', 'APPROVED', now())
  returning id) insert into xt select 'OLD', id from ins;
\i supabase/migrations/20270219000100_ai_studio_cross_team_multi_task.sql
select test.check((select count(*) = 1 and bool_and(legacy and work_completed = 'Old single-task report') from ai_studio_report_entries where report_id = (select v from xt where k = 'OLD'))
                  and (select project_id = (select v from xt where k = 'web') and not consolidated from ai_studio_daily_reports where id = (select v from xt where k = 'OLD')),
  'an older single-task report keeps its project and gains one entry from its own text (the migration runs again safely)');
set role authenticated;
select test.login('xt_mem_a');
select test.must_fail(format($$select ai_studio_report_save(%L, %L, null, current_date, 'x', null, null, null, null, false)$$, (select v from xt where k = 'R'), (select v from xt where k = 'web')),
  'the single-task save never touches a multi-task report', 'CONFLICT');

\echo '   14 performance: credited once, to the person who did the work'
select test.login('xt_lead_a');
select test.check((select (m #>> '{metrics,tasks,total}')::int = 3 and (m #>> '{metrics,tasks,crossTeam}')::int = 1 and (m #>> '{metrics,contribution,projects}')::int = 3
                          and (m #>> '{metrics,contribution,reportedMinutes}')::int = 540 and (m #>> '{metrics,contribution,blockers}')::int = 1
                     from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') m where m ->> 'id' = test.id('xt_mem_a')::text),
  'Employee A: 3 tasks (1 cross-team) in 3 projects, 9 hours reported, 1 blocker - under their own Team Lead');
select test.login('xt_lead_b');
select test.check((select (j #>> '{me,metrics,management,crossTeamGiven}')::int = 1 and not exists (select 1 from jsonb_array_elements(j -> 'members') m where m ->> 'id' = test.id('xt_mem_a')::text)
                     from (select performance_overview(current_date - 30, current_date + 30) j) x),
  'Team Lead B: one cross-team task given; Employee A is not counted in Team Lead B''s team');

\echo '   18 global search'
select test.login('xt_mem_a');
select test.check(exists (select 1 from jsonb_array_elements(global_search('campaign follow') -> 'groups') g, jsonb_array_elements(g -> 'items') i
                           where g ->> 'type' = 'ai_studio_task' and (i ->> 'id')::uuid = (select v from xt where k = 'T_X')), 'Employee A finds their cross-team task');
select test.login('xt_lead_c');
select test.check(not exists (select 1 from jsonb_array_elements(global_search('campaign follow') -> 'groups') g, jsonb_array_elements(g -> 'items') i
                               where (i ->> 'id')::uuid = (select v from xt where k = 'T_X')), 'an unrelated Team Lead does not');
select test.login('xt_lead_b');
select test.check(not exists (select 1 from jsonb_array_elements(global_search('XT Mem') -> 'groups') g, jsonb_array_elements(g -> 'items') i
                               where g ->> 'type' = 'ai_studio_report'), 'Team Lead B finds none of Employee A''s daily reports');

\echo '   cleanup'
reset role;
select set_config('request.jwt.claims', '', false);
delete from attendance_records where profile_id in (select id from test.users where name like 'xt\_%');
delete from ai_studio_daily_reports where author_id in (select id from test.users where name like 'xt\_%');
delete from ai_studio_tasks where title like 'XT %';
delete from ai_studio_projects where name like 'XT %';
delete from performance_records where subject_id in (select id from test.users where name like 'xt\_%');
delete from auth.users where email like 'xt.%@example.com';
delete from test.users where name like 'xt\_%';
\echo '=== AI STUDIO CROSS-TEAM AND MULTI-TASK REPORT TESTS PASSED ==='
