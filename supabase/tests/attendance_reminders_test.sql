-- =============================================================================
-- Attendance reminders (migration 20270109000200): company defaults and personal reminder times, devices (Web Push subscriptions),
-- and which reminders are due. Reuses weekly_report_routing_test.sql (wkr_tmp Support member, wkr_tms Sales member) and
-- hr_test.sql's HR head (hr_head) and rls_test.sql's Super Admin (sa). Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 145. Attendance reminders: times, devices, what is due'
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
select test.check((select count(*) >= 2 and bool_or(metadata ->> 'enabled' = 'true') from audit_logs where action = 'ATTENDANCE_REMINDERS_MINE_UPDATED' and actor_id = test.id('wkr_tmp')),
  'a person changing their own reminders is on the audit trail');
update attendance_settings set reminder_punch_out = '19:00' where id;

\echo '   devices: one owner per browser, keys never shown, gone devices switched off'
delete from push_subscriptions where endpoint like 'https://push.example.com/%';
set role authenticated;
select test.login('wkr_tmp');
select push_subscription_save('https://push.example.com/dev-1', 'BPk-p256dh-key-1', 'auth-1', 'Chrome on Android');
select push_subscription_save('https://push.example.com/dev-2', 'BPk-p256dh-key-2', 'auth-2', 'Edge on Windows');
select test.check((select jsonb_array_length(d) = 2 and not (d::text ~ 'p256dh|auth-1|endpoint') and bool_and(x ? 'label' and x ? 'id')
                     from (select my_push_devices() d) y, jsonb_array_elements(y.d) x group by d), 'a device is saved and listed without its keys');
select test.must_fail($$select push_subscription_save('http://push.example.com/dev-3', 'k', 'a', null)$$, 'an http:// endpoint is refused', 'VALIDATION_ERROR');
select test.must_fail($$select push_targets_for(test.id('wkr_tmp'))$$, 'staff cannot call push_targets_for', 'permission denied');
select test.must_fail($$select push_subscriptions_report('{}', '{}', '{}')$$, 'staff cannot report deliveries', 'permission denied');
select test.login('wkr_tms');
select push_subscription_save('https://push.example.com/dev-1', 'BPk-p256dh-key-1b', 'auth-1b', 'Chrome on Android');
select test.check((select jsonb_array_length(my_push_devices()) = 1), 'the second person now owns the shared device');
select push_subscription_remove('https://push.example.com/dev-2');
reset role;
select id as dev2 from push_subscriptions where endpoint = 'https://push.example.com/dev-2' \gset
set role authenticated;
select test.login('wkr_tms');
select test.must_fail(format($$select push_subscription_remove_by_id(%L)$$, :'dev2'), 'remove_by_id of someone else''s device is NOT_FOUND', 'NOT_FOUND');
select test.login('wkr_tmp');
select test.check((select jsonb_array_length(my_push_devices()) = 1),
  'the same endpoint saved by a second person moves to them; the first person no longer lists it');
reset role;
select test.check((select count(*) = 1 from push_subscriptions where endpoint = 'https://push.example.com/dev-2'), 'removing someone else''s endpoint changes nothing');
select test.check((select count(*) = 2 from audit_logs a join push_subscriptions p on p.id = a.entity_id
                     where a.action = 'PUSH_DEVICE_ADDED' and a.actor_id = test.id('wkr_tmp') and p.endpoint in ('https://push.example.com/dev-1', 'https://push.example.com/dev-2'))
                  and (select count(*) = 1 from audit_logs a join push_subscriptions p on p.id = a.entity_id
                        where a.action = 'PUSH_DEVICE_ADDED' and a.actor_id = test.id('wkr_tms') and (a.metadata ->> 'movedFromAnotherPerson')::boolean),
  'turning reminders on for a device is on the audit trail (and a device moving to someone else)');
select test.check((select jsonb_array_length(push_targets_for(test.id('wkr_tmp'))) = 1
                          and push_targets_for(test.id('wkr_tmp')) -> 0 ->> 'endpoint' = 'https://push.example.com/dev-2'
                          and push_targets_for(test.id('wkr_tmp')) -> 0 ->> 'p256dh' = 'BPk-p256dh-key-2'), 'the server gets the keys of a person''s active devices');
select push_subscriptions_report(array[(select id from push_subscriptions where endpoint = 'https://push.example.com/dev-1')], '{}',
                                 '{}');
select push_subscriptions_report('{}', array[(select id from push_subscriptions where endpoint = 'https://push.example.com/dev-2')], '{}');
select test.check((select not active and last_failure_at is not null from push_subscriptions where endpoint = 'https://push.example.com/dev-2')
                  and jsonb_array_length(push_targets_for(test.id('wkr_tmp'))) = 0, 'a gone report deactivates the device');
select test.check((select last_success_at is not null from push_subscriptions where endpoint = 'https://push.example.com/dev-1'), 'a delivery is stamped');
set role authenticated;
select test.login('wkr_tmp');
select test.check((select (my_push_devices() -> 0 ->> 'active')::boolean = false), 'the person sees the device is no longer active');
select push_subscription_save('https://push.example.com/dev-2', 'BPk-p256dh-key-2', 'auth-2', 'Edge on Windows');
reset role;
select test.check(jsonb_array_length(push_targets_for(test.id('wkr_tmp'))) = 1, 'turning reminders on again re-activates the device');
set role authenticated;
select test.login('wkr_tmp');
select push_subscription_remove_by_id((select (my_push_devices() -> 0 ->> 'id')::uuid));
select test.check(jsonb_array_length(my_push_devices()) = 0, 'a person removes their own device');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'PUSH_DEVICE_REMOVED' and actor_id = test.id('wkr_tmp') and entity_id = :'dev2'),
  'removing a device is on the audit trail');
set role authenticated;
select test.login('wkr_tmp');
select push_subscription_save('https://push.example.com/cap-' || g, 'BPk-cap', 'auth-cap', 'Device ' || g) from generate_series(1, 12) g;
reset role;
select test.check((select count(*) = 10 from push_subscriptions where profile_id = test.id('wkr_tmp') and active)
                  and (select bool_and(not active) from push_subscriptions where endpoint in ('https://push.example.com/cap-1', 'https://push.example.com/cap-2')),
  'at most 10 active devices per person: the oldest are switched off');
delete from push_subscriptions where endpoint like 'https://push.example.com/cap-%';

\echo '   what is due: once only, never late, never for something already done, on leave, on a day off or when switched off'
-- Office days in January 2027: Monday 11 ... Sunday 17, Monday 18. Each call is made at a fixed office time (p_now).
create or replace function test.due(p_who text, p_at text) returns jsonb language sql as $$
  select coalesce(jsonb_agg(x order by x ->> 'kind', x ->> 'step'), '[]'::jsonb)
    from jsonb_array_elements(attendance_reminders_due((p_at::timestamp) at time zone 'Asia/Kolkata')) x
   where x ->> 'profileId' = test.id(p_who)::text $$;
create or replace function test.kinds(p_who text, p_at text) returns text language sql as $$
  select coalesce(string_agg((x ->> 'kind') || (x ->> 'step'), ',' order by x ->> 'kind', x ->> 'step'), '')
    from jsonb_array_elements(test.due(p_who, p_at)) x $$;
create or replace function test.at(p_at text) returns timestamptz language sql as $$ select (p_at::timestamp) at time zone 'Asia/Kolkata' $$;
create or replace function test.punch(p_who text, p_day date, p_in text, p_out text default null) returns void language sql as $$
  insert into public.attendance_records (profile_id, attendance_date, punch_in_at, punch_out_at)
  values (test.id(p_who), p_day, test.at(p_in), test.at(p_out))
  on conflict (profile_id, attendance_date) do update set punch_in_at = excluded.punch_in_at, punch_out_at = excluded.punch_out_at $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
-- the scheduled run is the API's service role: nobody is signed in
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
update attendance_settings set lunch_allowance_minutes = 45 where id;
delete from attendance_reminder_log where profile_id in (select id from profiles where email like 'wkr.%@example.com');
delete from notifications where type = 'ATTENDANCE_REMINDER' and recipient_id in (select id from profiles where email like 'wkr.%@example.com');
delete from attendance_lunches where profile_id in (select id from profiles where email like 'wkr.%@example.com');
delete from attendance_records where profile_id in (select id from profiles where email like 'wkr.%@example.com') and attendance_date between '2027-01-11' and '2027-01-18';
delete from leave_requests where employee_id in (select id from profiles where email like 'wkr.%@example.com') and start_date between '2027-01-11' and '2027-01-18';
delete from attendance_reminder_prefs where profile_id in (select id from profiles where email like 'wkr.%@example.com');
delete from push_subscriptions where endpoint like 'https://push.example.com/%';
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values
  (test.id('wkr_tmp'), 'https://push.example.com/tmp-phone', 'BPk-phone', 'auth-phone', 'Chrome on Android', true),
  (test.id('wkr_tmp'), 'https://push.example.com/tmp-old', 'BPk-old', 'auth-old', 'Old laptop', false);

select test.check(test.kinds('wkr_tmp', '2027-01-11 10:00') = 'PUNCH_IN0', '10:00 Monday, not punched in: one PUNCH_IN step 0');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('wkr_tmp') and type = 'ATTENDANCE_REMINDER' and entity_type = 'attendance'
                     and title = 'Time to Punch In' and body = 'Your day starts at 10:00. Open Attendance to punch in.' and data ->> 'kind' = 'PUNCH_IN'), 'and one bell notification with the exact text');
select test.check(test.kinds('wkr_tmp', '2027-01-11 10:00') = '' and test.kinds('wkr_tmp', '2027-01-11 10:05') = '', 'the same call again returns nothing (once only)');
select test.check((select x ->> 'title' = 'Time to Punch In (reminder)' and x ->> 'step' = '1' and x ->> 'tag' = 'att-punch_in-2027-01-11' and x ->> 'url' = '/?open=attendance'
                     from jsonb_array_elements(test.due('wkr_tmp', '2027-01-11 10:15')) x), '10:15 still not punched in: step 1 follow-up with "(reminder)" title');
select test.punch('wkr_tmp', '2027-01-11', '2027-01-11 10:20');
select test.check(test.kinds('wkr_tmp', '2027-01-11 13:55') = '', 'punched in: nothing more until lunch');
select test.check((select x -> 'targets' -> 0 ->> 'endpoint' = 'https://push.example.com/tmp-phone' and jsonb_array_length(x -> 'targets') = 1
                          and x ->> 'title' = 'Lunch time' and x ->> 'body' = 'Start your lunch break in Attendance when you go.'
                     from jsonb_array_elements(test.due('wkr_tmp', '2027-01-11 14:00')) x),
  'Start Lunch at 14:00; the result carries targets for the person''s active devices only');
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), '2027-01-11', test.at('2027-01-11 14:05'));
select test.check(test.kinds('wkr_tmp', '2027-01-11 14:15') = '', 'lunch already started: no lunch follow-up');
select test.check(test.kinds('wkr_tmp', '2027-01-11 14:40') = '', 'lunch started 14:05: the warning is not due before 14:45');
select test.check((select x ->> 'title' = 'Lunch ends in 5 minutes' and x ->> 'body' = 'End your lunch break in Attendance when you are back.'
                     from jsonb_array_elements(test.due('wkr_tmp', '2027-01-11 14:45')) x),
  'lunch started 14:05, allowance 45, warning 5: LUNCH_END due 14:45');
select test.check(test.kinds('wkr_tmp', '2027-01-11 14:50') = '', 'the lunch warning goes out once');
update attendance_lunches set ended_at = test.at('2027-01-11 14:46'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp') and ended_at is null;
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), '2027-01-11', test.at('2027-01-11 15:00'));
select test.check(test.kinds('wkr_tmp', '2027-01-11 15:01') = '' and test.kinds('wkr_tmp', '2027-01-11 15:20') = '', 'second break with 4 minutes left: no LUNCH_END');
update attendance_lunches set ended_at = test.at('2027-01-11 15:10'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp') and ended_at is null;
select test.check((select x ->> 'body' = 'Your day ends at 19:00. Punch out before you leave.' from jsonb_array_elements(test.due('wkr_tmp', '2027-01-11 19:00')) x),
  'Punch Out at 19:00');
select test.punch('wkr_tmp', '2027-01-11', '2027-01-11 10:20', '2027-01-11 19:05');
select test.check(test.kinds('wkr_tmp', '2027-01-11 19:15') = '', 'already punched out: no PUNCH_OUT follow-up');
select test.check(not exists (select 1 from jsonb_array_elements(attendance_reminders_due(test.at('2027-01-11 10:00'))) x where x ->> 'profileId' = test.id('sa')::text)
  , 'the Super Admin is never reminded');

-- Tuesday: punched in early, personal time later; the first run of the day is late
insert into attendance_reminder_prefs (profile_id, punch_in) values (test.id('wkr_tms'), '10:30') on conflict (profile_id) do update set punch_in = '10:30';
select test.punch('wkr_tms', '2027-01-12', '2027-01-12 09:55');
-- (each run reminds everyone: wkr_tmp's first run of the day comes first)
select test.check(test.kinds('wkr_tmp', '2027-01-12 10:40') = 'PUNCH_IN1',
  'first run at 10:40 after a missed 10:00 and 10:15: step 0 is dropped (40 minutes late), step 1 due 10:15 is sent (25 minutes late)');
select test.check(test.kinds('wkr_tms', '2027-01-12 10:30') = '' and test.kinds('wkr_tms', '2027-01-12 10:45') = '',
  'punched in at 09:55 with personal Punch In 10:30: nothing at 10:30');
select test.check(test.kinds('wkr_tmp', '2027-01-13 10:20') = 'PUNCH_IN1', 'a run when the follow-up is already due sends only the follow-up, not both');
select test.check(test.kinds('wkr_tmp', '2027-01-14 11:00') = '', 'first run at 11:00: nothing at all (both steps more than 30 minutes late)');
-- the lunch warning off the 5-minute grid: a break from 14:03 ends at 14:48; the run at 14:45 says how long is really left
select test.punch('wkr_tmp', '2027-01-13', '2027-01-13 09:50');
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), '2027-01-13', test.at('2027-01-13 14:03'));
select test.check((select x ->> 'title' = 'Lunch ends in 3 minutes' from jsonb_array_elements(test.due('wkr_tmp', '2027-01-13 14:45')) x where x ->> 'kind' = 'LUNCH_END'),
  'a break from 14:03: the 14:45 run says "Lunch ends in 3 minutes" (the time really left)');
update attendance_lunches set ended_at = test.at('2027-01-13 14:50'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp') and ended_at is null;
select test.punch('wkr_tmp', '2027-01-14', '2027-01-14 09:50');
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), '2027-01-14', test.at('2027-01-14 14:03'));
select test.check(test.kinds('wkr_tmp', '2027-01-14 14:50') = '', 'the 14:45 run was missed: at 14:50 the allowance is already over, so no "ends soon" warning');
update attendance_lunches set ended_at = test.at('2027-01-14 14:55'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp') and ended_at is null;
select test.check(test.kinds('wkr_tmp', '2027-01-17 10:00') = '', 'Sunday 10:00: nothing');

-- leave, the HR pause and the personal switch
insert into leave_requests (employee_id, leave_type, start_date, end_date, half_day_shift, reason, status) values
  (test.id('wkr_tmp'), 'FULL_DAY', '2027-01-15', '2027-01-15', null, 'synthetic test leave', 'APPROVED'),
  (test.id('wkr_tms'), 'HALF_DAY', '2027-01-15', '2027-01-15', 'AFTERNOON', 'synthetic test leave', 'APPROVED'),
  (test.id('wkr_tmp'), 'HALF_DAY', '2027-01-16', '2027-01-16', 'MORNING', 'synthetic test leave', 'APPROVED'),
  (test.id('wkr_tms'), 'FULL_DAY', '2027-01-16', '2027-01-16', null, 'synthetic test leave', 'PENDING_HR');
select test.punch('wkr_tms', '2027-01-15', '2027-01-15 09:50');
select test.check(test.kinds('wkr_tmp', '2027-01-15 10:00') = '' and test.kinds('wkr_tmp', '2027-01-15 14:00') = '' and test.kinds('wkr_tmp', '2027-01-15 19:00') = '',
  'approved full-day leave: nothing all day');
select test.check(test.kinds('wkr_tms', '2027-01-15 14:00') = '' and test.kinds('wkr_tms', '2027-01-15 19:00') = '', 'afternoon half-day: no LUNCH, no PUNCH_OUT');
select test.check(test.kinds('wkr_tmp', '2027-01-16 10:00') = '', 'morning half-day: no PUNCH_IN');
select test.check(test.kinds('wkr_tms', '2027-01-16 10:30') = 'PUNCH_IN0', 'leave that is not approved yet does not stop reminders');
update attendance_settings set reminders_paused_on = '2027-01-18' where id;
select test.check(test.kinds('wkr_tmp', '2027-01-18 10:00') = '', 'HR paused today: nothing');
update attendance_settings set reminders_paused_on = null where id;
insert into attendance_reminder_prefs (profile_id, enabled) values (test.id('wkr_tmp'), false) on conflict (profile_id) do update set enabled = false;
select test.check(test.kinds('wkr_tmp', '2027-01-18 10:05') = '', 'personal switch off: nothing');
update attendance_reminder_prefs set enabled = true where profile_id = test.id('wkr_tmp');
update attendance_settings set reminders_enabled = false where id;
select test.check(test.kinds('wkr_tmp', '2027-01-18 10:10') = '', 'company switch off: nothing');
update attendance_settings set reminders_enabled = true where id;
select test.check(test.kinds('wkr_tmp', '2027-01-18 10:15') = 'PUNCH_IN1', 'switched back on: the reminder that is due now goes out');
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select attendance_reminders_due(now())$$, 'staff cannot run the reminders', 'permission denied');
reset role;
delete from push_subscriptions where endpoint like 'https://push.example.com/%';

\echo '   a browser that renews its subscription (pushsubscriptionchange) keeps getting the same person''s reminders'
\i supabase/migrations/20270110000200_push_subscription_replace.sql
\i supabase/migrations/20270110000200_push_subscription_replace.sql
delete from push_subscriptions where endpoint like 'https://push.example.com/%';
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values
  (test.id('wkr_tmp'), 'https://push.example.com/old', 'BPk-old', 'auth-old', 'Chrome on Android', true),
  (test.id('wkr_tmp'), 'https://push.example.com/off', 'BPk-off', 'auth-off', 'Old laptop', false),
  (test.id('wkr_tms'), 'https://push.example.com/taken', 'BPk-taken', 'auth-taken', 'Edge', true);
select id as old_id from push_subscriptions where endpoint = 'https://push.example.com/old' \gset
select test.check(push_subscription_replace('https://push.example.com/old', 'https://push.example.com/new', 'BPk-new', 'auth-new'), 'the renewed subscription is accepted');
select test.check((select profile_id = test.id('wkr_tmp') and endpoint = 'https://push.example.com/new' and p256dh = 'BPk-new' and auth = 'auth-new' and active
                     from push_subscriptions where id = :'old_id')
                  and not exists (select 1 from push_subscriptions where endpoint = 'https://push.example.com/old'),
  'the same device row now has the new address and keys, and the same owner');
select test.check(not push_subscription_replace('https://push.example.com/unknown', 'https://push.example.com/x', 'k', 'a')
                  and not exists (select 1 from push_subscriptions where endpoint = 'https://push.example.com/x'), 'an unknown old address changes nothing');
select test.check(not push_subscription_replace('https://push.example.com/off', 'https://push.example.com/y', 'k', 'a')
                  and not exists (select 1 from push_subscriptions where endpoint = 'https://push.example.com/y'), 'a switched-off device is not switched back on this way');
select test.check(not push_subscription_replace('https://push.example.com/new', 'https://push.example.com/taken', 'k', 'a')
                  and (select profile_id = test.id('wkr_tms') and p256dh = 'BPk-taken' from push_subscriptions where endpoint = 'https://push.example.com/taken'),
  'an address that already belongs to another device is never taken over');
select test.must_fail($$select push_subscription_replace('https://push.example.com/new', 'http://push.example.com/z', 'k', 'a')$$, 'the new address must be https', 'VALIDATION_ERROR');
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select push_subscription_replace('https://push.example.com/new', 'https://push.example.com/z', 'k', 'a')$$,
  'only the server (service role) replaces a subscription', 'permission denied');
reset role;
delete from push_subscriptions where endpoint like 'https://push.example.com/%';

\echo '   a device already subscribed is claimed by whoever signs in on it, but a removed device is never brought back'
delete from push_subscriptions where endpoint like 'https://push.example.com/%';
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label) values
  (test.id('wkr_tms'), 'https://push.example.com/shared', 'BPk-s', 'auth-s', 'Shared phone');
set role authenticated;
select test.login('wkr_tmp');
select test.check(push_subscription_claim('https://push.example.com/shared', 'BPk-s', 'auth-s', 'Shared phone'), 'the person now using a shared phone claims it');
select test.check(jsonb_array_length(my_push_devices()) = 1, 'it is in their list');
select test.check(not push_subscription_claim('https://push.example.com/removed', 'BPk-r', 'auth-r', 'Removed phone'), 'a device removed from the list is not brought back');
reset role;
select test.check((select profile_id = test.id('wkr_tmp') from push_subscriptions where endpoint = 'https://push.example.com/shared')
                  and not exists (select 1 from push_subscriptions where endpoint = 'https://push.example.com/removed'), 'claiming moves the owner and creates nothing');
select test.check((select count(*) = 1 from audit_logs a join push_subscriptions p on p.id = a.entity_id
                    where a.action = 'PUSH_DEVICE_ADDED' and a.actor_id = test.id('wkr_tmp') and p.endpoint = 'https://push.example.com/shared'),
  'a device moving to another person is on the audit trail');
set role authenticated;
select test.login('wkr_tmp');
select push_subscription_claim('https://push.example.com/shared', 'BPk-s', 'auth-s', 'Shared phone');
reset role;
select test.check((select count(*) = 1 from audit_logs a join push_subscriptions p on p.id = a.entity_id
                    where a.action = 'PUSH_DEVICE_ADDED' and a.actor_id = test.id('wkr_tmp') and p.endpoint = 'https://push.example.com/shared'),
  'claiming your own device again writes nothing');
delete from push_subscriptions where endpoint like 'https://push.example.com/%';
