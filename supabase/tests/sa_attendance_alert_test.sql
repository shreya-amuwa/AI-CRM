-- =============================================================================
-- The Super Admin's 11:00 attendance alert and Today's Attendance Overview (migration 20270131000100): the alert reaches only the Super
-- Admin, once a working day from 11:00 India time (bell + one push delivery per device, with the destination of the overview); not before
-- 11:00, not after 14:00, not on a day off; and the overview's Present / Absent / On leave / Not yet marked / Late, per department.
-- Uses today's date with the company's days set to all seven (so it runs the same any day of the week); own rows are removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133d. The Super Admin''s 11:00 attendance alert and Today''s Attendance Overview'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270131000100_super_admin_attendance_alert.sql
\i supabase/migrations/20270131000100_super_admin_attendance_alert.sql
-- the company-wide late rule (Late only after 10:30) replaces this migration's overview; re-applied after it, as on the live database
\i supabase/migrations/20270211000100_attendance_late_after_1030.sql
create temp table sa_saved as select reminder_days, reminders_paused_on, absent_after_minutes, sa_alert_time from attendance_settings where id;
update attendance_settings set reminder_days = '{1,2,3,4,5,6,7}', reminders_paused_on = null, absent_after_minutes = 60, sa_alert_time = '11:00' where id;
delete from sa_attendance_alerts;
delete from notifications where type = 'SA_ATTENDANCE_OVERVIEW';
delete from notification_deliveries where kind = 'SA_ATTENDANCE';
-- the moment: today at a given India time
create or replace function test.sa_at(p_hhmm text) returns timestamptz language sql stable as $$
  select ((private.office_today()::text || ' ' || p_hhmm)::timestamp at time zone 'Asia/Kolkata') $$;
-- a device for the Super Admin and one for an employee
insert into push_subscriptions (id, profile_id, endpoint, p256dh, auth, label, active)
values ('aaaaaaaa-0000-4000-8000-00000000a001', test.id('sa'), 'https://push.example.com/sa-alert-1', 'k', 'a', 'SA phone', true),
       ('aaaaaaaa-0000-4000-8000-00000000a002', test.id('tm_a'), 'https://push.example.com/sa-alert-2', 'k', 'a', 'Member phone', true)
on conflict (id) do update set active = true, profile_id = excluded.profile_id;

\echo '   when'
select test.check((sa_attendance_alert_generate(test.sa_at('10:59')) ->> 'skipped') = 'NOT_DUE', 'before 11:00: nothing');
select test.check((select count(*) = 0 from notifications where type = 'SA_ATTENDANCE_OVERVIEW'), '... and nothing written');
update attendance_settings set reminders_paused_on = private.office_today() where id;
select test.check((sa_attendance_alert_generate(test.sa_at('11:00')) ->> 'skipped') = 'NOT_WORKING_DAY', 'HR switched today off (a holiday): nothing');
update attendance_settings set reminders_paused_on = null, reminder_days = array[1 + (extract(isodow from private.office_today())::integer % 7)] where id;
select test.check((sa_attendance_alert_generate(test.sa_at('11:00')) ->> 'skipped') = 'NOT_WORKING_DAY', 'not one of the company''s working days: nothing');
update attendance_settings set reminder_days = '{1,2,3,4,5,6,7}' where id;
select test.check((sa_attendance_alert_generate(test.sa_at('14:00')) ->> 'skipped') = 'NOT_DUE', 'after 14:00 it is never sent late');

\echo '   at 11:00: the Super Admin only, once'
select test.check((select (x ->> 'generated')::int = (select count(*) from profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE') and (x ->> 'jobsCreated')::int >= 1
                     from (select sa_attendance_alert_generate(test.sa_at('11:00')) as x) s), 'at 11:00: one alert per active Super Admin, pushed to their device');
select test.check((select count(*) = 1 and bool_and(title = 'Look at today''s attendance.' and entity_type = 'attendance_overview'
                          and data ->> 'destination' = '/?open=attendance&view=today' and data ->> 'view' = 'today')
                     from notifications where type = 'SA_ATTENDANCE_OVERVIEW' and recipient_id = test.id('sa')),
  'the bell: "Look at today''s attendance.", opening Today''s Attendance Overview');
select test.check(not exists (select 1 from notifications n join profiles p on p.id = n.recipient_id where n.type = 'SA_ATTENDANCE_OVERVIEW' and p.role <> 'SUPER_ADMIN'),
  'no Department Head, Team Lead, Team Member or HR person gets it');
select test.check((select count(*) = 1 and bool_and(url = '/?open=attendance&view=today' and title = 'Look at today''s attendance.' and status = 'PENDING')
                     from notification_deliveries where kind = 'SA_ATTENDANCE' and profile_id = test.id('sa')), 'one push delivery to the Super Admin''s device, with the destination');
select test.check(not exists (select 1 from notification_deliveries where kind = 'SA_ATTENDANCE' and profile_id <> test.id('sa')
                                and profile_id not in (select id from profiles where role = 'SUPER_ADMIN')), 'nobody else''s device');
select test.check((sa_attendance_alert_generate(test.sa_at('11:05')) ->> 'generated')::int = 0 and (sa_attendance_alert_generate(test.sa_at('13:30')) ->> 'generated')::int = 0,
  'the next scheduled runs (and retries) create nothing new');
select test.check((select count(*) = 1 from notifications where type = 'SA_ATTENDANCE_OVERVIEW' and recipient_id = test.id('sa'))
                  and (select count(*) = 1 from notification_deliveries where kind = 'SA_ATTENDANCE' and profile_id = test.id('sa'))
                  and (select count(*) = 1 from sa_attendance_alerts where recipient_id = test.id('sa') and alert_date = private.office_today() and push_status = 'QUEUED' and devices = 1),
  'still one notification, one delivery, and the log says queued to 1 device');
-- the simulated 11:00 may be later than the real clock: due now, for the claim
update notification_deliveries set next_attempt_at = now(), expires_at = now() + interval '1 hour' where kind = 'SA_ATTENDANCE';
select test.check((select x ->> 'id' is not null and x ->> 'url' = '/?open=attendance&view=today'
                     from jsonb_array_elements(push_deliveries_claim(50, 60, array(select id from notification_deliveries where kind = 'SA_ATTENDANCE' and profile_id = test.id('sa')))) x),
  'the push service is handed the delivery (the existing outbox, with retries)');
delete from sa_attendance_alerts where recipient_id = test.id('sa');
delete from notifications where type = 'SA_ATTENDANCE_OVERVIEW';
select test.check((select (x ->> 'jobsCreated')::int = 0 and (x ->> 'generated')::int >= 1 from (select sa_attendance_alert_generate(test.sa_at('11:10'), false) as x) s),
  'without push keys nothing is queued for devices');
select test.check((select push_status = 'PUSH_OFF' from sa_attendance_alerts where recipient_id = test.id('sa') and alert_date = private.office_today())
                  and exists (select 1 from notifications where type = 'SA_ATTENDANCE_OVERVIEW' and recipient_id = test.id('sa')),
  '... it still reaches the bell, and the log says push off');

\echo '   Today''s Attendance Overview'
reset role;
delete from attendance_records where profile_id in (test.id('tm_a'), test.id('tm_b'), test.id('tm_c')) and attendance_date = private.office_today();
delete from leave_requests where employee_id in (test.id('tm_b')) and reason = 'SA alert test';
-- tm_a punched in at 10:45 (late by 15 minutes: Late only after 10:30), tm_b is on approved leave, tm_c has not punched in
insert into attendance_records (profile_id, attendance_date, punch_in_at) values (test.id('tm_a'), private.office_today(), test.sa_at('10:45'));
insert into leave_requests (employee_id, leave_type, start_date, end_date, reason, status)
values (test.id('tm_b'), 'FULL_DAY', private.office_today(), private.office_today(), 'SA alert test', 'APPROVED');
delete from attendance_reminder_prefs where profile_id in (test.id('tm_a'), test.id('tm_b'), test.id('tm_c'));
create or replace function test.sa_cat(p_user text, p_hhmm text) returns jsonb language sql stable security definer set search_path = '' as $$
  select x from jsonb_array_elements(private.attendance_overview_json(private.office_today(), test.sa_at(p_hhmm)) -> 'rows') x where (x ->> 'profileId')::uuid = test.id(p_user) $$;
select test.check((select x ->> 'category' = 'PRESENT' and (x ->> 'late')::boolean and (x ->> 'lateMinutes')::int = 15 from (select test.sa_cat('tm_a', '11:05') as x) s),
  'punched in at 10:45: Present, and Late by 15 minutes (counted from 10:30)');
select test.check((test.sa_cat('tm_b', '11:05') ->> 'category') = 'ON_LEAVE' and (test.sa_cat('tm_b', '11:05') ->> 'leave') = 'FULL_DAY', 'approved leave: On leave (not absent)');
select test.check((test.sa_cat('tm_c', '10:30') ->> 'category') = 'NOT_MARKED', 'not punched in at 10:30: Not yet marked');
select test.check((test.sa_cat('tm_c', '11:05') ->> 'category') = 'ABSENT', 'not punched in, an hour past the day start: Absent');
insert into attendance_reminder_prefs (profile_id, punch_in) values (test.id('tm_c'), '11:30') on conflict (profile_id) do update set punch_in = '11:30';
select test.check((test.sa_cat('tm_c', '11:05') ->> 'category') = 'NOT_MARKED', 'someone whose day starts at 11:30 is not absent yet at 11:05');
delete from attendance_reminder_prefs where profile_id = test.id('tm_c');
select test.check((select (x -> 'rows' -> 0 ->> 'category') = 'ABSENT' from (select private.attendance_overview_json(private.office_today(), test.sa_at('11:05')) as x) s),
  'the absent employees come first');
select test.check((select (t ->> 'total')::int = (t ->> 'present')::int + (t ->> 'absent')::int + (t ->> 'onLeave')::int + (t ->> 'notMarked')::int
                          and (t ->> 'late')::int >= 1
                     from (select private.attendance_overview_json(private.office_today(), test.sa_at('11:05')) -> 'totals' as t) s), 'the totals add up');
select test.check((select (select sum((d ->> 'total')::int) from jsonb_array_elements(x -> 'departments') d) = (x -> 'totals' ->> 'total')::int
                          and exists (select 1 from jsonb_array_elements(x -> 'departments') d where (d ->> 'absent')::int >= 1)
                     from (select private.attendance_overview_json(private.office_today(), test.sa_at('11:05')) as x) s), 'per department, adding up to the total');
select test.check(not exists (select 1 from jsonb_array_elements(private.attendance_overview_json(private.office_today()) -> 'rows') x
                              where (x ->> 'profileId')::uuid = test.id('sa')), 'the Super Admin is not counted as an employee');

\echo '   who may read it'
set role authenticated;
select test.login('sa');
select test.check((attendance_today_overview() ->> 'date')::date = private.office_today(), 'the Super Admin reads today''s overview');
select test.login('hr_head');
select test.check((attendance_today_overview() -> 'totals' ->> 'total')::int >= 3, 'HR reads it');
select test.login('tm_a');
select test.must_fail($$select attendance_today_overview()$$, 'an employee cannot', 'Only HR and the Super Admin');
select test.login('dh_wab');
select test.must_fail($$select attendance_today_overview()$$, 'nor a Department Head', 'Only HR and the Super Admin');
select test.must_fail($$select sa_attendance_alert_generate()$$, 'nobody signed in starts the alert', 'permission denied');
select test.login('sa');
select test.must_fail($$select attendance_today_overview(private.office_today() + 1)$$, 'no future date', 'up to today');

reset role;
delete from attendance_records where profile_id = test.id('tm_a') and attendance_date = private.office_today() and punch_in_at = test.sa_at('10:45');
delete from leave_requests where reason = 'SA alert test';
delete from notification_deliveries where kind = 'SA_ATTENDANCE';
delete from push_subscriptions where id in ('aaaaaaaa-0000-4000-8000-00000000a001', 'aaaaaaaa-0000-4000-8000-00000000a002');
delete from sa_attendance_alerts;
delete from notifications where type = 'SA_ATTENDANCE_OVERVIEW';
update attendance_settings s set reminder_days = v.reminder_days, reminders_paused_on = v.reminders_paused_on, absent_after_minutes = v.absent_after_minutes, sa_alert_time = v.sa_alert_time
  from sa_saved v where s.id;
select set_config('request.jwt.claims', '', false);
