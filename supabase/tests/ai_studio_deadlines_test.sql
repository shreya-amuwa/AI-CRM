-- =============================================================================
-- AI Studio project deadlines (migration 20270119000100): who sets a deadline, who sees the clock, who is told, and what is refused.
-- Runs right after ai_studio_test.sql and reuses its people: the Super Admin 'sa', ai_dh (Department Head), ai_tl1 / ai_tl2 (Team Leads), ai_tm1a
-- (a member of tl1) and ai_tm2a (a member of tl2), and the Wabastore Department Head dh_wab for the "another department" case.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 131. AI Studio: project deadlines and the clock'
reset role;
\i supabase/migrations/20270119000100_ai_studio_project_deadlines.sql
\i supabase/migrations/20270119000100_ai_studio_project_deadlines.sql

create or replace function test.sq2(p_sql text) returns text language plpgsql security definer as $$
declare v text; begin execute p_sql into v; return v; end $$;
grant execute on function test.sq2(text) to anon, authenticated;
create temp table dl (k text primary key, v uuid);
grant all on dl to authenticated;
-- the project table has no grants for the app roles: the checks read it through these (as the table owner)
create or replace function test.dl_at(p uuid) returns timestamptz language sql stable security definer as $$ select deadline_at from public.ai_studio_projects where id = p $$;
create or replace function test.dl_name(p uuid) returns text language sql stable security definer as $$ select name || '|' || status from public.ai_studio_projects where id = p $$;
create or replace function test.dl_count(p text) returns bigint language sql stable security definer as $$ select count(*) from public.ai_studio_projects where name = p $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   1. The Super Admin sets a deadline when adding a project'
set role authenticated;
select test.login('sa');
insert into dl select 'p', (ai_studio_project_save_with_deadline(null, 'DL Alpha', 'Deadline test', null, now() + interval '3 days') ->> 'id')::uuid;
select test.check((select (p ->> 'deadlineAt') is not null from jsonb_array_elements(ai_studio_projects_list()) p where p ->> 'name' = 'DL Alpha'), 'the project list carries the deadline');
select test.check((select (x ->> 'deadlineAt')::timestamptz between now() + interval '2 days 23 hours' and now() + interval '3 days 1 hour' and x ->> 'status' = 'ACTIVE'
                     from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'the clock lists it with its moment');
select test.check(abs(extract(epoch from (ai_studio_deadlines() ->> 'serverNow')::timestamptz - now())) < 5, 'and the server''s own time, so every browser counts to the same moment');
insert into dl select 'none', (ai_studio_project_save(null, 'DL No Deadline', null, null) ->> 'id')::uuid;
select test.check((select count(*) = 0 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL No Deadline'), 'a project without a deadline is not on the clock');
select test.check((select (p ->> 'deadlineAt') is null from jsonb_array_elements(ai_studio_projects_list()) p where p ->> 'name' = 'DL No Deadline'), 'its deadline is empty, not zero');

\echo '   2. Only the people on a project see its clock'
select ai_studio_project_assign((select v from dl where k = 'p'), test.id('ai_tl1'), true);
select ai_studio_project_assign((select v from dl where k = 'p'), test.id('ai_tm1a'), true);
select test.login('ai_tl1');
select test.check((select count(*) = 1 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha' and (x ->> 'mine')::boolean), 'a Team Lead on the project sees it');
select test.login('ai_tm1a');
select test.check((select count(*) = 1 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'a Team Member on the project sees it');
select test.login('ai_tl2');
select test.check((select count(*) = 0 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'another Team Lead, not on it, does not');
select test.check((select count(*) = 0 from jsonb_array_elements(ai_studio_projects_list()) p where p ->> 'name' = 'DL Alpha'), 'and does not see the project either');
select test.login('ai_tm2a');
select test.check((select count(*) = 0 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'nor a member of that other lead');
select test.login('ai_dh');
select test.check((select count(*) = 1 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'the Department Head sees every project''s clock');
select test.login('sa');
select test.check((select count(*) = 1 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'and so does the Super Admin');

\echo '   3. Nobody else sets, changes or clears a deadline'
select test.login('ai_tl1');
select test.must_fail(format($$select ai_studio_project_save_with_deadline('%s', 'DL Alpha', null, null, now() + interval '9 days')$$, (select v from dl where k = 'p')), 'a Team Lead cannot move the deadline', 'only for the people of AI Studio|FORBIDDEN');
select test.login('ai_tm1a');
select test.must_fail(format($$select ai_studio_project_save_with_deadline('%s', 'DL Alpha', null, null, null)$$, (select v from dl where k = 'p')), 'a Team Member cannot clear it', 'only for the people of AI Studio|FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select ai_studio_deadlines()$$, 'another department''s head gets no clock', 'AI Studio');
select test.must_fail($$select ai_studio_project_save_with_deadline(null, 'DL Other', null, null, now() + interval '2 days')$$, 'nor a project', 'AI Studio');
reset role;
set role anon;
select test.must_fail($$select ai_studio_deadlines()$$, 'a visitor gets nothing', 'permission denied');
reset role;
select test.check((select deadline_at is not null and deadline_at > now() from ai_studio_projects where id = (select v from dl where k = 'p')), 'every refusal left the deadline as it was');

\echo '   4. What is refused'
set role authenticated;
select test.login('sa');
select test.must_fail($$select ai_studio_project_save_with_deadline(null, 'DL Past', null, null, now() - interval '1 hour')$$, 'a deadline in the past', 'future');
select test.must_fail($$select ai_studio_project_save_with_deadline(null, 'DL Far', null, null, now() + interval '6 years')$$, 'a deadline years away', 'too far');
select test.check((test.dl_count('DL Past') + test.dl_count('DL Far') = 0), 'neither project was created');

\echo '   5. Changing the deadline tells the people on the project, once, and is audited'
reset role;
delete from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE';
set role authenticated;
select test.login('sa');
select ai_studio_project_save_with_deadline((select v from dl where k = 'p'), 'DL Alpha', 'Deadline test', null, now() + interval '10 days');
select test.check(test.sq2($q$select count(*) = 1 from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE' and recipient_id = test.id('ai_tl1') and entity_type = 'ai_studio_project'$q$)::boolean
                  and test.sq2($q$select count(*) = 1 from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE' and recipient_id = test.id('ai_tm1a')$q$)::boolean, 'the Team Lead and the Team Member on the project are told');
select test.check(test.sq2($q$select count(*) = 0 from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE' and recipient_id in (test.id('sa'), test.id('ai_tl2'), test.id('ai_tm2a'))$q$)::boolean, 'not the person who changed it, and not people who are not on the project');
-- one entry when the deadline was set with the new project, one for this change (with the old moment in it)
select test.check(test.sq2($q$select count(*) = 2 and count(*) filter (where metadata ->> 'before' is not null and metadata ->> 'after' is not null) = 1
                                  from audit_logs where action = 'AI_STUDIO_PROJECT_DEADLINE' and entity_id = (select v from dl where k = 'p')$q$)::boolean, 'it is audited with the old and the new moment');
-- the same moment again, and an edit that does not touch the deadline, tell nobody
select ai_studio_project_save_with_deadline((select v from dl where k = 'p'), 'DL Alpha', 'Deadline test', null, test.dl_at((select v from dl where k = 'p')));
select ai_studio_project_save((select v from dl where k = 'p'), 'DL Alpha', 'A new description', null);
select test.check(test.sq2($q$select count(*) = 1 from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE' and recipient_id = test.id('ai_tm1a')$q$)::boolean, 'saving without a change is silent (still one notification)');
select test.check((test.dl_at((select v from dl where k = 'p')) > now() + interval '9 days'), 'and the four-argument call of older code leaves the deadline as it was');

\echo '   6. A passed deadline does not lock the project; a finished project leaves the clock'
reset role;
update ai_studio_projects set deadline_at = now() - interval '2 days' where id = (select v from dl where k = 'p');   -- time went by
set role authenticated;
select test.login('sa');
select test.check((select (x ->> 'deadlineAt')::timestamptz < now() from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha'), 'an overdue project stays on the clock (first, overdue)');
select ai_studio_project_save((select v from dl where k = 'p'), 'DL Alpha renamed', 'x', null);
select ai_studio_project_save_with_deadline((select v from dl where k = 'p'), 'DL Alpha renamed', 'x', 'ON_HOLD', test.dl_at((select v from dl where k = 'p')));
select test.check((test.dl_name((select v from dl where k = 'p')) = 'DL Alpha renamed|ON_HOLD'), 'it can still be renamed and put on hold with its old deadline');
select ai_studio_project_save((select v from dl where k = 'p'), 'DL Alpha renamed', 'x', 'COMPLETED');
select test.check((select count(*) = 0 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha renamed'), 'a completed project is off the clock');
select test.check((select (p ->> 'deadlineAt') is not null from jsonb_array_elements(ai_studio_projects_list()) p where p ->> 'name' = 'DL Alpha renamed'), 'but its deadline is kept on the record');

\echo '   7. Clearing a deadline'
select ai_studio_project_save_with_deadline((select v from dl where k = 'p'), 'DL Alpha renamed', 'x', 'ACTIVE', now() + interval '4 days');
reset role;
delete from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE';
set role authenticated;
select test.login('sa');
select ai_studio_project_save_with_deadline((select v from dl where k = 'p'), 'DL Alpha renamed', 'x', null, null);
select test.check((test.dl_at((select v from dl where k = 'p')) is null), 'a deadline can be cleared');
select test.check((select count(*) = 0 from jsonb_array_elements(ai_studio_deadlines() -> 'items') x where x ->> 'name' = 'DL Alpha renamed'), 'and the clock stops');
select test.check(test.sq2($q$select count(*) = 1 from notifications where type = 'AI_STUDIO_PROJECT_DEADLINE' and recipient_id = test.id('ai_tm1a') and title like 'Deadline removed%'$q$)::boolean, 'the people on the project are told it was removed');

reset role;
delete from ai_studio_project_members where project_id in (select id from ai_studio_projects where name like 'DL %');
delete from ai_studio_projects where name like 'DL %';
\echo '=== ALL AI STUDIO DEADLINE TESTS PASSED ==='
