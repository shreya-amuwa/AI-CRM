-- =============================================================================
-- Crocodial integration, part 2 (migration 20270115000200): the sync lease, checkpoints, resumable and full pulls, idempotent storing,
-- reconciliation, account isolation, attribution through the mapping in effect, unmatched records, "Sync now".
-- Runs after crocodial_test.sql (reuses its people cr_s1, cr_s2, cr_s3 and sa).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 139. Crocodial: read-only sync'
reset role;
\i supabase/migrations/20270115000200_crocodial_sync.sql
\i supabase/migrations/20270115000200_crocodial_sync.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_SYNCTEST%';
create temp table cs (k text primary key, id uuid, t timestamptz);
grant all on cs to authenticated;
insert into crocodial_connections (name, credential_ref) values ('Sync test', 'CROCODIAL_TOKEN_SYNCTEST'), ('Sync other', 'CROCODIAL_TOKEN_SYNCTEST_B');
insert into cs select 'c1', id, null from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SYNCTEST';
insert into cs select 'c2', id, null from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SYNCTEST_B';
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from cs;
insert into crocodial_ext_employees (connection_id, external_id, name) select (select id from cs where k = 'c1'), x, 'u' || x from unnest(array[4138, 371, 4193]) x;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from cs where k = 'c1'), 4138, 'sachin', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '30 days', now() - interval '30 days'),
       ((select id from cs where k = 'c1'), 371, 'Supriya', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '30 days', now() - interval '30 days');

\echo '   nothing is synced while switched off'
select test.check((select jsonb_array_length(croc_sync_due()) = 0), 'connections that are off are not due');
select test.check((select croc_sync_begin((select id from cs where k = 'c1'), 'call-logs') ->> 'reason' = 'NOT_SYNCABLE'), 'and cannot start a sync');
update crocodial_connections set enabled = true where id in (select id from cs);
update crocodial_rollout set allowed = false where department_id = test.dept('mpillar');
select test.check((select jsonb_array_length(croc_sync_due()) = 0), 'a department that is not rolled out is never synced, even with its connection on');
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar');
select test.check((select jsonb_array_length(croc_sync_due()) = 2), 'switched on: both connections are due');

\echo '   a first (full) pull, page by page'
select test.must_fail($$select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', '[]'::jsonb, null)$$, 'storing without the lease is refused', 'lease');
insert into cs select 'b1', null, (croc_sync_begin((select id from cs where k = 'c1'), 'call-logs') ->> 'startedAt')::timestamptz;
select test.check((select s.run_full and s.next_page = 1 and s.run_since is null from crocodial_sync_state s where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs'),
  'the first pull is a full pull from page 1');
select test.check((select croc_sync_begin((select id from cs where k = 'c1'), 'call-logs') ->> 'reason' = 'RUNNING'), 'a second run cannot start while one runs');
select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', jsonb_build_array(
  jsonb_build_object('id', 1, 'calledBy', 4138, 'lead', 900, 'phone', '+919800000001', 'contactName', 'Ravi', 'callType', 'outgoing', 'callAt', (now() - interval '2 days')::text, 'durationSeconds', 120, 'connected', true),
  jsonb_build_object('id', 2, 'calledBy', 4138, 'lead', 901, 'callType', 'outgoing', 'callAt', (now() - interval '2 days')::text, 'durationSeconds', 0, 'connected', false),
  jsonb_build_object('id', 'x', 'calledBy', 4138)), 2);
select test.check((select next_page = 2 from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs'),
  'after a page the run remembers where to resume');
select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', jsonb_build_array(
  jsonb_build_object('id', 3, 'calledBy', 4193, 'lead', 902, 'callType', 'outgoing', 'callAt', (now() - interval '1 day')::text, 'durationSeconds', 60, 'connected', true),
  jsonb_build_object('id', 4, 'calledBy', 371, 'lead', null, 'callType', 'incoming', 'callAt', (now() - interval '1 day')::text, 'durationSeconds', 30, 'connected', true)), null);
select croc_sync_finish((select id from cs where k = 'c1'), 'call-logs', 'DONE', 2, 1);
select test.check((select count(*) = 4 from crocodial_ext_calls where connection_id = (select id from cs where k = 'c1')), 'every valid call is stored; a row without a valid id is not');
select test.check((select checkpoint = (select t from cs where k = 'b1') - interval '10 minutes' and last_full_at = (select t from cs where k = 'b1') and next_page is null and running_since is null
                     from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs'),
  'read to the end: the checkpoint moves to the start minus 10 minutes, the lease is released');
select test.check((select outcome = 'DONE' and full_pull and rows_stored = 4 and rows_skipped = 1 and pages = 2 from crocodial_sync_runs where connection_id = (select id from cs where k = 'c1') order by id desc limit 1),
  'the run is recorded');

\echo '   the next run asks only for what changed, and storing twice changes nothing'
select test.check((select (croc_sync_begin((select id from cs where k = 'c1'), 'call-logs') ->> 'full')::boolean = false), 'the next run is not a full pull');
select test.check((select run_since = (select t from cs where k = 'b1') - interval '10 minutes' from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs'),
  'it asks for rows updated since the checkpoint');
select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', jsonb_build_array(
  jsonb_build_object('id', 1, 'calledBy', 4138, 'lead', 900, 'callType', 'outgoing', 'callAt', (now() - interval '2 days')::text, 'durationSeconds', 125, 'connected', true)), null);
select croc_sync_finish((select id from cs where k = 'c1'), 'call-logs', 'DONE', 1, 0);
select test.check((select count(*) = 4 and sum(duration_seconds) = 125 + 0 + 60 + 30 from crocodial_ext_calls where connection_id = (select id from cs where k = 'c1')),
  'a call seen again is updated, never duplicated');

\echo '   stopping half-way, and failing'
insert into cs select 'cp', null, checkpoint from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs';
select croc_sync_begin((select id from cs where k = 'c1'), 'call-logs');
select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', '[]'::jsonb, 2);
select croc_sync_finish((select id from cs where k = 'c1'), 'call-logs', 'PARTIAL', 1, 0);
select test.check((select next_page = 2 and checkpoint = (select t from cs where k = 'cp') from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs'),
  'a run stopped for time keeps its place, and the checkpoint does not move');
select test.check((select (croc_sync_begin((select id from cs where k = 'c1'), 'call-logs') ->> 'page')::integer = 2), 'the next run resumes from that page');
select croc_sync_finish((select id from cs where k = 'c1'), 'call-logs', 'FAILED', 0, 0, 'Crocodial answered 500.');
select test.check((select checkpoint = (select t from cs where k = 'cp') and last_error = 'Crocodial answered 500.' from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs'),
  'a failed run keeps the checkpoint and its error');
select test.check((select last_error is null from crocodial_sync_state where connection_id = (select id from cs where k = 'c1') and resource = 'leads') is not false,
  'another resource is not affected by the failure');

\echo '   the weekly full pull marks what Crocodial no longer returns (never deletes)'
update crocodial_sync_state set next_page = null, last_full_at = now() - interval '8 days' where connection_id = (select id from cs where k = 'c1') and resource = 'call-logs';
select test.check((select (croc_sync_begin((select id from cs where k = 'c1'), 'call-logs') ->> 'full')::boolean), 'after a week a full pull is due');
select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', jsonb_build_array(
  jsonb_build_object('id', 1, 'calledBy', 4138, 'lead', 900, 'callType', 'outgoing', 'callAt', (now() - interval '2 days')::text, 'durationSeconds', 125, 'connected', true),
  jsonb_build_object('id', 3, 'calledBy', 4193, 'lead', 902, 'callType', 'outgoing', 'callAt', (now() - interval '1 day')::text, 'durationSeconds', 60, 'connected', true),
  jsonb_build_object('id', 4, 'calledBy', 371, 'callType', 'incoming', 'callAt', (now() - interval '1 day')::text, 'durationSeconds', 30, 'connected', true)), null);
select test.check((select (croc_sync_finish((select id from cs where k = 'c1'), 'call-logs', 'DONE', 1, 0) ->> 'markedMissing')::integer = 1), 'one call was not returned');
select test.check((select missing_since is not null from crocodial_ext_calls where connection_id = (select id from cs where k = 'c1') and external_id = 2),
  'it is marked missing, and kept');

\echo '   two accounts with the same numbers stay apart'
select croc_sync_begin((select id from cs where k = 'c2'), 'call-logs');
select croc_sync_store((select id from cs where k = 'c2'), 'call-logs', jsonb_build_array(
  jsonb_build_object('id', 1, 'calledBy', 4138, 'callType', 'outgoing', 'callAt', now()::text, 'durationSeconds', 999, 'connected', true)), null);
select croc_sync_finish((select id from cs where k = 'c2'), 'call-logs', 'DONE', 1, 0);
select test.check((select count(*) = 2 from crocodial_ext_calls where external_id = 1), 'call 1 of each account is its own row');
select test.check((select duration_seconds = 125 from crocodial_ext_calls where connection_id = (select id from cs where k = 'c1') and external_id = 1), 'and neither overwrote the other');
select test.check((select private.croc_person_at((select id from cs where k = 'c2'), 4138, now()) is null), 'user 4138 of the other account is nobody here (no mapping there)');

\echo '   attribution follows the mapping in effect at the time of the call'
select test.check((select private.croc_person_at((select id from cs where k = 'c1'), 4138, now() - interval '2 days') = test.id('cr_s1')), 'a call of user 4138 is Sachin''s');
select test.check((select private.croc_person_at((select id from cs where k = 'c1'), 4193, now()) is null), 'a user without an approved mapping is nobody');
update crocodial_employee_mappings set status = 'REVOKED', ended_at = now() - interval '12 hours' where connection_id = (select id from cs where k = 'c1') and external_employee_id = 371;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from cs where k = 'c1'), 371, 'Supriya', test.id('cr_s3'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '12 hours', now() - interval '12 hours');
select test.check((select private.croc_person_at((select id from cs where k = 'c1'), 371, now() - interval '1 day') = test.id('cr_s2')
                     and private.croc_person_at((select id from cs where k = 'c1'), 371, now()) = test.id('cr_s3')),
  're-mapping a Crocodial user never rewrites who made the earlier calls');

\echo '   the Super Admin sees the sync and the unmatched records'
set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_sync_status()$$, 'an employee cannot read the sync status', 'FORBIDDEN');
select test.must_fail($$select croc_sync_request((select id from cs where k = 'c1'))$$, 'nor start a sync', 'FORBIDDEN');
select test.must_fail($$select croc_sync_store((select id from cs where k = 'c1'), 'call-logs', '[]'::jsonb, null)$$, 'nor store records', 'permission denied');
select test.login('sa');
select test.check((select (x -> 'unmatched' ->> 'calls')::integer = 1 and (x -> 'counts' ->> 'calls')::integer = 3 and x -> 'unmatchedByUser' -> 0 ->> 'externalId' = '4193'
                     from jsonb_array_elements(croc_sync_status()) x where (x ->> 'connectionId')::uuid = (select id from cs where k = 'c1')),
  'the call of the unmapped user is shown as unmatched (and by whom), the missing one is not counted');
select test.check((select croc_sync_request((select id from cs where k = 'c1')) ->> 'credentialRef' = 'CROCODIAL_TOKEN_SYNCTEST'), 'the Super Admin starts a sync');
select test.must_fail($$select croc_sync_request((select id from cs where k = 'c1'))$$, 'at most once every 5 minutes', 'CONFLICT');
reset role;
update crocodial_connections set enabled = false where id = (select id from cs where k = 'c2');
set role authenticated;
select test.login('sa');
select test.must_fail($$select croc_sync_request((select id from cs where k = 'c2'))$$, 'a connection that is off cannot be synced', 'VALIDATION_ERROR');
reset role;

-- clean up
delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_SYNCTEST%';
\echo '=== CROCODIAL SYNC TESTS PASSED ==='
