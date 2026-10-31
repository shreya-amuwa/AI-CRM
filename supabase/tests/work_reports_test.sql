-- =============================================================================
-- Hierarchical work reports (migration 20261213000100): Team Member -> Team Lead -> Department Head -> Operations Head.
-- Runs late in the shared test database with its own synthetic departments and people.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 90. Work reports'
reset role;
\i supabase/migrations/20261213000100_work_reports.sql

delete from public.work_report_packages;
delete from public.work_reports;
delete from auth.users where email like 'wr.%@example.com';
delete from test.users where name like 'wr\_%';
delete from teams where department_id in (select id from departments where slug like 'wr-%');
delete from departments where slug like 'wr-%';
insert into departments (slug, name) values ('wr-home1', 'WR Home One'), ('wr-home2', 'WR Home Two'), ('wr-a', 'WR Alpha'), ('wr-b', 'WR Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'wr-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'wr-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.wrmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'wr.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'WR ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   people: two Operations Heads, a Department Head each, Team Leads and Team Members'
select test.service();
select test.wrmk('wr_oh', 'DEPARTMENT_HEAD', 'wr-home1');
select test.service();
select test.wrmk('wr_oh2', 'DEPARTMENT_HEAD', 'wr-home2');
select test.service();
select test.wrmk('wr_dha', 'DEPARTMENT_HEAD', 'wr-a');
select test.service();
select test.wrmk('wr_dhb', 'DEPARTMENT_HEAD', 'wr-b');
select test.service();
select test.wrmk('wr_tl1', 'TEAM_HEAD', 'wr-a', 'Sales');
select test.service();
select test.wrmk('wr_tl2', 'TEAM_HEAD', 'wr-a', 'Support');
select test.service();
select test.wrmk('wr_tlb', 'TEAM_HEAD', 'wr-b', 'Sales');
select test.service();
select test.wrmk('wr_m1', 'TEAM_MEMBER', 'wr-a', 'Sales');
select test.service();
select test.wrmk('wr_m2', 'TEAM_MEMBER', 'wr-a', 'Sales');
select test.service();
select test.wrmk('wr_m3', 'TEAM_MEMBER', 'wr-a', 'Support');
select test.service();
select test.wrmk('wr_mb', 'TEAM_MEMBER', 'wr-b', 'Sales');
select test.check((select count(*) = 11 from profiles where id in (select id from test.users where name like 'wr\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');

set role authenticated;
select test.login('sa');
select set_operations_head(test.id('wr_oh'), true, 'test');
select set_operations_head(test.id('wr_oh2'), true, 'test');
select operations_head_scope_set(test.id('wr_oh'), array[test.dept('wr-a')], array[test.dept('wr-a')]);
select operations_head_scope_set(test.id('wr_oh2'), array[test.dept('wr-b')], array[test.dept('wr-b')]);
reset role;
select test.check(private.owner_of_department(test.dept('wr-a')) = test.id('wr_oh'), 'Operations Head one manages Alpha');

-- helper: the report content a Team Member / Team Lead / Department Head writes
create or replace function test.wrbody(p_text text) returns jsonb language sql as $$ select jsonb_build_object('workCompleted', p_text, 'challenges', 'none') $$;
grant execute on function test.wrbody(text) to anon, authenticated;
-- the tables have no grants for the app roles, so the checks read them through these owner-run helpers
create or replace function test.wr(p_id uuid) returns public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports where id = p_id $$;
create or replace function test.wr_all() returns setof public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports $$;
create or replace function test.wr_notes(p_note text) returns bigint language sql stable security definer set search_path = '' as $$ select count(*) from public.work_report_packages where note = p_note $$;
grant execute on function test.wr(uuid), test.wr_all(), test.wr_notes(text) to anon, authenticated;
create temp table wr_ids (name text primary key, id uuid);
grant all on wr_ids to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
\echo '   Team Member: draft, submit, own reports only'
set role authenticated;
select test.login('wr_m1');
select test.check((work_reports_context() ->> 'level') = 'MEMBER' and (work_reports_context() ->> 'canWrite')::boolean
  and (work_reports_context() -> 'reportsTo') @> jsonb_build_array(jsonb_build_object('id', test.id('wr_tl1'), 'name', 'WR tl1')), 'a Team Member sees their Team Lead as the reviewer');
insert into wr_ids select 'm1a', (work_report_save(null, 'Daily report 1', current_date, 'DAILY', current_date, current_date, test.wrbody('Called 12 leads')) ->> 'id')::uuid;
select test.check((select status = 'DRAFT' and revision = 1 from test.wr((select id from wr_ids where name = 'm1a'))), 'saved as a draft first');
select test.check(not exists (select 1 from notifications where type = 'REPORT_SUBMITTED' and entity_id = (select id from wr_ids where name = 'm1a')), 'a draft notifies nobody');
select test.must_fail($$select work_report_save(null, 'x', current_date, 'DAILY', current_date, current_date, '{}')$$, 'a title is required', 'title');
select test.must_fail($$select work_report_save(null, 'Bad period', current_date, 'DAILY', current_date, current_date - 1, '{}')$$, 'the period must end after it starts', 'period');
select test.must_fail($$select work_report_save(null, 'Bad link', current_date, 'DAILY', current_date, current_date, '{"workCompleted":"abc","attachments":[{"url":"javascript:alert(1)"}]}')$$, 'an attachment link must be http(s)', 'attachment link');
insert into wr_ids select 'm1empty', (work_report_save(null, 'Empty report', current_date, 'DAILY', current_date, current_date, '{}') ->> 'id')::uuid;
select test.must_fail($$select work_report_submit((select id from wr_ids where name = 'm1empty'))$$, 'work completed is required to submit', 'work completed');
select work_report_delete_draft((select id from wr_ids where name = 'm1empty'));
select work_report_save((select id from wr_ids where name = 'm1a'), 'Daily report 1', current_date, 'DAILY', current_date, current_date,
  '{"workCompleted":"Called 12 leads","tasksCompleted":"3","unknownField":"dropped","attachments":[{"name":"Sheet","url":"https://example.com/sheet"}]}');
select test.check((select content ? 'workCompleted' and not content ? 'unknownField' and jsonb_array_length(content -> 'attachments') = 1 from test.wr((select id from wr_ids where name = 'm1a'))), 'unknown fields are dropped, the link is kept');
select work_report_submit((select id from wr_ids where name = 'm1a'));
select test.check((select status = 'SUBMITTED' and submitted_at is not null from test.wr((select id from wr_ids where name = 'm1a'))), 'submitted');
select test.must_fail($$select work_report_submit((select id from wr_ids where name = 'm1a'))$$, 'a report cannot be submitted twice', 'already submitted');
select test.must_fail($$select work_report_save((select id from wr_ids where name = 'm1a'), 'Edit', current_date, 'DAILY', current_date, current_date, '{"workCompleted":"x1x"}')$$, 'a submitted report cannot be edited', 'cannot be edited');
select test.must_fail($$select work_report_delete_draft((select id from wr_ids where name = 'm1a'))$$, 'a submitted report cannot be deleted', 'Draft not found');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_SUBMITTED' and recipient_id = test.id('wr_tl1') and entity_id = (select id from wr_ids where name = 'm1a')), 'the Team Lead is told once');
select test.check(not exists (select 1 from notifications where type = 'REPORT_SUBMITTED' and recipient_id in (test.id('wr_tl2'), test.id('wr_dha'), test.id('wr_oh'))), 'nobody else is');

set role authenticated;
select test.login('wr_m2');
insert into wr_ids select 'm2a', (work_report_save(null, 'Daily report M2', current_date, 'DAILY', current_date, current_date, test.wrbody('Closed 2 deals')) ->> 'id')::uuid;
select work_report_submit((select id from wr_ids where name = 'm2a'));
select test.check(jsonb_array_length(work_reports_mine()) = 1, 'My Reports holds only my own');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'm1a'))$$, 'a Team Member cannot open a colleague''s report', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm1a'), 'APPROVED', null)$$, 'nor approve one', 'NOT_FOUND');
select test.must_fail($$select work_reports_inbox()$$, 'nor open the review inbox', 'FORBIDDEN');
select test.must_fail($$select work_reports_team_box(current_date, current_date)$$, 'nor the Team Lead''s team box', 'FORBIDDEN');
select test.must_fail($$select work_reports_operations(current_date, current_date)$$, 'nor the company reports', 'FORBIDDEN');
select test.must_fail($$select count(*) from work_reports$$, 'the table has no direct access', 'permission denied');
select test.login('wr_m3');
insert into wr_ids select 'm3a', (work_report_save(null, 'Support M3', current_date, 'DAILY', current_date, current_date, test.wrbody('Solved 8 tickets')) ->> 'id')::uuid;
select work_report_submit((select id from wr_ids where name = 'm3a'));
select test.login('wr_mb');
insert into wr_ids select 'mba', (work_report_save(null, 'Beta report', current_date, 'DAILY', current_date, current_date, test.wrbody('Beta work')) ->> 'id')::uuid;
select work_report_submit((select id from wr_ids where name = 'mba'));
-- a draft nobody submitted can be deleted by its author
insert into wr_ids select 'mbd', (work_report_save(null, 'Beta draft', current_date, 'DAILY', current_date, current_date, '{}') ->> 'id')::uuid;
select work_report_delete_draft((select id from wr_ids where name = 'mbd'));
select test.check(not exists (select 1 from test.wr_all() where title = 'Beta draft'), 'a draft can be deleted by its author');

-- ---------------------------------------------------------------------------
\echo '   Team Lead: only their own team, decisions, revision loop'
select test.login('wr_tl1');
select test.check((work_reports_context() ->> 'pendingReview')::int = 2 and (work_reports_context() ->> 'badge')::int = 2, 'the sidebar badge counts the two reports waiting');
select test.check(jsonb_array_length(work_reports_inbox() -> 'items') = 2 and (work_reports_inbox('PENDING') -> 'items') is not null, 'the inbox holds the team''s two reports');
select test.check(not exists (select 1 from jsonb_array_elements(work_reports_inbox() -> 'items') i where i ->> 'author' in ('WR m3', 'WR mb')), 'and none of another team or department');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'm3a'))$$, 'a Team Lead cannot open another team''s report', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm3a'), 'APPROVED', null)$$, 'nor approve it', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'mba'), 'APPROVED', null)$$, 'nor a report of another department', 'NOT_FOUND');
select test.check((work_report_get((select id from wr_ids where name = 'm1a')) ->> 'status') = 'UNDER_REVIEW', 'opening a submitted report marks it under review');
select test.check((work_report_get((select id from wr_ids where name = 'm1a')) ->> 'canReview')::boolean, 'and offers the decision');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm1a'), 'REVISION_REQUIRED', '')$$, 'a revision request needs a comment', 'comment');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm1a'), 'MAYBE', 'x')$$, 'the decision must be one of the three', 'approve, reject');
select work_report_review((select id from wr_ids where name = 'm1a'), 'REVISION_REQUIRED', 'Add the call outcomes');
select test.check((select status = 'REVISION_REQUIRED' and review_comment = 'Add the call outcomes' and reviewed_by = test.id('wr_tl1') from test.wr((select id from wr_ids where name = 'm1a'))), 'revision requested with the comment');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm1a'), 'APPROVED', null)$$, 'a report nobody resubmitted cannot be approved', 'not waiting');
select work_report_review((select id from wr_ids where name = 'm2a'), 'APPROVED', 'Good work');
-- the Team Lead's own report (goes to the Department Head, not through their own approval)
insert into wr_ids select 'tl1a', (work_report_save(null, 'Lead report', current_date, 'DAILY', current_date, current_date, jsonb_build_object('workCompleted', 'Reviewed pipeline', 'teamCoordination', 'Stand-up')) ->> 'id')::uuid;
select test.check((work_reports_context() -> 'reportsTo') @> jsonb_build_array(jsonb_build_object('id', test.id('wr_dha'), 'name', 'WR dha')), 'a Team Lead''s reviewer is the Department Head');
select work_report_submit((select id from wr_ids where name = 'tl1a'));
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'tl1a'), 'APPROVED', null)$$, 'a Team Lead cannot approve their own report', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm1a'), 'APPROVED', null)$$, 'still no decision on the revision', 'not waiting');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_REVISION_REQUIRED' and recipient_id = test.id('wr_m1')), 'the member is told about the revision once');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_APPROVED' and recipient_id = test.id('wr_m2')), 'and about the approval');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_SUBMITTED' and recipient_id = test.id('wr_dha') and entity_id = (select id from wr_ids where name = 'tl1a')), 'the Department Head is told about the Team Lead''s report');

\echo '   revision loop: edit, resubmit, approve'
set role authenticated;
select test.login('wr_m1');
select test.check((select (work_report_get((select id from wr_ids where name = 'm1a')) ->> 'canEdit')::boolean), 'the author can edit a report sent back');
select work_report_save((select id from wr_ids where name = 'm1a'), 'Daily report 1 (revised)', current_date, 'DAILY', current_date, current_date, '{"workCompleted":"Called 12 leads: 4 interested"}');
select work_report_submit((select id from wr_ids where name = 'm1a'));
select test.check((select revision = 2 and status = 'SUBMITTED' and review_comment is null from test.wr((select id from wr_ids where name = 'm1a'))), 'resubmitted as revision 2 with the old decision cleared');
select test.check(jsonb_array_length(work_report_get((select id from wr_ids where name = 'm1a')) -> 'events') >= 5, 'the history keeps every step');
select test.login('wr_tl1');
select work_report_review((select id from wr_ids where name = 'm1a'), 'APPROVED', null);
reset role;
select test.check((select count(*) = 1 from notifications where type = 'REPORT_RESUBMITTED' and recipient_id = test.id('wr_tl1')), 'the Team Lead was told about the resubmission (not as a duplicate of the first)');
select test.check((select count(*) = 2 from notifications where type = 'REPORT_APPROVED' and entity_id in (select id from wr_ids where name in ('m1a', 'm2a'))), 'approvals notify each author once');

-- a rejected report
set role authenticated;
select test.login('wr_tl2');
select work_report_review((select id from wr_ids where name = 'm3a'), 'REJECTED', 'Duplicate of yesterday');
select test.check((select status = 'REJECTED' from test.wr((select id from wr_ids where name = 'm3a'))), 'a Team Lead can reject with a reason');

\echo '   Team Lead box: collective view'
select test.login('wr_tl1');
select test.check((work_reports_team_box(current_date, current_date) ->> 'totalMembers')::int = 2
  and ((work_reports_team_box(current_date, current_date) -> 'counts' ->> 'approved')::int = 2)
  and ((work_reports_team_box(current_date, current_date) -> 'counts' ->> 'submitted')::int = 2), 'the box counts members and approved reports');
select test.check(jsonb_array_length(work_reports_team_box(current_date, current_date) -> 'myReports') = 1, 'the box lists the Team Lead''s own report apart');
select test.check((select count(*) = 0 from jsonb_array_elements(work_reports_team_box(current_date + 30, current_date + 31) -> 'members') m where jsonb_array_length(m -> 'reports') > 0), 'another period is empty');

-- ---------------------------------------------------------------------------
\echo '   Department Head: Team Lead boxes, only approved member reports, own report, package'
select test.login('wr_dha');
select test.check((work_reports_context() ->> 'pendingReview')::int = 1, 'the badge counts the Team Lead''s report waiting');
select test.check(jsonb_array_length(work_reports_inbox() -> 'items') = 1, 'the inbox holds the Team Lead''s report only (not members'' ones)');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'mba'))$$, 'a Department Head cannot open another department''s report', 'NOT_FOUND');
select test.check((work_report_get((select id from wr_ids where name = 'm1a')) ->> 'status') = 'APPROVED', 'an approved member report is readable by the Department Head');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'm3a'))$$, 'but a rejected one is not', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'm1a'), 'REJECTED', 'not allowed')$$, 'and a Department Head does not decide on member reports', 'NOT_FOUND');
select test.check((select count(*) = 2 and bool_and(jsonb_array_length(b -> 'leadReports') >= 0) from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b), 'one box per Team Lead of the department');
select test.check((select (b -> 'counts' ->> 'approved')::int = 2 and jsonb_array_length(b -> 'memberReports') = 2 and (b -> 'counts' ->> 'pending')::int = 0
                     and jsonb_array_length(b -> 'leadReports') = 1 and (b ->> 'totalMembers')::int = 2
                   from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b where b ->> 'lead' = 'WR tl1'), 'the first Team Lead box: own report plus two approved member reports');
select test.check((select jsonb_array_length(b -> 'memberReports') = 0 and (b -> 'counts' ->> 'rejected')::int = 1
                   from jsonb_array_elements(work_reports_department(current_date, current_date) -> 'teams') b where b ->> 'lead' = 'WR tl2'), 'a rejected report is counted but never shown as approved');
select test.check((work_reports_department(current_date, current_date) -> 'package' ->> 'status') = 'NOT_SUBMITTED', 'the package is not sent yet');
select work_report_review((select id from wr_ids where name = 'tl1a'), 'APPROVED', 'Fine');
-- own report
insert into wr_ids select 'dha', (work_report_save(null, 'Department overview', current_date, 'WEEKLY', current_date - 6, current_date, jsonb_build_object('departmentOverview', 'Healthy', 'workCompleted', 'Hiring done')) ->> 'id')::uuid;
select work_report_submit((select id from wr_ids where name = 'dha'));
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'dha'), 'APPROVED', null)$$, 'a Department Head cannot approve their own report', 'NOT_FOUND');
select test.must_fail($$select work_report_package_submit(current_date, current_date - 1, 'DAILY', null)$$, 'the package period must be valid', 'period');
select work_report_package_submit(current_date - 6, current_date, 'WEEKLY', 'All teams on track');
select test.check((work_reports_department(current_date - 6, current_date) -> 'package' ->> 'status') = 'SUBMITTED', 'the package is submitted');
select work_report_package_submit(current_date - 6, current_date, 'WEEKLY', 'Updated note');
select test.check((test.wr_notes('Updated note') = 1 and test.wr_notes('All teams on track') = 0) , 'sending the package again updates it (no duplicate)') ;
reset role;
select test.check((select count(*) = 1 from work_report_packages where department_id = test.dept('wr-a')), 'one package per department and period');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_PACKAGE_SUBMITTED' and recipient_id = test.id('wr_oh')), 'the Operations Head is told once (not again when the package is updated)');
select test.check((select count(*) = 1 from notifications where type = 'REPORT_SUBMITTED' and recipient_id = test.id('wr_oh') and entity_id = (select id from wr_ids where name = 'dha')), 'and about the Department Head''s own report');

-- ---------------------------------------------------------------------------
\echo '   Operations Head: departments, nested chain, scope'
set role authenticated;
select test.login('wr_oh');
select test.check((work_reports_context() ->> 'level') = 'OPERATIONS_HEAD' and not (work_reports_context() ->> 'canWrite')::boolean, 'the Operations Head reviews and does not write');
select test.check((select count(*) = 1 and bool_and(d ->> 'name' = 'WR Alpha') from jsonb_array_elements(work_reports_operations(current_date - 6, current_date) -> 'departments') d), 'only the department they manage is listed');
select test.check((select (d -> 'counts' ->> 'memberApproved')::int = 2 and (d -> 'counts' ->> 'teamLeadReports')::int = 1 and (d -> 'counts' ->> 'headReports')::int = 1
                     and (d ->> 'teamLeads')::int = 2 and (d ->> 'teamMembers')::int = 3 and d ->> 'headReportStatus' = 'SUBMITTED' and (d -> 'package' ->> 'status') = 'SUBMITTED'
                   from jsonb_array_elements(work_reports_operations(current_date - 6, current_date) -> 'departments') d), 'the department box shows the counts');
select test.check(jsonb_array_length(work_reports_inbox() -> 'items') = 1, 'the Operations Head''s inbox holds the Department Head''s report');
select test.check((work_reports_operations_department(test.dept('wr-a'), current_date - 6, current_date) ->> 'released')::boolean
  and jsonb_array_length(work_reports_operations_department(test.dept('wr-a'), current_date - 6, current_date) -> 'teamLeads') = 2
  and jsonb_array_length(work_reports_operations_department(test.dept('wr-a'), current_date - 6, current_date) -> 'departmentHeads' -> 0 -> 'reports') = 1, 'the department opens to Department Head, Team Leads and members');
select test.check((select jsonb_array_length(b -> 'memberReports') = 2 and jsonb_array_length(b -> 'leadReports') = 1
                   from jsonb_array_elements(work_reports_operations_department(test.dept('wr-a'), current_date - 6, current_date) -> 'teamLeads') b where b ->> 'lead' = 'WR tl1'), 'level 3: the member reports under their Team Lead');
select test.check(not exists (select 1 from jsonb_array_elements(work_reports_operations_department(test.dept('wr-a'), current_date - 6, current_date) -> 'teamLeads') b,
                                       jsonb_array_elements(b -> 'memberReports') r where r ->> 'status' <> 'APPROVED'), 'only approved member reports reach the Operations Head');
select test.check(not (work_reports_operations_department(test.dept('wr-a'), current_date + 10, current_date + 16) ->> 'released')::boolean
  and (select bool_and(jsonb_array_length(b -> 'memberReports') = 0 and jsonb_array_length(b -> 'leadReports') = 0)
       from jsonb_array_elements(work_reports_operations_department(test.dept('wr-a'), current_date + 10, current_date + 16) -> 'teamLeads') b), 'a period whose package was not sent shows no reports');
select test.check((select bool_and(b ->> 'leadReportStatus' is not null) from jsonb_array_elements(work_reports_operations_department(test.dept('wr-a'), current_date - 6, current_date) -> 'teamLeads') b where b ->> 'lead' = 'WR tl1'), 'the lead report status is shown with the box');
select test.check((work_reports_operations_department(test.dept('wr-a'), current_date + 10, current_date + 16) -> 'packages' -> 0 ->> 'periodEnd')::date = current_date, 'a period without a package lists the packages that were sent');
select test.must_fail($$select work_reports_operations_department(test.dept('wr-b'), current_date, current_date)$$, 'a department they do not manage is closed to them', 'NOT_FOUND');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'mba'))$$, 'and so are its reports', 'NOT_FOUND');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'm3a'))$$, 'a rejected member report is not visible to them', 'NOT_FOUND');
select test.must_fail($$select work_report_save(null, 'Op', current_date, 'DAILY', current_date, current_date, '{"workCompleted":"abc"}')$$, 'the Operations Head does not write reports', 'FORBIDDEN');
select work_report_review((select id from wr_ids where name = 'dha'), 'REVISION_REQUIRED', 'Add the targets');
select test.check((select status = 'REVISION_REQUIRED' from test.wr((select id from wr_ids where name = 'dha'))), 'the Operations Head decides on the Department Head''s report');
select test.login('wr_oh2');
select test.check((select count(*) = 1 and bool_and(d ->> 'name' = 'WR Beta') from jsonb_array_elements(work_reports_operations(current_date, current_date) -> 'departments') d), 'another Operations Head sees only their own department');
select test.must_fail($$select work_reports_operations_department(test.dept('wr-a'), current_date, current_date)$$, 'and cannot open Alpha', 'NOT_FOUND');
select test.must_fail($$select work_report_review((select id from wr_ids where name = 'dha'), 'APPROVED', null)$$, 'nor decide on its Department Head', 'NOT_FOUND');
select test.login('wr_dhb');
select test.must_fail($$select work_report_get((select id from wr_ids where name = 'dha'))$$, 'a Department Head cannot read another department''s Department Head report', 'NOT_FOUND');
select test.must_fail($$select work_reports_operations(current_date, current_date)$$, 'nor open the company reports', 'FORBIDDEN');
select test.login('sa');
select test.check(jsonb_array_length(work_reports_operations(current_date - 6, current_date) -> 'departments') >= 3, 'the Super Admin sees every department');
select test.check((work_report_get((select id from wr_ids where name = 'm3a')) ->> 'status') = 'REJECTED', 'and every report');
select test.check((select count(*) = 0 from information_schema.role_table_grants where table_name in ('work_reports', 'work_report_events', 'work_report_packages') and grantee in ('anon', 'authenticated', 'public')), 'no table grants for the app roles');
reset role;
select test.check((select count(*) >= 5 from audit_logs where action like 'WORK_REPORT%'), 'decisions and submissions are audited');
\echo '   work reports: all checks passed'
