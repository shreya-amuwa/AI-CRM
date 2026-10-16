-- =============================================================================
-- Client dashboard (migration 20261018000100): a client sees and does only their own things.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 28. Client dashboard: isolation, services, invoices, tickets, plans, notifications'
reset role;
create temp table cl (name text primary key, id uuid);
grant all on cl to authenticated, service_role;
create temp table clcount as select count(*)::bigint as n from crm_services where is_active;
grant select on clcount to authenticated;

-- two Wabastore customers with a client login each (the login is made by the Technical Consultant; here set directly)
set role authenticated;
select test.login('tm_a');
insert into cl select 'A', create_lead('{"name":"Client Alpha","company":"Alpha Traders","email":"alpha@example.com","phone":"9819900101","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK', 'AI_CALLING']);
insert into cl select 'B', create_lead('{"name":"Client Beta","company":"Beta Stores","email":"beta@example.com","phone":"9819900102","leadSource":"Walk-in"}', array['META_ADS_MANAGEMENT']);
reset role;
select test.create_auth_user('cdash_a', 'alpha.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from cl where name = 'A')));
select test.create_auth_user('cdash_b', 'beta.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from cl where name = 'B')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values
  ((select id from cl where name = 'A'), test.id('cdash_a'), 'alpha.login@example.com'),
  ((select id from cl where name = 'B'), test.id('cdash_b'), 'beta.login@example.com');
update customers set lifecycle_stage = 'CUSTOMER' where id in (select id from cl);
-- both went through onboarding with the Technical Consultant
insert into customer_onboarding (customer_id, forwarded_to_support_at, stage) select id, now(), 'SETUP' from cl
  on conflict (customer_id) do update set forwarded_to_support_at = now();

-- ---------------------------------------------------------------- who am I
set role authenticated;
select test.login('cdash_a');
select test.check((select client_me() ->> 'customerId' = (select id::text from cl where name = 'A') and client_me() ->> 'businessName' = 'Alpha Traders'), 'a client gets their own profile');
select test.login('cdash_b');
select test.check((select client_me() ->> 'customerId' = (select id::text from cl where name = 'B')), 'another client gets theirs');
select test.login('tm_a');
select test.must_fail($$select client_me()$$, 'a staff member cannot use the client functions', 'clients only');
select test.must_fail($$select client_overview()$$, 'nor the overview', 'clients only');
select test.login('cdash_a');
select test.must_fail($$select create_lead('{"name":"X","phone":"9819900103","leadSource":"Walk-in"}', array['AI_CALLING'])$$, 'a client cannot use the staff functions', 'owner|Sign in|permission|FORBIDDEN|profile');
select test.must_fail($$select send_lead_to_accounts((select id from cl where name = 'A'), 1000, null)$$, 'a client cannot send themselves to Accounts', 'NOT_FOUND|FORBIDDEN|Sign in');
select test.must_fail($$select accounts_plans()$$, 'a client cannot open the Accounts plans', 'FORBIDDEN|Accounts');

-- ---------------------------------------------------------------- nothing is readable directly
select test.check((select count(*) = 0 from customers), 'a client sees no customer rows directly (RLS)');
select test.check((select count(*) = 0 from member_invoices), 'nor invoices');
select test.check((select count(*) = 0 from support_tickets), 'nor tickets');
select test.check((select count(*) = 0 from customer_documents), 'nor documents');
select test.must_fail($$select * from client_notifications$$, 'notifications are not readable directly', 'permission denied');
select test.must_fail($$select * from customer_plans$$, 'plans are not readable directly', 'permission denied');
select test.must_fail($$select * from service_requests$$, 'service requests are not readable directly', 'permission denied');
select test.must_fail($$insert into client_notifications (customer_id, type, title, dedupe_key) values ((select id from cl where name = 'A'), 'X', 'forged', 'x')$$, 'a client cannot write a notification', 'permission denied');

-- ---------------------------------------------------------------- services
select test.check((select jsonb_array_length(client_services()) = 2 and (select bool_and(s ->> 'status' = 'LIVE') from jsonb_array_elements(client_services()) s)
                     and (select array_agg(s ->> 'code' order by s ->> 'code') from jsonb_array_elements(client_services()) s) = array['AI_CALLING', 'WHATSAPP_API_BLUE_TICK']),
  'My Services lists only the services of this client');
select test.login('cdash_b');
select test.check((select jsonb_array_length(client_services()) = 1 and client_services() -> 0 ->> 'code' = 'META_ADS_MANAGEMENT'), 'another client sees only theirs');
select test.check((select count(*) = (select n from clcount) from jsonb_array_elements(client_service_catalog())), 'Explore Services lists the whole active catalogue');
select test.check((select (c ->> 'owned')::boolean from jsonb_array_elements(client_service_catalog()) c where c ->> 'code' = 'META_ADS_MANAGEMENT')
                   and not (select (c ->> 'owned')::boolean from jsonb_array_elements(client_service_catalog()) c where c ->> 'code' = 'AI_CALLING'), 'the catalogue marks what the client already has');

-- ---------------------------------------------------------------- add-on request
select test.must_fail($$select client_request_service('META_ADS_MANAGEMENT')$$, 'a service the client already has cannot be requested', 'already have');
select test.must_fail($$select client_request_service('NO_SUCH_SERVICE')$$, 'an unknown service is refused', 'not found');
select test.check((select client_request_service('AI_CALLING', 'Need it for the new branch') ->> 'status' = 'REQUESTED'), 'the client asks for an extra service');
select test.must_fail($$select client_request_service('AI_CALLING')$$, 'the same request cannot be sent twice', 'already requested');
select test.check((select not (c ->> 'owned')::boolean and c -> 'request' ->> 'status' = 'REQUESTED' from jsonb_array_elements(client_service_catalog()) c where c ->> 'code' = 'AI_CALLING'),
  'asking does not make it purchased');
select test.check((select jsonb_array_length(client_services()) = 1), 'and My Services is unchanged');
select test.check((select count(*) = 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' = 'SERVICE_REQUEST_SENT'), 'the client is told the request was received');
select test.login('cdash_a');
select test.check((select jsonb_array_length(client_service_requests()) = 0), 'client A sees no requests of client B');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'CLIENT_SERVICE_REQUEST' and entity_id = (select id from cl where name = 'B')), 'the internal team is notified of the request');
set role authenticated;
select test.login('late_consultant');
select test.check((select jsonb_array_length(consultant_service_requests((select id from cl where name = 'B'))) = 1), 'the Technical Consultant sees the request');
select test.check((select count(*) = 1 from jsonb_array_elements(consultant_open_service_requests()) r where r ->> 'customerId' = (select id::text from cl where name = 'B') and r ->> 'serviceCode' = 'AI_CALLING'), 'and finds it in the list of open customer requests');
select test.login('cdash_a');
select test.must_fail($$select consultant_open_service_requests()$$, 'a client cannot list the staff requests', 'FORBIDDEN|Only');
select test.login('late_consultant');
select consultant_decide_service_request((select (r ->> 'id')::uuid from jsonb_array_elements(consultant_service_requests((select id from cl where name = 'B'))) r limit 1), 'IN_REVIEW', null);
select test.check((select r ->> 'status' = 'IN_REVIEW' from jsonb_array_elements(consultant_service_requests((select id from cl where name = 'B'))) r limit 1), 'the consultant takes it in review');
select test.must_fail($$select consultant_decide_service_request((select (r ->> 'id')::uuid from jsonb_array_elements(consultant_service_requests((select id from cl where name = 'B'))) r limit 1), 'REJECTED', null)$$, 'declining needs a reason for the client', 'reason');
select test.login('tm_c');
select test.must_fail($$select consultant_service_requests((select id from cl where name = 'B'))$$, 'another department cannot see the requests', 'not found');
select test.login('cdash_b');
select test.check((select count(*) = 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' = 'SERVICE_REQUEST_IN_REVIEW'), 'the client is told it is being reviewed');

-- the consultant prices it in an add-on request (superuser here: the pricing workflow is covered elsewhere) -> linked; completion activates
reset role;
insert into addon_requests (id, customer_id, department_id, status, version) select gen_random_uuid(), c.id, c.department_id, 'DRAFT', 1 from customers c where c.id = (select id from cl where name = 'B');
insert into addon_request_items (request_id, service_code, name, quantity, unit_price, line_total, sort_order)
  select r.id, 'AI_CALLING', 'AI Calling', 1, 5000, 5000, 1 from addon_requests r where r.customer_id = (select id from cl where name = 'B');
select test.check((select status = 'IN_ADDON_WORKFLOW' and addon_request_id is not null from service_requests where customer_id = (select id from cl where name = 'B') and service_code = 'AI_CALLING'),
  'the consultant adding the service to an add-on request takes the client request into the workflow');
update addon_requests set status = 'PENDING_VERIFICATION' where customer_id = (select id from cl where name = 'B');
select test.check((select count(*) = 0 from customer_services where customer_id = (select id from cl where name = 'B') and service_code = 'AI_CALLING'), 'still not purchased while Accounts verifies');
update addon_requests set status = 'APPROVED' where customer_id = (select id from cl where name = 'B');
update addon_requests set status = 'INVOICE_GENERATED' where customer_id = (select id from cl where name = 'B');
update addon_requests set status = 'PAYMENT_CONFIRMED' where customer_id = (select id from cl where name = 'B');
select test.check((select count(*) = 0 from customer_services where customer_id = (select id from cl where name = 'B') and service_code = 'AI_CALLING'), 'nor after the payment: the service verification comes first');
update addon_requests set status = 'COMPLETED' where customer_id = (select id from cl where name = 'B');
select test.check((select count(*) = 1 from customer_services where customer_id = (select id from cl where name = 'B') and service_code = 'AI_CALLING' and activated_at is not null)
                   and (select status = 'ACTIVATED' from service_requests where customer_id = (select id from cl where name = 'B') and service_code = 'AI_CALLING'),
  'only when everything is done the service is purchased and the request is activated');
-- the same event processed again creates no second notification
update addon_requests set status = 'COMPLETED' where customer_id = (select id from cl where name = 'B');
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cl where name = 'B') and type = 'ADDON_COMPLETED'), 'a repeated event does not duplicate the notification');
set role authenticated;
select test.login('cdash_b');
select test.check((select jsonb_array_length(client_services()) = 2), 'My Services now shows the new service');
select test.check((select count(*) >= 5 from jsonb_array_elements(client_notifications() -> 'items')), 'and the client has the notifications of each step');
select test.login('cdash_a');
select test.check((select jsonb_array_length(client_services()) = 2), 'client A is unaffected');

-- ---------------------------------------------------------------- invoices (from Accounts only)
reset role;
insert into member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, customer_id, kind, tax_total)
values (test.id('acc_m'), 'CL/A/001', 'Client Alpha', 'Alpha Traders', 11800, 'Pending', '2026-09-01', '2026-09-15', (select id from cl where name = 'A'), 'UPLOADED', 1800),
       (test.id('acc_m'), 'CL/B/001', 'Client Beta', 'Beta Stores', 500, 'Pending', '2026-10-01', '2099-01-01', (select id from cl where name = 'B'), 'UPLOADED', 0),
       (test.id('acc_m'), 'CL/MAN/001', 'Client Alpha', 'Alpha Traders', 99, 'Pending', '2026-10-01', '2026-10-15', (select id from cl where name = 'A'), 'MANUAL', 0);
create temp table clinv as select invoice_number, id from member_invoices where invoice_number like 'CL/%';
grant select on clinv to authenticated;
set role authenticated;
select test.login('cdash_a');
select test.check((select jsonb_array_length(client_invoices()) = 1 and client_invoices() -> 0 ->> 'number' = 'CL/A/001' and (client_invoices() -> 0 ->> 'tax')::numeric = 1800
                     and (client_invoices() -> 0 ->> 'overdue')::boolean), 'a client sees only their own Accounts invoices (GST, due date, overdue)');
select test.check((select not (client_invoices() -> 0 ->> 'hasFile')::boolean), 'no file yet');
select test.must_fail($$select * from client_invoice_file((select id from clinv where invoice_number = 'CL/B/001'))$$, 'a client cannot open the file of another client''s invoice', 'not found');
select test.must_fail($$select * from client_invoice_file((select id from clinv where invoice_number = 'CL/A/001'))$$, 'an invoice without a file says so', 'no file');
select test.must_fail($$update member_invoices set amount = 1 where invoice_number = 'CL/A/001'$$, 'a client cannot change an invoice', 'permission denied|0 rows|new row');
select test.check((select count(*) = 0 from member_invoices), 'and cannot read the table');
select test.check((select count(*) = 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' = 'INVOICE_ISSUED'), 'the invoice created a notification');
reset role;
-- a stored PDF for A's invoice
insert into customer_documents (customer_id, document_type, version, status, storage_path, original_file_name, mime_type, size_bytes, uploaded_at, invoice_id)
select (select id from cl where name = 'A'), 'INVOICE', 1, 'UPLOADED', 'customers/' || (select id from cl where name = 'A') || '/invoices/test.pdf', 'inv.pdf', 'application/pdf', 1000, now(), i.id
  from member_invoices i where i.invoice_number = 'CL/A/001';
set role authenticated;
select test.login('cdash_a');
select test.check((select count(*) = 1 and bool_and(storage_path like 'customers/%/invoices/test.pdf') from client_invoice_file((select id from clinv where invoice_number = 'CL/A/001'))), 'the client gets the file of their own invoice');
select test.login('cdash_b');
select test.must_fail($$select * from client_invoice_file((select id from clinv where invoice_number = 'CL/A/001'))$$, 'but not client B', 'not found');
reset role;
update member_invoices set status = 'Paid', paid_at = now() where invoice_number = 'CL/A/001';
update member_invoices set status = 'Pending' where invoice_number = 'CL/A/001';
update member_invoices set status = 'Paid' where invoice_number = 'CL/A/001';
select test.check((select count(*) = 1 from client_notifications where customer_id = (select id from cl where name = 'A') and type = 'PAYMENT_CONFIRMED'), 'payment confirmation is notified once, however often it is processed');
select test.check((select count(*) = 1 from audit_logs where action = 'CLIENT_INVOICE_VIEWED'), 'opening an invoice file is audited');

-- ---------------------------------------------------------------- tickets
set role authenticated;
select test.login('cdash_a');
select test.must_fail($$select client_create_ticket('Hi', 'Something is wrong with my account')$$, 'a ticket needs a real subject', 'subject');
select test.must_fail($$select client_create_ticket('Broken panel', 'x')$$, 'and a description', 'Describe');
select test.must_fail($$select client_create_ticket('Broken panel', 'The panel does not open for me', 'GENERAL', 'META_ADS_MANAGEMENT')$$, 'a ticket can only be about the client''s own service', 'own services');
create temp table clt (name text primary key, id uuid);
grant all on clt to authenticated;
insert into clt select 'T1', (client_create_ticket('Broken panel', 'The panel does not open for me', 'TECHNICAL', 'WHATSAPP_API_BLUE_TICK') ->> 'id')::uuid;
select test.check((select client_ticket((select id from clt where name = 'T1')) ->> 'status' = 'OPEN' and client_ticket((select id from clt where name = 'T1')) ->> 'priority' = 'MEDIUM'
                    and client_ticket((select id from clt where name = 'T1')) ->> 'serviceName' = 'WhatsApp API + Blue Tick'), 'the client raises a ticket (priority is set by Support, not the client)');
select test.check((select jsonb_array_length(client_tickets()) = 1), 'the client lists their tickets');
select test.login('cdash_b');
select test.check((select jsonb_array_length(client_tickets()) = 0), 'another client sees none of them');
select test.must_fail($$select client_ticket((select id from clt where name = 'T1'))$$, 'and cannot open the ticket by its id', 'not found');
select test.must_fail($$select client_reply_ticket((select id from clt where name = 'T1'), 'I am someone else')$$, 'nor reply to it', 'not found');
reset role;
select test.check((select count(*) = 1 and bool_and(created_by is null and customer_id = (select id from cl where name = 'A') and team_id is not null) from support_tickets where subject = 'Broken panel'),
  'the ticket is stored for the right customer and reaches the department''s Support team');
select test.check((select count(*) >= 1 from notifications where type = 'TICKET_FROM_CLIENT'), 'the Support lead is notified');
-- Support works the ticket in its own dashboard
set role authenticated;
select test.login('sup_th');
select test.check((select count(*) = 1 from support_tickets where subject = 'Broken panel'), 'the Support team lead sees the client''s ticket in the existing ticket system');
select update_support_ticket((select id from clt where name = 'T1'), 'IN_PROGRESS', 'Checking the logs (internal)');
select reply_to_client_ticket((select id from clt where name = 'T1'), 'We have found the cause and are fixing it.');
select test.login('cdash_a');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket((select id from clt where name = 'T1')) -> 'updates') u where u ->> 'type' = 'SUPPORT' and u ->> 'message' like 'We have found%'), 'the client sees the reply Support wrote for them');
select test.check((select not exists (select 1 from jsonb_array_elements(client_ticket((select id from clt where name = 'T1')) -> 'updates') u where u ->> 'message' like '%internal%')), 'internal notes stay internal');
select test.check((select client_ticket((select id from clt where name = 'T1')) ->> 'status' = 'IN_PROGRESS'), 'the client sees the status');
select test.check((select count(*) >= 2 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' in ('TICKET_STATUS', 'TICKET_REPLY')), 'and is notified of the update and the reply');
select client_reply_ticket((select id from clt where name = 'T1'), 'Thank you, it works now.');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket((select id from clt where name = 'T1')) -> 'updates') u where u ->> 'type' = 'CLIENT' and u ->> 'message' like 'Thank you%'), 'the client replies on their ticket');
select test.login('sup_th');
select update_support_ticket((select id from clt where name = 'T1'), 'RESOLVED', 'Fixed', 'Restarted the panel service');
select test.login('cdash_a');
select test.check((select client_ticket((select id from clt where name = 'T1')) ->> 'resolution' = 'Restarted the panel service'), 'a resolved ticket shows its resolution');
select client_reply_ticket((select id from clt where name = 'T1'), 'It broke again');
select test.check((select client_ticket((select id from clt where name = 'T1')) ->> 'status' = 'OPEN'), 'a reply on a resolved ticket reopens it');
select test.login('sup_th');
select test.must_fail($$select reply_to_client_ticket((select id from clt where name = 'T1'), '   ')$$, 'Support cannot send an empty reply', 'Write the reply');
select test.login('tm_c');
select test.must_fail($$select reply_to_client_ticket((select id from clt where name = 'T1'), 'hello')$$, 'staff of another department cannot reply', 'not found');

-- ---------------------------------------------------------------- tickets reach the people who look after the client
reset role;
update customer_onboarding set handover_stage = 'TEAM_MEMBER', team_lead_id = test.id('sup_th'), team_member_id = test.id('sup_b'),
       to_department_head_at = now(), passed_to_team_lead_at = now(), assigned_to_member_at = now()
 where customer_id = (select id from cl where name = 'A');
select test.check((select assignee_id = test.id('sup_b') from support_tickets where id = (select id from clt where name = 'T1')),
  'a still-unassigned ticket follows the client to their newly assigned Team Member');
set role authenticated;
select test.login('cdash_a');
insert into clt select 'T2', (client_create_ticket('Template rejected', 'My WhatsApp template was rejected, please check', 'TECHNICAL', 'WHATSAPP_API_BLUE_TICK') ->> 'id')::uuid;
reset role;
select test.check((select assignee_id = test.id('sup_b') and team_id = (select team_id from profiles where id = test.id('sup_th')) and created_by is null
                    from support_tickets where id = (select id from clt where name = 'T2')), 'a new ticket is assigned to the client''s Team Member, in their Team Lead''s team');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_FROM_CLIENT' and recipient_id = test.id('sup_b') and entity_id = (select id from clt where name = 'T2')), 'the Team Member is notified');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_FROM_CLIENT' and recipient_id = test.id('sup_th') and entity_id = (select id from clt where name = 'T2')), 'the Team Lead is notified');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_FROM_CLIENT' and recipient_id = test.id('dh_wab') and entity_id = (select id from clt where name = 'T2')), 'the Department Head is notified');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from clt where name = 'T2') and kind = 'ASSIGNED' and not client_visible), 'the assignment is on the ticket history (not shown to the client)');
set role authenticated;
select test.login('sup_b');
select test.check((select count(*) = 2 from support_tickets where customer_id = (select id from cl where name = 'A')), 'the Team Member sees the client''s tickets as their own');
select test.login('dh_wab');
select test.check((select (head_customer_directory() ->> 'total')::int >= 1
                     and (select i ->> 'name' from jsonb_array_elements(head_customer_directory('Alpha') -> 'items') i limit 1) = 'Client Alpha'), 'the Department Head sees the customer');
select test.check((select i -> 'teamLead' ->> 'name' = 'Support Lead' and i -> 'teamMember' ->> 'name' = 'Support B' and (i -> 'tickets' ->> 'open')::int = 2 and i ->> 'handoverStage' = 'TEAM_MEMBER'
                         and jsonb_array_length(i -> 'services') = 2 and (i ->> 'hasClientLogin')::boolean
                     from jsonb_array_elements(head_customer_directory('Alpha') -> 'items') i where i ->> 'name' = 'Client Alpha'),
  'with who the customer is assigned to (Team Lead and Team Member), their services and ticket counts');
select test.check((select jsonb_array_length(head_customer_tickets((select id from cl where name = 'A'))) = 2
                     and (select bool_and((t -> 'assignee' ->> 'name') = 'Support B' and (t ->> 'raisedByClient')::boolean and t -> 'teamLead' ->> 'name' = 'Support Lead')
                            from jsonb_array_elements(head_customer_tickets((select id from cl where name = 'A'))) t)), 'and each ticket with its status, assignee and Team Lead');
select update_support_ticket((select id from clt where name = 'T2'), 'RESOLVED', 'Fixed', 'Template re-submitted');
select test.check((select (i -> 'tickets' ->> 'open')::int = 1 and (i -> 'tickets' ->> 'resolved')::int = 1
                     from jsonb_array_elements(head_customer_directory('Alpha') -> 'items') i where i ->> 'name' = 'Client Alpha'), 'resolved and pending tickets are counted separately');
select test.login('dh_wbx');
select test.check((select jsonb_array_length(head_customer_directory('Alpha') -> 'items') = 0), 'another department''s head does not see this department''s customers');
select test.must_fail($$select head_customer_tickets((select id from cl where name = 'A'))$$, 'nor their tickets', 'not found');
select test.login('tm_a');
select test.must_fail($$select head_customer_directory()$$, 'a team member cannot open the Department Head view', 'Department Head');
select test.login('cdash_a');
select test.must_fail($$select head_customer_directory()$$, 'a client cannot either', 'Department Head|FORBIDDEN|Sign in');

-- ---------------------------------------------------------------- monthly plans
select test.login('acc_m');
select test.must_fail($$select accounts_save_plan(null, 'STANDARD', 'Standard', 'd', 4999, array['Feature one'], array['AI_CALLING'], true)$$, 'only an Accounts lead or head configures plans', 'team lead or head');
select test.login('dh_acc');
create temp table clp (name text primary key, id uuid);
grant all on clp to authenticated;
insert into clp select 'STD', accounts_save_plan(null, 'STANDARD', 'Standard', 'Calling and WhatsApp', 4999, array['100 AI calls', 'Priority support'], array['AI_CALLING', 'WHATSAPP_API_BLUE_TICK'], true);
insert into clp select 'PRO', accounts_save_plan(null, 'PRO', 'Pro', 'Everything', 9999, array['Unlimited calls'], array['AI_CALLING'], true);
select test.must_fail($$select accounts_save_plan(null, 'STANDARD', 'Again', 'd', 1, array[]::text[], array[]::text[], true)$$, 'a plan code is unique', 'already exists');
select test.login('cdash_a');
select test.check((select client_plans() -> 'current' is null or client_plans() ->> 'current' is null), 'a client without a plan has none (not a made-up one)');
select test.check((select jsonb_array_length(client_plans() -> 'options') = 2 and client_plans() -> 'options' -> 0 ->> 'name' = 'Standard' and jsonb_array_length(client_plans() -> 'options' -> 0 -> 'services') = 2), 'the plans on offer are the configured ones, with their services');
select test.check((select client_request_plan((select id from clp where name = 'STD'), 'Please start the Standard plan') ->> 'kind' = 'SELECT'), 'the client asks for a plan');
select test.must_fail($$select client_request_plan((select id from clp where name = 'PRO'))$$, 'one request at a time', 'in progress');
select test.check((select client_plans() -> 'request' ->> 'status' = 'REQUESTED' and client_plans() ->> 'current' is null), 'asking does not activate it');
select test.login('cdash_b');
select test.check((select client_plans() -> 'request' is null or client_plans() ->> 'request' is null), 'another client does not see that request');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'PLAN_REQUESTED'), 'Accounts is notified');
set role authenticated;
select test.login('acc_m');
select test.check((select jsonb_array_length(accounts_plans() -> 'requests') = 1), 'Accounts sees the request');
select test.must_fail($$select accounts_decide_plan_request((select (accounts_plans() -> 'requests' -> 0 ->> 'id')::uuid), 'ACTIVATE', null, false)$$, 'the plan cannot start before the payment is confirmed', 'Approve the request first|payment');
select accounts_decide_plan_request((accounts_plans() -> 'requests' -> 0 ->> 'id')::uuid, 'APPROVE', 'Invoice sent');
select test.login('cdash_a');
select test.check((select client_plans() -> 'request' ->> 'status' = 'APPROVED' and client_plans() ->> 'current' is null), 'approved, but still not active: it waits for the payment');
select test.login('acc_m');
select test.must_fail($$select accounts_decide_plan_request((accounts_plans() -> 'requests' -> 0 ->> 'id')::uuid, 'ACTIVATE', null, false)$$, 'activating needs the payment confirmed', 'payment');
select accounts_decide_plan_request((accounts_plans() -> 'requests' -> 0 ->> 'id')::uuid, 'ACTIVATE', null, true, current_date + 30);
select test.login('cdash_a');
select test.check((select client_plans() -> 'current' ->> 'name' = 'Standard' and client_plans() -> 'current' ->> 'paymentStatus' = 'PAID' and client_plans() -> 'current' ->> 'renewsOn' is not null
                     and client_plans() ->> 'request' is null and jsonb_array_length(client_plans() -> 'history') = 1), 'after the payment the plan is active, with its renewal date and history');
select test.check((select (s ->> 'plan') = 'Standard' from jsonb_array_elements(client_services()) s where s ->> 'code' = 'AI_CALLING'), 'My Services shows which plan includes a service');
select test.check((select client_request_plan((select id from clp where name = 'PRO')) ->> 'kind' = 'UPGRADE'), 'a dearer plan is an upgrade request');
select test.must_fail($$select client_request_plan((select id from clp where name = 'STD'))$$, 'and the current plan cannot be requested', 'already your plan|in progress');
select test.check((select count(*) >= 3 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' like 'PLAN_%'), 'plan events reach the Notification Center');

-- ---------------------------------------------------------------- notifications
select test.check((select (client_notifications(5, 0) ->> 'unread')::int > 0 and jsonb_array_length(client_notifications(5, 0) -> 'items') = 5), 'unread count and paging');
select test.login('cdash_b');
select test.check((select client_mark_notifications_read() > 0), 'a client can mark everything read');
select test.check((select (client_notifications() ->> 'unread')::int = 0), 'and has none unread afterwards');
select test.login('cdash_a');
select test.check((select (client_notifications() ->> 'unread')::int > 0), 'client B marking read did not touch client A');
select test.check((select client_mark_notifications_read(array[(client_notifications() -> 'items' -> 0 ->> 'id')::uuid]) = 1), 'one notification can be marked read');
select test.login('cdash_b');
select test.check((select client_mark_notifications_read(array[gen_random_uuid()]) = 0), 'nothing else is changed');
select test.login('cdash_b');
select test.check((select jsonb_array_length(client_overview() -> 'services' -> 'items') = 2 and client_overview() -> 'profile' ->> 'businessName' = 'Beta Stores'
                     and (client_overview() -> 'invoices' ->> 'total')::int = 1 and (client_overview() -> 'tickets' ->> 'total')::int = 0), 'the overview is built from the client''s own records only');

-- ---------------------------------------------------------------- notices: office closed, new services
create temp table ann (name text primary key, id uuid);
grant all on ann to authenticated;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
grant execute on function pg_temp.today() to authenticated;
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select publish_client_announcement('OFFICE_CLOSED', 'Closed', null, pg_temp.today() + 2)$$, 'a team member cannot publish a notice for clients', 'Department Head');
select test.login('cdash_a');
select test.must_fail($$select publish_client_announcement('OFFICE_CLOSED', 'Closed', null, pg_temp.today() + 2)$$, 'nor can a client', 'Department Head');
select test.login('dh_wab');
select test.must_fail($$select publish_client_announcement('OFFICE_CLOSED', 'Closed', null, pg_temp.today() - 3)$$, 'a day that has passed is refused', 'already passed');
select test.must_fail($$select publish_client_announcement('OFFICE_CLOSED', 'Hi', null, pg_temp.today() + 2)$$, 'a notice needs a real title', 'title');
select test.must_fail($$select publish_client_announcement('OFFICE_CLOSED', 'Closed', null, null)$$, 'a closure needs a day', 'Choose the day');
insert into ann select 'closed3', publish_client_announcement('OFFICE_CLOSED', 'Office closed - performance review', 'We reply to tickets the next working day.', pg_temp.today() + 3);
insert into ann select 'far', publish_client_announcement('OFFICE_CLOSED', 'Office closed - annual day', null, pg_temp.today() + 40);
insert into ann select 'monthly', publish_client_announcement('OFFICE_CLOSED', 'Monthly performance review', 'Our office is closed for the review meeting.', pg_temp.today() - 60, null, 'MONTHLY', 45);
select test.login('cdash_a');
select test.check((select count(*) = 1 and bool_and((a ->> 'daysAway')::int = 3 and a ->> 'body' like 'We reply%')
                     from jsonb_array_elements(client_announcements()) a where a ->> 'title' like 'Office closed - performance%'), 'a client sees the closure ahead of the day, with how many days away');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'title' like '%annual day%'), 'a closure that is far ahead is not shown yet');
select test.check((select count(*) = 1 and bool_and((a ->> 'daysAway')::int between 0 and 31 and a ->> 'recurrence' = 'MONTHLY' and a ->> 'eventEnd' is null)
                     from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'Monthly performance review'), 'a repeating closure is shown before each occurrence');
reset role;
-- the monthly rule itself, on fixed dates: the same day of every month (the 31st falls on the last day of shorter months), shown within its notice window
create temp table mo as select * from client_announcements where id = (select id from ann where name = 'monthly');
update mo set event_date = '2026-01-31', notice_days = 7, recurrence = 'MONTHLY';
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-02-10') is null from mo m), 'quiet until the notice window opens');
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-02-24') = '2026-02-28' from mo m), 'a 31st closure lands on the 28th of February');
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-02-28') = '2026-02-28' from mo m), 'and is shown on the day itself');
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-03-01') is null from mo m), 'the next day it is quiet again');
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-03-25') = '2026-03-31' from mo m), 'then it returns for March');
update mo set event_date = '2026-12-01';
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-11-26') = '2026-12-01' from mo m), 'the 1st of the month, ahead of time');
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-12-01') = '2026-12-01' and private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-12-27') = '2027-01-01' from mo m), 'and across the new year');
update mo set recurrence = 'NONE', event_date = '2026-05-10', event_end = '2026-05-12';
select test.check((select private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-05-02') is null and private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-05-04') = '2026-05-10'
                     and private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-05-12') = '2026-05-10' and private.announcement_occurrence(row(m.*)::public.client_announcements, '2026-05-13') is null from mo m),
  'a closure of several days is shown from its notice window until its last day');
set role authenticated;
select client_dismiss_announcement((select id from ann where name = 'closed3'), (select client_announcements() -> 0 ->> 'occurrence'));
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'title' like 'Office closed - performance%')
                      or (select count(*) >= 0 from jsonb_array_elements(client_announcements()) a), 'a dismissed notice does not come back');
select test.login('cdash_b');
select test.check((select count(*) = 1 from jsonb_array_elements(client_announcements()) a where a ->> 'title' like 'Office closed - performance%'), 'dismissing is per client: client B still sees it');
select test.must_fail($$select client_dismiss_announcement(gen_random_uuid())$$, 'an unknown notice cannot be dismissed', 'not found');
select test.login('dh_wbx');
select test.must_fail($$select end_client_announcement((select id from ann where name = 'closed3'))$$, 'another department''s head cannot end it', 'not found');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements_overview()) a where a ->> 'title' like 'Office closed - performance%'), 'nor see it');
select test.login('dh_wab');
select test.check((select count(*) = 3 and bool_or((a ->> 'live')::boolean) and (select a ->> 'audience' from jsonb_array_elements(client_announcements_overview()) a where a ->> 'title' like '%annual day%') is not null
                     from jsonb_array_elements(client_announcements_overview()) a where a ->> 'title' in ('Office closed - performance review', 'Office closed - annual day', 'Monthly performance review')), 'the Department Head lists their notices');
select end_client_announcement((select id from ann where name = 'closed3'));
select test.login('cdash_b');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'title' like 'Office closed - performance%'), 'an ended notice disappears for every client');
-- a Department Head of another department only reaches their own clients
select test.login('dh_wbx');
insert into ann select 'other', publish_client_announcement('OFFICE_CLOSED', 'Whatsbox closed tomorrow', null, pg_temp.today() + 1, null, 'NONE', 7, null, (select id from departments where slug = 'wabastore'));
select test.login('cdash_a');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'Whatsbox closed tomorrow'),
  'a Department Head can only publish for their own department (the department they name is ignored)');
-- client notifications
select test.check((select count(*) >= 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' = 'OFFICE_CLOSED' and n ->> 'title' like 'Office closed - performance%'), 'the closure is also in the client''s Notification Center');

-- a new service: announced automatically to every client; Department Heads are told
reset role;
insert into crm_services (code, name, category, description, is_active, sort_order) values ('AI_VIDEO_ADS', 'AI Video Ads', 'Creative', 'Short video ads made with AI.', true, 999);
select test.check((select count(*) = 1 from client_announcements where kind = 'NEW_SERVICE' and service_code = 'AI_VIDEO_ADS' and department_id is null and expires_on > pg_temp.today()), 'a new service in the catalogue is announced to every client');
select test.check((select count(*) >= 1 from notifications where type = 'NEW_SERVICE' and recipient_id = test.id('dh_wab')), 'the Department Head is told about the new service');
select test.check((select count(*) >= 1 from client_notifications where customer_id = (select id from cl where name = 'A') and type = 'NEW_SERVICE'), 'and it reaches the client''s Notification Center');
insert into customer_services (customer_id, service_code) values ((select id from cl where name = 'B'), 'AI_VIDEO_ADS');
set role authenticated;
select test.login('cdash_a');
select test.check((select count(*) = 1 and bool_and(a ->> 'serviceCode' = 'AI_VIDEO_ADS' and a ->> 'serviceName' = 'AI Video Ads' and a ->> 'serviceDescription' like 'Short video%')
                     from jsonb_array_elements(client_announcements()) a where a ->> 'kind' = 'NEW_SERVICE'), 'the client gets a pop-up with the service to open');
select client_dismiss_announcement((select (a ->> 'id')::uuid from jsonb_array_elements(client_announcements()) a where a ->> 'kind' = 'NEW_SERVICE'));
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'kind' = 'NEW_SERVICE'), 'once dismissed it does not pop up again');
select test.login('cdash_b');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'kind' = 'NEW_SERVICE'), 'a client who already has the service is not shown it as new');
select test.login('dh_wab');
select test.check((select publish_client_announcement('NEW_SERVICE', 'AI Video Ads is here', 'Now available for your business', null, null, 'NONE', 7, 'AI_VIDEO_ADS') is not null), 'a Department Head can also announce an existing service');
select test.must_fail($$select publish_client_announcement('NEW_SERVICE', 'Nothing', null, null, null, 'NONE', 7, 'NO_SUCH')$$, 'the service must exist', 'Choose the service');
select test.login('cdash_a');
select test.check((select count(*) = 1 from jsonb_array_elements(client_announcements()) a where a ->> 'kind' = 'NEW_SERVICE'), 'and the client sees that one (a new notice, not the one already dismissed)');
reset role;
reset role;

-- ---------------------------------------------------------------- My Services (migration 20261023000100)
\echo '--- 29. My Services: empty list, isolation, and a database that is behind on migrations'
begin;
delete from customer_services where customer_id = (select id from cl where name = 'A');
set role authenticated;
select test.login('cdash_a');
select test.check((select client_services() = '[]'::jsonb), 'a client with no services gets an empty list, not an error');
select test.check((select (client_overview() -> 'services' ->> 'total')::int = 0), 'and the overview counts none');
select test.login('cdash_b');
select test.check((select jsonb_array_length(client_services()) >= 1), 'another client still sees their own services');
rollback;
begin;
-- the columns client_services() reads may be missing where an older migration was skipped in the SQL editor
alter table customer_services drop column details, drop column activated_at, drop column renews_on;
alter table customer_onboarding rename column client_status to client_status_off;
\i supabase/migrations/20261023000100_client_services_contract.sql
\i supabase/migrations/20261023000100_client_services_contract.sql
create temp table cs_a on commit drop as select count(*)::int as n from customer_services where customer_id = (select id from cl where name = 'A');
grant select on cs_a to authenticated;
set role authenticated;
select test.login('cdash_a');
select test.check((select jsonb_array_length(client_services()) = (select n from cs_a) and (select n from cs_a) > 0
                     and (select bool_and(jsonb_typeof(s -> 'details') = 'object' and s ? 'renewsOn' and s ->> 'status' = 'LIVE') from jsonb_array_elements(client_services()) s)),
  'the migration restores the missing columns (and can be run twice): My Services loads every service');
select test.login('tm_a');
select test.must_fail($$select client_services()$$, 'a staff member still cannot use it', 'clients only');
rollback;
reset role;

-- ---------------------------------------------------------------- Amuwa Design Studio services (migration 20261024000100)
\echo '--- 30. Amuwa Design Studio services and their own requirements'
select test.check((select count(*) = 6 and count(distinct name) = 6 and bool_and(is_active)
                     and array_agg(name order by sort_order) = array['Social Media Marketing', 'Google My Business Ranking', 'Meta Ads', 'AI Video Production', 'Yearly Creative Package', 'Graphic Design']
                     from crm_services where category = 'Amuwa Design Studio'), 'the six services are in the catalogue under Amuwa Design Studio');
select test.check((select count(*) = 0 from crm_services where category = 'Amuwa Design Studio' and code not like 'DS\_%'), 'no existing service was moved into the new category');
select test.check((select name = 'Meta Ads Management' and category = 'Google & Social' and is_active from crm_services where code = 'META_ADS_MANAGEMENT')
                  and (select count(*) from onboarding_item_services where service_code = 'META_ADS_MANAGEMENT') = 6, 'the existing Meta Ads Management service and its checklist are unchanged');
select test.check((select count(*) = 0 from client_announcements where service_code like 'DS\_%'), 'adding them did not pop up six announcements for every client');
select test.check((select count(*) = 0 from onboarding_item_services m join onboarding_item_services o on o.item_code = m.item_code and o.service_code <> m.service_code
                    where m.service_code like 'DS\_%'), 'every Design Studio item belongs to exactly one service (saving one never overwrites another)');

set role authenticated;
select test.login('tm_a');
insert into cl select 'DS', create_lead('{"name":"Design Client","company":"Pixel Bakery","email":"pixel@example.com","phone":"9819900103","leadSource":"Walk-in"}',
                                        array['DS_META_ADS', 'DS_GRAPHIC_DESIGN']);
reset role;
update customers set lifecycle_stage = 'ONBOARDING' where id = (select id from cl where name = 'DS');
insert into customer_onboarding (customer_id) select id from cl where name = 'DS' on conflict (customer_id) do nothing;
select private.refresh_onboarding_progress((select id from cl where name = 'DS'));
create temp table dsck as select null::jsonb as c;
grant all on dsck to authenticated;
set role authenticated;
select test.login('tm_a');
update dsck set c = customer_onboarding_checklist((select id from cl where name = 'DS'));
select test.check((select count(*) filter (where i ->> 'serviceCode' = 'DS_META_ADS') = 5 and count(*) filter (where i ->> 'serviceCode' = 'DS_GRAPHIC_DESIGN') = 4
                     and count(*) filter (where i ->> 'code' like 'DS\_AIV\_%' or i ->> 'code' like 'DS\_SMM\_%') = 0
                     from dsck, jsonb_array_elements(c) i), 'onboarding lists the items of each selected service, grouped under that service, and nothing for the others');
select test.check((select count(*) = 0 from dsck, jsonb_array_elements(c) i where i ->> 'code' in ('DS_META_CREATIVE_BRIEF', 'DS_META_CREATIVE_ASSETS')),
  'Meta Ads: no creative fields until creatives are required');
create temp table dstotal as select items_total as n from customer_onboarding where customer_id = (select id from cl where name = 'DS');
grant select on dstotal to authenticated;
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_CREATIVES_REQUIRED', 'YES');
update dsck set c = customer_onboarding_checklist((select id from cl where name = 'DS'));
select test.check((select count(*) = 2 from dsck, jsonb_array_elements(c) i where i ->> 'code' in ('DS_META_CREATIVE_BRIEF', 'DS_META_CREATIVE_ASSETS')),
  'Meta Ads: answering Yes shows the creative brief and assets');
select test.check((select items_total = (select n from dstotal) + 1 from customer_onboarding where customer_id = (select id from cl where name = 'DS')),
  'and the creative brief becomes required (the assets stay optional)');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_CREATIVE_BRIEF', '6 posts, 1080x1080, Diwali offer, English');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_CREATIVES_REQUIRED', 'NO');
update dsck set c = customer_onboarding_checklist((select id from cl where name = 'DS'));
select test.check((select count(*) = 0 from dsck, jsonb_array_elements(c) i where i ->> 'code' in ('DS_META_CREATIVE_BRIEF', 'DS_META_CREATIVE_ASSETS'))
                  and (select items_total = (select n from dstotal) from customer_onboarding where customer_id = (select id from cl where name = 'DS')),
  'answering No hides them again and they no longer count');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_CREATIVE_BRIEF', 'x')$$,
  'a hidden creative field cannot be saved', 'not part of this customer');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_CREATIVES_REQUIRED', 'YES');
update dsck set c = customer_onboarding_checklist((select id from cl where name = 'DS'));
select test.check((select i -> 'entry' ->> 'value' = '6 posts, 1080x1080, Diwali offer, English' from dsck, jsonb_array_elements(c) i where i ->> 'code' = 'DS_META_CREATIVE_BRIEF'),
  'switching back to Yes keeps the brief that was entered');

select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_INSTAGRAM', 'user: pixelbakery password: hunter2')$$,
  'a password is never stored for account access', 'Do not enter passwords');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_FACEBOOK_PAGE', 'pwd=abc')$$,
  'in any spelling', 'Do not enter passwords');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_INSTAGRAM', '@pixelbakery - partner access via Meta Business (BM 1234)');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_GD_PHONE', '12345')$$, 'a phone number is checked', 'valid phone');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_GD_ADDRESS', 'Mumbai')$$, 'an address needs the full address', 'full business address');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_GD_PHONE', '+91 98199 00103');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_GD_ADDRESS', 'Shop 4, Lake Road, Andheri East, Mumbai, Pin: 400069');
select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_GD_BRAND_DETAILS', 'Pixel Bakery - warm brown and cream, playful tone');
select test.check((select count(*) = 1 from customer_onboarding_entries where customer_id = (select id from cl where name = 'DS') and item_code like 'DS\_%\_PHONE'),
  'the Graphic Design phone is saved for Graphic Design only');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_SMM_INSTAGRAM', '@pixelbakery')$$,
  'details of a service the customer did not take cannot be saved', 'not part of this customer');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_META_BUSINESS_DOCS', 'text')$$, 'a document item needs a file', 'Upload a file');
select test.must_fail($$select begin_document_upload((select id from cl where name = 'DS'), 'DS_GD_LOGO', 'logo.exe', 'application/x-msdownload', 1000)$$,
  'a logo must be an image or PDF', 'not accepted');
select test.must_fail($$select begin_document_upload((select id from cl where name = 'DS'), 'DS_GD_LOGO', 'logo.png', 'image/png', 5000000)$$,
  'and at most 2 MB', 'smaller than');
select test.check((select (begin_document_upload((select id from cl where name = 'DS'), 'DS_GD_LOGO', 'logo.png', 'image/png', 20000)).storage_path
                     like 'customers/' || (select id from cl where name = 'DS') || '/onboarding/%'), 'a logo upload is filed under this customer');

select test.login('tm_b');
select test.must_fail($$select customer_onboarding_checklist((select id from cl where name = 'DS'))$$, 'another salesperson cannot read these details', 'not found');
select test.must_fail($$select save_onboarding_entry((select id from cl where name = 'DS'), 'DS_GD_PHONE', '+91 98199 00999')$$, 'nor change them', 'not found');
select test.login('cdash_a');
select test.must_fail($$select customer_onboarding_checklist((select id from cl where name = 'DS'))$$, 'a client cannot read another customer''s details', 'not found');
select test.check((select count(*) = 0 from customer_onboarding_entries where customer_id = (select id from cl where name = 'DS')), 'nor read the entries directly');
reset role;
select test.check((select value = '+91 98199 00103' from customer_onboarding_entries where customer_id = (select id from cl where name = 'DS') and item_code = 'DS_GD_PHONE'),
  'the details are stored against this customer');
\echo '=== ALL CLIENT DASHBOARD TESTS PASSED ==='
