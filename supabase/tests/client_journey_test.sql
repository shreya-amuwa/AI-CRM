-- =============================================================================
-- Client onboarding journey (migrations 20261205000100 / 20261205000200): payment -> login -> Meta verification -> Relationship Manager
-- -> service setup -> completed, the sections that open at each stage, and the stage-based client chat.
-- Runs after the other suites on the same database and reuses their staff.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- earlier suites re-apply older migrations (to prove they are re-runnable): put the journey back on top, which also proves it re-runs
\i supabase/migrations/20261205000100_client_onboarding_journey.sql
\i supabase/migrations/20261205000200_client_stage_chat.sql

\echo '--- 80. Journey: a new customer, from payment to a login'
create temp table jy (name text primary key, id uuid);
create temp table jym (name text primary key, data jsonb);
grant all on jy, jym to authenticated, service_role;

-- the Meta Verifier is picked from the department's Technical Consultants; make sure there are two so "least busy" has a choice
select test.check((select count(*) >= 1 from profiles where is_technical_consultant and status = 'ACTIVE' and department_id = test.dept('wabastore')), 'the department has Technical Consultants');

set role authenticated;
select test.login('tm_a');
insert into jy select 'A', create_lead('{"name":"Journey Alpha","company":"Alpha Journey Co","email":"alpha.journey@example.com","phone":"9819901001","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK', 'AI_CALLING']);
insert into jy select 'B', create_lead('{"name":"Journey Beta","company":"Beta Journey Co","email":"beta.journey@example.com","phone":"9819901002","leadSource":"Walk-in"}', array['WHATSAPP_API_BLUE_TICK']);
select send_lead_to_accounts((select id from jy where name = 'A'), 10000, null);
select send_lead_to_accounts((select id from jy where name = 'B'), 5000, null);
select test.login('acc_m');
select accounts_set_order_gst(id, 0) from jy where name in ('A', 'B');
select accounts_record_payment((select id from jy where name = 'A'), 'PART', 4000, 'UPI', 'JY-A-UPI', null, null, true);
select accounts_record_payment((select id from jy where name = 'B'), 'PART', 2000, 'UPI', 'JY-B-UPI', null, null, true);

-- the login can be created as soon as a payment is verified, for a customer that goes through the Technical Consultant too
select test.check((select (customer_journey_info((select id from jy where name = 'A')) -> 'can' ->> 'createLogin') = 'true'), 'Accounts can create the login of a Technical Consultant customer once a payment is verified');
select accounts_confirm_and_return((select id from jy where name = 'A'));
select accounts_confirm_and_return((select id from jy where name = 'B'));
reset role;
select test.check((select accounts_confirmed_at is not null and meta_status = 'PENDING' and onboarding_completed_at is null
                     from customer_onboarding where customer_id = (select id from jy where name = 'A')),
  'payment confirmed: the onboarding record holds the payment time, Meta verification is pending, onboarding is not complete');
select test.check((select meta_verifier_id is not null and meta_verifier_assigned_at is not null and meta_verifier_assigned_by is null
                     from customer_onboarding where customer_id = (select id from jy where name = 'A'))
               and (select p.is_technical_consultant and p.department_id = test.dept('wabastore') from profiles p
                     where p.id = (select meta_verifier_id from customer_onboarding where customer_id = (select id from jy where name = 'A'))),
  'a Meta Verifier (a Technical Consultant of the department) is assigned automatically, not chosen by anybody in the browser');
select test.check((select count(*) = 1 from notifications where type = 'META_VERIFIER_ASSIGNED' and entity_id = (select id from jy where name = 'A')
                     and recipient_id = (select meta_verifier_id from customer_onboarding where customer_id = (select id from jy where name = 'A'))), 'the verifier is told');

-- Accounts creates the client logins (the API creates the Auth user between "begin" and "record"; here it is made by hand)
set role authenticated;
select test.login('acc_m');
select accounts_client_login_begin((select id from jy where name = 'A'), 'alpha.login@journey.example');
select accounts_client_login_begin((select id from jy where name = 'B'), 'beta.login@journey.example');
reset role;
select test.create_auth_user('jy_a', 'alpha.login@journey.example', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from jy where name = 'A')));
select test.create_auth_user('jy_b', 'beta.login@journey.example', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from jy where name = 'B')));
set role authenticated;
select test.login('acc_m');
select record_client_account((select id from jy where name = 'A'), test.id('jy_a'), 'alpha.login@journey.example');
select record_client_account((select id from jy where name = 'B'), test.id('jy_b'), 'beta.login@journey.example');
select test.admin_check($q$select count(*) = 2 from customer_client_accounts where customer_id in (select id from jy)$q$, 'both clients have a login');
select test.login('tm_a');
select test.must_fail($$select accounts_client_login_begin((select id from jy where name = 'A'), 'again@journey.example')$$, 'a second login for the customer is refused', 'Only the Accounts|already has a login');

\echo '--- 81. Journey: what the client sees right after payment and login'
select test.login('jy_a');
select test.check((client_onboarding_journey() ->> 'stage' = 'META_VERIFICATION' and not (client_onboarding_journey() ->> 'completed')::boolean), 'the client lands on the Meta verification stage');
select test.check((select s ->> 'status' = 'COMPLETED' and s ->> 'completedAt' is not null and s ->> 'accountEmail' = 'alpha.login@journey.example'
                     from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'PAYMENT'), 'stage 1: account and payment confirmed, with the date');
select test.check((select s ->> 'status' = 'PENDING' and s ->> 'metaStatus' = 'PENDING' and (s ->> 'current')::boolean and (s -> 'verifier' ->> 'name') is not null
                     from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'), 'stage 2: Meta verification is current, pending, with its verifier named');
select test.check((select s ->> 'status' = 'PENDING' and s -> 'manager' = 'null'::jsonb from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'RELATIONSHIP_MANAGER'),
  'stage 3: the Relationship Manager stage waits, no manager is shown yet');
select test.check((select s ->> 'status' = 'PENDING' and jsonb_array_length(s -> 'services') = 2 and (select bool_and(x ->> 'status' = 'PENDING' and x ->> 'waitingFor' = 'Meta verification') from jsonb_array_elements(s -> 'services') x)
                     from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'SERVICE_SETUP'), 'stage 4: each purchased service is listed on its own and waits');
select test.check((select s ->> 'status' = 'PENDING' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'COMPLETED'), 'stage 5: not complete');

-- sections: the onboarding and the permitted chat stay open, everything else is visibly closed with a reason
select test.check((select (a -> 'overview' ->> 'enabled')::boolean and (a -> 'journey' ->> 'enabled')::boolean and (a -> 'chat' ->> 'enabled')::boolean and (a -> 'documents' ->> 'enabled')::boolean
                          and (a -> 'invoices' ->> 'enabled')::boolean and (a -> 'notifications' ->> 'enabled')::boolean and (a -> 'docs' ->> 'enabled')::boolean
                     from (select client_onboarding_journey() -> 'access' as a) x), 'the journey, overview, chat, documents, invoices, notifications and manual are open');
select test.check((select bool_and(not (a -> s ->> 'enabled')::boolean and a -> s ->> 'reason' like 'Available after%')
                     from (select client_onboarding_journey() -> 'access' as a) x, unnest(array['services', 'campaigns', 'calendar', 'tickets', 'explore', 'plans']) s),
  'services, campaigns, calendar, tickets, explore and plans are closed, each with an explanation');
select test.check((client_onboarding_journey() -> 'access' -> 'tickets' ->> 'reason') = 'Available after Meta verification is completed.', 'and the reason names what is missing');

-- the closed functions refuse a direct call (the same answer the screen gets)
select test.must_fail($$select client_services()$$, 'My Services cannot be called directly', 'Available after');
select test.must_fail($$select client_campaigns()$$, 'nor Campaigns', 'Available after');
select test.must_fail($$select client_calendar(current_date, current_date + 7)$$, 'nor the Calendar', 'Available after');
select test.must_fail($$select client_tickets()$$, 'nor Tickets', 'Available after');
select test.must_fail($$select client_create_ticket('Help', 'Please help me with the setup', 'GENERAL', null, '{}'::uuid[])$$, 'a ticket cannot be raised', 'Available after');
select test.must_fail($$select client_service_catalog()$$, 'nor Explore Services', 'Available after');
select test.must_fail($$select client_request_service('AI_QR')$$, 'a service cannot be requested', 'Available after');
select test.must_fail($$select client_plans()$$, 'nor Monthly Plans', 'Available after');
select test.must_fail($$select client_request_plan(gen_random_uuid(), null)$$, 'a plan cannot be requested', 'Available after');
select test.must_fail($$select ticket_attachments(gen_random_uuid())$$, 'ticket files are closed too', 'Available after');
-- the permitted ones work
select test.check((client_overview() -> 'journey' ->> 'stage') = 'META_VERIFICATION' and (client_overview() -> 'services' ->> 'total')::int = 0 and (client_overview() -> 'tickets' ->> 'total')::int = 0,
  'the overview opens and carries the journey; closed sections show nothing of their own');
select test.check((client_documents() -> 'items') is not null and jsonb_typeof(client_invoices()) = 'array', 'documents and invoices open');
select test.check((client_me() ->> 'customerId') = (select id::text from jy where name = 'A'), 'the client reads their own profile');
-- logging in again changes nothing
select test.login('tm_a');
select test.login('jy_a');
select test.check((client_onboarding_journey() ->> 'stage') = 'META_VERIFICATION', 'after signing in again the stage is the same (it is stored, not remembered by the screen)');

-- clients are kept apart
select test.login('jy_b');
select test.check((select s ->> 'accountEmail' = 'beta.login@journey.example' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'PAYMENT'), 'another client reads their own journey');
select test.check((select count(*) = 0 from customer_onboarding), 'a client reads no onboarding rows directly (RLS)');
select test.check((select count(*) = 0 from chat_messages), 'nor messages');

\echo '--- 82. Journey: staff cannot be impersonated, and the wrong people cannot change the Meta status'
select test.login('jy_a');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'COMPLETED', null)$$, 'a client cannot complete their own verification', 'NOT_FOUND|Sign in|FORBIDDEN');
select test.must_fail($$select assign_meta_verifier((select id from jy where name = 'A'), null)$$, 'nor assign a verifier', 'NOT_FOUND|Sign in|FORBIDDEN');
select test.must_fail($$select set_service_setup((select id from jy where name = 'A'), 'AI_CALLING', 'READY', null)$$, 'nor mark a service ready', 'NOT_FOUND|Sign in|FORBIDDEN');
select test.must_fail($$select update customer_onboarding set meta_status = 'COMPLETED'$$, 'nor write the table', 'permission denied|syntax');
select test.login('tm_a');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'IN_PROGRESS', null)$$, 'Sales cannot change the Meta status', 'NOT_FOUND');
select test.must_fail($$select assign_meta_verifier((select id from jy where name = 'A'), test.id('tc_dash'))$$, 'nor assign a verifier', 'NOT_FOUND');
select test.must_fail($$select set_service_setup((select id from jy where name = 'A'), 'AI_CALLING', 'IN_PROGRESS', null)$$, 'nor start a service setup', 'NOT_FOUND');
select test.login('acc_m');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'IN_PROGRESS', null)$$, 'Accounts cannot either', 'NOT_FOUND');
select test.login('dh_wbx');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'IN_PROGRESS', null)$$, 'a Department Head of another department cannot', 'NOT_FOUND');

\echo '--- 83. Journey: Meta verification, with the chat to the Meta Verifier'
reset role;
create temp table jyv as select (select meta_verifier_id from customer_onboarding where customer_id = (select id from jy where name = 'A')) as id,
                                (select u.name from test.users u where u.id = (select meta_verifier_id from customer_onboarding where customer_id = (select id from jy where name = 'A'))) as name;
grant all on jyv to authenticated;
select test.check((select name is not null from jyv), 'the verifier is one of the test staff');
set role authenticated;

-- the client chats with the Meta Verifier: the RM chat is not open yet
select test.login('jy_a');
select test.check((select chat_client_conversation() ->> 'channel' = 'META' and chat_client_conversation() ->> 'access' = 'CLIENT' and (chat_client_conversation() ->> 'canWrite')::boolean
                          and chat_client_conversation() -> 'verifier' ->> 'name' is not null), 'by default the client is routed to the Meta Verifier chat, which is writable');
insert into jym select 'meta_conv', chat_client_conversation();
select test.must_fail($$select chat_client_conversation('RM')$$, 'the Relationship Manager chat is closed before verification is completed', 'opens after Meta verification');
select test.must_fail($$select chat_client_conversation('SOMEONE')$$, 'an unknown chat is refused', 'Unknown chat');
select test.check((select chat_send_message(((select data from jym where name = 'meta_conv') ->> 'id')::uuid, 'Hello, which documents do you need?', gen_random_uuid()) ->> 'senderLabel' = 'Client'), 'the client writes to the Meta Verifier');
-- the verifier answers; nobody else can
select test.login((select name from jyv));
select test.check((select chat_customer_conversation((select id from jy where name = 'A')) ->> 'channel' = 'META' and (chat_customer_conversation((select id from jy where name = 'A')) ->> 'canWrite')::boolean),
  'the verifier opens the Meta verification conversation of this client');
select test.check((select chat_send_message(((select data from jym where name = 'meta_conv') ->> 'id')::uuid, 'Please upload the business proof and the logo.', gen_random_uuid()) ->> 'senderLabel' = 'Meta Verifier'),
  'and answers, labelled Meta Verifier');
select test.check((select count(*) = 1 from jsonb_array_elements(chat_my_clients()) c where c ->> 'channel' = 'META' and c ->> 'customerId' = (select id::text from jy where name = 'A') and c ->> 'role' = 'Meta Verifier'),
  'the client is in the verifier''s list');
select test.login('tm_a');
select test.must_fail($$select chat_conversation_detail(((select data from jym where name = 'meta_conv') ->> 'id')::uuid)$$, 'Sales cannot open the conversation', 'NOT_FOUND|not found');
select test.must_fail($$select chat_customer_conversation((select id from jy where name = 'A'))$$, 'nor ask for it by customer', 'NOT_FOUND|not found');
select test.login('acc_m');
select test.must_fail($$select chat_conversation_detail(((select data from jym where name = 'meta_conv') ->> 'id')::uuid)$$, 'nor Accounts', 'NOT_FOUND|not found');
select test.login('jy_b');
select test.must_fail($$select chat_conversation_detail(((select data from jym where name = 'meta_conv') ->> 'id')::uuid)$$, 'another client cannot read the conversation', 'NOT_FOUND|not found');
select test.must_fail($$select chat_send_message(((select data from jym where name = 'meta_conv') ->> 'id')::uuid, 'I am someone else', gen_random_uuid())$$, 'nor write into it', 'NOT_FOUND|not found');
select test.must_fail($$select chat_messages_page(((select data from jym where name = 'meta_conv') ->> 'id')::uuid)$$, 'nor read its messages', 'NOT_FOUND|not found');
select test.login('dh_wab');
select test.check((select chat_conversation_detail(((select data from jym where name = 'meta_conv') ->> 'id')::uuid) ->> 'access' = 'REVIEWER'), 'the Department Head can review it, read only');
select test.must_fail($$select chat_send_message(((select data from jym where name = 'meta_conv') ->> 'id')::uuid, 'review note', gen_random_uuid())$$, 'but not write', 'reviewer');

-- Meta status: moved by the consultant, with the rules of the database
select test.login((select name from jyv));
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'COMPLETED', null)$$, 'before the customer reaches the consultant nothing can be changed', 'NOT_FOUND');
reset role;
-- the salesperson collects the documents and sends the customer to the Technical Consultant
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by)
  select c.id, i.code, 'saved', 'SAVED', test.id('tm_a') from jy c cross join lateral private.customer_items(c.id) i
  on conflict (customer_id, item_code) do nothing;
select private.refresh_onboarding_progress(id) from jy;
set role authenticated;
select test.login('tm_a');
select forward_onboarding_to_support((select id from jy where name = 'A'));
reset role;
select test.check((select meta_status = 'IN_PROGRESS' and meta_started_at is not null and meta_status_auto from customer_onboarding where customer_id = (select id from jy where name = 'A')),
  'reaching the consultant starts the verification (In progress)');
set role authenticated;
select test.login('jy_a');
select test.check((select s ->> 'status' = 'IN_PROGRESS' and s ->> 'metaStatus' = 'IN_PROGRESS' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'), 'the client sees it in progress');
select test.login((select name from jyv));
select consultant_set_addons_required((select id from jy where name = 'A'), false);
select consultant_start_onboarding((select id from jy where name = 'A'));
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'COMPLETED', null)$$, 'documents must be authorized before it can be completed', 'Authorize every document');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'DOCUMENTS_REQUIRED', null)$$, 'a request for documents must say what is needed', 'Tell the client');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'NOT_A_STATUS', null)$$, 'an unknown status is refused', 'Choose');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'IN_PROGRESS', null)$$, 'the same status again is refused', 'already');
-- a document sent back keeps the journey in verification and tells the client what to do
select review_onboarding_entry((select id from jy where name = 'A'), 'CUSTOMER_NAME', 'REJECTED', 'The name does not match the certificate');
reset role;
select test.check((select meta_status = 'DOCUMENTS_REQUIRED' and meta_status_auto and meta_feedback like '%sent back%' from customer_onboarding where customer_id = (select id from jy where name = 'A')), 'a rejected item makes the status Documents required');
set role authenticated;
select test.login('jy_a');
select test.check((select s ->> 'status' = 'ACTION_REQUIRED' and (s ->> 'current')::boolean and s ->> 'feedback' like '%sent back%'
                          and exists (select 1 from jsonb_array_elements(s -> 'outstanding') o where o ->> 'code' = 'CUSTOMER_NAME' and o ->> 'status' = 'REJECTED' and o ->> 'note' = 'The name does not match the certificate')
                     from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'),
  'the client sees Action required, the feedback and the exact item with the reviewer''s note');
select test.check((client_onboarding_journey() ->> 'stage') = 'META_VERIFICATION', 'the journey stays in Meta verification');
select test.check((select count(*) >= 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'title' = 'Meta verification update' and n ->> 'entityType' = 'journey'), 'the client is notified');
select test.check((select (chat_client_conversation('META') ->> 'canWrite')::boolean), 'the client can keep talking to the verifier');
select test.check((select count(*) >= 1 from jsonb_array_elements(chat_messages_page(((select data from jym where name = 'meta_conv') ->> 'id')::uuid) -> 'messages') m where m ->> 'kind' = 'SYSTEM' and m ->> 'body' like 'Documents required:%'), 'the conversation records the request as a line');
-- the correction arrives (the client saves a corrected detail) and the verifier authorizes it again
select test.login((select name from jyv));
select review_onboarding_entry((select id from jy where name = 'A'), 'CUSTOMER_NAME', 'VERIFIED', null);
reset role;
select test.check((select meta_status = 'IN_PROGRESS' and meta_feedback is null from customer_onboarding where customer_id = (select id from jy where name = 'A')), 'once nothing is sent back the verification continues by itself');
set role authenticated;
-- Meta rejects the submission
select test.login((select name from jyv));
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'REJECTED', '  ')$$, 'a rejection needs a reason', 'Tell the client');
select test.check((select set_meta_verification((select id from jy where name = 'A'), 'REJECTED', 'Meta asked for a clearer business proof') ->> 'status' = 'REJECTED'), 'the consultant records a rejection with its reason');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'COMPLETED', null)$$, 'a rejected verification cannot jump to completed', 'cannot move');
select test.login('jy_a');
select test.check((select s ->> 'status' = 'REJECTED' and s ->> 'feedback' = 'Meta asked for a clearer business proof' and s ->> 'completedAt' is null from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'),
  'the client sees Rejected with the verifier''s feedback');
select test.check((client_onboarding_journey() ->> 'stage') = 'META_VERIFICATION' and (client_onboarding_journey() -> 'access' -> 'tickets' ->> 'enabled')::boolean is false, 'a rejection keeps the journey in verification and everything else closed');
select test.check((select (chat_client_conversation('META') ->> 'canWrite')::boolean), 'the client can still write to the verifier');
select test.must_fail($$select chat_client_conversation('RM')$$, 'and the Relationship Manager chat stays closed', 'opens after Meta verification');
select test.login((select name from jyv));
select test.check((select set_meta_verification((select id from jy where name = 'A'), 'IN_PROGRESS', null) ->> 'status' = 'IN_PROGRESS'), 'the verifier resubmits (In progress)');
-- upload / document submission by the client is unchanged and does not complete anything
select test.login('jy_a');
select test.check((select jsonb_array_length(client_documents() -> 'items') > 0), 'the client can still open the documents to submit corrections');
select test.check((select s ->> 'metaStatus' = 'IN_PROGRESS' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'), 'submitting documents never completes the verification by itself');
-- completing needs the consultant's own items (WABA ID) too
select test.login((select name from jyv));
select verify_all_onboarding_entries((select id from jy where name = 'A'));
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'COMPLETED', null)$$, 'the WABA ID is part of the verification', 'Authorize every document');
select save_consultant_entry((select id from jy where name = 'A'), 'WABA_ID', '112233445566778');
-- the hand-over to the Department Head waits for the completed verification
select test.must_fail($$select send_to_department_head((select id from jy where name = 'A'), null)$$, 'the hand-over waits for Meta verification', 'Complete the Meta verification');
select test.check((select set_meta_verification((select id from jy where name = 'A'), 'COMPLETED', null) ->> 'status' = 'COMPLETED'), 'the consultant completes Meta verification');
select test.must_fail($$select set_meta_verification((select id from jy where name = 'A'), 'IN_PROGRESS', null)$$, 'a completed verification is final', 'already|cannot move');
select test.must_fail($$select assign_meta_verifier((select id from jy where name = 'A'), null)$$, 'and the verifier no longer changes', 'completed');
reset role;
select test.check((select meta_completed_at is not null and meta_completed_by = (select id from jyv) from customer_onboarding where customer_id = (select id from jy where name = 'A')), 'who completed it and when is recorded');
select test.check((select count(*) >= 1 from audit_logs where action = 'META_VERIFICATION_STATUS_CHANGED' and entity_id = (select id from jy where name = 'A') and metadata ->> 'to' = 'COMPLETED'), 'the audit log has the change');
select test.check((select client_status = 'COMPLETED' from customer_onboarding where customer_id = (select id from jy where name = 'A')), 'the e-mail / WhatsApp stage follows the Meta status (Completed only now)');
set role authenticated;

\echo '--- 84. Journey: after verification the Relationship Manager takes over'
select test.login('jy_a');
select test.check((select s ->> 'status' = 'COMPLETED' and s ->> 'completedAt' is not null from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'), 'Meta verification shows completed with its date');
select test.check((select s ->> 'status' = 'IN_PROGRESS' and (s ->> 'current')::boolean and s -> 'manager' = 'null'::jsonb from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'RELATIONSHIP_MANAGER'),
  'the Relationship Manager stage is now active, nobody assigned yet');
select test.check((client_onboarding_journey() ->> 'stage') = 'RELATIONSHIP_MANAGER', 'the journey moved on');
select test.check((client_onboarding_journey() -> 'chat' ->> 'active') = 'RM', 'the chat is routed to the Relationship Manager now');
-- the Meta conversation is kept, readable and closed
select test.check((select chat_client_conversation('META') ->> 'id' = (select data ->> 'id' from jym where name = 'meta_conv') and not (chat_client_conversation('META') ->> 'canWrite')::boolean
                          and chat_client_conversation('META') ->> 'blockReason' like 'Meta verification is completed%'), 'the Meta conversation is kept but closed');
select test.check((select count(*) = 2 from jsonb_array_elements(chat_messages_page(((select data from jym where name = 'meta_conv') ->> 'id')::uuid) -> 'messages') m where m ->> 'kind' = 'TEXT'), 'its history is intact');
select test.must_fail($$select chat_send_message(((select data from jym where name = 'meta_conv') ->> 'id')::uuid, 'one more to the verifier', gen_random_uuid())$$, 'nobody can add to it any more', 'closed');
-- the RM chat opens but nobody is assigned yet
select test.check((select chat_client_conversation('RM') ->> 'channel' = 'RM' and not (chat_client_conversation('RM') ->> 'canWrite')::boolean and chat_client_conversation('RM') ->> 'blockReason' like 'Your team has not been assigned%'),
  'the Relationship Manager chat opens, with nobody to write to yet');
select test.check((chat_client_conversation('RM') ->> 'id') <> (chat_client_conversation('META') ->> 'id'), 'it is a separate conversation: nothing is mixed up');
select test.check((select (a -> 'tickets' ->> 'enabled')::boolean is false and a -> 'tickets' ->> 'reason' = 'Available after your Relationship Manager is assigned.' from (select client_onboarding_journey() -> 'access' as a) x),
  'tickets wait for the Relationship Manager');
select test.must_fail($$select client_services()$$, 'services are still closed', 'Available after your Relationship Manager');

-- hand-over: consultant -> department head -> team lead -> team member (the Relationship Manager)
select test.login((select name from jyv));
select send_to_department_head((select id from jy where name = 'A'), 'Verified');
select test.login('dh_wab');
select pass_to_team_lead((select id from jy where name = 'A'), test.id('sup_th'), null);
select test.login('jy_a');
select test.check((select s ->> 'status' = 'IN_PROGRESS' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'RELATIONSHIP_MANAGER'), 'a Team Lead alone is not yet a Relationship Manager');
select test.check((select chat_client_conversation('RM') ->> 'assigned' = 'true' and (chat_client_conversation('RM') ->> 'canWrite')::boolean), 'but the Team Lead can already be written to');
select test.login('sup_th');
select assign_to_team_member((select id from jy where name = 'A'), test.id('sup_b'), null);
select test.login('jy_a');
select test.check((select s ->> 'status' = 'COMPLETED' and s -> 'manager' ->> 'name' = 'Support B' and s -> 'teamLead' ->> 'name' is not null and s ->> 'completedAt' is not null
                     from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'RELATIONSHIP_MANAGER'),
  'the Relationship Manager and Team Lead are shown by name once assigned');
select test.check((select not (s ? 'email') and not (s -> 'manager' ? 'email') and not (s -> 'manager' ? 'phone') from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'RELATIONSHIP_MANAGER'),
  'only the name and position are exposed, never an e-mail or phone');
select test.check((client_onboarding_journey() ->> 'stage') = 'SERVICE_SETUP', 'service setup is the current stage');
select test.check((client_tickets() is not null) and (client_onboarding_journey() -> 'access' -> 'tickets' ->> 'enabled')::boolean, 'tickets are open');
select test.check((select (chat_client_conversation('RM') ->> 'canWrite')::boolean), 'the client writes to the Relationship Manager');
insert into jym select 'rm_conv', chat_client_conversation('RM');
select test.check((select chat_send_message(((select data from jym where name = 'rm_conv') ->> 'id')::uuid, 'Hi, when can we start the setup?', gen_random_uuid()) ->> 'senderLabel' = 'Client'), 'and does');
select test.login('sup_b');
select test.check((select chat_customer_conversation((select id from jy where name = 'A')) ->> 'channel' = 'RM'), 'the Relationship Manager opens the RM conversation');
select test.check((select chat_send_message(((select data from jym where name = 'rm_conv') ->> 'id')::uuid, 'Hello! We will start today.', gen_random_uuid()) ->> 'senderLabel' = 'Relationship Manager'), 'and answers as Relationship Manager');
select test.check((select chat_conversation_detail(((select data from jym where name = 'meta_conv') ->> 'id')::uuid) ->> 'access' = 'STAFF'
                          and not (chat_conversation_detail(((select data from jym where name = 'meta_conv') ->> 'id')::uuid) ->> 'canWrite')::boolean), 'the Relationship Manager can read the Meta history, never write to it');
select test.login((select name from jyv));
select test.must_fail($$select chat_conversation_detail(((select data from jym where name = 'rm_conv') ->> 'id')::uuid)$$, 'the Meta Verifier cannot read the Relationship Manager chat', 'NOT_FOUND|not found');

\echo '--- 85. Journey: service setup, completion, and what opens'
select test.login('tm_a');
select test.must_fail($$select set_service_setup((select id from jy where name = 'A'), 'AI_CALLING', 'READY', null)$$, 'Sales cannot mark a service ready', 'NOT_FOUND');
select test.login('jy_a');
select test.login('sup_b');
select test.must_fail($$select set_service_setup((select id from jy where name = 'A'), 'AI_CALLING', 'PENDING', null)$$, 'a status that is not offered is refused', 'Choose');
select test.must_fail($$select set_service_setup((select id from jy where name = 'A'), 'NO_SUCH', 'READY', null)$$, 'an unknown service is refused', 'NOT_FOUND|not found');
select test.check((select set_service_setup((select id from jy where name = 'A'), 'AI_CALLING', 'IN_PROGRESS', 'Number registered') ->> 'status' = 'IN_PROGRESS'), 'the responsible team starts a service');
select test.login('jy_a');
select test.check((select s ->> 'status' = 'IN_PROGRESS' and (select count(*) = 1 from jsonb_array_elements(s -> 'services') x where x ->> 'code' = 'AI_CALLING' and x ->> 'status' = 'IN_PROGRESS' and x ->> 'note' = 'Number registered')
                          and (select count(*) = 1 from jsonb_array_elements(s -> 'services') x where x ->> 'code' = 'WHATSAPP_API_BLUE_TICK' and x ->> 'status' = 'PENDING')
                     from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'SERVICE_SETUP'), 'the client sees each service on its own');
select test.must_fail($$select client_services()$$, 'nothing is open until a service is ready', 'Available after service setup is completed');
select test.login('sup_b');
select test.check((select set_service_setup((select id from jy where name = 'A'), 'WHATSAPP_API_BLUE_TICK', 'READY', null) ->> 'status' = 'READY'), 'the WhatsApp service is made ready (its documents were authorized)');
select test.login('jy_a');
select test.check((select jsonb_array_length(client_services()) = 2 from (select 1) x), 'My Services opens when a service is ready');
select test.check((select x ->> 'status' = 'LIVE' from jsonb_array_elements(client_services()) x where x ->> 'code' = 'WHATSAPP_API_BLUE_TICK')
               and (select x ->> 'status' = 'SETTING_UP' from jsonb_array_elements(client_services()) x where x ->> 'code' = 'AI_CALLING'), 'the ready one is Live, the other still Setting up');
select test.check(jsonb_typeof(client_campaigns()) = 'array', 'Campaigns open');
select test.must_fail($$select client_service_catalog()$$, 'Explore Services waits for the whole onboarding', 'Available after onboarding is completed');
select test.must_fail($$select client_plans()$$, 'and so do Monthly Plans', 'Available after onboarding is completed');
select test.check((select s ->> 'status' = 'IN_PROGRESS' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'SERVICE_SETUP')
               and not (client_onboarding_journey() ->> 'completed')::boolean, 'one service ready is not the end of onboarding');
select test.login('sup_b');
select test.must_fail($$select set_service_setup((select id from jy where name = 'A'), 'WHATSAPP_API_BLUE_TICK', 'IN_PROGRESS', null)$$, 'a ready service cannot be reopened by the team', 'already ready|Only the Super Admin');
select test.check((select set_service_setup((select id from jy where name = 'A'), 'AI_CALLING', 'READY', null) ->> 'status' = 'READY'), 'the last service is made ready');
reset role;
select test.check((select onboarding_completed_at is not null from customer_onboarding where customer_id = (select id from jy where name = 'A')), 'onboarding completes by itself when every stage is done');
select test.check((select count(*) = 1 from customer_services where customer_id = (select id from jy where name = 'A') and service_code = 'AI_CALLING' and service_status = 'LIVE' and activated_at is not null and setup_completed_at is not null),
  'a ready service is Live with its activation date (the reminders and the calendar keep working)');
select test.check((select count(*) = 1 from audit_logs where action = 'ONBOARDING_COMPLETED' and entity_id = (select id from jy where name = 'A')), 'the completion is in the audit log');
set role authenticated;
select test.login('jy_a');
select test.check((client_onboarding_journey() ->> 'stage') = 'COMPLETED' and (client_onboarding_journey() ->> 'completed')::boolean and client_onboarding_journey() ->> 'completedAt' is not null, 'the journey is completed, with its date');
select test.check((select bool_and((v ->> 'enabled')::boolean) from jsonb_each(client_onboarding_journey() -> 'access') e(k, v)), 'every section is open');
select test.check((select jsonb_array_length(client_service_catalog()) > 0), 'Explore Services is open');
select test.check((client_plans() is not null), 'Monthly Plans are open');
select test.check((select count(*) >= 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'title' = 'Your onboarding is complete'), 'the client is told');
select test.login('tm_a');
select test.login('jy_a');
select test.check((client_onboarding_journey() ->> 'completed')::boolean, 'signing in again does not reset anything');

\echo '--- 86. Journey: a customer whose services need no Meta verification'
select test.login('sup_plain');
insert into jy select 'D', create_lead('{"name":"Journey Direct","company":"Direct Journey Co","email":"direct.journey@example.com","phone":"9819901003","leadSource":"Referral"}', array['DS_META_ADS']);
select send_lead_to_accounts((select id from jy where name = 'D'), 3000, null);
select test.login('acc_m');
select accounts_set_order_gst((select id from jy where name = 'D'), 0);
select accounts_record_payment((select id from jy where name = 'D'), 'FULL', 3000, 'CASH', null, null, null, true);
select accounts_client_login_begin((select id from jy where name = 'D'), 'direct.login@journey.example');
reset role;
select test.create_auth_user('jy_d', 'direct.login@journey.example', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from jy where name = 'D')));
set role authenticated;
select test.login('acc_m');
select record_client_account((select id from jy where name = 'D'), test.id('jy_d'), 'direct.login@journey.example');
-- before the payment is returned to Sales the journey is at payment
select test.login('jy_d');
select test.check((client_onboarding_journey() ->> 'stage') = 'PAYMENT', 'a login created at Accounts shows payment as the current stage until the payment is confirmed');
select test.must_fail($$select client_services()$$, 'and nothing else is open', 'Available after your payment is confirmed');
select test.login('acc_m');
select accounts_confirm_and_return((select id from jy where name = 'D'), null);
select test.login('jy_d');
select test.check((select s ->> 'status' = 'COMPLETED' and s ->> 'metaStatus' = 'NOT_REQUIRED' and not (s ->> 'required')::boolean from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'META_VERIFICATION'),
  'no Meta verification is needed for these services: that stage is shown as not required and done');
select test.check((select s ->> 'status' = 'COMPLETED' and s -> 'manager' ->> 'name' = 'Support Member' from jsonb_array_elements(client_onboarding_journey() -> 'stages') s where s ->> 'key' = 'RELATIONSHIP_MANAGER'),
  'the Support member who owns the customer is the Relationship Manager, so that stage is done too');
select test.check((client_onboarding_journey() ->> 'stage') = 'SERVICE_SETUP', 'the journey goes straight to service setup');
select test.must_fail($$select chat_client_conversation('META')$$, 'there is no Meta verification chat', 'no Meta verification chat');
select test.check((select (chat_client_conversation() ->> 'channel') = 'RM'), 'the client is routed to the Relationship Manager chat');
select test.must_fail($$select client_services()$$, 'services stay closed until one is set up', 'Available after service setup');
-- the delivery department sets the service up (documents authorized first)
select test.login('ds_mem');
select test.must_fail($$select set_service_setup((select id from jy where name = 'D'), 'DS_META_ADS', 'READY', null)$$, 'not before its documents are authorized', 'Authorize these first');
reset role;
update customer_onboarding_entries set status = 'VERIFIED', reviewed_at = now() where customer_id = (select id from jy where name = 'D');
insert into customer_onboarding_entries (customer_id, item_code, value, status, saved_by, reviewed_at)
  select (select id from jy where name = 'D'), i.code, 'saved', 'VERIFIED', test.id('sup_plain'), now()
    from private.customer_items((select id from jy where name = 'D')) i on conflict (customer_id, item_code) do update set status = 'VERIFIED';
set role authenticated;
select test.login('ds_mem');
select test.check((select set_service_setup((select id from jy where name = 'D'), 'DS_META_ADS', 'READY', 'Campaign live') ->> 'status' = 'READY'), 'the delivery department makes it ready');
reset role;
select test.check((select onboarding_completed_at is not null from customer_onboarding where customer_id = (select id from jy where name = 'D')), 'and onboarding completes');
set role authenticated;
select test.login('jy_d');
select test.check((client_onboarding_journey() ->> 'completed')::boolean and (select bool_and((v ->> 'enabled')::boolean) from jsonb_each(client_onboarding_journey() -> 'access') e(k, v)), 'everything opens');

\echo '--- 87. Journey: every closed function is gated, and legacy customers are untouched'
reset role;
select test.check((select count(*) = 0 from (values ('client_services'), ('client_campaigns'), ('client_calendar'), ('client_service_catalog'), ('client_service_requests'),
                   ('client_request_service'), ('client_cancel_service_request'), ('client_plans'), ('client_request_plan'), ('client_tickets'), ('client_ticket'),
                   ('client_create_ticket'), ('client_reply_ticket'), ('client_send_ticket_message'), ('client_ticket_seen'), ('ticket_attachments'),
                   ('ticket_begin_upload'), ('ticket_abort_upload'), ('ticket_pending_upload'), ('ticket_complete_upload'), ('ticket_attachment_download')) g(n)
                   where not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = g.n and p.prosrc like '%require_client_section%')),
  'every closed-section function checks the stage first (a later migration that replaces one would show up here)');
select test.check((select count(*) = 0 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
                    where s.nspname = 'private' and p.proname like 'open\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
  'the original functions behind the gates cannot be called by clients');
select test.check((select count(*) = 0 from customer_services where setup_status is null), 'every service has a setup status');
select test.check((select count(*) = 0 from customer_onboarding where meta_status not in ('PENDING', 'IN_PROGRESS', 'DOCUMENTS_REQUIRED', 'REJECTED', 'COMPLETED')), 'the Meta status is always one of the five');
set role authenticated;
select test.login('cdash_a');
select test.check((client_onboarding_journey() ->> 'completed')::boolean and (select bool_and((v ->> 'enabled')::boolean) from jsonb_each(client_onboarding_journey() -> 'access') e(k, v)),
  'a client who was already working with the dashboard keeps every section');
select test.check(jsonb_array_length(client_services()) >= 2 and (select bool_and(x ->> 'status' = 'LIVE') from jsonb_array_elements(client_services()) x), 'and their services stay Live');
reset role;
\echo '--- 80-87 done'
