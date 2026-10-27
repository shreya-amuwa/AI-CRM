-- =============================================================================
-- A paid invoice for each payment (migration 20261202000100). Runs after paid_invoices_test.sql on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- the suites above re-apply older migrations: put the newest ones back on top of them
\i supabase/migrations/20261112000200_paid_only_invoices.sql
\i supabase/migrations/20261201000100_order_level_gst.sql
\i supabase/migrations/20261202000100_payment_invoices.sql
create temp table pc (name text primary key, id uuid);
create temp table pr (name text primary key, data jsonb);
grant all on pc, pr to authenticated, service_role;

\echo '--- 42. A paid invoice for each payment'
set role authenticated;
select test.login('tm_a');
insert into pc select 'P', create_lead('{"name":"Each Payment","company":"Each Payment Traders","email":"eachpay@example.com","phone":"9820000777","address":"Nanded City, Pune 411068, Maharashtra","leadSource":"Walk-in"}', array['AI_CALLING']);
-- agreed 14 before GST; Accounts chooses 18% -> payable 16.52 -> whole rupees 17
select send_lead_to_accounts((select id from pc where name = 'P'), 14000, null, 'EXCLUSIVE');
select test.login('acc_m');
select accounts_set_order_gst((select id from pc where name = 'P'), 18);
select test.must_fail($$select accounts_issue_payment_invoice((select id from pc where name = 'P'))$$, 'there is no payment with the id of a customer', 'Payment not found');

-- a recorded payment that nobody verified yet has no invoice
select accounts_record_payment((select id from pc where name = 'P'), 'PART', 10000, 'UPI', 'EP-1', null, null, false);
reset role;
create temp table pay1 as select id from customer_payments where customer_id = (select id from pc where name = 'P') and reference = 'EP-1';
grant all on pay1 to authenticated;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_payment_invoice((select id from pay1))$$, 'an unverified payment has no invoice', 'Verify the payment first');
select accounts_verify_payment((select id from pay1));

insert into pr select 'one', accounts_issue_payment_invoice((select id from pay1));
select test.check((select (data ->> 'replayed')::boolean = false and (data ->> 'status') = 'Paid' from pr where name = 'one'), 'the verified part payment gets its own invoice and it is Paid');
select test.check((select (data ->> 'total')::numeric between 9999.99 and 10000 from pr where name = 'one'), 'the invoice is worth the payment (10,000, never more)');
select test.check((accounts_issue_payment_invoice((select id from pay1)) ->> 'replayed')::boolean, 'asking again returns the same invoice');
reset role;
select test.check((select count(*) = 1 from payment_invoices where payment_id = (select id from pay1)), 'one payment, one invoice');
set role authenticated;
select test.login('acc_m');

-- the second payment: the one the old rule refused
select accounts_record_payment((select id from pc where name = 'P'), 'FULL', 6520, 'UPI', 'EP-2', null, null, true);
reset role;
create temp table pay2 as select id from customer_payments where customer_id = (select id from pc where name = 'P') and reference = 'EP-2';
grant all on pay2 to authenticated;
set role authenticated;
select test.login('acc_m');
insert into pr select 'two', accounts_issue_payment_invoice((select id from pay2));
select test.check((select (data ->> 'replayed')::boolean = false and (data ->> 'status') = 'Paid' from pr where name = 'two'), 'the second payment gets its own paid invoice too');
select test.check((select (a ->> 'id') <> (b ->> 'id') from (select (select data from pr where name = 'one') a, (select data from pr where name = 'two') b) x), 'and it is another invoice');
reset role;
select test.check((select sum(total_amount) <= 16520 from generated_invoices where customer_id = (select id from pc where name = 'P')), 'together the invoices never exceed the money received');
select test.check((select count(*) = 2 and bool_and(lifecycle = 'PAID') from generated_invoices where customer_id = (select id from pc where name = 'P')), 'both are in the paid stage (PDF and e-mail follow)');
select test.check((select count(*) = 2 from audit_logs where action = 'INVOICE_PAYMENT_CONFIRMED' and entity_id in (select invoice_id from payment_invoices where customer_id = (select id from pc where name = 'P'))), 'both are audited');

\echo '--- 43. Who can ask for it, and what is refused'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select accounts_issue_payment_invoice((select id from pay1))$$, 'Sales cannot make it', 'Accounts|not found|Not found');
select test.login('acc_m');
select test.check((select count(*) = 2 from jsonb_array_elements(customer_payment_overview((select id from pc where name = 'P')) -> 'payments') p where p -> 'invoice' ->> 'number' is not null),
  'the payments list shows the invoice of each payment');
select test.login('tm_a');
select test.check((select count(*) = 0 from jsonb_array_elements(customer_payment_overview((select id from pc where name = 'P')) -> 'payments') p where p -> 'invoice' is not null and p ->> 'invoice' <> 'null'),
  'Sales does not see the invoices in the payments list');

-- money that is already covered by a manual invoice is not invoiced twice
select test.login('tm_a');
insert into pc select 'Q', create_lead('{"name":"Manual First","company":"Manual First Traders","email":"manualfirst@example.com","phone":"9820000778","address":"Nanded City, Pune 411068, Maharashtra","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from pc where name = 'Q'), 14000, null, 'EXCLUSIVE');
select test.login('acc_m');
select accounts_set_order_gst((select id from pc where name = 'Q'), 18);
insert into pr select 'manual', accounts_issue_invoice(gen_random_uuid(), test.inv_payload((select id from pc where name = 'Q'), 14000));
select accounts_record_payment((select id from pc where name = 'Q'), 'PART', 10000, 'UPI', 'MQ-1', null, null, true);
reset role;
create temp table payq as select id from customer_payments where customer_id = (select id from pc where name = 'Q');
grant all on payq to authenticated;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_payment_invoice((select id from payq))$$, 'a manual invoice that already covers the money leaves nothing to invoice for the payment', 'already covered');

\echo '=== ALL PAYMENT INVOICE TESTS PASSED ==='
