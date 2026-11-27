-- =============================================================================
-- AI Studio cross-team task assignment (migration 20270221000100).
-- Two teams: Team Lead A (xt_lead_a) with Employee A (xt_mem_a) on "XT Web"; Team Lead B (xt_lead_b) with Employee C (xt_mem_c) on "XT Sales".
-- Team Lead B gives Employee A a task of XT Sales (cross-team); who sees it, who changes it, the lists, performance and search.
-- Own people and projects; removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 194. AI Studio: cross-team task assignment'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270221000100_ai_studio_cross_team.sql
\i supabase/migrations/20270221000100_ai_studio_cross_team.sql

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


\echo '   14 performance: credited once, to the person who did the work'
select test.login('xt_lead_a');
select test.check((select (m #>> '{metrics,tasks,total}')::int = 3 and (m #>> '{metrics,tasks,crossTeam}')::int = 1 and (m #>> '{metrics,contribution,projects}')::int = 3
                          and (m #>> '{metrics,contribution,blockers}')::int = 0 and not (m #> '{metrics,contribution}' ? 'reportedMinutes')
                     from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') m where m ->> 'id' = test.id('xt_mem_a')::text),
  'Employee A: 3 tasks (1 cross-team) in 3 projects, no reports with blockers - under their own Team Lead');
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

\echo '   the task details keep the Delete rule (20270220000100)'
select test.login('xt_lead_b');
select test.check((ai_studio_task_get((select v from xt where k = 'T_X')) ->> 'canDelete')::boolean and (ai_studio_task_get((select v from xt where k = 'T_X')) ? 'reportCount'),
  'Team Lead B (who gave the cross-team task) may delete it; the details still say so');
select test.login('xt_lead_a');
-- 20270225000100: a Team Lead may delete any task of their own team member, whoever gave it (a cross-team task too); they still may not edit it
select test.check((ai_studio_task_get((select v from xt where k = 'T_X')) ->> 'canDelete')::boolean, 'Team Lead A (the employee''s own) may delete it (20270225000100)');

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
\echo '=== AI STUDIO CROSS-TEAM ASSIGNMENT TESTS PASSED ==='
