-- =============================================================================
-- Support "Create login" (migration 20270218000100): the Support team member who looks after a customer with no client login can create it
-- from the customer's page; nobody else can, an e-mail already in use is refused, a customer with a login is refused, and only a sign-in made
-- for this customer by the API can be recorded. Reuses import_test's members sup_plain and sup_b and their imported customers. Synthetic data only.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 150. Support creates a client login'
reset role;
\i supabase/migrations/20270218000100_support_client_login.sql
\i supabase/migrations/20270218000100_support_client_login.sql
create temp table scl (k text primary key, id uuid);
grant all on scl to authenticated;
-- a customer sup_b looks after, with no client login (import_test's 9000000103)
insert into scl select 'c', id from customers where phone = '9000000103';
select test.check((select count(*) = 1 from scl) and not exists (select 1 from customer_client_accounts where customer_id = (select id from scl where k = 'c')),
  'fixture: a Support customer without a login');
update customers set email = 'Siddhesh.Test@Example.com' where id = (select id from scl where k = 'c');

set role authenticated;
\echo '   the card offers Create login to the member who looks after the customer'
select test.login('sup_b');
select test.check((select s ->> 'hasLogin' = 'false' and (s ->> 'canCreate')::boolean and s ->> 'suggestedEmail' = 'siddhesh.test@example.com'
                     from (select client_login_status((select id from scl where k = 'c')) s) x),
  'no login yet: the member may create it, the customer''s e-mail is suggested (lower case)');
select test.check((select support_client_login_begin((select id from scl where k = 'c')) ->> 'email' = 'siddhesh.test@example.com'),
  'without an e-mail the customer''s own is used');
select test.check((select support_client_login_begin((select id from scl where k = 'c'), '  Other.Mail@Example.com ') ->> 'email' = 'other.mail@example.com'),
  'a different e-mail can be given (trimmed, lower case)');
select test.must_fail($$select support_client_login_begin((select id from scl where k = 'c'), 'not-an-email')$$, 'an invalid e-mail is refused', 'valid e-mail');
select test.must_fail($$select support_client_login_begin((select id from scl where k = 'c'), 'ravi.client@example.com')$$, 'an e-mail that already has a login is refused', 'already has a login');
select test.must_fail(format($$select support_client_login_begin((select id from scl where k = 'c'), '%s')$$, (select email from profiles where id = test.id('sup_plain'))),
  'a staff member''s e-mail is refused', 'already has a login');

\echo '   nobody else'
select test.login('sup_plain');
select test.must_fail($$select support_client_login_begin((select id from scl where k = 'c'))$$, 'another Support member cannot create it', 'NOT_FOUND');
select test.must_fail($$select client_login_status((select id from scl where k = 'c'))$$, '... nor see the card', 'NOT_FOUND');
select test.login('ravi_client');
select test.must_fail($$select support_client_login_begin((select id from scl where k = 'c'))$$, 'a client cannot', 'NOT_FOUND');
reset role;
set role anon;
select test.must_fail($$select support_client_login_begin((select id from scl where k = 'c'))$$, 'a visitor cannot', 'permission denied');
reset role;

\echo '   recording: only a sign-in made for this customer'
set role authenticated;
select test.login('sup_b');
select test.must_fail($$select support_client_login_record((select id from scl where k = 'c'), gen_random_uuid(), 'siddhesh.test@example.com')$$,
  'a made-up sign-in is refused', 'not created');
reset role;
select test.create_auth_user('scl_client', 'siddhesh.test@example.com', '{}'::jsonb,
  jsonb_build_object('provider', 'email', 'client_customer_id', (select id from scl where k = 'c')::text));
select test.create_auth_user('scl_other', 'scl.other@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', gen_random_uuid()::text));
set role authenticated;
select test.login('sup_b');
select test.must_fail($$select support_client_login_record((select id from scl where k = 'c'), test.id('scl_other'), 'scl.other@example.com')$$,
  'a sign-in made for another customer is refused', 'not created');
select test.login('sup_plain');
select test.must_fail($$select support_client_login_record((select id from scl where k = 'c'), test.id('scl_client'), 'siddhesh.test@example.com')$$,
  'another member cannot record it', 'NOT_FOUND');
select test.login('sup_b');
select support_client_login_record((select id from scl where k = 'c'), test.id('scl_client'), 'siddhesh.test@example.com');
select test.check((select s ->> 'hasLogin' = 'true' and s ->> 'email' = 'siddhesh.test@example.com' and (s ->> 'canSend')::boolean
                     from (select client_login_status((select id from scl where k = 'c')) s) x),
  'the card now shows the login, and a set-password link can be sent');
select test.must_fail($$select support_client_login_begin((select id from scl where k = 'c'), 'new.one@example.com')$$, 'a second login is refused', 'already has a login');
select test.must_fail($$select support_client_login_record((select id from scl where k = 'c'), test.id('scl_client'), 'siddhesh.test@example.com')$$,
  'recording twice is refused', 'already has a login');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'CLIENT_LOGIN_CREATED' and entity_id = (select id from scl where k = 'c') and metadata ->> 'via' = 'support'),
  'it is in the audit log (who, which customer, via Support)');
select test.check((select count(*) = 1 from customer_activities where customer_id = (select id from scl where k = 'c') and note like 'Client login created by the Support team%'),
  'and in the customer''s activity');
select test.check(not has_function_privilege('anon', 'public.support_client_login_begin(uuid, text)', 'execute')
                  and not has_function_privilege('anon', 'public.support_client_login_record(uuid, uuid, text)', 'execute'), 'visitors cannot call either function');

\echo '=== ALL SUPPORT CLIENT LOGIN TESTS PASSED ==='
