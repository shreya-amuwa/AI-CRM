-- =============================================================================
-- Ticket hierarchy (migration 20261025000100): Relationship Manager -> Team Lead -> Department Head,
-- SLA escalation, replies both ways, management views, duplicates.
-- Runs after the other suites (same database, reuses the `test` helpers and staff users).
-- =============================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

\echo '--- 29. Tickets: Relationship Manager, SLA escalation, replies, monitoring'
reset role;
create temp table tk (name text primary key, id uuid);
grant all on tk to authenticated, service_role;

-- Two customers with a client login: R has a Relationship Manager (Support B, lead Support Lead); N has nobody yet.
set role authenticated;
select test.login('tm_a');
insert into tk select 'R', create_lead('{"name":"Rm Customer","company":"Rm Traders","email":"rm.cust@example.com","phone":"9819900201","leadSource":"Walk-in"}', array['AI_CALLING']);
insert into tk select 'N', create_lead('{"name":"No Rm Customer","company":"Nobody Stores","email":"norm.cust@example.com","phone":"9819900202","leadSource":"Walk-in"}', array['AI_CALLING']);
reset role;
select test.create_auth_user('tk_r', 'rm.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from tk where name = 'R')));
select test.create_auth_user('tk_n', 'norm.login@example.com', '{}'::jsonb, jsonb_build_object('provider', 'email', 'client_customer_id', (select id from tk where name = 'N')));
insert into customer_client_accounts (customer_id, auth_user_id, email) values
  ((select id from tk where name = 'R'), test.id('tk_r'), 'rm.login@example.com'),
  ((select id from tk where name = 'N'), test.id('tk_n'), 'norm.login@example.com');
update customers set lifecycle_stage = 'CUSTOMER' where id in (select id from tk where name in ('R', 'N'));
insert into customer_onboarding (customer_id, forwarded_to_support_at, stage, handover_stage, team_lead_id, team_member_id,
                                 to_department_head_at, passed_to_team_lead_at, assigned_to_member_at)
values ((select id from tk where name = 'R'), now(), 'SETUP', 'TEAM_MEMBER', test.id('sup_th'), test.id('sup_b'), now(), now(), now())
on conflict (customer_id) do update set handover_stage = 'TEAM_MEMBER', team_lead_id = test.id('sup_th'), team_member_id = test.id('sup_b');
insert into customer_onboarding (customer_id, forwarded_to_support_at, stage) values ((select id from tk where name = 'N'), now(), 'SETUP')
on conflict (customer_id) do nothing;

-- ---------------------------------------------------------------- SLA settings
select test.check((select rm_response_minutes > 0 and tl_response_minutes > 0 from ticket_sla_settings where department_id is null), 'a default SLA exists (configurable, not in code)');
set role authenticated;
select test.login('sup_b');
select test.check((select (ticket_sla_settings() ->> 'rmMinutes')::int > 0 and not (ticket_sla_settings() ->> 'canEdit')::boolean), 'Support staff can read the SLA');
select test.must_fail($$select set_ticket_sla(60, 60)$$, 'a team member cannot change it', 'FORBIDDEN');
select test.login('sup_th');
select test.must_fail($$select set_ticket_sla(60, 60)$$, 'nor can a team lead', 'FORBIDDEN');
select test.login('tk_r');
select test.must_fail($$select ticket_sla_settings()$$, 'a client cannot read it', 'FORBIDDEN');
select test.login('dh_wab');
select test.must_fail($$select set_ticket_sla(1, 60)$$, 'the SLA has sensible limits', 'between 5 minutes');
select test.check((select set_ticket_sla(120, 60) ->> 'scope' = 'DEPARTMENT'), 'the Department Head sets the SLA of their department');
select test.check((select (ticket_sla_settings() ->> 'rmMinutes')::int = 120 and (ticket_sla_settings() ->> 'tlMinutes')::int = 60), 'and reads it back');
select test.login('dh_wbx');
select test.check((select ticket_sla_settings() ->> 'scope' = 'DEFAULT' and (ticket_sla_settings() ->> 'rmMinutes')::int <> 120),
  'another department keeps the default');

-- ---------------------------------------------------------------- 1. a new ticket goes to the RM
select test.login('tk_r');
insert into tk select 'T1', (client_create_ticket('Calls are not connecting', 'No outgoing AI calls since this morning', 'TECHNICAL') ->> 'id')::uuid;
select test.check((select (client_create_ticket('Calls are not connecting', 'No outgoing AI calls since this morning', 'TECHNICAL') ->> 'id')::uuid = (select id from tk where name = 'T1')),
  'submitting the same ticket twice returns the first one');
select test.check((select jsonb_array_length(client_tickets()) = 1), 'so only one ticket exists');
select test.check((select client_ticket((select id from tk where name = 'T1')) ->> 'relationshipManager' = 'Support B'
                      and client_ticket((select id from tk where name = 'T1')) ->> 'handledBy' = 'RELATIONSHIP_MANAGER'
                      and not (client_ticket((select id from tk where name = 'T1')) ->> 'escalated')::boolean), 'the client sees their Relationship Manager on the ticket');
reset role;
select test.check((select assignee_id = test.id('sup_b') and escalation_level = 'RM' and escalated_to is null
                      and sla_due_at between now() + interval '119 minutes' and now() + interval '121 minutes'
                    from support_tickets where id = (select id from tk where name = 'T1')), 'the ticket is assigned to the RM with the department''s RM deadline');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_FROM_CLIENT' and recipient_id = test.id('sup_b') and entity_id = (select id from tk where name = 'T1')),
  'the RM is notified once');

-- ---------------------------------------------------------------- fallback: no RM -> the Team Lead
set role authenticated;
select test.login('tk_n');
insert into tk select 'N1', (client_create_ticket('Need an invoice copy', 'Please send the invoice for last month', 'BILLING') ->> 'id')::uuid;
reset role;
select test.check((select assignee_id is null and escalation_level = 'TL' and escalated_to is not null
                      and (select role = 'TEAM_HEAD' and team_id = t.team_id from profiles where id = t.escalated_to)
                      and sla_due_at between now() + interval '59 minutes' and now() + interval '61 minutes'
                    from support_tickets t where id = (select id from tk where name = 'N1')), 'without an RM the ticket starts with a Team Lead, on the Team Lead SLA');
select test.check((select count(*) = 1 from notifications where recipient_id = (select escalated_to from support_tickets where id = (select id from tk where name = 'N1'))
                      and type = 'TICKET_FROM_CLIENT' and entity_id = (select id from tk where name = 'N1')), 'that Team Lead is notified');
set role authenticated;
select test.login('tk_n');
select test.check((select client_ticket((select id from tk where name = 'N1')) ->> 'handledBy' = 'TEAM_LEAD'
                      and not (client_ticket((select id from tk where name = 'N1')) ->> 'escalated')::boolean), 'the client is not told it was escalated (it was not)');

-- ---------------------------------------------------------------- 2. customer replies reach the RM
select test.login('tk_r');
select client_reply_ticket((select id from tk where name = 'T1'), 'Still not working, please call me');
select client_reply_ticket((select id from tk where name = 'T1'), 'Still not working, please call me');
reset role;
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from tk where name = 'T1') and kind = 'CLIENT_REPLY'), 'the same reply sent twice is stored once');
set role authenticated;
select test.login('sup_b');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from tk where name = 'T1') and kind = 'CLIENT_REPLY' and note like 'Still not working%'),
  'the RM reads the customer''s reply in their ticket inbox (live through Realtime on support_ticket_updates)');
select test.check((select last_client_message_at is not null and last_client_message_at > coalesce(last_staff_reply_at, '-infinity') from support_tickets where id = (select id from tk where name = 'T1')),
  'the ticket shows it is waiting for a reply');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'TICKET_CLIENT_REPLY' and recipient_id = test.id('sup_b') and entity_id = (select id from tk where name = 'T1')), 'the RM is notified of the reply');

-- ---------------------------------------------------------------- 3. staff replies reach the customer
set role authenticated;
select test.login('sup_b');
select reply_to_client_ticket((select id from tk where name = 'T1'), 'Calling you in 10 minutes.');
select reply_to_client_ticket((select id from tk where name = 'T1'), 'Calling you in 10 minutes.');
select test.check((select sla_due_at is null and first_response_at is not null and last_staff_reply_at is not null from support_tickets where id = (select id from tk where name = 'T1')),
  'answering the customer stops the SLA clock');
select test.login('tk_r');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'T1')) -> 'updates') u
                    where u ->> 'type' = 'SUPPORT' and u ->> 'message' = 'Calling you in 10 minutes.' and u ->> 'author' = 'Support B'), 'the customer sees the staff reply once');
select test.check((select (t ->> 'unread')::int >= 1 from jsonb_array_elements(client_tickets()) t where (t ->> 'id')::uuid = (select id from tk where name = 'T1')), 'and it is marked unread');
select test.check((select count(*) >= 1 from client_notifications where entity_id = (select id from tk where name = 'T1') and type = 'TICKET_REPLY'), 'the client reads the new reply notification (Realtime source)');
select test.check((select client_ticket_seen((select id from tk where name = 'T1')) >= 1), 'opening the ticket marks it read');
select test.check((select (t ->> 'unread')::int = 0 from jsonb_array_elements(client_tickets()) t where (t ->> 'id')::uuid = (select id from tk where name = 'T1')), 'so it is no longer unread');
select test.login('tk_n');
select test.must_fail($$select client_ticket_seen((select id from tk where name = 'T1'))$$, 'a client cannot touch another client''s ticket', 'not found');
select test.check((select count(*) = 0 from client_notifications where customer_id = (select id from tk where name = 'R')), 'nor read their notifications');
select test.check((select jsonb_array_length(client_tickets()) = 1), 'and lists only their own ticket');

-- ---------------------------------------------------------------- 4. SLA escalation RM -> TL -> DH
select test.login('tk_r');
select client_reply_ticket((select id from tk where name = 'T1'), 'You did not call');
reset role;
select test.check((select sla_due_at is not null from support_tickets where id = (select id from tk where name = 'T1')), 'a new customer message restarts the clock');
set role authenticated;
select test.login('sup_b');
select test.check((select escalate_overdue_tickets() = 0), 'nothing escalates before the deadline');
reset role;
update support_tickets set sla_due_at = now() - interval '1 minute' where id = (select id from tk where name = 'T1');
set role authenticated;
select test.login('tk_r');
select test.check((select escalate_overdue_tickets() = 0), 'a client cannot run the escalation');
select test.login('tm_a');
select test.check((select escalate_overdue_tickets() = 0), 'nor can Sales staff');
reset role;
select test.check((select escalation_level = 'RM' from support_tickets where id = (select id from tk where name = 'T1')), 'so the ticket is unchanged');
set role authenticated;
select test.login('sup_b');
select test.check((select escalate_overdue_tickets() = 1), 'an overdue ticket escalates');
select test.check((select escalate_overdue_tickets() = 0), 'and only once');
reset role;
select test.check((select escalation_level = 'TL' and escalated_to = test.id('sup_th') and assignee_id = test.id('sup_b') and status = 'ESCALATED'
                      and sla_due_at between now() + interval '59 minutes' and now() + interval '61 minutes'
                    from support_tickets where id = (select id from tk where name = 'T1')), 'to the customer''s Team Lead, with the Team Lead SLA; the RM stays assigned');
select test.check((select count(*) = 1 from support_ticket_escalations where ticket_id = (select id from tk where name = 'T1') and from_level = 'RM' and to_level = 'TL'
                      and from_user = test.id('sup_b') and to_user = test.id('sup_th') and reason = 'SLA' and actor_id is null), 'the escalation is on the audit trail');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_ESCALATED' and recipient_id = test.id('sup_th') and priority = 'urgent' and entity_id = (select id from tk where name = 'T1')),
  'the Team Lead is notified (urgent)');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_ESCALATED' and recipient_id = test.id('sup_b') and entity_id = (select id from tk where name = 'T1')), 'the RM is kept informed');
select test.check((select count(*) = 1 from client_notifications where type = 'TICKET_ESCALATED' and entity_id = (select id from tk where name = 'T1')), 'the client is told');
select test.check((select count(*) = 1 from audit_logs where action = 'TICKET_ESCALATED' and entity_id = (select id from tk where name = 'T1')), 'and it is audited');
set role authenticated;
select test.login('tk_r');
select test.check((select client_ticket((select id from tk where name = 'T1')) ->> 'handledBy' = 'TEAM_LEAD' and (client_ticket((select id from tk where name = 'T1')) ->> 'escalated')::boolean
                      and client_ticket((select id from tk where name = 'T1')) ->> 'relationshipManager' = 'Support B'), 'the client sees the escalation and still their RM');
select test.check((select not exists (select 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'T1')) -> 'updates') u where u ->> 'message' like '%SLA%')),
  'internal escalation wording stays internal');
select client_reply_ticket((select id from tk where name = 'T1'), 'Any update?');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'TICKET_CLIENT_REPLY' and recipient_id = test.id('sup_th') and priority = 'urgent' and body = 'Any update?'),
  'after escalation the Team Lead gets customer replies');
select test.check((select count(*) = 1 from notifications where type = 'TICKET_CLIENT_REPLY' and recipient_id = test.id('sup_b') and body = 'Any update?'), 'and so does the RM');
update support_tickets set sla_due_at = now() - interval '1 minute' where id = (select id from tk where name = 'T1');
select set_config('request.jwt.claims', '', false);  -- the scheduled job: nobody signed in
select test.check((select escalate_overdue_tickets() = 1), 'the scheduled job (no user) escalates the next overdue level');
select test.check((select escalation_level = 'DH' and escalated_to = test.id('dh_wab') and sla_due_at is null from support_tickets where id = (select id from tk where name = 'T1')),
  'to the Department Head, the last level');
select test.check((select count(*) = 2 from support_ticket_escalations where ticket_id = (select id from tk where name = 'T1')), 'both steps are on the audit trail');
select test.check((select count(*) >= 1 from notifications where type = 'TICKET_ESCALATED' and recipient_id = test.id('dh_wab') and priority = 'urgent' and entity_id = (select id from tk where name = 'T1')),
  'the Department Head is notified');
select test.check((select count(*) = 0 from support_tickets where id = (select id from tk where name = 'T1') and customer_id <> (select id from tk where name = 'R')), 'the ticket keeps its customer');
select test.check((select count(*) = 3 from support_ticket_updates where ticket_id = (select id from tk where name = 'T1') and kind = 'CLIENT_REPLY'), 'and its whole conversation');
set role authenticated;
select test.login('sup_b');
select test.must_fail($$select escalate_support_ticket((select id from tk where name = 'T1'))$$, 'a ticket with the Department Head cannot go higher', 'already with the Department Head');
select test.check((select count(*) = 1 from support_tickets where id = (select id from tk where name = 'T1')), 'the RM still sees the escalated ticket');
select test.login('dh_wab');
select reply_to_client_ticket((select id from tk where name = 'T1'), 'I am looking into this personally.');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'TICKET_STAFF_REPLY' and recipient_id = test.id('sup_b') and entity_id = (select id from tk where name = 'T1')),
  'the RM is told when the Department Head answers');
set role authenticated;
select update_support_ticket((select id from tk where name = 'T1'), 'RESOLVED', 'Fixed the dialler', 'Dialler configuration corrected');
reset role;
select test.check((select resolved_by = test.id('dh_wab') and resolved_at is not null and sla_due_at is null from support_tickets where id = (select id from tk where name = 'T1')),
  'who resolved the ticket and when is recorded');

-- ---------------------------------------------------------------- manual escalation
set role authenticated;
select test.login('tk_r');
insert into tk select 'T2', (client_create_ticket('Wrong number on profile', 'My WhatsApp number shows the old one', 'GENERAL') ->> 'id')::uuid;
select test.login('sup_plain');
select test.must_fail($$select escalate_support_ticket((select id from tk where name = 'T2'), 'not mine')$$, 'another member cannot escalate someone else''s ticket', 'not found');
select test.login('th_gen');
select test.must_fail($$select escalate_support_ticket((select id from tk where name = 'T2'))$$, 'nor a Team Lead of another team', 'not found');
select test.login('sup_b');
select test.check((select escalate_support_ticket((select id from tk where name = 'T2'), 'Needs a number change approval') ->> 'escalationLevel' = 'TL'), 'the RM escalates to the Team Lead by hand');
reset role;
select test.check((select reason = 'MANUAL' and actor_id = test.id('sup_b') and note = 'Needs a number change approval' from support_ticket_escalations where ticket_id = (select id from tk where name = 'T2')),
  'with who did it and why');
set role authenticated;
select test.login('sup_th');
select update_support_ticket((select id from tk where name = 'T2'), 'IN_PROGRESS', 'Approved, changing it');
select update_support_ticket((select id from tk where name = 'T2'), 'ESCALATED', 'Needs head approval too');
reset role;
select test.check((select escalation_level = 'DH' and escalated_to = test.id('dh_wab') from support_tickets where id = (select id from tk where name = 'T2')),
  'the existing Escalate status moves the ticket up the same way');

-- ---------------------------------------------------------------- 5. Team Lead monitoring
set role authenticated;
select test.login('sup_th');
select test.check((select count(*) = 2 from support_tickets where customer_id = (select id from tk where name = 'R')), 'the Team Lead sees the tickets of their team members');
select test.check((select count(*) = 1 from support_tickets where customer_id = (select id from tk where name = 'R') and status in ('RESOLVED', 'CLOSED') and resolved_by is not null)
                  and (select count(*) = 1 from support_tickets where customer_id = (select id from tk where name = 'R') and status not in ('RESOLVED', 'CLOSED')),
  'resolved and unresolved, with who resolved them');
select test.check((select count(*) = 2 from support_ticket_escalations where ticket_id = (select id from tk where name = 'T1')), 'and the escalation trail');
select test.check((select assignee_id = test.id('sup_b') from support_tickets where id = (select id from tk where name = 'T1')), 'watching does not make the Team Lead the owner');
select test.login('th_gen');
select test.check((select count(*) = 0 from support_tickets where customer_id = (select id from tk where name = 'R')), 'a Team Lead of another team sees none of them');
select test.check((select count(*) = 0 from support_ticket_escalations where ticket_id = (select id from tk where name = 'T1')), 'nor their escalations');
select test.must_fail($$select reply_to_client_ticket((select id from tk where name = 'T2'), 'hi')$$, 'nor can reply', 'not found');
select test.login('sup_plain');
select test.check((select count(*) = 0 from support_tickets where customer_id = (select id from tk where name = 'R')), 'another team member does not see them either');

-- ---------------------------------------------------------------- 6. Department Head monitoring
select test.login('dh_wab');
select test.check((select count(*) >= 3 from support_tickets where customer_id in (select id from tk where name in ('R', 'N'))), 'the Department Head sees every ticket of the department');
select test.login('dh_wbx');
select test.check((select count(*) = 0 from support_tickets where customer_id in (select id from tk where name in ('R', 'N'))), 'another department''s head sees none');
select test.must_fail($$select escalate_support_ticket((select id from tk where name = 'N1'))$$, 'nor can escalate them', 'not found');
select test.login('tk_n');
select test.must_fail($$select escalate_support_ticket((select id from tk where name = 'N1'))$$, 'a client cannot escalate staff side', 'not found|FORBIDDEN|Sign in');

-- ---------------------------------------------------------------- the RM is assigned later: the ticket goes back to the RM level
reset role;
update customer_onboarding set handover_stage = 'TEAM_MEMBER', team_lead_id = test.id('sup_th'), team_member_id = test.id('sup_plain')
 where customer_id = (select id from tk where name = 'N');
select test.check((select assignee_id = test.id('sup_plain') and escalation_level = 'RM' and escalated_to is null from support_tickets where id = (select id from tk where name = 'N1')),
  'a ticket that waited with the Team Lead for lack of an RM follows the customer to their new RM');

-- re-running the migration keeps everything
reset role;
\echo '=== ALL TICKET HIERARCHY TESTS PASSED ==='
