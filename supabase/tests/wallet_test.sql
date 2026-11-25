-- =============================================================================
-- Employee Wallet (migration 20270207000100): the wallet over the existing incentive earnings and withdrawals, manual wallet credits approved by a second Accounts
-- person, the derived ledger (its sum is the balance), salary shown as expected only, notifications, isolation between employees and the report.
-- Runs after payouts_test.sql / payouts_razorpay_test.sql. Uses Member B (tm_b, the employee), Member A (tm_a, another employee), Accounts: acc_m and dh_acc,
-- HR: hr_head, the Super Admin sa, Wabastore: dh_wab, th_wab. Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 149. Employee wallet'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of private.payout_available: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270207000100_employee_wallet.sql
\i supabase/migrations/20270207000100_employee_wallet.sql

-- a clean slate for this suite's person (the wallet credits are never deleted by the app: the guard is switched off just for this clean-up)
alter table wallet_credits disable trigger wallet_credits_guard;
delete from wallet_credits where description like 'WT %';
alter table wallet_credits enable trigger wallet_credits_guard;
delete from payout_requests where profile_id = test.id('tm_b');
delete from payout_methods where profile_id = test.id('tm_b');
delete from earnings where event_ref like 'TESTWT:%';
delete from incentive_rules where name = 'Test wallet rule';
delete from notifications where recipient_id in (test.id('tm_b'), test.id('dh_acc'), test.id('acc_m')) and (type like 'WALLET_%' or type like 'PAYOUT_%');
insert into incentive_rules (name, event_type, amount, scope_type, scope_value, active_from, created_by)
  values ('Test wallet rule', 'VISIT_COMPLETED', 1, 'PERSON', test.id('tm_b')::text, date '2026-01-01', test.id('sa'));
create or replace function test.wt_earn(p_ref text, p_amount numeric) returns void language sql as $$
  insert into public.earnings (profile_id, rule_id, event_type, event_ref, role, amount)
  values (test.id('tm_b'), (select id from public.incentive_rules where name = 'Test wallet rule'), 'VISIT_COMPLETED', 'TESTWT:' || p_ref, 'PARTICIPANT', p_amount) $$;
-- counts on the tables the app roles cannot read, as the table owner
create or replace function test.wt_q(p_sql text) returns numeric language plpgsql security definer set search_path = '' as $$
declare v numeric; begin execute p_sql into v; return v; end $$;
-- the HR record: joining date (withdrawals open 15 days after it) and a monthly salary in free text
insert into public.hr_employees (id, name, joining_date, monthly_salary, profile_id) values ('TEST-WT-tm_b', 'Wallet test', '2026-01-01', '₹25,000 per month', test.id('tm_b'))
  on conflict (id) do update set profile_id = excluded.profile_id, joining_date = excluded.joining_date, monthly_salary = excluded.monthly_salary;
update public.employee_personal_details set joining_date = null where profile_id = test.id('tm_b');
grant execute on all functions in schema test to anon, authenticated, service_role;
create temp table wt (k text primary key, v text);
grant all on wt to authenticated;
select coalesce(sum(amount), 0) as earned0 from earnings where profile_id = test.id('tm_b') and status = 'EARNED' \gset
select coalesce(sum(amount), 0) as credits0 from wallet_credits where profile_id = test.id('tm_b') and status = 'CREDITED' \gset
select coalesce(sum(amount), 0) as paid0 from payout_requests where profile_id = test.id('tm_b') and status = 'PAID' \gset

\echo '   1. An employee with nothing yet: the wallet is empty, salary is shown as expected only'
set role authenticated;
select test.login('tm_b');
select test.check((wallet_summary() ->> 'eligible')::boolean and (wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0, 'the wallet exists for every employee without being created');
select test.check((wallet_summary() #>> '{salary,monthly}')::numeric = 25000 and wallet_summary() #>> '{salary,source}' = 'HR_RECORD', 'the monthly salary is read from the HR record');
select test.check(wallet_summary() #> '{salary,credited}' = 'null'::jsonb and wallet_summary() #> '{salary,approved}' = 'null'::jsonb and (wallet_summary() #>> '{salary,withdrawable}')::numeric = 0
                  and not (wallet_summary() #>> '{salary,payrollTracked}')::boolean, 'it is expected salary only: nothing credited, approved or withdrawable (no payroll yet)');
select test.check((wallet_summary() #>> '{thisMonth,salaryExpected}')::numeric = 25000, 'this month''s expected salary');
select test.check((wallet_summary() #>> '{incentives,pendingApproval}')::numeric = 0, 'incentives have no approval stage: none is pending');
reset role;
-- a salary that is not a number is shown as text, with no amount
update public.hr_employees set monthly_salary = 'as per offer letter' where id = 'TEST-WT-tm_b';
set role authenticated;
select test.login('tm_b');
select test.check(wallet_summary() #> '{salary,monthly}' = 'null'::jsonb and wallet_summary() #>> '{salary,monthlyText}' = 'as per offer letter', 'a salary written in words has no amount, its text is shown');
reset role;
update public.hr_employees set monthly_salary = '₹25,000 per month' where id = 'TEST-WT-tm_b';

\echo '   2. An incentive is earned: it is credited, shown, and the employee is told once'
select test.wt_earn('1', 5000);
set role authenticated;
select test.login('tm_b');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 5000 and (wallet_summary() #>> '{incentives,credited}')::numeric = :earned0 + 5000,
  'the balance and the credited incentives include it at once');
select test.check((wallet_summary() ->> 'availableToWithdraw')::numeric = :earned0 + :credits0 - :paid0 + 5000, 'and it is available to withdraw');
select test.check((wallet_summary() #>> '{thisMonth,incentives}')::numeric >= 5000, 'it is in this month''s incentives');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'INCENTIVE_CREDIT', p_limit => 100) -> 'items') x
                    where x ->> 'reference' like 'EARN-%' and (x ->> 'amount')::numeric = 5000 and x ->> 'status' = 'CREDITED' and x ->> 'employeeId' = test.id('tm_b')::text and x ->> 'source' = 'VISIT_COMPLETED'),
  'the ledger has an Incentive Credit of 5000, credited, with its source and the employee');
reset role;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_INCENTIVE_CREDITED' and title like '%5,000.00%'$q$) = 1,
  'the employee gets one notification "Incentive credited to your wallet"');
-- the same earning cannot be recorded twice (existing rule), and a repeat of the same status change does not notify again
select test.must_fail($$select test.wt_earn('1', 5000)$$, 'the same event cannot be credited twice', 'duplicate key');
update earnings set status = 'EARNED' where event_ref = 'TESTWT:1';
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_INCENTIVE_CREDITED'$q$) = 1, 'no duplicate notification');

\echo '   3. An incentive is reversed: a Reversal takes it back, the ledger still adds up'
update earnings set status = 'REVERSED', reversed_at = now() where event_ref = 'TESTWT:1';
set role authenticated;
select test.login('tm_b');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0, 'the balance is back where it was');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'REVERSAL', p_limit => 100) -> 'items') x where (x ->> 'amount')::numeric = -5000),
  'the ledger shows a Reversal of -5000');
select test.check((wallet_transactions() ->> 'balance')::numeric = (wallet_summary() ->> 'balance')::numeric, 'the sum of the ledger is the balance');
reset role;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_INCENTIVE_REVERSED'$q$) = 1, 'and the employee is told about the reversal once');
update earnings set status = 'EARNED', reversed_at = null where event_ref = 'TESTWT:1';

\echo '   4. Wallet credits: who may enter, who may approve, and what a pending one is worth'
set role authenticated;
select test.login('acc_m');
insert into wt select 'bonus', (wallet_credit_create(test.id('tm_b'), 'BONUS', 2000, 'WT Diwali bonus', 'WT-REF-1', 'wt-request-0001') ->> 'id');
select test.check((select count(*) = 1 from wallet_credit_queue('PENDING_APPROVAL') x, jsonb_array_elements(x) y where y ->> 'description' = 'WT Diwali bonus'), 'Accounts enters a bonus; it waits for approval');
select test.check((wallet_credit_create(test.id('tm_b'), 'BONUS', 2000, 'WT Diwali bonus', 'WT-REF-1', 'wt-request-0001') ->> 'id') = (select v from wt where k = 'bonus'), 'the same form sent twice is the same credit');
select test.check(test.wt_q($q$select count(*) from public.wallet_credits where description = 'WT Diwali bonus'$q$) = 1, 'and only one row exists');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', 2000, 'WT Diwali bonus again', 'WT-REF-1', 'wt-request-0002')$$, 'the same reference is not credited to the same person twice', 'already used');
select test.must_fail($$select wallet_credit_create(test.id('acc_m'), 'BONUS', 100, 'WT own wallet', null, 'wt-request-0003')$$, 'nobody credits their own wallet', 'own wallet');
select test.must_fail($$select wallet_credit_create(test.id('sa'), 'BONUS', 100, 'WT to the Super Admin', null, 'wt-request-0004')$$, 'the Super Admin has no wallet to credit', 'active employee');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', -100, 'WT negative bonus', null, 'wt-request-0005')$$, 'a bonus cannot be negative', 'positive');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', 0, 'WT zero', null, 'wt-request-0006')$$, 'nor zero', 'amount');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', 100, 'x', null, 'wt-request-0007')$$, 'a credit says what it is for', 'what it is for');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'SALARY', 100, 'WT salary', null, 'wt-request-0008')$$, 'only Bonus, Adjustment or Refund', 'Bonus, Adjustment or Refund');
select test.must_fail(format($$select wallet_credit_decide('%s', true)$$, (select v from wt where k = 'bonus')), 'the person who entered it cannot approve it', 'different Accounts person');
select test.login('tm_b');
select test.check((wallet_summary() #>> '{pending,credits}')::numeric = 2000 and (wallet_summary() #>> '{bonuses,pending}')::numeric = 2000, 'the employee sees the bonus as pending');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 5000 and (wallet_summary() ->> 'availableToWithdraw')::numeric = :earned0 + :credits0 - :paid0 + 5000,
  'a pending bonus is not in the balance and cannot be withdrawn');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'BONUS_CREDIT', p_limit => 100) -> 'items') x
                    where x ->> 'status' = 'PENDING_APPROVAL' and (x ->> 'countsInBalance')::boolean = false and x ->> 'createdBy' is not null), 'the ledger shows it pending, not counted');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', 100, 'WT by the employee', null, 'wt-request-0009')$$, 'an employee cannot credit anybody', 'Accounts department');
select test.must_fail(format($$select wallet_credit_decide('%s', true)$$, (select v from wt where k = 'bonus')), 'an employee cannot approve their own bonus', 'Accounts department');
select test.must_fail($$select wallet_credit_queue()$$, 'nor read the queue', 'Accounts department');
select test.login('th_wab');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', 100, 'WT by a team lead', null, 'wt-request-0010')$$, 'a Team Lead cannot', 'Accounts department');
select test.login('dh_wab');
select test.must_fail($$select wallet_people('Member')$$, 'a Department Head cannot', 'Accounts department');
select test.login('hr_head');
select test.must_fail($$select wallet_credit_create(test.id('tm_b'), 'BONUS', 100, 'WT by HR', null, 'wt-request-0011')$$, 'HR cannot enter credits (Accounts does)', 'Accounts department');
select test.login('dh_acc');
select test.check((wallet_credit_decide((select v from wt where k = 'bonus')::uuid, true, 'Approved') ->> 'status') = 'CREDITED', 'a different Accounts person approves it');
select test.must_fail(format($$select wallet_credit_decide('%s', true)$$, (select v from wt where k = 'bonus')), 'a credit is decided once', 'already decided');
select test.login('tm_b');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 7000 and (wallet_summary() #>> '{bonuses,credited}')::numeric >= 2000 and (wallet_summary() #>> '{pending,credits}')::numeric = 0,
  'now it is in the balance, and no longer pending');
select test.check((wallet_summary() ->> 'availableToWithdraw')::numeric = :earned0 + :credits0 - :paid0 + 7000, 'and a credited bonus can be withdrawn');
select test.check((wallet_transactions() ->> 'balance')::numeric = (wallet_summary() ->> 'balance')::numeric, 'the ledger still adds up to the balance');
reset role;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_CREDIT_CREDITED'$q$) = 1, 'the employee is told once that the bonus was credited');
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('dh_acc') and type = 'WALLET_CREDIT_PENDING'$q$) >= 1, 'the other Accounts people were told it waited');
select test.check(test.wt_q($q$select count(*) from public.audit_logs where entity_id = (select v from pg_temp.wt where k = 'bonus')::uuid and action in ('WALLET_CREDIT_CREATED', 'WALLET_CREDIT_CREDITED')$q$) = 2, 'entering and crediting are audited');
select test.must_fail(format($$update wallet_credits set amount = 99999 where id = '%s'$$, (select v from wt where k = 'bonus')), 'a decided credit cannot be changed', 'already decided');
select test.must_fail(format($$delete from wallet_credits where id = '%s'$$, (select v from wt where k = 'bonus')), 'and is never deleted', 'never deleted');

\echo '   5. Adjustments and rejections'
set role authenticated;
select test.login('acc_m');
insert into wt select 'down', (wallet_credit_create(test.id('tm_b'), 'ADJUSTMENT', -1000, 'WT correction', null, 'wt-request-0020') ->> 'id');
insert into wt select 'huge', (wallet_credit_create(test.id('tm_b'), 'ADJUSTMENT', -5000000, 'WT too large a deduction', null, 'wt-request-0021') ->> 'id');
insert into wt select 'reject', (wallet_credit_create(test.id('tm_b'), 'REFUND', 300, 'WT refund to reject', null, 'wt-request-0022') ->> 'id');
select test.login('dh_acc');
select test.must_fail(format($$select wallet_credit_decide('%s', true)$$, (select v from wt where k = 'huge')), 'a deduction that would make the wallet negative is refused', 'negative');
select test.must_fail(format($$select wallet_credit_decide('%s', false)$$, (select v from wt where k = 'reject')), 'a rejection says why', 'why');
select test.check((wallet_credit_decide((select v from wt where k = 'reject')::uuid, false, 'Not applicable') ->> 'status') = 'REJECTED', 'a credit can be rejected with a reason');
select test.check((wallet_credit_decide((select v from wt where k = 'down')::uuid, true) ->> 'status') = 'CREDITED', 'a smaller deduction is approved');
select test.login('tm_b');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 6000 and (wallet_summary() #>> '{adjustments,net}')::numeric = -1000, 'the adjustment took 1000 off (balance 6000)');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'WALLET_ADJUSTMENT', p_limit => 100) -> 'items') x where (x ->> 'amount')::numeric = -1000 and x ->> 'status' = 'CREDITED'),
  'the ledger shows the adjustment as a debit');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'REFUND', p_limit => 100) -> 'items') x where x ->> 'status' = 'REJECTED' and (x ->> 'countsInBalance')::boolean = false),
  'a rejected refund is listed and counts for nothing');
select test.check((wallet_transactions() ->> 'balance')::numeric = (wallet_summary() ->> 'balance')::numeric, 'the ledger adds up');
reset role;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('acc_m') and type = 'WALLET_CREDIT_REJECTED'$q$) = 1, 'the person who entered a rejected credit is told');
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_CREDIT_CREDITED'$q$) = 2, 'a rejected credit does not notify the employee as credited');

\echo '   6. Withdrawals: what can and cannot be withdrawn'
set role authenticated;
select test.login('tm_b');
select payout_method_save('{"kind":"BANK","holderName":"Test Member B","accountNumber":"123456789012","ifsc":"HDFC0001234"}');
-- a pending credit (and uncredited salary) is not withdrawable
select test.login('acc_m');
insert into wt select 'pending', (wallet_credit_create(test.id('tm_b'), 'BONUS', 90000, 'WT big pending bonus', 'WT-REF-9', 'wt-request-0030') ->> 'id');
select test.login('tm_b');
select test.must_fail(format($$select payout_request(%s, 'wt-withdraw-0001')$$, :earned0 + :credits0 - :paid0 + 6000 + 1000), 'more than the credited balance cannot be withdrawn', 'You can withdraw up to');
select test.must_fail($$select payout_request(100000, 'wt-withdraw-0002')$$, 'pending bonuses and uncredited salary are not withdrawable', 'You can withdraw up to');
select test.must_fail($$select payout_request(100, 'wt-withdraw-0003')$$, 'under the minimum', 'at least');
insert into wt select 'w1', (payout_request(1000, 'wt-withdraw-0004') ->> 'id');
select test.check((payout_request(1000, 'wt-withdraw-0004') ->> 'id') = (select v from wt where k = 'w1'), 'the same press sent twice is one request');
select test.must_fail($$select payout_request(1000, 'wt-withdraw-0005')$$, 'a second request while one is open is refused (no duplicates)', 'already have a withdrawal');
select test.check((wallet_summary() ->> 'reserved')::numeric = 1000 and (wallet_summary() ->> 'availableToWithdraw')::numeric = :earned0 + :credits0 - :paid0 + 5000
                  and (wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 6000 and (wallet_summary() #>> '{withdrawals,openRequest,status}') = 'REQUESTED',
  'the 1000 is reserved: off "available", still in the balance until it is paid');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'WITHDRAWAL_REQUEST', p_limit => 100) -> 'items') x where x ->> 'status' = 'REQUESTED' and (x ->> 'amount')::numeric = -1000), 'the ledger shows the withdrawal request');
select test.check((wallet_transactions() ->> 'balance')::numeric = (wallet_summary() ->> 'balance')::numeric, 'the ledger adds up');
reset role;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_WITHDRAWAL_SUBMITTED'$q$) = 1, 'the employee is told the request was submitted (once, though they acted themselves)');
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('acc_m') and type = 'PAYOUT_REQUESTED'$q$) >= 1, 'Accounts is told (the existing notification)');

\echo '   7. Accounts pays, rejects; the employee cancels'
set role authenticated;
select test.login('tm_b');
select test.must_fail(format($$select payout_mark_paid('%s', 'UTR1', (now() at time zone 'Asia/Kolkata')::date, 0)$$, (select v from wt where k = 'w1')), 'an employee cannot pay their own withdrawal', 'Accounts');
select test.login('acc_m');
select test.check((payout_mark_paid((select v from wt where k = 'w1')::uuid, 'UTR-WT-1', (now() at time zone 'Asia/Kolkata')::date, 0) ->> 'status') = 'PAID', 'Accounts pays it');
select test.login('tm_b');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 5000 and (wallet_summary() ->> 'reserved')::numeric = 0 and (wallet_summary() #>> '{withdrawals,total}')::numeric = :paid0 + 1000,
  'the payment takes 1000 off the balance; the total withdrawn is 1000 more');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'WITHDRAWAL_PAYMENT', p_limit => 100) -> 'items') x
                    where x ->> 'status' = 'PAID' and (x ->> 'amount')::numeric = -1000 and x ->> 'reference' = 'UTR-WT-1' and x ->> 'approvedBy' is not null), 'the ledger shows the Withdrawal Payment with its reference and who paid');
select test.check((wallet_transactions() ->> 'balance')::numeric = (wallet_summary() ->> 'balance')::numeric, 'the ledger adds up');
insert into wt select 'w2', (payout_request(500, 'wt-withdraw-0006') ->> 'id');
select test.login('acc_m');
select test.check((payout_reject((select v from wt where k = 'w2')::uuid, 'Details do not match') ->> 'status') = 'REJECTED', 'Accounts rejects a request with a reason');
select test.login('tm_b');
select test.check((wallet_summary() ->> 'balance')::numeric = :earned0 + :credits0 - :paid0 + 5000 and (wallet_summary() ->> 'availableToWithdraw')::numeric = :earned0 + :credits0 - :paid0 + 5000, 'a rejected request frees its amount');
select test.check((select count(*) = 1 from jsonb_array_elements(wallet_transactions(p_type => 'WITHDRAWAL_REQUEST', p_limit => 100) -> 'items') x
                    where x ->> 'status' = 'REJECTED' and x ->> 'description' like '%Details do not match%' and (x ->> 'countsInBalance')::boolean = false), 'the rejection and its reason are in the history');
insert into wt select 'w3', (payout_request(500, 'wt-withdraw-0007') ->> 'id');
select test.check((payout_cancel((select v from wt where k = 'w3')::uuid) ->> 'status') = 'CANCELLED', 'the employee cancels a request');
select test.check((wallet_summary() ->> 'availableToWithdraw')::numeric = :earned0 + :credits0 - :paid0 + 5000 and (wallet_transactions() ->> 'balance')::numeric = (wallet_summary() ->> 'balance')::numeric, 'and the amount is free again; the ledger adds up');
reset role;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'PAYOUT_PAID'$q$) >= 1
                  and test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'PAYOUT_REJECTED'$q$) >= 1, 'paid and rejected are notified (the existing notifications)');
-- a Razorpay payment being processed is "approved": one notification
update payout_requests set status = 'PROCESSING' where id = (select v from wt where k = 'w3')::uuid;
update payout_requests set status = 'REQUESTED' where id = (select v from wt where k = 'w3')::uuid;
update payout_requests set status = 'PROCESSING' where id = (select v from wt where k = 'w3')::uuid;
select test.check(test.wt_q($q$select count(*) from public.notifications where recipient_id = test.id('tm_b') and type = 'WALLET_WITHDRAWAL_APPROVED'$q$) = 1, 'a withdrawal that moves to processing says "approved", once');
update payout_requests set status = 'CANCELLED' where id = (select v from wt where k = 'w3')::uuid;

\echo '   8. The monthly summary and the transaction filters'
set role authenticated;
select test.login('tm_b');
select test.check((select (x ->> 'incentives')::numeric >= 5000 and (x ->> 'bonuses')::numeric >= 2000 and (x ->> 'withdrawn')::numeric >= 1000 from jsonb_array_elements(wallet_monthly(3)) x limit 1), 'this month: incentives, bonuses and withdrawals');
select test.check(jsonb_array_length(wallet_monthly(12)) = 12 and jsonb_array_length(wallet_monthly(1)) = 1, 'the months asked for');
select test.check((wallet_transactions(p_from => (now() at time zone 'Asia/Kolkata')::date + 1) ->> 'total')::integer = 0 and (wallet_transactions(p_from => (now() at time zone 'Asia/Kolkata')::date - 1, p_to => (now() at time zone 'Asia/Kolkata')::date + 1) ->> 'total')::integer >= 5, 'the date filter');
select test.check(jsonb_array_length(wallet_transactions(p_limit => 2) -> 'items') = 2 and (wallet_transactions(p_limit => 2, p_offset => 2) ->> 'total') = (wallet_transactions(p_limit => 2) ->> 'total'), 'paging');
select test.must_fail($$select wallet_transactions(p_type => 'MAGIC')$$, 'an unknown type is refused', 'Unknown transaction type');
select test.must_fail($$select wallet_transactions(p_from => (now() at time zone 'Asia/Kolkata')::date, p_to => (now() at time zone 'Asia/Kolkata')::date - 3)$$, 'an end before the start is refused', 'before');

\echo '   9. Isolation: nobody else sees this wallet'
select test.login('tm_a');
select test.check(not exists (select 1 from jsonb_array_elements(wallet_transactions(p_limit => 100) -> 'items') x where x ->> 'employeeId' = test.id('tm_b')::text or x ->> 'reference' = 'UTR-WT-1' or x ->> 'description' like 'WT %'),
  'another employee''s ledger has none of these rows');
select test.login('sa');
select test.check(not (wallet_summary() ->> 'eligible')::boolean and jsonb_array_length(wallet_transactions() -> 'items') = 0, 'the Super Admin has no wallet');
reset role;
set role anon;
select test.must_fail($$select wallet_summary()$$, 'a visitor has no wallet', 'permission denied');
select test.must_fail($$select wallet_report()$$, 'nor reports', 'permission denied');
reset role;

\echo '   10. The report: Accounts, HR and the Super Admin only'
set role authenticated;
select test.login('acc_m');
select test.check((wallet_report() #>> '{incentives,generated}')::numeric >= 5000 and (wallet_report() #>> '{credits,credited}')::numeric >= 1000
                  and (wallet_report() #>> '{withdrawals,paidAmount}')::numeric >= 1000 and (wallet_report() #>> '{credits,pendingCount}')::integer >= 1, 'Accounts reads the totals');
select test.check(exists (select 1 from jsonb_array_elements(wallet_report() -> 'employees') x where x ->> 'profileId' = test.id('tm_b')::text and (x ->> 'incentives')::numeric >= 5000), 'employee-wise earnings');
select test.check(jsonb_array_length(wallet_report() -> 'departments') >= 1 and jsonb_array_length(wallet_report() -> 'months') = 12, 'department-wise incentives and the monthly summary');
select test.check((wallet_report() #>> '{salary,monthlyPayable}')::numeric >= 25000 and not (wallet_report() #>> '{salary,payrollTracked}')::boolean, 'the salary payable is the HR figures, and says payroll is not tracked');
select test.login('hr_head');
select test.check((wallet_report() #>> '{incentives,generated}')::numeric >= 5000, 'HR reads the report');
select test.login('sa');
select test.check((wallet_report() #>> '{incentives,generated}')::numeric >= 5000, 'and the Super Admin');
select test.login('tm_b');
select test.must_fail($$select wallet_report()$$, 'an employee cannot', 'Accounts, HR');
select test.login('th_wab');
select test.must_fail($$select wallet_report()$$, 'a Team Lead cannot (no permission is given by the role)', 'Accounts, HR');
select test.login('dh_wab');
select test.must_fail($$select wallet_report()$$, 'nor a Department Head', 'Accounts, HR');
select test.login('acc_m');
select test.must_fail($$select wallet_report(date '2020-01-01', date '2026-01-01')$$, 'a period over 400 days is refused', '400 days');

\echo '   11. Existing behaviour is intact'
select test.login('tm_b');
select test.check((income_summary() ->> 'available')::numeric = (wallet_summary() ->> 'availableToWithdraw')::numeric and (income_summary() ->> 'withdrawn')::numeric = :paid0 + 1000,
  'My Income and the wallet agree on what is available and what was withdrawn');
reset role;
select test.check((select count(*) = 0 from payout_requests where profile_id = test.id('tm_b') and status in ('REQUESTED', 'PROCESSING')), 'no request is left open');

alter table wallet_credits disable trigger wallet_credits_guard;
delete from wallet_credits where description like 'WT %';
alter table wallet_credits enable trigger wallet_credits_guard;
delete from payout_requests where profile_id = test.id('tm_b');
delete from payout_methods where profile_id = test.id('tm_b');
delete from earnings where event_ref like 'TESTWT:%';
delete from incentive_rules where name = 'Test wallet rule';
delete from hr_employees where id = 'TEST-WT-tm_b';
select set_config('request.jwt.claims', '', false);
\echo '=== ALL EMPLOYEE WALLET TESTS PASSED ==='
