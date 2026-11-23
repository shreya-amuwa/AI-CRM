-- =============================================================================
-- Notification coverage for meetings, tasks and client chat (migration 20270130000100).
-- Reuses the users of the earlier suites: sa (Super Admin / CEO), tm_a (Team Member, Sales), wkr_dhp (Department Head), tsk_tl1 (Team Lead), tsk_m1 / tsk_m3 (Team Members),
-- sup_plain (the Relationship Manager of the customer made here), sup_th (the Support Team Lead), sup_b (a Support colleague), tds_x1 (another department's Support).
-- Every check reads the notification the person would see in the bell.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 141. Notification coverage: meetings, tasks, client chat'
reset role;
\i supabase/migrations/20270130000100_notification_coverage.sql
\i supabase/migrations/20270130000100_notification_coverage.sql

-- a re-run starts clean
delete from meetings where title like 'NC %';
delete from work_tasks where title like 'NC %';
delete from notifications where title like '%NC %' or body like '%NC %';
delete from customer_client_accounts where email = 'nc.client@example.com';
delete from auth.users where email = 'nc.client@example.com';
delete from test.users where name = 'nc_client';
delete from customers where phone = '9000000701';
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
create temp table nc (k text primary key, v text);
grant all on nc to authenticated, service_role;
create function pg_temp.nv(p_k text) returns text language sql stable as $$ select v from nc where k = p_k $$;
grant execute on function pg_temp.nv(text) to authenticated;

-- ---------------------------------------------------------------------------
\echo '   meetings: request, approve, reject, propose another time, reschedule, cancel'
set role authenticated;
select test.login('tm_a');
insert into nc select 'm1', mtg_create(jsonb_build_object('title', 'NC Quarterly pricing review', 'hostId', test.id('sa'), 'description', 'Agree the new price list before launch',
  'startsAt', date_trunc('hour', now()) + interval '61 days 10 hours', 'endsAt', date_trunc('hour', now()) + interval '61 days 10 hours 30 minutes')) ->> 'id';
insert into nc select 'm2', mtg_create(jsonb_build_object('title', 'NC Office layout', 'hostId', test.id('sa'), 'description', 'Where the new desks go',
  'startsAt', date_trunc('hour', now()) + interval '62 days 10 hours', 'endsAt', date_trunc('hour', now()) + interval '62 days 10 hours 30 minutes')) ->> 'id';
insert into nc select 'm3', mtg_create(jsonb_build_object('title', 'NC Budget talk', 'hostId', test.id('sa'), 'description', 'Next quarter budget',
  'startsAt', date_trunc('hour', now()) + interval '63 days 10 hours', 'endsAt', date_trunc('hour', now()) + interval '63 days 10 hours 30 minutes')) ->> 'id';
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REQUESTED' and entity_id = pg_temp.nv('m1')::uuid
                          and body like 'NC Quarterly pricing review — requested by Member A (%'
                          and body like '%Subject: NC Quarterly pricing review%' and body like '%Purpose: Agree the new price list before launch%'
                          and body like '%Requested for: %' and body like '%Requested on: %'
                          and body like '%(' || (select d.name from departments d join profiles p on p.department_id = d.id where p.id = test.id('tm_a')) || ')%'),
  'the CEO is told who asked, from which department, the subject, the purpose, the requested date and time and the request date');

set role authenticated;
select test.login('sa');
select mtg_decide(pg_temp.nv('m1')::uuid, 'APPROVE', 'Yes, bring the draft');
select mtg_decide(pg_temp.nv('m2')::uuid, 'DECLINE', 'Not before the audit');
select mtg_decide(pg_temp.nv('m3')::uuid, 'PROPOSE', 'Friday works better', date_trunc('hour', now()) + interval '66 days 15 hours', date_trunc('hour', now()) + interval '66 days 15 hours 30 minutes');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_APPROVED' and entity_id = pg_temp.nv('m1')::uuid
                          and title = 'Meeting approved: NC Quarterly pricing review' and body like 'Status: Approved. Date and time: %' and body like '%Message from % Yes, bring the draft.'),
  'approval: the requester gets the subject, the status, the approved date and time and the CEO''s message');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_DECLINED' and entity_id = pg_temp.nv('m2')::uuid
                          and title = 'Meeting request rejected: NC Office layout' and body = 'Status: Rejected. Reason: Not before the audit'),
  'rejection: the requester gets the subject, the status and the reason');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_PROPOSED' and entity_id = pg_temp.nv('m3')::uuid
                          and body like 'Status: Rescheduled%' and body like '%Requested: %' and body like '%New time proposed: %' and body like '%Reason: Friday works better%'),
  'another time proposed: the requester gets the requested and the new date and time, the reason and the status');

set role authenticated;
select test.login('sa');
select mtg_reschedule(pg_temp.nv('m1')::uuid, date_trunc('hour', now()) + interval '64 days 12 hours', date_trunc('hour', now()) + interval '64 days 12 hours 30 minutes', 'The CEO is travelling');
reset role;
insert into meeting_attendees (meeting_id, profile_id, role) values (pg_temp.nv('m1')::uuid, test.id('hr_head'), 'REQUIRED');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_RESCHEDULED' and entity_id = pg_temp.nv('m1')::uuid
                          and body like 'Status: Rescheduled (scheduled). Previous: % New: % Reason: The CEO is travelling. Moved by %'),
  'reschedule: the requester gets the previous and the new date and time, the reason and the updated status');
set role authenticated;
select test.login('sa');
select mtg_cancel(pg_temp.nv('m1')::uuid, 'Priorities changed');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_CANCELLED' and entity_id = pg_temp.nv('m1')::uuid
                          and body like 'Status: Cancelled by %. Was: %. Reason: Priorities changed.')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('hr_head') and type = 'MEETING_CANCELLED' and entity_id = pg_temp.nv('m1')::uuid),
  'cancel: the requester and every participant get the status, who cancelled, the old time and the reason');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('sa') and type in ('MEETING_APPROVED', 'MEETING_DECLINED', 'MEETING_CANCELLED', 'MEETING_RESCHEDULED', 'MEETING_PROPOSED')
                          and entity_id in (pg_temp.nv('m1')::uuid, pg_temp.nv('m2')::uuid, pg_temp.nv('m3')::uuid)),
  'the person who acts is not notified of their own action');

-- ---------------------------------------------------------------------------
\echo '   tasks: priority, deadline, reopened, moved; the facts in every task notification'
set role authenticated;
select test.login('wkr_dhp');
insert into nc select 't1', assign_task_direct(test.id('tsk_m1'), 'NC Prepare the renewal list', 'All plans that end this month', 'HIGH', current_date + 5)::text;
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_ASSIGNED' and entity_id = pg_temp.nv('t1')::uuid
                          and body like 'Assigned by %' and body like '% · due %' and body like '% · Priority: High'
                          and data ->> 'priority' = 'HIGH' and data ->> 'taskTitle' = 'NC Prepare the renewal list' and data ->> 'taskId' = pg_temp.nv('t1')),
  'a new task says who assigned it, the due date and the priority, and carries the task facts for the link');
select test.check((select count(*) = 0 from notifications where entity_id = pg_temp.nv('t1')::uuid and type in ('TASK_PRIORITY_CHANGED', 'TASK_DEADLINE_CHANGED', 'TASK_REOPENED', 'TASK_REASSIGNED', 'TASK_REASSIGNED_AWAY')),
  'creating a task raises none of the change notices');

-- the manager changes the task (as the database sees it: signed in as the Department Head, whatever path made the change)
select test.login('wkr_dhp');
update work_tasks set priority = 'URGENT' where id = pg_temp.nv('t1')::uuid;
update work_tasks set due_date = current_date + 2 where id = pg_temp.nv('t1')::uuid;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_PRIORITY_CHANGED' and entity_id = pg_temp.nv('t1')::uuid
                          and title = 'Task priority changed: NC Prepare the renewal list' and body like '% changed the priority from High to Urgent%' and priority = 'urgent'),
  'a priority change tells the assignee the task, who changed it, from and to');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_DEADLINE_CHANGED' and entity_id = pg_temp.nv('t1')::uuid
                          and body like '% changed the deadline from % to % · priority Urgent.'),
  'a deadline change tells the assignee the old and new date and the priority');

-- completed, then reopened by the manager; the manager is not told of their own action, the assignee is
update work_tasks set status = 'COMPLETED', progress = 100, completed_at = now() where id = pg_temp.nv('t1')::uuid;
update work_tasks set status = 'IN_PROGRESS', progress = 60, completed_at = null where id = pg_temp.nv('t1')::uuid;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_REOPENED' and entity_id = pg_temp.nv('t1')::uuid
                          and body like '% reopened this task (it was completed, now in progress)%'),
  'a reopened task notifies the assignee');
-- a change that touches neither the priority, the deadline, the reopening nor the person raises nothing
insert into nc select 'cnt', count(*)::text from notifications where entity_id = pg_temp.nv('t1')::uuid;
update work_tasks set progress = 70, last_update_note = 'Half way' where id = pg_temp.nv('t1')::uuid;
select test.check((select count(*) = pg_temp.nv('cnt')::int from notifications where entity_id = pg_temp.nv('t1')::uuid), 'changing only the progress raises no change notice');

-- moved to another person: the new person is told, the previous person is told; a function that already told them is not repeated
update work_tasks set assignee_id = test.id('tsk_m3') where id = pg_temp.nv('t1')::uuid;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m3') and type = 'TASK_REASSIGNED' and entity_id = pg_temp.nv('t1')::uuid
                          and body like '% moved this task to you · due %' and body like '%priority Urgent.')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_REASSIGNED_AWAY' and entity_id = pg_temp.nv('t1')::uuid),
  'reassigned: the new assignee and the previous assignee are both told');
select test.check((select count(*) = 1 from notifications where entity_id = pg_temp.nv('t1')::uuid and recipient_id = test.id('tsk_m3')), 'once, not twice');

-- the existing functions keep their own notice and the deferred trigger adds none on top (assign_task_to_members moves nothing; delegating creates new tasks)
set role authenticated;
select test.login('tsk_tl1');
insert into nc select 't2', assign_team_task('NC Team follow-up', 'Call each customer', 'MEDIUM', current_date + 4, null, array[test.id('tsk_m1')])::text;
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_ASSIGNED' and title = 'New task: NC Team follow-up' and body like '% · Priority: Medium'),
  'every assignment function benefits: the team task says Medium priority');

-- ---------------------------------------------------------------------------
\echo '   client chat: new conversation, reply, assigned / reassigned, unanswered'
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000701","name":"NC Client","businessName":"NC Traders (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean), 'setup: a Support customer of sup_plain');
reset role;
insert into nc select 'cust', id::text from customers where phone = '9000000701';
select test.create_auth_user('nc_client', 'nc.client@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', pg_temp.nv('cust')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values (pg_temp.nv('cust')::uuid, test.id('nc_client'), 'nc.client@example.com');
set role authenticated;
select test.login('nc_client');
insert into nc select 'conv', chat_client_conversation() ->> 'id';
select chat_send_message(pg_temp.nv('conv')::uuid, 'Hello, this is my first message', '77777777-7777-7777-7777-777777777701');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_plain') and type = 'CHAT_CLIENT_MESSAGE' and entity_id = pg_temp.nv('conv')::uuid
                          and title = 'New conversation from NC Traders (TEST)' and body = 'Hello, this is my first message' and (data ->> 'newConversation')::boolean)
                  and (select count(*) = 1 from notifications where recipient_id = test.id('sup_th') and type = 'CHAT_CLIENT_MESSAGE' and entity_id = pg_temp.nv('conv')::uuid
                          and title = 'New conversation from NC Traders (TEST)'),
  'the first message is announced as a new conversation to the Relationship Manager and the Team Lead');
set role authenticated;
select test.login('sup_plain');
select chat_send_message(pg_temp.nv('conv')::uuid, 'Hi, how can I help?', '77777777-7777-7777-7777-777777777702');
select test.login('nc_client');
select chat_send_message(pg_temp.nv('conv')::uuid, 'I need my invoice', '77777777-7777-7777-7777-777777777703');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_plain') and type = 'CHAT_CLIENT_MESSAGE' and entity_id = pg_temp.nv('conv')::uuid and title = 'New message from NC Traders (TEST)'),
  'a later client message (after the RM answered) is an ordinary new-message notice, not another "new conversation"');

-- a colleague answers: the RM and the Team Lead are both told, once per day
set role authenticated;
select test.login('sup_b');
select chat_send_message(pg_temp.nv('conv')::uuid, 'Your invoice is on its way', '77777777-7777-7777-7777-777777777704');
select chat_send_message(pg_temp.nv('conv')::uuid, 'Sent it just now', '77777777-7777-7777-7777-777777777705');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_plain') and type = 'CHAT_COVER_REPLY' and entity_id = pg_temp.nv('conv')::uuid)
                  and (select count(*) = 1 from notifications where recipient_id = test.id('sup_th') and type = 'CHAT_COVER_REPLY' and entity_id = pg_temp.nv('conv')::uuid and title like 'Support B replied to %')
                  and (select count(*) = 0 from notifications where recipient_id = test.id('sup_b') and type = 'CHAT_COVER_REPLY'),
  'a colleague''s reply tells the Relationship Manager and the Team Lead once each (two replies, one bell; never the colleague themself)');

-- the Relationship Manager changes: the new one is told it is theirs, the previous one that it moved
select test.login('sup_th');
update customers set owner_id = test.id('sup_b') where id = pg_temp.nv('cust')::uuid;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_b') and type = 'CHAT_ASSIGNED' and entity_id = pg_temp.nv('conv')::uuid
                          and title = 'Client chat assigned to you: NC Traders (TEST)' and body like 'You are now the Relationship Manager%' and priority = 'urgent')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('sup_plain') and type = 'CHAT_REASSIGNED' and entity_id = pg_temp.nv('conv')::uuid
                          and body = 'This client chat is now with Support B.'),
  'a changed Relationship Manager: the new one is told the chat is theirs, the previous one that it moved (and who has it)');

-- unanswered: the client writes, nobody answers. The run is given an explicit clock (12:00 India time today) so the test does not depend on the hour it runs
insert into nc select 'noon', ((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '12 hours') at time zone 'Asia/Kolkata')::text;
set role authenticated;
select test.login('nc_client');
select chat_send_message(pg_temp.nv('conv')::uuid, 'Is anybody there?', '77777777-7777-7777-7777-777777777706');
select test.must_fail_state($$select chat_unanswered_remind()$$, 'the reminder function is not callable by a signed-in employee', '42501');
reset role;
-- 45 minutes without an answer: level 1 (the Relationship Manager; the one handling it is the same person here)
update chat_messages set created_at = pg_temp.nv('noon')::timestamptz - interval '45 minutes' where conversation_id = pg_temp.nv('conv')::uuid and body = 'Is anybody there?';
select test.check((select (chat_unanswered_remind(pg_temp.nv('noon')::timestamptz) ->> 'reminded')::int >= 1), 'the reminder run finds the waiting client');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_b') and type = 'CHAT_UNANSWERED' and entity_id = pg_temp.nv('conv')::uuid
                          and title = 'Client waiting: NC Traders (TEST)' and body = 'No reply for 45 minutes. Open the conversation and answer.' and priority = 'normal')
                  and (select count(*) = 0 from notifications where recipient_id in (test.id('sup_th'), test.id('sup_plain')) and type = 'CHAT_UNANSWERED' and entity_id = pg_temp.nv('conv')::uuid),
  'after 30 minutes the (current) Relationship Manager is reminded; the Team Lead and the previous Relationship Manager are not');
select test.check((select (chat_unanswered_remind(pg_temp.nv('noon')::timestamptz) ->> 'reminded')::int = 0), 'running it again reminds nobody twice');
-- 3 hours: level 2 (the Team Lead too, urgent)
update chat_messages set created_at = pg_temp.nv('noon')::timestamptz - interval '3 hours' where conversation_id = pg_temp.nv('conv')::uuid and body = 'Is anybody there?';
select chat_unanswered_remind(pg_temp.nv('noon')::timestamptz);
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sup_th') and type = 'CHAT_UNANSWERED' and entity_id = pg_temp.nv('conv')::uuid
                          and title = 'Client still waiting: NC Traders (TEST)' and priority = 'urgent')
                  and (select count(*) = 2 from notifications where recipient_id = test.id('sup_b') and type = 'CHAT_UNANSWERED' and entity_id = pg_temp.nv('conv')::uuid),
  'after 2 hours the Team Lead is told too (urgent) and the Relationship Manager once more; the first reminder is not repeated');
select test.check((select (chat_unanswered_remind(pg_temp.nv('noon')::timestamptz) ->> 'reminded')::int = 0), 'and a third run adds nothing');
-- an answer ends it
set role authenticated;
select test.login('sup_b');
select chat_send_message(pg_temp.nv('conv')::uuid, 'Sorry for the wait, here I am', '77777777-7777-7777-7777-777777777707');
reset role;
select test.check((select (chat_unanswered_remind(pg_temp.nv('noon')::timestamptz + interval '1 hour') ->> 'reminded')::int = 0), 'once an employee answered, nobody is reminded');
-- not at night, not for old messages
select test.check((select (chat_unanswered_remind((date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '3 hours') at time zone 'Asia/Kolkata') ->> 'skipped') = 'OUTSIDE_HOURS'), 'at 03:00 India time nobody is reminded');
set role authenticated;
select test.login('nc_client');
select chat_send_message(pg_temp.nv('conv')::uuid, 'An old unanswered question', '77777777-7777-7777-7777-777777777708');
reset role;
update chat_messages set created_at = pg_temp.nv('noon')::timestamptz - interval '4 days' where conversation_id = pg_temp.nv('conv')::uuid and body = 'An old unanswered question';
select test.check((select (chat_unanswered_remind(pg_temp.nv('noon')::timestamptz) ->> 'reminded')::int = 0), 'a message older than three days is not chased');
