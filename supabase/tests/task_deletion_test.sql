-- =============================================================================
-- Deleting an assigned task (migration 20270220000100): Team Lead, Department Head, Operations Head only.
-- Reuses rls_test.sql's Wabastore people (dh_wab, th_wab, tm_a; Whatsbox dh_wbx, th_wbx), business_associate_test.sql's Telecaller tc_a and
-- Business Associate ba_a (both Team Members of th_wab), the Wabastore Sales / Support Operations Heads fvt_sops / fvt_supops, ai_studio_test.sql's
-- AI Studio people (ai_dh, ai_tl1 -> ai_tm1a, ai_tl2 -> ai_tm2a) and ai_design_studio_test.sql's AI Design Studio people (ads_dh, ads_l1 -> ads_m1, ads_l2).
-- Own tasks, project and client (titles start with "TDL"); removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 199. Deleting assigned tasks (Team Lead / Department Head / Operations Head)'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270220000100_task_deletion.sql
\i supabase/migrations/20270220000100_task_deletion.sql
-- the rules by team and department (20270225000100) replace parts of the first rules; task_delete_hierarchy_test.sql tests them in full
\i supabase/migrations/20270225000100_task_delete_hierarchy.sql

delete from notifications where title like 'TDL %' or title like '%: TDL %';
delete from work_tasks where title like 'TDL %';
delete from ai_studio_tasks where title like 'TDL %';
delete from ai_studio_projects where name like 'TDL %';
delete from ads_reports where work_completed like 'TDL %';
delete from ads_assignments where title like 'TDL %';
delete from ads_clients where client_name like 'TDL %';

create temp table tdl (k text primary key, v uuid);
grant all on tdl to authenticated;
create or replace function pg_temp.v(p_k text) returns uuid language sql stable as $$ select v from tdl where k = p_k $$;
create or replace function pg_temp.wt(p_k text, p_title text, p_by text, p_to text, p_team text, p_parent text default null) returns void language sql as $$
  with x as (
    insert into public.work_tasks (department_id, team_id, parent_id, title, assigned_by, assignee_id, due_date)
    values (test.dept('wabastore'), test.team('wabastore', p_team), (select v from tdl where k = p_parent), p_title, test.id(p_by), test.id(p_to), current_date + 3)
    returning id)
  insert into tdl select p_k, id from x
$$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------------------------------------------------------------------------
-- 1. The Task module (every department)
-- ---------------------------------------------------------------------------
select pg_temp.wt('W1', 'TDL Lead to member', 'th_wab', 'tm_a', 'Sales');
select pg_temp.wt('W0', 'TDL Head to lead', 'dh_wab', 'th_wab', 'Sales');
select pg_temp.wt('W0a', 'TDL Lead part of head task', 'th_wab', 'tm_a', 'Sales', 'W0');
select pg_temp.wt('W2', 'TDL Head to member', 'dh_wab', 'tm_a', 'Sales');
select pg_temp.wt('W3', 'TDL Lead task for ops', 'th_wab', 'tc_a', 'Sales');
select pg_temp.wt('W4', 'TDL Super Admin task', 'sa', 'th_wab', 'Sales');
select pg_temp.wt('W5', 'TDL Ops Head task', 'fvt_sops', 'th_wab', 'Sales');
select pg_temp.wt('WK', 'TDL Keep me', 'th_wab', 'ba_a', 'Sales');
-- the Department Head works in their Support side (dh_wab's active function): a Support Team Lead's task for their member
select pg_temp.wt('W3s', 'TDL Support lead task', 'sup_th', 'sup_b', 'Support');
insert into work_task_updates (task_id, author_id, status, progress, note) values (pg_temp.v('W0a'), test.id('tm_a'), 'IN_PROGRESS', 40, 'TDL started');
insert into task_daily_reports (task_id, author_id, department_id, team_id, report_date, work_completed, progress)
values (pg_temp.v('W0a'), test.id('tm_a'), test.dept('wabastore'), test.team('wabastore', 'Sales'), current_date, 'TDL worked on the part', 40);
insert into notifications (recipient_id, type, title, body, entity_type, entity_id) values (test.id('tm_a'), 'TASK_ASSIGNED', 'TDL old', '', 'work_task', pg_temp.v('W1'));

\echo '   01 lower roles and the Super Admin get no Delete option and are refused'
set role authenticated;
select test.login('tm_a');
select test.check(not (work_task_delete_preview(pg_temp.v('W1')) ->> 'canDelete')::boolean, 'a Team Member sees no Delete option on their own task');
select test.must_fail($$select work_task_delete(pg_temp.v('W1'))$$, 'a Team Member cannot delete a task (direct call)', 'FORBIDDEN');
select test.login('tc_a');
select test.must_fail($$select work_task_delete(pg_temp.v('W3'))$$, 'a Telecaller cannot delete even their own task', 'FORBIDDEN');
select test.login('ba_a');
select test.must_fail($$select work_task_delete(pg_temp.v('WK'))$$, 'a Business Associate cannot delete a task', 'FORBIDDEN');
select test.login('sa');
select test.check(not (work_task_delete_preview(pg_temp.v('W1')) ->> 'canDelete')::boolean, 'the Super Admin has no Delete option outside AI Studio (20270225000100)');
select test.must_fail($$select work_task_delete(pg_temp.v('W1'))$$, '... and a direct call is refused', 'FORBIDDEN');
select test.must_fail($$delete from work_tasks where id = pg_temp.v('W1')$$, 'nobody deletes the row directly (no table grant): only the checked function', 'permission denied');

\echo '   02 other departments and the wrong scope'
select test.login('th_wbx');
select test.must_fail($$select work_task_delete(pg_temp.v('W1'))$$, 'a Team Lead of another department cannot delete it', 'NOT_FOUND|FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail($$select work_task_delete(pg_temp.v('W1'))$$, 'a Department Head of another department cannot delete it', 'NOT_FOUND|FORBIDDEN');
select test.login('fvt_supops');
select test.must_fail($$select work_task_delete(pg_temp.v('W3'))$$, 'a Support Operations Head cannot delete a Sales task of the same department', 'NOT_FOUND|FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select work_task_delete(pg_temp.v('W0'))$$, 'a Team Lead cannot delete a task assigned to them', 'FORBIDDEN: You cannot delete a task that was assigned to you');
-- 20270225000100: a Team Lead may delete any task of their own member, whoever gave it (task_delete_hierarchy_test.sql)
select test.check((work_task_delete_preview(pg_temp.v('W2')) ->> 'canDelete')::boolean, 'a Team Lead may delete a task the Department Head gave their member (20270225000100)');
select test.login('dh_wab');
-- dh_wab heads the Support side; W4 / W5 are Sales tasks: outside their scope, whoever gave them (20270225000100 dropped the "who gave it" limit for a Department Head)
select test.must_fail($$select work_task_delete(pg_temp.v('W4'))$$, 'a Department Head cannot delete a task outside their function (one the Super Admin gave)', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select work_task_delete(pg_temp.v('W5'))$$, '... nor one an Operations Head gave there', 'NOT_FOUND|FORBIDDEN');
select test.login('fvt_sops');
select test.must_fail($$select work_task_delete(pg_temp.v('W4'))$$, 'an Operations Head cannot delete a task the Super Admin gave', 'NOT_FOUND|FORBIDDEN');
reset role;
select test.check((select count(*) = 9 from work_tasks where title like 'TDL %'), 'nothing was deleted by the refused calls');

\echo '   03 the Team Lead deletes a task they assigned'
set role authenticated;
select test.login('th_wab');
select test.check((select (p ->> 'canDelete')::boolean and (p ->> 'subtasks')::int = 0 and p ->> 'assigneeName' = 'Member A' from work_task_delete_preview(pg_temp.v('W1')) p),
  'the Team Lead sees the Delete option, naming the task and its assignee');
select test.check((work_task_delete(pg_temp.v('W1')) ->> 'deleted')::boolean, 'the Team Lead deletes the task they assigned');
select test.must_fail($$select work_task_delete(pg_temp.v('W1'))$$, 'a second click finds nothing', 'NOT_FOUND');
select test.login('tm_a');
select test.check(not exists (select 1 from work_tasks where id = pg_temp.v('W1')), 'the task is gone for the assignee (their list and counts)');
reset role;
select test.check(not exists (select 1 from work_tasks where id = pg_temp.v('W1'))
                  and not exists (select 1 from notifications where entity_type = 'work_task' and entity_id = pg_temp.v('W1')),
  'the row and its old notifications are gone');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'TASK_DELETED' and title = 'Task deleted: TDL Lead to member'),
  'the assignee is told the task was deleted');
select test.check((select count(*) = 1 from audit_logs where action = 'TASK_DELETED' and entity_id = pg_temp.v('W1') and actor_id = test.id('th_wab')
                     and metadata #>> '{task,title}' = 'TDL Lead to member'), 'the delete is audited with a snapshot of the task');
select test.check(exists (select 1 from work_tasks where id = pg_temp.v('WK')) and exists (select 1 from profiles where id = test.id('tm_a') and status = 'ACTIVE'),
  'other tasks and the employee account are untouched');

\echo '   04 the Department Head deletes a task of their department, with what hangs off it'
set role authenticated;
select test.login('dh_wab');
select test.check((select (p ->> 'canDelete')::boolean and (p ->> 'subtasks')::int = 1 and (p ->> 'updates')::int = 1 and (p ->> 'dailyReports')::int = 1
                     from work_task_delete_preview(pg_temp.v('W0')) p), 'the confirmation lists the sub-task, its update and its daily report');
select test.check((select (r ->> 'subtasks')::int = 1 from work_task_delete(pg_temp.v('W0')) r), 'the Department Head deletes the task they gave');
select test.check((work_task_delete(pg_temp.v('W3s')) ->> 'deleted')::boolean, 'the Department Head deletes a Team Lead''s task in their department and function');
reset role;
select test.check(not exists (select 1 from work_tasks where id in (pg_temp.v('W0'), pg_temp.v('W0a'), pg_temp.v('W3s')))
                  and not exists (select 1 from work_task_updates where task_id = pg_temp.v('W0a'))
                  and not exists (select 1 from task_daily_reports where task_id = pg_temp.v('W0a')), 'the sub-task, its updates and daily reports go with it (no orphans)');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('th_wab') and type = 'TASK_DELETED' and title = 'Task deleted: TDL Head to lead')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'TASK_DELETED' and title = 'Task deleted: TDL Head to lead'),
  'the Team Lead and the member with the sub-task are told');

\echo '   05 the Operations Head deletes within their function'
select pg_temp.wt('W6', 'TDL Lead task for sales ops', 'th_wab', 'tm_a', 'Sales');
set role authenticated;
select test.login('fvt_sops');
select test.check((work_task_delete_preview(pg_temp.v('W6')) ->> 'canDelete')::boolean, 'the Sales Operations Head sees the Delete option on a Sales task of their department');
select test.check((work_task_delete(pg_temp.v('W6')) ->> 'deleted')::boolean, '... and deletes it');
select test.check((work_task_delete(pg_temp.v('W5')) ->> 'deleted')::boolean, '... and a task they gave');
reset role;
select test.check(not exists (select 1 from work_tasks where id in (pg_temp.v('W6'), pg_temp.v('W5'))), 'both are gone');

-- ---------------------------------------------------------------------------
-- 2. AI Studio project tasks
-- ---------------------------------------------------------------------------
insert into ai_studio_projects (name) values ('TDL Project');
insert into ai_studio_project_members (project_id, profile_id)
select p.id, u.id from ai_studio_projects p, test.users u where p.name = 'TDL Project' and u.name in ('ai_tl1', 'ai_tl2', 'ai_tm1a', 'ai_tm2a');
create or replace function pg_temp.at(p_k text, p_title text, p_by text, p_to text) returns void language sql as $$
  with x as (
    insert into public.ai_studio_tasks (project_id, title, assigned_by, assignee_id) select id, p_title, test.id(p_by), test.id(p_to) from public.ai_studio_projects where name = 'TDL Project'
    returning id)
  insert into tdl select p_k, id from x
$$;
grant execute on all functions in schema pg_temp to authenticated;
select pg_temp.at('A1', 'TDL AI lead to member', 'ai_tl1', 'ai_tm1a');
select pg_temp.at('A2', 'TDL AI head to lead', 'ai_dh', 'ai_tl1');
select pg_temp.at('A3', 'TDL AI other team', 'ai_tl2', 'ai_tm2a');
select pg_temp.at('A4', 'TDL AI from MD', 'sa', 'ai_tm1a');
insert into ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note)
values (pg_temp.v('A1'), test.id('ai_tm1a'), 'AI TM1a', 'PROGRESS', 'IN_PROGRESS', 30, 'TDL step');

\echo '   06 AI Studio: who may delete'
set role authenticated;
select test.login('ai_tm1a');
select test.check(not (ai_studio_task_get(pg_temp.v('A1')) ->> 'canDelete')::boolean, 'an AI Studio Team Member sees no Delete option');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A1'))$$, '... and a direct call is refused', 'FORBIDDEN');
select test.login('ai_tl2');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A1'))$$, 'another AI Studio Team Lead cannot delete it', 'NOT_FOUND|FORBIDDEN');
select test.login('ai_tl1');
select test.check(not (ai_studio_task_get(pg_temp.v('A2')) ->> 'canDelete')::boolean, 'a Team Lead sees no Delete option on a task given to them');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A2'))$$, '... and cannot delete it', 'FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select ai_studio_task_delete(pg_temp.v('A1'))$$, 'a Team Lead of another department cannot delete an AI Studio task', 'FORBIDDEN');
select test.login('sa');
-- 20270225000100: the Managing Director is the Department Head of AI Studio and may delete its tasks; the Department Head may delete a task the Managing Director gave
select test.check((ai_studio_task_get(pg_temp.v('A1')) ->> 'canDelete')::boolean, 'the Managing Director, as AI Studio''s Department Head, has the Delete option (20270225000100)');
select test.login('ai_dh');
select test.check((ai_studio_task_get(pg_temp.v('A4')) ->> 'canDelete')::boolean, 'the Department Head may delete a task the Managing Director gave (20270225000100)');

\echo '   07 AI Studio: the Team Lead and the Department Head delete'
select test.login('ai_tl1');
select test.check((ai_studio_task_get(pg_temp.v('A1')) ->> 'canDelete')::boolean, 'the AI Studio Team Lead sees the Delete option on a task they assigned');
select test.check((select (r ->> 'updates')::int = 1 from ai_studio_task_delete(pg_temp.v('A1')) r), '... and deletes it');
select test.must_fail($$select ai_studio_task_get(pg_temp.v('A1'))$$, 'the task no longer opens', 'NOT_FOUND');
select test.login('ai_dh');
select test.check((ai_studio_task_get(pg_temp.v('A3')) ->> 'canDelete')::boolean, 'the Department Head sees the Delete option on any team''s task');
select test.check((ai_studio_task_delete(pg_temp.v('A2')) ->> 'deleted')::boolean and (ai_studio_task_delete(pg_temp.v('A3')) ->> 'deleted')::boolean,
  'the Department Head deletes their own and another team''s task');
reset role;
select test.check(not exists (select 1 from ai_studio_tasks where id in (pg_temp.v('A1'), pg_temp.v('A2'), pg_temp.v('A3')))
                  and not exists (select 1 from ai_studio_task_updates where task_id = pg_temp.v('A1')) and exists (select 1 from ai_studio_tasks where id = pg_temp.v('A4')),
  'the tasks and their history are gone; the Managing Director''s task stays');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1a') and type = 'AI_STUDIO_TASK_DELETED')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('ai_tl2') and type = 'AI_STUDIO_TASK_DELETED'),
  'the assignee (and the Team Lead whose task the head deleted) are told');
select test.check((select count(*) = 3 from audit_logs where action = 'AI_STUDIO_TASK_DELETED' and entity_id in (pg_temp.v('A1'), pg_temp.v('A2'), pg_temp.v('A3'))),
  'each AI Studio delete is audited');

-- ---------------------------------------------------------------------------
-- 3. AI Design Studio assignments
-- ---------------------------------------------------------------------------
insert into ads_clients (department_id, client_name, created_by) values (test.dept('ai-design-studio'), 'TDL Client', test.id('ads_dh'));
create or replace function pg_temp.ad(p_k text, p_title text, p_by text, p_to text, p_parent text default null) returns void language sql as $$
  with x as (
    insert into public.ads_assignments (department_id, client_id, parent_id, title, assigned_by, assignee_id)
    select test.dept('ai-design-studio'), c.id, (select v from tdl where k = p_parent), p_title, test.id(p_by), test.id(p_to) from public.ads_clients c where c.client_name = 'TDL Client'
    returning id)
  insert into tdl select p_k, id from x
$$;
grant execute on all functions in schema pg_temp to authenticated;
select pg_temp.ad('D1', 'TDL ADS lead to member', 'ads_l1', 'ads_m1');
select pg_temp.ad('D2', 'TDL ADS head to lead', 'ads_dh', 'ads_l1');
select pg_temp.ad('D2c', 'TDL ADS part', 'ads_l1', 'ads_m1', 'D2');
insert into ads_reports (department_id, author_id, report_date, assignment_id, work_completed, status)
values (test.dept('ai-design-studio'), test.id('ads_m1'), current_date, pg_temp.v('D2c'), 'TDL report about the part', 'PENDING_TL');

\echo '   08 AI Design Studio: who may delete'
set role authenticated;
select test.login('ads_m1');
select test.check(not (ads_assignment_get(pg_temp.v('D1')) ->> 'canDelete')::boolean, 'an AI Design Studio Team Member sees no Delete option');
select test.must_fail($$select ads_assignment_delete(pg_temp.v('D1'))$$, '... and a direct call is refused', 'FORBIDDEN');
select test.login('ads_l2');
select test.must_fail($$select ads_assignment_delete(pg_temp.v('D1'))$$, 'another Team Lead cannot delete it', 'NOT_FOUND|FORBIDDEN');
select test.login('ads_l1');
select test.must_fail($$select ads_assignment_delete(pg_temp.v('D2'))$$, 'a Team Lead cannot delete work assigned to them', 'FORBIDDEN');
select test.check((ads_assignment_get(pg_temp.v('D1')) ->> 'canDelete')::boolean, 'the Team Lead sees the Delete option on work they gave');
select test.check((ads_assignment_delete(pg_temp.v('D1')) ->> 'deleted')::boolean, '... and deletes it');
select test.login('ads_dh');
select test.check((select (r ->> 'memberParts')::int = 1 from ads_assignment_delete(pg_temp.v('D2')) r), 'the Department Head deletes work with its Team Member''s part');
reset role;
select test.check(not exists (select 1 from ads_assignments where id in (pg_temp.v('D1'), pg_temp.v('D2'), pg_temp.v('D2c')))
                  and (select assignment_id is null from ads_reports where work_completed = 'TDL report about the part'),
  'the assignments are gone; the daily report stays without the link');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ads_m1') and type = 'ADS_ASSIGNMENT_DELETED' and title = 'Assignment deleted: TDL ADS head to lead'),
  'the Team Member whose part went is told');

\echo '   cleanup'
reset role;
select set_config('request.jwt.claims', '', false);
delete from notifications where title like 'TDL %' or title like '%: TDL %';
delete from work_tasks where title like 'TDL %';
delete from ai_studio_tasks where title like 'TDL %';
delete from ai_studio_projects where name like 'TDL %';
delete from ads_reports where work_completed like 'TDL %';
delete from ads_assignments where title like 'TDL %';
delete from ads_clients where client_name like 'TDL %';
\echo '=== TASK DELETION TESTS PASSED ==='
