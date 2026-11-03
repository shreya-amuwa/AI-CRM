-- =============================================================================
-- Meta Verifier department scope (migration 20261223000300): one verifier, several departments, no extra powers.
-- Own synthetic departments (mvd-a home of the verifier, mvd-b, mvd-c, mvd-d) and people (prefix mvd_). Runs after the other suites.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 122. Meta Verifier: several departments'
reset role;
\i supabase/migrations/20261223000300_meta_verifier_departments.sql
\i supabase/migrations/20261223000300_meta_verifier_departments.sql

delete from public.customers where company like 'MVD %';
delete from auth.users where email like 'mvd.%@example.com';
delete from test.users where name like 'mvd\_%';
delete from teams where department_id in (select id from departments where slug like 'mvd-%');
delete from departments where slug like 'mvd-%';
insert into departments (slug, name) values ('mvd-a', 'MVD Alpha'), ('mvd-b', 'MVD Beta'), ('mvd-c', 'MVD Gamma'), ('mvd-d', 'MVD Delta');
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'mvd-%';
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'mvd-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.mvdmk(p_name text, p_role text, p_dept text, p_team text default null) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'mvd.' || substr(p_name, 5) || '@example.com', jsonb_build_object('full_name', 'MVD ' || substr(p_name, 5)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role,
      'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', case when p_team is null then null else test.team(p_dept, p_team) end)))
$$;
grant execute on all functions in schema test to anon, authenticated;
create temp table mvd (name text primary key, id uuid);
grant all on mvd to authenticated, service_role;

\echo '   people: a verifier of Alpha, a verifier of Beta, an Operations Head (Alpha's head), Beta's Department Head, a Sales member'
select test.service(); select test.mvdmk('mvd_oh', 'DEPARTMENT_HEAD', 'mvd-a');
select test.service(); select test.mvdmk('mvd_dhb', 'DEPARTMENT_HEAD', 'mvd-b');
select test.service(); select test.mvdmk('mvd_v', 'TEAM_MEMBER', 'mvd-a', 'Support');
select test.service(); select test.mvdmk('mvd_vb', 'TEAM_MEMBER', 'mvd-b', 'Support');
select test.service(); select test.mvdmk('mvd_plain', 'TEAM_MEMBER', 'mvd-a', 'Support');
select test.service(); select test.mvdmk('mvd_sales', 'TEAM_MEMBER', 'mvd-a', 'Sales');
select test.service(); select test.mvdmk('mvd_mc', 'TEAM_MEMBER', 'mvd-c', 'Support');   -- owners of Gamma's and Delta's customers
select test.service(); select test.mvdmk('mvd_md', 'TEAM_MEMBER', 'mvd-d', 'Support');
update profiles set is_meta_verifier = true where id in (test.id('mvd_v'), test.id('mvd_vb'));
set role authenticated;
select test.login('sa');
select set_operations_head(test.id('mvd_oh'), true, 'test');
select operations_head_scope_set(test.id('mvd_oh'), array[test.dept('mvd-a'), test.dept('mvd-b'), test.dept('mvd-c')], array[test.dept('mvd-a'), test.dept('mvd-b'), test.dept('mvd-c')]);
reset role;
select test.check((select count(*) = 8 from profiles where id in (select id from test.users where name like 'mvd\_%') and status = 'ACTIVE'), 'the synthetic people exist and are active');

-- one customer per department that goes through Meta verification (WhatsApp API), forwarded to the verifier; one Alpha customer on the other route (AI Calling)
create or replace function test.mvdcust(p_company text, p_dept text, p_service text) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_team uuid := test.team(p_dept, 'Support');
  v_owner uuid := (select id from public.profiles where department_id = test.dept(p_dept) and team_id = v_team and role = 'TEAM_MEMBER' limit 1);
begin
  insert into public.customers (owner_id, name, company, phone, lifecycle_stage, department_id, team_id)
  values (v_owner, 'Client ' || p_company, 'MVD ' || p_company, '98198' || lpad((random() * 99999)::int::text, 5, '0'), 'LEAD', test.dept(p_dept), v_team) returning id into v_id;
  insert into public.customer_services (customer_id, service_code) values (v_id, p_service);
  update public.customers set lifecycle_stage = 'ONBOARDING' where id = v_id;
  insert into public.customer_onboarding (customer_id) values (v_id) on conflict do nothing;
  update public.customer_onboarding set forwarded_to_support_at = now(), accounts_confirmed_at = now() where customer_id = v_id;
  return v_id;
end $$;
grant execute on function test.mvdcust(text, text, text) to anon, authenticated;
create or replace function test.mvdcov(p_user text, p_dept text) returns boolean language sql stable security definer set search_path = '' as $$ select private.verifier_covers(test.id(p_user), test.dept(p_dept)) $$;
grant execute on function test.mvdcov(text, text) to anon, authenticated;
insert into mvd select 'a', test.mvdcust('Alpha', 'mvd-a', 'WHATSAPP_API');
insert into mvd select 'b', test.mvdcust('Beta', 'mvd-b', 'WHATSAPP_API');
insert into mvd select 'c', test.mvdcust('Gamma', 'mvd-c', 'WHATSAPP_API');
insert into mvd select 'd', test.mvdcust('Delta', 'mvd-d', 'WHATSAPP_API');
insert into mvd select 'bt', test.mvdcust('Beta Technical', 'mvd-b', 'AI_CALLING');
select test.check((select count(*) = 5 from mvd) and (select bool_and(private.onboarding_route(id) = 'META') from mvd where name in ('a', 'b', 'c', 'd')) and private.onboarding_route((select id from mvd where name = 'bt')) <> 'META',
  'five customers exist: four on the Meta route, one on the other');

\echo '   before: a verifier works only the home department'
set role authenticated;
select test.login('mvd_v');
select test.check(private.can_review_onboarding((select id from mvd where name = 'a')), 'the verifier reviews Alpha''s customer (home)');
select test.check(not private.can_review_onboarding((select id from mvd where name = 'b')) and not private.can_review_onboarding((select id from mvd where name = 'c')), 'but not Beta''s or Gamma''s');
select test.check((select count(*) = 1 from customers where company like 'MVD %'), 'and sees only the home customer through the customer list (RLS)');
select test.check(test.mvdcov('mvd_v', 'mvd-a') and not test.mvdcov('mvd_v', 'mvd-b'), 'scope = the home department');

\echo '   who may change the departments'
select test.login('mvd_v');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_v'), test.dept('mvd-b')), 'a verifier cannot give themselves departments', 'NOT_FOUND');
select test.login('mvd_sales');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_v'), test.dept('mvd-b')), 'Sales cannot', 'NOT_FOUND');
select test.login('mvd_dhb');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_v'), test.dept('mvd-b')), 'a Department Head who is not an Operations Head cannot either', 'NOT_FOUND');
select test.login('mvd_oh');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_v'), test.dept('mvd-d')), 'an Operations Head cannot add a department they do not own', 'NOT_FOUND');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_plain'), test.dept('mvd-b')), 'nor make an ordinary Team Member a multi-department verifier', 'NOT_FOUND|Only an active Meta Verifier');
select test.login('sa');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_plain'), test.dept('mvd-b')), 'the Super Admin cannot either: the person must be a Meta Verifier first', 'Only an active Meta Verifier');
select test.must_fail(format($$select verifier_departments_set('%s', array['%s']::uuid[])$$, test.id('mvd_v'), gen_random_uuid()), 'a department that does not exist is refused', 'existing departments');
select test.login('mvd_oh');
select test.check((select verifier_departments_set(test.id('mvd_v'), array[test.dept('mvd-b'), test.dept('mvd-c'), test.dept('mvd-a')]) -> 'extra' @> jsonb_build_array(jsonb_build_object('id', test.dept('mvd-b'), 'name', 'MVD Beta'))), 'the Operations Head who owns Alpha, Beta and Gamma gives the verifier Beta and Gamma (Alpha, the home, is implicit)');
select test.check((select jsonb_array_length(verifier_departments_get(test.id('mvd_v')) -> 'extra') = 2 and (verifier_departments_get(test.id('mvd_v')) -> 'home' ->> 'name') = 'MVD Alpha'), 'two extra departments, the home department preserved');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'META_VERIFIER_SCOPE_CHANGED' and entity_id = test.id('mvd_v') and metadata -> 'to' @> to_jsonb(array[test.dept('mvd-b')::text])), 'the scope change is audited');

\echo '   after: Alpha, Beta and Gamma - nothing else'
set role authenticated;
select test.login('mvd_v');
select test.check(private.can_review_onboarding((select id from mvd where name = 'a')) and private.can_review_onboarding((select id from mvd where name = 'b')) and private.can_review_onboarding((select id from mvd where name = 'c')),
  'the verifier reviews the Meta customers of Alpha, Beta and Gamma');
select test.check(not private.can_review_onboarding((select id from mvd where name = 'd')), 'not Delta''s (not assigned)');
select test.check(not private.can_review_onboarding((select id from mvd where name = 'bt')), 'not Beta''s customer that goes through the Technical Consultant (another route)');
select test.check((select array_agg(company order by company) = array['MVD Alpha', 'MVD Beta', 'MVD Gamma'] from customers where company like 'MVD %'), 'the customer list shows only the Meta customers of the three departments');
select test.check(test.mvdcov('mvd_v', 'mvd-b') and not test.mvdcov('mvd_v', 'mvd-d'), 'scope = home + the two granted departments');

\echo '   department access is not management access'
select test.must_fail($$select count(*) from customer_payments$$, 'the verifier cannot read payments at all', 'permission denied');
select test.must_fail($$select hierarchy_report()$$, 'has no Department Head tools', 'Only the Super Admin');
select test.must_fail(format($$select assign_direct_lead('%s', '%s')$$, test.id('mvd_plain'), test.id('mvd_v')), 'cannot name Team Leads', 'NOT_FOUND');
select test.must_fail($$select * from meta_verifier_departments$$, 'cannot read the scope table directly', 'permission denied');
select test.check((select role = 'TEAM_MEMBER' and not is_operations_head from profiles where id = test.id('mvd_v')), 'and is still an ordinary Team Member with the verifier flag');
select test.login('mvd_dhb');
select test.check(not private.can_review_onboarding((select id from mvd where name = 'a')), 'Beta''s Department Head gets nothing from the verifier''s scope');
reset role;

\echo '   automatic assignment: only eligible verifiers with the department in scope'
select test.check(private.pick_meta_verifier((select id from mvd where name = 'c')) = test.id('mvd_v'), 'Gamma has one verifier in scope: the multi-department verifier');
select test.check(private.pick_meta_verifier((select id from mvd where name = 'd')) is null, 'Delta has nobody in scope: it stays unassigned (not given to an arbitrary verifier)');
select test.check(private.pick_meta_verifier((select id from mvd where name = 'b')) in (test.id('mvd_v'), test.id('mvd_vb')), 'Beta has two eligible verifiers');
select test.check(not private.is_verifier_for(test.id('mvd_plain'), (select id from mvd where name = 'a')) and not private.is_verifier_for(test.id('mvd_vb'), (select id from mvd where name = 'a')), 'an ordinary member and a verifier of another department are not eligible for Alpha');
update customer_onboarding set meta_verifier_id = test.id('mvd_v') where customer_id in (select id from mvd where name in ('b', 'c'));

\echo '   the verifier''s client conversations follow the scope'
set role authenticated;
select test.login('mvd_v');
select test.check((select array_agg(x ->> 'name' order by x ->> 'name') @> array['Client Beta', 'Client Gamma'] from jsonb_array_elements(chat_my_clients()) x), 'the verifier''s client list holds the customers of the other departments they verify');
reset role;

\echo '   removing a department removes the access at once and re-picks the verifications'
set role authenticated;
select test.login('sa');
select test.check((select (verifier_departments_set(test.id('mvd_v'), array[test.dept('mvd-c')]) ->> 'reassigned')::int = 1), 'Beta is taken away: one unfinished verification is moved');
reset role;
select test.check((select meta_verifier_id = test.id('mvd_vb') from customer_onboarding where customer_id = (select id from mvd where name = 'b')), 'Beta''s customer now belongs to Beta''s own verifier');
select test.check((select meta_verifier_id = test.id('mvd_v') from customer_onboarding where customer_id = (select id from mvd where name = 'c')), 'Gamma''s stays with the verifier (still in scope)');
select test.check((select count(*) = 1 from audit_logs where action = 'META_VERIFIER_REASSIGNED' and entity_id = (select id from mvd where name = 'b')), 'the move is audited');
select test.check((select count(*) = 2 from notifications where type = 'META_VERIFIER_ASSIGNED' and recipient_id = test.id('mvd_vb') and entity_id = (select id from mvd where name = 'b')), 'the new verifier is told (a second notice, after the first automatic assignment)');
select test.check((select count(*) = 1 from notifications where type = 'META_VERIFIER_SCOPE_CHANGED' and recipient_id = test.id('mvd_v')), 'and so is the one who lost the department');
set role authenticated;
select test.login('mvd_v');
select test.check(not private.can_review_onboarding((select id from mvd where name = 'b')) and private.can_review_onboarding((select id from mvd where name = 'c')), 'access to Beta ended at once, Gamma''s stays');
select test.check((select array_agg(company order by company) = array['MVD Alpha', 'MVD Gamma'] from customers where company like 'MVD %'), 'and the customer list follows');
select test.check((select not exists (select 1 from jsonb_array_elements(chat_my_clients()) x where x ->> 'name' = 'Client Beta')), 'and so does the client conversation list');
reset role;

\echo '   a suspended verifier has no scope; the home department is not removable'
update profiles set status = 'SUSPENDED' where id = test.id('mvd_v');
select test.check(not test.mvdcov('mvd_v', 'mvd-c') and not test.mvdcov('mvd_v', 'mvd-a'), 'a suspended verifier covers nothing');
update profiles set status = 'ACTIVE' where id = test.id('mvd_v');
set role authenticated;
select test.login('sa');
select test.check((select verifier_departments_set(test.id('mvd_v'), array[test.dept('mvd-a')]) -> 'extra' = '[]'::jsonb), 'listing the home department changes nothing (it is implicit)');
select test.check(test.mvdcov('mvd_v', 'mvd-a'), 'the home department is still covered');
reset role;
