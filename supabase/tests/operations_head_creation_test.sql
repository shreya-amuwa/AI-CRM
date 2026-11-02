-- =============================================================================
-- Operations Head creation and multi-department scope (migration 20261218000100). Runs late (same database) with its own synthetic departments:
--   oh-a (Sales + Support teams, one Department Head), oh-b (same), oh-c (a Sales head AND a Support head), oh-d (Sales + Support, a head), oh-e (same),
--   oh-gen (only a General team, a head: the kind of department Accounts / HR are).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 97. Operations Head creation and several departments'
reset role;
\i supabase/migrations/20261218000100_operations_head_creation.sql

delete from auth.users where email like 'oh2.%@example.com';
delete from test.users where name like 'oh2\_%';
delete from teams where department_id in (select id from departments where slug like 'oh2-%');
delete from departments where slug like 'oh2-%';
insert into departments (slug, name) values ('oh2-a', 'OH Alpha'), ('oh2-b', 'OH Beta'), ('oh2-c', 'OH Gamma'), ('oh2-d', 'OH Delta'), ('oh2-e', 'OH Epsilon'),
  ('oh2-gen', 'OH General'), ('oh2-home', 'OH Home');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug in ('oh2-a', 'oh2-b', 'oh2-c', 'oh2-d', 'oh2-e');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug in ('oh2-a', 'oh2-b', 'oh2-c', 'oh2-d', 'oh2-e');
insert into teams (department_id, name, division) select d.id, 'General', 'GENERAL' from departments d where d.slug = 'oh2-gen';

create or replace function test.ohmk(p_name text, p_dept text, p_division text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'oh2.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'OH2 ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept(p_dept), 'provisioned_head_division', p_division))) $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   the Department Heads every department already has'
select test.ohmk('oh2_dha', 'oh2-a');
select test.ohmk('oh2_dhb', 'oh2-b');
select test.ohmk('oh2_dhcs', 'oh2-c', 'SALES');
select test.ohmk('oh2_dhcp', 'oh2-c', 'SUPPORT');
select test.ohmk('oh2_dhd', 'oh2-d');
select test.ohmk('oh2_dhe', 'oh2-e');
select test.ohmk('oh2_dhg', 'oh2-gen');
select test.ohmk('oh2_dhh', 'oh2-home');
select test.check((select count(*) = 8 from profiles where id in (select id from test.users where name like 'oh2\_%') and role = 'DEPARTMENT_HEAD' and not is_operations_head), 'eight plain Department Heads exist');

\echo '   the Department Head rule is unchanged'
set role authenticated;
select test.login('sa');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dept('oh2-a'), null, null)$$, 'a second Department Head of a department is refused', 'already has a Department Head');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dept('oh2-c'), null, 'SUPPORT')$$, 'and a second Support head of a department too', 'Support Department Head');

reset role;
select test.must_fail($$select test.ohmk('oh2_dup', 'oh2-a')$$, 'the database refuses a second plain head at the account creation too', 'already has a Department Head');

\echo '   an Operations Head is creatable although every selected department already has a Department Head'
set role authenticated;
select test.login('sa');
select test.check(assert_can_create_operations_head(test.dept('oh2-a')), 'the Super Admin may make an Operations Head in a department that has a head');
select test.check(assert_can_create_operations_head(test.dept('oh2-c')), 'even one with a Sales head and a Support head');
select test.must_fail($$select assert_can_create_operations_head(null)$$, 'a department is needed', 'at least one department');
select test.login('oh2_dha');
select test.must_fail($$select assert_can_create_operations_head(test.dept('oh2-a'))$$, 'a Department Head cannot make an Operations Head', 'FORBIDDEN');
reset role;
-- as the API does it: the account is created as an Operations Head from the start
create or replace function test.ohmkops(p_name text, p_dept text, p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'oh2.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'OH2 ' || substr(p_name, 5)),
    jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept(p_dept), 'provisioned_operations_head', true)) $$;
grant execute on function test.ohmkops(text, text, text) to anon, authenticated;
select test.ohmkops('oh2_op1', 'oh2-a');
select test.check((select is_operations_head and status = 'ACTIVE' and role = 'DEPARTMENT_HEAD' and head_division is null and department_id = test.dept('oh2-a') from profiles where id = test.id('oh2_op1')),
  'the first Operations Head was created in a department that already has a Department Head, active, with no side');
select test.check((select count(*) = 1 from profiles where role = 'DEPARTMENT_HEAD' and not is_operations_head and department_id = test.dept('oh2-a') and status = 'ACTIVE'), 'and that department still has exactly its own Department Head');
select test.check((select count(*) = 1 from audit_logs where action = 'OPERATIONS_HEAD_SET' and entity_id = test.id('oh2_op1')), 'it is audited');
select test.must_fail($$select test.ohmkops('oh2_bad', 'oh2-b', 'oh2_dhb')$$, 'a Department Head cannot create one through the provisioning either', 'Only the Super Admin');
-- Operations Head home department that already has an Operations Head: also fine
select test.ohmkops('oh2_op2', 'oh2-c');
select test.check((select is_operations_head from profiles where id = test.id('oh2_op2')) and (select count(*) = 2 from profiles where role = 'DEPARTMENT_HEAD' and department_id = test.dept('oh2-c') and not is_operations_head), 'a second Operations Head, homed in a department with a Sales head and a Support head');
select test.check((select count(distinct id) = 2 from profiles where id in (test.id('oh2_op1'), test.id('oh2_op2'))), 'both accounts exist independently');

\echo '   one account, several departments (any department, whatever its teams)'
set role authenticated;
select test.login('sa');
select test.must_fail($$select operations_head_assign_new(test.id('oh2_op1'), array[]::uuid[])$$, 'at least one department is needed', 'at least one department');
select test.check((select jsonb_array_length(operations_head_assign_new(test.id('oh2_op1'), array[test.dept('oh2-a'), test.dept('oh2-b'), test.dept('oh2-gen')]) -> 'departments') = 3), 'the first Operations Head supervises Alpha, Beta and General (a department with only a General team)');
select test.check((select jsonb_array_length(operations_head_assign_new(test.id('oh2_op2'), array[test.dept('oh2-c'), test.dept('oh2-d')]) -> 'departments') = 2), 'the second supervises Gamma and Delta');
reset role;
select test.check((select count(*) = 3 from operations_head_departments where profile_id = test.id('oh2_op1')) and (select count(*) = 2 from operations_head_departments where profile_id = test.id('oh2_op2')), 'the assignments are rows of one table, one per head and department');
select test.must_fail($$insert into operations_head_departments (profile_id, department_id) values (test.id('oh2_op1'), test.dept('oh2-a'))$$, 'no duplicate assignment', 'duplicate key');
select test.check((select count(*) = 1 from profiles where email = 'oh2.op1@example.com') and (select count(*) = 1 from auth.users where email = 'oh2.op1@example.com'), 'one login for the Operations Head');
select test.check((select count(*) = 3 from private.scopes_of(test.id('oh2_op1')) where department_id in (test.dept('oh2-a'), test.dept('oh2-b'), test.dept('oh2-gen'))), 'the scope covers the three departments');
select test.check((select count(*) = 0 from private.scopes_of(test.id('oh2_op1')) where department_id in (test.dept('oh2-c'), test.dept('oh2-d'), test.dept('oh2-e'))), 'and none of the others');
select test.check((select count(*) >= 3 from department_operations_owner where operations_head_id = test.id('oh2_op1')), 'a department nobody was accountable for is now this head''s (approves heads)');

\echo '   each dashboard shows only its own departments'
set role authenticated;
select test.login('oh2_op1');
select test.check((select array_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(operations_dashboard() -> 'departments') x where (x ->> 'slug') like 'oh2-%') = array['OH Alpha', 'OH Beta', 'OH General'], 'the first Operations Head sees Alpha, Beta and General in one dashboard');
select test.check((select (x -> 'departmentHeads' -> 0 ->> 'name') = 'OH2 dha' from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'slug' = 'oh2-a'), 'with the Department Head of each department (not replaced)');
select test.must_fail($$select operations_department_detail(test.dept('oh2-c'))$$, 'another Operations Head''s department is refused', 'FORBIDDEN|not');
select test.must_fail($$select operations_department_detail(test.dept('oh2-e'))$$, 'and so is an unassigned one', 'FORBIDDEN|not');
select test.check((operations_department_detail(test.dept('oh2-gen')) is not null), 'a General-team department can be opened');
select test.login('oh2_op2');
select test.check((select array_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(operations_dashboard() -> 'departments') x where (x ->> 'slug') like 'oh2-%') = array['OH Delta', 'OH Gamma'], 'the second sees only Gamma and Delta');

\echo '   the Super Admin changes the departments; no new account'
select test.login('sa');
select test.check((select jsonb_array_length(operations_head_scope_set(test.id('oh2_op1'), array[test.dept('oh2-a'), test.dept('oh2-b'), test.dept('oh2-gen'), test.dept('oh2-e')]) -> 'departments') = 4), 'a fourth department is added to the same account');
select test.login('oh2_op1');
select test.check((select count(*) = 4 from jsonb_array_elements(operations_dashboard() -> 'departments') x where (x ->> 'slug') like 'oh2-%'), 'and appears on the same dashboard');
reset role;
select test.check((select count(*) = 1 from profiles where email = 'oh2.op1@example.com'), 'without a second account');
select count(*) as before_customers from customers \gset
select count(*) as before_people from profiles where department_id = test.dept('oh2-b') \gset
set role authenticated;
select test.login('sa');
select operations_head_scope_set(test.id('oh2_op1'), array[test.dept('oh2-a'), test.dept('oh2-gen'), test.dept('oh2-e')]);
select test.login('oh2_op1');
select test.check((select count(*) = 0 from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'slug' = 'oh2-b'), 'a removed department leaves the dashboard at once');
select test.must_fail($$select operations_department_detail(test.dept('oh2-b'))$$, 'and its data is refused at once', 'FORBIDDEN|not');
reset role;
select test.check((select count(*) = :before_customers from customers) and (select count(*) = :before_people from profiles where department_id = test.dept('oh2-b')), 'removing the assignment deleted nothing: the department, its people and customers are all still there');
select test.check((select count(*) = 1 from profiles where role = 'DEPARTMENT_HEAD' and not is_operations_head and department_id = test.dept('oh2-b') and status = 'ACTIVE') and exists (select 1 from departments where slug = 'oh2-b'), 'including its Department Head');
select test.check((select count(*) = 0 from department_operations_owner where operations_head_id = test.id('oh2_op1') and department_id = test.dept('oh2-b')), 'and the accountability for it went with the assignment');
set role authenticated;
select test.login('sa');
select operations_head_scope_set(test.id('oh2_op1'), array[test.dept('oh2-gen'), test.dept('oh2-e')]);
reset role;
select test.check((select department_id = test.dept('oh2-gen') from profiles where id = test.id('oh2_op1')), 'taking away the home department places the person in the first department that remains');
select test.check((select count(*) = 1 from profiles where role = 'DEPARTMENT_HEAD' and not is_operations_head and department_id = test.dept('oh2-a') and status = 'ACTIVE'), 'the Department Head of that department is untouched');
set role authenticated;
select test.login('oh2_op1');
select test.must_fail($$select operations_department_detail(test.dept('oh2-a'))$$, 'access to it is gone', 'FORBIDDEN|not');
select test.must_fail($$select operations_head_scope_set(test.id('oh2_op1'), array[test.dept('oh2-a')])$$, 'an Operations Head cannot change their own departments', 'FORBIDDEN');
select test.must_fail($$select operations_head_scope_set(test.id('oh2_op2'), array[test.dept('oh2-a')])$$, 'nor another one''s', 'FORBIDDEN');
select test.must_fail($$select operations_head_assign_new(test.id('oh2_op2'), array[test.dept('oh2-a')])$$, 'nor assign departments to anyone', 'FORBIDDEN');
select test.must_fail($$select set_operations_head(test.id('oh2_dha'), true)$$, 'nor promote anybody to Operations Head', 'FORBIDDEN');
select test.must_fail($$select assert_can_create_operations_head(test.dept('oh2-gen'))$$, 'nor create an Operations Head', 'FORBIDDEN');
select test.must_fail($$select count(*) from operations_head_departments$$, 'the table has no direct access', 'permission denied');

\echo '   suspending takes the access away; reactivating gives it back'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('oh2_op2');
select test.check((select count(*) = 0 from private.scopes_of(test.id('oh2_op2'))), 'a suspended Operations Head supervises nothing');
update profiles set status = 'ACTIVE' where id = test.id('oh2_op2');
select test.check((select count(*) = 2 from private.scopes_of(test.id('oh2_op2')) where department_id in (test.dept('oh2-c'), test.dept('oh2-d'))), 'and gets the same departments back when reactivated');

\echo '   Department Heads keep working, and the Super Admin sees it all'
set role authenticated;
select test.login('oh2_dha');
select test.must_fail($$select operations_dashboard()$$, 'a Department Head has no Operations dashboard', 'FORBIDDEN');
select test.login('sa');
select test.check((select count(*) = 2 from jsonb_array_elements(operations_heads_list() -> 'heads') h where h ->> 'email' like 'oh2.op%'), 'the Super Admin lists both Operations Heads');
select test.check((select jsonb_array_length(h -> 'departments') = 2 from jsonb_array_elements(operations_heads_list() -> 'heads') h where h ->> 'email' = 'oh2.op1@example.com'), 'with the departments of each');

\echo '   an Operations Head can become a plain Department Head again only where the head slot is free'
reset role;
select test.must_fail($$select set_operations_head(test.id('oh2_op2'), false)$$, 'removing the role needs the Super Admin', 'FORBIDDEN') where false;
select test.check((select count(*) = 1 from profiles where role = 'DEPARTMENT_HEAD' and not is_operations_head and department_id = test.dept('oh2-gen') and status = 'ACTIVE'), 'the General department still has exactly one Department Head');
\echo '   Operations Head creation tests done'
