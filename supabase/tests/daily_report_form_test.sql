-- =============================================================================
-- One Daily Report form for every department (migration 20270312000100): Work Completed required (10 to 150 words), Work Pending (100), Additional Note (50),
-- for the Task Daily Report, AI Studio, AI Design Studio and the work report of the Reports menu.
-- Runs after daily_report_fields_test; uses th_wab (Wabastore Sales Team Lead), ai_tm1b (AI Studio member), ads_m0 (AI Design Studio member). Creates its own
-- Wabastore member (drf2_m). Report dates used: today (task report, work report), 24 days back (AI Studio).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Daily Report form: Work Completed required, 10 to 150 words, every department'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of these functions again: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270312000100_daily_report_form.sql
\i supabase/migrations/20270312000100_daily_report_form.sql

create or replace function test.dw(n integer) returns text language sql immutable as $$ select string_agg('word' || g, ' ') from generate_series(1, n) g $$;
create or replace function test.dtoday() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
create table if not exists drf2 (k text primary key, v uuid);
grant all on drf2 to authenticated;
create or replace function test.drf2(p text) returns uuid language sql stable security definer set search_path = '' as $$ select v from public.drf2 where k = p $$;
create or replace function test.login_uuid(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, false) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
delete from public.ai_studio_daily_reports where author_id = test.id('ai_tm1b') and report_date = test.dtoday() - 24;

\echo '   the rules (words, not characters)'
select private.report_word_limits(test.dw(10), null, null);
select private.report_word_limits(test.dw(150), test.dw(100), test.dw(50));
select test.check(true, 'Work Completed with 10 or 150 words is accepted (with Work Pending 100 and the Additional Note 50)');
select test.must_fail($$select private.report_word_limits(test.dw(9), null, null)$$, 'Work Completed with 9 words is refused', 'Write at least 10 words in Work Completed .now 9');
select test.must_fail($$select private.report_word_limits(null, 'Call the customers back tomorrow morning', null)$$, 'Work Completed is required', 'Write at least 10 words in Work Completed .now 0');
select test.must_fail($$select private.report_word_limits(test.dw(151), null, null)$$, 'Work Completed with 151 words is refused', 'at most 150 words');
select test.must_fail($$select private.report_word_limits(test.dw(10), test.dw(101), null)$$, 'Work Pending with 101 words is refused', 'Work Pending can have at most 100 words');
select test.must_fail($$select private.report_word_limits(test.dw(10), null, test.dw(51))$$, 'an Additional Note with 51 words is refused', 'Additional Note can have at most 50 words');
select test.must_fail($$select private.report_word_limits(repeat('x', 200), null, null)$$, 'a long run of characters is one word', 'Write at least 10 words');
select private.report_word_max(null, null, null);
select private.report_word_max('Short', null, null);
select test.check(true, 'the maximums alone accept a short or empty draft');

\echo '   Task Daily Report (Sales, Support and the other departments)'
select test.create_auth_user('drf2_m', 'drf2.m@amuwa.com', '{"full_name":"DRF2 Member"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
insert into drf2 select 'lead', private.direct_lead_of(test.id('drf2_m'));
select test.check(test.drf2('lead') is not null, 'fixtures: the member has a Team Lead');
with x as (
  insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, progress, status, due_date, created_at)
  values (test.dept('wabastore'), test.team('wabastore', 'Sales'), 'DRF2 renewal list', test.drf2('lead'), test.id('drf2_m'), 30, 'IN_PROGRESS', test.dtoday() + 3, now() - interval '3 days')
  returning id)
insert into drf2 select 'task', id from x;
set role authenticated;
select test.login('drf2_m');
select test.must_fail($$select task_report_submit(test.drf2('task'), test.dtoday(), null, null, 'Call the last ten customers', null, null)$$,
  'a report with only Work Pending is refused now', 'Write at least 10 words in Work Completed');
select test.must_fail($$select task_report_submit(test.drf2('task'), test.dtoday(), 'Called four customers', null)$$, 'Work Completed with 3 words is refused', 'now 3');
insert into drf2 select 'tr', (task_report_submit(test.drf2('task'), test.dtoday(), test.dw(12), null, 'Call the last ten customers', null, 'Two want a demo') ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING' and pending_work = 'Call the last ten customers' and remarks = 'Two want a demo' from public.task_daily_reports where id = test.drf2('tr')),
  'a report with Work Completed (12 words) is submitted to the Team Lead');
set role authenticated;
select test.login_uuid(test.drf2('lead'));
select test.must_fail($$select task_report_reviewer_edit(test.drf2('tr'), 'Called them', null, null, null, null, 'Shortened it')$$,
  'the Team Lead''s correction keeps the minimum', 'Write at least 10 words in Work Completed');
select test.check((task_report_review(test.drf2('tr'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'the Team Lead approves it as before');
reset role;

\echo '   AI Studio daily report'
set role authenticated;
select test.login('ai_tm1b');
select test.must_fail($$select ai_studio_daily_report_save(null, test.dtoday() - 24, '{}'::uuid[], 'Fixed the login bug', null, null, null, null, true)$$,
  'Work Completed with 4 words is refused', 'Write at least 10 words in Work Completed');
-- a draft may be short
insert into drf2 select 'ai', (ai_studio_daily_report_save(null, test.dtoday() - 24, '{}'::uuid[], 'Fixed the login bug', null, null, null, null, false) ->> 'id')::uuid;
select test.check(test.drf2('ai') is not null, 'a short draft is saved');
select test.check((ai_studio_daily_report_save(test.drf2('ai'), test.dtoday() - 24, '{}'::uuid[], test.dw(11), 'Write the tests', null, null, 'Short day', true) ->> 'status') = 'PENDING_TL_APPROVAL',
  'with 11 words it is submitted to the Team Lead');
reset role;
select test.must_fail($$update public.ai_studio_daily_reports set work_completed = 'Too short now' where id = test.drf2('ai')$$, 'a correction below the minimum is refused (the trigger)', 'Write at least 10 words');

\echo '   AI Design Studio daily report'
set role authenticated;
select test.login('ads_m0');
select test.must_fail($$select ads_report_submit(jsonb_build_object('pendingWork', 'Finish the second logo', 'clientRequestId', 'drf2-pending'))$$,
  'a report without Work Completed is refused now', 'Write at least 10 words in Work Completed');
select test.check((ads_report_submit(jsonb_build_object('workCompleted', test.dw(10), 'remarks', 'Waiting for the colours', 'clientRequestId', 'drf2-ok')) ->> 'id') is not null,
  'with 10 words it is submitted');
reset role;

\echo '   the work report (Reports menu)'
set role authenticated;
select test.login('drf2_m');
select test.must_fail($$select work_report_save(null, 'Daily report', test.dtoday(), 'DAILY', test.dtoday(), test.dtoday(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.drf2('task')), 'workCompleted', test.dw(151)))$$, 'a draft over a maximum is refused on save', 'at most 150 words');
insert into drf2 select 'wr', (work_report_save(null, 'Daily report', test.dtoday(), 'DAILY', test.dtoday(), test.dtoday(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.drf2('task')), 'workCompleted', 'Called four customers', 'pendingWork', 'Six more', 'remarks', 'Busy day')) ->> 'id')::uuid;
select test.check(test.drf2('wr') is not null, 'a short draft is saved');
reset role;
select test.check((select content ->> 'workCompleted' = 'Called four customers' and content ->> 'pendingWork' = 'Six more' and content ->> 'remarks' = 'Busy day'
                          and jsonb_array_length(content -> 'assignedTasks') = 1 from public.work_reports where id = test.drf2('wr')),
  'the three fields are stored with the tasks');
set role authenticated;
select test.login('drf2_m');
select test.must_fail($$select work_report_submit(test.drf2('wr'))$$, 'submitting it with 3 words is refused', 'Write at least 10 words in Work Completed');
select work_report_save(test.drf2('wr'), 'Daily report', test.dtoday(), 'DAILY', test.dtoday(), test.dtoday(),
  jsonb_build_object('assignedTasks', jsonb_build_array(test.drf2('task')), 'workCompleted', test.dw(14), 'remarks', 'Busy day'));
select test.check((work_report_submit(test.drf2('wr')) ->> 'status') = 'SUBMITTED', 'with 14 words it is submitted to the Team Lead');
reset role;
select test.check((select content ->> 'pendingWork' is null and content ->> 'remarks' = 'Busy day' and team_lead_id = test.drf2('lead') from public.work_reports where id = test.drf2('wr')),
  'clearing Work Pending removes it; the report waits for the member''s Team Lead');

delete from public.task_daily_reports where id = test.drf2('tr');
delete from public.work_tasks where id = test.drf2('task');
select set_config('request.jwt.claims', '', false);
\echo '=== DAILY REPORT FORM TESTS PASSED ==='
