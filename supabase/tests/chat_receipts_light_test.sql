-- =============================================================================
-- Chat under load (migration 20261231000400): "delivered" and "seen" write only the person's own read state, never the conversation row
-- (whose every UPDATE is broadcast to every signed-in screen), and write nothing when nothing moves. The ticks still come out right.
-- Reuses the conversations made by chat_test.sql and client_support_groups_test.sql. Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 139. Chat under load: receipts without rewriting the conversation'
reset role;
\i supabase/migrations/20261231000400_chat_receipts_light.sql
\i supabase/migrations/20261231000400_chat_receipts_light.sql
create temp table rl (k text primary key, v text);
grant all on rl to authenticated;
-- a group conversation with messages: a member who did not send its last message, and that message's sender
insert into rl
select 'conv', c.id::text from chat_conversations c
 where c.kind = 'GROUP' and c.last_seq > 0
   and exists (select 1 from chat_messages m where m.conversation_id = c.id and m.seq = c.last_seq and m.sender_id is not null)
   and exists (select 1 from chat_members cm join profiles p on p.id = cm.profile_id
                where cm.conversation_id = c.id and cm.left_at is null and p.status = 'ACTIVE'
                  and cm.profile_id <> (select m.sender_id from chat_messages m where m.conversation_id = c.id and m.seq = c.last_seq))
 order by c.created_at limit 1;
insert into rl select 'seq', last_seq::text from chat_conversations where id = (select v from rl where k = 'conv')::uuid;
insert into rl select 'sender', m.sender_id::text from chat_messages m
 where m.conversation_id = (select v from rl where k = 'conv')::uuid and m.seq = (select v from rl where k = 'seq')::bigint;
insert into rl select 'member', cm.profile_id::text from chat_members cm join profiles p on p.id = cm.profile_id
 where cm.conversation_id = (select v from rl where k = 'conv')::uuid and cm.left_at is null and p.status = 'ACTIVE' and cm.profile_id::text <> (select v from rl where k = 'sender')
 order by cm.joined_at limit 1;
select test.check((select count(*) = 4 from rl), 'a group conversation with a message from someone else is available');
delete from chat_read_state where conversation_id = (select v from rl where k = 'conv')::uuid and user_id = (select v from rl where k = 'member')::uuid;
insert into rl select 'touched', updated_at::text from chat_conversations where id = (select v from rl where k = 'conv')::uuid;
create or replace function pg_temp.as_(p_who text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', (select v from rl where k = p_who), 'role', 'authenticated')::text, false) $$;
create or replace function pg_temp.rs_xmin() returns text language sql as $$
  select xmin::text from public.chat_read_state where conversation_id = (select v from rl where k = 'conv')::uuid and user_id = (select v from rl where k = 'member')::uuid $$;

set role authenticated;
select pg_temp.as_('member');
select test.check((select (chat_ack_delivered((select v from rl where k = 'conv')::uuid, (select v from rl where k = 'seq')::bigint) ->> 'deliveredSeq')::bigint
                          = (select v from rl where k = 'seq')::bigint), 'the receiving screen acknowledges the message');
reset role;
select test.check((select updated_at::text = (select v from rl where k = 'touched') from chat_conversations where id = (select v from rl where k = 'conv')::uuid),
  '"delivered" no longer rewrites the conversation row (no Realtime storm, no lock queue on one row)');
select test.check((select last_delivered_seq = (select v from rl where k = 'seq')::bigint from chat_read_state
                    where conversation_id = (select v from rl where k = 'conv')::uuid and user_id = (select v from rl where k = 'member')::uuid),
  'it is stored in the person''s own read state');
insert into rl select 'x1', pg_temp.rs_xmin();
set role authenticated;
select pg_temp.as_('member');
select chat_ack_delivered((select v from rl where k = 'conv')::uuid, (select v from rl where k = 'seq')::bigint);
reset role;
select test.check(pg_temp.rs_xmin() = (select v from rl where k = 'x1'), 'acknowledging the same message again writes nothing');
set role authenticated;
select pg_temp.as_('member');
select test.check((select (chat_mark_read((select v from rl where k = 'conv')::uuid, (select v from rl where k = 'seq')::bigint) ->> 'readSeq')::bigint
                          = (select v from rl where k = 'seq')::bigint), 'the person reads it');
reset role;
select test.check((select updated_at::text = (select v from rl where k = 'touched') from chat_conversations where id = (select v from rl where k = 'conv')::uuid),
  '"seen" does not rewrite the conversation row either');
insert into rl select 'x2', pg_temp.rs_xmin();
set role authenticated;
select pg_temp.as_('member');
select chat_mark_read((select v from rl where k = 'conv')::uuid, (select v from rl where k = 'seq')::bigint);
select chat_mark_read((select v from rl where k = 'conv')::uuid, 0);
reset role;
select test.check(pg_temp.rs_xmin() = (select v from rl where k = 'x2'), 'reading again (or an older position) writes nothing, and never goes back');
set role authenticated;
select pg_temp.as_('sender');
select test.check((select bool_or((r ->> 'delivered')::boolean and (r ->> 'seen')::boolean)
                     from jsonb_array_elements(chat_message_receipts((select v from rl where k = 'conv')::uuid, 0)) x, jsonb_array_elements(x -> 'recipients') r
                    where (x ->> 'seq')::bigint = (select v from rl where k = 'seq')::bigint),
  'the sender still sees the message delivered to and seen by that person');
reset role;
