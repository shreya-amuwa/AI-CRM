-- =============================================================================
-- AI Studio consolidated daily reports (migration 20270219000100): a report built from the work already recorded on the tasks.
-- Uses the AI Studio people of ai_studio_test.sql: ai_tl1 (Team Lead of ai_tm1a / ai_tm1b), ai_tl2 (another Team Lead), ai_dh.
-- Past days are written straight into the history (as the table owner) so the dates are exact; today's work goes through the app's functions.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 150. AI Studio daily reports built from the tasks'
reset role;
\i supabase/migrations/20270219000100_ai_studio_consolidated_reports.sql
\i supabase/migrations/20270219000100_ai_studio_consolidated_reports.sql
-- (20270302000100) the later migration replaces some of these functions (the description, Reject, Sent to HR): apply it again on top
\i supabase/migrations/20270302000100_ai_studio_hr_performance.sql

create or replace function test.ist(p_day integer, p_time text) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_day) + p_time::time) at time zone 'Asia/Kolkata' $$;
create or replace function test.d(p_day integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date + p_day $$;
create or replace function test.dtask(p_title text) returns uuid language sql stable security definer as $$ select id from public.ai_studio_tasks where title = p_title $$;
create temp table dr_t (name text primary key, id uuid);
grant all on dr_t to authenticated;
create or replace function test.drep(p_name text) returns uuid language sql stable as $$ select id from dr_t where name = p_name $$;
grant execute on all functions in schema test to anon, authenticated;

delete from public.ai_studio_daily_reports where author_id in (test.id('ai_tm1a'), test.id('ai_tm1b')) and project_id is null;
delete from public.ai_studio_tasks where title like 'DR %';

-- ---- the tasks and their history (three days ago .. yesterday) ----
insert into public.ai_studio_tasks (project_id, title, description, priority, assigned_by, assignee_id, status, progress, started_at, last_update_note, last_update_at, attachments, created_at)
values (test.proj('AI CRM'), 'DR Website Development', 'Build the website', 'HIGH', test.id('ai_tl1'), test.id('ai_tm1a'), 'IN_PROGRESS', 80, test.ist(-3, '10:00'),
        'Screenshot uploaded', test.ist(-1, '15:00'), '["https://github.com/amuwa/site/pull/1"]', test.ist(-3, '09:00'));
insert into public.ai_studio_tasks (project_id, title, description, priority, assigned_by, assignee_id, status, progress, started_at, completed_at, completion_note, attachments, created_at)
values (test.proj('AI Website'), 'DR Blockers to be found', 'Find the campaign blockers', 'MEDIUM', test.id('ai_tl2'), test.id('ai_tm1a'), 'COMPLETED', 100, test.ist(-2, '11:00'), test.ist(-1, '12:13'),
        E'1. Leads responding positively were still receiving follow-ups.\n2. Leads saying Stop still received messages.\n3. Silent leads kept getting messages after Day 21.\n4. Campaign failure alerts were required.',
        '["https://ai-crm.vercel.app/preview"]', test.ist(-3, '09:00'));
insert into public.ai_studio_tasks (project_id, title, priority, assigned_by, assignee_id, status, progress, created_at)
values (test.proj('AI CRM'), 'DR Not started', 'LOW', test.id('ai_tl1'), test.id('ai_tm1a'), 'ASSIGNED', 0, test.ist(-3, '09:00'));
insert into public.ai_studio_tasks (project_id, title, priority, assigned_by, assignee_id, status, progress, completed_at, completion_note, created_at)
values (test.proj('AI CRM'), 'DR Finished last week', 'LOW', test.id('ai_tl1'), test.id('ai_tm1a'), 'COMPLETED', 100, test.ist(-6, '10:00'), 'Done long ago', test.ist(-9, '09:00'));
insert into public.ai_studio_tasks (project_id, title, priority, assigned_by, assignee_id, status, progress, created_at)
values (test.proj('AI CRM'), 'DR Someone else', 'LOW', test.id('ai_tl1'), test.id('ai_tm1b'), 'IN_PROGRESS', 30, test.ist(-3, '09:00'));

insert into public.ai_studio_task_updates (task_id, author_id, author_name, kind, status, progress, note, links, created_at) values
  (test.dtask('DR Website Development'), test.id('ai_tl1'), 'AI Lead One', 'ASSIGNED', 'ASSIGNED', 0, null, null, test.ist(-3, '09:00')),
  (test.dtask('DR Website Development'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'IN_PROGRESS', 20, 'Set up the project', null, test.ist(-3, '18:00')),
  (test.dtask('DR Website Development'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'IN_PROGRESS', 50, 'Homepage integration completed.', null, test.ist(-2, '17:00')),
  (test.dtask('DR Website Development'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'IN_PROGRESS', 60, 'Mobile responsiveness completed.', '["https://github.com/amuwa/site/pull/1"]', test.ist(-1, '10:00')),
  (test.dtask('DR Website Development'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'IN_PROGRESS', 80, 'Supporting screenshot uploaded.', null, test.ist(-1, '15:00')),
  (test.dtask('DR Blockers to be found'), test.id('ai_tl2'), 'AI Lead Two', 'ASSIGNED', 'ASSIGNED', 0, null, null, test.ist(-3, '09:00')),
  (test.dtask('DR Blockers to be found'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'IN_PROGRESS', 40, 'Reviewing the campaign logs.', null, test.ist(-2, '11:00')),
  (test.dtask('DR Blockers to be found'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'COMPLETED', 100,
     E'1. Leads responding positively were still receiving follow-ups.\n2. Leads saying Stop still received messages.\n3. Silent leads kept getting messages after Day 21.\n4. Campaign failure alerts were required.',
     '["https://ai-crm.vercel.app/preview"]', test.ist(-1, '12:13')),
  (test.dtask('DR Not started'), test.id('ai_tl1'), 'AI Lead One', 'ASSIGNED', 'ASSIGNED', 0, null, null, test.ist(-3, '09:00')),
  (test.dtask('DR Finished last week'), test.id('ai_tm1a'), 'AI Member 1A', 'PROGRESS', 'COMPLETED', 100, 'Done long ago', null, test.ist(-6, '10:00')),
  (test.dtask('DR Someone else'), test.id('ai_tm1b'), 'AI Member 1B', 'PROGRESS', 'IN_PROGRESS', 30, 'Private work of 1B', null, test.ist(-1, '11:00'));

select test.check(test.sq($q$select count(*)::text from ai_studio_task_updates$q$) is not null, 'the history is in place');

\echo '   the history is write-once, and each entry belongs to its task'
select test.must_fail($$update public.ai_studio_task_updates set note = 'rewritten' where task_id = test.dtask('DR Website Development')$$, 'a history entry cannot be rewritten (a report points at it)', 'cannot be changed');

-- ---------------------------------------------------------------------------------------------------------------------------------------------
\echo '   choosing the tasks for a date'
-- (20270302000100) submitting a daily report needs a Daily Work Description of 10-150 words
create or replace function test.desc10() returns text language sql immutable as $$ select 'Worked on the website module, fixed the layout bugs and reviewed the open tasks today.' $$;
grant execute on function test.desc10() to authenticated;
set role authenticated;
select test.login('ai_tm1a');
create temp table dr_opts as select ai_studio_daily_report_options(test.d(-1)) j;
select test.check((select count(*) = 3 from jsonb_array_elements((select j from dr_opts) -> 'tasks') t where t ->> 'title' like 'DR %'),
  'yesterday: the open task, the task completed that day, and the untouched task are offered');
select test.check(not exists (select 1 from jsonb_array_elements((select j from dr_opts) -> 'tasks') t where t ->> 'title' in ('DR Finished last week', 'DR Someone else')),
  'a task completed before that day and another person''s task are not');
select test.check((select (t ->> 'crossTeam')::boolean and t ->> 'assignedByName' = 'AI Lead Two' from jsonb_array_elements((select j from dr_opts) -> 'tasks') t where t ->> 'title' = 'DR Blockers to be found'),
  'a task given by another Team Lead is marked cross-team');
select test.check((select (t ->> 'updatesOnDate')::int = 2 from jsonb_array_elements((select j from dr_opts) -> 'tasks') t where t ->> 'title' = 'DR Website Development'),
  'and the number of updates I recorded that day is shown');
select test.check((select count(*) >= 1 from jsonb_array_elements(ai_studio_daily_report_options(test.d(0)) -> 'tasks') t where t ->> 'title' = 'DR Blockers to be found') = false,
  'today: the task completed yesterday is no longer offered');
select test.must_fail($$select ai_studio_daily_report_options(test.d(1))$$, 'a future date is refused', 'future');

\echo '   the report is built from the recorded work (Test 01, 02, 06, 08, 15)'
create temp table dr_prev as select ai_studio_daily_report_preview(test.d(-1), array[test.dtask('DR Website Development'), test.dtask('DR Blockers to be found'), test.dtask('DR Not started')]) j;
grant select on dr_prev, dr_opts to authenticated;
select test.check(((select j from dr_prev) -> 'summary' ->> 'projects')::int = 2 and ((select j from dr_prev) -> 'summary' ->> 'tasks')::int = 3
  and ((select j from dr_prev) -> 'summary' ->> 'completed')::int = 1 and ((select j from dr_prev) -> 'summary' ->> 'updates')::int = 3
  and ((select j from dr_prev) -> 'summary' ->> 'crossTeam')::int = 1 and ((select j from dr_prev) -> 'summary' ->> 'links')::int = 2,
  'three tasks of two projects in one report: 1 completed, 3 updates, 1 cross-team, 2 links');
select test.check((select w -> 'entries' -> 0 ->> 'note' = 'Mobile responsiveness completed.' and w -> 'entries' -> 1 ->> 'note' = 'Supporting screenshot uploaded.'
                     and (w ->> 'progress')::int = 80 and (w ->> 'progressBefore')::int = 50 and jsonb_array_length(w -> 'entries') = 2
                     and w -> 'links' = '["https://github.com/amuwa/site/pull/1"]'::jsonb
                     from jsonb_array_elements((select j from dr_prev) -> 'work') w where w ->> 'title' = 'DR Website Development'),
  'two updates of the same day, in order, from 50% to 80%, with the link recorded that day');
select test.check((select w -> 'entries' -> 0 ->> 'note' = E'1. Leads responding positively were still receiving follow-ups.\n2. Leads saying Stop still received messages.\n3. Silent leads kept getting messages after Day 21.\n4. Campaign failure alerts were required.'
                     and w ->> 'completedAt' is not null and w ->> 'status' = 'COMPLETED' and jsonb_array_length(w -> 'entries') = 1
                     from jsonb_array_elements((select j from dr_prev) -> 'work') w where w ->> 'title' = 'DR Blockers to be found'),
  'the completion details appear exactly as written (line breaks kept), once');
select test.check((select (w ->> 'noUpdate')::boolean and jsonb_array_length(w -> 'entries') = 0 and w ->> 'status' = 'ASSIGNED'
                     from jsonb_array_elements((select j from dr_prev) -> 'work') w where w ->> 'title' = 'DR Not started'),
  'a task with no update that day says so: nothing older is shown as new work');
select test.check((select jsonb_array_length(w -> 'entries') = 1 and w -> 'entries' -> 0 ->> 'note' = 'Homepage integration completed.'
                     from jsonb_array_elements(ai_studio_daily_report_preview(test.d(-2), array[test.dtask('DR Website Development')]) -> 'work') w),
  'the day before: only that day''s update (later work is not included)');
select test.must_fail($$select ai_studio_daily_report_preview(test.d(-1), array[test.dtask('DR Someone else')])$$, 'another person''s task cannot be used', 'assigned to you');
select test.must_fail($$select ai_studio_daily_report_preview(test.d(-1), array[test.dtask('DR Finished last week')])$$, 'nor a task completed before that day', 'open on the report date');

\echo '   draft, submit, and nothing copied (Test 13, 16, 17)'
reset role;
create temp table dr_before as select
  (select count(*) from public.ai_studio_task_updates) as updates,
  (select md5(string_agg(t.id::text || t.attachments::text || coalesce(t.completion_note, ''), ',' order by t.id)) from public.ai_studio_tasks t) as tasks;
grant select on dr_before to authenticated;
set role authenticated;
select test.login('ai_tm1a');
insert into dr_t select 'y', (ai_studio_daily_report_save(null, test.d(-1), array[test.dtask('DR Website Development'), test.dtask('DR Blockers to be found'), test.dtask('DR Not started')],
  null, 'Write the tests', null, 'Final testing', null, false) ->> 'id')::uuid;
select test.check((ai_studio_report_get(test.drep('y')) ->> 'kind') = 'DAILY' and (ai_studio_report_get(test.drep('y')) ->> 'status') = 'DRAFT'
  and jsonb_array_length(ai_studio_report_get(test.drep('y')) -> 'work') = 3 and (ai_studio_report_get(test.drep('y')) ->> 'tomorrowPlan') = 'Final testing',
  'a draft keeps the chosen tasks and the person''s own remarks');
select test.must_fail($$select ai_studio_daily_report_save(null, test.d(-1), '{}'::uuid[], 'x', null, null, null, null, false)$$, 'a second report for the same day is refused', 'already have a daily report');
-- the form showed two of the three entries: submitting is refused, nothing changes
select test.must_fail(format($$select ai_studio_daily_report_save(%L, test.d(-1), array[test.dtask('DR Website Development'), test.dtask('DR Blockers to be found'), test.dtask('DR Not started')],
  null, 'Write the tests', null, 'Final testing', null, true, %L::uuid[], p_description => test.desc10())$$, test.drep('y'),
  (select array_agg(e ->> 'id') from jsonb_array_elements((select j from dr_prev) -> 'work') w, jsonb_array_elements(w -> 'entries') e where w ->> 'title' = 'DR Website Development')),
  'a report the author did not see in full is not submitted', 'updated while you were preparing');
select test.check((ai_studio_report_get(test.drep('y')) ->> 'status') = 'DRAFT', 'it is still a draft');
select test.check((ai_studio_daily_report_save(test.drep('y'), test.d(-1), array[test.dtask('DR Website Development'), test.dtask('DR Blockers to be found'), test.dtask('DR Not started')],
  null, 'Write the tests', null, 'Final testing', null, true,
  (select array_agg((e ->> 'id')::uuid) from jsonb_array_elements((select j from dr_prev) -> 'work') w, jsonb_array_elements(w -> 'entries') e), test.desc10()) ->> 'status') = 'PENDING_TL_APPROVAL',
  'submitted with exactly what the author saw: it goes to their Team Lead (no "work completed" text needed)');
select test.must_fail(format($$select ai_studio_daily_report_save(%L, test.d(-1), '{}'::uuid[], 'again', null, null, null, null, true, p_description => test.desc10())$$, test.drep('y')), 'a second click does not submit again', 'already submitted');
reset role;
select test.check((select count(*) = 3 from public.ai_studio_report_tasks where report_id = test.drep('y')) and (select count(*) = 3 from public.ai_studio_report_task_updates where report_id = test.drep('y')),
  'the report stores 3 task references and 3 history references');
select test.check((select work_completed is null and pending_work = 'Write the tests' and tomorrow_plan = 'Final testing' and project_id is null and task_id is null
                     from public.ai_studio_daily_reports where id = test.drep('y')),
  'only the new remarks are stored as text: no task text is copied into the report');
select test.check((select count(*) from public.ai_studio_task_updates) = (select updates from dr_before)
  and (select md5(string_agg(t.id::text || t.attachments::text || coalesce(t.completion_note, ''), ',' order by t.id)) from public.ai_studio_tasks t) = (select tasks from dr_before),
  'submitting adds no history entry and changes no task, link or completion detail (no copies)');
select test.check((select count(*) = 1 from public.notifications where recipient_id = test.id('ai_tl1') and entity_id = test.drep('y')
                     and body like '% · 2 projects · 3 tasks · 1 completed%'),
  'the Team Lead is notified once, with the projects, tasks and completed counts');
select test.must_fail(format($$insert into public.ai_studio_report_task_updates (report_id, task_id, update_id)
  select %L, test.dtask('DR Not started'), u.id from public.ai_studio_task_updates u where u.task_id = test.dtask('DR Website Development') and u.kind = 'ASSIGNED'$$, test.drep('y')),
  'the database refuses a reference to another task''s history entry', 'violates foreign key');

\echo '   a submitted report keeps showing its day (Test 07)'
set role authenticated;
select test.login('ai_tm1a');
select ai_studio_task_update(test.dtask('DR Website Development'), 'COMPLETED', 100, 'Final testing completed.', '["https://github.com/amuwa/site/pull/2"]'::jsonb);
select test.check((select (w ->> 'progress')::int = 80 and (w ->> 'currentProgress')::int = 100 and jsonb_array_length(w -> 'entries') = 2
                     and w -> 'links' = '["https://github.com/amuwa/site/pull/1"]'::jsonb and w ->> 'completedAt' is null
                     from jsonb_array_elements(ai_studio_report_get(test.drep('y')) -> 'work') w where w ->> 'title' = 'DR Website Development'),
  'the task is now 100% but yesterday''s report still shows 80%, its two updates and that day''s link');
reset role;
select test.check((select links = '["https://github.com/amuwa/site/pull/2"]'::jsonb from public.ai_studio_task_updates where note = 'Final testing completed.'),
  'today''s update records the new link list once');

\echo '   who sees what (Test 09, 10, 11)'
set role authenticated;
select test.login('ai_tl1');
select test.check((select count(*) = 3 from jsonb_array_elements(ai_studio_report_get(test.drep('y')) -> 'work')) and (ai_studio_report_get(test.drep('y')) ->> 'canReview')::boolean,
  'the person''s own Team Lead reads the whole report and can decide it');
select test.check((select (r -> 'counts' ->> 'projects')::int = 2 and (r -> 'counts' ->> 'tasks')::int = 3 and (r -> 'counts' ->> 'completed')::int = 1 and (r -> 'counts' ->> 'crossTeam')::int = 1
                     from jsonb_array_elements(ai_studio_reports_list('team') -> 'items') r where r ->> 'id' = test.drep('y')::text),
  'the list row has the counts (projects, tasks, completed, cross-team)');
select test.check((ai_studio_report_lead_edit(test.drep('y'), null, null, 'Write the tests', 'Waiting for test data', null, 'Added the blocker we discussed') ->> 'blockers') = 'Waiting for test data',
  'the Team Lead can correct the remarks; no "work completed" text is needed when the tasks carry the work');
select test.login('ai_tl2');
select test.must_fail(format($$select ai_studio_report_get(%L)$$, test.drep('y')), 'the Team Lead who gave a cross-team task cannot open the whole report', 'NOT_FOUND');
select test.check((select jsonb_array_length(x -> 'entries') = 1 and x -> 'entries' -> 0 ->> 'note' like '1. Leads responding positively%' and not (x ->> 'canOpen')::boolean
                     from jsonb_array_elements(ai_studio_task_reports(test.dtask('DR Blockers to be found'))) x where x ->> 'reportId' = test.drep('y')::text),
  'but sees their own task''s part of it (and only that part)');
select test.must_fail($$select ai_studio_task_reports(test.dtask('DR Website Development'))$$, 'not the parts about tasks they did not give', 'NOT_FOUND');
select test.login('ai_tm1b');
select test.must_fail(format($$select ai_studio_report_get(%L)$$, test.drep('y')), 'another Team Member cannot read the report', 'NOT_FOUND');
select test.must_fail($$select ai_studio_daily_report_preview(test.d(-1), array[test.dtask('DR Website Development')])$$, 'nor pull someone else''s task work into their own report', 'assigned to you');

\echo '   the Department Head (Test 10) and the filters'
select test.login('ai_dh');
select test.check((ai_studio_report_get(test.drep('y')) -> 'summary' ->> 'tasks')::int = 3, 'the Department Head reads the consolidated report');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_reports_page('department', p_cross_team => true) -> 'items') r where r ->> 'id' = test.drep('y')::text)
  and not exists (select 1 from jsonb_array_elements(ai_studio_reports_page('department', p_cross_team => false) -> 'items') r where r ->> 'id' = test.drep('y')::text),
  'the cross-team filter');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_reports_page('department', p_blockers => true) -> 'items') r where r ->> 'id' = test.drep('y')::text),
  'the blockers filter');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_reports_page('department', p_project => test.proj('AI Website')) -> 'items') r where r ->> 'id' = test.drep('y')::text),
  'the project filter finds a report through its tasks');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_reports_list('department') -> 'items') r where r ->> 'kind' = 'SINGLE'),
  'older single-task reports are still listed');
select test.login('ai_tl1');
select ai_studio_report_review(test.drep('y'), 'APPROVE', 'Good');
select test.login('ai_dh');
select test.check((ai_studio_report_review(test.drep('y'), 'APPROVE', 'Thanks') ->> 'status') = 'APPROVED', 'the existing two-step approval is unchanged');
select test.check((select (w ->> 'progress')::int = 80 from jsonb_array_elements(ai_studio_report_get(test.drep('y')) -> 'work') w where w ->> 'title' = 'DR Website Development'),
  'an approved report still shows its day');

\echo '   no specific task, and a report needs some work (Test 14)'
select test.login('ai_tm1a');
select test.check((ai_studio_daily_report_save(null, test.d(-2), '{}'::uuid[], 'Team meeting and research', null, null, null, null, true, p_description => test.desc10()) ->> 'status') = 'PENDING_TL_APPROVAL',
  'work with no task is submitted with its own description');
select test.must_fail($$select ai_studio_daily_report_save(null, test.d(-3), array[test.dtask('DR Not started')], null, null, null, null, null, true, p_description => test.desc10())$$,
  'a report with no recorded work and no description is refused', 'Select a task with work recorded');
select test.check((ai_studio_daily_report_save(null, test.d(-3), array[test.dtask('DR Not started')], null, null, null, null, null, false) ->> 'status') = 'DRAFT', 'it can still be kept as a draft');

\echo '   returned and resubmitted'
reset role;
delete from public.ai_studio_daily_reports where author_id = test.id('ai_tm1a') and report_date = test.d(0) and project_id is null;
set role authenticated;
select test.login('ai_tm1a');
insert into dr_t select 't', (ai_studio_daily_report_save(null, test.d(0), array[test.dtask('DR Website Development')], null, null, null, null, null, true, p_description => test.desc10()) ->> 'id')::uuid;
select test.check((select jsonb_array_length(w -> 'entries') = 1 and w ->> 'completedAt' is not null from jsonb_array_elements(ai_studio_report_get(test.drep('t')) -> 'work') w),
  'today''s report has today''s completion');
select test.login('ai_tl1');
select ai_studio_report_review(test.drep('t'), 'RETURN', 'Add the plan for tomorrow');
select test.login('ai_tm1a');
select test.check((ai_studio_daily_report_save(test.drep('t'), test.d(0), array[test.dtask('DR Website Development')], null, null, null, 'Start the next module', null, true, p_description => test.desc10()) ->> 'revision') = '2',
  'a returned report is corrected and submitted again (revision 2)');
reset role;
select test.check((select count(*) = 1 from public.ai_studio_report_task_updates where report_id = test.drep('t')), 'and still references its entry once');
select test.check((select count(*) = 0 from public.ai_studio_daily_reports where project_id is null and (work_completed like '%Leads responding%' or pending_work like '%Leads responding%')),
  'no report holds a copy of the completion details');

delete from public.ai_studio_daily_reports where author_id = test.id('ai_tm1a') and project_id is null;
delete from public.ai_studio_tasks where title like 'DR %';
\echo '   AI Studio daily report checks passed'
