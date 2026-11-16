-- =============================================================================
-- AI Studio department (migration 20270105000100): projects, tasks, daily reports and who may see / do what.
-- Runs late in the same database as the other suites (uses their test.* helpers, the Super Admin 'sa' and the Wabastore people for the
-- "another department" cases). Own people: ai_dh (Department Head), ai_tl1 / ai_tl2 (Team Leads), ai_tm1a / ai_tm1b (Tl1's members), ai_tm2a (Tl2's member).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 130. AI Studio'
reset role;
\i supabase/migrations/20270105000100_ai_studio.sql
\i supabase/migrations/20270106000100_ai_studio_superadmin_head.sql

-- count checks on tables the app roles cannot read (notifications are visible to their recipient only): run as the table owner
create or replace function test.sq(p_sql text) returns text language plpgsql security definer as $$
declare v text;
begin execute p_sql into v; return v; end $$;
grant execute on function test.sq(text) to anon, authenticated;

delete from auth.users where email like 'ai.%@example.com';
delete from test.users where name like 'ai\_%';

select test.check((select count(*) = 1 from departments where slug = 'ai-studio' and name = 'AI Studio' and not generates_revenue), 'AI Studio exists as a department (not a revenue department)');
select test.check(test.sq($q$select count(*) = 3 from ai_studio_projects where name in ('AI CRM', 'AI Website', 'AIQR')$q$)::boolean, 'the three starting projects exist');

create or replace function test.aid() returns uuid language sql stable security definer as $$ select id from departments where slug = 'ai-studio' $$;
create or replace function test.aiteam() returns uuid language sql stable security definer as $$ select id from teams where department_id = test.aid() order by created_at limit 1 $$;
create or replace function test.proj(p text) returns uuid language sql stable security definer as $$ select id from ai_studio_projects where name = p $$;
grant execute on all functions in schema test to anon, authenticated;

-- people: the Super Admin makes the Department Head; the Head makes the Team Leads; each Team Lead adds their own Team Members
select test.create_auth_user('ai_dh', 'ai.dh@example.com', '{"full_name":"AI Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.aid()));
select test.create_auth_user('ai_tl1', 'ai.tl1@example.com', '{"full_name":"AI Lead One"}',
  jsonb_build_object('provisioned_by', test.id('ai_dh'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.aiteam()));
select test.create_auth_user('ai_tl2', 'ai.tl2@example.com', '{"full_name":"AI Lead Two"}',
  jsonb_build_object('provisioned_by', test.id('ai_dh'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.aiteam()));
select test.create_auth_user('ai_tm1a', 'ai.tm1a@example.com', '{"full_name":"AI Member 1A"}',
  jsonb_build_object('provisioned_by', test.id('ai_tl1'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.aiteam()));
select test.create_auth_user('ai_tm1b', 'ai.tm1b@example.com', '{"full_name":"AI Member 1B"}',
  jsonb_build_object('provisioned_by', test.id('ai_tl1'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.aiteam()));
select test.create_auth_user('ai_tm2a', 'ai.tm2a@example.com', '{"full_name":"AI Member 2A"}',
  jsonb_build_object('provisioned_by', test.id('ai_tl2'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.aiteam()));

\echo '   dashboards and reporting lines'
select test.check((select default_dashboard = 'ai-studio-head' and department_id = test.aid() from profiles where id = test.id('ai_dh')), 'the Department Head opens the AI Studio Head dashboard');
select test.check((select default_dashboard = 'ai-studio-lead' from profiles where id = test.id('ai_tl1')), 'a Team Lead opens the AI Studio Lead dashboard');
select test.check((select default_dashboard = 'ai-studio-member' from profiles where id = test.id('ai_tm1a')), 'a Team Member opens the AI Studio Member dashboard');
select test.check((select default_dashboard in ('team-member', 'sales-member', 'support-member') from profiles where id = test.id('tm_a')), 'an existing department keeps its own dashboard');
select test.check(private.direct_lead_of(test.id('ai_tm1a')) = test.id('ai_tl1') and private.direct_lead_of(test.id('ai_tm1b')) = test.id('ai_tl1') and private.direct_lead_of(test.id('ai_tm2a')) = test.id('ai_tl2'),
  'every Team Member belongs to the Team Lead who added them');
select test.check((select count(*) = 0 from profiles where role = 'SUPER_ADMIN' and department_id = test.aid()), 'nobody in AI Studio is a Super Admin');

\echo '   no direct table access'
set role authenticated;
select test.login('ai_dh');
select test.must_fail($$select * from ai_studio_projects$$, 'the browser cannot read projects directly', 'permission denied');
select test.must_fail($$select * from ai_studio_daily_reports$$, 'nor reports', 'permission denied');
select test.must_fail($$insert into ai_studio_tasks (project_id, title, assignee_id) values (test.proj('AIQR'), 'x', test.id('ai_tm1a'))$$, 'nor write tasks', 'permission denied');

\echo '   projects: add, duplicates, assignment'
select test.check(jsonb_array_length(ai_studio_projects_list()) = 3, 'the Department Head sees every project');
select test.login('ai_tl1');
select test.check(jsonb_array_length(ai_studio_projects_list()) = 0, 'a Team Lead sees no project before they are put on one');
select test.must_fail($$select ai_studio_project_save(null, 'Sneaky', null)$$, 'a Team Lead cannot add a project', 'FORBIDDEN');
select test.must_fail($$select ai_studio_project_assign(test.proj('AIQR'), test.id('ai_tl1'), true)$$, 'nor put themselves on a project', 'FORBIDDEN');
select test.login('ai_tm1a');
select test.must_fail($$select ai_studio_project_save(null, 'Sneaky', null)$$, 'a Team Member cannot add a project', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select ai_studio_projects_list()$$, 'another department cannot list the projects', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select ai_studio_project_save(null, 'Sneaky', null)$$, 'another Department Head cannot add a project', 'FORBIDDEN');
select test.must_fail($$select ai_studio_overview()$$, 'nor open the overview', 'FORBIDDEN');

select test.login('ai_dh');
select test.check((ai_studio_project_save(null, 'AI Chatbot', 'A chatbot for customers') ->> 'name') = 'AI Chatbot', 'the Department Head adds a project');
select test.must_fail($$select ai_studio_project_save(null, '  ai chatbot ', null)$$, 'a duplicate name (any case, extra spaces) is refused', 'CONFLICT');
select test.must_fail($$select ai_studio_project_save(null, 'A', null)$$, 'a one-letter name is refused', 'VALIDATION_ERROR');
select test.check((ai_studio_project_save(test.proj('AI Chatbot'), 'AI Chatbot', 'A chatbot for our customers', 'ACTIVE') ->> 'description') = 'A chatbot for our customers', 'the project details can be edited');
select test.must_fail($$select ai_studio_project_save(test.proj('AI Chatbot'), 'AIQR', null)$$, 'renaming onto another project is refused', 'CONFLICT');
select test.check(jsonb_array_length(ai_studio_projects_list()) = 4, 'the new project is in the list');

-- Team Leads on projects (one or more)
select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tl1'), true);
select ai_studio_project_assign(test.proj('AI Website'), test.id('ai_tl1'), true);
select ai_studio_project_assign(test.proj('AIQR'), test.id('ai_tl2'), true);
select test.check(test.sq($q$select count(*) = 2 from ai_studio_project_members where profile_id = test.id('ai_tl1')$q$)::boolean, 'a Team Lead can work on several projects');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tl2') and type = 'AI_STUDIO_PROJECT_ASSIGNED'$q$)::boolean, 'the Team Lead is told about the project');
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_dh'), true)$$, 'the Head is not assigned as a worker', 'VALIDATION_ERROR');
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('tm_a'), true)$$, 'nobody from another department can be put on a project', 'VALIDATION_ERROR');
select test.must_fail($$select ai_studio_project_assign(test.proj('AIQR'), test.id('ai_tm1a'), true)$$, 'a Team Member needs their own Team Lead on the project first', 'Put the Team Lead');

-- the creation-form check (before any account exists)
select test.must_fail($$select ai_studio_project_check(test.aid(), 'TEAM_HEAD', test.aiteam(), '{}'::uuid[])$$, 'a new AI Studio Team Lead needs a project', 'Select a project');
select ai_studio_project_check(test.aid(), 'TEAM_HEAD', test.aiteam(), array[test.proj('AI CRM')]);
select test.must_fail($$select ai_studio_project_check(test.aid(), 'TEAM_MEMBER', test.aiteam(), array[test.proj('AI CRM')])$$, 'a Department Head must name the Team Lead of a new member', 'Choose the Team Lead');
select test.must_fail($$select ai_studio_project_check(test.aid(), 'TEAM_MEMBER', test.aiteam(), array[test.proj('AIQR')], test.id('ai_tl1'))$$, 'the member cannot be put on a project their Team Lead is not on', 'not on the selected project');
select ai_studio_project_check(test.aid(), 'TEAM_MEMBER', test.aiteam(), array[test.proj('AI CRM')], test.id('ai_tl1'));
select test.must_fail($$select ai_studio_project_check(test.dept('wabastore'), 'TEAM_HEAD', test.team('wabastore', 'Sales'), array[test.proj('AI CRM')])$$, 'projects cannot be given in another department', 'AI Studio department only');
select ai_studio_project_check(test.dept('wabastore'), 'TEAM_HEAD', test.team('wabastore', 'Sales'), '{}'::uuid[]);
select test.login('ai_tl1');
select ai_studio_project_check(test.aid(), 'TEAM_MEMBER', test.aiteam(), array[test.proj('AI CRM')]);
select test.must_fail($$select ai_studio_project_check(test.aid(), 'TEAM_MEMBER', test.aiteam(), array[test.proj('AI CRM')], test.id('ai_tl2'))$$, 'a Team Lead adds members to their own team only', 'FORBIDDEN');

-- members on projects: by their own Team Lead only
select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm1a'), true);
select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm1b'), true);
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm2a'), true)$$, 'a Team Lead cannot assign another lead''s member', 'FORBIDDEN');
select test.login('ai_tl2');
select ai_studio_project_assign(test.proj('AIQR'), test.id('ai_tm2a'), true);
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm1a'), false)$$, 'nor take another lead''s member off', 'FORBIDDEN');
select test.check(jsonb_array_length(ai_studio_projects_list()) = 1 and (ai_studio_projects_list() -> 0 ->> 'name') = 'AIQR', 'a Team Lead sees only their own projects');
select test.login('ai_tm1a');
select test.check(jsonb_array_length(ai_studio_projects_list()) = 1 and (ai_studio_projects_list() -> 0 ->> 'name') = 'AI CRM', 'a Team Member sees only the projects they were given');

\echo '   people'
select test.login('ai_dh');
select test.check(jsonb_array_length(ai_studio_people()) = 6, 'the Department Head sees all six AI Studio people');
select test.check((select count(*) = 2 from jsonb_array_elements(ai_studio_people()) e where e ->> 'leadName' = 'AI Lead One'), 'the people list shows each member under their Team Lead');
select test.login('ai_tl1');
select test.check(jsonb_array_length(ai_studio_people()) = 3, 'a Team Lead sees themselves and their two members only');
select test.login('ai_tm1a');
select test.must_fail($$select ai_studio_people()$$, 'a Team Member cannot list people', 'FORBIDDEN');

\echo '   tasks'
select test.login('ai_dh');
create temp table ai_t (name text primary key, id uuid);
grant all on ai_t to authenticated;
insert into ai_t select 'lead', (ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tl1'), 'Plan the CRM sprint', 'Break the work down', 'HIGH', (current_date + 10)) ->> 'id')::uuid;
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tl1') and type = 'AI_STUDIO_TASK_ASSIGNED' and entity_id = (select id from ai_t where name = 'lead')$q$)::boolean, 'the Team Lead is notified of a new task');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tl2'), 'x', null, 'LOW', null)$$, 'a task cannot go to someone who is not on the project', 'not on');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tl1'), 'x', null, 'LOW', current_date - 1)$$, 'a deadline in the past is refused', 'cannot be in the past');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tl1'), 'x', null, 'URGENTEST', null)$$, 'an unknown priority is refused', 'Unknown priority');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tl1'), '   ', null, 'LOW', null)$$, 'an empty title is refused', 'title');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_dh'), 'x', null, 'LOW', null)$$, 'a task cannot go to the Head', 'VALIDATION_ERROR');

select test.login('ai_tl1');
insert into ai_t select 'a1', (ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tm1a'), 'Build the login screen', 'With validation', 'MEDIUM', (current_date + 5)) ->> 'id')::uuid;
insert into ai_t select 'a2', (ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tm1a'), 'Write the API tests', null, 'LOW', null) ->> 'id')::uuid;
insert into ai_t select 'b1', (ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tm1b'), 'Design the dashboard', null, 'LOW', (current_date + 3)) ->> 'id')::uuid;
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tm2a'), 'x', null, 'LOW', null)$$, 'a Team Lead cannot give a task to another lead''s member', 'FORBIDDEN');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tl1'), 'x', null, 'LOW', null)$$, 'nor to themselves', 'FORBIDDEN');
select test.must_fail($$select ai_studio_task_assign(test.proj('AIQR'), test.id('ai_tm1a'), 'x', null, 'LOW', null)$$, 'nor on a project the member is not on', 'not on');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1a') and type = 'AI_STUDIO_TASK_ASSIGNED' and entity_id = (select id from ai_t where name = 'a1')$q$)::boolean, 'the Team Member is notified of the task');
select test.check((ai_studio_tasks_list('mine') ->> 'total')::int = 1 and (ai_studio_tasks_list('team') ->> 'total')::int = 4, 'the Team Lead sees their own task and the three they gave');

\echo '   a deadline change notifies the assignee'
select ai_studio_task_edit((select id from ai_t where name = 'a1'), 'Build the login screen', 'With validation and tests', 'HIGH', (current_date + 8));
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1a') and type = 'AI_STUDIO_TASK_DEADLINE'$q$)::boolean, 'the Team Member is told the deadline changed');
select test.must_fail($$select ai_studio_task_edit((select id from ai_t where name = 'lead'), 'x', null, 'LOW', null)$$, 'a Team Lead cannot edit the task the Head gave them', 'NOT_FOUND');

select test.login('ai_tm1a');
select test.check((ai_studio_tasks_list('mine') ->> 'total')::int = 2, 'a Team Member sees only their own two tasks');
select test.must_fail($$select ai_studio_tasks_list('team')$$, 'and not the team list', 'FORBIDDEN');
select test.must_fail($$select ai_studio_task_get((select id from ai_t where name = 'b1'))$$, 'nor a colleague''s task', 'NOT_FOUND');
select test.must_fail($$select ai_studio_task_assign(test.proj('AI CRM'), test.id('ai_tm1b'), 'x', null, 'LOW', null)$$, 'a Team Member cannot assign tasks', 'FORBIDDEN');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'b1'), 'IN_PROGRESS', 10, null)$$, 'nor update a colleague''s task', 'NOT_FOUND');
select test.check((ai_studio_tasks_list('ongoing') ->> 'total')::int = 0, 'nothing is ongoing yet');
select test.check((ai_studio_task_update((select id from ai_t where name = 'a1'), 'IN_PROGRESS', 40, 'Started on the form') ->> 'status') = 'IN_PROGRESS', 'the Team Member starts the task');
select test.check((ai_studio_tasks_list('ongoing') ->> 'total')::int = 1, 'it is now an ongoing task');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'a1'), 'IN_PROGRESS', 100, 'x')$$, '100% only by completing', 'between 0 and 99');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'a1'), 'COMPLETED', 100, null)$$, 'completion needs details', 'Describe what was completed');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'a1'), 'ON_HOLD', 50, null)$$, 'on hold needs a reason', 'why');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'a1'), 'ASSIGNED', 0, null)$$, 'a task cannot go back to Assigned', 'Choose');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'a1'), 'IN_PROGRESS', 50, 'x', '["javascript:alert(1)"]'::jsonb)$$, 'an attachment must be an http(s) link', 'http');
select test.check((ai_studio_task_update((select id from ai_t where name = 'a1'), 'COMPLETED', 0, 'Login screen merged', '["https://example.com/pr/1"]'::jsonb) ->> 'progress')::int = 100, 'completing sets 100% and keeps the link');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'a1'), 'IN_PROGRESS', 10, 'x')$$, 'a completed task stays completed', 'already completed');
select test.check((ai_studio_task_get((select id from ai_t where name = 'a1')) -> 'history') @> '[{"kind":"PROGRESS","status":"COMPLETED"}]'::jsonb
              and jsonb_array_length(ai_studio_task_get((select id from ai_t where name = 'a1')) -> 'history') = 4, 'the progress history keeps every step (assigned, deadline, started, completed)');
select test.check((ai_studio_task_get((select id from ai_t where name = 'a1')) ->> 'completionNote') = 'Login screen merged', 'the completion details are kept');

select test.login('ai_tl1');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tl1') and type = 'AI_STUDIO_TASK_COMPLETED' and entity_id = (select id from ai_t where name = 'a1')$q$)::boolean, 'the Team Lead is told the task was completed');
select test.check((ai_studio_tasks_list('team', null, 'COMPLETED') ->> 'total')::int = 1, 'the Team Lead sees it as completed');
select test.login('ai_tl2');
select test.check((ai_studio_tasks_list('team') ->> 'total')::int = 0, 'another Team Lead sees none of it');
select test.must_fail($$select ai_studio_task_get((select id from ai_t where name = 'a1'))$$, 'nor opens it', 'NOT_FOUND');
select test.must_fail($$select ai_studio_task_get((select id from ai_t where name = 'lead'))$$, 'nor opens the task the Head gave to another Team Lead', 'NOT_FOUND');
select test.check((ai_studio_tasks_list('team') ->> 'total')::int = 0, 'still nothing in the team list');
select test.login('ai_dh');
select test.check((ai_studio_tasks_list('team') ->> 'total')::int = 4, 'the Department Head sees every task');
select test.check((ai_studio_overview() -> 'department' -> 'tasks' ->> 'completed')::int = 1 and (ai_studio_overview() -> 'department' -> 'tasks' ->> 'assigned')::int = 4, 'the overview counts come from the records');
select test.login('tm_a');
select test.must_fail($$select ai_studio_tasks_list('mine')$$, 'another department sees no AI Studio task', 'FORBIDDEN');

\echo '   daily reports: Team Member -> Team Lead -> Department Head'
select test.login('ai_tm1a');
select test.check(ai_studio_report_context() ->> 'reviewer' = 'AI Lead One' and (ai_studio_report_context() ->> 'hasReviewer')::boolean, 'the form tells the member who reviews the report');
insert into ai_t select 'r1', (ai_studio_report_save(null, test.proj('AI CRM'), (select id from ai_t where name = 'a1'), (current_date), 'Login screen done', 'API tests', 'Docs', 'None', 'ok', false) ->> 'id')::uuid;
select test.check(test.sq($q$select status = 'DRAFT' from ai_studio_daily_reports where id = (select id from ai_t where name = 'r1')$q$)::boolean, 'a new report is a draft');
select test.must_fail($$select ai_studio_report_save(null, test.proj('AI CRM'), (select id from ai_t where name = 'a1'), current_date, 'again', null, null, null, null, false)$$, 'a second report for the same project, task and day is refused', 'already have a report');
select test.must_fail($$select ai_studio_report_save(null, test.proj('AIQR'), null, current_date, 'x', null, null, null, null, false)$$, 'a project the member is not on is refused', 'Choose one of your projects');
select test.must_fail($$select ai_studio_report_save(null, test.proj('AI CRM'), (select id from ai_t where name = 'b1'), current_date, 'x', null, null, null, null, false)$$, 'a colleague''s task cannot be reported on', 'assigned to you');
select test.must_fail($$select ai_studio_report_save(null, test.proj('AI CRM'), null, current_date + 3, 'x', null, null, null, null, false)$$, 'a future date is refused', 'future');
select test.must_fail($$select ai_studio_report_save(null, test.proj('AI CRM'), null, current_date - 90, 'x', null, null, null, null, false)$$, 'a very old date is refused', '60 days');
select test.must_fail($$select ai_studio_report_save((select id from ai_t where name = 'r1'), test.proj('AI CRM'), (select id from ai_t where name = 'a1'), current_date, '   ', null, null, null, null, true)$$, 'submitting needs the work completed', 'Describe the work');
select test.login('ai_tm1b');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r1'))$$, 'a colleague cannot read a draft', 'NOT_FOUND');
select test.must_fail($$select ai_studio_report_save((select id from ai_t where name = 'r1'), test.proj('AI CRM'), null, current_date, 'hijack', null, null, null, null, true)$$, 'nor change it', 'NOT_FOUND');
select test.login('ai_tm1a');
select test.check((ai_studio_report_save((select id from ai_t where name = 'r1'), test.proj('AI CRM'), (select id from ai_t where name = 'a1'), current_date, 'Login screen done and merged', 'API tests', 'Docs', 'None', 'ok', true) ->> 'status') = 'PENDING_TL_APPROVAL', 'submitting sends it to the Team Lead');
select test.must_fail($$select ai_studio_report_save((select id from ai_t where name = 'r1'), test.proj('AI CRM'), null, current_date, 'edit after submit', null, null, null, null, false)$$, 'a submitted report cannot be changed', 'already submitted');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null)$$, 'a Team Member cannot approve (not even their own)', 'FORBIDDEN');
select test.must_fail($$select ai_studio_report_delete_draft((select id from ai_t where name = 'r1'))$$, 'a submitted report cannot be deleted', 'NOT_FOUND');

select test.login('ai_tl1');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tl1') and type = 'AI_STUDIO_REPORT_SUBMITTED' and entity_id = (select id from ai_t where name = 'r1')$q$)::boolean, 'the Team Lead is notified');
select test.check((ai_studio_reports_list('team') ->> 'total')::int = 1, 'the report is in the Team Lead''s team list');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r1')) ->> 'canReview')::boolean, 'the Team Lead may review it');
select test.login('ai_tl2');
select test.check((ai_studio_reports_list('team') ->> 'total')::int = 0, 'another Team Lead''s team list is empty');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r1'))$$, 'another Team Lead cannot open it', 'NOT_FOUND');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null)$$, 'nor decide it', 'NOT_FOUND');
select test.login('ai_dh');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null)$$, 'the Head cannot skip the Team Lead', 'not waiting for your decision');
select test.login('sa');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r1')) ->> 'id')::uuid = (select id from ai_t where name = 'r1'), 'the Super Admin can read it');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null)$$, 'but the Super Admin cannot skip the Team Lead either', 'not waiting for your decision');

select test.login('ai_tl1');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'RETURN', null)$$, 'returning needs remarks', 'remarks');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'MAYBE', 'x')$$, 'an unknown decision is refused', 'Approve or Return');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r1'), 'RETURN', 'Add the test results') ->> 'status') = 'RETURNED_BY_TL', 'the Team Lead returns it with remarks');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1a') and type = 'AI_STUDIO_REPORT_RETURNED' and entity_id = (select id from ai_t where name = 'r1')$q$)::boolean, 'the Team Member is told it was returned');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null)$$, 'a returned report cannot be approved until it is resubmitted', 'not waiting');

select test.login('ai_tm1a');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r1')) ->> 'tlComment') = 'Add the test results' and (ai_studio_report_get((select id from ai_t where name = 'r1')) ->> 'canEdit')::boolean, 'the member sees the remarks and can edit');
select test.check((ai_studio_report_save((select id from ai_t where name = 'r1'), test.proj('AI CRM'), (select id from ai_t where name = 'a1'), current_date, 'Login screen done, tests attached', 'API tests', 'Docs', 'None', 'ok', true) ->> 'revision')::int = 2, 'resubmitting starts a new round');

select test.login('ai_tl1');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', 'Good work') ->> 'status') = 'PENDING_DH_APPROVAL', 'the Team Lead approves: the report moves to the Department Head');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_dh') and type = 'AI_STUDIO_REPORT_PENDING_HEAD' and entity_id = (select id from ai_t where name = 'r1')$q$)::boolean, 'the Department Head is notified');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1a') and type = 'AI_STUDIO_REPORT_TL_APPROVED'$q$)::boolean, 'the Team Member is told their Team Lead approved');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null)$$, 'the Team Lead cannot approve it a second time', 'not waiting');

select test.login('ai_dh');
select test.check((ai_studio_reports_list('department', null, 'PENDING_DH_APPROVAL') ->> 'total')::int = 1, 'the Department Head sees the forwarded report');
select test.check((ai_studio_reports_list('department', test.proj('AIQR')) ->> 'total')::int = 0 and (ai_studio_reports_list('department', test.proj('AI CRM'), null, test.id('ai_tl1')) ->> 'total')::int = 1
               and (ai_studio_reports_list('department', null, null, test.id('ai_tl2')) ->> 'total')::int = 0 and (ai_studio_reports_list('department', null, null, null, test.id('ai_tm1a')) ->> 'total')::int = 1,
  'the Department Head can filter by project, Team Lead and Team Member');
select test.check((ai_studio_reports_list('department', null, null, null, null, current_date + 1, null) ->> 'total')::int = 0, 'and by date');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r1'), 'RETURN', 'Please add the demo link') ->> 'status') = 'RETURNED_BY_DH', 'the Department Head can return it');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tl1') and type = 'AI_STUDIO_REPORT_RETURNED' and body like '%demo link%'$q$)::boolean, 'the Team Lead is told as well');
select test.login('ai_tm1a');
select test.check((ai_studio_report_save((select id from ai_t where name = 'r1'), test.proj('AI CRM'), (select id from ai_t where name = 'a1'), current_date, 'Login screen done, tests and demo link', 'API tests', 'Docs', 'None', 'ok', true) ->> 'status') = 'PENDING_TL_APPROVAL', 'after a Head''s return the report goes through the Team Lead again');
select test.login('ai_tl1');
select ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', null);
select test.login('ai_dh');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r1'), 'APPROVE', 'Approved') ->> 'status') = 'APPROVED', 'the Department Head gives the final approval');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1a') and type = 'AI_STUDIO_REPORT_APPROVED'$q$)::boolean, 'the Team Member is told it is approved');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r1'), 'RETURN', 'late')$$, 'an approved report cannot be returned', 'not waiting');
select test.login('ai_tm1a');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r1')) ->> 'status') = 'APPROVED', 'the final status is visible to the Team Member');
select test.check(jsonb_array_length(ai_studio_report_get((select id from ai_t where name = 'r1')) -> 'history') = 9
              and (ai_studio_report_get((select id from ai_t where name = 'r1')) -> 'history' -> 8 ->> 'actorName') = 'AI Head', 'the full history is kept: reviewer, time, status and remarks of every step');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r1')) -> 'history' @> '[{"action":"RETURNED","stage":"TEAM_LEAD","comment":"Add the test results"}]'::jsonb), 'including the remarks of each return');

\echo '   a Team Lead''s own report goes to the Department Head'
select test.login('ai_tl1');
insert into ai_t select 'r2', (ai_studio_report_save(null, test.proj('AI CRM'), (select id from ai_t where name = 'lead'), current_date, 'Sprint planned', null, 'Review', null, null, true) ->> 'id')::uuid;
select test.check(test.sq($q$select status = 'PENDING_DH_APPROVAL' and lead_id is null from ai_studio_daily_reports where id = (select id from ai_t where name = 'r2')$q$)::boolean, 'a Team Lead''s report waits for the Department Head only');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r2'), 'APPROVE', null)$$, 'a Team Lead cannot approve their own report', 'FORBIDDEN');
select test.check((ai_studio_reports_list('mine') ->> 'total')::int = 1 and not ((ai_studio_reports_list('team') -> 'items') @> '[{"authorRole":"LEAD"}]'::jsonb), 'it is in My Daily Reports, not in the team list of members'' reports');
select test.login('ai_tl2');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r2'))$$, 'another Team Lead cannot read it', 'NOT_FOUND');
select test.login('ai_dh');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_dh') and type = 'AI_STUDIO_REPORT_PENDING_HEAD' and entity_id = (select id from ai_t where name = 'r2')$q$)::boolean, 'the Department Head is told');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r2'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'the Department Head approves it');
select test.must_fail($$select ai_studio_reports_list('mine')$$, 'the Head has no "my reports"', 'FORBIDDEN');

\echo '   drafts stay private; other departments see nothing'
select test.login('ai_tm2a');
insert into ai_t select 'r3', (ai_studio_report_save(null, test.proj('AIQR'), null, current_date, 'Drafting', null, null, null, null, false) ->> 'id')::uuid;
select test.login('ai_dh');
select test.check((ai_studio_reports_list('department') ->> 'total')::int = 2, 'a draft is not in the department list');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r3'))$$, 'the Head cannot open a draft', 'NOT_FOUND');
select test.login('ai_tl2');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r3'))$$, 'nor the Team Lead', 'NOT_FOUND');
select test.login('ai_tm2a');
select ai_studio_report_delete_draft((select id from ai_t where name = 'r3'));
select test.check(test.sq($q$select count(*) = 0 from ai_studio_daily_reports where project_id = test.proj('AIQR')$q$)::boolean, 'the author can delete their own draft');
select test.login('dh_wab');
select test.must_fail($$select ai_studio_reports_list('department')$$, 'another Department Head sees no AI Studio report', 'FORBIDDEN');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r1'))$$, 'nor opens one', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select ai_studio_report_save(null, test.proj('AI CRM'), null, current_date, 'x', null, null, null, null, false)$$, 'another department cannot write an AI Studio report', 'FORBIDDEN');

\echo '   a Team Member with no Team Lead cannot submit'
reset role;
select test.create_auth_user('ai_tm_orphan', 'ai.orphan@example.com', '{"full_name":"AI Orphan"}',
  jsonb_build_object('provisioned_by', test.id('ai_dh'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.aiteam()));
select test.check(private.direct_lead_of(test.id('ai_tm_orphan')) is null, 'a member added by the Head to a team with two leads has no lead yet');
set role authenticated;
select test.login('ai_dh');
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm_orphan'), true)$$, 'they cannot be put on a project', 'no Team Lead yet');
select assign_direct_lead(test.id('ai_tm_orphan'), test.id('ai_tl2'));
select ai_studio_project_assign(test.proj('AIQR'), test.id('ai_tm_orphan'), true);
select test.check(test.sq($q$select private.direct_lead_of(test.id('ai_tm_orphan')) = test.id('ai_tl2')$q$)::boolean, 'the Head names the Team Lead with the existing assign-lead function');
select test.must_fail($$select ai_studio_project_assign(test.proj('AIQR'), test.id('ai_tl2'), false)$$, 'a Team Lead cannot be taken off a project while their members are on it', 'Take the Team Members');
select test.login('ai_tm1a');
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm1a'), false)$$, 'a member cannot take themselves off', 'FORBIDDEN');

\echo '   changing the Team Lead of a Team Member'
select test.login('ai_dh');
select test.must_fail($$select ai_studio_set_lead(test.id('ai_tm1a'), test.id('ai_tl2'))$$, 'the new Team Lead must be on the member''s projects', 'Put them on it first');
select test.must_fail($$select ai_studio_set_lead(test.id('ai_tl1'), test.id('ai_tl2'))$$, 'only a Team Member has a Team Lead to change', 'NOT_FOUND');
select test.must_fail($$select ai_studio_set_lead(test.id('ai_tm_orphan'), test.id('ai_tm1a'))$$, 'the lead must be a Team Lead', 'Team Lead');
select ai_studio_set_lead(test.id('ai_tm_orphan'), test.id('ai_tl2'));
select test.login('ai_tl1');
select test.must_fail($$select ai_studio_set_lead(test.id('ai_tm1a'), test.id('ai_tl1'))$$, 'a Team Lead cannot move people between leads', 'FORBIDDEN');
\echo '   the Super Admin is the Department Head: the final approval (no Department Head account involved)'
select test.login('ai_tm1b');
insert into ai_t select 'r4', (ai_studio_report_save(null, test.proj('AI CRM'), null, current_date, 'Designed the dashboard', null, null, null, null, true) ->> 'id')::uuid;
select test.login('sa');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r4'), 'APPROVE', null)$$, 'the Super Admin cannot decide before the Team Lead', 'not waiting for your decision');
select test.login('ai_tl1');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r4'), 'APPROVE', 'Fine') ->> 'status') = 'PENDING_DH_APPROVAL', 'the Team Lead approves: the report reaches the Super Admin');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'AI_STUDIO_REPORT_PENDING_HEAD' and entity_id = (select id from ai_t where name = 'r4')$q$)::boolean, 'the Super Admin is notified');
select test.login('sa');
select test.check((ai_studio_reports_list('department', null, 'PENDING_DH_APPROVAL') -> 'items') @> jsonb_build_array(jsonb_build_object('authorName', 'AI Member 1B')), 'the Super Admin sees it among the reports awaiting the final decision');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r4')) ->> 'canReview')::boolean, 'and may decide it');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r4'), 'RETURN', null)$$, 'a return needs remarks', 'remarks');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r4'), 'RETURN', 'Add screenshots') ->> 'status') = 'RETURNED_BY_DH', 'the Super Admin can return it with remarks');
select test.check(test.sq($q$select count(*) = 1 from notifications where recipient_id = test.id('ai_tm1b') and type = 'AI_STUDIO_REPORT_RETURNED' and entity_id = (select id from ai_t where name = 'r4')$q$)::boolean
               and test.sq($q$select count(*) >= 1 from notifications where recipient_id = test.id('ai_tl1') and type = 'AI_STUDIO_REPORT_RETURNED' and body like '%screenshots%'$q$)::boolean, 'the Team Member and the Team Lead are told');
select test.login('ai_tm1b');
select ai_studio_report_save((select id from ai_t where name = 'r4'), test.proj('AI CRM'), null, current_date, 'Designed the dashboard, screenshots added', null, null, null, null, true);
select test.login('ai_tl1');
select ai_studio_report_review((select id from ai_t where name = 'r4'), 'APPROVE', null);
select test.login('sa');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r4'), 'APPROVE', 'Approved') ->> 'status') = 'APPROVED', 'the Super Admin gives the final approval');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r4'), 'RETURN', 'late')$$, 'there is no stage after the Super Admin', 'not waiting');
select test.login('ai_tm1b');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r4')) ->> 'status') = 'APPROVED' and (ai_studio_report_get((select id from ai_t where name = 'r4')) -> 'history' -> -1 ->> 'actorName') = 'Root', 'the final status and the Super Admin''s step are visible to the Team Member');
select test.login('ai_tl1');
select test.check((ai_studio_report_get((select id from ai_t where name = 'r4')) ->> 'status') = 'APPROVED', 'and to the Team Lead');
select test.login('ai_tl2');
select test.must_fail($$select ai_studio_report_get((select id from ai_t where name = 'r4'))$$, 'another Team Lead sees nothing of it', 'NOT_FOUND');
select test.login('dh_wab');
select test.must_fail($$select ai_studio_report_review((select id from ai_t where name = 'r4'), 'RETURN', 'Not mine to decide')$$, 'another department''s head cannot decide it', 'FORBIDDEN');
-- a Team Lead's own report goes to the Super Admin
select test.login('ai_tl2');
insert into ai_t select 'r5', (ai_studio_report_save(null, test.proj('AIQR'), null, current_date, 'Reviewed the AIQR designs', null, null, null, null, true) ->> 'id')::uuid;
select test.check(test.sq($q$select status = 'PENDING_DH_APPROVAL' from ai_studio_daily_reports where id = (select id from ai_t where name = 'r5')$q$)::boolean, 'a Team Lead''s own report waits for the Super Admin');
select test.login('sa');
select test.check((ai_studio_report_review((select id from ai_t where name = 'r5'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'and the Super Admin approves it');
select test.check((ai_studio_overview() -> 'department' ->> 'reportsAwaitingHead')::int >= 0 and (ai_studio_overview() ->> 'role') = 'ADMIN', 'the Super Admin''s AI Studio overview works');
select test.must_fail($$select ai_studio_task_update((select id from ai_t where name = 'b1'), 'IN_PROGRESS', 10, 'x')$$, 'the Super Admin is not a worker: tasks are updated by their assignee', 'FORBIDDEN');

\echo '   removing a person from a project'
select test.login('ai_dh');
select test.must_fail($$select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm1b'), false)$$, 'someone with an open task stays on the project', 'open tasks');
select test.login('ai_tm1b');
select ai_studio_task_update((select id from ai_t where name = 'b1'), 'COMPLETED', 100, 'Done');
select test.login('ai_tl1');
select ai_studio_project_assign(test.proj('AI CRM'), test.id('ai_tm1b'), false);
select test.check(test.sq($q$select not private.ai_studio_on_project(test.proj('AI CRM'), test.id('ai_tm1b'))$q$)::boolean, 'once the work is done the member can leave the project');

\echo '   shared features work for AI Studio people (attendance, chat, leave, notifications)'
reset role;
select test.check(private.chat_may_message(test.id('ai_tm1a'), test.id('ai_tl1')) and private.chat_may_message(test.id('ai_tl1'), test.id('ai_tm1a')), 'a Team Member and their Team Lead can chat');
select test.check(private.chat_may_message(test.id('sa'), test.id('ai_tl1')) and private.chat_may_message(test.id('ai_tm1a'), test.id('sa')) and private.chat_may_message(test.id('ai_tl2'), test.id('sa')), 'the Super Admin and the AI Studio team can chat both ways');
select test.check(private.chat_may_message(test.id('ai_tl1'), test.id('ai_dh')) and private.chat_may_message(test.id('ai_dh'), test.id('ai_tm1a')), 'the Team Lead and the Department Head can chat; the Head reaches the members');
set role authenticated;
select test.login('ai_tm1a');
select test.check((submit_leave_request('FULL_DAY', current_date + 20, null, null, 'Family function') ->> 'status') is not null, 'an AI Studio member can apply for leave (the existing leave module)');
select test.login('ai_tl1');
select test.check(jsonb_array_length(leave_requests_to_review() -> 'awaiting') >= 1, 'the leave request reaches their Team Lead first (existing approval chain)');
select test.login('ai_tl2');
select test.check(jsonb_array_length(leave_requests_to_review() -> 'awaiting') = 0, 'and not another Team Lead');
select test.login('ai_tm1a');
select test.check(test.sq($q$select count(*) >= 3 from notifications where recipient_id = test.id('ai_tm1a') and type like 'AI_STUDIO_%'$q$)::boolean, 'notifications reach the employee');

\echo '   other departments are unaffected'
select test.login('tm_a');
select test.check((select count(*) >= 0 from customers), 'a Wabastore member still reads their department''s data');
reset role;
select test.check((select count(*) = 1 from departments where slug = 'wabastore') and (select default_dashboard is not null from profiles where id = test.id('dh_wab')), 'the existing departments and their dashboards are intact');
\echo '   AI Studio checks passed'
