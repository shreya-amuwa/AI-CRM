-- =============================================================================
-- Tasks: Operations Head -> Department Head -> Team Lead -> Team Member (migration 20261230000300).
-- Reuses weekly_report_routing_test.sql (wkr-a: Sales head wkr_dhs, Support head wkr_dhp; Operations Heads wkr_ohs (Sales), wkr_ohp (Support);
-- wkr-b with one head of both functions wkr_dhb; wkr_dhs also heads wkr-c Support). Adds Team Leads and Team Members in wkr-a.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 134. Task hierarchy: Operations Head -> Department Head -> Team Lead -> Team Member'
reset role;
\i supabase/migrations/20261230000300_task_hierarchy.sql
\i supabase/migrations/20261230000300_task_hierarchy.sql
delete from work_tasks where department_id in (select id from departments where slug like 'wkr-%');
delete from auth.users where email like 'tsk.%@example.com';
delete from test.users where name like 'tsk\_%';

create or replace function test.tskmk(p_name text, p_role text, p_team text, p_by text) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tsk.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'TSK ' || substr(p_name, 5)),
    jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role, 'provisioned_team_id', test.team('wkr-a', p_team))) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select test.service(); select test.tskmk('tsk_tl1', 'TEAM_HEAD', 'Support', 'sa');
select test.service(); select test.tskmk('tsk_tl2', 'TEAM_HEAD', 'Support', 'sa');
select test.service(); select test.tskmk('tsk_tls', 'TEAM_HEAD', 'Sales', 'sa');
select test.service(); select test.tskmk('tsk_m1', 'TEAM_MEMBER', 'Support', 'tsk_tl1');
select test.service(); select test.tskmk('tsk_m3', 'TEAM_MEMBER', 'Support', 'tsk_tl2');
reset role;
select set_config('request.jwt.claims', '', false);
select test.check(private.direct_lead_of(test.id('tsk_m1')) = test.id('tsk_tl1') and private.direct_lead_of(test.id('tsk_m3')) = test.id('tsk_tl2'), 'fixture: m1 is lead 1''s, m3 lead 2''s');
create temp table tk (k text primary key, v uuid);
grant all on tk to authenticated;

\echo '   2.1 the Operations Head sees Department Heads of their scope, never Team Leads'
set role authenticated;
select test.login('wkr_ohp');
select test.check((select bool_and((x ->> 'id')::uuid in (test.id('wkr_dhp'), test.id('wkr_dhb'), test.id('wkr_dhs')))
                          and bool_or((x ->> 'id')::uuid = test.id('wkr_dhp') and x ->> 'function' = 'SUPPORT')
                          and not bool_or((x ->> 'id')::uuid = test.id('wkr_dhs') and (x ->> 'departmentId')::uuid = test.dept('wkr-a'))
                     from jsonb_array_elements(operations_task_assignees()) x where x ->> 'department' like 'WKR%'),
  'the Support Operations Head is offered the Support heads of their departments (not the Sales head of wkr-a, no Team Lead)');
select test.must_fail(format($$select assign_task_to_department_head('%s', '%s', 'SALES', 'Wrong scope', null, 'HIGH', null)$$, test.id('wkr_dhs'), test.dept('wkr-a')),
  'the Sales head of wkr-a is outside the Support Operations Head''s scope', 'department and function you manage');
select test.must_fail(format($$select assign_task_to_department_head('%s', '%s', 'SUPPORT', 'A lead', null, 'HIGH', null)$$, test.id('tsk_tl1'), test.dept('wkr-a')),
  'a Team Lead is not a Department Head', 'department and function you manage');
select test.must_fail(format($$select assign_task_to_team_lead('%s', 'Skip the head', null, 'HIGH', null)$$, test.id('tsk_tl1')),
  'the Operations Head cannot give a task straight to a Team Lead', 'gives tasks to Department Heads');
insert into tk select 'A', assign_task_to_department_head(test.id('wkr_dhp'), test.dept('wkr-a'), 'SUPPORT', 'Review all pending customer escalations', 'Every open one', 'HIGH', current_date + 7);
reset role;
select test.check((select assignee_id = test.id('wkr_dhp') and assigned_by = test.id('wkr_ohp') and division = 'SUPPORT' and parent_id is null and team_id is null
                     from work_tasks where id = (select v from tk where k = 'A')), 'the task is the Support Department Head''s');
select test.check((select count(*) = 1 from notifications where entity_id = (select v from tk where k = 'A') and recipient_id = test.id('wkr_dhp') and type = 'TASK_ASSIGNED'),
  'the Department Head is told');
set role authenticated;
select test.login('wkr_dhs');
select test.check((select count(*) = 0 from work_tasks where id = (select v from tk where k = 'A')), 'the Sales Department Head of the same department does not see it');
select test.login('wkr_dhp');
select test.check((select count(*) = 1 from work_tasks where id = (select v from tk where k = 'A')), 'the Support Department Head sees it in Assigned Tasks');

\echo '   2.2 Department Head -> Team Leads'
select test.must_fail(format($$select delegate_task_to_team_lead('%s', '%s', null, null)$$, (select v from tk where k = 'A'), test.id('tsk_tls')),
  'not to a Sales Team Lead (the task is Support)', 'Team Lead of this department and function');
insert into tk select 'B1', delegate_task_to_team_lead((select v from tk where k = 'A'), test.id('tsk_tl1'), 'Take the WhatsApp escalations', current_date + 5);
insert into tk select 'B2', delegate_task_to_team_lead((select v from tk where k = 'A'), test.id('tsk_tl2'), 'Take the e-mail escalations', null);
select test.must_fail(format($$select delegate_task_to_team_lead('%s', '%s', null, null)$$, (select v from tk where k = 'A'), test.id('tsk_tl1')),
  'not twice to the same Team Lead', 'already has this task');
reset role;
select test.check((select parent_id = (select v from tk where k = 'A') and assigned_by = test.id('wkr_dhp') and assignment_note = 'Take the WhatsApp escalations'
                     and due_date = current_date + 5 from work_tasks where id = (select v from tk where k = 'B1')), 'the Team Lead''s task hangs under the Operations Head''s, with instructions and a due date');
select test.check((select handling = 'DELEGATED' and status = 'IN_PROGRESS' from work_tasks where id = (select v from tk where k = 'A')), 'the Department Head''s task shows it was passed on');
select test.check((select count(*) = 1 from notifications where entity_id = (select v from tk where k = 'B1') and recipient_id = test.id('tsk_tl1')), 'Team Lead 1 is told');

\echo '   2.3 Team Lead: myself (no duplicate) or their own Team Members'
set role authenticated;
select test.login('tsk_tl1');
select take_task_myself((select v from tk where k = 'B1'), 'Calling them today');
select take_task_myself((select v from tk where k = 'B1'), null);
reset role;
select test.check((select handling = 'SELF' and status = 'IN_PROGRESS' and last_update_note = 'Calling them today' from work_tasks where id = (select v from tk where k = 'B1'))
                  and (select count(*) = 0 from work_tasks where parent_id = (select v from tk where k = 'B1'))
                  and (select count(*) = 1 from work_task_updates where task_id = (select v from tk where k = 'B1')),
  'assign to myself: the same task, no copy, one update even after a second click');
set role authenticated;
select test.login('tsk_tl2');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s"}]'::jsonb)$$, (select v from tk where k = 'B2'), test.id('tsk_m1')),
  'Team Lead 2 cannot give it to Team Lead 1''s member', 'not an active member of your team');
select test.check((select delegate_task_to_members((select v from tk where k = 'B2'), jsonb_build_array(jsonb_build_object('memberId', test.id('tsk_m3'), 'work', 'Reply to 20 e-mails')))) = 1,
  'Team Lead 2 hands it to their own member with a share');
select test.must_fail(format($$select take_task_myself('%s', null)$$, (select v from tk where k = 'B2')), 'once handed out, it is not also taken personally', 'already given to team members');
reset role;
select test.check((select parent_id = (select v from tk where k = 'B2') and division = 'SUPPORT' and assignment_note = 'Reply to 20 e-mails'
                     from work_tasks where assignee_id = test.id('tsk_m3') and parent_id = (select v from tk where k = 'B2')), 'the member''s task hangs under Team Lead 2''s');
insert into tk select 'C', id from work_tasks where assignee_id = test.id('tsk_m3') and parent_id = (select v from tk where k = 'B2');
set role authenticated;
select test.login('tsk_m3');
select submit_task_update((select v from tk where k = 'C'), 'COMPLETED', 100, 'Done');
reset role;
select test.check((select status = 'IN_PROGRESS' from work_tasks where id = (select v from tk where k = 'A'))
                  and (select status <> 'COMPLETED' from work_tasks where id = (select v from tk where k = 'B2')), 'a member completing their part completes nothing above it');

\echo '   2.4 the hierarchy, and who may read it'
set role authenticated;
select test.login('wkr_ohp');
select test.check((select count(*) = 4 from work_tasks where id in (select v from tk)), 'the Operations Head reads every task of the chain (their task, both leads'', the member''s)');
select test.check((select jsonb_array_length(h -> 'children') = 2
                          and (select count(*) = 1 from jsonb_array_elements(h -> 'children') c where c -> 'assignee' ->> 'name' = 'TSK tl1' and c ->> 'handling' = 'SELF')
                          and (select count(*) = 1 from jsonb_array_elements(h -> 'children') c, jsonb_array_elements(c -> 'children') g
                                where g -> 'assignee' ->> 'name' = 'TSK m3' and g ->> 'status' = 'COMPLETED' and g ->> 'assignmentNote' = 'Reply to 20 e-mails'
                                  and g -> 'assignedBy' ->> 'name' = 'TSK tl2')
                     from (select task_hierarchy((select v from tk where k = 'A')) h) x),
  'task_hierarchy: Operations Head -> Department Head -> both Team Leads (one working on it, one delegating) -> the member, with names, notes and status');
select test.check((select count(*) = 1 from jsonb_array_elements(operations_tasks()) x where (x ->> 'id')::uuid = (select v from tk where k = 'A')), 'it is in the Operations Head''s task list');
select test.login('wkr_ohs');
select test.must_fail(format($$select task_hierarchy('%s')$$, (select v from tk where k = 'A')), 'the Sales Operations Head cannot open it', 'NOT_FOUND');
select test.check((select count(*) = 0 from work_tasks where id in (select v from tk)), 'nor read any of its tasks');
select test.login('tsk_tl1');
select test.check((select count(*) = 0 from work_tasks where id = (select v from tk where k = 'C')), 'Team Lead 1 does not read Team Lead 2''s member task');
select test.login('wkr_dhp');
select test.check((select count(*) = 4 from work_tasks where id in (select v from tk)), 'the Department Head reads the chain below them');

\echo '   reading reports: an Operations Head opens only the reports of their function'
reset role;
insert into tk select 'daily', id from work_reports where author_id = test.id('wkr_dhp') and title = 'Support head day';
set role authenticated;
select test.login('wkr_ohs');
select test.must_fail(format($$select work_report_get('%s')$$, (select v from tk where k = 'daily')),
  'the Sales Operations Head cannot open the Support head''s daily report', 'NOT_FOUND');
select test.login('wkr_ohp');
select test.check((select (work_report_get((select v from tk where k = 'daily')) ->> 'title') = 'Support head day'),
  'the Support Operations Head opens it');

\echo '   3.3 the Operations Head''s daily drill-down: the people of their function only'
select test.login('wkr_ohp');
select test.check((select bool_or(x ->> 'name' = 'TSK m3' and (x -> 'tasks' ->> 'completed')::int = 1 and x ->> 'teamLead' = 'TSK tl2')
                          and not bool_or(x ->> 'name' = 'TSK tls')
                     from jsonb_array_elements(operations_people_daily(test.dept('wkr-a'), current_date - 7, current_date) -> 'people') x),
  'the Support Operations Head sees Support people (m3 with their Team Lead and task counts), not the Sales Team Lead');
select test.must_fail(format($$select operations_people_daily('%s', current_date - 200, current_date)$$, test.dept('wkr-a')), 'a period of up to three months', 'three months');
select test.login('wkr_ohs');
select test.check((select bool_or(x ->> 'name' = 'TSK tls') and not bool_or(x ->> 'name' = 'TSK m3')
                     from jsonb_array_elements(operations_people_daily(test.dept('wkr-a'), current_date - 7, current_date) -> 'people') x),
  'the Sales Operations Head sees the Sales people only');
select test.login('tsk_tl1');
select test.must_fail(format($$select operations_people_daily('%s', current_date - 7, current_date)$$, test.dept('wkr-a')), 'a Team Lead cannot open it', 'FORBIDDEN');
reset role;
