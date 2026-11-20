-- =============================================================================
-- Wabatalk, the Support department of D Talk (migration 20261124000100).
--   D Talk = Sales, Wabatalk = Support. D Talk's Support is looked after by the shared Support head of Wabastore, Whatsbox and Wabastar.
--   Revenue earned by Support belongs to Wabatalk, revenue earned by Sales to D Talk.
-- Runs after department_scopes_test.sql (same database, reuses its heads, members and the `test.hdr` helpers).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Wabatalk (D Talk Support) and revenue by department'
reset role;
create temp table wt (k text primary key, v text);
grant all on wt to authenticated, service_role;
create function pg_temp.g(p_k text) returns uuid language sql stable as $$ select v::uuid from wt where k = p_k $$;
grant execute on function pg_temp.g(text) to authenticated, service_role;
create or replace function test.wtid() returns uuid language sql stable as $$ select id from public.departments where slug = 'wabatalk' $$;
grant execute on function test.wtid() to authenticated;

-- ---------------------------------------------------------------- the department and its link
select test.check((select facet_of = test.dept('dtalk') and facet_division = 'SUPPORT' and generates_revenue and name = 'Wabatalk' from departments where slug = 'wabatalk'),
  'Wabatalk exists and is the Support side of D Talk');
select test.check((select count(*) = 0 from teams where department_id = test.wtid()), 'it has no teams of its own (D Talk''s Support team serves it)');
select test.check((select facet_of is null from departments where slug = 'dtalk'), 'D Talk itself is a department of its own (the Sales department)');
do $$ begin
  begin update departments set facet_of = test.wtid(), facet_division = 'SUPPORT' where slug = 'digitree'; raise exception 'should have failed';
  exception when others then if sqlerrm not like '%cannot have sides%' then raise; end if; end;
end $$;
select test.check(true, 'a Support side cannot have a side of its own');
do $$ begin
  begin insert into departments (slug, name, facet_of, facet_division) values ('wabatalk2', 'Wabatalk Two', test.dept('dtalk'), 'SUPPORT'); raise exception 'should have failed';
  exception when unique_violation then null; end;
end $$;
select test.check(true, 'D Talk has one Support side only');
select test.check((select not exists (select 1 from jsonb_array_elements(list_registration_options()) x where x ->> 'slug' = 'wabatalk') from (select 1) z), 'the sign-up page does not offer Wabatalk (it has no teams)');

-- ---------------------------------------------------------------- the shared Support head: Wabastar (home), Whatsbox and Wabatalk
select test.create_auth_user('wt_p', 'wt.p@amuwa.com', '{"full_name":"Shared Support Head (Wabastar)"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastar'), 'provisioned_head_division', 'SUPPORT'));
select test.create_auth_user('wt_o', 'wt.o@amuwa.com', '{"full_name":"Head with no extra scope (Wabastar side)"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('wabastar'), 'provisioned_head_division', 'SALES'));
set role authenticated;
select test.login('sa');
select test.must_fail($$select department_access_set(test.id('wt_p'), test.dept('dtalk'), 'SUPPORT', true)$$, 'D Talk''s Support cannot be given under the name D Talk', 'Give Wabatalk instead');
select test.must_fail($$select department_access_set(test.id('wt_p'), test.wtid(), 'SALES', true)$$, 'Wabatalk is Support only', 'only Support can be given');
select set_operations_head(test.id('wt_p'), true);
select department_access_set(test.id('wt_p'), test.dept('whatsbox'), 'SUPPORT', true);
select department_access_set(test.id('wt_p'), test.wtid(), 'SUPPORT', true);
select test.check((select (x ->> 'hasSupport')::boolean and not (x ->> 'hasSales')::boolean from jsonb_array_elements(department_access_get(test.id('wt_p')) -> 'departments') x where x ->> 'slug' = 'wabatalk'),
  'the Super Admin''s list offers Wabatalk for Support only');
select test.check((select not (x ->> 'hasSupport')::boolean and (x ->> 'hasSales')::boolean and x ->> 'supportDepartment' = 'Wabatalk' from jsonb_array_elements(department_access_get(test.id('wt_p')) -> 'departments') x where x ->> 'slug' = 'dtalk'),
  '... and D Talk for Sales only, saying its Support is Wabatalk');

\echo '   what the shared Support head sees'
select test.login('wt_p');
select test.nohdr();
select test.check((select array_agg(x ->> 'slug' order by x ->> 'slug') = array['wabastar', 'wabatalk', 'whatsbox'] from jsonb_array_elements(my_department_scopes() -> 'departments') x),
  'offered Wabastar, Whatsbox and Wabatalk (not D Talk)');
select test.check((select x ->> 'dataSlug' = 'dtalk' and (x ->> 'dataDepartmentId') = test.dept('dtalk')::text and x -> 'divisions' = '["SUPPORT"]'::jsonb
                     from jsonb_array_elements(my_department_scopes() -> 'departments') x where x ->> 'slug' = 'wabatalk'),
  'Wabatalk works on D Talk''s data, Support only');
select test.hdr(test.wtid(), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Support') from customers where name like 'SC DTalk%'), 'in Wabatalk: D Talk''s Support customer, not its Sales lead');
select test.check((select count(*) = 1 from profiles where id = test.id('ds_p')) and (select count(*) = 0 from profiles where id = test.id('ds_s')), 'in Wabatalk: D Talk''s Support people, not its Sales people');
select test.check((my_department_scopes() ->> 'activeDepartmentId') = test.wtid()::text and (my_department_scopes() ->> 'activeDivision') = 'SUPPORT', 'the active scope is reported as Wabatalk / Support');
select test.check((select (api_session('[]'::jsonb) -> 'profile' ->> 'department_id') = test.dept('dtalk')::text and (api_session('[]'::jsonb) -> 'profile' ->> 'head_division') = 'SUPPORT'),
  'the API acts on D Talk''s data, Support function');
select test.hdr(test.wtid());
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Support') from customers where name like 'SC DTalk%'), 'the department alone is enough: Wabatalk means Support');
select test.hdr(test.wtid(), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Support') from customers where name like 'SC DTalk%'), 'asking for Sales while in Wabatalk does not give D Talk''s Sales data');
select test.hdr(test.dept('dtalk'), 'SALES');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Support') from customers where name like 'SC DTalk%'), 'naming D Talk with Sales gives Support data only (this head has no D Talk Sales scope)');
select test.hdr(test.dept('whatsbox'));
select test.check((select count(*) = 1 and bool_and(name = 'SC Whatsbox Support') from customers where name like 'SC Whatsbox%'), 'in Whatsbox: its Support customer only');
select test.must_fail($$select sales_head_overview()$$, 'the Support head cannot open the Sales head pages', 'Sales Department Head');

\echo '   nobody else gets Wabatalk by sending its id'
select test.login('wt_o');
select test.hdr(test.wtid(), 'SUPPORT');
select test.check((select count(*) = 0 from customers where name like 'SC DTalk%'), 'a head with no Wabatalk grant stays in their own department');
select test.check((my_department_scopes() ->> 'activeDepartmentId') <> test.wtid()::text, '... and is told so');
select test.login('ga_s');
select test.hdr(test.wtid(), 'SUPPORT');
select test.check((select count(*) = 1 and bool_and(name = 'SC DTalk Sales') from customers where name like 'SC DTalk%'), 'D Talk''s Sales head sending Wabatalk''s id still gets Sales data only');
select test.login('ds_p');
select test.hdr(test.wtid(), 'SUPPORT');
select test.check((select count(*) = 1 from profiles where id = test.id('ds_p')) and (select count(*) = 0 from profiles where id = test.id('wt_p')), 'a Team Member is not moved by a header');
select test.nohdr();

-- ---------------------------------------------------------------- revenue: Sales -> D Talk, Support -> Wabatalk
\echo '   revenue by department'
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.headers', '', false);   -- fixtures are written as the system, not as the last person who signed in
-- a customer D Talk Sales sold: 60,000 paid
insert into customers (owner_id, name, phone, lifecycle_stage, deal_amount) values (test.id('ds_s'), 'WT Sales Customer', '+919812000001', 'CUSTOMER', 60000);
insert into wt select 'S', id::text from customers where name = 'WT Sales Customer';
insert into payment_requests (customer_id, status, agreed_amount, requested_by) values (pg_temp.g('S'), 'CONFIRMED', 60000, test.id('ds_s'));
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
  values (pg_temp.g('S'), 'FULL', 60000, 'UPI', 'WT-S-1', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now());
select test.check((select department_id = test.dept('dtalk') and division = 'SALES' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S')), 'Sales'' first sale is D Talk''s revenue');
select test.check((select department_id = test.dept('dtalk') from private.business_ledger() where order_key = 'SALE:' || pg_temp.g('S') limit 1), '... in the ledger');

-- Support sells that customer an add-on: 23,600
insert into addon_requests (id, customer_id, department_id, status, version, created_by, submitted_by, subtotal, tax_total, total)
  select gen_random_uuid(), c.id, c.department_id, 'DRAFT', 1, test.id('ds_p'), test.id('ds_p'), 20000, 3600, 23600 from customers c where c.id = pg_temp.g('S');
insert into wt select 'A', id::text from addon_requests where customer_id = pg_temp.g('S');
insert into addon_request_items (request_id, service_code, name, quantity, unit_price, line_total, sort_order) values (pg_temp.g('A'), 'META_ADS_MANAGEMENT', 'Meta Ads Management', 1, 20000, 20000, 1);
update addon_requests set status = 'PENDING_VERIFICATION' where id = pg_temp.g('A');
update addon_requests set status = 'APPROVED' where id = pg_temp.g('A');
update addon_requests set status = 'INVOICE_GENERATED', subtotal = 20000, tax_total = 3600, total = 23600 where id = pg_temp.g('A');
insert into addon_payments (request_id, customer_id, amount, method, reference, status, recorded_by, verified_by, verified_at)
  values (pg_temp.g('A'), pg_temp.g('S'), 23600, 'UPI', 'WT-A-1', 'VERIFIED', test.id('acc_m'), test.id('acc_m'), now());
select test.check((select department_id = test.wtid() and division = 'SUPPORT' from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A')), 'an add-on Support sold is Wabatalk''s revenue');
select test.check((select count(*) = 1 and bool_and(department_id = test.wtid()) from private.business_ledger() where order_key = 'ADDON:' || pg_temp.g('A')), '... in the ledger');
select test.check((select count(*) = 1 and bool_and(department_id = test.wtid()) from private.business_orders() where order_key = 'ADDON:' || pg_temp.g('A')), '... and in the orders');
select test.check((select department_id = test.wtid() from private.verified_income_attributed() where id = (select id from addon_payments where reference = 'WT-A-1')), '... and in Accounts'' department income');
select test.check((select department_id = test.dept('dtalk') from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S')), 'the original sale stays with D Talk');

-- a customer Support (D Talk's Support member) acquired: the first sale is Support's, so Wabatalk's
insert into customers (owner_id, name, phone, lifecycle_stage, deal_amount) values (test.id('ds_p'), 'WT Support Customer', '+919812000002', 'CUSTOMER', 30000);
insert into wt select 'R', id::text from customers where name = 'WT Support Customer';
insert into payment_requests (customer_id, status, agreed_amount, requested_by) values (pg_temp.g('R'), 'CONFIRMED', 30000, test.id('ds_p'));
insert into customer_payments (customer_id, payment_type, amount, method, reference, status, source, recorded_by, verified_by, verified_at)
  values (pg_temp.g('R'), 'FULL', 30000, 'UPI', 'WT-R-1', 'VERIFIED', 'ACCOUNTS', test.id('acc_m'), test.id('acc_m'), now());
select test.check((select department_id = test.wtid() and division = 'SUPPORT' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('R')), 'a customer Support acquired: the first sale is Wabatalk''s');

-- the reports
set role authenticated;
select test.login('sa');
create temp table rj (k text primary key, j jsonb);
grant all on rj to authenticated;
insert into rj select 'wt', department_income_report(test.wtid());
insert into rj select 'dt', department_income_report(test.dept('dtalk'));
select test.check((select (j #>> '{byDivision,support,collected}')::numeric = 53600 and (j #>> '{byDivision,sales,collected}')::numeric = 0 and j #>> '{scope,name}' = 'Wabatalk' from rj where k = 'wt'),
  'the Wabatalk report: 53,600 of Support revenue, no Sales');
select test.check((select (j #>> '{byDivision,sales,collected}')::numeric = 60000 and (j #>> '{byDivision,support,collected}')::numeric = 0 from rj where k = 'dt'),
  'the D Talk report: 60,000 of Sales revenue, no Support');
select test.check((select (x ->> 'income')::numeric = 53600 from jsonb_array_elements(accounts_finance_by_department()) x where x ->> 'slug' = 'wabatalk'), 'Accounts'' departments list shows Wabatalk''s income');
select test.check((select (x ->> 'income')::numeric >= 60000 and (x ->> 'income')::numeric < 60000 + 53600 from jsonb_array_elements(accounts_finance_by_department()) x where x ->> 'slug' = 'dtalk'), '... and D Talk''s Sales income apart from it');
-- a head sees the income of THEIR function
select test.login('wt_p');
select test.hdr(test.wtid(), 'SUPPORT');
select test.check((select (department_income_report() #>> '{byDivision,support,collected}')::numeric = 53600 and department_income_report() #>> '{scope,name}' = 'Wabatalk'), 'the shared Support head working Wabatalk sees Wabatalk''s revenue');
select test.must_fail($$select department_income_report(test.dept('digitree'))$$, 'but not another department''s', 'only their own');
select test.login('ga_s');
select test.hdr(test.dept('dtalk'), 'SALES');
select test.check((select (department_income_report() #>> '{byDivision,sales,collected}')::numeric = 60000 and (department_income_report() #>> '{byDivision,support,collected}')::numeric = 0), 'D Talk''s Sales head sees D Talk''s Sales revenue and none of Wabatalk''s');
select test.nohdr();

-- a correction by Accounts follows the division
select test.login('sa');
select set_order_attribution('SALE:' || pg_temp.g('R'), 'SALES', null, 'Sales acquired it');
reset role;
select test.check((select department_id = test.dept('dtalk') and division = 'SALES' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('R')), 'a correction to Sales lands in D Talk');
set role authenticated;
select set_order_attribution('SALE:' || pg_temp.g('R'), 'SUPPORT', null, 'Support acquired it');
reset role;
select test.check((select department_id = test.wtid() and division = 'SUPPORT' from revenue_attributions where order_key = 'SALE:' || pg_temp.g('R')), 'a correction to Support lands in Wabatalk');

-- ---------------------------------------------------------------- history and other departments
reset role;
-- an order recorded before Wabatalk existed as D Talk / Support is moved by the migration (and only by it, once)
update revenue_attributions set department_id = test.dept('dtalk'), source = 'LEGACY' where order_key = 'ADDON:' || pg_temp.g('A');
select test.check((select department_id = test.dept('dtalk') from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A')), '(setup) an old Support order sits in D Talk');
\i supabase/migrations/20261124000100_wabatalk_support_department.sql
-- later migrations redefine some of the functions this one defines: put them back in order
\i supabase/migrations/20261125000100_department_access_shared_heads.sql
\i supabase/migrations/20261126000100_access_control_apply.sql
-- ... and the newest scope rule (Operations Head) goes back on top
\i supabase/migrations/20261205000100_operations_head.sql
-- ... and the Amuwa Design Studio access rule (no Sales / Support function there) on top of department_access_problem
\i supabase/migrations/20270112000200_amuwa_design_studio_rename.sql
\i supabase/migrations/20270118000100_amuwa_design_studio_restore.sql
select test.check((select department_id = test.wtid() from revenue_attributions where order_key = 'ADDON:' || pg_temp.g('A')), 'running the migration again moves the old Support order to Wabatalk');
select test.check((select department_id = test.dept('dtalk') from revenue_attributions where order_key = 'SALE:' || pg_temp.g('S')), '... and leaves Sales'' order with D Talk');
select test.check((select count(*) = 1 from departments where slug = 'wabatalk' or lower(name) = 'wabatalk'), 'and does not create Wabatalk a second time');
-- a department without sides is unchanged
select test.check((select private.revenue_department(test.dept('wabastore'), 'SUPPORT') = test.dept('wabastore') and private.revenue_department(test.dept('wabastore'), 'SALES') = test.dept('wabastore')), 'Wabastore: Sales and Support revenue both stay in Wabastore');
select test.check((select private.revenue_department(test.dept('digitree'), 'SUPPORT') = test.dept('digitree')), 'Digitree: unchanged');
select test.check((select private.revenue_department(test.wtid(), 'SALES') = test.dept('dtalk') and private.revenue_department(test.wtid(), 'SUPPORT') = test.wtid()), 'a Sales order that reaches Wabatalk goes to D Talk; Support''s stays');
\echo '   done'
