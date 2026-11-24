-- =============================================================================
-- CEO office arrival (migration 20270128000300): HR presses "CEO HAS ARRIVED" (once a day, with the time and who; undo keeps the record),
-- everyone reads it, nobody else writes it; it NEVER controls meeting requests (before and after the arrival, asking the CEO works the
-- same, nothing is confirmed or rejected by it); and the queue confirmed on Exit never overlaps a meeting the CEO already has confirmed.
-- Own meetings (title 'CA %').
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 133c. CEO office arrival (informational; never blocks meeting requests)'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270128000300_ceo_office_arrival.sql
\i supabase/migrations/20270128000300_ceo_office_arrival.sql
delete from meetings where title like 'CA %';
delete from ceo_office_arrivals;
delete from meeting_presence;
delete from meeting_presence_log;
create or replace function test.ca(p_title text) returns public.meetings language sql stable security definer set search_path = '' as $$
  select * from public.meetings where title = p_title limit 1 $$;
create or replace function test.ca_ask(p_title text, p_days int default 2) returns jsonb language sql as $$
  select mtg_create(jsonb_build_object('title', p_title, 'hostId', test.id('sa'), 'startsAt', now() + make_interval(days => p_days),
                                       'endsAt', now() + make_interval(days => p_days, mins => 30), 'description', 'Purpose: ' || p_title)) $$;
-- the CEO as everyone sees them
create or replace function test.ca_me() returns jsonb language sql as $$
  select x from jsonb_array_elements(ceo_office_status() -> 'ceos') x where (x ->> 'ceoId')::uuid = test.id('sa') $$;
grant execute on all functions in schema test to anon, authenticated;
-- an arrival yesterday does not count today
insert into ceo_office_arrivals (ceo_id, day, arrived_at) values (test.id('sa'), private.ceo_office_day() - 1, now() - interval '1 day');

\echo '   before the arrival: everyone sees "not arrived", and asking the CEO for time works'
set role authenticated;
select test.login('tm_a');
select test.check((select not (v ->> 'arrived')::boolean and v ->> 'arrivedAt' is null from (select test.ca_me() as v) x), 'an employee sees: the CEO has not arrived (yesterday''s arrival does not count)');
select test.check(not (ceo_office_status() ->> 'canMark')::boolean, 'an employee has no arrival button');
select test.check((test.ca_ask('CA Before arrival') ->> 'status') = 'REQUESTED', 'before the arrival, a meeting request is saved as usual (never refused)');
select test.login('th_wab');
select test.check((test.ca_ask('CA Before arrival two', 3) ->> 'status') = 'REQUESTED', '... from every designation');
select test.check(exists (select 1 from jsonb_array_elements(mtg_ceo_requests('ALL') -> 'items') x where x ->> 'title' = 'CA Before arrival two'), '... and they follow its status');
select test.login('tm_a');
select test.must_fail($$select ceo_mark_arrived(test.id('sa'))$$, 'an employee cannot mark the arrival', 'Only HR');
select test.must_fail($$insert into ceo_office_arrivals (ceo_id, day) values (test.id('sa'), current_date)$$, 'nobody writes the table directly', 'permission denied');
select test.login('sa');
select test.must_fail($$update ceo_office_arrivals set undone_at = now()$$, 'not even the Super Admin', 'permission denied');

\echo '   HR presses CEO HAS ARRIVED'
select test.login('hr_head');
select test.check((ceo_office_status() ->> 'canMark')::boolean, 'HR has the button');
select test.check((select (x ->> 'duplicate') = 'false' and exists (select 1 from jsonb_array_elements(x -> 'ceos') c where (c ->> 'ceoId')::uuid = test.id('sa') and (c ->> 'arrived')::boolean
                          and (c ->> 'arrivedAt')::timestamptz > now() - interval '1 minute' and c ->> 'markedBy' = 'HR Head')
                     from (select ceo_mark_arrived(test.id('sa')) as x) s), 'arrived: the time and who pressed it are recorded');
select test.check((ceo_mark_arrived(test.id('sa')) ->> 'duplicate')::boolean, 'a second press changes nothing');
reset role;
select test.check((select count(*) = 1 from ceo_office_arrivals where ceo_id = test.id('sa') and day = private.ceo_office_day() and undone_at is null), 'one arrival today');
select test.check((select count(*) = 1 from audit_logs where action = 'CEO_OFFICE_ARRIVED' and entity_id = test.id('sa') and created_at > now() - interval '1 minute'), 'audited once');
set role authenticated;
select test.login('tm_a');
select test.check((test.ca_me() ->> 'arrived')::boolean, 'employees see the CEO has arrived');

\echo '   the arrival never confirms, rejects or blocks requests'
reset role;
select test.check((select status = 'REQUESTED' from test.ca('CA Before arrival')) and (select status = 'REQUESTED' from test.ca('CA Before arrival two')),
  'the requests made before the arrival are still waiting for the CEO''s decision (not confirmed, not rejected)');
set role authenticated;
select test.login('tm_b');
select test.check((test.ca_ask('CA After arrival', 4) ->> 'status') = 'REQUESTED', 'after the arrival, asking works the same');
select test.login('sa');
select test.check((mtg_decide((test.ca('CA Before arrival')).id, 'APPROVE') ->> 'status') = 'SCHEDULED', 'the CEO approves a request made before the arrival');
select test.login('tm_c');
select test.must_fail($$select test.ca_ask('CA Same time', 2)$$, 'an overlapping request for a confirmed time is still refused', 'already has a meeting');

\echo '   in a meeting: BUSY, the queue, and no overlap with a confirmed meeting'
select test.login('sa');
select test.check((test.ca_me() ->> 'presence') = 'AVAILABLE' and (mtg_presence_enter() ->> 'status') = 'BUSY' and (test.ca_me() ->> 'presence') = 'BUSY',
  'the arrival status shows the CEO BUSY while in a meeting');
reset role;
-- a meeting the CEO already has confirmed, starting in 5 minutes
insert into meetings (kind, title, host_id, created_by, starts_at, ends_at, status, booked_via)
values ('MEETING', 'CA Confirmed soon', test.id('sa'), test.id('sa'), date_trunc('minute', now()) + interval '5 minutes', date_trunc('minute', now()) + interval '35 minutes', 'SCHEDULED', 'STAFF');
set role authenticated;
select test.login('tm_a');
select test.check((test.ca_ask('CA Queued') ->> 'status') = 'PENDING_AVAILABILITY', 'a request while the CEO is in a meeting joins the queue');
select test.login('sa');
select test.check((select x -> 0 ->> 'title' = 'CA Queued' and not (x -> 0 ->> 'startsNow')::boolean from (select mtg_presence_exit() -> 'scheduled' as x) s), 'Exit confirms it');
reset role;
select test.check((select starts_at = (test.ca('CA Confirmed soon')).ends_at and status = 'SCHEDULED' from test.ca('CA Queued')),
  'it starts right after the meeting already confirmed (never on top of it)');
select test.check(not exists (select 1 from meetings a join meetings b on a.host_id = b.host_id and a.id < b.id
                               where a.host_id = test.id('sa') and a.title like 'CA %' and b.title like 'CA %' and a.status = 'SCHEDULED' and b.status = 'SCHEDULED'
                                 and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at)), 'no two confirmed meetings of the CEO overlap');

\echo '   undo a mistaken press'
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select ceo_mark_arrival_undo(test.id('sa'))$$, 'an employee cannot undo it', 'Only HR');
select test.login('iss_hr_tm');
select test.check(not (select (c ->> 'arrived')::boolean from jsonb_array_elements(ceo_mark_arrival_undo(test.id('sa')) -> 'ceos') c where (c ->> 'ceoId')::uuid = test.id('sa')),
  'another HR person undoes it: not arrived again');
reset role;
select test.check((select count(*) = 1 and bool_and(undone_by = test.id('iss_hr_tm')) from ceo_office_arrivals where ceo_id = test.id('sa') and day = private.ceo_office_day()),
  'the undone arrival is kept, with who undid it');
set role authenticated;
select test.login('iss_hr_tm');
select test.check((select (c ->> 'arrived')::boolean from jsonb_array_elements(ceo_mark_arrived(test.id('sa')) -> 'ceos') c where (c ->> 'ceoId')::uuid = test.id('sa')),
  'and it can be pressed again');
select test.must_fail($$select ceo_mark_arrived(test.id('tm_a'))$$, 'only a CEO can be marked', 'CEO not found');
select test.login('tm_a');
select test.check((test.ca_ask('CA After undo', 5) ->> 'status') = 'REQUESTED', 'requests work whatever the arrival status');

reset role;
select test.login('sa');
select mtg_presence_exit();
reset role;
delete from meetings where title like 'CA %';
delete from ceo_office_arrivals;
select set_config('request.jwt.claims', '', false);
