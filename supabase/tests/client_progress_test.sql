-- =============================================================================
-- Client dashboard: progress of each purchased service (migration 20261204000400). Runs late (same database): reuses the customers of the
-- Meta Verifier and provisioning suites - "Meta One Traders" (WhatsApp API + Blue Tick, handed over), "Prov One Co" (a direct service, has
-- a client login) and "Prov Two Co" (no login).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 73. Client service progress'
reset role;
\i supabase/migrations/20261205000400_client_service_progress.sql
\i supabase/migrations/20261222000400_service_specific_journeys.sql

create temp table cg (name text primary key, id uuid);
grant all on cg to authenticated, service_role;
insert into cg select 'meta', id from customers where company = 'Meta One Traders';
insert into cg select 'direct', id from customers where company = 'Prov One Co';
insert into cg select 'nologin', id from customers where company = 'Prov Two Co';
select test.check((select count(*) = 3 from cg), 'the customers of the earlier suites are there');

-- the WhatsApp customer gets a client login from Accounts (verified payment on record)
update customers set amount_received = 1000, amount_verified = 1000 where id = (select id from cg where name = 'meta') and amount_verified = 0;
update customer_onboarding set accounts_confirmed_at = coalesce(accounts_confirmed_at, now()) where customer_id = (select id from cg where name = 'meta');
set role authenticated;
select test.login('acc_m');
select accounts_client_login_begin((select id from cg where name = 'meta'));
reset role;
select test.create_auth_user('cg_meta', 'meta.one@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from cg where name = 'meta')));
set role authenticated;
select test.login('acc_m');
select record_client_account((select id from cg where name = 'meta'), test.id('cg_meta'), 'meta.one@example.com');
reset role;

\echo '   the WhatsApp journey: order, documents, our verification, Meta, live'
set role authenticated;
select test.login('cg_meta');
select test.check(jsonb_array_length(client_service_progress()) = 1 and (client_service_progress() -> 0 ->> 'code') = 'WHATSAPP_API_BLUE_TICK', 'the client sees exactly their own service');
select test.check((select string_agg(s ->> 'key' || ':' || (s ->> 'state'), ',' order by ord) from jsonb_array_elements(client_service_progress() -> 0 -> 'steps') with ordinality as t(s, ord))
                   = 'ORDER:DONE,DOCUMENTS:DONE,VERIFICATION:DONE,META:CURRENT,LIVE:UPCOMING',
  'verified and handed over: Meta verification is the current step');
select test.check((client_service_progress() -> 0 ->> 'headline') = 'Meta verification' and (client_service_progress() -> 0 ->> 'status') = 'SETTING_UP'
               and (client_service_progress() -> 0 -> 'steps' -> 3 ->> 'hint') like '%2-3 weeks%', 'the headline and the hint say what is happening');
select test.check((client_service_progress() -> 0 -> 'steps' -> 1 ->> 'at') is not null and (client_service_progress() -> 0 -> 'steps' -> 3 ->> 'at') is null, 'a done step carries its date; the current one has none');
select test.check(client_service_progress()::text !~* 'Late Verifier|Meta Verifier|note|audit|amount|route|verification_route|dh_wab', 'nothing internal is in the answer: no staff, notes, audit, amounts or route names');
select test.check((select count(*) = 0 from client_notifications where customer_id = (select id from cg where name = 'meta') and type like 'PROGRESS_%'), 'milestones reached before the client had a login are not announced after the fact');

\echo '   Meta completes: the last steps follow, once'
select test.login('dh_wab');
select mark_meta_verification_completed((select id from cg where name = 'meta'));
select mark_meta_verification_completed((select id from cg where name = 'meta'));
select test.login('cg_meta');
select test.check((select bool_and(s ->> 'state' = 'DONE') from jsonb_array_elements(client_service_progress() -> 0 -> 'steps') s) and (client_service_progress() -> 0 ->> 'headline') = 'Live',
  'every step is done and the service is live');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cg where name = 'meta') and type = 'PROGRESS_META_DONE'), 'the client is told once, however often it is recorded');
select test.check((select bool_and(title !~* 'Meta Verifier|Late|Technical Consultant' and coalesce(body, '') !~* 'Meta Verifier|Late|Technical Consultant') from client_notifications where customer_id = (select id from cg where name = 'meta') and type like 'PROGRESS_%'),
  'and the wording has no staff roles or names');

\echo '   a direct service: order, documents, delivery team, live'
select test.login('p1_orphan');
select test.check((client_service_progress() -> 0 ->> 'current') = 'DOCUMENTS' and (client_service_progress() -> 0 -> 'steps' -> 1 ->> 'hint') like '%documents%', 'before the documents are verified that is the current step');
reset role;
update customer_onboarding set items_saved = items_total, items_verified = items_total, items_rejected = 0 where customer_id = (select id from cg where name = 'direct');
set role authenticated;
select test.login('p1_orphan');
select test.check((select string_agg(s ->> 'key' || ':' || (s ->> 'state'), ',' order by ord) from jsonb_array_elements(client_service_progress() -> 0 -> 'steps') with ordinality as t(s, ord))
                   like 'ORDER:DONE,DOCUMENTS:DONE,DELIVERY:CURRENT,LIVE:UPCOMING', 'a direct service waits for the delivery team');
reset role;
update customer_services set sent_to_delivery_at = now() where customer_id = (select id from cg where name = 'direct');
update customer_services set sent_to_delivery_at = now() where customer_id = (select id from cg where name = 'nologin');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cg where name = 'direct') and type = 'PROGRESS_DELIVERY'), 'the client is told when the order goes to the delivery team');
select test.check((select count(*) = 0 from client_notifications where customer_id = (select id from cg where name = 'nologin')), 'a customer without a login gets no notification');
update customer_services set sent_to_delivery_at = now() + interval '1 second' where customer_id = (select id from cg where name = 'direct');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cg where name = 'direct') and type = 'PROGRESS_DELIVERY'), 'and a repeated change tells them nothing twice');
set role authenticated;
select test.login('p1_orphan');
select test.check((client_service_progress() -> 0 -> 'steps' -> 2 ->> 'state') = 'DONE' and (client_service_progress() -> 0 ->> 'current') = 'LIVE', 'the delivery step is done, going live is next');
reset role;
update customer_services set activated_at = now(), service_status = 'LIVE' where customer_id = (select id from cg where name = 'direct');
set role authenticated;
select test.login('p1_orphan');
select test.check((client_service_progress() -> 0 ->> 'headline') = 'Live' and (select bool_and(s ->> 'state' = 'DONE') from jsonb_array_elements(client_service_progress() -> 0 -> 'steps') s), 'live: all steps done');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cg where name = 'direct') and type = 'PROGRESS_LIVE'), 'and it is announced once');


\echo '   invoices reach the right client, whatever the service (a WhatsApp customer included)'
reset role;
select count(*) as inv_before from member_invoices \gset
insert into member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, customer_id, kind, tax_total)
values (test.id('acc_m'), 'CP/WA/001', 'Meta One', 'Meta One Traders', 1180, 'Pending', '2026-10-01', '2099-01-01', (select id from cg where name = 'meta'), 'UPLOADED', 180),
       (test.id('acc_m'), 'CP/DIR/001', 'Prov One', 'Prov One Co', 500, 'Pending', '2026-10-01', '2099-01-01', (select id from cg where name = 'direct'), 'UPLOADED', 0);
create temp table cpinv as select invoice_number, id from member_invoices where invoice_number like 'CP/%';
grant all on cpinv to authenticated;
set role authenticated;
select test.login('cg_meta');
select test.check((select count(*) = 1 from jsonb_array_elements(client_invoices()) i where i ->> 'number' = 'CP/WA/001'), 'the WhatsApp customer''s client sees their invoice');
select test.check((select count(*) = 0 from jsonb_array_elements(client_invoices()) i where i ->> 'number' = 'CP/DIR/001'), 'and not another client''s');
select test.must_fail($$select * from client_invoice_file((select id from cpinv where invoice_number = 'CP/DIR/001'))$$, 'nor can they open its file', 'not found');
select test.login('p1_orphan');
select test.check((select count(*) = 1 from jsonb_array_elements(client_invoices()) i where i ->> 'number' = 'CP/DIR/001') and (select count(*) = 0 from jsonb_array_elements(client_invoices()) i where i ->> 'number' = 'CP/WA/001'), 'the other client sees only theirs');
reset role;
select test.check((select count(*) = :inv_before + 2 from member_invoices), 'nothing created an invoice to make one visible');

\echo '   who can read it'
select test.check(client_service_progress() -> 0 ->> 'code' = 'DS_META_ADS', 'a client sees their own services only (another client''s customer is not here)');
select test.login('tm_a');
select test.must_fail($$select client_service_progress()$$, 'staff have no client progress', 'FORBIDDEN|not a client|permission|NOT_FOUND');
select test.login('late_consultant');
select test.must_fail($$select client_service_progress()$$, 'neither does a consultant', 'FORBIDDEN|not a client|permission|NOT_FOUND');
reset role;
set role anon;
select test.must_fail($$select client_service_progress()$$, 'and no one without a session', 'permission denied');
reset role;
\echo '   running the migration again changes nothing'
\i supabase/migrations/20261205000400_client_service_progress.sql
\i supabase/migrations/20261222000400_service_specific_journeys.sql
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cg where name = 'direct') and type = 'PROGRESS_LIVE'), 'no notification was repeated');
