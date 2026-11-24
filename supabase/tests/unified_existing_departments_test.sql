-- =============================================================================
-- International and Reseller that ALREADY exist (migration 20270202000300). The owner had created "Amuwa International Department" and "Amuwa Reseller
-- Department" in the Departments page: other slugs, no team, so Sales and Support were "not available". The migration recognises them by what they are
-- (name says International / Reseller, no Sales or Support team, not a side of another department), gives them their one team, fixes the dashboards of the
-- people in them, never touches a real Sales / Support department, and removes the seeded duplicate only when nothing at all points at it.
-- Then the six role / department combinations do real Sales (add a lead, assign it) and real Support (a ticket, worked and resolved) work, department-scoped.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 182. International and Reseller that already exist (any slug): Sales and Support for every designation'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270127000100_international_reseller_departments.sql

-- the departments as the owner made them: no team, other slugs; a decoy that must NOT be touched (it has a real Sales team)
insert into departments (slug, name, description, category) values
  ('amuwa-international-department', 'Amuwa International Department', 'Owner created', 'Sales & Support'),
  ('amuwa-reseller-department', 'Amuwa Reseller Department', 'Owner created', 'Sales & Support'),
  ('intl-sales-hub', 'International Sales Hub', 'A real Sales department that happens to say International', 'Sales');
insert into teams (department_id, name, division) values (test.dept('intl-sales-hub'), 'Hub Sales', 'SALES');
create or replace function test.ue_user(p_name text, p_role text, p_dept text, p_by text, p_extra jsonb default '{}') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'ue.' || p_name || '@example.com', jsonb_build_object('full_name', 'UE ' || p_name),
    jsonb_build_object('provisioned_by', test.id(p_by), 'provisioned_role', p_role) ||
    case when p_role = 'DEPARTMENT_HEAD' then jsonb_build_object('provisioned_department_id', test.dept(p_dept))
         else jsonb_build_object('provisioned_team_id', (select id from teams where department_id = test.dept(p_dept) limit 1)) end || p_extra) $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   before: the department has no team and is not unified (the reported error)'
select test.check((select not unified_sales_support from departments where slug = 'amuwa-international-department')
                  and not exists (select 1 from teams where department_id = test.dept('amuwa-international-department')), 'the owner-created department has no team and is not unified');
-- a Department Head the owner already has there, given a Sales-only side
select test.ue_user('ue_i_head', 'DEPARTMENT_HEAD', 'amuwa-international-department', 'sa');
update profiles set head_division = 'SALES' where id = test.id('ue_i_head');

\echo '   the migration (twice)'
\i supabase/migrations/20270202000300_unified_existing_departments.sql
\i supabase/migrations/20270202000300_unified_existing_departments.sql
select test.check((select count(*) = 2 and bool_and(unified_sales_support) from departments where slug in ('amuwa-international-department', 'amuwa-reseller-department')),
  'both existing departments are now unified, whatever their slug');
select test.check((select count(*) = 1 and bool_and(division = 'GENERAL') from teams where department_id = test.dept('amuwa-international-department'))
                  and (select count(*) = 1 and bool_and(division = 'GENERAL') from teams where department_id = test.dept('amuwa-reseller-department')), 'each has its one team (run twice: still one)');
select test.check((select count(*) = 1 from departments where name = 'Amuwa International Department') and (select count(*) = 1 from departments where name = 'Amuwa Reseller Department'), 'no duplicate department was created and none was renamed');
select test.check(not (select unified_sales_support from departments where slug = 'intl-sales-hub') and (select count(*) = 1 from teams where department_id = test.dept('intl-sales-hub') and division = 'SALES'),
  'a real Sales department that says International is untouched');
select test.check(not exists (select 1 from departments where unified_sales_support and slug not in ('international', 'reseller', 'amuwa-international-department', 'amuwa-reseller-department')),
  'no existing Sales / Support department became unified');
select test.check((select head_division is null and default_dashboard = 'unified-head' from profiles where id = test.id('ue_i_head')),
  'the head who was there gets the unified dashboard and no Sales-only side');
select test.must_fail($$insert into teams (department_id, name, division) values (test.dept('amuwa-international-department'), 'Split', 'SALES')$$, 'it cannot be split into a Sales-only team', 'Sales and Support together');

\echo '   the six combinations: designation and dashboard'
select test.ue_user('ue_i_lead', 'TEAM_HEAD', 'amuwa-international-department', 'sa');
select test.ue_user('ue_i_mem', 'TEAM_MEMBER', 'amuwa-international-department', 'ue_i_lead');
select test.ue_user('ue_r_head', 'DEPARTMENT_HEAD', 'amuwa-reseller-department', 'sa');
select test.ue_user('ue_r_lead', 'TEAM_HEAD', 'amuwa-reseller-department', 'sa');
select test.ue_user('ue_r_mem', 'TEAM_MEMBER', 'amuwa-reseller-department', 'ue_r_lead');
update profiles set manager_id = test.id('ue_i_lead') where id = test.id('ue_i_mem');
update profiles set manager_id = test.id('ue_r_lead') where id = test.id('ue_r_mem');
select test.check((select count(*) = 6 and bool_and(default_dashboard in ('unified-head', 'unified-lead', 'unified-member') and role <> 'SUPER_ADMIN') from profiles where email like 'ue.%'),
  'all six open the unified Sales + Support dashboard and none is a Super Admin');
select test.check((select (default_dashboard, role) in (('unified-head', 'DEPARTMENT_HEAD'), ('unified-lead', 'TEAM_HEAD'), ('unified-member', 'TEAM_MEMBER')) from profiles where id = test.id('ue_r_mem')), 'each designation maps to its own unified dashboard');
select test.check(private.direct_lead_of(test.id('ue_i_mem')) = test.id('ue_i_lead') and private.direct_lead_of(test.id('ue_r_mem')) = test.id('ue_r_lead'), 'the reporting hierarchy holds (member -> lead)');

\echo '   Sales: add a lead, see it, assign it (International and Reseller, each on its own data)'
create temp table ue (k text primary key, v uuid);
grant all on ue to authenticated;
create or replace function test.ue_sees(p_customer uuid) returns boolean language sql stable as $$ select exists (select 1 from customers where id = p_customer) $$;
grant execute on function test.ue_sees(uuid) to authenticated;
set role authenticated;
select test.login('ue_i_mem');
insert into ue select 'lead_i', create_lead('{"name":"UE Intl Lead","company":"UE Intl Traders","email":"ue.intl@example.com","phone":"9820000201","leadSource":"Referral"}', array['AI_CALLING']);
select test.login('ue_r_mem');
insert into ue select 'lead_r', create_lead('{"name":"UE Resell Lead","company":"UE Resell Co","email":"ue.resell@example.com","phone":"9820000202","leadSource":"Referral"}', array['AI_CALLING']);
reset role;
select test.check((select count(*) = 1 and bool_and(owner_id = test.id('ue_i_mem') and department_id = test.dept('amuwa-international-department') and lifecycle_stage = 'LEAD' and lead_status = 'NEW')
                     from customers where id = (select v from ue where k = 'lead_i')), 'International: the member''s lead is owned by them, in their department');
select test.check((select department_id = test.dept('amuwa-reseller-department') from customers where id = (select v from ue where k = 'lead_r')), 'Reseller: the same, in its own department');
set role authenticated;
select test.login('ue_i_mem');
select test.check(test.ue_sees((select v from ue where k = 'lead_i')) and not test.ue_sees((select v from ue where k = 'lead_r')), 'a member sees their own lead and nothing of the other department');
select test.login('ue_i_lead');
select test.check(test.ue_sees((select v from ue where k = 'lead_i')) and not test.ue_sees((select v from ue where k = 'lead_r')), 'the Team Lead sees their team''s lead only');
select test.login('ue_i_head');
select test.check(test.ue_sees((select v from ue where k = 'lead_i')) and not test.ue_sees((select v from ue where k = 'lead_r')), 'the Department Head sees the department''s leads only');
select test.check(jsonb_array_length(sales_leads_list() -> 'items') >= 1 and sales_head_overview() ? 'cards', 'the head''s Sales pages (department leads, overview) load');
select test.login('ue_r_head');
select test.check(test.ue_sees((select v from ue where k = 'lead_r')) and not test.ue_sees((select v from ue where k = 'lead_i')), 'the Reseller head sees only Reseller''s lead');
select test.must_fail(format($$select division_leads_overview('%s', 'SALES')$$, test.dept('amuwa-international-department')), 'and not International''s overview', 'Only the Super Admin or the Department Head');
select test.login('ue_i_lead');
insert into ue select 'lead_i2', create_lead('{"name":"UE Intl Lead Two","company":"UE Intl Exports","email":"ue.intl2@example.com","phone":"9820000203","leadSource":"Referral"}', array['AI_CALLING']);
select team_lead_assign_customer((select v from ue where k = 'lead_i2'), test.id('ue_i_mem'));
select test.check((select owner_id = test.id('ue_i_mem') from customers where id = (select v from ue where k = 'lead_i2')), 'the Team Lead assigns a lead to their member (lead assignment works)');
select test.login('ue_r_lead');
select test.must_fail(format($$select team_lead_assign_customer('%s', '%s')$$, (select v from ue where k = 'lead_i2'), test.id('ue_r_mem')), 'a Reseller Team Lead cannot move an International lead', 'NOT_FOUND|Customer not found|member of your team');
select test.login('ue_i_lead');
select test.login('tm_a');
select test.check(not test.ue_sees((select v from ue where k = 'lead_i')) and not test.ue_sees((select v from ue where k = 'lead_r')), 'an existing Sales member sees none of it');
select test.login('sup_b');
select test.check(not test.ue_sees((select v from ue where k = 'lead_i')), 'nor an existing Support member');
select test.login('sa');
select test.check(test.ue_sees((select v from ue where k = 'lead_i')) and test.ue_sees((select v from ue where k = 'lead_r')), 'the Super Admin sees both');

\echo '   Support: customers and tickets, worked by the same member'
reset role;
update customers set lifecycle_stage = 'CUSTOMER' where id in (select v from ue);
set role authenticated;
select test.login('ue_i_mem');
insert into ue select 'tk_i', create_support_ticket((select v from ue where k = 'lead_i'), 'UE Calls not connecting', 'No outgoing calls', 'TECHNICAL', 'HIGH');
select test.check((select assignee_id = test.id('ue_i_mem') and department_id = test.dept('amuwa-international-department') from support_tickets where id = (select v from ue where k = 'tk_i')), 'the member raises a ticket for their customer and owns it');
select test.must_fail(format($$select create_support_ticket('%s', 'Not theirs', 'Other department', 'GENERAL', 'LOW')$$, (select v from ue where k = 'lead_r')), 'not for another department''s customer', 'NOT_FOUND');
select update_support_ticket((select v from ue where k = 'tk_i'), 'IN_PROGRESS', 'Checking');
select update_support_ticket((select v from ue where k = 'tk_i'), 'RESOLVED', 'Fixed', 'Re-linked the account.');
select test.check((select status = 'RESOLVED' from support_tickets where id = (select v from ue where k = 'tk_i')), 'the member updates the status and resolves it');
select test.login('ue_i_lead');
select test.check((select count(*) = 1 from support_tickets where id = (select v from ue where k = 'tk_i')), 'the Team Lead sees their member''s ticket');
select update_support_ticket((select v from ue where k = 'tk_i'), 'CLOSED', 'Closed', 'Confirmed with the customer.');
select test.check((select status = 'CLOSED' from support_tickets where id = (select v from ue where k = 'tk_i')), 'and closes it');
select test.login('ue_r_mem');
insert into ue select 'tk_r', create_support_ticket((select v from ue where k = 'lead_r'), 'UE Resell ticket', 'Resell issue', 'GENERAL', 'LOW');
select test.check((select count(*) = 1 from support_tickets), 'a Reseller member sees only their own ticket (never International''s)');
select test.login('ue_i_head');
select test.check((select count(*) = 1 and bool_and(department_id = test.dept('amuwa-international-department')) from support_tickets where id in (select v from ue where k in ('tk_i', 'tk_r'))), 'the International head sees International''s ticket only');
select test.login('ue_r_head');
select test.check((select count(*) = 1 and bool_and(department_id = test.dept('amuwa-reseller-department')) from support_tickets where id in (select v from ue where k in ('tk_i', 'tk_r'))), 'the Reseller head sees Reseller''s ticket only');
select test.login('sup_b');
select test.check((select count(*) = 0 from support_tickets where id in (select v from ue where k in ('tk_i', 'tk_r'))), 'existing Support staff see none of them');

\echo '   the seeded duplicate: removed only when nothing points at it'
reset role;
select test.check((select count(*) = 1 from departments where slug = 'international') and (select count(*) = 1 from departments where slug = 'reseller'), 'the seeded departments that other suites use are in use, so they are kept');
-- generic seeds: the keyword is the seed's slug; the "existing" department names it
insert into departments (slug, name, unified_sales_support) values ('zza', 'The Zza Department', true), ('zzb', 'The Zzb Department', true), ('zzd', 'Seed Zzd', true);
insert into departments (slug, name, unified_sales_support) values ('zza-seed', 'Zza Seed', true), ('zzb-seed', 'Zzb Seed', true);
insert into teams (department_id, name, division) select id, name || ' Team', 'GENERAL' from departments where slug in ('zza', 'zzb', 'zzd', 'zza-seed', 'zzb-seed');
-- the seed of each is the department whose slug IS the keyword; the existing one is named after it, so swap the roles: slug zzx = seed, "The Zzx Department" = existing
update departments set slug = 'zza-existing' where slug = 'zza';
update departments set slug = 'zzb-existing' where slug = 'zzb';
update departments set slug = 'zza', name = 'Seed Zza' where slug = 'zza-seed';
update departments set slug = 'zzb', name = 'Seed Zzb' where slug = 'zzb-seed';
update departments set name = 'The Zza Department' where slug = 'zza-existing';
select private.unified_drop_unused_seed('zza') as dropped_zza \gset
select test.check(:'dropped_zza'::boolean and not exists (select 1 from departments where slug = 'zza') and not exists (select 1 from teams where name = 'Zza Seed Team'),
  'an unused seeded duplicate (only its own team) is removed in favour of the existing department');
select test.check(exists (select 1 from departments where slug = 'zza-existing'), 'the existing department stays');
select test.create_auth_user('ue_zz_head', 'ue.zz.head@example.com', '{"full_name":"UE ZZ"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('zzb')));
select test.check(not private.unified_drop_unused_seed('zzb') and exists (select 1 from departments where slug = 'zzb') and exists (select 1 from profiles where id = test.id('ue_zz_head') and department_id = test.dept('zzb')),
  'a seeded duplicate with a person in it is kept, with the person');
select test.check(not private.unified_drop_unused_seed('zzd') and exists (select 1 from departments where slug = 'zzd'), 'a department with no existing replacement is kept');
select test.check(private.unified_drop_unused_seed('no-such-department') = false, 'an unknown slug does nothing');
set role authenticated;
select test.login('sa');
select test.must_fail($$select private.unified_drop_unused_seed('zzd')$$, 'nobody can call it from the API, not even the Super Admin', 'permission denied');
reset role;

-- clean up what this file made (the people, leads and tickets go first; nothing of other suites is touched)
delete from support_tickets where id in (select v from ue);
delete from customers where id in (select v from ue where k like 'lead%');
delete from teams where department_id in (select id from departments where slug in ('zzb', 'zzd', 'zza-existing', 'zzb-existing'));
delete from auth.users where email like 'ue.%';
delete from teams where department_id in (select id from departments where slug in ('amuwa-international-department', 'amuwa-reseller-department', 'intl-sales-hub'));
delete from departments where slug in ('zzb', 'zzd', 'zza-existing', 'zzb-existing', 'amuwa-international-department', 'amuwa-reseller-department', 'intl-sales-hub');
select set_config('request.jwt.claims', '', false);
