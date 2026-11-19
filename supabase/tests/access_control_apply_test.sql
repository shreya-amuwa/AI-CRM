-- =============================================================================
-- Access Control (migration 20261126000100): the Super Admin's whole-matrix Save, the shared Sales / Support heads and the combined heads.
--   Group A  one Sales head (Whatsbox, Wabastar, Wabastore) and one Support head (Whatsbox, Wabatalk, Wabastore, Wabastar)
--   Group B  one person for Sales AND Support of M Pillar, Digitree, Amuwa Design Studio and D Talk
-- Runs after department_heads_overview_test.sql (same database).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- access control: shared Sales / Support heads and combined heads'
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false);
create or replace function test.dep(p text) returns uuid language sql stable as $$ select id from public.departments where slug = p $$;
grant execute on function test.dep(text) to authenticated;
create or replace function test.pair(p_slug text, p_division text) returns jsonb language sql stable as
  $$ select jsonb_build_object('departmentId', test.dep(p_slug), 'division', p_division) $$;
grant execute on function test.pair(text, text) to authenticated;

select test.check((select count(*) = 1 from teams where department_id = test.dep('wabastar') and division = 'SALES') and (select count(*) = 1 from teams where department_id = test.dep('wabastar') and division = 'SUPPORT')
                   and (select count(*) = 1 from teams where department_id = test.dep('designstudio') and division = 'SALES') and (select count(*) = 1 from teams where department_id = test.dep('designstudio') and division = 'SUPPORT'),
  'Wabastar and Amuwa Design Studio have a Sales and a Support team (once each)');
select test.check((select count(*) = 1 from teams where department_id = test.dep('wabastar') and division = 'GENERAL'), '... and their General team is untouched');

-- people: the shared heads, the combined heads, and a member with a customer in every Sales / Support side
select test.create_auth_user('ac_s', 'ac.s@amuwa.com', '{"full_name":"Shared Sales Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dep('whatsbox'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('ac_p', 'ac.p@amuwa.com', '{"full_name":"Shared Support Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dep('whatsbox'), 'provisioned_head_division', 'SUPPORT'));
-- Amuwa Design Studio's head: the one journeys_test created (a department has one unlabelled head), or a new one when run on its own
select test.create_auth_user('ds_head', 'ds.head@amuwa.com', '{"full_name":"DS Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dep('designstudio')))
 where not exists (select 1 from test.users where name = 'ds_head');
select test.create_auth_user('ac_dt', 'ac.dt@amuwa.com', '{"full_name":"D Talk Combined Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dep('dtalk')));
select test.create_auth_user('ac_dg', 'ac.dg@amuwa.com', '{"full_name":"Digitree Combined Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dep('digitree'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('ac_sp', 'ac.sp@amuwa.com', '{"full_name":"Wabastar Support Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastar', 'Support')));
select test.create_auth_user('ac_ss', 'ac.ss@amuwa.com', '{"full_name":"Wabastar Sales Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastar', 'Sales')));
select test.create_auth_user('ac_wp', 'ac.wp@amuwa.com', '{"full_name":"Wabastore Support Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support')));
select test.create_auth_user('ac_ws', 'ac.ws@amuwa.com', '{"full_name":"Wabastore Sales Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
insert into customers (owner_id, name, phone, lifecycle_stage) values
  (test.id('ac_sp'), 'AC Wabastar Support', '+919813000001', 'CUSTOMER'), (test.id('ac_ss'), 'AC Wabastar Sales', '+919813000002', 'LEAD'),
  (test.id('ac_wp'), 'AC Wabastore Support', '+919813000003', 'CUSTOMER'), (test.id('ac_ws'), 'AC Wabastore Sales', '+919813000004', 'LEAD'),
  (test.id('wx_p'), 'AC Whatsbox Support', '+919813000005', 'CUSTOMER'), (test.id('wx_s'), 'AC Whatsbox Sales', '+919813000006', 'LEAD'),
  (test.id('ds_p'), 'AC DTalk Support', '+919813000007', 'CUSTOMER'), (test.id('ds_s'), 'AC DTalk Sales', '+919813000008', 'LEAD');
select test.check((select count(*) = 8 from customers where name like 'AC %'), '(setup) a Sales and a Support customer in four departments');
select test.check((select count(*) = 1 from profiles where email = 'ac.s@amuwa.com') and (select count(*) = 1 from auth.users where email = 'ac.s@amuwa.com'), 'the shared Sales head is ONE account');

set role authenticated;
select test.login('sa');

\echo '   Group A: the shared Sales head (home Whatsbox) - Save the matrix'
select test.must_fail($$select department_access_apply(test.id('ac_s'), jsonb_build_array(test.pair('accounts', 'SALES')))$$, 'a department without a Sales team is refused, nothing is saved', 'no Sales team');
select test.must_fail($$select department_access_apply(test.id('ds_s'), '[]'::jsonb)$$, 'only a Department Head has a matrix', 'Only an active Department Head');
select test.must_fail($$select department_access_apply(test.id('ac_s'), '{}'::jsonb)$$, 'a non-list is refused', 'Invalid departments');
select test.must_fail($$select department_access_apply(test.id('ac_s'), '[{"departmentId":"x","division":"SALES"}]'::jsonb)$$, 'a malformed id is refused', 'Invalid department');
reset role;
select test.check((select count(*) = 0 from department_access where profile_id = test.id('ac_s')), 'a refused save changes nothing');
set role authenticated;
select test.login('sa');
select test.must_fail($$select department_access_apply(test.id('ac_s'), jsonb_build_array(test.pair('wabastar', 'SALES')))$$, 'a Department Head who is not an Operations Head cannot be given another department', 'Operations Head');
select set_operations_head(test.id('ac_s'), true);
select set_operations_head(test.id('ac_p'), true);
select department_access_apply(test.id('ac_s'), jsonb_build_array(test.pair('whatsbox', 'SALES'), test.pair('wabastar', 'SALES'), test.pair('wabastore', 'SALES')));
reset role;
select test.check((select count(*) = 2 from department_access where profile_id = test.id('ac_s')), 'Save stored the two extra Sales pairs (Whatsbox is the head''s own placement)');
select test.check((select count(*) = 1 from profiles where email = 'ac.s@amuwa.com') and (select count(*) = 1 from auth.users where email = 'ac.s@amuwa.com'), 'still ONE account');
select test.check((select count(*) = 2 from audit_logs where action = 'DEPARTMENT_ACCESS_GRANTED' and entity_id = test.id('ac_s')), 'each change is audited');
set role authenticated;
select test.login('sa');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('whatsbox'))) x where x ->> 'profileId' = test.id('ac_s')::text), 'the same person is listed in Whatsbox ...');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('wabastar'))) x where x ->> 'profileId' = test.id('ac_s')::text), '... in Wabastar ...');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('wabastore'))) x where x ->> 'profileId' = test.id('ac_s')::text), '... and in Wabastore');
select test.check((select count(*) = 0 from jsonb_array_elements(department_heads_overview(test.dep('dtalk'))) x where x ->> 'profileId' = test.id('ac_s')::text), 'but not in a department they were not given');
select department_access_apply(test.id('ac_s'), jsonb_build_array(test.pair('wabastar', 'SALES'), test.pair('wabastore', 'SALES')));   -- idempotent re-save
reset role;
select test.check((select count(*) = 2 from department_access where profile_id = test.id('ac_s')) and (select count(*) = 2 from audit_logs where action = 'DEPARTMENT_ACCESS_GRANTED' and entity_id = test.id('ac_s')), 'saving the same matrix again changes and audits nothing');
set role authenticated;
select test.login('ac_s');
select test.nohdr();
select test.check((select array_agg(x ->> 'slug' order by x ->> 'slug') = array['wabastar', 'wabastore', 'whatsbox'] and bool_and(x -> 'divisions' = '["SALES"]'::jsonb) from jsonb_array_elements(my_department_scopes() -> 'departments') x),
  'the Sales head is offered Whatsbox, Wabastar and Wabastore, Sales only');
select test.hdr(test.dep('wabastar'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Wabastar Sales') from customers where name like 'AC %'), 'Wabastar: its Sales customer only');
select test.check((select jsonb_typeof(sales_head_overview()) = 'object'), 'Wabastar: the Sales head pages open');
select test.hdr(test.dep('wabastore'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Wabastore Sales') from customers where name like 'AC %'), 'Wabastore: its Sales customer only');
select test.hdr(test.dep('wabastar'), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'AC Wabastar Sales') from customers where name like 'AC %'), 'asking for Support gives no Support data');
select test.hdr(test.dep('dtalk'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Whatsbox Sales') from customers where name like 'AC %'), 'a department not assigned is ignored (home: Whatsbox Sales)');
select test.nohdr();

\echo '   Group A: the shared Support head (home Whatsbox) - Whatsbox, Wabatalk, Wabastore, Wabastar'
select test.login('sa');
select test.must_fail($$select department_access_apply(test.id('ac_p'), jsonb_build_array(test.pair('wabatalk', 'SALES')))$$, 'Wabatalk cannot be given for Sales', 'only Support can be given');
select test.must_fail($$select department_access_apply(test.id('ac_p'), jsonb_build_array(test.pair('dtalk', 'SUPPORT')))$$, 'D Talk''s Support is given as Wabatalk', 'Give Wabatalk instead');
select department_access_apply(test.id('ac_p'), jsonb_build_array(test.pair('wabatalk', 'SUPPORT'), test.pair('wabastore', 'SUPPORT'), test.pair('wabastar', 'SUPPORT')));
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('whatsbox'))) x where x ->> 'profileId' = test.id('ac_p')::text), 'the same person is listed in Whatsbox ...');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('wabastar'))) x where x ->> 'profileId' = test.id('ac_p')::text), '... Wabastar ...');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('wabastore'))) x where x ->> 'profileId' = test.id('ac_p')::text), '... Wabastore ...');
select test.check((select count(*) = 1 from jsonb_array_elements(department_heads_overview(test.dep('wabatalk'))) x where x ->> 'profileId' = test.id('ac_p')::text), '... and Wabatalk');
select test.check((select jsonb_array_length(x -> 'access') = 4 and (select array_agg(a ->> 'department' order by a ->> 'department') = array['Wabastar', 'Wabastore', 'Wabatalk', 'Whatsbox'] from jsonb_array_elements(x -> 'access') a)
                     and (select bool_and(a ->> 'division' = 'SUPPORT') from jsonb_array_elements(x -> 'access') a)
                     from jsonb_array_elements(department_heads_overview(test.dep('wabastar'))) x where x ->> 'profileId' = test.id('ac_p')::text), 'the person works in all four departments, Support only');
select test.login('ac_p');
select test.nohdr();
select test.check((select array_agg(x ->> 'slug' order by x ->> 'slug') = array['wabastar', 'wabastore', 'wabatalk', 'whatsbox'] from jsonb_array_elements(my_department_scopes() -> 'departments') x), 'they are offered the four departments');
select test.hdr(test.dep('wabastar'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Wabastar Support') from customers where name like 'AC %'), 'Wabastar Support is handled by the shared Support head: its Support customer');
select test.hdr(test.dep('wabastore'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Wabastore Support') from customers where name like 'AC %'), 'Wabastore: its Support customer only');
select test.hdr(test.wtid2());
select test.check((select count(*) = 1 and bool_and(name = 'AC DTalk Support') from customers where name like 'AC %'), 'Wabatalk: D Talk''s Support customer only');
select test.hdr(test.dep('whatsbox'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Whatsbox Support') from customers where name like 'AC %'), 'Whatsbox: its Support customer only');
select test.must_fail($$select sales_head_overview()$$, 'no Sales access comes with Support', 'Sales Department Head');
select test.hdr(test.dep('wabastar'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'AC Wabastar Support') from customers where name like 'AC %'), 'asking for Sales still gives Support data only');
select test.nohdr();

\echo '   Group B: one person for Sales and Support'
select test.login('sa');
-- M Pillar (existing head), Amuwa Design Studio, D Talk (Sales + its Support, Wabatalk), Digitree (Sales head given Support too)
select department_access_apply(test.id('gb_h'), jsonb_build_array(test.pair('mpillar', 'SALES'), test.pair('mpillar', 'SUPPORT')));
-- Amuwa Design Studio has no Sales or Support function to give (migration 20270112000200), for the retired department as well
select test.must_fail($$select department_access_apply(test.id('ds_head'), jsonb_build_array(test.pair('designstudio', 'SALES'), test.pair('designstudio', 'SUPPORT')))$$,
  'the retired Amuwa Design Studio cannot be given Sales or Support', 'no Sales or Support function');
select department_access_apply(test.id('ac_dt'), jsonb_build_array(test.pair('dtalk', 'SALES'), test.pair('wabatalk', 'SUPPORT')));
select department_access_apply(test.id('ac_dg'), jsonb_build_array(test.pair('digitree', 'SALES'), test.pair('digitree', 'SUPPORT')));
select test.check((select count(*) = 1 from profiles where email = 'ds.head@amuwa.com' ) and (select count(*) = 1 from profiles where email = 'ac.dt@amuwa.com') and (select count(*) = 1 from profiles where email = 'ac.dg@amuwa.com'), 'one account each');
select test.login('ac_dt');
select test.nohdr();
select test.check((select jsonb_array_length(my_department_scopes() -> 'departments') = 1 and (my_department_scopes() -> 'departments' -> 0 ->> 'slug') = 'dtalk' and (my_department_scopes() -> 'departments' -> 0 -> 'divisions') = '["SALES","SUPPORT"]'::jsonb),
  'D Talk: ONE department with the Sales | Support selector (its Support is Wabatalk)');
select test.hdr(test.dep('dtalk'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'AC DTalk Sales') from customers where name like 'AC %'), 'D Talk, Sales selected: its Sales customer only');
select test.check((my_department_scopes() ->> 'activeDepartmentId') = test.dep('dtalk')::text, '... and the department is D Talk');
select test.hdr(test.dep('dtalk'), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'AC DTalk Support') from customers where name like 'AC %'), 'Support selected: its Support customer only');
select test.check((my_department_scopes() ->> 'activeDepartmentId') = test.dep('dtalk')::text and (my_department_scopes() ->> 'activeDivision') = 'SUPPORT', '... the department did not change');
select test.hdr(test.dep('wabastar'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'AC DTalk Sales') from customers where name like 'AC %'), 'another department is not reachable (home: D Talk)');
select test.login('ds_head');
reset role;
select test.check((select count(*) = 0 from department_access where profile_id = test.id('ds_head')), 'Amuwa Design Studio: no Sales / Support grant was saved for its head');
set role authenticated;
select test.nohdr();
select test.login('gb_h');
select test.check((select jsonb_array_length(my_department_scopes() -> 'departments') = 1 and (my_department_scopes() -> 'departments' -> 0 -> 'divisions') = '["SALES","SUPPORT"]'::jsonb), 'M Pillar: both functions, one department');
select test.login('ac_dg');
select test.check((select jsonb_array_length(my_department_scopes() -> 'departments') = 1 and (my_department_scopes() -> 'departments' -> 0 -> 'divisions') = '["SALES","SUPPORT"]'::jsonb), 'Digitree: both functions, one department');

\echo '   removing access'
select test.login('sa');
select department_access_apply(test.id('ac_s'), jsonb_build_array(test.pair('wabastore', 'SALES')));
select test.login('ac_s');
select test.hdr(test.dep('wabastar'));
select test.check((select count(*) = 1 and bool_and(name = 'AC Whatsbox Sales') from customers where name like 'AC %'), 'Wabastar was unticked: its data is no longer reachable');
select test.check((select array_agg(x ->> 'slug' order by x ->> 'slug') = array['wabastore', 'whatsbox'] from jsonb_array_elements(my_department_scopes() -> 'departments') x), 'and no longer offered');
select test.login('sa');
select test.check((select count(*) = 0 from jsonb_array_elements(department_heads_overview(test.dep('wabastar'))) x where x ->> 'profileId' = test.id('ac_s')::text), 'nor listed in Wabastar');
select department_access_apply(test.id('ac_s'), '[]'::jsonb);
reset role;
select test.check((select count(*) = 0 from department_access where profile_id = test.id('ac_s')) and (select count(*) = 1 from profiles where id = test.id('ac_s') and department_id = test.dep('whatsbox') and head_division = 'SALES'), 'an empty matrix keeps the head''s own placement (Whatsbox, Sales)');
select test.check((select count(*) = 1 from profiles where email = 'ac.s@amuwa.com'), 'no account was created or removed');
set role authenticated;
select test.login('ac_s');
select test.must_fail($$select department_access_apply(test.id('ac_s'), jsonb_build_array(test.pair('wabastar', 'SALES')))$$, 'a head cannot save their own matrix', 'FORBIDDEN');
select test.login('ds_p');
select test.must_fail($$select department_access_apply(test.id('ac_s'), '[]'::jsonb)$$, 'nor a team member', 'FORBIDDEN');
\echo '   done'
