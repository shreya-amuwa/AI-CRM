-- =============================================================================
-- HR employee files (migration 20261231000800_hr_employee_files.sql): documents HR uploads to an employee's profile.
-- HR staff upload / list / open / delete any employee's files; the employee may list and open only their own READY files;
-- everyone else (other employees, HR Recruiters) gets nothing. Only metadata lives in the table - the file is in R2.
-- Runs after rls_test.sql on the same database (uses its users: sa, hr_head, th_wab). No file is stored here.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR employee files (documents vault, leave mails)'
reset role;

select test.create_auth_user('hef_emp', 'hef.emp@amuwa.com', '{"full_name":"Hef Employee"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('hef_other', 'hef.other@amuwa.com', '{"full_name":"Hef Other"}',
  jsonb_build_object('provisioned_by', test.id('th_wab'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('wabastore', 'Sales')));
select test.create_auth_user('hef_rec', 'hef.rec@amuwa.com', '{"full_name":"Hef Recruiter"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
update profiles set status = 'ACTIVE' where id in (test.id('hef_emp'), test.id('hef_other'), test.id('hef_rec'));
update profiles set hr_sub_role = 'HR_RECRUITER' where id = test.id('hef_rec');
insert into hr_employees (id, name, email, department_id, status, joining_date, data)
values ('HEF-ONLY', 'Hef Only', 'hef.only@amuwa.com', 'wabastore', 'Full-Time', '2024-01-02', '{}')
on conflict (id) do nothing;

create temp table hk as select test.id('hef_emp')::text as emp, test.id('hef_other')::text as other, 'HR:HEF-ONLY'::text as only_hr;
grant all on hk to authenticated;
create temp table hf (name text primary key, id uuid);
grant all on hf to authenticated;

\echo '   HR staff upload: book, then complete'
set role authenticated;
select test.login('hr_head');
insert into hf select 'id_proof', (hr_employee_file_begin((select emp from hk), 'IDENTITY', 'aadhaar.pdf', 'application/pdf', 120000)).id;
select test.check((select status = 'PENDING' and storage_bucket = 'hr-employee-files' and employee_key = (select emp from hk)
                          and profile_id = test.id('hef_emp') and storage_path like (select emp from hk) || '/' || id || '/%'
                          and uploaded_by = test.id('hr_head')
                     from hr_employee_files where id = (select id from hf where name = 'id_proof')),
  'the upload is booked for that employee, by the HR user, at a server-chosen path (never one from the browser)');
select test.check(jsonb_array_length(hr_employee_files_list((select emp from hk))) = 0, 'a file that has not finished uploading is not listed');
select test.check((hr_employee_file_complete((select id from hf where name = 'id_proof'), 118000, '"etag1"') ->> 'kind') = 'IDENTITY',
  'completing it returns the file');
select test.check((select status = 'READY' and size_bytes = 118000 and storage_etag = '"etag1"' from hr_employee_files where id = (select id from hf where name = 'id_proof')),
  'the stored size and ETag are what the server saw in storage');
select test.check(jsonb_array_length(hr_employee_files_list((select emp from hk))) = 1
              and hr_employee_files_list((select emp from hk)) -> 0 ->> 'fileName' = 'aadhaar.pdf'
              and hr_employee_files_list((select emp from hk)) -> 0 ->> 'uploadedBy' is not null,
  'the employee''s files list shows it, with who uploaded it');
select test.must_fail($$select hr_employee_file_complete((select id from hf where name = 'id_proof'), 1, null)$$, 'a finished upload cannot be completed again', 'NOT_FOUND');

insert into hf select 'leave_mail', (hr_employee_file_begin((select emp from hk), 'LEAVE_MAIL', 'approval.eml', 'message/rfc822', 2048, 'LR-1700000000000')).id;
select hr_employee_file_complete((select id from hf where name = 'leave_mail'), 2048, null);
select test.check((hr_employee_files_list((select emp from hk)) -> 0 ->> 'leaveRef') = 'LR-1700000000000', 'a leave mail keeps the leave it belongs to');

insert into hf select 'docx', (hr_employee_file_begin((select only_hr from hk), 'EMPLOYMENT', 'offer.docx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 5242880)).id;
select hr_employee_file_complete((select id from hf where name = 'docx'), 5242880, null);
select test.check((select profile_id is null and hr_record_id = 'HEF-ONLY' from hr_employee_files where id = (select id from hf where name = 'docx')),
  'an HR-only record (no login) can hold files; exactly 5 MB is allowed');

\echo '   what is refused at upload'
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', 'x.gif', 'image/gif', 10)$$, 'other file types are refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', 'x.doc', 'application/msword', 10)$$, 'old Word .doc is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', 'x.pdf', 'application/pdf', 5242881)$$, 'more than 5 MB is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', 'x.pdf', 'application/pdf', 0)$$, 'an empty file is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'PAYSLIP', 'x.pdf', 'application/pdf', 10)$$, 'an unknown kind is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', '   ', 'application/pdf', 10)$$, 'a file needs a name', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'LEAVE_MAIL', 'm.pdf', 'application/pdf', 10)$$, 'a leave mail must name its leave', 'VALIDATION_ERROR');
select test.must_fail($$select hr_employee_file_begin('HR:NOPE', 'IDENTITY', 'x.pdf', 'application/pdf', 10)$$, 'an unknown employee is not found', 'NOT_FOUND');
select test.must_fail($$select hr_employee_file_begin((select id::text from profiles where role = 'SUPER_ADMIN' limit 1), 'IDENTITY', 'x.pdf', 'application/pdf', 10)$$,
  'the Super Admin account is not an employee', 'NOT_FOUND');
-- a size larger than 5 MB reported by storage at completion is refused too
insert into hf select 'big', (hr_employee_file_begin((select emp from hk), 'OTHER', 'big.pdf', 'application/pdf', 100)).id;
select test.must_fail($$select hr_employee_file_complete((select id from hf where name = 'big'), 6000000, null)$$, 'the stored object may not be bigger than 5 MB', 'VALIDATION_ERROR');
select hr_employee_file_abort((select id from hf where name = 'big'));
select test.check((select status = 'FAILED' from hr_employee_files where id = (select id from hf where name = 'big')), 'an aborted upload is marked failed');

\echo '   someone else''s upload'
select test.login('sa');
insert into hf select 'sa_pending', (hr_employee_file_begin((select emp from hk), 'EDUCATION', 'degree.png', 'image/png', 900)).id;
select test.login('hr_head');
select test.must_fail($$select hr_employee_file_complete((select id from hf where name = 'sa_pending'), 900, null)$$, 'only the uploader can complete an upload', 'NOT_FOUND');
select hr_employee_file_abort((select id from hf where name = 'sa_pending'));
select test.check((select status = 'PENDING' from hr_employee_files where id = (select id from hf where name = 'sa_pending')), 'nor abort it');
select test.login('sa');
select hr_employee_file_complete((select id from hf where name = 'sa_pending'), 900, null);
select test.check(jsonb_array_length(hr_employee_files_list((select emp from hk))) = 3, 'the Super Admin is HR staff: uploads and lists');

\echo '   the employee: their own files, read only'
select test.login('hef_emp');
select test.check(jsonb_array_length(hr_employee_files_list((select emp from hk))) = 3, 'the employee lists their own files');
select test.check((hr_employee_file_download((select id from hf where name = 'id_proof'))).file_name = 'aadhaar.pdf', 'and can open one');
select test.check((select count(*) from hr_employee_files) = 3, 'row level security: the table shows them only their own ready files');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', 'self.pdf', 'application/pdf', 10)$$, 'the employee cannot upload', 'FORBIDDEN');
select test.must_fail($$select hr_employee_file_delete((select id from hf where name = 'id_proof'))$$, 'nor delete', 'FORBIDDEN');
select test.must_fail($$select hr_employee_files_list((select only_hr from hk))$$, 'nor list anyone else''s files', 'FORBIDDEN');
select test.must_fail($$select hr_employee_file_download((select id from hf where name = 'docx'))$$, 'nor open anyone else''s file', 'NOT_FOUND');
select test.must_fail($$insert into hr_employee_files (employee_key, kind, file_name, mime_type, size_bytes, storage_path) values ('x', 'OTHER', 'x', 'application/pdf', 1, 'x')$$,
  'nobody writes the table directly', 'permission denied');
select test.must_fail($$update hr_employee_files set file_name = 'renamed.pdf'$$, 'nor updates it', 'permission denied');
select test.must_fail($$delete from hr_employee_files$$, 'nor deletes from it', 'permission denied');

\echo '   everyone else: nothing'
select test.login('hef_other');
select test.must_fail($$select hr_employee_files_list((select emp from hk))$$, 'another employee cannot list them', 'FORBIDDEN');
select test.must_fail($$select hr_employee_file_download((select id from hf where name = 'id_proof'))$$, 'nor open one', 'NOT_FOUND');
select test.check((select count(*) from hr_employee_files) = 0, 'row level security: another employee sees no rows');
select test.check(jsonb_array_length(hr_employee_files_list((select other from hk))) = 0, 'their own (empty) list works');
select test.login('hef_rec');
select test.must_fail($$select hr_employee_files_list((select emp from hk))$$, 'an HR Recruiter is not HR staff for these documents', 'FORBIDDEN');
select test.must_fail($$select hr_employee_file_begin((select emp from hk), 'IDENTITY', 'x.pdf', 'application/pdf', 10)$$, 'and cannot upload', 'FORBIDDEN');
select test.check((select count(*) from hr_employee_files) = 0, 'row level security: the Recruiter sees no rows');
select test.login('th_wab');
select test.must_fail($$select hr_employee_files_list((select emp from hk))$$, 'the employee''s team lead cannot list them', 'FORBIDDEN');
select test.check((select count(*) from hr_employee_files) = 0, 'nor see rows');
reset role;
set role anon;
select test.must_fail($$select count(*) from hr_employee_files$$, 'anonymous visitors cannot read the table', 'permission denied');
select test.must_fail($$select hr_employee_files_list('HR:HEF-ONLY')$$, 'nor call the functions', 'permission denied');
reset role;

\echo '   audit, delete'
select test.check((select count(*) from audit_logs where action = 'HR_EMPLOYEE_FILE_UPLOADED' and entity_id in (select id from hf)) = 4, 'every finished upload is audited');
select test.check((select count(*) from audit_logs where action = 'HR_EMPLOYEE_FILE_OPENED' and entity_id = (select id from hf where name = 'id_proof')
                    and (metadata ->> 'bySelf')::boolean) = 1, 'the employee opening their own file is audited');
set role authenticated;
select test.login('hr_head');
select test.check((hr_employee_file_delete((select id from hf where name = 'id_proof'))).storage_path is not null, 'HR deletes a file (the API is given the path to remove)');
select test.check(not exists (select 1 from jsonb_array_elements(hr_employee_files_list((select emp from hk))) e where e ->> 'id' = (select id::text from hf where name = 'id_proof')),
  'a deleted file is no longer listed');
select test.must_fail($$select hr_employee_file_download((select id from hf where name = 'id_proof'))$$, 'nor opened', 'NOT_FOUND');
select test.must_fail($$select hr_employee_file_delete((select id from hf where name = 'id_proof'))$$, 'nor deleted twice', 'NOT_FOUND');
select test.login('hef_emp');
select test.check((select count(*) from hr_employee_files where id = (select id from hf where name = 'id_proof')) = 0, 'and the employee no longer sees it');
reset role;
select test.check((select deleted_at is not null and deleted_by = test.id('hr_head') from hr_employee_files where id = (select id from hf where name = 'id_proof')),
  'the row is kept, marked deleted, for the audit trail');
select test.check(exists (select 1 from audit_logs where action = 'HR_EMPLOYEE_FILE_DELETED' and entity_id = (select id from hf where name = 'id_proof')), 'the deletion is audited');

\echo '   the migration can run again'
\i supabase/migrations/20261231000800_hr_employee_files.sql
select test.check((select count(*) from hr_employee_files where id in (select id from hf)) = 5, 'running the migration again keeps every row');
set role authenticated;
select test.login('hef_emp');
select test.check((select count(*) from hr_employee_files) = 2, 'and the read rule still holds');
reset role;
