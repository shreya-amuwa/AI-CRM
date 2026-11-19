-- =============================================================================
-- Crocodial (migration 20270115000600): the date a mapping counts activity from. Activity before the approval counts once the Super Admin
-- moves the start back (to the first stored activity, or a chosen date); never in the future; never overlapping another mapping of the same
-- Crocodial user or the same person; Super Admin only; audited. Runs after crocodial_activity_test.sql (reuses its people).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 143. Crocodial: count activity from a date'
reset role;
\i supabase/migrations/20270115000600_crocodial_count_from.sql
\i supabase/migrations/20270115000600_crocodial_count_from.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_FROMTEST%';
create temp table cf (k text primary key, id uuid);
grant all on cf to authenticated;
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('From', 'CROCODIAL_TOKEN_FROMTEST', true, 'Asia/Kolkata');
insert into cf select 'c1', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_FROMTEST';
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from cf;
-- Sachin and Supriya approved a minute ago; Crocodial user 4193 belonged to cr_s3 from 30 to 10 days ago (an ended mapping)
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from, ended_at)
values ((select id from cf where k = 'c1'), 4138, 'sachin', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '1 minute', now() - interval '1 minute', null),
       ((select id from cf where k = 'c1'), 371, 'Supriya', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '1 minute', now() - interval '1 minute', null),
       ((select id from cf where k = 'c1'), 4193, 'Vanshika', test.id('cr_s3'), test.dept('mpillar'), 'SALES', 'REVOKED', now() - interval '30 days', now() - interval '30 days', now() - interval '10 days');
insert into cf select 'sachin', id from crocodial_employee_mappings where connection_id = (select id from cf where k = 'c1') and external_employee_id = 4138;
insert into cf select 'supriya', id from crocodial_employee_mappings where connection_id = (select id from cf where k = 'c1') and external_employee_id = 371;
insert into cf select 'old', id from crocodial_employee_mappings where connection_id = (select id from cf where k = 'c1') and external_employee_id = 4193;
insert into crocodial_sync_state (connection_id, resource, checkpoint, last_full_at, last_ok_at)
select (select id from cf where k = 'c1'), r, now(), now(), now() from unnest(array['leads', 'call-logs', 'followups', 'remarks']) r;
-- Sachin: calls 3 and 20 days ago (before the approval); a remark 50 days ago is his first activity
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, lead_ext, call_type, call_at, duration_seconds, connected) values
  ((select id from cf where k = 'c1'), 1, 4138, 1, 'outgoing', now() - interval '3 days', 60, true),
  ((select id from cf where k = 'c1'), 2, 4138, 2, 'outgoing', now() - interval '20 days', 30, false),
  ((select id from cf where k = 'c1'), 3, 371, 3, 'outgoing', now() - interval '5 days', 45, true);
insert into crocodial_ext_remarks (connection_id, external_id, written_by_ext, lead_ext, external_created_at) values
  ((select id from cf where k = 'c1'), 1, 4138, 1, now() - interval '50 days');
create temp table cf_t0 as select now() as t;
grant all on cf_t0 to authenticated;

set role authenticated;
select test.login('cr_s1');
select test.check((select (croc_activity(null, (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date) -> 'calls' ->> 'made')::int = 0),
  'before: calls made before the approval count for nobody');
select test.must_fail($$select croc_mapping_count_from((select id from cf where k = 'sachin'))$$, 'an employee cannot change it', 'FORBIDDEN');
select test.login('gb_h');
select test.must_fail($$select croc_mapping_count_from((select id from cf where k = 'sachin'))$$, 'a Department Head cannot change it', 'FORBIDDEN');

select test.login('sa');
select test.check((select (croc_mapping_count_from((select id from cf where k = 'sachin')) ->> 'effectiveFrom')::timestamptz
                          = (((now() - interval '50 days') at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata'),
  'from the first stored activity: the start of the day of his first record (a remark 50 days ago)');
select test.login('cr_s1');
select test.check((select (x -> 'calls' ->> 'made')::int = 2 and (x -> 'calls' ->> 'connected')::int = 1 and (x -> 'calls' ->> 'talkSeconds')::int = 60
                     from (select croc_activity(null, (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date) as x) s),
  'after: his earlier calls now count for him');
select test.check((select (croc_activity(null, (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date) ->> 'remarks')::int = 0),
  'a remark outside the period is not counted in it');

select test.login('sa');
select test.check((select (croc_mapping_count_from((select id from cf where k = 'supriya'), (now() at time zone 'Asia/Kolkata')::date - 10) ->> 'effectiveFrom')::timestamptz
                          = (((now() at time zone 'Asia/Kolkata')::date - 10)::timestamp at time zone 'Asia/Kolkata')),
  'a chosen date: from the start of that day in the account''s time zone');
select test.login('cr_s2');
select test.check((select (croc_activity(null, (now() at time zone 'Asia/Kolkata')::date - 29, (now() at time zone 'Asia/Kolkata')::date) -> 'calls' ->> 'made')::int = 1),
  'and her call 5 days ago counts for her');
select test.login('sa');
select test.must_fail($$select croc_mapping_count_from((select id from cf where k = 'supriya'), (now() at time zone 'Asia/Kolkata')::date + 1)$$,
  'never a date in the future', 'future');
select test.must_fail($$select croc_mapping_count_from((select id from cf where k = 'old'))$$, 'an ended mapping cannot be changed', 'in effect');

-- Crocodial user 4193 was cr_s3's until 10 days ago; since yesterday it is mapped to cr_tl1
reset role;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from cf where k = 'c1'), 4193, 'Vanshika', test.id('cr_tl1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '1 day', now() - interval '1 day');
insert into cf select 'new', id from crocodial_employee_mappings where connection_id = (select id from cf where k = 'c1') and external_employee_id = 4193 and status = 'APPROVED';
set role authenticated;
select test.login('sa');
select test.must_fail($$select croc_mapping_count_from((select id from cf where k = 'new'), (now() at time zone 'Asia/Kolkata')::date - 20)$$,
  'never overlapping an earlier mapping of the same Crocodial user (its calls stay the earlier person''s)', 'overlaps an earlier mapping');
select test.check((select croc_mapping_count_from((select id from cf where k = 'new'), (now() at time zone 'Asia/Kolkata')::date - 5) is not null),
  'a date after the earlier mapping ended is fine');
reset role;
select test.check((select count(*) = 3 from audit_logs where action = 'CROCODIAL_MAPPING_COUNT_FROM_SET' and created_at >= (select t from cf_t0)
                     and entity_id in (select id from cf where k in ('sachin', 'supriya', 'new'))),
  'every change is audited');
select test.check((select metadata ? 'previousFrom' and metadata ? 'from' from audit_logs where action = 'CROCODIAL_MAPPING_COUNT_FROM_SET'
                     and entity_id = (select id from cf where k = 'sachin') order by created_at desc limit 1),
  'with the previous and the new date');
set role anon;
select test.must_fail($$select croc_mapping_count_from(gen_random_uuid())$$, 'anonymous callers cannot call it', 'permission denied');
reset role;

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_FROMTEST%';
\echo '=== CROCODIAL COUNT FROM TESTS PASSED ==='
