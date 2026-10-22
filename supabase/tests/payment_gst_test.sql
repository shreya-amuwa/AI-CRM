-- =============================================================================
-- GST when Accounts records a payment (migration 20261114000200): the accountant types the amount before GST, chooses the rate and
-- the final amount is what is recorded; GST is on top of the agreed amount; the total payable follows; nothing else changes.
-- Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- the suites above re-apply older migrations (which bring back older payment functions): apply this one again on top of them
\i supabase/migrations/20261114000200_payment_gst.sql
create temp table pg (k text primary key, v text);
grant all on pg to authenticated, service_role;
create function pg_temp.g(p_k text) returns uuid language sql stable as $$ select v::uuid from pg where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated, service_role;

\echo '--- 58. Payments with GST'
select test.login('tm_a');
insert into pg select 'C1', create_lead('{"name":"Gst Payer","company":"Gst Payer Co","email":"gst.payer@example.com","phone":"9840000001","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
insert into pg select 'C2', create_lead('{"name":"Gst Older","company":"Gst Older Co","email":"gst.older@example.com","phone":"9840000002","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
select send_lead_to_accounts(pg_temp.g('C1'), 120000, null);
select send_lead_to_accounts(pg_temp.g('C2'), 50000, null);
-- C2 is an older agreement: the amount already includes GST
update customers set agreed_amount = null, agreed_tax_basis = 'INCLUSIVE' where id = pg_temp.g('C2');
select test.check((select deal_amount = 120000 and agreed_amount = 120000 and agreed_tax_basis = 'EXCLUSIVE' from customers where id = pg_temp.g('C1')), 'setup: a 1,20,000 agreement before GST');

select test.login('acc_m');
select test.check((select customer_payment_overview(pg_temp.g('C1')) #>> '{gst,allowed}' = 'true' and (customer_payment_overview(pg_temp.g('C1')) #>> '{gst,taxableBalance}')::numeric = 120000), 'the form may add GST, and 1,20,000 before GST is still to receive');
select test.check((select customer_payment_overview(pg_temp.g('C2')) #>> '{gst,allowed}' = 'false'), 'an agreement that includes GST does not offer it');

-- ---------------------------------------------------------------- 1. part payment: 60,000 + 18% = 70,800
insert into pg select 'P1', accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 60000, 'UPI', 'GST-1', null, null, false, 18)::text;
select test.check((select amount = 70800 and taxable_amount = 60000 and gst_rate = 18 and gst_amount = 10800 and status = 'PENDING' from customer_payments where id = pg_temp.g('P1')),
  'the payment is recorded with the final amount 70,800 = 60,000 + GST 10,800');
select test.check((select deal_amount = 130800 and amount_received = 70800 from customers where id = pg_temp.g('C1')), 'the total payable grows by the GST (1,30,800) and 70,800 is received');
select test.check((select (o ->> 'taxableAmount')::numeric = 60000 and (o ->> 'gstRate')::numeric = 18 and (o ->> 'gstAmount')::numeric = 10800 and (o ->> 'amount')::numeric = 70800
                     from jsonb_array_elements(customer_payment_overview(pg_temp.g('C1')) -> 'payments') o limit 1), 'the overview shows each payment''s split');
select test.check((customer_payment_overview(pg_temp.g('C1')) #>> '{gst,taxableBalance}')::numeric = 60000 and (customer_payment_overview(pg_temp.g('C1')) #>> '{gst,onPayments}')::numeric = 10800,
  'and 60,000 before GST is still to receive');
-- a second part payment with another rate
insert into pg select 'P2', accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 30000, 'CASH', null, null, null, true, 5)::text;
select test.check((select amount = 31500 and gst_amount = 1500 and status = 'VERIFIED' from customer_payments where id = pg_temp.g('P2')), 'a second part payment at 5%: 31,500, verified');
select test.check((select deal_amount = 132300 and amount_received = 102300 and amount_verified = 31500 from customers where id = pg_temp.g('C1')), 'the total payable follows (1,32,300); only the verified part counts as verified');

-- ---------------------------------------------------------------- the checks
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 40000, 'UPI', 'GST-X1', null, null, false, 18)$$, 'more than is left of the agreed amount is refused', 'exceed');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 100.5, 'UPI', 'GST-X2', null, null, false, 18)$$, 'the amount before GST is in whole rupees', 'whole rupees');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 1000, 'UPI', 'GST-X3', null, null, false, 30)$$, 'a GST rate above 28 is refused', 'between 0 and 28');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 1000, 'UPI', 'GST-X4', null, null, false, -1)$$, 'and a negative one', 'between 0 and 28');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 1000, 'UPI', null, null, null, false, 18)$$, 'a UPI payment still needs its reference', 'reference');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 1000, 'UPI', 'GST-X5', now() + interval '3 days', null, false, 18)$$, 'and a date that is not in the future', 'future');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'FULL', 29999, 'UPI', 'GST-X6', null, null, false, 18)$$, 'a full payment must settle exactly', 'must settle');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 30000, 'UPI', 'GST-X7', null, null, false, 18)$$, 'a payment that settles the agreed amount is a full payment', 'full payment');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 1000, 'UPI', 'GST-1', null, null, false, 18)$$, 'the same reference is not recorded twice', 'already recorded');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C2'), 'PART', 1000, 'UPI', 'GST-C2', null, null, false, 18)$$, 'GST cannot be added to an agreement that includes it', 'already includes GST');

-- ---------------------------------------------------------------- 2. the full payment that settles: 30,000 + 18% = 35,400
insert into pg select 'P3', accounts_record_taxed_payment(pg_temp.g('C1'), 'FULL', 30000, 'UPI', 'GST-3', null, null, false, 18)::text;
select test.check((select deal_amount = 137700 and amount_received = 137700 from customers where id = pg_temp.g('C1')),
  'the full payment settles the order: 1,37,700 payable and received (agreed 1,20,000 + GST 17,700)');
select test.check((select sum(taxable_amount) = 120000 and sum(gst_amount) = 17700 and sum(amount) = 137700 from customer_payments where customer_id = pg_temp.g('C1')), 'taxable 1,20,000 and GST 17,700 add up to the agreed amount and the GST of the payments');

-- ---------------------------------------------------------------- 3. an edit changes the GST and the total payable with it
select accounts_update_taxed_payment(pg_temp.g('P3'), 'FULL', 30000, 'UPI', 'GST-3', null, null, 12);
select test.check((select amount = 33600 and gst_amount = 3600 from customer_payments where id = pg_temp.g('P3')), 'editing the rate changes the payment (30,000 + 12% = 33,600)');
select test.check((select deal_amount = 135900 and amount_received = 135900 from customers where id = pg_temp.g('C1')), 'and the total payable follows it down (1,35,900)');
select test.must_fail($$select accounts_update_taxed_payment(pg_temp.g('P2'), 'PART', 30000, 'CASH', null, null, null, 5)$$, 'a verified payment cannot be edited', 'still pending');
select accounts_update_taxed_payment(pg_temp.g('P3'), 'FULL', 30000, 'UPI', 'GST-3', null, null, 18);

-- ---------------------------------------------------------------- 4. rejecting or reversing takes the GST out again
select accounts_reject_payment(pg_temp.g('P3'), 'Not in the bank');
select test.check((select deal_amount = 132300 and amount_received = 102300 from customers where id = pg_temp.g('C1')), 'a rejected payment no longer counts: the total payable is back to 1,32,300');
select accounts_verify_payment(pg_temp.g('P1'), null);
select test.login('dh_acc');
select accounts_reverse_payment(pg_temp.g('P1'), 'Returned to the customer');
select test.login('acc_m');
select test.check((select deal_amount = 121500 and amount_received = 31500 and amount_verified = 31500 from customers where id = pg_temp.g('C1')), 'a reversed payment too (agreed 1,20,000 + GST 1,500 left)');
select test.check((select count(*) = 1 from customer_payments where customer_id = pg_temp.g('C1') and status = 'REVERSED' and gst_amount = 10800), 'the reversed payment keeps its record');

-- ---------------------------------------------------------------- 5. orders that include GST, and callers that send no rate
select test.check((select accounts_record_taxed_payment(pg_temp.g('C2'), 'PART', 10000, 'CASH', null, null, null, false, 0) is not null), 'on an agreement that includes GST, "no GST" records the plain amount');
select test.check((select amount = 10000 and taxable_amount is null and gst_rate is null and gst_amount is null from customer_payments where customer_id = pg_temp.g('C2')), 'with no GST split stored');
select test.check((select accounts_record_taxed_payment(pg_temp.g('C2'), 'PART', 5000, 'CASH', null, null, null, false, null) is not null), 'a caller that sends no rate works as before');
select test.check((select deal_amount = 50000 and amount_received = 15000 from customers where id = pg_temp.g('C2')), 'and the total payable of that order did not change (50,000)');
select test.check((select accounts_record_payment(pg_temp.g('C2'), 'PART', 3000, 'CASH', null, null, null, false) is not null), 'the older function still records a payment');

-- ---------------------------------------------------------------- 6. who may record
select test.login('tm_a');
select test.must_fail($$select accounts_record_taxed_payment(pg_temp.g('C1'), 'PART', 1000, 'CASH', null, null, null, false, 18)$$, 'a Sales member cannot record a payment', 'Only the Accounts department');
select test.must_fail($$select accounts_update_taxed_payment(pg_temp.g('P3'), 'PART', 1000, 'CASH', null, null, null, 18)$$, 'nor edit one', 'Only the Accounts department|not found|NOT_FOUND');
set role anon;
select test.must_fail($$select accounts_record_taxed_payment(gen_random_uuid(), 'PART', 1000, 'CASH', null, null, null, false, 18)$$, 'a visitor cannot', 'permission denied');
reset role;

-- ---------------------------------------------------------------- 7. the reports read the final amounts and the GST of the order
select test.check((select private.order_taxable_ratio('SALE:' || pg_temp.g('C1')) = round(120000.0 / 121500.0, 10)), 'the department income report splits the order''s collected money with the order''s own GST share');
select test.check((select coalesce(sum(amount), 0) = 31500 from private.business_ledger() where order_key = 'SALE:' || pg_temp.g('C1') and status = 'COLLECTED'), 'and collects only the verified final amount (31,500)');

\echo '=== ALL PAYMENT GST TESTS PASSED ==='
