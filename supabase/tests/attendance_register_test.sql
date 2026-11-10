-- =============================================================================
-- Attendance: location required, attendance states, CRM sign-out kept apart from Punch Out, HR's daily register, India time
-- (migration 20261230000700). Reuses weekly_report_routing_test.sql (wkr_tmp Support member, wkr_tms Sales member, wkr_ohp Operations Head,
-- wkr_dhp Department Head) and hr_test.sql's HR head (hr_head). Safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 138. Attendance: location required, states, CRM sign-out, HR register'
reset role;
\i supabase/migrations/20261230000600_attendance_place_names.sql
\i supabase/migrations/20261230000700_attendance_location_required_register.sql
\i supabase/migrations/20261230000700_attendance_location_required_register.sql
delete from attendance_events where profile_id in (select id from profiles where email like 'wkr.%@example.com');
delete from attendance_lunches where profile_id in (select id from profiles where email like 'wkr.%@example.com');
update attendance_records set punch_in_at = null, punch_out_at = null, rm_login_at = null where profile_id in (select id from profiles where email like 'wkr.%@example.com');
create or replace function test.att_count(p_who text, p_kind text, p_day date default null) returns bigint language sql as $$
  select count(*) from public.attendance_events where profile_id = test.id(p_who) and kind = p_kind and attendance_date = coalesce(p_day, private.office_today()) $$;
-- sign in as someone with a session id in the token (as Supabase Auth issues it)
create or replace function test.login_session(p_name text, p_sid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', test.id(p_name), 'role', 'authenticated', 'session_id', p_sid)::text, false),
         set_config('request.headers', json_build_object('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')::text, false)
$$;
grant execute on all functions in schema test to anon, authenticated, service_role;
create temp table sess (k text primary key, v text);
grant all on sess to authenticated;
delete from sess;
insert into sess values ('tms', gen_random_uuid()::text), ('tmp', gen_random_uuid()::text);

\echo '   signing in to the CRM never punches in'
-- the API records the sign-in (SESSION_STARTED) and the screen records the first CRM opening of the day
insert into audit_logs (actor_id, action, entity_type, outcome, dedupe_key, metadata, created_at)
select test.id('wkr_tms'), 'SESSION_STARTED', 'session', 'SUCCESS', 'session:' || v, '{"device":"Chrome on Windows","method":"password"}'::jsonb, now() - interval '2 hours'
  from sess where k = 'tms';
set role authenticated;
select test.login('wkr_tms');
select record_rm_login();
select test.check((select d ->> 'status' = 'NOT_PUNCHED_IN' and d -> 'punchIn' = 'null'::jsonb and d ->> 'timeZone' = 'Asia/Kolkata'
                     from (select attendance_today() d) x), 'after signing in the day is "Not Punched In" (no automatic Punch In)');
reset role;
select test.check(test.att_count('wkr_tms', 'PUNCH_IN') = 0 and (select rm_login_at is not null and punch_in_at is null from attendance_records
                    where profile_id = test.id('wkr_tms') and attendance_date = private.office_today()), 'the CRM login time is kept, no punch');

\echo '   Punch In needs a precise device location'
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select attendance_punch_in('DENIED', null, null, null, gen_random_uuid())$$, 'permission denied: no punch', 'location is required');
select test.must_fail($$select attendance_punch_in('UNAVAILABLE', null, null, null, gen_random_uuid())$$, 'location services off: no punch', 'location is required');
select test.must_fail($$select attendance_punch_in('TIMEOUT', null, null, null, gen_random_uuid())$$, 'no position in time: no punch', 'location is required');
select test.must_fail($$select attendance_punch_in('UNSUPPORTED', null, null, null, gen_random_uuid())$$, 'no geolocation in the browser: no punch', 'location is required');
select test.must_fail($$select attendance_punch_in('DENIED', 18.5, 73.8, 10, gen_random_uuid())$$, 'coordinates sent with a refused status are not accepted', 'location is required');
select test.must_fail($$select attendance_punch_in('CAPTURED', 18.5, 73.8, 5000, gen_random_uuid())$$, 'an approximate (network / IP) position of 5 km is refused', 'not precise enough');
select test.must_fail($$select attendance_punch_in('CAPTURED', 95, 73.8, 10, gen_random_uuid())$$, 'impossible coordinates are refused', 'not valid');
select test.must_fail($$select attendance_punch_in('CAPTURED', 0, 0, 10, gen_random_uuid())$$, 'the 0,0 "null island" position is refused', 'not valid');
reset role;
select test.check(test.att_count('wkr_tmp', 'PUNCH_IN') = 0, 'nothing was recorded by the refused attempts');
set role authenticated;
select test.login('wkr_tmp');
select test.check((select d ->> 'status' = 'PUNCHED_IN' and (d -> 'punchIn' ->> 'latitude')::numeric = 18.520431 and (d -> 'punchIn' ->> 'longitude')::numeric = 73.856743
                          and (d -> 'punchIn' ->> 'accuracy')::int = 25 and (d -> 'punchIn' ->> 'at')::timestamptz between now() - interval '5 seconds' and now()
                     from (select attendance_punch_in('CAPTURED', 18.520431, 73.856743, 25, gen_random_uuid()) d) x),
  'Punch In with a GPS position: latitude, longitude, accuracy and the server time; state "Punched In"');
select attendance_punch_in('CAPTURED', 19.1, 72.9, 15, gen_random_uuid());
reset role;
select test.check(test.att_count('wkr_tmp', 'PUNCH_IN') = 1 and (select latitude = 18.520431 from attendance_events where profile_id = test.id('wkr_tmp') and kind = 'PUNCH_IN'),
  'Punch In twice: still one Punch In, the first one');
select test.check((select metadata ->> 'accuracy' = '25' from audit_logs where action = 'ATTENDANCE_PUNCH_IN' and actor_id = test.id('wkr_tmp') order by id desc limit 1),
  'the Punch In is on the audit trail with its accuracy');

\echo '   lunch: 50 minutes allowed, remaining and exceeded, no overlapping breaks'
set role authenticated;
select test.login('wkr_tmp');
select test.check((select d ->> 'status' = 'ON_LUNCH' from (select attendance_lunch('START') d) x), 'Start Lunch: state "On Lunch"');
select attendance_lunch('START');
reset role;
select test.check((select count(*) = 1 from attendance_lunches where profile_id = test.id('wkr_tmp') and ended_at is null), 'Start Lunch again while on lunch: no second, overlapping break');
update attendance_lunches set started_at = now() - interval '20 minutes' where profile_id = test.id('wkr_tmp') and ended_at is null;
set role authenticated;
select test.login('wkr_tmp');
select test.check((select d ->> 'status' = 'RESUMED_WORK' and (d -> 'lunch' ->> 'minutes')::int = 20 and (d -> 'lunch' ->> 'remainingMinutes')::int = 30
                          and (d -> 'lunch' ->> 'exceededMinutes')::int = 0 from (select attendance_lunch('END') d) x),
  'Resume Work after 20 minutes: 20 taken, 30 remaining, state "Resumed Work"');
reset role;
-- a second break of 35 minutes the same day: 55 in all
insert into attendance_lunches (profile_id, attendance_date, started_at, ended_at, ended_by)
values (test.id('wkr_tmp'), private.office_today(), now() - interval '35 minutes 10 seconds', now() - interval '10 seconds', 'EMPLOYEE');
select test.check((select (j ->> 'minutes')::int = 55 and (j ->> 'remainingMinutes')::int = 0 and (j ->> 'exceededMinutes')::int = 5 and jsonb_array_length(j -> 'sessions') = 2
                     from (select private.attendance_lunch_json(test.id('wkr_tmp'), private.office_today()) j) x),
  'breaks add up: 55 minutes is 5 minutes over the 50 allowed (nothing is deducted from worked time)');

\echo '   Punch Out: a fresh location of its own'
set role authenticated;
select test.login('wkr_tms');
select test.must_fail($$select attendance_punch_out('CAPTURED', 18.53, 73.86, 20, gen_random_uuid())$$, 'Punch Out without a Punch In is refused', 'Punch in first');
select test.login('wkr_tmp');
select test.must_fail($$select attendance_punch_out('DENIED', null, null, null, gen_random_uuid())$$, 'Punch Out without a location is refused', 'location is required');
select test.check((select d ->> 'status' = 'PUNCHED_OUT' and (d -> 'punchOut' ->> 'latitude')::numeric = 18.559 and (d -> 'punchOut' ->> 'longitude')::numeric = 73.7868
                          and (d -> 'punchIn' ->> 'latitude')::numeric = 18.520431 and (d -> 'punchOut' ->> 'accuracy')::int = 12 and (d ->> 'workedMinutes')::int >= 0
                     from (select attendance_punch_out('CAPTURED', 18.559, 73.7868, 12, gen_random_uuid()) d) x),
  'Punch Out stores its own coordinates and accuracy (the Punch In ones are unchanged); state "Punched Out"');
select test.must_fail($$select attendance_lunch('START')$$, 'no lunch after Punch Out', 'punched out');
reset role;
select test.check((select count(*) = 2 and count(distinct latitude) = 2 from attendance_events where profile_id = test.id('wkr_tmp') and attendance_date = private.office_today()),
  'Punch In and Punch Out are two events with separate locations');

\echo '   signing out of the CRM is recorded, and never punches out'
set role authenticated;
select test.login('wkr_tms');
select attendance_punch_in('CAPTURED', 18.6, 73.7, 30, gen_random_uuid());
select test.login_session('wkr_tms', (select v from sess where k = 'tms'));
select record_crm_logout();
select record_crm_logout();
select test.check((select d ->> 'status' = 'INCOMPLETE' and d -> 'punchOut' = 'null'::jsonb from (select attendance_today() d) x),
  'signed out after punching in, without punching out: "Incomplete Attendance", Punch Out still missing');
reset role;
select test.check((select count(*) = 1 from audit_logs where dedupe_key = 'session-end:' || (select v from sess where k = 'tms')
                    and action = 'SESSION_ENDED' and actor_id = test.id('wkr_tms') and metadata ->> 'device' = 'Chrome on Windows'),
  'the sign-out is recorded once per session, with the browser and system');
select test.check(test.att_count('wkr_tms', 'PUNCH_OUT') = 0 and (select punch_out_at is null from attendance_records where profile_id = test.id('wkr_tms') and attendance_date = private.office_today()),
  'the CRM sign-out time is never used as a Punch Out');
-- signing in again: no longer flagged (still Punched In)
insert into audit_logs (actor_id, action, entity_type, outcome, dedupe_key, metadata, created_at)
values (test.id('wkr_tms'), 'SESSION_STARTED', 'session', 'SUCCESS', 'session:' || gen_random_uuid(), '{}'::jsonb, clock_timestamp());
select test.check(private.attendance_status(test.id('wkr_tms'), private.office_today()) = 'PUNCHED_IN', 'signing in again: back to "Punched In"');

\echo '   HR: every employee of a day, CRM sessions, punches with locations, lunch, state'
-- yesterday: wkr_tms punched in and never out
insert into attendance_events (profile_id, attendance_date, kind, occurred_at, latitude, longitude, accuracy_m, location_status)
values (test.id('wkr_tms'), private.office_today() - 1, 'PUNCH_IN', (private.office_today() - 1)::timestamp at time zone 'Asia/Kolkata' + interval '10 hours 10 minutes', 18.6, 73.7, 30, 'CAPTURED');
insert into attendance_records as a (profile_id, attendance_date, punch_in_at)
values (test.id('wkr_tms'), private.office_today() - 1, (private.office_today() - 1)::timestamp at time zone 'Asia/Kolkata' + interval '10 hours 10 minutes')
on conflict (profile_id, attendance_date) do update set punch_in_at = excluded.punch_in_at, punch_out_at = null;
insert into sess select 'staff', count(*)::text from profiles where status = 'ACTIVE' and role <> 'SUPER_ADMIN';
set role authenticated;
select test.login('hr_head');
create temp table reg as select hr_attendance_register(private.office_today(), null, null, null) d;
select test.check((select jsonb_array_length(d -> 'rows') >= (select v::int from sess where k = 'staff') from reg),
  'HR sees every active employee (not only themselves)');
select test.check((select bool_or(x ->> 'name' = 'WKR tmp' and x ->> 'status' = 'PUNCHED_OUT'
                                  and (x -> 'punchIn' ->> 'latitude')::numeric = 18.520431 and (x -> 'punchIn' ->> 'accuracy')::int = 25
                                  and (x -> 'punchOut' ->> 'latitude')::numeric = 18.559 and (x -> 'punchOut' ->> 'accuracy')::int = 12
                                  and (x -> 'lunch' ->> 'minutes')::int = 55 and (x -> 'lunch' ->> 'exceededMinutes')::int = 5 and jsonb_array_length(x -> 'lunch' -> 'sessions') = 2
                                  and (x ->> 'workedMinutes') is not null)
                     from reg, jsonb_array_elements(d -> 'rows') x),
  'HR sees Punch In and Punch Out coordinates and accuracy, both lunch breaks, 5 minutes over, worked time, "Punched Out"');
select test.check((select bool_or(x ->> 'name' = 'WKR tms' and (x -> 'crm' ->> 'systemLoginAt') is not null and (x -> 'crm' ->> 'lastLogoutAt') is not null
                                  and (x -> 'crm' -> 'sessions' -> 0 ->> 'device') = 'Chrome on Windows' and x -> 'punchOut' = 'null'::jsonb)
                     from reg, jsonb_array_elements(d -> 'rows') x),
  'HR sees the CRM login, the CRM logout and the session device apart from the punches');
select test.check((select bool_or(x ->> 'status' = 'NOT_PUNCHED_IN' and x -> 'punchIn' = 'null'::jsonb) and (d ->> 'timeZone') = 'Asia/Kolkata' and d -> 'geofence' = 'null'::jsonb
                     from reg, jsonb_array_elements(d -> 'rows') x group by d),
  'employees who have not punched in are listed as "Not Punched In"; no geofence is configured');
select test.check((select bool_and(x ->> 'status' = 'PUNCHED_OUT') and count(*) >= 1
                     from jsonb_array_elements(hr_attendance_register(private.office_today(), null, null, 'punched_out') -> 'rows') x), 'filter by state');
select test.check((select jsonb_array_length(d -> 'rows') = 1 and d -> 'rows' -> 0 ->> 'name' = 'WKR tmp'
                     from (select hr_attendance_register(private.office_today(), null, test.id('wkr_tmp'), null) d) x), 'filter by employee');
select test.check((select bool_and(x ->> 'department' = (select name from departments where id = test.dept('wkr-a'))) and count(*) >= 2
                     from jsonb_array_elements(hr_attendance_register(private.office_today(), test.dept('wkr-a'), null, null) -> 'rows') x), 'filter by department');
select test.check((select x ->> 'status' = 'INCOMPLETE' and (x -> 'punchIn' ->> 'latitude')::numeric = 18.6 and x ->> 'workedMinutes' is null
                     from jsonb_array_elements(hr_attendance_register(private.office_today() - 1, null, test.id('wkr_tms'), null) -> 'rows') x),
  'a previous date: punched in and never out is "Incomplete Attendance" (no worked time is guessed)');
select test.must_fail($$select hr_attendance_register(private.office_today() + 1, null, null, null)$$, 'a future date is refused', 'up to today');
select test.must_fail($$select hr_attendance_register(private.office_today(), null, null, 'ASLEEP')$$, 'an unknown state is refused', 'Unknown attendance status');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'ATTENDANCE_LOCATIONS_VIEWED' and actor_id = test.id('hr_head') and metadata ? 'date'),
  'each read of the register is audited');

\echo '   nobody else reads the register or changes anyone''s attendance'
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select hr_attendance_register(private.office_today(), null, null, null)$$, 'a Team Member cannot read the register', 'FORBIDDEN');
select test.must_fail($$insert into attendance_events (profile_id, attendance_date, kind, location_status) values (test.id('wkr_tms'), current_date, 'PUNCH_OUT', 'DENIED')$$,
  'an employee cannot write anyone''s attendance directly', 'permission denied');
select test.must_fail($$update attendance_records set punch_out_at = now() where profile_id = test.id('wkr_tms')$$, 'nor change another person''s day', 'permission denied');
select test.must_fail($$select private.crm_sessions_json(test.id('wkr_tms'), current_date)$$, 'nor read another person''s sessions', 'permission denied');
select test.login('wkr_dhp');
select test.must_fail($$select hr_attendance_register(private.office_today(), null, null, null)$$, 'a Department Head cannot read the register', 'FORBIDDEN');
select test.login('wkr_ohp');
select test.must_fail($$select hr_attendance_register(private.office_today(), null, null, null)$$, 'an Operations Head cannot read the register', 'FORBIDDEN');
reset role;
set role anon;
select test.must_fail($$select record_crm_logout()$$, 'a visitor cannot record a sign-out', 'permission denied');
reset role;

\echo '   the Operations Head marks attendance like every employee'
delete from attendance_events where profile_id = test.id('wkr_ohp') and attendance_date = private.office_today();
delete from attendance_lunches where profile_id = test.id('wkr_ohp') and attendance_date = private.office_today();
update attendance_records set punch_in_at = null, punch_out_at = null where profile_id = test.id('wkr_ohp') and attendance_date = private.office_today();
set role authenticated;
select test.login('wkr_ohp');
select test.check((select d ->> 'status' = 'NOT_PUNCHED_IN' from (select attendance_today() d) x), 'an Operations Head has their own attendance day ("Not Punched In")');
select test.must_fail($$select attendance_punch_in('DENIED', null, null, null, gen_random_uuid())$$, 'and needs a location like everyone', 'location is required');
select test.check((select d ->> 'status' = 'PUNCHED_IN' and (d -> 'punchIn' ->> 'latitude')::numeric = 18.5314
                     from (select attendance_punch_in('CAPTURED', 18.5314, 73.8446, 18, gen_random_uuid()) d) x), 'the Operations Head punches in with their location');
select test.check((select d ->> 'status' = 'ON_LUNCH' from (select attendance_lunch('START') d) x), 'starts lunch');
select test.check((select d ->> 'status' = 'RESUMED_WORK' from (select attendance_lunch('END') d) x), 'resumes work');
select test.check((select d ->> 'status' = 'PUNCHED_OUT' and (d -> 'punchOut' ->> 'latitude')::numeric = 18.5402
                     from (select attendance_punch_out('CAPTURED', 18.5402, 73.8301, 14, gen_random_uuid()) d) x), 'and punches out with a fresh location');
select test.check((select jsonb_array_length(d) >= 1 from (select my_attendance(current_date - 7, current_date) d) x), 'and sees their own days');
select test.login('hr_head');
select test.check((select x ->> 'status' = 'PUNCHED_OUT' and (x -> 'punchIn' ->> 'accuracy')::int = 18 and (x -> 'punchOut' ->> 'accuracy')::int = 14
                     from jsonb_array_elements(hr_attendance_register(private.office_today(), null, test.id('wkr_ohp'), null) -> 'rows') x),
  'HR sees the Operations Head in the register like every employee');
reset role;

\echo '   India time: the office day turns at midnight in Asia/Kolkata'
insert into audit_logs (actor_id, action, entity_type, outcome, dedupe_key, metadata, created_at)
values (test.id('wkr_dhp'), 'SESSION_STARTED', 'session', 'SUCCESS', 'session:' || gen_random_uuid(), '{}'::jsonb,
        (private.office_today()::timestamp at time zone 'Asia/Kolkata') - interval '1 minute'),          -- 23:59 IST yesterday
       (test.id('wkr_dhp'), 'SESSION_STARTED', 'session', 'SUCCESS', 'session:' || gen_random_uuid(), '{}'::jsonb,
        (private.office_today()::timestamp at time zone 'Asia/Kolkata') + interval '1 minute');          -- 00:01 IST today
select test.check((select (j ->> 'firstLoginAt')::timestamptz = (private.office_today()::timestamp at time zone 'Asia/Kolkata') + interval '1 minute'
                     from (select private.crm_sessions_json(test.id('wkr_dhp'), private.office_today()) j) x)
              and (select exists (select 1 from jsonb_array_elements(j -> 'sessions') s
                                   where (s ->> 'startedAt')::timestamptz = (private.office_today()::timestamp at time zone 'Asia/Kolkata') - interval '1 minute')
                     from (select private.crm_sessions_json(test.id('wkr_dhp'), private.office_today() - 1) j) x),
  '00:01 IST belongs to today and 23:59 IST to yesterday, whatever the UTC date');
select test.check(private.device_label('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1') = 'Safari on iOS'
                  and private.device_label('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36') = 'Chrome on Android'
                  and private.device_label(null) is null, 'device labels');
