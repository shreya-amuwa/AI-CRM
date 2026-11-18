-- =============================================================================
-- Chat push notifications (migration 20270111000100): who gets a phone / laptop notification for a new chat message, and what it says.
-- Colleague chats show the text; client chats only the name. Two new synthetic employees (cp.a, cp.b) with one device each; conversations
-- and messages are written directly so the test does not depend on other tests' chats. Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 146. Chat push notifications: recipients and wording'
reset role;
\i supabase/migrations/20270111000100_chat_push.sql
\i supabase/migrations/20270111000100_chat_push.sql
grant execute on all functions in schema test to anon, authenticated, service_role;

delete from chat_conversations where title in ('Manual CRM (push test)') or direct_key like 'cp-test:%';
delete from push_subscriptions where endpoint like 'https://push.example.com/cp-%';
delete from auth.users where email in ('cp.a@example.com', 'cp.b@example.com', 'cp.c@example.com');
delete from test.users where name in ('cp_a', 'cp_b', 'cp_c');
select test.create_auth_user(n, n2, json_build_object('full_name', fn)::jsonb,
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select team_id from profiles where id = test.id('sup_plain'))))
  from (values ('cp_a', 'cp.a@example.com', 'Asha Push'), ('cp_b', 'cp.b@example.com', 'Bhavin Push'), ('cp_c', 'cp.c@example.com', 'Chitra Push')) v (n, n2, fn);
update profiles set status = 'ACTIVE' where id in (test.id('cp_a'), test.id('cp_b'), test.id('cp_c'));
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label) values
  (test.id('cp_a'), 'https://push.example.com/cp-a', 'BPk-a', 'auth-a', 'Asha phone'),
  (test.id('cp_b'), 'https://push.example.com/cp-b', 'BPk-b', 'auth-b', 'Bhavin phone'),
  (test.id('cp_c'), 'https://push.example.com/cp-c', 'BPk-c', 'auth-c', 'Chitra phone');
delete from attendance_reminder_prefs where profile_id in (test.id('cp_a'), test.id('cp_b'), test.id('cp_c'));

-- a direct chat A-B and a group A, B, C (C left)
create or replace function test.cp_msg(p_conv uuid, p_who text, p_body text, p_seq bigint, p_attachments jsonb default '[]', p_encrypted boolean default false)
returns uuid language sql as $$
  insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, body, attachments, encrypted, e2ee)
  values (p_conv, p_seq, test.id(p_who), 'STAFF', (select full_name from public.profiles where id = test.id(p_who)), p_body, p_attachments, p_encrypted,
          case when p_encrypted then '{"v":1}'::jsonb end)
  returning id $$;
create or replace function test.cp_push(p_message uuid) returns jsonb language sql as $$ select public.chat_push_for_message(p_message) $$;
create or replace function test.cp_for(p_result jsonb, p_who text) returns jsonb language sql as $$
  select x from jsonb_array_elements(p_result) x where x ->> 'profileId' = test.id(p_who)::text $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
with c as (insert into chat_conversations (kind, direct_key, created_by) values ('DIRECT', 'cp-test:' || gen_random_uuid(), test.id('cp_a')) returning id)
select id as dm from c \gset
insert into chat_members (conversation_id, profile_id) values (:'dm', test.id('cp_a')), (:'dm', test.id('cp_b'));
with c as (insert into chat_conversations (kind, title, created_by) values ('GROUP', 'Manual CRM (push test)', test.id('cp_a')) returning id)
select id as grp from c \gset
insert into chat_members (conversation_id, profile_id, left_at) values (:'grp', test.id('cp_a'), null), (:'grp', test.id('cp_b'), null), (:'grp', test.id('cp_c'), now());

\echo '   colleague chats: the name and the text'
select test.cp_msg(:'dm', 'cp_a', 'hello', 1) as m1 \gset
select test.cp_push(:'m1') as r1 \gset
select test.check(jsonb_array_length(:'r1'::jsonb) = 1 and test.cp_for(:'r1', 'cp_b') ->> 'title' = 'Asha Push' and test.cp_for(:'r1', 'cp_b') ->> 'body' = 'hello'
                  and test.cp_for(:'r1', 'cp_a') is null, 'direct: B gets "<A''s name>" / the text, A gets nothing');
select test.check(test.cp_for(:'r1', 'cp_b') ->> 'tag' = 'chat-' || :'dm' and test.cp_for(:'r1', 'cp_b') ->> 'url' = '/?open=chat&conversation=' || :'dm'
                  and test.cp_for(:'r1', 'cp_b') -> 'targets' -> 0 ->> 'endpoint' = 'https://push.example.com/cp-b', 'the url and tag name the conversation, with B''s device');
select test.check(jsonb_array_length(test.cp_push(:'m1')) = 0, 'the same message twice: the second call returns []');
select test.cp_msg(:'grp', 'cp_a', 'wtf mhnje 4 months?', 1) as m2 \gset
select test.cp_push(:'m2') as r2 \gset
select test.check(test.cp_for(:'r2', 'cp_b') ->> 'title' = 'Asha Push · Manual CRM (push test)' and test.cp_for(:'r2', 'cp_b') ->> 'body' = 'wtf mhnje 4 months?'
                  and test.cp_for(:'r2', 'cp_c') is null and test.cp_for(:'r2', 'cp_a') is null, 'group: title "<A''s name> · Manual CRM"; a member who left gets nothing');
update chat_members set left_at = null, visible_from_seq = 5 where conversation_id = :'grp' and profile_id = test.id('cp_c');
select test.cp_msg(:'grp', 'cp_b', 'before Chitra joined', 2) as m3 \gset
select test.check(test.cp_for(test.cp_push(:'m3'), 'cp_c') is null, 'a member added after the message gets nothing');
select test.cp_msg(:'grp', 'cp_b', repeat('x', 300), 6) as m4 \gset
select test.cp_push(:'m4') as r4 \gset
select test.check(test.cp_for(:'r4', 'cp_c') ->> 'body' = repeat('x', 120) || '…' and test.cp_for(:'r4', 'cp_a') ->> 'body' = repeat('x', 120) || '…',
  'a 300-character message is cut to 120 characters with …');
select test.cp_msg(:'dm', 'cp_b', '', 2, '[{"id":"00000000-0000-4000-8000-000000000001"}]') as m5 \gset
select test.check(test.cp_for(test.cp_push(:'m5'), 'cp_a') ->> 'body' = 'sent a file', 'a file without text says "sent a file"');
select test.cp_msg(:'dm', 'cp_b', '', 3, '[]', true) as m6 \gset
select test.check(test.cp_for(test.cp_push(:'m6'), 'cp_a') ->> 'body' = 'New message', 'an encrypted message says "New message"');
insert into chat_messages (conversation_id, seq, sender_kind, kind, body) values (:'dm', 4, 'SYSTEM', 'SYSTEM', 'Bhavin joined') returning id as m7 \gset
select test.check(jsonb_array_length(test.cp_push(:'m7')) = 0, 'a system line is never pushed');
select test.check(jsonb_array_length(test.cp_push(gen_random_uuid())) = 0, 'an unknown message id returns []');

\echo '   client chats: the name only, never the text'
select c.id as cust, coalesce(nullif(btrim(c.company), ''), c.name) as company, private.support_member_of(c.id) as rm
  from customers c where private.support_member_of(c.id) is not null order by c.created_at limit 1 \gset
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label) values (:'rm', 'https://push.example.com/cp-rm', 'BPk-rm', 'auth-rm', 'RM phone')
  on conflict (endpoint) do update set profile_id = excluded.profile_id, active = true;
update profiles set status = 'ACTIVE' where id = :'rm';
with c as (insert into chat_conversations (kind, customer_id, channel) values ('CLIENT', :'cust', 'RM') returning id) select id as cc from c \gset
insert into chat_messages (conversation_id, seq, sender_kind, sender_name, body) values (:'cc', 1, 'CLIENT', 'Ravi Client', 'my secret pricing question') returning id as m8 \gset
select test.cp_push(:'m8') as r8 \gset
select test.check((select x ->> 'title' = :'company' and x ->> 'body' = 'New message from Ravi Client' and x ->> 'url' = '/?open=chat&client=' || :'cc'
                     from jsonb_array_elements(:'r8'::jsonb) x where x ->> 'profileId' = :'rm'),
  'client chat: title is the company, body "New message from <sender>", never the text');
select test.check(position('secret' in :'r8') = 0, 'the client''s text appears nowhere in what is pushed');
insert into chat_members (conversation_id, profile_id) values (:'cc', test.id('cp_a')) on conflict do nothing;
update chat_conversations set channel = 'RM' where id = :'cc';
insert into chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, body) values (:'cc', 2, :'rm', 'STAFF', 'The RM', 'staff internal price 999') returning id as m8b \gset
select test.cp_push(:'m8b') as r8b \gset
select test.check(position('999' in :'r8b') = 0 and not exists (select 1 from jsonb_array_elements(:'r8b'::jsonb) x where x ->> 'profileId' = :'rm'),
  'a staff message in a client chat never shows its text either, and the RM who wrote it is not notified');

\echo '   switches, accounts, devices'
set role authenticated;
select test.login('cp_c');
select test.check((select (d ->> 'chatPush')::boolean = false from (select push_chat_set(false) d) x), 'chat switch off: push_chat_set(false) returns chatPush false');
select test.check((select (d ->> 'chatPush')::boolean = false from (select attendance_reminder_settings() d) x), 'and attendance_reminder_settings() shows chatPush false');
reset role;
select test.cp_msg(:'grp', 'cp_a', 'after the switch', 7) as m9 \gset
select test.cp_push(:'m9') as r9 \gset
select test.check(test.cp_for(:'r9', 'cp_c') is null and test.cp_for(:'r9', 'cp_b') is not null, 'chat switch off: nothing for that person (the others still get it)');
update profiles set status = 'SUSPENDED' where id = test.id('cp_b');
update push_subscriptions set active = false where profile_id = test.id('cp_a');
select test.cp_msg(:'grp', 'cp_c', 'nobody left to tell', 8) as m10 \gset
select test.check(jsonb_array_length(test.cp_push(:'m10')) = 0, 'an inactive account or a person without devices gets nothing');
update profiles set status = 'ACTIVE' where id = test.id('cp_b');
set role authenticated;
select test.login('cp_a');
select test.must_fail(format($$select chat_push_for_message(%L)$$, :'m1'), 'staff cannot call chat_push_for_message', 'permission denied');
reset role;
delete from chat_conversations where id in (:'dm', :'grp', :'cc');
delete from push_subscriptions where endpoint like 'https://push.example.com/cp-%';
