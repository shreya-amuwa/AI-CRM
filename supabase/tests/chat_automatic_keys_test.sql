-- =============================================================================
-- Chat, migration 20261214000100: secure messaging keys that are made and published automatically (no passphrase, no backup), and a new key
-- made on a device without the old one. The real cryptography is tested in the browser code (chat_secure_client.test.ts); here the database rules are.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Chat: automatic keys'
reset role;
\i supabase/migrations/20261215000100_chat_automatic_keys.sql
create function pg_temp.pub(p_name text) returns text language sql immutable as $$
  select translate(encode('\x04'::bytea || decode(repeat(md5(p_name), 4), 'hex'), 'base64'), E'\n', '')
$$;
grant execute on function pg_temp.pub(text) to authenticated, anon;
create function pg_temp.backup() returns jsonb language sql immutable as $$
  select jsonb_build_object('v', 1, 'kdf', 'PBKDF2-SHA256', 'iter', 600000, 'salt', 'AAAAAAAAAAAAAAAAAAAAAA==', 'iv', 'AAAAAAAAAAAAAAAA', 'ct', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
$$;
grant execute on function pg_temp.backup() to authenticated;

delete from auth.users where email like 'ck.%@example.com';
delete from test.users where name like 'ck\_%';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.create_auth_user('ck_a', 'ck.a@example.com', '{"full_name":"CK A"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('ck_b', 'ck.b@example.com', '{"full_name":"CK B"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
grant execute on all functions in schema test to anon, authenticated;

-- ---------------------------------------------------------------- the first key, with no passphrase
set role authenticated;
select test.login('ck_a');
select test.check((chat_key_status() ->> 'hasKey')::boolean = false and (chat_key_status() -> 'backupVersion') = 'null'::jsonb, 'a person with no key: no key, no backup');
select test.must_fail($$select chat_key_register('short')$$, 'a public key of the wrong length is refused', 'not valid');
select test.must_fail($$select chat_key_register(translate(encode('\x05'::bytea || decode(repeat(md5('x'), 4), 'hex'), 'base64'), E'\n', ''))$$, 'so is one that is not an uncompressed P-256 point', 'not valid');
select test.check((chat_key_register(pg_temp.pub('ck_a')) ->> 'version')::int = 1 and (chat_key_register(pg_temp.pub('ck_a')) ->> 'created')::boolean = false, 'the first registration makes version 1; the same key again changes nothing (a retry, a second tab)');
select test.check((chat_key_status() ->> 'hasKey')::boolean and chat_key_status() ->> 'publicKey' = pg_temp.pub('ck_a') and not (chat_key_status() ->> 'hasBackup')::boolean, 'status shows the key and that there is no backup');
select test.check(chat_key_status() ->> 'fingerprint' = encode(sha256(decode(pg_temp.pub('ck_a'), 'base64')), 'hex'), 'the fingerprint is computed by the database from the public key');
select test.must_fail($$select chat_key_register(pg_temp.pub('ck_a_other_device'))$$, 'a different key is refused: another browser never replaces the key of the account', 'already set up');
select test.must_fail($$select chat_key_setup(pg_temp.pub('ck_a_other_device'), pg_temp.backup())$$, 'and neither does the older passphrase set-up', 'already set up');
select test.check((chat_key_status() ->> 'publicKey') = pg_temp.pub('ck_a'), 'the key of the account is the first one');
select test.must_fail($$select * from chat_user_keys$$, 'the key table cannot be read directly', 'permission denied');
reset role;
select test.check((select count(*) = 1 from chat_user_keys where profile_id = test.id('ck_a')), 'one row exists after three calls');
select test.check((select count(*) = 1 from audit_logs where action = 'CHAT_KEY_REGISTERED' and entity_id = test.id('ck_a') and (metadata ->> 'automatic')::boolean), 'the registration is audited once (version and fingerprint only)');
select test.check((select count(*) = 0 from chat_key_backups where profile_id = test.id('ck_a')), 'no backup was made');

-- ---------------------------------------------------------------- a new key on a device without the old one (explicit)
set role authenticated;
select test.login('ck_a');
select test.must_fail($$select chat_key_rotate('short')$$, 'a new key must be a valid public key', 'not valid');
select test.check((chat_key_rotate(pg_temp.pub('ck_a_device2')) ->> 'version')::int = 2, 'a new key is published as version 2');
select test.check((chat_key_rotate(pg_temp.pub('ck_a_device2')) ->> 'created')::boolean = false, 'the same new key again changes nothing');
reset role;
select test.check((select retired_at is not null from chat_user_keys where profile_id = test.id('ck_a') and key_version = 1) and (select retired_at is null from chat_user_keys where profile_id = test.id('ck_a') and key_version = 2), 'the old key is retired and the new one is active');
select test.check((select count(*) = 1 from chat_user_keys where profile_id = test.id('ck_a') and retired_at is null), 'one active key');
select test.check((select count(*) = 1 from audit_logs where action = 'CHAT_KEYS_RESET' and entity_id = test.id('ck_a') and not (metadata ->> 'passphrase')::boolean), 'the new key is audited once');
set role authenticated;
select test.login('ck_b');
select test.check((chat_key_lookup(test.id('ck_a'), 1) ->> 'retired')::boolean and (chat_key_lookup(test.id('ck_a'), 2) ->> 'publicKey') = pg_temp.pub('ck_a_device2'), 'colleagues can look up both versions (to read old messages and to see the key changed)');

-- ---------------------------------------------------------------- an older account with a passphrase backup
select test.check((chat_key_setup(pg_temp.pub('ck_b'), pg_temp.backup()) ->> 'version')::int = 1, 'an account that chose a passphrase still works as before');
select test.check((chat_key_status() ->> 'hasBackup')::boolean and (chat_key_status() ->> 'backupVersion')::int = 1, 'its status says the backup belongs to version 1');
select chat_key_rotate(pg_temp.pub('ck_b_new'));
select test.check((chat_key_status() ->> 'version')::int = 2 and (chat_key_status() ->> 'backupVersion')::int = 1 and (chat_key_status() ->> 'hasBackup')::boolean, 'after a new key without the passphrase the backup is still there and says it belongs to version 1 (the app does not offer it as a way in)');
select test.check((chat_key_backup_get() is not null), 'the older backup is not deleted');

-- ---------------------------------------------------------------- nobody else, nobody signed out
reset role;
set role anon;
select test.must_fail($$select chat_key_register(pg_temp.pub('anon'))$$, 'a signed-out caller cannot register a key', 'permission denied');
select test.must_fail($$select chat_key_rotate(pg_temp.pub('anon'))$$, 'nor make a new one', 'permission denied');
reset role;
\echo '   chat automatic keys: all checks passed'
