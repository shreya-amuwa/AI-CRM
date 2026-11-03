-- =============================================================================
-- Service-specific onboarding journeys (migration 20261222000100): every service on its own track, the standalone WhatsApp API journey
-- (no Blue Tick application, an optional "existing Blue Tick" check), steps derived from stored facts, the authoritative Meta decision
-- (idempotent, with evidence), the automatic start of service setup, and legacy customers left alone.
-- Runs after the other suites on the same database and reuses their staff.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
reset role;
-- earlier suites re-apply older migrations (to prove they are re-runnable): put the newest definitions back on top, twice (it must re-run)
\i supabase/migrations/20261222000100_service_specific_journeys.sql
\i supabase/migrations/20261222000100_service_specific_journeys.sql

\echo '--- 111. Service journeys: each service follows its own track'
create temp table sj (name text primary key, id uuid);
create temp table sjn (name text primary key, n bigint);
grant all on sj, sjn to authenticated, service_role;

select test.check((select private.service_track('WHATSAPP_API') = 'META' and private.service_track('BLUE_TICK') = 'META' and private.service_track('WHATSAPP_API_BLUE_TICK') = 'META'),
  'the three WhatsApp services are verified by Meta (from their own catalogue flags)');
select test.check((select private.service_track('DS_META_ADS') = 'DIRECT' and private.service_track('AI_CALLING') <> 'META'), 'a delivery-team service and AI Calling are not on the Meta track');
select test.check((select private.service_track('NO_SUCH_SERVICE') is null), 'an unknown service has no track');
select test.check((select count(*) = 3 from crm_services where code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK')), 'the three catalogue rows exist once each (nothing was duplicated)');

set role authenticated;
select test.login('tm_a');
insert into sj select 'W1', create_lead('{"name":"Api Only","company":"Api Only Journey Co","email":"apionly.journey@example.com","phone":"9819907001","leadSource":"Walk-in"}', array['WHATSAPP_API']);
insert into sj select 'T1', create_lead('{"name":"Tick Only","company":"Tick Only Journey Co","email":"tickonly.journey@example.com","phone":"9819907002","leadSource":"Walk-in"}', array['BLUE_TICK']);
insert into sj select 'M1', create_lead('{"name":"Mixed One","company":"Mixed Journey Co","email":"mixed.journey@example.com","phone":"9819907003","leadSource":"Walk-in"}', array['WHATSAPP_API', 'DS_META_ADS']);
insert into sj select 'C1', create_lead('{"name":"Calling One","company":"Calling Journey Co","email":"calling.journey@example.com","phone":"9819907004","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
select test.check((select count(*) = 1 and bool_and(service_code = 'WHATSAPP_API') from customer_services where customer_id = (select id from sj where name = 'W1')),
  'Scenario A: a lead that selects only WhatsApp API holds only WhatsApp API (the bundle is not added)');
select test.check((select count(*) = 1 and bool_and(service_code = 'BLUE_TICK') from customer_services where customer_id = (select id from sj where name = 'T1')), 'Blue Tick alone holds only Blue Tick');
select test.check((select not exists (select 1 from service_usage u where u.customer_id in (select id from sj))), 'Scenario C: no WhatsApp message package or usage is assigned by selecting these services');

\echo '--- 112. Service journeys: WhatsApp API on its own'
-- the steps come from stored facts: nothing typed by a person
select test.check((select array_agg(s ->> 'key' order by ord) = array['ORDER', 'DOCUMENTS', 'ELIGIBILITY', 'META', 'PROVISIONING', 'LIVE']
                     from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', false, null) -> 'steps') with ordinality as t(s, ord)),
  'WhatsApp API alone: order, details, eligibility, Meta approval, provisioning, live - no Blue Tick application');
select test.check((select private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', false, null) ->> 'track') = 'META', 'it still goes through Meta (the WABA), so no handoff is skipped');
-- Blue Tick only: the default Meta track, no API provisioning
select test.check((select array_agg(s ->> 'key' order by ord) = array['ORDER', 'DOCUMENTS', 'VERIFICATION', 'META', 'LIVE']
                     from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'T1'), 'BLUE_TICK', false, null) -> 'steps') with ordinality as t(s, ord)),
  'Scenario C: Blue Tick alone shows the verification steps only (no API provisioning)');

-- an existing Blue Tick: recorded apart from the sale
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'T1'), 'CUSTOMER_REPORTED', null, null)$$, 'only a standalone WhatsApp API customer has one', 'only applies');
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'W1'), 'MAYBE', null, null)$$, 'an unknown status is refused', 'Choose');
select test.check((select set_existing_blue_tick((select id from sj where name = 'W1'), 'CUSTOMER_REPORTED', 'Seen on the WhatsApp profile', null) ->> 'status') = 'CUSTOMER_REPORTED', 'Sales records that the customer reports an existing verification');
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'W1'), 'CONFIRMED', 'META-BM-1', null)$$, 'but Sales cannot confirm it: a checkbox is not evidence', 'verifier');
select test.login('acc_m');
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'W1'), 'CUSTOMER_REPORTED', null, null)$$, 'Accounts cannot touch it', 'NOT_FOUND');
select test.must_fail($$select customer_existing_blue_tick((select id from sj where name = 'W1'))$$, 'nor read it', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 1 and bool_and(service_code = 'WHATSAPP_API') from customer_services where customer_id = (select id from sj where name = 'W1')),
  'recording the existing Blue Tick adds no service and sells nothing');
select test.check((select array_agg(s ->> 'key' order by ord) = array['ORDER', 'DOCUMENTS', 'BLUE_TICK', 'ELIGIBILITY', 'META', 'PROVISIONING', 'LIVE']
                     and (select (x ->> 'required')::boolean is false from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', false, null) -> 'steps') x where x ->> 'key' = 'BLUE_TICK')
                     from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', false, null) -> 'steps') with ordinality as t(s, ord)),
  'the existing Blue Tick adds one optional "checked" step; eligibility and provisioning stay');

\echo '--- 113. Service journeys: from payment to a login, then the documents'
set role authenticated;
select test.login('tm_a');
select send_lead_to_accounts((select id from sj where name = 'W1'), 8000, null);
select send_lead_to_accounts((select id from sj where name = 'M1'), 9000, null);
select send_lead_to_accounts((select id from sj where name = 'C1'), 6000, null);
select test.login('acc_m');
select accounts_set_order_gst(id, 0) from sj where name in ('W1', 'M1', 'C1');
select accounts_record_payment((select id from sj where name = 'W1'), 'PART', 3000, 'UPI', 'SJ-W1-UPI', null, null, true);
select accounts_record_payment((select id from sj where name = 'M1'), 'PART', 3000, 'UPI', 'SJ-M1-UPI', null, null, true);
select accounts_record_payment((select id from sj where name = 'C1'), 'PART', 3000, 'UPI', 'SJ-C1-UPI', null, null, true);
select accounts_confirm_and_return((select id from sj where name = 'W1'));
select accounts_confirm_and_return((select id from sj where name = 'M1'));
select accounts_confirm_and_return((select id from sj where name = 'C1'));
select accounts_client_login_begin((select id from sj where name = 'W1'));
select accounts_client_login_begin((select id from sj where name = 'M1'));
select accounts_client_login_begin((select id from sj where name = 'C1'));
reset role;
select test.create_auth_user('sj_w1', 'apionly.journey@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from sj where name = 'W1')));
select test.create_auth_user('sj_m1', 'mixed.journey@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from sj where name = 'M1')));
select test.create_auth_user('sj_c1', 'calling.journey@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from sj where name = 'C1')));
set role authenticated;
select test.login('acc_m');
select record_client_account((select id from sj where name = 'W1'), test.id('sj_w1'), 'apionly.journey@example.com');
select record_client_account((select id from sj where name = 'M1'), test.id('sj_m1'), 'mixed.journey@example.com');
select record_client_account((select id from sj where name = 'C1'), test.id('sj_c1'), 'calling.journey@example.com');
reset role;

-- what each client sees before anything is verified: the verification stage is titled for what it really is
select test.check((select s ->> 'external' = 'true' and s ->> 'title' = 'Meta verification'
                     from jsonb_array_elements(private.client_journey((select id from sj where name = 'W1')) -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'), 'a WhatsApp customer is told it is Meta verification');
select test.check((select s ->> 'external' = 'false' and s ->> 'title' = 'Verification by our team'
                     from jsonb_array_elements(private.client_journey((select id from sj where name = 'C1')) -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'),
  'Scenario F: a customer whose services Meta does not verify is not told it waits for Meta (our own team verifies)');
select test.check((select (x ->> 'waitingFor') = 'Verification by our team' and x ->> 'track' <> 'META'
                     from jsonb_array_elements(private.client_journey((select id from sj where name = 'C1')) -> 'stages') s, jsonb_array_elements(s -> 'services') x where s ->> 'key' = 'SERVICE_SETUP'),
  'and its service waits for "Verification by our team", not for Meta');
-- a mixed customer: each service waits for its own thing
select test.check((select count(*) = 2 and bool_or(x ->> 'code' = 'WHATSAPP_API' and x ->> 'waitingFor' = 'Meta verification') and bool_or(x ->> 'code' = 'DS_META_ADS' and x ->> 'waitingFor' = 'Verification by our team')
                     from jsonb_array_elements(private.client_journey((select id from sj where name = 'M1')) -> 'stages') s, jsonb_array_elements(s -> 'services') x where s ->> 'key' = 'SERVICE_SETUP'),
  'Scenario G: in a mixed customer only the WhatsApp service waits for Meta; the other service does not inherit it');
select test.check((select array_agg(s ->> 'key' order by ord) = array['ORDER', 'DOCUMENTS', 'DELIVERY', 'LIVE']
                     from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'M1'), 'DS_META_ADS', true, now()) -> 'steps') with ordinality as t(s, ord)),
  'Scenario F: the direct service shows its own direct journey - no Meta step');
select test.check((select array_agg(s ->> 'key' order by ord) = array['ORDER', 'DOCUMENTS', 'ELIGIBILITY', 'META', 'PROVISIONING', 'LIVE']
                     from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'M1'), 'WHATSAPP_API', true, now()) -> 'steps') with ordinality as t(s, ord)),
  'and the WhatsApp service of the same customer shows its Meta journey');
select test.check((private.client_journey((select id from sj where name = 'W1')) -> 'progress' ->> 'percent')::int < 100 and (private.client_journey((select id from sj where name = 'W1')) ->> 'completed') = 'false',
  'the overall progress is below 100 until onboarding is complete');

-- the documents: received, sent back, corrected, authorized - the client state follows by itself
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by)
  select c.id, i.code, 'saved', 'SAVED', test.id('tm_a') from sj c cross join lateral private.customer_items(c.id) i
  on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from sj;
select test.check((private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps' -> 1 ->> 'clientState') in ('IN_PROGRESS', 'WAITING_FOR_CUSTOMER'),
  'details saved but not yet with the verifier: the step is not complete');
set role authenticated;
select test.login('tm_a');
select forward_onboarding_to_support((select id from sj where name = 'W1'));
select forward_onboarding_to_support((select id from sj where name = 'M1'));
reset role;
create temp table sjv (name text);
grant all on sjv to authenticated;
insert into sjv select u.name from test.users u where u.id = (select meta_verifier_id from customer_onboarding where customer_id = (select id from sj where name = 'W1'));
select test.check((select name is not null from sjv), 'the Meta Verifier of the customer is one of the test staff');
select test.check((select s ->> 'state' = 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'DOCUMENTS'),
  'the documents step completes by itself when the documents reach the verifier');
set role authenticated;
select test.login((select name from sjv));
select consultant_start_onboarding((select id from sj where name = 'W1'));
select review_onboarding_entry((select id from sj where name = 'W1'), 'CUSTOMER_NAME', 'REJECTED', 'The name does not match the certificate');
reset role;
select test.check((select s ->> 'clientState' = 'ACTION_REQUIRED' and s ->> 'hint' like '%corrected%' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'state' = 'CURRENT'),
  'Scenario D: a rejected document makes the step "action required" with no status typed by anybody');
select test.check((select actionRequired from (select (private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) ->> 'actionRequired')::boolean as actionRequired) x), 'and the service says the customer must act');
-- the client replaces the rejected document: it is pending review again, never approved by itself
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by)
  values ((select id from sj where name = 'W1'), 'CUSTOMER_NAME', 'corrected', 'SAVED', test.id('tm_a'))
  on conflict (customer_id, item_code) do update set value = excluded.value, status = 'SAVED';
select private.refresh_onboarding_progress((select id from sj where name = 'W1'));
select test.check((select s ->> 'clientState' = 'UNDER_REVIEW' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'state' = 'CURRENT'),
  'Scenario D: the corrected document returns to "under review" - not approved');
select test.check((select meta_status <> 'COMPLETED' from customer_onboarding where customer_id = (select id from sj where name = 'W1')), 'a re-upload never completes the Meta verification');

\echo '--- 114. Service journeys: authorising the documents is not the Meta decision'
set role authenticated;
select test.login((select name from sjv));
select verify_all_onboarding_entries((select id from sj where name = 'W1'));
select save_consultant_entry((select id from sj where name = 'W1'), 'WABA_ID', '998877665544332');
reset role;
select test.check((select s ->> 'state' = 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'ELIGIBILITY'),
  'every document authorized: the eligibility step is complete');
select test.check((select s ->> 'state' <> 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'META'),
  'Scenario B/E: but Meta approval is NOT inferred from the documents - it waits for the real decision');
select test.check((select meta_status <> 'COMPLETED' and meta_completed_at is null from customer_onboarding where customer_id = (select id from sj where name = 'W1')), 'the stored Meta status stays open');

set role authenticated;
-- who may record the decision
select test.login('tm_a');
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'meta-evt-0001', 'META-CASE-1', null)$$, 'Sales cannot record a Meta decision', 'NOT_FOUND');
select test.login('sj_w1');
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'meta-evt-0001', 'META-CASE-1', null)$$, 'a client cannot forge their own approval', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'W1'), 'CONFIRMED', 'x', null)$$, 'nor confirm their own Blue Tick', 'NOT_FOUND|FORBIDDEN');
select test.login((select name from sjv));
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'meta-evt-0001', null, null)$$, 'an approval needs the evidence reference', 'Meta reference');
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'short', 'META-CASE-1', null)$$, 'and a real event key', 'event key');
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'REJECTED', 'meta-evt-0002', null, null)$$, 'a rejection says why', 'Tell the client');
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'MAYBE', 'meta-evt-0003', null, 'x')$$, 'an unknown outcome is refused', 'Choose');
-- the existing Blue Tick: confirmed by the verifier, with the reference
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'W1'), 'CONFIRMED', null, null)$$, 'confirming needs the reference that was checked', 'reference');
select test.check((select set_existing_blue_tick((select id from sj where name = 'W1'), 'CONFIRMED', 'Meta Business ID 12345', 'Checked on the Business Suite') ->> 'status') = 'CONFIRMED', 'the verifier confirms it, with the reference');
select test.check((select (customer_existing_blue_tick((select id from sj where name = 'W1')) ->> 'reviewer') is not null and (customer_existing_blue_tick((select id from sj where name = 'W1')) ->> 'reviewedAt') is not null),
  'who confirmed it and when are recorded');
select test.login('tm_a');
select test.must_fail($$select set_existing_blue_tick((select id from sj where name = 'W1'), 'NOT_PROVIDED', null, null)$$, 'Sales cannot overwrite what the verifier reviewed', 'already reviewed');
select test.login((select name from sjv));
-- Meta rejects, then approves: the decision is idempotent
select test.check((select record_meta_outcome((select id from sj where name = 'W1'), 'NEEDS_INFO', 'meta-evt-0004', null, 'Meta needs a clearer business proof') ->> 'status') = 'DOCUMENTS_REQUIRED', 'Meta asks for more: the client is asked, with the words');
select test.check((select (record_meta_outcome((select id from sj where name = 'W1'), 'NEEDS_INFO', 'meta-evt-0004', null, 'Meta needs a clearer business proof') ->> 'duplicate')::boolean), 'Scenario E: replaying the same event changes nothing');
select test.check((select record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'meta-evt-0005', 'META-CASE-9', null) ->> 'status') = 'COMPLETED', 'Meta approves: the verification completes');
select test.check((select (record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'meta-evt-0005', 'META-CASE-9', null) ->> 'duplicate')::boolean), 'replaying the approval changes nothing');
select test.check((select record_meta_outcome((select id from sj where name = 'W1'), 'APPROVED', 'meta-evt-0006', 'META-CASE-9', null) ->> 'result') = 'ALREADY_COMPLETED', 'a late, different approval event is recorded but changes nothing');
select test.must_fail($$select record_meta_outcome((select id from sj where name = 'W1'), 'REJECTED', 'meta-evt-0007', null, 'Late rejection')$$, 'a later rejection is not hidden and not silently applied: it must be raised explicitly', 'already completed');
reset role;
select test.check((select meta_status = 'COMPLETED' and meta_completed_at is not null and meta_completed_by = (select id from profiles where id = test.id((select name from sjv))) from customer_onboarding where customer_id = (select id from sj where name = 'W1')), 'who completed it and when is recorded');
select test.check((select count(*) = 3 and count(distinct event_key) = 3 from meta_verification_events where customer_id = (select id from sj where name = 'W1')), 'every applied or ignored event is on record exactly once (3 keys: needs information, approval, late approval); the replays and the refused rejection stored nothing');
select test.check((select count(*) = 1 from audit_logs where action = 'META_OUTCOME_RECORDED' and entity_id = (select id from sj where name = 'W1') and metadata ->> 'outcome' = 'APPROVED'), 'the approval is in the audit log once');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from sj where name = 'W1') and type = 'META_STATUS' and message like 'Meta verification is completed%'), 'the client is told of the completion once, however often the event is replayed');
select test.check((select s ->> 'state' = 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'META'),
  'the Meta step is now complete, because of the recorded decision');
select test.check((select s ->> 'state' = 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'BLUE_TICK'),
  'and the confirmed existing Blue Tick shows as checked');
-- the other services of a mixed customer and other customers are untouched
select test.check((select meta_status <> 'COMPLETED' from customer_onboarding where customer_id = (select id from sj where name = 'M1')), 'another customer''s verification is untouched');

\echo '--- 115. Service journeys: service setup starts by itself, ready stays a person''s decision'
select test.check((select setup_status = 'PENDING' and not setup_auto from customer_services where customer_id = (select id from sj where name = 'W1') and service_code = 'WHATSAPP_API'),
  'before the Relationship Manager is assigned the setup has not started');
set role authenticated;
select test.login((select name from sjv));
select send_to_department_head((select id from sj where name = 'W1'), 'Verified');
select test.login('dh_wab');
select pass_to_team_lead((select id from sj where name = 'W1'), test.id('sup_th'), null);
select test.login('sup_th');
select assign_to_team_member((select id from sj where name = 'W1'), test.id('sup_b'), null);
reset role;
select test.check((select setup_status = 'IN_PROGRESS' and setup_auto and setup_updated_by is null from customer_services where customer_id = (select id from sj where name = 'W1') and service_code = 'WHATSAPP_API'),
  'once payment, verification and the Relationship Manager are done the setup starts by itself');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from sj where name = 'W1') and dedupe_key = format('SETUPAUTO|%s|WHATSAPP_API', (select id from sj where name = 'W1'))), 'the client is told once');
select test.check((select count(*) = 1 from audit_logs where action = 'SERVICE_SETUP_AUTO_STARTED' and entity_id = (select id from sj where name = 'W1')), 'the automatic start is audited');
insert into sjn select 'n', count(*) from client_notifications where customer_id = (select id from sj where name = 'W1');
update customer_onboarding set handover_stage = handover_stage, team_member_id = team_member_id, meta_status = meta_status where customer_id = (select id from sj where name = 'W1');
select private.auto_start_service_setup((select id from sj where name = 'W1'));
select test.check((select count(*) = (select n from sjn where name = 'n') from client_notifications where customer_id = (select id from sj where name = 'W1')), 'running it again creates no second notification');
select test.check((select s ->> 'state' = 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'PROVISIONING'),
  'the provisioning step follows the stored setup state');
select test.check((select s ->> 'state' <> 'DONE' from jsonb_array_elements(private.client_service_progress_one((select id from sj where name = 'W1'), 'WHATSAPP_API', true, now()) -> 'steps') s where s ->> 'key' = 'LIVE'),
  'but the service is not live: ready is a person''s authorised action');
select test.check((private.client_journey((select id from sj where name = 'W1')) -> 'progress' ->> 'percent')::int < 100, 'and the overall progress stays below 100');
-- a person takes the automatic setup over
set role authenticated;
select test.login('sup_b');
select test.check((select set_service_setup((select id from sj where name = 'W1'), 'WHATSAPP_API', 'IN_PROGRESS', 'Number registered') ->> 'status') = 'IN_PROGRESS', 'the team member can add a note to the automatically started setup');
select test.must_fail($$select set_service_setup((select id from sj where name = 'W1'), 'WHATSAPP_API', 'IN_PROGRESS', 'again')$$, 'but a second manual start is still a conflict', 'already');
reset role;
select test.check((select not setup_auto and setup_updated_by is not null from customer_services where customer_id = (select id from sj where name = 'W1') and service_code = 'WHATSAPP_API'), 'it is now recorded as a person''s');
-- the other customers' services did not start: their prerequisites are not met
select test.check((select bool_and(setup_status = 'PENDING') from customer_services where customer_id in (select id from sj where name in ('M1', 'C1', 'T1'))), 'no other customer''s service was started');

\echo '--- 116. Service journeys: staff see the live status, and nobody else sees it'
set role authenticated;
select test.login((select name from sjv));
select test.check((select customer_journey_status((select id from sj where name = 'W1')) -> 'meta' ->> 'status') = 'COMPLETED', 'the team sees the live Meta status');
select test.check((select jsonb_array_length(customer_journey_status((select id from sj where name = 'W1')) -> 'services' -> 0 -> 'progress' -> 'steps') >= 6), 'with the steps of each service');
select test.check((select (customer_journey_status((select id from sj where name = 'W1')) -> 'meta' -> 'outstanding') is not null and customer_journey_status((select id from sj where name = 'W1')) -> 'existingBlueTick' ->> 'status' = 'CONFIRMED'),
  'what is outstanding and the existing Blue Tick');
select test.login('acc_m');
select test.must_fail($$select customer_journey_status((select id from sj where name = 'W1'))$$, 'other departments do not see it', 'NOT_FOUND');
-- clients are kept apart
select test.login('sj_c1');
select test.check((select s ->> 'accountEmail' = 'calling.journey@example.com' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'PAYMENT'), 'Scenario I: a client reads only their own journey');
select test.check((select count(*) = 0 from jsonb_array_elements(client_service_progress()) p where p ->> 'code' in ('WHATSAPP_API', 'DS_META_ADS')), 'and only their own services');
select test.must_fail($$select count(*) from public.service_milestones$$, 'the milestone table is not readable directly', 'permission denied');
select test.must_fail($$select count(*) from public.meta_verification_events$$, 'nor the Meta events', 'permission denied');
select test.must_fail($$insert into public.customer_existing_blue_tick (customer_id, status) values ((select id from sj where name = 'W1'), 'CONFIRMED')$$, 'a direct write to the Blue Tick record is refused', 'permission denied');
select test.must_fail($$update public.customer_onboarding set meta_status = 'COMPLETED'$$, 'a client cannot write the Meta status directly', 'permission denied');
reset role;

\echo '--- 117. Service journeys: customers who are already live keep everything'
-- "Prov One Co" is an imported customer outside the journey: every step is done, 100 percent, nothing was reset
select test.check((select (private.client_journey(id) ->> 'completed')::boolean and (private.client_journey(id) -> 'progress' ->> 'percent')::int = 100
                     from customers where company = 'Prov One Co'), 'a live customer shows 100 percent, completed');
select test.check((select bool_and(p ->> 'status' = 'LIVE' and (p ->> 'percent')::int = 100)
                     from customers c, customer_services cs, lateral private.client_service_progress_one(c.id, cs.service_code, true, now()) p
                    where c.company = 'Prov One Co' and cs.customer_id = c.id), 'each of its services shows every step done');
select test.check((select count(*) = 0 from customer_services cs where cs.customer_id in (select id from customers where company = 'Prov One Co') and cs.setup_auto),
  'nothing of a live customer was started or changed by the automation');
select test.check((select count(*) = (select count(distinct (customer_id, service_code)) from customer_services) from customer_services), 'no service row was duplicated');
