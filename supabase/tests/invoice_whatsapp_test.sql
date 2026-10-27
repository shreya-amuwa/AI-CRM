-- =============================================================================
-- Invoice by WhatsApp (migration 20261129000100): settings, idempotent requests, permissions, claim / finish / delivery reports, retries.
-- Runs after the invoice suites (same database): it reuses the paid, stored invoice that those suites leave behind. Nothing is sent: the
-- "provider" is whatever the test records through invoice_whatsapp_finish.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 60. Invoice WhatsApp'
reset role;
create temp table w (k text primary key, v text);
grant all on w to authenticated, service_role;
-- the paid invoice with a stored PDF, one that is paid but has no PDF yet, and one that is not paid
insert into w select 'paid', invoice_id::text from generated_invoices where lifecycle = 'PAID' and paid_pdf_status = 'STORED' order by created_at limit 1;
insert into w select 'nopdf', invoice_id::text from generated_invoices where lifecycle = 'PAID' and paid_pdf_status <> 'STORED' order by created_at limit 1;
insert into w select 'unpaid', invoice_id::text from generated_invoices where lifecycle = 'ISSUED' order by created_at limit 1;
insert into w select 'cust', customer_id::text from generated_invoices where invoice_id = (select v::uuid from w where k = 'paid');
insert into w select 'phone', phone from customers where id = (select v::uuid from w where k = 'cust');
insert into w select 'invoices_before', count(*)::text from generated_invoices;
insert into w select 'total', total_amount::text from generated_invoices where invoice_id = (select v::uuid from w where k = 'paid');
create or replace function pg_temp.g(p text) returns text language sql as $$ select v from w where k = p $$;
select test.check(pg_temp.g('paid') is not null and pg_temp.g('nopdf') is not null and pg_temp.g('unpaid') is not null, 'fixtures: a paid + stored invoice, a paid one without PDF, an unpaid one');

-- ---------------------------------------------------------------- settings
select test.check((select not enabled and not auto_send and not template_approved and template_name is null from invoice_whatsapp_settings), 'everything starts switched off, with no template');
set role authenticated;
select test.login('acc_m');
select test.check((select (invoice_whatsapp_settings_get() ->> 'enabled')::boolean = false and (invoice_whatsapp_settings_get() ->> 'canEdit')::boolean = false), 'Accounts staff can read the settings, but a member cannot edit them');
select test.must_fail($$select set_invoice_whatsapp_settings(true, false, 'invoice_paid', 'en', true)$$, 'an Accounts member cannot change the settings', 'Only the Super Admin or the Accounts Department Head');
select test.login('tm_a');
select test.must_fail($$select invoice_whatsapp_settings_get()$$, 'a salesperson cannot read the settings', 'Only the Accounts department');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid)$$, 'nor request a WhatsApp invoice', 'Only the Accounts department');
select test.must_fail($$select accounts_invoice_whatsapp_history(pg_temp.g('paid')::uuid)$$, 'nor read the history', 'Only the Accounts department');
select test.login('inv_cl_p');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid)$$, 'a client login cannot request one', 'Only the Accounts department');
select test.login('sa');
select test.must_fail($$select set_invoice_whatsapp_settings(true, false, 'Invoice Paid!', 'en', false)$$, 'a template name must be lower case letters, digits and underscores', 'lower case');
select test.must_fail($$select set_invoice_whatsapp_settings(true, false, null, 'en', true)$$, 'approval needs a template name', 'Enter the template name');
select test.must_fail($$select set_invoice_whatsapp_settings(true, false, 'invoice_paid', 'english', false)$$, 'the language is checked', 'language');

-- ---------------------------------------------------------------- requests while switched off
select test.login('acc_m');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid)$$, 'switched off: a manual request says so', 'switched off');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'AUTO') ->> 'requested')::boolean = false), 'switched off: an automatic request quietly does nothing');
reset role;
select test.check((select count(*) = 0 from invoice_whatsapp_dispatches), 'nothing was recorded');
set role authenticated;
select test.login('sa');
select test.check((select (set_invoice_whatsapp_settings(true, true, 'invoice_paid', 'en', false) ->> 'enabled')::boolean), 'the Super Admin switches it on with a template that is not approved yet');
select test.check((select (set_invoice_whatsapp_settings(false, true, 'invoice_paid', 'en', false) ->> 'autoSend')::boolean = false), 'automatic sending cannot stay on when the feature is off');
select set_invoice_whatsapp_settings(true, true, 'invoice_paid', 'en', false);
reset role;
select test.check((select count(*) = 3 from audit_logs where action = 'INVOICE_WHATSAPP_SETTINGS_CHANGED'), 'settings changes are audited');

-- ---------------------------------------------------------------- what may be requested
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('unpaid')::uuid)$$, 'an unpaid invoice is never sent', 'payment is not confirmed');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('nopdf')::uuid)$$, 'a paid invoice without its PDF is not sent', 'PDF is not ready');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'UNPAID')$$, 'only the paid stage exists', 'Only the paid invoice');
select test.must_fail($$select accounts_invoice_whatsapp_request(gen_random_uuid())$$, 'an unknown invoice is refused', 'not found');
reset role;
update customers set phone = '12345', whatsapp = null where id = pg_temp.g('cust')::uuid;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid)$$, 'no valid number: refused with the reason', 'no valid WhatsApp or mobile number');
reset role;
update customers set phone = pg_temp.g('phone') where id = pg_temp.g('cust')::uuid;

-- ---------------------------------------------------------------- idempotency
set role authenticated;
select test.login('acc_m');
create temp table rq as select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid) as j;
grant all on rq to authenticated, service_role;
select test.check((select (j ->> 'requested')::boolean and not (j ->> 'replayed')::boolean and j #>> '{dispatch,status}' = 'PENDING' and j #>> '{dispatch,recipient}' like '+91XXXXXX%'
                          and j #>> '{dispatch,trigger}' = 'MANUAL' from rq), 'a request creates one PENDING dispatch, with the number masked');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid) ->> 'replayed')::boolean), 'a second click returns the same dispatch');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'AUTO') ->> 'replayed')::boolean), 'a repeated automation event returns the same dispatch');
select test.check((select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid) #>> '{dispatch,id}' = (select j #>> '{dispatch,id}' from rq)), 'it is the same row every time');
reset role;
select test.check((select count(*) = 1 from invoice_whatsapp_dispatches), 'exactly one dispatch exists for the invoice and number');
select test.check((select dedupe_key = 'INVWA|' || pg_temp.g('paid') || '|PAID|' || right(pg_temp.g('phone'), 10) from invoice_whatsapp_dispatches), 'the key is invoice + stage + number');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_WHATSAPP_REQUESTED'), 'the request is audited once');
select test.check((select count(*) = 1 from invoice_whatsapp_events where kind = 'REQUESTED'), 'and has one history entry');

-- ---------------------------------------------------------------- the worker is for the server only
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select invoice_whatsapp_claim()$$, 'Accounts cannot run the worker', 'permission denied');
select test.must_fail($$select invoice_whatsapp_finish(gen_random_uuid(), 'ACCEPTED')$$, 'nor record a result', 'permission denied');
select test.must_fail($$select invoice_whatsapp_status_update('x', 'DELIVERED')$$, 'nor a delivery report', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select invoice_whatsapp_claim()$$, 'an anonymous caller cannot either', 'permission denied');
reset role;

-- ---------------------------------------------------------------- dry run: decided, never sent
create temp table cl as select invoice_whatsapp_claim(5, 'dry_run', 300, timestamptz '2027-01-10 11:00+05:30') as j;
select test.check((select jsonb_array_length(j) = 1 from cl), 'a dry run claims the dispatch even though the template is not approved');
select test.check((select x ->> 'number' is not null and (x ->> 'total')::numeric = pg_temp.g('total')::numeric and x ->> 'to' = '+91' || right(pg_temp.g('phone'), 10)
                          and x #>> '{file,path}' like 'customers/%/invoices/%/paid.pdf' and x #>> '{template,name}' = 'invoice_paid' and (x #>> '{template,approved}')::boolean = false
                     from jsonb_array_elements((select j from cl)) x), 'the payload has the persisted total, the number, the stored paid PDF location and the template');
select test.check((select not (x ? 'url') and not (x ? 'signedUrl') and not (x::text like '%http%') from jsonb_array_elements((select j from cl)) x), 'no link is ever stored or handed out by the database');
select test.check((select status = 'PROCESSING' and attempts = 1 from invoice_whatsapp_dispatches), 'a claimed dispatch is PROCESSING');
select test.must_fail($$select invoice_whatsapp_finish((select id from invoice_whatsapp_dispatches), 'SENT')$$, 'an unknown outcome is refused', 'Unknown outcome');
select test.check((select invoice_whatsapp_finish((select id from invoice_whatsapp_dispatches), 'DRY_RUN', 'Dry run - not sent') ->> 'status' = 'DRY_RUN'), 'a dry run ends as DRY_RUN');
select test.must_fail($$select invoice_whatsapp_finish((select id from invoice_whatsapp_dispatches), 'ACCEPTED', null, 200, 'x')$$, 'a result cannot be recorded twice', 'not being processed');
select test.check((select jsonb_array_length(invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-10 11:05+05:30')) = 0), 'a finished dry run is not claimed again');

-- ---------------------------------------------------------------- live needs the approved template; a dry-run record can be sent again on request
set role authenticated;
select test.login('acc_m');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'MANUAL', true) #>> '{dispatch,status}') = 'PENDING'), 'sending again after a dry run makes the dispatch PENDING again (same row)');
reset role;
select test.check((select count(*) = 1 from invoice_whatsapp_dispatches), '... still one dispatch');
select test.check((select jsonb_array_length(invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-10 11:10+05:30')) = 0), 'live: an unapproved template is never sent');
select test.check((select status = 'PENDING' and attempts = 0 from invoice_whatsapp_dispatches), '... the dispatch just waits');
-- the WhatsApp Automation Builder keeps its templates on its own side: live_hook is live without the template rule
select test.must_fail($$select invoice_whatsapp_claim(5, 'live_hooks')$$, 'an unknown mode is refused', 'Unknown mode');
create temp table lh as select invoice_whatsapp_claim(5, 'live_hook', 300, timestamptz '2027-01-10 11:12+05:30') as j;
select test.check((select jsonb_array_length(j) = 1 from lh), 'live_hook: the dispatch is handed over although no template is approved');
select test.check((select status = 'PROCESSING' and attempts = 1 from invoice_whatsapp_dispatches), '... and it is claimed like any live dispatch');
update invoice_whatsapp_dispatches set status = 'PENDING', attempts = 0, locked_until = null;
set role authenticated;
select test.login('sa');
select set_invoice_whatsapp_settings(true, true, 'invoice_paid', 'en', true);
reset role;
create temp table lv as select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-10 11:20+05:30') as j;
select test.check((select jsonb_array_length(j) = 1 and (j -> 0 #>> '{template,approved}')::boolean from lv), 'live: with the approved template it is claimed');
select test.check((select invoice_whatsapp_finish((select id from invoice_whatsapp_dispatches), 'ACCEPTED', 'HTTP 200', 200, 'wamid.TEST1', timestamptz '2027-01-10 11:20:05+05:30') ->> 'status' = 'ACCEPTED'), 'accepted by the provider');
select test.check((select status = 'ACCEPTED' and provider_ref = 'wamid.TEST1' and accepted_at is not null and delivered_at is null from invoice_whatsapp_dispatches), 'ACCEPTED is not DELIVERED: no delivery time yet');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_WHATSAPP_ACCEPTED' and (metadata ->> 'customer_id') = pg_temp.g('cust')), 'acceptance is audited');
select test.check((select count(*) = 1 from customer_activities where customer_id = pg_temp.g('cust')::uuid and type = 'INVOICE_WHATSAPP_ACCEPTED'), 'and on the customer timeline');
select test.check((select jsonb_array_length(invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-10 12:00+05:30')) = 0), 'an accepted dispatch is never sent a second time');

-- ---------------------------------------------------------------- resend rules, delivery reports
set role authenticated;
select test.login('acc_m');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid) ->> 'replayed')::boolean), 'a repeated request after acceptance returns the same dispatch and sends nothing');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'MANUAL', true)$$, 'sending again right after acceptance is refused', 'accepted a moment ago');
reset role;
select test.check((select (invoice_whatsapp_status_update('wamid.NOPE', 'DELIVERED') ->> 'matched')::boolean = false), 'a report for an unknown message is ignored');
select test.check((select invoice_whatsapp_status_update('wamid.TEST1', 'DELIVERED', null, timestamptz '2027-01-10 11:21+05:30') ->> 'status' = 'DELIVERED'), 'the delivery report moves it to DELIVERED');
select test.check((select status = 'DELIVERED' and delivered_at = timestamptz '2027-01-10 11:21+05:30' from invoice_whatsapp_dispatches), 'with its delivery time');
select test.check((select (invoice_whatsapp_status_update('wamid.TEST1', 'DELIVERED') ->> 'ignored')::boolean), 'a repeated report changes nothing');
select test.check((select invoice_whatsapp_status_update('wamid.TEST1', 'READ') ->> 'status' = 'READ'), 'READ follows DELIVERED');
select test.check((select (invoice_whatsapp_status_update('wamid.TEST1', 'DELIVERED') ->> 'ignored')::boolean and status = 'READ' from invoice_whatsapp_dispatches), 'a late "delivered" never downgrades READ');
select test.check((select (invoice_whatsapp_status_update('wamid.TEST1', 'FAILED', 'late') ->> 'ignored')::boolean and status = 'READ' from invoice_whatsapp_dispatches), 'nor does a late failure');
select test.must_fail($$select invoice_whatsapp_status_update('wamid.TEST1', 'SOMETHING')$$, 'an unknown status is refused', 'Unknown status');
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'MANUAL', true)$$, 'a delivered invoice is not sent again to the same number', 'already delivered');
select test.check((select jsonb_array_length(accounts_invoice_whatsapp_history(pg_temp.g('paid')::uuid)) = 1
                      and accounts_invoice_whatsapp_history(pg_temp.g('paid')::uuid) -> 0 ->> 'status' = 'READ'
                      and jsonb_array_length(accounts_invoice_whatsapp_history(pg_temp.g('paid')::uuid) -> 0 -> 'events') >= 5), 'Accounts sees the history, with every step');
select test.check((select not (accounts_invoice_whatsapp_history(pg_temp.g('paid')::uuid)::text like '%' || right(pg_temp.g('phone'), 10) || '%' and accounts_invoice_whatsapp_history(pg_temp.g('paid')::uuid)::text not like '%XXXXXX%')),
  'the history shows the number masked only');

-- ---------------------------------------------------------------- a corrected number is a new recipient: retries 10 then 30 minutes, then FAILED
reset role;
update customers set phone = '9819900299', whatsapp = null where id = pg_temp.g('cust')::uuid;
set role authenticated;
select test.login('acc_m');
create temp table rq2 as select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid) as j;
grant all on rq2 to service_role;
select test.check((select not (j ->> 'replayed')::boolean and j #>> '{dispatch,id}' <> (select j #>> '{dispatch,id}' from rq) from rq2), 'a different number is a different dispatch');
reset role;
select test.check((select count(*) = 2 from invoice_whatsapp_dispatches), 'two dispatches now (two numbers)');
select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-11 10:00+05:30');
select test.check((select invoice_whatsapp_finish((select (j #>> '{dispatch,id}')::uuid from rq2), 'RETRY', 'HTTP 503', 503, null, timestamptz '2027-01-11 10:01+05:30') ->> 'status' = 'RETRY'), 'a failed attempt is scheduled for retry');
select test.check((select next_attempt_at = timestamptz '2027-01-11 10:11+05:30' from invoice_whatsapp_dispatches where id = (select (j #>> '{dispatch,id}')::uuid from rq2)), 'the first retry is 10 minutes later');
select test.check((select jsonb_array_length(invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-11 10:05+05:30')) = 0), 'not before then');
select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-11 10:11+05:30');
select invoice_whatsapp_finish((select (j #>> '{dispatch,id}')::uuid from rq2), 'RETRY', 'HTTP 503', 503, null, timestamptz '2027-01-11 10:12+05:30');
select test.check((select next_attempt_at = timestamptz '2027-01-11 10:42+05:30' from invoice_whatsapp_dispatches where id = (select (j #>> '{dispatch,id}')::uuid from rq2)), 'the second retry is 30 minutes later');
select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-11 10:42+05:30');
select test.check((select invoice_whatsapp_finish((select (j #>> '{dispatch,id}')::uuid from rq2), 'RETRY', 'HTTP 503', 503, null, timestamptz '2027-01-11 10:43+05:30') ->> 'status' = 'FAILED'), 'after 3 attempts it is FAILED');
select test.check((select count(*) = 1 from audit_logs where action = 'INVOICE_WHATSAPP_FAILED'), 'the failure is audited');
select test.check((select paid_pdf_status = 'STORED' and lifecycle = 'PAID' and total_amount = pg_temp.g('total')::numeric from generated_invoices where invoice_id = pg_temp.g('paid')::uuid)
               and (select count(*) = pg_temp.g('invoices_before')::int from generated_invoices), 'a failed message changes nothing about the invoice and creates no invoice');
set role authenticated;
select test.login('acc_m');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'MANUAL', true) #>> '{dispatch,status}') = 'PENDING'), 'Accounts can send a FAILED one again (attempts start over)');
select test.check((select (accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'MANUAL', true) ->> 'replayed')::boolean), 'and pressing it twice does not queue two');
reset role;
select test.check((select attempts = 0 and status = 'PENDING' from invoice_whatsapp_dispatches where id = (select (j #>> '{dispatch,id}')::uuid from rq2)), 'the dispatch is PENDING with 0 attempts');

-- ---------------------------------------------------------------- a number that changed after the request: skipped, never sent to the new number by mistake
update customers set phone = '9819900298' where id = pg_temp.g('cust')::uuid;
select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-12 10:00+05:30');
select test.check((select status = 'SKIPPED' and detail like '%number changed%' from invoice_whatsapp_dispatches where id = (select (j #>> '{dispatch,id}')::uuid from rq2)), 'a changed number: skipped with the reason');

-- ---------------------------------------------------------------- a live attempt whose result was never recorded is failed, not repeated
update customers set phone = '9819900299' where id = pg_temp.g('cust')::uuid;
set role authenticated;
select test.login('acc_m');
select accounts_invoice_whatsapp_request(pg_temp.g('paid')::uuid, 'PAID', 'MANUAL', true);
reset role;
select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-13 10:00+05:30');
select invoice_whatsapp_claim(5, 'live', 300, timestamptz '2027-01-13 10:10+05:30');
select test.check((select status = 'FAILED' and detail like '%not recorded%' from invoice_whatsapp_dispatches where id = (select (j #>> '{dispatch,id}')::uuid from rq2)), 'an orphaned live attempt is FAILED, not repeated');

-- ---------------------------------------------------------------- the invoice itself was never touched
select test.check((select count(*) = pg_temp.g('invoices_before')::int from generated_invoices), 'no invoice was created by any of this');
update customers set phone = pg_temp.g('phone') where id = pg_temp.g('cust')::uuid;
update invoice_whatsapp_settings set enabled = false, auto_send = false, template_name = null, template_approved = false;
\echo '   done'
