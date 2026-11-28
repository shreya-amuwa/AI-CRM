-- =============================================================================
-- Support Recharges (20270228000200 + 20270310000100): Panel and Message recharges for a customer, credited to the customer's own Relationship Manager (RM),
-- GST / Non-GST, a private payment screenshot, and Accounts verifying that the money really arrived.
-- Uses rls_test.sql's Wabastore Department Head (dh_wab), Support Team Lead (sup_th), Support members (sup_plain, sup_b), a Sales member (tm_a), a Sales
-- Team Lead (th_wab), the Accounts head and member (dh_acc, acc_m), the Super Admin (sa) and another department's head (dh_wbx). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 160. Support Recharges'
reset role;
\i supabase/migrations/20270228000200_support_recharges.sql
\i supabase/migrations/20270310000100_recharge_accounts_workflow.sql
\i supabase/migrations/20270310000100_recharge_accounts_workflow.sql

-- a re-run starts clean (the history table is append-only, so its guard is lifted for this clean-up only)
alter table public.support_recharge_events disable trigger support_recharge_events_append_only;
delete from support_recharge_events where recharge_id in (select id from support_recharges where customer_name like 'RCX %' or customer_name like 'RCH %' or customer_id in (select id from customers where phone like '90000007%'));
alter table public.support_recharge_events enable trigger support_recharge_events_append_only;
update support_recharge_files set recharge_id = null where file_name like 'rch-%';
delete from support_recharges where customer_name like 'RCX %' or customer_name like 'RCH %' or customer_id in (select id from customers where phone like '90000007%');
delete from support_recharge_files where file_name like 'rch-%';
delete from customer_activities where customer_id in (select id from customers where phone like '90000007%');
delete from customer_services where customer_id in (select id from customers where phone like '90000007%');
delete from customers where phone like '90000007%';
delete from notifications where type like 'RECHARGE\_%';
create temp table rc (k text primary key, v text);
grant all on rc to authenticated, anon, service_role;
create function pg_temp.rv(p_k text) returns text language sql stable as $$ select v from rc where k = p_k $$;
grant execute on function pg_temp.rv(text) to authenticated, anon;
create function pg_temp.shot(p_name text) returns uuid language plpgsql as $$
declare
  f public.support_recharge_files;
begin
  f := public.recharge_begin_upload(p_name, 'image/png', 12345);
  perform public.recharge_complete_upload(f.id, 12345, 'etag');
  return f.id;
end $$;
grant execute on function pg_temp.shot(text) to authenticated;
-- one form payload, with overrides
create function pg_temp.form(p_cust text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('kind', 'PANEL', 'customerId', pg_temp.rv(p_cust), 'rechargeDate', current_date, 'billingType', 'NON_GST', 'rechargeAmount', '500.50', 'gstAmount', '0') || p_extra
$$;
grant execute on function pg_temp.form(text, jsonb) to authenticated;
create function pg_temp.rid(p_k text) returns uuid language sql stable as $$ select (v::jsonb ->> 'id')::uuid from rc where k = p_k $$;
grant execute on function pg_temp.rid(text) to authenticated;

\echo '   customers: C1 and C2 are sup_plain''s (so sup_plain is their RM), C3 is sup_b''s'
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000711","name":"Rch One","businessName":"RCX One Traders (TEST)"},{"row":4,"mobile":"9000000712","name":"Rch Two","businessName":"RCX Two Stores (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean),
  'setup: two customers of sup_plain');
select test.login('sup_b');
select test.check((select (import_customer_data('{"customers":[{"row":3,"mobile":"9000000713","name":"Rch Three","businessName":"RCX Three Foods (TEST)"}]}'::jsonb, true) ->> 'committed')::boolean),
  'setup: a customer of sup_b');
reset role;
insert into rc select 'c1', id::text from customers where phone = '9000000711';
insert into rc select 'c2', id::text from customers where phone = '9000000712';
insert into rc select 'c3', id::text from customers where phone = '9000000713';
select test.check(private.support_member_of(pg_temp.rv('c1')::uuid) = test.id('sup_plain') and private.support_member_of(pg_temp.rv('c3')::uuid) = test.id('sup_b'), 'fixture: the RM of each customer is its Support owner');

\echo '   the tables and helpers cannot be reached directly'
select test.check(not has_table_privilege('authenticated', 'public.support_recharges', 'select') and not has_table_privilege('authenticated', 'public.support_recharge_files', 'select')
                  and not has_table_privilege('authenticated', 'public.support_recharge_events', 'select') and not has_table_privilege('anon', 'public.support_recharges', 'select'), 'the recharge tables have no direct grants');
select test.check((select bool_and(relrowsecurity) from pg_class where oid in ('public.support_recharges'::regclass, 'public.support_recharge_files'::regclass, 'public.support_recharge_events'::regclass)), 'row level security is on for all three tables');
select test.check(not has_function_privilege('anon', 'public.recharge_create(jsonb)', 'execute') and not has_function_privilege('anon', 'public.recharge_verify_payment(uuid, text, text, numeric)', 'execute')
                  and not has_function_privilege('anon', 'public.recharge_rm_performance(date, date, uuid)', 'execute') and not has_function_privilege('anon', 'public.recharge_attachment_download(uuid)', 'execute'), 'an anonymous caller cannot run the recharge functions');
select test.check(not has_function_privilege('authenticated', 'private.recharge_visible(public.support_recharges)', 'execute') and not has_function_privilege('authenticated', 'private.recharge_event(uuid, text, text, text, text, jsonb)', 'execute'), 'the private helpers are not callable');
-- no count of "all of them" here: the invoice migration (the next PR) adds more public recharge functions, and each must follow the same rule
select test.check((select count(*) >= 15 and count(*) filter (where not (p.prosecdef and p.proconfig @> array['search_path=""'])) = 0 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname like 'recharge\_%'), 'every public recharge function is SECURITY DEFINER with an empty search_path');

\echo '   only Support staff may record; only Accounts (and the Super Admin) verify'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select recharge_list('PANEL')$$, 'a Sales member cannot list recharges', 'FORBIDDEN');
select test.must_fail($$select recharge_customers('rch')$$, '... nor search customers for one', 'FORBIDDEN');
select test.must_fail($$select recharge_begin_upload('rch-x.png', 'image/png', 100)$$, '... nor upload a screenshot', 'FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select recharge_list('PANEL')$$, 'a Sales Team Lead cannot list recharges', 'FORBIDDEN');
select test.must_fail($$select recharge_rm_performance()$$, '... nor read the RM performance', 'FORBIDDEN');
select test.login('acc_m');
select test.must_fail($$select recharge_create('{"kind":"PANEL"}'::jsonb)$$, 'Accounts do not record recharges', 'FORBIDDEN');
select test.must_fail($$select recharge_customers('rch')$$, '... nor search customers for one', 'FORBIDDEN');
select test.login('sa');
select test.must_fail($$select recharge_create('{"kind":"PANEL"}'::jsonb)$$, 'the Super Admin does not record recharges', 'FORBIDDEN');

\echo '   the customer picker and the RM come from the database'
select test.login('sup_plain');
select test.check((select jsonb_array_length(recharge_customers('rcx')) = 3 and jsonb_array_length(recharge_customers('rcx one')) = 1), 'the picker lists the customers the person may see, with search');
select test.check((select recharge_customers('rcx one') -> 0 ->> 'rmName' = (select full_name from public.profiles where id = test.id('sup_plain'))), 'each customer shows its Relationship Manager');
select test.check((select recharge_customer_context(pg_temp.rv('c1')::uuid) ->> 'rmId' = test.id('sup_plain')::text and recharge_customer_context(pg_temp.rv('c1')::uuid) ->> 'phone' = '9000000711'), 'the customer''s details come from the record');
select test.must_fail($$select recharge_customer_context(gen_random_uuid())$$, 'an unknown customer is not found', 'NOT_FOUND');
select test.login('tm_a');
select test.must_fail(format($$select recharge_customer_context('%s')$$, pg_temp.rv('c1')), 'a Sales member gets no customer context', 'FORBIDDEN');

\echo '   create: GST, Non-GST, validation, the screenshot, the RM'
select test.login('sup_plain');
insert into rc select 'f1', pg_temp.shot('rch-panel-1.png')::text;
select test.must_fail($$select recharge_create(pg_temp.form('c1', '{"customerId":null}'))$$, 'the customer is required', 'customer');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"kind":"OTHER","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'the kind must be Panel or Message', 'Panel Recharge or Message Recharge');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"customerId":"%s","screenshotId":"%s"}'))$$, gen_random_uuid(), pg_temp.rv('f1')), 'an unknown customer is not found', 'NOT_FOUND');
select test.must_fail($$select recharge_create(pg_temp.form('c1'))$$, 'the screenshot is required', 'screenshot');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"billingType":"GST","gstAmount":"90","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a GST recharge needs the GST number', 'GST number');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"billingType":"GST","gstAmount":"90","gstNumber":"27AAPFU0939F1Z","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), '... a valid one', 'GST number');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"gstAmount":"90","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a Non-GST recharge has no GST amount', 'no GST amount');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"billingType":"GST","gstAmount":"900","gstNumber":"27AAPFU0939F1ZV","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'GST cannot exceed the amount', 'cannot be more');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"billingType":"","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'GST or Non-GST must be chosen', 'GST or Non-GST');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"rechargeAmount":"0","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a zero amount is refused', 'above zero');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"rechargeAmount":"-5","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a negative amount is refused', 'above zero');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"rechargeAmount":"abc","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a text amount is refused', 'numbers');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"rechargeAmount":"10.123","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'three decimals are refused', '2 decimal');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"totalAmount":"999","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a total that is not amount + GST is refused', 'must equal');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"rechargeDate":"2999-01-01","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a date in the future is refused', 'future');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"rechargeDate":"nope","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'a bad date is refused', 'recharge date');
select test.must_fail($$select recharge_begin_upload('rch-x.gif', 'image/gif', 100)$$, 'a GIF cannot be the proof', 'image');
select test.must_fail($$select recharge_begin_upload('rch-x.png', 'image/png', 6000000)$$, 'a file over 5 MB is refused', '5 MB');
select test.must_fail(format($$select recharge_create(pg_temp.form('c1', '{"screenshotId":"%s"}'))$$, gen_random_uuid()), 'a screenshot that does not exist is refused', 'screenshot');

insert into rc select 'p1', recharge_create(pg_temp.form('c1', format('{"billingType":"GST","rechargeAmount":"500","gstAmount":"90","totalAmount":"590","gstNumber":"27aapfu0939f1zv","paymentReference":"UPI-7001","remarks":"paid by UPI","screenshotId":"%s","requestId":"11111111-1111-4111-8111-111111111111"}', pg_temp.rv('f1'))::jsonb))::text;
select test.check((select v::jsonb ->> 'billingType' = 'GST' and (v::jsonb ->> 'totalAmount')::numeric = 590 and (v::jsonb ->> 'rechargeAmount')::numeric = 500 and (v::jsonb ->> 'gstAmount')::numeric = 90
                          and v::jsonb ->> 'customerGstin' = '27AAPFU0939F1ZV' and v::jsonb ->> 'kind' = 'PANEL' and v::jsonb ->> 'reference' ~ '^PRC-[0-9]{5}$' from rc where k = 'p1'), 'a GST Panel recharge: amount + GST = total, GST number cleaned');
select test.check((select v::jsonb ->> 'paymentStatus' = 'PENDING_VERIFICATION' and v::jsonb ->> 'invoiceStatus' = 'NOT_GENERATED' and v::jsonb ->> 'supportStatus' = 'SUBMITTED' and v::jsonb ->> 'customerPhone' = '9000000711'
                          and v::jsonb ->> 'customerName' = 'RCX One Traders (TEST)' and v::jsonb ->> 'rmId' = test.id('sup_plain')::text from rc where k = 'p1'), 'it waits for Accounts, nothing is invoiced, and the customer and RM come from the record');
select test.check((select recharge_create(pg_temp.form('c1', '{"billingType":"GST","rechargeAmount":"500","gstAmount":"90","gstNumber":"27AAPFU0939F1ZV","screenshotId":"00000000-0000-4000-8000-000000000000","requestId":"11111111-1111-4111-8111-111111111111"}')) ->> 'id' = (select v::jsonb ->> 'id' from rc where k = 'p1')),
  'the same request id returns the record already saved (no double entry)');
select test.must_fail(format($$select recharge_create(pg_temp.form('c2', '{"paymentReference":"upi-7001","screenshotId":"%s"}'))$$, pg_temp.rv('f1')), 'one payment reference cannot be used twice (case does not matter)', 'already used');

insert into rc select 'f2', pg_temp.shot('rch-msg-1.png')::text;
insert into rc select 'm1', recharge_create(pg_temp.form('c2', format('{"kind":"MESSAGE","rechargeAmount":"200","gstNumber":"27AAPFU0939F1ZV","screenshotId":"%s"}', pg_temp.rv('f2'))::jsonb))::text;
select test.check((select v::jsonb ->> 'reference' ~ '^MRC-[0-9]{5}$' and v::jsonb ->> 'billingType' = 'NON_GST' and v::jsonb ->> 'customerGstin' is null and (v::jsonb ->> 'gstAmount')::numeric = 0 from rc where k = 'm1'),
  'a Non-GST Message recharge: its own references, no GST, a GST number given is ignored');

\echo '   RM attribution: the customer''s RM gets the credit, whoever records it'
select test.login('sup_b');
insert into rc select 'f3', pg_temp.shot('rch-panel-2.png')::text;
insert into rc select 'p2', recharge_create(pg_temp.form('c1', format('{"rechargeAmount":"1000","rmId":"%s","createdBy":"%s","departmentId":"%s","screenshotId":"%s"}', test.id('sup_b'), test.id('sup_b'), gen_random_uuid(), pg_temp.rv('f3'))::jsonb))::text;
select test.check((select v::jsonb ->> 'rmId' = test.id('sup_plain')::text and v::jsonb ->> 'createdById' = test.id('sup_b')::text from rc where k = 'p2'),
  'a colleague recording a recharge for sup_plain''s customer: the credit goes to sup_plain, not to the recorder, whatever the request says');
reset role;
select test.check((select rm_id = test.id('sup_plain') and created_by = test.id('sup_b') and department_id = (select department_id from profiles where id = test.id('sup_b')) from support_recharges where id = pg_temp.rid('p2')), 'stored: the RM is sup_plain, the recorder sup_b, the department the recorder''s');
set role authenticated;
select test.login('sup_b');
insert into rc select 'f4', pg_temp.shot('rch-own.png')::text;
insert into rc select 'p3', recharge_create(pg_temp.form('c3', format('{"rechargeAmount":"300","screenshotId":"%s"}', pg_temp.rv('f4'))::jsonb))::text;
select test.check((select v::jsonb ->> 'rmId' = test.id('sup_b')::text from rc where k = 'p3'), 'and for their own customer the credit is theirs');
reset role;
-- a customer that is no longer a Support customer has no RM: nobody may record a recharge for it
set session_replication_role = replica;
update customers set owner_id = test.id('tm_a'), team_id = test.team('wabastore', 'Sales') where id = pg_temp.rv('c2')::uuid;
reset session_replication_role;
select test.check(private.support_member_of(pg_temp.rv('c2')::uuid) is null, 'fixture: the customer now belongs to a Sales member, so it has no Support Relationship Manager');
set role authenticated;
select test.login('sup_plain');
insert into rc select 'f5', pg_temp.shot('rch-norm.png')::text;
select test.must_fail(format($$select recharge_create(pg_temp.form('c2', '{"screenshotId":"%s"}'))$$, pg_temp.rv('f5')), 'a customer with no Relationship Manager cannot take a recharge', 'no Relationship Manager');
reset role;
set session_replication_role = replica;
update customers set owner_id = test.id('sup_plain'), team_id = (select team_id from profiles where id = test.id('sup_plain')) where id = pg_temp.rv('c2')::uuid;
reset session_replication_role;
set role authenticated;

\echo '   the RM, the customer and the recorder cannot be changed afterwards'
reset role;
select test.must_fail(format($$update support_recharges set rm_id = %L where id = %L$$, test.id('sup_b'), pg_temp.rid('p1')), 'the RM of a recharge cannot be changed', 'cannot be changed');
select test.must_fail(format($$update support_recharges set customer_id = %L where id = %L$$, pg_temp.rv('c3'), pg_temp.rid('p1')), 'the customer cannot be changed', 'cannot be changed');
select test.must_fail(format($$update support_recharges set created_by = %L where id = %L$$, test.id('sup_b'), pg_temp.rid('p1')), 'the recorder cannot be changed', 'cannot be changed');
select test.must_fail(format($$update support_recharges set kind = 'MESSAGE' where id = %L$$, pg_temp.rid('p1')), 'a Panel recharge cannot become a Message recharge', 'cannot be changed');
select test.must_fail(format($$update support_recharges set total_amount = total_amount + 1 where id = %L$$, pg_temp.rid('p1')), 'the table refuses a total that is not amount + GST', 'support_recharges_total2_ck');
select test.must_fail(format($$update support_recharges set billing_type = 'NON_GST' where id = %L$$, pg_temp.rid('p1')), 'the table refuses GST on a Non-GST recharge', 'support_recharges_billing_ck');
set role authenticated;

\echo '   Panel and Message stay separate; who sees what'
select test.login('sup_plain');
select test.check((select recharge_list('PANEL') ->> 'total' = '2' and recharge_list('MESSAGE') ->> 'total' = '1'), 'sup_plain (the RM) sees their customers'' recharges, including the colleague''s: 2 Panel, 1 Message');
select test.check((select (recharge_list('PANEL') -> 'summary' ->> 'totalAmount')::numeric = 1590 and (recharge_list('PANEL') -> 'summary' ->> 'totalGst')::numeric = 90 and recharge_list('PANEL') -> 'summary' ->> 'pending' = '2'
                          and (recharge_list('MESSAGE') -> 'summary' ->> 'totalAmount')::numeric = 200 and (recharge_list('MESSAGE') -> 'summary' ->> 'totalNonGst')::numeric = 200), 'each tab has its own summary');
select test.must_fail($$select recharge_list(null)$$, 'Support lists one kind at a time', 'Panel Recharge or Message Recharge');
select test.must_fail($$select recharge_list('PANEL', null, 'DONE')$$, 'a payment status must be valid', 'payment status');
select test.must_fail($$select recharge_list('PANEL', null, null, 'SHIPPED')$$, 'an invoice status must be valid', 'invoice status');
select test.check((select recharge_list('PANEL', 'one trad') ->> 'total' = '2' and recharge_list('PANEL', 'zzz') ->> 'total' = '0' and recharge_list('PANEL', 'upi-7001') ->> 'total' = '1' and recharge_list('PANEL', '%') ->> 'total' = '0'), 'search by customer or payment reference; % is text');
select test.check((select recharge_list('PANEL', null, 'PENDING_VERIFICATION', 'NOT_GENERATED', current_date - 2, current_date, 100, 700) ->> 'total' = '1'), 'filters: payment status, invoice status, date, amount');
select test.check((select jsonb_array_length(recharge_list('PANEL', null, null, null, null, null, null, null, null, 1, 0) -> 'items') = 1 and recharge_list('PANEL', null, null, null, null, null, null, null, null, 1, 0) ->> 'total' = '2'), 'pagination keeps the total');
select test.login('sup_b');
select test.check((select recharge_list('PANEL') ->> 'total' = '2' and recharge_list('MESSAGE') ->> 'total' = '0'), 'sup_b sees what they recorded (p2) and what is credited to them (p3)');
select test.must_fail(format($$select recharge_get('%s')$$, pg_temp.rid('p1')), 'sup_b cannot open sup_plain''s own recharge by id', 'NOT_FOUND');
select test.login('sup_th');
select test.check((select recharge_list('PANEL') ->> 'total' = '3' and recharge_list('PANEL') ->> 'role' = 'LEAD'), 'the Team Lead sees the team''s recharges');
select test.login('dh_wab');
select test.check((select recharge_list('PANEL') ->> 'total' = '3' and recharge_list('PANEL') ->> 'role' = 'HEAD'), 'the Support Department Head sees the department''s recharges');
select test.login('dh_wbx');
select test.check((select recharge_list('PANEL') ->> 'total' = '0'), 'another department''s head sees none of them');
select test.must_fail(format($$select recharge_get('%s')$$, pg_temp.rid('p1')), '... nor opens one by id', 'NOT_FOUND');
select test.login('acc_m');
select test.check((select recharge_list(null) ->> 'total' = '4' and recharge_list(null) ->> 'role' = 'ACCOUNTS' and (recharge_list(null) ->> 'isAccounts')::boolean and not (recharge_list(null) ->> 'canCreate')::boolean), 'Accounts see every recharge of both kinds');
select test.login('sa');
select test.check((select recharge_list(null) ->> 'total' = '4' and recharge_list(null) ->> 'role' = 'SUPER_ADMIN'), 'the Super Admin sees all');

\echo '   the screenshot is only proof: it never marks anything received'
select test.login('acc_m');
select test.check((select recharge_get(pg_temp.rid('p1')) ->> 'paymentStatus' = 'PENDING_VERIFICATION'), 'a recharge with its screenshot is still Pending Verification');
select test.check(((select (recharge_attachment_download(pg_temp.rv('f1')::uuid)).storage_bucket) = 'support-recharge-files'), 'Accounts open the screenshot (private bucket)');
select test.login('sup_plain');
select test.check(((select (recharge_attachment_download(pg_temp.rv('f3')::uuid)).file_name) = 'rch-panel-2.png'), 'the RM opens the screenshot of a recharge made for their customer');
select test.login('sup_b');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f1')), 'a Support member who is neither recorder nor RM cannot open it', 'NOT_FOUND');
select test.login('dh_wbx');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f1')), 'another department''s head cannot open it', 'NOT_FOUND');
select test.login('tm_a');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f1')), 'a Sales member cannot open it', 'FORBIDDEN');

\echo '   nobody but Accounts verifies the payment'
select test.login('sup_th');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, pg_temp.rid('p1')), 'a Team Lead cannot verify', 'FORBIDDEN');
select test.must_fail(format($$select recharge_set_status('%s', 'VERIFIED')$$, pg_temp.rid('p1')), '... and the old status change is closed', 'verified by Accounts');
select test.login('dh_wab');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, pg_temp.rid('p1')), 'a Department Head cannot verify', 'FORBIDDEN');
select test.login('sup_plain');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, pg_temp.rid('p1')), 'the RM cannot verify a payment credited to them', 'FORBIDDEN');
select test.must_fail(format($$select recharge_accounts_correct('%s', '{"note":"x y z"}'::jsonb)$$, pg_temp.rid('p1')), '... nor correct the billing details', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, pg_temp.rid('p1')), 'a Sales member cannot', 'FORBIDDEN');

\echo '   the performance counts only what Accounts confirmed'
select test.login('sup_plain');
select test.check((select jsonb_array_length(recharge_rm_performance()) = 1 and recharge_rm_performance() -> 0 ->> 'totalCount' = '0' and (recharge_rm_performance() -> 0 ->> 'totalAmount')::numeric = 0
                          and (recharge_rm_performance() -> 0 ->> 'pendingAmount')::numeric = 1790 and recharge_rm_performance() -> 0 ->> 'pendingCount' = '3'), 'pending recharges are shown apart and add nothing to the verified totals');

\echo '   Accounts: payment received'
select test.login('acc_m');
select test.must_fail(format($$select recharge_verify_payment('%s', 'MAYBE')$$, pg_temp.rid('p1')), 'a decision must be one of the three', 'Payment received');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED', null, 589)$$, pg_temp.rid('p1')), 'the amount received must equal the total', 'not the recharge total');
select test.must_fail(format($$select recharge_verify_payment('%s', 'NOT_RECEIVED')$$, pg_temp.rid('p1')), '"not received" needs a note', 'note is required');
select test.must_fail(format($$select recharge_verify_payment('%s', 'REJECTED', 'x')$$, pg_temp.rid('p1')), 'a rejection needs a reason', 'note is required');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, gen_random_uuid()), 'an unknown recharge is not found', 'NOT_FOUND');
select test.check((select recharge_verify_payment(pg_temp.rid('p1'), 'RECEIVED', 'seen in the bank statement', 590) ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'Accounts confirm the payment (with the amount seen)');
select test.check((select recharge_get(pg_temp.rid('p1')) ->> 'paymentVerifiedByName' is not null and recharge_get(pg_temp.rid('p1')) ->> 'paymentNote' = 'seen in the bank statement'), 'who verified, and the note, are kept');
select test.check((select (recharge_verify_payment(pg_temp.rid('p1'), 'RECEIVED', null, 590) ->> 'replayed')::boolean), 'verifying again changes nothing (replayed)');
reset role;
select test.check((select count(*) = 1 from support_recharge_events where recharge_id = pg_temp.rid('p1') and action = 'PAYMENT_RECEIVED'), 'and writes no second event');
select test.check((select count(*) = 1 from audit_logs where action = 'SUPPORT_RECHARGE_PAYMENT_VERIFIED' and entity_id = pg_temp.rid('p1')), 'and no second audit row');
select test.check((select count(*) = 1 from notifications where type = 'RECHARGE_PAYMENT_RECEIVED' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.rid('p1')), 'the RM is told once (and the recorder, when it is somebody else)');
set role authenticated;
select test.login('sup_plain');
select test.check((select recharge_rm_performance() -> 0 ->> 'totalCount' = '1' and (recharge_rm_performance() -> 0 ->> 'panelAmount')::numeric = 590 and (recharge_rm_performance() -> 0 ->> 'messageAmount')::numeric = 0
                          and recharge_rm_performance() -> 0 ->> 'panelCount' = '1' and recharge_rm_performance() -> 0 ->> 'messageCount' = '0' and (recharge_rm_performance() -> 0 ->> 'pendingAmount')::numeric = 1200), 'the verified Panel recharge counts for the RM once; the rest is still pending');

\echo '   Accounts: not received, rejected, the recorder corrects and submits again'
select test.login('acc_m');
select test.check((select recharge_verify_payment(pg_temp.rid('m1'), 'NOT_RECEIVED', 'no credit in the account yet') ->> 'paymentStatus' = 'PAYMENT_NOT_RECEIVED'), 'Accounts mark a payment as not received (with a reason)');
select test.check((select recharge_verify_payment(pg_temp.rid('p2'), 'REJECTED', 'wrong customer on the screenshot') ->> 'paymentStatus' = 'REJECTED'), 'Accounts reject a recharge (with a reason)');
select test.check((select recharge_list(null) -> 'summary' ->> 'received' = '1' and recharge_list(null) -> 'summary' ->> 'notReceived' = '1' and recharge_list(null) -> 'summary' ->> 'rejected' = '1' and recharge_list(null) -> 'summary' ->> 'pending' = '1'
                          and recharge_list(null) -> 'summary' ->> 'readyForInvoice' = '1'), 'Accounts'' summary: received, not received, rejected, pending, ready for invoice');
select test.check((select recharge_list(null, null, 'PAYMENT_RECEIVED', 'NOT_GENERATED') ->> 'total' = '1' and recharge_list(null, null, 'REJECTED') ->> 'total' = '1'), 'the queues: ready for invoice, rejected');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, pg_temp.rid('p2')), 'a rejected recharge goes back to Support, Accounts cannot approve it directly', 'cannot be moved');
select test.login('sup_plain');
select test.check((select recharge_performance_ok from (select recharge_rm_performance() -> 0 ->> 'totalCount' = '1' as recharge_performance_ok) x), 'not received and rejected recharges add nothing to the performance');
select test.check((select (recharge_get(pg_temp.rid('m1')) ->> 'canEdit')::boolean), 'the recorder can edit a recharge whose payment was not received');
select test.check((select recharge_update(pg_temp.rid('m1'), pg_temp.form('c2', '{"kind":"MESSAGE","rechargeAmount":"200","paymentReference":"UPI-7002"}')) ->> 'paymentStatus' = 'PENDING_VERIFICATION'), 'editing it submits it to Accounts again');
select test.must_fail(format($$select recharge_update('%s', pg_temp.form('c1', '{"rechargeAmount":"1"}'))$$, pg_temp.rid('p1')), 'a recharge whose payment was received can no longer be edited by Support', 'no longer');
select test.login('sup_b');
select test.check((select recharge_update(pg_temp.rid('p2'), pg_temp.form('c1', '{"rechargeAmount":"1000","remarks":"correct customer now"}')) ->> 'paymentStatus' = 'PENDING_VERIFICATION'), 'the recorder corrects a rejected recharge and it goes back to Accounts');
select test.login('sup_plain');
select test.must_fail(format($$select recharge_update('%s', pg_temp.form('c1', '{"rechargeAmount":"1"}'))$$, pg_temp.rid('p2')), 'the RM cannot edit a colleague''s recharge', 'no longer');
select test.login('sup_th');
select test.check((select recharge_update(pg_temp.rid('p2'), pg_temp.form('c1', '{"rechargeAmount":"1000","remarks":"lead fixed a typo"}')) ->> 'remarks' = 'lead fixed a typo'), 'a Team Lead may correct a pending recharge of the team');
reset role;
select test.check((select count(*) >= 3 from notifications where type = 'RECHARGE_SUBMITTED' and recipient_id = test.id('acc_m')), 'Accounts were told of each submission, and of the resubmissions');
select test.check((select count(*) = 1 from notifications where type = 'RECHARGE_PAYMENT_NOT_RECEIVED' and recipient_id = test.id('sup_plain') and entity_id = pg_temp.rid('m1')), 'the recorder is told the payment was not received');
select test.check((select count(*) = 0 from notifications where type like 'RECHARGE\_%' and recipient_id = test.id('acc_m') and type <> 'RECHARGE_SUBMITTED'), 'Accounts are not told about their own decisions');
set role authenticated;

\echo '   Accounts correct the billing details, with a reason, until an invoice exists'
select test.login('acc_m');
select test.must_fail(format($$select recharge_accounts_correct('%s', '{"gstAmount":"100"}'::jsonb)$$, pg_temp.rid('p1')), 'a correction needs a reason', 'what was corrected');
select test.must_fail(format($$select recharge_accounts_correct('%s', '{"note":"fix email","customerEmail":"not-an-email"}'::jsonb)$$, pg_temp.rid('p1')), 'an e-mail address must be valid', 'e-mail');
select test.must_fail(format($$select recharge_accounts_correct('%s', '{"note":"fix","billingType":"NON_GST","gstAmount":"10"}'::jsonb)$$, pg_temp.rid('p1')), 'Non-GST with GST is refused', 'no GST amount');
select test.check((select recharge_accounts_correct(pg_temp.rid('p1'), '{"note":"GST is 100 on the invoice we hold","gstAmount":"100","customerEmail":"Billing@RCXOne.example.com","customerAddress":"12 MG Road, Pune"}'::jsonb) ->> 'totalAmount' = '600.00'
                          or (recharge_get(pg_temp.rid('p1')) ->> 'totalAmount')::numeric = 600), 'Accounts correct the GST amount; the total follows');
select test.check((select recharge_get(pg_temp.rid('p1')) ->> 'customerEmail' = 'billing@rcxone.example.com' and recharge_get(pg_temp.rid('p1')) ->> 'customerAddress' = '12 MG Road, Pune'), 'and the customer''s e-mail and address');
select test.check((select recharge_get(pg_temp.rid('p1')) ->> 'rmId' = test.id('sup_plain')::text and recharge_get(pg_temp.rid('p1')) ->> 'customerId' = pg_temp.rv('c1')), 'a correction never moves the RM or the customer');
select test.check((select recharge_rm_performance() -> 0 ->> 'totalCount' = '1' and (recharge_rm_performance() -> 0 ->> 'panelAmount')::numeric = 600), 'the verified total follows the corrected amount, and the recharge is still counted once');
select test.check((select (recharge_get(pg_temp.rid('p1')) -> 'timeline') @> '[{"action":"BILLING_CORRECTED"}]'::jsonb), 'the correction is on the timeline');
reset role;
update support_recharges set invoice_status = 'GENERATED' where id = pg_temp.rid('p1');
set role authenticated;
select test.login('acc_m');
select test.must_fail(format($$select recharge_accounts_correct('%s', '{"note":"too late","gstAmount":"1"}'::jsonb)$$, pg_temp.rid('p1')), 'after an invoice exists the billing details are locked', 'can no longer be corrected');
select test.must_fail(format($$select recharge_verify_payment('%s', 'NOT_RECEIVED', 'changed my mind')$$, pg_temp.rid('p1')), 'and so is the payment status', 'invoice already exists');
select test.check((select (recharge_get(pg_temp.rid('p1')) ->> 'canCorrect')::boolean = false and recharge_get(pg_temp.rid('p1')) -> 'verifyActions' = '[]'::jsonb), 'the screen is told nothing can be changed any more');
reset role;
update support_recharges set invoice_status = 'NOT_GENERATED' where id = pg_temp.rid('p1');
set role authenticated;

\echo '   performance: Panel and Message apart, the RM''s own, no duplicates, history survives a reassignment'
select test.login('acc_m');
select test.check((select recharge_verify_payment(pg_temp.rid('m1'), 'RECEIVED', 'paid') ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'the re-submitted Message recharge is verified');
select test.check((select recharge_verify_payment(pg_temp.rid('p2'), 'RECEIVED', 'paid') ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'and the corrected Panel recharge');
select test.check((select recharge_verify_payment(pg_temp.rid('p3'), 'RECEIVED', 'paid') ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'and sup_b''s own customer''s');
select test.check((select recharge_verify_payment(pg_temp.rid('p3'), 'RECEIVED', 'paid') ->> 'paymentStatus' = 'PAYMENT_RECEIVED'), 'verifying the same recharge again');
select test.check((select count(*) = 2 from jsonb_array_elements(recharge_rm_performance()) x), 'two RMs have verified recharges');
select test.check((select x ->> 'panelCount' = '2' and (x ->> 'panelAmount')::numeric = 1600 and x ->> 'messageCount' = '1' and (x ->> 'messageAmount')::numeric = 200 and x ->> 'totalCount' = '3' and (x ->> 'totalAmount')::numeric = 1800
                          from jsonb_array_elements(recharge_rm_performance()) x where x ->> 'rmId' = test.id('sup_plain')::text), 'sup_plain: Panel 2 / 1600, Message 1 / 200, total 3 / 1800 (the colleague''s recharge is credited to the RM)');
select test.check((select x ->> 'totalCount' = '1' and (x ->> 'totalAmount')::numeric = 300 and x ->> 'messageCount' = '0' from jsonb_array_elements(recharge_rm_performance()) x where x ->> 'rmId' = test.id('sup_b')::text), 'sup_b: their own customer''s Panel recharge only, counted once');
select test.check((select jsonb_array_length(recharge_rm_performance(null, null, test.id('sup_b'))) = 1), 'a single RM can be asked for');
select test.check((select jsonb_array_length(recharge_rm_performance(current_date + 5, null)) = 0), 'the date range is applied');
select test.login('sup_b');
select test.check((select jsonb_array_length(recharge_rm_performance()) = 2 and (select count(*) from jsonb_array_elements(recharge_rm_performance()) x where x ->> 'rmId' = test.id('sup_b')::text) = 1), 'sup_b sees the RMs of the recharges they may see (their own credit, and the recharge they recorded for sup_plain)');
select test.login('sup_th');
select test.check((select jsonb_array_length(recharge_rm_performance()) = 2), 'the Team Lead sees the team''s RMs');
select test.login('dh_wbx');
select test.check((select jsonb_array_length(recharge_rm_performance()) = 0), 'another department''s head sees none');
reset role;
-- the customer is reassigned: history stays with the old RM, the next recharge goes to the new one
set session_replication_role = replica;
update customers set owner_id = test.id('sup_b'), team_id = (select team_id from profiles where id = test.id('sup_b')) where id = pg_temp.rv('c1')::uuid;
reset session_replication_role;
select test.check(private.support_member_of(pg_temp.rv('c1')::uuid) = test.id('sup_b'), 'fixture: the customer now belongs to sup_b');
select test.check((select count(*) = 3 and bool_and(rm_id = test.id('sup_plain')) from support_recharges where customer_id = pg_temp.rv('c1')::uuid or id = pg_temp.rid('m1')), 'the recharges already made stay credited to sup_plain');
set role authenticated;
select test.login('sup_b');
insert into rc select 'f6', pg_temp.shot('rch-after.png')::text;
insert into rc select 'p4', recharge_create(pg_temp.form('c1', format('{"rechargeAmount":"50","screenshotId":"%s"}', pg_temp.rv('f6'))::jsonb))::text;
select test.check((select v::jsonb ->> 'rmId' = test.id('sup_b')::text from rc where k = 'p4'), 'a new recharge for that customer goes to the new RM');
select test.login('acc_m');
select test.check((select x ->> 'totalCount' = '3' and (x ->> 'totalAmount')::numeric = 1800 from jsonb_array_elements(recharge_rm_performance()) x where x ->> 'rmId' = test.id('sup_plain')::text), 'sup_plain''s verified history is unchanged by the reassignment');
select test.check((select x ->> 'pendingCount' = '1' and x ->> 'totalCount' = '1' from jsonb_array_elements(recharge_rm_performance()) x where x ->> 'rmId' = test.id('sup_b')::text), 'and the new pending recharge is not counted for sup_b yet');

\echo '   the timeline, the audit trail and the legacy recharges'
select test.check((select jsonb_array_length(recharge_get(pg_temp.rid('m1')) -> 'timeline') = 4 and recharge_get(pg_temp.rid('m1')) -> 'timeline' -> 0 ->> 'action' = 'CREATED'
                          and recharge_get(pg_temp.rid('m1')) -> 'timeline' -> 1 ->> 'action' = 'PAYMENT_NOT_RECEIVED' and recharge_get(pg_temp.rid('m1')) -> 'timeline' -> 2 ->> 'action' = 'RESUBMITTED'
                          and recharge_get(pg_temp.rid('m1')) -> 'timeline' -> 3 ->> 'action' = 'PAYMENT_RECEIVED' and recharge_get(pg_temp.rid('m1')) -> 'timeline' -> 3 ->> 'actorName' is not null), 'the timeline: created, not received, resubmitted, received, each with who did it');
reset role;
select test.must_fail(format($$update support_recharge_events set note = 'rewritten' where recharge_id = %L$$, pg_temp.rid('m1')), 'the history cannot be edited', 'cannot be changed');
select test.must_fail(format($$delete from support_recharge_events where recharge_id = %L$$, pg_temp.rid('m1')), '... or removed', 'cannot be changed');
select test.check((select count(*) >= 4 from audit_logs where action = 'SUPPORT_RECHARGE_CREATED') and (select count(*) >= 3 from audit_logs where action = 'SUPPORT_RECHARGE_SUBMITTED')
                  and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_PAYMENT_VERIFIED') and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_PAYMENT_NOT_RECEIVED')
                  and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_REJECTED') and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_BILLING_CORRECTED')
                  and exists (select 1 from audit_logs where action = 'SUPPORT_RECHARGE_UPDATED'), 'created, submitted, updated, corrected, verified, not received and rejected are all in the audit log');
select test.check((select count(*) = 0 from audit_logs where action like 'SUPPORT_RECHARGE%' and metadata::text like '%storage_path%'), 'the audit log holds no storage path');
-- a recharge made before customers and RMs were tracked: it cannot be confirmed (no one to credit), but it can be rejected
insert into support_recharges (kind, department_id, created_by, customer_name, recharge_date, gst_amount, non_gst_amount, recharge_amount, total_amount, billing_type, status)
  values ('PANEL', (select department_id from profiles where id = test.id('sup_plain')), test.id('sup_plain'), 'RCX Legacy Co', current_date, 0, 100, 100, 100, 'NON_GST', 'PENDING') returning id \gset legacy_
insert into rc values ('legacy', json_build_object('id', :'legacy_id')::text);
set role authenticated;
select test.login('acc_m');
select test.must_fail(format($$select recharge_verify_payment('%s', 'RECEIVED')$$, :'legacy_id'), 'a recharge with no customer / RM recorded cannot be confirmed', 'no customer');
select test.check((select recharge_verify_payment(:'legacy_id', 'REJECTED', 'record it again with the customer') ->> 'paymentStatus' = 'REJECTED'), 'but it can be rejected so Support records it again');
select test.check((select count(*) = 0 from jsonb_array_elements(recharge_rm_performance()) x where x ->> 'rmId' is null), 'it never appears in the RM performance');
\echo '--- Support Recharges: done'
