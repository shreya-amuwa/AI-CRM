-- =============================================================================
-- Notification reliability (migration 20270126000200): the delivery outbox (generation, claiming with leases, reporting, retries, expiry,
-- cancellation when the reminder is no longer true), the Resume Work reminder, test notifications, sound settings, browser reports and
-- Notification Health with its permissions. Reuses wkr_tmp / wkr_tms (weekly_report_routing_test.sql), hr_head (hr_test.sql), sa
-- (rls_test.sql), rr_rec1 (an HR Recruiter) and dh_wab (a Department Head outside HR). Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 160. Notification reliability: outbox, Resume Work, tests, sound, Notification Health'
reset role;
\i supabase/migrations/20270126000200_notification_reliability.sql
\i supabase/migrations/20270126000200_notification_reliability.sql
grant execute on all functions in schema test to anon, authenticated, service_role;
update attendance_settings set reminders_enabled = true, reminder_punch_in = '10:00', reminder_lunch = '14:00', reminder_punch_out = '19:00',
       reminder_follow_up_minutes = 15, reminder_lunch_warning_minutes = 5, reminder_days = '{1,2,3,4,5,6,7}', reminders_paused_on = null,
       reminder_resume_follow_up_minutes = 10, lunch_allowance_minutes = 45 where id;

create or replace function test.ist(p_day date, p_time text) returns timestamptz language sql as $$ select (p_day + p_time::time) at time zone 'Asia/Kolkata' $$;
create or replace function test.reset_people() returns void language sql as $$
  delete from public.notification_deliveries where profile_id in (select id from public.profiles where email like 'wkr.%@example.com');
  delete from public.attendance_reminder_log where profile_id in (select id from public.profiles where email like 'wkr.%@example.com');
  delete from public.notifications where type in ('ATTENDANCE_REMINDER', 'NOTIFICATION_TEST') and recipient_id in (select id from public.profiles where email like 'wkr.%@example.com');
  delete from public.attendance_lunches where profile_id in (select id from public.profiles where email like 'wkr.%@example.com');
  delete from public.attendance_records where profile_id in (select id from public.profiles where email like 'wkr.%@example.com');
  delete from public.leave_requests where employee_id in (select id from public.profiles where email like 'wkr.%@example.com') and reason = 'synthetic reliability leave';
  delete from public.attendance_reminder_prefs where profile_id in (select id from public.profiles where email like 'wkr.%@example.com');
  delete from public.push_subscriptions where endpoint like 'https://push.example.com/rel-%';
$$;
-- the reminders of one person, from a generation at p_at today (office time)
create or replace function test.gen(p_at text, p_push boolean default true) returns jsonb language sql as $$
  select attendance_reminders_generate(test.ist(private.office_today(), p_at), p_push) $$;
create or replace function test.logs(p_who text) returns text language sql as $$
  select coalesce(string_agg(kind || step, ',' order by id), '') from public.attendance_reminder_log
   where profile_id = test.id(p_who) and attendance_date = private.office_today() $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.reset_people();
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values
  (test.id('wkr_tmp'), 'https://push.example.com/rel-phone', 'BPk-phone', 'auth-phone', 'Chrome on Android', true),
  (test.id('wkr_tmp'), 'https://push.example.com/rel-laptop', 'BPk-laptop', 'auth-laptop', 'Edge on Windows', true),
  (test.id('wkr_tmp'), 'https://push.example.com/rel-old', 'BPk-old', 'auth-old', 'Old laptop', false);

\echo '   generation: reminder, bell and one delivery per active device, in one go and only once'
select test.check((select (g ->> 'generated')::integer >= 2 and (g ->> 'jobsCreated')::integer >= 2 from (select test.gen('10:00') g) x),
  'a Punch In reminder is generated with delivery jobs');
select test.check(test.logs('wkr_tmp') = 'PUNCH_IN0', 'wkr_tmp has one PUNCH_IN step 0');
select test.check((select count(*) = 2 and bool_and(n.status = 'PENDING' and n.kind = 'ATTENDANCE_REMINDER' and n.tag like 'att-punch_in-%' and n.url = '/?open=attendance')
                     from notification_deliveries n where n.profile_id = test.id('wkr_tmp')), 'two PENDING deliveries: the two active devices, not the switched-off one');
select test.check((select g.push_status = 'QUEUED' and g.devices = 2 and g.notification_id is not null and g.due_at = test.ist(private.office_today(), '10:00')
                     from attendance_reminder_log g where g.profile_id = test.id('wkr_tmp')), 'the log knows its bell notification, due time, devices and push status');
select test.check((select count(*) = 1 from notifications n join attendance_reminder_log g on g.notification_id = n.id
                    where g.profile_id = test.id('wkr_tmp') and n.recipient_id = test.id('wkr_tmp') and n.type = 'ATTENDANCE_REMINDER'), 'the bell notification belongs to the employee');
select test.check((select g ->> 'generated' = '0' from (select test.gen('10:00') g) x), 'running the generation again creates no reminder (overlapping cron runs)');
select test.check((select count(*) = 2 from notification_deliveries where profile_id = test.id('wkr_tmp'))
                  and (select count(*) = 1 from notifications where recipient_id = test.id('wkr_tmp') and type = 'ATTENDANCE_REMINDER'), '... and no second bell or delivery');
select test.check((select push_status = 'NO_DEVICE' and devices = 0 from attendance_reminder_log where profile_id = test.id('wkr_tms')),
  'an employee with no device is recorded as NO_DEVICE (not silently sent)');
select test.check(not exists (select 1 from attendance_reminder_log where profile_id = test.id('sa') and attendance_date = private.office_today()),
  'the Super Admin gets no routine attendance reminder');

\echo '   claiming: leases, no double claim, stale reminders cancelled, devices that moved never used'
update notification_deliveries set expires_at = now() + interval '1 hour', next_attempt_at = now() - interval '1 second' where profile_id = test.id('wkr_tmp');
create temp table c1 as select x from jsonb_array_elements(push_deliveries_claim(500, 60, (select array_agg(id) from notification_deliveries where profile_id = test.id('wkr_tmp')))) x;
select test.check((select count(*) = 2 and bool_and(x ? 'lease' and x ? 'endpoint' and (x ->> 'ttl')::integer between 60 and 3600) from c1),
  'both deliveries are claimed with a lease, the device address and a TTL until expiry');
select test.check(jsonb_array_length(push_deliveries_claim(500, 60, (select array_agg(id) from notification_deliveries where profile_id = test.id('wkr_tmp')))) = 0,
  'a second claim while the lease runs takes nothing (two runs at once never push twice)');
select test.check((select bool_and(status = 'PROCESSING' and attempts = 1) from notification_deliveries where profile_id = test.id('wkr_tmp')), 'claimed rows are PROCESSING, attempt 1');

\echo '   reporting: accepted, retry with backoff, gone switches the device off, stale leases ignored'
select push_deliveries_report(jsonb_build_array(
  jsonb_build_object('id', (select (x ->> 'id')::bigint from c1 where x ->> 'endpoint' like '%rel-phone'), 'lease', (select x ->> 'lease' from c1 where x ->> 'endpoint' like '%rel-phone'),
                     'outcome', 'accepted', 'status', 201, 'ms', 120),
  jsonb_build_object('id', (select (x ->> 'id')::bigint from c1 where x ->> 'endpoint' like '%rel-laptop'), 'lease', (select x ->> 'lease' from c1 where x ->> 'endpoint' like '%rel-laptop'),
                     'outcome', 'retry', 'status', 503, 'error', 'HTTP 503')));
select test.check((select status = 'ACCEPTED_BY_PUSH_SERVICE' and accepted_at is not null and last_status_code = 201 from notification_deliveries n
                     join push_subscriptions s on s.id = n.subscription_id where s.endpoint = 'https://push.example.com/rel-phone'), 'a 201 is ACCEPTED_BY_PUSH_SERVICE (not "delivered")');
select test.check((select last_success_at is not null and failure_count = 0 from push_subscriptions where endpoint = 'https://push.example.com/rel-phone'), 'the device records the acceptance');
select test.check((select status = 'RETRY_PENDING' and next_attempt_at > now() + interval '50 seconds' and last_error = 'HTTP 503' from notification_deliveries n
                     join push_subscriptions s on s.id = n.subscription_id where s.endpoint = 'https://push.example.com/rel-laptop'), 'a 503 is RETRY_PENDING about a minute later');
select test.check((select count(*) = 2 from notification_delivery_attempts a join notification_deliveries n on n.id = a.delivery_id where n.profile_id = test.id('wkr_tmp')),
  'each attempt is in the attempt history');
select test.check((push_deliveries_report(jsonb_build_array(jsonb_build_object('id', (select (x ->> 'id')::bigint from c1 where x ->> 'endpoint' like '%rel-phone'),
                   'lease', (select x ->> 'lease' from c1 where x ->> 'endpoint' like '%rel-phone'), 'outcome', 'failed'))) ->> 'ignored') = '1',
  'a second report for a finished delivery is ignored');
-- the retry: due now, claimed again, then the push service says the device is gone
update notification_deliveries set next_attempt_at = now() - interval '1 second' where status = 'RETRY_PENDING' and profile_id = test.id('wkr_tmp');
create temp table c2 as select x from jsonb_array_elements(push_deliveries_claim(500, 60, (select array_agg(id) from notification_deliveries where profile_id = test.id('wkr_tmp')))) x;
select test.check((select count(*) = 1 from c2) and (select attempts = 2 from notification_deliveries where id = (select (x ->> 'id')::bigint from c2)), 'the retry is claimed again (attempt 2)');
select push_deliveries_report(jsonb_build_array(jsonb_build_object('id', (select (x ->> 'id')::bigint from c2), 'lease', (select x ->> 'lease' from c2), 'outcome', 'gone', 'status', 410)));
select test.check((select not active and deactivated_reason = 'EXPIRED_AT_PUSH_SERVICE' and last_failure_code = '410' from push_subscriptions where endpoint = 'https://push.example.com/rel-laptop'),
  'a 410 switches the device off for good, with the reason');
select test.check((select status = 'FAILED' and last_error = 'DEVICE_GONE' from notification_deliveries where id = (select (x ->> 'id')::bigint from c2)), 'and that delivery is FAILED (not retried)');

\echo '   bounded retries, expiry, crashed workers'
insert into notification_deliveries (kind, profile_id, subscription_id, title, body, tag, url, expires_at, max_attempts, status, attempts, next_attempt_at)
select 'TEST', test.id('wkr_tmp'), id, 'Test notification', 'x', 'crm-test', '/?open=attendance', now() + interval '1 hour', 2, 'PENDING', 0, now() - interval '1 second'
  from push_subscriptions where endpoint = 'https://push.example.com/rel-phone';
select max(id) as tid from notification_deliveries \gset
create temp table c3 as select x from jsonb_array_elements(push_deliveries_claim(10, 60, array[:tid::bigint])) x;
select push_deliveries_report(jsonb_build_array(jsonb_build_object('id', :tid, 'lease', (select x ->> 'lease' from c3), 'outcome', 'retry', 'status', 429, 'retryAfter', 5)));
select test.check((select status = 'RETRY_PENDING' and next_attempt_at between now() + interval '25 seconds' and now() + interval '35 seconds' from notification_deliveries where id = :tid),
  'a 429 with Retry-After waits at least 30 seconds');
update notification_deliveries set next_attempt_at = now() - interval '1 second' where id = :tid;
create temp table c4 as select x from jsonb_array_elements(push_deliveries_claim(10, 60, array[:tid::bigint])) x;
select push_deliveries_report(jsonb_build_array(jsonb_build_object('id', :tid, 'lease', (select x ->> 'lease' from c4), 'outcome', 'retry', 'status', 500)));
select test.check((select status = 'FAILED' and attempts = 2 from notification_deliveries where id = :tid), 'after max_attempts a transient failure is FAILED (no endless retries)');
-- a worker that died while PROCESSING: the row is taken again once its lease ends
insert into notification_deliveries (kind, profile_id, subscription_id, title, body, tag, url, expires_at, status, attempts, lease_token, lease_until)
select 'TEST', test.id('wkr_tmp'), id, 'Test notification', 'x', 'crm-test', '/?open=attendance', now() + interval '1 hour', 'PROCESSING', 1, gen_random_uuid(), now() - interval '1 second'
  from push_subscriptions where endpoint = 'https://push.example.com/rel-phone';
select max(id) as cid from notification_deliveries \gset
select test.check(jsonb_array_length(push_deliveries_claim(10, 60, array[:cid::bigint])) = 1, 'a delivery whose worker crashed is claimed again after its lease');
select test.check((select attempts = 2 and status = 'PROCESSING' from notification_deliveries where id = :cid), '... as attempt 2 with a new lease');
insert into notification_deliveries (kind, profile_id, subscription_id, title, body, tag, url, expires_at, status)
select 'TEST', test.id('wkr_tmp'), id, 'Test notification', 'x', 'crm-test', '/?open=attendance', now() - interval '1 second', 'PENDING'
  from push_subscriptions where endpoint = 'https://push.example.com/rel-phone';
select max(id) as eid from notification_deliveries \gset
select test.check(jsonb_array_length(push_deliveries_claim(10, 60, array[:eid::bigint])) = 0, 'a delivery past its expiry is not pushed');
select test.check((select status = 'EXPIRED' from notification_deliveries where id = :eid), '... it is EXPIRED, never pushed late');

\echo '   stale reminders are cancelled, shared devices are never used for the previous person'
select test.reset_people();
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values
  (test.id('wkr_tmp'), 'https://push.example.com/rel-phone', 'BPk-phone', 'auth-phone', 'Chrome on Android', true),
  (test.id('wkr_tms'), 'https://push.example.com/rel-shared', 'BPk-shared', 'auth-shared', 'Shared phone', true);
select test.gen('10:00');
update notification_deliveries set expires_at = now() + interval '1 hour' where profile_id in (test.id('wkr_tmp'), test.id('wkr_tms'));
-- wkr_tmp punches in before the push goes out; the shared phone is now used by wkr_tmp
insert into attendance_records (profile_id, attendance_date, punch_in_at) values (test.id('wkr_tmp'), private.office_today(), now());
update push_subscriptions set profile_id = test.id('wkr_tmp') where endpoint = 'https://push.example.com/rel-shared';
select test.check(jsonb_array_length(push_deliveries_claim(500, 60, (select array_agg(id) from notification_deliveries where profile_id in (test.id('wkr_tmp'), test.id('wkr_tms'))))) = 0,
  'nothing is pushed: one reminder is done, the other device moved to another person');
select test.check((select last_error = 'NO_LONGER_DUE' and status = 'CANCELLED' from notification_deliveries where profile_id = test.id('wkr_tmp')),
  'punched in after the reminder was generated: CANCELLED (NO_LONGER_DUE)');
select test.check((select last_error = 'DEVICE_REASSIGNED' and status = 'CANCELLED' from notification_deliveries where profile_id = test.id('wkr_tms')),
  'the shared phone that now belongs to someone else: CANCELLED (DEVICE_REASSIGNED)');
select test.check((select count(*) = 0 from notification_deliveries where profile_id = test.id('wkr_tmp') and subscription_id =
                    (select id from push_subscriptions where endpoint = 'https://push.example.com/rel-shared')), 'and the previous person''s reminder is not re-addressed to the new owner');
select test.check((select g ->> 'pushOff' = 'true' and (g ->> 'jobsCreated')::integer = 0 from (select test.gen('19:00', false) g) x),
  'with push not configured no delivery is queued');
select test.check((select push_status = 'PUSH_OFF' and notification_id is not null from attendance_reminder_log where profile_id = test.id('wkr_tmp') and kind = 'PUNCH_OUT'),
  '... and the reminder still reaches the bell (PUSH_OFF)');

\echo '   Resume Work: at the end of the allowance, once, follow-up, stops after Resume Work or Punch Out'
select test.reset_people();
insert into attendance_records (profile_id, attendance_date, punch_in_at) values (test.id('wkr_tmp'), private.office_today(), test.ist(private.office_today(), '09:50'));
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), private.office_today(), test.ist(private.office_today(), '14:00'));
select test.gen('14:40');
select test.check(test.logs('wkr_tmp') = 'LUNCH_END0', '14:40: the warning (5 minutes before), no Resume Work yet');
select test.gen('14:45');
select test.check(test.logs('wkr_tmp') = 'LUNCH_END0,RESUME_WORK0', '14:45 (start 14:00 + 45 min): Time to Resume Work');
select test.check((select n.title = 'Time to Resume Work' and n.body = 'Your lunch break has ended. Please tap Resume Work in Amuwa CRM.'
                     from notifications n join attendance_reminder_log g on g.notification_id = n.id where g.profile_id = test.id('wkr_tmp') and g.kind = 'RESUME_WORK'),
  'with the exact title and text');
select test.gen('14:50');
select test.check(test.logs('wkr_tmp') = 'LUNCH_END0,RESUME_WORK0', 'not repeated at the next run');
select test.gen('14:55');
select test.check(test.logs('wkr_tmp') = 'LUNCH_END0,RESUME_WORK0,RESUME_WORK1', '14:55: one follow-up after 10 minutes');
select test.gen('15:30');
select test.check(test.logs('wkr_tmp') = 'LUNCH_END0,RESUME_WORK0,RESUME_WORK1', 'and nothing more');
-- a second break with 20 minutes left of the allowance (25 used): due 20 minutes after it starts, follow-up off
update attendance_lunches set ended_at = test.ist(private.office_today(), '14:25'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp');
update attendance_settings set reminder_resume_follow_up_minutes = 0 where id;
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), private.office_today(), test.ist(private.office_today(), '16:00'));
select test.gen('16:15');
select test.check(test.logs('wkr_tmp') ~ 'LUNCH_END0$', '16:15: the warning of the second break (20 left, warned at 16:15)');
select test.gen('16:20');
select test.check(test.logs('wkr_tmp') ~ 'RESUME_WORK0$', '16:20: Resume Work, from the remaining allowance of the day');
select test.gen('16:40');
select test.check(test.logs('wkr_tmp') ~ 'RESUME_WORK0$', 'follow-up switched off (0): no follow-up');
update attendance_settings set reminder_resume_follow_up_minutes = 10 where id;
-- a break with nothing left: reminded 5 minutes in, not at once
update attendance_lunches set ended_at = test.ist(private.office_today(), '16:30'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp') and ended_at is null;
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), private.office_today(), test.ist(private.office_today(), '17:00'));
select count(*) as before from attendance_reminder_log where profile_id = test.id('wkr_tmp') and kind = 'RESUME_WORK' \gset
select test.gen('17:00');
select test.check((select count(*) = :before from attendance_reminder_log where profile_id = test.id('wkr_tmp') and kind = 'RESUME_WORK'), 'allowance used up: nothing at the start of the break');
select test.gen('17:05');
select test.check((select count(*) = :before + 1 from attendance_reminder_log where profile_id = test.id('wkr_tmp') and kind = 'RESUME_WORK'), '... and Resume Work after 5 minutes');
-- Resume Work done / Punch Out: no more reminders for this break
update attendance_lunches set ended_at = test.ist(private.office_today(), '17:06'), ended_by = 'EMPLOYEE' where profile_id = test.id('wkr_tmp') and ended_at is null;
select test.gen('17:15');
select test.check((select count(*) = :before + 1 from attendance_reminder_log where profile_id = test.id('wkr_tmp') and kind = 'RESUME_WORK'), 'after Resume Work: no follow-up');
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('wkr_tmp'), private.office_today(), test.ist(private.office_today(), '17:30'));
update attendance_records set punch_out_at = test.ist(private.office_today(), '17:31') where profile_id = test.id('wkr_tmp') and attendance_date = private.office_today();
select test.gen('17:40');
select test.check((select count(*) = :before + 1 from attendance_reminder_log where profile_id = test.id('wkr_tmp') and kind = 'RESUME_WORK'), 'after Punch Out: no Resume Work');
update attendance_lunches set ended_at = test.ist(private.office_today(), '17:31'), ended_by = 'PUNCH_OUT' where profile_id = test.id('wkr_tmp') and ended_at is null;
-- approved leave and the personal switch suppress the outbox too
select test.reset_people();
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values (test.id('wkr_tmp'), 'https://push.example.com/rel-phone', 'BPk-phone', 'auth-phone', 'Chrome', true);
insert into leave_requests (employee_id, leave_type, start_date, end_date, half_day_shift, reason, status)
values (test.id('wkr_tmp'), 'FULL_DAY', private.office_today(), private.office_today(), null, 'synthetic reliability leave', 'APPROVED');
select test.gen('10:00');
select test.check(test.logs('wkr_tmp') = '' and not exists (select 1 from notification_deliveries where profile_id = test.id('wkr_tmp')), 'approved leave: no reminder, no delivery');
select test.reset_people();

\echo '   test notifications: own devices only, rate limited, admin tests audited, no attendance record'
insert into push_subscriptions (profile_id, endpoint, p256dh, auth, label, active) values
  (test.id('wkr_tmp'), 'https://push.example.com/rel-phone', 'BPk-phone', 'auth-phone', 'Chrome on Android', true),
  (test.id('wkr_tms'), 'https://push.example.com/rel-other', 'BPk-other', 'auth-other', 'Other', true);
set role authenticated;
select test.login('wkr_tmp');
select test.check((select (push_test_enqueue() ->> 'devices')::integer = 1), 'a person queues a test for their own device');
reset role;
select test.check((select count(*) = 1 and bool_and(kind = 'TEST' and reminder_id is null) from notification_deliveries where profile_id = test.id('wkr_tmp'))
                  and not exists (select 1 from notification_deliveries where profile_id = test.id('wkr_tms')), 'only their own device, and no reminder log');
select test.check(not exists (select 1 from attendance_records where profile_id = test.id('wkr_tmp') and attendance_date = private.office_today()),
  'a test creates no attendance record');
set role authenticated;
select test.login('wkr_tmp');
select push_test_enqueue();
select push_test_enqueue();
select push_test_enqueue();
select push_test_enqueue();
select test.must_fail($$select push_test_enqueue()$$, 'a sixth test within 10 minutes is refused', 'CONFLICT');
select test.must_fail(format($$select notification_admin_test(%L)$$, test.id('wkr_tms')), 'an employee cannot test someone else''s devices', 'FORBIDDEN');
select test.must_fail($$select push_deliveries_claim(10, 60, null)$$, 'staff cannot claim deliveries', 'permission denied');
select test.must_fail($$select push_deliveries_report('[]')$$, 'staff cannot report deliveries', 'permission denied');
select test.must_fail($$select attendance_reminders_generate(now(), true)$$, 'staff cannot generate reminders', 'permission denied');
select test.must_fail($$select notification_scheduler_run_record('{}')$$, 'staff cannot record scheduler runs', 'permission denied');
select test.login('dh_wab');
select test.must_fail(format($$select notification_admin_test(%L)$$, test.id('wkr_tms')), 'a Department Head outside HR cannot send employee tests', 'FORBIDDEN');
select test.login('hr_head');
select test.check((select (notification_admin_test(test.id('wkr_tms')) ->> 'devices')::integer = 1), 'HR sends a controlled test to an employee''s devices');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('wkr_tms') and type = 'NOTIFICATION_TEST'), 'the employee sees in the bell who tested and why');
select test.check((select count(*) >= 1 from audit_logs where action = 'NOTIFICATION_TEST_SENT' and actor_id = test.id('hr_head') and entity_id = test.id('wkr_tms')),
  'the admin test is audited');
set role authenticated;
select test.login('sa');
select notification_admin_test(test.id('wkr_tms'));
select notification_admin_test(test.id('wkr_tms'));
select test.must_fail(format($$select notification_admin_test(%L)$$, test.id('wkr_tms')), 'a fourth admin test to the same employee within an hour is refused', 'CONFLICT');

\echo '   sound settings, confirmations and browser reports: the signed-in person only'
select test.login('wkr_tmp');
select test.check((select s -> 'sound' ->> 'attendance' = 'true' and s -> 'sound' ->> 'chat' = 'true' and s -> 'sound' ->> 'general' = 'true'
                     from (select attendance_reminder_settings() s) x), 'sounds are on by default');
select test.check((select s -> 'sound' ->> 'general' = 'false' and s -> 'sound' ->> 'attendance' = 'true' from (select notification_sound_save(true, true, false) s) x),
  'a person turns general sounds off');
select test.must_fail($$select notification_sound_save(true, null, true)$$, 'every sound needs on or off', 'VALIDATION_ERROR');
select notification_sound_confirm();
select push_test_confirm(true, true, 'https://push.example.com/rel-phone');
select push_test_confirm(true, true, 'https://push.example.com/rel-other');
select test.check((select s -> 'sound' ->> 'confirmedAt' is not null and s ->> 'testConfirmedAt' is not null from (select attendance_reminder_settings() s) x),
  'the sound and the test confirmations are recorded');
select notification_client_check('client-abc-123', 'Chrome on Android', 'granted', 'on', 'running', false);
select test.must_fail($$select notification_client_check('bad id!', null, 'granted', 'on', 'running', false)$$, 'an invalid browser report is refused', 'VALIDATION_ERROR');
select test.check((select (my_push_devices() -> 0 ->> 'testConfirmedAt') is not null), 'the person sees which device confirmed the test');
select test.login('sa');
select test.check((select s -> 'sound' ->> 'chat' = 'true' from (select notification_sound_save(true, true, true) s) x), 'the Super Admin has sound settings too');
reset role;
select test.check((select test_confirmed_at is null from push_subscriptions where endpoint = 'https://push.example.com/rel-other'),
  'a confirmation never marks another person''s device');
-- a browser that reported "blocked" (no device): wkr_tms
delete from push_subscriptions where endpoint = 'https://push.example.com/rel-other';
insert into notification_client_checks (profile_id, client_id, label, permission, push_state, audio_state) values (test.id('wkr_tms'), 'client-blocked-1', 'Chrome on Windows', 'denied', 'blocked', 'suspended')
on conflict (profile_id, client_id) do update set permission = 'denied', push_state = 'blocked', checked_at = now();

\echo '   Notification Health: HR and the Super Admin only, real statuses, nothing secret, audited'
select notification_scheduler_run_record(jsonb_build_object('startedAt', now() - interval '2 seconds', 'ok', true, 'pushConfigured', true, 'generated', 3, 'accepted', 2));
select push_subscriptions_report(array[(select id from push_subscriptions where endpoint = 'https://push.example.com/rel-phone')], '{}', '{}');
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select notification_health()$$, 'a team member cannot open Notification Health', 'FORBIDDEN');
select test.must_fail(format($$select notification_health_employee(%L)$$, test.id('wkr_tms')), 'nor one employee''s detail', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select notification_health()$$, 'a Department Head outside HR cannot open it', 'FORBIDDEN');
select test.login('rr_rec1');
select test.must_fail($$select notification_health()$$, 'an HR Recruiter cannot open it', 'FORBIDDEN');
select test.login('hr_head');
create temp table h as select notification_health(null, null, null, true) h;
reset role;
select test.check((select (h -> 'summary' ->> 'eligible')::integer = (select count(*) from profiles where status = 'ACTIVE' and role <> 'SUPER_ADMIN') from h),
  'every active employee except the Super Admin is counted, none hard-coded');
select test.check(not exists (select 1 from h, jsonb_array_elements(h -> 'employees') e where e ->> 'profileId' = test.id('sa')::text), 'the Super Admin is not in the list');
select test.check(not exists (select 1 from h, jsonb_array_elements(h -> 'employees') e
                               join profiles p on p.id = (e ->> 'profileId')::uuid where p.status <> 'ACTIVE'), 'suspended, revoked and pending accounts are not in the list');
select test.check((select e ->> 'status' = 'READY' and (e ->> 'activeDevices')::integer = 1 and e ->> 'lastAcceptedAt' is not null and e ->> 'soundStatus' = 'CONFIRMED'
                     from h, jsonb_array_elements(h -> 'employees') e where e ->> 'profileId' = test.id('wkr_tmp')::text),
  'wkr_tmp (device accepted a push recently, sound confirmed): READY');
select test.check((select e ->> 'status' = 'NOTIFICATIONS_BLOCKED' from h, jsonb_array_elements(h -> 'employees') e where e ->> 'profileId' = test.id('wkr_tms')::text),
  'wkr_tms (no device, browser reported notifications blocked): NOTIFICATIONS_BLOCKED');
select test.check((select h -> 'scheduler' ->> 'health' = 'HEALTHY' and (h -> 'scheduler' ->> 'lastSuccessAt') is not null from h), 'the scheduler is HEALTHY after a good run');
select test.check((select not (h::text ~* 'endpoint|p256dh|auth-phone|BPk-|push\.example\.com') from h), 'no device address or key anywhere in the answer');
select test.check((select h -> 'queue' ? 'retryPending' and h -> 'todayReminders' ? 'noDevice' and h ? 'today' from h), 'queue and today''s counters are included');
set role authenticated;
select test.login('hr_head');
select test.check((select e ->> 'status' = 'PUSH_UNAVAILABLE' from jsonb_array_elements(notification_health(null, null, null, false) -> 'employees') e
                     where e ->> 'profileId' = test.id('wkr_tmp')::text), 'with push not configured on the server nobody is READY (PUSH_UNAVAILABLE)');
select test.check((select bool_and(e ->> 'status' = 'NOTIFICATIONS_BLOCKED') and count(*) >= 1 from jsonb_array_elements(notification_health(null, null, 'NOTIFICATIONS_BLOCKED', true) -> 'employees') e),
  'the issue filter returns only that status');
select test.check((select bool_and(e ->> 'role' = 'TEAM_MEMBER') from jsonb_array_elements(notification_health(null, 'TEAM_MEMBER', null, true) -> 'employees') e), 'the role filter works');
select test.must_fail($$select notification_health(null, 'KING', null, true)$$, 'an unknown role is refused', 'VALIDATION_ERROR');
select test.must_fail($$select notification_health(null, null, 'NOPE', true)$$, 'an unknown issue is refused', 'VALIDATION_ERROR');
select test.check((select jsonb_array_length(d -> 'devices') = 1 and not (d::text ~* 'endpoint|p256dh|BPk-|push\.example\.com')
                     from (select notification_health_employee(test.id('wkr_tmp')) d) x), 'one employee''s detail lists devices without addresses or keys');
select test.login('sa');
select test.check((select (notification_health() -> 'summary' ->> 'eligible')::integer > 0), 'the Super Admin opens Notification Health');
reset role;
select test.check((select count(*) >= 3 from audit_logs where action = 'NOTIFICATION_HEALTH_VIEWED' and actor_id = test.id('hr_head')), 'every Notification Health read is audited');
update notification_scheduler_runs set finished_at = now() - interval '2 hours' where job = 'ATTENDANCE_REMINDERS';
set role authenticated;
select test.login('hr_head');
select test.check((select notification_health() -> 'scheduler' ->> 'health' = 'NOT_RUNNING'), 'no good run for 2 hours: the scheduler is NOT_RUNNING (cron off is visible)');
reset role;
select test.reset_people();
delete from notification_client_checks where client_id in ('client-abc-123', 'client-blocked-1');
update attendance_settings set reminder_days = '{1,2,3,4,5,6}' where id;
