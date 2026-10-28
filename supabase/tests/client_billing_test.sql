-- =============================================================================
-- Client dashboard: what the client owes per order (migration 20261206000100). Runs late (same database): reuses the customers of the
-- provisioning / progress suites - "Meta One Traders" (client login cg_meta) and "Prov One Co" (client login p1_orphan).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 74. Client billing: the outstanding balance'
reset role;
\i supabase/migrations/20261206000100_client_billing.sql

create temp table cb (name text primary key, id uuid);
grant all on cb to authenticated, service_role;
insert into cb select 'meta', id from customers where company = 'Meta One Traders';
insert into cb select 'direct', id from customers where company = 'Prov One Co';
select test.check((select count(*) = 2 from cb), 'the customers of the earlier suites are there');

-- start from a clean money slate for both customers: no payments, no invoices, an order payable of Rs 70,800 incl. GST for the first
delete from customer_payments where customer_id in (select id from cb);
delete from generated_invoices where customer_id in (select id from cb);
delete from client_notifications where customer_id in (select id from cb) and type in ('PAYMENT_RECEIVED', 'PAYMENT_VERIFIED', 'PAYMENT_UPDATED', 'ORDER_TOTAL_UPDATED');
delete from addon_payments where customer_id in (select id from cb);
delete from addon_requests where customer_id in (select id from cb);
delete from member_invoices where invoice_number = 'CB-ADD-1';
drop table if exists cb_n;
update customers set agreed_amount = null, agreed_tax_basis = 'INCLUSIVE', order_gst_rate = null, deal_amount = 70800, amount_received = 0, amount_verified = 0
  where id = (select id from cb where name = 'meta');
update customers set agreed_amount = null, agreed_tax_basis = 'INCLUSIVE', order_gst_rate = null, deal_amount = 5900, amount_received = 0, amount_verified = 0
  where id = (select id from cb where name = 'direct');

\echo '   an order with nothing paid: the whole amount incl. GST is outstanding'
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'totalPayable')::numeric = 70800 and (client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 70800
                  and (client_billing() -> 'orders' -> 0 ->> 'state') = 'UNPAID' and (client_billing() -> 'totals' ->> 'outstanding')::numeric = 70800,
  'unpaid: payable 70,800, balance 70,800, nothing confirmed');
select test.check((client_billing() -> 'orders' -> 0 ->> 'notYetInvoiced')::numeric = 70800 and jsonb_array_length(client_billing() -> 'orders' -> 0 -> 'invoices') = 0,
  'an order with no invoice yet still shows what is owed (the amount no invoice covers is visible)');

\echo '   a recorded but unverified payment does not reduce the balance'
reset role;
insert into customer_payments (customer_id, payment_type, amount, method, reference, status) select id, 'PART', 20000, 'UPI', 'CB-UTR-1', 'PENDING' from cb where name = 'meta';
select private.sync_payment_totals((select id from cb where name = 'meta'));
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'pending')::numeric = 20000 and (client_billing() -> 'orders' -> 0 ->> 'confirmed')::numeric = 0
                  and (client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 70800 and (client_billing() -> 'orders' -> 0 ->> 'state') = 'UNPAID',
  'pending: 20,000 awaiting verification, balance still 70,800');
reset role;
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cb where name = 'meta') and type = 'PAYMENT_RECEIVED'), 'the client is told once that a payment was recorded');

\echo '   verified: the balance falls by exactly that payment, and the dashboard is told'
update customer_payments set status = 'VERIFIED', verified_at = now() where reference = 'CB-UTR-1';
select private.sync_payment_totals((select id from cb where name = 'meta'));
select private.sync_payment_totals((select id from cb where name = 'meta'));
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cb where name = 'meta') and type = 'PAYMENT_VERIFIED'), 'verified: one notification, however often the totals are recalculated');
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'confirmed')::numeric = 20000 and (client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 50800
                  and (client_billing() -> 'orders' -> 0 ->> 'state') = 'PARTIALLY_PAID' and (client_billing() -> 'totals' ->> 'outstanding')::numeric = 50800,
  '70,800 - 20,000 = 50,800 outstanding, partially paid');

\echo '   another customer''s payment is never deducted, and never shown'
reset role;
insert into customer_payments (customer_id, payment_type, amount, method, reference, status) select id, 'PART', 2000, 'CASH', null, 'VERIFIED' from cb where name = 'direct';
select private.sync_payment_totals((select id from cb where name = 'direct'));
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 50800 and jsonb_array_length(client_billing() -> 'orders') = 1, 'the first client''s balance is unchanged by the other client''s payment');
select test.login('p1_orphan');
select test.check((client_billing() -> 'orders' -> 0 ->> 'totalPayable')::numeric = 5900 and (client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 3900
                  and (client_billing() -> 'totals' ->> 'payable')::numeric = 5900, 'the other client sees only their own order: 5,900 - 2,000 = 3,900');
select test.check(client_billing()::text !~* 'CB-UTR-1|70800|50800|Meta One|note|recorded_by|verified_by|status_reason', 'no other customer''s figures, references, notes or staff are in the answer');

\echo '   a rejected or reversed payment is recalculated, and the client is told'
reset role;
update customer_payments set status = 'REVERSED', status_reason = 'bounced' where reference = 'CB-UTR-1';
select private.sync_payment_totals((select id from cb where name = 'meta'));
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cb where name = 'meta') and type = 'PAYMENT_UPDATED'), 'a reversal tells the client once');
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 70800 and (client_billing() -> 'orders' -> 0 ->> 'state') = 'UNPAID', 'the reversed payment no longer counts: balance back to 70,800');
select test.check(client_billing()::text !~* 'bounced', 'the internal reason is not shown to the client');

\echo '   fully paid in two instalments: nothing outstanding'
reset role;
insert into customer_payments (customer_id, payment_type, amount, method, reference, status) select id, 'PART', 30000, 'UPI', 'CB-UTR-2', 'VERIFIED' from cb where name = 'meta';
insert into customer_payments (customer_id, payment_type, amount, method, reference, status) select id, 'FULL', 40800, 'UPI', 'CB-UTR-3', 'VERIFIED' from cb where name = 'meta';
select private.sync_payment_totals((select id from cb where name = 'meta'));
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'confirmed')::numeric = 70800 and (client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 0
                  and (client_billing() -> 'orders' -> 0 ->> 'state') = 'FULLY_PAID' and (client_billing() -> 'totals' ->> 'outstanding')::numeric = 0, 'two verified payments settle the order: balance 0, fully paid');

\echo '   changing the order total updates the balance and tells the client once'
reset role;
create temp table cb_n (n int);
grant all on cb_n to authenticated, service_role;
insert into cb_n select count(*) from client_notifications where customer_id = (select id from cb where name = 'meta') and type = 'ORDER_TOTAL_UPDATED';
update customers set deal_amount = 70800 where id = (select id from cb where name = 'meta');
select test.check((select count(*) = (select n from cb_n) from client_notifications where customer_id = (select id from cb where name = 'meta') and type = 'ORDER_TOTAL_UPDATED'), 'an unchanged total tells nobody anything');
update customers set deal_amount = 82600 where id = (select id from cb where name = 'meta');
update customers set deal_amount = 82600 where id = (select id from cb where name = 'meta');
select test.check((select count(*) = (select n from cb_n) + 1 from client_notifications where customer_id = (select id from cb where name = 'meta') and type = 'ORDER_TOTAL_UPDATED'), 'a new total is announced once');
set role authenticated;
select test.login('cg_meta');
select test.check((client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 11800 and (client_billing() -> 'orders' -> 0 ->> 'state') = 'PARTIALLY_PAID', 'the extra 11,800 is owed (82,600 - 70,800)');

\echo '   an order whose GST rate Accounts has not chosen: no invented balance'
reset role;
update customers set deal_amount = 60000, agreed_amount = 60000, agreed_tax_basis = 'EXCLUSIVE', order_gst_rate = null, amount_received = 0, amount_verified = 0 where id = (select id from cb where name = 'direct');
delete from customer_payments where customer_id = (select id from cb where name = 'direct');
set role authenticated;
select test.login('p1_orphan');
select test.check((client_billing() -> 'orders' -> 0 ->> 'gstPending')::boolean and (client_billing() -> 'totals' ->> 'outstanding')::numeric = 0 and (client_billing() -> 'totals' ->> 'payable')::numeric = 0,
  'GST not chosen yet: flagged "being confirmed" and left out of the totals');

\echo '   an add-on order is a separate order with its own payments'
reset role;
insert into member_invoices (owner_id, invoice_number, customer_name, customer_id, amount, status, kind, issue_date, due_date)
  select (select id from profiles limit 1), 'CB-ADD-1', 'Meta One Traders', id, 5900, 'Pending', 'ADDON', '2026-12-01', '2026-12-10' from cb where name = 'meta';
insert into addon_requests (customer_id, status, subtotal, total, invoice_id)
  select id, 'INVOICE_GENERATED', 5000, 5900, (select i.id from member_invoices i where i.invoice_number = 'CB-ADD-1') from cb where name = 'meta';
insert into addon_request_items (request_id, name, quantity, unit_price, line_total)
  select r.id, 'Extra campaign', 1, 5000, 5900 from addon_requests r where r.customer_id = (select id from cb where name = 'meta');
insert into addon_payments (request_id, customer_id, amount, method, reference, status)
  select r.id, r.customer_id, 1000, 'UPI', 'CB-ADD-PAY', 'VERIFIED' from addon_requests r where r.customer_id = (select id from cb where name = 'meta');
set role authenticated;
select test.login('cg_meta');
select test.check(jsonb_array_length(client_billing() -> 'orders') = 2 and (client_billing() -> 'orders' -> 1 ->> 'kind') = 'ADDON'
                  and (client_billing() -> 'orders' -> 1 ->> 'totalPayable')::numeric = 5900 and (client_billing() -> 'orders' -> 1 ->> 'balance')::numeric = 4900,
  'the add-on order shows its own payable, its own payments and its own balance');
select test.check((client_billing() -> 'orders' -> 0 ->> 'balance')::numeric = 11800, 'and the add-on payment is not deducted from the main order');
select test.check((client_billing() -> 'totals' ->> 'outstanding')::numeric = 16700 and (client_billing() -> 'totals' ->> 'payable')::numeric = 88500,
  'the totals add the orders up: 11,800 + 4,900 = 16,700');

\echo '   who may ask'
select test.login('acc_m');
select test.must_fail($$select client_billing()$$, 'an employee has no client billing', '');
reset role;
set role anon;
select test.must_fail($$select client_billing()$$, 'a visitor has no client billing', '');
reset role;
