-- =============================================================================
-- Department-wise income attribution (migration 20261114000100): who earns each order, collected income only from verified
-- payments, GST shown separately, no double counting, no rewriting of history, and who may read what.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 57. Department income attribution'
reset role;
create temp table at (k text primary key, v text);
grant all on at to authenticated, service_role;
create function pg_temp.g(p_k text) returns uuid language sql stable as $$ select v::uuid from at where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated, service_role;
create temp table rp (k text primary key, j jsonb);
grant all on rp to authenticated, service_role;
create function pg_temp.n(p_j jsonb, p_path text[]) returns numeric language sql immutable as $$ select (p_j #>> p_path)::numeric $$;
grant execute on function pg_temp.n(jsonb, text[]) to authenticated, service_role;
-- the change since the baseline taken before this suite's fixtures (other suites leave their own money in the same departments)
create function pg_temp.dn(p_j jsonb, p_base text, p_path text[]) returns numeric language sql stable as $$ select (p_j #>> p_path)::numeric - coalesce(((select j from rp where k = p_base) #>> p_path)::numeric, 0) $$;
grant execute on function pg_temp.dn(jsonb, text, text[]) to authenticated, service_role;

-- baselines (taken before this suite's fixtures)
set role authenticated;
select test.login('sa');
insert into rp select 'base_wab', department_income_report(test.dept('wabastore'));
insert into rp select 'base_wbx', department_income_report(test.dept('whatsbox'));
insert into rp select 'base_all', department_income_report();
insert into rp select 'base_rng', department_income_report(test.dept('wabastore'), current_date - 1, current_date + 1);
insert into rp select 'base_fin', accounts_finance_by_department();
insert into rp select 'base_sum', accounts_finance_summary(test.dept('wabastore'));
insert into rp select 'base_dash', dashboard_company_overview() -> 'departments';
reset role;

-- ---------------------------------------------------------------- customers acquired by Sales, by Support (a referral) and in another department
set role authenticated;
select test.login('tm_a');
insert into at select 'S1', create_lead('{"name":"Sales Acquired","company":"Sales Acquired Co","email":"att.s1@example.com","phone":"9830000001","leadSource":"Walk-in"}', array['AI_CALLING'])::text;
select test.login('sup_plain');
insert into at select 'R1', create_lead('{"name":"Support Referral","company":"Referral Co","email":"att.r1@example.com","phone":"9830000002","leadSource":"Referral"}', array['META_ADS_MANAGEMENT'])::text;
insert into at select 'R2', create_lead('{"name":"Support Walkin","company":"Support Other Co","email":"att.r2@example.com","phone":"9830000004","leadSource":"Walk-in"}', array['META_ADS_MANAGEMENT'])::text;
select test.login('tm_c');
insert into at select 'W1', create_lead('{"name":"Whatsbox Cust","company":"Whatsbox Co","email":"att.w1@example.com","phone":"9830000003","leadSource":"Instagram"}', array['AI_CALLING'])::text;
reset role;

select test.check((select acquisition_division = 'SALES' and acquisition_department_id = department_id and acquired_by = test.id('tm_a') from customers where id = pg_temp.g('S1')),
  'a customer created by a Sales member is recorded as acquired by Sales, in that department, by that member');
select test.check((select acquisition_division = 'SUPPORT' and acquired_by = test.id('sup_plain') from customers where id = pg_temp.g('R1')), 'a customer created by a Support member is recorded as acquired by Support');
select test.check((select acquisition_division = 'SALES' and department_id = test.dept('whatsbox') from customers where id = pg_temp.g('W1')), 'another department''s Sales customer');

-- ---------------------------------------------------------------- 1. Sales sells (before GST: 1,20,000 + 18% = 1,41,600); part payment, a pending and a rejected one
update customers set lifecycle_stage = 'CUSTOMER', deal_amount = 141600, agreed_amount = 120000, agreed_tax_basis = 'EXCLUSIVE' where id = pg_temp.g('S1');
insert into payment_requests (customer_id, status, agreed_amount, requested_by) values (pg_temp.g('S1'), 'CONFIRMED', 141600, test.id('tm_a'));
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at) values
  (pg_temp.g('S1'), 'PART', 60000, 'UPI', 'ATT-S1-1', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now()),
  (pg_temp.g('S1'), 'PART', 30000, 'UPI', 'ATT-S1-2', 'PENDING', 'ACCOUNTS', test.id('acc_m'), null, null),
  (pg_temp.g('S1'), 'PART', 5000, 'UPI', 'ATT-S1-3', 'REJECTED', 'ACCOUNTS', test.id('acc_m'), null, null);
select test.check((select division = 'SALES' and source = 'ACQUISITION' and department_id = test.dept('wabastore') and not needs_review from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S1')),
  '1. the first sale of a Sales customer is attributed to Sales (recorded once, with the reason)');
set role authenticated;
select test.login('sa');
insert into rp select 'wab1', department_income_report(test.dept('wabastore'));
reset role;
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,collected}') = 60000 and pg_temp.dn(j, 'base_wab', '{byDivision,support,collected}') = 0 from rp where k = 'wab1'),
  '1. only the verified 60,000 is collected, and it is Sales income');
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,billed}') = 141600 and pg_temp.dn(j, 'base_wab', '{byDivision,sales,billedTaxable}') = 120000 and pg_temp.dn(j, 'base_wab', '{byDivision,sales,billedGst}') = 21600 from rp where k = 'wab1'),
  '1. the order is 1,41,600: taxable 1,20,000 and GST 21,600');
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,collectedTaxable}') = 50847.46 and pg_temp.dn(j, 'base_wab', '{byDivision,sales,collectedGst}') = 9152.54 from rp where k = 'wab1'),
  '6. the received 60,000 is split pro rata into taxable 50,847.46 and GST 9,152.54');
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,pending}') = 30000 from rp where k = 'wab1'), '7. the pending payment is shown as pending, not collected');
select test.check((select pg_temp.dn(j, 'base_wab', '{totals,collected}') = 60000 and pg_temp.dn(j, 'base_wab', '{totals,pending}') = 30000 from rp where k = 'wab1'), '7. the rejected payment is nowhere');
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,outstanding}') = 81600 and pg_temp.dn(j, 'base_wab', '{byDivision,sales,payments}') = 1 from rp where k = 'wab1'),
  '6. the remaining receivable is 81,600 (separate from collected), from one confirmed payment');
select test.check((select (o ->> 'partPaid')::boolean and (o ->> 'outstanding')::numeric = 81600 and (o ->> 'collected')::numeric = 60000 and o ->> 'source' = 'ACQUISITION'
                     from rp, jsonb_array_elements(j -> 'orders') o where k = 'wab1' and o ->> 'orderKey' = 'SALE:' || pg_temp.g('S1')),
  '6. the order is listed as part paid, with what is collected and what remains');

-- ---------------------------------------------------------------- 2. the same customer buys an add-on through Support
insert into addon_requests (id, customer_id, department_id, status, version, created_by, submitted_by, subtotal, tax_total, total)
  select gen_random_uuid(), c.id, c.department_id, 'DRAFT', 1, test.id('sup_plain'), test.id('sup_plain'), 20000, 3600, 23600 from customers c where c.id = pg_temp.g('S1');
insert into at select 'A1', id::text from addon_requests where customer_id = pg_temp.g('S1');
insert into addon_request_items (request_id, service_code, name, quantity, unit_price, line_total, sort_order) values (pg_temp.g('A1'), 'META_ADS_MANAGEMENT', 'Meta Ads Management', 1, 20000, 20000, 1);
update addon_requests set status = 'PENDING_VERIFICATION' where id = pg_temp.g('A1');
update addon_requests set status = 'APPROVED' where id = pg_temp.g('A1');
update addon_requests set status = 'INVOICE_GENERATED', subtotal = 20000, tax_total = 3600, total = 23600 where id = pg_temp.g('A1');
insert into addon_payments (request_id, customer_id, amount, method, reference, status, recorded_by, verified_by, verified_at)
  values (pg_temp.g('A1'), pg_temp.g('S1'), 23600, 'UPI', 'ATT-A1-1', 'VERIFIED', test.id('acc_m'), test.id('acc_m'), now());
select test.check((select division = 'SUPPORT' and source = 'SUPPORT_ADDON' from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A1')), '2. the add-on is attributed to Support');
select test.check((select division = 'SALES' and source = 'ACQUISITION' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S1')), '2. the original sale stays Sales');
set role authenticated;
select test.login('sa');
insert into rp select 'wab2', department_income_report(test.dept('wabastore'));
reset role;
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,collected}') = 60000 and pg_temp.dn(j, 'base_wab', '{byDivision,support,collected}') = 23600 and pg_temp.dn(j, 'base_wab', '{totals,collected}') = 83600 from rp where k = 'wab2'),
  '2. Sales keeps 60,000 and Support earns the 23,600 add-on; the department total is 83,600');
select test.check((select pg_temp.dn(j, 'base_wab', '{highlights,supportAddOns,collected}') = 23600 and pg_temp.dn(j, 'base_wab', '{highlights,supportAddOns,collectedTaxable}') = 20000 and pg_temp.dn(j, 'base_wab', '{highlights,supportAddOns,collectedGst}') = 3600 from rp where k = 'wab2'),
  '2. add-on revenue attributed to Support is shown on its own, taxable 20,000 and GST 3,600');

-- ---------------------------------------------------------------- 3. Support acquires a customer through a referral
update customers set lifecycle_stage = 'CUSTOMER', deal_amount = 59000 where id = pg_temp.g('R1');
insert into payment_requests (customer_id, status, agreed_amount, requested_by) values (pg_temp.g('R1'), 'CONFIRMED', 59000, test.id('sup_plain'));
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
  values (pg_temp.g('R1'), 'FULL', 59000, 'UPI', 'ATT-R1-1', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now());
update customers set lifecycle_stage = 'CUSTOMER', deal_amount = 30000 where id = pg_temp.g('R2');
insert into payment_requests (customer_id, status, agreed_amount, requested_by) values (pg_temp.g('R2'), 'CONFIRMED', 30000, test.id('sup_plain'));
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
  values (pg_temp.g('R2'), 'FULL', 30000, 'UPI', 'ATT-R2-1', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now());
select test.check((select division = 'SUPPORT' and source = 'ACQUISITION' and referral_source = 'Referral' and acquisition_division = 'SUPPORT' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('R1')),
  '3. the order of a customer Support acquired is Support''s, and the referral source is stored with it');
set role authenticated;
select test.login('sa');
insert into rp select 'wab3', department_income_report(test.dept('wabastore'));
reset role;
select test.check((select pg_temp.dn(j, 'base_wab', '{byDivision,sales,collected}') = 60000 and pg_temp.dn(j, 'base_wab', '{byDivision,support,collected}') = 112600 from rp where k = 'wab3'),
  '3. Support now earns 23,600 + 59,000 + 30,000; Sales is unchanged');
select test.check((select pg_temp.dn(j, 'base_wab', '{highlights,supportReferrals,collected}') = 59000 and pg_temp.dn(j, 'base_wab', '{highlights,supportAcquired,collected}') = 89000 from rp where k = 'wab3'),
  '3. revenue from Support-originated referrals (59,000) is shown apart from all Support-acquired sales (89,000)');

-- ---------------------------------------------------------------- 4. a client buys a service in the Client Dashboard
reset role;
select test.create_auth_user('att_client', 'att.s1.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', pg_temp.g('S1')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values (pg_temp.g('S1'), test.id('att_client'), 'att.s1.login@example.com');
-- (the first add-on of S1 is completed so that a new one may start)
update addon_requests set status = 'PAYMENT_CONFIRMED' where id = pg_temp.g('A1');
update addon_requests set status = 'COMPLETED' where id = pg_temp.g('A1');
set role authenticated;
select test.login('att_client');
select test.check((select client_request_service('WHATSAPP_API_BLUE_TICK') ->> 'status' = 'REQUESTED'), '4. the client asks for a new service in their dashboard');
reset role;
insert into addon_requests (id, customer_id, department_id, status, version, created_by, submitted_by, subtotal, tax_total, total)
  select gen_random_uuid(), c.id, c.department_id, 'DRAFT', 1, test.id('sup_plain'), test.id('sup_plain'), 10000, 1800, 11800 from customers c where c.id = pg_temp.g('S1') and not exists
    (select 1 from addon_requests x where x.customer_id = c.id and x.status not in ('REJECTED', 'COMPLETED'));
insert into at select 'A2', id::text from addon_requests where customer_id = pg_temp.g('S1') and status = 'DRAFT';
select test.check((select division = 'SUPPORT' and source = 'SUPPORT_ADDON' from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A2')), '4. an add-on nobody linked to a client request is an ordinary Support add-on');
insert into addon_request_items (request_id, service_code, name, quantity, unit_price, line_total, sort_order) values (pg_temp.g('A2'), 'WHATSAPP_API_BLUE_TICK', 'WhatsApp API', 1, 10000, 10000, 1);
select test.check((select source = 'CLIENT_DASHBOARD' and division = 'SUPPORT' from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A2')),
  '4. once the consultant adds the service the client asked for, the order is a Client Dashboard purchase, attributed by the rule (Support by default)');
update addon_requests set status = 'PENDING_VERIFICATION' where id = pg_temp.g('A2');
update addon_requests set status = 'APPROVED' where id = pg_temp.g('A2');
update addon_requests set status = 'INVOICE_GENERATED', subtotal = 10000, tax_total = 1800, total = 11800 where id = pg_temp.g('A2');
insert into addon_payments (request_id, customer_id, amount, method, reference, status, recorded_by, verified_by, verified_at)
  values (pg_temp.g('A2'), pg_temp.g('S1'), 11800, 'UPI', 'ATT-A2-1', 'VERIFIED', test.id('acc_m'), test.id('acc_m'), now());
set role authenticated;
select test.login('sa');
insert into rp select 'cd1', department_income_report(test.dept('wabastore'));
select test.check((select pg_temp.dn(j, 'base_wab', '{highlights,clientDashboard,collected}') = 11800 and pg_temp.dn(j, 'base_wab', '{highlights,clientDashboard,orders}') = 1 from rp where k = 'cd1'),
  '4. new purchases made in the Client Dashboard are reported on their own');
-- the rule is a setting: it changes what is attributed from now on, and never an order that already exists
select test.login('acc_m');
select test.must_fail($$select set_revenue_attribution_settings('SALES')$$, 'Accounts cannot change the rule', 'Super Admin');
select test.login('sa');
select test.must_fail($$select set_revenue_attribution_settings('EVERYONE')$$, 'an unknown rule is refused', 'Choose');
select test.check((select set_revenue_attribution_settings('ACQUISITION') ->> 'clientPurchaseAttribution' = 'ACQUISITION'), '4. the Super Admin can choose: the division that acquired the customer');
reset role;
-- a plan the client buys is a client purchase too (attributed by the rule in force when it is bought: S1 was acquired by Sales)
insert into monthly_plans (code, name, monthly_price) values ('ATT_PLAN', 'Attribution Plan', 5900) on conflict (code) do nothing;
insert into customer_plans (customer_id, plan_id, status, started_at, renews_on, payment_status, price_at_start)
  select pg_temp.g('S1'), id, 'ACTIVE', current_date, current_date + 30, 'PAID', 5900 from monthly_plans where code = 'ATT_PLAN';
select test.check((select division = 'SALES' and source = 'CLIENT_DASHBOARD' from revenue_attributions a join customer_plans p on a.order_key = 'PLAN:' || p.id::text where p.customer_id = pg_temp.g('S1')),
  '4. with the rule set to "the acquiring division" the new plan follows the customer''s acquisition (Sales), and is still a Client Dashboard purchase');
select test.check((select division = 'SUPPORT' and source = 'CLIENT_DASHBOARD' from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A2')), '4. the earlier Client Dashboard order was NOT moved by the new rule');
set role authenticated;
select test.login('sa');
select set_revenue_attribution_settings('SUPPORT');
reset role;
select test.check((select count(*) >= 2 from audit_logs where action = 'REVENUE_ATTRIBUTION_RULE_CHANGED'), '4. changes of the rule are audited');

-- ---------------------------------------------------------------- 5. another department; orders of several departments
update customers set lifecycle_stage = 'CUSTOMER', deal_amount = 100000 where id = pg_temp.g('W1');
insert into payment_requests (customer_id, status, agreed_amount, requested_by) values (pg_temp.g('W1'), 'CONFIRMED', 100000, test.id('tm_c'));
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
  values (pg_temp.g('W1'), 'PART', 40000, 'BANK_TRANSFER', 'ATT-W1-1', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now());
set role authenticated;
select test.login('sa');
insert into rp select 'all', department_income_report();
insert into rp select 'wbx', department_income_report(test.dept('whatsbox'));
insert into rp select 'wab', department_income_report(test.dept('wabastore'));
reset role;
select test.check((select pg_temp.dn(j, 'base_wbx', '{byDivision,sales,collected}') = 40000 and pg_temp.dn(j, 'base_wbx', '{byDivision,support,collected}') = 0 from rp where k = 'wbx'), '5. each department has its own totals (Whatsbox: Sales 40,000)');
select test.check((select pg_temp.n(j, '{totals,collected}') = (select pg_temp.n(j, '{totals,collected}') from rp where k = 'wab') + (select pg_temp.n(j, '{totals,collected}') from rp where k = 'wbx')
                     + coalesce((select sum((d ->> 'collected')::numeric) from rp, jsonb_array_elements(j -> 'departments') d where k = 'all' and d ->> 'departmentId' not in (test.dept('wabastore')::text, test.dept('whatsbox')::text)), 0)
                     from rp where k = 'all'),
  '5. the company total is the sum of the departments');
select test.check((select count(*) >= 2 from rp, jsonb_array_elements(j -> 'departments') d where k = 'all' and (d ->> 'collected')::numeric > 0), '5. the consolidated view lists the departments that earned');
select test.check((select count(distinct tx_key) = count(*) from private.business_ledger()), '8. every payment appears in the ledger exactly once');
select test.check((select coalesce(sum(amount), 0) from private.business_ledger() where status = 'COLLECTED' and source <> 'PLAN_ACTIVATION') = (select coalesce(sum(amount), 0) from private.verified_income()),
  '8. the ledger and the verified income are the same money: nothing is counted twice or dropped');
select test.check((select coalesce(sum((d ->> 'collected')::numeric), 0) from rp, jsonb_array_elements(j -> 'departments') d where k = 'all')
                    = (select coalesce(sum(amount), 0) from private.business_ledger() where status = 'COLLECTED' and division is not null), '8. the departments add up to everything classified as collected (plans included)');

-- Accounts' Department Income and the Super Admin dashboard read the same attribution
set role authenticated;
select test.login('acc_m');
select test.check((select (x ->> 'income')::numeric - (select (b ->> 'income')::numeric from rp, jsonb_array_elements(j) b where k = 'base_fin' and b ->> 'slug' = 'whatsbox') = 40000
                     from jsonb_array_elements(accounts_finance_by_department()) x where x ->> 'slug' = 'whatsbox'), '5. Accounts'' Department Income agrees (Whatsbox +40,000)');
select test.check((select (x ->> 'income')::numeric - (select (b ->> 'income')::numeric from rp, jsonb_array_elements(j) b where k = 'base_fin' and b ->> 'slug' = 'wabastore') = 60000 + 23600 + 11800 + 59000 + 30000
                     from jsonb_array_elements(accounts_finance_by_department()) x where x ->> 'slug' = 'wabastore'),
  '5. and Wabastore includes the add-ons and the Support-acquired sales (all verified payments)');
select test.check((select (accounts_finance_summary(test.dept('wabastore')) ->> 'income')::numeric - (j ->> 'income')::numeric = 184400 from rp where k = 'base_sum'), '5. the finance summary of a department agrees');
select test.login('sa');
select test.check((select (x ->> 'income')::numeric - (select (b ->> 'income')::numeric from rp, jsonb_array_elements(j) b where k = 'base_dash' and b ->> 'slug' = 'wabastore') = 184400
                     from jsonb_array_elements(dashboard_company_overview() -> 'departments') x where x ->> 'slug' = 'wabastore'), '5. so does the Super Admin dashboard');
reset role;

-- ---------------------------------------------------------------- 9. refunds and reversals
update customer_payments set status = 'REVERSED' where reference = 'ATT-W1-1';
set role authenticated;
select test.login('sa');
insert into rp select 'wbx2', department_income_report(test.dept('whatsbox'));
reset role;
select test.check((select pg_temp.dn(j, 'base_wbx', '{byDivision,sales,collected}') = 0 and pg_temp.dn(j, 'base_wbx', '{byDivision,sales,refunded}') = 40000 and pg_temp.dn(j, 'base_wbx', '{byDivision,sales,outstanding}') = 100000 from rp where k = 'wbx2'),
  '9. a reversed payment leaves collected income, is shown as refunded, and the order is owed again');

set role authenticated;
select test.login('acc_m');
select test.check((select (x ->> 'income')::numeric - (select (b ->> 'income')::numeric from rp, jsonb_array_elements(j) b where k = 'base_fin' and b ->> 'slug' = 'whatsbox') = 0
                     from jsonb_array_elements(accounts_finance_by_department()) x where x ->> 'slug' = 'whatsbox'), '9. Accounts'' Department Income follows the reversal (Whatsbox is back to nothing received)');
reset role;

-- ---------------------------------------------------------------- 11. a change of owner does not move history
reset role;
set role authenticated;
select test.login('sa');
insert into rp select 'before_move', department_income_report(test.dept('wabastore'));
select test.check((select count(*) = 1 from customers where id = pg_temp.g('S1') and department_id = test.dept('wabastore')), '11. (setup) the customer is in Wabastore');
reset role;
update customers set owner_id = test.id('tm_c') where id = pg_temp.g('S1');
select test.check((select department_id = test.dept('whatsbox') and acquisition_division = 'SALES' and acquisition_department_id = test.dept('wabastore') from customers where id = pg_temp.g('S1')),
  '11. the customer moved to the new owner''s department, but who acquired it (and where) is unchanged');
set role authenticated;
select test.login('sa');
insert into rp select 'after_move', department_income_report(test.dept('wabastore'));
insert into rp select 'after_move_wbx', department_income_report(test.dept('whatsbox'));
reset role;
select test.check((select b.j -> 'totals' = a.j -> 'totals' from rp b, rp a where b.k = 'before_move' and a.k = 'after_move'), '11. Wabastore''s income is exactly what it was: the orders stay with the department they were made in');
select test.check((select pg_temp.dn(j, 'base_wbx', '{totals,collected}') = 0 from rp where k = 'after_move_wbx'), '11. and Whatsbox did not receive them');
select test.check((select department_id = test.dept('wabastore') and division = 'SALES' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S1')), '11. the recorded attribution is untouched');
-- a new order after the move belongs to where the customer is now
reset role;
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
  values (pg_temp.g('S1'), 'PART', 1000, 'UPI', 'ATT-S1-4', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now());
select test.check((select department_id = test.dept('wabastore') from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S1')), '11. more payments on the same order stay with the order''s own attribution');

-- ---------------------------------------------------------------- history that cannot be verified is flagged, never guessed
-- (an order that existed before this migration: counted as the old rule counted it, and flagged when a Support member is involved)
insert into at select 'L1', (select id::text from customers where id = pg_temp.g('R2'));
delete from revenue_attributions where order_key = 'SALE:' || pg_temp.g('R2');
insert into revenue_attributions (order_key, customer_id, division, department_id, source, needs_review, review_note)
  values ('SALE:' || pg_temp.g('R2'), pg_temp.g('R2'), 'SALES', test.dept('wabastore'), 'LEGACY', true, 'Counted as Sales (the rule before attribution was recorded), but a Support team member owns or created this customer. Confirm whether Support acquired it.');
set role authenticated;
select test.login('acc_m');
select test.check((select jsonb_array_length(attribution_reconciliation() -> 'items') >= 1 and (attribution_reconciliation() ->> 'legacyOrders')::int >= 1), 'Accounts sees the orders that need reconciliation');
select test.check((select count(*) = 1 from jsonb_array_elements(attribution_reconciliation() -> 'items') i where i ->> 'orderKey' = 'SALE:' || pg_temp.g('R2') and i ->> 'division' = 'SALES' and (i ->> 'collected')::numeric = 30000),
  'the flagged order is still counted as it was (Sales) until somebody decides');
select test.must_fail($$select set_order_attribution('SALE:' || pg_temp.g('R2'), 'SUPPORT', null, null)$$, 'a correction needs a reason', 'Say why');
select test.must_fail($$select set_order_attribution('SALE:' || pg_temp.g('R2'), 'EVERYONE', null, 'x')$$, 'and a known division', 'Choose Sales or Support');
select test.must_fail($$select set_order_attribution('SALE:00000000-0000-0000-0000-000000000000', 'SUPPORT', null, 'x')$$, 'and a real order', 'not found');
select test.must_fail($$select set_order_attribution('SALE:' || pg_temp.g('R2'), 'SUPPORT', test.dept('accounts'), 'wrong department')$$, 'and a department that earns revenue', 'earns revenue');
select test.check((select set_order_attribution('SALE:' || pg_temp.g('R2'), 'SUPPORT', null, 'Confirmed with the Support lead: Support acquired this customer') ->> 'source' = 'MANUAL'), 'Accounts corrects it with a reason');
reset role;
select test.check((select division = 'SUPPORT' and source = 'MANUAL' and not needs_review from revenue_attributions where order_key = 'SALE:' || pg_temp.g('R2')), 'the order is now Support''s, marked as a manual correction');
select test.check((select count(*) = 1 from audit_logs where action = 'ORDER_ATTRIBUTION_CHANGED' and (metadata ->> 'from_division') = 'SALES' and (metadata ->> 'to_division') = 'SUPPORT'
                     and (metadata ->> 'reason') like 'Confirmed with the Support lead%'), 'the change is audited with who, from, to and why');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select set_order_attribution('SALE:' || pg_temp.g('S1'), 'SUPPORT', null, 'x')$$, 'a Sales member cannot change attribution', 'Only the Super Admin and Accounts');
select test.must_fail($$select attribution_reconciliation()$$, 'nor read the reconciliation list', 'Only the Super Admin and Accounts');
select test.login('acc_m');
-- acquisition of an older customer
select test.must_fail($$select set_customer_acquisition(pg_temp.g('S1'), 'SUPPORT', null)$$, 'recording who acquired a customer needs a reason', 'Say why');
select test.check((select set_customer_acquisition(pg_temp.g('S1'), 'SALES', 'Confirmed with Sales') ->> 'acquisitionDivision' = 'SALES'), 'Accounts can record who acquired a customer');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'CUSTOMER_ACQUISITION_CHANGED'), 'and it is audited');
-- nobody else can change it, not even by updating the customer
set role authenticated;
select test.login('sup_plain');
reset role;
update customers set acquisition_division = 'SUPPORT' where id = pg_temp.g('S1');
select test.check((select acquisition_division = 'SALES' from customers where id = pg_temp.g('S1')), 'a plain update cannot rewrite who acquired a customer');

-- ---------------------------------------------------------------- 10. who sees what
set role authenticated;
select test.login('dh_wab');
select test.check((select department_income_report() #>> '{scope,name}' is not null and department_income_report() #>> '{scope,departmentId}' = test.dept('wabastore')::text), '10. a Department Head''s report is scoped to their own department');
select test.check((select jsonb_array_length(department_income_report() -> 'departments') = 0), '10. and does not list other departments');
select test.must_fail($$select department_income_report(test.dept('whatsbox'))$$, '10. a Department Head cannot ask for another department', 'see only their own');
select test.login('dh_wbx');
select test.must_fail($$select department_income_report(test.dept('wabastore'))$$, '10. nor can another department''s head', 'see only their own');
select test.check((select pg_temp.dn(department_income_report(), 'base_wbx', '{totals,collected}') = 0 and department_income_report() #>> '{scope,departmentId}' = test.dept('whatsbox')::text), '10. and sees only their own figures');
select test.login('th_wab');
select test.must_fail($$select department_income_report()$$, '10. a Team Lead cannot read department income', 'Only the Super Admin, Accounts and Department Heads');
select test.login('tm_a');
select test.must_fail($$select department_income_report()$$, '10. nor a Team Member', 'Only the Super Admin, Accounts and Department Heads');
select test.login('sup_plain');
select test.must_fail($$select department_income_report()$$, '10. nor a Support member', 'Only the Super Admin, Accounts and Department Heads');
select test.login('att_client');
select test.must_fail($$select department_income_report()$$, '10. nor a client', 'Only the Super Admin, Accounts and Department Heads|clients|FORBIDDEN');
select test.login('acc_m');
select test.check((select jsonb_array_length(department_income_report() -> 'departments') >= 2), '10. Accounts sees every department');
select test.must_fail($$select * from revenue_attributions$$, 'the attribution table is not readable directly', 'permission denied');
select test.must_fail($$select * from revenue_attribution_settings$$, 'nor the setting', 'permission denied');
select test.must_fail($$select department_income_report(gen_random_uuid())$$, 'an unknown department is refused', 'Department not found');
select test.must_fail($$select department_income_report(null, '2026-12-31', '2026-01-01')$$, 'a reversed date range is refused', 'end date');
reset role;
set role anon;
select test.must_fail($$select department_income_report()$$, '10. a visitor cannot read it', 'permission denied');
select test.must_fail($$select set_order_attribution('SALE:x', 'SALES', null, 'x')$$, 'nor change attribution', 'permission denied');
reset role;

-- ---------------------------------------------------------------- date ranges
set role authenticated;
select test.login('sa');
select test.check((select pg_temp.n(department_income_report(test.dept('wabastore'), current_date + 5, current_date + 9), '{totals,collected}') = 0), 'a range with no payments has no collected income');
select test.check((select pg_temp.dn(department_income_report(test.dept('wabastore'), current_date - 1, current_date + 1), 'base_rng', '{byDivision,support,collected}') = 23600 + 11800 + 59000 + 30000), 'a range that covers the payments counts each once');
reset role;

\echo '=== ALL DEPARTMENT INCOME ATTRIBUTION TESTS PASSED ==='
