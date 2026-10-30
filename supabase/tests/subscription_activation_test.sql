-- =============================================================================
-- Subscription duration, activation and expiry (migration 20261210000100): Sales picks the duration, the team confirms the panel activation, the
-- database calculates the expiry; the client sees it, the reminders follow it, a repeated request changes nothing, nobody else can touch the dates.
-- Runs after the other suites on the same database and reuses their staff.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- earlier suites re-apply older migrations (to prove they are re-runnable): put this one back on top, which also proves it re-runs
\i supabase/migrations/20261210000100_subscription_activation.sql

\echo '--- 90. Subscription: the date arithmetic'
select test.check(private.subscription_expiry(date '2026-11-10', 1, null) = date '2026-12-10', '1 month: 10 Nov 2026 -> 10 Dec 2026');
select test.check(private.subscription_expiry(date '2026-11-10', 2, null) = date '2027-01-10', '2 months -> 10 Jan 2027');
select test.check(private.subscription_expiry(date '2026-11-10', 3, null) = date '2027-02-10', '3 months -> 10 Feb 2027');
select test.check(private.subscription_expiry(date '2026-11-10', 6, null) = date '2027-05-10', '6 months -> 10 May 2027');
select test.check(private.subscription_expiry(date '2026-11-10', 12, null) = date '2027-11-10', '1 year -> 10 Nov 2027');
select test.check(private.subscription_expiry(date '2026-11-10', 24, null) = date '2028-11-10', '2 years -> 10 Nov 2028');
select test.check(private.subscription_expiry(date '2026-01-31', 1, null) = date '2026-02-28', 'month end: 31 Jan + 1 month = 28 Feb');
select test.check(private.subscription_expiry(date '2027-12-31', 2, null) = date '2028-02-29', 'month end into a leap year: 31 Dec + 2 months = 29 Feb 2028');
select test.check(private.subscription_expiry(date '2028-02-29', 12, null) = date '2029-02-28', 'leap day + 1 year = 28 Feb');
select test.check(private.subscription_expiry(date '2026-08-31', 6, null) = date '2027-02-28', '31 Aug + 6 months = 28 Feb');
select test.check(private.subscription_expiry(date '2026-11-10', null, 45) = date '2026-12-25', 'custom days: 45 days');
select test.check((select code = '1Y' and months = 12 from private.parse_duration('{"durationCode":"1Y"}')), '1 year is 12 months');
select test.check((select code = 'CUSTOM' and months = 5 and days is null from private.parse_duration('{"durationCode":"CUSTOM","customMonths":5}')), 'custom months');
select test.must_fail($$select * from private.parse_duration('{"durationCode":"CUSTOM"}')$$, 'a custom duration needs months or days', 'either in months or in days');
select test.must_fail($$select * from private.parse_duration('{"durationCode":"CUSTOM","customMonths":2,"customDays":10}')$$, 'not both', 'either in months or in days');
select test.must_fail($$select * from private.parse_duration('{"durationCode":"7M"}')$$, 'an unknown duration is refused', 'Choose the subscription duration');

\echo '--- 91. Subscription: Sales picks the duration and nothing else about dates'
create temp table sb (name text primary key, id uuid);
create temp table sbd (name text primary key, d date);
grant all on sb, sbd to authenticated, service_role;
insert into sbd values ('today', private.office_today()), ('panel', private.office_today() - 16), ('start', private.office_today() - 15);

set role authenticated;
select test.login('tm_a');
insert into sb select 'S', create_lead('{"name":"Sub Sigma","company":"Sigma Subscription Co","email":"sigma.sub@example.com","phone":"9819902001","leadSource":"Walk-in"}', array['DS_META_ADS']);
reset role;
select test.check((select count(*) = 1 from customer_services where customer_id = (select id from sb where name = 'S') and started_on is null and renews_on is null and duration_code is null),
  'a new customer service has no duration, no start and no expiry');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"plan":"Growth","amount":12000}')$$, 'the duration is required', 'Choose the subscription duration');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"durationCode":"6M","amount":12000}')$$, 'the plan is required', 'Enter the subscription plan');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"plan":"Growth","durationCode":"6M"}')$$, 'the amount is required', 'Enter the subscription amount');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"plan":"Growth","durationCode":"6M","amount":12000,"startedOn":"2026-11-01"}')$$,
  'Sales cannot send a start date', 'not by Sales');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"plan":"Growth","durationCode":"6M","amount":12000,"expiryDate":"2027-05-01"}')$$,
  'nor an expiry date', 'not by Sales');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'AI_QR', '{"plan":"Growth","durationCode":"6M","amount":12000}')$$, 'only a service the customer has', 'does not have this service');
select test.check((set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS',
  '{"plan":"Growth","durationCode":"6M","amount":12000,"messageCredits":50000,"panel":"Meta panel"}') ->> 'durationLabel') = '6 months', 'Sales sets plan, 6 months, amount and message credits');
select test.login('tm_b');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"plan":"Hack","durationCode":"1M","amount":1}')$$, 'another salesperson cannot', 'NOT_FOUND|Customer not found');
select test.login('tm_a');
select test.must_fail($$insert into customer_services (customer_id, service_code, started_on) values ((select id from sb where name = 'S'), 'AI_QR', date '2026-01-01')$$,
  'a direct write of a start date is refused', 'FORBIDDEN|row-level security|permission denied');
select test.must_fail($$update customer_services set started_on = date '2026-01-01' where customer_id = (select id from sb where name = 'S')$$, 'and so is a direct update', 'permission denied');
select test.must_fail($$select set_customer_service_term((select id from sb where name = 'S'), 'DS_META_ADS', date '2026-01-01', date '2026-07-01', null)$$, 'the old term function is not a way round', 'NOT_FOUND|come from its activation');
reset role;
select test.check((select started_on is null and renews_on is null and duration_code = '6M' and duration_months = 6 and plan_name = 'Growth' and price = 12000 and message_credits = 50000
                     from customer_services where customer_id = (select id from sb where name = 'S')),
  'the duration is stored, the start and expiry dates are still empty');
select test.check((select count(*) = 1 from subscription_history where customer_id = (select id from sb where name = 'S') and action = 'TERMS_SET'), 'the terms are in the history');

\echo '--- 92. Subscription: payment, login, documents, then the team activates the panel'
set role authenticated;
select test.login('tm_a');
select send_lead_to_accounts((select id from sb where name = 'S'), 12000, null);
select test.login('acc_m');
select accounts_set_order_gst((select id from sb where name = 'S'), 0);
select accounts_record_payment((select id from sb where name = 'S'), 'FULL', 12000, 'CASH', null, null, null, true);
select accounts_client_login_begin((select id from sb where name = 'S'));
reset role;
select test.create_auth_user('sb_s', 'sigma.sub@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from sb where name = 'S')));
set role authenticated;
select test.login('acc_m');
select record_client_account((select id from sb where name = 'S'), test.id('sb_s'), 'sigma.sub@example.com');
select accounts_confirm_and_return((select id from sb where name = 'S'), null);

-- the client sees "not started"
select test.login('sb_s');
select test.check((select x ->> 'status' = 'NOT_STARTED' and x -> 'startedOn' = 'null'::jsonb and x -> 'expiresOn' = 'null'::jsonb and x ->> 'durationLabel' = '6 months'
                          and x ->> 'plan' = 'Growth' and not (x ->> 'panelCreated')::boolean
                     from jsonb_array_elements(client_subscriptions()) x where x ->> 'service' = 'DS_META_ADS'),
  'the client sees: Subscription Not Started, 6 months, no start date, no expiry date, panel not created');
select test.check((client_onboarding_journey() -> 'access' -> 'subscription' ->> 'enabled')::boolean, 'My Subscription is always open');
select test.check((select (x -> 'messages' ->> 'total')::numeric = 50000 and (x -> 'messages' ->> 'used')::numeric = 0 and (x -> 'messages' ->> 'percent')::numeric = 0
                     from jsonb_array_elements(client_subscriptions()) x where x ->> 'service' = 'DS_META_ADS'), 'the message credits Sales entered show as the total, nothing used');
select test.must_fail($$select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'start'))$$, 'a client cannot activate', 'NOT_FOUND|Sign in|FORBIDDEN');

select test.login('tm_a');
select test.check((select (s ->> 'canSetTerms')::boolean and not (s ->> 'canActivate')::boolean and not (s ->> 'canCorrect')::boolean
                     from jsonb_array_elements(subscription_overview((select id from sb where name = 'S')) -> 'services') s limit 1),
  'Sales can edit the terms but cannot activate or correct');
select test.must_fail($$select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'start'))$$, 'Sales cannot confirm the activation', 'NOT_FOUND');

select test.login('ds_mem');
select test.must_fail($$select set_service_setup((select id from sb where name = 'S'), 'DS_META_ADS', 'READY', null)$$, 'marking it ready is not a way round: the subscription starts through the activation', 'Authorize these first|Confirm the panel activation');
select test.must_fail($$select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'start'))$$, 'not before the documents are authorized', 'Authorize these first');
reset role;
select test.check((select started_on is null and renews_on is null and subscription_cycle = 0 from customer_services where customer_id = (select id from sb where name = 'S')),
  'refused attempts leave the dates empty');
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by, reviewed_at)
  select (select id from sb where name = 'S'), i.code, 'saved', 'VERIFIED', test.id('tm_a'), now()
    from private.customer_items((select id from sb where name = 'S')) i on conflict (customer_id, item_code) do update set status = 'VERIFIED';
set role authenticated;
select test.login('ds_mem');
select test.must_fail($$select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', null)$$, 'the activation date is required', 'Enter the subscription activation date');
select test.must_fail($$select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d + 1 from sbd where name = 'today'))$$, 'not in the future', 'cannot be in the future');
select test.must_fail($$select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'start'), (select d + 30 from sbd where name = 'start'))$$,
  'the panel cannot be created after it was activated', 'cannot be after the activation date');
select test.check((select (r ->> 'alreadyActive')::boolean = false and r -> 'subscription' ->> 'startedOn' = (select d::text from sbd where name = 'start')
                          and r -> 'subscription' ->> 'expiresOn' = (select (d + interval '6 months')::date::text from sbd where name = 'start')
                          and r -> 'subscription' ->> 'panelCreatedOn' = (select d::text from sbd where name = 'panel') and r -> 'subscription' ->> 'status' = 'ACTIVE'
                          and r -> 'subscription' ->> 'activatedBy' = 'DS Member'
                     from (select confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'start'),
                                                                  (select d from sbd where name = 'panel'), 'Panel live') as r) q),
  'the activation records the actual date, the panel creation date and who confirmed, and the expiry is six calendar months later');
reset role;
select test.check((select started_on = (select d from sbd where name = 'start') and renews_on = (started_on + interval '6 months')::date and setup_status = 'READY' and service_status = 'LIVE'
                          and activated_by = test.id('ds_mem') and activation_confirmed_at is not null and subscription_cycle = 1
                     from customer_services where customer_id = (select id from sb where name = 'S')), 'stored in the database, the service is live');
select test.check((select count(*) = 1 and bool_and(status = 'ACTIVE' and kind = 'INITIAL' and expires_on = (started_on + interval '6 months')::date) from subscription_cycles where customer_id = (select id from sb where name = 'S')),
  'cycle 1 is recorded');
select test.check((select count(*) = 1 from subscription_history where customer_id = (select id from sb where name = 'S') and action = 'ACTIVATED' and actor_id = test.id('ds_mem')), 'the activation is in the history');
select test.check((select count(*) = 1 from audit_logs where action = 'SUBSCRIPTION_ACTIVATED' and entity_id = (select id from sb where name = 'S')), 'and in the audit log');

\echo '--- 93. Subscription: a repeated request changes nothing'
create temp table sbv (k text primary key, v text);
grant all on sbv to authenticated;
insert into sbv select 'before', (select concat_ws('|', started_on, renews_on, panel_created_on, activated_by, activation_confirmed_at) from customer_services where customer_id = (select id from sb where name = 'S'));
set role authenticated;
select test.login('ds_mem');
select test.check((select (confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'today')) ->> 'alreadyActive')::boolean), 'a second activation request is answered "already active"');
select test.login('sa');
select test.check((select (confirm_subscription_activation((select id from sb where name = 'S'), 'DS_META_ADS', (select d - 3 from sbd where name = 'start')) ->> 'alreadyActive')::boolean), 'even from another employee with another date');
reset role;
select test.check((select concat_ws('|', started_on, renews_on, panel_created_on, activated_by, activation_confirmed_at) = (select v from sbv where k = 'before')
                     from customer_services where customer_id = (select id from sb where name = 'S')), 'the dates, the person and the time are exactly as before');
select test.check((select count(*) = 1 from subscription_cycles where customer_id = (select id from sb where name = 'S'))
               and (select count(*) = 1 from subscription_history where customer_id = (select id from sb where name = 'S') and action = 'ACTIVATED')
               and (select count(*) = 1 from automation_jobs where customer_id = (select id from sb where name = 'S') and stage = 'SUBSCRIPTION_ACTIVATED'),
  'no second cycle, history line or e-mail');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select set_subscription_terms((select id from sb where name = 'S'), 'DS_META_ADS', '{"plan":"Growth","durationCode":"1M","amount":1}')$$, 'Sales cannot change the duration after the start', 'subscription has started');
select test.must_fail($$delete from customer_services where customer_id = (select id from sb where name = 'S') and service_code = 'DS_META_ADS'$$, 'nor remove the service', 'permission denied|started|row-level');

\echo '--- 94. Subscription: what the client sees after the activation'
select test.login('sb_s');
select test.check((select x ->> 'status' = 'ACTIVE' and x ->> 'startedOn' = (select d::text from sbd where name = 'start') and x ->> 'expiresOn' = (select (d + interval '6 months')::date::text from sbd where name = 'start')
                          and (x ->> 'daysLeft')::int = ((select (d + interval '6 months')::date from sbd where name = 'start') - (select d from sbd where name = 'today'))
                          and (x ->> 'panelCreated')::boolean and x ->> 'panelCreatedOn' = (select d::text from sbd where name = 'panel') and x ->> 'durationLabel' = '6 months'
                     from jsonb_array_elements(client_subscriptions()) x where x ->> 'service' = 'DS_META_ADS'),
  'the client sees Active, the actual start date, the calculated expiry, the panel date and the days left');
select test.check((select count(*) = 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'title' like '%subscription is active%'), 'the client is told when it started');
select test.must_fail($$select correct_subscription_dates((select id from sb where name = 'S'), 'DS_META_ADS', date '2026-01-01', null, 'my own change')$$, 'a client cannot change it', 'NOT_FOUND|Sign in|FORBIDDEN');

\echo '--- 95. Subscription: correcting a date is for the heads, with a reason'
select test.login('tm_a');
select test.must_fail($$select correct_subscription_dates((select id from sb where name = 'S'), 'DS_META_ADS', (select d - 5 from sbd where name = 'start'), null, 'Sales wants it')$$, 'Sales cannot correct', 'NOT_FOUND');
select test.login('ds_mem');
select test.must_fail($$select correct_subscription_dates((select id from sb where name = 'S'), 'DS_META_ADS', (select d - 5 from sbd where name = 'start'), null, 'a member wants it')$$, 'nor the member who activated it', 'NOT_FOUND');
select test.login('sa');
select test.must_fail($$select correct_subscription_dates((select id from sb where name = 'S'), 'DS_META_ADS', (select d - 5 from sbd where name = 'start'), null, '')$$, 'a reason is required', 'Give the reason');
select test.must_fail($$select correct_subscription_dates((select id from sb where name = 'S'), 'DS_META_ADS', (select d from sbd where name = 'start'), (select d from sbd where name = 'panel'), 'same dates again')$$, 'the same dates are refused', 'already recorded');
select test.check((select r ->> 'startedOn' = (select (d - 5)::text from sbd where name = 'start') and r ->> 'expiresOn' = (select ((d - 5) + interval '6 months')::date::text from sbd where name = 'start')
                     from (select correct_subscription_dates((select id from sb where name = 'S'), 'DS_META_ADS', (select d - 5 from sbd where name = 'start'), (select d - 5 from sbd where name = 'panel'),
                                                              'Panel was activated five days earlier than recorded') as r) q),
  'the Super Admin corrects the date with a reason and the expiry is recalculated from it');
reset role;
select test.check((select count(*) = 1 and bool_and(old_values ->> 'startedOn' = (select d::text from sbd where name = 'start') and new_values ->> 'startedOn' = (select (d - 5)::text from sbd where name = 'start') and reason like 'Panel was%')
                     from subscription_history where customer_id = (select id from sb where name = 'S') and action = 'DATES_CORRECTED'),
  'the old and the new dates and the reason are kept');
select test.check((select count(*) = 1 from audit_logs where action = 'SUBSCRIPTION_DATES_CORRECTED' and entity_id = (select id from sb where name = 'S')), 'and audited');
select test.must_fail($$update subscription_history set reason = 'x'$$, 'the history cannot be edited', 'append-only');
select test.must_fail($$delete from subscription_history$$, 'or deleted', 'append-only');
select test.check((select started_on = expires.s and renews_on = (expires.s + interval '6 months')::date from customer_services cs, (select (d - 5) as s from sbd where name = 'start') expires
                    where cs.customer_id = (select id from sb where name = 'S')), 'the service row and the cycle agree');

\echo '--- 96. Subscription: the activation e-mail'
select test.check((select count(*) = 1 and bool_and(channel = 'EMAIL' and status in ('QUEUED', 'SKIPPED', 'SENT') and context ->> 'service' = 'DS_META_ADS' and context ->> 'cycle' = '1')
                     from automation_jobs where customer_id = (select id from sb where name = 'S') and stage = 'SUBSCRIPTION_ACTIVATED'), 'one panel activation e-mail was queued, only after the activation');
select test.check((select (subscription_mail_data((select id from sb where name = 'S'), 'DS_META_ADS', 1)) ->> 'startedOn' = (select (d - 5)::text from sbd where name = 'start')
                      and (subscription_mail_data((select id from sb where name = 'S'), 'DS_META_ADS', 1)) ->> 'durationLabel' = '6 months'
                      and (subscription_mail_data((select id from sb where name = 'S'), 'DS_META_ADS', 1)) ->> 'plan' = 'Growth'
                      and (subscription_mail_data((select id from sb where name = 'S'), 'DS_META_ADS', 1)) ->> 'messageCredits' = '50000'),
  'what the e-mail is made from: plan, duration, the corrected start date, the credits');
set role authenticated;
reset role;
update automation_jobs set status = 'FAILED', detail = 'The mail server refused' where customer_id = (select id from sb where name = 'S') and stage = 'SUBSCRIPTION_ACTIVATED';
select test.check((select status = 'FAILED' from automation_jobs where customer_id = (select id from sb where name = 'S') and stage = 'SUBSCRIPTION_ACTIVATED'), 'a failed send is recorded as failed');
set role authenticated;
select test.login('ds_mem');
select test.check((select s -> 'email' ->> 'status' = 'FAILED' and (s ->> 'canResendEmail')::boolean from jsonb_array_elements(subscription_overview((select id from sb where name = 'S')) -> 'services') s limit 1),
  'the team sees that it failed and may retry');
select test.check((resend_activation_email((select id from sb where name = 'S'), 'DS_META_ADS') ->> 'queued')::boolean, 'the retry queues the same e-mail again');
select test.must_fail($$select resend_activation_email((select id from sb where name = 'S'), 'DS_META_ADS')$$, 'but not twice while it is on its way', 'already on its way');
select test.login('tm_a');
select test.must_fail($$select resend_activation_email((select id from sb where name = 'S'), 'DS_META_ADS')$$, 'Sales cannot trigger it', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 1 from automation_jobs where customer_id = (select id from sb where name = 'S') and stage = 'SUBSCRIPTION_ACTIVATED' and status = 'QUEUED'), 'still one job: a retry is not a second e-mail');

\echo '--- 97. Subscription: the reminders follow the calculated expiry date'
update customers set lifecycle_stage = 'CUSTOMER' where id = (select id from sb where name = 'S');
create temp table sbr (d date);
grant all on sbr to authenticated;
insert into sbr select renews_on from customer_services where customer_id = (select id from sb where name = 'S');
select test.check((select (public.sub_reminder_schedule((select d - 15 from sbr), array['EMAIL', 'WHATSAPP']) ->> 'created')::int >= 2), 'fifteen days before the calculated expiry the e-mail and WhatsApp reminders are scheduled');
select public.sub_reminder_schedule((select d - 7 from sbr), array['EMAIL', 'WHATSAPP']);
select public.sub_reminder_schedule((select d - 3 from sbr), array['EMAIL', 'WHATSAPP']);
select public.sub_reminder_schedule((select d - 1 from sbr), array['EMAIL', 'WHATSAPP']);
select public.sub_reminder_schedule((select d from sbr), array['EMAIL', 'WHATSAPP']);
select test.check((select count(*) = 10 and bool_and(expiry_date = (select d from sbr)) and array_agg(distinct stage order by stage) = array[0, 1, 3, 7, 15]
                     from subscription_reminders where customer_id = (select id from sb where name = 'S') and channel in ('EMAIL', 'WHATSAPP')),
  'stages 15, 7, 3, 1 and 0 for each channel, all for the calculated expiry date');
select public.sub_reminder_schedule((select d - 15 from sbr), array['EMAIL', 'WHATSAPP']);
select public.sub_reminder_schedule((select d from sbr), array['EMAIL', 'WHATSAPP']);
select test.check((select count(*) = 10 from subscription_reminders where customer_id = (select id from sb where name = 'S') and channel in ('EMAIL', 'WHATSAPP')), 'running the decider again adds nothing: once per cycle and stage');
select test.check((select count(*) = 0 from subscription_reminders where customer_id = (select id from sb where name = 'S') and expiry_date <> (select d from sbr)),
  'no reminder uses any other date (account, payment, invoice or document date)');
select public.sub_reminder_schedule((select d - 15 from sbr), array['CALL']);
select public.sub_reminder_schedule((select d - 7 from sbr), array['CALL']);
select test.check((select count(*) = 1 and bool_and(stage = 7) from subscription_reminders where customer_id = (select id from sb where name = 'S') and channel = 'CALL'), 'the AI calls keep 7, 3 and 1 days');

\echo '--- 98. Subscription: a renewal keeps the history and starts a new cycle'
create temp table sbp (id uuid, other uuid);
grant all on sbp to authenticated;
insert into sbp select (select id from customer_payments where customer_id = (select id from sb where name = 'S') and status = 'VERIFIED' limit 1), gen_random_uuid();
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', (select id from sbp))$$, 'Sales cannot renew', 'NOT_FOUND');
select test.login('ds_mem');
select test.must_fail($$select confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', null)$$, 'a renewal needs a payment', 'Choose the verified payment');
select test.must_fail($$select confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', (select other from sbp))$$, 'a payment that is not this customer''s verified payment is refused', 'Accounts has verified');
select test.must_fail($$select confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', (select id from sbp), null, '{"durationCode":"1Y","expiryDate":"2030-01-01"}')$$, 'the expiry is never typed', 'calculated');
select test.must_fail($$select confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', (select id from sbp), (select d + 3 from sbr))$$, 'while it is running the renewal continues from the expiry', 'continues from its expiry');
select test.check((select r -> 'subscription' ->> 'startedOn' = (select d::text from sbr) and r -> 'subscription' ->> 'expiresOn' = (select (d + interval '1 year')::date::text from sbr)
                          and (r -> 'subscription' ->> 'cycle')::int = 2 and not (r ->> 'alreadyRenewed')::boolean
                     from (select confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', (select id from sbp), null, '{"durationCode":"1Y"}', 'Renewed for a year') as r) q),
  'the renewal starts on the old expiry date and ends one calendar year after it');
select test.check((confirm_subscription_renewal((select id from sb where name = 'S'), 'DS_META_ADS', (select id from sbp)) ->> 'alreadyRenewed')::boolean, 'the same payment cannot renew twice');
reset role;
select test.check((select count(*) = 2 and count(*) filter (where status = 'ENDED' and cycle_no = 1) = 1 and count(*) filter (where status = 'ACTIVE' and cycle_no = 2 and kind = 'RENEWAL') = 1
                     from subscription_cycles where customer_id = (select id from sb where name = 'S')), 'the first cycle is kept (ended), a renewal record is created');
select test.check((select count(*) = 1 from subscription_history where customer_id = (select id from sb where name = 'S') and action = 'RENEWED'), 'the renewal is in the history');
select public.sub_reminder_schedule((select d from sbr), array['EMAIL', 'WHATSAPP']);
select test.check((select count(*) = 0 from subscription_reminders where customer_id = (select id from sb where name = 'S') and expiry_date = (select d from sbr) and status in ('SCHEDULED', 'RETRY', 'DRY_RUN')),
  'the reminders of the old expiry are withdrawn');
select public.sub_reminder_schedule(((select d + interval '1 year' from sbr)::date - 7), array['EMAIL']);
select test.check((select count(*) = 1 from subscription_reminders where customer_id = (select id from sb where name = 'S') and expiry_date = (select (d + interval '1 year')::date from sbr) and stage = 7),
  'and the new cycle starts its own set from the new expiry date');

\echo '--- 99. Subscription: message usage alerts, once per cycle and threshold'
insert into service_usage (customer_id, service_code, kind, period, metrics, as_of) values
  ((select id from sb where name = 'S'), 'DS_META_ADS', 'WHATSAPP', '', '{"packageMessages": 1000, "sent": 650}', current_date);
select test.check((select count(*) = 0 from client_notifications where customer_id = (select id from sb where name = 'S') and type = 'USAGE_ALERT'), 'below 70 % nothing is sent');
update service_usage set metrics = '{"packageMessages": 1000, "sent": 710}' where customer_id = (select id from sb where name = 'S');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from sb where name = 'S') and type = 'USAGE_ALERT' and title like '%70%'), '70 % crossed: one alert');
update service_usage set metrics = '{"packageMessages": 1000, "sent": 730}' where customer_id = (select id from sb where name = 'S');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from sb where name = 'S') and type = 'USAGE_ALERT'), 'more usage under the same threshold sends nothing');
update service_usage set metrics = '{"packageMessages": 1000, "sent": 820}' where customer_id = (select id from sb where name = 'S');
update service_usage set metrics = '{"packageMessages": 1000, "sent": 1000}' where customer_id = (select id from sb where name = 'S');
select test.check((select count(*) = 3 from client_notifications where customer_id = (select id from sb where name = 'S') and type = 'USAGE_ALERT'), '80 % and then a jump to 100 % are one alert each (90 % is not announced separately)');
update service_usage set metrics = '{"packageMessages": 1000, "sent": 1000, "failed": 3}' where customer_id = (select id from sb where name = 'S');
select test.check((select count(*) = 3 from client_notifications where customer_id = (select id from sb where name = 'S') and type = 'USAGE_ALERT')
               and (select count(*) = 4 from usage_alert_log where customer_id = (select id from sb where name = 'S')), 'the same figures again send nothing');
set role authenticated;
select test.login('sb_s');
select test.check((select (x -> 'messages' ->> 'total')::numeric = 1000 and (x -> 'messages' ->> 'used')::numeric = 1000 and (x -> 'messages' ->> 'remaining')::numeric = 0 and (x -> 'messages' ->> 'percent')::numeric = 100
                     from jsonb_array_elements(client_subscriptions()) x where x ->> 'service' = 'DS_META_ADS'), 'the client sees total, used, remaining and the percentage from the usage data');
select test.login('tm_a');
select test.must_fail($$select set_usage_alert_settings(true, array[50, 90])$$, 'only the Super Admin changes the thresholds', 'Only the Super Admin');
select test.login('sa');
select test.check((set_usage_alert_settings(true, array[50, 90, 100]) -> 'thresholds') = '[50, 90, 100]'::jsonb, 'the Super Admin changes them');
select test.must_fail($$select set_usage_alert_settings(true, array[0, 150])$$, 'between 1 and 100', 'between 1 and 100');
select set_usage_alert_settings(true, array[70, 80, 90, 100]);
reset role;

\echo '--- 100. Subscription: customers and services without a duration behave as before'
select test.check((select count(*) > 0 from customer_services where duration_code is null and setup_status = 'READY'), 'services without terms exist and stay as they were');
set role authenticated;
select test.login('cdash_a');
select test.check(jsonb_typeof(client_subscriptions()) = 'array' and jsonb_array_length(client_subscriptions()) >= 1
                  and (select bool_and(x ->> 'status' in ('ACTIVE', 'NOT_STARTED', 'EXPIRED', 'PAUSED', 'CANCELLED')) from jsonb_array_elements(client_subscriptions()) x), 'an existing customer''s My Subscription still answers');
reset role;
\echo '--- 90-100 done'
