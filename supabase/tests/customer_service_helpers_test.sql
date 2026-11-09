-- =============================================================================
-- "function private.normalize_service_list(jsonb) does not exist" (migration 20261230000100).
-- Recreates the production state (the helpers of 20261009400000 missing), shows the exact error, applies the fix and checks that
-- saving a customer works again with the same validation. Uses rls_test.sql's Wabastore Support Team Lead (sup_th) and member (sup_plain).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 132. Customer save: the service-list helpers'
reset role;
delete from customer_services where customer_id in (select id from customers where email like 'csh.%@example.com');
delete from customers where email like 'csh.%@example.com';
create temp table csh (k text primary key, v uuid);
grant all on csh to authenticated;

\echo '   the production state: the helpers are missing'
drop function if exists private.normalize_service_list(jsonb);
drop function if exists private.save_customer_services(uuid, jsonb);
set role authenticated;
select test.login('sup_th');
select test.must_fail($$select create_support_customer('CSH Before', 'CSH Co', null, 'csh.before@example.com', 'RETAIL', 'ACTIVE',
                         '[{"serviceCode":"AI_CRM"}]'::jsonb, null, null, null, null)$$,
  'without the helpers a customer cannot be saved (the error in production)', 'normalize_service_list\(jsonb\) does not exist');
reset role;
select test.check((select count(*) = 0 from customers where email = 'csh.before@example.com'), 'and nothing was half-saved');

\echo '   the fix (twice: safe to run again)'
\i supabase/migrations/20261230000100_restore_customer_service_helpers.sql
\i supabase/migrations/20261230000100_restore_customer_service_helpers.sql
select test.check(to_regprocedure('private.normalize_service_list(jsonb)') is not null and to_regprocedure('private.save_customer_services(uuid,jsonb)') is not null,
  'both helpers are back');
select test.check(not has_function_privilege('authenticated', 'private.save_customer_services(uuid,jsonb)', 'execute'),
  'save_customer_services stays closed to signed-in users (only the customer functions call it)');

\echo '   saving customers again, as the Support Team Lead'
set role authenticated;
select test.login('sup_th');
insert into csh select 'one', create_support_customer('CSH One', 'CSH One Co', '+91 98450 70001', 'csh.one@example.com', 'RETAIL', 'ACTIVE',
  '[{"serviceCode":"AI_CRM"}]'::jsonb, 'CRM set-up', 'Phone', 'Existing customer', null);
insert into csh select 'many', create_support_customer('CSH Many', 'CSH Many Co', '+91 98450 70002', 'csh.many@example.com', 'WHOLESALE', 'ACTIVE',
  '[{"serviceCode":"AI_CRM"},{"serviceCode":"AI_QR"}]'::jsonb, null, null, null, null);
reset role;
select test.check((select owner_id = test.id('sup_th') and team_id = test.team('wabastore', 'Support') and service_code = 'AI_CRM'
                     from customers where id = (select v from csh where k = 'one')), 'one service: saved, owned by the Team Lead, in their Support team');
select test.check((select array_agg(service_code order by service_code) = array['AI_CRM', 'AI_QR'] from customer_services where customer_id = (select v from csh where k = 'many')),
  'several services: all saved');
set role authenticated;
select test.login('sup_th');
select update_support_customer((select v from csh where k = 'many'), 'CSH Many', 'CSH Many Co', '+91 98450 70002', 'csh.many@example.com', 'WHOLESALE', 'ACTIVE',
  '[{"serviceCode":"AI_QR"}]'::jsonb, 'Only QR now', null, 'Edited', null);
reset role;
select test.check((select array_agg(service_code) = array['AI_QR'] from customer_services where customer_id = (select v from csh where k = 'many'))
                  and (select notes = 'Edited' from customers where id = (select v from csh where k = 'many')), 'editing the customer and its services works');

\echo '   the validation is unchanged'
set role authenticated;
select test.login('sup_th');
select test.must_fail($$select create_support_customer('CSH Bad', null, null, 'csh.bad@example.com', 'RETAIL', 'ACTIVE', '[{"serviceCode":"NOT_A_SERVICE"}]'::jsonb, null, null, null, null)$$,
  'an unknown service is refused', 'Choose a service from the list');
select test.must_fail($$select create_support_customer('CSH Twice', null, null, 'csh.twice@example.com', 'RETAIL', 'ACTIVE', '[{"serviceCode":"AI_CRM"},{"serviceCode":"AI_CRM"}]'::jsonb, null, null, null, null)$$,
  'the same service twice is refused', 'more than once');
select test.must_fail($$select create_support_customer('CSH Dup', null, null, 'CSH.One@example.com', 'RETAIL', 'ACTIVE', null, null, null, null, null)$$,
  'a customer with the same e-mail is still detected', null);
select test.must_fail($$select create_support_customer('CSH Dup Phone', null, '98450 70001', null, 'RETAIL', 'ACTIVE', null, null, null, null, null)$$,
  'and the same phone', null);
reset role;
select test.check((select count(*) = 0 from customers where email in ('csh.bad@example.com', 'csh.twice@example.com')), 'a refused customer leaves nothing behind');

\echo '   access stays separated'
set role authenticated;
select test.login('tds_x1');
select test.check((select count(*) = 0 from customers where id in (select v from csh)), 'a Support member of another department does not see them');
reset role;
