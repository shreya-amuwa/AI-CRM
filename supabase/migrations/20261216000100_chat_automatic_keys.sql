-- =============================================================================
-- Secure messaging for employees switches on by itself.
--
-- Until now the first use of internal chat needed a recovery passphrase ("Turn on secure messaging"). The browser now makes the person's key on its
-- own (a non-extractable key kept in IndexedDB) and publishes ONLY the public half. Nothing about the encryption changes: messages are still
-- sealed in the browser for each member's public key and the server holds ciphertext only.
--
--   chat_key_register(p_public)  first key, no passphrase, no backup. Safe to repeat: the same public key returns the key already registered;
--                                a DIFFERENT key is refused (an existing key is never overwritten by a login on another browser).
--   chat_key_rotate(p_public)    a new key on THIS device when the person chose to continue here without the old one (a new device, no backup):
--                                an explicit action. The old key is retired (colleagues are asked to accept the new one) and any older
--                                recovery backup is left as it is.
--   chat_key_status()            also reports the version the stored backup belongs to, so a backup of an older key is not offered as a way in.
--
-- Nothing is deleted. Existing keys, backups and messages are untouched. Safe to run again. Run it BEFORE the new app version is deployed
-- (until then the app falls back to the passphrase set-up).
-- =============================================================================

create or replace function public.chat_key_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  k public.chat_user_keys;
  b public.chat_key_backups;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into k from public.chat_user_keys where profile_id = me and retired_at is null;
  select * into b from public.chat_key_backups where profile_id = me;
  return jsonb_build_object('hasKey', k.profile_id is not null, 'version', k.key_version, 'publicKey', k.public_key, 'fingerprint', k.fingerprint,
                            'hasBackup', b.profile_id is not null, 'backupVersion', b.key_version);
end $$;
revoke all on function public.chat_key_status() from public, anon;
grant execute on function public.chat_key_status() to authenticated;

create or replace function public.chat_key_register(p_public text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  k public.chat_user_keys;
  v_ver integer;
  v_fp text;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_public_key_ok(p_public) then
    raise exception 'VALIDATION_ERROR: The key is not valid.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = me for update;   -- one registration at a time (two tabs, a retry)
  select * into k from public.chat_user_keys where profile_id = me and retired_at is null;
  if k.profile_id is not null then
    if k.public_key = p_public then
      return jsonb_build_object('version', k.key_version, 'fingerprint', k.fingerprint, 'created', false);
    end if;
    raise exception 'CONFLICT: Secure messaging is already set up for this account on another device.' using errcode = 'P0001';
  end if;
  select coalesce(max(key_version), 0) + 1 into v_ver from public.chat_user_keys where profile_id = me;
  v_fp := encode(sha256(decode(p_public, 'base64')), 'hex');
  insert into public.chat_user_keys (profile_id, key_version, public_key, fingerprint) values (me, v_ver, p_public, v_fp);
  perform private.write_audit('CHAT_KEY_REGISTERED', 'profile', me, null, null, jsonb_build_object('version', v_ver, 'fingerprint', v_fp, 'automatic', true));
  return jsonb_build_object('version', v_ver, 'fingerprint', v_fp, 'created', true);
end $$;
revoke all on function public.chat_key_register(text) from public, anon;
grant execute on function public.chat_key_register(text) to authenticated;

create or replace function public.chat_key_rotate(p_public text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  k public.chat_user_keys;
  v_ver integer;
  v_fp text;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_public_key_ok(p_public) then
    raise exception 'VALIDATION_ERROR: The key is not valid.' using errcode = 'P0001';
  end if;
  perform 1 from public.profiles where id = me for update;
  select * into k from public.chat_user_keys where profile_id = me and retired_at is null;
  -- the same key again (a retry after a dropped answer): nothing to do
  if k.profile_id is not null and k.public_key = p_public then
    return jsonb_build_object('version', k.key_version, 'fingerprint', k.fingerprint, 'created', false);
  end if;
  update public.chat_user_keys set retired_at = now() where profile_id = me and retired_at is null;
  select coalesce(max(key_version), 0) + 1 into v_ver from public.chat_user_keys where profile_id = me;
  v_fp := encode(sha256(decode(p_public, 'base64')), 'hex');
  insert into public.chat_user_keys (profile_id, key_version, public_key, fingerprint) values (me, v_ver, p_public, v_fp);
  perform private.write_audit('CHAT_KEYS_RESET', 'profile', me, null, null, jsonb_build_object('version', v_ver, 'fingerprint', v_fp, 'passphrase', false));
  return jsonb_build_object('version', v_ver, 'fingerprint', v_fp, 'created', true);
end $$;
revoke all on function public.chat_key_rotate(text) from public, anon;
grant execute on function public.chat_key_rotate(text) to authenticated;
