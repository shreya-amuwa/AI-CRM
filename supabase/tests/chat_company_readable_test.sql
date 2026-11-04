-- =============================================================================
-- Internal chat in the company-readable mode (migration 20261224000200): no key, no passphrase, the same access rules.
-- Reuses the staff of rls_test.sql / chat_test.sql (sup_plain, sup_b, sup_th, dh_wab, tm_a) and one new employee who never had a key.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 125. Chat: direct and group messages without key set-up (company-readable mode)'
reset role;
\i supabase/migrations/20261224000200_chat_company_readable.sql
-- a fresh installation starts in the company-readable mode
delete from public.chat_settings;
\i supabase/migrations/20261224000200_chat_company_readable.sql
select test.check((select internal_mode = 'STANDARD' from public.chat_settings), 'the migration starts the company-readable mode');
\i supabase/migrations/20261224000200_chat_company_readable.sql
select test.check((select count(*) = 1 from public.chat_settings), 're-running it keeps the one setting');

delete from auth.users where email = 'cr.new@example.com';
delete from test.users where name = 'cr_new';
select test.create_auth_user('cr_new', 'cr.new@example.com', '{"full_name":"CR New Starter"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select team_id from profiles where id = test.id('sup_plain'))));
select test.check(not exists (select 1 from chat_user_keys where profile_id = test.id('cr_new')), 'the new employee has no secure-messaging key at all');
create temp table crx (k text primary key, v text);
grant all on crx to authenticated;

set role authenticated;
\echo '   the mode'
select test.login('cr_new');
select test.check((chat_internal_mode() ->> 'mode') = 'STANDARD', 'any signed-in employee can read the mode');
select test.must_fail($$select chat_set_internal_mode('E2EE')$$, 'only the Super Admin changes it', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select chat_set_internal_mode('E2EE')$$, 'not a Department Head either', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select chat_set_internal_mode('OPEN')$$, 'only the two modes', 'Choose STANDARD or E2EE');

\echo '   a new employee sends a direct message at once'
select test.login('cr_new');
insert into crx select 'dm', chat_open_direct(test.id('sup_b')) ->> 'id';
select test.check((select (chat_send_message((select v from crx where k = 'dm')::uuid, 'Hello, first day here', gen_random_uuid()) ->> 'encrypted')::boolean = false),
  'sent without any key, passphrase or set-up');
select test.check((select chat_messages_page((select v from crx where k = 'dm')::uuid) -> 'messages' -> 0 ->> 'body') = 'Hello, first day here', 'and readable in the history');
select test.login('sup_b');
select test.check((select chat_messages_page((select v from crx where k = 'dm')::uuid) -> 'messages' -> 0 ->> 'body') = 'Hello, first day here', 'the colleague reads it');
select test.check((select (chat_send_message((select v from crx where k = 'dm')::uuid, 'Welcome!', gen_random_uuid(), (select (chat_messages_page((select v from crx where k = 'dm')::uuid) -> 'messages' -> 0 ->> 'id')::uuid)) -> 'replyTo' ->> 'body') = 'Hello, first day here'),
  'and replies to it (the quoted text is shown)');
select test.check((select (x ->> 'unread')::int = 0 and x ->> 'lastMessagePreview' = 'Welcome!' from jsonb_array_elements(chat_internal_list()) x where x ->> 'id' = (select v from crx where k = 'dm')),
  'the list shows the real preview');

\echo '   an existing employee whose key is on another device: new messages work, the old encrypted ones are kept'
select test.login('sup_plain');
insert into crx select 'old', chat_open_direct(test.id('sup_b')) ->> 'id';
reset role;
select test.check((select count(*) >= 1 from chat_messages where conversation_id = (select v from crx where k = 'old')::uuid and encrypted and e2ee is not null),
  'the conversation already holds encrypted messages (from chat_test)');
insert into crx select 'oldCount', count(*)::text from chat_messages where conversation_id = (select v from crx where k = 'old')::uuid and encrypted;
set role authenticated;
select test.login('sup_plain');
select test.check((select (chat_send_message((select v from crx where k = 'old')::uuid, 'Readable now', gen_random_uuid()) ->> 'encrypted')::boolean = false), 'a new readable message joins the same conversation');
select test.check((select count(*) filter (where (m ->> 'encrypted')::boolean) >= 1 and count(*) filter (where not (m ->> 'encrypted')::boolean and m ->> 'body' = 'Readable now') = 1
                     from jsonb_array_elements(chat_messages_page((select v from crx where k = 'old')::uuid, null, null, 100) -> 'messages') m), 'mixed history: old encrypted and new readable messages side by side');
reset role;
select test.check((select count(*)::text = (select v from crx where k = 'oldCount') from chat_messages where conversation_id = (select v from crx where k = 'old')::uuid and encrypted and e2ee is not null),
  'no encrypted message was converted, emptied or deleted');

\echo '   groups'
set role authenticated;
select test.login('sup_plain');
insert into crx select 'grp', chat_create_group('CR readable group', array[test.id('sup_b'), test.id('cr_new')]) ->> 'id';
select test.check((select (chat_send_message((select v from crx where k = 'grp')::uuid, 'Team update', gen_random_uuid()) ->> 'encrypted')::boolean = false), 'a group message without keys');
select test.login('cr_new');
select test.check((select chat_messages_page((select v from crx where k = 'grp')::uuid) -> 'messages' -> -1 ->> 'body') = 'Team update', 'every member reads it');

\echo '   nobody else gains anything'
select test.login('tm_a');
select test.must_fail(format($$select chat_messages_page('%s')$$, (select v from crx where k = 'dm')), 'an employee outside the conversation cannot read it', 'NOT_FOUND');
select test.must_fail(format($$select chat_send_message('%s', 'let me in', gen_random_uuid())$$, (select v from crx where k = 'grp')), 'nor write into a group they are not in', 'NOT_FOUND');
select test.login('dh_wab');
select test.must_fail(format($$select chat_conversation_detail('%s')$$, (select v from crx where k = 'dm')), 'a Department Head does not read employees'' direct messages', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 0 from audit_logs where metadata::text like '%first day here%' or metadata::text like '%Readable now%'), 'no message text in the audit log');

\echo '   files'
set role authenticated;
select test.login('cr_new');
select test.check((select (chat_begin_upload((select v from crx where k = 'dm')::uuid, 'plan.pdf', 'application/pdf', 1000)).file_name = 'plan.pdf'), 'a PDF can be shared in a direct chat, with its real name');
select test.must_fail(format($$select chat_begin_upload('%s', 'run.exe', 'application/x-msdownload', 1000)$$, (select v from crx where k = 'dm')), 'program files are still refused', 'cannot be sent');
select test.must_fail(format($$select chat_begin_upload('%s', 'big.pdf', 'application/pdf', 6000000)$$, (select v from crx where k = 'dm')), 'and the 5 MB limit stays', 'at most 5 MB');
select test.check((select (chat_begin_upload((select v from crx where k = 'dm')::uuid, 'x', 'application/x-amuwa-e2ee', 1000)).file_name = 'encrypted-file'), 'an older browser''s encrypted file is still accepted');

\echo '   Delete for everyone works on a readable message'
select test.login('sup_b');
insert into crx select 'mine', (chat_send_message((select v from crx where k = 'dm')::uuid, 'oops, wrong chat', gen_random_uuid()) ->> 'id');
select chat_delete_for_everyone((select v from crx where k = 'mine')::uuid);
reset role;
select test.check((select deleted_at is not null and body = '' from chat_messages where id = (select v from crx where k = 'mine')::uuid), 'the text is wiped from the database, not hidden');

\echo '   the rollback lever: back to end-to-end encryption, and forward again'
set role authenticated;
select test.login('sa');
select chat_set_internal_mode('E2EE');
select test.login('cr_new');
select test.must_fail(format($$select chat_send_message('%s', 'readable?', gen_random_uuid())$$, (select v from crx where k = 'dm')), 'in E2EE mode a readable direct message is refused again', 'end-to-end encrypted');
select test.login('sa');
select chat_set_internal_mode('STANDARD');
reset role;
select test.check((select count(*) = 2 from audit_logs where action = 'CHAT_INTERNAL_MODE_SET'), 'each switch is audited');
set role authenticated;
select test.login('cr_new');
select test.check((select (chat_send_message((select v from crx where k = 'dm')::uuid, 'back again', gen_random_uuid()) ->> 'encrypted')::boolean = false), 'and readable messages work again');
reset role;
