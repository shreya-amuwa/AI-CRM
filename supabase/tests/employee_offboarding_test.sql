-- =============================================================================
-- Employee offboarding and work reassignment (migration 20261223000400).
-- Own synthetic department (obd-a) and people (prefix obd_). Runs after the other suites.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 123. Offboarding: impact, reassignment, the queue'
reset role;
\i supabase/migrations/20261223000100_team_lead_ownership.sql
\i supabase/migrations/20261223000300_meta_verifier_departments.sql
\i supabase/migrations/20261223000400_employee_offboarding.sql
\i supabase/migrations/20261223000400_employee_offboarding.sql

delete from public.reassignment_queue where department_id in (select id from departments where slug like 'obd-%');
delete from public.work_reports where department_id in (select id from departments where slug like 'obd-%');
delete from public.work_tasks where department_id in (select id from departments where slug like 'obd-%');
delete from public.customers where company like 'OBD %';
delete from auth.users where email like 'obd.%@example.com';
delete from test.users where name like 'obd\_%';
delete from teams where department_id in (select id from departments where slug like 'obd-%');
delete from departments where slug like 'obd-%';
insert into departments (slug, name) values ('obd-a', 'OBD Alpha'), ('obd-b', 'OBD Beta');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'obd-%';
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'obd-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.obdmk(p_name text, p_role text, p_dept text, p_team text default 'Support', p_by text default 'sa') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'obd.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'OBD ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;
create temp table obd (name text primary key, id uuid);
grant all on obd to authenticated, service_role;

\echo '   people: a Department Head, two Team Leads, members of each lead, two Meta Verifiers, a Sales member, and a lead of another department'
select test.service(); select test.obdmk('obd_dh', 'DEPARTMENT_HEAD', 'obd-a', null);
select test.service(); select test.obdmk('obd_l1', 'TEAM_HEAD', 'obd-a');
select test.service(); select test.obdmk('obd_l2', 'TEAM_HEAD', 'obd-a');
select test.service(); select test.obdmk('obd_m1', 'TEAM_MEMBER', 'obd-a', 'Support', 'obd_l1');
select test.service(); select test.obdmk('obd_m2', 'TEAM_MEMBER', 'obd-a', 'Support', 'obd_l1');
select test.service(); select test.obdmk('obd_m3', 'TEAM_MEMBER', 'obd-a', 'Support', 'obd_l2');
select test.service(); select test.obdmk('obd_v1', 'TEAM_MEMBER', 'obd-a');
select test.service(); select test.obdmk('obd_v2', 'TEAM_MEMBER', 'obd-a');
select test.service(); select test.obdmk('obd_vb', 'TEAM_MEMBER', 'obd-b');
select test.service(); select test.obdmk('obd_sales', 'TEAM_MEMBER', 'obd-a', 'Sales');
select test.service(); select test.obdmk('obd_lb', 'TEAM_HEAD', 'obd-b');
update profiles set is_meta_verifier = true where id in (test.id('obd_v1'), test.id('obd_v2'), test.id('obd_vb'));
select test.check((select count(*) = 11 from profiles where id in (select id from test.users where name like 'obd\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');
select test.check((select manager_id = test.id('obd_l1') from profiles where id = test.id('obd_m1')) and (select manager_id = test.id('obd_l2') from profiles where id = test.id('obd_m3')), 'members belong to the lead who added them');

-- work attached to people: customers handed to m1 (lead l1), a verification of v1, open tasks, a pending report of m2, an approved one
create or replace function test.obdcust(p_company text, p_member text, p_lead text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_owner uuid := test.id(p_member);
  v_team uuid := (select team_id from public.profiles where id = test.id(p_member));
  v_dept uuid := (select department_id from public.profiles where id = test.id(p_member));
begin
  insert into public.customers (owner_id, name, company, phone, lifecycle_stage, department_id, team_id)
  values (v_owner, 'Client ' || p_company, 'OBD ' || p_company, '98197' || lpad((random() * 99999)::int::text, 5, '0'), 'LEAD', v_dept, v_team) returning id into v_id;
  insert into public.customer_services (customer_id, service_code) values (v_id, 'WHATSAPP_API');
  update public.customers set lifecycle_stage = 'ONBOARDING' where id = v_id;
  insert into public.customer_onboarding (customer_id) values (v_id) on conflict do nothing;
  update public.customer_onboarding set forwarded_to_support_at = now(), accounts_confirmed_at = now(), handover_stage = 'TEAM_MEMBER', team_member_id = v_owner, team_lead_id = test.id(p_lead),
         meta_verifier_id = null where customer_id = v_id;
  return v_id;
end $$;
grant execute on function test.obdcust(text, text, text) to anon, authenticated;
create or replace function test.obdtask(p_owner text, p_title text) returns uuid language sql security definer set search_path = '' as $$
  insert into public.work_tasks (department_id, team_id, title, assigned_by, assignee_id, status, progress)
  select p.department_id, p.team_id, p_title, test.id('sa'), p.id, 'ASSIGNED', 0 from public.profiles p where p.id = test.id(p_owner) returning id $$;
grant execute on function test.obdtask(text, text) to anon, authenticated;
insert into obd select 'c1', test.obdcust('One', 'obd_m1', 'obd_l1');
insert into obd select 'c2', test.obdcust('Two', 'obd_m1', 'obd_l1');
insert into obd select 'c3', test.obdcust('Three', 'obd_m3', 'obd_l2');
insert into obd select 't1', test.obdtask('obd_m1', 'Call the list');
insert into obd select 't2', test.obdtask('obd_m1', 'Prepare the deck');
insert into obd select 'tl1', test.obdtask('obd_l1', 'Review the plan');
select test.check((select count(*) = 3 from obd where name like 'c%'), 'the customers exist');
-- (the payment confirmation assigned verifiers automatically: only c3 keeps one, v1, so the counts below are exact)
update customer_onboarding set meta_verifier_id = null where customer_id in (select id from obd where name like 'c%');
update customer_onboarding set meta_verifier_id = test.id('obd_v1') where customer_id = (select id from obd where name = 'c3');

\echo '   the impact summary: who is attached, who could take it, who may ask'
set role authenticated;
select test.login('obd_dh');
select test.check((select (offboarding_impact(test.id('obd_m1')) -> 'counts' ->> 'customersAsMember')::int = 2 and (offboarding_impact(test.id('obd_m1')) -> 'counts' ->> 'openTasks')::int = 2 from (select 1) z), 'Team Member m1: two customers and two open tasks');
select test.check((select array_agg(c ->> 'name') = array['OBD m2'] from jsonb_array_elements(offboarding_impact(test.id('obd_m1')) -> 'candidates') c), 'the only candidate is m2: same Team Lead, ordinary, active (not l1''s other people elsewhere, not m3 under another lead, not a verifier)');
select test.check((select (offboarding_impact(test.id('obd_l1')) -> 'counts' ->> 'directReports')::int = 2 and (offboarding_impact(test.id('obd_l1')) -> 'counts' ->> 'customersAsLead')::int = 2 from (select 1) z), 'Team Lead l1: two direct reports and two customers as lead');
select test.check((select array_agg(c ->> 'name') = array['OBD l2'] from jsonb_array_elements(offboarding_impact(test.id('obd_l1')) -> 'candidates') c), 'the candidate for a Team Lead is the other Team Lead of the team');
select test.check((select (offboarding_impact(test.id('obd_v1')) -> 'counts' ->> 'customersAsVerifier')::int = 1 from (select 1) z), 'verifier v1: one unfinished verification');
select test.login('obd_sales');
select test.must_fail(format($$select offboarding_impact('%s')$$, test.id('obd_m1')), 'Sales cannot read it', 'NOT_FOUND');
select test.login('obd_lb');
select test.must_fail(format($$select offboarding_impact('%s')$$, test.id('obd_m1')), 'nor a Team Lead of another department', 'NOT_FOUND');
select test.must_fail(format($$select offboard_employee('%s', null, 'REVOKED', 'x')$$, test.id('obd_m1')), 'nor offboard', 'NOT_FOUND');
select test.login('obd_m2');
select test.must_fail(format($$select offboard_employee('%s', null, 'REVOKED', 'x')$$, test.id('obd_m1')), 'a colleague cannot', 'NOT_FOUND');
select test.must_fail(format($$select reassignment_resolve('%s', '%s')$$, gen_random_uuid(), test.id('obd_m2')), 'nor work the queue', 'NOT_FOUND');
select test.login('obd_dh');
select test.must_fail(format($$select offboard_employee('%s', '%s', 'REVOKED', 'x')$$, test.id('obd_m1'), test.id('obd_m3')), 'a replacement from another lead is refused', 'Choose an active colleague');
select test.must_fail(format($$select offboard_employee('%s', '%s', 'REVOKED', 'x')$$, test.id('obd_m1'), test.id('obd_v1')), 'nor a verifier', 'Choose an active colleague');
select test.must_fail(format($$select offboard_employee('%s', '%s', 'DELETED', 'x')$$, test.id('obd_m1'), test.id('obd_m2')), 'an unknown status is refused', 'Suspended or Revoked');
reset role;
select test.check((select status = 'ACTIVE' from profiles where id = test.id('obd_m1')) and (select count(*) = 2 from work_tasks where assignee_id = test.id('obd_m1')) and (select team_member_id = test.id('obd_m1') from customer_onboarding where customer_id = (select id from obd where name = 'c1')),
  'a refused offboarding changed nothing: still active, tasks and customers where they were');

\echo '   a Team Member leaves with a replacement: their customers and tasks go to m2, history stays'
set role authenticated;
select test.login('obd_dh');
select test.check((offboard_employee(test.id('obd_m1'), test.id('obd_m2'), 'REVOKED', 'Left the company') -> 'moved' ->> 'customers')::int = 2, 'two customers moved to m2');
reset role;
select test.check((select status = 'REVOKED' and status_reason = 'Left the company' from profiles where id = test.id('obd_m1')), 'm1 is revoked, with the reason');
select test.check((select count(*) = 2 from customer_onboarding where team_member_id = test.id('obd_m2') and customer_id in (select id from obd where name in ('c1', 'c2'))), 'the customers belong to m2 now');
select test.check((select count(*) = 2 from work_tasks where assignee_id = test.id('obd_m2') and title in ('Call the list', 'Prepare the deck')), 'and the open tasks');
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_OFFBOARDED' and entity_id = test.id('obd_m1') and metadata -> 'moved' ->> 'customers' = '2'), 'the offboarding is audited with what moved');
select test.check((select count(*) >= 1 from customer_activities where customer_id = (select id from obd where name = 'c1') and note like 'Reassigned from OBD m1 to OBD m2%'), 'the customer timeline says who it moved from and to');
select test.check((select count(*) = 1 from notifications where type = 'HANDOVER_TO_TEAM_MEMBER' and recipient_id = test.id('obd_m2') and entity_id = (select id from obd where name = 'c1')), 'm2 is told');
select test.check((select count(*) = 0 from reassignment_queue where from_profile = test.id('obd_m1')), 'nothing needed the queue');
set role authenticated;
select test.login('obd_m1');
select test.must_fail($$select chat_my_clients()$$, 'a revoked employee reaches no client conversation', 'Sign in|FORBIDDEN');
select test.login('obd_dh');
select test.must_fail(format($$select offboard_employee('%s', null, 'REVOKED', 'again')$$, test.id('obd_m1')), 'a revoked account cannot be offboarded again', 'not active');
reset role;

\echo '   a Team Lead leaves with a replacement: people, pending reports, customers go to the other lead'
insert into obd select 'task_m2', test.obdtask('obd_m2', 'A report task');
set role authenticated;
select test.login('obd_m2');
insert into obd select 'rpend', (work_report_save(null, 'Daily report m2', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select id from obd where name = 'task_m2')))) ->> 'id')::uuid;
select work_report_submit((select id from obd where name = 'rpend'));
reset role;
select test.check((select team_lead_id = test.id('obd_l1') from work_reports where id = (select id from obd where name = 'rpend')), 'm2''s report is waiting for l1');
set role authenticated;
select test.login('obd_dh');
select test.check((offboard_employee(test.id('obd_l1'), test.id('obd_l2'), 'REVOKED', 'Left') -> 'moved' ->> 'members')::int = 1, 'one direct report (m2) goes to l2');
reset role;
select test.check((select manager_id = test.id('obd_l2') from profiles where id = test.id('obd_m2')), 'm2 now reports to l2');
select test.check((select team_lead_id = test.id('obd_l2') and status = 'SUBMITTED' from work_reports where id = (select id from obd where name = 'rpend')), 'the pending report moved to l2 (not decided)');
select test.check((select count(*) = 2 from customer_onboarding where team_lead_id = test.id('obd_l2') and customer_id in (select id from obd where name in ('c1', 'c2'))), 'the customers l1 supervised have l2 as Team Lead');
select test.check((select count(*) = 1 from work_tasks where assignee_id = test.id('obd_l2') and title = 'Review the plan'), 'l1''s own open task went to l2');
select test.check((select status = 'REVOKED' from profiles where id = test.id('obd_l1')), 'l1 is revoked');
select test.check((select count(*) = 0 from work_report_events e where e.report_id = (select id from obd where name = 'rpend') and e.action in ('APPROVED', 'REJECTED')), 'no approval was made on anybody''s behalf');

\echo '   nobody eligible: the work waits in the Reassignment Required queue, visible to the right managers only'
insert into obd select 'c4', test.obdcust('Four', 'obd_m3', 'obd_l2');
insert into obd select 'tm3', test.obdtask('obd_m3', 'A task of m3');
set role authenticated;
select test.login('obd_dh');
select test.check((offboard_employee(test.id('obd_m3'), null, 'SUSPENDED', 'Long leave') ->> 'queued')::int = 3, 'm3 leaves with no replacement: two customers and the task are queued');
reset role;
select test.check((select status = 'SUSPENDED' from profiles where id = test.id('obd_m3')), 'the account is suspended');
select test.check((select count(*) = 2 from customer_onboarding where team_member_id = test.id('obd_m3')), 'the customers were NOT given to anybody (still m3, flagged in the queue)');
set role authenticated;
select test.login('obd_dh');
select test.check((select count(*) = 3 and bool_and(x ->> 'department' = 'OBD Alpha') from jsonb_array_elements(reassignment_queue_list()) x), 'the Department Head sees the queue of their department');
select test.check((select count(*) filter (where x ->> 'kind' = 'CUSTOMER_MEMBER') = 2 and count(*) filter (where x ->> 'kind' = 'TASK') = 1 from jsonb_array_elements(reassignment_queue_list()) x), 'two customers and one task');
select test.login('obd_lb');
select test.check((select jsonb_array_length(reassignment_queue_list()) = 0 from (select 1) z), 'another department''s lead sees nothing of it');
select test.login('obd_sales');
select test.check((select jsonb_array_length(reassignment_queue_list()) = 0 from (select 1) z), 'nor does Sales');
select test.login('obd_dh');
insert into obd select 'q1', (x ->> 'id')::uuid from jsonb_array_elements(reassignment_queue_list()) x where x ->> 'kind' = 'CUSTOMER_MEMBER' limit 1;
select test.must_fail(format($$select reassignment_resolve('%s', '%s')$$, (select id from obd where name = 'q1'), test.id('obd_sales')), 'a customer cannot be given to a Sales colleague', 'Support team');
select test.must_fail(format($$select reassignment_resolve('%s', '%s')$$, (select id from obd where name = 'q1'), test.id('obd_l2')), 'nor a Team Lead given a Team Member''s place', 'Choose a Team Member');
select test.must_fail(format($$select reassignment_resolve('%s', '%s')$$, (select id from obd where name = 'q1'), test.id('obd_lb')), 'nor to someone of another department', 'department');
select test.check((select reassignment_resolve((select id from obd where name = 'q1'), test.id('obd_m2')) ->> 'to') = test.id('obd_m2')::text, 'the Department Head gives it to m2');
select test.check((select jsonb_array_length(reassignment_queue_list()) = 2 from (select 1) z), 'the queue shrinks (resolved items are not shown)');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'REASSIGNMENT_RESOLVED' and metadata ->> 'kind' = 'CUSTOMER_MEMBER'), 'resolving is audited');

\echo '   a Meta Verifier leaves: the verification goes to a verifier who covers it, or waits'
set role authenticated;
select test.login('obd_dh');
select test.must_fail(format($$select offboard_employee('%s', '%s', 'REVOKED', 'x')$$, test.id('obd_v1'), test.id('obd_vb')), 'a verifier of another department is not an eligible replacement', 'Choose an active colleague');
select test.check((select (offboard_employee(test.id('obd_v1'), test.id('obd_v2'), 'REVOKED', 'Left') -> 'moved' ->> 'verifications')::int = 1), 'the verification moves to v2 (covers the department)');
reset role;
select test.check((select meta_verifier_id = test.id('obd_v2') from customer_onboarding where customer_id = (select id from obd where name = 'c3')), 'c3''s verifier is v2');

\echo '   a Department Head leaves: nothing is moved to an arbitrary person, the department is queued'
select test.service(); select test.obdmk('obd_oh', 'DEPARTMENT_HEAD', 'obd-b', null);
set role authenticated;
select test.login('sa');
select test.check((select (offboarding_impact(test.id('obd_dh')) ->> 'needsInterimHead')::boolean), 'the impact summary says an interim head is needed');
select test.check((offboard_employee(test.id('obd_dh'), null, 'REVOKED', 'Left') ->> 'queued')::int >= 1, 'the Super Admin offboards the Department Head');
select test.check((select exists (select 1 from jsonb_array_elements(reassignment_queue_list()) x where x ->> 'kind' = 'DEPARTMENT_HEAD')), 'the department is in the queue');
select test.must_fail(format($$select reassignment_resolve('%s', null)$$, (select (x ->> 'id')::uuid from jsonb_array_elements(reassignment_queue_list()) x where x ->> 'kind' = 'DEPARTMENT_HEAD')), 'it cannot be marked resolved while the department has no head', 'no active Department Head');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_OFFBOARDED' and entity_id = test.id('obd_dh')), 'and audited');
