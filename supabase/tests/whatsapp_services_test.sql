-- =============================================================================
-- Three WhatsApp services (migration 20261120000100): WhatsApp API + Blue Tick, WhatsApp API, Blue Tick.
-- Runs after the other suites on the same database and re-uses their users.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\i supabase/migrations/20261120000100_whatsapp_api_and_blue_tick_services.sql
\echo '--- 59. WhatsApp services: three services, the same documents and details, the same onboarding'

reset role;
create temp table wa (name text primary key, id uuid);
grant all on wa to authenticated;
set role authenticated;
select test.login('sa');

select test.check((select count(*) = 3 from crm_services where code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK') and is_active), 'the catalogue has the three WhatsApp services');
select test.check((select string_agg(name, ' | ' order by sort_order) = 'WhatsApp API + Blue Tick | WhatsApp API | Blue Tick' from crm_services where code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK')), 'named WhatsApp API + Blue Tick, WhatsApp API and Blue Tick, in that order');

-- adding them told nobody: no client pop-up, no bell, no Department Head notice
select test.admin_check($q$select not exists (select 1 from client_announcements where service_code in ('WHATSAPP_API', 'BLUE_TICK'))
                           and not exists (select 1 from notifications where type = 'NEW_SERVICE' and title in ('New service: WhatsApp API', 'New service: Blue Tick'))
                           and not exists (select 1 from client_notifications where type = 'NEW_SERVICE' and title in ('New service: WhatsApp API', 'New service: Blue Tick'))$q$,
  'the two services were added without announcing them to every client');

-- the checklist
select test.admin_check($q$select (select array_agg(item_code order by item_code) from onboarding_item_services where service_code = 'WHATSAPP_API')
                               = (select array_agg(item_code order by item_code) from onboarding_item_services where service_code = 'WHATSAPP_API_BLUE_TICK')
                           and (select array_agg(item_code order by item_code) from onboarding_item_services where service_code = 'BLUE_TICK')
                               = (select array_agg(item_code order by item_code) from onboarding_item_services where service_code = 'WHATSAPP_API_BLUE_TICK')
                           and (select count(*) > 0 from onboarding_item_services where service_code = 'BLUE_TICK')$q$,
  'each new service needs exactly the documents and details the combined service needs');

select test.login('tm_a');
insert into wa select 'API', create_lead('{"name":"WA API Only","company":"WA API Co","phone":"+91 98000 80001","notes":"x"}', array['WHATSAPP_API']);
insert into wa select 'TICK', create_lead('{"name":"Tick Only","company":"Tick Co","phone":"+91 98000 80002","notes":"x"}', array['BLUE_TICK']);
insert into wa select 'BOTH', create_lead('{"name":"Combined","company":"Combined Co","phone":"+91 98000 80003","notes":"x"}', array['WHATSAPP_API_BLUE_TICK']);
insert into wa select 'ALL3', create_lead('{"name":"All Three","company":"All Three Co","phone":"+91 98000 80004","notes":"x"}', array['WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK']);
select test.check((select count(*) = 6 from customer_services where customer_id in (select id from wa)), 'a lead can be created with any one of the three services, or with all of them');

select test.admin_check($q$select (select array_agg(code order by code) from private.customer_items((select id from wa where name = 'API')))
                               = (select array_agg(code order by code) from private.customer_items((select id from wa where name = 'BOTH')))
                           and (select array_agg(code order by code) from private.customer_items((select id from wa where name = 'TICK')))
                               = (select array_agg(code order by code) from private.customer_items((select id from wa where name = 'BOTH')))$q$,
  'the onboarding checklist of a customer is the same for any one of the three services');
select test.admin_check($q$select (select array_agg(code order by code) from private.customer_items((select id from wa where name = 'ALL3')))
                               = (select array_agg(code order by code) from private.customer_items((select id from wa where name = 'BOTH')))$q$,
  'and buying all three asks for each document once');

-- the onboarding emails / WhatsApp follow any of the three (Wabastore customers in onboarding)
reset role;
update customers set lifecycle_stage = 'ONBOARDING' where id in (select id from wa);
select test.check((select bool_and(private.automation_eligible(id)) from wa), 'the onboarding emails and WhatsApp apply to a customer with any of the three services');
select test.check((select not private.automation_eligible((select id from customers c where not exists (select 1 from customer_services cs where cs.customer_id = c.id and cs.service_code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK')) limit 1))), 'and not to a customer with none of them');

-- Excel import: usage for a customer who already holds "WhatsApp API" is kept on that service, no second WhatsApp service is added
select test.check((select private.import_ensure_service((select id from wa where name = 'API'), 'WHATSAPP_API_BLUE_TICK') = false), 'the import adds no combined service beside "WhatsApp API"');
select private.import_save_usage((select id from wa where name = 'API'), 'WHATSAPP_API_BLUE_TICK', 'WHATSAPP', '', '{"delivered": 5}'::jsonb, null, null);
select test.check((select count(*) = 1 from service_usage where customer_id = (select id from wa where name = 'API') and service_code = 'WHATSAPP_API'
                          and not exists (select 1 from service_usage u2 where u2.customer_id = (select id from wa where name = 'API') and u2.service_code = 'WHATSAPP_API_BLUE_TICK')),
  'WhatsApp usage is saved under the WhatsApp service the customer holds');
select test.check((select private.import_ensure_service((select id from wa where name = 'TICK'), 'WHATSAPP_API_BLUE_TICK') = true), 'a customer with only "Blue Tick" still gets the combined service when the sheet has WhatsApp usage for them (as before)');
select test.check((select private.import_service_code('WhatsApp API') = 'WHATSAPP_API' and private.import_service_code('Blue Tick') = 'BLUE_TICK'
                          and private.import_service_code('WhatsApp API + Blue Tick') = 'WHATSAPP_API_BLUE_TICK'), 'the Excel service names map to their own services');

-- the per-service details (message package, messages sent) belong to WhatsApp API, not to Blue Tick alone
select test.check((select private.normalize_service_details('WHATSAPP_API', '{"packageMessages": 1000}'::jsonb) ->> 'packageMessages' = '1000'
                          and private.normalize_service_details('BLUE_TICK', '{"packageMessages": 1000}'::jsonb) = '{}'::jsonb), 'WhatsApp API carries the message-package details; Blue Tick alone does not');
