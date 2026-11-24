-- =============================================================================
-- Notice Board: delete a notice (migration 20270205000100): a safe "soft" delete by the people who already manage notices, and nothing else is lost.
-- Runs after notice_board_restricted_test.sql and uses its people: sa (Super Admin), dv_shreya (CRM team), hr_head (HR), tm_a / tm_b (recipients),
-- dh_wab (Department Head), ac_p (Operations Head). Own notices have titles 'ND %'. "P0002" is the SQLSTATE the API turns into HTTP 404, "42501" into 403.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 144. Notice Board: delete a notice'
reset role;
select set_config('request.jwt.claims', '', false);
-- earlier suites run older copies of the notice functions again: this migration is applied last, twice (it must be safe to run twice)
\i supabase/migrations/20270205000100_notice_board_delete.sql
\i supabase/migrations/20270205000100_notice_board_delete.sql
delete from company_notices where title like 'ND %';
create or replace function test.must_fail_state2(p_sql text, p_label text, p_state text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate <> p_state then raise exception 'TEST FAILED: % (SQLSTATE % instead of %: %)', p_label, sqlstate, p_state, sqlerrm; end if;
    raise notice 'ok - % [%]', p_label, sqlstate;
    return;
  end;
  raise exception 'TEST FAILED: % (statement succeeded)', p_label;
end $$;
create or replace function test.nd(p_title text) returns public.company_notices language sql stable security definer set search_path = '' as $$
  select * from public.company_notices where title = p_title limit 1 $$;
create or replace function test.nd_send(p_title text, p_key text, p_priority text default 'NORMAL', p_extra jsonb default '{}') returns jsonb language sql as $$
  select notice_publish(jsonb_build_object('title', p_title, 'body', 'Full text of ' || p_title, 'category', 'POLICY', 'priority', p_priority, 'audienceType', 'COMPANY',
                                           'clientRequestId', p_key) || p_extra) $$;
create or replace function test.nd_in(p_scope text, p_title text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(notice_list(p_scope, p_limit => 100, p_include_expired => true) -> 'items') x where x ->> 'title' = p_title) $$;
create or replace function test.nd_queued(p_title text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(notice_pending() -> 'items') x where x ->> 'title' = p_title) $$;
-- a count on the tables the app roles cannot read, as the table owner
create or replace function test.nd_q(p_sql text) returns bigint language plpgsql security definer set search_path = '' as $$
declare v bigint; begin execute p_sql into v; return v; end $$;
grant execute on all functions in schema test to anon, authenticated, service_role;
-- a phone for Member A, to see the push that is still waiting
insert into push_subscriptions (id, profile_id, endpoint, p256dh, auth, label, active)
values ('bbbbbbbb-0000-4000-8000-00000000d001', test.id('tm_a'), 'https://push.example.com/nd-1', 'k', 'a', 'Member phone', true)
on conflict (id) do update set active = true, profile_id = excluded.profile_id;
create temp table nd (k text primary key, v text);
grant all on nd to authenticated, anon, service_role;

\echo '   1. Set up: three published notices and a scheduled one'
set role authenticated;
select test.login('dv_shreya');
insert into nd select 'n1', (test.nd_send('ND Keep me', 'nd-key-0001', 'IMPORTANT') ->> 'id');
insert into nd select 'n2', (test.nd_send('ND Delete me', 'nd-key-0002', 'URGENT') ->> 'id');
select test.login('hr_head');
insert into nd select 'n3', (test.nd_send('ND HR notice', 'nd-key-0003') ->> 'id');
select test.login('dv_shreya');
insert into nd select 'n4', (test.nd_send('ND Scheduled one', 'nd-key-0004', 'NORMAL', jsonb_build_object('publishAt', (now() + interval '2 days')::text)) ->> 'id');
select test.check((select v from nd where k = 'n4') is not null and (test.nd('ND Scheduled one')).status = 'SCHEDULED', 'a scheduled notice waits');
select test.login('tm_a');
select test.check(test.nd_in('INBOX', 'ND Keep me') and test.nd_in('INBOX', 'ND Delete me') and test.nd_in('INBOX', 'ND HR notice'), 'the recipients see the published notices');
select test.check(test.nd_queued('ND Delete me') and test.nd_queued('ND Keep me'), 'and they wait in the popup queue');
select test.check((notice_acknowledge((select v from nd where k = 'n1')::uuid) ->> 'acknowledged')::boolean, 'Member A acknowledges one of them');
reset role;
select test.check(test.nd_q($q$select count(*) from public.notification_deliveries where kind = 'COMPANY_NOTICE' and tag = 'notice-' || (select v from pg_temp.nd where k = 'n2') and status = 'PENDING'$q$) >= 1, 'a push to the phone is waiting for the notice that will be deleted');

\echo '   2. Who may NOT delete (nothing changes)'
set role authenticated;
select test.login('tm_a');
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n2')), 'a recipient (Team Member) cannot delete', 'P0002');
select test.login('dh_wab');
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n2')), 'a Department Head cannot', 'P0002');
select test.login('ac_p');
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n2')), 'an Operations Head cannot', 'P0002');
select test.login('hr_head');
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n2')), 'HR cannot delete a notice the CRM team published', 'P0002');
select test.login('dv_shreya');
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n3')), 'the CRM team cannot delete HR''s notice', 'P0002');
select test.must_fail_state2($$select notice_delete('00000000-0000-4000-8000-0000000000dd')$$, 'a notice that does not exist', 'P0002');
reset role;
set role anon;
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n2')), 'a visitor cannot', '42501');
reset role;
select test.check((select count(*) = 4 and bool_and(status <> 'DELETED') from company_notices where title like 'ND %'), 'every refusal left all four notices as they were');
-- a person who published one while they managed notices, and no longer does
set role authenticated;
select test.login('sa');
select notice_manager_set(test.id('dv_shreya'), false);
select test.login('dv_shreya');
select test.must_fail_state2(format($$select notice_delete('%s')$$, (select v from nd where k = 'n2')), 'a former manager cannot delete their old notice', '42501');
select test.login('sa');
select notice_manager_set(test.id('dv_shreya'), true);

\echo '   3. The publisher deletes (and a double click does no harm)'
select test.login('dv_shreya');
select test.check((notice_delete((select v from nd where k = 'n2')::uuid) ->> 'deleted')::boolean, 'the publisher deletes their notice');
select test.check((notice_delete((select v from nd where k = 'n2')::uuid) ->> 'alreadyDeleted')::boolean, 'a second click (or a retry) is answered as already done, not as an error');
select test.check(not test.nd_in('MINE', 'ND Delete me') and test.nd_in('MINE', 'ND Keep me'), 'it is gone from "my published notices", the others stay');
select test.check(not test.nd_in('ALL', 'ND Delete me'), 'and from the company notices');
select test.must_fail_state2(format($$select notice_open('%s')$$, (select v from nd where k = 'n2')), 'nobody can open it any more, not even the publisher', 'P0002');
select test.must_fail_state2(format($$select notice_receipts('%s')$$, (select v from nd where k = 'n2')), 'its receipts are not served', 'P0002');
select test.must_fail_state2(format($$select notice_update('%s', '{"title":"ND Back again"}'::jsonb)$$, (select v from nd where k = 'n2')), 'it cannot be edited', 'P0002');
select test.must_fail_state2(format($$select notice_archive('%s')$$, (select v from nd where k = 'n2')), 'nor archived', 'P0002');
select test.login('sa');
select test.check(not test.nd_in('MINE', 'ND Delete me') and not test.nd_in('ALL', 'ND Delete me'), 'the Super Admin does not see it either');
select test.login('tm_a');
select test.check(not test.nd_in('INBOX', 'ND Delete me') and test.nd_in('INBOX', 'ND Keep me'), 'the recipients lose it from their Notice Board and keep the others');
select test.check(not test.nd_queued('ND Delete me') and test.nd_queued('ND HR notice'), 'it leaves the popup queue, so it never comes up again when the CRM is reopened');
select test.must_fail_state2(format($$select notice_open('%s')$$, (select v from nd where k = 'n2')), 'a recipient cannot open it', 'P0002');
select test.must_fail_state2(format($$select notice_acknowledge('%s')$$, (select v from nd where k = 'n2')), 'nor acknowledge it', 'P0002');
select test.check((notice_unread_count() = (select count(*) from jsonb_array_elements(notice_list('INBOX', p_unread => true, p_limit => 100) -> 'items') x)), 'the unread badge agrees with the list');
select test.login('tm_b');
select test.check(not test.nd_queued('ND Delete me') and test.nd_queued('ND Keep me'), 'another recipient who never saw it does not get it either');

\echo '   4. What is kept'
reset role;
select test.check((select status = 'DELETED' and deleted_at is not null and deleted_by = test.id('dv_shreya') from company_notices where id = (select v from nd where k = 'n2')::uuid), 'the row is kept, marked deleted with who and when');
select test.check((select count(*) >= 2 from company_notice_recipients where notice_id = (select v from nd where k = 'n2')::uuid), 'its recipient rows (read receipts) are kept');
select test.check((select count(*) = 1 from company_notice_revisions where notice_id = (select v from nd where k = 'n2')::uuid and action = 'DELETED' and before ->> 'title' = 'ND Delete me'),
  'one revision records the deletion with what it was (a retry added none)');
select test.check(test.nd_q($q$select count(*) from public.audit_logs where action = 'COMPANY_NOTICE_DELETED' and entity_id = (select v from pg_temp.nd where k = 'n2')::uuid$q$) = 1, 'it is audited once');
select test.check(test.nd_q($q$select count(*) from public.notifications where entity_type = 'company_notice' and entity_id = (select v from pg_temp.nd where k = 'n2')::uuid$q$) >= 2
                  and test.nd_q($q$select count(*) from public.notifications where entity_type = 'company_notice' and entity_id = (select v from pg_temp.nd where k = 'n2')::uuid and read_at is null$q$) = 0,
  'the bell notifications stay in the history but are read (no unread count is left pointing at it)');
select test.check(test.nd_q($q$select count(*) from public.notifications where entity_type = 'company_notice' and entity_id = (select v from pg_temp.nd where k = 'n1')::uuid and read_at is null$q$) >= 1, 'the bell notifications of other notices are untouched');
select test.check(test.nd_q($q$select count(*) from public.notification_deliveries where kind = 'COMPANY_NOTICE' and tag = 'notice-' || (select v from pg_temp.nd where k = 'n2') and status = 'PENDING'$q$) = 0
                  and test.nd_q($q$select count(*) from public.notification_deliveries where kind = 'COMPANY_NOTICE' and tag = 'notice-' || (select v from pg_temp.nd where k = 'n2') and last_error = 'NOTICE_DELETED'$q$) >= 1,
  'the push that was still waiting is cancelled');
select test.check((select acknowledged_at is not null from company_notice_recipients where notice_id = (select v from nd where k = 'n1')::uuid and profile_id = test.id('tm_a')), 'an acknowledgement on another notice is intact');
select test.check((select count(*) = 4 from company_notices where title like 'ND %'), 'no other notice was removed');
-- a deleted notice is final even for a direct write by a function that forgot to check
select test.must_fail_state2(format($$update public.company_notices set status = 'PUBLISHED' where id = '%s'$$, (select v from nd where k = 'n2')), 'a deleted notice cannot be brought back by a status change', 'P0002');

\echo '   5. The Super Admin deletes another person''s notice; a scheduled notice never goes out'
set role authenticated;
select test.login('sa');
select test.check((notice_delete((select v from nd where k = 'n3')::uuid) ->> 'deleted')::boolean, 'the Super Admin deletes a notice HR published');
select test.login('hr_head');
select test.check(not test.nd_in('MINE', 'ND HR notice'), 'it leaves HR''s list');
select test.login('dv_shreya');
select test.check((notice_delete((select v from nd where k = 'n4')::uuid) ->> 'deleted')::boolean, 'a scheduled notice can be deleted before it goes out');
reset role;
select test.check((notice_release_due(now() + interval '3 days', false) ->> 'generated')::integer >= 0 and test.nd_q($q$select count(*) from public.company_notice_recipients where notice_id = (select v from pg_temp.nd where k = 'n4')::uuid$q$) = 0,
  'and the scheduler later releases it to nobody');
select test.check((select status = 'DELETED' from company_notices where id = (select v from nd where k = 'n4')::uuid), 'it stays deleted');

\echo '   6. The rest of the Notice Board still works'
set role authenticated;
select test.login('hr_head');
insert into nd select 'n5', (test.nd_send('ND After the delete', 'nd-key-0005', 'NORMAL') ->> 'id');
select test.login('tm_b');
select test.check(test.nd_queued('ND After the delete') and test.nd_in('INBOX', 'ND After the delete'), 'a new notice is published and reaches the recipients as before');
select test.check((notice_acknowledge((select v from nd where k = 'n5')::uuid) ->> 'acknowledged')::boolean and not test.nd_queued('ND After the delete'), 'and is acknowledged as before');
select test.login('hr_head');
select test.check((notice_update((select v from nd where k = 'n5')::uuid, '{"title":"ND After the delete (edited)"}'::jsonb) ->> 'title') = 'ND After the delete (edited)', 'editing a notice still works');
select test.check((notice_archive((select v from nd where k = 'n5')::uuid) ->> 'status') = 'ARCHIVED', 'archiving still works');

reset role;
delete from push_subscriptions where id = 'bbbbbbbb-0000-4000-8000-00000000d001';
delete from company_notices where title like 'ND %';
select set_config('request.jwt.claims', '', false);
\echo '=== ALL NOTICE BOARD DELETE TESTS PASSED ==='
