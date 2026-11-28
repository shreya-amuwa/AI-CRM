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
-- who can be chosen: croc_mapping_candidates (the CEO cannot read other departments' profiles through the users list)
create temp table cc_cand as select croc_mapping_candidates((select id from cc where k = 'a'), test.dept('wabastore')) as j;
select test.check((select jsonb_array_length(croc_mapping_candidates((select id from cc where k = 'a'), test.dept('whatsbox'))) > 0
                      and croc_mapping_candidates((select id from cc where k = 'a'), test.dept('whatsbox')) @> jsonb_build_array(jsonb_build_object('id', test.id('lt_wbx_tm')))),
  'and of its other linked department (Whatsbox, the CEO''s home department)');
reset role;
select test.check((select j @> jsonb_build_array(jsonb_build_object('id', test.id('lt_wab_tm'))) from cc_cand),
  'a CEO gets the candidates of a linked department they run outside their home department (the Wabastore Sales member)');
select test.check((select bool_and(p.department_id = test.dept('wabastore') and p.status = 'ACTIVE')
                     and bool_and((private.croc_profile_check(p.id, test.dept('wabastore'), 'SALES') ->> 'eligible')::boolean)
                   from cc_cand, jsonb_array_elements(j) x join profiles p on p.id = (x ->> 'id')::uuid),
  'only ACTIVE people of that department who can be mapped there (the same check as croc_mapping_create)');
select test.check((select not (j @> jsonb_build_array(jsonb_build_object('id', test.id('lt_wbx_tm')))) and not (j @> jsonb_build_array(jsonb_build_object('id', test.id('lt_dg_tm'))))
                   from cc_cand), 'never another department''s people');
drop table cc_cand;
set role authenticated;
select test.cc_fails($$select croc_mapping_candidates((select id from cc where k = 'a'), test.dept('digitree'))$$,
  'a department that is not linked (one the CEO does not run) is refused', 'VALIDATION_ERROR: Link this connection to the department''s Sales first.');
select test.login('lt_ceo_b');
select test.cc_fails($$select croc_mapping_candidates((select id from cc where k = 'a'), test.dept('whatsbox'))$$,
  'a CEO who does not manage the connection gets no candidates (exact copy)', :'forbidden');
select test.login('sh_head');
select test.cc_fails($$select croc_mapping_candidates((select id from cc where k = 'a'), test.dept('wabastore'))$$, 'nor a plain Department Head', :'forbidden');
select test.login('sa');
select test.check(jsonb_typeof(croc_mapping_candidates((select id from cc where k = 'a'), test.dept('wabastore'))) = 'array', 'the MD gets the candidates on any connection');
select test.login('lt_ceo_a');
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

\echo '   the MD''s kill switch also blocks a connection or link that is already off'
set role authenticated;
select test.login('sa');
select croc_rollout_set(test.dept('whatsbox'), 'SALES', true);
select test.login('lt_ceo_a');
select test.check(not (croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', false)) ->> 'enabled')::boolean, 'the CEO switches their connection off');
select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', false);
select test.login('sa');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', false)) ->> 'mdDisabledAt') is not null,
  'the MD saving it off while it is already off records the MD''s switch-off');
select test.check((croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', false) ->> 'mdDisabledAt') is not null,
  'and the same for a link that is already off');
reset role;
create temp table cc_md_at as select md_disabled_at as t from crocodial_connections where id = (select id from cc where k = 'a');
set role authenticated;
select croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', false));
reset role;
select test.check((select md_disabled_at from crocodial_connections where id = (select id from cc where k = 'a')) = (select t from cc_md_at), 'saving it off again keeps the first time');
set role authenticated;
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A')) ->> 'mdDisabledAt') is not null, 'a rename by the MD (no enabled) leaves it');
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true))$$, 'so the CEO cannot switch it on', :'md_off');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', true)$$, 'nor the link', :'md_off');
select test.login('sa');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true)) ->> 'mdDisabledAt') is null, 'the MD switching it on clears it');
select test.check((croc_department_link_save((select id from cc where k = 'a'), test.dept('wabastore'), 'SALES', true) ->> 'mdDisabledAt') is null, 'and the link''s');

\echo '   the write paths lock the connection before checking the manager (two CEOs adding links at once)'
reset role;
drop table cc_md_at;
select test.check((select bool_and(position('for update' in p.prosrc) > 0 and position('for update' in p.prosrc) < position('require_manager' in p.prosrc))
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('croc_department_link_save', 'croc_connection_save', 'croc_token_store', 'croc_token_clear')),
  'croc_department_link_save, croc_connection_save, croc_token_store and croc_token_clear lock the connection row first');
select test.check((select count(*) = 4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname in ('croc_department_link_save', 'croc_connection_save', 'croc_token_store', 'croc_token_clear')), '(all four exist)');

\echo '   stored keys (Task 8): the service role stores them; the plain key never reaches the database'
\set fp_a '''aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'''
\set fp_b '''bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'''
\set cipher_a '''v1:aXZhaXZhaXZh:dGFndGFndGFn:Y2lwaGVyLWEtc2VhbGVk'''
select test.check(not has_function_privilege('authenticated', 'public.croc_token_store(uuid, text, text, text, uuid)', 'execute')
              and not has_function_privilege('anon', 'public.croc_token_store(uuid, text, text, text, uuid)', 'execute')
              and has_function_privilege('service_role', 'public.croc_token_store(uuid, text, text, text, uuid)', 'execute'),
  'croc_token_store is not executable by authenticated (service role only)');
select test.check(not has_function_privilege('authenticated', 'public.croc_token_clear(uuid, uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.croc_token_ciphertext(uuid)', 'execute')
              and not has_function_privilege('authenticated', 'public.croc_sync_due(interval, uuid)', 'execute'),
  'nor croc_token_clear, croc_token_ciphertext or croc_sync_due');
select test.check(has_function_privilege('authenticated', 'public.croc_can_manage_check(uuid)', 'execute'), 'croc_can_manage_check is (the server checks as the user)');
select test.check(not has_table_privilege('authenticated', 'public.crocodial_connections', 'select'), 'and nobody signed in reads the table itself');
select test.check((select count(*) = 5 from information_schema.columns where table_name = 'crocodial_connections'
                    and column_name in ('token_ciphertext', 'token_fingerprint', 'token_last4', 'token_set_by', 'token_set_at')), 'the five token columns exist');
set role authenticated;
select test.login('lt_ceo_a');
select test.must_fail($$select croc_token_store((select id from cc where k = 'a'), 'v1:x:y:z', repeat('c', 64), 'zzzz', test.id('lt_ceo_a'))$$, 'a signed-in CEO cannot call croc_token_store', 'permission denied');
select croc_can_manage_check((select id from cc where k = 'a'));
select test.login('lt_ceo_b');
select test.cc_fails($$select croc_can_manage_check((select id from cc where k = 'a'))$$, 'croc_can_manage_check refuses a CEO who does not manage it (exact copy)', :'forbidden');
select test.login('sh_head');
select test.cc_fails($$select croc_can_manage_check((select id from cc where k = 'b'))$$, 'and a plain Department Head', :'forbidden');
reset role;
select set_config('request.jwt.claims', '', false);
grant all on cc, cc_t0 to service_role;
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
set role service_role;
create temp table cc_store as select croc_token_store((select id from cc where k = 'a'), :cipher_a, :fp_a, '1a2b', test.id('lt_ceo_a')) as j;
select test.check((select j ->> 'keySource' = 'DATABASE' and j ->> 'keyLast4' = '1a2b' from cc_store), 'stored: keySource DATABASE and the last 4');
select test.check((select position('v1:aXZh' in j::text) = 0 and position('aaaaaaaa' in j::text) = 0 from cc_store), 'the answer has no ciphertext or fingerprint');
select test.cc_fails(format($$select croc_token_store(%L, 'v1:x:y:z', repeat('d', 64), 'dddd', %L)$$, (select id from cc where k = 'a'), test.id('lt_ceo_b')),
  'an actor who does not manage the connection is refused (exact copy)', :'forbidden');
select test.cc_fails(format($$select croc_token_store(%L, 'v1:x:y:z', %L, '1a2b', %L)$$, (select id from cc where k = 'b'), :fp_a, test.id('lt_ceo_a')),
  'the same key on a second connection: CONFLICT (exact copy)', 'CONFLICT: This Crocodial account is already connected (by another department).');
select test.must_fail(format($$select croc_token_store(%L, 'plain-key-here', repeat('e', 64), 'here', %L)$$, (select id from cc where k = 'b'), test.id('lt_ceo_a')),
  'a value that is not a v1: ciphertext is refused (never a plain key)', 'VALIDATION_ERROR');
select test.must_fail(format($$select croc_token_store(%L, 'v1:x:y:z', 'not-a-fingerprint', 'zzzz', %L)$$, (select id from cc where k = 'b'), test.id('lt_ceo_a')),
  'and so is a malformed fingerprint', 'VALIDATION_ERROR');
select test.check((croc_token_store((select id from cc where k = 'a'), :cipher_a, :fp_a, '1a2b', test.id('lt_ceo_a')) ->> 'keyLast4') = '1a2b', 'the same key again on its own connection (replace) is fine');
select test.check((croc_token_store((select id from cc where k = 'mp'), 'v1:bXA=:bXA=:bXA=', :fp_b, '9z9z', test.id('sa')) ->> 'keySource') = 'DATABASE', 'the MD stores a key on any connection');
select test.check((select position('v1:' in coalesce(croc_token_ciphertext((select id from cc where k = 'a')), '')) = 1), 'croc_token_ciphertext gives the server the ciphertext');
select test.check((select d ->> 'tokenCiphertext' = 'v1:aXZhaXZhaXZh:dGFndGFndGFn:Y2lwaGVyLWEtc2VhbGVk' from jsonb_array_elements(croc_sync_due('1 minute', (select id from cc where k = 'a'))) d),
  'croc_sync_due returns tokenCiphertext');
select croc_connection_status((select id from cc where k = 'a'), 'KEY_UNREADABLE', null);
reset role;
select test.check((select health = 'KEY_UNREADABLE' and token_set_by = test.id('lt_ceo_a') and token_set_at is not null and token_last4 = '1a2b'
                     from crocodial_connections where id = (select id from cc where k = 'a')), 'health KEY_UNREADABLE is accepted; who set the key and when are kept');
select test.check((select count(*) >= 2 and bool_and(actor_id = test.id('lt_ceo_a')) and bool_and(metadata ->> 'last4' = '1a2b')
                     from audit_logs where action = 'CROCODIAL_KEY_SET' and entity_id = (select id from cc where k = 'a')), 'CROCODIAL_KEY_SET is audited as the actor, with the last 4 only');
select test.check(not exists (select 1 from audit_logs where created_at >= (select t from cc_t0)
                               and (metadata::text like '%v1:aXZh%' or metadata::text like '%aaaaaaaaaaaaaaaa%' or metadata::text like '%v1:bXA=%' or metadata::text like '%bbbbbbbbbbbbbbbb%')),
  'no audit row contains a ciphertext or a fingerprint');
set role authenticated;
select test.login('lt_ceo_a');
create temp table cc_ov2 as select croc_admin_overview() as o;
select test.check((select c ->> 'keySource' = 'DATABASE' and c ->> 'keyLast4' = '1a2b' and c ->> 'health' = 'KEY_UNREADABLE'
                     from cc_ov2, jsonb_array_elements(o -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'a')), 'the CEO''s overview shows keySource and keyLast4');
select test.check((select position('v1:aXZh' in o::text) = 0 and position('aaaaaaaaaaaaaaaa' in o::text) = 0 from cc_ov2), 'and never the ciphertext or the fingerprint');
select test.check((select c ->> 'keySource' = 'NONE' and c -> 'keyLast4' = 'null'::jsonb from cc_ov2, jsonb_array_elements(o -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'b')),
  'a connection without a key: NONE');
select test.check((croc_admin_connection((select id from cc where k = 'a')) ->> 'keySource') = 'DATABASE', 'croc_admin_connection has keySource too');
drop table cc_ov2;
select test.login('sa');
select test.check((select c ->> 'keySource' = 'DATABASE' from jsonb_array_elements(croc_admin_overview() -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'mp')),
  'a stored key comes before the server setting (M Pillar: DATABASE)');
reset role;
update crocodial_connections set token_ciphertext = null, token_fingerprint = null, token_last4 = null where id = (select id from cc where k = 'mp');
set role authenticated;
select test.login('sa');
select test.check((select c ->> 'keySource' = 'SERVER_SETTING' from jsonb_array_elements(croc_admin_overview() -> 'connections') c where (c ->> 'id')::uuid = (select id from cc where k = 'mp')),
  'and without one: SERVER_SETTING');
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.cc_fails(format($$select croc_token_clear(%L, %L)$$, (select id from cc where k = 'a'), test.id('lt_ceo_b')), 'removing: an actor who does not manage it is refused', :'forbidden');
select test.check((select j ->> 'keySource' = 'NONE' and not (j ->> 'enabled')::boolean from (select croc_token_clear((select id from cc where k = 'a'), test.id('lt_ceo_a')) j) x),
  'removing the key clears it and switches the connection off');
reset role;
select test.check((select token_ciphertext is null and token_fingerprint is null and token_last4 is null and not enabled and md_disabled_at is null
                     from crocodial_connections where id = (select id from cc where k = 'a')), 'nothing of the key is left (and the switch-off is the CEO''s, not the MD''s)');
select test.check((select count(*) = 1 from audit_logs where action = 'CROCODIAL_KEY_REMOVED' and entity_id = (select id from cc where k = 'a') and actor_id = test.id('lt_ceo_a')),
  'CROCODIAL_KEY_REMOVED is audited');
set role service_role;
select test.check((croc_token_store((select id from cc where k = 'b'), 'v1:x:y:z', :fp_a, '1a2b', test.id('lt_ceo_a')) ->> 'keySource') = 'DATABASE', 'once removed, the account can be connected elsewhere');
reset role;
drop table cc_store;
reset role;
select set_config('request.jwt.claims', '', false);

\echo '   the MD''s switch-off is a real stop for every connection serving that department (no way around it)'
\set fp_c '''cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'''
set role authenticated;
-- a spare connection of the CEO for Whatsbox only (before the MD's stop)
select test.login('lt_ceo_a');
insert into cc select 'spare', (croc_connection_save(jsonb_build_object('name', 'CC Spare', 'departmentIds', jsonb_build_array(test.dept('whatsbox')))) ->> 'id')::uuid;
-- the MD switches off the Whatsbox + Wabastore connection (it has the CEO's stored key)
select test.login('sa');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'b'), 'name', 'CC B', 'enabled', false)) ->> 'mdDisabledAt') is not null,
  'the MD switches off the connection that holds the key');
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.cc_fails(format($$select croc_token_clear(%L, %L)$$, (select id from cc where k = 'b'), test.id('lt_ceo_a')),
  'the CEO cannot Disconnect it (which would free the key for a new connection)', :'md_off');
select test.cc_fails(format($$select croc_token_store(%L, 'v1:x:y:z', %L, 'cccc', %L)$$, (select id from cc where k = 'b'), :fp_c, test.id('lt_ceo_a')),
  'nor change its key', :'md_off');
reset role;
select test.check((select token_fingerprint = :fp_a and token_last4 = '1a2b' from crocodial_connections where id = (select id from cc where k = 'b')), 'its key is untouched');
set role authenticated;
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('name', 'CC Around', 'departmentIds', jsonb_build_array(test.dept('wabastore'))))$$,
  'the CEO cannot create a new connection for a department it serves', :'md_off');
reset role;
select test.check(not exists (select 1 from crocodial_connections where name = 'CC Around'), 'nothing was created');
set role authenticated;
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'spare'), test.dept('wabastore'), 'SALES', false)$$,
  'nor add a link for that department to another connection', :'md_off');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'spare'), test.dept('whatsbox'), 'SALES', true)$$,
  'nor switch on another connection''s link for that department', :'md_off');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true))$$,
  'nor switch on another connection that serves it', :'md_off');
select test.check(not (croc_department_link_save((select id from cc where k = 'spare'), test.dept('whatsbox'), 'SALES', false, 'PRODUCTION') ->> 'enabled')::boolean,
  'changing a link that stays off is still fine');
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.check((croc_token_store((select id from cc where k = 'spare'), 'v1:x:y:z', :fp_c, 'cccc', test.id('lt_ceo_a')) ->> 'keyLast4') = 'cccc',
  'a key on a connection the MD did not switch off can still be saved (it stays off)');
select test.check((croc_token_clear((select id from cc where k = 'b'), test.id('sa')) ->> 'keySource') = 'NONE', 'the MD may still Disconnect the switched-off connection');
reset role;
select test.check((select md_disabled_at is not null from crocodial_connections where id = (select id from cc where k = 'b')), 'which stays switched off by the MD');
set role authenticated;
select test.login('sa');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'b'), 'name', 'CC B', 'enabled', true)) ->> 'mdDisabledAt') is null,
  'the MD switches it back on');
select test.login('lt_ceo_a');
select test.check((croc_department_link_save((select id from cc where k = 'spare'), test.dept('wabastore'), 'SALES', false) ->> 'departmentId')::uuid = test.dept('wabastore'),
  'which lifts the stop: the CEO may add the link again');
select test.check((croc_connection_save(jsonb_build_object('id', (select id from cc where k = 'a'), 'name', 'CC A', 'enabled', true)) ->> 'enabled')::boolean,
  'and switch on another connection serving those departments');
\echo '   the same for a link the MD switched off'
select test.login('sa');
select croc_department_link_save((select id from cc where k = 'b'), test.dept('whatsbox'), 'SALES', false);
select test.login('lt_ceo_a');
select test.cc_fails($$select croc_connection_save(jsonb_build_object('name', 'CC Around 2', 'departmentIds', jsonb_build_array(test.dept('whatsbox'))))$$,
  'a link the MD switched off: no new connection for that department', :'md_off');
select test.cc_fails($$select croc_department_link_save((select id from cc where k = 'spare'), test.dept('whatsbox'), 'SALES', true)$$,
  'nor switching on another connection''s link for it', :'md_off');
select test.check((croc_connection_save(jsonb_build_object('name', 'CC Wab only', 'departmentIds', jsonb_build_array(test.dept('wabastore')))) ->> 'id') is not null,
  'a department the MD did not stop is not affected');
select test.login('sa');
select test.check((croc_department_link_save((select id from cc where k = 'b'), test.dept('whatsbox'), 'SALES', true) ->> 'mdDisabledAt') is null,
  'the MD switches the link back on');
select test.login('lt_ceo_a');
select test.check((croc_department_link_save((select id from cc where k = 'spare'), test.dept('whatsbox'), 'SALES', true) ->> 'enabled')::boolean,
  'which lifts the stop: the CEO may switch the other link on');
reset role;
select set_config('request.jwt.claims', '', false);
