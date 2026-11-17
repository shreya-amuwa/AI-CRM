-- =============================================================================
-- Attendance reminders (migration 20270109000200): company defaults and personal reminder times, devices (Web Push subscriptions),
-- and which reminders are due. Reuses weekly_report_routing_test.sql (wkr_tmp Support member, wkr_tms Sales member) and
-- hr_test.sql's HR head (hr_head) and rls_test.sql's Super Admin (sa). Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 139. Attendance reminders: times, devices, what is due'
reset role;
\i supabase/migrations/20270109000200_attendance_reminders.sql
\i supabase/migrations/20270109000200_attendance_reminders.sql
update attendance_settings set reminders_enabled = true, reminder_punch_in = '10:00', reminder_lunch = '14:00', reminder_punch_out = '19:00',
       reminder_follow_up_minutes = 15, reminder_lunch_warning_minutes = 5, reminder_days = '{1,2,3,4,5,6}', reminders_paused_on = null where id;
delete from attendance_reminder_prefs where profile_id in (select id from profiles where email like 'wkr.%@example.com');
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   reminder times: company defaults, personal times, HR defaults'
set role authenticated;
select test.login('wkr_tmp');
select test.check((select d -> 'effective' ->> 'punchIn' = '10:00' and d -> 'effective' ->> 'lunch' = '14:00' and d -> 'effective' ->> 'punchOut' = '19:00'
                          and d -> 'mine' ->> 'punchIn' is null and (d ->> 'canManage')::boolean = false
                     from (select attendance_reminder_settings() d) x), 'staff see company defaults 10:00 / 14:00 / 19:00');
select test.check((select d -> 'effective' ->> 'punchIn' = '09:30' and d -> 'mine' ->> 'punchIn' = '09:30' and d -> 'effective' ->> 'lunch' = '14:00'
                     from (select attendance_reminder_save_mine(true, '09:30', null, null) d) x), 'a personal Punch In 09:30 is saved and becomes effective');
select test.must_fail($$select attendance_reminder_save_mine(true, '05:30', null, null)$$, 'Punch In 05:30 is refused', 'between 06:00 and 13:00');
select test.must_fail($$select attendance_reminder_save_mine(true, '10:00', '10:30', null)$$, 'Lunch 10:30 is refused', 'between 11:00 and 17:00');
select test.must_fail($$select attendance_reminder_save_mine(true, '10:00', null, '23:45')$$, 'Punch Out 23:45 is refused', 'between 14:00 and 23:30');
select test.must_fail($$select attendance_reminder_save_mine(true, '13:00', null, '13:00')$$, 'Punch Out 13:00 is refused (outside its range)', 'between 14:00 and 23:30');
select test.check((select d -> 'effective' ->> 'punchIn' = '10:00' and d -> 'mine' ->> 'punchIn' is null
                     from (select attendance_reminder_save_mine(true, null, null, null) d) x), 'clearing a personal time falls back to the company default');
select test.must_fail($$select hr_attendance_reminder_defaults_save(true, '10:00', '14:00', '18:30', 15, 5, '{1,2,3,4,5,6}')$$,
  'a team member cannot change company defaults', 'FORBIDDEN');
select test.must_fail($$select hr_attendance_reminders_pause_today(true)$$, 'a team member cannot pause reminders', 'FORBIDDEN');
select test.login('hr_head');
select test.check((select (d ->> 'canManage')::boolean from (select attendance_reminder_settings() d) x), 'HR can manage the company defaults');
select test.must_fail($$select hr_attendance_reminder_defaults_save(true, '10:00', '14:00', '18:30', 15, 5, '{}')$$, 'no reminder days is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_attendance_reminder_defaults_save(true, '10:00', '14:00', '18:30', 15, 5, '{0,8}')$$, 'days outside 1..7 are refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_attendance_reminder_defaults_save(true, '10:00', '14:00', '18:30', 90, 5, '{1}')$$, 'a 90-minute follow-up is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_attendance_reminder_defaults_save(true, '10:00', '14:00', '09:00', 15, 5, '{1}')$$, 'a company Punch Out before Punch In is refused', 'VALIDATION_ERROR');
select hr_attendance_reminder_defaults_save(true, '10:00', '14:00', '18:30', 15, 5, '{1,2,3,4,5,6}');
select test.login('wkr_tmp');
select test.check((select d -> 'effective' ->> 'punchOut' = '18:30' from (select attendance_reminder_settings() d) x),
  'HR changes Punch Out default to 18:30; staff without a personal time now see 18:30');
select test.login('hr_head');
select test.check((select d ->> 'pausedToday' = 'true' from (select hr_attendance_reminders_pause_today(true) d) x), 'HR pause today sets pausedToday');
select test.check((select d ->> 'pausedToday' = 'false' from (select hr_attendance_reminders_pause_today(false) d) x), 'HR can turn today''s pause off again');
select test.login('sa');
select test.must_fail($$select attendance_reminder_save_mine(true, '09:30', null, null)$$, 'the Super Admin has no personal reminders', 'FORBIDDEN');
select test.check((select (d ->> 'canManage')::boolean and d -> 'mine' = 'null'::jsonb from (select attendance_reminder_settings() d) x),
  'the Super Admin sees the company defaults and no personal times');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'ATTENDANCE_REMINDERS_UPDATED' and actor_id = test.id('hr_head')),
  'changing the company defaults is on the audit trail');
select test.check((select count(*) >= 2 from audit_logs where action = 'ATTENDANCE_REMINDERS_PAUSED' and actor_id = test.id('hr_head')),
  'pausing reminders for today is on the audit trail');
update attendance_settings set reminder_punch_out = '19:00' where id;
