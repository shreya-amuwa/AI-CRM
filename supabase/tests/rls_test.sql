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
\echo '=== ALL AUTHORIZATION TESTS PASSED ==='
