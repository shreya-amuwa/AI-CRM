-- =============================================================================
-- Employee issues and HR meeting requests (migration 20261210000100): who can raise and who can work them, what each side sees, the
-- status flow, notifications, attachments and row level security. Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Employee issues and meeting requests'
reset role;

-- people: the three kinds of employee (Team Member, Team Lead, Department Head), a second Team Member, and HR staff (head and a team member)
select test.create_auth_user('iss_tm2', 'iss.tm2@amuwa.com', '{"full_name":"Iss Member Two"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('iss_hr_tm', 'iss.hr.tm@amuwa.com', '{"full_name":"Iss HR Member"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
update profiles set position = 'Sales Executive' where id = test.id('tm_a');

create temp table ie (k text primary key, v text);
grant all on ie to authenticated;
create function pg_temp.g(p_k text) returns text language sql stable as $$ select v from ie where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated;

-- ---------------------------------------------------------------- raising an issue: the three employee kinds
set role authenticated;
select test.login('tm_a');
insert into ie select 'i_tm', (issue_submit('11111111-0000-4000-8000-000000000001', 'Laptop keeps freezing', 'TECHNICAL_SYSTEM', 'My laptop freezes every hour and I lose work.', 'HIGH', 'A replacement laptop', null) ->> 'id');
select test.login('th_wab');
insert into ie select 'i_tl', (issue_submit('11111111-0000-4000-8000-000000000002', 'Payroll amount is wrong', 'SALARY_PAYROLL', 'My last salary slip does not match my attendance.', 'URGENT', null, null) ->> 'id');
select test.login('dh_wab');
insert into ie select 'i_dh', (issue_submit('11111111-0000-4000-8000-000000000003', 'Office air conditioning', 'FACILITIES', 'The air conditioning on our floor has not worked for a week.', 'LOW', null, null) ->> 'id');
reset role;
select test.check((select count(*) = 3 from employee_issues), 'a Team Member, a Team Lead and a Department Head each raised an issue');
select test.check((select bool_and(issue_reference ~ '^ISS-[0-9]{4}-[0-9]{5}$') and count(distinct issue_reference) = 3 from employee_issues), 'every issue has its own reference number (ISS-YYYY-00001)');
select test.check((select employee_name = 'Member A' and employee_code = 'EMP-' || upper(left(test.id('tm_a')::text, 8)) and department_name is not null and designation = 'Sales Executive'
                     and status = 'NEW' and employee_id = test.id('tm_a') from employee_issues where id = pg_temp.g('i_tm')::uuid),
  'the employee''s name, employee id, department and designation come from their profile (not from the form)');
select test.check((select designation = 'Team Lead' from employee_issues where id = pg_temp.g('i_tl')::uuid) and (select designation = 'Department Head' from employee_issues where id = pg_temp.g('i_dh')::uuid),
  'a Team Lead and a Department Head show their role as the designation when none is recorded');

-- the same form submitted twice is one record and one notification
set role authenticated;
select test.login('tm_a');
select test.check((select (issue_submit('11111111-0000-4000-8000-000000000001', 'Laptop keeps freezing', 'TECHNICAL_SYSTEM', 'My laptop freezes every hour and I lose work.', 'HIGH', 'A replacement laptop', null) ->> 'duplicate')::boolean
                     and issue_submit('11111111-0000-4000-8000-000000000001', 'Laptop keeps freezing', 'TECHNICAL_SYSTEM', 'My laptop freezes every hour and I lose work.', 'HIGH', 'A replacement laptop', null) ->> 'id' = pg_temp.g('i_tm')),
  'submitting the same form again returns the first issue (no duplicate)');
reset role;
select test.check((select count(*) = 3 from employee_issues), 'and no second record was created');
select test.check((select count(*) = 1 from notifications where entity_id = pg_temp.g('i_tm')::uuid and type = 'EMPLOYEE_ISSUE_SUBMITTED' and recipient_id = test.id('hr_head')), 'the HR head got exactly one notification for it');
select test.check((select count(*) = 1 from notifications where entity_id = pg_temp.g('i_tm')::uuid and type = 'EMPLOYEE_ISSUE_SUBMITTED' and recipient_id = test.id('iss_hr_tm')), 'and so did the HR team member');
select test.check((select not exists (select 1 from notifications where type = 'EMPLOYEE_ISSUE_SUBMITTED' and (body ilike '%freez%' or title ilike '%freez%' or body ilike '%payroll amount%')) ), 'a notification never carries the issue text');
select test.check((select priority = 'urgent' from notifications where entity_id = pg_temp.g('i_tl')::uuid and recipient_id = test.id('hr_head')), 'an urgent issue notifies HR as urgent');
select test.check((select count(*) = 3 from audit_logs where action = 'EMPLOYEE_ISSUE_SUBMITTED'), 'every submission is in the audit log');
select test.check((select not exists (select 1 from audit_logs where action like 'EMPLOYEE_ISSUE%' and metadata::text ilike '%freezes%')), 'the audit log never holds the issue text');

-- validation and who may not raise one
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'x', 'OTHER', 'A long enough description here.', 'LOW')$$, 'a title that is too short is refused', 'issue title');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'A real title', 'NOPE', 'A long enough description here.', 'LOW')$$, 'an unknown category is refused', 'category');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'A real title', 'OTHER', 'short', 'LOW')$$, 'a description that is too short is refused', 'Describe the issue');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'A real title', 'OTHER', 'A long enough description here.', 'ASAP')$$, 'an unknown priority is refused', 'priority');
select test.must_fail($$select issue_submit(null, 'A real title', 'OTHER', 'A long enough description here.', 'LOW')$$, 'a missing request id is refused', 'Reload');
select test.login('sa');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'A real title', 'OTHER', 'A long enough description here.', 'LOW')$$, 'the Super Admin does not raise employee issues', 'Only a Team Member');
select set_config('request.jwt.claims', '', false);
reset role;
set role anon;
select test.must_fail($$select issue_submit(gen_random_uuid(), 'A real title', 'OTHER', 'A long enough description here.', 'LOW')$$, 'a signed-out visitor cannot raise an issue', 'permission denied');
select test.must_fail($$select issue_hr_list()$$, 'nor read the HR list', 'permission denied');
reset role;

-- ---------------------------------------------------------------- what an employee sees: only their own
set role authenticated;
select test.login('iss_tm2');
select test.check((select (issue_my_list() ->> 'total')::int = 0 and jsonb_array_length(issue_my_list() -> 'items') = 0), 'a colleague who raised nothing sees no issues');
select test.must_fail($$select issue_my_detail(pg_temp.g('i_tm')::uuid)$$, 'and cannot open somebody else''s issue by its id', 'not found');
select test.must_fail($$select issue_employee_reply(pg_temp.g('i_tm')::uuid, 'I am replying to somebody else')$$, 'cannot reply to it', 'not found');
select test.check((select count(*) = 0 from employee_issues), 'a direct read of the table shows nothing of other people''s issues (row level security)');
select test.check((select count(*) = 0 from employee_case_events), 'nor of their history');
select test.must_fail($$update employee_issues set status = 'RESOLVED'$$, 'a direct update of an issue is refused', 'permission denied');
select test.must_fail($$insert into employee_issues (issue_reference, client_request_id, employee_id, employee_name, employee_code, title, category, description) values ('ISS-X', gen_random_uuid(), test.id('iss_tm2'), 'x', 'x', 'Fake', 'OTHER', 'Not through the function')$$, 'a direct insert is refused', 'permission denied');
select test.must_fail($$select issue_hr_detail(pg_temp.g('i_tm')::uuid)$$, 'an employee cannot use the HR detail', 'for HR');
select test.must_fail($$select issue_hr_assign(pg_temp.g('i_tm')::uuid, test.id('hr_head'))$$, 'nor assign', 'for HR');
select test.must_fail($$select issue_hr_set_status(pg_temp.g('i_tm')::uuid, 'RESOLVED')$$, 'nor change a status', 'for HR');
select test.must_fail($$select issue_hr_respond(pg_temp.g('i_tm')::uuid, 'I am HR now')$$, 'nor respond as HR', 'for HR');
select test.must_fail($$select issue_hr_overview()$$, 'nor read the HR totals', 'for HR');
select test.login('dh_wab');
select test.must_fail($$select issue_hr_list()$$, 'a Department Head of another department is not HR either', 'for HR');
select test.login('tm_a');
select test.check((select (issue_my_list() ->> 'total')::int = 1 and issue_my_list() -> 'items' -> 0 ->> 'id' = pg_temp.g('i_tm')), 'an employee''s own list holds only their own issue');
select test.check((select issue_my_details() ->> 'name' = 'Member A' and issue_my_details() ->> 'code' = 'EMP-' || upper(left(test.id('tm_a')::text, 8)) and issue_my_details() ->> 'designation' = 'Sales Executive' and issue_my_details() ->> 'department' is not null), 'the form''s employee details come from the profile');
reset role;

-- ---------------------------------------------------------------- HR: sees every department, works the issue
set role authenticated;
select test.login('hr_head');
select test.check((select (issue_hr_overview() ->> 'total')::int = 3 and (issue_hr_overview() ->> 'new')::int = 3 and (issue_hr_overview() ->> 'urgent')::int = 1 and (issue_hr_overview() ->> 'inProgress')::int = 0),
  'HR''s totals are counted from the records (3 issues, 3 new, 1 urgent)');
select test.check((select (issue_hr_list() ->> 'total')::int = 3), 'HR sees the issues of a Team Member, a Team Lead and a Department Head');
select test.check((select (issue_hr_list(p_priority => 'URGENT') ->> 'total')::int = 1 and issue_hr_list(p_priority => 'URGENT') -> 'items' -> 0 ->> 'id' = pg_temp.g('i_tl')), 'the priority filter works');
select test.check((select (issue_hr_list(p_category => 'FACILITIES') ->> 'total')::int = 1), 'the category filter works');
select test.check((select (issue_hr_list(p_search => 'laptop') ->> 'total')::int = 1 and (issue_hr_list(p_search => 'ISS-') ->> 'total')::int = 3 and (issue_hr_list(p_search => 'Member A') ->> 'total')::int = 1 and (issue_hr_list(p_search => '%') ->> 'total')::int = 0),
  'search finds by title, reference and employee name (a % is just a character)');
select test.check((select (issue_hr_list(p_department => (select department_id from employee_issues where id = pg_temp.g('i_tm')::uuid)) ->> 'total')::int = 3), 'the department filter works');
select test.check((select (issue_hr_list(p_limit => 2) ->> 'total')::int = 3 and jsonb_array_length(issue_hr_list(p_limit => 2) -> 'items') = 2 and jsonb_array_length(issue_hr_list(p_limit => 2, p_offset => 2) -> 'items') = 1), 'pagination returns the page and the total');
select test.check((select (issue_hr_list(p_unassigned => true) ->> 'total')::int = 3), 'all three are unassigned');
select test.check((select issue_hr_detail(pg_temp.g('i_tm')::uuid) -> 'issue' ->> 'description' like 'My laptop freezes%' and issue_hr_detail(pg_temp.g('i_tm')::uuid) -> 'issue' -> 'employee' ->> 'name' = 'Member A'),
  'HR opens the full description and the employee''s details');
select test.check((select jsonb_array_length(issue_hr_assignees()) >= 2 and exists (select 1 from jsonb_array_elements(issue_hr_assignees()) a where a ->> 'id' = test.id('iss_hr_tm')::text)), 'HR can pick from the HR team');

-- assign: HR team member only; the issue moves to In progress; the employee and the assignee are told
select test.must_fail($$select issue_hr_assign(pg_temp.g('i_tm')::uuid, test.id('th_wab'))$$, 'an issue cannot be assigned to somebody outside HR', 'HR team');
select test.check((select issue_hr_assign(pg_temp.g('i_tm')::uuid, test.id('iss_hr_tm')) -> 'issue' ->> 'status' = 'IN_PROGRESS'), 'assigning an issue opens it (In progress)');
select test.check((select issue_hr_assign(pg_temp.g('i_tm')::uuid, test.id('iss_hr_tm')) -> 'issue' -> 'assignedHr' ->> 'name' = 'Iss HR Member'), 'assigning the same person again changes nothing');
select test.check((select jsonb_array_length(issue_hr_list(p_assignee => test.id('iss_hr_tm')) -> 'items') = 1), 'the assigned-HR filter works');
select issue_hr_note(pg_temp.g('i_tm')::uuid, 'Check with IT whether this laptop is under warranty.');
select test.check((select jsonb_array_length(issue_hr_detail(pg_temp.g('i_tm')::uuid) -> 'events') >= 3 and exists (select 1 from jsonb_array_elements(issue_hr_detail(pg_temp.g('i_tm')::uuid) -> 'events') e where e ->> 'kind' = 'NOTE' and e ->> 'visibility' = 'HR')),
  'HR''s internal note is in the history, marked HR-only');
select test.check((select issue_hr_respond(pg_temp.g('i_tm')::uuid, 'Please tell us the laptop model and serial number.', true) -> 'issue' ->> 'status' = 'AWAITING_EMPLOYEE'), 'HR asks for more information (the issue waits for the employee)');
select test.check((select issue_hr_respond(pg_temp.g('i_tl')::uuid, 'We are checking your attendance record.') -> 'issue' ->> 'status' = 'IN_PROGRESS'), 'a plain response opens a new issue and keeps it In progress');
reset role;
select test.check((select assigned_hr_id = test.id('hr_head') from employee_issues where id = pg_temp.g('i_tl')::uuid), 'responding to an unassigned issue takes it over');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('iss_hr_tm') and type = 'EMPLOYEE_ISSUE_ASSIGNED' and entity_id = pg_temp.g('i_tm')::uuid), 'the assigned HR person was told');

-- the employee: sees status and HR's response, never the internal note
set role authenticated;
select test.login('tm_a');
select test.check((select issue_my_detail(pg_temp.g('i_tm')::uuid) -> 'issue' ->> 'status' = 'AWAITING_EMPLOYEE' and issue_my_detail(pg_temp.g('i_tm')::uuid) -> 'issue' ->> 'hrResponse' like 'Please tell us the laptop model%'), 'the employee sees the status and HR''s response');
select test.check((select not exists (select 1 from jsonb_array_elements(issue_my_detail(pg_temp.g('i_tm')::uuid) -> 'events') e where e ->> 'kind' = 'NOTE' or e ->> 'visibility' = 'HR' or e ->> 'body' like '%warranty%')), 'the internal HR note is not in the employee''s history');
select test.check((select count(*) = 0 from employee_case_events where visibility = 'HR'), 'a direct read of the history shows no HR-only event to the employee');
select test.check((select count(*) >= 3 from employee_case_events where issue_id = pg_temp.g('i_tm')::uuid), 'but shows the visible ones');
select test.check((select count(*) = 1 from notifications where type = 'EMPLOYEE_ISSUE_UPDATED' and entity_id = pg_temp.g('i_tm')::uuid and body like '%needs more information%'), 'the employee got one notification for the request');
select test.check((select count(*) = 0 from notifications where type = 'EMPLOYEE_ISSUE_UPDATED' and entity_id = pg_temp.g('i_tl')::uuid), 'and none about somebody else''s issue');
select test.check((select issue_employee_reply(pg_temp.g('i_tm')::uuid, 'It is a ThinkPad T14, serial ABC123.') -> 'issue' ->> 'status' = 'IN_PROGRESS'), 'the employee''s reply puts the issue back In progress');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('iss_hr_tm') and type = 'EMPLOYEE_ISSUE_REPLY' and entity_id = pg_temp.g('i_tm')::uuid), 'the assigned HR person was told about the reply (only them)');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('hr_head') and type = 'EMPLOYEE_ISSUE_REPLY'), 'the rest of HR was not');

-- status changes, resolve and close
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select issue_hr_set_status(pg_temp.g('i_tm')::uuid, 'BOGUS')$$, 'an unknown status is refused', 'Choose a status');
select test.must_fail($$select issue_hr_set_status(pg_temp.g('i_tm')::uuid, 'NEW')$$, 'an opened issue cannot go back to New', 'back to New');
select test.check((select issue_hr_set_status(pg_temp.g('i_tm')::uuid, 'RESOLVED', 'A replacement laptop is on its way.') -> 'issue' ->> 'status' = 'RESOLVED'), 'HR resolves it with a message');
select test.check((select issue_hr_detail(pg_temp.g('i_tm')::uuid) -> 'issue' ->> 'resolvedAt' is not null), 'and the resolution time is recorded');
select test.check((select (issue_hr_overview() ->> 'resolved')::int = 1 and (issue_hr_overview() ->> 'inProgress')::int = 1 and (issue_hr_overview() ->> 'new')::int = 1), 'the totals follow the status changes');
select test.check((select issue_hr_set_status(pg_temp.g('i_tm')::uuid, 'CLOSED') -> 'issue' ->> 'status' = 'CLOSED'), 'HR closes it');
select test.must_fail($$select issue_hr_set_status(pg_temp.g('i_tm')::uuid, 'IN_PROGRESS')$$, 'a closed issue cannot be changed', 'closed');
select test.must_fail($$select issue_hr_respond(pg_temp.g('i_tm')::uuid, 'One more thing')$$, 'nor answered', 'closed');
select test.must_fail($$select issue_hr_assign(pg_temp.g('i_tm')::uuid, test.id('hr_head'))$$, 'nor assigned', 'closed');
select test.login('tm_a');
select test.must_fail($$select issue_employee_reply(pg_temp.g('i_tm')::uuid, 'Thanks, one more question')$$, 'the employee cannot reply to a closed issue', 'closed');
select test.check((select issue_my_detail(pg_temp.g('i_tm')::uuid) -> 'issue' ->> 'status' = 'CLOSED' and issue_my_detail(pg_temp.g('i_tm')::uuid) -> 'issue' ->> 'hrResponse' = 'A replacement laptop is on its way.'), 'the employee sees it closed with HR''s last response');
select test.check((select (issue_my_list(p_status => 'CLOSED') ->> 'total')::int = 1 and (issue_my_list(p_status => 'NEW') ->> 'total')::int = 0), 'the employee can filter their history by status');
reset role;
select test.check((select count(*) >= 4 from audit_logs where action in ('EMPLOYEE_ISSUE_ASSIGNED', 'EMPLOYEE_ISSUE_STATUS_CHANGED', 'EMPLOYEE_ISSUE_RESPONDED', 'EMPLOYEE_ISSUE_EMPLOYEE_REPLIED')), 'assignments, responses and status changes are in the audit log');
select test.must_fail($$update employee_case_events set body = 'edited' where issue_id = pg_temp.g('i_tm')::uuid$$, 'the history cannot be edited, even by the database owner''s statements', 'cannot be changed');

-- an HR employee's own issue is not worked by HR (including themselves)
set role authenticated;
select test.login('iss_hr_tm');
insert into ie select 'i_hr', (issue_submit('11111111-0000-4000-8000-000000000009', 'HR laptop slow', 'TECHNICAL_SYSTEM', 'My own laptop is slow in the morning.', 'LOW', null, null) ->> 'id');
select test.check((select (issue_hr_list() ->> 'total')::int = 3), 'an HR employee''s own issue is not in the HR list');
select test.must_fail($$select issue_hr_detail(pg_temp.g('i_hr')::uuid)$$, 'and they cannot open or work it as HR', 'not found');
select test.must_fail($$select issue_hr_set_status(pg_temp.g('i_hr')::uuid, 'RESOLVED')$$, 'nor resolve it themselves', 'not found');
select test.login('hr_head');
select test.check((select (issue_hr_list() ->> 'total')::int = 4), 'another HR person does see it');
reset role;

-- ---------------------------------------------------------------- attachments
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select issue_begin_upload('virus.exe', 'application/x-msdownload', 1000)$$, 'an executable cannot be attached', 'cannot be attached');
select test.must_fail($$select issue_begin_upload('big.pdf', 'application/pdf', 6000000)$$, 'a file over 5 MB cannot be attached', '5 MB');
select test.must_fail($$select issue_begin_upload('', 'application/pdf', 1000)$$, 'a file needs a name', 'needs a name');
insert into ie select 'att', (issue_begin_upload('slip.pdf', 'application/pdf', 1200)).id::text;
select test.check((select (issue_pending_upload(pg_temp.g('att')::uuid)).storage_bucket = 'employee-issue-attachments' and (issue_pending_upload(pg_temp.g('att')::uuid)).storage_path like test.id('tm_a')::text || '/%'), 'a private bucket, in the employee''s own folder');
select issue_complete_upload(pg_temp.g('att')::uuid, 1200, 'etag');
select test.login('iss_tm2');
select test.must_fail($$select issue_pending_upload(pg_temp.g('att')::uuid)$$, 'another employee cannot touch the upload', 'Upload not found');
select test.must_fail($$select issue_attachment_download(pg_temp.g('att')::uuid)$$, 'nor download a file that is not attached to anything', 'File not found');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'Using a stolen upload', 'OTHER', 'I try to attach somebody else''s file.', 'LOW', null, array[pg_temp.g('att')::uuid])$$, 'a file of somebody else cannot be attached to my issue', 'not available');
select test.login('tm_a');
insert into ie select 'i_att', (issue_submit('11111111-0000-4000-8000-000000000010', 'Wrong deduction', 'SALARY_PAYROLL', 'Please see my salary slip, it shows a wrong deduction.', 'MEDIUM', null, array[pg_temp.g('att')::uuid]) ->> 'id');
select test.check((select jsonb_array_length(issue_my_detail(pg_temp.g('i_att')::uuid) -> 'attachments') = 1), 'the file is attached to the issue');
select test.check((select (issue_attachment_download(pg_temp.g('att')::uuid)).file_name = 'slip.pdf'), 'the owner can get a link');
select test.must_fail($$select issue_submit(gen_random_uuid(), 'Same file again', 'OTHER', 'Attaching the same file twice is not allowed.', 'LOW', null, array[pg_temp.g('att')::uuid])$$, 'a file cannot be attached twice', 'not available');
select test.login('iss_tm2');
select test.must_fail($$select issue_attachment_download(pg_temp.g('att')::uuid)$$, 'another employee cannot download it', 'File not found');
select test.login('hr_head');
select test.check((select (issue_attachment_download(pg_temp.g('att')::uuid)).file_name = 'slip.pdf'), 'HR can download it');
select test.check((select jsonb_array_length(issue_hr_detail(pg_temp.g('i_att')::uuid) -> 'attachments') = 1), 'and sees it on the issue');
reset role;
select test.check((select count(*) >= 2 from audit_logs where action = 'EMPLOYEE_ISSUE_ATTACHMENT_DOWNLOADED'), 'downloads are audited');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select * from employee_issue_attachments$$, 'the attachment table cannot be read directly', 'permission denied');
reset role;

-- ---------------------------------------------------------------- meeting requests: the three employee kinds
set role authenticated;
select test.login('tm_a');
insert into ie select 'm_tm', (meeting_submit('22222222-0000-4000-8000-000000000001', 'Discuss my leave balance', 'ATTENDANCE_LEAVE', 'I would like to understand my leave balance for this year.', current_date + 3, '10:30', 'IN_PERSON', 'Any morning works') ->> 'id');
select test.login('th_wab');
insert into ie select 'm_tl', (meeting_submit('22222222-0000-4000-8000-000000000002', 'Team workload concern', 'MANAGEMENT', 'I need to discuss the workload of my team with HR.', current_date + 5, '15:00', 'ONLINE', null) ->> 'id');
select test.login('dh_wab');
insert into ie select 'm_dh', (meeting_submit('22222222-0000-4000-8000-000000000003', 'Confidential matter', 'PERSONAL_CONFIDENTIAL', 'A confidential matter that I would like to discuss in person.', current_date + 2, '11:00', 'IN_PERSON', null) ->> 'id');
reset role;
select test.check((select count(*) = 3 and bool_and(status = 'PENDING') and bool_and(meeting_reference ~ '^MTG-[0-9]{4}-[0-9]{5}$') from employee_meeting_requests), 'a Team Member, a Team Lead and a Department Head each requested a meeting (Pending, with a reference number)');
select test.check((select employee_name = 'Member A' and employee_code like 'EMP-%' and department_name is not null and designation = 'Sales Executive' from employee_meeting_requests where id = pg_temp.g('m_tm')::uuid), 'the employee''s details come from their profile');
select test.check((select count(*) = 3 from notifications where type = 'EMPLOYEE_MEETING_REQUESTED' and recipient_id = test.id('hr_head')), 'HR was told once for each request');
set role authenticated;
select test.login('tm_a');
select test.check((select (meeting_submit('22222222-0000-4000-8000-000000000001', 'Discuss my leave balance', 'ATTENDANCE_LEAVE', 'I would like to understand my leave balance for this year.', current_date + 3, '10:30', 'IN_PERSON', 'Any morning works') ->> 'duplicate')::boolean), 'a repeated submission is recognised');
select test.must_fail($$select meeting_submit(gen_random_uuid(), 'Past date', 'OTHER', 'A meeting in the past is not possible.', current_date - 10, '10:00', 'ONLINE')$$, 'a date in the past is refused', 'preferred date');
select test.must_fail($$select meeting_submit(gen_random_uuid(), 'Far date', 'OTHER', 'A meeting years from now is not sensible.', current_date + 900, '10:00', 'ONLINE')$$, 'a date too far ahead is refused', 'preferred date');
select test.must_fail($$select meeting_submit(gen_random_uuid(), 'Bad time', 'OTHER', 'A meeting with an invalid time of day.', current_date + 1, '25:99', 'ONLINE')$$, 'an invalid time is refused', 'preferred time');
select test.must_fail($$select meeting_submit(gen_random_uuid(), 'Bad mode', 'OTHER', 'A meeting with an unknown mode of meeting.', current_date + 1, '10:00', 'PHONE')$$, 'an unknown mode is refused', 'In Person or Online');
select test.must_fail($$select meeting_submit(gen_random_uuid(), 'Bad category', 'NOPE', 'A meeting with an unknown category here.', current_date + 1, '10:00', 'ONLINE')$$, 'an unknown category is refused', 'category');
select test.must_fail($$select meeting_hr_list()$$, 'an employee cannot list the HR requests', 'for HR');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'APPROVE', current_date + 3, '10:30')$$, 'nor approve their own request', 'for HR');
select test.must_fail($$update employee_meeting_requests set status = 'SCHEDULED' where id = pg_temp.g('m_tm')::uuid$$, 'nor update it directly', 'permission denied');
select test.login('iss_tm2');
select test.must_fail($$select meeting_my_detail(pg_temp.g('m_tm')::uuid)$$, 'a colleague cannot open it by id', 'not found');
select test.must_fail($$select meeting_my_cancel(pg_temp.g('m_tm')::uuid)$$, 'nor cancel it', 'not found');
select test.check((select count(*) = 0 from employee_meeting_requests), 'nor read it directly (row level security)');
reset role;

-- ---------------------------------------------------------------- meeting requests: HR
set role authenticated;
select test.login('hr_head');
select test.check((select (meeting_hr_overview() ->> 'total')::int = 3 and (meeting_hr_overview() ->> 'pending')::int = 3 and (meeting_hr_overview() ->> 'scheduled')::int = 0), 'HR''s totals are counted from the records');
select test.check((select (meeting_hr_list() ->> 'total')::int = 3), 'HR sees the meeting requests of all three kinds of employee');
select test.check((select (meeting_hr_list(p_category => 'MANAGEMENT') ->> 'total')::int = 1 and (meeting_hr_list(p_search => 'leave') ->> 'total')::int = 1 and (meeting_hr_list(p_search => 'MTG-') ->> 'total')::int = 3), 'category and search filters work');
select test.check((select (meeting_hr_list(p_from => current_date + 4) ->> 'total')::int = 1 and (meeting_hr_list(p_to => current_date + 2) ->> 'total')::int = 1), 'the date range filters work');
select test.check((select meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'description' like 'I would like%' and meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' -> 'employee' ->> 'name' = 'Member A'), 'HR opens the full request');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'APPROVE')$$, 'approving needs a date and time', 'date and time');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'DECLINE')$$, 'declining needs a reason', 'reason');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'APPROVE', current_date + 3, '10:30', 'ONLINE', null, 'http://insecure.example.com')$$, 'a meeting link must be https', 'https');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'RESCHEDULE', current_date + 4, '10:30', null, null, null, null, null, 'x')$$, 'only a scheduled meeting can be rescheduled', 'scheduled meeting');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'COMPLETE')$$, 'only a scheduled meeting can be completed', 'scheduled meeting');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'NOPE')$$, 'an unknown action is refused', 'what to do');
select test.must_fail($$select meeting_hr_assign(pg_temp.g('m_tm')::uuid, test.id('th_wab'))$$, 'a meeting is assigned to an HR person only', 'HR team');
select test.check((select meeting_hr_assign(pg_temp.g('m_tm')::uuid, test.id('iss_hr_tm')) -> 'meeting' -> 'assignedHr' ->> 'name' = 'Iss HR Member'), 'HR assigns the responsible HR representative');
select test.check((select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'APPROVE', current_date + 4, '14:00', 'ONLINE', null, 'https://meet.example.com/room-1', 'Join five minutes early.', 'See you then.') -> 'meeting' ->> 'status' = 'SCHEDULED'),
  'HR approves and schedules it with a link and instructions');
select test.check((select (meeting_hr_overview() ->> 'scheduled')::int = 1 and (meeting_hr_overview() ->> 'pending')::int = 2), 'the totals follow');
select meeting_hr_note(pg_temp.g('m_tm')::uuid, 'Prepare the leave ledger before the meeting.');
select test.check((select meeting_hr_decide(pg_temp.g('m_dh')::uuid, 'PROPOSE', current_date + 6, '16:00', 'IN_PERSON', 'Room 2', null, null, 'Could we meet later that week?') -> 'meeting' ->> 'status' = 'ALTERNATIVE_PROPOSED'), 'HR proposes another time');
select test.check((select meeting_hr_decide(pg_temp.g('m_tl')::uuid, 'DECLINE', null, null, null, null, null, null, null, 'We will handle this through your Department Head first.') -> 'meeting' ->> 'status' = 'DECLINED'), 'HR declines with a reason');
select test.check((select (meeting_hr_list(p_status => 'PENDING') ->> 'total')::int = 1 and (meeting_hr_list(p_status => 'DECLINED') ->> 'total')::int = 1 and (meeting_hr_list(p_status => 'SCHEDULED') ->> 'total')::int = 1), 'the status filters work (Pending includes a proposed alternative)');
reset role;

-- the employee sees the confirmed details, the HR response and the reason, but not the internal note or the outcome
set role authenticated;
select test.login('tm_a');
select test.check((select meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'status' = 'SCHEDULED' and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'confirmedDate' = (current_date + 4)::text
                     and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'confirmedTime' = '14:00' and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'confirmedMode' = 'ONLINE'
                     and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'link' = 'https://meet.example.com/room-1' and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'hrResponse' = 'See you then.'),
  'the employee sees the confirmed date, time, mode, link and HR''s response');
select test.check((select not exists (select 1 from jsonb_array_elements(meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'events') e where e ->> 'kind' = 'NOTE' or e ->> 'body' like '%ledger%')), 'HR''s internal note is not shown to the employee');
select test.check((select count(*) = 1 from notifications where type = 'EMPLOYEE_MEETING_UPDATED' and title like 'Your meeting is scheduled%' and entity_id = pg_temp.g('m_tm')::uuid and recipient_id = test.id('tm_a')), 'the employee was notified of the schedule once');
select test.login('th_wab');
select test.check((select meeting_my_detail(pg_temp.g('m_tl')::uuid) -> 'meeting' ->> 'status' = 'DECLINED' and meeting_my_detail(pg_temp.g('m_tl')::uuid) -> 'meeting' ->> 'reason' like 'We will handle this%'), 'a declined request shows the reason to the Team Lead');
select test.login('dh_wab');
select test.check((select meeting_my_detail(pg_temp.g('m_dh')::uuid) -> 'meeting' ->> 'status' = 'ALTERNATIVE_PROPOSED' and meeting_my_detail(pg_temp.g('m_dh')::uuid) -> 'meeting' ->> 'proposedTime' = '16:00'), 'the Department Head sees the proposed alternative');
select test.check((select meeting_respond_alternative(pg_temp.g('m_dh')::uuid, true, 'That works.') -> 'meeting' ->> 'status' = 'SCHEDULED'), 'accepting it schedules the meeting');
select test.check((select meeting_my_detail(pg_temp.g('m_dh')::uuid) -> 'meeting' ->> 'confirmedTime' = '16:00' and meeting_my_detail(pg_temp.g('m_dh')::uuid) -> 'meeting' ->> 'location' = 'Room 2'), 'at the proposed time and place');
select test.must_fail($$select meeting_respond_alternative(pg_temp.g('m_dh')::uuid, true)$$, 'and there is nothing left to answer', 'no proposed time');
select test.login('tm_a');
select test.must_fail($$select meeting_respond_alternative(pg_temp.g('m_tm')::uuid, true)$$, 'an employee cannot answer a request that has no proposal', 'no proposed time');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'EMPLOYEE_MEETING_REPLY' and entity_id = pg_temp.g('m_dh')::uuid and recipient_id = test.id('hr_head')), 'HR was told about the acceptance');

-- reschedule, cancel, complete, and what the employee does not see
set role authenticated;
select test.login('hr_head');
select test.check((select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'RESCHEDULE', current_date + 7, '09:30', null, null, null, null, null, 'The HR representative is on leave that day.') -> 'meeting' ->> 'confirmedDate' = (current_date + 7)::text), 'HR reschedules a scheduled meeting with a reason');
select test.check((select meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'reason' like 'The HR representative%' and meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'confirmedMode' = 'ONLINE' and meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'link' = 'https://meet.example.com/room-1'), 'the mode and link are kept');
select test.check((select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'COMPLETE', null, null, null, null, null, null, null, null, 'Explained the leave policy.', 'Send the leave ledger by e-mail.') -> 'meeting' ->> 'status' = 'COMPLETED'), 'HR marks it completed and records the outcome and follow-up');
select test.check((select meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'outcome' = 'Explained the leave policy.' and meeting_hr_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'followUp' = 'Send the leave ledger by e-mail.'), 'HR reads the outcome');
select test.must_fail($$select meeting_hr_decide(pg_temp.g('m_tm')::uuid, 'CANCEL', null, null, null, null, null, null, null, 'x again')$$, 'a completed meeting cannot be changed', 'already completed');
select test.check((select meeting_hr_decide(pg_temp.g('m_dh')::uuid, 'CANCEL', null, null, null, null, null, null, null, 'The meeting room is unavailable.') -> 'meeting' ->> 'status' = 'CANCELLED'), 'HR cancels a scheduled meeting with a reason');
select test.check((select (meeting_hr_overview() ->> 'completed')::int = 1 and (meeting_hr_overview() ->> 'declinedOrCancelled')::int = 2 and (meeting_hr_overview() ->> 'total')::int = 3), 'the totals add up');
select test.login('tm_a');
select test.check((select meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'outcome' is null and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'followUp' is null and meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'meeting' ->> 'status' = 'COMPLETED'), 'the employee does not see the outcome or the follow-up');
select test.check((select not exists (select 1 from jsonb_array_elements(meeting_my_detail(pg_temp.g('m_tm')::uuid) -> 'events') e where e ->> 'body' like '%leave ledger%' or e ->> 'body' like '%Explained%')), 'nor in the history');
-- the employee withdraws a pending request
insert into ie select 'm_tm2', (meeting_submit('22222222-0000-4000-8000-000000000004', 'Another topic', 'OTHER', 'A second request that I will withdraw later on.', current_date + 8, '12:00', 'ONLINE', null) ->> 'id');
select test.check((select meeting_my_cancel(pg_temp.g('m_tm2')::uuid, 'No longer needed') -> 'meeting' ->> 'status' = 'CANCELLED'), 'an employee withdraws their own pending request');
select test.must_fail($$select meeting_my_cancel(pg_temp.g('m_tm2')::uuid)$$, 'and cannot cancel it twice', 'can no longer be cancelled');
reset role;
select test.check((select count(*) >= 6 from audit_logs where action like 'EMPLOYEE_MEETING_%'), 'meeting decisions are in the audit log');
select test.check((select not exists (select 1 from audit_logs where action like 'EMPLOYEE_MEETING%' and (metadata::text ilike '%leave ledger%' or metadata::text ilike '%Explained%')) ), 'the audit log never holds meeting text');
select test.check((select count(*) >= 8 from employee_case_events where meeting_id is not null), 'the meeting history records each step');
select test.check((select bool_and(i.priority is not null) from employee_issues i), 'sanity: issues keep their priority');

-- ---------------------------------------------------------------- the Super Admin works the HR pages; a suspended person cannot
set role authenticated;
select test.login('sa');
select test.check((select (issue_hr_list() ->> 'total')::int = 5 and (meeting_hr_list() ->> 'total')::int = 4), 'the Super Admin can read every case');
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('tm_a');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select issue_my_list()$$, 'a suspended employee cannot use it', 'Only a Team Member');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('tm_a');

-- ---------------------------------------------------------------- the schema
select test.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.employee_issues'::regclass, 'public.employee_meeting_requests'::regclass, 'public.employee_case_events'::regclass, 'public.employee_issue_attachments'::regclass)), 'row level security is on for all four tables');
select test.check((select not has_table_privilege('authenticated', 'public.employee_issues', 'insert') and not has_table_privilege('authenticated', 'public.employee_issues', 'update') and not has_table_privilege('authenticated', 'public.employee_issues', 'delete')
                     and not has_table_privilege('authenticated', 'public.employee_meeting_requests', 'update') and not has_table_privilege('authenticated', 'public.employee_case_events', 'insert') and not has_table_privilege('authenticated', 'public.employee_issue_attachments', 'select')),
  'signed-in users can only read (never write) the tables; attachments are not readable at all');
select test.check((select not has_table_privilege('anon', 'public.employee_issues', 'select') and not has_table_privilege('anon', 'public.employee_case_events', 'select')), 'signed-out visitors have no access');
-- 30 functions of 20261210000100, + issue_hr_escalate (20270128000200)
select test.check((select count(*) = 31 and bool_and(p.prosecdef) and bool_and(not has_function_privilege('anon', p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and (p.proname like 'issue\_%' or p.proname like 'meeting\_%')), 'every new function is security definer and closed to signed-out visitors');
\echo '=== EMPLOYEE ISSUES AND MEETING REQUESTS TESTS PASSED ==='
