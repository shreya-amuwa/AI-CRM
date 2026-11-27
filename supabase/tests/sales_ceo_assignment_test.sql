-- =============================================================================
-- Sales CEO -> Sales Department Head lead assignment (migration 20270303000100): who the CEO is offered (the Sales Department Heads of the
-- departments they cover; never a Support head, another department's head or themselves), the department taken from the recipient (never the
-- browser), deduplication and the same-file check per department, the Department Head's received sheets and forwarding, and the CEO's
-- Crocodial menu. Runs at the end (uses sa, sh_head, dh_wab, tm_a, th_wab, sh_tc, sup_b of the earlier suites).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- sales CEO lead assignment'
reset role;
-- earlier suites re-run older migrations that redefine these functions; this one is safe to run twice
\i supabase/migrations/20270303000100_sales_ceo_lead_assignment.sql
\i supabase/migrations/20270303000100_sales_ceo_lead_assignment.sql
do $$
begin
  if not exists (select 1 from test.users where name = 'sc_ceo') then
    perform test.create_auth_user('sc_ceo', 'sc.ceo@example.com', '{"full_name":"SC Sales CEO"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD',
      'provisioned_department_id', test.dept('dtalk'), 'provisioned_head_division', 'SALES', 'provisioned_operations_head', true));
    perform test.create_auth_user('sc_sup', 'sc.sup@example.com', '{"full_name":"SC Support CEO"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD',
      'provisioned_department_id', test.dept('wabastore'), 'provisioned_head_division', 'SUPPORT', 'provisioned_operations_head', true));
    perform test.create_auth_user('sc_wbx_tm', 'sc.wbxtm@example.com', '{"full_name":"SC Whatsbox Member"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
      'provisioned_team_id', test.team('whatsbox', 'Sales')));
  end if;
end $$;
update profiles set status = 'ACTIVE', is_operations_head = true where id in (test.id('sc_ceo'), test.id('sc_sup'));
delete from operations_head_departments where profile_id in (test.id('sc_ceo'), test.id('sc_sup'));
insert into operations_head_departments (profile_id, department_id, division) values
  (test.id('sc_ceo'), test.dept('wabastore'), 'SALES'), (test.id('sc_ceo'), test.dept('whatsbox'), 'SALES'),
  (test.id('sc_sup'), test.dept('whatsbox'), 'SUPPORT');
delete from customers where phone like '+9198776%';
delete from sales_lead_sheets where file_name like 'ceo-%';
create temp table sc_rows as select '[{"row":2,"name":"CEO Lead A","phone":"+919877600001","email":"a@ceo.example"},{"row":3,"name":"CEO Lead B","phone":"+919877600002"},{"row":4,"name":"CEO Lead C","phone":"+919877600003"},{"row":5,"name":"","phone":"+919877600004"}]'::jsonb as r;
grant select on sc_rows to authenticated;
set role authenticated;

\echo '   who the CEO is offered'
select test.login('sc_ceo');
select test.check((select bool_or(x ->> 'id' = test.id('sh_head')::text and x ->> 'role' = 'Department Head' and x ->> 'departmentId' = test.dept('wabastore')::text)
                      and bool_or(x ->> 'id' = test.id('dh_wbx')::text and x ->> 'role' = 'Department Head' and x ->> 'departmentId' = test.dept('whatsbox')::text)
                     from jsonb_array_elements(sales_lead_assignees()) x),
  'the Sales CEO sees the Sales Department Heads of the departments they cover, with the department');
select test.check((select not bool_or(x ->> 'id' in (test.id('dh_wab')::text, test.id('ac_dg')::text, test.id('sc_ceo')::text, test.id('sc_sup')::text))
                     from jsonb_array_elements(sales_lead_assignees()) x),
  'never a Support head, the head of a department they do not cover, another CEO or themselves');
select test.check((select (array_agg(x ->> 'role'))[1] = 'Department Head' from jsonb_array_elements(sales_lead_assignees()) x),
  'the Department Heads come first');
select test.check((select bool_or(x ->> 'id' = test.id('sc_wbx_tm')::text and x ->> 'role' = 'Team Member') and not bool_or(x ->> 'id' = test.id('sup_b')::text)
                     from jsonb_array_elements(sales_lead_assignees()) x),
  'the existing choices stay: the Sales Team Members of the departments they cover (no Support person)');
select test.login('sc_sup');
select test.must_fail($$select sales_lead_assignees()$$, 'a Support-only CEO cannot use Lead Assign', 'Sales Department Head');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sh_head'), 'ceo-x.xlsx', null, (select r from sc_rows), repeat('e', 64), false)$$, 'nor assign to a Sales head', 'Sales Department Head');
select test.login('sh_head');
select test.check((select not bool_or(x ->> 'role' = 'Department Head') from jsonb_array_elements(sales_lead_assignees()) x),
  'a Department Head is not offered Department Heads (unchanged list)');
select test.must_fail($$select sales_lead_sheet_assign(test.id('dh_wbx'), 'ceo-x.xlsx', null, (select r from sc_rows), repeat('e', 64), false)$$,
  'and cannot give leads to another Department Head', 'Department Head of a department you cover');

\echo '   assigning a sheet to a Department Head'
select test.login('sc_ceo');
select test.must_fail($$select sales_lead_sheet_assign(test.id('ac_dg'), 'ceo-x.xlsx', null, (select r from sc_rows), repeat('e', 64), false)$$,
  'the CEO cannot assign to the head of an unrelated department', 'Department Head of a department you cover');
select test.must_fail($$select sales_lead_sheet_assign(test.id('dh_wab'), 'ceo-x.xlsx', null, (select r from sc_rows), repeat('e', 64), false)$$,
  'nor to the Support head of a department they cover', 'Department Head of a department you cover');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sc_ceo'), 'ceo-x.xlsx', null, (select r from sc_rows), repeat('e', 64), false)$$,
  'nor to themselves', 'Department Head of a department you cover');
select test.check((select (x ->> 'committed')::boolean = false and x -> 'summary' ->> 'valid' = '3' and x -> 'summary' ->> 'invalid' = '1'
                          and x -> 'assignee' ->> 'role' = 'Department Head' and x -> 'assignee' ->> 'departmentId' = test.dept('wabastore')::text
                     from (select sales_lead_sheet_assign(test.id('sh_head'), 'ceo-leads.xlsx', 'Expo', (select r from sc_rows), repeat('e', 64), false) as x) s),
  'the preview checks the rows and names the department (the recipient''s), and saves nothing');
reset role;
select test.check((select count(*) = 0 from customers where phone like '+9198776%'), 'nothing was saved by the preview');
set role authenticated;
select test.login('sc_ceo');
select test.check(((sales_lead_sheet_assign(test.id('sh_head'), 'ceo-leads.xlsx', 'Expo', (select r from sc_rows), repeat('e', 64), true)) ->> 'committed')::boolean,
  'the CEO assigns the sheet to the Wabastore Sales Department Head');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sh_head'), 'ceo-leads.xlsx', 'Expo', (select r from sc_rows), repeat('e', 64), true)$$,
  'the same file twice is refused', 'already been uploaded');
select test.must_fail($$select sales_lead_sheet_assign(test.id('sh_head'), 'ceo-again.xlsx', null, (select r from sc_rows), repeat('f', 64), true)$$,
  'and its rows again (another file) are duplicates: nothing to assign', 'no valid contact');
reset role;
select test.check((select count(*) = 3 and bool_and(owner_id = test.id('sh_head') and department_id = test.dept('wabastore') and lifecycle_stage = 'LEAD' and source_sheet_id is not null)
                     from customers where phone like '+9198776%'), 'three leads, owned by the Department Head, in the Wabastore department, linked to the sheet');
select test.check((select count(*) = 1 from sales_lead_sheets where file_name = 'ceo-leads.xlsx' and department_id = test.dept('wabastore') and uploaded_by = test.id('sc_ceo') and assigned_to = test.id('sh_head')),
  'the sheet is kept with the department, the CEO as uploader and the head as receiver');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sh_head') and type = 'LEAD_SHEET_ASSIGNED' and body like '%by SC Sales CEO%'),
  'the Department Head is notified, with who assigned the leads');
select test.check((select count(*) = 3 from customer_activities a join customers c on c.id = a.customer_id
                    where c.phone like '+9198776%' and a.type = 'LEAD_CREATED' and a.actor_id = test.id('sc_ceo') and a.note like '%assigned by SC Sales CEO%'),
  'each lead records who assigned it');
select test.check((select count(*) = 1 from audit_logs where action = 'SALES_LEAD_SHEET_ASSIGNED' and entity_id = (select id from sales_lead_sheets where file_name = 'ceo-leads.xlsx')
                     and department_id = test.dept('wabastore') and (metadata ->> 'byCeo')::boolean),
  'the audit entry has the department and says the CEO assigned it');
set role authenticated;
select test.login('sc_ceo');
select test.check((select x ->> 'department' is not null and x ->> 'assigneeRole' = 'Department Head' from jsonb_array_elements(sales_lead_sheets_list()) x where x ->> 'fileName' = 'ceo-leads.xlsx'),
  'the CEO''s upload history lists it with the department');
select test.check((select count(*) = 0 from jsonb_array_elements(sales_lead_sheets_list()) x where x ->> 'department' = 'Digitree'), 'and nothing of a department they do not cover');

\echo '   the Department Head''s side'
select test.login('sh_head');
select test.check((select x ->> 'assignedBy' = 'SC Sales CEO' and x ->> 'assignedByRole' = 'CEO' and (x ->> 'openWithMe')::int = 3 and x ->> 'assignedAt' is not null
                     from jsonb_array_elements(sales_sheets_received()) x where x ->> 'fileName' = 'ceo-leads.xlsx'),
  'the Department Head sees the sheet given to them: by whom, when, and 3 leads still with them');
select test.check((select count(*) = 3 from customers where phone like '+9198776%'), 'and the leads in their pipeline');
select test.check((select count(*) >= 1 and bool_or(x ->> 'id' = test.id('tm_a')::text) and not bool_or(x ->> 'id' in (test.id('sup_b')::text, test.id('sh_tc')::text))
                     from jsonb_array_elements(sales_forward_assignees((select id from sales_lead_sheets where file_name = 'ceo-leads.xlsx'))) x),
  'forwarding: their Sales Team Leads and Team Members (no Support person; a Telecaller works from call lists)');
select test.must_fail($$select sales_sheet_forward((select id from sales_lead_sheets where file_name = 'ceo-leads.xlsx'), test.id('sup_b'), 1)$$, 'not to a Support member', 'Sales Team Lead or Team Member');
select test.must_fail($$select sales_sheet_forward((select id from sales_lead_sheets where file_name = 'ceo-leads.xlsx'), test.id('sc_wbx_tm'), 1)$$, 'nor to another department', 'Sales Team Lead or Team Member');
reset role;
create temp table sc_before as select count(*) as n from customers;
set role authenticated;
select test.login('sh_head');
select test.check((sales_sheet_forward((select id from sales_lead_sheets where file_name = 'ceo-leads.xlsx'), test.id('tm_a'), 2) ->> 'moved')::int = 2, 'two leads are forwarded to a Team Member');
reset role;
select test.check((select count(*) from customers) = (select n from sc_before), 'no customer record was created by forwarding');
select test.check((select count(*) = 2 from customers where phone like '+9198776%' and owner_id = test.id('tm_a')) and (select count(*) = 1 from customers where phone like '+9198776%' and owner_id = test.id('sh_head')),
  'the same leads changed owner (two with the member, one still with the head)');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and type = 'LEAD_SHEET_ASSIGNED' and body like '%forwarded%'), 'the member is notified');
set role authenticated;
select test.login('sh_head');
select test.check((select (x ->> 'openWithMe')::int = 1 and (x ->> 'forwarded')::int = 2 from jsonb_array_elements(sales_sheets_received()) x where x ->> 'fileName' = 'ceo-leads.xlsx'),
  'the received sheet shows 1 open with the head and 2 forwarded');
select test.login('dh_wbx');
select test.must_fail($$select sales_sheet_forward((select id from sales_lead_sheets where file_name = 'ceo-leads.xlsx'), test.id('sc_wbx_tm'), 1)$$, 'another head cannot forward it', 'not found');
select test.check(jsonb_array_length(sales_sheets_received()) = 0, 'and does not see it');
select test.login('tm_a');
select test.must_fail($$select sales_sheets_received()$$, 'a Team Member has no received sheets page', 'Department Heads');

\echo '   the CEO''s Crocodial menu'
reset role;
delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SCTEST';
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('SC test', 'CROCODIAL_TOKEN_SCTEST', true, 'Asia/Kolkata');
insert into crocodial_department_links (connection_id, department_id, division, enabled)
  select id, test.dept('whatsbox'), 'SALES', true from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SCTEST';
insert into crocodial_rollout (department_id, division, allowed) values (test.dept('whatsbox'), 'SALES', true)
  on conflict (department_id, division) do update set allowed = true;
set role authenticated;
select test.login('sc_ceo');
select test.check((select (x ->> 'rollout')::boolean and (x ->> 'eligible')::boolean and x ->> 'kind' = 'OPERATIONS_HEAD'
                          and exists (select 1 from jsonb_array_elements(x -> 'enabledDepartments') d where d ->> 'departmentId' = test.dept('whatsbox')::text)
                          and x -> 'self' ->> 'state' = 'NOT_MAPPED'
                     from (select croc_refresh_capabilities() as x) s),
  'a Sales CEO with no mapping of their own keeps the Crocodial menu for a covered Sales department where Crocodial is on (home department elsewhere)');
select test.login('sc_sup');
select test.check((select not (x ->> 'eligible')::boolean and jsonb_array_length(x -> 'enabledDepartments') = 0 from (select croc_refresh_capabilities() as x) s),
  'a Support-only CEO gets no Crocodial menu for that department');
select test.must_fail($$select croc_refresh_request('DEPARTMENT', test.dept('whatsbox'))$$, 'and cannot refresh it', 'Nobody you oversee');
select test.login('ac_dg');
select test.check((select not (x ->> 'eligible')::boolean from (select croc_refresh_capabilities() as x) s), 'the head of a department without Crocodial gets no menu');
reset role;
delete from crocodial_department_links where connection_id in (select id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SCTEST');
delete from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_SCTEST';
update crocodial_rollout set allowed = false where department_id = test.dept('whatsbox') and division = 'SALES';
delete from customers where phone like '+9198776%';
delete from sales_lead_sheets where file_name like 'ceo-%';
