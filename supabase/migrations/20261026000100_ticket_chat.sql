-- =============================================================================
-- Tickets as conversations (chat inside every ticket).
--
-- The conversation of a ticket is its existing history: support_ticket_updates (one thread per ticket id).
-- Nothing is replaced; this file only adds what a chat needs:
--  1. client_msg_id: every message sent from a screen carries a key, so a double click, a retry or two
--     requests racing each other store the message once (unique per ticket).
--  2. author_label: the sender's role on the ticket when they wrote (Relationship Manager, Team Lead,
--     Department Head, Support, Admin), shown next to their name.
--  3. last_message_at / last_message_preview / last_message_from on the ticket, for inbox previews.
--  4. Read state: staff (support_ticket_reads, one row per person and ticket) and the client
--     (support_tickets.client_read_at) - unread counts and "seen" ticks.
--  5. send_ticket_message (staff: reply to the customer or internal note) and client_send_ticket_message.
--     The old reply_to_client_ticket / client_reply_ticket keep working and use the same path.
--  6. client_ticket returns `messages`: the conversation (customer / staff messages) and system events
--     (opened, assigned, escalated, reopened, resolved) as separate entries. A status change written by the
--     client (a reply that reopens a ticket) is an event, never a second copy of the client's message.
--  7. Manual escalation needs a reason.
--  8. pg_cron is switched on (when the database offers it) so overdue tickets escalate on schedule,
--     without anyone having a dashboard open.
-- Additive / idempotent. Run the whole file at once, after 20261025000100_ticket_hierarchy_escalation.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.support_ticket_updates
  add column if not exists client_msg_id uuid,
  add column if not exists author_label text;
create unique index if not exists support_ticket_updates_client_msg_key
  on public.support_ticket_updates (ticket_id, client_msg_id) where client_msg_id is not null;

alter table public.support_tickets
  add column if not exists last_message_at timestamptz,
  add column if not exists last_message_preview text,
  add column if not exists last_message_from text,
  -- existing tickets count as read by the client up to now (default is applied once, when the column is added)
  add column if not exists client_read_at timestamptz default now();
alter table public.support_tickets drop constraint if exists support_tickets_last_message_from_check;
alter table public.support_tickets add constraint support_tickets_last_message_from_check
  check (last_message_from is null or last_message_from in ('CLIENT', 'STAFF'));

-- Which ticket conversations a staff member has read, and up to when.
create table if not exists public.support_ticket_reads (
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (ticket_id, profile_id)
);
alter table public.support_ticket_reads enable row level security;
revoke all on public.support_ticket_reads from public, anon, authenticated;
grant select on public.support_ticket_reads to authenticated;
drop policy if exists support_ticket_reads_own on public.support_ticket_reads;
create policy support_ticket_reads_own on public.support_ticket_reads for select to authenticated
  using (profile_id = (select private.my_id()));

-- ---------------------------------------------------------------------------
-- 2. Sender label and inbox preview, kept by triggers (whichever function writes the row)
-- ---------------------------------------------------------------------------
create or replace function private.ticket_author_label(p_ticket uuid, p_author uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
           when p.role = 'SUPER_ADMIN' then 'Admin'
           when p.role = 'DEPARTMENT_HEAD' then 'Department Head'
           when p.id = (select t.assignee_id from public.support_tickets t where t.id = p_ticket) then 'Relationship Manager'
           when p.role = 'TEAM_HEAD' then 'Team Lead'
           else 'Support'
         end
    from public.profiles p where p.id = p_author
$$;
revoke all on function private.ticket_author_label(uuid, uuid) from public, anon, authenticated;

create or replace function private.tg_support_ticket_updates_label()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.author_id is not null and new.author_label is null then
    new.author_label := private.ticket_author_label(new.ticket_id, new.author_id);
  end if;
  return new;
end $$;
revoke all on function private.tg_support_ticket_updates_label() from public, anon, authenticated;
drop trigger if exists support_ticket_updates_label on public.support_ticket_updates;
create trigger support_ticket_updates_label before insert on public.support_ticket_updates
  for each row execute function private.tg_support_ticket_updates_label();

update public.support_ticket_updates u set author_label = private.ticket_author_label(u.ticket_id, u.author_id)
 where u.author_id is not null and u.author_label is null;

-- A conversation message (what the customer and Support say to each other; internal notes are not part of it).
create or replace function private.is_conversation_message(u public.support_ticket_updates)
returns boolean language sql immutable as $$
  select u.note is not null and (
    (u.kind in ('CREATED', 'CLIENT_REPLY') and u.client_author)
    or (u.kind = 'NOTE' and u.client_visible))
$$;

create or replace function private.tg_support_ticket_updates_preview()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_conversation_message(new) then
    update public.support_tickets
       set last_message_at = new.created_at,
           last_message_preview = left(regexp_replace(new.note, '\s+', ' ', 'g'), 160),
           last_message_from = case when new.client_author then 'CLIENT' else 'STAFF' end
     where id = new.ticket_id and (last_message_at is null or last_message_at <= new.created_at);
  end if;
  -- whoever writes on a ticket has read it up to that moment
  if new.author_id is not null then
    insert into public.support_ticket_reads (ticket_id, profile_id, read_at) values (new.ticket_id, new.author_id, new.created_at)
    on conflict (ticket_id, profile_id) do update set read_at = greatest(public.support_ticket_reads.read_at, excluded.read_at);
  end if;
  return null;
end $$;
revoke all on function private.tg_support_ticket_updates_preview() from public, anon, authenticated;
drop trigger if exists support_ticket_updates_preview on public.support_ticket_updates;
create trigger support_ticket_updates_preview after insert on public.support_ticket_updates
  for each row execute function private.tg_support_ticket_updates_preview();

-- Existing tickets get their latest message as the preview.
update public.support_tickets t
   set last_message_at = m.created_at,
       last_message_preview = left(regexp_replace(m.note, '\s+', ' ', 'g'), 160),
       last_message_from = case when m.client_author then 'CLIENT' else 'STAFF' end
  from (select distinct on (u.ticket_id) u.ticket_id, u.created_at, u.note, u.client_author
          from public.support_ticket_updates u
         where private.is_conversation_message(u)
         order by u.ticket_id, u.created_at desc, u.id desc) m
 where m.ticket_id = t.id and t.last_message_at is null;

-- ---------------------------------------------------------------------------
-- 3. Staff: read state and sending
-- ---------------------------------------------------------------------------
create or replace function public.mark_support_ticket_read(p_ticket uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_at timestamptz := now();
begin
  if me is null or not private.can_view_ticket(p_ticket) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  insert into public.support_ticket_reads (ticket_id, profile_id, read_at) values (p_ticket, me, v_at)
  on conflict (ticket_id, profile_id) do update set read_at = greatest(public.support_ticket_reads.read_at, excluded.read_at);
  return v_at;
end $$;
revoke all on function public.mark_support_ticket_read(uuid) from public, anon;
grant execute on function public.mark_support_ticket_read(uuid) to authenticated;

create or replace function private.staff_message_json(u public.support_ticket_updates)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', u.id, 'ticketId', u.ticket_id, 'authorId', u.author_id, 'authorLabel', u.author_label,
    'kind', u.kind, 'clientVisible', u.client_visible, 'note', u.note, 'clientMsgId', u.client_msg_id, 'createdAt', u.created_at)
$$;
revoke all on function private.staff_message_json(public.support_ticket_updates) from public, anon, authenticated;

-- Staff write in the ticket chat: a reply the customer reads, or an internal note (p_internal) only staff see.
-- The same p_client_msg_id is stored once; without one, the same text within two minutes is stored once.
create or replace function public.send_ticket_message(p_ticket uuid, p_message text, p_internal boolean default false, p_client_msg_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  u public.support_ticket_updates;
  v_msg text := left(nullif(btrim(coalesce(p_message, '')), ''), 4000);
  v_internal boolean := coalesce(p_internal, false);
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null then
    raise exception 'VALIDATION_ERROR: Write the message first.' using errcode = 'P0001';
  end if;
  if p_client_msg_id is not null then
    select * into u from public.support_ticket_updates x where x.ticket_id = t.id and x.client_msg_id = p_client_msg_id;
    if u.id is not null then
      return private.staff_message_json(u);  -- already stored (retry / double click)
    end if;
  else
    select * into u from public.support_ticket_updates x
     where x.ticket_id = t.id and x.author_id = me.id and x.kind = 'NOTE' and x.client_visible = not v_internal
       and x.note = v_msg and x.created_at > now() - interval '2 minutes'
     order by x.created_at desc limit 1;
    if u.id is not null then
      return private.staff_message_json(u);
    end if;
  end if;
  if not v_internal and t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed.' using errcode = 'P0001';
  end if;

  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_visible, client_msg_id)
  values (t.id, me.id, 'NOTE', v_msg, not v_internal, p_client_msg_id)
  returning * into u;
  update public.support_tickets set updated_at = now() where id = t.id;

  if v_internal then
    for v_recipient in
      select distinct r from unnest(array[t.assignee_id, t.escalated_to]) r where r is not null and r <> me.id
    loop
      perform private.notify(v_recipient, 'TICKET_NOTE', format('%s added a note on %s', me.full_name, t.ticket_no),
        left(v_msg, 300), 'support_ticket', t.id);
    end loop;
  else
    perform private.write_audit('TICKET_REPLIED_TO_CLIENT', 'support_ticket', t.id, t.department_id, t.team_id, jsonb_build_object('ticket_no', t.ticket_no));
    -- The RM stays informed when a Team Lead / Department Head answers, and the current owner when someone else does.
    for v_recipient in
      select distinct r from unnest(array[t.assignee_id, t.escalated_to]) r where r is not null and r <> me.id
    loop
      perform private.notify(v_recipient, 'TICKET_STAFF_REPLY', format('%s replied to the customer on %s', me.full_name, t.ticket_no),
        left(v_msg, 300), 'support_ticket', t.id);
    end loop;
  end if;
  return private.staff_message_json(u);
exception when unique_violation then
  -- two identical requests at the same moment: the other one stored it
  select * into u from public.support_ticket_updates x where x.ticket_id = p_ticket and x.client_msg_id = p_client_msg_id;
  if u.id is null then
    raise;
  end if;
  return private.staff_message_json(u);
end $$;
revoke all on function public.send_ticket_message(uuid, text, boolean, uuid) from public, anon;
grant execute on function public.send_ticket_message(uuid, text, boolean, uuid) to authenticated;

-- The existing reply function: same path (kept for older screens and the API).
create or replace function public.reply_to_client_ticket(p_ticket uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if nullif(btrim(coalesce(p_message, '')), '') is null then
    raise exception 'VALIDATION_ERROR: Write the reply for the customer.' using errcode = 'P0001';
  end if;
  perform public.send_ticket_message(p_ticket, p_message, false, null);
end $$;
revoke all on function public.reply_to_client_ticket(uuid, text) from public, anon;
grant execute on function public.reply_to_client_ticket(uuid, text) to authenticated;

-- Manual escalation: same as before, and a reason is required (it goes on the audit trail).
create or replace function public.escalate_support_ticket(p_ticket uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if t.status in ('RESOLVED', 'CLOSED') then
    raise exception 'CONFLICT: This ticket is already resolved.' using errcode = 'P0001';
  end if;
  if t.escalation_level = 'DH' then
    raise exception 'CONFLICT: This ticket is already with the Department Head.' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_note, '')), '') is null then
    raise exception 'VALIDATION_ERROR: Give the reason for escalating.' using errcode = 'P0001';
  end if;
  if not private.escalate_ticket(t.id, 'MANUAL', me.id, p_note) then
    raise exception 'CONFLICT: There is nobody above to escalate this ticket to.' using errcode = 'P0001';
  end if;
  select * into t from public.support_tickets where id = p_ticket;
  return jsonb_build_object('id', t.id, 'escalationLevel', t.escalation_level, 'escalatedTo', t.escalated_to, 'slaDueAt', t.sla_due_at);
end $$;
revoke all on function public.escalate_support_ticket(uuid, text) from public, anon;
grant execute on function public.escalate_support_ticket(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Client: the conversation, unread counts, sending
-- ---------------------------------------------------------------------------
create or replace function private.client_ticket_json(t public.support_tickets)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'ticketNo', t.ticket_no, 'subject', t.subject, 'description', t.description, 'category', t.category,
    'priority', t.priority, 'status', t.status, 'serviceCode', t.service_code,
    'serviceName', (select s.name from public.crm_services s where s.code = t.service_code),
    'resolution', case when t.status in ('RESOLVED', 'CLOSED') then t.resolution_notes end,
    'relationshipManager', (select p.full_name from public.profiles p where p.id = t.assignee_id),
    'escalated', t.escalation_level <> 'RM' and exists (select 1 from public.support_ticket_escalations e where e.ticket_id = t.id),
    'handledBy', case t.escalation_level when 'TL' then 'TEAM_LEAD' when 'DH' then 'DEPARTMENT_HEAD' else 'RELATIONSHIP_MANAGER' end,
    -- replies from Support the client has not opened yet
    'unread', (select count(*) from public.support_ticket_updates u
                where u.ticket_id = t.id and u.kind = 'NOTE' and u.client_visible and not u.client_author
                  and u.created_at > coalesce(t.client_read_at, '-infinity'::timestamptz)),
    'lastMessage', case when t.last_message_at is not null then jsonb_build_object(
                      'text', t.last_message_preview, 'from', t.last_message_from, 'at', t.last_message_at) end,
    'lastActivityAt', greatest(t.updated_at, coalesce(t.last_message_at, t.updated_at)),
    'lastReplyAt', t.last_staff_reply_at,
    'createdAt', t.created_at, 'updatedAt', t.updated_at)
$$;
revoke all on function private.client_ticket_json(public.support_tickets) from public, anon, authenticated;

-- The client's view of one entry of the conversation (null = not shown to the client).
create or replace function private.client_message_json(u public.support_ticket_updates, p_staff_read_at timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case
    when (u.kind in ('CREATED', 'CLIENT_REPLY') and u.client_author) then
      jsonb_build_object('id', u.id, 'at', u.created_at, 'kind', 'MESSAGE', 'from', 'CLIENT', 'text', u.note,
                         'clientMsgId', u.client_msg_id, 'seen', p_staff_read_at is not null and p_staff_read_at >= u.created_at)
    when u.kind = 'NOTE' and u.client_visible then
      jsonb_build_object('id', u.id, 'at', u.created_at, 'kind', 'MESSAGE', 'from', 'STAFF', 'text', u.note,
                         'author', (select p.full_name from public.profiles p where p.id = u.author_id), 'role', coalesce(u.author_label, 'Support'))
    when u.kind = 'CREATED' then
      jsonb_build_object('id', u.id, 'at', u.created_at, 'kind', 'EVENT', 'event', 'CREATED', 'text', u.note,
                         'author', (select p.full_name from public.profiles p where p.id = u.author_id))
    when u.kind = 'ASSIGNED' and u.assignee_id is not null then
      jsonb_build_object('id', u.id, 'at', u.created_at, 'kind', 'EVENT', 'event', 'ASSIGNED',
                         'author', (select p.full_name from public.profiles p where p.id = u.assignee_id),
                         'role', (select case p.role when 'TEAM_HEAD' then 'Team Lead' when 'DEPARTMENT_HEAD' then 'Department Head' else 'Relationship Manager' end
                                    from public.profiles p where p.id = u.assignee_id))
    when u.kind = 'ESCALATED' and exists (select 1 from public.support_ticket_escalations e where e.ticket_id = u.ticket_id) then
      jsonb_build_object('id', u.id, 'at', u.created_at, 'kind', 'EVENT', 'event', 'ESCALATED',
                         'role', (select case p.role when 'DEPARTMENT_HEAD' then 'Department Head' else 'Team Lead' end
                                    from public.profiles p where p.id = u.assignee_id))
    when u.kind = 'STATUS_CHANGED' then
      jsonb_build_object('id', u.id, 'at', u.created_at, 'kind', 'EVENT', 'status', u.to_status,
                         'event', case when u.to_status = 'RESOLVED' then 'RESOLVED'
                                       when u.to_status = 'CLOSED' then 'CLOSED'
                                       when u.from_status in ('RESOLVED', 'CLOSED') then 'REOPENED'
                                       else 'STATUS' end)
  end
$$;
revoke all on function private.client_message_json(public.support_ticket_updates, timestamptz) from public, anon, authenticated;

create or replace function public.client_ticket(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  t public.support_tickets;
  v_staff_read timestamptz;
begin
  select * into t from public.support_tickets where id = p_ticket and customer_id = v_customer;
  if t.id is null then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  -- the latest moment someone from Support read this conversation (for "Seen")
  select max(r.read_at) into v_staff_read from public.support_ticket_reads r where r.ticket_id = t.id;
  return private.client_ticket_json(t) || jsonb_build_object(
    'staffReadAt', v_staff_read,
    'messages', coalesce((
      select jsonb_agg(m.j order by m.created_at, m.id) from (
        select u.created_at, u.id, private.client_message_json(u, v_staff_read) as j
          from public.support_ticket_updates u where u.ticket_id = t.id) m
       where m.j is not null), '[]'::jsonb),
    -- the older shape, kept for compatibility (a status change is never shown as a client message)
    'updates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.id, 'at', u.created_at,
        'type', case when u.kind in ('STATUS_CHANGED', 'ESCALATED') then 'STATUS' when u.client_author then 'CLIENT' else 'SUPPORT' end,
        'status', u.to_status,
        'message', case when u.kind = 'CLIENT_REPLY' or (u.kind = 'NOTE' and u.client_visible) then u.note
                        when u.kind = 'ESCALATED' then 'Escalated to a senior member of our team' end,
        'author', case when u.kind = 'NOTE' and u.client_visible then (select p.full_name from public.profiles p where p.id = u.author_id) end)
        order by u.created_at, u.id)
        from public.support_ticket_updates u
       where u.ticket_id = t.id and u.kind <> 'CREATED'
         and (u.kind = 'CLIENT_REPLY' or u.kind = 'STATUS_CHANGED' or (u.kind = 'NOTE' and u.client_visible)
              or (u.kind = 'ESCALATED' and exists (select 1 from public.support_ticket_escalations e where e.ticket_id = t.id)))), '[]'::jsonb));
end $$;

-- The client writes in their ticket. The same p_client_msg_id is stored once; a reply on a resolved ticket
-- (or one waiting for the client) reopens it, as before.
create or replace function public.client_send_ticket_message(p_ticket uuid, p_message text, p_client_msg_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  t public.support_tickets;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into t from public.support_tickets where id = p_ticket and customer_id = v_customer for update;
  if t.id is null then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null or length(v_msg) > 4000 then
    raise exception 'VALIDATION_ERROR: Write your message (up to 4000 characters).' using errcode = 'P0001';
  end if;
  if (p_client_msg_id is not null and exists (select 1 from public.support_ticket_updates u where u.ticket_id = t.id and u.client_msg_id = p_client_msg_id))
     or (p_client_msg_id is null and exists (select 1 from public.support_ticket_updates u
              where u.ticket_id = t.id and u.client_author and u.kind = 'CLIENT_REPLY'
                and u.note = v_msg and u.created_at > now() - interval '2 minutes')) then
    return public.client_ticket(t.id);  -- already sent (double click, retry)
  end if;
  if t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed. Please raise a new ticket.' using errcode = 'P0001';
  end if;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author, client_msg_id)
  values (t.id, null, 'CLIENT_REPLY', v_msg, true, p_client_msg_id);
  -- writing in the ticket means the client has read it
  if t.status in ('RESOLVED', 'WAITING_CUSTOMER') then
    update public.support_tickets set status = 'OPEN', resolved_at = null, client_read_at = now() where id = t.id;
    insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, client_author)
    values (t.id, null, 'STATUS_CHANGED', t.status, 'OPEN', true);
  else
    update public.support_tickets set updated_at = now(), client_read_at = now() where id = t.id;
  end if;
  perform private.notify(r.id, 'TICKET_CLIENT_REPLY', format('Client replied on %s', t.ticket_no), left(v_msg, 300), 'support_ticket', t.id,
                         '{}'::jsonb, case when r.id = coalesce(t.escalated_to, t.assignee_id) then 'urgent' else 'normal' end)
    from (select p.id from public.profiles p
           where p.status = 'ACTIVE'
             and (p.id = t.assignee_id or p.id = t.escalated_to or (p.role = 'TEAM_HEAD' and p.team_id = t.team_id))) r;
  return public.client_ticket(t.id);
exception when unique_violation then
  return public.client_ticket(p_ticket);  -- the same message arrived twice at the same moment
end $$;

create or replace function public.client_reply_ticket(p_ticket uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.client_send_ticket_message(p_ticket, p_message, null);
end $$;

-- The client opened the ticket: replies so far are read (and their notifications).
create or replace function public.client_ticket_seen(p_ticket uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_n integer;
begin
  update public.support_tickets set client_read_at = now() where id = p_ticket and customer_id = v_customer;
  if not found then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  update public.client_notifications set read_at = now()
   where customer_id = v_customer and entity_type = 'ticket' and entity_id = p_ticket and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['client_ticket(uuid)', 'client_reply_ticket(uuid, text)', 'client_send_ticket_message(uuid, text, uuid)', 'client_ticket_seen(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Realtime + scheduled escalation that does not need anyone online
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.support_ticket_reads;
  exception when duplicate_object or undefined_object then null;
  end;
end $$;

-- Supabase offers pg_cron; switch it on if it is not yet (ignored where the extension does not exist),
-- then (re)schedule the SLA sweep every 5 minutes.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension if not exists pg_cron;
    exception when others then
      raise notice 'pg_cron is not available here: overdue tickets escalate through the API dispatch job instead.';
    end;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('ticket-sla-escalations');
    exception when others then null;
    end;
    perform cron.schedule('ticket-sla-escalations', '*/5 * * * *', 'select public.escalate_overdue_tickets()');
  end if;
end $$;
