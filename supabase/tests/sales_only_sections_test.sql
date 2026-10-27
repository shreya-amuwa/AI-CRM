-- =============================================================================
-- Telecaller Sheets and Service Prices are for the SALES side (migration 20261130000100): a Support Department Head and a Support Team Lead are refused
-- by the functions AND by the table policies; the Sales side keeps everything; nothing stored is changed.
-- Runs after the telecaller and Business Associate suites (same database, their users and data).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 61. Sales-only: Telecaller Sheets and Service Prices'
reset role;
create temp table so (k text primary key, v text);
grant all on so to authenticated;
-- a sheet and a price exist (the telecaller suite made the sheets; make sure a price exists)
insert into public.service_prices (service_code, unit_label, unit_price, gst_rate, max_discount_pct, is_active)
  select code, 'one time', 1000, 18, 10, true from public.crm_services where is_active order by sort_order limit 1 on conflict (service_code) do nothing;
insert into so select 'lists', count(*)::text from public.telecaller_contact_lists;
insert into so select 'contacts', count(*)::text from public.telecaller_contacts;
insert into so select 'prices', count(*)::text from public.service_prices;
insert into so select 'dh_side', coalesce(head_division, '-') from public.profiles where id = test.id('dh_wab');
select test.check((select v::int > 0 from so where k = 'lists') and (select v::int > 0 from so where k = 'prices'), 'fixtures: sheets and prices exist');
create or replace function test.pcode() returns text language sql stable as $$ select service_code from public.service_prices order by service_code limit 1 $$;
grant execute on function test.pcode() to authenticated;

-- ---------------------------------------------------------------- the Sales side keeps everything
update public.profiles set head_division = 'SALES' where id = test.id('dh_wab');
set role authenticated;
select test.login('dh_wab');
select test.check((select jsonb_array_length(service_prices_list()) > 0), 'Sales head: reads the price list');
select test.check((select (service_price_save(test.pcode(), 'one time', 1000, 18, 10, true) ->> 'serviceCode') is not null), 'Sales head: changes a price');
select test.check((select jsonb_array_length(telecaller_assignable()) >= 1), 'Sales head: sees the Telecallers to assign a sheet to');
select test.check((select jsonb_array_length(telecaller_lists()) > 0), 'Sales head: sees the contact sheets');
select test.check((select count(*) = (select v::int from so where k = 'prices') from public.service_prices), 'Sales head: the table policy lets the price list through');
select test.check((select count(*) > 0 from public.telecaller_contact_lists), 'Sales head: and the sheets');
select test.login('sa');
select test.check((select jsonb_array_length(service_prices_list()) > 0 and jsonb_array_length(telecaller_lists()) > 0), 'Super Admin: unchanged');
select test.check((select (service_price_save(test.pcode(), 'one time', 1000, 18, 10, true) ->> 'serviceCode') is not null), 'Super Admin: can change a price');
select test.login('th_wab');
select test.check((select jsonb_array_length(service_prices_list()) > 0 and jsonb_array_length(telecaller_lists()) >= 0), 'Sales Team Lead: reads the prices and the sheets of the team');
select test.login('tc_a');
select test.check((select jsonb_array_length(telecaller_lists()) > 0), 'Telecaller: still opens their own sheets');
select test.must_fail($$select service_prices_list()$$, 'Telecaller: not the price list (as before)', 'cannot open the price list');
select test.login('ba_a');
select test.check((select jsonb_array_length(service_prices_list()) > 0), 'Business Associate: still reads the price list to quote from it');
select test.check((select count(*) > 0 from public.service_prices), 'Business Associate: and the table');
select test.must_fail($$select service_price_save(test.pcode(), 'one time', 5, 18, 10, true)$$, 'Business Associate: cannot change a price', 'Only the Super Admin');

-- ---------------------------------------------------------------- the Support side is refused
reset role;
update public.profiles set head_division = 'SUPPORT' where id = test.id('dh_wab');
set role authenticated;
select test.login('dh_wab');
select test.must_fail($$select service_prices_list()$$, 'Support head: cannot read the price list', 'cannot open the price list');
select test.must_fail($$select service_price_save(test.pcode(), 'one time', 1, 18, 10, true)$$, 'Support head: cannot change a price', 'Sales Department Head');
select test.must_fail($$select telecaller_assignable()$$, 'Support head: cannot list Telecallers to assign to', 'Sales Department Head');
select test.must_fail($$select telecaller_list_assign(test.id('tc_a'), 'x.xlsx', null, '[{"row":2,"name":"A","phone":"9800099999"}]'::jsonb, 'abcdefghijklmnopqrstuvwxyz', false)$$, 'Support head: cannot assign (or even check) a sheet', 'Sales Department Head');
select test.must_fail($$select telecaller_lists()$$, 'Support head: cannot open the contact sheets', 'cannot open contact sheets');
select test.check((select count(*) = 0 from public.service_prices), 'Support head: the price table returns no rows (direct database access)');
select test.check((select count(*) = 0 from public.telecaller_contact_lists), 'Support head: nor the sheets table');
select test.check((select count(*) = 0 from public.telecaller_contacts), 'Support head: nor the contacts table');
select test.must_fail($$update public.service_prices set unit_price = 1$$, 'Support head: cannot write the price table directly', 'permission denied');
select test.login('sup_th');
select test.must_fail($$select service_prices_list()$$, 'Support Team Lead: cannot read the price list', 'cannot open the price list');
select test.must_fail($$select telecaller_lists()$$, 'Support Team Lead: cannot open contact sheets', 'cannot open contact sheets');
select test.check((select count(*) = 0 from public.service_prices) and (select count(*) = 0 from public.telecaller_contact_lists), 'Support Team Lead: the tables return nothing');
select test.login('sup_plain');
select test.must_fail($$select service_prices_list()$$, 'Support member: cannot read the price list', 'cannot open the price list');
select test.must_fail($$select telecaller_lists()$$, 'Support member: cannot open contact sheets', 'cannot open contact sheets');
select test.must_fail($$select service_price_save(test.pcode(), 'one time', 1, 18, 10, true)$$, 'Support member: cannot change a price', 'Sales Department Head');
select test.check((select count(*) = 0 from public.service_prices), 'Support member: the table returns nothing');

-- ---------------------------------------------------------------- a combined head works one function at a time
reset role;
update public.profiles set head_division = null where id = test.id('dh_wab');
set role authenticated;
select test.login('dh_wab');
select test.check((select jsonb_array_length(service_prices_list()) > 0), 'a head with no side set (whole department): keeps access, as before');

-- ---------------------------------------------------------------- nothing stored changed
reset role;
select test.check((select count(*) = (select v::int from so where k = 'lists') from public.telecaller_contact_lists)
               and (select count(*) = (select v::int from so where k = 'contacts') from public.telecaller_contacts)
               and (select count(*) = (select v::int from so where k = 'prices') from public.service_prices), 'every sheet, contact and price is still there');
update public.profiles set head_division = nullif((select v from so where k = 'dh_side'), '-') where id = test.id('dh_wab');
\echo '   done'
