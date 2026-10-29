-- =============================================================================
-- Credentials (migration 20261208000300): the Client Dashboard login with a temporary password (Accounts) and the WhatsApp panel password
-- (Meta Verifier). Runs after the panel-details suite on the same database; reuses "Hand One Traders" (WhatsApp API, Meta Verifier) and
-- the users acc_m (Accounts), late_verifier (Meta Verifier), late_consultant (Technical Consultant), tm_a (Sales), dh_wab (Department Head).
-- The "encrypted" values below are plain markers: the database never decrypts anything, it only has to keep them off every ordinary table.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 77. Credentials: dashboard temporary password and WhatsApp panel password'
reset role;
\i supabase/migrations/20261208000300_client_credentials.sql

create temp table cr (name text primary key, id uuid);
grant all on cr to anon, authenticated, service_role;

-- customers with a verified payment
set role authenticated;
select test.login('tm_a');
insert into cr select 'c1', create_lead('{"name":"Cred One","company":"Cred One Co","email":"cred.one@example.com","phone":"9819930001","leadSource":"Walk-in"}', array['DS_META_ADS']);
insert into cr select 'c2', create_lead('{"name":"Cred Two","company":"Cred Two Co","email":"cred.two@example.com","phone":"9819930002","leadSource":"Walk-in"}', array['DS_META_ADS']);
reset role;
update customers set deal_amount = 4000, amount_received = 4000, amount_verified = 2000 where id in (select id from cr);
insert into customer_onboarding (customer_id) select id from cr on conflict do nothing;
update customer_onboarding set accounts_confirmed_at = now() where customer_id in (select id from cr);

\echo '   Accounts chooses how the client gets in'
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_client_login_begin_method((select id from cr where name = 'c1'), 'SMS')$$, 'an unknown method is refused', 'Choose how the client gets access');
select test.login('late_verifier');
select test.must_fail($$select accounts_client_login_begin_method((select id from cr where name = 'c1'), 'TEMPORARY')$$, 'the Meta Verifier cannot create a dashboard login', 'Only the Accounts department');
select test.login('tm_a');
select test.must_fail($$select accounts_client_login_begin_method((select id from cr where name = 'c1'), 'TEMPORARY')$$, 'Sales cannot', 'Only the Accounts department');
select test.login('acc_m');
select test.check(accounts_client_login_begin_method((select id from cr where name = 'c1'), 'TEMPORARY') ->> 'email' = 'cred.one@example.com', 'the e-mail is the one on the customer record');
select test.check((accounts_client_login_begin((select id from cr where name = 'c2')) ->> 'method') = 'LINK', 'the old one-argument call is still the set-password link');
reset role;
select test.check((select access_method = 'TEMPORARY' from customer_client_provisioning where customer_id = (select id from cr where name = 'c1')), 'the method is recorded on the attempt');

\echo '   the temporary password is required, and rides on the one e-mail only'
select test.create_auth_user('cr1_login', 'cred.one@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from cr where name = 'c1')));
select test.create_auth_user('cr2_login', 'cred.two@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from cr where name = 'c2')));
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select record_client_account_with_access((select id from cr where name = 'c1'), test.id('cr1_login'), 'cred.one@example.com', null)$$, 'no temporary password, no login', 'temporary password is missing');
select record_client_account_with_access((select id from cr where name = 'c1'), test.id('cr1_login'), 'cred.one@example.com', 'v1:TEMPSECRETMARKER:x:y');
select record_client_account((select id from cr where name = 'c2'), test.id('cr2_login'), 'cred.two@example.com');
reset role;
select test.check((select access_method = 'TEMPORARY' and must_change_password and password_changed_at is null from customer_client_accounts where customer_id = (select id from cr where name = 'c1')), 'the login must change its password at the first sign-in');
select test.check((select access_method = 'LINK' and not must_change_password from customer_client_accounts where customer_id = (select id from cr where name = 'c2')), 'a set-password-link login is as before');
select test.check((select count(*) = 1 from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'
                      and context ->> 'credential' = 'TEMPORARY' and secret = 'v1:TEMPSECRETMARKER:x:y'), 'one e-mail job carries the (encrypted) temporary password');
select test.check((select count(*) = 1 from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'WHATSAPP' and stage = 'ACCOUNT_CREATED' and secret is null and context = '{}'::jsonb), 'the WhatsApp message carries none');
select test.check((select count(*) = 0 from automation_jobs where customer_id = (select id from cr where name = 'c2') and secret is not null), 'a link login queues no secret at all');
select test.check((select count(*) = 0 from customer_activities where note like '%TEMPSECRETMARKER%')
               and (select count(*) = 0 from audit_logs where metadata::text like '%TEMPSECRETMARKER%')
               and (select count(*) = 0 from notifications where body like '%TEMPSECRETMARKER%')
               and (select count(*) = 0 from automation_jobs where detail like '%TEMPSECRETMARKER%' or context::text like '%TEMPSECRETMARKER%'), 'the secret is in no note, audit line, notification or job detail');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from cr where name = 'c1') and type = 'CLIENT_LOGIN_CREATED' and note like '%temporary password%'), 'the history says a temporary password was used');
select test.check((select count(*) = 1 from audit_logs where action = 'CLIENT_LOGIN_CREATED' and entity_id = (select id from cr where name = 'c1') and metadata ->> 'method' = 'TEMPORARY'), 'the audit names the method, not the password');
-- retry safe: the same login cannot be recorded twice, and no second e-mail is queued
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select record_client_account_with_access((select id from cr where name = 'c1'), test.id('cr1_login'), 'cred.one@example.com', 'v1:TEMPSECRETMARKER:x:y')$$, 'recording it again is refused', 'Start creating|already');
select test.must_fail($$select accounts_client_login_begin_method((select id from cr where name = 'c1'), 'TEMPORARY')$$, 'a second login for the same customer is refused', 'already has a login');
reset role;
select test.check((select count(*) = 2 from automation_jobs where customer_id = (select id from cr where name = 'c1') and stage = 'ACCOUNT_CREATED'), 'still one e-mail and one WhatsApp message');

\echo '   a client with a temporary password can do nothing but choose their own'
set role authenticated;
select test.login('cr1_login');
select test.check((client_me() ->> 'mustChangePassword')::boolean and client_me() ->> 'loginId' = test.id('cr1_login')::text and client_me() ->> 'businessName' = 'Cred One Co', 'they can see who they are and that the password must change');
select test.must_fail($$select client_services()$$, 'the dashboard data is closed', 'Choose your own password');
select test.must_fail($$select client_overview()$$, 'the overview too', 'Choose your own password');
select test.check((select private.my_client_customer() is null), 'and every policy that asks which customer this is sees none');
select test.login('cr2_login');
select test.check(not (client_me() ->> 'mustChangePassword')::boolean, 'a client who got a link is not held back');
select client_services();
select test.login('tm_a');
select test.must_fail($$select client_password_changed(test.id('cr1_login'))$$, 'staff cannot mark a password as changed', 'permission denied');
select test.login('cr1_login');
select test.must_fail($$select client_password_changed(test.id('cr1_login'))$$, 'nor can the client themselves (only the API, after it set the password)', 'permission denied');
reset role;
set role service_role;
select client_password_changed(test.id('cr1_login'));
reset role;
set role authenticated;
select test.login('cr1_login');
select test.check(not (client_me() ->> 'mustChangePassword')::boolean, 'once the API has set their own password, they are in');
select client_services();
reset role;
select test.check((select not must_change_password and password_changed_at is not null from customer_client_accounts where customer_id = (select id from cr where name = 'c1')), 'when it happened is recorded');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from cr where name = 'c1') and type = 'CLIENT_PASSWORD_CHANGED' and note not like '%TEMP%'), 'in the history, without any password');

\echo '   Accounts can send the e-mail again, and a chosen password is never replaced'
update automation_jobs set status = 'FAILED', detail = 'HTTP 550', secret = null where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED';
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_resend_account_email_with((select id from cr where name = 'c1'), 'v1:NEWTEMP:x:y')$$, 'a client who chose their own password gets no new temporary one', 'chosen their own password');
select accounts_resend_account_email((select id from cr where name = 'c1'));
reset role;
select test.check((select count(*) = 1 and bool_and(status = 'QUEUED' and secret is null and context = '{}'::jsonb) from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'), 'a failed e-mail is retried as the same job, as the set-password link');
-- a client who has not chosen their own yet: a new temporary one replaces the old
update customer_client_accounts set must_change_password = true, password_changed_at = null where customer_id = (select id from cr where name = 'c1');
update automation_jobs set status = 'FAILED', detail = 'HTTP 550' where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED';
set role authenticated;
select test.login('acc_m');
select test.check((accounts_client_account_state((select id from cr where name = 'c1')) ->> 'mustChangePassword')::boolean
               and accounts_client_account_state((select id from cr where name = 'c1')) ->> 'accessMethod' = 'TEMPORARY', 'Accounts can see that the temporary password is still in force');
select accounts_resend_account_email_with((select id from cr where name = 'c1'), 'v1:NEWTEMP:x:y');
reset role;
select test.check((select count(*) = 1 and bool_and(status = 'QUEUED' and secret = 'v1:NEWTEMP:x:y' and context ->> 'credential' = 'TEMPORARY') from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'), 'the same job now carries the new temporary password');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_resend_account_email_with((select id from cr where name = 'c1'), 'v1:OTHER:x:y')$$, 'while it is waiting, a second click does nothing', 'already on its way');
select test.login('late_verifier');
select test.must_fail($$select accounts_resend_account_email((select id from cr where name = 'c1'))$$, 'the Meta Verifier cannot resend a dashboard e-mail', 'Only the Accounts department');
select test.must_fail($$select accounts_client_account_state((select id from cr where name = 'c1'))$$, 'nor read the login state', 'Only the Accounts department');
reset role;

\echo '   the sender erases the secret when it is done, whatever the outcome'
-- as if the sender had claimed it
update automation_jobs set status = 'SENDING', attempts = greatest(attempts, 1), locked_until = now() + interval '5 minutes' where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select automation_finish_job((select id from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'), 'RETRY', 'HTTP 503');
reset role;
select test.check((select status = 'QUEUED' and secret = 'v1:NEWTEMP:x:y' from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'), 'a provider hiccup keeps the credential for the retry');
update automation_jobs set status = 'SENDING', attempts = greatest(attempts, 1), locked_until = now() + interval '5 minutes' where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED';
set role service_role;
select automation_finish_job((select id from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'), 'SENT', 'ok');
reset role;
select test.check((select secret is null from automation_jobs where customer_id = (select id from cr where name = 'c1') and channel = 'EMAIL' and stage = 'ACCOUNT_CREATED'), 'the secret is gone once the e-mail is sent');

\echo '   the Accounts queue says how each login was made'
set role authenticated;
select test.login('acc_m');
select test.check((accounts_provisioning_queue('CREATED', 'Cred One', 1, 20) -> 'items' -> 0 ->> 'accessMethod') = 'TEMPORARY'
               and (accounts_provisioning_queue('CREATED', 'Cred One', 1, 20) -> 'items' -> 0 ->> 'mustChangePassword') = 'true'
               and (accounts_provisioning_queue('CREATED', 'Cred One', 1, 20) -> 'items' -> 0 ->> 'loginEmail') = 'cred.one@example.com'
               and (accounts_provisioning_queue('CREATED', 'Cred One', 1, 20)::text not like '%TEMPSECRETMARKER%')
               and (accounts_provisioning_queue('CREATED', 'Cred One', 1, 20)::text not like '%NEWTEMP%'), 'name, e-mail, status and method are shown; no secret');
select test.check((accounts_provisioning_queue('CREATED', 'Cred Two', 1, 20) -> 'items' -> 0 ->> 'accessMethod') = 'LINK', 'a link login is shown as such');
reset role;

-- =============================================================================
-- WhatsApp panel (Meta Verifier)
-- =============================================================================
\echo '   panel password: only who manages the panel details, only for a saved account, only with an address'
insert into cr select 'wa', id from customers where company = 'Hand One Traders';
update customer_services set platform = 'Panel X', panel_account = 'hand.one@example.com' where customer_id = (select id from cr where name = 'wa') and service_code = 'WHATSAPP_API';
create temp table cr_before as select (select count(*) from customer_client_accounts) as accounts;
grant all on cr_before to authenticated, service_role;
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:PANELSECRETMARKER:x:y', gen_random_uuid())$$, 'Sales cannot', 'NOT_FOUND');
select test.login('late_consultant');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:PANELSECRETMARKER:x:y', gen_random_uuid())$$, 'nor the Technical Consultant of another route', 'NOT_FOUND');
select test.login('acc_m');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:PANELSECRETMARKER:x:y', gen_random_uuid())$$, 'nor Accounts', 'NOT_FOUND');
select test.login('late_verifier');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', '', gen_random_uuid())$$, 'an empty password is refused', 'password is missing');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:x', null)$$, 'a request id is required', 'password is missing');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'AI_CALLING', 'v1:x', gen_random_uuid())$$, 'only a WhatsApp service of this customer', 'not a WhatsApp service');
select panel_details_set((select id from cr where name = 'wa'), 'WHATSAPP_API', 'Panel X', null);
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:x', gen_random_uuid())$$, 'the account / user ID has to be saved first', 'Save the account');
select panel_details_set((select id from cr where name = 'wa'), 'WHATSAPP_API', 'Panel X', 'hand.one@example.com');
reset role;
update customers set email = null where id = (select id from cr where name = 'wa');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:x', gen_random_uuid())$$, 'a customer without an e-mail address gets nothing', 'no valid e-mail');
reset role;
update customers set email = 'hand.one@example.com' where id = (select id from cr where name = 'wa');
select test.check((select count(*) = 0 from automation_jobs where stage = 'PANEL_CREDENTIALS'), 'nothing was queued by any refusal');

\echo '   panel password: one e-mail to the customer, kept nowhere'
set role authenticated;
select test.login('late_verifier');
create temp table cr_req as select gen_random_uuid() as id;
grant all on cr_req to authenticated, service_role;
select test.check((panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:PANELSECRETMARKER:x:y', (select id from cr_req)) ->> 'queued')::boolean, 'the Meta Verifier sends it');
select test.check(not (panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:PANELSECRETMARKER:x:y', (select id from cr_req)) ->> 'queued')::boolean, 'the same request again is a no-op (a double click or a retry)');
reset role;
select test.check((select count(*) = 1 from automation_jobs where stage = 'PANEL_CREDENTIALS' and customer_id = (select id from cr where name = 'wa') and channel = 'EMAIL'
                      and secret = 'v1:PANELSECRETMARKER:x:y' and context ->> 'service' = 'WHATSAPP_API' and context ->> 'account' = 'hand.one@example.com' and context::text not like '%PANELSECRETMARKER%'), 'one e-mail job, with the secret on the job only');
select test.check((select count(*) = 0 from automation_jobs where stage = 'PANEL_CREDENTIALS' and channel = 'WHATSAPP'), 'never a WhatsApp message');
select test.check((select set_by = test.id('late_verifier') and set_at is not null from service_panel_credentials where customer_id = (select id from cr where name = 'wa') and service_code = 'WHATSAPP_API'), 'who set it and when is recorded');
select test.check((select count(*) = 0 from customer_activities where note like '%PANELSECRETMARKER%')
               and (select count(*) = 0 from audit_logs where metadata::text like '%PANELSECRETMARKER%')
               and (select count(*) = 1 from customer_activities where customer_id = (select id from cr where name = 'wa') and type = 'PANEL_CREDENTIALS_SET')
               and (select count(*) = 1 from audit_logs where action = 'SERVICE_PANEL_CREDENTIALS_SET' and entity_id = (select id from cr where name = 'wa') and actor_id = test.id('late_verifier') and metadata ->> 'service' = 'WHATSAPP_API'), 'the history and audit name who and which service - never the password');
select test.check((select count(*) from customer_client_accounts) = (select accounts from cr_before), 'it creates no dashboard login and touches none');
set role authenticated;
select test.login('late_verifier');
select test.check((panel_details_list((select id from cr where name = 'wa')) -> 'services' -> 0 -> 'credentials' ->> 'setBy') = (select full_name from profiles where id = test.id('late_verifier'))
               and (panel_details_list((select id from cr where name = 'wa')) -> 'services' -> 0 -> 'credentials' -> 'email' ->> 'status') = 'QUEUED'
               and (panel_details_list((select id from cr where name = 'wa')) ->> 'customerEmail') = 'hand.one@example.com'
               and panel_details_list((select id from cr where name = 'wa'))::text not like '%PANELSECRETMARKER%', 'the panel shows configured, who, and the e-mail state - no password');
reset role;

\echo '   panel password: the sender delivers it and erases it; a failure is shown, never called sent'
update automation_jobs set status = 'SENDING', attempts = greatest(attempts, 1), locked_until = now() + interval '5 minutes' where stage = 'PANEL_CREDENTIALS' and customer_id = (select id from cr where name = 'wa') and secret = 'v1:PANELSECRETMARKER:x:y';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select automation_finish_job((select id from automation_jobs where stage = 'PANEL_CREDENTIALS' and customer_id = (select id from cr where name = 'wa') and status = 'SENDING'), 'FAILED', 'HTTP 550 mailbox unavailable');
reset role;
select test.check((select secret is null and status = 'FAILED' from automation_jobs where stage = 'PANEL_CREDENTIALS' and customer_id = (select id from cr where name = 'wa')), 'the password is erased even when the e-mail failed');
set role authenticated;
select test.login('late_verifier');
select test.check((panel_details_list((select id from cr where name = 'wa')) -> 'services' -> 0 -> 'credentials' -> 'email' ->> 'status') = 'FAILED'
               and (panel_details_list((select id from cr where name = 'wa')) -> 'services' -> 0 -> 'credentials' -> 'email' ->> 'sentAt') is null, 'the screen shows it failed');
reset role;

\echo '   panel password: setting a new one, and unrelated edits'
set role authenticated;
select test.login('late_verifier');
select test.check((panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:SECONDMARKER:x:y', gen_random_uuid()) ->> 'queued')::boolean, 'a new password with a new request is a new e-mail');
select panel_details_set((select id from cr where name = 'wa'), 'WHATSAPP_API', 'Panel Y', 'hand.one@example.com');
reset role;
select test.check((select count(*) = 1 from service_panel_credentials where customer_id = (select id from cr where name = 'wa')), 'editing the panel details does not touch the credential record');
select test.check((select count(*) = 2 from automation_jobs where stage = 'PANEL_CREDENTIALS' and customer_id = (select id from cr where name = 'wa')) and (select count(*) = 1 from automation_jobs where stage = 'PANEL_CREDENTIALS' and secret is not null), 'two requests, two e-mails, one still waiting with its own secret');
select test.check((select last_job = (select id from automation_jobs where secret = 'v1:SECONDMARKER:x:y') from service_panel_credentials where customer_id = (select id from cr where name = 'wa')), 'the record follows the latest e-mail');

\echo '   panel credentials are not readable or writable by anyone directly'
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select * from service_panel_credentials$$, 'the table is closed', 'permission denied');
select test.must_fail($$insert into service_panel_credentials (customer_id, service_code) values ((select id from cr where name = 'wa'), 'WHATSAPP_API')$$, 'and cannot be written', 'permission denied');
select test.must_fail($$select secret from automation_jobs$$, 'a job''s secret cannot be read by staff', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select panel_credentials_send((select id from cr where name = 'wa'), 'WHATSAPP_API', 'v1:x', gen_random_uuid())$$, 'a visitor has nothing', 'permission denied for function panel_credentials_send');
reset role;

\echo '   running the migration again changes nothing'
create temp table cr_all as select (select count(*) from customer_client_accounts) a, (select count(*) from service_panel_credentials) p,
  (select count(*) from automation_jobs) j, (select count(*) from customer_client_accounts where must_change_password) m;
\i supabase/migrations/20261208000300_client_credentials.sql
select test.check((select a = (select count(*) from customer_client_accounts) and p = (select count(*) from service_panel_credentials)
                          and j = (select count(*) from automation_jobs) and m = (select count(*) from customer_client_accounts where must_change_password) from cr_all), 'the same logins, credential records, jobs and flags');
