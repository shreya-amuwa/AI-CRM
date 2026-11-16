-- =============================================================================
-- BolifyAI panel recharge reminder calls (migration 20270103000100): calls 7, 5 and 1 day before the expiry date, never twice, never to an
-- ineligible or opted-out customer, renewals withdraw the old reminders at once, the provider's reply is stored sanitized, a call result
-- completes a reminder, and only the Super Admin and HR staff can read the list. No call is ever placed here: the database only decides and records.
-- Dates are fixed (p_today / p_now). Runs after the other suites (reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- earlier suites re-apply older migrations (20261210000200 brings back the 7 / 3 / 1 decider): put this one back on top, twice (it must re-run)
\i supabase/migrations/20270103000100_bolify_recharge_reminder_calls.sql
\i supabase/migrations/20270103000100_bolify_recharge_reminder_calls.sql

\echo '--- 120. BolifyAI recharge reminder calls: 7 / 5 / 1 days, eligibility, renewals, results, monitoring'
update reminder_call_settings set email_enabled = false, whatsapp_enabled = false, allow_unknown_consent = false;
create temp table br (k text primary key, v text);
grant all on br to authenticated, service_role;
create function pg_temp.b(p_k text) returns text language sql stable as $$ select v from br where k = p_k $$;
grant execute on function pg_temp.b(text) to authenticated, service_role;

-- Seven customers whose AI Calling panel expires on 20 Jan 2027 (the example: calls on 13, 15 and 19 Jan), and one expiring 30 Jan (10 days left on 20 Jan).
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data($j${
  "customers": [
    {"row": 3, "mobile": "9000009101", "name": "Gita Sharma", "businessName": "Gita Prints (TEST)"},
    {"row": 4, "mobile": "9000009102", "name": "Hari Menon", "businessName": "Hari Motors (TEST)"},
    {"row": 5, "mobile": "9000009103", "name": "Ira Das", "businessName": "Ira Salon (TEST)"},
    {"row": 6, "mobile": "9000009104", "name": "Jai Singh", "businessName": "Jai Hardware (TEST)"},
    {"row": 7, "mobile": "9000009105", "name": "Kavya Iyer", "businessName": "Kavya Cafe (TEST)"},
    {"row": 8, "mobile": "9000009106", "name": "Lalit Jain", "businessName": "Lalit Books (TEST)"},
    {"row": 9, "mobile": "9000009107", "name": "Mona Roy", "businessName": "Mona Bakes (TEST)"},
    {"row": 10, "mobile": "9000009108", "name": "Nikhil Shah", "businessName": "Nikhil Optics (TEST)"}
  ],
  "services": [
    {"row": 3, "mobile": "9000009101", "service": "AI Calling", "plan": "Gold", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 4, "mobile": "9000009102", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 5, "mobile": "9000009103", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 6, "mobile": "9000009104", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 7, "mobile": "9000009105", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 8, "mobile": "9000009106", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 9, "mobile": "9000009107", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-20", "status": "Live"},
    {"row": 10, "mobile": "9000009108", "service": "AI Calling", "startDate": "2026-01-20", "renewsOn": "2027-01-30", "status": "Live"}
  ]}$j$::jsonb, true) ->> 'committed')::boolean), 'setup: eight customers with an AI Calling panel');
reset role;
insert into br select k, (select id::text from customers where phone = m) from (values
  ('ok', '9000009101'), ('nophone', '9000009102'), ('badphone', '9000009103'), ('optout', '9000009104'),
  ('renewed', '9000009105'), ('apierr', '9000009106'), ('timeout', '9000009107'), ('ten', '9000009108')) v(k, m);
select test.check((select count(*) = 8 and bool_and(v is not null) from br), 'setup: all eight found');
update customers set phone = null, whatsapp = null, email = 'hari.menon@example.test' where id = pg_temp.b('nophone')::uuid;   -- e-mail only, no phone
update customers set phone = '12345', whatsapp = null where id = pg_temp.b('badphone')::uuid;
create temp view mine as select * from subscription_reminders where channel = 'CALL' and customer_id::text in (select v from br);
grant select on mine to authenticated, service_role;

set role authenticated;
select test.login('sup_plain');
select set_customer_reminder_consent(pg_temp.b(k)::uuid, 'ALLOWED', 'Agreed on the onboarding call') from (values ('ok'), ('nophone'), ('badphone'), ('renewed'), ('apierr'), ('timeout'), ('ten')) v(k);
select set_customer_reminder_consent(pg_temp.b('optout')::uuid, 'DO_NOT_CALL', 'Asked not to be called');
reset role;

-- ---------------------------------------------------------------- 7, 5 and 1 day(s); never 10, 6 or 3
select sub_reminder_schedule('2027-01-10');
select test.check((select count(*) = 0 from mine), '10 days before (20 Jan): nothing; the 30 Jan panel (20 days) neither');
select test.check((select (sub_reminder_schedule('2027-01-13') ->> 'created')::int >= 7), '13 Jan (7 days before 20 Jan): the 7-day reminders');
select test.check((select count(*) = 7 and bool_and(stage = 7 and expiry_date = '2027-01-20' and status = 'SCHEDULED') from mine), 'one 7-day reminder for each of the seven, for the real expiry date');
select test.check((select bool_and(send_after = timestamptz '2027-01-13 10:00+05:30' and send_until = timestamptz '2027-01-13 19:00+05:30') from mine),
  'scheduled for 13 Jan inside the 10:00 to 19:00 IST window (stored in UTC)');
select sub_reminder_schedule('2027-01-13');
select sub_reminder_schedule('2027-01-13');
select test.check((select count(*) = 7 from mine), 'the job run twice (or three times) on the same day adds nothing: no duplicate call');
select test.check((select count(*) = 7 and count(distinct event_key) = 7 from mine), 'one unique key per customer, panel, expiry date and stage');

-- ---------------------------------------------------------------- the claim: only eligible customers
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'live', 300, timestamptz '2027-01-13 09:59+05:30')) = 0), 'before 10:00 IST nobody is called');
create temp table cl as select sub_reminder_claim(50, 'live', 300, timestamptz '2027-01-13 10:30+05:30') j;
grant select on cl to authenticated, service_role;
select test.check((select count(*) = 4 from jsonb_array_elements((select j from cl)) x where (x ->> 'customerId') in (select v from br)),
  'four are handed to the caller: valid mobile, consent, live panel');
select test.check((select status = 'SKIPPED' and reason like '%no valid Indian mobile%' from mine where customer_id = pg_temp.b('nophone')::uuid), 'no phone: skipped with the reason');
select test.check((select status = 'SKIPPED' and reason like '%no valid Indian mobile%' from mine where customer_id = pg_temp.b('badphone')::uuid), 'invalid phone: skipped with the reason');
select test.check((select status = 'SKIPPED' and reason like 'The customer asked not to be called%' from mine where customer_id = pg_temp.b('optout')::uuid), 'opted out: never called');
select test.check((select x ->> 'firstName' = 'Gita' and x ->> 'lastName' = 'Sharma' and x ->> 'phone' = '+919000009101' and (x ->> 'daysLeft')::int = 7
                     from jsonb_array_elements((select j from cl)) x where x ->> 'customerId' = pg_temp.b('ok')), 'the caller gets the first and last name, the number and the days left');

-- the renewal happens while the reminder is already claimed: the claimed one is not withdrawn (it is in flight), the next one is
update customer_services set renews_on = '2028-01-20' where customer_id = pg_temp.b('renewed')::uuid and service_code = 'AI_CALLING';

-- results: accepted with the sanitized reply; an API error; a timeout
select test.check((select sub_reminder_finish((select id from mine where customer_id = pg_temp.b('ok')::uuid), 'ACCEPTED', 'BolifyAI accepted the call request (HTTP 200).', 200, 'bf-call-1',
                     timestamptz '2027-01-13 10:31+05:30', '{"httpStatus": 200, "success": true, "message": "Call queued for 919000009101", "callId": "bf-call-1", "apiKey": "sk-should-never-be-stored"}'::jsonb) ->> 'status' = 'ACCEPTED'),
  'an accepted request is SUBMITTED (ACCEPTED), not completed');
select test.check((select provider_response = '{"httpStatus": 200, "success": true, "message": "Call queued for [number]", "callId": "bf-call-1"}'::jsonb
                          and accepted_at = timestamptz '2027-01-13 10:31+05:30' and completed_at is null from mine where customer_id = pg_temp.b('ok')::uuid),
  'the reply is stored without unknown keys and without the full number; the submission time is kept');
select test.check((select sub_reminder_finish((select id from mine where customer_id = pg_temp.b('apierr')::uuid), 'FAILED', 'BolifyAI refused the request (HTTP 401). Check BOLIFY_API_KEY.', 401, null,
                     timestamptz '2027-01-13 10:31+05:30', '{"httpStatus": 401, "message": "invalid api key"}'::jsonb) ->> 'status' = 'FAILED'), 'an API error is FAILED');
select test.check((select response_code = 401 and reason like '%HTTP 401%' and provider_response ->> 'message' = 'invalid api key' from mine where customer_id = pg_temp.b('apierr')::uuid), 'with the code, the reason and the reply');
select test.check((select sub_reminder_finish((select id from mine where customer_id = pg_temp.b('timeout')::uuid), 'FAILED', 'BolifyAI did not answer within 10 seconds. The call may or may not have been placed, so it is not retried automatically (no duplicate call).', null, null,
                     timestamptz '2027-01-13 10:31+05:30') ->> 'status' = 'FAILED'), 'a timeout is FAILED (the call may have been placed)');
select sub_reminder_finish((select id from mine where customer_id = pg_temp.b('renewed')::uuid), 'ACCEPTED', 'ok', 200, 'bf-call-2', timestamptz '2027-01-13 10:31+05:30');
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'live', 300, timestamptz '2027-01-13 12:00+05:30')) = 0
                          and (select status = 'FAILED' and attempts = 1 from mine where customer_id = pg_temp.b('timeout')::uuid)),
  'a timed-out call is not retried blindly: nothing is claimed again that day');
select test.check((select count(*) = 2 from audit_logs where action = 'SUBSCRIPTION_REMINDER_FAILED' and entity_id in (select id from mine)), 'failures are audited');

-- ---------------------------------------------------------------- call results (BolifyAI callback)
select test.check((select sub_reminder_call_result('bf-call-1', 'NOT_ANSWERED', 0, null, timestamptz '2027-01-13 10:40+05:30') ->> 'status' = 'ACCEPTED'), 'not answered: still submitted, with the outcome');
select test.check((select sub_reminder_call_result('bf-call-1', 'COMPLETED', 95, 'Customer will recharge on 18 Jan', timestamptz '2027-01-13 11:00+05:30') ->> 'status' = 'COMPLETED'), 'a completed call result: COMPLETED');
select test.check((select status = 'COMPLETED' and call_outcome = 'COMPLETED' and call_duration_seconds = 95 and completed_at = timestamptz '2027-01-13 11:00+05:30' from mine where customer_id = pg_temp.b('ok')::uuid),
  'with the duration and the time');
select test.check((select sub_reminder_call_result('bf-call-1', 'COMPLETED', 95) ->> 'changed' = 'false'), 'the same result again changes nothing');
select test.check((select sub_reminder_call_result('bf-call-1', 'FAILED') ->> 'status' = 'COMPLETED'), 'a late, older status never turns a completed call back');
select test.must_fail($$select sub_reminder_call_result('no-such-call', 'COMPLETED')$$, 'an unknown call id is not found', 'NOT_FOUND');
select test.must_fail($$select sub_reminder_call_result('bf-call-1', 'MAYBE')$$, 'an unknown outcome is refused', 'VALIDATION_ERROR');
select test.check((select count(*) >= 2 from subscription_reminder_events e join mine r on r.id = e.reminder_id where e.event = 'RESULT'), 'results are logged');

-- ---------------------------------------------------------------- the 5-day stage; a renewal withdraws the old reminders and starts a new cycle
select sub_reminder_schedule('2027-01-14');
select test.check((select count(*) = 0 from mine where stage <> 7), '6 days before: nothing new');
select sub_reminder_schedule('2027-01-15');
select test.check((select count(*) = 6 and bool_and(expiry_date = '2027-01-20') from mine where stage = 5), '15 Jan (5 days before): the 5-day reminders, not for the renewed panel');
select test.check((select count(*) = 0 from mine where customer_id = pg_temp.b('renewed')::uuid and stage = 5), 'the renewed panel gets no reminder for the old date');
-- the expiry date changes again (the panel is extended by staff): its pending reminder is withdrawn at once, before any run
update customer_services set renews_on = '2027-01-22' where customer_id = pg_temp.b('apierr')::uuid and service_code = 'AI_CALLING';
select test.check((select status = 'CANCELLED' and reason like 'The expiry date changed%' from mine where customer_id = pg_temp.b('apierr')::uuid and stage = 5), 'a changed expiry date withdraws the pending reminder at once');
select test.check((select count(*) = 1 from subscription_reminder_events e join mine r on r.id = e.reminder_id where r.customer_id = pg_temp.b('apierr')::uuid and r.stage = 5 and e.event = 'CANCELLED'), 'and logs it');
select test.check((select status = 'FAILED' from mine where customer_id = pg_temp.b('apierr')::uuid and stage = 7), 'history is kept: the earlier reminder is unchanged');
select sub_reminder_schedule('2027-01-15');
select test.check((select count(*) = 1 from mine where customer_id = pg_temp.b('apierr')::uuid and expiry_date = '2027-01-22' and stage = 7), 'the new date has its own cycle (7 days before 22 Jan)');
select sub_reminder_schedule('2027-01-19');
select test.check((select count(*) = 5 and bool_and(expiry_date = '2027-01-20') from mine where stage = 1), '19 Jan (1 day before): the 1-day reminders');
select test.check((select count(*) = 0 from mine where customer_id = pg_temp.b('ten')::uuid), 'the 30 Jan panel has nothing yet (it is 11 days away)');
select sub_reminder_schedule('2027-01-20');
select test.check((select count(*) = 0 from mine where customer_id = pg_temp.b('ten')::uuid), '10 days left: no call');
select sub_reminder_schedule('2027-01-23');
select test.check((select count(*) = 1 from mine where customer_id = pg_temp.b('ten')::uuid and stage = 7), '7 days left: its first call');
-- a cancelled panel is withdrawn at once too
update customer_services set service_status = 'CANCELLED' where customer_id = pg_temp.b('ten')::uuid and service_code = 'AI_CALLING';
select test.check((select status = 'CANCELLED' and reason like 'The service is not live (CANCELLED)%' from mine where customer_id = pg_temp.b('ten')::uuid), 'a cancelled panel is not called');

-- ---------------------------------------------------------------- monitoring: Super Admin and HR staff only
set role authenticated;
select test.login('hr_head');
select test.check((select (sub_reminder_calls('ALL', 200, 0) ->> 'total')::int >= 20), 'HR staff see the reminder calls');
select test.check((select bool_and((x ->> 'stage')::int = 5) and count(*) >= 6 from jsonb_array_elements(sub_reminder_calls('STAGE_5', 200, 0) -> 'rows') x), 'the 5-day filter');
select test.check((select bool_and(x ->> 'status' = 'COMPLETED') and count(*) >= 1 from jsonb_array_elements(sub_reminder_calls('COMPLETED', 200, 0) -> 'rows') x), 'the completed filter');
select test.check((select bool_and(x ->> 'status' = 'FAILED') and count(*) >= 2 from jsonb_array_elements(sub_reminder_calls('FAILED', 200, 0) -> 'rows') x), 'the failed filter');
select test.check((select bool_and(x ->> 'status' = 'ACCEPTED') and count(*) >= 1 from jsonb_array_elements(sub_reminder_calls('SUBMITTED', 200, 0) -> 'rows') x), 'the submitted filter');
select test.check((select bool_and(x ->> 'status' in ('SCHEDULED', 'RETRY', 'PROCESSING', 'DRY_RUN')) from jsonb_array_elements(sub_reminder_calls('PENDING', 200, 0) -> 'rows') x), 'the pending filter');
select test.check((select x ->> 'customer' = 'Gita Sharma' and x ->> 'phone' = '+91XXXXXX9101' and x ->> 'expiryDate' = '2027-01-20' and x ->> 'scheduledDate' = '2027-01-13'
                          and x ->> 'callOutcome' = 'COMPLETED' and (x ->> 'callDurationSeconds')::int = 95 and x -> 'response' ->> 'callId' = 'bf-call-1' and x ->> 'serviceName' is not null
                     from jsonb_array_elements(sub_reminder_calls('COMPLETED', 200, 0) -> 'rows') x where x ->> 'customerId' = pg_temp.b('ok')), 'a row has the customer, masked phone, dates, outcome and reply');
select test.check((select not exists (select 1 from jsonb_array_elements(sub_reminder_calls('ALL', 200, 0) -> 'rows') x where (x - 'id' - 'customerId')::text ~ '\d{10}')), 'no full phone number anywhere in the list (ids aside)');
select test.check((select jsonb_array_length(sub_reminder_calls('ALL', 2, 0) -> 'rows') = 2 and (sub_reminder_calls('ALL', 2, 0) -> 'counts' ->> 'stage5')::int >= 6), 'paginated in the database; the counts cover everything');
select test.must_fail($$select sub_reminder_calls('EVERYTHING')$$, 'an unknown filter is refused', 'VALIDATION_ERROR');
select test.login('sa');
select test.check((select (sub_reminder_calls() ->> 'total')::int >= 20), 'the Super Admin sees them too');
select test.login('tm_a');
select test.must_fail($$select sub_reminder_calls()$$, 'a Sales member cannot', 'FORBIDDEN');
select test.login('sup_plain');
select test.must_fail($$select sub_reminder_calls()$$, 'nor a Support member', 'FORBIDDEN');
select test.must_fail($$select sub_reminder_call_result('bf-call-1', 'COMPLETED')$$, 'staff cannot record call results', 'permission denied');
select test.must_fail($$select sub_reminder_finish(gen_random_uuid(), 'ACCEPTED')$$, 'nor attempts', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select sub_reminder_calls()$$, 'a visitor cannot read the list', 'permission denied');
reset role;

\echo '=== ALL BOLIFY RECHARGE REMINDER TESTS PASSED ==='
reset role;
update reminder_call_settings set email_enabled = true, whatsapp_enabled = true;
