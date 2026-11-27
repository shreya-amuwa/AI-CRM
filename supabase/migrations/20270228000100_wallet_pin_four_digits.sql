-- =============================================================================
-- Wallet PIN: exactly 4 digits (replaces the 6-digit rule of 20270222000100). Run after 20270222000100_wallet_pin.sql. Safe to run twice; no PIN, session or audit row is deleted.
--
--  * A new PIN (set, change, forgot-PIN reset) must be exactly 4 digits (letters, symbols, 3, 5 or 6 digits are refused) and not the same digit four times or a simple
--    run (1234, 4321, 0123 ...). It is stored only as a bcrypt hash, as before.
--  * LEGACY 6-DIGIT PINs. wallet_pins.pin_length records how long the stored PIN is: every existing row is 6 (the column's default), every PIN made from now on is 4. A person
--    whose PIN is still 6 digits is NOT locked out and nothing is bypassed:
--      - the Wallet stays closed for them (wallet_me refuses with WALLET_LOCKED, even in a session that was already open) until they change the PIN;
--      - wallet_pin_status says legacy = true, so the screen asks for the CURRENT 6-digit PIN and a NEW 4-digit PIN (wallet_pin_change); the current PIN is verified against
--        its hash like any PIN, with the same 5-tries / 15-minute lock;
--      - entering the old PIN on the normal unlock does not open the wallet: it answers mustChange = true;
--      - "Forgot PIN" (the e-mailed one-time code) also sets a 4-digit PIN and ends the legacy state.
--    Nothing in the verification path is weakened: one routine (private.wallet_pin_verify) counts wrong tries and applies the lock for both lengths.
--    The legacy branch can be removed once  select count(*) from public.wallet_pins where pin_length <> 4  is 0.
--  * Withdrawals and every other sensitive Wallet function keep their existing rules; the Wallet's reads still need an unlock of this sign-in session.
-- =============================================================================

alter table public.wallet_pins add column if not exists pin_length smallint not null default 6;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_pins_pin_length_check') then
    alter table public.wallet_pins add constraint wallet_pins_pin_length_check check (pin_length in (4, 6));
  end if;
end $$;

-- a new PIN: exactly 4 digits, confirmed, not trivially guessable
create or replace function private.wallet_pin_check(p_pin text, p_confirm text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4}$' then
    raise exception 'VALIDATION_ERROR: The PIN must be exactly 4 digits.' using errcode = 'P0001';
  end if;
  if p_confirm is distinct from p_pin then
    raise exception 'VALIDATION_ERROR: The two PINs do not match.' using errcode = 'P0001';
  end if;
  if p_pin ~ '^(.)\1{3}$' or p_pin in ('0123', '1234', '2345', '3456', '4567', '5678', '6789', '3210', '4321', '5432', '6543', '7654', '8765', '9876') then
    raise exception 'VALIDATION_ERROR: Choose a PIN that is harder to guess (not the same digit four times or a simple sequence).' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.wallet_pin_check(text, text) from public, anon, authenticated;

-- the one place a PIN is compared: a wrong PIN is counted (5 in a row lock the wallet for 15 minutes), for a 4-digit and a legacy 6-digit PIN alike
create or replace function private.wallet_pin_verify(p_profile uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.wallet_pins;
  me public.profiles;
begin
  select * into p from public.wallet_pins where profile_id = p_profile for update;
  if p.profile_id is null then
    raise exception 'CONFLICT: Set your Wallet PIN first.' using errcode = 'P0001';
  end if;
  if p.locked_until > now() then
    return jsonb_build_object('ok', false, 'triesLeft', 0, 'lockedUntil', p.locked_until);
  end if;
  if p_pin is not null and p_pin ~ ('^[0-9]{' || p.pin_length || '}$') and extensions.crypt(p_pin, p.pin_hash) = p.pin_hash then
    update public.wallet_pins set failed_count = 0, locked_until = null, updated_at = now() where profile_id = p_profile;
    return jsonb_build_object('ok', true, 'legacy', p.pin_length <> 4, 'triesLeft', 5);
  end if;
  update public.wallet_pins
     set failed_count = case when p.failed_count + 1 >= 5 then 0 else p.failed_count + 1 end,
         locked_until = case when p.failed_count + 1 >= 5 then now() + interval '15 minutes' end,
         updated_at = now()
   where profile_id = p_profile returning * into p;
  if p.locked_until is not null then
    select * into me from public.profiles where id = p_profile;
    perform private.write_audit('WALLET_PIN_LOCKED', 'profile', p_profile, me.department_id, me.team_id, '{}'::jsonb);
  end if;
  return jsonb_build_object('ok', false, 'triesLeft', case when p.locked_until is not null then 0 else 5 - p.failed_count end, 'lockedUntil', p.locked_until);
end $$;
revoke all on function private.wallet_pin_verify(uuid, text) from public, anon, authenticated;

-- the Wallet's own reads: the person AND an unlock of this sign-in session; a person still on a 6-digit PIN has to change it first (also in a session already open)
create or replace function private.wallet_me()
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.payout_me();
begin
  if exists (select 1 from public.wallet_pins where profile_id = me.id and pin_length <> 4) then
    raise exception 'WALLET_LOCKED: Wallet PINs are now 4 digits. Update your PIN to open your wallet.' using errcode = 'P0001';
  end if;
  if private.wallet_unlock_until(me.id) is null then
    raise exception 'WALLET_LOCKED: Enter your Wallet PIN.' using errcode = 'P0001';
  end if;
  update public.wallet_unlocks set expires_at = now() + interval '15 minutes'
   where profile_id = me.id and session_id = private.wallet_session();
  return me;
end $$;
revoke all on function private.wallet_me() from public, anon, authenticated;

create or replace function public.wallet_pin_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  p public.wallet_pins;
begin
  select * into p from public.wallet_pins where profile_id = me.id;
  return jsonb_build_object('hasPin', p.profile_id is not null,
    -- a legacy 6-digit PIN: the wallet is closed until the person changes it to 4 digits
    'legacy', coalesce(p.pin_length <> 4, false), 'pinLength', coalesce(p.pin_length, 4),
    'unlocked', coalesce(p.pin_length = 4, true) and private.wallet_unlock_until(me.id) is not null,
    'unlockExpiresAt', case when coalesce(p.pin_length = 4, true) then private.wallet_unlock_until(me.id) end,
    'lockedUntil', case when p.locked_until > now() then p.locked_until end,
    'triesLeft', case when p.profile_id is null then 5 else greatest(5 - p.failed_count, 0) end);
end $$;
revoke all on function public.wallet_pin_status() from public, anon;
grant execute on function public.wallet_pin_status() to authenticated;

create or replace function public.wallet_pin_set(p_pin text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
begin
  perform private.wallet_pin_check(p_pin, p_confirm);
  begin
    insert into public.wallet_pins (profile_id, pin_hash, pin_length) values (me.id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), 4);
  exception when unique_violation then
    raise exception 'CONFLICT: Your Wallet PIN is already set. Use Change PIN or Forgot PIN.' using errcode = 'P0001';
  end;
  perform private.write_audit('WALLET_PIN_SET', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  return jsonb_build_object('unlocked', private.wallet_pin_grant(me.id) is not null);
end $$;
revoke all on function public.wallet_pin_set(text, text) from public, anon;
grant execute on function public.wallet_pin_set(text, text) to authenticated;

-- a wrong PIN does not raise (the count must be saved). A correct LEGACY PIN proves who they are but opens nothing: mustChange = true
create or replace function public.wallet_pin_unlock(p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  r jsonb := private.wallet_pin_verify(me.id, p_pin);
begin
  if not (r ->> 'ok')::boolean then
    return jsonb_build_object('unlocked', false, 'triesLeft', r -> 'triesLeft', 'lockedUntil', r -> 'lockedUntil');
  end if;
  if (r ->> 'legacy')::boolean then
    return jsonb_build_object('unlocked', false, 'mustChange', true, 'triesLeft', 5);
  end if;
  return jsonb_build_object('unlocked', private.wallet_pin_grant(me.id) is not null, 'triesLeft', 5);
end $$;
revoke all on function public.wallet_pin_unlock(text) from public, anon;
grant execute on function public.wallet_pin_unlock(text) to authenticated;

-- change the PIN: the current one (4 digits, or the legacy 6) must be right; the new one is 4 digits. This is also how a legacy 6-digit PIN becomes a 4-digit one.
create or replace function public.wallet_pin_change(p_old text, p_new text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  r jsonb;
begin
  perform private.wallet_pin_check(p_new, p_confirm);
  r := private.wallet_pin_verify(me.id, p_old);
  if not (r ->> 'ok')::boolean then
    return jsonb_build_object('unlocked', false, 'changed', false, 'triesLeft', r -> 'triesLeft', 'lockedUntil', r -> 'lockedUntil');
  end if;
  update public.wallet_pins set pin_hash = extensions.crypt(p_new, extensions.gen_salt('bf', 10)), pin_length = 4, updated_at = now() where profile_id = me.id;
  -- other sign-ins must enter the new PIN
  delete from public.wallet_unlocks where profile_id = me.id and session_id is distinct from private.wallet_session();
  perform private.write_audit('WALLET_PIN_CHANGED', 'profile', me.id, me.department_id, me.team_id,
    jsonb_build_object('from', case when (r ->> 'legacy')::boolean then 'LEGACY_6_DIGITS' else 'FOUR_DIGITS' end));
  return jsonb_build_object('unlocked', private.wallet_pin_grant(me.id) is not null, 'changed', true, 'triesLeft', 5);
end $$;
revoke all on function public.wallet_pin_change(text, text, text) from public, anon;
grant execute on function public.wallet_pin_change(text, text, text) to authenticated;

-- Forgot PIN, step 2: the one-time code and a NEW 4-digit PIN (also ends a legacy 6-digit PIN)
create or replace function public.wallet_pin_reset_finish(p_code text, p_pin text, p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.wallet_pin_me();
  r public.wallet_pin_resets;
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
begin
  perform private.wallet_pin_check(p_pin, p_confirm);
  select * into r from public.wallet_pin_resets where profile_id = me.id for update;
  if r.profile_id is null or r.expires_at < now() or r.tries >= 5 then
    raise exception 'CONFLICT: This reset code is not valid any more. Ask for a new one.' using errcode = 'P0001';
  end if;
  if extensions.crypt(v_code, r.code_hash) <> r.code_hash then
    update public.wallet_pin_resets set tries = tries + 1 where profile_id = me.id;
    return jsonb_build_object('reset', false, 'triesLeft', greatest(5 - r.tries - 1, 0));
  end if;
  delete from public.wallet_pin_resets where profile_id = me.id;
  update public.wallet_pins set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), pin_length = 4, failed_count = 0, locked_until = null, updated_at = now()
   where profile_id = me.id;
  delete from public.wallet_unlocks where profile_id = me.id;
  perform private.write_audit('WALLET_PIN_RESET', 'profile', me.id, me.department_id, me.team_id, '{}'::jsonb);
  return jsonb_build_object('reset', true, 'unlocked', private.wallet_pin_grant(me.id) is not null);
end $$;
revoke all on function public.wallet_pin_reset_finish(text, text, text) from public, anon;
grant execute on function public.wallet_pin_reset_finish(text, text, text) to authenticated;
notify pgrst, 'reload schema';
