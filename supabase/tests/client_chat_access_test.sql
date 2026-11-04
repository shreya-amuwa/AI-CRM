-- =============================================================================
-- Client conversations for the assigned Team Member and the assigned Team Member's own Team Lead (migration 20261223000200).
-- Reuses the people of team_lead_ownership_test.sql (prefix tlo_): TWO Team Leads (lA, lB) share one Support team, mA is lA's member, mB is lB's,
-- mX works in another department, tm_a is a Sales Team Member.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 121. Client chat: the assigned Team Member and Team Lead reach the conversation, nobody else'
reset role;
\i supabase/migrations/20261223000100_team_lead_ownership.sql
\i supabase/migrations/20261223000200_client_chat_access.sql
\i supabase/migrations/20261223000200_client_chat_access.sql

-- (the ownership test ends with mA transferred to lB: put mA back with lA, as set up there at the start)
update public.profiles set manager_id = test.id('tlo_lA') where id = test.id('tlo_mA');
delete from public.customers where company like 'TLO Chat %';
create temp table tcc (name text primary key, id uuid);
grant all on tcc to authenticated, service_role;
-- support customers: owned by the Team Member who looks after them (no hand-over record: the member is the owner, the lead is that member's lead)
insert into public.customers (owner_id, name, company, phone, lifecycle_stage, department_id, team_id)
select test.id(v.owner), 'Chat ' || v.n, 'TLO Chat ' || v.n, '98199' || v.phone, 'CUSTOMER', p.department_id, p.team_id
  from (values ('tlo_mA', 'A', '08001'), ('tlo_mB', 'B', '08002')) v(owner, n, phone) join public.profiles p on p.id = test.id(v.owner);
insert into tcc select 'A', id from public.customers where company = 'TLO Chat A';
insert into tcc select 'B', id from public.customers where company = 'TLO Chat B';
select test.check((select count(*) = 2 from tcc), 'two support customers exist');
select test.check(private.support_member_of((select id from tcc where name = 'A')) = test.id('tlo_mA') and private.support_lead_of((select id from tcc where name = 'A')) = test.id('tlo_lA'),
  'customer A: Team Member mA, Team Lead lA (mA''s own lead)');
select test.check(private.support_member_of((select id from tcc where name = 'B')) = test.id('tlo_mB') and private.support_lead_of((select id from tcc where name = 'B')) = test.id('tlo_lB'),
  'customer B: Team Member mB, Team Lead lB - NOT "the first Team Lead of the team" (lA)');

set role authenticated;
\echo '   the tab: shown for the people who can have clients, decided by the server'
select test.login('tlo_lB');
select test.check((select (chat_client_tab() ->> 'eligible')::boolean and (chat_client_tab() ->> 'count')::int = 1 from (select 1) z), 'Team Lead B has the tab and one customer');
select test.login('tlo_lA');
select test.check((select (chat_client_tab() ->> 'eligible')::boolean and (chat_client_tab() ->> 'count')::int = 1 from (select 1) z), 'Team Lead A has the tab and one customer (hers)');
select test.login('tlo_mA2');
select test.check((select (chat_client_tab() ->> 'eligible')::boolean and (chat_client_tab() ->> 'count')::int = 0 from (select 1) z), 'a Team Member with no customer yet still gets the tab (an empty state, not a missing section)');
select test.login('tm_a');
select test.check((select not (chat_client_tab() ->> 'eligible')::boolean from (select 1) z), 'a Sales Team Member has no client conversations tab');
select test.login('tlo_mX');
select test.check((select not (chat_client_tab() ->> 'eligible')::boolean or (chat_client_tab() ->> 'count')::int = 0 from (select 1) z), 'another department''s member has none of these customers');

\echo '   who sees which client'
select test.login('tlo_mA');
select test.check((select count(*) = 1 and bool_and(x ->> 'name' = 'Chat A' and x ->> 'role' = 'Relationship Manager') from jsonb_array_elements(chat_my_clients()) x), 'Team Member A sees exactly customer A, as Relationship Manager');
insert into tcc select 'convA', (chat_customer_conversation((select id from tcc where name = 'A')) ->> 'id')::uuid;
select test.check((select chat_customer_conversation((select id from tcc where name = 'A')) ->> 'access') = 'STAFF', 'and opens its conversation with write access');
select test.login('tlo_lA');
select test.check((select count(*) = 1 and bool_and(x ->> 'name' = 'Chat A' and x ->> 'role' = 'Team Lead') from jsonb_array_elements(chat_my_clients()) x), 'Team Lead A sees customer A (not B), as Team Lead');
select test.check((select chat_customer_conversation((select id from tcc where name = 'A')) ->> 'access') = 'STAFF', 'and the SAME conversation, with write access');
select test.check((select (chat_customer_conversation((select id from tcc where name = 'A')) ->> 'id')::uuid = (select id from tcc where name = 'convA')), 'one thread, not a copy');
select test.must_fail(format($$select chat_customer_conversation('%s')$$, (select id from tcc where name = 'B')), 'Team Lead A cannot open customer B (another lead''s member)', 'NOT_FOUND|not found');
select test.login('tlo_lB');
select test.must_fail(format($$select chat_customer_conversation('%s')$$, (select id from tcc where name = 'A')), 'Team Lead B cannot open customer A', 'NOT_FOUND|not found');
select test.must_fail(format($$select chat_conversation_detail('%s')$$, (select id from tcc where name = 'convA')), 'nor read its conversation by id', 'NOT_FOUND|not found');
select test.login('tlo_mB');
select test.must_fail(format($$select chat_conversation_detail('%s')$$, (select id from tcc where name = 'convA')), 'nor can Team Member B', 'NOT_FOUND|not found');
select test.login('tlo_mX');
select test.must_fail(format($$select chat_conversation_detail('%s')$$, (select id from tcc where name = 'convA')), 'an unrelated employee cannot', 'NOT_FOUND|not found');
select test.login('tm_a');
select test.must_fail(format($$select chat_conversation_detail('%s')$$, (select id from tcc where name = 'convA')), 'nor Sales', 'NOT_FOUND|not found');

\echo '   writing: the Team Member and the Team Lead write into the same conversation'
select test.login('tlo_mA');
select test.check((select chat_send_message((select id from tcc where name = 'convA'), 'Hello from the Team Member', gen_random_uuid()) ->> 'senderKind') = 'STAFF', 'the Team Member writes');
select test.login('tlo_lA');
select test.check((select chat_send_message((select id from tcc where name = 'convA'), 'And the Team Lead replies', gen_random_uuid()) ->> 'senderKind') = 'STAFF', 'the Team Lead replies in the same thread');
select test.check((select count(*) = 2 from jsonb_array_elements(chat_messages_page((select id from tcc where name = 'convA')) -> 'messages') m where m ->> 'kind' = 'TEXT'), 'both messages are in the one conversation');
select test.login('tlo_lB');
select test.must_fail(format($$select chat_send_message('%s', 'I should not be here', gen_random_uuid())$$, (select id from tcc where name = 'convA')), 'the other Team Lead cannot write', 'NOT_FOUND|not found');

\echo '   escalation: share a client message with the customer''s own team, nobody else'
select test.login('tlo_mA');
select test.check((select array_agg(x ->> 'name' order by x ->> 'name') = array['TLO lA'] from jsonb_array_elements(chat_client_team((select id from tcc where name = 'convA'))) x), 'the people it can be shared with: the client''s Team Lead (not the other lead)');
reset role;
insert into tcc select 'msgA', id from public.chat_messages where conversation_id = (select id from tcc where name = 'convA') order by seq limit 1;
set role authenticated;
select test.login('tlo_mA');
select test.check((select chat_escalate_client_message((select id from tcc where name = 'convA'), (select id from tcc where name = 'msgA'), test.id('tlo_lA'), 'Please look at this one') ->> 'sentTo') = 'TLO lA', 'Team Member A shares a message with the Team Lead');
select test.must_fail(format($$select chat_escalate_client_message('%s', null, '%s', null)$$, (select id from tcc where name = 'convA'), test.id('tlo_lB')), 'not with the other Team Lead', 'Choose the client');
select test.must_fail(format($$select chat_escalate_client_message('%s', null, '%s', null)$$, (select id from tcc where name = 'convA'), test.id('tlo_mA')), 'not with themselves', 'Choose the client');
select test.must_fail(format($$select chat_escalate_client_message('%s', null, '%s', null)$$, (select id from tcc where name = 'convA'), test.id('tlo_mX')), 'not with an unrelated employee', 'Choose the client');
select test.login('tlo_mB');
select test.must_fail(format($$select chat_escalate_client_message('%s', null, '%s', null)$$, (select id from tcc where name = 'convA'), test.id('tlo_lA')), 'an employee without access cannot share it', 'NOT_FOUND|not found');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'CLIENT_MESSAGE_ESCALATED' and recipient_id = test.id('tlo_lA') and entity_type = 'chat' and entity_id = (select id from tcc where name = 'convA')), 'the Team Lead is notified, and the notification opens the conversation');
select test.check((select count(*) = 1 from notifications where type = 'CLIENT_MESSAGE_ESCALATED') and (select count(*) = 2 from chat_messages where conversation_id = (select id from tcc where name = 'convA') and kind = 'TEXT'),
  'nobody else was notified and the conversation and its messages are unchanged');
select test.check((select count(*) = 1 from audit_logs where action = 'CLIENT_MESSAGE_ESCALATED' and entity_id = (select id from tcc where name = 'A')), 'it is audited');

\echo '   reassignment and removal change access at once; history stays'
update public.customers set owner_id = test.id('tlo_mB') where id = (select id from tcc where name = 'A');
set role authenticated;
select test.login('tlo_mA');
select test.check((select jsonb_array_length(chat_my_clients()) = 0 from (select 1) z), 'customer A moved to Team Member B: Team Member A loses it immediately');
select test.must_fail(format($$select chat_conversation_detail('%s')$$, (select id from tcc where name = 'convA')), 'and cannot read the conversation any more', 'NOT_FOUND|not found');
select test.login('tlo_lA');
select test.check((select jsonb_array_length(chat_my_clients()) = 0 from (select 1) z), 'Team Lead A loses it too (the new member is Team Lead B''s)');
select test.login('tlo_lB');
select test.check((select count(*) = 2 from jsonb_array_elements(chat_my_clients())), 'Team Lead B now has both customers');
select test.check((select count(*) = 2 from jsonb_array_elements(chat_messages_page((select id from tcc where name = 'convA')) -> 'messages') m where m ->> 'kind' = 'TEXT'), 'the conversation history moved with the customer, intact');
reset role;
update public.profiles set status = 'SUSPENDED' where id = test.id('tlo_mB');
set role authenticated;
select test.login('tlo_mB');
select test.must_fail($$select chat_my_clients()$$, 'a suspended employee reaches nothing', 'Sign in|FORBIDDEN|NOT_FOUND');
reset role;
update public.profiles set status = 'ACTIVE' where id = test.id('tlo_mB');
