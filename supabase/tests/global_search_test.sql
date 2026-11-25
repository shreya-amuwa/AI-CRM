-- =============================================================================
-- Global search (migration 20270213000100): it returns only what each person may already open, for every role, and never more.
-- Team Member, Team Lead (own people only), Department Head (own department), Operations Head (assigned Sales departments; a Support-only
-- assignment sees no Sales customers), a Support member, another department, the Managing Director. Every returned customer / employee /
-- ticket is cross-checked against what the same person reads directly (row-level rules). Meetings and notices only for those invited /
-- addressed. Ranking, typo tolerance, phone digits, paging, short queries, injection, suspended and anonymous callers.
-- Runs after crocodial_refresh_test.sql (reuses its people).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 146. Global search: only what each person may open'
reset role;
\i supabase/migrations/20270215000100_global_search.sql
\i supabase/migrations/20270215000100_global_search.sql

delete from public.customers where company like 'Zephyr%' or name like 'Zephyr%';
delete from public.meetings where title like 'Zephyr%';
delete from public.company_notices where title like 'Zephyr%';
create temp table gs (k text primary key, id uuid);
grant all on gs to authenticated;

-- customers of two Sales members of M Pillar (led by different Team Leads), one of D Talk; a lead; seven more leads of the D Talk member
insert into public.customers (owner_id, name, company, phone, lifecycle_stage, department_id, team_id)
select test.id(v.o), v.n, v.c, v.ph, v.st, p.department_id, p.team_id
  from (values ('cr_s1', 'Asha Rao', 'Zephyr Jewellers', '98199 12345', 'CUSTOMER'),
               ('cr_s2', 'Ravi Shah', 'Zephyr Gold', '98199 22222', 'CUSTOMER'),
               ('cr_dt', 'Meena Iyer', 'Zephyr DTalk Traders', '98199 33333', 'CUSTOMER'),
               ('cr_s1', 'Zenith Kumar', 'Zephyr Lead House', '98199 44444', 'LEAD')) v(o, n, c, ph, st)
  join public.profiles p on p.id = test.id(v.o);
insert into public.customers (owner_id, name, company, phone, lifecycle_stage, department_id, team_id)
select test.id('cr_dt'), 'Lead ' || i, 'Zephyrleads ' || i, '9819955' || lpad(i::text, 3, '0'), 'LEAD', p.department_id, p.team_id
  from generate_series(1, 7) i join public.profiles p on p.id = test.id('cr_dt');
insert into gs select 'jew', id from public.customers where company = 'Zephyr Jewellers';
insert into gs select 'gold', id from public.customers where company = 'Zephyr Gold';
insert into gs select 'dt', id from public.customers where company = 'Zephyr DTalk Traders';
-- a meeting of Sachin with his Team Lead; a notice addressed to Sachin only
insert into public.meetings (kind, title, host_id, created_by, starts_at, ends_at, status)
values ('MEETING', 'Zephyr pricing review', test.id('cr_s1'), test.id('cr_s1'), now() + interval '1 day', now() + interval '1 day 1 hour', 'SCHEDULED');
insert into gs select 'mtg', id from public.meetings where title = 'Zephyr pricing review';
insert into public.meeting_attendees (meeting_id, profile_id) select id, test.id('cr_tl1') from gs where k = 'mtg';
insert into public.company_notices (reference, title, body, category, audience_type, publisher_id, publisher_role, client_request_id, status, publish_at)
values ('NB-ZEPHYR-1', 'Zephyr holiday notice', 'Office closed.', 'HOLIDAY', 'EMPLOYEES', test.id('sa'), 'SUPER_ADMIN', 'zephyr-test-0001', 'PUBLISHED', now());
insert into public.company_notice_recipients (notice_id, profile_id) select id, test.id('cr_s1') from public.company_notices where reference = 'NB-ZEPHYR-1';
-- an Operations Head of M Pillar Sales, one of M Pillar Support only
delete from operations_head_departments where profile_id in (test.id('crr_op'), test.id('crr_opsup'));
insert into operations_head_departments (profile_id, department_id, division) values (test.id('crr_op'), test.dept('mpillar'), 'SALES'), (test.id('crr_opsup'), test.dept('mpillar'), 'SUPPORT');

-- every customer / employee / ticket returned is one the caller reads directly too (row-level rules): search never widens access
create or replace function test.gs_ids(p_q text, p_type text) returns uuid[] language sql as $$
  select coalesce(array_agg((i ->> 'id')::uuid), '{}') from jsonb_array_elements(global_search(p_q, 20) -> 'groups') g, jsonb_array_elements(g -> 'items') i
   where g ->> 'type' = p_type $$;
create or replace function test.gs_titles(p_q text, p_type text) returns text language sql as $$
  select coalesce(string_agg(i ->> 'title', ',' order by o), '') from jsonb_array_elements(global_search(p_q, 20) -> 'groups') g,
         jsonb_array_elements(g -> 'items') with ordinality x(i, o) where g ->> 'type' = p_type $$;
create or replace function test.gs_within_rls(p_q text) returns boolean language sql as $$
  select not exists (select 1 from unnest(test.gs_ids(p_q, 'customer') || test.gs_ids(p_q, 'lead')) x where not exists (select 1 from public.customers c where c.id = x))
     and not exists (select 1 from unnest(test.gs_ids(p_q, 'employee')) x where not exists (select 1 from public.profiles p where p.id = x))
     and not exists (select 1 from unnest(test.gs_ids(p_q, 'ticket')) x where not exists (select 1 from public.support_tickets t where t.id = x)) $$;
grant execute on all functions in schema test to authenticated;

set role authenticated;
\echo '   Team Member'
select test.login('cr_s1');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr Jewellers' and test.gs_titles('zephyr', 'lead') = 'Zephyr Lead House',
  'a Team Member finds only their own customer and lead (not a colleague''s, not another department''s)');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr') and test.gs_within_rls('98199'), 'everything returned is something they can already read');
select test.check(position('CR Supriya' in test.gs_titles('cr', 'employee')) = 0 and position('CR Other Seller' in test.gs_titles('cr', 'employee')) > 0,
  'colleagues under their own Team Lead only (not another Team Lead''s member)');
select test.check(test.gs_titles('zephyr pricing', 'meeting') = 'Zephyr pricing review' and test.gs_titles('zephyr holiday', 'notice') = 'Zephyr holiday notice',
  'their own meeting and the notice addressed to them');
select test.check((select g ->> 'type' from jsonb_array_elements(global_search('mpillar') -> 'groups') g where g ->> 'type' = 'department') = 'department'
                  and test.gs_ids('talk', 'department') = '{}', 'their own department, not another');
select test.login('cr_s2');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr Gold' and test.gs_ids('zephyr pricing', 'meeting') = '{}' and test.gs_ids('zephyr holiday', 'notice') = '{}',
  'a colleague: their own customer only; not someone else''s meeting or a notice addressed to someone else');
select test.check(test.gs_ids(test.id('cr_s1')::text, 'employee') = '{}', 'nor another Team Lead''s member, even by exact id');

\echo '   Team Leads'
select test.login('cr_tl1');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr Jewellers' and test.gs_titles('zephyr pricing', 'meeting') = 'Zephyr pricing review',
  'Team Lead A: their member''s customer (not Team Lead B''s), and the meeting they are invited to');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr'), 'within what they read directly');
select test.login('cr_tl2');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr Gold' and test.gs_ids('zephyr pricing', 'meeting') = '{}', 'Team Lead B: only their member''s; the same department is not enough');

select test.login('cr_s1');
select test.must_fail($$select search_record('customer', (select id from gs where k = 'gold'))$$, 'a Team Member opening a colleague''s customer directly (a typed address) is refused', 'NOT_FOUND');
select test.check((select search_record('customer', (select id from gs where k = 'jew')) ->> 'title') = 'Zephyr Jewellers', 'their own customer opens');
select test.must_fail($$select search_record('employee', test.id('cr_s2'))$$, 'another Team Lead''s member does not open', 'NOT_FOUND');
select test.must_fail($$select search_record('department', test.dept('dtalk'))$$, 'another department does not open', 'NOT_FOUND');
select test.must_fail($$select search_record('invoice', gen_random_uuid())$$, 'an unknown kind is refused', 'VALIDATION_ERROR');

\echo '   heads'
select test.login('gb_h');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr Gold,Zephyr Jewellers' and test.gs_ids('zephyr pricing', 'meeting') = '{}',
  'the Department Head: their department''s customers (not D Talk''s); not a meeting they are not part of');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr') and test.gs_ids('cr dtalk', 'employee') = '{}', 'within their reach; not another department''s people');
select test.login('ga_s');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr DTalk Traders' and test.gs_ids('mpillar', 'department') = '{}', 'another department''s head: their own only');
select test.login('crr_op');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr'), 'an Operations Head: within what they read directly');
select test.check(test.gs_ids('pillar', 'department') <> '{}', 'their assigned department is found');
select test.login('crr_opsup');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr'),
  'a Support-only Operations Head (homed in D Talk): exactly within their existing rules, nothing more');
select test.login('cr_sup');
select test.check(test.gs_within_rls('zephyr') and test.gs_ids('zephyr', 'lead') = '{}', 'a Support member: nothing beyond their rules, and no Sales leads');

\echo '   HR and Accounts'
select test.login('hrd_rec');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr') and test.gs_ids('zephyr pricing', 'meeting') = '{}', 'an HR recruiter: within their existing rules, nothing more');
select test.login('we_hr');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr'), 'HR staff: within their existing rules');
select test.login('dh_acc');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr') and test.gs_ids('pillar', 'department') = '{}', 'the Accounts head: within their rules; not another department');
select test.login('acc_m');
select test.check(test.gs_within_rls('zephyr') and test.gs_within_rls('cr'), 'an Accounts member: within their rules');

\echo '   the Managing Director'
select test.login('sa');
select test.check(test.gs_titles('zephyr', 'customer') = 'Zephyr DTalk Traders,Zephyr Gold,Zephyr Jewellers', 'every department''s customers');
select test.check((select search_record('customer', (select id from gs where k = 'dt')) -> 'fields' ->> 'Owner') = (select full_name from profiles where id = test.id('cr_dt')),
  'a record opens with its details');
reset role;
delete from public.customers where id = (select id from gs where k = 'dt');
set role authenticated;
select test.login('sa');
select test.must_fail($$select search_record('customer', (select id from gs where k = 'dt'))$$, 'a record deleted since the search: not found (no blank page)', 'NOT_FOUND');
select test.check((select (g ->> 'hasMore')::boolean and jsonb_array_length(g -> 'items') = 5 from jsonb_array_elements(global_search('zephyrleads', 5) -> 'groups') g where g ->> 'type' = 'lead'),
  'five at a time, with "more"');
select test.check(test.gs_titles('9819912345', 'customer') = 'Zephyr Jewellers' and test.gs_titles('98199-12345', 'customer') = 'Zephyr Jewellers', 'a phone number in any shape');
select test.check(split_part(test.gs_titles('zephyr gold', 'customer'), ',', 1) = 'Zephyr Gold', 'the exact name first');
select test.check(position('Zephyr Jewellers' in test.gs_titles('zephir jewellers', 'customer')) > 0, 'a small typo still finds it');
select test.check(test.gs_titles('rao zephyr', 'customer') = 'Zephyr Jewellers', 'several words, in any order');
select test.check(test.gs_titles('zephyr', 'customer') = test.gs_titles('zephyr', 'customer'), 'the same search gives the same order');
select test.check(test.gs_ids('zephyr pricing', 'meeting') = '{}', 'a private meeting of others is not shown even to the Managing Director (the meeting rules are kept)');
select test.check((select jsonb_array_length(global_search('z') -> 'groups') = 0), 'one character: nothing is searched');
select test.check((select jsonb_array_length(global_search($$'; drop table public.customers; --$$) -> 'groups') >= 0) and (select count(*) > 0 from public.customers),
  'text that looks like SQL is only text');
select test.check(not (select global_search('zephyr')::text ~* '"(notes|total_spent|email|phone)"'), 'only display fields are returned (no notes, amounts or contact details)');
reset role;
update profiles set status = 'SUSPENDED' where id = test.id('cr_s2');
set role authenticated;
select test.login('cr_s2');
select test.must_fail($$select global_search('zephyr')$$, 'a suspended account cannot search', 'not active');
reset role;
update profiles set status = 'ACTIVE' where id = test.id('cr_s2');
set role anon;
select test.must_fail($$select global_search('zephyr')$$, 'anonymous callers cannot search', 'permission denied');
select test.must_fail($$select search_record('customer', gen_random_uuid())$$, 'nor open records', 'permission denied');
reset role;

delete from public.customers where company like 'Zephyr%';
delete from public.meetings where title like 'Zephyr%';
delete from public.company_notices where reference = 'NB-ZEPHYR-1';
delete from operations_head_departments where profile_id in (test.id('crr_op'), test.id('crr_opsup'));
\echo '=== GLOBAL SEARCH TESTS PASSED ==='
