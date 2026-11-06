-- =============================================================================
-- Leave: the approval chain depends on who asks (migration 20261228000100).
-- Reuses leave_multi_level_test.sql (tds-a: Team Lead lA with member a1, Department Head tds_dh, Support Operations Head tds_ops) and
-- hr_test.sql's HR head (hr_head). Adds lvc-n, a department with NO Operations Head, a Meta Verifier in tds-a and an HR member.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 131. Leave: the chain by requester'
reset role;
\i supabase/migrations/20261228000100_leave_chain_by_requester.sql
\i supabase/migrations/20261228000100_leave_chain_by_requester.sql
update public.leave_settings set workflow = 'MULTI_LEVEL';
delete from leave_requests where employee_id in (select id from profiles where email like 'tds.%@example.com' or email like 'lvc.%@example.com' or email = 'hr.head@amuwa.com');
delete from auth.users where email like 'lvc.%@example.com';
delete from test.users where name like 'lvc\_%';
delete from teams where department_id in (select id from departments where slug = 'lvc-n');
delete from departments where slug = 'lvc-n';
insert into departments (slug, name) values ('lvc-n', 'LVC No Ops');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug = 'lvc-n';

create or replace function test.lvcmk(p_name text, p_role text, p_dept text, p_team text default null, p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'lvc.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'LVC ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;
select test.service(); select test.lvcmk('lvc_dh', 'DEPARTMENT_HEAD', 'lvc-n');
select test.service(); select test.lvcmk('lvc_l', 'TEAM_HEAD', 'lvc-n', 'Support');
select test.service(); select test.lvcmk('lvc_m', 'TEAM_MEMBER', 'lvc-n', 'Support', 'lvc_l');
select test.service(); select test.lvcmk('lvc_mv', 'TEAM_MEMBER', 'tds-a', 'Support', 'tds_lA');
select test.service();
select test.create_auth_user('lvc_hr', 'lvc.hr@example.com', '{"full_name":"LVC hr"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set is_meta_verifier = true where id = test.id('lvc_mv');
select test.check(not private.leave_has_operations_head(test.id('lvc_m'), test.dept('lvc-n')) and private.leave_has_operations_head(test.id('tds_a1'), test.dept('tds-a')),
  'fixture: lvc-n has no Operations Head, tds-a has one (Support)');
create temp table lvc (k text primary key, v uuid);
grant all on lvc to authenticated;

-- submit as p_who; returns nothing, the id is kept under p_key
create or replace function pg_temp.ask(p_who text, p_key text, p_days int) returns void language plpgsql as $$
begin
  perform test.login(p_who);
  insert into lvc select p_key, (submit_leave_request('FULL_DAY', current_date + p_days, current_date + p_days, null, 'Personal work') ->> 'id')::uuid;
end $$;
create or replace function pg_temp.chain(p_key text) returns text language sql as $$
  select array_to_string(private.leave_chain(r), ' > ') from leave_requests r where r.id = (select v from lvc where k = p_key)
$$;
create or replace function pg_temp.status(p_key text) returns text language sql as $$
  select status from leave_requests where id = (select v from lvc where k = p_key)
$$;

\echo '   each requester gets their chain'
set role authenticated;
select pg_temp.ask('tds_a1', 'tm', 200);
select pg_temp.ask('lvc_mv', 'mv', 200);
select pg_temp.ask('tds_lA', 'tl', 200);
select pg_temp.ask('tds_dh', 'dh', 200);
select pg_temp.ask('tds_ops', 'ops', 200);
select pg_temp.ask('hr_head', 'hr', 200);
select pg_temp.ask('lvc_hr', 'hr2', 200);
select pg_temp.ask('lvc_m', 'ntm', 200);
select pg_temp.ask('lvc_l', 'ntl', 200);
select pg_temp.ask('lvc_dh', 'ndh', 200);
reset role;
select test.check((select bool_and(workflow_version = 3) from leave_requests where id in (select v from lvc)), 'new requests use the new chain (version 3)');
select test.check(pg_temp.chain('tm') = 'TEAM_LEAD > DEPARTMENT_HEAD > OPERATIONS_HEAD > HR', 'Team Member: Team Lead > Department Head > Operations Head > HR');
select test.check(pg_temp.chain('mv') = 'DEPARTMENT_HEAD > OPERATIONS_HEAD > HR' and pg_temp.status('mv') = 'PENDING_DEPARTMENT_HEAD',
  'Meta Verifier: straight to the Department Head, then Operations Head > HR');
select test.check(pg_temp.chain('tl') = 'DEPARTMENT_HEAD > OPERATIONS_HEAD > HR', 'Team Lead: Department Head > Operations Head > HR');
select test.check(pg_temp.chain('dh') = 'OPERATIONS_HEAD > HR', 'Department Head: Operations Head > HR');
select test.check(pg_temp.chain('ops') = 'HR' and pg_temp.status('ops') = 'PENDING_HR', 'Operations Head: straight to HR (no Super Admin step)');
select test.check(pg_temp.chain('hr') = 'SUPER_ADMIN' and pg_temp.status('hr') = 'PENDING_SUPER_ADMIN', 'HR head: the Super Admin');
select test.check(pg_temp.chain('hr2') = 'SUPER_ADMIN', 'an HR member: the Super Admin too');
select test.check(pg_temp.chain('ntm') = 'TEAM_LEAD > DEPARTMENT_HEAD > HR', 'no Operations Head: a Team Member''s Department Head approval goes straight to HR');
select test.check(pg_temp.chain('ntl') = 'DEPARTMENT_HEAD > HR', 'no Operations Head: a Team Lead''s too');
select test.check(pg_temp.chain('ndh') = 'HR' and pg_temp.status('ndh') = 'PENDING_HR', 'no Operations Head: a Department Head applies straight to HR');

\echo '   walking the chains'
set role authenticated;
-- the Meta Verifier: the Team Lead has no step
select test.login('tds_lA');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lvc where k = 'mv')), 'the Team Lead has no step in a Meta Verifier''s leave', 'NOT_FOUND');
select test.login('tds_dh');
select test.check((select decide_leave((select v from lvc where k = 'mv'), 'APPROVE', null) ->> 'status') = 'PENDING_OPERATIONS_HEAD', 'Meta Verifier: Department Head approves, on to the Operations Head');
select test.login('tds_ops');
select test.check((select decide_leave((select v from lvc where k = 'mv'), 'APPROVE', null) ->> 'status') = 'PENDING_HR', 'then HR');
select test.login('hr_head');
select test.check((select decide_leave((select v from lvc where k = 'mv'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'HR gives the final approval');
-- no Operations Head: the Department Head's approval goes to HR
select test.login('lvc_l');
select test.check((select decide_leave((select v from lvc where k = 'ntm'), 'APPROVE', null) ->> 'status') = 'PENDING_DEPARTMENT_HEAD', 'lvc-n member: Team Lead approves');
select test.login('lvc_dh');
select test.check((select decide_leave((select v from lvc where k = 'ntm'), 'APPROVE', null) ->> 'status') = 'PENDING_HR', 'Department Head approves: straight to HR');
select test.login('hr_head');
select test.check((select decide_leave((select v from lvc where k = 'ntm'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'HR approves');
select test.check((select decide_leave((select v from lvc where k = 'ndh'), 'APPROVE', null) ->> 'status') = 'APPROVED', 'and approves the lvc-n Department Head''s own leave directly');
-- the Operations Head: HR decides, the Super Admin has no step
select test.login('sa');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lvc where k = 'ops')), 'the Super Admin has no step in an Operations Head''s leave', 'NOT_FOUND');
select test.login('hr_head');
select test.check((select decide_leave((select v from lvc where k = 'ops'), 'APPROVE', 'Enjoy') ->> 'status') = 'APPROVED', 'Operations Head: HR approves, done');
-- HR's own leave: the Super Admin, not another HR person
select test.login('lvc_hr');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lvc where k = 'hr')), 'another HR person cannot approve HR''s leave', 'NOT_FOUND');
select test.login('hr_head');
select test.must_fail(format($$select decide_leave('%s', 'APPROVE', null)$$, (select v from lvc where k = 'hr')), 'nor the HR head their own', 'cannot decide your own');
select test.check((select count(*) = 0 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where x ->> 'id' = (select v::text from lvc where k = 'hr2')),
  'the HR member''s leave is not in the HR head''s queue');
select test.login('sa');
select test.check((select count(*) = 2 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where x ->> 'id' in (select v::text from lvc where k in ('hr', 'hr2'))),
  'both HR requests are in the Super Admin''s queue');
select test.check((select (r ->> 'status') = 'APPROVED' and (r -> 'superAdmin' ->> 'note') = 'Approved'
                     from (select decide_leave((select v from lvc where k = 'hr'), 'APPROVE', 'Approved') as r) x), 'the Super Admin gives the final approval for HR');
select test.check((select decide_leave((select v from lvc where k = 'hr2'), 'REJECT', 'Audit week') ->> 'status') = 'REJECTED_BY_SUPER_ADMIN', 'and can reject it');
select test.check((select count(*) = 1 from jsonb_array_elements(leave_requests_to_review() -> 'decided') x where x ->> 'id' = (select v::text from lvc where k = 'hr2')),
  'the Super Admin sees what they decided');
reset role;
select test.check((select on_behalf is null from leave_request_events where request_id = (select v from lvc where k = 'hr') and stage = 'SUPER_ADMIN'),
  'the Super Admin step of HR''s leave is the normal approver, not the exception');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('hr_head') and entity_id = (select v from lvc where k = 'hr') and type = 'LEAVE_APPROVED'
                     and body = 'The Super Admin gave the final approval.'), 'HR is told the Super Admin approved');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and entity_id = (select v from lvc where k = 'hr2') and type = 'LEAVE_AWAITING_SUPER_ADMIN'),
  'the Super Admin was told it was waiting');

\echo '   sent back and changed: the same chain again'
set role authenticated;
select test.login('tds_dh');
select test.check((select decide_leave((select v from lvc where k = 'tl'), 'REVISE', 'Which day exactly?') ->> 'status') = 'REVISION_REQUIRED', 'Department Head sends the Team Lead''s request back');
select test.login('tds_lA');
select test.check((select resubmit_leave_request((select v from lvc where k = 'tl'), 'Personal work, the whole day') ->> 'status') = 'PENDING_DEPARTMENT_HEAD', 'changed: it starts at the Department Head again');

\echo '   the hierarchy changes while a request waits: the waiting step is never skipped or approved by itself'
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('tds_ops');
select test.check(pg_temp.chain('tm') = 'TEAM_LEAD > DEPARTMENT_HEAD > HR', 'the Operations Head leaves: a waiting Team Member''s request will go Department Head > HR');
update leave_requests set status = 'PENDING_OPERATIONS_HEAD' where id = (select v from lvc where k = 'dh');
select test.check(pg_temp.chain('dh') = 'OPERATIONS_HEAD > HR', 'a step already waiting at the Operations Head stays on the chain');
select test.check((select bool_and(a.exception) from private.leave_stage_approvers((select r from leave_requests r where id = (select v from lvc where k = 'dh')), 'OPERATIONS_HEAD') a),
  'and is decided by the Super Admin (the defined exception)');
set role authenticated;
select test.login('sa');
select test.check((select decide_leave((select v from lvc where k = 'dh'), 'APPROVE', null) ->> 'status') = 'PENDING_HR', 'then it goes on to HR');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('tds_ops');

\echo '   requests made before keep their chain'
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, reason, status, workflow_version)
select id, department_id, 'FULL_DAY', current_date + 300, current_date + 300, 'Older chain', 'PENDING_OPERATIONS_HEAD', 2 from profiles where id = test.id('tds_ops');
insert into lvc select 'old', id from leave_requests where employee_id = test.id('tds_ops') and reason = 'Older chain';
select test.check(pg_temp.chain('old') = 'OPERATIONS_HEAD > HR', 'an Operations Head''s request of version 2 keeps its Super Admin + HR steps');
set role authenticated;
select test.login('sa');
select test.check((select decide_leave((select v from lvc where k = 'old'), 'APPROVE', null) ->> 'status') = 'PENDING_HR', 'and is decided as before');
reset role;
