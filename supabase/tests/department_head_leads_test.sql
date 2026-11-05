-- =============================================================================
-- A Department Head adds leads of their own (migration 20261220000200). Own synthetic department; nothing from earlier suites.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 78. Department Head leads'
reset role;
\i supabase/migrations/20261220000200_department_head_leads.sql

delete from customers where company like 'DL %';
delete from auth.users where email like 'dl.%@example.com';
delete from test.users where name like 'dl\_%';
delete from teams where department_id in (select id from departments where slug like 'dl-%');
delete from departments where slug like 'dl-%';
insert into departments (slug, name) values ('dl-a', 'DL Alpha');
insert into teams (department_id, name, division) select id, 'Sales', 'SALES' from departments where slug = 'dl-a';
insert into teams (department_id, name, division) select id, 'Support', 'SUPPORT' from departments where slug = 'dl-a';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.create_auth_user('dl_dh', 'dl.dh@example.com', '{"full_name":"DL Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', (select id from departments where slug = 'dl-a'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('dl_tl', 'dl.tl@example.com', '{"full_name":"DL Lead"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'dl-a' and t.name = 'Sales')));
select test.check((select team_id is null from profiles where id = test.id('dl_dh')), 'a Department Head belongs to a department, not a team');

\echo '   the Department Head adds a lead'
set role authenticated;
select test.login('dl_dh');
create temp table dl (name text primary key, id uuid);
grant all on dl to authenticated, service_role;
insert into dl select 'head', create_lead('{"name":"DL Head Lead","company":"DL Head Co","email":"dl.hl@example.com","phone":"9819930001","whatsapp":"9819930001","leadSource":"Walk-in"}', array['AI_CALLING']);
select test.check((select owner_id = test.id('dl_dh') and lifecycle_stage = 'LEAD' from customers where id = (select id from dl where name = 'head')), 'the lead is the head''s own');
select test.check((select t.name = 'Sales' and t.division = 'SALES' and c.department_id = t.department_id from customers c join teams t on t.id = c.team_id where c.id = (select id from dl where name = 'head')), 'it sits in the department''s Sales team');
select test.check((select count(*) = 1 from customers where id = (select id from dl where name = 'head')), 'and the head sees it');
select test.check(private.can_assign_customer_owner(test.id('dl_dh')), 'a head may own leads');
select test.check((select lead_status = 'NEW' from customers where id = (select id from dl where name = 'head')), 'a normal new lead');
select test.login('dl_tl');
-- 20261225000100 (strict hierarchy): a Team Lead sees their own and their direct members' customers, not their head's own leads
select test.check((select count(*) = 0 from customers where id = (select id from dl where name = 'head')), 'the Team Lead of that Sales team does not see the head''s own lead');
insert into dl select 'lead', create_lead('{"name":"DL Lead Lead","company":"DL Lead Co","email":"dl.ll@example.com","phone":"9819930002","whatsapp":"9819930002","leadSource":"Walk-in"}', array['AI_CALLING']);
select test.check((select owner_id = test.id('dl_tl') and team_id = (select team_id from profiles where id = test.id('dl_tl')) from customers where id = (select id from dl where name = 'lead')), 'a Team Lead adds a lead of their own in their team (unchanged)');
select test.must_fail($$select create_lead('{"name":"X","company":"DL Y","phone":"9819930003","whatsapp":"9819930003","leadSource":"Walk-in","ownerId":"00000000-0000-0000-0000-000000000000"}', array['AI_CALLING'])$$, 'an unknown owner is still refused', 'owner');
reset role;
select test.check(private.lead_team_of(test.id('dl_tl')) is null, 'only a Department Head gets a team this way');
select test.check(private.lead_team_of(test.id('dl_dh')) = (select t.id from teams t join departments d on d.id = t.department_id where d.slug = 'dl-a' and t.name = 'Sales'), 'a head gets the team of their own side (Sales unless they head the Support side)');
