-- =============================================================================
-- Report a bug to the Developers team (migration 20270122000300): the developers list (seeded by name in AI Studio; the Super Admin keeps
-- it but gets no Bugs section), employees of every department reporting a bug with files, one bug per form, the Bugs section for the
-- developers only (list, open, assign among themselves, status, internal comments, history), the reporter following their bug (status and
-- resolution, never internal comments), the files' access, and the history kept as it happened.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 135. Bugs for the Developers team'
reset role;
select set_config('request.jwt.claims', '', false);
-- the three developers of the AI CRM team in AI Studio, and an AI Studio colleague who is not one of them
select test.create_auth_user(u, e, jsonb_build_object('full_name', n),
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'ai-studio' order by t.created_at limit 1)))
  from (values ('dv_shreya', 'shreya.mande@example.com', 'Shreya  Mande'), ('dv_ashish', 'ashish.sinha@example.com', 'Ashish Sinha'),
               ('dv_siddhesh', 'siddhesh.shinde@example.com', 'Siddhesh Shinde'), ('dv_other', 'ai.other@example.com', 'AI Other')) v(u, e, n);
\i supabase/migrations/20270122000300_developer_bugs.sql
\i supabase/migrations/20270122000300_developer_bugs.sql
create temp table bg (k text primary key, v jsonb);
grant all on bg to authenticated;
create or replace function test.bug(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.dev_bugs where title = p_title $$;
create or replace function test.bug_upload(p_user text, p_name text) returns uuid language sql security definer set search_path = '' as $$
  insert into public.employee_issue_attachments (uploader_id, file_name, mime_type, size_bytes, status, storage_path)
  values (test.id(p_user), p_name, 'image/png', 1000, 'READY', p_user || '/' || p_name) returning id $$;
create or replace function test.att(p_name text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.employee_issue_attachments where file_name = p_name order by created_at desc limit 1 $$;
grant execute on all functions in schema test to anon, authenticated;
delete from dev_bugs where title like 'BG %';

\echo '   the developers'
select test.check((select count(*) = 3 from dev_team_members where profile_id in (test.id('dv_shreya'), test.id('dv_ashish'), test.id('dv_siddhesh'))),
  'Shreya Mande, Ashish Sinha and Siddhesh Shinde are the developers (matched by name in AI Studio, extra spaces ignored)');
select test.check(not exists (select 1 from dev_team_members where profile_id in (test.id('dv_other'), test.id('sa'))), 'nobody else in AI Studio, and not the Super Admin');
set role authenticated;
select test.login('dv_ashish');
select test.check((bug_access() ->> 'isDeveloper')::boolean and jsonb_array_length(bug_access() -> 'developers') = 3, 'a developer opens the Bugs section and sees the three developers');
select test.login('dv_other');
select test.check(not (bug_access() ->> 'isDeveloper')::boolean, 'an AI Studio colleague who is not a developer does not');
select test.login('sa');
select test.check(not (bug_access() ->> 'isDeveloper')::boolean, 'nor the Super Admin');
select test.must_fail($$select bug_dev_list()$$, 'the Super Admin cannot list the bugs', 'Developers team only');
select test.check(jsonb_array_length(dev_team_list()) >= 3, 'the Super Admin keeps the developers list');

\echo '   employees of every department report bugs'
select test.login('tm_a');
insert into bg select 'a', bug_submit('BG Invoice PDF is blank', 'The invoice PDF opens with an empty page for every customer.', '1. Open Accounts 2. Download an invoice',
                                     array[test.bug_upload('tm_a', 'screen.png')], 'bg-key-0001');
select test.check((select v ->> 'status' = 'PENDING' and v ->> 'reference' like 'BUG-%' and v ->> 'reporterName' is not null and v ->> 'department' is not null
                          and v ->> 'designation' is not null and jsonb_array_length(v -> 'attachments') = 1 and (v ->> 'duplicate')::boolean = false from bg where k = 'a'),
  'a Sales Team Member reports a bug with a screenshot: PENDING, their name, department and designation from their profile');
select test.check((bug_submit('BG Invoice PDF is blank', 'The invoice PDF opens with an empty page for every customer.', null, null, 'bg-key-0001') ->> 'duplicate')::boolean,
  'the same form again returns the first bug');
reset role;
select test.check((select count(*) = 1 from dev_bugs where title = 'BG Invoice PDF is blank'), 'no duplicate bug');
select test.check((select count(*) = 3 from notifications where type = 'DEV_BUG_REPORTED' and entity_id = test.bug('BG Invoice PDF is blank')),
  'each of the three developers is notified once');
set role authenticated;
select test.login('sup_b');
insert into bg select 's', bug_submit('BG Ticket list is slow', 'Opening the ticket list takes more than a minute.', null, null, 'bg-key-0002');
select test.login('th_wab');
select bug_submit('BG Lead filter resets', 'The lead filter resets after every page change.', null, null, 'bg-key-0003');
select test.login('dh_wab');
select bug_submit('BG Report export fails', 'The monthly report export fails with an error.', null, null, 'bg-key-0004');
select test.login('tm_a');
select test.must_fail($$select bug_submit('BG', 'The invoice PDF opens with an empty page.', null, null, 'bg-key-0005')$$, 'a title is required', 'title');
select test.must_fail($$select bug_submit('BG Short', 'too short', null, null, 'bg-key-0006')$$, 'a description is required', 'Describe');
select test.must_fail($$select bug_submit('BG Someone else''s file', 'Using a file uploaded by someone else.', null, array[test.bug_upload('sup_b', 'theirs.png')], 'bg-key-0007')$$,
  'only one''s own uploaded files', 'not available any more');
select test.must_fail($$select bug_submit('BG Reused file', 'Using a file already attached to a bug.', null,
                         array[test.att('screen.png')], 'bg-key-0008')$$, 'a file already on a bug cannot be reused', 'not available any more');
select test.login('sa');
select test.must_fail($$select bug_submit('BG From the Super Admin', 'The Super Admin is not an employee here.', null, null, 'bg-key-0009')$$, 'the Super Admin does not report bugs here', 'FORBIDDEN');
select test.must_fail($$insert into dev_bugs (reference, reporter_id, reporter_name, title, description, client_request_id) values ('X', test.id('sa'), 'x', 'xxx', 'xxxxxxxxxxxx', 'xxxxxxxxxx')$$,
  'nobody writes the table directly', 'permission denied');

\echo '   the Bugs section: developers only'
select test.login('dv_shreya');
select test.check((select (v ->> 'total')::int >= 4 and (v -> 'counts' ->> 'PENDING')::int >= 4 and (v -> 'counts' ->> 'UNASSIGNED')::int >= 4 from (select bug_dev_list() as v) x),
  'every reported bug appears in the Bugs section, from every department');
select test.check((select x ->> 'reporterName' is not null and x ->> 'department' is not null and (x ->> 'attachmentCount')::int = 1
                     from jsonb_array_elements(bug_dev_list(p_search => 'invoice PDF') -> 'items') x), 'each row: reporter, department, files');
select test.check((select jsonb_array_length(v -> 'attachments') = 1 and v ->> 'description' like 'The invoice PDF%' and v ->> 'steps' like '1. Open%' from (select bug_dev_detail(test.bug('BG Invoice PDF is blank')) as v) x),
  'a developer opens a bug: description, steps, files');
select test.login('dv_other');
select test.must_fail($$select bug_dev_list()$$, 'another AI Studio member cannot open the Bugs section', 'Developers team only');
select test.must_fail($$select bug_dev_detail(test.bug('BG Invoice PDF is blank'))$$, '... nor a bug', 'Developers team only');
select test.login('dh_wab');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Report export fails'), 'RESOLVED', 'Fixed it myself')$$, 'a Department Head cannot change a bug', 'Developers team only');
select test.login('tm_a');
select test.must_fail($$select bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('tm_a'))$$, 'the reporter cannot assign it', 'Developers team only');

\echo '   assign, status, comments'
select test.login('dv_shreya');
select test.check((bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_ashish')) ->> 'assigneeName') = 'Ashish Sinha', 'a developer assigns a bug to another developer');
select test.must_fail($$select bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_other'))$$, 'only to a developer', 'Developers team');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('dv_ashish') and type = 'DEV_BUG_ASSIGNED'), 'the assigned developer is notified');
set role authenticated;
select test.login('dv_ashish');
select test.check((select (x ->> 'total')::int >= 1 from (select bug_dev_list(p_assignee => 'ME') as x) y), 'Ashish sees it under "assigned to me"');
select test.check((bug_dev_set_status(test.bug('BG Invoice PDF is blank'), 'IN_PROGRESS', null) ->> 'status') = 'IN_PROGRESS', 'In Progress');
select test.check((select count(*) = 1 from jsonb_array_elements(bug_dev_comment(test.bug('BG Invoice PDF is blank'), 'Caused by the new font loader') -> 'history') h
                    where (h ->> 'internal')::boolean), 'an internal comment');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Invoice PDF is blank'), 'RESOLVED', null)$$, 'resolving needs the resolution note', 'resolution note');
select test.check((select v ->> 'status' = 'RESOLVED' and v ->> 'resolutionNote' = 'Fixed in release 2.4; please download again.' and v ->> 'resolvedAt' is not null
                     from (select bug_dev_set_status(test.bug('BG Invoice PDF is blank'), 'RESOLVED', 'Fixed in release 2.4; please download again.') as v) x),
  'Resolved, with the note');
select test.check((bug_dev_set_status(test.bug('BG Ticket list is slow'), 'IN_PROGRESS', null) ->> 'assigneeName') = 'Ashish Sinha', 'starting work on an unassigned bug takes it');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Lead filter resets'), 'REJECTED', '')$$, 'rejecting needs the reason', 'why it is rejected');
select test.check((bug_dev_set_status(test.bug('BG Lead filter resets'), 'REJECTED', 'Works as designed: the filter is per page.') ->> 'status') = 'REJECTED', 'Rejected, with the reason');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Lead filter resets'), 'CLOSED', null)$$, 'only the four statuses', 'Pending, In Progress, Resolved or Rejected');
select test.check((select (x -> 'counts' ->> 'RESOLVED')::int >= 1 and (x -> 'counts' ->> 'REJECTED')::int >= 1 from (select bug_dev_list() as x) y), 'pending and completed are counted');
select test.check((select (bug_dev_list(p_status => 'CLOSED') ->> 'total')::int >= 2), 'the completed ones can be listed');
select test.login('dv_siddhesh');
select test.check((select count(*) >= 5 from jsonb_array_elements(bug_dev_detail(test.bug('BG Invoice PDF is blank')) -> 'history')),
  'the third developer sees the whole history: submitted, assigned, status changes, comment, resolution');

\echo '   the reporter follows their bug'
select test.login('tm_a');
select test.check((select x ->> 'status' = 'RESOLVED' and x ->> 'assigneeName' = 'Ashish Sinha' and x ->> 'resolutionNote' like 'Fixed in release 2.4%'
                     from jsonb_array_elements(bug_my_list()) x where x ->> 'title' = 'BG Invoice PDF is blank'), 'the employee sees the status, the developer and the resolution');
select test.check(not exists (select 1 from jsonb_array_elements(bug_my_detail(test.bug('BG Invoice PDF is blank')) -> 'history') h where (h ->> 'internal')::boolean or h ->> 'note' like 'Caused by%'),
  'but never the internal comment');
select test.check(not exists (select 1 from jsonb_array_elements(bug_my_list()) x where x ->> 'title' = 'BG Ticket list is slow'), 'only their own bugs');
select test.must_fail($$select bug_my_detail(test.bug('BG Ticket list is slow'))$$, 'someone else''s bug is not found', 'not found');
reset role;
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('tm_a') and type = 'DEV_BUG_STATUS'), 'the reporter is notified of status changes');

\echo '   the files'
set role authenticated;
select test.login('dv_siddhesh');
select test.check((issue_attachment_download(test.att('screen.png'))).file_name = 'screen.png', 'a developer opens the screenshot');
select test.login('tm_a');
select test.check((issue_attachment_download(test.att('screen.png'))).file_name = 'screen.png', 'the reporter too');
select test.login('sup_b');
select test.must_fail($$select issue_attachment_download(test.att('screen.png'))$$, 'nobody else', 'not found');
select test.login('dv_other');
select test.must_fail($$select issue_attachment_download(test.att('screen.png'))$$, '... not even in AI Studio', 'not found');

\echo '   the history is kept'
reset role;
select test.must_fail($$update dev_bug_events set note = 'changed' where bug_id = test.bug('BG Invoice PDF is blank')$$, 'history entries cannot be changed', 'cannot be changed');
select test.must_fail($$delete from dev_bug_events where bug_id = test.bug('BG Invoice PDF is blank')$$, '... nor deleted', 'cannot be changed');
select test.check((select count(*) >= 3 from audit_logs where action in ('DEV_BUG_REPORTED', 'DEV_BUG_ASSIGNED', 'DEV_BUG_STATUS_CHANGED') and created_at > now() - interval '5 minutes'),
  'reporting, assigning and status changes are audited');

\echo '   the Super Admin keeps the list'
set role authenticated;
select test.login('sa');
select test.check(exists (select 1 from jsonb_array_elements(dev_team_set(test.id('dv_other'), true)) x where (x ->> 'id')::uuid = test.id('dv_other')), 'the Super Admin adds a developer');
select test.login('dv_other');
select test.check((bug_access() ->> 'isDeveloper')::boolean, '... who now has the Bugs section');
select test.login('sa');
select dev_team_set(test.id('dv_other'), false);
select test.login('dv_other');
select test.must_fail($$select bug_dev_list()$$, 'removed again: no Bugs section', 'Developers team only');
select test.login('dv_shreya');
select test.must_fail($$select dev_team_set(test.id('dv_other'), true)$$, 'a developer cannot change the list', 'Only the Super Admin');
select test.login('sa');
select test.must_fail($$select dev_team_set(test.id('sa'), true)$$, 'the Super Admin cannot be a developer', 'not the Super Admin');
reset role;
delete from dev_bugs where title like 'BG %';
delete from employee_issue_attachments where file_name in ('screen.png', 'theirs.png');
select set_config('request.jwt.claims', '', false);
