-- =============================================================================
-- Chat: Delete Inbox, @mentions in groups and message reactions (migration 20270116000100). Reuses the staff of rls_test.sql / chat_test.sql
-- (sup_plain, sup_b, sup_th, tm_c, dh_wab, sa). Runs LAST on the shared database: the Super Admin's purge deletes every internal chat message.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 134. Chat: Delete Inbox, @mentions, reactions'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270116000100_chat_inbox_mentions_reactions.sql
\i supabase/migrations/20270116000100_chat_inbox_mentions_reactions.sql
update public.chat_settings set internal_mode = 'STANDARD';
create temp table cx (k text primary key, v text);
grant all on cx to authenticated;
create or replace function test.cx(p text) returns uuid language sql stable as $$ select v::uuid from cx where k = p $$;
create or replace function test.cmsg(p_conv uuid, p_body text) returns uuid language sql as $$
  select (chat_send_message(p_conv, p_body, gen_random_uuid()) ->> 'id')::uuid $$;
create or replace function test.cnotes(p_user text, p_type text, p_message uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications n where n.recipient_id = test.id(p_user) and n.type = p_type and n.data ->> 'messageId' = p_message::text $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   a group and a direct chat'
set role authenticated;
select test.login('sup_plain');
insert into cx select 'grp', chat_create_group('CX tagging group', array[test.id('sup_b'), test.id('sup_th')]) ->> 'id';
insert into cx select 'dm', chat_open_direct(test.id('sup_b')) ->> 'id';
insert into cx select 'g1', test.cmsg(test.cx('grp'), 'Hello @CR team, please check the file')::text;

\echo '   @mentions'
select test.check(jsonb_array_length(chat_message_mention(test.cx('g1'), array[test.id('sup_b'), test.id('sup_th')]) -> 'mentions') = 2,
  'the sender tags two members of the group');
select test.check(jsonb_array_length(chat_message_mention(test.cx('g1'), array[test.id('sup_b')]) -> 'mentions') = 2, 'tagging again (a retry) changes nothing');
reset role;
select test.check(test.cnotes('sup_b', 'CHAT_MENTION', test.cx('g1')) = 1 and test.cnotes('sup_th', 'CHAT_MENTION', test.cx('g1')) = 1,
  'each tagged member gets one notification (not two for the retry)');
select test.check((select entity_type = 'chat_mention' and entity_id = test.cx('grp') and (data ->> 'seq')::bigint > 0 from notifications
                    where recipient_id = test.id('sup_b') and type = 'CHAT_MENTION' and data ->> 'messageId' = test.cx('g1')::text),
  'the notification opens the group on that message (conversation, message and position)');
select test.check(test.cnotes('tm_c', 'CHAT_MENTION', test.cx('g1')) = 0 and test.cnotes('dh_wab', 'CHAT_MENTION', test.cx('g1')) = 0, 'nobody else is notified');
set role authenticated;
select test.login('sup_plain');
insert into cx select 'g2', test.cmsg(test.cx('grp'), 'Second message')::text;
select test.must_fail($$select chat_message_mention(test.cx('g2'), array[test.id('tm_c')])$$, 'someone outside the group cannot be tagged', 'only tag members of this group');
select test.must_fail($$select chat_message_mention(test.cx('g2'), array[test.id('sup_b'), test.id('dh_wab')])$$, '... not even together with a member', 'only tag members of this group');
reset role;
select test.check((select count(*) = 0 from chat_message_mentions where message_id = test.cx('g2')), 'a refused tag stores nothing');
set role authenticated;
select test.login('sup_b');
select test.must_fail($$select chat_message_mention(test.cx('g2'), array[test.id('sup_th')])$$, 'only the sender tags people in their message', 'only in a message you sent');
select test.login('sup_plain');
insert into cx select 'd1', test.cmsg(test.cx('dm'), 'Direct hello')::text;
select test.must_fail($$select chat_message_mention(test.cx('d1'), array[test.id('sup_b')])$$, 'tagging is for groups', 'in a group only');
select test.login('sup_th');
select test.check((select (m -> 'mentions') @> jsonb_build_array(jsonb_build_object('name', (select full_name from profiles where id = test.id('sup_th')), 'me', true))
                     from jsonb_array_elements(chat_messages_page(test.cx('grp')) -> 'messages') m where (m ->> 'id')::uuid = test.cx('g1')),
  'the message carries who is tagged, so their names are highlighted');
select test.login('tm_c');
select test.must_fail($$select chat_messages_page(test.cx('grp'))$$, 'an outsider still cannot read the group', 'not found');

\echo '   reactions'
select test.login('sup_b');
select test.check((chat_message_react(test.cx('g1'), '👍') -> 'reactions' -> 0 ->> 'count')::int = 1, 'a member reacts 👍');
select test.check((select (r ->> 'emoji') = '❤️' and (r ->> 'count')::int = 1 and (r ->> 'mine')::boolean
                     from jsonb_array_elements(chat_message_react(test.cx('g1'), '❤️') -> 'reactions') r), 'and changes it to ❤️ (one reaction per person)');
select test.login('sup_th');
select chat_message_react(test.cx('g1'), '❤️');
select chat_message_react(test.cx('g1'), '❤️');   -- the same again: no duplicate
reset role;
select test.check((select count(*) = 2 from chat_message_reactions where message_id = test.cx('g1')), 'two people, two reactions: never a duplicate for the same person');
set role authenticated;
select test.login('sup_plain');
select test.check((select (r ->> 'count')::int = 2 and not (r ->> 'mine')::boolean and jsonb_array_length(r -> 'people') = 2
                     from jsonb_array_elements(chat_messages_page(test.cx('grp')) -> 'messages') m, jsonb_array_elements(m -> 'reactions') r
                    where (m ->> 'id')::uuid = test.cx('g1')), 'the message shows ❤️ 2 and who reacted');
select test.check((chat_reactions_for(test.cx('grp'), array[test.cx('g1')]) -> test.cx('g1')::text -> 0 ->> 'count')::int = 2,
  'a screen can refresh the reactions of the messages it shows');
select test.login('sup_b');
select test.check(jsonb_array_length(chat_message_react(test.cx('g1'), null) -> 'reactions') = 1, 'removing a reaction');
select test.must_fail($$select chat_message_react(test.cx('g1'), '🔥')$$, 'only the six offered reactions', 'offered reactions');
select test.check((chat_message_react(test.cx('d1'), '🙏') -> 'reactions' -> 0 ->> 'emoji') = '🙏', 'reactions work in a direct chat too');
select test.login('tm_c');
select test.must_fail($$select chat_message_react(test.cx('g1'), '👍')$$, 'an outsider cannot react', 'not found');
reset role;
select test.must_fail($$insert into chat_message_reactions (message_id, conversation_id, profile_id, emoji) values (test.cx('g1'), test.cx('grp'), test.id('sup_th'), '😂')$$,
  'even the database refuses a second reaction from the same person on the same message', 'duplicate key');
set role authenticated;
select test.login('sup_b');
select test.must_fail($$insert into chat_message_reactions (message_id, conversation_id, profile_id, emoji) values (test.cx('g2'), test.cx('grp'), test.id('sup_b'), '😂')$$,
  'a signed-in user cannot insert directly', 'permission denied');
reset role;
select test.check((select count(*) = 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'chat_message_reactions') or not exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
  'reactions are sent live (Realtime publication)');

\echo '   Clear my inbox (for me only)'
set role authenticated;
select test.login('sup_b');
select test.check((chat_inbox_clear() ->> 'conversations')::int >= 2, 'a member clears their whole inbox');
select test.check(not exists (select 1 from jsonb_array_elements(chat_internal_list()) x where x ->> 'id' in (test.cx('grp')::text, test.cx('dm')::text)),
  'their chats leave their list');
select test.check(jsonb_array_length(chat_messages_page(test.cx('grp')) -> 'messages') = 0, 'the group history is gone for them');
select test.must_fail($$select chat_message_react(test.cx('g1'), '👍')$$, 'and its messages cannot be reached any more', 'not found');
select test.login('sup_plain');
select test.check(jsonb_array_length(chat_messages_page(test.cx('grp')) -> 'messages') >= 2, 'the other members keep the whole history');
select test.cmsg(test.cx('grp'), 'Anyone there?');
select test.login('sup_b');
select test.check(exists (select 1 from jsonb_array_elements(chat_internal_list()) x where x ->> 'id' = test.cx('grp')::text and (x ->> 'unread')::int = 1),
  'a new message brings the group back, with only the new message unread');
select test.check((select count(*) = 1 and bool_and(m ->> 'body' = 'Anyone there?') from jsonb_array_elements(chat_messages_page(test.cx('grp')) -> 'messages') m),
  '... and only the new message in it');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'CHAT_INBOX_CLEARED' and entity_id = test.id('sup_b') and created_at > now() - interval '1 minute')
                  and (select count(*) = 1 from chat_inbox_deletions where actor_id = test.id('sup_b') and scope = 'MINE'), 'clearing is logged');

\echo '   Delete all internal chat history (the Super Admin only)'
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select chat_inbox_purge('DELETE ALL CHATS')$$, 'a Department Head cannot delete everybody''s chats', 'Only the Super Admin');
select test.login('sup_plain');
select test.must_fail($$select chat_inbox_purge('DELETE ALL CHATS')$$, 'nor a Team Member', 'Only the Super Admin');
select test.login('sa');
select test.must_fail($$select chat_inbox_purge('yes')$$, 'the Super Admin must type the confirmation', 'DELETE ALL CHATS');
reset role;
insert into cx select 'clientMsgs', count(*)::text from chat_messages m join chat_conversations c on c.id = m.conversation_id where c.kind = 'CLIENT';
set role authenticated;
select test.login('sa');
select test.check((chat_inbox_purge('DELETE ALL CHATS') ->> 'messages')::int >= 3, 'the Super Admin deletes every internal message');
reset role;
select test.check(not exists (select 1 from chat_messages m join chat_conversations c on c.id = m.conversation_id where c.kind in ('DIRECT', 'GROUP') and m.kind = 'TEXT'),
  'no internal message is left');
select test.check((select count(*)::text from chat_messages m join chat_conversations c on c.id = m.conversation_id where c.kind = 'CLIENT') = (select v from cx where k = 'clientMsgs'),
  'client conversations are untouched');
select test.check(exists (select 1 from chat_conversations where id = test.cx('grp')) and exists (select 1 from chat_members where conversation_id = test.cx('grp') and profile_id = test.id('sup_th') and left_at is null),
  'groups and their members stay');
select test.check((select count(*) = 0 from chat_message_reactions) and (select count(*) = 0 from chat_message_mentions where conversation_id = test.cx('grp')), 'reactions and tags went with the messages');
select test.check(not exists (select 1 from chat_attachments a join chat_conversations c on c.id = a.conversation_id where c.kind in ('DIRECT', 'GROUP') and a.status <> 'DELETED'),
  'every internal file is marked deleted (the API removes it from storage)');
select test.check((select count(*) = 1 from audit_logs where action = 'CHAT_INBOX_PURGED' and created_at > now() - interval '1 minute')
                  and (select count(*) = 1 from chat_inbox_deletions where scope = 'ALL_INTERNAL'), 'the purge is logged, with counts only');
set role authenticated;
select test.login('sup_th');
select test.check((select count(*) = 1 and bool_and(m ->> 'kind' = 'SYSTEM') from jsonb_array_elements(chat_messages_page(test.cx('grp')) -> 'messages') m),
  'members see one line saying the history was deleted');
select test.check((select (test.cmsg(test.cx('grp'), 'Starting fresh')) is not null), 'and the group keeps working');
reset role;
select set_config('request.jwt.claims', '', false);
