-- =============================================================================
-- Crocodial integration, part 3 (migration 20270115000300): a person's activity. The formulas, attribution through the mapping in effect
-- (never another account, never an unmapped user, never a re-mapped later owner), CRM demos, unavailable vs stale vs zero, and who may see it.
-- Runs after crocodial_test.sql and crocodial_sync_test.sql (reuses cr_s1, cr_s2, cr_s3, cr_tl1, cr_tl2, cr_sup, gb_h, sa).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 140. Crocodial: a person''s activity'
reset role;
\i supabase/migrations/20270115000300_crocodial_activity.sql
\i supabase/migrations/20270115000300_crocodial_activity.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_ACTTEST%';
delete from ba_demos where title like 'CR demo %';
create temp table ca (k text primary key, id uuid);
grant all on ca to authenticated;
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('Act', 'CROCODIAL_TOKEN_ACTTEST', true, 'Asia/Kolkata'), ('Act other', 'CROCODIAL_TOKEN_ACTTEST_B', true, 'Asia/Kolkata');
insert into ca select 'c1', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_ACTTEST';
insert into ca select 'c2', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_ACTTEST_B';
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from ca;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from ca where k = 'c1'), 4138, 'sachin', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '60 days', now() - interval '60 days'),
       ((select id from ca where k = 'c1'), 371, 'Supriya', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '60 days', now() - interval '60 days');
insert into crocodial_sync_state (connection_id, resource, checkpoint, last_full_at, last_ok_at)
select c.id, r, now(), now(), now() from ca c, unnest(array['leads', 'call-logs', 'followups', 'remarks']) r;

-- Sachin's calls in the last days: 4 outgoing (3 connected: 60 + 40 + 30 s), 1 incoming, 1 missed; 2 distinct leads; one call 40 days ago
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, lead_ext, call_type, call_at, duration_seconds, connected, phone_number, contact_name) values
  ((select id from ca where k = 'c1'), 1, 4138, 900, 'outgoing', now() - interval '1 day', 60, true, '+919800000001', 'Ravi'),
  ((select id from ca where k = 'c1'), 2, 4138, 900, 'outgoing', now() - interval '1 day', 40, true, '+919800000001', 'Ravi'),
  ((select id from ca where k = 'c1'), 3, 4138, 901, 'outgoing', now() - interval '2 days', 0, false, '+919800000002', null),
  ((select id from ca where k = 'c1'), 4, 4138, null, 'outgoing', now() - interval '2 days', 30, true, '+919800000003', 'Unknown'),
  ((select id from ca where k = 'c1'), 5, 4138, 900, 'incoming', now() - interval '1 day', 20, true, null, null),
  ((select id from ca where k = 'c1'), 6, 4138, null, 'missed', now() - interval '1 day', 0, false, null, null),
  ((select id from ca where k = 'c1'), 7, 4138, 902, 'outgoing', now() - interval '40 days', 99, true, null, null),
  -- an unmapped user's calls, and the other account's user 4138: never Sachin's
  ((select id from ca where k = 'c1'), 8, 4193, 903, 'outgoing', now() - interval '1 day', 500, true, null, null),
  ((select id from ca where k = 'c2'), 1, 4138, 900, 'outgoing', now() - interval '1 day', 700, true, null, null);
insert into crocodial_ext_leads (connection_id, external_id, name, assigned_to_ext, called, next_followup_at) values
  ((select id from ca where k = 'c1'), 900, 'Ravi Kumar', 4138, true, now() + interval '1 day'),
  ((select id from ca where k = 'c1'), 901, 'Asha', 4138, false, now() - interval '1 day'),
  ((select id from ca where k = 'c1'), 903, 'Other', 4193, false, null);
insert into crocodial_ext_followups (connection_id, external_id, created_by_ext, lead_ext, note, scheduled_at, done, external_created_at) values
  ((select id from ca where k = 'c1'), 1, 4138, 900, 'Share the price list', now() - interval '2 days', true, now() - interval '3 days'),
  ((select id from ca where k = 'c1'), 2, 4138, 901, 'Call back', now() - interval '1 day', false, now() - interval '3 days'),
  ((select id from ca where k = 'c1'), 3, 4138, 900, 'Demo', now() + interval '2 days', false, now() - interval '1 day'),
  ((select id from ca where k = 'c1'), 4, 4193, 903, 'Not Sachin''s', now() - interval '1 day', false, now() - interval '2 days');
insert into crocodial_ext_remarks (connection_id, external_id, written_by_ext, lead_ext, remark, external_created_at) values
  ((select id from ca where k = 'c1'), 1, 4138, 900, 'Interested', now() - interval '1 day');
insert into ba_demos (contact_id, title, starts_at, ends_at, mode, assigned_to, status, created_by)
select (select id from ba_contacts limit 1), t, s, s + interval '1 hour', 'ONLINE', test.id('cr_s1'), st, test.id('cr_s1')
  from (values ('CR demo done', now() - interval '2 days', 'COMPLETED'), ('CR demo moved', now() - interval '1 day', 'RESCHEDULED'),
               ('CR demo cancelled', now() - interval '1 day', 'CANCELLED'), ('CR demo next', now() + interval '1 day', 'SCHEDULED')) v(t, s, st);

\echo '   the formulas'
set role authenticated;
select test.login('cr_s1');
create temp table act as select croc_activity(null, (now() at time zone 'Asia/Kolkata')::date - 6, (now() at time zone 'Asia/Kolkata')::date) as a;
reset role;
select test.check((select a ->> 'enabled' = 'true' and a ->> 'available' = 'true' and a ->> 'stale' = 'false' from act), 'switched on, synced and current');
select test.check((select (a -> 'calls' ->> 'made')::int = 4 and (a -> 'calls' ->> 'connected')::int = 3 and (a -> 'calls' ->> 'connectRate')::numeric = 75.0 from act),
  'calls made = outgoing calls by the person (4), connected 3, connect rate 75%');
select test.check((select (a -> 'calls' ->> 'talkSeconds')::int = 130 and (a -> 'calls' ->> 'incoming')::int = 1 and (a -> 'calls' ->> 'missed')::int = 1 from act),
  'talk time = connected outgoing calls only (130 s); incoming and missed are counted apart');
select test.check((select (a -> 'calls' ->> 'uniqueLeads')::int = 2 from act), 'unique leads = distinct leads called (a call without a lead does not count)');
select test.check((select (a -> 'followups' ->> 'scheduled')::int = 2 and (a -> 'followups' ->> 'completed')::int = 1 and (a -> 'followups' ->> 'completionRate')::numeric = 50.0
                     and (a -> 'followups' ->> 'overdue')::int = 1 from act),
  'follow-ups due in the period 2, completed 1 (50%), overdue 1; another user''s follow-up is not counted');
select test.check((select (a -> 'leads' ->> 'assigned')::int = 2 and (a -> 'leads' ->> 'neverCalled')::int = 1 and (a -> 'leads' ->> 'followUpDue')::int = 1 from act),
  'leads assigned in Crocodial: 2, one never called, one with a follow-up due');
select test.check((select (a ->> 'remarks')::int = 1 from act), 'remarks written in the period');
select test.check((select (a -> 'demos' ->> 'scheduled')::int = 2 and (a -> 'demos' ->> 'completed')::int = 1 and (a -> 'demos' ->> 'cancelled')::int = 1
                     and (a -> 'demos' ->> 'upcoming')::int = 1 from act),
  'CRM demos: scheduled 2 (a rescheduled demo once, the cancelled one apart), completed 1, cancelled 1, upcoming 1');
select test.check((select jsonb_array_length(a -> 'daily') = 7 and (select sum((d ->> 'made')::int) from jsonb_array_elements(a -> 'daily') d) = 4 from act), 'a day-by-day trend of the period');
select test.check((select jsonb_array_length(a -> 'recentCalls') = 6 and exists (select 1 from jsonb_array_elements(a -> 'recentCalls') c where c ->> 'phone' = 'XXXXXX0001')
                     and not (a::text like '%9800000001%') from act), 'recent calls show the last 4 digits only');
select test.check((select jsonb_array_length(a -> 'upcomingFollowups') = 2 from act), 'open follow-ups are listed');

\echo '   re-mapping never moves past activity'
update crocodial_employee_mappings set status = 'REVOKED', ended_at = now() - interval '36 hours'
 where connection_id = (select id from ca where k = 'c1') and external_employee_id = 4138;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from ca where k = 'c1'), 4138, 'sachin', test.id('cr_s3'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '36 hours', now() - interval '36 hours');
set role authenticated;
select test.login('cr_s1');
select test.check((select (croc_activity() -> 'calls' ->> 'made')::int = 2), 'Sachin keeps the calls made before his mapping ended (2 days ago)');
select test.login('cr_s3');
select test.check((select (croc_activity() -> 'calls' ->> 'made')::int = 2), 'the new holder of that Crocodial user gets only the calls since');
reset role;
delete from crocodial_employee_mappings where profile_id = test.id('cr_s3') and connection_id = (select id from ca where k = 'c1');
update crocodial_employee_mappings set status = 'APPROVED', ended_at = null where connection_id = (select id from ca where k = 'c1') and external_employee_id = 4138;

\echo '   who may see it'
set role authenticated;
select test.login('cr_s2');
select test.must_fail($$select croc_activity(test.id('cr_s1'))$$, 'a colleague cannot read Sachin''s activity by sending his id', 'NOT_FOUND');
select test.login('cr_tl1');
select test.check((select (croc_activity(test.id('cr_s1')) -> 'calls' ->> 'made')::int = 4), 'his own Team Lead can');
select test.login('cr_tl2');
select test.must_fail($$select croc_activity(test.id('cr_s1'))$$, 'another Team Lead of the same team cannot', 'NOT_FOUND');
select test.login('cr_sup');
select test.must_fail($$select croc_activity(test.id('cr_s1'))$$, 'an M Pillar Support member cannot', 'NOT_FOUND');
select test.login('gb_h');
select test.check((select croc_activity(test.id('cr_s1')) ->> 'enabled' = 'true'), 'M Pillar''s Department Head can');
select test.login('sa');
select test.check((select croc_activity(test.id('cr_s1')) ->> 'enabled' = 'true'), 'the Super Admin can');
select test.login('cr_s3');
select test.check((select croc_activity() ->> 'enabled' = 'false' and croc_activity() ->> 'reason' = 'NOT_ENABLED'), 'someone without an approved mapping sees Crocodial switched off');
select test.login('cr_tl1');
select test.must_fail($$select croc_activity(test.id('cr_s3'))$$, 'and nobody learns whether another person is mapped', 'NOT_FOUND');
select test.login('cr_s1');
select test.must_fail($$select croc_activity(null, current_date, current_date - 1)$$, 'a period that ends before it starts is refused', 'VALIDATION_ERROR');
select test.must_fail($$select croc_activity(null, current_date - 200, current_date)$$, 'at most 93 days', 'VALIDATION_ERROR');
reset role;

\echo '   unavailable is not zero; old data is labelled'
update crocodial_sync_state set last_ok_at = now() - interval '2 days' where connection_id = (select id from ca where k = 'c1');
set role authenticated;
select test.login('cr_s1');
select test.check((select croc_activity() ->> 'stale' = 'true' and croc_activity() ->> 'available' = 'true'), 'data older than 24 hours is labelled stale');
reset role;
update crocodial_sync_state set last_ok_at = null where connection_id = (select id from ca where k = 'c1') and resource = 'call-logs';
set role authenticated;
select test.login('cr_s1');
select test.check((select croc_activity() ->> 'available' = 'false' and not (croc_activity() ? 'calls')), 'never fully synced: no figures at all (not zeros)');
reset role;
update crocodial_department_links set enabled = false where connection_id = (select id from ca where k = 'c1');
update crocodial_department_links set enabled = false where connection_id = (select id from ca where k = 'c2');
set role authenticated;
select test.login('cr_s1');
select test.check((select croc_activity() ->> 'enabled' = 'false'), 'the department switched off: nothing is shown');
reset role;

-- clean up
delete from ba_demos where title like 'CR demo %';
delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_ACTTEST%';
\echo '=== CROCODIAL ACTIVITY TESTS PASSED ==='
