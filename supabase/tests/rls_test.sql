-- =============================================================================
-- Authorization test-suite. Run against a database with the shim + all
-- migrations applied (see supabase/tests/run.sh). Each scenario switches to the
-- `authenticated` role with a forged JWT `sub`, exactly like PostgREST does.
-- Any failed assertion aborts the run (ON_ERROR_STOP).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

create schema test;
grant usage on schema test to anon, authenticated;
create table test.users (name text primary key, id uuid not null);
grant select on test.users to anon, authenticated;

create function test.id(p_name text) returns uuid language sql stable as
  $$ select id from test.users where name = p_name $$;

create function test.login(p_name text) returns void language sql as $$
  select set_config('request.jwt.claims',
    json_build_object('sub', test.id(p_name), 'role', 'authenticated')::text, false)
$$;

create function test.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'TEST FAILED: %', p_label; end if;
  raise notice 'ok - %', p_label;
end $$;

-- Execute SQL that MUST fail; optionally assert on the error text.
create function test.must_fail(p_sql text, p_label text, p_pattern text default null) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if p_pattern is not null and sqlerrm !~* p_pattern then
      raise exception 'TEST FAILED: % (unexpected error: %)', p_label, sqlerrm;
    end if;
    raise notice 'ok - % [%]', p_label, sqlerrm;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;

-- Execute SQL and return affected/returned row count (for "silently filtered" checks).
create function test.rows(p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  execute p_sql; get diagnostics v = row_count; return v;
end $$;

grant execute on all functions in schema test to anon, authenticated;

-- Simulates GoTrue / auth.admin.createUser (runs as the privileged auth role).
create function test.create_auth_user(p_name text, p_email text, p_user_meta jsonb, p_app_meta jsonb)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values (v, p_email, p_user_meta, p_app_meta);
  insert into test.users values (p_name, v);
  return v;
end $$;

create function test.team(p_department text, p_team text) returns uuid language sql stable as $$
  select t.id from public.teams t join public.departments d on d.id = t.department_id
  where d.slug = p_department and t.name = p_team
$$;
create function test.dept(p_slug text) returns uuid language sql stable as
  $$ select id from public.departments where slug = p_slug $$;
grant execute on all functions in schema test to anon, authenticated;

-- ---------------------------------------------------------------------------
\echo '--- 1. Provisioning & hierarchy'
-- ---------------------------------------------------------------------------
select test.create_auth_user('sa', 'root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}');
select test.check((select role = 'SUPER_ADMIN' and status = 'ACTIVE' from profiles where id = test.id('sa')), 'bootstrap creates active super admin');
select test.must_fail($$select test.create_auth_user('sa2', 'x@amuwa.com', '{}', '{"bootstrap_super_admin":true}')$$,
  'second bootstrap super admin is refused', 'already exists');

select test.create_auth_user('dh_wab', 'dh.wab@amuwa.com', '{"full_name":"DH Wabastore"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore')));
select test.create_auth_user('th_wab', 'th.wab@amuwa.com', '{"full_name":"TH Wab Sales"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('tm_a', 'a@amuwa.com', '{"full_name":"Member A"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('tm_b', 'b@amuwa.com', '{"full_name":"Member B"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('dh_wbx', 'dh.wbx@amuwa.com', '{"full_name":"DH Whatsbox"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('whatsbox')));
select test.create_auth_user('th_wbx', 'th.wbx@amuwa.com', '{"full_name":"TH Whatsbox"}',
  jsonb_build_object('provisioned_by', test.id('dh_wbx'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
select test.create_auth_user('tm_c', 'c@amuwa.com', '{"full_name":"Member C"}',
  jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
select test.check((select team_id = test.team('wabastore', 'Sales') and department_id = test.dept('wabastore') from profiles where id = test.id('tm_a')),
  'provisioned member gets team + derived department');

select test.must_fail($$select test.create_auth_user('x1', 'x1@amuwa.com', '{}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore')))$$,
  'team head cannot create a department head', 'FORBIDDEN');
select test.must_fail($$select test.create_auth_user('x2', 'x2@amuwa.com', '{}',
  jsonb_build_object('provisioned_by', test.id('tm_a'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')))$$,
  'team member cannot create users', 'FORBIDDEN');
select test.must_fail($$select test.create_auth_user('x3', 'x3@amuwa.com', '{}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('whatsbox', 'Sales')))$$,
  'department head cannot create users in another department', 'FORBIDDEN');
select test.must_fail($$select test.create_auth_user('x4', 'x4@amuwa.com', '{}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'SUPER_ADMIN'))$$,
  'nobody can provision a super admin', 'FORBIDDEN');
select test.must_fail($$select test.create_auth_user('x5', 'x5@amuwa.com', '{}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support')))$$,
  'team head cannot create users in a sibling team', 'FORBIDDEN');

-- ---------------------------------------------------------------------------
\echo '--- 2. Self-registration → pending approval'
-- ---------------------------------------------------------------------------
select test.create_auth_user('pending_d', 'd@amuwa.com',
  jsonb_build_object('full_name', 'New D', 'role', 'SUPER_ADMIN', 'department_id', test.dept('wabastore'), 'team_id', test.team('wabastore', 'Sales')),
  '{}');
select test.check((select role = 'TEAM_MEMBER' and status = 'PENDING' from profiles where id = test.id('pending_d')),
  'self-registration ignores requested role → TEAM_MEMBER + PENDING');
select test.check((select count(*) = 1 from approval_requests where subject_user_id = test.id('pending_d') and status = 'PENDING'),
  'approval request created');
select test.check((select count(*) = 2 from notifications where type = 'USER_REGISTRATION_REQUEST'
                   and recipient_id in (test.id('th_wab'), test.id('dh_wab'))),
  'team head and department head notified');
select test.check((select count(*) = 0 from notifications where type = 'USER_REGISTRATION_REQUEST'
                   and recipient_id in (test.id('th_wbx'), test.id('dh_wbx'), test.id('tm_a'))),
  'unrelated users are not notified');

select test.create_auth_user('pending_e', 'e@amuwa.com', '{"full_name":"Orphan E","department_id":"not-a-uuid"}', '{}');
select test.check((select count(*) = 1 from notifications where type = 'USER_REGISTRATION_REQUEST' and recipient_id = test.id('sa')),
  'registration without valid department escalates to super admin');

set role authenticated;
select test.login('pending_d');
select test.check((select count(*) = 1 from profiles), 'pending user sees only own profile');
select test.check((select count(*) = 0 from departments), 'pending user cannot read departments');
select test.check((select count(*) = 1 from approval_requests), 'pending user sees own approval request');
select test.must_fail($$update profiles set role = 'SUPER_ADMIN' where id = test.id('pending_d')$$,
  'pending user cannot change own role', 'permission denied');
select test.must_fail($$update profiles set status = 'ACTIVE' where id = test.id('pending_d')$$,
  'pending user cannot activate self', 'permission denied');
select test.must_fail($$insert into customers (name, email) values ('X', 'x@x.com')$$,
  'pending user cannot create customers');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 3. Approval workflow'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select approve_registration((select id from approval_requests limit 1))$$,
  'team member cannot approve (cannot even see request)', 'NOT_FOUND|null');
select test.check((select count(*) = 0 from approval_requests), 'team member sees no approval requests');
select test.login('th_wbx');
reset role;
create temp table req as select id from approval_requests where subject_user_id = test.id('pending_d');
grant select on req to authenticated;
set role authenticated;
select test.must_fail($$select approve_registration((select id from req))$$,
  'team head of another department cannot approve', 'NOT_FOUND');
select test.login('pending_d');
select test.must_fail($$select approve_registration((select id from req))$$,
  'user cannot approve own registration', 'FORBIDDEN');
select test.login('th_wab');
select test.check((select count(*) = 1 from approval_requests where status = 'PENDING'), 'responsible team head sees the request');
select test.check((select status = 'APPROVED' from approve_registration((select id from req))), 'team head approves registration');
select test.must_fail($$select approve_registration((select id from req))$$, 'cannot approve twice', 'CONFLICT');
reset role;
select test.check((select status = 'ACTIVE' and approved_by = test.id('th_wab') from profiles where id = test.id('pending_d')),
  'PENDING → ACTIVE, approver recorded');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('pending_d') and type = 'USER_APPROVED'),
  'approved user notified');
select test.check((select count(*) = 1 from audit_logs where action = 'USER_APPROVED' and entity_id = test.id('pending_d') and actor_id = test.id('th_wab')),
  'approval audited with actor');

set role authenticated;
select test.login('sa');
select test.check((select status = 'REJECTED' from reject_registration(
  (select id from approval_requests where subject_user_id = test.id('pending_e')), 'Unknown person')), 'super admin rejects registration');
reset role;
select test.check((select status = 'REJECTED' from profiles where id = test.id('pending_e')), 'PENDING → REJECTED');

-- ---------------------------------------------------------------------------
\echo '--- 4. Customers: ownership & hierarchy'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('tm_a');
insert into customers (name, email, phone, company) values ('Acme Buyer', 'Buyer@Acme.com', '+91 98765 43210', 'Acme');
select test.check((select owner_id = test.id('tm_a') and team_id = test.team('wabastore', 'Sales')
                   and department_id = test.dept('wabastore') and created_by = test.id('tm_a') and email = 'buyer@acme.com'
                   from customers), 'customer owner/team/department derived server-side');
select test.must_fail($$insert into customers (name, email, owner_id) values ('Y', 'y@y.com', test.id('tm_b'))$$,
  'team member cannot create customers for someone else', 'FORBIDDEN');
select test.must_fail($$insert into customers (name, email, team_id) values ('Y', 'y@y.com', test.team('whatsbox', 'Sales'))$$,
  'team member cannot set team_id', 'permission denied');
select test.must_fail($$insert into customers (name, email) values ('Dup', 'buyer@acme.com')$$,
  'duplicate e-mail in department rejected', 'duplicate|unique');
select test.must_fail($$insert into customers (name) values ('No contact')$$, 'customer needs email or phone', 'check');
select test.must_fail($$insert into customers (name, email) values ('Bad', 'not-an-email')$$, 'email format enforced', 'check');
select test.check(test.rows($$update customers set company = 'Acme Corp' where name = 'Acme Buyer'$$) = 1, 'owner updates own customer');
select test.must_fail($$update customers set owner_id = test.id('tm_b') where name = 'Acme Buyer'$$,
  'team member cannot reassign customer', 'FORBIDDEN');
select test.check(test.rows($$delete from customers$$) = 0, 'team member cannot delete customers');

select test.login('tm_b');
select test.check((select count(*) = 0 from customers), 'teammate cannot see another member''s customers');
select test.check(test.rows($$update customers set name = 'hacked'$$) = 0, 'teammate cannot update another member''s customers');
select test.login('tm_c');
select test.check((select count(*) = 0 from customers), 'other department member sees nothing');
select test.login('th_wbx');
select test.check((select count(*) = 0 from customers), 'other department team head sees nothing');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from customers), 'other department head sees nothing');
select test.login('dh_wab');
select test.check((select count(*) = 1 from customers), 'department head sees department customers');
select test.login('sa');
select test.check((select count(*) = 1 from customers), 'super admin sees all customers');

select test.login('th_wab');
select test.check((select count(*) = 1 from customers), 'team head sees team customers');
select test.check(test.rows($$update customers set notes = 'VIP' where name = 'Acme Buyer'$$) = 1, 'team head updates team customer');
select test.check(test.rows($$update customers set owner_id = test.id('tm_b') where name = 'Acme Buyer'$$) = 1, 'team head reassigns within team');
select test.must_fail($$update customers set owner_id = test.id('tm_c') where name = 'Acme Buyer'$$,
  'team head cannot reassign outside team', 'FORBIDDEN');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('th_wab') and type = 'CUSTOMER_CREATED'),
  'team head notified of new customer');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('tm_a') and type = 'CUSTOMER_UPDATED'),
  'owner notified when manager edits customer');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_b') and type = 'CUSTOMER_ASSIGNED'),
  'new owner notified on reassignment');
select test.check((select count(*) = 1 from audit_logs where action = 'CUSTOMER_CREATED' and actor_id = test.id('tm_a')), 'CUSTOMER_CREATED audited');
select test.check((select count(*) = 1 from audit_logs where action = 'CUSTOMER_REASSIGNED'), 'CUSTOMER_REASSIGNED audited');
select test.check((select metadata -> 'changes' ? 'notes' from audit_logs where action = 'CUSTOMER_UPDATED' order by id desc limit 1),
  'update audit records changed fields');

set role authenticated;
select test.login('tm_b');
insert into customer_activities (customer_id, type, note) select id, 'CALL', 'Intro call' from customers;
select test.check((select actor_id = test.id('tm_b') from customer_activities), 'activity actor set server-side');
select test.login('tm_a');
select test.check((select count(*) = 0 from customer_activities), 'activities follow customer visibility');
select test.must_fail($$insert into customer_activities (customer_id, type) select id, 'CALL' from customers where false union all select gen_random_uuid(), 'CALL'$$,
  'cannot log activity on invisible customer');

-- ---------------------------------------------------------------------------
\echo '--- 5. Status changes & revocation'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into customers (name, phone) values ('Second', '12345678');
select test.login('tm_b');
select test.must_fail($$select set_user_status(test.id('tm_a'), 'REVOKED')$$, 'member cannot revoke a peer', 'FORBIDDEN|NOT_FOUND');
select test.login('th_wab');
select test.must_fail($$select set_user_status(test.id('dh_wab'), 'REVOKED')$$, 'team head cannot revoke department head', 'FORBIDDEN');
select test.must_fail($$select set_user_status(test.id('tm_c'), 'REVOKED')$$, 'team head cannot revoke other team member', 'NOT_FOUND');
select test.must_fail($$select set_user_status(test.id('th_wab'), 'SUSPENDED')$$, 'cannot change own status', 'FORBIDDEN');
select test.check((select status = 'REVOKED' from set_user_status(test.id('tm_a'), 'REVOKED', 'Left company')), 'team head revokes team member');

select test.login('tm_a');
select test.check((select count(*) = 0 from customers), 'revoked user cannot read customers');
select test.check((select count(*) = 0 from notifications), 'revoked user cannot read notifications');
select test.check((select count(*) = 1 from profiles), 'revoked user still sees own profile (status screen)');
select test.must_fail($$insert into customers (name, phone) values ('Z', '12345678')$$, 'revoked user cannot create customers');
select test.check(test.rows($$update profiles set full_name = 'Still here' where id = test.id('tm_a')$$) = 0, 'revoked user cannot edit profile');

select test.login('th_wab');
select test.must_fail($$select set_user_status(test.id('tm_a'), 'SUSPENDED')$$, 'REVOKED → SUSPENDED is not allowed', 'Cannot change account status');
select test.login('dh_wab');
select test.check((select status = 'ACTIVE' from set_user_status(test.id('tm_a'), 'ACTIVE')), 'department head reinstates member');
select test.login('tm_a');
select test.check((select count(*) = 1 from customers), 'reinstated user regains access to own customers');
select test.login('dh_wbx');
select test.must_fail($$select set_user_status(test.id('th_wab'), 'SUSPENDED')$$, 'department head cannot touch other department', 'NOT_FOUND');
select test.login('sa');
select test.check((select status = 'SUSPENDED' from set_user_status(test.id('dh_wbx'), 'SUSPENDED')), 'super admin suspends department head');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from teams), 'suspended department head loses access');
select test.login('sa');
select test.check((select status = 'ACTIVE' from set_user_status(test.id('dh_wbx'), 'ACTIVE')), 'super admin reinstates department head');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'USER_REVOKED' and actor_id = test.id('th_wab')), 'revocation audited');

-- ---------------------------------------------------------------------------
\echo '--- 6. Role & team assignment'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('th_wab');
select test.must_fail($$select assign_user(test.id('tm_b'), 'TEAM_HEAD', null, test.team('wabastore', 'Sales'))$$,
  'team head cannot promote to team head', 'FORBIDDEN');
select test.login('tm_b');
select test.must_fail($$select assign_user(test.id('tm_b'), 'TEAM_HEAD', null, test.team('wabastore', 'Sales'))$$,
  'user cannot promote self', 'FORBIDDEN');
select test.login('dh_wab');
select test.check((select team_id = test.team('wabastore', 'Support') from assign_user(test.id('tm_b'), 'TEAM_MEMBER', null, test.team('wabastore', 'Support'))),
  'department head moves member to another team in department');
select test.check((select bool_and(team_id = test.team('wabastore', 'Support')) from customers where owner_id = test.id('tm_b')),
  'customers follow their owner to the new team');
select test.must_fail($$select assign_user(test.id('tm_b'), 'TEAM_MEMBER', null, test.team('whatsbox', 'Sales'))$$,
  'department head cannot move member to another department', 'FORBIDDEN');
select test.check((select role = 'TEAM_HEAD' from assign_user(test.id('tm_b'), 'TEAM_HEAD', null, test.team('wabastore', 'Support'))),
  'department head promotes member to team head');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'ROLE_CHANGED' and entity_id = test.id('tm_b')), 'ROLE_CHANGED audited');

-- ---------------------------------------------------------------------------
\echo '--- 7. Audit log & notifications protection'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('tm_a');
select test.check((select count(*) = 0 from audit_logs), 'team member cannot read audit log');
select test.must_fail($$insert into audit_logs (action, entity_type) values ('FAKE', 'profile')$$, 'cannot forge audit rows', 'permission denied');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from audit_logs where department_id = test.dept('wabastore')), 'other department head cannot read wabastore audit');
select test.login('dh_wab');
select test.check((select count(*) > 0 from audit_logs) and (select bool_and(department_id = test.dept('wabastore')) from audit_logs),
  'department head reads only own department audit');
select test.must_fail($$delete from audit_logs$$, 'cannot delete audit rows', 'permission denied');
select test.must_fail($$update audit_logs set action = 'X'$$, 'cannot edit audit rows', 'permission denied');

select test.login('tm_a');
select test.check((select count(*) > 0 from notifications) and (select bool_and(recipient_id = test.id('tm_a')) from notifications),
  'user reads only own notifications');
select test.check(test.rows($$update notifications set read_at = now() where read_at is null$$) > 0, 'user marks own notifications read');
select test.must_fail($$update notifications set title = 'x'$$, 'notification content is immutable', 'permission denied');
select test.must_fail($$insert into notifications (recipient_id, type, title) values (test.id('sa'), 'SPAM', 'x')$$, 'cannot create notifications directly', 'permission denied');

-- ---------------------------------------------------------------------------
\echo '--- 8. Departments, teams & announcements'
-- ---------------------------------------------------------------------------
select test.must_fail($$insert into departments (slug, name) values ('rogue', 'Rogue')$$, 'team member cannot create department', 'row-level security');
select test.login('dh_wab');
select test.must_fail($$insert into departments (slug, name) values ('rogue', 'Rogue')$$, 'department head cannot create department', 'row-level security');
select test.check(test.rows($$insert into teams (department_id, name, division) values (test.dept('wabastore'), 'Enterprise', 'SALES')$$) = 1,
  'department head creates team in own department');
select test.must_fail($$insert into teams (department_id, name) values (test.dept('whatsbox'), 'Rogue')$$, 'department head cannot create team elsewhere', 'row-level security');
select test.check(test.rows($$update departments set is_locked = true where slug = 'wabastore'$$) = 0, 'department head cannot lock departments');
select test.login('sa');
select test.check(test.rows($$insert into departments (slug, name) values ('newunit', 'New Unit')$$) = 1, 'super admin creates department');

select test.login('tm_a');
select test.must_fail($$select broadcast_announcement('Hi', 'x')$$, 'team member cannot broadcast', 'FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail(format($$select broadcast_announcement('Hi', 'x', 'normal', %L)$$, test.dept('wabastore')),
  'department head cannot broadcast to another department', 'FORBIDDEN');
select test.login('th_wab');
select test.check((select broadcast_announcement('Standup', 'At 10') = 2), 'team head broadcast reaches own team only (A + D)');
reset role;
select test.check((select count(*) = 0 from notifications where type = 'ANNOUNCEMENT' and recipient_id in (test.id('tm_c'), test.id('tm_b'))),
  'announcement not delivered outside the team');

-- ---------------------------------------------------------------------------
\echo '--- 9. Deletion'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select delete_user(test.id('pending_d'))$$, 'department head cannot hard-delete', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select delete_user(test.id('tm_a'))$$, 'cannot delete a user who owns customers', 'CONFLICT');
select test.must_fail($$select delete_user(test.id('sa'))$$, 'super admin cannot delete self', 'FORBIDDEN');
select delete_user(test.id('pending_e'));
reset role;
select test.check((select count(*) = 0 from auth.users where id = test.id('pending_e')), 'super admin deletes user');
select test.check((select count(*) = 1 from audit_logs where action = 'USER_DELETED' and actor_id = test.id('sa')), 'deletion audited');

set role authenticated;
select test.login('th_wab');
select test.check(test.rows($$delete from customers where name = 'Second'$$) = 1, 'team head deletes team customer');
reset role;
select test.check((select metadata -> 'snapshot' ->> 'name' = 'Second' from audit_logs where action = 'CUSTOMER_DELETED'),
  'customer deletion audited with snapshot');

-- ---------------------------------------------------------------------------
\echo '--- 10. Anonymous access & legacy tables'
-- ---------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select test.check((select jsonb_array_length(list_registration_options()) >= 11), 'anon can list sign-up options');
select test.must_fail($$select * from departments$$, 'anon cannot read departments', 'permission denied');
select test.must_fail($$select * from profiles$$, 'anon cannot read profiles', 'permission denied');
select test.must_fail($$select * from customers$$, 'anon cannot read customers', 'permission denied');
select test.must_fail($$select * from crm_leads$$, 'anon cannot read legacy crm_leads', 'permission denied');
select test.must_fail($$select * from hr_employees$$, 'anon cannot read HR data', 'permission denied');
select test.must_fail($$select approve_registration(gen_random_uuid())$$, 'anon cannot call workflow functions', 'permission denied');
select test.must_fail($$select * from rate_limit_consume('[{"key":"x","limit":1,"window":60}]')$$, 'anon cannot touch rate-limit counters', 'permission denied');
reset role;
insert into hr_employees (id, name, monthly_salary) values ('E1', 'Someone', '100000');
set role authenticated;
select test.login('tm_a');
select test.check((select count(*) = 0 from hr_employees), 'non-HR user cannot read HR employees');
select test.must_fail($$insert into hr_employees (id, name) values ('E2', 'x')$$, 'non-HR user cannot write HR employees', 'row-level security');
select test.check(test.rows($$select * from crm_leads$$) = 0, 'active user may query crm_leads');
select test.must_fail($$select * from rate_limit_consume('[{"key":"user:x","limit":1,"window":60}]')$$, 'signed-in users cannot reset or inflate rate-limit counters', 'permission denied');
select test.login('sa');
select test.check((select count(*) = 1 from hr_employees), 'super admin reads HR employees');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 11. Member workspace (shared across devices)'
-- ---------------------------------------------------------------------------
reset role;
insert into crm_leads (id, name, department) values ('L-pool', 'Pool lead', 'wabastore');
insert into crm_leads (id, name, department, assigned_to) values ('L-c', 'Lead of C', 'whatsbox', test.id('tm_c'));
set role authenticated;
select test.login('tm_a');
insert into member_follow_ups (lead_id, lead_name, type) values ('L-pool', 'Pool lead', 'Call');
insert into member_calendar_events (title, customer, event_date) values ('Demo', 'Pool lead', current_date);
select test.check((select count(*) = 1 from member_follow_ups), 'member sees own follow-up');
select test.check((select owner_id = test.id('tm_a') from member_calendar_events), 'owner defaults to the signed-in user');
select test.must_fail($$insert into member_deals (owner_id, lead_name) values (test.id('tm_c'), 'x')$$,
  'member cannot write rows for someone else', 'row-level security');
select test.check(test.rows($$update crm_leads set assigned_to = test.id('tm_a'), stage = 'Contacted' where id = 'L-pool'$$) = 1,
  'member claims an unassigned lead');
select test.must_fail($$update crm_leads set stage = 'Won' where id = 'L-c'$$,
  'member cannot work a lead assigned to someone else', 'FORBIDDEN');
select test.login('tm_c');
select test.check((select count(*) = 0 from member_follow_ups), 'other member cannot see the follow-up');
select test.check(test.rows($$delete from member_calendar_events$$) = 0, 'other member cannot delete the event');
select test.must_fail($$update crm_leads set assigned_to = test.id('tm_c') where id = 'L-pool'$$,
  'member cannot take over a claimed lead', 'FORBIDDEN');
select test.login('th_wab');
select test.check((select count(*) = 1 from member_follow_ups), 'team head reads team member follow-ups');
select test.check(test.rows($$update member_follow_ups set status = 'completed'$$) = 0, 'team head cannot edit member follow-ups');
select test.login('th_wbx');
select test.check((select count(*) = 0 from member_follow_ups), 'other team head cannot read them');
reset role;
select test.check((select count(*) = 0 from profiles where avatar_url is not null), 'no profile carries an avatar');

-- ---------------------------------------------------------------------------
\echo '--- 12. Sales pipeline: Lead → Potential → Onboarding'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('tm_a');
create temp table pipeline (name text primary key, id uuid);
reset role;
grant all on pipeline to authenticated;
set role authenticated;
insert into pipeline select 'A', create_lead(
  '{"name":"Ankit Shah","company":"Shree Ganesh Jewellers","phone":"+91 98765 11111","city":"Mumbai","leadSource":"Walk-in","businessCategory":"Jewellery / Gold"}',
  array['META_ADS_MANAGEMENT','YEARLY_GOLD_RATE_PACKAGE']);
select test.check((select lifecycle_stage = 'LEAD' and lead_status = 'NEW' and owner_id = test.id('tm_a') from customers where id = (select id from pipeline where name = 'A')),
  'create_lead stores one LEAD customer owned by the salesperson');
select test.check((select count(*) = 2 from customer_services where customer_id = (select id from pipeline where name = 'A')), 'services stored with the lead');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from pipeline where name = 'A') and type = 'LEAD_CREATED'), 'lead creation logged as activity');
select test.must_fail($$select create_lead('{"name":"X","phone":"12345678"}', array[]::text[])$$, 'a lead needs at least one service', 'service');
select test.must_fail($$select create_lead('{"name":"X","phone":"12345678"}', array['NOPE'])$$, 'unknown services are rejected', 'Unknown service');
select test.must_fail($$insert into customers (name, phone, lifecycle_stage) values ('Skip', '12345678', 'ONBOARDING')$$,
  'cannot create a record directly in a later stage', 'start as a lead');
select test.must_fail($$update customers set lifecycle_stage = 'ONBOARDING' where id = (select id from pipeline where name = 'A')$$,
  'cannot change lifecycle stage directly', 'permission denied');
select test.must_fail($$update customers set amount_received = 999 where id = (select id from pipeline where name = 'A')$$,
  'cannot write payment fields directly', 'permission denied');
select update_lead((select id from pipeline where name = 'A'), '{"leadStatus":"CONTACTED","activityNote":"Called, sent brochure"}');
select test.check((select lead_status = 'CONTACTED' from customers where id = (select id from pipeline where name = 'A')), 'lead status updated');
select test.check((select count(*) = 1 from customer_activities where type = 'STATUS_CONTACTED' and note = 'Called, sent brochure'), 'status change logged with note');
select test.must_fail($$select move_customer_to_potential((select id from pipeline where name = 'A'), 0, current_date + 7)$$,
  'moving to Potential needs a deal amount', 'deal amount');

select test.login('pending_d');
select test.must_fail($$select update_lead((select id from pipeline where name = 'A'), '{"name":"hijack"}')$$, 'teammate cannot edit another member''s lead', 'NOT_FOUND');
select test.must_fail($$select move_customer_to_potential((select id from pipeline where name = 'A'), 100, current_date)$$, 'teammate cannot move another member''s lead', 'NOT_FOUND');
select test.login('tm_c');
select test.check((select count(*) = 0 from customers where id = (select id from pipeline where name = 'A')), 'other department cannot see the lead');

select test.login('tm_a');
select move_customer_to_potential((select id from pipeline where name = 'A'), 42000, current_date + 7);
select test.check((select lifecycle_stage = 'POTENTIAL' and lead_status = 'READY_TO_BUY' and deal_amount = 42000 from customers where id = (select id from pipeline where name = 'A')),
  'LEAD → POTENTIAL on the same record (no duplicate)');
select test.check((select count(*) = 1 from customers where company = 'Shree Ganesh Jewellers'), 'still exactly one customer row');
select test.must_fail($$select update_lead((select id from pipeline where name = 'A'), '{"leadStatus":"NEW"}')$$, 'lead status frozen after leaving Leads', 'only change while');
select test.must_fail($$select record_customer_payment((select id from pipeline where name = 'A'), 50000)$$, 'payment cannot exceed deal amount', 'exceed');
select test.must_fail($$select record_customer_payment((select id from pipeline where name = 'A'), 100.50, 'UPI')$$, 'payments must be whole rupees', 'whole rupees');
select test.must_fail($$select record_customer_payment((select id from pipeline where name = 'A'), 15000, null)$$, 'first payment needs a payment method', 'how the customer paid');
select record_customer_payment((select id from pipeline where name = 'A'), 15000, 'UPI');
select test.check((select lifecycle_stage = 'ONBOARDING' and amount_received = 15000 and not fully_paid from customers where id = (select id from pipeline where name = 'A')),
  'the first (part) payment starts onboarding');
select test.check((select (customer_pipeline_counts() -> 'onboarding' ->> 'GET_STARTED')::int = 1), 'part-paid onboarding counted as Get started');
select record_customer_payment((select id from pipeline where name = 'A'), 27000, 'UPI');
select test.check((select amount_received = 42000 and fully_paid from customers where id = (select id from pipeline where name = 'A')), 'the balance is recorded while in onboarding');
select test.must_fail($$select record_customer_payment((select id from pipeline where name = 'A'), 1, 'UPI')$$, 'balance payment cannot exceed the deal', 'exceed');
select test.check((select (customer_pipeline_counts() -> 'onboarding' ->> 'GET_STARTED')::int = 0), 'fully paid customer leaves Get started');
select test.check((select lifecycle_stage = 'ONBOARDING' and amount_received = 42000 from customers where id = (select id from pipeline where name = 'A')),
  'POTENTIAL → ONBOARDING with full payment');
select test.check((select stage = 'COLLECT_REQUIREMENTS' and payment_method = 'UPI' from customer_onboarding where customer_id = (select id from pipeline where name = 'A')),
  'onboarding record created');
select test.must_fail($$select start_customer_onboarding((select id from pipeline where name = 'A'), 1, 'UPI')$$, 'cannot start onboarding twice', 'CONFLICT');

-- Whole rupees, and backing out of Potential returns the customer to Leads.
insert into pipeline select 'C', create_lead('{"name":"Ravi Kumar","company":"Kumar Traders","phone":"+91 90000 33333","leadStatus":"READY_TO_BUY"}', array['AI_CALLING']);
select test.must_fail($$select move_customer_to_potential((select id from pipeline where name = 'C'), 15000.99, current_date + 7)$$, 'deal amount must be whole rupees', 'whole rupees');
select move_customer_to_potential((select id from pipeline where name = 'C'), 15000, current_date + 7);
select test.must_fail($$select start_customer_onboarding((select id from pipeline where name = 'C'), 5000.5, 'UPI')$$, 'onboarding amount must be whole rupees', 'whole rupees');
select test.must_fail($$select start_customer_onboarding((select id from pipeline where name = 'C'), 0, null)$$, 'onboarding needs a payment method', 'how the customer paid');
select test.must_fail($$select back_out_customer((select id from pipeline where name = 'A'), null)$$, 'only potential customers can back out', 'CONFLICT');
select back_out_customer((select id from pipeline where name = 'C'), 'Found a cheaper option');
select test.check((select lifecycle_stage = 'LEAD' and lead_status = 'INTERESTED' and deal_amount is null and payment_due_date is null and expected_budget = 15000
                   from customers where id = (select id from pipeline where name = 'C')), 'backed-out customer is a lead again');
select test.check((select count(*) = 1 from customer_activities where type = 'BACKED_OUT' and note like '%cheaper%'), 'back-out logged');
select update_lead((select id from pipeline where name = 'C'), '{"leadStatus":"CONTACTED"}');
select test.check((select lead_status = 'CONTACTED' from customers where id = (select id from pipeline where name = 'C')), 'status editable again as a lead');
select test.login('pending_d');
select test.must_fail($$select back_out_customer((select id from pipeline where name = 'C'), null)$$, 'teammate cannot back out another member''s customer', 'NOT_FOUND');
select test.login('tm_a');

-- A second customer of the same salesperson (isolation of documents per customer)
insert into pipeline select 'B', create_lead('{"name":"Sneha Pillai","company":"Pillai Skin Clinic","phone":"+91 90000 22222"}', array['AI_CALLING']);
select move_customer_to_potential((select id from pipeline where name = 'B'), 60000, current_date + 3);
select start_customer_onboarding((select id from pipeline where name = 'B'), 30000, 'BANK_TRANSFER');
reset role;
select test.check((select count(*) = 2 from audit_logs where action = 'CUSTOMER_STAGE_CHANGED' and entity_id = (select id from pipeline where name = 'A')),
  'both stage changes audited');

-- ---------------------------------------------------------------------------
\echo '--- 13. Customer documents (metadata + authorization)'
-- ---------------------------------------------------------------------------
create temp table docs (name text primary key, id uuid, path text);
grant all on docs to authenticated;
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select begin_document_upload((select id from pipeline where name = 'A'), 'INVOICE', 'x.png', 'image/png', 1000)$$,
  'only PDFs are accepted', 'not accepted');
select test.must_fail($$select begin_document_upload((select id from pipeline where name = 'A'), 'INVOICE', 'big.pdf', 'application/pdf', 50000000)$$,
  'file size limit enforced', 'smaller than');
select test.must_fail($$select begin_document_upload((select id from pipeline where name = 'A'), 'PASSPORT', 'x.pdf', 'application/pdf', 1000)$$,
  'unknown document type rejected', 'Unknown document type');
insert into docs select 'A_inv1', id, storage_path from begin_document_upload((select id from pipeline where name = 'A'), 'INVOICE', 'invoice-oct.pdf', 'application/pdf', 1200);
select test.check((select path = format('customers/%s/invoices/%s.pdf', (select id from pipeline where name = 'A'), id) from docs where name = 'A_inv1'),
  'storage path = customers/<customer_id>/invoices/<document_id>.pdf (no PII)');
select test.check((select status = 'PENDING' from customer_documents where id = (select id from docs where name = 'A_inv1')), 'metadata starts PENDING until the file is verified');
select test.must_fail($$insert into customer_documents (customer_id, document_type, version, storage_path, original_file_name, mime_type)
  values ((select id from pipeline where name = 'B'), 'INVOICE', 9, 'customers/x/y.pdf', 'x.pdf', 'application/pdf')$$,
  'cannot insert document metadata directly', 'permission denied');
select test.must_fail($$update customer_documents set customer_id = (select id from pipeline where name = 'B')$$,
  'cannot re-map a document to another customer', 'permission denied');
select complete_document_upload((select id from docs where name = 'A_inv1'), 1200);
select test.must_fail($$select complete_document_upload((select id from docs where name = 'A_inv1'), 1200)$$, 'cannot complete twice', 'already finished');
insert into docs select 'A_inv2', id, storage_path from begin_document_upload((select id from pipeline where name = 'A'), 'INVOICE', 'invoice-v2.pdf', 'application/pdf', 1300);
select complete_document_upload((select id from docs where name = 'A_inv2'), 1300);
select test.check((select status = 'SUPERSEDED' from customer_documents where id = (select id from docs where name = 'A_inv1'))
              and (select status = 'UPLOADED' and version = 2 from customer_documents where id = (select id from docs where name = 'A_inv2')),
  'replacement keeps the old version (SUPERSEDED) and the new one current');
insert into docs select 'B_inv', id, storage_path from begin_document_upload((select id from pipeline where name = 'B'), 'INVOICE', 'b.pdf', 'application/pdf', 900);
select complete_document_upload((select id from docs where name = 'B_inv'), 900);
select test.check((select bool_and(customer_id = (select id from pipeline where name = 'A')) from customer_documents where document_type = 'INVOICE' and id in (select id from docs where name like 'A_%')),
  'customer A documents map to customer A only');
select test.check((select count(*) = 1 from customer_documents where customer_id = (select id from pipeline where name = 'B')), 'customer B sees only its own document');
insert into docs select 'A_fail', id, storage_path from begin_document_upload((select id from pipeline where name = 'A'), 'IMPORTANT_DOCUMENTS', 'kyc.pdf', 'application/pdf', 5000);
select test.check((select fail_document_upload((select id from docs where name = 'A_fail')) = (select path from docs where name = 'A_fail')), 'failed upload returns path for cleanup');
select test.check((select status = 'FAILED' from customer_documents where id = (select id from docs where name = 'A_fail')), 'failed upload never shows as uploaded');
select test.must_fail($$select forward_onboarding_to_support((select id from pipeline where name = 'A'))$$, 'forwarding needs all mandatory documents', 'All Important Documents');
select test.check((select count(*) = 1 from authorize_document_access((select id from docs where name = 'A_inv2'), 'VIEW')), 'owner may view own customer document');

select test.login('pending_d');
select test.must_fail($$select * from authorize_document_access((select id from docs where name = 'A_inv2'), 'DOWNLOAD')$$, 'teammate cannot open another member''s document', 'NOT_FOUND');
select test.must_fail($$select begin_document_upload((select id from pipeline where name = 'A'), 'INVOICE', 'x.pdf', 'application/pdf', 100)$$, 'teammate cannot upload to another member''s customer', 'NOT_FOUND');
select test.must_fail($$select delete_customer_document((select id from docs where name = 'A_inv2'))$$, 'teammate cannot delete another member''s document', 'NOT_FOUND');
select test.check((select count(*) = 0 from customer_documents), 'teammate cannot list another member''s documents');
select test.login('tm_c');
select test.must_fail($$select * from authorize_document_access((select id from docs where name = 'A_inv2'), 'VIEW')$$, 'other department cannot open the document', 'NOT_FOUND');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from customer_documents), 'other department head sees no documents');
select test.login('th_wab');
select test.check((select count(*) = 1 from authorize_document_access((select id from docs where name = 'A_inv2'), 'DOWNLOAD')), 'team head may download team customer documents');
select test.login('dh_wab');
select test.check((select count(*) >= 3 from customer_documents), 'department head sees department documents');

select test.login('tm_a');
insert into docs select 'A_kyc', id, storage_path from begin_document_upload((select id from pipeline where name = 'A'), 'IMPORTANT_DOCUMENTS', 'aadhaar-pan.pdf', 'application/pdf', 5000);
select test.check((select path like '%/onboarding/%' from docs where name = 'A_kyc'), 'important documents stored under onboarding/');
select complete_document_upload((select id from docs where name = 'A_kyc'), 5000);
-- Service checklist: Meta Ads + Gold Rate package for customer A.
select test.check((select jsonb_array_length(customer_onboarding_checklist((select id from pipeline where name = 'A'))) = 13),
  'checklist = 2 basics + 5 Meta Ads + 4 Gold Rate + 2 mandatory documents (shared logo counted once)');
select test.check((select items_total = 13 and items_saved = 2 from customer_onboarding where customer_id = (select id from pipeline where name = 'A')),
  'uploaded mandatory documents count as saved checklist items');
select test.must_fail($$select forward_onboarding_to_support((select id from pipeline where name = 'A'))$$, 'forwarding needs every checklist item', 'Complete these items first');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'A'), 'WABA_ID', '123')$$,
  'items of services not sold are rejected', 'not part of');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'A'), 'GOLD_CONFIRM_JEWELLER', 'maybe')$$, 'yes/no validated', 'yes or no');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'A'), 'META_AD_BUDGET', 'lots')$$, 'amount validated', 'amount');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'x')$$, 'file items need an upload', 'Upload a file');
select save_onboarding_entry((select id from pipeline where name = 'A'), c, v) from (values
  ('BUSINESS_NAME_ADDRESS', 'Shree Ganesh Jewellers, Zaveri Bazaar, Mumbai'), ('CONTACT_PERSON_MOBILE', 'Ankit Shah +91 98765 11111'),
  ('META_CAMPAIGN_GOAL', 'Walk-in leads for Diwali'), ('FACEBOOK_PAGE_ACCESS', 'Partner access to Amuwa BM'),
  ('INSTAGRAM_PAGE_ACCESS', 'Connected'), ('META_TARGET_AUDIENCE', 'Women 25-50, Mumbai, 200 leads'), ('META_AD_BUDGET', '15000'),
  ('GOLD_CONFIRM_JEWELLER', 'YES'), ('BRAND_COLOURS', 'Maroon #7A1F2B, Gold #C9A44C'), ('GOLD_TEMPLATE_APPROVAL', 'Approved on call')) v(c, v);
insert into docs select 'A_logo', id, storage_path from begin_document_upload((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'logo.png', 'image/png', 3000);
select test.check((select path like '%.png' from docs where name = 'A_logo'), 'stored file keeps an extension matching its type');
select complete_document_upload((select id from docs where name = 'A_logo'), 3000);
select test.check((select items_saved = 13 from customer_onboarding where customer_id = (select id from pipeline where name = 'A')), 'all 13 items saved');
select test.login('tm_b');
select test.check((select count(*) = 0 from customers where id = (select id from pipeline where name = 'A')),
  'consultant does not see a customer before sales sends it');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'VERIFIED', null)$$,
  'consultant cannot authorize before the customer is sent', 'NOT_FOUND');
select test.must_fail($$select verify_all_onboarding_entries((select id from pipeline where name = 'A'))$$,
  'consultant cannot authorize all before the customer is sent', 'NOT_FOUND');
select test.check((select count(*) = 0 from customers where lifecycle_stage in ('LEAD', 'POTENTIAL')), 'consultant never sees leads or potential customers');
select test.check((select (onboarding_review_counts() ->> 'all')::int = 0), 'review counts exclude customers not yet sent');
select test.login('tm_a');
select forward_onboarding_to_support((select id from pipeline where name = 'A'));
select test.check((select mandatory_saved = 2 from customer_onboarding where customer_id = (select id from pipeline where name = 'A'))
                   and (select mandatory_saved = 1 from customer_onboarding where customer_id = (select id from pipeline where name = 'B')),
  'onboarding progress tracks saved mandatory documents per customer');
select test.check((select stage = 'SETUP' and forwarded_to_support_at is not null from customer_onboarding where customer_id = (select id from pipeline where name = 'A')),
  'forwarded to support once mandatory documents are saved');
select test.must_fail($$select delete_customer_document((select id from docs where name = 'A_kyc'))$$, 'current documents locked after forwarding', 'locked');
select test.check((select delete_customer_document((select id from docs where name = 'A_inv1')) = (select path from docs where name = 'A_inv1')),
  'old version can be deleted (path returned for storage removal)');
select test.check((select count(*) = 0 from customer_documents where id = (select id from docs where name = 'A_inv1')), 'deleted document hidden from listings');
select test.must_fail($$select expire_stale_document_uploads()$$, 'only the server may expire stale uploads', 'permission denied');

\echo '--- 13b. Technical Consultant verification'
select test.login('tm_b');
select test.check((select count(*) = 1 from customers where id = (select id from pipeline where name = 'A')), 'support sees the forwarded customer');
select test.check((select count(*) = 0 from customers where id = (select id from pipeline where name = 'B')), 'support does not see an onboarding customer that was not sent');
select test.check((select (onboarding_review_counts() ->> 'TO_REVIEW')::int >= 1), 'review counts include the sent customer');
select test.check((select count(*) = 1 from authorize_document_access((select id from docs where name = 'A_logo'), 'VIEW')), 'support can open the forwarded customer''s files');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_COLOURS', 'Blue')$$, 'support cannot edit sales details', 'NOT_FOUND');
select test.must_fail($$select begin_document_upload((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'x.png', 'image/png', 10)$$, 'support cannot upload', 'NOT_FOUND');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_COLOURS', 'REJECTED', '')$$, 'rejection needs a note', 'needs fixing');
select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_COLOURS', 'REJECTED', 'Gold hex code is missing');
select test.check((select verify_all_onboarding_entries((select id from pipeline where name = 'A')) = 12), 'authorize all verifies the 12 saved items');
select test.must_fail($$select verify_all_onboarding_entries((select id from pipeline where name = 'A'))$$, 'authorize all with nothing pending', 'Nothing is waiting');
select test.check((select items_verified = 12 and items_rejected = 1 from customer_onboarding where customer_id = (select id from pipeline where name = 'A')),
  'review progress tracked (12 verified, 1 needs fixing)');
select test.login('tm_c');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'VERIFIED', null)$$, 'other department cannot review', 'NOT_FOUND');
select test.login('pending_d');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'VERIFIED', null)$$, 'sales teammate cannot review', 'NOT_FOUND');
select test.login('tm_a');
select test.check((select (e -> 'entry' ->> 'status') = 'REJECTED' and (e -> 'entry' ->> 'reviewNote') like '%hex%' from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'A'))) e where e ->> 'code' = 'BRAND_COLOURS'),
  'salesperson sees the rejection note');
select save_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_COLOURS', 'Maroon #7A1F2B, Gold #C9A44C');
select test.check((select status = 'SAVED' from customer_onboarding_entries where customer_id = (select id from pipeline where name = 'A') and item_code = 'BRAND_COLOURS'),
  'fixed item goes back for review');
select test.must_fail($$update customer_onboarding_entries set status = 'VERIFIED'$$, 'sales cannot mark items verified directly', 'permission denied');
select test.login('tm_b');
select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_COLOURS', 'VERIFIED', null);
select test.login('tm_a');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'ONBOARDING_FORWARDED' and recipient_id = test.id('tm_b')),
  'support team head notified');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_REPLACED' and actor_id = test.id('tm_a') and metadata ->> 'customer_id' = (select id::text from pipeline where name = 'A')),
  'invoice replacement audited with actor + customer');
select test.check((select count(*) = 1 from audit_logs where action = 'DOCUMENT_DOWNLOADED' and actor_id = test.id('th_wab')), 'download audited');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_DELETED'), 'deletion audited');
select test.check((select count(*) = 0 from notifications where type = 'ONBOARDING_ITEM_REJECTED' and recipient_id = test.id('tm_a')), 'a single Not authorized does not notify on its own');
select test.check((select count(*) = 1 from notifications where type = 'ONBOARDING_VERIFIED' and recipient_id = test.id('tm_a')), 'owner notified when everything is verified');
select test.check((select count(*) = 1 from audit_logs where action = 'ONBOARDING_ITEM_VERIFIED' and actor_id = test.id('tm_b'))
                   and (select count(*) = 1 from audit_logs where action = 'ONBOARDING_ITEMS_VERIFIED' and actor_id = test.id('tm_b')), 'verifications audited');

\echo '--- 13c. Onboarding automations'
select test.login('tm_b');
create temp table runs (id uuid);
grant all on runs to authenticated;
insert into runs select (begin_onboarding_automation((select id from pipeline where name = 'A'), 'WHATSAPP') ->> 'runId')::uuid;
select test.must_fail($$select begin_onboarding_automation((select id from pipeline where name = 'A'), 'WHATSAPP')$$, 'no double trigger within a minute', 'just triggered');
select finish_onboarding_automation((select id from runs), true, 'HTTP 200');
select test.check((select status = 'SENT' from onboarding_automation_runs where id = (select id from runs)), 'automation run recorded as sent');
select test.must_fail($$select begin_onboarding_automation((select id from pipeline where name = 'A'), 'SMS')$$, 'unknown automation rejected', 'Unknown automation');
select test.login('pending_d');
select test.must_fail($$select begin_onboarding_automation((select id from pipeline where name = 'A'), 'EMAIL')$$, 'sales teammate cannot trigger automations', 'NOT_FOUND');
select test.must_fail($$select finish_onboarding_automation((select id from runs), false, 'x')$$, 'only the person who started a run can finish it', 'NOT_FOUND');
select test.login('tm_c');
select test.must_fail($$select begin_onboarding_automation((select id from pipeline where name = 'A'), 'EMAIL')$$, 'other department cannot trigger automations', 'NOT_FOUND');
reset role;

\echo '--- 13d. Send back to sales for re-verification'
set role authenticated;
select test.login('tm_b');
select test.must_fail($$select return_onboarding_to_sales((select id from pipeline where name = 'A'), null)$$,
  'cannot send back without a Not authorized item', 'Mark at least one item');
select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'REJECTED', 'Logo looks fake / low resolution');
select return_onboarding_to_sales((select id from pipeline where name = 'A'), 'Please re-check the logo with the client');
select test.check((select count(*) = 1 from customers where id = (select id from pipeline where name = 'A')), 'returned customer stays visible to the consultant');
select test.check((select review_state = 'WAITING_ON_SALES' from customer_onboarding where customer_id = (select id from pipeline where name = 'A')),
  'consultant sees it as waiting for sales team');
select test.check((select (onboarding_review_counts() ->> 'WAITING_ON_SALES')::int = 1), 'waiting for sales team tab count');
select test.check((select jsonb_array_length(customer_onboarding_checklist((select id from pipeline where name = 'A'))) > 0), 'consultant can still read the checklist');
select test.check((select count(*) = 1 from authorize_document_access((select id from docs where name = 'A_logo'), 'VIEW')), 'consultant can still view the files');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'VERIFIED', null)$$,
  'consultant cannot authorize while waiting for sales', 'NOT_FOUND');
select test.must_fail($$select verify_all_onboarding_entries((select id from pipeline where name = 'A'))$$, 'no authorize all while waiting for sales', 'NOT_FOUND');
select test.must_fail($$select begin_onboarding_automation((select id from pipeline where name = 'A'), 'WHATSAPP')$$, 'no automations while waiting for sales', 'NOT_FOUND');
select test.must_fail($$select return_onboarding_to_sales((select id from pipeline where name = 'A'), null)$$, 'cannot send back twice', 'NOT_FOUND');
select test.login('tm_a');
select test.check((select returned_at is not null and forwarded_to_support_at is null and onboarding_state = 'RETURNED'
                     and return_note like '%logo%' from customer_onboarding where customer_id = (select id from pipeline where name = 'A')),
  'salesperson sees the onboarding as returned');
select test.check((select (customer_pipeline_counts() -> 'onboarding' ->> 'RETURNED')::int = 1), 'returned tab count');
select test.must_fail($$select forward_onboarding_to_support((select id from pipeline where name = 'A'))$$,
  'cannot resend until the rejected item is fixed', 'Brand logo');
insert into docs select 'A_logo2', id, storage_path from begin_document_upload((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'logo-hd.png', 'image/png', 4000);
select complete_document_upload((select id from docs where name = 'A_logo2'), 4000);
select test.login('tm_b');
select test.check((select (e -> 'entry' ->> 'status') = 'SAVED' from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'A'))) e
                   where e ->> 'code' = 'BRAND_LOGO'), 'consultant sees the fix while still waiting for sales');
select test.login('tm_a');
select forward_onboarding_to_support((select id from pipeline where name = 'A'));
select test.check((select returned_at is null and forwarded_to_support_at is not null and onboarding_state <> 'RETURNED'
                   from customer_onboarding where customer_id = (select id from pipeline where name = 'A')), 'resending clears the returned state');
select test.login('tm_b');
select test.check((select count(*) = 1 from customers where id = (select id from pipeline where name = 'A')), 'consultant sees the fixed customer again');
select test.check((select (e -> 'entry' ->> 'status') = 'SAVED' from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'A'))) e
                   where e ->> 'code' = 'BRAND_LOGO'), 'fixed item is waiting for review again');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'ONBOARDING_RETURNED' and recipient_id = test.id('tm_a') and body like '%Brand logo%'),
  'salesperson notified with the items to fix');
select test.check((select count(*) = 1 from notifications where type = 'ONBOARDING_FORWARDED' and recipient_id = test.id('tm_b') and title like 'Re-verify%'),
  'consultant notified when the customer comes back');
select test.check((select count(*) = 1 from audit_logs where action = 'ONBOARDING_RETURNED' and actor_id = test.id('tm_b')), 'send-back audited');

-- ---------------------------------------------------------------------------
\echo '--- 14. Inbound webhook leads → pipeline'
-- ---------------------------------------------------------------------------
insert into crm_leads (id, name, phone, department, channel, stage) values ('L-in', 'Inbound Ravi', '+91 91234 56789', 'wabastore', 'whatsapp', 'Interested');
insert into crm_leads (id, name, department) values ('L-nocontact', 'No contact', 'wabastore');
set role authenticated;
select test.login('tm_c');
select test.must_fail($$select claim_inbound_lead('L-in')$$, 'other department cannot claim the lead', 'NOT_FOUND');
select test.login('tm_a');
insert into pipeline select 'IN', claim_inbound_lead('L-in');
select test.check((select lifecycle_stage = 'LEAD' and lead_status = 'INTERESTED' and source_lead_id = 'L-in' from customers where id = (select id from pipeline where name = 'IN')),
  'claiming converts the inbound lead into one LEAD customer');
select test.must_fail($$select claim_inbound_lead('L-in')$$, 'a lead cannot be claimed twice', 'already in a pipeline');
select test.must_fail($$select claim_inbound_lead('L-nocontact')$$, 'leads without phone/e-mail are rejected', 'no valid phone');
select test.check((select (customer_pipeline_counts() -> 'onboarding' ->> 'all')::int = 2
                   and (customer_pipeline_counts() -> 'leads' ->> 'INTERESTED')::int = 1), 'pipeline counts scoped to the salesperson');
select test.check((select (customer_summary() ->> 'total')::int = (select count(*) from customers where lifecycle_stage in ('ONBOARDING', 'CUSTOMER'))
                   and (select count(*) from customers where lifecycle_stage = 'LEAD') > 0), 'My Customers summary counts only onboarding + paying customers, not leads');
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select test.must_fail($$select begin_document_upload(gen_random_uuid(), 'INVOICE', 'x.pdf', 'application/pdf', 1)$$, 'anon cannot start uploads', 'permission denied');
select test.must_fail($$select * from customer_documents$$, 'anon cannot read document metadata', 'permission denied');
reset role;
select test.check((select public = false from storage.buckets where id = 'customer-documents'), 'customer-documents bucket is private');

\echo '--- 15. Paid in full, checklist changes, consultant-only items'
select test.login('tm_a');
insert into pipeline select 'W', create_lead('{"name":"Wa Client","company":"WA Traders","phone":"+91 90000 77777","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
select move_customer_to_potential((select id from pipeline where name = 'W'), 30000, current_date + 5);
-- A legacy fully paid Potential customer (new payments start onboarding at once).
reset role;
update public.customers set amount_received = 30000 where id = (select id from pipeline where name = 'W');
set role authenticated;
select test.login('tm_a');
select test.check((select fully_paid from customers where id = (select id from pipeline where name = 'W')), 'full payment marks the customer paid in full');
select test.check((select (customer_pipeline_counts() -> 'potential' ->> 'PAID')::int = 1
                      and (customer_pipeline_counts() -> 'potential' ->> 'PART_PAID')::int = 0), 'paid in full is not counted as part paid');
select start_customer_onboarding((select id from pipeline where name = 'W'), 0, 'UPI', null);
select test.check((select lifecycle_stage = 'ONBOARDING' from customers where id = (select id from pipeline where name = 'W')),
  'fully paid customer starts onboarding with nothing more to receive');
select test.check((select not exists (select 1 from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'W'))) e
                    where e ->> 'code' in ('GST_CERTIFICATE', 'UDYAM_CERTIFICATE', 'WA_PRICING_APPROVED'))),
  'GST / Udyam certificates and pricing approval are no longer requested');
select test.check((select e ->> 'filledBy' = 'CONSULTANT' from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'W'))) e
                    where e ->> 'code' = 'WABA_ID'), 'WABA ID is filled in by the Technical Consultant');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'W'), 'WABA_ID', '123')$$, 'sales cannot fill in the WABA ID', 'not part of');
select test.check((select consultant_items_total = 1 and consultant_items_done = 0 from customer_onboarding where customer_id = (select id from pipeline where name = 'W')),
  'consultant items tracked separately from sales progress');

-- Optional Website URL and the Facebook Business Manager details item.
select test.check((select (e ->> 'optional')::boolean from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'W'))) e
                    where e ->> 'code' = 'WA_WEBSITE_URL'), 'Website URL is offered as an optional item');
select test.check((select e ->> 'kind' = 'DETAILS' from jsonb_array_elements(customer_onboarding_checklist((select id from pipeline where name = 'W'))) e
                    where e ->> 'code' = 'FB_BUSINESS_MANAGER'), 'Facebook Business Manager access is a details item');
reset role;
select test.check((select items_total from customer_onboarding where customer_id = (select id from pipeline where name = 'W'))
                   = (select count(*) from private.customer_items((select id from pipeline where name = 'W')))
                   and not exists (select 1 from private.customer_items((select id from pipeline where name = 'W')) where code = 'WA_WEBSITE_URL'),
  'an empty optional item is not counted and never blocks sending');
set role authenticated;
select test.login('tm_a');
select save_onboarding_entry((select id from pipeline where name = 'W'), 'WA_WEBSITE_URL', 'https://wa-traders.example');
reset role;
select test.check((select items_total from customer_onboarding where customer_id = (select id from pipeline where name = 'W'))
                   = (select count(*) from private.customer_items((select id from pipeline where name = 'W')))
                   and exists (select 1 from private.customer_items((select id from pipeline where name = 'W')) where code = 'WA_WEBSITE_URL'),
  'a filled optional item is counted and reviewed like the others');
set role authenticated;
select test.login('tm_a');


\echo '--- 16. Technical Consultant is its own choice (not every support member)'
reset role;
select test.create_auth_user('sup_plain', 'sup.plain@amuwa.com', '{"full_name":"Support Member"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support')));
select test.create_auth_user('tc_new', 'tc.new@amuwa.com', '{"full_name":"New Consultant"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support'),
                     'provisioned_technical_consultant', true));
select test.must_fail($$select test.create_auth_user('tc_bad', 'tc.bad@amuwa.com', '{"full_name":"Bad"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales'),
                     'provisioned_technical_consultant', true))$$, 'a sales team member cannot be a Technical Consultant', 'support team');
select test.check((select not is_technical_consultant from profiles where id = test.id('sup_plain')), 'support team member is not a consultant by default');
select test.check((select is_technical_consultant from profiles where id = test.id('tc_new')), 'staff created as Technical Consultant');
set role authenticated;
select test.login('sup_plain');
select test.check((select count(*) = 0 from customers where id = (select id from pipeline where name = 'A')), 'plain support member does not see consultant customers');
select test.must_fail($$select set_technical_consultant(test.id('sup_plain'), true)$$, 'members cannot make themselves consultants', 'FORBIDDEN|NOT_FOUND');
select test.login('tc_new');
select test.check((select count(*) = 1 from customers where id = (select id from pipeline where name = 'A')), 'Technical Consultant sees the forwarded customer');
select test.check(test.rows($$update profiles set full_name = 'Renamed' where id = test.id('tc_new')$$) = 1
                  and (select is_technical_consultant from profiles where id = test.id('tc_new')), 'own profile edits keep the consultant flag');
select test.must_fail($$update profiles set is_technical_consultant = false where id = test.id('tc_new')$$, 'users cannot change the flag directly', 'permission denied');
select test.login('dh_wab');
select test.check((select is_technical_consultant from set_technical_consultant(test.id('sup_plain'), true)), 'department head makes a support member a consultant');
select test.check((select not is_technical_consultant from set_technical_consultant(test.id('sup_plain'), false)), 'and back to team member');
select test.must_fail($$select set_technical_consultant(test.id('tm_a'), true)$$, 'sales member cannot become a consultant', 'support team');
select test.check((select not is_technical_consultant from assign_user(test.id('tc_new'), 'TEAM_MEMBER', null, test.team('wabastore', 'Sales'))),
  'moving a consultant to a sales team clears the flag');
reset role;
-- ---------------------------------------------------------------------------
\echo '--- 17. Work tasks: department head → team lead → team member'
-- ---------------------------------------------------------------------------
create temp table wt (name text primary key, id uuid);
grant all on wt to authenticated;
set role authenticated;
select test.login('dh_wab');
insert into wt select 'T1', assign_task_to_team_lead(test.id('th_wab'), 'Call 50 inbound leads', 'Use the new script', 'HIGH', current_date);
select test.check((select assignee_id = test.id('th_wab') and status = 'ASSIGNED' and parent_id is null from work_tasks where id = (select id from wt where name = 'T1')),
  'department head assigns a task to a team lead');
select test.must_fail($$select assign_task_to_team_lead(test.id('tm_a'), 'x', null, 'LOW', null)$$, 'department head cannot assign straight to a team member', 'team lead');
select test.must_fail($$select assign_task_to_team_lead(test.id('th_wbx'), 'x', null, 'LOW', null)$$, 'department head cannot assign to another department', 'team lead');
select test.login('th_wab');
select test.must_fail($$select assign_task_to_team_lead(test.id('th_wab'), 'x', null, 'LOW', null)$$, 'team lead cannot create department tasks', 'FORBIDDEN');
select test.must_fail($$select assign_task_to_members((select id from wt where name = 'T1'), array[test.id('tm_c')])$$, 'team lead cannot assign outside the team', 'not an active member');
select test.check((select assign_task_to_members((select id from wt where name = 'T1'), array[test.id('tm_a')]) = 1), 'team lead assigns the same task to a team member');
select test.must_fail($$select assign_task_to_members((select id from wt where name = 'T1'), array[test.id('tm_a')])$$, 'same member cannot get it twice', 'already have');
insert into wt select 'T1a', id from work_tasks where parent_id = (select id from wt where name = 'T1') and assignee_id = test.id('tm_a');
select test.check((select status = 'IN_PROGRESS' from work_tasks where id = (select id from wt where name = 'T1')), 'lead task moves to in progress once delegated');
select test.login('tm_a');
select test.check((select count(*) = 1 and bool_and(title = 'Call 50 inbound leads') from work_tasks), 'member sees only their own task');
select test.must_fail($$select submit_task_update((select id from wt where name = 'T1'), 'COMPLETED', 100, null)$$, 'member cannot update the lead''s task', 'NOT_FOUND');
select test.must_fail($$select submit_task_update((select id from wt where name = 'T1a'), 'NOT_COMPLETED', 20, '')$$, 'not completed needs a reason', 'why');
select submit_task_update((select id from wt where name = 'T1a'), 'COMPLETED', 40, 'All 50 called, 12 interested');
select test.check((select status = 'COMPLETED' and progress = 100 and completed_at is not null from work_tasks where id = (select id from wt where name = 'T1a')),
  'member marks the task completed');
select test.must_fail($$update work_tasks set status = 'COMPLETED'$$, 'tasks cannot be edited directly', 'permission denied');
select test.login('tm_c');
select test.check((select count(*) = 0 from work_tasks), 'other department sees no tasks');
select test.login('th_wab');
select test.check((select count(*) = 2 from work_tasks), 'team lead sees their task and the member task');
select test.check((select count(*) = 1 from work_task_updates where task_id = (select id from wt where name = 'T1a')), 'team lead sees the member''s update');
select submit_task_update((select id from wt where name = 'T1'), 'COMPLETED', 100, 'Team finished the calls');
select test.login('dh_wab');
select test.check((select count(*) = 2 from work_tasks) and (select status = 'COMPLETED' from work_tasks where id = (select id from wt where name = 'T1')),
  'department head sees the whole chain and the lead''s update');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'TASK_ASSIGNED' and recipient_id = test.id('tm_a')), 'member notified of the task');
select test.check((select count(*) = 1 from notifications where type = 'TASK_UPDATE' and recipient_id = test.id('th_wab')), 'team lead notified of the member update');
select test.check((select count(*) = 1 from notifications where type = 'TASK_UPDATE' and recipient_id = test.id('dh_wab')), 'department head notified of the lead update');

-- ---------------------------------------------------------------------------
\echo '--- 18. Supabase Auth writes app_metadata after the INSERT'
-- ---------------------------------------------------------------------------
-- auth.admin.createUser inserts the row, then UPDATEs app_metadata in the same
-- transaction; the profile must still get the role the manager picked.
do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v, 'late.head@amuwa.com', '{"full_name":"Late Head"}', '{"provider":"email","providers":["email"]}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
    'provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore'))
  where id = v;
  insert into test.users values ('late_head', v);
end $$;
select test.check((select role = 'DEPARTMENT_HEAD' and status = 'ACTIVE' and department_id = test.dept('wabastore') and team_id is null
                     from profiles where id = test.id('late_head')), 'late app_metadata: department head provisioned');
select test.check((select count(*) = 0 from approval_requests where subject_user_id = test.id('late_head')), 'late app_metadata: no account request');

do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v, 'late.consultant@amuwa.com', '{"full_name":"Late Consultant"}', '{"provider":"email","providers":["email"]}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object(
    'provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support'),
    'provisioned_technical_consultant', true)
  where id = v;
  insert into test.users values ('late_consultant', v);
end $$;
select test.check((select role = 'TEAM_MEMBER' and status = 'ACTIVE' and is_technical_consultant
                     from profiles where id = test.id('late_consultant')), 'late app_metadata: technical consultant provisioned');

do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v, 'late.self@amuwa.com', '{"full_name":"Self Signup"}', '{"provider":"email","providers":["email"]}');
  insert into test.users values ('late_self', v);
end $$;
select test.check((select role = 'TEAM_MEMBER' and status = 'PENDING' from profiles where id = test.id('late_self')),
  'self-registration still creates a pending team member');


\echo '--- 18. Client login and hand-over: consultant → department head → team lead → team member'
reset role;
-- The client's login, created the way the API does it (app_metadata written after the insert).
do $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
  values (v, 'client.a@example.com', '{}', '{"provider":"email","providers":["email"]}');
  update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('client_customer_id', (select id from pipeline where name = 'A'))
   where id = v;
  insert into test.users values ('client_a', v);
end $$;
select test.check((select count(*) = 0 from profiles where id = test.id('client_a')), 'a client login never gets a CRM profile');
insert into teams (department_id, name, division) values (test.dept('wabastore'), 'Delivery', 'GENERAL');
select test.create_auth_user('th_gen', 'delivery.lead@amuwa.com', '{"full_name":"Delivery Lead"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('wabastore', 'Delivery')));
select test.create_auth_user('tm_d1', 'delivery.member@amuwa.com', '{"full_name":"Delivery Member"}',
  jsonb_build_object('provisioned_by', test.id('th_gen'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Delivery')));
select test.create_auth_user('tm_s2', 's2@amuwa.com', '{"full_name":"Second Sales Member"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));

set role authenticated;
select test.login('tm_b');
select test.must_fail($$select send_to_department_head((select id from pipeline where name = 'A'), null)$$, 'consultant must authorize everything first', 'Authorize every');
select verify_all_onboarding_entries((select id from pipeline where name = 'A'));
select test.must_fail($$select send_to_department_head((select id from pipeline where name = 'A'), null)$$, 'consultant must create the client login first', 'login first');
select test.must_fail($$select assert_client_account_allowed((select id from pipeline where name = 'A'), 'not-an-email')$$, 'client login needs a valid e-mail', 'valid e-mail');
select test.must_fail($$select assert_client_account_allowed((select id from pipeline where name = 'A'), 'DH.WAB@amuwa.com')$$, 'client login cannot reuse a staff e-mail', 'already has a login');
select assert_client_account_allowed((select id from pipeline where name = 'A'), 'fresh.client@example.com');
select test.must_fail($$select record_client_account((select id from pipeline where name = 'A'), gen_random_uuid(), 'client.a@example.com')$$, 'only a login made by the API can be recorded', 'not created');
select test.must_fail($$select record_client_account((select id from pipeline where name = 'A'), test.id('tm_a'), 'a@amuwa.com')$$, 'a staff account cannot be linked as the client login', 'not created');
select record_client_account((select id from pipeline where name = 'A'), test.id('client_a'), 'client.a@example.com');
select test.must_fail($$select assert_client_account_allowed((select id from pipeline where name = 'A'), 'another@example.com')$$, 'one login per customer', 'already has a login');
select test.login('tm_a');
select test.must_fail($$select assert_client_account_allowed((select id from pipeline where name = 'A'), 'x@y.com')$$, 'sales cannot create the client login', 'NOT_FOUND');
select test.check((select email = 'client.a@example.com' from customer_client_accounts where customer_id = (select id from pipeline where name = 'A')), 'the salesperson can see the client login e-mail');
select test.login('th_wab');
select test.must_fail($$select pass_to_team_lead((select id from pipeline where name = 'A'), test.id('th_gen'), null)$$, 'team lead cannot pass a customer on before the department head', 'NOT_FOUND');

select test.login('tm_b');
select send_to_department_head((select id from pipeline where name = 'A'), 'All verified, panel created');
select test.check((select handover_stage = 'DEPARTMENT_HEAD' and stage = 'HANDOVER' and to_department_head_at is not null from customer_onboarding
                    where customer_id = (select id from pipeline where name = 'A')), 'sent to the department head');
select test.must_fail($$select send_to_department_head((select id from pipeline where name = 'A'), null)$$, 'cannot send twice', 'NOT_FOUND');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'REJECTED', 'late')$$, 'consultant review closes after the hand-over', 'NOT_FOUND');
select test.must_fail($$select return_onboarding_to_sales((select id from pipeline where name = 'A'), null)$$, 'consultant cannot send it back after the hand-over', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'HANDOVER_TO_DEPARTMENT_HEAD' and recipient_id = test.id('dh_wab')), 'department head notified');

set role authenticated;
select test.login('tm_s2');
select test.check((select count(*) = 0 from customers where id = (select id from pipeline where name = 'A')), 'an unrelated team member does not see the customer');
select test.login('dh_wab');
select test.check((select handover_stage = 'DEPARTMENT_HEAD' from customer_onboarding where customer_id = (select id from pipeline where name = 'A')), 'department head sees the hand-over');
select test.must_fail($$select pass_to_team_lead((select id from pipeline where name = 'A'), test.id('tm_a'), null)$$, 'department head must pick a team lead', 'active Team Lead');
select test.must_fail($$select pass_to_team_lead((select id from pipeline where name = 'A'), test.id('th_wbx'), null)$$, 'team lead of another department is refused', 'active Team Lead');
select pass_to_team_lead((select id from pipeline where name = 'A'), test.id('th_gen'), 'Please start onboarding the client');
select test.check((select handover_stage = 'TEAM_LEAD' and team_lead_id = test.id('th_gen') from customer_onboarding where customer_id = (select id from pipeline where name = 'A')), 'passed to the team lead');
select test.login('th_wbx');
select test.must_fail($$select pass_to_team_lead((select id from pipeline where name = 'A'), test.id('th_wbx'), null)$$, 'another department''s head cannot hand it over', 'NOT_FOUND');
select test.must_fail($$select assign_to_team_member((select id from pipeline where name = 'A'), test.id('tm_s2'), null)$$, 'only the team lead it was passed to can assign it', 'NOT_FOUND');

select test.login('th_gen');
select test.check((select count(*) = 1 from customers where id = (select id from pipeline where name = 'A')), 'the team lead sees the customer passed to them');
select test.check((select jsonb_array_length(customer_onboarding_checklist((select id from pipeline where name = 'A'))) > 0), 'the team lead can read the checklist');
select test.check((select count(*) = 1 from authorize_document_access((select id from docs where name = 'A_logo2'), 'VIEW')), 'the team lead can open the files');
select test.must_fail($$select review_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_LOGO', 'REJECTED', 'x')$$, 'the team lead cannot review', 'NOT_FOUND');
select test.must_fail($$select save_onboarding_entry((select id from pipeline where name = 'A'), 'BRAND_COLOURS', 'Blue')$$, 'the team lead cannot edit sales details', 'NOT_FOUND');
select test.must_fail($$select assign_to_team_member((select id from pipeline where name = 'A'), test.id('tm_s2'), null)$$, 'only a member of the lead''s own team can be chosen', 'active Team Member');
select assign_to_team_member((select id from pipeline where name = 'A'), test.id('tm_d1'), 'You own this client now');
select test.check((select handover_stage = 'TEAM_MEMBER' and team_member_id = test.id('tm_d1') from customer_onboarding where customer_id = (select id from pipeline where name = 'A')), 'assigned to the team member');
select test.login('tm_d1');
select test.check((select count(*) = 1 from customers where id = (select id from pipeline where name = 'A')), 'the team member sees the customer assigned to them');
select test.check((select handover_stage = 'TEAM_MEMBER' from customer_onboarding where customer_id = (select id from pipeline where name = 'A')), 'the team member sees the hand-over stage');
select test.check((select (customer_handover_info((select id from pipeline where name = 'A')) -> 'clientAccount' ->> 'email') = 'client.a@example.com'
                      and (customer_handover_info((select id from pipeline where name = 'A')) -> 'teamLead' ->> 'fullName') is not null), 'hand-over info carries the names and the client login e-mail');
select test.must_fail($$select update_lead((select id from pipeline where name = 'A'), '{"name":"hijack"}')$$, 'the team member cannot edit the sales record', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'HANDOVER_TO_TEAM_MEMBER' and recipient_id = test.id('tm_d1')), 'team member notified');
select test.check((select count(*) = 3 from audit_logs where action in ('HANDOVER_TO_DEPARTMENT_HEAD', 'HANDOVER_TO_TEAM_LEAD', 'HANDOVER_TO_TEAM_MEMBER')
                    and entity_id = (select id from pipeline where name = 'A')), 'every hand-over step is audited');

-- ---------------------------------------------------------------------------
\echo '--- 19. Support team member dashboard: customers, tasks, tickets, invoices'
-- ---------------------------------------------------------------------------
reset role;
select test.create_auth_user('sup_th', 'sup.lead@amuwa.com', '{"full_name":"Support Lead"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('wabastore', 'Support')));
select test.create_auth_user('sup_b', 'sup.b@amuwa.com', '{"full_name":"Support B"}',
  jsonb_build_object('provisioned_by', test.id('sup_th'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support')));

select test.check((select default_dashboard = 'support-member' from profiles where id = test.id('sup_plain')), 'support member default dashboard is stored');
select test.create_auth_user('tc_dash', 'tc.dash@amuwa.com', '{"full_name":"Dash Consultant"}',
  jsonb_build_object('provisioned_by', test.id('dh_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Support'),
                     'provisioned_technical_consultant', true));
select test.check((select default_dashboard = 'technical-consultant' from profiles where id = test.id('tc_dash')), 'consultant default dashboard is stored');
select test.check((select default_dashboard = 'sales-member' from profiles where id = test.id('tc_new')), 'moving a member to the Sales team changes their dashboard');
select test.check((select default_dashboard = 'sales-member' from profiles where id = test.id('tm_a')), 'sales member keeps the sales dashboard');
select test.check((select default_dashboard = 'team-lead' from profiles where id = test.id('sup_th')), 'team lead default dashboard is stored');
select test.check((select default_dashboard = 'department-head' from profiles where id = test.id('dh_wab')), 'department head default dashboard is stored');
select test.check((select default_dashboard = 'super-admin' from profiles where id = test.id('sa')), 'super admin default dashboard is stored');

-- A sales customer (post-sale) and a sales lead, owned by the sales member.
set role authenticated;
select test.login('tm_a');
create temp table sc (name text primary key, id uuid);
grant all on sc to authenticated;
with i as (insert into customers (name, email, phone, company) values ('Sales Customer', 'sales.customer@acme.com', '+91 90000 11111', 'Acme') returning id)
  insert into sc select 'cust', id from i;
with i as (insert into customers (name, email, lifecycle_stage) values ('Sales Lead Only', 'lead.only@acme.com', 'LEAD') returning id)
  insert into sc select 'lead', id from i;
select test.login('tm_c');
with i as (insert into customers (name, email) values ('Other Dept Customer', 'other@dept.com') returning id)
  insert into sc select 'other', id from i;

-- Support staff read post-sale customers of their department, never leads or other departments.
select test.login('sup_plain');
select test.check((select count(*) = 1 from customers where id = (select id from sc where name = 'cust')), 'support member sees post-sale customers of the department');
select test.check((select count(*) = 0 from customers where id = (select id from sc where name = 'lead')), 'support member does not see sales leads');
select test.check((select count(*) = 0 from customers where id = (select id from sc where name = 'other')), 'support member does not see other departments');
select test.check((select test.rows($$update customers set notes = 'hacked' where id = (select id from sc where name = 'cust')$$) = 0), 'support member cannot edit customers they do not own');

-- Add Customer
insert into sc select 'mine', create_support_customer('Priya Nair', 'Nair Traders', '+91 98450 12345', 'Priya@Nair.com', 'RETAIL', 'ACTIVE',
  'WHATSAPP_API_BLUE_TICK', '{"campaignsSent": 3, "packageMessages": 10000, "messagesSent": 2500}', 'Wants template approval help', 'Phone', 'Referred', null);
select test.check((select owner_id = test.id('sup_plain') and team_id = test.team('wabastore', 'Support') and customer_code ~ '^CUS-[0-9]{5}$'
                     and email = 'priya@nair.com' and channel = 'Phone' and service_code = 'WHATSAPP_API_BLUE_TICK' and service_interest = 'WhatsApp API + Blue Tick'
                     and (service_details ->> 'messagesSent')::int = 2500
                   from customers where id = (select id from sc where name = 'mine')), 'support customer is saved, owned by the member, with a customer code');
select test.must_fail($$select create_support_customer('Priya Again', null, null, 'priya@nair.com', 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'duplicate e-mail is refused', 'already exists');
select test.must_fail($$select create_support_customer('Priya Phone', null, '098450 12345', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'duplicate phone number is refused', 'already exists');
select test.must_fail($$select create_support_customer('Sales Dup', null, null, 'sales.customer@acme.com', 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'duplicate of a sales customer is refused', 'already exists');
select test.must_fail($$select create_support_customer('Bad Mail', null, null, 'not-an-email', 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$, 'invalid e-mail is refused', 'valid e-mail');
select test.must_fail($$select create_support_customer('Bad Phone', null, '123', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$, 'short phone is refused', 'valid phone');
select test.must_fail($$select create_support_customer('No Contact', null, null, null, 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$, 'contact is required', 'phone number or an e-mail');
select test.must_fail($$select create_support_customer('Not Mine', null, null, 'nm@x.com', 'RETAIL', 'ACTIVE', null, null, null, null, null, test.id('sup_b'))$$,
  'member cannot assign customers to someone else', 'cannot assign');
select test.login('sup_th');
select test.check((select count(*) = 1 from customers where id = (select id from sc where name = 'mine')), 'team lead sees the member''s new customer');
insert into sc select 'forb', create_support_customer('Lead Assigned', null, '+91 98450 55555', null, 'CORPORATE', 'PROSPECT', null, null, null, 'Email', null, test.id('sup_b'));
select test.check((select owner_id = test.id('sup_b') from customers where id = (select id from sc where name = 'forb')), 'team lead assigns a new customer to a member');
select test.must_fail($$select create_support_customer('Out Of Team', null, '+91 98450 66666', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, test.id('tm_a'))$$,
  'team lead cannot assign outside the team', 'cannot assign');
select test.login('dh_wab');
select test.check((select count(*) = 2 from customers where id in (select id from sc where name in ('mine', 'forb'))), 'department head sees support customers');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'CUSTOMER_ADDED' and recipient_id = test.id('sup_th')), 'team lead notified of the member''s new customer');
select test.check((select count(*) = 1 from notifications where type = 'CUSTOMER_ASSIGNED' and recipient_id = test.id('sup_b')), 'member notified of the assigned customer');

-- Tickets
create temp table st (name text primary key, id uuid);
grant all on st to authenticated;
set role authenticated;
select test.login('sup_plain');
insert into st select 'T', create_support_ticket((select id from sc where name = 'cust'), 'Cannot send templates', 'Templates stuck in review', 'TECHNICAL', 'HIGH');
select test.check((select ticket_no ~ '^TKT-[0-9]{6}$' and status = 'OPEN' and assignee_id = test.id('sup_plain') and team_id = test.team('wabastore', 'Support')
                     and customer_id = (select id from sc where name = 'cust') from support_tickets where id = (select id from st where name = 'T')),
  'member opens a ticket for a customer, assigned to themselves');
select test.must_fail($$select create_support_ticket((select id from sc where name = 'other'), 'Nope here', null, 'GENERAL', 'LOW')$$, 'no ticket for a customer outside the department', 'Customer not found');
select test.must_fail($$select create_support_ticket((select id from sc where name = 'lead'), 'Nope lead', null, 'GENERAL', 'LOW')$$, 'no ticket for a sales lead', 'Customer not found');
select test.must_fail($$select create_support_ticket((select id from sc where name = 'cust'), 'ab', null, 'GENERAL', 'LOW')$$, 'ticket needs a subject', 'subject');
select test.must_fail($$select create_support_ticket((select id from sc where name = 'cust'), 'Hands off', null, 'GENERAL', 'LOW', test.id('sup_b'))$$, 'member cannot hand a ticket to someone else', 'cannot assign');
select test.must_fail($$select update_support_ticket((select id from st where name = 'T'), 'RESOLVED', null, null)$$, 'resolving needs resolution notes', 'resolution notes');
select update_support_ticket((select id from st where name = 'T'), 'IN_PROGRESS', 'Checking with Meta', null);
select test.must_fail($$select update_support_ticket((select id from st where name = 'T'), 'IN_PROGRESS', null, null)$$, 'an update needs a change or a note', 'Change the status');
select update_support_ticket((select id from st where name = 'T'), 'ESCALATED', 'Needs partner team', null);
select test.check((select status = 'ESCALATED' and escalated_at is not null and escalated_by = test.id('sup_plain') from support_tickets where id = (select id from st where name = 'T')), 'member escalates a ticket');
select test.must_fail($$update support_tickets set status = 'CLOSED'$$, 'tickets cannot be edited directly', 'permission denied');
select test.login('sup_b');
select test.check((select count(*) = 0 from support_tickets), 'another support member does not see the ticket');
select test.login('sup_th');
select test.check((select count(*) = 1 from support_tickets where id = (select id from st where name = 'T') and status = 'ESCALATED'), 'team lead sees the escalated ticket');
select test.check((select count(*) = 3 from support_ticket_updates where ticket_id = (select id from st where name = 'T')), 'team lead sees the ticket history');
select assign_support_ticket((select id from st where name = 'T'), test.id('sup_b'), 'Please take over');
select test.must_fail($$select assign_support_ticket((select id from st where name = 'T'), test.id('tm_a'), null)$$, 'team lead cannot assign outside the team', 'active member');
select update_support_ticket((select id from st where name = 'T'), 'IN_PROGRESS', 'Reassigned to Support B', null);
select test.login('sup_b');
select test.check((select count(*) = 1 from support_tickets where id = (select id from st where name = 'T') and assignee_id = test.id('sup_b')), 'reassigned member now sees the ticket');
select update_support_ticket((select id from st where name = 'T'), 'RESOLVED', 'Template approved', 'Resubmitted the template, approved by Meta');
select test.must_fail($$select update_support_ticket((select id from st where name = 'T'), 'CLOSED', null, null)$$, 'member cannot close a ticket', 'Only a team lead');
select test.login('sup_th');
select update_support_ticket((select id from st where name = 'T'), 'CLOSED', null, null);
select test.check((select status = 'CLOSED' and resolved_at is not null and resolution_notes like 'Resubmitted%' from support_tickets where id = (select id from st where name = 'T')), 'team lead closes the resolved ticket');
select test.login('dh_wab');
select test.check((select count(*) = 1 from support_tickets) and (select count(*) = 7 from support_ticket_updates), 'department head sees tickets and full history');
select test.login('tm_a');
select test.check((select count(*) = 0 from support_tickets), 'sales member sees no support tickets');
select test.login('tm_c');
select test.check((select count(*) = 0 from support_tickets), 'other department sees no support tickets');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'TICKET_ESCALATED' and recipient_id = test.id('sup_th')), 'team lead notified of the escalation');
select test.check((select count(*) >= 1 from notifications where type = 'TICKET_ESCALATED' and recipient_id = test.id('dh_wab')), 'department head notified of the escalation');
select test.check((select count(*) >= 1 from notifications where type = 'TICKET_ASSIGNED' and recipient_id = test.id('sup_b')), 'member notified of the assigned ticket');
select test.check((select count(*) >= 1 from customer_activities where customer_id = (select id from sc where name = 'cust') and type = 'TICKET_OPENED'), 'ticket is recorded on the customer timeline');

-- Tasks from the team lead
create temp table sk (name text primary key, id uuid);
grant all on sk to authenticated;
set role authenticated;
select test.login('sup_th');
select test.check((select assign_team_task('Call back the customer', 'Confirm the template fix', 'HIGH', current_date + 2,
  (select id from sc where name = 'cust'), array[test.id('sup_plain'), test.id('sup_b')]) = 2), 'team lead assigns a task to two members');
select test.must_fail($$select assign_team_task('Outsider', null, 'LOW', null, null, array[test.id('tm_a')])$$, 'team lead cannot assign outside the team', 'not an active member');
select test.must_fail($$select assign_team_task('No one', null, 'LOW', null, null, array[]::uuid[])$$, 'at least one member is needed', 'at least one');
select test.login('sup_plain');
insert into sk select 'mine', id from work_tasks where assignee_id = test.id('sup_plain') and title = 'Call back the customer';
select test.check((select count(*) = 1 and bool_and(customer_id = (select id from sc where name = 'cust')) from work_tasks where title = 'Call back the customer'), 'member sees only their own task, linked to the customer');
select test.must_fail($$select submit_task_update((select id from sk where name = 'mine'), 'BLOCKED', 10, '')$$, 'blocked needs a reason', 'blocking');
select submit_task_update((select id from sk where name = 'mine'), 'BLOCKED', 10, 'Waiting for the customer to reply');
select test.login('sup_th');
select test.check((select status = 'BLOCKED' and progress = 10 from work_tasks where id = (select id from sk where name = 'mine')), 'team lead sees the blocked status');
select test.check((select count(*) = 1 and bool_and(author_id = test.id('sup_plain')) from work_task_updates where task_id = (select id from sk where name = 'mine')), 'task history keeps who made the update');
select test.login('tm_a');
select test.check((select count(*) = 0 from work_tasks where title = 'Call back the customer'), 'sales member does not see support tasks');
select test.login('dh_wab');
select test.check((select count(*) = 2 from work_tasks where title = 'Call back the customer'), 'department head sees support tasks');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'TASK_UPDATE' and recipient_id = test.id('sup_th')), 'team lead notified of the blocked task');

-- Invoices: linked to customers; support staff read, never write
set role authenticated;
select test.login('tm_a');
insert into member_invoices (invoice_number, customer_name, amount, status) values ('INV-1001', 'Sales Customer', 11800, 'Pending');
insert into member_invoices (invoice_number, customer_name, amount, status) values ('INV-1002', 'Unknown Person', 500, 'Pending');
select test.check((select customer_id = (select id from sc where name = 'cust') from member_invoices where invoice_number = 'INV-1001'), 'invoice is linked to the customer by name');
select test.check((select customer_id is null from member_invoices where invoice_number = 'INV-1002'), 'unmatched invoice stays unlinked');
select test.login('sup_plain');
select test.check((select count(*) = 1 and bool_and(invoice_number = 'INV-1001') from member_invoices), 'support member sees invoices of visible customers only');
select test.must_fail($$insert into member_invoices (invoice_number, customer_name, amount) values ('INV-X', 'Priya Nair', 1)$$, 'support member cannot create invoices', 'row-level security');
select test.check((select test.rows($$update member_invoices set status = 'Paid' where invoice_number = 'INV-1001'$$) = 0), 'support member cannot mark an invoice paid');
select test.check((select test.rows($$delete from member_invoices where invoice_number = 'INV-1001'$$) = 0), 'support member cannot delete invoices');
select test.login('tm_c');
select test.check((select count(*) = 0 from member_invoices), 'other departments see no invoices');
select test.login('tm_a');
select test.check((select count(*) = 2 from member_invoices), 'sales member still sees and keeps their own invoices');
reset role;

-- ---------------------------------------------------------------------------
\echo '--- 20. Support: service catalog, WhatsApp package, edit customer, invoice requests'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select create_support_customer('Bad Service', null, '+91 90000 77777', null, 'RETAIL', 'ACTIVE', 'NOT_A_SERVICE', null, null, null, null, null)$$,
  'service must come from the catalog', 'from the list');
select test.must_fail($$select create_support_customer('Over Sent', null, '+91 90000 77778', null, 'RETAIL', 'ACTIVE', 'WHATSAPP_API_BLUE_TICK',
  '{"packageMessages": 100, "messagesSent": 101}', null, null, null, null)$$, 'messages sent cannot exceed the package', 'cannot be more');
select test.must_fail($$select create_support_customer('Neg', null, '+91 90000 77779', null, 'RETAIL', 'ACTIVE', 'WHATSAPP_API_BLUE_TICK',
  '{"campaignsSent": -1}', null, null, null, null)$$, 'negative campaigns are refused', 'negative');
insert into sc select 'ai', create_support_customer('Ravi AI', null, '+91 90000 77780', null, 'RETAIL', 'ACTIVE', 'AI_CALLING',
  '{"packageMessages": 5}', null, null, null, null);
select test.check((select service_details = '{}'::jsonb from customers where id = (select id from sc where name = 'ai')), 'WhatsApp fields are only kept for WhatsApp API');

-- Edit
select update_support_customer((select id from sc where name = 'mine'), 'Priya Nair', 'Nair Traders LLP', '+91 98450 12345', 'priya@nair.com',
  'CORPORATE', 'ACTIVE', 'WHATSAPP_API_BLUE_TICK', '{"campaignsSent": 5, "packageMessages": 10000, "messagesSent": 4000, "campaignNotes": "Diwali offer"}',
  'Template approval', 'WhatsApp', 'Updated', null);
select test.check((select company = 'Nair Traders LLP' and segment = 'CORPORATE' and channel = 'WhatsApp'
                     and (service_details ->> 'campaignsSent')::int = 5 and service_details ->> 'campaignNotes' = 'Diwali offer'
                   from customers where id = (select id from sc where name = 'mine')), 'member edits their customer');
select test.must_fail($$select update_support_customer((select id from sc where name = 'mine'), 'Priya Nair', null, null, 'sales.customer@acme.com',
  'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$, 'edit cannot create a duplicate', 'already exists');
select test.must_fail($$select update_support_customer((select id from sc where name = 'mine'), 'Priya Nair', null, null, 'bad', 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'edit validates the e-mail', 'valid e-mail');
select test.must_fail($$select update_support_customer((select id from sc where name = 'cust'), 'Hijack', null, '+91 90000 11111', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'member cannot edit a customer they only see', 'Only the assigned');
select test.must_fail($$select update_support_customer((select id from sc where name = 'mine'), 'Priya Nair', null, '+91 98450 12345', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, test.id('sup_b'))$$,
  'member cannot reassign a customer', 'cannot assign');
select test.login('sup_b');
select test.must_fail($$select update_support_customer((select id from sc where name = 'mine'), 'X', null, '+91 98450 12345', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'another member cannot edit it', 'Only the assigned');
select test.login('sup_th');
select update_support_customer((select id from sc where name = 'mine'), 'Priya Nair', 'Nair Traders LLP', '+91 98450 12345', 'priya@nair.com',
  'CORPORATE', 'ACTIVE', 'WHATSAPP_API_BLUE_TICK', '{"campaignsSent": 5, "packageMessages": 10000, "messagesSent": 4000}', null, 'WhatsApp', null, test.id('sup_b'));
select test.check((select owner_id = test.id('sup_b') from customers where id = (select id from sc where name = 'mine')), 'team lead edits and reassigns the customer');
select test.login('tm_c');
select test.must_fail($$select update_support_customer((select id from sc where name = 'mine'), 'X', null, '+91 98450 12345', null, 'RETAIL', 'ACTIVE', null, null, null, null, null, null)$$,
  'other department cannot edit', 'Customer not found');
select test.check((select test.rows($$update customers set name = 'x' where id = (select id from sc where name = 'mine')$$) = 0), 'other department cannot edit directly either');

-- Invoice requests
select test.login('sup_plain');
create temp table ir (name text primary key, id uuid);
grant all on ir to authenticated;
insert into ir select 'R', request_invoice((select id from sc where name = 'cust'), date '2026-07-15', date '2026-09-01', 'Quarterly invoice');
select test.check((select from_month = date '2026-07-01' and to_month = date '2026-09-01' and status = 'REQUESTED' and note = 'Quarterly invoice'
                     and requested_by = test.id('sup_plain') from invoice_requests where id = (select id from ir where name = 'R')),
  'member requests an invoice for a period (months normalised)');
insert into ir select 'R2', request_invoice((select id from sc where name = 'cust'), date '2026-10-01', date '2026-10-01', null);
select test.check((select note is null from invoice_requests where id = (select id from ir where name = 'R2')), 'the note is optional');
select test.must_fail($$select request_invoice((select id from sc where name = 'cust'), date '2026-09-01', date '2026-08-01', null)$$, 'to month before from month is refused', 'same as or after');
select test.must_fail($$select request_invoice((select id from sc where name = 'other'), date '2026-09-01', date '2026-09-01', null)$$, 'no request for another department''s customer', 'Customer not found');
select test.must_fail($$insert into invoice_requests (customer_id, department_id, from_month, to_month) values ((select id from sc where name = 'cust'), test.dept('wabastore'), date '2026-01-01', date '2026-01-01')$$,
  'requests cannot be inserted directly', 'permission denied');
select test.login('sup_b');
select test.check((select count(*) = 0 from invoice_requests), 'another member does not see the requests');
select test.login('sup_th');
select test.check((select count(*) = 2 from invoice_requests), 'team lead sees the team''s invoice requests');
select test.login('tm_a');
select test.check((select count(*) = 2 from invoice_requests), 'the customer''s owner (who raises invoices) sees the requests');
select test.login('dh_wab');
select test.check((select count(*) = 2 from invoice_requests), 'department head sees the requests');
select test.login('tm_c');
select test.check((select count(*) = 0 from invoice_requests), 'other departments see no requests');
reset role;
select test.check((select count(*) = 2 from notifications where type = 'INVOICE_REQUESTED' and recipient_id = test.id('tm_a')), 'customer owner notified of the invoice requests');
select test.check((select count(*) = 2 from notifications where type = 'INVOICE_REQUESTED' and recipient_id = test.id('sup_th')), 'team lead notified of the invoice requests');


\echo '--- 21. Team Leader dashboard: scope, assignment, tickets, protection'
reset role;
-- The Department Head passes customer B (onboarding) to the Delivery team lead (fixture for the DH step).
update public.customer_onboarding set handover_stage = 'TEAM_LEAD', team_lead_id = test.id('th_gen'), passed_to_team_lead_at = now()
 where customer_id = (select id from pipeline where name = 'B');
-- A ticket raised by sales on customer A (handed to the Delivery lead earlier): not the lead's own team.
insert into public.support_tickets (customer_id, department_id, team_id, subject, priority, status, assignee_id, created_by)
values ((select id from pipeline where name = 'A'), test.dept('wabastore'), test.team('wabastore', 'Sales'),
        'Cannot sign in to the panel', 'HIGH', 'OPEN', test.id('tm_a'), test.id('tm_a'));
create temp table tl as select id, subject from public.support_tickets where subject = 'Cannot sign in to the panel';
grant select on tl to authenticated;

set role authenticated;
select test.login('tm_d1');
select test.must_fail($$select team_lead_dashboard()$$, 'a team member has no team lead dashboard', 'FORBIDDEN');
select test.must_fail($$select team_lead_customers()$$, 'a team member cannot list the team lead scope', 'FORBIDDEN');

select test.login('th_gen');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'needsDecision')::int = 1), 'customer passed by the department head needs a decision');
select test.check((select x ->> 'assignment' = 'DECISION' and (x ->> 'handedOver')::boolean
                   from jsonb_array_elements(team_lead_customers(null, null, 'DECISION') -> 'items') x
                   where x ->> 'id' = (select id from pipeline where name = 'B')::text), 'it is listed under Needs decision');
select test.check((select x ->> 'assigneeName' = 'Delivery Member' and x ->> 'assignment' = 'TEAM'
                   from jsonb_array_elements(team_lead_customers() -> 'items') x
                   where x ->> 'id' = (select id from pipeline where name = 'A')::text), 'handed-over customer shows the member it was assigned to');

-- Keep with me / assign to a team member (existing create_support_customer)
insert into pipeline select 'K', create_support_customer('Kiran Kapoor', 'Kapoor Traders', '+91 98111 22333', 'kiran@kapoor.example',
  'RETAIL', 'ACTIVE', null, '{}'::jsonb, null, 'Phone', null, null);
select test.check((select owner_id = test.id('th_gen') from customers where id = (select id from pipeline where name = 'K')), 'Keep with me: the lead owns the new customer');
insert into pipeline select 'M', create_support_customer('Meera Shah', null, '+91 98111 44555', null,
  'CORPORATE', 'PROSPECT', null, '{}'::jsonb, null, 'Phone', null, test.id('tm_d1'));
select test.check((select owner_id = test.id('tm_d1') from customers where id = (select id from pipeline where name = 'M')), 'Assign to team member on creation');
select test.must_fail($$select create_support_customer('Duplicate', null, '+91 98111 22333', null, 'RETAIL', 'ACTIVE', null, '{}'::jsonb, null, 'Phone', null, null)$$,
  'duplicate phone is refused', 'already exists');
select test.must_fail($$select create_support_customer('Elsewhere', null, '+91 98222 00000', null, 'RETAIL', 'ACTIVE', null, '{}'::jsonb, null, 'Phone', null, test.id('tm_a'))$$,
  'cannot create a customer for another team''s member', 'FORBIDDEN');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'mine')::int = 1
                     and (team_lead_dashboard() -> 'totals' ->> 'team')::int = 2
                     and (team_lead_dashboard() -> 'totals' ->> 'customers')::int = 4), 'KPIs: 4 customers = 1 mine + 2 team + 1 needs decision');
select test.check((select x ->> 'customers' = '2' from jsonb_array_elements(team_lead_dashboard() -> 'members') x
                    where x ->> 'id' = test.id('tm_d1')::text), 'member workload: 2 customers');
select test.check((select jsonb_array_length(team_lead_customers(null, null, 'MINE') -> 'items') = 1
                      and (team_lead_customers(null, null, 'TEAM') ->> 'total')::int = 2
                      and (team_lead_customers(null, null, null, test.id('tm_d1')) ->> 'total')::int = 2), 'assignment and member filters');
select test.check((select (team_lead_customers('kapoor') ->> 'total')::int = 1 and (team_lead_customers(null, 'PROSPECT') ->> 'total')::int = 1),
  'search and status filter run on the server');
select test.check((select jsonb_array_length(team_lead_customers(null, null, null, null, 'name', 2, 1) -> 'items') = 1
                      and (team_lead_customers(null, null, null, null, 'name', 2, 1) ->> 'total')::int = 4), 'pagination keeps the total');
select test.must_fail($$select team_lead_customers(null, 'BOGUS')$$, 'unknown status filter refused', 'Unknown customer status');
select test.must_fail($$select team_lead_customers(null, null, null, test.id('tm_a'))$$, 'cannot filter by a member of another team', 'member of your team');

-- Reassignment
select team_lead_assign_customer((select id from pipeline where name = 'K'), test.id('tm_d1'));
select test.check((select owner_id = test.id('tm_d1') from customers where id = (select id from pipeline where name = 'K')), 'reassign a team customer to a member');
select test.must_fail($$select team_lead_assign_customer((select id from pipeline where name = 'K'), test.id('tm_d1'))$$, 'no silent re-assignment to the same person', 'already assigned');
select team_lead_assign_customer((select id from pipeline where name = 'K'), test.id('th_gen'));
select test.check((select owner_id = test.id('th_gen') from customers where id = (select id from pipeline where name = 'K')), 'assign back to me');
select team_lead_assign_customer((select id from pipeline where name = 'B'), test.id('th_gen'));
select test.check((select handover_stage = 'TEAM_MEMBER' and team_member_id = test.id('th_gen') from customer_onboarding
                    where customer_id = (select id from pipeline where name = 'B')), 'keep a handed-over customer myself');
select test.check((select owner_id = test.id('tm_a') from customers where id = (select id from pipeline where name = 'B')), 'the sales owner of a handed-over customer is untouched');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'needsDecision')::int = 0 and (team_lead_dashboard() -> 'totals' ->> 'mine')::int = 2),
  'KPIs follow the decision');
select test.must_fail($$select team_lead_assign_customer((select id from pipeline where name = 'K'), test.id('tm_a'))$$, 'cannot assign to another team''s member', 'member of your team');
select test.must_fail($$select team_lead_assign_customer((select id from pipeline where name = 'K'), test.id('th_wab'))$$, 'cannot hand to another team lead', 'member of your team');
select test.check((select count(*) = 3 from customer_activities where customer_id = (select id from pipeline where name = 'K')
                    and type in ('CUSTOMER_CREATED', 'CUSTOMER_REASSIGNED')), 'creation and reassignments are in the activity log');

-- Tickets
select create_support_ticket((select id from pipeline where name = 'M'), 'Needs a new template', 'details', 'SERVICE_REQUEST', 'LOW', test.id('tm_d1'));
select test.check((select (team_lead_tickets() ->> 'total')::int = 2), 'tickets of handed-over and team customers are listed');
select test.check((select (x ->> 'manageable')::boolean = false from jsonb_array_elements(team_lead_tickets() -> 'items') x
                    where x ->> 'subject' = 'Cannot sign in to the panel'), 'a ticket of another team is view-only');
select test.check((select count(*) = 1 from support_tickets where subject = 'Cannot sign in to the panel'), 'the lead can read that ticket (RLS)');
select test.must_fail($$select update_support_ticket((select id from tl), 'CLOSED', 'closing', 'done')$$, 'viewing a ticket does not allow closing it', 'NOT_FOUND');
select test.check((select (team_lead_tickets(null, 'OPEN_ONLY', 'HIGH') ->> 'total')::int = 1
                      and (team_lead_tickets(null, 'ALL', null, null, test.id('tm_d1')) ->> 'total')::int = 1
                      and (team_lead_tickets('template') ->> 'total')::int = 1), 'ticket filters and search');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'openTickets')::int = 2 and (team_lead_dashboard() -> 'totals' ->> 'urgentTickets')::int = 1),
  'open / high-priority ticket counts');
select test.check((select jsonb_array_length(team_lead_dashboard() -> 'activity') > 0), 'recent activity comes from the activity log');

-- Other team leads
select test.login('th_wbx');
select test.check((select (team_lead_customers('kapoor') ->> 'total')::int = 0 and (team_lead_tickets(null, 'ALL') ->> 'total')::int = 0),
  'another department''s lead sees none of it');
select test.must_fail($$select team_lead_assign_customer((select id from pipeline where name = 'K'), test.id('th_wbx'))$$, 'another lead cannot reassign it', 'NOT_FOUND');
select test.check((select count(*) = 0 from support_tickets where subject = 'Needs a new template'), 'another lead cannot read the tickets');
select test.login('th_wab');
select test.check((select (team_lead_customers('kapoor') ->> 'total')::int = 0), 'a lead of another team in the same department does not see it');
select test.must_fail($$select team_lead_assign_customer((select id from pipeline where name = 'M'), test.id('th_wab'))$$, 'nor reassign it', 'NOT_FOUND');
reset role;

\echo '=== ALL AUTHORIZATION TESTS PASSED ==='
