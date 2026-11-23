-- =============================================================================
-- The Super Admin's meeting queue (migration 20270128000100): Enter makes the Super Admin BUSY; "Ask the CEO for time" while BUSY joins the
-- queue (PENDING_AVAILABILITY); EACH Exit confirms exactly ONE request (the oldest still waiting), starting at the Exit, with the Google Meet
-- of a connected organiser or the Super Admin's fixed room link (never a made-up one); notifications and the "join now" e-mail once each; a
-- second Exit, a withdrawn request or an empty queue confirm nothing; employees keep their own Enter / Exit. Own meetings (title 'EQ %').
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133b. The Super Admin''s meeting queue (one per Exit)'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270128000100_ceo_meeting_queue.sql
\i supabase/migrations/20270128000100_ceo_meeting_queue.sql
delete from meetings where title like 'EQ %';
delete from meeting_presence;
delete from meeting_presence_log;
delete from google_calendar_connections where profile_id in (test.id('tm_a'), test.id('tm_b'), test.id('tm_c'), test.id('sa'));
delete from notifications where type in ('MEETING_PENDING_AVAILABILITY', 'MEETING_QUEUE_SCHEDULED');
create or replace function test.eq(p_title text) returns public.meetings language sql stable security definer set search_path = '' as $$
  select * from public.meetings where title = p_title limit 1 $$;
create or replace function test.eq_ask(p_title text, p_minutes int) returns jsonb language sql as $$
  select mtg_create(jsonb_build_object('title', p_title, 'hostId', test.id('sa'), 'startsAt', now() + interval '2 days',
                                       'endsAt', now() + interval '2 days' + make_interval(mins => p_minutes), 'description', 'Purpose: ' || p_title)) $$;
create or replace function test.eq_mails(p_title text, p_user text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.meeting_mail_outbox o join public.meetings m on m.id = o.meeting_id
   where m.title = p_title and o.kind = 'QUEUE_CONFIRMED' and o.to_profile_id = test.id(p_user) $$;
-- one transaction has one now(): give each request its own age so "oldest first" is defined
create or replace function test.eq_age(p_title text, p_minutes int) returns void language sql security definer set search_path = '' as $$
  update public.meetings set created_at = now() - make_interval(mins => p_minutes) where title = p_title $$;
grant execute on all functions in schema test to anon, authenticated;
create temp table eq (k text primary key, v jsonb);
grant all on eq to authenticated;

\echo '   the room link'
set role authenticated;
select test.login('sa');
select test.must_fail($$select mtg_room_link_set('http://insecure.example/room')$$, 'the room link is https', 'https');
select test.check((mtg_room_link_set('https://meet.example.com/ceo-room') ->> 'roomLink') = 'https://meet.example.com/ceo-room', 'the Super Admin saves the fixed meeting-room link');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select mtg_room_link_set('https://meet.example.com/mine')$$, 'only the CEO keeps a room link', 'Only the CEO');
select test.login('sa');

\echo '   Enter: BUSY, and requests join the queue'
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'the Super Admin enters a meeting: BUSY');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY', 'a second Enter changes nothing');
select test.login('tm_a');
select test.check((select x ->> 'status' = 'BUSY' from jsonb_array_elements(mtg_ceo_presence()) x where (x ->> 'hostId')::uuid = test.id('sa')),
  'employees see the CEO BUSY');
select test.check((test.eq_ask('EQ First', 30) ->> 'status') = 'PENDING_AVAILABILITY', 'a request while BUSY joins the queue');
select test.eq_age('EQ First', 30);
select test.login('tm_b');
select test.check((test.eq_ask('EQ Second', 45) ->> 'status') = 'PENDING_AVAILABILITY', 'a second one too');
select test.eq_age('EQ Second', 20);
select test.login('tm_c');
select test.check((test.eq_ask('EQ Third', 20) ->> 'status') = 'PENDING_AVAILABILITY', 'and a third');
select test.eq_age('EQ Third', 10);
reset role;
select test.check((select count(*) = 3 from notifications where type = 'MEETING_PENDING_AVAILABILITY' and recipient_id in (test.id('tm_a'), test.id('tm_b'), test.id('tm_c'))),
  'each one who asked gets a receipt with their place in the queue');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('sa') and entity_id in (select id from meetings where title like 'EQ %')),
  'the busy Super Admin is not interrupted');
set role authenticated;
select test.login('sa');
select test.check((select jsonb_array_length(x -> 'pending') = 3 and x -> 'pending' -> 0 ->> 'title' = 'EQ First' from (select mtg_presence() -> 0 as x) s),
  'the Super Admin sees the queue, oldest first');
select test.login('tm_b');
select mtg_cancel((test.eq('EQ Second')).id, 'Not needed any more');
select test.check((select status = 'CANCELLED' from test.eq('EQ Second')), 'a request can be withdrawn while it waits');

\echo '   Exit confirms exactly ONE: the oldest still waiting, starting now, with the room link'
select test.login('sa');
insert into eq select 'exit1', mtg_presence_exit();
select test.check((select v ->> 'status' = 'AVAILABLE' and jsonb_array_length(v -> 'scheduled') = 1 and v -> 'scheduled' -> 0 ->> 'title' = 'EQ First' from eq where k = 'exit1'),
  'Exit: AVAILABLE, and exactly one request is confirmed: the oldest (tm_a)');
reset role;
select test.check((select status = 'SCHEDULED' and starts_at <= now() and starts_at > now() - interval '2 minutes' and ends_at - starts_at = interval '30 minutes'
                     and mode = 'ONLINE_LINK' and meet_link = 'https://meet.example.com/ceo-room' and decided_by = test.id('sa') from test.eq('EQ First')),
  'it starts at the Exit, lasts as long as asked, in the Super Admin''s meeting room');
select test.check((select status = 'PENDING_AVAILABILITY' from test.eq('EQ Third')), 'the next one keeps waiting (one per Exit)');
select test.check((select status = 'CANCELLED' from test.eq('EQ Second')), 'the withdrawn one is untouched');
select test.check(test.eq_mails('EQ First', 'tm_a') = 1 and test.eq_mails('EQ First', 'sa') = 1, 'the "scheduled, join now" e-mail is queued once to the employee and once to the Super Admin');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_SCHEDULED' and entity_id = (test.eq('EQ First')).id)
                  and (select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_QUEUE_SCHEDULED' and entity_id = (test.eq('EQ First')).id),
  'the employee and the Super Admin are notified');
select test.check((select count(*) = 1 from meeting_events e where e.meeting_id = (test.eq('EQ First')).id and e.kind = 'AUTO_SCHEDULED')
                  and (select count(*) = 1 from audit_logs where action = 'MEETING_QUEUE_SCHEDULED' and entity_id = (test.eq('EQ First')).id), 'its history and the audit say so');

\echo '   no double confirmation'
set role authenticated;
select test.login('sa');
select test.check(jsonb_array_length(mtg_presence_exit() -> 'scheduled') = 0, 'a second Exit (already AVAILABLE) confirms nothing');
reset role;
select test.check((select status = 'PENDING_AVAILABILITY' from test.eq('EQ Third')) and test.eq_mails('EQ First', 'tm_a') = 1, 'the third still waits; no second e-mail');
set role authenticated;
select test.login('tm_c');
select test.check(jsonb_array_length(mtg_presence_exit() -> 'scheduled') = 0, 'an employee''s Exit never confirms the CEO''s queue');
select test.login('tm_a');
select test.must_fail($$update meetings set status = 'SCHEDULED' where title = 'EQ Third'$$, 'nobody confirms a queued request past the functions', 'permission denied');

\echo '   the next Exit confirms the next one; with Google Meet when the organiser is connected'
reset role;
insert into google_calendar_connections (profile_id, refresh_token_enc, status) values (test.id('tm_c'), 'x', 'CONNECTED') on conflict (profile_id) do update set status = 'CONNECTED';
set role authenticated;
select test.login('sa');
select mtg_presence_enter();
select test.login('tm_a');
select test.check((test.eq_ask('EQ Fourth', 15) ->> 'status') = 'PENDING_AVAILABILITY', 'while BUSY again, another request queues behind the third');
select test.login('sa');
select test.check((select x -> 0 ->> 'title' = 'EQ Third' from (select mtg_presence_exit() -> 'scheduled' as x) s), 'the next Exit confirms the third (skipping the withdrawn one)');
reset role;
select test.check((select status = 'SCHEDULED' and mode = 'GOOGLE_MEET' and meet_link is null and google_sync_status = 'PENDING' from test.eq('EQ Third')),
  'its organiser has Google connected: Google Meet, created by the calendar sync (no link made up)');
select test.check((select status = 'PENDING_AVAILABILITY' from test.eq('EQ Fourth')), 'the fourth waits for the next Exit');
set role authenticated;
select test.login('sa');
select mtg_presence_enter();
select mtg_presence_exit();
select mtg_presence_enter();
select test.check(jsonb_array_length(mtg_presence_exit() -> 'scheduled') = 0, 'an Exit with an empty queue confirms nothing');

\echo '   while AVAILABLE, asking the CEO works as before; employees keep their own Enter / Exit'
select test.login('tm_b');
select test.check((test.eq_ask('EQ While available', 30) ->> 'status') = 'REQUESTED', 'asking while the CEO is AVAILABLE is a request to approve');
select test.check((mtg_presence_enter() ->> 'status') = 'BUSY' and (mtg_presence_exit() ->> 'status') = 'AVAILABLE', 'an employee still enters and exits');
reset role;
delete from meetings where title like 'EQ %';
delete from google_calendar_connections where profile_id = test.id('tm_c') and refresh_token_enc = 'x';
update meeting_host_settings set room_link = null where host_id = test.id('sa');
select set_config('request.jwt.claims', '', false);
