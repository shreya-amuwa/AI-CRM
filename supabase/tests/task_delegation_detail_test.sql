-- =============================================================================
-- Department Head -> Team Lead -> Team Members, with each member's share of the work (migration 20261224000300).
-- Reuses the people of department_function_scopes_test.sql (prefix fs_): FS Alpha has a Sales head (fs_dhas), a Support head (fs_dhap),
-- a Sales Team Lead (fs_tlas) with a Sales member (fs_tmas); FS Talk is another department.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 126. Delegated tasks: who got which part, and who can see it'
reset role;
\i supabase/migrations/20261224000100_department_function_scopes.sql
\i supabase/migrations/20261224000300_task_delegation_detail.sql
\i supabase/migrations/20261224000300_task_delegation_detail.sql

delete from work_tasks where title like 'TD %';
select test.fsmk('fs_tmas2', 'TEAM_MEMBER', 'fs-a', null, 'Sales') where test.id('fs_tmas2') is null;
select test.fsmk('fs_tmsx', 'TEAM_MEMBER', 'fs-a', null, 'Sales') where test.id('fs_tmsx') is null;
update profiles set status = 'SUSPENDED' where id = test.id('fs_tmsx');
create temp table td (k text primary key, v uuid);
grant all on td to authenticated;

set role authenticated;
select test.nohdr();
select test.login('fs_dhas');
insert into td select 'parent', assign_task_to_team_lead(test.id('fs_tlas'), 'TD Follow up with 100 customers', 'From the March list', 'HIGH', current_date + 5);

\echo '   the Team Lead shares it out, each member with their own part'
select test.login('fs_tlas');
select test.check((select delegate_task_to_members((select v from td where k = 'parent'), jsonb_build_array(
                     jsonb_build_object('memberId', test.id('fs_tmas'), 'work', 'Follow up with 40 customers'),
                     jsonb_build_object('memberId', test.id('fs_tmas2'), 'work', 'Follow up with 35 customers')))) = 2, 'two members get the task, each with their share');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s"}]'::jsonb)$$, (select v from td where k = 'parent'), test.id('fs_tmas')),
  'a double click does not make a second copy', 'already have this task');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s"}]'::jsonb)$$, (select v from td where k = 'parent'), test.id('fs_tmap')),
  'not a member of another team (a guessed id)', 'not an active member of your team');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s"}]'::jsonb)$$, (select v from td where k = 'parent'), test.id('fs_tmsx')),
  'not a suspended member (Technical Consultants and Meta Verifiers are refused by the same rule, team_lead_ownership_test)', 'not an active member of your team');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s", "work": "%s"}]'::jsonb)$$, (select v from td where k = 'parent'), test.id('fs_tmas2'), repeat('x', 501)),
  'a share is at most 500 characters', 'under 500 characters');
select test.login('fs_tltp');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s"}]'::jsonb)$$, (select v from td where k = 'parent'), test.id('fs_tmtp')),
  'another Team Lead cannot hand out this task', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 2 and bool_and(assigned_by = test.id('fs_tlas') and parent_id = (select v from td where k = 'parent')) from work_tasks where parent_id = (select v from td where k = 'parent')),
  'stored as the Team Lead''s child tasks (no copy for display)');
select test.check((select assignment_note = 'Follow up with 40 customers' from work_tasks where parent_id = (select v from td where k = 'parent') and assignee_id = test.id('fs_tmas')), 'with each member''s share');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('fs_dhas') and type = 'TASK_DELEGATED' and entity_id = (select v from td where k = 'parent')),
  'the Department Head is told the task was shared out');

\echo '   who sees the delegation'
set role authenticated;
select test.login('fs_dhas');
select test.check((select count(*) = 2 from work_tasks where parent_id = (select v from td where k = 'parent')), 'the Department Head who gave the task sees both members'' tasks');
select test.check((select count(*) = 2 from profiles where id in (test.id('fs_tmas'), test.id('fs_tmas2'))), 'and their names');
select test.login('fs_dhap');
select test.check((select count(*) = 0 from work_tasks where parent_id = (select v from td where k = 'parent')), 'the Support head of the same department does not see a Sales team''s tasks');
select test.login('fs_dhts');
select test.check((select count(*) = 0 from work_tasks where id = (select v from td where k = 'parent') or parent_id = (select v from td where k = 'parent')), 'a head of another department sees nothing of it');
select test.login('fs_tmas');
select test.check((select count(*) = 1 and bool_and(assignee_id = test.id('fs_tmas')) from work_tasks where parent_id = (select v from td where k = 'parent')), 'a member sees their own part, not a colleague''s');

\echo '   a member''s update never completes the Team Lead''s task'
select submit_task_update((select id from work_tasks where parent_id = (select v from td where k = 'parent') and assignee_id = test.id('fs_tmas')), 'COMPLETED', 100, 'All 40 called');
reset role;
select test.check((select status = 'COMPLETED' from work_tasks where parent_id = (select v from td where k = 'parent') and assignee_id = test.id('fs_tmas')), 'the member''s part is completed');
select test.check((select status <> 'COMPLETED' from work_tasks where id = (select v from td where k = 'parent')), 'the Team Lead''s task stays open (one member of two is done)');
set role authenticated;
select test.login('fs_dhas');
select test.check((select status = 'COMPLETED' and progress = 100 from work_tasks where parent_id = (select v from td where k = 'parent') and assignee_id = test.id('fs_tmas')), 'the Department Head sees the new status');

\echo '   the older call keeps working (no share)'
select test.login('fs_dhas');
insert into td select 'p2', assign_task_to_team_lead(test.id('fs_tlas'), 'TD Second task', null, 'LOW', null);
select test.login('fs_tlas');
select test.check(assign_task_to_members((select v from td where k = 'p2'), array[test.id('fs_tmas')]) = 1, 'assign_task_to_members still delegates');
reset role;
select test.check((select assignment_note is null from work_tasks where parent_id = (select v from td where k = 'p2')), 'with no share');
