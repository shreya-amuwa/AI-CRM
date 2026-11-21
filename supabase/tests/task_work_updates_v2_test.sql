-- =============================================================================
-- Task management v2 (migration 20270117000100): the Urgent priority, structured work updates with a preserved history, and work_task_details.
-- Reuses weekly_report_routing_test.sql and task_hierarchy_test.sql (department wkr-a): Support Department Head wkr_dhp -> Team Leads tsk_tl1 / tsk_tl2
-- (one Support team, each with their own member: tsk_m1 is tl1's, tsk_m3 is tl2's); Sales head wkr_dhs; another department wkr_dhb; Accounts dh_acc / acc_m; sa.
-- "42501" is the SQLSTATE the API turns into HTTP 403.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 142. Task management v2: structured work updates, history, details'
reset role;
-- what exists before this migration is re-applied: it must be exactly the same afterwards (nothing is changed or deleted)
create temp table baseline as select (select count(*) from work_tasks) tasks, (select count(*) from work_task_updates) updates, (select count(*) from work_update_requests) requests;
\i supabase/migrations/20270117000100_task_work_updates_v2.sql
\i supabase/migrations/20270117000100_task_work_updates_v2.sql
select test.check((select tasks = (select count(*) from work_tasks) and updates = (select count(*) from work_task_updates) and requests = (select count(*) from work_update_requests) from baseline),
  'the migration runs twice and no existing task, update or request is changed or deleted');

delete from work_tasks where title like 'TW %';
delete from notifications where title like '%TW %' or body like '%TW %';
create temp table tw (k text primary key, v uuid);
grant all on tw to authenticated;
create or replace function test.must_fail_state(p_sql text, p_label text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise exception 'TEST FAILED: % (SQLSTATE % instead of %: %)', p_label, sqlstate, p_state, sqlerrm; end if;
    raise notice 'ok - % [%]', p_label, sqlstate;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;
grant execute on function test.must_fail_state(text, text, text) to authenticated;
-- a function that tries to rewrite history behind the checks (as a future mistake could)
create or replace function test.sneaky_history(p_sql text) returns void language plpgsql security definer set search_path = '' as $$
begin execute p_sql; end $$;
grant execute on function test.sneaky_history(text) to authenticated;

\echo '   1-6. assignment: Department Head -> Team Lead -> Team Member (the existing flow), with the Urgent priority'
set role authenticated;
select test.login('wkr_dhp');
insert into tw select 'T1', assign_task_to_team_lead(test.id('tsk_tl1'), 'TW Prepare the support playbook', 'Cover every escalation path', 'URGENT', current_date + 6);
select test.must_fail($$select assign_task_to_team_lead(test.id('tsk_tl1'), 'TW Bad priority', null, 'CRITICAL', null)$$, 'an unknown priority is still refused', 'Unknown priority');
select test.check((select priority = 'URGENT' from work_tasks where id = (select v from tw where k = 'T1')), 'the Department Head creates an Urgent task for their Team Lead');
select test.login('tsk_tl1');
select test.check((select count(*) = 1 from work_tasks where id = (select v from tw where k = 'T1')), 'the Team Lead sees it');
select test.check((select delegate_task_to_members((select v from tw where k = 'T1'), jsonb_build_array(jsonb_build_object('memberId', test.id('tsk_m1'), 'work', 'Draft the WhatsApp escalation path'))) = 1),
  'the Team Lead gives their part to their Team Member');
select test.check((select assign_team_task('TW Follow up the open tickets', 'Call each customer', 'URGENT', current_date + 2, null, array[test.id('tsk_m1')]) = 1), 'a Team Lead''s own Urgent task for a member works too');
select test.login('wkr_dhp');
insert into tw select 'D', assign_task_direct(test.id('tsk_m1'), 'TW Direct urgent task', 'Straight to the member', 'URGENT', current_date + 3);
reset role;
insert into tw select 'C1', id from work_tasks where parent_id = (select v from tw where k = 'T1') and assignee_id = test.id('tsk_m1');
insert into tw select 'C2', id from work_tasks where title = 'TW Follow up the open tickets' and assignee_id = test.id('tsk_m1');
select test.check((select count(*) = 3 from notifications where recipient_id = test.id('tsk_m1') and type = 'TASK_ASSIGNED' and title like '%TW %'), 'the Team Member is notified of each new task (once each)');
set role authenticated;
select test.login('tsk_m1');
select test.check((select count(*) = 3 from work_tasks where title like 'TW %' and assignee_id = test.id('tsk_m1')), 'the Team Member sees their tasks');
select test.check((select count(*) = 0 from work_tasks where id = (select v from tw where k = 'T1')), 'but not the Team Lead''s own task above theirs');

\echo '   7-9. the Team Member starts and submits a 25% update; the Team Lead sees it'
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 25)$$, 'an empty update is refused', 'Describe the work completed');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 25, 'done')$$, 'a meaningless one too', 'at least 10');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 140, 'Drafted the first section of the path')$$, 'a progress above 100 is refused', 'percentage');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 100, 'Drafted the first section of the path')$$, 'a task cannot be 100% and still in progress', 'Choose Completed');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'COMPLETED', 80, 'Drafted the whole escalation path')$$, 'nor Completed at less than 100% (the status alone never sets the progress)', '100%');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'BLOCKED', 25, 'Drafted the first part')$$, 'Blocked must explain the blocker', 'blocking');
select test.check((select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 25, 'Drafted the first section of the WhatsApp path', 'Two sections and a review', null,
                          'Draft the e-mail path', current_date + 5) ->> 'progress' = '25'), 'the Team Member submits a 25% work update');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 25, 'Drafted the first section of the WhatsApp path')$$, 'the same update twice is refused', 'same as your last update');
select test.login('tsk_tl1');
select test.check((select (x -> 'task' ->> 'progress')::integer = 25 and x -> 'task' ->> 'status' = 'IN_PROGRESS' and x -> 'updates' -> 0 ->> 'workCompleted' = 'Drafted the first section of the WhatsApp path'
                          and x -> 'updates' -> 0 ->> 'remainingWork' = 'Two sections and a review' and x -> 'updates' -> 0 ->> 'nextSteps' = 'Draft the e-mail path'
                          and x -> 'updates' -> 0 ->> 'authorName' = 'TSK m1' and x -> 'task' -> 'assignee' ->> 'name' = 'TSK m1' and x -> 'task' ->> 'priority' = 'HIGH' is not null
                     from (select work_task_details((select v from tw where k = 'C1')) x) s),
  'the Team Lead sees 25% and the update''s details (what was done, what remains, next steps, who)');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_tl1') and type = 'WORK_UPDATE_SUBMITTED' and entity_id = (select v from tw where k = 'C1')
                            and title like '%25%'), 'the Team Lead is notified of the update, once');
select test.check((select progress = 25 and status = 'IN_PROGRESS' and last_update_at is not null and last_update_note like 'Drafted the first section%' from work_tasks where id = (select v from tw where k = 'C1')),
  'the task shows 25%, in progress, its latest update time and note');

\echo '   10-14. the Team Lead requests another update; the Team Member answers it with a blocker; both are in the history'
set role authenticated;
select test.login('tsk_tl1');
select test.check((select work_update_request((select v from tw where k = 'C1'), 'TW What is the current progress? Any blockers?') ->> 'status' = 'PENDING'), 'the Team Lead requests another update');
reset role;
insert into tw select 'REQ', id from work_update_requests where task_id = (select v from tw where k = 'C1') and status = 'PENDING';
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'WORK_UPDATE_REQUESTED' and entity_id = (select v from tw where k = 'C1')), 'the Team Member is notified');
set role authenticated;
select test.login('tsk_m1');
select test.must_fail_state($$select submit_work_update((select v from tw where k = 'C2'), 'IN_PROGRESS', 20, 'Called the first customers on the list', null, null, null, null, (select v from tw where k = 'REQ'))$$,
  'an answer to a request on another task is refused', '42501');
select test.check((select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 40, 'Finished the WhatsApp path and started the e-mail path', 'The review and the sign-off',
                          'Waiting for the escalation matrix from the Pune office', 'Review with the Team Lead', current_date + 4, (select v from tw where k = 'REQ')) ->> 'requestId' is not null),
  'the Team Member responds to the request with progress and blockers');
select test.must_fail_state($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 45, 'Added the first review comments', null, null, null, null, (select v from tw where k = 'REQ'))$$,
  'a request is answered once', 'P0001');
reset role;
select test.check((select status = 'RESPONDED' and responded_at is not null from work_update_requests where id = (select v from tw where k = 'REQ')), 'the request is marked answered');
select test.check((select count(*) = 1 from work_update_responses where request_id = (select v from tw where k = 'REQ') and blockers like 'Waiting for the escalation matrix%'), 'the response is linked to the request');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_tl1') and type = 'WORK_UPDATE_SUBMITTED' and entity_id = (select v from tw where k = 'C1') and title like '%40%'
                            and priority = 'urgent'), 'the Team Lead is notified of the answer (urgent: it has a blocker)');
set role authenticated;
select test.login('tsk_tl1');
select test.check((select string_agg(e ->> 'kind', ',' order by ord) = 'TASK_CREATED,TASK_ASSIGNED,PROGRESS_UPDATE,WORK_UPDATE_REQUESTED,PROGRESS_UPDATE,WORK_UPDATE_RESPONDED'
                     from (select e, ord from jsonb_array_elements(work_task_details((select v from tw where k = 'C1')) -> 'timeline') with ordinality as t(e, ord)) s),
  'the timeline shows the task created and assigned, the update, the request, the answer');
select test.check((select x -> 'requests' -> 0 ->> 'status' = 'RESPONDED' and x -> 'requests' -> 0 -> 'response' ->> 'blockers' like 'Waiting for the escalation%'
                     from (select work_task_details((select v from tw where k = 'C1')) x) s), 'the request and the employee''s response are in the task details');

\echo '   15-16. another update; the whole progress history is kept'
select test.login('tsk_m1');
select test.check((select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 60, 'Received the matrix and finished the e-mail path', 'Only the final review', null, 'Submit for sign-off', current_date + 2) ->> 'progress' = '60'),
  'the Team Member submits another update');
select test.login('tsk_tl1');
select test.check((select jsonb_array_length(x -> 'updates') = 3 and (x -> 'updates' -> 0 ->> 'progress') = '60' and (x -> 'updates' -> 1 ->> 'progress') = '40' and (x -> 'updates' -> 2 ->> 'progress') = '25'
                          and x -> 'updates' -> 2 ->> 'workCompleted' like 'Drafted the first section%'
                     from (select work_task_details((select v from tw where k = 'C1')) x) s), 'all three updates are in the history, newest first, the first one unchanged');

\echo '   blocked: the Team Member says so; the Team Lead and the Department Head are told'
select test.login('tsk_m1');
select test.check((select submit_work_update((select v from tw where k = 'C2'), 'BLOCKED', 10, null, null, 'The customer list has no phone numbers for half the accounts', 'Ask support for the numbers') ->> 'status' = 'BLOCKED'),
  'the Team Member marks a task blocked with the reason');
reset role;
select test.check((select progress = 10 and status = 'BLOCKED' from work_tasks where id = (select v from tw where k = 'C2')), 'the task is blocked at the progress given, not at a made-up one');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_tl1') and type = 'TASK_BLOCKED' and entity_id = (select v from tw where k = 'C2') and priority = 'urgent'),
  'the Team Lead is told it is blocked');

\echo '   17-19. completion: a final update'
set role authenticated;
select test.login('tsk_m1');
select test.check((select submit_work_update((select v from tw where k = 'C1'), 'COMPLETED', 100, 'Final review done and the playbook signed off', null, null, null, null) ->> 'status' = 'COMPLETED'),
  'the Team Member completes the work with a final update at 100%');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C1'), 'IN_PROGRESS', 90, 'Trying to add more work after completion')$$, 'a completed task takes no more updates', 'already completed');
reset role;
select test.check((select status = 'COMPLETED' and progress = 100 and completed_at is not null from work_tasks where id = (select v from tw where k = 'C1')), 'the task is completed at 100%');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_tl1') and type = 'TASK_COMPLETED' and entity_id = (select v from tw where k = 'C1')), 'the Team Lead is told it is completed');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('wkr_dhp') and type = 'TASK_COMPLETED' and entity_id = (select v from tw where k = 'C1')), 'and so is the Department Head above them');
set role authenticated;
select test.login('wkr_dhp');
select test.check((select x -> 'task' ->> 'status' = 'COMPLETED' and x -> 'updates' -> 0 ->> 'workCompleted' like 'Final review done%' and jsonb_array_length(x -> 'updates') = 4
                          and x -> 'task' ->> 'completedAt' is not null and (x -> 'task' -> 'assignedBy' ->> 'name') = 'TSK tl1'
                     from (select work_task_details((select v from tw where k = 'C1')) x) s), 'the Department Head sees the completion and the whole history');

\echo '   overdue is calculated, never set by the employee'
reset role;
update work_tasks set due_date = current_date - 3 where id = (select v from tw where k = 'C2');
set role authenticated;
select test.login('tsk_tl1');
select test.check((select (x -> 'task' ->> 'overdue')::boolean and (x -> 'task' ->> 'blocked')::boolean from (select work_task_details((select v from tw where k = 'C2')) x) s), 'a blocked task past its due date is overdue and blocked');
select test.check((select not (x -> 'task' ->> 'overdue')::boolean from (select work_task_details((select v from tw where k = 'C1')) x) s), 'a completed task is never overdue');
select test.login('tsk_m1');
select test.must_fail($$select submit_work_update((select v from tw where k = 'C2'), 'OVERDUE', 10, 'Marking it overdue myself, just to see')$$, 'an employee cannot set a status of "overdue"', 'Choose In progress');

\echo '   20-24. security: nobody reaches or changes what is not theirs'
select test.login('tsk_m3');
select test.must_fail($$select work_task_details((select v from tw where k = 'C2'))$$, 'the other Team Lead''s member cannot open the task', 'NOT_FOUND');
select test.must_fail_state($$select submit_work_update((select v from tw where k = 'C2'), 'IN_PROGRESS', 50, 'Pretending to be the assignee of this task')$$, 'nor submit an update on it', '42501');
select test.login('tsk_tl2');
select test.must_fail($$select work_task_details((select v from tw where k = 'C2'))$$, 'the other Team Lead of the same team cannot open it', 'NOT_FOUND');
select test.must_fail_state($$select work_update_request((select v from tw where k = 'C2'), 'TW not mine')$$, 'nor request an update on it', '42501');
select test.login('wkr_dhb');
select test.must_fail($$select work_task_details((select v from tw where k = 'C2'))$$, 'a Department Head of another department cannot', 'NOT_FOUND');
select test.login('wkr_dhs');
select test.must_fail($$select work_task_details((select v from tw where k = 'C2'))$$, 'nor the Sales head for a Support team''s task', 'NOT_FOUND');
select test.login('acc_m');
select test.must_fail($$select work_task_details((select v from tw where k = 'C2'))$$, 'nor Accounts', 'NOT_FOUND');
select test.login('tsk_tl1');
select test.must_fail_state($$select submit_work_update((select v from tw where k = 'C2'), 'IN_PROGRESS', 50, 'The Team Lead is not the assignee of this task')$$, 'a Team Lead cannot submit a member''s update for them', '42501');
select test.login('tsk_m1');
select test.must_fail($$update work_task_updates set progress = 99 where task_id = (select v from tw where k = 'C1')$$, 'an employee cannot edit an update');
select test.must_fail($$delete from work_task_updates where task_id = (select v from tw where k = 'C1')$$, 'nor delete one');
select test.must_fail($$select test.sneaky_history($s$update public.work_task_updates set progress = 99 where task_id = (select v from pg_temp.tw where k = 'C1')$s$)$$, 'a function acting for them cannot rewrite history either', 'cannot be changed');
select test.must_fail($$select test.sneaky_history($s$delete from public.work_task_updates$s$)$$, 'or delete it', 'cannot be changed');
select test.login('sa');
select test.check((select jsonb_array_length(x -> 'updates') = 4 from (select work_task_details((select v from tw where k = 'C1')) x) s), 'the Super Admin can read the history');

\echo '   25-28. the existing flow is unchanged'
select test.login('tsk_m1');
select submit_task_update((select v from tw where k = 'D'), 'IN_PROGRESS', 30, 'Started with the existing form');
reset role;
select test.check((select status = 'IN_PROGRESS' and progress = 30 from work_tasks where id = (select v from tw where k = 'D')), 'with its existing status and progress rules');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('wkr_dhp') and type = 'TASK_UPDATE' and entity_id = (select v from tw where k = 'D')), 'and its existing notification');
select test.check((select count(*) = 1 from work_task_updates where task_id = (select v from tw where k = 'D') and work_completed is null and note = 'Started with the existing form'), 'an old-style update is kept in the same history, without the new details');
set role authenticated;
select test.login('wkr_dhp');
select test.must_fail($$select assign_task_to_team_lead(test.id('tsk_tls'), 'TW cross team', null, 'LOW', null)$$, 'a Department Head still cannot assign outside their function', 'Support teams only|team lead');
select test.must_fail($$select assign_task_to_team_lead(test.id('tsk_m1'), 'TW to a member', null, 'LOW', null)$$, 'or give a task to the wrong level', 'Support teams only|team lead');
reset role;

-- tidy up this suite
delete from work_tasks where title like 'TW %';
delete from notifications where title like '%TW %' or body like '%TW %';
