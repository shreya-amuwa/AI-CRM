-- =============================================================================
-- Migration 20261209000100: GST and non-GST invoices have separate numbering series per Indian financial year.
-- Runs late on the same database. (Issuing through the API - parallel requests, replay, PDF - is covered by the API tests.)
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 79. Invoice numbering series'
reset role;
\i supabase/migrations/20261209000100_invoice_series.sql

\echo '   the financial year follows 1 April - 31 March'
select test.check(private.fy_label(date '2026-03-31') = '25-26' and private.fy_label(date '2026-04-01') = '26-27'
               and private.fy_label(date '2026-12-31') = '26-27' and private.fy_label(date '2027-01-01') = '26-27'
               and private.fy_label(date '2027-03-31') = '26-27' and private.fy_label(date '2027-04-01') = '27-28'
               and private.fy_label(date '2099-04-01') = '99-00', 'the year part of a number rolls over on 1 April (and across a century)');
select test.check(private.invoice_type_of(0) = 'NON_GST' and private.invoice_type_of(null) = 'NON_GST' and private.invoice_type_of(0.01) = 'GST' and private.invoice_type_of(2880) = 'GST', 'any tax above zero makes it a GST invoice');

\echo '   two series, each in order, and each financial year starts again at 001'
select test.check(private.take_invoice_number('GST', date '2030-04-01') = 'GST/30-31/001', 'the first GST invoice of 2030-31');
select test.check(private.take_invoice_number('GST', date '2030-09-15') = 'GST/30-31/002', 'the next one');
select test.check(private.take_invoice_number('NON_GST', date '2030-09-15') = 'Amuwa/30-31/001', 'the non-GST series is separate: it starts at 001 itself');
select test.check(private.take_invoice_number('GST', date '2031-03-31') = 'GST/30-31/003', '31 March still belongs to 2030-31');
select test.check(private.take_invoice_number('GST', date '2031-04-01') = 'GST/31-32/001', '1 April starts 2031-32 at 001');
select test.check(private.take_invoice_number('NON_GST', date '2031-04-01') = 'Amuwa/31-32/001', 'for the non-GST series too');
select test.check(private.take_invoice_number('GST', date '2030-10-01') = 'GST/30-31/004', 'a back-dated invoice takes the next number of ITS year; the other year is not disturbed');
select test.check((select last_value from invoice_number_series where invoice_type = 'GST' and fy = '31-32') = 1, 'the new year was not touched by that');
select test.must_fail($$select private.take_invoice_number('OTHER', date '2030-04-01')$$, 'an unknown type is refused', 'Unknown invoice type');
select test.must_fail($$select private.take_invoice_number('GST', null)$$, 'a missing date is refused', 'date is missing');

\echo '   a number is used only if the invoice is saved (no gaps), and is never given back'
do $$
begin
  begin
    perform private.take_invoice_number('GST', date '2032-05-01');   -- 001 inside a sub-transaction ...
    raise exception 'the invoice could not be saved';                -- ... that is rolled back
  exception when others then null;
  end;
end $$;
select test.check(private.take_invoice_number('GST', date '2032-05-01') = 'GST/32-33/001', 'a refused invoice leaves no gap: the next one gets 001');
select test.check((select last_value from invoice_number_series where invoice_type = 'GST' and fy = '32-33') = 1, 'the counter says so');

\echo '   the next number continues after any number that already exists, and skips a taken one'
reset role;
insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status)
values (test.id('acc_m'), 'GST/35-36/007', 'Uploaded Co', 'UPLOADED', 100, 'Pending'),
       (test.id('acc_m'), 'GST/35-36/003', 'Uploaded Co', 'UPLOADED', 100, 'Pending'),
       (test.id('acc_m'), 'Amuwa/36-37/012', 'Uploaded Co', 'UPLOADED', 100, 'Pending');
select test.check(private.take_invoice_number('GST', date '2035-06-01') = 'GST/35-36/008', 'a new series continues after the highest existing number of its shape');
select test.check(private.take_invoice_number('NON_GST', date '2036-06-01') = 'Amuwa/36-37/013', 'and so does the non-GST one');
insert into invoice_number_series (invoice_type, fy, last_value) values ('GST', '37-38', 5);
insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status) values (test.id('acc_m'), 'gst/37-38/006', 'Uploaded Co', 'UPLOADED', 100, 'Pending');
select test.check(private.take_invoice_number('GST', date '2037-06-01') = 'GST/37-38/007', 'a number already used (even in another letter case) is skipped');
select test.check((select last_value from invoice_number_series where invoice_type = 'GST' and fy = '37-38') = 7, 'and the counter moved past it');
select test.check(private.take_invoice_number('GST', date '2037-06-02') = 'GST/37-38/008', 'the next call carries on from there');

\echo '   the preview takes nothing'
select test.check(private.peek_invoice_number('GST', date '2038-04-01') = 'GST/38-39/001' and private.peek_invoice_number('GST', date '2038-04-01') = 'GST/38-39/001'
               and not exists (select 1 from invoice_number_series where fy = '38-39'), 'the preview is the same every time and creates no counter');
select test.check(private.peek_invoice_number('GST', date '2030-04-01') = 'GST/30-31/005', 'it shows the number the next invoice will get');
select test.check(private.take_invoice_number('GST', date '2030-04-01') = 'GST/30-31/005', 'and that is the number it gets');

\echo '   a number never exceeds 16 characters'
insert into invoice_number_series (invoice_type, fy, last_value) values ('NON_GST', '40-41', 999);
select test.check(private.take_invoice_number('NON_GST', date '2040-06-01') = 'Amuwa/40-41/1000' and length('Amuwa/40-41/1000') = 16, '1000 still fits (16 characters)');
select test.must_fail($$update invoice_number_series set last_value = 9999 where invoice_type = 'NON_GST' and fy = '40-41'; select private.take_invoice_number('NON_GST', date '2040-07-01')$$, 'a 17-character number is refused, never cut short', 'is full');
select test.check((select max(length(invoice_number)) <= 16 from member_invoices where invoice_number ~ '^(GST|Amuwa)/'), 'every number of the new series is within 16 characters');

\echo '   nobody but the database touches the series'
set role authenticated;
select test.login('acc_m');
select test.must_fail($$select * from invoice_number_series$$, 'Accounts cannot read the counters', 'permission denied');
select test.must_fail($$update invoice_number_series set last_value = 0$$, 'nor reset them', 'permission denied');
select test.must_fail($$select private.take_invoice_number('GST', current_date)$$, 'nor take a number directly', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select * from invoice_number_series$$, 'a visitor has nothing', 'permission denied');
reset role;

\echo '   existing numbers and the unique rule are untouched'
insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status) values (test.id('acc_m'), 'GST/30-31/001', 'First', 'GENERATED', 1, 'Pending');
select test.must_fail($$insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status) values (test.id('acc_m'), 'gst/30-31/001', 'Dup', 'GENERATED', 1, 'Pending')$$, 'a number cannot be issued twice, in any letter case (database rule)', 'duplicate key');
