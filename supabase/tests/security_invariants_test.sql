-- =============================================================================
-- Security regression tests (docs/security/FINDINGS.md). Runs right after rls_test.sql on the same database, re-using
-- its users (sa, dh_wab, th_wab, tm_a, ...).
--
--   Part 1  database-wide invariants read from the catalog: a new table without Row Level Security, a privilege handed
--           to signed-out visitors, a SECURITY DEFINER function without a fixed search_path, or a new user-callable
--           function that never looks at the caller fails CI.
--   Part 2  SEC-2026-001: an upload is finished only with the server's attestation of the stored file.
--   Part 3  SEC-2026-002: customers are deleted only through delete_customer().
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
reset role;

\echo '--- Security invariants (catalog)'
select test.check(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity),
  'every public table has Row Level Security enabled');

select test.check(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))),
  'signed-out visitors hold no table privileges');

select test.check((select coalesce(array_agg(p.proname::text order by p.proname), '{}') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')) = array['list_registration_options'],
  'signed-out visitors can call only list_registration_options()');

select test.check(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and has_table_privilege('authenticated', c.oid, 'truncate')),
  'signed-in users cannot TRUNCATE (it skips Row Level Security)');

select test.check(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on'], false)
     and has_table_privilege('authenticated', c.oid, 'select')),
  'no view readable by users runs with its owner''s rights (security_invoker)');

select test.check(not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef and n.nspname in ('public', 'private')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  'every SECURITY DEFINER function fixes its search_path');

-- A user-callable SECURITY DEFINER function must look at the caller (auth.uid() or one of the authorization helpers).
-- The few that only delegate to a checked function are listed by name: adding one here needs a reviewer's look.
create temp table unchecked_definers as
select p.proname::text as name from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef and n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
   and p.prosrc !~* '(auth\.uid|my_id|my_role|is_super_admin|private\.(can_|require_|scope_|my_|lock_|chat_access|chat_may|chat_can|accounts_can|is_hr|is_accounts|is_support|may_|in_team_lead|team_lead_scope|hr_require))'
   and p.proname not in (
     'list_registration_options',  -- public form options, no data
     'chat_group_set_admin',       -- private.chat_lock_group(.., true) checks group admin
     'client_reply_ticket',        -- calls client_send_ticket_message (require_client)
     'reply_to_client_ticket',     -- calls send_ticket_message (checked)
     'ticket_complete_upload',     -- private.ticket_own_pending checks the uploader
     'ticket_pending_upload');     -- private.ticket_own_pending checks the uploader
grant select on unchecked_definers to authenticated;
select test.check(not exists (select 1 from unchecked_definers),
  'every user-callable SECURITY DEFINER function checks its caller (unchecked: ' || coalesce((select string_agg(name, ', ') from unchecked_definers), 'none') || ')');

select test.check(not has_function_privilege('authenticated', 'public.attest_upload(text, uuid, bigint, text)', 'execute')
              and not has_function_privilege('anon', 'public.attest_upload(text, uuid, bigint, text)', 'execute'),
  'only the server (service role) can attest an upload');
select test.check(not has_table_privilege('authenticated', 'private.upload_attestations', 'select')
              and not has_table_privilege('authenticated', 'private.upload_attestations', 'insert'),
  'users cannot read or plant attestations');
select test.check((select count(*) = 3 from pg_trigger where tgname like '%_require_attestation' and not tgisinternal and tgenabled <> 'D'),
  'all three file tables require an attestation to finish an upload');
select test.check(not has_table_privilege('authenticated', 'public.customers', 'delete'),
  'users hold no direct DELETE on customers');

\echo '--- SEC-2026-001: upload completion needs the server''s attestation'
create temp table sec_doc as
select gen_random_uuid() as id, (select d.customer_id from customer_documents d join customers c on c.id = d.customer_id
                                   where d.document_type = 'BRAND_LOGO' and d.status = 'UPLOADED' and c.owner_id = test.id('tm_a') limit 1) as customer_id;
grant select on sec_doc to authenticated;
insert into customer_documents (id, customer_id, document_type, status, storage_path, original_file_name, mime_type, uploaded_by)
select id, customer_id, 'BRAND_LOGO', 'PENDING', 'sec-test/' || id || '.png', 'logo.png', 'image/png', test.id('tm_a') from sec_doc;

set role authenticated;
select test.login('tm_a');
select test.must_fail($$select complete_document_upload((select id from sec_doc), 3000)$$,
  'calling the completion function directly (no server check) is refused', 'not been checked by the server');
select test.must_fail($$select attest_upload('customer_documents', (select id from sec_doc), 3000, 'x')$$,
  'a user cannot attest their own upload', 'permission denied');
select test.must_fail($$insert into private.upload_attestations (table_name, object_id, size_bytes) values ('customer_documents', (select id from sec_doc), 3000)$$,
  'nor write an attestation directly', 'permission denied');
reset role;
select attest_upload('customer_documents', (select id from sec_doc), 2999, '"etag-from-r2"');
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select complete_document_upload((select id from sec_doc), 3000)$$,
  'a size different from the stored object is refused', 'does not match');
select test.check((select status = 'PENDING' from customer_documents where id = (select id from sec_doc)), 'the refused upload stays PENDING');
reset role;
select attest_upload('customer_documents', (select id from sec_doc), 3000, 'etag-from-r2');
set role authenticated;
select test.login('tm_a');
select complete_document_upload((select id from sec_doc), 3000);
reset role;
select test.check((select status = 'UPLOADED' and size_bytes = 3000 and storage_etag = 'etag-from-r2' from customer_documents where id = (select id from sec_doc)),
  'with the attestation the upload finishes, with the size and ETag the server saw');
select test.check(not exists (select 1 from private.upload_attestations where object_id = (select id from sec_doc)), 'an attestation is used once');
select test.must_fail($$select attest_upload('profiles', gen_random_uuid(), 10, null)$$, 'only the three file tables can be attested', 'Unknown upload kind');

\echo '--- SEC-2026-002: customers are deleted only through delete_customer()'
insert into customers (name, phone, owner_id, team_id, department_id)
select 'Sec delete me', '9876500001', p.id, p.team_id, p.department_id from profiles p where p.id = test.id('tm_a');
set role authenticated;
select test.login('th_wab');
select test.must_fail($$delete from customers where name = 'Sec delete me'$$, 'a team head cannot delete a customer directly', 'permission denied');
select test.must_fail($$select delete_customer((select id from customers where name = 'Sec delete me'))$$, 'nor through delete_customer', 'FORBIDDEN');
select test.login('tm_a');
select test.must_fail($$delete from customers where name = 'Sec delete me'$$, 'the owner cannot delete it directly either', 'permission denied');
select test.login('sa');
select test.must_fail($$delete from customers where name = 'Sec delete me'$$, 'even the Super Admin goes through delete_customer', 'permission denied');
select delete_customer((select id from customers where name = 'Sec delete me'));
reset role;
select test.check(not exists (select 1 from customers where name = 'Sec delete me'), 'delete_customer still deletes');

\echo '=== ALL SECURITY INVARIANT TESTS PASSED ==='
