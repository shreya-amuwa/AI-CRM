-- =============================================================================
-- Crocodial (migration 20270204000100): what each server sees of the token, and the scoped "Refresh" of every Sales role.
-- Who may refresh whom is who may see whom: the person (only with an approved mapping), their own Team Lead (not another Team Lead, not
-- merely the same department), a Department Head / Operations Head whose SALES scope covers the department (not a Support-only scope, not
-- an unassigned department; a removed scope stops it at once), the Super Admin. Forged scopes, suspended accounts, revoked mappings and a
-- switched-off rollout are refused. Ten clicks on one connection queue one read. Every request is audited.
-- Runs after crocodial_leads_test.sql (reuses cr_s1, cr_s2, cr_s3, cr_tl1, cr_tl2, cr_sup, gb_h, sa).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 145. Crocodial: connection health per server, and the scoped refresh'
reset role;
\i supabase/migrations/20270204000100_crocodial_scoped_refresh.sql
\i supabase/migrations/20270204000100_crocodial_scoped_refresh.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_REFTEST%';
delete from crocodial_refresh_requests;
create temp table rf (k text primary key, id uuid);
grant all on rf to authenticated;
create temp table rf_t0 as select clock_timestamp() as t;
grant all on rf_t0 to authenticated;

-- Operations Heads: one supervising M Pillar Sales, one supervising only M Pillar SUPPORT, one supervising only D Talk
do $$
begin
  if not exists (select 1 from test.users where name = 'crr_op') then
    perform test.create_auth_user('crr_op', 'crr.op@example.com', '{"full_name":"CRR Ops Sales"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('dtalk'), 'provisioned_operations_head', true));
    perform test.create_auth_user('crr_opsup', 'crr.opsup@example.com', '{"full_name":"CRR Ops Support"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('dtalk'), 'provisioned_operations_head', true));
    perform test.create_auth_user('crr_opdt', 'crr.opdt@example.com', '{"full_name":"CRR Ops DTalk"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('dtalk'), 'provisioned_operations_head', true));
  end if;
end $$;
update profiles set status = 'ACTIVE' where id in (test.id('crr_op'), test.id('crr_opsup'), test.id('crr_opdt'));
delete from operations_head_departments where profile_id in (test.id('crr_op'), test.id('crr_opsup'), test.id('crr_opdt'));
insert into operations_head_departments (profile_id, department_id, division) values
  (test.id('crr_op'), test.dept('mpillar'), 'SALES'),
  (test.id('crr_opsup'), test.dept('mpillar'), 'SUPPORT'),
  (test.id('crr_opdt'), test.dept('dtalk'), null);

insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('Refresh', 'CROCODIAL_TOKEN_REFTEST', true, 'Asia/Kolkata'),
  ('Refresh other', 'CROCODIAL_TOKEN_REFTEST_B', true, 'Asia/Kolkata');
insert into rf select 'c1', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_REFTEST';
insert into rf select 'c2', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_REFTEST_B';
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from rf;
-- Sachin (led by cr_tl1) and Supriya (led by cr_tl2) on the same account; cr_s3 (led by cr_tl1) is NOT mapped; the second account has
-- a user with the SAME numeric id 4138 that belongs to nobody
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from rf where k = 'c1'), 4138, 'sachin', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days'),
       ((select id from rf where k = 'c1'), 371, 'Supriya', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days');
insert into rf select 'm1', id from crocodial_employee_mappings where connection_id = (select id from rf where k = 'c1') and external_employee_id = 4138;

set role authenticated;
\echo '   who has which button'
select test.login('cr_s1');
select test.check((select x ->> 'kind' = 'EMPLOYEE' and x -> 'self' ->> 'state' = 'CONNECTED' and x -> 'team' = 'null'::jsonb and x -> 'departments' = '[]'::jsonb
                     from (select croc_refresh_capabilities() as x) s), 'a connected employee: Refresh My Data only');
select test.login('cr_s3');
select test.check((select x -> 'self' ->> 'state' = 'NOT_MAPPED' and (x ->> 'rollout')::boolean from (select croc_refresh_capabilities() as x) s),
  'an employee without a mapping, in a rolled-out department: not connected (and told so)');
select test.must_fail($$select croc_refresh_request('SELF')$$, 'and cannot refresh', 'not connected to Amuwa CRM');
select test.login('cr_tl1');
select test.check((select x ->> 'kind' = 'TEAM_LEAD' and (x -> 'team' ->> 'people')::int = 1 from (select croc_refresh_capabilities() as x) s),
  'a Team Lead: their own connected member only (Sachin; Supriya is another Team Lead''s)');
select test.login('gb_h');
select test.check((select x ->> 'kind' = 'DEPARTMENT_HEAD' and (x -> 'all' ->> 'people')::int = 2 and jsonb_array_length(x -> 'departments') = 1
                     from (select croc_refresh_capabilities() as x) s), 'the Department Head: their department''s connected Sales people');
select test.login('crr_op');
select test.check((select x ->> 'kind' = 'OPERATIONS_HEAD' and (x -> 'departments' -> 0 ->> 'people')::int = 2 from (select croc_refresh_capabilities() as x) s),
  'an Operations Head supervising M Pillar Sales: its connected people');
select test.login('crr_opsup');
select test.check((select (x -> 'all' ->> 'people')::int = 0 and x -> 'departments' = '[]'::jsonb from (select croc_refresh_capabilities() as x) s),
  'an Operations Head with a Support-only scope: nobody (Crocodial is Sales)');
select test.login('crr_opdt');
select test.check((select (croc_refresh_capabilities() -> 'all' ->> 'people')::int = 0), 'an Operations Head of another department: nobody');
select test.login('cr_sup');
select test.check(not (select (croc_refresh_capabilities() ->> 'rollout')::boolean), 'a Support member: Crocodial is not shown at all');
select test.check(not (select croc_refresh_capabilities()::text like '%4138%' or croc_refresh_capabilities()::text like '%sachin%'),
  'no Crocodial user id or name is returned');

\echo '   Team Member'
select test.login('cr_s1');
create temp table r1 as select croc_refresh_request('SELF') as x;
grant all on r1 to authenticated;
select test.check((select x ->> 'outcome' = 'QUEUED' and (x ->> 'people')::int = 1 and (x ->> 'connections')::int = 1
                     and jsonb_array_length(x -> 'kick') = 1 and x ->> 'state' = 'REFRESH_QUEUED' and not (x ->> 'finished')::boolean from r1),
  'an employee refreshes their own data: one read of their connection is queued');
select test.check((select croc_refresh_request('SELF') ->> 'id' = (select x ->> 'id' from r1) and (croc_refresh_request('SELF') ->> 'repeated')::boolean),
  'clicking again returns the same request (never queued twice)');
select test.must_fail($$select croc_refresh_request('TEAM')$$, 'an employee cannot ask for a team', 'NOT_FOUND');
select test.must_fail($$select croc_refresh_request('DEPARTMENT', test.dept('mpillar'))$$, 'nor for a department (a forged scope)', 'NOT_FOUND');
select test.must_fail($$select croc_refresh_request('ALL')$$, 'nor for everyone', 'NOT_FOUND');
select test.must_fail($$select croc_refresh_request('EVERYONE')$$, 'an unknown scope is refused', 'VALIDATION_ERROR');
select test.check((select croc_refresh_status((select (x ->> 'id')::uuid from r1)) ->> 'state') = 'REFRESH_QUEUED', 'the requester reads its state');
select test.login('cr_s2');
select test.must_fail($$select croc_refresh_status((select (x ->> 'id')::uuid from r1))$$, 'a colleague cannot read someone else''s request', 'NOT_FOUND');
create temp table r2 as select croc_refresh_request('SELF') as x;
grant all on r2 to authenticated;
select test.check((select x ->> 'outcome' = 'JOINED' and jsonb_array_length(x -> 'kick') = 0 from r2),
  'a second person on the same account within a minute joins the queued read (no second account-level read)');

\echo '   ten people, one connection: one read'
reset role;
update crocodial_connections set refresh_requested_at = null where id = (select id from rf where k = 'c1');
set role authenticated;
select test.login('sa');
create temp table r10 as select croc_refresh_request('ALL') as x from generate_series(1, 10);
grant all on r10 to authenticated;
select test.check((select count(*) filter (where jsonb_array_length(x -> 'kick') > 0) = 1 and count(distinct x ->> 'id') = 1 from r10),
  'ten clicks: one request, one read started');

\echo '   when the read finishes'
reset role;
insert into crocodial_sync_state (connection_id, resource, checkpoint, last_full_at, last_ok_at, last_run_at)
select (select id from rf where k = 'c1'), r, now(), now(), now() + interval '1 second', now() + interval '1 second' from unnest(array['leads', 'call-logs', 'followups', 'remarks']) r
on conflict (connection_id, resource) do update set last_ok_at = excluded.last_ok_at, last_run_at = excluded.last_run_at, next_page = null, running_since = null, last_error = null;
set role authenticated;
select test.login('cr_s1');
select test.check((select x ->> 'state' = 'UP_TO_DATE' and (x ->> 'finished')::boolean and x ->> 'lastSyncAt' is not null
                     from (select croc_refresh_status((select (x ->> 'id')::uuid from r1)) as x) s), 'the request then reads as up to date, with the time');
reset role;
update crocodial_connections set refresh_requested_at = now() - interval '5 minutes', last_manual_sync_at = null where id = (select id from rf where k = 'c1');
update crocodial_refresh_requests set requested_at = now() - interval '5 minutes' where requested_by = test.id('cr_s1');
set role authenticated;
select test.check((select x ->> 'outcome' = 'UP_TO_DATE' and (x ->> 'finished')::boolean and jsonb_array_length(x -> 'kick') = 0
                     from (select croc_refresh_request('SELF') as x) s), 'a read completed in the last 2 minutes is not repeated');
reset role;
update crocodial_connections set health = 'NO_CREDENTIAL', last_attempt_at = now() + interval '2 seconds' where id = (select id from rf where k = 'c1');
set role authenticated;
select test.login('cr_s2');
select test.check((select croc_refresh_status((select (x ->> 'id')::uuid from r2)) ->> 'state') = 'TOKEN_MISSING', 'a missing token after the request is shown as such');
reset role;
update crocodial_connections set health = 'AUTH_FAILED' where id = (select id from rf where k = 'c1');
set role authenticated;
select test.check((select croc_refresh_status((select (x ->> 'id')::uuid from r2)) ->> 'state') = 'TOKEN_INVALID', 'Crocodial refusing the token is shown as such');
reset role;
update crocodial_connections set health = 'OK' where id = (select id from rf where k = 'c1');
update crocodial_refresh_requests set requested_at = now() - interval '5 minutes';
update crocodial_connections set refresh_requested_at = null where id = (select id from rf where k = 'c1');
update crocodial_sync_state set last_ok_at = now() - interval '1 hour' where connection_id = (select id from rf where k = 'c1');

\echo '   Team Lead'
set role authenticated;
select test.login('cr_tl1');
select test.check((select x ->> 'outcome' = 'QUEUED' and (x ->> 'people')::int = 1 from (select croc_refresh_request('TEAM') as x) s),
  'a Team Lead refreshes their own connected member');
select test.must_fail($$select croc_refresh_request('SELF')$$, 'without a mapping of their own, not their own data', 'not connected');
select test.must_fail($$select croc_refresh_request('DEPARTMENT', test.dept('mpillar'))$$, 'not the department (same department is not enough)', 'NOT_FOUND');
select test.must_fail($$select croc_refresh_request('ALL')$$, 'not everyone', 'NOT_FOUND');
select test.login('cr_tl2');
select test.check((select (croc_refresh_request('TEAM') ->> 'people')::int = 1), 'Team Lead B: only Supriya, never Team Lead A''s member');

\echo '   Department Head and Operations Heads'
select test.login('gb_h');
select test.check((select (croc_refresh_request('DEPARTMENT', test.dept('mpillar')) ->> 'people')::int = 2), 'the Department Head refreshes their department''s connected Sales people');
select test.must_fail($$select croc_refresh_request('DEPARTMENT', test.dept('dtalk'))$$, 'not another department', 'NOT_FOUND');
select test.must_fail($$select croc_refresh_request('DEPARTMENT')$$, 'a department must be named', 'VALIDATION_ERROR');
select test.login('crr_op');
select test.check((select (croc_refresh_request('ALL') ->> 'people')::int = 2), 'an Operations Head refreshes their assigned Sales departments');
select test.login('crr_opsup');
select test.must_fail($$select croc_refresh_request('DEPARTMENT', test.dept('mpillar'))$$, 'a Support-only scope cannot refresh Sales Crocodial data', 'NOT_FOUND');
select test.login('crr_opdt');
select test.must_fail($$select croc_refresh_request('ALL')$$, 'an Operations Head of another department cannot', 'NOT_FOUND');
reset role;
delete from operations_head_departments where profile_id = test.id('crr_op') and department_id = test.dept('mpillar');
set role authenticated;
select test.login('crr_op');
select test.must_fail($$select croc_refresh_request('ALL')$$, 'removing the department scope removes the refresh at once', 'NOT_FOUND');

\echo '   suspended, revoked, switched off'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('cr_s2');
set role authenticated;
select test.login('cr_s2');
select test.must_fail($$select croc_refresh_request('SELF')$$, 'a suspended account cannot refresh', 'not active');
select test.check((select x ->> 'active' = 'false' from (select croc_refresh_capabilities() as x) s), 'and has no buttons');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('cr_s2');
update crocodial_employee_mappings set status = 'REVOKED', ended_at = now() where id = (select id from rf where k = 'm1');
set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_refresh_request('SELF')$$, 'a revoked mapping stops the refresh', 'not connected');
reset role;
update crocodial_employee_mappings set status = 'APPROVED', ended_at = null where id = (select id from rf where k = 'm1');
update crocodial_rollout set allowed = false where department_id = test.dept('mpillar') and division = 'SALES';
set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_refresh_request('SELF')$$, 'a switched-off rollout stops it', 'not connected');
reset role;
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';

\echo '   audit, and no direct access'
select test.check((select count(*) > 0 from audit_logs where action = 'CROCODIAL_REFRESH_REQUESTED' and created_at >= (select t from rf_t0)),
  'every request is audited');
set role authenticated;
select test.login('sa');
select test.must_fail($$select count(*) from crocodial_refresh_requests$$, 'the requests table has no direct access', 'permission denied');
select test.must_fail($$select count(*) from crocodial_runtime_reports$$, 'nor the servers'' reports', 'permission denied');
select test.must_fail($$select croc_runtime_report((select id from rf where k = 'c1'), '{"runtime":"x","platform":"node"}', true, true, 'PAGE')$$,
  'only the server records what it sees', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select croc_refresh_request('SELF')$$, 'anonymous callers cannot refresh', 'permission denied');
reset role;

\echo '   what each server sees'
select test.check((select (croc_runtime_report((select id from rf where k = 'c1'), '{"runtime":"vercel:production","platform":"vercel","environment":"production"}', false, false, 'SYNC')
                   ->> 'otherHasCredential')::boolean = false), 'a server without the token, alone: nobody else has it');
select test.check((select (croc_runtime_report((select id from rf where k = 'c1'), '{"runtime":"cloudflare:production","platform":"cloudflare","deployment":"v1"}', true, true, 'PAGE')
                   ->> 'otherHasCredential')::boolean = false), 'the Cloudflare server has it');
select test.check((select (croc_runtime_report((select id from rf where k = 'c1'), '{"runtime":"vercel:production","platform":"vercel"}', false, false, 'SYNC')
                   ->> 'otherHasCredential')::boolean), 'now the server without it learns another server has it (and leaves the health alone)');
select test.must_fail($$select croc_runtime_report((select id from rf where k = 'c1'), '{"runtime":"Bad Name!","platform":"node"}', true, true, 'PAGE')$$,
  'a malformed runtime name is refused', 'VALIDATION_ERROR');
set role authenticated;
select test.login('sa');
select test.check((select jsonb_array_length(h -> 'runtimes') = 2 and (h ->> 'connectedPeople')::int = 2
                     from jsonb_array_elements(croc_connection_health()) h where h -> 'connection' ->> 'id' = (select id::text from rf where k = 'c1')),
  'the Super Admin sees each server''s report and the connected people');
select test.check(not (select croc_connection_health()::text ~* 'token_value|authorization'), 'no token value or header in the health report');
select test.login('gb_h');
select test.must_fail($$select croc_connection_health()$$, 'only the Super Admin sees connection health', 'FORBIDDEN');
reset role;

\echo '   the scheduled run picks up a refresh not started at once'
update crocodial_connections set refresh_requested_at = now() + interval '1 minute' where id = (select id from rf where k = 'c1');
select test.check((select croc_sync_due() @> jsonb_build_array(jsonb_build_object('id', (select id from rf where k = 'c1')))), 'a pending refresh is due');
update crocodial_connections set refresh_requested_at = now() - interval '1 day' where id = (select id from rf where k = 'c1');
select test.check(not (select croc_sync_due() @> jsonb_build_array(jsonb_build_object('id', (select id from rf where k = 'c1')))), 'an answered one is not');

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_REFTEST%';
delete from operations_head_departments where profile_id in (test.id('crr_op'), test.id('crr_opsup'), test.id('crr_opdt'));
\echo '=== CROCODIAL REFRESH TESTS PASSED ==='
