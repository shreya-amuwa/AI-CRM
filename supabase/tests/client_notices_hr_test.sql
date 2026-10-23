-- =============================================================================
-- Client notices published by the HR head (migration 20261117000100): they reach the clients the HR head chooses.
-- Before it, the HR head (a Department Head of the client-less HR department) reached only HR's own clients, i.e. nobody.
-- Runs after the client and HR e-mail suites on the same database (clients Alpha and Beta of Wabastore, the HR head, an HR member).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- client notices from the HR head'
reset role;
\i supabase/migrations/20261117000100_hr_client_notices.sql
create temp table hrann (name text primary key, id uuid);
grant all on hrann to authenticated;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
grant execute on function pg_temp.today() to authenticated;
set role authenticated;

select test.login('hrx_tm');
select test.must_fail($$select publish_client_announcement('OFFICE_CLOSED', 'HR member closure', null, pg_temp.today() + 2)$$, 'an HR team member cannot publish a notice', 'Department Head');

select test.login('hr_head');
insert into hrann select 'all', publish_client_announcement('OFFICE_CLOSED', 'HR head office closed - all', 'Back the next working day.', pg_temp.today() + 2);
select test.login('cdash_a');
select test.check((select count(*) = 1 from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'HR head office closed - all' and (a ->> 'daysAway')::int = 2),
  'a notice from the HR head with no department reaches the clients of every department');
select test.check((select count(*) >= 1 from jsonb_array_elements(client_notifications() -> 'items') n where n ->> 'type' = 'OFFICE_CLOSED' and n ->> 'title' = 'HR head office closed - all'),
  'and it is in their Notification Center');
select test.login('cdash_b');
select test.check((select count(*) = 1 from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'HR head office closed - all'), 'every client sees it');

select test.login('hr_head');
insert into hrann select 'hr_only', publish_client_announcement('OFFICE_CLOSED', 'HR head office closed - HR clients', null, pg_temp.today() + 2, null, 'NONE', 7, null, (select id from departments where slug = 'hr'));
select test.login('cdash_a');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'HR head office closed - HR clients'),
  'the HR head can narrow a notice to one department: clients of other departments do not see it');
select test.login('hr_head');
insert into hrann select 'wab', publish_client_announcement('OFFICE_CLOSED', 'HR head office closed - Wabastore', null, pg_temp.today() + 1, null, 'NONE', 7, null, (select id from departments where slug = 'wabastore'));
select test.login('cdash_a');
select test.check((select count(*) = 1 from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'HR head office closed - Wabastore'), 'or to the department they choose');

select test.login('hr_head');
select test.check((select count(*) = 3 from jsonb_array_elements(client_announcements_overview()) a where a ->> 'title' like 'HR head office closed%'), 'the HR head lists their notices');
select test.check((select count(*) >= 1 from jsonb_array_elements(client_announcements_overview()) a where a ->> 'title' like 'Monthly performance review%'),
  'and the notices other heads published');
select end_client_announcement((select id from hrann where name = 'all'));
select test.login('cdash_b');
select test.check((select count(*) = 0 from jsonb_array_elements(client_announcements()) a where a ->> 'title' = 'HR head office closed - all'), 'the HR head can end a notice');

-- the other Department Heads are unchanged: their own department only, and not the HR head's notices to manage
select test.login('dh_wbx');
select test.must_fail($$select end_client_announcement((select id from hrann where name = 'hr_only'))$$, 'another Department Head cannot end a notice outside their department', 'not found');
reset role;
\echo '   done'
