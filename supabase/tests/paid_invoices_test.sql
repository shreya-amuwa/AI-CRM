-- =============================================================================
-- Paid invoices only, and GST decided by Accounts (migration 20261112000100). Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- The suites above re-apply older migrations (which bring back the older invoice functions): apply this one again on top of them.
\i supabase/migrations/20261112000100_paid_only_invoices.sql
create temp table pc (name text primary key, id uuid);
create temp table pr (name text primary key, data jsonb);
create temp table pq (name text primary key, id uuid default gen_random_uuid());
grant all on pc, pr, pq to authenticated, service_role;
insert into pq (name) values ('A'), ('B'), ('A2'), ('X'), ('E');

\echo '--- 38. Paid-only invoices: Sales does not decide GST, the system adds none'
select test.check((select column_default = 'true' from information_schema.columns where table_schema = 'public' and table_name = 'generated_invoices' and column_name = 'paid_only'),
  'from now on every invoice is paid-only');

set role authenticated;
select test.login('tm_a');
insert into pc select 'C', create_lead('{"name":"Paid Only Customer","company":"Paid Only Traders","email":"paidonly@example.com","phone":"9820000555","leadSource":"Walk-in"}', array['AI_CALLING']);
-- the old question is gone: whatever basis an older caller sends is ignored
select send_lead_to_accounts((select id from pc where name = 'C'), 120000, null, 'INCLUSIVE');
reset role;
select test.check((select deal_amount = 120000 and agreed_amount = 120000 and agreed_tax_basis = 'EXCLUSIVE' from customers where id = (select id from pc where name = 'C')),
  'Sales sends 1,20,000: the total payable is 1,20,000 - no GST is added by the system, and the basis Sales sent is ignored');
select test.check(not exists (select 1 from notifications where type = 'PAYMENT_CONFIRMATION_REQUESTED' and (title || body) ilike '%GST%' and entity_id = (select id from pc where name = 'C')),
  'the message to Accounts says nothing about GST');
select test.check(not exists (select 1 from customer_activities where customer_id = (select id from pc where name = 'C') and note ilike '%GST%'), 'nor does the activity log');

set role authenticated;
select test.login('acc_m');
select test.check((select (p -> 'lines' -> 0 -> 'taxRate') = 'null'::jsonb and (p -> 'lines' -> 0 ->> 'baseAmount')::numeric = 120000
                     from (select accounts_invoice_prefill((select id from pc where name = 'C')) p) x),
  'the invoice form starts with NO GST rate (Accounts chooses it) and the agreed 1,20,000 as the amount');
select test.check((accounts_invoice_prefill((select id from pc where name = 'C')) -> 'order' ->> 'totalPayable')::numeric = 120000, 'the order shows no estimated GST');
select test.must_fail($$select accounts_issue_invoice((select id from pq where name = 'X'), jsonb_set(test.inv_payload((select id from pc where name = 'C'), 60000), '{lines,0,taxRate}', '""'))$$,
  'an invoice line without a GST rate is refused', 'GST rate|tax rate');

\echo '--- 39. Paid-only invoices: saving sends nothing, only the paid invoice is made'
-- two invoices for the two halves, with the GST Accounts chose (18% on the first, 12% on the second)
insert into pr select 'A', accounts_issue_invoice((select id from pq where name = 'A'), test.inv_payload((select id from pc where name = 'C'), 60000));
insert into pr select 'B', accounts_issue_invoice((select id from pq where name = 'B'), jsonb_set(test.inv_payload((select id from pc where name = 'C'), 60000), '{lines,0,taxRate}', '12'));
select test.check((select (data ->> 'total')::numeric = 70800 from pr where name = 'A') and (select (data ->> 'total')::numeric = 67200 from pr where name = 'B'),
  'Accounts decides the GST per invoice: 60,000 at 18% = 70,800, 60,000 at 12% = 67,200');
select test.check((select (data -> 'generated' ->> 'paidOnly')::boolean and data -> 'generated' -> 'unpaid' ->> 'pdfStatus' = 'PENDING' and data -> 'generated' -> 'unpaid' ->> 'emailStatus' = 'PENDING'
                          and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'NOT_DUE' from pr where name = 'A'),
  'a saved invoice is paid-only: nothing is stored or sent');
reset role;
select test.check((select deal_amount = 70800 + 67200 from customers where id = (select id from pc where name = 'C')), 'the total payable follows the invoices Accounts made (1,38,000), with no estimate');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_invoice_claim((select (data ->> 'id')::uuid from pr where name = 'A'), 'UNPAID')$$, 'an unpaid invoice cannot be made', 'Unpaid invoices are not sent');
select test.must_fail($$select accounts_invoice_claim((select (data ->> 'id')::uuid from pr where name = 'A'), 'PAID')$$, 'and the paid one only after the payment is confirmed', 'Confirm the payment first');
reset role;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from pr where name = 'A'))$$, 'nothing can be confirmed before a payment is verified', 'No payment is confirmed yet');

-- a part payment is enough for the paid invoice
select accounts_record_payment((select id from pc where name = 'C'), 'PART', 60000, 'UPI', 'PO-UPI-1', null, null, true);
select test.check((select (accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from pr where name = 'A')) ->> 'settled')::boolean), 'after a verified 60,000 part payment the first invoice can be confirmed and sent as PAID (it is 70,800)');
select test.check((select data -> 'generated' ->> 'lifecycle' = 'PAID' and data ->> 'status' = 'Paid' and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'PENDING'
                     from (select invoice_detail((select (data ->> 'id')::uuid from pr where name = 'A')) data) x), 'the invoice is paid and the paid stage is open (PDF and e-mail follow)');
select test.check((select (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'confirmed')::numeric = 60000 and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'balance')::numeric = 78000
                     from (select invoice_detail((select (data ->> 'id')::uuid from pr where name = 'A')) data) x),
  'the order shows what is confirmed (60,000) and what is outstanding (1,38,000 - 60,000 = 78,000)');
reset role;
select test.check((select paid_order_confirmed = 60000 from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from pr where name = 'A')), 'the confirmed amount at that moment is recorded');
set role authenticated;
select test.login('acc_m');
select test.check((select (accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from pr where name = 'A')) ->> 'replayed')::boolean), 'a repeated click changes nothing');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from pr where name = 'B'))$$, 'the second invoice needs NEW money: 60,000 is already used by the first paid invoice', 'already covered');
select accounts_record_payment((select id from pc where name = 'C'), 'PART', 10000, 'UPI', 'PO-UPI-2', null, null, true);
select test.check((select (accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from pr where name = 'B')) ->> 'settled')::boolean), 'once another payment is verified the second invoice can be confirmed too');
reset role;
select test.check((select paid_order_confirmed = 70000 from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from pr where name = 'B')), 'and records 70,000');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_PAYMENT_CONFIRMED' and (metadata ->> 'number') = (select data ->> 'number' from pr where name = 'B')), 'every confirmation is audited');

\echo '--- 40. Paid-only invoices: add-ons and additional invoices keep their own payment rules'
set role authenticated;
select test.login('acc_m');
insert into pr select 'E', accounts_issue_invoice((select id from pq where name = 'E'), test.inv_payload((select id from pc where name = 'C'), 1000, 'ADDITIONAL'));
select test.check((select data -> 'generated' -> 'paymentSummary' ->> 'ledger' = 'INVOICE' and (data -> 'generated' ->> 'paidOnly')::boolean from pr where name = 'E'), 'an additional invoice is paid-only too and has its own payment ledger');
select test.check((select not (accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from pr where name = 'E'), 'UPI', 'ADD-1', null, null, 500) ->> 'settled')::boolean),
  'a part payment recorded on an additional invoice keeps that invoice open (its balance is its own)');

\echo '--- 41. Orders made before the change are recalculated, without touching their invoices'
reset role;
update customers set deal_amount = 141600 where id = (select id from pc where name = 'C');
create temp table before_inv as select count(*) as n, sum(total_amount) as total from generated_invoices where customer_id = (select id from pc where name = 'C');
select private.sync_order_payable((select id from pc where name = 'C'));
select test.check((select deal_amount = 70800 + 67200 from customers where id = (select id from pc where name = 'C')), 'the total payable is the invoices again (no estimate)');
select test.check((select b.n = (select count(*) from generated_invoices where customer_id = (select id from pc where name = 'C')) and b.total = (select sum(total_amount) from generated_invoices where customer_id = (select id from pc where name = 'C')) from before_inv b),
  'the invoices themselves are untouched');

\echo '=== ALL PAID-ONLY INVOICE TESTS PASSED ==='
