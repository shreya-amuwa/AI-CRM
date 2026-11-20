-- =============================================================================
-- Amuwa Design Studio roles (migrations 20270112000100, 20270112000200): only Department Head, Team Lead and Team Member; no Sales or Support role, team,
-- side or Sales role, whichever path tries it. Own synthetic people (prefix dsr_). Runs after the other suites on the same database.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 131. Amuwa Design Studio: Department Head, Team Lead and Team Member only'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270112000100_designstudio_department_roles.sql
\i supabase/migrations/20270112000100_designstudio_department_roles.sql
\i supabase/migrations/20270112000200_amuwa_design_studio_rename.sql
\i supabase/migrations/20270112000200_amuwa_design_studio_rename.sql
-- the rename migration labels the old department "(Retired)" again; the restore migration undoes that, and running it twice changes nothing more
\i supabase/migrations/20270118000100_amuwa_design_studio_restore.sql
\i supabase/migrations/20270118000100_amuwa_design_studio_restore.sql
select test.check((select name from departments where slug = 'designstudio') = 'Amuwa Design Studio' and (select name from departments where slug = 'ai-design-studio') = 'AI Design Studio',
  'the restore migration gives each department its name back, and is safe to run twice');
delete from auth.users where email like 'dsr.%@example.com';
delete from test.users where name like 'dsr\_%';
create or replace function test.dsr_dep(p text) returns uuid language sql stable as $$ select id from public.departments where slug = p $$;
create or replace function test.dsr_profile(p_name text) returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select * from public.profiles where id = test.id(p_name) $$;
grant execute on all functions in schema test to anon, authenticated;

select test.check(test.team('designstudio', 'General') is not null and test.team('designstudio', 'Sales') is not null and test.team('designstudio', 'Support') is not null,
  '(setup) Amuwa Design Studio has its General team (and the Sales / Support teams the Access Control matrix uses are untouched)');

\echo '   the API check before an account is made (assert_can_create_user)'
set role authenticated;
select test.login('sa');
select test.check(assert_can_create_user('TEAM_MEMBER', null, test.team('designstudio', 'General')), 'the Super Admin may create a Team Member of the General team');
select test.check(assert_can_create_user('TEAM_HEAD', null, test.team('designstudio', 'General')), '... and a Team Lead of it');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', null, test.team('designstudio', 'Sales'))$$, 'a Sales Team Member is refused', 'no Sales or Support roles');
select test.must_fail($$select assert_can_create_user('TEAM_HEAD', null, test.team('designstudio', 'Sales'))$$, 'a Sales Team Lead is refused', 'no Sales or Support roles');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', null, test.team('designstudio', 'Support'))$$, 'a Support Team Member is refused', 'no Sales or Support roles');
select test.must_fail($$select assert_can_create_user('TEAM_HEAD', null, test.team('designstudio', 'Support'))$$, 'a Support Team Lead is refused', 'no Sales or Support roles');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', test.dsr_dep('designstudio'), test.team('designstudio', 'Support'))$$, '... also when the department is sent with it', 'no Sales or Support roles');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dsr_dep('designstudio'), null, 'SALES')$$, 'a Sales Department Head is refused', 'no Sales or Support Department Head');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dsr_dep('designstudio'), null, 'SUPPORT')$$, 'a Support Department Head is refused', 'no Sales or Support Department Head');
select test.check(assert_can_create_user('TEAM_MEMBER', null, test.team('wabastore', 'Sales')) and assert_can_create_user('TEAM_MEMBER', null, test.team('wabastore', 'Support')),
  'another department keeps its Sales and Support roles');
reset role;

\echo '   the profile itself (provisioning, role change, team move, Sales role)'
select test.must_fail($$select test.create_auth_user('dsr_sales', 'dsr.sales@example.com', '{"full_name":"DSR Sales"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('designstudio', 'Sales')))$$,
  'an account in the Sales team is never made (even when the API check is skipped)', 'no Sales or Support roles');
select test.check(not exists (select 1 from auth.users where email = 'dsr.sales@example.com') and not exists (select 1 from profiles where email = 'dsr.sales@example.com'),
  '... and no half-made login or profile is left');
select test.must_fail($$select test.create_auth_user('dsr_head', 'dsr.head@example.com', '{"full_name":"DSR Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dsr_dep('designstudio'), 'provisioned_head_division', 'SUPPORT'))$$,
  'a Support Department Head account is never made', 'no Sales or Support');
select test.create_auth_user('dsr_tm', 'dsr.tm@example.com', '{"full_name":"DSR Member"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('designstudio', 'General')));
select test.create_auth_user('dsr_tl', 'dsr.tl@example.com', '{"full_name":"DSR Lead"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('designstudio', 'General')));
select test.check((select role = 'TEAM_MEMBER' and department_id = test.dsr_dep('designstudio') and team_id = test.team('designstudio', 'General') from test.dsr_profile('dsr_tm')),
  'a Team Member is saved in Amuwa Design Studio with its General team');
select test.check((select role = 'TEAM_HEAD' and department_id = test.dsr_dep('designstudio') from test.dsr_profile('dsr_tl')), 'a Team Lead is saved in Amuwa Design Studio');

set role authenticated;
select test.login('sa');
select test.must_fail($$select assign_user(test.id('dsr_tm'), 'TEAM_MEMBER', null, test.team('designstudio', 'Sales'))$$, 'moving a member into the Sales team is refused', 'no Sales or Support roles');
select test.must_fail($$select assign_user(test.id('dsr_tl'), 'TEAM_HEAD', null, test.team('designstudio', 'Support'))$$, 'moving a Team Lead into the Support team is refused', 'no Sales or Support roles');
select test.must_fail($$select set_sales_sub_role(test.id('dsr_tm'), 'TELECALLER')$$, 'a Telecaller role is refused', 'Sales');
select test.must_fail($$select set_sales_sub_role(test.id('dsr_tm'), 'BUSINESS_ASSOCIATE')$$, 'a Business Associate role is refused', 'Sales');
select assign_user(test.id('dsr_tm'), 'TEAM_HEAD', null, test.team('designstudio', 'General'));
reset role;
select test.check((select role = 'TEAM_HEAD' and team_id = test.team('designstudio', 'General') and sales_sub_role is null from test.dsr_profile('dsr_tm')),
  'a valid change (Team Member -> Team Lead of the General team) still works, and nothing invalid was saved');
select test.create_auth_user('dsr_tm2', 'dsr.tm2@example.com', '{"full_name":"DSR Member Two"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('designstudio', 'General')));
update profiles set sales_sub_role = 'TELECALLER' where id = test.id('dsr_tm2');   -- outside a Sales team the existing dashboard trigger clears it
select test.check((select sales_sub_role is null from test.dsr_profile('dsr_tm2')), 'a direct write of a Sales role is never stored');
select test.must_fail($$update profiles set team_id = test.team('designstudio', 'Sales') where id = test.id('dsr_tm2')$$, 'a direct move into the Sales team is refused too', 'no Sales or Support roles');
select test.must_fail($$update profiles set team_id = test.team('designstudio', 'Support') where id = test.id('dsr_tl')$$, 'a direct team move is refused too', 'no Sales or Support roles');

\echo '   an existing row is not blocked from other changes'
-- a row saved before this rule (simulated by switching the trigger off for one insert) can still be suspended and restored
alter table profiles disable trigger profiles_designstudio_roles;
select test.create_auth_user('dsr_legacy', 'dsr.legacy@example.com', '{"full_name":"DSR Legacy"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('designstudio', 'Support')));
alter table profiles enable trigger profiles_designstudio_roles;
update profiles set status = 'SUSPENDED' where id = test.id('dsr_legacy');
update profiles set status = 'ACTIVE', full_name = 'DSR Legacy Renamed' where id = test.id('dsr_legacy');
select test.check((select status = 'ACTIVE' and full_name = 'DSR Legacy Renamed' from test.dsr_profile('dsr_legacy')), 'an existing person is suspended, restored and renamed (no data is changed by the rule)');
update profiles set team_id = test.team('designstudio', 'General') where id = test.id('dsr_legacy');
select test.check((select team_id = test.team('designstudio', 'General') from test.dsr_profile('dsr_legacy')), '... and can be moved to the General team');

\echo '   an HR employee request'
select test.must_fail($$select * from private.check_employee_submission(test.id('sa'), 'TEAM_MEMBER', false, test.dsr_dep('designstudio'), 'SALES')$$,
  'a request for the Sales side of Amuwa Design Studio is refused', 'no Sales or Support roles');
select test.must_fail($$select * from private.check_employee_submission(test.id('sa'), 'TEAM_HEAD', false, test.dsr_dep('designstudio'), 'support')$$,
  'a request for the Support side is refused (any letter case)', 'no Sales or Support roles');
select test.must_fail($$select * from private.check_employee_submission(test.id('sa'), 'TEAM_MEMBER', false, test.dsr_dep('designstudio'), 'GENERAL')$$,
  'a General request passes the department rule (and then only HR may submit)', 'only HR');
select test.must_fail($$select * from private.check_employee_submission(test.id('sa'), 'TEAM_MEMBER', false, test.dsr_dep('wabastore'), 'SALES')$$,
  'another department''s Sales request passes the department rule', 'only HR');

\echo '   nobody else can call the rule'
set role authenticated;
select test.login('dsr_tl');
select test.must_fail($$select * from private.check_employee_submission(test.id('sa'), 'TEAM_MEMBER', false, test.dsr_dep('designstudio'), 'GENERAL')$$,
  'a signed-in user cannot call the private submission check', 'permission denied');
select test.check(assert_can_create_user('TEAM_MEMBER', null, test.team('designstudio', 'General')), 'the Team Lead adds a Team Member to their own General team');
select test.must_fail($$select assert_can_create_user('TEAM_MEMBER', null, test.team('designstudio', 'Sales'))$$, '... but never one of the Sales team', 'no Sales or Support roles');
reset role;
select set_config('request.jwt.claims', '', false);

\echo '   Amuwa Design Studio is an active department again (migration 20270118000100); AI Design Studio keeps its own name'
reset role;
select test.check((select name from departments where slug = 'designstudio') = 'Amuwa Design Studio'
                  and (select name from departments where slug = 'ai-design-studio') = 'AI Design Studio'
                  and (select count(*) = 1 from departments where lower(name) = 'amuwa design studio')
                  and (select count(*) = 1 from departments where lower(name) = 'ai design studio')
                  and not exists (select 1 from departments where name ilike '%retired%'),
  'Amuwa Design Studio (slug designstudio) and AI Design Studio (slug ai-design-studio) are two separate departments, neither labelled Retired');
select test.check(not (select is_locked from departments where slug = 'designstudio') and exists (select 1 from profiles where email = 'dsr.tl@example.com' and status = 'ACTIVE'),
  'Amuwa Design Studio is not locked and its people are untouched');
select test.check((select count(*) = 1 and bool_and(division = 'GENERAL') from teams where department_id = test.dsr_dep('ai-design-studio')), 'AI Design Studio has its one General team and nothing Sales or Support');
select test.check(exists (select 1 from teams where department_id = test.dsr_dep('designstudio') and division = 'GENERAL'), 'Amuwa Design Studio has a General team for new people');
set role authenticated;
select test.login('sa');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dsr_dep('ai-design-studio'), null, 'SALES')$$, 'Amuwa Design Studio: a Sales Department Head is refused', 'no Sales or Support Department Head');
select test.must_fail($$select assert_can_create_user('DEPARTMENT_HEAD', test.dsr_dep('ai-design-studio'), null, 'SUPPORT')$$, '... and a Support one', 'no Sales or Support Department Head');
select test.check(assert_can_create_user('TEAM_MEMBER', null, test.team('ai-design-studio', 'General')) and assert_can_create_user('TEAM_HEAD', null, test.team('ai-design-studio', 'General')),
  'Amuwa Design Studio: a Team Lead and a Team Member of its General team may be created');
reset role;
-- a Sales team added to Amuwa Design Studio by hand still could not hold anybody
insert into teams (department_id, name, division) select test.dsr_dep('ai-design-studio'), 'DSR Sales', 'SALES' where not exists (select 1 from teams where department_id = test.dsr_dep('ai-design-studio') and name = 'DSR Sales');
select test.must_fail($$select test.create_auth_user('dsr_ads_sales', 'dsr.ads.sales@example.com', '{"full_name":"DSR ADS Sales"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('ai-design-studio', 'DSR Sales')))$$,
  'Amuwa Design Studio: nobody is ever placed in a Sales team, even one added by hand', 'no Sales or Support roles');
delete from teams where department_id = test.dsr_dep('ai-design-studio') and name = 'DSR Sales';
select test.must_fail($$select * from private.check_employee_submission(test.id('sa'), 'TEAM_MEMBER', false, test.dsr_dep('ai-design-studio'), 'SUPPORT')$$,
  'Amuwa Design Studio: an HR request for the Support side is refused', 'no Sales or Support roles');

\echo '   Access Control: no Sales / Support function, and the grants already given are withdrawn'
insert into departments (slug, name) values ('dsr-other', 'DSR Other Dept') on conflict do nothing;
select test.create_auth_user('dsr_ops', 'dsr.ops@example.com', '{"full_name":"DSR Ops"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dsr_dep('dsr-other')));
-- a grant saved before this migration (the rule did not exist then)
alter table department_access disable trigger department_access_operations_head;
insert into department_access (profile_id, department_id, division) values (test.id('dsr_ops'), test.dsr_dep('designstudio'), 'SALES') on conflict do nothing;
alter table department_access enable trigger department_access_operations_head;
\i supabase/migrations/20270112000200_amuwa_design_studio_rename.sql
-- the rename migration labels the old department "(Retired)" again; the restore migration undoes that, and running it twice changes nothing more
\i supabase/migrations/20270118000100_amuwa_design_studio_restore.sql
\i supabase/migrations/20270118000100_amuwa_design_studio_restore.sql
select test.check((select name from departments where slug = 'designstudio') = 'Amuwa Design Studio' and (select name from departments where slug = 'ai-design-studio') = 'AI Design Studio',
  'the restore migration gives each department its name back, and is safe to run twice');
select test.check(not exists (select 1 from department_access where profile_id = test.id('dsr_ops')), 'the migration withdraws an existing Sales grant for Amuwa Design Studio');
select test.check((select count(*) = 1 from audit_logs where action = 'DEPARTMENT_ACCESS_REVOKED' and entity_id = test.id('dsr_ops') and department_id = test.dsr_dep('designstudio')), '... and audits it');
select test.check((select count(*) = 1 from profiles where email = 'dsr.ops@example.com'), '... without touching the person');
select test.check(private.department_access_problem(test.dsr_dep('designstudio'), 'SALES') ~ 'no Sales or Support function'
                  and private.department_access_problem(test.dsr_dep('ai-design-studio'), 'SUPPORT') ~ 'no Sales or Support function'
                  and private.department_access_problem(test.dsr_dep('wabastore'), 'SUPPORT') is null,
  'no new Sales / Support grant for either department; other departments unchanged');
select set_config('request.jwt.claims', '', false);
