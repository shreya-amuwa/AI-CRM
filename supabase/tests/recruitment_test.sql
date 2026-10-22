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
select test.must_fail($$select hr_candidate_save(null, 'A', 'cand@example.com', null, (select id from hr_positions where title = 'Backend Developer'))$$, 'a candidate needs a real name', 'name');
select test.must_fail($$select hr_candidate_save(null, 'Cand Bad', 'not-an-email', null, (select id from hr_positions where title = 'Backend Developer'))$$, 'and a valid e-mail', 'valid e-mail');
select test.must_fail($$select hr_candidate_save(null, 'Cand Bad', 'bad@example.com', null, gen_random_uuid())$$, 'and an existing position', 'position');
select test.must_fail($$select hr_candidate_save(null, 'Cand Bad', 'bad@example.com', null, (select id from hr_positions where title = 'Backend Developer'), test.id('tm_a'))$$, 'the responsible person must be an HR employee', 'HR employee');
select hr_candidate_save(null, 'Rhea Kapoor', 'rhea.k@example.com', '+91 98200 00001', (select id from hr_positions where title = 'Backend Developer'), test.id('hrx_tm'), 'Referral', 'Strong profile');
select hr_candidate_save(null, 'Sameer Joshi', 'sameer.j@example.com', null, (select id from hr_positions where title = 'HR Executive'));
select test.must_fail($$select hr_candidate_save(null, 'Rhea K', 'RHEA.K@example.com', null, (select id from hr_positions where title = 'Backend Developer'))$$, 'the same e-mail cannot apply twice for the same position', 'already applied');
select hr_candidate_save(null, 'Rhea Kapoor', 'rhea.k@example.com', null, (select id from hr_positions where title = 'HR Executive'));
select test.check((select count(*) = 3 from hr_candidates), 'but the same person can apply for another position');

\echo '   the six columns'
select test.check((select j ->> 'name' = 'Rhea Kapoor' and j ->> 'email' = 'rhea.k@example.com' and j ->> 'position' = 'Backend Developer'
                          and j -> 'pending' ->> 'open' = '0' and j -> 'call' ->> 'nextAt' is null and j -> 'call' -> 'last' = 'null'::jsonb and j -> 'confirmation' ->> 'status' = 'NOT_STARTED'
                     from jsonb_array_elements(hr_recruitment_list('rhea', null, null, null, null, null, 25, 0) -> 'items') j where j ->> 'position' = 'Backend Developer'),
  'a new candidate shows name, e-mail, position and empty Pending / Call / Confirmation (distinct fields)');
-- Pending
select hr_candidate_action_add((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')), 'DOCUMENTS', 'Collect ID proof and degree', current_date - 2);
select hr_candidate_action_add((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer')), 'INTERVIEW', 'Technical interview', current_date + 3, test.id('hr_head'));
reset role;
select test.check((select count(*) = 1 from notifications where type = 'RECRUITMENT_TASK' and recipient_id = test.id('hrx_tm') and title like '%Collect ID proof%'), 'the responsible HR employee is notified of a pending item (default: the candidate''s owner)');
select test.check((select a.assignee_id = test.id('hr_head') from hr_candidate_actions a where a.title = 'Technical interview'), 'an item can be given to a different HR employee');
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
select test.check((hr_recruitment_list(null, null, null, null, null, test.id('hrx_tm'), 25, 0) ->> 'total')::int = 1, 'filter by the responsible HR employee');
select test.check((hr_recruitment_list(null, null, null, null, null, null, 1, 0) -> 'items' -> 0 ->> 'name') is not null and jsonb_array_length(hr_recruitment_list(null, null, null, null, null, null, 1, 1) -> 'items') = 1, 'paging');
select test.must_fail($$select hr_recruitment_list(null, null, 'WHATEVER')$$, 'an unknown status filter is refused', 'Unknown');
select test.check((select count(*) >= 6 from jsonb_array_elements(hr_recruitment_get((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer'))) -> 'history')),
  'the candidate''s history records every step (added, pending items, calls)');
select test.check((select jsonb_array_length(h -> 'actions') = 2 and jsonb_array_length(h -> 'calls') = 2 from (select hr_recruitment_get((select id from hr_candidates where email = 'rhea.k@example.com' and position_id = (select id from hr_positions where title = 'Backend Developer'))) h) x),
  'the detail lists the pending items and the calls');
-- edit and reassign
select hr_candidate_save((select id from hr_candidates where email = 'sameer.j@example.com'), 'Sameer R Joshi', 'sameer.j@example.com', '+91 98200 00002', (select id from hr_positions where title = 'Backend Developer'), test.id('hrx_tm'), null, null);
select test.check((select j ->> 'name' = 'Sameer R Joshi' and j ->> 'position' = 'Backend Developer' and j ->> 'owner' is not null
                     from jsonb_array_elements(hr_recruitment_list('sameer', null, null, null, null, null, 25, 0) -> 'items') j), 'an edit changes the name, the position and the responsible person');
select test.check((select count(*) = 1 from jsonb_array_elements(hr_recruitment_get((select id from hr_candidates where email = 'sameer.j@example.com')) -> 'history') e where e ->> 'summary' like 'Updated:%position%'), 'and is written to the history');
-- closing a pending item
select hr_candidate_action_close((select id from hr_candidate_actions where title = 'Collect ID proof and degree'), true, 'Received');
select test.must_fail($$select hr_candidate_action_close((select id from hr_candidate_actions where title = 'Collect ID proof and degree'), true)$$, 'a closed item cannot be closed again', 'already closed');
select test.check((hr_recruitment_overview() ->> 'overdueActions')::int = 0 and (hr_recruitment_overview() ->> 'confirmed')::int = 1 and (hr_recruitment_overview() ->> 'candidates')::int = 3 and (hr_recruitment_overview() ->> 'withPending')::int = 1,
  'the overview counts what is real: candidates, pending, overdue, confirmed');
select test.login('hrx_tm');
select test.check((hr_recruitment_list(null, null, null, null, null, null, 25, 0) ->> 'total')::int = 3, 'another HR employee sees the same records (they are shared)');
select test.check(jsonb_array_length(hr_recruiters()) >= 2, 'the list of HR employees to assign to comes from the HR department');
select test.login('sa');
select test.check((hr_recruitment_list(null, null, null, null, null, null, 25, 0) ->> 'total')::int = 3, 'the Super Admin can read them');
reset role;
set role anon;
select test.must_fail($$select hr_recruitment_list()$$, 'a signed-out visitor cannot', 'permission denied');
reset role;
\echo '=== ALL HR RECRUITMENT TESTS PASSED ==='
