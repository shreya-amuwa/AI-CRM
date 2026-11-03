-- =============================================================================
-- HR department designations: exactly HR Assistant, HR Recruiter and HR Admin Head (the Department Head of HR) for new HR employees. A generic designation, a
-- designation that does not fit the role, and an HR designation in another department are refused by the database (and by assert_designation_allowed, which the
-- server calls before any account exists). Existing records are untouched; HR Admin Head gets no Super Admin or Operations Head permission.
-- Migration 20261222000500. Own synthetic people (prefix hd).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 94. HR designations: HR Assistant, HR Recruiter, HR Admin Head'
reset role;
\i supabase/migrations/20261222000500_hr_department_designations.sql

insert into teams (department_id, name, division) select d.id, 'HD HR Team', 'GENERAL' from departments d where d.slug = 'hr' and not exists (select 1 from teams t where t.department_id = d.id and t.name = 'HD HR Team');
create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.hdmk(p_name text, p_dept text, p_team text, p_role text default 'TEAM_MEMBER') returns uuid language sql as $$
  select test.create_auth_user(p_name, 'hd.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'HD ' || substr(p_name, 4)),
    jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role, 'provisioned_department_id', test.dept(p_dept), 'provisioned_team_id', test.team(p_dept, p_team)))
$$;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   the rule itself (one function, used by the trigger and by the server pre-check)'
select test.check(private.designation_problem('hr', 'TEAM_MEMBER', 'HR Assistant', false) is null, 'HR Team Member can be an HR Assistant');
select test.check(private.designation_problem('hr', 'TEAM_MEMBER', 'HR Recruiter', false) is null, 'HR Team Member can be an HR Recruiter');
select test.check(private.designation_problem('hr', 'DEPARTMENT_HEAD', 'HR Admin Head', false) is null, 'the HR Department Head is the HR Admin Head');
select test.check(private.designation_problem('hr', 'TEAM_MEMBER', 'Team Member', false) is not null, 'a generic Team Member designation is refused in HR');
select test.check(private.designation_problem('hr', 'TEAM_HEAD', 'Team Lead', false) is not null, 'a Team Lead designation is refused in HR');
select test.check(private.designation_problem('hr', 'DEPARTMENT_HEAD', 'Department Head', false) is not null, 'a generic Department Head designation is refused in HR');
select test.check(private.designation_problem('hr', 'TEAM_MEMBER', 'Operations Head', false) is not null, 'an Operations Head designation is refused for an HR employee');
select test.check(private.designation_problem('hr', 'TEAM_HEAD', 'HR Assistant', false) is not null, 'HR Assistant is not a Team Lead designation');
select test.check(private.designation_problem('hr', 'TEAM_MEMBER', 'HR Admin Head', false) is not null, 'HR Admin Head is not a Team Member designation');
select test.check(private.designation_problem('hr', 'DEPARTMENT_HEAD', 'HR Recruiter', false) is not null, 'HR Recruiter is not a Department Head designation');
select test.check(private.designation_problem('hr', 'DEPARTMENT_HEAD', 'HR Admin Head', true) is not null, 'an Operations Head is not an HR Admin Head');
select test.check(private.designation_problem('wabastore', 'TEAM_MEMBER', 'HR Recruiter', false) is not null and private.designation_problem('wabastore', 'DEPARTMENT_HEAD', 'HR Admin Head', false) is not null, 'the HR designations exist in no other department');
select test.check(private.designation_problem('wabastore', 'TEAM_MEMBER', 'Team Member', false) is null and private.designation_problem('wabastore', 'TEAM_HEAD', 'Team Lead', false) is null and private.designation_problem('wabastore', 'DEPARTMENT_HEAD', 'Department Head', false) is null, 'other departments keep their existing designations');
select test.check(private.designation_problem('hr', 'DEPARTMENT_HEAD', 'Operations Head', true) is null, 'an Operations Head homed in HR keeps its own company-wide designation');

\echo '   the server pre-check, called as the Super Admin before any account exists'
set role authenticated;
select test.login('sa');
select assert_designation_allowed(test.dept('hr'), null, 'TEAM_MEMBER', 'HR Assistant');
select assert_designation_allowed(null, test.team('hr', 'HD HR Team'), 'TEAM_MEMBER', 'HR Recruiter');
select assert_designation_allowed(test.dept('hr'), null, 'DEPARTMENT_HEAD', 'HR Admin Head');
select test.must_fail($$select assert_designation_allowed(test.dept('hr'), null, 'TEAM_MEMBER', 'Team Member')$$, 'the pre-check refuses a generic designation in HR', 'Choose HR Assistant');
select test.must_fail($$select assert_designation_allowed(test.dept('hr'), null, 'TEAM_MEMBER', null)$$, 'the pre-check refuses an HR employee with no designation', 'Choose HR Assistant');
select test.must_fail($$select assert_designation_allowed(null, test.team('hr', 'HD HR Team'), 'TEAM_HEAD', 'Team Lead')$$, 'the pre-check refuses a Team Lead in HR (by team)', 'Choose HR Assistant');
select test.must_fail($$select assert_designation_allowed(test.dept('wabastore'), null, 'TEAM_MEMBER', 'HR Recruiter')$$, 'the pre-check refuses an HR designation in another department', 'HR department only');
select assert_designation_allowed(test.dept('wabastore'), null, 'TEAM_MEMBER', 'Team Member');
select assert_designation_allowed(test.dept('wabastore'), null, 'TEAM_MEMBER', null);
reset role;

\echo '   the database refuses it whichever way the designation is saved'
select test.service(); select test.hdmk('hd_a', 'hr', 'HD HR Team');
select test.service(); select test.hdmk('hd_b', 'hr', 'HD HR Team');
select test.service(); select test.hdmk('hd_c', 'hr', 'HD HR Team');
select test.service(); select test.hdmk('hd_w', 'wabastore', 'Sales');
select test.must_fail($$insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_a'), 'Team Member', date '2026-01-05', date '1995-02-02')$$, 'a new HR employee cannot get the generic Team Member designation', 'Choose HR Assistant');
select test.must_fail($$insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_a'), 'Team Lead', date '2026-01-05', date '1995-02-02')$$, 'nor Team Lead', 'Choose HR Assistant');
select test.must_fail($$insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_a'), 'HR Admin Head', date '2026-01-05', date '1995-02-02')$$, 'a Team Member cannot be the HR Admin Head', 'Department Head of the HR');
select test.must_fail($$insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_w'), 'HR Recruiter', date '2026-01-05', date '1995-02-02')$$, 'an HR designation is refused in another department', 'HR department only');
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_a'), 'HR Assistant', date '2026-01-05', date '1995-02-02');
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_b'), 'HR Recruiter', date '2026-01-05', date '1995-02-02');
select test.check((select hr_sub_role = 'HR_ASSISTANT' and coalesce(default_dashboard::text, '') <> 'hr-recruiter' from profiles where id = test.id('hd_a')), 'HR Assistant: the existing HR dashboard, no recruiter sub-role');
select test.check((select hr_sub_role = 'HR_RECRUITER' and default_dashboard::text = 'hr-recruiter' from profiles where id = test.id('hd_b')), 'HR Recruiter: the recruiter dashboard');
-- HR Admin Head = the existing Department Head of HR (rls_test made hr_head)
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hr_head'), 'HR Admin Head', date '2026-01-05', date '1980-02-02')
  on conflict (profile_id) do update set designation = 'HR Admin Head';
select test.check((select role::text = 'DEPARTMENT_HEAD' and hr_sub_role is null and default_dashboard::text = 'hr-head' and not is_operations_head from profiles where id = test.id('hr_head')), 'HR Admin Head: the existing HR Department Head dashboard, no sub-role, not an Operations Head');

\echo '   changing the role or department of a designated person'
select test.must_fail($$update profiles set role = 'TEAM_HEAD' where id = test.id('hd_b')$$, 'an HR Recruiter cannot be turned into a Team Lead', 'Team Member of the HR');
select test.must_fail($$update profiles set department_id = test.dept('wabastore'), team_id = test.team('wabastore', 'Sales') where id = test.id('hd_b')$$, 'an HR Recruiter cannot be moved out of HR still carrying the HR designation', 'HR department only');
update profiles set full_name = 'HD B Renamed' where id = test.id('hd_b');
select test.check(true, 'unrelated profile changes are not blocked');

\echo '   existing records are not changed or blocked'
alter table employee_personal_details disable trigger employee_designation_hr_sub_role;
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('hd_c'), 'Team Member', date '2026-01-05', date '1995-02-02');
alter table employee_personal_details enable trigger employee_designation_hr_sub_role;
update employee_personal_details set contact_number = '+919876500001' where profile_id = test.id('hd_c');
update employee_personal_details set designation = 'Team Member' where profile_id = test.id('hd_c');
select test.check((select designation = 'Team Member' from employee_personal_details where profile_id = test.id('hd_c')), 'an older HR record keeps its designation and can still be saved');
select test.must_fail($$update employee_personal_details set designation = 'Team Lead' where profile_id = test.id('hd_c')$$, 'but it cannot be changed to another generic designation', 'Choose HR Assistant');
update employee_personal_details set designation = 'HR Assistant' where profile_id = test.id('hd_c');
select test.check((select hr_sub_role = 'HR_ASSISTANT' from profiles where id = test.id('hd_c')), 'and it can be moved to an HR designation');

\echo '   permissions: HR Admin Head is not a Super Admin or an Operations Head; Assistant and Recruiter are not leadership'
set role authenticated;
select test.login('hr_head');
select test.check(private.is_hr_leadership() and not private.is_super_admin(), 'HR Admin Head has HR leadership and no Super Admin permission');
select test.must_fail($$select set_operations_head(test.id('hd_a'), true, 'x')$$, 'HR Admin Head cannot make an Operations Head', 'FORBIDDEN|permission|Only');
select test.must_fail($$select recruitment_email_admin_list()$$, 'HR Admin Head cannot use Super Admin technical functions', 'FORBIDDEN');
select test.login('hd_a');
select test.check(not private.is_hr_leadership() and private.is_hr_staff() and not private.is_hr_recruiter(), 'HR Assistant: HR staff, no leadership, no recruiter access');
select test.must_fail($$select set_hr_sub_role(test.id('hd_c'), 'HR_RECRUITER')$$, 'HR Assistant cannot change designations', 'FORBIDDEN');
select test.login('hd_b');
select test.check(not private.is_hr_leadership() and not private.is_hr_staff() and private.is_hr_recruiter(), 'HR Recruiter: recruiter access only, no HR staff, no leadership');
select test.must_fail($$select recruiter_vacancy_assign(gen_random_uuid(), null)$$, 'HR Recruiter cannot allocate vacancies', 'FORBIDDEN');
select test.login('hr_head');
select set_hr_sub_role(test.id('hd_c'), 'HR_RECRUITER');
select test.must_fail($$select set_hr_sub_role(test.id('hr_head'), 'HR_ASSISTANT')$$, 'the HR Admin Head cannot be turned into an HR Assistant', 'Team Members');
reset role;
\echo '   ok: HR designations'
