-- =============================================================================
-- Internship reviews (20270312000400): an intern gets one internship cycle (3 months by default, or their own length), the same T-10 / T-4
-- reminders and evaluations as a confirmation review, and HR's outcomes: complete, convert to full-time (same record, a new probation cycle,
-- no paid leave, nothing confirmed), and never the probation-only decisions. Runs after hr_review_cycles_test.sql (its people and helpers).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 143. Internship reviews'
reset role;
\i supabase/migrations/20270312000100_employee_review_cycles.sql
\i supabase/migrations/20270312000400_internship_reviews.sql
\i supabase/migrations/20270312000400_internship_reviews.sql

do $$
begin
  if not exists (select 1 from test.users where name = 'in_one') then
    perform test.create_auth_user(n, n || '@in.example', jsonb_build_object('full_name', 'IN ' || initcap(replace(n, 'in_', ''))),
      jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')))
      from unnest(array['in_one', 'in_two', 'in_six']) n;
  end if;
end $$;
update profiles set status = 'ACTIVE' where id in (select id from test.users where name like 'in\_%');
delete from hr_probation_cycles where profile_id in (select id from test.users where name like 'in\_%');
delete from employee_personal_details where profile_id in (select id from test.users where name like 'in\_%');
insert into employee_personal_details (profile_id, joining_date) values
  (test.id('in_one'), date '2026-12-10'),   -- 3 months -> 10 Mar 2027
  (test.id('in_two'), date '2026-12-12'),   -- 12 Mar 2027
  (test.id('in_six'), date '2026-09-12');   -- their own 6-month internship -> 12 Mar 2027
delete from hr_employees where id in ('IN-1', 'IN-2', 'IN-6');
insert into hr_employees (id, name, email, status, profile_id, data)
select 'IN-' || x.n, p.full_name, p.email, 'Intern', p.id, x.data
  from (values ('1', 'in_one', '{}'::jsonb), ('2', 'in_two', '{}'::jsonb), ('6', 'in_six', '{"internshipMonths": "6"}'::jsonb)) x(n, who, data)
  join profiles p on p.id = test.id(x.who);
create or replace function test.icyc(p text, t text default 'INTERNSHIP') returns uuid language sql stable security definer as
  $$ select id from hr_probation_cycles where profile_id = test.id(p) and cycle_type = t order by created_at desc limit 1 $$;
create or replace function test.iceo(p text) returns uuid language sql stable security definer as
  $$ select ceo_reviewer_id from hr_probation_cycles where id = test.icyc(p) $$;
grant execute on function test.icyc(text, text) to authenticated;
grant execute on function test.iceo(text) to authenticated;

\echo '   opening and the reminders'
select test.sched(date '2027-03-01');
select test.check((select cycle_type = 'INTERNSHIP' and period_months = 3 and probation_end = date '2027-03-10' and employment_type = 'Intern'
                     from hr_probation_cycles where id = test.icyc('in_one')), 'an intern gets a 3-month internship cycle from the joining date');
select test.check((select period_months = 6 and probation_end = date '2027-03-12' from hr_probation_cycles where id = test.icyc('in_six')),
  'an intern''s own internship length (HR record) wins over the default');
select test.check(not exists (select 1 from hr_probation_cycles where profile_id = test.id('in_one') and cycle_type = 'PROBATION'), 'an intern gets no probation cycle');
select test.sched(date '2027-03-01');
select test.check((select count(*) = 1 from hr_probation_cycles where profile_id = test.id('in_one')), 'running the planner again opens no second cycle');
select test.check((select count(*) > 0 from hr_email_events where cycle_id = test.icyc('in_one') and kind = 'REVIEW_FIRST'), 'the first review reminder goes out (9 days left)');
select test.check(not exists (select 1 from hr_email_events where cycle_id = test.icyc('in_one') and kind = 'PROBATION_REMINDER_EMPLOYEE'),
  'the intern does not get the employee''s probation reminder');
select test.check((select dh_reviewer_id = test.id('dh_wbx') from hr_probation_cycles where id = test.icyc('in_one')), 'the Department Head is assigned as for a confirmation');

select test.check((select review_started_at is null from hr_probation_cycles where id = test.icyc('in_two')), 'eleven days before: the second intern''s review has not started');
select test.sched(date '2027-03-02');
select test.check((select review_started_at is not null from hr_probation_cycles where id = test.icyc('in_two')), 'ten days before, it starts');

\echo '   the reports and HR''s decision'
set role authenticated;
select test.login('dh_wbx');
select test.must_fail($$select hr_review_save(test.icyc('in_one'), 'DH', '{"ratings":{"learning":4},"recommendation":"CONFIRM","submit":true}')$$,
  'a probation recommendation is refused on an internship', 'recommend');
select test.check(hr_review_save(test.icyc('in_one'), 'DH', '{"ratings":{"learning":4,"fulltime_fit":5},"answers":{"strengths":"Quick learner"},"recommendation":"CONVERT","submit":true}')
  -> 'dh' ->> 'status' = 'SUBMITTED', 'the Department Head submits the internship evaluation');
select test.check(hr_review_save(test.icyc('in_two'), 'DH', '{"ratings":{"learning":3},"recommendation":"COMPLETE","submit":true}') -> 'dh' ->> 'status' = 'SUBMITTED',
  'and the second intern''s');
select test.as_id(test.iceo('in_one'));  -- the CEO the hierarchy assigned
select test.check(hr_review_save(test.icyc('in_one'), 'CEO', '{"ratings":{"overall":4},"recommendation":"CONVERT","submit":true}') -> 'ceo' ->> 'status' = 'SUBMITTED', 'the CEO submits');
select test.as_id(test.iceo('in_two'));
select test.check(hr_review_save(test.icyc('in_two'), 'CEO', '{"ratings":{"overall":3},"recommendation":"COMPLETE","submit":true}') -> 'ceo' ->> 'status' = 'SUBMITTED', 'for both');
select test.must_fail($$select hr_review_decide(test.icyc('in_one'), '{"decision":"CONVERT","reason":"Strong reports from both"}')$$,
  'the CEO does not take the final decision', 'Only the HR');
select test.login('in_one');
select test.must_fail($$select hr_review_detail(test.icyc('in_one'))$$, 'the intern cannot open their own review', 'not found');
select test.login('hr_head');
select test.must_fail($$select hr_review_decide(test.icyc('in_one'), '{"decision":"CONFIRM","reason":"Strong reports from both"}')$$,
  'an internship is never "confirmed"', 'Choose a decision');
select test.must_fail($$select hr_confirm_probation(test.icyc('in_one'))$$, 'nor through the old Confirm button', 'internship');
select test.must_fail($$select hr_review_decide(test.icyc('in_one'), '{"decision":"CONVERT","reason":"Strong reports from both","fullTimeEffectiveDate":"2026-12-01"}')$$,
  'the full-time date must be after the joining date', 'full-time effective date');
select test.check(hr_review_decide(test.icyc('in_one'), '{"decision":"CONVERT","reason":"Strong reports from both","probationMonths":3}') ->> 'status' = 'CONVERTED',
  'HR converts the intern to full-time');
select test.check(hr_review_decide(test.icyc('in_two'), '{"decision":"COMPLETE","reason":"Internship completed as planned"}') ->> 'status' = 'COMPLETED',
  'HR records a completed internship');
select test.must_fail($$select hr_review_decide(test.icyc('in_two'), '{"decision":"COMPLETE","reason":"Internship completed as planned"}')$$,
  'a decided internship cannot be decided again', 'already decided');
reset role;

\echo '   after the conversion'
select test.check((select status = 'Training / Probation' and data ->> 'fullTimeEffectiveDate' = '2027-03-11' from hr_employees where id = 'IN-1'),
  'the same HR record becomes a probationer, full-time from the day after the internship');
select test.check((select joining_date = date '2027-03-11' and probation_end = date '2027-06-11' and period_months = 3 and status = 'PENDING' and converted_from = test.icyc('in_one')
                     from hr_probation_cycles where id = test.icyc('in_one', 'PROBATION')), 'a full-time probation cycle starts, linked to the internship, for the chosen length');
select test.check((select status = 'CONVERTED' and decision = 'CONVERT' and completed_on = date '2027-03-10' from hr_probation_cycles where id = test.icyc('in_one')),
  'the internship is closed as converted');
select test.check((select status = 'Intern' from hr_employees where id = 'IN-2'), 'a completed internship changes nothing on the HR record');
select test.check(not exists (select 1 from hr_probation_cycles where id in (test.icyc('in_one'), test.icyc('in_two')) and status = 'APPROVED'),
  'an internship never becomes APPROVED (so it never starts paid leave)');
select test.sched(date '2027-03-12');
select test.check((select status = 'PENDING' from hr_probation_cycles where id = test.icyc('in_one', 'PROBATION'))
                  and (select count(*) = 2 from hr_probation_cycles where profile_id = test.id('in_one')),
  'the planner keeps the new probation cycle (not "joining date changed") and opens nothing else');
select test.check(exists (select 1 from audit_logs where action = 'INTERNSHIP_CONVERTED' and entity_id = test.icyc('in_one')), 'the conversion is audited');
select test.check(exists (select 1 from notifications where type = 'EMPLOYEE_REVIEW_DECIDED' and recipient_id = test.id('dh_wbx') and title like 'Intern converted%')
                  and not exists (select 1 from notifications where type = 'EMPLOYEE_REVIEW_DECIDED' and recipient_id = test.id('in_one')),
  'the reviewers are told; the intern does not get the management notification');

set role authenticated;
select test.login('hr_head');
select test.check(exists (select 1 from jsonb_array_elements(hr_reviews_list('{"type":"INTERNSHIP"}') -> 'rows') r where r ->> 'id' = test.icyc('in_one')::text and r ->> 'status' = 'CONVERTED'),
  'HR''s Internship Reviews list shows the outcome');
select test.check(not exists (select 1 from jsonb_array_elements(hr_reviews_list('{"type":"PROBATION"}') -> 'rows') r where r ->> 'cycleType' = 'INTERNSHIP'),
  'and the confirmation list holds no internships');
select test.login('dh_wab');
select test.check(not exists (select 1 from jsonb_array_elements(hr_review_my_queue() -> 'rows') r where r ->> 'id' = test.icyc('in_six')::text),
  'another department''s head never sees the internship');
reset role;
delete from hr_probation_cycles where profile_id in (select id from test.users where name like 'in\_%');
delete from hr_employees where id in ('IN-1', 'IN-2', 'IN-6');

\echo '=== INTERNSHIP REVIEW TESTS PASSED ==='
