-- =============================================================================
-- Incentive payouts through RazorpayX (migration 20270125000100): the server-only steps a Razorpay payout goes through (begin, link the
-- Razorpay contact, record the payout id, settle from the webhook or a status check, undo when Razorpay refused it), and who may start one.
-- Runs after payouts_test.sql (its helpers test.po_earn / test.po_join and fixtures tm_a, acc_m). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 149. Incentive payouts through Razorpay'
reset role;
\i supabase/migrations/20270125000100_incentive_payouts_razorpay.sql
\i supabase/migrations/20270125000100_incentive_payouts_razorpay.sql
delete from razorpay_events where event_id like 'evt_test_%';
update payout_requests set rzp_payout_id = null where rzp_payout_id like 'pout_test_%';
update payout_requests set status = 'REJECTED', reason = 'Test cleanup' where profile_id in (test.id('tm_a'), test.id('acc_m')) and status in ('REQUESTED', 'PROCESSING');
select test.po_join('tm_a', date '2026-01-01');
select test.po_earn('tm_a', 'rzp1', 5000) where not exists (select 1 from earnings where event_ref = 'TESTPO:rzp1');
insert into payout_methods (profile_id, kind, holder_name, upi_id) values (test.id('tm_a'), 'UPI', 'Test Member', 'tm.test@okhdfcbank')
  on conflict (profile_id) do update set kind = 'UPI', holder_name = 'Test Member', upi_id = 'tm.test@okhdfcbank', account_number = null, ifsc = null, other_details = null,
    rzp_contact_id = null, rzp_fund_account_id = null;
create temp table rz (k text primary key, v text);
grant all on rz to authenticated, service_role;
set role authenticated;
select test.login('tm_a');
insert into rz select 'r1', payout_request(1234.50, 'rzp-' || gen_random_uuid()) ->> 'id';
select (income_summary() ->> 'available')::numeric as av1 \gset
reset role;

\echo '   only Accounts starts a Razorpay payout, never for themselves, never for international details'
set role authenticated;
select test.must_fail(format($$select payout_rzp_begin(%L, %L, 0)$$, (select v from rz where k = 'r1'), test.id('acc_m')), 'a signed-in person cannot call the server-only steps', 'permission denied');
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.must_fail(format($$select payout_rzp_begin(%L, %L, 0)$$, (select v from rz where k = 'r1'), test.id('tm_a')), 'someone outside Accounts cannot start one', 'FORBIDDEN');
reset role;
insert into payout_requests (profile_id, amount, method_snapshot, request_id)
  values (test.id('acc_m'), 500, '{"full":{"kind":"UPI","holderName":"Test Accounts","upiId":"acc@okhdfcbank"},"masked":{}}', 'rzp-own-0001')
  on conflict (request_id) do update set status = 'REQUESTED' returning id as own \gset
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.must_fail(format($$select payout_rzp_begin(%L, %L, 0)$$, :'own', test.id('acc_m')), 'nobody sends their own withdrawal', 'FORBIDDEN');
reset role;
update payout_requests set status = 'REJECTED', reason = 'Test cleanup' where id = :'own';
insert into payout_requests (profile_id, amount, method_snapshot, request_id)
  values (test.id('acc_m'), 500, '{"full":{"kind":"OTHER","holderName":"Test Abroad","otherDetails":"IBAN GB00TEST"},"masked":{}}', 'rzp-other-001')
  on conflict (request_id) do update set status = 'REQUESTED' returning id as other \gset
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.must_fail(format($$select payout_rzp_begin(%L, %L, 0)$$, :'other', test.id('sa')), 'international details are paid by hand', 'VALIDATION_ERROR');
reset role;
update payout_requests set status = 'REJECTED', reason = 'Test cleanup' where id = :'other';

\echo '   begin, link, payout id, processed, a repeated event, reversed'
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.check((select x ->> 'status' = 'PROCESSING' and (x ->> 'netAmount')::numeric = 1184.25 and (x -> 'method' ->> 'upiId') = 'tm.test@okhdfcbank'
                     and x ->> 'contactId' is null
                     from (select payout_rzp_begin((select v from rz where k = 'r1')::uuid, test.id('acc_m'), 50.25) x) y),
  'Accounts starts it: PROCESSING, net 1,184.25, the full details for Razorpay');
select test.must_fail(format($$select payout_rzp_begin(%L, %L, 0)$$, (select v from rz where k = 'r1'), test.id('acc_m')), 'a request being sent cannot be started again', 'CONFLICT');
select payout_rzp_link(test.id('tm_a'), 'cont_test_1', 'fa_test_1');
select payout_rzp_set_id((select v from rz where k = 'r1')::uuid, 'pout_test_1');
reset role;
select test.check((select rzp_contact_id = 'cont_test_1' and rzp_fund_account_id = 'fa_test_1' from payout_methods where profile_id = test.id('tm_a')), 'the Razorpay contact is kept for next time');
select test.check((select status = 'PROCESSING' and channel = 'RAZORPAY' and decided_by = test.id('acc_m') from payout_requests where id = (select v from rz where k = 'r1')::uuid),
  'it is being sent by Razorpay, started by the Accountant');
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.check((payout_rzp_settle('pout_test_1', 'processing', null, null, 'evt_test_0') ->> 'status') = 'PROCESSING', 'a processing update keeps it being sent');
select test.check((payout_rzp_settle('pout_test_1', 'processed', 'UTR777', null, 'evt_test_1') ->> 'status') = 'PAID', 'processed: PAID');
reset role;
select test.check((select r.reference = 'UTR777' and r.tds_amount = 50.25 and r.net_amount = 1184.25 and e.category = 'Sales Incentive' and e.amount = 1234.50
                     from payout_requests r join department_expenses e on e.id = r.expense_id where r.id = (select v from rz where k = 'r1')::uuid),
  'the UTR is the reference; TDS and the expense as for a manual payment');
select test.check((select count(*) >= 1 from notifications where type = 'PAYOUT_PAID' and entity_id = (select v from rz where k = 'r1')::uuid), 'the person is told it was paid');
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.check((payout_rzp_settle('pout_test_1', 'processed', 'UTR777', null, 'evt_test_1') ->> 'ignored')::boolean, 'the same event twice changes nothing');
select test.check((payout_rzp_settle('pout_test_1', 'processed', 'UTR777', null, null) ->> 'status') = 'PAID', 'a status check after the webhook changes nothing');
select payout_rzp_settle('pout_test_1', 'reversed', 'UTR777', 'Beneficiary bank rejected', 'evt_test_2');
reset role;
select test.check((select status = 'REVERSED' and expense_id is null and reason = 'Beneficiary bank rejected' from payout_requests where id = (select v from rz where k = 'r1')::uuid)
                  and (select count(*) >= 1 from audit_logs where action = 'PAYOUT_REVERSED' and entity_id = (select v from rz where k = 'r1')::uuid and metadata ? 'expense'),
  'reversed after it was paid: REVERSED, its expense removed (kept in the audit)');
select test.check((select count(*) >= 1 from notifications where type = 'PAYOUT_REVERSED' and entity_id = (select v from rz where k = 'r1')::uuid), 'the person is told it was reversed');
set role authenticated;
select test.login('tm_a');
select test.check((income_summary() ->> 'available')::numeric = :av1 + 1234.50, 'the reversed amount is available again');
select test.check((payout_slip_data((select v from rz where k = 'r1')::uuid) ->> 'void')::boolean, 'its slip is VOID');

\echo '   failed, undo, waiting too long'
insert into rz select 'r2', payout_request(700, 'rzp-' || gen_random_uuid()) ->> 'id';
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select payout_rzp_begin((select v from rz where k = 'r2')::uuid, test.id('acc_m'), 0);
select payout_rzp_set_id((select v from rz where k = 'r2')::uuid, 'pout_test_2');
select test.check((payout_rzp_settle('pout_test_2', 'failed', null, 'Invalid VPA', 'evt_test_3') ->> 'status') = 'FAILED', 'failed: FAILED');
reset role;
select test.check((select reason = 'Invalid VPA' and expense_id is null from payout_requests where id = (select v from rz where k = 'r2')::uuid)
                  and (select count(*) >= 1 from notifications where type = 'PAYOUT_FAILED' and entity_id = (select v from rz where k = 'r2')::uuid),
  'the reason is kept and the person is told');
set role authenticated;
select test.login('tm_a');
select test.check((income_summary() ->> 'available')::numeric = :av1 + 1234.50, 'a failed payout frees the amount');
insert into rz select 'r3', payout_request(600, 'rzp-' || gen_random_uuid()) ->> 'id';
reset role;
select set_config('request.jwt.claims', '', false);
set role service_role;
select payout_rzp_begin((select v from rz where k = 'r3')::uuid, test.id('acc_m'), 0);
select test.check((payout_rzp_undo((select v from rz where k = 'r3')::uuid, 'Razorpay: insufficient balance') ->> 'status') = 'REQUESTED',
  'Razorpay refused before a payout existed: back to waiting');
select test.must_fail(format($$select payout_rzp_undo(%L, 'x')$$, (select v from rz where k = 'r2')), 'only a request being sent can be undone', 'CONFLICT');
select payout_rzp_begin((select v from rz where k = 'r3')::uuid, test.id('acc_m'), 0);
select payout_rzp_set_id((select v from rz where k = 'r3')::uuid, 'pout_test_3');
reset role;
update payout_requests set decided_at = now() - interval '30 minutes' where id = (select v from rz where k = 'r3')::uuid;
select set_config('request.jwt.claims', '', false);
set role service_role;
select test.check(exists (select 1 from jsonb_array_elements(payout_rzp_pending(10)) x where x ->> 'payoutId' = 'pout_test_3'), 'payouts waiting more than 10 minutes are listed for a status check');
select test.check(not exists (select 1 from jsonb_array_elements(payout_rzp_pending(60)) x where x ->> 'payoutId' = 'pout_test_3'), 'not before');
select test.check((payout_rzp_settle('pout_unknown', 'processed', 'U', null, 'evt_test_4') ->> 'matched')::boolean = false, 'an unknown payout is ignored');
reset role;
set role authenticated;
select test.login('acc_m');
select test.check(exists (select 1 from jsonb_array_elements(payout_queue('PROCESSING')) x where x ->> 'id' = (select v from rz where k = 'r3')) and (payout_counts() ->> 'processing')::int >= 1,
  'Accounts sees the payouts being sent');
reset role;
-- details change: the Razorpay contact is dropped (a new fund account is made next time)
set role authenticated;
select test.login('tm_a');
select payout_method_save('{"kind":"UPI","holderName":"Test Member","upiId":"tm.new@okhdfcbank"}');
reset role;
select test.check((select rzp_fund_account_id is null from payout_methods where profile_id = test.id('tm_a')), 'changing the details drops the old Razorpay fund account');
select set_config('request.jwt.claims', '', false);
set role service_role;
select payout_rzp_settle('pout_test_3', 'processed', 'UTR888', null, 'evt_test_5');
reset role;
