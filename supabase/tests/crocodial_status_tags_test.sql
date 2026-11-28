-- =============================================================================
-- Crocodial statuses onto lead tags (migration 20270306000100): the old dispositions migrated to the seed tags exactly per the spec's
-- table, a mapping points to a tag (or Ignore) usable in every linked department, reconciliation sets the lead's tag (and through it
-- lead_status), a protected record and an ignored status change nothing, and a new department link resets the mappings whose tag is not
-- usable there (audited with the count). Runs after crocodial_lead_links_test.sql (uses cr_s1 and sa of the Crocodial suites).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Crocodial statuses onto lead tags'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites re-run older migrations (customers' triggers, the Crocodial functions); both of these are safe to run twice
\i supabase/migrations/20270305000100_lead_tags.sql
\i supabase/migrations/20270306000100_crocodial_status_tags.sql
\i supabase/migrations/20270306000100_crocodial_status_tags.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_STTEST%';
delete from customers where phone like '+9197711000%';
delete from lead_tag_departments where tag_id in (select id from lead_tags where label = 'CST Wabastore only');
delete from lead_tags where label = 'CST Wabastore only';
create temp table st (k text primary key, id uuid);
grant all on st to authenticated;
insert into lead_tags (label, colour, stage, scope) values ('CST Wabastore only', 'amber', 'INTERESTED', 'DEPARTMENTS');
insert into lead_tag_departments (tag_id, department_id) select id, test.dept('wabastore') from lead_tags where label = 'CST Wabastore only';
insert into st select 'wab', id from lead_tags where label = 'CST Wabastore only';
insert into st select 'demo', id from lead_tags where label = 'Demo done' and scope = 'COMPANY' and created_by is null;
insert into crocodial_connections (name, credential_ref, enabled, timezone) values
  ('ST M Pillar', 'CROCODIAL_TOKEN_STTEST_A', true, 'Asia/Kolkata'),
  ('ST Wabastore', 'CROCODIAL_TOKEN_STTEST_B', true, 'Asia/Kolkata'),
  ('ST Both', 'CROCODIAL_TOKEN_STTEST_C', true, 'Asia/Kolkata');
insert into st select 'a', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_STTEST_A';
insert into st select 'b', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_STTEST_B';
insert into st select 'c', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_STTEST_C';
insert into crocodial_rollout (department_id, division, allowed) values (test.dept('mpillar'), 'SALES', true) on conflict (department_id, division) do update set allowed = true;
insert into crocodial_department_links (connection_id, department_id, division, enabled, lead_import) values
  ((select id from st where k = 'a'), test.dept('mpillar'), 'SALES', true, 'IMPORT'),
  ((select id from st where k = 'b'), test.dept('wabastore'), 'SALES', true, 'OFF'),
  ((select id from st where k = 'c'), test.dept('wabastore'), 'SALES', true, 'OFF'),
  ((select id from st where k = 'c'), test.dept('mpillar'), 'SALES', true, 'OFF');
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from st where k = 'a'), 701, 'seller', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days');
-- a paying customer of M Pillar (past the lead stage)
insert into customers (owner_id, name, phone, lifecycle_stage, lead_source) values (test.id('cr_s1'), 'CST Paying', '+919771100009', 'CUSTOMER', 'Website');
insert into st select 'paying', id from customers where phone = '+919771100009';
create temp table st_paying as select lead_tag_id, lead_status, lifecycle_stage from customers where phone = '+919771100009';

\echo '   the old dispositions are migrated to the seed tags'
-- mappings as they were before this migration (no tag): running it again fills them in
insert into crocodial_status_mappings (connection_id, external_status, disposition)
select (select id from st where k = 'c'), 'old ' || lower(d), d
  from unnest(array['NEW', 'CONTACTED', 'FOLLOW_UP', 'NOT_INTERESTED', 'LOST', 'INTERESTED', 'DEMO_SCHEDULED', 'CONVERTED', 'IGNORE']) d;
\i supabase/migrations/20270306000100_crocodial_status_tags.sql
create temp table st_old as select s.disposition, s.ignored, t.label from crocodial_status_mappings s left join lead_tags t on t.id = s.tag_id where s.connection_id = (select id from st where k = 'c');
select test.check((select count(*) = 9 from st_old where (disposition, coalesce(label, '-'), ignored) in (
    ('NEW', 'New', false), ('CONTACTED', 'Contacted', false), ('FOLLOW_UP', 'Contacted', false), ('NOT_INTERESTED', 'Contacted', false), ('LOST', 'Contacted', false),
    ('INTERESTED', 'Interested', false), ('DEMO_SCHEDULED', 'Interested', false), ('CONVERTED', 'Ready to buy', false), ('IGNORE', '-', true))),
  'NEW -> New; CONTACTED, FOLLOW_UP, NOT_INTERESTED, LOST -> Contacted; INTERESTED, DEMO_SCHEDULED -> Interested; CONVERTED -> Ready to buy; IGNORE -> Ignore');
select test.check((select count(*) = 9 from st_old), 'and every old mapping is still there (the disposition stays readable)');
delete from crocodial_status_mappings where connection_id = (select id from st where k = 'c');

\echo '   who may map, and which tags'
set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_status_mapping_tag_set((select id from st where k = 'a'), 'Demo done', (select id from st where k = 'demo'))$$, 'only the Super Admin maps statuses', 'Super Admin');
select test.login('sa');
select test.must_fail($$select croc_status_mapping_tag_set((select id from st where k = 'c'), 'Hot', (select id from st where k = 'wab'))$$,
  'a Wabastore-only tag is refused for a connection also linked to M Pillar', 'VALIDATION_ERROR: That tag can''t be used in every department of this connection.');
select test.must_fail($$select croc_status_mapping_tag_set((select id from st where k = 'a'), 'Hot', (select id from st where k = 'demo'), true)$$, 'a tag and Ignore together are refused', 'VALIDATION_ERROR');
select test.must_fail($$select croc_status_mapping_tag_set((select id from st where k = 'a'), 'Hot', gen_random_uuid())$$, 'an unknown tag is refused', 'NOT_FOUND');
select test.check((select x ->> 'status' = 'demo done' and x ->> 'tagId' = (select id from st where k = 'demo')::text and not (x ->> 'ignored')::boolean
                     from (select croc_status_mapping_tag_set((select id from st where k = 'a'), ' Demo Done ', (select id from st where k = 'demo')) as x) s),
  'the Super Admin maps "demo done" to the Demo done tag (stored lower-cased)');
select test.check((croc_status_mapping_tag_set((select id from st where k = 'a'), 'Not now', null, true) ->> 'ignored')::boolean, 'and "not now" to Ignore');
select test.check((croc_status_mapping_tag_set((select id from st where k = 'b'), 'Hot', (select id from st where k = 'wab')) ->> 'tagId') = (select id from st where k = 'wab')::text,
  'a Wabastore-only tag is accepted for a connection linked to Wabastore only');
select croc_status_mapping_tag_set((select id from st where k = 'a'), 'Gone', (select id from st where k = 'demo'));
select croc_status_mapping_tag_set((select id from st where k = 'a'), 'Gone', null, false);
reset role;
select test.check((select count(*) = 0 from crocodial_status_mappings where connection_id = (select id from st where k = 'a') and external_status = 'gone'), 'no tag and no Ignore: the mapping is removed');
-- the old call (and API body) still works, translated with the same table
set role authenticated;
select test.login('sa');
select croc_status_mapping_set((select id from st where k = 'a'), 'Won', 'CONVERTED');
reset role;
select test.check((select t.label = 'Ready to buy' and s.disposition = 'CONVERTED' and not s.ignored from crocodial_status_mappings s join lead_tags t on t.id = s.tag_id
                    where s.connection_id = (select id from st where k = 'a') and s.external_status = 'won'), 'an old disposition (Converted) is stored as the Ready to buy tag');
select test.check((select count(*) >= 5 from audit_logs where action = 'CROCODIAL_STATUS_MAPPING_SET' and entity_id = (select id from st where k = 'a')), 'every mapping change is audited');

\echo '   reconciliation writes the tag'
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number, status, assigned_to_ext, external_updated_at)
select (select id from st where k = 'a'), x.id, x.name, x.phone, x.status, 701, now() - interval '1 hour'
  from (values (9101, 'CST Fresh', '+919771100001', 'Fresh'), (9102, 'CST Demo', '+919771100002', 'Demo done'), (9103, 'CST Paying', '+919771100009', 'Demo done')) as x(id, name, phone, status);
select test.check((select (x ->> 'created')::int = 2 from (select croc_reconcile((select id from st where k = 'a'), 200) as x) s), 'two new leads are created');
insert into st select 'fresh', customer_id from crocodial_crm_lead_links where connection_id = (select id from st where k = 'a') and external_lead_id = 9101;
insert into st select 'demolead', customer_id from crocodial_crm_lead_links where connection_id = (select id from st where k = 'a') and external_lead_id = 9102;
select test.check((select lead_tag_id = (select id from st where k = 'demo') and lead_status = 'INTERESTED' and lifecycle_stage = 'LEAD' from customers where id = (select id from st where k = 'demolead')),
  'a new lead with a mapped status gets that tag ("Demo done") and its stage (Interested)');
select test.check((select lead_tag_id = private.lead_tag_seed('NEW') and lead_status = 'NEW' from customers where id = (select id from st where k = 'fresh')),
  'a new lead with an unknown status gets the New tag');
set role authenticated;
select test.login('sa');
select test.check((select exists (select 1 from jsonb_array_elements(x -> 'unknownStatuses') u where u ->> 'status' = 'fresh')
                          and not exists (select 1 from jsonb_array_elements(x -> 'unknownStatuses') u where u ->> 'status' = 'demo done')
                     from (select croc_reconcile_overview((select id from st where k = 'a')) as x) s), 'and the unknown status is listed (a mapped one is not)');
reset role;
update crocodial_ext_leads set status = 'DEMO DONE', external_updated_at = now() + interval '1 minute' where connection_id = (select id from st where k = 'a') and external_id = 9101;
-- the protected record is looked at again through its existing link
update crocodial_ext_leads set status = 'Won', external_updated_at = now() + interval '1 minute' where connection_id = (select id from st where k = 'a') and external_id = 9103;
select croc_reconcile((select id from st where k = 'a'), 200);
select test.check((select lead_tag_id = (select id from st where k = 'demo') and lead_status = 'INTERESTED' and lifecycle_stage = 'LEAD' from customers where id = (select id from st where k = 'fresh')),
  'a reconciled LEAD whose status becomes "demo done" gets the Demo done tag and lead_status Interested');
select test.check((select k.status = 'PROTECTED' and c.lead_tag_id is not distinct from p.lead_tag_id and c.lead_status is not distinct from p.lead_status and c.lifecycle_stage = p.lifecycle_stage
                     from crocodial_crm_lead_links k join customers c on c.id = k.customer_id cross join st_paying p
                    where k.connection_id = (select id from st where k = 'a') and k.external_lead_id = 9103), 'a protected (past-LEAD) record is unchanged');

\echo '   an ignored status changes nothing'
update crocodial_ext_leads set status = 'Not now', external_updated_at = now() + interval '2 minutes' where connection_id = (select id from st where k = 'a') and external_id = 9101;
select croc_reconcile((select id from st where k = 'a'), 200);
select test.check((select lead_tag_id = (select id from st where k = 'demo') and lead_status = 'INTERESTED' from customers where id = (select id from st where k = 'fresh')), 'the lead keeps its tag and status');
select test.check((select reason is null from crocodial_crm_lead_links where connection_id = (select id from st where k = 'a') and external_lead_id = 9101), 'and an ignored status is not listed as unknown');

\echo '   the monitor'
set role authenticated;
select test.login('sa');
select test.check((select exists (select 1 from jsonb_array_elements(x -> 'mappings') m where m ->> 'status' = 'demo done' and m ->> 'tagId' = (select id from st where k = 'demo')::text and not (m ->> 'ignored')::boolean)
                          and exists (select 1 from jsonb_array_elements(x -> 'mappings') m where m ->> 'status' = 'not now' and (m ->> 'ignored')::boolean and m ->> 'tagId' is null)
                     from (select croc_reconcile_overview((select id from st where k = 'a')) as x) s), 'the mapping rows carry the tag and Ignore');

\echo '   a new department link resets mappings whose tag is not usable there'
reset role;
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number, status, assigned_to_ext, external_updated_at)
values ((select id from st where k = 'b'), 9201, 'CST Hot', '+919771100005', 'Hot', 701, now());
set role authenticated;
select test.login('sa');
select croc_status_mapping_tag_set((select id from st where k = 'b'), 'Demo done', (select id from st where k = 'demo'));
reset role;
select set_config('request.jwt.claims', '', false);
insert into crocodial_department_links (connection_id, department_id, division, enabled) values ((select id from st where k = 'b'), test.dept('mpillar'), 'SALES', true);
select test.check((select tag_id is null and not ignored from crocodial_status_mappings where connection_id = (select id from st where k = 'b') and external_status = 'hot'),
  'the Wabastore-only mapping is set back to not mapped');
select test.check((select tag_id = (select id from st where k = 'demo') from crocodial_status_mappings where connection_id = (select id from st where k = 'b') and external_status = 'demo done'),
  'a company-wide mapping is kept');
select test.check((select (metadata ->> 'reset')::int = 1 from audit_logs where action = 'CROCODIAL_STATUS_MAPPINGS_RESET' and entity_id = (select id from st where k = 'b') order by created_at desc limit 1),
  'the reset is audited with the count');
set role authenticated;
select test.login('sa');
select test.check((select exists (select 1 from jsonb_array_elements(x -> 'unknownStatuses') u where u ->> 'status' = 'hot')
                          and not exists (select 1 from jsonb_array_elements(x -> 'mappings') m where m ->> 'status' = 'hot')
                     from (select croc_reconcile_overview((select id from st where k = 'b')) as x) s), 'and the status is listed as unknown again');
reset role;
update crocodial_department_links set enabled = false where connection_id = (select id from st where k = 'b') and department_id = test.dept('mpillar');
select test.check((select count(*) = 1 from audit_logs where action = 'CROCODIAL_STATUS_MAPPINGS_RESET' and entity_id = (select id from st where k = 'b')), 'a change that resets nothing records nothing');

-- clean up
select set_config('request.jwt.claims', '', false);
delete from customers where phone like '+9197711000%';
delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_STTEST%';
delete from lead_tag_departments where tag_id in (select id from lead_tags where label = 'CST Wabastore only');
delete from lead_tags where label = 'CST Wabastore only';
