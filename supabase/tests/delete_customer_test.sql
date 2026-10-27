-- =============================================================================
-- Deleting a customer (20261113000100) and manual invoice pricing (20261113000200).
-- Runs after the other suites on the same database and re-uses their users.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
-- earlier suites re-apply older migrations (20261102, 20261103); this one redefines a helper they define, so it goes last
-- ... and the newest money model (GST belongs to the order) goes back on top
\i supabase/migrations/20261201000100_order_level_gst.sql
\i supabase/migrations/20261113000200_manual_invoice_pricing.sql
\echo '--- 57. Delete a customer: the Super Admin and the Department Head only; invoices and verified money stay'

reset role;
create temp table dc (name text primary key, id uuid);
grant all on dc to authenticated;
set role authenticated;

select test.login('tm_a');
insert into dc select 'A', create_lead('{"name":"Delete Me A","company":"Delete A Co","phone":"+91 98000 70001","notes":"first note"}', array['AI_CALLING']);
insert into dc select 'B', create_lead('{"name":"Delete Me B","company":"Delete B Co","phone":"+91 98000 70002","notes":"b"}', array['AI_CALLING']);
insert into dc select 'C', create_lead('{"name":"Keep Me C","company":"Keep C Co","phone":"+91 98000 70003","notes":"c"}', array['AI_CALLING']);
insert into dc select 'D', create_lead('{"name":"Other Dept D","company":"Delete D Co","phone":"+91 98000 70004","notes":"d"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from dc where name = 'B'), 5000, null);
select send_lead_to_accounts((select id from dc where name = 'C'), 7000, null);
select test.login('acc_m');
-- Accounts chooses the GST of each order first (0% keeps the rupee figures of these checks as written)
select accounts_set_order_gst((select id from dc where name = 'B'), 0);
select accounts_set_order_gst((select id from dc where name = 'C'), 0);
-- B: money that was recorded but never verified; C: money that Accounts verified
select accounts_record_payment((select id from dc where name = 'B'), 'PART', 1000, 'CASH', null, null, null, false);
select accounts_record_payment((select id from dc where name = 'C'), 'PART', 2000, 'CASH', null, null, null, true);

-- who may
select test.login('tm_a');
select test.must_fail($$select delete_customer((select id from dc where name = 'A'))$$, 'a Team Member cannot delete a customer', 'Super Admin and the Department Head');
select test.login('th_wab');
select test.must_fail($$select delete_customer((select id from dc where name = 'A'))$$, 'nor a Team Lead', 'Super Admin and the Department Head');
select test.login('acc_m');
select test.must_fail($$select delete_customer((select id from dc where name = 'A'))$$, 'nor Accounts staff', 'Super Admin and the Department Head');
select test.login('dh_wbx');
select test.must_fail($$select delete_customer((select id from dc where name = 'A'))$$, 'a Department Head of another department cannot', 'Super Admin and the Department Head');
reset role;
set role anon;
select test.must_fail($$select delete_customer('00000000-0000-0000-0000-000000000000')$$, 'a signed-out visitor cannot', 'permission denied');
reset role;
set role authenticated;
select test.login('sa');
select test.check((select count(*) = 4 from dc d join customers c on c.id = d.id), 'every refusal left the customers in place');

-- the Department Head of the customer's department
select test.login('dh_wab');
create temp table dcr as select delete_customer((select id from dc where name = 'A')) as j;
grant all on dcr to authenticated;
select test.check((select j ->> 'name' = 'Delete A Co' and j ->> 'code' like 'CUS-%' and jsonb_typeof(j -> 'documents') = 'array' from dcr), 'the Department Head deletes a customer of the department and is told which one');
select test.login('sa');
select test.check((select not exists (select 1 from customers where id = (select id from dc where name = 'A'))
                          and not exists (select 1 from lead_conversations where customer_id = (select id from dc where name = 'A'))
                          and not exists (select 1 from customer_activities where customer_id = (select id from dc where name = 'A'))), 'the customer and its conversations and activity are gone');
select test.check((select count(*) = 1 from audit_logs where action = 'CUSTOMER_DELETED' and entity_id = (select id from dc where name = 'A') and metadata -> 'snapshot' ->> 'company' = 'Delete A Co'), 'the deletion is audited once, with a snapshot of the customer');

-- the Super Admin, and money that was never verified goes with the customer
select test.admin_check($q$select (select count(*) = 1 from payment_requests where customer_id = (select id from dc where name = 'B')) and (select count(*) = 1 from customer_payments where customer_id = (select id from dc where name = 'B'))$q$, 'setup: B has a pending request and an unverified payment');
select delete_customer((select id from dc where name = 'B'));
select test.admin_check($q$select (select not exists (select 1 from customers where id = (select id from dc where name = 'B'))
                          and not exists (select 1 from payment_requests where customer_id = (select id from dc where name = 'B'))
                          and not exists (select 1 from customer_payments where customer_id = (select id from dc where name = 'B')))$q$, 'the Super Admin deletes a customer; an unverified payment and the pending request go with it');

-- verified money stays: the customer cannot be deleted
select test.must_fail($$select delete_customer((select id from dc where name = 'C'))$$, 'a customer with a verified payment cannot be deleted', 'verified payment');
select test.admin_check($q$select (select exists (select 1 from customers where id = (select id from dc where name = 'C')) and exists (select 1 from customer_payments where customer_id = (select id from dc where name = 'C') and status = 'VERIFIED'))$q$, 'and its customer and verified payment are untouched');
select test.must_fail($$select delete_customer(gen_random_uuid())$$, 'an unknown customer is not found', 'not found');
select test.login('dh_wab');
select test.must_fail($$select delete_customer((select id from dc where name = 'C'))$$, 'the Department Head cannot delete it either', 'verified payment');

-- an issued invoice stays too
reset role;
insert into dc select 'INV', customer_id from generated_invoices limit 1;
select test.check((select count(*) = 1 from dc where name = 'INV'), 'setup: the database has an issued invoice');
set role authenticated;
select test.login('sa');
select test.must_fail($$select delete_customer((select id from dc where name = 'INV'))$$, 'a customer with an issued invoice cannot be deleted', 'issued invoice');

-- ---------------------------------------------------------------------------
\echo '--- 58. Invoice pricing: the system never divides the budget; Accounts sets each price'
-- ---------------------------------------------------------------------------
select test.login('tm_a');
insert into dc select 'P2', create_lead('{"name":"Two Services","company":"Two Co","phone":"+91 98000 70005","notes":"p2"}', array['AI_CALLING', 'META_ADS_MANAGEMENT']);
insert into dc select 'P1', create_lead('{"name":"One Service","company":"One Co","phone":"+91 98000 70006","notes":"p1"}', array['AI_CALLING']);
select send_lead_to_accounts((select id from dc where name = 'P2'), 12, null);
select send_lead_to_accounts((select id from dc where name = 'P1'), 12, null);
select test.login('acc_m');
select accounts_set_order_gst((select id from dc where name = 'P2'), 0);
select accounts_set_order_gst((select id from dc where name = 'P1'), 0);
create temp table pf2 as select accounts_invoice_prefill((select id from dc where name = 'P2')) as j;
create temp table pf1 as select accounts_invoice_prefill((select id from dc where name = 'P1')) as j;
grant all on pf2, pf1 to authenticated;
select test.check((select jsonb_array_length(j -> 'lines') = 2 from pf2), 'two services: both are listed on the invoice');
select test.check((select not exists (select 1 from jsonb_array_elements(j -> 'lines') l where jsonb_typeof(l -> 'baseAmount') = 'number') from pf2),
  'two services: no amount is filled in (a budget of 12 is not split into 6 and 6)');
select test.check((select jsonb_array_length(j -> 'lines') = 1 and jsonb_typeof(j -> 'lines' -> 0 -> 'baseAmount') = 'number' from pf1), 'one service: its line carries the balance, nothing is divided');

-- Accounts sets the prices; together they may not pass the budget Sales agreed (12)
reset role;
create or replace function test.inv_two(p_customer uuid, p_a numeric, p_b numeric) returns jsonb language sql as $$
  select test.inv_payload(p_customer, 1) || jsonb_build_object('lines', jsonb_build_array(
    jsonb_build_object('serviceCode', 'AI_CALLING', 'particulars', 'AI Calling', 'hsnSac', '998313', 'taxRate', 0, 'quantity', '1 Nos', 'baseAmount', p_a),
    jsonb_build_object('serviceCode', 'META_ADS_MANAGEMENT', 'particulars', 'Meta Ads', 'hsnSac', '998313', 'taxRate', 0, 'quantity', '1 Nos', 'baseAmount', p_b)))
$$;
grant execute on function test.inv_two(uuid, numeric, numeric) to authenticated;
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select accounts_issue_invoice(gen_random_uuid(), test.inv_two((select id from dc where name = 'P2'), 7, 8))$$, 'two prices that together pass the budget (7 + 8 > 12) are refused', 'agreed|total');
create temp table pinv as select accounts_issue_invoice(gen_random_uuid(), test.inv_two((select id from dc where name = 'P2'), 4, 8)) as j;
grant all on pinv to authenticated;
select test.admin_check($q$select exists (select 1 from generated_invoices g where g.customer_id = (select id from dc where name = 'P2') and g.subtotal = 12
                                              and (select count(*) = 2 and min(i.base_amount) = 4 and max(i.base_amount) = 8 from generated_invoice_items i where i.invoice_id = g.invoice_id))$q$,
  'Accounts prices the two services differently (4 and 8): the invoice keeps those prices and totals what Accounts entered');
reset role;
