-- =============================================================================
-- A Support Department Head adds a customer by hand (the "Add customer" button on the head's Customers page; before, only the sheet upload).
-- No migration: create_support_customer already allows a Department Head. These checks pin the rules the page relies on:
-- the customer goes to an active Support team member of the head's own department, never to the head, a Sales member or another department.
-- Uses rls_test.sql's Wabastore Department Head (dh_wab), Support member (sup_b), Sales member (tm_a) and another department's Support member (tds_x1).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Support Department Head: add a customer by hand'
reset role;
delete from customer_activities where customer_id in (select id from customers where email like 'shac.%@example.com');
delete from customer_services where customer_id in (select id from customers where email like 'shac.%@example.com');
delete from customers where email like 'shac.%@example.com';

set role authenticated;
select test.login('dh_wab');
select create_support_customer('SHAC One', 'SHAC Co', '+91 98450 71001', 'shac.one@example.com', 'RETAIL', 'ACTIVE',
  '[{"serviceCode":"AI_CRM"}]'::jsonb, 'Needs onboarding', 'Phone', 'Added by the head', test.id('sup_b'));
reset role;
select test.check((select owner_id = test.id('sup_b') and lifecycle_stage = 'CUSTOMER' from customers where email = 'shac.one@example.com'),
  'the head adds a customer for a Support member of the department');
select test.check((select count(*) = 1 from customer_activities a join customers c on c.id = a.customer_id
                    where c.email = 'shac.one@example.com' and a.type = 'CUSTOMER_CREATED' and a.actor_id = test.id('dh_wab')),
  'the record says the head added it');
select test.check((select count(*) = 1 from notifications n join customers c on c.id = n.entity_id
                    where c.email = 'shac.one@example.com' and n.recipient_id = test.id('sup_b') and n.type = 'CUSTOMER_ASSIGNED'),
  'the Support member is told the customer was assigned to them');

set role authenticated;
select test.login('dh_wab');
select test.check((select count(*) = 1 from customers where email = 'shac.one@example.com'), 'the head sees the new customer');
select test.must_fail($$select create_support_customer('SHAC Self', null, '+91 98450 71002', null, 'RETAIL', 'ACTIVE', null, null, null, null, null)$$,
  'with nobody chosen it is refused (the head is on no Support team)', 'VALIDATION_ERROR');
select test.must_fail($$select create_support_customer('SHAC Sales', null, '+91 98450 71003', null, 'RETAIL', 'ACTIVE', null, null, null, null, test.id('tm_a'))$$,
  'a Sales member cannot be given a Support customer', 'Support team');
select test.must_fail($$select create_support_customer('SHAC Other', null, '+91 98450 71004', null, 'RETAIL', 'ACTIVE', null, null, null, null, test.id('tds_x1'))$$,
  'a Support member of another department is refused', 'FORBIDDEN');
select test.must_fail($$select create_support_customer('SHAC Dup', null, null, 'SHAC.One@example.com', 'RETAIL', 'ACTIVE', null, null, null, null, test.id('sup_b'))$$,
  'the duplicate check still applies', null);
reset role;
select test.check((select count(*) = 0 from customers where name in ('SHAC Self', 'SHAC Sales', 'SHAC Other', 'SHAC Dup')), 'a refused customer leaves nothing behind');

\echo '   access stays separated'
set role authenticated;
select test.login('tds_x1');
select test.check((select count(*) = 0 from customers where email = 'shac.one@example.com'), 'a Support member of another department does not see it');
reset role;
