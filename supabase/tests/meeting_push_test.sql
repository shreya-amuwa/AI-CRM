-- =============================================================================
-- Meeting notifications on phones (migration 20270208000100): a meeting notification someone receives in the CRM (invited, moved,
-- cancelled, reminders, approvals, reports) is also queued as a push to each of their active devices; information-only types stay in the
-- bell; the lock-screen text never carries the agenda; reminders 15 minutes before and at the start, once per start time, following a
-- reschedule and stopping on a cancellation. Reuses tm_a (host), sa (the Managing Director, invited) and ck_a. Synthetic data only.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 136c. Meetings: notifications on phones'
reset role;
\i supabase/migrations/20270208000100_meeting_push.sql
\i supabase/migrations/20270208000100_meeting_push.sql

delete from notification_deliveries where kind = 'MEETING';
delete from meetings where title like 'MPush %';
delete from notifications where type like 'MEETING%' and recipient_id in (test.id('sa'), test.id('ck_a'), test.id('tm_a'));
delete from push_subscriptions where endpoint like 'https://push.example.com/mpush-%';
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values
  (test.id('sa'), 'https://push.example.com/mpush-sa-phone', 'k1', 'a1', 'Chrome on Android', true),
  (test.id('sa'), 'https://push.example.com/mpush-sa-laptop', 'k2', 'a2', 'Edge on Windows', true),
  (test.id('sa'), 'https://push.example.com/mpush-sa-old', 'k3', 'a3', 'Old phone', false);
create temp table mp (k text primary key, id uuid, v integer);
grant all on mp to authenticated;

\echo '   an invitation reaches the invitee''s phones (not the host''s own action, not the agenda)'
set role authenticated;
select test.login('tm_a');
insert into mp select 'm1', (x ->> 'id')::uuid, (x ->> 'version')::integer from (select mtg_create(jsonb_build_object(
  'title', 'MPush review', 'kind', 'MEETING', 'description', 'Secret agenda: salary bands',
  'startsAt', date_trunc('hour', now()) + interval '3 days 10 hours', 'endsAt', date_trunc('hour', now()) + interval '3 days 11 hours',
  'attendeeIds', jsonb_build_array(test.id('sa'), test.id('ck_a')))) x) s;
reset role;
select test.check((select count(*) = 2 from notification_deliveries d join notifications n on n.id = d.notification_id
                    where d.kind = 'MEETING' and d.profile_id = test.id('sa') and n.type = 'MEETING_INVITED' and n.entity_id = (select id from mp where k = 'm1')),
  'the Managing Director, invited, gets the invitation on both active devices (not the switched-off one)');
select test.check((select bool_and(d.url = '/?open=meeting&id=' || (select id from mp where k = 'm1')) from notification_deliveries d where d.kind = 'MEETING' and d.profile_id = test.id('sa')),
  'tapping it opens that meeting');
select test.check((select bool_and(d.title || ' ' || d.body not like '%Secret agenda%' and d.title || ' ' || d.body not like '%salary%') from notification_deliveries d where d.kind = 'MEETING'),
  'the lock-screen text never carries the agenda');
select test.check(not exists (select 1 from notification_deliveries d where d.kind = 'MEETING' and d.profile_id = test.id('tm_a')), 'the host is not told about their own action');
select test.check(not exists (select 1 from notification_deliveries d where d.kind = 'MEETING' and d.profile_id = test.id('ck_a')),
  'someone with no registered device gets the bell only');
select test.check((select bool_and(d.status = 'PENDING' and d.expires_at > now()) from notification_deliveries d where d.kind = 'MEETING'), 'they wait for the sender');

\echo '   moved and cancelled reach the phone too; information-only notices stay in the bell'
set role authenticated;
select test.login('tm_a');
select mtg_reschedule((select id from mp where k = 'm1'), date_trunc('hour', now()) + interval '4 days 10 hours', date_trunc('hour', now()) + interval '4 days 11 hours',
  'Clash', (select v from mp where k = 'm1'));
reset role;
select test.check((select count(*) = 2 from notification_deliveries d join notifications n on n.id = d.notification_id
                    where d.profile_id = test.id('sa') and n.type = 'MEETING_RESCHEDULED'), 'a rescheduled meeting is pushed');
insert into notifications (recipient_id, type, title, body, entity_type, entity_id) values
  (test.id('sa'), 'MEETING_RESPONSE', 'Ravi accepted', 'Ravi accepted the meeting.', 'meeting', (select id from mp where k = 'm1'));
select test.check(not exists (select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.type = 'MEETING_RESPONSE'),
  'an information-only meeting notice (an answer to an invitation) is not pushed');
select count(*) as before_dup from notification_deliveries where kind = 'MEETING' \gset
select private.meeting_push_queue(n) from notifications n where n.type = 'MEETING_INVITED' and n.recipient_id = test.id('sa') and n.entity_id = (select id from mp where k = 'm1');
select test.check((select count(*) = :before_dup from notification_deliveries where kind = 'MEETING'), 'queuing the same notification again adds nothing (one per device)');
set role authenticated;
select test.login('tm_a');
select mtg_cancel((select id from mp where k = 'm1'), 'Not needed');
reset role;
select test.check((select count(*) = 2 from notification_deliveries d join notifications n on n.id = d.notification_id
                    where d.profile_id = test.id('sa') and n.type = 'MEETING_CANCELLED'), 'a cancelled meeting is pushed');

\echo '   reminders 15 minutes before and at the start, once each, following a reschedule'
set role authenticated;
select test.login('tm_a');
insert into mp select 'm2', (x ->> 'id')::uuid, (x ->> 'version')::integer from (select mtg_create(jsonb_build_object(
  'title', 'MPush standup', 'kind', 'MEETING', 'startsAt', now() + interval '12 minutes', 'endsAt', now() + interval '42 minutes',
  'attendeeIds', jsonb_build_array(test.id('sa')))) x) s;
reset role;
select mtg_enqueue_reminders();
select test.check((select count(*) = 1 from meeting_reminders where meeting_id = (select id from mp where k = 'm2') and kind = '15M'), 'a meeting in 12 minutes gets the 15-minute reminder');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REMINDER' and entity_id = (select id from mp where k = 'm2') and title like 'In 15 minutes:%'),
  'it says so in the CRM');
select test.check((select count(*) = 2 from notification_deliveries d join notifications n on n.id = d.notification_id
                    where n.type = 'MEETING_REMINDER' and n.entity_id = (select id from mp where k = 'm2')), 'and on the phone');
select test.check((select bool_and(d.expires_at <= (select starts_at from meetings where id = (select id from mp where k = 'm2')) + interval '1 hour')
                     from notification_deliveries d join notifications n on n.id = d.notification_id where n.type = 'MEETING_REMINDER' and n.entity_id = (select id from mp where k = 'm2')),
  'a reminder is not delivered long after the meeting');
select test.check(mtg_enqueue_reminders() = 0, 'running again reminds nobody twice');
update meetings set starts_at = now() + interval '3 minutes', ends_at = now() + interval '33 minutes' where id = (select id from mp where k = 'm2');
select mtg_enqueue_reminders();
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REMINDER' and entity_id = (select id from mp where k = 'm2') and title like 'Starting now:%'),
  'at the start (within 5 minutes) a "starting now" reminder');
select test.check((select bool_and(d.status = 'CANCELLED' and d.last_error = 'SUPERSEDED') from notification_deliveries d join notifications n on n.id = d.notification_id
                    where n.type = 'MEETING_REMINDER' and n.entity_id = (select id from mp where k = 'm2') and n.title like 'In 15 minutes:%'),
  'the newer "starting now" replaces the 15-minute reminder still waiting (a late retry never covers a newer notice)');
select test.check((select count(*) = 2 from notification_deliveries d join notifications n on n.id = d.notification_id
                    where n.type = 'MEETING_REMINDER' and n.title like 'Starting now:%' and d.status = 'PENDING' and n.entity_id = (select id from mp where k = 'm2')),
  'and is itself waiting to be sent');
set role authenticated;
select test.login('tm_a');
select mtg_cancel((select id from mp where k = 'm2'), 'Off');
reset role;
update meetings set starts_at = now() + interval '10 minutes' where id = (select id from mp where k = 'm2');
select test.check(mtg_enqueue_reminders() = 0, 'a cancelled meeting gets no reminders');

\echo '   the lock screen never names who asked; no push about your own action; summaries and proposed times'
insert into notifications (recipient_id, type, title, body, entity_type, entity_id, data) values
  (test.id('sa'), 'MEETING_REQUESTED', 'Meeting request from Ravi Kumar', 'Ravi Kumar asked for a meeting about his appraisal.', 'meeting',
   (select id from mp where k = 'm1'), jsonb_build_object('meetingId', (select id from mp where k = 'm1')));
select test.check((select bool_and(d.title = 'Meeting request: MPush review' and d.title || d.body not like '%Ravi%' and d.title || d.body not like '%appraisal%')
                     from notification_deliveries d join notifications n on n.id = d.notification_id where n.type = 'MEETING_REQUESTED' and d.profile_id = test.id('sa')),
  'a request shows a fixed label and the meeting title, never the requester or the reason');
insert into notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id) values
  (test.id('sa'), 'MEETING_QUEUE_SCHEDULED', 'Next queued meeting scheduled', 'x', 'meeting', (select id from mp where k = 'm1'), test.id('sa'));
select test.check(not exists (select 1 from notification_deliveries d join notifications n on n.id = d.notification_id where n.type = 'MEETING_QUEUE_SCHEDULED'),
  'a notice written about the person''s own action (written directly, not through notify) is not pushed');
insert into notifications (recipient_id, type, title, body, entity_type, entity_id) values
  (test.id('sa'), 'MEETING_SUMMARY_OVERDUE', 'Summary overdue', 'x', 'meeting', (select id from mp where k = 'm1'));
select test.check((select bool_and(d.expires_at > now() + interval '23 hours') from notification_deliveries d join notifications n on n.id = d.notification_id
                    where n.type = 'MEETING_SUMMARY_OVERDUE'), 'a summary notice (the meeting may be over) is kept a day for retries');
update meetings set proposed_starts_at = timestamptz '2031-03-04 05:30:00+00', proposed_ends_at = timestamptz '2031-03-04 06:30:00+00'
 where id = (select id from mp where k = 'm1');
insert into notifications (recipient_id, type, title, body, entity_type, entity_id, data) values
  (test.id('sa'), 'MEETING_PROPOSED', 'Another time proposed', 'x', 'meeting', (select id from mp where k = 'm1'),
   jsonb_build_object('meetingId', (select id from mp where k = 'm1'), 'startsAt', now() + interval '4 days'));
select test.check((select bool_and(d.body = 'Tue 04 Mar, 11:00 AM (IST)') from notification_deliveries d join notifications n on n.id = d.notification_id
                    where n.type = 'MEETING_PROPOSED'), 'another time proposed shows the proposed time, not the one asked for');
delete from notifications where type in ('MEETING_REQUESTED', 'MEETING_QUEUE_SCHEDULED', 'MEETING_SUMMARY_OVERDUE', 'MEETING_PROPOSED') and recipient_id = test.id('sa')
   and entity_id = (select id from mp where k = 'm1');

-- clean up
delete from meetings where title like 'MPush %';
delete from notification_deliveries where kind = 'MEETING';
delete from push_subscriptions where endpoint like 'https://push.example.com/mpush-%';
