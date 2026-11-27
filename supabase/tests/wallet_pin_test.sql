-- =============================================================================
-- Wallet PIN (migration 20270222000100, 4 digits since 20270228000100): set once, unlock per sign-in session, 5 wrong PINs lock it, change, forgot (an e-mailed code), and the
-- Wallet's own functions refuse until the PIN is entered. Runs after wallet_test.sql (reuses tm_b, tm_a, sa). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 151. Wallet PIN'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270222000100_wallet_pin.sql
\i supabase/migrations/20270222000100_wallet_pin.sql
-- the PIN is exactly 4 digits since 20270228000100 (it replaces the functions above, so it is applied last)
\i supabase/migrations/20270228000100_wallet_pin_four_digits.sql
\i supabase/migrations/20270228000100_wallet_pin_four_digits.sql
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
select test.must_fail($$select wallet_pin_set('123', '123')$$, 'a 3-digit PIN is refused', '4 digits');
select test.must_fail($$select wallet_pin_set('48291', '48291')$$, 'a 5-digit PIN is refused', '4 digits');
select test.must_fail($$select wallet_pin_set('482913', '482913')$$, 'a 6-digit PIN is refused', '4 digits');
select test.must_fail($$select wallet_pin_set('48a9', '48a9')$$, 'letters are refused', '4 digits');
select test.must_fail($$select wallet_pin_set('48 9', '48 9')$$, 'a space is refused', '4 digits');
select test.must_fail($$select wallet_pin_set('48-9', '48-9')$$, 'a symbol is refused', '4 digits');
select test.must_fail($$select wallet_pin_set('', '')$$, 'an empty PIN is refused', '4 digits');
select test.must_fail($$select wallet_pin_set(null, null)$$, 'no PIN is refused', '4 digits');
select test.must_fail($$select wallet_pin_set('4829', '482914')$$, 'the two PINs must match', 'do not match');
select test.must_fail($$select wallet_pin_set('1111', '1111')$$, 'the same digit four times is refused', 'harder to guess');
select test.must_fail($$select wallet_pin_set('1234', '1234')$$, 'a simple sequence is refused', 'harder to guess');
select test.must_fail($$select wallet_pin_set('4321', '4321')$$, 'and a descending one', 'harder to guess');
select test.check((select (wallet_pin_set('4829', '4829') ->> 'unlocked')::boolean), 'the PIN is set and the wallet is open in this session');
select test.check((select wallet_summary() ? 'balance'), 'the wallet opens');
select test.must_fail($$select wallet_pin_set('7391', '7391')$$, 'a second set is refused (use Change or Forgot)', 'already set');
reset role;
select test.check((select pin_hash <> '4829' and pin_hash like '$2%' and pin_length = 4 from wallet_pins where profile_id = test.id('tm_b')), 'only a bcrypt hash is stored, never the PIN');
select test.check(not has_table_privilege('authenticated', 'public.wallet_pins', 'select') and not has_table_privilege('authenticated', 'public.wallet_unlocks', 'select')
                  and not has_table_privilege('authenticated', 'public.wallet_pin_resets', 'select'), 'the PIN tables cannot be read directly');
set role authenticated;

\echo '   another sign-in needs the PIN again; a token without a session never opens it'
select test.slogin('tm_b', 's2');
select test.check((select s ->> 'hasPin' = 'true' and s ->> 'unlocked' = 'false' from (select wallet_pin_status() s) x), 'another session: a PIN, not unlocked');
select test.must_fail($$select wallet_summary()$$, 'another session is locked', 'WALLET_LOCKED');
select test.login('tm_b');
select test.must_fail($$select wallet_summary()$$, 'a token without a session id is never unlocked', 'WALLET_LOCKED');
select test.check((select not (wallet_pin_unlock('4829') ->> 'unlocked')::boolean), '... even with the right PIN');

\echo '   wrong PINs: 5 lock it for 15 minutes'
select test.slogin('tm_b', 's2');
select test.check((select (r ->> 'triesLeft')::int = 4 and not (r ->> 'unlocked')::boolean from (select wallet_pin_unlock('0001') r) x), 'a wrong PIN: 4 tries left');
select wallet_pin_unlock('0002'); select wallet_pin_unlock('0003'); select wallet_pin_unlock('0004');
select test.check((select r ->> 'lockedUntil' is not null and (r ->> 'triesLeft')::int = 0 from (select wallet_pin_unlock('0005') r) x), 'the fifth wrong PIN locks the wallet');
select test.check((select not (wallet_pin_unlock('4829') ->> 'unlocked')::boolean), 'while locked even the right PIN does not open it');
select test.must_fail($$select wallet_summary()$$, 'still locked', 'WALLET_LOCKED');
reset role;
update wallet_pins set locked_until = now() - interval '1 second' where profile_id = test.id('tm_b');   -- 15 minutes went by
set role authenticated;
select test.slogin('tm_b', 's2');
select test.check((select (wallet_pin_unlock('4829') ->> 'unlocked')::boolean), 'after the lock the right PIN opens it');
select test.check((select wallet_transactions() ? 'items' and jsonb_array_length(wallet_monthly(2)) = 2), 'transactions and months open');

\echo '   nobody else, and the Managing Director has no PIN'
select test.slogin('tm_a', 's9');
select test.check((select wallet_pin_status() ->> 'hasPin' = 'false'), 'another employee has their own PIN state (none)');
select test.must_fail($$select wallet_summary()$$, 'and cannot open a wallet with someone else''s unlock', 'WALLET_LOCKED');
select test.slogin('sa', 's1');
select test.must_fail($$select wallet_pin_set('4829', '4829')$$, 'the Managing Director has no wallet PIN', 'no employee wallet');
reset role;
select test.check(not has_function_privilege('authenticated', 'public.wallet_pin_reset_begin(uuid)', 'execute'), 'nobody signed in can make a reset code (only the API)');
select test.check(not has_function_privilege('anon', 'public.wallet_pin_status()', 'execute'), 'visitors cannot ask about PINs');

\echo '   change PIN'
set role authenticated;
select test.slogin('tm_b', 's2');
select test.must_fail($$select wallet_pin_change('4829', '55', '55')$$, 'the new PIN is checked', '4 digits');
select test.must_fail($$select wallet_pin_change('4829', '739164', '739164')$$, 'a 6-digit new PIN is refused too', '4 digits');
select test.check((select not (r ->> 'changed')::boolean and (r ->> 'triesLeft')::int = 4 from (select wallet_pin_change('9999', '7391', '7391') r) x), 'a wrong old PIN changes nothing and counts');
select test.check((select (wallet_pin_change('4829', '7391', '7391') ->> 'changed')::boolean), 'the right old PIN changes it');
select test.check((select wallet_summary() ? 'balance'), 'this session stays open');
select test.slogin('tm_b', 's1');
select test.must_fail($$select wallet_summary()$$, 'other sessions must enter the new PIN', 'WALLET_LOCKED');
select test.check((select not (wallet_pin_unlock('4829') ->> 'unlocked')::boolean), 'the old PIN no longer works');
select test.check((select (wallet_pin_unlock('7391') ->> 'unlocked')::boolean), 'the new one does');

\echo '   forgot PIN: an e-mailed code'
reset role;
insert into wp select 'code', wallet_pin_reset_begin(test.id('tm_b')) ->> 'code';
select test.check((select v ~ '^[A-HJ-NP-Z2-9]{8}$' from wp where k = 'code'), 'an 8-character code from an unambiguous alphabet');
select test.must_fail(format($$select wallet_pin_reset_begin('%s')$$, test.id('tm_b')), 'a second code within a minute is refused', 'less than a minute');
select test.must_fail(format($$select wallet_pin_reset_begin('%s')$$, test.id('sa')), 'the Managing Director gets no code', 'no employee wallet');
set role authenticated;
select test.slogin('tm_a', 's9');
select test.must_fail($$select wallet_pin_reset_finish((select v from wp where k = 'code'), '8462', '8462')$$, 'someone else cannot use the code', 'not valid');
select test.slogin('tm_b', 's3');
select test.check((select not (r ->> 'reset')::boolean and (r ->> 'triesLeft')::int = 4 from (select wallet_pin_reset_finish('AAAA2222', '8462', '8462') r) x), 'a wrong code counts');
select test.check((select (r ->> 'reset')::boolean and (r ->> 'unlocked')::boolean
                     from (select wallet_pin_reset_finish(lower((select v from wp where k = 'code')), '8462', '8462') r) x), 'the right code (any case) sets the new PIN and opens the wallet');
select test.must_fail($$select wallet_pin_reset_finish((select v from wp where k = 'code'), '8462', '8462')$$, 'a code works once', 'not valid');
select test.slogin('tm_b', 's2');
select test.must_fail($$select wallet_summary()$$, 'after a reset every other session is locked', 'WALLET_LOCKED');
select test.check((select (wallet_pin_unlock('8462') ->> 'unlocked')::boolean), 'the new PIN works');
select wallet_pin_lock();
select test.must_fail($$select wallet_summary()$$, 'Lock closes the wallet in this session', 'WALLET_LOCKED');
reset role;
select test.check((select count(*) >= 4 from audit_logs where entity_id = test.id('tm_b') and action in ('WALLET_PIN_SET', 'WALLET_PIN_LOCKED', 'WALLET_PIN_CHANGED', 'WALLET_PIN_RESET_REQUESTED', 'WALLET_PIN_RESET')),
  'set, lock, change and reset are audited (never the PIN or the code)');
select test.check((select count(*) = 0 from audit_logs where entity_id = test.id('tm_b') and action like 'WALLET_PIN%' and (metadata::text like '%8462%' or metadata::text like '%4829%' or metadata::text like '%7391%')), 'no PIN in the audit log');

\echo '   a legacy 6-digit PIN: nothing is bypassed, nothing is weakened; it is replaced by a 4-digit one'
reset role;
-- tm_a has a PIN made before this change: a bcrypt hash of 6 digits, pin_length 6 (the column default, which every existing row got)
delete from wallet_pins where profile_id = test.id('tm_a');
delete from wallet_unlocks where profile_id = test.id('tm_a');
insert into wallet_pins (profile_id, pin_hash) values (test.id('tm_a'), extensions.crypt('482913', extensions.gen_salt('bf', 10)));
select test.check((select pin_length = 6 from wallet_pins where profile_id = test.id('tm_a')), 'an existing PIN is recorded as a 6-digit PIN');
-- and a session that was already open when the change was deployed
insert into wallet_unlocks (profile_id, session_id, expires_at) values (test.id('tm_a'), 'old-open', now() + interval '10 minutes');
set role authenticated;
select test.slogin('tm_a', 'old-open');
select test.check((select s ->> 'hasPin' = 'true' and (s ->> 'legacy')::boolean and s ->> 'unlocked' = 'false' and (s ->> 'pinLength')::int = 6 from (select wallet_pin_status() s) x),
  'the status says legacy, and not unlocked (even in a session that was open)');
select test.must_fail($$select wallet_summary()$$, 'an already-open session is closed for a legacy PIN until it is changed', 'WALLET_LOCKED');
select test.must_fail($$select wallet_transactions()$$, '... and its transactions', 'WALLET_LOCKED');
select test.slogin('tm_a', 'leg1');
select test.check((select (r ->> 'mustChange')::boolean and not (r ->> 'unlocked')::boolean from (select wallet_pin_unlock('482913') r) x),
  'the right old PIN proves who they are but opens nothing: they must change it');
select test.must_fail($$select wallet_summary()$$, 'the wallet is still closed', 'WALLET_LOCKED');
select test.check((select not (r ->> 'unlocked')::boolean and (r ->> 'triesLeft')::int = 4 from (select wallet_pin_unlock('4829') r) x), 'a 4-digit PIN does not match a legacy one, and counts as a wrong try');
select test.check((select not (r ->> 'changed')::boolean and (r ->> 'triesLeft')::int = 3 from (select wallet_pin_change('111222', '5173', '5173') r) x), 'changing with a wrong old PIN changes nothing and counts');
select test.must_fail($$select wallet_pin_change('482913', '482913', '482913')$$, 'the new PIN must be 4 digits', '4 digits');
select test.must_fail($$select wallet_pin_change('482913', '1111', '1111')$$, 'and not trivial', 'harder to guess');
select test.must_fail($$select wallet_pin_change('482913', '5173', '5174')$$, 'and confirmed', 'do not match');
select test.check((select (r ->> 'changed')::boolean and (r ->> 'unlocked')::boolean from (select wallet_pin_change('482913', '5173', '5173') r) x), 'the right old PIN and a new 4-digit PIN change it and open the wallet');
select test.check((select wallet_summary() ? 'balance'), 'the wallet opens');
reset role;
select test.check((select pin_length = 4 and pin_hash like '$2%' and extensions.crypt('5173', pin_hash) = pin_hash and extensions.crypt('482913', pin_hash) <> pin_hash and failed_count = 0
                     from wallet_pins where profile_id = test.id('tm_a')), 'stored as a new bcrypt hash of the 4-digit PIN; the old 6-digit PIN no longer matches');
select test.check((select count(*) = 1 from audit_logs where entity_id = test.id('tm_a') and action = 'WALLET_PIN_CHANGED' and metadata ->> 'from' = 'LEGACY_6_DIGITS'), 'the change is audited as a legacy upgrade (never the PIN)');
set role authenticated;
select test.slogin('tm_a', 'leg2');
select test.check((select not (wallet_pin_unlock('482913') ->> 'unlocked')::boolean), 'the old 6-digit PIN does not unlock any more');
select test.check((select (wallet_pin_unlock('5173') ->> 'unlocked')::boolean), 'the new 4-digit PIN does');
reset role;
\echo '   legacy: the same lock after 5 wrong PINs'
delete from wallet_pins where profile_id = test.id('tm_a');
delete from wallet_unlocks where profile_id = test.id('tm_a');
insert into wallet_pins (profile_id, pin_hash) values (test.id('tm_a'), extensions.crypt('482913', extensions.gen_salt('bf', 10)));
set role authenticated;
select test.slogin('tm_a', 'leg3');
select wallet_pin_unlock('000001'); select wallet_pin_unlock('000002'); select wallet_pin_unlock('000003'); select wallet_pin_unlock('000004');
select test.check((select r ->> 'lockedUntil' is not null and (r ->> 'triesLeft')::int = 0 from (select wallet_pin_unlock('000005') r) x), 'five wrong PINs lock a legacy PIN for 15 minutes too');
select test.check((select not (r ->> 'changed')::boolean and r ->> 'lockedUntil' is not null from (select wallet_pin_change('482913', '5173', '5173') r) x), 'while locked even the right old PIN changes nothing');
reset role;
\echo '   legacy: Forgot PIN ends it'
update wallet_pins set locked_until = null, failed_count = 0 where profile_id = test.id('tm_a');
insert into wp select 'code2', wallet_pin_reset_begin(test.id('tm_a')) ->> 'code';
set role authenticated;
select test.slogin('tm_a', 'leg4');
select test.must_fail($$select wallet_pin_reset_finish((select v from wp where k = 'code2'), '482913', '482913')$$, 'the reset also needs a 4-digit PIN', '4 digits');
select test.check((select (r ->> 'reset')::boolean and (r ->> 'unlocked')::boolean from (select wallet_pin_reset_finish((select v from wp where k = 'code2'), '6204', '6204') r) x), 'a reset with the e-mailed code sets a 4-digit PIN and opens the wallet');
reset role;
select test.check((select pin_length = 4 from wallet_pins where profile_id = test.id('tm_a')), 'and the PIN is no longer legacy');
select test.check((select count(*) = 0 from wallet_pins where pin_length <> 4 and profile_id in (test.id('tm_a'), test.id('tm_b'))), 'no legacy PIN is left among the people tested');
delete from wallet_pins where profile_id = test.id('tm_a');
delete from wallet_unlocks where profile_id = test.id('tm_a');
select set_config('request.jwt.claims', '', false);
\echo '=== ALL WALLET PIN TESTS PASSED ==='
