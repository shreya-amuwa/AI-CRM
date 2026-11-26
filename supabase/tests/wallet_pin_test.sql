-- =============================================================================
-- Wallet PIN (migration 20270220000100): set once, unlock per sign-in session, 5 wrong PINs lock it, change, forgot (an e-mailed code), and the
-- Wallet's own functions refuse until the PIN is entered. Runs after wallet_test.sql (reuses tm_b, tm_a, sa). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 151. Wallet PIN'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270220000100_wallet_pin.sql
\i supabase/migrations/20270220000100_wallet_pin.sql
delete from wallet_pins where profile_id in (test.id('tm_b'), test.id('tm_a'));
delete from wallet_unlocks where profile_id in (test.id('tm_b'), test.id('tm_a'));
delete from wallet_pin_resets where profile_id in (test.id('tm_b'), test.id('tm_a'));
-- a sign-in session: the access token's session_id
create or replace function test.slogin(p_name text, p_sid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', test.id(p_name), 'role', 'authenticated', 'session_id', p_sid)::text, false) $$;
grant execute on function test.slogin(text, text) to authenticated;
create temp table wp (k text primary key, v text);
grant all on wp to authenticated;

set role authenticated;
\echo '   first open: set the PIN'
select test.slogin('tm_b', 's1');
select test.check((select s ->> 'hasPin' = 'false' and s ->> 'unlocked' = 'false' from (select wallet_pin_status() s) x), 'no PIN yet, nothing unlocked');
select test.must_fail($$select wallet_summary()$$, 'the wallet is locked before a PIN exists', 'WALLET_LOCKED');
select test.must_fail($$select wallet_transactions()$$, '... and its transactions', 'WALLET_LOCKED');
select test.must_fail($$select wallet_monthly(3)$$, '... and the months', 'WALLET_LOCKED');
select test.must_fail($$select wallet_pin_set('12345', '12345')$$, 'a PIN must be 6 digits', '6 digits');
select test.must_fail($$select wallet_pin_set('48a913', '48a913')$$, 'digits only', '6 digits');
select test.must_fail($$select wallet_pin_set('482913', '482914')$$, 'the two PINs must match', 'do not match');
select test.must_fail($$select wallet_pin_set('111111', '111111')$$, 'the same digit six times is refused', 'harder to guess');
select test.must_fail($$select wallet_pin_set('123456', '123456')$$, 'a simple sequence is refused', 'harder to guess');
select test.check((select (wallet_pin_set('482913', '482913') ->> 'unlocked')::boolean), 'the PIN is set and the wallet is open in this session');
select test.check((select wallet_summary() ? 'balance'), 'the wallet opens');
select test.must_fail($$select wallet_pin_set('739164', '739164')$$, 'a second set is refused (use Change or Forgot)', 'already set');
reset role;
select test.check((select pin_hash <> '482913' and pin_hash like '$2%' from wallet_pins where profile_id = test.id('tm_b')), 'only a bcrypt hash is stored, never the PIN');
select test.check(not has_table_privilege('authenticated', 'public.wallet_pins', 'select') and not has_table_privilege('authenticated', 'public.wallet_unlocks', 'select')
                  and not has_table_privilege('authenticated', 'public.wallet_pin_resets', 'select'), 'the PIN tables cannot be read directly');
set role authenticated;

\echo '   another sign-in needs the PIN again; a token without a session never opens it'
select test.slogin('tm_b', 's2');
select test.check((select s ->> 'hasPin' = 'true' and s ->> 'unlocked' = 'false' from (select wallet_pin_status() s) x), 'another session: a PIN, not unlocked');
select test.must_fail($$select wallet_summary()$$, 'another session is locked', 'WALLET_LOCKED');
select test.login('tm_b');
select test.must_fail($$select wallet_summary()$$, 'a token without a session id is never unlocked', 'WALLET_LOCKED');
select test.check((select not (wallet_pin_unlock('482913') ->> 'unlocked')::boolean), '... even with the right PIN');

\echo '   wrong PINs: 5 lock it for 15 minutes'
select test.slogin('tm_b', 's2');
select test.check((select (r ->> 'triesLeft')::int = 4 and not (r ->> 'unlocked')::boolean from (select wallet_pin_unlock('000001') r) x), 'a wrong PIN: 4 tries left');
select wallet_pin_unlock('000002'); select wallet_pin_unlock('000003'); select wallet_pin_unlock('000004');
select test.check((select r ->> 'lockedUntil' is not null and (r ->> 'triesLeft')::int = 0 from (select wallet_pin_unlock('000005') r) x), 'the fifth wrong PIN locks the wallet');
select test.check((select not (wallet_pin_unlock('482913') ->> 'unlocked')::boolean), 'while locked even the right PIN does not open it');
select test.must_fail($$select wallet_summary()$$, 'still locked', 'WALLET_LOCKED');
reset role;
update wallet_pins set locked_until = now() - interval '1 second' where profile_id = test.id('tm_b');   -- 15 minutes went by
set role authenticated;
select test.slogin('tm_b', 's2');
select test.check((select (wallet_pin_unlock('482913') ->> 'unlocked')::boolean), 'after the lock the right PIN opens it');
select test.check((select wallet_transactions() ? 'items' and jsonb_array_length(wallet_monthly(2)) = 2), 'transactions and months open');

\echo '   nobody else, and the Managing Director has no PIN'
select test.slogin('tm_a', 's9');
select test.check((select wallet_pin_status() ->> 'hasPin' = 'false'), 'another employee has their own PIN state (none)');
select test.must_fail($$select wallet_summary()$$, 'and cannot open a wallet with someone else''s unlock', 'WALLET_LOCKED');
select test.slogin('sa', 's1');
select test.must_fail($$select wallet_pin_set('482913', '482913')$$, 'the Managing Director has no wallet PIN', 'no employee wallet');
reset role;
select test.check(not has_function_privilege('authenticated', 'public.wallet_pin_reset_begin(uuid)', 'execute'), 'nobody signed in can make a reset code (only the API)');
select test.check(not has_function_privilege('anon', 'public.wallet_pin_status()', 'execute'), 'visitors cannot ask about PINs');

\echo '   change PIN'
set role authenticated;
select test.slogin('tm_b', 's2');
select test.must_fail($$select wallet_pin_change('482913', '55', '55')$$, 'the new PIN is checked', '6 digits');
select test.check((select not (r ->> 'changed')::boolean and (r ->> 'triesLeft')::int = 4 from (select wallet_pin_change('999999', '739164', '739164') r) x), 'a wrong old PIN changes nothing and counts');
select test.check((select (wallet_pin_change('482913', '739164', '739164') ->> 'changed')::boolean), 'the right old PIN changes it');
select test.check((select wallet_summary() ? 'balance'), 'this session stays open');
select test.slogin('tm_b', 's1');
select test.must_fail($$select wallet_summary()$$, 'other sessions must enter the new PIN', 'WALLET_LOCKED');
select test.check((select not (wallet_pin_unlock('482913') ->> 'unlocked')::boolean), 'the old PIN no longer works');
select test.check((select (wallet_pin_unlock('739164') ->> 'unlocked')::boolean), 'the new one does');

\echo '   forgot PIN: an e-mailed code'
reset role;
insert into wp select 'code', wallet_pin_reset_begin(test.id('tm_b')) ->> 'code';
select test.check((select v ~ '^[A-HJ-NP-Z2-9]{8}$' from wp where k = 'code'), 'an 8-character code from an unambiguous alphabet');
select test.must_fail(format($$select wallet_pin_reset_begin('%s')$$, test.id('tm_b')), 'a second code within a minute is refused', 'less than a minute');
select test.must_fail(format($$select wallet_pin_reset_begin('%s')$$, test.id('sa')), 'the Managing Director gets no code', 'no employee wallet');
set role authenticated;
select test.slogin('tm_a', 's9');
select test.must_fail($$select wallet_pin_reset_finish((select v from wp where k = 'code'), '846201', '846201')$$, 'someone else cannot use the code', 'not valid');
select test.slogin('tm_b', 's3');
select test.check((select not (r ->> 'reset')::boolean and (r ->> 'triesLeft')::int = 4 from (select wallet_pin_reset_finish('AAAA2222', '846201', '846201') r) x), 'a wrong code counts');
select test.check((select (r ->> 'reset')::boolean and (r ->> 'unlocked')::boolean
                     from (select wallet_pin_reset_finish(lower((select v from wp where k = 'code')), '846201', '846201') r) x), 'the right code (any case) sets the new PIN and opens the wallet');
select test.must_fail($$select wallet_pin_reset_finish((select v from wp where k = 'code'), '846201', '846201')$$, 'a code works once', 'not valid');
select test.slogin('tm_b', 's2');
select test.must_fail($$select wallet_summary()$$, 'after a reset every other session is locked', 'WALLET_LOCKED');
select test.check((select (wallet_pin_unlock('846201') ->> 'unlocked')::boolean), 'the new PIN works');
select wallet_pin_lock();
select test.must_fail($$select wallet_summary()$$, 'Lock closes the wallet in this session', 'WALLET_LOCKED');
reset role;
select test.check((select count(*) >= 4 from audit_logs where entity_id = test.id('tm_b') and action in ('WALLET_PIN_SET', 'WALLET_PIN_LOCKED', 'WALLET_PIN_CHANGED', 'WALLET_PIN_RESET_REQUESTED', 'WALLET_PIN_RESET')),
  'set, lock, change and reset are audited (never the PIN or the code)');
select test.check((select count(*) = 0 from audit_logs where entity_id = test.id('tm_b') and action like 'WALLET_PIN%' and (metadata::text like '%846201%' or metadata::text like '%482913%')), 'no PIN in the audit log');
select set_config('request.jwt.claims', '', false);
\echo '=== ALL WALLET PIN TESTS PASSED ==='
