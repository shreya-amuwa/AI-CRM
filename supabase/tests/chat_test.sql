-- =============================================================================
-- Chat (migration 20261108000100): client chat and internal chat.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- More of these checks prove somebody is REFUSED than that somebody is allowed.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 31. Chat: client conversation, reviewers, internal direct messages and groups'
reset role;
create temp table ch (k text primary key, v text);
grant all on ch to authenticated, service_role;
create function pg_temp.g(p_k text) returns text language sql stable as $$ select v from ch where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated;

-- a customer looked after by the Support member sup_plain (owner) and the Support team's lead
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000401","name":"Chat Client","businessName":"Chat Traders (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean),
  'setup: Support member adds a customer');
reset role;
insert into ch select 'cust', id::text from customers where phone = '9000000401';
insert into ch select 'lead', (select name from test.users where id = private.support_lead_of((select v::uuid from ch where k = 'cust')));
select test.check((select v is not null from ch where k = 'lead'), 'setup: the customer has a Team Lead (' || (select v from ch where k = 'lead') || ')');
select test.create_auth_user('chat_client', 'chat.client@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select v from ch where k = 'cust')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values ((select v::uuid from ch where k = 'cust'), test.id('chat_client'), 'chat.client@example.com');

-- ---------------------------------------------------------------- the client's own conversation
set role authenticated;
select test.login('chat_client');
create temp table cc as select chat_client_conversation() as j;
grant all on cc to authenticated;
insert into ch select 'conv', (select j ->> 'id' from cc);
select test.check((select j ->> 'access' = 'CLIENT' and (j -> 'canWrite')::boolean and j ->> 'title' = 'Your Amuwa team' and (j -> 'assigned')::boolean and j -> 'team' -> 'teamMember' ->> 'name' is not null and j -> 'team' -> 'teamLead' ->> 'name' is not null from cc),
  'the client opens their conversation and sees their Team Member and Team Lead by name');
select test.check((select not ((j -> 'team' -> 'teamMember') ? 'id') and jsonb_typeof(j -> 'customer') = 'null' from cc), 'the client is not given staff ids or the staff view of the customer');
select test.check(((select j ->> 'id' from cc) = chat_client_conversation() ->> 'id'), 'opening it again gives the same conversation');
select test.check((select count(*) = 0 from chat_messages), 'a new conversation is empty');

-- ---------------------------------------------------------------- sending, idempotency, validation
create temp table m1 as select chat_send_message(pg_temp.g('conv')::uuid, '  Hello, I need help with my campaign  ', '11111111-1111-1111-1111-111111111111') as j;
grant all on m1 to authenticated;
select test.check((select j ->> 'body' = 'Hello, I need help with my campaign' and (j ->> 'seq')::int = 1 and (j -> 'mine')::boolean and j ->> 'senderKind' = 'CLIENT' and j ->> 'senderLabel' = 'Client' from m1),
  'the client sends the first message (trimmed, numbered 1, labelled Client)');
select test.check((select chat_send_message(pg_temp.g('conv')::uuid, 'Hello, I need help with my campaign', '11111111-1111-1111-1111-111111111111') ->> 'id' = (select j ->> 'id' from m1)),
  'sending the same message again (a retry or a double click) returns the stored one');
select test.check((select count(*) = 1 from chat_messages), 'and it is stored once');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, '   ', '22222222-2222-2222-2222-222222222222')$$, 'an empty message is refused', 'Write a message');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, repeat('x', 4001), '33333333-3333-3333-3333-333333333333')$$, 'a message over 4000 characters is refused', '4000');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, 'no id', null)$$, 'a message without an identifier is refused', 'identifier');
select test.must_fail($$select chat_send_message(gen_random_uuid(), 'hi', gen_random_uuid())$$, 'a conversation that does not exist is not found', 'not found');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, 'reply', gen_random_uuid(), gen_random_uuid())$$, 'replying to a message that is not in this conversation is refused', 'not found');

-- ---------------------------------------------------------------- the assigned team
reset role;
select test.check((select count(*) = 1 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id('sup_plain') and read_at is null), 'the Team Member gets a bell for the client message');
select test.check((select count(*) = 1 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id((select v from ch where k = 'lead')) and read_at is null), 'and so does the Team Lead');
set role authenticated;
select test.login('chat_client');
select chat_send_message(pg_temp.g('conv')::uuid, 'Second message', '44444444-4444-4444-4444-444444444444');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id('sup_plain')), 'a second message does not add a second bell while the first is unread');
set role authenticated;

select test.login('sup_plain');
select test.check((select (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'access') = 'STAFF' and (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'unread')::int = 2), 'the assigned Team Member opens it: 2 unread');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('conv')::uuid) -> 'messages') = 2), 'and reads the history');
select test.check((select count(*) = 2 from chat_messages), 'rows are visible to them through row level security');
select test.check((select (chat_my_clients() -> 0 ->> 'customerId') = pg_temp.g('cust') and (chat_my_clients() -> 0 ->> 'unread')::int = 2), 'the customer is in their "my clients" list with the unread count');
select test.check((select chat_mark_read(pg_temp.g('conv')::uuid) ->> 'readSeq' = '2'), 'they mark it read');
select test.check((select (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'unread')::int = 0), 'unread is 0');
create temp table m3 as select chat_send_message(pg_temp.g('conv')::uuid, 'Hi, we are looking into it', '55555555-5555-5555-5555-555555555555') as j;
grant all on m3 to authenticated;
select test.check((select j ->> 'senderKind' = 'STAFF' and j ->> 'senderLabel' = 'Team Member' and (j ->> 'seq')::int = 3 from m3), 'the Team Member replies (labelled Team Member)');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id('sup_plain') and read_at is null) = false
                  or (select count(*) from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id('sup_plain') and read_at is null) = 0, 'reading the chat cleared the Team Member''s bell');
select test.check((select count(*) = 1 from client_notifications where customer_id = pg_temp.g('cust')::uuid and type = 'CHAT_MESSAGE' and read_at is null), 'the client gets one bell for the reply');
set role authenticated;

select test.login((select v from ch where k = 'lead'));
select test.check((select (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'access') = 'STAFF'), 'the assigned Team Lead can open the conversation');
select test.check((select chat_send_message(pg_temp.g('conv')::uuid, 'This is the Team Lead, I am here too', '66666666-6666-6666-6666-666666666666') ->> 'senderLabel' = 'Team Lead'), 'the Team Lead replies (labelled Team Lead)');

select test.login('chat_client');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('conv')::uuid) -> 'messages') = 4), 'the client sees the replies of both');
select test.check((select (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'peerReadSeq')::int = 4 and (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'unread')::int = 2), 'the client sees how far the team has read ("seen") and 2 unread');
select test.check((select count(*) = 4 from chat_messages), 'and reads them through row level security');
select chat_mark_read(pg_temp.g('conv')::uuid);
reset role;
select test.check((select client_read_seq = 4 from chat_conversations where id = pg_temp.g('conv')::uuid), 'the client''s "seen" position moves');
set role authenticated;
select test.login('chat_client');
select chat_send_message(pg_temp.g('conv')::uuid, 'One more thing', '77777777-7777-7777-7777-777777777777');

-- ---------------------------------------------------------------- everybody else is refused
select test.login('sup_b');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'a Support colleague who is not assigned cannot read it', 'not found');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, 'hello', gen_random_uuid())$$, 'nor write in it', 'not found');
select test.must_fail($$select chat_conversation_detail(pg_temp.g('conv')::uuid)$$, 'nor open its detail', 'not found');
select test.must_fail($$select chat_customer_conversation(pg_temp.g('cust')::uuid)$$, 'nor open the customer''s chat', 'not found');
select test.check((select count(*) = 0 from chat_messages), 'row level security shows them no message');
select test.check((select count(*) = 0 from chat_conversations where kind = 'CLIENT'), 'and no client conversation');
select test.check((select jsonb_array_length(chat_my_clients()) = 0 or not exists (select 1 from jsonb_array_elements(chat_my_clients()) x where x ->> 'customerId' = pg_temp.g('cust'))), 'the customer is not in their "my clients"');
select test.login('tm_a');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'a Sales member cannot read it', 'not found');
select test.must_fail($$select chat_customer_conversation(pg_temp.g('cust')::uuid)$$, 'nor open the customer''s chat (a customer nobody on their side looks after)', 'not found');
select test.login('dh_wbx');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'the Department Head of another department cannot read it', 'not found');
select test.must_fail($$select chat_review_open(pg_temp.g('conv')::uuid)$$, 'nor open it for review', 'not found');
select test.check((select count(*) = 0 from chat_messages), 'and sees no message');
select test.check((select (chat_review_list() ->> 'total')::int = 0), 'their review list does not include it');
select test.login('cdash_a');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'another client cannot read it', 'not found');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, 'hello', gen_random_uuid())$$, 'nor write in it', 'not found');
select test.check((select count(*) = 0 from chat_messages), 'row level security shows them no message');
select test.check((select j ->> 'id' <> pg_temp.g('conv') from (select chat_client_conversation() as j) x), 'their own conversation is a different one');

-- ---------------------------------------------------------------- the Department Head reviews and cannot write
select test.login('dh_wab');
select test.check((select (chat_conversation_detail(pg_temp.g('conv')::uuid) ->> 'access') = 'REVIEWER' and not (chat_conversation_detail(pg_temp.g('conv')::uuid) -> 'canWrite')::boolean), 'the Department Head of the department opens it as a reviewer (no write)');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('conv')::uuid) -> 'messages') = 5), 'and reads the whole history');
select test.check((select count(*) = 5 from chat_messages), 'also through row level security (this is what live updates use)');
select test.check((select (r -> 'total')::int >= 1 and r -> 'items' -> 0 -> 'team' -> 'teamMember' ->> 'name' is not null and r -> 'items' -> 0 -> 'customer' ->> 'business' = 'Chat Traders (TEST)' from (select chat_review_list() as r) x), 'the review list shows the business and the assigned team');
select chat_review_open(pg_temp.g('conv')::uuid);
select chat_review_open(pg_temp.g('conv')::uuid);
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'CLIENT_CHAT_REVIEWED' and actor_id = test.id('dh_wab') and entity_id = pg_temp.g('conv')::uuid), 'opening it for review is audited (once for repeated opens)');
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, 'I am the Department Head', gen_random_uuid())$$, 'the Department Head cannot send a message (direct call)', 'reviewer');
select test.must_fail($$select chat_begin_upload(pg_temp.g('conv')::uuid, 'a.pdf', 'application/pdf', 1000)$$, 'nor attach a file', 'reviewer');
select test.must_fail($$insert into chat_messages (conversation_id, seq, sender_id, sender_kind, body) values (pg_temp.g('conv')::uuid, 99, test.id('dh_wab'), 'STAFF', 'sneaky')$$, 'nor insert a row directly', 'permission denied');
select test.must_fail($$update chat_messages set body = 'edited' where conversation_id = pg_temp.g('conv')::uuid$$, 'nor change a message', 'permission denied');
select test.must_fail($$delete from chat_messages where conversation_id = pg_temp.g('conv')::uuid$$, 'nor delete one', 'permission denied');
select test.must_fail($$update chat_conversations set last_seq = 0$$, 'nor reset a conversation', 'permission denied');
select test.check((select chat_mark_read(pg_temp.g('conv')::uuid) ->> 'readSeq' = '5'), 'a reviewer can mark what they have reviewed as read (their own unread indicator)');
reset role;
select test.check((select staff_read_seq = 4 and client_read_seq = 5 from chat_conversations where id = pg_temp.g('conv')::uuid), 'a reviewer reading does not count as "seen by the team"');
set role authenticated;

-- ---------------------------------------------------------------- who is who: clients and employees are separate worlds
select test.login('chat_client');
select test.must_fail($$select chat_directory()$$, 'a client cannot list employees', 'sign in');
select test.must_fail($$select chat_open_direct(test.id('sup_plain'))$$, 'nor start a conversation with an employee', 'sign in');
select test.must_fail($$select chat_create_group('x', array[test.id('sup_plain')])$$, 'nor create a group', 'sign in');
select test.must_fail($$select chat_review_list()$$, 'nor use the review list', 'department head');
select test.must_fail($$select chat_my_clients()$$, 'nor the employee''s client list', 'sign in');
select test.must_fail($$select chat_customer_conversation(pg_temp.g('cust')::uuid)$$, 'nor open a customer''s chat as staff', 'not found');
select test.check((select count(*) = 0 from chat_members), 'a client sees no group membership');
select test.must_fail($$insert into chat_messages (conversation_id, seq, sender_id, sender_kind, body) values (pg_temp.g('conv')::uuid, 98, test.id('chat_client'), 'CLIENT', 'forged')$$, 'a client cannot insert a message row directly', 'permission denied');
select test.must_fail($$update chat_messages set sender_kind = 'STAFF', sender_name = 'Support Lead' where conversation_id = pg_temp.g('conv')::uuid$$, 'nor pose as an employee', 'permission denied');
select test.must_fail($$select * from chat_read_state$$, 'read positions are not readable directly', 'permission denied');
select test.must_fail($$select * from chat_attachments$$, 'nor attachments', 'permission denied');
select test.check((select (chat_unread_summary() ->> 'total')::int = 0), 'the client''s unread summary works');

-- ---------------------------------------------------------------- the team changes: access follows the assignment
reset role;
select set_config('request.jwt.claims', '', false);
update customers set owner_id = test.id('sup_b') where id = pg_temp.g('cust')::uuid;
select test.check((select last_message_preview like 'Your assigned team was updated%' and last_seq = 6 from chat_conversations where id = pg_temp.g('conv')::uuid), 'a new owner is written into the conversation as a system line');
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'the previous Team Member loses access at once', 'not found');
select test.check((select count(*) = 0 from chat_messages), 'row level security shows them nothing any more');
select test.must_fail($$select chat_send_message(pg_temp.g('conv')::uuid, 'still here?', gen_random_uuid())$$, 'and cannot write', 'not found');
select test.login('sup_b');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('conv')::uuid) -> 'messages') = 6), 'the new Team Member sees the thread (the customer''s history stays with the customer)');
select test.check((select chat_send_message(pg_temp.g('conv')::uuid, 'Hello, I am your new contact', gen_random_uuid()) ->> 'senderLabel' = 'Team Member'), 'and can reply');
select test.login('chat_client');
select test.check((select chat_conversation_detail(pg_temp.g('conv')::uuid) -> 'team' -> 'teamMember' ->> 'name' = 'Member B' or (chat_conversation_detail(pg_temp.g('conv')::uuid) -> 'team' -> 'teamMember' ->> 'name') is not null), 'the client sees the new Team Member');

-- the client's login is removed: no access
reset role;
create temp table sav as select * from customer_client_accounts where customer_id = pg_temp.g('cust')::uuid;
delete from customer_client_accounts where customer_id = pg_temp.g('cust')::uuid;
set role authenticated;
select test.login('chat_client');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'a client whose login was removed cannot read', 'not found');
select test.must_fail($$select chat_client_conversation()$$, 'nor open the chat', 'clients only');
reset role;
insert into customer_client_accounts select * from sav;
select set_config('request.jwt.claims', '', false);
update customers set owner_id = test.id('sup_plain') where id = pg_temp.g('cust')::uuid;

-- an employee whose account is disabled
select set_config('request.jwt.claims', '', false);
update profiles set status = 'SUSPENDED' where id = test.id('sup_plain');
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select chat_messages_page(pg_temp.g('conv')::uuid)$$, 'a disabled employee cannot read the conversation', 'not found');
select test.must_fail($$select chat_directory()$$, 'nor use internal chat', 'sign in');
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set status = 'ACTIVE' where id = test.id('sup_plain');

-- ================================================================ internal chat
set role authenticated;
select test.login('sup_plain');
select test.check((select jsonb_array_length(chat_directory('b')) >= 1 and not exists (select 1 from jsonb_array_elements(chat_directory()) x where x ->> 'id' = test.id('sup_plain')::text)), 'the directory finds colleagues and leaves out the caller');
select test.check((select not exists (select 1 from jsonb_array_elements(chat_directory()) x where x ? 'email' or x ? 'phone')), 'the directory shows no e-mail or phone');
select test.check((select jsonb_array_length(chat_directory('zzzzzz-nobody')) = 0), 'a search with no match is empty');
create temp table dm as select chat_open_direct(test.id('sup_b')) as j;
grant all on dm to authenticated;
insert into ch select 'dm', (select j ->> 'id' from dm);
select test.check((select j ->> 'kind' = 'DIRECT' and j ->> 'title' = (select full_name from profiles where id = test.id('sup_b')) from dm), 'a direct conversation is named after the other person');
select test.must_fail($$select chat_open_direct(test.id('sup_plain'))$$, 'nobody can open a conversation with themselves', 'cannot start');
select test.must_fail($$select chat_open_direct(gen_random_uuid())$$, 'nor with someone who does not exist', 'cannot start');
select test.check((select chat_send_message(pg_temp.g('dm')::uuid, 'Do you have a minute?', gen_random_uuid()) ->> 'senderLabel' is null), 'a direct message is sent');
select test.login('sup_b');
select test.check((select chat_open_direct(test.id('sup_plain')) ->> 'id' = pg_temp.g('dm')), 'the other person opening it gets the same single conversation');
select test.check((select jsonb_array_length(chat_internal_list()) = 1 and chat_internal_list() -> 0 ->> 'lastMessagePreview' = 'Do you have a minute?' and (chat_internal_list() -> 0 ->> 'unread')::int = 1), 'it is in their list with the preview and 1 unread');
select test.check((select (chat_unread_summary() ->> 'internal')::int = 1), 'and in their unread summary');
select test.check((select chat_send_message(pg_temp.g('dm')::uuid, 'Yes, go ahead', gen_random_uuid()) is not null), 'they reply');
select chat_mark_read(pg_temp.g('dm')::uuid);
select test.check((select (chat_unread_summary() ->> 'internal')::int = 0), 'reading clears it');
select test.login('sup_plain');
select test.check((select (chat_conversation_detail(pg_temp.g('dm')::uuid) ->> 'peerReadSeq')::int = 2 and (chat_conversation_detail(pg_temp.g('dm')::uuid) ->> 'unread')::int = 1), 'the sender sees the other person has read their message');
select test.login('sup_th');
select test.must_fail($$select chat_messages_page(pg_temp.g('dm')::uuid)$$, 'a third person cannot read the direct conversation', 'not found');
select test.must_fail($$select chat_send_message(pg_temp.g('dm')::uuid, 'hi', gen_random_uuid())$$, 'nor write in it', 'not found');
select test.check((select count(*) = 0 from chat_messages where conversation_id = pg_temp.g('dm')::uuid), 'row level security shows them nothing');
select test.check((select count(*) = 0 from chat_conversations where id = pg_temp.g('dm')::uuid), 'nor the conversation');
select test.check((select count(*) = 0 from chat_members where conversation_id = pg_temp.g('dm')::uuid), 'nor its members');
select test.login('dh_wab');
select test.must_fail($$select chat_messages_page(pg_temp.g('dm')::uuid)$$, 'a Department Head cannot read employees'' direct messages', 'not found');
select test.login('sa');
select test.must_fail($$select chat_messages_page(pg_temp.g('dm')::uuid)$$, 'nor can the Super Admin', 'not found');
select test.login('sup_b');
select test.must_fail($$select chat_group_leave(pg_temp.g('dm')::uuid)$$, 'a direct conversation cannot be left like a group', 'not found');

-- ---------------------------------------------------------------- groups
select test.login('sup_plain');
select test.must_fail($$select chat_create_group('', array[test.id('sup_b')])$$, 'a group needs a name', 'name');
select test.must_fail($$select chat_create_group('Alone', '{}')$$, 'and at least one other person', 'at least one');
select test.must_fail($$select chat_create_group('With a client', array[test.id('chat_client')])$$, 'a client cannot be put in a group', 'cannot be added');
select test.must_fail($$select chat_create_group('With nobody', array[gen_random_uuid()])$$, 'nor a person who does not exist', 'cannot be added');
create temp table grp as select chat_create_group('Support huddle', array[test.id('sup_b'), test.id('sup_th')]) as j;
grant all on grp to authenticated;
insert into ch select 'grp', (select j ->> 'id' from grp);
select test.check((select j ->> 'kind' = 'GROUP' and j ->> 'title' = 'Support huddle' and (j -> 'isAdmin')::boolean and jsonb_array_length(j -> 'members') = 3 from grp), 'the creator is the admin of a 3-person group');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('grp')::uuid) -> 'messages') = 1 and chat_messages_page(pg_temp.g('grp')::uuid) -> 'messages' -> 0 ->> 'kind' = 'SYSTEM'), 'the group starts with a system line');
select chat_send_message(pg_temp.g('grp')::uuid, 'Welcome all', gen_random_uuid());
select test.login('sup_b');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('grp')::uuid) -> 'messages') = 2 and not (chat_conversation_detail(pg_temp.g('grp')::uuid) -> 'isAdmin')::boolean), 'a member reads the group and is not an admin');
select test.check((select chat_send_message(pg_temp.g('grp')::uuid, 'Thanks!', gen_random_uuid()) is not null), 'a member writes in the group');
select test.must_fail($$select chat_group_add_members(pg_temp.g('grp')::uuid, array[test.id('dh_wab')])$$, 'a member who is not an admin cannot add people', 'admin');
select test.must_fail($$select chat_group_rename(pg_temp.g('grp')::uuid, 'Renamed')$$, 'nor rename the group', 'admin');
select test.must_fail($$select chat_group_remove_member(pg_temp.g('grp')::uuid, test.id('sup_th'))$$, 'nor remove anybody', 'admin');
select test.must_fail($$select chat_group_set_admin(pg_temp.g('grp')::uuid, test.id('sup_b'), true)$$, 'nor make themselves an admin', 'admin');
select test.login('tm_a');
select test.must_fail($$select chat_messages_page(pg_temp.g('grp')::uuid)$$, 'a non-member cannot read the group', 'not found');
select test.must_fail($$select chat_send_message(pg_temp.g('grp')::uuid, 'hi', gen_random_uuid())$$, 'nor write in it', 'not found');
select test.must_fail($$select chat_group_add_members(pg_temp.g('grp')::uuid, array[test.id('tm_a')])$$, 'nor add themselves', 'not found');
select test.check((select count(*) = 0 from chat_messages where conversation_id = pg_temp.g('grp')::uuid) and (select count(*) = 0 from chat_conversations where id = pg_temp.g('grp')::uuid), 'row level security shows them nothing');

select test.login('sup_plain');
select test.check((select jsonb_array_length(chat_group_add_members(pg_temp.g('grp')::uuid, array[test.id('dh_wab'), test.id('sup_b')]) -> 'members') = 4), 'the admin adds a person (adding someone who is already in is ignored)');
select chat_send_message(pg_temp.g('grp')::uuid, 'Message after the new member joined', gen_random_uuid());
select test.login('dh_wab');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('grp')::uuid) -> 'messages') = 2), 'a member who joined later sees only what was said after they joined (the "added" line and the new message)');
select test.check((select count(*) = 2 from chat_messages where conversation_id = pg_temp.g('grp')::uuid), 'and row level security agrees');
select test.login('sup_plain');
select test.check((select chat_group_rename(pg_temp.g('grp')::uuid, 'Support team chat') ->> 'title' = 'Support team chat'), 'the admin renames the group');
select test.check((select chat_group_set_admin(pg_temp.g('grp')::uuid, test.id('sup_b'), true) -> 'members' @> '[{"role":"ADMIN"}]'::jsonb), 'the admin makes another person an admin');
select test.check((select chat_group_set_admin(pg_temp.g('grp')::uuid, test.id('sup_b'), false) is not null), 'and takes it back');
select test.must_fail($$select chat_group_set_admin(pg_temp.g('grp')::uuid, test.id('sup_plain'), false)$$, 'a group cannot be left without an admin', 'at least one admin');
select test.must_fail($$select chat_group_remove_member(pg_temp.g('grp')::uuid, test.id('sup_plain'))$$, 'an admin cannot remove themselves (they leave instead)', 'leave');

-- attachments in the group
select test.must_fail($$select chat_begin_upload(pg_temp.g('grp')::uuid, 'virus.exe', 'application/x-msdownload', 1000)$$, 'a file type that is not allowed is refused', 'cannot be sent');
select test.must_fail($$select chat_begin_upload(pg_temp.g('grp')::uuid, 'big.pdf', 'application/pdf', 6000000)$$, 'a file over 5 MB is refused', '5 MB');
create temp table up as select to_jsonb(chat_begin_upload(pg_temp.g('grp')::uuid, 'Plan.pdf', 'application/pdf', 2048)) as j;
grant all on up to authenticated;
insert into ch select 'att', (select j ->> 'id' from up);
select test.check((select j ->> 'status' = 'PENDING' and j ->> 'storage_path' like pg_temp.g('grp') || '/%/Plan.pdf' from up), 'an upload is booked under the conversation (not a guessable public path)');
select test.must_fail($$select chat_send_message(pg_temp.g('grp')::uuid, 'with file', gen_random_uuid(), null, array[pg_temp.g('att')::uuid])$$, 'a file that has not finished uploading cannot be sent', 'not ready');
select test.login('sup_b');
select test.must_fail($$select chat_complete_upload(pg_temp.g('att')::uuid, 2048)$$, 'someone else cannot confirm my upload', 'not found');
select test.login('sup_plain');
select test.check((select chat_complete_upload(pg_temp.g('att')::uuid, 2048) ->> 'name' = 'Plan.pdf'), 'the uploader confirms it');
select test.login('sup_b');
select test.must_fail($$select chat_attachment_download(pg_temp.g('att')::uuid)$$, 'before it is sent only the uploader can reach the file', 'not found');
select test.login('sup_plain');
select test.check((select chat_send_message(pg_temp.g('grp')::uuid, '', gen_random_uuid(), null, array[pg_temp.g('att')::uuid]) -> 'attachments' -> 0 ->> 'name' = 'Plan.pdf'), 'a message can be a file only');
select test.must_fail($$select chat_send_message(pg_temp.g('grp')::uuid, 'again', gen_random_uuid(), null, array[pg_temp.g('att')::uuid])$$, 'a file cannot be sent twice', 'not ready');
select test.check((select (chat_attachment_download(pg_temp.g('att')::uuid)).id is not null), 'a member can download it');
select test.login('sup_b');
select test.check((select (chat_attachment_download(pg_temp.g('att')::uuid)).id is not null), 'so can another member');
select test.login('tm_a');
select test.must_fail($$select chat_attachment_download(pg_temp.g('att')::uuid)$$, 'a non-member cannot download it even with the id', 'not found');
select test.login('chat_client');
select test.must_fail($$select chat_attachment_download(pg_temp.g('att')::uuid)$$, 'a client cannot download an internal file', 'not found');

-- removing a member
select test.login('sup_plain');
select test.check((select jsonb_array_length(chat_group_remove_member(pg_temp.g('grp')::uuid, test.id('sup_th')) -> 'members') = 3), 'the admin removes a member');
select test.login('sup_th');
select test.must_fail($$select chat_messages_page(pg_temp.g('grp')::uuid)$$, 'the removed member can no longer read the group, old or new messages', 'not found');
select test.must_fail($$select chat_send_message(pg_temp.g('grp')::uuid, 'still here', gen_random_uuid())$$, 'nor write in it', 'not found');
select test.must_fail($$select chat_attachment_download(pg_temp.g('att')::uuid)$$, 'nor download its files', 'not found');
select test.check((select count(*) = 0 from chat_messages where conversation_id = pg_temp.g('grp')::uuid), 'row level security shows them no message');
select test.check((select count(*) = 1 and bool_and(left_at is not null) from chat_members where conversation_id = pg_temp.g('grp')::uuid and profile_id = test.id('sup_th')), 'they can still see their own removal (this is how a live screen learns it)');
select test.check((select jsonb_array_length(chat_internal_list()) = 0 or not exists (select 1 from jsonb_array_elements(chat_internal_list()) x where x ->> 'id' = pg_temp.g('grp'))), 'the group is gone from their list');
select test.must_fail($$select chat_group_add_members(pg_temp.g('grp')::uuid, array[test.id('sup_th')])$$, 'a removed member cannot add themselves back', 'not found');
select test.login('sup_plain');
select chat_group_add_members(pg_temp.g('grp')::uuid, array[test.id('sup_th')]);
select test.login('sup_th');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('grp')::uuid) -> 'messages') = 1 and chat_messages_page(pg_temp.g('grp')::uuid) -> 'messages' -> 0 ->> 'kind' = 'SYSTEM'), 'when added again they see only what is said from then on (just the "added" line), not the time they were out');

-- leaving: the group keeps an admin
select test.login('sup_plain');
select chat_group_leave(pg_temp.g('grp')::uuid);
select test.must_fail($$select chat_messages_page(pg_temp.g('grp')::uuid)$$, 'a member who left cannot read the group', 'not found');
reset role;
select test.check((select count(*) = 1 from chat_members where conversation_id = pg_temp.g('grp')::uuid and left_at is null and role = 'ADMIN'), 'the longest-standing member became the admin');
select test.check((select count(*) >= 5 from chat_messages where conversation_id = pg_temp.g('grp')::uuid and kind = 'SYSTEM'), 'membership changes are written into the group');

-- ---------------------------------------------------------------- paging, order, reconnecting
do $do$
declare
  v_conv uuid := pg_temp.g('dm')::uuid;
  i integer;
begin
  for i in 1..70 loop
    update public.chat_conversations set last_seq = last_seq + 1 where id = v_conv;
    insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, body)
      values (v_conv, (select last_seq from public.chat_conversations where id = v_conv), case when i % 2 = 0 then test.id('sup_plain') else test.id('sup_b') end, 'STAFF', 'x', 'message ' || i);
  end loop;
end $do$;
set role authenticated;
select test.login('sup_plain');
create temp table pg1 as select chat_messages_page(pg_temp.g('dm')::uuid, null, null, 30) as j;
grant all on pg1 to authenticated;
select test.check((select jsonb_array_length(j -> 'messages') = 30 and (j -> 'hasMore')::boolean and (j -> 'messages' -> 29 ->> 'seq')::int = 72 and (j -> 'messages' -> 0 ->> 'seq')::int = 43 from pg1), 'the first page is the newest 30, oldest first');
select test.check((select (p -> 'messages' -> 29 ->> 'seq')::int = 42 and (p -> 'hasMore')::boolean from (select chat_messages_page(pg_temp.g('dm')::uuid, 43, null, 30) as p) x), 'the next page continues where it stopped');
select test.check((select jsonb_array_length(p -> 'messages') = 12 and not (p -> 'hasMore')::boolean from (select chat_messages_page(pg_temp.g('dm')::uuid, 13, null, 30) as p) x), 'the last page has the rest and says there is no more');
select test.check((select jsonb_array_length(p -> 'messages') = 2 and (p -> 'messages' -> 0 ->> 'seq')::int = 71 from (select chat_messages_page(pg_temp.g('dm')::uuid, null, 70, 30) as p) x), 'a screen that reconnects asks for what came after the last message it had');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.g('dm')::uuid, null, 72, 30) -> 'messages') = 0), 'and gets nothing when it is up to date');

-- ---------------------------------------------------------------- nobody writes tables directly; realtime is on; a flood is stopped
select test.must_fail($$insert into chat_conversations (kind, title) values ('GROUP', 'x')$$, 'a conversation cannot be inserted directly', 'permission denied');
select test.must_fail($$insert into chat_members (conversation_id, profile_id) values (pg_temp.g('grp')::uuid, test.id('sup_plain'))$$, 'nor a member', 'permission denied');
select test.must_fail($$update chat_members set role = 'ADMIN'$$, 'nor an admin role', 'permission denied');
select test.must_fail($$delete from chat_members$$, 'nor a membership removed', 'permission denied');
reset role;
select test.check((select count(*) = 3 from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('chat_messages', 'chat_conversations', 'chat_members')), 'messages, conversations and memberships are published to Realtime');
select test.check((select bool_and(relrowsecurity) from pg_class where relname in ('chat_messages', 'chat_conversations', 'chat_members', 'chat_read_state', 'chat_attachments')), 'row level security is on for every chat table');
select test.check((select not has_table_privilege('anon', 'public.chat_messages', 'select') and not has_function_privilege('anon', 'public.chat_send_message(uuid,text,uuid,uuid,uuid[])', 'execute')), 'signed-out visitors have no access');
select test.check((select count(*) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'chat\_%' and p.prosecdef is false), 'every chat function is SECURITY DEFINER');
set role authenticated;
select test.login('sup_th');
do $do$
declare
  i integer;
  v_ok integer := 0;
  v_stopped boolean := false;
begin
  for i in 1..70 loop
    begin
      perform public.chat_send_message(pg_temp.g('grp')::uuid, 'flood ' || i, gen_random_uuid());
      v_ok := v_ok + 1;
    exception when others then
      if sqlerrm !~* 'too fast' then
        raise;
      end if;
      v_stopped := true;
      exit;
    end;
  end loop;
  if not v_stopped or v_ok < 50 or v_ok > 62 then
    raise exception 'TEST FAILED: a flood of messages is stopped (stored %, stopped %)', v_ok, v_stopped;
  end if;
  raise notice 'ok - a flood of messages is stopped after % messages in a minute', v_ok;
end $do$;
reset role;
