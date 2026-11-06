-- =============================================================================
-- HR in the company chat (migration 20261228000300 + the existing chat): an HR Recruiter, an HR Assistant and the HR Admin Head use the SAME
-- conversations as everyone else. One DIRECT conversation per pair, readable by its two members only; groups by membership; the directory shows
-- the designation and filters by department. Uses the people of recruiter_workflow_test.sql (rr_rec1, rr_asst) and the shared fixture.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 95. HR in the company chat: directory, direct messages both ways, privacy, groups'
reset role;
\i supabase/migrations/20261228000300_chat_directory_departments.sql
\i supabase/migrations/20261228000300_chat_directory_departments.sql
update public.chat_settings set internal_mode = 'STANDARD' where id;
create temp table hrc (k text primary key, v text);
grant all on hrc to authenticated;
-- an active colleague of another department (Accounts) for the cross-department check
insert into hrc select 'acc', p.id::text from profiles p join departments d on d.id = p.department_id where d.slug = 'accounts' and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' order by p.created_at limit 1;
select test.check(exists (select 1 from hrc where k = 'acc'), 'fixture: an active Accounts employee');

set role authenticated;
\echo '   the directory: real active colleagues of every department, with designation and a department filter'
select test.login('rr_rec1');
select test.check((select count(distinct x ->> 'departmentId') >= 3 from jsonb_array_elements(chat_directory(null, 100)) x), 'an HR Recruiter sees colleagues of several departments');
select test.check(exists (select 1 from jsonb_array_elements(chat_directory(null, 100)) x where x ->> 'id' = test.id('tm_a')::text), 'including a Sales Team Member');
select test.check(exists (select 1 from jsonb_array_elements(chat_directory(null, 100)) x where x ->> 'id' = (select v from hrc where k = 'acc')), 'and an Accounts employee');
select test.check((select bool_and(x ->> 'departmentId' = test.dept('wabastore')::text) and count(*) >= 1 from jsonb_array_elements(chat_directory(null, 100, test.dept('wabastore'))) x),
  'the department filter returns that department only');
select test.check((select not exists (select 1 from jsonb_array_elements(chat_directory(null, 100)) x where x ? 'email' or x ? 'phone')), 'still no e-mail or phone in the directory');
select test.login('tm_a');
select test.check((select x ->> 'designation' = 'HR Recruiter' from jsonb_array_elements(chat_directory('RR New Recruiter')) x where x ->> 'id' = test.id('rr_new')::text),
  'a Team Member finds an HR Recruiter, shown with the designation HR Recruiter');
select test.check((select count(*) >= 1 from jsonb_array_elements(chat_directory('hr recruiter', 100)) x where x ->> 'id' = test.id('rr_new')::text), 'searching by designation finds them');

\echo '   one conversation for both people, messages both ways, unread counts'
select test.login('rr_rec1');
insert into hrc select 'dm', chat_open_direct(test.id('tm_a')) ->> 'id';
select test.check((chat_send_message((select v from hrc where k = 'dm')::uuid, 'Hello from HR recruitment', gen_random_uuid()) ->> 'body') = 'Hello from HR recruitment', 'the Recruiter sends a message');
select test.login('tm_a');
select test.check((chat_open_direct(test.id('rr_rec1')) ->> 'id') = (select v from hrc where k = 'dm'), 'the Team Member opening a chat with the Recruiter gets the SAME conversation');
select test.check((select (c ->> 'unread')::int = 1 from jsonb_array_elements(chat_internal_list()) c where c ->> 'id' = (select v from hrc where k = 'dm')), 'the Team Member has one unread message in that conversation');
select test.check((chat_unread_summary() ->> 'internal')::int >= 1, 'and the Chat badge counts it');
select test.check((chat_messages_page((select v from hrc where k = 'dm')::uuid) -> 'messages' -> 0 ->> 'body') = 'Hello from HR recruitment', 'and reads it');
select chat_mark_read((select v from hrc where k = 'dm')::uuid);
select test.check((select (c ->> 'unread')::int = 0 from jsonb_array_elements(chat_internal_list()) c where c ->> 'id' = (select v from hrc where k = 'dm')), 'reading it clears the unread count');
select chat_send_message((select v from hrc where k = 'dm')::uuid, 'Thanks, noted', gen_random_uuid());
select test.login('rr_rec1');
select test.check((select count(*) = 2 from jsonb_array_elements(chat_messages_page((select v from hrc where k = 'dm')::uuid) -> 'messages')), 'the Recruiter sees both messages in the one history');
select test.check(exists (select 1 from jsonb_array_elements(chat_internal_list()) c where c ->> 'id' = (select v from hrc where k = 'dm')), 'the conversation is in the Recruiter''s chat list');
reset role;
select test.check((select count(*) = 1 from chat_conversations where kind = 'DIRECT' and direct_key = least(test.id('rr_rec1')::text, test.id('tm_a')::text) || ':' || greatest(test.id('rr_rec1')::text, test.id('tm_a')::text)),
  'exactly one direct conversation exists for the pair (no per-dashboard copy)');
set role authenticated;

\echo '   every HR designation and other roles, across departments'
select test.login('rr_asst');
select test.check((chat_open_direct((select v from hrc where k = 'acc')::uuid) ->> 'id') is not null, 'an HR Assistant opens a chat with an Accounts employee');
select test.check((chat_open_direct(test.id('dh_wab')) ->> 'id') is not null, 'an HR Assistant opens a chat with a Department Head');
select test.login('hr_head');
select test.check((chat_open_direct(test.id('th_wab')) ->> 'id') is not null, 'the HR Admin Head opens a chat with a Team Lead');
select test.check((chat_open_direct(test.id('sa')) ->> 'id') is not null, 'and with the Super Admin');

\echo '   privacy: nobody else reads the pair''s conversation'
select test.login('rr_asst');
select test.must_fail($$select chat_messages_page((select v from hrc where k = 'dm')::uuid)$$, 'an HR Assistant cannot read the Recruiter''s private conversation', 'NOT_FOUND');
select test.must_fail($$select chat_send_message((select v from hrc where k = 'dm')::uuid, 'sneaky', gen_random_uuid())$$, 'nor write into it', 'NOT_FOUND');
select test.check(not exists (select 1 from jsonb_array_elements(chat_internal_list()) c where c ->> 'id' = (select v from hrc where k = 'dm')), 'nor see it in their list');
select test.login('hr_head');
select test.must_fail($$select chat_messages_page((select v from hrc where k = 'dm')::uuid)$$, 'the HR Admin Head cannot read it either', 'NOT_FOUND');
select test.login('tm_b');
select test.must_fail($$select chat_messages_page((select v from hrc where k = 'dm')::uuid)$$, 'nor another Team Member', 'NOT_FOUND');
select test.check((select count(*) = 0 from chat_messages where conversation_id = (select v from hrc where k = 'dm')::uuid), 'the table itself shows nothing to a non-member');

\echo '   groups: by membership only'
select test.login('hr_head');
insert into hrc select 'grp', chat_create_group('HR coordination', array[test.id('rr_rec1'), test.id('rr_asst')]) ->> 'id';
select chat_send_message((select v from hrc where k = 'grp')::uuid, 'Weekly hiring plan', gen_random_uuid());
select test.login('rr_rec1');
select test.check(exists (select 1 from jsonb_array_elements(chat_messages_page((select v from hrc where k = 'grp')::uuid) -> 'messages') m where m ->> 'body' = 'Weekly hiring plan'), 'a member of the HR group reads it');
select test.must_fail($$select chat_group_add_members((select v from hrc where k = 'grp')::uuid, array[test.id('tm_a')])$$, 'a member who is not the group admin cannot add people', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$select chat_messages_page((select v from hrc where k = 'grp')::uuid)$$, 'a Team Member outside the group cannot read it', 'NOT_FOUND');
select test.must_fail($$select chat_group_add_members((select v from hrc where k = 'grp')::uuid, array[test.id('tm_a')])$$, 'nor add themselves', 'NOT_FOUND');
reset role;
\echo '   ok: HR in the company chat'
