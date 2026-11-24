-- =============================================================================
-- CEO Availability (migration 20270201000100): HR presses CEO Arrived / CEO Not Arrived; the status is stored in the database (ceo_office_arrivals),
-- everyone reads it with the date, time and person of the latest update, nobody else writes it, an HR Recruiter only reads; and it NEVER blocks
-- a meeting request (own meetings, title 'CV %').
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133d. CEO Availability (HR sets it; stored; shown to everyone; never blocks meeting requests)'
reset role;
select set_config('request.jwt.claims', '', false);
-- 20270128000300 was just replayed by the previous test file (it redefines ceo_office_json): apply this migration again, twice (safe to run twice)
\i supabase/migrations/20270201000100_ceo_availability.sql
\i supabase/migrations/20270201000100_ceo_availability.sql
delete from meetings where title like 'CV %';
delete from ceo_office_arrivals;
select test.create_auth_user('cav_rec', 'cav.rec@amuwa.com', '{"full_name":"CAV Recruiter"}',
  jsonb_build_object('provisioned_by', test.id('hr_head'), 'provisioned_role', 'TEAM_MEMBER',
                     'provisioned_team_id', (select t.id from teams t where t.department_id = test.dept('hr') order by t.created_at limit 1)));
update profiles set hr_sub_role = 'HR_RECRUITER' where id = test.id('cav_rec');
create or replace function test.cav_ask(p_title text, p_days int default 2) returns jsonb language sql as $$
  select mtg_create(jsonb_build_object('title', p_title, 'hostId', test.id('sa'), 'startsAt', now() + make_interval(days => p_days),
                                       'endsAt', now() + make_interval(days => p_days, mins => 30), 'description', 'Purpose: ' || p_title)) $$;
create or replace function test.cav_id(p_title text) returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.meetings where title = p_title limit 1 $$;
create or replace function test.cav_me() returns jsonb language sql as $$
  select x from jsonb_array_elements(ceo_office_status() -> 'ceos') x where (x ->> 'ceoId')::uuid = test.id('sa') $$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   nothing recorded yet: not arrived, no update'
set role authenticated;
select test.login('tm_a');
select test.check((select v ->> 'status' = 'NOT_ARRIVED' and not (v ->> 'arrived')::boolean and v ->> 'updatedAt' is null and v ->> 'updatedBy' is null from (select test.cav_me() v) x),
  'an employee sees NOT_ARRIVED and no update yet');
select test.check((test.cav_ask('CV Before any update') ->> 'status') = 'REQUESTED', 'a meeting request is saved when the CEO has not arrived (never refused)');

\echo '   who may update it'
select test.must_fail($$select ceo_mark_not_arrived(test.id('sa'))$$, 'an employee cannot press CEO Not Arrived', 'Only HR');
select test.must_fail($$select ceo_mark_arrived(test.id('sa'))$$, 'an employee cannot press CEO Arrived', 'Only HR');
select test.login('th_wab');
select test.must_fail($$select ceo_mark_not_arrived(test.id('sa'))$$, 'a Team Lead of another department cannot', 'Only HR');
select test.login('cav_rec');
select test.check(not (ceo_office_status() ->> 'canMark')::boolean, 'an HR Recruiter reads the status but has no buttons');
select test.must_fail($$select ceo_mark_not_arrived(test.id('sa'))$$, 'an HR Recruiter cannot update it', 'Only HR');
select test.must_fail($$select ceo_mark_arrived(test.id('sa'))$$, 'nor mark it arrived', 'Only HR');
select test.login('tm_a');
select test.must_fail($$insert into ceo_office_arrivals (ceo_id, day) values (test.id('sa'), current_date)$$, 'nobody writes the table directly', 'permission denied');
reset role;
select test.must_fail($$select ceo_mark_not_arrived(test.id('sa'))$$, 'a visitor with no session cannot', 'FORBIDDEN|permission denied|Only HR');
set role anon;
select test.must_fail($$select ceo_mark_not_arrived(null)$$, 'an anonymous caller cannot execute it', 'permission denied');
reset role;
set role authenticated;

\echo '   CEO Not Arrived with no arrival today: recorded with the time and who'
select test.login('hr_head');
select test.check((ceo_office_status() ->> 'canMark')::boolean, 'HR has the buttons');
select test.check((select x ->> 'duplicate' = 'false' and exists (select 1 from jsonb_array_elements(x -> 'ceos') c where (c ->> 'ceoId')::uuid = test.id('sa')
                       and c ->> 'status' = 'NOT_ARRIVED' and c ->> 'updatedStatus' = 'NOT_ARRIVED' and c ->> 'updatedBy' = 'HR Head'
                       and (c ->> 'updatedAt')::timestamptz > now() - interval '1 minute' and (c ->> 'updatedToday')::boolean)
                   from (select ceo_mark_not_arrived(test.id('sa')) as x) s), 'Not Arrived is stored with its time and who pressed it');
select test.check((ceo_mark_not_arrived(test.id('sa')) ->> 'duplicate')::boolean, 'a second press changes nothing');
reset role;
select test.check((select count(*) = 1 and bool_and(kind = 'NOT_ARRIVED' and undone_at is not null) from ceo_office_arrivals where ceo_id = test.id('sa')), 'one update recorded, not two (stored as an explicit Not Arrived row, never a live arrival)');
select test.check((select count(*) = 1 from audit_logs where action = 'CEO_OFFICE_NOT_ARRIVED' and entity_id = test.id('sa') and actor_id = test.id('hr_head') and created_at > now() - interval '5 minutes'), 'audited, with who');
set role authenticated;

\echo '   CEO Arrived'
select test.login('hr_head');
select test.check((select x ->> 'duplicate' = 'false' and exists (select 1 from jsonb_array_elements(x -> 'ceos') c where (c ->> 'ceoId')::uuid = test.id('sa')
                       and c ->> 'status' = 'ARRIVED' and c ->> 'updatedStatus' = 'ARRIVED' and c ->> 'updatedBy' = 'HR Head' and (c ->> 'arrived')::boolean)
                   from (select ceo_mark_arrived(test.id('sa')) as x) s), 'Arrived: the latest update is now the arrival');
select test.login('tm_b');
select test.check((select v ->> 'status' = 'ARRIVED' and v ->> 'updatedStatus' = 'ARRIVED' from (select test.cav_me() v) x), 'an employee sees the same latest status (persisted, read from the database)');
select test.login('th_wab');
select test.check((select v ->> 'status' = 'ARRIVED' and v ->> 'updatedBy' = 'HR Head' from (select test.cav_me() v) x), 'every dashboard reads the same row');
select test.login('cav_rec');
select test.check((select v ->> 'status' = 'ARRIVED' and v ->> 'updatedBy' = 'HR Head' from (select test.cav_me() v) x), 'an HR Recruiter reads it too');
select test.login('tm_a');
select test.check((test.cav_ask('CV After arrival', 3) ->> 'status') = 'REQUESTED', 'a meeting request is saved when the CEO has arrived');

\echo '   CEO Not Arrived after an arrival: the arrival is undone and kept'
reset role;
select count(*) as undone_before from audit_logs where action = 'CEO_OFFICE_ARRIVAL_UNDONE' and entity_id = test.id('sa') \gset
set role authenticated;
select test.login('iss_hr_tm');
select test.check((select x ->> 'duplicate' = 'false' and exists (select 1 from jsonb_array_elements(x -> 'ceos') c where (c ->> 'ceoId')::uuid = test.id('sa')
                       and c ->> 'status' = 'NOT_ARRIVED' and c ->> 'updatedStatus' = 'NOT_ARRIVED' and c ->> 'updatedBy' = (select full_name from profiles where id = test.id('iss_hr_tm'))
                       and not (c ->> 'arrived')::boolean)
                   from (select ceo_mark_not_arrived(test.id('sa')) as x) s), 'another HR person sets Not Arrived: the latest update shows them');
reset role;
select test.check((select count(*) = 1 and bool_and(undone_by = test.id('iss_hr_tm')) from ceo_office_arrivals where ceo_id = test.id('sa') and day = private.ceo_office_day() and kind = 'ARRIVED'),
  'the arrival is kept, marked undone, with who undid it');
select test.check((select count(*) = :undone_before + 1 and bool_or(actor_id = test.id('iss_hr_tm')) from audit_logs where action = 'CEO_OFFICE_ARRIVAL_UNDONE' and entity_id = test.id('sa')), 'audited, with who');
set role authenticated;
select test.login('tm_a');
select test.check((test.cav_ask('CV After not arrived', 4) ->> 'status') = 'REQUESTED', 'Not Arrived never prevents a meeting request');
select test.login('hr_head');
select test.check((ceo_mark_arrived(test.id('sa')) ->> 'duplicate') = 'false' and (test.cav_me() ->> 'updatedStatus') = 'ARRIVED', 'and the CEO can be marked arrived again (the latest update wins)');

\echo '   yesterday does not count today'
reset role;
delete from ceo_office_arrivals;
insert into ceo_office_arrivals (ceo_id, day, arrived_at, marked_by)
values (test.id('sa'), private.ceo_office_day() - 1, now() - interval '1 day', test.id('hr_head'));
set role authenticated;
select test.login('tm_a');
select test.check((select v ->> 'status' = 'NOT_ARRIVED' and v ->> 'updatedStatus' = 'ARRIVED' and not (v ->> 'updatedToday')::boolean from (select test.cav_me() v) x),
  'yesterday''s arrival shows as the latest update, flagged as not from today, and the CEO counts as not arrived');

\echo '   meeting requests are saved with who, department, date, time and purpose; the status is only information'
reset role;
select test.check((select count(*) = 3 from meetings where title in ('CV Before any update', 'CV After arrival', 'CV After not arrived') and status = 'REQUESTED'),
  'all requests are saved and still waiting for the CEO''s decision');
select test.check((select created_by = test.id('tm_a') and starts_at is not null and description like 'Purpose:%' and host_id = test.id('sa') from meetings where title = 'CV After arrival'), 'who asked, when, and the purpose are stored');
set role authenticated;
select test.login('sa');
select test.check(exists (select 1 from jsonb_array_elements(mtg_ceo_requests('ALL') -> 'items') x
                           where x ->> 'title' = 'CV After arrival' and x ->> 'createdByName' is not null and x ->> 'createdByDepartment' is not null
                             and x ->> 'startsAt' is not null and x ->> 'description' like 'Purpose:%'),
  'the CEO''s request list shows the employee, department, requested time and purpose');
select test.check((mtg_decide(test.cav_id('CV Before any update'), 'APPROVE') ->> 'status') = 'SCHEDULED', 'the CEO can approve whatever the status');

reset role;
delete from meetings where title like 'CV %';
delete from ceo_office_arrivals;
select set_config('request.jwt.claims', '', false);
