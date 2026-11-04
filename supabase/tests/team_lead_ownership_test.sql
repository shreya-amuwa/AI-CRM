-- =============================================================================
-- Strict Team Lead -> Team Member ownership (migration 20261223000100): tasks, daily-report routing, rosters.
-- Own synthetic department (tlo-*) and people (prefix tlo_). TWO Team Leads share ONE team on purpose: that is the situation the screenshots show.
-- Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 120. Team Lead ownership: tasks, reports, rosters'
reset role;
-- earlier suites re-apply older report / task migrations (to prove they re-run): put the newest definitions back on top, twice
\i supabase/migrations/20261223000100_team_lead_ownership.sql
\i supabase/migrations/20261223000100_team_lead_ownership.sql

delete from public.work_report_signals;
delete from public.work_reports where department_id in (select id from departments where slug like 'tlo-%');
delete from public.work_tasks where department_id in (select id from departments where slug like 'tlo-%');
delete from auth.users where email like 'tlo.%@example.com';
delete from test.users where name like 'tlo\_%';
delete from teams where department_id in (select id from departments where slug like 'tlo-%');
delete from departments where slug like 'tlo-%';
insert into departments (slug, name) values ('tlo-a', 'TLO Alpha'), ('tlo-b', 'TLO Beta');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'tlo-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
-- p_by: who provisions the account (a Team Lead adds their own member; anybody else is the Super Admin)
create or replace function test.tlomk(p_name text, p_role text, p_dept text, p_team text default null, p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tlo.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'TLO ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;
create or replace function test.tlotask(p_owner text, p_title text, p_by text default 'sa') returns uuid language sql security definer set search_path = '' as $$
  insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, status, progress)
  select p.department_id, p.team_id, p_title, test.id(p_by), p.id, 'ASSIGNED', 0 from public.profiles p where p.id = test.id(p_owner)
  returning id
$$;
create or replace function test.tlo(p_id uuid) returns public.work_reports language sql stable security definer set search_path = '' as $$ select * from public.work_reports where id = p_id $$;
create or replace function test.tlo_events(p_id uuid) returns setof public.work_report_events language sql stable security definer set search_path = '' as $$ select * from public.work_report_events where report_id = p_id order by id $$;
create or replace function test.tlo_notified(p_user text, p_report uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications where recipient_id = test.id(p_user) and entity_id = p_report and type like 'REPORT\_%' $$;
grant execute on function test.tlotask(text, text, text), test.tlo(uuid), test.tlo_events(uuid), test.tlo_notified(text, uuid) to anon, authenticated;
create temp table tlo_ids (name text primary key, id uuid);
grant all on tlo_ids to anon, authenticated, service_role;

\echo '   people: one Department Head, TWO Team Leads on the same team, members each lead added, a Technical Consultant and a Meta Verifier'
select test.service(); select test.tlomk('tlo_dh', 'DEPARTMENT_HEAD', 'tlo-a');
select test.service(); select test.tlomk('tlo_lA', 'TEAM_HEAD', 'tlo-a', 'Support');
select test.service(); select test.tlomk('tlo_lB', 'TEAM_HEAD', 'tlo-a', 'Support');
select test.service(); select test.tlomk('tlo_mA', 'TEAM_MEMBER', 'tlo-a', 'Support', 'tlo_lA');
select test.service(); select test.tlomk('tlo_mA2', 'TEAM_MEMBER', 'tlo-a', 'Support', 'tlo_lA');
select test.service(); select test.tlomk('tlo_mB', 'TEAM_MEMBER', 'tlo-a', 'Support', 'tlo_lB');
select test.service(); select test.tlomk('tlo_tcA', 'TEAM_MEMBER', 'tlo-a', 'Support', 'tlo_lA');
select test.service(); select test.tlomk('tlo_mvA', 'TEAM_MEMBER', 'tlo-a', 'Support', 'tlo_lA');
select test.service(); select test.tlomk('tlo_mC', 'TEAM_MEMBER', 'tlo-a', 'Support', 'sa');   -- added by the Super Admin: nobody was named
select test.service(); select test.tlomk('tlo_lX', 'TEAM_HEAD', 'tlo-b', 'Support');
select test.service(); select test.tlomk('tlo_mX', 'TEAM_MEMBER', 'tlo-b', 'Support');
update profiles set is_technical_consultant = true where id = test.id('tlo_tcA');
update profiles set is_meta_verifier = true where id = test.id('tlo_mvA');
select test.check((select count(*) = 11 from profiles where id in (select id from test.users where name like 'tlo\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');

\echo '   Scenario: a Team Lead''s new Team Member belongs to that lead only'
select test.check((select manager_id = test.id('tlo_lA') from profiles where id = test.id('tlo_mA')), 'TL A creates TM A: TM A belongs to TL A');
select test.check((select manager_id = test.id('tlo_lB') from profiles where id = test.id('tlo_mB')), 'TL B creates TM B: TM B belongs to TL B');
select test.check((select manager_id is null from profiles where id = test.id('tlo_mC')) and private.direct_lead_of(test.id('tlo_mC')) is null,
  'a member of a two-lead team that nobody named has no lead (not an arbitrary one)');
select test.check((select manager_id = test.id('tlo_lX') from profiles where id = test.id('tlo_mX')), 'a team with a single Team Lead gives that lead its members by itself');
select test.must_fail($$update profiles set manager_id = test.id('tlo_lX') where id = test.id('tlo_mA')$$, 'a lead of another team cannot be set as the direct lead (the guard trigger)', 'same team');
select test.must_fail($$update profiles set manager_id = test.id('tlo_mB') where id = test.id('tlo_mA')$$, 'nor a Team Member', 'same team');

\echo '   Scenario: the task form lists only the lead''s own ordinary members, and the database enforces it'
set role authenticated;
select test.login('tlo_lA');
select test.check((select array_agg(x ->> 'fullName' order by x ->> 'fullName') = array['TLO mA', 'TLO mA2', 'TLO mvA', 'TLO tcA'] from jsonb_array_elements(my_team_members()) x),
  'TL A''s roster: only TL A''s own people (not TL B''s, not the unassigned, not another team''s)');
select test.check((select array_agg(x ->> 'fullName' order by x ->> 'fullName') = array['TLO mA', 'TLO mA2'] from jsonb_array_elements(my_team_members()) x where (x ->> 'ordinary')::boolean),
  'the task picker (ordinary members) leaves out the Technical Consultant and the Meta Verifier');
select test.check((assign_team_task('Call back open tickets', null, 'MEDIUM', null, null, array[test.id('tlo_mA')])) = 1, 'TL A assigns a task to TM A');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s']::uuid[])$$, test.id('tlo_mB')), 'TL A submits a task for TM B: the backend rejects it (a guessed id)', 'not an active member of your team');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s']::uuid[])$$, test.id('tlo_mC')), 'nor for a member nobody named', 'not an active member of your team');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s']::uuid[])$$, test.id('tlo_tcA')), 'nor for a Technical Consultant', 'not an active member of your team');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s']::uuid[])$$, test.id('tlo_mvA')), 'nor for a Meta Verifier', 'not an active member of your team');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s']::uuid[])$$, test.id('tlo_mX')), 'nor for another department''s member', 'not an active member of your team');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s','%s']::uuid[])$$, test.id('tlo_mA'), test.id('tlo_mB')), 'a list that mixes in one foreign member is refused as a whole', 'not an active member of your team');
select test.login('tlo_lB');
select test.check((select array_agg(x ->> 'fullName') = array['TLO mB'] from jsonb_array_elements(my_team_members()) x), 'TL B''s roster: only TM B');
select test.login('tlo_mA');
select test.must_fail($$select my_team_members()$$, 'a Team Member has no roster', 'Only a Team Lead');
reset role;
select test.check(not exists (select 1 from work_tasks where title = 'x task'), 'none of the refused tasks was created');
-- assign_task_to_members (a task given to the lead, delegated to members)
insert into tlo_ids select 'parent', test.tlotask('tlo_lA', 'Quarterly clean-up', 'tlo_dh');
set role authenticated;
select test.login('tlo_lA');
select test.must_fail(format($$select assign_task_to_members('%s', array['%s']::uuid[])$$, (select id from tlo_ids where name = 'parent'), test.id('tlo_mB')), 'delegating to another lead''s member is refused too', 'not an active member of your team');
select test.must_fail(format($$select assign_task_to_members('%s', array['%s']::uuid[])$$, (select id from tlo_ids where name = 'parent'), test.id('tlo_tcA')), 'and to a Technical Consultant', 'not an active member of your team');
select test.check((select assign_task_to_members((select id from tlo_ids where name = 'parent'), array[test.id('tlo_mA2')])) = 1, 'delegating to an own member works');
reset role;

\echo '   Scenario: a Team Member''s daily report goes to THEIR Team Lead and nobody else''s'
insert into tlo_ids select 'task_mA', test.tlotask('tlo_mA', 'Call pethani nx');
insert into tlo_ids select 'task_mB', test.tlotask('tlo_mB', 'Call the campaign list');
set role authenticated;
select test.login('tlo_mA');
insert into tlo_ids select 'rA', (work_report_save(null, 'Daily report mA', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from tlo_ids where name = 'task_mA')))) ->> 'id')::uuid;
select work_report_submit((select id from tlo_ids where name = 'rA'));
reset role;
select test.check((select team_lead_id = test.id('tlo_lA') and team_lead_name = 'TLO lA' and status = 'SUBMITTED' and tl_status = 'PENDING' from test.tlo((select id from tlo_ids where name = 'rA'))),
  'TM A submits: the report names TL A (not "the first Team Lead of the team by name")');
select test.check(test.tlo_notified('tlo_lA', (select id from tlo_ids where name = 'rA')) = 1 and test.tlo_notified('tlo_lB', (select id from tlo_ids where name = 'rA')) = 0,
  'only TL A is notified; TL B is not');
set role authenticated;
select test.login('tlo_lB');
select test.check((select jsonb_array_length(work_reports_inbox() -> 'items') = 0 from (select 1) z), 'TL B''s inbox does not hold TM A''s report');
select test.check((select not exists (select 1 from jsonb_array_elements(work_reports_team_box(current_date - 7, current_date) -> 'members') m where m ->> 'name' = 'TLO mA')), 'nor does TL B''s team box list TM A');
select test.must_fail(format($$select work_report_get('%s')$$, (select id from tlo_ids where name = 'rA')), 'TL B cannot open TM A''s report', 'NOT_FOUND|not found');
select test.must_fail(format($$select work_report_review('%s', 'APPROVED', null)$$, (select id from tlo_ids where name = 'rA')), 'TL B cannot approve TM A''s report through the API', 'NOT_FOUND|not found|FORBIDDEN');
select test.must_fail(format($$select work_report_review('%s', 'REJECTED', 'This is not my team member report to reject')$$, (select id from tlo_ids where name = 'rA')), 'nor reject it', 'NOT_FOUND|not found|FORBIDDEN');
select test.login('tlo_lA');
select test.check((select jsonb_array_length(work_reports_inbox() -> 'items') = 1 and (work_reports_inbox() -> 'items' -> 0 ->> 'teamLead') = 'TLO lA' from (select 1) z), 'TL A''s inbox holds it, with TL A shown as the reviewer');
select test.check((select exists (select 1 from jsonb_array_elements(work_reports_team_box(current_date - 7, current_date) -> 'members') m where m ->> 'name' = 'TLO mA')
                      and not exists (select 1 from jsonb_array_elements(work_reports_team_box(current_date - 7, current_date) -> 'members') m where m ->> 'name' = 'TLO mB')), 'TL A''s team box lists TM A and not TM B');
select work_report_get((select id from tlo_ids where name = 'rA'));
select work_report_review((select id from tlo_ids where name = 'rA'), 'APPROVED', 'Good');
reset role;
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' and tl_status = 'APPROVED' and tl_reviewer_id = test.id('tlo_lA') from test.tlo((select id from tlo_ids where name = 'rA'))), 'TL A approves: it moves to the Department Head');
select test.check((select count(*) = 1 from test.tlo_events((select id from tlo_ids where name = 'rA')) e where e.action = 'OPENED' and e.actor_id = test.id('tlo_lA'))
               and (select count(*) = 1 from test.tlo_events((select id from tlo_ids where name = 'rA')) e where e.action = 'APPROVED' and e.actor_id = test.id('tlo_lA') and e.stage = 'TEAM_LEAD')
               and (select count(*) = 0 from test.tlo_events((select id from tlo_ids where name = 'rA')) e where e.actor_id = test.id('tlo_lB')),
  'the history says TL A opened and decided it: the shown reviewer, the history and the authorisation agree');
select test.check(test.tlo_notified('tlo_dh', (select id from tlo_ids where name = 'rA')) >= 1, 'the Department Head is told it waits for them');
set role authenticated;
select test.login('tlo_dh');
select work_report_review((select id from tlo_ids where name = 'rA'), 'APPROVED', 'ok');
reset role;
select test.check((select status = 'APPROVED' from test.tlo((select id from tlo_ids where name = 'rA'))), 'the Department Head completes the two-level approval');

\echo '   Scenario: a member nobody named cannot submit into the void; the Department Head names the lead'
set role authenticated;
reset role;
insert into tlo_ids select 'task_mC', test.tlotask('tlo_mC', 'Update the sheet');
set role authenticated;
select test.login('tlo_mC');
insert into tlo_ids select 'rC', (work_report_save(null, 'Daily report mC', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from tlo_ids where name = 'task_mC')))) ->> 'id')::uuid;
select test.must_fail(format($$select work_report_submit('%s')$$, (select id from tlo_ids where name = 'rC')), 'submitting without a Team Lead is refused clearly', 'not assigned to a Team Lead');
select test.login('tlo_lA');
select test.must_fail(format($$select assign_direct_lead('%s', '%s')$$, test.id('tlo_mC'), test.id('tlo_lA')), 'a Team Lead cannot name a member''s lead (not even their own)', 'NOT_FOUND');
select test.login('tlo_dh');
select test.check((select exists (select 1 from jsonb_array_elements(hierarchy_report() -> 'unassignedMembers') u where u ->> 'name' = 'TLO mC')), 'the Department Head''s impact report lists the unassigned member');
select test.must_fail(format($$select assign_direct_lead('%s', '%s')$$, test.id('tlo_mC'), test.id('tlo_lX')), 'a lead of another team is refused', 'same team|active Team Lead of this');
select test.check((select assign_direct_lead(test.id('tlo_mC'), test.id('tlo_lB')) ->> 'leadId') = test.id('tlo_lB')::text, 'the Department Head names TL B as the lead of TM C');
select test.login('tlo_mC');
select work_report_submit((select id from tlo_ids where name = 'rC'));
reset role;
select test.check((select team_lead_id = test.id('tlo_lB') from test.tlo((select id from tlo_ids where name = 'rC'))), 'TM C''s report goes to the named lead');
select test.check(test.tlo_notified('tlo_lB', (select id from tlo_ids where name = 'rC')) = 1 and test.tlo_notified('tlo_lA', (select id from tlo_ids where name = 'rC')) = 0, 'and only to them');

\echo '   Scenario: transfer - new work follows the new lead, history and decided reports stay'
insert into tlo_ids select 'task_mA2', test.tlotask('tlo_mA', 'Second task');
set role authenticated;
select test.login('tlo_mA');
insert into tlo_ids select 'rA2', (work_report_save(null, 'Daily report mA yesterday', current_date - 1, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from tlo_ids where name = 'task_mA2')))) ->> 'id')::uuid;
select work_report_submit((select id from tlo_ids where name = 'rA2'));
select test.login('tlo_dh');
select test.check((select (assign_direct_lead(test.id('tlo_mA'), test.id('tlo_lB')) ->> 'pendingReportsMoved')::int = 1), 'TM A is transferred from TL A to TL B: one pending report moves with them');
reset role;
select test.check((select team_lead_id = test.id('tlo_lB') and status = 'SUBMITTED' from test.tlo((select id from tlo_ids where name = 'rA2'))), 'the pending report now waits for TL B');
select test.check((select team_lead_id = test.id('tlo_lA') and status = 'APPROVED' from test.tlo((select id from tlo_ids where name = 'rA'))), 'the earlier, fully approved report keeps TL A and its approval');
select test.check((select count(*) >= 2 from test.tlo_events((select id from tlo_ids where name = 'rA2'))) and exists (select 1 from test.tlo_events((select id from tlo_ids where name = 'rA2')) e where e.action = 'REROUTED')
                   and exists (select 1 from test.tlo_events((select id from tlo_ids where name = 'rA2')) e where e.action = 'SUBMITTED'), 'the history keeps the submission and records the move');
select test.check(test.tlo_notified('tlo_lB', (select id from tlo_ids where name = 'rA2')) = 1, 'TL B is told');
set role authenticated;
select test.login('tlo_lA');
select test.must_fail(format($$select work_report_review('%s', 'APPROVED', null)$$, (select id from tlo_ids where name = 'rA2')), 'TL A can no longer decide it', 'NOT_FOUND|not found|FORBIDDEN');
select test.check((select not exists (select 1 from jsonb_array_elements(my_team_members()) x where x ->> 'fullName' = 'TLO mA')), 'TM A left TL A''s roster');
select test.login('tlo_lB');
select test.check((select exists (select 1 from jsonb_array_elements(my_team_members()) x where x ->> 'fullName' = 'TLO mA')), 'and joined TL B''s');
select test.check((assign_team_task('New work after the transfer', null, 'LOW', null, null, array[test.id('tlo_mA')])) = 1, 'new tasks for TM A now come from TL B');
select test.login('tlo_lA');
select test.must_fail(format($$select assign_team_task('x task', null, 'MEDIUM', null, null, array['%s']::uuid[])$$, test.id('tlo_mA')), 'and no longer from TL A', 'not an active member of your team');
reset role;

\echo '   Scenario: the impact report is read-only; the correction only touches verifiable pending reports'
-- a stale record: the pending report names the wrong lead (the screenshot's situation)
update work_reports set team_lead_id = test.id('tlo_lA'), team_lead_name = 'TLO lA' where id = (select id from tlo_ids where name = 'rA2');
select test.check((private.report_lead_of(test.tlo((select id from tlo_ids where name = 'rA2'))) = test.id('tlo_lA')), 'a stale recorded lead is still the one who may decide (display and authorisation agree)');
set role authenticated;
select test.login('tlo_dh');
select test.check((select exists (select 1 from jsonb_array_elements(hierarchy_report() -> 'mismatchedPendingReports') x where (x ->> 'reportId')::uuid = (select id from tlo_ids where name = 'rA2'))), 'the report lists the pending report whose lead is not the direct lead');
reset role;
select test.check((select team_lead_id = test.id('tlo_lA') from test.tlo((select id from tlo_ids where name = 'rA2'))), 'listing changed nothing');
set role authenticated;
select test.login('tlo_dh');
select test.check((hierarchy_report(true) ->> 'pendingReportsMoved')::int = 1, 'applying it corrects the one verifiable report');
reset role;
select test.check((select team_lead_id = test.id('tlo_lB') from test.tlo((select id from tlo_ids where name = 'rA2'))) and (select team_lead_id = test.id('tlo_lA') from test.tlo((select id from tlo_ids where name = 'rA'))),
  'the pending report is corrected and the approved one is untouched');
set role authenticated;
select test.login('tlo_lA');
select test.must_fail($$select hierarchy_report()$$, 'a Team Lead cannot read or apply the hierarchy report', 'Only the Super Admin');
select test.login('tlo_mA');
select test.must_fail($$select hierarchy_report()$$, 'nor a Team Member', 'Only the Super Admin');
reset role;

\echo '   Scenario: a suspended Team Lead leaves their members unassigned (no automatic replacement)'
update profiles set status = 'SUSPENDED' where id = test.id('tlo_lB');
select test.check(private.direct_lead_of(test.id('tlo_mB')) is null and private.direct_lead_of(test.id('tlo_mA')) is null, 'members of a suspended lead have no lead until a head names one (even though TL A is still active)');
select test.check(private.direct_lead_of(test.id('tlo_mA2')) = test.id('tlo_lA'), 'while TL A''s own members are unaffected');
update profiles set status = 'ACTIVE' where id = test.id('tlo_lB');
