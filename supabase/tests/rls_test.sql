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

\echo '=== ALL AUTHORIZATION TESTS PASSED ==='
