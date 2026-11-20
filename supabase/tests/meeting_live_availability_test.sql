-- =============================================================================
-- Live meeting availability of the CEO (migration 20270116000400): Enter / Exit Meeting, requests saved while the CEO is BUSY, and the
-- automatic scheduling on Exit (queue order, working hours, held meetings, Google busy times, no overlaps), notifications to the one who
-- asked only, audit history and who may do what. Own synthetic meetings (title 'LA %'). Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133. Live meeting availability (Enter / Exit Meeting)'
reset role;
select set_config('request.jwt.claims', '', false);
-- the earlier meetings suite re-runs 20270101000500 (an older mtg_create): put the newest definitions back, twice (safe to run again)
\i supabase/migrations/20270116000400_meeting_live_availability.sql
\i supabase/migrations/20270116000400_meeting_live_availability.sql
delete from meetings where title like 'LA %';
delete from meeting_presence;
delete from meeting_presence_log;
-- the CEO's working hours for this test: every day 09:00-18:00 India time (so the test does not depend on the weekday it runs)
delete from meeting_availability where host_id = test.id('sa');
insert into meeting_host_settings (host_id, timezone) values (test.id('sa'), 'Asia/Kolkata') on conflict (host_id) do update set timezone = 'Asia/Kolkata';
insert into meeting_availability (host_id, weekday, start_time, end_time) select test.id('sa'), d, '09:00', '18:00' from generate_series(0, 6) d;
delete from meeting_delegates where host_id = test.id('sa');
create or replace function test.la_at(p_hhmm text) returns timestamptz language sql stable as $$
  select ((current_date + 7) + p_hhmm::time) at time zone 'Asia/Kolkata' $$;
create or replace function test.la(p_title text) returns setof public.meetings language sql stable security definer set search_path = '' as $$
  select * from public.meetings where title = p_title $$;
create or replace function test.la_notes(p_user text, p_type text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications n where n.recipient_id = test.id(p_user) and n.type = p_type
     and (n.entity_id in (select id from public.meetings where title like 'LA %') or n.type = 'CEO_AVAILABLE') $$;
create or replace function test.la_req(p_title text, p_hhmm text, p_minutes int) returns jsonb language sql as $$
  select mtg_create(jsonb_build_object('title', p_title, 'hostId', test.id('sa'), 'startsAt', test.la_at(p_hhmm),
                                       'endsAt', test.la_at(p_hhmm) + make_interval(mins => p_minutes), 'description', 'Purpose: ' || p_title)) $$;
grant execute on all functions in schema test to anon, authenticated;
delete from notifications where type in ('CEO_AVAILABLE', 'MEETING_PENDING_AVAILABILITY', 'MEETING_MOVED');

\echo '   1. the CEO has a confirmed meeting at 11:00-11:30 that day, and enters a meeting now'
set role authenticated;
select test.login('sa');
select mtg_create(jsonb_build_object('title', 'LA CEO own', 'startsAt', test.la_at('11:00'), 'endsAt', test.la_at('11:30')));
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'Enter Meeting: the CEO is BUSY');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'a second click changes nothing');
reset role;
select test.check((select count(*) = 1 and bool_and(exited_at is null and entered_at <= now()) from meeting_presence_log where host_id = test.id('sa')),
  'the start time is recorded (one open entry)');
select test.check((select count(*) = 1 from audit_logs where action = 'MEETING_PRESENCE_ENTERED' and entity_id = test.id('sa') and created_at > now() - interval '1 minute'),
  'Enter is in the audit log');

\echo '   2. a Team Member sees BUSY and cannot change it'
set role authenticated;
select test.login('tm_a');
select test.check((select status = 'BUSY' from meeting_presence where host_id = test.id('sa')), 'Team Member A reads BUSY (the table Realtime sends)');
select test.check((select (x ->> 'status') = 'BUSY' and x -> 'meeting' = 'null'::jsonb and x -> 'pending' = 'null'::jsonb
                     from jsonb_array_elements(mtg_presence()) x where (x ->> 'hostId')::uuid = test.id('sa')),
  '... and through the API, without the CEO''s meeting details or queue');
select test.must_fail($$select mtg_presence_exit()$$, 'a Team Member cannot Exit for the CEO', 'Only the Super Admin');
select test.must_fail($$select mtg_presence_enter()$$, 'nor Enter', 'Only the Super Admin');
select test.must_fail($$update meeting_presence set status = 'AVAILABLE'$$, 'nor write the status directly', 'permission denied');
select test.must_fail($$select mtg_pending_process(test.id('sa'), null)$$, 'nor run the scheduling', 'permission denied');

\echo '   3. requests made while the CEO is BUSY are saved, not refused'
select test.la_req('LA Request A', '11:00', 60);   -- overlaps the CEO's own meeting: still saved
reset role;
select test.check((select status = 'PENDING_AVAILABILITY' and requested_starts_at = test.la_at('11:00') and ends_at - starts_at = interval '60 minutes'
                          and created_by = test.id('tm_a') and description = 'Purpose: LA Request A' from test.la('LA Request A')),
  'request A is saved as PENDING AVAILABILITY with the date, time, length, purpose and who asked');
select test.check(test.la_notes('tm_a', 'MEETING_PENDING_AVAILABILITY') = 1, 'Team Member A is told it was received while the CEO is busy');
select test.check((select count(*) = 0 from notifications n where n.recipient_id = test.id('sa') and n.type = 'MEETING_REQUESTED'
                     and n.entity_id = (select id from test.la('LA Request A'))), 'the busy CEO is not interrupted with an approval request');
select test.check((select count(*) = 1 from audit_logs where action = 'MEETING_PENDING_AVAILABILITY' and entity_id = (select id from test.la('LA Request A'))), 'it is audited');
set role authenticated;
select test.login('tm_b');
select test.la_req('LA Request B', '11:00', 30);   -- the same time: also saved
select test.login('tm_c');
select test.la_req('LA Request C', '17:30', 60);   -- would end after 18:00: goes to the next day
select test.la_req('LA Request D', '09:00', 30);
select mtg_cancel((select id from test.la('LA Request D')), 'No longer needed');
reset role;
select test.check((select status = 'CANCELLED' from test.la('LA Request D')), 'a waiting request can be cancelled by the one who asked');
select test.check((select count(*) = 3 from meetings where title like 'LA Request %' and status = 'PENDING_AVAILABILITY'), 'three requests wait in the queue');
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.check(jsonb_array_length(mtg_pending_process(test.id('sa'), null)) = 0, 'nothing is scheduled while the CEO is still BUSY');
select test.check(not (mtg_pending_hosts() @> to_jsonb(array[test.id('sa')])), '... and the safety net does not pick a busy CEO');
select set_config('request.jwt.claims', '', false);

\echo '   4. the CEO sees their own queue'
set role authenticated;
select test.login('sa');
select test.check((select jsonb_array_length(x -> 'pending') = 3 and (x -> 'pending' -> 0 ->> 'title') = 'LA Request A'
                     from jsonb_array_elements(mtg_presence()) x where (x ->> 'hostId')::uuid = test.id('sa')),
  'the CEO sees the three waiting requests, oldest first');

\echo '   5. Exit Meeting: AVAILABLE, and the queue is scheduled in order without overlaps'
-- the CEO's Google Calendar is busy 12:30-13:00 that day (the server passes it in)
select test.check((select (r ->> 'status') = 'AVAILABLE' and jsonb_array_length(r -> 'scheduled') = 3
                     from (select mtg_presence_exit(jsonb_build_array(jsonb_build_object('start', test.la_at('12:30'), 'end', test.la_at('13:00')),
                                                                       jsonb_build_object('start', 'garbage', 'end', 'x'))) r) s),
  'Exit Meeting: AVAILABLE, and the three requests are scheduled');
reset role;
select test.check((select status = 'AVAILABLE' from meeting_presence where host_id = test.id('sa')), 'the status is AVAILABLE for everyone');
select test.check((select count(*) = 1 and bool_and(exited_at is not null and exited_at >= entered_at and scheduled_count = 3)
                     from meeting_presence_log where host_id = test.id('sa')), 'the end time is recorded, with how many were scheduled');
select test.check((select status = 'SCHEDULED' and starts_at = test.la_at('11:30') and ends_at = test.la_at('12:30') and requested_starts_at = test.la_at('11:00')
                     from test.la('LA Request A')), 'A (first in the queue): the next free hour after the CEO''s own meeting, 11:30-12:30');
select test.check((select status = 'SCHEDULED' and starts_at = test.la_at('13:00') and ends_at = test.la_at('13:30') from test.la('LA Request B')),
  'B: after A, and after the Google busy time 12:30-13:00, so 13:00-13:30');
select test.check((select status = 'SCHEDULED' and starts_at = ((current_date + 8) + time '09:00') at time zone 'Asia/Kolkata' from test.la('LA Request C')),
  'C: 17:30 + 1 hour is past working hours, so 09:00 the next day');
select test.check((select starts_at = test.la_at('11:00') and ends_at = test.la_at('11:30') and status = 'SCHEDULED' from test.la('LA CEO own')),
  'the CEO''s confirmed meeting is untouched');
select test.check(not exists (select 1 from meetings a join meetings b on a.id < b.id and a.host_id = b.host_id
                              where a.host_id = test.id('sa') and a.status = 'SCHEDULED' and b.status = 'SCHEDULED'
                                and a.title like 'LA %' and b.title like 'LA %' and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)),
  'no two of the CEO''s meetings overlap');
select test.check((select google_sync_status in ('PENDING', 'NOT_CONNECTED') from test.la('LA Request A')), 'the scheduled meeting goes to Google Calendar through the existing sync');

\echo '   6. notifications reach the one who asked, and only them'
select test.check(test.la_notes('tm_a', 'CEO_AVAILABLE') = 1 and test.la_notes('tm_a', 'MEETING_SCHEDULED') = 1 and test.la_notes('tm_a', 'MEETING_MOVED') = 1,
  'A is told the CEO is free, the confirmed time, and that it moved from 11:00');
select test.check((select body ~ 'Confirmed for' from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_SCHEDULED'
                     and entity_id = (select id from test.la('LA Request A'))), '... with the confirmed date and time');
select test.check(test.la_notes('tm_b', 'MEETING_SCHEDULED') = 1 and test.la_notes('tm_b', 'MEETING_MOVED') = 1, 'B is told too');
select test.check((select count(*) = 0 from notifications n where n.recipient_id = test.id('tm_a') and n.entity_id = (select id from test.la('LA Request B'))),
  'A hears nothing about B''s meeting');
select test.check((select count(*) = 1 from audit_logs where action = 'MEETING_PRESENCE_EXITED' and entity_id = test.id('sa') and created_at > now() - interval '1 minute')
                  and (select count(*) = 3 from audit_logs where action = 'MEETING_AUTO_SCHEDULED' and entity_id in (select id from meetings where title like 'LA Request %')),
  'Exit and each automatic booking are audited');
select test.check((select count(*) = 3 from meeting_events where kind = 'AUTO_SCHEDULED' and meeting_id in (select id from meetings where title like 'LA Request %')),
  'each meeting''s history says it was scheduled automatically');

\echo '   7. while AVAILABLE, the usual approval flow is unchanged'
set role authenticated;
select test.login('tm_a');
select test.la_req('LA Request E', '15:00', 30);
reset role;
select test.check((select status = 'REQUESTED' from test.la('LA Request E')), 'a request while the CEO is free waits for approval as before');
set role authenticated;
select test.login('tm_c');
select test.must_fail($$select test.la_req('LA Request F', '15:00', 30)$$, 'and its time is held: nobody else can ask for it', 'already has a meeting');
select test.login('sa');
select test.check((mtg_presence_exit() ->> 'status') = 'AVAILABLE', 'Exit when already available changes nothing');
reset role;
select test.check((select count(*) = 1 from meeting_presence_log where host_id = test.id('sa')), 'and records no new entry');
delete from meetings where title like 'LA %';
delete from meeting_availability where host_id = test.id('sa');
delete from meeting_presence;
select set_config('request.jwt.claims', '', false);
