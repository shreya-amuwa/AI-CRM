-- =============================================================================
-- Staff "Forgot password?" lookup (migration 20261231000600): only the API's service role may look an address up, only an ACTIVE employee
-- is found (any letter case), nothing for unknown addresses. Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 140. Staff forgot password: who gets a reset link'
reset role;
\i supabase/migrations/20261231000600_staff_password_reset.sql
\i supabase/migrations/20261231000600_staff_password_reset.sql
create temp table spr as select id, email, status from profiles where status = 'ACTIVE' and role <> 'SUPER_ADMIN' and email is not null order by created_at limit 1;
grant select on spr to authenticated, anon, service_role;
set role authenticated;
select test.login('sa');
select test.must_fail($$select staff_login_for_reset('x@example.com')$$, 'a signed-in user (even the Super Admin) cannot look addresses up', 'permission denied');
set role anon;
select test.must_fail($$select staff_login_for_reset('x@example.com')$$, 'nor can a visitor', 'permission denied');
reset role;
set role service_role;
select test.check((select (staff_login_for_reset(upper((select email from spr))) ->> 'id')::uuid = (select id from spr)), 'the API finds an active employee, whatever the letter case');
select test.check(staff_login_for_reset('nobody.at.all@example.com') is null, 'nothing for an unknown address');
reset role;
update profiles set status = 'SUSPENDED' where id = (select id from spr);
set role service_role;
select test.check(staff_login_for_reset((select email from spr)) is null, 'a suspended account gets no reset link');
reset role;
update profiles set status = 'ACTIVE' where id = (select id from spr);
