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


-- ---------------------------------------------------------------- chat (migration 20261026000100)
\echo '--- 30. Ticket chat: one thread per ticket, no duplicates, read state'
set role authenticated;
select test.login('tk_r');
insert into tk select 'C1', (client_create_ticket('Chat ticket', 'Hello, my campaign stopped', 'GENERAL') ->> 'id')::uuid;
select test.check((select count(*) = 1 and bool_and(m ->> 'from' = 'CLIENT' and m ->> 'text' = 'Hello, my campaign stopped')
                     from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'kind' = 'MESSAGE'),
  'the opening message is the first message of the conversation, once');
select test.check((select count(*) >= 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m
                    where m ->> 'kind' = 'EVENT' and m ->> 'event' = 'ASSIGNED' and m ->> 'author' = 'Support B'), 'the assignment is a timeline event');
select client_send_ticket_message((select id from tk where name = 'C1'), 'First follow-up', '11111111-1111-1111-1111-111111111111');
select client_send_ticket_message((select id from tk where name = 'C1'), 'First follow-up', '11111111-1111-1111-1111-111111111111');
select client_send_ticket_message((select id from tk where name = 'C1'), 'Second follow-up', '22222222-2222-2222-2222-222222222222');
select test.check((select count(*) = 3 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'from' = 'CLIENT'),
  'several client messages, the retried one stored once');
select test.check((select jsonb_array_length(client_tickets()) = 3), 'messages never create tickets');
select test.check((select (t -> 'lastMessage' ->> 'text') = 'Second follow-up' and t -> 'lastMessage' ->> 'from' = 'CLIENT'
                     from jsonb_array_elements(client_tickets()) t where (t ->> 'id')::uuid = (select id from tk where name = 'C1')), 'the inbox shows the last message');
select test.check((select not (m ->> 'seen')::boolean from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m
                    where m ->> 'text' = 'Second follow-up'), 'not seen by Support yet');

select test.login('sup_b');
select test.check((select count(*) = 3 from support_ticket_updates where ticket_id = (select id from tk where name = 'C1') and client_author and kind in ('CREATED', 'CLIENT_REPLY')),
  'the RM reads every customer message');
select test.check((select coalesce((select read_at from support_ticket_reads where ticket_id = (select id from tk where name = 'C1')), '-infinity') < last_message_at
                     from support_tickets where id = (select id from tk where name = 'C1')), 'they are unread for the RM');
select mark_support_ticket_read((select id from tk where name = 'C1'));
select test.check((select read_at >= (select last_message_at from support_tickets where id = (select id from tk where name = 'C1'))
                     from support_ticket_reads where ticket_id = (select id from tk where name = 'C1') and profile_id = test.id('sup_b')), 'opening the chat marks it read');
select send_ticket_message((select id from tk where name = 'C1'), 'Looking at it now', false, '33333333-3333-3333-3333-333333333333');
select send_ticket_message((select id from tk where name = 'C1'), 'Looking at it now', false, '33333333-3333-3333-3333-333333333333');
select send_ticket_message((select id from tk where name = 'C1'), 'Customer seems to have paused billing', true, '44444444-4444-4444-4444-444444444444');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from tk where name = 'C1') and note = 'Looking at it now'), 'a staff reply sent twice is stored once');
select test.check((select author_label = 'Relationship Manager' from support_ticket_updates where ticket_id = (select id from tk where name = 'C1') and note = 'Looking at it now'),
  'the sender''s role is recorded');
select test.check((select last_message_preview = 'Looking at it now' and last_message_from = 'STAFF' from support_tickets where id = (select id from tk where name = 'C1')),
  'internal notes are not the conversation preview');
select test.login('tk_r');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m
                    where m ->> 'from' = 'STAFF' and m ->> 'text' = 'Looking at it now' and m ->> 'author' = 'Support B' and m ->> 'role' = 'Relationship Manager'),
  'the customer sees the reply with name and role');
select test.check((select not exists (select 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'text' like '%paused billing%')),
  'internal notes stay internal');
select test.check((select (m ->> 'seen')::boolean from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'text' = 'Second follow-up'),
  'the customer sees their message was read');
select test.check((select (client_ticket((select id from tk where name = 'C1')) ->> 'unread')::int = 1), 'one unread reply for the customer');
select client_ticket_seen((select id from tk where name = 'C1'));
select test.check((select (client_ticket((select id from tk where name = 'C1')) ->> 'unread')::int = 0), 'opening the ticket reads it');
select test.check((select (m.j ->> 'kind') = 'MESSAGE' and (m.j ->> 'from') = 'CLIENT'
                     from (select x as j, row_number() over () as n from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') x) m
                    where m.n = (select min(n) from (select row_number() over () as n, x from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') x) y where y.x ->> 'kind' = 'MESSAGE')),
  'messages come in order, the opening message first');

-- the reported bug: a reply that reopens a resolved ticket showed twice
select test.login('sup_b');
select update_support_ticket((select id from tk where name = 'C1'), 'RESOLVED', 'done', 'Billing resumed');
select test.login('tk_r');
select client_send_ticket_message((select id from tk where name = 'C1'), 'It stopped again', '55555555-5555-5555-5555-555555555555');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'kind' = 'MESSAGE' and m ->> 'text' = 'It stopped again')
                  and (select count(*) = 0 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'kind' = 'MESSAGE' and m ->> 'text' is null),
  'a reply that reopens a ticket is shown once (no empty second bubble)');
select test.check((select count(*) = 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'event' = 'REOPENED')
                  and (select count(*) = 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m ->> 'event' = 'RESOLVED'),
  'resolved and reopened are timeline events');
select test.check((select count(*) = 0 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'updates') u where u ->> 'type' = 'CLIENT' and u ->> 'message' is null),
  'the older reply list has no empty client entries either');
select test.check((select client_ticket((select id from tk where name = 'C1')) ->> 'status' = 'OPEN'), 'and the ticket is open again');

-- who may write
select test.login('tk_n');
select test.must_fail($$select client_send_ticket_message((select id from tk where name = 'C1'), 'not mine', null)$$, 'another client cannot write in the ticket', 'not found');
select test.login('th_gen');
select test.must_fail($$select send_ticket_message((select id from tk where name = 'C1'), 'hi', false, null)$$, 'a Team Lead of another team cannot write', 'not found');
select test.must_fail($$select mark_support_ticket_read((select id from tk where name = 'C1'))$$, 'nor mark it read', 'not found');
select test.login('sup_plain');
select test.must_fail($$select send_ticket_message((select id from tk where name = 'C1'), 'hi', true, null)$$, 'another member cannot add notes', 'not found');
select test.check((select count(*) = 0 from support_ticket_reads where ticket_id = (select id from tk where name = 'C1')), 'nor see who read it');
select test.login('sup_th');
select send_ticket_message((select id from tk where name = 'C1'), 'Team Lead here, we are on it.', false, null);
select test.check((select author_label = 'Team Lead' from support_ticket_updates where note = 'Team Lead here, we are on it.'), 'the Team Lead can step in, labelled as Team Lead');
select test.check((select assignee_id = test.id('sup_b') from support_tickets where id = (select id from tk where name = 'C1')), 'stepping in does not take the ticket over');
select test.must_fail($$select escalate_support_ticket((select id from tk where name = 'C1'), '  ')$$, 'a manual escalation needs a reason', 'reason');
reset role;
select test.check((select count(*) >= 1 from notifications where type = 'TICKET_STAFF_REPLY' and recipient_id = test.id('sup_b') and entity_id = (select id from tk where name = 'C1')),
  'the RM is told when the Team Lead replies');

-- ---------------------------------------------------------------- priority control + picking a ticket up (migration 20261027000100)
\echo '--- 31. Ticket header controls: priority, pick up'
set role authenticated;
select test.login('sup_th');
select test.check((select set_ticket_priority((select id from tk where name = 'C1'), 'HIGH') ->> 'priority' = 'HIGH'), 'a Team Lead sets the priority');
select test.check((select priority = 'HIGH' from support_tickets where id = (select id from tk where name = 'C1')), 'and it is stored');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from tk where name = 'C1') and kind = 'PRIORITY_CHANGED' and note = 'Priority changed from Medium to High'),
  'the change is on the ticket timeline');
select test.check((select assignee_id = test.id('sup_b') from support_tickets where id = (select id from tk where name = 'C1')), 'changing priority does not take the ticket over');
select set_ticket_priority((select id from tk where name = 'C1'), 'HIGH');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from tk where name = 'C1') and kind = 'PRIORITY_CHANGED'), 'setting the same priority again changes nothing');
select test.must_fail($$select set_ticket_priority((select id from tk where name = 'C1'), 'SOON')$$, 'an unknown priority is refused', 'Unknown priority');
select test.login('sup_b');
select test.check((select set_ticket_priority((select id from tk where name = 'C1'), 'URGENT') ->> 'priority' = 'URGENT'), 'the Relationship Manager can set it too');
select test.login('sup_plain');
select test.must_fail($$select set_ticket_priority((select id from tk where name = 'C1'), 'LOW')$$, 'another member cannot', 'not found');
select test.login('th_gen');
select test.must_fail($$select set_ticket_priority((select id from tk where name = 'C1'), 'LOW')$$, 'nor a Team Lead of another team', 'not found');
select test.login('tk_r');
select test.must_fail($$select set_ticket_priority((select id from tk where name = 'C1'), 'LOW')$$, 'nor the customer', 'not found');
select test.check((select not exists (select 1 from jsonb_array_elements(client_ticket((select id from tk where name = 'C1')) -> 'messages') m where m::text like '%Priority changed%')
                      and client_ticket((select id from tk where name = 'C1')) ->> 'priority' = 'URGENT'), 'the customer sees the priority but not the internal event');
reset role;
select test.check((select count(*) = 1 from notifications where type = 'TICKET_UPDATE' and recipient_id = test.id('sup_b') and title like '%priority%high%'), 'the Relationship Manager is told when someone else changes the priority');
select test.check((select count(*) = 2 from audit_logs where action = 'TICKET_PRIORITY_CHANGED' and entity_id = (select id from tk where name = 'C1')), 'priority changes are audited');

-- a ticket nobody is working on: the Team Lead picks it up (existing assignment path), nobody else may take it
update support_tickets set assignee_id = null, escalation_level = 'TL', escalated_to = test.id('sup_th'), status = 'OPEN'
 where id = (select id from tk where name = 'N1');
set role authenticated;
select test.login('sup_b');
select test.check((select count(*) = 0 from support_tickets where id = (select id from tk where name = 'N1')), 'a team member cannot even see an unassigned ticket of the Team Lead');
select test.must_fail($$select assign_support_ticket((select id from tk where name = 'N1'), test.id('sup_b'), 'taking it')$$, 'and cannot take it', 'Only a team lead|FORBIDDEN');
select test.login('th_gen');
select test.must_fail($$select assign_support_ticket((select id from tk where name = 'N1'), test.id('th_gen'), 'taking it')$$, 'a Team Lead of another team cannot', 'Only a team lead|FORBIDDEN');
select test.login('sup_th');
select assign_support_ticket((select id from tk where name = 'N1'), test.id('sup_th'), 'Picked up');
select test.check((select assignee_id = test.id('sup_th') from support_tickets where id = (select id from tk where name = 'N1')), 'the Team Lead picks it up');
select test.check((select count(*) = 1 from support_ticket_updates where ticket_id = (select id from tk where name = 'N1') and kind = 'ASSIGNED' and author_id = test.id('sup_th') and assignee_id = test.id('sup_th')),
  'the pick-up is on the ticket history');


\echo '--- 31b. Ticket attachments: limits, who can attach, who can read'
reset role;
-- Support B (the RM) needs a helper to book + finish an upload in one step, as the signed-in user.
create or replace function test.tfile(p_ticket uuid, p_customer uuid, p_name text default 'a.pdf', p_mime text default 'application/pdf', p_size bigint default 2048)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  v_id := (ticket_begin_upload(p_ticket, p_customer, p_name, p_mime, p_size)).id;
  perform ticket_complete_upload(v_id, p_size, null);
  return v_id;
end $$;
create temp table af (name text primary key, id uuid);
grant all on af to authenticated, service_role;

set role authenticated;
select test.login('tk_r');
-- the limits
select test.must_fail($$select ticket_begin_upload(null, null, 'virus.exe', 'application/x-msdownload', 1000)$$, 'a file type that is not allowed is refused', 'cannot be attached');
select test.must_fail($$select ticket_begin_upload(null, null, 'big.pdf', 'application/pdf', 5242881)$$, 'a file over 5 MB is refused', '5 MB');
select test.must_fail($$select ticket_begin_upload(null, null, 'empty.pdf', 'application/pdf', 0)$$, 'an empty file is refused', '5 MB');
select test.must_fail($$select ticket_begin_upload(null, null, '', 'application/pdf', 1000)$$, 'a file needs a name', 'needs a name');
select test.check((select (ticket_begin_upload(null, null, 'exactly5mb.pdf', 'application/pdf', 5242880)).status = 'PENDING'), 'a file of exactly 5 MB is allowed');
select test.must_fail($$select ticket_begin_upload(gen_random_uuid(), null, 'a.pdf', 'application/pdf', 1000)$$, 'a ticket that is not mine is not found', 'not found');

-- a client opens a ticket WITH a file (the file is a draft until the ticket exists)
insert into af select 'draft', test.tfile(null, null, 'Screenshot.png', 'image/png', 4096);
select test.check((select (ticket_attachment_download((select id from af where name = 'draft'))).file_name = 'Screenshot.png'), 'the uploader can open their own draft');
insert into tk select 'A1', (client_create_ticket('Dashboard shows an error', 'See the attached screenshot', 'TECHNICAL', null, array[(select id from af where name = 'draft')]) ->> 'id')::uuid;
select test.check((select count(*) = 1 and bool_and(name = 'Screenshot.png' and "fromClient") from jsonb_to_recordset(ticket_attachments((select id from tk where name = 'A1'))) as x(id uuid, "updateId" uuid, name text, "fromClient" boolean)),
  'the file is on the new ticket');
select test.must_fail($$select client_create_ticket('Second', 'Reusing the same file', 'TECHNICAL', null, array[(select id from af where name = 'draft')])$$, 'a file that was already sent cannot be sent again', 'not ready');
select test.must_fail($$select client_send_ticket_message((select id from tk where name = 'A1'), 'six files', gen_random_uuid(), (select array_agg(gen_random_uuid()) from generate_series(1, 6)))$$, 'more than 5 files on one message is refused', 'up to 5');

-- a client message with files
insert into af select 'm1', test.tfile((select id from tk where name = 'A1'), null, 'Invoice.pdf');
insert into af select 'm2', test.tfile((select id from tk where name = 'A1'), null, 'Sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 9000);
select test.check((select client_send_ticket_message((select id from tk where name = 'A1'), 'Two files', '33333333-3333-3333-3333-333333333333', array[(select id from af where name = 'm1'), (select id from af where name = 'm2')]) is not null), 'a client message can carry files');
select test.check((select count(*) = 3 from jsonb_array_elements(ticket_attachments((select id from tk where name = 'A1')))), 'the ticket now holds three files');

-- another client, and a team that does not look after this ticket, can reach nothing
select test.login('tk_n');
select test.must_fail($$select ticket_attachments((select id from tk where name = 'A1'))$$, 'another client cannot list the files', 'not found');
select test.must_fail($$select ticket_attachment_download((select id from af where name = 'm1'))$$, 'nor open one even with its id', 'not found');
select test.must_fail($$select ticket_begin_upload((select id from tk where name = 'A1'), null, 'x.pdf', 'application/pdf', 100)$$, 'nor attach to the ticket', 'not found');
select test.login('th_gen');
select test.must_fail($$select ticket_attachments((select id from tk where name = 'A1'))$$, 'a Team Lead of another team cannot list them', 'not found');
select test.must_fail($$select ticket_attachment_download((select id from af where name = 'm1'))$$, 'nor open one', 'not found');
select test.must_fail($$select ticket_begin_upload((select id from tk where name = 'A1'), null, 'x.pdf', 'application/pdf', 100)$$, 'nor attach to the ticket', 'not found');

-- the RM reads them (audited) and answers with a file
select test.login('sup_b');
select test.check((select count(*) = 3 from jsonb_array_elements(ticket_attachments((select id from tk where name = 'A1')))), 'the RM sees the files of the ticket');
select test.check((select (ticket_attachment_download((select id from af where name = 'm2'))).file_name = 'Sheet.xlsx'), 'and can open one');
insert into af select 'r1', test.tfile((select id from tk where name = 'A1'), null, 'Fix.pdf');
insert into af select 'n1', test.tfile((select id from tk where name = 'A1'), null, 'Internal.txt', 'text/plain', 300);
select test.must_fail($$select send_ticket_message((select id from tk where name = 'A1'), 'trying the clients file', false, null, array[(select id from af where name = 'm1')])$$, 'staff cannot send a file the client uploaded', 'not ready');
select send_ticket_message((select id from tk where name = 'A1'), 'Here is the fix', false, '44444444-4444-4444-4444-444444444444', array[(select id from af where name = 'r1')]);
select send_ticket_message((select id from tk where name = 'A1'), 'Team only', true, '55555555-5555-5555-5555-555555555555', array[(select id from af where name = 'n1')]);
select test.check((select count(*) = 5 from jsonb_array_elements(ticket_attachments((select id from tk where name = 'A1')))), 'staff see all five files, the internal one too');

-- the client sees the reply file but never the file on an internal note
select test.login('tk_r');
select test.check((select count(*) = 4 and not bool_or(name = 'Internal.txt') from jsonb_to_recordset(ticket_attachments((select id from tk where name = 'A1'))) as x(id uuid, name text)),
  'the client sees four files, not the one on the internal note');
select test.check((select (ticket_attachment_download((select id from af where name = 'r1'))).file_name = 'Fix.pdf'), 'and can open the reply file');
select test.must_fail($$select ticket_attachment_download((select id from af where name = 'n1'))$$, 'but cannot open the internal note file even with its id', 'not found');

-- a file from the other side is not mine to send
insert into af select 'c3', test.tfile((select id from tk where name = 'A1'), null, 'Third.pdf');
select test.login('sup_b');
select test.must_fail($$select send_ticket_message((select id from tk where name = 'A1'), 'x', false, null, array[(select id from af where name = 'c3')])$$, 'a client draft cannot be sent by staff', 'not ready');

-- the audit trail
reset role;
select test.check((select count(*) >= 3 from audit_logs where action = 'TICKET_ATTACHMENT_ADDED' and entity_id = (select id from tk where name = 'A1')), 'attaching files is audited');
select test.check((select count(*) >= 2 from audit_logs where action = 'TICKET_ATTACHMENT_DOWNLOADED' and entity_id = (select id from tk where name = 'A1')), 'opening a file is audited');
select test.check((select not exists (select 1 from audit_logs where action like 'TICKET_ATTACHMENT%' and metadata::text ilike '%Fix.pdf%')), 'and the audit trail does not carry file names');

-- the per-ticket cap (25) and the table is closed to the browser
insert into support_ticket_attachments (customer_id, ticket_id, update_id, uploader_client, file_name, mime_type, size_bytes, status, storage_path)
select t.customer_id, t.id, (select id from support_ticket_updates where ticket_id = t.id and client_author order by created_at limit 1), true, 'f' || g || '.pdf', 'application/pdf', 100, 'READY', 'cap/' || g
  from support_tickets t, generate_series(1, 21) g where t.id = (select id from tk where name = 'A1');
set role authenticated;
select test.login('tk_r');
insert into af select 'cap', test.tfile((select id from tk where name = 'A1'), null, 'Over.pdf');
select test.must_fail($$select client_send_ticket_message((select id from tk where name = 'A1'), 'one too many', gen_random_uuid(), array[(select id from af where name = 'cap')])$$, 'a ticket holds at most 25 files', '25');
select test.must_fail($$select * from support_ticket_attachments$$, 'the files table cannot be read directly', 'permission denied');
reset role;
set role anon;
select test.must_fail($$select ticket_begin_upload(null, null, 'a.pdf', 'application/pdf', 100)$$, 'a visitor cannot upload', 'permission denied');
reset role;

reset role;
\echo '=== ALL TICKET HIERARCHY AND CHAT TESTS PASSED ==='
