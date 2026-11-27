-- =============================================================================
-- Support Recharges (migration 20270228000200): Panel and Message recharges with a payment screenshot.
-- Uses rls_test.sql's Wabastore Department Head (dh_wab), Support Team Lead (sup_th), Support members (sup_plain, sup_b), a Sales member (tm_a), the
-- Super Admin (sa), a Sales Team Lead (th_wab) and another department's Department Head (dh_wbx). Synthetic data only; safe to run again.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 160. Support Recharges'
reset role;
\i supabase/migrations/20270228000200_support_recharges.sql
\i supabase/migrations/20270228000200_support_recharges.sql

-- a re-run starts clean (these tables are never deleted from by the product; the test owns its own rows)
update support_recharge_files set recharge_id = null where file_name like 'rch-%';
delete from support_recharges where customer_name like 'RCH %';
delete from support_recharge_files where file_name like 'rch-%';
create temp table rc (k text primary key, v text);
grant all on rc to authenticated, anon, service_role;
create function pg_temp.rv(p_k text) returns text language sql stable as $$ select v from rc where k = p_k $$;
grant execute on function pg_temp.rv(text) to authenticated, anon;

-- a ready screenshot for the person signed in (begin + complete, as the API does after it stored the object)
create function pg_temp.shot(p_name text) returns uuid language plpgsql as $$
declare
  f public.support_recharge_files;
begin
  f := public.recharge_begin_upload(p_name, 'image/png', 12345);
  perform public.recharge_complete_upload(f.id, 12345, 'etag');
  return f.id;
end $$;
grant execute on function pg_temp.shot(text) to authenticated;

\echo '   the tables and helpers cannot be reached directly'
select test.check(not has_table_privilege('authenticated', 'public.support_recharges', 'select')
                  and not has_table_privilege('authenticated', 'public.support_recharge_files', 'select')
                  and not has_table_privilege('anon', 'public.support_recharges', 'select'), 'the recharge tables have no direct grants');
select test.check((select relrowsecurity from pg_class where oid = 'public.support_recharges'::regclass)
                  and (select relrowsecurity from pg_class where oid = 'public.support_recharge_files'::regclass), 'row level security is on for both tables');
select test.check(not has_function_privilege('anon', 'public.recharge_list(text, text, text, date, date, numeric, numeric, integer, integer)', 'execute')
                  and not has_function_privilege('anon', 'public.recharge_create(jsonb)', 'execute')
                  and not has_function_privilege('anon', 'public.recharge_attachment_download(uuid)', 'execute'), 'an anonymous caller cannot run the recharge functions');
select test.check(not has_function_privilege('authenticated', 'private.recharge_visible(public.support_recharges)', 'execute'), 'the private helpers are not callable');
select test.check((select count(*) = 10 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname like 'recharge\_%' and p.prosecdef and p.proconfig @> array['search_path=""']),
                  'every public recharge function is SECURITY DEFINER with an empty search_path');

\echo '   only Support staff may use recharges'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select recharge_list('PANEL')$$, 'a Sales member cannot list recharges', 'FORBIDDEN');
select test.must_fail($$select recharge_begin_upload('rch-x.png', 'image/png', 100)$$, '... nor upload a screenshot', 'FORBIDDEN');
select test.must_fail($$select recharge_create('{"kind":"PANEL"}'::jsonb)$$, '... nor create one', 'FORBIDDEN');
select test.login('th_wab');
select test.must_fail($$select recharge_list('PANEL')$$, 'a Sales Team Lead cannot list recharges', 'FORBIDDEN');
select test.must_fail($$select recharge_begin_upload('rch-x.png', 'image/png', 100)$$, '... nor upload', 'FORBIDDEN');
select test.login('sup_plain');
select test.check((select (recharge_list('PANEL') ->> 'canCreate')::boolean and recharge_list('PANEL') ->> 'role' = 'MEMBER'), 'a Support member may create');
select test.check((select recharge_list('PANEL') -> 'summary' ->> 'totalRecharges' = '0'), 'nothing yet');

\echo '   create a Panel recharge: screenshot required, money checked in the database'
select test.login('sup_plain');
insert into rc select 'f1', pg_temp.shot('rch-panel-1.png')::text;
select test.must_fail($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','100','nonGstAmount','0'))$$,
  'the screenshot is required', 'screenshot');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','OTHER','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'the kind must be Panel or Message', 'Panel Recharge or Message Recharge');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','R','rechargeDate',current_date,'gstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a 1-letter customer name is refused', 'customer name');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date + 5,'gstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a date in the future is refused', 'future');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate','not a date','gstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a bad date is refused', 'recharge date');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','-5','nonGstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a negative amount is refused', 'negative');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','abc','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a text amount is refused', 'numbers');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','0','nonGstAmount','0','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a zero total is refused', 'above zero');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','10.123','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'three decimals are refused', '2 decimal');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','100','nonGstAmount','50','totalAmount','999','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'a total that is not GST + non-GST is refused', 'must equal');
select test.must_fail($$select recharge_begin_upload('rch-x.gif', 'image/gif', 100)$$, 'a GIF cannot be the proof', 'image');
select test.must_fail($$select recharge_begin_upload('rch-x.exe', 'application/x-msdownload', 100)$$, 'an executable cannot be the proof', 'image');
select test.must_fail($$select recharge_begin_upload('rch-x.png', 'image/png', 6000000)$$, 'a file over 5 MB is refused', '5 MB');
select test.must_fail($$select recharge_begin_upload('rch-x.png', 'image/png', 0)$$, 'an empty file is refused', '5 MB');
select test.must_fail($$select recharge_begin_upload('', 'image/png', 100)$$, 'a file without a name is refused', 'name');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','100','screenshotId','%s'))$$, gen_random_uuid()),
  'a screenshot that does not exist is refused', 'screenshot');

insert into rc select 'p1', recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','118.00','gstDetails','18% GST on 100',
  'nonGstAmount','500.50','nonGstDetails','Wallet top-up','totalAmount','618.50','remarks','paid by UPI','screenshotId',pg_temp.rv('f1'),'requestId','11111111-1111-1111-1111-111111111111'))::text;
select test.check((select (v::jsonb ->> 'totalAmount')::numeric = 618.50 and v::jsonb ->> 'kind' = 'PANEL' and v::jsonb ->> 'status' = 'PENDING'
                          and v::jsonb ->> 'reference' ~ '^PRC-[0-9]{5}$' and (v::jsonb -> 'screenshot' ->> 'name') = 'rch-panel-1.png' from rc where k = 'p1'), 'a Panel recharge is saved Pending with its reference and screenshot');
select test.check((select (v::jsonb ->> 'canEdit')::boolean and v::jsonb -> 'nextStatuses' = '[]'::jsonb from rc where k = 'p1'), 'the recorder can edit, and cannot change the status');
select test.check((select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Alpha','rechargeDate',current_date,'gstAmount','118.00','nonGstAmount','500.50',
  'screenshotId',gen_random_uuid(),'requestId','11111111-1111-1111-1111-111111111111')) ->> 'id' = (select v::jsonb ->> 'id' from rc where k = 'p1')),
  'the same request id returns the record already saved (no double entry)');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Beta','rechargeDate',current_date,'gstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'one screenshot cannot be reused for a second recharge', 'screenshot');
select test.login('sup_b');
select test.must_fail(format($$select recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Beta','rechargeDate',current_date,'gstAmount','100','screenshotId','%s'))$$, pg_temp.rv('f1')),
  'nobody can use somebody else''s screenshot', 'screenshot');

\echo '   Message recharges are separate from Panel recharges'
select test.login('sup_plain');
insert into rc select 'f2', pg_temp.shot('rch-msg-1.png')::text;
insert into rc select 'm1', recharge_create(jsonb_build_object('kind','MESSAGE','customerName','RCH Gamma','rechargeDate',current_date - 3,'gstAmount','0','nonGstAmount','200',
  'screenshotId',pg_temp.rv('f2')))::text;
insert into rc select 'f3', pg_temp.shot('rch-panel-2.png')::text;
insert into rc select 'p2', recharge_create(jsonb_build_object('kind','PANEL','customerName','RCH Delta 50% off','rechargeDate',current_date - 10,'gstAmount','1000','nonGstAmount','0',
  'screenshotId',pg_temp.rv('f3')))::text;
select test.check((select v::jsonb ->> 'reference' ~ '^MRC-[0-9]{5}$' and v::jsonb ->> 'kind' = 'MESSAGE' from rc where k = 'm1'), 'a Message recharge has its own reference series');
select test.check((select jsonb_array_length(recharge_list('PANEL') -> 'items') = 2 and recharge_list('PANEL') -> 'summary' ->> 'totalRecharges' = '2'), 'the Panel tab shows only Panel recharges');
select test.check((select jsonb_array_length(recharge_list('MESSAGE') -> 'items') = 1 and recharge_list('MESSAGE') -> 'items' -> 0 ->> 'customerName' = 'RCH Gamma'), 'the Message tab shows only Message recharges');
select test.check((select (recharge_list('PANEL') -> 'summary' ->> 'totalAmount')::numeric = 1618.50 and (recharge_list('PANEL') -> 'summary' ->> 'totalGst')::numeric = 1118.00
                          and (recharge_list('PANEL') -> 'summary' ->> 'totalNonGst')::numeric = 500.50 and recharge_list('PANEL') -> 'summary' ->> 'pending' = '2'), 'Panel summary: total, GST, non-GST and pending');
select test.check((select (recharge_list('MESSAGE') -> 'summary' ->> 'totalAmount')::numeric = 200 and (recharge_list('MESSAGE') -> 'summary' ->> 'totalGst')::numeric = 0), 'Message summary is its own');
select test.must_fail($$select recharge_list('BOTH')$$, 'a list needs a valid kind', 'Panel Recharge or Message Recharge');
select test.must_fail($$select recharge_list('PANEL', null, 'DONE')$$, 'a list needs a valid status', 'valid status');

\echo '   search, date, amount, status filters and pagination'
select test.check((select jsonb_array_length(recharge_list('PANEL', 'alp') -> 'items') = 1 and recharge_list('PANEL', 'alp') ->> 'total' = '1'), 'search by part of the customer name');
select test.check((select recharge_list('PANEL', 'ALPHA') ->> 'total' = '1'), '... not case sensitive');
select test.check((select recharge_list('PANEL', '50%') ->> 'total' = '1' and recharge_list('PANEL', '%') ->> 'total' = '1'), 'a % in the search is text, not a wildcard');
select test.check((select recharge_list('PANEL', '_') ->> 'total' = '0'), 'a _ in the search is text, not a wildcard');
select test.check((select recharge_list('PANEL', null, null, current_date - 5, current_date) ->> 'total' = '1'), 'date from / to');
select test.check((select recharge_list('PANEL', null, null, null, null, 700, null) ->> 'total' = '1' and recharge_list('PANEL', null, null, null, null, null, 700) ->> 'total' = '1'), 'amount from / to');
select test.check((select recharge_list('PANEL', null, 'COMPLETED') ->> 'total' = '0' and recharge_list('PANEL', null, 'PENDING') ->> 'total' = '2'), 'status filter');
select test.check((select jsonb_array_length(recharge_list('PANEL', null, null, null, null, null, null, 1, 0) -> 'items') = 1 and recharge_list('PANEL', null, null, null, null, null, null, 1, 0) ->> 'total' = '2'
                          and recharge_list('PANEL', null, null, null, null, null, null, 1, 0) -> 'items' -> 0 ->> 'customerName' = 'RCH Alpha'
                          and recharge_list('PANEL', null, null, null, null, null, null, 1, 1) -> 'items' -> 0 ->> 'customerName' = 'RCH Delta 50% off'), 'pagination: newest first, total stays 2');
select test.check((select recharge_list('PANEL', null, null, null, null, null, null, 5000, -4) ->> 'limit' = '100' and recharge_list('PANEL', null, null, null, null, null, null, 5000, -4) ->> 'offset' = '0'), 'limit and offset are clamped');

\echo '   who sees which record'
select test.login('sup_b');
select test.check((select recharge_list('PANEL') ->> 'total' = '0' and recharge_list('MESSAGE') ->> 'total' = '0'), 'another Support member sees none of them');
select test.must_fail(format($$select recharge_get('%s')$$, (select v::jsonb ->> 'id' from rc where k = 'p1')), '... nor opens one by its id', 'NOT_FOUND');
select test.login('sup_th');
select test.check((select recharge_list('PANEL') ->> 'total' = '2' and recharge_list('MESSAGE') ->> 'total' = '1' and recharge_list('PANEL') ->> 'role' = 'LEAD'), 'the Team Lead sees the team''s recharges');
select test.login('dh_wab');
select test.check((select recharge_list('PANEL') ->> 'total' = '2' and recharge_list('PANEL') ->> 'role' = 'HEAD'), 'the Support Department Head sees the department''s recharges');
select test.login('sa');
select test.check((select recharge_list('PANEL') ->> 'total' = '2' and recharge_list('PANEL') ->> 'role' = 'SUPER_ADMIN' and not (recharge_list('PANEL') ->> 'canCreate')::boolean), 'the Super Admin sees all, and does not record');
select test.must_fail($$select recharge_create('{"kind":"PANEL"}'::jsonb)$$, 'the Super Admin does not create recharges', 'FORBIDDEN');
select test.login('dh_wbx');
select test.check((select recharge_list('PANEL') ->> 'total' = '0' and recharge_list('MESSAGE') ->> 'total' = '0'), 'another department''s head sees none of this department''s recharges');
select test.must_fail(format($$select recharge_get('%s')$$, (select v::jsonb ->> 'id' from rc where k = 'p1')), '... and cannot open one by its id', 'NOT_FOUND');
select test.must_fail(format($$select recharge_set_status('%s', 'VERIFIED')$$, (select v::jsonb ->> 'id' from rc where k = 'p1')), '... nor change its status', 'NOT_FOUND');
select test.must_fail(format($$select recharge_update('%s', '{"customerName":"RCH Hack","rechargeDate":"2026-01-01","gstAmount":"1"}'::jsonb)$$, (select v::jsonb ->> 'id' from rc where k = 'p1')), '... nor edit it', 'NOT_FOUND');

\echo '   editing'
select test.login('sup_b');
select test.must_fail(format($$select recharge_update('%s', '{"customerName":"RCH Hack","rechargeDate":"2026-01-01","gstAmount":"1"}'::jsonb)$$, (select v::jsonb ->> 'id' from rc where k = 'p1')),
  'another member cannot edit it', 'NOT_FOUND');
select test.login('sup_plain');
select test.check((select recharge_update((select v::uuid from (select (v::jsonb ->> 'id') v from rc where k = 'p1') x), jsonb_build_object('customerName','RCH Alpha Two','rechargeDate',current_date,
  'gstAmount','118','nonGstAmount','500.50','remarks','fixed')) ->> 'customerName' = 'RCH Alpha Two'), 'the recorder edits a Pending recharge');
select test.must_fail(format($$select recharge_update('%s', jsonb_build_object('customerName','RCH Alpha Two','rechargeDate',current_date,'gstAmount','1','totalAmount','5'))$$, (select v::jsonb ->> 'id' from rc where k = 'p1')),
  'an edit is checked like a create', 'must equal');
select test.must_fail(format($$select recharge_set_status('%s', 'VERIFIED')$$, (select v::jsonb ->> 'id' from rc where k = 'p1')), 'a member cannot change the status', 'cannot move');

\echo '   status: only the lead / head / Super Admin, never on their own record'
select test.login('sup_th');
select test.check((select recharge_set_status((select (v::jsonb ->> 'id')::uuid from rc where k = 'p1'), 'VERIFIED', 'checked against the bank') ->> 'status' = 'VERIFIED'), 'the Team Lead verifies');
select test.check((select recharge_get((select (v::jsonb ->> 'id')::uuid from rc where k = 'p1')) ->> 'statusNote' = 'checked against the bank'), '... with a note, and who did it');
select test.must_fail(format($$select recharge_set_status('%s', 'PENDING')$$, (select v::jsonb ->> 'id' from rc where k = 'p2')), 'a status cannot be set to the one it already has', 'cannot move');
select test.must_fail(format($$select recharge_set_status('%s', 'REJECTED')$$, (select v::jsonb ->> 'id' from rc where k = 'p2')), 'rejecting needs a reason', 'why');
select test.must_fail(format($$select recharge_set_status('%s', 'WHATEVER')$$, (select v::jsonb ->> 'id' from rc where k = 'p2')), 'an unknown status is refused', 'valid status');
select test.login('sup_plain');
select test.must_fail(format($$select recharge_update('%s', jsonb_build_object('customerName','RCH Alpha Two','rechargeDate',current_date,'gstAmount','1'))$$, (select v::jsonb ->> 'id' from rc where k = 'p1')),
  'the recorder cannot edit a Verified recharge', 'no longer');
select test.login('sup_th');
select test.check((select recharge_update((select (v::jsonb ->> 'id')::uuid from rc where k = 'p1'), jsonb_build_object('customerName','RCH Alpha Two','rechargeDate',current_date,
  'gstAmount','118','nonGstAmount','500.50','remarks','lead corrected')) ->> 'remarks' = 'lead corrected'), 'the Team Lead can still edit a Verified recharge');
select test.check((select recharge_set_status((select (v::jsonb ->> 'id')::uuid from rc where k = 'p1'), 'COMPLETED') ->> 'status' = 'COMPLETED'), 'Verified -> Completed');
select test.must_fail(format($$select recharge_set_status('%s', 'PENDING')$$, (select v::jsonb ->> 'id' from rc where k = 'p1')), 'a Completed recharge is final for the Team Lead', 'cannot move');
select test.must_fail(format($$select recharge_update('%s', jsonb_build_object('customerName','RCH Alpha Two','rechargeDate',current_date,'gstAmount','1'))$$, (select v::jsonb ->> 'id' from rc where k = 'p1')),
  '... and cannot be edited', 'no longer');
select test.login('dh_wab');
select test.check((select recharge_set_status((select (v::jsonb ->> 'id')::uuid from rc where k = 'p2'), 'REJECTED', 'amount does not match the bank') ->> 'status' = 'REJECTED'), 'the Department Head rejects with a reason');
select test.login('sup_plain');
select test.check((select recharge_update((select (v::jsonb ->> 'id')::uuid from rc where k = 'p2'), jsonb_build_object('customerName','RCH Delta 50% off','rechargeDate',current_date - 10,
  'gstAmount','1000','nonGstAmount','0','remarks','amount rechecked')) ->> 'status' = 'PENDING'), 'the recorder corrects a Rejected recharge and it goes back to Pending');
select test.login('sa');
select test.check((select recharge_set_status((select (v::jsonb ->> 'id')::uuid from rc where k = 'p1'), 'REJECTED', 'duplicate payment') ->> 'status' = 'REJECTED'), 'the Super Admin can reopen / change any status');
select test.check((select recharge_list('PANEL') -> 'summary' ->> 'rejected' = '1' and recharge_list('PANEL') -> 'summary' ->> 'pending' = '1' and recharge_list('PANEL') -> 'summary' ->> 'completed' = '0'), 'the summary follows the statuses');
select test.check((select recharge_list('PANEL', null, 'REJECTED') ->> 'total' = '1' and recharge_list('PANEL', null, 'REJECTED') -> 'summary' ->> 'totalRecharges' = '2'), 'the status filter narrows the table, not the cards');

\echo '   a lead cannot approve their own record'
select test.login('sup_th');
insert into rc select 'f4', pg_temp.shot('rch-lead-1.png')::text;
insert into rc select 'l1', recharge_create(jsonb_build_object('kind','MESSAGE','customerName','RCH Lead Own','rechargeDate',current_date,'gstAmount','0','nonGstAmount','10','screenshotId',pg_temp.rv('f4')))::text;
select test.must_fail(format($$select recharge_set_status('%s', 'VERIFIED')$$, (select v::jsonb ->> 'id' from rc where k = 'l1')), 'a Team Lead cannot verify the recharge they recorded', 'cannot move');
select test.login('dh_wab');
select test.check((select recharge_set_status((select (v::jsonb ->> 'id')::uuid from rc where k = 'l1'), 'VERIFIED') ->> 'status' = 'VERIFIED'), 'the Department Head can');

\echo '   the screenshot: private, checked on every view, audited'
select test.login('sup_plain');
select test.check(((select (recharge_attachment_download(pg_temp.rv('f1')::uuid)).file_name) = 'rch-panel-1.png'), 'the recorder opens the screenshot');
select test.login('sup_th');
select test.check(((select (recharge_attachment_download(pg_temp.rv('f1')::uuid)).storage_bucket) = 'support-recharge-files'), 'the Team Lead opens it (private bucket)');
select test.login('sup_b');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f1')), 'another Support member cannot open it', 'NOT_FOUND');
select test.login('tm_a');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f1')), 'a Sales member cannot open it', 'FORBIDDEN');
select test.login('dh_wbx');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f1')), 'another department''s head cannot open it', 'NOT_FOUND');
select test.login('sup_plain');
insert into rc select 'f5', pg_temp.shot('rch-draft.png')::text;
select test.check(((select (recharge_attachment_download(pg_temp.rv('f5')::uuid)).file_name) = 'rch-draft.png'), 'a screenshot not attached yet opens for its uploader');
select test.login('sup_th');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, pg_temp.rv('f5')), '... and for nobody else', 'NOT_FOUND');
select test.login('sup_plain');
select test.must_fail(format($$select recharge_attachment_download('%s')$$, gen_random_uuid()), 'an unknown file is not found', 'NOT_FOUND');
select test.must_fail(format($$select recharge_complete_upload('%s', 100)$$, pg_temp.rv('f1')), 'a finished upload cannot be completed twice', 'NOT_FOUND');
-- replacing the screenshot of a recharge keeps the old file but shows the new one
select test.check((select recharge_get((select (v::jsonb ->> 'id')::uuid from rc where k = 'p2')) -> 'screenshot' ->> 'name' = 'rch-panel-2.png'), 'before: the first screenshot is shown');
select test.check((select recharge_update((select (v::jsonb ->> 'id')::uuid from rc where k = 'p2'), jsonb_build_object('customerName','RCH Delta 50% off','rechargeDate',current_date - 10,
  'gstAmount','1000','nonGstAmount','0','screenshotId',pg_temp.rv('f5'))) -> 'screenshot' ->> 'name' = 'rch-draft.png'), 'a new screenshot replaces it');
reset role;
select test.check((select count(*) = 2 from support_recharge_files where recharge_id = (select (v::jsonb ->> 'id')::uuid from rc where k = 'p2')), 'the replaced file is kept, not deleted');
select test.check((select count(*) >= 3 from audit_logs where action = 'SUPPORT_RECHARGE_CREATED'), 'creates are in the audit log');
select test.check((select count(*) >= 5 from audit_logs where action = 'SUPPORT_RECHARGE_STATUS'), 'status changes are in the audit log');
select test.check((select count(*) >= 3 from audit_logs where action = 'SUPPORT_RECHARGE_SCREENSHOT_VIEWED' and actor_id in (test.id('sup_plain'), test.id('sup_th'))), 'screenshot views are in the audit log');
select test.check((select count(*) = 0 from audit_logs where action like 'SUPPORT_RECHARGE%' and metadata::text like '%storage_path%'), 'the audit log holds no storage path');
select test.check((select count(*) = 0 from support_recharges where total_amount <> gst_amount + non_gst_amount), 'the total is always GST + non-GST');
select test.must_fail($$update support_recharges set total_amount = total_amount + 1$$, 'the table itself refuses a total that does not add up', 'support_recharges_total_ck');
\echo '--- Support Recharges: done'
