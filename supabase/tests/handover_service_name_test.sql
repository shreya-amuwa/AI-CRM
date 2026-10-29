-- =============================================================================
-- Migration 20261208000100: the handover date is set by the database at the moment of the handover (kept for good, one history line per
-- handover), and the service "Crocodile" is spelled "Crocodial" in its one catalogue row. Runs late on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 78. Handover date and the Crocodial name'
reset role;
create temp table hs (name text primary key, id uuid);
grant all on hs to anon, authenticated, service_role;
create temp table hs_services_before as select count(*) as n from customer_services;

\i supabase/migrations/20261208000100_handover_date_and_service_name.sql

set role authenticated;
select test.login('tm_a');
insert into hs select 'meta', create_lead('{"name":"Handover Meta","company":"Handover Meta Co","email":"handover.meta@example.com","phone":"9819940001","whatsapp":"9819940001","leadSource":"Walk-in"}', array['WHATSAPP_API']);
insert into hs select 'tech', create_lead('{"name":"Handover Tech","company":"Handover Tech Co","email":"handover.tech@example.com","phone":"9819940002","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
insert into customer_onboarding (customer_id) select id from hs on conflict do nothing;
create temp table hs_t as select clock_timestamp() as t;
grant all on hs_t to authenticated, service_role;

\echo '   nothing is dated before the handover happens'
select test.check((select count(*) = 2 from customer_onboarding where customer_id in (select id from hs) and forwarded_to_support_at is null and first_handed_over_at is null), 'no handover, no date');
select test.check((select count(*) = 0 from customer_activities where type = 'HANDED_OVER' and customer_id in (select id from hs)), 'and no history line');

\echo '   the handover stamps the moment (server time) once, and says to whom'
update customer_onboarding set stage = 'SETUP', forwarded_to_support_at = now() where customer_id = (select id from hs where name = 'meta');
update customer_onboarding set stage = 'SETUP', forwarded_to_support_at = now() where customer_id = (select id from hs where name = 'tech');
select test.check((select first_handed_over_at = forwarded_to_support_at and first_handed_over_at >= (select t from hs_t) from customer_onboarding where customer_id = (select id from hs where name = 'meta')), 'the date is the moment it happened');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from hs where name = 'meta') and type = 'HANDED_OVER' and note like 'Handed over to the Meta Verifier on %'), 'a WhatsApp customer: handed over to the Meta Verifier');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from hs where name = 'tech') and type = 'HANDED_OVER' and note like 'Handed over to the Technical Consultant on %'), 'another service: to the Technical Consultant');

\echo '   editing or opening the record never moves it'
create temp table hs_first as select customer_id, first_handed_over_at f, forwarded_to_support_at w from customer_onboarding where customer_id in (select id from hs);
update customer_onboarding set stage = 'SETUP', forwarded_to_support_at = forwarded_to_support_at where customer_id in (select id from hs);
update customers set updated_at = now() where id in (select id from hs);
select test.check((select count(*) = 2 and bool_and(o.first_handed_over_at = h.f and o.forwarded_to_support_at = h.w) from customer_onboarding o join hs_first h using (customer_id)), 'the date is unchanged by saves');
select test.check((select count(*) = 2 from customer_activities where type = 'HANDED_OVER' and customer_id in (select id from hs)), 'and no second history line');

\echo '   a return and a new handover: the first date is kept, the new one is on its own line'
update customer_onboarding set forwarded_to_support_at = null, forwarded_by = null where customer_id = (select id from hs where name = 'meta');
select test.check((select first_handed_over_at = (select f from hs_first where customer_id = (select id from hs where name = 'meta')) from customer_onboarding where customer_id = (select id from hs where name = 'meta')), 'returning to Sales keeps the first handover date');
select pg_sleep(0.05);
update customer_onboarding set forwarded_to_support_at = now() where customer_id = (select id from hs where name = 'meta');
select test.check((select first_handed_over_at = (select f from hs_first where customer_id = (select id from hs where name = 'meta')) and forwarded_to_support_at > first_handed_over_at from customer_onboarding where customer_id = (select id from hs where name = 'meta')), 'the later handover does not overwrite it');
select test.check((select count(*) = 2 from customer_activities where customer_id = (select id from hs where name = 'meta') and type = 'HANDED_OVER'), 'the history has both handovers');

\echo '   nobody can type the date'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$update customer_onboarding set first_handed_over_at = now() - interval '30 days' where customer_id = (select id from hs where name = 'meta')$$, 'the first handover date cannot be edited through the table API', 'permission denied');
reset role;

\echo '   the real handover (Sales sends the customer on) stamps it'
select test.check((select count(*) >= 1 from customer_onboarding o where o.forwarded_to_support_at is not null and o.first_handed_over_at is not null)
               and (select count(*) = 0 from customer_onboarding where forwarded_to_support_at is not null and first_handed_over_at is null), 'every handed-over customer has the first date');

\echo '   Crocodial: one catalogue row, renamed'
select test.check((select count(*) = 1 from crm_services where code = 'CROCODILE_CHANNEL_WEBHOOK' and name = 'Crocodial (Call CRM)'), 'the service is called Crocodial (same code, same row)');
select test.check((select count(*) = 0 from crm_services where name ilike '%crocodile%'), 'no catalogue row still says Crocodile');
select test.check((select count(*) = 1 from crm_services where name ilike '%crocodial%'), 'and there is exactly one Crocodial');
select test.check((select n + 2 = (select count(*) from customer_services) from hs_services_before), 'no purchase was added or removed by the rename (only this test''s two customers are new)');
select test.check(private.import_service_code('Crocodial') = 'CROCODILE_CHANNEL_WEBHOOK'
               and private.import_service_code('Crocodial (Call CRM)') = 'CROCODILE_CHANNEL_WEBHOOK'
               and private.import_service_code('crocodile') = 'CROCODILE_CHANNEL_WEBHOOK'
               and private.import_service_code('Crocodile (Call CRM)') = 'CROCODILE_CHANNEL_WEBHOOK', 'the usage import finds it by the new and the old spelling');
\i supabase/migrations/20261208000100_handover_date_and_service_name.sql
select test.check((select count(*) = 1 from crm_services where code = 'CROCODILE_CHANNEL_WEBHOOK') and (select count(*) = 3 from customer_activities where type = 'HANDED_OVER' and customer_id in (select id from hs)), 'running the migration again changes nothing');
