-- =============================================================================
-- Skip a level (migration 20270114000200): a Department Head / Operations Head gives a task straight to a Team Lead or Team Member of their own
-- teams; nobody reaches people outside their scope; a Team Lead still reaches only their own members. And the Support desk switch: two Team Leads
-- of one Support team no longer see each other's customers.
-- Reuses task_hierarchy_test.sql (wkr-a: Support head wkr_dhp, Sales head wkr_dhs, Support Operations Head wkr_ohp, Sales Operations Head wkr_ohs;
-- Support Team Leads tsk_tl1 and tsk_tl2 of ONE team, Sales Team Lead tsk_tls; tsk_m1 is tsk_tl1's member, tsk_m3 is tsk_tl2's).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 160. Tasks: skip a level within your own people; Support Team Leads see only their own customers'
reset role;
-- remember the switch as the earlier suites left it, to put it back at the end
create temp table sk_before as select support_desk_department_wide as on_, updated_by from access_settings where id;
grant select on sk_before to authenticated;
update access_settings set support_desk_department_wide = true, updated_by = null where id;
\i supabase/migrations/20270114000100_task_skip_level_and_support_customer_scope.sql
\i supabase/migrations/20270114000100_task_skip_level_and_support_customer_scope.sql
create temp table sk (k text primary key, v uuid);
grant all on sk to authenticated;

\echo '   1. Department Head: Team Leads and Team Members of the teams they head'
set role authenticated;
select test.login('wkr_dhp');
select test.check((select bool_or((x ->> 'id')::uuid = test.id('tsk_tl1')) and bool_or((x ->> 'id')::uuid = test.id('tsk_m1'))
                          and bool_or((x ->> 'id')::uuid = test.id('tsk_m3')) and not bool_or((x ->> 'id')::uuid = test.id('tsk_tls'))
                          and bool_or((x ->> 'id')::uuid = test.id('tsk_m1') and (x ->> 'teamLeadId')::uuid = test.id('tsk_tl1'))
                     from jsonb_array_elements(task_direct_assignees()) x),
  'the Support head is offered both Support Team Leads and their members (each with their own lead), never the Sales Team Lead');
insert into sk select 'D1', assign_task_direct(test.id('tsk_m1'), 'Call the 5 pending renewals', 'Team Lead is on leave', 'HIGH', current_date + 2);
insert into sk select 'D2', assign_task_direct(test.id('tsk_tl2'), 'Review the escalations', null, 'MEDIUM', null);
select test.must_fail(format($$select assign_task_direct('%s', 'Other function', null, 'LOW', null)$$, test.id('tsk_tls')),
  'not a Sales Team Lead (another function)', 'team you manage');
select test.must_fail(format($$select assign_task_direct('%s', 'Myself', null, 'LOW', null)$$, test.id('wkr_dhp')),
  'not themselves', 'team you manage');
select test.must_fail(format($$select assign_task_direct('%s', '', null, 'LOW', null)$$, test.id('tsk_m1')), 'a task needs a title', 'Enter the task');
select test.must_fail(format($$select assign_task_direct('%s', 'Late', null, 'LOW', current_date - 1)$$, test.id('tsk_m1')), 'no due date in the past', 'past');
reset role;
select test.check((select assignee_id = test.id('tsk_m1') and assigned_by = test.id('wkr_dhp') and parent_id is null and status = 'ASSIGNED'
                          and team_id = (select team_id from profiles where id = test.id('tsk_m1')) and due_date = current_date + 2
                     from work_tasks where id = (select v from sk where k = 'D1')), 'the task is the member''s, from the Department Head, at the top level');
select test.check((select count(*) = 1 from notifications where entity_id = (select v from sk where k = 'D1') and recipient_id = test.id('tsk_m1') and type = 'TASK_ASSIGNED'),
  'the member is told');
select test.check((select count(*) = 1 from notifications where entity_id = (select v from sk where k = 'D1') and recipient_id = test.id('tsk_tl1') and type = 'TASK_UPDATE')
                  and (select count(*) = 0 from notifications where entity_id = (select v from sk where k = 'D1') and recipient_id = test.id('tsk_tl2')),
  'the member''s OWN Team Lead is told, the other Team Lead of the team is not');
select test.check((select count(*) = 1 from audit_logs where entity_id = (select v from sk where k = 'D1') and action = 'TASK_ASSIGNED' and metadata ->> 'level' = 'DIRECT'),
  'it is audited as a direct assignment');

\echo '   2. Who can read it'
set role authenticated;
select test.login('tsk_m1');
select test.check((select count(*) = 1 from work_tasks where id = (select v from sk where k = 'D1')), 'the member sees their task');
select test.login('tsk_tl1');
select test.check((select count(*) = 1 from work_tasks where id = (select v from sk where k = 'D1')), 'their own Team Lead sees it');
select test.login('tsk_tl2');
select test.check((select count(*) = 0 from work_tasks where id = (select v from sk where k = 'D1')), 'the other Team Lead of the same team does not');
-- a Team Lead who got a task over nobody can still share it with their OWN members only
select test.check((select delegate_task_to_members((select v from sk where k = 'D2'), jsonb_build_array(jsonb_build_object('memberId', test.id('tsk_m3')))) = 1),
  'a Team Lead shares the Department Head''s direct task with their own member');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId":"%s"}]'::jsonb)$$, (select v from sk where k = 'D2'), test.id('tsk_m1')),
  'but not with the other Team Lead''s member', 'not an active member of your team');

\echo '   3. Operations Head: Team Leads and Team Members of the function they manage'
select test.login('wkr_ohp');
select test.check((select bool_or((x ->> 'id')::uuid = test.id('tsk_tl1')) and bool_or((x ->> 'id')::uuid = test.id('tsk_m3')) and not bool_or((x ->> 'id')::uuid = test.id('tsk_tls'))
                     from jsonb_array_elements(task_direct_assignees()) x),
  'the Support Operations Head is offered the Support Team Leads and members, not the Sales Team Lead');
insert into sk select 'O1', assign_task_direct(test.id('tsk_tl1'), 'Department Head away: weekly report', null, 'HIGH', current_date + 1);
insert into sk select 'O2', assign_task_direct(test.id('tsk_m3'), 'Team Lead away: follow up Reva', null, 'MEDIUM', null);
select test.must_fail(format($$select assign_task_direct('%s', 'Not mine', null, 'LOW', null)$$, test.id('tsk_tls')),
  'the Support Operations Head cannot reach the Sales Team Lead', 'team you manage');
select test.check((select count(*) >= 2 from jsonb_array_elements(operations_tasks()) x where (x ->> 'id')::uuid in (select v from sk where k in ('O1', 'O2'))),
  'both show in the Operations Head''s task list');
select test.login('wkr_ohs');
select test.check((select not coalesce(bool_or((x ->> 'id')::uuid in (test.id('tsk_tl1'), test.id('tsk_m1'))), false) and coalesce(bool_or((x ->> 'id')::uuid = test.id('tsk_tls')), false)
                     from jsonb_array_elements(task_direct_assignees()) x),
  'the Sales Operations Head is offered the Sales Team Lead, not the Support people');

\echo '   4. Nobody else'
select test.login('tsk_tl1');
select test.must_fail('select task_direct_assignees()', 'a Team Lead does not get the skip-level picker', 'Only a Department Head');
select test.must_fail(format($$select assign_task_direct('%s', 'Sideways', null, 'LOW', null)$$, test.id('tsk_m3')),
  'a Team Lead cannot give a task to the other Team Lead''s member this way', 'Only a Department Head');
select test.login('tsk_m1');
select test.must_fail(format($$select assign_task_direct('%s', 'Up', null, 'LOW', null)$$, test.id('tsk_m3')), 'nor a Team Member', 'Only a Department Head');
reset role;
set role anon;
select test.must_fail(format($$select assign_task_direct('%s', 'x', null, 'LOW', null)$$, test.id('tsk_m1')), 'nor a visitor', 'permission denied');
reset role;

\echo '   5. Support customers: each Team Lead sees their own, the other Team Lead''s are hidden'
select test.check((select not support_desk_department_wide from access_settings where id), 'the migration switched the department-wide Support desk off');
select set_config('request.jwt.claims', '', false);   -- the fixture is written by the test itself, not by the last signed-in person
insert into customers (owner_id, team_id, department_id, name, phone, lifecycle_stage, created_by)
select test.id('tsk_tl2'), p.team_id, p.department_id, 'SKIP Reva', '9000081001', 'CUSTOMER', test.id('tsk_tl2') from profiles p where p.id = test.id('tsk_tl2')
returning id as cust \gset
set role authenticated;
select test.login('tsk_tl2');
select test.check((select count(*) = 1 from customers where id = :'cust'), 'the Team Lead who owns the customer sees it');
select test.login('tsk_tl1');
select test.check((select count(*) = 0 from customers where id = :'cust'), 'the other Team Lead of the same Support team does not');
select test.login('tsk_m1');
select test.check((select count(*) = 0 from customers where id = :'cust'), 'nor the other Team Lead''s member');
select test.login('wkr_dhp');
select test.check((select count(*) = 1 from customers where id = :'cust'), 'the Department Head still sees it');
reset role;
-- the cause, shown: with the old department-wide setting the other Team Lead saw it
update access_settings set support_desk_department_wide = true where id;
set role authenticated;
select test.login('tsk_tl1');
select test.check((select count(*) = 1 from customers where id = :'cust'), 'with the old department-wide Support desk the other Team Lead saw it (the reported bug)');
reset role;
-- a Super Admin who turns it back on by hand is not overruled when the migration runs again
update access_settings set support_desk_department_wide = true, updated_by = test.id('sa') where id;
\i supabase/migrations/20270114000100_task_skip_level_and_support_customer_scope.sql
select test.check((select support_desk_department_wide from access_settings where id), 'running the migration again does not undo a Super Admin''s later choice');

-- put the switch back as the earlier suites left it
update access_settings s set support_desk_department_wide = b.on_, updated_by = b.updated_by from sk_before b where s.id;
delete from customers where id = :'cust';
\echo '=== ALL SKIP-LEVEL TASK AND SUPPORT CUSTOMER SCOPE TESTS PASSED ==='
