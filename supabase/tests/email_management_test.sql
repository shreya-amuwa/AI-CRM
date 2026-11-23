-- =============================================================================
-- Email management (migration 20270127000100): idempotent sending, no copies of authentication e-mails, CC / BCC rules resolved from
-- live assignments (assigned included, unrelated / departed / suspended excluded), suppression shared by every provider, provider
-- pauses and quota with a CRITICAL reserve, provider events, the Super Admin's settings and who sees which e-mail history.
-- Reuses wkr_tmp / wkr_tms (weekly_report_routing_test.sql), hr_head (hr_test.sql), sa (rls_test.sql), rr_rec1 (an HR Recruiter),
-- dh_wab (a Department Head outside HR), one existing customer and one existing job application (restored at the end). Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 170. Email management: idempotency, auth privacy, CC/BCC rules, suppression, quota, events, admin, visibility'
reset role;
\i supabase/migrations/20270127000100_email_management.sql
\i supabase/migrations/20270127000100_email_management.sql
grant execute on all functions in schema test to anon, authenticated, service_role;

-- fixtures: one customer, one job application, their assignments (remembered and restored at the end)
create table if not exists test.email_fx (k text primary key, v uuid);
truncate test.email_fx;
grant select on test.email_fx to anon, authenticated, service_role;
insert into test.email_fx values
  ('customer', (select id from customers order by created_at limit 1)),
  ('application', (select id from career_applications order by created_at limit 1));
insert into test.email_fx select 'acc_before', accounts_owner_id from customers where id = (select v from test.email_fx where k = 'customer');
insert into test.email_fx select 'posting', posting_id from career_applications where id = (select v from test.email_fx where k = 'application');
insert into test.email_fx select 'resp_before', responsible_id from career_postings where id = (select v from test.email_fx where k = 'posting');
insert into test.email_fx select 'meta_before', meta_verifier_id from customer_onboarding where customer_id = (select v from test.email_fx where k = 'customer');
create or replace function test.fx(p text) returns uuid language sql as $$ select v from test.email_fx where k = p $$;
create or replace function test.mail(p_who text) returns text language sql as $$ select lower(email) from public.profiles where id = test.id(p_who) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select test.check(test.fx('customer') is not null and test.fx('application') is not null, 'the test database has a customer and a job application to use');
insert into customer_onboarding (customer_id) values (test.fx('customer')) on conflict do nothing;
update customer_onboarding set meta_verifier_id = test.id('wkr_tmp') where customer_id = test.fx('customer');
update customers set accounts_owner_id = test.id('wkr_tms') where id = test.fx('customer');
update career_postings set responsible_id = test.id('rr_rec1') where id = test.fx('posting');
delete from email_events; delete from email_recipient_rules; delete from email_messages; delete from email_suppressions; delete from email_provider_state; delete from email_usage_daily; delete from email_quota_alerts; delete from email_senders;
update email_settings set provider_order = null, quota_thresholds = '{70,85,95,100}', resend_daily_limit = 100, resend_monthly_limit = 3000,
       ses_daily_limit = null, critical_reserve = 10, max_auto_recipients = 5, allowed_sender_domains = '{amuwa.com,example.com}' where id;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
create or replace function test.begin(p jsonb) returns jsonb language sql as $$
  select email_send_begin(jsonb_build_object('application', 'CRM', 'category', 'GENERAL', 'priority', 'NORMAL', 'to', 'client.one@example.org',
                                             'providers', '["resend","smtp"]'::jsonb) || p) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   rules: the assigned employees are copied, the unrelated are not'
insert into email_recipient_rules (name, category, mode, target, enabled, priority) values
  ('Meta Verification → assigned Meta Verifier CC', 'META_VERIFICATION', 'CC', 'META_VERIFIER', true, 10),
  ('Invoices → Accounts owner CC', 'INVOICE', 'CC', 'ACCOUNTS_OWNER', true, 10),
  ('Interview → assigned recruiter CC', 'INTERVIEW', 'CC', 'RECRUITER', true, 10);
insert into email_recipient_rules (name, category, mode, target, addresses, enabled, priority) values
  ('Escalations → CTO BCC', 'TECHNICAL', 'BCC', 'ADDRESS', '{cto@amuwa.com}', true, 20);
create temp table b1 as select test.begin(jsonb_build_object('category', 'META_VERIFICATION', 'context', jsonb_build_object('customerId', test.fx('customer')),
                                                              'idempotencyKey', 'test-meta-1')) b;
select test.check((select b -> 'cc' = jsonb_build_array(test.mail('wkr_tmp')) and b -> 'bcc' = '[]'::jsonb from b1),
  'Meta Verification e-mail: the assigned Meta Verifier (and only them) is CC');
select test.check((select not (b::text like '%' || test.mail('wkr_tms') || '%') from b1), 'the Accounts owner of the same customer is not copied on a Meta Verification e-mail');
select test.check((select b -> 'cc' = jsonb_build_array(test.mail('wkr_tms'))
                     from (select test.begin(jsonb_build_object('category', 'INVOICE', 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'invoice e-mail: the customer''s Accounts owner is CC, the Meta Verifier is not');
select test.check((select b -> 'cc' = jsonb_build_array(test.mail('rr_rec1'))
                     from (select test.begin(jsonb_build_object('category', 'INTERVIEW', 'application', 'CANDIDATE_PORTAL', 'to', 'cand@example.org',
                                                                'context', jsonb_build_object('applicationId', test.fx('application')))) b) x),
  'interview e-mail: the vacancy''s recruiter is CC (not every HR employee)');
select test.check((select b -> 'bcc' = '["cto@amuwa.com"]'::jsonb and b -> 'cc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'TECHNICAL')) b) x), 'technical escalation: the configured CTO address is BCC');
select test.check((select b -> 'cc' = '[]'::jsonb and b -> 'bcc' = '[]'::jsonb from (select test.begin(jsonb_build_object('category', 'SALES')) b) x),
  'a category without rules copies nobody');

\echo '   staff changes are seen at once: reassigned, suspended, disabled rule'
update customer_onboarding set meta_verifier_id = test.id('wkr_tms') where customer_id = test.fx('customer');
select test.check((select b -> 'cc' = jsonb_build_array(test.mail('wkr_tms'))
                     from (select test.begin(jsonb_build_object('category', 'META_VERIFICATION', 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'a reassigned customer: the new Meta Verifier is copied, the previous one no longer');
update profiles set status = 'SUSPENDED' where id = test.id('wkr_tms');
select test.check((select b -> 'cc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'META_VERIFICATION', 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'a suspended employee is never copied');
update profiles set status = 'ACTIVE' where id = test.id('wkr_tms');
update email_recipient_rules set enabled = false where category = 'META_VERIFICATION';
select test.check((select b -> 'cc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'META_VERIFICATION', 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'a disabled rule copies nobody');
update email_recipient_rules set enabled = true where category = 'META_VERIFICATION';

\echo '   duplicates, the recipient, CC beats BCC, the recipient limit'
insert into email_recipient_rules (name, category, mode, target, profile_ids, enabled) values ('dup', 'META_VERIFICATION', 'BCC', 'PROFILE', array[test.id('wkr_tms')], true);
select test.check((select b -> 'cc' = jsonb_build_array(test.mail('wkr_tms')) and b -> 'bcc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'META_VERIFICATION', 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'an address chosen as both CC and BCC is copied once, as CC');
select test.check((select b -> 'cc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'META_VERIFICATION', 'to', test.mail('wkr_tms'), 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'the recipient is never copied to themselves');
select test.check((select b -> 'cc' = '["boss@example.org"]'::jsonb and b -> 'bcc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'SALES', 'cc', '["Boss@Example.org", "client.one@example.org"]'::jsonb,
                                                                'bcc', '["boss@example.org"]'::jsonb)) b) x),
  'requested copies are normalised, deduplicated, and never repeat the recipient');
delete from email_recipient_rules where name = 'dup';
update email_settings set max_auto_recipients = 0 where id;
select test.check((select b -> 'cc' = '[]'::jsonb
                     from (select test.begin(jsonb_build_object('category', 'INVOICE', 'context', jsonb_build_object('customerId', test.fx('customer')))) b) x),
  'the maximum number of automatic recipients is applied');
update email_settings set max_auto_recipients = 5 where id;

\echo '   authentication and credential e-mails: never a copy, whatever is configured'
insert into email_recipient_rules (name, category, mode, target, addresses, enabled) values ('ok', 'GENERAL', 'BCC', 'ADDRESS', '{audit@amuwa.com}', true);
select test.must_fail($$insert into email_recipient_rules (name, category, mode, target, addresses, enabled) values ('bad', 'AUTH', 'BCC', 'ADDRESS', '{audit@amuwa.com}', true)$$,
  'a rule for AUTH e-mail cannot even be stored', 'violates check constraint');
select test.must_fail($$select test.begin('{"category": "AUTH", "cc": ["hr@amuwa.com"]}')$$, 'an AUTH e-mail asking for a CC is refused', 'cannot have CC or BCC');
select test.must_fail($$select test.begin('{"category": "GENERAL", "sensitive": true, "bcc": ["audit@amuwa.com"]}')$$,
  'any e-mail marked sensitive (a reset link sent as GENERAL) asking for a BCC is refused', 'cannot have CC or BCC');
create temp table b2 as select test.begin('{"category": "AUTH", "priority": "CRITICAL", "to": "employee.x@example.org"}') b;
select test.check((select b -> 'cc' = '[]'::jsonb and b -> 'bcc' = '[]'::jsonb from b2), 'an OTP / reset / magic link e-mail resolves no CC and no BCC');
select test.check((select recipient = 'e***@example.org' and cc = '{}' and bcc = '{}' from email_messages where id = (select (b ->> 'logId')::uuid from b2)),
  'and its log keeps only a masked address');
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b2), 'status', 'ACCEPTED', 'provider', 'resend',
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'ACCEPTED'))));
select test.check((select b -> 'bcc' = '[]'::jsonb from (select test.begin('{"category": "CREDENTIALS", "to": "client.x@example.org"}') b) x),
  'credentials (temporary password, set-password link) get no copy either, even with a GENERAL-style BCC rule elsewhere');
delete from email_recipient_rules where name = 'ok';

\echo '   one send per business event'
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b1), 'status', 'ACCEPTED', 'provider', 'resend', 'providerMessageId', 're_msg_1',
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'ACCEPTED', 'status', 200, 'ref', 're_msg_1', 'ms', 120))));
select test.check((select b ->> 'duplicate' = 'ACCEPTED' and b ->> 'providerMessageId' = 're_msg_1'
                     from (select test.begin('{"category": "META_VERIFICATION", "idempotencyKey": "test-meta-1"}') b) x),
  'the same business event again is answered "already accepted" (no second e-mail)');
create temp table b3 as select test.begin('{"idempotencyKey": "test-busy-1"}') b;
select test.check((select b ->> 'duplicate' = 'IN_PROGRESS' from (select test.begin('{"idempotencyKey": "test-busy-1"}') b) x),
  'a second Worker asking while the first is sending is told it is in progress');
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b3), 'status', 'UNKNOWN_ACCEPTANCE', 'provider', 'resend', 'errorCategory', 'TIMEOUT',
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'UNKNOWN_ACCEPTANCE', 'category', 'TIMEOUT'))));
select test.check((select b ->> 'duplicate' = 'UNKNOWN_ACCEPTANCE' and b ->> 'provider' = 'resend' from (select test.begin('{"idempotencyKey": "test-busy-1"}') b) x),
  'after a timeout the outcome is UNKNOWN_ACCEPTANCE: only the same provider may be asked again (no cross-provider duplicate)');
select b ->> 'logId' as b3id from b3 \gset
set role authenticated;
select test.login('hr_head');
select test.must_fail(format($$select email_message_review(%L, false)$$, :'b3id'), 'only the Super Admin reviews an unknown outcome', 'FORBIDDEN');
select test.login('sa');
select email_message_review(:'b3id', false);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.check((select b -> 'duplicate' = 'null'::jsonb from (select test.begin('{"idempotencyKey": "test-busy-1"}') b) x),
  'after the Super Admin marks it as not received, the next send of the same event may go out');
create temp table b4 as select test.begin('{"idempotencyKey": "test-retry-1"}') b;
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b4), 'status', 'RETRY_PENDING', 'errorCategory', 'TEMPORARY',
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'RETRYABLE', 'category', 'TEMPORARY', 'status', 503))));
select test.check((select b -> 'duplicate' = 'null'::jsonb and b ->> 'logId' = (select b ->> 'logId' from b4) from (select test.begin('{"idempotencyKey": "test-retry-1"}') b) x),
  'a definite failure may be sent again, on the same log row');
select test.check((select attempts = 1 and status = 'PROCESSING' from email_messages where id = (select (b ->> 'logId')::uuid from b4)), 'its attempt history is kept');

\echo '   suppression is shared by every provider'
insert into email_suppressions (email, reason, source) values ('bounced@example.org', 'HARD_BOUNCE', 'resend');
select test.check((select b -> 'suppressed' = '["bounced@example.org"]'::jsonb from (select test.begin('{"to": "bounced@example.org"}') b) x),
  'an address Resend bounced is suppressed for every provider (SES / SMTP cannot bypass it)');
select test.check(exists (select 1 from email_messages where recipient = 'bounced@example.org' and status = 'SUPPRESSED'), '... and logged as SUPPRESSED');
select test.check((select b -> 'cc' = '[]'::jsonb and b -> 'suppressed' = '["bounced@example.org"]'::jsonb
                     from (select test.begin('{"category": "SALES", "cc": ["bounced@example.org"]}') b) x), 'a suppressed address is also removed from CC');

\echo '   provider state shared by every Worker instance; quota and the CRITICAL reserve'
create temp table b5 as select test.begin('{}') b;
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b5), 'status', 'ACCEPTED', 'provider', 'smtp', 'fallbackUsed', true,
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'REJECTED', 'category', 'QUOTA_DAILY', 'status', 429),
                                jsonb_build_object('provider', 'smtp', 'outcome', 'ACCEPTED', 'status', 250))));
select test.check((select paused_until >= (date_trunc('day', now() at time zone 'UTC') + interval '1 day') at time zone 'UTC' - interval '1 second' and pause_reason = 'QUOTA_DAILY'
                     from email_provider_state where provider = 'resend'), 'a daily quota refusal pauses Resend until the next UTC midnight');
select test.check((select x ->> 'provider' = 'resend' and not (x ->> 'allowed')::boolean and x ->> 'reason' = 'QUOTA_DAILY'
                     from (select test.begin('{}') b) y, jsonb_array_elements(b -> 'providers') x where x ->> 'provider' = 'resend'),
  'every instance now skips Resend (shared state, not memory)');
select test.check((select fallback_used and provider = 'smtp' from email_messages where id = (select (b ->> 'logId')::uuid from b5)), 'the fallback is recorded');
delete from email_provider_state;
insert into email_usage_daily (provider, day, accepted_recipients) values ('resend', (now() at time zone 'UTC')::date, 85)
on conflict (provider, day) do update set accepted_recipients = 85;
delete from email_messages where status = 'PROCESSING';
select test.check((select not (x ->> 'allowed')::boolean and x ->> 'reason' = 'CRITICAL_RESERVE'
                     from (select test.begin('{"priority": "NORMAL", "cc": ["a@example.org","b@example.org","c@example.org","d@example.org","e@example.org"]}') b) y,
                          jsonb_array_elements(b -> 'providers') x where x ->> 'provider' = 'resend'),
  'near the daily limit, a NORMAL e-mail may not use the last few (kept for CRITICAL)');
delete from email_messages where status = 'PROCESSING';
select test.check((select (x ->> 'allowed')::boolean from (select test.begin('{"priority": "CRITICAL", "category": "AUTH"}') b) y,
                          jsonb_array_elements(b -> 'providers') x where x ->> 'provider' = 'resend'), '... while a CRITICAL sign-in e-mail still may');
update email_settings set provider_order = '{smtp,resend}' where id;
select test.check((select b -> 'providers' -> 0 ->> 'provider' = 'smtp' from (select test.begin('{}') b) x), 'the Super Admin''s provider order is used');
select test.check((select jsonb_array_length(b -> 'providers') = 1 from (select email_send_begin('{"to": "x@example.org", "providers": ["resend"]}') b) x),
  'a provider the deployment has not configured is never offered, whatever the order says');
update email_settings set provider_order = null where id;

\echo '   quota alerts: once per threshold and period'
delete from email_messages where status = 'PROCESSING';
delete from notifications where type = 'EMAIL_QUOTA_ALERT';
update email_usage_daily set accepted_recipients = 69 where provider = 'resend';
create temp table b6 as select test.begin('{"priority": "CRITICAL"}') b;
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b6), 'status', 'ACCEPTED', 'provider', 'resend', 'providerMessageId', 're_msg_6',
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'ACCEPTED')), 'usage', jsonb_build_object('provider', 'resend', 'daily', '70', 'monthly', '512')));
select test.check((select count(*) >= 1 from notifications where type = 'EMAIL_QUOTA_ALERT' and recipient_id = test.id('sa')), 'reaching 70% notifies the Super Admin');
create temp table b7 as select test.begin('{"priority": "CRITICAL"}') b;
select email_send_finish(jsonb_build_object('logId', (select b ->> 'logId' from b7), 'status', 'ACCEPTED', 'provider', 'resend',
  'attempts', jsonb_build_array(jsonb_build_object('provider', 'resend', 'outcome', 'ACCEPTED'))));
select test.check((select count(*) = 1 from notifications where type = 'EMAIL_QUOTA_ALERT' and recipient_id = test.id('sa')), 'the same alert is not sent again');
select test.check((select reported_daily = '70' and reported_monthly = '512' from email_provider_state where provider = 'resend'),
  'the usage the provider reported is kept apart from the CRM''s own count');

\echo '   provider events (verified webhooks): once each; delivered, bounced, complained'
select test.check((select (email_provider_event('{"provider":"resend","eventId":"msg_evt_1","type":"email.delivered","providerMessageId":"re_msg_1","recipients":["client.one@example.org"]}') ->> 'matched')::boolean),
  'a delivered event is matched to its e-mail');
select test.check((select status = 'DELIVERY_CONFIRMED' and delivered_at is not null from email_messages where provider_message_id = 're_msg_1'),
  'only now is the e-mail DELIVERY_CONFIRMED (acceptance alone never is)');
select test.check((select (email_provider_event('{"provider":"resend","eventId":"msg_evt_1","type":"email.delivered","providerMessageId":"re_msg_1"}') ->> 'duplicate')::boolean),
  'the same event delivered twice is recorded once');
select email_provider_event('{"provider":"resend","eventId":"msg_evt_2","type":"email.bounced","bounceType":"Permanent","providerMessageId":"re_msg_6","recipients":["client.one@example.org"]}');
select test.check((select status = 'BOUNCED' from email_messages where provider_message_id = 're_msg_6')
                  and exists (select 1 from email_suppressions where email = 'client.one@example.org' and active and reason = 'HARD_BOUNCE'),
  'a hard bounce marks the e-mail BOUNCED and suppresses the address');
select email_provider_event('{"provider":"resend","eventId":"msg_evt_3","type":"email.bounced","bounceType":"Transient","providerMessageId":"x","recipients":["soft@example.org"]}');
select test.check(not exists (select 1 from email_suppressions where email = 'soft@example.org'), 'a soft (transient) bounce does not suppress');
select email_provider_event('{"provider":"resend","eventId":"msg_evt_4","type":"email.complained","providerMessageId":"x","recipients":["angry@example.org"]}');
select test.check(exists (select 1 from email_suppressions where email = 'angry@example.org' and reason = 'COMPLAINT'), 'a complaint suppresses the address');

\echo '   permissions: service-only sending, Super Admin settings, audited'
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select email_send_begin('{}')$$, 'staff cannot call the sending functions', 'permission denied');
select test.must_fail($$select email_provider_event('{}')$$, 'staff cannot post provider events', 'permission denied');
select test.must_fail($$select email_admin_overview()$$, 'a team member cannot open Email Management', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$select email_settings_save('{}')$$, 'HR cannot change e-mail settings', 'FORBIDDEN');
select test.must_fail($$select email_rule_save('{"name":"x","category":"HR","mode":"CC","target":"ADDRESS","addresses":["hr@amuwa.com"]}')$$, 'HR cannot add rules', 'FORBIDDEN');
select test.login('sa');
select test.check((select o -> 'settings' ->> 'resendDailyLimit' = '100' and jsonb_array_length(o -> 'providers') = 3 and (o -> 'rules') is not null
                     from (select email_admin_overview() o) x), 'the Super Admin opens the overview');
select test.must_fail($$select email_settings_save('{"providerOrder": ["resend","gmail"]}')$$, 'an unknown provider cannot be put in the order', 'VALIDATION_ERROR');
select test.check((select s -> 'providerOrder' = '["ses","resend","smtp"]'::jsonb
                     from (select email_settings_save('{"providerOrder": ["ses","resend","smtp"], "quotaThresholds": [80, 95], "allowedSenderDomains": ["amuwa.com","example.com"]}') s) x),
  'the Super Admin sets SES → Resend → SMTP without a code change');
select email_settings_save('{"providerOrder": null, "allowedSenderDomains": ["amuwa.com","example.com"]}');
select test.must_fail($$select email_sender_save('RECRUITMENT', 'careers@gmail.com', 'Amuwa Careers', null, true)$$, 'a sender on another domain is refused', 'allowed sender domain');
select email_sender_save('RECRUITMENT', 'Careers@Amuwa.com', 'Amuwa Careers', 'hr@amuwa.com', true);
select test.must_fail($$select email_rule_save('{"name":"x","category":"AUTH","mode":"BCC","target":"ADDRESS","addresses":["audit@amuwa.com"]}')$$,
  'no rule for authentication e-mail, not even by the Super Admin', 'never be copied');
select test.must_fail($$select email_rule_save('{"name":"x","category":"SALES","mode":"CC","target":"ADDRESS","addresses":["someone@gmail.com"]}')$$,
  'copies go only to company addresses', 'company addresses');
create temp table rid as select email_rule_save(jsonb_build_object('name', 'Onboarding → relationship manager', 'category', 'CLIENT_ONBOARDING', 'mode', 'CC',
                                                'target', 'ACCOUNTS_OWNER', 'enabled', false)) id;
select test.check((select jsonb_array_length(p -> 'recipients') = 1 and p -> 'recipients' -> 0 ->> 'email' = test.mail('wkr_tms') and p -> 'recipients' -> 0 ->> 'name' is not null
                     from (select email_rule_preview((select id from rid), test.fx('customer'), null) p) x),
  'the preview shows who a (still disabled) rule would copy for a real customer');
select test.must_fail($$select email_rule_preview((select id from rid), null, null)$$, 'a preview needs a real record', 'VALIDATION_ERROR');
select email_suppression_set('angry@example.org', false, 'customer asked to receive e-mail again');
select test.check((select h -> 'total' is not null from (select email_history('{}') h) x), 'the Super Admin reads the history');
reset role;
select test.check((select from_email = 'careers@amuwa.com' from email_senders where category = 'RECRUITMENT'), 'a sender is saved lower-case');
select test.check((select b -> 'sender' ->> 'email' = 'careers@amuwa.com' and b -> 'sender' ->> 'replyTo' = 'hr@amuwa.com'
                     from (select test.begin('{"category": "RECRUITMENT"}') b) x), 'sending uses the category''s sender and reply-to');
select test.check(not exists (select 1 from email_suppressions where email = 'angry@example.org' and active), 'a suppression can be lifted by the Super Admin');
select test.check((select count(*) >= 5 from audit_logs where actor_id = test.id('sa') and action in ('EMAIL_SETTINGS_UPDATED', 'EMAIL_SENDER_UPDATED', 'EMAIL_RULE_CREATED', 'EMAIL_UNSUPPRESSED')),
  'settings, senders, rules and suppressions are audited');

\echo '   history: each person sees only what their work allows; no bodies, no BCC, no authentication details'
update email_messages set customer_id = test.fx('customer') where provider_message_id = 're_msg_1';
select id as m1 from email_messages where provider_message_id = 're_msg_1' \gset
insert into email_messages (category, application, recipient, application_id, status) values ('INTERVIEW', 'CANDIDATE_PORTAL', 'cand@example.org', test.fx('application'), 'ACCEPTED');
set role authenticated;
select test.login('hr_head');
select test.check((select bool_and(i ->> 'category' in ('RECRUITMENT', 'INTERVIEW', 'HR') or i ->> 'customerId' is not null) and count(*) >= 1
                     from jsonb_array_elements(email_history('{}') -> 'items') i), 'HR sees recruitment and interview e-mails');
select test.check((select bool_and(i -> 'bcc' = 'null'::jsonb) from jsonb_array_elements(email_history('{}') -> 'items') i), 'HR never sees BCC addresses');
select test.login('rr_rec1');
select test.check((select count(*) >= 1 and bool_and(i ->> 'applicationId' = test.fx('application')::text) from jsonb_array_elements(email_history('{"category":"INTERVIEW"}') -> 'items') i),
  'a recruiter sees the interview e-mails of their own vacancy');
select test.login('dh_wab');
select test.check(not exists (select 1 from jsonb_array_elements(email_history('{}') -> 'items') i where i ->> 'category' in ('AUTH', 'CREDENTIALS', 'INTERVIEW', 'RECRUITMENT', 'HR')),
  'a Department Head outside HR sees no candidate or authentication e-mail');
select test.login('sa');
select test.check((select count(*) >= 1 from jsonb_array_elements(email_history('{"category":"AUTH"}') -> 'items') i where i ->> 'recipient' like '%***%'),
  'even the Super Admin sees authentication e-mails with a masked address only');
select test.check((select jsonb_array_length(d -> 'attempts') >= 1 from (select email_history_detail(:'m1') d) x),
  'the Super Admin opens one e-mail''s attempts and events');
reset role;

-- restore the fixtures
update customer_onboarding set meta_verifier_id = test.fx('meta_before') where customer_id = test.fx('customer');
update customers set accounts_owner_id = test.fx('acc_before') where id = test.fx('customer');
update career_postings set responsible_id = test.fx('resp_before') where id = test.fx('posting');
delete from email_events; delete from email_recipient_rules; delete from email_messages; delete from email_suppressions; delete from email_provider_state; delete from email_usage_daily;
delete from email_quota_alerts; delete from email_senders; delete from notifications where type = 'EMAIL_QUOTA_ALERT';
update email_settings set provider_order = null, quota_thresholds = '{70,85,95,100}', allowed_sender_domains = '{amuwa.com}' where id;
