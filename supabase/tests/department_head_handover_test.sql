-- =============================================================================
-- Department Head hand-over queue (migration 20261209000600). Runs after the Meta Verifier suites on the same database and reuses their users:
-- late_verifier (Meta Verifier), late_consultant (Technical Consultant), dh_wab (Wabastore Department Head, Support side), tm_a (Sales),
-- hr.head (Department Head of another department), sa (Super Admin); the customers "Hand Two Traders" (Meta route, still with the verifier)
-- and "Alpha Traders" (handed over earlier, no consultation follow-up).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1
\echo '--- 79. Department Head hand-over queue'
reset role;
\i supabase/migrations/20261209000600_department_head_handover_queue.sql

create temp table hq (name text primary key, id uuid);
grant all on hq to authenticated, service_role;
insert into hq select 'two', id from customers where company = 'Hand Two Traders';
insert into hq select 'alpha', id from customers where company = 'Alpha Traders';
insert into hq select 'one', id from customers where company = 'Meta One Traders';

\echo '   a customer is invisible to the Department Head while it is with the verifier'
set role authenticated;
select test.login('dh_wab');
select test.check((select count(*) = 0 from customers where id = (select id from hq where name = 'two')), 'the Support-side head does not see a customer that has not been handed over');
select test.login('late_verifier');
select save_consultant_entry((select id from hq where name = 'two'), 'WABA_ID', '109876543210111');
select verify_all_onboarding_entries((select id from hq where name = 'two'));
select test.login('dh_wab');
select test.check((select count(*) = 0 from customers where id = (select id from hq where name = 'two')), 'documents authorized but not sent: still not in the queue');
select test.check(not exists (select 1 from jsonb_array_elements(handover_reconciliation_report() -> 'verifiedNotSent') x where x ->> 'customer' = 'Hand Two Traders'), 'while Meta verification is still open it is not "stuck": the report does not list it');
select test.login('late_verifier');
select test.must_fail($$select send_to_department_head((select id from hq where name = 'two'), 'too early')$$, 'it cannot be sent before Meta verification is complete (the journey rule is kept)', 'Complete the Meta verification first');
reset role;
-- Accounts' part of the journey (the client's login) is not what this suite is about: it exists, as the journey requires before Meta can be completed
select test.create_auth_user('hq_two_login', 'hq.two@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from hq where name = 'two')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values ((select id from hq where name = 'two'), test.id('hq_two_login'), 'hq.two@example.com');
set role authenticated;
select test.login('late_verifier');
select set_meta_verification((select id from hq where name = 'two'), 'COMPLETED', null);
select test.login('dh_wab');
select test.check((handover_reconciliation_report() -> 'verifiedNotSent' -> 0 ->> 'customer') = 'Hand Two Traders', 'once Meta verification is complete and nobody has sent it, the report lists it as "verified, not yet sent"');

\echo '   the Meta Verifier sends it: the Department Head sees it at once, whatever the Technical Consultant does'
select test.login('late_consultant');
select test.must_fail($$select send_to_department_head((select id from hq where name = 'two'), 'x')$$, 'the Technical Consultant has no part in sending a Meta customer', 'NOT_FOUND');
select test.login('tm_a');
select test.must_fail($$select send_to_department_head((select id from hq where name = 'two'), 'x')$$, 'nor Sales', 'NOT_FOUND');
select test.login('late_verifier');
select send_to_department_head((select id from hq where name = 'two'), 'All verified');
select test.login('dh_wab');
select test.check((select count(*) = 1 from customers where id = (select id from hq where name = 'two')), 'the Support-side Department Head sees the customer immediately');
select test.check((select count(*) = 1 from customer_onboarding where customer_id = (select id from hq where name = 'two') and handover_stage = 'DEPARTMENT_HEAD' and to_department_head_at is not null), 'with its hand-over state and date');
select test.check((customer_handover_info((select id from hq where name = 'two')) ->> 'route') = 'META'
               and (customer_handover_info((select id from hq where name = 'two')) ->> 'sentBy') = (select full_name from profiles where id = test.id('late_verifier')), 'the detail says the Meta Verifier verified it, and who sent it');
select test.check((customer_handover_info((select id from hq where name = 'two')) -> 'followUp' ->> 'status') in ('SCHEDULED', 'AWAITING_CONFIGURATION'), 'and shows the consultation follow-up as a separate task');
select test.check((select count(*) > 0 from customer_activities where customer_id = (select id from hq where name = 'two')), 'the customer''s history (activities) stays readable for the head');
select test.login('hr_head');
select test.check((select count(*) = 0 from customers where id = (select id from hq where name = 'two')), 'a Department Head of another department does not see it');
select test.must_fail($$select customer_handover_info((select id from hq where name = 'two'))$$, 'nor open its hand-over detail', 'NOT_FOUND');
select test.must_fail($$select pass_to_team_lead((select id from hq where name = 'two'), test.id('sup_th'))$$, 'nor pass it on', 'NOT_FOUND');
select test.login('tm_a');
select test.check((customer_handover_info((select id from hq where name = 'two')) -> 'followUp') is null or (customer_handover_info((select id from hq where name = 'two')) -> 'followUp') = 'null'::jsonb, 'Sales does not see the consultant''s follow-up');
reset role;

\echo '   the consultation is a separate task: one follow-up, one notice, the customer record untouched'
select test.check((select count(*) = 1 from tc_followups where customer_id = (select id from hq where name = 'two') and department_id = (select department_id from customers where id = (select id from hq where name = 'two'))
                      and assigned_to = test.id('late_consultant') and status in ('SCHEDULED', 'AWAITING_CONFIGURATION')), 'exactly one follow-up, in the customer''s department, assigned to the consultant');
select test.check((select count(*) = 1 from customers where company = 'Hand Two Traders'), 'still exactly one customer record');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('late_consultant') and type = 'TC_FOLLOWUP_SCHEDULED' and entity_id = (select id from hq where name = 'two')), 'the consultant was told once');
select test.check((select count(*) = 1 from notifications where recipient_id = test.id('dh_wab') and type = 'HANDOVER_TO_DEPARTMENT_HEAD' and entity_id = (select id from hq where name = 'two')), 'the Support-side Department Head was told once');
select private.schedule_tc_followup((select id from hq where name = 'two'), 'again');
select test.check((select count(*) = 1 from tc_followups where customer_id = (select id from hq where name = 'two'))
               and (select count(*) = 1 from notifications where recipient_id = test.id('late_consultant') and type = 'TC_FOLLOWUP_SCHEDULED' and entity_id = (select id from hq where name = 'two')), 'a repeated event creates no second follow-up and no second notice');
set role authenticated;
select test.login('late_consultant');
select test.check(jsonb_array_length(tc_followups_list('OPEN')) >= 1 and exists (select 1 from jsonb_array_elements(tc_followups_list('OPEN')) x where x ->> 'customer' = 'Hand Two Traders'), 'the consultant sees it in their follow-ups');
select test.login('dh_wab');
select pass_to_team_lead((select id from hq where name = 'two'), test.id('sup_th'), 'please look after');
reset role;
select test.check((select handover_stage = 'TEAM_LEAD' from customer_onboarding where customer_id = (select id from hq where name = 'two'))
               and (select count(*) = 1 from tc_followups where customer_id = (select id from hq where name = 'two') and status in ('SCHEDULED', 'AWAITING_CONFIGURATION')), 'passing it on does not touch the consultant''s task');
set role authenticated;
select test.login('dh_wab');
select test.check((select count(*) = 1 from customers where id = (select id from hq where name = 'two')), 'and the head still sees it (stage "with team lead")');
reset role;

\echo '   who is told about a hand-over: the Support side of the department, else any active head'
insert into departments (slug, name, description) values ('hq-both', 'HQ Both', ''), ('hq-sales-only', 'HQ Sales Only', ''), ('hq-none', 'HQ None', '');
select test.create_auth_user('hq_b_sales', 'hq.b.sales@amuwa.com', '{"full_name":"HQ Both Sales"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('hq-both'), 'provisioned_head_division', 'SALES'));
select test.create_auth_user('hq_b_sup', 'hq.b.sup@amuwa.com', '{"full_name":"HQ Both Support"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('hq-both'), 'provisioned_head_division', 'SUPPORT'));
select test.create_auth_user('hq_s', 'hq.s@amuwa.com', '{"full_name":"HQ Sales Only"}', jsonb_build_object('provisioned_by', test.id('sa'), 'provisioned_role', 'DEPARTMENT_HEAD', 'provisioned_department_id', test.dept('hq-sales-only'), 'provisioned_head_division', 'SALES'));
select test.check((select array_agg(p.email) = array['hq.b.sup@amuwa.com'] from private.handover_head_recipients(test.dept('hq-both')) r join profiles p on p.id = r.profile_id), 'with a Sales head and a Support head, the Support head is told');
select test.check((select array_agg(p.email) = array['hq.s@amuwa.com'] from private.handover_head_recipients(test.dept('hq-sales-only')) r join profiles p on p.id = r.profile_id), 'a department with only a Sales-side head still has somebody to send to (the hand-over is never blocked)');
select test.check((select count(*) = 0 from private.handover_head_recipients(test.dept('hq-none'))), 'a department without a head has nobody (the send is refused with a clear message)');
update profiles set status = 'SUSPENDED' where email = 'hq.b.sup@amuwa.com';
select test.check((select count(*) = 2 from private.handover_head_recipients(test.dept('hq-both'))) is not true
               and (select array_agg(p.email) = array['hq.b.sales@amuwa.com'] from private.handover_head_recipients(test.dept('hq-both')) r join profiles p on p.id = r.profile_id), 'an inactive Support head is skipped: the active head of the department is used');

\echo '   a Sales-side head gets no extra access'
set role authenticated;
select test.login('hq_s');
select test.check((select count(*) = 0 from customers where id = (select id from hq where name = 'two')), 'a Department Head of another department (Sales side) cannot read it');
reset role;

\echo '   reconciliation: report, then one audited action that only adds what is missing'
select test.check((select handover_stage = 'TEAM_MEMBER' from customer_onboarding where customer_id = (select id from hq where name = 'alpha')) and not exists (select 1 from tc_followups where customer_id = (select id from hq where name = 'alpha')), 'Alpha Traders was handed over before the follow-up existed');
create temp table hq_before as select o.handover_stage, o.team_lead_id, o.team_member_id, o.to_department_head_at, c.owner_id, c.department_id, c.lifecycle_stage
  from customer_onboarding o join customers c on c.id = o.customer_id where o.customer_id = (select id from hq where name = 'alpha');
grant all on hq_before to authenticated;
set role authenticated;
select test.login('tm_a');
select test.must_fail($$select handover_reconciliation_report()$$, 'Sales cannot read the report', 'FORBIDDEN');
select test.must_fail($$select handover_reconcile_followups()$$, 'nor run the action', 'FORBIDDEN');
select test.login('dh_wab');
select test.check(exists (select 1 from jsonb_array_elements(handover_reconciliation_report() -> 'handedOverWithoutFollowUp') x where x ->> 'customer' = 'Alpha Traders'), 'the Department Head sees their department''s customers that lack a follow-up');
select test.must_fail($$select handover_reconcile_followups()$$, 'but only the Super Admin can create them', 'Only the Super Admin');
select test.login('hr_head');
select test.check(jsonb_array_length(handover_reconciliation_report() -> 'handedOverWithoutFollowUp') = 0, 'another department''s head sees none of it');
select test.login('sa');
select test.check((handover_reconcile_followups() ->> 'customers')::int >= 1, 'the Super Admin creates the missing follow-ups');
select test.check((handover_reconcile_followups() ->> 'customers')::int = 0, 'a second run creates nothing');
reset role;
select test.check((select count(*) = 1 from tc_followups where customer_id = (select id from hq where name = 'alpha')), 'Alpha Traders now has exactly one follow-up');
select test.check((select count(*) = 0 from hq_before b join customer_onboarding o on o.customer_id = (select id from hq where name = 'alpha')
                    join customers c on c.id = o.customer_id
                   where (b.handover_stage, b.team_lead_id, b.team_member_id, b.to_department_head_at, b.owner_id, b.department_id, b.lifecycle_stage)
                         is distinct from (o.handover_stage, o.team_lead_id, o.team_member_id, o.to_department_head_at, c.owner_id, c.department_id, c.lifecycle_stage)),
  'its status, assignments, owner and hand-over dates are exactly as they were');
select test.check((select count(*) = 2 and bool_or((metadata ->> 'customers')::int >= 1) and bool_or((metadata ->> 'customers')::int = 0) from audit_logs where action = 'HANDOVER_FOLLOWUPS_RECONCILED' and actor_id = test.id('sa')), 'and every run of the action is audited with how many customers it touched');
select test.check((select count(*) = 1 from customers where company = 'Alpha Traders'), 'nothing was duplicated');
