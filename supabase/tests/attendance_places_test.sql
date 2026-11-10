-- =============================================================================
-- Attendance place names (migration 20261230000600). Reuses attendance_punch_lunch_test.sql (wkr_tmp punched in today with a location;
-- wkr_tms with location denied) and hr_test.sql's HR head.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 137. Attendance: place names'
reset role;
\i supabase/migrations/20261230000600_attendance_place_names.sql
\i supabase/migrations/20261230000600_attendance_place_names.sql
delete from attendance_events where profile_id = test.id('wkr_tms') and attendance_date = private.office_today() - 95;
update attendance_events set place_name = null, place_attempts = 0, place_resolved_at = null where profile_id in (select id from profiles where email like 'wkr.%@example.com');
create temp table pl (k text primary key, v bigint);
grant all on pl to authenticated;
insert into pl select 'in', id from attendance_events where profile_id = test.id('wkr_tmp') and kind = 'PUNCH_IN' and attendance_date = private.office_today();

\echo '   only the API''s service role looks places up and stores them'
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select * from attendance_places_pending(5)$$, 'a signed-in user cannot list pending lookups', 'permission denied');
select test.must_fail(format($$select attendance_set_place(%s, 'Fake place')$$, (select v from pl where k = 'in')), 'nor write a place name', 'permission denied');
reset role;
select test.check((select count(*) >= 1 from attendance_places_pending(50) x where x.id = (select v from pl where k = 'in'))
                  and not exists (select 1 from attendance_places_pending(50) x join attendance_events e on e.id = x.id where e.profile_id = test.id('wkr_tms') and e.location_status <> 'CAPTURED'),
  'a punch with coordinates and no name is pending; a punch without a location never is');

\echo '   a failed lookup is retried at most 3 times; a name is stored once'
select attendance_set_place((select v from pl where k = 'in'), null);
select test.check((select place_name is null and place_attempts = 1 from attendance_events where id = (select v from pl where k = 'in')), 'a failed lookup counts an attempt');
select attendance_set_place((select v from pl where k = 'in'), 'Baner Road, Baner, Pune, Maharashtra 411045');
select attendance_set_place((select v from pl where k = 'in'), 'Somewhere else');
select test.check((select place_name = 'Baner Road, Baner, Pune, Maharashtra 411045' and place_resolved_at is not null from attendance_events where id = (select v from pl where k = 'in')),
  'the name is stored, and a later answer does not overwrite it');
select test.check(not exists (select 1 from attendance_places_pending(50) x where x.id = (select v from pl where k = 'in')), 'and it is no longer pending');

\echo '   who sees the name: whoever sees the location'
set role authenticated;
select test.login('wkr_tmp');
select test.check((select attendance_today() -> 'punchIn' ->> 'place') = 'Baner Road, Baner, Pune, Maharashtra 411045', 'the employee sees their own punch''s place');
select test.login('hr_head');
select test.check((select bool_or(x -> 'punchIn' ->> 'place' = 'Baner Road, Baner, Pune, Maharashtra 411045')
                     from jsonb_array_elements(hr_attendance_punches(current_date - 1, current_date, test.dept('wkr-a'), null) -> 'rows') x), 'HR sees it in the punch list');
select test.login('wkr_ohp');
select test.check((select not bool_or(x::text like '%Baner%') from jsonb_array_elements(attendance_lunch_overview(current_date - 1, current_date) -> 'rows') x),
  'an Operations Head never gets it (lunch only)');
reset role;

\echo '   the name is erased with the coordinates after 90 days'
insert into attendance_events (profile_id, attendance_date, kind, occurred_at, latitude, longitude, accuracy_m, location_status, place_name)
values (test.id('wkr_tms'), private.office_today() - 95, 'PUNCH_OUT', now() - interval '95 days', 18.5, 73.8, 9, 'CAPTURED', 'Old place, Pune');
select private.purge_attendance_locations();
select test.check((select place_name is null and latitude is null and location_status = 'PURGED' from attendance_events
                    where profile_id = test.id('wkr_tms') and attendance_date = private.office_today() - 95 and kind = 'PUNCH_OUT'),
  'after 90 days the place name goes with the coordinates');
