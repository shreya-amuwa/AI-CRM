-- =============================================================================
-- AI Design Studio (migration 20270105000100): the separate department, its clients, notices, assignments, daily reports and issues.
-- Own synthetic people (prefix ads_) in the real 'ai-design-studio' department; other departments' people (Sales, Support, Accounts,
-- a second department) are used only to prove that they are locked out. Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 130. AI Design Studio'
reset role;
\i supabase/migrations/20270105000100_ai_design_studio.sql
\i supabase/migrations/20270105000100_ai_design_studio.sql

truncate public.ads_events;
delete from public.ads_issues;
delete from public.ads_reports;
delete from public.ads_assignments;
delete from public.ads_client_notices;
delete from public.ads_clients;
delete from auth.users where email like 'ads.%@example.com';
delete from test.users where name like 'ads\_%';
insert into departments (slug, name) values ('ads-other', 'ADS Other Dept') on conflict do nothing;
insert into teams (department_id, name, division) select d.id, 'General', 'GENERAL' from departments d where d.slug = 'ads-other' on conflict do nothing;

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.adsmk(p_name text, p_role text, p_dept text default 'ai-design-studio', p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'ads.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'ADS ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role,
      'provisioned_department_id', case when p_role = 'DEPARTMENT_HEAD' then test.dept(p_dept) end,
      'provisioned_team_id', case when p_role = 'DEPARTMENT_HEAD' then null else test.team(p_dept, 'General') end)))
$$;
create or replace function test.asg(p_id uuid) returns setof public.ads_assignments language sql stable security definer set search_path = '' as $$ select * from public.ads_assignments where id = p_id $$;
create or replace function test.rep(p_id uuid) returns setof public.ads_reports language sql stable security definer set search_path = '' as $$ select * from public.ads_reports where id = p_id $$;
create or replace function test.lead_of(p_user text) returns uuid language sql stable security definer set search_path = '' as $$ select private.direct_lead_of(test.id(p_user)) $$;
create or replace function test.notif(p_user text) returns setof public.notifications language sql stable security definer set search_path = '' as $$
  select * from public.notifications where recipient_id = test.id(p_user) $$;
grant execute on all functions in schema test to anon, authenticated;
create temp table ads_ids (name text primary key, id uuid);
grant all on ads_ids to anon, authenticated, service_role;

\echo '   the department exists, is separate, and every existing department is untouched'
select test.check((select count(*) = 1 from departments where slug = 'ai-design-studio' and name = 'AI Design Studio'), 'AI Design Studio is a department');
select test.check((select count(*) = 1 from teams t join departments d on d.id = t.department_id where d.slug = 'ai-design-studio'), 'it has one General team');
select test.check(not exists (select 1 from departments where slug in ('ai-studio', 'designstudio') and name = 'AI Design Studio'), 'it is not AI Studio and not Amuwa Design Studio');
select test.check((select name from departments where slug = 'designstudio') = 'Amuwa Design Studio', 'Amuwa Design Studio keeps its name and slug');

\echo '   people: a Team Member is created BEFORE any Team Lead exists'
select test.service(); select test.adsmk('ads_dh', 'DEPARTMENT_HEAD');
select test.service(); select test.adsmk('ads_m0', 'TEAM_MEMBER', 'ai-design-studio', 'ads_dh');
select test.check((select status = 'ACTIVE' and manager_id is null from profiles where id = test.id('ads_m0')) and private.direct_lead_of(test.id('ads_m0')) is null,
  'a Team Member can be created with no Team Lead at all (unassigned, active, able to sign in)');
\echo '   unassigned member: reports and issues go straight to the Department Head'
set role authenticated;
select test.login('ads_m0');
select test.check((public.ads_context() ->> 'unassigned')::boolean and public.ads_context() ->> 'leadId' is null, 'the member sees they have no Team Lead yet');
insert into ads_ids select 'r0', (public.ads_report_submit(jsonb_build_object('workCompleted', 'Logo draft v1', 'clientRequestId', 'r0')) ->> 'id')::uuid;
insert into ads_ids select 'i0', (public.ads_issue_create(jsonb_build_object('title', 'No brief received', 'description', 'The client has not shared the brief', 'category', 'CLIENT_REQUIREMENTS', 'clientRequestId', 'i0')) ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING_DH' from ads_reports where id = (select id from ads_ids where name = 'r0')), 'an unassigned member''s report waits for the Department Head directly');
select test.check((select handler_level = 'DEPARTMENT_HEAD' from ads_issues where id = (select id from ads_ids where name = 'i0')), 'an unassigned member''s issue goes to the Department Head');
select test.check((select count(*) = 1 from test.notif('ads_dh') where true and entity_id = (select id from ads_ids where name = 'r0')), 'the Department Head is notified of the report');

select test.service(); select test.adsmk('ads_l1', 'TEAM_HEAD');
select test.service(); select test.adsmk('ads_l2', 'TEAM_HEAD');
select test.service(); select test.adsmk('ads_m1', 'TEAM_MEMBER', 'ai-design-studio', 'ads_l1');
select test.service(); select test.adsmk('ads_m2', 'TEAM_MEMBER', 'ai-design-studio', 'ads_l2');
select test.service(); select test.adsmk('ads_m3', 'TEAM_MEMBER', 'ai-design-studio', 'ads_dh');
select test.service(); select test.adsmk('ads_x', 'TEAM_MEMBER', 'ads-other');
select test.check((select count(*) = 8 from profiles where id in (select id from test.users where name like 'ads\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');
select test.check(private.direct_lead_of(test.id('ads_m0')) is null, 'with two Team Leads the early member is still unassigned (nobody was named)');

\echo '   a Team Member is assigned to a Team Lead later'
set role authenticated;
select test.login('ads_dh');
select assign_member_to_team_lead(test.id('ads_m0'), test.id('ads_l1'));
reset role;
select test.check(private.direct_lead_of(test.id('ads_m0')) = test.id('ads_l1'), 'the Department Head names Team Lead 1 for the early member');

\echo '   who may use AI Design Studio at all'
set role authenticated;
select test.login('sa');
select test.must_fail($$select public.ads_context()$$, 'the Super Admin has no AI Design Studio workspace', 'AI Design Studio employees');
select test.login('tm_a');
select test.must_fail($$select public.ads_clients_list()$$, 'a Sales member is refused', 'AI Design Studio employees');
select test.login('dh_wab');
select test.must_fail($$select public.ads_overview()$$, 'another department''s head is refused', 'AI Design Studio employees');
select test.login('ads_x');
select test.must_fail($$select public.ads_client_create('{"clientName":"Nope"}')$$, 'a member of another department is refused', 'AI Design Studio employees');
reset role;
select test.must_fail($$select public.ads_context()$$, 'a signed-out caller (anon) is refused', 'permission denied|AI Design Studio employees');
set role anon;
select test.must_fail($$select public.ads_clients_list()$$, 'anon cannot call the functions', 'permission denied');
select test.must_fail($$select * from public.ads_clients$$, 'anon cannot read the tables', 'permission denied');
set role authenticated;
select test.login('ads_m1');
select test.must_fail($$select * from public.ads_clients$$, 'a member cannot read the table directly (only through the functions)', 'permission denied');
select test.must_fail($$insert into public.ads_assignments (department_id, client_id, title, assigned_by, assignee_id) values (gen_random_uuid(), gen_random_uuid(), 'x', gen_random_uuid(), gen_random_uuid())$$, 'nor write it', 'permission denied');
reset role;

\echo '   Client Add: saved, duplicates refused, scoped'
set role authenticated;
select test.login('ads_m1');
insert into ads_ids select 'c1', (public.ads_client_create(jsonb_build_object('clientName', 'Acme Foods', 'companyName', 'Acme Pvt Ltd', 'contactPerson', 'Ravi', 'contactNumber', '+91 98765 43210',
  'email', 'Ravi@Acme.com', 'designService', 'Packaging design', 'requirements', 'Eco look', 'attachments', jsonb_build_array(jsonb_build_object('name', 'brief', 'url', 'https://example.com/brief.pdf')))) ->> 'id')::uuid;
select test.check((select public.ads_client_get((select id from ads_ids where name = 'c1')) ->> 'email') = 'ravi@acme.com', 'the client is saved (email lower-cased)');
select test.check((select public.ads_client_get((select id from ads_ids where name = 'c1')) ->> 'createdBy') = test.id('ads_m1')::text, 'the employee who added the client is kept');
select test.must_fail($$select public.ads_client_create('{"clientName":"acme foods","companyName":"ACME PVT LTD","email":"ravi@acme.com"}')$$, 'the same client is not saved twice', 'already saved');
select test.must_fail($$select public.ads_client_create('{"clientName":""}')$$, 'a client needs a name', 'client name');
select test.must_fail($$select public.ads_client_create('{"clientName":"Bad Mail","email":"nope"}')$$, 'a bad email is refused', 'valid email');
select test.must_fail($$select public.ads_client_create('{"clientName":"Bad Link","attachments":[{"url":"javascript:alert(1)"}]}')$$, 'a javascript: link is refused', 'http');
select test.login('ads_m2');
select test.check((select jsonb_array_length(public.ads_clients_list()) = 0), 'a member of the other Team Lead does not see a colleague''s client');
select test.must_fail(format($$select public.ads_client_get('%s')$$, (select id from ads_ids where name = 'c1')), 'nor open it by id', 'not found');
select test.login('ads_l1');
select test.check((select jsonb_array_length(public.ads_clients_list()) = 1), 'the creator''s Team Lead sees it');
select test.login('ads_l2');
select test.check((select jsonb_array_length(public.ads_clients_list()) = 0), 'another Team Lead does not');
select test.login('ads_dh');
insert into ads_ids select 'c2', (public.ads_client_create('{"clientName":"Beta Studio"}') ->> 'id')::uuid;
select test.check((select jsonb_array_length(public.ads_clients_list()) = 2), 'the Department Head sees every client');
select test.check((select public.ads_client_update((select id from ads_ids where name = 'c2'), '{"remarks":"VIP"}') ->> 'remarks') = 'VIP', 'and updates one');
select test.login('ads_m1');
select test.must_fail(format($$select public.ads_client_update('%s', '{"remarks":"x"}')$$, (select id from ads_ids where name = 'c2')), 'a member cannot update a client they do not see', 'not found');
reset role;

\echo '   Assign: Department Head -> Team Lead -> Team Member'
set role authenticated;
select test.login('ads_dh');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('clientId', '%s', 'title', 'Brand kit', 'assigneeId', '%s'))$$, (select id from ads_ids where name = 'c1'), test.id('ads_m1')),
  'work for a member who has a Team Lead goes to the Team Lead, not straight to the member', 'Assign the work to the Team Lead');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('clientId', '%s', 'title', 'Brand kit', 'assigneeId', '%s'))$$, (select id from ads_ids where name = 'c1'), test.id('ads_x')),
  'nobody from another department can receive work', 'Team Lead or Team Member of AI Design Studio');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('clientId', '%s', 'title', 'Old', 'assigneeId', '%s', 'dueDate', '2000-01-01'))$$, (select id from ads_ids where name = 'c1'), test.id('ads_l1')),
  'a deadline in the past is refused', 'past');
insert into ads_ids select 'a1', (public.ads_assignment_create(jsonb_build_object('clientId', (select id from ads_ids where name = 'c1'), 'title', 'Brand kit', 'description', 'Logo + colours',
  'priority', 'HIGH', 'dueDate', (current_date + 10)::text, 'assigneeId', test.id('ads_l1'), 'instructions', 'Start with the logo')) ->> 'id')::uuid;
select test.check((select count(*) = 1 from test.notif('ads_l1') where true and entity_id = (select id from ads_ids where name = 'a1') and type = 'ADS_ASSIGNMENT'), 'the Team Lead is notified');
select test.login('ads_l1');
select test.check((select jsonb_array_length(public.ads_assignments_list('mine')) = 1), 'the assignment is in the Team Lead''s dashboard');
select test.check((select jsonb_array_length(public.ads_clients_list()) = 1), 'and the client of the assignment');
select test.login('ads_l2');
select test.check((select jsonb_array_length(public.ads_assignments_list('all')) = 0), 'another Team Lead does not see it');
select test.must_fail(format($$select public.ads_assignment_get('%s')$$, (select id from ads_ids where name = 'a1')), 'nor open it by id', 'not found');
select test.login('ads_l1');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('title', 'x', 'assigneeId', '%s', 'parentId', '%s'))$$, test.id('ads_m2'), (select id from ads_ids where name = 'a1')),
  'a Team Lead cannot give work to another lead''s member', 'own Team Members');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('title', 'x', 'assigneeId', '%s', 'parentId', '%s'))$$, test.id('ads_l2'), (select id from ads_ids where name = 'a1')),
  'nor to another Team Lead', 'own Team Members');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('title', 'x', 'assigneeId', '%s'))$$, test.id('ads_m1')),
  'a Team Lead can only pass on work the Department Head gave them', 'assignments you received');
insert into ads_ids select 'a1m', (public.ads_assignment_create(jsonb_build_object('assigneeId', test.id('ads_m1'), 'parentId', (select id from ads_ids where name = 'a1'), 'instructions', 'Draft 3 logos')) ->> 'id')::uuid;
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('assigneeId', '%s', 'parentId', '%s'))$$, test.id('ads_m1'), (select id from ads_ids where name = 'a1')), 'a retry does not create a second copy', 'already has this assignment');
select test.check((select status = 'IN_PROGRESS' from test.asg((select id from ads_ids where name = 'a1'))), 'passing work on moves the Team Lead''s own assignment to In Progress');
select test.check((select title = 'Brand kit' and client_id = (select id from ads_ids where name = 'c1') and due_date = current_date + 10 from test.asg((select id from ads_ids where name = 'a1m'))), 'the member''s part carries the title, client and deadline');
select test.login('ads_m1');
select test.check((select jsonb_array_length(public.ads_assignments_list('all')) = 1), 'the member sees only their own assignment');
select test.check((select jsonb_array_length(public.ads_clients_list()) >= 1), 'and the client of it');
select test.must_fail(format($$select public.ads_assignment_create(jsonb_build_object('assigneeId', '%s', 'clientId', '%s', 'title', 'x'))$$, test.id('ads_m2'), (select id from ads_ids where name = 'c1')), 'a member cannot assign work', 'cannot assign');
select test.check((select public.ads_assignment_set_status((select id from ads_ids where name = 'a1m'), 'ACCEPTED') ->> 'status') = 'ACCEPTED', 'the member accepts');
select test.check((select public.ads_assignment_set_status((select id from ads_ids where name = 'a1m'), 'IN_PROGRESS', 40, 'half way') ->> 'progress') = '40', 'updates the progress');
select test.must_fail(format($$select public.ads_assignment_set_status('%s', 'COMPLETED')$$, (select id from ads_ids where name = 'a1m')), 'a member cannot complete their own work (the assigner does)', 'decided by the person who assigned');
select test.check((select public.ads_assignment_set_status((select id from ads_ids where name = 'a1m'), 'PENDING_REVIEW') ->> 'status') = 'PENDING_REVIEW', 'sends it for review');
select test.must_fail(format($$select public.ads_assignment_update('%s', '{"dueDate":"2099-01-01"}')$$, (select id from ads_ids where name = 'a1m')), 'a member cannot move the deadline', 'Only the person who assigned');
select test.login('ads_m2');
select test.must_fail(format($$select public.ads_assignment_set_status('%s', 'IN_PROGRESS')$$, (select id from ads_ids where name = 'a1m')), 'another member cannot touch it', 'not found');
select test.login('ads_l1');
select test.check((select public.ads_assignment_set_status((select id from ads_ids where name = 'a1m'), 'REVISION_REQUIRED', null, 'Make it bolder') ->> 'status') = 'REVISION_REQUIRED', 'the Team Lead sends it back');
select test.must_fail(format($$select public.ads_assignment_set_status('%s', 'REVISION_REQUIRED')$$, (select id from ads_ids where name = 'a1m')), 'a revision needs a note', 'what must be revised');
select test.check((select public.ads_assignment_update((select id from ads_ids where name = 'a1m'), jsonb_build_object('dueDate', (current_date + 12)::text)) ->> 'dueDate') = (current_date + 12)::text, 'the Team Lead moves the member''s deadline');
select test.check((select count(*) = 1 from test.notif('ads_m1') where true and type = 'ADS_ASSIGNMENT_DEADLINE'), 'the member is told about the new deadline');
select test.check((select jsonb_array_length(public.ads_assignment_get((select id from ads_ids where name = 'a1m')) -> 'events') >= 5), 'every step is in the history');
select test.must_fail(format($$select public.ads_assignment_reassign('%s', '%s')$$, (select id from ads_ids where name = 'a1m'), test.id('ads_m2')), 'reassigning to another lead''s member is refused', 'own Team Members');
select test.login('ads_m1');
select test.check((select public.ads_assignment_set_status((select id from ads_ids where name = 'a1m'), 'PENDING_REVIEW') ->> 'status') = 'PENDING_REVIEW', 'the member sends the revision');
select test.login('ads_l1');
select test.check((select public.ads_assignment_set_status((select id from ads_ids where name = 'a1m'), 'COMPLETED') ->> 'status') = 'COMPLETED', 'the Team Lead completes it');
select test.must_fail(format($$select public.ads_assignment_set_status('%s', 'REVISION_REQUIRED', null, 'again')$$, (select id from ads_ids where name = 'a1m')), 'a completed assignment is final', 'already completed');
select test.login('ads_dh');
select test.check((select (public.ads_assignment_get((select id from ads_ids where name = 'a1')) -> 'members' -> 0 ->> 'status') = 'COMPLETED'), 'the Department Head sees the member''s part under the Team Lead''s assignment');
select test.login('ads_dh');
select test.check(test.lead_of('ads_m3') is null, 'a member the head created is unassigned while two Team Leads exist');
insert into ads_ids select 'a3', (public.ads_assignment_create(jsonb_build_object('clientId', (select id from ads_ids where name = 'c2'), 'title', 'Poster', 'assigneeId', test.id('ads_m3'))) ->> 'id')::uuid;
select test.check((select assignee_id = test.id('ads_m3') and assigned_by = test.id('ads_dh') from test.asg((select id from ads_ids where name = 'a3'))), 'the Department Head assigns directly to an unassigned member');
select test.check((select public.ads_assignment_reassign((select id from ads_ids where name = 'a3'), test.id('ads_l2')) ->> 'assigneeId') = test.id('ads_l2')::text, 'and reassigns it to a Team Lead');
select test.check((select count(*) = 1 from test.notif('ads_m3') where true and type = 'ADS_ASSIGNMENT_REASSIGNED'), 'the previous assignee is told');
reset role;

\echo '   Client Notice'
set role authenticated;
select test.login('ads_m1');
insert into ads_ids select 'n1', (public.ads_notice_create(jsonb_build_object('clientId', (select id from ads_ids where name = 'c1'), 'title', 'Logo needs a revision', 'category', 'REVISION_REQUEST', 'description', 'Client wants a bolder logo', 'priority', 'HIGH')) ->> 'id')::uuid;
select test.must_fail(format($$select public.ads_notice_create(jsonb_build_object('clientId', '%s', 'title', 'x', 'description', 'x'))$$, (select id from ads_ids where name = 'c2')), 'a notice for a client you cannot see is refused', 'one of your clients');
select test.check((select count(*) = 1 from test.notif('ads_dh') where true and entity_id = (select id from ads_ids where name = 'n1')), 'the Department Head gets the notice');
select test.check((select count(*) = 1 from test.notif('ads_l1') where true and entity_id = (select id from ads_ids where name = 'n1')), 'and the Team Lead working on the client');
select test.login('ads_l2');
select test.check((select jsonb_array_length(public.ads_notices_list()) = 0), 'another Team Lead does not see it');
select test.login('ads_l1');
select test.check((select public.ads_notice_set_status((select id from ads_ids where name = 'n1'), 'ACKNOWLEDGED') ->> 'status') = 'ACKNOWLEDGED', 'the Team Lead acknowledges it');
select test.check((select jsonb_array_length(public.ads_notices_list((select id from ads_ids where name = 'c1'))) = 1), 'it is listed for the client');
reset role;

\echo '   Daily reports: Team Member -> Team Lead -> Department Head'
set role authenticated;
select test.login('ads_m1');
insert into ads_ids select 'r1', (public.ads_report_submit(jsonb_build_object('reportDate', current_date::text, 'assignmentId', (select id from ads_ids where name = 'a1m'), 'workCompleted', 'Three logos drafted',
  'workInProgress', 'Colour options', 'challenges', 'None', 'clientRequestId', 'r1')) ->> 'id')::uuid;
select test.check((select (public.ads_report_submit(jsonb_build_object('workCompleted', 'Three logos drafted', 'clientRequestId', 'r1')) ->> 'id')::uuid = (select id from ads_ids where name = 'r1')), 'a double click returns the first report');
select test.must_fail($$select public.ads_report_submit(jsonb_build_object('workCompleted', 'x', 'reportDate', (current_date + 3)::text))$$, 'a future date is refused', 'future');
select test.must_fail(format($$select public.ads_report_submit(jsonb_build_object('workCompleted', 'x', 'assignmentId', '%s'))$$, (select id from ads_ids where name = 'a3')), 'a report on somebody else''s assignment is refused', 'your own assignments');
reset role;
select test.check((select status = 'PENDING_TL' from ads_reports where id = (select id from ads_ids where name = 'r1')), 'status: pending Team Lead approval');
select test.check((select count(*) = 1 from test.notif('ads_l1') where true and entity_id = (select id from ads_ids where name = 'r1')) and
                  (select count(*) = 0 from test.notif('ads_dh') where true and entity_id = (select id from ads_ids where name = 'r1')), 'only the Team Lead is told at first (the Department Head not yet)');
set role authenticated;
select test.login('ads_l2');
select test.check((select jsonb_array_length(public.ads_reports_list('all')) = 0), 'another Team Lead sees no reports of this team');
select test.must_fail(format($$select public.ads_report_review('%s', 'APPROVE')$$, (select id from ads_ids where name = 'r1')), 'and cannot approve one', 'not waiting for your decision');
select test.login('ads_dh');
select test.must_fail(format($$select public.ads_report_review('%s', 'APPROVE')$$, (select id from ads_ids where name = 'r1')), 'the Department Head cannot skip the Team Lead', 'not waiting for your decision');
select test.check((select jsonb_array_length(public.ads_reports_list('all', null, null, null, null, test.id('ads_m1'))) = 1), 'but can view and filter it');
select test.login('ads_m1');
select test.must_fail(format($$select public.ads_report_review('%s', 'APPROVE')$$, (select id from ads_ids where name = 'r1')), 'a member cannot review (even their own)', 'cannot review your own|not waiting');
select test.login('ads_l1');
select test.must_fail(format($$select public.ads_report_review('%s', 'RETURN')$$, (select id from ads_ids where name = 'r1')), 'returning needs remarks', 'remarks');
select test.check((select public.ads_report_review((select id from ads_ids where name = 'r1'), 'RETURN', 'Add the client name') ->> 'status') = 'RETURNED', 'the Team Lead returns it with remarks');
select test.login('ads_m1');
select test.check((select public.ads_report_submit(jsonb_build_object('id', (select id from ads_ids where name = 'r1'), 'workCompleted', 'Three logos drafted for Acme')) ->> 'status') = 'PENDING_TL', 'the member corrects it and sends it again');
select test.login('ads_l1');
select test.check((select public.ads_report_review((select id from ads_ids where name = 'r1'), 'APPROVE') ->> 'status') = 'PENDING_DH', 'the Team Lead approves: it moves to the Department Head');
select test.check((select bool_or(x ->> 'id' = (select id::text from ads_ids where name = 'r1')) from jsonb_array_elements(public.ads_reports_list('team', 'PENDING_DH')) x), 'the Team Lead sees it under Team Member Reports');
select test.login('ads_dh');
select test.check((select count(*) = 1 from test.notif('ads_dh') where true and entity_id = (select id from ads_ids where name = 'r1') and type = 'ADS_REPORT_SUBMITTED'), 'the Department Head is notified once it is approved');
select test.check((select public.ads_report_review((select id from ads_ids where name = 'r1'), 'APPROVE', 'Good') ->> 'status') = 'APPROVED', 'the Department Head gives the final approval');
select test.check((select jsonb_array_length(public.ads_report_get((select id from ads_ids where name = 'r1')) -> 'events') >= 5), 'the full approval history is kept (reviewer, time, remarks)');
select test.login('ads_m1');
select test.check((select count(*) = 1 from test.notif('ads_m1') where true and type = 'ADS_REPORT_APPROVED' and (data ->> 'dedupeKey') like '%final%'), 'the member sees the final status');
-- the Team Lead's own report goes directly to the Department Head
select test.login('ads_l1');
insert into ads_ids select 'rl', (public.ads_report_submit(jsonb_build_object('workCompleted', 'Reviewed drafts')) ->> 'id')::uuid;
select test.login('ads_dh');
select test.check((select public.ads_report_get((select id from ads_ids where name = 'rl')) ->> 'status') = 'PENDING_DH', 'a Team Lead''s own report goes straight to the Department Head');
select test.check((select public.ads_report_review((select id from ads_ids where name = 'r0'), 'APPROVE') ->> 'status') = 'APPROVED', 'an unassigned member''s report is approved by the Department Head alone');
select test.must_fail($$select public.ads_report_submit(jsonb_build_object('workCompleted', 'x'))$$, 'the Department Head does not write daily reports', 'Team Leads and Team Members');
reset role;

\echo '   Issues: Team Member -> Team Lead -> Department Head'
set role authenticated;
select test.login('ads_m1');
insert into ads_ids select 'i1', (public.ads_issue_create(jsonb_build_object('title', 'Font licence', 'description', 'Need a licensed font', 'category', 'DESIGN_BLOCKER', 'priority', 'HIGH',
  'clientId', (select id from ads_ids where name = 'c1'))) ->> 'id')::uuid;
select test.check((select handler_level = 'TEAM_LEAD' and reference like 'ADS-%' from (select public.ads_issue_get((select id from ads_ids where name = 'i1')) ->> 'handlerLevel' as handler_level, public.ads_issue_get((select id from ads_ids where name = 'i1')) ->> 'reference' as reference) x), 'the issue goes to the member''s Team Lead and gets a reference');
reset role;
select test.check((select count(*) = 1 from test.notif('ads_l1') where true and entity_id = (select id from ads_ids where name = 'i1')), 'the Team Lead is notified');
select test.check((select count(*) = 0 from test.notif('ads_l2') where true and entity_id = (select id from ads_ids where name = 'i1')), 'the other Team Lead is not');
set role authenticated;
select test.login('ads_l2');
select test.check((select jsonb_array_length(public.ads_issues_list('all')) = 0), 'another Team Lead does not see the issue');
select test.must_fail(format($$select public.ads_issue_update('%s', 'IN_PROGRESS')$$, (select id from ads_ids where name = 'i1')), 'nor work it', 'not found');
select test.login('ads_m1');
select test.must_fail(format($$select public.ads_issue_update('%s', 'IN_PROGRESS')$$, (select id from ads_ids where name = 'i1')), 'the raiser cannot work their own issue', 'cannot change the status');
select test.must_fail(format($$select public.ads_issue_escalate('%s')$$, (select id from ads_ids where name = 'i1')), 'nor escalate it', 'Team Lead handling');
select test.login('ads_l1');
select test.check((select public.ads_issue_update((select id from ads_ids where name = 'i1'), 'UNDER_REVIEW', 'Looking into it') ->> 'status') = 'UNDER_REVIEW', 'the Team Lead reviews and responds');
select test.check((select public.ads_issue_escalate((select id from ads_ids where name = 'i1'), 'Needs a budget') ->> 'handlerLevel') = 'DEPARTMENT_HEAD', 'the Team Lead escalates to the Department Head');
select test.must_fail(format($$select public.ads_issue_update('%s', 'RESOLVED')$$, (select id from ads_ids where name = 'i1')), 'after that the Team Lead cannot close it', 'cannot change the status');
select test.login('ads_dh');
select test.check((select count(*) = 1 from test.notif('ads_dh') where true and entity_id = (select id from ads_ids where name = 'i1') and (data ->> 'dedupeKey') like '%esc%'), 'the Department Head is notified of the escalation');
select test.check((select public.ads_issue_update((select id from ads_ids where name = 'i1'), 'RESOLVED', 'Budget approved') ->> 'status') = 'RESOLVED', 'the Department Head resolves it');
select test.check((select jsonb_array_length(public.ads_issues_list('all')) = 2), 'and manages every issue of the department');
select test.login('ads_m1');
select test.check((select public.ads_issue_update((select id from ads_ids where name = 'i1'), 'CLOSED') ->> 'status') = 'CLOSED', 'the raiser closes a resolved issue');
select test.must_fail(format($$select public.ads_issue_update('%s', null, 'one more thing')$$, (select id from ads_ids where name = 'i1')), 'a closed issue is final', 'closed');
reset role;

\echo '   Overview: live figures per scope'
set role authenticated;
select test.login('ads_m1');
select test.check((select (public.ads_overview() -> 'assignments' ->> 'completed') = '1' and (public.ads_overview() ->> 'reportToday') = 'true'), 'a member''s overview counts their own work and report');
select test.login('ads_dh');
select test.check((select (public.ads_overview() -> 'assignments' ->> 'total')::int >= 3 and jsonb_array_length(public.ads_overview() -> 'activity') > 0), 'the Department Head''s overview covers the department and shows recent activity');
reset role;

\echo '   history cannot be edited, audit is written'
select test.must_fail($$update public.ads_events set note = 'x'$$, 'the history is append-only', 'cannot be changed');
select test.check((select count(*) >= 5 from audit_logs where action like 'ADS\_%'), 'audit entries are written');

\echo '   other departments are untouched'
select test.check((select count(*) = 0 from notifications where recipient_id in (test.id('tm_a'), test.id('dh_wab'), test.id('th_wab')) and (data ->> 'module') = 'ai-design-studio'), 'no Sales / Support person was notified');

truncate public.ads_events;
delete from public.ads_issues;
delete from public.ads_reports;
delete from public.ads_assignments;
delete from public.ads_client_notices;
delete from public.ads_clients;
\echo '=== AI DESIGN STUDIO TESTS PASSED ==='
