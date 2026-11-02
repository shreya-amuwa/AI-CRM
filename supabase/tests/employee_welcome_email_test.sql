-- =============================================================================
-- Automatic welcome e-mail for new employees (migration 20261218000100): queued once, when the account is really active; tracking, retries,
-- resend rules, who may see them; no password / link is ever stored. Own synthetic department and people (prefix we).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 92. Employee welcome e-mail'
reset role;
\i supabase/migrations/20261218000100_employee_welcome_email.sql

delete from auth.users where email like 'we.%@example.com';
delete from test.users where name like 'we\_%';
delete from teams where department_id in (select id from departments where slug like 'we-%');
delete from departments where slug like 'we-%';
insert into departments (slug, name) values ('we-a', 'WE Alpha'), ('we-b', 'WE Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'we-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'we-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.wereq(p_by text, p_role text, p_dept text, p_code text default null) returns jsonb language sql stable as $$
  select jsonb_build_object('request_by', test.id(p_by), 'request_role', p_role, 'request_operations_head', false, 'request_department_id', test.dept(p_dept),
                            'request_employee_code', p_code)
$$;
create or replace function test.wemail(p_who text) returns public.employee_welcome_emails language sql stable security definer set search_path = '' as $$
  select w from public.employee_welcome_emails w where w.employee_id = test.id(p_who) order by w.created_at desc limit 1
$$;
create or replace function test.wecount(p_who text) returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.employee_welcome_emails w where w.employee_id = test.id(p_who)
$$;
grant execute on all functions in schema test to anon, authenticated;

\echo '   people: HR, a Department Head of each department, a Team Lead (direct creation by the Super Admin)'
select test.service();
select test.create_auth_user('we_hr', 'we.hr@example.com', '{"full_name":"WE HR"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_MEMBER', 'provisioned_team_id', test.team('hr', 'General')));
select test.service();
select test.create_auth_user('we_dh', 'we.dh@example.com', '{"full_name":"WE Head Alpha","position":"Department Head"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('we-a')));
select test.service();
select test.create_auth_user('we_dhb', 'we.dhb@example.com', '{"full_name":"WE Head Beta"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('we-b')));
select test.service();
select test.create_auth_user('we_tl', 'we.tl@example.com', '{"full_name":"WE Lead"}',
  jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'TEAM_HEAD', 'provisioned_team_id', test.team('we-a', 'Sales')));

\echo '   direct creation: one welcome e-mail per account, queued at activation'
select test.check((select count(*) = 4 from public.profiles where id in (test.id('we_hr'), test.id('we_dh'), test.id('we_dhb'), test.id('we_tl')) and status = 'ACTIVE'), 'the people are active');
select test.check((select count(*) = 1 and bool_and(trigger_event = 'ACCOUNT_PROVISIONED' and status = 'PENDING' and recipient_email = 'we.tl@example.com' and attempts = 0 and sent_at is null)
                   from public.employee_welcome_emails where employee_id = test.id('we_tl')), 'a directly created Team Lead has one pending welcome e-mail to their own address');
select test.check(test.wecount('we_hr') = 1 and test.wecount('we_dh') = 1, 'and so has everybody else, once');
select test.check((select count(*) = 0 from public.employee_welcome_emails where employee_id = test.id('sa')), 'the first Super Admin (nobody created them) gets none');
select test.check(private.welcome_queue(test.id('we_tl'), 'ACCOUNT_PROVISIONED', 'PROVISIONED:' || test.id('we_tl')::text, null, test.id('sa')) is null and test.wecount('we_tl') = 1, 'the same activation never queues a second e-mail');

\echo '   HR request: nothing while it is pending or rejected, one e-mail when approved'
select test.service();
select test.create_auth_user('we_new', 'we.new@example.com', '{"full_name":"WE Rahul Sharma","position":"Team Member"}', test.wereq('we_hr', 'TEAM_MEMBER', 'we-a', 'EMP-777'));
select test.service();
select test.create_auth_user('we_rej', 'we.rej@example.com', '{"full_name":"WE Rejected Person"}', test.wereq('we_hr', 'TEAM_MEMBER', 'we-a'));
select test.check((select status = 'PENDING' from public.profiles where id = test.id('we_new')) and test.wecount('we_new') = 0 and test.wecount('we_rej') = 0, 'a submitted request is pending and queues nothing');
create temp table we_r (name text primary key, id uuid);
grant all on we_r to authenticated, service_role;
insert into we_r select 'new', id from approval_requests where subject_user_id = test.id('we_new');
insert into we_r select 'rej', id from approval_requests where subject_user_id = test.id('we_rej');
set role authenticated;
select test.login('we_dhb');
select test.must_fail($$select employee_request_decide((select id from we_r where name = 'new'), true, null, null, null)$$, 'another department''s head cannot approve it', 'NOT_FOUND|not the approver');
reset role;
select test.check(test.wecount('we_new') = 0, 'a refused approval queues nothing');
set role authenticated;
select test.login('we_dh');
select employee_request_decide((select id from we_r where name = 'rej'), false, 'not suitable', null, null);
select test.check(test.wecount('we_rej') = 0, 'a rejected request queues nothing');
select employee_request_decide((select id from we_r where name = 'new'), true, 'welcome', null, null);
reset role;
select test.check((select status = 'ACTIVE' from public.profiles where id = test.id('we_new')), 'the approval activated the account');
select test.check((select count(*) = 1 and bool_and(trigger_event = 'EMPLOYEE_REQUEST_APPROVED' and status = 'PENDING' and approval_request_id = (select id from we_r where name = 'new')
                          and recipient_email = 'we.new@example.com' and activated_by = test.id('we_dh')) from public.employee_welcome_emails where employee_id = test.id('we_new')),
  'the approval queued exactly one welcome e-mail, tied to the request and the approver');
select test.check((select count(*) = 1 from public.notifications where type = 'EMPLOYEE_ACCOUNT_CREATED' and entity_id = test.id('we_new') and recipient_id = test.id('we_hr')), 'HR is told the account was created, once');
select test.check(private.welcome_queue(test.id('we_new'), 'EMPLOYEE_REQUEST_APPROVED', 'REQUEST:' || (select id from we_r where name = 'new')::text, null, null) is null and test.wecount('we_new') = 1, 'running the activation again does not duplicate it');

\echo '   sending: claim, record the outcome, retry, fail (service role only)'
set role authenticated;
select test.login('we_hr');
select test.must_fail($$select welcome_email_claim(5, 'live', 600, null)$$, 'nobody but the server can claim e-mails', 'permission denied');
select test.must_fail($$select welcome_email_finish(gen_random_uuid(), 'SENT', null, null, null)$$, 'or record the result', 'permission denied');
reset role;
-- take the earlier e-mails out of the way so the claims below see only this one
update public.employee_welcome_emails set status = 'SKIPPED' where employee_id <> test.id('we_new') and status = 'PENDING';
select test.service();
create temp table we_claim (j jsonb);
grant all on we_claim to authenticated, service_role;
insert into we_claim select public.welcome_email_claim(5, 'dry_run', 600, null);
select test.check((select jsonb_array_length(j) = 1 and j -> 0 ->> 'to' = 'we.new@example.com' and j -> 0 ->> 'name' = 'WE Rahul Sharma' and j -> 0 ->> 'department' = 'WE Alpha'
                          and j -> 0 ->> 'designation' = 'Team Member' and j -> 0 ->> 'employeeCode' = 'EMP-777' and (j -> 0 ->> 'attempts')::int = 1 from we_claim),
  'the claim carries the real employee details (name, address, department, designation, employee ID)');
select test.check((select status = 'PROCESSING' and attempts = 1 and locked_until > now() from test.wemail('we_new')), 'the row is being processed');
select test.check((select jsonb_array_length(public.welcome_email_claim(5, 'dry_run', 600, null)) = 0), 'a second sender cannot take it');
select public.welcome_email_finish((select (j -> 0 ->> 'id')::uuid from we_claim), 'DRY_RUN', 'Dry run - not sent', null, null);
select test.check((select status = 'DRY_RUN' and sent_at is null from test.wemail('we_new')), 'a dry run is never recorded as sent');
select test.check((select jsonb_array_length(public.welcome_email_claim(5, 'dry_run', 600, null)) = 0), 'and is not retried in dry-run mode');
delete from we_claim;
insert into we_claim select public.welcome_email_claim(5, 'live', 600, ARRAY['someone.else@example.com']);
select test.check((select jsonb_array_length(j) = 0 from we_claim), 'with a test-recipient list only those addresses are taken');
delete from we_claim;
insert into we_claim select public.welcome_email_claim(5, 'live', 600, null);
select test.check((select jsonb_array_length(j) = 1 and (j -> 0 ->> 'attempts')::int = 1 from we_claim), 'in live mode the dry-run row is taken for real');
select public.welcome_email_finish((select (j -> 0 ->> 'id')::uuid from we_claim), 'RETRY', 'HTTP 503: provider busy', 503, null);
select test.check((select status = 'RETRYING' and attempts = 1 and next_attempt_at > now() + interval '4 minutes' and last_error like 'HTTP 503%' and sent_at is null from test.wemail('we_new')), 'a temporary failure is retried later and is not marked sent');
select test.check((select jsonb_array_length(public.welcome_email_claim(5, 'live', 600, null)) = 0), 'not before it is due');
select test.must_fail($$select public.welcome_email_finish((select (j -> 0 ->> 'id')::uuid from we_claim), 'SENT', null, null, null)$$, 'a result cannot be recorded for an e-mail nobody is sending', 'not being sent');
reset role;
update public.employee_welcome_emails set next_attempt_at = now() - interval '1 minute' where employee_id = test.id('we_new');
select test.service();
delete from we_claim;
insert into we_claim select public.welcome_email_claim(5, 'live', 600, null);
select test.check((select jsonb_array_length(j) = 1 and (j -> 0 ->> 'attempts')::int = 2 from we_claim), 'when due it is taken again (attempt 2)');
select public.welcome_email_finish((select (j -> 0 ->> 'id')::uuid from we_claim), 'SENT', 'Sent', 250, 'provider-123');
select test.check((select status = 'SENT' and sent_at is not null and last_error is null and attempts = 2 and provider_ref = 'provider-123' from test.wemail('we_new')), 'sent: recorded only now, with the time and the attempts');
select test.check((select count(*) = 3 and bool_or(outcome = 'DRY_RUN') and bool_or(outcome = 'RETRY') and bool_or(outcome = 'SENT') from public.employee_welcome_email_attempts where email_id = (select id from test.wemail('we_new'))), 'every attempt is kept');
select test.check((select count(*) = 0 from public.notifications where type = 'EMPLOYEE_WELCOME_EMAIL_FAILED' and entity_id = test.id('we_new')), 'a delivered e-mail raises no alarm');
select test.check(jsonb_array_length(public.welcome_email_claim(5, 'live', 600, null)) = 0, 'a sent e-mail is never taken again');

-- a permanent failure and a retry that never works
reset role;
insert into public.employee_welcome_emails (employee_id, recipient_email, trigger_event, event_key, status) values (test.id('we_tl'), 'we.tl@example.com', 'MANUAL_RESEND', 'RESEND:test-fail', 'PENDING');
update public.employee_welcome_emails set status = 'SKIPPED' where employee_id = test.id('we_tl') and event_key <> 'RESEND:test-fail';
select test.service();
delete from we_claim;
insert into we_claim select public.welcome_email_claim(5, 'live', 600, null);
select public.welcome_email_finish((select (j -> 0 ->> 'id')::uuid from we_claim), 'FAILED', 'HTTP 550: mailbox does not exist', 550, null);
select test.check((select status = 'FAILED' and last_error like 'HTTP 550%' from test.wemail('we_tl')), 'a permanent refusal fails at once');
reset role;
select test.check((select count(*) >= 1 from public.notifications where type = 'EMPLOYEE_WELCOME_EMAIL_FAILED' and entity_id = test.id('we_tl') and recipient_id = test.id('we_hr')), 'HR is told the welcome e-mail failed');
-- five temporary failures end as FAILED
update public.employee_welcome_emails set status = 'PENDING', attempts = 4, next_attempt_at = now() where event_key = 'RESEND:test-fail';
select test.service();
delete from we_claim;
insert into we_claim select public.welcome_email_claim(5, 'live', 600, null);
select public.welcome_email_finish((select (j -> 0 ->> 'id')::uuid from we_claim), 'RETRY', 'timeout', null, null);
select test.check((select status = 'FAILED' and attempts = 5 from test.wemail('we_tl')), 'after five attempts a temporary failure is final');

\echo '   who sees the status and who may resend'
reset role;
set role authenticated;
select test.login('we_hr');
select test.check((select count(*) >= 3 from jsonb_array_elements(welcome_emails_list() -> 'items') i where i ->> 'employee' in ('WE Rahul Sharma', 'WE Lead', 'WE HR')), 'HR sees the welcome e-mail status of employees');
select test.check((select (i ->> 'accountStatus') = 'ACTIVE' and (i ->> 'status') = 'SENT' and i ->> 'sentAt' is not null and (i ->> 'retryCount')::int = 1 and i ->> 'department' = 'WE Alpha' and i ->> 'email' = 'we.new@example.com'
                   from jsonb_array_elements(welcome_emails_list(null, test.id('we_new')) -> 'items') i), 'with the account status, the e-mail status, the send time, the retries and the address');
select test.check((select count(*) = 1 and bool_and(i ->> 'status' = 'FAILED') from jsonb_array_elements(welcome_emails_list('FAILED') -> 'items') i where i ->> 'employee' in ('WE Rahul Sharma', 'WE Lead', 'WE HR')), 'HR can list the failed ones');
select test.check(not exists (select 1 from jsonb_array_elements(welcome_emails_list() -> 'items') i where i::text ~* '(password|token_hash|recovery|redirect_to)'), 'nothing like a password or link appears in the list');
select test.must_fail($$select welcome_emails_list('BOGUS')$$, 'a wrong status filter is refused', 'valid status');
select test.login('we_dh');
select test.check((select count(*) >= 1 from jsonb_array_elements(welcome_emails_list() -> 'items') i where i ->> 'employee' = 'WE Rahul Sharma'), 'the employee''s Department Head sees it');
select test.login('we_dhb');
select test.check(not exists (select 1 from jsonb_array_elements(welcome_emails_list() -> 'items') i where i ->> 'department' = 'WE Alpha'), 'another department''s head does not');
select test.must_fail($$select welcome_email_resend(test.id('we_new'))$$, 'and cannot resend it', 'NOT_FOUND');
select test.login('we_tl');
select test.must_fail($$select welcome_emails_list()$$, 'a Team Lead cannot see the list', 'FORBIDDEN');
select test.must_fail($$select welcome_email_resend(test.id('we_new'))$$, 'nor resend', 'NOT_FOUND');

\echo '   resend: safe, recorded, never a duplicate'
select test.login('we_hr');
select test.must_fail($$select welcome_email_resend(test.id('we_new'))$$, 'an e-mail that was just sent is not sent again by accident', 'just sent');
reset role;
update public.employee_welcome_emails set sent_at = now() - interval '5 minutes' where employee_id = test.id('we_new');
set role authenticated;
select test.login('we_hr');
select test.check((welcome_email_resend(test.id('we_new')) ->> 'status') = 'PENDING', 'HR can resend: it is queued again');
select test.check((select resend_count = 1 and attempts = 0 and last_resend_by = test.id('we_hr') from test.wemail('we_new')), 'and the resend is recorded with who asked');
select test.must_fail($$select welcome_email_resend(test.id('we_new'))$$, 'a second click while it is queued is refused', 'already being sent');
select test.check(test.wecount('we_new') = 1, 'still one record for the activation');
reset role;
select test.check((select count(*) = 1 from public.employee_welcome_email_attempts where email_id = (select id from test.wemail('we_new')) and outcome = 'RESEND_REQUESTED' and actor_id = test.id('we_hr')), 'the resend is in the attempt history');
set role authenticated;
reset role;
update public.employee_welcome_emails set status = 'FAILED', last_resend_at = now() - interval '5 minutes' where event_key = 'RESEND:test-fail';
set role authenticated;
select test.login('we_dhb');
select test.must_fail($$select welcome_email_resend(test.id('we_tl'))$$, 'a Department Head can only resend for their own department', 'NOT_FOUND');
select test.login('we_hr');
select test.check((welcome_email_resend(test.id('we_tl')) ->> 'status') = 'PENDING', 'a failed e-mail can be resent');
reset role;

\echo '   the employee sets their own password: the link is spent'
select test.service();
select public.welcome_email_setup_done(test.id('we_new'));
select test.check((select setup_completed_at is not null from test.wemail('we_new')), 'the first-time setup is recorded');
reset role;
select test.check((select count(*) = 1 from audit_logs where action = 'EMPLOYEE_PASSWORD_SET' and entity_id = test.id('we_new')), 'and audited, with no password');
set role authenticated;
select test.login('we_hr');
select test.must_fail($$select welcome_email_resend(test.id('we_new'))$$, 'after that nobody can send a link that resets their password', 'already set their own password');
select test.check((select (i ->> 'canResend')::boolean is false and i ->> 'setupCompletedAt' is not null from jsonb_array_elements(welcome_emails_list(null, test.id('we_new')) -> 'items') i), 'the list says it cannot be resent');
reset role;

\echo '   no valid address, inactive accounts and what is never stored'
-- (the profile table itself refuses an address that is not valid, so the queue's own check is a second line of defence)
select test.check(private.welcome_queue(test.id('we_rej'), 'MANUAL_RESEND', 'RESEND:inactive', null, test.id('sa')) is null, 'an account that is not active gets nothing');
select test.check((select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name in ('employee_welcome_emails', 'employee_welcome_email_attempts')
                     and column_name ~* '(pass|token|secret|link|credential)'), 'no column can hold a password, link or token');
select test.check((select count(*) = 0 from information_schema.role_table_grants where table_name in ('employee_welcome_emails', 'employee_welcome_email_attempts') and grantee in ('anon', 'authenticated', 'public')), 'the tables have no grants for the app roles');
set role authenticated;
select test.login('we_hr');
select test.must_fail($$select count(*) from public.employee_welcome_emails$$, 'the tracking table is not readable directly', 'permission denied');
reset role;
-- the migration can be run again
\i supabase/migrations/20261218000100_employee_welcome_email.sql
select test.check(test.wecount('we_new') = 1 and test.wecount('we_tl') >= 1, 'running the migration again changes nothing');
\echo '   employee welcome e-mail: all checks passed'
