-- =============================================================================
-- Crocodial (migration 20270115000500): "Sync now" may be used again after a minute; still Super Admin only, still refused when switched off.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 142. Crocodial: Sync now once a minute'
reset role;
\i supabase/migrations/20270115000500_crocodial_sync_now_minute.sql
\i supabase/migrations/20270115000500_crocodial_sync_now_minute.sql

delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SYNCNOWTEST';
insert into crocodial_connections (name, credential_ref, enabled) values ('Sync now', 'CROCODIAL_TOKEN_SYNCNOWTEST', true);
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled)
select id, test.dept('mpillar'), 'SALES', true from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SYNCNOWTEST';
create temp table sn as select id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SYNCNOWTEST';
grant all on sn to authenticated;

set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_sync_request((select id from sn))$$, 'an employee cannot start a sync', 'FORBIDDEN');
select test.login('sa');
select test.check((select croc_sync_request((select id from sn)) ->> 'credentialRef' = 'CROCODIAL_TOKEN_SYNCNOWTEST'), 'the Super Admin starts a sync');
select test.must_fail($$select croc_sync_request((select id from sn))$$, 'not again within a minute', 'less than a minute');
reset role;
update crocodial_connections set last_manual_sync_at = now() - interval '70 seconds' where id = (select id from sn);
set role authenticated;
select test.login('sa');
select test.check((select croc_sync_request((select id from sn)) is not null), 'again after a minute (no longer 5)');
reset role;
update crocodial_department_links set enabled = false where connection_id = (select id from sn);
update crocodial_connections set last_manual_sync_at = null where id = (select id from sn);
set role authenticated;
select test.login('sa');
select test.must_fail($$select croc_sync_request((select id from sn))$$, 'never when the department is switched off', 'VALIDATION_ERROR');
reset role;

delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SYNCNOWTEST';
\echo '=== CROCODIAL SYNC NOW TESTS PASSED ==='
