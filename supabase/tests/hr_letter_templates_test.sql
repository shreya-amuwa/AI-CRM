-- =============================================================================
-- HR letters (migration 20261231000700): the Offer Letter is stored like the NDA and the Experience Letter, and the wording of the Offer and
-- Experience Letters is a versioned master template. HR staff read it; only HR leadership saves new versions, on top of the current one; a letter
-- already issued keeps the wording it was made with. Runs after hr_documents_test.sql (its people: hrd_active, hr_head, hrx_tm, hrd_rec, tm_a).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR letters: Offer Letter, master templates and versions'
reset role;
\i supabase/migrations/20261231000600_hr_letter_templates.sql
\i supabase/migrations/20261231000600_hr_letter_templates.sql
select test.check((select count(*) = 2 from hr_letter_templates where version = 1), 'version 1 of both master templates, once (safe to run twice)');
select test.check((select content ->> 'salutation' = 'Dear {name},' and jsonb_array_length(content -> 'terms') = 8 from hr_letter_templates where doc_type = 'OFFER' and version = 1),
  'the Offer Letter template is the supplied wording (salutation, the 8 employment terms)');
update hr_employees set monthly_salary = '₹10,000/- per month (Fixed)', working_hours = '09:30 AM - 06:30 PM (Mon-Sat)' where profile_id = test.id('hrd_active');
create temp table lt (k text primary key, v jsonb);
grant all on lt to authenticated;

set role authenticated;
\echo '   prefill: the record, the salary and the current master template'
select test.login('hrx_tm');
select test.check((select p -> 'employee' ->> 'monthlySalary' = '₹10,000/- per month (Fixed)' and (p ->> 'ready')::boolean
                          and (p -> 'template' ->> 'version')::int = 1 and p -> 'template' -> 'content' ->> 'subject' like 'Offer Letter for the Position of%'
                     from (select hr_document_prefill(test.id('hrd_active')::text, 'OFFER') p) x),
  'an HR Assistant prepares an Offer Letter: the record, its salary and the master template come back');
select test.check((select (hr_document_prefill(test.id('hrd_active')::text, 'OFFER') ->> 'ready')::boolean), 'an Offer Letter can be made for a working employee (no "has left" rule)');
select test.check((select hr_document_prefill(test.id('hrd_active')::text, 'NDA') -> 'template' = 'null'::jsonb), 'the NDA has no editable template (it is the official PDF)');

\echo '   master templates: everyone in HR reads, only HR leadership saves'
select test.check((select (s -> 'current' ->> 'version')::int = 1 and jsonb_array_length(s -> 'versions') = 1 and not (s ->> 'canEdit')::boolean
                     from (select hr_letter_template_state('OFFER') s) x), 'an HR Assistant reads the template and its versions, and may not edit');
select test.must_fail($$select hr_letter_template_save('OFFER', (hr_letter_template_state('OFFER') -> 'current' -> 'content') || '{"signOff": "Regards,"}', 1, 'try')$$,
  'an HR Assistant cannot save a master template', 'FORBIDDEN');
select test.must_fail($$select count(*) from hr_letter_templates$$, 'the template table is not readable directly (only through the functions)', 'permission denied');
select test.must_fail($$insert into hr_letter_templates (doc_type, version, content) values ('OFFER', 50, '{}')$$, 'nor writable', 'permission denied');
select test.login('hrd_rec');
select test.must_fail($$select hr_letter_template_state('OFFER')$$, 'an HR Recruiter has no access to letters', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select hr_letter_template_state('EXPERIENCE')$$, 'nor an ordinary employee', 'FORBIDDEN');

select test.login('hr_head');
select test.check((hr_letter_template_state('OFFER') ->> 'canEdit')::boolean, 'the HR Admin Head may edit');
insert into lt select 'v2', hr_letter_template_save('OFFER', (hr_letter_template_state('OFFER') -> 'current' -> 'content') || '{"signOff": "With regards, Amuwa Corporation,"}', 1, 'New sign-off');
select test.check((select (v ->> 'version')::int = 2 and v -> 'content' ->> 'signOff' = 'With regards, Amuwa Corporation,' from lt where k = 'v2'), 'saving makes version 2');
select test.must_fail($$select hr_letter_template_save('OFFER', (hr_letter_template_state('OFFER') -> 'current' -> 'content') || '{"signOff": "Stale"}', 1, null)$$,
  'a save built on an older version is refused (no lost update)', 'CONFLICT');
select test.must_fail($$select hr_letter_template_save('OFFER', hr_letter_template_state('OFFER') -> 'current' -> 'content', 2, null)$$, 'saving without a change is refused', 'Nothing was changed');
select test.must_fail($$select hr_letter_template_save('OFFER', '{"subject": "x"}', 2, null)$$, 'an incomplete template is refused', 'incomplete');
select test.must_fail($$select hr_letter_template_save('NDA', '{"greeting": "x", "paragraphs": ["x"], "signOff": "x"}', 1, null)$$, 'the NDA has no master template to edit', 'Offer Letter or the Experience Letter');
select test.check((select (v ->> 'version')::int = 1 and v -> 'content' ->> 'signOff' = 'For Amuwa Corporation,' from (select hr_letter_template_version('OFFER', 1) v) x),
  'version 1 stays readable, unchanged');
select test.check((select jsonb_array_length(hr_letter_template_state('OFFER') -> 'versions') = 2), 'the version history lists both');
reset role;
select test.check(exists (select 1 from audit_logs where action = 'HR_LETTER_TEMPLATE_SAVED'), 'saving a template is audited');

\echo '   an issued Offer Letter keeps its wording when the master changes'
set role authenticated;
select test.login('hrx_tm');
insert into lt select 'doc', hr_document_record(test.id('hrd_active')::text, 'OFFER',
  jsonb_build_object('letterDate', '2026-09-30', 'employeeName', 'Hrd Active', 'designation', 'Business Development Executive', 'department', 'Wabastore',
    'employmentType', 'Full-Time', 'joiningDate', '2024-05-04', 'salary', '₹10,000/- per month (Fixed)', 'probation', '6 Months', 'reportingTo', 'Team Leader',
    'signatoryName', 'Miss Aarti Kalange', 'templateVersion', 2, 'content', hr_letter_template_version('OFFER', 2) -> 'content'),
  'Offer-Letter-Hrd-Active-2026-09-30.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 1234, repeat('a', 64));
select test.check((select v ->> 'type' = 'OFFER' and (v -> 'fields' ->> 'templateVersion')::int = 2 from lt where k = 'doc'), 'an Offer Letter is stored for the employee, with its template version');
select test.must_fail($$select hr_document_record(test.id('hrd_active')::text, 'OFFER', jsonb_build_object('employeeName', 'Hrd Active', 'templateVersion', 99, 'content', '{}'::jsonb, 'joiningDate', '2024-05-04', 'designation', 'X'),
  'x.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 1, repeat('a', 64))$$, 'an unknown template version is refused', 'template version');
select test.must_fail($$select hr_document_record(test.id('hrd_active')::text, 'OFFER', jsonb_build_object('employeeName', 'Hrd Active'),
  'x.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 1, repeat('a', 64))$$, 'an Offer Letter without its values is refused', 'offer letter values');
select test.login('hr_head');
insert into lt select 'v3', hr_letter_template_save('OFFER', (hr_letter_template_state('OFFER') -> 'current' -> 'content') || '{"acceptanceHeading": "Employee Acceptance"}', 2, 'Heading');
select test.login('hrx_tm');
select test.check((select d -> 'fields' -> 'content' ->> 'acceptanceHeading' = 'Acceptance' and d -> 'fields' -> 'content' ->> 'signOff' = 'With regards, Amuwa Corporation,'
                     from jsonb_array_elements(hr_documents_list(test.id('hrd_active')::text, 'OFFER')) d where d ->> 'id' = (select v ->> 'id' from lt where k = 'doc')),
  'after version 3 is saved, the issued letter still has the wording of version 2');
select test.check((select count(*) >= 1 from jsonb_array_elements(hr_documents_list(test.id('hrd_active')::text, null)) d where d ->> 'type' = 'OFFER'), 'it is in the employee''s document history');
select test.login('hrd_rec');
select test.must_fail($$select hr_documents_list(null, 'OFFER')$$, 'an HR Recruiter cannot list the letters', 'FORBIDDEN');
reset role;
\echo '   ok: HR letters'
