-- =============================================================================
-- International and Reseller: the Team Lead alone evaluates members (migration 20270210000100). The whole workflow for these departments runs in
-- task_daily_reports_flow.sql (strict branch, from task_daily_reports_performance_test.sql, which must run first: its people and records are used here).
-- This file covers what that flow does not reach:
--   * a member with no Team Lead: the Department Head does not decide their report or performance; the report waits and the Team Lead named later decides;
--   * who may read a person's evaluation history (all periods);
--   * the screen flags (who decides members, rating required) and an ordinary department that keeps the earlier behaviour.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 191. International and Reseller: Team Lead evaluates members, Department Head evaluates Team Leads'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270210000100_unified_performance_hierarchy.sql

\echo '   the migration'
select test.check((select count(*) = 1 from pg_proc where proname = 'performance_record_review' and pronamespace = 'public'::regnamespace), 'one performance_record_review (the 4-argument version was replaced)');
select test.check(not has_function_privilege('anon', 'public.performance_subject_history(uuid)', 'execute') and has_function_privilege('authenticated', 'public.performance_subject_history(uuid)', 'execute')
                  and not has_function_privilege('authenticated', 'private.perf2_strict(uuid)', 'execute'), 'grants: signed-in users call the public functions only');
select test.check(private.perf2_strict(test.dept('international')) and private.perf2_strict(test.dept('reseller')) and not private.perf2_strict(test.dept('tdr-a')) and not private.perf2_strict(test.dept('wabastore')),
  'the strict hierarchy applies to International and Reseller only');
select test.must_fail($$update performance_records set rating = 6 where id = (select id from performance_records limit 1)$$, 'a rating is 1 to 5 in the table too', 'rating_check');

-- a member with nobody to lead them: International has two Team Leads in its one team, so a new member is not given one automatically
delete from task_daily_reports where task_id in (select id from work_tasks where title like 'UPH %');
delete from work_tasks where title like 'UPH %';
delete from auth.users where email = 'ud.i_m_x@example.com';
delete from test.users where name = 'i_m_x';
select test.ud_user('i_m_x', 'TEAM_MEMBER', 'international', 'sa');
update profiles set manager_id = null where id = test.id('i_m_x');
select test.check(private.direct_lead_of(test.id('i_m_x')) is null, 'a member without a Team Lead (two Team Leads in the team, none named)');
create temp table uph (k text primary key, v uuid);
grant all on uph to authenticated;
with ins as (
  insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date)
  select p.department_id, p.team_id, 'UPH unled follow-up list', test.id('i_head'), p.id, current_date + 3 from profiles p where p.id = test.id('i_m_x')
  returning id) insert into uph select 'T', id from ins;

\echo '   no Team Lead: the Department Head does not stand in'
set role authenticated;
select test.login('i_m_x');
insert into uph select 'R', (task_report_submit((select v from uph where k = 'T'), current_date, 'Prepared the follow-up list for March', 50, 'Call the first ten names') ->> 'id')::uuid;
select test.check((select status = 'PENDING' from task_daily_reports where id = (select v from uph where k = 'R')), 'the member still submits the report (it waits)');
select test.must_fail($$select performance_overview(current_date - 30, current_date + 30)$$, 'and has no performance view', 'for Team Leads and Department Heads');
select test.login('i_head');
select test.check((select (i ->> 'canReview')::boolean = false from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where i ->> 'id' = (select v::text from uph where k = 'R')),
  'the Department Head reads the report but may not decide it');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from uph where k = 'R')), 'the Department Head cannot approve a member''s report', 'Team Lead');
select test.check((select (j ->> 'leadDecidesMembers')::boolean
                          and exists (select 1 from jsonb_array_elements(j -> 'unassignedMembers') x where x ->> 'id' = test.id('i_m_x')::text and (x #>> '{record,canDecide}')::boolean = false)
                     from (select performance_overview(current_date - 30, current_date + 30) j) o),
  'the head''s overview lists the member under "without a Team Lead", read only, and says the Team Lead decides members');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'Head approval', null, 3)$$, (select id from performance_records where subject_id = test.id('i_m_x') limit 1)),
  'nor approve that member''s performance', 'Only the Team Lead');
select test.login('i_lead_a');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from uph where k = 'R')), 'a Team Lead who is not theirs cannot decide', 'not found');

\echo '   the checks never return null (a member without a Team Lead made them null, and `if not null` let callers through)'
reset role;
insert into uph select 'P', id from performance_records where subject_id = test.id('i_m_x') order by period_start desc limit 1;
select test.check((select v from uph where k = 'P') is not null, 'the member''s performance record exists (created by the head''s overview)');
-- run as the owner with each caller's login, so the private checks themselves can be read
select test.login('i_m_a1');
select test.check(private.tdr_reviews(test.id('i_m_x'), test.dept('international'), null) is false and private.tdr_can_view(test.id('i_m_x'), test.dept('international'), null) is false
                  and private.perf2_can_view(test.id('i_m_x'), 'TEAM_MEMBER', test.dept('international'), null) is false, 'a colleague: every check is false (not null)');
select test.login('sa');
select test.check(private.tdr_reviews(test.id('i_m_x'), test.dept('international'), null) is false, 'the Super Admin: may not decide (false, not null)');
select test.login('i_head');
select test.check(private.tdr_reviews(test.id('i_m_x'), test.dept('international'), null) is false and private.perf2_can_view(test.id('i_m_x'), 'TEAM_MEMBER', test.dept('international'), null) is true,
  'the Department Head: reads, may not decide');
select set_config('request.jwt.claims', '', false);
set role authenticated;
select test.login('i_m_a1');
select test.must_fail(format($$select task_report_get(%L)$$, (select v from uph where k = 'R')), 'a colleague cannot open the report of a member without a Team Lead', 'not found');
select test.must_fail(format($$select performance_record_history(%L)$$, (select v from uph where k = 'P')), 'nor read their performance history', 'not found');
select test.check((select count(*) = 0 from task_daily_reports where author_id = test.id('i_m_x')), 'nor see the report through the table');
select test.login('i_lead_b');
select test.must_fail(format($$select performance_record_history(%L)$$, (select v from uph where k = 'P')), 'another Team Lead cannot read that history', 'not found');
select test.login('sa');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from uph where k = 'R')), 'the Super Admin reads but does not decide the report', 'Team Lead');

\echo '   a Team Lead is named: the waiting report is theirs to decide'
reset role;
update profiles set manager_id = test.id('i_lead_a') where id = test.id('i_m_x');
set role authenticated;
select test.login('i_lead_a');
select test.check((task_report_review((select v from uph where k = 'R'), 'APPROVE', 'Good start') ->> 'status') = 'APPROVED', 'the newly named Team Lead approves the waiting report');
select test.check((select x #>> '{record,status}' = 'PENDING' and (x #>> '{record,canDecide}')::boolean and (x #>> '{record,ratingRequired}')::boolean
                     from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') x where x ->> 'id' = test.id('i_m_x')::text),
  'and now evaluates the member''s performance (rating required)');

\echo '   evaluation history: Team Lead and Department Head, nobody else'
select test.check((performance_subject_history(test.id('i_m_x')) ->> 'name') is not null, 'the Team Lead reads their member''s evaluation history');
select test.login('i_lead_b');
select test.must_fail(format($$select performance_subject_history(%L)$$, test.id('i_m_a1')), 'another Team Lead does not', 'not found');
select test.login('i_head');
select test.check(jsonb_array_length(performance_subject_history(test.id('i_m_a1')) -> 'records') >= 1 and jsonb_array_length(performance_subject_history(test.id('i_lead_a')) -> 'records') >= 1,
  'the Department Head reads the members'' and the Team Leads'' history');
select test.must_fail(format($$select performance_subject_history(%L)$$, test.id('r_m_a1')), 'but not another department''s', 'not found');
select test.login('r_head');
select test.must_fail(format($$select performance_subject_history(%L)$$, test.id('i_lead_a')), 'Reseller''s head reads nothing of International', 'not found');
select test.login('r_m_a1');
select test.must_fail(format($$select performance_subject_history(%L)$$, test.id('r_m_a1')), 'a Reseller member does not read their own history', 'not found');
select test.check((select count(*) = 0 from performance_records) and (select count(*) = 0 from performance_record_history), 'nor any record or history row (row level security)');
select test.login('sa');
select test.check(jsonb_array_length(performance_subject_history(test.id('i_m_a1')) -> 'records') >= 1, 'the Super Admin reads every history');

\echo '   an ordinary department keeps the earlier rules'
select test.login('tdr_m1');
select test.check((performance_overview(current_date - 30, current_date + 30) ->> 'role') = 'TEAM_MEMBER', 'its member still opens their own performance');
select test.check((performance_subject_history(test.id('tdr_m1')) ->> 'id') = test.id('tdr_m1')::text, 'and reads their own history');
select test.login('tdr_dha');
select test.check((performance_overview(current_date - 30, current_date + 30) ->> 'leadDecidesMembers')::boolean = false, 'its Department Head still stands in for members without a Team Lead');
select test.check((select bool_and((x #>> '{record,ratingRequired}')::boolean = false) from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'leads') x where x -> 'record' <> 'null'::jsonb),
  'and the rating is optional there');
reset role;
-- leave International as the other suites expect it (their counts are exact): this file's member, task, report and record go
select set_config('request.jwt.claims', '', false);
delete from task_daily_reports where task_id in (select id from work_tasks where title like 'UPH %');
delete from performance_records where subject_id = test.id('i_m_x');
delete from work_tasks where title like 'UPH %';
delete from auth.users where email = 'ud.i_m_x@example.com';
delete from test.users where name = 'i_m_x';
\echo '=== UNIFIED PERFORMANCE HIERARCHY TESTS PASSED ==='
