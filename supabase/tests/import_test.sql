-- =============================================================================
-- Excel import of existing customers (migration 20261101000100): preview, errors, all-or-nothing save,
-- who may import for whom, usage / campaigns, client logins and what the client sees.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 30. Excel import: preview, errors, save, usage, campaigns, client view'
reset role;
create temp table imp (k text primary key, j jsonb);
grant all on imp to authenticated, service_role;
insert into imp values ('file', $j${
  "customers": [
    {"row": 3, "mobile": "+91 90000 00101", "name": "Ravi Kumar", "businessName": "Ravi Traders (TEST)", "email": "ravi.test@example.com",
     "city": "Pune", "customerSince": "2025-04-01", "loginEmail": "ravi.client@example.com", "soldBy": "Asha"},
    {"row": 4, "mobile": "9000000102", "name": "Meena Shah", "businessName": "Meena Boutique (TEST)", "customerSince": "2025-06-15"}
  ],
  "services": [
    {"row": 3, "mobile": "9000000101", "service": "WhatsApp API + Blue Tick", "plan": "1 Lakh messages", "price": 25000,
     "billingCycle": "Yearly", "startDate": "2025-04-01", "renewsOn": "2027-03-31", "status": "Live", "platform": "Wabastore"},
    {"row": 4, "mobile": "9000000101", "service": "AI Calling", "startDate": "2025-05-01", "status": "Live"},
    {"row": 5, "mobile": "9000000102", "service": "Social Media Management", "startDate": "2025-06-15", "status": "Setting up"}
  ],
  "whatsapp": [
    {"row": 4, "mobile": "9000000101", "packageMessages": 100000, "extraMessages": 0, "sent": 40500, "delivered": 30600,
     "read": 21000, "replied": 3700, "failed": 4600, "campaigns": 12, "validUntil": "2027-03-31", "asOf": "2026-10-15"}
  ],
  "campaigns": [
    {"row": 4, "mobile": "9000000101", "name": "Diwali Offer", "template": "diwali_offer", "sentOn": "2026-10-10",
     "audienceType": "Contacts", "audienceSize": 405, "sent": 405, "delivered": 306, "read": 200, "replied": 37, "failed": 46, "status": "Completed"}
  ],
  "aiCalling": [
    {"row": 3, "mobile": "9000000101", "platform": "Bolify AI", "minutesBought": 1000, "minutesLeft": 275, "creditsBought": 5000, "creditsLeft": 964.34, "totalCalls": 820}
  ],
  "monthly": [
    {"row": 4, "mobile": "9000000102", "service": "Social Media Management", "month": "2026-09", "unit": "Posts", "included": 12, "delivered": 10}
  ]
}$j$::jsonb);

set role authenticated;

-- ---------------------------------------------------------------- who may import
select test.login('tm_a');
select test.must_fail($$select import_customer_data((select j from imp where k = 'file'), false)$$, 'a Sales member cannot import here', 'Support team');
select test.login('sup_plain');
select test.must_fail($$select import_customer_data('{}'::jsonb, false)$$, 'an empty file is refused', 'no rows');

-- ---------------------------------------------------------------- preview saves nothing
create temp table res as select import_customer_data((select j from imp where k = 'file'), false) as r;
select test.check((select jsonb_array_length(r -> 'errors') = 0 and not (r ->> 'committed')::boolean from res), 'the preview of a correct file has no errors');
select test.check((select (r -> 'summary' ->> 'added')::int = 2 and (r -> 'summary' ->> 'services')::int = 3 and (r -> 'summary' ->> 'usage')::int = 3
                          and (r -> 'summary' ->> 'campaigns')::int = 1 and (r -> 'summary' ->> 'logins')::int = 1 from res), 'the preview counts what would be saved');
reset role;
select test.check((select count(*) = 0 from customers where phone in ('9000000101', '9000000102')), 'the preview saved no customer');
select test.check((select count(*) = 0 from service_campaigns), 'nor a campaign');
drop table res;

-- ---------------------------------------------------------------- one bad row: nothing is saved, errors name sheet and row
set role authenticated;
select test.login('sup_plain');
create temp table res as select import_customer_data(jsonb_set(jsonb_set((select j from imp where k = 'file'),
  '{customers,1,mobile}', '"12345"'), '{campaigns,0,mobile}', '"9999999999"'), true) as r;
select test.check((select not (r ->> 'committed')::boolean from res), 'a file with errors is not saved');
select test.check((select exists (select 1 from jsonb_array_elements(r -> 'errors') e where e ->> 'sheet' = '1 Customers' and (e ->> 'row')::int = 4 and e ->> 'message' ilike '%10-digit%') from res),
  'the error names sheet 1, row 4 and the problem');
select test.check((select exists (select 1 from jsonb_array_elements(r -> 'errors') e where e ->> 'sheet' = '4 WhatsApp Campaigns' and e ->> 'message' ilike '%not in sheet%') from res),
  'a usage row for an unknown mobile is reported');
select test.check((select exists (select 1 from jsonb_array_elements(r -> 'errors') e where e ->> 'sheet' = '7 Monthly Deliverables') from res),
  'rows depending on the bad customer are reported too');
select test.check((select e ->> 'message' !~ '^[A-Z_]+:' from res, jsonb_array_elements(r -> 'errors') e limit 1), 'messages have no internal code prefix');
reset role;
select test.check((select count(*) = 0 from customers where phone in ('9000000101', '9000000102')), 'nothing was saved, not even the good rows');
drop table res;

-- other checks
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data(jsonb_set((select j from imp where k = 'file'), '{services,0,service}', '"Rocket Launch"'), false) -> 'errors' -> 0 ->> 'message') ilike '%not one of the services%'),
  'an unknown service is reported');
select test.check((select (import_customer_data(jsonb_set((select j from imp where k = 'file'), '{services,0,status}', '"Running"'), false) -> 'errors' -> 0 ->> 'message') ilike '%Live, Setting up%'),
  'an unknown status is reported');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data(jsonb_set((select j from imp where k = 'file'), '{aiCalling,0,minutesLeft}', '5000'), false) -> 'errors') e
                    where e ->> 'message' ilike '%Minutes Left is more%')), 'minutes left above minutes bought is reported');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data(jsonb_set((select j from imp where k = 'file'), '{whatsapp,0,sent}', '-5'), false) -> 'errors') e
                    where e ->> 'message' ilike '%negative%')), 'a negative number is reported');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data(jsonb_set((select j from imp where k = 'file'), '{customers,0,loginEmail}', '"dh.wab@amuwa.com"'), false) -> 'errors') e
                    where e ->> 'message' ilike '%already has a login%')), 'a staff e-mail cannot be a client login');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data(jsonb_set((select j from imp where k = 'file'), '{customers,1,mobile}', '"9000000101"'), false) -> 'errors') e
                    where e ->> 'message' ilike '%another row%')), 'the same mobile twice in sheet 1 is reported');
-- usage for a service the customer does not have no longer needs a hand-made row in "2 Services": the service is added (and counted)
select test.check((select (r -> 'errors') = '[]'::jsonb and (r -> 'summary' ->> 'services')::int = (select (import_customer_data((select j from imp where k = 'file'), false) -> 'summary' ->> 'services')::int + 1)
                     from (select import_customer_data(jsonb_set((select j from imp where k = 'file'), '{whatsapp,0,mobile}', '"9000000102"'), false) as r) x),
  'usage for a service the customer does not have adds that service instead of failing');

-- a Team Lead must name the member; an unknown or other-team member is refused
select test.login('sup_th');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data((select j from imp where k = 'file'), false) -> 'errors') e
                    where e ->> 'message' ilike '%Support Team Member is required%')), 'a Team Lead must name the member');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data(jsonb_set((select j from imp where k = 'file'), '{customers,0,member}', '"Delivery Member"'), false) -> 'errors') e
                    where e ->> 'message' ilike '%was not found%')), 'a member of another team cannot be named by this Team Lead');

-- ---------------------------------------------------------------- a Team Member saves: the customers are theirs
select test.login('sup_plain');
create temp table res as select import_customer_data(jsonb_set((select j from imp where k = 'file'), '{customers,1,member}', '"Support B"'), true) as r;
select test.check((select (r ->> 'committed')::boolean and jsonb_array_length(r -> 'errors') = 0 from res), 'the Team Member saves the file');
select test.check((select jsonb_array_length(r -> 'newLogins') = 1 and r -> 'newLogins' -> 0 ->> 'email' = 'ravi.client@example.com' from res), 'the client login to create is returned');
reset role;
insert into imp select 'ravi', to_jsonb(id) from customers where phone = '9000000101';
select test.check((select count(*) = 2 and bool_and(owner_id = test.id('sup_plain')) and bool_and(lifecycle_stage = 'CUSTOMER') from customers where phone in ('9000000101', '9000000102')),
  'both customers belong to the Team Member who imported them (the member column is ignored for a Team Member)');
select test.check((select customer_since = '2025-04-01' and city = 'Pune' and notes ilike '%Sold by (Sales): Asha%' from customers where phone = '9000000101'), 'customer details are saved');
select test.check((select plan_name = '1 Lakh messages' and price = 25000 and service_status = 'LIVE' and renews_on = '2027-03-31' and activated_at is not null
                     from customer_services where customer_id = (select (j #>> '{}')::uuid from imp where k = 'ravi') and service_code = 'WHATSAPP_API_BLUE_TICK'), 'the plan is saved on the service');
select test.check((select (metrics ->> 'packageMessages')::int = 100000 and (metrics ->> 'sent')::int = 40500 and as_of = '2026-10-15'
                     from service_usage where customer_id = (select (j #>> '{}')::uuid from imp where k = 'ravi') and kind = 'WHATSAPP'), 'the WhatsApp usage is saved');
select test.check((select count(*) = 1 from service_campaigns where customer_id = (select (j #>> '{}')::uuid from imp where k = 'ravi') and delivered = 306), 'the campaign is saved');
select test.check((select count(*) = 1 from service_usage where kind = 'MONTHLY' and period = '2026-09'), 'the monthly deliverable is saved');
select test.check((select count(*) >= 2 from customer_activities where type = 'CUSTOMER_IMPORTED'), 'the import is in the customer history');
set role authenticated;
select test.login('sup_b');
select test.check((select exists (select 1 from jsonb_array_elements(import_customer_data((select j from imp where k = 'file'), false) -> 'errors') e
                    where e ->> 'message' ilike '%looked after by someone else%')), 'nor can they import over them');

-- ---------------------------------------------------------------- importing again updates, never duplicates
select test.login('sup_plain');
select test.check((select (r ->> 'committed')::boolean and (r -> 'summary' ->> 'updated')::int = 2 and (r -> 'summary' ->> 'added')::int = 0
                     from (select import_customer_data(jsonb_set(jsonb_set((select j from imp where k = 'file'), '{whatsapp,0,sent}', '45000'), '{customers,0,loginEmail}', 'null'), true) as r) x),
  'the same file again updates the customers');
reset role;
select test.check((select count(*) = 1 from customers where phone = '9000000101'), 'still one customer per mobile');
select test.check((select (metrics ->> 'sent')::int = 45000 from service_usage where kind = 'WHATSAPP' and customer_id = (select (j #>> '{}')::uuid from imp where k = 'ravi')), 'the usage is replaced');
select test.check((select count(*) = 1 from service_campaigns), 'the campaign is not added twice');

-- ---------------------------------------------------------------- a Department Head imports for a named member
set role authenticated;
select test.login('dh_wab');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000103","name":"Kiran","businessName":"Kiran Foods (TEST)","member":"sup.b@amuwa.com"}]}'::jsonb, true) ->> 'committed')::boolean),
  'the Department Head imports a customer for a member (named by e-mail)');
reset role;
select test.check((select owner_id = test.id('sup_b') from customers where phone = '9000000103'), 'the customer is that member''s');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_b') and title ilike '1 customer added for you'), 'the member is told once');

-- ---------------------------------------------------------------- the client login and what the client sees
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select record_imported_client_login((select (j #>> '{}')::uuid from imp where k = 'ravi'), gen_random_uuid(), 'ravi.client@example.com')$$,
  'only a login made by the API can be recorded', 'not created');
reset role;
select test.create_auth_user('ravi_client', 'ravi.client@example.com', '{}'::jsonb,
  jsonb_build_object('provider', 'email', 'client_customer_id', (select j #>> '{}' from imp where k = 'ravi')));
set role authenticated;
select test.login('sup_b');
select test.must_fail($$select record_imported_client_login((select (j #>> '{}')::uuid from imp where k = 'ravi'), test.id('ravi_client'), 'ravi.client@example.com')$$,
  'another member cannot record it', 'NOT_FOUND');
select test.login('sup_plain');
select record_imported_client_login((select (j #>> '{}')::uuid from imp where k = 'ravi'), test.id('ravi_client'), 'ravi.client@example.com');
select test.check((select client_login_invite_target((select (j #>> '{}')::uuid from imp where k = 'ravi')) ->> 'email' = 'ravi.client@example.com'), 'the member can resend the set-password e-mail');
select test.login('sup_b');
select test.must_fail($$select client_login_invite_target((select (j #>> '{}')::uuid from imp where k = 'ravi'))$$, 'another member cannot', 'NOT_FOUND');

select test.login('ravi_client');
select test.check((select client_me() ->> 'clientSince' like '2025-04-01%'), 'the client sees "customer since" from the sheet');
select test.check((select s ->> 'planName' = '1 Lakh messages' and s ->> 'status' = 'LIVE' and (s -> 'usage' -> 'metrics' ->> 'packageMessages')::int = 100000
                          and (s ->> 'campaignCount')::int = 1
                     from jsonb_array_elements(client_services()) s where s ->> 'code' = 'WHATSAPP_API_BLUE_TICK'), 'My Services shows the plan and the usage');
select test.check((select (s -> 'usage' -> 'metrics' ->> 'minutesLeft')::int = 275 from jsonb_array_elements(client_services()) s where s ->> 'code' = 'AI_CALLING'), 'and the AI Calling minutes');
select test.check((select jsonb_array_length(client_campaigns()) = 1 and client_campaigns() -> 0 ->> 'name' = 'Diwali Offer'), 'the client sees their campaigns');
select test.login('cdash_a');
select test.check((select jsonb_array_length(client_campaigns()) = 0), 'another client sees none of them');
select test.must_fail($$select * from service_usage$$, 'usage is not readable directly', 'permission denied');
select test.must_fail($$select * from service_campaigns$$, 'campaigns are not readable directly', 'permission denied');

-- ---------------------------------------------------------------- the Department Head sees who looks after them; tickets go to the member
select test.login('dh_wab');
select test.check((select i -> 'teamMember' ->> 'name' = 'Support Member' and i -> 'teamLead' ->> 'id' is not null and i ->> 'handoverStage' = 'TEAM_MEMBER' and (i ->> 'hasClientLogin')::boolean
                     from jsonb_array_elements(head_customer_directory('Ravi Traders') -> 'items') i), 'the Department Head sees the member and lead of an imported customer');
select test.login('ravi_client');
select test.check((select client_create_ticket('Campaign report', 'Please send the October report.') ->> 'ticketNo' is not null), 'the imported client raises a ticket');
reset role;
select test.check((select assignee_id = test.id('sup_plain') from support_tickets where subject = 'Campaign report'), 'it goes to their Team Member');
