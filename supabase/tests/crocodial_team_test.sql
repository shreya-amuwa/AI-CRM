-- =============================================================================
-- Crocodial integration, part 4 (migration 20270115000400): the management view. Who is listed for whom (own Team Lead, other Team Lead,
-- Department Head, Super Admin, a colleague, Support, another department), the pilot label, totals of the listed people only, a person not
-- synced yet listed as "not available" and left out of the totals. Runs after crocodial_activity_test.sql (reuses its people).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 141. Crocodial: the management view'
reset role;
\i supabase/migrations/20270115000400_crocodial_team_activity.sql
\i supabase/migrations/20270115000400_crocodial_team_activity.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_TEAMTEST%';
create temp table ct (k text primary key, id uuid);
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('Team', 'CROCODIAL_TOKEN_TEAMTEST', true, 'Asia/Kolkata'), ('Team new', 'CROCODIAL_TOKEN_TEAMTEST_B', true, 'Asia/Kolkata');
insert into ct select 'c1', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_TEAMTEST';
insert into ct select 'c2', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_TEAMTEST_B';
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from ct;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from ct where k = 'c1'), 4138, 'sachin', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '60 days', now() - interval '60 days'),
       ((select id from ct where k = 'c1'), 371, 'Supriya', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '60 days', now() - interval '60 days'),
       -- a third person on an account that has never been synced
       ((select id from ct where k = 'c2'), 55, 'new', test.id('cr_s3'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '1 day', now() - interval '1 day');
insert into crocodial_sync_state (connection_id, resource, checkpoint, last_full_at, last_ok_at)
select (select id from ct where k = 'c1'), r, now(), now(), now() from unnest(array['leads', 'call-logs', 'followups', 'remarks']) r;
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, lead_ext, call_type, call_at, duration_seconds, connected) values
  ((select id from ct where k = 'c1'), 1, 4138, 1, 'outgoing', now() - interval '1 day', 60, true),
  ((select id from ct where k = 'c1'), 2, 4138, 2, 'outgoing', now() - interval '1 day', 0, false),
  ((select id from ct where k = 'c1'), 3, 371, 3, 'outgoing', now() - interval '1 day', 120, true),
  ((select id from ct where k = 'c1'), 4, 371, 4, 'outgoing', now() - interval '2 days', 30, true),
  ((select id from ct where k = 'c1'), 5, 371, 5, 'outgoing', now() - interval '2 days', 0, false),
  ((select id from ct where k = 'c1'), 6, 4193, 6, 'outgoing', now() - interval '1 day', 999, true);

\echo '   who is listed for whom'
set role authenticated;
select test.login('cr_tl1');
select test.check((select (x ->> 'connectedEmployees')::int = 2 and x ->> 'label' = 'Crocodial Pilot — 2 connected employees'
                     and (select string_agg(p ->> 'name', ',' order by p ->> 'name') from jsonb_array_elements(x -> 'people') p) = 'CR Other Seller,CR Sachin'
                     from (select croc_team_activity() as x) s), 'a Team Lead sees only the people they lead (not the other Team Lead''s), with the pilot label');
select test.login('cr_tl2');
select test.check((select (x ->> 'connectedEmployees')::int = 1 and x -> 'people' -> 0 ->> 'name' = 'CR Supriya' from (select croc_team_activity() as x) s),
  'the other Team Lead of the same team sees only their own person');
select test.login('cr_s1');
select test.check((select (croc_team_activity() ->> 'connectedEmployees')::int = 0), 'an employee sees nobody else''s activity');
select test.login('cr_sup');
select test.check((select (croc_team_activity() ->> 'connectedEmployees')::int = 0), 'an M Pillar Support member sees nobody');
select test.login('ga_s');
select test.check((select (croc_team_activity() ->> 'connectedEmployees')::int = 0), 'a head of other departments sees nobody');
select test.login('gb_h');
create temp table head as select croc_team_activity((now() at time zone 'Asia/Kolkata')::date - 6, (now() at time zone 'Asia/Kolkata')::date) as x;
reset role;
select test.check((select (x ->> 'connectedEmployees')::int = 3 and x ->> 'label' = 'Crocodial Pilot — 3 connected employees' from head),
  'M Pillar''s Department Head sees the connected people of M Pillar Sales');
select test.check((select (x ->> 'unavailable')::int = 1 and exists (select 1 from jsonb_array_elements(x -> 'people') p where p ->> 'name' = 'CR Other Seller' and not (p ->> 'available')::boolean) from head),
  'a person never synced is listed as not available');
select test.check((select (x -> 'totals' ->> 'made')::int = 5 and (x -> 'totals' ->> 'connected')::int = 3 and (x -> 'totals' ->> 'connectRate')::numeric = 60.0
                     and (x -> 'totals' ->> 'talkSeconds')::int = 210 from head),
  'the totals add up the synced people only (the unmapped user''s call is not counted)');
select test.check((select x ->> 'note' like 'Totals cover only the connected employees%' from head), 'and say they are not the whole department');
select test.check((select jsonb_array_length(x -> 'daily') = 7 and (select sum((d ->> 'made')::int) from jsonb_array_elements(x -> 'daily') d) = 5 from head), 'a day-by-day trend of the listed people');
set role authenticated;
select test.login('sa');
select test.check((select (croc_team_activity() ->> 'connectedEmployees')::int = 3), 'the Super Admin sees every connected person');
select test.check((select (croc_team_activity(null, null, null, test.team('mpillar', 'Support')) ->> 'connectedEmployees')::int = 0), 'the team filter narrows the list');
reset role;
update crocodial_department_links set enabled = false where connection_id in (select id from ct);
set role authenticated;
select test.login('sa');
select test.check((select (croc_team_activity() ->> 'connectedEmployees')::int = 0), 'switched off: nobody is listed');
reset role;
set role anon;
select test.must_fail($$select croc_team_activity()$$, 'anonymous callers cannot call it', 'permission denied');
reset role;

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_TEAMTEST%';
\echo '=== CROCODIAL TEAM TESTS PASSED ==='
