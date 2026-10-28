-- =============================================================================
-- The Super Admin account is protected (migration 20261206000100): nobody - Department Head, Team Lead, Team Member, another Super Admin
-- or the Super Admin themselves - can suspend, revoke, delete or demote it from the application; legitimate management of people below
-- keeps working. Runs after the other suites on the same database (users from rls_test.sql).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
reset role;
\echo '--- Super Admin protection'
-- the real-world shape from the screenshot: the Super Admin sits inside a team, so a Team Lead's member list can reach the row
update profiles set team_id = (select team_id from profiles where id = test.id('th_wab')), department_id = (select department_id from profiles where id = test.id('th_wab')) where id = test.id('sa');

do $$
declare who text; sa uuid := test.id('sa'); n int := 0;
begin
  foreach who in array array['dh_wab', 'th_wab', 'tm_a', 'sa'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', test.id(who), 'role', 'authenticated')::text, false);
    set local role authenticated;
    begin perform set_user_status(sa, 'REVOKED', 'x'); raise exception 'TEST FAILED: % could revoke the Super Admin', who; exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
    begin perform set_user_status(sa, 'SUSPENDED', 'x'); raise exception 'TEST FAILED: % could suspend the Super Admin', who; exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
    begin perform assign_user(sa, 'TEAM_MEMBER', (select department_id from profiles where id = test.id('th_wab')), (select team_id from profiles where id = test.id('th_wab'))); raise exception 'TEST FAILED: % could demote the Super Admin', who; exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
    begin perform delete_user(sa); raise exception 'TEST FAILED: % could delete the Super Admin', who; exception when others then if sqlerrm like 'TEST FAILED%' then raise; end if; end;
    reset role;
    n := n + 1;
  end loop;
  raise notice 'ok - Department Head, Team Lead, Team Member and the Super Admin themselves cannot suspend, revoke, demote or delete the Super Admin (% actors)', n;
end $$;
reset role;
select test.check((select status = 'ACTIVE' and role = 'SUPER_ADMIN' from profiles where id = test.id('sa')), 'the Super Admin is untouched');

-- the table itself refuses, even for a statement that gets past the functions (a signed-in person, owner-level path)
select set_config('request.jwt.claims', json_build_object('sub', test.id('th_wab'), 'role', 'authenticated')::text, false);
select test.must_fail($$update profiles set status = 'REVOKED' where id = test.id('sa')$$, 'a signed-in statement cannot revoke the Super Admin row', 'cannot be suspended, revoked or demoted');
select test.must_fail($$update profiles set role = 'TEAM_MEMBER' where id = test.id('sa')$$, 'a signed-in statement cannot demote the Super Admin row', 'cannot be suspended, revoked or demoted');
select test.must_fail($$delete from profiles where id = test.id('sa')$$, 'a signed-in statement cannot delete the Super Admin row', 'cannot be deleted');
select test.must_fail($$update profiles set role = 'SUPER_ADMIN' where id = test.id('tm_a')$$, 'a signed-in statement cannot make somebody Super Admin', 'Nobody can be made Super Admin');
select test.login('sa');
select test.must_fail($$update profiles set status = 'SUSPENDED' where id = test.id('sa')$$, 'not even the Super Admin on their own row', 'cannot be suspended, revoked or demoted');
select set_config('request.jwt.claims', '', false);
-- database-owner maintenance (no signed-in person) is not blocked: break-glass recovery stays possible
update profiles set status = 'SUSPENDED' where id = test.id('sa');
update profiles set status = 'ACTIVE' where id = test.id('sa');
select test.check((select status = 'ACTIVE' from profiles where id = test.id('sa')), 'maintenance by the database owner still works (no signed-in person)');

-- a Super Admin still manages everybody below (a member of the Team Lead's own team, whatever state the other suites left the fixtures in)
select id as victim from profiles where role = 'TEAM_MEMBER' and status = 'ACTIVE' and team_id = (select team_id from profiles where id = test.id('th_wab')) order by created_at limit 1 \gset
select id as victim_dh from profiles m where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and m.department_id = (select department_id from profiles where id = test.id('dh_wab'))
   and (select h.head_division is null or h.head_division = (select division::text from teams where id = m.team_id) from profiles h where h.id = test.id('dh_wab')) order by m.created_at limit 1 \gset
select test.login('sa');
set role authenticated;
select test.check((select status = 'SUSPENDED' from set_user_status(:'victim'::uuid, 'SUSPENDED', 'test')), 'the Super Admin suspends a Team Member');
select test.check((select status = 'ACTIVE' from set_user_status(:'victim'::uuid, 'ACTIVE')), 'and restores them');
select test.login('dh_wab');
select test.check((select status = 'SUSPENDED' from set_user_status(:'victim_dh'::uuid, 'SUSPENDED', 'test')), 'a Department Head still suspends a Team Member of the department');
select test.check((select status = 'ACTIVE' from set_user_status(:'victim_dh'::uuid, 'ACTIVE')), 'and restores them');
select test.login('th_wab');
select test.check((select status = 'SUSPENDED' from set_user_status(:'victim'::uuid, 'SUSPENDED', 'test')), 'a Team Lead still suspends a Team Member of their team');
select test.check((select status = 'ACTIVE' from set_user_status(:'victim'::uuid, 'ACTIVE')), 'and restores them');
reset role;
update profiles set team_id = null, department_id = null where id = test.id('sa');
\echo '=== ALL SUPER ADMIN PROTECTION TESTS PASSED ==='
