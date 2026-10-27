-- =============================================================================
-- GST belongs to the ORDER (migration 20261201000100): Accounts chooses the rate once, the total payable is the agreed amount plus that GST in whole rupees,
-- payments are the money received (never carry GST), invoices use the order's rate, and the order's outstanding balance is the payable less the confirmed
-- money. Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- the suites above re-apply older migrations (which bring back older payment and invoice functions): apply the newest ones again on top of them
\i supabase/migrations/20261112000200_paid_only_invoices.sql
\i supabase/migrations/20261201000100_order_level_gst.sql
create temp table pg (k text primary key, v text);
grant all on pg to authenticated, service_role;
create function pg_temp.g(p_k text) returns uuid language sql stable as $$ select v::uuid from pg where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated, service_role;
create temp table pq (name text primary key, id uuid default gen_random_uuid());
create temp table pr (name text primary key, data jsonb);
grant all on pq, pr to authenticated, service_role;
insert into pq (name) values ('A'), ('B'), ('X'), ('Y'), ('Z'), ('G1'), ('G2');

\echo '--- 58. GST of the order: chosen once by Accounts, payments are money received'
select test.login('tm_a');
insert into pg select 'C1', create_lead('{"name":"Gst One","company":"Gst One Co","email":"gstflow.one@example.com","phone":"9840000101","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C2', create_lead('{"name":"Gst Two","company":"Gst Two Co","email":"gstflow.two@example.com","phone":"9840000102","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C3', create_lead('{"name":"Gst Three","company":"Gst Three Co","email":"gstflow.three@example.com","phone":"9840000103","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C4', create_lead('{"name":"Gst Four","company":"Gst Four Co","email":"gstflow.four@example.com","phone":"9840000104","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C5', create_lead('{"name":"Gst Five","company":"Gst Five Co","email":"gstflow.five@example.com","phone":"9840000105","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C6', create_lead('{"name":"Gst Older","company":"Gst Older Co","email":"gstflow.older@example.com","phone":"9840000106","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C7', create_lead('{"name":"Gst Legacy","company":"Gst Legacy Co","email":"gstflow.legacy@example.com","phone":"9840000107","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
select send_lead_to_accounts(pg_temp.g('C1'), 120000, null);
select send_lead_to_accounts(pg_temp.g('C2'), 120000, null);
select send_lead_to_accounts(pg_temp.g('C3'), 120000, null);
select send_lead_to_accounts(pg_temp.g('C4'), 14, null);
select send_lead_to_accounts(pg_temp.g('C5'), 50000, null);
select send_lead_to_accounts(pg_temp.g('C6'), 50000, null);
select send_lead_to_accounts(pg_temp.g('C7'), 120000, null);
-- C6 is an older agreement: the amount already includes GST
reset role;
update customers set agreed_amount = null, agreed_tax_basis = 'INCLUSIVE' where id = pg_temp.g('C6');

-- ---------------------------------------------------------------- 1. before the rate is chosen: the agreed amount, nothing added, nothing can be paid or invoiced
set role authenticated;
select test.login('acc_m');
select test.check((select (o #>> '{orderGst,applies}')::boolean and not (o #>> '{orderGst,selected}')::boolean and (o ->> 'dealAmount')::numeric = 120000 and (o #>> '{order,gstRequired}')::boolean
                          and (o #>> '{order,totalPayable}')::numeric = 120000 and (o #>> '{order,taxableTotal}')::numeric = 120000 and (o #>> '{order,gstRate}') is null
                     from (select customer_payment_overview(pg_temp.g('C1')) o) x),
  'before Accounts chooses: the agreed 1,20,000 before GST, no GST added, the rate still to choose');
select test.check((customer_payment_overview(pg_temp.g('C1')) #> '{orderGst,rates}') @> '[{"rate":18}]'::jsonb and jsonb_array_length(customer_payment_overview(pg_temp.g('C1')) #> '{orderGst,rates}') = 5, 'the permitted rates come from the configuration (0, 5, 12, 18, 28)');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C1'), 'PART', 1000, 'CASH', null, null, null, false)$$, 'no payment can be recorded before the GST rate is chosen', 'Choose the GST rate');
select test.must_fail($$select accounts_issue_invoice((select id from pq where name = 'X'), test.inv_payload(pg_temp.g('C1'), 60000))$$, 'nor an invoice made', 'Choose the GST rate');
select test.check((accounts_invoice_prefill(pg_temp.g('C1')) -> 'lines' -> 0 -> 'taxRate') = 'null'::jsonb and accounts_invoice_prefill(pg_temp.g('C1')) ->> 'warnings' ilike '%GST has not been chosen%', 'the invoice form starts without a rate and says why');

-- ---------------------------------------------------------------- 2. Test A: 18% on 1,20,000
select test.check((select (r #>> '{order,totalPayable}')::numeric = 141600 and (r #>> '{order,gstTotal}')::numeric = 21600 and (r #>> '{order,roundOff}')::numeric = 0 and (r ->> 'rate')::numeric = 18
                          and (r #>> '{order,taxableTotal}')::numeric = 120000 and not (r #>> '{order,gstRequired}')::boolean
                     from (select accounts_set_order_gst(pg_temp.g('C1'), 18) r) x),
  'A: 18% on 1,20,000 = GST 21,600, total payable 1,41,600');
reset role;
select test.check((select deal_amount = 141600 and agreed_amount = 120000 and order_gst_rate = 18 and order_gst_set_by = test.id('acc_m') and order_gst_set_at is not null from customers where id = pg_temp.g('C1')),
  'A: saved: the rate and the payable are stored, and the Sales-agreed 1,20,000 is kept as it was');
select test.check((select count(*) = 1 from audit_logs where action = 'ORDER_GST_SET' and entity_id = pg_temp.g('C1') and (metadata ->> 'rate')::numeric = 18 and (metadata ->> 'payable')::numeric = 141600), 'A: the choice is audited');
set role authenticated;
select test.login('acc_m');
select test.check((accounts_set_order_gst(pg_temp.g('C1'), 18) ->> 'unchanged')::boolean, 'choosing the same rate again changes nothing');
select test.check((customer_payment_overview(pg_temp.g('C1')) ->> 'dealAmount')::numeric = 141600, 'and GST is not applied a second time (still 1,41,600)');
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C1'), 13)$$, 'a rate that is not on the list is refused', 'on the list');
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C1'), null)$$, 'so is no rate', 'on the list');
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C6'), 18)$$, 'an agreement that already includes GST has no rate to choose', 'already includes GST');
select test.login('tm_a');
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C1'), 12)$$, 'a Sales member cannot choose it', 'Only the Accounts department');
set role anon;
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C1'), 12)$$, 'nor a visitor', 'permission denied');
reset role;
set role authenticated;
select test.login('acc_m');
select test.check(not exists (select 1 from jsonb_array_elements(accounts_gst_reconciliation()) x where x ->> 'customerId' = pg_temp.g('C1')::text), 'an order made this way is not on the GST reconciliation list');

-- ---------------------------------------------------------------- 3. Test B: full payment 1,41,600
select test.must_fail($$select accounts_record_payment(pg_temp.g('C1'), 'FULL', 120000, 'CASH', null, null, null, false)$$, 'B: a full payment of the pre-GST 1,20,000 is refused (it does not settle the order)', 'must settle everything still to receive \(₹1,41,600\)');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C1'), 'PART', 141601, 'CASH', null, null, null, false)$$, 'B: more than the payable is refused, naming the payable including GST', 'exceed the total payable including GST \(₹1,41,600\)');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C1'), 'PART', 141600, 'CASH', null, null, null, false)$$, 'B: settling the payable is a full payment', 'full payment');
insert into pg select 'P1', accounts_record_payment(pg_temp.g('C1'), 'FULL', 141600, 'UPI', 'GST-FULL-1', null, null, true)::text;
reset role;
select test.check((select amount = 141600 and taxable_amount is null and gst_amount is null and status = 'VERIFIED' from customer_payments where id = pg_temp.g('P1')), 'B: the payment is the money received, 1,41,600, with no GST on it');
set role authenticated;
select test.login('acc_m');
select test.check((select (o ->> 'dealAmount')::numeric = 141600 and (o ->> 'verified')::numeric = 141600 and o ->> 'paymentStatus' = 'FULLY_PAID' from (select customer_payment_overview(pg_temp.g('C1')) o) x), 'B: a verified full payment settles the order and GST was not applied again');
select test.check((customer_payment_overview(pg_temp.g('C1')) #>> '{order,balance}')::numeric = 0 and customer_payment_overview(pg_temp.g('C1')) #>> '{order,state}' = 'FULLY_PAID', 'B: nothing outstanding');

-- ---------------------------------------------------------------- 4. Test C: a part payment against the whole order
select accounts_set_order_gst(pg_temp.g('C2'), 18);
insert into pg select 'P2', accounts_record_payment(pg_temp.g('C2'), 'PART', 60000, 'UPI', 'GST-PART-1', null, null, true)::text;
select test.check((select (o #>> '{order,totalPayable}')::numeric = 141600 and (o #>> '{order,confirmed}')::numeric = 60000 and (o #>> '{order,balance}')::numeric = 81600 and o #>> '{order,state}' = 'PARTIALLY_PAID'
                          and (o ->> 'balance')::numeric = 81600 and (o #>> '{orderGst,locked}')::boolean
                     from (select customer_payment_overview(pg_temp.g('C2')) o) x),
  'C: 60,000 received on 1,41,600: outstanding 81,600, partially paid, no GST on the payment, the rate is now fixed');
select test.check((select (o ->> 'dealAmount')::numeric = 141600 and (o ->> 'verified')::numeric = 60000 from (select customer_payment_overview(pg_temp.g('C2')) o) x), 'C: the order total did not move');
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C2'), 12)$$, 'C: the rate cannot be changed once a payment exists', 'fixed');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C2'), 'PART', 99.5, 'CASH', null, null, null, false)$$, 'C: paise are refused', 'whole rupees');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C2'), 'PART', 1000, 'UPI', 'GST-PART-1', null, null, false)$$, 'C: a reference is not used twice', 'already recorded');

-- ---------------------------------------------------------------- 5. Tests D and E: two invoices of 60,000 at 18%, one payment of 60,000
select accounts_set_order_gst(pg_temp.g('C3'), 18);
select test.must_fail($$select accounts_issue_invoice((select id from pq where name = 'X'), jsonb_set(test.inv_payload(pg_temp.g('C3'), 60000), '{lines,0,taxRate}', '12'))$$,
  'D: an invoice line at another rate than the order''s is refused', 'chosen as 18 percent');
select test.check((accounts_invoice_prefill(pg_temp.g('C3')) -> 'lines' -> 0 ->> 'taxRate')::numeric = 18 and (accounts_invoice_prefill(pg_temp.g('C3')) ->> 'orderGstRate')::numeric = 18, 'D: the invoice form starts with the order''s rate');
insert into pr select 'A', accounts_issue_invoice((select id from pq where name = 'A'), test.inv_payload(pg_temp.g('C3'), 60000));
insert into pr select 'B', accounts_issue_invoice((select id from pq where name = 'B'), test.inv_payload(pg_temp.g('C3'), 60000));
select test.check((select (data ->> 'total')::numeric = 70800 from pr where name = 'A') and (select (data ->> 'total')::numeric = 70800 from pr where name = 'B'), 'D: each invoice: 60,000 + GST 10,800 = 70,800');
reset role;
select test.check((select sum(subtotal) = 120000 and sum(total_gst) = 21600 and sum(total_amount) = 141600 from generated_invoices where customer_id = pg_temp.g('C3')), 'D: together 1,20,000 taxable + GST 21,600 = 1,41,600');
select test.check((select deal_amount = 141600 from customers where id = pg_temp.g('C3')), 'D: the order total did not change (no second GST layer)');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_invoice((select id from pq where name = 'Y'), test.inv_payload(pg_temp.g('C3'), 1000))$$, 'D: the agreed taxable value cannot be invoiced twice over (overbilling check kept)', 'before GST but only');
select accounts_record_payment(pg_temp.g('C3'), 'PART', 60000, 'UPI', 'GST-INV-1', null, null, true);
select test.check((select (o #>> '{order,invoices,0,allocated}')::numeric = 60000 and (o #>> '{order,invoices,0,balance}')::numeric = 10800
                          and (o #>> '{order,invoices,1,allocated}')::numeric = 0 and (o #>> '{order,invoices,1,balance}')::numeric = 70800
                          and (o #>> '{order,balance}')::numeric = 81600
                     from (select customer_payment_overview(pg_temp.g('C3')) o) x),
  'E: 60,000 against the first invoice: its balance 10,800, the second 70,800, the order outstanding 81,600');
select test.check((select (s ->> 'confirmed')::numeric = 60000 and (s ->> 'balance')::numeric = 10800 and (s #>> '{order,balance}')::numeric = 81600
                     from (select invoice_detail((select (data ->> 'id')::uuid from pr where name = 'A')) -> 'generated' -> 'paymentSummary' s) x),
  'E: the invoice itself shows its own balance next to the order''s');

-- ---------------------------------------------------------------- 6. Test F: the 14-rupee example
select test.check((select (r #>> '{order,totalPayable}')::numeric = 17 and (r #>> '{order,gstTotal}')::numeric = 2.52 and (r #>> '{order,roundOff}')::numeric = 0.48 and (r #>> '{order,taxableTotal}')::numeric = 14
                     from (select accounts_set_order_gst(pg_temp.g('C4'), 18) r) x),
  'F: 14 + 18% = 16.52 is payable as 17 in whole rupees (GST 2.52, round-off 0.48)');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C4'), 'FULL', 16.52, 'CASH', null, null, null, false)$$, 'F: 16.52 is refused: whole rupees', 'whole rupees');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C4'), 'PART', 18, 'CASH', null, null, null, false)$$, 'F: 18 is refused against the payable 17, not against 14', 'total payable including GST \(₹17\)');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C4'), 'FULL', 14, 'CASH', null, null, null, false)$$, 'F: 14 (the pre-GST value) is not a full payment', 'everything still to receive \(₹17\)');
select test.check((select customer_payment_overview(pg_temp.g('C4')) #>> '{order,balance}' = '17.00'), 'F: the balance shown is 17');
insert into pg select 'P4', accounts_record_payment(pg_temp.g('C4'), 'FULL', 17, 'CASH', null, null, null, true)::text;
select test.check((select o ->> 'paymentStatus' = 'FULLY_PAID' and (o ->> 'dealAmount')::numeric = 17 and (o ->> 'verified')::numeric = 17 from (select customer_payment_overview(pg_temp.g('C4')) o) x), 'F: 17 settles it');

-- ---------------------------------------------------------------- 7. Test G: the choice persists and is not applied again
select accounts_set_order_gst(pg_temp.g('C5'), 12);
select test.check((customer_payment_overview(pg_temp.g('C5')) ->> 'dealAmount')::numeric = 56000 and (customer_payment_overview(pg_temp.g('C5')) #>> '{orderGst,rate}')::numeric = 12, 'G: 12% on 50,000 = 56,000');
select test.check((select (o #>> '{orderGst,rate}')::numeric = 12 and (o #>> '{order,totalPayable}')::numeric = 56000 and (o #>> '{order,gstRate}')::numeric = 12 from (select customer_payment_overview(pg_temp.g('C5')) o) x),
  'G: reopening the record shows the same rate and total');
select test.check((accounts_invoice_prefill(pg_temp.g('C5')) -> 'lines' -> 0 ->> 'taxRate')::numeric = 12 and (accounts_invoice_prefill(pg_temp.g('C5')) -> 'order' ->> 'totalPayable')::numeric = 56000, 'G: the invoice starts from the saved rate and total');
select test.must_fail($$select accounts_issue_invoice((select id from pq where name = 'Z'), test.inv_payload(pg_temp.g('C5'), 50000))$$, 'G: an invoice at 18% is refused for a 12% order', 'chosen as 12 percent');
insert into pr select 'G', accounts_issue_invoice((select id from pq where name = 'G1'), jsonb_set(test.inv_payload(pg_temp.g('C5'), 50000), '{lines,0,taxRate}', '12'));
select test.check((select (data ->> 'total')::numeric = 56000 from pr where name = 'G'), 'G: the invoice uses 12% on 50,000 = 56,000');
reset role;
select test.check((select deal_amount = 56000 from customers where id = pg_temp.g('C5')), 'G: and the order total is still 56,000 (not taxed again)');
set role authenticated;
select test.login('acc_m');

-- ---------------------------------------------------------------- 8. Test H: pending and rejected money is not confirmed money
insert into pg select 'P5', accounts_record_payment(pg_temp.g('C5'), 'PART', 20000, 'UPI', 'GST-PEND-1', null, null, false)::text;
select test.check((select (o #>> '{order,confirmed}')::numeric = 0 and (o #>> '{order,pending}')::numeric = 20000 and (o #>> '{order,balance}')::numeric = 56000 and o ->> 'balance' = '56000.00'
                     from (select customer_payment_overview(pg_temp.g('C5')) o) x),
  'H: a pending 20,000 is not confirmed: the outstanding balance stays 56,000');
select accounts_reject_payment(pg_temp.g('P5'), 'Not in the bank');
select test.check((select (o #>> '{order,pending}')::numeric = 0 and (o #>> '{order,balance}')::numeric = 56000 and (o ->> 'recorded')::numeric = 0
                     from (select customer_payment_overview(pg_temp.g('C5')) o) x),
  'H: a rejected payment counts for nothing');

-- ---------------------------------------------------------------- 9. Test I: who may do what
select test.login('tm_a');
select test.must_fail($$select accounts_record_payment(pg_temp.g('C5'), 'PART', 1000, 'CASH', null, null, null, false)$$, 'I: a Sales member cannot record a payment', 'Only the Accounts department');
select test.must_fail($$select accounts_verify_payment(pg_temp.g('P2'), null)$$, 'I: nor verify one', 'Only the Accounts department|not found|NOT_FOUND|already');
select test.must_fail($$select accounts_gst_reconciliation()$$, 'I: nor read the reconciliation list', 'Only the Accounts department');
select test.must_fail($$select * from set_config('x', '1', false) where accounts_record_taxed_payment(pg_temp.g('C5'), 'PART', 1000, 'CASH', null, null, null, false, 18) is not null$$,
  'I: the retired per-payment GST function is gone', 'does not exist');
set role anon;
select test.must_fail($$select accounts_record_payment(gen_random_uuid(), 'PART', 1000, 'CASH', null, null, null, false)$$, 'I: a visitor cannot record a payment', 'permission denied');
reset role;
set role authenticated;
select test.login('acc_m');

-- ---------------------------------------------------------------- 10. an agreement that includes GST is unchanged
select test.check((select (o #>> '{orderGst,applies}')::boolean = false and (o ->> 'dealAmount')::numeric = 50000 from (select customer_payment_overview(pg_temp.g('C6')) o) x), 'an older agreement that includes GST has no GST to choose');
insert into pg select 'P6', accounts_record_payment(pg_temp.g('C6'), 'PART', 20000, 'CASH', null, null, null, true)::text;
select test.check((select (o #>> '{order,balance}')::numeric = 30000 from (select customer_payment_overview(pg_temp.g('C6')) o) x), 'and its payments work as before (50,000 - 20,000 = 30,000)');

-- ---------------------------------------------------------------- 11. an order from before (GST on its payments): untouched, listed, and its first choice must agree with what is recorded
reset role;
update customers set order_gst_rate = null where id = pg_temp.g('C7');
insert into customer_payments (customer_id, payment_type, amount, taxable_amount, gst_rate, gst_amount, method, reference, paid_at, status, source, recorded_by)
  values (pg_temp.g('C7'), 'PART', 70800, 60000, 18, 10800, 'UPI', 'OLD-GST-1', now(), 'VERIFIED', 'ACCOUNTS', test.id('acc_m'));
update customers set deal_amount = 130800 where id = pg_temp.g('C7');
select private.sync_payment_totals(pg_temp.g('C7'));
select test.check((select deal_amount = 130800 and amount_received = 70800 from customers where id = pg_temp.g('C7')), 'an order with GST on a payment keeps its total exactly as it was (1,30,800): nothing is recalculated silently');
set role authenticated;
select test.login('acc_m');
select test.check((select exists (select 1 from jsonb_array_elements(accounts_gst_reconciliation()) x where x ->> 'customerId' = pg_temp.g('C7')::text and (x -> 'reasons')::text ilike '%individual payments%')), 'it is listed for a person to reconcile');
select test.check((select not (o #>> '{order,gstRequired}')::boolean and (o #>> '{orderGst,legacy}')::boolean from (select customer_payment_overview(pg_temp.g('C7')) o) x), 'it is not blocked on a missing rate (it is an older order)');
select test.must_fail($$select accounts_set_order_gst(pg_temp.g('C7'), 12)$$, 'a rate that contradicts the recorded 18% is refused', 'different GST rate');
select test.check((select (r #>> '{order,totalPayable}')::numeric = 141600 from (select accounts_set_order_gst(pg_temp.g('C7'), 18) r) x), 'the same rate (18%) can be chosen: the order is then worked out the new way (1,41,600)');
select test.check((select (o #>> '{order,balance}')::numeric = 70800 from (select customer_payment_overview(pg_temp.g('C7')) o) x), 'and 70,800 is outstanding after the 70,800 received');

-- ---------------------------------------------------------------- 12. the reports still read the money received
reset role;
select test.check((select coalesce(sum(amount), 0) = 141600 from private.business_ledger() where order_key = 'SALE:' || pg_temp.g('C1') and status = 'COLLECTED'), 'the income report collects the verified money of the order');
select test.check((select private.order_taxable_ratio('SALE:' || pg_temp.g('C1')) = round(120000.0 / 141600.0, 10)), 'and splits it into taxable value and GST by the order''s own figures');
\echo '=== ALL PAYMENT GST TESTS PASSED ==='
