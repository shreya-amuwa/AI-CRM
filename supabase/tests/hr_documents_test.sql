-- =============================================================================
-- HR documents: NDA and Experience Letter (migration 20261229000100). The employee record decides who a letter is for and whether it may be
-- issued; the stored row belongs to exactly that employee; only HR staff can prepare, list or open them.
-- Runs after hr_email_test.sql on the same database. No file is stored here (the server does that); only the database side is exercised.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR documents (NDA, Experience Letter)'
reset role;

create or replace function test.hrd_employee(p_name text, p_email text, p_joining date, p_position text default null, p_hr_status text default null, p_left date default null)
returns void language plpgsql as $$
begin
  perform test.create_auth_user(p_name, p_email, jsonb_build_object('full_name', initcap(replace(p_name, '_', ' '))),
    jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
  if p_joining is not null then insert into employee_personal_details (profile_id, joining_date) values (test.id(p_name), p_joining); end if;
  if p_position is not null then update profiles set position = p_position where id = test.id(p_name); end if;
  if p_hr_status is not null then
    insert into hr_employees (id, name, email, department_id, status, joining_date, profile_id, data)
    values ('HRD-' || upper(p_name), initcap(replace(p_name, '_', ' ')), p_email, 'wabastore', p_hr_status, to_char(p_joining, 'YYYY-MM-DD'), test.id(p_name),
            case when p_left is null then '{}'::jsonb else jsonb_build_object('leftDate', to_char(p_left, 'YYYY-MM-DD')) end);
  end if;
end $$;

select test.hrd_employee('hrd_active', 'hrd.active@amuwa.com', date '2024-05-04', 'Business Development Executive', 'Full-Time');
select test.hrd_employee('hrd_left_b', 'hrd.leftb@amuwa.com',   date '2025-11-03', 'Senior Business Development Executive', 'Left', date '2026-09-22');
select test.hrd_employee('hrd_left_c', 'hrd.leftc@amuwa.com',   date '2022-01-17', 'Support Executive', 'Left', date '2025-12-31');
select test.hrd_employee('hrd_nojoin', 'hrd.nojoin@amuwa.com',  null, 'Executive', 'Left');
select test.hrd_employee('hrd_revoked', 'hrd.revoked@amuwa.com', date '2023-03-01', 'Telecaller');
update profiles set status = 'REVOKED' where id = test.id('hrd_revoked');
insert into hr_employees (id, name, email, designation, department_id, status, joining_date, data)
values ('HRD-ONLY-LEFT', 'Hrd Only Left', 'hrd.onlyleft@amuwa.com', 'Sales Executive', 'wabastore', 'Left', '2023-01-02', '{"leftDate":"2024-02-03"}'),
       ('HRD-ONLY-ACTIVE', 'Hrd Only Active', 'hrd.onlyactive@amuwa.com', 'Sales Executive', 'wabastore', 'Full-Time', '2023-01-02', '{}');
select test.create_auth_user('hrd_rec', 'hrd.rec@amuwa.com', '{"full_name":"HRD Recruiter"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
update profiles set hr_sub_role = 'HR_RECRUITER' where id = test.id('hrd_rec');

create temp table k as select test.id('hrd_active')::text as a, test.id('hrd_left_b')::text as b, test.id('hrd_left_c')::text as c,
  test.id('hrd_nojoin')::text as nj, test.id('hrd_revoked')::text as rv, 'HR:HRD-ONLY-LEFT'::text as hl, 'HR:HRD-ONLY-ACTIVE'::text as ha;
grant all on k to authenticated;

\echo '   what the record says'
set role authenticated;
select test.login('hr_head');
create temp table pb as select hr_document_prefill((select b from k), 'EXPERIENCE') as j;
grant all on pb to authenticated;
select test.check((select j #>> '{employee,name}' = 'Hrd Left B' and j #>> '{employee,code}' = 'HRD-HRD_LEFT_B' and j #>> '{employee,designation}' = 'Senior Business Development Executive'
                          and j #>> '{employee,joiningDate}' = '2025-11-03' and j #>> '{employee,lastWorkingDate}' = '2026-09-22' and (j ->> 'ready')::boolean from pb),
  'the Experience Letter form is filled from the HR record: name, code, designation, joining date, last working date');
select test.check((select j ->> 'today' = (now() at time zone 'Asia/Kolkata')::date::text from pb), 'today is the Indian date');
select test.check((hr_document_prefill((select c from k), 'EXPERIENCE') #>> '{employee,name}') = 'Hrd Left C'
              and (hr_document_prefill((select c from k), 'EXPERIENCE') #>> '{employee,joiningDate}') = '2022-01-17'
              and (hr_document_prefill((select c from k), 'EXPERIENCE') #>> '{employee,lastWorkingDate}') = '2025-12-31',
  'another employee gets that employee''s own details (no mixing)');
select test.check((hr_document_prefill((select hl from k), 'EXPERIENCE') #>> '{employee,name}') = 'Hrd Only Left'
              and (hr_document_prefill((select hl from k), 'EXPERIENCE') #>> '{employee,designation}') = 'Sales Executive'
              and (hr_document_prefill((select hl from k), 'EXPERIENCE') ->> 'ready')::boolean,
  'an HR-only record (no CRM login) works the same way');
select test.check((hr_document_prefill((select rv from k), 'EXPERIENCE') ->> 'ready')::boolean, 'a revoked account counts as having left');
select test.check((hr_document_prefill((select a from k), 'EXPERIENCE') ->> 'ready')::boolean = false
              and hr_document_prefill((select a from k), 'EXPERIENCE') -> 'problems' -> 0 ->> 'code' = 'NOT_SEPARATED',
  'an employee who is still working cannot get an Experience Letter');
select test.check((hr_document_prefill((select ha from k), 'EXPERIENCE') ->> 'ready')::boolean = false, 'nor an active HR-only record');
select test.check((hr_document_prefill((select nj from k), 'EXPERIENCE') -> 'problems') @> '[{"code":"NO_JOINING_DATE"}]'::jsonb
              and not (hr_document_prefill((select nj from k), 'EXPERIENCE') ->> 'ready')::boolean,
  'no joining date on record: the letter is blocked, and the account creation date is not used instead');
select test.check((hr_document_prefill((select a from k), 'NDA') ->> 'ready')::boolean, 'an NDA can be made for a working employee');
select test.must_fail($$select hr_document_prefill('HR:DOES-NOT-EXIST', 'NDA')$$, 'an unknown employee is not found', 'NOT_FOUND');
select test.must_fail($$select hr_document_prefill(gen_random_uuid()::text, 'NDA')$$, 'nor an unknown account', 'NOT_FOUND');
select test.must_fail($$select hr_document_prefill((select id::text from profiles where role = 'SUPER_ADMIN' limit 1), 'NDA')$$, 'the Super Admin is not an employee', 'NOT_FOUND');
select test.must_fail($$select hr_document_prefill((select b from k), 'OFFER')$$, 'only the two letters exist', 'VALIDATION_ERROR');

\echo '   storing a generated document'
reset role;
create or replace function test.hrd_fields(p_name text, p_join date, p_last date, p_letter date) returns jsonb language sql as $$
  select jsonb_build_object('letterDate', p_letter, 'title', 'Mr.', 'employeeName', p_name, 'designation', 'Executive', 'joiningDate', p_join,
                            'lastWorkingDate', p_last, 'signatoryName', 'Aarti Kalange', 'signatoryTitle', 'Ceo') $$;
grant execute on function test.hrd_fields(text, date, date, date) to authenticated;
set role authenticated;
select test.login('hr_head');
create temp table rb as select hr_document_record((select b from k), 'EXPERIENCE', test.hrd_fields('Hrd Left B Printed Differently', date '2025-11-03', date '2026-09-22', date '2026-09-23'),
  'Experience-Letter-Hrd-Left-B.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/b1.pdf', 'supabase://hr-documents/EXPERIENCE/b1.pdf', null, 4321, repeat('a', 64)) as j;
create temp table rc as select hr_document_record((select c from k), 'EXPERIENCE', test.hrd_fields('Hrd Left C', date '2022-01-17', date '2025-12-31', date '2026-01-02'),
  'Experience-Letter-Hrd-Left-C.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/c1.pdf', null, null, 4000, repeat('b', 64)) as j;
create temp table rn as select hr_document_record((select a from k), 'NDA', jsonb_build_object('letterDate', '2026-05-04', 'employeeName', 'Hrd Active'),
  'NDA-Hrd-Active.pdf', 'SUPABASE', 'hr-documents', 'NDA/a1.pdf', null, null, 90000, repeat('c', 64)) as j;
grant all on rb, rc, rn to authenticated;
reset role;
select test.check((select employee_key = test.id('hrd_left_b')::text and profile_id = test.id('hrd_left_b') and employee_code = 'HRD-HRD_LEFT_B' and employee_name = 'Hrd Left B'
                          and doc_type = 'EXPERIENCE' and generated_by = test.id('hr_head') and fields ->> 'employeeName' = 'Hrd Left B Printed Differently'
                     from hr_documents where id = ((select j ->> 'id' from rb)::uuid)),
  'the document is linked to the employee of the record (key, code, name); the printed values are kept as printed');
select test.check((select count(*) = 3 from hr_documents where storage_path in ('EXPERIENCE/b1.pdf', 'EXPERIENCE/c1.pdf', 'NDA/a1.pdf')), 'each generation is its own row');
select test.check((select count(*) = 1 from audit_logs where action = 'HR_DOCUMENT_GENERATED' and entity_id = ((select j ->> 'id' from rb)::uuid) and actor_id = test.id('hr_head')), 'generating is audited');
select test.check(not exists (select 1 from audit_logs where action like 'HR_DOCUMENT%' and metadata::text ~* '(@|printed differently)'), 'the audit log keeps no e-mail address and no printed name');

set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_document_record((select a from k), 'EXPERIENCE', test.hrd_fields('Hrd Active', date '2024-05-04', date '2026-01-01', date '2026-01-02'), 'x.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/x1.pdf', null, null, 10, repeat('d', 64))$$,
  'an Experience Letter is refused for an employee who has not left, whatever the browser sent', 'has left');
select test.must_fail($$select hr_document_record((select b from k), 'EXPERIENCE', test.hrd_fields('Hrd Left B', date '2020-01-01', date '2026-09-22', date '2026-09-23'), 'x.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/x2.pdf', null, null, 10, repeat('d', 64))$$,
  'a joining date that is not the record''s is refused', 'joining date');
select test.must_fail($$select hr_document_record((select b from k), 'EXPERIENCE', test.hrd_fields('Hrd Left B', date '2025-11-03', date '2025-01-01', date '2026-09-23'), 'x.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/x3.pdf', null, null, 10, repeat('d', 64))$$,
  'a last working date before the joining date is refused', 'before the joining date');
select test.must_fail($$select hr_document_record((select b from k), 'EXPERIENCE', test.hrd_fields('Hrd Left B', date '2025-11-03', date '2026-09-22', date '2026-09-01'), 'x.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/x4.pdf', null, null, 10, repeat('d', 64))$$,
  'a letter dated before the last working day is refused', 'letter date');
select test.must_fail($$select hr_document_record((select nj from k), 'EXPERIENCE', test.hrd_fields('Hrd Nojoin', date '2024-01-01', date '2026-01-01', date '2026-01-02'), 'x.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/x5.pdf', null, null, 10, repeat('d', 64))$$,
  'no joining date on record: refused', 'joining date');
select test.must_fail($$select hr_document_record((select b from k), 'EXPERIENCE', test.hrd_fields('Hrd Left B', date '2025-11-03', date '2026-09-22', date '2026-09-23'), 'x.pdf', 'SUPABASE', 'blueprint-files', 'EXPERIENCE/x6.pdf', null, null, 10, repeat('d', 64))$$,
  'a file in another bucket is refused', 'not valid');
select test.must_fail($$select hr_document_record((select b from k), 'EXPERIENCE', test.hrd_fields('Hrd Left B', date '2025-11-03', date '2026-09-22', date '2026-09-23'), 'x.pdf', 'SUPABASE', 'hr-documents', 'EXPERIENCE/b1.pdf', null, null, 10, repeat('d', 64))$$,
  'the same stored file cannot be recorded twice', 'duplicate');
select test.must_fail($$select hr_document_record('HR:NOBODY', 'NDA', '{"employeeName":"X"}', 'x.pdf', 'SUPABASE', 'hr-documents', 'NDA/x7.pdf', null, null, 10, repeat('d', 64))$$, 'an unknown employee is refused', 'NOT_FOUND');

\echo '   listing and opening'
select test.check(jsonb_array_length(hr_documents_list((select b from k))) = 1 and hr_documents_list((select b from k)) -> 0 ->> 'employeeName' = 'Hrd Left B',
  'the list for one employee holds only that employee''s documents');
select test.check(jsonb_array_length(hr_documents_list((select c from k))) = 1 and hr_documents_list((select c from k)) -> 0 ->> 'fileName' = 'Experience-Letter-Hrd-Left-C.pdf', 'and another employee''s list holds theirs');
select test.check(jsonb_array_length(hr_documents_list(null, 'NDA')) = 1 and jsonb_array_length(hr_documents_list(null, null)) >= 3, 'the list can be filtered by type');
select test.check(hr_document_get(((select j ->> 'id' from rn)::uuid)) ->> 'storagePath' = 'NDA/a1.pdf', 'HR opens a stored document by its id');
select test.must_fail($$select hr_document_get(gen_random_uuid())$$, 'an unknown document is not found', 'NOT_FOUND');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'HR_DOCUMENT_OPENED' and actor_id = test.id('hr_head')), 'opening a document is audited');

\echo '   permissions'
set role authenticated;
select test.login('hrx_tm');
select test.check((hr_document_prefill((select b from k), 'EXPERIENCE') ->> 'ready')::boolean and jsonb_array_length(hr_documents_list(null, null)) >= 3, 'an HR team member (HR staff) can prepare and list');
select test.login('tm_a');
select test.must_fail($$select hr_document_prefill((select b from k), 'NDA')$$, 'a sales member cannot prepare a letter', 'FORBIDDEN');
select test.must_fail($$select hr_documents_list(null, null)$$, 'nor list the documents', 'FORBIDDEN');
select test.must_fail($$select hr_document_get(((select j ->> 'id' from rn)::uuid))$$, 'nor open one', 'FORBIDDEN');
select test.must_fail($$select hr_document_record((select a from k), 'NDA', '{"employeeName":"X"}', 'x.pdf', 'SUPABASE', 'hr-documents', 'NDA/x8.pdf', null, null, 10, repeat('d', 64))$$, 'nor record one', 'FORBIDDEN');
select test.login('hrd_left_b');
select test.must_fail($$select hr_documents_list((select b from k), null)$$, 'an employee cannot read their own letters through the list', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select hr_documents_list(null, null)$$, 'a department head outside HR cannot', 'FORBIDDEN');
select test.login('hrd_rec');
select test.must_fail($$select hr_document_prefill((select b from k), 'NDA')$$, 'an HR Recruiter is not HR staff for these letters', 'FORBIDDEN');
select test.must_fail($$select count(*) from hr_documents$$, 'the table cannot be read directly', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select hr_documents_list(null, null)$$, 'a signed-out visitor cannot', 'permission denied');
reset role;
select test.check((select relrowsecurity from pg_class where oid = 'public.hr_documents'::regclass), 'row-level security is on');
select test.check((select not public from storage.buckets where id = 'hr-documents'), 'the bucket is private');

\echo '=== ALL HR DOCUMENT TESTS PASSED ==='
