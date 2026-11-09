-- =============================================================================
-- Technical Consultant and Meta Verifier: two independent workflows on ONE customer (migration 20261215000100).
-- Runs late (same database): reuses the Wabastore users the earlier suites made - tm_a (Sales), late_consultant (Technical Consultant),
-- late_verifier (Meta Verifier), dh_wab (Department Head), acc_m (Accounts), sup_plain (plain Support member), tm_c (another department), sa.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 96. Technical Consultant and Meta Verifier: two independent workflows'
reset role;
\i supabase/migrations/20261215000100_consultant_meta_workflows.sql
-- 20261231000100: on the Meta Verifier route the initial verification is the Meta Verifier's; the consultant's track is consultation
\i supabase/migrations/20261231000100_messaging_onboarding_meta_verifier.sql
select to_char(clock_timestamp(), 'MMDDHH24MISSUS') as sfx \gset

create temp table cw (name text primary key, id uuid);
create temp table cwar (name text primary key, data jsonb);
create temp table cwinv (name text primary key, id uuid, doc uuid);
grant all on cw, cwar, cwinv to authenticated, service_role;
create or replace function test.wf(p_name text) returns public.customer_workflow_status language sql stable security definer set search_path = '' as $$
  select w.* from public.customer_workflow_status w join pg_temp.cw c on c.id = w.customer_id where c.name = p_name $$;
create or replace function test.wfid(p_name text) returns uuid language sql stable security definer set search_path = '' as $$ select id from pg_temp.cw where name = p_name $$;
create or replace function test.wfn(p_name text, p_track text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.customer_workflow_events e join pg_temp.cw c on c.id = e.customer_id where c.name = p_name and e.track = p_track $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   1. Sales creates leads: each customer has one record and two status fields'
set role authenticated;
select test.login('tm_a');
insert into cw select 'meta', create_lead(format('{"name":"Flow Meta","company":"Flow Meta Traders","email":"flow.meta.%s@example.com","whatsapp":"+91 98199 20001","phone":"9819920001","leadSource":"Walk-in"}', :'sfx')::jsonb, array['WHATSAPP_API_BLUE_TICK']);
insert into cw select 'tech', create_lead(format('{"name":"Flow Tech","company":"Flow Tech Co","email":"flow.tech.%s@example.com","phone":"9819920002","leadSource":"Walk-in"}', :'sfx')::jsonb, array['AI_CALLING']);
insert into cw select 'idle', create_lead(format('{"name":"Flow Idle","company":"Flow Idle Traders","email":"flow.idle.%s@example.com","whatsapp":"+91 98199 20003","phone":"9819920003","leadSource":"Walk-in"}', :'sfx')::jsonb, array['WHATSAPP_API']);
reset role;
select test.check((select count(*) = 3 from customer_workflow_status where customer_id in (select id from cw)), 'each new lead has exactly one workflow record (the same customer id, nothing duplicated)');
select test.check((select tc_status = 'NEW_LEAD' and meta_status is null from test.wf('meta')) and (select tc_status = 'NEW_LEAD' and meta_status is null from test.wf('tech')), 'a new lead is a New Lead for the Technical Consultant and has no Meta status yet');
select test.check((select count(*) = 3 from customers where id in (select id from cw)), 'still one customer row each');
update customers set lifecycle_stage = 'POTENTIAL', deal_amount = 1000, amount_received = 1000, stage_changed_at = now() where id in (select id from cw);
set role authenticated;
select test.login('tm_a');
select start_customer_onboarding(id, 0, 'UPI', null) from cw;
select save_onboarding_entry((select id from cw where name = 'meta'), 'WA_WEBSITE_URL', 'www.flow-meta.example');
select save_onboarding_entry((select id from cw where name = 'idle'), 'WA_WEBSITE_URL', 'www.flow-idle.example');
reset role;
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_at)
select a.id, i.code, case when i.kind = 'YES_NO' then 'YES' else 'saved' end, 'SAVED', now()
  from cw a cross join lateral private.customer_items(a.id) i
 where i.code <> 'WA_WEBSITE_URL'
on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from cw;
select test.check((select tc_status = 'NEW_LEAD' from test.wf('meta')), 'before Sales sends the customer the status stays New Lead');
select private.forward_to_consultant(a.id, c, false) from cw a join customers c on c.id = a.id;

\echo '   2. The customer reaches BOTH dashboards at once'
select test.check((select tc_status = 'NEW_LEAD' from test.wf('meta')) and (select tc_status = 'VERIFICATION_PENDING' from test.wf('tech')),
  'once Sales sends it, the Technical Consultant has the other route''s customer as Verification Pending, and the Meta customer for consultation (the Meta Verifier verifies it)');
select test.check((select meta_status = 'ONBOARDING_PENDING' from test.wf('meta')) and (select meta_status = 'ONBOARDING_PENDING' from test.wf('idle')) and (select meta_status is null from test.wf('tech')), 'a Meta-eligible customer is Onboarding Pending for the Meta Verifier; the other service has no Meta status');
set role authenticated;
select test.login('late_consultant');
select test.check((select count(*) = 3 from customers where id in (select id from cw)), 'the Technical Consultant sees every customer Sales sent, including the Meta ones (no longer hidden until the hand-over)');
select test.login('late_verifier');
select test.check((select count(*) = 2 from customers where id in (select id from cw where name in ('meta', 'idle'))) and (select count(*) = 0 from customers where id = (select id from cw where name = 'tech')), 'the Meta Verifier sees the Meta customers, not the other one');
select test.check((customer_workflow_get((select id from cw where name = 'meta')) -> 'technicalConsultant' ->> 'status') = 'NEW_LEAD'
               and (customer_workflow_get((select id from cw where name = 'meta')) -> 'metaVerifier' ->> 'status') = 'ONBOARDING_PENDING', 'one read shows both statuses of the same customer');
select test.login('tm_a');
select test.check((customer_workflow_get((select id from cw where name = 'meta')) -> 'technicalConsultant' ->> 'status') = 'NEW_LEAD'
               and not (customer_workflow_get((select id from cw where name = 'meta')) ->> 'canSetTechnicalConsultant')::boolean
               and not (customer_workflow_get((select id from cw where name = 'meta')) ->> 'canSetMetaVerifier')::boolean, 'Sales follows the progress of its customer, read only');
select test.login('sup_plain');
select test.must_fail($$select customer_workflow_get((select id from cw where name = 'meta'))$$, 'a plain Support member sees nothing', 'NOT_FOUND');
select test.login('tm_c');
select test.must_fail($$select customer_workflow_get((select id from cw where name = 'meta'))$$, 'nor does another department', 'NOT_FOUND');
select test.must_fail($$select count(*) from customer_workflow_status$$, 'the tables have no direct access', 'permission denied');
select test.must_fail($$select count(*) from customer_workflow_events$$, 'neither has the history table', 'permission denied');

\echo '   3. Normal onboarding starts: both fields move on their own facts'
select test.login('late_verifier');
select consultant_start_onboarding((select id from cw where name = 'meta'));
reset role;
select test.check((select meta_status = 'ONBOARDING_IN_PROGRESS' from test.wf('meta')) and (select tc_status = 'NEW_LEAD' from test.wf('meta')),
  'the customer starts normal onboarding: Meta Onboarding In Progress; the Technical Consultant does not claim the verification');
select test.check((select tc_status = 'NEW_LEAD' and meta_status = 'ONBOARDING_PENDING' from test.wf('idle')), 'a customer nobody started stays pending for the Meta Verifier');

\echo '   4. The two statuses are independent: a change of one never touches the other'
create temp table cw_before (tc text, mt text, tcn bigint, mtn bigint);
grant all on cw_before to authenticated, service_role;
insert into cw_before select tc_status, meta_status, test.wfn('meta', 'TECHNICAL_CONSULTANT'), test.wfn('meta', 'META_VERIFIER') from test.wf('meta');
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'ON_HOLD', '')$$, 'on hold needs a reason', 'reason');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'ADDON_PURCHASED', 'x')$$, 'Add-on Purchased is set by Accounts'' confirmation, not by hand', 'not by hand');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'NEW_LEAD', 'x')$$, 'nor New Lead', 'not by hand');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'PAYMENT_CONFIRMATION_PENDING', 'x')$$, 'nor Payment Confirmation Pending', 'not by hand');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'SOMETHING', 'x')$$, 'an unknown status is refused', 'Unknown status');
select test.must_fail($$select customer_workflow_set_meta((select id from cw where name = 'meta'), 'ONBOARDING_IN_PROGRESS', 'x')$$, 'the Technical Consultant cannot change the Meta status', 'FORBIDDEN|Only the Meta Verifier');
select test.check((customer_workflow_set_tc((select id from cw where name = 'meta'), 'ON_HOLD', 'Waiting for the customer to confirm the plan') -> 'technicalConsultant' ->> 'status') = 'ON_HOLD', 'the Technical Consultant puts the customer On Hold with a reason');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'ON_HOLD', 'again')$$, 'the same status twice is refused', 'already');
reset role;
select test.check((select meta_status = (select mt from cw_before) from test.wf('meta')), 'the Meta status did not change');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'VERIFICATION_PENDING', 'x')$$, 'the Meta Verifier cannot change the Technical Consultant status', 'FORBIDDEN|Only the Technical Consultant');
select test.must_fail($$select customer_workflow_set_meta((select id from cw where name = 'meta'), 'REJECTED', '')$$, 'a rejection needs a reason', 'reason');
select test.must_fail($$select customer_workflow_set_meta((select id from cw where name = 'meta'), 'ONBOARDING_COMPLETED', 'x')$$, 'onboarding cannot be marked completed while the payment, the client login or a document is missing (the existing Meta verification rules apply)', 'payment is not confirmed|login|Authorize');
select test.check((customer_workflow_set_meta((select id from cw where name = 'meta'), 'DOCUMENTS_PENDING', 'Address proof is blurred') -> 'metaVerifier' ->> 'status') = 'DOCUMENTS_PENDING', 'the Meta Verifier moves their own status');
reset role;
select test.check((select meta_status = 'DOCUMENTS_REQUIRED' from customer_onboarding where customer_id = (select id from cw where name = 'meta')), 'it went THROUGH the existing Meta verification state (one truth, the client sees it too)');
select test.check((select tc_status = 'ON_HOLD' from test.wf('meta')), 'the Technical Consultant status is still On Hold');
set role authenticated;
select test.login('late_verifier');
select test.check((customer_workflow_set_meta((select id from cw where name = 'meta'), 'ON_HOLD', 'Waiting for the customer''s GST certificate') -> 'metaVerifier' ->> 'status') = 'ON_HOLD', 'the Meta Verifier can also put the onboarding On Hold');
reset role;
-- every document gets authorized meanwhile: the system never lifts an On Hold, on either side
update customer_onboarding set items_verified = items_total where customer_id = (select id from cw where name = 'meta');
select test.check((select tc_status = 'ON_HOLD' and meta_status = 'ON_HOLD' from test.wf('meta')), 'On Hold is never changed by the system');
set role authenticated;
select test.login('late_verifier');
select test.check((customer_workflow_set_meta((select id from cw where name = 'meta'), 'ONBOARDING_IN_PROGRESS', 'Resumed') -> 'metaVerifier' ->> 'status') = 'VERIFICATION_PENDING', 'resuming follows the records: every document is authorized, so Verification Pending');
select test.login('late_consultant');
-- 20261231000100: on the Meta Verifier route the initial verification is the Meta Verifier's, so the consultant records a consultation status
select customer_workflow_set_tc((select id from cw where name = 'meta'), 'ADDON_SERVICES_RECOMMENDED', 'Customer confirmed');
reset role;
select test.check((select count(*) >= 2 from customer_workflow_events where customer_id = (select id from cw where name = 'meta') and source = 'USER' and actor_id is not null and note is not null), 'every manual change is in the history with who, when and why');
select test.check((select count(*) = 1 from audit_logs where action = 'CUSTOMER_TC_STATUS_SET' and entity_id = (select id from cw where name = 'meta') and metadata ->> 'to' = 'ON_HOLD'), 'and audited');
select test.check((select count(*) >= 1 from audit_logs where action = 'CUSTOMER_META_STATUS_SET' and entity_id = (select id from cw where name = 'meta')), 'for both roles');

\echo '   5. Meta onboarding completes: the customer stays with the Technical Consultant'
set role authenticated;
select test.login('late_verifier');
select save_consultant_entry((select id from cw where name = 'meta'), 'WABA_ID', '109876543210111');
select verify_all_onboarding_entries((select id from cw where name = 'meta'));
reset role;
-- the verifier's "Meta verification completed" (its own prerequisites, payment and client login, are tested in their suites)
update customer_onboarding set meta_status = 'COMPLETED' where customer_id = (select id from cw where name = 'meta');
select test.check((select meta_status = 'ONBOARDING_COMPLETED' and tc_status = 'ADDON_SERVICES_RECOMMENDED' from test.wf('meta')),
  'Meta Verification completed: Meta shows Onboarding Completed; the Technical Consultant''s own consultation status is untouched');
set role authenticated;
select test.login('late_verifier');
select send_to_department_head((select id from cw where name = 'meta'), 'All documents verified');
reset role;
select test.check((select meta_status = 'ONBOARDING_COMPLETED' from test.wf('meta')), 'Meta onboarding is Completed after the hand-over');
select test.check((select tc_status = 'ADDON_SERVICES_RECOMMENDED' from test.wf('meta')), 'the Technical Consultant status becomes Add-on Services Recommended, NOT Completed');
set role authenticated;
select test.login('late_consultant');
select test.check((select count(*) = 1 from customers where id = (select id from cw where name = 'meta')), 'the customer is still in the Technical Consultant''s dashboard after the hand-over');
select test.check((customer_workflow_get((select id from cw where name = 'meta')) ->> 'canSetTechnicalConsultant')::boolean, 'and still theirs to manage');
select test.login('late_verifier');
select test.must_fail($$select consultant_set_addons_required((select id from cw where name = 'meta'), true)$$, 'the Meta Verifier has no part in add-ons', 'NOT_FOUND');
select test.must_fail($$select consultant_save_addon_request((select id from cw where name = 'meta'), '[{"serviceCode":"GBP_SETUP","quantity":1,"unitPrice":100}]'::jsonb)$$, 'nor in add-on requests', 'NOT_FOUND|not found');

\echo '   6. No add-ons bought: the Technical Consultant keeps the customer, nothing is completed by itself'
select test.login('late_consultant');
select consultant_set_addons_required((select id from cw where name = 'meta'), false);
reset role;
select test.check((select tc_status = 'WAITING_FOR_CUSTOMER_PURCHASE' from test.wf('meta')) and (select meta_status = 'ONBOARDING_COMPLETED' from test.wf('meta')), 'no add-on purchased: Waiting for Customer Purchase; Meta stays Onboarding Completed');
select test.check((select tc_status <> 'COMPLETED' from test.wf('meta')), 'and it is never completed automatically');

\echo '   7. A customer who needs add-ons: request, Accounts verification, purchase, payment, processing'
set role authenticated;
select test.login('late_consultant');
select consultant_set_addons_required((select id from cw where name = 'meta'), true);
reset role;
select test.check((select tc_status = 'ADDON_SERVICES_RECOMMENDED' from test.wf('meta')), 'the customer needs add-ons: Add-on Services Recommended again');
set role authenticated;
select test.login('late_consultant');
insert into cwar select 'd1', consultant_save_addon_request((select id from cw where name = 'meta'),
  '[{"serviceCode":"GBP_SETUP","quantity":1,"unitPrice":8000,"taxPercent":18},{"serviceCode":"AI_CALLING","quantity":2,"unitPrice":5000,"discount":1000},{"name":"Custom integration","quantity":1,"unitPrice":3000}]'::jsonb, 'Three add-ons');
select test.check((select jsonb_array_length(data -> 'items') = 3 from cwar where name = 'd1'), 'one request carries several add-on services (a customer can buy multiple add-ons)');
insert into cwar select 's1', consultant_save_addon_request((select id from cw where name = 'meta'),
  '[{"serviceCode":"GBP_SETUP","quantity":1,"unitPrice":8000,"taxPercent":18},{"serviceCode":"AI_CALLING","quantity":2,"unitPrice":5000,"discount":1000},{"name":"Custom integration","quantity":1,"unitPrice":3000}]'::jsonb,
  'Three add-ons', true, (select (data ->> 'version')::int from cwar where name = 'd1'));
reset role;
select test.check((select tc_status = 'WAITING_FOR_CUSTOMER_PURCHASE' from test.wf('meta')), 'the proposal is with Accounts and the customer: Waiting for Customer Purchase');
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'TECHNICAL_PROCESSING', 'start')$$, 'processing cannot start before Accounts confirms the payment', 'payment confirmation');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'COMPLETED', 'done')$$, 'nor can the customer be completed', 'waiting for the customer');
select test.login('acc_m');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'COMPLETED', 'x')$$, 'Accounts does not change the Technical Consultant status', 'FORBIDDEN|Only the Technical Consultant');
select accounts_decide_addon_request((select (data ->> 'id')::uuid from cwar where name = 's1'), 'REJECT', 'Customer cancelled the purchase');
reset role;
select test.check((select tc_status = 'ADDON_SERVICES_RECOMMENDED' from test.wf('meta')) and (select meta_status = 'ONBOARDING_COMPLETED' from test.wf('meta')), 'the add-on purchase is cancelled / rejected: back to Add-on Services Recommended, Meta untouched');
-- a second request
set role authenticated;
select test.login('late_consultant');
insert into cwar select 'd2', consultant_save_addon_request((select id from cw where name = 'meta'),
  '[{"serviceCode":"GBP_SETUP","quantity":1,"unitPrice":8000,"taxPercent":18},{"serviceCode":"AI_CALLING","quantity":2,"unitPrice":5000,"discount":1000}]'::jsonb, 'Two add-ons', true);
select test.login('acc_m');
select accounts_decide_addon_request((select (data ->> 'id')::uuid from cwar where name = 'd2'), 'APPROVE', 'Prices checked');
insert into cwinv select 'ADDON', null, id from begin_addon_invoice_upload((select (data ->> 'id')::uuid from cwar where name = 'd2'), 'FLOW/' || :'sfx', current_date::text, (current_date + 7)::text, 'Quote', null, 'Flow add-on.pdf', 'application/pdf', 15000);
select complete_document_upload((select doc from cwinv where name = 'ADDON'), 15000);
reset role;
select test.check((select tc_status = 'WAITING_FOR_CUSTOMER_PURCHASE' from test.wf('meta')), 'invoice issued, nothing paid: Waiting for Customer Purchase');
set role authenticated;
select test.login('acc_m');
insert into cwar select 'p1', accounts_record_addon_payment((select (data ->> 'id')::uuid from cwar where name = 'd2'), 10000, 'UPI', 'UTR-FLOW-1', null, null, false);
reset role;
select test.check((select tc_status = 'PAYMENT_CONFIRMATION_PENDING' from test.wf('meta')), 'a payment was recorded and waits for Accounts: Payment Confirmation Pending');
set role authenticated;
select test.login('acc_m');
select accounts_decide_addon_payment((select (p ->> 'id')::uuid from cwar, jsonb_array_elements(data -> 'payments') p where name = 'p1' limit 1), 'REJECT', 'Not received in the bank');
reset role;
select test.check((select tc_status = 'WAITING_FOR_CUSTOMER_PURCHASE' from test.wf('meta')), 'a rejected payment: back to Waiting for Customer Purchase');
set role authenticated;
select test.login('acc_m');
insert into cwar select 'p2', accounts_record_addon_payment((select (data ->> 'id')::uuid from cwar where name = 'd2'), 18440, 'BANK_TRANSFER', 'NEFT-FLOW-2', null, null, true);
reset role;
select test.check((select tc_status = 'WAITING_FOR_CUSTOMER_PURCHASE' or tc_status = 'PAYMENT_CONFIRMATION_PENDING' from test.wf('meta')), 'a verified payment is not yet a confirmed purchase');
set role authenticated;
select test.login('acc_m');
select accounts_confirm_addon_payment((select (data ->> 'id')::uuid from cwar where name = 'd2'));
reset role;
select test.check((select tc_status = 'ADDON_PURCHASED' from test.wf('meta')), 'Accounts confirms the payment: Add-on Purchased (only confirmed purchases count)');
select test.check((select meta_status = 'ONBOARDING_COMPLETED' from test.wf('meta')), 'Meta onboarding is still Completed');
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'meta'), 'COMPLETED', 'done')$$, 'the purchase is still to be processed: not completed', 'still being processed');
select test.check((customer_workflow_set_tc((select id from cw where name = 'meta'), 'TECHNICAL_PROCESSING', 'Starting the integration') -> 'technicalConsultant' ->> 'status') = 'TECHNICAL_PROCESSING', 'the Technical Consultant can proceed with technical processing after the confirmation');
select consultant_start_addon_documents((select id from cw where name = 'meta'));
reset role;
select test.check((select tc_status = 'TECHNICAL_PROCESSING' from test.wf('meta')), 'processing the add-on documents keeps Technical Processing');
update addon_requests set status = 'COMPLETED' where id = (select (data ->> 'id')::uuid from cwar where name = 'd2');
select test.check((select tc_status = 'TECHNICAL_PROCESSING' from test.wf('meta')), 'finished add-on documents do not complete the customer by themselves');
set role authenticated;
select test.login('late_consultant');
select test.check((customer_workflow_set_tc((select id from cw where name = 'meta'), 'COMPLETED', 'Technical work finished') -> 'technicalConsultant' ->> 'status') = 'COMPLETED', 'the Technical Consultant completes their workflow');
reset role;
select test.check((select meta_status = 'ONBOARDING_COMPLETED' from test.wf('meta')), 'Meta onboarding stayed Completed through the whole add-on process');
select test.check((select count(*) = 1 from customers where id = (select id from cw where name = 'meta')), 'one customer record from start to finish');

\echo '   8. Completed is not permanent: a new add-on request re-opens it'
set role authenticated;
select test.login('late_consultant');
insert into cwar select 'd3', consultant_save_addon_request((select id from cw where name = 'meta'), '[{"serviceCode":"AI_CALLING","quantity":1,"unitPrice":5000}]'::jsonb, 'More calling', true);
reset role;
select test.check((select tc_status = 'WAITING_FOR_CUSTOMER_PURCHASE' from test.wf('meta')), 'a new add-on request after Completed re-opens the customer');

\echo '   9. The other route: the Technical Consultant verifies, hands over, and still owns add-ons'
set role authenticated;
select test.login('late_consultant');
select consultant_start_onboarding((select id from cw where name = 'tech'));
reset role;
select test.check((select tc_status = 'VERIFICATION_IN_PROGRESS' and meta_status is null from test.wf('tech')), 'on the Technical route there is no Meta status');
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select customer_workflow_set_meta((select id from cw where name = 'tech'), 'ONBOARDING_IN_PROGRESS', 'x')$$, 'a Meta status cannot be set for a customer that is not on the Meta route', 'not on the Meta');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'tech'), 'COMPLETED', 'done')$$, 'the first verification must be finished before completing', 'first verification');
select verify_all_onboarding_entries((select id from cw where name = 'tech'));
reset role;
update customer_onboarding set meta_status = 'COMPLETED' where customer_id = (select id from cw where name = 'tech');
set role authenticated;
select test.login('late_consultant');
select send_to_department_head((select id from cw where name = 'tech'), 'Verified');
reset role;
select test.check((select tc_status = 'ADDON_SERVICES_RECOMMENDED' from test.wf('tech')), 'after the hand-over to the Department Head the consultant status is Add-on Services Recommended');
set role authenticated;
select test.login('late_consultant');
select test.check((select count(*) = 1 from customers where id = (select id from cw where name = 'tech')), 'the customer is still in the Technical Consultant''s dashboard');
select consultant_set_addons_required((select id from cw where name = 'tech'), false);
select test.check((customer_workflow_get((select id from cw where name = 'tech')) -> 'technicalConsultant' ->> 'status') = 'WAITING_FOR_CUSTOMER_PURCHASE', 'the consultant can still record that the customer buys no add-ons: Waiting for Customer Purchase');
select test.check((customer_workflow_set_tc((select id from cw where name = 'tech'), 'COMPLETED', 'No add-ons needed') -> 'technicalConsultant' ->> 'status') = 'COMPLETED', 'with nothing open they may close the customer themselves');
select test.login('dh_wab');
select test.check((customer_workflow_get((select id from cw where name = 'tech')) ->> 'canSetTechnicalConsultant')::boolean and not (customer_workflow_get((select id from cw where name = 'tech')) ->> 'canSetMetaVerifier')::boolean, 'the Department Head monitors and can step in on the Technical side; there is no Meta side here');
select test.must_fail($$select customer_workflow_set_meta((select id from cw where name = 'tech'), 'ON_HOLD', 'x')$$, 'and cannot set a Meta status for a customer off the Meta route', 'not on the Meta');

\echo '   10. Incomplete onboarding and the Meta Verifier rejecting'
select test.login('late_consultant');
select test.must_fail($$select customer_workflow_set_tc((select id from cw where name = 'idle'), 'COMPLETED', 'done')$$, 'an unfinished customer cannot be completed', 'first verification');
select test.login('late_verifier');
select test.check((customer_workflow_set_meta((select id from cw where name = 'idle'), 'REJECTED', 'Documents are forged') -> 'metaVerifier' ->> 'status') = 'REJECTED', 'the Meta Verifier rejects a customer with a reason');
reset role;
select test.check((select tc_status = 'NEW_LEAD' from test.wf('idle')), 'the Technical Consultant status is unaffected by the Meta rejection');
update customer_onboarding set items_verified = 1 where customer_id = (select id from cw where name = 'idle');
select test.check((select meta_status = 'REJECTED' from test.wf('idle')), 'a Meta rejection is not undone by the system');
select test.check((select meta_status = 'REJECTED' from customer_onboarding where customer_id = (select id from cw where name = 'idle')), 'it is the existing Meta verification state that says Rejected');
set role authenticated;
select test.login('sa');
select test.check((customer_workflow_set_meta((select id from cw where name = 'idle'), 'ONBOARDING_IN_PROGRESS', 'Resubmitted') -> 'metaVerifier' ->> 'status') = 'ONBOARDING_PENDING', 'the Super Admin can reopen a rejected customer (nobody has started onboarding it, so it is Onboarding Pending)');
select test.check((customer_workflow_set_tc((select id from cw where name = 'idle'), 'ON_HOLD', 'Customer abroad') -> 'technicalConsultant' ->> 'status') = 'ON_HOLD', 'and the Technical side');
select test.check((customer_workflow_statuses(array[(select id from cw where name = 'meta'), (select id from cw where name = 'tech')]) -> (select id::text from cw where name = 'tech') ->> 'technicalConsultant') = 'COMPLETED', 'a list page reads the statuses of many customers at once');
select test.login('tm_c');
select test.check(customer_workflow_statuses(array[(select id from cw where name = 'meta')]) = '{}'::jsonb, 'and only the ones the caller may see');

\echo '   11. Safe to repeat'
reset role;
create temp table cw_events as select count(*) as n from customer_workflow_events where customer_id in (select id from cw);
select count(*) from (select private.wf_refresh(id) from cw) x;
select test.check((select count(*) = (select n from cw_events) from customer_workflow_events where customer_id in (select id from cw)), 'a refresh with nothing new changes nothing');
\i supabase/migrations/20261215000100_consultant_meta_workflows.sql
-- 20261231000100: on the Meta Verifier route the initial verification is the Meta Verifier's; the consultant's track is consultation
\i supabase/migrations/20261231000100_messaging_onboarding_meta_verifier.sql
select test.check((select count(*) = (select n from cw_events) from customer_workflow_events where customer_id in (select id from cw)), 'running the migration again with data in place changes nothing');
select test.check((select count(*) = 3 from customer_workflow_status where customer_id in (select id from cw)), 'and creates no second record');
\echo '   consultant / meta workflow tests done'
