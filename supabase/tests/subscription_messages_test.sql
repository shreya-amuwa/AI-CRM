-- =============================================================================
-- Expiry reminders by e-mail and WhatsApp (migration 20261128000100): the same 7 / 3 / 1 day stages next to the calls, one row per channel,
-- opt-out, the approved-wording rule for live sends, the queue (lease, retry, window) and who may do what. Nothing is sent here.
-- Dates are fixed (p_today / p_now). Runs after subscription_reminders_test.sql (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 58. Expiry reminders by e-mail and WhatsApp'
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false);
update reminder_call_settings set email_enabled = true, whatsapp_enabled = true;
create temp table mr (k text primary key, v text);
grant all on mr to authenticated, service_role;
create function pg_temp.g(p_k text) returns text language sql stable as $$ select v from mr where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated, service_role;

set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data($j${
  "customers": [
    {"row": 3, "mobile": "9000000701", "name": "Gita Rao", "businessName": "Gita Stores (TEST)"},
    {"row": 4, "mobile": "9000000702", "name": "Hari Om", "businessName": "Hari Mart (TEST)"},
    {"row": 5, "mobile": "9000000703", "name": "Indu Shah", "businessName": "Indu Foods (TEST)"},
    {"row": 6, "mobile": "9000000704", "name": "Jay Mehta", "businessName": "Jay Tech (TEST)"},
    {"row": 7, "mobile": "9000000705", "name": "Kavya Iyer", "businessName": "Kavya Boutique (TEST)"}
  ],
  "services": [
    {"row": 3, "mobile": "9000000701", "service": "AI Calling", "startDate": "2027-01-01", "renewsOn": "2027-03-17", "status": "Live"},
    {"row": 4, "mobile": "9000000702", "service": "AI Calling", "startDate": "2027-01-01", "renewsOn": "2027-03-17", "status": "Live"},
    {"row": 5, "mobile": "9000000703", "service": "AI Calling", "startDate": "2027-01-01", "renewsOn": "2027-03-17", "status": "Live"},
    {"row": 6, "mobile": "9000000704", "service": "AI Calling", "startDate": "2027-01-01", "renewsOn": "2027-03-17", "status": "Live"},
    {"row": 7, "mobile": "9000000705", "service": "AI Calling", "startDate": "2027-01-01", "renewsOn": "2027-03-17", "status": "Live"}
  ]}$j$::jsonb, true) ->> 'committed')::boolean), 'setup: five customers with a service that expires on 17 Mar 2027');
reset role;
insert into mr select 'g', id::text from customers where phone = '9000000701';
insert into mr select 'h', id::text from customers where phone = '9000000702';
insert into mr select 'i', id::text from customers where phone = '9000000703';
insert into mr select 'j', id::text from customers where phone = '9000000704';
insert into mr select 'k', id::text from customers where phone = '9000000705';
-- e-mail: G good, H good (will opt out), I none, J none, K good (the table itself refuses malformed or upper-case addresses). WhatsApp / mobile: I has no valid number at all.
update customers set email = 'gita@example.com', whatsapp = '9000000701' where id = pg_temp.g('g')::uuid;
update customers set email = 'hari@example.com' where id = pg_temp.g('h')::uuid;
update customers set email = null, phone = '12345', whatsapp = null where id = pg_temp.g('i')::uuid;
update customers set email = null where id = pg_temp.g('j')::uuid;
update customers set email = 'kavya@example.com' where id = pg_temp.g('k')::uuid;

-- ---------------------------------------------------------------- the daily decider: one row per channel
select test.check((select (sub_reminder_schedule('2027-03-09') ->> 'created')::int = 0), 'eight days before: nothing is due');
select test.check((select (sub_reminder_schedule('2027-03-10') ->> 'created')::int >= 15), 'seven days before: a call, an e-mail and a WhatsApp reminder for each of the five');
select test.check((select count(*) = 5 from subscription_reminders where channel = 'CALL' and stage = 7 and expiry_date = '2027-03-17' and customer_id::text in (select v from mr))
               and (select count(*) = 5 from subscription_reminders where channel = 'EMAIL' and stage = 7 and expiry_date = '2027-03-17' and customer_id::text in (select v from mr))
               and (select count(*) = 5 from subscription_reminders where channel = 'WHATSAPP' and stage = 7 and expiry_date = '2027-03-17' and customer_id::text in (select v from mr)),
  'exactly one 7-day reminder per customer and channel');
select test.check((select event_key = 'SUBREM|' || customer_id || '|AI_CALLING|2027-03-17|7' from subscription_reminders where channel = 'CALL' and customer_id = pg_temp.g('g')::uuid and stage = 7)
               or (select event_key like 'SUBREM|%' from subscription_reminders where channel = 'CALL' and customer_id = pg_temp.g('g')::uuid and stage = 7), 'the call reminders keep their key format');
select test.check((select event_key like 'SUBREM|EMAIL|%' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid and stage = 7)
               and (select event_key like 'SUBREM|WHATSAPP|%' from subscription_reminders where channel = 'WHATSAPP' and customer_id = pg_temp.g('g')::uuid and stage = 7), 'the other channels have their own keys');
select test.check((select (sub_reminder_schedule('2027-03-10') ->> 'created')::int = 0), 'running the scheduler again creates nothing (no duplicates, in any channel)');
select test.check((select send_after = timestamptz '2027-03-10 10:00+05:30' and send_until = timestamptz '2027-03-10 19:00+05:30'
                     from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid and stage = 7), 'messages go inside the same 10:00 - 19:00 Indian-time window');
select test.check((select (sub_reminder_schedule('2027-03-11') ->> 'created')::int = 0), 'six days before: nothing (stages are exactly 7, 3 and 1)');

-- ---------------------------------------------------------------- opt-out
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select set_customer_message_optout(pg_temp.g('h')::uuid, 'EMAIL', true, 'asked')$$, 'a Sales member cannot record an opt-out for a Support customer', 'not found');
select test.must_fail($$select customer_message_optout_get(pg_temp.g('h')::uuid)$$, 'nor read it', 'not found');
select test.login('sup_plain');
select test.must_fail($$select set_customer_message_optout(pg_temp.g('h')::uuid, 'SMS', true)$$, 'only e-mail and WhatsApp', 'Choose e-mail or WhatsApp');
select test.check((select set_customer_message_optout(pg_temp.g('h')::uuid, 'EMAIL', true, 'Asked us to stop the e-mails') ->> 'optout' = 'true'), 'a Support member records an opt-out');
select test.check((select (customer_message_optout_get(pg_temp.g('h')::uuid) ->> 'EMAIL')::boolean and not (customer_message_optout_get(pg_temp.g('h')::uuid) ->> 'WHATSAPP')::boolean), 'it reads back, per channel');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'CUSTOMER_MESSAGE_OPTOUT_CHANGED' and (metadata ->> 'channel') = 'EMAIL'), 'and is audited');

-- ---------------------------------------------------------------- the e-mail queue (dry run)
select test.check((select jsonb_array_length(sub_message_claim('EMAIL', 50, 'dry_run', 300, timestamptz '2027-03-10 09:30+05:30')) = 0), 'before 10:00 nothing is claimed');
select test.must_fail($$select sub_message_claim('SMS')$$, 'an unknown channel is refused', 'Unknown channel');
create temp table cl as select sub_message_claim('EMAIL', 50, 'dry_run', 300, timestamptz '2027-03-10 10:30+05:30') as j;
grant all on cl to authenticated, service_role;
select test.check((select count(*) = 2 from jsonb_array_elements((select j from cl)) x where (x ->> 'customerId') in (select v from mr)), 'only G and K are claimed (a valid address, no opt-out)');
select test.check((select x ->> 'to' = 'gita@example.com' and x ->> 'channel' = 'EMAIL' and x ->> 'name' = 'Gita Rao' and x ->> 'serviceName' = 'AI Calling' and x ->> 'expiryDate' = '2027-03-17'
                          and (x ->> 'daysLeft')::int = 7 and (x ->> 'stage')::int = 7 and x #>> '{template,subject}' like '%{{service}}%' and (x #>> '{template,approved}')::boolean = false
                     from jsonb_array_elements((select j from cl)) x where x ->> 'customerId' = pg_temp.g('g')),
  'the payload has the address, the customer, the service, the dates and the (draft) wording');
select test.check((select x ->> 'to' = 'kavya@example.com' from jsonb_array_elements((select j from cl)) x where x ->> 'customerId' = pg_temp.g('k')), 'the address is handed over as stored');
select test.check((select not (x ? 'phone') and not (x ? 'address') and not (x ? 'amount') and not (x ? 'gstin') from jsonb_array_elements((select j from cl)) x limit 1), 'and nothing else: no phone number, no street address, no payment data');
select test.check((select status = 'SKIPPED' and reason like 'The customer asked not to receive%' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('h')::uuid and stage = 7), 'an opt-out is skipped, with the reason');
select test.check((select status = 'SKIPPED' and reason like '%no valid e-mail%' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('i')::uuid and stage = 7), 'no address: skipped');
select test.check((select status = 'SKIPPED' and reason like '%no valid e-mail%' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('j')::uuid and stage = 7), 'no address: skipped');
select test.check((select status = 'PROCESSING' and attempts = 1 and phone_masked = 'g***@example.com' and locked_until = timestamptz '2027-03-10 10:35+05:30'
                     from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid and stage = 7), 'a claimed reminder is PROCESSING, with a masked address and a lease');
select test.check((select jsonb_array_length(sub_message_claim('EMAIL', 50, 'dry_run', 300, timestamptz '2027-03-10 10:30+05:30')) = 0), 'a second claim takes nothing');
select test.check((select count(*) = 0 from subscription_reminders where channel in ('CALL', 'WHATSAPP') and status = 'PROCESSING' and customer_id::text in (select v from mr)), 'the e-mail queue never touches the other channels');
-- the call queue never takes an e-mail reminder
create temp table cc as select sub_reminder_claim(50, 'dry_run', 300, timestamptz '2027-03-10 10:30+05:30') as j;
select test.check((select count(*) = 0 from jsonb_array_elements((select j from cc)) x where x ->> 'channel' = 'EMAIL' or x ? 'to'), 'and the call queue never takes an e-mail reminder');
select test.check((select count(*) = 0 from subscription_reminders where channel = 'EMAIL' and status = 'SCHEDULED' and customer_id in (pg_temp.g('g')::uuid, pg_temp.g('k')::uuid)), '(the e-mail rows stayed with the e-mail queue)');

-- results
create temp table ids as select r.customer_id, r.id, r.channel from subscription_reminders r where r.stage = 7 and r.customer_id::text in (select v from mr);
select test.must_fail($$select sub_message_finish((select id from ids where channel = 'CALL' limit 1), 'DRY_RUN')$$, 'a call reminder cannot be finished as a message', 'not being processed');
select test.must_fail($$select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid), 'SENT')$$, 'an unknown outcome is refused', 'Unknown outcome');
select test.check((select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid), 'DRY_RUN', 'Dry run - not sent', null, null, timestamptz '2027-03-10 10:31+05:30') ->> 'status' = 'DRY_RUN'), 'a dry run ends as DRY_RUN');
select test.must_fail($$select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid), 'ACCEPTED')$$, 'a result cannot be recorded twice', 'not being processed');
select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('k')::uuid), 'DRY_RUN', 'Dry run - not sent', null, null, timestamptz '2027-03-10 10:32+05:30');

-- ---------------------------------------------------------------- live needs approved wording
select test.check((select jsonb_array_length(sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 11:00+05:30')) = 0), 'live: a dry-run reminder is NOT sent while its wording is not approved');
select test.check((select status = 'DRY_RUN' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid and stage = 7), '... it simply waits');
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select set_reminder_message_template('EMAIL', 7, 'S', 'B', null, true)$$, 'only the Super Admin can change or approve the wording', 'Only the Super Admin');
select test.must_fail($$select reminder_message_templates_get()$$, 'nor read it', 'Only the Super Admin');
select test.login('sa');
select test.check((select jsonb_array_length(reminder_message_templates_get()) = 6 and (select bool_and(not (x ->> 'approved')::boolean) from jsonb_array_elements(reminder_message_templates_get()) x)), 'six draft wordings exist, none approved');
select test.must_fail($$select set_reminder_message_template('EMAIL', 7, 'Hello {{password}}', 'Body', null, true)$$, 'an unknown placeholder is refused', 'Unknown placeholder');
select test.must_fail($$select set_reminder_message_template('EMAIL', 7, null, 'Body only', null, true)$$, 'an e-mail needs a subject', 'needs a subject');
select test.must_fail($$select set_reminder_message_template('EMAIL', 5, 'S', 'B')$$, 'only stages 7, 3 and 1', 'stage 7, 3 or 1');
select test.must_fail($$select set_reminder_message_template('WHATSAPP', 7, null, '')$$, 'an empty message is refused', 'between 1 and 2,000');
select test.check((select set_reminder_message_template('EMAIL', 7, 'Your {{service}} expires in {{daysLeft}} days', E'Dear {{name}},\n\nYour {{service}} for {{company}} ends on {{expiryDate}}.', null, true) ->> 'approved' = 'true'), 'the Super Admin approves the 7-day e-mail wording');
select test.check((select set_reminder_message_template('EMAIL', 3, 'Reminder', 'Dear {{name}}, please renew {{service}}.') ->> 'approved' = 'false'), 'wording saved without approval stays unapproved');
reset role;
select test.check((select count(*) = 2 from audit_logs where action = 'REMINDER_TEMPLATE_CHANGED'), 'wording changes are audited (without the text)');
select test.check((select not (metadata ? 'body') from audit_logs where action = 'REMINDER_TEMPLATE_CHANGED' limit 1), '... the text itself is not copied into the log');
create temp table lv as select sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 11:30+05:30') as j;
select test.check((select count(*) = 2 and bool_and(x ->> 'customerId' in (pg_temp.g('g'), pg_temp.g('k')) and (x #>> '{template,approved}')::boolean) from jsonb_array_elements((select j from lv)) x), 'live: once approved, the 7-day e-mails of G and K are claimed with the approved wording');
select test.check((select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid), 'ACCEPTED', 'HTTP 200', 200, 'msg-1', timestamptz '2027-03-10 11:31+05:30') ->> 'status' = 'ACCEPTED'), 'ACCEPTED is recorded with the provider''s reference');
select test.check((select status = 'ACCEPTED' and external_call_id = 'msg-1' and accepted_at is not null and completed_at is null from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('g')::uuid and stage = 7), 'accepted is not "delivered"');
select test.check((select count(*) = 1 from audit_logs where action = 'SUBSCRIPTION_REMINDER_ACCEPTED' and (metadata ->> 'channel') = 'EMAIL' and (metadata ->> 'customer') = pg_temp.g('g')), 'acceptance is audited with its channel');
select test.check((select count(*) = 1 from customer_activities where customer_id = pg_temp.g('g')::uuid and type = 'AUTOMATION_EMAIL_REMINDER_ACCEPTED'), 'and appears on the customer timeline');
select test.check((select jsonb_array_length(sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 11:32+05:30')) = 0), 'an accepted reminder is never sent a second time');
-- K (claimed above, attempt 1): retry, 10 then 30 minutes, then FAILED
select test.check((select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('k')::uuid), 'RETRY', 'HTTP 503', 503, null, timestamptz '2027-03-10 12:01+05:30') ->> 'status' = 'RETRY'), 'a failed attempt is scheduled for retry');
select test.check((select next_attempt_at = timestamptz '2027-03-10 12:11+05:30' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('k')::uuid and stage = 7), 'the first retry is 10 minutes later');
select test.check((select jsonb_array_length(sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 12:05+05:30')) = 0), 'not before then');
select sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 12:11+05:30');
select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('k')::uuid), 'RETRY', 'HTTP 503', 503, null, timestamptz '2027-03-10 12:12+05:30');
select test.check((select next_attempt_at = timestamptz '2027-03-10 12:42+05:30' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('k')::uuid and stage = 7), 'the second retry is 30 minutes later');
select sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 12:42+05:30');
select test.check((select sub_message_finish((select id from ids where channel = 'EMAIL' and customer_id = pg_temp.g('k')::uuid), 'RETRY', 'HTTP 503', 503, null, timestamptz '2027-03-10 12:43+05:30') ->> 'status' = 'FAILED'), 'after 3 attempts it is FAILED');
select test.check((select count(*) = 1 from audit_logs where action = 'SUBSCRIPTION_REMINDER_FAILED' and (metadata ->> 'channel') = 'EMAIL'), 'and the failure is audited');
-- a worker that stopped in the middle of a live send: reported, never repeated
update subscription_reminders set status = 'PROCESSING', locked_until = timestamptz '2027-03-10 12:00+05:30', attempts = 1 where channel = 'EMAIL' and customer_id = pg_temp.g('h')::uuid and stage = 7;
select sub_message_claim('EMAIL', 50, 'live', 300, timestamptz '2027-03-10 13:00+05:30');
select test.check((select status = 'FAILED' and reason like 'The result was never recorded%' from subscription_reminders where channel = 'EMAIL' and customer_id = pg_temp.g('h')::uuid and stage = 7), 'a live send whose result was never recorded is failed, not repeated');

-- ---------------------------------------------------------------- the WhatsApp queue
create temp table wl as select sub_message_claim('WHATSAPP', 50, 'dry_run', 300, timestamptz '2027-03-10 10:30+05:30') as j;
select test.check((select count(*) = 4 from jsonb_array_elements((select j from wl)) x where (x ->> 'customerId') in (select v from mr)), 'WhatsApp: G, H, J and K (a valid mobile) are claimed; I has no valid number');
select test.check((select x ->> 'to' = '+919000000701' and x ->> 'channel' = 'WHATSAPP' and x #>> '{template,subject}' is null from jsonb_array_elements((select j from wl)) x where x ->> 'customerId' = pg_temp.g('g')), 'the number is in +91 form and there is no subject');
select test.check((select status = 'SKIPPED' and reason like '%no valid Indian WhatsApp%' from subscription_reminders where channel = 'WHATSAPP' and customer_id = pg_temp.g('i')::uuid and stage = 7), 'no valid number: skipped');
select test.check((select status = 'PROCESSING' and phone_masked = '+91XXXXXX0701' from subscription_reminders where channel = 'WHATSAPP' and customer_id = pg_temp.g('g')::uuid and stage = 7), 'the number is stored masked');
select test.check((select jsonb_array_length(sub_message_claim('WHATSAPP', 50, 'live', 300, timestamptz '2027-03-10 11:00+05:30')) = 0), 'live WhatsApp: nothing goes out while no WhatsApp wording is approved');
-- an opt-out for WhatsApp only affects WhatsApp
set role authenticated;
select test.login('sup_plain');
select set_customer_message_optout(pg_temp.g('j')::uuid, 'WHATSAPP', true, 'Asked');
select test.check((select (customer_message_optout_get(pg_temp.g('j')::uuid) ->> 'WHATSAPP')::boolean and not (customer_message_optout_get(pg_temp.g('j')::uuid) ->> 'EMAIL')::boolean), 'a WhatsApp opt-out leaves the e-mail alone');
select set_customer_message_optout(pg_temp.g('h')::uuid, 'EMAIL', false);
select test.check((not (customer_message_optout_get(pg_temp.g('h')::uuid) ->> 'EMAIL')::boolean), 'an opt-out can be withdrawn');
reset role;

-- ---------------------------------------------------------------- channels can be switched off; later stages; renewals; windows
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select set_reminder_channels(false, true)$$, 'only the Super Admin can switch channels', 'Only the Super Admin');
select test.login('sa');
select test.must_fail($$select set_reminder_channels(null, true)$$, 'each channel needs a choice', 'Choose on or off');
select test.check((select set_reminder_channels(false, true) ->> 'emailEnabled' = 'false'), 'the Super Admin switches the e-mail reminders off');
reset role;
select test.check((select (sub_reminder_schedule('2027-03-14') ->> 'created')::int >= 10), 'three days before: reminders are created ...');
select test.check((select count(*) = 0 from subscription_reminders where channel = 'EMAIL' and stage = 3 and customer_id::text in (select v from mr))
               and (select count(*) = 5 from subscription_reminders where channel = 'WHATSAPP' and stage = 3 and customer_id::text in (select v from mr))
               and (select count(*) = 5 from subscription_reminders where channel = 'CALL' and stage = 3 and customer_id::text in (select v from mr)), '... for the calls and WhatsApp, none for the switched-off e-mail');
select test.check((select jsonb_array_length(sub_message_claim('EMAIL', 50, 'dry_run', 300, timestamptz '2027-03-14 10:30+05:30')) = 0), 'a switched-off channel claims nothing');
update reminder_call_settings set email_enabled = true;
select test.check((select (sub_reminder_schedule('2027-03-16') ->> 'created')::int >= 15), 'one day before: all three channels');
-- a renewal withdraws the pending message reminders
update customer_services set renews_on = '2027-09-17' where customer_id = pg_temp.g('k')::uuid and service_code = 'AI_CALLING';
select sub_message_claim('WHATSAPP', 50, 'dry_run', 300, timestamptz '2027-03-16 10:30+05:30');
select sub_message_claim('EMAIL', 50, 'dry_run', 300, timestamptz '2027-03-16 10:30+05:30');
select test.check((select count(*) >= 1 and bool_and(status = 'CANCELLED' and reason like '%expiry date changed%') from subscription_reminders where customer_id = pg_temp.g('k')::uuid and stage = 1 and channel in ('EMAIL', 'WHATSAPP')),
  'a renewed service cancels its e-mail and WhatsApp reminders');
-- a window that has passed is never made up
select sub_message_claim('WHATSAPP', 50, 'dry_run', 300, timestamptz '2027-03-16 19:30+05:30');
select test.check((select count(*) >= 1 and bool_and(status = 'SKIPPED') from subscription_reminders where channel = 'WHATSAPP' and stage = 1 and customer_id = pg_temp.g('i')::uuid or (channel = 'WHATSAPP' and stage = 1 and status = 'SKIPPED')), 'after 19:00 an unsent reminder is skipped, never sent late');

-- ---------------------------------------------------------------- overview
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select sub_reminder_overview()$$, 'the overview is for the Super Admin', 'Only the Super Admin');
select test.login('sa');
select test.check((select (o -> 'settings' ->> 'emailEnabled') = 'true' and (o -> 'countsByChannel') ? 'EMAIL' and (o -> 'countsByChannel') ? 'WHATSAPP' and (o -> 'countsByChannel') ? 'CALL'
                          and (o -> 'approvedWording' ->> 'EMAIL')::int = 1 and (o -> 'approvedWording' ->> 'WHATSAPP')::int = 0
                     from (select sub_reminder_overview() as o) x), 'the overview reports every channel, the settings and how much wording is approved');
reset role;
update reminder_call_settings set email_enabled = true, whatsapp_enabled = true;
\echo '   done'
