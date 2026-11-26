-- =============================================================================
-- Bugs for the Developers team (migrations 20270122000300 and 20270122000400), tested with each of the three developer accounts:
--  - the team: Shreya Mande (Team Lead), Ashish Sinha and Siddhesh Shinde, found by name in any department and with the usual spellings
--    (the test account is "Siddesh Shinde" in another department: the case where the first seeding missed him); the Super Admin keeps the
--    list but has no Bugs section;
--  - employees of every department report bugs (files, one bug per form); every new, unassigned bug is seen by ALL THREE developers;
--  - only the Team Lead assigns (to Ashish or Siddhesh), re-assigns and un-assigns; after assignment the bug is seen by the lead and the
--    assigned developer only, everywhere (lists, counts, details, comments, files, row level security); assignment history with times;
--    nothing deleted or duplicated;
--  - status: the assigned developer or the lead (a note to close); the reporter follows status and resolution, never internal comments.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 135. Bugs for the Developers team (Team Lead assignment)'
reset role;
select set_config('request.jwt.claims', '', false);
select test.create_auth_user(u, e, jsonb_build_object('full_name', n),
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', t))
  from (values
    ('dv_shreya', 'shreya.mande@example.com', 'Shreya  Mande', (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'ai-studio' order by t.created_at limit 1)),
    ('dv_ashish', 'ashish.sinha@example.com', 'Ashish Sinha', (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'ai-studio' order by t.created_at limit 1)),
    -- spelled differently and placed outside AI Studio: the first seeding (AI Studio, exact name) never found him
    ('dv_siddhesh', 'siddhesh.shinde@example.com', 'Siddesh Shinde', test.team('wabastore', 'Sales')),
    ('dv_other', 'ai.other@example.com', 'AI Other', (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'ai-studio' order by t.created_at limit 1))
  ) v(u, e, n, t);
\i supabase/migrations/20270122000400_bug_team_lead_assignment.sql
\i supabase/migrations/20270122000400_bug_team_lead_assignment.sql
create temp table bg (k text primary key, v jsonb);
grant all on bg to authenticated;
create or replace function test.bug(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.dev_bugs where title = p_title $$;
create or replace function test.bug_upload(p_user text, p_name text) returns uuid language sql security definer set search_path = '' as $$
  insert into public.employee_issue_attachments (uploader_id, file_name, mime_type, size_bytes, status, storage_path)
  values (test.id(p_user), p_name, 'image/png', 1000, 'READY', p_user || '/' || p_name) returning id $$;
create or replace function test.att(p_name text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.employee_issue_attachments where file_name = p_name order by created_at desc limit 1 $$;
-- the titles one person sees in their Bugs list (optionally filtered)
create or replace function test.sees(p_title text, p_assignee text default null) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(bug_dev_list(p_assignee => p_assignee, p_limit => 100) -> 'items') x where x ->> 'title' = p_title) $$;
grant execute on all functions in schema test to anon, authenticated;
delete from dev_bugs where title like 'BG %';

\echo '   the team'
select test.check((select count(*) = 3 from dev_team_members where profile_id in (test.id('dv_shreya'), test.id('dv_ashish'), test.id('dv_siddhesh'))),
  'Shreya Mande, Ashish Sinha and Siddhesh Shinde are the developers (Siddhesh found although spelled "Siddesh" and outside AI Studio)');
select test.check((select is_lead from dev_team_members where profile_id = test.id('dv_shreya'))
                  and not (select is_lead from dev_team_members where profile_id = test.id('dv_ashish'))
                  and not (select is_lead from dev_team_members where profile_id = test.id('dv_siddhesh')), 'Shreya is the Team Lead; Ashish and Siddhesh are developers');
select test.check(not exists (select 1 from dev_team_members where profile_id in (test.id('dv_other'), test.id('sa'))), 'nobody else, and not the Super Admin');
set role authenticated;
select test.login('dv_shreya');
select test.check((select (a ->> 'isLead')::boolean and jsonb_array_length(a -> 'developers') = 2
                          and (a -> 'developers') @> jsonb_build_array(jsonb_build_object('name', 'Ashish Sinha')) from (select bug_access() as a) x),
  'Shreya: Team Lead, and can assign to the two developers (Ashish Sinha, Siddhesh Shinde)');
select test.login('dv_siddhesh');
select test.check((select (a ->> 'isDeveloper')::boolean and not (a ->> 'isLead')::boolean and jsonb_array_length(a -> 'developers') = 0 from (select bug_access() as a) x),
  'Siddhesh: has the Bugs section (no assignment control)');
select test.login('dv_ashish');
select test.check((select (a ->> 'isDeveloper')::boolean and not (a ->> 'isLead')::boolean from (select bug_access() as a) x), 'Ashish: has the Bugs section');
select test.login('dv_other');
select test.check(not (bug_access() ->> 'isDeveloper')::boolean, 'an AI Studio colleague who is not a developer has none');
select test.login('sa');
select test.must_fail($$select bug_dev_list()$$, 'nor the Super Admin', 'Developers team only');

\echo '   employees report bugs: all three developers see every new one'
select test.login('tm_a');
insert into bg select 'a', bug_submit('BG Invoice PDF is blank', 'The invoice PDF opens with an empty page for every customer.', '1. Open Accounts 2. Download an invoice',
                                     array[test.bug_upload('tm_a', 'screen.png')], 'bg-key-0001');
select test.check((select v ->> 'assignmentStatus' = 'UNASSIGNED' and v ->> 'assigneeId' is null and v ->> 'status' = 'PENDING' and jsonb_array_length(v -> 'attachments') = 1
                          and (v ->> 'duplicate')::boolean = false from bg where k = 'a'), 'a new bug is PENDING and UNASSIGNED, with its screenshot');
select test.check((bug_submit('BG Invoice PDF is blank', 'The invoice PDF opens with an empty page for every customer.', null, null, 'bg-key-0001') ->> 'duplicate')::boolean,
  'the same form again is the same bug');
select test.login('sup_b');
select bug_submit('BG Ticket list is slow', 'Opening the ticket list takes more than a minute.', null, null, 'bg-key-0002');
select test.login('th_wab');
select bug_submit('BG Lead filter resets', 'The lead filter resets after every page change.', null, null, 'bg-key-0003');
select test.login('dh_wab');
select bug_submit('BG Report export fails', 'The monthly report export fails with an error.', null, null, 'bg-key-0004');
reset role;
select test.check((select count(*) = 3 from notifications where type = 'DEV_BUG_REPORTED' and entity_id = test.bug('BG Invoice PDF is blank')
                    and recipient_id in (test.id('dv_shreya'), test.id('dv_ashish'), test.id('dv_siddhesh'))), 'each of the three developers is notified');
set role authenticated;
select test.login('dv_shreya');
select test.check(test.sees('BG Invoice PDF is blank') and test.sees('BG Ticket list is slow') and test.sees('BG Lead filter resets') and test.sees('BG Report export fails'),
  'Shreya sees all four new bugs');
insert into bg select 'shreya_a', bug_dev_detail(test.bug('BG Invoice PDF is blank'));
select test.login('dv_ashish');
select test.check(test.sees('BG Invoice PDF is blank') and test.sees('BG Ticket list is slow') and test.sees('BG Lead filter resets') and test.sees('BG Report export fails'),
  'Ashish sees all four new bugs');
insert into bg select 'ashish_a', bug_dev_detail(test.bug('BG Invoice PDF is blank'));
select test.login('dv_siddhesh');
select test.check(test.sees('BG Invoice PDF is blank') and test.sees('BG Ticket list is slow') and test.sees('BG Lead filter resets') and test.sees('BG Report export fails'),
  'Siddhesh sees all four new bugs too');
select test.check(test.sees('BG Invoice PDF is blank', 'UNASSIGNED') and ((bug_dev_list() -> 'counts' ->> 'UNASSIGNED')::int >= 4), '... under Unassigned, and counted');
insert into bg select 'siddhesh_a', bug_dev_detail(test.bug('BG Invoice PDF is blank'));
select test.check((select count(distinct (v - 'assignments') #>> '{}') = 1 and bool_and(jsonb_array_length(v -> 'attachments') = 1 and v ->> 'reporterName' is not null
                          and v ->> 'department' is not null and v ->> 'designation' is not null and v ->> 'createdAt' is not null)
                     from bg where k in ('shreya_a', 'ashish_a', 'siddhesh_a')),
  'all three get the same bug: details, screenshot, employee, department, designation, submission time');
select test.check((issue_attachment_download(test.att('screen.png'))).file_name = 'screen.png', 'Siddhesh opens the screenshot');

\echo '   only the Team Lead assigns'
select test.must_fail($$select bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_siddhesh'))$$, 'Siddhesh cannot assign (not even to himself)', 'Only the Team Lead');
select test.login('dv_ashish');
select test.must_fail($$select bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_ashish'))$$, 'Ashish cannot assign', 'Only the Team Lead');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Invoice PDF is blank'), 'IN_PROGRESS', null)$$, 'nor start an unassigned bug on his own', 'Ask the Team Lead');
select test.check((select count(*) = 1 from jsonb_array_elements(bug_dev_comment(test.bug('BG Invoice PDF is blank'), 'Looks like the font loader') -> 'history') h
                    where (h ->> 'internal')::boolean), 'but can comment on an unassigned bug he reviews');
select test.login('dv_shreya');
select test.must_fail($$select bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_shreya'))$$, 'the lead assigns to a developer, not to herself', 'one of the developers');
select test.must_fail($$select bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_other'))$$, 'nor to someone outside the team', 'one of the developers');

\echo '   assigned to Ashish: Shreya and Ashish see it, Siddhesh no longer'
insert into bg select 'assigned', bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_ashish'));
select test.check((select v ->> 'assignmentStatus' = 'ASSIGNED' and v ->> 'assigneeName' = 'Ashish Sinha' and v ->> 'assignedByName' like 'Shreya%'
                          and v ->> 'assignedAt' is not null and jsonb_array_length(v -> 'assignments') = 1 from bg where k = 'assigned'),
  'assigned_to Ashish, assigned_by Shreya, assigned_at, ASSIGNED, one assignment in the history');
insert into bg select 'assigned2', bug_dev_assign(test.bug('BG Ticket list is slow'), test.id('dv_siddhesh'));
select test.check(test.sees('BG Invoice PDF is blank') and test.sees('BG Ticket list is slow'), 'Shreya still sees both');
select test.check(test.sees('BG Invoice PDF is blank', test.id('dv_ashish')::text) and test.sees('BG Ticket list is slow', test.id('dv_siddhesh')::text)
                  and test.sees('BG Lead filter resets', 'UNASSIGNED'), 'her consolidated view: by developer, and the unassigned ones');
select test.check((select (x ->> 'open')::int >= 1 from jsonb_array_elements(bug_dev_list() -> 'byDeveloper') x where x ->> 'name' = 'Ashish Sinha')
                  and (select (x ->> 'open')::int >= 1 from jsonb_array_elements(bug_dev_list() -> 'byDeveloper') x where x ->> 'name' like 'Siddesh%'),
  'and each developer''s workload');
select test.login('dv_ashish');
select test.check(test.sees('BG Invoice PDF is blank', 'ME'), 'Ashish sees it under Assigned to me');
select test.check(not test.sees('BG Ticket list is slow'), 'Ashish no longer sees the bug assigned to Siddhesh');
select test.must_fail($$select bug_dev_detail(test.bug('BG Ticket list is slow'))$$, '... nor can he open it', 'not found');
select test.check(test.sees('BG Lead filter resets') and test.sees('BG Report export fails'), 'he still sees the unassigned ones');
select test.login('dv_siddhesh');
select test.check(not test.sees('BG Invoice PDF is blank'), 'Siddhesh no longer sees the bug assigned to Ashish');
select test.check(test.sees('BG Ticket list is slow', 'ME'), 'he sees the one assigned to him');
select test.must_fail($$select bug_dev_detail(test.bug('BG Invoice PDF is blank'))$$, '... and cannot open Ashish''s', 'not found');
select test.must_fail($$select bug_dev_comment(test.bug('BG Invoice PDF is blank'), 'x')$$, '... nor comment on it', 'not found');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Invoice PDF is blank'), 'RESOLVED', 'Fixed it')$$, '... nor change it', 'not found');
select test.must_fail($$select issue_attachment_download(test.att('screen.png'))$$, '... nor open its screenshot', 'not found');
select test.check(not exists (select 1 from dev_bugs where title = 'BG Invoice PDF is blank') and exists (select 1 from dev_bugs where title = 'BG Ticket list is slow')
                  and exists (select 1 from dev_bugs where title = 'BG Lead filter resets'),
  'row level security agrees: reading the table directly, Siddhesh gets his own and the unassigned bugs, not Ashish''s');
select test.check(not exists (select 1 from dev_bug_events e where e.bug_id = test.bug('BG Invoice PDF is blank')), '... nor its history');
select test.check((bug_dev_list() -> 'counts' ->> 'MINE')::int = 1, 'his counts follow (one assigned to him)');

\echo '   status: the assigned developer and the lead'
select test.check((bug_dev_set_status(test.bug('BG Ticket list is slow'), 'IN_PROGRESS', null) ->> 'status') = 'IN_PROGRESS', 'Siddhesh starts his bug');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Ticket list is slow'), 'RESOLVED', null)$$, 'resolving needs the resolution note', 'resolution note');
select test.check((bug_dev_set_status(test.bug('BG Ticket list is slow'), 'RESOLVED', 'Added an index; the list now opens in a second.') ->> 'status') = 'RESOLVED',
  'Siddhesh resolves it with the note');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('dv_shreya') and type = 'DEV_BUG_PROGRESS' and entity_id = test.bug('BG Ticket list is slow')
                     and title like '%resolved%'), 'the lead is told of the progress');
set role authenticated;
select test.login('dv_shreya');
select test.check((select x ->> 'status' = 'RESOLVED' from jsonb_array_elements(bug_dev_list(p_status => 'RESOLVED') -> 'items') x where x ->> 'title' = 'BG Ticket list is slow'),
  'Shreya sees the resolution');
select test.check((bug_dev_set_status(test.bug('BG Lead filter resets'), 'REJECTED', 'Works as designed: the filter is per page.') ->> 'status') = 'REJECTED',
  'the lead changes the status of any bug');

\echo '   re-assigning and un-assigning'
insert into bg select 'moved', bug_dev_assign(test.bug('BG Invoice PDF is blank'), test.id('dv_siddhesh'));
select test.check((select v ->> 'assigneeName' like 'Siddesh%' and jsonb_array_length(v -> 'assignments') = 2 from bg where k = 'moved'), 're-assigned to Siddhesh; two assignments in the history');
select test.check((select count(*) = 1 from dev_bugs where title = 'BG Invoice PDF is blank') and (select count(*) = 2 from dev_bug_assignments where bug_id = test.bug('BG Invoice PDF is blank')),
  'one bug record, two timestamped assignments');
select test.login('dv_ashish');
select test.check(not test.sees('BG Invoice PDF is blank'), 'Ashish no longer sees it');
select test.login('dv_siddhesh');
select test.check(test.sees('BG Invoice PDF is blank', 'ME'), 'Siddhesh now has it');
select test.login('dv_shreya');
select test.check((bug_dev_assign(test.bug('BG Report export fails'), test.id('dv_ashish')) ->> 'assignmentStatus') = 'ASSIGNED', 'another one to Ashish');
select test.check((bug_dev_assign(test.bug('BG Report export fails'), null) ->> 'assignmentStatus') = 'UNASSIGNED', 'un-assigned again');
select test.login('dv_siddhesh');
select test.check(test.sees('BG Report export fails', 'UNASSIGNED'), 'unassigned: every developer sees it again');

\echo '   the reporter'
select test.login('tm_a');
select test.check((select x ->> 'assigneeName' like 'Siddesh%' and x ->> 'status' = 'PENDING' from jsonb_array_elements(bug_my_list()) x where x ->> 'title' = 'BG Invoice PDF is blank'),
  'the employee sees who works on it and its status');
select test.check(not exists (select 1 from jsonb_array_elements(bug_my_detail(test.bug('BG Invoice PDF is blank')) -> 'history') h where (h ->> 'internal')::boolean),
  'never an internal comment');
select test.check(jsonb_array_length(bug_my_detail(test.bug('BG Invoice PDF is blank')) -> 'assignments') = 0, 'nor the team''s assignment history');
select test.check(exists (select 1 from dev_bugs where title = 'BG Invoice PDF is blank') and not exists (select 1 from dev_bugs where title = 'BG Ticket list is slow'),
  'row level security: the reporter reads their own bug only');
select test.check(not exists (select 1 from dev_bug_events e where e.bug_id = test.bug('BG Invoice PDF is blank') and e.visibility = 'DEV'), '... and none of its internal comments');
select test.must_fail($$select bug_dev_list()$$, 'and has no Bugs section', 'Developers team only');
select test.login('tm_c');
select test.check(not exists (select 1 from dev_bugs where title like 'BG %'), 'another employee reads no bug');
select test.must_fail($$update dev_bugs set assigned_to = null where title like 'BG %'$$, 'nobody changes a bug past the functions', 'permission denied');
select test.login('dv_siddhesh');
select test.must_fail($$update dev_bugs set assigned_to = auth.uid() where title = 'BG Lead filter resets'$$, 'not even a developer', 'permission denied');

\echo '   history and audit'
reset role;
select test.must_fail($$update dev_bug_events set note = 'changed' where bug_id = test.bug('BG Invoice PDF is blank')$$, 'history entries cannot be changed', 'cannot be changed');
select test.check((select count(*) >= 3 from audit_logs where action = 'DEV_BUG_ASSIGNED' and created_at > now() - interval '5 minutes'), 'assignments are audited');

\echo '   the Super Admin keeps the team'
set role authenticated;
select test.login('sa');
select test.check((select count(*) = 1 and bool_and((x ->> 'isLead')::boolean) from jsonb_array_elements(dev_team_list()) x where (x ->> 'isLead')::boolean),
  'the Super Admin sees who the Team Lead is');
select test.check(exists (select 1 from jsonb_array_elements(dev_team_set(test.id('dv_other'), true)) x where (x ->> 'id')::uuid = test.id('dv_other') and not (x ->> 'isLead')::boolean),
  'adds a developer');
select dev_team_set(test.id('dv_other'), false);
select test.login('dv_other');
select test.must_fail($$select bug_dev_list()$$, 'removed again: no Bugs section', 'Developers team only');
select test.login('sa');
select dev_team_set(test.id('dv_siddhesh'), false);
reset role;
select test.check((select assigned_to is null and assignment_status = 'UNASSIGNED' from dev_bugs where title = 'BG Invoice PDF is blank'),
  'removing a developer puts their open bugs back to unassigned (visible to the team again)');
set role authenticated;
select test.login('sa');
select dev_team_set(test.id('dv_siddhesh'), true);
select test.login('dv_shreya');
select test.must_fail($$select dev_team_set(test.id('dv_other'), true)$$, 'the lead does not change the list', 'Only the Super Admin');
-- ---------------------------------------------------------------------------
-- 20270124000100: Siddhesh's real account (siddhesh.amuwa@gmail.com), recognised by EMAIL. His profile name ("S. Shinde") matches no
-- name rule, which is what left him without the Bugs section while Shreya and Ashish had it.
-- ---------------------------------------------------------------------------
\echo '   developer access by email (siddhesh.amuwa@gmail.com)'
reset role;
select set_config('request.jwt.claims', '', false);
select test.create_auth_user('dv_sid_mail', 'Siddhesh.Amuwa@Gmail.com', jsonb_build_object('full_name', 'S. Shinde'),
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
    'provisioned_team_id', (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'ai-studio' order by t.created_at limit 1)));
select test.check(exists (select 1 from dev_team_emails where email = 'siddhesh.amuwa@gmail.com'), 'the developer email list holds siddhesh.amuwa@gmail.com');
select test.check(not exists (select 1 from profiles where id = test.id('dv_sid_mail') and role = 'SUPER_ADMIN'), 'his profile is not a Super Admin');
-- a profile that is not ACTIVE is never given access; approving it (any time later) gives it
delete from dev_team_members where profile_id = test.id('dv_sid_mail');
-- (deleting a member also forgets its email, by design; put it back to model an account that never got its membership row)
insert into dev_team_emails (email) values ('siddhesh.amuwa@gmail.com') on conflict do nothing;
update profiles set status = 'SUSPENDED' where id = test.id('dv_sid_mail') and status = 'ACTIVE';
select test.check((select status = 'SUSPENDED' from profiles where id = test.id('dv_sid_mail'))
                  and private.dev_team_sync_emails(test.id('dv_sid_mail')) = 0 and not private.is_developer(test.id('dv_sid_mail')), 'a suspended profile is not made a developer');
update profiles set status = 'ACTIVE' where id = test.id('dv_sid_mail') and status = 'SUSPENDED';
select test.check(private.is_developer(test.id('dv_sid_mail')) and not private.is_bug_lead(test.id('dv_sid_mail')),
  'once ACTIVE the profile is picked up by its email: a developer, not the Team Lead');
-- running the migration's sync again changes nothing (safe to run twice)
select test.check(private.dev_team_sync_emails() = 0 and (select count(*) = 1 from dev_team_members where profile_id = test.id('dv_sid_mail')), 'running it again adds nothing');

set role authenticated;
select test.login('dv_sid_mail');
select test.check((a ->> 'isDeveloper')::boolean and not (a ->> 'isLead')::boolean and jsonb_array_length(a -> 'developers') = 0, 'his account has the Bugs section (bug_access)')
  from (select bug_access() as a) x;
select test.must_fail($$select dev_team_list()$$, 'but no Super Admin function', 'Only the Super Admin');
select test.must_fail($$select dev_team_set(auth.uid(), true, true)$$, 'cannot make himself the lead or manage the team', 'Only the Super Admin');
select test.must_fail($$select bug_dev_assign(test.bug('BG Report export fails'), auth.uid())$$, 'and cannot assign bugs', 'Only the Team Lead');

\echo '   a new bug from an employee: Shreya, Ashish and Siddhesh (real account) all see it'
select test.login('th_wab');
select bug_submit('BG Email path login fails', 'Logging in on a slow network shows a blank screen for ten seconds.', null, null, 'bg-key-0101');
select bug_submit('BG Email path report empty', 'The weekly report opens with no rows for every team.', null, null, 'bg-key-0102');
select test.login('dv_shreya');
select test.check(test.sees('BG Email path login fails') and test.sees('BG Email path report empty'), 'Shreya sees both new bugs');
select test.login('dv_ashish');
select test.check(test.sees('BG Email path login fails') and test.sees('BG Email path report empty'), 'Ashish sees both new bugs');
select test.login('dv_sid_mail');
select test.check(test.sees('BG Email path login fails') and test.sees('BG Email path report empty'), 'Siddhesh sees both new bugs');
select test.check(test.sees('BG Email path login fails', 'UNASSIGNED') and (select count(*) = 2 from dev_bugs where title like 'BG Email path%'), '... under Unassigned, one record each (no duplicates)');
reset role;
select test.check((select count(*) = 6 from notifications where type = 'DEV_BUG_REPORTED' and recipient_id in (test.id('dv_shreya'), test.id('dv_ashish'), test.id('dv_sid_mail'))
                     and entity_id in (test.bug('BG Email path login fails'), test.bug('BG Email path report empty'))), 'each of the three is notified of each bug');

\echo '   Shreya assigns one to Siddhesh and one to Ashish'
set role authenticated;
select test.login('dv_shreya');
select bug_dev_assign(test.bug('BG Email path login fails'), test.id('dv_sid_mail'));
select bug_dev_assign(test.bug('BG Email path report empty'), test.id('dv_ashish'));
select test.check(test.sees('BG Email path login fails') and test.sees('BG Email path report empty'), 'Shreya still sees (monitors) both');
select test.login('dv_ashish');
select test.check(not test.sees('BG Email path login fails') and test.sees('BG Email path report empty', 'ME'), 'Ashish: not the one assigned to Siddhesh, has his own');
select test.login('dv_sid_mail');
select test.check(test.sees('BG Email path login fails', 'ME') and not test.sees('BG Email path report empty'), 'Siddhesh: has his own, not the one assigned to Ashish');
select test.check((bug_dev_detail(test.bug('BG Email path login fails')) ->> 'assigneeName') = 'S. Shinde', 'he opens his bug');
select test.must_fail($$select bug_dev_detail(test.bug('BG Email path report empty'))$$, 'and not Ashish''s', 'not found');
select test.check((bug_dev_set_status(test.bug('BG Email path login fails'), 'IN_PROGRESS', null) ->> 'status') = 'IN_PROGRESS', 'he sets it In Progress');
select test.check(jsonb_array_length(bug_dev_comment(test.bug('BG Email path login fails'), 'Reproduced on a throttled connection') -> 'history') >= 2, 'he comments');
select test.check((bug_dev_set_status(test.bug('BG Email path login fails'), 'RESOLVED', 'Added a loading state and a timeout message.') ->> 'status') = 'RESOLVED', 'and resolves it');
select test.must_fail($$select bug_dev_set_status(test.bug('BG Email path report empty'), 'RESOLVED', 'Not mine to resolve')$$, 'he cannot touch Ashish''s bug', 'not found');
select test.login('dv_ashish');
select test.check((bug_dev_set_status(test.bug('BG Email path report empty'), 'RESOLVED', 'The team filter was missing; fixed.') ->> 'status') = 'RESOLVED', 'Ashish resolves his');
select test.login('dv_shreya');
select test.check((select count(*) = 2 from jsonb_array_elements(bug_dev_list(p_status => 'RESOLVED') -> 'items') x where x ->> 'title' like 'BG Email path%'),
  'Shreya sees both resolutions');

\echo '   removing him from the team in Settings is not silently undone'
select test.login('sa');
select dev_team_set(test.id('dv_sid_mail'), false);
reset role;
select test.check(not exists (select 1 from dev_team_emails where email = 'siddhesh.amuwa@gmail.com') and not private.is_developer(test.id('dv_sid_mail')),
  'removed: his email leaves the list and a profile update does not bring him back');
update profiles set full_name = 'Siddhesh S. Shinde' where id = test.id('dv_sid_mail');
select test.check(not private.is_developer(test.id('dv_sid_mail')), '... even after his profile changes');
insert into dev_team_emails (email) values ('siddhesh.amuwa@gmail.com') on conflict do nothing;
select private.dev_team_sync_emails();
select test.check(private.is_developer(test.id('dv_sid_mail')), 'listing the email again restores him');
delete from dev_bugs where title like 'BG Email path%';
reset role;
delete from dev_bugs where title like 'BG %';
delete from employee_issue_attachments where file_name = 'screen.png';
select set_config('request.jwt.claims', '', false);
