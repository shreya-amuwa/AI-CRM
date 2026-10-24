-- =============================================================================
-- Sales and Support Department Heads (migration 20261120000100): a department can have one Department Head per side. Wabastore
-- already has the unlabelled head 'dh_wab' of the authorization suite; HR has none.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- department head division'
reset role;
select test.create_auth_user('dh_sales', 'dh.sales@amuwa.com', '{"full_name":"Sales Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore'), 'provisioned_head_division', 'SALES'));
select test.check((select head_division = 'SALES' and role = 'DEPARTMENT_HEAD' and default_dashboard = 'sales-department-head' from profiles where id = test.id('dh_sales')),
  'a Sales Department Head is created next to the existing head and opens the Sales Department Head dashboard');
select test.must_fail($$select test.create_auth_user('dh_sales2', 'dh.sales2@amuwa.com', '{"full_name":"Second Sales Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore'), 'provisioned_head_division', 'SALES'))$$,
  'a second Sales head of the same department is refused', 'already has a Department Head for Sales');
select test.must_fail($$select test.create_auth_user('dh_none2', 'dh.none2@amuwa.com', '{"full_name":"Second Unspecified"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore')))$$,
  'a second unspecified head is still refused', 'already has a Department Head');
select test.create_auth_user('dh_sales_hr', 'dh.sales.hr@amuwa.com', '{"full_name":"HR Sales Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('hr'), 'provisioned_head_division', 'SALES'));
select test.check((select count(*) = 1 from profiles where department_id = test.dept('hr') and head_division = 'SALES'), 'another department can have its own Sales head');
select test.must_fail($$select test.create_auth_user('dh_bad', 'dh.bad@amuwa.com', '{"full_name":"Bad Side"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('whatsbox'), 'provisioned_head_division', 'GENERAL'))$$,
  'only Sales or Support exist', 'profiles_head_division_check');
-- a side given to somebody who is not a Department Head is dropped
select test.create_auth_user('dh_tm', 'dh.tm@amuwa.com', '{"full_name":"Member With Side"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales'), 'provisioned_head_division', 'SALES'));
select test.check((select head_division is null from profiles where id = test.id('dh_tm')), 'a Team Member never carries a head side');

set role authenticated;
select test.login('sa');
select test.check(assert_can_create_user('DEPARTMENT_HEAD', test.dept('wabastore'), null, 'SUPPORT'), 'the pre-check allows a Support head next to the Sales head');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dept('wabastore'), null, 'SALES')$$, 'the pre-check refuses a second Sales head and names the first', 'Sales Head');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dept('wabastore'), null)$$, 'the old call (no side) behaves as before', 'DH Wabastore');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', test.dept('wabastore'), test.team('wabastore', 'Sales'), 'SALES')$$, 'a side only goes with a Department Head', 'Only a Department Head');

\echo '   labelling an existing head'
select test.must_fail($$select set_head_division(test.id('dh_wab'), 'SALES')$$, 'the existing head cannot be labelled with a side already taken', 'already has a Department Head for Sales');
select test.check((set_head_division(test.id('dh_wab'), 'SUPPORT') ->> 'headDivision') = 'SUPPORT', 'the Super Admin labels the earlier head Support');
select test.must_fail($$select set_head_division(test.id('dh_sales'), 'SUPPORT')$$, 'and cannot then move the Sales head onto Support', 'already has a Department Head for Support');
select test.must_fail($$select set_head_division(test.id('th_wab'), 'SALES')$$, 'only a Department Head has a side', 'Only a Department Head');
select test.must_fail($$select set_head_division(test.id('dh_wab'), 'GENERAL')$$, 'only Sales or Support', 'Choose Sales or Support');
select test.check(assert_can_create_user('DEPARTMENT_HEAD', test.dept('wabastore'), null), 'with both heads labelled, an unspecified head is a separate (still single) slot');
select test.login('dh_wab');
select test.must_fail($$select set_head_division(test.id('dh_wab'), null)$$, 'a Department Head cannot change a side', 'FORBIDDEN');
select test.login('sa');
select test.check((set_head_division(test.id('dh_wab'), null) ->> 'headDivision') is null, 'a side can be cleared');
select set_head_division(test.id('dh_wab'), 'SUPPORT');

\echo '   both heads keep department-wide access'
select test.login('dh_sales');
select test.check((select count(*) > 0 from teams where department_id = test.dept('wabastore')), 'the Sales head reads the department''s teams');
select test.check((select count(*) = 0 from profiles where id = test.id('dh_wab')), 'but not the Support head of the department (Sales and Support are separate)');
select test.login('dh_wab');
select test.check((select count(*) > 0 from profiles where id = test.id('dh_sales')), 'the Support head sees the Sales head');

\echo '   a demoted head loses the side'
select test.login('sa');
select test.check((select role = 'TEAM_HEAD' from assign_user(test.id('dh_sales'), 'TEAM_HEAD', null, test.team('wabastore', 'Sales'))), 'the Sales head is demoted to Team Lead');
reset role;
select test.check((select head_division is null from profiles where id = test.id('dh_sales')), 'the side is cleared when the person is no longer a Department Head');
