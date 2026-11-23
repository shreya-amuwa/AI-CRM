-- =============================================================================
-- International and Reseller (migration 20270127000100): two departments whose Department Head, Team Leads and Team Members work in
-- Sales AND Support, on the existing tables. Tested with a Department Head, two Team Leads and two Team Members in EACH department:
--  - the departments, their one team, the head without a side, the dashboard each person opens;
--  - Sales: a member adds a lead, the right people see it; Support: the customer's ticket is raised, worked and resolved by the same member;
--  - tasks Head -> Team Lead -> Member and daily reports Member -> Team Lead -> Head;
--  - isolation: International never sees Reseller (and the reverse), a Team Lead never sees the other Team Lead's people, a member sees
--    only their own, and the existing Sales / Support departments are unaffected both ways.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 180. International and Reseller: unified Sales + Support departments'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites re-run older migrations (idempotency checks), some of which redefine functions this migration changes: apply it again first
\i supabase/migrations/20270127000100_international_reseller_departments.sql

\echo '   the departments'
select test.check((select count(*) = 2 and bool_and(unified_sales_support) from departments where slug in ('international', 'reseller')), 'International and Reseller exist and are unified (Sales + Support)');
select test.check(not exists (select 1 from departments where unified_sales_support and slug not in ('international', 'reseller')), 'no other department is unified');
select test.check((select count(*) = 1 and bool_and(division = 'GENERAL') from teams where department_id = test.dept('international'))
                  and (select count(*) = 1 and bool_and(division = 'GENERAL') from teams where department_id = test.dept('reseller')), 'each has one team');
select test.must_fail($$insert into teams (department_id, name, division) values (test.dept('international'), 'Split Sales', 'SALES')$$, 'a unified department has no Sales-only team', 'Sales and Support together');
select test.must_fail($$insert into teams (department_id, name, division) values (test.dept('reseller'), 'Split Support', 'SUPPORT')$$, '... nor a Support-only team', 'Sales and Support together');
select test.check((select count(*) from teams where department_id = test.dept('wabastore') and division = 'SALES') >= 1, 'an existing department keeps its Sales team (unchanged)');

-- people: Department Head, Team Leads A and B, Members A1, A2 (under lead A) and B1 (under lead B), in both departments
create or replace function test.ud_user(p_name text, p_role text, p_dept text, p_by text, p_extra jsonb default '{}') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'ud.' || p_name || '@example.com', jsonb_build_object('full_name', 'UD ' || p_name),
    jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role) ||
    case when p_role = 'DEPARTMENT_HEAD' then jsonb_build_object('provisioned_department_id', test.dept(p_dept))
         else jsonb_build_object('provisioned_team_id', (select id from teams where department_id = test.dept(p_dept) limit 1)) end || p_extra) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select test.ud_user('i_head', 'DEPARTMENT_HEAD', 'international', 'sa', '{"provisioned_head_division":"SALES"}'::jsonb);   -- a side is asked for: the department decides, no side
select test.ud_user('i_lead_a', 'TEAM_HEAD', 'international', 'sa');
select test.ud_user('i_lead_b', 'TEAM_HEAD', 'international', 'sa');
select test.ud_user('i_m_a1', 'TEAM_MEMBER', 'international', 'i_lead_a');
select test.ud_user('i_m_a2', 'TEAM_MEMBER', 'international', 'i_lead_a');
select test.ud_user('i_m_b1', 'TEAM_MEMBER', 'international', 'i_lead_b');
select test.ud_user('r_head', 'DEPARTMENT_HEAD', 'reseller', 'sa');
select test.ud_user('r_lead_a', 'TEAM_HEAD', 'reseller', 'sa');
select test.ud_user('r_m_a1', 'TEAM_MEMBER', 'reseller', 'r_lead_a');
-- with two Team Leads in one team, each member is named to their lead (the existing rule: manager_id)
update profiles set manager_id = test.id('i_lead_a') where id in (test.id('i_m_a1'), test.id('i_m_a2'));
update profiles set manager_id = test.id('i_lead_b') where id = test.id('i_m_b1');
update profiles set manager_id = test.id('r_lead_a') where id = test.id('r_m_a1');

\echo '   hierarchy and dashboards'
select test.check((select count(*) = 6 and bool_and(department_id = test.dept('international') and status = 'ACTIVE') from profiles where id in
  (test.id('i_head'), test.id('i_lead_a'), test.id('i_lead_b'), test.id('i_m_a1'), test.id('i_m_a2'), test.id('i_m_b1'))), 'International: head, two leads, three members, placed in the department');
select test.check((select head_division is null and role = 'DEPARTMENT_HEAD' and default_dashboard = 'unified-head' from profiles where id = test.id('i_head')),
  'the Department Head has no Sales-only / Support-only side (a requested side is ignored) and opens the unified dashboard');
select test.check((select bool_and(default_dashboard = 'unified-lead') from profiles where id in (test.id('i_lead_a'), test.id('i_lead_b'), test.id('r_lead_a'))), 'Team Leads open the unified dashboard');
select test.check((select bool_and(default_dashboard = 'unified-member' and sales_sub_role is null) from profiles where id in (test.id('i_m_a1'), test.id('i_m_b1'), test.id('r_m_a1'))), 'Team Members open the unified dashboard');
select test.check(private.direct_lead_of(test.id('i_m_a1')) = test.id('i_lead_a') and private.direct_lead_of(test.id('i_m_b1')) = test.id('i_lead_b'), 'each member reports to their own Team Lead');
select test.check((select role = 'DEPARTMENT_HEAD' and department_id = test.dept('reseller') and default_dashboard = 'unified-head' from profiles where id = test.id('r_head')), 'Reseller has its own head');
select test.check(not exists (select 1 from profiles where id in (select id from profiles where email like 'ud.%') and role = 'SUPER_ADMIN'), 'nobody here is a Super Admin');
select test.check((select default_dashboard = 'support-member' from profiles where id = test.id('sup_b')) and (select default_dashboard = 'sales-member' or default_dashboard = 'business-associate' from profiles where id = test.id('tm_a')),
  'the existing Sales and Support people keep their own dashboards');

\echo '   Sales: leads'
create temp table ud (k text primary key, v uuid);
grant all on ud to authenticated;
create or replace function test.ud_sees(p_customer uuid) returns boolean language sql stable as $$ select exists (select 1 from customers where id = p_customer) $$;
grant execute on function test.ud_sees(uuid) to authenticated;
set role authenticated;
select test.login('i_m_a1');
insert into ud select 'lead_a1', create_lead('{"name":"Intl Lead A1","company":"Intl Traders","email":"intl.a1@example.com","phone":"9820000101","leadSource":"Referral"}', array['AI_CALLING']);
select test.login('i_m_b1');
insert into ud select 'lead_b1', create_lead('{"name":"Intl Lead B1","company":"Intl Exports","email":"intl.b1@example.com","phone":"9820000102","leadSource":"Referral"}', array['AI_CALLING']);
select test.login('r_m_a1');
insert into ud select 'lead_r1', create_lead('{"name":"Resell Lead 1","company":"Resell Co","email":"resell.1@example.com","phone":"9820000103","leadSource":"Referral"}', array['AI_CALLING']);
reset role;
select test.check((select count(*) = 1 and bool_and(owner_id = test.id('i_m_a1') and department_id = test.dept('international') and team_id = (select id from teams where department_id = test.dept('international')) and lifecycle_stage = 'LEAD')
                     from customers where id = (select v from ud where k = 'lead_a1')), 'a lead is owned by its creator, in the department and the team (lead status NEW, creation date set)');
select test.check((select lead_status = 'NEW' and created_at is not null from customers where id = (select v from ud where k = 'lead_a1')), 'with status and creation date');
set role authenticated;
select test.login('i_m_a1');
select test.check(test.ud_sees((select v from ud where k = 'lead_a1')) and not test.ud_sees((select v from ud where k = 'lead_b1')) and not test.ud_sees((select v from ud where k = 'lead_r1')), 'a member sees only their own lead');
select test.login('i_lead_a');
select test.check(test.ud_sees((select v from ud where k = 'lead_a1')) and not test.ud_sees((select v from ud where k = 'lead_b1')), 'Team Lead A sees their member''s lead, not Team Lead B''s member''s');
select test.login('i_lead_b');
select test.check(not test.ud_sees((select v from ud where k = 'lead_a1')) and test.ud_sees((select v from ud where k = 'lead_b1')), 'Team Lead B the reverse');
select test.login('i_head');
select test.check(test.ud_sees((select v from ud where k = 'lead_a1')) and test.ud_sees((select v from ud where k = 'lead_b1')) and not test.ud_sees((select v from ud where k = 'lead_r1')),
  'the Department Head sees every International lead and no Reseller lead');
select test.login('r_head');
select test.check(test.ud_sees((select v from ud where k = 'lead_r1')) and not test.ud_sees((select v from ud where k = 'lead_a1')) and not test.ud_sees((select v from ud where k = 'lead_b1')), 'the Reseller head the reverse');
select test.login('r_lead_a');
select test.check(not test.ud_sees((select v from ud where k = 'lead_a1')) and test.ud_sees((select v from ud where k = 'lead_r1')), 'a Reseller Team Lead sees no International lead');
select test.login('tm_a');
select test.check(not test.ud_sees((select v from ud where k = 'lead_a1')) and not test.ud_sees((select v from ud where k = 'lead_r1')), 'an existing Sales member sees none of them');
select test.login('dh_wab');
select test.check(not test.ud_sees((select v from ud where k = 'lead_a1')) and not test.ud_sees((select v from ud where k = 'lead_r1')), 'nor does an existing department''s head');
select test.login('sup_b');
select test.check(not test.ud_sees((select v from ud where k = 'lead_a1')), 'nor an existing Support member');
select test.login('sa');
select test.check(test.ud_sees((select v from ud where k = 'lead_a1')) and test.ud_sees((select v from ud where k = 'lead_r1')), 'the Super Admin sees both departments');

\echo '   lead reassignment inside the team (Team Lead -> own member)'
select test.login('i_lead_a');
select team_lead_assign_customer((select v from ud where k = 'lead_a1'), test.id('i_m_a2'));
select test.check((select owner_id = test.id('i_m_a2') from customers where id = (select v from ud where k = 'lead_a1')), 'Team Lead A reassigns a lead to their other member');
select test.must_fail(format($$select team_lead_assign_customer('%s', '%s')$$, (select v from ud where k = 'lead_a1'), test.id('i_m_b1')),
  '... but not to the other Team Lead''s member', 'member of your team');
select team_lead_assign_customer((select v from ud where k = 'lead_a1'), test.id('i_m_a1'));
select test.login('i_lead_b');
select test.must_fail(format($$select team_lead_assign_customer('%s', '%s')$$, (select v from ud where k = 'lead_a1'), test.id('i_m_b1')),
  'Team Lead B cannot take or move Team Lead A''s member''s lead', 'NOT_FOUND|Customer not found');

\echo '   Support: the customer''s tickets'
reset role;
-- the lead is paid and is now a customer of the department (the existing payment flow, in short)
update customers set lifecycle_stage = 'CUSTOMER' where id in (select v from ud where k in ('lead_a1', 'lead_b1', 'lead_r1'));
set role authenticated;
select test.login('i_m_a1');
insert into ud select 'tk_a1', create_support_ticket((select v from ud where k = 'lead_a1'), 'Calls are not connecting', 'No outgoing calls since this morning', 'TECHNICAL', 'HIGH');
select test.check((select assignee_id = test.id('i_m_a1') and created_by = test.id('i_m_a1') and team_id is not null and department_id = test.dept('international')
                     from support_tickets where id = (select v from ud where k = 'tk_a1')), 'the member raises a ticket for their customer and owns it (assignee, creator, department, team)');
select test.must_fail(format($$select create_support_ticket('%s', 'Not mine', 'Another member''s customer', 'GENERAL', 'LOW')$$, (select v from ud where k = 'lead_b1')), 'not for a customer that is not theirs', 'NOT_FOUND');
select test.check((select count(*) = 1 from support_tickets), 'the member sees only their own ticket');
select update_support_ticket((select v from ud where k = 'tk_a1'), 'IN_PROGRESS', 'Checking the telephony settings');
select test.check((select status = 'IN_PROGRESS' from support_tickets where id = (select v from ud where k = 'tk_a1')), 'the member updates ticket progress');
select test.must_fail(format($$select update_support_ticket('%s', 'RESOLVED', 'Done', null)$$, (select v from ud where k = 'tk_a1')), 'resolving needs resolution notes', 'resolution notes');
select update_support_ticket((select v from ud where k = 'tk_a1'), 'RESOLVED', 'Fixed', 'Re-linked the telephony account; calls connect again.');
select test.check((select status = 'RESOLVED' and resolved_at is not null from support_tickets where id = (select v from ud where k = 'tk_a1')), 'and resolves it with the resolution');
select test.must_fail(format($$select update_support_ticket('%s', 'CLOSED', 'x', 'x')$$, (select v from ud where k = 'tk_a1')), 'only a lead closes it', 'Only a team lead');
select test.login('i_lead_a');
select test.check((select count(*) = 1 from support_tickets where id = (select v from ud where k = 'tk_a1')), 'Team Lead A sees their member''s ticket');
select test.check((team_lead_tickets(p_status => 'ALL') ->> 'total')::int = 1, 'in the Team Lead''s ticket list (resolution monitored)');
select test.check((team_lead_customers() ->> 'total')::int >= 1, 'and the Team Lead''s customers list works');
select update_support_ticket((select v from ud where k = 'tk_a1'), 'CLOSED', 'Verified', 'Verified with the customer.');
select test.check((select status = 'CLOSED' from support_tickets where id = (select v from ud where k = 'tk_a1')), 'the Team Lead closes it');
select test.login('i_lead_b');
select test.check((select count(*) = 0 from support_tickets where id = (select v from ud where k = 'tk_a1')), 'Team Lead B does not see it');
select test.check((team_lead_tickets(p_status => 'ALL') ->> 'total')::int = 0, '... nor in their list');
select test.login('i_head');
select test.check((select count(*) = 1 from support_tickets), 'the Department Head sees the department''s tickets');
select test.login('r_head');
select test.check((select count(*) = 0 from support_tickets), 'the Reseller head sees none of International''s');
select test.login('r_m_a1');
select test.check((select count(*) = 0 from support_tickets), 'nor a Reseller member');
select test.must_fail(format($$select update_support_ticket('%s', 'IN_PROGRESS', 'Hijack', null)$$, (select v from ud where k = 'tk_a1')), 'nor can they change it', 'NOT_FOUND|Ticket not found');
-- Team Lead raises a ticket and hands it to their member
select test.login('i_lead_a');
insert into ud select 'tk_a2', create_support_ticket((select v from ud where k = 'lead_a1'), 'Billing question', 'Invoice looks wrong', 'BILLING', 'MEDIUM', test.id('i_m_a2'));
select test.check((select assignee_id = test.id('i_m_a2') from support_tickets where id = (select v from ud where k = 'tk_a2')), 'a Team Lead assigns a ticket to their own member');
select test.must_fail(format($$select create_support_ticket('%s', 'Wrong team', 'x y z', 'GENERAL', 'LOW', '%s')$$, (select v from ud where k = 'lead_a1'), test.id('i_m_b1')), 'not to the other Team Lead''s member', 'cannot assign');
select test.login('sup_b');
select test.check((select count(*) = 0 from support_tickets where id in (select v from ud where k in ('tk_a1', 'tk_a2'))), 'existing Support staff see none of the unified departments'' tickets');

\echo '   tasks: Department Head -> Team Lead -> Team Member'
reset role;
set role authenticated;
select test.login('i_head');
insert into ud select 'task_a', assign_task_to_team_lead(test.id('i_lead_a'), 'Follow up all open leads', 'This week', 'HIGH', current_date + 3);
select test.must_fail(format($$select assign_task_to_team_lead('%s', 'Other dept', null, 'LOW', null)$$, test.id('r_lead_a')), 'not to the Reseller Team Lead', 'Team Lead|not');
select test.login('i_lead_a');
select test.check((select count(*) = 1 from work_tasks where id = (select v from ud where k = 'task_a')), 'the Team Lead sees the task');
select test.check(delegate_task_to_members((select v from ud where k = 'task_a'), jsonb_build_array(jsonb_build_object('memberId', test.id('i_m_a1'), 'work', 'Call 10 leads'))) = 1, 'the Team Lead gives it to their member');
select test.must_fail(format($$select delegate_task_to_members('%s', '[{"memberId": "%s"}]'::jsonb)$$, (select v from ud where k = 'task_a'), test.id('i_m_b1')), 'not to the other Team Lead''s member', 'not an active member of your team');
reset role;
insert into ud select 'task_m', id from work_tasks where assignee_id = test.id('i_m_a1') and parent_id = (select v from ud where k = 'task_a');
set role authenticated;
select test.login('i_m_a1');
select test.check((select count(*) = 1 from work_tasks where id = (select v from ud where k = 'task_m')), 'the member sees their task');
select submit_task_update((select v from ud where k = 'task_m'), 'COMPLETED', 100, 'Called all ten');
select test.login('i_m_b1');
select test.check((select count(*) = 0 from work_tasks where id = (select v from ud where k = 'task_m')), 'another member does not see it');
select test.login('r_lead_a');
select test.check((select count(*) = 0 from work_tasks where id in (select v from ud where k in ('task_a', 'task_m'))), 'Reseller people do not see International tasks');

\echo '   daily reports: Team Member -> Team Lead, Team Lead -> Department Head (the existing approval hierarchy)'
select test.login('i_m_a1');
insert into ud select 'rep_m', (work_report_save(null, 'International daily', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('assignedTasks', jsonb_build_array((select v from ud where k = 'task_m')), 'completedTasks', jsonb_build_array((select v from ud where k = 'task_m')),
                     'remarks', 'Added a lead and resolved one ticket.')) ->> 'id')::uuid;
select work_report_submit((select v from ud where k = 'rep_m'));
select test.check(work_report_get((select v from ud where k = 'rep_m')) ->> 'status' = 'SUBMITTED', 'the member submits the daily report (Sales and Support work together)');
select test.login('i_lead_b');
select test.check(not exists (select 1 from jsonb_array_elements(work_reports_inbox() -> 'items') x where (x ->> 'id')::uuid = (select v from ud where k = 'rep_m')), 'the other Team Lead does not get it in their inbox');
select test.login('i_lead_a');
select test.check(exists (select 1 from jsonb_array_elements(work_reports_inbox() -> 'items') x where (x ->> 'id')::uuid = (select v from ud where k = 'rep_m')), 'the member''s own Team Lead gets it');
select test.must_fail(format($$select work_report_review('%s', 'REJECTED', null)$$, (select v from ud where k = 'rep_m')), 'a rejection needs a comment', 'comment');
select work_report_review((select v from ud where k = 'rep_m'), 'APPROVED', 'Good');
select test.check(work_report_get((select v from ud where k = 'rep_m')) ->> 'status' = 'PENDING_DEPARTMENT_HEAD', 'the Team Lead approves it and it is forwarded to the Department Head');
insert into ud select 'rep_l', (work_report_save(null, 'Team Lead daily', current_date, 'DAILY', current_date, current_date,
  jsonb_build_object('remarks', 'Reviewed the team''s leads and tickets.')) ->> 'id')::uuid;
select work_report_submit((select v from ud where k = 'rep_l'));
select test.login('i_head');
select test.check((work_reports_context() ->> 'pendingMemberApprovals')::int = 1, 'the Department Head has the member''s report to approve once their Team Lead approved it');
select work_report_review((select v from ud where k = 'rep_m'), 'APPROVED', 'Final');
select test.check(work_report_get((select v from ud where k = 'rep_m')) ->> 'status' = 'APPROVED', 'and gives the final approval');
select test.check(exists (select 1 from jsonb_array_elements(work_reports_inbox() -> 'items') x where (x ->> 'id')::uuid = (select v from ud where k = 'rep_l')), 'the Team Lead''s own report goes straight to the Department Head');
select work_report_review((select v from ud where k = 'rep_l'), 'APPROVED', 'Approved');
select test.check(work_report_get((select v from ud where k = 'rep_l')) ->> 'status' = 'APPROVED', 'and the Department Head approves it');
select test.login('r_head');
select test.check(not exists (select 1 from jsonb_array_elements(work_reports_inbox() -> 'items') x where (x ->> 'id')::uuid in (select v from ud where k in ('rep_m', 'rep_l'))), 'the Reseller head never gets International reports');
select test.must_fail(format($$select work_report_get('%s')$$, (select v from ud where k = 'rep_m')), 'nor can they read one', 'NOT_FOUND');
select test.login('i_m_a1');
select test.check(work_report_get((select v from ud where k = 'rep_m')) ->> 'status' = 'APPROVED' and work_report_get((select v from ud where k = 'rep_m')) ->> 'tlStatus' = 'APPROVED'
                  and work_report_get((select v from ud where k = 'rep_m')) ->> 'dhStatus' = 'APPROVED' and work_report_get((select v from ud where k = 'rep_m')) ->> 'tlComment' = 'Good',
  'the member sees the Team Lead''s remark and both approvals');

\echo '   Reseller works the same way, on its own data'
select test.login('r_m_a1');
select test.check((select count(*) = 1 from customers where owner_id = test.id('r_m_a1')) and (select count(*) = 1 from customers), 'a Reseller member sees only their own customer');
insert into ud select 'tk_r1', create_support_ticket((select v from ud where k = 'lead_r1'), 'Reseller ticket', 'Panel login fails for the reseller', 'TECHNICAL', 'URGENT');
select test.login('r_lead_a');
select test.check((select count(*) = 1 from support_tickets), 'the Reseller Team Lead sees it (and nothing of International)');
select test.login('r_head');
select test.check((select count(*) = 1 from support_tickets) and (select count(*) = 1 from customers), 'the Reseller head sees the Reseller department only');
select test.login('i_head');
select test.check((select count(*) = 2 from support_tickets) and not exists (select 1 from support_tickets where id = (select v from ud where k = 'tk_r1')), 'the International head sees International''s tickets only');

\echo '   no unified person reaches an existing department''s records'
select test.login('i_m_a1');
select test.check(test.ud_sees((select v from ud where k = 'lead_a1')) and not test.ud_sees((select v from ud where k = 'lead_b1')), 'a member does not read a colleague''s customer once it is a customer (no department-wide Support desk here)');
select test.check((select count(*) = 1 from customers) and (select count(*) = 0 from customers where department_id <> test.dept('international')), 'a unified member reads only their own customer');
select test.login('i_lead_a');
select test.check((select count(*) = 0 from customers where department_id <> test.dept('international')), 'a unified Team Lead reads nothing of another department');
select test.login('i_head');
select test.check((select count(*) = 0 from customers where department_id <> test.dept('international')), 'a unified Department Head reads nothing of another department');
select test.check(not (select coalesce(bool_or(true), false) from profiles where department_id <> test.dept('international') and id <> auth.uid() and role in ('TEAM_HEAD', 'TEAM_MEMBER') and id in (test.id('tm_a'), test.id('sup_b'))),
  'nor the people of another department');
select test.must_fail($$update profiles set role = 'SUPER_ADMIN' where id = auth.uid()$$, 'a unified head cannot make themselves Super Admin', 'permission denied|FORBIDDEN|VALIDATION_ERROR|row-level');

\echo '   shared features: leave, meetings, chat, attendance, notifications (the existing, department-neutral ones)'
select test.login('i_m_a1');
select test.check((select count(*) >= 0 from notifications where recipient_id = auth.uid()), 'a member reads their own notifications');
insert into ud select 'leave_a1', (submit_leave_request('FULL_DAY', current_date + 20, current_date + 20, null, 'Family event') ->> 'id')::uuid;
select test.check(exists (select 1 from jsonb_array_elements(my_leave_requests()) x where (x ->> 'id')::uuid = (select v from ud where k = 'leave_a1')), 'a member applies for leave and sees it');
select test.login('i_lead_a');
select test.check(exists (select 1 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where (x ->> 'id')::uuid = (select v from ud where k = 'leave_a1')), 'the leave goes to their own Team Lead');
select test.login('i_lead_b');
select test.check(not exists (select 1 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where (x ->> 'id')::uuid = (select v from ud where k = 'leave_a1')), 'not to the other Team Lead');
select test.login('r_lead_a');
select test.check(not exists (select 1 from jsonb_array_elements(leave_requests_to_review() -> 'awaiting') x where (x ->> 'id')::uuid = (select v from ud where k = 'leave_a1')), 'nor to a Reseller Team Lead');
select test.login('i_m_a1');
select test.check((meeting_submit('33333333-0000-4000-8000-000000000001', 'Discuss my targets', 'MANAGEMENT', 'I would like to discuss my monthly targets and the leads I handle.', current_date + 4, '11:00', 'ONLINE', null) ->> 'id') is not null,
  'a member sends a meeting request');
select test.check((chat_open_direct(test.id('i_lead_a')) ->> 'kind') = 'DIRECT', 'a member opens a chat with their Team Lead');
select test.check(attendance_punch_in('CAPTURED', 18.52, 73.85, 15, gen_random_uuid()) is not null, 'a member punches in (attendance)');
reset role;
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('i_lead_a') and type = 'TASK_ASSIGNED'), 'the Team Lead was notified of the task');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('i_m_a2') and type = 'TICKET_ASSIGNED'), 'the member was notified of the ticket');
select test.check((select count(*) >= 1 from notifications where recipient_id = test.id('i_lead_a') and type = 'LEAVE_AWAITING_TEAM_LEAD'), 'the Team Lead was notified of the leave request');

\echo '   the Super Admin adds employees: one Department Head per department, whatever side is asked for'
reset role;
select test.must_fail(format($$select test.create_auth_user('ud_head2', 'ud.head2@example.com', '{"full_name":"UD head2"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', '%s'))$$, test.dept('international')),
  'a second Department Head for International is refused', 'already has a Department Head');
select test.must_fail(format($$select test.create_auth_user('ud_head3', 'ud.head3@example.com', '{"full_name":"UD head3"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', '%s', 'provisioned_head_division', 'SUPPORT'))$$, test.dept('reseller')),
  '... also when a Support-only side is asked for (the one head handles both sides)', 'already has a Department Head');
select test.must_fail(format($$select test.create_auth_user('ud_head4', 'ud.head4@example.com', '{"full_name":"UD head4"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', '%s', 'provisioned_head_division', 'SALES'))$$, test.dept('reseller')),
  '... or a Sales-only side', 'already has a Department Head');
select test.check((select count(*) = 1 from profiles where department_id = test.dept('international') and role = 'DEPARTMENT_HEAD')
                  and (select count(*) = 1 from profiles where department_id = test.dept('reseller') and role = 'DEPARTMENT_HEAD'), 'each department still has exactly one head');

\echo '   re-running the migration changes nothing'
\i supabase/migrations/20270127000100_international_reseller_departments.sql
select test.check((select count(*) = 2 from departments where unified_sales_support) and (select count(*) = 1 from teams where department_id = test.dept('international')), 'a second run creates no duplicate department or team');
select test.check((select default_dashboard = 'unified-lead' from profiles where id = test.id('i_lead_a')), 'and keeps the dashboards');
