-- =============================================================================
-- Where a sign-in came from (migration 20261204000100). Runs after the other suites on the same database and re-uses their users.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 70. Sign-in location on the audit trail'

reset role;
set role service_role;
create temp table loc (n int primary key, r boolean);
grant all on loc to service_role;
-- a staff sign-in with a place from the hosting platform, one with no place, and one with an invalid place
insert into loc select 1, record_server_event('SESSION_STARTED', 'session', null, test.id('tm_a'), 'SUCCESS', 'req-loc-1', '203.0.113.20', 'test:loc:1',
  '{"method":"password"}', '{"country":"India","region":"MH","city":"Pune","latitude":18.52043,"longitude":73.85674,"source":"PLATFORM_IP","accuracy":"CITY"}');
insert into loc select 2, record_server_event('SESSION_STARTED', 'session', null, test.id('tm_b'), 'SUCCESS', 'req-loc-2', null, 'test:loc:2', '{"method":"password"}');
insert into loc select 3, record_server_event('LOGIN_ATTEMPT_FAILED', 'auth', null, null, 'FAILURE', 'req-loc-3', '198.51.100.7', 'test:loc:3',
  '{"surface":"staff","identifier":"s***@example.com","identifierVerified":false}', '{"country":"India","region":null,"city":null,"latitude":null,"longitude":null,"source":"PLATFORM_IP","accuracy":"COUNTRY"}');
insert into loc select 4, record_server_event('SESSION_STARTED', 'session', null, test.id('th_wab'), 'SUCCESS', 'req-loc-4', '203.0.113.21', 'test:loc:4',
  '{}', '{"country":"India","city":"Mumbai","latitude":19.07,"longitude":null,"source":"IP_PROVIDER","accuracy":"CITY"}');
select test.must_fail($$select record_server_event('SESSION_STARTED', 'session', null, null, 'SUCCESS', 'r', null, 'test:loc:bad', '{}', '{"city":"X","source":"GUESS","accuracy":"CITY"}')$$,
  'a place with an unknown source is refused', 'Unknown location');
select test.must_fail($$select record_server_event('SESSION_STARTED', 'session', null, null, 'SUCCESS', 'r', null, 'test:loc:bad2', '{}', '{"city":"X","source":"PLATFORM_IP","accuracy":"EXACT"}')$$,
  'nor an accuracy that does not exist', 'Unknown location');
reset role;

select test.check((select bool_and(r) from loc), 'the events were recorded');
select test.check((select country = 'India' and region = 'MH' and city = 'Pune' and latitude = 18.52 and longitude = 73.86 and source = 'PLATFORM_IP' and accuracy = 'CITY'
                     from audit_log_locations l join audit_logs a on a.id = l.audit_id where a.dedupe_key = 'test:loc:1'),
  'the place is stored with its source and accuracy, coordinates rounded to about 1 km');
select test.check((select count(*) = 0 from audit_log_locations l join audit_logs a on a.id = l.audit_id where a.dedupe_key = 'test:loc:2'), 'an event without a place has none (nothing is invented)');
select test.check((select latitude is null and longitude is null and city is null and accuracy = 'COUNTRY'
                     from audit_log_locations l join audit_logs a on a.id = l.audit_id where a.dedupe_key = 'test:loc:3'), 'a country-only place has no coordinates');
select test.check((select latitude is null and longitude is null from audit_log_locations l join audit_logs a on a.id = l.audit_id where a.dedupe_key = 'test:loc:4'),
  'one coordinate without the other is dropped');
select test.check((select actor_id is null and outcome = 'FAILURE' from audit_logs where dedupe_key = 'test:loc:3'), 'a failed attempt is tied to no account');
select test.check((select count(*) = 1 from audit_logs where dedupe_key = 'test:loc:1'), 'the same event again is not stored twice');
set role service_role;
select test.check((select not record_server_event('SESSION_STARTED', 'session', null, test.id('tm_a'), 'SUCCESS', 'req-loc-1', '203.0.113.20', 'test:loc:1', '{}',
  '{"city":"Other","source":"PLATFORM_IP","accuracy":"CITY"}')), 'a repeated key adds neither an event nor a second place');
reset role;
select test.check((select count(*) = 1 from audit_log_locations l join audit_logs a on a.id = l.audit_id where a.dedupe_key = 'test:loc:1'), 'one place for the event');

\echo '--- 71. Only the Super Admin reads the place and the address'
set role authenticated;
select test.login('sa');
create temp table lsa as select audit_log_search('pune', null, null, null, null, null, 1, 100) as j;
grant all on lsa to authenticated;
create temp table lids as select id from audit_logs where dedupe_key = 'test:loc:1';
grant all on lids to authenticated;
select test.check((select private.audit_ip(id) = '203.0.113.20' from lids), 'the address function answers the Super Admin');
select test.check((select (j ->> 'total')::int = 1 and j -> 'items' -> 0 -> 'location' ->> 'city' = 'Pune' and j -> 'items' -> 0 ->> 'ip' = '203.0.113.20'
                          and (j -> 'items' -> 0 -> 'location' ->> 'latitude')::numeric = 18.52 from lsa), 'the Super Admin finds an event by its city and reads place and address');
select test.check((select (audit_log_search('india', null, null, null, null, null, 1, 100) ->> 'total')::int >= 3), 'and by its country');
select test.check((select (audit_log_search('mh', null, null, null, null, null, 1, 100) ->> 'total')::int >= 1), 'and by its region');
select test.check((select (audit_log_search('req-loc-3', null, null, null, null, null, 1, 100) -> 'items' -> 0 -> 'location' ->> 'country') = 'India'), 'a request id still finds its event');
select test.check((select audit_log_search('req-loc-2', null, null, null, null, null, 1, 100) -> 'items' -> 0 -> 'location' = 'null'::jsonb), 'an older or place-less event shows no place');
select test.check((select count(*) > 0 from audit_log_locations), 'the Super Admin reads the places table');
select test.check((select count(*) > 0 from audit_logs where outcome = 'SUCCESS'), 'the audit table itself still answers for the Super Admin');
select test.must_fail($$select ip from audit_logs$$, 'the address column is not readable directly, even by the Super Admin', 'permission denied');

select test.login('dh_wab');
select test.check((select jsonb_array_length(audit_log_search(null, null, null, null, null, null, 1, 100) -> 'items') > 0), 'a Department Head still reads the department''s events');
select test.check((select not exists (select 1 from jsonb_array_elements(audit_log_search(null, null, null, null, null, null, 1, 100) -> 'items') i
                                       where i ->> 'ip' is not null or i -> 'location' <> 'null'::jsonb)), 'without any address or place');
select test.check((select (audit_log_search('pune', null, null, null, null, null, 1, 100) ->> 'total')::int = 0), 'and searching a city finds nothing for them');
select test.check((select count(*) = 0 from audit_log_locations), 'the places table is empty to them');
select test.must_fail($$select ip from audit_logs$$, 'the address column is closed to them', 'permission denied');
select test.login('th_wab');
select test.check((select count(*) = 0 from audit_log_locations), 'and to a Team Lead');
select test.login('tm_a');
select test.check((select count(*) = 0 from audit_log_locations), 'and to a Team Member');
select test.must_fail($$select audit_log_search()$$, 'who cannot use the viewer at all', 'Only managers');
select test.check((select private.audit_ip(id) is null from lids), 'and the address function answers nothing for them');

\echo '--- 72. Nobody can write or change a place'
select test.must_fail($$insert into audit_log_locations (audit_id, source, accuracy) values (1, 'PLATFORM_IP', 'CITY')$$, 'an employee cannot add a place', 'permission denied');
select test.must_fail($$update audit_log_locations set city = 'Elsewhere'$$, 'nor change one', 'permission denied');
select test.must_fail($$delete from audit_log_locations$$, 'nor delete one', 'permission denied');
select test.login('sa');
select test.must_fail($$insert into audit_log_locations (audit_id, source, accuracy) values (1, 'PLATFORM_IP', 'CITY')$$, 'the Super Admin cannot add one through the API role', 'permission denied');
select test.must_fail($$update audit_log_locations set city = 'Elsewhere'$$, 'nor change one', 'permission denied');
select test.must_fail($$delete from audit_log_locations$$, 'nor delete one', 'permission denied');
reset role;
select test.must_fail($$update audit_log_locations set city = 'Elsewhere'$$, 'not even the owner without a purge', 'cannot be changed');
select test.must_fail($$delete from audit_log_locations$$, 'and not delete', 'cannot be changed');
set role anon;
select test.must_fail($$select * from audit_log_locations$$, 'a signed-out visitor reads nothing', 'permission denied');
reset role;
\echo '--- 70-72 done'
