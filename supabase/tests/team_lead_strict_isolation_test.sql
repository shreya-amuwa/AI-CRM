-- =============================================================================
-- Strict Team Lead isolation, part 2 (migration 20261226000100). Synthetic department tls-a has ONE Support team shared by two Team Leads:
-- lA (members a1, a2) and lB (member b1), plus m0 whom nobody named. tls-b has one team with ONE lead (lX, member x1): it must behave as before.
-- Every check is made as the signed-in person (row-level rules and security-definer functions), never with the service role.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 128. Team Lead strict isolation: change, performance, customers, assignment, announcements, audit, directory'
reset role;
\i supabase/migrations/20261226000100_team_lead_strict_isolation.sql
\i supabase/migrations/20261226000100_team_lead_strict_isolation.sql
update public.access_settings set support_desk_department_wide = false;

delete from public.notifications where title like 'TLS %';
delete from public.customers where name like 'TLS %';
delete from auth.users where email like 'tls.%@example.com';
delete from test.users where name like 'tls\_%';
delete from teams where department_id in (select id from departments where slug like 'tls-%');
delete from departments where slug like 'tls-%';
insert into departments (slug, name) values ('tls-a', 'TLS Alpha'), ('tls-b', 'TLS Beta');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'tls-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.tlsmk(p_name text, p_role text, p_dept text, p_team text default null, p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tls.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'TLS ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
create or replace function test.tls_names(p jsonb) returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'name' order by x ->> 'name'), '{}') from jsonb_array_elements(p) x where x ->> 'name' like 'TLS %'
$$;
grant execute on all functions in schema test to anon, authenticated;

select test.service(); select test.tlsmk('tls_dh', 'DEPARTMENT_HEAD', 'tls-a');
select test.service(); select test.tlsmk('tls_lA', 'TEAM_HEAD', 'tls-a', 'Support');
select test.service(); select test.tlsmk('tls_lB', 'TEAM_HEAD', 'tls-a', 'Support');
select test.service(); select test.tlsmk('tls_a1', 'TEAM_MEMBER', 'tls-a', 'Support', 'tls_lA');
select test.service(); select test.tlsmk('tls_a2', 'TEAM_MEMBER', 'tls-a', 'Support', 'tls_lA');
select test.service(); select test.tlsmk('tls_b1', 'TEAM_MEMBER', 'tls-a', 'Support', 'tls_lB');
select test.service(); select test.tlsmk('tls_m0', 'TEAM_MEMBER', 'tls-a', 'Support', 'sa');         -- nobody named
select test.service(); select test.tlsmk('tls_lX', 'TEAM_HEAD', 'tls-b', 'Support');
select test.service(); select test.tlsmk('tls_x1', 'TEAM_MEMBER', 'tls-b', 'Support', 'sa');         -- the team's only lead: lX's
reset role;
select set_config('request.jwt.claims', '', false);
select test.check(private.direct_lead_of(test.id('tls_a1')) = test.id('tls_lA') and private.direct_lead_of(test.id('tls_b1')) = test.id('tls_lB')
                  and private.direct_lead_of(test.id('tls_m0')) is null and private.direct_lead_of(test.id('tls_x1')) = test.id('tls_lX'),
  'fixture: a1 is lead A''s, b1 lead B''s, m0 nobody''s; x1 belongs to the only lead of tls-b');
insert into customers (owner_id, name, phone, lifecycle_stage) values
  (test.id('tls_a1'), 'TLS cust a1', '+919844000001', 'CUSTOMER'), (test.id('tls_b1'), 'TLS cust b1', '+919844000002', 'CUSTOMER'),
  (test.id('tls_x1'), 'TLS cust x1', '+919844000003', 'CUSTOMER');
insert into audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id)
select p.id, 'TLS_PROBE', 'profile', p.id, p.department_id, p.team_id from profiles p where p.id in (test.id('tls_a1'), test.id('tls_b1'));

set role authenticated;
\echo '   Team Members list, search, count and a direct read (row-level rule on profiles)'
select test.login('tls_lA');
select test.check((select array_agg(full_name order by full_name) = array['TLS a1', 'TLS a2'] from profiles where role = 'TEAM_MEMBER' and full_name like 'TLS %'),
  'lead A lists a1 and a2 only (not lead B''s b1, not the unassigned m0)');
select test.check((select count(*) = 0 from profiles where full_name ilike '%b1%' or email ilike 'tls.b1%'), 'searching for lead B''s member finds nothing');
select test.check((select count(*) = 0 from profiles where id = test.id('tls_b1')), 'opening lead B''s member by id (a typed URL) returns nothing');
select test.login('tls_lB');
select test.check((select array_agg(full_name) = array['TLS b1'] from profiles where role = 'TEAM_MEMBER' and full_name like 'TLS %'), 'lead B lists b1 only');

\echo '   changing a person (edit, suspend, revoke, remove, role): only the lead''s own members'
select test.login('tls_lA');
select test.check(private.can_manage_profile(test.id('tls_a1')), 'lead A may change a1');
select test.check(not private.can_manage_profile(test.id('tls_b1')), 'lead A may not change lead B''s b1 (same team)');
select test.check(not private.can_manage_profile(test.id('tls_m0')), 'nor the unassigned m0');
select test.must_fail($$select delete_user(test.id('tls_b1'))$$, 'lead A cannot remove lead B''s member', 'below you in the hierarchy');
select test.login('tls_lX');
select test.check(private.can_manage_profile(test.id('tls_x1')), 'a team with one lead: unchanged, lX may change x1');

\echo '   Performance page'
select test.login('tls_lA');
select test.check((select test.tls_names(performance_people('CUSTOM', current_date - 6, current_date, null) -> 'people') = array['TLS a1', 'TLS a2']),
  'lead A''s Performance list: a1 and a2 only');
select test.login('tls_dh');
select test.check((select test.tls_names(performance_people('CUSTOM', current_date - 6, current_date, null) -> 'people') @> array['TLS a1', 'TLS b1', 'TLS lA', 'TLS lB', 'TLS m0']),
  'the Department Head still lists every Team Lead and Team Member of the department');

\echo '   customers (direct writes) and handing work to a person'
select test.login('tls_lA');
select test.check(test.rows($$update customers set notes = 'x' where name = 'TLS cust b1'$$) = 0, 'lead A cannot edit lead B''s member''s customer');
select test.check(test.rows($$delete from customers where name = 'TLS cust b1'$$) = 0, 'nor delete it');
select test.must_fail($$insert into customers (owner_id, name, phone, lifecycle_stage) values (test.id('tls_b1'), 'TLS sneaky', '+919844000009', 'CUSTOMER')$$,
  'nor create a customer owned by lead B''s member', 'cannot assign customers');
select test.check(test.rows($$update customers set notes = 'ok' where name = 'TLS cust a1'$$) = 1, 'lead A still edits their own member''s customer');
select test.check(private.can_assign_ticket_to(test.id('tls_a1')) and not private.can_assign_ticket_to(test.id('tls_b1')), 'tickets go to lead A''s own members only');
select test.must_fail($$select create_support_customer('TLS for b1', null, '+919844000010', null, 'RETAIL', 'ACTIVE', null, null, null, null, test.id('tls_b1'))$$,
  'lead A cannot make lead B''s member the owner of a customer', 'cannot assign');

\echo '   announcements and the audit log'
select test.check(broadcast_announcement('TLS hello team', 'body', 'normal', null, null) = 2, 'lead A''s team announcement reaches 2 people (a1, a2)');
reset role;
select test.check((select array_agg(p.full_name order by p.full_name) = array['TLS a1', 'TLS a2'] from notifications n join profiles p on p.id = n.recipient_id
                    where n.title = 'TLS hello team'), 'only a1 and a2 received it (not b1, m0 or lead B)');
set role authenticated;
select test.login('tls_lA');
select test.check((select count(*) = 1 from audit_logs where action = 'TLS_PROBE'), 'lead A reads the audit line about a1, not the one about b1');
select test.login('tls_dh');
select test.check((select count(*) = 2 from audit_logs where action = 'TLS_PROBE'), 'the Department Head reads both');

\echo '   the Department Head''s directory and assigning a member to a lead (same team)'
select test.check((select (m -> 'lead' ->> 'id')::uuid = test.id('tls_lA') from jsonb_array_elements(department_employee_directory(test.dept('tls-a')) -> 'members') m where m ->> 'name' = 'TLS a1'),
  'the directory shows a1''s own lead (lead A)');
select test.check((select (m -> 'lead' ->> 'id')::uuid = test.id('tls_lB') from jsonb_array_elements(department_employee_directory(test.dept('tls-a')) -> 'members') m where m ->> 'name' = 'TLS b1'),
  'and b1''s own lead (lead B), not "the first lead of the team"');
select test.check((select m ->> 'state' = 'AWAITING_ASSIGNMENT' and m -> 'lead' = 'null'::jsonb from jsonb_array_elements(department_employee_directory(test.dept('tls-a')) -> 'members') m where m ->> 'name' = 'TLS m0'),
  'the unassigned m0 is "Awaiting a Team Lead"');
select test.check((select jsonb_object_agg(l ->> 'name', (l ->> 'members')::int) = '{"TLS lA": 2, "TLS lB": 1}'::jsonb from jsonb_array_elements(department_employee_directory(test.dept('tls-a')) -> 'leads') l),
  'each lead''s member count is their own members');
select assign_member_to_team_lead(test.id('tls_m0'), test.id('tls_lB'), 'TLS named');
select assign_member_to_team_lead(test.id('tls_a2'), test.id('tls_lB'), 'TLS moved');
select test.must_fail($$select assign_member_to_team_lead(test.id('tls_a2'), test.id('tls_lB'), null)$$, 'assigning to the same lead again is refused', 'already under that Team Lead');
reset role;
select test.check(private.direct_lead_of(test.id('tls_m0')) = test.id('tls_lB') and private.direct_lead_of(test.id('tls_a2')) = test.id('tls_lB'),
  'm0 and a2 are lead B''s now (same team, only the lead changed)');
select test.check((select count(*) = 2 from team_assignments where note like 'TLS %' and lead_id = test.id('tls_lB')), 'both changes are kept in the assignment history');
set role authenticated;
select test.login('tls_lA');
select test.check((select array_agg(full_name) = array['TLS a1'] from profiles where role = 'TEAM_MEMBER' and full_name like 'TLS %'), 'lead A no longer sees a2');
select test.must_fail($$select assign_member_to_team_lead(test.id('tls_b1'), test.id('tls_lA'), null)$$, 'a Team Lead cannot take another lead''s member', 'FORBIDDEN');
select test.login('tls_lB');
select test.check((select array_agg(full_name order by full_name) = array['TLS a2', 'TLS b1', 'TLS m0'] from profiles where role = 'TEAM_MEMBER' and full_name like 'TLS %'),
  'lead B sees a2, b1 and m0');

\echo '   a member added by a Team Lead is theirs at once'
reset role;
select test.service(); select test.tlsmk('tls_a3', 'TEAM_MEMBER', 'tls-a', 'Support', 'tls_lA');
select set_config('request.jwt.claims', '', false);
set role authenticated;
select test.login('tls_lA');
select test.check((select count(*) = 1 from profiles where id = test.id('tls_a3')), 'lead A sees the member they added');
select test.login('tls_lB');
select test.check((select count(*) = 0 from profiles where id = test.id('tls_a3')), 'lead B does not');

\echo '   Super Admin unchanged'
select test.login('sa');
select test.check((select count(*) = 5 from profiles where role = 'TEAM_MEMBER' and department_id = test.dept('tls-a')), 'the Super Admin still sees every member of the department');
reset role;
update public.access_settings set support_desk_department_wide = true;
\echo '   ok: Team Lead strict isolation'
