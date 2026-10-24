-- =============================================================================
-- Excel import: "Brought by" (migration 20261121000100). The Customer row says who looks after the customer (the Support member) AND who
-- brought them (a Sales person or Support); the import records it as the customer's acquisition. Runs after the other suites (same database).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- import: brought by'
reset role;
\i supabase/migrations/20261121000100_import_brought_by.sql
create temp table bb (k text primary key, j jsonb);
grant all on bb to authenticated, service_role;
insert into bb values
  ('sales',   '{"customers":[{"row":3,"mobile":"9000000601","name":"Brought By Sales","businessName":"BB Sales (TEST)","broughtBy":"Member A"}]}'),
  ('sales_t', '{"customers":[{"row":3,"mobile":"9000000602","name":"Brought By Sales T","businessName":"BB Sales T (TEST)","broughtByType":"Sales","broughtBy":"a@amuwa.com"}]}'),
  ('support', '{"customers":[{"row":3,"mobile":"9000000603","name":"Brought By Support","businessName":"BB Support (TEST)","broughtByType":"Support"}]}'),
  ('type_s',  '{"customers":[{"row":3,"mobile":"9000000604","name":"Brought By Type Sales","businessName":"BB Type (TEST)","broughtByType":"sales"}]}'),
  ('none',    '{"customers":[{"row":3,"mobile":"9000000605","name":"Brought By None","businessName":"BB None (TEST)"}]}'),
  ('mismatch','{"customers":[{"row":3,"mobile":"9000000606","name":"BB Mismatch","businessName":"BB Mismatch (TEST)","broughtByType":"Support","broughtBy":"Member A"}]}'),
  ('unknown', '{"customers":[{"row":3,"mobile":"9000000606","name":"BB Unknown","businessName":"BB Unknown (TEST)","broughtBy":"Nobody Atall"}]}'),
  ('badtype', '{"customers":[{"row":3,"mobile":"9000000606","name":"BB Bad","businessName":"BB Bad (TEST)","broughtByType":"Marketing"}]}'),
  ('again',   '{"customers":[{"row":3,"mobile":"9000000601","name":"Brought By Sales","businessName":"BB Sales (TEST)","broughtByType":"Support"}]}');
set role authenticated;
select test.login('sup_plain');

select test.check((select import_customer_data((select j from bb where k = 'mismatch'), false) -> 'errors' -> 0 ->> 'message' ilike '%Member A is in the Sales team, not Support%'), 'a person and a division that disagree are refused');
select test.check((select import_customer_data((select j from bb where k = 'unknown'), false) -> 'errors' -> 0 ->> 'message' ilike '%Nobody Atall%was not found%'), 'an unknown person is refused');
select test.check((select import_customer_data((select j from bb where k = 'badtype'), false) -> 'errors' -> 0 ->> 'message' ilike '%must be Sales or Support%'), 'a division other than Sales or Support is refused');

select test.check((select (import_customer_data((select j from bb where k = 'sales'), true) ->> 'committed')::boolean), 'a customer brought by a named Sales person is saved');
select test.check((select (import_customer_data((select j from bb where k = 'sales_t'), true) ->> 'committed')::boolean), 'also with the type and the CRM e-mail');
select test.check((select (import_customer_data((select j from bb where k = 'support'), true) ->> 'committed')::boolean), 'also "Support" alone');
select test.check((select (import_customer_data((select j from bb where k = 'type_s'), true) ->> 'committed')::boolean), 'also "Sales" alone (any case)');
select test.check((select (import_customer_data((select j from bb where k = 'none'), true) ->> 'committed')::boolean), 'and a customer without it');
reset role;
select test.check((select c.acquisition_division = 'SALES' and c.acquired_by = test.id('tm_a') and c.acquisition_department_id = (select department_id from public.profiles where id = test.id('tm_a')) and c.owner_id = test.id('sup_plain')
                     from public.customers c where c.phone = '9000000601'), 'a named Sales person is the acquirer (division, person, department) while the Support member stays the owner');
select test.check((select c.acquisition_division = 'SALES' and c.acquired_by = test.id('tm_a') from public.customers c where c.phone = '9000000602'), 'a person can be written as their CRM e-mail');
select test.check((select c.acquisition_division = 'SUPPORT' and c.acquired_by = test.id('sup_plain') from public.customers c where c.phone = '9000000603'), '"Support" alone: brought by the importing Support member');
select test.check((select c.acquisition_division = 'SALES' and c.acquired_by is null from public.customers c where c.phone = '9000000604'), '"Sales" alone: Sales, with no person to record');
select test.check((select c.acquisition_division = 'SUPPORT' and c.acquired_by = test.id('sup_plain') from public.customers c where c.phone = '9000000605'), 'without it, the acquisition is what it was before (the importing Support member)');
select test.check((select count(*) = 1 from public.customer_activities a join public.customers c on c.id = a.customer_id where c.phone = '9000000601' and a.note like 'Brought by Member A (Sales)%'), 'the customer history says who brought them');
select test.check((current_setting('app.attribution_edit', true) is distinct from '1'), 'the import leaves the attribution switch off');

-- a customer that already exists keeps the acquisition it has
set role authenticated;
select test.login('sup_plain');
select test.check((select (import_customer_data((select j from bb where k = 'again'), true) ->> 'committed')::boolean), 'importing an existing customer again is fine');
reset role;
select test.check((select c.acquisition_division = 'SALES' and c.acquired_by = test.id('tm_a') from public.customers c where c.phone = '9000000601'), 'and its acquisition is not changed by it');
\echo '   done'
