-- =============================================================================
-- Security posture check for the LIVE Supabase project. READ-ONLY: it changes nothing. Paste into the Supabase SQL
-- editor and run. Every row is a finding to look at; an empty result for a check means it passed.
-- It covers what the repository cannot show: settings made in the dashboard, and whether the migrations were applied.
-- See docs/security/FINDINGS.md and docs/security/DEPLOYMENT_CHECKLIST.md.
-- =============================================================================

-- 1. Storage buckets that are public (anyone with a link reads every file).
select 'PUBLIC BUCKET' as finding, id as object, 'set public = false unless it holds only non-confidential assets' as action
  from storage.buckets where public

union all
-- 2. Policies on storage.objects (made in the dashboard: the migrations create none). Any of them may let a signed-in
--    user, or anyone, read or write files directly, bypassing the API's per-document authorization.
select 'STORAGE POLICY', policyname || ' (' || cmd || ' to ' || array_to_string(roles, ',') || ')',
       'review: the app needs no storage.objects policy; files are served through short-lived signed URLs'
  from pg_policies where schemaname = 'storage' and tablename = 'objects'

union all
-- 3. Exposed tables without Row Level Security.
select 'TABLE WITHOUT RLS', n.nspname || '.' || c.relname, 'enable row level security'
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity

union all
-- 4. Privileges held by signed-out visitors.
select 'ANON TABLE PRIVILEGE', table_name || ': ' || string_agg(privilege_type, ','), 'revoke from anon'
  from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public' group by table_name

union all
select 'ANON FUNCTION', p.proname, 'revoke execute from anon (only list_registration_options is expected)'
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute') and p.proname <> 'list_registration_options'

union all
-- 5. SECURITY DEFINER functions without a fixed search_path.
select 'DEFINER WITHOUT search_path', n.nspname || '.' || p.proname, 'add: set search_path = '''''
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where p.prosecdef and n.nspname in ('public', 'private')
   and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')

union all
-- 6. Migrations of the security record that are not applied yet.
select 'MIGRATION NOT APPLIED', '20261114000100_security_upload_attestation.sql', 'run it (after deploying the API that attests uploads)'
 where to_regprocedure('public.attest_upload(text, uuid, bigint, text)') is null
union all
select 'MIGRATION NOT APPLIED', '20261114000100 (customers DELETE)', 'run it: users can still delete customers directly'
 where has_table_privilege('authenticated', 'public.customers', 'delete')
union all
select 'MIGRATION NOT APPLIED', '20261110000200_security_events.sql', 'run it: audit logs are not append-only'
 where not exists (select 1 from pg_trigger where tgrelid = 'public.audit_logs'::regclass and tgname ilike '%protect%')

union all
-- 7. Super Admins without a second factor (Supabase Auth MFA). Informational until MFA is enforced (SEC-2026-006).
select 'SUPER ADMIN WITHOUT MFA', p.email, 'enrol a TOTP factor (see docs/security/FINDINGS.md SEC-2026-006)'
  from public.profiles p
 where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'
   and not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')

union all
-- 8. Inactive staff who still have a sign-in that is not banned (they can still obtain tokens; the database refuses them).
select 'INACTIVE BUT NOT BANNED', p.email || ' (' || p.status || ')', 'ban the auth user (POST /users/:id/status does this when the service key is set)'
  from public.profiles p join auth.users u on u.id = p.id
 where p.status <> 'ACTIVE' and (u.banned_until is null or u.banned_until < now())

order by 1, 2;
