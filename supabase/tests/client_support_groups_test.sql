-- =============================================================================
-- Client support groups and Sent / Delivered / Seen (migration 20261230000500).
-- A Wabastore customer of the Support member sup_plain with a client login; sup_b is another Wabastore Support member (added to the group);
-- tm_a is a Sales member and tds_x1 a Support member of another department (both refused).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 136. Client support groups and message status'
reset role;
\i supabase/migrations/20261230000500_client_support_groups.sql
\i supabase/migrations/20261230000500_client_support_groups.sql
-- a re-run starts clean
delete from customer_client_accounts where email = 'grp.client@example.com';
delete from auth.users where email = 'grp.client@example.com';
delete from test.users where name = 'grp_client';
delete from customers where phone = '9000000501';
create temp table gp (k text primary key, v text);
grant all on gp to authenticated, service_role;
create function pg_temp.gv(p_k text) returns text language sql stable as $$ select v from gp where k = p_k $$;
grant execute on function pg_temp.gv(text) to authenticated;

set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000501","name":"Group Client","businessName":"Group Traders (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean),
  'setup: a Support customer');
reset role;
insert into gp select 'cust', id::text from customers where phone = '9000000501';
insert into gp select 'lead', (select name from test.users where id = private.support_lead_of(pg_temp.gv('cust')::uuid));
select test.create_auth_user('grp_client', 'grp.client@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', pg_temp.gv('cust')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values (pg_temp.gv('cust')::uuid, test.id('grp_client'), 'grp.client@example.com');
select test.check(pg_temp.gv('lead') is not null and private.client_group_eligible(pg_temp.gv('cust')::uuid, test.id('sup_b'))
                  and not private.client_group_eligible(pg_temp.gv('cust')::uuid, test.id('tm_a'))
                  and not private.client_group_eligible(pg_temp.gv('cust')::uuid, test.id('tds_x1')),
  'fixture: a Team Lead; sup_b may be added; a Sales member and another department''s Support member may not');

set role authenticated;
select test.login('grp_client');
insert into gp select 'conv', chat_client_conversation() ->> 'id';

\echo '   the group: who manages it, who can be added'
select test.must_fail(format($$select client_support_group_save('%s', 'Mine', array['%s']::uuid[], null)$$, pg_temp.gv('cust'), test.id('sup_b')), 'the client cannot add anyone', 'NOT_FOUND|FORBIDDEN');
select test.login('sup_b');
select test.must_fail(format($$select chat_send_message('%s', 'Hello', gen_random_uuid())$$, pg_temp.gv('conv')), 'a Support member who is not in the group cannot write', 'NOT_FOUND');
select test.login('sup_plain');
select test.must_fail(format($$select client_support_group_save('%s', 'Mine', array['%s']::uuid[], null)$$, pg_temp.gv('cust'), test.id('sup_b')), 'the assigned Team Member does not manage the members', 'NOT_FOUND');
select test.check((select (g ->> 'canManage')::boolean = false and g -> 'candidates' = 'null'::jsonb from (select client_support_group(pg_temp.gv('cust')::uuid) g) x),
  'they can see the group, without the list of people to add');
select test.login(pg_temp.gv('lead'));
select test.check((select g ->> 'name' = 'Group Traders (TEST) - Support' and (g ->> 'canManage')::boolean
                          and exists (select 1 from jsonb_array_elements(g -> 'candidates') c where (c ->> 'id')::uuid = test.id('sup_b'))
                          and not exists (select 1 from jsonb_array_elements(g -> 'candidates') c where (c ->> 'id')::uuid in (test.id('tm_a'), test.id('tds_x1')))
                     from (select client_support_group(pg_temp.gv('cust')::uuid) g) x),
  'the Team Lead sees the default name and the Support people of the department who can be added');
select test.must_fail(format($$select client_support_group_save('%s', null, array['%s']::uuid[], null)$$, pg_temp.gv('cust'), test.id('tm_a')), 'a Sales member is refused', 'Only active Support employees');
select test.must_fail(format($$select client_support_group_save('%s', null, array['%s']::uuid[], null)$$, pg_temp.gv('cust'), test.id('tds_x1')), 'another department''s Support member is refused', 'Only active Support employees');
select test.check((select jsonb_array_length(g -> 'members') = 1 and g ->> 'name' = 'Group Traders - Support'
                     from (select client_support_group_save(pg_temp.gv('cust')::uuid, 'Group Traders - Support', array[test.id('sup_b')], null) g) x),
  'the Team Lead names the group and adds sup_b');
select client_support_group_save(pg_temp.gv('cust')::uuid, null, array[test.id('sup_b')], null);
reset role;
select test.check((select count(*) = 1 from chat_members where conversation_id = pg_temp.gv('conv')::uuid and left_at is null), 'adding twice keeps one membership');
select test.check((select count(*) = 2 from chat_messages where conversation_id = pg_temp.gv('conv')::uuid and kind = 'SYSTEM'
                     and (body like '%named the group "Group Traders - Support"' or body like '%added TM B%' or body like '%added%'))
                  and (select count(*) = 1 from audit_logs where action = 'CLIENT_GROUP_MEMBER_ADDED' and entity_id = pg_temp.gv('cust')::uuid),
  'the name and the new member are posted in the conversation and the addition is audited');

\echo '   the added member works in the group'
set role authenticated;
select test.login('sup_b');
select test.check((select count(*) = 1 from jsonb_array_elements(chat_my_clients()) x
                    where (x ->> 'customerId')::uuid = pg_temp.gv('cust')::uuid and x ->> 'role' = 'Support group' and x ->> 'groupName' = 'Group Traders - Support'),
  'it is in their client list, as a support group, with its name');
insert into gp select 'm1', (chat_send_message(pg_temp.gv('conv')::uuid, 'Hi from support', '44444444-4444-4444-4444-444444444444') ->> 'seq');

\echo '   Sent / Delivered / Seen'
select test.check((select x ->> 'status' = 'SENT' and jsonb_array_length(x -> 'recipients') = 3
                          and not exists (select 1 from jsonb_array_elements(x -> 'recipients') r where r ->> 'label' = 'Support')
                     from jsonb_array_elements(chat_message_receipts(pg_temp.gv('conv')::uuid)) x where (x ->> 'seq')::bigint = pg_temp.gv('m1')::bigint),
  'stored: Sent; its recipients are the client, the Relationship Manager and the Team Lead (not the sender)');
select test.login('grp_client');
select chat_ack_delivered(pg_temp.gv('conv')::uuid, pg_temp.gv('m1')::bigint);
select test.login('sup_b');
select test.check((select x ->> 'status' = 'SENT' and (select (r ->> 'delivered')::boolean from jsonb_array_elements(x -> 'recipients') r where r ->> 'label' = 'Client')
                     from jsonb_array_elements(chat_message_receipts(pg_temp.gv('conv')::uuid)) x where (x ->> 'seq')::bigint = pg_temp.gv('m1')::bigint),
  'the client''s device received it: delivered to the client, but still Sent until every recipient has it (others offline)');
select test.login('sup_plain');
select chat_ack_delivered(pg_temp.gv('conv')::uuid, pg_temp.gv('m1')::bigint);
select test.login(pg_temp.gv('lead'));
select chat_ack_delivered(pg_temp.gv('conv')::uuid, pg_temp.gv('m1')::bigint);
select test.login('sup_b');
select test.check((select x ->> 'status' = 'DELIVERED' from jsonb_array_elements(chat_message_receipts(pg_temp.gv('conv')::uuid)) x where (x ->> 'seq')::bigint = pg_temp.gv('m1')::bigint),
  'every recipient''s device acknowledged it: Delivered');
select test.login('grp_client');
select chat_mark_read(pg_temp.gv('conv')::uuid, pg_temp.gv('m1')::bigint);
select chat_ack_delivered(pg_temp.gv('conv')::uuid, 0);
select test.login('sup_plain');
select chat_mark_read(pg_temp.gv('conv')::uuid, pg_temp.gv('m1')::bigint);
select test.login(pg_temp.gv('lead'));
select chat_mark_read(pg_temp.gv('conv')::uuid, pg_temp.gv('m1')::bigint);
select test.login('sup_b');
select test.check((select x ->> 'status' = 'SEEN' from jsonb_array_elements(chat_message_receipts(pg_temp.gv('conv')::uuid)) x where (x ->> 'seq')::bigint = pg_temp.gv('m1')::bigint),
  'every recipient read it: Seen (and a late, lower acknowledgement does not undo anything)');
select test.login('grp_client');
insert into gp select 'm2', (chat_send_message(pg_temp.gv('conv')::uuid, 'Thanks!', '55555555-5555-5555-5555-555555555555') ->> 'seq');
select test.check((select x ->> 'status' = 'SENT' and jsonb_array_length(x -> 'recipients') = 3 from jsonb_array_elements(chat_message_receipts(pg_temp.gv('conv')::uuid)) x),
  'the client''s own message: Sent to the Relationship Manager, the Team Lead and the added member');
select test.must_fail($$select count(*) from chat_read_state$$, 'nobody reads the read state directly (only through the receipts)', 'permission denied');
reset role;

\echo '   leaving the group, and leaving the company'
set role authenticated;
select test.login(pg_temp.gv('lead'));
select client_support_group_save(pg_temp.gv('cust')::uuid, null, null, array[test.id('sup_b')]);
select test.login('sup_b');
select test.must_fail(format($$select chat_send_message('%s', 'Still here?', gen_random_uuid())$$, pg_temp.gv('conv')), 'a removed member cannot write any more', 'NOT_FOUND');
select test.check((select count(*) = 0 from jsonb_array_elements(chat_my_clients()) x where (x ->> 'customerId')::uuid = pg_temp.gv('cust')::uuid), 'nor sees the client in their list');
select test.login(pg_temp.gv('lead'));
select client_support_group_save(pg_temp.gv('cust')::uuid, null, array[test.id('sup_b')], null);
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('sup_b');
select test.check(not private.client_group_member(pg_temp.gv('conv')::uuid, test.id('sup_b')), 'a suspended member loses access at once, even while still listed');
update profiles set status = 'ACTIVE' where id = test.id('sup_b');
select test.check((select count(*) = 1 from audit_logs where action = 'CLIENT_GROUP_MEMBER_REMOVED' and entity_id = pg_temp.gv('cust')::uuid), 'the removal is audited');
