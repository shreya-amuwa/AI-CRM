-- =============================================================================
-- Bugs: shared tracking by the three developers (migration 20270312000100, docs/BUG_SHARED_TRACKING.md).
--  - a bug is created with no assignee and none is needed: all three developers (the Team Lead and two developers) see it and work on it;
--  - "Add Progress Update": any developer, any bug: what was worked on, status, progress, notes; each update is a new history entry with the
--    person (from the login) and the time, none overwrites another; contributors come from the history;
--  - a status / progress change made on an out-of-date screen is refused (CONFLICT), a repeated send is stored once;
--  - nobody outside the team reads or changes a bug (the reporter follows status, resolution and progress, never the internal work log);
--  - the optional primary contact never hides a bug or blocks anyone.
-- The migration is applied again here (older tests re-apply their own migrations, which also puts older function definitions back), so
-- this file always tests the new definitions, and applying it twice is proved safe.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 170. Shared bug tracking (no mandatory assignee)'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270312000100_bug_shared_tracking.sql
\i supabase/migrations/20270312000100_bug_shared_tracking.sql
select test.create_auth_user(u, e, jsonb_build_object('full_name', n),
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')))
  from (values
    ('bt_lead', 'bt.lead@example.com', 'BT Lead Dev'),
    ('bt_d1', 'bt.dev1@example.com', 'BT Dev One'),
    ('bt_d2', 'bt.dev2@example.com', 'BT Dev Two'),
    ('bt_rep', 'bt.reporter@example.com', 'BT Reporter'),
    ('bt_out', 'bt.outsider@example.com', 'BT Outsider')
  ) v(u, e, n);
-- the team (the Super Admin's list; the production seeding finds them by name)
insert into public.dev_team_members (profile_id, is_lead) values (test.id('bt_lead'), true), (test.id('bt_d1'), false), (test.id('bt_d2'), false)
  on conflict (profile_id) do update set is_lead = excluded.is_lead;
create or replace function test.btbug(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.dev_bugs where title = p_title $$;
create or replace function test.btver(p_title text) returns integer language sql stable security definer set search_path = '' as $$
  select version from public.dev_bugs where title = p_title $$;
create or replace function test.btprogress(p_title text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.dev_bug_events where bug_id = test.btbug(p_title) and kind = 'PROGRESS' $$;
create or replace function test.btsees(p_title text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(bug_dev_list(p_limit => 100) -> 'items') x where x ->> 'title' = p_title) $$;
grant execute on all functions in schema test to anon, authenticated;
delete from dev_bugs where title like 'BT %';

\echo '   a bug is created without an assignee'
set role authenticated;
select test.login('bt_rep');
select test.check((bug_report(jsonb_build_object('title', 'BT Export button does nothing', 'description', 'Clicking Export on the Accounts report does nothing at all.',
                    'clientRequestId', 'bt-key-0001', 'category', 'BUG', 'priority', 'HIGH')) ->> 'status') = 'PENDING', 'the reporter creates a bug: Pending, nobody had to be assigned');
select test.check((select assigned_to is null and assignment_status = 'UNASSIGNED' and progress = 0 and version = 1 from dev_bugs where title = 'BT Export button does nothing'),
  'it has no assignee, 0% progress and version 1');
select test.check((bug_report(jsonb_build_object('title', 'BT Export button does nothing', 'description', 'Clicking Export on the Accounts report does nothing at all.',
                    'clientRequestId', 'bt-key-0001', 'category', 'BUG', 'priority', 'HIGH')) ->> 'duplicate')::boolean and (select count(*) = 1 from dev_bugs where title = 'BT Export button does nothing'),
  'the same form twice is one bug');
select test.check((bug_report(jsonb_build_object('title', 'BT Login page flickers', 'description', 'The login page flickers for a second when it opens.',
                    'clientRequestId', 'bt-key-0002', 'category', 'BUG', 'priority', 'LOW')) ->> 'status') = 'PENDING', 'a second bug');
reset role;
select test.check((select count(*) = 3 from notifications where type = 'DEV_BUG_REPORTED' and entity_id = test.btbug('BT Export button does nothing')
                    and recipient_id in (test.id('bt_lead'), test.id('bt_d1'), test.id('bt_d2'))), 'all three developers are told about the new bug');

\echo '   all three developers see and open the same bug'
set role authenticated;
select test.login('bt_lead');
select test.check(test.btsees('BT Export button does nothing') and test.btsees('BT Login page flickers'), 'the Team Lead sees both bugs');
select test.login('bt_d1');
select test.check(test.btsees('BT Export button does nothing') and test.btsees('BT Login page flickers'), 'developer one sees both bugs (nothing is assigned)');
select test.check((bug_dev_detail(test.btbug('BT Export button does nothing')) ->> 'title') = 'BT Export button does nothing', 'and opens it');
select test.login('bt_d2');
select test.check(test.btsees('BT Export button does nothing') and test.btsees('BT Login page flickers'), 'developer two sees both bugs');
select test.check((bug_dev_detail(test.btbug('BT Export button does nothing')) ->> 'title') = 'BT Export button does nothing', 'and opens it');
select test.check((select (a ->> 'isDeveloper')::boolean and (a -> 'team') @> jsonb_build_array(jsonb_build_object('name', 'BT Lead Dev', 'isLead', true), jsonb_build_object('name', 'BT Dev One', 'isLead', false), jsonb_build_object('name', 'BT Dev Two', 'isLead', false))
                     from (select bug_access() as a) x), 'each of them knows the whole team (the lead and both developers)');

\echo '   several developers add progress updates; none overwrites another'
select test.login('bt_lead');
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Reproduced it on the Accounts report; the click handler is not attached', 'IN_PROGRESS', 20,
                    'Looks like a missing event binding', test.btver('BT Export button does nothing'), 'bt-up-0001') ->> 'status') = 'IN_PROGRESS', 'the Team Lead: In Progress, 20%');
select test.login('bt_d1');
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Re-attached the handler and added a loading state', 'IN_PROGRESS', 60,
                    null, test.btver('BT Export button does nothing'), 'bt-up-0002') ->> 'progress')::int = 60, 'developer one: 60% (no assignment was needed)');
select test.login('bt_d2');
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Tested the export with 5,000 rows in staging', 'TESTING', 80,
                    'One slow case left', test.btver('BT Export button does nothing'), 'bt-up-0003') ->> 'status') = 'TESTING', 'developer two: Testing, 80%');
select test.check(test.btprogress('BT Export button does nothing') = 3, 'three progress updates are in the history, one per person');
select test.check((select count(distinct (h ->> 'by')) = 3 and count(*) filter (where h ->> 'kind' = 'PROGRESS') = 3
                     from jsonb_array_elements(bug_dev_detail(test.btbug('BT Export button does nothing')) -> 'history') h where h ->> 'kind' = 'PROGRESS'),
  'each update names the person who made it (three different people)');
select test.check((select string_agg(h ->> 'note', ' | ' order by (h ->> 'id')::bigint) = 'Reproduced it on the Accounts report; the click handler is not attached | Re-attached the handler and added a loading state | Tested the export with 5,000 rows in staging'
                     from jsonb_array_elements(bug_dev_detail(test.btbug('BT Export button does nothing')) -> 'history') h where h ->> 'kind' = 'PROGRESS'),
  'every update keeps its own text: nobody''s earlier update was replaced');
select test.check((select (h -> 'data' ->> 'notes') = 'Looks like a missing event binding' and (h -> 'data' ->> 'statusFrom') = 'PENDING' and (h -> 'data' ->> 'statusTo') = 'IN_PROGRESS'
                          and (h -> 'data' ->> 'progressFrom')::int = 0 and (h -> 'data' ->> 'progressTo')::int = 20
                     from jsonb_array_elements(bug_dev_detail(test.btbug('BT Export button does nothing')) -> 'history') h where h ->> 'kind' = 'PROGRESS' order by (h ->> 'id')::bigint limit 1),
  'an update records the notes and the status / progress before and after');
select test.check((select jsonb_array_length(v -> 'contributors') = 3 and (v -> 'contributors') @> jsonb_build_array(jsonb_build_object('name', 'BT Dev Two', 'updates', 1))
                     from (select bug_dev_detail(test.btbug('BT Export button does nothing')) as v) x),
  'the bug lists its three contributors with their number of updates');
select test.check((select v -> 'latestUpdate' ->> 'by' = 'BT Dev Two' and (v -> 'latestUpdate' ->> 'progressTo')::int = 80 from (select bug_dev_detail(test.btbug('BT Export button does nothing')) as v) x), 'the latest update is the last one, with its author');
select test.check((select x -> 'contributors' @> '["BT Lead Dev"]'::jsonb and jsonb_array_length(x -> 'contributors') = 3 and (x ->> 'progress')::int = 80
                     from jsonb_array_elements(bug_dev_list(p_limit => 100) -> 'items') x where x ->> 'title' = 'BT Export button does nothing'),
  'the list shows the contributors and the overall progress');
select test.check((select v ->> 'status' = 'TESTING' and (v ->> 'progress')::int = 80 and (v ->> 'version')::int = 4 from (select bug_dev_detail(test.btbug('BT Export button does nothing')) as v) x),
  'status Testing, progress 80%, version 4 (every update counted)');
select test.check(exists (select 1 from jsonb_array_elements(bug_dev_list(p_assignee => 'CONTRIBUTED', p_limit => 100) -> 'items') x where x ->> 'title' = 'BT Export button does nothing'),
  'developer two finds it under "I worked on"');
select test.check(not exists (select 1 from jsonb_array_elements(bug_dev_list(p_assignee => 'CONTRIBUTED', p_limit => 100) -> 'items') x where x ->> 'title' = 'BT Login page flickers'), 'but not the bug he never touched');
select test.check((select (x ->> 'updates')::int = 1 from jsonb_array_elements(bug_dev_list() -> 'byDeveloper') x where x ->> 'name' = 'BT Dev Two'), 'the team panel counts each developer''s updates');
reset role;
select test.check((select count(*) = 2 from notifications where type = 'DEV_BUG_PROGRESS' and entity_id = test.btbug('BT Export button does nothing') and recipient_id in (test.id('bt_lead'), test.id('bt_d1'))
                    and title like '%update by BT Dev Two%'), 'the other two developers are told about developer two''s update');
select test.check((select count(*) >= 3 from audit_logs where action = 'DEV_BUG_PROGRESS_UPDATED' and created_at > now() - interval '5 minutes'), 'every update is audited');

\echo '   conflicting and repeated updates'
set role authenticated;
select test.login('bt_d1');
-- developer one's screen shows version 4 ...
select test.check((select version = 4 from dev_bugs where title = 'BT Export button does nothing'), 'fixture: developer one loaded version 4');
select test.login('bt_d2');
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Fixed the slow case with an index', 'TESTING', 90, null, 4, 'bt-up-0004') ->> 'progress')::int = 90, 'developer two saves first (version 4 -> 5)');
select test.login('bt_d1');
-- ... and he saves a status / progress change from it: refused, not overwritten
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Marking it done from an old screen', 'IN_PROGRESS', 30, null, 4, 'bt-up-0005')$$,
  'a status / progress change from an out-of-date screen is refused', 'Another developer updated this bug');
select test.check((select status = 'TESTING' and progress = 90 and version = 5 from dev_bugs where title = 'BT Export button does nothing') and test.btprogress('BT Export button does nothing') = 4,
  'nothing was overwritten and nothing was added');
-- the same note without changing status or progress is still fine from an old screen (it only adds a line)
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Reviewed the index change, looks good', 'TESTING', 90, null, 4, 'bt-up-0006') ->> 'status') = 'TESTING',
  'a note that changes neither status nor progress is accepted even from an old screen');
select test.check(test.btprogress('BT Export button does nothing') = 5, 'and it is added to the history');
-- a double click / retry: stored once
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Reviewed the index change, looks good', 'TESTING', 90, null, 4, 'bt-up-0006') ->> 'duplicate')::boolean
                  and test.btprogress('BT Export button does nothing') = 5, 'the same request id again is stored once (a double click)');
select test.check((bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Reviewed the index change, looks good', 'TESTING', 90, null, null, 'bt-up-0007') ->> 'duplicate')::boolean = false,
  'a different request id is a new update');
select test.check(test.btprogress('BT Export button does nothing') = 6, 'and it is added (six updates)');

\echo '   validation'
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'x', null, null, null, null, null)$$, 'what was worked on is required', 'what you worked on');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Some work was done', null, 101, null, null, null)$$, 'progress over 100 is refused', 'percentage from 0 to 100');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Some work was done', null, -1, null, null, null)$$, 'a negative progress is refused', 'percentage from 0 to 100');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Some work was done', 'DONE', null, null, null, null)$$, 'an unknown status is refused', 'Choose Pending');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Some work was done', 'RESOLVED', 50, 'Fixed the bug', null, null)$$, 'a resolved bug is not 50% done', '100% done');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Fix', 'RESOLVED', null, null, null, null)$$, 'resolving needs a resolution note', 'resolution note');
select test.must_fail($$select bug_dev_add_update(gen_random_uuid(), 'Some work was done', null, null, null, null, null)$$, 'an unknown bug', 'not found');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Some work was done', null, null, null, null, 'short')$$, 'a request id that is too short', 'Invalid request id');

\echo '   resolving: progress 100, the reporter reads the resolution'
select test.login('bt_lead');
select test.check((select v ->> 'status' = 'RESOLVED' and (v ->> 'progress')::int = 100 and v ->> 'resolutionNote' = 'Added the missing index; exports of 5,000 rows now finish in two seconds.' and v ->> 'resolvedAt' is not null
                     from (select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Merged the fix', 'RESOLVED', null, 'Added the missing index; exports of 5,000 rows now finish in two seconds.', null, 'bt-up-0008') as v) x),
  'resolved: 100%, the resolution note and the time are set');
select test.check((bug_dev_set_status(test.btbug('BT Login page flickers'), 'IN_PROGRESS', null) ->> 'status') = 'IN_PROGRESS', 'the quick status change works for any developer on any bug (no assignment)');
select test.check(test.btprogress('BT Login page flickers') = 1 and (select (h -> 'data' ->> 'statusTo') = 'IN_PROGRESS' from jsonb_array_elements(bug_dev_detail(test.btbug('BT Login page flickers')) -> 'history') h where h ->> 'kind' = 'PROGRESS'),
  'and is recorded as an update with its author');
reset role;
select test.check(exists (select 1 from notifications where type = 'DEV_BUG_STATUS' and recipient_id = test.id('bt_rep') and entity_id = test.btbug('BT Export button does nothing') and title like '%resolved%'), 'the reporter is told it is resolved');

\echo '   the reporter and everyone outside the team'
set role authenticated;
select test.login('bt_rep');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'I am not a developer', null, null, null, null, null)$$, 'the reporter cannot add a progress update', 'Developers team only');
select test.must_fail($$select bug_dev_set_status(test.btbug('BT Export button does nothing'), 'CLOSED', null)$$, 'nor change the status', 'Developers team only');
select test.must_fail($$select bug_dev_list()$$, 'nor open the developers'' list', 'Developers team only');
select test.check((select (v ->> 'progress')::int = 100 and v ->> 'status' = 'RESOLVED' and jsonb_array_length(v -> 'contributors') = 0 and v -> 'latestUpdate' = 'null'::jsonb
                     from (select bug_my_detail(test.btbug('BT Export button does nothing')) as v) x), 'the reporter sees the status and the progress, not who worked on it');
select test.check(not exists (select 1 from jsonb_array_elements(bug_my_detail(test.btbug('BT Export button does nothing')) -> 'history') h where h ->> 'kind' = 'PROGRESS' or (h ->> 'internal')::boolean),
  'and none of the internal work log');
select test.check(exists (select 1 from jsonb_array_elements(bug_my_detail(test.btbug('BT Export button does nothing')) -> 'history') h where h ->> 'kind' = 'STATUS'), 'only the status changes');
select test.check((select count(*) = 2 from dev_bugs where title like 'BT %'), 'direct reads (row level security): the reporter sees their own bugs');
select test.login('bt_out');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'I am not a developer', null, null, null, null, null)$$, 'another employee cannot add an update', 'Developers team only');
select test.check(not exists (select 1 from dev_bugs where title like 'BT %'), 'and reads no bug (row level security)');
select test.check(not exists (select 1 from dev_bug_events e join dev_bugs b on b.id = e.bug_id where b.title like 'BT %'), 'nor its history');
select test.must_fail($$update dev_bugs set progress = 100 where title like 'BT %'$$, 'nobody changes a bug past the functions', 'permission denied');
select test.login('bt_d1');
select test.must_fail($$update dev_bugs set progress = 0, status = 'PENDING' where title like 'BT %'$$, 'not even a developer', 'permission denied');
select test.must_fail($$update dev_bug_events set note = 'changed' where bug_id = test.btbug('BT Export button does nothing')$$, 'a developer cannot change history entries', 'permission denied');
select test.must_fail($$delete from dev_bug_events where bug_id = test.btbug('BT Export button does nothing')$$, 'nor delete them', 'permission denied');
select test.check((select count(*) >= 2 from dev_bugs where title like 'BT %'), 'a developer reads every bug directly too (row level security)');
select test.login('sa');
select test.must_fail($$select bug_dev_add_update(test.btbug('BT Export button does nothing'), 'Some work was done', null, null, null, null, null)$$, 'the Super Admin has no Bugs section', 'Developers team only');

\echo '   the reporter follows up: the whole team is told'
select test.login('bt_rep');
select test.check((bug_my_follow_up(test.btbug('BT Export button does nothing'), 'It still does nothing for the Leads report', null) ->> 'status') = 'IN_PROGRESS', 'a follow-up on a resolved bug reopens it (somebody already worked on it)');
reset role;
select test.check((select count(*) = 3 from notifications where type = 'DEV_BUG_FOLLOW_UP' and entity_id = test.btbug('BT Export button does nothing')
                    and recipient_id in (test.id('bt_lead'), test.id('bt_d1'), test.id('bt_d2'))), 'all three developers get the follow-up, not only an assignee');
select test.check((select version = 9 from dev_bugs where title = 'BT Export button does nothing'), 'the reopening counted as an update (version 9)');

\echo '   the optional primary contact'
set role authenticated;
select test.login('bt_d1');
select test.must_fail($$select bug_dev_assign(test.btbug('BT Login page flickers'), test.id('bt_d2'))$$, 'a developer cannot name a primary contact', 'Only the Team Lead');
select test.login('bt_lead');
select test.check((bug_dev_assign(test.btbug('BT Login page flickers'), test.id('bt_d1')) ->> 'assignmentStatus') = 'ASSIGNED', 'the Team Lead names developer one the primary contact');
select test.login('bt_d2');
select test.check(test.btsees('BT Login page flickers') and (bug_dev_detail(test.btbug('BT Login page flickers')) ->> 'assigneeName') = 'BT Dev One', 'developer two still sees it (the contact never hides a bug)');
select test.check((bug_dev_add_update(test.btbug('BT Login page flickers'), 'Found the flicker: the theme loads after the first paint', 'IN_PROGRESS', 40, null, null, 'bt-up-0009') ->> 'progress')::int = 40,
  'and works on it although it is not his');
select test.check((select exists (select 1 from jsonb_array_elements(v -> 'contributors') c where c ->> 'name' = 'BT Dev Two') and not exists (select 1 from jsonb_array_elements(v -> 'contributors') c where c ->> 'name' = 'BT Dev One')
                     from (select bug_dev_detail(test.btbug('BT Login page flickers')) as v) x), 'the contributors are the people who did the work (developer two), not the primary contact (developer one)');
select test.login('bt_lead');
select test.check((bug_dev_assign(test.btbug('BT Login page flickers'), null) ->> 'assignmentStatus') = 'UNASSIGNED', 'the contact is cleared again');
reset role;
select test.check((select count(*) = 2 from dev_bug_assignments where bug_id = test.btbug('BT Login page flickers')) and exists (select 1 from audit_logs where action = 'DEV_BUG_ASSIGNED' and created_at > now() - interval '5 minutes'),
  'the naming and clearing are kept in the assignment history and the audit log');

\echo '   the historical data is kept'
select test.must_fail($$update dev_bug_events set note = 'changed' where bug_id = test.btbug('BT Export button does nothing')$$, 'even the database owner cannot rewrite a history entry (append-only)', 'cannot be changed');
select test.must_fail($$delete from dev_bug_events where bug_id = test.btbug('BT Export button does nothing') and kind = 'PROGRESS'$$, 'nor delete one', 'cannot be changed');
select test.check((select count(*) = 2 from dev_bugs where title like 'BT %') and (select count(*) >= 12 from dev_bug_events e join dev_bugs b on b.id = e.bug_id where b.title like 'BT %'),
  'no bug or history entry disappeared, none was duplicated');
select test.check(exists (select 1 from pg_constraint where conname = 'dev_bugs_progress_check') and exists (select 1 from pg_constraint where conname = 'dev_bugs_status_check' and pg_get_constraintdef(oid) like '%TESTING%'),
  'the new status and the progress range are enforced by the table');
select test.must_fail($$insert into public.dev_bugs (reference, reporter_id, reporter_name, title, description, client_request_id, progress) values ('BT-X', test.id('bt_rep'), 'x', 'BT bad progress', 'a description long enough', 'bt-key-9999', 101)$$,
  'progress above 100 is refused by the table too', 'dev_bugs_progress_check');
