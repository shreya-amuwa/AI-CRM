-- =============================================================================
-- Dynamic two-stage invoices (migration 20261027000100): prefill, issue, unpaid PDF + e-mail, payment confirmation,
-- paid PDF + e-mail, client visibility, immutability, retries and permissions.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 30. Dynamic invoices: maths, words, states'
reset role;
-- Most of this suite exercises the delivery machinery (unpaid stage, retries, immutability) that older invoices still use. Invoices made
-- by the paid-only rule never run the unpaid stage, so while those sections run, new invoices are created as older (not paid-only) ones;
-- section 38 at the end switches the rule back on and tests it.
alter table public.generated_invoices alter column paid_only set default false;
-- The same arithmetic as shared/invoiceCalc.ts (which has its own unit tests with these cases).
select test.check(
  (select (c ->> 'subtotal')::numeric = 16000 and (c ->> 'totalGst')::numeric = 2880 and (c ->> 'total')::numeric = 18880
          and (c ->> 'cgst')::numeric = 1440 and (c ->> 'sgst')::numeric = 1440 and (c ->> 'igst')::numeric = 0
          and (c ->> 'cgstRate')::numeric = 9 and (c ->> 'igstRate') is null
          and (c -> 'lines' -> 0 ->> 'gstAmount')::numeric = 1800 and (c -> 'lines' -> 0 ->> 'totalAmount')::numeric = 11800
          and (c -> 'lines' -> 1 ->> 'gstAmount')::numeric = 1080 and (c -> 'lines' -> 1 ->> 'totalAmount')::numeric = 7080
          and c ->> 'words' = 'Eighteen Thousand Eight Hundred Eighty Only/-'
     from (select private.invoice_calc('[{"baseAmount":10000,"taxRate":18},{"baseAmount":6000,"taxRate":18}]', 'INTRA_STATE') c) x),
  'Rs.10,000 + Rs.6,000 at 18% = Rs.16,000 + Rs.2,880 GST = Rs.18,880 with 9% CGST and 9% SGST, and the words');
select test.check(
  (select (c ->> 'igst')::numeric = 2880 and (c ->> 'cgst')::numeric = 0 and (c ->> 'igstRate')::numeric = 18 and (c ->> 'cgstRate') is null
     from (select private.invoice_calc('[{"baseAmount":10000,"taxRate":18},{"baseAmount":6000,"taxRate":18}]', 'INTER_STATE') c) x),
  'inter-state: the whole GST is IGST at 18%');
select test.check((select (c -> 'lines' -> 0 ->> 'totalAmount')::numeric <> 11000 from (select private.invoice_calc('[{"baseAmount":10000,"taxRate":18}]', 'INTRA_STATE') c) x),
  'the sample''s wrong Rs.11,000 row total is never produced');
select test.check(
  (select (c ->> 'subtotal')::numeric = 34500.49 and (c ->> 'totalGst')::numeric = 5180.01 and (c ->> 'total')::numeric = 39680.50
          and (c ->> 'cgst')::numeric = 2590.01 and (c ->> 'sgst')::numeric = 2590.00 and (c ->> 'cgstRate') is null and jsonb_array_length(c -> 'groups') = 4
          and c ->> 'words' = 'Thirty Nine Thousand Six Hundred Eighty and Fifty Paise Only/-'
     from (select private.invoice_calc('[{"baseAmount":10000,"taxRate":18},{"baseAmount":6000,"taxRate":18},{"baseAmount":2499.99,"taxRate":18},
                                          {"baseAmount":15000.50,"taxRate":12},{"baseAmount":999,"taxRate":5},{"baseAmount":1,"taxRate":0}]', 'INTRA_STATE') c) x),
  'six rows with four different rates: per-row GST rounded, CGST + SGST = GST, no single misleading rate');
select test.check((select (c ->> 'totalGst')::numeric = 18.05 and (c ->> 'cgst')::numeric = 9.03 and (c ->> 'sgst')::numeric = 9.02
                     from (select private.invoice_calc('[{"baseAmount":100.25,"taxRate":18}]', 'INTRA_STATE') c) x), 'an odd paisa goes to CGST (9.03 + 9.02 = 18.05)');
select test.check((select (private.invoice_calc('[{"baseAmount":0.05,"taxRate":18}]', 'INTER_STATE') ->> 'totalGst')::numeric = 0.01), 'Rs.0.05 at 18% rounds half up to Rs.0.01');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":0,"taxRate":18}]', 'INTRA_STATE')$$, 'a zero amount is refused', 'more than zero');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":-5,"taxRate":18}]', 'INTRA_STATE')$$, 'a negative amount is refused', 'more than zero');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":10.005,"taxRate":18}]', 'INTRA_STATE')$$, 'three decimals are refused', 'up to 2 decimals');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":"ten","taxRate":18}]', 'INTRA_STATE')$$, 'a text amount is refused', 'enter numbers');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":"","taxRate":18}]', 'INTRA_STATE')$$, 'a blank amount is refused', 'more than zero');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":100,"taxRate":101}]', 'INTRA_STATE')$$, 'a tax rate over 100 is refused', 'from 0 to 100');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":100}]', 'INTRA_STATE')$$, 'a missing tax rate is refused', 'tax rate');
select test.must_fail($$select private.invoice_calc('[]', 'INTRA_STATE')$$, 'no lines is refused', 'at least one');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":100,"taxRate":18}]', 'SOMETHING')$$, 'an unknown treatment is refused', 'tax treatment');
select test.must_fail($$select private.invoice_calc('[{"baseAmount":9999999999.99,"taxRate":18}]', 'INTRA_STATE')$$, 'a total that is too large is refused', 'too large');
select test.check(
  (select bool_and(private.amount_in_words(a) = w) from (values
     (18880::numeric, 'Eighteen Thousand Eight Hundred Eighty Only/-'), (1, 'One Only/-'), (19, 'Nineteen Only/-'), (20, 'Twenty Only/-'),
     (101, 'One Hundred One Only/-'), (1000, 'One Thousand Only/-'), (11000, 'Eleven Thousand Only/-'), (100000, 'One Lakh Only/-'),
     (1234567, 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Only/-'), (10000000, 'One Crore Only/-'),
     (123456789, 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine Only/-'),
     (1000000000, 'One Hundred Crore Only/-'),
     (9999999999, 'Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Only/-'),
     (18880.50, 'Eighteen Thousand Eight Hundred Eighty and Fifty Paise Only/-'), (1.01, 'One and One Paise Only/-'),
     (0.50, 'Fifty Paise Only/-'), (200000.99, 'Two Lakh and Ninety Nine Paise Only/-'), (0, 'Zero Only/-')) t (a, w)),
  'rupees in words: thousands, lakhs, crores and paise');
select test.must_fail($$select private.amount_in_words(-1)$$, 'words refuse a negative amount', 'out of range');
select test.must_fail($$select private.amount_in_words(10000000000)$$, 'words refuse an amount that is too large', 'out of range');
select test.check(
  (select bool_and(private.infer_state_code(a) is not distinct from c) from (values
     ('1107, Shagun Insignia, Above Reliance Trendz, Sec 19 Ulwe, Navi Mumbai, Maharashtra', '27'),
     ('D/1801, Pancham, Nanded City, Sinhagad Road, Pune 411068', null),
     ('12 Delhi Road, Mumbai, Maharashtra 400001', '27'), ('Plot 4, MIDC, Ahmedabad, Gujarat', '24'),
     ('Connaught Place, New Delhi', '07'), ('Bhubaneswar, Orissa', '21'), ('', null), (null, null)) t (a, c)),
  'the state is read from the address (the last one named wins; none named: not guessed)');
select test.check(private.valid_gstin('27BDCPK3585J3Z7') and private.valid_gstin('27AADFZ2948M1ZI') and not private.valid_gstin('27BDCPK3585J3Z')
                   and not private.valid_gstin('99AAAAA0000A1Z5') and not private.valid_gstin('27bdcpk3585j3z7'), 'GSTIN: 15 characters, the official layout, a known state');
select test.check((select count(*) = 37 and bool_and(code ~ '^[0-9]{2}$') from gst_states), 'the GST state list is loaded');

-- ---------------------------------------------------------------------------
\echo '--- 31. Dynamic invoices: set-up, permissions and prefill'
-- ---------------------------------------------------------------------------
create temp table iv (name text primary key, id uuid);
create temp table rq (name text primary key, id uuid default gen_random_uuid());
create temp table pl (name text primary key, body jsonb);
create temp table res (name text primary key, data jsonb);
grant all on iv, rq, pl, res to authenticated, service_role;

set role authenticated;
select test.login('tm_a');
insert into iv select 'P', create_lead('{"name":"Priya Sharma","company":"Sharma Opticals","email":"priya@sharmaopticals.example","phone":"9819900201",
  "address":"D/1801, Pancham, Nanded City, Sinhagad Road, Pune 411068, Maharashtra","leadSource":"Walk-in"}', array['AI_CALLING', 'META_ADS_MANAGEMENT']);
insert into iv select 'Q', create_lead('{"name":"Quresh Patel","company":"Patel Textiles","email":"quresh@pateltextiles.example","phone":"9819900202",
  "address":"Plot 4, GIDC, Surat, Gujarat","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
insert into iv select 'R', create_lead('{"name":"Ravi Rao","company":"Rao Clinic","email":"ravi@raoclinic.example","phone":"9819900203","leadSource":"Walk-in"}', array['AI_CALLING']);
insert into iv select 'S', create_lead('{"name":"Sita Sen","company":"Sen Sweets","email":"sita@sensweets.example","phone":"9819900204","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
select test.create_auth_user('inv_cl_p', 'inv.p.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from iv where name = 'P')));
select test.create_auth_user('inv_cl_q', 'inv.q.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from iv where name = 'Q')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values
  ((select id from iv where name = 'P'), test.id('inv_cl_p'), 'inv.p.login@example.com'),
  ((select id from iv where name = 'Q'), test.id('inv_cl_q'), 'inv.q.login@example.com');
-- P, Q, R went through onboarding (Accounts may invoice them); S is still a lead nobody sent to Accounts
update customers set lifecycle_stage = 'CUSTOMER' where id in (select id from iv where name in ('P', 'Q', 'R'));

-- who may use it
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select accounts_invoice_prefill((select id from iv where name = 'P'))$$, 'a salesperson cannot use the invoice prefill', 'Only the Accounts department');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), '{}'::jsonb)$$, 'nor issue an invoice', 'Only the Accounts department');
select test.must_fail($$select accounts_confirm_invoice_payment(gen_random_uuid(), 'UPI')$$, 'nor confirm a payment', 'Only the Accounts department');
select test.must_fail($$select accounts_invoice_claim(gen_random_uuid(), 'UNPAID')$$, 'nor take an invoice''s delivery work', 'Only the Accounts department');
select test.login('th_wab');
select test.must_fail($$select accounts_invoice_prefill((select id from iv where name = 'P'))$$, 'a team head cannot either', 'Only the Accounts department');
select test.login('tm_c');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), '{}'::jsonb)$$, 'staff of another department cannot', 'Only the Accounts department');
select test.login('inv_cl_p');
select test.must_fail($$select accounts_invoice_prefill((select id from iv where name = 'P'))$$, 'a client cannot use the staff invoice builder', 'Only the Accounts department');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), '{}'::jsonb)$$, 'nor issue an invoice for themselves', 'Only the Accounts department');
select test.must_fail($$select * from generated_invoices$$, 'a client cannot read the invoice snapshots directly', 'permission denied');
select test.login('acc_m');
select test.must_fail($$select * from generated_invoices$$, 'nor can Accounts: the functions are the only way in', 'permission denied');
select test.must_fail($$select * from generated_invoice_items$$, 'nor the lines', 'permission denied');
select test.must_fail($$insert into generated_invoices (invoice_id, request_id) values (gen_random_uuid(), gen_random_uuid())$$, 'nor write them directly', 'permission denied');
select test.must_fail($$select * from gst_states$$, 'nor the state list directly', 'permission denied');

-- prefill
select test.must_fail($$select accounts_invoice_prefill(gen_random_uuid())$$, 'an unknown customer is not found', 'not found');
select test.must_fail($$select accounts_invoice_prefill((select id from iv where name = 'S'))$$, 'a lead that never reached Accounts is not found', 'not found');
select test.must_fail($$select accounts_invoice_prefill((select id from iv where name = 'P'), 'EVERYTHING')$$, 'an unknown purpose is refused', 'what this invoice is for');
select test.check((select (p -> 'lines') is not null and jsonb_array_length(p -> 'lines') = 2
                          and (select array_agg(l ->> 'serviceCode' order by l ->> 'serviceCode') from jsonb_array_elements(p -> 'lines') l) = array['AI_CALLING', 'META_ADS_MANAGEMENT']
                          and (select bool_and(l ->> 'hsnSac' = '998313' and (l ->> 'taxRate')::numeric = 18 and l ->> 'quantity' = '1 Nos' and l -> 'baseAmount' = 'null'::jsonb)
                                 from jsonb_array_elements(p -> 'lines') l)
                     from (select accounts_invoice_prefill((select id from iv where name = 'P')) p) x),
  'prefill gives one row per service of the purchase (HSN/SAC 998313, 18%, 1 Nos) and leaves the price blank: there is no agreed price per service');
select test.check((select p -> 'customer' ->> 'businessName' = 'Sharma Opticals' and p -> 'customer' ->> 'name' = 'Priya Sharma'
                          and p -> 'customer' ->> 'contactNumber' = '9819900201' and p -> 'customer' ->> 'address' like 'D/1801, Pancham%'
                          and p -> 'customer' ->> 'stateCode' = '27' and p -> 'customer' ->> 'state' = 'Maharashtra' and p -> 'taxTreatment' = '"INTRA_STATE"'
                          and p -> 'customer' -> 'gstin' = 'null'::jsonb and p ->> 'recipientEmail' = 'priya@sharmaopticals.example'
                          and p -> 'sources' ->> 'businessName' = 'CUSTOMER' and p -> 'sources' ->> 'state' = 'ADDRESS'
                          and p ->> 'orderNumber' = 'Verbal' and p ->> 'terms' = '100% Payment Against supply.'
                          and p ->> 'suggestedInvoiceNumber' ~ '^INV-[0-9]{4}-[0-9]{5}$' and p ->> 'invoiceDate' = (now() at time zone 'Asia/Kolkata')::date::text
                          and p -> 'company' ->> 'gstin' = '27BDCPK3585J3Z7' and p -> 'company' ->> 'stateCode' = '27'
                          and jsonb_array_length(p -> 'catalog') > 5
                     from (select accounts_invoice_prefill((select id from iv where name = 'P')) p) x),
  'prefill: business name, address, contact, mobile, state 27 from the address, intra-state, today, Verbal, the default terms');
select test.check((select p -> 'customer' ->> 'stateCode' = '24' and p -> 'taxTreatment' = '"INTER_STATE"' and jsonb_array_length(p -> 'lines') = 1
                          and p -> 'lines' -> 0 ->> 'serviceCode' = 'WHATSAPP_API_BLUE_TICK'
                     from (select accounts_invoice_prefill((select id from iv where name = 'Q')) p) x),
  'a customer in Gujarat is inter-state, and only their own service is listed');
select test.check((select p -> 'customer' -> 'stateCode' = 'null'::jsonb and p -> 'taxTreatment' = 'null'::jsonb and p -> 'customer' -> 'address' = 'null'::jsonb
                          and jsonb_array_length(p -> 'warnings') >= 2 and p ->> 'warnings' like '%state%' and p ->> 'warnings' like '%address%'
                     from (select accounts_invoice_prefill((select id from iv where name = 'R')) p) x),
  'no address and no state on record: both stay blank and Accounts is warned (nothing is invented)');
select test.check((select jsonb_array_length(accounts_invoice_prefill((select id from iv where name = 'P'), 'ADDITIONAL') -> 'lines') = 0), 'an additional purchase starts with no rows: Accounts picks the services');
select test.must_fail($$select accounts_invoice_prefill((select id from iv where name = 'Q'), 'ADDON')$$, 'an add-on invoice needs an approved add-on request', 'approved add-on request');

-- the onboarding cards come before the customer record
reset role;
insert into customer_onboarding (customer_id) values ((select id from iv where name = 'Q')) on conflict (customer_id) do nothing;
insert into customer_onboarding_entries (customer_id, item_code, value, status) values
  ((select id from iv where name = 'Q'), 'BUSINESS_NAME', 'Patel Textiles Pvt Ltd', 'SAVED'),
  ((select id from iv where name = 'Q'), 'BUSINESS_ADDRESS', '14 Ring Road, Surat, Gujarat 395002', 'SAVED')
  on conflict (customer_id, item_code) do update set value = excluded.value, status = excluded.status;
set role authenticated;
select test.login('acc_m');
select test.check((select p -> 'customer' ->> 'businessName' = 'Patel Textiles Pvt Ltd' and p -> 'customer' ->> 'address' = '14 Ring Road, Surat, Gujarat 395002'
                          and p -> 'sources' ->> 'businessName' = 'ONBOARDING' and p -> 'sources' ->> 'address' = 'ONBOARDING'
                     from (select accounts_invoice_prefill((select id from iv where name = 'Q')) p) x),
  'what was collected in onboarding (business name, address) is preferred over the lead record');

-- ---------------------------------------------------------------------------
\echo '--- 32. Dynamic invoices: issue (stage 1) and validation'
-- ---------------------------------------------------------------------------
insert into rq (name) select n from unnest(array['P1', 'P1b', 'P2', 'P3', 'Q1', 'Q2', 'bad']) n;
insert into pl values ('base', jsonb_build_object(
  'customerId', (select id from iv where name = 'P'), 'purpose', 'SERVICES', 'invoiceNumber', null,
  'invoiceDate', (now() at time zone 'Asia/Kolkata')::date, 'orderNumber', 'Verbal',
  'customer', jsonb_build_object('name', 'Priya Sharma', 'businessName', 'Sharma Opticals', 'address', 'D/1801, Pancham, Nanded City, Sinhagad Road, Pune 411068, Maharashtra',
                                 'contactPerson', 'Priya Sharma', 'contactNumber', '9819900201', 'gstin', '27AADFZ2948M1ZI', 'stateCode', '27'),
  'taxTreatment', 'INTRA_STATE', 'terms', '100% Payment Against supply.',
  'lines', jsonb_build_array(
    jsonb_build_object('serviceCode', 'AI_CALLING', 'particulars', 'WhatsApp Official Registration Platform Charges Bulk Campaign | Live Chat | CRM | chat bot',
                       'hsnSac', '998313', 'taxRate', 18, 'quantity', '1 Year', 'baseAmount', 10000),
    jsonb_build_object('serviceCode', 'META_ADS_MANAGEMENT', 'particulars', '30K Utility Message for Campaign Unlimited Validity',
                       'hsnSac', '998313', 'taxRate', 18, 'quantity', '30K Msg', 'baseAmount', 6000))));
-- variants used by the refusal checks
insert into pl select 'no_address', jsonb_set(body, '{customer,address}', '""') from pl where name = 'base';
insert into pl select 'bad_gstin', jsonb_set(body, '{customer,gstin}', '"27AADFZ2948M1Z"') from pl where name = 'base';
insert into pl select 'no_state', jsonb_set(body, '{customer,stateCode}', '"99"') from pl where name = 'base';
insert into pl select 'mismatch', jsonb_set(body, '{customer,gstin}', '"24AAAAA0000A1Z5"') from pl where name = 'base';
insert into pl select 'override_no_reason', jsonb_set(body, '{taxTreatment}', '"INTER_STATE"') from pl where name = 'base';
insert into pl select 'no_treatment', body - 'taxTreatment' from pl where name = 'base';
insert into pl select 'future', jsonb_set(body, '{invoiceDate}', to_jsonb(((now() at time zone 'Asia/Kolkata')::date + 3)::text)) from pl where name = 'base';
insert into pl select 'ancient', jsonb_set(body, '{invoiceDate}', '"2016-01-01"') from pl where name = 'base';
insert into pl select 'zero', jsonb_set(body, '{lines,0,baseAmount}', '0') from pl where name = 'base';
insert into pl select 'negative', jsonb_set(body, '{lines,1,baseAmount}', '-6000') from pl where name = 'base';
insert into pl select 'decimals', jsonb_set(body, '{lines,0,baseAmount}', '10.005') from pl where name = 'base';
insert into pl select 'blank', jsonb_set(body, '{lines,0,baseAmount}', '""') from pl where name = 'base';
insert into pl select 'tax101', jsonb_set(body, '{lines,0,taxRate}', '101') from pl where name = 'base';
insert into pl select 'bad_hsn', jsonb_set(body, '{lines,0,hsnSac}', '"ABC"') from pl where name = 'base';
insert into pl select 'no_particulars', jsonb_set(body, '{lines,0,particulars}', '" "') from pl where name = 'base';
insert into pl select 'bad_service', jsonb_set(body, '{lines,0,serviceCode}', '"NO_SUCH_SERVICE"') from pl where name = 'base';
insert into pl select 'no_lines', jsonb_set(body, '{lines}', '[]') from pl where name = 'base';
insert into pl select 'many_lines', jsonb_set(body, '{lines}', (select jsonb_agg(body #> '{lines,0}') from pl, generate_series(1, 51) where name = 'base')) from pl where name = 'base';
insert into pl select 'bad_mobile', jsonb_set(body, '{customer,contactNumber}', '"abc"') from pl where name = 'base';
insert into pl select 'no_name', jsonb_set(jsonb_set(body, '{customer,name}', '""'), '{customer,businessName}', '""') from pl where name = 'base';

select test.must_fail($$select accounts_issue_invoice(null, (select body from pl where name = 'base'))$$, 'a request reference is required', 'reference');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), '{"customerId":"nope"}'::jsonb)$$, 'a customer must be chosen', 'Choose the customer');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select jsonb_set(body, '{customerId}', to_jsonb((select id::text from iv where name = 'S'))) from pl where name = 'base'))$$,
  'a customer Accounts may not invoice is not found', 'not found');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select jsonb_set(body, '{purpose}', '"WHATEVER"') from pl where name = 'base'))$$, 'the purpose is validated', 'what this invoice is for');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'no_address'))$$, 'the business address is required', 'business address');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'no_name'))$$, 'a name is required', 'business name');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'bad_gstin'))$$, 'an invalid GSTIN is refused', 'GSTIN is not valid');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'no_state'))$$, 'an unknown state is refused', 'state');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'mismatch'))$$, 'a GSTIN of another state needs Accounts to confirm', 'GSTIN belongs to');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'override_no_reason'))$$, 'a tax treatment that differs from the state needs a reason', 'Say why');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'no_treatment'))$$, 'the tax treatment must be chosen', 'tax treatment');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'future'))$$, 'a future invoice date is refused', 'cannot be in the future');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'ancient'))$$, 'a date before GST is refused', 'cannot be in the future');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'zero'))$$, 'a zero amount is refused', 'Line 1');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'negative'))$$, 'a negative amount is refused (and names the line)', 'Line 2');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'decimals'))$$, 'three decimals are refused', 'up to 2 decimals');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'blank'))$$, 'a blank amount is refused', 'Line 1');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'tax101'))$$, 'a tax rate over 100 is refused', 'from 0 to 100');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'bad_hsn'))$$, 'the HSN/SAC must be digits', 'HSN/SAC');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'no_particulars'))$$, 'the particulars are required', 'particulars');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'bad_service'))$$, 'a service must be in the catalogue', 'catalogue');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'no_lines'))$$, 'at least one line is required', 'at least one');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'many_lines'))$$, 'more than 50 lines is refused', 'at most 50');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select body from pl where name = 'bad_mobile'))$$, 'a contact number must look like one', 'contact number');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select jsonb_set(body, '{invoiceNumber}', '"INV 1!"') from pl where name = 'base'))$$, 'an invoice number with odd characters is refused', 'letters, numbers');
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'bad'), (select jsonb_set(body, '{invoiceNumber}', '"ABCDEFGHIJKLMNOPQ"') from pl where name = 'base'))$$, 'an invoice number over 16 characters is refused', 'up to 16');
reset role;
select test.check((select count(*) = 0 from generated_invoices) and (select count(*) = 0 from member_invoices where kind = 'GENERATED'), 'none of the refused requests left anything behind');
set role authenticated;
select test.login('acc_m');

-- issue the invoice for the original services
insert into res select 'P1', accounts_issue_invoice((select id from rq where name = 'P1'), (select body from pl where name = 'base'));
select test.check((select data ->> 'number' ~ '^INV-[0-9]{4}-[0-9]{5}$' and data ->> 'kind' = 'GENERATED' and data ->> 'status' = 'Pending'
                          and (data ->> 'total')::numeric = 18880 and (data ->> 'subtotal')::numeric = 16000 and (data ->> 'tax')::numeric = 2880
                          and (data ->> 'replayed')::boolean = false and data -> 'generated' ->> 'lifecycle' = 'ISSUED'
                     from res where name = 'P1'), 'the invoice is issued: Rs.16,000 + Rs.2,880 GST = Rs.18,880, unpaid, with an automatic number');
select test.check((select g ->> 'taxTreatment' = 'INTRA_STATE' and (g -> 'totals' ->> 'cgstAmount')::numeric = 1440 and (g -> 'totals' ->> 'sgstAmount')::numeric = 1440
                          and (g -> 'totals' ->> 'igstAmount')::numeric = 0 and (g -> 'totals' ->> 'cgstRate')::numeric = 9
                          and g -> 'totals' ->> 'inWords' = 'Eighteen Thousand Eight Hundred Eighty Only/-'
                          and jsonb_array_length(g -> 'lines') = 2
                          and (g -> 'lines' -> 0 ->> 'baseAmount')::numeric = 10000 and (g -> 'lines' -> 0 ->> 'gstAmount')::numeric = 1800 and (g -> 'lines' -> 0 ->> 'totalAmount')::numeric = 11800
                          and (g -> 'lines' -> 1 ->> 'gstAmount')::numeric = 1080 and (g -> 'lines' -> 1 ->> 'totalAmount')::numeric = 7080
                          and g -> 'lines' -> 0 ->> 'quantity' = '1 Year' and g -> 'lines' -> 1 ->> 'quantity' = '30K Msg'
                          and g -> 'customer' ->> 'state' = 'Maharashtra' and g -> 'customer' ->> 'gstin' = '27AADFZ2948M1ZI'
                          and g ->> 'orderNumber' = 'Verbal' and (g ->> 'reverseCharge')::boolean = false
                     from (select data -> 'generated' g from res where name = 'P1') x), 'the stored snapshot: line values, tax split, words, quantities, customer, order number');
select test.check((select g -> 'unpaid' ->> 'pdfStatus' = 'PENDING' and g -> 'unpaid' ->> 'emailStatus' = 'PENDING' and g -> 'paid' ->> 'pdfStatus' = 'NOT_DUE' and g -> 'paid' ->> 'emailStatus' = 'NOT_DUE'
                     from (select data -> 'generated' g from res where name = 'P1') x), 'nothing is stored or sent yet, and the paid stage is not due');
select test.check((select not (data::text like '%storage%') and not (data::text like '%r2://%') from res where name = 'P1'), 'the invoice JSON never carries a storage reference');
-- a repeated request (double click, retry) is the same invoice
insert into res select 'P1again', accounts_issue_invoice((select id from rq where name = 'P1'), (select body from pl where name = 'base'));
select test.check((select a.data ->> 'id' = b.data ->> 'id' and a.data ->> 'number' = b.data ->> 'number' and (b.data ->> 'replayed')::boolean
                     from res a, res b where a.name = 'P1' and b.name = 'P1again'), 'a repeated request returns the same invoice and number');
reset role;
select test.check((select count(*) = 1 from generated_invoices where customer_id = (select id from iv where name = 'P')) and (select count(*) = 1 from member_invoices where kind = 'GENERATED'),
  'and creates no second invoice');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_ISSUED' and entity_id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'issuing is audited once');
select test.check((select count(*) = 1 from notifications where type = 'INVOICE_ISSUED' and recipient_id = test.id('tm_a') and entity_id = (select id from iv where name = 'P')), 'the salesperson is told');
select test.check((select count(*) = 0 from client_notifications where customer_id = (select id from iv where name = 'P') and type = 'INVOICE_ISSUED'), 'the client is NOT told yet: the PDF is not stored');
select test.check((select owner_id = test.id('acc_m') and issued_by = test.id('acc_m') and amount = 18880 and subtotal = 16000 and tax_total = 2880 and status = 'Pending'
                          and issue_date = (now() at time zone 'Asia/Kolkata')::date::text
                     from member_invoices where id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'the invoice row carries the trusted totals');
set role authenticated;
select test.login('acc_m');
-- (a second invoice for the agreed services is now allowed, for the next part payment: see journeys_test.sql, section 47)
select test.must_fail($$select accounts_issue_invoice((select id from rq where name = 'P1'), (select jsonb_set(body, '{customerId}', to_jsonb((select id::text from iv where name = 'Q'))) from pl where name = 'base'))$$,
  'a request reference cannot be reused for another customer', 'already used');

-- the browser's own totals are never trusted: extra figures in a line are ignored
insert into pl select 'forged', jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(body, '{taxTreatment}', '"INTER_STATE"'), '{customerId}', to_jsonb((select id::text from iv where name = 'Q'))), '{purpose}', '"ADDITIONAL"'),
    '{lines}', jsonb_build_array(jsonb_build_object('particulars', 'Brand Setup', 'hsnSac', '998313', 'taxRate', 18, 'quantity', '1 Nos', 'baseAmount', 10000,
                                                    'gstAmount', 1000, 'totalAmount', 11000))),
    '{customer}', jsonb_build_object('name', 'Quresh Patel', 'businessName', 'Patel Textiles', 'address', 'Plot 4, GIDC, Surat, Gujarat', 'stateCode', '24'))
  || jsonb_build_object('totalAmount', 11000, 'subtotal', 1, 'amountInWords', 'One Only/-') from pl where name = 'base';
insert into res select 'Q1', accounts_issue_invoice((select id from rq where name = 'Q1'), (select body from pl where name = 'forged'));
select test.check((select (data ->> 'total')::numeric = 11800 and (data -> 'generated' -> 'lines' -> 0 ->> 'gstAmount')::numeric = 1800
                          and data -> 'generated' -> 'totals' ->> 'inWords' = 'Eleven Thousand Eight Hundred Only/-'
                          and data -> 'generated' ->> 'taxTreatment' = 'INTER_STATE' and (data -> 'generated' -> 'totals' ->> 'igstAmount')::numeric = 1800
                     from res where name = 'Q1'), 'figures sent by the browser (11,000 total, GST 1,000, words) are ignored: the database recalculates Rs.11,800 with IGST');
-- a tax treatment different from the state is allowed with a reason, and recorded
insert into pl select 'q_override', jsonb_set(jsonb_set(body, '{taxTreatment}', '"INTRA_STATE"'), '{taxOverrideReason}', '"Supply to a unit in Maharashtra"') from pl where name = 'forged';
insert into res select 'Q2', accounts_issue_invoice((select id from rq where name = 'Q2'), (select body from pl where name = 'q_override'));
select test.check((select data -> 'generated' ->> 'taxTreatment' = 'INTRA_STATE' and (data -> 'generated' ->> 'taxTreatmentOverridden')::boolean
                          and data -> 'generated' ->> 'taxOverrideReason' = 'Supply to a unit in Maharashtra'
                          and (data -> 'generated' -> 'totals' ->> 'cgstAmount')::numeric = 900 and (data -> 'generated' -> 'totals' ->> 'sgstAmount')::numeric = 900
                     from res where name = 'Q2'), 'an explained override is recorded with the invoice (CGST 900 + SGST 900)');

-- a GSTIN of another state is accepted once Accounts confirms it, and an address-less customer can still be billed (the address is typed)
insert into pl select 'r_mismatch', jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(body, '{customerId}', to_jsonb((select id::text from iv where name = 'R'))), '{purpose}', '"ADDITIONAL"'),
    '{customer,gstin}', '"24AAAAA0000A1Z5"'), '{customer,name}', '"Ravi Rao"'), '{customer,businessName}', '"Rao Clinic"'), '{acknowledgeStateMismatch}', 'true')
  from pl where name = 'base';
insert into rq (name) values ('R1');
insert into res select 'R1', accounts_issue_invoice((select id from rq where name = 'R1'), (select body from pl where name = 'r_mismatch'));
select test.check((select data -> 'generated' -> 'customer' ->> 'gstin' = '24AAAAA0000A1Z5' and data -> 'generated' -> 'customer' ->> 'stateCode' = '27' and (data ->> 'total')::numeric = 18880
                     from res where name = 'R1'), 'a GSTIN of another state is accepted once Accounts confirms it, and the state on the invoice is the one chosen');

-- a typed number is kept as typed, checked for duplicates, and six rows with four rates add up
insert into pl select 'p_additional', jsonb_set(jsonb_set(jsonb_set(body, '{purpose}', '"ADDITIONAL"'), '{invoiceNumber}', '"GST/26-27/135"'),
    '{lines}', jsonb_build_array(
      jsonb_build_object('particulars', 'WhatsApp API setup', 'hsnSac', '998313', 'taxRate', 18, 'quantity', '1 Year', 'baseAmount', 10000),
      jsonb_build_object('particulars', 'Campaign messages', 'hsnSac', '998313', 'taxRate', 18, 'quantity', '30K Msg', 'baseAmount', 6000),
      jsonb_build_object('particulars', 'QR stands', 'hsnSac', '998313', 'taxRate', 18, 'quantity', '5 Nos', 'baseAmount', 2499.99),
      jsonb_build_object('particulars', 'Printed material', 'hsnSac', '4911', 'taxRate', 12, 'quantity', '1 Lot', 'baseAmount', 15000.50),
      jsonb_build_object('particulars', 'Books', 'hsnSac', '4901', 'taxRate', 5, 'quantity', '3 Nos', 'baseAmount', 999),
      jsonb_build_object('particulars', 'Exempt item', 'hsnSac', '998313', 'taxRate', 0, 'quantity', '1 Nos', 'baseAmount', 1))) from pl where name = 'base';
insert into res select 'P3', accounts_issue_invoice((select id from rq where name = 'P3'), (select body from pl where name = 'p_additional'));
select test.check((select data ->> 'number' = 'GST/26-27/135' and (data ->> 'subtotal')::numeric = 34500.49 and (data ->> 'tax')::numeric = 5180.01 and (data ->> 'total')::numeric = 39680.50
                          and jsonb_array_length(data -> 'generated' -> 'lines') = 6 and (data -> 'generated' -> 'totals' ->> 'cgstAmount')::numeric = 2590.01
                          and (data -> 'generated' -> 'totals' ->> 'sgstAmount')::numeric = 2590.00 and data -> 'generated' -> 'totals' -> 'cgstRate' = 'null'::jsonb
                          and jsonb_array_length(data -> 'generated' -> 'totals' -> 'breakdown') = 4
                          and data -> 'generated' -> 'totals' ->> 'inWords' = 'Thirty Nine Thousand Six Hundred Eighty and Fifty Paise Only/-'
                     from res where name = 'P3'), 'six rows at 18% / 12% / 5% / 0%: every row, the CGST + SGST split, no misleading single rate, words with paise');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), (select body from pl where name = 'p_additional'))$$, 'the same invoice number cannot be used twice', 'already exists');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), (select jsonb_set(body, '{invoiceNumber}', '"gst/26-27/135"') from pl where name = 'p_additional'))$$, 'not even in another letter case', 'already exists');

-- ---------------------------------------------------------------------------
\echo '--- 33. Dynamic invoices: the issued snapshot cannot change'
-- ---------------------------------------------------------------------------
reset role;
select test.must_fail($$update generated_invoices set total_amount = 1 where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'the total cannot be edited', 'cannot be edited');
select test.must_fail($$update generated_invoices set customer_name = 'Someone else' where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor the customer', 'cannot be edited');
select test.must_fail($$update generated_invoices set invoice_number = 'X1' where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor the number', 'cannot be edited');
select test.must_fail($$update generated_invoices set tax_treatment = 'INTER_STATE' where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor the tax treatment', 'cannot be edited');
select test.must_fail($$delete from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'an issued invoice cannot be deleted', 'cannot be deleted');
select test.must_fail($$update generated_invoice_items set base_amount = 1 where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'a line cannot be edited', 'cannot be changed');
select test.must_fail($$delete from generated_invoice_items where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor removed', 'cannot be changed');
select test.must_fail($$update member_invoices set amount = 1 where id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'the invoice amount cannot be edited', 'cannot be edited');
select test.must_fail($$update member_invoices set invoice_number = 'Z9' where id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor the invoice number', 'cannot be edited');
select test.must_fail($$delete from member_invoices where id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor can the invoice be deleted', 'cannot be deleted');
select test.must_fail($$insert into generated_invoice_items (invoice_id, position, particulars, hsn_sac, tax_rate, quantity_text, base_amount, gst_amount, total_amount)
  values ((select (data ->> 'id')::uuid from res where name = 'P1'), 9, 'Sneaky', '998313', 18, '1 Nos', 100, 17, 117)$$, 'a line with the wrong GST is refused by the table itself', 'gst_check');
select test.must_fail($$update generated_invoices set unpaid_pdf_status = 'STORED' where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'a document cannot be "stored" without its reference', 'unpaid_ref_check');
select test.must_fail($$update generated_invoices set paid_pdf_status = 'PENDING', paid_email_status = 'PENDING' where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$,
  'the paid stage cannot open before the payment is confirmed', 'paid_stage_check');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$update member_invoices set status = 'Paid' where id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nobody writes the invoice table directly', 'permission denied');
select test.must_fail($$select accounts_set_invoice_status((select (data ->> 'id')::uuid from res where name = 'P1'), 'Paid')$$, 'the old mark-paid switch does not apply to a generated invoice', 'Confirm Payment');

-- ---------------------------------------------------------------------------
\echo '--- 34. Dynamic invoices: unpaid PDF and e-mail, with retries'
-- ---------------------------------------------------------------------------
create temp table snap (name text primary key, data jsonb);
grant all on snap to authenticated;
insert into snap select 'P1_issued', data -> 'generated' from res where name = 'P1';
select test.must_fail($$select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID')$$, 'the paid invoice cannot be started before the payment', 'Confirm the payment first');
select test.must_fail($$select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'MAYBE')$$, 'an unknown stage is refused', 'unpaid or the paid');
select test.check((select (c ->> 'claimed')::boolean and c -> 'invoice' ->> 'recipientEmail' = 'priya@sharmaopticals.example' and c -> 'invoice' ->> 'number' = (select data ->> 'number' from res where name = 'P1')
                          and jsonb_array_length(c -> 'invoice' -> 'lines') = 2 and c -> 'invoice' ->> 'stage' = 'UNPAID'
                     from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID') c) x), 'the stage is claimed and the snapshot to draw the PDF from is returned');
select test.check((select not (c ->> 'claimed')::boolean and c ->> 'reason' = 'BUSY' from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID') c) x),
  'a second click while the first is working gets BUSY: the work is not done twice');
select test.must_fail($$select accounts_invoice_record_email((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'SENT', 'priya@sharmaopticals.example', 'm1', null)$$,
  'an e-mail cannot be recorded before the PDF is stored', 'not stored yet');
-- the PDF reference is checked: only the one expected object, only below 500,000 bytes
select test.must_fail($$select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'R2', 'customer-documents', 'customers/x/other.pdf', 'r2://b/customer-documents/customers/x/other.pdf', 'e', 40000)$$,
  'a path that is not this invoice''s file is refused', 'not the stored invoice file');
select test.must_fail($$select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'LOCAL', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf', 'x', 'e', 40000)$$, 'an unknown storage provider is refused', 'not the stored invoice file');
select test.must_fail($$select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/paid.pdf',
  'r2://b/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/paid.pdf', 'e', 40000)$$,
  'the unpaid stage cannot be pointed at the paid file', 'not the stored invoice file');
select test.must_fail($$select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf',
  'r2://b/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf', 'e', 500000)$$,
  'a PDF of 500,000 bytes is refused (the limit is strictly below)', 'smaller than 500,000');
select test.must_fail($$select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf',
  'r2://b/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf', 'e', 0)$$,
  'an empty PDF is refused', 'smaller than 500,000');
-- a failed upload: say so, keep the invoice, free the lease so it can be retried
select test.check((select g -> 'unpaid' ->> 'pdfStatus' = 'FAILED' and g -> 'unpaid' ->> 'pdfError' = 'R2 did not answer' and not (g -> 'unpaid' ->> 'busy')::boolean
                     from (select accounts_invoice_record_failure((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'PDF', 'R2 did not answer') -> 'generated' g) x),
  'a failed upload is recorded, the lease is freed and nothing pretends it worked');
select test.check((select (c ->> 'claimed')::boolean from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID') c) x), 'and the step can be claimed again');
-- the PDF is stored
select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf',
  'r2://amuwa-files/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf', 'etag-unpaid-1', 41234);
reset role;
select test.check((select unpaid_pdf_status = 'STORED' and unpaid_storage_provider = 'R2' and unpaid_storage_bucket = 'customer-documents'
                          and unpaid_storage_path like 'customers/%/invoices/%/unpaid.pdf' and unpaid_storage_ref like 'r2://amuwa-files/customer-documents/customers/%'
                          and unpaid_storage_etag = 'etag-unpaid-1' and unpaid_size_bytes = 41234 and unpaid_stored_at is not null and unpaid_pdf_error is null
                          and paid_storage_ref is null and paid_pdf_status = 'NOT_DUE'
                     from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'the unpaid PDF reference (provider, bucket, path, ref, ETag, size) is stored, and only that');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_PDF_STORED' and entity_id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'storing the PDF is audited');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from iv where name = 'P') and type = 'INVOICE_ISSUED'), 'the client is told only now that the PDF is stored');
set role authenticated;
select test.login('acc_m');
-- a repeated record never replaces the first stored reference
select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf',
  'r2://amuwa-files/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf', 'etag-OTHER', 41000);
reset role;
select test.check((select unpaid_storage_etag = 'etag-unpaid-1' and unpaid_size_bytes = 41234 from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')),
  'storing again changes nothing: one stored reference per document');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from iv where name = 'P') and type = 'INVOICE_ISSUED'), 'and does not notify the client twice');
set role authenticated;
select test.login('acc_m');
-- the e-mail: not sent, failed, then sent; never marked sent before it was
select test.check((select g -> 'unpaid' ->> 'emailStatus' = 'NOT_SENT' and (g -> 'unpaid' ->> 'emailAttempts')::int = 1 and g -> 'unpaid' ->> 'emailError' like 'Dry run%' and g -> 'unpaid' -> 'emailSentAt' = 'null'::jsonb
                     from (select accounts_invoice_record_email((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'NOT_SENT', 'priya@sharmaopticals.example', null, 'Dry run: nothing was sent') -> 'generated' g) x),
  'a dry run is "not sent": no sent time, the reason is kept');
select test.check((select (c ->> 'claimed')::boolean from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID') c) x), 'a retry can claim the delivery again');
select test.check((select g -> 'unpaid' ->> 'emailStatus' = 'FAILED' and (g -> 'unpaid' ->> 'emailAttempts')::int = 2 and g -> 'unpaid' ->> 'pdfStatus' = 'STORED'
                     from (select accounts_invoice_record_failure((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'EMAIL', 'SMTP sign-in failed') -> 'generated' g) x),
  'an e-mail failure is recorded and does not lose the stored PDF');
select test.check((select (c ->> 'claimed')::boolean from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID') c) x), 'claimed again');
select test.check((select g -> 'unpaid' ->> 'emailStatus' = 'SENT' and g -> 'unpaid' ->> 'emailTo' = 'priya@sharmaopticals.example' and g -> 'unpaid' -> 'emailSentAt' <> 'null'::jsonb
                          and (g -> 'unpaid' ->> 'emailAttempts')::int = 3 and g -> 'unpaid' -> 'emailError' = 'null'::jsonb
                     from (select accounts_invoice_record_email((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'SENT', 'priya@sharmaopticals.example', '<m1@example>', null) -> 'generated' g) x),
  'only when the mail server accepted it is the e-mail SENT (with when and to whom)');
select test.check((select g -> 'unpaid' ->> 'emailStatus' = 'SENT' and (g -> 'unpaid' ->> 'emailAttempts')::int = 3
                     from (select accounts_invoice_record_email((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'FAILED', 'x@y.z', null, 'late') -> 'generated' g) x),
  'a sent e-mail is never downgraded or counted twice');
select test.check((select not (c ->> 'claimed')::boolean and c ->> 'reason' = 'DONE' from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID') c) x),
  'once stored and sent the stage is DONE: nothing is generated or sent again');
select test.must_fail($$select accounts_invoice_record_email((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'MAYBE', null, null, null)$$, 'an unknown e-mail outcome is refused', 'Unknown stage or outcome');
select test.must_fail($$select accounts_invoice_record_failure((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'SOMETHING', 'x')$$, 'an unknown step is refused', 'Unknown stage or step');
-- a failure recorded after the e-mail was sent changes nothing
select test.check((select g -> 'unpaid' ->> 'emailStatus' = 'SENT'
                     from (select accounts_invoice_record_failure((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'EMAIL', 'late error') -> 'generated' g) x), 'a late failure report does not undo a sent e-mail');
select test.check((select g -> 'unpaid' ->> 'pdfStatus' = 'STORED'
                     from (select accounts_invoice_record_failure((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID', 'PDF', 'late error') -> 'generated' g) x), 'nor a stored PDF');

-- the client sees the unpaid invoice now
select test.login('inv_cl_p');
select test.check((select jsonb_array_length(client_invoices()) = 1 and (client_invoices() -> 0 ->> 'generated')::boolean and (client_invoices() -> 0 ->> 'hasFile')::boolean
                          and client_invoices() -> 0 ->> 'fileKind' = 'UNPAID' and client_invoices() -> 0 ->> 'status' = 'Pending' and not (client_invoices() -> 0 ->> 'paidFilePending')::boolean
                          and (client_invoices() -> 0 ->> 'amount')::numeric = 18880 and (client_invoices() -> 0 ->> 'tax')::numeric = 2880 and jsonb_array_length(client_invoices() -> 0 -> 'items') = 2
                          and client_invoices() -> 0 -> 'items' -> 0 ->> 'quantity' = '1 Year' and not (client_invoices()::text like '%r2://%')
                     ), 'the client sees the unpaid invoice (amount, GST, lines) with a file to open, and no storage reference');
select test.check((select count(*) = 1 and bool_and(storage_provider = 'R2' and storage_bucket = 'customer-documents' and storage_path like 'customers/%/invoices/%/unpaid.pdf' and original_file_name like '%-invoice.pdf')
                     from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'P1'))), 'the client downloads exactly the stored unpaid file');
select test.check((select count(*) = 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' = 'INVOICE_ISSUED'), 'one notification');
select test.login('inv_cl_q');
select test.check((select not exists (select 1 from jsonb_array_elements(client_invoices()) i where i ->> 'number' = (select data ->> 'number' from res where name = 'P1'))), 'another client does not see it');
select test.must_fail($$select * from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'P1'))$$, 'another client cannot download it', 'not found');
select test.check((select jsonb_array_length(client_invoices()) = 0), 'client Q has no visible invoice yet: theirs has no stored PDF');
select test.must_fail($$select * from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'Q1'))$$, 'an invoice whose PDF is not stored cannot be downloaded', 'no file yet');
select test.login('tm_a');
select test.must_fail($$select * from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'P1'))$$, 'staff cannot use the client download', 'clients only');

-- ---------------------------------------------------------------------------
\echo '--- 35. Dynamic invoices: confirm the payment (stage 2) and the paid PDF'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'UPI')$$, 'a salesperson cannot confirm a payment', 'Only the Accounts department');
select test.login('inv_cl_p');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'UPI')$$, 'a client cannot confirm their own payment', 'Only the Accounts department');
select test.login('tm_c');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'UPI')$$, 'staff of another department cannot', 'Only the Accounts department');
select test.login('acc_m');
select test.must_fail($$select accounts_confirm_invoice_payment(gen_random_uuid(), 'UPI')$$, 'an unknown invoice is not found', 'not found');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), '')$$, 'the way the payment came in is required', 'how the payment was received');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'BARTER')$$, 'and must be a known one', 'how the payment was received');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'UPI', 'T1', null, (now() at time zone 'Asia/Kolkata')::date + 2)$$, 'a future payment date is refused', 'cannot be in the future');
select test.check((select data ->> 'status' = 'Pending' from (select (invoice_detail((select (data ->> 'id')::uuid from res where name = 'P1')) ) as data) x), 'still unpaid after the refused attempts');

insert into res select 'P1paid', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'UPI', 'UPI-TXN-77', 'Received in the bank');
select test.check((select data ->> 'status' = 'Paid' and data -> 'generated' ->> 'lifecycle' = 'PAID' and not (data ->> 'replayed')::boolean
                          and data -> 'generated' -> 'payment' ->> 'method' = 'UPI' and data -> 'generated' -> 'payment' ->> 'reference' = 'UPI-TXN-77'
                          and data -> 'generated' -> 'payment' ->> 'confirmedBy' = 'Accounts Member' and data -> 'generated' -> 'payment' ->> 'note' = 'Received in the bank'
                          and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'PENDING' and data -> 'generated' -> 'paid' ->> 'emailStatus' = 'PENDING'
                          and data -> 'paidAt' <> 'null'::jsonb
                     from res where name = 'P1paid'), 'payment confirmed: Paid, the paid stage is now due, who and how recorded');
-- the issued snapshot is exactly what it was
select test.check((select (a - array['lifecycle', 'payment', 'unpaid', 'paid', 'paymentSummary']) = (b - array['lifecycle', 'payment', 'unpaid', 'paid', 'paymentSummary'])
                     from (select s.data a, r.data -> 'generated' b from snap s, res r where s.name = 'P1_issued' and r.name = 'P1paid') x),
  'the invoice number, customer, lines, tax rates, totals, terms and words are exactly what was issued');
select test.check((select (r.data ->> 'number') = (i.data ->> 'number') and (r.data ->> 'total') = (i.data ->> 'total') from res r, res i where r.name = 'P1paid' and i.name = 'P1'), 'same invoice number and amount');
select test.check((select g -> 'unpaid' ->> 'pdfStatus' = 'STORED' and g -> 'unpaid' ->> 'emailStatus' = 'SENT' from (select data -> 'generated' g from res where name = 'P1paid') x), 'the unpaid document and e-mail state are untouched');
-- a double click / retry: the same payment, nothing recorded twice
insert into res select 'P1paid2', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'P1'), 'CASH', 'OTHER-REF', 'second click');
select test.check((select (data ->> 'replayed')::boolean and data -> 'generated' -> 'payment' ->> 'method' = 'UPI' and data -> 'generated' -> 'payment' ->> 'reference' = 'UPI-TXN-77' from res where name = 'P1paid2'),
  'a repeated confirmation changes nothing (the first method and reference stay)');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_PAYMENT_CONFIRMED' and entity_id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'the payment is audited once');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from iv where name = 'P') and type = 'PAYMENT_CONFIRMED'), 'the client gets one payment confirmation');
select test.check((select count(*) = 1 from notifications where type = 'INVOICE_PAID' and recipient_id = test.id('tm_a')), 'the salesperson is told once');
select test.must_fail($$update member_invoices set status = 'Pending' where id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'a confirmed payment cannot be reversed by editing the invoice', 'cannot be reversed');
select test.must_fail($$update generated_invoices set lifecycle = 'ISSUED' where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')$$, 'nor by editing the snapshot', 'cannot be reversed|paid_stage_check');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_set_invoice_status((select (data ->> 'id')::uuid from res where name = 'P1'), 'Pending')$$, 'nor with the older status switch', 'Confirm Payment');

-- the paid document is not available to the client until it is stored and linked
select test.login('inv_cl_p');
select test.check((select client_invoices() -> 0 ->> 'status' = 'Paid' and not (client_invoices() -> 0 ->> 'hasFile')::boolean and (client_invoices() -> 0 ->> 'paidFilePending')::boolean
                          and client_invoices() -> 0 -> 'fileKind' = 'null'::jsonb), 'the client sees Paid, but no paid file yet ("being prepared")');
select test.must_fail($$select * from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'P1'))$$, 'the paid file cannot be downloaded before it is stored', 'being prepared');
select test.login('acc_m');
select test.check((select (c ->> 'claimed')::boolean and c -> 'invoice' ->> 'stage' = 'PAID' and c -> 'invoice' -> 'payment' ->> 'method' = 'UPI' from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID') c) x),
  'the paid stage is claimed (the snapshot now carries the payment)');
select test.must_fail($$select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf',
  'r2://amuwa-files/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/unpaid.pdf', 'e', 40000)$$,
  'the paid stage cannot be recorded against the unpaid file', 'not the stored invoice file');
select accounts_invoice_record_pdf((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID', 'R2', 'customer-documents',
  'customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/paid.pdf',
  'r2://amuwa-files/customer-documents/customers/' || (select id from iv where name = 'P') || '/invoices/' || (select data ->> 'id' from res where name = 'P1') || '/paid.pdf', 'etag-paid-1', 43500);
reset role;
select test.check((select paid_pdf_status = 'STORED' and paid_storage_path like '%/paid.pdf' and unpaid_storage_path like '%/unpaid.pdf' and paid_storage_ref <> unpaid_storage_ref
                          and paid_storage_etag = 'etag-paid-1' and unpaid_storage_etag = 'etag-unpaid-1' and paid_size_bytes = 43500 and unpaid_size_bytes = 41234
                     from generated_invoices where invoice_id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'the unpaid and the paid PDF have separate references, ETags and sizes');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from iv where name = 'P') and type = 'INVOICE_PAID_READY'), 'the client is told the paid invoice is ready (this is what refreshes their screen)');
set role authenticated;
select test.login('inv_cl_p');
select test.check((select client_invoices() -> 0 ->> 'fileKind' = 'PAID' and (client_invoices() -> 0 ->> 'hasFile')::boolean and not (client_invoices() -> 0 ->> 'paidFilePending')::boolean
                     and client_invoices() -> 0 ->> 'status' = 'Paid'), 'the paid invoice is offered once it is stored and linked');
select test.check((select count(*) = 1 and bool_and(storage_path like 'customers/%/invoices/%/paid.pdf' and original_file_name like '%-paid-invoice.pdf')
                     from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'P1'))), 'the client downloads exactly the stored paid file, not a regenerated one');
select test.login('inv_cl_q');
select test.must_fail($$select * from client_invoice_download((select (data ->> 'id')::uuid from res where name = 'P1'))$$, 'another client cannot download the paid invoice', 'not found');
select test.login('acc_m');
select test.check((select g -> 'paid' ->> 'pdfStatus' = 'STORED' and g -> 'paid' ->> 'emailStatus' = 'PENDING'
                     from (select invoice_detail((select (data ->> 'id')::uuid from res where name = 'P1')) -> 'generated' g) x), 'the paid e-mail is a separate, still pending step');
select accounts_invoice_release((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID');
select test.check((select (c ->> 'claimed')::boolean from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID') c) x), 'a retry of the paid stage resumes at the e-mail');
select accounts_invoice_record_failure((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID', 'EMAIL', 'Could not reach the mail server');
select test.check((select (c ->> 'claimed')::boolean from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID') c) x), 'and again');
select test.check((select g -> 'paid' ->> 'emailStatus' = 'SENT' and g -> 'unpaid' ->> 'emailStatus' = 'SENT' and (g -> 'paid' ->> 'emailAttempts')::int = 2
                     from (select accounts_invoice_record_email((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID', 'SENT', 'priya@sharmaopticals.example', '<m2@example>', null) -> 'generated' g) x),
  'the paid e-mail is recorded on its own; the unpaid one is untouched');
select test.check((select not (c ->> 'claimed')::boolean and c ->> 'reason' = 'DONE' from (select accounts_invoice_claim((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID') c) x), 'the paid stage is DONE');
select test.check((select (a - array['lifecycle', 'payment', 'unpaid', 'paid', 'paymentSummary']) = (b - array['lifecycle', 'payment', 'unpaid', 'paid', 'paymentSummary'])
                     from (select s.data a, invoice_detail((select (data ->> 'id')::uuid from res where name = 'P1')) -> 'generated' b from snap s where s.name = 'P1_issued') x),
  'after both stages the issued snapshot is still exactly as issued');

-- staff may open the stored files (anyone who may read the invoice); nobody else
select test.login('tm_a');
select test.check((select count(*) = 1 and bool_and(storage_provider = 'R2' and storage_path like '%/paid.pdf') from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID', 'DOWNLOAD')), 'the salesperson of the customer can open the paid file');
select test.check((select bool_and(storage_path like '%/unpaid.pdf') from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID')), 'and the unpaid file');
select test.login('tm_c');
select test.must_fail($$select * from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID')$$, 'a salesperson of another department cannot open the unpaid file either', 'not found');
select test.login('tm_a');
select test.login('tm_c');
select test.must_fail($$select * from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID')$$, 'staff of another department cannot open it', 'not found');
select test.login('inv_cl_p');
select test.must_fail($$select * from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'P1'), 'PAID')$$, 'a client uses the client download, not this one', 'not found');
select test.must_fail($$select invoice_detail((select (data ->> 'id')::uuid from res where name = 'P1'))$$, 'a client cannot read an invoice through the staff detail function (their own or another''s)', 'not found');
select test.login('inv_cl_q');
select test.must_fail($$select invoice_detail((select (data ->> 'id')::uuid from res where name = 'P1'))$$, 'another client cannot read it either', 'not found');
select test.must_fail($$select * from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'P1'), 'UNPAID')$$, 'nor open its file', 'not found');
select test.must_fail($$select visible_invoices()$$, 'the staff invoice list is closed to a client', 'Sign in again');
select test.login('acc_m');
select test.must_fail($$select * from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'Q1'), 'PAID')$$, 'a paid file that was never stored is not available', 'not available yet');
select test.must_fail($$select * from invoice_file_access((select (data ->> 'id')::uuid from res where name = 'Q1'), 'NEITHER')$$, 'an unknown stage is refused', 'unpaid or the paid');
reset role;
select test.check((select count(*) >= 2 from audit_logs where action in ('INVOICE_DOWNLOADED', 'INVOICE_VIEWED') and entity_id = (select (data ->> 'id')::uuid from res where name = 'P1')), 'opening a stored invoice is audited');

-- ---------------------------------------------------------------------------
\echo '--- 36. Dynamic invoices: an approved add-on'
-- ---------------------------------------------------------------------------
-- the consultant priced an add-on and Accounts approved it (the request itself is covered by the add-on suite)
insert into addon_requests (id, customer_id, department_id, status, subtotal, discount_total, tax_total, total, version)
  select gen_random_uuid(), c.id, c.department_id, 'APPROVED', 5000, 0, 900, 5900, 1 from customers c where c.id = (select id from iv where name = 'P');
insert into addon_request_items (request_id, service_code, name, quantity, unit_price, discount, tax_percent, tax, line_total, sort_order)
  select r.id, 'AI_CALLING', 'Extra AI Calling minutes', 1, 5000, 0, 18, 900, 5900, 1 from addon_requests r where r.customer_id = (select id from iv where name = 'P');
create temp table ar0 as select id from addon_requests where customer_id = (select id from iv where name = 'P');
grant select on ar0 to authenticated;
set role authenticated;
select test.login('acc_m');
select test.check((select p ->> 'addonTotal' = '5900.00' and jsonb_array_length(p -> 'lines') = 1 and p -> 'lines' -> 0 ->> 'particulars' = 'Extra AI Calling minutes'
                          and (p -> 'lines' -> 0 ->> 'baseAmount')::numeric = 5000 and (p -> 'lines' -> 0 ->> 'taxRate')::numeric = 18 and p -> 'lines' -> 0 ->> 'quantity' = '1 Nos'
                     from (select accounts_invoice_prefill((select id from iv where name = 'P'), 'ADDON') p) x),
  'the add-on prefill lists only the approved add-on (not the original services), at the approved price');
insert into pl select 'addon', jsonb_set(jsonb_set(body, '{purpose}', '"ADDON"'), '{lines}',
  (select accounts_invoice_prefill((select id from iv where name = 'P'), 'ADDON') -> 'lines')) from pl where name = 'base';
insert into pl select 'addon_wrong', jsonb_set(body, '{lines,0,baseAmount}', '4000') from pl where name = 'addon';
insert into pl select 'addon_noreq', jsonb_set(body, '{addonRequestId}', 'null') from pl where name = 'addon';
update pl set body = jsonb_set(body, '{addonRequestId}', to_jsonb((select id::text from ar0)))  where name in ('addon', 'addon_wrong');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), (select body from pl where name = 'addon_wrong'))$$, 'an add-on invoice must match the approved total', 'must match the approved add-on total');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), (select body from pl where name = 'addon_noreq'))$$, 'an add-on invoice needs its request', 'add-on request');
insert into res select 'A1', accounts_issue_invoice(gen_random_uuid(), (select body from pl where name = 'addon'));
select test.check((select (data ->> 'total')::numeric = 5900 and data ->> 'addonRequestId' = (select id::text from ar0)
                     from res where name = 'A1'), 'the add-on invoice is issued for the approved total');
reset role;
select test.check((select status = 'INVOICE_GENERATED' and invoice_id = (select (data ->> 'id')::uuid from res where name = 'A1') from addon_requests where customer_id = (select id from iv where name = 'P')),
  'the add-on request moves on to "invoice generated", exactly like an uploaded add-on invoice');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), (select body from pl where name = 'addon'))$$, 'the same add-on cannot be invoiced twice', 'cannot take another invoice');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'A1'), 'UPI')$$, 'an add-on payment needs the verified payments first', 'verified|payment');
select test.check((select data ->> 'status' = 'Pending' from (select invoice_detail((select (data ->> 'id')::uuid from res where name = 'A1')) data) x), 'and nothing was confirmed');
reset role;
insert into addon_payments (request_id, customer_id, amount, method, reference, status, recorded_by, verified_by, verified_at)
  select r.id, r.customer_id, 5900, 'UPI', 'ADDON-UPI-1', 'VERIFIED', test.id('acc_m'), test.id('acc_m'), now() from addon_requests r where r.customer_id = (select id from iv where name = 'P');
set role authenticated;
select test.login('acc_m');
insert into res select 'A1paid', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from res where name = 'A1'), 'UPI', 'ADDON-UPI-1');
select test.check((select data ->> 'status' = 'Paid' and data -> 'generated' ->> 'lifecycle' = 'PAID' and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'PENDING' from res where name = 'A1paid'),
  'with the payments verified, confirming the invoice payment confirms the add-on payment too and opens the paid stage');
reset role;
select test.check((select status = 'PAYMENT_CONFIRMED' from addon_requests where customer_id = (select id from iv where name = 'P')), 'the add-on request is "payment confirmed"');

-- ---------------------------------------------------------------------------
\echo '--- 37. Dynamic invoices: the migration is re-runnable and keeps the data'
-- ---------------------------------------------------------------------------
create temp table before_rerun as select
  (select count(*) from member_invoices) as invoices, (select count(*) from generated_invoices) as generated, (select count(*) from generated_invoice_items) as items,
  (select md5(string_agg(g::text, '|' order by invoice_id)) from generated_invoices g) as snapshot_hash;
\i supabase/migrations/20261028000100_dynamic_invoices_two_stage.sql
select test.check((select b.invoices = (select count(*) from member_invoices) and b.generated = (select count(*) from generated_invoices)
                          and b.items = (select count(*) from generated_invoice_items)
                          and b.snapshot_hash = (select md5(string_agg(g::text, '|' order by invoice_id)) from generated_invoices g) from before_rerun b),
  'applying the migration again loses and changes nothing (invoices, lines, snapshots, storage references)');
select test.check((select count(*) = 37 from gst_states), 'and the state list is not duplicated');
set role authenticated;
select test.login('acc_m');
select test.check((select jsonb_array_length(accounts_invoices(p_kind => 'GENERATED') -> 'items') >= 5), 'generated invoices appear in the Accounts invoice list');
select test.check((select (accounts_invoices(p_search => 'GST/26-27/135') ->> 'total')::int = 1), 'and can be found by number');
select test.login('tm_a');
select test.check((select count(*) >= 3 from jsonb_array_elements(visible_invoices() -> 'items') i where i ->> 'kind' = 'GENERATED' and i -> 'generated' ->> 'number' is not null), 'the salesperson sees the generated invoices of their customers');
select test.login('tm_c');
select test.check((select count(*) = 0 from jsonb_array_elements(visible_invoices() -> 'items') i where i ->> 'kind' = 'GENERATED'), 'and another department sees none');
reset role;

\echo '=== ALL DYNAMIC INVOICE TESTS PASSED ==='
