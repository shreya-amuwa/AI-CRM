-- =============================================================================
-- Operations Head (migration 20261204000100). Runs after the department scope suites (same database): ga_s and ga_p are the shared heads
-- those suites made Operations Heads; gb_h is a combined head of one department (Sales and Support of M Pillar).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 70. Operations Head'
reset role;
\i supabase/migrations/20261204000100_operations_head.sql

select test.create_auth_user('oh_dh', 'oh.dh@amuwa.com', '{"full_name":"Plain Department Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('edutraining')));
select test.create_auth_user('oh_tl', 'oh.tl@amuwa.com', '{"full_name":"Digitree Team Lead"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('digitree', 'Sales')));

\echo '   who is an Operations Head'
select test.check((select is_operations_head from profiles where id = test.id('ga_s')) and (select is_operations_head from profiles where id = test.id('ga_p')), 'the shared heads were made Operations Heads by the Super Admin');
select test.check(not (select is_operations_head from profiles where id = test.id('oh_dh')), 'a new Department Head is not an Operations Head');
select test.check((select count(*) > 0 from audit_logs where action = 'OPERATIONS_HEAD_SET' and entity_id = test.id('ga_s')), 'making an Operations Head is audited');
select test.check((select count(*) > 0 from notifications where recipient_id = test.id('ga_s') and type = 'ROLE_CHANGED'), 'and the person is told');

\echo '   only the Super Admin changes it'
set role authenticated;
select test.login('ga_s');
select test.must_fail($$select set_operations_head(test.id('oh_dh'), true)$$, 'an Operations Head cannot make another one', 'FORBIDDEN');
select test.must_fail($$select set_operations_head(test.id('ga_s'), false)$$, 'nor remove their own role', 'FORBIDDEN');
select test.must_fail($$select department_access_set(test.id('ga_s'), test.dept('mpillar'), 'SALES', true)$$, 'nor give themselves a department', 'FORBIDDEN');
select test.must_fail($$select operations_head_review()$$, 'nor read the Super Admin review', 'FORBIDDEN');
select test.must_fail($$update profiles set is_operations_head = false where id = test.id('ga_s')$$, 'nor switch the flag with a plain update', 'FORBIDDEN|permission|0 rows|violates');
select test.login('oh_dh');
select test.must_fail($$select set_operations_head(test.id('oh_dh'), true)$$, 'a Department Head cannot make themselves one', 'FORBIDDEN');
select test.must_fail($$select operations_overview()$$, 'and has no Operations overview', 'FORBIDDEN');
select test.login('oh_tl');
select test.must_fail($$select set_operations_head(test.id('oh_dh'), true)$$, 'a Team Lead cannot either', 'FORBIDDEN');
reset role;
select test.check((select is_operations_head from profiles where id = test.id('ga_s')) and not (select is_operations_head from profiles where id = test.id('oh_dh')), 'nothing changed');

\echo '   a Department Head works in one department - enforced by the database'
set role authenticated;
select test.login('sa');
select test.must_fail($$select department_access_set(test.id('oh_dh'), test.dept('mpillar'), 'SALES', true)$$, 'the Super Admin cannot give a plain Department Head another department', 'Operations Head');
select test.must_fail($$select department_access_apply(test.id('oh_dh'), jsonb_build_array(test.pair('mpillar', 'SALES')))$$, 'nor through the matrix', 'Operations Head');
select test.must_fail($$select set_operations_head(test.id('oh_tl'), true)$$, 'only a Department Head can become an Operations Head', 'Department Head');
reset role;
select test.must_fail($$insert into department_access (profile_id, department_id, division) values (test.id('oh_dh'), test.dept('mpillar'), 'SALES')$$, 'and not through SQL either', 'Operations Head');
select test.check((select count(*) = 0 from department_access where profile_id = test.id('oh_dh')), 'no grant was stored');
-- the other FUNCTION of a head's own department is not "several departments": the combined head of M Pillar keeps both
reset role;
select test.check((select count(*) = 2 from department_access where profile_id = test.id('gb_h') and not transition), 'a combined head (Sales and Support of one department) keeps both functions, not marked for review');

\echo '   existing multi-department grants are kept and flagged, not removed'
reset role;
-- what an older installation really holds: a grant made before the rule existed (the trigger is off while it is made), then this migration runs
alter table department_access disable trigger department_access_operations_head;
insert into department_access (profile_id, department_id, division) values (test.id('oh_dh'), test.dept('mpillar'), 'SALES');
alter table department_access enable trigger department_access_operations_head;
\i supabase/migrations/20261204000100_operations_head.sql
select test.check((select transition from department_access where profile_id = test.id('oh_dh') and department_id = test.dept('mpillar')), 'the migration marks it for review instead of removing it');
select test.check((select count(*) = 1 from audit_logs where action = 'MULTI_DEPARTMENT_SCOPE_GRANDFATHERED' and entity_id = test.id('oh_dh')), 'and records that the access was kept');
\i supabase/migrations/20261204000100_operations_head.sql
select test.check((select count(*) = 1 from audit_logs where action = 'MULTI_DEPARTMENT_SCOPE_GRANDFATHERED' and entity_id = test.id('oh_dh')), 'running it again records nothing twice');
set role authenticated;
select test.login('oh_dh');
select test.check((select count(*) >= 2 from private.my_scopes()), 'the grandfathered department still counts as one of the head''s scopes');
select test.check((select count(*) = 1 from private.my_scopes() where department_id = test.dept('mpillar')), '... M Pillar, as before');
select test.login('sa');
select test.check((select (x ->> 'needsDecision')::boolean from jsonb_array_elements(operations_head_review()) x where (x ->> 'profileId')::uuid = test.id('oh_dh')), 'the Super Admin review lists the head as needing a decision');
select test.check((select jsonb_array_length(x -> 'extraDepartments') = 1 from jsonb_array_elements(operations_head_review()) x where (x ->> 'profileId')::uuid = test.id('oh_dh')), '... with the department they keep');
select test.check(not exists (select 1 from jsonb_array_elements(operations_head_review()) x where (x ->> 'profileId')::uuid = test.id('oh_tl')), 'a head with one department is not listed');

\echo '   making the head an Operations Head, and taking it back'
select set_operations_head(test.id('oh_dh'), true, 'Oversees Digitree and M Pillar');
reset role;
select test.check((select is_operations_head from profiles where id = test.id('oh_dh')), 'now an Operations Head');
select test.check((select not transition from department_access where profile_id = test.id('oh_dh')), 'the extra department is authorised, not just tolerated');
select test.check((select metadata ->> 'note' = 'Oversees Digitree and M Pillar' from audit_logs where action = 'OPERATIONS_HEAD_SET' and entity_id = test.id('oh_dh') order by created_at desc limit 1), 'the reason is in the audit');
set role authenticated;
select test.login('oh_dh');
select test.check((select jsonb_array_length(operations_overview()) >= 2 from (select 1) x), 'the Operations overview lists the departments of the head');
select test.check((select count(*) = 0 from jsonb_array_elements(operations_overview()) x where (x ->> 'name') = 'Accounts Department'), 'and no department the head is not assigned to');
select test.login('sa');
select set_operations_head(test.id('oh_dh'), false);
reset role;
select test.check(not (select is_operations_head from profiles where id = test.id('oh_dh')) and (select count(*) = 0 from department_access where profile_id = test.id('oh_dh')), 'removing the role removes the extra departments and keeps the home department');
select test.check((select count(*) > 0 from audit_logs where action = 'OPERATIONS_HEAD_REMOVED' and entity_id = test.id('oh_dh')), 'and is audited');
set role authenticated;
select test.login('oh_dh');
select test.check((select count(*) = 1 from private.my_scopes()), 'the head is back to one department');

\echo '=== ALL OPERATIONS HEAD TESTS PASSED ==='
