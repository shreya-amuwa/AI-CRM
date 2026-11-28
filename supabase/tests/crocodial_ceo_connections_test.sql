-- =============================================================================
-- CEO-managed Crocodial connections (migration 20270307000100): who may manage a connection. The MD manages every connection; a CEO only
-- one whose linked departments they ALL run (private.is_ceo_for_sales), and creates connections / adds links only for departments they
-- run (the rollout is then allowed automatically, audited as theirs). The MD keeps the kill switch (md_disabled_at, a withdrawn rollout).
-- Every refusal of a department the caller does not run is the exact FORBIDDEN copy. Runs at the end (uses sa, sh_head and the CEOs of
-- lead_tags_test.sql: lt_ceo_a = Wabastore + Whatsbox, lt_ceo_b = Whatsbox + Digitree, lt_ceo_sup = Whatsbox Support only).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Crocodial: CEO-managed connections'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites re-run older migrations (the Crocodial functions); all three are safe to run twice
\i supabase/migrations/20270305000100_lead_tags.sql
\i supabase/migrations/20270306000100_crocodial_status_tags.sql
\i supabase/migrations/20270307000100_crocodial_ceo_connections.sql
\i supabase/migrations/20270307000100_crocodial_ceo_connections.sql

-- the CEOs as lead_tags_test.sql leaves them (it moves some departments around): set again, so this file also runs on its own
update profiles set status = 'ACTIVE', is_operations_head = true where id in (test.id('lt_ceo_a'), test.id('lt_ceo_b'), test.id('lt_ceo_sup'));
update profiles set status = 'ACTIVE' where id in (test.id('lt_wab_tm'), test.id('lt_wbx_tm'), test.id('lt_dg_tm'));
delete from operations_head_departments where profile_id in (test.id('lt_ceo_a'), test.id('lt_ceo_b'), test.id('lt_ceo_sup'));
insert into operations_head_departments (profile_id, department_id, division) values
  (test.id('lt_ceo_a'), test.dept('wabastore'), null), (test.id('lt_ceo_a'), test.dept('whatsbox'), null),
  (test.id('lt_ceo_b'), test.dept('whatsbox'), null), (test.id('lt_ceo_b'), test.dept('digitree'), null),
  (test.id('lt_ceo_sup'), test.dept('whatsbox'), 'SUPPORT');

-- a clean slate (re-runnable)
delete from crocodial_connections where name like 'CC %';
delete from customers where phone like '+9198772%';
delete from crocodial_rollout where department_id in (test.dept('wabastore'), test.dept('whatsbox'), test.dept('digitree'));
insert into crocodial_rollout (department_id, division, allowed) values (test.dept('mpillar'), 'SALES', true) on conflict (department_id, division) do update set allowed = true;
create temp table cc (k text primary key, id uuid);
create temp table cc_t0 as select clock_timestamp() as t;
grant all on cc to authenticated;
-- the exact text of the error (test.must_fail matches a pattern)
create or replace function test.cc_fails(p_sql text, p_label text, p_exact text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm is distinct from p_exact then raise exception 'TEST FAILED: % (unexpected error: %)', p_label, sqlerrm; end if;
    raise notice 'ok - % [%]', p_label, sqlerrm;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;
grant execute on function test.cc_fails(text, text, text) to authenticated;
\set forbidden 'FORBIDDEN: You can manage Crocodial only for departments you run.'
\set md_off 'CONFLICT: Switched off by the Managing Director. Ask the Managing Director to switch it back on.'

-- the MD's own connection (M Pillar), with a lead and a held lead link
set role authenticated;
select test.login('sa');
insert into cc select 'mp', (croc_connection_save('{"name":"CC M Pillar","credentialRef":"CROCODIAL_TOKEN_CCTEST_MP","enabled":true}'::jsonb) ->> 'id')::uuid;
select croc_department_link_save((select id from cc where k = 'mp'), test.dept('mpillar'), 'SALES', true);
reset role;
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number) values ((select id from cc where k = 'mp'), 880001, 'CC MP lead', '+919877200001');
insert into crocodial_crm_lead_links (connection_id, external_lead_id, status, department_id) values ((select id from cc where k = 'mp'), 880001, 'AMBIGUOUS', test.dept('mpillar'));
insert into cc select 'mp_link', id from crocodial_crm_lead_links where connection_id = (select id from cc where k = 'mp') and external_lead_id = 880001;

\echo '   a CEO creates a connection for departments they run'
set role authenticated;
select test.login('lt_ceo_a');
select test.must_fail($$select croc_connection_save(jsonb_build_object('name', 'CC A', 'credentialRef', 'CROCODIAL_TOKEN_CCTEST_A', 'departmentIds', jsonb_build_array(test.dept('wabastore'))))$$,
  'a CEO cannot use a server credential name (only the MD can)', 'FORBIDDEN');
select test.must_fail($$select croc_connection_save('{"name":"CC A"}'::jsonb)$$, 'a CEO must choose at least one department', 'VALIDATION_ERROR');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('name', 'CC A', 'departmentIds', jsonb_build_array(test.dept('wabastore'), test.dept('digitree'))))$$,
  'a department the CEO does not run (Digitree) is refused with the exact copy', :'forbidden');
insert into cc select 'a', (croc_connection_save(jsonb_build_object('name', 'CC A', 'departmentIds', jsonb_build_array(test.dept('wabastore'), test.dept('whatsbox')))) ->> 'id')::uuid;
reset role;
select test.check((select credential_ref is null and not enabled and created_by = test.id('lt_ceo_a') from crocodial_connections where id = (select id from cc where k = 'a')),
  'the connection is stored switched off, with no server credential name');
select test.check((select count(*) = 2 and bool_and(division = 'SALES') from crocodial_department_links where connection_id = (select id from cc where k = 'a')
                    and department_id in (test.dept('wabastore'), test.dept('whatsbox'))),
  'it is linked to Wabastore and Whatsbox Sales in the same call');
select test.check((select count(*) = 2 and bool_and(allowed) and bool_and(updated_by = test.id('lt_ceo_a')) from crocodial_rollout
                    where division = 'SALES' and department_id in (test.dept('wabastore'), test.dept('whatsbox'))),
  'and the rollout of both departments is allowed, by that CEO');
select test.check((select count(*) = 2 from audit_logs where action = 'CROCODIAL_ROLLOUT_SET' and actor_id = test.id('lt_ceo_a')
                    and department_id in (test.dept('wabastore'), test.dept('whatsbox')) and created_at >= (select t from cc_t0)),
  'each automatic rollout is audited as done by that CEO');
select test.check((select count(*) = 1 from audit_logs where action = 'CROCODIAL_CONNECTION_CREATED' and actor_id = test.id('lt_ceo_a') and entity_id = (select id from cc where k = 'a')),
  'the new connection is audited');
set role authenticated;
select test.login('lt_ceo_a');
select test.check(private.croc_can_manage((select id from cc where k = 'a')), 'its CEO can manage it');
select test.check((croc_admin_connection((select id from cc where k = 'a')) ->> 'id')::uuid = (select id from cc where k = 'a'), 'and open it');
select test.check(not private.croc_can_manage((select id from cc where k = 'mp')), 'but not the MD''s M Pillar connection');

\echo '   another CEO cannot open it (it includes Wabastore, which they do not run)'
select test.login('lt_ceo_b');
select test.check(not private.croc_can_manage((select id from cc where k = 'a')), 'croc_can_manage is false');
select test.cc_fails($$select croc_admin_connection((select id from cc where k = 'a'))$$, 'they cannot open it', :'forbidden');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A taken', 'enabled', true))$$, 'nor change it', :'forbidden');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('digitree'), 'SALES', true)$$, 'nor link it', :'forbidden');
select test.cc_fails($$select croc_reconcile_overview((select id from cc where k = 'a'))$$, 'nor read its monitor', :'forbidden');
select test.cc_fails($$select croc_lead_links_list((select id from cc where k = 'a'))$$, 'nor its held leads', :'forbidden');
select test.cc_fails($$select croc_sync_request((select id from cc where k = 'a'))$$, 'nor sync it', :'forbidden');
select test.cc_fails($$select croc_lead_import_set((select id from cc where k = 'a'), test.dept('whatsbox'), 'PREVIEW')$$, 'nor set its lead import', :'forbidden');
select test.cc_fails($$select croc_status_mapping_tag_set((select id from cc where k = 'a'), 'hot', test.lt_seed('NEW'))$$, 'nor map its statuses', :'forbidden');
select test.cc_fails($$select croc_mapping_check((select id from cc where k = 'a'), 501, test.id('lt_wbx_tm'), test.dept('whatsbox'))$$, 'nor check a mapping on it', :'forbidden');
select test.cc_fails($$select croc_admin_connection(gen_random_uuid())$$, 'a connection that does not exist is refused the same way (nothing is revealed)', :'forbidden');

\echo '   a connection for a department both CEOs run'
insert into cc select 'b', (croc_connection_save(jsonb_build_object('name', 'CC B', 'departmentIds', jsonb_build_array(test.dept('whatsbox')))) ->> 'id')::uuid;
select test.check(private.croc_can_manage((select id from cc where k = 'b')), 'its creator manages it');
select test.login('lt_ceo_a');
select test.check(private.croc_can_manage((select id from cc where k = 'b')), 'and so does the other CEO who runs Whatsbox');
select test.check((croc_admin_connection((select id from cc where k = 'b')) ->> 'id') is not null, 'who can open it');

\echo '   adding a link: only a department the CEO runs, Sales only'
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('digitree'), 'SALES', true)$$,
  'linking Digitree to their own connection is refused', :'forbidden');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'b'), test.dept('digitree'), 'SALES', false)$$,
  'and to the shared one too', :'forbidden');
select test.must_fail($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SUPPORT', true)$$, 'Support cannot be linked', 'VALIDATION_ERROR');
select test.check((croc_department_link_save((select id from cc where k = 'b'), test.dept('wabastore'), 'SALES', false) ->> 'departmentId')::uuid = test.dept('wabastore'),
  'a department they run (Wabastore) can be added to the shared connection');
select test.login('lt_ceo_b');
select test.check(not private.croc_can_manage((select id from cc where k = 'b')), 'after which the other CEO (no Wabastore) no longer manages it');
select test.cc_fails($$select croc_admin_connection((select id from cc where k = 'b'))$$, 'and cannot open it', :'forbidden');

\echo '   people mappings: only active employees of the connection''s departments'
reset role;
select croc_store_directory((select id from cc where k = 'a'), '[{"id":501,"name":"Wab seller","isActive":true},{"id":502,"name":"Digi seller","isActive":true}]'::jsonb, '[]'::jsonb);
set role authenticated;
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_mapping_create((select id from cc where k = 'a'), 502, test.id('lt_dg_tm'), test.dept('wabastore'))$$,
  'an employee of Digitree cannot be mapped on the Wabastore + Whatsbox connection', 'VALIDATION_ERROR: Choose an employee of this connection''s departments.');
select test.must_fail($$select croc_mapping_create((select id from cc where k = 'a'), 502, test.id('lt_dg_tm'), test.dept('digitree'))$$,
  'nor under Digitree (not linked)', 'VALIDATION_ERROR');
select test.must_fail($$select croc_mapping_check((select id from cc where k = 'a'), 502, test.id('lt_dg_tm'), test.dept('wabastore'))$$,
  'the check does not show a Digitree employee either', 'VALIDATION_ERROR');
select test.check((croc_mapping_check((select id from cc where k = 'a'), 501, test.id('lt_wab_tm'), test.dept('wabastore')) -> 'profile' ->> 'eligible')::boolean,
  'a Wabastore Sales member is eligible');
insert into cc select 'm1', (croc_mapping_create((select id from cc where k = 'a'), 501, test.id('lt_wab_tm'), test.dept('wabastore')) ->> 'id')::uuid;
select test.check(croc_mapping_approve((select id from cc where k = 'm1')) ->> 'status' = 'APPROVED', 'the CEO approves the mapping');
select test.login('lt_ceo_b');
select test.cc_fails($$select croc_mapping_revoke((select id from cc where k = 'm1'))$$, 'the other CEO cannot revoke it', :'forbidden');
select test.cc_fails($$select croc_mapping_count_from((select id from cc where k = 'm1'), current_date)$$, 'nor move its start', :'forbidden');
select test.cc_fails($$select croc_mapping_approve((select id from cc where k = 'm1'))$$, 'nor approve it', :'forbidden');
select test.cc_fails($$select croc_mapping_approve(gen_random_uuid())$$, 'a mapping that does not exist is refused the same way', :'forbidden');
select test.login('lt_ceo_a');
select test.must_fail($$select croc_mapping_count_from((select id from cc where k = 'm1'), null)$$, 'its CEO may move its start (no activity yet)', 'VALIDATION_ERROR: No activity');
select test.check(croc_mapping_revoke((select id from cc where k = 'm1'), 'test') ->> 'status' = 'REVOKED', 'and revoke it');

\echo '   status mapping, lead import, held leads, monitor and sync on their own connection'
select test.check(croc_status_mapping_tag_set((select id from cc where k = 'a'), 'hot', test.lt_seed('INTERESTED')) ->> 'status' = 'hot', 'the CEO maps a status');
select test.cc_fails($$select croc_status_mapping_tag_set((select id from cc where k = 'mp'), 'hot', test.lt_seed('INTERESTED'))$$, 'but not on M Pillar', :'forbidden');
select test.check(croc_lead_import_set((select id from cc where k = 'a'), test.dept('wabastore'), 'PREVIEW') ->> 'mode' = 'PREVIEW', 'sets lead import per department');
select test.cc_fails($$select croc_lead_import_set((select id from cc where k = 'mp'), test.dept('mpillar'), 'OFF')$$, 'but not M Pillar''s', :'forbidden');
select test.check((croc_reconcile_overview((select id from cc where k = 'a')) ->> 'externalLeads')::integer = 0, 'reads their monitor');
select test.cc_fails($$select croc_reconcile_overview((select id from cc where k = 'mp'))$$, 'but not M Pillar''s (its leads count)', :'forbidden');
select test.check((croc_lead_links_list((select id from cc where k = 'a')) ->> 'total')::integer = 0, 'lists their held leads');
select test.cc_fails($$select croc_lead_links_list((select id from cc where k = 'mp'))$$, 'but not M Pillar''s', :'forbidden');
select test.cc_fails($$select croc_lead_link_resolve((select id from cc where k = 'mp_link'), 'IGNORE')$$, 'nor resolve one of them', :'forbidden');
select test.cc_fails($$select croc_sync_request((select id from cc where k = 'mp'))$$, 'nor sync M Pillar', :'forbidden');
select test.must_fail($$select croc_reconcile((select id from cc where k = 'a'))$$, 'the batch itself stays with the server (service role)', 'permission denied');
reset role;
select set_config('request.jwt.claims', '', false);
insert into customers (owner_id, name, phone, lifecycle_stage, lead_source) values
  (test.id('lt_wab_tm'), 'CC Wab lead', '+919877200002', 'LEAD', 'Website'), (test.id('lt_dg_tm'), 'CC Digi lead', '+919877200003', 'LEAD', 'Website');
insert into cc select 'cust_wab', id from customers where phone = '+919877200002';
insert into cc select 'cust_dg', id from customers where phone = '+919877200003';
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number) values ((select id from cc where k = 'a'), 880002, 'CC A lead', '+919877200002');
insert into crocodial_crm_lead_links (connection_id, external_lead_id, status, department_id) values ((select id from cc where k = 'a'), 880002, 'AMBIGUOUS', test.dept('wabastore'));
insert into cc select 'a_link', id from crocodial_crm_lead_links where connection_id = (select id from cc where k = 'a') and external_lead_id = 880002;
update customers set department_id = test.dept('digitree') where id = (select id from cc where k = 'cust_dg') and department_id is distinct from test.dept('digitree');
set role authenticated;
select test.login('lt_ceo_a');
select test.must_fail($$select croc_lead_link_resolve((select id from cc where k = 'a_link'), 'LINK', (select id from cc where k = 'cust_dg'))$$,
  'a held lead cannot be linked to a Digitree record', 'VALIDATION_ERROR');
select test.check(croc_lead_link_resolve((select id from cc where k = 'a_link'), 'LINK', (select id from cc where k = 'cust_wab')) ->> 'status' = 'LINKED',
  'but can be linked to a Wabastore lead');
-- switched on: Sync now is theirs
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true)) ->> 'enabled')::boolean, 'the CEO switches it on');
select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', true);
select test.check((croc_sync_request((select id from cc where k = 'a')) ->> 'id')::uuid = (select id from cc where k = 'a'), 'and may sync it');

\echo '   the CEO''s overview: only their connections'
create temp table cc_ov as select croc_admin_overview() as o;
select test.check((select array_agg((c ->> 'id')::uuid) @> array[(select id from cc where k = 'a'), (select id from cc where k = 'b')]
                          and count(*) = 2 from cc_ov, jsonb_array_elements(o -> 'connections') c),
  'only the connections they manage (their own and the Whatsbox + Wabastore one), not M Pillar');
select test.check((select position((select id::text from cc where k = 'mp') in o::text) = 0 and position('CC M Pillar' in o::text) = 0 and position('880001' in o::text) = 0 from cc_ov),
  'nothing of M Pillar appears anywhere in it (connection, links, leads)');
select test.check((select o -> 'rollout' = '[]'::jsonb from cc_ov), 'no rollout table');
select test.check((select bool_and((l ->> 'connectionId')::uuid in (select id from cc where k in ('a', 'b'))) from cc_ov, jsonb_array_elements(o -> 'departmentLinks') l), 'only their links');
select test.check((select coalesce(bool_and((m ->> 'connectionId')::uuid in (select id from cc where k in ('a', 'b'))), true) from cc_ov, jsonb_array_elements(o -> 'mappings') m), 'only their mappings');
select test.check((select coalesce(bool_and((e ->> 'connectionId')::uuid in (select id from cc where k in ('a', 'b'))), true) from cc_ov, jsonb_array_elements(o -> 'externalEmployees') e), 'only their Crocodial users');
select test.check((select array_agg((d ->> 'id')::uuid order by d ->> 'id') @> array[test.dept('wabastore'), test.dept('whatsbox')]
                     and not array_agg((d ->> 'id')::uuid) @> array[test.dept('digitree')]
                     and not array_agg((d ->> 'id')::uuid) @> array[test.dept('mpillar')]
                     and bool_and(private.is_ceo_for_sales((d ->> 'id')::uuid))
                   from cc_ov, jsonb_array_elements(o -> 'departments') d),
  'the departments they may link are only the ones they run');
select test.check((select c -> 'managedBy' @> jsonb_build_array(jsonb_build_object('id', test.id('lt_ceo_a'), 'name', 'LT CEO A'))
                     and not (c -> 'managedBy' @> jsonb_build_array(jsonb_build_object('id', test.id('lt_ceo_b'), 'name', 'LT CEO B')))
                   from cc_ov, jsonb_array_elements(o -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'a')),
  'managedBy lists the CEOs who run all its departments');
drop table cc_ov;

\echo '   who is refused everywhere: a Support-only CEO, a plain Department Head'
select test.login('lt_ceo_sup');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('name', 'CC Sup', 'departmentIds', jsonb_build_array(test.dept('whatsbox'))))$$, 'a Support-only CEO cannot create one', :'forbidden');
select test.cc_fails($$select croc_admin_overview()$$, 'nor read the overview', :'forbidden');
select test.cc_fails($$select croc_admin_connection((select id from cc where k = 'b'))$$, 'nor open a Whatsbox connection', :'forbidden');
select test.login('sh_head');
select test.cc_fails($$select croc_admin_overview()$$, 'a plain Department Head: no overview', :'forbidden');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('name', 'CC Head', 'departmentIds', jsonb_build_array(test.dept('wabastore'))))$$, 'no new connection', :'forbidden');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', false))$$, 'no change', :'forbidden');
select test.cc_fails($$select croc_admin_connection((select id from cc where k = 'a'))$$, 'no connection', :'forbidden');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', false)$$, 'no link', :'forbidden');
select test.cc_fails($$select croc_mapping_check((select id from cc where k = 'a'), 501, test.id('lt_wab_tm'), test.dept('wabastore'))$$, 'no mapping check', :'forbidden');
select test.cc_fails($$select croc_mapping_create((select id from cc where k = 'a'), 501, test.id('lt_wab_tm'), test.dept('wabastore'))$$, 'no mapping', :'forbidden');
select test.cc_fails($$select croc_mapping_approve((select id from cc where k = 'm1'))$$, 'no approval', :'forbidden');
select test.cc_fails($$select croc_mapping_revoke((select id from cc where k = 'm1'))$$, 'no revocation', :'forbidden');
select test.cc_fails($$select croc_mapping_count_from((select id from cc where k = 'm1'), null)$$, 'no count-from', :'forbidden');
select test.cc_fails($$select croc_status_mapping_tag_set((select id from cc where k = 'a'), 'hot', null)$$, 'no status mapping', :'forbidden');
select test.cc_fails($$select croc_lead_import_set((select id from cc where k = 'a'), test.dept('wabastore'), 'OFF')$$, 'no lead import', :'forbidden');
select test.cc_fails($$select croc_lead_links_list((select id from cc where k = 'a'))$$, 'no held leads', :'forbidden');
select test.cc_fails($$select croc_lead_link_resolve((select id from cc where k = 'a_link'), 'RETRY')$$, 'no resolution', :'forbidden');
select test.cc_fails($$select croc_reconcile_overview((select id from cc where k = 'a'))$$, 'no monitor', :'forbidden');
select test.cc_fails($$select croc_sync_request((select id from cc where k = 'a'))$$, 'no sync', :'forbidden');
select test.must_fail($$select croc_rollout_set(test.dept('wabastore'), 'SALES', false)$$, 'the rollout stays with the MD', 'FORBIDDEN');
select test.login('lt_ceo_a');
select test.must_fail($$select croc_rollout_set(test.dept('wabastore'), 'SALES', false)$$, 'even for a CEO', 'FORBIDDEN');

\echo '   the MD sees everything, with who manages each connection, and keeps the kill switch'
select test.login('sa');
create temp table cc_md as select croc_admin_overview() as o;
select test.check((select count(*) = 3 from cc_md, jsonb_array_elements(o -> 'connections') c where (c ->> 'id')::uuid in (select id from cc where k in ('mp', 'a', 'b'))),
  'the MD''s overview has every connection');
select test.check((select jsonb_array_length(o -> 'rollout') > 0 from cc_md), 'and the rollout table');
select test.check((select c -> 'managedBy' = '[]'::jsonb from cc_md, jsonb_array_elements(o -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'mp')),
  'M Pillar has no CEO: nobody but the MD manages it');
select test.check((select c -> 'managedBy' @> jsonb_build_array(jsonb_build_object('id', test.id('lt_ceo_a'), 'name', 'LT CEO A'))
                   from cc_md, jsonb_array_elements(o -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'a')),
  'the CEO''s connection shows that CEO in managedBy');
drop table cc_md;
select test.check(not (croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', false)) ->> 'enabled')::boolean,
  'the MD switches the CEO''s connection off');
reset role;
select test.check((select md_disabled_at is not null from crocodial_connections where id = (select id from cc where k = 'a')), 'which records that the MD did');
set role authenticated;
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true))$$,
  'the CEO cannot switch it back on (exact copy)', :'md_off');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A renamed')) ->> 'name') = 'CC A renamed',
  'but may still rename it (it stays off)');
select test.check((croc_admin_connection((select id from cc where k = 'a')) ->> 'mdDisabledAt') is not null, 'and sees that the MD switched it off');
select test.login('sa');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true)) ->> 'enabled')::boolean, 'the MD switches it on again');
reset role;
select test.check((select md_disabled_at is null from crocodial_connections where id = (select id from cc where k = 'a')), 'which clears the MD''s switch-off');
set role authenticated;
select test.login('lt_ceo_a');
select test.check(not (croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', false)) ->> 'enabled')::boolean, 'the CEO switches it off');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true)) ->> 'enabled')::boolean, 'and on again');
reset role;
select test.check((select md_disabled_at is null from crocodial_connections where id = (select id from cc where k = 'a')), 'a CEO''s own switch-off is not the MD''s');

\echo '   the same for a department link, and a withdrawn rollout'
set role authenticated;
select test.login('sa');
select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', false);
reset role;
select test.check((select md_disabled_at is not null from crocodial_department_links where connection_id = (select id from cc where k = 'a') and department_id = test.dept('wabastore')),
  'the MD switching a link off records it');
set role authenticated;
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', true)$$, 'the CEO cannot switch that link on', :'md_off');
select test.check(not (croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', false, 'PRODUCTION') ->> 'enabled')::boolean,
  'but may change its stage while it stays off');
select test.login('sa');
select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', true);
reset role;
select test.check((select md_disabled_at is null and enabled from crocodial_department_links where connection_id = (select id from cc where k = 'a') and department_id = test.dept('wabastore')),
  'the MD switching it on clears it');
set role authenticated;
select test.login('sa');
select croc_rollout_set(test.dept('whatsbox'), 'SALES', false);
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('whatsbox'), 'SALES', true)$$,
  'a rollout the MD withdrew is not allowed again by a CEO linking the department', :'md_off');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('name', 'CC A2', 'departmentIds', jsonb_build_array(test.dept('whatsbox'))))$$,
  'nor by a CEO creating a connection for it', :'md_off');
reset role;
select test.check((select not allowed from crocodial_rollout where department_id = test.dept('whatsbox') and division = 'SALES'), 'the rollout stays withdrawn');
select test.check(not exists (select 1 from crocodial_connections where name = 'CC A2'), 'and nothing was created');

\echo '   the credential name: optional, still unique when set'
select test.check((select is_nullable = 'YES' from information_schema.columns where table_name = 'crocodial_connections' and column_name = 'credential_ref'), 'credential_ref may be empty');
select test.check((select count(*) >= 2 from crocodial_connections where credential_ref is null and name like 'CC %'), 'several connections without one');
set role authenticated;
select test.login('sa');
select test.must_fail($$select croc_connection_save('{"name":"CC Dup","credentialRef":"CROCODIAL_TOKEN_CCTEST_MP"}'::jsonb)$$, 'a credential name is still used by one connection only', 'CONFLICT');
reset role;
select set_config('request.jwt.claims', '', false);
