-- =============================================================================
-- Meta Verifier: the client's login details for the internal WhatsApp panel (migration 20261206000300). Runs after the Sales hand-off suite
-- and reuses its customers: "Hand One Traders" (WhatsApp API, with the Meta Verifier), "Hand Three Co" (AI Calling, Technical Consultant).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 76. Meta Verifier: client login details (WhatsApp panel)'
reset role;
\i supabase/migrations/20261206000300_meta_verifier_panel_details.sql

create temp table pd (name text primary key, id uuid);
grant all on pd to anon, authenticated, service_role;
insert into pd select 'wa', id from customers where company = 'Hand One Traders';
insert into pd select 'ai', id from customers where company = 'Hand Three Co';
select test.check((select count(*) = 2 from pd), 'the customers of the hand-off suite are there');
update customer_services set platform = null, panel_account = null where customer_id = (select id from pd where name = 'wa');
delete from customer_activities where customer_id = (select id from pd where name = 'wa') and type = 'PANEL_DETAILS_SAVED';
create temp table pd_t as select clock_timestamp() as t;
grant all on pd_t to authenticated, service_role;
create temp table pd_before as select (select count(*) from automation_jobs) as jobs, (select count(*) from client_notifications) as notes;
grant all on pd_before to authenticated, service_role;

\echo '   the Meta Verifier sees the WhatsApp service, and the dashboard login as read only'
set role authenticated;
select test.login('late_verifier');
select test.check((panel_details_list((select id from pd where name = 'wa')) ->> 'canEdit')::boolean and jsonb_array_length(panel_details_list((select id from pd where name = 'wa')) -> 'services') = 1
                  and (panel_details_list((select id from pd where name = 'wa')) -> 'services' -> 0 ->> 'code') = 'WHATSAPP_API', 'the customer''s WhatsApp service is listed and editable');
select test.check((panel_details_list((select id from pd where name = 'wa')) -> 'dashboardLogin') = 'null'::jsonb, 'no dashboard login yet - and the section has nothing to create one with (Accounts owns it)');

\echo '   save the details: persisted, history, audit without the values'
select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', 'Crocodial Panel', 'hand.one@example.com');
select test.check((panel_details_list((select id from pd where name = 'wa')) -> 'services' -> 0 ->> 'panelAccount') = 'hand.one@example.com'
                  and (panel_details_list((select id from pd where name = 'wa')) -> 'services' -> 0 ->> 'platform') = 'Crocodial Panel', 'saved against the right customer and service');
reset role;
select test.check((select panel_account = 'hand.one@example.com' from customer_services where customer_id = (select id from pd where name = 'wa') and service_code = 'WHATSAPP_API'), 'it is in the existing panel_account column (no new field)');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from pd where name = 'wa') and type = 'PANEL_DETAILS_SAVED' and note not like '%hand.one%' and note not like '%Crocodial%'), 'the history says it was saved, without the values');
select test.check((select count(*) = 1 from audit_logs where action = 'SERVICE_PANEL_DETAILS_SET' and created_at >= (select t from pd_t) and entity_id = (select id from pd where name = 'wa') and actor_id = test.id('late_verifier')
                   and metadata ->> 'service' = 'WHATSAPP_API' and metadata::text not like '%hand.one%' and metadata::text not like '%Crocodial%'), 'the audit names who, which service and which fields - never the values');
select test.check((select (select count(*) from automation_jobs) = jobs and (select count(*) from client_notifications) = notes from pd_before), 'saving the details sends nothing and queues nothing');

\echo '   the same values again change nothing'
set role authenticated;
select test.login('late_verifier');
select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', 'Crocodial Panel', 'hand.one@example.com');
reset role;
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from pd where name = 'wa') and type = 'PANEL_DETAILS_SAVED'), 'no second history line or audit row for an unchanged save');

\echo '   validation: an ID is an ID, and a password is refused'
set role authenticated;
select test.login('late_verifier');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', null, 'user name')$$, 'spaces are refused', 'user ID');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', null, 'hand@x.com:Secret123')$$, 'a user:password pair is refused', 'user ID');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', null, 'myPassword1')$$, 'anything that looks like a password is refused', 'Never type a password');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', null, 'ab')$$, 'too short is refused', 'user ID');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', '<script>', 'hand.one@example.com')$$, 'a panel name with markup is refused', 'panel name');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'AI_CALLING', null, 'hand.one@example.com')$$, 'a service the customer does not have is refused', 'not a WhatsApp service');
select test.must_fail($$select panel_details_set((select id from pd where name = 'ai'), 'AI_CALLING', null, 'hand.three@example.com')$$, 'a non-WhatsApp service is not part of this section', 'NOT_FOUND|WhatsApp service');

\echo '   who may: the route''s verifier, the Department Head and the Super Admin - nobody else'
select test.login('tm_a');
select test.must_fail($$select panel_details_list((select id from pd where name = 'wa'))$$, 'Sales cannot read it', 'NOT_FOUND');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', null, 'sales@example.com')$$, 'Sales cannot write it', 'NOT_FOUND');
select test.login('late_consultant');
select test.must_fail($$select panel_details_list((select id from pd where name = 'wa'))$$, 'the Technical Consultant cannot read a Meta customer''s details', 'NOT_FOUND');
select test.must_fail($$select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', null, 'tc@example.com')$$, 'nor write them', 'NOT_FOUND');
select test.login('dh_wab');
select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', 'Crocodial Panel', 'hand.one.dh@example.com');
select test.check((panel_details_list((select id from pd where name = 'wa')) -> 'services' -> 0 ->> 'panelAccount') = 'hand.one.dh@example.com', 'the Department Head can');
select test.login('sa');
select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', 'Crocodial Panel', 'hand.one@example.com');
select test.check((panel_details_list((select id from pd where name = 'wa')) -> 'services' -> 0 ->> 'panelAccount') = 'hand.one@example.com', 'and so can the Super Admin');
select test.login('late_verifier');
select panel_details_set((select id from pd where name = 'wa'), 'WHATSAPP_API', '', '');
select test.check((panel_details_list((select id from pd where name = 'wa')) -> 'services' -> 0 -> 'panelAccount') = 'null'::jsonb, 'empty clears a value');
select test.must_fail($$select panel_details_list('00000000-0000-0000-0000-000000000000')$$, 'an unknown customer', 'NOT_FOUND');
reset role;
set role anon;
select test.must_fail($$select panel_details_list((select id from pd where name = 'wa'))$$, 'a visitor has nothing', 'permission denied for function panel_details_list');
reset role;
