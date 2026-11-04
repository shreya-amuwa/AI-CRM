-- =============================================================================
-- A Team Lead sees only their own members (migration 20261225000100). Synthetic department tds-a has ONE Support team shared by two Team
-- Leads (lA with members a1, a2 and a Technical Consultant; lB with member b1) and a member nobody was named for (m0). tds-b is another
-- department. This is the situation of the production screenshot (several leads' members under one lead's "Team Workload").
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 127. Team Lead direct scope: dashboard, customers, tickets, tasks, people'
reset role;
\i supabase/migrations/20261223000100_team_lead_ownership.sql
\i supabase/migrations/20261225000100_team_lead_direct_scope.sql
\i supabase/migrations/20261225000100_team_lead_direct_scope.sql
-- the direct reads below are checked with strict ownership on (the department-wide Support desk switched off); the switch itself is checked at the end
update public.access_settings set support_desk_department_wide = false;

delete from public.support_tickets where subject like 'TDS %';
delete from public.work_tasks where title like 'TDS %';
delete from public.customers where name like 'TDS %';
delete from auth.users where email like 'tds.%@example.com';
delete from test.users where name like 'tds\_%';
delete from teams where department_id in (select id from departments where slug like 'tds-%');
delete from departments where slug like 'tds-%';
insert into departments (slug, name) values ('tds-a', 'TDS Alpha'), ('tds-b', 'TDS Beta');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'tds-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.tdsmk(p_name text, p_role text, p_dept text, p_team text default null, p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tds.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'TDS ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;

select test.service(); select test.tdsmk('tds_dh', 'DEPARTMENT_HEAD', 'tds-a');
select test.service(); select test.tdsmk('tds_lA', 'TEAM_HEAD', 'tds-a', 'Support');
select test.service(); select test.tdsmk('tds_lB', 'TEAM_HEAD', 'tds-a', 'Support');
select test.service(); select test.tdsmk('tds_a1', 'TEAM_MEMBER', 'tds-a', 'Support', 'tds_lA');
select test.service(); select test.tdsmk('tds_a2', 'TEAM_MEMBER', 'tds-a', 'Support', 'tds_lA');
select test.service(); select test.tdsmk('tds_tc', 'TEAM_MEMBER', 'tds-a', 'Support', 'tds_lA');
select test.service(); select test.tdsmk('tds_b1', 'TEAM_MEMBER', 'tds-a', 'Support', 'tds_lB');
select test.service(); select test.tdsmk('tds_m0', 'TEAM_MEMBER', 'tds-a', 'Support', 'sa');          -- nobody named
select test.service(); select test.tdsmk('tds_lX', 'TEAM_HEAD', 'tds-b', 'Support');
select test.service(); select test.tdsmk('tds_x1', 'TEAM_MEMBER', 'tds-b', 'Support', 'tds_lX');
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set is_technical_consultant = true where id = test.id('tds_tc');
select test.check((select count(*) = 1 from profiles where id = test.id('tds_tc') and is_technical_consultant), 'fixture: a Technical Consultant in lead A''s team');
select test.check(private.direct_lead_of(test.id('tds_a1')) = test.id('tds_lA') and private.direct_lead_of(test.id('tds_b1')) = test.id('tds_lB')
                  and private.direct_lead_of(test.id('tds_m0')) is null, 'fixture: a1 is lead A''s, b1 lead B''s, m0 nobody''s (two leads share the team)');

insert into customers (owner_id, name, phone, lifecycle_stage) values
  (test.id('tds_a1'), 'TDS cust a1', '+919833000001', 'CUSTOMER'), (test.id('tds_a2'), 'TDS cust a2', '+919833000002', 'CUSTOMER'),
  (test.id('tds_b1'), 'TDS cust b1', '+919833000003', 'CUSTOMER'), (test.id('tds_m0'), 'TDS cust m0', '+919833000004', 'CUSTOMER'),
  (test.id('tds_lA'), 'TDS cust lA', '+919833000005', 'CUSTOMER'), (test.id('tds_x1'), 'TDS cust x1', '+919833000006', 'CUSTOMER');
insert into support_tickets (customer_id, department_id, team_id, subject, priority, assignee_id, created_by)
select c.id, c.department_id, c.team_id, 'TDS ticket ' || substr(c.name, 10), 'HIGH', c.owner_id, test.id('tds_dh') from customers c where c.name like 'TDS cust %';
insert into support_tickets (customer_id, department_id, team_id, subject, priority, assignee_id, created_by)
select c.id, c.department_id, c.team_id, 'TDS ticket unassigned', 'LOW', null, test.id('tds_dh') from customers c where c.name = 'TDS cust a1';
insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id)
select p.department_id, p.team_id, 'TDS task ' || substr(p.full_name, 5), p.id, m.id
  from profiles p join profiles m on m.id in (test.id('tds_a1'), test.id('tds_b1')) and private.direct_lead_of(m.id) = p.id
 where p.id in (test.id('tds_lA'), test.id('tds_lB'));

set role authenticated;
\echo '   Team Workload and every number of the Team Lead dashboard'
select test.login('tds_lA');
select test.check((select array_agg(x ->> 'fullName' order by x ->> 'fullName') = array['TDS a1', 'TDS a2'] from jsonb_array_elements(team_lead_dashboard() -> 'members') x),
  'lead A''s Team Workload: a1 and a2 only (not b1, not the unassigned m0, not the Technical Consultant)');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'customers')::int = 3), 'lead A''s customers: a1''s, a2''s and lead A''s own (3), not b1''s or m0''s');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'mine')::int = 1 and (team_lead_dashboard() -> 'totals' ->> 'team')::int = 2), 'mine = 1, team = 2: the totals match the rows');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'openTickets')::int = 4), 'open tickets: a1''s, a2''s, lead A''s and the team''s unassigned one');
select test.check(not exists (select 1 from jsonb_array_elements(team_lead_dashboard() -> 'alerts') x where x ->> 'customerName' in ('TDS cust b1', 'TDS cust m0')), 'no alert about another lead''s customer');
select test.login('tds_lB');
select test.check((select array_agg(x ->> 'fullName') = array['TDS b1'] from jsonb_array_elements(team_lead_dashboard() -> 'members') x), 'lead B''s Team Workload: b1 only');
select test.check((select (team_lead_dashboard() -> 'totals' ->> 'customers')::int = 1), 'lead B''s customers: b1''s only');

\echo '   lists, searches and filters on the server'
select test.login('tds_lA');
select test.check((select array_agg(x ->> 'name' order by x ->> 'name') = array['TDS cust a1', 'TDS cust a2', 'TDS cust lA'] from jsonb_array_elements(team_lead_customers('TDS') -> 'items') x),
  'customer list (with a search): lead A''s three');
select test.must_fail(format($$select team_lead_customers(null, null, null, '%s')$$, test.id('tds_b1')), 'filtering by another lead''s member is refused', 'Choose a member of your team');
select test.check((select count(*) = 0 from jsonb_array_elements(team_lead_tickets('TDS', 'ALL') -> 'items') x where x ->> 'customerName' in ('TDS cust b1', 'TDS cust m0')), 'ticket list: none of lead B''s or m0''s');
select test.check((select count(*) = 4 from jsonb_array_elements(team_lead_tickets('TDS', 'ALL') -> 'items') x), 'ticket list: lead A''s four');

\echo '   direct reads (row-level security), whatever the screen asks'
select test.check((select count(*) = 3 from customers where name like 'TDS %'), 'customers: lead A reads 3 rows');
select test.check((select count(*) = 0 from customers where id = (select id from customers where name = 'TDS cust b1')), 'b1''s customer cannot be read by id');
select test.check(not private.can_view_customer((select id from customers where name = 'TDS cust b1')), 'can_view_customer agrees');
select test.check((select count(*) = 0 from support_tickets where subject = 'TDS ticket b1'), 'b1''s ticket cannot be read');
select test.check((select count(*) = 1 from work_tasks where title like 'TDS task%'), 'tasks: lead A reads their own member''s task, not lead B''s');
select test.check((select count(*) = 0 from profiles where id in (test.id('tds_b1'), test.id('tds_m0'))) and (select count(*) = 2 from profiles where id in (test.id('tds_a1'), test.id('tds_lB'))),
  'people: lead B''s member and the unassigned member are not visible; lead A''s own member and the other lead are');

\echo '   writes are refused for another lead''s member'
select test.must_fail(format($$select team_lead_assign_customer((select id from customers where name = 'TDS cust a1'), '%s')$$, test.id('tds_b1')),
  'lead A cannot give a customer to lead B''s member (a guessed id)', 'Choose yourself or an active member of your team');
select test.must_fail(format($$select team_lead_assign_customer((select id from customers where name = 'TDS cust a1'), '%s')$$, test.id('tds_tc')),
  'nor to a Technical Consultant', 'Choose yourself or an active member of your team');
select team_lead_assign_customer((select id from customers where name = 'TDS cust a1'), test.id('tds_a2'));
select test.check((select owner_id = test.id('tds_a2') from customers where name = 'TDS cust a1'), 'but can move it between their own members');
select test.must_fail(format($$select assign_team_task('TDS x', null, 'LOW', null, null, array['%s']::uuid[])$$, test.id('tds_b1')), 'nor give lead B''s member a task', 'not an active member of your team');

\echo '   Team Members, the Department Head, another department'
select test.login('tds_a1');
select test.check((select count(*) = 0 from profiles where id = test.id('tds_b1')) and (select count(*) = 1 from profiles where id = test.id('tds_a2')),
  'a1 sees a colleague under the same lead, not lead B''s member');
select test.must_fail($$select team_lead_dashboard()$$, 'and has no Team Lead dashboard', 'Only a Team Lead');
select test.login('tds_dh');
select test.check((select count(*) = 5 from customers where name like 'TDS cust %' and name <> 'TDS cust x1') and (select count(*) = 0 from customers where name = 'TDS cust x1'),
  'the Department Head sees both leads'' groups and the unassigned member''s customer, not another department''s');
select test.login('tds_lX');
select test.check((select count(*) = 1 from customers where name like 'TDS %') and (select jsonb_array_length(team_lead_dashboard() -> 'members') = 1), 'a single-lead team works as before');

\echo '   moving a member to the other lead moves the access at once'
reset role;
update profiles set manager_id = test.id('tds_lB') where id = test.id('tds_a2');
set role authenticated;
select test.login('tds_lA');
select test.check((select array_agg(x ->> 'fullName') = array['TDS a1'] from jsonb_array_elements(team_lead_dashboard() -> 'members') x), 'lead A no longer lists a2');
select test.check((select count(*) = 0 from customers where owner_id = test.id('tds_a2')), 'nor reads a2''s customers');
select test.login('tds_lB');
select test.check((select count(*) = 2 from jsonb_array_elements(team_lead_dashboard() -> 'members')), 'lead B now has b1 and a2');
reset role;
update profiles set manager_id = test.id('tds_lA') where id = test.id('tds_a2');

\echo '   the Support desk switch (department-wide read of post-sale customers): on by default (unchanged), Super Admin only, audited'
set role authenticated;
select test.login('tds_a1');
select test.check((select count(*) = 0 from customers where name like 'TDS %' and owner_id is distinct from test.id('tds_a1')), 'a Support Team Member reads only their own customers (none of the department''s others)');
select test.must_fail($$select set_support_desk_department_wide(true)$$, 'nobody but the Super Admin turns it on', 'FORBIDDEN');
select test.login('sa');
select set_support_desk_department_wide(true);
select test.login('tds_a1');
select test.check((select count(*) = 5 from customers where name like 'TDS %'), 'switched on: the department''s post-sale customers again (the old Support desk)');
select test.login('sa');
select set_support_desk_department_wide(false);
reset role;
select test.check((select count(*) = 2 from audit_logs where action = 'SUPPORT_DESK_SCOPE_SET'), 'both switches are audited');
-- back to the default for the suites that follow
update public.access_settings set support_desk_department_wide = true;
