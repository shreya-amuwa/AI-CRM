-- =============================================================================
-- AI calls: who a transfer goes to (migration 20261220000100). Runs after the other suites, with its own synthetic departments.
-- The customer being called decides the department; the department's Technical Consultants answer, in turn, if they can be reached.
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- AI call transfers'
reset role;
\i supabase/migrations/20261220000100_ai_call_transfer.sql

delete from public.ai_call_transfers;
delete from customers where name like 'TR %';
delete from auth.users where email like 'tr.%@example.com';
delete from test.users where name like 'tr\_%';
delete from teams where department_id in (select id from departments where slug like 'tr-%');
delete from departments where slug like 'tr-%';
insert into departments (slug, name) values ('tr-a', 'TR Alpha'), ('tr-b', 'TR Beta');
insert into teams (department_id, name, division) select d.id, 'Sales', 'SALES' from departments d where d.slug like 'tr-%';
insert into teams (department_id, name, division) select d.id, 'Support', 'SUPPORT' from departments d where d.slug like 'tr-%';

create or replace function test.service() returns void language sql as $$ select set_config('request.jwt.claims', '{"role":"service_role"}', false) $$;
create or replace function test.trmk(p_name text, p_role text, p_dept text, p_team text, p_tc boolean default false) returns uuid language sql as $$
  select test.create_auth_user(p_name, 'tr.' || substr(p_name, 4) || '@example.com', jsonb_build_object('full_name', 'TR ' || substr(p_name, 4)),
    jsonb_strip_nulls(jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', p_role, 'provisioned_department_id', test.dept(p_dept),
      'provisioned_team_id', test.team(p_dept, p_team), 'provisioned_technical_consultant', case when p_tc then true end)))
$$;
grant execute on all functions in schema test to anon, authenticated;

select test.service();
select test.trmk('tr_a1', 'TEAM_MEMBER', 'tr-a', 'Support', true);
select test.service();
select test.trmk('tr_a2', 'TEAM_MEMBER', 'tr-a', 'Support', true);
select test.service();
select test.trmk('tr_a3', 'TEAM_MEMBER', 'tr-a', 'Support', true);   -- no phone
select test.service();
select test.trmk('tr_alead', 'TEAM_HEAD', 'tr-a', 'Support');
select test.service();
select test.trmk('tr_b1', 'TEAM_MEMBER', 'tr-b', 'Support', true);
select test.service();
select test.trmk('tr_bsales', 'TEAM_MEMBER', 'tr-b', 'Sales');
select test.check((select count(*) = 6 and bool_and(is_technical_consultant) filter (where full_name in ('TR a1', 'TR a2', 'TR a3', 'TR b1')) from profiles where id in (select id from test.users where name like 'tr\_%')), 'the synthetic people exist (four consultants)');
update profiles set phone = '+91 90000 00001' where id = test.id('tr_a1');
update profiles set phone = '9000000002' where id = test.id('tr_a2');
update profiles set phone = '09000000009' where id = test.id('tr_alead');
update profiles set phone = '9100000001' where id = test.id('tr_b1');
insert into customers (owner_id, name, company, phone, whatsapp, lifecycle_stage) values
  (test.id('tr_a1'), 'TR Asha Alpha', 'Asha Traders', '9876500001', null, 'CUSTOMER'),
  (test.id('tr_a1'), 'TR Anil Alpha', 'Anil Stores', '9876500003', '9876500004', 'CUSTOMER'),
  (test.id('tr_b1'), 'TR Bina Beta', 'Bina Clinic', '+91 98765 00002', null, 'CUSTOMER');

select test.service();
select test.check((select department_id = test.dept('tr-a') from customers where name = 'TR Asha Alpha') and (select department_id = test.dept('tr-b') from customers where name = 'TR Bina Beta'), 'each customer belongs to the department of its owner');

\echo '   the department decides, the consultants take turns'
create function pg_temp.ask(p_phone text, p_call text default null, p_ref text default null) returns jsonb language sql as $$ select public.ai_call_transfer_target(p_phone, p_ref, p_call) $$;
select test.check((pg_temp.ask('+919876500001', 'c1') ->> 'found')::boolean and pg_temp.ask('+919876500001', 'c1') ->> 'department' = 'TR Alpha', 'a customer of Alpha is sent to Alpha');
select test.check((pg_temp.ask('+919876500001', 'c1') ->> 'transferTo') = '+919000000001' and (pg_temp.ask('+919876500001', 'c1') ->> 'consultantName') = 'TR a1', 'the first call goes to the consultant who was sent one longest ago (nobody yet: by name)');
select test.check((pg_temp.ask('+919876500001', 'c1') ->> 'transferTo') = '+919000000001', 'the same call asking again gets the same consultant');
select test.check((select count(*) >= 1 and bool_and(outcome = 'ROUTED' and phone_masked = '+91XXXXXX0001') from ai_call_transfers where call_id = 'c1'), 'each answer is logged, with the customer''s number masked');
select test.check((pg_temp.ask('+919876500001', 'c2') ->> 'transferTo') = '+919000000002', 'the next call goes to the next consultant');
select test.check((pg_temp.ask('+919876500001', 'c3') ->> 'transferTo') = '+919000000001', 'and then it comes round again');
select test.check(not exists (select 1 from ai_call_transfers t join profiles p on p.id = t.consultant_id where p.id = test.id('tr_a3') or p.id = test.id('tr_b1')), 'a consultant with no number is never chosen, and nobody from Beta');
select test.check((pg_temp.ask('9876500002', 'd1') ->> 'transferTo') = '+919100000001' and (pg_temp.ask('9876500002', 'd1') ->> 'department') = 'TR Beta', 'a customer of Beta is sent to Beta (the number is read in any format)');
select test.check((pg_temp.ask('9876500004', 'e1') ->> 'department') = 'TR Alpha', 'the customer is found by their WhatsApp number too');

\echo '   the customer''s own consultant, leave, the team lead'
insert into customer_onboarding (customer_id, consultant_started_by) select id, test.id('tr_a2') from customers where name = 'TR Asha Alpha'
  on conflict (customer_id) do update set consultant_started_by = excluded.consultant_started_by;
select test.check((pg_temp.ask('9876500001', 'f1') ->> 'consultantName') = 'TR a2' and (pg_temp.ask('9876500001', 'f1') ->> 'how') = 'ASSIGNED', 'the consultant who started the customer''s onboarding takes the call');
insert into leave_requests (employee_id, department_id, leave_type, start_date, end_date, reason, status)
  values (test.id('tr_a2'), test.dept('tr-a'), 'FULL_DAY', (now() at time zone 'Asia/Kolkata')::date, (now() at time zone 'Asia/Kolkata')::date, 'away today', 'APPROVED');
select test.check((pg_temp.ask('9876500001', 'f2') ->> 'consultantName') = 'TR a1', 'a consultant on approved leave today is skipped, even the customer''s own');
update profiles set phone = null where id in (test.id('tr_a1'), test.id('tr_a2'));
select test.check((pg_temp.ask('9876500001', 'f3') ->> 'consultantName') = 'TR alead' and (pg_temp.ask('9876500001', 'f3') ->> 'how') = 'TEAM_LEAD' and (pg_temp.ask('9876500001', 'f3') ->> 'transferTo') = '+919000000009', 'with no consultant reachable the Support Team Lead takes it');
update profiles set phone = null where id = test.id('tr_alead');
select test.check(not (pg_temp.ask('9876500001', 'g1') ->> 'found')::boolean and (pg_temp.ask('9876500001', 'g1') ->> 'reason') = 'NO_CONSULTANT' and not (pg_temp.ask('9876500001', 'g1') ->> 'found')::boolean, 'with nobody at all the answer says so');
select test.check((select count(*) = 1 from notifications where type = 'AI_CALL_TRANSFER_MISSED' and recipient_id = test.id('tr_a1') and entity_id = (select id from customers where name = 'TR Asha Alpha')), 'the consultants of that department are told once to call the customer back');
select test.check((select count(*) = 0 from notifications where type = 'AI_CALL_TRANSFER_MISSED' and recipient_id = test.id('tr_b1')), 'nobody of another department is');
select test.check((select count(*) >= 1 from customer_activities where type = 'AI_CALL_TRANSFERRED') and (select count(*) = 1 from customer_activities where type = 'AI_CALL_TRANSFER_MISSED' and customer_id = (select id from customers where name = 'TR Asha Alpha')), 'the customer''s timeline shows the transfer and the missed one');

\echo '   unknown numbers and the reminder reference'
select test.check(not (pg_temp.ask('9811111111', 'h1') ->> 'found')::boolean and (pg_temp.ask('9811111111', 'h1') ->> 'reason') = 'NO_CUSTOMER', 'a number that is no customer is not routed');
select test.check(not (pg_temp.ask('hello', 'h2') ->> 'found')::boolean and (pg_temp.ask('hello', 'h2') ->> 'reason') = 'NO_CUSTOMER', 'nor is text that is no number');
update profiles set phone = '9000000001' where id = test.id('tr_a1');
insert into subscription_reminders (event_key, customer_id, service_code, expiry_date, stage, send_after, send_until, external_call_id)
  select 'TR|' || c.id, c.id, 'AI_CALLING', current_date + 7, 7, now(), now() + interval '1 day', 'bolify-call-77' from customers c where c.name = 'TR Bina Beta';
select test.check((pg_temp.ask('9999999999', null, 'bolify-call-77') ->> 'department') is null, 'a call id that matches no reminder and a wrong number finds nothing');
select test.check((public.ai_call_transfer_target('9999999999', null, 'bolify-call-77') ->> 'department') = 'TR Beta', 'the provider''s call id finds the customer the reminder was for, whatever number is given');
select test.check((public.ai_call_transfer_target(null, (select id::text from subscription_reminders where external_call_id = 'bolify-call-77'), null) ->> 'consultantName') = 'TR b1', 'so does the reminder''s own reference');

\echo '   who may ask and who may read'
set role authenticated;
select test.login('tr_a1');
select test.must_fail($$select public.ai_call_transfer_target('9876500001', null, null)$$, 'a signed-in employee cannot ask for transfer numbers', 'permission denied');
select test.must_fail($$select * from public.ai_call_transfers$$, 'the log cannot be read directly', 'permission denied');
select test.must_fail($$select public.ai_call_transfers_recent(10)$$, 'a Technical Consultant cannot read the record', 'FORBIDDEN');
select test.login('sa');
select test.check(jsonb_array_length(public.ai_call_transfers_recent(100)) >= 8, 'the Super Admin reads the record');
select test.check((select bool_and(e ->> 'phone' is null or e ->> 'phone' ~ '^\+91XXXXXX[0-9]{4}$') from jsonb_array_elements(public.ai_call_transfers_recent(100)) e), 'phone numbers in it are masked');
reset role;
set role anon;
select test.must_fail($$select public.ai_call_transfer_target('9876500001', null, null)$$, 'nor can a signed-out caller', 'permission denied');
reset role;
\echo '   AI call transfers: all checks passed'
