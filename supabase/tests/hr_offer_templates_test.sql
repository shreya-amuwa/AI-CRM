-- =============================================================================
-- Role-based Offer Letter templates (migration 20270206000100): one versioned template per designation (five seeded from the supplied samples),
-- uploaded samples and letterheads, issued letters linked to the template version they were made from. HR staff read and generate; only the
-- Super Admin / HR Admin Head add or replace templates; a version never changes; replacing a template never changes an issued letter.
-- Runs after hr_letter_templates_test.sql (its people: hrd_active, hr_head, hrx_tm, hrd_rec, tm_a).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Role-based Offer Letter templates'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270206000100_hr_offer_templates.sql
\i supabase/migrations/20270206000100_hr_offer_templates.sql
select test.check((select count(*) = 5 from hr_offer_templates) and (select count(*) = 5 from hr_offer_template_versions where version = 1),
  'five designation templates, version 1 each, once (safe to run twice)');
select test.check((select array_agg(designation order by sort_order) from hr_offer_templates)
  = array['Technical Support', 'Customer Support', 'Business Development Executive', 'Sales Executive', 'AI Developer'], 'the five designations, in order');
select test.check((select count(distinct content::text) = 5 and count(distinct letterhead ->> 'builtin') = 5 from hr_offer_template_versions), 'each has its own wording and its own letterhead');
select test.check((select content -> 'blocks' -> 0 ->> 'text' = 'APPOINTMENT LETTER' and content -> 'fields' @> '[{"key": "title", "type": "select"}]'::jsonb
                     from hr_offer_template_versions v join hr_offer_templates t on t.id = v.template_id where t.template_key = 'customer-support'),
  'Customer Support is the appointment letter with its own fields (title)');
select test.check((select content -> 'dateLine' ->> 'left' = 'REF-NO:{refNo}' from hr_offer_template_versions v join hr_offer_templates t on t.id = v.template_id
                    where t.template_key = 'business-development'), 'Business Development Executive has the reference number line');
select test.must_fail($$update hr_offer_template_versions set note = 'changed' where version = 1$$, 'a version is never changed', 'cannot be changed');
select test.must_fail($$delete from hr_offer_template_versions where version = 1$$, 'nor deleted', 'cannot be changed');
create temp table ot (k text primary key, v jsonb);
grant all on ot to authenticated;
insert into ot select 'tech', to_jsonb(id) from hr_offer_templates where template_key = 'technical-support';
create or replace function test.ot_id(p_key text) returns uuid language sql stable security definer set search_path = '' as $$
  select (v #>> '{}')::uuid from pg_temp.ot where k = p_key $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   who may read and who may change'
set role authenticated;
select test.login('hrx_tm');
select test.check((select jsonb_array_length(l -> 'templates') = 5 and not (l ->> 'canManage')::boolean
                          and (l -> 'templates' -> 0 -> 'current' ->> 'version')::int = 1 and l -> 'templates' -> 0 -> 'current' -> 'content' ? 'fields'
                     from (select hr_offer_templates_list() l) x), 'an HR Assistant reads the templates (with their fields), and may not manage them');
select test.check((select (hr_offer_template_version(test.ot_id('tech'), 1) -> 'content' -> 'fields') @> '[{"key": "salary", "type": "money"}]'::jsonb), 'and a version');
select test.must_fail($$select hr_offer_template_save(test.ot_id('tech'), 'Technical Support', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content',
                         '{"builtin": "technical-support"}', null, 1, 'try')$$, 'an HR Assistant cannot replace a template', 'FORBIDDEN: Only the Super Admin and the HR Admin Head');
select test.must_fail($$select hr_offer_template_file_record('SAMPLE', 's.pdf', 'application/pdf', 100, 'SUPABASE', 'hr-documents', 'offer-templates/sample/x.pdf', null, repeat('a', 64))$$,
  'nor upload a template file', 'FORBIDDEN');
select test.must_fail($$select count(*) from hr_offer_templates$$, 'the tables are not readable directly', 'permission denied');
select test.must_fail($$insert into hr_offer_template_files (kind, file_name, mime_type, size_bytes, storage_bucket, storage_path, sha256) values ('SAMPLE', 'x', 'application/pdf', 1, 'b', 'p', repeat('a', 64))$$,
  'nor writable', 'permission denied');
select test.login('hrd_rec');
select test.must_fail($$select hr_offer_templates_list()$$, 'an HR Recruiter has no access', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select hr_offer_template_version(test.ot_id('tech'), 1)$$, 'nor an ordinary employee', 'FORBIDDEN');

\echo '   the HR Admin Head: files, a new version, a new designation'
select test.login('hr_head');
select test.check((hr_offer_templates_list() ->> 'canManage')::boolean, 'the HR Admin Head manages templates');
insert into ot select 'sample', hr_offer_template_file_record('SAMPLE', 'Technical Support Offer Letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  466696, 'SUPABASE', 'hr-documents', 'offer-templates/sample/' || gen_random_uuid() || '.docx', null, repeat('b', 64));
insert into ot select 'letterhead', hr_offer_template_file_record('LETTERHEAD', 'Letterhead.pdf', 'application/pdf', 120000, 'SUPABASE', 'hr-documents',
  'offer-templates/letterhead/' || gen_random_uuid() || '.pdf', null, repeat('c', 64));
select test.check((select v ->> 'kind' = 'SAMPLE' and v ->> 'uploadedBy' is not null from ot where k = 'sample'), 'a sample document is recorded');
select test.must_fail($$select hr_offer_template_file_record('LETTERHEAD', 'l.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100, 'SUPABASE', 'hr-documents', 'offer-templates/l/x.docx', null, repeat('a', 64))$$,
  'a letterhead must be a PDF', 'VALIDATION_ERROR: A letterhead must be a PDF');
select test.must_fail($$select hr_offer_template_file_record('SAMPLE', 's.pdf', 'application/pdf', 100, 'SUPABASE', 'hr-documents', 'offer/elsewhere.pdf', null, repeat('a', 64))$$,
  'a file is stored only under offer-templates/', 'VALIDATION_ERROR');
select test.must_fail($$select hr_offer_template_file_record('SAMPLE', 's.pdf', 'application/pdf', 6000000, 'SUPABASE', 'hr-documents', 'offer-templates/s/x.pdf', null, repeat('a', 64))$$,
  'at most 5 MB', 'VALIDATION_ERROR');

insert into ot select 'v2', hr_offer_template_save(test.ot_id('tech'), 'Technical Support', 'Replaced sample',
  jsonb_set(hr_offer_template_version(test.ot_id('tech'), 1) -> 'content', '{blocks,0,text}', '"OFFER LETTER (2027)"'),
  jsonb_build_object('fileId', (select v ->> 'id' from ot where k = 'letterhead')), (select (v ->> 'id')::uuid from ot where k = 'sample'), 1, 'New sample from HR');
select test.check((select (v -> 'current' ->> 'version')::int = 2 and v -> 'current' -> 'sampleFile' ->> 'fileName' = 'Technical Support Offer Letter.docx'
                          and v -> 'current' -> 'letterheadFile' ->> 'kind' = 'LETTERHEAD' and (v ->> 'versionCount')::int = 2 from ot where k = 'v2'),
  'replacing the template makes version 2 with the uploaded sample and letterhead');
select test.check((select hr_offer_template_version(test.ot_id('tech'), 1) -> 'content' -> 'blocks' -> 0 ->> 'text' = 'OFFER LETTER'), 'version 1 is unchanged');
select test.must_fail($$select hr_offer_template_save(test.ot_id('tech'), 'Technical Support', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content', '{"builtin": "technical-support"}', null, 1, null)$$,
  'saving over an older version is refused (someone saved in the meantime)', 'CONFLICT');
select test.must_fail($$select hr_offer_template_save(test.ot_id('tech'), 'Technical Support', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content', '{"builtin": "nowhere"}', null, 2, null)$$,
  'an unknown letterhead is refused', 'VALIDATION_ERROR');
select test.must_fail($$select hr_offer_template_save(test.ot_id('tech'), 'Technical Support', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content',
                         jsonb_build_object('fileId', (select v ->> 'id' from pg_temp.ot where k = 'sample')), null, 2, null)$$,
  'a sample document is not a letterhead', 'VALIDATION_ERROR');
select test.must_fail($$select hr_offer_template_save(test.ot_id('tech'), 'Technical Support', null, '{"blocks": [], "fields": [], "dateLine": {}}', '{"builtin": "technical-support"}', null, 2, null)$$,
  'a template needs its wording and fields', 'VALIDATION_ERROR');
select test.must_fail($$select hr_offer_template_save(test.ot_id('tech'), 'Sales Executive', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content', '{"builtin": "technical-support"}', null, 2, null)$$,
  'two templates cannot share a designation', 'CONFLICT');

insert into ot select 'new', hr_offer_template_save(null, 'Graphic Designer', 'A new designation', hr_offer_template_version(test.ot_id('tech'), 1) -> 'content',
  '{"builtin": "technical-support"}', (select (v ->> 'id')::uuid from ot where k = 'sample'), 0, 'First version');
select test.check((select v ->> 'key' = 'graphic-designer' and (v -> 'current' ->> 'version')::int = 1 and (v ->> 'sortOrder')::int = 6 from ot where k = 'new'),
  'a new designation template is added (key from the designation, listed last)');
select test.check((select jsonb_array_length(hr_offer_templates_list() -> 'templates') = 6), 'six templates now');
select test.must_fail($$select hr_offer_template_save(null, 'graphic designer', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content', '{"builtin": "technical-support"}', null, 0, null)$$,
  'the same designation twice is refused', 'CONFLICT');
reset role;
select test.check((select count(*) = 4 from audit_logs where action in ('HR_OFFER_TEMPLATE_SAVED', 'HR_OFFER_TEMPLATE_FILE_UPLOADED') and actor_id = test.id('hr_head')),
  'uploads and saves are audited');
set role authenticated;

\echo '   an issued letter keeps its template version'
select test.login('hrx_tm');
select test.must_fail($$select hr_document_record(test.id('hrd_active')::text, 'OFFER',
                         jsonb_build_object('offerTemplateId', test.ot_id('tech'), 'templateVersion', 9, 'values', '{}'::jsonb, 'employeeName', 'Hrd Active'),
                         'Offer.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 1234, repeat('a', 64))$$,
  'a template version that does not exist is refused', 'VALIDATION_ERROR: The letter''s template version is not known');
select test.must_fail($$select hr_document_record(test.id('hrd_active')::text, 'OFFER',
                         jsonb_build_object('offerTemplateId', test.ot_id('tech'), 'templateVersion', 1, 'employeeName', 'Hrd Active'),
                         'Offer.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 1234, repeat('a', 64))$$,
  'the values are required', 'VALIDATION_ERROR: The offer letter values are missing');
insert into ot select 'doc', hr_document_record(test.id('hrd_active')::text, 'OFFER',
  jsonb_build_object('offerTemplateId', test.ot_id('tech'), 'templateKey', 'technical-support', 'templateDesignation', 'Technical Support', 'templateVersion', 2,
    'values', '{"employeeName": "Hrd Active", "salary": "18000"}'::jsonb, 'employeeName', 'Hrd Active', 'letterDate', '2026-11-24'),
  'Offer-Letter-Technical-Support-Hrd-Active-2026-11-24.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 2345, repeat('d', 64));
select test.check((select v ->> 'type' = 'OFFER' and (v -> 'fields' ->> 'templateVersion')::int = 2 and v -> 'fields' ->> 'templateDesignation' = 'Technical Support' from ot where k = 'doc'),
  'a role-based Offer Letter is stored for the employee');
select test.login('hr_head');
select hr_offer_template_save(test.ot_id('tech'), 'Technical Support', null, hr_offer_template_version(test.ot_id('tech'), 1) -> 'content', '{"builtin": "technical-support"}', null, 2, 'v3');
reset role;
select test.check((select offer_template_id = test.ot_id('tech') and offer_template_version = 2 and fields ->> 'templateVersion' = '2'
                     from hr_documents where id = (select (v ->> 'id')::uuid from ot where k = 'doc')), 'after version 3 the issued letter still records version 2 (unchanged)');
set role authenticated;
select test.login('hrx_tm');
select test.check((select (h -> 'versions' -> 0 ->> 'version')::int = 3 and (h -> 'versions' -> 1 ->> 'issued')::int = 1 and (h ->> 'issued')::int = 1
                     from (select hr_offer_template_versions(test.ot_id('tech')) h) x), 'the history shows each version and the letters issued with it');
select test.check((select count(*) >= 1 from jsonb_array_elements(hr_documents_list(test.id('hrd_active')::text, 'OFFER')) d where d -> 'fields' ->> 'templateDesignation' = 'Technical Support'),
  'the employee''s documents list the role-based letter');

\echo '   the earlier Offer Letter still works'
select test.check((select (hr_document_record(test.id('hrd_active')::text, 'OFFER',
  jsonb_build_object('letterDate', '2026-09-30', 'employeeName', 'Hrd Active', 'designation', 'Business Development Executive', 'department', 'Wabastore',
    'employmentType', 'Full-Time', 'joiningDate', '2024-05-04', 'salary', '₹10,000/- per month (Fixed)', 'probation', '6 Months', 'reportingTo', 'Team Leader',
    'signatoryName', 'Miss Aarti Kalange', 'templateVersion', 1, 'content', hr_letter_template_version('OFFER', 1) -> 'content'),
  'Offer-Letter-Hrd-Active-2026-09-30.pdf', 'SUPABASE', 'hr-documents', 'offer/test/' || gen_random_uuid() || '.pdf', null, null, 1234, repeat('e', 64)) -> 'fields' ->> 'templateVersion')::int = 1),
  'an Offer Letter from the earlier master template is still recorded');
reset role;
select set_config('request.jwt.claims', '', false);
\echo '   Role-based Offer Letter templates: all checks passed'
