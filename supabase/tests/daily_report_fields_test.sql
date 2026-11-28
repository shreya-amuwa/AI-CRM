-- =============================================================================
-- Daily reports, every department: Work Completed (150 words), Work Pending (100), Additional Note (50), all optional (migration 20270308000100).
-- Runs after the AI Studio, AI Design Studio and task report suites; uses their people: th_wab (Wabastore Sales Team Lead), ai_tm1b / ai_tl1 (AI Studio),
-- ads_m0 (AI Design Studio member). Creates its own Wabastore member (drf_m). Report dates used: today (task report), 26-27 days back (AI Studio).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Daily reports: three fields with word limits, every department'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of these functions again: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270308000100_daily_report_three_fields.sql
\i supabase/migrations/20270308000100_daily_report_three_fields.sql

create or replace function test.dw(n integer) returns text language sql immutable as $$ select string_agg('word' || g, ' ') from generate_series(1, n) g $$;
create or replace function test.dtoday() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create table if not exists drf (k text primary key, v uuid);
grant all on drf to authenticated;
create or replace function test.drf(p text) returns uuid language sql stable security definer set search_path = '' as $$ select v from public.drf where k = p $$;
create or replace function test.login_uuid(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
delete from public.ai_studio_daily_reports where author_id = test.id('ai_tm1b') and report_date in (test.dtoday() - 26, test.dtoday() - 27);

\echo '   the word limits (words, not characters)'
select private.report_word_limits(test.dw(150), test.dw(100), test.dw(50));
select test.check(true, '150 / 100 / 50 words are accepted');
select test.must_fail($$select private.report_word_limits(test.dw(151), null, null)$$, 'Work Completed: 151 words are refused', 'Work Completed can have at most 150 words');
select test.must_fail($$select private.report_word_limits(null, test.dw(101), null)$$, 'Work Pending: 101 words are refused', 'Work Pending can have at most 100 words');
select test.must_fail($$select private.report_word_limits(null, null, test.dw(51))$$, 'Additional Note: 51 words are refused', 'Additional Note can have at most 50 words');
select private.report_word_limits(repeat('x', 2000), null, null);
select test.check(true, 'a long run of characters is one word');

\echo '   Task Daily Report (Sales, Support and the other departments)'
select test.create_auth_user('drf_m', 'drf.m@amuwa.com', '{"full_name":"DRF Member"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
insert into drf select 'lead', private.direct_lead_of(test.id('drf_m'));
select test.check(test.drf('lead') is not null, 'fixtures: the member has a Team Lead');
with x as (
  insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, progress, status, due_date, created_at)
  values (test.dept('wabastore'), test.team('wabastore', 'Sales'), 'DRF follow-up list', test.drf('lead'), test.id('drf_m'), 40, 'IN_PROGRESS', test.dtoday() - 1, now() - interval '3 days')
  returning id)
insert into drf select 'task', id from x;
set role authenticated;
select test.login('drf_m');
select test.must_fail($$select task_report_submit(test.drf('task'), test.dtoday(), '', null)$$, 'an empty report is refused', 'Write the work completed');
select test.must_fail($$select task_report_submit(test.drf('task'), test.dtoday(), test.dw(151), null)$$, 'Work Completed over 150 words is refused', 'at most 150 words');
select test.must_fail($$select task_report_submit(test.drf('task'), test.dtoday(), null, null, test.dw(101))$$, 'Work Pending over 100 words is refused', 'at most 100 words');
select test.must_fail($$select task_report_submit(test.drf('task'), test.dtoday(), null, null, null, null, test.dw(51))$$, 'an Additional Note over 50 words is refused', 'at most 50 words');
-- one field is enough; no progress, no pending work below 100%, no reason for delay on an overdue task
insert into drf select 'r', (task_report_submit(test.drf('task'), test.dtoday(), null, null, 'Call the last ten customers', null, null) ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING' and work_completed is null and pending_work = 'Call the last ten customers' and progress = 40 and delay_reason is null and field_word_limits
                     from public.task_daily_reports where id = test.drf('r')),
  'a report with only Work Pending is submitted: it keeps the task''s own progress (40%), no reason for delay is needed past the deadline');
select test.check((select reviewer_id = test.drf('lead') from public.task_daily_reports where id = test.drf('r')), 'and it waits for the member''s Team Lead (the workflow is unchanged)');
-- the Team Lead corrects it within the same limits, and approves it as before
set role authenticated;
select test.login_uuid(test.drf('lead'));
select test.must_fail($$select task_report_reviewer_edit(test.drf('r'), test.dw(151), null, null, null, null, 'Shortened')$$, 'the Team Lead''s correction keeps the limits', 'at most 150 words');
select test.check((task_report_reviewer_edit(test.drf('r'), 'Called fifteen customers', null, 'Call the last ten customers', null, 'Two asked for a demo', 'Added the work done') ->> 'progress')::int = 40,
  'the Team Lead adds Work Completed and an Additional Note; the progress stays');
select test.check((task_report_review(test.drf('r'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'and approves it');
reset role;
select test.check((select work_completed = 'Called fifteen customers' and remarks = 'Two asked for a demo' and status = 'APPROVED' from public.task_daily_reports where id = test.drf('r')),
  'the approved report has the three fields');

\echo '   AI Studio daily report'
set role authenticated;
select test.login('ai_tm1b');
select test.must_fail($$select ai_studio_daily_report_save(null, test.dtoday() - 26, '{}'::uuid[], test.dw(151), null, null, null, null, true)$$, 'Work Completed over 150 words is refused', 'at most 150 words');
select test.must_fail($$select ai_studio_daily_report_save(null, test.dtoday() - 26, '{}'::uuid[], 'Fixed the login bug', test.dw(101), null, null, null, true)$$, 'Work Pending over 100 words is refused', 'at most 100 words');
select test.must_fail($$select ai_studio_daily_report_save(null, test.dtoday() - 26, '{}'::uuid[], 'Fixed the login bug', null, null, null, test.dw(51), true)$$, 'an Additional Note over 50 words is refused', 'at most 50 words');
select test.must_fail($$select ai_studio_daily_report_save(null, test.dtoday() - 26, '{}'::uuid[], null, 'Tests', null, null, null, true)$$,
  'with no task, Work Completed says what was done (unchanged rule)', 'Select a task with work recorded');
insert into drf select 'ai', (ai_studio_daily_report_save(null, test.dtoday() - 26, '{}'::uuid[], 'Fixed the login bug', 'Write the tests', null, null, 'Short day', true) ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING_TL_APPROVAL' and work_description is null and not description_required and field_word_limits
                     and work_completed = 'Fixed the login bug' and pending_work = 'Write the tests' and remarks = 'Short day'
                     from public.ai_studio_daily_reports where id = test.drf('ai')),
  'a report with the three fields and no description is submitted to the Team Lead');
-- the Team Lead's correction of a waiting report keeps the limits (the database refuses it whatever function changes the text)
select test.must_fail($$update public.ai_studio_daily_reports set remarks = test.dw(51) where id = test.drf('ai')$$, 'a correction over a limit is refused', 'at most 50 words');
set role authenticated;
select test.login('ai_tl1');
select test.check((ai_studio_report_review(test.drf('ai'), 'APPROVE') ->> 'status') = 'PENDING_DH_APPROVAL', 'the Team Lead approves it as before');
reset role;
select test.check((select hr_sent_at is not null from public.ai_studio_daily_reports where id = test.drf('ai')), 'and it is sent to HR as before');

\echo '   AI Design Studio daily report'
set role authenticated;
select test.login('ads_m0');
select test.must_fail($$select ads_report_submit(jsonb_build_object('clientRequestId', 'drf-empty'))$$, 'an empty report is refused', 'Write the work completed');
select test.must_fail($$select ads_report_submit(jsonb_build_object('workCompleted', test.dw(151), 'clientRequestId', 'drf-long'))$$, 'Work Completed over 150 words is refused', 'at most 150 words');
select test.must_fail($$select ads_report_submit(jsonb_build_object('remarks', test.dw(51), 'clientRequestId', 'drf-note'))$$, 'an Additional Note over 50 words is refused', 'at most 50 words');
insert into drf select 'ads', (ads_report_submit(jsonb_build_object('pendingWork', 'Finish the second logo', 'remarks', 'Waiting for the colours', 'clientRequestId', 'drf-ok')) ->> 'id')::uuid;
reset role;
select test.check((select work_completed is null and pending_work = 'Finish the second logo' and remarks = 'Waiting for the colours' and status like 'PENDING%' from public.ads_reports where id = test.drf('ads')),
  'a report without Work Completed is submitted (all three are optional)');

delete from public.task_daily_reports where id = test.drf('r');
delete from public.work_tasks where id = test.drf('task');
select set_config('request.jwt.claims', '', false);
\echo '=== DAILY REPORT FIELDS TESTS PASSED ==='
