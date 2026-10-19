-- =============================================================================
-- Business attribution and the Accounts Sales / Support reports (migration 20261104000100).
-- Runs after the other suites (same database, reuses the `test` helpers, users and test.inv_payload).
-- Earlier suites leave their own payments in the database, so every figure is checked as a CHANGE from a baseline.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 60. Business attribution and the Accounts business reports'
reset role;
create temp table bc (name text primary key, id uuid);
create temp table bq (name text primary key, id uuid default gen_random_uuid());
create temp table br (name text primary key, data jsonb);
create temp table bpay (name text primary key, id uuid);
grant all on bc, bq, br, bpay to authenticated, service_role;

create function test.biz(p_args text default '') returns jsonb language plpgsql security definer as $$
declare v jsonb;
begin
  execute format('select public.business_report(%s)', p_args) into v;
  return v;
end $$;
grant execute on function test.biz(text) to authenticated;
-- a number out of the report: section 'sales' / 'support', key e.g. 'collected'
create function test.bnum(p_report jsonb, p_section text, p_key text) returns numeric language sql immutable as $$
  select coalesce((p_report -> 'sections' -> p_section ->> p_key)::numeric, 0)
$$;
create function test.btype(p_report jsonb, p_section text, p_type text, p_key text) returns numeric language sql immutable as $$
  select coalesce((select (t ->> p_key)::numeric from jsonb_array_elements(p_report -> 'sections' -> p_section -> 'byType') t where t ->> 'type' = p_type), 0)
$$;
create function test.bemp(p_report jsonb, p_section text, p_employee uuid, p_key text) returns numeric language sql immutable as $$
  select coalesce((select (t ->> p_key)::numeric from jsonb_array_elements(p_report -> 'sections' -> p_section -> 'employees') t where (t ->> 'employeeId')::uuid = p_employee), 0)
$$;
grant execute on function test.bnum(jsonb, text, text), test.btype(jsonb, text, text, text), test.bemp(jsonb, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------- baseline (Accounts)
set role authenticated;
select test.login('acc_m');
insert into br select 'before', public.business_report();
insert into br select 'before_tm_a', public.business_report(p_employee => test.id('tm_a'));
insert into br select 'before_sup_b', public.business_report(p_employee => test.id('sup_b'));

-- ---------------------------------------------------------------- 1. an initial sale is credited to Sales and to the salesperson
select test.login('tm_a');
insert into bc select 'K1', create_lead('{"name":"Kiran Mehta","company":"Mehta Traders","email":"kiran@mehta.example","phone":"9820000601","leadSource":"Walk-in"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from bc where name = 'K1'), 60000, null);
select test.login('acc_m');
select accounts_record_payment((select id from bc where name = 'K1'), 'PART', 20000, 'UPI', 'BZ-UPI-1', null, null, true);
select accounts_record_payment((select id from bc where name = 'K1'), 'PART', 8000, 'CASH', null, null, null, false);
select accounts_record_payment((select id from bc where name = 'K1'), 'PART', 5000, 'UPI', 'BZ-UPI-2', null, null, true);
reset role;
insert into bpay select 'k1_part', id from customer_payments where customer_id = (select id from bc where name = 'K1') and reference = 'BZ-UPI-2';
set role authenticated;
select test.login('dh_acc');
select accounts_reverse_payment((select id from bpay where name = 'k1_part'), 'Cheque bounced');

select test.login('acc_m');
insert into br select 'sale', public.business_report();
select test.check(test.bnum((select data from br where name = 'sale'), 'sales', 'collected') - test.bnum((select data from br where name = 'before'), 'sales', 'collected') = 20000,
  'the verified initial-sale payment (20,000) is Sales business; the reversed one is not collected');
select test.check(test.bnum((select data from br where name = 'sale'), 'sales', 'pending') - test.bnum((select data from br where name = 'before'), 'sales', 'pending') = 8000,
  'the payment still waiting for verification is pending, not collected');
select test.check(test.bnum((select data from br where name = 'sale'), 'sales', 'refunded') - test.bnum((select data from br where name = 'before'), 'sales', 'refunded') = 5000,
  'the reversed payment (5,000) is shown as refunded');
select test.check(test.bnum((select data from br where name = 'sale'), 'sales', 'billed') - test.bnum((select data from br where name = 'before'), 'sales', 'billed') = 60000
  and test.bnum((select data from br where name = 'sale'), 'sales', 'outstanding') - test.bnum((select data from br where name = 'before'), 'sales', 'outstanding') = 40000,
  'billed is the agreed 60,000 and the outstanding balance is 60,000 - 20,000 collected = 40,000 (pending and reversed money does not reduce it)');
select test.check(test.bemp((select data from br where name = 'sale'), 'sales', test.id('tm_a'), 'collected') - test.bemp((select data from br where name = 'before'), 'sales', test.id('tm_a'), 'collected') = 20000,
  'the salesperson who submitted the sale is credited');
select test.check(test.bnum((select data from br where name = 'sale'), 'support', 'collected') = test.bnum((select data from br where name = 'before'), 'support', 'collected'),
  'Support business is unchanged by a Sales transaction');

-- ---------------------------------------------------------------- 2. an add-on purchase by the same customer is credited to Support
reset role;
insert into addon_requests (customer_id, department_id, consultant_id, status, subtotal, tax_total, total, submitted_at, submitted_by, created_by)
select c.id, c.department_id, test.id('tc_dash'), 'COMPLETED', 25423.73, 4576.27, 30000, now(), test.id('sup_b'), test.id('tc_dash')
  from customers c where c.id = (select id from bc where name = 'K1');
insert into addon_request_items (request_id, service_code, name, quantity, unit_price, tax_percent, tax, line_total)
select r.id, 'AI_CALLING', 'AI Calling add-on', 1, 25423.73, 18, 4576.27, 30000 from addon_requests r where r.customer_id = (select id from bc where name = 'K1');
insert into addon_payments (request_id, customer_id, amount, method, reference, paid_at, status)
select r.id, r.customer_id, 30000, 'UPI', 'BZ-AD-1', now(), 'VERIFIED' from addon_requests r where r.customer_id = (select id from bc where name = 'K1');
insert into addon_payments (request_id, customer_id, amount, method, reference, paid_at, status)
select r.id, r.customer_id, 4000, 'UPI', 'BZ-AD-2', now(), 'PENDING' from addon_requests r where r.customer_id = (select id from bc where name = 'K1');
insert into addon_payments (request_id, customer_id, amount, method, reference, paid_at, status)
select r.id, r.customer_id, 999, 'UPI', 'BZ-AD-3', now(), 'REJECTED' from addon_requests r where r.customer_id = (select id from bc where name = 'K1');

set role authenticated;
select test.login('acc_m');
insert into br select 'addon', public.business_report();
select test.check(test.btype((select data from br where name = 'addon'), 'support', 'ADDON', 'collected') - test.btype((select data from br where name = 'before'), 'support', 'ADDON', 'collected') = 30000,
  'the add-on payment is Support business (the customer was onboarded by Sales)');
select test.check(test.btype((select data from br where name = 'addon'), 'support', 'ADDON', 'pending') - test.btype((select data from br where name = 'before'), 'support', 'ADDON', 'pending') = 4000,
  'a pending add-on payment is pending; the rejected one (999) is in no figure at all');
select test.check(test.bnum((select data from br where name = 'addon'), 'sales', 'collected') = test.bnum((select data from br where name = 'sale'), 'sales', 'collected'),
  'the add-on does not change Sales business (the original sale is not moved)');
select test.check(test.bemp((select data from br where name = 'addon'), 'support', test.id('sup_b'), 'collected') - test.bemp((select data from br where name = 'before'), 'support', test.id('sup_b'), 'collected') = 30000,
  'the Support member who submitted the add-on request is credited');
select test.check(test.btype((select data from br where name = 'addon'), 'support', 'ADDON', 'outstanding') - test.btype((select data from br where name = 'before'), 'support', 'ADDON', 'outstanding') = 0,
  'the add-on is fully paid: nothing outstanding');

-- ---------------------------------------------------------------- 3. the customer is handed to Support, who then bill a renewal (an additional invoice Accounts classifies)
reset role;
set session_replication_role = replica;  -- the hand-over is done by other workflows; the test only needs its result
update customers set owner_id = test.id('sup_b'), team_id = (select team_id from profiles where id = test.id('sup_b')) where id = (select id from bc where name = 'K1');
set session_replication_role = origin;
set role authenticated;
select test.login('sup_b');
insert into bq (name, id) select 'ir', request_invoice((select id from bc where name = 'K1'), date_trunc('month', current_date)::date, date_trunc('month', current_date)::date, 'Monthly renewal');
insert into bq (name) values ('issue');
select test.login('acc_m');
insert into br select 'inv', accounts_issue_invoice((select id from bq where name = 'issue'), test.inv_payload((select id from bc where name = 'K1'), 10000, 'ADDITIONAL'));
insert into br select 'p1', accounts_confirm_invoice_payment((select (data ->> 'id')::uuid from br where name = 'inv'), 'UPI', 'BZ-RN-1', null, null, 11800, gen_random_uuid());
select test.login('acc_m');
insert into br select 'unclassified', public.business_report();
select test.check((select (data -> 'unclassified' ->> 'collected')::numeric - (select (data -> 'unclassified' ->> 'collected')::numeric from br where name = 'before') = 11800
  and test.bnum(data, 'support', 'collected') = test.bnum((select data from br where name = 'addon'), 'support', 'collected')
  and test.bnum(data, 'sales', 'collected') = test.bnum((select data from br where name = 'addon'), 'sales', 'collected')
  from br where name = 'unclassified'),
  'an additional invoice nobody has classified is credited to neither department (it is listed as unclassified for review)');
select test.login('acc_m');
select test.must_fail($$select accounts_tag_invoice_business((select (data ->> 'id')::uuid from br where name = 'inv'), 'WEEKLY')$$, 'only Renewal / Add-on / Other', 'Choose Renewal');
select test.must_fail($$select accounts_tag_invoice_business((select (data ->> 'id')::uuid from br where name = 'inv'), 'RENEWAL', 'NO_SUCH_SERVICE')$$, 'an unknown service is refused', 'Service not found');
select accounts_tag_invoice_business((select (data ->> 'id')::uuid from br where name = 'inv'), 'RENEWAL', 'AI_CALLING', (select id from bq where name = 'ir'));
reset role;
select test.check((select status = 'RAISED' from invoice_requests where id = (select id from bq where name = 'ir')), 'the Support member''s invoice request is marked raised');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_tag_invoice_business((select (data ->> 'id')::uuid from br where name = 'inv'), 'ADDON')$$, 'once money is verified the classification cannot be changed by Accounts', 'can no longer be changed');
select test.login('tm_a');
select test.must_fail($$select accounts_tag_invoice_business((select (data ->> 'id')::uuid from br where name = 'inv'), 'RENEWAL')$$, 'a salesperson cannot classify an invoice', 'Only the Accounts');
select test.login('acc_m');
insert into br select 'renewal', public.business_report();
select test.check(test.btype((select data from br where name = 'renewal'), 'support', 'RENEWAL', 'collected') - test.btype((select data from br where name = 'before'), 'support', 'RENEWAL', 'collected') = 11800,
  'once classified as a renewal, the payment is Support renewal business');
select test.check(test.bemp((select data from br where name = 'renewal'), 'support', test.id('sup_b'), 'collected') - test.bemp((select data from br where name = 'before'), 'support', test.id('sup_b'), 'collected') = 41800,
  'the Support member is credited for the add-on (30,000) and the renewal (11,800) separately, from their own records');
select test.check((select (data -> 'unclassified' ->> 'collected')::numeric = (select (data -> 'unclassified' ->> 'collected')::numeric from br where name = 'before') from br where name = 'renewal'),
  'nothing is left unclassified once the invoice is tagged');

-- ---------------------------------------------------------------- 4. a subscription (monthly plan) Accounts activated as paid
reset role;
insert into monthly_plans (code, name, monthly_price) values ('BZ_PLAN', 'Business Plan', 1500) on conflict (code) do nothing;
insert into customer_plans (customer_id, plan_id, status, started_at, renews_on, payment_status, price_at_start)
select (select id from bc where name = 'K1'), (select id from monthly_plans where code = 'BZ_PLAN'), 'ACTIVE', current_date, current_date + 30, 'PAID', 1500;
set role authenticated;
select test.login('acc_m');
insert into br select 'plan', public.business_report();
select test.check(test.btype((select data from br where name = 'plan'), 'support', 'SUBSCRIPTION', 'collected') - test.btype((select data from br where name = 'before'), 'support', 'SUBSCRIPTION', 'collected') = 1500,
  'a paid monthly plan is Support subscription business');
select test.check((select count(*) >= 1 from jsonb_array_elements((select data -> 'sections' -> 'support' -> 'employees' from br where name = 'plan')) t
                    where (t ->> 'employeeId') is null and (t ->> 'collected')::numeric >= 1500),
  'with no responsible employee invented for it: it is listed under "Not recorded"');

-- ---------------------------------------------------------------- 4b. income by the customer's business unit
select test.login('acc_m');
select test.check((select (d -> 'sales' ->> 'collected')::numeric - coalesce((select (b -> 'sales' ->> 'collected')::numeric from jsonb_array_elements((select data -> 'departments' from br where name = 'before')) b where b ->> 'departmentId' = d ->> 'departmentId'), 0) = 20000
                      and (d -> 'support' ->> 'collected')::numeric - coalesce((select (b -> 'support' ->> 'collected')::numeric from jsonb_array_elements((select data -> 'departments' from br where name = 'before')) b where b ->> 'departmentId' = d ->> 'departmentId'), 0) = 30000 + 11800 + 1500
                   from jsonb_array_elements((select data -> 'departments' from br where name = 'plan')) d
                  where d ->> 'departmentId' = (select department_id::text from customers where id = (select id from bc where name = 'K1'))),
  'the customer''s department shows the sale under Sales and the add-on, renewal and plan under Support');
select test.check((select coalesce(sum((d ->> 'collected')::numeric), 0) = (data -> 'organization' ->> 'collected')::numeric from br, jsonb_array_elements(data -> 'departments') d where name = 'plan' group by data),
  'the department rows add up to the organisation total');

-- ---------------------------------------------------------------- 5. consistency: no double counting, one rule everywhere
reset role;
select test.check((select sum(amount) from private.business_ledger() where customer_id = (select id from bc where name = 'K1') and status = 'COLLECTED' and source <> 'PLAN_ACTIVATION')
                 = (select sum(amount) from private.verified_income() where customer_id = (select id from bc where name = 'K1')),
  'for this customer the collected total equals the verified income Accounts already reports (20,000 + 30,000 + 11,800): same rule, no double counting');
select test.check((select count(*) = count(distinct tx_key) from private.business_ledger()), 'every payment appears in the ledger exactly once');
select test.check((select count(*) = 0 from private.business_ledger() l1 join private.business_ledger() l2 on l1.source_id = l2.source_id and l1.tx_key <> l2.tx_key), 'no payment is counted under two sources');
set role authenticated;
select test.login('acc_m');
select test.check((select test.bnum(data, 'sales', 'collected') + test.bnum(data, 'support', 'collected') = (data -> 'organization' ->> 'collected')::numeric from br where name = 'plan'),
  'the organisation total is Sales + Support, nothing more (unclassified money is left out of both)');
insert into br select 'k1_all', public.business_report(p_employee => null, p_type => 'ADDON');
select test.check((select (public.business_report_transactions(p_type => 'ADDON', p_status => 'COLLECTED', p_page_size => 100) ->> 'total')::int
                 = (select (data -> 'sections' -> 'support' ->> 'transactions')::int from br where name = 'k1_all')),
  'the transaction list and the summary use the same rows (add-on payments collected)');
select test.check((select coalesce((select sum((i ->> 'amount')::numeric) from jsonb_array_elements(public.business_report_transactions(p_type => 'ADDON', p_status => 'COLLECTED', p_page_size => 100) -> 'items') i), 0)
                          = (data -> 'sections' -> 'support' ->> 'collected')::numeric from br where name = 'k1_all'),
  'and they add up to the same amount');

-- ---------------------------------------------------------------- 6. attribution does not follow the reassignment (the customer now belongs to Support)
select test.login('acc_m');
insert into br select 'after_reassign', public.business_report(p_employee => test.id('tm_a'));
select test.check(test.bnum((select data from br where name = 'after_reassign'), 'sales', 'collected') - test.bnum((select data from br where name = 'before_tm_a'), 'sales', 'collected') = 20000,
  'the customer now belongs to a Support member, yet the earlier sale stays with the salesperson who made it');

-- ---------------------------------------------------------------- 7. filters
select test.check((select (public.business_report(p_from => date '2020-01-01', p_to => date '2020-01-31') -> 'organization' ->> 'collected')::numeric = 0), 'a date range with no payments reports zero');
select test.check((select (public.business_report(p_from => (now() at time zone 'Asia/Kolkata')::date, p_to => (now() at time zone 'Asia/Kolkata')::date) -> 'organization' ->> 'collected')::numeric
                       >= 20000 + 30000 + 11800), 'today''s range includes today''s payments');
select test.check((select (public.business_report(p_division => 'SALES') -> 'sections' -> 'support') is null), 'filtering to Sales leaves Support out');
select test.check((select (public.business_report(p_status => 'PENDING') -> 'organization' ->> 'collected')::numeric = 0), 'filtering to Pending shows no collected money');
select test.check((select (public.business_report(p_employee => test.id('tm_a')) -> 'sections' -> 'support' ->> 'collected')::numeric = 0), 'an employee filter on a salesperson shows no Support money');
select test.must_fail($$select public.business_report(p_from => date '2026-02-01', p_to => date '2026-01-01')$$, 'an end date before the start date is refused', 'end date is before');
select test.must_fail($$select public.business_report(p_division => 'HR')$$, 'only Sales or Support', 'Sales or Support');
select test.must_fail($$select public.business_report(p_type => 'GIFT')$$, 'an unknown type is refused', 'Unknown transaction type');
select test.check((select count(*) >= 1 from jsonb_array_elements(public.business_report_transactions(p_search => 'Mehta') -> 'items') i where i ->> 'customerName' = 'Kiran Mehta'), 'searching by customer finds the transactions');
select test.check((select (public.business_report_transactions(p_search => 'no-such-customer-xyz') ->> 'total')::int = 0), 'a search with no match is empty');
select test.check((select jsonb_array_length(public.business_report_people()) >= 2 and exists (select 1 from jsonb_array_elements(public.business_report_people()) p where p ->> 'id' = test.id('sup_b')::text)), 'the people filter lists employees who appear in the records');

-- ---------------------------------------------------------------- 8. a refund of an invoice payment moves it out of collected
reset role;
update invoice_payments set status = 'REVERSED' where reference = 'BZ-RN-1';
set role authenticated;
select test.login('acc_m');
insert into br select 'refunded', public.business_report();
select test.check(test.btype((select data from br where name = 'refunded'), 'support', 'RENEWAL', 'collected') = test.btype((select data from br where name = 'before'), 'support', 'RENEWAL', 'collected')
              and test.btype((select data from br where name = 'refunded'), 'support', 'RENEWAL', 'refunded') - test.btype((select data from br where name = 'before'), 'support', 'RENEWAL', 'refunded') = 11800
              and test.btype((select data from br where name = 'refunded'), 'support', 'RENEWAL', 'outstanding') - test.btype((select data from br where name = 'before'), 'support', 'RENEWAL', 'outstanding') = 11800,
  'a reversed renewal payment is refunded, no longer collected, and the invoice is outstanding again');

-- ---------------------------------------------------------------- 9. a repeated request records nothing twice
reset role;
select test.check((select count(*) = 1 from invoice_payments where reference = 'BZ-RN-1'), 'the renewal payment was recorded once');
set role authenticated;

-- ---------------------------------------------------------------- 10. who may read it
select test.login('tm_a');
select test.must_fail($$select public.business_report()$$, 'a salesperson cannot read the business report', 'Only the Accounts department');
select test.must_fail($$select public.business_report_transactions()$$, 'nor the transaction list', 'Only the Accounts department');
select test.login('sup_b');
select test.must_fail($$select public.business_report()$$, 'a Support member cannot', 'Only the Accounts department');
select test.login('hr_head');
select test.must_fail($$select public.business_report()$$, 'HR cannot (this is Accounts'' report)', 'Only the Accounts department');
select test.login('dh_wab');
select test.must_fail($$select public.business_report()$$, 'another department''s head cannot', 'Only the Accounts department');
select test.must_fail($$select public.business_report_people()$$, 'nor read who is in the records', 'Only the Accounts department');
select test.login('acc_m');
select test.check((select public.business_report() is not null), 'an Accounts member can');
select test.login('dh_acc');
select test.check((select public.business_report() is not null), 'and the Accounts department head');
select test.login('sa');
select test.check((select public.business_report() is not null), 'and the Super Admin can');
select test.must_fail($$select * from invoice_business_tags$$, 'the tag table has no direct access', 'permission denied');
reset role;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select * from private.business_ledger()$$, 'the ledger itself is not callable by a signed-in user (only through the checked report)', 'permission denied');
reset role;
