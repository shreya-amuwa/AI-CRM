-- =============================================================================
-- Sales Department Head dashboard (migration 20261121000100): who the Sales head is, the separation from Support, Lead Assign / Sheet Upload (a sheet given to a
-- Telecaller as a call list, or to a Sales Team Lead / Team Member as leads in their pipeline: 20270101000200),
-- Lead List, Daily Tasks, Overview, Reports, Income. Uses the Wabastore users of the authorization suite plus those made here.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- sales department head'
reset role;
select test.create_auth_user('sh_head', 'sh.head@amuwa.com', '{"full_name":"Sales Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastore'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('sh_tc', 'sh.tc@amuwa.com', '{"full_name":"Sheet Telecaller"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('sh_ba', 'sh.ba@amuwa.com', '{"full_name":"Sheet BA"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
update profiles set sales_sub_role = 'TELECALLER' where id = test.id('sh_tc');
update profiles set sales_sub_role = 'BUSINESS_ASSOCIATE' where id = test.id('sh_ba');
select test.check((select default_dashboard = 'sales-department-head' from profiles where id = test.id('sh_head')), 'a Sales Department Head opens the sales-department-head dashboard');
select test.check((select default_dashboard = 'department-head' from profiles where id = test.id('dh_wab')), 'the Support head keeps the Department Head dashboard');
-- data of both sides
insert into customers (owner_id, name, phone, email, lifecycle_stage, lead_temperature, call_status, lead_source)
  values (test.id('tm_a'), 'Sales Lead One', '+919800000001', 'one@sales.example', 'LEAD', 'HOT', 'PENDING', 'Website'),
         (test.id('tm_a'), 'Sales Lead Two', '+919800000002', null, 'LEAD', 'COLD', 'FOLLOW_UP_REQUIRED', 'Referral'),
         (test.id('sup_b'), 'Support Customer', '+919800000099', 'cust@support.example', 'CUSTOMER', null, null, null);
update customers set next_follow_up_at = now() - interval '1 hour' where name = 'Sales Lead Two';
insert into work_tasks (department_id, team_id, title, assigned_by, assignee_id, due_date, status)
  values (test.dept('wabastore'), test.team('wabastore', 'Support'), 'Support only task', test.id('dh_wab'), test.id('sup_th'), current_date + 1, 'ASSIGNED');

set role authenticated;
\echo '   who may use it'
select test.login('dh_wab');
select test.must_fail($$select sales_head_overview()$$, 'the Support head cannot open the Sales head pages', 'Sales Department Head');
select test.must_fail($$select sales_leads_list()$$, 'nor the lead list', 'Sales Department Head');
select test.login('th_wab');
select test.must_fail($$select sales_lead_assignees()$$, 'a Team Lead cannot', 'Sales Department Head');
select test.login('sa');
select test.must_fail($$select sales_lead_sheets_list()$$, 'the pages are the Sales head''s own', 'Sales Department Head');

\echo '   separation from Support'
select test.login('sh_head');
select test.check((select count(*) = 0 from customers where name = 'Support Customer'), 'the Sales head does not read a Support team''s customers');
select test.check((select count(*) >= 2 from customers where name like 'Sales Lead%'), 'but reads the Sales team''s leads');
select test.check((select count(*) = 0 from profiles where id = test.id('sup_b')), 'does not see Support people');
select test.check((select count(*) = 1 from profiles where id = test.id('tm_a')), 'sees Sales people');
select test.check((select count(*) = 0 from work_tasks where title = 'Support only task'), 'does not read Support tasks');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', test.dept('wabastore'), test.team('wabastore', 'Support'))$$, 'cannot create a Support employee', 'not allowed');
select test.check(assert_can_create_user('TEAM_MEMBER', test.dept('wabastore'), test.team('wabastore', 'Sales')), 'can create a Sales employee');
select test.must_fail($$select assign_task_to_team_lead(test.id('sup_th'), 'x', null, 'LOW', null)$$, 'cannot give a task to a Support team, even through the existing function', 'Sales teams only');
reset role;
select test.check((select (private.chat_may_message(test.id('sh_head'), test.id('sup_b'))) = false), 'chat: not with Support people');
select test.check((select (private.chat_may_message(test.id('sh_head'), test.id('dh_wab'))) = false), 'chat: not with the Support head');
select test.check((select (private.chat_may_message(test.id('sh_head'), test.id('tm_a'))) = true), 'chat: with Sales people');
select test.check((select (private.chat_may_message(test.id('dh_wab'), test.id('sup_b'))) = true), 'chat: Support heads are unchanged');
set role authenticated;
select test.login('sh_head');
select test.check((select jsonb_array_length(performance_people('WEEK', (date_trunc('week', current_date))::date, (date_trunc('week', current_date))::date + 6) -> 'people') > 0 and (performance_people('WEEK', (date_trunc('week', current_date))::date, (date_trunc('week', current_date))::date + 6) -> 'department') = 'null'::jsonb
                          and not exists (select 1 from jsonb_array_elements(performance_people('WEEK', (date_trunc('week', current_date))::date, (date_trunc('week', current_date))::date + 6) -> 'people') x where x ->> 'id' = test.id('sup_b')::text)),
  'performance: Sales people only, no whole-department card');
select test.login('dh_wab');
select test.check((select count(*) > 0 from customers where name = 'Support Customer') and (select count(*) > 0 from work_tasks where title = 'Support only task'), 'the Support head still reads Support data');

\echo '   Lead Assign / Sheet Upload (a Telecaller gets a call list; a Sales Team Lead or Team Member gets leads)'
select test.login('sh_head');
select test.check((select bool_and(case when x ->> 'subRole' = 'TELECALLER' then x ->> 'mode' = 'TELECALLER' else x ->> 'mode' = 'LEADS' end)
                          and bool_or(x ->> 'id' = test.id('sh_tc')::text) and bool_or(x ->> 'id' = test.id('tm_a')::text and x ->> 'role' = 'Team Member')
                          and bool_or(x ->> 'id' = test.id('th_wab')::text and x ->> 'role' = 'Team Lead')
                          and not bool_or(x ->> 'id' in (test.id('sup_b')::text, test.id('sh_ba')::text, test.id('sup_th')::text))
                     from jsonb_array_elements(sales_lead_assignees()) x),
  'assignees: the department''s Sales Team Leads, Team Members and Telecallers (no Business Associate, no Support person)');
select test.check((select count(*) >= 5 from jsonb_array_elements(sales_team_people())) and not exists (select 1 from jsonb_array_elements(sales_team_people()) x where x ->> 'id' = test.id('sup_b')::text), 'team people: every Sales Team Lead and member, no Support');
create temp table sheet_rows as select '[
  {"row":2,"name":"Anil Kumar","company":"Kumar Traders","phone":"+91 98100 00001","email":"anil@kumar.example","remarks":"Met at stall"},
  {"row":3,"name":"Bina Shah","company":"","phone":"9810000002","email":"","remarks":""},
  {"row":4,"name":"Chirag","company":"","phone":"abc","email":"","remarks":""},
  {"row":5,"name":"Anil Again","company":"","phone":"+919810000001","email":"","remarks":""},
  {"row":6,"name":"Known Person","company":"","phone":"+919800000001","email":"","remarks":""},
  {"row":7,"name":"Dev Rao","company":"","phone":"9810000007","email":"dev@","remarks":""},
  {"row":8,"name":"Esha","company":"","phone":"9810000008","email":"esha@x.example","remarks":""}]'::jsonb as r;
select test.check((sales_lead_sheet_assign(test.id('sh_tc'), 'leads.xlsx', null, (select r from sheet_rows), repeat('a', 64), false) -> 'summary') = '{"rows":7,"valid":3,"invalid":2,"duplicates":2}'::jsonb, 'preview summary: 7 rows = 3 valid + 2 invalid + 2 duplicates');
select test.check((select count(*) = 0 from telecaller_contacts where assigned_to = test.id('sh_tc')) and (select count(*) = 0 from sales_lead_sheets), 'a preview saves nothing');
select test.check((select count(*) = 4 from jsonb_array_elements(sales_lead_sheet_assign(test.id('sh_tc'), 'leads.xlsx', null, (select r from sheet_rows), repeat('a', 64), false) -> 'issues')), 'every problem row is listed (none dropped silently)');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sup_b'), 'leads.xlsx', null, (select r from sheet_rows), repeat('a', 64), true)$$, 'a sheet cannot go to a Support member', 'Sales Team Lead, Team Member or Telecaller');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sup_th'), 'leads.xlsx', null, (select r from sheet_rows), repeat('a', 64), true)$$, 'nor to a Support Team Lead', 'Sales Team Lead, Team Member or Telecaller');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sh_ba'), 'leads.xlsx', null, (select r from sheet_rows), repeat('a', 64), true)$$, 'nor to a Business Associate (their own contact lists)', 'Sales Team Lead, Team Member or Telecaller');
select test.check((select count(*) = 0 from sales_lead_sheets), 'the refused uploads saved nothing');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sh_tc'), 'bad.xlsx', null, '[{"row":2,"name":"","phone":"x"}]'::jsonb, repeat('b', 64), true)$$, 'nothing valid: nothing is assigned', 'no valid contact');
select test.check(((sales_lead_sheet_assign(test.id('sh_tc'), 'leads.xlsx', 'Expo list', (select r from sheet_rows), repeat('a', 64), true)) ->> 'committed')::boolean, 'the sheet is given to the Telecaller');
select test.check((select count(*) = 3 from telecaller_contacts where assigned_to = test.id('sh_tc')), 'the three valid contacts are in the Telecaller''s list');
select test.check((select count(*) = 0 from customers where phone in ('+919810000001', '9810000001', '+919810000002', '9810000002')), 'and no lead is made behind their back');
select test.check((select count(*) = 1 from sales_lead_sheets where file_name = 'leads.xlsx' and valid_count = 3 and invalid_count = 2 and duplicate_count = 2 and uploaded_by = test.id('sh_head') and mode = 'TELECALLER' and telecaller_list_id is not null), 'the upload is recorded with who and the counts');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sh_tc'), 'again.xlsx', null, (select r from sheet_rows), repeat('a', 64), true)$$, 'the same file cannot be imported twice', 'already been uploaded');
select test.check((select jsonb_array_length(sales_lead_sheets_list()) = 1 and (sales_lead_sheets_list() -> 0 ->> 'assignedTo') = 'Sheet Telecaller' and (sales_lead_sheets_list() -> 0 ->> 'contactsPending')::int = 3), 'the history lists the sheet, the Telecaller and what is still to call');
select test.login('sh_tc');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sh_tc') and type = 'CONTACT_SHEET_ASSIGNED'), 'the Telecaller is notified');
select test.login('tm_s2');
select test.check((select count(*) = 0 from telecaller_contacts), 'another member does not see the sheet');
select test.login('sh_head');

\echo '   Sheet Upload to a Sales Team Member: leads in their own pipeline'
create temp table member_rows as select '[
  {"row":2,"name":"Farah Khan","company":"Khan Exports","phone":"+91 97770 00001","email":"farah@khan.example","remarks":"Expo, wants a call"},
  {"row":3,"name":"Gopal Iyer","company":"","phone":"97770-00002","email":"","remarks":""},
  {"row":4,"name":"","company":"","phone":"9777000003","email":"","remarks":""},
  {"row":5,"name":"Farah Twice","company":"","phone":"+91 97770 00001","email":"","remarks":""},
  {"row":6,"name":"Known Again","company":"","phone":"+919800000002","email":"","remarks":""}]'::jsonb as r;
grant select on member_rows to authenticated;
select test.check((select x ->> 'mode' = 'LEADS' and (x -> 'summary') = '{"rows":5,"valid":2,"invalid":1,"duplicates":2}'::jsonb and x -> 'assignee' ->> 'role' = 'Team Member'
                     from (select sales_lead_sheet_assign(test.id('tm_a'), 'members.csv', null, (select r from member_rows), repeat('c', 64), false) x) q),
  'preview for a Team Member: leads mode, 2 valid + 1 invalid + 2 duplicates');
select test.check((select count(*) = 0 from customers where phone like '977700000%'), 'a preview makes no lead');
create temp table member_sheet as select sales_lead_sheet_assign(test.id('tm_a'), 'members.csv', 'Expo leads', (select r from member_rows), repeat('c', 64), true) as v;
grant select on member_sheet to authenticated;
select test.check((select (v ->> 'committed')::boolean and v ->> 'mode' = 'LEADS' from member_sheet), 'the sheet is given to the Team Member');
reset role;
select test.check((select count(*) = 2 and bool_and(owner_id = test.id('tm_a') and lifecycle_stage = 'LEAD' and lead_status = 'NEW' and lead_source = 'Excel sheet'
                          and department_id = test.dept('wabastore') and team_id = test.team('wabastore', 'Sales') and source_sheet_id = (select (v ->> 'sheetId')::uuid from member_sheet))
                     from customers where phone in ('+919777000001', '9777000002')),
  'two leads in the member''s pipeline: owned by them, in their department and team, linked to the sheet');
select test.check((select count(*) = 2 from customer_activities a join customers c on c.id = a.customer_id where c.phone in ('+919777000001', '9777000002') and a.type = 'LEAD_CREATED'),
  'each lead has its "added from the sheet" activity');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'LEAD_SHEET_ASSIGNED')
              and (select count(*) = 1 from notifications where recipient_id = test.id('th_wab') and type = 'LEAD_SHEET_ASSIGNED'),
  'the member and their own Team Lead are notified');
select test.check((select jsonb_array_length(issues) = 3 and issues @> '[{"row":4,"kind":"INVALID"},{"row":5,"kind":"DUPLICATE","name":"Farah Twice"},{"row":6,"kind":"DUPLICATE","phone":"+919800000002"}]'::jsonb
                     from sales_lead_sheets where file_name = 'members.csv'),
  'the left-out rows are kept with the sheet, with the values that were sent');
set role authenticated;
select test.login('tm_a');
select test.check((select count(*) = 2 from customers where phone in ('+919777000001', '9777000002')), 'the member sees the leads');
select test.login('th_wab');
select test.check((select count(*) = 2 from customers where phone in ('+919777000001', '9777000002')), 'their Team Lead sees them');
select test.login('tm_s2');
select test.check((select count(*) = 0 from customers where phone in ('+919777000001', '9777000002')), 'another member of the team does not');
select test.login('sup_b');
select test.check((select count(*) = 0 from customers where phone in ('+919777000001', '9777000002')), 'nor Support');
select test.login('dh_wab');
select test.check((select count(*) = 0 from customers where phone in ('+919777000001', '9777000002')), 'nor the Support Department Head');
select test.must_fail($$select sales_lead_sheet_issues((select (v ->> 'sheetId')::uuid from member_sheet))$$, 'the Support head cannot read a Sales sheet''s left-out rows', 'Sales Department Head');
select test.login('tm_a');
select test.must_fail($$select sales_lead_sheet_issues((select (v ->> 'sheetId')::uuid from member_sheet))$$, 'nor the member', 'Sales Department Head');
select test.login('sh_head');
select test.check((select count(*) = 2 from customers where phone in ('+919777000001', '9777000002')), 'the Sales Department Head sees them');
select test.check((select x ->> 'kept' = 'true' and jsonb_array_length(x -> 'issues') = 3 from (select sales_lead_sheet_issues((select (v ->> 'sheetId')::uuid from member_sheet)) x) q),
  'the Sales head reads the left-out rows of the sheet');
select test.must_fail($$select sales_lead_sheet_issues(gen_random_uuid())$$, 'an unknown sheet is not found', 'NOT_FOUND');
select test.check((select x ->> 'mode' = 'LEADS' and x ->> 'assigneeRole' = 'Team Member' and (x ->> 'leadsNow')::int = 2 and (x ->> 'issuesKept')::boolean
                     from jsonb_array_elements(sales_lead_sheets_list()) x where x ->> 'fileName' = 'members.csv'),
  'the history lists the upload: who, the leads in the pipeline, and that the left-out rows are kept');
select test.check((select (x ->> 'issuesKept')::boolean = false from jsonb_array_elements(sales_lead_sheets_list()) x where x ->> 'fileName' = 'leads.xlsx') is not null, 'older uploads are still listed');
select test.must_fail($$select sales_lead_sheet_assign(test.id('tm_a'), 'members-again.csv', null, (select r from member_rows), repeat('c', 64), true)$$, 'the same file is not imported twice', 'already been uploaded');
select test.check((select count(*) = 2 from customers where phone in ('+919777000001', '9777000002')), 'and no lead was doubled');
select test.check(((sales_lead_sheet_assign(test.id('th_wab'), 'lead.csv', null, '[{"row":2,"name":"Hari Lal","phone":"9777000010"}]'::jsonb, repeat('d', 64), true)) ->> 'mode') = 'LEADS',
  'a Team Lead gets the leads in their own pipeline too');
reset role;
select test.check((select owner_id = test.id('th_wab') and lifecycle_stage = 'LEAD' from customers where phone = '9777000010'), 'owned by the Team Lead');
set role authenticated;
select test.login('sh_head');

\echo '   Lead List'
select test.check((sales_leads_list() ->> 'total')::int >= 2, 'the list has the Sales leads');
select test.check((select bool_and(x ->> 'temperature' = 'HOT') from jsonb_array_elements(sales_leads_list(null, 'HOT') -> 'items') x), 'Hot filter');
select test.check((sales_leads_list(null, 'ALL') -> 'counts' ->> 'hot')::int >= 1 and (sales_leads_list() -> 'counts' ->> 'cold')::int >= 1, 'counts by temperature');
select test.check((select count(*) = 1 from jsonb_array_elements(sales_leads_list('lead one') -> 'items')), 'search by name');
select test.check((select count(*) >= 1 from jsonb_array_elements(sales_leads_list(null, 'FOLLOW_UP') -> 'items')), 'follow-up filter');
select test.must_fail($$select sales_leads_list(null, 'BOGUS')$$, 'unknown filter', 'Unknown lead filter');
select test.check(not exists (select 1 from jsonb_array_elements(sales_leads_list(null, 'ALL', null, 'name', 'asc', 1, 100) -> 'items') x where x ->> 'name' = 'Support Customer'), 'no Support customer is in the list');
reset role;
insert into crm_leads (id, name, phone, department, sub_department) values ('inb-test-1', 'Inbound Ivan', '+919810000077', 'wabastore', 'sales');
set role authenticated;
select test.login('sh_head');
select test.check((select count(*) = 1 from jsonb_array_elements(sales_leads_list(null, 'UNASSIGNED') -> 'items') x where x ->> 'name' = 'Inbound Ivan'), 'an inbound enquiry nobody took is "unassigned"');
select test.must_fail($$select sales_inbound_assign('inb-test-1', test.id('sup_b'))$$, 'not to a Support member', 'Sales Team Lead or Team Member');
select test.check((sales_inbound_assign('inb-test-1', test.id('tm_s2')) ->> 'assignee') = 'Second Sales Member', 'the head assigns it');
select test.check((select count(*) = 0 from jsonb_array_elements(sales_leads_list(null, 'UNASSIGNED') -> 'items') x where x ->> 'name' = 'Inbound Ivan') and (select count(*) = 1 from customers where owner_id = test.id('tm_s2') and name = 'Inbound Ivan'), 'it leaves the unassigned list and is the member''s lead');
select test.check((sales_lead_get((select id from jsonb_to_recordset(sales_leads_list('lead one') -> 'items') as x(id text) limit 1)) ->> 'name') = 'Sales Lead One', 'lead details');
select test.must_fail($$select sales_lead_get((select id::text from customers where name = 'Support Customer' limit 1))$$, 'a Support customer is not a lead of this dashboard', 'not found|NOT_FOUND|Lead not found');

\echo '   Daily Tasks'
select test.check(sales_task_assign(test.id('th_wab'), 'Call the expo leads', 'Follow up', 'HIGH', current_date - 1) is not null, 'a task is given to a Sales Team Lead');
select test.must_fail($$select sales_task_assign(test.id('sup_th'), 'x', null, 'LOW', null)$$, 'not to a Support lead', 'Team Lead of a Sales team');
select test.check((sales_tasks_list() -> 'counts' ->> 'overdue')::int >= 1 and (select bool_and((x ->> 'overdue')::boolean) from jsonb_array_elements(sales_tasks_list('OVERDUE') -> 'items') x), 'overdue filter');
select test.check(not exists (select 1 from jsonb_array_elements(sales_tasks_list() -> 'items') x where x ->> 'title' = 'Support only task'), 'Support tasks are not listed');
select test.check((select count(*) = 1 from jsonb_array_elements(sales_task_assignees()) x where x ->> 'id' = test.id('th_wab')::text) and (select count(*) = 0 from jsonb_array_elements(sales_task_assignees()) x where x ->> 'id' = test.id('sup_th')::text), 'task assignees are Sales Team Leads');

\echo '   Overview, Reports, Income'
select test.check((sales_head_overview() -> 'cards' ->> 'totalLeads')::int >= 3 and (sales_head_overview() -> 'cards' ->> 'teamMembers')::int >= 3, 'overview counts');
select test.check((sales_head_overview() -> 'cards' ->> 'pendingAssignment')::int = (sales_leads_list(null, 'UNASSIGNED') ->> 'total')::int, 'overview: pending assignment matches the unassigned list');
select test.check(not exists (select 1 from jsonb_array_elements(sales_head_overview() -> 'teamActivity') x where x ->> 'id' = test.id('sup_b')::text), 'overview: no Support people');
select test.check((select count(*) >= 1 from jsonb_array_elements(sales_head_reports('TEAM_LEAD', null, null) -> 'rows') x where x ->> 'id' = test.id('th_wab')::text)
              and not exists (select 1 from jsonb_array_elements(sales_head_reports('TEAM_LEAD', null, null) -> 'rows') x where x ->> 'id' = test.id('sup_th')::text), 'team lead report: Sales leads only');
select test.check((select (x ->> 'leadsAssigned')::int >= 2 and (x ->> 'hot')::int >= 1 from jsonb_array_elements(sales_head_reports('TEAM_MEMBER', null, null) -> 'rows') x where x ->> 'id' = test.id('tm_a')::text), 'team member report: leads and temperature');
select test.check(not exists (select 1 from jsonb_array_elements(sales_head_reports('TEAM_MEMBER', null, null) -> 'rows') x where x ->> 'id' = test.id('sup_b')::text), 'team member report: no Support members');
select test.must_fail($$select sales_head_reports('MANAGER', null, null)$$, 'report kind is checked', 'Team Lead or Team Member');
select test.check((sales_head_income() -> 'figures') is not null and (sales_head_income() ->> 'expenses') is null, 'income: Sales figures; no invented expense figure');
reset role;
