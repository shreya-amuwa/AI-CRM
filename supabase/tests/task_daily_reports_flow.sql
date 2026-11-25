-- =============================================================================
-- One complete run of the task daily report and performance approval workflow for ONE department. Included (\i) by
-- task_daily_reports_performance_test.sql once per department; the people come from the tdr.* settings the caller sets:
--   h head, l team lead, m member of l, pl a second Team Lead of the SAME department (or another department's lead), pm that lead's member,
--   oh / ol / om the head / lead / member of ANOTHER department, slug (the department's slug), tag (a short label for the output and the titles).
-- The psql variable `strict` was true for International and Reseller only (20270210000100); since 20270213000100 every department runs it: there the Team Member has no performance view, the Team Lead
-- alone finalizes a member's performance (with a rating, never returning it to the member, never while a report waits) and the Department Head rates
-- the Team Lead. The "if strict" blocks hold those differences; everything else is the same run for every department.
-- test.u('m') is the id of the person named by the setting.
-- =============================================================================
\echo '   ===== department flow: ' :tag
reset role;
select set_config('request.jwt.claims', '', false);
drop table if exists tdr_ids;
create temp table tdr_ids (k text primary key, v uuid);
grant all on tdr_ids to anon, authenticated, service_role;

-- 1. Department Head -> Team Lead -> Team Member (the existing task flow)
set role authenticated;
select test.login(current_setting('tdr.h'));
insert into tdr_ids select 'T1', assign_task_to_team_lead(test.u('l'), 'TDR ' || :'tag' || ' prepare the quarterly pipeline', 'Cover every open account', 'HIGH', current_date + 5);
select test.login(current_setting('tdr.l'));
select test.check(delegate_task_to_members((select v from tdr_ids where k = 'T1'), jsonb_build_array(jsonb_build_object('memberId', test.u('m'), 'work', 'Update the accounts list'))) = 1,
  :'tag' || ': the Team Lead gives the Department Head''s task to their Team Member');
select test.check(assign_team_task('TDR ' || :'tag' || ' call the dormant customers', 'Ten calls', 'MEDIUM', current_date + 3, null, array[test.u('m')]) = 1,
  :'tag' || ': the Team Lead assigns a task of their own to the member');
reset role;
insert into tdr_ids select 'T1M', id from work_tasks where parent_id = (select v from tdr_ids where k = 'T1') and assignee_id = test.u('m');
insert into tdr_ids select 'T2', id from work_tasks where title = 'TDR ' || :'tag' || ' call the dormant customers' and assignee_id = test.u('m');
-- an overdue task and a task of another person (owner-run: the app roles cannot write tasks directly)
with ins as (
  insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date, created_at)
  select p.department_id, p.team_id, 'TDR ' || :'tag' || ' overdue paperwork', test.u('l'), p.id, current_date - 2, now() - interval '5 days' from profiles p where p.id = test.u('m')
  returning id) insert into tdr_ids select 'T3', id from ins;
with ins as (
  insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date)
  select p.department_id, p.team_id, 'TDR ' || :'tag' || ' peer task', test.u('h'), p.id, current_date + 4 from profiles p where p.id = test.u('pm')
  returning id) insert into tdr_ids select 'TP', id from ins;

-- 2. The Team Member's report
set role authenticated;
select test.login(current_setting('tdr.m'));
select test.check(exists (select 1 from jsonb_array_elements(task_reports_my_tasks()) t where (t ->> 'id')::uuid = (select v from tdr_ids where k = 'T1M')) and not exists (
  select 1 from jsonb_array_elements(task_reports_my_tasks()) t where (t ->> 'id')::uuid = (select v from tdr_ids where k = 'TP')), :'tag' || ': the member lists their own tasks and nobody else''s');
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Short', 50, 'more to do')$$, (select v from tdr_ids where k = 'T1M')), 'the work completed must be described', 'at least 10');
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Updated half of the account list', 50)$$, (select v from tdr_ids where k = 'T1M')), 'pending work is required below 100%', 'still pending');
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Updated half of the account list', 150, 'rest')$$, (select v from tdr_ids where k = 'T1M')), 'progress is 0 to 100', 'between 0 and 100');
select test.must_fail(format($$select task_report_submit(%L, current_date + 1, 'Updated half of the account list', 50, 'rest')$$, (select v from tdr_ids where k = 'T1M')), 'no report for a future day', 'future');
select test.must_fail(format($$select task_report_submit(%L, current_date - 1, 'Updated half of the account list', 50, 'rest')$$, (select v from tdr_ids where k = 'T1M')), 'no report for a day before the task was assigned', 'not assigned to you on that date');
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Updated half of the account list', 50, 'rest')$$, (select v from tdr_ids where k = 'TP')), 'a task assigned to somebody else cannot be reported', 'not found');
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Late paperwork was started today', 20, 'rest')$$, (select v from tdr_ids where k = 'T3')), 'an overdue task needs the reason for the delay', 'reason for the delay');
insert into tdr_ids select 'R3', (task_report_submit((select v from tdr_ids where k = 'T3'), current_date, 'Late paperwork was started today', 20, 'rest of the forms', 'Waiting for signatures') ->> 'id')::uuid;
insert into tdr_ids select 'R1', (task_report_submit((select v from tdr_ids where k = 'T1M'), current_date, 'Updated half of the account list', 60, 'The other half of the list', null, 'Will finish tomorrow') ->> 'id')::uuid;
select test.check((select status = 'PENDING' and revision = 1 and progress = 60 from public.task_daily_reports where id = (select v from tdr_ids where k = 'R1')), :'tag' || ': the report is Pending with revision 1');
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Updated again the same day', 70, 'rest')$$, (select v from tdr_ids where k = 'T1M')), 'a second report for the same task and day is refused', 'already waiting');
select test.check((select (task_reports_list('MINE') -> 'counts' ->> 'pending')::int = 2 from (select 1) x), :'tag' || ': the member sees their pending reports');

-- the people who must NOT read it
select test.login(current_setting('tdr.pm'));
select test.check(not exists (select 1 from task_daily_reports where task_id = (select v from tdr_ids where k = 'T1M')) and not exists (select 1 from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where i ->> 'taskId' = (select v::text from tdr_ids where k = 'T1M')), :'tag' || ': a member of another Team Lead sees nothing of it');
select test.must_fail(format($$select task_report_get(%L)$$, (select v from tdr_ids where k = 'R1')), 'and cannot open it', 'not found');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from tdr_ids where k = 'R1')), 'and cannot decide on it', 'not found');
select test.login(current_setting('tdr.om'));
select test.check((select count(*) = 0 from task_daily_reports where department_id = (select id from departments where slug = current_setting('tdr.slug'))) and not exists (select 1 from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where (i ->> 'departmentId')::uuid = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': a member of another department sees nothing');
select test.login(current_setting('tdr.ol'));
select test.check((select count(*) = 0 from task_daily_reports where department_id = (select id from departments where slug = current_setting('tdr.slug'))) and not exists (select 1 from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where (i ->> 'departmentId')::uuid = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': a Team Lead of another department sees nothing');
select test.login(current_setting('tdr.oh'));
select test.check((select count(*) = 0 from task_daily_reports where department_id = (select id from departments where slug = current_setting('tdr.slug'))) and not exists (select 1 from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where (i ->> 'departmentId')::uuid = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': a Department Head of another department sees nothing');
select test.must_fail(format($$select task_report_get(%L)$$, (select v from tdr_ids where k = 'R1')), 'and cannot open it', 'not found');
select test.login(current_setting('tdr.pl'));
select test.check((select count(*) = 0 from task_daily_reports where department_id = (select id from departments where slug = current_setting('tdr.slug'))) and not exists (select 1 from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where (i ->> 'departmentId')::uuid = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': another Team Lead does not see this lead''s team reports');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from tdr_ids where k = 'R1')), 'and cannot decide on them', 'not found');
select test.must_fail($$select task_report_submit(null, current_date, 'Not a team member report', 10, 'x')$$, 'a Team Lead does not write task reports', 'written by team members');
select test.must_fail($$insert into task_daily_reports (task_id, author_id, department_id, report_date, work_completed, progress) select id, assignee_id, department_id, current_date, 'direct insert attempt', 10 from work_tasks limit 1$$,
  'no direct writes to the table', 'permission denied');

-- 3. The Team Lead and the Department Head
select test.login(current_setting('tdr.l'));
select test.check((task_reports_list('TEAM', 'PENDING') ->> 'total')::int = 2 and (task_reports_list('TEAM') -> 'items' -> 0 ->> 'canReview')::boolean, :'tag' || ': the Team Lead sees the pending reports and may decide');
select test.must_fail(format($$select task_report_review(%L, 'RETURN', null)$$, (select v from tdr_ids where k = 'R1')), 'a return needs the reason', 'what must be corrected');
select test.must_fail(format($$select task_report_review(%L, 'MAYBE', null)$$, (select v from tdr_ids where k = 'R1')), 'only Approve or Return', 'Approve or Return');
select test.check((task_report_review((select v from tdr_ids where k = 'R1'), 'RETURN', 'Give the number of accounts updated') ->> 'status') = 'RETURNED', :'tag' || ': the Team Lead returns the report with a reason');
select test.login(current_setting('tdr.h'));
select test.check((task_reports_list('TEAM') ->> 'total')::int = 2 and (task_reports_list('TEAM', 'RETURNED') ->> 'total')::int = 1, :'tag' || ': the Department Head sees every report of the department with its status');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from tdr_ids where k = 'R3')), 'the Department Head does not approve a member''s report (the Team Lead does)', 'Team Lead');
select test.login(current_setting('tdr.m'));
select test.check((task_report_get((select v from tdr_ids where k = 'R1')) ->> 'status') = 'RETURNED' and (task_report_get((select v from tdr_ids where k = 'R1')) ->> 'reviewRemarks') = 'Give the number of accounts updated'
  and (task_report_get((select v from tdr_ids where k = 'R1')) ->> 'canEdit')::boolean, :'tag' || ': the member sees it Returned, with the reason');
select test.check((task_report_submit((select v from tdr_ids where k = 'T1M'), current_date, 'Updated 40 of 80 accounts in the list', 80, 'The last 40 accounts', null, 'Done by tomorrow') ->> 'revision')::int = 2,
  :'tag' || ': the member corrects and resubmits (the same report, revision 2)');
select test.check((select count(*) = 1 from task_daily_reports where task_id = (select v from tdr_ids where k = 'T1M') and report_date = current_date), :'tag' || ': still one report for the task and day (no duplicate)');
select test.login(current_setting('tdr.l'));
select test.check((task_report_review((select v from tdr_ids where k = 'R1'), 'APPROVE', 'Good, clear numbers') ->> 'status') = 'APPROVED', :'tag' || ': the Team Lead approves');
select test.must_fail(format($$select task_report_review(%L, 'RETURN', 'Changed my mind about it')$$, (select v from tdr_ids where k = 'R1')), 'a decided report cannot be decided twice', 'already decided');
select test.check((task_report_review((select v from tdr_ids where k = 'R3'), 'APPROVE', null) ->> 'status') = 'APPROVED', :'tag' || ': the overdue task''s report is approved too');
select test.login(current_setting('tdr.m'));
select test.must_fail(format($$select task_report_submit(%L, current_date, 'Trying to change an approved one', 90, 'rest')$$, (select v from tdr_ids where k = 'T1M')), 'an approved report cannot be changed', 'already approved');
select test.must_fail(format($$select task_report_review(%L, 'APPROVE', null)$$, (select v from tdr_ids where k = 'R3')), 'a member cannot approve', 'Team Lead|already decided|not found');
select test.check((select jsonb_array_length(task_report_get((select v from tdr_ids where k = 'R1')) -> 'history') = 4
                      and (task_report_get((select v from tdr_ids where k = 'R1')) -> 'history' -> 0 ->> 'action') = 'SUBMITTED'
                      and (task_report_get((select v from tdr_ids where k = 'R1')) -> 'history' -> 1 ->> 'action') = 'RETURNED'
                      and (task_report_get((select v from tdr_ids where k = 'R1')) -> 'history' -> 2 ->> 'action') = 'RESUBMITTED'
                      and (task_report_get((select v from tdr_ids where k = 'R1')) -> 'history' -> 3 ->> 'action') = 'APPROVED'
                      and (task_report_get((select v from tdr_ids where k = 'R1')) -> 'history' -> 3 ->> 'by') is not null from (select 1) x),
  :'tag' || ': the approval history keeps submitted, returned, resubmitted, approved with the approver');
select test.must_fail($$update task_daily_report_history set remarks = 'x'$$, 'the history cannot be edited', 'permission denied');

-- 4. Real data feeds performance: the tasks and the approved reports
reset role;
select test.check((select count(distinct entity_id) = 2 from notifications where recipient_id = test.u('l') and type = 'REPORT_TASK_SUBMITTED' and entity_id in (select v from tdr_ids where k in ('R1', 'R3'))),
  :'tag' || ': the Team Lead was notified of each submitted report');
select test.check((select count(*) >= 2 from notifications where recipient_id = test.u('m') and type in ('REPORT_TASK_APPROVED', 'REPORT_TASK_RETURNED') and entity_id = (select v from tdr_ids where k = 'R1')), :'tag' || ': the member was notified of the return and of the approval');
select test.check((select count(*) = 1 from audit_logs where action = 'TASK_REPORT_APPROVED' and entity_id = (select v from tdr_ids where k = 'R1'))
                  and (select count(*) = 1 from audit_logs where action = 'TASK_REPORT_RESUBMITTED' and entity_id = (select v from tdr_ids where k = 'R1')), :'tag' || ': submissions and decisions are in the audit log');
-- T2: a report that is approved (progress 30); T1M is completed afterwards
set role authenticated;
select test.login(current_setting('tdr.m'));
insert into tdr_ids select 'R2', (task_report_submit((select v from tdr_ids where k = 'T2'), current_date, 'Made four of the ten calls', 30, 'Six more calls') ->> 'id')::uuid;
select test.login(current_setting('tdr.l'));
select task_report_review((select v from tdr_ids where k = 'R2'), 'APPROVE', null);
reset role;
update work_tasks set status = 'COMPLETED', progress = 100, completed_at = now() where id = (select v from tdr_ids where k = 'T1M');

set role authenticated;
create temp table if not exists tdr_json (k text primary key, j jsonb);
grant all on tdr_json to anon, authenticated;
delete from tdr_json;
\if :strict
-- the member has no performance view: the same figures are read from their Team Lead's view (the checks below then run as the member)
select test.login(current_setting('tdr.m'));
select test.must_fail($$select performance_overview(current_date - 30, current_date + 30)$$, 'a member cannot open performance (it is the Team Lead''s)', 'for Team Leads and Department Heads');
select test.login(current_setting('tdr.l'));
insert into tdr_json select 'm', jsonb_build_object('me', x) from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') x where x ->> 'id' = test.u('m')::text;
insert into tdr_ids select 'PM', (j #>> '{me,record,id}')::uuid from tdr_json where k = 'm';
select test.login(current_setting('tdr.m'));
\else
select test.login(current_setting('tdr.m'));
insert into tdr_json select 'm', performance_overview(current_date - 30, current_date + 30);
\endif
-- the figures equal what the real records say (the fixtures of other suites may already have given this person tasks)
select test.check((select (j #>> '{me,metrics,tasks,total}')::int = (select count(*) from work_tasks where assignee_id = test.u('m'))
                     and (j #>> '{me,metrics,tasks,completed}')::int = (select count(*) from work_tasks where assignee_id = test.u('m') and status = 'COMPLETED')
                     and (j #>> '{me,metrics,tasks,overdue}')::int = (select count(*) from work_tasks where assignee_id = test.u('m') and status <> 'COMPLETED' and due_date < current_date)
                     and (j #>> '{me,metrics,tasks,overdue}')::int >= 1 from tdr_json where k = 'm'), :'tag' || ': My Performance counts the real task records (assigned, completed, overdue)');
select test.check((select (j #>> '{me,metrics,reports,approved}')::int = 3 and (j #>> '{me,metrics,reports,submitted}')::int = 3 and (j #>> '{me,metrics,reports,returned}')::int = 0
                     and (j #>> '{me,metrics,reports,pending}')::int = 0 from tdr_json where k = 'm'), :'tag' || ': the three approved reports are counted');
select test.check((select current_setting('tdr.slug') <> 'tdr-a' or ((j #>> '{me,metrics,tasks,total}')::int = 3 and (j #>> '{me,metrics,completionPct}')::numeric = 33.3 and (j #>> '{me,metrics,onTimePct}')::numeric = 100
                     and (j #>> '{me,metrics,progressPct}')::numeric = 50 and (j #>> '{me,metrics,reports,approvalPct}')::numeric = 100
                     and (select array_agg((x ->> 'weight')::int order by ord) from jsonb_array_elements(j #> '{me,metrics,parts}') with ordinality a(x, ord)) = array[35, 15, 20, 15, 15]
                     and (j #>> '{me,metrics,score}')::numeric = (select round(sum((x ->> 'value')::numeric * (x ->> 'weight')::numeric) filter (where x ->> 'value' is not null)
                                                                         / sum((x ->> 'weight')::numeric) filter (where x ->> 'value' is not null), 1) from jsonb_array_elements(j #> '{me,metrics,parts}') x)) from tdr_json where k = 'm'),
  :'tag' || ': worked example (clean department): 1 of 3 tasks completed = 33.3%, on time 100%, progress 50% from the approved reports, score = the weighted parts');
select test.check((select (j #>> '{me,metrics,score}')::numeric between 0 and 100 and j #>> '{me,record,status}' = 'PENDING' and (j #>> '{me,record,version}')::int >= 1 from tdr_json where k = 'm'),
  :'tag' || ': a score is calculated and the record waits for the Team Lead (Pending)');
\if :strict
select test.check((select count(*) = 0 from performance_records), :'tag' || ': the member reads no performance record, not even their own');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'self approval', null, 5)$$, (select v from tdr_ids where k = 'PM')), 'a member cannot approve their own performance', 'not found');
select test.must_fail(format($$select performance_record_history(%L)$$, (select v from tdr_ids where k = 'PM')), 'nor read its approval history', 'not found');
select test.must_fail(format($$select performance_subject_history(%L)$$, test.u('m')), 'nor their evaluation history', 'not found');
select test.login(current_setting('tdr.om'));
select test.must_fail($$select performance_overview(current_date - 30, current_date + 30)$$, 'another unified department''s member has no performance view either', 'for Team Leads and Department Heads');
\else
select test.check((select count(*) = 1 from performance_records), :'tag' || ': the member reads only their own performance record');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'self approval', null)$$, (select (j #>> '{me,record,id}')::uuid from tdr_json where k = 'm')), 'a member cannot approve their own performance', 'Only the Team Lead');
-- the member of another Team Lead / department
select test.login(current_setting('tdr.om'));
select test.check((select j #>> '{me,id}' = test.u('om')::text and not j ? 'members' and not j ? 'leads' and (j #>> '{me,metrics,tasks,total}')::int = (select count(*) from work_tasks where assignee_id = test.u('om')) from (select performance_overview(current_date - 30, current_date + 30) j) x), :'tag' || ': another department''s member sees only their own performance');
\endif

-- 5. Team Lead: performance of the team and of themselves
select test.login(current_setting('tdr.l'));
delete from tdr_json;
insert into tdr_json select 'l', performance_overview(current_date - 30, current_date + 30);
select test.check((select j ->> 'role' = 'TEAM_HEAD' and (select count(*) from jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text) = 1
                     and (select count(*) from jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('pm')::text) = 0 from tdr_json where k = 'l'),
  :'tag' || ': the Team Lead''s performance lists their own members, not another Team Lead''s');
select test.check((select (j #>> '{me,metrics,reports,approved}')::int = 3 and (j #>> '{me,metrics,reports,reviewedPct}')::numeric = 100
                     and (j #>> '{me,metrics,team,total}')::int >= 3 and (j #>> '{me,metrics,team,completed}')::int >= 1 and (j #>> '{me,metrics,management,tasksAssignedToTeam}')::int >= 2
                     and (j #>> '{me,metrics,score}')::numeric between 0 and 100 from tdr_json where k = 'l'),
  :'tag' || ': the Team Lead''s own performance uses team progress, report reviews and task assignment');
select test.check((select j #>> '{me,record,status}' = 'PENDING' and (j #>> '{me,record,canDecide}')::boolean = false from tdr_json where k = 'l'), :'tag' || ': the Team Lead''s record is Pending and they cannot decide on it themselves');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, null)$$, (select (j #>> '{me,record,id}')::uuid from tdr_json where k = 'l')), 'the Team Lead cannot approve their own performance', 'Department Head');
\if :strict
-- International / Reseller: the Team Lead finalizes the member's performance with a rating; it is never returned to the member, and never approved while a report waits
select test.must_fail(format($$select performance_record_review(%L, 'RETURN', 'Please explain the overdue paperwork', null)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text)), 'a member''s performance is not returned to them (their reports are)', 'not returned to them');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, 999, 4)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text)), 'figures that changed after opening are refused', 'figures changed');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'Reviewed with the member', null)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text)), 'approving needs a rating', 'Give a rating');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'Reviewed with the member', null, 9)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text)), 'the rating is 1 to 5', 'rating is from 1 to 5');
select test.check((select (x #>> '{record,canDecide}')::boolean and not (x #>> '{record,canReturn}')::boolean and (x #>> '{record,ratingRequired}')::boolean
                     from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text), :'tag' || ': the Team Lead may approve the member''s performance (with a rating), not return it');
-- a report still waiting blocks the approval: only approved reports finalize the performance
select test.check(assign_team_task('TDR ' || :'tag' || ' log the call outcomes', 'A note for each call', 'LOW', current_date + 3, null, array[test.u('m')]) = 1, :'tag' || ': the Team Lead assigns one more task');
reset role;
insert into tdr_ids select 'T4', id from work_tasks where title = 'TDR ' || :'tag' || ' log the call outcomes' and assignee_id = test.u('m');
set role authenticated;
select test.login(current_setting('tdr.m'));
insert into tdr_ids select 'R4', (task_report_submit((select v from tdr_ids where k = 'T4'), current_date, 'Logged the outcome of four calls', 40, 'Six more call notes') ->> 'id')::uuid;
select test.login(current_setting('tdr.l'));
select test.check((select (r -> 'record' ->> 'waitingReports')::int = 1 from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') r where r ->> 'id' = test.u('m')::text),
  :'tag' || ': the Team Lead sees that one report of the member is still waiting');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'Reviewed with the member', null, 4)$$, (select v from tdr_ids where k = 'PM')), 'not while a report of the member is still waiting', 'still waiting for your review');
select test.check((task_report_review((select v from tdr_ids where k = 'R4'), 'RETURN', 'Add the customer name to each note') ->> 'status') = 'RETURNED', :'tag' || ': the Team Lead returns that report for correction');
select test.check((select r ->> 'status' = 'APPROVED' and (r ->> 'rating')::int = 4 and r ->> 'reviewRemarks' = 'Reviewed with the member'
                     from (select performance_record_review((select v from tdr_ids where k = 'PM'), 'APPROVE', 'Reviewed with the member', null, 4) r) x),
  :'tag' || ': the Team Lead finalizes the member''s performance: approved with a rating of 4');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, null, 5)$$, (select v from tdr_ids where k = 'PM')), 'an approved record is final', 'already decided');
select test.check((select string_agg(h ->> 'action', ',' order by ord) filter (where h ->> 'action' <> 'REFRESHED') = 'GENERATED,APPROVED'
                          and bool_or(h ->> 'action' = 'APPROVED' and h ->> 'by' is not null and (h ->> 'rating')::int = 4 and h ->> 'remarks' = 'Reviewed with the member')
                     from jsonb_array_elements(performance_record_history((select v from tdr_ids where k = 'PM'))) with ordinality a(h, ord)),
  :'tag' || ': the approval history keeps the approver, the time, the remarks and the rating');
select test.check((select count(*) = 1 from jsonb_array_elements(performance_subject_history(test.u('m')) -> 'records') x where x ->> 'status' = 'APPROVED' and (x ->> 'rating')::int = 4),
  :'tag' || ': the member''s evaluation history (every period) keeps the approved rating for the Team Lead');
select test.login(current_setting('tdr.m'));
select test.must_fail(format($$select performance_record_resubmit(%L)$$, (select v from tdr_ids where k = 'PM')), 'the member cannot send their performance again', 'Team Lead decides');
select test.login(current_setting('tdr.l'));
\else
-- the member's performance: the Team Lead returns it, the member resubmits, the Team Lead approves
select test.must_fail(format($$select performance_record_review(%L, 'RETURN', null, null)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text)), 'a return needs the reason', 'what must be corrected');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, 999)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text)), 'figures that changed after opening are refused', 'figures changed');
select test.check((performance_record_review((select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'members') x where x ->> 'id' = test.u('m')::text), 'RETURN', 'Please explain the overdue paperwork') ->> 'status') = 'RETURNED',
  :'tag' || ': the Team Lead returns the member''s performance for correction');
select test.login(current_setting('tdr.m'));
select test.check((performance_overview(current_date - 30, current_date + 30) #>> '{me,record,status}') = 'RETURNED' and (performance_overview(current_date - 30, current_date + 30) #>> '{me,record,canResubmit}')::boolean, :'tag' || ': the member sees Returned for Correction');
select test.check((performance_record_resubmit((select id from performance_records where subject_id = test.u('m') limit 1)) ->> 'status') = 'PENDING', :'tag' || ': the member sends it again (Pending)');
select test.must_fail(format($$select performance_record_resubmit(%L)$$, (select id from performance_records where subject_id = test.u('m') limit 1)), 'only a returned record can be sent again', 'returned for correction');
select test.login(current_setting('tdr.l'));
select test.check((performance_record_review((select id from performance_records where subject_id = test.u('m') limit 1), 'APPROVE', 'Reviewed with the member', null) ->> 'status') = 'APPROVED', :'tag' || ': the Team Lead approves the member''s performance');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, null)$$, (select id from performance_records where subject_id = test.u('m') limit 1)), 'an approved record is final', 'already decided');
select test.check((select string_agg(h ->> 'action', ',' order by ord) = 'GENERATED,RETURNED,RESUBMITTED,APPROVED' and bool_or(h ->> 'by' is not null and h ->> 'remarks' = 'Reviewed with the member')
                     from jsonb_array_elements(performance_record_history((select id from performance_records where subject_id = test.u('m') limit 1))) with ordinality a(h, ord)),
  :'tag' || ': the approval history of the performance record is kept (approver, time, remarks)');
\endif

-- an approved record keeps the approved figures while the live figures move on
reset role;
insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date, status, progress, completed_at)
select p.department_id, p.team_id, 'TDR ' || :'tag' || ' extra task', test.u('l'), p.id, current_date + 1, 'COMPLETED', 100, now() from profiles p where p.id = test.u('m');
\if :strict
set role authenticated;
select test.login(current_setting('tdr.l'));
select test.check((select (x #>> '{metrics,tasks,total}')::int = (select (metrics #>> '{tasks,total}')::int + 1 from performance_records where id = (select v from tdr_ids where k = 'PM'))
                          and x #>> '{record,status}' = 'APPROVED' and (x #>> '{record,rating}')::int = 4
                     from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') x where x ->> 'id' = test.u('m')::text),
  :'tag' || ': the live figures move on (one more task) while the approved record keeps what was approved, with its rating');
\else
set role authenticated;
select test.login(current_setting('tdr.m'));
select test.check((select (j #>> '{me,metrics,tasks,total}')::int = (select count(*) from work_tasks where assignee_id = test.u('m')) and j #>> '{me,record,status}' = 'APPROVED'
                          and (j #>> '{me,metrics,tasks,total}')::int = (select (metrics #>> '{tasks,total}')::int + 1 from performance_records where subject_id = test.u('m') limit 1) from (select performance_overview(current_date - 30, current_date + 30) j) x),
  :'tag' || ': the live figures move on (one more task) while the approved record keeps what was approved');
\endif

-- 6. Department Head: every team, every Team Lead; approves the Team Lead
select test.login(current_setting('tdr.h'));
delete from tdr_json;
insert into tdr_json select 'h', performance_overview(current_date - 30, current_date + 30);
select test.check((select j ->> 'role' = 'DEPARTMENT_HEAD' and j #>> '{department,name}' is not null and (select count(*) from jsonb_array_elements(j -> 'leads') x where x ->> 'id' = test.u('l')::text) = 1
                     and (select count(*) from jsonb_array_elements(j -> 'leads') x where x ->> 'id' = test.u('ol')::text) = 0 from tdr_json where k = 'h'),
  :'tag' || ': the Department Head sees their department''s Team Leads and nobody else''s');
select test.check((select (j #>> '{tasks,total}')::int >= 4 and (j #>> '{tasks,overdue}')::int >= 1 and (j #>> '{reports,approved}')::int = 3 and (j #>> '{reports,pending}')::int = 0 from tdr_json where k = 'h'),
  :'tag' || ': department-wide tasks, pending work, delays and report approval are counted');
select test.check((select (select count(*) from jsonb_array_elements(x -> 'members') y where y ->> 'id' = test.u('m')::text and y #>> '{record,status}' = 'APPROVED') = 1
                     from tdr_json, jsonb_array_elements(j -> 'leads') x where x ->> 'id' = test.u('l')::text), :'tag' || ': under each Team Lead the Department Head sees every member and the approval status');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, null)$$, (select id from performance_records where subject_id = test.u('m') limit 1)), 'the Department Head only reads a member''s performance', 'Only the Team Lead|already decided');
select test.must_fail(format($$select performance_record_review(%L, 'RETURN', 'Needs a better pipeline review', 1)$$, (select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'leads') x where x ->> 'id' = test.u('l')::text)), 'a stale version is refused', 'figures changed');
select test.check((performance_record_review((select (x #>> '{record,id}')::uuid from tdr_json, jsonb_array_elements(j -> 'leads') x where x ->> 'id' = test.u('l')::text), 'RETURN', 'Please clear the pending reviews first',
                    (select (x #>> '{record,version}')::int from tdr_json, jsonb_array_elements(j -> 'leads') x where x ->> 'id' = test.u('l')::text)) ->> 'status') = 'RETURNED', :'tag' || ': the Department Head returns the Team Lead''s performance');
select test.login(current_setting('tdr.l'));
select test.check((performance_overview(current_date - 30, current_date + 30) #>> '{me,record,status}') = 'RETURNED', :'tag' || ': the Team Lead sees Returned for Correction');
select test.check((performance_record_resubmit((select id from performance_records where subject_id = test.u('l') limit 1)) ->> 'status') = 'PENDING', :'tag' || ': the Team Lead resubmits');
select test.login(current_setting('tdr.h'));
\if :strict
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', 'Team progress is on track', null)$$, (select id from performance_records where subject_id = test.u('l') limit 1)), 'the Department Head rates the Team Lead when approving', 'Give a rating');
select test.check((select r ->> 'status' = 'APPROVED' and (r ->> 'rating')::int = 5 from (select performance_record_review((select id from performance_records where subject_id = test.u('l') limit 1), 'APPROVE', 'Team progress is on track', null, 5) r) x),
  :'tag' || ': the Department Head approves the Team Lead''s performance with a rating of 5');
\else
select test.check((performance_record_review((select id from performance_records where subject_id = test.u('l') limit 1), 'APPROVE', 'Team progress is on track', null) ->> 'status') = 'APPROVED', :'tag' || ': the Department Head approves the Team Lead''s performance');
\endif
select test.check((select string_agg(h ->> 'action', ',' order by ord) filter (where h ->> 'action' <> 'REFRESHED') = 'GENERATED,RETURNED,RESUBMITTED,APPROVED' and bool_or(h ->> 'by' is not null and h ->> 'remarks' = 'Team progress is on track')
                     from jsonb_array_elements(performance_record_history((select id from performance_records where subject_id = test.u('l') limit 1))) with ordinality a(h, ord)), :'tag' || ': the Team Lead''s approval history shows approver, time and remarks');
-- the other department's head and lead
select test.login(current_setting('tdr.oh'));
select test.check((select count(*) = 0 from performance_records where department_id = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': another department''s head reads none of its records');
select test.must_fail(format($$select performance_record_review(%L, 'APPROVE', null, null)$$, (select id from performance_records where subject_id = test.u('l') limit 1)), 'and cannot decide on them', 'not found');
select test.must_fail(format($$select performance_record_history(%L)$$, (select id from performance_records where subject_id = test.u('l') limit 1)), 'or read their history', 'not found');
select test.check((select count(*) = 0 from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'leads') x where x ->> 'id' = test.u('l')::text), :'tag' || ': and their own overview does not list this department''s people');
select test.login(current_setting('tdr.ol'));
select test.check((select count(*) = 0 from performance_records where department_id = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': another department''s Team Lead reads none of its records');
select test.login(current_setting('tdr.pl'));
select test.check((select count(*) = 0 from performance_records where subject_id in (test.u('m'), test.u('l'))), :'tag' || ': another Team Lead does not read this team''s records');

-- 7. Super Admin: sees the department, decides nothing
select test.login('sa');
select test.check((select count(*) = 1 from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30, (select id from departments where slug = current_setting('tdr.slug'))) -> 'leads') x where x ->> 'id' = test.u('l')::text),
  :'tag' || ': the Super Admin sees the department''s performance');
select test.must_fail($$select performance_overview(current_date - 30, current_date + 30)$$, 'and must choose a department', 'Choose a department');
select test.check((select count(*) >= 3 from task_daily_reports where department_id = (select id from departments where slug = current_setting('tdr.slug'))), :'tag' || ': and reads every report');
select test.must_fail($$select performance_overview(current_date, current_date - 1)$$, 'a period must be valid', 'period');
reset role;
select test.check((select case when :'strict' = 'true' then count(*) = 0 else count(*) filter (where type = 'REPORT_PERFORMANCE_APPROVED') >= 1 end
                      from notifications where recipient_id = test.u('m') and type like 'REPORT_PERFORMANCE_%')
                   and (select count(*) >= 1 from notifications where recipient_id = test.u('l') and type = 'REPORT_PERFORMANCE_RETURNED')
                   and (select count(*) >= 1 from audit_logs where action = 'PERFORMANCE_RECORD_APPROVED' and entity_id = (select id from performance_records where subject_id = test.u('l') limit 1)), :'tag' || ': performance decisions notify the person and are audited');
