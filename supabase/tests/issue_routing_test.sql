-- =============================================================================
-- Issue routing and escalation (migration 20270127000200):
--  - an employee raises an issue to HR OR to the Developer Team: each has exactly one recipient, nothing is sent to both;
--  - HR reports an issue to the Developer Team (category, priority, affected department / employee, files) and follows the answers;
--  - the conversation: a developer replies or asks for information (Pending information), the reporter follows up (back to the team);
--    only the people who see the issue take part; a closed issue takes no more messages;
--  - HR escalates an employee issue: one linked Developer Team issue (retries and other HR people get the same one), the employee's files
--    referenced for the developers who see it, the employee told and following the developers' progress, every HR person seeing the answers;
--  - HR's list: sort orders and the routing filter; nobody writes the tables past the functions.
-- Runs after developer_bugs_test.sql (its developers). Own records (titles 'IR %').
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 135b. Issue routing: HR or the Developer Team, HR escalation, the conversation'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270127000200_issue_routing_escalation.sql
\i supabase/migrations/20270127000200_issue_routing_escalation.sql
delete from dev_bugs where title like 'IR %';
delete from employee_issues where title like 'IR %';
create temp table ir (k text primary key, v jsonb);
grant all on ir to authenticated;
create or replace function test.ir_bug(p_title text) returns public.dev_bugs language sql stable security definer set search_path = '' as $$
  select * from public.dev_bugs where title = p_title limit 1 $$;
create or replace function test.ir_issue(p_title text) returns public.employee_issues language sql stable security definer set search_path = '' as $$
  select * from public.employee_issues where title = p_title limit 1 $$;
create or replace function test.ir_upload(p_user text, p_name text) returns uuid language sql security definer set search_path = '' as $$
  insert into public.employee_issue_attachments (uploader_id, file_name, mime_type, size_bytes, status, storage_path)
  values (test.id(p_user), p_name, 'image/png', 1000, 'READY', p_user || '/' || p_name) returning id $$;
create or replace function test.ir_att(p_name text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.employee_issue_attachments where file_name = p_name order by created_at desc limit 1 $$;
create or replace function test.ir_notes(p_user text, p_type text, p_entity uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications where recipient_id = test.id(p_user) and type = p_type and entity_id = p_entity $$;
create or replace function test.ir_report(p_title text, p_key text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select bug_report(jsonb_build_object('title', p_title, 'description', 'The page shows an error when saving.', 'clientRequestId', p_key) || p_extra) $$;
-- one transaction has one now(): give each issue its own age so "oldest first" is defined
create or replace function test.ir_age(p_title text, p_minutes int) returns void language sql security definer set search_path = '' as $$
  update public.employee_issues set created_at = now() - make_interval(mins => p_minutes) where title = p_title $$;
grant execute on all functions in schema test to anon, authenticated;
select test.check(private.is_bug_lead(test.id('dv_shreya')) and private.is_developer(test.id('dv_ashish')) and private.is_developer(test.id('dv_siddhesh')),
  'the developers of developer_bugs_test.sql are here');

\echo '   an employee: to HR or to the Developer Team, never both'
set role authenticated;
select test.login('tm_a');
select issue_submit('22222222-0000-4000-8000-000000000001', 'IR Leave balance wrong', 'ATTENDANCE_LEAVE', 'My leave balance does not include last month.', 'MEDIUM', null, null);
select test.ir_age('IR Leave balance wrong', 30);
select test.check((select v ->> 'recipient' = 'HR' and v ->> 'routing' = 'WITH_HR' and v -> 'escalation' = 'null'::jsonb
                     from (select issue_my_detail((test.ir_issue('IR Leave balance wrong')).id) -> 'issue' as v) x), 'an issue to HR: recipient HR, with HR');
insert into ir select 'dev', test.ir_report('IR Invoice page error', 'ir-key-0001', jsonb_build_object('category', 'BUG', 'priority', 'HIGH', 'steps', '1. Open an invoice'));
select test.check((select v ->> 'source' = 'EMPLOYEE' and v ->> 'category' = 'BUG' and v ->> 'priority' = 'HIGH' and v ->> 'status' = 'PENDING' and not (v ->> 'duplicate')::boolean
                     from ir where k = 'dev'), 'an issue to the Developer Team: its category and priority, from the employee');
select test.check((test.ir_report('IR Invoice page error', 'ir-key-0001') ->> 'duplicate')::boolean, 'the same form twice: the first one, nothing new');
reset role;
select test.check((select count(*) = 1 from dev_bugs where title = 'IR Invoice page error') and not exists (select 1 from employee_issues where title = 'IR Invoice page error')
                  and not exists (select 1 from dev_bugs where title = 'IR Leave balance wrong'), 'each issue went to its one recipient only');
select test.check(test.ir_notes('dv_ashish', 'DEV_BUG_REPORTED', (test.ir_bug('IR Invoice page error')).id) = 1
                  and test.ir_notes('hr_head', 'DEV_BUG_REPORTED', (test.ir_bug('IR Invoice page error')).id) = 0, 'the developers are told, HR is not');
set role authenticated;
select test.login('iss_hr_tm');
select test.check(not exists (select 1 from jsonb_array_elements(issue_hr_list(p_search => 'IR Invoice', p_limit => 100) -> 'items') x)
                  and exists (select 1 from jsonb_array_elements(issue_hr_list(p_search => 'IR Leave', p_limit => 100) -> 'items') x), 'HR sees the HR issue, not the developers'' one');
select test.login('dv_siddhesh');
select test.check(exists (select 1 from jsonb_array_elements(bug_dev_list(p_search => 'IR Invoice', p_limit => 100) -> 'items') x
                          where x ->> 'priority' = 'HIGH' and x ->> 'category' = 'BUG' and x ->> 'source' = 'EMPLOYEE'), 'the developers see it, with its category and priority');
select test.check(not exists (select 1 from jsonb_array_elements(bug_dev_list(p_search => 'IR Leave', p_limit => 100) -> 'items') x), '... and never the HR issue');

\echo '   the form is checked'
select test.login('tm_a');
select test.must_fail($$select test.ir_report('IR Bad', 'ir-key-0002', '{"category":"COFFEE"}')$$, 'an unknown category is refused', 'Choose a category');
select test.must_fail($$select test.ir_report('IR Bad', 'ir-key-0003', '{"priority":"NOW"}')$$, 'an unknown priority is refused', 'Choose a priority');
select test.must_fail($$select test.ir_report('IR Bad', 'ir-key-0004', jsonb_build_object('affectedDepartmentId', gen_random_uuid()))$$, 'an unknown department is refused', 'affected department');
select test.must_fail($$select test.ir_report('IR Bad', 'ir-key-0005', jsonb_build_object('attachmentIds', jsonb_build_array('not-a-file')))$$, 'a bad file id is refused', 'not available');
select test.login('sa');
select test.must_fail($$select test.ir_report('IR Bad', 'ir-key-0006')$$, 'the Super Admin does not report through this form', 'Only a Team Member');

\echo '   HR reports an issue to the Developer Team, with the affected department and employee'
reset role;
select test.ir_upload('iss_hr_tm', 'ir-hr-shot.png');
set role authenticated;
select test.login('iss_hr_tm');
insert into ir select 'hr', test.ir_report('IR Payslip export broken', 'ir-key-0010', jsonb_build_object('category', 'DATA_ISSUE', 'priority', 'URGENT',
  'affectedDepartmentId', test.dept('wabastore'), 'affectedEmployeeId', test.id('tm_b'), 'attachmentIds', jsonb_build_array(test.ir_att('ir-hr-shot.png'))));
select test.check((select v ->> 'source' = 'HR_REPORT' and v ->> 'affectedEmployee' = 'Member B'
                     and v ->> 'affectedDepartment' is not null and jsonb_array_length(v -> 'attachments') = 1 from ir where k = 'hr'),
  'HR''s report: from HR, the affected department and employee, the file');
select test.check(exists (select 1 from jsonb_array_elements(bug_my_list('OPEN')) x where x ->> 'title' = 'IR Payslip export broken' and x ->> 'priority' = 'URGENT')
                  and not exists (select 1 from jsonb_array_elements(bug_my_list('DONE')) x where x ->> 'title' = 'IR Payslip export broken'), 'HR tracks it in their own list (filtered in the database)');
select test.must_fail($$select bug_my_list('SOMETIMES')$$, 'the list filter is checked', 'Unknown status');
reset role;
select test.check((select priority = 'urgent' from notifications where recipient_id = test.id('dv_ashish') and entity_id = (test.ir_bug('IR Payslip export broken')).id limit 1),
  'an urgent report reaches the developers as urgent');

\echo '   the conversation: a developer asks, the reporter answers'
set role authenticated;
select test.login('dv_shreya');
select bug_dev_assign((test.ir_bug('IR Payslip export broken')).id, test.id('dv_ashish'));
select test.login('dv_siddhesh');
select test.must_fail($$select bug_dev_reply((test.ir_bug('IR Payslip export broken')).id, 'Hello', false)$$, 'a developer who does not see it cannot reply', 'Bug not found');
select test.login('dv_ashish');
select test.must_fail($$select bug_dev_reply((test.ir_bug('IR Payslip export broken')).id, 'x', false)$$, 'a reply needs words', 'Write the reply');
select test.check((bug_dev_reply((test.ir_bug('IR Payslip export broken')).id, 'Which month is the export for?', true) ->> 'status') = 'NEEDS_INFO',
  'the assigned developer asks for information: Pending information');
reset role;
select test.check(test.ir_notes('iss_hr_tm', 'DEV_BUG_MESSAGE', (test.ir_bug('IR Payslip export broken')).id) = 1, 'the reporter is told');
set role authenticated;
select test.login('iss_hr_tm');
select test.check((select x -> 'lastMessage' ->> 'from' = 'DEVELOPER' and x ->> 'status' = 'NEEDS_INFO' from jsonb_array_elements(bug_my_list()) x where x ->> 'title' = 'IR Payslip export broken'),
  'the reporter''s list shows the developer''s question');
select test.check(exists (select 1 from jsonb_array_elements(bug_my_detail((test.ir_bug('IR Payslip export broken')).id) -> 'history') h
                          where h ->> 'kind' = 'MESSAGE' and h ->> 'note' = 'Which month is the export for?' and not (h ->> 'internal')::boolean), '... and the reply in its history');
select test.check((bug_my_follow_up((test.ir_bug('IR Payslip export broken')).id, 'November 2026, for all of Sales.') ->> 'status') = 'IN_PROGRESS',
  'the reporter answers: back to the developer (In Progress)');
reset role;
select test.check(test.ir_notes('dv_ashish', 'DEV_BUG_FOLLOW_UP', (test.ir_bug('IR Payslip export broken')).id) = 1
                  and test.ir_notes('dv_siddhesh', 'DEV_BUG_FOLLOW_UP', (test.ir_bug('IR Payslip export broken')).id) = 0, 'the developer on it is told, the other one is not');
set role authenticated;
select test.login('tm_b');
select test.must_fail($$select bug_my_follow_up((test.ir_bug('IR Payslip export broken')).id, 'Me too')$$, 'nobody follows up on someone else''s issue', 'Issue not found');
select test.login('dv_ashish');
select test.check((bug_dev_set_status((test.ir_bug('IR Payslip export broken')).id, 'UNDER_REVIEW') ->> 'status') = 'UNDER_REVIEW', 'Under Review');
select test.check((select (x -> 'counts' ->> 'UNDER_REVIEW')::int >= 1 and (x -> 'counts' ->> 'OPEN')::int >= 1 from (select bug_dev_list() as x) s), 'the counts know the new statuses');
select test.check(exists (select 1 from jsonb_array_elements(bug_dev_list('OPEN', p_search => 'IR Payslip') -> 'items') x), 'Under Review is still open');
select test.check((bug_dev_set_status((test.ir_bug('IR Payslip export broken')).id, 'CLOSED') ->> 'status') = 'CLOSED', 'Closed (no note needed)');
select test.must_fail($$select bug_dev_reply((test.ir_bug('IR Payslip export broken')).id, 'One more thing', false)$$, 'a closed issue takes no more replies', 'closed');
select test.must_fail($$select bug_dev_set_status((test.ir_bug('IR Payslip export broken')).id, 'DONE')$$, 'an unknown status is refused', 'Choose Pending');
select test.login('iss_hr_tm');
select test.must_fail($$select bug_my_follow_up((test.ir_bug('IR Payslip export broken')).id, 'Still broken')$$, '... nor follow-ups', 'closed');

\echo '   HR escalates an employee issue to the Developer Team, once'
reset role;
select test.ir_upload('tm_a', 'ir-employee-shot.png');
set role authenticated;
select test.login('tm_a');
select issue_submit('22222222-0000-4000-8000-000000000002', 'IR CRM logs me out', 'TECHNICAL_SYSTEM', 'The CRM logs me out every ten minutes since Monday.', 'HIGH', null,
  array[test.ir_att('ir-employee-shot.png')]);
select test.ir_age('IR CRM logs me out', 20);
select test.must_fail($$select issue_hr_escalate((test.ir_issue('IR CRM logs me out')).id)$$, 'an employee cannot escalate', 'for HR');
select test.login('hr_head');
insert into ir select 'esc', issue_hr_escalate((test.ir_issue('IR CRM logs me out')).id, 'Seen on two laptops; please check the session length.', 'ACCESS_LOGIN');
select test.check((select not (v ->> 'duplicate')::boolean and v -> 'issue' ->> 'routing' = 'ESCALATED_TO_DEVELOPERS' and v -> 'issue' -> 'escalation' ->> 'reference' like 'BUG-%'
                          and v -> 'issue' ->> 'status' = 'IN_PROGRESS' from ir where k = 'esc'), 'escalated: linked to a Developer Team issue, In Progress for HR');
reset role;
select test.check((select source = 'HR_ESCALATION' and source_issue_id = (test.ir_issue('IR CRM logs me out')).id and category = 'ACCESS_LOGIN' and priority = 'HIGH'
                          and affected_employee_id = test.id('tm_a') and reporter_id = test.id('hr_head') and description like '%Note from HR%session length%'
                     from test.ir_bug('IR CRM logs me out')), 'the Developer Team issue: from HR, about the employee, the issue''s priority, HR''s note');
select test.check(not exists (select 1 from employee_issue_attachments where bug_id = (test.ir_bug('IR CRM logs me out')).id), 'the files are referenced, not copied');
select test.check(test.ir_notes('tm_a', 'EMPLOYEE_ISSUE_UPDATED', (test.ir_issue('IR CRM logs me out')).id) >= 1, 'the employee is told');
set role authenticated;
select test.login('iss_hr_tm');
select test.check((issue_hr_escalate((test.ir_issue('IR CRM logs me out')).id) ->> 'duplicate')::boolean, 'another HR person (or a retry): the same one, nothing new');
reset role;
select test.check((select count(*) = 1 from dev_bugs where source_issue_id = (test.ir_issue('IR CRM logs me out')).id), 'one Developer Team issue only');
select test.check((select count(*) = 1 from employee_case_events where issue_id = (test.ir_issue('IR CRM logs me out')).id and kind = 'ESCALATED'), 'one escalation in the history');
set role authenticated;
select test.login('tm_a');
select test.check((select v -> 'issue' ->> 'routing' = 'ESCALATED_TO_DEVELOPERS' and exists (select 1 from jsonb_array_elements(v -> 'events') e where e ->> 'kind' = 'ESCALATED')
                     from (select issue_my_detail((test.ir_issue('IR CRM logs me out')).id) as v) x), 'the employee sees where it went');

\echo '   the developers who see it open the employee''s files'
select test.login('dv_siddhesh');
select test.check((select jsonb_array_length(v -> 'attachments') = 1 and (v -> 'attachments' -> 0 ->> 'fromIssue')::boolean and v ->> 'sourceIssueReference' like 'ISS-%'
                     from (select bug_dev_detail((test.ir_bug('IR CRM logs me out')).id) as v) x), 'the developers see the employee''s file and the issue reference');
select test.check((issue_attachment_download(test.ir_att('ir-employee-shot.png'))).id = test.ir_att('ir-employee-shot.png'), 'a developer who sees it opens the file');
select test.login('tm_b');
select test.must_fail($$select issue_attachment_download(test.ir_att('ir-employee-shot.png'))$$, 'another employee cannot', 'File not found');
select test.login('dv_shreya');
select bug_dev_assign((test.ir_bug('IR CRM logs me out')).id, test.id('dv_ashish'));
select test.login('dv_siddhesh');
select test.must_fail($$select issue_attachment_download(test.ir_att('ir-employee-shot.png'))$$, 'once it is assigned to the other developer, not any more', 'File not found');

\echo '   the developers'' progress reaches the employee and every HR person'
select test.login('dv_ashish');
select bug_dev_reply((test.ir_bug('IR CRM logs me out')).id, 'Can you tell us the browser?', true);
select test.check((bug_dev_set_status((test.ir_bug('IR CRM logs me out')).id, 'RESOLVED', 'The session now lasts 8 hours.') ->> 'status') = 'RESOLVED', 'the developer resolves it');
select test.login('tm_a');
select test.check((select v -> 'issue' -> 'escalation' ->> 'status' = 'RESOLVED'
                          and exists (select 1 from jsonb_array_elements(v -> 'events') e where e ->> 'kind' = 'DEV_UPDATE' and e ->> 'body' like '%8 hours%')
                     from (select issue_my_detail((test.ir_issue('IR CRM logs me out')).id) as v) x), 'the employee sees the developers resolved it, with the note');
reset role;
select test.check(test.ir_notes('tm_a', 'EMPLOYEE_ISSUE_UPDATED', (test.ir_issue('IR CRM logs me out')).id) >= 2, '... and is told');
set role authenticated;
select test.login('iss_hr_tm');
select test.check((select exists (select 1 from jsonb_array_elements(v -> 'escalationHistory') h where h ->> 'kind' = 'MESSAGE' and h ->> 'note' = 'Can you tell us the browser?')
                          and exists (select 1 from jsonb_array_elements(v -> 'escalationHistory') h where h ->> 'kind' = 'STATUS' and h -> 'data' ->> 'to' = 'RESOLVED')
                          and not exists (select 1 from jsonb_array_elements(v -> 'escalationHistory') h where (h ->> 'internal')::boolean)
                     from (select issue_hr_detail((test.ir_issue('IR CRM logs me out')).id) as v) x), 'every HR person follows the developers'' answers (never internal comments)');

\echo '   what cannot be escalated'
select issue_submit('22222222-0000-4000-8000-000000000003', 'IR My own HR issue', 'OTHER', 'An HR person''s own issue for HR to handle.', 'LOW', null, null);
select test.ir_age('IR My own HR issue', 10);
select test.must_fail($$select issue_hr_escalate((test.ir_issue('IR My own HR issue')).id)$$, 'HR does not escalate their own issue', 'Issue not found');
select test.login('hr_head');
select issue_hr_set_status((test.ir_issue('IR Leave balance wrong')).id, 'CLOSED', 'Fixed in payroll.');
select test.must_fail($$select issue_hr_escalate((test.ir_issue('IR Leave balance wrong')).id)$$, 'a closed issue cannot be escalated', 'closed');
select test.must_fail($$select issue_hr_escalate((test.ir_issue('IR My own HR issue')).id, null, 'COFFEE')$$, 'the category is checked', 'Choose a category');

\echo '   HR''s list: sort orders and the routing filter'
-- the titles of this test's issues, in the order the list gives them
create or replace function pg_temp.ir_titles(p_list jsonb) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by o), '{}') from jsonb_array_elements(p_list -> 'items') with ordinality t(x, o) where x ->> 'title' like 'IR %' $$;
select test.check(pg_temp.ir_titles(issue_hr_list(p_sort => 'PRIORITY', p_limit => 100)) = array['IR CRM logs me out', 'IR Leave balance wrong', 'IR My own HR issue'],
  'by priority (High, Medium, Low)');
select test.check(pg_temp.ir_titles(issue_hr_list(p_sort => 'OLDEST', p_limit => 100)) = array['IR Leave balance wrong', 'IR CRM logs me out', 'IR My own HR issue'], 'oldest first');
select test.check(pg_temp.ir_titles(issue_hr_list(p_sort => 'NEWEST', p_limit => 100)) = array['IR My own HR issue', 'IR CRM logs me out', 'IR Leave balance wrong'], 'newest first');
select test.check(pg_temp.ir_titles(issue_hr_list(p_routing => 'ESCALATED_TO_DEVELOPERS', p_limit => 100)) = array['IR CRM logs me out'], 'only the escalated ones');
select test.check(pg_temp.ir_titles(issue_hr_list(p_routing => 'WITH_HR', p_limit => 100)) = array['IR My own HR issue', 'IR Leave balance wrong'], 'only the ones with HR');
select test.check((select count(*) = 1 from jsonb_array_elements(issue_hr_list(p_search => 'IR CRM', p_sort => 'EMPLOYEE', p_limit => 1) -> 'items') x)
                  and (issue_hr_list(p_search => 'IR CRM', p_limit => 1, p_offset => 1) -> 'items') = '[]'::jsonb, 'pages');
select test.must_fail($$select issue_hr_list(p_sort => 'RANDOM')$$, 'the sort order is checked', 'Unknown sort');
select test.check((issue_hr_overview() ->> 'escalated')::int >= 1, 'the overview counts the escalated issues');

\echo '   nothing past the functions'
select test.login('dv_ashish');
select test.must_fail($$update dev_bugs set status = 'CLOSED' where title like 'IR %'$$, 'nobody writes a bug directly', 'permission denied');
select test.login('hr_head');
select test.must_fail($$update employee_issues set escalated_bug_id = null where title like 'IR %'$$, 'nobody unlinks an escalation directly', 'permission denied');
select test.login('tm_b');
select test.must_fail($$select issue_hr_escalate((test.ir_issue('IR CRM logs me out')).id)$$, 'an employee never escalates', 'for HR');
select test.must_fail($$select bug_dev_reply((test.ir_bug('IR CRM logs me out')).id, 'Hi', false)$$, 'an employee never answers as a developer', 'Developers team only');

reset role;
delete from dev_bugs where title like 'IR %';
delete from employee_issues where title like 'IR %';
delete from employee_issue_attachments where file_name like 'ir-%';
select set_config('request.jwt.claims', '', false);
