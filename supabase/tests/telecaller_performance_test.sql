-- =============================================================================
-- Telecaller weekly performance (20270312000300): call attribution through the mappings, duplicate provider rows, working-day adjusted targets
-- (leave, half day, holiday, midweek joining), missing target / mapping / sync, categories, preliminary -> final, recalculation, the review policy
-- (off by default), automatic review meetings (one per concern), pending scheduling, reports, improvement plans and who sees what.
-- Dates: the week of Monday 2 Nov 2026 (in the past for the test clock).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 142. Telecaller weekly performance'
reset role;
\i supabase/migrations/20270312000100_employee_review_cycles.sql
\i supabase/migrations/20270312000200_attendance_statement.sql
\i supabase/migrations/20270312000300_telecaller_performance.sql
\i supabase/migrations/20270312000300_telecaller_performance.sql

do $$
begin
  if not exists (select 1 from test.users where name = 'tp_a') then
    perform test.create_auth_user(n, n || '@tp.example', jsonb_build_object('full_name', 'TP ' || upper(replace(n, 'tp_', ''))),
      jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')))
      from unnest(array['tp_a', 'tp_b', 'tp_c', 'tp_d', 'tp_new']) n;
  end if;
end $$;
update profiles set status = 'ACTIVE', sales_sub_role = 'TELECALLER' where id in (select id from test.users where name like 'tp\_%');
delete from employee_personal_details where profile_id in (select id from test.users where name like 'tp\_%');
insert into employee_personal_details (profile_id, joining_date) select id, date '2026-01-01' from test.users where name in ('tp_a', 'tp_b', 'tp_c', 'tp_d');
insert into employee_personal_details (profile_id, joining_date) values (test.id('tp_new'), date '2026-11-05');   -- joined on the Thursday
delete from telecaller_weekly_performance where profile_id in (select id from test.users where name like 'tp\_%');
delete from telecaller_targets where department_id = test.dept('whatsbox') or profile_id in (select id from test.users where name like 'tp\_%');
delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_TPTEST';
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('TP', 'CROCODIAL_TOKEN_TPTEST', true, 'Asia/Kolkata');
create temp table tpc as select id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_TPTEST';
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
select (select id from tpc), x.ext, x.n, test.id(x.n), test.dept('whatsbox'), 'SALES', 'APPROVED', timestamptz '2026-11-01', timestamptz '2026-11-01'
  from (values (701, 'tp_a'), (702, 'tp_b'), (703, 'tp_new'), (705, 'tp_d')) x(ext, n);
-- tp_c has no mapping. A call by the unmapped Crocodial user 799 is nobody's.
delete from office_holidays where day = date '2026-11-06';
delete from leave_requests where employee_id in (test.id('tp_a'), test.id('tp_b'));
-- tp_b: one full day of approved leave (Tue) and a half day (Wed afternoon); Fri 6 Nov is a holiday for everyone
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason, status) values
  (test.id('tp_b'), test.dept('whatsbox'), 'FULL_DAY', date '2026-11-03', date '2026-11-03', null, 'Family function', 'APPROVED'),
  (test.id('tp_b'), test.dept('whatsbox'), 'HALF_DAY', date '2026-11-04', date '2026-11-04', 'AFTERNOON', 'Bank work', 'APPROVED');
insert into office_holidays (day, name) values (date '2026-11-06', 'TP Holiday');
-- calls: tp_a 400 outgoing in the week (300 connected), 5 incoming; one provider call stored once even if read twice (the key is the provider id)
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7000000 + g, 701, '+91 98' || lpad((g % 150)::text, 8, '0'), 'outgoing', timestamptz '2026-11-02 10:30+05:30' + (g % 5) * interval '1 day' + (g % 300) * interval '1 minute',
       case when g <= 300 then 120 else 0 end, g <= 300
  from generate_series(1, 400) g;
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7100000 + g, 701, '+91 99' || lpad(g::text, 8, '0'), 'incoming', timestamptz '2026-11-03 12:00+05:30', 60, true from generate_series(1, 5) g;
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7200000 + g, 702, '+91 97' || lpad(g::text, 8, '0'), 'outgoing', timestamptz '2026-11-02 11:00+05:30', 90, true from generate_series(1, 210) g;
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7300000 + g, 799, '+91 96' || lpad(g::text, 8, '0'), 'outgoing', timestamptz '2026-11-02 11:00+05:30', 90, true from generate_series(1, 50) g;
-- a call that Crocodial no longer returns does not count
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected, missing_since)
values ((select id from tpc), 7400001, 701, '+91 9500000001', 'outgoing', timestamptz '2026-11-02 12:00+05:30', 30, true, now());
-- tp_d: calls, but the call logs were not synchronised after the week
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7500000 + g, 705, '+91 94' || lpad(g::text, 8, '0'), 'outgoing', timestamptz '2026-11-02 11:00+05:30', 90, true from generate_series(1, 20) g;
-- tp_new: 60 calls on Thu and Fri
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7600000 + g, 703, '+91 93' || lpad(g::text, 8, '0'), 'outgoing', timestamptz '2026-11-05 11:00+05:30', 90, true from generate_series(1, 60) g;
delete from crocodial_sync_state where connection_id = (select id from tpc);
insert into crocodial_sync_state (connection_id, resource, last_ok_at, last_run_at) values ((select id from tpc), 'call-logs', timestamptz '2026-11-09 09:00+05:30', now());

create or replace function test.wk(p text) returns public.telecaller_weekly_performance language sql security definer as
  $$ select * from telecaller_weekly_performance where profile_id = test.id(p) and week_start = date '2026-11-02' $$;
create or replace function test.open_plan(p text) returns uuid language sql security definer as
  $$ select id from performance_improvement_plans where profile_id = test.id(p) and status = 'OPEN' limit 1 $$;
-- the weekly run is the service's, with nobody signed in
create or replace function test.tcrun(p date) returns jsonb language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', false);
  return tc_weekly_run(p);
end $$;
grant execute on all functions in schema test to authenticated;

\echo '   no target: not evaluated (never low)'
select private.tc_compute_week(test.id('tp_a'), date '2026-11-02');
select test.check((test.wk('tp_a')).category = 'NOT_EVALUATED' and (test.wk('tp_a')).reason = 'No call target configured.', 'without a target the week is "Not evaluated"');

\echo '   targets'
set role authenticated;
select test.login('tm_c');
select test.must_fail($$select tc_target_set(jsonb_build_object('scopeType', 'DEPARTMENT', 'departmentId', test.dept('whatsbox'), 'dailyCalls', 100, 'effectiveFrom', '2026-10-01'))$$,
  'a member cannot set targets', 'FORBIDDEN');
select test.login('dh_wbx');
select test.check(jsonb_array_length(tc_target_set(jsonb_build_object('scopeType', 'DEPARTMENT', 'departmentId', test.dept('whatsbox'), 'dailyCalls', 100, 'effectiveFrom', '2026-10-01'))) >= 1,
  'the Department Head sets the department''s daily target (100 calls)');
select test.check(jsonb_array_length(tc_target_set(jsonb_build_object('scopeType', 'EMPLOYEE', 'profileId', test.id('tp_d'), 'dailyCalls', 50, 'effectiveFrom', '2026-10-01', 'note', 'New process'))) >= 2,
  'and an employee-specific override');
reset role;
select private.tc_compute_week(test.id('tp_a'), date '2026-11-02');
select test.check((test.wk('tp_a')).category = 'NOT_EVALUATED' and (test.wk('tp_a')).status = 'FINAL',
  'a week finalised before the target existed keeps its result: a new target does not rewrite it without an authorised recalculation');
-- the rest of the test: the targets were in place before the week was calculated
delete from telecaller_weekly_performance where week_start = date '2026-11-02';
select private.tc_compute_week(test.id(n), date '2026-11-02') from unnest(array['tp_a', 'tp_b', 'tp_c', 'tp_d', 'tp_new']) n;

\echo '   attribution and counting'
select test.check((test.wk('tp_a')).actual_calls = 400 and (test.wk('tp_a')).connected_calls = 300 and (test.wk('tp_a')).not_connected_calls = 100
                    and (test.wk('tp_a')).incoming_calls = 5 and (test.wk('tp_a')).unique_contacts = 150 and (test.wk('tp_a')).talk_seconds = 36000,
  'only outgoing calls count (400; 300 connected, 100 not); incoming are separate; a call missing at the source is not counted; unique contacts');
select test.check((test.wk('tp_b')).actual_calls = 210, 'each Telecaller gets only the calls of their own mapped Crocodial account');
select test.check(not exists (select 1 from telecaller_weekly_performance w where w.actual_calls = 50 and w.week_start = date '2026-11-02'), 'calls of an unmapped Crocodial user are nobody''s');

\echo '   working-day adjusted targets'
-- Mon-Sat working (6), Fri holiday -> 5 scheduled days
select test.check((test.wk('tp_a')).scheduled_days = 5 and (test.wk('tp_a')).eligible_days = 5 and (test.wk('tp_a')).adjusted_target = 500
                    and (test.wk('tp_a')).achievement = 80.0 and (test.wk('tp_a')).category = 'ON_TRACK',
  'a holiday is not a working day: 5 days x 100 = 500; 400 calls = 80% (on track)');
select test.check((test.wk('tp_b')).eligible_days = 3.5 and (test.wk('tp_b')).adjusted_target = 350 and (test.wk('tp_b')).achievement = 60.0
                    and (test.wk('tp_b')).category = 'LOW_PERFORMANCE',
  'approved leave lowers the target (1 day, and half a day): 3.5 x 100 = 350; 210 calls = 60%');
select test.check((test.wk('tp_new')).eligible_days = 2 and (test.wk('tp_new')).adjusted_target = 200 and (test.wk('tp_new')).achievement = 30.0
                    and (test.wk('tp_new')).category = 'INSUFFICIENT_DATA',
  'a midweek joiner is judged on the days after joining (2 days = 200); below the minimum working days: insufficient data, not low');
select test.check((test.wk('tp_c')).category = 'NOT_EVALUATED' and (test.wk('tp_c')).reason = 'No approved Crocodial mapping for the whole week.', 'no mapping: not evaluated');
select test.check((test.wk('tp_a')).breakdown ->> 'formula' = '100 daily x 5 eligible days', 'the calculation is shown');

\echo '   sync, preliminary and final'
select test.check((test.wk('tp_a')).status = 'FINAL' and (test.wk('tp_a')).data_complete, 'synchronised after the week: FINAL');
-- tp_d's week is calculated (for the first time) while the last call-log read is from before the week ended
delete from telecaller_weekly_performance where profile_id = test.id('tp_d') and week_start = date '2026-11-02';
update crocodial_sync_state set last_ok_at = timestamptz '2026-11-08 12:00+05:30' where connection_id = (select id from tpc);
select private.tc_compute_week(test.id('tp_d'), date '2026-11-02');
select test.check((test.wk('tp_d')).category = 'SYNC_PENDING' and (test.wk('tp_d')).status = 'PRELIMINARY',
  'call logs not synchronised after the week: sync pending, preliminary (never low)');
select test.check((test.wk('tp_a')).status = 'FINAL' and (test.wk('tp_a')).actual_calls = 400, 'a FINAL week is not recalculated by later runs');
update crocodial_sync_state set last_ok_at = timestamptz '2026-11-09 09:00+05:30' where connection_id = (select id from tpc);
-- a late provider row arrives for tp_a after the week was finalised
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, phone_number, call_type, call_at, duration_seconds, connected)
select (select id from tpc), 7700000 + g, 701, '+91 92' || lpad(g::text, 8, '0'), 'outgoing', timestamptz '2026-11-04 15:00+05:30', 60, true from generate_series(1, 100) g;
select private.tc_compute_week(test.id('tp_a'), date '2026-11-02');
select test.check((test.wk('tp_a')).actual_calls = 400, 'late call rows do not change a finalised week by themselves');
set role authenticated;
select test.login('tm_c');
select test.must_fail($$select tc_recalculate((test.wk('tp_a')).id, 'late call logs')$$, 'a member cannot recalculate', 'not found|FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail($$select tc_recalculate((test.wk('tp_a')).id, 'x')$$, 'a reason is required', 'Say why');
select test.check((tc_recalculate((test.wk('tp_a')).id, 'Late call logs from Crocodial') ->> 'actualCalls')::int = 500, 'an authorised recalculation takes the late calls (500 = 100%)');
reset role;
select test.check((select count(*) = 1 and bool_and((before ->> 'actualCalls')::int = 400 and (after ->> 'actualCalls')::int = 500) from telecaller_performance_recalcs
                    where performance_id = (test.wk('tp_a')).id), 'the recalculation is kept with before / after and the reason');
select test.check((test.wk('tp_a')).category = 'TARGET_ACHIEVED' and (test.wk('tp_a')).achievement = 100.0, 'achievement is not capped; 100% = target achieved');

\echo '   reviews: off until approved, then one per concern'
update telecaller_weekly_performance set review_status = 'NONE', meeting_id = null where week_start = date '2026-11-02';
select test.tcrun(date '2026-11-10');
select test.check((test.wk('tp_b')).review_status = 'NONE' and not exists (select 1 from meetings where source_type = 'performance_review'),
  'with the policy not approved, no review meeting is created');
set role authenticated;
select test.login('dh_wbx');
select test.must_fail($$select tc_policy_set('{"enabled":true}')$$, 'a Department Head does not approve the policy', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$select tc_policy_set('{"achievedPct":60,"onTrackPct":80}')$$, 'thresholds must go down', 'must go down');
select test.check((tc_policy_set('{"enabled":true,"reviewBelowPct":70,"minWorkingDays":3,"consecutiveWeeks":1,"inviteTeamLead":true}') ->> 'approved_by')::uuid = test.id('hr_head'),
  'the HR Department Head approves the thresholds and switches the reviews on');
reset role;
delete from meeting_availability where host_id = test.id('hr_head');
select test.tcrun(date '2026-11-10');
select test.check((test.wk('tp_b')).review_status = 'SCHEDULED' and (test.wk('tp_b')).meeting_id is not null and (test.wk('tp_b')).review_reason like 'Achievement 60.0%%',
  'a final week below the threshold gets a review meeting');
select test.check((select m.kind = 'HR_MEETING' and m.host_id = test.id('hr_head') and m.title = 'Performance Review Meeting — TP B' and m.status = 'SCHEDULED'
                      and m.description like '%Adjusted Weekly Target: 350%' and m.description not ilike '%low perform%'
                      and exists (select 1 from meeting_attendees a where a.meeting_id = m.id and a.profile_id = test.id('tp_b') and a.role = 'REQUIRED')
                     from meetings m where m.id = (test.wk('tp_b')).meeting_id),
  'in the existing meetings engine: HR hosts, the Telecaller is required, the figures are in the description, no "low performer" label');
select test.check((select count(*) = 1 from meeting_attendees a join meetings m on m.id = a.meeting_id where m.id = (test.wk('tp_b')).meeting_id and a.role = 'OPTIONAL'
                     and a.profile_id = private.direct_lead_of(test.id('tp_b'))) or private.direct_lead_of(test.id('tp_b')) is null, 'the Team Lead is invited (policy), nobody else');
select test.check((select extract(isodow from (m.starts_at at time zone 'Asia/Kolkata')) between 1 and 6 and m.starts_at > now() from meetings m where m.id = (test.wk('tp_b')).meeting_id),
  'at a future working-day slot');
select test.check((select count(*) >= 1 from notifications where type = 'PERFORMANCE_REVIEW_MEETING' and recipient_id = test.id('tp_b')), 'the Telecaller is notified in the CRM');
select test.check((select count(*) = 1 from hr_email_events where kind = 'PERFORMANCE_REVIEW_MEETING' and recipient_email = 'tp_b@tp.example'), 'and by e-mail (once)');
select test.check((test.wk('tp_a')).review_status = 'NONE' and (test.wk('tp_new')).review_status = 'NONE', 'on target and insufficient data: no review');
select test.check((test.wk('tp_d')).status = 'FINAL' and (test.wk('tp_d')).achievement = 8.0 and (test.wk('tp_d')).review_status = 'SCHEDULED',
  'tp_d''s week was finalised once its call logs arrived (20 of 250 = 8%), and reviewed then');
select test.tcrun(date '2026-11-10');
select test.tcrun(date '2026-11-11');
select test.check((select count(*) = 2 and count(distinct source_id) = 2 from meetings where source_type = 'performance_review'), 'running again never creates a second meeting');

\echo '   no free slot: pending scheduling, then HR schedules; reschedule; cancel'
reset role;
-- tp_d's review starts again from nothing (its meeting removed) to show what happens when no common time is free
delete from meetings where source_type = 'performance_review' and source_id = (test.wk('tp_d')).id;
update telecaller_weekly_performance set review_status = 'NONE', meeting_id = null where id = (test.wk('tp_d')).id;
-- HR is fully booked: no availability windows at all
insert into meeting_availability (host_id, weekday, start_time, end_time) values (test.id('hr_head'), 0, time '06:00', time '06:15') on conflict do nothing;
select test.tcrun(date '2026-11-10');
select test.check((test.wk('tp_d')).review_status = 'PENDING_SCHEDULING' and (test.wk('tp_d')).meeting_id is null, 'no common free time: "pending scheduling", no invented meeting time');
select test.check((select count(*) >= 1 from notifications where type = 'PERFORMANCE_REVIEW_PENDING' and recipient_id = test.id('hr_head')), 'HR is told');
delete from meeting_availability where host_id = test.id('hr_head');
set role authenticated;
select test.login('dh_wbx');
select test.must_fail($$select tc_review_schedule((test.wk('tp_d')).id, now() + interval '2 days')$$, 'only HR schedules the review', 'Only HR');
select test.login('hr_head');
select test.check(tc_review_schedule((test.wk('tp_d')).id, date_trunc('hour', now() + interval '3 days') + interval '11 hours') ->> 'reviewStatus' = 'SCHEDULED', 'HR schedules it');
select test.check((tc_review_schedule((test.wk('tp_d')).id, date_trunc('hour', now() + interval '4 days') + interval '11 hours') -> 'meeting' ->> 'id')::uuid = (test.wk('tp_d')).meeting_id,
  'rescheduling moves the same meeting (no duplicate)');
reset role;
select test.check((select version >= 2 from meetings where id = (test.wk('tp_d')).meeting_id) and exists (select 1 from meeting_events e where e.meeting_id = (test.wk('tp_d')).meeting_id and e.kind = 'RESCHEDULED'),
  'the move is a new version of the meeting, logged');
set role authenticated;
select test.login('hr_head');
select test.check(tc_review_schedule((test.wk('tp_d')).id, null, true) ->> 'reviewStatus' = 'CANCELLED', 'HR can cancel it');
reset role;
select test.check((select status = 'CANCELLED' from meetings where id = (test.wk('tp_d')).meeting_id), 'the meeting is cancelled in the meetings engine');

\echo '   the report and the improvement plan'
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select tc_review_report((test.wk('tp_b')).id, '{"outcome":"IMPROVEMENT_PLAN","fields":{"performanceGap":"Calls 60%","hrObservations":"Needs coaching"}}')$$,
  'an improvement plan needs targets and a deadline', 'improvement plan');
select test.check(jsonb_array_length(tc_review_report((test.wk('tp_b')).id, jsonb_build_object('outcome', 'IMPROVEMENT_PLAN', 'fields', jsonb_build_object('performanceGap', 'Calls at 60% of target',
       'hrObservations', 'Script needs work', 'employeeExplanation', 'Network issues on two days', 'trainingRequirements', 'Call script training'),
       'actionItems', jsonb_build_array(jsonb_build_object('action', 'Script training', 'owner', 'Team Lead', 'due', '2026-11-20')), 'followUpDate', '2026-11-27',
       'plan', jsonb_build_object('targets', '80% of the adjusted target for 3 weeks', 'support', 'Daily coaching', 'deadline', '2026-12-04'))) -> 'plans') = 1,
  'HR submits the report; the improvement plan starts');
reset role;
select test.check((test.wk('tp_b')).review_status = 'COMPLETED' and (select status = 'COMPLETED' from meetings where id = (test.wk('tp_b')).meeting_id), 'the review and its meeting are completed');
select test.check(not exists (select 1 from audit_logs where action ilike '%DISCIPLIN%' or action ilike '%TERMINAT%'), 'nothing disciplinary is created');
update telecaller_weekly_performance set review_status = 'NONE' where id = (test.wk('tp_b')).id;
select test.tcrun(date '2026-11-10');
select test.check((test.wk('tp_b')).review_status = 'NONE', 'with an open improvement plan no overlapping automatic review is created');
set role authenticated;
select test.login('hr_head');
select test.check((tc_plan_close(test.open_plan('tp_b'), 'Improved to 85%') -> 'plans' -> 0 ->> 'status') = 'CLOSED',
  'HR closes the plan with remarks');

\echo '   who sees what'
select test.login('tp_b');
select test.check((tc_performance_profile(test.id('tp_b')) ->> 'isSelf')::boolean and jsonb_array_length(tc_performance_profile(test.id('tp_b')) -> 'reports') = 0
                    and jsonb_array_length(tc_performance_profile(test.id('tp_b')) -> 'plans') = 1, 'the Telecaller sees their own figures and plan, not HR''s report notes');
select test.must_fail($$select tc_performance_profile(test.id('tp_a'))$$, 'but not another Telecaller', 'not found');
select test.check(jsonb_array_length(tc_performance_list('{"weekStart":"2026-11-02"}') -> 'rows') = 1, 'their list holds only themselves');
select test.login('dh_wab');
select test.check(jsonb_array_length(tc_performance_list('{"weekStart":"2026-11-02"}') -> 'rows') = 0, 'another department''s head sees none of them');
select test.login('dh_wbx');
select test.check(jsonb_array_length(tc_performance_list('{"weekStart":"2026-11-02"}') -> 'rows') >= 5, 'the Department Head sees their department''s Telecallers');
select test.login('hr_head');
select test.check((select (c ->> 'low')::int >= 1 and (c ->> 'achieved')::int >= 1 and (c ->> 'insufficient')::int >= 2 from (select tc_performance_list('{"weekStart":"2026-11-02"}') -> 'cards' c) x),
  'HR''s cards count the categories');
select test.check((select bool_and(r -> 'unavailable' ? 'dispositions') from jsonb_array_elements(tc_performance_list('{"weekStart":"2026-11-02"}') -> 'rows') r),
  'what Crocodial does not provide is marked unavailable, not zero');
reset role;
update telecaller_review_policy set enabled = false, approved_at = null, approved_by = null where id;
delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_TPTEST';
delete from office_holidays where day = date '2026-11-06';

\echo '=== TELECALLER PERFORMANCE TESTS PASSED ==='
