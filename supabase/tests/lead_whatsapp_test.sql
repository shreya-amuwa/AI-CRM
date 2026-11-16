-- =============================================================================
-- Lead welcome WhatsApp (migration 20270103000200): a lead's first sales person queues ONE message; who counts; reassigning adds nothing;
-- no valid number = SKIPPED; settings permissions; history / send again; claim / finish / delivery reports; the worker is service-role only.
-- Nothing is sent: the "provider" is whatever the test records through lead_whatsapp_finish. Runs last (uses the authorization suite's users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- lead welcome WhatsApp'
reset role;
select set_config('request.jwt.claims', '', false);
-- a fresh database starts with the template submitted to Meta, switched off and not approved (a database where someone saved settings keeps theirs)
select test.check((select updated_by is not null
                          or (not enabled and template_name = 'amuwa_services_intro' and template_language = 'en' and not template_approved
                              and variables = array['LEAD_NAME', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE'])
                     from lead_whatsapp_settings),
  'fresh settings: amuwa_services_intro (en), lead name / sales person name / phone, switched off, not approved');
-- a clean start when the suite is run twice on the same database
delete from lead_whatsapp_dispatches;
delete from customer_activities where customer_id in (select id from customers where name like 'LW %');
delete from customers where name like 'LW %';
update lead_whatsapp_settings set enabled = false, template_name = null, template_approved = false, variables = array['LEAD_NAME', 'SALES_PERSON_NAME'];

-- the people: a Sales team member (tm_a), another (tm_b), a Business Associate, a Support member, the Sales Department Head
select test.create_auth_user('lw_ba', 'lw.ba@amuwa.com', '{"full_name":"Lead WA BA"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')))
 where not exists (select 1 from profiles where email = 'lw.ba@amuwa.com');
update profiles set sales_sub_role = 'BUSINESS_ASSOCIATE', phone = '9876500001' where id = test.id('lw_ba');
update profiles set phone = '9876500002' where id = test.id('tm_a');
select test.check((select t.division = 'SALES' from profiles p join teams t on t.id = p.team_id where p.id = test.id('tm_a')), 'fixtures: tm_a is on a Sales team');
select test.check((select t.division = 'SUPPORT' from profiles p join teams t on t.id = p.team_id where p.id = test.id('sup_plain')), 'fixtures: sup_plain is on a Support team');
select test.check(private.lead_wa_is_seller(test.id('tm_a')) and private.lead_wa_is_seller(test.id('lw_ba')) and not private.lead_wa_is_seller(test.id('sup_plain'))
                  and not private.lead_wa_is_seller(test.id('dh_wab')) and not private.lead_wa_is_seller(test.id('sa')),
  'a sales person = a Sales team member / lead or a Business Associate; not Support, a Department Head or the Super Admin');

create temp table lw (k text primary key, v text);
grant all on lw to authenticated, service_role;
create or replace function pg_temp.g(p text) returns text language sql as $$ select v from lw where k = p $$;

-- ---------------------------------------------------------------- switched off: nothing is queued (and nothing is backfilled later)
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('tm_a'), 'LW Before', '9819000001', 'LEAD');
insert into lw select 'before', id::text from customers where name = 'LW Before';
select test.check((select count(*) = 0 from lead_whatsapp_dispatches), 'switched off: a new lead queues nothing');

-- ---------------------------------------------------------------- settings
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select lead_whatsapp_settings_get()$$, 'a sales person cannot read the settings', 'Only the Super Admin or the Sales Department Head');
select test.must_fail($$select set_lead_whatsapp_settings(true, 'lead_welcome', 'en', true, array['LEAD_NAME'])$$, 'nor change them', 'Only the Super Admin or the Sales Department Head');
select test.login('dh_wab');
select test.must_fail($$select set_lead_whatsapp_settings(true, 'lead_welcome', 'en', true, array['LEAD_NAME'])$$, 'the Support Department Head cannot change them', 'Only the Super Admin or the Sales Department Head');
select test.login('sa');
select test.must_fail($$select set_lead_whatsapp_settings(true, 'Lead Welcome!', 'en', false, array['LEAD_NAME'])$$, 'a template name is lower case letters, digits and underscores', 'lower case');
select test.must_fail($$select set_lead_whatsapp_settings(true, null, 'en', true, array['LEAD_NAME'])$$, 'approval needs a template name', 'Enter the template name');
select test.must_fail($$select set_lead_whatsapp_settings(true, 'lead_welcome', 'english', false, array['LEAD_NAME'])$$, 'the language is checked', 'language');
select test.must_fail($$select set_lead_whatsapp_settings(true, 'lead_welcome', 'en', false, array['LEAD_EMAIL'])$$, 'only the known CRM values fill a variable', 'Each template variable');
select test.check((select (j ->> 'enabled')::boolean and (j ->> 'templateApproved')::boolean and j ->> 'templateName' = 'lead_welcome'
                          and j -> 'variables' = '["LEAD_NAME","SALES_PERSON_NAME","SALES_PERSON_PHONE"]'::jsonb
                     from (select set_lead_whatsapp_settings(true, 'lead_welcome', 'en', true, array['LEAD_NAME', 'SALES_PERSON_NAME', 'SALES_PERSON_PHONE']) j) x),
  'the Super Admin switches it on with an approved template and its variables');
select test.check((select not (set_lead_whatsapp_settings(true, 'lead_welcome_v2', 'en', true, array['LEAD_NAME']) ->> 'templateApproved')::boolean),
  'changing an approved template withdraws the approval in the same save');
select test.check((select (set_lead_whatsapp_settings(true, 'lead_welcome_v2', 'en', true, array['LEAD_NAME', 'SALES_PERSON_NAME']) ->> 'templateApproved')::boolean),
  'approving the new template in a later save works');
reset role;
select set_config('request.jwt.claims', '', false);
select test.check((select count(*) >= 3 from audit_logs where action = 'LEAD_WHATSAPP_SETTINGS_CHANGED'), 'settings changes are audited');
select test.check((select count(*) = 0 from lead_whatsapp_dispatches where customer_id = pg_temp.g('before')::uuid), 'switching it on does not message leads assigned before');

-- ---------------------------------------------------------------- who and when
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('tm_a'), 'LW Sales', '9819000002', 'LEAD');
insert into lw select 'sales', id::text from customers where name = 'LW Sales';
select test.check((select count(*) = 1 and bool_and(status = 'PENDING' and recipient_masked = '+91XXXXXX0002' and owner_id = test.id('tm_a'))
                     from lead_whatsapp_dispatches where customer_id = pg_temp.g('sales')::uuid),
  'a lead created for a Sales team member queues exactly one PENDING message, the number masked');
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('lw_ba'), 'LW BA', '9819000003', 'LEAD');
select test.check((select count(*) = 1 from lead_whatsapp_dispatches d join customers c on c.id = d.customer_id where c.name = 'LW BA'), 'a Business Associate''s lead queues one too');
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('sup_plain'), 'LW Support', '9819000004', 'LEAD');
select test.check((select count(*) = 0 from lead_whatsapp_dispatches d join customers c on c.id = d.customer_id where c.name = 'LW Support'), 'a lead given to someone outside Sales queues nothing');
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('dh_wab'), 'LW Head', '9819000005', 'LEAD');
insert into lw select 'head', id::text from customers where name = 'LW Head';
select test.check((select count(*) = 0 from lead_whatsapp_dispatches where customer_id = pg_temp.g('head')::uuid), 'a lead the Department Head still holds waits');
update customers set owner_id = test.id('tm_a') where id = pg_temp.g('head')::uuid;
select test.check((select count(*) = 1 from lead_whatsapp_dispatches where customer_id = pg_temp.g('head')::uuid), 'when the head assigns it to a sales person, the message is queued');
update customers set owner_id = test.id('tm_b') where id = pg_temp.g('sales')::uuid;
update customers set owner_id = test.id('tm_a') where id = pg_temp.g('sales')::uuid;
update customers set name = 'LW Sales', phone = '9819000002' where id = pg_temp.g('sales')::uuid;
select test.check((select count(*) = 1 from lead_whatsapp_dispatches where customer_id = pg_temp.g('sales')::uuid), 'reassigning and saving again add nothing: once per lead, ever');
insert into customers (owner_id, name, email, lifecycle_stage) values (test.id('tm_a'), 'LW No Number', 'lw.nonumber@example.com', 'LEAD');
insert into lw select 'nonum', id::text from customers where name = 'LW No Number';
select test.check((select status = 'SKIPPED' and detail like 'NO_VALID_NUMBER%' and recipient_masked is null from lead_whatsapp_dispatches where customer_id = pg_temp.g('nonum')::uuid),
  'a lead without a valid number is recorded as SKIPPED with the reason');
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('tm_a'), 'LW Customer', '9819000006', 'CUSTOMER');
select test.check((select count(*) = 0 from lead_whatsapp_dispatches d join customers c on c.id = d.customer_id where c.name = 'LW Customer'), 'a customer (not a lead) is not messaged');
select test.check((select count(*) >= 2 from audit_logs where action = 'LEAD_WHATSAPP_QUEUED') and (select count(*) >= 1 from audit_logs where action = 'LEAD_WHATSAPP_SKIPPED'), 'queued and skipped messages are audited');
-- the trigger never blocks saving a lead: a broken settings row is only a warning
alter table lead_whatsapp_settings rename to lead_whatsapp_settings_x;
insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('tm_a'), 'LW Robust', '9819000007', 'LEAD');
alter table lead_whatsapp_settings_x rename to lead_whatsapp_settings;
select test.check((select count(*) = 1 from customers where name = 'LW Robust'), 'a failure inside the message trigger never stops the lead from being saved');

-- ---------------------------------------------------------------- history and send again
set role authenticated;
select test.login('tm_a');
select test.check((select jsonb_array_length(lead_whatsapp_history(pg_temp.g('sales')::uuid)) = 1), 'the sales person sees the message on their lead');
select test.check((select (lead_whatsapp_resend(pg_temp.g('sales')::uuid) ->> 'replayed')::boolean), '"Send again" while it is on its way changes nothing');
select test.must_fail($$select lead_whatsapp_resend(pg_temp.g('nonum')::uuid)$$, 'send again without a valid number says why', 'no valid WhatsApp or mobile number');
select test.login('tm_b');
select test.must_fail($$select lead_whatsapp_history(pg_temp.g('head')::uuid)$$, 'another member cannot read the message of a lead that is not theirs', 'Lead not found');
select test.must_fail($$select lead_whatsapp_claim(5, 'live')$$, 'a logged-in user cannot run the worker', 'permission denied');
select test.must_fail($$select lead_whatsapp_status_update('x', 'READ')$$, 'nor post delivery reports', 'permission denied');
reset role;
select set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------- the worker: dry run, live, retries, delivery reports
delete from lead_whatsapp_dispatches where customer_id not in (pg_temp.g('sales')::uuid, pg_temp.g('head')::uuid, pg_temp.g('nonum')::uuid);
create temp table cl as select lead_whatsapp_claim(10, 'dry_run', 300, timestamptz '2027-02-01 10:00+05:30') as j;
grant all on cl to authenticated, service_role;
select test.check((select jsonb_array_length(j) = 2 from cl), 'dry run: both pending messages are claimed (the skipped one is not)');
select test.check((select bool_and(e ->> 'to' like '+91981900000_' and e #>> '{template,name}' = 'lead_welcome_v2' and e ->> 'salesPersonName' is not null
                                   and e #>> '{template,variables}' = '["LEAD_NAME", "SALES_PERSON_NAME"]')
                     from cl, jsonb_array_elements(j) e), 'each job carries the number, the template, its variables and the current sales person');
select test.check((select e ->> 'salesPersonName' = (select full_name from profiles where id = test.id('tm_a')) and e ->> 'salesPersonPhone' = '9876500002'
                     from cl, jsonb_array_elements(j) e where e ->> 'customerId' = pg_temp.g('sales')::text),
  'the sales person named is the lead''s owner now');
select lead_whatsapp_finish((e ->> 'id')::uuid, 'DRY_RUN', 'Dry run - not sent', null, null, timestamptz '2027-02-01 10:00+05:30') from cl, jsonb_array_elements(j) e;
select test.check((select count(*) = 2 from lead_whatsapp_dispatches where status = 'DRY_RUN'), 'dry run: recorded as DRY_RUN, nothing sent');
select test.must_fail($$select lead_whatsapp_finish((select id from lead_whatsapp_dispatches where status = 'DRY_RUN' limit 1), 'ACCEPTED')$$, 'a dispatch that is not being processed cannot be finished', 'not being processed');

-- live: waits while the template is not approved
update lead_whatsapp_dispatches set status = 'PENDING', attempts = 0, next_attempt_at = timestamptz '2027-02-01 10:00+05:30' where status = 'DRY_RUN';
update lead_whatsapp_settings set template_approved = false;
select test.check((select jsonb_array_length(lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-01 11:00+05:30')) = 0), 'live: nothing is claimed while the template is not approved');
update lead_whatsapp_settings set template_approved = true;
delete from cl;
insert into cl select lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-01 11:00+05:30');
select test.check((select jsonb_array_length(j) = 2 from cl), 'live with an approved template: claimed');
select test.check((select jsonb_array_length(lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-01 11:01+05:30')) = 0), 'a claimed message is not claimed twice');
-- one accepted, one retried
insert into lw select 'acc', e ->> 'id' from cl, jsonb_array_elements(j) e where e ->> 'customerId' = pg_temp.g('sales')::text;
insert into lw select 'ret', e ->> 'id' from cl, jsonb_array_elements(j) e where e ->> 'customerId' = pg_temp.g('head')::text;
select lead_whatsapp_finish(pg_temp.g('acc')::uuid, 'ACCEPTED', 'Wabastore accepted the message', 200, 'wamid.LW1', timestamptz '2027-02-01 11:00+05:30');
select lead_whatsapp_finish(pg_temp.g('ret')::uuid, 'RETRY', 'Wabastore is busy', 503, null, timestamptz '2027-02-01 11:00+05:30');
select test.check((select status = 'ACCEPTED' and provider_ref = 'wamid.LW1' and accepted_at is not null from lead_whatsapp_dispatches where id = pg_temp.g('acc')::uuid), 'accepted: the provider reference is kept');
select test.check((select status = 'RETRY' and next_attempt_at = timestamptz '2027-02-01 11:10+05:30' from lead_whatsapp_dispatches where id = pg_temp.g('ret')::uuid), 'retry: tried again 10 minutes later');
select test.check((select count(*) = 1 from customer_activities where customer_id = pg_temp.g('sales')::uuid and type = 'LEAD_WHATSAPP_ACCEPTED'), 'the lead''s timeline shows the message was sent');
select lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-01 11:10+05:30');
select lead_whatsapp_finish(pg_temp.g('ret')::uuid, 'RETRY', 'busy', 503, null, timestamptz '2027-02-01 11:10+05:30');
select test.check((select next_attempt_at = timestamptz '2027-02-01 11:40+05:30' from lead_whatsapp_dispatches where id = pg_temp.g('ret')::uuid), 'then 30 minutes later');
select lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-01 11:40+05:30');
select lead_whatsapp_finish(pg_temp.g('ret')::uuid, 'RETRY', 'busy', 503, null, timestamptz '2027-02-01 11:40+05:30');
select test.check((select status = 'FAILED' and attempts = 3 from lead_whatsapp_dispatches where id = pg_temp.g('ret')::uuid), 'after the third attempt it is FAILED');
select test.check((select count(*) = 1 from audit_logs where action = 'LEAD_WHATSAPP_FAILED' and entity_id = pg_temp.g('head')::uuid), 'a failed message is audited');

-- delivery reports: forward only
select test.check((select (lead_whatsapp_status_update('wamid.LW1', 'READ') ->> 'status') = 'READ'), 'a READ report moves it to READ');
select test.check((select (lead_whatsapp_status_update('wamid.LW1', 'DELIVERED') ->> 'ignored')::boolean), 'a late DELIVERED never downgrades READ');
select test.check((select (lead_whatsapp_status_update('wamid.LW1', 'FAILED') ->> 'ignored')::boolean), 'nor does a late FAILED');
select test.check((select not (lead_whatsapp_status_update('wamid.unknown', 'READ') ->> 'matched')::boolean), 'an unknown reference matches nothing');

-- an orphaned live attempt is failed, not repeated
update lead_whatsapp_dispatches set status = 'PENDING', attempts = 0, next_attempt_at = timestamptz '2027-02-02 10:00+05:30' where id = pg_temp.g('ret')::uuid;
select lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-02 10:00+05:30');
select lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-02 10:10+05:30');
select test.check((select status = 'FAILED' and detail like '%not recorded%' from lead_whatsapp_dispatches where id = pg_temp.g('ret')::uuid), 'an orphaned live attempt is FAILED, not repeated');

-- send again after a failure
set role authenticated;
select test.login('tm_a');
select test.check((select (lead_whatsapp_resend(pg_temp.g('head')::uuid) #>> '{dispatch,status}') = 'PENDING'), 'the sales person can send a failed message again');
select test.must_fail($$select lead_whatsapp_resend(pg_temp.g('sales')::uuid)$$, 'a message already sent is not sent again', 'already sent');
reset role;
select set_config('request.jwt.claims', '', false);

-- switched off: what is still waiting is skipped, not sent
update lead_whatsapp_settings set enabled = false;
select lead_whatsapp_claim(10, 'live', 300, timestamptz '2027-02-03 10:00+05:30');
select test.check((select status = 'SKIPPED' and detail like '%switched off%' from lead_whatsapp_dispatches where id = pg_temp.g('ret')::uuid), 'switched off: a waiting message is skipped');

-- the settings view for the head shows counts and recent messages
set role authenticated;
select test.login('sa');
select test.check((select (j -> 'counts' ->> 'sent')::int = 1 and jsonb_array_length(j -> 'recent') >= 3 from (select lead_whatsapp_settings_get() j) x), 'the settings show the counts and the recent messages');
reset role;
select set_config('request.jwt.claims', '', false);
update lead_whatsapp_settings set enabled = false, template_name = null, template_approved = false, variables = array['LEAD_NAME', 'SALES_PERSON_NAME'];
\echo '   done'
