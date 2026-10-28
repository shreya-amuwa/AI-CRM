-- =============================================================================
-- Onboarding email + WhatsApp automations (migration 20261016000100).
-- Runs after rls_test.sql and payments_test.sql (same database, reuses the
-- `test` helpers and users). Nothing is sent: the database only queues jobs.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 27. Onboarding automations: client stage, outbox, sending'
reset role;
create temp table au (name text primary key, id uuid);
grant all on au to authenticated, service_role;
-- the test helpers are also used while acting as the API server (service role)
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
grant select on all tables in schema test to service_role;

-- Wabastore WhatsApp API customers in onboarding, and one that is not automated.
set role authenticated;
select test.login('tm_a');
insert into au select 'site', create_lead('{"name":"Site Owner","company":"Site Traders","email":"site.owner@example.com","whatsapp":"+91 98199 00011","phone":"9819900022","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
insert into au select 'nosite', create_lead('{"name":"No Site","company":"No Site Stores","email":"nosite@example.com","phone":"9819900022","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
insert into au select 'early', create_lead('{"name":"Early Login","company":"Early Co","email":"early@example.com","phone":"9819900022","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
insert into au select 'other', create_lead('{"name":"Other Service","company":"Calls Only","email":"calls@example.com","phone":"9819900022","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
do $$
declare r record;
begin
  for r in select id from au loop
    update public.customers set lifecycle_stage = 'POTENTIAL', deal_amount = 1000, amount_received = 1000, stage_changed_at = now() where id = r.id;
  end loop;
end $$;
set role authenticated;
select test.login('tm_a');
select start_customer_onboarding(id, 0, 'UPI', null) from au;

-- Website: only a real web address is accepted
select test.must_fail($$select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'a')$$, 'a single letter is not a website', 'Enter the website address');
select test.must_fail($$select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'localhost')$$, 'localhost is not a website', 'Enter the website address');
select test.must_fail($$select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'http://192.168.1.10')$$, 'an IP address is not a website', 'Enter the website address');
select test.must_fail($$select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'my shop.com')$$, 'spaces are not allowed', 'Enter the website address');
select test.must_fail($$select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'https://shop.c0m')$$, 'the ending must be letters', 'Enter the website address');
-- Website: a URL (normalized) or "no website"
select test.must_fail($$select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'not a website')$$,
  'a website that is not an address is refused', 'Enter the website address');
select save_onboarding_entry((select id from au where name = 'site'), 'WA_WEBSITE_URL', 'www.site-traders.example');
select save_onboarding_entry((select id from au where name = 'nosite'), 'WA_WEBSITE_URL', 'NO_WEBSITE');
select save_onboarding_entry((select id from au where name = 'early'), 'WA_WEBSITE_URL', 'https://early.example/home');
reset role;
select test.check((select value = 'https://www.site-traders.example' from customer_onboarding_entries
                    where customer_id = (select id from au where name = 'site') and item_code = 'WA_WEBSITE_URL'),
  'a website without https:// is saved as https://...');
select test.check((select value = 'NO_WEBSITE' from customer_onboarding_entries
                    where customer_id = (select id from au where name = 'nosite') and item_code = 'WA_WEBSITE_URL'),
  '"Customer has no website" is saved as NO_WEBSITE');

-- Every checklist item saved by sales (files and details), as the real flow requires before sending.
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_at)
select a.id, i.code, case when i.kind = 'YES_NO' then 'YES' else 'saved' end, 'SAVED', now()
  from au a cross join lateral private.customer_items(a.id) i
 where i.code <> 'WA_WEBSITE_URL'
on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from au;
select test.check((select count(*) = 0 from automation_jobs where customer_id in (select id from au))
                   and (select bool_and(client_status is null) from customer_onboarding where customer_id in (select id from au)),
  'nothing is queued before the customer reaches the Technical Consultant');

-- Reaching the Technical Consultant (Accounts confirmed) sends nothing yet
select private.forward_to_consultant(a.id, c, false) from au a join customers c on c.id = a.id;
select test.check((select count(*) = 0 from automation_jobs where customer_id in (select id from au))
                   and (select bool_and(client_status is null) from customer_onboarding where customer_id in (select id from au)),
  'reaching the Technical Consultant sends nothing: the messages wait for "Send for onboarding"');
-- Step 1: the TC clicks "Send for onboarding" (add-ons or not): the first messages are queued
set role authenticated;
reset role;
-- the add-on question is the consultant's, later: here the answer is recorded as the data that the rest of the test needs
update customer_onboarding set addons_required = (customer_id = (select id from au where name = 'nosite')) where customer_id in (select id from au where name <> 'other');
set role authenticated;
select test.login('late_verifier');
select consultant_start_onboarding(a.id) from au a where a.name <> 'other';
reset role;
select test.check((select client_status = 'UNDER_REVIEW' from customer_onboarding where customer_id = (select id from au where name = 'site'))
                   and (select count(*) = 2 and bool_and(stage = 'UNDER_REVIEW' and status = 'QUEUED') and count(distinct channel) = 2
                          from automation_jobs where customer_id = (select id from au where name = 'site')),
  'with a website: Under Review, one email and one WhatsApp queued');
select test.check((select client_status = 'WEBSITE_PENDING' from customer_onboarding where customer_id = (select id from au where name = 'nosite'))
                   and (select count(*) = 2 and bool_and(stage = 'WEBSITE_PENDING') from automation_jobs where customer_id = (select id from au where name = 'nosite')),
  'no website ticked: Website Pending (mini website email + WhatsApp)');
select test.check((select client_status is null from customer_onboarding where customer_id = (select id from au where name = 'other'))
                   and (select count(*) = 0 from automation_jobs where customer_id = (select id from au where name = 'other')),
  'customers without the WhatsApp API service are not automated');
select test.check((select dedupe_key = format('ONBOARD|%s|EMAIL|UNDER_REVIEW', (select id from au where name = 'site')) from automation_jobs
                    where customer_id = (select id from au where name = 'site') and channel = 'EMAIL'),
  'each job has a unique key per customer, channel and stage');

-- Asking for add-on services afterwards never sends the onboarding messages again
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select consultant_set_addons_required((select id from au where name = 'site'), true)$$, 'the consultant does not take part in the first verification of a WhatsApp customer', 'NOT_FOUND');
reset role;
update customer_onboarding set addons_required = true where customer_id = (select id from au where name = 'site');
select test.check((select count(*) = 2 from automation_jobs where customer_id = (select id from au where name = 'site')),
  'asking for add-ons later sends no new onboarding messages');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select consultant_start_onboarding((select id from au where name = 'site'))$$, 'onboarding cannot be started twice (so it cannot send twice)', 'already in onboarding');
reset role;

-- Sent back to sales and sent again: nothing is sent twice
update customer_onboarding set returned_at = now() where customer_id = (select id from au where name = 'site');
select private.forward_to_consultant(a.id, c, true) from au a join customers c on c.id = a.id where a.name = 'site';
select test.check((select count(*) = 2 from automation_jobs where customer_id = (select id from au where name = 'site')),
  'returned and sent again: no second Under Review message');

-- Step 2: the TC authorizes every document (website already there)
set role authenticated;
select test.login('late_verifier');
-- (the client login is Accounts' job now, whatever the verification stage: see client_provisioning_test.sql)
select verify_all_onboarding_entries((select id from au where name = 'site'));
reset role;
select test.check((select client_status = 'META_VERIFICATION' from customer_onboarding where customer_id = (select id from au where name = 'site'))
                   and (select count(*) = 2 and bool_and(context ->> 'from' = 'UNDER_REVIEW') from automation_jobs
                          where customer_id = (select id from au where name = 'site') and stage = 'META_VERIFICATION'),
  'every document authorized: Meta Verification email + WhatsApp queued');
select test.check((select consultant_items_done < consultant_items_total from customer_onboarding where customer_id = (select id from au where name = 'site')),
  '(the WABA ID is not needed yet for this step)');

-- No website: authorizing alone is not enough; the TC must save the new website's link
set role authenticated;
select test.login('late_verifier');
select verify_all_onboarding_entries((select id from au where name = 'nosite'));
reset role;
select test.check((select client_status = 'WEBSITE_PENDING' from customer_onboarding where customer_id = (select id from au where name = 'nosite'))
                   and (select count(*) = 2 from automation_jobs where customer_id = (select id from au where name = 'nosite')),
  'no website yet: stays at Website Pending even when every document is authorized');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select consultant_set_website((select id from au where name = 'nosite'), 'https://nosite.example')$$,
  'sales cannot use the consultant''s website action', 'NOT_FOUND');
select test.login('late_verifier');
select test.must_fail($$select consultant_set_website((select id from au where name = 'nosite'), '')$$, 'an empty link is refused', 'Enter the website address');
select test.login('late_consultant');
select test.must_fail($$select consultant_set_website((select id from au where name = 'other'), 'https://x.example')$$, 'only for services with a website item', 'no website item');
select test.login('late_verifier');
select test.must_fail($$select consultant_set_website((select id from au where name = 'other'), 'https://x.example')$$, 'a Meta Verifier cannot work on a customer of the consultant''s own route', 'NOT_FOUND');
select test.check((select consultant_set_website((select id from au where name = 'nosite'), 'nosite-stores.example') = 'https://nosite-stores.example'),
  'the TC saves the new website link');
reset role;
select test.check((select status = 'SAVED' and reviewed_at is null from customer_onboarding_entries where customer_id = (select id from au where name = 'nosite') and item_code = 'WA_WEBSITE_URL'),
  'the saved link waits for the TC''s Authorize');
select test.check((select client_status = 'WEBSITE_PENDING' from customer_onboarding where customer_id = (select id from au where name = 'nosite'))
                   and (select count(*) = 2 from automation_jobs where customer_id = (select id from au where name = 'nosite')),
  'saving the link alone sends nothing: the TC has not authorized it yet');
-- Authorize the website: the customer is told the mini website is ready, then Meta Verification follows
set role authenticated;
select test.login('late_verifier');
select review_onboarding_entry((select id from au where name = 'nosite'), 'WA_WEBSITE_URL', 'VERIFIED', null);
reset role;
select test.check((select count(*) = 2 and bool_and(status = 'QUEUED') and count(*) filter (where channel = 'EMAIL') = 1 and count(*) filter (where channel = 'WHATSAPP') = 1
                     from automation_jobs where customer_id = (select id from au where name = 'nosite') and stage = 'WEBSITE_READY'),
  'authorizing the website queues the "website is ready" email + WhatsApp');
select test.check((select client_status = 'META_VERIFICATION' from customer_onboarding where customer_id = (select id from au where name = 'nosite'))
                   and (select count(*) = 6 from automation_jobs where customer_id = (select id from au where name = 'nosite'))
                   and not exists (select 1 from automation_jobs where customer_id = (select id from au where name = 'nosite') and stage = 'UNDER_REVIEW')
                   and (select bool_and(context ->> 'from' = 'WEBSITE_PENDING') from automation_jobs
                          where customer_id = (select id from au where name = 'nosite') and stage = 'META_VERIFICATION'),
  'website created + documents authorized: Meta Verification (never Under Review)');
select test.check((select min(next_attempt_at) filter (where stage = 'WEBSITE_READY') < min(next_attempt_at) filter (where stage = 'META_VERIFICATION')
                     from automation_jobs where customer_id = (select id from au where name = 'nosite')),
  '"website is ready" goes out before "Meta Verification"');
set role authenticated;
select test.login('late_verifier');
select consultant_set_website((select id from au where name = 'nosite'), 'https://nosite-stores.example/corrected');
select review_onboarding_entry((select id from au where name = 'nosite'), 'WA_WEBSITE_URL', 'VERIFIED', null);
reset role;
select test.check((select count(*) = 6 from automation_jobs where customer_id = (select id from au where name = 'nosite')),
  'correcting the link and authorizing it again sends nothing again');
-- a customer who started with a website gets no "website ready" message
select test.check((select count(*) = 0 from automation_jobs where customer_id = (select id from au where name = 'site') and stage = 'WEBSITE_READY'),
  'a customer who had a website from the start gets no "website ready" message');

-- Step 3: Accounts creates the client login (for any service). A login is NOT "Meta Verification completed", and no password exists anywhere.
reset role;
update customers set deal_amount = 5000, amount_received = 5000, amount_verified = 5000 where id = (select id from au where name = 'site');
update customer_onboarding set accounts_confirmed_at = coalesce(accounts_confirmed_at, now()) where customer_id = (select id from au where name = 'site');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select accounts_client_login_begin((select id from au where name = 'site'))$$, 'the Meta Verifier cannot create the client login', 'Only the Accounts department');
select test.must_fail($$select assert_client_account_allowed((select id from au where name = 'site'), 'site.owner@example.com')$$, 'nor check one', 'NOT_FOUND');
select test.login('late_consultant');
select test.must_fail($$select accounts_client_login_begin((select id from au where name = 'site'))$$, 'the Technical Consultant cannot create the client login', 'Only the Accounts department');
select test.must_fail($$select record_client_account((select id from au where name = 'site'), gen_random_uuid(), 'site.owner@example.com')$$, 'nor record one', 'NOT_FOUND');
select test.login('acc_m');
select test.check((accounts_client_login_begin((select id from au where name = 'site')) ->> 'email') = 'site.owner@example.com',
  'the login e-mail is the one on the customer record');
reset role;
do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v, 'site.owner@example.com', '{}', jsonb_build_object('provider', 'email', 'client_customer_id', (select id from au where name = 'site')));
  insert into test.users values ('client_site', v);
end $$;
select test.check((select count(*) = 0 from automation_jobs where customer_id = (select id from au where name = 'site') and stage = 'ACCOUNT_CREATED'),
  'nothing is queued while the login is only being created');
set role authenticated;
select test.login('acc_m');
select record_client_account((select id from au where name = 'site'), test.id('client_site'), 'site.owner@example.com');
reset role;
select test.check((select client_status = 'META_VERIFICATION' from customer_onboarding where customer_id = (select id from au where name = 'site'))
                   and (select count(*) = 0 from automation_jobs where customer_id = (select id from au where name = 'site') and stage = 'COMPLETED'),
  'a login does not complete the status: no Status Completed message is queued because of it');
select test.check((select count(*) = 2 and bool_and(status = 'QUEUED') and count(*) filter (where channel = 'EMAIL') = 1 from automation_jobs
                    where customer_id = (select id from au where name = 'site') and stage = 'ACCOUNT_CREATED'),
  'the account-created e-mail and WhatsApp are queued once the login is saved');
select test.check((select count(*) = 0 from automation_jobs where secret is not null), 'no password or secret is kept on any job');
-- "Meta Verification completed" is its own event
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select mark_meta_verification_completed((select id from au where name = 'site'))$$, 'Sales cannot record the Meta result', 'NOT_FOUND');
select test.login('late_verifier');
select mark_meta_verification_completed((select id from au where name = 'site'));
reset role;
select test.check((select client_status = 'COMPLETED' from customer_onboarding where customer_id = (select id from au where name = 'site'))
                   and (select count(*) = 2 from automation_jobs where customer_id = (select id from au where name = 'site') and stage = 'COMPLETED'),
  'Meta completed: Status Completed email + WhatsApp queued');
set role authenticated;
select test.login('late_verifier');
select mark_meta_verification_completed((select id from au where name = 'site'));
reset role;
select test.check((select count(*) = 2 from automation_jobs where customer_id = (select id from au where name = 'site') and stage = 'COMPLETED'),
  'recording it twice queues nothing twice');
select test.check((select count(*) = 0 from automation_jobs where secret is not null), 'still no password or secret on any job');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select mark_meta_verification_completed((select id from au where name = 'early'))$$, 'the result cannot be recorded before the application is submitted',
  'NOT_FOUND|can be completed only after');
reset role;
-- Moving the review back after completion changes nothing
update customer_onboarding set returned_at = now() where customer_id = (select id from au where name = 'site');
update customer_onboarding set returned_at = null where customer_id = (select id from au where name = 'site');
select test.check((select client_status = 'COMPLETED' from customer_onboarding where customer_id = (select id from au where name = 'site'))
                   and (select count(*) = 8 from automation_jobs where customer_id = (select id from au where name = 'site')),
  'the stage never moves back and no stage is messaged twice');

-- Who can see the messages
set role authenticated;
select test.login('late_verifier');
select test.check((select count(*) = 8 from automation_jobs where customer_id = (select id from au where name = 'site')), 'the verifier sees the customer''s messages');
select test.must_fail($$select secret from automation_jobs limit 1$$, 'nobody signed in can read the job secrets column', 'permission denied');
select test.must_fail($$update automation_jobs set status = 'SENT'$$, 'nobody signed in can change a job', 'permission denied');
select test.must_fail($$insert into automation_jobs (customer_id, channel, stage, dedupe_key) values ((select id from au where name = 'site'), 'EMAIL', 'COMPLETED', 'x')$$,
  'nobody signed in can queue a job', 'permission denied');
select test.must_fail($$select automation_claim_jobs(array['EMAIL'])$$, 'staff cannot claim jobs', 'permission denied');
select test.must_fail($$select automation_finish_job(gen_random_uuid(), 'SENT')$$, 'staff cannot finish jobs', 'permission denied');
select test.login('tm_a');
select test.check((select count(*) = 8 from automation_jobs where customer_id = (select id from au where name = 'site')), 'the salesperson can see what was sent to their customer');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from automation_jobs), 'another department sees none');
reset role;

-- Sending (the API server, service role)
set role service_role;
create temp table claimed (j jsonb);
insert into claimed select jsonb_array_elements(automation_claim_jobs(array['EMAIL'], 50));
select test.check((select count(*) filter (where j ->> 'stage' <> 'ACCOUNTS_PAYMENT') = 9 and bool_and(j ->> 'channel' = 'EMAIL') from claimed), 'the server claims the due email jobs only');
select test.check((select count(*) = 0 from automation_jobs where channel = 'EMAIL' and status <> 'SENDING' and customer_id in (select id from au)),
  'claimed jobs are marked SENDING');
select test.check((select jsonb_array_length(automation_claim_jobs(array['EMAIL'], 50)) = 0), 'a second run cannot claim the same jobs');
select test.check((select j -> 'customer' ->> 'email' = 'site.owner@example.com' and j -> 'customer' ->> 'whatsapp' = '+91 98199 00011'
                          and j -> 'customer' ->> 'departmentSlug' = 'wabastore' and j -> 'customer' ->> 'department' = 'Wabastore'
                          and j -> 'customer' ->> 'website' = 'https://www.site-traders.example' and j -> 'customer' ->> 'loginEmail' = 'site.owner@example.com'
                          and j ->> 'secret' is null
                     from claimed where j ->> 'stage' = 'COMPLETED'),
  'a claimed job carries the customer''s current details and login e-mail, and no password');
select test.check((select j -> 'customer' ->> 'whatsapp' = '9819900022' from claimed where j ->> 'stage' = 'WEBSITE_PENDING'),
  'without a WhatsApp number the phone number is used');

select automation_finish_job((select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'COMPLETED'), 'SENT', 'HTTP 200', 200, 'site.owner@example.com', 'msg-1');
select test.check((select status = 'SENT' and sent_at is not null and secret is null and provider_ref = 'msg-1' and recipient = 'site.owner@example.com'
                     from automation_jobs where id = (select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'COMPLETED')),
  'a sent email is recorded');
select test.must_fail(format($$select automation_finish_job(%L, 'SENT')$$, (select j ->> 'id' from claimed where j ->> 'stage' = 'COMPLETED')),
  'a job is finished once', 'not being sent');

-- Retries: 1, 5, 15, 60 minutes, then FAILED (and the TC is told)
select automation_finish_job((select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'UNDER_REVIEW' and j -> 'customer' ->> 'name' = 'Site Owner'), 'RETRY', 'HTTP 503', 503);
select test.check((select status = 'QUEUED' and attempts = 1 and next_attempt_at between now() + interval '50 seconds' and now() + interval '70 seconds'
                     from automation_jobs where id = (select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'UNDER_REVIEW' and j -> 'customer' ->> 'name' = 'Site Owner')),
  'a failed send is retried after 1 minute');
select test.check((select jsonb_array_length(automation_claim_jobs(array['EMAIL'], 50)) = 0), 'not before its retry time');
reset role;
update automation_jobs set next_attempt_at = now() - interval '1 second', attempts = 4
 where id = (select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'UNDER_REVIEW' and j -> 'customer' ->> 'name' = 'Site Owner');
set role service_role;
select test.check((select jsonb_array_length(automation_claim_jobs(array['EMAIL'], 50)) = 1), 'due again: claimed for its 5th attempt');
select automation_finish_job((select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'UNDER_REVIEW' and j -> 'customer' ->> 'name' = 'Site Owner'), 'RETRY', 'HTTP 500', 500);
reset role;
select test.check((select status = 'FAILED' and attempts = 5 from automation_jobs where id = (select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'UNDER_REVIEW' and j -> 'customer' ->> 'name' = 'Site Owner')),
  'after 5 attempts the job is FAILED');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('late_verifier') and type = 'AUTOMATION_FAILED'),
  'the Technical Consultant is notified of a message that could not be sent');
select test.check((select count(*) = 1 from audit_logs where action = 'AUTOMATION_FAILED'), 'the failure is audited');

-- A server that died mid-send: the job is taken again when its lease expires
update automation_jobs set locked_until = now() - interval '1 second'
 where id = (select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'WEBSITE_PENDING');
set role service_role;
select test.check((select jsonb_array_length(automation_claim_jobs(array['EMAIL'], 50)) = 1), 'a job stuck in SENDING is claimed again after its lease');
select automation_finish_job((select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'WEBSITE_PENDING'), 'SKIPPED', 'Invalid client email');
reset role;
select test.check((select status = 'SKIPPED' and detail = 'Invalid client email' and attempts = 2 from automation_jobs
                    where id = (select (j ->> 'id')::uuid from claimed where j ->> 'stage' = 'WEBSITE_PENDING')),
  'a skipped message keeps its reason');
select test.check((select count(*) >= 3 from customer_activities where type like 'AUTOMATION_EMAIL_%' and customer_id in (select id from au)),
  'each outcome is in the customer''s activity log');
select test.check((select count(*) >= 3 from audit_logs where action = 'CLIENT_STATUS_CHANGED'), 'stage changes are audited');

-- Existing customers at go-live: their stage is recorded silently
update customer_onboarding set client_status = null where customer_id = (select id from au where name = 'early');
delete from automation_jobs where customer_id = (select id from au where name = 'early');
select test.check((select private.advance_client_status((select id from au where name = 'early'), true) = 'UNDER_REVIEW')
                   and (select count(*) = 0 from automation_jobs where customer_id = (select id from au where name = 'early')),
  'recording the current stage of an existing customer sends nothing');

-- "Send messages for this step" (the TC queues the current step again)
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select consultant_resend_client_messages((select id from au where name = 'other'))$$, 'not for customers without the WhatsApp API service', 'not set up');
select test.login('late_verifier');
select test.must_fail($$select consultant_resend_client_messages((select id from au where name = 'nosite'))$$, 'not while the step''s messages are still waiting', 'already waiting|wait a minute');
select test.login('tm_a');
select test.must_fail($$select consultant_resend_client_messages((select id from au where name = 'site'))$$, 'sales cannot use it', 'NOT_FOUND');
reset role;
update automation_jobs set status = 'SENT', sent_at = now(), created_at = now() - interval '5 minutes', secret = null
 where customer_id = (select id from au where name = 'nosite') and status in ('QUEUED', 'SENDING');
update automation_jobs set created_at = now() - interval '5 minutes' where customer_id = (select id from au where name = 'nosite');
set role authenticated;
select test.login('late_verifier');
select test.check((select (consultant_resend_client_messages((select id from au where name = 'nosite')) ->> 'queued')::int = 2), 'the TC queues the current step again (email + WhatsApp)');
reset role;
select test.check((select count(*) = 2 and bool_and(stage = 'META_VERIFICATION' and status = 'QUEUED' and dedupe_key like '%|RESEND|%')
                     from automation_jobs where customer_id = (select id from au where name = 'nosite') and context ? 'resend'),
  'the new jobs are for the step the customer is at, with their own keys');
select test.check((select client_status = 'META_VERIFICATION' from customer_onboarding where customer_id = (select id from au where name = 'nosite')), 'the step does not move');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select consultant_resend_client_messages((select id from au where name = 'nosite'))$$, 'and not twice in a row', 'already waiting');
reset role;

\echo '=== ALL AUTOMATION TESTS PASSED ==='
