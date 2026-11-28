-- =============================================================================
-- Crocodial -> CRM lead pipeline (migration 20270304000100): the import switch (Off / Preview / Import), owner from the approved mapping only,
-- matching inside the department (create / link / protected / ambiguous / owner conflict), no duplicates on repeated runs, isolation per
-- connection, external reassignment, CRM overrides kept, status mapping (unknown statuses change nothing, "converted" never skips Accounts),
-- no welcome WhatsApp for imports, nothing deleted when Crocodial drops a lead, the lead page's activity (calls by the real caller) and who may
-- read it, the Super Admin's monitor and resolutions. Runs at the end (uses cr_s1, cr_s2, cr_s3, cr_sup, cr_tl1, sa of the Crocodial suites).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Crocodial lead pipeline'
reset role;
\i supabase/migrations/20270304000100_crocodial_crm_lead_links.sql
\i supabase/migrations/20270304000100_crocodial_crm_lead_links.sql
-- the newer migrations that redefine its functions (lead tags, statuses onto tags), so these checks run against the current code
\i supabase/migrations/20270305000100_lead_tags.sql
\i supabase/migrations/20270306000100_crocodial_status_tags.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_LLTEST%';
delete from customers where phone like '%97700000%' or name = 'Paying Customer';
create temp table ll (k text primary key, id uuid);
grant all on ll to authenticated;
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('LL', 'CROCODIAL_TOKEN_LLTEST', true, 'Asia/Kolkata'), ('LL two', 'CROCODIAL_TOKEN_LLTEST_B', true, 'Asia/Kolkata');
insert into ll select 'c1', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_LLTEST';
insert into ll select 'c2', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_LLTEST_B';
insert into crocodial_rollout (department_id, division, allowed) values (test.dept('mpillar'), 'SALES', true) on conflict (department_id, division) do update set allowed = true;
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from ll where k in ('c1', 'c2');
-- 501 = cr_s1, 502 = cr_s2, 503 = cr_s3 on account one; 501 on account two is cr_s2 (the same number, another person); 599 has no mapping
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from ll where k = 'c1'), 501, 'one', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days'),
       ((select id from ll where k = 'c1'), 502, 'two', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days'),
       ((select id from ll where k = 'c1'), 503, 'three', test.id('cr_s3'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days'),
       ((select id from ll where k = 'c2'), 501, 'other two', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days');
insert into crocodial_ext_employees (connection_id, external_id, name) select id, 599, 'Nobody Mapped' from ll where k = 'c1';
-- the welcome WhatsApp is switched on, so a lead that WOULD get it is detectable
update lead_whatsapp_settings set enabled = true where id;
-- existing CRM records of M Pillar
insert into customers (owner_id, name, phone, lifecycle_stage, lead_status, call_status, lead_source) values
  (test.id('cr_s1'), 'Existing Same Owner', '+919770000003', 'LEAD', 'NEW', 'PENDING', 'Website'),
  (test.id('cr_s3'), 'Other Owner Lead', '+919770000006', 'LEAD', 'NEW', 'PENDING', 'Website'),
  (test.id('cr_s3'), 'Twin One', '+919770000005', 'LEAD', 'NEW', 'PENDING', 'Website'),
  (test.id('cr_s3'), 'Twin Two', '09770000005', 'LEAD', 'NEW', 'PENDING', 'Website');
insert into customers (owner_id, name, phone, lifecycle_stage, lead_source) values (test.id('cr_s1'), 'Paying Customer', '+919770000004', 'CUSTOMER', 'Website');
delete from lead_whatsapp_dispatches where customer_id in (select id from customers where phone like '%97700000%');
-- Crocodial's leads (as stored by the sync)
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number, company, status, assigned_to_ext, created_by_ext, external_updated_at, next_followup_at, email)
select (select id from ll where k = 'c1'), x.id, x.name, x.phone, 'Co ' || x.id, x.status, x.owner, 599, now() - interval '1 hour', null, null
  from (values (9001, 'New Lead', '+919770000001', 'Fresh', 501), (9002, 'Unmapped Lead', '+919770000002', 'Fresh', 599),
               (9003, 'Matches Lead', '9770000003', 'Fresh', 501), (9004, 'Matches Customer', '+91 97700 00004', 'Won', 501),
               (9005, 'Matches Twins', '+919770000005', 'Fresh', 501), (9006, 'Matches Other Owner', '+919770000006', 'Fresh', 501)) as x(id, name, phone, status, owner);
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number, status, assigned_to_ext, external_updated_at)
select id, 9001, 'Same Number Other Account', '+919770000011', 'Fresh', 501, now() - interval '1 hour' from ll where k = 'c2';
create temp table ll_count as select count(*) n from customers;
grant select on ll_count to authenticated;

\echo '   off: nothing happens'
select test.check((croc_reconcile((select id from ll where k = 'c1'), 200) ->> 'enabled')::boolean = false, 'with lead import off, reconciliation does nothing');
select test.check((select count(*) = 0 from crocodial_crm_lead_links where connection_id = (select id from ll where k = 'c1')), 'and records nothing');
set role authenticated;
select test.login('cr_s1');
select test.must_fail($$select croc_lead_import_set((select id from ll where k = 'c1'), test.dept('mpillar'), 'IMPORT')$$, 'only the Super Admin switches lead import', 'Super Admin');
select test.must_fail($$select croc_reconcile((select id from ll where k = 'c1'), 10)$$, 'and nobody signed in runs reconciliation directly', 'permission denied');
select test.login('sa');
select croc_lead_import_set((select id from ll where k = 'c1'), test.dept('mpillar'), 'PREVIEW');
reset role;

\echo '   preview: what would happen, no CRM change'
select test.check((croc_reconcile((select id from ll where k = 'c1'), 200) ->> 'processed')::int = 6, 'the preview looks at the six leads');
create temp table ll_s as select external_lead_id e, status, customer_id, reason from crocodial_crm_lead_links where connection_id = (select id from ll where k = 'c1');
select test.check((select status from ll_s where e = 9001) = 'PENDING_CREATE', 'a new lead: would be created');
select test.check((select status from ll_s where e = 9002) = 'UNMAPPED_ASSIGNEE', 'an assignee without an approved mapping is held (never given to someone else)');
select test.check((select status from ll_s where e = 9003) = 'PENDING_LINK', 'same phone (last 10 digits), same owner, still a lead: would be linked');
select test.check((select status from ll_s where e = 9004) = 'PROTECTED', 'same phone as a paying customer: protected');
select test.check((select status from ll_s where e = 9005) = 'AMBIGUOUS', 'two CRM records with that phone: ambiguous');
select test.check((select status from ll_s where e = 9006) = 'OWNER_CONFLICT', 'a lead with that phone owned by someone else: owner conflict');
select test.check((select count(*) from customers) = (select n from ll_count) and (select bool_and(customer_id is null) from ll_s), 'the preview changed and linked nothing');

\echo '   import'
set role authenticated;
select test.login('sa');
select croc_lead_import_set((select id from ll where k = 'c1'), test.dept('mpillar'), 'IMPORT');
select croc_status_mapping_set((select id from ll where k = 'c1'), 'Won', 'CONVERTED');
reset role;
select test.check((select (x ->> 'created')::int = 1 from (select croc_reconcile((select id from ll where k = 'c1'), 200) as x) s), 'import: one lead is created');
create temp table ll_i as select k.external_lead_id e, k.status, k.customer_id, k.import_source, k.assignment_mode from crocodial_crm_lead_links k where k.connection_id = (select id from ll where k = 'c1');
grant select on ll_i to authenticated;
select test.check((select c.owner_id = test.id('cr_s1') and c.department_id = test.dept('mpillar') and c.lifecycle_stage = 'LEAD' and c.lead_source = 'Crocodial' and c.name = 'New Lead'
                     from ll_i join customers c on c.id = ll_i.customer_id where e = 9001), 'the new lead belongs to the mapped person, in their department, from Crocodial');
select test.check((select count(*) = 1 from customer_activities a join ll_i on a.customer_id = ll_i.customer_id where e = 9001 and a.type = 'CROCODIAL_IMPORTED'), 'and says it was imported');
select test.check((select count(*) = 0 from lead_whatsapp_dispatches d join ll_i on d.customer_id = ll_i.customer_id), 'no welcome WhatsApp is queued for an imported lead');
select test.check((select status = 'LINKED' and import_source = 'MATCHED' and customer_id = (select id from customers where name = 'Existing Same Owner') from ll_i where e = 9003), 'the matching lead of the same owner is linked, not duplicated');
select test.check((select status = 'PROTECTED' and customer_id = (select id from customers where name = 'Paying Customer') from ll_i where e = 9004), 'the paying customer is linked for reference only');
select test.check((select lifecycle_stage = 'CUSTOMER' and owner_id = test.id('cr_s1') from customers where name = 'Paying Customer'), 'and stays a customer with its owner (never downgraded)');
select test.check((select customer_id is null from ll_i where e in (9002)) and (select customer_id is null from ll_i where e = 9005) and (select customer_id is null from ll_i where e = 9006), 'held leads create nothing');
select test.check((select count(*) from customers) = (select n from ll_count) + 1, 'exactly one CRM record was added');
select croc_reconcile((select id from ll where k = 'c1'), 200);
select croc_reconcile((select id from ll where k = 'c1'), 200);
select test.check((select count(*) from customers) = (select n from ll_count) + 1 and (select count(*) = 6 from crocodial_crm_lead_links where connection_id = (select id from ll where k = 'c1')),
  'running again (and again) creates no duplicate customer or link');

\echo '   another account with the same external ids'
set role authenticated;
select test.login('sa');
select croc_lead_import_set((select id from ll where k = 'c2'), test.dept('mpillar'), 'IMPORT');
reset role;
select croc_reconcile((select id from ll where k = 'c2'), 200);
select test.check((select c.owner_id = test.id('cr_s2') and c.name = 'Same Number Other Account' from crocodial_crm_lead_links k join customers c on c.id = k.customer_id
                    where k.connection_id = (select id from ll where k = 'c2') and k.external_lead_id = 9001),
  'lead 9001 of the second account is its own lead, owned by that account''s mapping of user 501');
select test.check((select c.name = 'New Lead' from crocodial_crm_lead_links k join customers c on c.id = k.customer_id where k.connection_id = (select id from ll where k = 'c1') and k.external_lead_id = 9001),
  'and the first account''s lead 9001 is untouched');

\echo '   reassignment, CRM overrides, statuses'
update crocodial_ext_leads set assigned_to_ext = 502, status = 'Won', external_updated_at = now() where connection_id = (select id from ll where k = 'c1') and external_id = 9001;
select croc_reconcile((select id from ll where k = 'c1'), 200);
select test.check((select c.owner_id = test.id('cr_s2') from ll_i join customers c on c.id = ll_i.customer_id where e = 9001), 'reassigned in Crocodial: the imported lead follows');
select test.check((select count(*) = 0 from lead_whatsapp_dispatches d join ll_i on d.customer_id = ll_i.customer_id), 'still no welcome WhatsApp');
select test.check((select count(*) = 2 from crocodial_lead_owner_history where connection_id = (select id from ll where k = 'c1') and external_lead_id = 9001), 'the ownership change is recorded as observed');
select test.check((select c.lifecycle_stage = 'LEAD' and c.lead_status = 'READY_TO_BUY' from ll_i join customers c on c.id = ll_i.customer_id where e = 9001),
  '"Won" mapped to Converted: ready to buy, still a lead (Accounts verification is not skipped)');
-- a Team Lead (CRM) moves the lead to someone else: the CRM keeps it
update customers set owner_id = test.id('cr_s3') where id = (select customer_id from ll_i where e = 9001);
update crocodial_ext_leads set status = 'Fresh', external_updated_at = now() + interval '1 second' where connection_id = (select id from ll where k = 'c1') and external_id = 9001;
select croc_reconcile((select id from ll where k = 'c1'), 200);
select test.check((select c.owner_id = test.id('cr_s3') and k.assignment_mode = 'CRM_OVERRIDE' from crocodial_crm_lead_links k join customers c on c.id = k.customer_id
                    where k.connection_id = (select id from ll where k = 'c1') and k.external_lead_id = 9001), 'a CRM assignment is never undone by the next sync (CRM override)');
select test.check((select k.reason like 'Owner changed in the CRM%' from crocodial_crm_lead_links k where k.connection_id = (select id from ll where k = 'c1') and k.external_lead_id = 9001), 'the difference is shown');
select test.check((select c.lead_status = 'READY_TO_BUY' from ll_i join customers c on c.id = ll_i.customer_id where e = 9001), 'an unknown status ("Fresh") changes no CRM status');
update crocodial_ext_leads set status = 'Won', external_updated_at = now() - interval '3 days' where connection_id = (select id from ll where k = 'c1') and external_id = 9003;
select croc_reconcile((select id from ll where k = 'c1'), 200);
select test.check((select c.lead_status = 'NEW' from customers c where c.name = 'Existing Same Owner'), 'an older Crocodial change does not overwrite a newer CRM edit');

\echo '   deletions at the source'
update crocodial_ext_leads set missing_since = now() where connection_id = (select id from ll where k = 'c1') and external_id = 9001;
select croc_reconcile((select id from ll where k = 'c1'), 200);
select test.check((select count(*) = 1 from customers where id = (select customer_id from ll_i where e = 9001)), 'a lead Crocodial no longer returns is never deleted in the CRM');

\echo '   the lead page'
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, lead_ext, phone_number, call_type, call_at, duration_seconds, connected)
values ((select id from ll where k = 'c1'), 77001, 503, 9001, '+919770000001', 'outgoing', now() - interval '2 hours', 120, true),
       ((select id from ll where k = 'c1'), 77002, 501, 9001, '+919770000001', 'incoming', now() - interval '1 hours', 30, true);
insert into crocodial_ext_remarks (connection_id, external_id, written_by_ext, lead_ext, remark, external_created_at)
values ((select id from ll where k = 'c1'), 88001, 502, 9001, 'Asked for a demo', now() - interval '1 hour');
set role authenticated;
select test.login('cr_s3');
select test.check((select (x ->> 'linked')::boolean and (x -> 'calls' ->> 'total')::int = 2 and (x -> 'calls' ->> 'outgoing')::int = 1 and (x -> 'calls' ->> 'incoming')::int = 1
                          and (x -> 'calls' ->> 'talkSeconds')::int = 150
                          and exists (select 1 from jsonb_array_elements(x -> 'callHistory') h where h ->> 'type' = 'outgoing' and h ->> 'by' = 'CR Other Seller')
                          and exists (select 1 from jsonb_array_elements(x -> 'callHistory') h where h ->> 'type' = 'incoming' and h ->> 'by' = 'CR Sachin')
                          and x -> 'remarks' -> 0 ->> 'by' = 'CR Supriya' and (x ->> 'ownershipDiffers')::boolean and (x ->> 'missingAtSource')::boolean
                     from (select croc_lead_activity((select customer_id from ll_i where e = 9001)) as x) s),
  'the lead''s owner sees its Crocodial calls (each credited to the real caller), remarks, the ownership difference and the missing flag');
select test.login('cr_sup');
select test.must_fail($$select croc_lead_activity((select customer_id from ll_i where e = 9001))$$, 'a Support member cannot read it', 'not found');
select test.login('cr_s1');
select test.must_fail($$select croc_lead_activity((select id from customers where name = 'Twin Two'))$$, 'nor can a seller read another seller''s lead', 'not found');
select test.login('cr_s3');
select test.check((croc_lead_activity((select id from customers where name = 'Twin Two')) ->> 'linked')::boolean = false, 'a lead that is not linked says so');

\echo '   managers: lead ownership now (each lead once)'
select test.login('cr_tl1');
select test.check((select (x -> 'totals' ->> 'assigned')::int >= 1 and not exists (select 1 from jsonb_array_elements(x -> 'people') p where p ->> 'profileId' = test.id('cr_s2')::text)
                     from (select croc_team_leads() as x) s), 'a Team Lead sees the leads of their own team only (not another Team Lead''s member)');
select test.login('cr_sup');
select test.check((select (x ->> 'connectedEmployees')::int = 0 from (select croc_team_leads() as x) s), 'a Support member sees nobody');
select test.login('sa');
select test.check((select (x -> 'totals' ->> 'assigned')::int = (select sum((p ->> 'assigned')::int) from jsonb_array_elements(x -> 'people') p)
                          and exists (select 1 from jsonb_array_elements(x -> 'statuses') st where st ->> 'status' = 'Won' and st ->> 'disposition' = 'CONVERTED')
                     from (select croc_team_leads(test.dept('mpillar')) as x) s), 'the total is the sum of the people (no lead counted twice), with the status breakdown');
select test.login('cr_s3');

\echo '   the Super Admin: monitor and resolution'
reset role;
insert into ll select 'l5', id from crocodial_crm_lead_links where external_lead_id = 9005 and connection_id = (select id from ll where k = 'c1');
insert into ll select 'l6', id from crocodial_crm_lead_links where external_lead_id = 9006 and connection_id = (select id from ll where k = 'c1');
insert into ll select 'paying', id from customers where name = 'Paying Customer';
insert into ll select 'twin1', id from customers where name = 'Twin One';
set role authenticated;
select test.login('cr_s3');
select test.must_fail($$select croc_reconcile_overview((select id from ll where k = 'c1'))$$, 'only the Super Admin sees the monitor', 'Super Admin');
select test.login('sa');
select test.check((select (x -> 'counts' ->> 'AMBIGUOUS')::int = 1 and (x -> 'counts' ->> 'UNMAPPED_ASSIGNEE')::int = 1 and (x ->> 'ownershipDiffers')::int = 1
                          and exists (select 1 from jsonb_array_elements(x -> 'unknownStatuses') u where u ->> 'status' = 'fresh')
                          and exists (select 1 from jsonb_array_elements(x -> 'unmappedAssignees') u where u ->> 'name' = 'Nobody Mapped')
                          and (x ->> 'missingAtSource')::int = 1
                     from (select croc_reconcile_overview((select id from ll where k = 'c1')) as x) s),
  'the monitor: ambiguous, unmapped, ownership differences, unknown statuses, missing at the source');
select test.check((select (x ->> 'total')::int = 1 and jsonb_array_length(x -> 'items' -> 0 -> 'candidates') = 2 from (select croc_lead_links_list((select id from ll where k = 'c1'), 'AMBIGUOUS') as x) s),
  'the ambiguous lead lists its two candidates');
select test.must_fail($$select croc_lead_link_resolve((select id from ll where k = 'l5'), 'LINK', (select id from ll where k = 'paying'))$$,
  'it cannot be linked to a record already linked to another Crocodial lead', 'already linked');
select croc_lead_link_resolve((select id from ll where k = 'l5'), 'LINK', (select id from ll where k = 'twin1'));
select croc_lead_link_resolve((select id from ll where k = 'l6'), 'IGNORE');
reset role;
update crocodial_ext_leads set external_updated_at = now() + interval '1 minute' where connection_id = (select id from ll where k = 'c1') and external_id in (9005, 9006);
select croc_reconcile((select id from ll where k = 'c1'), 200);
select test.check((select k.status = 'LINKED' and k.assignment_mode = 'CRM_OVERRIDE' and c.owner_id = test.id('cr_s3') from crocodial_crm_lead_links k join customers c on c.id = k.customer_id
                    where k.connection_id = (select id from ll where k = 'c1') and k.external_lead_id = 9005), 'linked by hand: kept, and its CRM owner is not moved');
select test.check((select status = 'IGNORED' from crocodial_crm_lead_links where connection_id = (select id from ll where k = 'c1') and external_lead_id = 9006), 'an ignored lead stays ignored');
select test.check((select count(*) >= 1 from audit_logs where action = 'CROCODIAL_LEAD_LINK_RESOLVED') and (select count(*) >= 2 from audit_logs where action = 'CROCODIAL_LEAD_IMPORT_SET'), 'every decision is audited');

\echo '   a refresh is "up to date" only once the leads are reconciled'
reset role;
insert into crocodial_sync_state (connection_id, resource, last_ok_at, last_run_at) select (select id from ll where k = 'c1'), r, now(), now() from unnest(array['leads', 'call-logs', 'followups', 'remarks']) r
  on conflict (connection_id, resource) do update set last_ok_at = now(), last_run_at = now(), running_since = null, next_page = null;
update crocodial_reconcile_state set pending = 3, last_run_at = now() where connection_id = (select id from ll where k = 'c1');
select test.check(private.croc_refresh_connection_state((select id from ll where k = 'c1'), now() - interval '1 minute') = 'PARTIALLY_SYNCED', 'read but leads still waiting for reconciliation: partially synced');
update crocodial_reconcile_state set pending = 0, last_run_at = now() where connection_id = (select id from ll where k = 'c1');
select test.check(private.croc_refresh_connection_state((select id from ll where k = 'c1'), now() - interval '1 minute') = 'UP_TO_DATE', 'read and reconciled: up to date');

-- the suppression is real: an ordinary owner change of a lead still queues the welcome message
update customers set owner_id = test.id('cr_s2') where name = 'Other Owner Lead';
select test.check((select count(*) >= 1 from lead_whatsapp_dispatches d join customers c on c.id = d.customer_id where c.name = 'Other Owner Lead'),
  'outside the import, the welcome WhatsApp still works as before');

-- clean up
update lead_whatsapp_settings set enabled = false where id;
delete from customers where phone like '%97700000%' or name in ('Paying Customer');
delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_LLTEST%';
