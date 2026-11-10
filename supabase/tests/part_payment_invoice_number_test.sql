-- =============================================================================
-- Part payments of one order share one invoice number with a suffix (migration 20261231000400). Runs after payment_invoices_test.sql.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
-- the suites above re-apply older migrations: put the newest ones back on top of them
\i supabase/migrations/20261207000100_payment_invoice_billing_cancel_whatsapp_on.sql
\i supabase/migrations/20261209000100_invoice_series.sql
\i supabase/migrations/20261231000400_part_payment_invoice_suffix.sql
create temp table ppc (name text primary key, id uuid);
create temp table ppr (name text primary key, data jsonb);
grant all on ppc, ppr to authenticated, service_role;
create or replace function test.pp_pay(p_customer uuid, p_ref text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.customer_payments where customer_id = p_customer and reference = p_ref
$$;
grant execute on function test.pp_pay(uuid, text) to authenticated;

\echo '--- 44. Part payments of one order share one invoice number'
set role authenticated;
select test.login('tm_a');
insert into ppc select 'R', create_lead('{"name":"Parts Order","company":"Parts Order Traders","email":"partsorder@example.com","phone":"9820000881","address":"Nanded City, Pune 411068, Maharashtra","leadSource":"Walk-in"}', array['AI_CALLING']);
insert into ppc select 'S', create_lead('{"name":"Single Payment","company":"Single Payment Traders","email":"singlepay@example.com","phone":"9820000882","address":"Nanded City, Pune 411068, Maharashtra","leadSource":"Walk-in"}', array['AI_CALLING']);
-- agreed 14,000 + 18% GST = 16,520 payable
select send_lead_to_accounts((select id from ppc where name = 'R'), 14000, null, 'EXCLUSIVE');
select send_lead_to_accounts((select id from ppc where name = 'S'), 14000, null, 'EXCLUSIVE');
select test.login('acc_m');
select accounts_set_order_gst((select id from ppc where name = 'R'), 18);
select accounts_set_order_gst((select id from ppc where name = 'S'), 18);

-- first part payment
select accounts_record_payment((select id from ppc where name = 'R'), 'PART', 5000, 'UPI', 'PP-1', null, null, true);
insert into ppr select 'p1', accounts_issue_payment_invoice(test.pp_pay((select id from ppc where name = 'R'), 'PP-1'));
select test.check((select (data ->> 'number') ~ '^GST/[0-9]{2}-[0-9]{2}/[0-9]{3,5}-1$' from ppr where name = 'p1'), 'the first part payment gets the order''s number with -1');
select test.check((accounts_issue_payment_invoice(test.pp_pay((select id from ppc where name = 'R'), 'PP-1')) ->> 'number') = (select data ->> 'number' from ppr where name = 'p1'), 'asking again returns the same invoice and number');

-- second part payment: same base, next suffix
select accounts_record_payment((select id from ppc where name = 'R'), 'PART', 5000, 'UPI', 'PP-2', null, null, true);
insert into ppr select 'p2', accounts_issue_payment_invoice(test.pp_pay((select id from ppc where name = 'R'), 'PP-2'));
select test.check((select regexp_replace(b.data ->> 'number', '-[0-9]+$', '') = regexp_replace(a.data ->> 'number', '-[0-9]+$', '') and (b.data ->> 'number') like '%-2'
                     from ppr a, ppr b where a.name = 'p1' and b.name = 'p2'), 'the second part payment keeps the same number with -2');

-- the payment that settles the order continues the family
select accounts_record_payment((select id from ppc where name = 'R'), 'FULL', 6520, 'UPI', 'PP-3', null, null, true);
insert into ppr select 'p3', accounts_issue_payment_invoice(test.pp_pay((select id from ppc where name = 'R'), 'PP-3'));
select test.check((select regexp_replace(b.data ->> 'number', '-[0-9]+$', '') = regexp_replace(a.data ->> 'number', '-[0-9]+$', '') and (b.data ->> 'number') like '%-3'
                     from ppr a, ppr b where a.name = 'p1' and b.name = 'p3'), 'the final payment of that order gets -3');

-- an order paid in one go keeps an ordinary number: the next one of the series, after the parts' base
select accounts_record_payment((select id from ppc where name = 'S'), 'FULL', 16520, 'UPI', 'SP-1', null, null, true);
insert into ppr select 's1', accounts_issue_payment_invoice(test.pp_pay((select id from ppc where name = 'S'), 'SP-1'));
select test.check((select (data ->> 'number') ~ '^GST/[0-9]{2}-[0-9]{2}/[0-9]{3,5}$' from ppr where name = 's1'), 'a single full payment has a number without a suffix');
select test.check((select (substring(s.data ->> 'number' from '/([0-9]+)$'))::int > (substring(a.data ->> 'number' from '/([0-9]+)-1$'))::int
                     from ppr a, ppr s where a.name = 'p1' and s.name = 's1'), 'and it never reuses the base of the part payments');
reset role;
select test.check((select count(distinct invoice_number) = 3 from generated_invoices where customer_id = (select id from ppc where name = 'R')), 'three separate invoices, each with its own unique number');
select test.check((select sum(total_amount) <= 16520 from generated_invoices where customer_id = (select id from ppc where name = 'R')), 'together they never exceed the money received');
select test.check((select last_suffix = 3 from part_payment_invoice_series where customer_id = (select id from ppc where name = 'R')), 'the order''s series row counted three');
select test.check(private.invoice_series_existing_max('GST', (select substring(data ->> 'number' from '^GST/([0-9]{2}-[0-9]{2})/') from ppr where name = 'p1'))
                  >= (select (substring(data ->> 'number' from '/([0-9]+)-1$'))::int from ppr where name = 'p1'), 'a suffixed number counts as taken when a series is rebuilt');
-- a number decided for a part payment is honoured only inside the payment invoice function
select set_config('amuwa.forced_invoice_number', 'GST/99-00/999-9', false);
select test.check(private.take_invoice_number('GST', current_date) <> 'GST/99-00/999-9', 'outside the payment invoice function a forced number is ignored');
select set_config('amuwa.forced_invoice_number', '', false);
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select count(*) from public.part_payment_invoice_series$$, 'the series table is not readable directly', 'permission denied');
reset role;
\i supabase/migrations/20261231000400_part_payment_invoice_suffix.sql
select test.check((select last_suffix = 3 from part_payment_invoice_series where customer_id = (select id from ppc where name = 'R')), 'running the migration again changes nothing');
\echo '=== ALL PART PAYMENT INVOICE NUMBER TESTS PASSED ==='
