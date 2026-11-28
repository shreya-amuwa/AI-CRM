-- =============================================================================
-- Recharge invoices and their delivery (20270311000100): generated only by Accounts, only for a verified payment, once per recharge, with a number from the existing
-- invoice series; sent by e-mail and WhatsApp as two separate channels, never twice by accident, with every outcome recorded. Uses rls_test.sql's users: sup_plain, sup_b,
-- sup_th, dh_wab, tm_a (Sales), acc_m (Accounts), sa. Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 161. Recharge invoices and delivery'
reset role;
\i supabase/migrations/20270228000200_support_recharges.sql
\i supabase/migrations/20270310000100_recharge_accounts_workflow.sql
\i supabase/migrations/20270311000100_recharge_invoices.sql
\i supabase/migrations/20270311000100_recharge_invoices.sql

alter table public.support_recharge_events disable trigger support_recharge_events_append_only;
delete from support_recharge_events where recharge_id in (select id from support_recharges where customer_id in (select id from customers where phone like '90000008%'));
alter table public.support_recharge_events enable trigger support_recharge_events_append_only;
delete from support_recharge_deliveries where invoice_id in (select i.id from support_recharge_invoices i join support_recharges r on r.id = i.recharge_id where r.customer_id in (select id from customers where phone like '90000008%'));
delete from support_recharge_invoices where recharge_id in (select id from support_recharges where customer_id in (select id from customers where phone like '90000008%'));
update support_recharge_files set recharge_id = null where file_name like 'rci-%';
delete from support_recharges where customer_id in (select id from customers where phone like '90000008%');
delete from support_recharge_files where file_name like 'rci-%';
delete from customer_activities where customer_id in (select id from customers where phone like '90000008%');
delete from customer_services where customer_id in (select id from customers where phone like '90000008%');
delete from customers where phone like '90000008%';
delete from notifications where type like 'RECHARGE\_%';
create temp table ri (k text primary key, v text);
grant all on ri to authenticated, anon, service_role;
create function pg_temp.rv(p_k text) returns text language sql stable as $$ select v from ri where k = p_k $$;
grant execute on function pg_temp.rv(text) to authenticated, anon;
create function pg_temp.shot(p_name text) returns uuid language plpgsql as $$
declare f public.support_recharge_files;
begin
  f := public.recharge_begin_upload(p_name, 'image/png', 12345);
  perform public.recharge_complete_upload(f.id, 12345, 'etag');
  return f.id;
end $$;
grant execute on function pg_temp.shot(text) to authenticated;
create function pg_temp.mk(p_cust text, p_extra jsonb) returns text language plpgsql as $$
declare v_file uuid := pg_temp.shot('rci-' || gen_random_uuid() || '.png');
begin
  return public.recharge_create(jsonb_build_object('kind', 'PANEL', 'customerId', pg_temp.rv(p_cust), 'rechargeDate', current_date, 'billingType', 'NON_GST', 'rechargeAmount', '500', 'gstAmount', '0',
    'screenshotId', v_file) || p_extra)::text;
end $$;
grant execute on function pg_temp.mk(text, jsonb) to authenticated;
create function pg_temp.rid(p_k text) returns uuid language sql stable as $$ select (v::jsonb ->> 'id')::uuid from ri where k = p_k $$;
grant execute on function pg_temp.rid(text) to authenticated;
create function pg_temp.inv(p_k text) returns uuid language sql stable as $$ select (v::jsonb ->> 'id')::uuid from ri where k = 'inv_' || p_k $$;
grant execute on function pg_temp.inv(text) to authenticated;

\echo '   three customers of sup_plain: C1 (GST, same state as the company), C2 (GST, another state), C3 (Non-GST)'
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000811","name":"Inv One","businessName":"RCI One Traders (TEST)"},{"row":4,"mobile":"9000000812","name":"Inv Two","businessName":"RCI Two Stores (TEST)"},{"row":5,"mobile":"9000000813","name":"Inv Three","businessName":"RCI Three Foods (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean), 'setup: customers');
reset role;
insert into ri select 'c1', id::text from customers where phone = '9000000811';
insert into ri select 'c2', id::text from customers where phone = '9000000812';
insert into ri select 'c3', id::text from customers where phone = '9000000813';
set role authenticated;
select test.login('sup_plain');
insert into ri select 'g1', pg_temp.mk('c1', '{"billingType":"GST","rechargeAmount":"500","gstAmount":"91.01","gstNumber":"27AAPFU0939F1ZV","paymentReference":"RCI-UTR-1"}'::jsonb);
insert into ri select 'g2', pg_temp.mk('c2', '{"billingType":"GST","rechargeAmount":"1000","gstAmount":"180","gstNumber":"29AABCT1332L1ZZ","paymentReference":"RCI-UTR-2"}'::jsonb);
insert into ri select 'n1', pg_temp.mk('c3', '{"kind":"MESSAGE","rechargeAmount":"250.50","paymentReference":"RCI-UTR-3"}'::jsonb);

\echo '   the tables and helpers cannot be reached directly'
select test.check(not has_table_privilege('authenticated', 'public.support_recharge_invoices', 'select') and not has_table_privilege('authenticated', 'public.support_recharge_deliveries', 'select')
                  and not has_function_privilege('anon', 'public.recharge_invoice_generate(uuid, jsonb)', 'execute') and not has_function_privilege('anon', 'public.recharge_delivery_begin(uuid, text, boolean)', 'execute')
                  and not has_function_privilege('authenticated', 'private.recharge_invoice_json(public.support_recharge_invoices)', 'execute'), 'no direct grants; anonymous cannot call; helpers are private');
select test.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.support_recharge_invoices'::regclass, 'public.support_recharge_deliveries'::regclass)), 'row level security is on');
select test.check((select count(*) = 10 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('recharge_invoice_prefill', 'recharge_invoice_generate', 'recharge_invoice_get',
  'recharge_invoice_snapshot', 'recharge_invoice_record_pdf', 'recharge_invoice_record_pdf_failure', 'recharge_invoice_file', 'recharge_set_contact', 'recharge_delivery_begin', 'recharge_delivery_finish')
  and p.prosecdef and p.proconfig @> array['search_path=""']), 'every new function is SECURITY DEFINER with an empty search_path');

\echo '   only Accounts make and send the invoice'
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'the recorder cannot generate it', 'FORBIDDEN');
select test.must_fail(format($$select recharge_invoice_prefill('%s')$$, pg_temp.rid('g1')), '... nor see the plan', 'FORBIDDEN');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'EMAIL')$$, pg_temp.rid('g1')), '... nor send it', 'FORBIDDEN');
select test.login('sup_th');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'a Team Lead cannot', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'a Department Head cannot', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'a Sales member cannot', 'FORBIDDEN');

\echo '   no invoice before the payment is confirmed'
select test.login('acc_m');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'a recharge still pending verification has no invoice', 'Confirm that the payment');
select test.check((select recharge_verify_payment(pg_temp.rid('g1'), 'NOT_RECEIVED', 'not yet') ->> 'paymentStatus' = 'PAYMENT_NOT_RECEIVED'), 'setup: payment not received');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'a payment not received has no invoice', 'Confirm that the payment');
select test.check((select recharge_verify_payment(pg_temp.rid('g1'), 'RECEIVED', 'seen in the bank', 591.01) ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'setup: payment received');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, gen_random_uuid()), 'an unknown recharge is not found', 'NOT_FOUND');

\echo '   what the invoice needs: the billing address'
select test.check(((select recharge_invoice_prefill(pg_temp.rid('g1')) -> 'missing') @> '["the customer''s billing address"]'::jsonb), 'the plan says the address is missing');
select test.must_fail(format($$select recharge_invoice_generate('%s')$$, pg_temp.rid('g1')), 'the invoice is refused without the customer''s billing address', 'billing address');
select test.check((select recharge_accounts_correct(pg_temp.rid('g1'), '{"note":"address from the GST certificate","customerAddress":"12 MG Road, Pune 411001","customerEmail":"billing@rcione.example.com"}'::jsonb) ->> 'customerAddress' = '12 MG Road, Pune 411001'), 'Accounts add the address and e-mail');
select test.check((select jsonb_array_length(recharge_invoice_prefill(pg_temp.rid('g1')) -> 'missing') = 0 and recharge_invoice_prefill(pg_temp.rid('g1')) ->> 'taxTreatment' = 'INTRA_STATE'
                          and (recharge_invoice_prefill(pg_temp.rid('g1')) ->> 'cgstAmount')::numeric = 45.51 and (recharge_invoice_prefill(pg_temp.rid('g1')) ->> 'sgstAmount')::numeric = 45.50), 'the plan: same state as the company, CGST + SGST split to the paisa');
select test.must_fail(format($$select recharge_invoice_generate('%s', '{"hsnSac":"12"}'::jsonb)$$, pg_temp.rid('g1')), 'the HSN/SAC code must be 4 to 8 digits', 'HSN');
select test.must_fail(format($$select recharge_invoice_generate('%s', '{"taxTreatment":"BOTH"}'::jsonb)$$, pg_temp.rid('g1')), 'the tax treatment must be one of the two', 'intra-state');

\echo '   generate (GST, same state): the number, the tax split, one invoice per recharge'
insert into ri select 'inv_g1', recharge_invoice_generate(pg_temp.rid('g1'))::text;
select test.check((select v::jsonb ->> 'number' ~ '^GST/[0-9]{2}-[0-9]{2}/[0-9]+$' and v::jsonb ->> 'invoiceType' = 'GST' and v::jsonb ->> 'taxTreatment' = 'INTRA_STATE' and (v::jsonb ->> 'totalAmount')::numeric = 591.01
                          and (v::jsonb ->> 'cgstAmount')::numeric = 45.51 and (v::jsonb ->> 'sgstAmount')::numeric = 45.50 and (v::jsonb ->> 'igstAmount')::numeric = 0 and (v::jsonb ->> 'totalGst')::numeric = 91.01
                          and v::jsonb ->> 'pdfStatus' = 'PENDING' and (v::jsonb ->> 'replayed')::boolean = false from ri where k = 'inv_g1'), 'a GST number from the existing series, CGST + SGST, total = amount + GST');
select test.check((select v::jsonb ->> 'customerGstin' = '27AAPFU0939F1ZV' and v::jsonb ->> 'customerEmail' = 'billing@rcione.example.com' and v::jsonb ->> 'paymentReference' = 'RCI-UTR-1' and v::jsonb ->> 'particulars' like 'Panel recharge (PRC-%' from ri where k = 'inv_g1'),
  'the invoice holds the customer, GST number, e-mail, payment reference and the recharge');
select test.check((select recharge_get(pg_temp.rid('g1')) ->> 'invoiceStatus' = 'GENERATED'), 'the recharge says an invoice was generated (delivery is separate)');
select test.check((select recharge_invoice_generate(pg_temp.rid('g1')) ->> 'number' = (select v::jsonb ->> 'number' from ri where k = 'inv_g1') and (recharge_invoice_generate(pg_temp.rid('g1')) ->> 'replayed')::boolean), 'generating again returns the same invoice (no second number)');
reset role;
select test.check((select count(*) = 1 from support_recharge_invoices where recharge_id = pg_temp.rid('g1')), 'only one invoice row');
select test.must_fail(format($$insert into support_recharge_invoices (recharge_id, invoice_number, invoice_type, invoice_date, customer_name, customer_address, tax_treatment, particulars, hsn_sac, taxable_amount, total_amount, paid_on, terms, generated_by)
  values (%L, 'X/1', 'NON_GST', current_date, 'x', '12 MG Road', 'NONE', 'x y', '998313', 1, 1, current_date, 't', %L)$$, pg_temp.rid('g1'), test.id('acc_m')), 'the table refuses a second invoice for the recharge', 'duplicate key');
select test.must_fail(format($$update support_recharge_invoices set total_amount = total_amount + 1 where recharge_id = %L$$, pg_temp.rid('g1')), 'the table refuses a total that is not amount + GST', 'support_recharge_invoices_tax_ck');
select test.check((select count(*) = 1 from support_recharge_events where recharge_id = pg_temp.rid('g1') and action = 'INVOICE_GENERATED') and (select count(*) = 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_GENERATED' and entity_id = pg_temp.rid('g1')), 'one timeline event and one audit row');
select test.check((select count(*) = 1 from notifications where type = 'RECHARGE_INVOICE_GENERATED' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.rid('g1')), 'the RM / recorder is told once');
set role authenticated;
select test.login('acc_m');
select test.must_fail(format($$select recharge_accounts_correct('%s', '{"note":"too late","gstAmount":"1"}'::jsonb)$$, pg_temp.rid('g1')), 'the billing details are locked once the invoice exists', 'can no longer be corrected');
select test.must_fail(format($$select recharge_verify_payment('%s', 'NOT_RECEIVED', 'second thoughts')$$, pg_temp.rid('g1')), 'and the payment cannot be taken back', 'invoice already exists');

\echo '   generate (GST, another state: IGST) and (Non-GST: no tax)'
select test.check((select recharge_verify_payment(pg_temp.rid('g2'), 'RECEIVED', 'paid', 1180) ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'setup: the second payment received');
select test.check((select recharge_accounts_correct(pg_temp.rid('g2'), '{"note":"address and e-mail","customerAddress":"5 Brigade Road, Bengaluru 560001","customerEmail":"billing@rcitwo.example.com"}'::jsonb) ->> 'id' is not null), 'setup: its address and e-mail');
insert into ri select 'inv_g2', recharge_invoice_generate(pg_temp.rid('g2'))::text;
select test.check((select v::jsonb ->> 'taxTreatment' = 'INTER_STATE' and (v::jsonb ->> 'igstAmount')::numeric = 180 and (v::jsonb ->> 'cgstAmount')::numeric = 0 and (v::jsonb ->> 'sgstAmount')::numeric = 0 and (v::jsonb ->> 'gstRate')::numeric = 18.00
                          and (v::jsonb ->> 'totalAmount')::numeric = 1180 from ri where k = 'inv_g2'), 'another state: IGST, the rate is only the arithmetic of the two amounts (18%)');
select test.check((select v::jsonb ->> 'number' <> (select v2::jsonb ->> 'number' from (select v v2 from ri where k = 'inv_g1') y) from ri where k = 'inv_g2'), 'a different number');
select test.check((select recharge_verify_payment(pg_temp.rid('n1'), 'RECEIVED', 'paid', 250.50) ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'setup: the Non-GST payment received');
select test.check((select recharge_accounts_correct(pg_temp.rid('n1'), '{"note":"address","customerAddress":"7 Park Street, Kolkata"}'::jsonb) ->> 'id' is not null), 'setup: its address');
insert into ri select 'inv_n1', recharge_invoice_generate(pg_temp.rid('n1'))::text;
select test.check((select v::jsonb ->> 'invoiceType' = 'NON_GST' and v::jsonb ->> 'taxTreatment' = 'NONE' and (v::jsonb ->> 'totalGst')::numeric = 0 and (v::jsonb ->> 'totalAmount')::numeric = 250.50
                          and v::jsonb ->> 'number' not like 'GST/%' and v::jsonb ->> 'particulars' like 'Message recharge%' from ri where k = 'inv_n1'), 'Non-GST: its own series, no tax, the Message recharge');
select test.check((select count(distinct v::jsonb ->> 'number') = 3 from ri where k like 'inv_%'), 'three invoices, three different numbers');

\echo '   the snapshot the PDF is drawn from'
select test.check((select s ->> 'number' = (select v::jsonb ->> 'number' from ri where k = 'inv_g1') and (s -> 'totals' ->> 'total')::numeric = 591.01 and (s -> 'totals' ->> 'subtotal')::numeric = 500
                          and (s -> 'lines' -> 0 ->> 'baseAmount')::numeric = 500 and s -> 'customer' ->> 'gstin' = '27AAPFU0939F1ZV' and s ->> 'recipientEmail' = 'billing@rcione.example.com' and s -> 'paymentSummary' ->> 'state' = 'FULLY_PAID'
                          and s -> 'totals' ->> 'inWords' is not null from (select recharge_invoice_snapshot(pg_temp.inv('g1')) s) x), 'the snapshot holds the invoice, the customer, the lines and the paid state');
select test.check((select recharge_invoice_snapshot(pg_temp.inv('n1')) ->> 'taxTreatment' = 'INTRA_STATE' and recharge_invoice_snapshot(pg_temp.inv('n1')) ->> 'invoiceType' = 'NON_GST'), 'a Non-GST snapshot is a Non-GST invoice');
select test.login('sup_plain');
select test.must_fail(format($$select recharge_invoice_snapshot('%s')$$, pg_temp.inv('g1')), 'Support cannot read the snapshot', 'FORBIDDEN');
select test.must_fail(format($$select recharge_invoice_file('%s')$$, pg_temp.inv('g1')), '... nor the file', 'FORBIDDEN');
select test.login('acc_m');

\echo '   the PDF is recorded in its own place only'
select test.must_fail(format($$select recharge_invoice_file('%s')$$, pg_temp.inv('g1')), 'there is no file before the PDF is stored', 'not ready');
select test.must_fail(format($$select recharge_invoice_record_pdf('%s', 'R2', 'recharge-invoices', 'somewhere/else.pdf', 'r2://x', 'etag', 1000)$$, pg_temp.inv('g1')), 'a stored PDF must be in the invoice''s own place', 'its own place');
select test.must_fail(format($$select recharge_invoice_record_pdf('%s', 'R2', 'customer-documents', 'invoices/%s/invoice.pdf', 'r2://x', 'etag', 1000)$$, pg_temp.inv('g1'), pg_temp.inv('g1')), 'and in the private recharge-invoices bucket', 'its own place');
select recharge_invoice_record_pdf_failure(pg_temp.inv('g1'), 'the renderer stopped');
select test.check((select recharge_invoice_get(pg_temp.rid('g1')) ->> 'pdfStatus' = 'FAILED' and recharge_invoice_get(pg_temp.rid('g1')) ->> 'pdfError' = 'the renderer stopped'), 'a failed PDF is recorded and can be retried');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'EMAIL')$$, pg_temp.rid('g1')), 'nothing is sent while the PDF is not ready', 'not ready');
select recharge_invoice_record_pdf(pg_temp.inv('g1'), 'R2', 'recharge-invoices', format('invoices/%s/invoice.pdf', pg_temp.inv('g1')), 'r2://x', 'etag-1', 24000);
select recharge_invoice_record_pdf(pg_temp.inv('g2'), 'R2', 'recharge-invoices', format('invoices/%s/invoice.pdf', pg_temp.inv('g2')), 'r2://x', 'etag-2', 24000);
select recharge_invoice_record_pdf(pg_temp.inv('n1'), 'R2', 'recharge-invoices', format('invoices/%s/invoice.pdf', pg_temp.inv('n1')), 'r2://x', 'etag-3', 24000);
select test.check((select recharge_invoice_get(pg_temp.rid('g1')) ->> 'pdfStatus' = 'READY' and recharge_invoice_get(pg_temp.rid('g1')) ->> 'pdfError' is null), 'the stored PDF is READY');
select test.check((select recharge_invoice_file(pg_temp.inv('g1')) ->> 'bucket' = 'recharge-invoices' and recharge_invoice_file(pg_temp.inv('g1')) ->> 'path' = format('invoices/%s/invoice.pdf', pg_temp.inv('g1'))), 'Accounts get the private place of the PDF for a short-lived link');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_VIEWED' and entity_id = pg_temp.rid('g1')), 'opening the PDF is audited');
set role authenticated;

\echo '   delivery: e-mail and WhatsApp are separate channels, never sent twice by accident'
select test.login('acc_m');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'SMS')$$, pg_temp.rid('g1')), 'only e-mail and WhatsApp exist', 'e-mail or WhatsApp');
insert into ri select 'd1', recharge_delivery_begin(pg_temp.rid('g1'), 'EMAIL')::text;
select test.check((select v::jsonb ->> 'to' = 'billing@rcione.example.com' and (v::jsonb ->> 'isResend')::boolean = false and v::jsonb ->> 'number' = (select v2::jsonb ->> 'number' from (select v v2 from ri where k = 'inv_g1') y)
                          and v::jsonb -> 'file' ->> 'bucket' = 'recharge-invoices' from ri where k = 'd1'), 'a send is booked for the customer''s e-mail, with the invoice and its file');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'EMAIL')$$, pg_temp.rid('g1')), 'a second click while it is being sent is refused', 'already being sent');
select test.check((select recharge_get(pg_temp.rid('g1')) -> 'invoice' -> 'deliveries' -> 0 ->> 'status' = 'SENDING'), 'the invoice shows the send in progress');
select test.must_fail($$select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd1'), 'DONE')$$, 'an outcome must be SENT, NOT_SENT or FAILED', 'Unknown delivery outcome');
select test.check((select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd1'), 'SENT', 'Sent from meta@amuwa.com', 'msg-1') ->> 'invoiceStatus' = 'EMAIL_SENT'), 'sent by e-mail: the invoice status is Email sent');
select test.check((select (recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd1'), 'FAILED', 'late') ->> 'replayed')::boolean), 'finishing the same send again changes nothing');
select test.check((select recharge_get(pg_temp.rid('g1')) ->> 'invoiceStatus' = 'EMAIL_SENT'), 'still Email sent');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'EMAIL')$$, pg_temp.rid('g1')), 'sending it by e-mail again by accident is refused', 'already sent');
insert into ri select 'd1b', recharge_delivery_begin(pg_temp.rid('g1'), 'EMAIL', true)::text;
select test.check((select (v::jsonb ->> 'isResend')::boolean from ri where k = 'd1b'), '"send again" is allowed on purpose');
select test.check((select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd1b'), 'FAILED', 'The mail server refused the message.') ->> 'invoiceStatus' = 'EMAIL_SENT'), 'a failed re-send does not undo that it was sent before');

insert into ri select 'd1c', recharge_delivery_begin(pg_temp.rid('g1'), 'EMAIL', true)::text;
select test.check((select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd1c'), 'SENT', 'Sent from meta@amuwa.com', 'msg-2') ->> 'invoiceStatus' = 'EMAIL_SENT'), 'the retry after the failed re-send is sent');

\echo '   WhatsApp: the number, a failure, a retry; partly sent'
select test.check((select recharge_set_contact(pg_temp.rid('g1'), 'billing@rcione.example.com', '123', 'wrong number on file') ->> 'customerPhone' = '123'), 'Accounts can correct the contact after the invoice exists');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'WHATSAPP')$$, pg_temp.rid('g1')), 'a number that is not an Indian mobile is refused', 'mobile number');
select test.must_fail(format($$select recharge_set_contact('%s', 'nope', null, 'fix')$$, pg_temp.rid('g1')), 'an invalid e-mail is refused', 'e-mail');
select test.must_fail(format($$select recharge_set_contact('%s', null, null, 'x')$$, pg_temp.rid('g1')), 'a correction needs a reason', 'what was corrected');
select test.check((select recharge_set_contact(pg_temp.rid('g1'), 'billing@rcione.example.com', '+91 98765 43210', 'number confirmed by phone') ->> 'customerPhone' = '+91 98765 43210'), 'the number is corrected');
insert into ri select 'd2', recharge_delivery_begin(pg_temp.rid('g1'), 'WHATSAPP')::text;
select test.check((select v::jsonb ->> 'to' = '+919876543210' from ri where k = 'd2'), 'the number is normalised for WhatsApp');
select test.check((select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd2'), 'FAILED', 'The WhatsApp webhook is busy or unavailable (HTTP 503).') ->> 'invoiceStatus' = 'PARTIALLY_SENT'), 'e-mail sent, WhatsApp failed: Partially sent');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'RECHARGE_INVOICE_SEND_FAILED' and recipient_id = test.id('dh_acc')), 'Accounts colleagues are told that the delivery failed');
select test.check((select count(*) = 0 from notifications where type = 'RECHARGE_INVOICE_SEND_FAILED' and recipient_id = test.id('acc_m')), 'the person who sent it sees the failure on the screen, not as a notification');
set role authenticated;
select test.login('acc_m');
insert into ri select 'd3', recharge_delivery_begin(pg_temp.rid('g1'), 'WHATSAPP')::text;
select test.check((select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd3'), 'NOT_SENT', 'Dry run: nothing is sent while AUTOMATION_MODE is not live.') ->> 'invoiceStatus' = 'PARTIALLY_SENT'), 'a test-mode "not sent" is never reported as sent');
insert into ri select 'd4', recharge_delivery_begin(pg_temp.rid('g1'), 'WHATSAPP')::text;
select test.check((select recharge_delivery_finish((select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd4'), 'SENT', 'The WhatsApp webhook accepted the invoice (HTTP 200).', 'wa-1') ->> 'invoiceStatus' = 'SENT'), 'retried and accepted: Sent');
select test.must_fail(format($$select recharge_delivery_begin('%s', 'WHATSAPP')$$, pg_temp.rid('g1')), 'sending it on WhatsApp again by accident is refused', 'already sent');
-- a send whose server stopped does not block the channel for ever
insert into ri select 'd5', recharge_delivery_begin(pg_temp.rid('g2'), 'EMAIL')::text;
reset role;
update support_recharge_deliveries set requested_at = now() - interval '10 minutes' where id = (select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd5');
set role authenticated;
select test.login('acc_m');
select test.check((select recharge_delivery_begin(pg_temp.rid('g2'), 'EMAIL') ->> 'to' = 'billing@rcitwo.example.com'), 'a send that never finished (10 minutes) is timed out and can be started again');
reset role;
select test.check((select status = 'FAILED' and detail like '%timed out%' from support_recharge_deliveries where id = (select (v::jsonb ->> 'deliveryId')::uuid from ri where k = 'd5')), 'and it is recorded as failed');
set role authenticated;

\echo '   the timeline, the audit trail and who sees the delivery details'
select test.login('acc_m');
select test.check((select count(*) = 4 from jsonb_array_elements(recharge_get(pg_temp.rid('g1')) -> 'timeline') e where e ->> 'action' in ('INVOICE_SENT_EMAIL', 'INVOICE_RESENT', 'INVOICE_SENT_WHATSAPP', 'INVOICE_GENERATED')) , 'the timeline holds generation, e-mail, re-send and WhatsApp');
select test.check((select count(*) = 2 from jsonb_array_elements(recharge_get(pg_temp.rid('g1')) -> 'timeline') e where e ->> 'action' = 'INVOICE_SEND_FAILED'), 'and each failure');
select test.check((select recharge_get(pg_temp.rid('g1')) -> 'invoice' -> 'deliveries' -> 0 ? 'recipient'), 'Accounts see who each send went to and the provider''s answer');
select test.login('sup_plain');
select test.check((select recharge_get(pg_temp.rid('g1')) -> 'invoice' ->> 'number' is not null and recharge_get(pg_temp.rid('g1')) ->> 'invoiceStatus' = 'SENT' and jsonb_array_length(recharge_get(pg_temp.rid('g1')) -> 'invoice' -> 'deliveries') >= 4), 'Support see the invoice number, its status and each channel''s outcome');
select test.check((select not (recharge_get(pg_temp.rid('g1')) -> 'invoice' -> 'deliveries' -> 0 ? 'recipient') and not (recharge_get(pg_temp.rid('g1')) -> 'invoice' ? 'customerEmail') and not (recharge_get(pg_temp.rid('g1')) -> 'invoice' ? 'customerPhone')), 'but not the customer''s e-mail, phone or the provider''s answer');
select test.login('sup_b');
select test.must_fail(format($$select recharge_invoice_get('%s')$$, pg_temp.rid('g1')), 'a Support member who is neither recorder nor RM cannot see it', 'NOT_FOUND');
select test.login('acc_m');
select test.check((select recharge_list(null, null, 'PAYMENT_RECEIVED', 'DELIVERY_ANY') ->> 'total' = '1' and recharge_list(null, null, null, 'GENERATED_ANY') ->> 'total' = '3'
                          and recharge_list(null, null, null, 'GENERATED') ->> 'total' = '2'), 'the queues: delivery (sent, partial, failed), invoices generated, generated and not yet sent');
select test.check((select (recharge_list(null, 'rci') -> 'summary' ->> 'invoiced') = '3' and (recharge_list(null, 'rci') -> 'summary' ->> 'delivered') = '1' and (recharge_list(null, 'rci') -> 'summary' ->> 'readyForInvoice') = '0'), 'the summary counts invoices and delivered ones');
select test.must_fail($$select recharge_list(null, null, null, 'SHIPPED')$$, 'an unknown invoice status is refused', 'invoice status');
reset role;
select test.check(exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_EMAILED') and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_RESENT')
                  and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_WHATSAPPED') and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_SEND_FAILED')
                  and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_INVOICE_NOT_SENT') and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_CONTACT_CORRECTED'),
  'e-mail, re-send, WhatsApp, failure, not-sent and contact corrections are audited');
select test.check((select count(*) = 0 from audit_logs where action like 'SUPPORT_RECHARGE_INVOICE%' and (metadata::text like '%@%' or metadata::text like '%+91%')), 'the audit log holds no e-mail address or phone number');
select test.check((select count(*) = 0 from support_recharge_invoices where total_amount <> taxable_amount + total_gst or cgst_amount + sgst_amount + igst_amount <> total_gst), 'every invoice adds up');
\echo '--- Recharge invoices and delivery: done'
