-- =============================================================================
-- Crocodial (migration 20270115000700): a person's Crocodial leads. Only the leads Crocodial assigns to the person's mapped user on that
-- account; filters, search, masked phones, paging; and who may see them (the person, their own Team Lead, the Department Head, the Super
-- Admin; not a colleague, not another Team Lead, not someone unmapped). Runs after crocodial_activity_test.sql (reuses its people).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 144. Crocodial: a person''s Crocodial leads'
reset role;
\i supabase/migrations/20270115000700_crocodial_leads.sql
\i supabase/migrations/20270115000700_crocodial_leads.sql

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_LEADTEST%';
create temp table cl (k text primary key, id uuid);
grant all on cl to authenticated;
insert into crocodial_connections (name, credential_ref, enabled, timezone) values ('Leads', 'CROCODIAL_TOKEN_LEADTEST', true, 'Asia/Kolkata'), ('Leads other', 'CROCODIAL_TOKEN_LEADTEST_B', true, 'Asia/Kolkata');
insert into cl select 'c1', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_LEADTEST';
insert into cl select 'c2', id from crocodial_connections where credential_ref = 'CROCODIAL_TOKEN_LEADTEST_B';
update crocodial_rollout set allowed = true where department_id = test.dept('mpillar') and division = 'SALES';
insert into crocodial_department_links (connection_id, department_id, division, enabled) select id, test.dept('mpillar'), 'SALES', true from cl;
insert into crocodial_employee_mappings (connection_id, external_employee_id, external_name, profile_id, department_id, division, status, approved_at, effective_from)
values ((select id from cl where k = 'c1'), 4138, 'sachin', test.id('cr_s1'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days'),
       ((select id from cl where k = 'c1'), 371, 'Supriya', test.id('cr_s2'), test.dept('mpillar'), 'SALES', 'APPROVED', now() - interval '5 days', now() - interval '5 days');
-- Sachin's three leads on this account; one of Supriya's; one with no assignee; and user 4138 of ANOTHER account (never Sachin's)
insert into crocodial_ext_leads (connection_id, external_id, name, phone_number, company, city, status, assigned_to_ext, called, next_followup_at, last_interaction_at) values
  ((select id from cl where k = 'c1'), 1, 'Ravi Patel', '+91 98000 00001', 'Ravi Traders', 'Surat', 'Interested', 4138, true, now() - interval '1 day', now() - interval '2 days'),
  ((select id from cl where k = 'c1'), 2, 'Meena Shah', '+919800000002', null, 'Pune', 'New', 4138, false, null, null),
  ((select id from cl where k = 'c1'), 3, 'Arjun Rao', '+919800000003', 'Rao & Co', 'Mumbai', 'Callback', 4138, true, now() + interval '2 days', now() - interval '1 day'),
  ((select id from cl where k = 'c1'), 4, 'Supriya Lead', '+919800000004', null, null, 'New', 371, false, null, null),
  ((select id from cl where k = 'c1'), 5, 'Nobody Lead', '+919800000005', null, null, 'New', null, false, null, null),
  ((select id from cl where k = 'c2'), 1, 'Other Account Lead', '+919800000006', null, null, 'New', 4138, false, null, null);
insert into crocodial_ext_calls (connection_id, external_id, called_by_ext, lead_ext, call_type, call_at, duration_seconds, connected) values
  ((select id from cl where k = 'c1'), 1, 4138, 1, 'outgoing', now() - interval '2 days', 60, true),
  ((select id from cl where k = 'c1'), 2, 4138, 1, 'outgoing', now() - interval '3 days', 0, false);

set role authenticated;
select test.login('cr_s1');
create temp table mine as select croc_leads() as x;
select test.check((select (x -> 'counts' ->> 'all')::int = 3 and (x ->> 'total')::int = 3 from mine),
  'a person sees the leads Crocodial assigns to their mapped user on that account (not another account''s, not someone else''s)');
select test.check((select x -> 'items' -> 0 ->> 'name' = 'Ravi Patel' and (x -> 'items' -> 0 ->> 'followUpDue')::boolean and (x -> 'items' -> 0 ->> 'calls')::int = 2 from mine),
  'follow-ups that are due come first, with how many times the person called that lead');
select test.check((select x -> 'items' -> 0 ->> 'phone' = 'XXXXXX0001' from mine), 'phone numbers are masked (last 4 digits)');
select test.check((select (x -> 'counts' ->> 'neverCalled')::int = 1 and (x -> 'counts' ->> 'followUpDue')::int = 1 from mine), 'the counts per filter');
select test.check((select (croc_leads(null, null, 'NEVER_CALLED') -> 'items' -> 0 ->> 'name') = 'Meena Shah'), 'filter: never called');
select test.check((select (croc_leads(null, null, 'FOLLOW_UP_DUE') ->> 'total')::int = 1), 'filter: follow-up due');
select test.check((select (croc_leads(null, 'rao') -> 'items' -> 0 ->> 'name') = 'Arjun Rao' and (croc_leads(null, 'rao') ->> 'total')::int = 1), 'search by name or company');
select test.check((select (croc_leads(null, '0000-0002') ->> 'total')::int = 1), 'search by phone digits');
select test.check((select (croc_leads(null, null, 'ALL', 2, 2) ->> 'total')::int = 3 and jsonb_array_length(croc_leads(null, null, 'ALL', 2, 2) -> 'items') = 1), 'paging');
select test.must_fail($$select croc_leads(null, null, 'EVERYTHING')$$, 'an unknown filter is refused', 'VALIDATION_ERROR');

select test.login('cr_tl1');
select test.check((select (croc_leads(test.id('cr_s1')) ->> 'total')::int = 3), 'their own Team Lead sees them');
select test.login('cr_tl2');
select test.must_fail($$select croc_leads(test.id('cr_s1'))$$, 'another Team Lead does not', 'NOT_FOUND');
select test.login('cr_s2');
select test.must_fail($$select croc_leads(test.id('cr_s1'))$$, 'a colleague does not', 'NOT_FOUND');
select test.check((select (croc_leads() ->> 'total')::int = 1), 'and sees only their own');
select test.login('gb_h');
select test.check((select (croc_leads(test.id('cr_s1')) ->> 'total')::int = 3), 'the Department Head sees them');
select test.login('sa');
select test.check((select (croc_leads(test.id('cr_s1')) ->> 'total')::int = 3), 'the Super Admin sees them');
select test.login('cr_s3');
select test.check((select (croc_leads() ->> 'enabled')::boolean = false), 'someone not connected: not enabled (nothing shown)');
reset role;
update crocodial_department_links set enabled = false where connection_id in (select id from cl);
set role authenticated;
select test.login('cr_s1');
select test.check((select (croc_leads() ->> 'enabled')::boolean = false), 'switched off: nothing is shown');
reset role;
set role anon;
select test.must_fail($$select croc_leads()$$, 'anonymous callers cannot call it', 'permission denied');
reset role;

delete from crocodial_connections where credential_ref like 'CROCODIAL_TOKEN_LEADTEST%';
\echo '=== CROCODIAL LEADS TESTS PASSED ==='
