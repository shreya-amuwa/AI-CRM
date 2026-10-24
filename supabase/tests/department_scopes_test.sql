-- =============================================================================
-- Department Heads in several departments / functions (migration 20261123000100).
--   Group A (shared): one Sales head and one Support head who each look after the same three departments (dtalk, digitree, whatsbox here).
--   Group B (combined): one head who handles both Sales and Support of a department (mpillar here).
-- The active department / function is chosen by request headers and is only accepted when the Super Admin authorised that pair.
-- Runs after the other suites (same database).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- department scopes'
reset role;
\i supabase/migrations/20261123000100_department_scopes.sql

create or replace function test.hdr(p_department uuid, p_division text default null) returns void language sql as $$
  select set_config('request.headers', jsonb_strip_nulls(jsonb_build_object('x-active-department', p_department::text, 'x-active-division', p_division))::text, false)
$$;
create or replace function test.nohdr() returns void language sql as $$ select set_config('request.headers', '', false) $$;
grant execute on function test.hdr(uuid, text), test.nohdr() to authenticated;

-- people
select test.create_auth_user('ga_s', 'ga.s@amuwa.com', '{"full_name":"Shared Sales Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('dtalk'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('ga_p', 'ga.p@amuwa.com', '{"full_name":"Shared Support Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('dtalk'), 'provisioned_head_division', 'SUPPORT'));
select test.create_auth_user('gb_h', 'gb.h@amuwa.com', '{"full_name":"Combined Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('mpillar')));
select test.create_auth_user('ds_s', 'ds.s@amuwa.com', '{"full_name":"DTalk Sales Member"}',   jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('dtalk', 'Sales')));
select test.create_auth_user('ds_p', 'ds.p@amuwa.com', '{"full_name":"DTalk Support Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('dtalk', 'Support')));
select test.create_auth_user('dg_s', 'dg.s@amuwa.com', '{"full_name":"Digitree Sales Member"}',   jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('digitree', 'Sales')));
select test.create_auth_user('dg_p', 'dg.p@amuwa.com', '{"full_name":"Digitree Support Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('digitree', 'Support')));
select test.create_auth_user('dg_tl', 'dg.tl@amuwa.com', '{"full_name":"Digitree Sales Lead"}',   jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('digitree', 'Sales')));
select test.create_auth_user('ds_tl', 'ds.tl@amuwa.com', '{"full_name":"DTalk Sales Lead"}',   jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('dtalk', 'Sales')));
select test.create_auth_user('wx_s', 'wx.s@amuwa.com', '{"full_name":"Whatsbox Sales Member"}',   jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
select test.create_auth_user('wx_p', 'wx.p@amuwa.com', '{"full_name":"Whatsbox Support Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Support')));
select test.create_auth_user('mp_s', 'mp.s@amuwa.com', '{"full_name":"MPillar Sales Member"}',   jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('mpillar', 'Sales')));
select test.create_auth_user('mp_p', 'mp.p@amuwa.com', '{"full_name":"MPillar Support Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('mpillar', 'Support')));
-- the data of every department and side
insert into customers (owner_id, name, phone, lifecycle_stage)
  values (test.id('ds_s'), 'SC DTalk Sales',    '+919811000001', 'LEAD'), (test.id('ds_p'), 'SC DTalk Support',    '+919811000002', 'CUSTOMER'),
         (test.id('dg_s'), 'SC Digitree Sales',  '+919811000003', 'LEAD'), (test.id('dg_p'), 'SC Digitree Support',  '+919811000004', 'CUSTOMER'),
         (test.id('wx_s'), 'SC Whatsbox Sales', '+919811000005', 'LEAD'), (test.id('wx_p'), 'SC Whatsbox Support', '+919811000006', 'CUSTOMER'),
         (test.id('mp_s'), 'SC MPillar Sales', '+919811000007', 'LEAD'), (test.id('mp_p'), 'SC MPillar Support', '+919811000008', 'CUSTOMER');
insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date, status) values
  (test.dept('digitree'), test.team('digitree', 'Sales'),   'SC task Digitree Sales',   test.id('sa'), test.id('dg_tl'), current_date + 1, 'ASSIGNED'),
  (test.dept('digitree'), test.team('digitree', 'Support'), 'SC task Digitree Support', test.id('sa'), test.id('dg_p'),  current_date + 1, 'ASSIGNED');

\echo '   granting'
set role authenticated;
select test.login('ga_s');
select test.must_fail($$select department_access_set(test.id('ga_s'), test.dept('digitree'), 'SALES', true)$$, 'a Department Head cannot give themselves more departments', 'FORBIDDEN');
select test.must_fail($$select department_access_get(test.id('ga_s'))$$, 'nor read the grants', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select department_access_set(test.id('ds_s'), test.dept('digitree'), 'SALES', true)$$, 'only a Department Head can be given more', 'Only an active Department Head');
select test.must_fail($$select department_access_set(test.id('ga_s'), test.dept('accounts'), 'SALES', true)$$, 'a department with no Sales team cannot be granted', 'no Sales team');
select test.must_fail($$select department_access_set(test.id('ga_s'), test.dept('digitree'), 'GENERAL', true)$$, 'only Sales or Support', 'Choose Sales or Support');
select department_access_set(test.id('ga_s'), test.dept('digitree'), 'SALES', true);
select department_access_set(test.id('ga_s'), test.dept('whatsbox'), 'SALES', true);
select department_access_set(test.id('ga_p'), test.dept('digitree'), 'SUPPORT', true);
select department_access_set(test.id('ga_p'), test.dept('whatsbox'), 'SUPPORT', true);
select department_access_set(test.id('gb_h'), test.dept('mpillar'), 'SALES', true);
select department_access_set(test.id('gb_h'), test.dept('mpillar'), 'SUPPORT', true);
reset role;
select test.check((select count(*) = 6 from public.department_access), 'six authorised pairs are recorded');
select test.check((select count(*) = 6 from audit_logs where action = 'DEPARTMENT_ACCESS_GRANTED'), 'each grant is audited');
set role authenticated;

\echo '   Group A: the shared Sales head'
select test.login('ga_s');
select test.nohdr();
select test.check((select jsonb_array_length(my_department_scopes() -> 'departments') = 3 and (my_department_scopes() ->> 'homeDepartmentId') = test.dept('dtalk')::text
                     and (select bool_and((x -> 'divisions') = '["SALES"]'::jsonb) from jsonb_array_elements(my_department_scopes() -> 'departments') x)
                     and (select array_agg(x ->> 'slug' order by x ->> 'slug') = array['digitree', 'dtalk', 'whatsbox'] from jsonb_array_elements(my_department_scopes() -> 'departments') x)),
  'the shared Sales head is offered exactly their three departments, Sales only');
select test.check((select count(*) = 1 from customers where name like 'SC %'), 'no header: the home department only, Sales only');
select test.check((select name = 'SC DTalk Sales' from customers where name like 'SC %'), '... which is the home department''s Sales customer');
select test.hdr(test.dept('digitree'));
select test.check((select count(*) = 1 and bool_and(name = 'SC Digitree Sales') from customers where name like 'SC %'), 'active Digitree: its Sales customer only');
select test.check((select count(*) = 1 from work_tasks where title like 'SC task%') and (select title = 'SC task Digitree Sales' from work_tasks where title like 'SC task%'), 'tasks follow the active department and function');
select test.check((select count(*) = 0 from profiles where id = test.id('dg_p')) and (select count(*) = 1 from profiles where id = test.id('dg_tl')) and (select count(*) = 0 from profiles where id = test.id('ds_s')), 'people: Digitree''s Sales people, not its Support people nor another department''s');
select test.check((my_department_scopes() ->> 'activeDepartmentId') = test.dept('digitree')::text and (my_department_scopes() ->> 'activeDivision') = 'SALES', 'the scope the database applies is reported back');
select test.hdr(test.dept('whatsbox'));
select test.check((select count(*) = 1 and bool_and(name = 'SC Whatsbox Sales') from customers where name like 'SC %'), 'active Whatsbox: its Sales customer only');
select test.hdr(test.dept('mpillar'));
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Sales') from customers where name like 'SC %'), 'a department they are not authorised for is ignored: still the home department');
select test.hdr(test.dept('digitree'), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'SC Digitree Sales') from customers where name like 'SC %'), 'asking for the Support function does not give Support data');
select test.hdr(test.dept('digitree'), 'sales');
select test.check((select count(*) = 1 from customers where name = 'SC Digitree Sales'), 'the function is case-insensitive');
select test.hdr(null, 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Sales') from customers where name like 'SC %'), 'a function header alone changes nothing');
\echo '   Group A: acting in the active department'
select test.hdr(test.dept('digitree'));
select test.check((select assign_task_to_team_lead(test.id('dg_tl'), 'SC given by the shared head', null, 'LOW', null) is not null), 'in Digitree the shared Sales head can give a task to Digitree''s Sales Team Lead');
select test.hdr(test.dept('dtalk'));
select test.must_fail($$select assign_task_to_team_lead(test.id('dg_tl'), 'SC wrong department', null, 'LOW', null)$$, 'but not while the active department is DTalk');
select test.hdr(test.dept('digitree'));
select test.check(assert_can_create_user('TEAM_MEMBER', test.dept('digitree'), test.team('digitree', 'Sales')), 'can create a Sales employee in the active department');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', test.dept('digitree'), test.team('digitree', 'Support'))$$, 'but not a Support employee', 'not allowed');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', test.dept('dtalk'), test.team('dtalk', 'Sales'))$$, 'nor one in a department that is not the active one');
reset role;
select test.check((select (private.chat_may_message(test.id('ga_s'), test.id('dg_p'))) = false), 'chat: not with Support people');
select test.check((select (private.chat_may_message(test.id('ga_s'), test.id('dg_tl'))) = true), 'chat: with Sales people');
set role authenticated;

\echo '   Group A: the shared Support head'
select test.login('ga_p');
select test.nohdr();
select test.check((select jsonb_array_length(my_department_scopes() -> 'departments') = 3 and (select bool_and((x -> 'divisions') = '["SUPPORT"]'::jsonb) from jsonb_array_elements(my_department_scopes() -> 'departments') x)),
  'the shared Support head is offered the same three departments, Support only');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Support') from customers where name like 'SC %'), 'home department: Support customer only (no Sales data)');
select test.hdr(test.dept('digitree'));
select test.check((select count(*) = 1 and bool_and(name = 'SC Digitree Support') from customers where name like 'SC %'), 'active Digitree: its Support customer only');
select test.check((select count(*) = 1 and bool_and(title = 'SC task Digitree Support') from work_tasks where title like 'SC task Digitree%'), 'its Support task only');
select test.hdr(test.dept('digitree'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'SC Digitree Support') from customers where name like 'SC %'), 'asking for the Sales function does not give Sales data');
select test.hdr(test.dept('mpillar'));
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Support') from customers where name like 'SC %'), 'an unauthorised department is ignored');
select test.must_fail($$select sales_head_overview()$$, 'the Support head cannot open the Sales head pages', 'Sales Department Head');

\echo '   Group B: the combined head'
select test.login('gb_h');
select test.nohdr();
select test.check((select jsonb_array_length(my_department_scopes() -> 'departments') = 1 and (my_department_scopes() -> 'departments' -> 0 -> 'divisions') = '["SALES","SUPPORT"]'::jsonb
                     and (my_department_scopes() -> 'departments' -> 0 ->> 'slug') = 'mpillar'), 'one department, both functions');
select test.check((select count(*) = 2 from customers where name like 'SC %'), 'no function chosen: the whole department, as an unlabelled head always had');
select test.hdr(test.dept('mpillar'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'SC MPillar Sales') from customers where name like 'SC %'), 'Sales selected: Sales customers only');
select test.check((private.is_sales_head()), 'and the Sales head pages open');
select test.check((select sales_head_overview() is not null), 'the existing Sales overview answers');
select test.hdr(test.dept('mpillar'), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'SC MPillar Support') from customers where name like 'SC %'), 'Support selected: Support customers only, same department');
select test.must_fail($$select sales_head_overview()$$, 'and the Sales head pages are closed', 'Sales Department Head');
select test.check((my_department_scopes() ->> 'activeDepartmentId') = test.dept('mpillar')::text, 'switching function keeps the department');
select test.hdr(test.dept('dtalk'), 'SALES');
select test.check((select count(*) = 0 from customers where name like 'SC DTalk%'), 'another department is not reachable by a header');
select test.check((select count(*) = 0 from customers where name like 'SC Digitree%'), '... whichever it is');

\echo '   Super Admin and the other roles are not affected by headers'
select test.login('sa');
select test.hdr(test.dept('digitree'), 'SALES');
select test.check((select count(*) = 8 from customers where name like 'SC %'), 'the Super Admin still reads every department');
select test.login('ds_s');
select test.hdr(test.dept('digitree'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Sales') from customers where name like 'SC %'), 'a Team Member cannot reach another department with a header');
select test.login('dg_tl');
select test.hdr(test.dept('dtalk'));
select test.check((select count(*) = 0 from customers where name like 'SC DTalk%'), 'nor a Team Lead');
select test.login('dh_wbx');
select test.hdr(test.dept('digitree'));
select test.check((select count(*) = 0 from customers where name like 'SC Digitree%'), 'nor a Department Head with no extra scope');
select test.check((my_department_scopes() ->> 'activeDepartmentId') = test.dept('whatsbox')::text, 'who stays in their own department');
select test.login('ds_s');
select test.check((jsonb_array_length(my_department_scopes() -> 'departments') = 0), 'a member is offered no departments');
select test.nohdr();

\echo '   the API session reports the active department'
select test.login('ga_s');
select test.hdr(test.dept('digitree'));
select test.check((api_session('[]'::jsonb) -> 'profile' ->> 'department_id') = test.dept('digitree')::text and (api_session('[]'::jsonb) -> 'profile' ->> 'head_division') = 'SALES', 'api_session carries the active department and function');
select test.nohdr();
select test.check((api_session('[]'::jsonb) -> 'profile' ->> 'department_id') = test.dept('dtalk')::text, 'without a header, the home department');
select test.login('ds_s');
select test.hdr(test.dept('digitree'));
select test.check((api_session('[]'::jsonb) -> 'profile' ->> 'department_id') = test.dept('dtalk')::text, 'a member is always in their own department');
select test.nohdr();

\echo '   revoking'
select test.login('sa');
select department_access_set(test.id('ga_s'), test.dept('digitree'), 'SALES', false);
reset role;
select test.check((select count(*) = 5 from public.department_access) and (select count(*) = 1 from audit_logs where action = 'DEPARTMENT_ACCESS_REVOKED'), 'a grant can be taken away (and is audited)');
set role authenticated;
select test.login('ga_s');
select test.hdr(test.dept('digitree'));
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Sales') from customers where name like 'SC %'), 'the revoked department is no longer reachable');
select test.check((jsonb_array_length(my_department_scopes() -> 'departments') = 2), 'and no longer offered');
select test.nohdr();
-- a suspended head loses every scope
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('ga_p');
set role authenticated;
select test.login('ga_p');
select test.hdr(test.dept('digitree'));
select test.check((select count(*) = 0 from customers where name like 'SC %') and (select active_department_id is null from (select private.active_department_id() as active_department_id) x), 'a suspended head has no scope');
select test.nohdr();
reset role;
update profiles set status = 'ACTIVE' where id = test.id('ga_p');
\echo '   done'
