-- =============================================================================
-- Performance Management for Team Leads and Department Heads in every department (migration 20270213000100):
--   * the Team Lead edits a member's waiting daily report (then approves it); nobody else may; every change is in the history and the audit log;
--   * the reviewer updates the rating and remarks of an approved evaluation (Team Lead: members; Department Head: Team Leads);
--   * a person's tasks and reports for the reviewer's drill-down (never for the person themselves);
--   * an ordinary department: a member without a Team Lead is still decided by the Department Head; a returned member record is reopened.
-- Uses the people of task_daily_reports_performance_test.sql (department tdr-a), which must run first; own rows are removed at the end.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 192. Performance Management (every department): report edits, evaluation updates, a member''s work'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270213000100_performance_lead_primary.sql
\i supabase/migrations/20270213000100_performance_lead_primary.sql
-- AI Studio reads its own work (20270214000100 replaces some of the functions above, so it is applied again after them)
\i supabase/migrations/20270214000100_ai_studio_performance.sql

select test.check(not has_function_privilege('anon', 'public.task_report_reviewer_edit(uuid, text, integer, text, text, text, text)', 'execute')
                  and not has_function_privilege('anon', 'public.performance_record_update_evaluation(uuid, integer, text)', 'execute')
                  and not has_function_privilege('anon', 'public.performance_member_work(uuid, date, date)', 'execute')
                  and has_function_privilege('authenticated', 'public.performance_member_work(uuid, date, date)', 'execute'), 'grants: signed-in users only');

-- a clean start (the suite can be run again)
delete from task_daily_reports where task_id in (select id from work_tasks where title like 'PLP %');
delete from work_tasks where title like 'PLP %';
delete from performance_records where subject_id in (select id from test.users where name = 'tdr_mx') or (subject_id = test.id('tdr_m1') and period_start = date '2020-01-01');
delete from auth.users where email = 'tdr.mx@example.com';
delete from test.users where name = 'tdr_mx';
delete from teams where name = 'PLP Unled' and department_id = test.dept('tdr-a');
create temp table plp (k text primary key, v uuid);
grant all on plp to authenticated;
with ins as (
  insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date)
  select p.department_id, p.team_id, 'PLP prepare the renewal list', test.id('tdr_tl1'), p.id, current_date + 3 from profiles p where p.id = test.id('tdr_m1')
  returning id) insert into plp select 'T', id from ins;

\echo '   the Team Lead edits a waiting report'
set role authenticated;
select test.login('tdr_m1');
insert into plp select 'R', (task_report_submit((select v from plp where k = 'T'), current_date, 'Prepared the first draft of the list', 40, 'The second half of the list') ->> 'id')::uuid;
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the whole list already', 100, null, null, null, 'I finished it')$$, (select v from plp where k = 'R')),
  'the member cannot edit their waiting report this way', 'Only the Team Lead');
select test.login('tdr_tl2');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the first draft of the list', 55, 'Second half', null, null, 'Progress check')$$, (select v from plp where k = 'R')),
  'another Team Lead of the department cannot', 'not found');
select test.login('tdr_dha');
select test.check((select (i ->> 'canReviewerEdit')::boolean = false from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where i ->> 'id' = (select v::text from plp where k = 'R')),
  'the Department Head reads the report, may not edit it');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the first draft of the list', 55, 'Second half', null, null, 'Progress check')$$, (select v from plp where k = 'R')),
  'nor change it (the Team Lead is the reviewer)', 'Only the Team Lead');
select test.login('tdr_dhb');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the first draft of the list', 55, 'Second half', null, null, 'Progress check')$$, (select v from plp where k = 'R')),
  'another department''s head cannot even find it', 'not found');
select test.login('tdr_tl1');
select test.check((select (i ->> 'canReviewerEdit')::boolean from jsonb_array_elements(task_reports_list('TEAM') -> 'items') i where i ->> 'id' = (select v::text from plp where k = 'R')),
  'the member''s Team Lead may edit it');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the first draft of the list', 55, 'Second half', null, null, null)$$, (select v from plp where k = 'R')),
  'an edit needs a reason the member can read', 'Say why you changed');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the first draft of the list', 55, null, null, null, 'Progress check')$$, (select v from plp where k = 'R')),
  'the member''s rules apply: pending work below 100%', 'still pending');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Short', 55, 'Second half', null, null, 'Progress check')$$, (select v from plp where k = 'R')),
  'and the work must be described', 'at least 10');
select test.check((select j ->> 'status' = 'PENDING' and (j ->> 'progress')::int = 55 and j ->> 'editedBy' is not null and j ->> 'pendingWork' = 'The second half, checked'
                     from (select task_report_reviewer_edit((select v from plp where k = 'R'), 'Prepared the first draft of the list and checked it', 55,
                                                            'The second half, checked', null, null, 'Progress checked against the sheet') j) x),
  'the Team Lead''s edit is saved; the report still waits for the decision');
-- a second click with the same values
select task_report_reviewer_edit((select v from plp where k = 'R'), 'Prepared the first draft of the list and checked it', 55, 'The second half, checked', null, null, 'Progress checked against the sheet');
select test.check((select count(*) = 1 and bool_and(h -> 'changes' -> 'progress' ->> 'from' = '40' and h -> 'changes' -> 'progress' ->> 'to' = '55'
                                                     and h -> 'changes' ? 'workCompleted' and not h -> 'changes' ? 'delayReason' and h ->> 'remarks' = 'Progress checked against the sheet')
                     from jsonb_array_elements(task_report_get((select v from plp where k = 'R')) -> 'history') h where h ->> 'action' = 'EDITED'),
  'the history keeps one EDITED step with the reason and each change (from -> to); a repeated click records nothing');
select test.check((task_report_review((select v from plp where k = 'R'), 'APPROVE', 'Thanks') ->> 'status') = 'APPROVED', 'then the Team Lead approves it');
select test.must_fail(format($$select task_report_reviewer_edit(%L, 'Prepared the first draft of the list', 70, 'Second half', null, null, 'Late change')$$, (select v from plp where k = 'R')),
  'a decided report cannot be edited', 'Only a report waiting');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'TASK_REPORT_EDITED' and entity_id = (select v from plp where k = 'R'))
                  and (select count(*) = 1 from notifications where recipient_id = test.id('tdr_m1') and type = 'REPORT_TASK_EDITED' and entity_id = (select v from plp where k = 'R')),
  'the edit is audited and the member is told');
select test.must_fail(format($$update task_daily_report_history set remarks = 'x' where report_id = %L$$, (select v from plp where k = 'R')), 'the history stays append-only', 'cannot be changed');
set role authenticated;
select test.login('tdr_m1');
select test.check((select (j -> 'history') @> '[{"action": "EDITED"}]' and j ->> 'editedBy' is not null from (select task_report_get((select v from plp where k = 'R')) j) x),
  'the member sees what their Team Lead changed');

\echo '   updating an approved evaluation'
reset role;
insert into plp select 'PM', id from performance_records where subject_id = test.id('tdr_m1') and status = 'APPROVED' order by period_start limit 1;
insert into plp select 'PL', id from performance_records where subject_id = test.id('tdr_tl1') and status = 'APPROVED' order by period_start limit 1;
select test.check((select count(*) = 2 from plp where k in ('PM', 'PL') and v is not null), 'the member''s and the Team Lead''s approved records (from the workflow suite)');
-- a known starting rating (the suite can be run again on the same database)
update performance_records set rating = 4, review_remarks = 'Reviewed with the member' where id = (select v from plp where k = 'PM');
set role authenticated;
select test.login('tdr_tl1');
select test.check((select (x #>> '{record,canUpdate}')::boolean from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'members') x where x ->> 'id' = test.id('tdr_m1')::text),
  'the Team Lead may update their member''s approved evaluation');
select test.must_fail(format($$select performance_record_update_evaluation(%L, 7, null)$$, (select v from plp where k = 'PM')), 'the rating is 1 to 5', 'rating is from 1 to 5');
select test.must_fail(format($$select performance_record_update_evaluation(%L, null, 'no rating')$$, (select v from plp where k = 'PM')), 'and required', 'rating is from 1 to 5');
select test.check((select r ->> 'status' = 'APPROVED' and (r ->> 'rating')::int = 3 and r ->> 'reviewRemarks' = 'Re-evaluated after the client review'
                     from (select performance_record_update_evaluation((select v from plp where k = 'PM'), 3, 'Re-evaluated after the client review') r) x),
  'the Team Lead updates the rating and remarks; the record stays approved');
select count(*) as plp_updates from performance_record_history where record_id = (select v from plp where k = 'PM') and action = 'UPDATED' \gset
select performance_record_update_evaluation((select v from plp where k = 'PM'), 3, 'Re-evaluated after the client review');
select test.check((select count(*) = :plp_updates from performance_record_history where record_id = (select v from plp where k = 'PM') and action = 'UPDATED')
                  and (select (h ->> 'rating')::int = 3 and h -> 'changes' -> 'rating' ->> 'from' = '4' and h -> 'changes' -> 'rating' ->> 'to' = '3' and h -> 'changes' ? 'remarks'
                         from jsonb_array_elements(performance_record_history((select v from plp where k = 'PM'))) with ordinality a(h, n) where h ->> 'action' = 'UPDATED' order by n desc limit 1),
  'the history keeps an UPDATED step with the old and new rating and remarks (a repeated click records nothing)');
select test.must_fail(format($$select performance_record_update_evaluation(%L, 5, null)$$, (select v from plp where k = 'PL')), 'a Team Lead cannot rate themselves', 'Only the Department Head');
select test.login('tdr_tl2');
select test.must_fail(format($$select performance_record_update_evaluation(%L, 5, null)$$, (select v from plp where k = 'PM')), 'another Team Lead cannot', 'not found');
select test.login('tdr_m1');
select test.must_fail(format($$select performance_record_update_evaluation(%L, 5, null)$$, (select v from plp where k = 'PM')), 'the member cannot (nor read it)', 'not found');
select test.login('tdr_dha');
select test.check((select (x #>> '{record,canUpdate}')::boolean = false and (x #>> '{record,rating}')::int = 3
                     from jsonb_array_elements(performance_overview(current_date - 30, current_date + 30) -> 'leads') l, jsonb_array_elements(l -> 'members') x where x ->> 'id' = test.id('tdr_m1')::text),
  'the Department Head sees the Team Lead''s updated rating of the member, read only');
select test.must_fail(format($$select performance_record_update_evaluation(%L, 5, null)$$, (select v from plp where k = 'PM')),
  'and does not replace the Team Lead as the member''s evaluator', 'Only the Team Lead');
select test.check((select r ->> 'status' = 'APPROVED' and (r ->> 'rating')::int = 4 from (select performance_record_update_evaluation((select v from plp where k = 'PL'), 4, 'Adjusted after the quarter review') r) x),
  'the Department Head updates the Team Lead''s evaluation');
select test.login('tdr_dhb');
select test.must_fail(format($$select performance_record_update_evaluation(%L, 1, null)$$, (select v from plp where k = 'PL')), 'another department''s head cannot', 'not found');
select test.login('tdr_tl1');
-- a period nobody decided yet: the record is Pending
insert into plp select 'PP', (x #>> '{record,id}')::uuid from jsonb_array_elements(performance_overview(current_date - 6, current_date) -> 'members') x where x ->> 'id' = test.id('tdr_m1')::text;
select test.must_fail(format($$select performance_record_update_evaluation(%L, 4, null)$$, (select v from plp where k = 'PP')), 'a pending evaluation is reviewed, not updated', 'Only an approved');
reset role;
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('tdr_tl1') and type = 'REPORT_PERFORMANCE_UPDATED' and entity_id = (select v from plp where k = 'PL'))
                  and (select count(*) = 0 from notifications where recipient_id = test.id('tdr_m1') and type like 'REPORT_PERFORMANCE_%')
                  and (select count(*) >= 1 from audit_logs where action = 'PERFORMANCE_RECORD_EVALUATION_UPDATED' and entity_id = (select v from plp where k = 'PM'))
                  and (select count(*) >= 1 from audit_logs where action = 'PERFORMANCE_RECORD_EVALUATION_UPDATED' and entity_id = (select v from plp where k = 'PL')),
  'the Team Lead is told about their updated evaluation, the member is not (they have no performance view); both updates are audited');

\echo '   a person''s work, for the reviewer'
set role authenticated;
select test.login('tdr_tl1');
select test.check((select (w ->> 'name') is not null
                          and jsonb_array_length(w -> 'tasks') = (select count(*) from work_tasks t where t.assignee_id = test.id('tdr_m1')
                                                                   and coalesce(t.due_date, (t.created_at at time zone 'Asia/Kolkata')::date) between current_date - 30 and current_date + 30)
                          and exists (select 1 from jsonb_array_elements(w -> 'tasks') t where t ->> 'title' = 'PLP prepare the renewal list' and t #>> '{lastReport,status}' = 'APPROVED'
                                        and (t #>> '{lastReport,progress}')::int = 55 and (t ->> 'reports')::int = 1)
                     from (select performance_member_work(test.id('tdr_m1'), current_date - 30, current_date + 30) w) x),
  'the Team Lead opens a member''s tasks with the latest report on each');
select test.must_fail(format($$select performance_member_work(%L, current_date, current_date - 1)$$, test.id('tdr_m1')), 'a period must be valid', 'period');
select test.must_fail(format($$select performance_member_work(%L, current_date - 30, current_date)$$, test.id('tdr_m2')), 'not another Team Lead''s member', 'not found');
select test.must_fail(format($$select performance_member_work(%L, current_date - 30, current_date)$$, test.id('tdr_tl1')), 'nor their own work here', 'not found');
select test.login('tdr_dha');
select test.check(jsonb_array_length(performance_member_work(test.id('tdr_m1'), current_date - 30, current_date + 30) -> 'tasks') >= 1
                  and (performance_member_work(test.id('tdr_tl1'), current_date - 30, current_date + 30) ->> 'role') = 'TEAM_HEAD', 'the Department Head opens a member''s and a Team Lead''s work');
select test.login('tdr_m1');
select test.must_fail(format($$select performance_member_work(%L, current_date - 30, current_date)$$, test.id('tdr_m1')), 'a member does not open their own (no performance view)', 'not found');
select test.login('tdr_dhb');
select test.must_fail(format($$select performance_member_work(%L, current_date - 30, current_date)$$, test.id('tdr_m1')), 'another department''s head cannot', 'not found');

\echo '   an ordinary department: a member without a Team Lead is decided by the Department Head'
reset role;
-- a team of its own that has no Team Lead
insert into teams (department_id, name, division) select d.id, 'PLP Unled', 'SALES' from departments d where d.slug = 'tdr-a';
select test.tdrmk('tdr_mx', 'TEAM_MEMBER', 'tdr-a', 'PLP Unled');
update profiles set manager_id = null where id = test.id('tdr_mx');
select test.check(private.direct_lead_of(test.id('tdr_mx')) is null and not private.dept_is_unified(test.dept('tdr-a')), 'a member of an ordinary department without a Team Lead');
with ins as (
  insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date)
  select p.department_id, p.team_id, 'PLP unled checklist', test.id('tdr_dha'), p.id, current_date + 2 from profiles p where p.id = test.id('tdr_mx')
  returning id) insert into plp select 'TX', id from ins;
set role authenticated;
select test.login('tdr_mx');
insert into plp select 'RX', (task_report_submit((select v from plp where k = 'TX'), current_date, 'Checked the first ten items', 30, 'Twenty items left') ->> 'id')::uuid;
select test.login('tdr_dha');
select test.check((task_report_reviewer_edit((select v from plp where k = 'RX'), 'Checked the first ten items carefully', 30, 'Twenty items left', null, null, 'Clarified the wording') ->> 'editedBy') is not null
                  and (task_report_review((select v from plp where k = 'RX'), 'APPROVE', null) ->> 'status') = 'APPROVED',
  'the Department Head stands in: edits and approves the report (International / Reseller keep waiting for a Team Lead)');

\echo '   a member''s record returned under the old rules goes back to Pending (the member can no longer resubmit it)'
reset role;
insert into performance_records (subject_id, subject_role, department_id, team_id, period_start, period_end, metrics, score, status)
select p.id, 'TEAM_MEMBER', p.department_id, p.team_id, date '2020-01-01', date '2020-01-31', '{}'::jsonb, 50, 'RETURNED' from profiles p where p.id = test.id('tdr_m1');
\i supabase/migrations/20270213000100_performance_lead_primary.sql
\i supabase/migrations/20270214000100_ai_studio_performance.sql
select test.check((select r.status = 'PENDING' and exists (select 1 from performance_record_history h where h.record_id = r.id and h.action = 'REOPENED')
                     from performance_records r where r.subject_id = test.id('tdr_m1') and r.period_start = date '2020-01-01'),
  'reopened for the Team Lead, with a REOPENED step in its history');
select test.check(not exists (select 1 from performance_records where subject_role = 'TEAM_MEMBER' and status = 'RETURNED'), 'no member record is left Returned');

\echo '   cleanup'
reset role;
select set_config('request.jwt.claims', '', false);
delete from task_daily_reports where task_id in (select id from work_tasks where title like 'PLP %');
delete from work_tasks where title like 'PLP %';
delete from performance_records where subject_id = test.id('tdr_mx') or (subject_id = test.id('tdr_m1') and period_start = date '2020-01-01');
delete from auth.users where email = 'tdr.mx@example.com';
delete from test.users where name = 'tdr_mx';
delete from teams where name = 'PLP Unled' and department_id = test.dept('tdr-a');
\echo '=== PERFORMANCE MANAGEMENT (EVERY DEPARTMENT) TESTS PASSED ==='
