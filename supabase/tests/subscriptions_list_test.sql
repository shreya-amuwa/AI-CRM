-- =============================================================================
-- The subscriptions list of the Sales / Business Associate dashboard (migration 20261212000100): who sees which customer's subscriptions.
-- Runs after subscription_activation_test.sql (it reads the customer "Sub Sigma" that suite leaves behind).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

reset role;
\i supabase/migrations/20261212000100_sales_subscriptions_list.sql

\echo '--- 110. Subscriptions list: scope'
create temp table sl (id uuid);
grant all on sl to authenticated;
insert into sl select id from customers where name = 'Sub Sigma';
select test.check((select count(*) = 1 from sl), 'the fixture customer exists');

set role authenticated;
select test.login('tm_a');
select test.check((select jsonb_array_length(subscriptions_list() -> 'items') >= 1), 'the owner sees subscriptions');
select test.check((select x ->> 'status' = 'ACTIVE' and x ->> 'plan' = 'Growth' and x ->> 'durationLabel' is not null and x ->> 'startedOn' is not null and x ->> 'expiresOn' is not null
                          and (x ->> 'hasLogin')::boolean and x ->> 'paymentStatus' is not null and x ->> 'customer' = 'Sigma Subscription Co'
                     from jsonb_array_elements(subscriptions_list('Sigma') -> 'items') x where (x ->> 'customerId')::uuid = (select id from sl) limit 1),
  'the row has the plan, duration, status, dates, payment status and login');
select test.check((subscriptions_list() -> 'counts' ->> 'active')::int >= 1 and (subscriptions_list() -> 'counts' ->> 'accountsCreated')::int >= 1, 'the counts follow the rows');
select test.check((subscriptions_list(null, 'EXPIRED') ->> 'total')::int = 0 or not exists (select 1 from jsonb_array_elements(subscriptions_list(null, 'EXPIRED') -> 'items') x where x ->> 'status' <> 'EXPIRED'), 'the status filter');
select test.check((subscriptions_list('no-such-customer-xyz') ->> 'total')::int = 0, 'the search filter');
select test.check((subscriptions_list('Sigma', null, 1, 1) ->> 'pageSize')::int = 1 and jsonb_array_length(subscriptions_list('Sigma', null, 1, 1) -> 'items') <= 1, 'paging');
select test.must_fail($$select subscriptions_list(null, 'BOGUS')$$, 'an unknown status is refused', 'Unknown subscription status');
select test.check(subscriptions_list('%') ->> 'total' is not null and (subscriptions_list('%') ->> 'total')::int = 0, 'a % in the search is not a wildcard');

select test.login('tm_b');
select test.check((select count(*) = 0 from jsonb_array_elements(subscriptions_list('Sigma') -> 'items')), 'another salesperson does not see them');
select test.login('tm_c');
select test.check((select count(*) = 0 from jsonb_array_elements(subscriptions_list('Sigma') -> 'items')), 'nor another department''s member');
select test.login('dh_wab');
select test.check((select count(*) >= 1 from jsonb_array_elements(subscriptions_list('Sigma') -> 'items')), 'the Department Head of the department sees them');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from jsonb_array_elements(subscriptions_list('Sigma') -> 'items')), 'another department''s head does not');
select test.login('sa');
select test.check((select count(*) >= 1 from jsonb_array_elements(subscriptions_list('Sigma') -> 'items')), 'the Super Admin sees them');
select test.login('sb_s');
select test.must_fail($$select subscriptions_list()$$, 'a client cannot use it', 'FORBIDDEN|Sign in');
reset role;
\echo '--- 110 done'
