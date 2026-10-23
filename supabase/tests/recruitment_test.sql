-- =============================================================================
-- HR Recruitment Management (migration 20261116000200): candidates, the three separate stages (Pending / Call / Confirmation),
-- history, search and filters, and who may touch any of it (HR staff and the Super Admin only).
-- Runs after the other suites on the same database (it uses the HR head and HR member the HR e-mail suite created).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR recruitment'
reset role;
set role authenticated;

\echo '   access'
select test.login('tm_a');
select test.must_fail($$select hr_recruitment_list()$$, 'a Sales member cannot open the recruitment list', 'FORBIDDEN');
select test.must_fail($$select hr_recruitment_overview()$$, 'nor the overview', 'FORBIDDEN');
select test.must_fail($$select hr_position_save(null, 'Sneaky Role')$$, 'nor add a position', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select hr_recruitment_list()$$, 'a Department Head of another department cannot either', 'FORBIDDEN');
select test.login('hr_head');
select test.must_fail($$insert into hr_candidates (name, email, position_id) values ('Direct Insert', 'direct@example.com', (select id from hr_positions limit 1))$$, 'nobody writes the tables directly', 'permission denied|violates row-level|null value');

\echo '   positions and candidates'
select hr_position_save(null, 'Backend Developer', test.dept('wabastore'), true);
select hr_position_save(null, 'HR Executive', test.dept('hr'), true);
select test.must_fail($$select hr_position_save(null, 'backend developer', test.dept('wabastore'), true)$$, 'a position cannot be added twice', 'already exists');
select test.must_fail($$select hr_candidate_save(null, 'A', 'cand@example.com', null, (select id from hr_positions where title = 'Backend Developer'), null)$$, 'a candidate needs a real name', 'name');
select test.must_fail($$select hr_candidate_save(null, 'Cand Bad', 'not-an-email', null, (select id from hr_positions where title = 'Backend Developer'), null)$$, 'and a valid e-mail', 'valid e-mail');
select test.must_fail($$select hr_candidate_save(null, 'Cand Bad', 'bad@example.com', null, gen_random_uuid(), null)$$, 'and an existing position', 'position');
select test.must_fail($$select hr_candidate_save(null, 'Cand Bad', 'bad@example.com', null, (select id from hr_positions where title = 'Backend Developer'), null, test.id('tm_a')::text)$$, 'the responsible person must be an HR employee', 'HR employee');
select hr_candidate_save(null, 'Rhea Kapoor', 'rhea.k@example.com', '+91 98200 00001', (select id from hr_positions where title = 'Backend Developer'), null, test.id('hrx_tm')::text, 'Referral', 'Strong profile');
select hr_candidate_save(null, 'Sameer Joshi', 'sameer.j@example.com', null, (select id from hr_positions where title = 'HR Executive'), null);
select test.must_fail($$select hr_candidate_save(null, 'Rhea K', 'RHEA.K@example.com', null, (select id from hr_positions where title = 'Backend Developer'), null)$$, 'the same e-mail cannot apply twice for the same position', 'already applied');
select hr_candidate_save(null, 'Rhea Kapoor', 'rhea.k@example.com', null, (select id from hr_positions where title = 'HR Executive'), null);
select test.check((select count(*) = 3 from hr_candidates), 'but the same person can apply for another position');

\echo '   the six columns'
select test.check((select j ->> 'name' = 'Rhea Kapoor' and j ->> 'email' = 'rhea.k@example.com' and j ->> 'position' = 'Backend Developer'
                          and j -> 'pending' ->> 'open' = '0' and j -> 'call' ->> 'nextAt' is null and j -> 'call' -> 'last' = 'null'::jsonb and j -> 'confirmation' ->> 'status' = 'NOT_STARTED'
                     from jsonb_array_elements(hr_recruitment_list('rhea', null, null, null, null, null, 25, 0) -> 'items') j where j ->> 'position' = 'Backend Developer'),
  'a new candidate shows name, e-mail, position and empty Pending / Call / Confirmation (distinct fields)');
-- Pending
select hr_candidate_action_add((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')), 'DOCUMENTS', 'Collect ID proof and degree', current_date - 2);
select hr_candidate_action_add((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')), 'INTERVIEW', 'Technical interview', current_date + 3, test.id('hr_head')::text);
reset role;
select test.check((select count(*) = 1 from notifications where type = 'RECRUITMENT_TASK' and recipient_id = test.id('hrx_tm') and title like '%Collect ID proof%'), 'the responsible HR employee is notified of a pending item (default: the candidate''s owner)');
select test.check((select a.assignee_id = test.id('hr_head') and a.assignee_key = test.id('hr_head')::text from hr_candidate_actions a where a.title = 'Technical interview'), 'an item can be given to a different HR employee');
set role authenticated;
select test.login('hr_head');
select test.check((select j -> 'pending' ->> 'open' = '2' and j -> 'pending' ->> 'overdue' = '1' and j -> 'pending' ->> 'nextDue' = (current_date - 2)::text
                     from jsonb_array_elements(hr_recruitment_list('rhea', null, null, null, null, null, 25, 0) -> 'items') j where j ->> 'position' = 'Backend Developer'),
  'Pending: two open items, one overdue, the earliest due date');
-- Call
select hr_candidate_call_schedule((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')), now() + interval '2 days');
select test.must_fail($$select hr_candidate_call_schedule((select id from hr_candidates where email = 'rhea.k@example.com' limit 1), now() - interval '3 days')$$, 'a call cannot be scheduled in the past', 'not in the past');
select test.check((select j -> 'call' ->> 'nextAt' is not null and j -> 'call' ->> 'total' = '1'
                     from jsonb_array_elements(hr_recruitment_list('rhea', null, null, null, null, null, 25, 0) -> 'items') j where j ->> 'position' = 'Backend Developer'), 'Call: the next scheduled call shows');
select test.check((hr_recruitment_list(null, null, null, null, 'SCHEDULED', null, 25, 0) ->> 'total')::int = 1, 'the "call scheduled" filter finds it');
select hr_candidate_call_record((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')),
  (select id from hr_candidate_calls where called_at is null limit 1), 'CALL_BACK', 'Asked to call after the weekend', current_date + 4);
select test.check((select j -> 'call' -> 'last' ->> 'outcome' = 'CALL_BACK' and (j -> 'call' -> 'last' ->> 'followUpDate')::date = current_date + 4 and j -> 'call' ->> 'nextAt' is null
                     from jsonb_array_elements(hr_recruitment_list('rhea', null, null, null, null, null, 25, 0) -> 'items') j where j ->> 'position' = 'Backend Developer'),
  'recording the call completes it: the last outcome and the follow-up date show, nothing is scheduled any more');
select test.must_fail($$select hr_candidate_call_record((select id from hr_candidates limit 1), null, 'MAYBE')$$, 'an unknown outcome is refused', 'outcome');
-- an overdue follow-up (the date has passed; set directly because the API refuses a date in the past)
reset role;
update hr_candidate_calls set follow_up_date = current_date - 3 where outcome = 'CALL_BACK';
set role authenticated;
select test.login('hr_head');
select test.check((hr_recruitment_list(null, null, null, null, 'FOLLOW_UP_OVERDUE', null, 25, 0) ->> 'total')::int = 1, 'an overdue follow-up is listed under "follow-up overdue"');
select test.check((hr_recruitment_agenda() -> 'overdueFollowUps' -> 0 ->> 'name') = 'Rhea Kapoor' and (hr_recruitment_agenda() -> 'overdueActions' -> 0 ->> 'title') = 'Collect ID proof and degree', 'the agenda shows the overdue follow-up and the overdue item');
select hr_candidate_call_schedule((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')), now() + interval '1 day');
select test.check((hr_recruitment_list(null, null, null, null, 'FOLLOW_UP_OVERDUE', null, 25, 0) ->> 'total')::int = 0, 'scheduling the next call settles the follow-up');
select test.check(jsonb_array_length(hr_recruitment_agenda() -> 'upcomingCalls') = 1, 'and it appears under upcoming calls');
-- Confirmation
select test.must_fail($$select hr_candidate_confirmation_set((select id from hr_candidates limit 1), 'OFFERED', null)$$, 'an offer needs its date', 'date');
select hr_candidate_confirmation_set((select id from hr_candidates where email = 'sameer.j@example.com'), 'CONFIRMED', current_date, 'Joins on 1st');
select test.check((select j -> 'confirmation' ->> 'status' = 'CONFIRMED' and (j -> 'confirmation' ->> 'date')::date = current_date and j -> 'pending' ->> 'open' = '0' and j -> 'call' ->> 'total' = '0'
                     from jsonb_array_elements(hr_recruitment_list('sameer', null, null, null, null, null, 25, 0) -> 'items') j),
  'Confirmation: the status and date show, and it does not touch Pending or Call');

\echo '   search, filters, history'
select test.check((hr_recruitment_list('RHEA', null, null, null, null, null, 25, 0) ->> 'total')::int = 2, 'search by name (any case)');
select test.check((hr_recruitment_list('sameer.j@', null, null, null, null, null, 25, 0) ->> 'total')::int = 1, 'search by e-mail');
select test.check((hr_recruitment_list('%', null, null, null, null, null, 25, 0) ->> 'total')::int = 0, 'a % in the search is text, not a wildcard');
select test.check((hr_recruitment_list(null, (select id from hr_positions where title = 'HR Executive'), null, null, null, null, 25, 0) ->> 'total')::int = 2, 'filter by position');
select test.check((hr_recruitment_list(null, null, 'CONFIRMED', null, null, null, 25, 0) ->> 'total')::int = 1, 'filter by confirmation status');
select test.check((hr_recruitment_list(null, null, null, 'OVERDUE', null, null, 25, 0) ->> 'total')::int = 1 and (hr_recruitment_list(null, null, null, 'OPEN', null, null, 25, 0) ->> 'total')::int = 1 and (hr_recruitment_list(null, null, null, 'NONE', null, null, 25, 0) ->> 'total')::int = 2, 'filter by pending items (overdue / open / none)');
select test.check((hr_recruitment_list(null, null, null, null, null, test.id('hrx_tm')::text, 25, 0) ->> 'total')::int = 1, 'filter by the responsible HR employee');
select test.check((hr_recruitment_list(null, null, null, null, null, null, 1, 0) -> 'items' -> 0 ->> 'name') is not null and jsonb_array_length(hr_recruitment_list(null, null, null, null, null, null, 1, 1) -> 'items') = 1, 'paging');
select test.must_fail($$select hr_recruitment_list(null, null, 'WHATEVER')$$, 'an unknown status filter is refused', 'Unknown');
select test.check((select count(*) >= 6 from jsonb_array_elements(hr_recruitment_get((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer'))) -> 'history')),
  'the candidate''s history records every step (added, pending items, calls)');
select test.check((select jsonb_array_length(h -> 'actions') = 2 and jsonb_array_length(h -> 'calls') = 2 from (select hr_recruitment_get((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer'))) h) x),
  'the detail lists the pending items and the calls');
-- edit and reassign
select hr_candidate_save((select id from hr_candidates where email = 'sameer.j@example.com'), 'Sameer R Joshi', 'sameer.j@example.com', '+91 98200 00002', (select id from hr_positions where title = 'Backend Developer'), null, test.id('hrx_tm')::text, null, null);
select test.check((select j ->> 'name' = 'Sameer R Joshi' and j ->> 'position' = 'Backend Developer' and j ->> 'owner' is not null
                     from jsonb_array_elements(hr_recruitment_list('sameer', null, null, null, null, null, 25, 0) -> 'items') j), 'an edit changes the name, the position and the responsible person');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_recruitment_get((select id from hr_candidates where email = 'sameer.j@example.com')) -> 'history') e where e ->> 'summary' like 'Updated:%position%'), 'and is written to the history');
-- closing a pending item
select hr_candidate_action_close((select id from hr_candidate_actions where title = 'Collect ID proof and degree'), true, 'Received');
select test.must_fail($$select hr_candidate_action_close((select id from hr_candidate_actions where title = 'Collect ID proof and degree'), true)$$, 'a closed item cannot be closed again', 'already closed');
select test.check((hr_recruitment_overview() ->> 'overdueActions')::int = 0 and (hr_recruitment_overview() ->> 'confirmed')::int = 1 and (hr_recruitment_overview() ->> 'candidates')::int = 3 and (hr_recruitment_overview() ->> 'withPending')::int = 1,
  'the overview counts what is real: candidates, pending, overdue, confirmed');

\echo '   the dropdowns read the real records'
-- positions: the ones HR added + every designation already in the employee records
select test.check((select count(*) filter (where x ->> 'source' = 'POSITION') = 2 and count(*) filter (where x ->> 'source' = 'EMPLOYEES') >= 2
                          and bool_and(x ->> 'title' not in ('Backend Developer', 'HR Executive') or x ->> 'source' = 'POSITION')
                     from jsonb_array_elements(hr_positions_list()) x),
  'positions: the added ones plus the designations of the employee records, without repeating one that is already a position');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_positions_list()) x where x ->> 'title' = 'Office Assistant' and x ->> 'source' = 'EMPLOYEES' and (x ->> 'employees')::int >= 1),
  'a designation from the HR directory is offered as a position');
-- choosing such a designation makes it a position (no second list to keep in step)
select hr_candidate_save(null, 'Dev Menon', 'dev.m@example.com', null, null, 'Office Assistant');
select test.check((select count(*) = 1 from hr_positions where title = 'Office Assistant') and (select count(*) = 0 from jsonb_array_elements(hr_positions_list()) x where x ->> 'title' = 'Office Assistant' and x ->> 'source' = 'EMPLOYEES'),
  'choosing it creates the position once and it is no longer listed twice');
select hr_candidate_save(null, 'Dev Menon Two', 'dev.m2@example.com', null, null, 'office assistant');
select test.check((select count(*) = 1 from hr_positions where lower(title) = 'office assistant'), 'the same designation in another capitalisation reuses the position');
select test.must_fail($$select hr_candidate_save(null, 'No Position', 'np@example.com', null, null, null)$$, 'a position is required', 'position');
-- a new designation appears by itself
reset role;
update hr_employees set designation = 'Growth Marketer' where id = 'HR-EMP-9001';
set role authenticated;
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_positions_list()) x where x ->> 'title' = 'Growth Marketer'), 'a newly given designation appears without any code change');
-- responsible HR employee: every active employee of the HR department in the HR directory
select test.check((select count(*) >= 3 and bool_or(x ->> 'name' = 'HR Head') and bool_or(x ->> 'name' = 'HR Only Person' and (x ->> 'hasLogin')::boolean = false) and bool_or(x ->> 'name' = 'HRX Member')
                     from jsonb_array_elements(hr_recruiters()) x),
  'HR employees: those with a CRM login and the HR-directory ones without');
select test.check(not exists (select 1 from jsonb_array_elements(hr_recruiters()) x where x ->> 'name' in ('Member A', 'DH Wabastore', 'Root')), 'and nobody from another department, and not the Super Admin');
select hr_candidate_save(null, 'Isha Rao', 'isha.r@example.com', null, (select id from hr_positions where title = 'Backend Developer'), null, 'HR:HR-EMP-9001');
select test.check((select j ->> 'owner' = 'HR Only Person' and j ->> 'ownerKey' = 'HR:HR-EMP-9001' and j ->> 'ownerId' is null
                     from jsonb_array_elements(hr_recruitment_list('isha', null, null, null, null, null, 25, 0) -> 'items') j),
  'an HR employee without a login can be the responsible person (recorded by employee key and name)');
select test.check((hr_recruitment_list(null, null, null, null, null, 'HR:HR-EMP-9001', 25, 0) ->> 'total')::int = 1, 'and the candidates can be filtered by them');
select hr_candidate_action_add((select id from hr_candidates where email = 'isha.r@example.com'), 'DOCUMENTS', 'Collect documents', current_date + 2);
select test.check((select a.assignee_key = 'HR:HR-EMP-9001' and a.assignee_id is null and a.assignee_name = 'HR Only Person' from hr_candidate_actions a where a.title = 'Collect documents'), 'a pending item defaults to the responsible person');
select test.must_fail($$select hr_candidate_save(null, 'Bad Owner', 'bo@example.com', null, (select id from hr_positions where title = 'Backend Developer'), null, 'not-a-key')$$, 'an unknown employee key is refused', 'HR employee');
select test.must_fail($$select hr_candidate_save(null, 'Bad Owner', 'bo@example.com', null, (select id from hr_positions where title = 'Backend Developer'), null, test.id('tm_a')::text)$$, 'an employee of another department is refused', 'HR employee');
select test.check((select count(*) = 0 from notifications where type = 'RECRUITMENT_ASSIGNED' and title like '%Isha Rao%'), 'an employee without a login is recorded but there is nobody to notify');
-- a newly created HR employee appears automatically
reset role;
update hr_employees set designation = 'Office Assistant' where id = 'HR-EMP-9001';
select test.create_auth_user('rec_new_hr', 'rec.new.hr@amuwa.com', '{"full_name":"New HR Recruiter"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
set role authenticated;
select test.login('hr_head');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_recruiters()) x where x ->> 'name' = 'New HR Recruiter' and (x ->> 'hasLogin')::boolean), 'a newly created HR employee appears in the list by itself');
select test.login('hrx_tm');
select test.check((hr_recruitment_list(null, null, null, null, null, null, 25, 0) ->> 'total')::int = 6, 'another HR employee sees the same records (they are shared)');
select test.check(jsonb_array_length(hr_recruiters()) >= 2, 'the list of HR employees to assign to comes from the HR department');
select test.login('sa');
select test.check((hr_recruitment_list(null, null, null, null, null, null, 25, 0) ->> 'total')::int = 6, 'the Super Admin can read them');
reset role;
set role anon;
select test.must_fail($$select hr_recruitment_list()$$, 'a signed-out visitor cannot', 'permission denied');
reset role;
\echo '=== ALL HR RECRUITMENT TESTS PASSED ==='
