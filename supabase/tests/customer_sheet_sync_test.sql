-- =============================================================================
-- Google Sheet sync of existing customers (migration 20270216000100, docs/CUSTOMER_SHEET_SYNC.md).
-- A Support Team Member connects a sheet; the sheet's rows are saved AS them (service role call with the key's hash), row by row:
-- new customers added, a mobile already in the CRM never added twice (usage only for their own customer, held for someone else's),
-- a new mobile with another customer's e-mail held as a possible duplicate, one wrong row never blocks the others, revoked keys and
-- inactive owners refused, nobody but the service role can run a sync, and the tables are not readable.
-- Reuses the seeded staff (sup_plain, sup_b: Support Team Members; tm_a: Sales). Own mobile numbers 90000082xx.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
reset role;
\i supabase/migrations/20270216000100_customer_sheet_sync.sql
\i supabase/migrations/20270216000100_customer_sheet_sync.sql
\echo '--- Google Sheet sync of existing customers'

delete from customer_sheet_connections where owner_id in (test.id('sup_plain'), test.id('sup_b'), test.id('tm_a'));
delete from customers where phone like '90000082%';
grant usage on schema test to service_role;
grant execute on all functions in schema test to service_role;
create temp table ss (k text primary key, v text);
grant all on ss to authenticated, service_role;
-- two keys (only their hashes reach the database)
insert into ss values ('k1', repeat('a', 64)), ('k2', repeat('b', 64)), ('k3', repeat('c', 64));

-- ---------------------------------------------------------------- who may connect
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select sheet_sync_connection_create((select v from ss where k = 'k3'), 'cccc')$$, 'a Sales member cannot connect a customer sheet', 'Support team');
select test.login('sup_plain');
select test.must_fail($$select sheet_sync_connection_create('not-a-hash', 'xx')$$, 'a key that is not a SHA-256 hash is refused', 'could not be made');
select test.check((sheet_sync_connection_create((select v from ss where k = 'k1'), 'aaaa') ->> 'keyHint') = 'aaaa', 'a Support Team Member connects a sheet');
select test.check((sheet_sync_connection_get() ->> 'status') = 'ACTIVE', 'and sees the connection');
select test.must_fail($$select * from customer_sheet_connections$$, 'the connections table cannot be read directly', 'permission denied');
select test.must_fail($$select * from customer_sheet_sync_runs$$, 'nor the runs', 'permission denied');
select test.must_fail($$select sheet_sync_apply((select v from ss where k = 'k1'), '{}'::jsonb)$$, 'a signed-in user cannot run a sync (service role only)', 'permission denied');
select test.login('sup_b');
select test.check(sheet_sync_connection_get() is null, 'another member does not see it');
select sheet_sync_connection_create((select v from ss where k = 'k2'), 'bbbb');
reset role;

-- a customer of sup_b (someone else's) and one of sup_plain already in the CRM
set role authenticated;
select test.login('sup_b');
select test.check((import_customer_data($j${"customers": [{"row": 3, "mobile": "9000008201", "name": "Other Owner", "businessName": "Other Shop (SS)", "email": "other.ss@example.test"}]}$j$::jsonb, true) ->> 'committed')::boolean,
  'setup: a customer of another member');
select test.login('sup_plain');
select test.check((import_customer_data($j${"customers": [{"row": 3, "mobile": "9000008202", "name": "Mine Already", "businessName": "My Shop (SS)"}]}$j$::jsonb, true) ->> 'committed')::boolean,
  'setup: a customer the member already has');
reset role;

-- ---------------------------------------------------------------- one sync, every kind of row
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
create temp table res as select sheet_sync_apply((select v from ss where k = 'k1'), $j${
  "customers": [
    {"row": 10, "mobile": "9000008210", "name": "New One", "businessName": "New One Traders (SS)", "email": "new.one@example.test"},
    {"row": 12, "mobile": "9000008202", "name": "RENAMED BY SHEET", "businessName": "Renamed (SS)"},
    {"row": 13, "mobile": "9000008201", "name": "Someone Else's", "businessName": "Other (SS)"},
    {"row": 14, "mobile": "9000008214", "name": "Same Mail", "businessName": "Same Mail Co (SS)", "email": "OTHER.SS@example.test"},
    {"row": 15, "mobile": "9000008215", "name": "No Business"},
    {"row": 17, "mobile": "9000008217", "name": "Good Two", "businessName": "Good Two Co (SS)"}
  ],
  "services": [
    {"row": 11, "mobile": "9000008210", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2027-01-01", "status": "Live"},
    {"row": 12, "mobile": "9000008202", "service": "AI Calling", "startDate": "2026-02-01", "renewsOn": "2027-02-01", "status": "Live"},
    {"row": 16, "mobile": "9000008215", "service": "AI Calling", "startDate": "2026-01-01", "renewsOn": "2027-01-01", "status": "Live"},
    {"row": 18, "mobile": "9000008217", "service": "No Such Service", "startDate": "2026-01-01", "status": "Live"}
  ]}$j$::jsonb) as r;
reset role;
select set_config('request.jwt.claims', '', false);
create temp view rr as select (x ->> 'row')::int as row, x ->> 'status' as status, x ->> 'message' as message from res, jsonb_array_elements(r -> 'results') x;
select test.check((select status = 'ADDED' from rr where row = 10) and (select status = 'SAVED' from rr where row = 11), 'a new customer is added with its service');
select test.check((select count(*) = 1 and bool_and(owner_id = test.id('sup_plain')) from customers where phone = '9000008210'), 'once, for the person who connected the sheet');
select test.check((select status = 'UPDATED' and message ilike '%already in the CRM%' from rr where row = 12), 'a mobile the member already has: UPDATED, never added twice');
select test.check((select count(*) = 1 and bool_and(name = 'Mine Already') from customers where phone = '9000008202'), 'the CRM''s details are kept (the sheet updates services and usage only)');
select test.check((select count(*) = 1 from customer_services cs join customers c on c.id = cs.customer_id where c.phone = '9000008202' and cs.service_code = 'AI_CALLING'),
  'its service from the sheet is saved');
select test.check((select status = 'DUPLICATE' and message ilike '%another person or team%' from rr where row = 13), 'another member''s customer is held, not added again');
select test.check((select count(*) = 1 and bool_and(name = 'Other Owner') from customers where phone = '9000008201'), 'and is not touched');
select test.check((select status = 'DUPLICATE' and message ilike '%Possible duplicate%' from rr where row = 14), 'a new mobile with another customer''s e-mail is held as a possible duplicate');
select test.check((select count(*) = 0 from customers where phone = '9000008214'), 'and not added');
select test.check((select status = 'ERROR' and message ilike '%Business Name is required%' from rr where row = 15), 'a row with a problem says what to fix');
select test.check((select status = 'SKIPPED' and message ilike '%row 15%' from rr where row = 16), 'its other rows are not saved and point at it');
select test.check((select status = 'ERROR' and message ilike '%not one of the services%' from rr where row = 18), 'a wrong service is reported on its row');
select test.check((select status = 'SKIPPED' and message ilike '%row 18%' from rr where row = 17) and (select count(*) = 0 from customers where phone = '9000008217'),
  'a new customer whose service row is wrong is not half-saved');
select test.check((select (r -> 'summary' ->> 'added')::int = 1 and (r -> 'summary' ->> 'duplicates')::int = 2 and (r -> 'summary' ->> 'outcome') = 'PARTIAL' from res),
  'the summary counts what happened');

-- ---------------------------------------------------------------- the same rows again never duplicate
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.check((sheet_sync_apply((select v from ss where k = 'k1'), $j${"customers": [{"row": 10, "mobile": "9000008210", "name": "New One", "businessName": "New One Traders (SS)"}]}$j$::jsonb)
                    -> 'results' -> 0 ->> 'status') = 'UPDATED', 'syncing the same customer again updates it');
reset role;
select set_config('request.jwt.claims', '', false);
select test.check((select count(*) = 1 from customers where phone = '9000008210'), 'still one customer');
select test.check((select sync_count = 2 and (last_result ->> 'outcome') = 'OK' from customer_sheet_connections where key_hash = (select v from ss where k = 'k1')), 'every sync is logged on the connection');
select test.check((select count(*) = 2 from customer_sheet_sync_runs where connection_id = (select id from customer_sheet_connections where key_hash = (select v from ss where k = 'k1'))),
  'and in the runs');

-- ---------------------------------------------------------------- keys: replaced, revoked, owner suspended, unknown
set role authenticated;
select test.login('sup_plain');
select sheet_sync_connection_create((select v from ss where k = 'k3'), 'cccc');
reset role;
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.must_fail($$select sheet_sync_apply((select v from ss where k = 'k1'), '{}'::jsonb)$$, 'the old key stops working when a new script is made', 'not valid any more');
select test.must_fail($$select sheet_sync_apply(repeat('d', 64), '{}'::jsonb)$$, 'an unknown key is refused', 'not valid any more');
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set status = 'SUSPENDED' where id = test.id('sup_b');
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.must_fail($$select sheet_sync_apply((select v from ss where k = 'k2'), '{}'::jsonb)$$, 'a sheet connected by someone who was suspended cannot sync', 'can no longer sign in');
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set status = 'ACTIVE' where id = test.id('sup_b');
set role authenticated;
select test.login('sup_plain');
select test.check((sheet_sync_connection_revoke() ->> 'revoked')::boolean, 'the member disconnects the sheet');
select test.check(sheet_sync_connection_get() is null, 'it is gone');
reset role;
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.must_fail($$select sheet_sync_apply((select v from ss where k = 'k3'), '{}'::jsonb)$$, 'a disconnected sheet cannot sync', 'not valid any more');
reset role;
select set_config('request.jwt.claims', '', false);
select test.check((select count(*) >= 2 from audit_logs where action in ('CUSTOMER_SHEET_CONNECTED', 'CUSTOMER_SHEET_DISCONNECTED')), 'connecting and disconnecting are audited');
\echo '   Google Sheet sync tests done'
