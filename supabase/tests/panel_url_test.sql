-- =============================================================================
-- Client Panel URL (migration 20261209000500): validation in the database, who may set it, auditing, the deliberate "send the link" rule
-- (once per link, again after a change, again on purpose), and that no secret is ever on it. Runs after the credentials suite on the same
-- database; reuses "Hand One Traders" (WhatsApp API) and the users late_verifier (Meta Verifier), late_consultant (Technical Consultant of
-- another route), tm_a (Sales), acc_m (Accounts), dh_wab (Department Head).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 78. Client Panel URL'
reset role;
\i supabase/migrations/20261209000500_client_panel_url.sql

create temp table pu (name text primary key, id uuid);
grant all on pu to anon, authenticated, service_role;
insert into pu select 'wa', id from customers where company = 'Hand One Traders';

\echo '   the rules of a panel URL'
select test.check(private.clean_panel_url('  HTTPS://Panel.Example.com/Login  ') = 'https://panel.example.com/Login', 'the host is lower-cased, the path kept, spaces trimmed');
select test.check(private.clean_panel_url('https://chat.wabastore.shop/login') = 'https://chat.wabastore.shop/login', 'a plain panel address is kept as it is');
select test.check(private.clean_panel_url('https://panel.example.com:8443/app?lang=en') = 'https://panel.example.com:8443/app?lang=en', 'a port and a harmless query are fine');
select test.check(private.clean_panel_url('   ') is null and private.clean_panel_url(null) is null, 'empty clears');
select test.must_fail($$select private.clean_panel_url('http://panel.example.com/login')$$, 'http is refused', 'must start with https');
select test.must_fail($$select private.clean_panel_url('panel.example.com/login')$$, 'a bare address is refused', 'must start with https');
select test.must_fail($$select private.clean_panel_url('javascript:alert(1)')$$, 'a script address is refused', 'must start with https');
select test.must_fail($$select private.clean_panel_url('https://user:pass@panel.example.com/')$$, 'a user name and password in the address are refused', 'user name or password');
select test.must_fail($$select private.clean_panel_url('https://panel.example.com/login?token=abc123')$$, 'a token in the link is refused', 'password, key or token');
select test.must_fail($$select private.clean_panel_url('https://panel.example.com/login?password=abc')$$, 'a password in the link is refused', 'password, key or token');
select test.must_fail($$select private.clean_panel_url('https://panel.example.com/a b')$$, 'spaces are refused', 'spaces');
select test.must_fail($$select private.clean_panel_url('https://localhost/login')$$, 'localhost is refused', 'public web address');
select test.must_fail($$select private.clean_panel_url('https://192.168.1.10/login')$$, 'an IP address is refused', 'public web address');
select test.must_fail($$select private.clean_panel_url('https://panel.internal/login')$$, 'an internal name is refused', 'public web address');
select test.must_fail($$select private.clean_panel_url('https://' || repeat('a', 600) || '.com')$$, 'too long is refused', 'too long');
select test.must_fail($$update customer_services set panel_url = 'http://insecure.example.com' where customer_id = (select id from pu where name = 'wa') and service_code = 'WHATSAPP_API'$$, 'the table refuses it too', 'customer_services_panel_url_check');

\echo '   who may save it'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'https://panel.example.com/login')$$, 'Sales cannot', 'NOT_FOUND');
select test.login('acc_m');
select test.must_fail($$select panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'https://panel.example.com/login')$$, 'Accounts cannot', 'NOT_FOUND');
select test.login('late_consultant');
select test.must_fail($$select panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'https://panel.example.com/login')$$, 'the Technical Consultant of another route cannot', 'NOT_FOUND');
select test.login('late_verifier');
select test.must_fail($$select panel_url_set((select id from pu where name = 'wa'), 'AI_CALLING', 'https://panel.example.com/login')$$, 'only a WhatsApp service of this customer', 'not a WhatsApp service');
select test.must_fail($$select panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'http://panel.example.com/login')$$, 'the function refuses http', 'must start with https');
reset role;
select test.check((select count(*) = 0 from customer_services where panel_url is not null), 'every refusal left nothing saved');

\echo '   saving, changing and removing it: audited, sends nothing'
create temp table pu_before as select (select count(*) from automation_jobs where stage = 'PANEL_LINK') as links, (select count(*) from automation_jobs) as jobs;
grant all on pu_before to authenticated, service_role;
set role authenticated;
select test.login('late_verifier');
select test.check((panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'https://Panel.Example.com/login') ->> 'changed')::boolean, 'the Meta Verifier saves it');
select test.check(not (panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'https://panel.example.com/login') ->> 'changed')::boolean, 'the same address again changes nothing');
select test.check((panel_details_list((select id from pu where name = 'wa')) -> 'services' -> 0 ->> 'panelUrl') = 'https://panel.example.com/login'
               and (panel_details_list((select id from pu where name = 'wa')) -> 'services' -> 0 -> 'link') = 'null'::jsonb, 'the section shows the URL and no link sent yet');
reset role;
select test.check((select count(*) from automation_jobs) = (select jobs from pu_before), 'saving a URL sends and queues nothing');
select test.check((select count(*) = 1 from audit_logs where action = 'SERVICE_PANEL_URL_SET' and entity_id = (select id from pu where name = 'wa') and actor_id = test.id('late_verifier')
                      and metadata ->> 'service' = 'WHATSAPP_API' and metadata ->> 'host' = 'panel.example.com' and metadata::text not like '%/login%'), 'audited once: who, which service, which host - not the full link');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from pu where name = 'wa') and type = 'PANEL_URL_SAVED'), 'one line in the customer history');

\echo '   the customer sees the right URL on the Completed message'
insert into automation_jobs (customer_id, channel, stage, dedupe_key, context)
select id, 'EMAIL', 'COMPLETED', 'PU-TEST-CLAIM', '{}'::jsonb from pu where name = 'wa';
create temp table pu_claim (j jsonb);
grant all on pu_claim to service_role;
set role service_role;
insert into pu_claim select automation_claim_jobs(array['EMAIL'], 50);
reset role;
select test.check((select x -> 'customer' ->> 'panelUrl' from pu_claim, jsonb_array_elements(j) x where x ->> 'id' = (select id::text from automation_jobs where dedupe_key = 'PU-TEST-CLAIM')) = 'https://panel.example.com/login', 'the dispatcher receives the customer''s own panel URL');
-- the claim leased every due job; remove the probe and put the others back so the rest of this suite sees the usual state
delete from automation_jobs where dedupe_key = 'PU-TEST-CLAIM';
update automation_jobs set status = 'QUEUED', locked_until = null, attempts = greatest(attempts - 1, 0) where status = 'SENDING';

\echo '   sending the link: deliberate, once per link'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', gen_random_uuid())$$, 'Sales cannot send it', 'NOT_FOUND');
select test.login('late_verifier');
select test.must_fail($$select panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', null)$$, 'a request id is required', 'request id');
select test.must_fail($$select panel_link_send((select id from pu where name = 'wa'), 'AI_CALLING', gen_random_uuid())$$, 'only a WhatsApp service', 'not a WhatsApp service');
reset role;
update customers set email = null where id = (select id from pu where name = 'wa');
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', gen_random_uuid())$$, 'no valid e-mail address, nothing is sent', 'no valid e-mail');
reset role;
update customers set email = 'hand.one@example.com' where id = (select id from pu where name = 'wa');
select test.check((select count(*) = (select links from pu_before) from automation_jobs where stage = 'PANEL_LINK'), 'no refusal queued anything');

create temp table pu_req as select gen_random_uuid() as id, gen_random_uuid() as id2, gen_random_uuid() as id3, gen_random_uuid() as id4;
grant all on pu_req to authenticated, service_role;
set role authenticated;
select test.login('late_verifier');
select test.check((panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id from pu_req)) ->> 'queued')::boolean, 'the Meta Verifier sends the link');
select test.check(not (panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id from pu_req)) ->> 'queued')::boolean, 'the same request again is a no-op (a double click or a retry)');
select test.check((panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id2 from pu_req)) ->> 'reason') = 'IN_PROGRESS', 'a new click while it waits to be sent is a no-op too');
reset role;
select test.check((select count(*) = 1 from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa') and channel = 'EMAIL' and status = 'QUEUED'
                      and secret is null and context ->> 'panelUrl' = 'https://panel.example.com/login' and context ->> 'service' = 'WHATSAPP_API'), 'exactly one e-mail job, with the link and no secret');
select test.check((select count(*) = 0 from automation_jobs where stage = 'PANEL_LINK' and channel = 'WHATSAPP'), 'never a WhatsApp message');
select test.check((select count(*) = 1 from audit_logs where action = 'SERVICE_PANEL_LINK_SENT' and entity_id = (select id from pu where name = 'wa') and actor_id = test.id('late_verifier') and metadata::text not like '%panel.example.com%'), 'the send is audited (who and which service)');
update automation_jobs set status = 'SENDING', locked_until = now() + interval '5 minutes' where id = (select id from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa'));
set role service_role;
select automation_finish_job((select id from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa')), 'SENT', 'ok', 202, 'hand.one@example.com');
reset role;
set role authenticated;
select test.login('late_verifier');
select test.check((panel_details_list((select id from pu where name = 'wa')) -> 'services' -> 0 -> 'link' ->> 'current')::boolean
               and (panel_details_list((select id from pu where name = 'wa')) -> 'services' -> 0 -> 'link' -> 'email' ->> 'status') = 'SENT', 'the section shows it was sent, and that the saved URL is the one sent');
select test.check((panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id2 from pu_req)) ->> 'reason') = 'ALREADY_SENT', 'a sent link is not sent again by accident');
select test.check((panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id3 from pu_req), true) ->> 'queued')::boolean, 'it can be sent again on purpose');
select test.check(not (panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id3 from pu_req), true) ->> 'queued')::boolean, 'a repeated "send again" request is still one e-mail');
reset role;
select test.check((select count(*) = 2 from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa')), 'two e-mails in all: the first and the deliberate resend');
update automation_jobs set status = 'SENDING', locked_until = now() + interval '5 minutes' where id = (select id from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa') and status <> 'SENT');
set role service_role;
select automation_finish_job((select id from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa') and status <> 'SENT'), 'FAILED', 'provider said no', 500, 'hand.one@example.com');
reset role;

\echo '   changing the URL makes the new link sendable again; a failed e-mail can be retried'
set role authenticated;
select test.login('late_verifier');
select test.check((panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', 'https://panel2.example.com/login') ->> 'changed')::boolean, 'the URL is changed');
select test.check(not (panel_details_list((select id from pu where name = 'wa')) -> 'services' -> 0 -> 'link' ->> 'current')::boolean, 'the section says the saved URL is no longer the one that was sent');
select test.check((panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', (select id4 from pu_req)) ->> 'queued')::boolean, 'the new address is sent without "send again"');
reset role;
select test.check((select count(*) = 1 from automation_jobs where stage = 'PANEL_LINK' and customer_id = (select id from pu where name = 'wa') and context ->> 'panelUrl' = 'https://panel2.example.com/login'), 'one e-mail for the new link');
update automation_jobs set status = 'SENDING', locked_until = now() + interval '5 minutes' where id = (select id from automation_jobs where stage = 'PANEL_LINK' and context ->> 'panelUrl' = 'https://panel2.example.com/login');
set role service_role;
select automation_finish_job((select id from automation_jobs where stage = 'PANEL_LINK' and context ->> 'panelUrl' = 'https://panel2.example.com/login'), 'FAILED', 'provider said no', 500, 'hand.one@example.com');
reset role;
set role authenticated;
select test.login('late_verifier');
select test.check((panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', gen_random_uuid()) ->> 'queued')::boolean, 'a link whose e-mail failed can simply be sent again');
reset role;

\echo '   removing it'
set role authenticated;
select test.login('late_verifier');
select panel_url_set((select id from pu where name = 'wa'), 'WHATSAPP_API', '');
select test.check((panel_details_list((select id from pu where name = 'wa')) -> 'services' -> 0 -> 'panelUrl') = 'null'::jsonb, 'an empty value removes it');
select test.must_fail($$select panel_link_send((select id from pu where name = 'wa'), 'WHATSAPP_API', gen_random_uuid())$$, 'nothing to send once it is removed', 'Save the panel URL first');
reset role;
select test.check((select count(*) = 0 from audit_logs where metadata::text ~* '(passw|token)' and action like 'SERVICE_PANEL_%'), 'no audit row carries a secret');
