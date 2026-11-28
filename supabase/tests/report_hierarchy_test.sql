-- =============================================================================
-- Daily and weekly reporting hierarchy (migration 20270306000100).
--   every department but AI Studio: daily Team Member -> Team Lead -> Department Head; weekly Department Head -> Operations Head
--   AI Studio: daily Team Member -> Team Lead -> HR (the named viewers); weekly Team Lead -> the Super Admin (AI Studio's Department Head)
-- Runs last. Reuses: AI Studio ai_tl1 (Team Lead of ai_tm1a / ai_tm1b), ai_tl2 (Team Lead of ai_tm2a), ai_dh, sa; HR hrp_viewer (named viewer, from
-- ai_studio_hr_performance_test.sql) and hr_head (not named); the weekly routing people wkr_dhp (Support head of wkr-a) and wkr_ohp (its Operations Head),
-- wkr_tmp (a Support member of wkr-a). AI Studio report dates are in the previous week (7-13 days back), cleaned first.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 210. Reporting hierarchy: AI Studio daily to HR, AI Studio weekly to the Super Admin, the rest unchanged'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270306000100_report_hierarchy.sql
\i supabase/migrations/20270306000100_report_hierarchy.sql

create or replace function test.rh_week() returns date language sql stable as $$ select date_trunc('week', private.ai_studio_today())::date - 7 $$;
create or replace function test.rh_notes(p_person text, p_type text, p_entity uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications where recipient_id = test.id(p_person) and type = p_type and entity_id = p_entity $$;
create or replace function test.rh_any_notes(p_person text, p_entity uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications where recipient_id = test.id(p_person) and entity_id = p_entity $$;
create or replace function test.rh_report(p_id uuid) returns public.ai_studio_daily_reports language sql stable security definer set search_path = '' as $$
  select * from public.ai_studio_daily_reports where id = p_id $$;
create table if not exists rh (k text primary key, v uuid);
grant all on rh to authenticated;
create or replace function test.rh(p_k text) returns uuid language sql stable as $$ select v from public.rh where k = p_k $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

delete from rh;
delete from ai_studio_weekly_reports where lead_id in (test.id('ai_tl1'), test.id('ai_tl2'));
delete from ai_studio_daily_reports where report_date between test.rh_week() and test.rh_week() + 6 and author_id in (test.id('ai_tm1a'), test.id('ai_tm1b'), test.id('ai_tm2a'));
delete from ai_studio_tasks where title like 'RH %';
delete from ai_studio_projects where name like 'RH %';
-- the HR employee the Super Admin names (an earlier suite took the access away again)
insert into ai_studio_hr_viewers (profile_id) values (test.id('hrp_viewer')) on conflict do nothing;
-- a project and work in the week: two tasks of ai_tm1a (one completed in the week), one of ai_tm2a (another team)
insert into ai_studio_projects (name) values ('RH Website');
insert into ai_studio_project_members (project_id, profile_id) select p.id, u.id from ai_studio_projects p, test.users u where p.name = 'RH Website' and u.name in ('ai_tl1', 'ai_tm1a', 'ai_tl2', 'ai_tm2a');
insert into ai_studio_tasks (project_id, title, assigned_by, assignee_id, status, progress, created_at, completed_at)
select p.id, x.title, test.id(x.by), test.id(x.who), x.st, x.pg, (test.rh_week() - 3)::timestamp, case when x.st = 'COMPLETED' then (test.rh_week() + 2)::timestamp + interval '12 hours' end
  from ai_studio_projects p,
       (values ('RH Landing page', 'ai_tl1', 'ai_tm1a', 'COMPLETED', 100), ('RH Contact form', 'ai_tl1', 'ai_tm1a', 'IN_PROGRESS', 40), ('RH Other team task', 'ai_tl2', 'ai_tm2a', 'COMPLETED', 100)) x(title, by, who, st, pg)
 where p.name = 'RH Website';

-- ---------------------------------------------------------------------------
-- 1. AI Studio daily: Team Member -> Team Lead -> HR
-- ---------------------------------------------------------------------------
\echo '   AI Studio daily: the Team Lead''s approval is final and the report goes to HR'
set role authenticated;
select test.login('ai_tm1a');
insert into rh select 'd1', (ai_studio_daily_report_save(null, test.rh_week() + 1, '{}'::uuid[], 'Built the landing page', 'The contact form', null, null, 'Good day', true,
  p_description => 'Built the landing page of the client website and started the contact form with the validation.') ->> 'id')::uuid;
reset role;
select test.check((test.rh_report(test.rh('d1'))).status = 'PENDING_TL_APPROVAL', 'the member submits: it waits for their Team Lead');
set role authenticated;
select test.login('ai_dh');
select test.must_fail($$select ai_studio_report_review(test.rh('d1'), 'APPROVE')$$, 'the Department Head is not in the chain of a member''s report', 'not waiting for your decision');
select test.login('ai_tl2');
select test.must_fail($$select ai_studio_report_review(test.rh('d1'), 'APPROVE')$$, 'another Team Lead cannot approve it', 'not found');
select test.login('ai_tl1');
select test.check((ai_studio_report_review(test.rh('d1'), 'APPROVE') ->> 'status') = 'APPROVED', 'the Team Lead approves: Approved (final)');
reset role;
select test.check((test.rh_report(test.rh('d1'))).approved_at is not null and (test.rh_report(test.rh('d1'))).hr_sent_at is not null
                  and (test.rh_report(test.rh('d1'))).dh_reviewed_by is null, 'approved at the Team Lead''s step, sent to HR, no Department Head decision');
select test.check((select count(*) = 1 from ai_studio_report_hr_sends where report_id = test.rh('d1')), 'sent to HR once');
select test.check(test.rh_notes('hrp_viewer', 'AI_STUDIO_REPORT_TO_HR', test.rh('d1')) = 1, 'the named HR employee (e.g. Simran Kumari) is notified once');
select test.check(test.rh_any_notes('hr_head', test.rh('d1')) = 0, 'another HR employee is not');
select test.check(test.rh_notes('ai_dh', 'AI_STUDIO_REPORT_PENDING_HEAD', test.rh('d1')) = 0 and test.rh_notes('sa', 'AI_STUDIO_REPORT_PENDING_HEAD', test.rh('d1')) = 0,
  'neither the Department Head nor the Super Admin is asked to approve it');
select test.check(private.perf2_ai_report_state(test.rh_report(test.rh('d1'))) = 'APPROVED', 'Performance Management counts it as approved');
set role authenticated;
select test.login('ai_tl1');
select test.must_fail($$select ai_studio_report_review(test.rh('d1'), 'APPROVE')$$, 'a second approval is refused (no duplicate)', 'not waiting for your decision');
reset role;
select test.check(test.rh_notes('hrp_viewer', 'AI_STUDIO_REPORT_TO_HR', test.rh('d1')) = 1, 'still one notification to HR');

\echo '   Daily Reports - AI Studio: the named HR employee and the Super Admin only'
set role authenticated;
select test.login('hrp_viewer');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_hr_performance(test.rh_week(), test.rh_week() + 6) -> 'memberReports') x
                           where x ->> 'id' = test.rh('d1')::text and x ->> 'leadName' = 'AI Lead One' and x ->> 'approvedBy' = 'AI Lead One' and x ->> 'approvedAt' is not null
                             and x ->> 'workCompleted' = 'Built the landing page' and x ->> 'pendingWork' = 'The contact form' and x ->> 'remarks' = 'Good day'),
  'Simran sees the approved report: team, Team Lead approval, date, completed work, pending work, remarks');
select test.login('sa');
select test.check(jsonb_typeof(ai_studio_hr_performance(test.rh_week(), test.rh_week() + 6) -> 'memberReports') = 'array', 'the Super Admin can open it');
select test.login('hr_head');
select test.must_fail($$select ai_studio_hr_performance()$$, 'another HR employee cannot', 'FORBIDDEN');
select test.login('ai_dh');
select test.must_fail($$select ai_studio_hr_performance()$$, 'nor the AI Studio Department Head', 'FORBIDDEN');
select test.login('ai_tl1');
select test.must_fail($$select ai_studio_hr_performance()$$, 'nor a Team Lead', 'FORBIDDEN');

\echo '   reports a Team Lead approved before this migration (waiting for the Department Head) become Approved'
reset role;
insert into ai_studio_daily_reports (project_id, author_id, author_name, author_role, report_date, status, work_completed, work_description, lead_id, tl_reviewed_by, tl_reviewed_at, submitted_at, description_required)
values (null, test.id('ai_tm1b'), 'AI Member 1B', 'MEMBER', test.rh_week() + 2, 'PENDING_DH_APPROVAL', 'Old flow report', 'An older report approved by the Team Lead and waiting for the Department Head here.',
        test.id('ai_tl1'), test.id('ai_tl1'), now() - interval '2 days', now() - interval '3 days', false)
returning id \gset old_
\i supabase/migrations/20270306000100_report_hierarchy.sql
select test.check((select status = 'APPROVED' and approved_at = tl_reviewed_at from ai_studio_daily_reports where id = :'old_id'), 'it is Approved at the Team Lead''s time; nothing is deleted');

-- ---------------------------------------------------------------------------
-- 2. AI Studio weekly: Team Lead -> the Super Admin
-- ---------------------------------------------------------------------------
\echo '   AI Studio weekly: the Team Lead writes it, the Super Admin receives it'
set role authenticated;
select test.login('ai_tl1');
select test.check((select (w -> 'liveStats' -> 'totals' ->> 'tasksCompleted')::int = 1 and (w -> 'liveStats' -> 'totals' ->> 'reportsApproved')::int >= 1
                          and exists (select 1 from jsonb_array_elements(w -> 'liveStats' -> 'members') m where m ->> 'id' = test.id('ai_tm1a')::text and (m ->> 'tasksCompleted')::int = 1)
                          and not exists (select 1 from jsonb_array_elements(w -> 'liveStats' -> 'members') m where m ->> 'id' = test.id('ai_tm2a')::text)
                          and exists (select 1 from jsonb_array_elements(w -> 'liveStats' -> 'projects') p where p ->> 'name' = 'RH Website' and (p ->> 'tasksCompleted')::int = 1)
                     from (select ai_studio_weekly_report_get(test.rh_week()) w) x),
  'the week''s figures: team-wise (their own members only) and project-wise, from approved reports and tasks');
select test.must_fail($$select ai_studio_weekly_report_save(test.rh_week(), 'short', null, null, null, null, true)$$, 'submitting needs the completed work', 'VALIDATION_ERROR');
select test.must_fail($$select ai_studio_weekly_report_save(test.rh_week() + 1, 'Built the landing page', null, null, null, null, false)$$, 'a week starts on a Monday', 'Monday');
insert into rh select 'w1', (ai_studio_weekly_report_save(test.rh_week(), 'Finished the landing page of the client website.', 'The contact form', 'Landing page live',
                                                          'Waiting for the API keys', 'Good week', false) ->> 'id')::uuid;
reset role;
select test.check((select status = 'DRAFT' from ai_studio_weekly_reports where id = test.rh('w1')) and test.rh_any_notes('sa', test.rh('w1')) = 0, 'a draft notifies nobody');
set role authenticated;
select test.login('sa');
select test.check(not exists (select 1 from jsonb_array_elements(ai_studio_weekly_reports_list()) x where x ->> 'id' = test.rh('w1')::text), 'the Super Admin does not see a draft');
select test.login('ai_tl1');
select test.check((ai_studio_weekly_report_save(test.rh_week(), 'Finished the landing page of the client website.', 'The contact form', 'Landing page live',
                                                'Waiting for the API keys', 'Good week', true) ->> 'status') = 'SUBMITTED', 'the Team Lead submits it');
select test.must_fail($$select ai_studio_weekly_report_save(test.rh_week(), 'Again the same week of work here.', null, null, null, null, true)$$, 'submitting twice is refused', 'already submitted');
reset role;
select test.check(test.rh_notes('sa', 'AI_STUDIO_WEEKLY_REPORT', test.rh('w1')) = 1, 'the Super Admin is notified once');
select test.check(test.rh_any_notes('hrp_viewer', test.rh('w1')) = 0 and test.rh_any_notes('hr_head', test.rh('w1')) = 0, 'HR (Simran included) is not');
select test.check(test.rh_any_notes('wkr_ohp', test.rh('w1')) = 0 and test.rh_any_notes('ai_dh', test.rh('w1')) = 0, 'no Operations Head, and not the AI Studio Department Head profile');
select test.check((select (stats -> 'totals' ->> 'tasksCompleted')::int = 1 from ai_studio_weekly_reports where id = test.rh('w1')), 'the figures are fixed on submission');

\echo '   ... and nobody else reads it'
set role authenticated;
select test.login('hrp_viewer');
select test.must_fail($$select ai_studio_weekly_reports_list()$$, 'Simran (HR) cannot read AI Studio weekly reports', 'FORBIDDEN');
select test.must_fail(format($$select ai_studio_weekly_report_open('%s')$$, test.rh('w1')), '... nor open one', 'FORBIDDEN');
select test.login('wkr_ohp');
select test.must_fail($$select ai_studio_weekly_reports_list()$$, 'an Operations Head cannot', 'FORBIDDEN');
select test.login('ai_tl2');
select test.must_fail(format($$select ai_studio_weekly_report_open('%s')$$, test.rh('w1')), 'another Team Lead cannot open it', 'NOT_FOUND');
select test.check(not exists (select 1 from jsonb_array_elements(ai_studio_weekly_reports_list()) x where x ->> 'id' = test.rh('w1')::text), '... nor list it');
select test.login('ai_tm1a');
select test.must_fail($$select ai_studio_weekly_reports_list()$$, 'a Team Member cannot', 'FORBIDDEN');
select test.must_fail(format($$select ai_studio_weekly_report_review('%s', 'ACKNOWLEDGE')$$, test.rh('w1')), '... nor review it', 'FORBIDDEN');
select test.login('ai_dh');
select test.must_fail(format($$select ai_studio_weekly_report_review('%s', 'ACKNOWLEDGE')$$, test.rh('w1')), 'only the Super Admin reviews it', 'FORBIDDEN');

\echo '   the Super Admin returns it, the Team Lead resubmits, the Super Admin acknowledges'
select test.login('sa');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_weekly_reports_list(test.rh_week())) x
                           where x ->> 'id' = test.rh('w1')::text and x ->> 'achievements' = 'Landing page live' and x ->> 'challenges' = 'Waiting for the API keys'),
  'the Super Admin lists it with completed work, pending work, achievements, challenges and remarks');
select test.must_fail(format($$select ai_studio_weekly_report_review('%s', 'RETURN')$$, test.rh('w1')), 'returning needs a comment', 'VALIDATION_ERROR');
select test.check((ai_studio_weekly_report_review(test.rh('w1'), 'RETURN', 'Add the project timeline') ->> 'status') = 'RETURNED', 'returned for a revision');
select test.login('ai_tl1');
select test.check((select w ->> 'status' = 'SUBMITTED' and (w ->> 'revision')::int = 2
                     from (select ai_studio_weekly_report_save(test.rh_week(), 'Finished the landing page; the timeline is in the remarks.', 'The contact form', 'Landing page live',
                                                               'Waiting for the API keys', 'Timeline: contact form next week', true) w) x), 'resubmitted (revision 2)');
select test.login('sa');
select test.check((ai_studio_weekly_report_review(test.rh('w1'), 'ACKNOWLEDGE') ->> 'status') = 'ACKNOWLEDGED', 'acknowledged');
select test.must_fail(format($$select ai_studio_weekly_report_review('%s', 'ACKNOWLEDGE')$$, test.rh('w1')), 'a second decision is refused', 'not waiting');
reset role;
select test.check(test.rh_notes('ai_tl1', 'AI_STUDIO_WEEKLY_RETURNED', test.rh('w1')) = 1 and test.rh_notes('ai_tl1', 'AI_STUDIO_WEEKLY_ACKNOWLEDGED', test.rh('w1')) = 1
                  and test.rh_notes('sa', 'AI_STUDIO_WEEKLY_REPORT', test.rh('w1')) = 2, 'the Team Lead is told each decision; the Super Admin each submission');
select test.check((select count(*) = 4 from ai_studio_weekly_report_events where report_id = test.rh('w1') and action <> 'SAVED'), 'every step is in the history');

-- ---------------------------------------------------------------------------
-- 3. AI Studio is not in the Department Head -> Operations Head cycle
-- ---------------------------------------------------------------------------
\echo '   AI Studio stays out of the normal department reporting'
set role authenticated;
select test.login('ai_dh');
select test.must_fail(format($$select work_report_weekly_save('%s', 'AI Studio week', 'x', 'y', 'z', true, null)$$, test.rh_week()),
  'the AI Studio Department Head cannot send a weekly report to an Operations Head', 'FORBIDDEN');
reset role;
select test.must_fail(format($$insert into work_reports (kind, author_id, author_name, department_id, title, report_date, period_start, period_end, status, content)
                               values ('MEMBER', '%s', 'AI Member 1A', '%s', 'RH daily', current_date, current_date, current_date, 'DRAFT', '{}')$$, test.id('ai_tm1a'), private.ai_studio_department()),
  'no hierarchical work report is created for an AI Studio person, whichever function would write it', 'FORBIDDEN');
select test.check(not exists (select 1 from private.weekly_scopes() s where s.department_id = private.ai_studio_department()), 'AI Studio is not a weekly Operations Head scope');
select test.check(not exists (select 1 from ai_studio_weekly_reports w join work_report_packages p on p.department_id = private.ai_studio_department()), 'no AI Studio department package exists');

-- ---------------------------------------------------------------------------
-- 4. Every other department: unchanged routing; the weekly report carries pending work, achievements and challenges
-- ---------------------------------------------------------------------------
\echo '   other departments: Department Head -> Operations Head, with the new parts'
set role authenticated;
select test.login('wkr_dhp');
select set_config('request.headers', '', false);
insert into rh select 'pk', (work_report_weekly_save(test.rh_week() - 7, 'Support week two', 'Tickets', 'Closed', 'Fine', true, null,
                                                     'Two escalations open', 'Response time halved', 'One agent on leave') ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING_OPERATIONS_HEAD' and pending_overview = 'Two escalations open' and achievements = 'Response time halved' and challenges = 'One agent on leave'
                     from work_report_packages where id = test.rh('pk')), 'the Support head''s week goes to the Operations Head, with pending work, achievements and challenges');
select test.check(test.rh_notes('wkr_ohp', 'REPORT_PACKAGE_SUBMITTED', test.rh('pk')) = 1 and test.rh_any_notes('hrp_viewer', test.rh('pk')) = 0,
  'the Operations Head is told; HR only after the Operations Head approves (unchanged)');
select test.check((select p ->> 'achievements' = 'Response time halved' and p ->> 'pendingOverview' = 'Two escalations open'
                     from (select private.package_json(w) p from work_report_packages w where w.id = test.rh('pk')) x), 'the report (as the screens read it) carries the new parts');
select test.check(exists (select 1 from private.weekly_scopes() s where s.department_id = test.dept('wkr-a')), 'other departments are still weekly scopes');

\echo '   cleanup'
reset role;
select set_config('request.jwt.claims', '', false);
delete from work_report_packages where id = test.rh('pk');
delete from ai_studio_weekly_reports where lead_id in (test.id('ai_tl1'), test.id('ai_tl2'));
delete from ai_studio_daily_reports where report_date between test.rh_week() and test.rh_week() + 6 and author_id in (test.id('ai_tm1a'), test.id('ai_tm1b'), test.id('ai_tm2a'));
delete from ai_studio_tasks where title like 'RH %';
delete from ai_studio_projects where name like 'RH %';
\echo '=== REPORTING HIERARCHY TESTS PASSED ==='
