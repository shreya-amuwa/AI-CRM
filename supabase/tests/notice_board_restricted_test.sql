-- =============================================================================
-- Notice Board: managed only by the Super Admin, HR and the named CRM team (Ashish, Shreya, Siddhesh), a company-wide popup queue until acknowledged
-- (migration 20270202000100). Runs after notice_board_test.sql and developer_bugs_test.sql (dv_shreya, dv_ashish, dv_siddhesh: the Developers team; dv_other: an
-- AI Studio developer who is not in it) and uses their other users: sa, hr_head, iss_hr_tm (HR), dh_wab, th_wab, tm_a, tm_b, ba_a, tc_dash, acc_m, dh_acc, ac_p (Operations Head).
-- Own notices (titles 'NR %'). "42501" is the SQLSTATE the API turns into HTTP 403.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 143. Notice Board: restricted management, company popup, acknowledgement'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270202000100_notice_board_restricted_popup.sql
\i supabase/migrations/20270202000100_notice_board_restricted_popup.sql
delete from company_notices where title like 'NR %';
delete from notice_board_managers;
delete from dev_team_members where profile_id = test.id('dv_other');
create or replace function test.must_fail_state(p_sql text, p_label text, p_state text) returns void language plpgsql as $$
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
create temp table nr (k text primary key, v text);
grant all on nr to authenticated, anon, service_role;
create function pg_temp.nv(p_k text) returns text language sql stable as $$ select v from nr where k = p_k $$;
grant execute on function pg_temp.nv(text) to authenticated, anon;
create or replace function test.nr(p_title text) returns public.company_notices language sql stable security definer set search_path = '' as $$
  select * from public.company_notices where title = p_title limit 1 $$;
create or replace function test.nr_send(p_title text, p_key text, p_priority text default 'NORMAL', p_extra jsonb default '{}') returns jsonb language sql as $$
  select notice_publish(jsonb_build_object('title', p_title, 'body', 'Full text of ' || p_title, 'category', 'POLICY', 'priority', p_priority, 'audienceType', 'COMPANY',
                                           'clientRequestId', p_key) || p_extra) $$;
create or replace function test.nr_pending_titles() returns text language sql stable as $$
  select coalesce(string_agg(x ->> 'title', ' | ' order by ord), '') from jsonb_array_elements(notice_pending() -> 'items') with ordinality t(x, ord) where x ->> 'title' like 'NR %' $$;
grant execute on all functions in schema test to anon, authenticated, service_role;

\echo '   who manages: the CRM team by profile id, HR, the Super Admin - and nobody else'
-- the migration seeds from the Developers team; here the fixtures are created after it ran, so the same sync is run (it is what the migration and the trigger call)
-- (Siddhesh has two accounts in the fixtures: the one named like him, and the one with his sign-in email siddhesh.amuwa@gmail.com, which is how the Developers team recognises him)
select test.check(private.notice_manager_sync() = 4, 'the sync finds exactly Shreya, Ashish and Siddhesh (his two accounts) among the Developers team');
select test.check((select count(*) = 4 from notice_board_managers where profile_id in (test.id('dv_shreya'), test.id('dv_ashish'), test.id('dv_siddhesh'), test.id('dv_sid_mail'))),
  'as named accounts (profile ids)');
select test.check(not exists (select 1 from notice_board_managers where profile_id in (test.id('dv_other'), test.id('sa'))), 'nobody else is in the list, not the Super Admin');
select test.check(private.notice_publisher_role(test.id('dv_ashish')) = 'CRM_TEAM' and private.notice_publisher_role(test.id('dv_shreya')) = 'CRM_TEAM'
                  and private.notice_publisher_role(test.id('dv_siddhesh')) = 'CRM_TEAM', 'Ashish, Shreya and Siddhesh manage notices');
select test.check(private.notice_publisher_role(test.id('hr_head')) = 'HR' and private.notice_publisher_role(test.id('iss_hr_tm')) = 'HR', 'authorised HR manages notices');
select test.check(private.notice_publisher_role(test.id('sa')) = 'SUPER_ADMIN', 'the Super Admin manages notices');
select test.check(private.notice_publisher_role(test.id('dh_wab')) is null and private.notice_publisher_role(test.id('th_wab')) is null and private.notice_publisher_role(test.id('tm_a')) is null
                  and private.notice_publisher_role(test.id('ba_a')) is null and private.notice_publisher_role(test.id('tc_dash')) is null and private.notice_publisher_role(test.id('acc_m')) is null
                  and private.notice_publisher_role(test.id('dh_acc')) is null, 'Department Heads, Team Leads, Team Members, Business Associates, Technical Consultants and Accounts do not');
select test.check(private.notice_publisher_role(test.id('ac_p')) is null, 'an Operations Head does not (the Department Head role alone grants nothing)');
select test.check(private.notice_publisher_role(test.id('dv_other')) is null, 'another AI Studio developer does not');
insert into dev_team_members (profile_id) values (test.id('dv_other')) on conflict do nothing;
select test.check(private.notice_manager_sync() = 0 and private.notice_publisher_role(test.id('dv_other')) is null, 'a developer added to the Developers team later is NOT a notice manager (the team is not the permission)');
-- a stranger with the same name is not picked: Member B called "Ashish Sinha" is not in the Developers team
update profiles set full_name = 'Ashish Sinha' where id = test.id('tm_b');
select test.check(private.notice_manager_sync() = 0 and private.notice_publisher_role(test.id('tm_b')) is null, 'a same-named employee outside the Developers team gets nothing (a name alone grants nothing)');
update profiles set full_name = 'Member B' where id = test.id('tm_b');
delete from dev_team_members where profile_id = test.id('dv_other');

\echo '   an ordinary employee has no management access (403) and no way round it'
set role authenticated;
do $$
declare
  r text;
begin
  foreach r in array array['tm_a', 'tm_b', 'th_wab', 'dh_wab', 'ba_a', 'tc_dash', 'acc_m', 'dh_acc', 'ac_p', 'dv_other'] loop
    perform test.login(r);
    perform test.must_fail_state(format($q$select test.nr_send('NR by %s', 'nr-denied-%s')$q$, r, r), r || ' cannot publish', '42501');
    perform test.must_fail_state($q$select notice_list('MINE')$q$, r || ' has no "my published notices"', '42501');
    if (notice_audience_options() ->> 'canPublish')::boolean then raise exception 'TEST FAILED: % is offered Send Notice', r; end if;
  end loop;
  raise notice 'ok - ten kinds of employee: publishing is refused (42501), there is no management list, no Send Notice';
end $$;
select test.login('tm_a');
select test.must_fail_state($$select notice_managers()$$, 'nor see who the managers are', '42501');
select test.must_fail_state(format($$select notice_manager_set('%s', true)$$, test.id('tm_a')), 'nor make themselves a manager', '42501');
select test.must_fail_state($$insert into notice_board_managers (profile_id) values (test.id('tm_a'))$$, 'nor write the managers table', '42501');
select test.must_fail_state($$insert into company_notices (reference, title, body, category, audience_type, publisher_id, publisher_role, client_request_id)
  values ('X', 'NR Direct', 'x', 'GENERAL', 'COMPANY', test.id('tm_a'), 'CRM_TEAM', 'nr-direct-1')$$, 'nor write the notices table', '42501');
select test.login('ac_p');
select test.must_fail_state($$select notice_manager_set(test.id('ac_p'), true)$$, 'an Operations Head cannot add themselves either', '42501');
select test.login('dv_ashish');
select test.must_fail_state($$select notice_manager_set(test.id('tm_a'), true)$$, 'even the CRM team cannot add people: only the Super Admin does', '42501');
reset role;

\echo '   the CRM team, HR and the Super Admin publish to all employees'
insert into nr select 'active', count(*)::text from profiles where status = 'ACTIVE';
set role authenticated;
select test.login('dv_ashish');
select test.check((select (o ->> 'canPublish')::boolean and o ->> 'role' = 'CRM_TEAM' and o -> 'audiences' ->> 0 = 'COMPANY' from (select notice_audience_options() o) x),
  'Ashish is offered Send Notice, with "entire company" first (the default audience: all employees)');
insert into nr select 'urgent', test.nr_send('NR Office closed', 'nr-key-0001', 'URGENT') ->> 'id';
select test.check((select status = 'PUBLISHED' and publisher_role = 'CRM_TEAM' and priority = 'URGENT' and audience_type = 'COMPANY' from test.nr('NR Office closed')),
  'Ashish publishes a company notice: saved as published, urgent, to the entire company');
select test.login('dv_shreya');
select test.check((test.nr_send('NR Shreya notice', 'nr-key-0002', 'IMPORTANT') ->> 'status') = 'PUBLISHED', 'Shreya publishes');
select test.login('dv_siddhesh');
select test.check((test.nr_send('NR Siddhesh notice', 'nr-key-0003', 'NORMAL') ->> 'status') = 'PUBLISHED', 'Siddhesh publishes');
select test.login('hr_head');
select test.check((test.nr_send('NR HR notice', 'nr-key-0004', 'NORMAL') ->> 'publisherRole') = 'HR', 'HR publishes');
select test.login('sa');
select test.check((test.nr_send('NR Super Admin notice', 'nr-key-0005', 'NORMAL') ->> 'publisherRole') = 'SUPER_ADMIN', 'the Super Admin publishes');
reset role;

\echo '   everybody is notified once, durably; a retry notifies nobody twice'
select test.check((select count(*) = (select count(*) - 1 from profiles where status = 'ACTIVE') from notifications where type = 'COMPANY_NOTICE' and entity_id = (test.nr('NR Office closed')).id),
  'a notification for every active employee except the publisher');
select test.check((select count(*) = (select count(*) from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id) from notifications where type = 'COMPANY_NOTICE' and entity_id = (test.nr('NR Office closed')).id),
  'one per recipient: the recipient list and the bells agree');
select test.check((select title = 'New Company Notice: NR Office closed' and priority = 'urgent' and body like 'A new URGENT notice has been published by Ashish Sinha on % Open it to read and acknowledge.'
                          and data ->> 'priority' = 'URGENT' and data ->> 'publisher' = 'Ashish Sinha' and (data ->> 'noticeId')::uuid = entity_id and entity_type = 'company_notice'
                     from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nr('NR Office closed')).id),
  'the bell carries the title, the priority, the publisher and the time, and links to the notice');
set role authenticated;
select test.login('dv_ashish');
select test.check((test.nr_send('NR Office closed', 'nr-key-0001', 'URGENT') ->> 'duplicate')::boolean, 'the same publish sent again returns the first notice');
reset role;
select test.check((select jsonb_array_length(private.notice_release((test.nr('NR Office closed')).id, false) -> 'ids') = 0 and (private.notice_release((test.nr('NR Office closed')).id, false) ->> 'notified')::int = 0), 'a retry of the release notifies nobody again');
select test.check((select count(*) = (select count(*) from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id) from notifications where type = 'COMPANY_NOTICE' and entity_id = (test.nr('NR Office closed')).id),
  'still one bell per recipient after the retries');

\echo '   the popup queue: persistent, ordered, acknowledged once'
set role authenticated;
select test.login('tm_a');
select test.check((notice_pending() ->> 'pending')::int >= 5, 'an employee who was offline finds the notices waiting (a persistent list, not a realtime message)');
select test.check(test.nr_pending_titles() = 'NR Office closed | NR Shreya notice | NR Siddhesh notice | NR HR notice | NR Super Admin notice',
  'Urgent first, then Important, then Normal; the oldest first inside a priority');
select test.check((select x ->> 'body' = 'Full text of NR Office closed' and x ->> 'publisherName' = 'Ashish Sinha' and x ->> 'category' = 'POLICY' and x ->> 'publishAt' is not null
                          and (x ->> 'recipientCount')::int = 0 and (x ->> 'acknowledgedCount')::int = 0
                     from jsonb_array_elements(notice_pending() -> 'items') x where x ->> 'title' = 'NR Office closed'),
  'each carries the whole text, category, publisher and time; the managers'' counts are not shown to an employee');
insert into nr select 'ack_at', (notice_acknowledge((test.nr('NR Office closed')).id) ->> 'acknowledgedAt');
select test.check(position('NR Office closed' in test.nr_pending_titles()) = 0, 'after acknowledging, the notice is no longer in the queue');
select test.check((notice_acknowledge((test.nr('NR Office closed')).id) ->> 'acknowledgedAt') = pg_temp.nv('ack_at'), 'acknowledging twice changes nothing (the first time stays)');
reset role;
select test.check((select count(*) = 1 from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id and profile_id = test.id('tm_a') and acknowledged_at is not null and read_at is not null),
  'one record per employee and notice, read and acknowledged');
select test.check(not exists (select 1 from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nr('NR Office closed')).id and read_at is null), 'its bell notification is read');
select test.check((select count(*) = 1 from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id and profile_id = test.id('tm_b') and acknowledged_at is null),
  'a colleague''s acknowledgement is not affected');
set role authenticated;
select test.login('tm_b');
select test.check(position('NR Office closed' in test.nr_pending_titles()) = 1, 'the colleague still has it in their queue');
select test.must_fail_state($$update company_notice_recipients set acknowledged_at = now() where profile_id = test.id('tm_a')$$, 'nobody writes the receipts directly, so nobody changes another employee''s status', '42501');
select test.must_fail_state($$select notice_acknowledge('00000000-0000-4000-8000-0000000000aa')$$, 'a notice that does not exist cannot be acknowledged', 'P0002');
select test.login('dv_ashish');
select test.must_fail_state(format($$select notice_acknowledge('%s')$$, (test.nr('NR Office closed')).id), 'the publisher is not a recipient: nothing to acknowledge', 'P0002');
select test.login('tm_a');
select test.check((select count(*) = 0 from jsonb_array_elements(notice_list('INBOX', p_limit => 100) -> 'items') x where x ->> 'title' = 'NR Office closed' and (x ->> 'acknowledged')::boolean = false),
  'the employee''s history keeps the acknowledged notice, marked acknowledged');
select test.check((select (x ->> 'acknowledged')::boolean and x ->> 'acknowledgedAt' is not null from jsonb_array_elements(notice_list('INBOX', p_limit => 100) -> 'items') x where x ->> 'title' = 'NR Office closed'),
  'with when they acknowledged it');

\echo '   the managers see who read and acknowledged'
select test.login('dv_shreya');
select test.check((select (r ->> 'total')::int = pg_temp.nv('active')::int - 1 and (r ->> 'acknowledged')::int = 1 and (r ->> 'notAcknowledged')::int = (r ->> 'total')::int - 1
                          and (r ->> 'read')::int = 1 and (r ->> 'readPercent')::numeric > 0 and (r ->> 'acknowledgedPercent')::numeric = round(100.0 / (r ->> 'total')::int, 1)
                          and exists (select 1 from jsonb_array_elements(r -> 'rows') x where (x ->> 'profileId')::uuid = test.id('tm_a') and x ->> 'acknowledgedAt' is not null and x ->> 'readAt' is not null)
                          and exists (select 1 from jsonb_array_elements(r -> 'rows') x where (x ->> 'profileId')::uuid = test.id('tm_b') and x ->> 'acknowledgedAt' is null)
                     from (select notice_receipts((test.nr('NR Office closed')).id) r) s),
  'a notice manager (even one who did not write it) sees targeted, read, not read, acknowledged, the percentages and each employee''s status and time');
select test.login('hr_head');
select test.check((notice_receipts((test.nr('NR Office closed')).id) ->> 'total')::int > 0, 'so does HR');
select test.login('tm_a');
select test.must_fail_state(format($$select notice_receipts('%s')$$, (test.nr('NR Office closed')).id), 'an employee does not', 'P0002');
select test.must_fail_state(format($$select notice_update('%s', '{"title":"NR Hacked"}')$$, (test.nr('NR Office closed')).id), 'cannot edit', 'P0002');
select test.must_fail_state(format($$select notice_archive('%s')$$, (test.nr('NR Office closed')).id), 'cannot archive', 'P0002');

\echo '   an edit: asking everyone again only when the change matters'
select test.login('dv_ashish');
select test.check((notice_update((test.nr('NR Office closed')).id, jsonb_build_object('body', 'Full text of NR Office closed (typo fixed)', 'version', 1)) ->> 'version')::int = 2, 'a minor edit saves a new version');
reset role;
select test.check((select acknowledged_at is not null from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id and profile_id = test.id('tm_a')), 'and keeps every acknowledgement');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nr('NR Office closed')).id), 'and sends nothing new');
set role authenticated;
select test.login('dv_ashish');
select test.check((notice_update((test.nr('NR Office closed')).id, jsonb_build_object('body', 'The office is closed on Friday AND Saturday.', 'acknowledgeAgain', true, 'version', 2)) ->> 'version')::int = 3,
  'a material change, with "acknowledge again"');
reset role;
select test.check((select acknowledged_at is null and acknowledged_version is null and read_at is not null from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id and profile_id = test.id('tm_a')),
  'clears the acknowledgements (the read time stays)');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nr('NR Office closed')).id and title = 'Updated Company Notice: NR Office closed'
                          and body like 'This URGENT notice was changed by Ashish Sinha on % Please read it again and acknowledge.' and read_at is null),
  'everyone is told once more, unread');
set role authenticated;
select test.login('tm_a');
select test.check(position('NR Office closed' in test.nr_pending_titles()) = 1, 'and it is in the popup queue again');
select notice_acknowledge((test.nr('NR Office closed')).id);
reset role;
select test.check((select count(*) = 1 from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id and profile_id = test.id('tm_a') and acknowledged_version = 3), 'acknowledging again records the new version');
set role authenticated;

\echo '   expiry and archiving: out of the popup, kept in the history'
reset role;
update company_notices set expires_at = now() - interval '1 minute', publish_at = now() - interval '2 days', released_at = now() - interval '2 days' where title = 'NR Shreya notice';
set role authenticated;
select test.login('tm_b');
select test.check(position('NR Shreya notice' in test.nr_pending_titles()) = 0, 'an expired notice no longer opens as a popup');
select test.check(not exists (select 1 from jsonb_array_elements(notice_list('INBOX', p_limit => 100) -> 'items') x where x ->> 'title' = 'NR Shreya notice'), 'nor sits in the default list');
select test.check(exists (select 1 from jsonb_array_elements(notice_list('INBOX', p_include_expired => true, p_limit => 100) -> 'items') x where x ->> 'title' = 'NR Shreya notice' and (x ->> 'expired')::boolean),
  'but stays in the history, marked expired');
select test.login('dv_shreya');
select test.check(exists (select 1 from jsonb_array_elements(notice_list('MINE', p_include_expired => true, p_limit => 100) -> 'items') x where x ->> 'title' = 'NR Shreya notice'), 'managers see it in their published notices');
select test.login('dv_siddhesh');
select test.check((notice_archive((test.nr('NR Siddhesh notice')).id) ->> 'status') = 'ARCHIVED', 'archiving a notice');
select test.login('tm_b');
select test.check(position('NR Siddhesh notice' in test.nr_pending_titles()) = 0, 'removes it from the popup queue');
reset role;
select test.check((select count(*) >= 1 from company_notice_recipients where notice_id = (test.nr('NR Siddhesh notice')).id) and (select count(*) = 1 from company_notices where title = 'NR Siddhesh notice'),
  'the notice and its recipient records are kept');
select test.check((select count(*) = 1 from company_notice_recipients where notice_id = (test.nr('NR Office closed')).id and profile_id = test.id('tm_a') and acknowledged_at is not null),
  'acknowledgements survive');

\echo '   the Super Admin manages the CRM team (by profile id, audited)'
set role authenticated;
select test.login('sa');
select test.check((select jsonb_array_length(m -> 'managers') = 4 and not exists (select 1 from jsonb_array_elements(m -> 'candidates') c where (c ->> 'profileId')::uuid in (test.id('dv_ashish'), test.id('dv_shreya')))
                     from (select notice_managers() m) s), 'the list shows the CRM team, and offers the others');
select test.check((notice_manager_set(test.id('tm_a'), true) ->> 'manager')::boolean, 'the Super Admin adds a person');
select test.login('tm_a');
select test.check((notice_audience_options() ->> 'canPublish')::boolean, 'who can then publish');
select test.login('sa');
select test.check(not (notice_manager_set(test.id('tm_a'), false) ->> 'manager')::boolean, 'and removes them');
select test.login('tm_a');
select test.check(not (notice_audience_options() ->> 'canPublish')::boolean, 'who can then not');
select test.must_fail_state($$select test.nr_send('NR Removed', 'nr-key-0099')$$, 'a removed manager is refused (42501)', '42501');
reset role;
select test.check((select count(*) = 2 from audit_logs where action in ('NOTICE_MANAGER_ADDED', 'NOTICE_MANAGER_REMOVED') and entity_id = test.id('tm_a')), 'both changes are audited');
update profiles set status = 'SUSPENDED' where id = test.id('dv_siddhesh');
select test.check(private.notice_publisher_role(test.id('dv_siddhesh')) is null, 'a suspended CRM team member loses access at once');
update profiles set status = 'ACTIVE' where id = test.id('dv_siddhesh');
select test.check(private.notice_publisher_role(test.id('dv_siddhesh')) = 'CRM_TEAM', 'and has it back when active again');

\echo '   an old read receipt counts as acknowledged, once, when the column is added'
update company_notice_recipients set read_at = now() - interval '1 hour', acknowledged_at = null, acknowledged_version = null
 where notice_id = (test.nr('NR HR notice')).id and profile_id = test.id('tm_a');
update company_notice_recipients set read_at = null, acknowledged_at = null where notice_id = (test.nr('NR HR notice')).id and profile_id = test.id('tm_b');
alter table company_notice_recipients drop column acknowledged_at;
alter table company_notice_recipients drop column acknowledged_version;
\i supabase/migrations/20270202000100_notice_board_restricted_popup.sql
select test.check((select acknowledged_at = read_at and acknowledged_version = 1 from company_notice_recipients where notice_id = (test.nr('NR HR notice')).id and profile_id = test.id('tm_a')),
  'the migration marks an already-read notice as acknowledged (at its read time)');
select test.check((select acknowledged_at is null from company_notice_recipients where notice_id = (test.nr('NR HR notice')).id and profile_id = test.id('tm_b')), 'an unread one stays pending');
update company_notice_recipients set acknowledged_at = null where notice_id = (test.nr('NR HR notice')).id and profile_id = test.id('tm_a');
\i supabase/migrations/20270202000100_notice_board_restricted_popup.sql
select test.check((select acknowledged_at is null from company_notice_recipients where notice_id = (test.nr('NR HR notice')).id and profile_id = test.id('tm_a')), 'running the migration again does not touch anyone''s status');

\echo '   anonymous callers'
set role anon;
select test.must_fail_state($$select notice_pending()$$, 'anonymous: the popup queue', '42501');
select test.must_fail_state($$select notice_acknowledge('00000000-0000-4000-8000-0000000000aa')$$, 'anonymous: acknowledge', '42501');
select test.must_fail_state($$select notice_managers()$$, 'anonymous: the managers', '42501');
reset role;

delete from company_notices where title like 'NR %';
delete from notice_board_managers where profile_id not in (test.id('dv_shreya'), test.id('dv_ashish'), test.id('dv_siddhesh'), test.id('dv_sid_mail'));
select set_config('request.jwt.claims', '', false);
