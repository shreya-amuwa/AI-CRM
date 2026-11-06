-- =============================================================================
-- HR Recruiter vacancy management (migration 20261226000300): a Recruiter creates, edits, publishes, holds, closes, marks filled and reopens their
-- own vacancies; the department list of the filters is the real department list; the vacancy list filters by department in the database.
-- Uses the people of recruiter_workflow_test.sql (rr_rec1, rr_rec2, rr_asst) and the shared fixture (sa, hr_head). Vacancies are prefixed 'RVM'.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 94. HR Recruiter: create / edit / publish vacancies, department filter'
reset role;
\i supabase/migrations/20261226000300_recruiter_vacancy_management.sql
\i supabase/migrations/20261226000300_recruiter_vacancy_management.sql

create temp table rvm (k text primary key, v jsonb);
grant all on rvm to authenticated;
create or replace function test.rvm_body(p_title text, p_dept text, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'departmentId', test.dept(p_dept), 'openings', 2, 'description', 'A role that needs a careful and patient person.',
    'employmentType', 'FULL_TIME', 'location', 'Pune office', 'skills', 'Communication', 'qualifications', 'Graduate', 'experience', '1-3 years',
    'responsibilities', 'Call leads', 'workMode', 'HYBRID', 'closesAt', (now() + interval '20 days')::text) || p_extra
$$;
grant execute on all functions in schema test to anon, authenticated, service_role;

set role authenticated;
\echo '   the department filter lists the real departments, even before any vacancy exists'
select test.login('rr_rec2');
select test.check((select jsonb_array_length(recruiter_filter_options() -> 'departments') = (select count(*) from departments where facet_of is null)),
  'a Recruiter''s Department filter lists every department of the company');
select test.check(exists (select 1 from jsonb_array_elements(recruiter_filter_options() -> 'departments') d where d ->> 'name' = (select name from departments where slug = 'accounts')),
  'including departments that have no vacancy');
select test.check(not exists (select 1 from jsonb_array_elements(recruiter_filter_options() -> 'departments') d join departments x on x.id = (d ->> 'id')::uuid where x.facet_of is not null),
  'and not the Sales / Support "side" records of another department');

\echo '   a Recruiter creates and publishes a vacancy'
select test.login('rr_rec1');
insert into rvm select 'a', recruiter_vacancy_save(test.rvm_body('RVM Sales Executive', 'wabastore'));
reset role;
select test.check((select vacancy_status = 'OPEN' and published and responsible_id = test.id('rr_rec1') and openings = 2 and work_mode = 'HYBRID'
                          and responsibilities = 'Call leads' and closes_at > now() and code is not null
                     from career_postings where id = ((select v from rvm where k = 'a') ->> 'id')::uuid),
  'published at once, open to the careers portal, the creator is responsible, every field saved, a job code given');
select test.check((select p.department_id = test.dept('wabastore') and p.title = 'RVM Sales Executive' and p.is_open
                     from career_postings j join hr_positions p on p.id = j.position_id where j.id = ((select v from rvm where k = 'a') ->> 'id')::uuid),
  'the designation is an HR position of the chosen department');
select test.check(exists (select 1 from notifications where type = 'RECRUITER_VACANCY_CREATED' and recipient_id = test.id('hr_head')), 'HR leadership is told');
select test.check(exists (select 1 from audit_logs where action = 'RECRUITER_VACANCY_CREATED'), 'the creation is audited');

set role authenticated;
select test.login('rr_rec1');
insert into rvm select 'd', recruiter_vacancy_save(test.rvm_body('RVM Accountant', 'accounts', '{"status": "DRAFT", "openings": 1}'));
select test.check((select v ->> 'status' = 'DRAFT' from rvm where k = 'd'), 'a vacancy can be saved as a draft');
-- the same designation in the same department re-uses its HR position
insert into rvm select 'a2', recruiter_vacancy_save(test.rvm_body('rvm sales executive', 'wabastore', '{"status": "DRAFT"}'));
reset role;
select test.check((select count(*) = 1 from hr_positions where lower(title) = 'rvm sales executive' and department_id = test.dept('wabastore')), 'one HR position per designation and department');
set role authenticated;
select test.login('rr_rec1');

\echo '   validation (the database checks every field)'
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('X', 'wabastore'))$$, 'a one-letter title is refused', 'job title');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore') || jsonb_build_object('departmentId', gen_random_uuid()))$$, 'an unknown department is refused', 'Choose the department');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"openings": 0}'))$$, 'zero openings are refused', 'between 1 and 500');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"openings": "2.5"}'))$$, 'a fraction of an opening is refused', 'between 1 and 500');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"description": "too short"}'))$$, 'a short description is refused', '20 characters');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"employmentType": "FREELANCE"}'))$$, 'an unknown employment type is refused', 'employment type');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"location": ""}'))$$, 'the location is required', 'location');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"workMode": "MOON"}'))$$, 'an unknown work mode is refused', 'remote, hybrid');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore') || jsonb_build_object('closesAt', (now() - interval '1 day')::text))$$, 'a deadline in the past is refused', 'future');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"closesAt": "not a date"}'))$$, 'an invalid deadline is refused', 'valid application deadline');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Bad', 'wabastore', '{"status": "FILLED"}'))$$, 'a new vacancy is a draft or published only', 'draft or published');
select test.must_fail($$select recruiter_vacancy_save(null)$$, 'an empty request is refused', 'VALIDATION_ERROR');

\echo '   editing: own vacancies only, with the current version'
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Sales Executive', 'wabastore') || jsonb_build_object('id', (select v ->> 'id' from rvm where k = 'a')))$$,
  'an edit without the version is refused', 'Reload');
select recruiter_vacancy_save(test.rvm_body('RVM Senior Sales Executive', 'wabastore', '{"openings": 3}')
  || jsonb_build_object('id', (select v ->> 'id' from rvm where k = 'a'), 'version', (recruiter_vacancy(((select v from rvm where k = 'a') ->> 'id')::uuid) ->> 'version')::int));
select test.check((select x ->> 'title' = 'RVM Senior Sales Executive' and (x ->> 'openings')::int = 3 and x ->> 'version' is not null
                     from (select recruiter_vacancy(((select v from rvm where k = 'a') ->> 'id')::uuid) x) q), 'the Recruiter edits their vacancy; the detail returns the new values and its version');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Senior Sales Executive', 'wabastore') || jsonb_build_object('id', (select v ->> 'id' from rvm where k = 'a'), 'version', 1))$$,
  'an edit made on an old copy is refused', 'CONFLICT');
select test.login('rr_rec2');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Taken', 'wabastore') || jsonb_build_object('id', (select v ->> 'id' from rvm where k = 'a'), 'version', 99))$$,
  'another Recruiter cannot edit it', 'NOT_FOUND');
select test.check((select count(*) = 0 from jsonb_array_elements(recruiter_vacancies()) x where x ->> 'title' ilike 'RVM %'), 'nor sees it in their list');
select test.login('rr_asst');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Assistant', 'wabastore'))$$, 'an HR Assistant is not a Recruiter here', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select recruiter_vacancy_save(test.rvm_body('RVM Outsider', 'wabastore'))$$, 'an ordinary employee cannot create vacancies', 'FORBIDDEN');

\echo '   status: the Recruiter publishes, holds, closes, marks filled and reopens their own vacancy'
select test.login('rr_rec1');
select recruiter_vacancy_status(((select v from rvm where k = 'd') ->> 'id')::uuid, 'OPEN');
select test.check(recruiter_vacancy(((select v from rvm where k = 'd') ->> 'id')::uuid) ->> 'status' = 'OPEN', 'a draft is published by its Recruiter');
select recruiter_vacancy_status(((select v from rvm where k = 'a') ->> 'id')::uuid, 'ON_HOLD', 'Budget review');
select recruiter_vacancy_status(((select v from rvm where k = 'a') ->> 'id')::uuid, 'CLOSED');
reset role;
select test.check((select vacancy_status = 'CLOSED' and not published from career_postings where id = ((select v from rvm where k = 'a') ->> 'id')::uuid), 'closed: no longer on the careers portal');
set role authenticated;
select test.login('rr_rec1');
select recruiter_vacancy_status(((select v from rvm where k = 'a') ->> 'id')::uuid, 'OPEN');
select test.check(recruiter_vacancy(((select v from rvm where k = 'a') ->> 'id')::uuid) ->> 'status' = 'OPEN', 'reopened by the Recruiter');
select recruiter_vacancy_status(((select v from rvm where k = 'a') ->> 'id')::uuid, 'FILLED');
select test.check(recruiter_vacancy(((select v from rvm where k = 'a') ->> 'id')::uuid) ->> 'status' = 'FILLED', 'marked filled');
select test.must_fail($$select recruiter_vacancy_status(((select v from rvm where k = 'a') ->> 'id')::uuid, 'DRAFT')$$, 'never back to a draft', 'FORBIDDEN');
reset role;
select test.check(exists (select 1 from notifications where type = 'RECRUITER_VACANCY_PUBLISHED' and recipient_id = test.id('hr_head')), 'HR leadership is told when a Recruiter publishes or reopens');
select test.check((select count(*) >= 5 from audit_logs where action = 'RECRUITER_VACANCY_STATUS' and entity_id in (select (v ->> 'id')::uuid from rvm)), 'every status change is audited');

\echo '   the list filters by department in the database'
set role authenticated;
select test.login('rr_rec1');
select test.check((select count(*) = 2 from jsonb_array_elements(recruiter_vacancies(null, test.dept('wabastore'))) x where x ->> 'title' ilike 'RVM %'), 'Wabastore: the two Wabastore vacancies');
select test.check((select count(*) = 1 from jsonb_array_elements(recruiter_vacancies(null, test.dept('accounts'))) x where x ->> 'title' ilike 'RVM %'), 'Accounts: the Accounts vacancy only');
select test.check((select count(*) = 0 from jsonb_array_elements(recruiter_vacancies(null, test.dept('hr'))) x where x ->> 'title' ilike 'RVM %'), 'HR: none (a genuinely empty result)');
select test.check((select count(*) = 3 from jsonb_array_elements(recruiter_vacancies()) x where x ->> 'title' ilike 'RVM %'), 'All departments: all three');
select test.check((select count(*) = 1 from jsonb_array_elements(recruiter_vacancies('OPEN', test.dept('accounts'))) x where x ->> 'title' ilike 'RVM %'), 'status and department together');

\echo '   HR leadership sees and manages the Recruiter''s vacancies'
select test.login('hr_head');
select test.check((select count(*) = 3 from jsonb_array_elements(recruiter_vacancies()) x where x ->> 'title' ilike 'RVM %'), 'the HR Department Head sees them all');
select recruiter_vacancy_status(((select v from rvm where k = 'a') ->> 'id')::uuid, 'DRAFT');
select test.check(recruiter_vacancy(((select v from rvm where k = 'a') ->> 'id')::uuid) ->> 'status' = 'DRAFT', 'and keeps every status change');
insert into rvm select 'l', recruiter_vacancy_save(test.rvm_body('RVM Queue Role', 'hr', '{"status": "DRAFT"}'));
reset role;
select test.check((select responsible_id is null from career_postings where id = ((select v from rvm where k = 'l') ->> 'id')::uuid), 'a vacancy leadership creates without naming a Recruiter waits in the queue');
\echo '   ok: HR Recruiter vacancy management'
