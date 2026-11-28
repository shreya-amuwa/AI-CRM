-- =============================================================================
-- Accounts invoice numbering, checked requirement by requirement (migrations 20261209000100, 20261231000400, 20270313000100):
--   GST invoices  GST/26-27/616     Non-GST invoices  Amuwa/26-27/251
--   separate sequences, the Indian financial year (April-March) from the invoice date, a new year restarts at 001, numbers are made only by the
--   database and only when an invoice is saved (a draft or a preview takes nothing), unique, never reused, older invoices untouched, and the
--   Super Admin can continue a series from the real last number (only ever upwards).
-- Parallel issuing through the API (no duplicate, no gap) is covered in api_integration.test.ts ("generated invoices ... in parallel").
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 171. Invoice numbering requirements'
reset role;
select set_config('request.jwt.claims', '', false);
-- the definitions in force after the latest migrations (older tests re-apply earlier ones)
\i supabase/migrations/20261231000400_part_payment_invoice_suffix.sql
\i supabase/migrations/20270313000100_invoice_series_set_next.sql
\i supabase/migrations/20270313000100_invoice_series_set_next.sql

\echo '   the two formats'
select test.check(private.take_invoice_number('GST', date '2041-05-10') = 'GST/41-42/001' and private.take_invoice_number('GST', date '2041-05-11') ~ '^GST/41-42/[0-9]{3}$',
  'a GST invoice is GST/YY-YY/NNN');
select test.check(private.take_invoice_number('NON_GST', date '2041-05-10') = 'Amuwa/41-42/001' and private.take_invoice_number('NON_GST', date '2041-05-11') ~ '^Amuwa/41-42/[0-9]{3}$',
  'a Non-GST invoice is Amuwa/YY-YY/NNN');
select test.check(private.invoice_number_text('GST', '26-27', 616) = 'GST/26-27/616' and private.invoice_number_text('NON_GST', '26-27', 251) = 'Amuwa/26-27/251',
  'the sequence 616 reads GST/26-27/616 and 251 reads Amuwa/26-27/251');
select test.check(private.invoice_number_text('GST', '26-27', 7) = 'GST/26-27/007' and private.invoice_number_text('GST', '26-27', 1000) = 'GST/26-27/1000', 'padded to three digits, longer numbers kept whole');

\echo '   separate sequences'
select test.check(private.take_invoice_number('GST', date '2042-05-01') = 'GST/42-43/001' and private.take_invoice_number('GST', date '2042-05-02') = 'GST/42-43/002'
                  and private.take_invoice_number('GST', date '2042-05-03') = 'GST/42-43/003', 'three GST invoices count 001, 002, 003');
select test.check(private.take_invoice_number('NON_GST', date '2042-05-04') = 'Amuwa/42-43/001', 'the first Non-GST invoice of the year is 001: the GST ones did not move it');
select test.check(private.take_invoice_number('GST', date '2042-05-05') = 'GST/42-43/004' and private.take_invoice_number('NON_GST', date '2042-05-05') = 'Amuwa/42-43/002', 'each series goes on by itself');

\echo '   the financial year'
select test.check(private.fy_label(date '2043-03-31') = '42-43' and private.fy_label(date '2043-04-01') = '43-44', '31 March is the last day of a year, 1 April the first of the next');
select test.check(private.fy_label(date '2044-02-29') = '43-44' and private.fy_label(date '2044-12-31') = '44-45' and private.fy_label(date '2044-01-01') = '43-44', 'a leap day, December and January fall in the right year');
select test.check(private.fy_label(date '2099-04-01') = '99-00' and private.fy_label(date '2100-03-31') = '99-00', 'and the century change reads 99-00');
select test.check(private.take_invoice_number('GST', date '2051-03-31') = 'GST/50-51/001', 'March: the last day of the year uses the old year');
select test.check(private.take_invoice_number('GST', date '2051-04-01') = 'GST/51-52/001', 'April: the first day of the new year starts again at 001');
select test.check(private.take_invoice_number('GST', date '2051-03-30') = 'GST/50-51/002', 'and the old year goes on where it was (a back-dated invoice)');
select test.check(private.take_invoice_number('NON_GST', date '2051-03-31') = 'Amuwa/50-51/001' and private.take_invoice_number('NON_GST', date '2051-04-01') = 'Amuwa/51-52/001', 'the Non-GST series restarts the same way');

\echo '   a draft or a preview takes no number'
select test.check(private.peek_invoice_number('GST', date '2044-05-01') = 'GST/44-45/001' and private.peek_invoice_number('GST', date '2044-05-01') = 'GST/44-45/001', 'the preview shows the next number, twice the same');
select test.check(not exists (select 1 from invoice_number_series where invoice_type = 'GST' and fy = '44-45'), 'and takes nothing: no counter exists yet');
select test.check(private.take_invoice_number('GST', date '2044-05-01') = 'GST/44-45/001', 'the number is made when the invoice is generated, and it is the one that was shown');
select test.check(private.peek_invoice_number('GST', date '2044-05-01') = 'GST/44-45/002', 'the next preview moves on');

\echo '   unique, never reused, older invoices untouched'
reset role;
insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status)
values (test.id('acc_m'), 'INV-2026-00022', 'Old Co', 'UPLOADED', 100, 'Paid'),
       (test.id('acc_m'), 'GST/45-46/0099', 'Old Co', 'UPLOADED', 100, 'Paid'),
       (test.id('acc_m'), 'Amuwa/45-46/0040', 'Old Co', 'UPLOADED', 100, 'Paid')
on conflict do nothing;   -- (an older test may already have written INV-2026-00022: it stays exactly as it is)
create temp table inv_before as select id, invoice_number, amount, status, created_at from member_invoices where invoice_number in ('INV-2026-00022', 'GST/45-46/0099', 'Amuwa/45-46/0040');
select test.check(private.take_invoice_number('GST', date '2045-05-01') = 'GST/45-46/100' and private.take_invoice_number('NON_GST', date '2045-05-01') = 'Amuwa/45-46/041',
  'a series continues after the highest number already written, in each type');
select test.check((select count(*) = 3 and bool_and(exists (select 1 from member_invoices m where m.id = b.id and m.invoice_number = b.invoice_number and m.amount = b.amount and m.status = b.status and m.created_at = b.created_at))
                     from inv_before b), 'the older invoices (including the old INV-2026-00022 style) are exactly as they were');
-- an issued invoice, then removed: its number is not given out again
insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status)
values (test.id('acc_m'), private.take_invoice_number('GST', date '2046-05-01'), 'Gone Co', 'UPLOADED', 100, 'Pending');
select test.check((select invoice_number from member_invoices where customer_name = 'Gone Co') = 'GST/46-47/001', 'fixture: the first invoice of 2046-47 is 001');
delete from member_invoices where customer_name = 'Gone Co';
select test.check(private.take_invoice_number('GST', date '2046-05-02') = 'GST/46-47/002', 'after that invoice is deleted its number 001 is not used again');
update invoice_number_series set updated_at = now() where fy = '46-47';
select test.check((select last_value = 2 from invoice_number_series where invoice_type = 'GST' and fy = '46-47'), 'the counter never goes back');
select test.must_fail($$insert into member_invoices (owner_id, invoice_number, customer_name, kind, amount, status) values (test.id('acc_m'), 'GST/45-46/100', 'Twin Co', 'UPLOADED', 100, 'Pending'),
                                                                                                                  (test.id('acc_m'), 'gst/45-46/100', 'Twin Co', 'UPLOADED', 100, 'Pending')$$,
  'two issued invoices cannot share a number (whatever the letter case)', 'member_invoices_issued_number_key');
select test.check((select count(distinct n) = 60 and max(n) - min(n) = 59 from (select substring(private.take_invoice_number('GST', date '2047-05-01') from '[0-9]+$')::int n from generate_series(1, 60)) x),
  'sixty numbers in a row are all different and consecutive: no duplicate, no gap');

\echo '   the Super Admin continues a series from the real last number'
set role authenticated;
select test.login('sa');
select test.check((invoice_series_set_next('GST', '48-49', 616) ->> 'nextNumber') = 'GST/48-49/616', 'the Super Admin sets the next GST number to 616');
select test.check((invoice_series_set_next('NON_GST', '48-49', 251) ->> 'nextNumber') = 'Amuwa/48-49/251', 'and the next Non-GST number to 251');
reset role;
select test.check(private.take_invoice_number('GST', date '2048-08-01') = 'GST/48-49/616' and private.take_invoice_number('NON_GST', date '2048-08-01') = 'Amuwa/48-49/251',
  'the next invoices of each type are exactly 616 and 251');
select test.check(private.take_invoice_number('GST', date '2048-08-02') = 'GST/48-49/617' and private.take_invoice_number('NON_GST', date '2048-08-02') = 'Amuwa/48-49/252', 'and carry on from there, separately');
set role authenticated;
select test.login('sa');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', 600)$$, 'a counter cannot be lowered', 'never reused');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', 617)$$, 'nor set to a number that was already issued (616 and 617 are used)', 'next number must be 618 or higher');
select test.check((invoice_series_set_next('GST', '48-49', 618) ->> 'lastIssued')::int = 617, 'asking for the number it is already at changes nothing');
select test.check((invoice_series_set_next('GST', '48-49', 700) ->> 'nextNumber') = 'GST/48-49/700', 'a higher number is fine (a gap on purpose)');
select test.must_fail($$select invoice_series_set_next('GST', '45-46', 50)$$, 'a number at or below what was already issued in the year is refused (GST/45-46/0099 and 100)', 'next number must be 101 or higher');
select test.check((invoice_series_set_next('GST', '45-46', 150) ->> 'nextNumber') = 'GST/45-46/150', 'above it is accepted');
select test.check((invoice_series_set_next('NON_GST', '49-50', 1) ->> 'nextNumber') = 'Amuwa/49-50/001', 'a year without invoices can start at 001');
select test.must_fail($$select invoice_series_set_next('VAT', '48-49', 5)$$, 'only GST or Non-GST', 'Choose GST or Non-GST');
select test.must_fail($$select invoice_series_set_next('GST', '48-50', 5)$$, 'the year is two consecutive years', 'consecutive years');
select test.must_fail($$select invoice_series_set_next('GST', '2048-49', 5)$$, 'and written like 26-27', 'consecutive years');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', 0)$$, 'the number starts at 1', 'from 1 to 99999');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', 100000)$$, 'and has at most five digits', 'from 1 to 99999');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', null)$$, 'and is required', 'from 1 to 99999');
select test.check((select jsonb_array_length(invoice_series_list()) >= 6 and bool_or(x ->> 'fy' = '48-49' and x ->> 'type' = 'GST' and (x ->> 'lastIssued')::int = 699 and x ->> 'nextNumber' = 'GST/48-49/700')
                     from jsonb_array_elements(invoice_series_list()) x), 'the Super Admin lists the counters with the next number of each');
select test.login('acc_m');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', 800)$$, 'Accounts cannot set a series', 'Only the Super Admin');
select test.must_fail($$select invoice_series_list()$$, 'nor list the counters', 'Only the Super Admin');
select test.login('tm_a');
select test.must_fail($$select invoice_series_set_next('GST', '48-49', 800)$$, 'a team member cannot', 'Only the Super Admin');
select test.must_fail($$update invoice_number_series set last_value = 0$$, 'nobody writes the counters directly', 'permission denied');
reset role;
select test.check((select last_value = 699 from invoice_number_series where invoice_type = 'GST' and fy = '48-49'), 'listing and previewing took nothing');
select test.check((select count(*) >= 4 from audit_logs where action = 'INVOICE_SERIES_SET_NEXT' and created_at > now() - interval '5 minutes'), 'every change is audited');
select test.check((select (metadata ->> 'previousNext')::int = 618 and (metadata ->> 'next')::int = 700 from audit_logs where action = 'INVOICE_SERIES_SET_NEXT' and metadata ->> 'next' = '700'
                    order by created_at desc limit 1), 'with the number before and after');
select test.check(private.take_invoice_number('GST', date '2048-09-01') = 'GST/48-49/700', 'the number set last is the next invoice''s');
select test.check((select count(*) = 3 and bool_and(exists (select 1 from member_invoices m where m.id = b.id and m.invoice_number = b.invoice_number and m.amount = b.amount)) from inv_before b),
  'no invoice was changed by any of this');
