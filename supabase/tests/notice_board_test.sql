-- =============================================================================
-- Company Notice Board (migration 20270131000200, and 20270202000100 for who publishes): everyone reads what is addressed to them; only the Super Admin, HR and the
-- CRM team (Ashish, Shreya, Siddhesh: notice_board_managers) publish (see notice_board_restricted_test.sql for the rules); the audience (company, departments, designations, selected employees)
-- decides who is notified (bell + push) and who can read; read receipts; editing keeps the history; archiving; files; scheduled notices.
-- Runs after developer_bugs_test.sql (the developers) and access_control_apply_test.sql (ac_p: Operations Head of Whatsbox and Wabastore).
-- Own notices (titles 'NB %').
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 135c. Company Notice Board'
reset role;
select set_config('request.jwt.claims', '', false);
\i supabase/migrations/20270131000200_company_notice_board.sql
\i supabase/migrations/20270131000200_company_notice_board.sql
-- 20270202000100 narrows who publishes (the Super Admin, HR and the named CRM team) and adds acknowledgement; it replaces the functions above, so it is applied last
\i supabase/migrations/20270202000100_notice_board_restricted_popup.sql
\i supabase/migrations/20270202000100_notice_board_restricted_popup.sql
select private.notice_manager_sync();
delete from company_notices where title like 'NB %';
create temp table nb (k text primary key, v jsonb);
grant all on nb to authenticated;
create or replace function test.nb(p_title text) returns public.company_notices language sql stable security definer set search_path = '' as $$
  select * from public.company_notices where title = p_title limit 1 $$;
create or replace function test.nb_got(p_user text, p_title text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notifications n where n.recipient_id = test.id(p_user) and n.type = 'COMPANY_NOTICE' and n.entity_id = (test.nb(p_title)).id) $$;
create or replace function test.nb_send(p_title text, p_key text, p_extra jsonb) returns jsonb language sql as $$
  select notice_publish(jsonb_build_object('title', p_title, 'body', 'Details of ' || p_title, 'category', 'GENERAL', 'priority', 'NORMAL',
                                           'clientRequestId', p_key) || p_extra) $$;
create or replace function test.nb_inbox(p_title text) returns boolean language sql as $$
  select exists (select 1 from jsonb_array_elements(notice_list('INBOX', p_limit => 100) -> 'items') x where x ->> 'title' = p_title) $$;
grant execute on all functions in schema test to anon, authenticated;
-- a device for a Team Member, to see the push delivery
insert into push_subscriptions (id, profile_id, endpoint, p256dh, auth, label, active)
values ('bbbbbbbb-0000-4000-8000-00000000b001', test.id('tm_a'), 'https://push.example.com/nb-1', 'k', 'a', 'Member phone', true)
on conflict (id) do update set active = true, profile_id = excluded.profile_id;
select test.check(private.notice_publisher_role(test.id('sa')) = 'SUPER_ADMIN' and private.notice_publisher_role(test.id('hr_head')) = 'HR'
                  and private.notice_publisher_role(test.id('iss_hr_tm')) = 'HR' and private.notice_publisher_role(test.id('dv_ashish')) = 'CRM_TEAM'
                  and private.notice_publisher_role(test.id('ac_p')) is null,
  'publishers: the Super Admin, HR (head and members), the CRM team; an Operations Head no longer');
select test.check(private.notice_publisher_role(test.id('dh_wab')) is null and private.notice_publisher_role(test.id('th_wab')) is null
                  and private.notice_publisher_role(test.id('tm_a')) is null, 'a Department Head, a Team Lead and a Team Member are not');

\echo '   who may publish'
set role authenticated;
select test.login('tm_a');
select test.check(not (notice_audience_options() ->> 'canPublish')::boolean, 'a Team Member has no Send Notice');
select test.must_fail($$select test.nb_send('NB Not mine', 'nb-key-0001', '{"audienceType":"COMPANY"}')$$, 'a Team Member cannot publish', 'Only the Super Admin');
select test.login('th_wab');
select test.must_fail($$select test.nb_send('NB Not mine', 'nb-key-0002', '{"audienceType":"COMPANY"}')$$, 'nor a Team Lead', 'Only the Super Admin');
select test.login('dh_wab');
select test.must_fail($$select test.nb_send('NB Not mine', 'nb-key-0003', '{"audienceType":"COMPANY"}')$$, 'nor a Department Head who is not an Operations Head', 'Only the Super Admin');
select test.must_fail($$select notice_list('MINE')$$, 'nor list "my published notices"', 'Only publishers');
select test.must_fail($$insert into company_notices (reference, title, body, category, audience_type, publisher_id, publisher_role, client_request_id)
                        values ('X', 'NB Direct', 'x', 'GENERAL', 'COMPANY', test.id('dh_wab'), 'SUPER_ADMIN', 'nb-direct-1')$$, 'nobody writes the table directly', 'permission denied');

\echo '   the Super Admin: the entire company'
select test.login('sa');
insert into nb select 'company', test.nb_send('NB Office closed Friday', 'nb-key-0010', '{"audienceType":"COMPANY","priority":"URGENT","category":"HOLIDAY"}');
select test.check((select v ->> 'status' = 'PUBLISHED' and v ->> 'reference' like 'NTC-%' and (v ->> 'notified')::int >= 5 and v ->> 'publisherRole' = 'SUPER_ADMIN' from nb where k = 'company'),
  'published to the entire company at once');
select test.check((test.nb_send('NB Office closed Friday', 'nb-key-0010', '{"audienceType":"COMPANY"}') ->> 'duplicate')::boolean, 'the same form twice: the first notice, nothing new');
reset role;
select test.check(test.nb_got('tm_a', 'NB Office closed Friday') and test.nb_got('dh_wab', 'NB Office closed Friday') and test.nb_got('hr_head', 'NB Office closed Friday'),
  'every employee is notified');
select test.check(not test.nb_got('sa', 'NB Office closed Friday'), 'not the publisher');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nb('NB Office closed Friday')).id), 'once');
select test.check((select title like 'New Company Notice: NB Office closed Friday' and body like 'A new URGENT notice has been published by % Open it to read and acknowledge.' and priority = 'urgent'
                     from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nb('NB Office closed Friday')).id),
  'the bell: "New Company Notice", the title and the publisher; urgent');
select test.check((select count(*) = 1 and bool_and(url = '/?open=notice&id=' || (test.nb('NB Office closed Friday')).id) from notification_deliveries
                    where kind = 'COMPANY_NOTICE' and profile_id = test.id('tm_a') and tag = 'notice-' || (test.nb('NB Office closed Friday')).id),
  'a push to the employee''s device, opening that notice');

\echo '   reading and the read receipt'
set role authenticated;
select test.login('tm_a');
select test.check(test.nb_inbox('NB Office closed Friday') and notice_unread_count() >= 1, 'the employee sees it, unread');
select test.check((select (x ->> 'read')::boolean = false from jsonb_array_elements(notice_list('INBOX', p_unread => true, p_limit => 100) -> 'items') x where x ->> 'title' = 'NB Office closed Friday'),
  'filter: unread');
insert into nb select 'before', to_jsonb(notice_unread_count());
select test.check((select v ->> 'body' = 'Details of NB Office closed Friday' and (v ->> 'read')::boolean and v -> 'history' = '[]'::jsonb
                     from (select notice_open((test.nb('NB Office closed Friday')).id) as v) s), 'opening it: the full text, now read (no edit history for a reader)');
select test.check(notice_unread_count() = (select (v)::text::int - 1 from nb where k = 'before'), 'the unread count goes down by one');
select test.check(not exists (select 1 from notifications where recipient_id = test.id('tm_a') and entity_id = (test.nb('NB Office closed Friday')).id and read_at is null),
  'and its bell notification is read');
select test.must_fail($$select notice_update((test.nb('NB Office closed Friday')).id, '{"title":"NB Hacked"}')$$, 'a reader cannot edit it', 'Notice not found');
select test.must_fail($$select notice_archive((test.nb('NB Office closed Friday')).id)$$, 'nor archive it', 'Notice not found');
select test.must_fail($$select notice_receipts((test.nb('NB Office closed Friday')).id)$$, 'nor see the read receipts', 'Notice not found');
select test.login('sa');
select test.check((select (r ->> 'read')::int = 1 and (r ->> 'total')::int = (r ->> 'read')::int + (r ->> 'unread')::int
                          and exists (select 1 from jsonb_array_elements(r -> 'rows') x where (x ->> 'profileId')::uuid = test.id('tm_a') and x ->> 'readAt' is not null)
                          and (r -> 'push' ->> 'devices')::int >= 1
                     from (select notice_receipts((test.nb('NB Office closed Friday')).id) as r) s), 'the publisher sees who read it, who did not, and the push status');

\echo '   HR: a department; a developer: designations'
select test.login('iss_hr_tm');
select test.check((test.nb_send('NB Wabastore leave policy', 'nb-key-0020', jsonb_build_object('audienceType', 'DEPARTMENT', 'departmentIds', jsonb_build_array(test.dept('wabastore')), 'category', 'HR')) ->> 'publisherRole') = 'HR',
  'HR publishes to one department');
reset role;
select test.check(test.nb_got('tm_a', 'NB Wabastore leave policy') and test.nb_got('dh_wab', 'NB Wabastore leave policy'), 'its employees are notified');
select test.check(not test.nb_got('hr_head', 'NB Wabastore leave policy') and not test.nb_got('dv_ashish', 'NB Wabastore leave policy'), 'nobody outside the department');
set role authenticated;
select test.login('hr_head');
select test.check(not test.nb_inbox('NB Wabastore leave policy'), 'HR outside the department does not get it in their inbox');
select test.check(exists (select 1 from jsonb_array_elements(notice_list('ALL', p_limit => 100) -> 'items') x where x ->> 'title' = 'NB Wabastore leave policy'),
  '... but publishers see the company''s notices in View Notices');
select test.login('dv_ashish');
select test.check((test.nb_send('NB Team Leads: release tonight', 'nb-key-0030', '{"audienceType":"ROLE","roles":["TEAM_HEAD"],"category":"IT_SYSTEM"}') ->> 'publisherRole') = 'CRM_TEAM',
  'the CRM team publishes to a designation');
reset role;
select test.check(test.nb_got('th_wab', 'NB Team Leads: release tonight') and not test.nb_got('tm_a', 'NB Team Leads: release tonight') and not test.nb_got('dh_wab', 'NB Team Leads: release tonight'),
  'only Team Leads are notified');

\echo '   an Operations Head no longer publishes (20270202000100)'
set role authenticated;
select test.login('ac_p');
select test.check(not (notice_audience_options() ->> 'canPublish')::boolean, 'an Operations Head has no Send Notice');
select test.must_fail($$select test.nb_send('NB OH company', 'nb-key-0040', '{"audienceType":"COMPANY"}')$$, 'and cannot publish, to the company or to a department', 'Only the Super Admin, HR and the CRM team');
select test.must_fail($$select test.nb_send('NB OH dept', 'nb-key-0043', jsonb_build_object('audienceType', 'DEPARTMENT', 'departmentIds', jsonb_build_array(test.dept('wabastore'))))$$,
  'not even to a department they manage', 'Only the Super Admin, HR and the CRM team');

\echo '   selected employees; a scheduled notice'
select test.login('sa');
select test.nb_send('NB For Member A only', 'nb-key-0050', jsonb_build_object('audienceType', 'EMPLOYEES', 'employeeIds', jsonb_build_array(test.id('tm_a'))));
select test.login('tm_b');
select test.check(not test.nb_inbox('NB For Member A only'), 'a colleague not selected never sees it');
select test.must_fail($$select notice_open((test.nb('NB For Member A only')).id)$$, '... not even by its id', 'Notice not found');
select test.login('hr_head');
select test.must_fail($$select notice_open((test.nb('NB For Member A only')).id)$$, 'another publisher does not read a notice for selected employees', 'Notice not found');
select test.login('tm_a');
select test.check(test.nb_inbox('NB For Member A only'), 'the selected employee does');
select test.login('sa');
select test.check((test.nb_send('NB Next week', 'nb-key-0060', jsonb_build_object('audienceType', 'COMPANY', 'publishAt', now() + interval '1 day')) ->> 'status') = 'SCHEDULED',
  'a notice for later is scheduled');
reset role;
select test.check(not test.nb_got('tm_a', 'NB Next week') and (select count(*) = 0 from company_notice_recipients where notice_id = (test.nb('NB Next week')).id),
  'nobody is notified before its time');
set role authenticated;
select test.login('tm_a');
select test.check(not test.nb_inbox('NB Next week'), 'and nobody sees it yet');
reset role;
update company_notices set publish_at = now() - interval '1 minute' where title = 'NB Next week';
select test.check((notice_release_due() ->> 'generated')::int >= 5, 'its time comes: the scheduled run releases it');
select test.check(test.nb_got('tm_a', 'NB Next week') and (select status = 'PUBLISHED' from test.nb('NB Next week')), 'now everyone is notified');
select test.check((notice_release_due() ->> 'generated')::int = 0, 'a second run notifies nobody again');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select notice_release_due()$$, 'nobody signed in releases notices', 'permission denied');

\echo '   editing keeps the history; archiving'
select test.login('dv_ashish');
select test.must_fail($$select notice_update((test.nb('NB Office closed Friday')).id, '{"title":"NB Mine now"}')$$, 'a publisher cannot edit someone else''s notice', 'Notice not found');
select test.check((notice_update((test.nb('NB Team Leads: release tonight')).id, jsonb_build_object('body', 'The release moves to 11 pm.', 'version', 1)) ->> 'version')::int = 2,
  'they edit their own');
select test.must_fail($$select notice_update((test.nb('NB Team Leads: release tonight')).id, jsonb_build_object('body', 'Stale edit', 'version', 1))$$, 'a stale edit is refused', 'Someone else changed');
select test.check((select jsonb_array_length(v -> 'history') = 2 and v -> 'history' -> 1 -> 'before' ->> 'body' = 'Details of NB Team Leads: release tonight'
                     from (select notice_open((test.nb('NB Team Leads: release tonight')).id) as v) s), 'the original text is kept in the history');
select test.login('sa');
select test.check((notice_update((test.nb('NB Wabastore leave policy')).id, '{"priority":"IMPORTANT"}') ->> 'priority') = 'IMPORTANT', 'the Super Admin edits any notice');
select test.check((notice_archive((test.nb('NB Wabastore leave policy')).id) ->> 'status') = 'ARCHIVED', 'and archives it');
select test.must_fail($$select notice_update((test.nb('NB Wabastore leave policy')).id, '{"title":"NB Again"}')$$, 'an archived notice is not edited', 'archived');
select test.login('tm_a');
select test.check(not test.nb_inbox('NB Wabastore leave policy'), 'an archived notice leaves the Notice Board');
reset role;
select test.must_fail($$update company_notice_revisions set after = null$$, 'the history cannot be changed', 'cannot be changed');
select test.check((select count(*) = 1 from audit_logs where action = 'COMPANY_NOTICE_PUBLISHED' and entity_id = (test.nb('NB Office closed Friday')).id), 'publishing is audited');

\echo '   files'
insert into employee_issue_attachments (id, uploader_id, file_name, mime_type, size_bytes, status, storage_path)
values ('cccccccc-0000-4000-8000-00000000c001', test.id('sa'), 'nb-holiday.pdf', 'application/pdf', 1000, 'READY', 'sa/nb-holiday.pdf');
set role authenticated;
select test.login('sa');
select test.check(jsonb_array_length(test.nb_send('NB With a file', 'nb-key-0070', '{"audienceType":"COMPANY","attachmentIds":["cccccccc-0000-4000-8000-00000000c001"]}') -> 'attachments') = 1,
  'the Super Admin attaches a file');
select test.check((issue_begin_upload('nb-sa.png', 'image/png', 100)).id is not null, 'the Super Admin can upload a notice file');
select test.login('tm_a');
select test.check((issue_attachment_download('cccccccc-0000-4000-8000-00000000c001')).id is not null, 'a recipient opens it');
select test.login('ac_s');
select test.check((issue_attachment_download('cccccccc-0000-4000-8000-00000000c001')).id is not null, 'everyone the company notice is for');

reset role;
delete from company_notices where title like 'NB %';
delete from employee_issue_attachments where file_name in ('nb-holiday.pdf', 'nb-sa.png');
delete from push_subscriptions where id = 'bbbbbbbb-0000-4000-8000-00000000b001';
select set_config('request.jwt.claims', '', false);
