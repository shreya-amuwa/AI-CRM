-- =============================================================================
-- Shared client chat and tickets (migration 20270129000100).
-- A Wabastore customer of the Support member sup_plain (the Relationship Manager, RM) with a client login. sup_b is another Support member of the same
-- department (the covering colleague), sup_th the Support Team Lead, dh_wab the Department Head, tm_a a Sales member of the department and tds_x1 a Support
-- member of another department (both refused).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 140. Shared client chat and tickets'
reset role;
\i supabase/migrations/20270129000100_shared_client_support_access.sql
\i supabase/migrations/20270129000100_shared_client_support_access.sql

-- a re-run starts clean
delete from customer_client_accounts where email = 'shr.client@example.com';
delete from auth.users where email = 'shr.client@example.com';
delete from test.users where name = 'shr_client';
delete from customers where phone = '9000000601';
update access_settings set support_desk_department_wide = true where id;
create or replace function test.must_fail_state(p_sql text, p_label text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise exception 'TEST FAILED: % (SQLSTATE % instead of %: %)', p_label, sqlstate, p_state, sqlerrm; end if;
    raise notice 'ok - % [%]', p_label, sqlstate;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;
grant execute on function test.must_fail_state(text, text, text) to anon, authenticated, service_role;
create temp table sh (k text primary key, v text);
grant all on sh to authenticated, service_role, anon;
create function pg_temp.sv(p_k text) returns text language sql stable as $$ select v from sh where k = p_k $$;
grant execute on function pg_temp.sv(text) to authenticated, anon;

set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000601","name":"Shared Client","businessName":"Shared Traders (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean),
  'setup: a Support customer of sup_plain');
reset role;
insert into sh select 'cust', id::text from customers where phone = '9000000601';
select test.create_auth_user('shr_client', 'shr.client@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', pg_temp.sv('cust')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values (pg_temp.sv('cust')::uuid, test.id('shr_client'), 'shr.client@example.com');
select test.check(private.support_member_of(pg_temp.sv('cust')::uuid) = test.id('sup_plain'), 'fixture: the Relationship Manager is sup_plain');
select test.check((select count(*) = 0 from chat_members m join chat_conversations c on c.id = m.conversation_id where c.customer_id = pg_temp.sv('cust')::uuid),
  'fixture: nobody was added to this client by hand (sup_b is covered only by the shared desk)');

set role authenticated;
select test.login('shr_client');
insert into sh select 'conv', chat_client_conversation() ->> 'id';
select chat_send_message(pg_temp.sv('conv')::uuid, 'Hello, I need help with my plan', '66666666-6666-6666-6666-666666666601');
insert into sh select 'tk', client_create_ticket('Plan question', 'Which plan am I on?', 'BILLING') ->> 'id';

\echo '   1. client chat: the RM works as before'
select test.login('sup_plain');
select test.check((select chat_customer_conversation(pg_temp.sv('cust')::uuid) ->> 'id' = pg_temp.sv('conv')), 'the Relationship Manager opens the client conversation');
select chat_send_message(pg_temp.sv('conv')::uuid, 'RM here, one moment', '66666666-6666-6666-6666-666666666602');

\echo '   2. client chat: the covering colleague reads the history and replies as themselves'
select test.login('sup_b');
select test.check((select chat_customer_conversation(pg_temp.sv('cust')::uuid) ->> 'id' = pg_temp.sv('conv')), 'a Support colleague of the department opens the client conversation');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.sv('conv')::uuid) -> 'messages') = 2), 'and reads the whole history (the client''s message and the RM''s)');
select test.check((select count(*) = 1 from jsonb_array_elements(chat_desk_clients()) d
                    where (d ->> 'customerId')::uuid = pg_temp.sv('cust')::uuid and d -> 'rm' ->> 'name' = 'Support Member' and d -> 'handler' ->> 'name' = 'Support Member'
                      and not (d -> 'handler' ->> 'me')::boolean and (d ->> 'awaitingReply')::boolean = false and d ->> 'role' = 'Support desk'),
  'the desk list shows the customer, the assigned RM, the RM as the one handling (they answered last) and that nobody is waiting for a reply');
insert into sh select 'm1', chat_send_message(pg_temp.sv('conv')::uuid, 'Hi, I am covering for your manager', '66666666-6666-6666-6666-666666666603') ->> 'id';
select chat_send_message(pg_temp.sv('conv')::uuid, 'I checked: you are on the Growth plan', '66666666-6666-6666-6666-666666666604');
reset role;
select test.check((select sender_id = test.id('sup_b') and sender_kind = 'STAFF' and sender_name = 'Support B' and sender_label = 'Support Team'
                     from chat_messages where id = pg_temp.sv('m1')::uuid),
  'the message is stored with the covering employee''s own identity, labelled Support Team (not Relationship Manager)');
select test.check(private.support_member_of(pg_temp.sv('cust')::uuid) = test.id('sup_plain') and private.support_lead_of(pg_temp.sv('cust')::uuid) = test.id('sup_th')
                  and (select count(*) = 0 from chat_members where conversation_id = pg_temp.sv('conv')::uuid),
  'the Relationship Manager and the Team Lead are not changed, and nobody was added as a member');
select test.check((select handling_by = test.id('sup_b') and handling_at > now() - interval '1 minute' from chat_conversations where id = pg_temp.sv('conv')::uuid),
  'replying makes sup_b the one handling the chat');
select test.check((select count(*) = 1 from notifications where type = 'CHAT_COVER_REPLY' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.sv('conv')::uuid),
  'the RM is told once that a colleague answered their client (the second reply does not add a bell)');
select test.check((select count(*) = 0 from notifications where type = 'CHAT_COVER_REPLY' and recipient_id = test.id('sup_b')), 'nobody is notified of their own reply');
select test.check((select count(*) = 0 from notifications where type = 'CHAT_COVER_REPLY' and recipient_id <> test.id('sup_plain')), 'and the bell goes to the RM only (no flood)');

\echo '   3. the RM and the others see who is handling it; the client does not'
set role authenticated;
select test.login('sup_plain');
select test.check((select count(*) = 1 from jsonb_array_elements(chat_desk_clients()) d
                    where (d ->> 'customerId')::uuid = pg_temp.sv('cust')::uuid and d -> 'handler' ->> 'name' = 'Support B' and (d -> 'handler' ->> 'active')::boolean
                      and d ->> 'role' = 'Relationship Manager' and (d ->> 'unread')::int >= 1 and d ->> 'lastSenderName' = 'Support B'),
  'the RM sees that Support B is handling it, the last responder and that there is something unread');
select test.check((select chat_customer_conversation(pg_temp.sv('cust')::uuid) -> 'handler' ->> 'name' = 'Support B'), 'the conversation itself carries the handler');
select test.login('shr_client');
select test.check((select coalesce(chat_client_conversation() -> 'handler', 'null'::jsonb) = 'null'::jsonb), 'the client''s conversation carries no handler');
select test.check((select count(*) = 1 from jsonb_array_elements(chat_messages_page(pg_temp.sv('conv')::uuid) -> 'messages') m
                    where m ->> 'senderName' = 'Support B' and m ->> 'senderLabel' = 'Support Team' and m ->> 'senderKind' = 'STAFF' and m ->> 'body' like 'Hi, I am covering%'),
  'the client reads the reply from Support B, labelled Support Team');
select chat_send_message(pg_temp.sv('conv')::uuid, 'Thank you, that helps', '66666666-6666-6666-6666-666666666605');
select chat_send_message(pg_temp.sv('conv')::uuid, 'One more question', '66666666-6666-6666-6666-666666666606');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id('sup_b') and entity_id = pg_temp.sv('conv')::uuid)
                  and (select count(*) = 0 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id in (test.id('tm_a'), test.id('tds_x1'))),
  'the client''s next messages notify the colleague who is handling the chat once (not once per message), and nobody outside the Support team of the customer');
select test.check((select count(*) = 2 from notifications where type = 'CHAT_CLIENT_MESSAGE' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.sv('conv')::uuid),
  'the Relationship Manager is still notified of the client''s messages: once for the first message and once for the two sent after they had read the chat (no bell per message)');
set role authenticated;
select test.login('sup_b');
select test.check((select count(*) = 1 from jsonb_array_elements(chat_desk_clients()) d where (d ->> 'customerId')::uuid = pg_temp.sv('cust')::uuid and (d ->> 'awaitingReply')::boolean),
  'after the client writes again the desk shows them as awaiting a reply');
select test.login('shr_client');
select test.must_fail($$select chat_desk_clients()$$, 'the client cannot list the desk', 'FORBIDDEN');
select test.must_fail_state(format($$select chat_set_handling('%s', 'TAKE')$$, pg_temp.sv('conv')), 'the client cannot mark themselves as handling', '42501');

\echo '   4. take over / release (information only)'
select test.login('sup_plain');
select test.check((select (chat_set_handling(pg_temp.sv('conv')::uuid, 'TAKE') ->> 'me')::boolean), 'the RM takes it back');
select test.login('sup_b');
select test.must_fail_state(format($$select chat_set_handling('%s', 'RELEASE')$$, pg_temp.sv('conv')), 'a colleague cannot release the RM''s hold', '42501');
select test.must_fail_state(format($$select chat_set_handling('%s', 'BOGUS')$$, pg_temp.sv('conv')), 'an unknown action is refused', 'P0001');
select test.check((select chat_set_handling(pg_temp.sv('conv')::uuid, 'TAKE') ->> 'name' = 'Support B'), 'a colleague can take over; nobody is locked out');
select test.login('sup_th');
select test.check((select chat_set_handling(pg_temp.sv('conv')::uuid, 'RELEASE') is null), 'the Team Lead can clear it (nobody is handling afterwards)');
reset role;
select test.check((select handling_by is null from chat_conversations where id = pg_temp.sv('conv')::uuid), 'it is cleared');
select test.check((select count(*) = 3 from audit_logs where action in ('CHAT_HANDLING_TAKEN', 'CHAT_HANDLING_RELEASED') and entity_id = pg_temp.sv('conv')::uuid), 'taking and releasing are audited');

\echo '   5. client chat: who is still refused'
set role authenticated;
select test.login('tm_a');
select test.must_fail(format($$select chat_customer_conversation('%s')$$, pg_temp.sv('cust')), 'a Sales member of the department cannot open the chat', 'NOT_FOUND|FORBIDDEN|not found');
select test.must_fail(format($$select chat_send_message('%s', 'Hi', gen_random_uuid())$$, pg_temp.sv('conv')), 'nor write in it', 'NOT_FOUND');
select test.must_fail(format($$select chat_messages_page('%s')$$, pg_temp.sv('conv')), 'nor read it', 'NOT_FOUND');
select test.check((select chat_desk_clients() = '[]'::jsonb), 'and their desk list is empty');
select test.must_fail_state(format($$select chat_set_handling('%s', 'TAKE')$$, pg_temp.sv('conv')), 'nor mark themselves as handling', '42501');
select test.login('tds_x1');
select test.must_fail(format($$select chat_customer_conversation('%s')$$, pg_temp.sv('cust')), 'a Support member of another department cannot open the chat', 'NOT_FOUND|FORBIDDEN|not found');
select test.must_fail(format($$select chat_send_message('%s', 'Hi', gen_random_uuid())$$, pg_temp.sv('conv')), 'nor write in it', 'NOT_FOUND');
select test.check((select count(*) = 0 from jsonb_array_elements(chat_desk_clients()) d where (d ->> 'customerId')::uuid = pg_temp.sv('cust')::uuid), 'and this customer is not on their desk list (it lists their own department only)');
select test.login('dh_wab');
select test.must_fail_state(format($$select chat_send_message('%s', 'As DH', gen_random_uuid())$$, pg_temp.sv('conv')), 'the Department Head stays a reader: no writing', '42501');
select test.check((select jsonb_array_length(chat_messages_page(pg_temp.sv('conv')::uuid) -> 'messages') >= 4), 'but still reads');
select test.login('sup_b');
select test.check((select chat_desk_clients() <> '[]'::jsonb), 'sanity: the covering colleague still sees the desk');
reset role;
update access_settings set support_desk_department_wide = false where id;
set role authenticated;
select test.must_fail(format($$select chat_customer_conversation('%s')$$, pg_temp.sv('cust')), 'with the desk switch off the colleague cannot open the chat', 'NOT_FOUND|FORBIDDEN|not found');
select test.check((select chat_desk_clients() = '[]'::jsonb), 'their desk list is empty');
select test.login('sup_plain');
select test.check((select chat_customer_conversation(pg_temp.sv('cust')::uuid) ->> 'id' = pg_temp.sv('conv')), 'the RM is unaffected by the switch');
reset role;
update access_settings set support_desk_department_wide = true where id;
update profiles set status = 'SUSPENDED' where id = test.id('sup_b');
set role authenticated;
select test.login('sup_b');
select test.must_fail(format($$select chat_send_message('%s', 'Suspended', gen_random_uuid())$$, pg_temp.sv('conv')), 'a suspended colleague cannot write at once', 'NOT_FOUND|FORBIDDEN|not found');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('sup_b');

\echo '   6. tickets: the covering colleague reads and replies, but does not manage'
set role authenticated;
select test.login('sup_b');
select test.check((select count(*) = 0 from support_tickets where id = pg_temp.sv('tk')::uuid) and (select count(*) = 0 from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid),
  'the ticket tables stay as narrow as before: the colleague does not read them directly (their own lists and counts do not change)');
select test.check((select count(*) = 1 from jsonb_array_elements(desk_tickets() -> 'tickets') t where t ->> 'id' = pg_temp.sv('tk') and not (t ->> 'manageable')::boolean and (t ->> 'via_desk')::boolean
                          and t ->> 'assignee_name' = 'Support Member'),
  'but the shared desk lists the customer''s ticket for them: not manageable by them, with the assigned RM''s name');
select test.check((select count(*) >= 1 from jsonb_array_elements(desk_tickets() -> 'updates') u where u ->> 'ticket_id' = pg_temp.sv('tk')) and
                  (select count(*) = 1 from jsonb_array_elements(desk_tickets() -> 'customers') c where c ->> 'id' = pg_temp.sv('cust')), 'with its history and the customer');
reset role;
select test.check((select assignee_id = test.id('sup_plain') and status = 'OPEN' and escalation_level = 'RM' from support_tickets where id = pg_temp.sv('tk')::uuid),
  'fixture: the ticket is assigned to the RM, open, at RM level');
insert into sh select 'prio', priority from support_tickets where id = pg_temp.sv('tk')::uuid;
insert into sh select 'n_before', count(*)::text from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid;
set role authenticated;
select test.login('sup_b');
select send_ticket_message(pg_temp.sv('tk')::uuid, 'Hello, I am covering for your manager. You are on the Growth plan.', false, gen_random_uuid());
select send_ticket_message(pg_temp.sv('tk')::uuid, 'Internal: customer is on a legacy price, do not quote the new one', true, gen_random_uuid());
reset role;
select test.check((select author_id = test.id('sup_b') and client_visible and not client_author and kind = 'NOTE'
                     from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid and note like 'Hello, I am covering%'),
  'the reply is stored under the authenticated employee, visible to the customer');
select test.check((select author_id = test.id('sup_b') and not client_visible from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid and note like 'Internal:%'),
  'the internal note is stored under them and is not customer-visible');
select test.check((select assignee_id = test.id('sup_plain') and status = 'OPEN' and escalation_level = 'RM' and priority = pg_temp.sv('prio') and escalated_to is null
                          and handling_by = test.id('sup_b') and first_response_at is not null
                     from support_tickets where id = pg_temp.sv('tk')::uuid),
  'the reply changed neither assignee, status, level nor priority; it records Support B as handling and the first response');
select test.check((select count(*) = pg_temp.sv('n_before')::int + 2 from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid), 'history only grew');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_STAFF_REPLY' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.sv('tk')::uuid)
                  and (select count(*) = 1 from notifications where type = 'TICKET_NOTE' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.sv('tk')::uuid),
  'the assignee (RM) is notified of the reply and of the note');

\echo '   7. tickets: the customer never sees internal notes'
set role authenticated;
select test.login('shr_client');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket(pg_temp.sv('tk')::uuid) -> 'updates') u where u ->> 'message' like 'Hello, I am covering%' and u ->> 'author' = 'Support B'),
  'the customer sees the reply, under Support B''s name');
select test.check((select position('legacy price' in client_ticket(pg_temp.sv('tk')::uuid)::text) = 0 and position('Internal:' in client_ticket(pg_temp.sv('tk')::uuid)::text) = 0
                          and position('legacy price' in client_tickets()::text) = 0),
  'but nowhere the internal note (not in the ticket, not in the list)');
select test.check((select count(*) = 0 from support_ticket_updates), 'the customer reads no row of the updates table (internal notes live there)');
select test.check((select count(*) = 0 from support_tickets), 'nor of the tickets table');
select test.must_fail($$select desk_tickets()$$, 'nor the ticket desk', 'FORBIDDEN');
select test.must_fail(format($$select ticket_set_handling('%s', 'TAKE')$$, pg_temp.sv('tk')), 'nor take a ticket', 'Ticket not found');

\echo '   8. tickets: no management rights come with shared access'
select test.login('sup_b');
select test.must_fail(format($$select update_support_ticket('%s', 'RESOLVED', 'Fixed', null)$$, pg_temp.sv('tk')), 'the colleague cannot change the status', 'Ticket not found');
select test.must_fail(format($$select set_ticket_priority('%s', 'URGENT')$$, pg_temp.sv('tk')), 'nor the priority', 'Ticket not found');
select test.must_fail(format($$select escalate_support_ticket('%s', 'Please')$$, pg_temp.sv('tk')), 'nor escalate it', 'Ticket not found');
select test.must_fail_state(format($$select assign_support_ticket('%s', '%s', null)$$, pg_temp.sv('tk'), test.id('sup_b')), 'nor assign it to themselves', '42501');
select test.check((select jsonb_typeof(ticket_attachments(pg_temp.sv('tk')::uuid)) = 'array'), 'the colleague can open the ticket''s file list (the same permission as reading the ticket)');
select test.check((select count(*) = 1 from jsonb_array_elements(desk_tickets() -> 'tickets') t where t ->> 'id' = pg_temp.sv('tk') and t ->> 'handler_name' = 'Support B'),
  'the desk data shows who is handling the ticket');
select test.check((select count(*) = 1 from jsonb_array_elements(desk_tickets() -> 'updates') u where u ->> 'author_name' = 'Support B' and u ->> 'note' like 'Internal:%' and not (u ->> 'client_visible')::boolean),
  'and the covering colleague''s own internal note, under their name (employees only)');
select test.check((select (ticket_set_handling(pg_temp.sv('tk')::uuid, 'TAKE') ->> 'me')::boolean), 'the colleague can mark that they are handling it');
select test.login('sup_plain');
select test.check((select ticket_set_handling(pg_temp.sv('tk')::uuid, 'RELEASE') is null), 'the assignee can release it');
select test.login('sup_th');
select update_support_ticket(pg_temp.sv('tk')::uuid, 'IN_PROGRESS', 'Looking into it', null);
select test.check((select status = 'IN_PROGRESS' from support_tickets where id = pg_temp.sv('tk')::uuid), 'the Team Lead still manages the ticket as before');
select test.login('sup_plain');
select escalate_support_ticket(pg_temp.sv('tk')::uuid, 'Needs the lead');
reset role;
select test.check((select escalation_level = 'TL' and assignee_id = test.id('sup_plain') and escalated_to is not null from support_tickets where id = pg_temp.sv('tk')::uuid),
  'the RM -> Team Lead escalation still works and the history of the colleague''s reply is kept');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid and note like 'Hello, I am covering%'), 'the colleague''s reply is still in the history');

\echo '   9. tickets: who is still refused'
set role authenticated;
select test.login('tm_a');
select test.check((select count(*) = 0 from support_tickets where id = pg_temp.sv('tk')::uuid), 'a Sales member of the department does not see the ticket');
select test.check((select count(*) = 0 from support_ticket_updates where ticket_id = pg_temp.sv('tk')::uuid), 'nor its history');
select test.check((select desk_tickets() -> 'tickets' = '[]'::jsonb), 'and the shared desk is empty for them');
select test.must_fail(format($$select ticket_attachments('%s')$$, pg_temp.sv('tk')), 'nor can they list its files', 'not found');
select test.must_fail(format($$select send_ticket_message('%s', 'Hi', false)$$, pg_temp.sv('tk')), 'nor reply', 'Ticket not found');
select test.login('tds_x1');
select test.check((select count(*) = 0 from support_tickets where id = pg_temp.sv('tk')::uuid)
                  and (select count(*) = 0 from jsonb_array_elements(desk_tickets() -> 'tickets') t where t ->> 'id' = pg_temp.sv('tk')), 'a Support member of another department does not see the ticket (nor on their desk)');
select test.must_fail(format($$select send_ticket_message('%s', 'Hi', false)$$, pg_temp.sv('tk')), 'nor reply', 'Ticket not found');
select test.must_fail(format($$select ticket_set_handling('%s', 'TAKE')$$, pg_temp.sv('tk')), 'nor mark themselves as handling it', 'Ticket not found');
reset role;
update access_settings set support_desk_department_wide = false where id;
set role authenticated;
select test.login('sup_b');
select test.check((select desk_tickets() -> 'tickets' = '[]'::jsonb), 'with the desk switch off the colleague has no shared tickets');
select test.must_fail(format($$select send_ticket_message('%s', 'Hi', false)$$, pg_temp.sv('tk')), 'nor reply', 'Ticket not found');
reset role;
update access_settings set support_desk_department_wide = true where id;

\echo '   10. anonymous callers'
set role anon;
select test.must_fail_state($$select chat_desk_clients()$$, 'anonymous: the desk list', '42501');
select test.must_fail_state(format($$select chat_set_handling('%s', 'TAKE')$$, pg_temp.sv('conv')), 'anonymous: chat handling', '42501');
select test.must_fail_state(format($$select ticket_set_handling('%s', 'TAKE')$$, pg_temp.sv('tk')), 'anonymous: ticket handling', '42501');
select test.must_fail_state($$select desk_tickets()$$, 'anonymous: the ticket desk', '42501');
reset role;
