-- =============================================================================
-- HR Assistants in the existing HR Recruiter workspace (migration 20261231000300): the same per-record limits as an HR Recruiter, no leadership
-- powers, the HR dashboard kept. Reuses hr_head (HR leadership), rr_rec1 / rr_rec2 (HR Recruiters), rr_asst (an HR member WITHOUT a designation),
-- tm_a and the career applications of the recruitment suites.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133. HR Assistant: the Recruitment Portal with the Recruiter''s limits'
reset role;
\i supabase/migrations/20261231000300_hr_assistant_recruitment.sql
\i supabase/migrations/20261231000300_hr_assistant_recruitment.sql

delete from auth.users where email = 'ha.asst@example.com';
delete from test.users where name = 'ha_asst';
select set_config('request.jwt.claims', '{"role":"service_role"}', false);
select test.create_auth_user('ha_asst', 'ha.asst@example.com', '{"full_name":"HA Assistant"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RR HR Team')));
reset role;
select set_config('request.jwt.claims', '', false);
update profiles set status = 'ACTIVE' where id = test.id('ha_asst');
set role authenticated;
select test.login('hr_head');
select set_hr_sub_role(test.id('ha_asst'), 'HR_ASSISTANT');
reset role;
select test.check((select hr_sub_role = 'HR_ASSISTANT' and coalesce(default_dashboard::text, '') <> 'hr-recruiter' from profiles where id = test.id('ha_asst')),
  'fixture: an HR Assistant (designation kept, HR dashboard kept)');

-- two vacancies that have applications: one goes to the HR Assistant, one to a Recruiter
create temp table ha (k text primary key, id uuid);
grant all on ha to authenticated;
insert into ha select 'mine', posting_id from (select distinct posting_id from career_applications order by posting_id limit 1) x;
insert into ha select 'theirs', posting_id from (select distinct posting_id from career_applications where posting_id <> (select id from ha where k = 'mine') order by posting_id limit 1) x;
insert into ha select 'app_mine', (select id from career_applications where posting_id = (select id from ha where k = 'mine') limit 1);
insert into ha select 'app_theirs', (select id from career_applications where posting_id = (select id from ha where k = 'theirs') limit 1);
select test.check((select count(*) = 4 from ha where id is not null), 'fixture: two vacancies with applications');

\echo '   leadership allocates; the Assistant works only on what is theirs'
set role authenticated;
select test.login('ha_asst');
select test.must_fail($$select recruiter_vacancy_assign((select id from ha where k = 'mine'), test.id('ha_asst'))$$, 'an HR Assistant cannot allocate vacancies (leadership only)', 'FORBIDDEN');
select test.login('hr_head');
select recruiter_vacancy_assign((select id from ha where k = 'mine'), test.id('ha_asst'));
select recruiter_vacancy_assign((select id from ha where k = 'theirs'), test.id('rr_rec1'));
select test.check((select count(*) = 1 from jsonb_array_elements(recruiter_directory()) x where (x ->> 'id')::uuid = test.id('ha_asst')), 'the HR Assistant is offered to leadership as a person a vacancy can be given to');
select test.login('ha_asst');
select test.check((select (recruiter_context() ->> 'isAssistant')::boolean and not (recruiter_context() ->> 'isRecruiter')::boolean and not (recruiter_context() ->> 'isLeadership')::boolean
                     and recruiter_context() ->> 'designation' = 'HR Assistant'),
  'the HR Assistant opens the Recruitment Portal as an HR Assistant (not a Recruiter, not leadership)');
select test.check(private.recruiter_can_access((select id from ha where k = 'app_mine')), 'and works on the applications of the vacancy given to them');
select test.check(not private.recruiter_can_access((select id from ha where k = 'app_theirs')), 'not on another Recruiter''s applications');
select test.check((select count(*) = 0 from jsonb_array_elements(recruiter_vacancies()) x where (x ->> 'id')::uuid = (select id from ha where k = 'theirs')), 'nor sees another Recruiter''s vacancy');
select test.must_fail($$select recruiter_vacancy((select id from ha where k = 'theirs'))$$, 'nor opens it', 'NOT_FOUND|FORBIDDEN');
select test.must_fail($$select recruiter_directory()$$, 'leadership lists stay closed', 'FORBIDDEN');
select test.check(private.is_hr_staff(), 'and keeps the HR dashboard pages (still HR staff)');
-- a vacancy the Assistant creates is theirs, whoever they try to name
select test.check((select (recruiter_vacancy_save(jsonb_build_object('title', 'HA Field Sales Executive', 'departmentId', test.dept('wabastore'), 'openings', 2,
                     'description', 'Meet shop owners and explain our WhatsApp products to them.', 'employmentType', 'FULL_TIME', 'location', 'Pune',
                     'status', 'DRAFT', 'responsibleId', test.id('rr_rec1'))) ->> 'responsibleId')::uuid = test.id('ha_asst')),
  'a vacancy the HR Assistant creates is their own (they cannot hand it to someone else)');

\echo '   nobody else gained anything'
select test.login('rr_asst');
select test.must_fail($$select recruiter_context()$$, 'an HR member without the HR Assistant designation gets no recruitment access', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select recruiter_context()$$, 'nor an ordinary employee', 'FORBIDDEN');
select test.login('rr_rec1');
select test.check((select (recruiter_context() ->> 'isRecruiter')::boolean) and private.recruiter_can_access((select id from ha where k = 'app_theirs'))
                  and not private.recruiter_can_access((select id from ha where k = 'app_mine')), 'the Recruiter''s access is unchanged (their own vacancy only)');
select test.check(not private.is_hr_staff(), 'and the Recruiter still does not get the HR staff pages');
reset role;
delete from career_postings where title = 'HA Field Sales Executive';
