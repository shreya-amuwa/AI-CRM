-- =============================================================================
-- Meetings engine (migration 20270101000500, then the Super Admin-only CEO approval 20270114000100; the organiser migration 20270113000100 has its own suite): booking, overlaps, CEO approval, booking links, Google sync queue, reminders,
-- e-mails to guests, and the mirrors of demos / interviews / HR meetings. Reuses sa (Super Admin = the CEO), tm_a, ck_a, ck_b.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 136. Meetings: one booking engine with Google Calendar'
reset role;
\i supabase/migrations/20270101000500_meetings_google_calendar.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql

-- a clean slate for this suite (re-runnable)
delete from meeting_delegates where host_id in (test.id('sa'), test.id('tm_a'));
delete from meeting_booking_types where host_id in (test.id('sa'), test.id('tm_a'));
delete from meeting_availability where host_id in (test.id('sa'), test.id('tm_a'));
delete from google_calendar_connections where profile_id in (test.id('sa'), test.id('tm_a'));
delete from meetings where host_id in (test.id('sa'), test.id('tm_a'), test.id('ck_a'));
delete from notifications where type like 'MEETING%' or type like 'GOOGLE_CALENDAR%';
delete from ba_demos where title in ('Mirror demo', 'Backfill demo');
delete from career_interviews where location = 'Head office' and interviewer_id = test.id('tm_a');
create temp table mt (k text primary key, id uuid, v integer);
grant all on mt to authenticated;

-- tm_a has connected Google Calendar (the server stored the encrypted token)
insert into google_calendar_connections (profile_id, google_email, refresh_token_enc) values (test.id('tm_a'), 'tm.a@example.com', 'v1:x:y:z');

\echo '   booking my own meeting, with a colleague and a guest'
set role authenticated;
select test.login('tm_a');
select test.check((select (mtg_google_status() ->> 'connected')::boolean), 'tm_a sees their Google Calendar as connected');
select test.check((select count(*) > 0 from jsonb_array_elements(mtg_directory('')) x where (x ->> 'isCeo')::boolean), 'the directory marks the CEO');
insert into mt select 'm1', (x ->> 'id')::uuid, (x ->> 'version')::integer from (select mtg_create(jsonb_build_object(
  'title', 'Weekly pipeline review', 'kind', 'MEETING', 'startsAt', date_trunc('hour', now()) + interval '2 days 10 hours',
  'endsAt', date_trunc('hour', now()) + interval '2 days 11 hours', 'attendeeIds', jsonb_build_array(test.id('ck_a')),
  'guests', jsonb_build_array(jsonb_build_object('name', 'Ravi Guest', 'email', 'Ravi.Guest@Example.com')))) x) s;
reset role;
select test.check((select status = 'SCHEDULED' and google_sync_status = 'PENDING' and created_by = test.id('tm_a') from meetings where id = (select id from mt where k = 'm1')),
  'it is scheduled and waits for the Google sync (the host is connected)');
select test.check((select count(*) = 2 from meeting_attendees where meeting_id = (select id from mt where k = 'm1')), 'the colleague and the guest are invited');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ck_a') and type = 'MEETING_INVITED' and entity_id = (select id from mt where k = 'm1')),
  'the colleague gets an in-app invitation');
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'm1') and kind = 'CONFIRMED' and to_email = 'ravi.guest@example.com'),
  'the guest gets a confirmation e-mail (queued once)');
set role authenticated;
select test.login('ck_b');
select test.must_fail($$select mtg_detail((select id from mt where k = 'm1'))$$, 'a colleague who is not invited cannot open it', 'NOT_FOUND');
select test.check((select count(*) = 0 from jsonb_array_elements(mtg_list(now(), now() + interval '30 days')) x where (x ->> 'id')::uuid = (select id from mt where k = 'm1')),
  'nor sees it in their calendar');
select test.must_fail($$select mtg_cancel((select id from mt where k = 'm1'), 'no')$$, 'nor cancel it', 'NOT_FOUND');
select test.login('ck_a');
select test.check((select count(*) = 1 from jsonb_array_elements(mtg_list(now(), now() + interval '30 days')) x where (x ->> 'id')::uuid = (select id from mt where k = 'm1')),
  'the invited colleague sees it in their calendar');
select test.check((select not (mtg_detail((select id from mt where k = 'm1')) ->> 'canManage')::boolean), 'but cannot change it');
select test.must_fail($$select mtg_reschedule((select id from mt where k = 'm1'), now() + interval '3 days', now() + interval '3 days 1 hour')$$,
  'an invited colleague cannot move it', 'FORBIDDEN');
select test.check((select mtg_respond((select id from mt where k = 'm1'), 'DECLINED') is not null), 'the colleague answers "cannot attend"');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_RESPONSE'), 'the host is told');

\echo '   no double booking'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'Clash', 'startsAt', date_trunc('hour', now()) + interval '2 days 10 hours 30 minutes',
  'endsAt', date_trunc('hour', now()) + interval '2 days 11 hours 30 minutes'))$$, 'an overlapping meeting of the host is refused', 'CONFLICT');
select test.check((select mtg_create(jsonb_build_object('title', 'Clash on purpose', 'startsAt', date_trunc('hour', now()) + interval '2 days 10 hours 30 minutes',
  'endsAt', date_trunc('hour', now()) + interval '2 days 11 hours 30 minutes', 'allowOverlap', true)) ->> 'status' = 'SCHEDULED'),
  'unless the host books the overlap on purpose in their own calendar');
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'Past', 'startsAt', now() - interval '2 days', 'endsAt', now() - interval '2 days' + interval '1 hour'))$$,
  'a meeting in the past is refused', 'VALIDATION_ERROR');
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'Backwards', 'startsAt', now() + interval '2 days', 'endsAt', now() + interval '1 day'))$$,
  'a meeting that ends before it starts is refused', 'VALIDATION_ERROR');
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'For ck_b', 'hostId', test.id('ck_b'), 'startsAt', now() + interval '5 days', 'endsAt', now() + interval '5 days 1 hour'))$$,
  'booking another colleague''s time as host is refused (invite them instead)', 'VALIDATION_ERROR');

\echo '   moving and cancelling'
reset role;
update mt set v = (select version from meetings where id = mt.id) where k = 'm1';
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select mtg_reschedule((select id from mt where k = 'm1'), date_trunc('hour', now()) + interval '4 days 9 hours', date_trunc('hour', now()) + interval '4 days 10 hours', null, (select v - 1 from mt where k = 'm1'))$$,
  'a stale version is refused (someone else changed it)', 'CONFLICT');
select test.check((select mtg_reschedule((select id from mt where k = 'm1'), date_trunc('hour', now()) + interval '4 days 9 hours', date_trunc('hour', now()) + interval '4 days 10 hours', 'Clash with a client call', (select v from mt where k = 'm1')) ->> 'status' = 'SCHEDULED'),
  'the host moves it');
reset role;
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'm1') and kind = 'RESCHEDULED'), 'the guest is e-mailed the new time');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ck_a') and type = 'MEETING_RESCHEDULED'), 'the colleague is told in the CRM');
select test.check((select count(*) = 1 from meeting_events where meeting_id = (select id from mt where k = 'm1') and kind = 'RESCHEDULED'), 'and the history keeps the move');
select test.must_fail($$update meeting_events set note = 'x' where meeting_id = (select id from mt where k = 'm1')$$, 'the history cannot be edited', 'cannot be changed');

\echo '   asking the CEO for time: approval first'
set role authenticated;
select test.login('ck_b');
insert into mt select 'ceo1', (x ->> 'id')::uuid, null from (select mtg_create(jsonb_build_object('title', 'Budget for the Pune office', 'hostId', test.id('sa'),
  'startsAt', date_trunc('hour', now()) + interval '6 days 11 hours', 'endsAt', date_trunc('hour', now()) + interval '6 days 11 hours 30 minutes',
  'description', 'Need a decision on the rent')) x) s;
reset role;
select test.check((select status = 'REQUESTED' and kind = 'CEO_MEETING' and requires_approval from meetings where id = (select id from mt where k = 'ceo1')),
  'a meeting with the CEO is a request, not a booking');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REQUESTED' and entity_id = (select id from mt where k = 'ceo1')),
  'the CEO is asked');
select test.check((select count(*) = 1 from meeting_attendees where meeting_id = (select id from mt where k = 'ceo1') and profile_id = test.id('ck_b') and response = 'ACCEPTED'),
  'the one asking takes part');
set role authenticated;
select test.login('ck_b');
select test.must_fail($$select mtg_decide((select id from mt where k = 'ceo1'), 'APPROVE')$$, 'the one asking cannot approve their own request', 'FORBIDDEN');
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'Same time', 'hostId', test.id('sa'), 'description', 'Another request for the same slot', 'startsAt', date_trunc('hour', now()) + interval '6 days 11 hours',
  'endsAt', date_trunc('hour', now()) + interval '6 days 11 hours 30 minutes'))$$, 'a requested time is held: nobody else can ask for it', 'CONFLICT');
-- the CEO's approvals are not delegated: naming a delegate is refused, and a delegate left over from before cannot decide
select test.login('sa');
select test.must_fail($$select mtg_set_delegates(array[test.id('ck_a')])$$, 'the CEO cannot delegate meeting decisions', 'FORBIDDEN');
reset role;
insert into meeting_delegates (host_id, delegate_id) values (test.id('sa'), test.id('ck_a')) on conflict do nothing;   -- a row from before this rule
set role authenticated;
select test.login('ck_a');
select test.check((select count(*) = 0 from jsonb_array_elements(mtg_pending_approvals()) x where (x ->> 'id')::uuid = (select id from mt where k = 'ceo1')),
  'a leftover delegate does not see the request waiting');
select test.must_fail($$select mtg_decide((select id from mt where k = 'ceo1'), 'PROPOSE', 'Earlier works better',
  date_trunc('hour', now()) + interval '6 days 9 hours', date_trunc('hour', now()) + interval '6 days 9 hours 30 minutes')$$, 'nor propose another time', 'FORBIDDEN');
select test.login('sa');
select test.check((select mtg_decide((select id from mt where k = 'ceo1'), 'PROPOSE', 'Earlier works better',
  date_trunc('hour', now()) + interval '6 days 9 hours', date_trunc('hour', now()) + interval '6 days 9 hours 30 minutes') ->> 'status' = 'PROPOSED'),
  'the CEO proposes another time');
select test.login('tm_a');
select test.must_fail($$select mtg_answer_proposal((select id from mt where k = 'ceo1'), true)$$, 'an outsider cannot answer the proposal', 'NOT_FOUND');
select test.login('ck_b');
select test.check((select mtg_answer_proposal((select id from mt where k = 'ceo1'), true) ->> 'status' = 'SCHEDULED'), 'the one asking accepts the proposed time');
reset role;
select test.check((select starts_at = date_trunc('hour', now()) + interval '6 days 9 hours' from meetings where id = (select id from mt where k = 'ceo1')),
  'the meeting moves to the proposed time');
set role authenticated;
select test.login('ck_b');
select test.check((select mtg_reschedule((select id from mt where k = 'ceo1'), date_trunc('hour', now()) + interval '7 days 9 hours', date_trunc('hour', now()) + interval '7 days 9 hours 30 minutes') ->> 'status' = 'REQUESTED'),
  'when the one asking moves a CEO meeting, it needs approval again');
select test.login('sa');
select test.check((select mtg_decide((select id from mt where k = 'ceo1'), 'APPROVE', 'See you then') ->> 'status' = 'SCHEDULED'), 'the CEO approves');
select test.must_fail($$select mtg_decide((select id from mt where k = 'ceo1'), 'DECLINE', 'Too late')$$, 'an answered request cannot be answered again', 'CONFLICT');
reset role;
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('ck_b') and type = 'MEETING_APPROVED'), 'the one asking is told it is approved');
-- the CEO's own booking is not a request
set role authenticated;
select test.login('sa');
select test.check((select mtg_create(jsonb_build_object('title', 'CEO call', 'startsAt', date_trunc('hour', now()) + interval '8 days 15 hours',
  'endsAt', date_trunc('hour', now()) + interval '8 days 16 hours')) ->> 'status' = 'SCHEDULED'), 'the CEO''s own meeting is booked at once');
select test.login('ck_a');
select test.check((select mtg_create(jsonb_build_object('title', 'Board prep (by the delegate)', 'hostId', test.id('sa'), 'description', 'Prepare the board deck', 'startsAt', date_trunc('hour', now()) + interval '9 days 15 hours',
  'endsAt', date_trunc('hour', now()) + interval '9 days 16 hours')) ->> 'status' = 'REQUESTED'), 'a leftover delegate asks for the CEO''s time like everyone else: a request');
select test.login('ck_b');
insert into mt select 'ceo2', (x ->> 'id')::uuid, null from (select mtg_create(jsonb_build_object('title', 'Leave policy question', 'hostId', test.id('sa'), 'description', 'A question about the leave policy',
  'startsAt', date_trunc('hour', now()) + interval '10 days 12 hours', 'endsAt', date_trunc('hour', now()) + interval '10 days 12 hours 30 minutes')) x) s;
select test.login('sa');
select test.check((select mtg_decide((select id from mt where k = 'ceo2'), 'DECLINE', 'Please ask HR') ->> 'status' = 'DECLINED'), 'the CEO declines a request');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ck_b') and type = 'MEETING_DECLINED' and body = 'Please ask HR'), 'with the reason');

\echo '   booking links (customers, leads, candidates pick a slot)'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select mtg_booking_type_save(jsonb_build_object('slug', 'X', 'title', 'Bad'))$$, 'a bad link name is refused', 'VALIDATION_ERROR');
select test.must_fail($$select mtg_booking_type_save(jsonb_build_object('slug', 'tm-a-ceo', 'title', 'Fake CEO', 'kind', 'CEO_MEETING'))$$,
  'only the CEO has a "meeting with the CEO" link', 'VALIDATION_ERROR');
select test.check((select mtg_booking_type_save(jsonb_build_object('slug', 'tm-a-demo', 'title', 'Product demo', 'kind', 'DEMO', 'durationMinutes', 30,
  'bufferMinutes', 10, 'minNoticeMinutes', 60, 'maxDaysAhead', 14)) ->> 'slug' = 'tm-a-demo'), 'tm_a creates a demo booking link');
select test.check((select jsonb_array_length(mtg_set_availability(jsonb_build_object('timezone', 'Asia/Kolkata', 'availability', jsonb_build_array(
  jsonb_build_object('weekday', 1, 'start', '09:00', 'end', '17:00'), jsonb_build_object('weekday', 2, 'start', '09:00', 'end', '17:00'),
  jsonb_build_object('weekday', 3, 'start', '09:00', 'end', '17:00'), jsonb_build_object('weekday', 4, 'start', '09:00', 'end', '17:00'),
  jsonb_build_object('weekday', 5, 'start', '09:00', 'end', '17:00')))) -> 'availability') = 5), 'and sets working hours Mon-Fri 09-17 IST');
select test.must_fail($$select mtg_set_availability(jsonb_build_object('timezone', 'Mars/Base', 'availability', '[]'::jsonb))$$, 'an unknown time zone is refused', 'VALIDATION_ERROR');
select test.must_fail($$select mtg_public_page('tm-a-demo')$$, 'staff cannot call the public booking functions directly', 'permission denied');
select test.login('sa');
select test.check((select (mtg_booking_type_save(jsonb_build_object('slug', 'meet-the-ceo', 'title', 'Meet the CEO', 'requiresApproval', false)) ->> 'requiresApproval')::boolean),
  'the CEO''s link always needs approval');
reset role;
set role anon;
select test.must_fail($$select mtg_public_book('{}'::jsonb)$$, 'the public cannot call the booking functions directly (only the server can)', 'permission denied');
reset role;
-- the server (service role) books for a guest: next Wednesday 10:00 IST
select set_config('request.jwt.claims', '', false);   -- the server's calls carry no login
create temp table slot as select ((date_trunc('week', (now() at time zone 'Asia/Kolkata')) + interval '9 days 10 hours') at time zone 'Asia/Kolkata') as t;
select test.check((select (mtg_public_page('tm-a-demo') ->> 'durationMinutes')::integer = 30), 'the booking page shows the link');
insert into mt select 'pub', (x ->> 'id')::uuid, null from (select mtg_public_book(jsonb_build_object('slug', 'tm-a-demo', 'startsAt', (select t from slot),
  'name', 'Asha Customer', 'email', 'asha@example.com', 'phone', '+91 90000 00000', 'notes', 'Interested in WhatsApp API')) x) s;
select test.check((select status = 'SCHEDULED' and booked_via = 'BOOKING_LINK' and created_by is null and ends_at - starts_at = interval '30 minutes' from meetings where id = (select id from mt where k = 'pub')),
  'a guest books a free slot: scheduled at once, 30 minutes');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_BOOKED'), 'the host is told');
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'pub') and kind = 'CONFIRMED'), 'the guest is e-mailed a confirmation');
select test.must_fail($$select mtg_public_book(jsonb_build_object('slug', 'tm-a-demo', 'startsAt', (select t from slot) + interval '20 minutes', 'name', 'Other', 'email', 'o@example.com'))$$,
  'a slot inside the buffer after a booking is refused', 'CONFLICT');
select test.must_fail($$select mtg_public_book(jsonb_build_object('slug', 'tm-a-demo', 'startsAt', (select t from slot) - interval '2 days' + interval '9 hours', 'name', 'Night', 'email', 'n@example.com'))$$,
  'a time outside the working hours is refused', 'working hours');
select test.must_fail($$select mtg_public_book(jsonb_build_object('slug', 'tm-a-demo', 'startsAt', now() + interval '10 minutes', 'name', 'Rush', 'email', 'r@example.com'))$$,
  'a time inside the minimum notice is refused', 'no longer be booked');
select test.must_fail($$select mtg_public_book(jsonb_build_object('slug', 'tm-a-demo', 'startsAt', (select t from slot) + interval '2 hours', 'name', 'X', 'email', 'not-an-email'))$$,
  'a guest needs a name and a valid e-mail', 'VALIDATION_ERROR');
select test.must_fail($$select mtg_public_page('nope-nope')$$, 'an unknown link is not found', 'NOT_FOUND');
select test.check((select jsonb_array_length(mtg_public_page('tm-a-demo') -> 'busy') >= 1), 'the booked time is shown as busy on the page');
select test.check((select mtg_public_cancel((select id from mt where k = 'pub'), 'Change of plans') ->> 'status' = 'CANCELLED'), 'the guest cancels from their e-mail link');
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'pub') and kind = 'CANCELLED'), 'and gets the cancellation e-mail');
-- the CEO's link: a request
insert into mt select 'pubceo', (x ->> 'id')::uuid, null from (select mtg_public_book(jsonb_build_object('slug', 'meet-the-ceo',
  'startsAt', (select t from slot) + interval '1 day' + interval '2 hours', 'name', 'Investor Ravi', 'email', 'ravi@example.com')) x) s;
select test.check((select status = 'REQUESTED' from meetings where id = (select id from mt where k = 'pubceo')), 'booking the CEO''s link makes a request');
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'pubceo') and kind = 'REQUEST_RECEIVED'),
  'the guest is told the request was received (not confirmed)');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('ck_a') and type = 'MEETING_REQUESTED' and entity_id = (select id from mt where k = 'pubceo')),
  'a leftover delegate is not asked: they cannot decide');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REQUESTED' and entity_id = (select id from mt where k = 'pubceo')),
  'the CEO is asked');

\echo '   Google sync queue (the server''s worker)'
select test.check((select count(*) >= 1 from jsonb_array_elements(mtg_sync_claim(50)) x where (x ->> 'id')::uuid = (select id from mt where k = 'm1')),
  'the worker claims the meetings waiting for Google');
select test.check((select count(*) = 0 from jsonb_array_elements(mtg_sync_claim(50)) x where (x ->> 'id')::uuid = (select id from mt where k = 'm1')),
  'a claimed meeting is not handed out twice');
select mtg_sync_result((select id from mt where k = 'm1'), (select version from meetings where id = (select id from mt where k = 'm1')), true, 'evt123', 'primary',
  'https://meet.google.com/abc-defg-hij');
select test.check((select google_sync_status = 'SYNCED' and google_event_id = 'evt123' and meet_link = 'https://meet.google.com/abc-defg-hij' from meetings where id = (select id from mt where k = 'm1')),
  'Google''s event id and Meet link are stored');
select test.check((select google_sync_status = 'NOT_CONNECTED' from meetings where id = (select id from mt where k = 'ceo1')), 'the CEO has not connected Google: nothing to sync');
insert into google_calendar_connections (profile_id, google_email, refresh_token_enc) values (test.id('sa'), 'ceo@example.com', 'v1:a:b:c');
select mtg_connection_saved(test.id('sa'));
select test.check((select google_sync_status = 'PENDING' from meetings where id = (select id from mt where k = 'ceo1')), 'once the CEO connects, their approved meetings are sent to Google');
select mtg_connection_broken(test.id('sa'), 'invalid_grant');
select test.check((select status = 'NEEDS_RECONNECT' from google_calendar_connections where profile_id = test.id('sa')), 'a revoked connection is marked');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'GOOGLE_CALENDAR_DISCONNECTED'), 'and the person is asked to reconnect');
update meetings set google_sync_after = now() where id = (select id from mt where k = 'ceo1');
select mtg_sync_claim(50);
select test.check((select google_sync_status = 'NOT_CONNECTED' from meetings where id = (select id from mt where k = 'ceo1')), 'nothing is sent through a broken connection');
-- a failure is retried later
update meetings set google_sync_status = 'PENDING', google_sync_after = now() where id = (select id from mt where k = 'm1');
select mtg_sync_result((select id from mt where k = 'm1'), 0, false, null, null, null, 'quota exceeded');
select test.check((select google_sync_status = 'FAILED' and google_sync_after > now() and google_sync_error = 'quota exceeded' from meetings where id = (select id from mt where k = 'm1')),
  'a failed sync is retried later with the error kept');

\echo '   reminders and e-mails'
update meetings set starts_at = now() + interval '30 minutes', ends_at = now() + interval '90 minutes' where id = (select id from mt where k = 'm1');
select test.check((select mtg_enqueue_reminders() >= 1), 'reminders are due');
select test.check((select count(*) = 1 from meeting_reminders where meeting_id = (select id from mt where k = 'm1') and kind = '1H'), 'the 1-hour reminder is recorded');
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'm1') and kind = 'REMINDER_1H'), 'the guest gets the reminder e-mail');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('ck_a') and type = 'MEETING_REMINDER'), 'the colleague gets the reminder in the CRM');
select mtg_enqueue_reminders();
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = (select id from mt where k = 'm1') and kind = 'REMINDER_1H'), 'each reminder is given once');
select test.check((select count(*) >= 1 from jsonb_array_elements(mtg_mail_claim(100)) x where x ->> 'toEmail' = 'ravi.guest@example.com'), 'the server claims the e-mails to send');
select mtg_mail_result(o.id, 'SENT') from meeting_mail_outbox o where o.to_email = 'ravi.guest@example.com';
select test.check((select bool_and(status = 'SENT' and sent_at is not null) from meeting_mail_outbox where to_email = 'ravi.guest@example.com'), 'sent e-mails are marked sent');

\echo '   demos, interviews and HR meetings join the same calendar'
insert into ba_demos (contact_id, title, starts_at, ends_at, mode, assigned_to, created_by)
select id, 'Mirror demo', now() + interval '12 days', now() + interval '12 days 1 hour', 'ONLINE', test.id('tm_a'), test.id('tm_a') from ba_contacts limit 1;
select test.check((select count(*) = 1 from meetings m join ba_demos d on d.id = m.source_id where m.source_type = 'ba_demo' and d.title = 'Mirror demo'
                     and m.kind = 'DEMO' and m.host_id = test.id('tm_a') and m.status = 'SCHEDULED' and m.google_sync_status = 'PENDING'),
  'a Business Associate demo appears as a meeting of its owner, to be sent to Google');
update ba_demos set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day' where title = 'Mirror demo';
select test.check((select m.starts_at = d.starts_at from meetings m join ba_demos d on d.id = m.source_id where m.source_type = 'ba_demo' and d.title = 'Mirror demo'),
  'moving the demo moves the meeting');
update ba_demos set status = 'CANCELLED' where title = 'Mirror demo';
select test.check((select m.status = 'CANCELLED' from meetings m join ba_demos d on d.id = m.source_id where m.source_type = 'ba_demo' and d.title = 'Mirror demo'),
  'cancelling the demo cancels the meeting');
insert into mt select 'demo', m.id, null from meetings m join ba_demos d on d.id = m.source_id where m.source_type = 'ba_demo' and d.title = 'Mirror demo';
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select mtg_cancel((select id from mt where k = 'demo'))$$,
  'a mirrored meeting is changed in its own page, not here', 'CONFLICT');
reset role;
insert into career_interviews (application_id, round, scheduled_at, location, interviewer_id)
select id, 'HR', now() + interval '13 days', 'Head office', test.id('tm_a') from career_applications limit 1;
select test.check((select count(*) = 1 from meetings m where m.source_type = 'career_interview' and m.kind = 'INTERVIEW' and m.host_id = test.id('tm_a')
                     and m.source_id = (select id from career_interviews where location = 'Head office' order by created_at desc limit 1)),
  'an interview appears as a meeting of the interviewer');
select test.check((select count(*) = 1 from meeting_attendees a join meetings m on m.id = a.meeting_id where m.source_type = 'career_interview' and a.profile_id is null
                     and m.source_id = (select id from career_interviews where location = 'Head office' order by created_at desc limit 1)),
  'with the candidate invited by e-mail');
-- a demo planned before the migration joins the calendar when the migration runs, without its own row being touched
alter table ba_demos disable trigger ba_demos_meeting_mirror;
insert into ba_demos (contact_id, title, starts_at, ends_at, mode, assigned_to, created_by, updated_at)
select id, 'Backfill demo', now() + interval '14 days', now() + interval '14 days 1 hour', 'IN_PERSON', test.id('tm_a'), test.id('tm_a'), now() - interval '3 days' from ba_contacts limit 1;
alter table ba_demos enable trigger ba_demos_meeting_mirror;
select test.check((select count(*) = 0 from meetings m join ba_demos d on d.id = m.source_id where d.title = 'Backfill demo'), 'a demo made before the calendar existed is not in it yet');
\i supabase/migrations/20270101000500_meetings_google_calendar.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql
select test.check((select count(*) = 1 from meetings m join ba_demos d on d.id = m.source_id where m.source_type = 'ba_demo' and d.title = 'Backfill demo' and m.mode = 'IN_PERSON'),
  'the migration brings already-planned demos into the calendar');
select test.check((select updated_at < now() - interval '2 days' from ba_demos where title = 'Backfill demo'), 'without touching the demo itself');
-- the demo itself never fails because of the calendar
select test.check((select count(*) = 1 from ba_demos where title = 'Mirror demo'), 'the source records are untouched');

-- clean up what this suite made
reset role;
delete from ba_demos where title in ('Mirror demo', 'Backfill demo');
delete from career_interviews where location = 'Head office' and interviewer_id = test.id('tm_a');
delete from meetings where host_id in (test.id('sa'), test.id('tm_a'), test.id('ck_a'));
delete from meeting_booking_types where host_id in (test.id('sa'), test.id('tm_a'));
delete from meeting_delegates where host_id = test.id('sa');
delete from google_calendar_connections where profile_id in (test.id('sa'), test.id('tm_a'));
