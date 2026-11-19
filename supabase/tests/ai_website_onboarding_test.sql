-- =============================================================================
-- AI Website client onboarding details (migration 20270113000200): one record per lead, validated by the database, readable exactly where the
-- lead is, written only by the people who work on it, kept through edits and stages, and audited. Own synthetic leads (company 'AIW %').
-- Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 132. AI Website client onboarding details'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270113000200_ai_website_onboarding.sql
\i supabase/migrations/20270113000200_ai_website_onboarding.sql
delete from customers where company like 'AIW %';
create or replace function test.aiw_row(p_customer uuid) returns setof public.ai_website_onboarding language sql stable security definer set search_path = '' as $$
  select * from public.ai_website_onboarding where customer_id = p_customer $$;
create or replace function test.aiw_body(p_extra jsonb default '{}'::jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('clientName', 'Meera Shah', 'mobile', '98765 43210', 'email', 'Meera@ShahJewels.example', 'businessName', 'AIW Shah Jewels',
                            'onGoogleMaps', true, 'googleMapsLink', 'https://maps.app.goo.gl/abc123', 'city', 'Surat', 'businessType', 'Jewellery / Gold') || p_extra $$;
grant execute on all functions in schema test to anon, authenticated;
create temp table aiw (name text primary key, id uuid);
grant all on aiw to anon, authenticated, service_role;

\echo '   a Sales team member adds an AI Website lead with its details'
set role authenticated;
select test.login('tm_a');
insert into aiw select 'L1', create_lead('{"name":"Meera Shah","company":"AIW Shah Jewels","phone":"9876543210","leadSource":"Walk-in"}', array['AI_WEBSITE']);
select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body());
reset role;
select test.check((select client_name = 'Meera Shah' and mobile = '9876543210' and email = 'meera@shahjewels.example' and on_google_maps
                          and google_maps_link = 'https://maps.app.goo.gl/abc123' and city = 'Surat' and business_type = 'Jewellery / Gold' and business_type_other is null
                          and created_by = test.id('tm_a')
                     from test.aiw_row((select id from aiw where name = 'L1'))),
  'the details are saved against the lead (mobile reduced to its 10 digits, e-mail in lower case)');
select test.check((select count(*) = 1 from audit_logs where action = 'AI_WEBSITE_ONBOARDING_ADDED' and entity_id = (select id from aiw where name = 'L1')),
  'adding them is audited');
select test.check((select not (metadata::text ~ '9876543210|Meera') from audit_logs where action = 'AI_WEBSITE_ONBOARDING_ADDED' and entity_id = (select id from aiw where name = 'L1')),
  '... without the personal data in the audit log');

\echo '   validation (the same rules as the form and the API)'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"clientName":"  "}'))$$, 'the client name is required', 'client name');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"mobile":"12345"}'))$$, 'a mobile number must have 10 digits', '10-digit mobile');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"mobile":"1234567890"}'))$$, '... and be a mobile number (6-9 first)', '10-digit mobile');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"email":"not-an-email"}'))$$, 'an e-mail must be valid', 'valid email');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"businessName":""}'))$$, 'the business name is required', 'business name');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body() - 'onGoogleMaps')$$, 'the Google Maps answer is required', 'Google Maps');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"googleMapsLink":"maps.google.com/x"}'))$$, 'a Google Maps link is a web address', 'web address');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"city":""}'))$$, 'the city is required', 'city');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"businessType":"Spaceships"}'))$$, 'the type of business comes from the list', 'type of business');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"businessType":"Other"}'))$$, '"Other" needs the type typed in', 'Type the type');
reset role;
select test.check((select client_name = 'Meera Shah' and city = 'Surat' from test.aiw_row((select id from aiw where name = 'L1'))), 'a refused save changes nothing');

\echo '   editing updates the ONE record'
set role authenticated;
select test.login('tm_a');
select ai_website_onboarding_save((select id from aiw where name = 'L1'),
  test.aiw_body('{"onGoogleMaps":false,"googleMapsLink":"https://maps.app.goo.gl/should-go","email":"","businessType":"Other","businessTypeOther":"Handmade silver","city":"Vadodara","mobile":"+91 91234 56789"}'));
select ai_website_onboarding_save((select id from aiw where name = 'L1'),
  test.aiw_body('{"onGoogleMaps":false,"email":"","businessType":"Other","businessTypeOther":"Handmade silver","city":"Vadodara","mobile":"+91 91234 56789"}'));   -- a retry
reset role;
select test.check((select count(*) = 1 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'editing and retrying never make a second record');
select test.check((select not on_google_maps and google_maps_link is null and email is null and business_type = 'Other' and business_type_other = 'Handmade silver'
                          and city = 'Vadodara' and mobile = '9123456789' and updated_by = test.id('tm_a')
                     from test.aiw_row((select id from aiw where name = 'L1'))),
  'the changes are saved; "No" drops the link, an empty e-mail is none');
select test.check((select count(*) = 2 from audit_logs where action = 'AI_WEBSITE_ONBOARDING_UPDATED' and entity_id = (select id from aiw where name = 'L1')), 'each update is audited');
select test.check((select metadata -> 'changed' = '[]'::jsonb from audit_logs where action = 'AI_WEBSITE_ONBOARDING_UPDATED' and entity_id = (select id from aiw where name = 'L1') order by created_at desc, id desc limit 1),
  '... with the fields that changed (none for the retry)');

\echo '   who can read and write'
set role authenticated;
select test.login('tm_a');
select test.check((select count(*) = 1 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'the lead''s owner reads them');
select test.login('sh_head');
select test.check((select count(*) = 1 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'the Sales Department Head of the lead''s department reads them');
select test.login('sa');
select test.check((select count(*) = 1 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'the Super Admin reads them');
select test.login('tm_c');
select test.check((select count(*) = 0 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'a member of another department does not see them');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body())$$, 'nor change them (the lead is not found for them)', 'NOT_FOUND');
select test.login('tm_b');
select test.check((select count(*) = 0 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'a colleague who does not own the lead does not see them');
select test.must_fail($$select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body())$$, 'nor change them', 'NOT_FOUND');
select test.must_fail($$insert into ai_website_onboarding (customer_id, client_name, mobile, business_name, on_google_maps, city, business_type)
                        values ((select id from aiw where name = 'L1'), 'x', '9876543210', 'x', false, 'x', 'Retail')$$, 'nobody writes the table directly', 'permission denied');
select test.login('sh_head');
select ai_website_onboarding_save((select id from aiw where name = 'L1'), test.aiw_body('{"onGoogleMaps":false,"email":"","businessType":"Other","businessTypeOther":"Handmade silver","city":"Ahmedabad","mobile":"9123456789"}'));
reset role;
select test.check((select city = 'Ahmedabad' and updated_by = test.id('sh_head') from test.aiw_row((select id from aiw where name = 'L1'))), 'the Department Head may correct them');

\echo '   the details stay with the lead'
set role authenticated;
select test.login('tm_a');
select update_lead((select id from aiw where name = 'L1'), '{"city":"Rajkot","notes":"Wants a site before Diwali"}', array['AI_WEBSITE', 'AI_CALLING']);
reset role;
select test.check((select count(*) = 1 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1') and city = 'Ahmedabad'),
  'editing the lead and its services keeps the details (they are changed only through their own form)');
-- the Super Admin gives the lead to another member of the team
set role authenticated;
select test.login('sa');
update customers set owner_id = test.id('tm_b') where id = (select id from aiw where name = 'L1');
select test.login('tm_b');
select test.check((select count(*) = 1 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), 'reassigned: the new owner reads them at once (no copy, no re-entry)');
select test.login('tm_a');
select test.check((select count(*) = 0 from ai_website_onboarding where customer_id = (select id from aiw where name = 'L1')), '... and the former owner no longer does');
reset role;
select test.check((select count(*) = 1 from ai_website_onboarding a join customers c on c.id = a.customer_id where c.company like 'AIW %') and (select count(*) = 1 from customers where company like 'AIW %'), 'one lead, one record: no duplicate lead or client');
delete from customers where company like 'AIW %';
select test.check((select count(*) = 0 from ai_website_onboarding a where not exists (select 1 from customers c where c.id = a.customer_id)), 'deleting the lead removes its details with it');
select set_config('request.jwt.claims', '', false);
