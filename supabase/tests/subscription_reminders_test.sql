-- =============================================================================
-- Subscription expiry reminders (migration 20261112000100): the daily decider, the claim queue, consent, the call window,
-- renewals, retries, and who may do what. No call is ever placed here: the database only decides and records.
-- Dates are fixed (p_today / p_now), so the result never depends on the real day.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 56. Subscription reminders: scheduling, consent, window, renewals, retries'
reset role;
create temp table sr (k text primary key, v text);
grant all on sr to authenticated, service_role;
create function pg_temp.g(p_k text) returns text language sql stable as $$ select v from sr where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated, service_role;

-- Six customers of the Support team (each with an AI Calling service), added by the Support member sup_plain.
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data($j${
  "customers": [
    {"row": 3, "mobile": "9000000501", "name": "Asha Verma", "businessName": "Asha Stores (TEST)"},
    {"row": 4, "mobile": "9000000502", "name": "Bharat Rao", "businessName": "Bharat Mart (TEST)"},
    {"row": 5, "mobile": "9000000503", "name": "Chitra Nair", "businessName": "Chitra Foods (TEST)"},
    {"row": 6, "mobile": "9000000504", "name": "Dev Patel", "businessName": "Dev Tech (TEST)"},
    {"row": 7, "mobile": "9000000505", "name": "Esha Gupta", "businessName": "Esha Boutique (TEST)"},
    {"row": 8, "mobile": "9000000506", "name": "Farid Khan", "businessName": "Farid Traders (TEST)"}
  ],
  "services": [
    {"row": 3, "mobile": "9000000501", "service": "AI Calling", "plan": "Gold", "startDate": "2026-01-01", "renewsOn": "2026-12-17", "status": "Live"},
    {"row": 4, "mobile": "9000000502", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2026-12-17", "status": "Live"},
    {"row": 5, "mobile": "9000000503", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2026-12-17", "status": "Live"},
    {"row": 6, "mobile": "9000000504", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2026-12-17", "status": "Live"},
    {"row": 7, "mobile": "9000000505", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2026-12-17", "status": "Live"},
    {"row": 8, "mobile": "9000000506", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2026-12-17", "status": "Live"}
  ]}$j$::jsonb, true) ->> 'committed')::boolean), 'setup: six customers with a service that expires on 17 Dec 2026');
reset role;
insert into sr select 'a', id::text from customers where phone = '9000000501';
insert into sr select 'b', id::text from customers where phone = '9000000502';
insert into sr select 'c', id::text from customers where phone = '9000000503';
insert into sr select 'd', id::text from customers where phone = '9000000504';
insert into sr select 'e', id::text from customers where phone = '9000000505';
insert into sr select 'f', id::text from customers where phone = '9000000506';
select test.check((select count(*) = 6 and bool_and(lifecycle_stage = 'CUSTOMER') from customers where id::text in (select v from sr)), 'setup: they are customers');
-- numbers: E has a number that is not a mobile
update customers set phone = '12345', whatsapp = null where id = pg_temp.g('e')::uuid;

-- ---------------------------------------------------------------- the daily decider
select test.check((select (sub_reminder_schedule('2026-12-09') ->> 'created')::int = 0), 'eight days before: nothing is due');
select test.check((select (sub_reminder_schedule('2026-12-10') ->> 'created')::int >= 6), 'seven days before: a reminder for each of the six');
select test.check((select count(*) = 6 from subscription_reminders where stage = 7 and expiry_date = '2026-12-17' and customer_id::text in (select v from sr)),
  'exactly one 7-day reminder per customer');
select test.check((select (sub_reminder_schedule('2026-12-10') ->> 'created')::int = 0), 'running the scheduler again creates nothing (no duplicates)');
select test.check((select (sub_reminder_schedule('2026-12-10') ->> 'created')::int = 0 and count(*) = 6 from subscription_reminders where stage = 7 and customer_id::text in (select v from sr)),
  'and still one each');
select test.check((select send_after = timestamptz '2026-12-10 10:00+05:30' and send_until = timestamptz '2026-12-10 19:00+05:30'
                     from subscription_reminders where customer_id = pg_temp.g('a')::uuid and stage = 7),
  'the call window is 10:00 to 19:00 Indian time on that day, never midnight');
select test.check((select (sub_reminder_schedule('2026-12-11') ->> 'created')::int = 0), 'six days before: nothing (stages are exactly 7, 3 and 1)');
select test.check((select count(*) = 6 from subscription_reminder_events e join subscription_reminders r on r.id = e.reminder_id
                    where e.event = 'CREATED' and r.stage = 7 and r.customer_id::text in (select v from sr)), 'every reminder has a creation record');
-- customers that are not customers (a lead) are never scheduled
select test.check((select count(*) = 0 from subscription_reminders r join customers c on c.id = r.customer_id where c.lifecycle_stage <> 'CUSTOMER'), 'only customers are scheduled');

-- ---------------------------------------------------------------- consent, number, window (claim at a fixed time)
-- A has agreed; B has no record; C asked not to be called; D has agreed; E agreed but has no mobile; F has agreed.
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select set_customer_reminder_consent(pg_temp.g('a')::uuid, 'ALLOWED')$$, 'consent needs a note saying how it was obtained', 'how the customer agreed');
select test.check((select set_customer_reminder_consent(pg_temp.g('a')::uuid, 'ALLOWED', 'Agreed on the phone on 3 Dec') ->> 'status' = 'ALLOWED'), 'a Support member records consent');
select set_customer_reminder_consent(pg_temp.g('c')::uuid, 'DO_NOT_CALL', 'Asked us to stop calling');
select set_customer_reminder_consent(pg_temp.g('d')::uuid, 'ALLOWED', 'Signed the form');
select set_customer_reminder_consent(pg_temp.g('e')::uuid, 'ALLOWED', 'Signed the form');
select set_customer_reminder_consent(pg_temp.g('f')::uuid, 'ALLOWED', 'Signed the form');
select test.check((select customer_reminder_consent_get(pg_temp.g('b')::uuid) ->> 'status' = 'UNKNOWN'), 'no record reads as unknown');
select test.check((select customer_reminder_consent_get(pg_temp.g('a')::uuid) ->> 'note' = 'Agreed on the phone on 3 Dec'), 'and a record reads back with its note');
select test.login('tm_a');
select test.must_fail($$select set_customer_reminder_consent(pg_temp.g('a')::uuid, 'DO_NOT_CALL')$$, 'a Sales member cannot change consent of a Support customer', 'not found');
select test.must_fail($$select customer_reminder_consent_get(pg_temp.g('a')::uuid)$$, 'nor read it', 'not found');
select test.must_fail($$select set_customer_reminder_consent(pg_temp.g('a')::uuid, 'MAYBE')$$, 'an unknown status is refused', 'Choose');
reset role;
select test.check((select count(*) >= 5 from audit_logs where action = 'CUSTOMER_CALL_CONSENT_CHANGED'), 'consent changes are audited');

-- before the window opens: nothing is claimed
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-10 09:30+05:30')) = 0), 'before 10:00 nothing is claimed');
select test.check((select count(*) = 6 from subscription_reminders where stage = 7 and status = 'SCHEDULED' and customer_id::text in (select v from sr)), 'and the reminders still wait');

-- inside the window
create temp table cl as select sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-10 10:30+05:30') as j;
grant all on cl to authenticated, service_role;
select test.check((select count(*) = 3 from jsonb_array_elements((select j from cl)) x where (x ->> 'customerId') in (select v from sr)),
  'only A, D and F are claimed (consent + a valid mobile)');
select test.check((select x ->> 'phone' = '+919000000501' and x ->> 'firstName' = 'Asha' and x ->> 'lastName' = 'Verma' and x ->> 'serviceName' = 'AI Calling'
                          and x ->> 'planName' = 'Gold' and x ->> 'expiryDate' = '2026-12-17' and (x ->> 'daysLeft')::int = 7 and (x ->> 'stage')::int = 7
                     from jsonb_array_elements((select j from cl)) x where x ->> 'customerId' = pg_temp.g('a')::uuid::text),
  'the call details are the customer, the number in +91 form, the service, the expiry date and the days left');
select test.check((select not (x ? 'email') and not (x ? 'address') from jsonb_array_elements((select j from cl)) x where x ->> 'customerId' = pg_temp.g('a')::uuid::text),
  'and nothing else about the customer is handed over');
select test.check((select status = 'SKIPPED' and reason like 'No call consent%' from subscription_reminders where customer_id = pg_temp.g('b')::uuid and stage = 7), 'no consent record: skipped, with the reason');
select test.check((select status = 'SKIPPED' and reason like 'The customer asked not to be called%' from subscription_reminders where customer_id = pg_temp.g('c')::uuid and stage = 7), 'do not call: skipped');
select test.check((select status = 'SKIPPED' and reason like '%no valid Indian mobile%' from subscription_reminders where customer_id = pg_temp.g('e')::uuid and stage = 7), 'no valid mobile: skipped');
select test.check((select status = 'PROCESSING' and attempts = 1 and phone_masked = '+91XXXXXX0501' and locked_until = timestamptz '2026-12-10 10:35+05:30' from subscription_reminders where customer_id = pg_temp.g('a')::uuid and stage = 7),
  'a claimed reminder is PROCESSING, attempt 1, with a masked number and a lease');
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-10 10:30+05:30')) = 0), 'a second claim takes nothing (nobody is called twice)');

-- results
select test.must_fail($$select sub_reminder_finish(pg_temp.g('a')::uuid, 'DRY_RUN')$$, 'an id that is not a reminder is refused', 'not being processed');
create temp table ids as select r.customer_id, r.id from subscription_reminders r where r.stage = 7 and r.customer_id::text in (select v from sr);
select test.must_fail($$select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('a')::uuid), 'DONE')$$, 'an unknown outcome is refused', 'Unknown outcome');
select test.check((select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('a')::uuid), 'DRY_RUN', 'Dry run - not called', null, null, timestamptz '2026-12-10 10:31+05:30') ->> 'status' = 'DRY_RUN'), 'a dry run ends as DRY_RUN');
select test.must_fail($$select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('a')::uuid), 'ACCEPTED')$$, 'a result cannot be recorded twice', 'not being processed');
select test.check((select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('d')::uuid), 'ACCEPTED', null, 200, 'call-123', timestamptz '2026-12-10 10:31+05:30') ->> 'status' = 'ACCEPTED'), 'ACCEPTED is recorded with the provider''s call id');
select test.check((select status = 'ACCEPTED' and external_call_id = 'call-123' and accepted_at is not null and completed_at is null from subscription_reminders where customer_id = pg_temp.g('d')::uuid and stage = 7),
  'accepted is not completed: the call is not marked done');
select test.check((select count(*) = 1 from audit_logs where action = 'SUBSCRIPTION_REMINDER_ACCEPTED' and (metadata ->> 'customer') = pg_temp.g('d')),
  'acceptance is audited');
select test.check((select count(*) = 1 from customer_activities where customer_id = pg_temp.g('d')::uuid and type = 'AUTOMATION_AI_CALL_ACCEPTED'), 'and appears on the customer timeline');
-- F: failing calls are retried a bounded number of times, 10 then 30 minutes apart, then FAILED
select test.check((select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('f')::uuid), 'RETRY', 'The calling service answered 503', 503, null, timestamptz '2026-12-10 10:31+05:30') ->> 'status' = 'RETRY'), 'a failed attempt is scheduled for retry');
select test.check((select next_attempt_at = timestamptz '2026-12-10 10:41+05:30' and response_code = 503
                     from subscription_reminders where customer_id = pg_temp.g('f')::uuid and stage = 7), 'the first retry is 10 minutes later');
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-10 10:35+05:30')) = 0), 'it is not tried again before then');
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-10 10:41+05:30')) = 1), 'and it is claimed again once the 10 minutes are over (attempt 2)');
select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('f')::uuid), 'RETRY', 'again', 503, null, timestamptz '2026-12-10 10:46+05:30');
select test.check((select next_attempt_at = timestamptz '2026-12-10 11:16+05:30' from subscription_reminders where customer_id = pg_temp.g('f')::uuid and stage = 7), 'the second retry is 30 minutes later');
update subscription_reminders set next_attempt_at = timestamptz '2026-12-10 11:00+05:30' where customer_id = pg_temp.g('f')::uuid and stage = 7;
select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-10 11:05+05:30'));
select test.check((select sub_reminder_finish((select id from ids where customer_id = pg_temp.g('f')::uuid), 'RETRY', 'third failure', 503, null, timestamptz '2026-12-10 11:06+05:30') ->> 'status' = 'FAILED'), 'after 3 attempts it is FAILED, not retried forever');
select test.check((select count(*) = 1 from audit_logs where action = 'SUBSCRIPTION_REMINDER_FAILED' and (metadata ->> 'customer') = pg_temp.g('f')), 'the failure is audited');
select test.check((select count(*) = 3 from subscription_reminder_events where reminder_id = (select id from ids where customer_id = pg_temp.g('f')::uuid) and event = 'ATTEMPT'), 'every attempt is recorded');

-- ---------------------------------------------------------------- the window closes
select sub_reminder_schedule('2026-12-14');   -- three days before: a new stage
select test.check((select count(*) = 6 from subscription_reminders where stage = 3 and customer_id::text in (select v from sr)), 'three days before: the 3-day reminders');
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-14 19:30+05:30')) = 0), 'after 19:00 nothing is claimed');
select test.check((select count(*) = 6 and bool_and(reason like 'The call window%') from subscription_reminders where stage = 3 and status = 'SKIPPED' and customer_id::text in (select v from sr)),
  'a reminder is not sent late: it is skipped, never made up the next day');

-- ---------------------------------------------------------------- renewal, date change, cancellation
-- B renews (a later expiry date): its 1-day reminder for the OLD date must never be called.
set role authenticated;
select test.login('sup_plain');
select test.check((select set_customer_service_term(pg_temp.g('a')::uuid, 'AI_CALLING', null, '2026-12-17', null) ->> 'renewsOn' = '2026-12-17'), 'staff can set the expiry date of a service');
select test.must_fail($$select set_customer_service_term(pg_temp.g('a')::uuid, 'AI_CALLING', '2027-01-01', '2026-12-17', null)$$, 'an expiry before the start is refused', 'before the start');
select test.must_fail($$select set_customer_service_term(pg_temp.g('a')::uuid, 'AI_CALLING', null, null, 'GONE')$$, 'an unknown status is refused', 'Unknown service status');
select test.must_fail($$select set_customer_service_term(pg_temp.g('a')::uuid, 'WEBSITE_DEVELOPMENT', null, '2026-12-17', null)$$, 'a service the customer does not have is refused', 'does not have');
select test.login('tm_a');
select test.must_fail($$select set_customer_service_term(pg_temp.g('a')::uuid, 'AI_CALLING', null, '2027-12-17', null)$$, 'a Sales member cannot change the term', 'not found');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'CUSTOMER_SERVICE_TERM_CHANGED'), 'term changes are audited');

select sub_reminder_schedule('2026-12-16');   -- one day before
select test.check((select count(*) = 6 from subscription_reminders where stage = 1 and customer_id::text in (select v from sr)), 'one day before: the 1-day reminders');
update customer_services set renews_on = '2027-12-17' where customer_id = pg_temp.g('a')::uuid and service_code = 'AI_CALLING';          -- A renewed
update customer_services set service_status = 'CANCELLED' where customer_id = pg_temp.g('d')::uuid and service_code = 'AI_CALLING';        -- D cancelled
update customer_services set service_status = 'PAUSED' where customer_id = pg_temp.g('f')::uuid and service_code = 'AI_CALLING';           -- F paused
update customers set lifecycle_stage = 'LOST' where id = pg_temp.g('b')::uuid;                                                            -- B is no longer a customer
select test.check((select (sub_reminder_schedule('2026-12-16') ->> 'cancelled')::int >= 4), 'the scheduler withdraws reminders that are no longer valid');
select test.check((select status = 'CANCELLED' and reason like 'The expiry date changed%' from subscription_reminders where customer_id = pg_temp.g('a')::uuid and stage = 1), 'a renewed service: the reminder for the old date is cancelled');
select test.check((select status = 'CANCELLED' and reason like 'The service is not live (CANCELLED)%' from subscription_reminders where customer_id = pg_temp.g('d')::uuid and stage = 1), 'a cancelled service is not called');
select test.check((select status = 'CANCELLED' and reason like 'The service is not live (PAUSED)%' from subscription_reminders where customer_id = pg_temp.g('f')::uuid and stage = 1), 'nor a paused one');
select test.check((select status = 'CANCELLED' from subscription_reminders where customer_id = pg_temp.g('b')::uuid and stage = 1), 'nor someone who is no longer a customer');
select test.check((select jsonb_array_length(sub_reminder_claim(50, 'dry_run', 300, timestamptz '2026-12-16 10:30+05:30')) = 0), 'claiming does not call anyone for those');
select test.check((select count(*) = 0 from subscription_reminders where status in ('PROCESSING', 'SCHEDULED') and stage = 1 and customer_id in (pg_temp.g('a')::uuid, pg_temp.g('b')::uuid, pg_temp.g('d')::uuid, pg_temp.g('f')::uuid)),
  'none of them is left waiting');
-- a date moved to a new day makes a NEW cycle: the new date gets its own reminders
update customer_services set renews_on = '2026-12-23' where customer_id = pg_temp.g('a')::uuid and service_code = 'AI_CALLING';
select sub_reminder_schedule('2026-12-16');
select test.check((select count(*) = 1 from subscription_reminders where customer_id = pg_temp.g('a')::uuid and expiry_date = '2026-12-23' and stage = 7), 'a changed date is a new expiry cycle with its own reminders');
select sub_reminder_schedule('2026-12-16');
select test.check((select count(*) = 1 from subscription_reminders where customer_id = pg_temp.g('a')::uuid and expiry_date = '2026-12-23' and stage = 7), 'and still only one');

-- ---------------------------------------------------------------- a stopped worker
update subscription_reminders set status = 'PROCESSING', locked_until = timestamptz '2026-12-16 10:00+05:30' where customer_id = pg_temp.g('c')::uuid and stage = 1;
select test.check((select sub_reminder_claim(1, 'dry_run', 300, timestamptz '2026-12-16 12:00+05:30') is not null), 'a dry run goes on');
select test.check((select status in ('SCHEDULED', 'SKIPPED', 'PROCESSING') from subscription_reminders where customer_id = pg_temp.g('c')::uuid and stage = 1), 'a dry-run attempt that stopped is simply requeued');
update subscription_reminders set status = 'PROCESSING', locked_until = timestamptz '2026-12-16 10:00+05:30' where customer_id = pg_temp.g('c')::uuid and stage = 1;
select sub_reminder_claim(1, 'live', 300, timestamptz '2026-12-16 12:00+05:30');
select test.check((select status = 'FAILED' and reason like '%never recorded%' from subscription_reminders where customer_id = pg_temp.g('c')::uuid and stage = 1),
  'a LIVE attempt that stopped without a result is failed, not repeated (the customer may already have been called)');

-- ---------------------------------------------------------------- settings: unknown consent
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select set_reminder_call_settings('10:00', '19:00', true)$$, 'only the Super Admin can change the settings', 'Super Admin');
select test.must_fail($$select sub_reminder_overview()$$, 'and only the Super Admin can read the overview', 'Super Admin');
select test.login('sa');
select test.must_fail($$select set_reminder_call_settings('06:00', '19:00', false)$$, 'a window outside 08:00 to 21:00 is refused', 'between 08:00');
select test.must_fail($$select set_reminder_call_settings('12:00', '11:00', false)$$, 'a window that ends before it starts is refused', 'between 08:00');
select test.check((select set_reminder_call_settings('10:00', '19:00', true) ->> 'allowUnknownConsent' = 'true'), 'the Super Admin may allow customers with no consent record');
select test.check((select sub_reminder_overview() -> 'settings' ->> 'allowUnknownConsent' = 'true' and (sub_reminder_overview() -> 'counts') ? 'SKIPPED'
                          and sub_reminder_overview() -> 'lastSchedule' is not null and jsonb_array_length(sub_reminder_overview() -> 'recent') > 0), 'the overview shows settings, counts, the last run and recent reminders');
select test.check((select not exists (select 1 from jsonb_array_elements(sub_reminder_overview() -> 'recent') x where x ->> 'phone' ~ '\d{10}')), 'and no full phone number');
select set_reminder_call_settings('10:00', '19:00', false);
reset role;
select test.check((select count(*) >= 2 from audit_logs where action = 'REMINDER_CALL_SETTINGS_CHANGED'), 'settings changes are audited');

-- ---------------------------------------------------------------- nobody else can run the machinery
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select sub_reminder_schedule()$$, 'staff cannot run the scheduler', 'permission denied');
select test.must_fail($$select sub_reminder_claim()$$, 'nor claim reminders', 'permission denied');
select test.must_fail($$select sub_reminder_finish(gen_random_uuid(), 'DRY_RUN')$$, 'nor record results', 'permission denied');
select test.must_fail($$select * from subscription_reminders$$, 'the table cannot be read directly', 'permission denied');
select test.must_fail($$select * from customer_reminder_consent$$, 'nor the consent table', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select sub_reminder_schedule()$$, 'a visitor cannot run the scheduler', 'permission denied');
select test.must_fail($$select set_customer_reminder_consent(gen_random_uuid(), 'DO_NOT_CALL')$$, 'nor set consent', 'permission denied');
reset role;

\echo '=== ALL SUBSCRIPTION REMINDER TESTS PASSED ==='
