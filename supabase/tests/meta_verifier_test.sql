-- =============================================================================
-- Meta Verifier, the verification route, the hand-over to the Department Head and the Technical Consultant's follow-up
-- (migration 20261204000200). Runs late (same database): reuses the Wabastore users the earlier suites made - late_verifier (Meta Verifier),
-- late_consultant (Technical Consultant), dh_wab (Department Head), tm_a (Sales), sup_plain (plain Support member), sa (Super Admin).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 71. Meta Verifier, verification route, hand-over and Technical Consultant follow-up'
reset role;
-- running the migrations again must change nothing (they are safe to re-run)
\i supabase/migrations/20261204000200_meta_verifier_workflow.sql
\i supabase/migrations/20261204000300_accounts_client_provisioning.sql

create temp table mv (name text primary key, id uuid);
grant all on mv to authenticated, service_role;
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
grant select on all tables in schema test to service_role;

\echo '   the role: a person is a Meta Verifier or a Technical Consultant, never both'
select test.check((select is_meta_verifier and not is_technical_consultant from profiles where id = test.id('late_verifier')), 'the Meta Verifier is not a Technical Consultant');
select test.check((select is_technical_consultant and not is_meta_verifier from profiles where id = test.id('late_consultant')), 'and the Technical Consultant is not a Meta Verifier');
select test.check((select default_dashboard = 'meta-verifier' from profiles where id = test.id('late_verifier')), 'the Meta Verifier opens their own dashboard');
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select set_meta_verifier(test.id('sup_plain'), true)$$, 'a member cannot make themselves a Meta Verifier', 'FORBIDDEN|You cannot');
select test.login('sa');
select test.must_fail($$select set_meta_verifier(test.id('late_consultant'), true)$$, 'a Technical Consultant must be made a team member first', 'Technical Consultant');
select test.must_fail($$select set_meta_verifier(test.id('tm_a'), true)$$, 'a Sales member cannot be a Meta Verifier', 'support team');
select test.must_fail($$select set_meta_verifier(test.id('dh_wab'), true)$$, 'nor a Department Head', 'FORBIDDEN|support team');
select set_meta_verifier(test.id('sup_plain'), true);
select test.check((select is_meta_verifier from profiles where id = test.id('sup_plain')), 'the Super Admin makes a support member a Meta Verifier');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'META_VERIFIER_SET' and entity_id = test.id('sup_plain')), 'and it is audited');
select test.must_fail($$update profiles set is_technical_consultant = true where id = test.id('sup_plain')$$, 'the database refuses both roles on one person', 'either a Meta Verifier or a Technical Consultant');
set role authenticated;
select test.login('sa');
select set_meta_verifier(test.id('sup_plain'), false);
reset role;
select test.check(not (select is_meta_verifier from profiles where id = test.id('sup_plain')), 'and takes it back');

\echo '   the customers: which route each one takes'
create temp table mc (name text primary key, id uuid);
grant all on mc to authenticated, service_role;
set role authenticated;
select test.login('tm_a');
insert into mc select 'wa1', create_lead('{"name":"Meta One","company":"Meta One Traders","email":"meta.one@example.com","whatsapp":"+91 98199 10001","phone":"9819910001","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
insert into mc select 'wa2', create_lead('{"name":"Meta Two","company":"Meta Two Traders","email":"meta.two@example.com","whatsapp":"+91 98199 10002","phone":"9819910002","leadSource":"Walk-in"}', array['WHATSAPP_API']);
insert into mc select 'ai1', create_lead('{"name":"Calls One","company":"Calls One Co","email":"calls.one@example.com","phone":"9819910003","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
update customers set lifecycle_stage = 'POTENTIAL', deal_amount = 1000, amount_received = 1000, stage_changed_at = now() where id in (select id from mc);
set role authenticated;
select test.login('tm_a');
select start_customer_onboarding(id, 0, 'UPI', null) from mc;
select save_onboarding_entry((select id from mc where name = 'wa1'), 'WA_WEBSITE_URL', 'www.meta-one.example');
select save_onboarding_entry((select id from mc where name = 'wa2'), 'WA_WEBSITE_URL', 'www.meta-two.example');
reset role;
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_at)
select a.id, i.code, case when i.kind = 'YES_NO' then 'YES' else 'saved' end, 'SAVED', now()
  from mc a cross join lateral private.customer_items(a.id) i
 where i.code <> 'WA_WEBSITE_URL'
on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from mc;
select private.forward_to_consultant(a.id, c, false) from mc a join customers c on c.id = a.id;
select test.check((select verification_route = 'META' from customer_onboarding where customer_id = (select id from mc where name = 'wa1'))
               and (select verification_route = 'META' from customer_onboarding where customer_id = (select id from mc where name = 'wa2'))
               and (select verification_route = 'TECHNICAL' from customer_onboarding where customer_id = (select id from mc where name = 'ai1')),
  'WhatsApp API customers go to the Meta Verifier; the other service keeps the Technical Consultant');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('late_verifier') and entity_id = (select id from mc where name = 'wa1'))
               and (select count(*) = 0 from notifications where recipient_id = test.id('late_consultant') and entity_id = (select id from mc where name = 'wa1')),
  'the Meta Verifier is told about the WhatsApp customer, the Technical Consultant is not');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('late_consultant') and entity_id = (select id from mc where name = 'ai1')),
  'and the other way round for the other service');

\echo '   the route is data: the catalogue changes, customers in flight do not move'
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select set_service_meta_verification('AI_CALLING', true)$$, 'a Department Head cannot change the catalogue', 'FORBIDDEN|Only the Super Admin');
select test.login('sa');
select set_service_meta_verification('AI_CALLING', true);
reset role;
select test.check((select verification_route = 'TECHNICAL' from customer_onboarding where customer_id = (select id from mc where name = 'ai1')),
  'a customer already in verification keeps its route when a service is added to the Meta Verifier');
select test.check((select count(*) = 1 from audit_logs where action = 'SERVICE_META_VERIFICATION_SET'), 'the catalogue change is audited');
set role authenticated;
select test.login('sa');
select set_service_meta_verification('AI_CALLING', false);
reset role;

\echo '   who can see and work on which customer'
set role authenticated;
select test.login('late_verifier');
select test.check((select count(*) = 2 from customers where id in (select id from mc where name in ('wa1', 'wa2'))), 'the Meta Verifier sees the WhatsApp customers');
select test.check((select count(*) = 0 from customers where id = (select id from mc where name = 'ai1')), 'and not the Technical Consultant''s customer');
select test.must_fail($$select consultant_set_contract((select id from mc where name = 'ai1'), true)$$, 'cannot work on it either', 'NOT_FOUND');
select test.must_fail($$select consultant_set_addons_required((select id from mc where name = 'wa1'), true)$$, 'add-ons are not part of the first verification', 'NOT_FOUND');
select test.must_fail($$select consultant_set_contract((select id from mc where name = 'wa1'), true)$$, 'nor is the consultation ("contacted")', 'NOT_FOUND');
select test.login('late_consultant');
select test.check((select count(*) = 1 from customers where id = (select id from mc where name = 'ai1')), 'the Technical Consultant sees their customer');
select test.check((select count(*) = 0 from customers where id in (select id from mc where name in ('wa1', 'wa2'))), 'and not the WhatsApp customers before they are handed over');
select test.must_fail($$select verification_note_add((select id from mc where name = 'wa1'), 'x', 'NOTE')$$, 'cannot write verification notes for them', 'NOT_FOUND');
select test.must_fail($$select verify_all_onboarding_entries((select id from mc where name = 'wa1'))$$, 'nor verify their documents', 'NOT_FOUND');
select test.login('tm_a');
select test.must_fail($$select verification_note_add((select id from mc where name = 'wa1'), 'x', 'NOTE')$$, 'Sales cannot write verification notes', 'NOT_FOUND');
select test.login('sup_plain');
select test.check((select count(*) = 0 from customers where id in (select id from mc)), 'a plain Support member sees none of them');

\echo '   verification: notes, outcomes, correction'
select test.login('late_verifier');
select consultant_start_onboarding(id) from mc where name in ('wa1', 'wa2');
select verification_note_add((select id from mc where name = 'wa1'), 'Checked the GST certificate and the shop photo.', 'NOTE');
select verification_note_add((select id from mc where name = 'wa1'), 'The address proof is blurred - ask the customer for a clear copy.', 'NEEDS_CORRECTION');
select test.must_fail($$select verification_note_add((select id from mc where name = 'wa1'), 'x', 'SOMETHING')$$, 'an unknown outcome is refused', 'Unknown outcome');
select test.must_fail($$select verification_note_add((select id from mc where name = 'wa1'), '   ', 'NOTE')$$, 'an empty note is refused', 'Write the note');
select test.check((select jsonb_array_length(verification_notes_list((select id from mc where name = 'wa1'))) = 2
                     and (verification_notes_list((select id from mc where name = 'wa1')) -> 0 ->> 'outcome') = 'NEEDS_CORRECTION'
                     and (verification_notes_list((select id from mc where name = 'wa1')) -> 0 ->> 'author') = 'Late Verifier'),
  'the history is kept, newest first, with the author');
reset role;
select test.check((select count(*) = 2 from audit_logs where action = 'VERIFICATION_NOTE_ADDED' and entity_id = (select id from mc where name = 'wa1')), 'each note is audited');
select test.check((select count(*) = 2 from customer_activities where type = 'VERIFICATION_NOTE' and customer_id = (select id from mc where name = 'wa1')), 'and is on the customer''s timeline');

\echo '   hand-over to the Department Head: validated, once, and it schedules the follow-up'
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select send_to_department_head((select id from mc where name = 'wa1'), 'ready')$$, 'not before every document is authorized', 'Authorize every');
-- the WABA ID exists only after the customer's panel is created: the verifier enters it (the Technical Consultant has no part in this stage)
select save_consultant_entry((select id from mc where name = 'wa1'), 'WABA_ID', '109876543210987');
select verify_all_onboarding_entries((select id from mc where name = 'wa1'));
select test.login('late_consultant');
select test.must_fail($$select send_to_department_head((select id from mc where name = 'wa1'), 'x')$$, 'the Technical Consultant cannot hand over a Meta customer', 'NOT_FOUND');
select test.login('tm_a');
select test.must_fail($$select send_to_department_head((select id from mc where name = 'wa1'), 'x')$$, 'nor Sales', 'NOT_FOUND');
select test.login('late_verifier');
select send_to_department_head((select id from mc where name = 'wa1'), 'All documents verified');
select test.must_fail($$select send_to_department_head((select id from mc where name = 'wa1'), 'again')$$, 'it cannot be handed over twice', 'NOT_FOUND');
select test.must_fail($$select verification_note_add((select id from mc where name = 'wa1'), 'late note', 'NOTE')$$, 'and the verifier''s review is closed afterwards', 'NOT_FOUND');
reset role;
select test.check((select handover_stage = 'DEPARTMENT_HEAD' from customer_onboarding where customer_id = (select id from mc where name = 'wa1')), 'the customer is with the Department Head');
select test.check((select count(*) = 1 from customers where id = (select id from mc where name = 'wa1')), 'still exactly one customer record (nothing duplicated)');
select test.check((select count(*) = 1 from tc_followups where customer_id = (select id from mc where name = 'wa1') and status = 'AWAITING_CONFIGURATION' and due_at is null),
  'a follow-up exists but the number of days is not decided, so it waits (no invented default)');
select test.check((select tc_followup_delay_days is null from workflow_settings where id), 'the delay has no default');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('dh_wab') and entity_id = (select id from mc where name = 'wa1')), 'the Department Head is told');
insert into mv select 'fu1', id from tc_followups where customer_id = (select id from mc where name = 'wa1');
-- the same hand-over event arriving again creates nothing new
select private.schedule_tc_followup((select id from mc where name = 'wa1'), 'again');
select test.check((select count(*) = 1 from tc_followups where customer_id = (select id from mc where name = 'wa1')), 'no duplicate follow-up');
select test.check((select count(*) = 1 from audit_logs where action = 'TC_FOLLOWUP_SCHEDULED' and entity_id = (select id from mc where name = 'wa1')), 'and no duplicate audit record');

\echo '   the Technical Consultant now sees the customer (and the verification history)'
set role authenticated;
select test.login('late_consultant');
select test.check((select count(*) = 1 from customers where id = (select id from mc where name = 'wa1')), 'after the hand-over the Technical Consultant can see the customer');
select test.check((select jsonb_array_length(verification_notes_list((select id from mc where name = 'wa1'))) = 2), 'and read the verification notes');
select test.check(jsonb_array_length(tc_followups_list('OPEN')) = 1 and (tc_followups_list('OPEN') -> 0 ->> 'effectiveStatus') = 'AWAITING_CONFIGURATION',
  'the follow-up shows in their list, waiting for the delay');
select test.must_fail($$select tc_followup_record((select id from mv where name = 'fu1'), 'CALL', 'CONTACTED', 'x', null)$$, 'it cannot be worked on before it is scheduled', 'waiting');
select test.login('late_verifier');
select test.must_fail($$select tc_followups_list('ALL')$$, 'the Meta Verifier does not see the consultant''s follow-ups', 'Only Technical Consultants');
select test.login('tm_a');
select test.must_fail($$select tc_followups_list('OPEN')$$, 'Sales cannot read them', 'FORBIDDEN|NOT_FOUND|permission');

\echo '   the delay: only the Super Admin, never a default, applies to waiting follow-ups'
select test.login('dh_wab');
select test.must_fail($$select set_tc_followup_delay(3)$$, 'a Department Head cannot set it', 'Only the Super Admin');
select test.login('sa');
select test.must_fail($$select set_tc_followup_delay(0)$$, 'zero days is refused', 'from 1 to 365');
select test.must_fail($$select set_tc_followup_delay(400)$$, 'and so is more than a year', 'from 1 to 365');
select set_tc_followup_delay(3);
reset role;
select test.check((select status = 'SCHEDULED' and due_at = eligible_at + interval '3 days' from tc_followups where customer_id = (select id from mc where name = 'wa1')),
  'the waiting follow-up is scheduled the moment the delay is set (counted from the hand-over)');
select test.check((select count(*) = 1 from audit_logs where action = 'TC_FOLLOWUP_DELAY_SET'), 'the setting is audited');
set role authenticated;
select test.login('sa');
select set_tc_followup_delay(5);
reset role;
select test.check((select due_at = eligible_at + interval '3 days' from tc_followups where customer_id = (select id from mc where name = 'wa1')), 'changing the delay later does not move a follow-up that is already scheduled');

\echo '   the scheduled job: not early, once, revalidated'
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select tc_followups_process_due()$$, 'a browser session cannot run the job', 'permission denied');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);   -- the cron job has no signed-in user
set role service_role;
select test.check((tc_followups_process_due() ->> 'due')::int = 0, 'before the due date nothing happens');
reset role;
select test.check((select status = 'SCHEDULED' from tc_followups where customer_id = (select id from mc where name = 'wa1')), 'the follow-up is still scheduled');
update tc_followups set due_at = now() - interval '1 minute' where customer_id = (select id from mc where name = 'wa1');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);   -- the cron job has no signed-in user
set role service_role;
select test.check((tc_followups_process_due() ->> 'due')::int = 1, 'when the date has passed the job marks it due');
select test.check((tc_followups_process_due() ->> 'due')::int = 0, 'running the job again does nothing more');
reset role;
select test.check((select status = 'DUE' and due_notified_at is not null from tc_followups where customer_id = (select id from mc where name = 'wa1')), 'it is DUE and remembers that it notified');
select test.check((select count(*) = 1 from notifications where type = 'TC_FOLLOWUP_DUE' and entity_id = (select id from mc where name = 'wa1')), 'exactly one "due" notification, to the consultant');
select test.check((select recipient_id = test.id('late_consultant') from notifications where type = 'TC_FOLLOWUP_DUE' and entity_id = (select id from mc where name = 'wa1')), 'addressed to the Technical Consultant');

\echo '   recording the consultation'
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select tc_followup_record((select id from mv where name = 'fu1'), 'PIGEON', 'CONTACTED', null, null)$$, 'an unknown channel is refused', 'how you contacted');
select test.must_fail($$select tc_followup_record((select id from mv where name = 'fu1'), 'CALL', 'NO_ANSWER', null, null)$$, 'a missed call needs the next date', 'next follow-up');
select test.must_fail($$select tc_followup_record((select id from mv where name = 'fu1'), 'CALL', 'CALL_BACK', null, now() - interval '1 day')$$, 'which must be in the future', 'future');
select test.check((tc_followup_record((select id from mv where name = 'fu1'), 'CALL', 'NO_ANSWER', 'Phone was switched off', now() + interval '2 days') ->> 'status') = 'SCHEDULED',
  'a missed call reschedules the follow-up');
reset role;
select test.check((select due_notified_at is null and due_at > now() from tc_followups where id = (select id from mv where name = 'fu1')), 'with the new date, and it can notify again when that date comes');
update tc_followups set due_at = now() - interval '1 minute' where id = (select id from mv where name = 'fu1');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);   -- the cron job has no signed-in user
set role service_role;
select test.check((tc_followups_process_due() ->> 'due')::int = 1, 'the rescheduled follow-up falls due again');
reset role;
set role authenticated;
select test.login('late_consultant');
select test.check((tc_followup_record((select id from mv where name = 'fu1'), 'WHATSAPP', 'ADDON_INTERESTED', 'Wants to know about a catalogue add-on', null) ->> 'status') = 'DUE',
  'an open outcome keeps it open (the add-on discussion continues in the existing add-on workflow)');
select test.check((tc_followup_record((select id from mv where name = 'fu1'), 'CALL', 'COMPLETED', 'Consultation done', null) ->> 'status') = 'DONE', 'a completed consultation closes it');
select test.must_fail($$select tc_followup_record((select id from mv where name = 'fu1'), 'CALL', 'CONTACTED', null, null)$$, 'a finished follow-up cannot be recorded again', 'already finished');
reset role;
select test.check((select count(*) = 3 from tc_followup_contacts where customer_id = (select id from mc where name = 'wa1')), 'every contact attempt is kept as history');
select test.check((select count(*) = 1 from consultant_notes where customer_id = (select id from mc where name = 'wa1') and body like 'Follow-up (call, completed)%'), 'the notes join the customer''s consultation notes');

\echo '   a follow-up for a customer who no longer qualifies is cancelled, not executed'
-- a second customer, handed over now
set role authenticated;
select test.login('late_verifier');
select save_consultant_entry((select id from mc where name = 'wa2'), 'WABA_ID', '109876543210988');
select verify_all_onboarding_entries((select id from mc where name = 'wa2'));
select send_to_department_head((select id from mc where name = 'wa2'), 'ready');
reset role;
select test.check((select status = 'SCHEDULED' and due_at > now() + interval '4 days' from tc_followups where customer_id = (select id from mc where name = 'wa2')), 'the second customer is scheduled with the delay that is set now');
update customers set lifecycle_stage = 'LEAD' where id = (select id from mc where name = 'wa2');
select test.check((select status = 'CANCELLED' and cancelled_reason is not null from tc_followups where customer_id = (select id from mc where name = 'wa2')), 'a customer who leaves onboarding cancels the follow-up at once');
-- the job also revalidates by itself (here with the trigger off, as if the change had come in some other way)
update customers set lifecycle_stage = 'ONBOARDING' where id = (select id from mc where name = 'wa2');
select private.schedule_tc_followup((select id from mc where name = 'wa2'), 'rescheduled after the customer returned');
select test.check((select count(*) = 1 from tc_followups where customer_id = (select id from mc where name = 'wa2') and status = 'SCHEDULED'), 'a returning customer can be scheduled again (the cancelled one stays as history)');
alter table customers disable trigger customers_cancel_followups;
update customers set lifecycle_stage = 'LEAD' where id = (select id from mc where name = 'wa2');
update tc_followups set due_at = now() - interval '1 minute' where customer_id = (select id from mc where name = 'wa2') and status = 'SCHEDULED';
create temp table pdr (j jsonb);
grant all on pdr to service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);   -- the cron job has no signed-in user
set role service_role;
insert into pdr select tc_followups_process_due();
reset role;
select test.check((select (j ->> 'cancelled')::int = 1 and (j ->> 'due')::int = 0 from pdr), 'the job cancels an obsolete follow-up instead of notifying');
alter table customers enable trigger customers_cancel_followups;
select test.check((select count(*) = 0 from notifications where type = 'TC_FOLLOWUP_DUE' and entity_id = (select id from mc where name = 'wa2')), 'and nobody was notified about it');

\echo '   re-routing a customer already in verification'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select reroute_verification((select id from mc where name = 'ai1'), 'META', 'because')$$, 'Sales cannot re-route', 'NOT_FOUND');
select test.login('dh_wab');
select test.must_fail($$select reroute_verification((select id from mc where name = 'ai1'), 'META', '')$$, 'a reason is required', 'reason');
select test.must_fail($$select reroute_verification((select id from mc where name = 'ai1'), 'ELSEWHERE', 'because')$$, 'and a known route', 'Meta Verifier or the Technical Consultant');
select test.check(not exists (select 1 from jsonb_array_elements(verification_route_review()) e where (e ->> 'customerId')::uuid = (select id from mc where name = 'ai1')), 'a customer on the route its services ask for is not listed for review');
select reroute_verification((select id from mc where name = 'ai1'), 'META', 'The customer also bought the WhatsApp API');
reset role;
select test.check((select verification_route = 'META' from customer_onboarding where customer_id = (select id from mc where name = 'ai1')), 'the Department Head moved the customer to the Meta Verifier');
select test.check((select count(*) = 1 from audit_logs where action = 'VERIFICATION_REROUTED' and entity_id = (select id from mc where name = 'ai1')), 'and it is audited');
set role authenticated;
select test.login('late_verifier');
select test.check((select count(*) = 1 from customers where id = (select id from mc where name = 'ai1')), 'the Meta Verifier now sees it');
select test.login('late_consultant');
select test.check((select count(*) = 0 from customers where id = (select id from mc where name = 'ai1')), 'and the Technical Consultant no longer does');
select test.login('dh_wbx');
select test.must_fail($$select reroute_verification((select id from mc where name = 'ai1'), 'TECHNICAL', 'not mine')$$, 'a Department Head of another department cannot', 'NOT_FOUND');
reset role;

\echo '   the follow-up needs a consultant: without one the Department Head is told'
update profiles set status = 'SUSPENDED' where is_technical_consultant and department_id = (select department_id from customers where id = (select id from mc where name = 'wa1'));
select test.check(private.pick_consultant((select department_id from customers where id = (select id from mc where name = 'wa1'))) is null, 'no active Technical Consultant: nobody is picked');
select private.schedule_tc_followup((select id from mc where name = 'ai1'), 'Handed over');
select test.check((select assigned_to is null and status = 'SCHEDULED' from tc_followups where customer_id = (select id from mc where name = 'ai1') and status <> 'CANCELLED'), 'the follow-up is created unassigned');
update tc_followups set due_at = now() - interval '1 minute' where customer_id = (select id from mc where name = 'ai1') and status = 'SCHEDULED';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select tc_followups_process_due();
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'TC_FOLLOWUP_DUE' and entity_id = (select id from mc where name = 'ai1') and recipient_id = test.id('dh_wab')),
  'the Department Head is told that a consultation is due and nobody can take it');
update profiles set status = 'ACTIVE' where is_technical_consultant and department_id = (select department_id from customers where id = (select id from mc where name = 'wa1'));

\echo '   running the migration once more, with data in place, changes nothing'
create temp table mv_before as
  select (select jsonb_agg(jsonb_build_array(customer_id, verification_route) order by customer_id) from customer_onboarding where verification_route is not null) as routes,
         (select count(*) from tc_followups) as followups, (select count(*) from verification_notes) as notes,
         (select tc_followup_delay_days from workflow_settings where id) as delay;
\i supabase/migrations/20261204000200_meta_verifier_workflow.sql
select test.check((select routes = (select jsonb_agg(jsonb_build_array(customer_id, verification_route) order by customer_id) from customer_onboarding where verification_route is not null) from mv_before),
  'every customer keeps the route it was pinned to (a re-run never moves work in flight)');
select test.check((select followups = (select count(*) from tc_followups) and notes = (select count(*) from verification_notes) and delay is not distinct from (select tc_followup_delay_days from workflow_settings where id) from mv_before),
  'and no follow-up, note or setting was added, lost or changed');
