-- =============================================================================
-- Meeting notifications for the Managing Director (migration 20270207000200): awareness of internal team meetings they are not in,
-- reminders before the start, delivery to their devices through the push outbox, and nothing for other meetings or other people.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 142. Meeting oversight: the Managing Director hears about team meetings, on their phone too'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270207000200_meeting_oversight_notifications.sql
\i supabase/migrations/20270207000200_meeting_oversight_notifications.sql

delete from meetings where title like 'MO %';
delete from notifications where type like 'MEETING_OVERSIGHT%';
delete from notification_deliveries where kind = 'MEETING';
delete from push_subscriptions where endpoint like 'https://push.example.com/mo-%';
update meeting_oversight_settings set enabled = true, push_enabled = true, remind_minutes = '{15,0}' where id;
-- the Managing Director has one phone subscribed
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label) values (test.id('sa'), 'https://push.example.com/mo-phone', 'k', 'a', 'Phone');

create or replace function test.momeet(p_title text, p_kind text default 'MEETING', p_in interval default interval '3 hours', p_with_sa boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v uuid;
  h uuid := (select p.id from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' order by p.created_at limit 1);
begin
  insert into public.meetings (kind, title, description, host_id, created_by, starts_at, ends_at, status, booked_via, google_sync_status)
  values (p_kind, p_title, 'Agenda', h, h, date_trunc('minute', now()) + p_in, date_trunc('minute', now()) + p_in + interval '1 hour', 'SCHEDULED', 'STAFF', 'SKIPPED')
  returning id into v;
  insert into public.meeting_attendees (meeting_id, profile_id, role, response)
  select v, p.id, 'REQUIRED', 'ACCEPTED' from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and p.id <> h order by p.created_at limit 2;
  if p_with_sa then
    insert into public.meeting_attendees (meeting_id, profile_id, role, response) values (v, test.id('sa'), 'REQUIRED', 'ACCEPTED');
  end if;
  return v;
end $$;
create or replace function test.moid(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.meetings where title = p_title $$;
create or replace function test.monotes(p_title text, p_type text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications n where n.recipient_id = test.id('sa') and n.type = p_type and n.entity_id = test.moid(p_title) $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   awareness: scheduled, rescheduled, cancelled'
select test.momeet('MO Weekly sales review');
select test.check(test.monotes('MO Weekly sales review', 'MEETING_OVERSIGHT_SCHEDULED') = 1, 'a new team meeting: the Managing Director is told (not invited)');
select test.check((select n.entity_type = 'meeting_summary' and (n.data ->> 'awareness')::boolean and n.title like 'Team meeting scheduled: MO Weekly sales review'
                     and n.body like 'Organiser: %' and n.body like '% participants%' and n.body like '%Scheduled'
                   from notifications n where n.recipient_id = test.id('sa') and n.type = 'MEETING_OVERSIGHT_SCHEDULED' and n.entity_id = test.moid('MO Weekly sales review')),
  'the notice: title, organiser, date and time, participant count, status; it opens the meeting''s report view');
select test.check((select count(*) = 1 from notification_deliveries d where d.kind = 'MEETING' and d.profile_id = test.id('sa') and d.status = 'PENDING'
                     and d.url = '/?open=meeting-report&id=' || test.moid('MO Weekly sales review')), 'it is queued for the Managing Director''s phone');
select test.check((select bool_and(d.title not like '%MO Weekly%' and d.body not like '%MO Weekly%') from notification_deliveries d where d.kind = 'MEETING'),
  'the lock-screen text has no meeting title');
select test.check((select n.body like '% 3 participants%' from notifications n where n.type = 'MEETING_OVERSIGHT_SCHEDULED' and n.entity_id = test.moid('MO Weekly sales review')),
  'the participant count includes the people invited in the same booking');
select test.check((select count(*) = 0 from notifications n where n.type like 'MEETING_OVERSIGHT%' and n.recipient_id <> test.id('sa')
                     and n.recipient_id not in (select id from profiles where role = 'SUPER_ADMIN')), 'nobody else gets these notices');
update meetings set status = 'SCHEDULED' where title = 'MO Weekly sales review';
select test.check(test.monotes('MO Weekly sales review', 'MEETING_OVERSIGHT_SCHEDULED') = 1, 'an update that changes nothing sends nothing');
update meetings set starts_at = starts_at + interval '1 day', ends_at = ends_at + interval '1 day', version = version + 1 where title = 'MO Weekly sales review';
select test.check(test.monotes('MO Weekly sales review', 'MEETING_OVERSIGHT_RESCHEDULED') = 1
                  and (select n.body like '%Rescheduled from %' from notifications n where n.type = 'MEETING_OVERSIGHT_RESCHEDULED' and n.entity_id = test.moid('MO Weekly sales review')),
  'moved: told, with the old time');
update meetings set status = 'CANCELLED', cancel_reason = 'Client visit', version = version + 1 where title = 'MO Weekly sales review';
select test.check(test.monotes('MO Weekly sales review', 'MEETING_OVERSIGHT_CANCELLED') = 1
                  and (select n.priority = 'urgent' and n.body like '%Cancelled: Client visit' from notifications n where n.type = 'MEETING_OVERSIGHT_CANCELLED' and n.entity_id = test.moid('MO Weekly sales review')),
  'cancelled: told, with the reason');

\echo '   only internal team meetings, only when not taking part'
select test.momeet('MO Appointment', 'APPOINTMENT');
select test.check(test.monotes('MO Appointment', 'MEETING_OVERSIGHT_SCHEDULED') = 0, 'an appointment (or interview, client meeting, CEO request): no oversight notice');
select test.momeet('MO With the MD', 'MEETING', interval '3 hours', true);
select test.check(test.monotes('MO With the MD', 'MEETING_OVERSIGHT_SCHEDULED') = 0,
  'booked with the Managing Director invited (attendees added after the meeting, in the same transaction): no "awareness" notice');
create or replace function test.momeet_with_sa(p_title text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v uuid := gen_random_uuid();
  h uuid := (select p.id from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' order by p.created_at limit 1);
begin
  -- the meeting is created requested, the Managing Director invited, then it is scheduled (as an approval would)
  insert into public.meetings (id, kind, title, host_id, created_by, starts_at, ends_at, status, booked_via, google_sync_status)
  values (v, 'MEETING', p_title, h, h, date_trunc('minute', now()) + interval '3 hours', date_trunc('minute', now()) + interval '4 hours', 'REQUESTED', 'STAFF', 'SKIPPED');
  insert into public.meeting_attendees (meeting_id, profile_id, role, response) values (v, test.id('sa'), 'REQUIRED', 'ACCEPTED');
  update public.meetings set status = 'SCHEDULED' where id = v;
  return v;
end $$;
grant execute on function test.momeet_with_sa(text) to anon, authenticated;
select test.momeet_with_sa('MO Approved with the MD');
select test.check(test.monotes('MO Approved with the MD', 'MEETING_OVERSIGHT_SCHEDULED') = 0,
  'approved later, with the Managing Director taking part: the invitation only, not a second "awareness" notice');

\echo '   reminders: 15 minutes before and at the start, once each, never for a cancelled meeting'
select test.momeet('MO Daily standup', 'MEETING', interval '14 minutes');
set role service_role;
select mtg_oversight_run(now());
select mtg_oversight_run(now());
reset role;
select test.check(test.monotes('MO Daily standup', 'MEETING_OVERSIGHT_REMINDER') = 1
                  and (select n.title = 'In 15 minutes: MO Daily standup' from notifications n where n.type = 'MEETING_OVERSIGHT_REMINDER' and n.entity_id = test.moid('MO Daily standup')),
  '15 minutes before: one reminder, however many runs');
set role service_role;
select mtg_oversight_run((select starts_at + interval '1 minute' from meetings where title = 'MO Daily standup'));
reset role;
select test.check(test.monotes('MO Daily standup', 'MEETING_OVERSIGHT_REMINDER') = 2
                  and exists (select 1 from notifications n where n.type = 'MEETING_OVERSIGHT_REMINDER' and n.entity_id = test.moid('MO Daily standup') and n.title like 'Starting now:%'),
  'at the start: "Starting now"');
select test.check((select count(*) = 2 from notification_deliveries d where d.kind = 'MEETING' and d.tag = 'mtg-' || test.moid('MO Daily standup') || '-reminder'),
  'each reminder is queued for the phone');
set role service_role;
select mtg_oversight_run((select starts_at + interval '3 hours' from meetings where title = 'MO Daily standup'));
reset role;
select test.check(test.monotes('MO Daily standup', 'MEETING_OVERSIGHT_REMINDER') = 2, 'never late: nothing hours after the start');
select test.momeet_with_sa('MO Board prep');
update meetings set starts_at = date_trunc('minute', now()) + interval '14 minutes', ends_at = date_trunc('minute', now()) + interval '74 minutes' where title = 'MO Board prep';
set role service_role;
select mtg_oversight_run(now());
reset role;
select test.check(test.monotes('MO Board prep', 'MEETING_OVERSIGHT_REMINDER') = 0,
  'taking part: no oversight reminder (the participants'' reminders of 20270207000100_meeting_push cover them, never both)');
select test.momeet('MO Cancelled one', 'MEETING', interval '14 minutes');
update meetings set status = 'CANCELLED' where title = 'MO Cancelled one';
set role service_role;
select mtg_oversight_run(now());
reset role;
select test.check(test.monotes('MO Cancelled one', 'MEETING_OVERSIGHT_REMINDER') = 0, 'no reminder for a cancelled meeting');
select test.momeet('MO Moved one', 'MEETING', interval '14 minutes');
set role service_role;
select mtg_oversight_run(now());
reset role;
update meetings set starts_at = starts_at + interval '2 hours', ends_at = ends_at + interval '2 hours' where title = 'MO Moved one';
select test.check((select bool_and(status = 'CANCELLED') from notification_deliveries where tag = 'mtg-' || test.moid('MO Moved one') || '-reminder'),
  'moved after its reminder was queued: the waiting push is cancelled');

\echo '   settings, security'
update meeting_oversight_settings set enabled = false where id;
select test.momeet('MO While off');
select test.check(test.monotes('MO While off', 'MEETING_OVERSIGHT_SCHEDULED') = 0, 'switched off: nothing');
update meeting_oversight_settings set enabled = true, push_enabled = false where id;
select test.momeet('MO No push');
select test.check(test.monotes('MO No push', 'MEETING_OVERSIGHT_SCHEDULED') = 1
                  and not exists (select 1 from notification_deliveries d where d.url like '%' || test.moid('MO No push')), 'push off: the bell only');
update meeting_oversight_settings set push_enabled = true where id;
set role authenticated;
select test.login('sa');
select test.must_fail($$select mtg_oversight_run(now())$$, 'the reminder run is for the server only', 'permission denied');
select test.must_fail($$select * from meeting_oversight_log$$, 'no direct table access', 'permission denied');
select test.check((select (mtg_oversight_settings_get() ->> 'enabled')::boolean), 'the Managing Director reads the meeting notification settings');
select test.check((select mtg_oversight_settings_set(true, true, '{0,15,15}') -> 'remindMinutes' = '[15, 0]'::jsonb), 'and saves them (duplicates removed)');
select test.must_fail($$select mtg_oversight_settings_set(true, true, '{7}')$$, 'only the listed reminder times', 'VALIDATION_ERROR');
select test.login('hr_head');
select test.must_fail($$select mtg_oversight_settings_get()$$, 'nobody else reads them', 'FORBIDDEN');
select test.must_fail($$select mtg_oversight_settings_set(false, false, '{}')$$, 'nobody else changes them', 'FORBIDDEN');
reset role;
select test.check(exists (select 1 from audit_logs where action = 'MEETING_NOTIFICATION_SETTINGS_CHANGED'), 'a change is in the audit log');

delete from push_subscriptions where endpoint like 'https://push.example.com/mo-%';
delete from meetings where title like 'MO %';
