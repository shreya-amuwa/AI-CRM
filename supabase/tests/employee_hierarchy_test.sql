-- =============================================================================
-- Multi-level employee approval, Operations Head ownership and Department Head team assignment (migration 20261211000100).
-- Runs late (same database) with its own synthetic departments, so it does not depend on earlier suites' people.
--   Super Admin -> Operations Head -> Department Head -> Team Lead -> Team Member;  HR submits.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 77. Employee approval hierarchy'
reset role;
\i supabase/migrations/20261211000100_employee_approval_hierarchy.sql
-- the later migration replaces four of its functions (a Team Lead adds people directly; only HR sends a request): applied again on top, like production
\i supabase/migrations/20261212000100_team_lead_direct_member_creation.sql

-- clean synthetic world (re-runnable): departments with a Sales and a Support team
delete from auth.users where email like 'eh.%@example.com';
delete from test.users where name like 'eh\_%';
delete from teams where department_id in (select id from departments where slug like 'eh-%');
delete from departments where slug like 'eh-%';
create temp table eh_d (slug text primary key, id uuid);
grant all on eh_d to anon, authenticated, service_role;
insert into departments (slug, name) values ('eh-home1', 'EH Home One'), ('eh-home2', 'EH Home Two'), ('eh-home3', 'EH Home Three'),
  ('eh-a', 'EH Alpha'), ('eh-b', 'EH Beta'), ('eh-c', 'EH Gamma'), ('eh-d', 'EH Delta');
insert into eh_d select slug, id from departments where slug like 'eh-%';
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'eh-%' and d.slug not like 'eh-home%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'eh-%' and d.slug not like 'eh-home%';
-- the homes of the Operations Heads need a team in each function for their scope to be grantable
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'eh-home%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'eh-home%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.ehd(p text) returns uuid language sql stable as $$ select id from eh_d where slug = p $$;
create or replace function test.ehapp(p_by text, p_role text, p_ops boolean, p_dept text, p_division text default null) returns jsonb language sql stable as $$
  select jsonb_build_object('request_by', test.id(p_by), 'request_role', p_role, 'request_operations_head', p_ops,
                            'request_department_id', test.ehd(p_dept), 'request_division', p_division)
$$;
grant execute on all functions in schema test to anon, authenticated;

-- people: the Super Admin of the earlier suites ('sa'), an HR member, two Operations Heads, three Department Heads
select test.service();
select test.create_auth_user('eh_hr', 'eh.hr@example.com', '{"full_name":"EH HR"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('hr', 'General')));
select test.service();
select test.create_auth_user('eh_oh1', 'eh.oh1@example.com', '{"full_name":"EH Ops One"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.ehd('eh-home1')));
select test.service();
select test.create_auth_user('eh_oh2', 'eh.oh2@example.com', '{"full_name":"EH Ops Two"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.ehd('eh-home2')));
select test.service();
select test.create_auth_user('eh_dha', 'eh.dha@example.com', '{"full_name":"EH Head Alpha"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.ehd('eh-a')));
select test.service();
select test.create_auth_user('eh_dhb', 'eh.dhb@example.com', '{"full_name":"EH Head Beta"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.ehd('eh-b')));
select test.service();
select test.create_auth_user('eh_dhc', 'eh.dhc@example.com', '{"full_name":"EH Head Gamma"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.ehd('eh-c')));
select test.check((select count(*) = 6 from profiles where id in (select test.id(n) from (values ('eh_hr'), ('eh_oh1'), ('eh_oh2'), ('eh_dha'), ('eh_dhb'), ('eh_dhc')) v(n)) and status = 'ACTIVE'),
  'the synthetic people exist and are active');
create temp table eh_before as select count(*) as active_profiles from profiles where status = 'ACTIVE';
grant all on eh_before to authenticated, service_role;

-- the Super Admin makes two Operations Heads and gives them departments; each department gets ONE accountable owner
set role authenticated;
select test.login('sa');
select set_operations_head(test.id('eh_oh1'), true, 'test');
select set_operations_head(test.id('eh_oh2'), true, 'test');
select operations_head_scope_set(test.id('eh_oh1'), array[test.ehd('eh-a'), test.ehd('eh-b')], array[test.ehd('eh-a'), test.ehd('eh-b')]);
select operations_head_scope_set(test.id('eh_oh2'), array[test.ehd('eh-c')], array[test.ehd('eh-c')]);
reset role;

-- the provisioning function was extended: flags it already handled still work
select test.create_auth_user('eh_mv', 'eh.mv@example.com', '{"full_name":"EH Verifier"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select id from teams where department_id = test.ehd('eh-d') and name = 'Support'), 'provisioned_meta_verifier', true));
select test.check((select is_meta_verifier and status = 'ACTIVE' from profiles where id = test.id('eh_mv')), 'direct provisioning by a manager still works, including the Meta Verifier flag');

\echo '   Operations Head scope and ownership (Super Admin only)'
select test.check((select count(*) = 3 from department_operations_owner where department_id in (test.ehd('eh-a'), test.ehd('eh-b'), test.ehd('eh-c'))), 'each department has one accountable Operations Head (a proper relation)');
select test.check(private.owner_of_department(test.ehd('eh-a')) = test.id('eh_oh1') and private.owner_of_department(test.ehd('eh-c')) = test.id('eh_oh2') and private.owner_of_department(test.ehd('eh-d')) is null,
  'the owner resolves per department; a department nobody owns has none');
select test.check((select count(distinct department_id) >= 2 from private.scopes_of(test.id('eh_oh1')) where department_id in (test.ehd('eh-a'), test.ehd('eh-b'))), 'the scope is the departments assigned (more than one)');
set role authenticated;
select test.login('eh_oh1');
select test.must_fail($$select operations_head_scope_set(test.id('eh_oh1'), array[test.ehd('eh-a'), test.ehd('eh-b'), test.ehd('eh-c'), test.ehd('eh-d')], null)$$, 'an Operations Head cannot change their own department scope', 'Only the Super Admin');
select test.must_fail($$select set_operations_head(test.id('eh_dha'), true, 'x')$$, 'nor make another Operations Head', 'Only the Super Admin');
select test.must_fail($$select operations_heads_list()$$, 'nor list the heads', 'Only the Super Admin');
select test.login('eh_hr');
select test.must_fail($$select operations_head_scope_set(test.id('eh_oh1'), array[test.ehd('eh-d')], null)$$, 'HR cannot assign departments to an Operations Head', 'Only the Super Admin');
select test.login('sa');
select test.check((select jsonb_array_length(operations_heads_list() -> 'unowned') >= 1 and (operations_heads_list() -> 'unowned') @> jsonb_build_array(jsonb_build_object('id', test.ehd('eh-d'), 'name', 'EH Delta', 'pendingRequests', 0))
  from (select 1) x), 'the Super Admin sees the department that has no accountable Operations Head');
select test.must_fail($$select operations_head_scope_set(test.id('eh_oh1'), array[test.ehd('eh-d')], array[test.ehd('eh-c')])$$, 'only a department they manage can be made theirs to approve', 'Give');
reset role;

\echo '   HR submits an Operations Head: Super Admin only'
select test.service();
select test.create_auth_user('eh_newoh', 'eh.newoh@example.com', '{"full_name":"EH New Ops"}', test.ehapp('eh_hr', 'DEPARTMENT_HEAD', true, 'eh-home3'));
create temp table eh_r (name text primary key, id uuid);
grant all on eh_r to authenticated, service_role;
insert into eh_r select 'oh', id from approval_requests where subject_user_id = test.id('eh_newoh');
select test.check((select status = 'PENDING' and approver_kind = 'SUPER_ADMIN' and requested_operations_head and source = 'HR' and submitted_by = test.id('eh_hr') from approval_requests where id = (select id from eh_r where name = 'oh')),
  'the request is pending, from HR, and its approver is the Super Admin');
select test.check((select status = 'PENDING' and not is_operations_head from profiles where id = test.id('eh_newoh')), 'the employee exists but is pending - not active, not yet an Operations Head');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('sa') and entity_id = (select id from eh_r where name = 'oh') and type = 'EMPLOYEE_APPROVAL_REQUEST')
               and (select count(*) = 0 from notifications where recipient_id in (test.id('eh_oh1'), test.id('eh_dha')) and entity_id = (select id from eh_r where name = 'oh')), 'only the Super Admin is told');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sa') and entity_id = (select id from eh_r where name = 'oh')), 'once');
set role authenticated;
select test.login('eh_oh1');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'oh'), true, null, null, null)$$, 'an Operations Head cannot approve an Operations Head', 'NOT_FOUND|not the approver');
select test.login('eh_dha');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'oh'), true, null, null, null)$$, 'a Department Head cannot', 'NOT_FOUND|not the approver');
select test.login('eh_hr');
select test.check((select jsonb_array_length(employee_requests_list()) >= 1), 'HR sees the request to monitor its status');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'oh'), true, null, null, null)$$, 'HR cannot approve it', 'not the approver');
select test.must_fail($$select set_user_status(test.id('eh_newoh'), 'ACTIVE', 'activate')$$, 'HR cannot activate the account directly', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select set_user_status(test.id('eh_newoh'), 'ACTIVE', 'activate')$$, 'and nobody can through the generic status change - not even the Super Admin', 'no completed approval|FORBIDDEN|approval workflow');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'oh'), false, '  ', null, null)$$, 'a rejection needs a reason', 'reason');
select employee_request_decide((select id from eh_r where name = 'oh'), true, 'welcome', array[test.ehd('eh-d')], array[test.ehd('eh-d')]);
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'oh'), true, null, null, null)$$, 'a request is decided once', 'already been decided');
reset role;
select test.check((select status = 'ACTIVE' and is_operations_head and approved_by = test.id('sa') from profiles where id = test.id('eh_newoh')), 'approved: active, an Operations Head, approved by the Super Admin');
select test.check(private.owner_of_department(test.ehd('eh-d')) = test.id('eh_newoh') and exists (select 1 from private.scopes_of(test.id('eh_newoh')) where department_id = test.ehd('eh-d')), 'the department scope was given as part of the approval');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('eh_hr') and type = 'EMPLOYEE_REQUEST_APPROVED' and entity_id = (select id from eh_r where name = 'oh')), 'HR is told of the result');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_REQUEST_APPROVED' and entity_id = test.id('eh_newoh') and actor_id = test.id('sa')), 'and it is audited with the approver');

\echo '   Operations Heads cannot approve their own account'
insert into approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_operations_head, approver_kind, submitted_by)
values ('USER_REGISTRATION', test.id('eh_oh1'), test.ehd('eh-home1'), 'PENDING', 'HR', 'DEPARTMENT_HEAD', true, 'SUPER_ADMIN', test.id('eh_hr'));
set role authenticated;
select test.login('eh_oh1');
select test.must_fail($$select employee_request_decide((select id from approval_requests where subject_user_id = test.id('eh_oh1') and status = 'PENDING'), true, null, null, null)$$, 'no self-approval', 'own account|NOT_FOUND');
reset role;
delete from approval_requests where subject_user_id = test.id('eh_oh1') and status = 'PENDING';

\echo '   HR submits a Department Head: only the owning Operations Head decides'
-- a second head for Beta is refused by the one-head rule, so ask for a Support-side head of Beta and of Delta (nobody owns Delta's request yet: it will be Gamma's move)
select test.service();
select test.create_auth_user('eh_newdh_b', 'eh.newdh.b@example.com', '{"full_name":"EH New Beta Support Head"}', test.ehapp('eh_hr', 'DEPARTMENT_HEAD', false, 'eh-b', 'SUPPORT'));
select test.service();
select test.create_auth_user('eh_newdh_c', 'eh.newdh.c@example.com', '{"full_name":"EH New Gamma Support Head"}', test.ehapp('eh_hr', 'DEPARTMENT_HEAD', false, 'eh-c', 'SUPPORT'));
insert into eh_r select 'dh_b', id from approval_requests where subject_user_id = test.id('eh_newdh_b');
insert into eh_r select 'dh_c', id from approval_requests where subject_user_id = test.id('eh_newdh_c');
select test.check((select approver_kind = 'OPERATIONS_HEAD' and approver_id = test.id('eh_oh1') from approval_requests where id = (select id from eh_r where name = 'dh_b')), 'a Beta Department Head request is routed to Beta''s accountable Operations Head');
select test.check((select approver_id = test.id('eh_oh2') from approval_requests where id = (select id from eh_r where name = 'dh_c')), 'a Gamma one to Gamma''s');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('eh_oh1') and entity_id = (select id from eh_r where name = 'dh_b'))
               and (select count(*) = 0 from notifications where recipient_id = test.id('eh_oh2') and entity_id = (select id from eh_r where name = 'dh_b')), 'only the responsible Operations Head is told, once');
set role authenticated;
select test.login('eh_oh2');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'dh_b'), true, null, null, null)$$, 'an unrelated Operations Head cannot approve it', 'NOT_FOUND|not the approver');
select test.check((select count(*) = 0 from approval_requests where id = (select id from eh_r where name = 'dh_b')), 'and does not even see it (RLS)');
select test.login('eh_dhb');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'dh_b'), true, null, null, null)$$, 'a Department Head cannot approve another Department Head', 'NOT_FOUND|not the approver');
select test.login('eh_oh1');
select test.check((select count(*) = 1 from approval_requests where id = (select id from eh_r where name = 'dh_b')) and (select count(*) = 0 from approval_requests where id = (select id from eh_r where name = 'dh_c')), 'an Operations Head sees only the requests of the departments they own');
select employee_request_decide((select id from eh_r where name = 'dh_b'), true, 'ok', null, null);
reset role;
select test.check((select status = 'ACTIVE' and role = 'DEPARTMENT_HEAD' and department_id = test.ehd('eh-b') and head_division = 'SUPPORT' from profiles where id = test.id('eh_newdh_b')), 'approved by the owner: an active Support Department Head of Beta');
-- Gamma's request: reject with a reason, then HR corrects and resubmits
set role authenticated;
select test.login('eh_oh2');
select employee_request_decide((select id from eh_r where name = 'dh_c'), false, 'Wrong department - this person joins Delta', null, null);
reset role;
select test.check((select status = 'REJECTED' from profiles where id = test.id('eh_newdh_c')) and (select status = 'REJECTED' and decision_note like 'Wrong department%' from approval_requests where id = (select id from eh_r where name = 'dh_c')), 'rejected: inactive, with the reason recorded');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('eh_hr') and type = 'EMPLOYEE_REQUEST_REJECTED' and body like '%Wrong department%'), 'HR is told with the reason');
select test.must_fail($$update profiles set status = 'ACTIVE' where id = test.id('eh_newdh_c')$$, 'a rejected employee cannot be reactivated around the approval', 'no completed approval|Cannot change account status');

\echo '   no accountable owner: the request waits and the Super Admin is told'
-- eh-d was given to the new Operations Head above: the Super Admin takes it back, so that it has no owner
set role authenticated;
select test.login('sa');
select operations_head_scope_set(test.id('eh_newoh'), array[]::uuid[], array[]::uuid[]);
reset role;
set role authenticated;
select test.login('eh_hr');
select employee_request_resubmit((select id from eh_r where name = 'dh_c'), 'DEPARTMENT_HEAD', false, test.ehd('eh-d'), 'SALES', null, null);
reset role;
select test.check(private.owner_of_department(test.ehd('eh-d')) is null, 'the department has no accountable Operations Head now');
select test.check((select status = 'PENDING' and approver_id = test.id('eh_oh1') is not true and attempt = 2 and resubmission_of = (select id from eh_r where name = 'dh_c') from approval_requests where subject_user_id = test.id('eh_newdh_c') and status = 'PENDING'),
  'the corrected request is a new attempt linked to the rejected one');
select test.check((select approver_id is null from approval_requests where subject_user_id = test.id('eh_newdh_c') and status = 'PENDING'), 'with no owner it has no approver - it is not handed to an unrelated person');
select test.check((select count(*) = 2 from approval_requests where subject_user_id = test.id('eh_newdh_c')) and (select count(*) = 1 from profiles where email = 'eh.newdh.c@example.com'), 'the history is kept and there is still one employee record');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('sa') and type = 'DEPARTMENT_OWNER_MISSING'), 'the Super Admin is told that the department needs an owner');
set role authenticated;
select test.login('eh_oh1');
select test.must_fail($$select employee_request_decide((select id from approval_requests where subject_user_id = test.id('eh_newdh_c') and status = 'PENDING'), true, null, null, null)$$, 'no Operations Head can approve while nobody owns it', 'NOT_FOUND|not the approver');
select test.login('sa');
select operations_head_scope_set(test.id('eh_oh2'), array[test.ehd('eh-c'), test.ehd('eh-d')], array[test.ehd('eh-c'), test.ehd('eh-d')]);
reset role;
select test.check((select approver_id = test.id('eh_oh2') from approval_requests where subject_user_id = test.id('eh_newdh_c') and status = 'PENDING'), 'when the Super Admin names the owner, the waiting request moves to them');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('eh_oh2') and type = 'DEPARTMENT_OWNER_ASSIGNED' and entity_id = test.ehd('eh-d')), 'and they are told, once');

\echo '   Team Lead and Team Member: the respective Department Head decides'
select test.service();
select test.create_auth_user('eh_tl1', 'eh.tl1@example.com', '{"full_name":"EH Lead One"}', test.ehapp('eh_hr', 'TEAM_HEAD', false, 'eh-a', 'SALES'));
select test.service();
select test.create_auth_user('eh_tl2', 'eh.tl2@example.com', '{"full_name":"EH Lead Two"}', test.ehapp('eh_hr', 'TEAM_HEAD', false, 'eh-a', 'SALES'));
select test.service();
select test.create_auth_user('eh_tlb', 'eh.tlb@example.com', '{"full_name":"EH Lead Beta"}', test.ehapp('eh_hr', 'TEAM_HEAD', false, 'eh-b', 'SALES'));
select test.service();
select test.create_auth_user('eh_tm1', 'eh.tm1@example.com', '{"full_name":"EH Member One"}', test.ehapp('eh_hr', 'TEAM_MEMBER', false, 'eh-a', 'SALES'));
select test.service();
select test.create_auth_user('eh_tm2', 'eh.tm2@example.com', '{"full_name":"EH Member Two"}', test.ehapp('eh_hr', 'TEAM_MEMBER', false, 'eh-a', 'SALES'));
select test.service();
select test.create_auth_user('eh_tmx', 'eh.tmx@example.com', '{"full_name":"EH Member Unapproved"}', test.ehapp('eh_hr', 'TEAM_MEMBER', false, 'eh-a', 'SALES'));
insert into eh_r select n, (select id from approval_requests where subject_user_id = test.id('eh_' || n)) from (values ('tl1'), ('tl2'), ('tlb'), ('tm1'), ('tm2'), ('tmx')) v(n);
select test.check((select bool_and(approver_kind = 'DEPARTMENT_HEAD' and approver_id = test.id('eh_dha')) from approval_requests where subject_user_id in (test.id('eh_tl1'), test.id('eh_tl2'), test.id('eh_tm1'), test.id('eh_tm2'))), 'Team Lead and Team Member requests go to the respective Department Head');
select test.check((select count(*) = 0 from profiles where id in (test.id('eh_tl1'), test.id('eh_tm1')) and status = 'ACTIVE'), 'none of them has access before approval');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('eh_dha') and entity_id = (select id from eh_r where name = 'tm1')), 'the Department Head is told once per request');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad', 'eh.bad@example.com', '{}', test.ehapp('eh_dhb', 'TEAM_MEMBER', false, 'eh-b'))$$, 'only HR can submit an employee request', 'cannot submit');
set role authenticated;
select test.login('eh_dhb');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'tl1'), true, null, null, null)$$, 'a Department Head cannot approve employees of another department', 'NOT_FOUND|not the approver');
select test.login('eh_oh1');
select test.must_fail($$select employee_request_decide((select id from eh_r where name = 'tl1'), true, null, null, null)$$, 'nor an Operations Head - Team Leads are the Department Head''s', 'NOT_FOUND|not the approver');
select test.login('eh_dhc');
select test.check((select count(*) = 0 from approval_requests where id = (select id from eh_r where name = 'tl1')), 'a Department Head of another department does not see them');
select test.login('eh_dha');
select employee_request_decide((select id from eh_r where name = 'tl1'), true, null, null, null);
select employee_request_decide((select id from eh_r where name = 'tl2'), true, null, null, null);
select employee_request_decide((select id from eh_r where name = 'tm1'), true, null, null, null);
select employee_request_decide((select id from eh_r where name = 'tm2'), true, null, null, null);
select test.login('eh_dhb');
select employee_request_decide((select id from eh_r where name = 'tlb'), true, null, null, null);
reset role;
select test.check((select bool_and(status = 'ACTIVE' and team_id is not null) from profiles where id in (test.id('eh_tl1'), test.id('eh_tl2'), test.id('eh_tm1'), test.id('eh_tm2'), test.id('eh_tlb'))), 'approved: active, and placed (a Team Lead in a team of their own, a Team Member in the department pool)');
select test.check((select count(distinct team_id) = 2 from profiles where id in (test.id('eh_tl1'), test.id('eh_tl2'))), 'each Team Lead leads a team of their own');
select test.check((select bool_and(t.is_pool) from profiles p join teams t on t.id = p.team_id where p.id in (test.id('eh_tm1'), test.id('eh_tm2'))), 'Team Members wait in the pool');
select test.check((select status = 'PENDING' from profiles where id = test.id('eh_tmx')), 'an unapproved employee is not active');

\echo '   a Team Lead adds a Team Member directly; only HR submits a request'
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad1', 'eh.bad1@example.com', '{}', test.ehapp('eh_tl1', 'TEAM_MEMBER', false, 'eh-a'))$$, 'a Team Lead can no longer send a team member for approval', 'cannot submit');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad2', 'eh.bad2@example.com', '{}', test.ehapp('eh_tl1', 'TEAM_HEAD', false, 'eh-a'))$$, 'nor a Team Lead', 'cannot submit');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad3', 'eh.bad3@example.com', '{}', test.ehapp('eh_tl1', 'TEAM_MEMBER', false, 'eh-b'))$$, 'nor for another department', 'cannot submit');
select test.service();
select test.create_auth_user('eh_tm3', 'eh.tm3@example.com', '{"full_name":"EH Member Three"}',
  jsonb_build_object('provisioned_by', test.id('eh_tl1'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select team_id from profiles where id = test.id('eh_tl1'))));
select test.check((select status = 'ACTIVE' and role = 'TEAM_MEMBER' and team_id = (select team_id from profiles where id = test.id('eh_tl1')) and department_id = (select department_id from profiles where id = test.id('eh_tl1')) and approved_by = test.id('eh_tl1') from profiles where id = test.id('eh_tm3')),
  'the Team Member is active at once, in the Team Lead''s own team and department');
select test.check((select count(*) = 0 from approval_requests where subject_user_id = test.id('eh_tm3')), 'with no approval request');
select test.check((select count(*) = 1 from audit_logs where action = 'USER_CREATED' and entity_id = test.id('eh_tm3') and actor_id = test.id('eh_tl1')), 'and the Team Lead is recorded as the creator');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad4', 'eh.bad4@example.com', '{}', jsonb_build_object('provisioned_by', test.id('eh_tl1'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', (select team_id from profiles where id = test.id('eh_tl1'))))$$, 'a Team Lead cannot create a Team Lead directly', 'not allowed');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad5', 'eh.bad5@example.com', '{}', jsonb_build_object('provisioned_by', test.id('eh_tl1'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select team_id from profiles where id = test.id('eh_tlb'))))$$, 'nor a member of another team or department', 'not allowed');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad6', 'eh.bad6@example.com', '{}', jsonb_build_object('provisioned_by', test.id('eh_tl1'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.ehd('eh-a')))$$, 'nor a Department Head', 'not allowed');
select test.service();
select test.must_fail($$select test.create_auth_user('eh_bad7', 'eh.bad7@example.com', '{}', jsonb_build_object('provisioned_by', test.id('eh_hr'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select team_id from profiles where id = test.id('eh_tl1'))))$$, 'HR cannot create anybody directly, around the approval', 'not allowed');
select test.service();
-- a Department Head still adds a Team Member directly
select test.create_auth_user('eh_tm4', 'eh.tm4@example.com', '{"full_name":"EH Member Four"}',
  jsonb_build_object('provisioned_by', test.id('eh_dha'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select team_id from profiles where id = test.id('eh_tl1'))));
select test.check((select status = 'ACTIVE' from profiles where id = test.id('eh_tm4')) and (select count(*) = 0 from approval_requests where subject_user_id = test.id('eh_tm4')), 'a Department Head still adds a person directly');
-- the Sales role: a Team Lead sets it for a member of their own Sales team only
set role authenticated;
select test.login('eh_tl1');
select test.check((select set_sales_sub_role(test.id('eh_tm3'), 'TELECALLER') ->> 'defaultDashboard' = 'telecaller'), 'a Team Lead gives a Telecaller role to a member of their own Sales team (the dashboard follows)');
select test.check((select set_sales_sub_role(test.id('eh_tm3'), 'BUSINESS_ASSOCIATE') ->> 'salesSubRole' = 'BUSINESS_ASSOCIATE'), 'and a Business Associate role');
select test.must_fail($$select set_sales_sub_role(test.id('eh_tm2'), 'TELECALLER')$$, 'but not to a member of another team', 'Only the Super Admin');
select test.must_fail($$select set_sales_sub_role(test.id('eh_tm3'), 'MANAGER')$$, 'and only a Sales role', 'Choose Telecaller');
select test.login('eh_hr');
select test.must_fail($$select set_sales_sub_role(test.id('eh_tm3'), 'TELECALLER')$$, 'HR cannot set it', 'Only the Super Admin');
select test.login('eh_tl1');
select test.must_fail($$select assert_can_create_user('TEAM_HEAD', test.ehd('eh-a'), (select team_id from profiles where id = test.id('eh_tl1')), null)$$, 'the form check refuses a Team Lead creating a Team Lead', 'not allowed');
select test.check((select assert_can_create_user('TEAM_MEMBER', test.ehd('eh-a'), (select team_id from profiles where id = test.id('eh_tl1')), null)), 'and allows a Team Member of their own team');
select test.login('eh_hr');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', test.ehd('eh-a'), (select team_id from profiles where id = test.id('eh_tl1')), null)$$, 'HR is told to send an employee request', 'employee request');
reset role;

\echo '   direct paths around the approval are closed'
set role authenticated;
select test.login('eh_dha');
select test.must_fail($$select approve_registration((select id from approval_requests where subject_user_id = test.id('eh_tmx')), (select id from teams where department_id = test.ehd('eh-a') and name = 'Sales'), null)$$, 'the registration approval cannot decide an HR request', 'decided only through|no completed approval');
select test.must_fail($$update approval_requests set status = 'APPROVED', decided_at = now() where subject_user_id = test.id('eh_tmx')$$, 'nor can a table update', 'permission denied|decided only through|0 rows');
select test.login('eh_hr');
select test.must_fail($$insert into approval_requests (request_type, subject_user_id, status, source) values ('USER_REGISTRATION', test.id('eh_tmx'), 'APPROVED', 'HR')$$, 'nor an insert', 'permission denied|row-level security');
reset role;
select test.must_fail($$insert into approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, approver_kind) values ('USER_REGISTRATION', test.id('eh_tmx'), test.ehd('eh-a'), 'PENDING', 'HR', 'TEAM_MEMBER', 'DEPARTMENT_HEAD')$$, 'there is one open request per employee', 'duplicate key');

\echo '   assignment is a separate step: Department Head puts a Team Member under a Team Lead'
create temp table eh_n as select count(*) as requests from approval_requests where source <> 'REGISTRATION';
grant all on eh_n to authenticated, service_role;
set role authenticated;
select test.login('eh_dha');
select test.check((select jsonb_array_length(department_employee_directory() -> 'members') >= 2 and (department_employee_directory() -> 'members') @> jsonb_build_array(jsonb_build_object('id', test.id('eh_tm1'), 'state', 'AWAITING_ASSIGNMENT'))
  from (select 1) x) or exists (select 1 from jsonb_array_elements(department_employee_directory() -> 'members') m where m ->> 'id' = test.id('eh_tm1')::text and m ->> 'state' = 'AWAITING_ASSIGNMENT'),
  'the approved Team Member is in the directory, awaiting assignment');
select test.check(not exists (select 1 from jsonb_array_elements(department_employee_directory() -> 'members') m where m ->> 'id' = test.id('eh_tmx')::text), 'an unapproved employee is not listed');
select test.check((select count(*) = 2 from jsonb_array_elements(department_employee_directory() -> 'leads') l where l ->> 'id' in (test.id('eh_tl1')::text, test.id('eh_tl2')::text)), 'the active Team Leads of the department are offered');
select test.check(not exists (select 1 from jsonb_array_elements(department_employee_directory() -> 'leads') l where l ->> 'id' = test.id('eh_tlb')::text), 'and not a Team Lead of another department');
select assign_member_to_team_lead(test.id('eh_tm1'), test.id('eh_tl1'), 'first assignment');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm1'), test.id('eh_tl1'), null)$$, 'assigning to the same lead again is refused', 'already under');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm2'), test.id('eh_tlb'), null)$$, 'a Team Lead of another department is refused', 'Team Lead of this department');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tmx'), test.id('eh_tl1'), null)$$, 'an unapproved employee cannot be assigned', 'NOT_FOUND|active');
select test.login('eh_dhb');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm2'), test.id('eh_tl2'), null)$$, 'another department''s head cannot assign', 'NOT_FOUND|FORBIDDEN|own department');
select test.login('eh_oh1');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm2'), test.id('eh_tl2'), null)$$, 'an Operations Head does not assign teams - the Department Head does', 'FORBIDDEN|Only a Department Head');
select test.login('eh_hr');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm2'), test.id('eh_tl2'), null)$$, 'HR cannot', 'FORBIDDEN|Only a Department Head');
select test.login('eh_tl1');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm2'), test.id('eh_tl1'), null)$$, 'a Team Lead cannot pull members into their own team', 'FORBIDDEN|Only a Department Head');
reset role;
select test.check((select team_id = (select team_id from profiles where id = test.id('eh_tl1')) from profiles where id = test.id('eh_tm1')), 'the Team Member is in the Team Lead''s team');
select test.check((select count(*) = 1 from team_assignments where profile_id = test.id('eh_tm1') and kind = 'ASSIGNMENT' and lead_id = test.id('eh_tl1') and assigned_by = test.id('eh_dha') and note = 'first assignment'), 'who assigned, to whom and when is recorded');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('eh_tl1') and type = 'TEAM_MEMBER_ASSIGNED') and (select count(*) = 1 from notifications where recipient_id = test.id('eh_tm1') and type = 'TEAM_ASSIGNED'), 'the Team Lead and the employee are told');
select test.check((select count(*) = (select requests from eh_n) from approval_requests where source <> 'REGISTRATION'), 'the assignment created no employee request');
set role authenticated;
select test.login('eh_tl1');
select test.check((select count(*) = 1 from profiles where id = test.id('eh_tm1')), 'the Team Lead sees the new member in their team');
select test.check((select count(*) = 2 from team_assignments where profile_id = test.id('eh_tm1')), 'and the assignment history (the approval placement and the assignment)');
select test.login('eh_dha');
select assign_member_to_team_lead(test.id('eh_tm1'), test.id('eh_tl2'), 'moved');
reset role;
select test.check((select count(*) = 3 from team_assignments where profile_id = test.id('eh_tm1')) and (select kind = 'REASSIGNMENT' from team_assignments where profile_id = test.id('eh_tm1') order by created_at desc, id limit 1), 'a reassignment keeps the earlier assignment as history');
select test.check((select count(*) = 1 from profiles where email = 'eh.tm1@example.com') and (select count(*) = (select requests from eh_n) from approval_requests where source <> 'REGISTRATION'), 'one employee record, and still no new employee request');
update profiles set status = 'SUSPENDED' where id = test.id('eh_tl2');
set role authenticated;
select test.login('eh_dha');
select test.must_fail($$select assign_member_to_team_lead(test.id('eh_tm2'), test.id('eh_tl2'), null)$$, 'an inactive Team Lead cannot receive members', 'not active');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('eh_tl2');

\echo '   the Operations Head dashboard: only the assigned departments, with real data'
set role authenticated;
select test.login('eh_oh1');
reset role;
select test.check((select count(distinct department_id) from private.scopes_of(test.id('eh_oh1')) where department_id in (test.ehd('eh-a'), test.ehd('eh-b'))) = 2, 'the Operations Head manages Alpha and Beta');
set role authenticated;
select test.login('eh_oh1');
select test.check(exists (select 1 from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'id' = test.ehd('eh-a')::text) and exists (select 1 from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'id' = test.ehd('eh-b')::text),
  'it lists the assigned departments');
select test.check(not exists (select 1 from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'id' in (test.ehd('eh-c')::text, test.ehd('eh-d')::text)), 'and not an unassigned one');
select test.check((select (x ->> 'teamLeads')::int = 2 and (x ->> 'teamMembers')::int = 4 and (x ->> 'awaitingAssignment')::int = 1 from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'id' = test.ehd('eh-a')::text),
  'Alpha: 2 Team Leads, 4 Team Members (two approved, two added directly), 1 awaiting assignment (actual counts)');
select test.check((select jsonb_array_length(x -> 'departmentHeads') = 1 and x -> 'departmentHeads' -> 0 ->> 'name' = 'EH Head Alpha' from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'id' = test.ehd('eh-a')::text), 'the responsible Department Head is shown');
reset role;
insert into auth_login_attempts (user_id) values (test.id('eh_dha'));
set role authenticated;
select test.login('eh_oh1');
select test.check(exists (select 1 from jsonb_array_elements(operations_department_activity(test.ehd('eh-a'))) a where a ->> 'type' = 'EMPLOYEE_REQUEST_APPROVED' and a ->> 'departmentHead' = 'EH Head Alpha' and a ->> 'department' = 'EH Alpha'), 'the Department Head''s approvals appear in their department''s activity');
select test.check(exists (select 1 from jsonb_array_elements(operations_department_activity(test.ehd('eh-a'))) a where a ->> 'type' = 'TEAM_MEMBER_ASSIGNED'), 'and their team assignments');
select test.check(exists (select 1 from jsonb_array_elements(operations_department_activity(test.ehd('eh-a'))) a where a ->> 'type' = 'LOGIN'), 'and their sign-ins');
select test.check(not exists (select 1 from jsonb_array_elements(operations_department_activity(test.ehd('eh-a'))) a where a::text ~* 'password|token'), 'with no secrets');
select test.must_fail($$select operations_department_activity(test.ehd('eh-c'))$$, 'activity of an unassigned department is not available', 'NOT_FOUND');
select test.must_fail($$select operations_department_detail(test.ehd('eh-c'))$$, 'nor its detail', 'NOT_FOUND');
select test.check((select jsonb_array_length(operations_department_detail(test.ehd('eh-a')) -> 'teamLeads') = 2), 'the detail of an assigned department lists its Team Leads');
select test.login('eh_dha');
select test.must_fail($$select operations_dashboard()$$, 'a plain Department Head has no Operations dashboard', 'Operations Heads');

\echo '   changing the scope cuts access at once and keeps the history'
select test.login('sa');
select operations_head_scope_set(test.id('eh_oh1'), array[test.ehd('eh-a')], array[test.ehd('eh-a')]);
reset role;
select test.check(not exists (select 1 from private.scopes_of(test.id('eh_oh1')) where department_id = test.ehd('eh-b')), 'Beta is no longer in the scope');
select test.check(private.owner_of_department(test.ehd('eh-b')) is null and private.owner_of_department(test.ehd('eh-a')) = test.id('eh_oh1'), 'and no longer theirs to approve for');
select test.check((select count(*) = 1 from approval_requests where id = (select id from eh_r where name = 'dh_b') and decided_by = test.id('eh_oh1') and status = 'APPROVED'), 'the approval they made for Beta is kept, with them as the approver');
select test.check((select count(*) >= 1 from audit_logs where action = 'OPERATIONS_SCOPE_SET' and entity_id = test.id('eh_oh1') and metadata ? 'before' and metadata ? 'after'), 'the old and new scope are audited');
select test.check((select count(*) >= 1 from audit_logs where action = 'EMPLOYEE_REQUEST_APPROVED' and actor_id = test.id('eh_oh1') and department_id = test.ehd('eh-b')), 'historical activity is still there');
set role authenticated;
select test.login('eh_oh1');
select test.check(not exists (select 1 from jsonb_array_elements(operations_dashboard() -> 'departments') x where x ->> 'id' = test.ehd('eh-b')::text), 'the dashboard no longer shows Beta');
select test.must_fail($$select operations_department_activity(test.ehd('eh-b'))$$, 'nor its activity', 'NOT_FOUND');
select test.login('sa');
select test.check((select jsonb_array_length(operations_head_activity(test.id('eh_oh1'))) >= 2), 'the Super Admin can review their approval and scope history');

\echo '   nothing existing was disturbed'
reset role;
select test.check((select count(*) >= (select active_profiles from eh_before) from profiles where status = 'ACTIVE'), 'no existing active employee lost access');
select test.check((select count(*) = 0 from approval_requests where source = 'REGISTRATION' and status = 'PENDING' and updated_at > now() - interval '1 hour' and request_type <> 'USER_REGISTRATION'), 'self-registration requests keep their own flow');
