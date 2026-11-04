-- =============================================================================
-- Department x function scopes (migration 20261224000100). Synthetic departments only:
--   fs-a, fs-b: Sales + Support teams;  fs-t: Sales + Support teams with a Support facet department fs-tw (the D Talk / Wabatalk shape);
--   fs-g: only a General team (the Accounts / HR shape).
-- People: three Operations Heads (Support, Sales, both), Department Heads, Team Leads and Team Members of each side, and one Department Head
-- (fs_rut, the "Whatsbox head who also heads D Talk Support" case) who is given a second department.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 124. Department x function scopes: Sales / Support Operations Heads, Department Heads in several departments'
reset role;
-- earlier suites re-apply older migrations: bring back the latest account provisioning, then this migration (twice: it must be re-runnable)
\i supabase/migrations/20261223000100_team_lead_ownership.sql
\i supabase/migrations/20261224000100_department_function_scopes.sql
\i supabase/migrations/20261224000100_department_function_scopes.sql

delete from customers where name like 'FS %';
delete from approval_requests where subject_user_id in (select id from profiles where email like 'fs.%@example.com');
delete from auth.users where email like 'fs.%@example.com';
delete from test.users where name like 'fs\_%';
delete from teams where department_id in (select id from departments where slug like 'fs-%');
delete from departments where facet_of in (select id from departments where slug like 'fs-%');
delete from departments where slug like 'fs-%';
insert into departments (slug, name) values ('fs-a', 'FS Alpha'), ('fs-b', 'FS Beta'), ('fs-t', 'FS Talk'), ('fs-g', 'FS General');
insert into departments (slug, name, facet_of, facet_division) select 'fs-tw', 'FS Talk Support', id, 'SUPPORT' from departments where slug = 'fs-t';
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug in ('fs-a', 'fs-b', 'fs-t');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug in ('fs-a', 'fs-b', 'fs-t');
insert into teams (department_id, name, division) select d.id, 'General', 'GENERAL' from departments d where d.slug = 'fs-g';

create or replace function test.fsmk(p_name text, p_role text, p_dept text, p_division text default null, p_team text default null, p_ops boolean default false)
returns uuid language sql as $$
  select test.create_auth_user(p_name, 'fs.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'FS ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_team is null then test.dept(p_dept) end,
      'provisioned_team_id', case when p_team is not null then test.team(p_dept, p_team) end,
      'provisioned_head_division', p_division, 'provisioned_operations_head', case when p_ops then true end))) $$;
create or replace function test.hdr(p_department uuid, p_division text default null) returns void language sql as $$
  select set_config('request.headers', jsonb_strip_nulls(jsonb_build_object('x-active-department', p_department::text, 'x-active-division', p_division))::text, false)
$$;
create or replace function test.nohdr() returns void language sql as $$ select set_config('request.headers', '', false) $$;
grant execute on all functions in schema test to anon, authenticated;

-- Department Heads: fs-a has a Sales head and a Support head; fs-b one head for both sides (the "Whatsbox" head); fs-t a Sales head only
select test.fsmk('fs_dhas', 'DEPARTMENT_HEAD', 'fs-a', 'SALES');
select test.fsmk('fs_dhap', 'DEPARTMENT_HEAD', 'fs-a', 'SUPPORT');
select test.fsmk('fs_rut', 'DEPARTMENT_HEAD', 'fs-b');
select test.fsmk('fs_dhts', 'DEPARTMENT_HEAD', 'fs-t', 'SALES');
select test.fsmk('fs_dhg', 'DEPARTMENT_HEAD', 'fs-g');
-- Team Leads and Team Members on both sides
select test.fsmk('fs_tlas', 'TEAM_HEAD', 'fs-a', null, 'Sales');
select test.fsmk('fs_tlap', 'TEAM_HEAD', 'fs-a', null, 'Support');
select test.fsmk('fs_tmas', 'TEAM_MEMBER', 'fs-a', null, 'Sales');
select test.fsmk('fs_tmap', 'TEAM_MEMBER', 'fs-a', null, 'Support');
select test.fsmk('fs_tlts', 'TEAM_HEAD', 'fs-t', null, 'Sales');
select test.fsmk('fs_tltp', 'TEAM_HEAD', 'fs-t', null, 'Support');
select test.fsmk('fs_tmts', 'TEAM_MEMBER', 'fs-t', null, 'Sales');
select test.fsmk('fs_tmtp', 'TEAM_MEMBER', 'fs-t', null, 'Support');
select test.fsmk('fs_tmbs', 'TEAM_MEMBER', 'fs-b', null, 'Sales');
-- Operations Heads: Support only (the "Ashwini" case), Sales only, both
select test.fsmk('fs_opsup', 'DEPARTMENT_HEAD', 'fs-a', 'SUPPORT', null, true);
select test.fsmk('fs_opsal', 'DEPARTMENT_HEAD', 'fs-a', 'SALES', null, true);
select test.fsmk('fs_opall', 'DEPARTMENT_HEAD', 'fs-b', null, null, true);
-- the data of every side
insert into customers (owner_id, name, phone, lifecycle_stage) values
  (test.id('fs_tmas'), 'FS Alpha Sales', '+919822000001', 'LEAD'), (test.id('fs_tmap'), 'FS Alpha Support', '+919822000002', 'CUSTOMER'),
  (test.id('fs_tmts'), 'FS Talk Sales', '+919822000003', 'LEAD'), (test.id('fs_tmtp'), 'FS Talk Support', '+919822000004', 'CUSTOMER');
select test.check((select count(*) = 4 from customers where name like 'FS %'), 'four customers, one per department and side');

set role authenticated;
select test.login('sa');
select operations_head_assign_new(test.id('fs_opsup'), array[test.dept('fs-a'), test.dept('fs-t')]);
select operations_head_assign_new(test.id('fs_opsal'), array[test.dept('fs-a'), test.dept('fs-t')]);
select operations_head_assign_new(test.id('fs_opall'), array[test.dept('fs-a'), test.dept('fs-b')]);
reset role;

\echo '   root cause: the supervised departments now carry the person''s function'
select test.check((select bool_and(division = 'SUPPORT') and count(*) = 2 from private.scopes_of(test.id('fs_opsup'))),
  'Support Operations Head: both departments, the Support side only (the home department is not added again as a whole department)');
select test.check((select bool_and(division = 'SALES') and count(*) = 2 from private.scopes_of(test.id('fs_opsal'))), 'Sales Operations Head: the Sales side only');
select test.check((select bool_and(division is null) and count(*) = 2 from private.scopes_of(test.id('fs_opall'))), 'a Sales & Support Operations Head: whole departments, where assigned');
select test.check(not exists (select 1 from private.scopes_of(test.id('fs_opsup')) where department_id = test.dept('fs-b')), 'and nothing outside the assigned departments');

set role authenticated;
\echo '   Support Operations Head: Support data only, whatever is asked for'
select test.login('fs_opsup');
select test.nohdr();
select test.check((select count(*) = 1 and bool_and(name = 'FS Alpha Support') from customers where name like 'FS %'), 'home department: the Support customer, not the Sales lead');
select test.hdr(test.dept('fs-a'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'FS Alpha Support') from customers where name like 'FS %'), 'asking for Sales through the request does not give Sales data');
select test.hdr(test.dept('fs-t'));
select test.check((select count(*) = 1 and bool_and(name = 'FS Talk Support') from customers where name like 'FS %'), 'the other assigned department: Support only too');
select test.check((select count(*) = 0 from profiles where id in (test.id('fs_tmts'), test.id('fs_tlts'))) and (select count(*) = 2 from profiles where id in (test.id('fs_tmtp'), test.id('fs_tltp'))),
  'people: the Support Team Lead and member, not the Sales ones');
select test.nohdr();
select test.check((select bool_and((x ->> 'function') = 'SUPPORT') and bool_and((x ->> 'customers')::int + (x ->> 'leads')::int = 1) and bool_and((x ->> 'teamLeads')::int = 1)
                     from jsonb_array_elements(operations_dashboard() -> 'departments') x), 'Operations dashboard: Support counts only, in every department');
select test.check((select jsonb_array_length(operations_department_detail(test.dept('fs-t')) -> 'teamLeads') = 1
                     and (operations_department_detail(test.dept('fs-t')) -> 'teamLeads' -> 0 ->> 'name') = 'FS tltp'), 'department view: the Support Team Lead only');
select test.check((select bool_and((x ->> 'function') = 'SUPPORT') from jsonb_array_elements(work_reports_operations(current_date - 7, current_date) -> 'departments') x),
  'reports board: Support only');
select test.check((select jsonb_array_length(work_reports_operations_department(test.dept('fs-a'), current_date - 7, current_date) -> 'departmentHeads') = 1
                     and (work_reports_operations_department(test.dept('fs-a'), current_date - 7, current_date) -> 'departmentHeads' -> 0 ->> 'name') = 'FS dhap'),
  'reports of one department: the Support Department Head, not the Sales one');
select test.must_fail($$select operations_department_detail(test.dept('fs-b'))$$, 'a department that is not assigned is not found', 'NOT_FOUND');

\echo '   Sales Operations Head: the opposite'
select test.login('fs_opsal');
select test.hdr(test.dept('fs-t'), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'FS Talk Sales') from customers where name like 'FS %'), 'Sales only, also when Support is asked for');
select test.nohdr();
select test.check((select bool_and((x ->> 'function') = 'SALES') from jsonb_array_elements(operations_dashboard() -> 'departments') x), 'dashboard: Sales counts only');

\echo '   combined Operations Head: both sides where assigned'
select test.login('fs_opall');
select test.hdr(test.dept('fs-a'));
select test.check((select count(*) = 2 from customers where name like 'FS Alpha%'), 'both sides of an assigned department');
select test.hdr(test.dept('fs-t'));
select test.check((select count(*) = 0 from customers where name like 'FS Talk%'), 'nothing of a department that is not assigned');
select test.nohdr();

\echo '   changing the function: Super Admin only, audited, takes effect at once'
select test.must_fail($$select operations_head_function_set(test.id('fs_opall'), 'SUPPORT')$$, 'an Operations Head cannot change their own function', 'FORBIDDEN');
select test.login('fs_rut');
select test.must_fail($$select operations_head_function_set(test.id('fs_opall'), 'SUPPORT')$$, 'nor a Department Head', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select operations_head_function_set(test.id('fs_rut'), 'SUPPORT')$$, 'only an Operations Head has an operations function', 'Only an Operations Head');
select test.must_fail($$select operations_head_function_set(test.id('fs_opall'), 'GENERAL')$$, 'Sales, Support or both', 'Choose Sales');
select test.check((select (operations_head_function_set(test.id('fs_opall'), 'SUPPORT') ->> 'function') = 'SUPPORT'), 'the Super Admin makes the combined head a Support Operations Head');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'OPERATIONS_FUNCTION_SET' and entity_id = test.id('fs_opall') and metadata ->> 'after' = 'SUPPORT' and metadata ->> 'before' is null),
  'audited with before and after');
set role authenticated;
select test.login('fs_opall');
select test.hdr(test.dept('fs-a'));
select test.check((select count(*) = 1 and bool_and(name = 'FS Alpha Support') from customers where name like 'FS Alpha%'), 'the Sales side is gone on the next request');
select test.nohdr();
select test.login('sa');
select operations_head_function_set(test.id('fs_opall'), null);

\echo '   one save: function, departments, a narrower side per department, who approves (all or nothing)'
select test.must_fail(format($$select operations_head_scope_apply('%s', 'SALES', '[{"departmentId": "%s", "division": "SUPPORT"}]'::jsonb)$$, test.id('fs_opall'), test.dept('fs-a')),
  'a Sales Operations Head cannot be given a Support side', 'cannot be given the Support side');
select test.must_fail(format($$select operations_head_scope_apply('%s', null, '[{"departmentId": "%s", "division": "SALES"}]'::jsonb)$$, test.id('fs_opall'), test.dept('fs-g')),
  'a side a department does not have is refused', 'has no Sales team');
select test.must_fail(format($$select operations_head_scope_apply('%s', null, '[]'::jsonb)$$, test.id('fs_opall')), 'at least one department', 'at least one department');
reset role;
select test.check((select head_division is null from profiles where id = test.id('fs_opall')) and (select count(*) = 2 from operations_head_departments where profile_id = test.id('fs_opall')),
  'a refused save changed nothing');
set role authenticated;
select test.login('sa');
select test.check((select (x ->> 'function') = 'SALES' from jsonb_array_elements(operations_head_scope_apply(test.id('fs_opall'), null,
                     jsonb_build_array(jsonb_build_object('departmentId', test.dept('fs-a'), 'division', 'SALES'), jsonb_build_object('departmentId', test.dept('fs-b')))) -> 'departments') x
                    where (x ->> 'id')::uuid = test.dept('fs-a')), 'the combined head is narrowed to Sales in FS Alpha');
reset role;
select test.check((select division = 'SALES' from private.scopes_of(test.id('fs_opall')) where department_id = test.dept('fs-a'))
                  and (select division is null from private.scopes_of(test.id('fs_opall')) where department_id = test.dept('fs-b')), '... and keeps both sides of FS Beta');

\echo '   approvals of Department Heads follow department AND function'
set role authenticated;
select test.login('sa');
select operations_head_scope_apply(test.id('fs_opsup'), 'SUPPORT',
  jsonb_build_array(jsonb_build_object('departmentId', test.dept('fs-a'), 'primary', true), jsonb_build_object('departmentId', test.dept('fs-t'))));
reset role;
select test.check((select count(*) = 1 from department_function_owner where department_id = test.dept('fs-a') and division = 'SUPPORT' and operations_head_id = test.id('fs_opsup')),
  'ticking "approves heads" for a Support Operations Head names them for the Support side only');
select test.check(private.operations_owner_for(test.dept('fs-a'), 'SUPPORT') = test.id('fs_opsup'), 'a Support Department Head request goes to them');
select test.check(private.operations_owner_for(test.dept('fs-a'), 'SALES') is null, 'a Sales Department Head request does not (it waits for the Super Admin, nothing moves silently)');
select test.check(private.operations_owner_for(test.dept('fs-a'), null) is null, 'nor a head for both sides');
insert into approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_division, approver_kind, approver_id)
values ('USER_REGISTRATION', test.id('fs_tmbs'), test.dept('fs-a'), 'PENDING', 'HR', 'DEPARTMENT_HEAD', 'SALES', 'OPERATIONS_HEAD', null);
set role authenticated;
select test.login('fs_opsup');
select test.check(not private.can_decide_employee_request((select id from approval_requests where subject_user_id = test.id('fs_tmbs') and status = 'PENDING')), 'the Support Operations Head cannot decide the Sales head request');
select test.login('sa');
select operations_head_scope_apply(test.id('fs_opsal'), 'SALES',
  jsonb_build_array(jsonb_build_object('departmentId', test.dept('fs-a'), 'primary', true), jsonb_build_object('departmentId', test.dept('fs-t'))));
select test.login('fs_opsal');
select test.check(private.can_decide_employee_request((select id from approval_requests where subject_user_id = test.id('fs_tmbs') and status = 'PENDING')), 'the Sales Operations Head named for Sales can');
reset role;
select test.check((select approver_id = test.id('fs_opsal') from approval_requests where subject_user_id = test.id('fs_tmbs') and status = 'PENDING'), 'and the waiting Sales request moved to them, audited')
  , (select count(*) = 1 from audit_logs where action = 'DEPARTMENT_FUNCTION_OWNER_SET' and metadata ->> 'division' = 'SALES' and metadata ->> 'to' = test.id('fs_opsal')::text);
delete from approval_requests where subject_user_id = test.id('fs_tmbs');

\echo '   a Department Head in a second department (one function of it), never two heads for one function'
set role authenticated;
select test.login('sa');
select test.must_fail($$select department_access_set(test.id('fs_rut'), test.dept('fs-t'), 'SUPPORT', true)$$, 'the Support side of FS Talk is given as its Support department', 'Give FS Talk Support instead');
select test.must_fail($$select department_access_set(test.id('fs_rut'), test.dept('fs-t'), 'SALES', true)$$, 'its Sales side already has a head: refused, the other head is named', 'already has a Sales Department Head \(FS dhts\)');
select test.check((select jsonb_array_length(department_access_set(test.id('fs_rut'), test.dept('fs-tw'), 'SUPPORT', true) -> 'grants') >= 1), 'FS Talk Support is given to the FS Beta head');
reset role;
select test.check((select is_operations_head = false and role = 'DEPARTMENT_HEAD' and department_id = test.dept('fs-b') from profiles where id = test.id('fs_rut')),
  'they stay a Department Head of their own department: no Operations Head role, no second account, no move');
select test.check((select count(*) = 2 from private.scopes_of(test.id('fs_rut')))
                  and exists (select 1 from private.scopes_of(test.id('fs_rut')) where department_id = test.dept('fs-b') and division is null)
                  and exists (select 1 from private.scopes_of(test.id('fs_rut')) where department_id = test.dept('fs-t') and division = 'SUPPORT'),
  'scopes: all of FS Beta (as before) and FS Talk, Support only');
select test.check((select count(*) = 1 from audit_logs where action = 'DEPARTMENT_ACCESS_GRANTED' and entity_id = test.id('fs_rut')), 'the grant is audited');
-- another head cannot also be given FS Talk Support now
set role authenticated;
select test.login('sa');
select test.must_fail($$select department_access_set(test.id('fs_dhas'), test.dept('fs-tw'), 'SUPPORT', true)$$, 'a second head for FS Talk Support is refused, naming the holder', 'FS rut');
select test.must_fail($$select department_access_apply(test.id('fs_dhas'), jsonb_build_array(jsonb_build_object('departmentId', test.dept('fs-tw'), 'division', 'SUPPORT')))$$,
  'also through the Access Control matrix', 'already has a Support Department Head');
select test.check((select count(*) = 1 from jsonb_array_elements(department_access_apply(test.id('fs_rut'),
                     jsonb_build_array(jsonb_build_object('departmentId', test.dept('fs-tw'), 'division', 'SUPPORT'))) -> 'grants')), 'saving the same grant again is fine (not re-checked against itself)');
reset role;
select test.check((select count(*) = 1 from department_access where profile_id = test.id('fs_dhas')) is not true, 'nothing was stored for the refused head');
-- a head with no side in their own department already covers both sides: ticking them there only makes both views selectable (no conflict),
-- while a one-side head of the same department cannot take the other side that the no-side head covers
select test.fsmk('fs_dhbs', 'DEPARTMENT_HEAD', 'fs-b', 'SALES') where test.id('fs_dhbs') is null;
set role authenticated;
select test.login('sa');
select test.check((select jsonb_array_length(department_access_set(test.id('fs_rut'), test.dept('fs-b'), 'SALES', true) -> 'grants') >= 1), 'the no-side head of FS Beta can tick FS Beta Sales');
select test.must_fail($$select department_access_set(test.id('fs_dhbs'), test.dept('fs-b'), 'SUPPORT', true)$$, 'FS Beta''s Sales head cannot take FS Beta Support (the no-side head holds it)', 'FS rut');
select department_access_set(test.id('fs_rut'), test.dept('fs-b'), 'SALES', false);
reset role;

\echo '   what the second-department head can and cannot do'
set role authenticated;
select test.login('fs_rut');
select test.hdr(test.dept('fs-t'));
select test.check((select count(*) = 1 and bool_and(name = 'FS Talk Support') from customers where name like 'FS %'), 'FS Talk: its Support customer only');
select test.hdr(test.dept('fs-t'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'FS Talk Support') from customers where name like 'FS %'), 'asking for FS Talk Sales gives nothing of Sales');
select test.hdr(test.dept('fs-t'));
select test.check((select assign_task_to_team_lead(test.id('fs_tltp'), 'FS task for the Support lead', null, 'LOW', null) is not null), 'gives a task to FS Talk''s Support Team Lead');
select test.must_fail($$select assign_task_to_team_lead(test.id('fs_tlts'), 'FS task for the Sales lead', null, 'LOW', null)$$, 'but not to its Sales Team Lead');
select test.check((select (department_employee_directory(test.dept('fs-t')) ->> 'headDivision') = 'SUPPORT'
                     and (select bool_and(x -> 'team' ->> 'division' in ('SUPPORT', 'GENERAL')) from jsonb_array_elements(department_employee_directory(test.dept('fs-t')) -> 'members') x)),
  'the employee directory of FS Talk: Support people only');
select test.must_fail($$select department_employee_directory(test.dept('fs-a'))$$, 'not a department they were not given', 'own department');
select test.must_fail($$select operations_dashboard()$$, 'no Operations Head pages', 'Operations Heads');
select test.nohdr();
select test.check((select count(*) = 0 from customers where name like 'FS Talk%'), 'without choosing FS Talk, their own department as before');
reset role;
select test.check(private.head_covers(test.id('fs_rut'), test.dept('fs-t'), test.team('fs-t', 'Support')) and not private.head_covers(test.id('fs_rut'), test.dept('fs-t'), test.team('fs-t', 'Sales')),
  'reviews the reports of FS Talk''s Support Team Lead, not of its Sales Team Lead');
insert into approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_division, approver_kind, approver_id)
values ('USER_REGISTRATION', test.id('fs_tmbs'), test.dept('fs-t'), 'PENDING', 'HR', 'TEAM_MEMBER', 'SUPPORT', 'DEPARTMENT_HEAD', null);
set role authenticated;
select test.login('fs_rut');
select test.check(private.can_decide_employee_request((select id from approval_requests where subject_user_id = test.id('fs_tmbs') and status = 'PENDING')), 'decides a Support Team Member request of FS Talk');
reset role;
update approval_requests set requested_division = 'SALES' where subject_user_id = test.id('fs_tmbs') and status = 'PENDING';
set role authenticated;
select test.login('fs_rut');
select test.check(not private.can_decide_employee_request((select id from approval_requests where subject_user_id = test.id('fs_tmbs') and status = 'PENDING')), 'not a Sales one');
reset role;
select test.check((select approver_id from private.resolve_employee_approver('TEAM_MEMBER', false, test.dept('fs-t'), 'SUPPORT')) = test.id('fs_rut'),
  'a new FS Talk Support request is routed to them (FS Talk has no Support head of its own)');
select test.check((select approver_id from private.resolve_employee_approver('TEAM_MEMBER', false, test.dept('fs-t'), 'SALES')) = test.id('fs_dhts'), 'a Sales one to FS Talk''s own Sales head');
delete from approval_requests where subject_user_id = test.id('fs_tmbs');

\echo '   removing the grant takes the access away at once'
set role authenticated;
select test.login('sa');
select department_access_set(test.id('fs_rut'), test.dept('fs-tw'), 'SUPPORT', false);
select test.login('fs_rut');
select test.hdr(test.dept('fs-t'));
select test.check((select count(*) = 0 from customers where name like 'FS Talk%'), 'FS Talk is gone on the next request');
select test.nohdr();

\echo '   the read-only impact report (Super Admin only)'
select test.login('fs_rut');
select test.must_fail($$select function_scope_review()$$, 'not for a Department Head', 'FORBIDDEN');
select test.login('fs_opsup');
select test.must_fail($$select function_scope_review()$$, 'not for an Operations Head', 'FORBIDDEN');
select test.login('sa');
select test.check((select (x ->> 'seesSales')::boolean = false and (x ->> 'seesSupport')::boolean from jsonb_array_elements(function_scope_review() -> 'operationsHeads') x where (x ->> 'id')::uuid = test.id('fs_opsup')),
  'it shows that the Support Operations Head reaches Support only');
reset role;
select test.check((select count(*) = 0 from department_access where profile_id = test.id('fs_rut')), 'nothing left behind');
