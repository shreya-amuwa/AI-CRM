-- =============================================================================
-- A paid invoice for each payment: billing details, cancelling a wrong invoice, invoice WhatsApp on by default
-- (migration 20261207000100). Runs after payment_invoices_test.sql on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- the suites above re-apply older migrations: put this one back on top
\i supabase/migrations/20261207000100_payment_invoice_billing_cancel_whatsapp_on.sql
create temp table bc (name text primary key, id uuid);
create temp table br (name text primary key, data jsonb);
create temp table bpay (name text primary key, id uuid);
grant all on bc, br, bpay to authenticated, service_role;

\echo '--- 44. A customer without a billing address: the invoice of each payment asks for it, once'
set role authenticated;
select test.login('tm_a');
-- the lead is made quickly: no address, no state
insert into bc select 'B', create_lead('{"name":"No Address","company":"No Address Traders","email":"noaddress@example.com","phone":"9820000881","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from bc where name = 'B'), 120000, null);
select test.login('acc_m');
select accounts_set_order_gst((select id from bc where name = 'B'), 18);
select accounts_record_payment((select id from bc where name = 'B'), 'PART', 70800, 'UPI', 'BL-1', null, null, true);
select accounts_record_payment((select id from bc where name = 'B'), 'FULL', 70800, 'UPI', 'BL-2', null, null, true);
reset role;
insert into bpay select 'B1', id from customer_payments where customer_id = (select id from bc where name = 'B') and reference = 'BL-1';
insert into bpay select 'B2', id from customer_payments where customer_id = (select id from bc where name = 'B') and reference = 'BL-2';
set role authenticated;
select test.login('acc_m');

select test.check((accounts_payment_invoice_billing((select id from bpay where name = 'B1')) -> 'missing') @> '["address","state"]'::jsonb,
  'before the click the screen is told that the address and the state are missing');
select test.must_fail($$select accounts_issue_payment_invoice((select id from bpay where name = 'B1'))$$, 'without them the invoice is refused with a message that says what to enter', 'billing address and state');
select test.must_fail($$select accounts_issue_payment_invoice_billed((select id from bpay where name = 'B1'), '{"address":"Nanded City, Pune 411068"}')$$, 'an address alone is not enough: the state decides the tax', 'billing state');
select test.must_fail($$select accounts_issue_payment_invoice_billed((select id from bpay where name = 'B1'), '{"address":"Nanded City, Pune 411068","stateCode":"99"}')$$, 'an unknown state is refused', 'billing state');
select test.admin_check($q$select count(*) = 0 from payment_invoices where customer_id = (select id from bc where name = 'B')$q$, 'the refusals made no invoice');

insert into br select 'B1', accounts_issue_payment_invoice_billed((select id from bpay where name = 'B1'), '{"businessName":"No Address Traders","address":"Nanded City, Pune 411068, Maharashtra","stateCode":"27"}');
select test.check((select (data ->> 'replayed')::boolean = false and data ->> 'status' = 'Paid' and (data ->> 'total')::numeric = 70800 from br where name = 'B1'),
  'with the details the first 70,800 payment gets its own paid invoice of 70,800');
select test.check((accounts_issue_payment_invoice((select id from bpay where name = 'B1')) ->> 'replayed')::boolean, 'asking again returns the same invoice');
select test.check((accounts_payment_invoice_billing((select id from bpay where name = 'B2')) -> 'missing') = '[]'::jsonb, 'for the next payment nothing is missing any more: the customer''s last invoice supplies the details');
insert into br select 'B2', accounts_issue_payment_invoice((select id from bpay where name = 'B2'));
select test.check((select (data ->> 'replayed')::boolean = false and data ->> 'status' = 'Paid' and (data ->> 'total')::numeric = 70800 from br where name = 'B2'), 'the second 70,800 payment gets its own invoice with no more questions');
select test.check((select (a ->> 'id') <> (b ->> 'id') from (select (select data from br where name = 'B1') a, (select data from br where name = 'B2') b) x), 'and it is another invoice');
select test.check((customer_payment_overview((select id from bc where name = 'B')) -> 'order' ->> 'invoicedTotal')::numeric = 141600
               and (customer_payment_overview((select id from bc where name = 'B')) -> 'order' ->> 'balance')::numeric = 0
               and (customer_payment_overview((select id from bc where name = 'B')) ->> 'dealAmount')::numeric = 141600, 'the two invoices are the order: 1,41,600 invoiced, nothing outstanding, the payable unchanged');
reset role;
select test.check((select address is null from customers where id = (select id from bc where name = 'B')), 'the customer record itself was not changed');
select test.check((select count(*) = 2 and bool_and(customer_state_code = '27' and tax_treatment = 'INTRA_STATE' and cgst_amount = 5400 and sgst_amount = 5400) from generated_invoices where customer_id = (select id from bc where name = 'B')),
  'both invoices carry the state and CGST + SGST (Maharashtra): 5,400 + 5,400 on 60,000');

-- another state: IGST
set role authenticated;
select test.login('tm_a');
insert into bc select 'C', create_lead('{"name":"Other State","company":"Other State Traders","email":"otherstate@example.com","phone":"9820000882","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from bc where name = 'C'), 10000, null);
select test.login('acc_m');
select accounts_set_order_gst((select id from bc where name = 'C'), 18);
select accounts_record_payment((select id from bc where name = 'C'), 'FULL', 11800, 'CASH', null, null, null, true);
reset role;
insert into bpay select 'C1', id from customer_payments where customer_id = (select id from bc where name = 'C');
set role authenticated;
select test.login('acc_m');
insert into br select 'C1', accounts_issue_payment_invoice_billed((select id from bpay where name = 'C1'), '{"address":"Satellite, Ahmedabad 380015","stateCode":"24","gstin":"24AAACC1206D1ZM"}');
reset role;
select test.check((select tax_treatment = 'INTER_STATE' and igst_amount = 1800 and cgst_amount = 0 and customer_state_code = '24' and customer_gstin = '24AAACC1206D1ZM' from generated_invoices where customer_id = (select id from bc where name = 'C')),
  'a customer in another state is billed IGST (1,800 on 10,000) and the GSTIN typed with the click is on the invoice');

\echo '--- 45. An invoice made by mistake for the whole amount: cancelled, and every payment is invoiced'
set role authenticated;
select test.login('tm_a');
insert into bc select 'D', create_lead('{"name":"Whole First","company":"Whole First Traders","email":"wholefirst@example.com","phone":"9820000883","address":"Nanded City, Pune 411068, Maharashtra","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from bc where name = 'D'), 120000, null);
select test.login('acc_m');
select accounts_set_order_gst((select id from bc where name = 'D'), 18);
select accounts_record_payment((select id from bc where name = 'D'), 'PART', 70800, 'UPI', 'WF-1', null, null, true);
-- the whole order invoiced by hand (the way out when the payment invoice could not be made), marked paid by the first payment
insert into br select 'whole', accounts_issue_invoice(gen_random_uuid(), test.inv_payload((select id from bc where name = 'D'), 120000));
select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from br where name = 'whole'));
select accounts_record_payment((select id from bc where name = 'D'), 'FULL', 70800, 'UPI', 'WF-2', null, null, true);
reset role;
insert into bpay select 'D1', id from customer_payments where customer_id = (select id from bc where name = 'D') and reference = 'WF-1';
insert into bpay select 'D2', id from customer_payments where customer_id = (select id from bc where name = 'D') and reference = 'WF-2';
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_payment_invoice((select id from bpay where name = 'D1'))$$, 'the whole-order invoice covers the money: no second invoice on top of it (that would bill it twice)', 'already covered');

select test.must_fail($$select accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'whole'), 'Made by mistake for the whole amount')$$, 'an Accounts member cannot cancel an invoice', 'team lead or head');
select test.login('tm_a');
select test.must_fail($$select accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'whole'), 'Made by mistake for the whole amount')$$, 'Sales cannot', 'Only the Accounts|not found|Not found');
select test.login('dh_acc');
select test.must_fail($$select accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'whole'), null)$$, 'a reason is required', 'reason');
select test.must_fail($$select accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'whole'), 'no')$$, 'and a real one', 'at least 5');
select test.check((accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'whole'), 'Made by mistake for the whole amount') ->> 'status') = 'Cancelled', 'the Accounts head cancels it with a reason: its status is Cancelled');
select test.check((accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'whole'), 'Made by mistake for the whole amount') ->> 'replayed')::boolean, 'cancelling again changes nothing');
select test.check((invoice_detail((select (data ->> 'id')::uuid from br where name = 'whole')) -> 'generated' -> 'cancelled' ->> 'reason') = 'Made by mistake for the whole amount'
               and (invoice_detail((select (data ->> 'id')::uuid from br where name = 'whole')) -> 'generated' -> 'cancelled' ->> 'by') is not null
               and (invoice_detail((select (data ->> 'id')::uuid from br where name = 'whole')) ->> 'status') = 'Cancelled', 'the invoice details say it was cancelled, by whom and why');
reset role;
select test.check((select cancel_reason = 'Made by mistake for the whole amount' and cancelled_at is not null and payment_ledger = 'CANCELLED' and lifecycle = 'PAID' and paid_pdf_status is not null
                     from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from br where name = 'whole')), 'the invoice stays, with who / when / why, and leaves the order');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_CANCELLED' and entity_id = (select (data ->> 'id')::uuid from br where name = 'whole')), 'the cancellation is audited once');
select test.must_fail($$update generated_invoices set total_amount = 1 where invoice_id = (select (data ->> 'id')::uuid from br where name = 'whole')$$, 'a cancelled invoice cannot be edited', 'cannot be edited');
select test.must_fail($$update generated_invoices set cancelled_at = null, payment_ledger = 'CUSTOMER' where invoice_id = (select (data ->> 'id')::uuid from br where name = 'whole')$$, 'nor un-cancelled', 'cancelled invoice cannot be changed');
select test.must_fail($$delete from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from br where name = 'whole')$$, 'nor deleted', 'cannot be deleted');
select test.check((select deal_amount = 141600 and amount_verified = 141600 from customers where id = (select id from bc where name = 'D')), 'the payments and the payable were not touched');
set role authenticated;
select test.login('acc_m');
select test.check((customer_payment_overview((select id from bc where name = 'D')) -> 'order' ->> 'invoicedTotal')::numeric = 0, 'the order shows nothing invoiced any more');

insert into br select 'D1', accounts_issue_payment_invoice((select id from bpay where name = 'D1'));
insert into br select 'D2', accounts_issue_payment_invoice((select id from bpay where name = 'D2'));
select test.check((select (a ->> 'total')::numeric = 70800 and (b ->> 'total')::numeric = 70800 and a ->> 'status' = 'Paid' and b ->> 'status' = 'Paid'
                     from (select (select data from br where name = 'D1') a, (select data from br where name = 'D2') b) x), 'now each 70,800 payment, the part and the full, has its own paid invoice of 70,800');
select test.check((customer_payment_overview((select id from bc where name = 'D')) -> 'order' ->> 'invoicedTotal')::numeric = 141600 and (customer_payment_overview((select id from bc where name = 'D')) ->> 'dealAmount')::numeric = 141600,
  'together they are 1,41,600: the order, not more');

-- a payment's own invoice can also be cancelled and made again
select test.login('dh_acc');
select accounts_cancel_invoice((select (data ->> 'id')::uuid from br where name = 'D2'), 'Wrong billing address on it');
select test.check((select count(*) = 0 from jsonb_array_elements(customer_payment_overview((select id from bc where name = 'D')) -> 'payments') p where p ->> 'id' = (select id::text from bpay where name = 'D2') and p -> 'invoice' is not null and p ->> 'invoice' <> 'null'),
  'the payment of a cancelled invoice shows no invoice, so "Generate invoice" is offered again');
insert into br select 'D2b', accounts_issue_payment_invoice_billed((select id from bpay where name = 'D2'), '{"address":"Corrected address, Pune 411068"}');
select test.check((select (data ->> 'id') <> (select data ->> 'id' from br where name = 'D2') and (data ->> 'total')::numeric = 70800 from br where name = 'D2b'), 'and it is made again, as another invoice of 70,800');
select test.must_fail($$select accounts_cancel_invoice(gen_random_uuid(), 'There is no such invoice')$$, 'an unknown invoice is not found', 'not found|Not found');

\echo '--- 46. Invoice WhatsApp is on by default'
reset role;
select test.check((select column_default = 'true' from information_schema.columns where table_schema = 'public' and table_name = 'invoice_whatsapp_settings' and column_name = 'enabled')
               and (select column_default = 'true' from information_schema.columns where table_schema = 'public' and table_name = 'invoice_whatsapp_settings' and column_name = 'auto_send'), 'a new installation starts with invoice WhatsApp and automatic sending on');
update invoice_whatsapp_settings set enabled = false, auto_send = false, updated_by = null;
\i supabase/migrations/20261207000100_payment_invoice_billing_cancel_whatsapp_on.sql
select test.check((select enabled and auto_send from invoice_whatsapp_settings), 'running the migration switches on the settings nobody ever changed');
update invoice_whatsapp_settings set enabled = false, auto_send = false, updated_by = (select id from profiles where email = 'root@amuwa.com');
\i supabase/migrations/20261207000100_payment_invoice_billing_cancel_whatsapp_on.sql
select test.check((select not enabled and not auto_send from invoice_whatsapp_settings), 'but a choice a person made is never overridden');
update invoice_whatsapp_settings set enabled = true, auto_send = true;

\echo '=== ALL PAYMENT INVOICE BILLING TESTS PASSED ==='
