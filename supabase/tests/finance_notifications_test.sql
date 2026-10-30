-- =============================================================================
-- Migrations 20261209000300 (Department Head e-mails for revenue and expenses) and 20261209000400 (one expense, several departments).
-- Runs late on the same database, with departments and heads of its own (so other suites' data cannot change the answers):
--   FinX Alpha: a Sales head, a Support head and a head without a side;  FinX Beta: one head;  FinX Gamma: one head;  FinX Empty: no head.
-- Users: acc_m (Accounts), tm_a (Sales).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 81. Department Head e-mails and multi-department expenses'
reset role;
\i supabase/migrations/20261209000300_finance_department_mail.sql
\i supabase/migrations/20261209000400_expense_allocations.sql

create temp table fn (name text primary key, id uuid);
grant all on fn to authenticated, service_role;
insert into departments (slug, name, description) values ('finx-alpha', 'FinX Alpha', ''), ('finx-beta', 'FinX Beta', ''), ('finx-gamma', 'FinX Gamma', ''), ('finx-empty', 'FinX Empty', '');
select test.create_auth_user('fx_a_sales', 'fx.a.sales@amuwa.com', '{"full_name":"Alpha Sales Head"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('finx-alpha'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('fx_a_sup', 'fx.a.sup@amuwa.com', '{"full_name":"Alpha Support Head"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('finx-alpha'), 'provisioned_head_division', 'SUPPORT'));
select test.create_auth_user('fx_b', 'fx.b@amuwa.com', '{"full_name":"Beta Head"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('finx-beta')));
select test.create_auth_user('fx_g', 'fx.g@amuwa.com', '{"full_name":"Gamma Head"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('finx-gamma')));
set role authenticated;
select test.login('tm_a');
insert into fn select 'c1', create_lead('{"name":"Fin One","company":"Fin One Traders","email":"fin.one@example.com","phone":"9819960001","leadSource":"Walk-in"}', array['WHATSAPP_API']);
insert into fn select 'c2', create_lead('{"name":"Fin Two","company":"Fin Two Co","email":"fin.two@example.com","phone":"9819960002","leadSource":"Walk-in"}', array['WHATSAPP_API']);
reset role;
update customers set deal_amount = 10000 where id in (select id from fn);
-- the department an order earns for is its attribution (the customers' own department is the Wabastore owner team): c1 is an original sale
-- attributed to FinX Alpha's Sales side
insert into revenue_attributions (order_key, customer_id, division, department_id, source) values ('SALE:' || (select id from fn where name = 'c1'), (select id from fn where name = 'c1'), 'SALES', test.dept('finx-alpha'), 'MANUAL')
  on conflict (order_key) do update set division = 'SALES', department_id = test.dept('finx-alpha');

\echo '   the recipients are the live, active Department Heads of the right side'
select test.check((select array_agg(email order by email) from private.department_head_recipients(test.dept('finx-alpha'), 'SALES')) = array['fx.a.sales@amuwa.com'], 'FinX Alpha, Sales side: its Sales head');
select test.check((select array_agg(email order by email) from private.department_head_recipients(test.dept('finx-alpha'), 'SUPPORT')) = array['fx.a.sup@amuwa.com'], 'Support side: its Support head');
select test.check((select array_agg(email order by email) from private.department_head_recipients(test.dept('finx-alpha'))) = array['fx.a.sales@amuwa.com', 'fx.a.sup@amuwa.com'], 'no side given: both');
select test.check((select array_agg(email) from private.department_head_recipients(test.dept('finx-beta'), 'SUPPORT')) = array['fx.b@amuwa.com'], 'a head without a side belongs to both sides');
select test.check((select count(*) = 0 from private.department_head_recipients(test.dept('finx-empty'))), 'a department without a head has no recipient');

\echo '   a pending payment: "pending verification", never collected'
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source) values ((select id from fn where name = 'c1'), 'PART', 4000, 'UPI', 'FIN-1-SECRETREF', 'PENDING', 'ACCOUNTS');
select test.check((select count(*) = 1 and bool_and(kind = 'PAYMENT_RECORDED' and recipient_email = 'fx.a.sales@amuwa.com' and status = 'QUEUED' and department_id = test.dept('finx-alpha'))
                     from finance_mail_events where customer_id = (select id from fn where name = 'c1')), 'the Sales head of the department that earns it gets one pending-payment e-mail');
select test.check((select payload ->> 'status' = 'PENDING_VERIFICATION' and (payload ->> 'amount')::numeric = 4000 and payload -> 'verifiedAmount' = 'null'::jsonb and payload ->> 'customer' = 'Fin One Traders'
                          and payload ->> 'orderRef' like 'Order of CUS-%' and payload ->> 'services' = 'WhatsApp API'
                     from finance_mail_events where customer_id = (select id from fn where name = 'c1') limit 1), 'it says pending, with the amount recorded and nothing verified');
select test.check((select payload::text !~ 'FIN-1-SECRETREF|9819960001|fin.one@example' from finance_mail_events where customer_id = (select id from fn where name = 'c1') limit 1), 'and carries no payment reference, phone or customer e-mail');

\echo '   verification: one verified e-mail, never two for the same event'
update customer_payments set status = 'VERIFIED', verified_at = now() where reference = 'FIN-1-SECRETREF';
select test.check((select count(*) = 1 and bool_and(payload ->> 'status' = 'VERIFIED' and (payload ->> 'verifiedAmount')::numeric = 4000)
                     from finance_mail_events where kind = 'PAYMENT_VERIFIED' and customer_id = (select id from fn where name = 'c1')), 'verifying it sends the verified e-mail with the verified amount');
update customer_payments set status = 'VERIFIED' where reference = 'FIN-1-SECRETREF';
update customer_payments set status = 'PENDING' where reference = 'FIN-1-SECRETREF';
update customer_payments set status = 'VERIFIED' where reference = 'FIN-1-SECRETREF';
select test.check((select count(*) = 2 from finance_mail_events where customer_id = (select id from fn where name = 'c1')), 'verifying again (a repeat, or a reversal and re-verification) queues nothing more');
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source) values ((select id from fn where name = 'c1'), 'PART', 1500, 'UPI', 'FIN-1-B', 'VERIFIED', 'ACCOUNTS');
select test.check((select count(*) = 1 and bool_and(kind = 'PAYMENT_VERIFIED') from finance_mail_events where customer_id = (select id from fn where name = 'c1') and payload ->> 'amount' = '1500.00'), 'recorded and verified in one step: only the verified e-mail');
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source) values ((select id from fn where name = 'c1'), 'PART', 100, 'UPI', 'FIN-1-OLD', 'VERIFIED', 'LEGACY');
select test.check((select count(*) = 0 from finance_mail_events where payload ->> 'amount' = '100.00'), 'a payment brought in from older records sends nothing');

\echo '   the department is the one the ORDER is attributed to, not the customer''s current department'
insert into revenue_attributions (order_key, customer_id, division, department_id, source) values ('SALE:' || (select id from fn where name = 'c2'), (select id from fn where name = 'c2'), 'SUPPORT', test.dept('finx-alpha'), 'MANUAL')
  on conflict (order_key) do update set division = 'SUPPORT', department_id = test.dept('finx-alpha');
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source) values ((select id from fn where name = 'c2'), 'PART', 2500, 'UPI', 'FIN-2-A', 'VERIFIED', 'ACCOUNTS');
select test.check((select array_agg(recipient_email) = array['fx.a.sup@amuwa.com'] and bool_and(department_id = test.dept('finx-alpha'))
                     from finance_mail_events where customer_id = (select id from fn where name = 'c2')), 'an order attributed to FinX Alpha Support goes to Alpha''s Support head - not to the customer''s own department (Wabastore) and not to Alpha''s Sales head');

\echo '   add-on and invoice payments are covered the same way (the trigger runs on all three payment tables)'
reset role;
insert into addon_requests (customer_id, status, total) values ((select id from fn where name = 'c1'), 'INVOICE_GENERATED', 900) returning id \gset ao_
insert into revenue_attributions (order_key, customer_id, division, department_id, source) values ('ADDON:' || :'ao_id', (select id from fn where name = 'c1'), 'SUPPORT', test.dept('finx-alpha'), 'MANUAL')
  on conflict (order_key) do update set division = 'SUPPORT', department_id = test.dept('finx-alpha');
insert into addon_payments (request_id, customer_id, amount, method, reference, status) values (:'ao_id', (select id from fn where name = 'c1'), 900, 'UPI', 'FIN-AO-SECRETREF', 'PENDING');
select test.check((select count(*) = 1 and bool_and(kind = 'PAYMENT_RECORDED' and recipient_email = 'fx.a.sup@amuwa.com' and (payload ->> 'amount')::numeric = 900 and payload ->> 'paymentType' = 'ADDON' and payload::text !~ 'FIN-AO-SECRETREF')
                     from finance_mail_events where payload ->> 'orderRef' like 'Add-on of %' and customer_id = (select id from fn where name = 'c1')), 'an add-on payment e-mails the Support head it is attributed to (no payment reference in it)');
update addon_payments set status = 'VERIFIED', verified_at = now() where reference = 'FIN-AO-SECRETREF';
select test.check((select count(*) = 1 from finance_mail_events where kind = 'PAYMENT_VERIFIED' and payload ->> 'orderRef' like 'Add-on of %' and customer_id = (select id from fn where name = 'c1')), 'verifying it sends one verified e-mail');
update addon_payments set status = 'REJECTED' where reference = 'FIN-AO-SECRETREF';
select test.check((select count(*) = 2 from finance_mail_events where payload ->> 'orderRef' like 'Add-on of %' and customer_id = (select id from fn where name = 'c1')), 'a rejection sends nothing');
insert into member_invoices (invoice_number, customer_name, customer_id, status, amount) values ('FINX-INV-1', 'Fin One', (select id from fn where name = 'c1'), 'Pending', 600) returning id \gset inv_
insert into invoice_payments (invoice_id, customer_id, request_id, payment_type, amount, method, reference, paid_on, status) values (:'inv_id', (select id from fn where name = 'c1'), gen_random_uuid(), 'FULL', 600, 'UPI', 'FIN-INV-REF', current_date, 'VERIFIED');
select test.check((select count(*) >= 1 and count(*) = count(distinct recipient_email) and bool_and(kind = 'PAYMENT_VERIFIED' and (payload ->> 'amount')::numeric = 600 and payload ->> 'orderRef' = 'Invoice FINX-INV-1')
                     from finance_mail_events where payload ->> 'orderRef' like 'Invoice FINX-INV-1%' and customer_id = (select id from fn where name = 'c1')), 'a verified invoice payment e-mails each responsible head once, naming the invoice');

\echo '   no active head: nothing is sent, Accounts can see why, the Super Admin is told, and a retry works once there is a head'
reset role;
update profiles set status = 'SUSPENDED' where email = 'fx.a.sales@amuwa.com';
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source) values ((select id from fn where name = 'c1'), 'PART', 700, 'UPI', 'FIN-1-C', 'VERIFIED', 'ACCOUNTS');
select test.check((select count(*) = 1 and bool_and(status = 'NO_RECIPIENT' and recipient_email is null and detail like '%no active Department Head%')
                     from finance_mail_events where payload ->> 'amount' = '700.00'), 'the department has no active head on that side: one NO_RECIPIENT row, nothing queued for anyone');
select test.check((select count(*) >= 1 from notifications where type = 'FINANCE_MAIL_NO_RECIPIENT' and recipient_id = test.id('sa')), 'the Super Admin is notified (the escalation path)');
create temp table fn_ev as select id from finance_mail_events where payload ->> 'amount' = '700.00';
grant all on fn_ev to authenticated;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_finance_mail_retry((select id from fn_ev))$$, 'a retry with still no head is refused', 'still has no active Department Head');
reset role;
update profiles set status = 'ACTIVE' where email = 'fx.a.sales@amuwa.com';
set role authenticated;
select test.login('acc_m');
select test.check((accounts_finance_mail_retry((select id from fn_ev)) ->> 'queued')::int = 1, 'once a head is active, the retry queues the e-mail');
reset role;
select test.check((select count(*) = 1 from finance_mail_events where payload ->> 'amount' = '700.00' and status = 'QUEUED' and recipient_email = 'fx.a.sales@amuwa.com')
               and (select status = 'CANCELLED' from finance_mail_events where payload ->> 'amount' = '700.00' and recipient_email is null), 'and the recipient-less row is closed');

\echo '   a failure to queue never undoes the payment'
alter table finance_mail_events rename to finance_mail_events_hidden;
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source) values ((select id from fn where name = 'c1'), 'PART', 333, 'UPI', 'FIN-1-D', 'VERIFIED', 'ACCOUNTS');
alter table finance_mail_events_hidden rename to finance_mail_events;
select test.check((select count(*) = 1 from customer_payments where reference = 'FIN-1-D'), 'the payment is saved even though its e-mail could not be queued');

\echo '   sending: claim, retry with back-off, failure, and who may see it'
-- (other suites queued e-mails of their own: leave those out of this check)
update finance_mail_events set status = 'CANCELLED', detail = 'left out of the sender test' where status = 'QUEUED' and coalesce(payload ->> 'customer', '') not like 'Fin %';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
set role service_role;
create temp table fn_claim (j jsonb);
grant all on fn_claim to service_role;
insert into fn_claim select jsonb_array_elements(finance_mail_claim(50, 'live'));
reset role;
select test.check((select count(*) >= 3 from fn_claim where j ->> 'to' is not null and j -> 'payload' ->> 'customer' is not null), 'the sender claims the queued e-mails with recipient and payload');
select test.check((select count(*) = (select count(*) from fn_claim) from finance_mail_events where status = 'SENDING'), 'each claimed e-mail is now being sent (a second claim cannot take it)');
set role service_role;
select test.check((select jsonb_array_length(finance_mail_claim(50, 'live')) = 0), 'a second claim gets nothing');
select finance_mail_finish((select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sales@amuwa.com' limit 1), 'SENT', 'ok', 200, 'msg-1');
select finance_mail_finish((select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sup@amuwa.com' limit 1), 'RETRY', 'HTTP 503', 503);
reset role;
select test.check((select status = 'SENT' and sent_at is not null from finance_mail_events where id = (select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sales@amuwa.com' limit 1)), 'a sent e-mail records when');
select test.check((select status = 'QUEUED' and next_attempt_at > now() and attempts = 1 from finance_mail_events where id = (select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sup@amuwa.com' limit 1)), 'a provider failure waits for a retry');
update finance_mail_events set status = 'SENDING', attempts = 5, locked_until = now() + interval '5 minutes' where id = (select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sup@amuwa.com' limit 1);
set role service_role;
select finance_mail_finish((select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sup@amuwa.com' limit 1), 'RETRY', 'HTTP 503', 503);
reset role;
select test.check((select status = 'FAILED' from finance_mail_events where id = (select (j ->> 'id')::uuid from fn_claim where j ->> 'to' = 'fx.a.sup@amuwa.com' limit 1)), 'after five attempts it is FAILED');
select test.check((select count(*) >= 1 from notifications where type = 'AUTOMATION_FAILED' and recipient_id = test.id('acc_m') and title like 'Department e-mail not sent%'), 'and Accounts is told');
create temp table fn_ev2 as select (select id from finance_mail_events where status = 'FAILED' limit 1) failed, (select id from finance_mail_events where status = 'SENT' limit 1) sent;
grant all on fn_ev2 to authenticated;
set role authenticated;
select test.login('acc_m');
select test.check((accounts_finance_mail_list('FAILED') -> 'items' -> 0 ->> 'canRetry')::boolean and (accounts_finance_mail_list() -> 'counts' ->> 'SENT')::int >= 1, 'Accounts sees each e-mail with its status and can retry a failed one');
select test.check((accounts_finance_mail_retry((select failed from fn_ev2)) ->> 'queued')::int = 1, 'a failed e-mail can be sent again');
select test.must_fail($$select accounts_finance_mail_retry((select sent from fn_ev2))$$, 'a sent one cannot', 'Only a failed');
select test.login('tm_a');
select test.must_fail($$select accounts_finance_mail_list()$$, 'Sales cannot see them', 'Only the Accounts department');
select test.login('fx_a_sales');
select test.must_fail($$select accounts_finance_mail_retry(gen_random_uuid())$$, 'nor can a Department Head retry', 'Only the Accounts department');
select test.must_fail($$select * from finance_mail_events$$, 'the table is closed to everyone', 'permission denied');
select test.must_fail($$select finance_mail_claim()$$, 'only the sender may claim', 'permission denied');
reset role;

-- =============================================================================
\echo '   one expense, three departments'
create temp table ex (name text primary key, id uuid, payload jsonb);
grant all on ex to authenticated;
set role authenticated;
select test.login('acc_m');
create temp table ex_req as select gen_random_uuid() r1, gen_random_uuid() r2, gen_random_uuid() r3, gen_random_uuid() r4;
grant all on ex_req to authenticated;
insert into ex (name, payload) select 'split', accounts_add_expense_split((select r1 from ex_req), current_date, 'Joint campaign', 'Marketing', 40000, 'PAID', 'for three departments',
  jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 10000), jsonb_build_object('departmentId', test.dept('finx-beta'), 'amount', 10000),
                    jsonb_build_object('departmentId', test.dept('finx-gamma'), 'amount', 20000)));
reset role;
update ex set id = (payload ->> 'id')::uuid where name = 'split';
select test.check((select count(*) = 1 from department_expenses where id = (select id from ex where name = 'split') and amount = 40000 and department_id is null), 'the expense is stored ONCE, with the full 40,000');
select test.check((select count(*) = 3 and sum(amount) = 40000 from expense_allocations where expense_id = (select id from ex where name = 'split')), 'with three allocations that add up to it');
select test.check((select (select amount from expense_allocations where expense_id = (select id from ex where name = 'split') and department_id = test.dept('finx-alpha')) = 10000
                      and (select amount from expense_allocations where expense_id = (select id from ex where name = 'split') and department_id = test.dept('finx-gamma')) = 20000), 'Alpha 10,000, Gamma 20,000');
select test.check((select count(*) = 1 from audit_logs where action = 'EXPENSE_ADDED' and entity_id = (select id from ex where name = 'split') and metadata -> 'allocations' is not null), 'the audit keeps the split');

\echo '   validation (the server recalculates; the browser is not trusted)'
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 40000, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 10000), jsonb_build_object('departmentId', test.dept('finx-beta'), 'amount', 29999)))$$, 'a split that does not add up is refused', 'must be equal');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 100, 'PAID', null, null)$$, 'a missing allocation list is refused', 'at least one department');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', gen_random_uuid(), 'amount', 100)))$$, 'an unknown department is refused', 'from the list');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 0), jsonb_build_object('departmentId', test.dept('finx-beta'), 'amount', 100)))$$, 'a zero amount is refused', 'above zero');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', -5), jsonb_build_object('departmentId', test.dept('finx-beta'), 'amount', 105)))$$, 'a negative amount is refused', 'above zero');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 33.333), jsonb_build_object('departmentId', test.dept('finx-beta'), 'amount', 66.667)))$$, 'three decimals are refused', '2 decimal');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('amount', 100)))$$, 'a row without a department is refused', 'department and an amount');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Bad', 'Marketing', 0, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 100)))$$, 'a zero expense is refused', 'Enter the amount');
select test.login('tm_a');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'Sales', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 100)))$$, 'Sales cannot record expenses', 'Only the Accounts department');
select test.login('fx_a_sales');
select test.must_fail($$select accounts_add_expense_split(gen_random_uuid(), current_date, 'DH', 'Marketing', 100, 'PAID', null, jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 100)))$$, 'nor a Department Head', 'Only the Accounts department');
select test.login('acc_m');
-- the same department twice is one department
select accounts_add_expense_split((select r2 from ex_req), current_date, 'Twice', 'Marketing', 9000, 'PENDING', null,
  jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 4000), jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 5000)));
reset role;
select test.check((select count(*) = 1 and sum(amount) = 9000 from expense_allocations where expense_id = (select id from department_expenses where request_id = (select r2 from ex_req))), 'the same department twice is combined into one row of 9,000');
select test.check((select department_id = test.dept('finx-alpha') from department_expenses where request_id = (select r2 from ex_req)), 'a one-department split keeps its department_id (the older screens still work)');
select test.check((select count(*) = 0 from department_expenses where description = 'Bad'), 'none of the refused requests left anything behind');

-- no rows = a company-wide expense, stored once with no allocation
set role authenticated;
select test.login('acc_m');
select accounts_add_expense_split(gen_random_uuid(), current_date, 'Company wide', 'Rent', 500, 'PAID', null, '[]'::jsonb);
reset role;
select test.check((select count(*) = 1 and bool_and(department_id is null) from department_expenses where description = 'Company wide') and (select count(*) = 0 from expense_allocations where expense_id = (select id from department_expenses where description = 'Company wide')), 'no department rows: a company-wide expense with no allocation');
set role authenticated;
select test.login('acc_m');

\echo '   a repeated request is the same expense'
set role authenticated;
select test.login('acc_m');
select test.check((accounts_add_expense_split((select r1 from ex_req), current_date, 'Joint campaign', 'Marketing', 40000, 'PAID', 'for three departments',
  jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 10000), jsonb_build_object('departmentId', test.dept('finx-beta'), 'amount', 10000),
                    jsonb_build_object('departmentId', test.dept('finx-gamma'), 'amount', 20000))) ->> 'replayed')::boolean, 'the same request again returns the same expense');
reset role;
select test.check((select count(*) = 1 from department_expenses where description = 'Joint campaign') and (select count(*) = 3 from expense_allocations where expense_id = (select id from ex where name = 'split')), 'and creates nothing new');

\echo '   each department''s head gets one e-mail with only its own part'
select test.check((select count(*) from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex where name = 'split') and department_id = test.dept('finx-alpha'))
                 = (select count(*) from private.department_head_recipients(test.dept('finx-alpha'))), 'FinX Alpha: one e-mail per active Department Head');
select test.check((select bool_and((payload ->> 'allocated')::numeric = 10000 and payload ->> 'department' = 'FinX Alpha' and payload::text !~ '40000|20000|FinX Beta|FinX Gamma')
                     from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex where name = 'split') and department_id = test.dept('finx-alpha')), 'FinX Alpha''s e-mail says 10,000 and does not show the other departments or the total');
select test.check((select count(distinct department_id) = 3 from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex where name = 'split')), 'all three departments were told');
select test.check((select bool_and((payload ->> 'allocated')::numeric = 20000) from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex where name = 'split') and department_id = test.dept('finx-gamma')), 'FinX Gamma: 20,000');
select test.check((select count(*) = 0 from finance_mail_events where kind = 'EXPENSE_ADDED' and recipient_email is not null and recipient_email not in (select email from profiles where role = 'DEPARTMENT_HEAD')), 'only Department Heads were addressed');

\echo '   reports: each department its own part, the company the expense once'
set role authenticated;
select test.login('acc_m');
create temp table fb as select accounts_finance_by_department() r;
grant all on fb to authenticated;
reset role;
create temp table fb_truth as select (select sum(amount) from department_expenses where expense_date = current_date) company_total,
  (select sum(a.amount) from expense_allocations a join department_expenses e on e.id = a.expense_id where e.expense_date = current_date
     and a.department_id in (test.dept('finx-alpha'), test.dept('finx-beta'), test.dept('finx-gamma'))) three;
grant all on fb_truth to authenticated;
set role authenticated;
select test.login('acc_m');
select test.check((select (x ->> 'expenses')::numeric >= 10000 from fb, jsonb_array_elements(r) x where x ->> 'slug' = 'finx-alpha'), 'FinX Alpha carries its 10,000 (plus any later expenses)');
select test.check((accounts_finance_summary(test.dept('finx-gamma'), current_date, current_date) ->> 'expenses')::numeric = 20000, 'a department''s summary is only its allocated part (FinX Gamma 20,000)');
select test.check((accounts_finance_summary(test.dept('finx-beta'), current_date, current_date) ->> 'expenses')::numeric = 10000, 'FinX Beta 10,000');
select test.check((select (accounts_finance_summary(null, current_date, current_date) ->> 'expenses')::numeric
                   = (select company_total from fb_truth)), 'the company total is every expense once at its full amount (the 40,000 is one expense, not 40,000 three times)');
select test.check((select (accounts_finance_summary(test.dept('finx-alpha'), current_date, current_date) ->> 'expenses')::numeric + (accounts_finance_summary(test.dept('finx-beta'), current_date, current_date) ->> 'expenses')::numeric
                          + (accounts_finance_summary(test.dept('finx-gamma'), current_date, current_date) ->> 'expenses')::numeric
                     = (select three from fb_truth)), 'the three departments add up to their allocations');
select test.check((select jsonb_array_length(i -> 'allocations') = 3 and (i ->> 'amount')::numeric = 40000 from jsonb_array_elements(accounts_expenses_list(null, null, false, null, null, current_date, current_date) -> 'items') i where i ->> 'description' = 'Joint campaign'), 'the list shows the one expense with its three allocations');
select test.check((select (i ->> 'allocatedToFilter')::numeric = 10000 from jsonb_array_elements(accounts_expenses_list(null, test.dept('finx-alpha'), false, null, null, current_date, current_date) -> 'items') i where i ->> 'description' = 'Joint campaign'), 'filtered by FinX Alpha it shows its 10,000');
select test.check((select not exists (select 1 from jsonb_array_elements(accounts_expenses_list(null, null, true, null, null, current_date, current_date) -> 'items') i where i ->> 'description' = 'Joint campaign')), 'the company-wide filter does not include a split expense');
reset role;

\echo '   editing, the older functions, delete, imports'
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_update_expense((select id from ex where name = 'split'), current_date, 'Joint campaign', test.dept('finx-alpha'), 'Marketing', 40000, 'PAID', null)$$, 'the older single-department edit refuses a split expense', 'split across departments');
select accounts_update_expense_split((select id from ex where name = 'split'), current_date, 'Joint campaign', 'Marketing', 30000, 'PAID', null,
  jsonb_build_array(jsonb_build_object('departmentId', test.dept('finx-alpha'), 'amount', 10000), jsonb_build_object('departmentId', test.dept('finx-empty'), 'amount', 20000)));
reset role;
select test.check((select count(*) = 2 and sum(amount) = 30000 from expense_allocations where expense_id = (select id from ex where name = 'split')) and (select amount = 30000 from department_expenses where id = (select id from ex where name = 'split')), 'an edit replaces the allocations in one go');
select test.check((select count(*) = 1 and bool_and(status = 'NO_RECIPIENT') from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex where name = 'split') and department_id = test.dept('finx-empty')), 'a department added by the edit that has no head: a recipient-less row, not a lost one');
select test.check((select count(*) = (select count(*) from private.department_head_recipients(test.dept('finx-alpha'))) from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex where name = 'split') and department_id = test.dept('finx-alpha')), 'and nobody is told twice');
select test.must_fail($$set constraints all immediate; update department_expenses set amount = 99999 where id = (select id from ex where name = 'split')$$, 'the amount cannot be changed behind the allocations (database rule)', 'must add up');
select test.must_fail($$set constraints all immediate; insert into expense_allocations (expense_id, department_id, amount) values ((select id from ex where name = 'split'), test.dept('finx-beta'), 5)$$, 'nor an allocation added that breaks the total', 'must add up');
-- the older single-department way still works and keeps its allocation and e-mail
set role authenticated;
select test.login('acc_m');
create temp table ex_old as select accounts_add_expense(current_date, 'Old way', test.dept('finx-beta'), 'Office', 1234.50, 'PAID', null) id;
grant all on ex_old to authenticated;
reset role;
select test.check((select count(*) = 1 and sum(amount) = 1234.50 from expense_allocations where expense_id = (select id from ex_old)), 'an expense added the older way gets its one allocation');
select test.check((select count(*) >= 1 from finance_mail_events where kind = 'EXPENSE_ADDED' and event_token = (select id::text from ex_old)), 'and its head is told');
insert into department_expenses (expense_date, description, department_id, category, amount, source, external_id) values (current_date, 'From a sheet', test.dept('finx-beta'), 'Office', 777, 'GOOGLE_SHEET', 'row-1');
select test.check((select count(*) = 1 from expense_allocations where expense_id = (select id from department_expenses where external_id = 'row-1')) and (select count(*) = 0 from finance_mail_events where payload ->> 'description' = 'From a sheet'), 'an imported expense is allocated but sends no e-mail');
set role authenticated;
select test.login('acc_m');
select accounts_delete_expense((select id from ex where name = 'split'));
reset role;
select test.check((select count(*) = 0 from expense_allocations where expense_id = (select id from ex where name = 'split')) and (select count(*) = 0 from department_expenses where id = (select id from ex where name = 'split')), 'deleting an expense removes its allocations');
select test.check((select count(*) = 0 from expense_allocations a where not exists (select 1 from department_expenses e where e.id = a.expense_id)), 'no allocation is left without its expense');
select test.check((select count(*) = 0 from (select e.id from department_expenses e join expense_allocations a on a.expense_id = e.id group by e.id, e.amount having sum(a.amount) <> e.amount) x), 'every allocated expense adds up exactly');

\echo '   nobody reads or writes the allocations directly'
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select * from expense_allocations$$, 'the table is closed', 'permission denied');
select test.must_fail($$insert into expense_allocations (expense_id, department_id, amount) values (gen_random_uuid(), test.dept('finx-alpha'), 1)$$, 'and cannot be written', 'permission denied');
reset role;

\echo '   running the migrations again changes nothing'
create temp table fn_before as select (select count(*) from expense_allocations) a, (select count(*) from finance_mail_events) m, (select count(*) from department_expenses) e;
\i supabase/migrations/20261209000300_finance_department_mail.sql
\i supabase/migrations/20261209000400_expense_allocations.sql
select test.check((select a = (select count(*) from expense_allocations) and m = (select count(*) from finance_mail_events) and e = (select count(*) from department_expenses) from fn_before), 'the same allocations, e-mails and expenses');
