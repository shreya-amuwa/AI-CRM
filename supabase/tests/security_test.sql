-- =============================================================================
-- Security hardening regression tests (migration 20261106000100). Runs after the other suites on the same database,
-- re-using their users (sa, tm_a, tm_c, th_wab, dh_acc, ...).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- Security: department-scoped leads and requirements'

reset role;
delete from crm_leads where id in ('SEC-wab', 'SEC-wbx', 'SEC-assigned');
insert into crm_leads (id, name, department) values ('SEC-wab', 'Sec Wabastore lead', 'wabastore'), ('SEC-wbx', 'Sec Whatsbox lead', 'whatsbox');
insert into crm_leads (id, name, department, assigned_to) values ('SEC-assigned', 'Sec assigned lead', 'whatsbox', test.id('tm_a'));
insert into blueprint_requirements (id, title, department_id) values ('SEC-bp-wab', 'wab', 'wabastore'), ('SEC-bp-wbx', 'wbx', 'whatsbox');

select test.create_auth_user('sec_hq', 'sec.hq@amuwa.com', '{"full_name":"HQ Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('amuwa')));

set role authenticated;
select test.login('tm_a');
select test.check((select count(*) = 1 from crm_leads where id = 'SEC-wab'), 'a member sees the leads of their own department');
select test.check((select count(*) = 0 from crm_leads where id = 'SEC-wbx'), 'a member does not see another department''s leads');
select test.check((select count(*) = 1 from crm_leads where id = 'SEC-assigned'), 'a lead assigned to the member stays visible to them');
select test.check(test.rows($$update crm_leads set notes = 'x' where id = 'SEC-wbx'$$) = 0, 'a member cannot change another department''s lead');
select test.check(test.rows($$delete from crm_leads where id = 'SEC-wbx'$$) = 0, 'a member cannot delete another department''s lead');
select test.must_fail($$insert into crm_leads (id, name, department) values ('SEC-x', 'x', 'whatsbox')$$, 'a member cannot plant a lead in another department', 'row-level security');
select test.check((select count(*) = 0 from blueprint_requirements where id = 'SEC-bp-wbx') and (select count(*) = 1 from blueprint_requirements where id = 'SEC-bp-wab'),
  'blueprint requests are limited to the member''s department');

select test.login('dh_acc');
select test.check((select count(*) = 0 from crm_leads where id like 'SEC-%'), 'Accounts sees no sales leads');
select test.login('sec_hq');
select test.check((select count(*) = 3 from crm_leads where id like 'SEC-%'), 'the head office (Amuwa Corporation) sees every unit''s leads');
select test.login('sa');
select test.check((select count(*) = 3 from crm_leads where id like 'SEC-%'), 'the Super Admin sees all leads');
reset role;

\echo '--- Security: least privilege'
-- signed-out visitors
set role anon;
select test.must_fail($$select * from customers$$, 'signed-out visitors cannot read customers', 'permission denied');
select test.must_fail($$select * from onboarding_items$$, 'nor the onboarding catalogue', 'permission denied');
select test.must_fail($$select * from audit_logs$$, 'nor the audit log', 'permission denied');
reset role;
select test.check((select count(*) = 0 from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
  'the anon role holds no table privileges');
select test.check((select coalesce(array_agg(p.proname::text order by p.proname), '{}') = array['list_registration_options']
                     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')),
  'only the sign-up options list is callable by signed-out visitors');
select test.check((select count(*) = 0 from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'authenticated' and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  'signed-in users cannot TRUNCATE (it skips row-level security)');
select test.check((select count(*) = 0 from information_schema.role_table_grants
                    where table_schema = 'public' and grantee = 'authenticated' and table_name in ('onboarding_items', 'onboarding_item_services')
                      and privilege_type in ('INSERT', 'UPDATE', 'DELETE')),
  'the onboarding catalogue is read-only for signed-in users');
set role authenticated;
select test.login('sa');
select test.must_fail($$truncate onboarding_items$$, 'even the Super Admin''s API role cannot TRUNCATE', 'permission denied');
select test.must_fail($$insert into onboarding_items (code, label) values ('SEC', 'x')$$, 'nor insert catalogue rows directly', 'permission denied');
reset role;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    perform test.check((select count(*) = 0 from storage.buckets where id in ('blueprint-files', 'amuwa-docs') and public), 'the legacy storage buckets are private');
  end if;
end $$;

\echo '--- Security: audit log'
select test.check(private.scrub_audit_metadata('{"a":1,"password":"x","nested":{"apiKey":"k","ok":true,"Authorization":"Bearer abc"},"list":[{"token":"t","v":2}]}'::jsonb)
                  = '{"a":1,"nested":{"ok":true},"list":[{"v":2}]}'::jsonb,
  'passwords, tokens and secrets are removed from audit metadata (also nested)');
select test.check(private.scrub_audit_metadata('{"department":"hr","count":3}'::jsonb) = '{"department":"hr","count":3}'::jsonb, 'ordinary metadata is kept');
set role authenticated;
select test.login('sa');
select test.must_fail($$select record_security_event('WEBHOOK_REJECTED')$$, 'a signed-in user cannot write security events', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select record_security_event('WEBHOOK_REJECTED')$$, 'nor a signed-out visitor', 'permission denied');
reset role;
set role service_role;
select record_security_event('WEBHOOK_REJECTED', 'webhook', '{"ip":"1.2.3.4","secret":"leak","department":"wabastore"}');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'WEBHOOK_REJECTED' and entity_type = 'webhook' and actor_id is null
                      and metadata = '{"ip":"1.2.3.4","department":"wabastore"}'::jsonb),
  'the server records a security event, without the secret');
set role service_role;
select test.must_fail($$select record_security_event('bad action')$$, 'a malformed event name is refused', 'Invalid security event');
reset role;

\echo '--- Security: sign-in protection (Supabase Auth password-verification hook)'
select test.create_auth_user('sec_user', 'sec.user@amuwa.com', '{"full_name":"Sec User"}', '{}');
select test.check(public.hook_password_verification_attempt(jsonb_build_object('user_id', test.id('sec_user'), 'valid', true)) ->> 'decision' = 'continue',
  'a correct password signs in');
do $$
declare i int; r jsonb;
begin
  for i in 1..5 loop
    r := public.hook_password_verification_attempt(jsonb_build_object('user_id', test.id('sec_user'), 'valid', false));
    perform test.check(r ->> 'decision' = 'continue', format('wrong password %s is answered normally', i));
  end loop;
end $$;
select test.check((select count(*) = 5 from audit_logs where action = 'LOGIN_FAILED' and metadata ->> 'userId' = test.id('sec_user')::text), 'every failed sign-in is audited');
select test.check((select count(*) = 1 from audit_logs where action = 'LOGIN_LOCKED' and metadata ->> 'userId' = test.id('sec_user')::text), 'the lock-out is audited once');
select test.check(public.hook_password_verification_attempt(jsonb_build_object('user_id', test.id('sec_user'), 'valid', false)) ->> 'decision' = 'reject',
  'after 5 failures the account is locked');
select test.check(public.hook_password_verification_attempt(jsonb_build_object('user_id', test.id('sec_user'), 'valid', true)) ->> 'decision' = 'reject',
  'even the correct password is refused while locked');
select test.check((select count(*) = 5 from audit_logs where action = 'LOGIN_FAILED' and metadata ->> 'userId' = test.id('sec_user')::text), 'locked attempts do not flood the audit log');
select test.check(not exists (select 1 from audit_logs where action in ('LOGIN_FAILED', 'LOGIN_LOCKED') and metadata::text ~* 'password'), 'no password is ever logged');
update auth_login_attempts set created_at = now() - interval '20 minutes' where user_id = test.id('sec_user');
select test.check(public.hook_password_verification_attempt(jsonb_build_object('user_id', test.id('sec_user'), 'valid', true)) ->> 'decision' = 'continue',
  'the lock ends after 15 minutes');
select test.check((select count(*) = 0 from auth_login_attempts where user_id = test.id('sec_user')), 'a successful sign-in clears the failure count');
select test.check(public.hook_password_verification_attempt('{}'::jsonb) ->> 'decision' = 'continue', 'a malformed event does not break sign-in');
set role authenticated;
select test.must_fail($$select public.hook_password_verification_attempt('{}'::jsonb)$$, 'users cannot call the sign-in hook', 'permission denied');
select test.must_fail($$select * from auth_login_attempts$$, 'nor read the attempt table', 'permission denied');
reset role;

\echo '=== ALL SECURITY TESTS PASSED ==='
