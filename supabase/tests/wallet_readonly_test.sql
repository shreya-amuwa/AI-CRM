-- =============================================================================
-- Wallet reads must be VOLATILE (migration 20270227000100). PostgREST runs a call to a STABLE function in a read-only transaction; the Wallet's reads renew the
-- PIN unlock with an UPDATE, so they must be VOLATILE or the Wallet page shows "cannot execute UPDATE in a read-only transaction". Runs after wallet_pin_test.sql (tm_a).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 152. Wallet reads in a read-only transaction'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270227000100_wallet_reads_volatile.sql
\i supabase/migrations/20270227000100_wallet_reads_volatile.sql
select test.check((select count(*) = 3 and bool_and(provolatile = 'v') from pg_proc where pronamespace = 'public'::regnamespace and proname in ('wallet_summary', 'wallet_transactions', 'wallet_monthly')),
  'the three Wallet reads are volatile (they renew the unlock)');
select test.check((select provolatile = 's' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'wallet_pin_status'), 'wallet_pin_status writes nothing and stays stable');
delete from wallet_pins where profile_id = test.id('tm_a');
delete from wallet_unlocks where profile_id = test.id('tm_a');
create or replace function test.rlogin(p_name text, p_sid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', test.id(p_name), 'role', 'authenticated', 'session_id', p_sid)::text, false) $$;
grant execute on function test.rlogin(text, text) to authenticated;
set role authenticated;
select test.rlogin('tm_a', 'ro1');
select test.check((select (wallet_pin_set('482913', '482913') ->> 'unlocked')::boolean), 'setup: a PIN is set and the wallet is open');
-- PostgREST wraps a call to a STABLE function in a READ ONLY transaction (where the unlock renewal's UPDATE is refused); a VOLATILE one runs read-write. So the Wallet's reads
-- must be volatile (checked above) and must still work, renewing the unlock each time:
set role authenticated;
select test.rlogin('tm_a', 'ro1');
select test.check((select wallet_summary() ? 'balance'), 'the summary answers');
select test.check((select wallet_transactions() ? 'items'), 'the transactions answer');
select test.check((select jsonb_typeof(wallet_monthly(3)) = 'array'), 'the months answer');
reset role;
select test.check((select expires_at > now() + interval '14 minutes' from wallet_unlocks where profile_id = test.id('tm_a') and session_id = 'ro1'), 'and each read renews the unlock for 15 minutes');
-- a stable function that writes is exactly what the API refuses: none of the Wallet's reads is one any more
select test.check(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'wallet\_%' and p.provolatile <> 'v' and p.prosrc ~* 'private\.wallet_me\(\)'),
  'no stable Wallet function calls the unlock renewal (private.wallet_me)');
set role authenticated;
select test.rlogin('tm_a', 'ro2-other');
select test.must_fail($$select wallet_summary()$$, 'a session that has not unlocked is still refused', 'WALLET_LOCKED');
reset role;
delete from wallet_pins where profile_id = test.id('tm_a');
delete from wallet_unlocks where profile_id = test.id('tm_a');
select set_config('request.jwt.claims', '', false);
