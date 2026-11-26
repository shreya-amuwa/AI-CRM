-- =============================================================================
-- Enter Meeting / Exit Meeting for every employee (migration 20270122000100; the Super Admin's own again from 20270128000100): Department
-- Head, Team Lead, Team Member, BUSY / AVAILABLE with the entry and exit times, what colleagues see,
-- no booking into a meeting starting within 30 minutes while BUSY, the former CEO queue moved to ordinary requests, and that asking the
-- CEO for time still works. Own synthetic meetings (title 'EP %'). The Super Admin's own Enter / Exit and queue: meeting_ceo_queue_test.sql.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133. Employee availability (Enter / Exit Meeting)'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270116000400_meeting_live_availability.sql
delete from meetings where title like 'EP %';
delete from meeting_presence;
delete from meeting_presence_log;
-- a request that was waiting for the CEO under the old rules (20270116000400): it must become an ordinary request, not be lost
insert into meetings (kind, title, description, host_id, created_by, starts_at, ends_at, status, requires_approval, booked_via)
values ('CEO_MEETING', 'EP waiting for the CEO', 'Budget approval', test.id('sa'), test.id('tm_a'), now() + interval '3 days', now() + interval '3 days 30 minutes',
        'PENDING_AVAILABILITY', true, 'STAFF');
insert into meeting_presence (host_id, status, since) values (test.id('sa'), 'BUSY', now() - interval '10 minutes');
insert into meeting_presence_log (host_id, entered_at) values (test.id('sa'), now() - interval '10 minutes');
\i supabase/migrations/20270122000100_meeting_presence_all_employees.sql
\i supabase/migrations/20270122000100_meeting_presence_all_employees.sql
create or replace function test.ep(p_title text) returns setof public.meetings language sql stable security definer set search_path = '' as $$
  select * from public.meetings where title = p_title $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   the old CEO queue'
select test.check((select status = 'REQUESTED' from test.ep('EP waiting for the CEO')), 'a request that waited for the CEO is now an ordinary request for the Super Admin to decide');
select test.check((select count(*) = 1 from meeting_events e join meetings m on m.id = e.meeting_id where m.title = 'EP waiting for the CEO' and e.kind = 'MOVED_TO_REQUESTS'),
  '... and its history says so');
select test.check((select status = 'AVAILABLE' from meeting_presence where host_id = test.id('sa'))
                  and not exists (select 1 from meeting_presence_log where host_id = test.id('sa') and exited_at is null), 'the Super Admin is no longer BUSY; the open entry is closed');

-- the Super Admin's Enter / Exit and queue came back in 20270128000100 (meeting_ceo_queue_test.sql); from here on, the newest definitions
reset role;
\i supabase/migrations/20270128000100_ceo_meeting_queue.sql
set role authenticated;
select test.login('sa');
select test.must_fail($$insert into meeting_presence (host_id, status) values (test.id('sa'), 'BUSY')$$, 'nobody writes the status directly', 'permission denied');
select test.must_fail($$select mtg_pending_process(test.id('sa'))$$, 'the old queue functions are not callable', 'permission denied');

\echo '   every other employee can'
select test.login('dh_wab');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY' and (mtg_presence_exit() ->> 'status') = 'AVAILABLE', 'a Department Head enters and exits a meeting');
select test.login('th_wab');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'a Team Lead enters a meeting');
select test.login('tm_a');
select test.check((mtg_presence() -> 0 ->> 'status') = 'AVAILABLE', 'a Team Member starts AVAILABLE');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'a Team Member enters a meeting: BUSY');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'a second click changes nothing');
reset role;
select test.check((select count(*) = 1 and bool_and(exited_at is null and entered_at > now() - interval '1 minute') from meeting_presence_log where host_id = test.id('tm_a')),
  'the entry time is recorded once');
set role authenticated;
select test.login('tm_b');
select test.must_fail($$update meeting_presence set status = 'AVAILABLE' where host_id = test.id('tm_a')$$, 'a colleague cannot change someone else''s status', 'permission denied');
select test.check((select x ->> 'status' = 'BUSY' and x -> 'meeting' = 'null'::jsonb from jsonb_array_elements(mtg_presence(array[test.id('tm_a'), test.id('th_wab'), test.id('dh_wab')])) x
                    where (x ->> 'hostId')::uuid = test.id('tm_a')), 'colleagues see the Team Member BUSY (no meeting details)');
select test.check((select count(*) = 3 from jsonb_array_elements(mtg_presence(array[test.id('tm_a'), test.id('th_wab'), test.id('dh_wab')]))), 'the statuses of the people asked about');
select test.check((select x ->> 'status' = 'AVAILABLE' from jsonb_array_elements(mtg_presence(array[test.id('dh_wab')])) x), 'the Department Head who exited is AVAILABLE');

\echo '   no booking into a meeting starting soon with someone BUSY'
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'EP soon', 'startsAt', now() + interval '10 minutes', 'endsAt', now() + interval '40 minutes',
                                                              'attendeeIds', jsonb_build_array(test.id('tm_a'))))$$,
  'a meeting starting in 10 minutes with the BUSY colleague is refused', 'is in a meeting right now');
reset role;
select test.check(not exists (select 1 from meetings where title = 'EP soon'), 'nothing was saved');
set role authenticated;
select test.check((mtg_create(jsonb_build_object('title', 'EP later', 'startsAt', now() + interval '3 hours', 'endsAt', now() + interval '4 hours',
                                                 'attendeeIds', jsonb_build_array(test.id('tm_a')))) ->> 'status') = 'SCHEDULED',
  'a meeting later in the day can still be booked (nobody knows when they will exit)');
select test.login('tm_a');
select test.check((mtg_create(jsonb_build_object('title', 'EP own while busy', 'startsAt', now() + interval '10 minutes', 'endsAt', now() + interval '40 minutes')) ->> 'status') = 'SCHEDULED',
  'the BUSY person can still book their own next meeting');
select test.check((mtg_presence_exit() ->> 'status') = 'AVAILABLE', 'Exit Meeting: AVAILABLE');
reset role;
select test.check((select count(*) = 1 and bool_and(exited_at is not null and exited_at >= entered_at) from meeting_presence_log where host_id = test.id('tm_a')),
  'the exit time is recorded');
select test.check((select count(*) = 1 from audit_logs where action = 'MEETING_PRESENCE_EXITED' and entity_id = test.id('tm_a') and created_at > now() - interval '1 minute'),
  'entering and exiting are audited');
set role authenticated;
select test.login('tm_b');
select test.check((mtg_create(jsonb_build_object('title', 'EP soon after exit', 'startsAt', now() + interval '10 minutes', 'endsAt', now() + interval '40 minutes',
                                                 'attendeeIds', jsonb_build_array(test.id('tm_a')))) ->> 'status') = 'SCHEDULED',
  'once they exit, the same booking works');

\echo '   asking the CEO for time works as before'
select test.check((mtg_create(jsonb_build_object('title', 'EP ask the CEO', 'hostId', test.id('sa'), 'startsAt', now() + interval '2 days',
                                                 'endsAt', now() + interval '2 days 30 minutes', 'description', 'Budget discussion')) ->> 'status') = 'REQUESTED',
  'while the Super Admin is AVAILABLE, a request for their time is a request for them to approve');
select test.login('th_wab');
select mtg_presence_exit();
reset role;
delete from meetings where title like 'EP %';
select set_config('request.jwt.claims', '', false);
