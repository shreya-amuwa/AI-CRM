-- =============================================================================
-- Messaging services (WhatsApp API + Blue Tick, WhatsApp API, Blue Tick, RCS Registration): the Meta Verifier owns the initial onboarding,
-- the Technical Consultant keeps consultation and add-ons (migration 20261231000100). Reuses late_verifier (Meta Verifier), late_consultant
-- (Technical Consultant), dh_wab (Department Head), tm_a (Sales) and sa from the earlier suites.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 131. Messaging onboarding: Meta Verifier first, Technical Consultant for consultation'
reset role;
\i supabase/migrations/20261231000100_messaging_onboarding_meta_verifier.sql
\i supabase/migrations/20261231000100_messaging_onboarding_meta_verifier.sql
delete from customers where email in ('rcs.one@example.com', 'mix.one@example.com', 'calls.two@example.com', 'old.wa@example.com');

select test.check((select bool_and(meta_verifier_onboarding) from crm_services where code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK', 'RCS_REGISTRATION')),
  'the four Messaging services are onboarded by the Meta Verifier');
select test.check((select bool_and(requires_meta_verification) from crm_services where code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK'))
                  and not (select requires_meta_verification from crm_services where code = 'RCS_REGISTRATION'),
  'the WhatsApp services need Meta approval; RCS does not get a false Meta approval step');
select test.check(private.service_track('RCS_REGISTRATION') = 'TECHNICAL' and private.service_track('WHATSAPP_API') = 'META',
  'so RCS keeps its own client milestones ("Verification by our team"), WhatsApp keeps the Meta ones');
select test.check((select not meta_verifier_onboarding from crm_services where code = 'AI_CALLING'), 'an unrelated service is not touched');

create temp table mo (name text primary key, id uuid);
grant all on mo to authenticated, service_role;
set role authenticated;
select test.login('tm_a');
insert into mo select 'rcs', create_lead('{"name":"Rcs One","company":"Rcs One Co","email":"rcs.one@example.com","phone":"9819920001","leadSource":"Walk-in"}', array['RCS_REGISTRATION']);
insert into mo select 'mix', create_lead('{"name":"Mix One","company":"Mix One Co","email":"mix.one@example.com","phone":"9819920002","leadSource":"Walk-in"}', array['RCS_REGISTRATION', 'AI_CALLING']);
insert into mo select 'ai', create_lead('{"name":"Calls Two","company":"Calls Two Co","email":"calls.two@example.com","phone":"9819920003","leadSource":"Walk-in"}', array['AI_CALLING']);
insert into mo select 'old', create_lead('{"name":"Old Wa","company":"Old Wa Co","email":"old.wa@example.com","whatsapp":"+91 98199 20004","phone":"9819920004","leadSource":"Walk-in"}', array['WHATSAPP_API']);
reset role;
update customers set lifecycle_stage = 'POTENTIAL', deal_amount = 1000, amount_received = 1000, stage_changed_at = now() where id in (select id from mo);
set role authenticated;
select test.login('tm_a');
select start_customer_onboarding(id, 0, 'UPI', null) from mo;
reset role;
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_at)
select a.id, i.code, case when i.kind = 'YES_NO' then 'YES' else 'saved' end, 'SAVED', now()
  from mo a cross join lateral private.customer_items(a.id) i
on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from mo;
select private.forward_to_consultant(a.id, c, false) from mo a join customers c on c.id = a.id;

\echo '   the route follows the services (Sales -> Accounts -> Sales -> Meta Verifier + Technical Consultant, unchanged)'
select test.check((select verification_route = 'META' from customer_onboarding where customer_id = (select id from mo where name = 'rcs')), 'an RCS customer goes to the Meta Verifier');
select test.check((select verification_route = 'META' from customer_onboarding where customer_id = (select id from mo where name = 'mix')), 'so does a customer with RCS and another service');
select test.check((select verification_route = 'TECHNICAL' from customer_onboarding where customer_id = (select id from mo where name = 'ai')), 'a customer without a Messaging service stays with the Technical Consultant');
select test.check((select count(*) = 1 from customers where id = (select id from mo where name = 'rcs')), 'one customer record (nothing copied)');

\echo '   a Messaging customer that was already with the Technical Consultant moves to the Meta Verifier; its documents keep their state'
update customer_onboarding set verification_route = 'TECHNICAL' where customer_id = (select id from mo where name = 'old');
update customer_onboarding_entries set status = 'VERIFIED' where customer_id = (select id from mo where name = 'old')
   and item_code = (select min(item_code) from customer_onboarding_entries where customer_id = (select id from mo where name = 'old'));
create temp table mo_before as select item_code, status, value from customer_onboarding_entries where customer_id = (select id from mo where name = 'old');
\i supabase/migrations/20261231000100_messaging_onboarding_meta_verifier.sql
select test.check((select verification_route = 'META' from customer_onboarding where customer_id = (select id from mo where name = 'old')), 'the in-flight WhatsApp customer is now with the Meta Verifier');
select test.check(not exists (select item_code, status, value from mo_before except select item_code, status, value from customer_onboarding_entries where customer_id = (select id from mo where name = 'old'))
                  and (select count(*) from mo_before) = (select count(*) from customer_onboarding_entries where customer_id = (select id from mo where name = 'old')),
  'no document, value or review state changed');
select test.check((select count(*) = 1 from audit_logs where action = 'VERIFICATION_REROUTED' and entity_id = (select id from mo where name = 'old') and metadata ->> 'previousRoute' = 'TECHNICAL'),
  'the move is audited with the previous route');
select test.check((select count(*) = 1 from customer_activities where type = 'VERIFICATION_REROUTED' and customer_id = (select id from mo where name = 'old')), 'and is on the customer''s timeline');

\echo '   the Technical Consultant cannot do the initial onboarding of a Messaging customer'
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select review_onboarding_entry((select id from mo where name = 'rcs'), (select min(item_code) from customer_onboarding_entries where customer_id = (select id from mo where name = 'rcs')), 'VERIFIED', null)$$,
  'cannot authorize an initial document', 'FORBIDDEN');
select test.must_fail($$select review_onboarding_entry((select id from mo where name = 'old'), (select max(item_code) from customer_onboarding_entries where customer_id = (select id from mo where name = 'old')), 'REJECTED', 'blurred')$$,
  'nor reject one', 'FORBIDDEN');
select test.must_fail($$select verify_all_onboarding_entries((select id from mo where name = 'rcs'))$$, 'nor use Verify All', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select return_onboarding_to_sales((select id from mo where name = 'rcs'), 'fix it')$$, 'nor return the documents to Sales', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select send_to_department_head((select id from mo where name = 'rcs'), 'done')$$, 'nor hand the customer to the Department Head', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select mark_meta_verification_completed((select id from mo where name = 'old'))$$, 'nor record the Meta verification as completed', 'FORBIDDEN');
select test.must_fail($$select panel_details_set((select id from mo where name = 'rcs'), 'RCS_REGISTRATION', 'Google RBM', 'agent-1')$$, 'nor change the messaging panel details', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select customer_workflow_set_tc((select id from mo where name = 'rcs'), 'VERIFICATION_IN_PROGRESS', null)$$, 'nor claim the initial verification on its own status', 'FORBIDDEN');
select test.check((select (onboarding_review_scope((select id from mo where name = 'rcs')) ->> 'initialOwner') = 'META_VERIFIER'
                     and not (onboarding_review_scope((select id from mo where name = 'rcs')) ->> 'canReviewAll')::boolean), 'the screen is told the Meta Verifier owns it');

\echo '   ... but keeps consultation and add-ons'
select test.check((select count(*) = 1 from customers where id = (select id from mo where name = 'rcs')), 'the Technical Consultant still sees the customer');
select test.check(private.can_consult_customer((select id from mo where name = 'rcs')), 'and may consult it');
select consultant_set_addons_required((select id from mo where name = 'rcs'), true);
reset role;
select test.check((select addons_required from customer_onboarding where customer_id = (select id from mo where name = 'rcs')), 'the add-on recommendation is recorded by the Technical Consultant');
select private.wf_refresh(id) from mo;
create temp table mo_item as select i.code from private.customer_items((select id from mo where name = 'mix')) i where i.always_required limit 1;
grant select on mo_item to authenticated;
select test.check((select tc_status not in ('VERIFICATION_PENDING', 'VERIFICATION_IN_PROGRESS') from customer_workflow_status where customer_id = (select id from mo where name = 'old')),
  'the Technical Consultant status no longer says the TC verifies it');
set role authenticated;

\echo '   a mixed customer: the items of the other service stay the Technical Consultant''s'
select test.login('late_consultant');
select test.check((select onboarding_review_scope((select id from mo where name = 'mix')) -> 'consultantItems' ? 'AI_CALL_CUSTOMER_NUMBER'), 'the AI Calling items are listed as the consultant''s');
select review_onboarding_entry((select id from mo where name = 'mix'), 'AI_CALL_CUSTOMER_NUMBER', 'VERIFIED', null);
reset role;
select test.check((select status = 'VERIFIED' from customer_onboarding_entries where customer_id = (select id from mo where name = 'mix') and item_code = 'AI_CALL_CUSTOMER_NUMBER'),
  'the Technical Consultant authorizes an item of the separately bought service');
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select review_onboarding_entry((select id from mo where name = 'mix'), (select code from mo_item), 'VERIFIED', null)$$,
  'but not an item every customer gives (the Meta Verifier''s)', 'FORBIDDEN');
select test.must_fail($$select verify_all_onboarding_entries((select id from mo where name = 'mix'))$$, 'nor Verify All for the mixed customer', 'NOT_FOUND|FORBIDDEN');

\echo '   a customer without a Messaging service: the Technical Consultant verifies as before'
select verify_all_onboarding_entries((select id from mo where name = 'ai'));
reset role;
select test.check((select review_state = 'VERIFIED' from customer_onboarding where customer_id = (select id from mo where name = 'ai')), 'Verify All still works for the Technical Consultant''s own route');
set role authenticated;

\echo '   the Meta Verifier does the initial onboarding (documents, panel details, hand-over readiness)'
select test.login('late_verifier');
select test.check((select count(*) = 3 from customers where id in (select id from mo where name in ('rcs', 'mix', 'old'))), 'the Meta Verifier reaches the Messaging customers');
select test.check(private.can_review_onboarding((select id from mo where name = 'rcs')) and private.can_review_onboarding((select id from mo where name = 'old')), 'and may review them');
select review_onboarding_entry((select id from mo where name = 'old'), (select max(item_code) from customer_onboarding_entries where customer_id = (select id from mo where name = 'old')), 'REJECTED', 'Upload a clear copy');
select verify_all_onboarding_entries((select id from mo where name = 'rcs'));
select panel_details_set((select id from mo where name = 'rcs'), 'RCS_REGISTRATION', 'Google RBM', 'rcs-agent-01');
select test.check((select x ->> 'platform' = 'Google RBM' and x ->> 'panelAccount' = 'rcs-agent-01'
                     from jsonb_array_elements(panel_details_list((select id from mo where name = 'rcs')) -> 'services') x where x ->> 'code' = 'RCS_REGISTRATION'),
  'the Meta Verifier saves the RCS panel platform and account ID');
select test.check(not private.can_review_onboarding((select id from mo where name = 'ai')), 'and has nothing to do with the customer without a Messaging service');
reset role;
select test.check((select review_state = 'VERIFIED' from customer_onboarding where customer_id = (select id from mo where name = 'rcs')), 'the Meta Verifier authorized the documents');
select test.check((select status = 'REJECTED' and review_note = 'Upload a clear copy' from customer_onboarding_entries where customer_id = (select id from mo where name = 'old')
                    and item_code = (select max(item_code) from customer_onboarding_entries where customer_id = (select id from mo where name = 'old'))),
  'and sends a document back for correction');
select test.check((select count(*) >= 1 from customer_services where customer_id = (select id from mo where name = 'mix')) and
                  (select status = 'VERIFIED' from customer_onboarding_entries where customer_id = (select id from mo where name = 'mix') and item_code = 'AI_CALL_CUSTOMER_NUMBER'),
  'the mixed customer keeps each service''s own progress');
set role authenticated;
select test.login('dh_wab');
select test.check(private.can_review_onboarding((select id from mo where name = 'rcs')), 'the Department Head keeps oversight');
reset role;
