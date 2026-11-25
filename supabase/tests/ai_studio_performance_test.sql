-- =============================================================================
-- Performance Management in AI Studio (migration 20270214000100): the shared performance records read AI Studio's own tasks and two-step daily reports,
-- the Team Lead corrects and approves a member's report and evaluates the member, the Department Head reads the team and evaluates the Team Lead,
-- the Team Member has no performance, and every other department keeps the task-record figures.
-- Uses its own people (aps_*) in the AI Studio department and its Department Head (ai_dh, from ai_studio_test.sql: one head per department); own rows are
-- removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 193. Performance Management in AI Studio'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270214000100_ai_studio_performance.sql
\i supabase/migrations/20270214000100_ai_studio_performance.sql

delete from ai_studio_daily_reports where author_id in (select id from test.users where name like 'aps\_%');
delete from ai_studio_tasks where title like 'APS %';
delete from performance_records where subject_id in (select id from test.users where name like 'aps\_%');
delete from auth.users where email like 'aps.%@example.com';
delete from test.users where name like 'aps\_%';

create or replace function test.apsmk(p_name text, p_role text) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'aps.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'APS ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_role = 'DEPARTMENT_HEAD' then private.ai_studio_department() end,
      'provisioned_team_id', case when p_role <> 'DEPARTMENT_HEAD' then test.team('ai-studio', 'AI Studio Team') end))) $$;
select test.apsmk('aps_lead', 'TEAM_HEAD'), test.apsmk('aps_lead2', 'TEAM_HEAD'), test.apsmk('aps_mem', 'TEAM_MEMBER');
update profiles set manager_id = test.id('aps_lead') where id = test.id('aps_mem');
select test.check(private.direct_lead_of(test.id('aps_mem')) = test.id('aps_lead') and private.perf2_is_ai_studio(private.ai_studio_department())
                  and not private.perf2_is_ai_studio(test.dept('wabastore')) and not private.perf2_is_ai_studio(null), 'AI Studio people; only AI Studio reads AI Studio''s work');
create temp table aps (k text primary key, v uuid);
grant all on aps to authenticated;
-- a task the Team Lead gave the member, and the member's submitted daily report waiting for the Team Lead
with ins as (
  insert into ai_studio_tasks (project_id, title, assigned_by, assignee_id, due_date, status, progress)
  select (select id from ai_studio_projects where name = 'AI CRM'), 'APS build the login screen', test.id('aps_lead'), test.id('aps_mem'), current_date + 2, 'IN_PROGRESS', 40
  returning id) insert into aps select 'T', id from ins;
with ins as (
  insert into ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, pending_work, status, lead_id, lead_name, submitted_at)
  select test.id('aps_mem'), 'APS mem', 'MEMBER', (select id from ai_studio_projects where name = 'AI CRM'), (select v from aps where k = 'T'), current_date,
         'Built the login form layout', 'Error messages', 'PENDING_TL_APPROVAL', test.id('aps_lead'), 'APS lead', now()
  returning id) insert into aps select 'R', id from ins;

\echo '   the Team Lead: AI Studio figures, a report waiting'
set role authenticated;
select test.login('aps_lead');
create temp table aps_json (k text primary key, j jsonb);
grant all on aps_json to authenticated;
insert into aps_json select 'lead', performance_overview(current_date - 30, current_date + 30);
select test.check((select j ->> 'role' = 'TEAM_HEAD' and j ->> 'source' = 'AI_STUDIO' and (j ->> 'pendingReports')::int = 1 from aps_json where k = 'lead'),
  'the Team Lead''s overview reads AI Studio (one report waiting at their step)');
select test.check((select (m #>> '{metrics,tasks,total}')::int = 1 and (m #>> '{metrics,progressPct}')::numeric = 40 and (m #>> '{metrics,reports,pending}')::int = 1
                          and (m #>> '{record,waitingReports}')::int = 1 and (m #>> '{record,ratingRequired}')::boolean and (m #>> '{record,canDecide}')::boolean
                     from aps_json, jsonb_array_elements(j -> 'members') m where k = 'lead' and m ->> 'id' = test.id('aps_mem')::text),
  'the member''s figures come from ai_studio_tasks and ai_studio_daily_reports (1 task at 40%, 1 report pending)');
insert into aps select 'PM', (m #>> '{record,id}')::uuid from aps_json, jsonb_array_elements(j -> 'members') m where k = 'lead' and m ->> 'id' = test.id('aps_mem')::text;
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'early', null, 4)$$, (select v from aps where k = 'PM')),
  'the member''s performance is not approved while their AI Studio report waits', 'still waiting');

\echo '   the Team Lead corrects the report, then approves it'
select test.login('aps_mem');
select test.must_fail(format($$select ai_studio_report_lead_edit(%L, 'Changed', null, null, null, null, 'I want to change it')$$, (select v from aps where k = 'R')), 'the member cannot', 'FORBIDDEN');
select test.login('aps_lead2');
select test.must_fail(format($$select ai_studio_report_lead_edit(%L, 'Changed', null, null, null, null, 'Not my member')$$, (select v from aps where k = 'R')), 'another Team Lead cannot', 'not found');
select test.login('ai_dh');
select test.must_fail(format($$select ai_studio_report_lead_edit(%L, 'Changed', null, null, null, null, 'Head change')$$, (select v from aps where k = 'R')),
  'the Department Head does not edit at the Team Lead''s step', 'Only the Team Lead');
select test.login('aps_lead');
select test.check((ai_studio_report_get((select v from aps where k = 'R')) ->> 'canLeadEdit')::boolean, 'the report says the Team Lead may edit it');
select test.must_fail(format($$select ai_studio_report_lead_edit(%L, 'Built the form', null, 'Error messages', null, null, null)$$, (select v from aps where k = 'R')), 'an edit needs a reason', 'Say why');
select test.must_fail(format($$select ai_studio_report_lead_edit(%L, '', null, 'Error messages', null, null, 'Fixing the text')$$, (select v from aps where k = 'R')), 'and the work completed', 'work completed');
select test.check((select j ->> 'workCompleted' = 'Built the login form and the password field' and j ->> 'status' = 'PENDING_TL_APPROVAL'
                     from (select ai_studio_report_lead_edit((select v from aps where k = 'R'), 'Built the login form and the password field', null, 'Error messages', null, null, 'Added the password field') j) x),
  'the Team Lead''s correction is saved; the report still waits for them');
select ai_studio_report_lead_edit((select v from aps where k = 'R'), 'Built the login form and the password field', null, 'Error messages', null, null, 'Added the password field');
select test.check((select count(*) = 1 and bool_and(h -> 'changes' -> 'workCompleted' ->> 'from' = 'Built the login form layout' and h ->> 'comment' = 'Added the password field')
                     from jsonb_array_elements(ai_studio_report_get((select v from aps where k = 'R')) -> 'history') h where h ->> 'action' = 'EDITED'),
  'the history keeps one EDITED step with the reason and the change (a repeated click records nothing)');
select test.check((ai_studio_report_review((select v from aps where k = 'R'), 'APPROVE', 'Good') ->> 'status') = 'PENDING_DH_APPROVAL', 'the Team Lead approves it (on to the Department Head)');
select test.must_fail(format($$select ai_studio_report_lead_edit(%L, 'Late change', null, null, null, null, 'Too late now')$$, (select v from aps where k = 'R')),
  'a report past the Team Lead''s step cannot be edited', 'Only the Team Lead');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'AI_STUDIO_REPORT_EDITED' and entity_id = (select v from aps where k = 'R'))
                  and (select count(*) = 1 from notifications where recipient_id = test.id('aps_mem') and type = 'AI_STUDIO_REPORT_EDITED' and entity_id = (select v from aps where k = 'R')),
  'the correction is audited and the member is told');

\echo '   the Team Lead evaluates the member from the approved report'
set role authenticated;
select test.login('aps_lead');
select test.check((select (m #>> '{metrics,reports,approved}')::int = 1 and (m #>> '{metrics,reports,pending}')::int = 0 and (m #>> '{record,waitingReports}')::int = 0
                     from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') m where m ->> 'id' = test.id('aps_mem')::text),
  'once the Team Lead approved it, the report counts as approved and nothing waits');
select test.check((select r ->> 'status' = 'APPROVED' and (r ->> 'rating')::int = 4 from (select performance_record_review((select v from aps where k = 'PM'), 'APPROVE', 'Good progress', null, 4) r) x),
  'the Team Lead approves the member''s performance with a rating of 4');
select test.check((select w ->> 'source' = 'AI_STUDIO' and exists (select 1 from jsonb_array_elements(w -> 'tasks') t where t ->> 'title' = 'APS build the login screen' and t ->> 'project' = 'AI CRM'
                                                                  and t #>> '{lastReport,status}' = 'APPROVED' and (t ->> 'reports')::int = 1)
                     from (select performance_member_work(test.id('aps_mem'), current_date - 30, current_date + 30) w) x),
  'the drill-down shows the member''s AI Studio task with its project and the approved report');
select test.login('aps_lead2');
select test.must_fail(format($$select performance_member_work(%L, current_date - 30, current_date)$$, test.id('aps_mem')), 'another Team Lead cannot open it', 'not found');
select test.login('aps_mem');
select test.must_fail($$select performance_overview(current_date - 30, current_date + 30)$$, 'the AI Studio member has no performance view', 'for Team Leads and Department Heads');
select test.must_fail(format($$select performance_member_work(%L, current_date - 30, current_date)$$, test.id('aps_mem')), 'nor their own work view', 'not found');

\echo '   the Department Head: the department, the team, the Team Lead''s evaluation'
select test.login('ai_dh');
delete from aps_json;
insert into aps_json select 'head', performance_overview(current_date - 30, current_date + 30);
select test.check((select j ->> 'source' = 'AI_STUDIO' and (j #>> '{tasks,total}')::int >= 1 and (j #>> '{reports,submitted}')::int >= 1 and (j #>> '{reports,approved}')::int >= 1
                          and (j ->> 'leadDecidesMembers')::boolean = false from aps_json where k = 'head'),
  'the Department Head''s analytics count AI Studio''s tasks and reports');
select test.check((select (m #>> '{record,rating}')::int = 4 and (m #>> '{record,canDecide}')::boolean = false
                     from aps_json, jsonb_array_elements(j -> 'leads') l, jsonb_array_elements(l -> 'members') m where k = 'head' and m ->> 'id' = test.id('aps_mem')::text),
  'they see the member with the Team Lead''s rating, read only');
select test.check((select r ->> 'status' = 'APPROVED' and (r ->> 'rating')::int = 5
                     from (select performance_record_review((select (l #>> '{record,id}')::uuid from aps_json, jsonb_array_elements(j -> 'leads') l where k = 'head' and l ->> 'id' = test.id('aps_lead')::text),
                                                            'APPROVE', 'Team on track', null, 5) r) x),
  'the Department Head approves the Team Lead''s performance with a rating of 5');

\echo '   every other department keeps the task-record figures'
reset role;
select test.check(private.perf2_member(test.id('tdr_m1'), current_date - 30, current_date + 30, current_date) = private.perf2_member_tasks(test.id('tdr_m1'), current_date - 30, current_date + 30, current_date)
                  and private.perf2_member(test.id('aps_mem'), current_date - 30, current_date + 30, current_date) = private.perf2_member_ai(test.id('aps_mem'), current_date - 30, current_date + 30, current_date),
  'perf2_member reads the task records outside AI Studio and AI Studio''s work inside it');

\echo '   cleanup'
select set_config('request.jwt.claims', '', false);
delete from ai_studio_daily_reports where author_id in (select id from test.users where name like 'aps\_%');
delete from ai_studio_tasks where title like 'APS %';
delete from performance_records where subject_id in (select id from test.users where name like 'aps\_%');
delete from auth.users where email like 'aps.%@example.com';
delete from test.users where name like 'aps\_%';
\echo '=== AI STUDIO PERFORMANCE TESTS PASSED ==='
