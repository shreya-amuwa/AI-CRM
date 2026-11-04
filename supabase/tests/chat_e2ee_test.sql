-- =============================================================================
-- Chat, migration 20261206000300: end-to-end encryption of the internal chats (the server stores envelopes and public keys only) and
-- WhatsApp-style deletion (delete for me / delete for everyone). Runs after the other suites on the same database.
-- The real cryptography is tested in the browser code (chat_e2ee.test.ts / chat_secure_client.test.ts); here the database rules are.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Chat: encryption keys, encrypted messages, deleting messages'
-- These checks are for the end-to-end encrypted mode, which stays available (chat_set_internal_mode). The company-readable mode of
-- migration 20261224000200 is checked in chat_company_readable_test.sql.
reset role;
do $$ begin if to_regclass('public.chat_settings') is not null then update public.chat_settings set internal_mode = 'E2EE'; end if; end $$;

reset role;
create function pg_temp.pub(p_name text) returns text language sql immutable as $$
  select translate(encode('\x04'::bytea || decode(repeat(md5(p_name), 4), 'hex'), 'base64'), E'\n', '')
$$;
grant execute on function pg_temp.pub(text) to authenticated;
create function pg_temp.backup() returns jsonb language sql immutable as $$
  select jsonb_build_object('v', 1, 'kdf', 'PBKDF2-SHA256', 'iter', 600000, 'salt', 'AAAAAAAAAAAAAAAAAAAAAA==', 'iv', 'AAAAAAAAAAAAAAAA', 'ct', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
$$;
grant execute on function pg_temp.backup() to authenticated;
create function pg_temp.env(p_conv uuid, p_secret text default 'opaque') returns jsonb language sql stable security definer as $$
  select jsonb_build_object('v', 1, 'sv', (select k.key_version from public.chat_user_keys k where k.profile_id = auth.uid() and k.retired_at is null),
    'iv', 'AAAAAAAAAAAAAAAA', 'ct', translate(encode(convert_to('SECRET-CIPHERTEXT ' || p_secret || gen_random_uuid(), 'UTF8'), 'base64'), E'\n', ''),
    'wraps', (select jsonb_agg(jsonb_build_object('to', m.profile_id, 'kv', k.key_version, 'enc', k.public_key, 'w', 'WRAP' || left(m.profile_id::text, 12) || 'AAAAAAAAAAAAAAAA')
                               order by m.profile_id::text collate "C")
                from public.chat_members m join public.chat_user_keys k on k.profile_id = m.profile_id and k.retired_at is null
               where m.conversation_id = p_conv and m.left_at is null))
$$;
grant execute on function pg_temp.env(uuid, text) to authenticated;
create temp table ce (k text primary key, v text);
grant all on ce to authenticated;
create function pg_temp.g(p_k text) returns text language sql stable as $$ select v from ce where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated;
create function pg_temp.send(p_conv uuid, p_atts uuid[] default '{}', p_reply uuid default null) returns jsonb language sql as $$
  select public.chat_send_encrypted(p_conv, gen_random_uuid(), pg_temp.env(p_conv), p_reply, p_atts)
$$;
grant execute on function pg_temp.send(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------- keys
set role authenticated;
select test.login('hr_head');
select test.check((select (chat_key_status() ->> 'hasKey')::boolean = false and (chat_key_status() ->> 'hasBackup')::boolean = false), 'a person who never set up has no key');
select test.must_fail($$select chat_key_setup('short', pg_temp.backup())$$, 'a public key of the wrong length is refused', 'not valid');
select test.must_fail($$select chat_key_setup(translate(encode('\x05'::bytea || decode(repeat(md5('x'), 4), 'hex'), 'base64'), E'\n', ''), pg_temp.backup())$$, 'so is one that is not an uncompressed P-256 point', 'not valid');
select test.must_fail($$select chat_key_setup(pg_temp.pub('hr_head'), '{"v":1}'::jsonb)$$, 'a backup without its parts is refused', 'not valid');
select test.must_fail($$select chat_key_setup(pg_temp.pub('hr_head'), jsonb_build_object('v', 1, 'salt', 'a', 'iv', 'b', 'ct', repeat('A', 70000), 'iter', 600000))$$, 'and one that is far too large', 'not valid');
select test.check((select (chat_key_setup(pg_temp.pub('hr_head'), pg_temp.backup()) ->> 'version')::int = 1), 'the first setup publishes version 1');
select test.check((select (chat_key_status() ->> 'hasKey')::boolean and chat_key_status() ->> 'publicKey' = pg_temp.pub('hr_head') and chat_key_status() ->> 'fingerprint' ~ '^[0-9a-f]{64}$' and (chat_key_status() ->> 'hasBackup')::boolean), 'status shows the key, its fingerprint and that a backup exists');
select test.check((select chat_key_status() ->> 'fingerprint' = encode(sha256(decode(pg_temp.pub('hr_head'), 'base64')), 'hex')), 'the fingerprint is computed by the database from the public key (not taken from the caller)');
select test.must_fail($$select chat_key_setup(pg_temp.pub('hr_head2'), pg_temp.backup())$$, 'a second setup is refused (it would replace the key silently)', 'already set up');
select test.check((select chat_key_backup_get() -> 'blob' ->> 'kdf' = 'PBKDF2-SHA256' and (chat_key_backup_get() ->> 'version')::int = 1), 'the person can fetch their own backup (it is opaque to the database)');
select test.must_fail($$select chat_key_backup_set(pg_temp.backup(), 7)$$, 'a backup can only be replaced for the current key version', 'key changed');
select chat_key_backup_set(pg_temp.backup(), 1);
select test.check((select chat_key_lookup(test.id('hr_head'), 1) ->> 'publicKey' = pg_temp.pub('hr_head')), 'anybody who may chat can look up a public key');
select test.check((select chat_key_lookup(test.id('hr_head'), 99) is null), 'an unknown version gives nothing');
select test.must_fail($$select * from chat_user_keys$$, 'the key table cannot be read directly', 'permission denied');
select test.must_fail($$select * from chat_key_backups$$, 'nor the backups', 'permission denied');
select test.must_fail($$insert into chat_user_keys (profile_id, key_version, public_key, fingerprint) values (gen_random_uuid(), 1, repeat('A', 88), repeat('a', 64))$$, 'nor written directly', 'permission denied');
select test.login('tm_a');
select test.check((select chat_key_backup_get() is null), 'another person gets no backup (only their own)');
select test.check((select chat_key_setup(pg_temp.pub('tm_a'), pg_temp.backup()) ->> 'version' = '1'), 'and sets up their own key');

-- ---------------------------------------------------------------- encrypted messages
select test.login('hr_head');
create temp table dm2 as select chat_open_direct(test.id('tm_a')) as j;
grant all on dm2 to authenticated;
insert into ce select 'dm', (select j ->> 'id' from dm2);
create temp table grp2 as select chat_create_group('Encrypted huddle', array[test.id('tm_a'), test.id('sup_b'), test.id('tm_d1')]) as j;
grant all on grp2 to authenticated;
insert into ce select 'grp', (select j ->> 'id' from grp2);
select test.check((select (chat_member_keys(pg_temp.g('dm')::uuid) -> 0 ->> 'publicKey') is not null and jsonb_array_length(chat_member_keys(pg_temp.g('dm')::uuid)) = 2), 'a member sees the public keys of the people in a conversation');
select test.must_fail($$select pg_temp.send(pg_temp.g('grp')::uuid)$$, 'a message cannot be sent while a member has not set up secure messaging', 'KEYS_MISSING.*(Team Member|has not set up)');
select test.login('tm_d1');
select chat_key_setup(pg_temp.pub('tm_d1'), pg_temp.backup());
select test.login('hr_head');
create temp table e1 as select pg_temp.send(pg_temp.g('dm')::uuid) as j;
grant all on e1 to authenticated;
select test.check((select (j ->> 'encrypted')::boolean and j ->> 'body' = '' and (j ->> 'mine')::boolean and j -> 'e2ee' -> 'wrap' ->> 'to' = test.id('hr_head')::text and j ->> 'senderId' = test.id('hr_head')::text from e1), 'an encrypted message is stored: no body, the sender sees their own key wrap');
select test.check((select (j -> 'e2ee' ? 'wraps') = false from e1), 'and the message JSON carries only the viewer''s own wrap, not everybody''s');
select test.check((select last_message_preview = 'Encrypted message' from chat_conversations where id = pg_temp.g('dm')::uuid), 'the conversation preview never shows content');
-- idempotent: the same client message id returns the stored message
create temp table cid as select gen_random_uuid() as id;
grant all on cid to authenticated;
create temp table e2 as select chat_send_encrypted(pg_temp.g('dm')::uuid, (select id from cid), pg_temp.env(pg_temp.g('dm')::uuid), null, '{}') as j;
grant all on e2 to authenticated;
select test.check((select chat_send_encrypted(pg_temp.g('dm')::uuid, (select id from cid), pg_temp.env(pg_temp.g('dm')::uuid), null, '{}') ->> 'id' = (select j ->> 'id' from e2)), 'a retry with the same message id returns the stored message');
select test.check((select count(*) = 1 from chat_messages where client_msg_id = (select id from cid)), 'and stores it once');
-- shape checks
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), '{"v":2}'::jsonb)$$, 'an envelope of an unknown version is refused', 'could not be encrypted');
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), null)$$, 'so is no envelope', 'could not be encrypted');
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), pg_temp.env(pg_temp.g('dm')::uuid) - 'wraps' || '{"wraps":[]}'::jsonb)$$, 'an envelope sealed for nobody is refused', 'KEYS_CHANGED');
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), jsonb_set(pg_temp.env(pg_temp.g('dm')::uuid), '{wraps}', (pg_temp.env(pg_temp.g('dm')::uuid) -> 'wraps') - 0))$$, 'one that leaves a member out is refused (nobody can be silently dropped)', 'KEYS_CHANGED');
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), jsonb_set(pg_temp.env(pg_temp.g('dm')::uuid), '{sv}', '9'))$$, 'one made with a key version that is not the sender''s current one is refused', 'KEYS_CHANGED');
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), jsonb_set(pg_temp.env(pg_temp.g('dm')::uuid), '{wraps,0,kv}', '9'))$$, 'and one sealed for an old key of a member', 'KEYS_CHANGED');
select test.must_fail($$select chat_send_message(pg_temp.g('dm')::uuid, 'plain', gen_random_uuid())$$, 'a readable message cannot be stored in a direct chat', 'end-to-end encrypted');
reset role;
select test.must_fail($$insert into chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, body) values (pg_temp.g('dm')::uuid, 9999, test.id('hr_head'), 'STAFF', 'x', 'plain')$$, 'not even a direct insert by the database owner (the trigger is on the table)', 'end-to-end encrypted');
select test.check((select count(*) = 0 from chat_messages where conversation_id in (pg_temp.g('dm')::uuid, pg_temp.g('grp')::uuid) and encrypted = false and kind = 'TEXT'), 'no readable message exists in the new internal conversations');
select test.check((select bool_and(body = '' and e2ee is not null) from chat_messages where conversation_id = pg_temp.g('dm')::uuid and kind = 'TEXT' and encrypted), 'every stored message body is empty; only the envelope is stored');

set role authenticated;
select test.login('tm_a');
select test.check((select j ->> 'body' = '' and (j -> 'e2ee' -> 'wrap' ->> 'to') = test.id('tm_a')::text and j -> 'e2ee' -> 'wrap' ->> 'w' like 'WRAP' || left(test.id('tm_a')::text, 12) || '%' from (select chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages' -> 0 as j) x), 'the other member receives the envelope with THEIR wrap');
select test.check((select count(*) = 2 from chat_messages where conversation_id = pg_temp.g('dm')::uuid), 'and row level security shows members the rows');
select test.login('sup_th');
select test.check((select count(*) = 0 from chat_messages where conversation_id = pg_temp.g('dm')::uuid) and (select count(*) = 0 from chat_conversations where id = pg_temp.g('dm')::uuid), 'a non-member sees no envelope at all (row level security, which Realtime also applies)');
select test.must_fail($$select chat_messages_page(pg_temp.g('dm')::uuid)$$, 'nor through the API', 'not found');
select test.must_fail($$select chat_member_keys(pg_temp.g('dm')::uuid)$$, 'nor the members'' keys', 'not found');
select test.login('sa');
select test.must_fail($$select chat_messages_page(pg_temp.g('dm')::uuid)$$, 'the Super Admin has no access to these messages through the application either', 'not found');
select test.check((select count(*) = 0 from chat_messages where conversation_id = pg_temp.g('dm')::uuid), 'and row level security gives the Super Admin nothing');

-- ---------------------------------------------------------------- Delete for me
select test.login('hr_head');
create temp table e3 as select pg_temp.send(pg_temp.g('dm')::uuid) as j;
grant all on e3 to authenticated;
select test.login('tm_a');
create temp table n0 as select jsonb_array_length(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') as n;
grant all on n0 to authenticated;
select test.check((select n >= 3 from n0), 'before deleting: the other member sees the messages');
select test.check((select (chat_conversation_detail(pg_temp.g('dm')::uuid) ->> 'unread')::int >= 1), 'and has unread messages');
select test.check((select (chat_delete_for_me((select (j ->> 'id')::uuid from e3)) ->> 'hidden')::boolean), 'delete for me hides the message for this person');
select test.check((select chat_delete_for_me((select (j ->> 'id')::uuid from e3)) ->> 'hidden' = 'true'), 'doing it twice changes nothing');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') = (select n - 1 from n0) and not exists (select 1 from jsonb_array_elements(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') x where x ->> 'id' = (select j ->> 'id' from e3))), 'it is gone from their history (a refresh, a new login or another device ask the same database)');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('dm')::uuid, null, 0, 50) -> 'messages') = (select n - 1 from n0)), 'and from "everything after" (what a reconnecting screen asks)');
select test.login('hr_head');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') = (select n from n0) and exists (select 1 from jsonb_array_elements(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') x where x ->> 'id' = (select j ->> 'id' from e3))), 'the sender and everybody else still see it: delete for me never deletes for others');
select test.check((select e2ee is not null and deleted_at is null from chat_messages where id = (select (j ->> 'id')::uuid from e3)), 'the shared message itself is untouched');
select test.login('sup_th');
select test.must_fail($$select chat_delete_for_me((select (j ->> 'id')::uuid from e3))$$, 'a person outside the conversation cannot delete anything in it', 'not found');
select test.must_fail($$select chat_delete_for_everyone((select (j ->> 'id')::uuid from e3))$$, 'nor for everyone', 'not found');
select test.must_fail($$select * from chat_message_hidden$$, 'the per-person deletion state cannot be read directly', 'permission denied');
select test.must_fail($$insert into chat_message_hidden (message_id, profile_id, conversation_id) values (gen_random_uuid(), test.id('sup_th'), gen_random_uuid())$$, 'nor written directly', 'permission denied');

-- ---------------------------------------------------------------- Delete for everyone
select test.login('hr_head');
create temp table e5 as select pg_temp.send(pg_temp.g('dm')::uuid) as j;
grant all on e5 to authenticated;
select test.login('tm_a');
create temp table e5r as select pg_temp.send(pg_temp.g('dm')::uuid, '{}', (select (j ->> 'id')::uuid from e5)) as j;
grant all on e5r to authenticated;
select test.must_fail($$select chat_delete_for_everyone((select (j ->> 'id')::uuid from e5))$$, 'a member cannot delete somebody else''s message for everyone', 'only the messages you sent');
select test.check((select deleted_at is null and e2ee is not null from chat_messages where id = (select (j ->> 'id')::uuid from e5)), 'and nothing happened to it');
select test.login('hr_head');
select test.check((select (r ->> 'deleted')::boolean and r -> 'files' = '[]'::jsonb from (select chat_delete_for_everyone((select (j ->> 'id')::uuid from e5)) as r) x), 'the sender deletes it for everyone');
select test.check((select body = '' and e2ee is null and attachments = '[]'::jsonb and deleted_at is not null and deleted_by = test.id('hr_head') from chat_messages where id = (select (j ->> 'id')::uuid from e5)), 'the database wiped the text, the ciphertext, the key wraps and the file list (a tombstone is left)');
select test.check((select (chat_delete_for_everyone((select (j ->> 'id')::uuid from e5)) ->> 'deleted')::boolean), 'deleting again is harmless');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'CHAT_MESSAGE_DELETED_FOR_ALL' and entity_id = (select (j ->> 'id')::uuid from e5) and actor_id = test.id('hr_head') and not (metadata::text ilike '%SECRET%')), 'it is written to the audit log (ids and counts only, never content), once');
set role authenticated;
select test.login('hr_head');
select test.login('tm_a');
select test.check((select x ->> 'deleted' = 'true' and x ->> 'body' = '' and x -> 'e2ee' = 'null'::jsonb and x -> 'attachments' = '[]'::jsonb
                     from (select m as x from jsonb_array_elements(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') m where m ->> 'id' = (select j ->> 'id' from e5)) y), 'the other member gets a tombstone with nothing in it, through the normal API');
select test.check((select (x -> 'replyTo' ->> 'deleted')::boolean and x -> 'replyTo' ->> 'body' = '' from (select m as x from jsonb_array_elements(chat_messages_page(pg_temp.g('dm')::uuid) -> 'messages') m where m ->> 'id' = (select j ->> 'id' from e5r)) y), 'a reply to a deleted message shows that it was deleted');
select test.check((select count(*) = 1 from chat_messages where id = (select (j ->> 'id')::uuid from e5) and e2ee is null and body = ''), 'row level security (what Realtime delivers) shows the tombstone with no content');
select test.check((select chat_messages_page(pg_temp.g('dm')::uuid, null, (select (j ->> 'seq')::bigint from e5r), 50) -> 'deletedIds' @> to_jsonb(array[(select j ->> 'id' from e5)])), 'a screen that missed the live event learns which messages were deleted (deletedIds)');

-- the preview, the unread count
select test.login('hr_head');
create temp table e7 as select pg_temp.send(pg_temp.g('dm')::uuid) as j;
grant all on e7 to authenticated;
select test.check((select last_message_preview = 'Encrypted message' from chat_conversations where id = pg_temp.g('dm')::uuid), 'the last message is the new one');
select test.login('tm_a');
create temp table u1 as select (chat_conversation_detail(pg_temp.g('dm')::uuid) ->> 'unread')::int as n;
grant all on u1 to authenticated;
select test.login('hr_head');
select chat_delete_for_everyone((select (j ->> 'id')::uuid from e7));
select test.check((select last_message_preview = 'This message was deleted' from chat_conversations where id = pg_temp.g('dm')::uuid), 'when the LAST message is deleted the list preview says so');
select test.login('tm_a');
select test.check((select (chat_conversation_detail(pg_temp.g('dm')::uuid) ->> 'unread')::int = (select n - 1 from u1)), 'a deleted message is no longer counted as unread');

-- ---------------------------------------------------------------- files of a deleted message
select test.login('hr_head');
create temp table up2 as select to_jsonb(chat_begin_upload(pg_temp.g('grp')::uuid, 'file.enc', 'application/x-amuwa-e2ee', 4096)) as j;
grant all on up2 to authenticated;
select chat_complete_upload((select (j ->> 'id')::uuid from up2), 4096);
create temp table e8 as select pg_temp.send(pg_temp.g('grp')::uuid, array[(select (j ->> 'id')::uuid from up2)]) as j;
grant all on e8 to authenticated;
select test.login('sup_b');
select test.check((select (chat_attachment_download((select (j ->> 'id')::uuid from up2))).id is not null), 'a member can download the encrypted file while the message exists');
select test.login('hr_head');
create temp table del8 as select chat_delete_for_everyone((select (j ->> 'id')::uuid from e8)) as j;
grant all on del8 to authenticated;
select test.check((select jsonb_array_length(j -> 'files') = 1 and j -> 'files' -> 0 ->> 'path' like '%/file.enc' from del8), 'deleting for everyone returns the stored file the API must remove');
reset role;
select test.check((select status = 'DELETED' and deleted_at is not null and storage_removed_at is null from chat_attachments where id = (select (j ->> 'id')::uuid from up2)), 'the file is marked DELETED (removal from storage still to be confirmed)');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select chat_attachment_download((select (j ->> 'id')::uuid from up2))$$, 'nobody can download it any more, not even the sender', 'not found');
select test.login('sup_b');
select test.must_fail($$select chat_attachment_download((select (j ->> 'id')::uuid from up2))$$, 'nor another member', 'not found');
select chat_attachments_removed(array[(select (j ->> 'id')::uuid from up2)]);
reset role;
select test.check((select storage_removed_at is null from chat_attachments where id = (select (j ->> 'id')::uuid from up2)), 'somebody else cannot mark the file as removed');
set role authenticated;
select test.login('hr_head');
select test.check((select jsonb_array_length(chat_delete_for_everyone((select (j ->> 'id')::uuid from e8)) -> 'files') = 1), 'deleting again returns the file again while its removal is not confirmed (a retry after a storage failure)');
select chat_attachments_removed(array[(select (j ->> 'id')::uuid from up2)]);
select test.check((select jsonb_array_length(chat_delete_for_everyone((select (j ->> 'id')::uuid from e8)) -> 'files') = 0), 'and nothing is left to remove once the sender''s confirmation is recorded');
reset role;
select test.check((select storage_removed_at is not null from chat_attachments where id = (select (j ->> 'id')::uuid from up2)), 'the removal is recorded');

-- ---------------------------------------------------------------- a reset retires the old key
set role authenticated;
select test.login('tm_a');
select test.check((select (chat_key_reset(pg_temp.pub('tm_a_new'), pg_temp.backup()) ->> 'version')::int = 2), 'a reset publishes version 2');
select test.check((select (chat_key_lookup(test.id('tm_a'), 1) ->> 'retired')::boolean and not (chat_key_lookup(test.id('tm_a'), 2) ->> 'retired')::boolean), 'the old key is retired but still known (to verify old messages)');
select test.check((select chat_key_status() ->> 'publicKey' = pg_temp.pub('tm_a_new')), 'the status shows the new key');
select test.login('hr_head');
-- an envelope built before the reset is refused, one built after it is accepted
create temp table stale as select pg_temp.env(pg_temp.g('dm')::uuid) as j;
grant all on stale to authenticated;
select test.check((select pg_temp.send(pg_temp.g('dm')::uuid) is not null), 'a message sealed for the new key is accepted');
select test.must_fail($$select chat_send_encrypted(pg_temp.g('dm')::uuid, gen_random_uuid(), jsonb_set((select j from stale), '{wraps}', (select jsonb_agg(case when w ->> 'to' = test.id('tm_a')::text then jsonb_set(w, '{kv}', '1') else w end) from jsonb_array_elements((select j -> 'wraps' from stale)) w)))$$, 'one still sealed for the retired key is refused', 'KEYS_CHANGED');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'CHAT_KEYS_RESET' and actor_id = test.id('tm_a')) and (select count(*) >= 1 from audit_logs where action = 'CHAT_KEY_REGISTERED'), 'key registrations and resets are audited (fingerprints only)');
select test.check((select count(*) = 0 from audit_logs where action like 'CHAT\_%' and (metadata::text ~* '(secret|passphrase|private)')), 'the audit log holds no secret');
select test.check((select not has_function_privilege('anon', p.oid, 'execute') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'chat_send_encrypted'), 'signed-out visitors cannot send');
select test.check((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'chat\_key%' or p.proname like 'chat\_delete%' or p.proname = 'chat_send_encrypted' or p.proname = 'chat_member_keys') and (p.prosecdef is false or has_function_privilege('anon', p.oid, 'execute'))), 'every new function is security definer and closed to signed-out visitors');
select test.check((select bool_and(relrowsecurity) from pg_class where relname in ('chat_message_hidden', 'chat_user_keys', 'chat_key_backups')), 'row level security is on for the new tables (and they have no policy: functions only)');
\echo '=== ALL CHAT ENCRYPTION AND DELETION TESTS PASSED ==='
