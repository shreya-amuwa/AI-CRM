-- =============================================================================
-- HR Recruiter dashboard: the role (HR Assistant vs HR Recruiter), vacancy allocation, the applications a Recruiter may see, the pipeline stage worked out
-- from calls / tests / interviews, the final decision (once, never both, independent per vacancy, corrected only by HR leadership) and the backend e-mail
-- outbox (one row per decision, created with it, never visible to the browser's roles). Migrations 20261222000100 .. 20261222000300.
-- Own synthetic people (prefix rr) and candidates.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 93. HR Recruiter: role, vacancies, applications, pipeline, calls, interviews, decisions, e-mail outbox'
reset role;
\i supabase/migrations/20261222000100_hr_recruiter_role.sql
\i supabase/migrations/20261222000200_recruitment_decision_email.sql
\i supabase/migrations/20261222000300_recruiter_workspace.sql
-- the vacancy rules and list of 20261226000300 replace the ones above (re-applied so the suite tests what is deployed)
\i supabase/migrations/20261226000300_recruiter_vacancy_management.sql

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
grant usage on schema test to service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into teams (department_id, name, division) select d.id, 'RR HR Team', 'GENERAL' from departments d where d.slug = 'hr' and not exists (select 1 from teams t where t.department_id = d.id and t.name = 'RR HR Team');
select test.create_auth_user('rr_asst', 'rr.asst@example.com', '{"full_name":"RR Assistant"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RR HR Team')));
select test.create_auth_user('rr_rec1', 'rr.rec1@example.com', '{"full_name":"RR Recruiter One"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RR HR Team')));
select test.create_auth_user('rr_rec2', 'rr.rec2@example.com', '{"full_name":"RR Recruiter Two"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RR HR Team')));
update profiles set status = 'ACTIVE' where id in (test.id('rr_asst'), test.id('rr_rec1'), test.id('rr_rec2'));

-- ---------------------------------------------------------------------------
\echo '   the role: HR Assistant and HR Recruiter are two designations of the one HR department'
-- ---------------------------------------------------------------------------
select test.check((select hr_sub_role is null from profiles where id = test.id('rr_asst')), 'a new HR member is an HR Assistant by default (no sub-role)');
set role authenticated;
select test.login('rr_asst');
select test.must_fail($$select set_hr_sub_role(test.id('rr_rec1'), 'HR_RECRUITER')$$, 'an HR Assistant cannot make anyone a Recruiter', 'FORBIDDEN');
select test.login('hr_head');
select set_hr_sub_role(test.id('rr_rec1'), 'HR_RECRUITER');
select set_hr_sub_role(test.id('rr_rec2'), 'HR_RECRUITER');
select test.must_fail($$select set_hr_sub_role(test.id('rr_asst'), 'NONSENSE')$$, 'an unknown HR designation is refused', 'VALIDATION_ERROR');
reset role;
select test.check((select default_dashboard::text = 'hr-recruiter' from profiles where id = test.id('rr_rec1')), 'a Recruiter lands on the recruiter dashboard');
select test.check((select coalesce(default_dashboard::text, '') <> 'hr-recruiter' from profiles where id = test.id('rr_asst')), 'an HR Assistant keeps the HR dashboard');
select test.check(exists (select 1 from audit_logs where action = 'HR_SUB_ROLE_SET'), 'the designation change is audited');

-- the designation chosen when an employee is created sets the sub-role (no extra step)
select test.create_auth_user('rr_new', 'rr.new@example.com', '{"full_name":"RR New Recruiter"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RR HR Team')));
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('rr_new'), 'HR Recruiter', date '2026-01-05', date '1995-02-02');
select test.check((select hr_sub_role = 'HR_RECRUITER' and default_dashboard::text = 'hr-recruiter' from profiles where id = test.id('rr_new')), 'choosing HR Recruiter when creating an employee makes them a Recruiter');
select test.create_auth_user('rr_new2', 'rr.new2@example.com', '{"full_name":"RR New Assistant"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_department_id', test.dept('hr'), 'provisioned_team_id', test.team('hr', 'RR HR Team')));
insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('rr_new2'), 'HR Assistant', date '2026-01-05', date '1995-02-02');
select test.check((select hr_sub_role = 'HR_ASSISTANT' and coalesce(default_dashboard::text, '') <> 'hr-recruiter' from profiles where id = test.id('rr_new2')), 'choosing HR Assistant keeps the HR dashboard');
select test.create_auth_user('rr_nonhr', 'rr.nonhr@example.com', '{"full_name":"RR Non HR"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.must_fail($$insert into employee_personal_details (profile_id, designation, joining_date, date_of_birth) values (test.id('rr_nonhr'), 'HR Recruiter', date '2026-01-05', date '1995-02-02')$$, 'the HR designations belong to the HR department only', 'HR department');

set role authenticated;
select test.login('rr_rec1');
select test.check(private.is_hr_recruiter() and not private.is_hr_staff(), 'a Recruiter is not an HR Assistant: HR staff screens stay closed to them');
select test.must_fail($$select hr_career_posting()$$, 'a Recruiter cannot use the HR Assistant recruitment management', 'FORBIDDEN');
select test.login('rr_asst');
select test.check(private.is_hr_staff() and not private.is_hr_recruiter(), 'an HR Assistant keeps HR staff access');
select test.must_fail($$select recruiter_context()$$, 'an HR Assistant cannot open the recruiter workspace', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select recruiter_context()$$, 'another department cannot open the recruiter workspace', 'FORBIDDEN');
select test.login('rr_rec1');
select test.check(recruiter_context()->>'isRecruiter' = 'true', 'a Recruiter opens the workspace');

-- ---------------------------------------------------------------------------
\echo '   vacancies: allocation and status'
-- ---------------------------------------------------------------------------
reset role;
insert into hr_positions (title, department_id) values ('RR Backend Engineer', test.dept('hr')) on conflict do nothing;
set role authenticated;
select test.login('hr_head');
select hr_career_posting(jsonb_build_object('position_id', (select id from hr_positions where title = 'RR Backend Engineer'), 'title', 'RR Backend A', 'description', 'Build reliable services with our engineering team.',
  'location', 'Mumbai', 'employment_type', 'FULL_TIME', 'published', true, 'openings', 1, 'responsible_id', test.id('rr_rec1')));
select hr_career_posting(jsonb_build_object('position_id', (select id from hr_positions where title = 'RR Backend Engineer'), 'title', 'RR Backend B', 'description', 'Build reliable services with our engineering team.',
  'location', 'Pune', 'employment_type', 'FULL_TIME', 'published', true, 'openings', 2, 'responsible_id', test.id('rr_rec2'), 'required_steps', '["CALL"]'::jsonb));
select hr_career_posting(jsonb_build_object('position_id', (select id from hr_positions where title = 'RR Backend Engineer'), 'title', 'RR Backend Queue', 'description', 'Build reliable services with our engineering team.',
  'location', 'Delhi', 'employment_type', 'FULL_TIME', 'published', true, 'openings', 1));
select test.must_fail($$select hr_career_posting(jsonb_build_object('position_id', (select id from hr_positions where title = 'RR Backend Engineer'), 'title', 'RR Bad', 'description', 'Build reliable services with our engineering team.',
  'location', 'Delhi', 'employment_type', 'FULL_TIME', 'responsible_id', test.id('rr_asst')))$$, 'only a Recruiter can be the responsible person', 'VALIDATION_ERROR');
reset role;
create temp table rr(k text primary key, v uuid);
grant all on rr to authenticated, service_role;
insert into rr select 'ja', id from career_postings where title = 'RR Backend A';
insert into rr select 'jb', id from career_postings where title = 'RR Backend B';
insert into rr select 'jq', id from career_postings where title = 'RR Backend Queue';
select test.check((select vacancy_status = 'OPEN' and published and openings = 1 from career_postings where id = (select v from rr where k = 'ja')), 'a published job is an open vacancy and the portal still sees it');
select test.check((select required_steps = array['CALL']::text[] from career_postings where id = (select v from rr where k = 'jb')), 'required steps are saved');

set role authenticated;
-- an HR Assistant manages the job form as before, but cannot allocate a vacancy to a Recruiter
select test.login('rr_asst');
select test.must_fail($$select hr_career_posting(jsonb_build_object('id', (select v from rr where k = 'jq'), 'version', 1, 'position_id', (select id from hr_positions where title = 'RR Backend Engineer'), 'title', 'RR Backend Queue', 'description', 'Build reliable services with our engineering team.',
  'location', 'Delhi', 'employment_type', 'FULL_TIME', 'responsible_id', test.id('rr_rec2')))$$, 'an HR Assistant cannot allocate a vacancy to a Recruiter', 'FORBIDDEN');
select test.login('rr_rec1');
select test.check(jsonb_array_length(recruiter_vacancies()) = 2, 'a Recruiter sees their own vacancy and the unassigned queue only');
select test.check((select count(*) from jsonb_array_elements(recruiter_vacancies()) x where x ->> 'title' = 'RR Backend B') = 0, 'a Recruiter does not see another Recruiter''s vacancy');
select test.must_fail($$select recruiter_vacancy((select v from rr where k = 'jb'))$$, 'opening another Recruiter''s vacancy is refused', 'NOT_FOUND');
select test.check(jsonb_array_length(recruiter_vacancy((select v from rr where k = 'jq'))->'candidates') = 0 and (recruiter_vacancy((select v from rr where k = 'jq'))->>'canAct')::boolean = false, 'the queue shows the vacancy but no candidates and no actions');
select test.must_fail($$select recruiter_vacancy_assign((select v from rr where k = 'jq'), test.id('rr_rec1'))$$, 'a Recruiter cannot allocate vacancies', 'FORBIDDEN');
select test.must_fail($$select recruiter_directory()$$, 'a Recruiter cannot list recruiters for allocation', 'FORBIDDEN');
select test.login('hr_head');
select test.check(jsonb_array_length(recruiter_directory()) >= 2, 'HR leadership lists the active Recruiters');
select recruiter_vacancy_assign((select v from rr where k = 'jq'), test.id('rr_rec2'));
select test.must_fail($$select recruiter_vacancy_assign((select v from rr where k = 'jq'), test.id('rr_asst'))$$, 'a vacancy cannot be given to a non-Recruiter', 'VALIDATION_ERROR');
reset role;
select test.check(exists (select 1 from notifications where recipient_id = test.id('rr_rec2') and type = 'RECRUITER_VACANCY_ASSIGNED'), 'the Recruiter is told about the allocation');
select test.check(exists (select 1 from audit_logs where action = 'RECRUITER_VACANCY_ASSIGNED'), 'the allocation is audited');

set role authenticated;
select test.login('rr_rec1');
-- (20261226000300) the responsible Recruiter publishes, holds, closes and reopens their own vacancy, but never turns it back into a draft
select test.must_fail($$select recruiter_vacancy_status((select v from rr where k = 'ja'), 'DRAFT')$$, 'a Recruiter cannot turn a published vacancy back into a draft', 'FORBIDDEN');
select test.must_fail($$select recruiter_vacancy_status((select v from rr where k = 'jb'), 'CLOSED')$$, 'a Recruiter cannot change another Recruiter''s vacancy', 'NOT_FOUND');
select recruiter_vacancy_status((select v from rr where k = 'ja'), 'ON_HOLD', 'Budget review');
reset role;
select test.check((select vacancy_status = 'ON_HOLD' and not published from career_postings where id = (select v from rr where k = 'ja')), 'a vacancy on hold is not open to the portal');
set role authenticated;
select test.login('rr_rec1');
select recruiter_vacancy_status((select v from rr where k = 'ja'), 'OPEN');
reset role;
select test.check((select published from career_postings where id = (select v from rr where k = 'ja')), 'resuming a vacancy opens it again');

-- ---------------------------------------------------------------------------
\echo '   candidates apply through the portal'
-- ---------------------------------------------------------------------------
begin;
insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values
  ('rr.c1@example.com', now(), '{"candidate_portal":true}'), ('rr.c2@example.com', now(), '{"candidate_portal":true}'), ('rr.c3@example.com', now(), '{"candidate_portal":true}');
set constraints all immediate;
insert into rr select 'c1', id from auth.users where email = 'rr.c1@example.com';
insert into rr select 'c2', id from auth.users where email = 'rr.c2@example.com';
insert into rr select 'c3', id from auth.users where email = 'rr.c3@example.com';
create or replace function test.rr_profile(p_cand text, p_name text, p_phone text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', (select x.v from rr x where x.k = p_cand), 'role', 'authenticated')::text, false);
  perform career_profile(jsonb_build_object('name', p_name, 'phone', p_phone, 'city', 'Mumbai', 'state', 'Maharashtra', 'education', 'Graduate', 'experience', 'Fresher', 'skills', 'TypeScript', 'bio', '', 'version', 1));
end $$;
select test.rr_profile('c1', 'Asha Rao', '9847650321');
select test.rr_profile('c2', 'Bimal Das', '9847650322');
select test.rr_profile('c3', 'Chitra Nair', '9847650323');
commit;
insert into career_files (id, applicant_id, file_name, size_bytes, status, storage_provider, storage_path)
select gen_random_uuid(), v, 'resume.pdf', 1000, 'READY', 'SUPABASE', v::text || '/' || gen_random_uuid()::text || '.pdf' from rr where k in ('c1', 'c2', 'c3');
create or replace function test.rr_apply(p_cand text, p_job text) returns uuid language plpgsql security definer set search_path = public, test, private, auth as $$
declare out_id uuid;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', (select x.v from rr x where x.k = p_cand), 'role', 'authenticated')::text, false);
  select (career_apply((select x.v from rr x where x.k = p_job), (select f.id from career_files f where f.applicant_id = (select x.v from rr x where x.k = p_cand) limit 1))->>'id')::uuid into out_id;
  return out_id;
end $$;
grant execute on function test.rr_apply(text, text) to authenticated;
-- the test reads raw tables as the superuser through these helpers while it runs as the Recruiter
create or replace function test.rr_call(p_app text, p_open boolean) returns uuid language sql security definer set search_path = public as $$
  select c.id from hr_candidate_calls c join career_applications a on a.hr_candidate_id = c.candidate_id where a.id = (select x.v from rr x where x.k = p_app) and (c.called_at is null) = p_open limit 1 $$;
create or replace function test.rr_iv(p_app text, p_status text) returns uuid language sql security definer set search_path = public as $$
  select i.id from career_interviews i where i.application_id = (select x.v from rr x where x.k = p_app) and i.status = p_status order by i.created_at desc limit 1 $$;
create or replace function test.rr_ivv(p_app text, p_status text) returns integer language sql security definer set search_path = public as $$
  select i.version from career_interviews i where i.application_id = (select x.v from rr x where x.k = p_app) and i.status = p_status order by i.created_at desc limit 1 $$;
create or replace function test.rr_n(p_sql text) returns bigint language plpgsql security definer set search_path = public as $$
declare n bigint; begin execute p_sql into n; return n; end $$;
create or replace function test.rr_testid() returns uuid language sql security definer set search_path = public as $$ select id from career_tests where title = 'RR MCQ' $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- c1 applies to A and B (two vacancies, two applications); c2 to A; c3 to the queue vacancy (taken back from the Recruiter: nobody is responsible)
set role authenticated;
select test.login('hr_head');
select recruiter_vacancy_assign((select v from rr where k = 'jq'), null);
insert into rr select 'a1a', test.rr_apply('c1', 'ja');
insert into rr select 'a1b', test.rr_apply('c1', 'jb');
insert into rr select 'a2a', test.rr_apply('c2', 'ja');
insert into rr select 'a3q', test.rr_apply('c3', 'jq');
reset role;
select test.check(exists (select 1 from notifications where recipient_id = test.id('rr_rec1') and type = 'RECRUITER_NEW_APPLICATION'), 'the responsible Recruiter is told about a new application');
select test.check(exists (select 1 from notifications where recipient_id = test.id('hr_head') and type = 'RECRUITER_NEW_APPLICATION' and title like '%no recruiter yet%'), 'HR leadership is told when a vacancy has no Recruiter');
select test.check((select count(*) = 4 from recruiter_stage_history where new_status = 'NEW_APPLICATION'), 'each application starts its status history');

set role authenticated;
select test.login('rr_rec1');
select test.check((recruiter_applications()->>'total')::int = 2, 'Recruiter One sees only the applications of their vacancy (A)');
select test.must_fail($$select recruiter_application((select v from rr where k = 'a1b'))$$, 'another Recruiter''s application is not found', 'NOT_FOUND');
select test.must_fail($$select recruiter_application((select v from rr where k = 'a3q'))$$, 'an unassigned vacancy''s application is not readable by a Recruiter', 'NOT_FOUND');
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{submitted,name}' = 'Asha Rao', 'the candidate''s own submitted data is returned');
select test.check((recruiter_applications(jsonb_build_object('search', 'asha'))->>'total')::int = 1, 'search by name');
select test.check((recruiter_applications(jsonb_build_object('stage', 'NEW_APPLICATION'))->>'total')::int = 2, 'filter by pipeline stage');
select test.check((recruiter_applications(jsonb_build_object('posting', (select v from rr where k = 'jb')))->>'total')::int = 0, 'filtering to another vacancy shows nothing');
select test.login('rr_asst');
select test.must_fail($$select recruiter_applications()$$, 'an HR Assistant cannot read the recruiter lists', 'FORBIDDEN');
select test.login('hr_head');
select test.check((recruiter_applications()->>'total')::int = 4, 'HR leadership sees every application');

-- ---------------------------------------------------------------------------
\echo '   pipeline: stage follows the calls, tests and interviews; notes and history'
-- ---------------------------------------------------------------------------
select test.login('rr_rec1');
select recruiter_stage((select v from rr where k = 'a1a'), 'SCREEN', 'Looks relevant');
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'INITIAL_SCREENING', 'screening started');
select recruiter_call_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'SCHEDULE', 'scheduledAt', now() + interval '1 day'));
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'CALL_SCHEDULED', 'a scheduled call moves the stage');
select test.must_fail($$select recruiter_call_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'RECORD', 'callId', test.rr_call('a1a', true)))$$,
  'a call cannot be completed without an outcome', 'outcome');
select test.must_fail($$select recruiter_call_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'RECORD', 'outcome', 'CALL_BACK'))$$, 'a call-back needs its follow-up date', 'follow-up');
select recruiter_call_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'RECORD', 'callId', test.rr_call('a1a', true),
  'outcome', 'ANSWERED', 'note', 'Interested and available'));
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'CALL_COMPLETED', 'a recorded call completes the call stage');
select recruiter_note_add((select v from rr where k = 'a1a'), 'NOTE', 'Strong communication');
select test.must_fail($$select recruiter_note_add((select v from rr where k = 'a1b'), 'NOTE', 'x')$$, 'a note on another Recruiter''s application is refused', 'NOT_FOUND');
select test.check(jsonb_array_length(recruiter_application((select v from rr where k = 'a1a'))->'notes') = 1, 'internal notes are stored apart from the candidate''s data');
select test.check(jsonb_array_length(recruiter_application((select v from rr where k = 'a1a'))->'history') >= 3, 'every change is in the status history');
reset role;
select test.check((select count(*) >= 2 from recruiter_stage_history where application_id = (select v from rr where k = 'a1a') and previous_status is not null and updated_by = test.id('rr_rec1')), 'history keeps the previous status and who changed it');

-- a test invitation (pending, then completed)
insert into career_tests (title, duration_minutes, pass_percent, questions) values ('RR MCQ', 10, 50, '[{"prompt":"p","options":["a","b"],"correct":0}]'::jsonb);
insert into career_attempts (application_id, test_id, available_until) values ((select v from rr where k = 'a1a'), (select id from career_tests where title = 'RR MCQ'), now() + interval '2 days');
set role authenticated;
select test.login('rr_rec1');
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'TEST_PENDING', 'an invited test makes the stage test pending');
reset role;
update career_attempts set started_at = now(), submitted_at = now(), score = 1, passed = true where application_id = (select v from rr where k = 'a1a');
set role authenticated;
select test.login('rr_rec1');
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'TEST_COMPLETED', 'a submitted test makes the stage test completed');
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{assessments,0,status}' = 'COMPLETED', 'the assessment tab shows the result');

-- a Recruiter invites a candidate to a test themselves (the same record the HR Assistant's invitation makes)
select test.check(jsonb_array_length(recruiter_tests()) >= 1, 'a Recruiter sees the tests that exist');
select test.must_fail($$select recruiter_assessment_invite((select v from rr where k = 'a1b'), test.rr_testid(), now() + interval '2 days')$$, 'a Recruiter cannot invite another Recruiter''s candidate', 'NOT_FOUND');
select test.must_fail($$select recruiter_assessment_invite((select v from rr where k = 'a2a'), test.rr_testid(), now() - interval '1 day')$$, 'the invitation deadline must be in the future', 'VALIDATION_ERROR');
select recruiter_assessment_invite((select v from rr where k = 'a2a'), test.rr_testid(), now() + interval '2 days');
select test.check(recruiter_application((select v from rr where k = 'a2a'))#>>'{summary,stage}' = 'TEST_PENDING' and recruiter_application((select v from rr where k = 'a2a'))#>>'{summary,status}' = 'ASSESSMENT', 'an invited candidate has a pending test and the portal shows the assessment');
select test.check((recruiter_assessment_invite((select v from rr where k = 'a2a'), test.rr_testid(), now() + interval '2 days')->>'alreadyInvited')::boolean, 'inviting twice does not create a second attempt');

-- ---------------------------------------------------------------------------
\echo '   interviews'
-- ---------------------------------------------------------------------------
select test.must_fail($$select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'SCHEDULE', 'round', 'HR', 'scheduledAt', now() - interval '3 days', 'location', 'Office'))$$, 'an interview cannot be scheduled in the past', 'passed');
select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'SCHEDULE', 'round', 'HR', 'scheduledAt', now() + interval '1 day', 'location', 'Office', 'mode', 'IN_PERSON', 'interviewer', 'Panel A'));
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'INTERVIEW_SCHEDULED', 'a scheduled interview moves the stage');
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,status}' = 'INTERVIEW', 'the candidate portal stage follows');
select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'CONFIRM', 'id', test.rr_iv('a1a', 'SCHEDULED'), 'version', 1));
select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'RESCHEDULE', 'id', test.rr_iv('a1a', 'SCHEDULED'),
  'round', 'HR', 'scheduledAt', now() + interval '2 days', 'location', 'Office'));
select test.check(test.rr_n('select count(*) from career_interviews where application_id = ''' || (select v from rr where k = 'a1a') || '''') = 2 and test.rr_n('select count(*) from career_interviews where status = ''CANCELLED'' and application_id = ''' || (select v from rr where k = 'a1a') || '''') = 1,
  'a reschedule keeps the old interview as history');
select test.must_fail($$select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'COMPLETE', 'id', test.rr_iv('a1a', 'SCHEDULED'), 'version', 1, 'result', 'PROCEED'))$$,
  'an interview cannot be completed before it takes place', 'after it takes place');
reset role;
update career_interviews set scheduled_at = now() - interval '1 hour' where application_id = (select v from rr where k = 'a1a') and status = 'SCHEDULED';
set role authenticated;
select test.login('rr_rec1');
select test.must_fail($$select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'COMPLETE', 'id', test.rr_iv('a1a', 'SCHEDULED'), 'version', 1))$$,
  'completing an interview needs its result', 'result');
select recruiter_interview_save((select v from rr where k = 'a1a'), jsonb_build_object('action', 'COMPLETE', 'id', test.rr_iv('a1a', 'SCHEDULED'),
  'version', test.rr_ivv('a1a', 'SCHEDULED'), 'result', 'PROCEED', 'feedback', 'Good fit'));
select test.check(recruiter_application((select v from rr where k = 'a1a'))#>>'{summary,stage}' = 'INTERVIEW_COMPLETED', 'a completed interview moves the stage');
select test.must_fail($$select recruiter_interview_save((select v from rr where k = 'a1b'), jsonb_build_object('action', 'SCHEDULE', 'round', 'HR', 'scheduledAt', now() + interval '1 day', 'location', 'Office'))$$, 'interviews of another Recruiter''s application are refused', 'NOT_FOUND');
select test.check(jsonb_array_length(recruiter_interviews()->'items') = 2, 'the interview list shows only this Recruiter''s interviews');
reset role;
-- an interview booked by the candidate (portal) tells the Recruiter
select set_config('request.jwt.claims', jsonb_build_object('sub', (select v from rr where k = 'c2'), 'role', 'authenticated')::text, false);
insert into career_interviews (application_id, round, scheduled_at, location, booked_by) values ((select v from rr where k = 'a2a'), 'HR', now() + interval '3 days', 'Video call', 'CANDIDATE');
select test.check(exists (select 1 from notifications where recipient_id = test.id('rr_rec1') and type = 'RECRUITER_INTERVIEW_BOOKED'), 'a booking made by the candidate notifies the Recruiter');

-- ---------------------------------------------------------------------------
\echo '   decisions: once, never both, independent per vacancy, corrected only by HR leadership'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('rr_rec1');
select test.must_fail($$select recruiter_decide((select v from rr where k = 'a1b'), 'SELECTED')$$, 'a Recruiter cannot decide another Recruiter''s application', 'NOT_FOUND');
select test.must_fail($$select recruiter_decide((select v from rr where k = 'a1a'), 'MAYBE')$$, 'only selected or rejected exist', 'VALIDATION_ERROR');
select recruiter_decide((select v from rr where k = 'a1a'), 'SELECTED');
select test.check((recruiter_decide((select v from rr where k = 'a1a'), 'SELECTED')->>'alreadyRecorded')::boolean, 'repeating the same decision returns the one already recorded');
select test.must_fail($$select recruiter_decide((select v from rr where k = 'a1a'), 'REJECTED', 'OTHER')$$, 'a Recruiter cannot flip a decision', 'already recorded');
reset role;
select test.check((select count(*) = 1 from recruiter_decisions where application_id = (select v from rr where k = 'a1a') and is_current), 'exactly one current decision');
select test.check((select count(*) = 1 from recruitment_decision_emails where application_id = (select v from rr where k = 'a1a') and email_type = 'SELECTION' and status = 'PENDING'), 'one selection e-mail is queued, once, with the decision');
select test.check((select stage = 'SELECTED' from career_applications where id = (select v from rr where k = 'a1a')), 'the application is selected');
select test.check((select vacancy_status = 'FILLED' from career_postings where id = (select v from rr where k = 'ja')), 'the last opening taken fills the vacancy (it is not closed)');
select test.check(exists (select 1 from notifications where recipient_id = test.id('hr_head') and type = 'RECRUITER_VACANCY_FILLED'), 'HR leadership is told the vacancy is ready for closure');
-- the same candidate's other application is independent
select test.check((select stage = 'SUBMITTED' from career_applications where id = (select v from rr where k = 'a1b')), 'the same candidate''s application to another vacancy is untouched');
select test.check((select count(*) = 0 from recruiter_stage_history h where h.application_id = (select v from rr where k = 'a1b') and h.new_status <> 'NEW_APPLICATION'), 'and so is its history (calls and tests do not leak across vacancies)');
-- all openings of A are filled: another selection is refused, a rejection of the other applicant is fine
set role authenticated;
select test.login('rr_rec1');
select test.must_fail($$select recruiter_decide((select v from rr where k = 'a2a'), 'SELECTED')$$, 'selection beyond the openings is refused', 'filled');
select recruiter_decide((select v from rr where k = 'a2a'), 'REJECTED', 'SKILLS_MISMATCH', 'Needs more backend experience');
reset role;
select test.check((select email_type = 'REJECTION' from recruitment_decision_emails where application_id = (select v from rr where k = 'a2a')), 'a rejection queues the rejection e-mail');
-- vacancy B requires a completed call before selection
set role authenticated;
select test.login('rr_rec2');
select test.must_fail($$select recruiter_decide((select v from rr where k = 'a1b'), 'SELECTED')$$, 'a required step must be done before selection', 'requires a completed call');
select recruiter_call_save((select v from rr where k = 'a1b'), jsonb_build_object('action', 'RECORD', 'outcome', 'INTERESTED', 'note', 'Keen'));
select recruiter_decide((select v from rr where k = 'a1b'), 'SELECTED');
reset role;
select test.check((select stage = 'SELECTED' from career_applications where id = (select v from rr where k = 'a1a')) and (select stage = 'SELECTED' from career_applications where id = (select v from rr where k = 'a1b')),
  'the same candidate can be selected for two vacancies independently');
select test.check((select vacancy_status = 'OPEN' from career_postings where id = (select v from rr where k = 'jb')), 'a vacancy with openings left stays open');

-- corrections: HR leadership only, history kept, a new e-mail
set role authenticated;
select test.login('rr_rec1');
select test.must_fail($$select recruiter_decision_correct((select v from rr where k = 'a2a'), 'SELECTED', 'Changed our mind entirely')$$, 'a Recruiter cannot correct a decision', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$select recruiter_decision_correct((select v from rr where k = 'a2a'), 'SELECTED', 'no')$$, 'a correction needs a real reason', 'why');
select test.must_fail($$select recruiter_decision_correct((select v from rr where k = 'a2a'), 'SELECTED', 'Position reopened after review')$$, 'a correction cannot exceed the openings', 'filled');
select recruiter_decision_correct((select v from rr where k = 'a1a'), 'REJECTED', 'Background check failed');
reset role;
select test.check((select count(*) = 2 from recruiter_decisions where application_id = (select v from rr where k = 'a1a')) and (select count(*) = 1 from recruiter_decisions where application_id = (select v from rr where k = 'a1a') and is_current and decision = 'REJECTED'),
  'a correction keeps the old decision and makes the new one current');
select test.check((select count(*) = 2 from recruitment_decision_emails where application_id = (select v from rr where k = 'a1a')), 'the correction has its own e-mail event');
select test.check(exists (select 1 from audit_logs where action = 'RECRUITER_DECISION_CORRECTED'), 'the correction is audited');

-- ---------------------------------------------------------------------------
\echo '   the e-mail outbox is backend only'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('rr_rec1');
select test.must_fail($$select * from recruitment_decision_emails$$, 'a Recruiter cannot read the outbox', 'permission denied');
select test.must_fail($$select recruitment_email_admin_list()$$, 'a Recruiter cannot use the technical e-mail functions', 'permission denied|FORBIDDEN');
select test.must_fail($$select recruitment_email_claim()$$, 'a Recruiter cannot claim e-mails', 'permission denied');
select test.login('hr_head');
select test.must_fail($$select recruitment_email_admin_list()$$, 'HR leadership has no e-mail screen either', 'FORBIDDEN|permission denied');
select test.login('sa');
select test.check(jsonb_array_length(recruitment_email_admin_list()) >= 3, 'only the Super Admin can list outbox rows (technical, not a screen)');
reset role;

set role service_role;
select test.service();
select test.check(jsonb_array_length(recruitment_email_claim(10, 'live', 600, null)) >= 3, 'the server claims due e-mails');
select test.check(jsonb_array_length(recruitment_email_claim(10, 'live', 600, null)) = 0, 'a second sender cannot claim the same e-mails');
reset role;
select test.check((select count(*) = 0 from recruitment_decision_emails where status = 'PENDING'), 'claimed e-mails are no longer pending');

-- provider failure never undoes the decision
set role service_role;
select test.service();
select recruitment_email_finish((select id from recruitment_decision_emails where application_id = (select v from rr where k = 'a2a')), 'RETRY', 'Temporary SMTP failure', 451, null);
reset role;
select test.check((select status = 'RETRYING' and attempts = 1 and next_attempt_at > now() from recruitment_decision_emails where application_id = (select v from rr where k = 'a2a')), 'a temporary failure is retried later');
select test.check((select stage = 'REJECTED' from career_applications where id = (select v from rr where k = 'a2a')), 'and the decision stands');
set role service_role;
select test.service();
select recruitment_email_finish((select id from recruitment_decision_emails where application_id = (select v from rr where k = 'a1b')), 'SENT', null, 202, 'ref-1');
reset role;
select test.check((select status = 'SENT' and sent_at is not null from recruitment_decision_emails where application_id = (select v from rr where k = 'a1b')), 'a sent e-mail is recorded once');

-- ---------------------------------------------------------------------------
\echo '   reports and regression'
-- ---------------------------------------------------------------------------
set role authenticated;
select test.login('rr_rec1');
select test.check((recruiter_reports()->'totals'->>'applications')::int = 2 and recruiter_reports()->>'scope' = 'OWN', 'a Recruiter''s report covers their own vacancies only');
select test.login('hr_head');
select test.check((recruiter_reports()->'totals'->>'applications')::int >= 4 and recruiter_reports()->>'scope' = 'COMPANY', 'HR leadership''s report covers the company');
select test.check(jsonb_typeof(recruiter_overview()->'kpis') = 'object', 'the overview works');
select test.check(jsonb_typeof(recruiter_pipeline(null)->'stages') = 'object', 'the pipeline works');
select test.login('rr_rec1');
select test.check(jsonb_typeof(recruiter_calls()->'recent') = 'array', 'the call list works');
select test.check(jsonb_typeof(recruiter_decisions_list('DECIDED')) = 'array', 'the decided list works');
select test.login('rr_asst');
select test.check(jsonb_typeof(hr_career_posting()) = 'array', 'regression: an HR Assistant still manages recruitment');
reset role;
\echo '   ok: HR Recruiter workflow'
