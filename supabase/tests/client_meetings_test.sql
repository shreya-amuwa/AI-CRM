-- =============================================================================
-- Client Meeting (migration 20270122000200): the form's rules, one meeting per form (clientRequestId), the invitation to the client queued
-- once in the meeting e-mail outbox, the host, conflicts (a meeting already then; the host BUSY now and it starts within 30 minutes),
-- reschedule / cancel e-mails, the Scheduled / Rescheduled / Completed / Cancelled list, the delivery log and retry, and who may see what.
-- Own synthetic meetings (title 'CM %'). Runs after the employee availability suite.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 134. Client meetings'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270122000200_client_meetings.sql
\i supabase/migrations/20270122000200_client_meetings.sql
delete from meetings where title like 'CM %';
delete from meeting_presence where host_id in (test.id('tm_a'), test.id('tm_b'));
create temp table cm (k text primary key, v jsonb);
grant all on cm to authenticated;
create or replace function test.cm_form(p_title text, p_key text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('clientName', 'Meera Shah', 'clientEmail', 'Meera@Shah.example', 'companyName', 'Shah Traders', 'title', p_title,
    'agenda', 'Walk through the AI CRM and pricing', 'startsAt', now() + interval '2 days', 'endsAt', now() + interval '2 days 1 hour',
    'mode', 'ONLINE', 'meetLink', 'https://meet.example.com/abc', 'clientRequestId', p_key) || p_extra $$;
create or replace function test.cm_id(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.meetings where title = p_title $$;
create or replace function test.cm_mails(p_title text, p_kind text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.meeting_mail_outbox o join public.meetings m on m.id = o.meeting_id
   where m.title = p_title and o.kind = p_kind and o.to_profile_id is null and o.to_email = 'meera@shah.example' $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   creating a client meeting'
set role authenticated;
select test.login('tm_a');
insert into cm select 'first', mtg_client_create(test.cm_form('CM Walkthrough', 'cm-key-0001'));
select test.check((select v ->> 'kind' = 'CLIENT_MEETING' and v ->> 'status' = 'SCHEDULED' and v ->> 'clientCompany' = 'Shah Traders'
                          and v -> 'client' ->> 'email' = 'meera@shah.example' and v ->> 'mode' = 'ONLINE_LINK' and v ->> 'meetLink' = 'https://meet.example.com/abc'
                          and v ->> 'description' = 'Walk through the AI CRM and pricing' and (v ->> 'duplicate')::boolean = false from cm where k = 'first'),
  'saved: kind, status, company, the client (e-mail lower-cased), online link, agenda');
reset role;
select test.check(test.cm_mails('CM Walkthrough', 'CONFIRMED') = 1, 'the invitation to the client is queued once in the e-mail outbox (the server sends it)');
set role authenticated;
select test.login('tm_a');
select test.check((mtg_client_create(test.cm_form('CM Walkthrough', 'cm-key-0001')) ->> 'duplicate')::boolean, 'the same form sent again returns the first meeting');
reset role;
select test.check((select count(*) = 1 from meetings where title = 'CM Walkthrough') and test.cm_mails('CM Walkthrough', 'CONFIRMED') = 1,
  'no second meeting and no second invitation');
set role authenticated;
select test.login('tm_a');

\echo '   the form''s rules'
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0002', '{"clientEmail": "not-an-email"}'))$$, 'a client e-mail is required and valid', 'valid client e-mail');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0003', '{"companyName": ""}'))$$, 'the company name is required', 'company name');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0004', '{"agenda": "hi"}'))$$, 'an agenda is required', 'agenda');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0005', '{"meetLink": null}'))$$, 'an online meeting needs its link', 'meeting link');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0006', '{"meetLink": "http://insecure.example"}'))$$, '... an https one', 'meeting link');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0007', '{"mode": "OFFLINE"}'))$$, 'an offline meeting needs its place', 'meeting place');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0008', '{"mode": "PHONE"}'))$$, 'the mode is Online or Offline', 'Online or Offline');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0009', jsonb_build_object('endsAt', now() + interval '1 day')))$$, 'it ends after it starts', 'end after it starts');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0010', jsonb_build_object('startsAt', now() - interval '1 day', 'endsAt', now() - interval '23 hours')))$$,
  'it is in the future', 'in the future');
select test.must_fail($$select mtg_client_create(test.cm_form('CM bad', 'cm-key-0011', jsonb_build_object('hostId', test.id('sa'))))$$, 'the CEO is not booked as a host', 'Ask the CEO');
reset role;
select test.check(not exists (select 1 from meetings where title = 'CM bad'), 'a refused form saves nothing');
set role authenticated;
select test.login('tm_a');
select test.check((mtg_client_create(test.cm_form('CM Office visit', 'cm-key-0012',
                     jsonb_build_object('mode', 'OFFLINE', 'meetLink', null, 'location', '4th floor, Baner Road, Pune', 'startsAt', now() + interval '3 days', 'endsAt', now() + interval '3 days 1 hour')))
                   ->> 'location') = '4th floor, Baner Road, Pune', 'an offline meeting with its place');

\echo '   the host and conflicts'
select test.must_fail($$select mtg_client_create(test.cm_form('CM clash', 'cm-key-0013'))$$, 'the host already has a meeting then', 'already have a meeting');
insert into cm select 'hosted', mtg_client_create(test.cm_form('CM Hosted by B', 'cm-key-0014', jsonb_build_object('hostId', test.id('tm_b'), 'startsAt', now() + interval '4 days', 'endsAt', now() + interval '4 days 1 hour')));
select test.check((select v ->> 'hostId' = test.id('tm_b')::text and v ->> 'createdBy' = test.id('tm_a')::text from cm where k = 'hosted'), 'a colleague can be the host');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_b') and entity_id = test.cm_id('CM Hosted by B')), 'the host is notified');
set role authenticated;
select test.login('tm_b');
select mtg_presence_enter();
select test.login('tm_a');
select test.must_fail($$select mtg_client_create(test.cm_form('CM host busy', 'cm-key-0015', jsonb_build_object('hostId', test.id('tm_b'), 'startsAt', now() + interval '10 minutes', 'endsAt', now() + interval '40 minutes')))$$,
  'the host is in a meeting right now and it starts within 30 minutes', 'in a meeting right now');
select test.login('tm_b');
select mtg_presence_exit();

\echo '   who sees it'
select test.check((select count(*) >= 1 from jsonb_array_elements(mtg_client_meetings('UPCOMING')) x where x ->> 'title' = 'CM Hosted by B'), 'the host lists it');
select test.check(not exists (select 1 from jsonb_array_elements(mtg_client_meetings('UPCOMING')) x where x ->> 'title' = 'CM Walkthrough'), 'but not someone else''s client meeting');
select test.login('tm_c');
select test.check(jsonb_array_length(mtg_client_meetings('ALL')) = 0 or not exists (select 1 from jsonb_array_elements(mtg_client_meetings('ALL')) x where x ->> 'title' like 'CM %'),
  'an outsider lists none of them');
select test.must_fail($$select mtg_mail_log(test.cm_id('CM Walkthrough'))$$, 'an outsider cannot read its e-mails', 'not found');
select test.must_fail($$select mtg_detail(test.cm_id('CM Walkthrough'))$$, '... nor the meeting', 'not found');
select test.must_fail($$select mtg_client_meetings('SOON')$$, 'the list scope is checked', 'UPCOMING, PAST or ALL');
select test.must_fail($$insert into meeting_mail_outbox (meeting_id, to_email, kind, meeting_version) values (test.cm_id('CM Walkthrough'), 'x@y.example', 'CONFIRMED', 1)$$,
  'nobody writes the e-mail outbox directly', 'permission denied');

\echo '   reschedule and cancel: the client is told'
select test.login('tm_a');
insert into cm select 'moved', mtg_reschedule(test.cm_id('CM Walkthrough'), now() + interval '5 days', now() + interval '5 days 1 hour', 'Client asked for Friday');
reset role;
select test.check(test.cm_mails('CM Walkthrough', 'RESCHEDULED') = 1, 'rescheduling queues the new-time e-mail to the client');
set role authenticated;
select test.login('tm_a');
select test.check((select x ->> 'title' = 'CM Walkthrough' from jsonb_array_elements(mtg_client_meetings('UPCOMING', 'RESCHEDULED')) x limit 1),
  'it is listed as Rescheduled');
select test.check(not exists (select 1 from jsonb_array_elements(mtg_client_meetings('UPCOMING', 'SCHEDULED')) x where x ->> 'title' = 'CM Walkthrough'), 'and no longer as Scheduled');
select mtg_cancel(test.cm_id('CM Office visit'), 'Client postponed the visit');
reset role;
select test.check(test.cm_mails('CM Office visit', 'CANCELLED') = 1, 'cancelling queues the cancellation e-mail to the client');
set role authenticated;
select test.login('tm_a');
select test.check((select x ->> 'title' = 'CM Office visit' from jsonb_array_elements(mtg_client_meetings('UPCOMING', 'CANCELLED')) x limit 1), 'it is listed as Cancelled');

\echo '   the delivery log and sending again'
select test.check((select count(*) >= 2 and bool_or(x ->> 'kind' = 'CONFIRMED') and bool_or(x ->> 'kind' = 'RESCHEDULED')
                     from jsonb_array_elements(mtg_mail_log(test.cm_id('CM Walkthrough'))) x where (x ->> 'external')::boolean),
  'the one who booked it sees the client e-mails and how they went');
reset role;
update meeting_mail_outbox set status = 'FAILED', attempts = 5, last_error = 'Mailbox unavailable'
 where meeting_id = test.cm_id('CM Walkthrough') and kind = 'RESCHEDULED' and to_profile_id is null;
update meeting_mail_outbox set status = 'SENT', sent_at = now() where meeting_id = test.cm_id('CM Walkthrough') and kind = 'CONFIRMED' and to_profile_id is null;
insert into cm select 'failed', to_jsonb(id) from meeting_mail_outbox where meeting_id = test.cm_id('CM Walkthrough') and kind = 'RESCHEDULED' and to_profile_id is null;
insert into cm select 'sent', to_jsonb(id) from meeting_mail_outbox where meeting_id = test.cm_id('CM Walkthrough') and kind = 'CONFIRMED' and to_profile_id is null;
set role authenticated;
select test.login('tm_a');
select test.check((select x ->> 'status' = 'FAILED' and x ->> 'lastError' = 'Mailbox unavailable' from jsonb_array_elements(mtg_mail_log(test.cm_id('CM Walkthrough'))) x
                    where (x ->> 'id')::bigint = (select (v #>> '{}')::bigint from cm where k = 'failed')), 'a failed e-mail shows why');
select test.check((mtg_mail_retry((select (v #>> '{}')::bigint from cm where k = 'failed')) ->> 'status') = 'PENDING', 'Send again: queued again');
reset role;
select test.check((select status = 'PENDING' and attempts = 0 from meeting_mail_outbox where id = (select (v #>> '{}')::bigint from cm where k = 'failed')),
  '... with its attempts reset, so the worker picks it up');
select test.check((select count(*) = 1 from meeting_mail_outbox where meeting_id = test.cm_id('CM Walkthrough') and kind = 'RESCHEDULED' and to_profile_id is null), 'still one row: no duplicate e-mail');
set role authenticated;
select test.login('tm_a');
select test.check((mtg_mail_retry((select (v #>> '{}')::bigint from cm where k = 'failed')) ->> 'status') = 'PENDING', 'a double click changes nothing');
select test.must_fail($$select mtg_mail_retry((select (v #>> '{}')::bigint from cm where k = 'sent'))$$, 'a sent e-mail is not sent twice', 'already sent');
reset role;
update meeting_mail_outbox set status = 'FAILED', last_error = 'x' where meeting_id = test.cm_id('CM Office visit') and kind = 'CONFIRMED' and to_profile_id is null;
insert into cm select 'replaced', to_jsonb(id) from meeting_mail_outbox where meeting_id = test.cm_id('CM Office visit') and kind = 'CONFIRMED' and to_profile_id is null;
set role authenticated;
select test.login('tm_a');
select test.check((select (x ->> 'superseded')::boolean from jsonb_array_elements(mtg_mail_log(test.cm_id('CM Office visit'))) x
                    where (x ->> 'id')::bigint = (select (v #>> '{}')::bigint from cm where k = 'replaced')), 'an invitation followed by a cancellation is shown as replaced');
select test.must_fail($$select mtg_mail_retry((select (v #>> '{}')::bigint from cm where k = 'replaced'))$$, '... and is not sent again (the cancellation counts)', 'newer e-mail');
select test.login('tm_c');
select test.must_fail($$select mtg_mail_retry((select (v #>> '{}')::bigint from cm where k = 'failed'))$$, 'an outsider cannot send it again', 'not found');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'CLIENT_MEETING_SCHEDULED' and created_at > now() - interval '5 minutes'), 'creating is audited');
delete from meetings where title like 'CM %';
select set_config('request.jwt.claims', '', false);
