-- =============================================================================
-- HR Awards (migration 20270203000100): seven monthly awards; HR adds any number of nominees (employee, team or department from the CRM),
-- edits and removes them, declares one or more winners and revokes a declaration; every month is kept separately.
-- Only HR staff (not HR Recruiters) and the Super Admin. Runs after hr_documents_test.sql (hrd_rec) and employee_issues_test.sql (iss_hr_tm).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- HR Awards'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270203000100_hr_awards.sql
\i supabase/migrations/20270203000100_hr_awards.sql
create temp table aw (k text primary key, v jsonb);
grant all on aw to authenticated;
create or replace function test.aw_nominee(p_detail jsonb, p_name text) returns uuid language sql immutable as $$
  select (x ->> 'id')::uuid from jsonb_array_elements(p_detail -> 'nominees') x where x ->> 'name' = p_name limit 1 $$;
create or replace function test.aw_name(p_user text) returns text language sql stable security definer set search_path = '' as $$
  select full_name from public.profiles where id = test.id(p_user) $$;
-- teams and departments are resolved here (as the owner): row-level security hides another department's teams from an HR login
insert into aw values ('team_sales', to_jsonb(test.team('wabastore', 'Sales'))), ('dept_wab', to_jsonb(test.dept('wabastore'))), ('dept_wbx', to_jsonb(test.dept('whatsbox')));
create or replace function test.aw_id(p_key text) returns uuid language sql stable security definer set search_path = '' as $$
  select (v #>> '{}')::uuid from pg_temp.aw where k = p_key $$;
grant execute on all functions in schema test to anon, authenticated;

select test.check((select count(*) = 7 from hr_award_categories where is_active), 'the seven awards are seeded');
select test.check((select array_agg(name order by sort_order) from hr_award_categories) = array[
  'Professionalism Excellence of the Month', 'Rising Star of the Month', 'Player of the Month', 'Emerging Leader of the Month',
  'Department of the Month', 'Team of the Month', 'Business Icon of the Month'], 'names and order as asked');

\echo '   who may manage awards'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select hr_awards_overview(date '2026-11-01')$$, 'a Team Member cannot read awards', 'FORBIDDEN');
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('tm_a'), 'I nominate myself')$$, 'nor nominate', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select hr_award_options()$$, 'a Department Head outside HR cannot', 'FORBIDDEN');
select test.login('hrd_rec');
select test.must_fail($$select hr_awards_overview(date '2026-11-01')$$, 'an HR Recruiter cannot', 'FORBIDDEN');
select test.must_fail($$select * from hr_award_nominees$$, 'nobody reads the tables directly', 'permission denied');
select test.must_fail($$insert into hr_award_periods (category_code, period_month) values ('PLAYER', date '2026-11-01')$$, 'nor writes them', 'permission denied');

\echo '   overview and options'
select test.login('hr_head');
select test.check((select jsonb_array_length(v -> 'awards') = 7 and v ->> 'month' = '2026-11' and v ->> 'monthLabel' = 'November 2026'
                          and (select bool_and(a ->> 'status' = 'NO_NOMINEES' and (a ->> 'nominees')::int = 0) from jsonb_array_elements(v -> 'awards') a)
                     from (select hr_awards_overview(date '2026-11-15') as v) s), 'HR sees the seven award cards of the month, empty');
select test.check((select jsonb_array_length(v -> 'employees') >= 3 and jsonb_array_length(v -> 'teams') >= 1 and jsonb_array_length(v -> 'departments') >= 2
                          and not exists (select 1 from jsonb_array_elements(v -> 'employees') e where (e ->> 'id')::uuid = test.id('sa'))
                     from (select hr_award_options() as v) s), 'options: employees (not the Super Admin), teams, departments');

\echo '   multiple nominees under one award'
insert into aw select 'n1', hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('tm_a'), 'Closed the most tickets', 'Great attitude');
insert into aw select 'n2', hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('th_wab'), 'Mentored two new joiners');
insert into aw select 'n3', hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('dh_wab'), 'Launched the new pipeline');
select test.login('iss_hr_tm');
insert into aw select 'n4', hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('hrd_rec'), 'Hired ten people this month');
select test.check((select (v ->> 'totalNominees')::int = 4 and v ->> 'status' = 'NOMINATIONS_OPEN' and jsonb_array_length(v -> 'winners') = 0
                     from aw where k = 'n4'), 'four nominees for Rising Star – November 2026, an HR team member added one');
select test.check((select x ->> 'name' = test.aw_name('tm_a') and x ->> 'departmentName' is not null and x ->> 'teamName' is not null
                          and x ->> 'reason' = 'Closed the most tickets' and x ->> 'remarks' = 'Great attitude' and x ->> 'status' = 'NOMINATED'
                          and x ->> 'nominatedAt' is not null and x ->> 'nominatedBy' = test.aw_name('hr_head')
                     from aw, jsonb_array_elements(v -> 'nominees') x where k = 'n4' and (x ->> 'profileId')::uuid = test.id('tm_a')),
  'the nominee carries name, department, team, reason, remarks, date and who nominated (from the CRM, not typed)');

\echo '   validation and duplicates'
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('tm_a'), 'Again')$$,
  'the same employee twice for the same award and month', 'CONFLICT: .* is already nominated for Rising Star of the Month – November 2026');
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('sa'), 'The owner')$$, 'not the Super Admin', 'NOT_FOUND');
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2026-11-01', 'TEAM', test.aw_id('team_sales'), 'A team')$$,
  'an individual award takes individuals', 'VALIDATION_ERROR: Rising Star of the Month takes individual nominees');
select test.must_fail($$select hr_award_nominate('TEAM', date '2026-11-01', 'INDIVIDUAL', test.id('tm_a'), 'A person')$$,
  'Team of the Month takes teams', 'VALIDATION_ERROR');
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('th_wbx'), ' ')$$, 'a reason is required', 'VALIDATION_ERROR: Enter the reason');
select test.must_fail($$select hr_award_nominate('NOPE', date '2026-11-01', 'INDIVIDUAL', test.id('th_wbx'), 'Reason')$$, 'an unknown award', 'NOT_FOUND');
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2019-12-01', 'INDIVIDUAL', test.id('th_wbx'), 'Reason')$$, 'a month out of range', 'VALIDATION_ERROR');
select test.must_fail($$select hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', gen_random_uuid(), 'Reason')$$, 'an unknown employee', 'NOT_FOUND');

\echo '   team and department awards'
select test.check((select (v ->> 'totalNominees')::int = 1 and v -> 'nominees' -> 0 ->> 'nomineeType' = 'TEAM' and v -> 'nominees' -> 0 ->> 'name' = 'Sales'
                     from (select hr_award_nominate('TEAM', date '2026-11-01', 'TEAM', test.aw_id('team_sales'), 'Best quarter ever') as v) s),
  'Team of the Month: a team is nominated');
insert into aw select 'd1', hr_award_nominate('DEPARTMENT', date '2026-11-01', 'DEPARTMENT', test.aw_id('dept_wab'), 'Top revenue');
insert into aw select 'd2', hr_award_nominate('DEPARTMENT', date '2026-11-01', 'DEPARTMENT', test.aw_id('dept_wbx'), 'Top retention');
select test.check((select (hr_award_detail('DEPARTMENT', date '2026-11-01') ->> 'totalNominees')::int = 2), 'Department of the Month has two department nominees');

\echo '   edit and remove nominees'
select test.check((select x ->> 'reason' = 'Mentored three new joiners' and x ->> 'remarks' = 'Updated' and x ->> 'updatedBy' = test.aw_name('iss_hr_tm')
                     from (select hr_award_update_nominee(test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('th_wab')), 'Mentored three new joiners', 'Updated') as v) s,
                          jsonb_array_elements(v -> 'nominees') x where (x ->> 'profileId')::uuid = test.id('th_wab')), 'HR edits a nomination');
select test.must_fail($$select hr_award_update_nominee(test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('th_wab')), 'x')$$, 'the edit is validated too', 'VALIDATION_ERROR');
insert into aw select 'rm', hr_award_remove_nominee(test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('hrd_rec')), 'Nominated by mistake');
select test.check((select (v ->> 'totalNominees')::int = 3 and (v ->> 'removedNominees')::int = 1 from aw where k = 'rm'), 'HR removes a nominee (kept on record)');
reset role;
select test.check((select status = 'REMOVED' and removed_by = test.id('iss_hr_tm') and removed_reason = 'Nominated by mistake' and removed_at is not null
                     from hr_award_nominees where profile_id = test.id('hrd_rec') and reason = 'Hired ten people this month'), 'the removed nomination stays in the table');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_award_remove_nominee(test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('hrd_rec')))$$, 'removing twice', 'NOT_FOUND');
select test.check((select (v ->> 'totalNominees')::int = 4
                     from (select hr_award_nominate('RISING_STAR', date '2026-11-01', 'INDIVIDUAL', test.id('hrd_rec'), 'Nominated again properly') as v) s),
  'a removed nominee can be nominated again');

\echo '   one winner, then several winners'
insert into aw select 'w1', hr_award_declare_winners(array[test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('tm_a'))], 'Unanimous');
select test.check((select (v ->> 'totalWinners')::int = 1 and v ->> 'status' = 'WINNERS_DECLARED' and v -> 'winners' -> 0 ->> 'name' = test.aw_name('tm_a')
                          and v -> 'winners' -> 0 ->> 'remarks' = 'Unanimous' and v -> 'winners' -> 0 ->> 'declaredAt' is not null
                          and v -> 'winners' -> 0 ->> 'declaredBy' = test.aw_name('hr_head') and (v ->> 'totalNominees')::int = 4
                     from aw where k = 'w1'), 'a single winner is declared; the nominees stay nominees');
insert into aw select 'w2', hr_award_declare_winners(array[test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('tm_a')),
                                                         test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('dh_wab'))], 'Joint winners');
select test.check((select (v ->> 'totalWinners')::int = 2 and (v ->> 'totalNominees')::int = 4
                          and (select count(*) from jsonb_array_elements(v -> 'nominees') x where x ->> 'status' = 'WINNER') = 2
                          and (select count(*) from jsonb_array_elements(v -> 'nominees') x where x ->> 'status' = 'NOMINATED') = 2
                          and (select array_agg(x ->> 'name' order by x ->> 'name') from jsonb_array_elements(v -> 'winners') x)
                              = (select array_agg(n order by n) from unnest(array[test.aw_name('tm_a'), test.aw_name('dh_wab')]) n)
                     from aw where k = 'w2'), 'two winners for the same award; not every nominee; the first declaration is not repeated');
reset role;
select test.check((select count(*) = 2 from hr_award_winners w join hr_award_nominees n on n.id = w.nominee_id
                    where n.reason in ('Closed the most tickets', 'Launched the new pipeline') and w.revoked_at is null), 'two winner rows, stored separately');
select test.check((select count(*) = 2 from audit_logs where action = 'HR_AWARD_WINNER_DECLARED' and actor_id = test.id('hr_head')), 'each declaration is audited');
select test.check((select count(*) >= 7 from audit_logs where action = 'HR_AWARD_NOMINATED'), 'nominations are audited');
set role authenticated;
select test.login('hr_head');
select test.must_fail($$select hr_award_declare_winners(array[gen_random_uuid()])$$, 'nominees must exist', 'NOT_FOUND');
select test.must_fail($$select hr_award_declare_winners(array[test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('tm_a')),
                                                            (hr_award_detail('TEAM', date '2026-11-01') -> 'nominees' -> 0 ->> 'id')::uuid])$$,
  'winners of one award and month at a time', 'VALIDATION_ERROR: Declare winners of one award');
select test.must_fail($$select hr_award_declare_winners('{}')$$, 'at least one nominee', 'VALIDATION_ERROR');
select test.must_fail($$select hr_award_remove_nominee(test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('tm_a')))$$,
  'a declared winner cannot be removed before the declaration is revoked', 'CONFLICT: .* Revoke the winner declaration first');

\echo '   change and revoke a winner'
select test.check((select v -> 'winners' -> 0 ->> 'remarks' = 'Outstanding month'
                     from (select hr_award_update_winner((select (v -> 'winners' -> 0 ->> 'id')::uuid from aw where k = 'w2'), 'Outstanding month') as v) s),
  'winner remarks can be changed');
select test.must_fail($$select hr_award_revoke_winner((select (v -> 'winners' -> 1 ->> 'id')::uuid from aw where k = 'w2'), '')$$, 'revoking needs a reason', 'VALIDATION_ERROR');
insert into aw select 'rv', hr_award_revoke_winner((select (x ->> 'id')::uuid from aw, jsonb_array_elements(v -> 'winners') x where k = 'w2' and x ->> 'name' = test.aw_name('dh_wab')), 'Declared by mistake');
select test.check((select (v ->> 'totalWinners')::int = 1 and jsonb_array_length(v -> 'revokedWinners') = 1
                          and v -> 'revokedWinners' -> 0 ->> 'revokeReason' = 'Declared by mistake' and (v ->> 'totalNominees')::int = 4
                     from aw where k = 'rv'), 'revoked: one winner left, the revoked declaration kept on record, still a nominee');
select test.must_fail($$select hr_award_revoke_winner((select (v -> 'revokedWinners' -> 0 ->> 'id')::uuid from aw where k = 'rv'), 'Again')$$, 'revoking twice', 'NOT_FOUND');
select test.check((select (v ->> 'totalWinners')::int = 2
                     from (select hr_award_declare_winners(array[test.aw_nominee((select v from aw where k = 'n4'), test.aw_name('dh_wab'))]) as v) s),
  'a revoked winner can be declared again');

\echo '   month-wise records'
select test.check((select (v ->> 'totalNominees')::int = 0 and v ->> 'status' = 'NO_NOMINEES' from (select hr_award_detail('RISING_STAR', date '2026-12-01') as v) s),
  'December 2026 starts empty for the same award');
select test.check((select (v ->> 'totalNominees')::int = 1
                     from (select hr_award_nominate('RISING_STAR', date '2026-12-01', 'INDIVIDUAL', test.id('tm_a'), 'Another great month') as v) s),
  'the same employee can be nominated for the same award in another month');
select test.check((select (v ->> 'totalWinners')::int = 1
                     from (select hr_award_declare_winners(array[(hr_award_detail('RISING_STAR', date '2026-12-01') -> 'nominees' -> 0 ->> 'id')::uuid]) as v) s),
  'and win December too');
select test.check((select (v ->> 'totalNominees')::int = 4 and (v ->> 'totalWinners')::int = 2 from (select hr_award_detail('RISING_STAR', date '2026-11-01') as v) s),
  'November 2026 is unchanged by December');
select test.check((select a ->> 'status' = 'WINNERS_DECLARED' and (a ->> 'nominees')::int = 4 and (a ->> 'winners')::int = 2 and jsonb_array_length(a -> 'winnerNames') = 2
                     from jsonb_array_elements(hr_awards_overview(date '2026-11-01') -> 'awards') a where a ->> 'code' = 'RISING_STAR'), 'the November card: 4 nominees, 2 winners');
select test.check((select jsonb_agg(h ->> 'month') @> '["2026-12", "2026-11"]'::jsonb from jsonb_array_elements(hr_awards_overview(date '2026-12-01') -> 'history') h),
  'the history lists both months');

\echo '   the Super Admin'
select test.login('sa');
select test.check((select (hr_award_detail('RISING_STAR', date '2026-11-01') ->> 'totalWinners')::int = 2), 'the Super Admin reads awards');

select test.login('tm_a');
select test.must_fail($$select hr_award_declare_winners(array[(select (v -> 'nominees' -> 0 ->> 'id')::uuid from aw where k = 'n4')])$$, 'a Team Member cannot declare winners', 'FORBIDDEN');
select test.must_fail($$select hr_award_revoke_winner((select (v -> 'winners' -> 0 ->> 'id')::uuid from aw where k = 'w2'), 'Not allowed')$$, 'nor revoke', 'FORBIDDEN');
select test.must_fail($$select hr_award_remove_nominee((select (v -> 'nominees' -> 1 ->> 'id')::uuid from aw where k = 'n4'))$$, 'nor remove', 'FORBIDDEN');
select test.must_fail($$select hr_award_update_nominee((select (v -> 'nominees' -> 1 ->> 'id')::uuid from aw where k = 'n4'), 'Changed reason')$$, 'nor edit', 'FORBIDDEN');
reset role;
select set_config('request.jwt.claims', '', false);
\echo '   HR Awards: all checks passed'
