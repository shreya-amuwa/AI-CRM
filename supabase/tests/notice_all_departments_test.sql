-- =============================================================================
-- Notice Board: "All Sales Departments" / "All Support Departments" (migration 20270225000100).
-- Runs right after notice_sales_support_test.sql and reuses its people (ns_*, tm_a, ga_s, ga_p, dh_wbx ...) and helpers (test.ns_*). Own notices: 'NA %'.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 146. Notice Board: All Sales / All Support Departments'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of the notice functions again: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270225000100_notice_all_sales_support_departments.sql
\i supabase/migrations/20270225000100_notice_all_sales_support_departments.sql
delete from company_notices where title like 'NA %';
-- everybody of one function in every department of it, as the table owner (the publisher excluded, as for every audience)
create or replace function test.na_expected(p_div text, p_publisher uuid) returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct m.profile_id order by m.profile_id), '{}')
    from private.notice_division_departments(p_div) dd cross join lateral private.notice_division_members(dd.department_id, p_div) m
   where m.profile_id <> p_publisher $$;
create or replace function test.na_rows(p_title text, p_person uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.company_notice_recipients r where r.notice_id = (test.ns(p_title)).id and r.profile_id = p_person $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
select test.check((select count(*) >= 2 from private.notice_division_departments('SALES')) and (select count(*) >= 2 from private.notice_division_departments('SUPPORT')),
  'fixtures: several Sales and several Support departments');

set role authenticated;
select test.login('sa');

\echo '   All Sales Departments'
select test.check(test.ns_send('NA All Sales', 'na-key-all-sales', 'SALES', '[]', '[]', '{"allDepartments": true}') ->> 'status' = 'PUBLISHED', 'the Super Admin sends a notice to All Sales Departments');
reset role;
select test.check(test.ns_rcpt('NA All Sales') = test.na_expected('SALES', test.id('sa')), 'every Sales employee of every Sales department receives it, and nobody else');
select test.check(test.id('ns_s1') = any (test.ns_rcpt('NA All Sales')) and test.id('tm_a') = any (test.ns_rcpt('NA All Sales')) and test.id('ga_s') = any (test.ns_rcpt('NA All Sales')),
  'Whatsbox, Wabastore and D Talk Sales people are all in it');
select test.check(not (test.id('ns_p1') = any (test.ns_rcpt('NA All Sales'))) and not (test.id('ga_p') = any (test.ns_rcpt('NA All Sales'))) and not (test.id('hr_head') = any (test.ns_rcpt('NA All Sales'))),
  'no Support-only person (and not HR) receives it');
select test.check(test.na_rows('NA All Sales', test.id('dh_wbx')) = 1, 'a head of several functions is one recipient');
select test.check(test.ns_bells('NA All Sales') = cardinality(test.ns_rcpt('NA All Sales')), 'one bell per recipient (nobody is notified twice)');
select test.check((select audience_type = 'SALES' and audience_departments = '{}' and audience_employees = '{}' from company_notices where id = (test.ns('NA All Sales')).id),
  'it is stored as Sales with no single department (= all of them)');

\echo '   All Support Departments'
set role authenticated;
select test.login('hr_head');
select test.check(test.ns_send('NA All Support', 'na-key-all-supp', 'SUPPORT', '[]', '[]', '{"allDepartments": true}') ->> 'status' = 'PUBLISHED', 'HR sends a notice to All Support Departments');
reset role;
select test.check(test.ns_rcpt('NA All Support') = test.na_expected('SUPPORT', test.id('hr_head')), 'every Support employee of every Support department receives it, and nobody else');
select test.check(test.id('ns_p1') = any (test.ns_rcpt('NA All Support')) and test.id('ga_p') = any (test.ns_rcpt('NA All Support')), 'Whatsbox and D Talk Support people are in it');
select test.check(not (test.id('ns_s1') = any (test.ns_rcpt('NA All Support'))) and not (test.id('tm_a') = any (test.ns_rcpt('NA All Support'))) and not (test.id('ga_s') = any (test.ns_rcpt('NA All Support'))),
  'no Sales-only person receives it');

\echo '   one department still means one department; the choice is checked on the server'
set role authenticated;
select test.login('sa');
select test.check(test.ns_send('NA One Sales', 'na-key-one-sales', 'SALES', jsonb_build_array(test.dept('whatsbox'))) ->> 'status' = 'PUBLISHED', 'one Sales department can still be chosen');
reset role;
select test.check(test.ns_rcpt('NA One Sales') = test.ns_members('whatsbox', 'SALES') and not (test.id('tm_a') = any (test.ns_rcpt('NA One Sales'))),
  'and only Whatsbox Sales receives it');
set role authenticated;
select test.login('sa');
select test.ns_fail($q$select test.ns_send('NA Empty', 'na-key-empty1', 'SALES')$q$, 'no department and no "all": refused (an empty choice never means everyone)', '22023');
select test.ns_fail(format($q$select test.ns_send('NA Both', 'na-key-both01', 'SALES', '["%s"]', '[]', '{"allDepartments": true}')$q$, test.dept('whatsbox')),
  '"all" together with one department is refused', '22023');
select test.ns_fail(format($q$select test.ns_send('NA Ticked', 'na-key-tick01', 'SUPPORT', '[]', '["%s"]', '{"allDepartments": true}')$q$, test.id('ns_p1')),
  '"all" together with ticked people is refused', '22023');
select test.ns_fail($q$select test.ns_send('NA Wrong', 'na-key-wrong1', 'COMPANY', '[]', '[]', '{"allDepartments": true}')$q$, '"all departments" is only for Sales / Support', '22023');
select test.check((test.ns_send('NA All Sales', 'na-key-all-sales', 'SALES', '[]', '[]', '{"allDepartments": true}') ->> 'duplicate')::boolean, 'the same form sent twice publishes nothing new');
reset role;
select test.check((select count(*) = 1 from company_notices where title = 'NA All Sales'), 'still one notice');

\echo '   viewing and editing keep the audience'
set role authenticated;
select test.login('sa');
select test.check((select x -> 'audience' ->> 'type' = 'SALES' and jsonb_array_length(x -> 'audience' -> 'departments') = 0 and jsonb_array_length(x -> 'audience' -> 'employees') = 0
                     from jsonb_array_elements(notice_list('MINE', p_limit => 100) -> 'items') x where x ->> 'title' = 'NA All Sales'),
  'the notice reads as Sales with no single department (the screen shows "All Sales Departments")');
select test.check((notice_update((test.ns('NA All Sales')).id, jsonb_build_object('body', 'Updated text for all Sales.', 'version', 1)) ->> 'version')::int = 2, 'it can be edited');
reset role;
select test.check((select audience_type = 'SALES' and audience_departments = '{}' from company_notices where id = (test.ns('NA All Sales')).id)
                  and test.ns_rcpt('NA All Sales') = test.na_expected('SALES', test.id('sa')), 'editing keeps the audience and the recipients');
set role authenticated;
select test.login('ns_s1');
select test.check(test.ns_inbox('NA All Sales') and not test.ns_inbox('NA All Support'), 'a Sales member reads the Sales notice and not the Support one');
select test.login('ns_p1');
select test.check(test.ns_inbox('NA All Support') and not test.ns_inbox('NA All Sales'), 'a Support member reads the Support notice and not the Sales one');
reset role;
select set_config('request.jwt.claims', '', false);
\echo '=== ALL SALES / SUPPORT DEPARTMENTS NOTICE TESTS PASSED ==='
