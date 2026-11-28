-- =============================================================================
-- Attendance statement and export (20270312000200): date ranges (both days included, across months / years, leap day), filters, statuses,
-- breaks, missing punches, holidays, leave, historical employees, summaries over the whole set, the register, the export (every row, recorded),
-- the biometric reconciliation and who may read it.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 141. Attendance statement and export'
reset role;
\i supabase/migrations/20270312000100_employee_review_cycles.sql
\i supabase/migrations/20270312000200_attendance_statement.sql
\i supabase/migrations/20270312000200_attendance_statement.sql

do $$
begin
  if not exists (select 1 from test.users where name = 'as_a') then
    perform test.create_auth_user(n, n || '@as.example', jsonb_build_object('full_name', 'AS ' || upper(replace(n, 'as_', ''))),
      jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')))
      from unnest(array['as_a', 'as_b', 'as_left']) n;
  end if;
end $$;
update profiles set status = 'ACTIVE' where id in (test.id('as_a'), test.id('as_b'));
update profiles set status = 'REVOKED' where id = test.id('as_left');
delete from employee_personal_details where profile_id in (test.id('as_a'), test.id('as_b'), test.id('as_left'));
insert into employee_personal_details (profile_id, joining_date) values (test.id('as_a'), date '2023-01-01'), (test.id('as_b'), date '2025-12-31'), (test.id('as_left'), date '2023-01-01');
delete from attendance_records where profile_id in (test.id('as_a'), test.id('as_b'), test.id('as_left'));
delete from attendance_lunches where profile_id in (test.id('as_a'), test.id('as_b'));
delete from attendance_events where profile_id in (test.id('as_a'), test.id('as_b'));
delete from leave_requests where employee_id in (test.id('as_a'), test.id('as_b'));
delete from office_holidays where day in (date '2026-01-01', date '2024-02-29');
insert into office_holidays (day, name) values (date '2026-01-01', 'New Year (test)');
-- 2024-02-29 (a leap day, Thursday): A present 10:00-18:30 with two overlapping lunches
insert into attendance_records (profile_id, attendance_date, punch_in_at, punch_out_at) values
  (test.id('as_a'), date '2024-02-29', timestamptz '2024-02-29 10:00+05:30', timestamptz '2024-02-29 18:30+05:30'),
  -- 2025-12-31 (Wednesday): A late (10:40), left early (17:00); B joined today and forgot to punch out
  (test.id('as_a'), date '2025-12-31', timestamptz '2025-12-31 10:40+05:30', timestamptz '2025-12-31 17:00+05:30'),
  (test.id('as_b'), date '2025-12-31', timestamptz '2025-12-31 10:00+05:30', null),
  -- 2026-01-02 (Friday): A half-day leave (afternoon) and present in the morning; the left employee was present
  (test.id('as_a'), date '2026-01-02', timestamptz '2026-01-02 10:00+05:30', timestamptz '2026-01-02 14:00+05:30'),
  (test.id('as_left'), date '2026-01-02', timestamptz '2026-01-02 10:00+05:30', timestamptz '2026-01-02 19:00+05:30');
insert into attendance_lunches (profile_id, attendance_date, started_at, ended_at) values
  (test.id('as_a'), date '2024-02-29', timestamptz '2024-02-29 13:00+05:30', timestamptz '2024-02-29 13:40+05:30'),
  (test.id('as_a'), date '2024-02-29', timestamptz '2024-02-29 13:20+05:30', timestamptz '2024-02-29 14:00+05:30');
insert into attendance_events (profile_id, attendance_date, kind, occurred_at, location_status) values
  (test.id('as_a'), date '2024-02-29', 'PUNCH_IN', timestamptz '2024-02-29 10:00+05:30', 'UNAVAILABLE'),
  (test.id('as_a'), date '2024-02-29', 'PUNCH_OUT', timestamptz '2024-02-29 18:30+05:30', 'UNAVAILABLE');
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason, status)
values (test.id('as_a'), test.dept('whatsbox'), 'HALF_DAY', date '2026-01-02', date '2026-01-02', 'AFTERNOON', 'Doctor visit', 'APPROVED');
update employee_personal_details set biometric_id = null where biometric_id = 'BIO-0042';

create or replace function test.ast(f jsonb) returns jsonb language plpgsql as $$ begin return attendance_statement(f); end $$;
create or replace function test.row_of(f jsonb, p text, d date) returns jsonb language sql as
  $$ select r from jsonb_array_elements(attendance_statement(f || '{"pageSize":200}') -> 'rows') r where r ->> 'profileId' = test.id(p)::text and r ->> 'date' = d::text $$;
grant execute on all functions in schema test to authenticated;

set role authenticated;
\echo '   who may read'
select test.login('tm_a');
select test.must_fail($$select attendance_statement('{"from":"2026-01-01","to":"2026-01-02"}')$$, 'an employee cannot read the statement', 'Only HR');
select test.must_fail($$select attendance_export('{"from":"2026-01-01","to":"2026-01-02"}', 'DETAILED', 'CSV')$$, 'nor export it', 'Only HR');
select test.login('dh_wbx');
select test.must_fail($$select attendance_statement('{"from":"2026-01-01","to":"2026-01-02"}')$$, 'a Department Head neither (they have Team attendance)', 'Only HR');
select test.login('hr_head');

\echo '   ranges'
select test.must_fail($$select attendance_statement('{"from":"2026-01-05","to":"2026-01-01"}')$$, 'From later than To is refused', 'not be later');
select test.must_fail($$select attendance_statement('{"from":"2026-01-01","to":"2026-04-01","view":"REGISTER"}')$$, 'the register covers at most 62 days', '62 days');
select test.check((select count(*) = 3 from jsonb_array_elements(attendance_statement(jsonb_build_object('from', '2025-12-31', 'to', '2026-01-02', 'profileIds', jsonb_build_array(test.id('as_a')), 'pageSize', 200)) -> 'rows')),
  'a range across the year includes both end dates (31 Dec, 1 Jan, 2 Jan)');
select test.check((test.row_of(jsonb_build_object('from', '2024-02-28', 'to', '2024-03-01', 'profileIds', jsonb_build_array(test.id('as_a'))), 'as_a', date '2024-02-29') ->> 'status') = 'PRESENT',
  'a leap day is a normal day');

\echo '   one day, every column'
create temp table f1 as select jsonb_build_object('from', '2024-02-29', 'to', '2024-02-29', 'profileIds', jsonb_build_array(test.id('as_a'))) as f;
grant all on f1 to authenticated;
select test.check((select (r ->> 'breakMinutes')::int = 60 and (r ->> 'breaks')::int = 2 and (r ->> 'grossMinutes')::int = 510 and (r ->> 'netMinutes')::int = 450
                     and r ->> 'shiftStart' = '10:00' and r ->> 'source' = 'CRM' from (select test.row_of(f, 'as_a', date '2024-02-29') r from f1) x),
  'two overlapping lunches count once (13:00-14:00); gross 8h30, net 7h30');
select test.check((select r ->> 'status' = 'LATE' and (r ->> 'lateMinutes')::int = 10 and (r ->> 'earlyMinutes')::int = 120
                     from (select test.row_of(jsonb_build_object('from', '2025-12-31', 'to', '2025-12-31', 'profileIds', jsonb_build_array(test.id('as_a'))), 'as_a', date '2025-12-31') r) x),
  'late by 10 minutes (after 10:30) and an early departure of 2 hours (before 19:00)');
select test.check((select r ->> 'status' = 'MISSING_PUNCH_OUT' and r ->> 'netMinutes' is null and (r ->> 'incomplete')::boolean
                     from (select test.row_of(jsonb_build_object('from', '2025-12-31', 'to', '2025-12-31', 'profileIds', jsonb_build_array(test.id('as_b'))), 'as_b', date '2025-12-31') r) x),
  'a missing Punch Out is incomplete, with no hours invented');
select test.check((select r ->> 'status' = 'HOLIDAY' and not (r ->> 'scheduled')::boolean and r ->> 'holiday' = 'New Year (test)'
                     from (select test.row_of(jsonb_build_object('from', '2026-01-01', 'to', '2026-01-01', 'profileIds', jsonb_build_array(test.id('as_a'))), 'as_a', date '2026-01-01') r) x),
  'a holiday is not an absence and not a scheduled day');
select test.check((select r ->> 'status' = 'HALF_DAY' and r ->> 'leave' = 'AFTERNOON'
                     from (select test.row_of(jsonb_build_object('from', '2026-01-02', 'to', '2026-01-02', 'profileIds', jsonb_build_array(test.id('as_a'))), 'as_a', date '2026-01-02') r) x),
  'a half-day leave with a Punch In is a half day');
select test.check((select r ->> 'status' = 'NOT_JOINED' and not (r ->> 'scheduled')::boolean
                     from (select test.row_of(jsonb_build_object('from', '2025-12-30', 'to', '2025-12-30', 'profileIds', jsonb_build_array(test.id('as_b'))), 'as_b', date '2025-12-30') r) x),
  'before the joining date nothing is expected');
select test.check((select r ->> 'status' = 'UPCOMING' from (select test.row_of(jsonb_build_object('from', (private.office_today() + 3)::text, 'to', (private.office_today() + 3)::text,
                     'profileIds', jsonb_build_array(test.id('as_a'))), 'as_a', private.office_today() + 3) r) x) in (true, null),
  'a future day is never an absence');
select test.check((select count(*) = 0 from jsonb_array_elements(attendance_statement(jsonb_build_object('from', private.office_today()::text, 'to', (private.office_today() + 5)::text,
                     'profileIds', jsonb_build_array(test.id('as_a')), 'statuses', '["ABSENT"]'::jsonb)) -> 'rows')), 'today and future days are not counted as absent');

\echo '   filters, summary, historical employees'
create temp table f2 as select jsonb_build_object('from', '2025-12-31', 'to', '2026-01-02', 'departmentIds', jsonb_build_array(test.dept('whatsbox')), 'pageSize', 10) as f;
grant all on f2 to authenticated;
select test.check((select bool_and(r ->> 'department' = 'Whatsbox') from f2, jsonb_array_elements(attendance_statement(f) -> 'rows') r), 'the department filter');
select test.check((select count(*) = 0 from f2, jsonb_array_elements(attendance_statement(f || '{"pageSize":200}') -> 'rows') r where r ->> 'profileId' = test.id('as_left')::text),
  'a left employee is not in the default (active) statement');
select test.check((select count(*) = 1 from jsonb_array_elements(attendance_statement(jsonb_build_object('from', '2026-01-02', 'to', '2026-01-02', 'profileIds', jsonb_build_array(test.id('as_left')))) -> 'rows') r
                    where r ->> 'status' = 'PRESENT'), 'but their history is there when HR selects them');
select test.check((select (s ->> 'employees')::int = 3 from (select attendance_statement(jsonb_build_object('from', '2026-01-02', 'to', '2026-01-02',
                     'profileIds', jsonb_build_array(test.id('as_a'), test.id('as_b'), test.id('as_left')))) -> 'summary' s) x), 'several employees at once (unique employees counted)');
create temp table f3 as select jsonb_build_object('from', '2025-12-31', 'to', '2026-01-02', 'profileIds', jsonb_build_array(test.id('as_a'), test.id('as_b')), 'pageSize', 10) as f;
grant all on f3 to authenticated;
select test.check((select (s ->> 'employeeDays')::int = 6 and (s ->> 'employees')::int = 2 and (s ->> 'lateArrivals')::int = 1 and (s ->> 'earlyDepartures')::int >= 1
                      and (s ->> 'missingPunches')::int = 1 and (s ->> 'halfDays')::int = 1 and (s ->> 'scheduledDays')::int = 4 and (s ->> 'absentDays')::int = 1
                     from (select attendance_statement(f) -> 'summary' s from f3) x),
  'the cards: employee-days vs unique employees, late, early, missing punches, half-days; the holiday and pre-joining days are not scheduled');
select test.check((select (attendance_statement(f || '{"pageSize":10,"page":1}') -> 'summary') = (attendance_statement(f || '{"pageSize":10,"page":2}') -> 'summary') from f3),
  'the cards cover the whole filtered set, whatever the page');
select test.check((select bool_and(r ->> 'status' = 'MISSING_PUNCH_OUT') and count(*) = 1 from f3, jsonb_array_elements(attendance_statement(f || '{"statuses":["DISCREPANCY"]}') -> 'rows') r),
  'the discrepancy filter finds the missing Punch Out');
select test.check((select count(*) = 1 from f3, jsonb_array_elements(attendance_statement(f || '{"statuses":["LATE_ARRIVAL"]}') -> 'rows') r), 'the late filter');
select test.check((select jsonb_array_length(attendance_statement(f || '{"sort":"name","dir":"asc"}') -> 'rows') = 6
                      and (attendance_statement(f || '{"sort":"name","dir":"asc"}') -> 'rows' -> 0 ->> 'name') = 'AS A' from f3), 'sorting by name');

\echo '   summary and register views'
select test.check((select (r ->> 'presentDays')::numeric = 1.5 and (r ->> 'leaveDays')::numeric = 0.5 and (r ->> 'lateArrivals')::int = 1
                     from f3, jsonb_array_elements(attendance_statement(f || '{"view":"SUMMARY"}') -> 'rows') r where r ->> 'name' = 'AS A'),
  'the employee summary: 1 full day + a half day present, half a day of leave, one late arrival');
select test.check((select r -> 'days' ->> '2025-12-31' = 'P' and r -> 'days' ->> '2026-01-01' = 'H' and r -> 'days' ->> '2026-01-02' = 'HD'
                     from f3, jsonb_array_elements(attendance_statement(f || '{"view":"REGISTER"}') -> 'rows') r where r ->> 'name' = 'AS A'),
  'the register codes: P, H, HD');
select test.check((select r -> 'days' ->> '2025-12-31' = 'MP' and r -> 'days' ->> '2026-01-01' = 'H'
                     from f3, jsonb_array_elements(attendance_statement(f || '{"view":"REGISTER"}') -> 'rows') r where r ->> 'name' = 'AS B'), 'MP for a missing punch');

\echo '   export: every row, recorded, reconciliation'
reset role;
delete from attendance_export_log;
set role authenticated;
select test.login('hr_head');
select test.check((select (x ->> 'total')::int = 6 and jsonb_array_length(x -> 'rows') = 6 and x ->> 'generatedBy' = 'HR Head'
                     from (select attendance_export(f, 'DETAILED', 'XLSX', 0, 100) x from f3) y), 'the export has every matching row (not just a page)');
select test.check((select jsonb_array_length(attendance_export(f, 'DETAILED', 'XLSX', 100, 100) -> 'rows') = 0 from f3), 'and the next page is empty');
select test.check((select (x ->> 'total')::int = 6 and (select count(*) from jsonb_array_elements(x -> 'rows') e where e ->> 'event' like 'LUNCH%') = 4
                     from (select attendance_export(jsonb_build_object('from', '2024-02-29', 'to', '2024-02-29', 'profileIds', jsonb_build_array(test.id('as_a'))), 'RAW_PUNCHES', 'CSV') x) y),
  'the raw punch events: Punch In, Punch Out and the lunch starts / ends');
reset role;
select test.check((select count(*) = 2 and bool_and(actor_id = test.id('hr_head')) and bool_or(export_type = 'RAW_PUNCHES' and file_format = 'CSV')
                     from attendance_export_log), 'each export is recorded once (who, type, format), not once per page');
select test.check((select count(*) >= 1 from audit_logs where action = 'ATTENDANCE_EXPORTED' and actor_id = test.id('hr_head')), 'and audited');
set role authenticated;
select test.check(hr_set_biometric_id(test.id('as_a'), 'BIO-0042') ->> 'biometricId' = 'BIO-0042', 'HR records the biometric machine id');
select test.must_fail($$select hr_set_biometric_id(test.id('as_b'), 'BIO-0042')$$, 'two employees cannot share a biometric id', 'already has');
select test.check((test.row_of(jsonb_build_object('from', '2024-02-29', 'to', '2024-02-29', 'profileIds', jsonb_build_array(test.id('as_a'))), 'as_a', date '2024-02-29') ->> 'biometricId') = 'BIO-0042',
  'the reconciliation rows carry the biometric id');
select test.login('tm_a');
select test.must_fail($$select hr_set_biometric_id(test.id('as_a'), 'X1')$$, 'only HR sets it', 'Only HR');
select test.must_fail($$select attendance_export_history()$$, 'and only HR reads the export history', 'Only HR');
reset role;
delete from office_holidays where day = date '2026-01-01';
update employee_personal_details set biometric_id = null where biometric_id = 'BIO-0042';

\echo '=== ATTENDANCE STATEMENT TESTS PASSED ==='
