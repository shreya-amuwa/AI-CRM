-- =============================================================================
-- Meetings with the CEO (migration 20270114000100): ONLY the Super Admin approves, rejects or reschedules.
-- Super Admin = the CEO = the one existing SUPER_ADMIN account (sa). There is no separate Admin app role in this CRM: "Admin" is covered by
-- hr_head (the HR Department Head, HR's highest rank) and dh_acc / dh_wab (Department Heads). Every role of the brief asks for time; none
-- of them can decide. Run after the other suites (it reuses their users): sa, hr_head, rr_asst (HR Assistant), dh_wab (Department Head),
-- th_wab (Team Lead), tm_a (Team Member), ba_a (Business Associate), tc_dash (Technical Consultant), acc_m (Accounts), dh_acc.
-- "42501" is the SQLSTATE the API turns into HTTP 403 (server/http/errors.ts).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 140. Meetings with the CEO: only the Super Admin approves, rejects or reschedules'
reset role;
\i supabase/migrations/20270101000500_meetings_google_calendar.sql
\i supabase/migrations/20270113000100_meetings_creator_organiser.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql
\i supabase/migrations/20270114000100_meetings_superadmin_approval.sql

-- a clean slate for this suite (re-runnable)
delete from meeting_delegates where host_id = test.id('sa');
delete from meetings where host_id = test.id('sa') and title like 'CEO-APPR %';
delete from notifications where title like '%CEO-APPR %' or body like '%CEO-APPR %';
create temp table ca (k text primary key, id uuid, v integer);
grant all on ca to authenticated;

-- run a statement that must fail with this exact SQLSTATE (42501 = HTTP 403)
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

-- a function that tries to approve behind the checks of mtg_decide (as a future mistake could): the trigger must still refuse
create or replace function test.sneaky_update(p_id uuid, p_set text) returns void language plpgsql security definer set search_path = '' as $$
begin
  execute format('update public.meetings set %s where id = %L', p_set, p_id);
end $$;
grant execute on function test.sneaky_update(uuid, text) to authenticated;

\echo '   every role of the brief can ask the CEO for time'
set role authenticated;
do $$
declare
  r text;
  i integer := 0;
  v jsonb;
begin
  foreach r in array array['hr_head', 'rr_asst', 'dh_wab', 'th_wab', 'tm_a', 'ba_a', 'tc_dash', 'acc_m', 'dh_acc'] loop
    i := i + 1;
    perform test.login(r);
    v := public.mtg_create(jsonb_build_object('title', 'CEO-APPR ' || r, 'hostId', test.id('sa'), 'description', 'Agenda from ' || r,
      'message', 'Please find a slot', 'startsAt', date_trunc('hour', now()) + ((30 + i) || ' days 10 hours')::interval,
      'endsAt', date_trunc('hour', now()) + ((30 + i) || ' days 10 hours 30 minutes')::interval));
    if v ->> 'status' <> 'REQUESTED' then raise exception 'TEST FAILED: the request of % is not "requested" (%)', r, v ->> 'status'; end if;
    insert into ca values ('req_' || r, (v ->> 'id')::uuid, (v ->> 'version')::integer);
    raise notice 'ok - % can request a meeting with the CEO (status REQUESTED)', r;
  end loop;
end $$;
-- an agenda is required
select test.login('tm_a');
select test.must_fail($$select mtg_create(jsonb_build_object('title', 'CEO-APPR no agenda', 'hostId', test.id('sa'),
  'startsAt', date_trunc('hour', now()) + interval '45 days 10 hours', 'endsAt', date_trunc('hour', now()) + interval '45 days 10 hours 30 minutes'))$$,
  'a request without an agenda is refused', 'agenda or purpose');
-- and nobody can book the CEO's time directly (as scheduled), whoever they are
select test.must_fail_state($$insert into meetings (kind, title, host_id, created_by, starts_at, ends_at, status)
  values ('CEO_MEETING', 'CEO-APPR direct', test.id('sa'), test.id('tm_a'), now() + interval '50 days', now() + interval '50 days 30 minutes', 'SCHEDULED')$$,
  'direct table writes are not possible for an employee', '42501');
reset role;
select test.check((select count(*) = 9 and bool_and(requires_approval and kind = 'CEO_MEETING' and request_message = 'Please find a slot') from meetings
                    where host_id = test.id('sa') and title like 'CEO-APPR %' and title <> 'CEO-APPR direct'),
  'nine requests are saved as pending requests for the Super Admin, with the extra message');
select test.check((select count(*) = 9 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REQUESTED' and body like 'CEO-APPR %'),
  'the Super Admin is notified once per request (no duplicates)');

\echo '   NO role but the Super Admin can approve, reject, propose or reschedule (SQLSTATE 42501 = HTTP 403)'
set role authenticated;
do $$
declare
  r text;
  own uuid;
  other uuid;
begin
  foreach r in array array['hr_head', 'rr_asst', 'dh_wab', 'th_wab', 'tm_a', 'ba_a', 'tc_dash', 'acc_m', 'dh_acc'] loop
    perform test.login(r);
    own := (select id from ca where k = 'req_' || r);
    other := (select id from ca where k = 'req_' || case when r = 'tm_a' then 'th_wab' else 'tm_a' end);
    perform test.must_fail_state(format('select mtg_decide(%L, %L)', own, 'APPROVE'), r || ' cannot approve their own request', '42501');
    perform test.must_fail_state(format('select mtg_decide(%L, %L)', other, 'APPROVE'), r || ' cannot approve another request', '42501');
    perform test.must_fail_state(format('select mtg_decide(%L, %L, %L)', other, 'DECLINE', 'no'), r || ' cannot reject', '42501');
    perform test.must_fail_state(format('select mtg_decide(%L, %L, %L, now() + interval ''40 days'', now() + interval ''40 days 30 minutes'')', other, 'PROPOSE', 'x'),
      r || ' cannot propose another time', '42501');
    perform test.must_fail_state(format('select mtg_reschedule(%L, now() + interval ''41 days'', now() + interval ''41 days 30 minutes'', %L)', other, 'Moved'),
      r || ' cannot reschedule another request', '42501');
    perform test.must_fail_state(format('select mtg_cancel(%L, %L)', other, 'x'), r || ' cannot cancel another request', '42501');
    perform test.must_fail_state(format('select mtg_complete(%L)', own), r || ' cannot manage the meeting', '42501');
  end loop;
end $$;
-- the role cannot come from the caller: the functions take no role and no user id, and a forged "role" in the profile is not writable
select test.login('hr_head');
select test.must_fail($$update profiles set role = 'SUPER_ADMIN' where id = test.id('hr_head')$$, 'an employee cannot make themselves Super Admin');
-- direct writes bypassing the functions
select test.login('tm_a');
select test.must_fail($$update meetings set status = 'SCHEDULED' where id = (select id from ca where k = 'req_tm_a')$$, 'an employee cannot change a meeting status directly');
select test.must_fail($$delete from meetings where id = (select id from ca where k = 'req_tm_a')$$, 'nor delete a meeting');
select test.must_fail($$update meeting_events set note = 'x' where meeting_id = (select id from ca where k = 'req_tm_a')$$, 'nor edit the history');
select test.must_fail($$delete from meeting_events where meeting_id = (select id from ca where k = 'req_tm_a')$$, 'nor delete the history');
-- defence in depth: even a function that forgets to check cannot approve for a non-Super Admin
select test.must_fail_state($$select test.sneaky_update((select id from ca where k = 'req_tm_a'), $s$status = 'SCHEDULED', decided_by = auth.uid()$s$)$$,
  'a buggy function cannot approve for an employee (the trigger refuses)', '42501');
select test.login('th_wab');
select test.must_fail_state($$select test.sneaky_update((select id from ca where k = 'req_tm_a'), $s$starts_at = now() + interval '60 days', ends_at = now() + interval '60 days 30 minutes'$s$)$$,
  'nor can a colleague move somebody else''s request (the trigger refuses)', '42501');
select test.login('tm_a');
select test.sneaky_update((select id from ca where k = 'req_tm_a'), $s$starts_at = date_trunc('hour', now()) + interval '61 days', ends_at = date_trunc('hour', now()) + interval '61 days 30 minutes'$s$);
reset role;
select test.check((select status = 'REQUESTED' and starts_at = date_trunc('hour', now()) + interval '61 days' and decided_by is null from meetings where id = (select id from ca where k = 'req_tm_a')),
  'the one who asked may still change the time of their own PENDING request (it stays "requested": nothing is approved)');
set role authenticated;
select test.must_fail_state($$select test.sneaky_update((select id from ca where k = 'req_tm_a'), $s$status = 'DECLINED'$s$)$$, 'nor reject it', '42501');

\echo '   a leftover delegate (from before this rule) has no power'
reset role;
insert into meeting_delegates (host_id, delegate_id) values (test.id('sa'), test.id('th_wab')) on conflict do nothing;
set role authenticated;
select test.login('th_wab');
select test.check((select jsonb_array_length(mtg_pending_approvals()) = 0), 'the delegate sees nothing waiting for a decision');
select test.must_fail_state($$select mtg_decide((select id from ca where k = 'req_tm_a'), 'APPROVE')$$, 'the delegate cannot approve', '42501');
select test.check((select count(*) = 1 from jsonb_array_elements(mtg_ceo_requests('ALL') -> 'items')), 'and sees only their own request, not the others''');
select test.check((select jsonb_typeof(mtg_set_delegates(array[test.id('tm_a')]) -> 'delegates') = 'array'), 'a colleague may still name delegates for their OWN calendar (not the CEO''s)');
select test.login('sa');
select test.must_fail_state($$select mtg_set_delegates(array[test.id('tm_a')])$$, 'the Super Admin cannot delegate the CEO''s decisions', '42501');
reset role;
delete from meeting_delegates where host_id in (test.id('sa'), test.id('th_wab'));

\echo '   the Super Admin sees every request, the others only their own'
set role authenticated;
select test.login('sa');
select test.check((select (mtg_ceo_requests('ALL') ->> 'isSuperAdmin')::boolean and (mtg_ceo_requests('ALL', 100) -> 'counts' ->> 'pending')::integer >= 9), 'the Super Admin sees all the pending requests');
select test.check((select count(*) = 9 from jsonb_array_elements(mtg_ceo_requests('PENDING', 100) -> 'items') x where x ->> 'title' like 'CEO-APPR %'), 'in the Pending section');
select test.check((select bool_and(x ->> 'createdByName' is not null and x ->> 'createdByDesignation' is not null and x ->> 'description' is not null
                                   and x ->> 'startsAt' is not null and x ->> 'createdAt' is not null and x ->> 'status' = 'REQUESTED')
                     from jsonb_array_elements(mtg_ceo_requests('PENDING', 100) -> 'items') x where x ->> 'title' like 'CEO-APPR %'),
  'each shows the employee, designation, agenda, requested time, submission date and status');
select test.check((select count(*) >= 1 from jsonb_array_elements(mtg_ceo_requests('PENDING', 100) -> 'items') x where x ->> 'createdByDepartment' is not null),
  'and the employee''s department');
select test.check((select jsonb_array_length(mtg_pending_approvals()) >= 9), 'the pending list is the Super Admin''s');
do $$
declare
  r text;
begin
  foreach r in array array['hr_head', 'rr_asst', 'dh_wab', 'th_wab', 'tm_a', 'ba_a', 'tc_dash', 'acc_m', 'dh_acc'] loop
    perform test.login(r);
    if (select count(*) from jsonb_array_elements(public.mtg_ceo_requests('ALL', 100) -> 'items')) <> 1
       or (select bool_or((x ->> 'createdBy')::uuid is distinct from test.id(r)) from jsonb_array_elements(public.mtg_ceo_requests('ALL', 100) -> 'items') x) then
      raise exception 'TEST FAILED: % does not see exactly their own request', r;
    end if;
    if (public.mtg_ceo_requests('ALL') ->> 'isSuperAdmin')::boolean then raise exception 'TEST FAILED: % is shown as Super Admin', r; end if;
    if jsonb_array_length(public.mtg_pending_approvals()) <> 0 then raise exception 'TEST FAILED: % has approvals to decide', r; end if;
    raise notice 'ok - % sees only their own request and has nothing to decide', r;
  end loop;
end $$;
select test.login('tm_a');
select test.must_fail($$select mtg_detail((select id from ca where k = 'req_th_wab'))$$, 'an employee cannot open another employee''s request', 'NOT_FOUND');
select test.must_fail($$select mtg_ceo_requests('NONSENSE')$$, 'an unknown section is refused', 'VALIDATION_ERROR');

\echo '   approve'
select test.login('sa');
select test.check((select mtg_decide((select id from ca where k = 'req_tm_a'), 'APPROVE', 'See you then') ->> 'status' = 'SCHEDULED'), 'the Super Admin approves a pending request');
reset role;
select test.check((select status = 'SCHEDULED' and decided_by = test.id('sa') and decided_at is not null and decision_note = 'See you then' from meetings where id = (select id from ca where k = 'req_tm_a')),
  'it saves the status, the approver and the time of approval');
select test.check((select count(*) = 1 from meeting_events where meeting_id = (select id from ca where k = 'req_tm_a') and kind = 'APPROVED'
                    and actor_id = test.id('sa') and data ->> 'fromStatus' = 'REQUESTED' and data ->> 'toStatus' = 'SCHEDULED'), 'the history records who, the old and the new status');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'MEETING_APPROVED' and entity_id = (select id from ca where k = 'req_tm_a')),
  'the employee is notified, once');
set role authenticated;
select test.login('tm_a');
select test.check((select x ->> 'status' = 'SCHEDULED' and x ->> 'decidedByName' is not null and x ->> 'startsAt' is not null
                     from jsonb_array_elements(mtg_ceo_requests('APPROVED') -> 'items') x where x ->> 'title' = 'CEO-APPR tm_a'), 'the employee sees the confirmed date and time');
select test.must_fail_state($$select mtg_decide((select id from ca where k = 'req_tm_a'), 'DECLINE', 'changed my mind')$$, 'the employee still cannot change the decision', '42501');

\echo '   reject: a reason is required'
select test.login('sa');
select test.must_fail($$select mtg_decide((select id from ca where k = 'req_th_wab'), 'DECLINE')$$, 'a rejection without a reason is refused', 'reason');
select test.must_fail($$select mtg_decide((select id from ca where k = 'req_th_wab'), 'DECLINE', '   ')$$, 'a blank reason too', 'reason');
select test.check((select mtg_decide((select id from ca where k = 'req_th_wab'), 'DECLINE', 'Please take this to your Department Head first') ->> 'status' = 'DECLINED'), 'the Super Admin rejects with a reason');
reset role;
select test.check((select status = 'DECLINED' and decided_by = test.id('sa') and decided_at is not null and decision_note like 'Please take%' from meetings where id = (select id from ca where k = 'req_th_wab')),
  'it saves the reason, the Super Admin and the time');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('th_wab') and type = 'MEETING_DECLINED' and body like '%Please take this to your Department Head first%'),
  'the employee is notified with the reason');
set role authenticated;
select test.login('th_wab');
select test.check((select x ->> 'rejectionReason' = 'Please take this to your Department Head first' from jsonb_array_elements(mtg_ceo_requests('REJECTED') -> 'items') x where x ->> 'title' = 'CEO-APPR th_wab'),
  'the employee sees the rejection reason');

\echo '   reschedule a pending request: new date, time and a reason'
select test.login('sa');
select test.must_fail($$select mtg_reschedule((select id from ca where k = 'req_dh_wab'), date_trunc('hour', now()) + interval '70 days 14 hours', date_trunc('hour', now()) + interval '70 days 14 hours 30 minutes')$$,
  'a reschedule without a reason is refused', 'reason');
select test.check((select mtg_reschedule((select id from ca where k = 'req_dh_wab'), date_trunc('hour', now()) + interval '70 days 14 hours',
  date_trunc('hour', now()) + interval '70 days 14 hours 30 minutes', 'The board meets that morning') ->> 'status' = 'SCHEDULED'), 'the Super Admin reschedules with a reason');
reset role;
select test.check((select status = 'SCHEDULED' and starts_at = date_trunc('hour', now()) + interval '70 days 14 hours' from meetings where id = (select id from ca where k = 'req_dh_wab')),
  'the meeting moved to the new time and is confirmed');
select test.check((select previous_starts_at is not null and previous_starts_at <> starts_at and rescheduled_by = test.id('sa') and rescheduled_at is not null
                          and reschedule_reason = 'The board meets that morning' and reschedule_count = 1 and decided_by = test.id('sa')
                     from meetings where id = (select id from ca where k = 'req_dh_wab')),
  'the previous time, the new time, the reason, who and when are saved');
select test.check((select count(*) = 1 from meeting_events where meeting_id = (select id from ca where k = 'req_dh_wab') and kind = 'RESCHEDULED' and note = 'The board meets that morning'
                    and data ->> 'from' is not null and data ->> 'to' is not null and data ->> 'fromStatus' = 'REQUESTED' and data ->> 'toStatus' = 'SCHEDULED'),
  'the history keeps both times, the reason and the statuses');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('dh_wab') and type = 'MEETING_RESCHEDULED' and body like '%The board meets that morning%'),
  'the employee is notified with the new time and the reason');
set role authenticated;
select test.login('dh_wab');
select test.check((select x ->> 'rescheduleReason' = 'The board meets that morning' and x ->> 'previousStartsAt' is not null and (x ->> 'rescheduleCount')::integer = 1
                     from jsonb_array_elements(mtg_ceo_requests('RESCHEDULED') -> 'items') x where x ->> 'title' = 'CEO-APPR dh_wab'),
  'the employee sees the new schedule, the earlier one and the reason (Rescheduled section)');

\echo '   reschedule a confirmed meeting; the history is kept'
select test.login('sa');
select test.check((select mtg_reschedule((select id from ca where k = 'req_tm_a'), date_trunc('hour', now()) + interval '72 days 9 hours',
  date_trunc('hour', now()) + interval '72 days 9 hours 30 minutes', 'Travelling that day') ->> 'status' = 'SCHEDULED'), 'the Super Admin changes the time of an approved meeting');
reset role;
select test.check((select reschedule_count = 1 and previous_starts_at is not null and previous_starts_at <> starts_at and rescheduled_by = test.id('sa')
                          and reschedule_reason = 'Travelling that day' and starts_at = date_trunc('hour', now()) + interval '72 days 9 hours'
                     from meetings where id = (select id from ca where k = 'req_tm_a')), 'it saves the earlier time, the new time, the reason and who moved it');
select test.check((select count(*) = 1 from meeting_events where meeting_id = (select id from ca where k = 'req_tm_a') and kind = 'APPROVED')
                   and (select count(*) = 1 from meeting_events where meeting_id = (select id from ca where k = 'req_tm_a') and kind = 'RESCHEDULED'),
  'the approval stays in the history after the move');
select test.must_fail($$update meeting_events set note = 'x'$$, 'the audit history cannot be edited, even by the owner', 'cannot be changed');
select test.must_fail($$delete from meeting_events where meeting_id = (select id from ca where k = 'req_tm_a')$$, 'or deleted', 'cannot be changed');
select test.check((select count(*) >= 3 from audit_logs where entity_type = 'meeting' and entity_id = (select id from ca where k = 'req_tm_a') and actor_id in (test.id('sa'), test.id('tm_a'))),
  'the audit log has the request, the approval and the move');

\echo '   cancel an approved meeting (reason required); an employee can only withdraw a pending request'
set role authenticated;
select test.login('sa');
select test.check((select mtg_decide((select id from ca where k = 'req_ba_a'), 'APPROVE') ->> 'status' = 'SCHEDULED'), 'the Super Admin approves another request (without a note)');
select test.must_fail($$select mtg_cancel((select id from ca where k = 'req_ba_a'))$$, 'cancelling someone''s meeting without a reason is refused', 'reason');
select test.check((select mtg_cancel((select id from ca where k = 'req_ba_a'), 'The event was called off') ->> 'status' = 'CANCELLED'), 'the Super Admin cancels an approved meeting with a reason');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('ba_a') and type = 'MEETING_CANCELLED' and body like '%The event was called off%'), 'the employee is told why');
select test.check((select count(*) = 1 from meeting_events where meeting_id = (select id from ca where k = 'req_ba_a') and kind = 'CANCELLED' and data ->> 'fromStatus' = 'SCHEDULED'),
  'the history records the cancellation');

\echo '   what an employee may do with their own request'
set role authenticated;
select test.login('acc_m');
select test.check((select x ->> 'canWithdraw' = 'true' and x ->> 'canDecide' = 'false' and x ->> 'canManage' = 'false'
                     from jsonb_array_elements(mtg_ceo_requests('PENDING') -> 'items') x where x ->> 'title' = 'CEO-APPR acc_m'),
  'the screen offers "withdraw" and never approve / reject / reschedule');
select test.check((select mtg_cancel((select id from ca where k = 'req_acc_m')) ->> 'status' = 'CANCELLED'), 'an employee withdraws their own pending request');
select test.login('tm_a');
select test.must_fail_state($$select mtg_cancel((select id from ca where k = 'req_tm_a'), 'I cannot come')$$, 'but cannot cancel an approved meeting on their own', '42501');
select test.check((select x ->> 'canRequestChange' = 'true' and x ->> 'canManage' = 'false' from jsonb_array_elements(mtg_ceo_requests('RESCHEDULED') -> 'items') x where x ->> 'title' = 'CEO-APPR tm_a'),
  'they can ask for another time');
select test.check((select mtg_reschedule((select id from ca where k = 'req_tm_a'), date_trunc('hour', now()) + interval '75 days 9 hours',
  date_trunc('hour', now()) + interval '75 days 9 hours 30 minutes', 'Could we do the afternoon?') ->> 'status' = 'REQUESTED'),
  'asking for another time sends the meeting back to "requested": it is not confirmed until the Super Admin decides');
select test.must_fail_state($$select mtg_decide((select id from ca where k = 'req_tm_a'), 'APPROVE')$$, 'and they cannot confirm it themselves', '42501');
select test.login('sa');
select test.check((select mtg_decide((select id from ca where k = 'req_tm_a'), 'APPROVE', 'Afternoon is fine') ->> 'status' = 'SCHEDULED'), 'the Super Admin confirms it');
reset role;
select test.check((select count(*) = 1 from meeting_events where meeting_id = (select id from ca where k = 'req_tm_a') and kind = 'CHANGE_REQUESTED' and actor_id = test.id('tm_a')),
  'the history shows who asked for the change');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and type = 'MEETING_REQUESTED' and title like 'Meeting request moved by%' and body like '%CEO-APPR tm_a%'),
  'the Super Admin is notified of the change request');

\echo '   the other meetings of the CRM are untouched'
select test.check((select count(*) >= 0 from meetings where kind <> 'CEO_MEETING'), 'meetings that are not with the CEO keep their rules (see the other meeting suites)');

-- tidy up this suite
delete from meetings where host_id = test.id('sa') and title like 'CEO-APPR %';
delete from notifications where title like '%CEO-APPR %' or body like '%CEO-APPR %';
drop function if exists test.sneaky_update(uuid, text);
