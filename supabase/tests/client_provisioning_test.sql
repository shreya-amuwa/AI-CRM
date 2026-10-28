-- =============================================================================
-- Client login provisioning by Accounts (migration 20261204000300): the extra rules the earlier suites do not cover - orphan sign-ins,
-- e-mail checks, who may read the queue, failed messages, and that re-running the migration touches nothing.
-- Runs late (same database). Users: acc_m (Accounts), tm_a (Sales), late_consultant (Technical Consultant), late_verifier (Meta Verifier).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 72. Accounts-owned client logins'
reset role;
create temp table cp (name text primary key, id uuid);
grant all on cp to authenticated, service_role;

-- what exists before the migration is run again
create temp table cp_before as select customer_id, auth_user_id, email, created_at from customer_client_accounts;
create temp table cp_prov_before as select customer_id, status, email, attempts from customer_client_provisioning;
\i supabase/migrations/20261204000300_accounts_client_provisioning.sql
select test.check((select count(*) = (select count(*) from cp_before) and bool_and(a.auth_user_id = b.auth_user_id and a.email = b.email and a.created_at = b.created_at)
                     from customer_client_accounts a join cp_before b using (customer_id)),
  'running the migration again leaves every existing client login exactly as it was (same user, e-mail and date)');
select test.check((select count(*) = (select count(*) from cp_prov_before) and bool_and(p.status = b.status and p.email is not distinct from b.email and p.attempts = b.attempts)
                     from customer_client_provisioning p join cp_prov_before b using (customer_id)),
  'and every provisioning record');
select test.check((select count(*) = 0 from automation_jobs where secret is not null), 'no job keeps an encrypted password');
select test.check((select count(*) = 0 from automation_jobs where stage = 'ACCOUNT_CREATED' and created_at < (select min(created_at) from customer_client_accounts) - interval '1 day'),
  'no account message was invented for logins that existed before');

-- customers with a verified payment
set role authenticated;
select test.login('tm_a');
insert into cp select 'p1', create_lead('{"name":"Prov One","company":"Prov One Co","email":"prov.one@example.com","phone":"9819920001","whatsapp":"9819920001","leadSource":"Walk-in"}', array['DS_META_ADS']);
insert into cp select 'p2', create_lead('{"name":"Prov Two","company":"Prov Two Co","email":"prov.two@example.com","phone":"9819920002","leadSource":"Walk-in"}', array['DS_META_ADS']);
insert into cp select 'p3', create_lead('{"name":"Prov Three","company":"Prov Three Co","email":"acc.m@amuwa.com","phone":"9819920003","leadSource":"Walk-in"}', array['DS_META_ADS']);
insert into cp select 'p4', create_lead('{"name":"Prov Four","company":"Prov Four Co","email":"prov.four@example.com","phone":"9819920004","leadSource":"Walk-in"}', array['DS_META_ADS']);
reset role;
update customers set deal_amount = 4000, amount_received = 4000, amount_verified = 2000 where id in (select id from cp where name in ('p1', 'p2', 'p3'));
update customers set deal_amount = 4000, amount_received = 0, amount_verified = 0 where id = (select id from cp where name = 'p4');
update customer_onboarding set accounts_confirmed_at = now() where customer_id in (select id from cp where name in ('p1', 'p2', 'p3'));
insert into customer_onboarding (customer_id) select id from cp where name in ('p1', 'p2', 'p3', 'p4') on conflict do nothing;
update customer_onboarding set accounts_confirmed_at = now() where customer_id in (select id from cp where name in ('p1', 'p2', 'p3'));

\echo '   the e-mail comes from the record and is checked'
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_client_login_begin((select id from cp where name = 'p4'))$$, 'no login before money is verified', 'NOT_FOUND|Verify a payment first');
select test.must_fail($$select accounts_client_login_begin((select id from cp where name = 'p3'))$$, 'a staff e-mail on the record cannot become a client login', 'already has a login');
select test.check((accounts_provisioning_queue('ALL', 'Prov Three', 1, 20) -> 'items' -> 0 ->> 'emailProblem') = 'IN_USE'
               and (accounts_provisioning_queue('ALL', 'Prov Three', 1, 20) -> 'items' -> 0 -> 'can' ->> 'create') = 'false', 'the queue explains why');
select test.check(jsonb_array_length(accounts_provisioning_queue('ALL', 'Prov Four', 1, 20) -> 'items') = 0, 'a customer without a verified payment is not in the queue');
select test.check((accounts_provisioning_queue('NOT_STARTED', null, 1, 50) -> 'counts' ->> 'NOT_STARTED')::int >= 3, 'the tabs are counted');
select test.must_fail($$select accounts_provisioning_queue('SOMETHING', null, 1, 20)$$, 'an unknown tab is refused', 'Unknown status');

\echo '   a sign-in left by a crashed attempt is finished, not duplicated'
select accounts_client_login_begin((select id from cp where name = 'p1'));
reset role;
-- the API created the user and then died before recording it
select test.create_auth_user('p1_orphan', 'prov.one@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from cp where name = 'p1')));
select test.check(private.client_email_problem((select id from cp where name = 'p1'), 'prov.one@example.com') is null, 'the half-made sign-in does not count as "e-mail in use" for its own customer');
select test.check(private.client_email_problem((select id from cp where name = 'p2'), 'prov.one@example.com') = 'IN_USE', 'but it does for any other customer');
set role service_role;
select test.check(client_auth_user_for((select id from cp where name = 'p1'), 'Prov.One@example.com') = test.id('p1_orphan'), 'the API finds it for the same customer (any letter case)');
select test.check(client_auth_user_for((select id from cp where name = 'p2'), 'prov.one@example.com') is null, 'and not for another customer');
reset role;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select client_auth_user_for((select id from cp where name = 'p1'), 'prov.one@example.com')$$, 'staff cannot look sign-ins up', 'permission denied');
select record_client_account((select id from cp where name = 'p1'), test.id('p1_orphan'), 'prov.one@example.com');
reset role;
select test.check((select count(*) = 1 from customer_client_accounts where customer_id = (select id from cp where name = 'p1') and auth_user_id = test.id('p1_orphan')), 'the retry finished the same sign-in');
select test.check((select count(*) = 1 from auth.users where lower(email) = 'prov.one@example.com'), 'and there is only one');

\echo '   one sign-in cannot belong to two customers'
set role authenticated;
select test.login('acc_m');
select accounts_client_login_begin((select id from cp where name = 'p2'));
select test.must_fail($$select record_client_account((select id from cp where name = 'p2'), test.id('p1_orphan'), 'prov.two@example.com')$$, 'a login made for another customer is refused', 'not created for this customer');
reset role;
select test.check((select count(*) = 0 from customer_client_accounts where customer_id = (select id from cp where name = 'p2')), 'and nothing was recorded');

\echo '   who may read and act'
set role authenticated;
select test.login('late_consultant');
select test.must_fail($$select accounts_provisioning_queue('ALL', null, 1, 20)$$, 'the Technical Consultant cannot read the queue', 'Only the Accounts department');
select test.must_fail($$select accounts_set_customer_email((select id from cp where name = 'p2'), 'x@example.com', 'because')$$, 'nor correct an e-mail', 'Only the Accounts department');
select test.must_fail($$select accounts_resend_account_email((select id from cp where name = 'p1'))$$, 'nor resend the account message', 'Only the Accounts department');
select test.login('late_verifier');
select test.must_fail($$select accounts_client_login_begin((select id from cp where name = 'p2'))$$, 'the Meta Verifier cannot create a login', 'Only the Accounts department');
select test.login('tm_a');
select test.must_fail($$select accounts_provisioning_queue('ALL', null, 1, 20)$$, 'Sales cannot read the queue', 'Only the Accounts department');
select test.login('acc_m');
select test.must_fail($$select accounts_set_customer_email((select id from cp where name = 'p1'), 'new@example.com', 'because')$$, 'the e-mail on a customer with a login is not changed here', 'already has a login');

\echo '   a failed "account created" message is Accounts'' to fix'
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
create temp table cp_claimed (j jsonb);
grant all on cp_claimed to service_role;
insert into cp_claimed select jsonb_array_elements(automation_claim_jobs(array['EMAIL'], 200)) ;
reset role;
select test.check((select count(*) >= 1 from cp_claimed where j ->> 'stage' = 'ACCOUNT_CREATED' and j -> 'customer' ->> 'loginEmail' = 'prov.one@example.com'), 'the sender gets the login e-mail with the job');
select test.check((select bool_and(j ->> 'secret' is null) from cp_claimed), 'and no secret');
update automation_jobs set attempts = 5 where status = 'SENDING' and stage = 'ACCOUNT_CREATED' and customer_id = (select id from cp where name = 'p1');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
select automation_finish_job((select (j ->> 'id')::uuid from cp_claimed where j ->> 'stage' = 'ACCOUNT_CREATED' and j -> 'customer' ->> 'id' = (select id::text from cp where name = 'p1')), 'FAILED', 'HTTP 550 mailbox unavailable');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'AUTOMATION_FAILED' and entity_id = (select id from cp where name = 'p1') and recipient_id = test.id('acc_m')), 'Accounts is told that the message could not be sent');
select test.check((select count(*) = 0 from notifications where type = 'AUTOMATION_FAILED' and entity_id = (select id from cp where name = 'p1') and recipient_id in (test.id('late_consultant'), test.id('late_verifier'))), 'and the verification team is not');
set role authenticated;
select test.login('acc_m');
select accounts_resend_account_email((select id from cp where name = 'p1'));
reset role;
select test.check((select count(*) = 1 and bool_and(status = 'QUEUED') from automation_jobs where customer_id = (select id from cp where name = 'p1') and stage = 'ACCOUNT_CREATED' and channel = 'EMAIL'), 'a failed message is retried as the same job');

\echo '   a customer who is lost gets no login'
update customers set lifecycle_stage = 'LOST' where id = (select id from cp where name = 'p2');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_client_login_begin((select id from cp where name = 'p2'))$$, 'a lost customer cannot be given a login', 'Verify a payment first|NOT_FOUND');
reset role;
