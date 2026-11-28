-- =============================================================================
-- AI Studio daily report approval to HR, and HR's AI Studio Performance (migration 20270302000100).
-- Runs after the other AI Studio suites and reuses their people: ai_tl1 (Team Lead of ai_tm1a / ai_tm1b), ai_tl2 (Team Lead of ai_tm2a), ai_dh
-- (Department Head), sa (Super Admin), hr_head (the HR Department Head). Creates its own HR employee (hrp_viewer: the one the Super Admin names,
-- e.g. Simran Kumari) and uses report dates 20-24 days back (no other suite writes those).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- AI Studio: daily report approval to HR, AI Studio Performance'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of the report functions again: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270302000100_ai_studio_hr_performance.sql
\i supabase/migrations/20270302000100_ai_studio_hr_performance.sql
-- 20270306000100: the Team Lead's approval of a Team Member's report is final (Team Member -> Team Lead -> HR); report_hierarchy_test.sql tests it in full
\i supabase/migrations/20270306000100_report_hierarchy.sql

create or replace function test.hd(p_day integer) returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date + p_day $$;
create or replace function test.words(n integer) returns text language sql immutable as $$ select string_agg('word' || g, ' ') from generate_series(1, n) g $$;
create table if not exists hp_r (name text primary key, id uuid);
grant all on hp_r to authenticated;
create or replace function test.hr(p_name text) returns uuid language sql stable as $$ select id from hp_r where name = p_name $$;
create or replace function test.hrow(p_name text) returns public.ai_studio_daily_reports language sql stable security definer set search_path = '' as $$
  select * from public.ai_studio_daily_reports where id = (select id from public.hp_r where name = p_name) $$;
create or replace function test.hnotes(p_person text, p_type text, p_report uuid) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.notifications where recipient_id = test.id(p_person) and type = p_type and entity_id = p_report $$;
-- the report's history as people read it (SENT_TO_HR comes from its own record), and the rows HR received
create or replace function test.hevents(p_report uuid, p_action text) returns bigint language sql stable security definer set search_path = '' as $$
  select case when p_action = 'SENT_TO_HR' then (select count(*) from public.ai_studio_report_hr_sends where report_id = p_report)
              when p_action = 'REJECTED' then (select count(*) from public.ai_studio_report_events where report_id = p_report and action = 'RETURNED' and to_status = 'REJECTED_BY_TL')
              else (select count(*) from public.ai_studio_report_events where report_id = p_report and action = p_action) end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
delete from public.ai_studio_daily_reports where report_date between test.hd(-24) and test.hd(-20) and author_id in (test.id('ai_tm1b'), test.id('ai_tm2a'), test.id('ai_tl1'));

-- the HR employee the Super Admin will name (another HR employee, hr_head, is NOT named)
select test.create_auth_user('hrp_viewer', 'hrp.viewer@amuwa.com', '{"full_name":"HRP Viewer"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
select test.check(private.is_hr_staff_profile(test.id('hrp_viewer')) and private.is_hr_staff_profile(test.id('hr_head')), 'fixtures: two HR employees');
select test.check(private.direct_lead_of(test.id('ai_tm1b')) = test.id('ai_tl1') and private.direct_lead_of(test.id('ai_tm2a')) = test.id('ai_tl2'), 'fixtures: two AI Studio teams');

\echo '   the word rule (words, not characters)'
select test.check(private.word_count('one two  three') = 3 and private.word_count('  ') = 0 and private.word_count('a - ... b') = 2 and private.word_count(null) = 0,
  'words are counted, separators and punctuation alone are not words');
select test.must_fail($$select private.ai_studio_check_description(test.words(9))$$, '9 words are too few', 'at least 10 words');
select test.must_fail($$select private.ai_studio_check_description(test.words(151))$$, '151 words are too many', 'at most 150 words');
select private.ai_studio_check_description(test.words(10));
select private.ai_studio_check_description(test.words(150));
select test.check(true, '10 and 150 words are accepted');
select test.must_fail($$select private.ai_studio_check_description(repeat('x', 300))$$, 'one 300-character "word" is one word, not enough', 'at least 10 words');

\echo '   who may open AI Studio Performance'
set role authenticated;
select test.login('hrp_viewer');
select test.check(not (ai_studio_hr_access_info() ->> 'allowed')::boolean, 'an HR employee nobody named has no access');
select test.must_fail($$select ai_studio_hr_performance()$$, 'and is refused the data', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$select ai_studio_hr_viewer_set(test.id('hrp_viewer'), true)$$, 'the HR head cannot name a viewer (only the Super Admin)', 'FORBIDDEN');
select test.login('sa');
select test.check((ai_studio_hr_access_info() ->> 'allowed')::boolean and (ai_studio_hr_access_info() ->> 'canManage')::boolean, 'the Super Admin has access and manages it');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_hr_access_info() -> 'candidates') c where c ->> 'id' = test.id('hrp_viewer')::text), 'HR employees are offered');
select test.must_fail($$select ai_studio_hr_viewer_set(test.id('ai_tm1a'), true)$$, 'only an HR employee can be named', 'HR employee');
select test.check(jsonb_array_length(ai_studio_hr_viewer_set(test.id('hrp_viewer'), true) -> 'viewers') = 1, 'the Super Admin names one HR employee');
select test.login('hrp_viewer');
select test.check((ai_studio_hr_access_info() ->> 'allowed')::boolean and not (ai_studio_hr_access_info() ->> 'canManage')::boolean
                  and jsonb_array_length(ai_studio_hr_access_info() -> 'viewers') = 0, 'the named HR employee has access (and does not see the list)');
select test.login('hr_head');
select test.must_fail($$select ai_studio_hr_performance()$$, 'another HR employee still has none', 'FORBIDDEN');
select test.login('ai_tl1');
select test.must_fail($$select ai_studio_hr_performance()$$, 'nor a Team Lead', 'FORBIDDEN');
select test.login('ai_tm1b');
select test.must_fail($$select ai_studio_hr_performance()$$, 'nor a Team Member', 'FORBIDDEN');
select test.login('ai_dh');
select test.must_fail($$select ai_studio_hr_performance()$$, 'nor the AI Studio Department Head', 'FORBIDDEN');
reset role;
select test.check(not has_table_privilege('authenticated', 'public.ai_studio_hr_viewers', 'select'), 'the viewer table is closed to the browser');

\echo '   a Team Member submits: 10-150 words'
set role authenticated;
select test.login('ai_tm1b');
select test.must_fail($$select ai_studio_daily_report_save(null, test.hd(-20), '{}'::uuid[], 'Wrote the onboarding screens', null, null, null, null, true, p_description => test.words(9))$$,
  'fewer than 10 words: not submitted', 'at least 10 words');
select test.must_fail($$select ai_studio_daily_report_save(null, test.hd(-20), '{}'::uuid[], 'Wrote the onboarding screens', null, null, null, null, true, p_description => test.words(151))$$,
  'more than 150 words: not submitted', 'at most 150 words');
select test.must_fail($$select ai_studio_daily_report_save(null, test.hd(-20), '{}'::uuid[], 'Wrote the onboarding screens', null, null, null, null, true)$$,
  'no description: not submitted', 'at least 10 words');
insert into hp_r select 'm1', (ai_studio_daily_report_save(null, test.hd(-20), '{}'::uuid[], 'Wrote the onboarding screens', 'The tests', 'Waiting for the API keys', null, 'Good day',
  true, p_description => 'Built the onboarding screens for the client dashboard and fixed two layout bugs on mobile.') ->> 'id')::uuid;
reset role;
select test.check((test.hrow('m1')).status = 'PENDING_TL_APPROVAL' and (test.hrow('m1')).lead_id = test.id('ai_tl1') and (test.hrow('m1')).hr_sent_at is null,
  'a valid report waits for the member''s own Team Lead (Pending Approval), not yet with HR');
select test.check(test.hnotes('ai_tm1b', 'AI_STUDIO_REPORT_SUBMITTED_OK', test.hr('m1')) = 1, 'the member is told it was submitted successfully');
select test.check(test.hnotes('ai_tl1', 'AI_STUDIO_REPORT_SUBMITTED', test.hr('m1')) = 1, 'the Team Lead is told a new report waits');
-- a draft can hold fewer words; the database refuses a submission without them whatever function submits
set role authenticated;
select test.login('ai_tm1b');
insert into hp_r select 'm1draft', (ai_studio_daily_report_save(null, test.hd(-21), '{}'::uuid[], 'Draft only', null, null, null, null, false, p_description => 'short') ->> 'id')::uuid;
reset role;
select test.must_fail($$update public.ai_studio_daily_reports set status = 'PENDING_TL_APPROVAL' where id = test.hr('m1draft')$$, 'the trigger refuses a short description on any submission', 'at least 10 words');

\echo '   only the member''s own Team Lead decides; Approve sends it to HR once'
set role authenticated;
select test.login('ai_tl2');
select test.check(not exists (select 1 from jsonb_array_elements(ai_studio_reports_page('team') -> 'items') x where x ->> 'id' = test.hr('m1')::text), 'another Team Lead does not see it');
select test.must_fail($$select ai_studio_report_review(test.hr('m1'), 'APPROVE')$$, 'nor approve it', 'not found');
select test.login('ai_tl1');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_reports_page('team', p_status => 'PENDING_TL_APPROVAL') -> 'items') x where x ->> 'id' = test.hr('m1')::text),
  'the member''s Team Lead has it in their approval list');
select test.must_fail($$select ai_studio_report_review(test.hr('m1'), 'REJECT')$$, 'a rejection needs a reason', 'reason');
select test.check((ai_studio_report_review(test.hr('m1'), 'APPROVE') ->> 'status') = 'APPROVED', 'the Team Lead approves: final (20270306000100)');
reset role;
select test.check((test.hrow('m1')).tl_reviewed_by = test.id('ai_tl1') and (test.hrow('m1')).tl_reviewed_at is not null and (test.hrow('m1')).hr_sent_at is not null
                  and (test.hrow('m1')).hr_sent_revision = 1, 'the approver and the time are recorded, and it is sent to HR');
select test.check(test.hevents(test.hr('m1'), 'SENT_TO_HR') = 1 and test.hevents(test.hr('m1'), 'APPROVED') = 1, 'the history says approved, then sent to HR');
set role authenticated;
select test.login('ai_tm1b');
select test.check((ai_studio_report_get(test.hr('m1')) -> 'history' -> -1 ->> 'action') = 'SENT_TO_HR' and (ai_studio_report_get(test.hr('m1')) -> 'history' -> -2 ->> 'action') = 'APPROVED',
  'the member reads it in order: approved by the Team Lead, then sent to HR');
reset role;
select test.check(test.hnotes('hrp_viewer', 'AI_STUDIO_REPORT_TO_HR', test.hr('m1')) = 1, 'the named HR employee is notified');
select test.check(test.hnotes('hr_head', 'AI_STUDIO_REPORT_TO_HR', test.hr('m1')) = 0, 'another HR employee is not');
select test.check(test.hnotes('ai_tm1b', 'AI_STUDIO_REPORT_TL_APPROVED', test.hr('m1')) = 1, 'the member is told it was approved');
select test.check(test.hnotes('ai_tl1', 'AI_STUDIO_REPORT_DECIDED', test.hr('m1')) = 1, 'the Team Lead gets the confirmation of their approval');
set role authenticated;
select test.login('ai_tl1');
select test.must_fail($$select ai_studio_report_review(test.hr('m1'), 'APPROVE')$$, 'approving twice is refused', 'not waiting for your decision');
reset role;
select test.check(test.hevents(test.hr('m1'), 'SENT_TO_HR') = 1 and test.hnotes('hrp_viewer', 'AI_STUDIO_REPORT_TO_HR', test.hr('m1')) = 1, 'still sent once, one notification');

\echo '   return and reject never reach HR'
set role authenticated;
select test.login('ai_tm2a');
insert into hp_r select 'm2r', (ai_studio_daily_report_save(null, test.hd(-20), '{}'::uuid[], 'Designed the QR flow', null, null, null, null, true,
  p_description => 'Designed the QR code flow for the AIQR studio and discussed it with the Team Lead today.') ->> 'id')::uuid;
insert into hp_r select 'm2x', (ai_studio_daily_report_save(null, test.hd(-21), '{}'::uuid[], 'Copied a report', null, null, null, null, true,
  p_description => 'This report repeats the work of another day and should not be approved by anyone at all.') ->> 'id')::uuid;
select test.login('ai_tl2');
select test.check((ai_studio_report_review(test.hr('m2r'), 'RETURN', 'Add the screens you finished') ->> 'status') = 'RETURNED_BY_TL', 'returned for correction');
select test.check((ai_studio_report_review(test.hr('m2x'), 'REJECT', 'Same work as yesterday') ->> 'status') = 'REJECTED_BY_TL', 'rejected with a reason');
reset role;
select test.check((test.hrow('m2r')).hr_sent_at is null and (test.hrow('m2x')).hr_sent_at is null, 'neither is sent to HR');
select test.check(test.hnotes('ai_tm2a', 'AI_STUDIO_REPORT_REJECTED', test.hr('m2x')) = 1 and test.hnotes('ai_tm2a', 'AI_STUDIO_REPORT_RETURNED', test.hr('m2r')) = 1,
  'the member is told about the return and the rejection');
select test.check(test.hevents(test.hr('m2x'), 'REJECTED') = 1, 'the rejection is in the history');
select test.check(private.perf2_ai_report_state(test.hrow('m2x')) = 'RETURNED', 'Performance Management never counts a rejected report as approved');
set role authenticated;
select test.login('ai_tm2a');
select test.must_fail($$select ai_studio_daily_report_save(test.hr('m2x'), test.hd(-21), '{}'::uuid[], 'x', null, null, null, null, true, p_description => test.words(12))$$,
  'a rejected report cannot be resubmitted', 'already submitted');
select test.login('ai_dh');
select test.must_fail($$select ai_studio_report_review(test.hr('m1'), 'REJECT', 'Not needed today')$$, 'the Department Head no longer decides a report its Team Lead approved (20270306000100)', 'not waiting for your decision');

\echo '   the Team Lead report'
select test.login('ai_tl1');
insert into hp_r select 'l1', (ai_studio_daily_report_save(null, test.hd(-20), '{}'::uuid[], 'Reviewed the team''s work and planned the sprint', null, null, null, 'Team on track', true,
  p_description => 'Reviewed the onboarding screens of my team, approved the reports and planned the next sprint.') ->> 'id')::uuid;
reset role;
select test.check((test.hrow('l1')).status = 'PENDING_DH_APPROVAL' and (test.hrow('l1')).hr_sent_at is not null, 'a Team Lead''s own report goes to the Department Head and to HR');
select test.check(test.hnotes('hrp_viewer', 'AI_STUDIO_REPORT_TO_HR_LEAD', test.hr('l1')) = 1, 'the named HR employee is told a Team Lead report arrived');

\echo '   what the named HR employee sees'
set role authenticated;
select test.login('hrp_viewer');
create temp table hp_v as select ai_studio_hr_performance(test.hd(-30), test.hd(0)) as j;
select test.check((select count(*) = 1 from hp_v, jsonb_array_elements(j -> 'memberReports') x where x ->> 'id' = test.hr('m1')::text
                    and x ->> 'memberName' = 'AI Member 1B' and x ->> 'leadName' = 'AI Lead One' and x ->> 'teamName' = 'AI Lead One''s team'
                    and x ->> 'approvalStatus' = 'APPROVED' and x ->> 'approvedAt' is not null and x ->> 'description' like 'Built the onboarding screens%'
                    and x ->> 'workCompleted' = 'Wrote the onboarding screens' and x ->> 'pendingWork' = 'The tests' and x ->> 'blockers' = 'Waiting for the API keys' and x ->> 'remarks' = 'Good day'),
  'the approved member report, with its team, Team Lead, description, work, pending work, challenges, remarks and approval time');
select test.check((select not exists (select 1 from jsonb_array_elements(j -> 'memberReports') x where x ->> 'id' in (test.hr('m2r')::text, test.hr('m2x')::text, test.hr('m1draft')::text)) from hp_v),
  'returned, rejected and draft reports are not there');
select test.check((select x ->> 'teamName' = 'AI Lead One''s team' and (x ->> 'approvedMemberReports')::int = 1 and (x ->> 'teamMembers')::int >= 2
                     from hp_v, jsonb_array_elements(j -> 'leadReports') x where x ->> 'id' = test.hr('l1')::text),
  'the Team Lead report carries the team''s day from approved member reports only');
select test.check((select exists (select 1 from jsonb_array_elements(j -> 'teams') t, jsonb_array_elements(t -> 'members') m
                                   where t ->> 'leadId' = test.id('ai_tl1')::text and m ->> 'id' = test.id('ai_tm1b')::text) from hp_v)
                  and (select exists (select 1 from jsonb_array_elements(j -> 'teams') t, jsonb_array_elements(t -> 'members') m
                                   where t ->> 'leadId' = test.id('ai_tl2')::text and m ->> 'id' = test.id('ai_tm2a')::text) from hp_v),
  'teams: every Team Lead with their own members');
select test.check((select jsonb_array_length(j -> 'projects') > 0 from hp_v), 'projects with the people on them');
select test.must_fail($$select ai_studio_hr_performance(test.hd(-200), test.hd(0))$$, 'a period of more than 93 days is refused', 'at most 93 days');

\echo '   the Team Lead''s approval is final (20270306000100): the Department Head cannot send it back; a corrected revision is sent to HR once more'
select test.login('ai_dh');
select test.must_fail($$select ai_studio_report_review(test.hr('m1'), 'RETURN', 'Please add the API work')$$, 'the Department Head cannot return a report the Team Lead approved', 'not waiting for your decision');
select test.login('hrp_viewer');
select test.check(exists (select 1 from jsonb_array_elements(ai_studio_hr_performance(test.hd(-30), test.hd(0)) -> 'memberReports') x where x ->> 'id' = test.hr('m1')::text),
  'it stays in HR''s approved list');
-- the report the Team Lead returned: corrected, approved, sent to HR once (revision 2)
select test.login('ai_tm2a');
select ai_studio_daily_report_save(test.hr('m2r'), test.hd(-20), '{}'::uuid[], 'Designed the QR flow and its three screens', null, null, null, null, true,
  p_description => 'Designed the QR code flow for the AIQR studio, finished its three screens and discussed them with the Team Lead.');
select test.login('ai_tl2');
select test.check((ai_studio_report_review(test.hr('m2r'), 'APPROVE') ->> 'status') = 'APPROVED', 'the corrected report is approved by its Team Lead');
reset role;
select test.check((test.hrow('m2r')).hr_sent_revision = 2 and test.hevents(test.hr('m2r'), 'SENT_TO_HR') = 1 and test.hnotes('hrp_viewer', 'AI_STUDIO_REPORT_TO_HR', test.hr('m2r')) = 1,
  'the corrected revision is sent to HR once (one entry and one notification)');

\echo '   taking the access away'
set role authenticated;
select test.login('sa');
select ai_studio_hr_viewer_set(test.id('hrp_viewer'), false);
select test.login('hrp_viewer');
select test.must_fail($$select ai_studio_hr_performance()$$, 'a viewer the Super Admin removed is refused at once', 'FORBIDDEN');
reset role;
select test.check(not exists (select 1 from private.ai_studio_hr_viewer_ids() v where v = test.id('hrp_viewer')), 'and is no longer notified');
select set_config('request.jwt.claims', '', false);
\echo '=== AI STUDIO HR PERFORMANCE TESTS PASSED ==='
