-- =============================================================================
-- Team attendance, the confirmed early Punch Out and attendance corrections (migration 20270205000200).
-- Synthetic departments ta-a (Sales + Support) and ta-b; statuses are checked at fixed times of a day so the suite does not depend on
-- when it runs.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 141. Team attendance: one status per person, who sees whom, safe Punch Out, corrections'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270205000200_team_attendance_corrections.sql
\i supabase/migrations/20270205000200_team_attendance_corrections.sql

delete from attendance_correction_requests where profile_id in (select id from test.users where name like 'ta\_%');
delete from leave_requests where employee_id in (select id from test.users where name like 'ta\_%');
delete from auth.users where email like 'ta.%@example.com';
delete from test.users where name like 'ta\_%';
delete from teams where department_id in (select id from departments where slug like 'ta-%');
delete from departments where slug like 'ta-%';
insert into departments (slug, name) values ('ta-a', 'TA Alpha'), ('ta-b', 'TA Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug in ('ta-a', 'ta-b');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug = 'ta-a';

create or replace function test.tamk(p_name text, p_role text, p_dept text, p_division text default null, p_team text default null, p_ops boolean default false)
returns uuid language sql as $$
  select test.create_auth_user(p_name, 'ta.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'TA ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_team is null then test.dept(p_dept) end,
      'provisioned_team_id', case when p_team is not null then test.team(p_dept, p_team) end,
      'provisioned_head_division', p_division, 'provisioned_operations_head', case when p_ops then true end))) $$;
-- an office-day time as an instant (India time)
create or replace function test.ist(p_day date, p_time text) returns timestamptz language sql immutable as $$
  select (p_day + p_time::time) at time zone 'Asia/Kolkata' $$;
create or replace function test.tastatus(p_name text, p_day date, p_time text) returns text language sql stable security definer set search_path = '' as $$
  select r.status from private.attendance_team_rows(p_day, test.ist(p_day, p_time)) r where r.profile_id = test.id(p_name) $$;
create or replace function test.taseen(p_name text) returns text[] language sql stable as $$
  select coalesce(array_agg(x ->> 'name' order by x ->> 'name'), '{}') from jsonb_array_elements((attendance_team_overview(null, null, null, null, 'TA ')) -> 'rows') x $$;
create or replace function test.tacorr(p_name text) returns public.attendance_correction_requests language sql stable security definer set search_path = '' as $$
  select r.* from public.attendance_correction_requests r where r.profile_id = test.id(p_name) order by r.created_at desc limit 1 $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   people'
select test.tamk('ta_ops', 'DEPARTMENT_HEAD', 'ta-a', 'SALES', null, true);
select test.tamk('ta_opp', 'DEPARTMENT_HEAD', 'ta-a', 'SUPPORT', null, true);
select test.tamk('ta_dh', 'DEPARTMENT_HEAD', 'ta-a', 'SALES');
select test.tamk('ta_dhb', 'DEPARTMENT_HEAD', 'ta-b');
select test.tamk('ta_tl', 'TEAM_HEAD', 'ta-a', null, 'Sales');
select test.tamk('ta_m1', 'TEAM_MEMBER', 'ta-a', null, 'Sales');
select test.tamk('ta_m2', 'TEAM_MEMBER', 'ta-a', null, 'Sales');
select test.tamk('ta_m3', 'TEAM_MEMBER', 'ta-a', null, 'Sales');
select test.tamk('ta_mp', 'TEAM_MEMBER', 'ta-a', null, 'Support');
select test.tamk('ta_mb', 'TEAM_MEMBER', 'ta-b', null, 'Sales');
set role authenticated;
select test.login('sa');
select operations_head_assign_new(test.id('ta_ops'), array[test.dept('ta-a')]);
select operations_head_assign_new(test.id('ta_opp'), array[test.dept('ta-a')]);
reset role;
select test.check((select count(*) = 10 from profiles where id in (select id from test.users where name like 'ta\_%') and status = 'ACTIVE'), 'the people exist');
-- a known company day: starts 10:00, ends 19:00, absent after 60 minutes, Monday to Saturday, no grace
update attendance_settings set reminder_punch_in = '10:00', reminder_punch_out = '19:00', absent_after_minutes = 60, reminder_days = '{1,2,3,4,5,6}',
       reminders_paused_on = null, late_grace_minutes = 0, early_punch_out_reason_required = true where id;
delete from attendance_reminder_prefs where profile_id in (select id from test.users where name like 'ta\_%');

\echo '   statuses (one per person, at fixed times of a working day)'
-- the last Wednesday before today (a working day in the past) and the last Sunday
create temp table tad as select (private.office_today() - ((extract(isodow from private.office_today())::integer + 4) % 7) - 7)::date as wed,
                                 (private.office_today() - extract(isodow from private.office_today())::integer)::date as sun;
grant select on tad to authenticated;
insert into attendance_records (profile_id, attendance_date, punch_in_at) select test.id('ta_m1'), wed, test.ist(wed, '09:55') from tad;
insert into attendance_records (profile_id, attendance_date, punch_in_at) select test.id('ta_m2'), wed, test.ist(wed, '10:20') from tad;
insert into attendance_records (profile_id, attendance_date, punch_in_at) select test.id('ta_tl'), wed, test.ist(wed, '09:50') from tad;
insert into attendance_lunches (profile_id, attendance_date, started_at) select test.id('ta_tl'), wed, test.ist(wed, '11:30') from tad;
insert into attendance_records (profile_id, attendance_date, punch_in_at, punch_out_at) select test.id('ta_dh'), wed, test.ist(wed, '09:30'), test.ist(wed, '11:45') from tad;
insert into attendance_records (profile_id, attendance_date, punch_in_at) select test.id('ta_ops'), wed, test.ist(wed, '13:30') from tad;
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason, status)
select test.id('ta_ops'), test.dept('ta-a'), 'HALF_DAY', wed, wed, 'MORNING', 'test', 'APPROVED' from tad;
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, reason, status)
select test.id('ta_mb'), test.dept('ta-b'), 'FULL_DAY', wed, wed, 'test', 'APPROVED' from tad;
select test.check(test.tastatus('ta_m1', wed, '12:00') = 'PRESENT', 'punched in on time: Present') from tad;
select test.check(test.tastatus('ta_m2', wed, '12:00') = 'LATE', 'punched in after the start: Late') from tad;
select test.check(test.tastatus('ta_tl', wed, '12:00') = 'PRESENT', 'a lunch on a past day is not "on break"') from tad;
select test.check(test.tastatus('ta_dh', wed, '12:00') = 'SHIFT_COMPLETED', 'punched out: Shift Completed') from tad;
select test.check(test.tastatus('ta_ops', wed, '14:00') = 'HALF_DAY', 'morning leave and punched in: Half Day') from tad;
select test.check(test.tastatus('ta_mb', wed, '12:00') = 'APPROVED_LEAVE', 'full-day leave: Approved Leave') from tad;
select test.check(test.tastatus('ta_mp', wed, '12:00') = 'ABSENT', 'no punch on a past working day: Absent') from tad;
select test.check(test.tastatus('ta_mp', sun, '12:00') = 'WEEKLY_OFF', 'a Sunday: Weekly Off, never Absent') from tad;
update attendance_settings set reminders_paused_on = (select wed from tad) where id;
select test.check(test.tastatus('ta_mp', wed, '12:00') = 'HOLIDAY' and test.tastatus('ta_m1', wed, '12:00') = 'PRESENT',
  'HR''s day off: Holiday (someone who came in is still Present)') from tad;
update attendance_settings set reminders_paused_on = null, late_grace_minutes = 30 where id;
select test.check(test.tastatus('ta_m2', wed, '12:00') = 'PRESENT', 'within the grace period: Present, not Late') from tad;
update attendance_settings set late_grace_minutes = 0 where id;
-- today, at fixed times
delete from attendance_records where profile_id = test.id('ta_mp') and attendance_date = private.office_today();
select test.check(test.tastatus('ta_mp', private.office_today(), '09:00') = 'SHIFT_NOT_STARTED', 'before the start: Shift Not Started');
select test.check(test.tastatus('ta_mp', private.office_today(), '10:30') = 'NOT_PUNCHED_IN', 'after the start, within the hour: Not Punched In (not yet Absent)');
select test.check(test.tastatus('ta_mp', private.office_today(), '11:30') in ('ABSENT', 'WEEKLY_OFF', 'HOLIDAY'), 'an hour later: Absent (on a working day)');
insert into attendance_records (profile_id, attendance_date, punch_in_at) values (test.id('ta_tl'), private.office_today(), test.ist(private.office_today(), '09:50'));
update attendance_lunches set ended_at = started_at + interval '30 minutes' where profile_id = test.id('ta_tl') and ended_at is null;
insert into attendance_lunches (profile_id, attendance_date, started_at) values (test.id('ta_tl'), private.office_today(), test.ist(private.office_today(), '09:55'));
select test.check(test.tastatus('ta_tl', private.office_today(), '12:00') = 'ON_BREAK', 'today, a lunch still open: On Break');
select test.check((select count(*) = 1 from private.attendance_team_rows(private.office_today()) r where r.profile_id = test.id('ta_tl')),
  'one row (and one status) per person: nobody is counted twice');

\echo '   who sees whom'
set role authenticated;
select test.login('ta_ops');
select test.check(test.taseen('x') = array['TA dh', 'TA m1', 'TA m2', 'TA m3', 'TA ops', 'TA tl'], 'the Sales CEO sees the Sales side of their department only');
select test.login('ta_opp');
select test.check(test.taseen('x') = array['TA mp', 'TA opp'], 'the Support CEO sees Support only, never Sales');
select test.login('ta_dh');
select test.check(not ('TA mb' = any (test.taseen('x'))) and 'TA m1' = any (test.taseen('x')) and not ('TA mp' = any (test.taseen('x'))),
  'the Sales Department Head sees their department''s Sales staff, not Support, not another department');
select test.login('ta_dhb');
select test.check(test.taseen('x') = array['TA dhb', 'TA mb'], 'the other Department Head sees only their own department');
select test.login('ta_tl');
select test.check(test.taseen('x') = array['TA m1', 'TA m2', 'TA m3', 'TA tl'], 'a Team Lead sees their own team');
select test.check(not exists (select 1 from jsonb_array_elements(attendance_team_overview() -> 'rows') x where x ? 'latitude' or x ? 'location'),
  'no location is ever returned');
select test.login('ta_m1');
select test.must_fail($$select attendance_team_overview()$$, 'a Team Member cannot see team attendance', 'FORBIDDEN');
select test.login('sa');
select test.check(array['TA mb', 'TA mp', 'TA m1'] <@ test.taseen('x'), 'the Managing Director sees everyone');
select test.must_fail($$select attendance_team_overview(private.office_today() + 1)$$, 'no future day', 'VALIDATION_ERROR');
select test.must_fail($$select attendance_team_overview(null, null, null, 'NONSENSE')$$, 'an unknown status filter is refused', 'VALIDATION_ERROR');
select test.check((select (o -> 'totals' ->> 'total')::int >= (o -> 'totals' ->> 'present')::int from (select attendance_team_overview() o) x),
  'the totals add up');
reset role;
set role anon;
select test.must_fail($$select attendance_team_overview()$$, 'signed-out visitors get nothing', 'permission denied');
reset role;

\echo '   Punch Out before the shift end needs a reason; the same request is never a second punch'
insert into attendance_reminder_prefs (profile_id, enabled, punch_in, lunch, punch_out) values (test.id('ta_m3'), true, '06:00', '11:00', '23:30')
on conflict (profile_id) do update set punch_out = excluded.punch_out;
set role authenticated;
select test.login('ta_m3');
select attendance_punch_in('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000a1');
select test.check((attendance_punch_out_preview() ->> 'early')::boolean and (attendance_punch_out_preview() ->> 'reasonRequired')::boolean
                  and attendance_punch_out_preview() ->> 'shiftEnd' = '23:30' and (attendance_punch_out_preview() ? 'netMinutes'),
  'the dialog''s figures come from the server: early, with the shift end and the net time');
select test.must_fail($$select attendance_punch_out_confirmed('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000a2', null)$$,
  'an early Punch Out without a reason is refused', 'before your scheduled shift end');
select attendance_punch_out_confirmed('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000a2', 'Doctor appointment');
select attendance_punch_out_confirmed('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000a2', null);
reset role;
select test.check((select count(*) = 1 from attendance_events where profile_id = test.id('ta_m3') and attendance_date = private.office_today() and kind = 'PUNCH_OUT'),
  'a retry of the same Punch Out records nothing new');
select test.check((select note = 'Early Punch Out: Doctor appointment' from attendance_events where profile_id = test.id('ta_m3') and kind = 'PUNCH_OUT'),
  'the reason is kept with that punch');
select test.check((select count(*) = 1 from audit_logs where action = 'ATTENDANCE_EARLY_PUNCH_OUT' and entity_id = test.id('ta_m3')), 'and audited');

\echo '   correction: "resume my day" after an accidental Punch Out'
set role authenticated;
select test.login('ta_m3');
select attendance_correction_request(private.office_today(), 'RESUME_DAY', null, 'I clicked Punch Out by mistake', null, '00000000-0000-4000-8000-0000000000b1');
select attendance_correction_request(private.office_today(), 'RESUME_DAY', null, 'I clicked Punch Out by mistake', null, '00000000-0000-4000-8000-0000000000b1');
reset role;
select test.check((select count(*) = 1 from attendance_correction_requests where profile_id = test.id('ta_m3')), 'the same request twice is one request');
select test.check(((test.tacorr('ta_m3')).original ->> 'punchOutAt') is not null, 'the original record is kept with the request');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ta_ops') and type = 'ATTENDANCE_CORRECTION_REQUESTED')
                  and (select count(*) = 1 from notifications where recipient_id = test.id('ta_dh') and type = 'ATTENDANCE_CORRECTION_REQUESTED')
                  and (select count(*) = 0 from notifications where recipient_id in (test.id('ta_opp'), test.id('ta_tl'), test.id('ta_dhb')) and type = 'ATTENDANCE_CORRECTION_REQUESTED'),
  'it goes to the Sales CEO and the Sales Department Head (not Support, not the Team Lead, not another department)');
set role authenticated;
select test.login('ta_m3');
select test.must_fail($$select attendance_correction_request(private.office_today(), 'RESUME_DAY', null, 'again please', null, '00000000-0000-4000-8000-0000000000b2')$$,
  'one open request per day', 'already waiting');
select test.must_fail(format('select attendance_correction_decide(%L, true)', (test.tacorr('ta_m3')).id), 'nobody decides their own correction', 'FORBIDDEN');
select test.must_fail($$select * from attendance_correction_requests$$, 'no direct table access', 'permission denied');
select test.login('ta_tl');
select test.must_fail(format('select attendance_correction_decide(%L, true)', (test.tacorr('ta_m3')).id), 'a Team Lead cannot decide it', 'NOT_FOUND');
select test.login('ta_opp');
select test.must_fail(format('select attendance_correction_decide(%L, true)', (test.tacorr('ta_m3')).id), 'nor the Support CEO', 'NOT_FOUND');
select test.check((select (x -> 'items') = '[]'::jsonb from (select attendance_corrections('DECIDE') x) y), '... who does not even see it');
select test.login('ta_dh');
select test.check((select (x ->> 'pending')::int = 1 from (select attendance_corrections('DECIDE') x) y), 'the Department Head sees it waiting');
select test.must_fail(format('select attendance_correction_decide(%L, false)', (test.tacorr('ta_m3')).id), 'a rejection needs a reason', 'reason');
select attendance_correction_decide((test.tacorr('ta_m3')).id, true, 'OK');
select test.must_fail(format('select attendance_correction_decide(%L, true)', (test.tacorr('ta_m3')).id), 'it cannot be decided twice', 'already approved');
reset role;
select test.check((select punch_out_at is null from attendance_records where profile_id = test.id('ta_m3') and attendance_date = private.office_today())
                  and private.attendance_status(test.id('ta_m3'), private.office_today()) <> 'PUNCHED_OUT',
  'approved: the day is open again');
select test.check((select count(*) = 1 from attendance_events where profile_id = test.id('ta_m3') and kind = 'PUNCH_OUT'), 'the Punch Out history is kept');
select test.check((test.tacorr('ta_m3')).status = 'APPROVED' and (test.tacorr('ta_m3')).decided_by = test.id('ta_dh')
                  and ((test.tacorr('ta_m3')).applied ->> 'punchOutAt') is null and (test.tacorr('ta_m3')).decided_at is not null,
  'the trail: original, applied, approver, time');
select test.check((select count(*) = 1 from audit_logs where action = 'ATTENDANCE_CORRECTION_APPROVED' and entity_id = (test.tacorr('ta_m3')).id), 'audited');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ta_m3') and type = 'ATTENDANCE_CORRECTION_DECIDED'), 'the employee is told');

\echo '   correction: a missed Punch In on an earlier day'
set role authenticated;
select test.login('ta_m1');
select test.must_fail($$select attendance_correction_request(private.office_today() + 1, 'SET_PUNCH_IN', '10:00', 'Forgot to punch in', null, '00000000-0000-4000-8000-0000000000c0')$$,
  'not for a future day', 'VALIDATION_ERROR');
select test.must_fail($$select attendance_correction_request(private.office_today() - 400, 'SET_PUNCH_IN', '10:00', 'Forgot to punch in', null, '00000000-0000-4000-8000-0000000000c3')$$,
  'not older than the correction window', 'days back');
select test.must_fail($$select attendance_correction_request((select wed from tad), 'SET_PUNCH_IN', '10:00', 'Forgot to punch in', null, '00000000-0000-4000-8000-0000000000c4')$$,
  'not when the day already has a Punch In', 'already has a Punch In');
select attendance_correction_request((select wed - 1 from tad), 'SET_PUNCH_IN', '09:58', 'Phone had no signal at the office', 'Ask the security desk', '00000000-0000-4000-8000-0000000000c1');
select test.login('ta_ops');
select attendance_correction_decide((test.tacorr('ta_m1')).id, true, null);
reset role;
select test.check((select punch_in_at = test.ist(wed - 1, '09:58') from attendance_records, tad where profile_id = test.id('ta_m1') and attendance_date = wed - 1)
                  and (select recorded_by = test.id('ta_ops') and location_status = 'UNAVAILABLE' from attendance_events, tad
                        where profile_id = test.id('ta_m1') and attendance_date = wed - 1 and kind = 'PUNCH_IN'),
  'approved by the CEO in charge: the Punch In is recorded, marked as entered by them');

\echo '   correction: a rejected request changes nothing'
set role authenticated;
select test.login('ta_m2');
select attendance_correction_request((select wed from tad), 'SET_PUNCH_OUT', '19:00', 'Forgot to punch out', null, '00000000-0000-4000-8000-0000000000d1');
select test.must_fail($$select attendance_correction_request((select wed from tad), 'SET_PUNCH_OUT', '08:00', 'x', null, '00000000-0000-4000-8000-0000000000d2')$$,
  'a reason of a few words is required', 'Explain');
select test.login('sa');
select attendance_correction_decide((test.tacorr('ta_m2')).id, false, 'Not what the gate log shows');
reset role;
select test.check((select punch_out_at is null from attendance_records, tad where profile_id = test.id('ta_m2') and attendance_date = wed)
                  and (test.tacorr('ta_m2')).status = 'REJECTED' and (test.tacorr('ta_m2')).decision_note = 'Not what the gate log shows',
  'rejected (by the Managing Director, with a reason): the record is unchanged');

\echo '   20270209000100: Punch Out before the shift end needs no reason'
\i supabase/migrations/20270209000100_punch_out_no_reason.sql
\i supabase/migrations/20270209000100_punch_out_no_reason.sql
select test.check((select not early_punch_out_reason_required from attendance_settings where id), 'the company rule is off');
insert into attendance_reminder_prefs (profile_id, enabled, punch_in, lunch, punch_out) values (test.id('ta_mb'), true, '06:00', '11:00', '23:30')
on conflict (profile_id) do update set punch_out = excluded.punch_out;
set role authenticated;
select test.login('ta_mb');
select attendance_punch_in('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000e1');
select test.check((attendance_punch_out_preview() ->> 'early')::boolean and not (attendance_punch_out_preview() ->> 'reasonRequired')::boolean,
  'before the shift end: still early, but no reason required');
select attendance_punch_out('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000e2');
select attendance_punch_out_confirmed('CAPTURED', 18.52, 73.85, 25, '00000000-0000-4000-8000-0000000000e2', null);
reset role;
select test.check((select count(*) = 1 from attendance_events where profile_id = test.id('ta_mb') and attendance_date = private.office_today() and kind = 'PUNCH_OUT'
                     and note is null),
  'the confirmed Punch Out is recorded without a reason (and its retry through either function is not a second punch)');

delete from attendance_reminder_prefs where profile_id in (select id from test.users where name like 'ta\_%');
update attendance_settings set late_grace_minutes = 0, reminders_paused_on = null where id;
