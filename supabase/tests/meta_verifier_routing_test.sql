-- =============================================================================
-- Sales reaches the Meta Verifier who verifies for the customer's department, wherever that verifier is placed (migration 20261227000100).
-- Own synthetic departments (mvr-a: the verifier's home, mvr-b: no verifier of its own) and people (prefix mvr_).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Meta Verifier: Sales of another department reaches them'
reset role;
\i supabase/migrations/20261223000300_meta_verifier_departments.sql
\i supabase/migrations/20261227000100_meta_verifier_cross_department_routing.sql
\i supabase/migrations/20261227000100_meta_verifier_cross_department_routing.sql

delete from public.customers where company like 'MVR %';
delete from auth.users where email like 'mvr.%@example.com';
delete from test.users where name like 'mvr\_%';
delete from teams where department_id in (select id from departments where slug like 'mvr-%');
delete from departments where slug like 'mvr-%';
insert into departments (slug, name) values ('mvr-a', 'MVR Alpha'), ('mvr-b', 'MVR Beta');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'mvr-%';
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'mvr-%';

create or replace function test.mvrmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'mvr.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'MVR ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;
select set_config('request.jwt.claims', '{"role":"service_role"}', false); select test.mvrmk('mvr_v', 'TEAM_MEMBER', 'mvr-a', 'Support');
select set_config('request.jwt.claims', '{"role":"service_role"}', false); select test.mvrmk('mvr_sb', 'TEAM_MEMBER', 'mvr-b', 'Sales');
select set_config('request.jwt.claims', '{"role":"service_role"}', false); select test.mvrmk('mvr_lb', 'TEAM_HEAD', 'mvr-b', 'Support');
update profiles set is_meta_verifier = true where id = test.id('mvr_v');

-- a Beta customer of the Beta sales member, on the Meta route (WhatsApp API), ready to be sent on
create temp table mvr (name text primary key, id uuid);
grant all on mvr to authenticated, service_role;
insert into public.customers (owner_id, name, company, phone, lifecycle_stage, department_id, team_id)
values (test.id('mvr_sb'), 'Client Beta', 'MVR Beta Traders', '9819877001', 'LEAD', test.dept('mvr-b'), test.team('mvr-b', 'Sales'));
insert into mvr select 'c', id from customers where company = 'MVR Beta Traders';
insert into public.customer_services (customer_id, service_code) select id, 'WHATSAPP_API' from mvr where name = 'c';
update public.customers set lifecycle_stage = 'ONBOARDING' where id = (select id from mvr where name = 'c');
insert into public.customer_onboarding (customer_id) select id from mvr where name = 'c' on conflict do nothing;
select test.check(private.onboarding_route((select id from mvr where name = 'c')) = 'META', 'the customer goes through Meta verification');

\echo '   before Beta is added to the verifier: Sales is told nobody is there, and the send is refused'
set role authenticated;
select test.login('mvr_sb');
select test.check(not (onboarding_handoff_info((select id from mvr where name = 'c')) ->> 'recipientAvailable')::boolean, 'Beta has no Meta Verifier yet');
reset role;
select test.must_fail($$select private.forward_to_consultant((select id from mvr where name = 'c'), (select c from customers c where c.id = (select id from mvr where name = 'c')), false)$$,
  'sending is refused while nobody verifies for Beta', 'No active Meta Verifier verifies for this department');

\echo '   the Super Admin adds Beta to the Alpha-based verifier: Beta sales reaches them'
set role authenticated;
select test.login('sa');
select verifier_departments_set(test.id('mvr_v'), array[test.dept('mvr-b')]);
select test.login('mvr_sb');
select test.check((onboarding_handoff_info((select id from mvr where name = 'c')) ->> 'recipientAvailable')::boolean
               and (onboarding_handoff_info((select id from mvr where name = 'c')) ->> 'recipient') = 'Meta Verifier', 'Sales of Beta now sees a Meta Verifier ready to receive the customer');
reset role;
select private.forward_to_consultant((select id from mvr where name = 'c'), (select c from customers c where c.id = (select id from mvr where name = 'c')), false);
select test.check((select forwarded_to_support_at is not null from customer_onboarding where customer_id = (select id from mvr where name = 'c')), 'the customer is sent on');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('mvr_v') and type = 'ONBOARDING_FORWARDED' and entity_id = (select id from mvr where name = 'c')),
  'the verifier placed in Alpha is told, once');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('mvr_lb') and type = 'ONBOARDING_FORWARDED' and entity_id = (select id from mvr where name = 'c')),
  'and Beta''s Support Team Lead too, as before');
set role authenticated;
select test.login('mvr_v');
select test.check((select count(*) = 1 from customers where id = (select id from mvr where name = 'c')), 'the customer is in the verifier''s queue');
select test.check(private.can_review_onboarding((select id from mvr where name = 'c')), 'and the verifier may verify it');

\echo '   Beta taken away again: Sales of Beta is told nobody is there'
select test.login('sa');
select verifier_departments_set(test.id('mvr_v'), '{}'::uuid[]);
select test.login('mvr_sb');
select test.check(not (onboarding_handoff_info((select id from mvr where name = 'c')) ->> 'recipientAvailable')::boolean, 'without Beta the verifier is no longer offered');
select test.login('mvr_v');
select test.check((select count(*) = 0 from customers where id = (select id from mvr where name = 'c')), 'and the customer leaves the verifier''s queue');
reset role;
