-- =============================================================================
-- Crocodial integration, part 1 (migration 20270115000100): the rollout, connections, department links, employee identity mappings
-- and who may see a person's Crocodial activity. Reuses sa (Super Admin), gb_h (M Pillar's combined head), ga_s (D Talk Sales head).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 138. Crocodial: connections, rollout and identity mappings'
reset role;
\i supabase/migrations/20270115000100_crocodial_integration.sql
\i supabase/migrations/20270115000100_crocodial_integration.sql

-- a clean slate (re-runnable)
delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_TEST%';
create temp table cr_t0 as select clock_timestamp() as t;

-- M Pillar Sales: two members under two different Team Leads; a Support member; a D Talk Sales member
do $$ begin
  if not exists (select 1 from test.users where name = 'cr_tl1') then
    perform test.create_auth_user('cr_tl1', 'cr.tl1@amuwa.com', '{"full_name":"CR Lead One"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('mpillar', 'Sales')));
    perform test.create_auth_user('cr_tl2', 'cr.tl2@amuwa.com', '{"full_name":"CR Lead Two"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('mpillar', 'Sales')));
    perform test.create_auth_user('cr_s1', 'cr.s1@amuwa.com', '{"full_name":"CR Sachin"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('mpillar', 'Sales')));
    perform test.create_auth_user('cr_s2', 'cr.s2@amuwa.com', '{"full_name":"CR Supriya"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('mpillar', 'Sales')));
    perform test.create_auth_user('cr_s3', 'cr.s3@amuwa.com', '{"full_name":"CR Other Seller"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('mpillar', 'Sales')));
    perform test.create_auth_user('cr_sup', 'cr.sup@amuwa.com', '{"full_name":"CR Support"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('mpillar', 'Support')));
    perform test.create_auth_user('cr_dt', 'cr.dt@amuwa.com', '{"full_name":"CR DTalk Seller"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('dtalk', 'Sales')));
  end if;
end $$;
update profiles set status = 'ACTIVE' where id in (test.id('cr_tl1'), test.id('cr_tl2'), test.id('cr_s1'), test.id('cr_s2'), test.id('cr_s3'), test.id('cr_sup'), test.id('cr_dt'));
update profiles set manager_id = test.id('cr_tl1') where id in (test.id('cr_s1'), test.id('cr_s3'));
update profiles set manager_id = test.id('cr_tl2') where id = test.id('cr_s2');
create temp table cr (k text primary key, id uuid);
grant all on cr to authenticated;

\echo '   the rollout: M Pillar Sales only'
select test.check((select count(*) = 1 from crocodial_rollout where allowed), 'only one department/function may use Crocodial');
select test.check((select allowed from crocodial_rollout where department_id = test.dept('mpillar') and division = 'SALES'), 'and it is M Pillar''s Sales');

\echo '   only the Super Admin configures'
set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_admin_overview()$$, 'an employee cannot read the configuration', 'FORBIDDEN');
select test.must_fail($$select croc_connection_save('{"name":"Mine","credentialRef":"CROCODIAL_TOKEN_TEST_X"}'::jsonb)$$, 'nor create a connection', 'FORBIDDEN');
select test.login('gb_h');
select test.must_fail($$select croc_admin_overview()$$, 'nor can the Department Head', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select croc_connection_save('{"name":"Bad","credentialRef":"rmd_secret_token_value"}'::jsonb)$$,
  'a token pasted as the credential is refused (only the NAME of the server setting is stored)', 'VALIDATION_ERROR');
insert into cr select 'c1', (croc_connection_save('{"name":"M Pillar","externalAccountLabel":"M pillar corporation","credentialRef":"crocodial_token_test_mp"}'::jsonb) ->> 'id')::uuid;
insert into cr select 'c2', (croc_connection_save('{"name":"Other account","credentialRef":"CROCODIAL_TOKEN_TEST_OTHER"}'::jsonb) ->> 'id')::uuid;
reset role;
select test.check((select credential_ref = 'CROCODIAL_TOKEN_TEST_MP' and not enabled and health = 'UNKNOWN' from crocodial_connections where id = (select id from cr where k = 'c1')),
  'a new connection is stored disabled, with the credential name in capitals');
-- (20270307000100 stores a key the SERVER encrypted: its ciphertext, fingerprint and last 4 only; crocodial_ceo_connections_test.sql)
select test.check((select count(*) = 0 from information_schema.columns where table_name = 'crocodial_connections' and column_name ~ 'token|secret|key$'
                     and column_name not in ('token_ciphertext', 'token_fingerprint', 'token_last4', 'token_set_by', 'token_set_at')),
  'no column can hold a plain token (only the encrypted key, its fingerprint and last 4)');
set role authenticated;
select test.login('sa');
select test.must_fail($$select croc_connection_save('{"name":"Dup","credentialRef":"CROCODIAL_TOKEN_TEST_MP"}'::jsonb)$$, 'two connections cannot share one credential', 'CONFLICT');
select test.must_fail($$select croc_department_link_save((select id from cr where k = 'c1'), test.dept('dtalk'), 'SALES', true)$$,
  'a department that is not rolled out cannot be linked', 'FORBIDDEN');
select test.must_fail($$select croc_department_link_save((select id from cr where k = 'c1'), test.dept('mpillar'), 'SUPPORT', true)$$,
  'Support cannot be linked', 'FORBIDDEN');
select test.check((select croc_department_link_save((select id from cr where k = 'c1'), test.dept('mpillar'), 'SALES', false) ->> 'enabled' = 'false'),
  'M Pillar Sales is linked, still switched off');
reset role;

\echo '   the account''s users (as Crocodial reports them; two accounts reuse the same numbers)'
select croc_store_directory((select id from cr where k = 'c1'),
  '[{"id":371,"name":"Supriya Mpillar","isActive":true,"branchIds":[121]},{"id":4138,"name":"sachin","isActive":true,"branchIds":[121]},{"id":4193,"name":"Vanshika","isActive":true}]'::jsonb,
  '[{"id":121,"name":"M pillar corporation","status":"active"}]'::jsonb, 'Asia/Kolkata');
select croc_store_directory((select id from cr where k = 'c2'), '[{"id":4138,"name":"Someone else","isActive":true}]'::jsonb, '[]'::jsonb);
select test.check((select count(*) = 2 from crocodial_ext_employees where external_id = 4138), 'the same Crocodial number in two accounts stays two people');
select test.check((select timezone = 'Asia/Kolkata' from crocodial_connections where id = (select id from cr where k = 'c1')), 'the account''s time zone is kept');
select croc_store_directory((select id from cr where k = 'c1'),
  '[{"id":371,"name":"Supriya Mpillar","isActive":true},{"id":4138,"name":"sachin","isActive":true}]'::jsonb, '[{"id":121,"name":"M pillar corporation"}]'::jsonb);
select test.check((select missing_since is not null from crocodial_ext_employees where connection_id = (select id from cr where k = 'c1') and external_id = 4193),
  'a user no longer listed is marked missing, not deleted');

\echo '   mapping: proposed, checked, approved by the Super Admin'
set role authenticated;
select test.login('sa');
select test.check((select (croc_mapping_check((select id from cr where k = 'c1'), 4138, test.id('cr_s1'), test.dept('mpillar')) -> 'profile' ->> 'eligible')::boolean),
  'the check shows the M Pillar Sales member is eligible');
select test.must_fail($$select croc_mapping_create((select id from cr where k = 'c1'), 4138, test.id('cr_sup'), test.dept('mpillar'))$$,
  'a Support member cannot be mapped to Sales', 'VALIDATION_ERROR');
select test.must_fail($$select croc_mapping_create((select id from cr where k = 'c1'), 4138, test.id('cr_dt'), test.dept('mpillar'))$$,
  'nor someone of another department', 'VALIDATION_ERROR');
select test.must_fail($$select croc_mapping_create((select id from cr where k = 'c1'), 999999, test.id('cr_s1'), test.dept('mpillar'))$$,
  'a Crocodial user the account did not report cannot be mapped', 'NOT_FOUND');
insert into cr select 'm1', (croc_mapping_create((select id from cr where k = 'c1'), 4138, test.id('cr_s1'), test.dept('mpillar')) ->> 'id')::uuid;
insert into cr select 'm2', (croc_mapping_create((select id from cr where k = 'c1'), 371, test.id('cr_s2'), test.dept('mpillar')) ->> 'id')::uuid;
select test.must_fail($$select croc_mapping_create((select id from cr where k = 'c1'), 4138, test.id('cr_s3'), test.dept('mpillar'))$$,
  'one Crocodial user cannot be mapped to two people', 'CONFLICT');
select test.must_fail($$select croc_mapping_create((select id from cr where k = 'c1'), 4193, test.id('cr_s1'), test.dept('mpillar'))$$,
  'one person cannot have two Crocodial users on one account', 'CONFLICT');
reset role;
select test.check((select status = 'PENDING' and not private.croc_mapping_live(m) from crocodial_employee_mappings m where id = (select id from cr where k = 'm1')),
  'a proposed mapping is not in effect');
set role authenticated;
select test.login('cr_s1');
select test.check((select not (croc_my_status() ->> 'enabled')::boolean), 'the employee sees Crocodial switched off while the mapping is pending');
select test.must_fail($$select croc_mapping_approve((select id from cr where k = 'm1'))$$, 'an employee cannot approve their own mapping', 'FORBIDDEN');
select test.login('sa');
select croc_mapping_approve((select id from cr where k = 'm1'));
select croc_mapping_approve((select id from cr where k = 'm2'));
select test.must_fail($$select croc_mapping_approve((select id from cr where k = 'm1'))$$, 'an approved mapping cannot be approved again', 'CONFLICT');
reset role;
select test.check((select role_snapshot ->> 'role' = 'TEAM_MEMBER' and approved_by = test.id('sa') from crocodial_employee_mappings where id = (select id from cr where k = 'm1')),
  'the approval records who approved and the person''s role then');
select test.check((select role = 'TEAM_MEMBER' and team_id = test.team('mpillar', 'Sales') from profiles where id = test.id('cr_s1')), 'the CRM profile is not changed');

\echo '   nothing is in effect until the connection and the department are switched on'
select test.check((select not private.croc_mapping_live(m) from crocodial_employee_mappings m where id = (select id from cr where k = 'm1')),
  'approved, but the connection and the department link are off');
set role authenticated;
select test.login('sa');
select croc_connection_save(jsonb_build_object('id', (select id from cr where k = 'c1'), 'name', 'M Pillar', 'credentialRef', 'CROCODIAL_TOKEN_TEST_MP', 'enabled', true));
reset role;
select test.check((select not private.croc_mapping_live(m) from crocodial_employee_mappings m where id = (select id from cr where k = 'm1')), 'connection on, department still off');
set role authenticated;
select test.login('sa');
select croc_department_link_save((select id from cr where k = 'c1'), test.dept('mpillar'), 'SALES', true);
reset role;
select test.check((select private.croc_mapping_live(m) from crocodial_employee_mappings m where id = (select id from cr where k = 'm1')), 'all switched on: in effect');
select test.check((select count(*) = 0 from crocodial_employee_mappings where profile_id = test.id('cr_s3')),
  'switching the department on switched nobody else on');
set role authenticated;
select test.login('cr_s1');
select test.check((select (croc_my_status() ->> 'enabled')::boolean and croc_my_status() ->> 'externalName' = 'sachin'), 'the mapped employee sees Crocodial switched on');
select test.login('cr_s3');
select test.check((select not (croc_my_status() ->> 'enabled')::boolean), 'another M Pillar Sales member does not');
reset role;

\echo '   who may see a person''s Crocodial activity'
reset role;   -- the private check is not callable by signed-in users; the login (JWT claims) is still the one tested
select test.login('cr_s1');
select test.check((select private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'the person themselves');
select test.check((select not private.croc_can_view(test.id('cr_s2'), test.dept('mpillar'), 'SALES')), 'not a colleague');
select test.login('cr_tl1');
select test.check((select private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'their own Team Lead');
select test.check((select not private.croc_can_view(test.id('cr_s2'), test.dept('mpillar'), 'SALES')), 'not another Team Lead''s person in the same team');
select test.login('cr_tl2');
select test.check((select private.croc_can_view(test.id('cr_s2'), test.dept('mpillar'), 'SALES') and not private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')),
  'the other Team Lead sees only their own person');
select test.login('cr_sup');
select test.check((select not private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'an M Pillar Support member sees nothing');
select test.login('cr_dt');
select test.check((select not private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'another department sees nothing');
select test.login('ga_s');
select test.check((select not private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'a head of other departments sees nothing');
select test.login('gb_h');
select test.check((select private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'M Pillar''s Department Head sees the pilot employees');
select test.login('sa');
select test.check((select private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'the Super Admin sees everything');
reset role;
select set_config('request.jwt.claims', '', false);
select test.check((select not private.croc_can_view(test.id('cr_s1'), test.dept('mpillar'), 'SALES')), 'without a login nothing is visible');
set role anon;
select test.must_fail($$select croc_my_status()$$, 'anonymous callers cannot call the functions', 'permission denied');
reset role;
set role authenticated;
select test.login('sa');
select test.must_fail($$select croc_store_directory((select id from cr where k = 'c1'), '[]'::jsonb, '[]'::jsonb)$$, 'only the server stores the account''s directory', 'permission denied');
reset role;

\echo '   revoking keeps history; withdrawing the rollout switches the department off'
set role authenticated;
select test.login('sa');
select croc_mapping_revoke((select id from cr where k = 'm2'), 'Left the pilot');
reset role;
select test.check((select status = 'REVOKED' and ended_at is not null from crocodial_employee_mappings where id = (select id from cr where k = 'm2')), 'a revoked mapping ends');
select test.check((select private.croc_mapping_live(m, approved_at + (ended_at - approved_at) / 2) and not private.croc_mapping_live(m) from crocodial_employee_mappings m where id = (select id from cr where k = 'm2')),
  'activity before the end stays the person''s; nothing after it');
set role authenticated;
select test.login('sa');
select test.check((select croc_mapping_create((select id from cr where k = 'c1'), 371, test.id('cr_s2'), test.dept('mpillar')) ->> 'status' = 'PENDING'),
  'a revoked person can be proposed again');
select croc_rollout_set(test.dept('mpillar'), 'SALES', false, 'Pilot paused');
reset role;
select test.check((select not enabled from crocodial_department_links where connection_id = (select id from cr where k = 'c1') and department_id = test.dept('mpillar')),
  'withdrawing the rollout switches the department link off');
select test.check((select not private.croc_mapping_live(m) from crocodial_employee_mappings m where id = (select id from cr where k = 'm1')), 'and nobody''s data is in effect');
select test.check((select count(*) >= 8 from audit_logs where entity_type like 'crocodial%' and created_at >= (select t from cr_t0)), 'every configuration change is in the audit log');
set role authenticated;
select test.login('sa');
select test.check((select jsonb_array_length(croc_admin_overview() -> 'audit') >= 8 and jsonb_array_length(croc_admin_overview() -> 'mappings') >= 3),
  'the Super Admin''s overview lists mappings and history');
select croc_rollout_set(test.dept('mpillar'), 'SALES', true, 'Crocodial pilot');
reset role;

-- clean up
delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_TEST%';
\echo '=== CROCODIAL TESTS PASSED ==='
