-- =============================================================================
-- Migration 20261209000200: Accounts -> Customer-wise Revenue. Purchased, invoiced, collected, pending and outstanding stay apart, a payment
-- is counted once on its own order, and only Accounts (and the Super Admin) can read it. Runs late on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 80. Customer-wise revenue'
reset role;
\i supabase/migrations/20261209000200_customer_revenue_report.sql

create temp table cv (name text primary key, id uuid);
grant all on cv to authenticated, service_role;
set role authenticated;
select test.login('tm_a');
insert into cv select 'a', create_lead('{"name":"Rev Alpha","company":"Rev Alpha Traders","email":"rev.alpha@example.com","phone":"9819950001","leadSource":"Walk-in"}', array['WHATSAPP_API', 'AI_CALLING']);
insert into cv select 'b', create_lead('{"name":"Rev Beta","company":"Rev Beta Stores","email":"rev.beta@example.com","phone":"9819950002","leadSource":"Walk-in"}', array['META_ADS_MANAGEMENT']);
insert into cv select 'c', create_lead('{"name":"Rev Gamma","company":"Rev Gamma Co","email":"rev.gamma@example.com","phone":"9819950003","leadSource":"Walk-in"}', array['META_ADS_MANAGEMENT']);
reset role;
-- A: an order of 10,000 (GST included) with 4,000 verified, 1,000 pending, 500 reversed; two invoices (one cancelled)
update customers set deal_amount = 10000 where id = (select id from cv where name = 'a');
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, paid_at) values
  ((select id from cv where name = 'a'), 'PART', 4000, 'UPI', 'REV-A-1', 'VERIFIED', now()),
  ((select id from cv where name = 'a'), 'PART', 1000, 'UPI', 'REV-A-2', 'PENDING', now()),
  ((select id from cv where name = 'a'), 'PART', 500, 'UPI', 'REV-A-3', 'REVERSED', now());
insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status, customer_id) values
  (test.id('acc_m'), 'REVTEST/A/1', 'Rev Alpha', 'UPLOADED', 11800, 'Pending', (select id from cv where name = 'a')),
  (test.id('acc_m'), 'REVTEST/A/2', 'Rev Alpha', 'UPLOADED', 5000, 'Cancelled', (select id from cv where name = 'a'));
-- B: an order of 20,000 fully paid (verified)
update customers set deal_amount = 20000 where id = (select id from cv where name = 'b');
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, paid_at) values
  ((select id from cv where name = 'b'), 'FULL', 20000, 'BANK_TRANSFER', 'REV-B-1', 'VERIFIED', now());
-- C: no order, only a verified receipt (the gap must be visible, not added to an order)
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, paid_at) values
  ((select id from cv where name = 'c'), 'PART', 3000, 'UPI', 'REV-C-1', 'VERIFIED', now());

\echo '   who may read it'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select accounts_customer_revenue()$$, 'Sales cannot', 'Only the Accounts department');
select test.login('late_verifier');
select test.must_fail($$select accounts_customer_revenue()$$, 'nor the Meta Verifier', 'Only the Accounts department');
select test.login('dh_wab');
select test.must_fail($$select accounts_customer_revenue()$$, 'nor a Department Head of another department', 'Only the Accounts department');
reset role;
set role anon;
select test.must_fail($$select accounts_customer_revenue()$$, 'nor a visitor', 'permission denied');
reset role;

\echo '   the measures are separate and correct'
set role authenticated;
select test.login('acc_m');
create temp table cvr as select accounts_customer_revenue(null, null, null, null, 'Rev ', 'PURCHASED', 'DESC', 1, 25) r;
grant all on cvr to authenticated;
select test.check((select (r -> 'total')::int = 3 from cvr), 'the three customers are listed');
select test.check((select i ->> 'name' = 'Rev Beta' from cvr, jsonb_array_elements(r -> 'items') with ordinality t(i, n) where n = 1), 'sorted by purchase value, the biggest first (Rev Beta, 20,000)');
select test.check((select (i ->> 'purchased')::numeric = 10000 and (i ->> 'collected')::numeric = 4000 and (i ->> 'pending')::numeric = 1000 and (i ->> 'refunded')::numeric = 500
                          and (i ->> 'outstanding')::numeric = 6000 and (i ->> 'orders')::int = 1 and (i ->> 'invoiced')::numeric = 11800 and (i ->> 'invoiceCount')::int = 1
                     from cvr, jsonb_array_elements(r -> 'items') i where i ->> 'name' = 'Rev Alpha'),
  'Alpha: ordered 10,000; collected 4,000 (not the pending 1,000, not the reversed 500); outstanding 6,000; invoiced 11,800 (the cancelled invoice is not counted)');
select test.check((select (i ->> 'purchased')::numeric = 20000 and (i ->> 'collected')::numeric = 20000 and (i ->> 'outstanding')::numeric = 0
                     from cvr, jsonb_array_elements(r -> 'items') i where i ->> 'name' = 'Rev Beta'), 'Beta: fully paid, nothing outstanding');
select test.check((select (i ->> 'purchased')::numeric = 0 and (i ->> 'collected')::numeric = 0 and (i ->> 'receiptsWithoutOrder')::numeric = 3000 and (i ->> 'orders')::int = 0
                     from cvr, jsonb_array_elements(r -> 'items') i where i ->> 'name' = 'Rev Gamma'),
  'Gamma: a verified receipt with no order is shown on its own line, not added to any order and not hidden');
select test.check((select (r -> 'totals' ->> 'purchased')::numeric = 30000 and (r -> 'totals' ->> 'collected')::numeric = 24000 and (r -> 'totals' ->> 'pending')::numeric = 1000
                          and (r -> 'totals' ->> 'outstanding')::numeric = 6000 and (r -> 'totals' ->> 'receiptsWithoutOrder')::numeric = 3000 and (r -> 'totals' ->> 'invoiced')::numeric = 11800
                     from cvr), 'the totals add up exactly (30,000 ordered, 24,000 collected, 1,000 pending, 6,000 outstanding)');
select test.check((select (r -> 'totals' ->> 'collected')::numeric = (select sum((i ->> 'collected')::numeric) from jsonb_array_elements(r -> 'items') i) from cvr), 'the totals are the sum of the rows: nothing counted twice');
select test.check((select (r -> 'top' -> 0 ->> 'name') = 'Rev Beta Stores' and (r -> 'top' -> 0 ->> 'collected')::numeric = 20000 and jsonb_array_length(r -> 'top') = 3 from cvr), 'the top customers are ranked by what they bought, with what they paid next to it');

\echo '   sorting, searching, paging'
select test.check((select (accounts_customer_revenue(null, null, null, null, 'Rev ', 'OUTSTANDING', 'DESC') -> 'items' -> 0 ->> 'name') = 'Rev Alpha'), 'sorted by outstanding: Alpha first');
select test.check((select (accounts_customer_revenue(null, null, null, null, 'Rev ', 'COLLECTED', 'DESC') -> 'items' -> 0 ->> 'name') = 'Rev Beta'), 'sorted by collected: Beta first');
select test.check((select (accounts_customer_revenue(null, null, null, null, 'Rev ', 'NAME', 'ASC') -> 'items' -> 0 ->> 'name') = 'Rev Alpha'), 'sorted by name');
select test.check((select jsonb_array_length(accounts_customer_revenue(null, null, null, null, 'Rev ', 'PURCHASED', 'DESC', 1, 2) -> 'items') = 2 and jsonb_array_length(accounts_customer_revenue(null, null, null, null, 'Rev ', 'PURCHASED', 'DESC', 2, 2) -> 'items') = 1
                          and (accounts_customer_revenue(null, null, null, null, 'Rev ', 'PURCHASED', 'DESC', 2, 2) ->> 'total')::int = 3), 'pages of two: 2 + 1, and the total is still 3');
select test.check((accounts_customer_revenue(null, null, null, null, 'rev beta') ->> 'total')::int = 1 and (accounts_customer_revenue(null, null, null, null, 'nobody-by-this-name') ->> 'total')::int = 0, 'search by name or company');
select test.check((select (accounts_customer_revenue(null, null, 'META_ADS_MANAGEMENT', null, 'Rev ') ->> 'total')::int = 2), 'the service filter keeps the customers that have that service');
select test.check((accounts_customer_revenue(current_date + 30, null, null, null, 'Rev ') ->> 'total')::int = 0, 'a date range with no orders lists no customer (the order-less receipt is only shown without a date filter)');
select test.must_fail($$select accounts_customer_revenue(current_date, current_date - 1)$$, 'an end date before the start is refused', 'end date is before');
select test.must_fail($$select accounts_customer_revenue(null, null, null, null, null, 'SECRET', 'DESC')$$, 'an unknown sort is refused', 'Unknown sort');
select test.must_fail($$select accounts_customer_revenue(null, null, 'NOT_A_SERVICE')$$, 'an unknown service is refused', 'Unknown service');

\echo '   the same figures as the Business Reports'
select test.check((select (business_report_orders(null, null, null, null, null, null, 'Rev Alpha') -> 'items' -> 0 ->> 'billed')::numeric = 10000
                          and (business_report_orders(null, null, null, null, null, null, 'Rev Alpha') -> 'items' -> 0 ->> 'collected')::numeric = 4000), 'the order report says the same for Alpha (billed 10,000, collected 4,000)');
reset role;

