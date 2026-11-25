-- =============================================================================
-- Client set-password links sent by the team (migration 20270212000100): the relationship manager (and Accounts) can send a client a new
-- link when the old one expired; at most one every 2 minutes and 5 a day per customer, 30 a day per sender; the card shows whether the
-- client chose a password and when the last link was sent / expires. Reuses import_test's customer "ravi" (login ravi.client@example.com),
-- its member sup_plain and another member sup_b. Synthetic data only.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 137. Client set-password links from the team'
reset role;
\i supabase/migrations/20270212000100_client_password_links.sql
\i supabase/migrations/20270212000100_client_password_links.sql
create temp table cpl (k text primary key, id uuid);
grant all on cpl to authenticated;
insert into cpl select 'ravi', customer_id from customer_client_accounts where email = 'ravi.client@example.com';
select test.check((select count(*) = 1 from cpl), 'fixture: the imported client login exists');
delete from client_password_link_sends where customer_id = (select id from cpl where k = 'ravi');
update customer_client_accounts set password_changed_at = null where customer_id = (select id from cpl where k = 'ravi');
update auth.users set last_sign_in_at = null where id = (select auth_user_id from customer_client_accounts where customer_id = (select id from cpl where k = 'ravi'));

set role authenticated;
\echo '   the relationship manager sees the login and sends a link'
select test.login('sup_plain');
select test.check((select s ->> 'hasLogin' = 'true' and s ->> 'passwordSet' = 'false' and s ->> 'lastLinkSentAt' is null and (s ->> 'canSend')::boolean
                     from (select client_login_status((select id from cpl where k = 'ravi')) s) x),
  'the card: a login, no password chosen yet, no link sent, a link can be sent');
select test.check((select client_password_link_begin((select id from cpl where k = 'ravi')) ->> 'email' = 'ravi.client@example.com'),
  'the relationship manager can send the client a new set-password link');
select test.check((select s ->> 'lastLinkSentAt' is not null and (s ->> 'linkExpiresAt')::timestamptz between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute'
                       and not (s ->> 'canSend')::boolean and (s ->> 'nextSendAt')::timestamptz > now() and (s ->> 'sendsToday')::int = 1
                     from (select client_login_status((select id from cpl where k = 'ravi')) s) x),
  'the card shows when it was sent, that it works for 24 hours, and when the next one can be sent');
select test.must_fail($$select client_password_link_begin((select id from cpl where k = 'ravi'))$$, 'a second link within 2 minutes is refused', 'CONFLICT');

\echo '   at most 5 a day per customer'
reset role;
update client_password_link_sends set sent_at = sent_at - interval '3 minutes' where customer_id = (select id from cpl where k = 'ravi');
insert into client_password_link_sends (customer_id, sent_by, sent_at)
select (select id from cpl where k = 'ravi'), test.id('sup_plain'), now() - (g || ' minutes')::interval * 10 from generate_series(1, 4) g;
set role authenticated;
select test.login('sup_plain');
select test.must_fail($$select client_password_link_begin((select id from cpl where k = 'ravi'))$$, 'a sixth link the same day is refused', 'CONFLICT');
select test.check((select (s ->> 'sendsToday')::int = 5 and not (s ->> 'canSend')::boolean from (select client_login_status((select id from cpl where k = 'ravi')) s) x),
  'the card says the day''s links are used up');

\echo '   who may'
select test.login('sup_b');
select test.must_fail($$select client_login_status((select id from cpl where k = 'ravi'))$$, 'another team member does not even see the login', 'NOT_FOUND');
select test.must_fail($$select client_password_link_begin((select id from cpl where k = 'ravi'))$$, 'nor send a link', 'NOT_FOUND');
select test.login('ravi_client');
select test.must_fail($$select client_password_link_begin((select id from cpl where k = 'ravi'))$$, 'the client cannot use the team''s button', 'NOT_FOUND');
reset role;
select test.check(not has_table_privilege('authenticated', 'public.client_password_link_sends', 'select'), 'the send log is not readable directly');
select test.check((select count(*) >= 1 from audit_logs where action = 'CLIENT_PASSWORD_LINK_REQUESTED' and entity_id = (select id from cpl where k = 'ravi')),
  'each link sent is in the audit log (who, which customer; never the link)');

\echo '   password chosen'
update customer_client_accounts set password_changed_at = now() - interval '1 hour' where customer_id = (select id from cpl where k = 'ravi');
set role authenticated;
select test.login('sup_plain');
select test.check((select s ->> 'passwordSet' = 'true' and s ->> 'passwordSetAt' is not null from (select client_login_status((select id from cpl where k = 'ravi')) s) x),
  'once the client chose a password the card says so (the button then sends a reset link)');
reset role;
update customer_client_accounts set password_changed_at = null where customer_id = (select id from cpl where k = 'ravi');
update auth.users set last_sign_in_at = now() - interval '2 days' where id = (select auth_user_id from customer_client_accounts where customer_id = (select id from cpl where k = 'ravi'));
set role authenticated;
select test.login('sup_plain');
select test.check((select s ->> 'passwordSet' = 'true' from (select client_login_status((select id from cpl where k = 'ravi')) s) x),
  'a client who signed in before this was recorded counts as having a password');
reset role;
delete from client_password_link_sends where customer_id = (select id from cpl where k = 'ravi');
