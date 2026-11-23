-- =============================================================================
-- International and Reseller, PR 2 (migration 20270130000100): the Department Head's Sales pages (leads, lead assignment, team people, tasks, overview,
-- reports) work for the head of a unified department and only for them, scoped to their own department; the existing Sales head still has them, the
-- existing Support head and every Team Lead / Team Member still do not. Reuses the people and records of unified_departments_test.sql.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 181. International and Reseller: the Department Head''s Sales pages'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites re-run older migrations (idempotency checks): apply this one again first
\i supabase/migrations/20270130000100_unified_head_sales_pages.sql
\i supabase/migrations/20270130000100_unified_head_sales_pages.sql

create or replace function test.ud_leads() returns text language sql as $$
  select coalesce(string_agg(x ->> 'name', ',' order by x ->> 'name'), '') from jsonb_array_elements(sales_leads_list() -> 'items') x $$;
create or replace function test.ud_names(p_fn text) returns text language plpgsql as $$
declare r text;
begin
  execute format($f$select coalesce(string_agg(coalesce(x ->> 'name', x ->> 'fullName'), ',' order by coalesce(x ->> 'name', x ->> 'fullName')), '') from jsonb_array_elements(%s) x$f$, p_fn) into r;
  return r;
end $$;
grant execute on all functions in schema test to anon, authenticated;

set role authenticated;
select test.login('i_m_a2');
select create_lead('{"name":"UH Intl Lead","company":"UH Intl","email":"uh.intl@example.com","phone":"9820000201","leadSource":"Referral"}', array['AI_CALLING']);
select test.login('r_m_a1');
select create_lead('{"name":"UH Resell Lead","company":"UH Resell","email":"uh.resell@example.com","phone":"9820000202","leadSource":"Referral"}', array['AI_CALLING']);

\echo '   the Department Head of each unified department'
select test.login('i_head');
select test.check(test.ud_leads() like '%UH Intl Lead%' and test.ud_leads() like '%Intl Lead A1%' and test.ud_leads() like '%Intl Lead B1%' and test.ud_leads() not like '%Resell%',
  'the International head lists every International lead (both Team Leads'' members) and no Reseller lead');
select test.check(test.ud_names('sales_lead_assignees()') like '%UD i_lead_a%' and test.ud_names('sales_lead_assignees()') like '%UD i_m_b1%' and test.ud_names('sales_lead_assignees()') not like '%r_lead_a%' and test.ud_names('sales_lead_assignees()') not like '%r_m_a1%',
  'lead assignment offers International people only');
select test.check(test.ud_names('sales_team_people()') like '%UD i_m_a1%' and test.ud_names('sales_team_people()') not like '%UD r_%', 'the team list is International''s people only');
select test.check(sales_head_overview() ? 'cards', 'the Sales overview opens');
select test.check(sales_head_reports(null, current_date - 30, current_date, null) ? 'rows', 'the Sales reports open');
select test.check((sales_tasks_list() -> 'items') is not null and jsonb_array_length(sales_tasks_list() -> 'items') >= 1, 'the department''s tasks list opens and holds the tasks given in this department');
select test.check((division_leads_overview(test.dept('international'), 'SALES') -> 'totals' ->> 'members')::int = 5, 'the department overview counts International''s five people (two leads, three members)');
select test.check((division_support_overview(test.dept('international'), 'SUPPORT') -> 'totals' ->> 'tickets')::int >= 2, '... and its Support side counts the department''s tickets');
select test.must_fail(format($$select division_leads_overview('%s', 'SALES')$$, test.dept('reseller')), 'but not Reseller''s overview', 'Only the Super Admin or the Department Head');
select test.must_fail(format($$select division_support_overview('%s', 'SUPPORT')$$, test.dept('reseller')), '... nor its Support overview', 'Only the Super Admin or the Department Head');
select test.login('r_head');
select test.check(test.ud_leads() like '%UH Resell Lead%' and test.ud_leads() like '%Resell Lead 1%' and test.ud_leads() not like '%Intl%', 'the Reseller head lists Reseller leads only');
select test.check(test.ud_names('sales_lead_assignees()') like '%UD r_lead_a%' and test.ud_names('sales_lead_assignees()') not like '%UD i_%', 'and assigns to Reseller people only');
select test.check((division_support_overview(test.dept('reseller'), 'SUPPORT') -> 'totals' ->> 'tickets')::int = 1, 'the Reseller head''s Support overview counts the Reseller ticket only');

\echo '   nobody else gets the head''s pages'
select test.login('i_lead_a');
select test.must_fail($$select sales_leads_list()$$, 'a Team Lead of the department does not', 'Sales Department Head');
select test.must_fail($$select sales_head_overview()$$, '... nor the overview', 'Sales Department Head');
select test.login('i_m_a1');
select test.must_fail($$select sales_lead_assignees()$$, 'a Team Member does not', 'Sales Department Head');
select test.must_fail($$select sales_team_people()$$, '... nor the people list', 'Sales Department Head');

\echo '   existing departments are unchanged'
select test.login('wkr_dhp');
select test.must_fail($$select sales_leads_list()$$, 'the Support head of another department still has no Sales pages', 'Sales Department Head');
select test.must_fail($$select sales_head_overview()$$, '... nor its overview', 'Sales Department Head');
select test.login('wkr_dhs');
select test.check(jsonb_array_length(sales_leads_list() -> 'items') >= 0 and sales_head_overview() ? 'cards', 'the Sales head of another department still does, and sees no International or Reseller lead');
select test.check(test.ud_leads() not like '%UH %' and test.ud_leads() not like '%Intl%' and test.ud_leads() not like '%Resell%', '... none of the unified departments'' leads');
select test.login('tm_a');
select test.must_fail($$select sales_leads_list()$$, 'an existing Sales member still has none', 'Sales Department Head');
reset role;
select test.check((select count(*) = 1 from pg_proc where proname = 'require_sales_head' and pronamespace = 'private'::regnamespace), 'one guard, as before');

\echo '   re-running the migration changes nothing'
\i supabase/migrations/20270130000100_unified_head_sales_pages.sql
set role authenticated;
select test.login('i_head');
select test.check(test.ud_leads() like '%UH Intl Lead%', 'the head still has the pages');
reset role;
delete from customers where name in ('UH Intl Lead', 'UH Resell Lead');
select set_config('request.jwt.claims', '', false);
