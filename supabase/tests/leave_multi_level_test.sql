-- =============================================================================
-- Leave: Team Member -> Team Lead -> Department Head -> Operations Head -> HR (migration 20261225000200).
-- Reuses team_lead_direct_scope_test.sql (tds-a: Team Leads lA / lB sharing one Support team, members a1, a2 (lA), b1 (lB), m0 (nobody named),
-- Department Head tds_dh) and hr_test.sql's HR head (hr_head). Adds a Support Operations Head accountable for tds-a's Support side.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 128. Leave: the multi-level chain'
reset role;
\i supabase/migrations/20261224000100_department_function_scopes.sql
\i supabase/migrations/20261225000100_team_lead_direct_scope.sql
\i supabase/migrations/20261225000200_leave_multi_level.sql
\i supabase/migrations/20261225000200_leave_multi_level.sql
update public.leave_settings set workflow = 'MULTI_LEVEL';
delete from leave_requests where employee_id in (select id from profiles where email like 'tds.%@example.com');
select test.service();
select test.create_auth_user('tds_ops', 'tds.ops@example.com', '{"full_name":"TDS ops"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('tds-b'),
                     'provisioned_operations_head', true)) where test.id('tds_ops') is null;
reset role;
select set_config('request.jwt.claims', '', false);
create temp table lv2 (k text primary key, v uuid);
grant all on lv2 to authenticated;
set role authenticated;
select test.login('sa');
select operations_head_scope_apply(test.id('tds_ops'), 'SUPPORT', jsonb_build_array(jsonb_build_object('departmentId', test.dept('tds-a'), 'primary', true)));
reset role;
select test.check(private.operations_owner_for(test.dept('tds-a'), 'SUPPORT') = test.id('tds_ops'), 'fixture: the Support Operations Head is accountable for tds-a Support');

\echo '   a Team Member''s leave: Team Lead, Department Head, Operations Head, HR - in that order, each the right person'
set role authenticated;
select test.login('tds_a1');
insert into lv2 select 'a1', (submit_leave_request('FULL_DAY', current_date + 30, current_date + 31, null, 'Family wedding') ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING_TEAM_LEAD' and workflow_version = 2 from leave_requests where id = (select v from lv2 where k = 'a1')), 'it starts with the Team Lead');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tds_lA') and entity_id = (select v from lv2 where k = 'a1') and type = 'LEAVE_AWAITING_TEAM_LEAD')
                  and (select count(*) = 0 from notifications where recipient_id = test.id('tds_lB') and entity_id = (select v from lv2 where k = 'a1')),
  'the member''s own Team Lead is told, not the other lead of the same team');
set role authenticated;
select test.login('tds_a1');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a1')), 'nobody approves their own leave', 'cannot decide your own');
select test.login('tds_lB');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a1')), 'the other Team Lead cannot approve it', 'NOT_FOUND');
select test.check((select count(*) = 0 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where x ->> 'id' = (select v::text from lv2 where k = 'a1')), 'nor sees it in their queue');
select test.login('tds_dh');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a1')), 'the Department Head cannot jump the Team Lead''s step', 'NOT_FOUND');
select test.must_fail(format($$select decide_leave_department_head('%s', true, null)$$, (select v from lv2 where k = 'a1')), 'not through the older button either', 'NOT_FOUND');
select test.login('hr_head');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a1')), 'HR cannot approve before its turn', 'NOT_FOUND');
select test.login('tds_lA');
select test.check((select count(*) = 1 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where x ->> 'id' = (select v::text from lv2 where k = 'a1')), 'it is in lead A''s queue');
select test.check((select decide_leave((select v from lv2 where k = 'a1'), 'APPROVE', 'Covered by a2') ->> 'status') = 'PENDING_DEPARTMENT_HEAD', 'the Team Lead approves: on to the Department Head');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a1')), 'the Team Lead cannot approve twice', 'NOT_FOUND');
select test.login('tds_dh');
select test.check((select decide_leave_department_head((select v from lv2 where k = 'a1'), true, null) ->> 'status') = 'PENDING_OPERATIONS_HEAD',
  'the Department Head approves (the older button works for the new chain too): on to the Operations Head');
select test.login('tds_ops');
select test.check((select decide_leave((select v from lv2 where k = 'a1'), 'APPROVE', null) ->> 'status') = 'PENDING_HR', 'the Support Operations Head approves: on to HR');
select test.login('hr_head');
select test.check((select decide_leave((select v from lv2 where k = 'a1'), 'APPROVE', 'Enjoy') ->> 'status') = 'APPROVED', 'HR gives the final approval');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a1')), 'and it cannot be approved again', 'already been decided');
reset role;
select test.check((select tl_decided_by = test.id('tds_lA') and dh_decided_by = test.id('tds_dh') and oh_decided_by = test.id('tds_ops') and hr_decided_by = test.id('hr_head')
                     from leave_requests where id = (select v from lv2 where k = 'a1')), 'who decided each step is stored');
select test.check((select jsonb_array_length(private.leave_row(r) -> 'timeline') = 5
                     and (private.leave_row(r) -> 'timeline' -> 1 ->> 'note') = 'Covered by a2' from leave_requests r where r.id = (select v from lv2 where k = 'a1')),
  'the timeline has the submission and the four approvals, with notes');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tds_a1') and entity_id = (select v from lv2 where k = 'a1') and type = 'LEAVE_APPROVED'),
  'the employee is told once that the leave is approved');

\echo '   a rejection ends it; a request sent back is changed and starts again'
set role authenticated;
select test.login('tds_a2');
insert into lv2 select 'a2', (submit_leave_request('HALF_DAY', current_date + 40, null, 'MORNING', 'Bank work') ->> 'id')::uuid;
select test.login('tds_lA');
select test.must_fail(format($$select decide_leave('%s', 'REJECT', '')$$, (select v from lv2 where k = 'a2')), 'a rejection needs a reason', 'Give a reason');
select test.check((select decide_leave((select v from lv2 where k = 'a2'), 'REJECT', 'Month-end close') ->> 'status') = 'REJECTED_BY_TEAM_LEAD', 'the Team Lead rejects');
select test.login('tds_dh');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'a2')), 'nobody can approve it after a rejection', 'already been decided');
select test.login('tds_b1');
insert into lv2 select 'b1', (submit_leave_request('FULL_DAY', current_date + 50, current_date + 50, null, 'Personal') ->> 'id')::uuid;
select test.login('tds_lB');
select test.check((select decide_leave((select v from lv2 where k = 'b1'), 'REVISE', 'Say which day exactly') ->> 'status') = 'REVISION_REQUIRED', 'lead B sends b1''s request back');
select test.login('tds_a1');
select test.must_fail(format($$select resubmit_leave_request('%s', 'Mine now')$$, (select v from lv2 where k = 'b1')), 'only its employee changes it', 'NOT_FOUND');
select test.login('tds_b1');
select test.check((select resubmit_leave_request((select v from lv2 where k = 'b1'), 'Personal work on the 50th day') ->> 'status') = 'PENDING_TEAM_LEAD', 'b1 changes it; it starts again with the Team Lead');

\echo '   other requesters, and nobody to decide'
select test.login('tds_lA');
insert into lv2 select 'lA', (submit_leave_request('FULL_DAY', current_date + 60, current_date + 60, null, 'Medical check-up') ->> 'id')::uuid;
reset role;
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' from leave_requests where id = (select v from lv2 where k = 'lA')), 'a Team Lead''s own leave starts with the Department Head');
set role authenticated;
select test.login('tds_m0');
insert into lv2 select 'm0', (submit_leave_request('FULL_DAY', current_date + 70, current_date + 70, null, 'Travel') ->> 'id')::uuid;
reset role;
select test.check((select array_agg(a.approver_id) = (select array_agg(id order by created_at) from profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE')
                     from private.leave_stage_approvers((select r from leave_requests r where id = (select v from lv2 where k = 'm0')), 'TEAM_LEAD') a),
  'a member with no named Team Lead: the Super Admin decides that step (the defined exception), it is not skipped or approved by itself');
set role authenticated;
select test.login('sa');
select decide_leave((select v from lv2 where k = 'm0'), 'APPROVE', null);
reset role;
select test.check((select on_behalf = 'SUPER_ADMIN_EXCEPTION' from leave_request_events where request_id = (select v from lv2 where k = 'm0') and stage = 'TEAM_LEAD'),
  'and the timeline says it was the exception');
select test.check((select status = 'PENDING_DEPARTMENT_HEAD' from leave_requests where id = (select v from lv2 where k = 'm0')), 'the chain then goes on as usual');

\echo '   requests of the earlier two-step flow keep their rules'
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, reason, status, workflow_version)
select id, department_id, 'FULL_DAY', current_date + 80, current_date + 80, 'Old request', 'PENDING_DEPARTMENT_HEAD', 1 from profiles where id = test.id('tds_a2');
insert into lv2 select 'old', id from leave_requests where employee_id = test.id('tds_a2') and reason = 'Old request';
set role authenticated;
select test.login('tds_dh');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lv2 where k = 'old')), 'the new chain does not take over an earlier request', 'earlier Department Head and HR');
select test.check((select decide_leave_department_head((select v from lv2 where k = 'old'), true, null) ->> 'status') = 'PENDING_HR', 'it goes Department Head -> HR as when it was made (no new step marked as done)');

\echo '   a departing approver: the step moves, nothing is approved'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('tds_lB');
select test.check((select bool_and(a.exception) from private.leave_stage_approvers((select r from leave_requests r where id = (select v from lv2 where k = 'b1')), 'TEAM_LEAD') a),
  'lead B is suspended: b1''s waiting step goes to the Super Admin');
select test.check((select status = 'PENDING_TEAM_LEAD' from leave_requests where id = (select v from lv2 where k = 'b1')), 'and the request is still waiting');
update profiles set status = 'ACTIVE' where id = test.id('tds_lB');
set role authenticated;
select test.login('sa');
select test.check((select (offboarding_impact(test.id('tds_lB')) -> 'counts' ->> 'leaveApprovalsWaiting')::int = 1), 'the offboarding impact lists the leave step lead B decides');

\echo '   monthly totals: a Team Lead sees only their own members'
select test.login('tds_lA');
select test.check((select coalesce(bool_and((e ->> 'profileId')::uuid in (test.id('tds_a1'), test.id('tds_a2'))), true)
                    from generate_series(0, 3) m,
                         jsonb_array_elements(leave_monthly_summary((date_trunc('month', current_date) + make_interval(months => m))::date) -> 'employees') e),
  'lead A''s monthly totals list only lead A''s members');

\echo '   the switch back to the two-step flow (Super Admin only, audited)'
select test.login('tds_dh');
select test.must_fail($$select set_leave_workflow('TWO_STEP')$$, 'only the Super Admin switches it', 'FORBIDDEN');
select test.login('sa');
select set_leave_workflow('TWO_STEP');
select test.login('tds_a2');
select test.check((select submit_leave_request('FULL_DAY', current_date + 90, current_date + 90, null, 'Two-step again') ->> 'status') = 'PENDING_DEPARTMENT_HEAD', 'new requests go Department Head -> HR again');
select test.login('sa');
select set_leave_workflow('MULTI_LEVEL');
reset role;
select test.check((select count(*) >= 2 from audit_logs where action = 'LEAVE_WORKFLOW_SET'), 'both switches are audited');
