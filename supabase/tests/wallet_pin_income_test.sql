-- =============================================================================
-- Wallet PIN on My Income's reads and the person's own withdrawals (migration 20270221000100). Runs after wallet_pin_test.sql (tm_b has a PIN there;
-- tm_a has none). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 152. Wallet PIN on income and withdrawals'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270220000100_wallet_pin.sql
\i supabase/migrations/20270221000100_wallet_pin_income.sql
\i supabase/migrations/20270221000100_wallet_pin_income.sql
delete from wallet_pins where profile_id in (test.id('tm_b'), test.id('tm_a'));
delete from wallet_unlocks where profile_id in (test.id('tm_b'), test.id('tm_a'));
create or replace function test.slogin(p_name text, p_sid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', test.id(p_name), 'role', 'authenticated', 'session_id', p_sid)::text, false) $$;
grant execute on function test.slogin(text, text) to authenticated;

set role authenticated;
\echo '   no PIN yet: nothing to protect, the money reads work (the Wallet asks for a PIN first anyway)'
select test.slogin('tm_a', 'i1');
select test.check((select income_summary() ? 'total' and jsonb_typeof(income_earnings(current_date - 30, current_date)) = 'array' and wallet_summary() ? 'balance'),
  'without a PIN: income, earnings and the wallet read as before');
select test.check((select jsonb_typeof(payout_my_requests()) = 'array'), '... and the withdrawals');

\echo '   a PIN is set: locked until it is entered in this sign-in'
select test.slogin('tm_b', 'i1');
select wallet_pin_set('482913', '482913');
select test.check((select income_summary() ? 'total'), 'just set: open in this session');
select test.slogin('tm_b', 'i2');
select test.must_fail($$select income_summary()$$, 'another sign-in: My Income''s summary is locked', 'WALLET_LOCKED');
select test.must_fail($$select income_earnings(current_date - 30, current_date)$$, '... its earnings', 'WALLET_LOCKED');
select test.must_fail($$select wallet_summary()$$, '... the wallet', 'WALLET_LOCKED');
select test.must_fail($$select payout_my_requests()$$, '... the withdrawals', 'WALLET_LOCKED');
select test.must_fail($$select payout_method_get()$$, '... the payout details', 'WALLET_LOCKED');
select test.must_fail($$select payout_request(500, 'pin-income-test')$$, '... and a new withdrawal', 'WALLET_LOCKED');
select test.must_fail($$select payout_method_save('{"kind":"UPI","holderName":"X","upiId":"x@okhdfcbank"}'::jsonb)$$, '... and changing the payout details', 'WALLET_LOCKED');
select test.check((select (wallet_pin_unlock('482913') ->> 'unlocked')::boolean), 'the PIN is entered');
select test.check((select income_summary() ? 'total' and wallet_summary() ? 'balance' and jsonb_typeof(payout_my_requests()) = 'array'), 'then everything opens');
select wallet_pin_lock();
select test.must_fail($$select income_summary()$$, 'Lock wallet closes My Income''s reads too', 'WALLET_LOCKED');

\echo '   Accounts is not affected'
select test.login('acc_m');
select test.check((select jsonb_typeof(payout_queue('REQUESTED')) in ('array', 'object')), 'Accounts'' payout queue needs no PIN');
reset role;
delete from wallet_pins where profile_id = test.id('tm_b');
delete from wallet_unlocks where profile_id = test.id('tm_b');
select set_config('request.jwt.claims', '', false);
\echo '=== ALL WALLET PIN INCOME TESTS PASSED ==='
