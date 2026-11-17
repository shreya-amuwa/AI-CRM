-- =============================================================================
-- Attendance: Punch In / Punch Out with location, lunch (45 minutes, migration 20270109000100), who sees what, 90-day location retention (migration 20261230000400).
-- Reuses weekly_report_routing_test.sql: wkr-a with a Support member wkr_tmp and a Sales member wkr_tms, the Support Operations Head wkr_ohp,
-- the Sales Operations Head wkr_ohs, the Support Department Head wkr_dhp; and hr_test.sql's HR head (hr_head).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 135. Attendance: punch in / out, lunch, visibility, retention'
reset role;
\i supabase/migrations/20261230000400_attendance_punch_lunch.sql
\i supabase/migrations/20261230000400_attendance_punch_lunch.sql
\i supabase/migrations/20270109000100_attendance_lunch_45.sql
\i supabase/migrations/20270109000100_attendance_lunch_45.sql
delete from attendance_events where profile_id in (select id from profiles where email like 'wkr.%@example.com');
delete from attendance_lunches where profile_id in (select id from profiles where email like 'wkr.%@example.com');
update attendance_records set punch_in_at = null, punch_out_at = null where profile_id in (select id from profiles where email like 'wkr.%@example.com');
create or replace function test.att_events(p_who text, p_kind text) returns bigint language sql as $$
  select count(*) from public.attendance_events where profile_id = test.id(p_who) and kind = p_kind and attendance_date = private.office_today() $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   Punch In: server time, the location as given, once a day'
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select attendance_punch_out('CAPTURED', 18.52, 73.85, 15, gen_random_uuid())$$, 'Punch Out before Punch In is refused', 'Punch in first');
select test.must_fail($$select attendance_lunch('START')$$, 'lunch before Punch In is refused', 'Punch in before starting lunch');
select test.must_fail($$select attendance_punch_in('CAPTURED', null, null, null, gen_random_uuid())$$, 'a "captured" location without coordinates is refused', 'not valid');
select test.must_fail($$select attendance_punch_in('SOMEWHERE', null, null, null, gen_random_uuid())$$, 'an unknown location status is refused', 'Unknown location status');
select test.check((select (d -> 'punchIn' ->> 'locationStatus') = 'CAPTURED' and (d -> 'punchIn' ->> 'latitude')::numeric = 18.52 and (d -> 'punchIn' ->> 'at')::timestamptz <= now()
                     from (select attendance_punch_in('CAPTURED', 18.52, 73.85, 15, gen_random_uuid()) d) x), 'Punch In is recorded with the device location and the server time');
select attendance_punch_in('CAPTURED', 19.1, 72.9, 15, gen_random_uuid());
reset role;
select test.check(test.att_events('wkr_tmp', 'PUNCH_IN') = 1 and (select latitude = 18.52 from attendance_events where profile_id = test.id('wkr_tmp') and kind = 'PUNCH_IN'),
  'a second Punch In (refresh, another tab) records nothing new and keeps the first');
set role authenticated;
select test.login('wkr_tms');
select test.check((select (d -> 'punchIn' ->> 'locationStatus') = 'DENIED' and d -> 'punchIn' ->> 'latitude' is null
                     from (select attendance_punch_in('DENIED', 18.5, 73.8, 10, gen_random_uuid()) d) x),
  'location denied: the punch is recorded as "location unavailable" and coordinates are never kept (even if sent)');

\echo '   Lunch: one open break, the 45-minute allowance, flags only'
select test.login('wkr_tmp');
select attendance_lunch('START');
select attendance_lunch('START');
reset role;
select test.check((select count(*) = 1 from attendance_lunches where profile_id = test.id('wkr_tmp')), 'Start Lunch twice: one break');
-- the break started 45 minutes ago: within the allowance
update attendance_lunches set started_at = now() - interval '45 minutes' where profile_id = test.id('wkr_tmp') and ended_at is null;
set role authenticated;
select test.login('wkr_tmp');
select test.check((select (d -> 'lunch' ->> 'minutes')::int = 45 and (d -> 'lunch' ->> 'exceededMinutes')::int = 0 and d -> 'lunch' -> 'open' is not null
                          and (d ->> 'serverTime')::timestamptz is not null from (select attendance_today() d) x),
  'the running timer comes from the server: 45 minutes, not exceeded (and survives a refresh)');
select test.check((select (d -> 'lunch' ->> 'minutes')::int = 45 and d -> 'lunch' -> 'open' = 'null'::jsonb from (select attendance_lunch('END') d) x), 'End Lunch at 45 minutes');
select test.must_fail($$select attendance_lunch('END')$$, 'End Lunch without a running break is refused', 'has not been started');
reset role;
-- a second, one-minute break the same day: 46 minutes in total
insert into attendance_lunches (profile_id, attendance_date, started_at, ended_at, ended_by)
values (test.id('wkr_tmp'), private.office_today(), now() - interval '61 seconds', now(), 'EMPLOYEE');
select test.check((select (private.attendance_day_json(test.id('wkr_tmp'), private.office_today()) -> 'lunch' ->> 'exceededMinutes')::int = 1),
  'two breaks add up: 46 minutes is 1 minute over');

\echo '   Punch Out: append-only, the latest valid one counts, retries and double clicks are not new punches'
set role authenticated;
select test.login('wkr_tmp');
select attendance_lunch('START');
create temp table att (k text primary key, v uuid);
grant all on att to authenticated;
insert into att values ('r1', gen_random_uuid()), ('r2', gen_random_uuid()), ('r3', gen_random_uuid());
select test.check((select d -> 'punchOut' ->> 'locationStatus' = 'CAPTURED' and d -> 'lunch' -> 'open' = 'null'::jsonb
                     from (select attendance_punch_out('CAPTURED', 18.53, 73.86, 20, (select v from att where k = 'r1')) d) x),
  'Punch Out with location; the lunch still running is closed with the day');
select attendance_punch_out('CAPTURED', 18.53, 73.86, 20, (select v from att where k = 'r1'));
select attendance_punch_out('CAPTURED', 18.53, 73.86, 20, (select v from att where k = 'r2'));
reset role;
select test.check(test.att_events('wkr_tmp', 'PUNCH_OUT') = 1, 'the same request again and a second click within a minute are not new Punch Outs');
select test.check((select ended_by = 'PUNCH_OUT' from attendance_lunches where profile_id = test.id('wkr_tmp') order by started_at desc limit 1), 'the open lunch was ended by the Punch Out');
-- two hours later the employee punches out again (they kept working)
update attendance_events set occurred_at = occurred_at - interval '2 hours' where profile_id = test.id('wkr_tmp') and kind = 'PUNCH_OUT';
update attendance_records set punch_out_at = punch_out_at - interval '2 hours' where profile_id = test.id('wkr_tmp') and attendance_date = private.office_today();
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select attendance_lunch('START')$$, 'no lunch after Punch Out', 'punched out');
select attendance_punch_out('UNAVAILABLE', null, null, null, (select v from att where k = 'r3'));
reset role;
select test.check(test.att_events('wkr_tmp', 'PUNCH_OUT') = 2
                  and (select punch_out_at > now() - interval '1 minute' from attendance_records where profile_id = test.id('wkr_tmp') and attendance_date = private.office_today()),
  'a later Punch Out is a new event and becomes the effective Punch Out; the earlier one stays in the history');

\echo '   who sees what'
set role authenticated;
select test.login('wkr_tmp');
select test.must_fail($$select count(*) from attendance_events$$, 'nobody reads the tables directly', 'permission denied');
select test.must_fail($$select hr_attendance_punches(current_date - 1, current_date, null, null)$$, 'a Team Member cannot read others'' punches', 'FORBIDDEN');
select test.check((select jsonb_array_length(d) = 1 from (select my_attendance(current_date - 7, current_date) d) x), 'an employee reads their own days');
select test.login('wkr_dhp');
select test.must_fail($$select hr_attendance_punches(current_date - 1, current_date, null, null)$$, 'a Department Head cannot read staff punches', 'FORBIDDEN');
select test.must_fail($$select attendance_lunch_overview(current_date - 1, current_date)$$, 'nor staff lunch', 'FORBIDDEN');
select test.login('wkr_ohp');
select test.must_fail($$select hr_attendance_punches(current_date - 1, current_date, null, null)$$, 'an Operations Head cannot read punch times or locations', 'FORBIDDEN');
select test.check((select bool_or(x ->> 'name' = 'WKR tmp' and (x ->> 'exceededMinutes')::int = 1 and (x ->> 'flagged')::boolean) and not bool_or(x ->> 'name' = 'WKR tms')
                          and not bool_or(x ? 'punchIn') and not bool_or(x ? 'latitude')
                     from jsonb_array_elements(attendance_lunch_overview(current_date - 1, current_date) -> 'rows') x),
  'the Support Operations Head sees Support lunch durations and flags only (no Sales person, no punch, no location)');
select test.login('hr_head');
select test.check((select bool_or(x ->> 'name' = 'WKR tmp' and (x -> 'punchIn' ->> 'latitude')::numeric = 18.52 and jsonb_array_length(x -> 'punchOutHistory') = 2
                                  and (x -> 'punchOut' ->> 'locationStatus') = 'UNAVAILABLE' and (x ->> 'lunchExceededMinutes')::int >= 1)
                          and bool_or(x ->> 'name' = 'WKR tms' and (x ->> 'locationUnavailable')::boolean)
                     from jsonb_array_elements(hr_attendance_punches(current_date - 1, current_date, test.dept('wkr-a'), null) -> 'rows') x),
  'HR sees punches with locations, the Punch Out history, location unavailable, lunch over the allowance');
reset role;
select test.check((select count(*) >= 1 from audit_logs where action = 'ATTENDANCE_LOCATIONS_VIEWED' and actor_id = test.id('hr_head')), 'reading locations is audited');

\echo '   retention: coordinates older than 90 days are erased, the punch stays'
insert into attendance_events (profile_id, attendance_date, kind, occurred_at, latitude, longitude, accuracy_m, location_status)
values (test.id('wkr_tms'), private.office_today() - 91, 'PUNCH_IN', now() - interval '91 days', 18.5, 73.8, 9, 'CAPTURED'),
       (test.id('wkr_tms'), private.office_today() - 89, 'PUNCH_IN', now() - interval '89 days', 18.5, 73.8, 9, 'CAPTURED');
select private.purge_attendance_locations();
select test.check((select latitude is null and location_status = 'PURGED' from attendance_events where profile_id = test.id('wkr_tms') and attendance_date = private.office_today() - 91)
                  and (select latitude = 18.5 from attendance_events where profile_id = test.id('wkr_tms') and attendance_date = private.office_today() - 89),
  'after 90 days the location is erased (the punch time stays); at 89 days it is kept');
