-- =============================================================================
-- Service journeys, Support leads, Accounts client-login provisioning, delivery routing and invoice balances
-- (migration 20261029000100). Runs after the other suites on the same database and reuses their `test` helpers and staff.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- The invoices suite above re-applies the earlier invoice migration (to prove it is re-runnable), which puts back its older
-- generated_json / claim / confirm functions. Re-apply this migration too (proving it is re-runnable as well).
\i supabase/migrations/20261029000100_service_journeys_support_balance.sql
\i supabase/migrations/20261030000100_part_payment_invoices.sql
\i supabase/migrations/20261102000100_invoice_prefill_agreed_amount.sql
\i supabase/migrations/20261103000100_order_tax_basis.sql
-- the newest money model (GST belongs to the order) goes back on top of the older definitions re-applied above
\i supabase/migrations/20261201000100_order_level_gst.sql
create temp table jc (name text primary key, id uuid);
create temp table jr (name text primary key, data jsonb);
create temp table jq (name text primary key, id uuid default gen_random_uuid());
create temp table jpay (name text primary key, id uuid);
grant all on jc, jr, jq, jpay to authenticated, service_role;

-- A one-line invoice payload for a customer (Pune, Maharashtra: intra-state), the amount before GST as given
create function test.inv_payload(p_customer uuid, p_base numeric, p_purpose text default 'SERVICES') returns jsonb language sql as $$
  select jsonb_build_object('customerId', p_customer, 'purpose', p_purpose, 'invoiceNumber', null,
    'invoiceDate', (now() at time zone 'Asia/Kolkata')::date, 'orderNumber', 'Verbal',
    'customer', jsonb_build_object('name', 'Test Customer', 'businessName', 'Test Business', 'address', 'Nanded City, Pune 411068, Maharashtra',
                                   'contactPerson', 'Test Customer', 'contactNumber', '9820000999', 'gstin', null, 'stateCode', '27'),
    'taxTreatment', 'INTRA_STATE', 'terms', '100% Payment Against supply.',
    'lines', jsonb_build_array(jsonb_build_object('serviceCode', null, 'particulars', 'Services as agreed', 'hsnSac', '998313', 'taxRate', 18,
                                                  'quantity', '1 Nos', 'baseAmount', p_base)))
$$;
grant execute on function test.inv_payload(uuid, numeric, text) to authenticated;

-- Design Studio staff: the department that delivers the services that need no Technical Consultant
select test.create_auth_user('ds_head', 'ds.head@amuwa.com', '{"full_name":"DS Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('designstudio')));
select test.create_auth_user('ds_mem', 'ds.mem@amuwa.com', '{"full_name":"DS Member"}',
  jsonb_build_object('provisioned_by', test.id('ds_head'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('designstudio', 'General')));

-- ---------------------------------------------------------------------------
\echo '--- 40. Support: leads, referral source, conversations, Send to Accounts'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('sup_plain');
insert into jc select 'S1', create_lead('{"name":"Sushma Rao","company":"Rao Boutique","email":"sushma@raoboutique.example","phone":"9820000101","whatsapp":"9820000101",
  "leadSource":"Referral","notes":"Referred by a friend of the team"}', array['DS_META_ADS']);
select test.check((select owner_id = test.id('sup_plain') and lifecycle_stage = 'LEAD' and lead_source = 'Referral' and whatsapp = '9820000101'
                     and team_id = test.team('wabastore', 'Support') from customers where id = (select id from jc where name = 'S1')),
  'a Support member creates a lead: they own it, it sits in their Support team, with the referral source and the WhatsApp number as saved');
select test.check((select count(*) = 1 from customers where phone = '9820000101'), 'one customer record for the lead');
select test.check((select count(*) = 1 from customer_services where customer_id = (select id from jc where name = 'S1') and service_code = 'DS_META_ADS'), 'the selected service is saved on the lead');
select add_lead_conversation((select id from jc where name = 'S1'), 'Interested in Meta Ads for the shop; wants to start this month.');
select test.check((select jsonb_array_length(customer_conversations((select id from jc where name = 'S1'))) = 2), 'Support records conversations like Sales (the note typed with the lead is the first)');
select update_lead((select id from jc where name = 'S1'), '{"leadStatus":"INTERESTED"}'::jsonb, null);
select test.check((select lead_status = 'INTERESTED' from customers where id = (select id from jc where name = 'S1')), 'Support tracks the lead status');
-- who can see it
select test.login('tm_a');
select test.check((select count(*) = 0 from customers where phone = '9820000101'), 'a Sales member does not see a Support member''s lead');
select test.must_fail($$select add_lead_conversation((select id from jc where name = 'S1'), 'sneaky')$$, 'nor write to it', 'not found');
select test.login('th_wab');
select test.check((select count(*) = 0 from customers where phone = '9820000101'), 'the Sales team head does not see it either');
select test.login('sup_th');
select test.check((select count(*) = 1 from customers where phone = '9820000101'), 'the Support team head sees the team''s leads');
select test.login('dh_wab');
select test.check((select count(*) = 1 from customers where phone = '9820000101'), 'and so does the department head');
select test.login('tm_c');
select test.check((select count(*) = 0 from customers where phone = '9820000101'), 'another department sees nothing');
-- and a Sales lead stays private from Support
select test.login('tm_a');
insert into jc select 'A1', create_lead('{"name":"Arun Joshi","company":"Joshi Traders","email":"arun@joshitraders.example","phone":"9820000102","leadSource":"Walk-in"}', array['AI_CALLING']);
select test.login('sup_plain');
select test.check((select count(*) = 0 from customers where id = (select id from jc where name = 'A1')), 'a Sales lead is not visible to Support');
select test.must_fail($$select send_lead_to_accounts((select id from jc where name = 'A1'), 5000, null)$$, 'and cannot be sent to Accounts by Support', 'not found');

-- Send to Accounts
select test.must_fail($$select send_lead_to_accounts((select id from jc where name = 'S1'), 0, null)$$, 'the agreed amount is required', 'agreed amount');
select send_lead_to_accounts((select id from jc where name = 'S1'), 10000, 'Customer ready to pay half now');
select test.check((select payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' and deal_amount = 10000 and lead_status = 'READY_TO_BUY' from customers where id = (select id from jc where name = 'S1')),
  'Send to Accounts: the same customer record now waits for payment confirmation with the agreed amount');
select test.must_fail($$select send_lead_to_accounts((select id from jc where name = 'S1'), 10000, null)$$, 'a second submission is refused', 'already with Accounts');
select test.check((select count(*) = 1 from customers where phone = '9820000101'), 'still one customer record: nothing was duplicated');
reset role;
select test.check((select count(*) = 1 from payment_requests where customer_id = (select id from jc where name = 'S1')), 'one payment request, no duplicate');
select test.check((select requested_by = test.id('sup_plain') and requested_at is not null from payment_requests where customer_id = (select id from jc where name = 'S1')),
  'the submitting Support member and the time are recorded');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from jc where name = 'S1') and type = 'SENT_TO_ACCOUNTS'), 'the history keeps the submission');
set role authenticated;
select test.login('acc_m');
select test.check((select count(*) = 1 from jsonb_array_elements(accounts_payment_requests('PENDING', null, 1, 50) -> 'items') i
                    where i ->> 'id' = (select id::text from jc where name = 'S1') and i ->> 'sentFrom' = 'SUPPORT' and i ->> 'journey' = 'DIRECT'
                      and i ->> 'clientLogin' = 'NOT_STARTED' and (i -> 'services') = '["Meta Ads"]'::jsonb and (i ->> 'agreedAmount')::numeric = 10000),
  'the Accounts queue shows it with the services, the agreed amount, that Support sent it, its journey and the login state');

-- ---------------------------------------------------------------------------
\echo '--- 41. One shared service catalogue and its journey settings'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
create temp table cat_a as select code from crm_services order by code;
select test.login('sup_plain');
create temp table cat_s as select code from crm_services order by code;
select test.login('tm_c');
create temp table cat_c as select code from crm_services order by code;
reset role;
select test.check((select count(*) > 15 from cat_a) and (select array_agg(code) from cat_a) = (select array_agg(code) from cat_s) and (select array_agg(code) from cat_a) = (select array_agg(code) from cat_c),
  'Sales, Support and another department all read the same catalogue rows (one table, no per-department copies)');
select test.check((select count(*) = 0 from information_schema.columns where table_schema = 'public' and column_name = 'service_code' and table_name like '%department%'), 'no department-specific service table exists');
select test.check((select count(*) = 6 from crm_services where not requires_technical_consultant and delivery_department_id = test.dept('designstudio') and code like 'DS\_%')
               and (select count(*) = 0 from crm_services where not requires_technical_consultant and code not like 'DS\_%'),
  'only the six Design Studio services are configured to skip the Technical Consultant, delivered by the Design Studio; everything else keeps the existing journey');
select test.check((select requires_technical_consultant from crm_services where code = 'WHATSAPP_API_BLUE_TICK'), 'the Webstore WhatsApp service still needs the Technical Consultant');
set role authenticated;
select test.login('sup_plain');
select test.check((select count(*) = (select count(*) from crm_services) from jsonb_array_elements(service_journeys())), 'every signed-in staff member can read the journey settings');
select test.must_fail($$select set_service_journey('GBP_SETUP', false, test.dept('designstudio'))$$, 'a Support member cannot change how a service is delivered', 'Only the Super Admin');
select test.login('dh_wab');
select test.must_fail($$select set_service_journey('GBP_SETUP', false, test.dept('designstudio'))$$, 'nor a department head', 'Only the Super Admin');
select test.login('acc_m');
select test.must_fail($$select set_service_journey('GBP_SETUP', false, test.dept('designstudio'))$$, 'nor Accounts', 'Only the Super Admin');
select test.login('sa');
select test.must_fail($$select set_service_journey('GBP_SETUP', false, null)$$, 'a service without a Technical Consultant needs a delivery department', 'Choose the department');
select test.must_fail($$select set_service_journey('NO_SUCH', true, null)$$, 'an unknown service is not found', 'not found');
select set_service_journey('GBP_SETUP', false, test.dept('designstudio'));
select test.check((select not requires_technical_consultant and delivery_department_id = test.dept('designstudio') from crm_services where code = 'GBP_SETUP'), 'the Super Admin can configure a service');
select set_service_journey('GBP_SETUP', true, null);
select test.check((select requires_technical_consultant and delivery_department_id is null from crm_services where code = 'GBP_SETUP'), 'and put it back');
reset role;
select test.check((select count(*) = 2 from audit_logs where action = 'SERVICE_JOURNEY_CHANGED'), 'both changes are in the audit log');
select test.must_fail($$update crm_services set requires_technical_consultant = false, delivery_department_id = null where code = 'GBP_SETUP'$$, 'the database refuses a service with neither a Technical Consultant nor a delivery department', 'crm_services_journey_check');

-- ---------------------------------------------------------------------------
\echo '--- 42. Direct journey: Support -> Accounts -> login -> Sales verifies -> delivery department'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('acc_m');
select test.check((accounts_payment_requests('PENDING', null, 1, 50) -> 'items' -> 0 ->> 'journey') is not null, 'the queue is readable by Accounts');
select test.check((customer_journey_info((select id from jc where name = 'S1')) ->> 'journey') = 'DIRECT'
               and (customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'PENDING_PAYMENT'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'createLogin') = 'false',
  'the Meta Ads customer follows the direct journey; with no verified payment the login cannot be made yet');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com')$$, 'no login before a payment is verified', 'Verify a payment first');
-- a pending (unverified) payment does not count
select accounts_record_payment((select id from jc where name = 'S1'), 'PART', 3000, 'CASH', null, null, 'cash at the desk', false);
reset role;
insert into jpay select 'S1p', id from customer_payments where customer_id = (select id from jc where name = 'S1');
set role authenticated;
select test.login('acc_m');
select test.admin_check($q$select amount_verified = 0 and amount_received = 3000 and payment_status = 'PENDING_VERIFICATION' from customers where id = (select id from jc where name = 'S1')$q$, 'an unverified payment is recorded but not counted as received');
select test.must_fail($$select accounts_confirm_and_return((select id from jc where name = 'S1'))$$, 'an unverified payment cannot confirm the customer', 'verify the payment');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com')$$, 'and gives no login either', 'Verify a payment first');
select accounts_verify_payment((select id from jpay where name = 'S1p'), 'seen in the till');
select test.admin_check($q$select amount_verified = 3000 and payment_status = 'PARTIALLY_PAID' from customers where id = (select id from jc where name = 'S1')$q$, 'verified: part paid');
select test.check((customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'LOGIN_PENDING'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'createLogin') = 'true'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'returnToSales') = 'false',
  'part payment verified: next is the login, and Return to Sales is not offered yet');
select test.must_fail($$select accounts_confirm_and_return((select id from jc where name = 'S1'))$$, 'Return to Sales needs the client login first', 'dashboard login');

-- who may create the login
select test.login('tm_a');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com')$$, 'a Sales member cannot create the login', 'Only the Accounts department');
select test.login('sup_plain');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com')$$, 'nor the Support member who owns the customer', 'Only the Accounts department');
select test.must_fail($$select record_client_account((select id from jc where name = 'S1'), gen_random_uuid(), 'x@example.com', null)$$, 'nor record a login', 'not found');
select test.login('tc_dash');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com')$$, 'nor a Technical Consultant', 'Only the Accounts department');
select test.must_fail($$select accounts_client_login_failed((select id from jc where name = 'S1'), 'x')$$, 'nor mark it failed', 'Only the Accounts department');

select test.login('acc_m');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'not-an-email')$$, 'a bad e-mail is refused', 'valid e-mail');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'a@amuwa.com')$$, 'an e-mail that already has a login is refused', 'already has a login');
select test.admin_check($q$select count(*) = 0 from customer_client_accounts where customer_id = (select id from jc where name = 'S1')$q$, 'nothing was created by the refusals');
select accounts_client_login_begin((select id from jc where name = 'S1'), 'Sushma.Client@Example.com');
select test.check((customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'status') = 'PENDING'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'email') = 'sushma.client@example.com', 'login being created: pending, e-mail stored in lower case');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com')$$, 'a second click while it is being created is refused', 'already being created');
select accounts_client_login_failed((select id from jc where name = 'S1'), 'The sign-in service did not answer.');
select test.check((customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'status') = 'FAILED'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'lastError') = 'The sign-in service did not answer.'
               and (customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'LOGIN_FAILED',
  'a failure is shown with its reason');
select test.must_fail($$select accounts_confirm_and_return((select id from jc where name = 'S1'))$$, 'a failed login does not let the customer through', 'dashboard login');
-- retry: allowed, counted
select accounts_client_login_begin((select id from jc where name = 'S1'), 'sushma.client@example.com');
select test.check((customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'attempts') = '2', 'the retry is counted');
reset role;
-- the server creates the Auth user (as GoTrue would), then records it
select test.create_auth_user('s1_client', 'sushma.client@example.com', '{}'::jsonb,
  jsonb_build_object('provider', 'email', 'client_customer_id', (select id from jc where name = 'S1')));
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select record_client_account((select id from jc where name = 'S1'), test.id('s1_client'), 'someone.else@example.com', null)$$, 'a login for another e-mail is not accepted', 'not created for this customer');
select record_client_account((select id from jc where name = 'S1'), test.id('s1_client'), 'sushma.client@example.com', null);
select test.check((customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'status') = 'CREATED'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'clientLogin' ->> 'email') = 'sushma.client@example.com'
               and (customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'LOGIN_CREATED'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'returnToSales') = 'true'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'createLogin') = 'false',
  'login created: shown as created, Return to Sales is now offered');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'S1'), 'another@example.com')$$, 'a second login for the same customer is refused', 'already has a login');
select test.must_fail($$select record_client_account((select id from jc where name = 'S1'), test.id('s1_client'), 'sushma.client@example.com', null)$$, 'recording it twice is refused', 'duplicate|already');
select test.admin_check($q$select count(*) = 1 from customer_client_accounts where customer_id = (select id from jc where name = 'S1')$q$, 'exactly one login exists');
reset role;
select test.check((select status = 'CREATED' and attempts = 2 and last_error is null from customer_client_provisioning where customer_id = (select id from jc where name = 'S1')), 'the provisioning record settled as created after two attempts');
select test.check((select raw_app_meta_data ->> 'client_customer_id' = (select id::text from jc where name = 'S1') from auth.users where id = test.id('s1_client')), 'the login is tied to this customer only');
set role authenticated;
select test.login('s1_client');
select test.check((client_me() ->> 'customerId') = (select id::text from jc where name = 'S1') and (client_me() ->> 'loginEmail') = 'sushma.client@example.com',
  'the customer signs in to their own client dashboard: identity comes from client_me');
select test.login('acc_m');

-- the Accounts step is done: Return to Sales
select accounts_confirm_and_return((select id from jc where name = 'S1'), 'Login ready, part payment verified');
select test.admin_check($q$select lifecycle_stage = 'ONBOARDING' and payment_workflow = 'PAYMENT_CONFIRMED' and amount_verified = 3000 and deal_amount = 10000 and owner_id = test.id('sup_plain')
                     from customers where id = (select id from jc where name = 'S1')$q$, 'returned: the SAME customer, back with its owner, payment (3,000 of 10,000) and agreed amount kept');
select test.admin_check($q$select (select count(*) = 1 from customers where phone = '9820000101') and (select count(*) = 1 from customer_services where customer_id = (select id from jc where name = 'S1'))$q$, 'no duplicate customer or service');
select test.must_fail($$select accounts_confirm_and_return((select id from jc where name = 'S1'))$$, 'a second return is refused', 'not waiting for payment confirmation');
select test.admin_check($q$select count(*) = 1 from payment_requests where customer_id = (select id from jc where name = 'S1') and status = 'CONFIRMED'$q$, 'the request is closed');
reset role;
select test.check((select items_verified = 0 and returned_at is null from customer_onboarding where customer_id = (select id from jc where name = 'S1')), 'payment confirmation verified no document');
select test.check((select count(*) >= 3 from customer_activities where customer_id = (select id from jc where name = 'S1') and type in ('SENT_TO_ACCOUNTS', 'PAYMENT_CONFIRMED', 'CLIENT_LOGIN_CREATED', 'CLIENT_LOGIN_REQUESTED')), 'the history keeps the submission, the payment and the login');
set role authenticated;
select test.login('sup_plain');
select test.check((customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'RETURNED_TO_SALES' and (customer_journey_info((select id from jc where name = 'S1')) ->> 'journey') = 'DIRECT', 'the owner sees: returned to Sales, documents not started');
select test.check((select count(*) = 1 from customers where id = (select id from jc where name = 'S1') and lifecycle_stage = 'ONBOARDING'), 'it is in the owner''s onboarding list');

-- Accounts issues the invoice for the agreed services: it satisfies the checklist's Invoice item
select test.login('acc_m');
insert into jq (name) values ('S1'), ('S1b'), ('B1'), ('B1x'), ('B2'), ('B3'), ('B4'), ('B5'), ('B6'), ('B7'), ('T1'), ('M1');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'S1b'), test.inv_payload((select id from jc where name = 'S1'), 9000))$$, 'an invoice for more than the agreed amount (10,620 > 10,000) is refused', 'would total');
insert into jr select 'S1inv', accounts_issue_invoice((select id from jq where name = 'S1'), test.inv_payload((select id from jc where name = 'S1'), 8000));
select test.check((select (data ->> 'total')::numeric = 9440 and data -> 'generated' -> 'paymentSummary' ->> 'ledger' = 'CUSTOMER'
                          and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 3000 and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 6440
                          and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'PARTIALLY_PAID'
                     from jr where name = 'S1inv'), 'the invoice (9,440) shows the 3,000 already verified and a balance of 6,440, from the ledger');
reset role;
select test.check((select status = 'SAVED' and value like 'INV-%' from customer_onboarding_entries where customer_id = (select id from jc where name = 'S1') and item_code = 'INVOICE'),
  'the issued invoice fills the checklist''s Invoice item (otherwise the customer could never be sent on)');

-- the customer's details and documents: saved by the owner (simulated here), verified by Sales, not by Accounts or a consultant
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by)
  select (select id from jc where name = 'S1'), i.code, 'saved', 'SAVED', test.id('sup_plain') from private.customer_items((select id from jc where name = 'S1')) i
   where i.code <> 'INVOICE'
  on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress((select id from jc where name = 'S1'));
select test.check((select items_total > 0 and items_saved = items_total and items_verified = 0 from customer_onboarding where customer_id = (select id from jc where name = 'S1')), 'every item is saved, none verified');
set role authenticated;
select test.login('sup_plain');
select test.check((customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'DOCUMENTS_PENDING'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'verifyDocuments') = 'true'
               and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'sendToDelivery') = 'false', 'documents pending verification: sending is not offered');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'cannot be sent before the documents are verified', 'Verify every document');
-- who may verify
select test.login('acc_m');
select test.must_fail($$select review_onboarding_entry((select id from jc where name = 'S1'), 'CUSTOMER_NAME', 'VERIFIED', null)$$, 'Accounts cannot verify documents', 'not found');
select test.must_fail($$select verify_all_onboarding_entries((select id from jc where name = 'S1'))$$, 'nor verify them all', 'not found');
select test.login('tc_dash');
select test.must_fail($$select review_onboarding_entry((select id from jc where name = 'S1'), 'CUSTOMER_NAME', 'VERIFIED', null)$$, 'a Technical Consultant is not the reviewer of a direct service', 'not found');
select test.login('tm_a');
select test.must_fail($$select review_onboarding_entry((select id from jc where name = 'S1'), 'CUSTOMER_NAME', 'VERIFIED', null)$$, 'nor another salesperson', 'not found');
select test.login('sup_plain');
select test.must_fail($$select review_onboarding_entry((select id from jc where name = 'S1'), 'CUSTOMER_NAME', 'REJECTED', null)$$, 'sending a document back needs a reason', 'what needs fixing');
select review_onboarding_entry((select id from jc where name = 'S1'), 'CUSTOMER_MOBILE', 'REJECTED', 'The number does not match the form');
select test.check((select count(*) = 1 from customer_onboarding_entries where customer_id = (select id from jc where name = 'S1') and status = 'REJECTED' and review_note like 'The number%'), 'a rejected item keeps its reason');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'a rejected document blocks sending', 'Verify every document');
select test.check((customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'DOCUMENTS_PENDING', 'still pending while one is rejected');
reset role;
update customer_onboarding_entries set status = 'SAVED', review_note = null where customer_id = (select id from jc where name = 'S1') and status = 'REJECTED';
select private.refresh_onboarding_progress((select id from jc where name = 'S1'));
set role authenticated;
select test.login('sup_plain');
select test.check((verify_all_onboarding_entries((select id from jc where name = 'S1'))) > 0, 'the owner verifies the documents');
select test.check((customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'DOCUMENTS_VERIFIED' and (customer_journey_info((select id from jc where name = 'S1')) -> 'can' ->> 'sendToDelivery') = 'true',
  'documents verified: sending to the department is offered');
reset role;
select test.check((select count(*) = 0 from customer_services where customer_id = (select id from jc where name = 'S1') and sent_to_delivery_at is not null), 'nothing was sent yet');

-- send to the delivery department
set role authenticated;
select test.login('tm_c');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'another department cannot send it', 'not found');
select test.login('acc_m');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'nor Accounts', 'not found');
select test.login('tc_dash');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'nor a Technical Consultant', 'not found');
select test.login('ds_mem');
select test.check((select count(*) = 0 from customers where id = (select id from jc where name = 'S1')), 'the Design Studio sees nothing before it is sent');
select test.login('sup_plain');
select test.check((send_to_delivery_departments((select id from jc where name = 'S1'), 'Please start on the ad account') ->> 'sent') = '1', 'the owner sends the verified service to its department');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'a second send is refused', 'not waiting to be sent|already been sent');
select test.check((select lifecycle_stage = 'CUSTOMER' from customers where id = (select id from jc where name = 'S1')) and (customer_journey_info((select id from jc where name = 'S1')) ->> 'step') = 'SENT_TO_DELIVERY',
  'every service is with its department: the customer is a customer, step "sent to delivery"');
reset role;
select test.check((select delivery_department_id = test.dept('designstudio') and sent_to_delivery_at is not null and sent_to_delivery_by = test.id('sup_plain') and delivery_note = 'Please start on the ad account'
                     from customer_services where customer_id = (select id from jc where name = 'S1') and service_code = 'DS_META_ADS'), 'the service records where, by whom and when it was sent');
select test.check((select count(*) = 0 from customer_onboarding where customer_id = (select id from jc where name = 'S1') and (forwarded_to_support_at is not null or with_consultant)), 'the Technical Consultant step was skipped');
select test.check((select count(*) >= 1 from notifications where type = 'SERVICE_SENT_TO_DELIVERY' and recipient_id = test.id('ds_head')), 'the Design Studio head is told');
set role authenticated;
select test.login('ds_mem');
select test.check((select count(*) = 1 from customers where id = (select id from jc where name = 'S1')), 'the Design Studio now sees the customer');
select test.check((select jsonb_array_length(delivery_queue() -> 'items') = 1 and delivery_queue() -> 'items' -> 0 ->> 'referredFrom' = 'SUPPORT'
                          and (delivery_queue() -> 'items' -> 0 -> 'services' -> 0 ->> 'code') = 'DS_META_ADS' and (delivery_queue() -> 'items' -> 0 ->> 'clientLogin') = 'true'
                          and (delivery_queue() -> 'items' -> 0 ->> 'balance')::numeric = 7000
                     from (select 1) x), 'its delivery queue lists the service, who referred it and the outstanding balance');
select test.check((jsonb_array_length(customer_onboarding_checklist((select id from jc where name = 'S1'))) > 0), 'and it can read what was collected');
select test.must_fail($$select update_lead((select id from jc where name = 'S1'), '{"name":"Changed"}'::jsonb, null)$$, 'but cannot edit the customer', 'not found|Only|FORBIDDEN');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'S1'))$$, 'nor send it on', 'not found');
select test.login('tm_c');
select test.check((select count(*) = 0 from customers where id = (select id from jc where name = 'S1')), 'another department still sees nothing');
select test.must_fail($$select customer_journey_info((select id from jc where name = 'S1'))$$, 'nor its journey', 'not found');
select test.login('dh_wab');
select test.check((select count(*) = 1 from customers where id = (select id from jc where name = 'S1')), 'the owner''s department head still sees it');
select test.login('s1_client');
select test.must_fail($$select delivery_queue()$$, 'a client cannot read the delivery queue', 'Sign in again|FORBIDDEN');
select test.must_fail($$select customer_journey_info((select id from jc where name = 'S1'))$$, 'nor the staff journey', 'not found');

-- ---------------------------------------------------------------------------
\echo '--- 43. Technical Consultant journey is unchanged'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into jc select 'T1', create_lead('{"name":"Tara Iyer","company":"Iyer Garments","email":"tara@iyergarments.example","phone":"9820000103","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
select send_lead_to_accounts((select id from jc where name = 'T1'), 6000, null);
select test.login('acc_m');
select accounts_record_payment((select id from jc where name = 'T1'), 'PART', 2000, 'UPI', 'T1-UPI', null, null, true);
select test.check((customer_journey_info((select id from jc where name = 'T1')) ->> 'journey') = 'TECHNICAL' and (customer_journey_info((select id from jc where name = 'T1')) -> 'can' ->> 'createLogin') = 'false'
               and (customer_journey_info((select id from jc where name = 'T1')) -> 'can' ->> 'returnToSales') = 'true',
  'a WhatsApp API customer is TECHNICAL: no login at Accounts, and Return to Sales needs no login');
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'T1'), 'tara.client@example.com')$$, 'Accounts cannot create the login of a Technical Consultant customer', 'Technical Consultant');
select accounts_confirm_and_return((select id from jc where name = 'T1'));
select test.admin_check($q$select lifecycle_stage = 'ONBOARDING' and payment_workflow = 'PAYMENT_CONFIRMED' from customers where id = (select id from jc where name = 'T1')$q$, 'the existing return to Sales still works');
reset role;
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by)
  select (select id from jc where name = 'T1'), i.code, 'saved', 'SAVED', test.id('tm_a') from private.customer_items((select id from jc where name = 'T1')) i
  on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress((select id from jc where name = 'T1'));
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select review_onboarding_entry((select id from jc where name = 'T1'), 'CUSTOMER_NAME', 'VERIFIED', null)$$, 'Sales cannot verify a Technical Consultant customer''s documents', 'not found');
select test.must_fail($$select verify_all_onboarding_entries((select id from jc where name = 'T1'))$$, 'nor verify them all', 'not found');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'T1'))$$, 'and cannot route it to a delivery department', 'Technical Consultant');
select test.check((customer_journey_info((select id from jc where name = 'T1')) -> 'can' ->> 'verifyDocuments') = 'false' and (customer_journey_info((select id from jc where name = 'T1')) -> 'can' ->> 'sendToDelivery') = 'false', 'the screen is told not to offer them');
select forward_onboarding_to_support((select id from jc where name = 'T1'));
select test.check((select sent_to_accounts_at is not null or forwarded_to_support_at is not null from customer_onboarding where customer_id = (select id from jc where name = 'T1')), 'the existing "send to the Technical Consultant" step still works');
select test.login('tc_dash');

-- ---------------------------------------------------------------------------
\echo '--- 44. Several services: the right journey and department for each'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into jc select 'M1', create_lead('{"name":"Meera Nair","company":"Nair Studio","email":"meera@nairstudio.example","phone":"9820000104","leadSource":"Walk-in"}', array['AI_CALLING', 'DS_GRAPHIC_DESIGN']);
select test.check((customer_journey_info((select id from jc where name = 'M1')) ->> 'journey') = 'MIXED' and (customer_journey_info((select id from jc where name = 'M1')) ->> 'followsTechnicalConsultant') = 'true'
               and jsonb_array_length(customer_journey_info((select id from jc where name = 'M1')) -> 'services') = 2
               and (select bool_and((s ->> 'requiresTechnicalConsultant')::boolean = (s ->> 'code' <> 'DS_GRAPHIC_DESIGN')) from jsonb_array_elements(customer_journey_info((select id from jc where name = 'M1')) -> 'services') s),
  'a mixed order is MIXED: each service keeps its own identity and setting, the customer follows the Technical Consultant journey');
select send_lead_to_accounts((select id from jc where name = 'M1'), 12000, null);
select test.login('acc_m');
select accounts_record_payment((select id from jc where name = 'M1'), 'FULL', 12000, 'BANK_TRANSFER', 'M1-NEFT', null, null, true);
select test.must_fail($$select accounts_client_login_begin((select id from jc where name = 'M1'), 'meera.client@example.com')$$, 'Accounts does not create the login of a mixed order', 'Technical Consultant');
select accounts_confirm_and_return((select id from jc where name = 'M1'));
reset role;
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by, reviewed_by, reviewed_at)
  select (select id from jc where name = 'M1'), i.code, case when i.code like '%PHONE' then '9820000104' when i.code like '%ADDRESS' then 'Nanded City, Sinhagad Road, Pune 411068' else 'saved' end, 'SAVED', test.id('tm_a'), null, null from private.customer_items((select id from jc where name = 'M1')) i
  on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress((select id from jc where name = 'M1'));
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select review_onboarding_entry((select id from jc where name = 'M1'), 'CUSTOMER_NAME', 'VERIFIED', null)$$, 'Sales cannot verify the documents of a mixed order (the consultant does)', 'not found');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'M1'))$$, 'and cannot route anything before they are verified', 'Verify every document');
reset role;
update customer_onboarding_entries set status = 'VERIFIED', reviewed_by = test.id('tc_dash'), reviewed_at = now() where customer_id = (select id from jc where name = 'M1');
select private.refresh_onboarding_progress((select id from jc where name = 'M1'));
set role authenticated;
select test.login('tm_a');
select test.check((send_to_delivery_departments((select id from jc where name = 'M1')) ->> 'sent') = '1', 'once the consultant verified, only the service that needs no consultant is sent to its department');
reset role;
select test.check((select sent_to_delivery_at is not null and delivery_department_id = test.dept('designstudio') from customer_services where customer_id = (select id from jc where name = 'M1') and service_code = 'DS_GRAPHIC_DESIGN')
               and (select sent_to_delivery_at is null from customer_services where customer_id = (select id from jc where name = 'M1') and service_code = 'AI_CALLING'), 'the Graphic Design service went to the Design Studio, AI Calling did not');
select test.check((select lifecycle_stage = 'ONBOARDING' from customers where id = (select id from jc where name = 'M1')), 'the customer stays in onboarding for the consultant''s service');
set role authenticated;
select test.login('ds_mem');
select test.check((select jsonb_array_length(delivery_queue() -> 'items') = 2 and (select count(*) = 1 from jsonb_array_elements(delivery_queue() -> 'items') i
                    where i ->> 'id' = (select id::text from jc where name = 'M1') and jsonb_array_length(i -> 'services') = 1 and i -> 'services' -> 0 ->> 'code' = 'DS_GRAPHIC_DESIGN')
                     from (select 1) x), 'the Design Studio''s queue shows only its own service of the mixed order');
select test.must_fail($$select send_to_delivery_departments((select id from jc where name = 'M1'))$$, 'and the Design Studio cannot send the rest', 'not found');

-- ---------------------------------------------------------------------------
\echo '--- 45. Invoice balance: the agreed-services ledger'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into jc select 'B1', create_lead('{"name":"Bina Shah","company":"Shah Jewels","email":"bina@shahjewels.example","phone":"9820000105","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from jc where name = 'B1'), 20000, null);
select test.login('acc_m');
select accounts_record_payment((select id from jc where name = 'B1'), 'PART', 5000, 'UPI', 'B1-UPI-1', null, null, true);
select accounts_record_payment((select id from jc where name = 'B1'), 'PART', 3000, 'CASH', null, null, null, false);
reset role;
insert into jpay select 'B1p', id from customer_payments where customer_id = (select id from jc where name = 'B1') and status = 'PENDING';
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'B1x'), test.inv_payload((select id from jc where name = 'B1'), 20000))$$, 'an invoice above the agreed amount is refused (it could never be paid in full)', 'would total');
insert into jr select 'B1inv', accounts_issue_invoice((select id from jq where name = 'B1'), test.inv_payload((select id from jc where name = 'B1'), 16000));
select test.check((select (data ->> 'total')::numeric = 18880 and data -> 'generated' -> 'paymentSummary' ->> 'ledger' = 'CUSTOMER'
                          and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 5000 and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 13880
                          and (data -> 'generated' -> 'paymentSummary' ->> 'pending')::numeric = 3000 and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'PARTIALLY_PAID'
                     from jr where name = 'B1inv'), 'total 18,880 - confirmed 5,000 = balance 13,880; the 3,000 still waiting for verification is shown apart and not counted');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B1inv'))$$, 'the payment cannot be confirmed while the invoice is not covered', '5,000 of .*18,880 is confirmed');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B1inv'), 'UPI', 'X', null, null, 500)$$, 'an amount cannot be typed on an invoice paid through the customer''s payments', 'recorded in Payments');
select accounts_verify_payment((select id from jpay where name = 'B1p'));
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'B1inv')) -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 8000
               and (invoice_detail((select (data ->> 'id')::uuid from jr where name = 'B1inv')) -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 10880, 'once verified, the balance follows the ledger: 8,000 received, 10,880 left');
select accounts_record_payment((select id from jc where name = 'B1'), 'PART', 11000, 'BANK_TRANSFER', 'B1-NEFT', null, null, true);
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'B1inv')) ->> 'status') = 'Pending', 'covered by the ledger, but still unpaid until Accounts confirms: one explicit action');
insert into jr select 'B1paid', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B1inv'));
select test.check((select data ->> 'status' = 'Paid' and (data ->> 'settled')::boolean and not (data ->> 'replayed')::boolean and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'PENDING'
                          and data -> 'generated' -> 'payment' ->> 'method' = 'BANK_TRANSFER' and data -> 'generated' -> 'payment' ->> 'reference' = 'B1-NEFT'
                          and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'FULLY_PAID' and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 0
                     from jr where name = 'B1paid'), 'Confirm Payment: Paid, the paid stage is opened, the last verified payment is the one shown, balance zero');
insert into jr select 'B1again', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B1inv'));
select test.check((select (data ->> 'replayed')::boolean from jr where name = 'B1again'), 'confirming again records nothing new');
select test.admin_check($q$select count(*) = 1 from audit_logs where action = 'INVOICE_PAYMENT_CONFIRMED' and entity_id = (select (data ->> 'id')::uuid from jr where name = 'B1inv')$q$, 'one confirmation in the audit log');
select test.login('tm_a');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B1inv'))$$, 'a salesperson cannot confirm', 'Only the Accounts');
select test.must_fail($$select accounts_verify_payment((select id from jpay where name = 'B1p'))$$, 'nor verify a payment', 'Only the Accounts');
select test.must_fail($$select accounts_confirm_and_return((select id from jc where name = 'S1'))$$, 'nor return a customer from Accounts', 'Only the Accounts');

-- ---------------------------------------------------------------------------
\echo '--- 46. Invoice balance: payments recorded on the invoice (an additional invoice)'
-- ---------------------------------------------------------------------------
select test.login('acc_m');
insert into jr select 'B2inv', accounts_issue_invoice((select id from jq where name = 'B2'), test.inv_payload((select id from jc where name = 'B1'), 10000, 'ADDITIONAL'));
select test.check((select (data ->> 'total')::numeric = 11800 and data -> 'generated' -> 'paymentSummary' ->> 'ledger' = 'INVOICE' and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 11800
                          and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'UNPAID' from jr where name = 'B2inv'),
  'an additional invoice has its own ledger (the customer''s earlier payments are not applied to it): unpaid, balance 11,800');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), '', null, null, null, 5000)$$, 'the way the payment came in is required', 'how the payment was received');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', null, null, null, 5000)$$, 'a UPI payment needs its reference', 'reference');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'AD-1', null, null, 0)$$, 'a zero amount is refused', 'more than zero');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'AD-1', null, null, 11800.005)$$, 'three decimals are refused', 'more than zero');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'AD-1', null, null, 11900)$$, 'more than the balance is refused', 'more than the balance');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'AD-1', null, (now() at time zone 'Asia/Kolkata')::date + 3, 5000)$$, 'a future payment date is refused', 'cannot be in the future');
insert into jr select 'B2p1', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'AD-1', 'first instalment', null, 5000, (select id from jq where name = 'B3'));
select test.check((select data ->> 'status' = 'Pending' and not (data ->> 'settled')::boolean and data -> 'generated' ->> 'lifecycle' = 'ISSUED'
                          and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 5000 and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 6800
                          and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'PARTIALLY_PAID' and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'NOT_DUE'
                     from jr where name = 'B2p1'), 'a part payment (5,000): partially paid, balance 6,800, the invoice stays open and no paid invoice is made');
insert into jr select 'B2p1again', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'AD-1', 'first instalment', null, 5000, (select id from jq where name = 'B3'));
select test.admin_check($q$select count(*) = 1 and sum(amount) = 5000 from invoice_payments where invoice_id = (select (data ->> 'id')::uuid from jr where name = 'B2inv')$q$, 'the same request again records the payment once');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'UPI', 'ad-1', null, null, 100)$$, 'the same reference cannot be recorded twice', 'already recorded');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'CASH', null, null, null, 6800.01)$$, 'nor more than what is left', 'more than the balance');
insert into jr select 'B2p2', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'B2inv'), 'CASH', null, 'balance in cash');
select test.check((select data ->> 'status' = 'Paid' and (data ->> 'settled')::boolean and data -> 'generated' -> 'paid' ->> 'pdfStatus' = 'PENDING'
                          and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 11800 and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 0
                          and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'FULLY_PAID' and data -> 'generated' -> 'payment' ->> 'method' = 'CASH'
                     from jr where name = 'B2p2'), 'the second payment defaults to the whole balance (6,800): fully paid, the paid invoice is now due');
reset role;
select test.check((select count(*) = 2 and sum(amount) = 11800 from invoice_payments where invoice_id = (select (data ->> 'id')::uuid from jr where name = 'B2inv')), 'two payment records, 11,800 in total');
select test.check((select sum(amount) = 11800 from private.verified_income() where customer_id = (select id from jc where name = 'B1') and reference is distinct from 'B1-UPI-1' and reference is distinct from 'B1-NEFT' and payment_type in ('PART', 'FULL') and method in ('UPI', 'CASH') and amount in (5000, 6800)),
  'payments recorded on an invoice count as income like every other verified payment');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select * from invoice_payments$$, 'the invoice payments table has no direct access', 'permission denied');
select test.must_fail($$select * from customer_client_provisioning$$, 'nor the provisioning table', 'permission denied');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 47. An invoice for each part payment'
-- ---------------------------------------------------------------------------
insert into jq (name) values ('PP1'), ('PP2'), ('PP3'), ('PP3b'), ('PPx');
set role authenticated;
select test.login('tm_a');
insert into jc select 'PP', create_lead('{"name":"Pooja Pawar","company":"Pawar Foods","email":"pooja@pawarfoods.example","phone":"9820000106","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from jc where name = 'PP'), 30000, null);
select test.login('acc_m');
select accounts_record_payment((select id from jc where name = 'PP'), 'PART', 10000, 'UPI', 'PP-UPI-1', null, null, true);
insert into jr select 'PP1', accounts_issue_invoice((select id from jq where name = 'PP1'), test.inv_payload((select id from jc where name = 'PP'), 8000));
select test.check((select (data ->> 'total')::numeric = 9440 and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 9440 and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'FULLY_PAID' from jr where name = 'PP1'),
  'the first invoice (9,440) is covered by the first verified payment (10,000)');
insert into jr select 'PP2', accounts_issue_invoice((select id from jq where name = 'PP2'), test.inv_payload((select id from jc where name = 'PP'), 10000));
select test.check((select (data ->> 'total')::numeric = 11800 and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 560
                          and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 11240 and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'PARTIALLY_PAID' from jr where name = 'PP2'),
  'a second invoice for the same customer is allowed: it only gets what is left after the first (560 of 11,800)');
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'PP1')) -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 0, 'the first invoice is not affected by the second');
select test.check((accounts_invoice_prefill((select id from jc where name = 'PP')) ->> 'servicesInvoiced')::numeric = 21240
               and exists (select 1 from jsonb_array_elements(accounts_invoice_prefill((select id from jc where name = 'PP')) -> 'warnings') w where w #>> '{}' like 'Invoices already issued for the agreed services total%'),
  'the builder is told how much is already invoiced, as information (not as a refusal)');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'PP3'), test.inv_payload((select id from jc where name = 'PP'), 15000))$$, 'invoices above the agreed amount together are refused', 'would total .*38,940.*30,000');
select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'PP1'));
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'PP1')) ->> 'status') = 'Paid', 'the first invoice is confirmed paid');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'PP2'))$$, 'the second cannot be confirmed until its own share is paid', '560.* of .*11,800');
select accounts_record_payment((select id from jc where name = 'PP'), 'PART', 12000, 'BANK_TRANSFER', 'PP-NEFT-2', null, null, true);
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'PP2')) -> 'generated' -> 'paymentSummary' ->> 'state') = 'FULLY_PAID'
               and (invoice_detail((select (data ->> 'id')::uuid from jr where name = 'PP2')) -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 0, 'after the next verified payment the second invoice is covered');
select test.check((accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'PP2')) ->> 'settled')::boolean, 'and can be confirmed');
insert into jr select 'PP3', accounts_issue_invoice((select id from jq where name = 'PP3b'), test.inv_payload((select id from jc where name = 'PP'), 7000));
select test.check((select (data ->> 'total')::numeric = 8260 and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 760 and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 7500 from jr where name = 'PP3'),
  'a third invoice within the agreed amount (29,500 of 30,000) is allowed; it gets the 760 left of the 22,000 verified so far');
-- the amount is filled in from the customer's own record: what was agreed, less what is already invoiced
select test.check((select (select count(*) from jsonb_array_elements(p -> 'lines')) = 1
                          and (l ->> 'baseAmount')::numeric > 0
                          and (l ->> 'baseAmount')::numeric + round((l ->> 'baseAmount')::numeric * 18 / 100, 2) between 499.99 and 500
                     from (select accounts_invoice_prefill((select id from jc where name = 'PP')) p) x, jsonb_array_elements(p -> 'lines') l),
  'the builder fills in the balance still to be invoiced for this customer (agreed 30,000 less 29,500 invoiced = 500, with GST)');
select test.login('tm_a');
insert into jc select 'PQ', create_lead('{"name":"Pankaj Qureshi","company":"Qureshi Traders","email":"pankaj@qureshitraders.example","phone":"9820000107","leadSource":"Walk-in"}', array['AI_CALLING', 'META_ADS_MANAGEMENT']);
select test.login('tm_a');
select send_lead_to_accounts((select id from jc where name = 'PQ'), 59000, null);
select test.login('acc_m');
select accounts_record_payment((select id from jc where name = 'PQ'), 'PART', 1000, 'UPI', 'PQ-UPI-1', null, null, true);
select test.check((select jsonb_array_length(p -> 'lines') = 2
                          and (select count(distinct (l ->> 'baseAmount')::numeric) = 1 and bool_and((l ->> 'baseAmount')::numeric = 25000) from jsonb_array_elements(p -> 'lines') l)
                     from (select accounts_invoice_prefill((select id from jc where name = 'PQ')) p) x),
  'two services share the agreed 59,000 equally: 25,000 each before GST (29,500 with GST each)');
select test.check((select (select sum((l ->> 'baseAmount')::numeric + round((l ->> 'baseAmount')::numeric * 18 / 100, 2)) from jsonb_array_elements(p -> 'lines') l) = 59000
                     from (select accounts_invoice_prefill((select id from jc where name = 'PQ')) p) x),
  'with GST the filled-in lines add up to the agreed amount');
select test.check((select (select count(*) from jsonb_array_elements(p -> 'lines') l where l -> 'baseAmount' <> 'null'::jsonb) = 1
                          and (select (l ->> 'baseAmount')::numeric from jsonb_array_elements(p -> 'lines') l limit 1) is not null
                     from (select accounts_invoice_prefill((select id from jc where name = 'PP')) p) x),
  'one customer''s amount does not leak into another''s (PP gets one row, PQ two)');
insert into jq (name) values ('PQ1');
insert into jr select 'PQ1', accounts_issue_invoice((select id from jq where name = 'PQ1'), test.inv_payload((select id from jc where name = 'PQ'), 50000));
select test.check((select (select bool_and(l -> 'baseAmount' = 'null'::jsonb) from jsonb_array_elements(p -> 'lines') l)
                          and exists (select 1 from jsonb_array_elements(p -> 'warnings') w where w #>> '{}' like '%already been invoiced in full%')
                     from (select accounts_invoice_prefill((select id from jc where name = 'PQ')) p) x),
  'once the agreed amount is invoiced in full nothing is filled in, and Accounts is told why');
select test.check((select bool_and(l -> 'baseAmount' = 'null'::jsonb) from jsonb_array_elements(accounts_invoice_prefill((select id from jc where name = 'PQ'), 'ADDITIONAL') -> 'lines') l) is not false,
  'an additional purchase still starts empty');
select test.login('tm_a');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'PPx'), test.inv_payload((select id from jc where name = 'PP'), 100))$$, 'a salesperson still cannot issue one', 'Only the Accounts');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 48. One order: an agreement before GST, the total payable and the order balance'
-- ---------------------------------------------------------------------------
insert into jq (name) values ('GX1'), ('GX2'), ('GX3'), ('GX4'), ('LG1'), ('LG2'), ('LG3');
set role authenticated;
select test.login('tm_a');
insert into jc select 'GX', create_lead('{"name":"Gita Xavier","company":"Xavier Exports","email":"gita@xavierexports.example","phone":"9820000107","leadSource":"Walk-in"}', array['AI_CALLING']);
select test.must_fail($$select send_lead_to_accounts((select id from jc where name = 'GX'), 120000, null, 'NET')$$, 'the basis must be known', 'includes or excludes GST');
select test.must_fail($$select send_lead_to_accounts((select id from jc where name = 'GX'), 120000.5, null, 'EXCLUSIVE')$$, 'the agreed amount is in whole rupees', 'whole rupees');
select send_lead_to_accounts((select id from jc where name = 'GX'), 120000, null, 'EXCLUSIVE');
select test.admin_check($q$select deal_amount = 120000 and agreed_amount = 120000 and agreed_tax_basis = 'EXCLUSIVE' and order_gst_rate is null and payment_status = 'NO_PAYMENT' from customers where id = (select id from jc where name = 'GX')$q$,
  'A: 1,20,000 agreed excluding GST: nothing is added until Accounts chooses the GST rate');
select test.login('acc_m');
select test.check((accounts_set_order_gst((select id from jc where name = 'GX'), 18) -> 'order' ->> 'totalPayable')::numeric = 141600, 'A: Accounts chooses 18% for the order: GST 21,600, total payable 1,41,600');
select test.check((customer_payment_overview((select id from jc where name = 'GX')) -> 'order') @> '{"basis":"EXCLUSIVE","agreedAmount":120000,"taxableTotal":120000,"gstTotal":21600,"totalPayable":141600,"confirmed":0,"balance":141600,"state":"UNPAID"}'::jsonb,
  'the payment screen reads the same order figures before any invoice or payment');
select test.check((accounts_invoice_prefill((select id from jc where name = 'GX')) ->> 'servicesInvoicedTaxable')::numeric = 0
               and accounts_invoice_prefill((select id from jc where name = 'GX')) ->> 'agreedTaxBasis' = 'EXCLUSIVE'
               and (accounts_invoice_prefill((select id from jc where name = 'GX')) ->> 'agreedAmount')::numeric = 120000, 'the invoice builder is told the agreement, its basis and what is already invoiced');

select test.check((select (l ->> 'baseAmount')::numeric = 120000 from jsonb_array_elements(accounts_invoice_prefill((select id from jc where name = 'GX')) -> 'lines') l limit 1),
  'the builder fills in the whole 1,20,000 before GST (not the amount with GST) while nothing is invoiced');
select accounts_record_payment((select id from jc where name = 'GX'), 'PART', 60000, 'UPI', 'GX-UPI-1', null, null, true);
select test.check((customer_payment_overview((select id from jc where name = 'GX')) -> 'order') @> '{"confirmed":60000,"balance":81600,"state":"PARTIALLY_PAID"}'::jsonb
               and customer_payment_overview((select id from jc where name = 'GX')) ->> 'paymentStatus' = 'PARTIALLY_PAID',
  'C: 60,000 confirmed: the ORDER balance is 81,600 (1,41,600 - 60,000), Partially Paid; GST is not applied to the payment');

insert into jr select 'GX1', accounts_issue_invoice((select id from jq where name = 'GX1'), test.inv_payload((select id from jc where name = 'GX'), 60000));
select test.check((select (data ->> 'total')::numeric = 70800 and (data -> 'generated' -> 'totals' ->> 'subtotal')::numeric = 60000 and (data -> 'generated' -> 'totals' ->> 'totalGst')::numeric = 10800
                          and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 60000 and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 10800
                          and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'PARTIALLY_PAID'
                          and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'balance')::numeric = 81600
                          and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'totalPayable')::numeric = 141600
                     from jr where name = 'GX1'), 'B/D: invoice 1 = 60,000 + 10,800 GST = 70,800, 10,800 left on the invoice; the order still has 81,600 to receive');
insert into jr select 'GX2', accounts_issue_invoice((select id from jq where name = 'GX2'), test.inv_payload((select id from jc where name = 'GX'), 60000));
select test.check((select (data ->> 'total')::numeric = 70800 and (data -> 'generated' -> 'paymentSummary' ->> 'confirmed')::numeric = 0
                          and (data -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 70800 and data -> 'generated' -> 'paymentSummary' ->> 'state' = 'UNPAID'
                          and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'invoicedTaxable')::numeric = 120000
                          and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'invoicedGst')::numeric = 21600
                          and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'invoicedTotal')::numeric = 141600
                          and (data -> 'generated' -> 'paymentSummary' -> 'order' ->> 'balance')::numeric = 81600
                     from jr where name = 'GX2'), 'B: the second 70,800 invoice is allowed (cumulative 1,20,000 + 21,600 = 1,41,600); its own balance is 70,800, the order balance 81,600');
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'GX1')) -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 10800, 'invoice 1 is not changed by invoice 2');
select test.check((select (l ->> 'baseAmount') is null from jsonb_array_elements(accounts_invoice_prefill((select id from jc where name = 'GX')) -> 'lines') l limit 1)
               and exists (select 1 from jsonb_array_elements(accounts_invoice_prefill((select id from jc where name = 'GX')) -> 'warnings') w where w #>> '{}' like '%excluding GST) has already been invoiced in full%'),
  'with both invoices issued nothing is filled in and Accounts is told the agreed amount is invoiced in full');

select test.admin_check($q$select deal_amount = 141600 from customers where id = (select id from jc where name = 'GX')$q$, 'the total payable still is 1,41,600 once both invoices exist (the GST is not added twice)');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'GX3'), test.inv_payload((select id from jc where name = 'GX'), 1))$$, 'H: real overbilling (the taxable value above what was agreed) is still refused', 'would total .*before GST.*1,20,000');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'GX3'), test.inv_payload((select id from jc where name = 'GX'), 60000.01))$$, 'H: also by a paisa', 'before GST');
select test.check((accounts_invoice_prefill((select id from jc where name = 'GX')) ->> 'servicesInvoicedTaxable')::numeric = 120000, 'the builder is told everything is invoiced');

insert into jr select 'GX1again', accounts_issue_invoice((select id from jq where name = 'GX1'), test.inv_payload((select id from jc where name = 'GX'), 60000));
select test.admin_check($q$select count(*) = 2 and sum(subtotal) = 120000 and sum(total_gst) = 21600 from generated_invoices where customer_id = (select id from jc where name = 'GX')$q$, 'I: a retried request makes no third invoice');

select accounts_record_payment((select id from jc where name = 'GX'), 'PART', 5000, 'CASH', null, null, null, false);
select test.check((customer_payment_overview((select id from jc where name = 'GX')) -> 'order') @> '{"confirmed":60000,"pending":5000,"balance":81600}'::jsonb, 'G: a payment waiting for verification is shown apart and not counted');
reset role;
insert into jpay select 'GXp', id from customer_payments where customer_id = (select id from jc where name = 'GX') and status = 'PENDING';
set role authenticated;
select test.login('acc_m');
select accounts_reject_payment((select id from jpay where name = 'GXp'), 'cheque bounced');
select test.check((customer_payment_overview((select id from jc where name = 'GX')) -> 'order') @> '{"confirmed":60000,"pending":0,"balance":81600}'::jsonb
               and (invoice_detail((select (data ->> 'id')::uuid from jr where name = 'GX2')) -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 70800, 'G: a rejected payment is not counted either');

select accounts_record_payment((select id from jc where name = 'GX'), 'PART', 40000, 'BANK_TRANSFER', 'GX-NEFT-2', null, null, true);
select test.check((customer_payment_overview((select id from jc where name = 'GX')) -> 'order') @> '{"confirmed":100000,"balance":41600,"state":"PARTIALLY_PAID"}'::jsonb
               and (invoice_detail((select (data ->> 'id')::uuid from jr where name = 'GX1')) -> 'generated' -> 'paymentSummary' ->> 'state') = 'FULLY_PAID'
               and (invoice_detail((select (data ->> 'id')::uuid from jr where name = 'GX2')) -> 'generated' -> 'paymentSummary' ->> 'balance')::numeric = 41600,
  'E: 1,00,000 confirmed: 41,600 left on the order, still Partially Paid; invoice 1 is covered, invoice 2 has 41,600 left');
select test.must_fail($$select accounts_record_payment((select id from jc where name = 'GX'), 'PART', 41601, 'CASH', null, null, null, true)$$, 'a payment above the balance is refused', 'exceed');
select test.must_fail($$select accounts_record_payment((select id from jc where name = 'GX'), 'PART', 41600, 'CASH', null, null, null, true)$$, 'a part payment that settles the order must be a full payment', 'full payment');
select test.must_fail($$select accounts_record_payment((select id from jc where name = 'GX'), 'PART', 100.5, 'CASH', null, null, null, true)$$, 'paise are refused on an ordinary payment', 'whole rupees');
select test.must_fail($$select accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'GX2'))$$, 'invoice 2 cannot be confirmed paid while its share is open', 'of .*70,800 is confirmed');

select accounts_record_payment((select id from jc where name = 'GX'), 'FULL', 41600, 'UPI', 'GX-UPI-3', null, null, true);
select test.check((customer_payment_overview((select id from jc where name = 'GX')) -> 'order') @> '{"confirmed":141600,"balance":0,"state":"FULLY_PAID"}'::jsonb
               and customer_payment_overview((select id from jc where name = 'GX')) ->> 'paymentStatus' = 'FULLY_PAID',
  'F: the last 41,600 settles the order: Fully Paid, balance 0');
select test.check((accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'GX1')) ->> 'settled')::boolean
               and (accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from jr where name = 'GX2')) ->> 'settled')::boolean, 'both invoices are confirmed paid');
select test.check((invoice_detail((select (data ->> 'id')::uuid from jr where name = 'GX2')) -> 'generated' -> 'paymentSummary' -> 'order' ->> 'state') = 'FULLY_PAID', 'the paid invoice shows the same order figures');

select test.login('tm_a');
insert into jc select 'LG', create_lead('{"name":"Lata Gandhi","company":"Gandhi Gems","email":"lata@gandhigems.example","phone":"9820000108","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from jc where name = 'LG'), 100000, null);
select test.admin_check($q$select deal_amount = 100000 and agreed_tax_basis = 'INCLUSIVE' from customers where id = (select id from jc where name = 'LG')$q$, 'an agreement made without a basis stays as it always was: the amount includes GST');
select test.must_fail($$select accounts_set_agreement_basis((select id from jc where name = 'LG'), 'EXCLUSIVE', 'The deal was before GST')$$, 'a salesperson cannot change the basis', 'Only the Accounts');
select test.login('acc_m');
select test.must_fail($$select accounts_issue_invoice((select id from jq where name = 'LG1'), test.inv_payload((select id from jc where name = 'LG'), 100000))$$, 'including GST: 1,18,000 against 1,00,000 is refused as before', 'including GST');
select test.must_fail($$select accounts_set_agreement_basis((select id from jc where name = 'LG'), 'EXCLUSIVE', 'no')$$, 'a reason is required', 'at least 5 characters');
select test.must_fail($$select accounts_set_agreement_basis((select id from jc where name = 'LG'), 'INCLUSIVE', 'Same basis again')$$, 'the same basis is refused', 'already has this basis');
select test.must_fail($$select accounts_set_agreement_basis((select id from jc where name = 'LG'), 'MAYBE', 'Unknown basis')$$, 'an unknown basis is refused', 'includes or excludes');
select test.check((accounts_set_agreement_basis((select id from jc where name = 'LG'), 'EXCLUSIVE', 'The deal was agreed before GST') ->> 'totalPayable')::numeric = 100000, 'Accounts corrects the basis: no GST is added by itself');
select test.check((accounts_set_order_gst((select id from jc where name = 'LG'), 18) -> 'order' ->> 'totalPayable')::numeric = 118000, 'and chooses the GST: payable becomes 1,18,000');
select test.admin_check($q$select count(*) = 1 from audit_logs where action = 'AGREEMENT_BASIS_CHANGED' and entity_id = (select id from jc where name = 'LG')$q$, 'the correction is audited');
insert into jr select 'LG1', accounts_issue_invoice((select id from jq where name = 'LG1'), test.inv_payload((select id from jc where name = 'LG'), 100000));
select test.check((select (data ->> 'total')::numeric = 118000 from jr where name = 'LG1'), 'the invoice for the whole 1,00,000 + GST is now allowed');
select test.must_fail($$select accounts_set_agreement_basis((select id from jc where name = 'LG'), 'INCLUSIVE', 'Back to inclusive')$$, 'and cannot be switched back below what is invoiced', 'below what was already');
select test.login('tm_a');
select test.must_fail($$select accounts_agreement_review()$$, 'the review is for Accounts', 'Only the Accounts');
reset role;

update customers set agreed_amount = null where id = (select id from jc where name = 'PP');
set role authenticated;
select test.login('acc_m');
select test.check(exists (select 1 from jsonb_array_elements(accounts_agreement_review()) r where r ->> 'customerId' = (select id::text from jc where name = 'PP'))
               and not exists (select 1 from jsonb_array_elements(accounts_agreement_review()) r where r ->> 'customerId' = (select id::text from jc where name = 'GX')),
  'J: an older agreement that already has invoices is listed for review; a new one is not');
select test.check((customer_payment_overview((select id from jc where name = 'PP')) -> 'order' ->> 'basis') = 'INCLUSIVE'
               and (customer_payment_overview((select id from jc where name = 'PP')) -> 'order' ->> 'totalPayable')::numeric = 30000, 'and it is still read as before (including GST), not reinterpreted');
reset role;
