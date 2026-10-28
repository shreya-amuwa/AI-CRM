-- =============================================================================
-- Field Visit for Sales (migration 20261130000100): Department Head assignments, scheduling, check-in with an optional location, outcomes, the per-lead
-- visit history, the overview filters and who may do what. Runs after the Sales Department Head suite (uses its Sales head, Telecaller and Business Associate).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- field visit'
reset role;
create or replace function test.fv_id(p_name text) returns uuid language sql stable security definer set search_path = '' as $$ select id from public.customers where name = p_name $$;
create or replace function test.today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
select test.create_auth_user('fv_inf', 'fv.inf@amuwa.com', '{"full_name":"FV Influencer"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
update profiles set sales_sub_role = 'INFLUENCER' where id = test.id('fv_inf');
grant execute on function test.fv_id(text), test.today() to authenticated;
set role authenticated;

\echo '   fixtures'
select test.login('sh_ba');
select ba_lead_save(null, jsonb_build_object('name','FV Bravo','company','FV Bravo Co','phone','9811400001','leadSource','Walk-in','address','12 MG Road, Pune'), test.svcs(1), 'HOT', 'INTERESTED');
select test.login('sh_tc');
select telecaller_lead_save(null, jsonb_build_object('name','FV Tango','company','FV Tango Co','phone','9811400002','leadSource','Referral'), test.svcs(1), 'WARM', 'CONTACTED');
select test.login('ba_x');
select ba_lead_save(null, jsonb_build_object('name','FV Elsewhere','company','FV Else Co','phone','9811400003','leadSource','Walk-in'), test.svcs(1), 'HOT', 'INTERESTED');

\echo '   who may use it'
select test.login('fv_inf');
select test.must_fail($$select field_visit_overview()$$, 'a Sales member with another Sales role (Influencer) is refused', 'FORBIDDEN');
select test.login('sup_plain');
select test.must_fail($$select field_visit_overview()$$, 'a Support member is refused', 'FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select field_visit_list()$$, 'a Team Lead is refused', 'FORBIDDEN');
select test.login('sh_head');
select test.must_fail($$select field_visit_overview()$$, 'the Sales Department Head uses their own dashboard: the employee pages refuse them', 'FORBIDDEN');
select test.login('tm_a');
select test.check((field_visit_overview() ->> 'myLeads')::int >= 0, 'a Sales member without a Sales role (works as a Business Associate) may use Field Visit');
select test.login('sh_ba');
select test.must_fail($$select field_visit_leads_list('EVERYTHING')$$, 'an unknown filter is refused', 'Unknown filter');
select test.must_fail($$select sales_visit_assign(test.fv_id('FV Bravo'), test.id('sh_ba'), 'HIGH', null)$$, 'an employee cannot assign leads', 'Sales Department Head');

\echo '   the Department Head assigns a lead for a visit'
select test.login('sh_head');
select test.check((select count(*) = 3 from jsonb_array_elements(sales_visit_assignees()) x where x ->> 'id' in (test.id('sh_tc')::text, test.id('sh_ba')::text, test.id('tm_a')::text)), 'the head can choose a Telecaller, a Business Associate or a Sales member of the department');
select test.check((select count(*) = 0 from jsonb_array_elements(sales_visit_assignees()) x where x ->> 'id' in (test.id('ba_x')::text, test.id('sup_plain')::text, test.id('fv_inf')::text, test.id('th_wab')::text)), 'and nobody from another department, Support, another Sales role or a Team Lead');
select test.must_fail($$select sales_visit_assign(test.fv_id('FV Tango'), test.id('ba_x'), 'HIGH', null)$$, 'a person of another department is refused', 'Choose an active');
select test.must_fail($$select sales_visit_assign(test.fv_id('FV Tango'), test.id('sup_plain'), 'HIGH', null)$$, 'so is a Support member', 'Choose an active');
select test.must_fail($$select sales_visit_assign(test.fv_id('FV Tango'), test.id('sh_ba'), 'SOON', null)$$, 'an unknown priority is refused', 'priority');
select test.must_fail($$select sales_visit_assign(test.fv_id('FV Elsewhere'), test.id('sh_ba'), 'HIGH', null)$$, 'a lead of another department is not found', 'not found');
select test.login('dh_wab');
select test.must_fail($$select sales_visit_assign(test.fv_id('FV Tango'), test.id('sh_ba'), 'HIGH', null)$$, 'the Support head cannot assign', 'Sales Department Head');
select test.login('sh_head');
select test.check((sales_visit_assign(test.fv_id('FV Tango'), test.id('sh_ba'), 'HIGH', 'Visit the shop on Monday and bring the brochure') ->> 'assignee') = 'Sheet BA', 'the head assigns a lead of the department to a Business Associate');
reset role;
select test.check((select owner_id = test.id('sh_tc') from customers where name = 'FV Tango'), 'the lead keeps its owner: the assignment changes no ownership');
select test.check((select payment_workflow = 'NONE' from customers where name = 'FV Tango'), 'and nothing in the Accounts workflow');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('sh_ba') and type = 'FIELD_VISIT_ASSIGNED'), 'the employee is notified');
set role authenticated;

\echo '   the employee sees it'
select test.login('sh_ba');
select test.check((select x ->> 'name' = 'FV Tango' and x ->> 'priority' = 'HIGH' and x ->> 'assignedBy' = 'Sales Head' and x ->> 'instructions' like 'Visit the shop%' and x ->> 'assignedAt' is not null and x ->> 'department' is not null
                          and (x ->> 'canVisit')::boolean and not (x ->> 'isMine')::boolean and x -> 'owner' ->> 'fullName' = 'Sheet Telecaller'
                     from jsonb_array_elements(field_visit_assigned_list() -> 'items') x), 'Department Head assigned leads show the lead, date, assigned by, priority, department and instructions');
select test.check((field_visit_overview() ->> 'totalAssigned')::int = 1 and (field_visit_overview() ->> 'pending')::int = 1, 'the cards count it: one assigned, one pending');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_leads_list('DH_ASSIGNED') -> 'items') x where x ->> 'name' = 'FV Tango' and x -> 'assignment' ->> 'priority' = 'HIGH' and x ->> 'visitStatus' = 'NOT_PLANNED'), 'the overview table lists it under Department Head Assigned, with no visit planned yet');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_leads_list('VISIT_PENDING') -> 'items') x where x ->> 'name' = 'FV Tango'), 'and under Field Visit Pending');
select test.must_fail($$update lead_visit_assignments set priority = 'LOW'$$, 'the employee cannot change the assignment', 'permission denied');
select test.must_fail($$insert into lead_visit_assignments (lead_id, department_id, assigned_to, assigned_by) values (test.fv_id('FV Bravo'), test.dept('wabastore'), test.id('sh_ba'), test.id('sh_ba'))$$, 'nor create one', 'permission denied');
select test.login('sh_tc');
select test.check((select count(*) = 0 from jsonb_array_elements(field_visit_assigned_list() -> 'items')), 'the owner of the lead is not the assignee: their list of assigned leads is empty');
select test.check((select count(*) = 0 from lead_visit_assignments), 'and they cannot read another person''s assignment');

\echo '   scheduling a visit'
select test.login('sh_ba');
select test.must_fail($$select field_visit_schedule(test.fv_id('FV Tango'), test.today() - 1, '10:00', 'Shop', 'Demo', null, gen_random_uuid())$$, 'a visit in the past is refused', 'past');
select test.must_fail($$select field_visit_schedule(test.fv_id('FV Tango'), test.today(), '10:00', 'Shop', '  ', null, gen_random_uuid())$$, 'a visit needs a purpose', 'purpose');
select test.must_fail($$select field_visit_schedule(test.fv_id('FV Elsewhere'), test.today(), '10:00', 'Shop', 'Demo', null, gen_random_uuid())$$, 'a lead of another department is not found', 'not found');
select test.login('tm_a');
select ba_lead_save(null, jsonb_build_object('name','FV Mike','company','FV Mike Co','phone','9811400004','leadSource','Walk-in'), test.svcs(1), 'COLD', 'PENDING');
select test.login('sh_ba');
select test.must_fail($$select field_visit_schedule(test.fv_id('FV Mike'), test.today(), '10:00', 'Shop', 'Demo', null, gen_random_uuid())$$, 'a colleague''s lead (not assigned to me) cannot be scheduled', 'not found');
create temp table fv (name text primary key, id uuid, req uuid);
grant all on fv to authenticated;
insert into fv values ('tango1', null, gen_random_uuid());
update fv set id = (field_visit_schedule(test.fv_id('FV Tango'), test.today(), '10:30', 'Shop 4, MG Road', 'Product demo', 'Bring the brochure', (select req from fv where name = 'tango1')) ->> 'id')::uuid where name = 'tango1';
select test.check((select id is not null from fv where name = 'tango1'), 'the assigned lead is scheduled for a visit');
select test.check((field_visit_schedule(test.fv_id('FV Tango'), test.today(), '10:30', 'Shop 4, MG Road', 'Product demo', 'Bring the brochure', (select req from fv where name = 'tango1')) ->> 'id')::uuid = (select id from fv where name = 'tango1'), 'the same request again returns the same visit (a retry or a double click)');
reset role;
select test.check((select count(*) = 1 from lead_visits where lead_id = test.fv_id('FV Tango')), 'and only one record exists');
select test.check((select status = 'SCHEDULED' and employee_id = test.id('sh_ba') and assigned_by = test.id('sh_head') and assignment_id is not null and not gps_captured and checkin_lat is null from lead_visits where lead_id = test.fv_id('FV Tango')), 'it is Scheduled, belongs to the employee, carries the Department Head who gave it, and has no location');
set role authenticated;
select test.login('sh_ba');
select test.check((field_visit_overview() ->> 'pending')::int = 0 and (field_visit_overview() ->> 'todayScheduled')::int = 1, 'it leaves Pending and counts as today''s scheduled visit');
select test.check((select x ->> 'visitStatus' = 'SCHEDULED' and x ->> 'visitDate' = test.today()::text and x ->> 'plannedTime' = '10:30' from jsonb_array_elements(field_visit_leads_list('VISIT_SCHEDULED') -> 'items') x where x ->> 'name' = 'FV Tango'), 'the overview shows it under Visit Scheduled with its date and time');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_list('OPEN') -> 'items') x where x ->> 'purpose' = 'Product demo' and x ->> 'assignedBy' = 'Sales Head'), 'My Field Visits lists it');
select test.check((jsonb_array_length(field_visit_list('HISTORY') -> 'items') = 0), 'and the history does not yet');
select field_visit_update((select id from fv where name = 'tango1'), test.today() + 1, '11:00', 'Shop 4, MG Road', 'Product demo and price talk', 'Bring the brochure');
select test.check((select x ->> 'plannedTime' = '11:00' and x ->> 'visitDate' = (test.today() + 1)::text from jsonb_array_elements(field_visit_list('OPEN') -> 'items') x), 'a scheduled visit can be rescheduled');

\echo '   check-in with and without a location'
select test.must_fail($$select field_visit_start((select id from fv where name = 'tango1'), 95, 10, 5)$$, 'a location that is not valid is refused', 'not valid');
select test.check((field_visit_start((select id from fv where name = 'tango1'), 18.520430, 73.856743, 12) ->> 'gpsCaptured')::boolean, 'a visit started with the device''s position records that it was captured');
select test.check((field_visit_start((select id from fv where name = 'tango1'), 1, 1, 1) ->> 'status') = 'IN_PROGRESS', 'starting twice changes nothing');
select test.check((select (x ->> 'checkinLat')::numeric = 18.520430 and (x ->> 'checkinAccuracyM')::int = 12 from jsonb_array_elements(field_visit_list('OPEN') -> 'items') x), 'the first position is the one kept');
select test.must_fail($$select field_visit_update((select id from fv where name = 'tango1'), test.today() + 2, '12:00', 'x', 'y', null)$$, 'a started visit cannot be rescheduled', 'scheduled visit can be changed');
select test.check((field_visit_leads_list('VISIT_SCHEDULED') -> 'items' -> 0 ->> 'visitStatus') = 'IN_PROGRESS', 'the overview shows it In Progress');

\echo '   recording the outcome keeps every visit'
select test.must_fail($$select field_visit_complete((select id from fv where name = 'tango1'), 'FOLLOW_UP_REQUIRED', 'Met the owner', null, null, null, null)$$, 'Follow-up Required needs a follow-up date', 'follow-up date');
select test.must_fail($$select field_visit_complete((select id from fv where name = 'tango1'), 'COMPLETED', '', null, null, null, null)$$, 'an outcome is required', 'outcome');
select test.must_fail($$select field_visit_complete((select id from fv where name = 'tango1'), 'COMPLETED', 'Met', null, null, null, test.today() - 1)$$, 'a follow-up date in the past is refused', 'past');
select test.check((field_visit_complete((select id from fv where name = 'tango1'), 'FOLLOW_UP_REQUIRED', 'Met the owner, he wants a quotation', 'Liked the demo', 'WhatsApp API and AI QR menu', 'Send the quotation', test.today() + 5) ->> 'status') = 'FOLLOW_UP_REQUIRED', 'the visit is recorded with its outcome and a follow-up');
select test.check((field_visit_complete((select id from fv where name = 'tango1'), 'COMPLETED', 'again', null, null, null, null) ->> 'status') = 'FOLLOW_UP_REQUIRED', 'completing again changes nothing');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_leads_list('FOLLOW_UP') -> 'items') x where x ->> 'name' = 'FV Tango' and x ->> 'nextFollowUp' = (test.today() + 5)::text and x ->> 'lastVisit' is not null), 'the lead is under Follow-up Required, with its last visit and next follow-up');
select test.check((field_visit_overview() ->> 'followUps')::int = 1 and (field_visit_overview() ->> 'todayScheduled')::int = 0 and (field_visit_overview() ->> 'completed')::int = 0, 'the cards follow: one follow-up, none scheduled today, none completed');
reset role;
select test.check((select next_follow_up_at is null from customers where name = 'FV Tango'), 'an assigned lead keeps its owner''s own plan (the follow-up date is not written to it)');
set role authenticated;
select test.login('sh_ba');
insert into fv values ('tango2', null, gen_random_uuid());
update fv set id = (field_visit_schedule(test.fv_id('FV Tango'), test.today() + 6, '15:00', 'Shop 4, MG Road', 'Quotation meeting', null, (select req from fv where name = 'tango2')) ->> 'id')::uuid where name = 'tango2';
select field_visit_start((select id from fv where name = 'tango2'));
select test.check((select not (x ->> 'gpsCaptured')::boolean from jsonb_array_elements(field_visit_list('OPEN') -> 'items') x where x ->> 'id' = (select id::text from fv where name = 'tango2')), 'a visit started without a location is NOT marked as captured');
select test.check((field_visit_complete((select id from fv where name = 'tango2'), 'COMPLETED', 'Quotation accepted', null, null, null, null) ->> 'status') = 'COMPLETED', 'the second visit is completed');
select test.check((jsonb_array_length(field_visit_list('HISTORY', null, test.fv_id('FV Tango')) -> 'items') = 2), 'the lead''s visit history holds both visits');
select test.check((select count(distinct x ->> 'id') = 2 and bool_or(x ->> 'outcome' like 'Met the owner%') and bool_or(x ->> 'outcome' = 'Quotation accepted') from jsonb_array_elements(field_visit_list('HISTORY', null, test.fv_id('FV Tango')) -> 'items') x), 'each keeps its own outcome');
select test.check((field_visit_overview() ->> 'completed')::int = 1, 'Completed Field Visits counts the completed one');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_leads_list('VISIT_COMPLETED') -> 'items') x where x ->> 'name' = 'FV Tango'), 'the lead is under Visit Completed');
select test.check((select count(*) = 0 from jsonb_array_elements(field_visit_leads_list('FOLLOW_UP') -> 'items') x where x ->> 'name' = 'FV Tango'), 'and its latest visit no longer asks for a follow-up');

\echo '   cancelling'
insert into fv values ('tango3', null, gen_random_uuid());
update fv set id = (field_visit_schedule(test.fv_id('FV Tango'), test.today() + 9, null, null, 'Another look', null, (select req from fv where name = 'tango3')) ->> 'id')::uuid where name = 'tango3';
select test.check((field_visit_cancel((select id from fv where name = 'tango3'), 'Customer travelling') ->> 'status') = 'CANCELLED', 'a scheduled visit can be cancelled');
select test.must_fail($$select field_visit_cancel((select id from fv where name = 'tango1'))$$, 'a finished visit cannot be cancelled', 'finished visit');
select test.check((jsonb_array_length(field_visit_list('HISTORY', null, test.fv_id('FV Tango')) -> 'items') = 3), 'the cancelled visit stays in the history');

\echo '   other people'
select test.login('sh_tc');
select test.check((jsonb_array_length(field_visit_list('ALL') -> 'items') = 0), 'the owner of the lead has no visits of their own');
select test.check((jsonb_array_length(field_visit_list('HISTORY', null, test.fv_id('FV Tango')) -> 'items') = 3), 'but sees every visit made on their own lead');
select test.must_fail($$select field_visit_start((select id from fv where name = 'tango2'))$$, 'they cannot start or change another person''s visit', 'not found');
select test.must_fail($$select field_visit_cancel((select id from fv where name = 'tango1'))$$, 'nor cancel it', 'not found');
select test.check((select count(*) = 0 from lead_visits), 'and the table itself shows them none of them (only their own and their reports'' rows)');
select test.login('ba_x');
select test.check((select count(*) = 0 from jsonb_array_elements(field_visit_leads_list('ALL', 'FV') -> 'items') x where x ->> 'name' in ('FV Tango', 'FV Bravo', 'FV Mike')), 'another department sees none of these leads');
select test.must_fail($$select field_visit_schedule(test.fv_id('FV Tango'), test.today(), null, null, 'x', null, gen_random_uuid())$$, 'nor can it schedule a visit on them', 'not found');

\echo '   reassigning and cancelling an assignment'
select test.login('sh_head');
select test.check((sales_visit_assign(test.fv_id('FV Tango'), test.id('sh_tc'), 'URGENT', 'Second round') ->> 'reassigned')::boolean, 'the head reassigns the lead');
select test.login('sh_ba');
select test.check((field_visit_overview() ->> 'totalAssigned')::int = 0, 'the first employee no longer has it');
select test.check((jsonb_array_length(field_visit_list('HISTORY', null, test.fv_id('FV Tango')) -> 'items') = 3), 'but their visits are kept');
select test.must_fail($$select field_visit_schedule(test.fv_id('FV Tango'), test.today(), null, null, 'again', null, gen_random_uuid())$$, 'and they can no longer schedule a visit on it', 'not found');
select test.login('sh_tc');
select test.check((select x ->> 'priority' = 'URGENT' from jsonb_array_elements(field_visit_assigned_list() -> 'items') x), 'the new assignee sees it with the new priority');
select test.login('sh_head');
select sales_visit_assignment_cancel(test.fv_id('FV Tango'));
select test.must_fail($$select sales_visit_assignment_cancel(test.fv_id('FV Tango'))$$, 'cancelling twice is refused', 'no field visit assignment');
reset role;
select test.check((select count(*) = 1 from lead_visit_assignments where lead_id = test.fv_id('FV Tango') and status = 'REASSIGNED')
               and (select count(*) = 1 from lead_visit_assignments where lead_id = test.fv_id('FV Tango') and status = 'CANCELLED'), 'the assignments keep their history');
set role authenticated;

\echo '   my own lead, and the Accounts workflow'
select test.login('sh_ba');
select test.check((select (x ->> 'canVisit')::boolean from jsonb_array_elements(field_visit_leads_list('MINE', 'FV Bravo') -> 'items') x), 'my own lead can be visited');
select field_visit_schedule(test.fv_id('FV Bravo'), test.today(), '09:00', '12 MG Road, Pune', 'First meeting', null, gen_random_uuid());
select field_visit_start((select (x ->> 'id')::uuid from jsonb_array_elements(field_visit_list('OPEN', null, test.fv_id('FV Bravo')) -> 'items') x limit 1), 18.5, 73.8, 20);
select field_visit_complete((select (x ->> 'id')::uuid from jsonb_array_elements(field_visit_list('OPEN', 'IN_PROGRESS', test.fv_id('FV Bravo')) -> 'items') x limit 1), 'FOLLOW_UP_REQUIRED', 'Wants the price list', null, null, 'Send prices', test.today() + 3);
reset role;
select test.check((select (next_follow_up_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date + 3 from customers where name = 'FV Bravo'), 'the follow-up of a visit on my own lead becomes the lead''s next follow-up');
set role authenticated;
select test.login('sh_ba');
select send_lead_to_accounts(test.fv_id('FV Bravo'), 7000, 'After the visit');
select test.check((select count(*) = 1 from jsonb_array_elements(field_visit_leads_list('TO_ACCOUNTS') -> 'items') x where x ->> 'name' = 'FV Bravo' and x ->> 'paymentWorkflow' = 'PENDING_PAYMENT_CONFIRMATION'), 'the lead goes to Accounts through the existing workflow and shows under To Accounts');
reset role;
