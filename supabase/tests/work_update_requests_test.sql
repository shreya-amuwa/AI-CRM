-- =============================================================================
-- Work update requests (migration 20270116000100): a Department Head / Team Lead asks the employee a task is assigned to for a progress update.
-- Reuses the fixtures of weekly_report_routing_test.sql and task_hierarchy_test.sql (department wkr-a): Support Department Head wkr_dhp -> Team Leads
-- tsk_tl1 / tsk_tl2 (the same Support team, each with their own member: tsk_m1 is tl1's, tsk_m3 is tl2's); Sales head wkr_dhs, Sales Team Lead tsk_tls, Sales
-- member wkr_tms; another department wkr_dhb; Accounts dh_acc / acc_m; the Super Admin sa.
-- "42501" is the SQLSTATE the API turns into HTTP 403.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 141. Work update requests: Department Head / Team Lead ask, the employee answers'
reset role;
\i supabase/migrations/20270116000100_work_update_requests.sql
\i supabase/migrations/20270116000100_work_update_requests.sql

-- a clean slate for this suite (re-runnable): only the rows this suite makes
delete from work_tasks where title like 'WU %';
delete from notifications where title like '%WU %' or body like '%WU %';
create temp table wu (k text primary key, v uuid);
grant all on wu to authenticated;

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

\echo '   the existing assignment flow, unchanged: Department Head -> Team Lead -> Team Members'
set role authenticated;
select test.login('wkr_dhp');
insert into wu select 'T1', assign_task_to_team_lead(test.id('tsk_tl1'), 'WU Prepare the Q1 support plan', 'Targets per team', 'HIGH', current_date + 10);
insert into wu select 'T2', assign_task_to_team_lead(test.id('tsk_tl2'), 'WU Review the escalation backlog', 'All open ones', 'MEDIUM', current_date + 10);
select test.login('tsk_tl1');
select test.check((select delegate_task_to_members((select v from wu where k = 'T1'), jsonb_build_array(jsonb_build_object('memberId', test.id('tsk_m1'), 'work', 'Draft the WhatsApp section'))) = 1), 'Team Lead 1 gives their part to their Team Member');
select test.login('tsk_tl2');
select test.check((select delegate_task_to_members((select v from wu where k = 'T2'), jsonb_build_array(jsonb_build_object('memberId', test.id('tsk_m3'), 'work', 'Clear the e-mail escalations'))) = 1), 'Team Lead 2 gives theirs to their Team Member');
reset role;
insert into wu select 'CA', id from work_tasks where parent_id = (select v from wu where k = 'T1') and assignee_id = test.id('tsk_m1');
insert into wu select 'CB', id from work_tasks where parent_id = (select v from wu where k = 'T2') and assignee_id = test.id('tsk_m3');
select test.check((select count(*) = 2 from wu where k in ('CA', 'CB')), 'two member tasks hang under their Team Leads'' tasks');
-- an ordinary progress update the member made BEFORE this feature's first use: the history must keep it
set role authenticated;
select test.login('tsk_m1');
select submit_task_update((select v from wu where k = 'CA'), 'IN_PROGRESS', 30, 'Collected last year''s numbers');
reset role;
create temp table before_state (k text primary key, h text);
insert into before_state select 'CA', md5(t::text) from work_tasks t where id = (select v from wu where k = 'CA');
insert into before_state select 'T1', md5(t::text) from work_tasks t where id = (select v from wu where k = 'T1');

\echo '   1. the Department Head asks the Team Lead; 2. and a Team Member below'
set role authenticated;
select test.login('wkr_dhp');
select test.check((select work_update_request((select v from wu where k = 'T1'), 'WU What is the current progress on the plan?', now() + interval '2 days') ->> 'status' = 'PENDING'),
  'the Department Head can request an update from their Team Lead');
insert into wu select 'R_T1', (x ->> 'id')::uuid from (select work_update_list('PENDING') -> 'items' -> 0 x) s;
select test.check((select work_update_request((select v from wu where k = 'CB'), 'WU Any blockers on your part?') ->> 'requestedFromName' = 'TSK m3'),
  'and from a Team Member in their hierarchy');
insert into wu select 'R_CB', (x ->> 'id')::uuid from jsonb_array_elements(work_update_list('PENDING') -> 'items') x where x ->> 'taskId' = (select v::text from wu where k = 'CB');
select test.must_fail($$select work_update_request((select v from wu where k = 'T1'), 'WU again')$$, 'no second request while one is waiting (no duplicates)', 'already requested');

\echo '   3. the Team Lead asks their Team Member'
select test.login('tsk_tl1');
select test.check((select work_update_request((select v from wu where k = 'CA'), 'WU When do you expect to finish?', now() + interval '1 day') ->> 'requestedFromName' = 'TSK m1'),
  'the Team Lead can request an update from a Team Member of their team');
insert into wu select 'R_CA', (x ->> 'id')::uuid from jsonb_array_elements(work_update_list('PENDING') -> 'items') x where x ->> 'taskId' = (select v::text from wu where k = 'CA');
select test.must_fail_state($$select work_update_request((select v from wu where k = 'T1'), 'WU ask myself')$$, 'a Team Lead cannot request an update on their own task', '42501');
reset role;
select test.check((select requested_by = test.id('tsk_tl1') and requested_from = test.id('tsk_m1') and task_id = (select v from wu where k = 'CA') and status = 'PENDING' and due_at is not null
                     from work_update_requests where id = (select v from wu where k = 'R_CA')), 'the request is linked to the task, the requester and the employee (from the task, not the caller)');

\echo '   4. the employee is notified, once, and it opens the task'
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'WORK_UPDATE_REQUESTED' and entity_type = 'work_task'
                            and entity_id = (select v from wu where k = 'CA') and (data ->> 'requestId')::uuid = (select v from wu where k = 'R_CA')
                            and body like '%WU When do you expect to finish?%'), 'TSK m1 is notified of the request (task and request ids in the notification)');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_tl1') and type = 'WORK_UPDATE_REQUESTED' and entity_id = (select v from wu where k = 'T1')),
  'the Team Lead is notified of the Department Head''s request');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('wkr_dhp') and type like 'WORK_UPDATE%'), 'the requester is not notified of their own request');

\echo '   9, 10. nobody outside the hierarchy asks, and nobody answers for someone else'
set role authenticated;
do $$
declare
  r text;
begin
  foreach r in array array['wkr_dhb', 'tsk_tl2', 'tsk_tls', 'wkr_dhs', 'wkr_tms', 'dh_acc', 'acc_m', 'tsk_m3', 'tsk_m1', 'sa'] loop
    perform test.login(r);
    perform test.must_fail_state(format('select work_update_request(%L, %L)', (select v from wu where k = 'CA'), 'WU not allowed'), r || ' cannot request an update on this task', '42501');
  end loop;
end $$;
select test.login('tsk_tl2');
select test.must_fail_state($$select work_update_request((select v from wu where k = 'CA'), 'WU the other Team Lead')$$, 'the other Team Lead of the same team cannot ask about Team Lead 1''s member', '42501');
select test.login('tsk_m3');
select test.must_fail_state($$select work_update_respond((select v from wu where k = 'R_CA'), 'I answer for TSK m1')$$, 'TSK m3 cannot answer TSK m1''s request', '42501');
select test.login('tsk_tl1');
select test.must_fail_state($$select work_update_respond((select v from wu where k = 'R_CA'), 'the requester answers')$$, 'the requester cannot answer it either', '42501');
select test.login('wkr_dhp');
select test.must_fail_state($$select work_update_respond((select v from wu where k = 'R_CA'), 'the Department Head answers')$$, 'nor the Department Head', '42501');

\echo '   follow-up: a reminder, not a second request; never more than once an hour'
select test.login('wkr_dhp');
select test.must_fail($$select work_update_follow_up((select v from wu where k = 'R_CB'), 'WU any news?')$$, 'a reminder straight after the request is refused', 'less than an hour');
select test.login('tsk_m3');
select test.must_fail_state($$select work_update_follow_up((select v from wu where k = 'R_CB'))$$, 'an employee cannot send a reminder', '42501');
select test.login('wkr_dhb');
select test.must_fail_state($$select work_update_follow_up((select v from wu where k = 'R_CB'))$$, 'nor a head of another department', '42501');
reset role;
update work_update_requests set last_notified_at = now() - interval '2 hours' where id = (select v from wu where k = 'R_CB');   -- an hour has passed
set role authenticated;
select test.login('wkr_dhp');
select test.check((select (work_update_follow_up((select v from wu where k = 'R_CB'), 'WU any news?') ->> 'followupCount')::integer = 1), 'the requester sends a follow-up after an hour');
select test.must_fail($$select work_update_follow_up((select v from wu where k = 'R_CB'))$$, 'and not a second one at once', 'less than an hour');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m3') and type = 'WORK_UPDATE_FOLLOW_UP' and title like 'Reminder 1:%' and priority = 'urgent'
                            and (data ->> 'requestId')::uuid = (select v from wu where k = 'R_CB')), 'the employee is notified of the follow-up (once)');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m3') and type = 'WORK_UPDATE_REQUESTED'), 'and there is still one request notification (no duplicate)');
select test.check((select count(*) = 1 from work_update_requests where task_id = (select v from wu where k = 'CB')), 'a follow-up is not a new request');
update work_update_requests set followup_count = 5, last_notified_at = now() - interval '3 hours' where id = (select v from wu where k = 'R_CB');
set role authenticated;
select test.login('wkr_dhp');
select test.must_fail($$select work_update_follow_up((select v from wu where k = 'R_CB'))$$, 'at most five reminders', 'Five reminders');
reset role;
update work_update_requests set followup_count = 1 where id = (select v from wu where k = 'R_CB');

\echo '   5. the employee answers; 8. the task is NOT changed'
set role authenticated;
select test.login('tsk_m1');
select test.check((select jsonb_array_length(work_update_my_requests() -> 'items') = 1 and (work_update_my_requests() ->> 'pending')::integer = 1), 'the employee sees the one request sent to them');
select test.check((select x ->> 'taskTitle' = 'WU Prepare the Q1 support plan' and x ->> 'requestedByName' = 'TSK tl1' and x ->> 'message' like '%When do you expect%'
                          and x ->> 'taskStatus' = 'IN_PROGRESS' and x ->> 'dueAt' is not null and x ->> 'taskDescription' = 'Targets per team' and x ->> 'createdAt' is not null
                     from jsonb_array_elements(work_update_my_requests() -> 'items') x),
  'with the task title, description, requester, date, message, deadline and current status');
select test.must_fail($$select work_update_respond((select v from wu where k = 'R_CA'), '  ')$$, 'an empty answer is refused', 'current progress');
select test.must_fail($$select work_update_respond((select v from wu where k = 'R_CA'), 'Halfway', null, null, null, current_date - 3)$$, 'an expected date in the past is refused', 'expected completion');
select test.check((select work_update_respond((select v from wu where k = 'R_CA'), 'Targets are 60% drafted', 'Collected last years numbers; drafted 3 of 5 regions', 'Two regions and the review',
                         'Waiting for the Pune figures', current_date + 4) ->> 'status' = 'RESPONDED'),
  'the employee submits a progress update (without completing the task)');
select test.must_fail($$select work_update_respond((select v from wu where k = 'R_CA'), 'twice')$$, 'an update is sent once per request', 'already sent');
reset role;
select test.check((select h = (select md5(t::text) from work_tasks t where id = (select v from wu where k = 'CA')) from before_state where k = 'CA'),
  'the task row is exactly as before: status, progress and dates are unchanged by a work update');
select test.check((select status = 'IN_PROGRESS' and progress = 30 and completed_at is null from work_tasks where id = (select v from wu where k = 'CA')), 'it is not completed and its progress is the one the member set');
select test.check((select count(*) = 1 from work_update_responses where request_id = (select v from wu where k = 'R_CA') and responder_id = test.id('tsk_m1')
                    and blockers = 'Waiting for the Pune figures' and expected_completion = current_date + 4), 'the answer is stored with the blockers and the expected date');

\echo '   6. the requester is notified, once, when it is submitted'
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_tl1') and type = 'WORK_UPDATE_SUBMITTED' and entity_id = (select v from wu where k = 'CA')
                            and priority = 'urgent' and (data ->> 'requestId')::uuid = (select v from wu where k = 'R_CA') and body like '%Waiting for the Pune figures%'),
  'the Team Lead is notified of TSK m1''s update (urgent because of a blocker)');
select test.check((select count(*) = 0 from notifications where recipient_id = test.id('wkr_dhp') and type = 'WORK_UPDATE_SUBMITTED' and entity_id = (select v from wu where k = 'CA')),
  'the Department Head, who did not ask on this task, is not notified');

\echo '   7. it appears under the right task, with the history kept'
set role authenticated;
select test.login('tsk_tl1');
select test.check((select (x ->> 'canManage')::boolean and jsonb_array_length(x -> 'requests') = 1
                          and x -> 'requests' -> 0 -> 'response' ->> 'progress' = 'Targets are 60% drafted' and x -> 'requests' -> 0 -> 'response' ->> 'remainingWork' = 'Two regions and the review'
                     from (select work_update_for_task((select v from wu where k = 'CA')) x) s),
  'the requester reads the update in the task details');
select test.check((select string_agg(e ->> 'kind', ',' order by ord) = 'TASK_ASSIGNED,TASK_UPDATE,WORK_UPDATE_REQUESTED,WORK_UPDATE_RESPONDED'
                     from (select e, ord from jsonb_array_elements(work_update_for_task((select v from wu where k = 'CA')) -> 'timeline') with ordinality as t(e, ord)) s),
  'the timeline keeps the assignment, the member''s earlier update, the request and the answer, in order');
select test.check((select x ->> 'note' = 'Collected last year''s numbers' from jsonb_array_elements(work_update_for_task((select v from wu where k = 'CA')) -> 'timeline') x where x ->> 'kind' = 'TASK_UPDATE'),
  'the existing task history is preserved');
select test.login('wkr_tms');
select test.must_fail($$select work_update_for_task((select v from wu where k = 'CA'))$$, 'an unrelated employee cannot open the task''s updates', 'NOT_FOUND');
select test.login('tsk_m3');
select test.must_fail($$select work_update_for_task((select v from wu where k = 'CA'))$$, 'nor a colleague on the same team', 'NOT_FOUND');

\echo '   a new request on the same task after the answer; the earlier notification is not duplicated'
select test.login('tsk_tl1');
select test.check((select (x ->> 'canRequest')::boolean from (select work_update_for_task((select v from wu where k = 'CA')) x) s), 'once answered, a new request may be sent');
select test.check((select work_update_request((select v from wu where k = 'CA'), 'WU When do you expect to finish?') ->> 'status' = 'PENDING'), 'the requester asks again with the same words');
reset role;
select test.check((select count(*) = 2 from notifications where recipient_id = test.id('tsk_m1') and type = 'WORK_UPDATE_REQUESTED' and entity_id = (select v from wu where k = 'CA')),
  'a request with different details is a new notification');

\echo '   existing task flow after the feature: status transitions are as they were'
set role authenticated;
select test.login('tsk_m1');
select submit_task_update((select v from wu where k = 'CA'), 'COMPLETED', 100, 'All regions finished');
reset role;
select test.check((select status = 'COMPLETED' and progress = 100 and completed_at is not null from work_tasks where id = (select v from wu where k = 'CA')), 'a member still completes the task with the existing update');
set role authenticated;
select test.login('tsk_tl1');
select test.must_fail($$select work_update_request((select v from wu where k = 'CA'))$$, 'a completed task needs no update request', 'already completed');
select test.login('tsk_m1');
select test.must_fail_state($$select work_update_respond((select v from wu where k = 'R_CB'), 'not mine')$$, 'a member still cannot answer a colleague''s request', '42501');

\echo '   a blocker, an overdue request, and the lists'
select test.login('tsk_m3');
select test.check((select work_update_respond((select v from wu where k = 'R_CB'), 'Started the pipeline section', null, 'Most of it', 'Need the price list') ->> 'status' = 'RESPONDED'), 'TSK m3 answers the Department Head''s request');
select test.login('tsk_tl1');
select test.check((select work_update_respond((select v from wu where k = 'R_T1'), 'Plan is in progress; two member sections done') ->> 'status' = 'RESPONDED'), 'the Team Lead answers the Department Head as the employee');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('wkr_dhp') and type = 'WORK_UPDATE_SUBMITTED' and entity_id = (select v from wu where k = 'T1')), 'the Department Head is told of the Team Lead''s update');
set role authenticated;
select test.login('wkr_dhp');
select test.check((select work_update_request((select v from wu where k = 'CB'), 'WU Please confirm the price list', now() + interval '1 day') ->> 'status' = 'PENDING'), 'a request with a response deadline');
reset role;
update work_update_requests set due_at = now() - interval '1 hour', created_at = now() - interval '2 days' where task_id = (select v from wu where k = 'CB') and status = 'PENDING';
set role authenticated;
select test.login('wkr_dhp');
select test.check((work_update_list('OVERDUE') -> 'counts' ->> 'overdue')::integer = 1 and jsonb_array_length(work_update_list('OVERDUE') -> 'items') = 1, 'the Overdue filter finds the request that passed its deadline');
select test.check((work_update_list('ALL') -> 'counts' ->> 'pending')::integer = 2 and (work_update_list('ALL') -> 'counts' ->> 'responded')::integer >= 3, 'the Department Head sees the pending and responded counts');
select test.check((select bool_and(x ->> 'status' = 'RESPONDED') and count(*) >= 3 from jsonb_array_elements(work_update_list('RESPONDED') -> 'items') x), 'the Responded filter');
select test.check((select bool_and(x ->> 'status' = 'PENDING') and count(*) = 2 from jsonb_array_elements(work_update_list('PENDING') -> 'items') x), 'the Pending filter');
select test.check((select bool_and(x ->> 'requestedFromName' is not null and x ->> 'taskTitle' is not null and x ->> 'createdAt' is not null)
                     from jsonb_array_elements(work_update_list('ALL') -> 'items') x), 'each row has the employee, the task and the request date');
select test.check((select bool_or(x -> 'response' ->> 'blockers' = 'Need the price list' and x ->> 'respondedAt' is not null) from jsonb_array_elements(work_update_list('RESPONDED') -> 'items') x
                    where x ->> 'requestedFromName' = 'TSK m3'), 'responded rows show the response date, the progress and the blockers');
select test.must_fail($$select work_update_list('NONSENSE')$$, 'an unknown filter is refused', 'ALL, PENDING');
select test.login('tsk_tl1');
select test.check((select count(*) = 0 from jsonb_array_elements(work_update_list('ALL') -> 'items') x where x ->> 'taskId' = (select v::text from wu where k = 'T1')),
  'the Team Lead''s list does not include requests about their own task');
select test.check((select count(*) >= 1 from jsonb_array_elements(work_update_list('ALL') -> 'items') x where x ->> 'requestedFromName' = 'TSK m1')
                   and (select count(*) = 0 from jsonb_array_elements(work_update_list('ALL') -> 'items') x where x ->> 'requestedFromName' = 'TSK m3'),
  'but does include their own Team Member''s (and not the other Team Lead''s member)');
select test.login('wkr_dhb');
select test.check((work_update_list('ALL') -> 'counts' ->> 'all')::integer = 0, 'a Department Head of another department sees none of it');
select test.login('tsk_m1');
select test.check((work_update_list('ALL') -> 'counts' ->> 'all')::integer = 0 and jsonb_array_length(work_update_list('ALL') -> 'items') = 0, 'a Team Member has no management list');
select test.login('sa');
select test.check((work_update_list('ALL') -> 'counts' ->> 'all')::integer >= 4, 'the Super Admin can read them all');
select test.must_fail_state($$select work_update_follow_up((select v from wu where k = 'R_CB'))$$, 'but cannot send a reminder', '42501');

\echo '   skip-level: a task the Department Head gave straight to a Team Member; their Team Lead may ask'
select test.login('wkr_dhp');
insert into wu select 'D', assign_task_direct(test.id('tsk_m1'), 'WU Direct task from the head', 'Straight to the member', 'MEDIUM', current_date + 3);
select test.login('tsk_tl1');
select test.check((select work_update_request((select v from wu where k = 'D'), 'WU How is the direct task going?') ->> 'requestedFromName' = 'TSK m1'), 'the Team Lead of that member can ask about it');
select test.login('tsk_tl2');
select test.must_fail_state($$select work_update_request((select v from wu where k = 'D'), 'WU nope')$$, 'the other Team Lead of the same team cannot', '42501');
-- the same words twice: the first notification is still unread, so the second is not sent
reset role;
insert into wu select 'RD', id from work_update_requests where task_id = (select v from wu where k = 'D') and status = 'PENDING';
set role authenticated;
select test.login('tsk_m1');
select work_update_respond((select v from wu where k = 'RD'), 'Halfway on the direct task');
select test.login('tsk_tl1');
select work_update_request((select v from wu where k = 'D'), 'WU How is the direct task going?');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tsk_m1') and type = 'WORK_UPDATE_REQUESTED' and entity_id = (select v from wu where k = 'D') and read_at is null),
  'two requests with the same words while the first is unread send ONE notification (no duplicates)');
select test.check((select count(*) = 2 from work_update_requests where task_id = (select v from wu where k = 'D')), 'but both requests are recorded');
set role authenticated;

\echo '   nothing is writable directly, and the history cannot be changed'
select test.login('tsk_m1');
select test.must_fail($$update work_update_responses set progress_summary = 'edited' where task_id = (select v from wu where k = 'CA')$$, 'an employee cannot edit a submitted update');
select test.must_fail($$delete from work_update_events where task_id = (select v from wu where k = 'CA')$$, 'nor delete the history');
select test.must_fail($$insert into work_update_requests (task_id, requested_by, requested_from) values ((select v from wu where k = 'D'), test.id('tsk_m1'), test.id('tsk_m1'))$$, 'nor write a request directly');
select test.must_fail($$select * from work_update_responses$$, 'nor read the tables directly (only the functions answer)');
reset role;
select test.must_fail($$update work_update_responses set progress_summary = 'edited' where task_id = (select v from wu where k = 'CA')$$, 'even the owner cannot edit a submitted update', 'cannot be changed');
select test.must_fail($$update work_update_events set note = 'x'$$, 'or the history', 'cannot be changed');
select test.must_fail($$delete from work_update_events where task_id = (select v from wu where k = 'CA')$$, 'or delete it', 'cannot be changed');
select test.check((select count(*) >= 6 from work_update_events where task_id in (select v from wu where k in ('T1', 'CA', 'CB'))), 'all the requests, reminders and answers are in the history');
select test.check((select count(*) >= 4 from audit_logs where action in ('WORK_UPDATE_REQUESTED', 'WORK_UPDATE_FOLLOW_UP', 'WORK_UPDATE_SUBMITTED')), 'they are in the audit log too');

-- tidy up this suite
delete from work_tasks where title like 'WU %';
delete from notifications where title like '%WU %' or body like '%WU %';
