-- =============================================================================
-- Meetings (migration 20270113000100): the creator organises the Google event, colleagues get the meeting e-mail, and only the
-- people taking part see a meeting (the Super Admin included). Reuses sa (Super Admin = the CEO), tm_a, ck_a, ck_b.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 137. Meetings: invitations from the creator, participants only'
reset role;
\i supabase/migrations/20270113000100_meetings_creator_organiser.sql
\i supabase/migrations/20270113000100_meetings_creator_organiser.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql

delete from meeting_delegates where host_id in (test.id('sa'), test.id('tm_a'));
delete from google_calendar_connections where profile_id in (test.id('sa'), test.id('tm_a'), test.id('ck_b'));
delete from meetings where host_id in (test.id('sa'), test.id('tm_a'), test.id('ck_a'), test.id('ck_b'));
delete from notifications where type like 'MEETING%';
create temp table mo (k text primary key, id uuid);
grant all on mo to authenticated;

-- everyone has connected Google Calendar except the Super Admin
insert into google_calendar_connections (profile_id, google_email, refresh_token_enc) values
  (test.id('tm_a'), 'tm.a@example.com', 'v1:x:y:z'), (test.id('ck_b'), 'ck.b@example.com', 'v1:x:y:z');

\echo '   a meeting between employees'
set role authenticated;
select test.login('tm_a');
insert into mo select 'emp', (x ->> 'id')::uuid from (select mtg_create(jsonb_build_object('title', 'Stand-up', 'kind', 'MEETING',
  'startsAt', date_trunc('hour', now()) + interval '3 days 10 hours', 'endsAt', date_trunc('hour', now()) + interval '3 days 11 hours',
  'attendeeIds', jsonb_build_array(test.id('ck_a')))) x) s;
reset role;
select test.check((select count(*) = 2 from meeting_mail_outbox where meeting_id = (select id from mo where k = 'emp') and kind = 'CONFIRMED' and to_profile_id in (test.id('tm_a'), test.id('ck_a'))),
  'the creator and the invited colleague each get the meeting e-mail');
select test.check((select bool_and(to_email = lower(p.email)) from meeting_mail_outbox o join profiles p on p.id = o.to_profile_id where o.meeting_id = (select id from mo where k = 'emp')),
  'to their own e-mail address');
select test.check((select count(*) = 0 from meeting_mail_outbox where meeting_id = (select id from mo where k = 'emp') and to_profile_id = test.id('sa')),
  'the Super Admin, not invited, gets no e-mail');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('sa') and entity_id = (select id from mo where k = 'emp')
                     and type not like 'MEETING_OVERSIGHT%'),
  'nor an invitation notice');
-- Task 05 (20270206000100): the Managing Director is told a team meeting exists (a separate awareness notice, not an invitation);
-- the meeting stays out of their calendar, as checked below
select test.check((select count(*) <= 1 from notifications where recipient_id = test.id('sa') and entity_id = (select id from mo where k = 'emp')
                     and type like 'MEETING_OVERSIGHT%'),
  'at most one awareness notice (once the meeting notifications migration is run)');
set role authenticated;
select test.login('sa');
select test.check((select count(*) = 0 from jsonb_array_elements(mtg_list(now(), now() + interval '30 days')) x where (x ->> 'id')::uuid = (select id from mo where k = 'emp')),
  'the Super Admin does not see an employee meeting they are not part of');
select test.check((select count(*) = 0 from jsonb_array_elements(mtg_list(now(), now() + interval '30 days', test.id('tm_a'))) x),
  'not even when asking for that colleague''s calendar');
select test.must_fail($$select mtg_detail((select id from mo where k = 'emp'))$$, 'nor open it', 'NOT_FOUND');
select test.must_fail($$select mtg_cancel((select id from mo where k = 'emp'), 'no')$$, 'nor cancel it', 'NOT_FOUND');
reset role;

\echo '   asking the Super Admin for time: the one asking organises the event'
set role authenticated;
select test.login('ck_b');
insert into mo select 'req', (x ->> 'id')::uuid from (select mtg_create(jsonb_build_object('title', 'Pricing for Surat', 'hostId', test.id('sa'), 'description', 'Pricing for the Surat launch',
  'startsAt', date_trunc('hour', now()) + interval '4 days 12 hours', 'endsAt', date_trunc('hour', now()) + interval '4 days 12 hours 30 minutes')) x) s;
reset role;
select test.check((select count(*) = 0 from meeting_mail_outbox where meeting_id = (select id from mo where k = 'req')), 'a request sends no meeting e-mail yet');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REQUESTED' and entity_id = (select id from mo where k = 'req')),
  'the Super Admin is asked');
set role authenticated;
select test.login('sa');
select test.check((select count(*) = 1 from jsonb_array_elements(mtg_list(now(), now() + interval '30 days')) x where (x ->> 'id')::uuid = (select id from mo where k = 'req')),
  'and sees the request (they are its host)');
select test.check((select mtg_decide((select id from mo where k = 'req'), 'APPROVE') ->> 'status' = 'SCHEDULED'), 'the Super Admin approves');
reset role;
select test.check((select google_sync_status = 'PENDING' from meetings where id = (select id from mo where k = 'req')),
  'the approved meeting waits for Google although the Super Admin has no Google connection (the one asking has)');
select test.check((select count(*) = 2 from meeting_mail_outbox where meeting_id = (select id from mo where k = 'req') and kind = 'CONFIRMED' and to_profile_id in (test.id('sa'), test.id('ck_b'))),
  'the Super Admin and the one asking each get the meeting e-mail');
select set_config('request.jwt.claims', '', false);
create temp table claimed as select x from jsonb_array_elements(mtg_sync_claim(50)) x where (x ->> 'id')::uuid = (select id from mo where k = 'req');
select test.check((select (x ->> 'googleOwnerId')::uuid = test.id('ck_b') and x ->> 'organizerEmail' = (select email from profiles where id = test.id('ck_b'))
                     and x ->> 'hostEmail' = (select email from profiles where id = test.id('sa')) from claimed),
  'the worker is told to use the calendar of the one asking, with the Super Admin as a guest');
select mtg_sync_result((select id from mo where k = 'req'), (select version from meetings where id = (select id from mo where k = 'req')), true, 'evt-req', 'primary');
select test.check((select google_owner_id = test.id('ck_b') and google_sync_status = 'SYNCED' from meetings where id = (select id from mo where k = 'req')),
  'the event is recorded on that calendar');
select test.check((select count(*) >= 1 from jsonb_array_elements(mtg_mail_claim(100)) x
                    where (x ->> 'meeting')::jsonb ->> 'id' = (select id from mo where k = 'req')::text and x ->> 'organizerEmail' = (select email from profiles where id = test.id('ck_b'))
                      and (x ->> 'toProfileId') is not null),
  'the e-mails name the organiser, so the server knows which one Google already sent');

\echo '   the Super Admin moves it: the update goes to the same calendar'
set role authenticated;
select test.login('sa');
select test.check((select mtg_reschedule((select id from mo where k = 'req'), date_trunc('hour', now()) + interval '5 days 12 hours',
  date_trunc('hour', now()) + interval '5 days 12 hours 30 minutes', 'The board meets that morning') ->> 'status' = 'SCHEDULED'), 'the Super Admin moves the meeting (with the reason)');
reset role;
select test.check((select google_owner_id = test.id('ck_b') and google_sync_status = 'PENDING' from meetings where id = (select id from mo where k = 'req')),
  'the change goes to the event on the calendar of the one asking');
select test.check((select count(*) = 2 from meeting_mail_outbox where meeting_id = (select id from mo where k = 'req') and kind = 'RESCHEDULED' and to_profile_id is not null),
  'both are e-mailed the new time');

\echo '   a declined request'
set role authenticated;
select test.login('ck_b');
insert into mo select 'dec', (x ->> 'id')::uuid from (select mtg_create(jsonb_build_object('title', 'Leave question', 'hostId', test.id('sa'), 'description', 'A question about leave',
  'startsAt', date_trunc('hour', now()) + interval '6 days 15 hours', 'endsAt', date_trunc('hour', now()) + interval '6 days 15 hours 30 minutes')) x) s;
select test.login('sa');
select mtg_decide((select id from mo where k = 'dec'), 'DECLINE', 'Please ask HR');
reset role;
select test.check((select count(*) = 1 and bool_and(to_profile_id = test.id('ck_b')) from meeting_mail_outbox where meeting_id = (select id from mo where k = 'dec') and kind = 'DECLINED'),
  'only the one asking is e-mailed the decline');

\echo '   one Super Admin may still decide for another; an employee may not'
select test.check((select private.mtg_can_decide(m, test.id('sa')) from meetings m where m.id = (select id from mo where k = 'dec')), 'the Super Admin decides requests for their own time');
select test.check((select not private.mtg_can_decide(m, test.id('ck_a')) from meetings m where m.id = (select id from mo where k = 'dec')), 'a colleague who is not a delegate does not');
select test.check((select not private.mtg_can_view(m, test.id('sa')) from meetings m where m.id = (select id from mo where k = 'emp')), 'the Super Admin cannot view an employee meeting');

\echo '   events made before this change stay on the host''s calendar'
update meetings set google_event_id = 'evt-old', google_owner_id = null, created_by = test.id('ck_a') where id = (select id from mo where k = 'emp');
\i supabase/migrations/20270113000100_meetings_creator_organiser.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql
select test.check((select google_owner_id = host_id from meetings where id = (select id from mo where k = 'emp')),
  'an event already on a calendar keeps being updated there');

\echo '   connecting a calendar sends the meetings it organises'
update meetings set google_sync_status = 'NOT_CONNECTED', google_owner_id = null, google_event_id = null where id = (select id from mo where k = 'req');
delete from google_calendar_connections where profile_id = test.id('ck_b');
select mtg_connection_saved(test.id('sa'));
select test.check((select google_sync_status = 'NOT_CONNECTED' from meetings where id = (select id from mo where k = 'req')),
  'the Super Admin connecting does not send a meeting the one asking organises');
insert into google_calendar_connections (profile_id, google_email, refresh_token_enc) values (test.id('ck_b'), 'ck.b@example.com', 'v1:x:y:z');
select mtg_connection_saved(test.id('ck_b'));
select test.check((select google_sync_status = 'PENDING' from meetings where id = (select id from mo where k = 'req')),
  'the one asking connecting does');

-- clean up
reset role;
delete from meetings where host_id in (test.id('sa'), test.id('tm_a'), test.id('ck_a'), test.id('ck_b'));
delete from google_calendar_connections where profile_id in (test.id('sa'), test.id('tm_a'), test.id('ck_b'));
delete from notifications where type like 'MEETING%';
\echo '=== MEETINGS ORGANISER TESTS PASSED ==='
