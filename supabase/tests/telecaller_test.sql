-- =============================================================================
-- Telecaller (migration 20261118000100): the Sales sub-role, contact sheets assigned by the Department Head, call updates, leads with a
-- temperature, and the Home counts. Uses the Wabastore Sales users of the authorization suite plus two Telecallers made here.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- telecaller'
reset role;
select test.create_auth_user('tc_a', 'tc.a@amuwa.com', '{"full_name":"Tele A"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('tc_b', 'tc.b@amuwa.com', '{"full_name":"Tele B"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('tc_v', 'tc.v@amuwa.com', '{"full_name":"Visit V"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('tc_x', 'tc.x@amuwa.com', '{"full_name":"Tele X"}',
  jsonb_build_object('provisioned_by', test.id('th_wbx'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('whatsbox', 'Sales')));
create or replace function test.svc() returns text language sql stable as $$ select code from public.crm_services where is_active order by sort_order limit 1 $$;
create or replace function test.rowsjson(n int, tag text) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('row', g + 1, 'name', 'Person ' || tag || g, 'company', 'Co ' || g, 'phone', '+9198000' || lpad(g::text, 5, '0'), 'email', 'p' || tag || g || '@example.com'))
    from generate_series(1, n) g $$;
grant execute on function test.svc(), test.rowsjson(int, text) to authenticated;
set role authenticated;

\echo '   the sub-role'
select test.login('tm_a');
select test.must_fail($$select set_sales_sub_role(test.id('tc_a'), 'TELECALLER')$$, 'a Sales member cannot set a sub-role', 'FORBIDDEN');
select test.login('th_wbx');
select test.must_fail($$select set_sales_sub_role(test.id('tc_a'), 'TELECALLER')$$, 'nor can the Team Lead of another team', 'FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select set_sales_sub_role(test.id('th_wab'), 'TELECALLER')$$, 'a Team Lead cannot give a Sales role to a Team Lead (not even themselves)', 'FORBIDDEN|Team Member');
select test.check((select set_sales_sub_role(test.id('tc_a'), 'TELECALLER') ->> 'defaultDashboard' = 'telecaller'), 'the Team Lead of the member''s own team can (the dashboard follows)');
select set_sales_sub_role(test.id('tc_a'), null);
select test.login('dh_wbx');
select test.must_fail($$select set_sales_sub_role(test.id('tc_a'), 'TELECALLER')$$, 'the Department Head of another department cannot', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select set_sales_sub_role(test.id('tc_a'), 'MANAGER')$$, 'only the five sub-roles exist', 'Choose');
select test.must_fail($$select set_sales_sub_role(test.id('th_wab'), 'TELECALLER')$$, 'a Team Lead cannot be a Telecaller', 'Team Member');
select test.check((set_sales_sub_role(test.id('tc_a'), 'TELECALLER') ->> 'defaultDashboard') = 'telecaller', 'a Department Head sets Telecaller: the dashboard becomes telecaller');
select set_sales_sub_role(test.id('tc_b'), 'TELECALLER');
select test.check((set_sales_sub_role(test.id('tc_v'), 'VISIT_SALES') ->> 'defaultDashboard') = 'sales-visit-sales', 'another sub-role gets its own dashboard value, never the Telecaller one');
select test.check((set_sales_sub_role(test.id('tc_v'), null) ->> 'defaultDashboard') = 'sales-member', 'clearing the sub-role restores the Sales member dashboard');
select test.login('sa');
select set_sales_sub_role(test.id('tc_x'), 'TELECALLER');
reset role;
select test.check((select department_id = test.dept('wabastore') and team_id = test.team('wabastore', 'Sales') and role = 'TEAM_MEMBER' from profiles where id = test.id('tc_a')),
  'the sub-role does not change the department or the team');
select test.check((select default_dashboard = 'sales-member' from profiles where id = test.id('tm_a')), 'other Sales members are unchanged');
select test.check((select default_dashboard = 'sales-lead' from profiles where id = test.id('th_wab')), 'so is the Team Lead');
select test.check((select count(*) >= 4 from audit_logs where action = 'SALES_SUB_ROLE_SET'), 'role changes are audited');
set role authenticated;

\echo '   access'
select test.login('tm_a');
select test.must_fail($$select telecaller_home()$$, 'a Sales member cannot open the Telecaller home', 'FORBIDDEN');
select test.must_fail($$select telecaller_leads_list()$$, 'nor the leads', 'FORBIDDEN');
select test.must_fail($$select telecaller_assignable()$$, 'nor assign sheets', 'FORBIDDEN');
select test.login('tc_a');
select test.must_fail($$select telecaller_assignable()$$, 'a Telecaller cannot assign sheets', 'FORBIDDEN');
select test.must_fail($$select telecaller_list_assign(test.id('tc_a'), 'x.xlsx', null, test.rowsjson(2, 'z'), 'abcdefabcdefabcdef', true)$$, 'nor assign one to themselves', 'FORBIDDEN');
select test.must_fail($$insert into telecaller_contacts (list_id, row_no, assigned_to, department_id, name, phone) values (gen_random_uuid(), 1, test.id('tc_a'), test.dept('wabastore'), 'X', '9800000000')$$, 'contacts cannot be written directly', 'permission denied');

\echo '   assigning a sheet'
select test.login('dh_wab');
select test.check(jsonb_array_length(telecaller_assignable()) = 2, 'the Department Head sees the two Telecallers of the department');
select test.check((select bool_and(x ->> 'departmentId' = test.dept('wabastore')::text) from jsonb_array_elements(telecaller_assignable()) x), 'and no other department''s');
select test.must_fail($$select telecaller_list_assign(test.id('tc_x'), 'x.xlsx', null, test.rowsjson(2, 'z'), 'abcdefabcdefabcdef', true)$$, 'a Telecaller of another department is refused', 'own department');
select test.must_fail($$select telecaller_list_assign(test.id('tm_a'), 'x.xlsx', null, test.rowsjson(2, 'z'), 'abcdefabcdefabcdef', true)$$, 'so is someone who is not a Telecaller', 'active Telecaller');
select test.must_fail($$select telecaller_list_assign(test.id('tc_a'), 'x.xlsx', null, '[]', 'abcdefabcdefabcdef', true)$$, 'an empty sheet is refused', 'no contact rows');
select test.must_fail($$select telecaller_list_assign(test.id('tc_a'), 'x.xlsx', null, test.rowsjson(2, 'z'), 'short', true)$$, 'a sheet needs an identity', 'identified');
-- problems are reported, preview works, nothing is saved
select test.check((select (j -> 'summary' ->> 'invalid')::int = 4 and (j -> 'summary' ->> 'valid')::int = 2 and j ->> 'committed' = 'false' and jsonb_array_length(j -> 'preview') = 2
                          and (j -> 'errors' -> 0 ->> 'row') = '4'
                     from (select telecaller_list_assign(test.id('tc_a'), 'bad.xlsx', null, jsonb_build_array(
                       jsonb_build_object('row', 2, 'name', 'Ok One', 'phone', '9811111111'),
                       jsonb_build_object('row', 3, 'name', 'Ok Two', 'phone', '98 1111-2222', 'email', 'a@b.co'),
                       jsonb_build_object('row', 4, 'name', '', 'phone', '9811111113'),
                       jsonb_build_object('row', 5, 'name', 'Bad Phone', 'phone', 'abc'),
                       jsonb_build_object('row', 6, 'name', 'Bad Mail', 'phone', '9811111115', 'email', 'nope'),
                       jsonb_build_object('row', 7, 'name', 'Dup', 'phone', '9811111111')), 'badbadbadbadbadbad', false) j) q),
  'preview lists every problem row and the valid rows; nothing is committed');
select test.check((telecaller_list_assign(test.id('tc_a'), 'bad.xlsx', null, jsonb_build_array(jsonb_build_object('row', 2, 'name', '', 'phone', '1')), 'badbadbadbadbadbad', true) ->> 'committed') = 'false', 'a sheet with problems is not saved even when confirmed');
reset role;
select test.check((select count(*) = 0 from telecaller_contact_lists), 'no sheet exists yet');
set role authenticated;
select test.login('dh_wab');
select test.check((telecaller_list_assign(test.id('tc_a'), 'leads-oct.xlsx', 'October cold calls', test.rowsjson(45, 'a'), 'hash-aaaaaaaaaaaaaaaa', true) ->> 'committed') = 'true', 'a good sheet is assigned to Tele A');
select test.must_fail($$select telecaller_list_assign(test.id('tc_a'), 'leads-oct.xlsx', null, test.rowsjson(45, 'a'), 'hash-aaaaaaaaaaaaaaaa', true)$$, 'the same sheet is not assigned twice to one person', 'already been assigned');
select test.check((telecaller_list_assign(test.id('tc_b'), 'leads-oct.xlsx', null, test.rowsjson(3, 'b'), 'hash-aaaaaaaaaaaaaaaa', true) ->> 'committed') = 'true', 'it may go to another Telecaller');
select test.check((select (x ->> 'total')::int = 45 and (x ->> 'pending')::int = 45 and x ->> 'assignedBy' = 'DH Wabastore' and x ->> 'assignedTo' = 'Tele A' and x ->> 'note' = 'October cold calls'
                     from jsonb_array_elements(telecaller_lists()) x where x ->> 'assigneeId' = test.id('tc_a')::text),
  'the sheet shows its name, who assigned it, totals and pending');
reset role;
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tc_a') and type = 'CONTACT_SHEET_ASSIGNED'), 'the Telecaller is notified');
set role authenticated;
select test.login('dh_wab');
select test.login('sa');
select test.check(jsonb_array_length(telecaller_lists()) = 2, 'the Super Admin sees every sheet');
select test.login('dh_wbx');
select test.check(jsonb_array_length(telecaller_lists()) = 0, 'another department''s head sees none');
select test.login('tm_a');
select test.must_fail($$select telecaller_lists()$$, 'a Sales member cannot list sheets', 'FORBIDDEN');

\echo '   the Telecaller works the sheet'
select test.login('tc_a');
select test.check((telecaller_contacts_list(null, null, null, 1, 20) ->> 'total')::int = 45, 'Tele A sees only their own 45 contacts');
select test.check(jsonb_array_length(telecaller_contacts_list(null, null, null, 1, 20) -> 'items') = 20, 'a page holds 20');
select test.check(jsonb_array_length(telecaller_contacts_list(null, null, null, 3, 20) -> 'items') = 5, 'the last page holds the rest');
select test.check((telecaller_contacts_list(null, 'person a7', null, 1, 20) ->> 'total')::int = 1, 'search finds a contact by name');
select test.check((telecaller_contacts_list(null, '9800000012', null, 1, 20) ->> 'total')::int = 1, 'and by phone');
select test.must_fail($$select telecaller_contacts_list(null, null, 'WEIRD', 1, 20)$$, 'an unknown filter is refused', 'Unknown');
select test.login('tc_b');
select test.check((telecaller_contacts_list(null, null, null, 1, 20) ->> 'total')::int = 3, 'Tele B sees only their own 3');
select test.login('tc_a');
create temp table t_ids as select (x ->> 'id')::uuid id, row_number() over () n from jsonb_array_elements(telecaller_contacts_list(null, null, null, 1, 20) -> 'items') x;
grant select on t_ids to authenticated;
select test.check((telecaller_contact_update((select id from t_ids where n = 1), 'CONTACTED', 'Asked to call back', null, true) ->> 'callCount') = '1', 'a call is recorded: status, remarks, count');
select test.check((select last_called_at is not null from telecaller_contacts where id = (select id from t_ids where n = 1)), 'and the time of the call');
select test.check((telecaller_contact_update((select id from t_ids where n = 2), 'FOLLOW_UP_REQUIRED', 'Busy', ((now() at time zone 'Asia/Kolkata')::date + 1), true) ->> 'followUpDate') = ((now() at time zone 'Asia/Kolkata')::date + 1)::text, 'a follow-up date is saved');
select test.must_fail($$select telecaller_contact_update((select id from t_ids where n = 3), 'FOLLOW_UP_REQUIRED', null, null, true)$$, 'a follow-up needs a date', 'follow-up date');
select test.must_fail($$select telecaller_contact_update((select id from t_ids where n = 3), 'DONE', null, null, true)$$, 'an unknown status is refused', 'call status');
select test.must_fail($$select telecaller_contact_update((select id from t_ids where n = 3), 'CONTACTED', repeat('x', 1001), null, true)$$, 'remarks are limited', 'too long');
select test.check((telecaller_contact_update((select id from t_ids where n = 4), 'INTERESTED', 'Wants a demo', (now() at time zone 'Asia/Kolkata')::date, true) ->> 'callStatus') = 'INTERESTED', 'Interested');
select telecaller_contact_update((select id from t_ids where n = 5), 'NOT_INTERESTED', null, (now() at time zone 'Asia/Kolkata')::date + 3, true);
select test.check((select follow_up_date is null from telecaller_contacts where id = (select id from t_ids where n = 5)), 'a Not interested contact has no follow-up');
select telecaller_contact_update((select id from t_ids where n = 6), 'COMPLETED', 'Done', null, true);
select test.check((telecaller_contacts_list(null, null, 'PENDING', 1, 50) ->> 'total')::int = 40, 'the Pending filter counts the rest');
select test.check((telecaller_contacts_list(null, null, 'FOLLOW_UP_REQUIRED', 1, 50) ->> 'total')::int = 1, 'the Follow-up filter works');
select test.check((telecaller_contacts_list(null, null, null, 1, 5) -> 'counts' ->> 'PENDING')::int = 40, 'counts per status come with the page');
select test.login('tc_b');
select test.must_fail($$select telecaller_contact_update((select id from t_ids where n = 7), 'CONTACTED', 'hijack', null, true)$$, 'another Telecaller cannot update my contact', 'not found');
select test.check((select count(*) = 0 from telecaller_contacts where assigned_to = test.id('tc_a')), 'nor read them through the table');
select test.login('dh_wab');
select test.must_fail($$select telecaller_contact_update((select id from t_ids where n = 7), 'CONTACTED', 'boss', null, true)$$, 'the Department Head reads sheets but does not record calls', 'FORBIDDEN');
select test.check((select count(*) = 48 from telecaller_contacts), 'the Department Head can read the department''s contacts');
select test.login('tc_x');
select test.check((select count(*) = 0 from telecaller_contacts), 'a Telecaller of another department sees nothing of it');

\echo '   leads'
select test.login('tc_a');
select test.must_fail($$select telecaller_lead_save(null, jsonb_build_object('name','L','company','C','phone','9822222222','leadSource','Cold Call'), array[test.svc()], 'LUKEWARM', 'PENDING')$$, 'the temperature is Hot, Warm or Cold', 'temperature');
select test.must_fail($$select telecaller_lead_save(null, jsonb_build_object('name','L','company','C','phone','9822222222','leadSource','Cold Call'), array[test.svc()], 'HOT', 'DONE')$$, 'the call status is checked', 'call status');
select test.must_fail($$select telecaller_lead_save(null, jsonb_build_object('name','L','company','C','phone','9822222222','leadSource','Cold Call'), array[]::text[], 'HOT', 'PENDING')$$, 'a service is required', 'service');
select test.check((telecaller_lead_save(null, jsonb_build_object('name','Hot Customer','company','Hot Co','phone','9822222221','email','hot@example.com','address','1 Main St','leadSource','Cold Call','notes','Keen'),
                   array[test.svc()], 'HOT', 'INTERESTED') ->> 'leadTemperature') = 'HOT', 'a Hot lead is created');
select telecaller_lead_save(null, jsonb_build_object('name','Warm Customer','company','Warm Co','phone','9822222222','leadSource','Referral','nextFollowUpAt', to_char((now() at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD') || 'T10:00:00+05:30'), array[test.svc()], 'WARM', 'FOLLOW_UP_REQUIRED');
select telecaller_lead_save(null, jsonb_build_object('name','Cold Customer','company','Cold Co','phone','9822222223','leadSource','Cold Call'), array[test.svc()], 'COLD', 'PENDING');
reset role;
select test.check((select count(*) = 3 and bool_and(owner_id = test.id('tc_a')) and bool_and(lifecycle_stage = 'LEAD') from customers where company in ('Hot Co', 'Warm Co', 'Cold Co')),
  'they are ordinary Sales leads owned by the Telecaller');
select test.check((select lead_temperature = 'HOT' and call_status = 'INTERESTED' from customers where company = 'Hot Co'), 'temperature and call status are separate columns');
set role authenticated;
select test.login('tc_a');
select test.check((telecaller_leads_list(null, null, null, null, 1, 20) ->> 'total')::int = 3, 'the list shows the three leads');
select test.check((telecaller_leads_list(null, 'HOT', null, null, 1, 20) ->> 'total')::int = 1, 'filter by temperature');
select test.check((telecaller_leads_list(null, null, 'PENDING', null, 1, 20) ->> 'total')::int = 1, 'filter by call status');
select test.check((telecaller_leads_list(null, null, null, 'Cold Call', 1, 20) ->> 'total')::int = 2, 'filter by source');
select test.check((telecaller_leads_list('warm co', null, null, null, 1, 20) ->> 'total')::int = 1, 'search by company');
select test.check((telecaller_leads_list(null, null, null, null, 1, 2) -> 'items' -> 0 ->> 'name') = 'Cold Customer', 'newest first');
select test.check(jsonb_array_length(telecaller_leads_list(null, null, null, null, 2, 2) -> 'items') = 1, 'pagination');
create temp table t_lead as select (x ->> 'id')::uuid id from jsonb_array_elements(telecaller_leads_list(null, 'COLD', null, null, 1, 5) -> 'items') x;
grant select on t_lead to authenticated;
select test.check((telecaller_lead_save((select id from t_lead), jsonb_build_object('phone', '9822222299'), null, 'HOT', 'CONTACTED') ->> 'leadTemperature') = 'HOT', 'a lead can be edited: Cold becomes Hot');
select test.check((telecaller_lead_get((select id from t_lead)) ->> 'phone') = '9822222299' and (telecaller_lead_get((select id from t_lead)) ->> 'callStatus') = 'CONTACTED', 'and the edit is saved');
select test.check(jsonb_array_length(telecaller_lead_get((select id from t_lead)) -> 'services') = 1, 'with its service kept');
select test.login('tc_b');
select test.must_fail($$select telecaller_lead_get((select id from t_lead))$$, 'another Telecaller cannot open the lead', 'not found');
select test.must_fail($$select telecaller_lead_save((select id from t_lead), '{"name":"Stolen"}'::jsonb, null, 'COLD', 'PENDING')$$, 'nor edit it', 'not found');
select test.check((telecaller_leads_list(null, null, null, null, 1, 20) ->> 'total')::int = 0, 'and sees none in the list');

\echo '   home counts'
select test.login('tc_a');
select test.check((select (h ->> 'totalAssigned')::int = 45 and (h ->> 'callsPending')::int = 40 and (h ->> 'callsCompleted')::int = 5 and (h ->> 'totalLeads')::int = 3 and (h ->> 'hotLeads')::int = 2
                     from (select telecaller_home() h) q), 'the counts come from the data');
select test.check((telecaller_home() ->> 'followUpsDueToday')::int = 2, 'follow-ups due today: one contact (Interested today) + the Warm lead');
select test.check((telecaller_home() ->> 'followUpsDueToday')::int = (select count(*) from jsonb_array_elements(telecaller_home() -> 'focus' -> 'followUps') f where f ->> 'date' = (now() at time zone 'Asia/Kolkata')::date::text), 'and today''s focus lists them');
select test.check(jsonb_array_length(telecaller_home() -> 'focus' -> 'pendingCalls') = 6, 'the focus lists the next pending calls');
select test.login('tc_b');
select test.check((telecaller_home() ->> 'totalAssigned')::int = 3 and (telecaller_home() ->> 'totalLeads')::int = 0, 'another Telecaller has their own counts');

\echo '   the original file'
select test.login('dh_wab');
select test.check((telecaller_list_source_begin((select id from telecaller_contact_lists where assigned_to = test.id('tc_a'))) ->> 'fileName') = 'leads-oct.xlsx', 'the assigner may attach the original file');
select test.login('dh_wbx');
select test.must_fail($$select telecaller_list_source_begin((select id from telecaller_contact_lists where assigned_to = test.id('tc_a')))$$, 'nobody else can', 'not found|invalid|violates');
select test.login('tc_a');
select test.must_fail($$select telecaller_list_source_begin(gen_random_uuid())$$, 'a Telecaller cannot', 'FORBIDDEN');
select test.must_fail($$select telecaller_list_record_source(gen_random_uuid(), 'b', 'p', 'r2', 'ref', null, 1)$$, 'recording the stored file is for the server only', 'permission denied');
reset role;
