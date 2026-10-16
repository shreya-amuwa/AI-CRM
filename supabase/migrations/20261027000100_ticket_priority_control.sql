-- =============================================================================
-- Ticket UI redesign: priority control.
--
-- The redesigned ticket screen lets the people who handle a ticket set its priority (Low / Medium / High /
-- Urgent) from the ticket header, next to the status. Until now a priority could only be chosen when a staff
-- member created the ticket (client tickets start as Medium and nobody could change them).
--
--  * support_ticket_updates.kind gains PRIORITY_CHANGED, so the change appears on the ticket timeline as a
--    system event (never as a chat message; the customer does not see it).
--  * set_ticket_priority(ticket, priority): same permission as updating the ticket (the assignee, the person
--    it was escalated to, the Team Lead of the team, the Department Head of the department, the Super Admin).
--    A closed ticket cannot be changed. The change is audited and the other handlers are notified.
-- Additive / idempotent. Run the whole file at once, after 20261026000100_ticket_chat.sql.
-- =============================================================================

alter table public.support_ticket_updates drop constraint if exists support_ticket_updates_kind_check;
alter table public.support_ticket_updates add constraint support_ticket_updates_kind_check
  check (kind in ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'ESCALATED', 'NOTE', 'CLIENT_REPLY', 'PRIORITY_CHANGED'));

create or replace function public.set_ticket_priority(p_ticket uuid, p_priority text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  v_recipient uuid;
  v_labels constant jsonb := '{"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High", "URGENT": "Urgent"}';
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if p_priority is null or p_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;
  if t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed.' using errcode = 'P0001';
  end if;
  if p_priority = t.priority then
    return jsonb_build_object('id', t.id, 'priority', t.priority);  -- nothing to change
  end if;

  update public.support_tickets set priority = p_priority, updated_at = now() where id = t.id;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note)
  values (t.id, me.id, 'PRIORITY_CHANGED', format('Priority changed from %s to %s', v_labels ->> t.priority, v_labels ->> p_priority));
  perform private.write_audit('TICKET_PRIORITY_CHANGED', 'support_ticket', t.id, t.department_id, t.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from', t.priority, 'to', p_priority));
  for v_recipient in
    select distinct r from unnest(array[t.assignee_id, t.escalated_to]) r where r is not null and r <> me.id
  loop
    perform private.notify(v_recipient, 'TICKET_UPDATE', format('%s: priority of %s is now %s', me.full_name, t.ticket_no, lower(v_labels ->> p_priority)),
      t.subject, 'support_ticket', t.id);
  end loop;
  return jsonb_build_object('id', t.id, 'priority', p_priority);
end $$;
revoke all on function public.set_ticket_priority(uuid, text) from public, anon;
grant execute on function public.set_ticket_priority(uuid, text) to authenticated;
