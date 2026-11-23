-- =============================================================================
-- Shared client chat and tickets: the Support employees of a customer's department can help when the Relationship Manager is away
-- =============================================================================
-- BEFORE: a client conversation was open only to the customer's assigned Team Member (Relationship Manager), that member's Team Lead, the Support employees the
-- Team Lead added to the client's support group by hand, and (read only) the Super Admin and the department's Department Head. A ticket was open only to its
-- assignee, creator, current escalation owner, the Team Lead whose team it belongs to, the Department Head and the Super Admin.
--
-- NOW (controlled, not open to everyone):
--   * "Shared support" = an ACTIVE Support Team Member / Team Lead whose department is the customer's department, for a customer (not a lead), while the CRM's
--     existing Support desk switch is on (access_settings.support_desk_department_wide, default on - the same switch customers_select_support uses).
--     private.shared_support_ok(customer) answers exactly that, about the signed-in person only. Sales, HR, Accounts and other departments' staff are NOT included.
--   * Client chat (RM channel): these people get the STAFF level: they open the conversation, read its whole history, reply as themselves (chat_messages.sender_id is
--     always the authenticated employee), and see who is handling it. The Meta verification channel is unchanged. The Super Admin and Department Head stay readers.
--   * Tickets: these people read the department's customer tickets, their whole history and attachments (public.desk_tickets(), can_view_ticket) and may REPLY or add
--     an INTERNAL NOTE (send_ticket_message). The ticket TABLES and everybody's own lists stay exactly as narrow as before (the policies are pinned to can_manage_ticket,
--     the old rule). Status, priority, assignment and escalation keep their existing rules too: those four functions now call can_manage_ticket.
--   * The Relationship Manager, the ticket assignee, the escalation level and the history are never changed by someone else replying.
--   * "Currently handling": chat_conversations / support_tickets get handling_by / handling_at, set when an employee replies and by chat_set_handling /
--     ticket_set_handling (take it, release it, take over). It lapses after 15 minutes without activity. It is information, never a lock.
--   * The RM is told (once, no flood) when a colleague replies to their client: CHAT_COVER_REPLY (tickets already notify the assignee and the owner).
--   * chat_desk_clients(): the department's client conversations for these people (RM, who is handling, last message, awaiting reply, unread).
-- Internal notes stay on tickets (client_visible = false) and the client functions never return them; client chat has no internal notes.
-- Safe to run twice. Nothing is deleted or rewritten. Needs 20261230000500_client_support_groups.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who counts as "shared support" for a customer, and the "handling" window
-- ---------------------------------------------------------------------------
create or replace function private.shared_support_ok(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    private.support_desk_department_wide() and private.is_support_staff()
    and exists (select 1 from public.customers c
                 where c.id = p_customer and c.department_id = private.my_department_id() and c.lifecycle_stage = 'CUSTOMER'), false)
$$;
revoke all on function private.shared_support_ok(uuid) from public, anon;
-- used by the support_tickets policy: it only ever answers about the signed-in person
grant execute on function private.shared_support_ok(uuid) to authenticated;

create or replace function private.handling_active(p_at timestamptz)
returns boolean language sql stable set search_path = '' as $$
  select p_at is not null and p_at > now() - interval '15 minutes'
$$;
revoke all on function private.handling_active(timestamptz) from public, anon, authenticated;

alter table public.chat_conversations add column if not exists handling_by uuid references public.profiles (id) on delete set null;
alter table public.chat_conversations add column if not exists handling_at timestamptz;
alter table public.support_tickets add column if not exists handling_by uuid references public.profiles (id) on delete set null;
alter table public.support_tickets add column if not exists handling_at timestamptz;

create or replace function private.handling_json(p_by uuid, p_at timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_by is null then null
              else (select jsonb_build_object('id', p.id, 'name', p.full_name, 'at', p_at, 'active', private.handling_active(p_at), 'me', p.id = private.my_id())
                      from public.profiles p where p.id = p_by) end
$$;
revoke all on function private.handling_json(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Client chat: the conversation is open to shared support (copies of the latest definitions, changed where marked 20270129000100)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.chat_access(p_conversation uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.chat_conversations;
  v_client uuid;
  me uuid;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null then
    return null;
  end if;
  if c.kind = 'CLIENT' then
    v_client := private.my_client_customer();
    if v_client is not null then
      if v_client is distinct from c.customer_id then
        return null;
      end if;
      -- the Relationship Manager's chat is not open to the client before Meta verification is done
      if c.channel = 'RM' and not private.meta_done(c.customer_id) then
        return null;
      end if;
      return 'CLIENT';
    end if;
    me := private.my_id();
    if me is null then
      return null;
    end if;
    if c.channel = 'META' then
      -- the verifier writes; the Relationship Manager and Team Lead who take over can read the history
      if me = private.meta_verifier_of(c.customer_id) or me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id) then
        return 'STAFF';
      end if;
    elsif (me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id) or private.client_group_member(c.id, me)
          -- (20270129000100) any active Support employee of the customer's department while the Support desk is shared
          or private.shared_support_ok(c.customer_id))
          and private.meta_done(c.customer_id) then
      return 'STAFF';
    end if;
    if private.chat_can_review(c.customer_id) then
      return 'REVIEWER';
    end if;
    return null;
  end if;
  me := private.my_id();
  if me is not null and exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null) then
    return 'MEMBER';
  end if;
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.chat_customer_conversation(p_customer uuid, p_channel text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.my_id();
  v_channel text := upper(btrim(coalesce(p_channel, '')));
  c public.chat_conversations;
begin
  -- coalesce: for someone who is not assigned the comparisons are NULL, and NOT NULL would not refuse
  if me is null or p_customer is null or v_channel not in ('', 'META', 'RM')
     or not coalesce(me in (private.support_member_of(p_customer), private.support_lead_of(p_customer), private.meta_verifier_of(p_customer)) or private.chat_can_review(p_customer) or private.shared_support_ok(p_customer), false) then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if v_channel = '' then
    v_channel := case
      when me = private.meta_verifier_of(p_customer) and not private.meta_done(p_customer) then 'META'
      when me in (private.support_member_of(p_customer), private.support_lead_of(p_customer)) then 'RM'
      when me = private.meta_verifier_of(p_customer) then 'META'
      when private.meta_done(p_customer) then 'RM'
      else 'META' end;
  end if;
  c := private.chat_ensure_client_conversation(p_customer, v_channel);
  if private.chat_access(c.id) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return private.chat_conversation_json(c, true);
end $function$;

CREATE OR REPLACE FUNCTION private.chat_conversation_json(c chat_conversations, p_full boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a text := private.chat_access(c.id);
  me uuid := auth.uid();
  v_from bigint := case when a = 'MEMBER' then private.chat_visible_from(c.id) else 0 end;
  v_title text;
  v_customer jsonb := null;
  v_team jsonb := null;
  v_verifier jsonb := null;
  v_members jsonb := null;
  v_admin boolean := false;
  v_peer_read bigint := null;
  v_block text := null;
  v_assigned boolean := null;
  v_handler jsonb := null;
  v_read bigint := coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me), 0);
begin
  if a is null then
    return null;
  end if;
  if c.kind = 'CLIENT' then
    select jsonb_build_object('id', x.id, 'name', x.name, 'business', coalesce(nullif(btrim(x.company), ''), x.name), 'code', x.customer_code,
                              'hasLogin', exists (select 1 from public.customer_client_accounts ca where ca.customer_id = x.id))
      into v_customer from public.customers x where x.id = c.customer_id;
    v_team := private.chat_team_json(c.customer_id);
    v_verifier := (select jsonb_build_object('name', p.full_name, 'position', p.position) from public.profiles p where p.id = private.meta_verifier_of(c.customer_id));
    v_block := private.chat_block_reason(c.id);
    v_title := case when a = 'CLIENT' then (case when c.channel = 'META' then 'Meta verification' else 'Your Amuwa team' end) else v_customer ->> 'business' end;
    v_peer_read := case when a = 'CLIENT' then c.staff_read_seq else c.client_read_seq end;
    v_assigned := case when c.channel = 'META' then v_verifier is not null else (v_team -> 'teamMember') is not null or (v_team -> 'teamLead') is not null end;
    -- who is handling it now: for employees only, never for the client
    if a in ('STAFF', 'REVIEWER') then
      v_handler := private.handling_json(c.handling_by, c.handling_at);
    end if;
    if a = 'CLIENT' then
      v_customer := null;
    end if;
  elsif c.kind = 'DIRECT' then
    select p.full_name into v_title from public.chat_members m join public.profiles p on p.id = m.profile_id
     where m.conversation_id = c.id and m.profile_id <> me limit 1;
    select r.last_read_seq into v_peer_read from public.chat_read_state r where r.conversation_id = c.id and r.user_id <> me limit 1;
  else
    v_title := c.title;
  end if;
  if a = 'MEMBER' then
    v_admin := exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null and m.role = 'ADMIN');
    if p_full or c.kind = 'GROUP' then
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', m.role, 'position', p.position,
                                                   'label', private.chat_role_label(p.role), 'department', d.name, 'me', p.id = me)
                               order by (m.role = 'ADMIN') desc, p.full_name), '[]'::jsonb)
        into v_members from public.chat_members m join public.profiles p on p.id = m.profile_id
        left join public.departments d on d.id = p.department_id
       where m.conversation_id = c.id and m.left_at is null;
    end if;
  end if;
  return jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'channel', case when c.kind = 'CLIENT' then c.channel end, 'access', a,
    'canWrite', a in ('CLIENT', 'STAFF', 'MEMBER') and v_block is null, 'blockReason', case when a in ('CLIENT', 'STAFF') then v_block end,
    'title', v_title,
    'customer', v_customer, 'team', v_team, 'verifier', v_verifier, 'members', v_members, 'isAdmin', v_admin,
    'assigned', v_assigned, 'handler', v_handler,
    'lastSeq', c.last_seq, 'lastMessageAt', c.last_message_at, 'lastMessagePreview', c.last_message_preview, 'lastSenderName', c.last_sender_name,
    'unread', private.chat_unread(c.id, me, v_from), 'readSeq', v_read, 'peerReadSeq', v_peer_read, 'createdAt', c.created_at);
end $function$;

-- the replying employee is attributed by name; the label is no longer 'Relationship Manager' for a covering colleague; handling + one cover-reply bell
CREATE OR REPLACE FUNCTION public.chat_send_message(p_conversation uuid, p_body text, p_client_msg_id uuid, p_reply_to uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT '{}'::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_existing public.chat_messages;
  v_msg public.chat_messages;
  v_seq bigint;
  v_name text;
  v_label text;
  v_kind text;
  v_atts jsonb := '[]'::jsonb;
  v_n integer := coalesce(array_length(p_attachments, 1), 0);
  v_found integer;
  v_cust public.customers;
  v_to uuid;
  v_read bigint;
  v_block text;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but only the client and their assigned team can write in it.' using errcode = '42501';
  end if;
  if p_client_msg_id is null then
    raise exception 'VALIDATION_ERROR: The message has no identifier. Please try again.' using errcode = 'P0001';
  end if;
  -- a retry or a double click: the message was already stored
  select * into v_existing from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
  if v_existing.id is not null then
    return private.chat_message_json(v_existing);
  end if;
  if v_n > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files to one message.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: A message can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if v_body = '' and v_n = 0 then
    raise exception 'VALIDATION_ERROR: Write a message first.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_messages x where x.sender_id = me and x.created_at > now() - interval '1 minute') >= 60 then
    raise exception 'VALIDATION_ERROR: You are sending messages too fast. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  if c.kind = 'CLIENT' then
    select * into v_cust from public.customers where id = c.customer_id;
    -- the stage decides whom the client may write to and when (Meta Verifier first, the Relationship Manager after verification)
    v_block := private.chat_block_reason(c.id);
    if v_block is not null then
      raise exception 'VALIDATION_ERROR: %', v_block using errcode = 'P0001';
    end if;
  end if;
  if p_reply_to is not null and not exists (select 1 from public.chat_messages r where r.id = p_reply_to and r.conversation_id = c.id) then
    raise exception 'VALIDATION_ERROR: The message you are replying to was not found.' using errcode = 'P0001';
  end if;
  if v_n > 0 then
    select count(*), coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.file_name, 'mime', t.mime_type, 'size', t.size_bytes) order by t.created_at), '[]'::jsonb)
      into v_found, v_atts from public.chat_attachments t
     where t.id = any (p_attachments) and t.conversation_id = c.id and t.uploader_id = me and t.status = 'READY' and t.message_id is null;
    if v_found <> v_n then
      raise exception 'VALIDATION_ERROR: One of the files is not ready or was already sent. Upload it again.' using errcode = 'P0001';
    end if;
  end if;

  if a = 'CLIENT' then
    v_name := coalesce(nullif(btrim(v_cust.name), ''), 'Client');
    v_label := 'Client';
    v_kind := 'CLIENT';
  else
    select p.full_name into v_name from public.profiles p where p.id = me;
    v_kind := 'STAFF';
    v_label := case when c.kind <> 'CLIENT' then null when c.channel = 'META' then 'Meta Verifier'
                    when me = private.support_lead_of(c.customer_id) then 'Team Lead'
                    -- (20270129000100) a colleague covering for the Relationship Manager is not labelled as the Relationship Manager
                    when me = private.support_member_of(c.customer_id) or private.client_group_member(c.id, me) then 'Relationship Manager'
                    else 'Support Team' end;
  end if;

  -- the row lock orders concurrent senders: seq is assigned one at a time
  update public.chat_conversations
     set last_seq = last_seq + 1, last_message_at = now(), updated_at = now(),
         last_message_preview = left(regexp_replace(case when v_body = '' then '[file] ' || (v_atts -> 0 ->> 'name') else v_body end, '\s+', ' ', 'g'), 160),
         last_sender_name = v_name
   where id = c.id returning last_seq into v_seq;
  begin
    insert into public.chat_messages (conversation_id, seq, sender_id, sender_kind, sender_name, sender_label, kind, body, reply_to, client_msg_id, attachments)
    values (c.id, v_seq, me, v_kind, v_name, v_label, 'TEXT', v_body, p_reply_to, p_client_msg_id, v_atts)
    returning * into v_msg;
  exception when unique_violation then
    -- two requests with the same client_msg_id raced: the other one won
    select * into v_msg from public.chat_messages where conversation_id = c.id and sender_id = me and client_msg_id = p_client_msg_id;
    return private.chat_message_json(v_msg);
  end;
  if v_n > 0 then
    update public.chat_attachments set message_id = v_msg.id where id = any (p_attachments);
  end if;
  -- the sender has read everything up to their own message
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  if c.kind = 'CLIENT' then
    if a = 'CLIENT' then
      update public.chat_conversations set client_read_seq = v_seq where id = c.id;
    else
      update public.chat_conversations set staff_read_seq = greatest(staff_read_seq, v_seq) where id = c.id;
      -- (20270129000100) the replying employee is now the one handling it (information only; never changes the Relationship Manager)
      if c.channel = 'RM' then
        update public.chat_conversations set handling_by = me, handling_at = now() where id = c.id;
      end if;
    end if;
    -- bells: at most one per person per "unread run" (a new one only after they have read the chat)
    if a = 'CLIENT' then
      for v_to in select distinct x from unnest(case when c.channel = 'META' then array[private.meta_verifier_of(c.customer_id)]
                                              -- (20270129000100) plus the colleague who is actively handling this client now
                                              else array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id),
                                                         case when private.handling_active(c.handling_at) then c.handling_by end] end) x where x is not null loop
        select coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = v_to), 0) into v_read;
        perform private.notify_once(v_to, 'CHAT_CLIENT_MESSAGE', format('New message from %s', coalesce(v_cust.company, v_cust.name)),
          left(v_body, 200), 'chat', c.id, format('CHAT|%s|%s', c.id, v_read));
      end loop;
    else
      -- (20270129000100) the Relationship Manager is told, once, when a colleague answers their client
      if c.channel = 'RM' and private.support_member_of(c.customer_id) is not null and private.support_member_of(c.customer_id) <> me then
        perform private.notify_once(private.support_member_of(c.customer_id), 'CHAT_COVER_REPLY',
          format('%s replied to %s', v_name, coalesce(v_cust.company, v_cust.name)), left(v_body, 200), 'chat', c.id,
          format('CHATCOVER|%s|%s|%s', c.id, me, current_date));
      end if;
      perform private.client_notify(c.customer_id, 'CHAT_MESSAGE', format('New message from %s', v_name), left(v_body, 200), 'chat', c.id,
        format('CHAT|%s|%s', c.id, (select c2.client_read_seq from public.chat_conversations c2 where c2.id = c.id) ));
    end if;
  end if;
  return private.chat_message_json(v_msg);
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Tickets: reading is shared; managing is NOT (status, priority, assignment, escalation keep their old rule)
-- ---------------------------------------------------------------------------
-- private.can_manage_ticket is the ticket visibility rule exactly as it was before this migration. The four management functions below used it
-- under the name can_view_ticket; they now call can_manage_ticket, so a colleague who can READ and REPLY to a ticket still cannot change it.
create or replace function private.can_manage_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket and (
      t.assignee_id = private.my_id() or t.created_by = private.my_id() or t.escalated_to = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(t.team_id, t.assignee_id))))
$$;
revoke all on function private.can_manage_ticket(uuid) from public, anon;
grant execute on function private.can_manage_ticket(uuid) to authenticated;

-- (reading) can_view_ticket also accepts shared support
CREATE OR REPLACE FUNCTION private.can_view_ticket(p_ticket uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket and (
      t.assignee_id = private.my_id() or t.created_by = private.my_id() or t.escalated_to = private.my_id()
      or private.shared_support_ok(t.customer_id)
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(t.team_id, t.assignee_id))))
$function$;

CREATE OR REPLACE FUNCTION public.send_ticket_message(p_ticket uuid, p_message text, p_internal boolean DEFAULT false, p_client_msg_id uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')
          -- (20270129000100) a colleague covering for the Relationship Manager: the reply carries THEIR name (author_id = me.id)
          or private.shared_support_ok(t.customer_id)) then
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
  perform private.ticket_attach(t.id, u.id, p_attachments, t.customer_id, false);
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
end $function$;

-- management functions: unchanged rule, now via can_manage_ticket
CREATE OR REPLACE FUNCTION public.update_support_ticket(p_ticket uuid, p_status text, p_note text, p_resolution text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  t public.support_tickets;
  v_manager boolean;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 4000);
  v_resolution text := left(nullif(trim(coalesce(p_resolution, '')), ''), 4000);
  v_changed boolean;
  v_kind text;
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_manage_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  v_manager := me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD');
  if p_status not in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Unknown ticket status.' using errcode = 'P0001';
  end if;
  if p_status = 'CLOSED' and not v_manager then
    raise exception 'FORBIDDEN: Only a team lead can close a ticket. Mark it Resolved instead.' using errcode = '42501';
  end if;
  v_changed := p_status is distinct from t.status;
  if not v_changed and v_note is null and v_resolution is null then
    raise exception 'VALIDATION_ERROR: Change the status or add a note.' using errcode = 'P0001';
  end if;
  if p_status in ('RESOLVED', 'CLOSED') and coalesce(v_resolution, t.resolution_notes) is null then
    raise exception 'VALIDATION_ERROR: Add resolution notes before resolving or closing the ticket.' using errcode = 'P0001';
  end if;

  -- Escalating hands the ticket to the next level (Team Lead, then Department Head).
  if p_status = 'ESCALATED' and v_changed and v_resolution is null and private.escalate_ticket(t.id, 'MANUAL', me.id, v_note) then
    return;
  end if;

  update public.support_tickets
     set status = p_status,
         resolution_notes = coalesce(v_resolution, resolution_notes),
         resolved_at = case when p_status in ('RESOLVED', 'CLOSED') then coalesce(resolved_at, now()) else null end,
         escalated_at = case when p_status = 'ESCALATED' and v_changed then now() else escalated_at end,
         escalated_by = case when p_status = 'ESCALATED' and v_changed then me.id else escalated_by end
   where id = t.id;

  v_kind := case when p_status = 'ESCALATED' and v_changed then 'ESCALATED' when v_changed then 'STATUS_CHANGED' else 'NOTE' end;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, note)
  values (t.id, me.id, v_kind, t.status, p_status, coalesce(v_note, v_resolution));
  perform private.write_audit('TICKET_UPDATED', 'support_ticket', t.id, t.department_id, t.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from', t.status, 'to', p_status));

  -- Updates by the assignee go to the team lead (escalations also to the department head);
  -- updates by a lead / head go to the assignee; the person it was escalated to is always told.
  if t.assignee_id is not null and t.assignee_id <> me.id then
    perform private.notify(t.assignee_id, 'TICKET_UPDATE', format('Ticket %s is now %s', t.ticket_no, replace(lower(p_status), '_', ' ')),
      coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id);
  end if;
  if t.escalated_to is not null and t.escalated_to <> me.id and t.escalated_to is distinct from t.assignee_id then
    perform private.notify(t.escalated_to, 'TICKET_UPDATE', format('%s: %s is now %s', me.full_name, t.ticket_no, replace(lower(p_status), '_', ' ')),
      coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id);
  end if;
  if t.assignee_id is not distinct from me.id or not v_manager then
    for v_recipient in
      select id from public.profiles where status = 'ACTIVE' and id <> me.id and id is distinct from t.escalated_to and (
        (role = 'TEAM_HEAD' and team_id = t.team_id and private.led_by(id, t.assignee_id))
        or (p_status = 'ESCALATED' and v_changed and role = 'DEPARTMENT_HEAD' and department_id = t.department_id))
    loop
      perform private.notify(v_recipient, case when p_status = 'ESCALATED' and v_changed then 'TICKET_ESCALATED' else 'TICKET_UPDATE' end,
        case when p_status = 'ESCALATED' and v_changed then format('Escalated: %s %s', t.ticket_no, t.subject)
             else format('%s: %s', me.full_name, format('%s is now %s', t.ticket_no, replace(lower(p_status), '_', ' '))) end,
        coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id, '{}'::jsonb,
        case when p_status = 'ESCALATED' then 'urgent' else 'normal' end);
    end loop;
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.assign_support_ticket(p_ticket uuid, p_assignee uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  t public.support_tickets;
  a public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or me.role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')
     or not private.can_manage_ticket(t.id) then
    raise exception 'FORBIDDEN: Only a team lead or department head can assign tickets.' using errcode = '42501';
  end if;
  if not private.can_assign_ticket_to(p_assignee) then
    raise exception 'VALIDATION_ERROR: Choose an active member of your team.' using errcode = 'P0001';
  end if;
  select * into a from public.profiles where id = p_assignee;

  update public.support_tickets set assignee_id = a.id, team_id = a.team_id, department_id = a.department_id where id = t.id;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, assignee_id, note)
  values (t.id, me.id, 'ASSIGNED', a.id, left(nullif(trim(coalesce(p_note, '')), ''), 4000));
  perform private.write_audit('TICKET_ASSIGNED', 'support_ticket', t.id, a.department_id, a.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from', t.assignee_id, 'to', a.id));
  perform private.notify(a.id, 'TICKET_ASSIGNED', format('Ticket %s: %s', t.ticket_no, t.subject),
    format('Assigned to you by %s', me.full_name), 'support_ticket', t.id);
  if t.assignee_id is not null and t.assignee_id <> a.id then
    perform private.notify(t.assignee_id, 'TICKET_REASSIGNED', format('Ticket %s was reassigned', t.ticket_no),
      format('Now handled by %s', a.full_name), 'support_ticket', t.id);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.escalate_support_ticket(p_ticket uuid, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  t public.support_tickets;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket;
  if me.id is null or t.id is null or not private.can_manage_ticket(t.id)
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
end $function$;

CREATE OR REPLACE FUNCTION public.set_ticket_priority(p_ticket uuid, p_priority text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  t public.support_tickets;
  v_recipient uuid;
  v_labels constant jsonb := '{"LOW": "Low", "MEDIUM": "Medium", "HIGH": "High", "URGENT": "Urgent"}';
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_manage_ticket(t.id)
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
end $function$;


-- The TABLES stay exactly as narrow as before (the assignee, creator, current owner, Team Lead, Department Head, Super Admin): the policies on the ticket updates and
-- escalations followed can_view_ticket, which now also admits shared support, so they are pinned to can_manage_ticket (the old rule). Everybody's own ticket lists,
-- dashboards and counts therefore do not change. Shared support reads tickets through public.desk_tickets() below.
alter policy support_ticket_updates_select on public.support_ticket_updates using (private.can_manage_ticket(ticket_id));
alter policy support_ticket_escalations_select on public.support_ticket_escalations using ((select private.may_work_in_support()) and private.can_manage_ticket(ticket_id));

-- ---------------------------------------------------------------------------
-- 4. "Currently handling" on tickets: whoever replies or adds a note is shown as handling it (information only)
-- ---------------------------------------------------------------------------
create or replace function private.tg_support_ticket_updates_handling()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not new.client_author and new.kind = 'NOTE' and new.author_id is not null then
    update public.support_tickets set handling_by = new.author_id, handling_at = new.created_at where id = new.ticket_id;
  end if;
  return null;
end $$;
revoke all on function private.tg_support_ticket_updates_handling() from public, anon, authenticated;
drop trigger if exists support_ticket_updates_handling on public.support_ticket_updates;
create trigger support_ticket_updates_handling after insert on public.support_ticket_updates
  for each row execute function private.tg_support_ticket_updates_handling();

-- take / release / take over. Information only: nobody is locked out and the assignee, level, status and priority are untouched.
create or replace function public.chat_set_handling(p_conversation uuid, p_action text default 'TAKE')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  c public.chat_conversations;
  v_action text := upper(coalesce(p_action, 'TAKE'));
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if me is null or c.id is null or private.chat_access(p_conversation) is distinct from 'STAFF' or c.kind <> 'CLIENT' or c.channel <> 'RM' then
    raise exception 'FORBIDDEN: You cannot handle this conversation.' using errcode = '42501';
  end if;
  if v_action not in ('TAKE', 'RELEASE') then
    raise exception 'VALIDATION_ERROR: Unknown action.' using errcode = 'P0001';
  end if;
  if v_action = 'TAKE' then
    update public.chat_conversations set handling_by = me, handling_at = now() where id = c.id;
    perform private.write_audit('CHAT_HANDLING_TAKEN', 'chat_conversation', c.id, null, null,
      jsonb_build_object('customer_id', c.customer_id, 'previous', c.handling_by));
  else
    -- release your own, or (as the Relationship Manager / Team Lead) clear anyone's
    if c.handling_by is distinct from me and me is distinct from private.support_member_of(c.customer_id) and me is distinct from private.support_lead_of(c.customer_id) then
      raise exception 'FORBIDDEN: Only the person handling this chat, its Relationship Manager or Team Lead can release it.' using errcode = '42501';
    end if;
    update public.chat_conversations set handling_by = null, handling_at = null where id = c.id;
    perform private.write_audit('CHAT_HANDLING_RELEASED', 'chat_conversation', c.id, null, null, jsonb_build_object('customer_id', c.customer_id, 'previous', c.handling_by));
  end if;
  select * into c from public.chat_conversations where id = p_conversation;
  return private.handling_json(c.handling_by, c.handling_at);
end $$;
revoke all on function public.chat_set_handling(uuid, text) from public, anon;
grant execute on function public.chat_set_handling(uuid, text) to authenticated, service_role;

create or replace function public.ticket_set_handling(p_ticket uuid, p_action text default 'TAKE')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  v_action text := upper(coalesce(p_action, 'TAKE'));
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') or private.shared_support_ok(t.customer_id)) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_action not in ('TAKE', 'RELEASE') then
    raise exception 'VALIDATION_ERROR: Unknown action.' using errcode = 'P0001';
  end if;
  if v_action = 'TAKE' then
    update public.support_tickets set handling_by = me.id, handling_at = now() where id = t.id;
    perform private.write_audit('TICKET_HANDLING_TAKEN', 'support_ticket', t.id, t.department_id, t.team_id, jsonb_build_object('ticket_no', t.ticket_no, 'previous', t.handling_by));
  else
    if t.handling_by is distinct from me.id and t.assignee_id is distinct from me.id and not private.can_manage_ticket(t.id) then
      raise exception 'FORBIDDEN: Only the person handling this ticket, its assignee or a manager can release it.' using errcode = '42501';
    end if;
    update public.support_tickets set handling_by = null, handling_at = null where id = t.id;
    perform private.write_audit('TICKET_HANDLING_RELEASED', 'support_ticket', t.id, t.department_id, t.team_id, jsonb_build_object('ticket_no', t.ticket_no, 'previous', t.handling_by));
  end if;
  select * into t from public.support_tickets where id = p_ticket;
  return private.handling_json(t.handling_by, t.handling_at);
end $$;
revoke all on function public.ticket_set_handling(uuid, text) from public, anon;
grant execute on function public.ticket_set_handling(uuid, text) to authenticated, service_role;

-- The shared desk's tickets: the customer tickets of the caller's department (at most the 300 most recently updated) with their history, for Support employees.
-- Same row shapes as the tables (so the existing ticket screens render them), plus: manageable (may the caller change status / priority / assignment / escalation),
-- the assignee's, handler's and authors' names (colleagues are not in every screen's people list). Internal notes are included: these are employees.
create or replace function public.desk_tickets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_ids uuid[];
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.is_support_staff() or not private.support_desk_department_wide() then
    return jsonb_build_object('tickets', '[]'::jsonb, 'updates', '[]'::jsonb, 'customers', '[]'::jsonb);
  end if;
  select coalesce(array_agg(x.id), '{}') into v_ids from (
    select t.id from public.support_tickets t
     where t.department_id = private.my_department_id() and private.shared_support_ok(t.customer_id)
     order by t.updated_at desc limit 300) x;
  return jsonb_build_object(
    'tickets', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object(
                  'manageable', private.can_manage_ticket(t.id), 'via_desk', true,
                  'assignee_name', (select p.full_name from public.profiles p where p.id = t.assignee_id),
                  'handler_name', (select p.full_name from public.profiles p where p.id = t.handling_by)) order by t.updated_at desc)
                  from public.support_tickets t where t.id = any (v_ids)), '[]'::jsonb),
    'updates', coalesce((select jsonb_agg(to_jsonb(u) || jsonb_build_object('author_name', (select p.full_name from public.profiles p where p.id = u.author_id)) order by u.created_at)
                  from (select * from public.support_ticket_updates x where x.ticket_id = any (v_ids) order by x.created_at desc limit 3000) u), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'customer_code', c.customer_code, 'company', c.company, 'phone', c.phone, 'email', c.email))
                  from public.customers c where c.id in (select t.customer_id from public.support_tickets t where t.id = any (v_ids))), '[]'::jsonb));
end $$;
revoke all on function public.desk_tickets() from public, anon;
grant execute on function public.desk_tickets() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The shared desk: the department's client conversations for Support employees (RM, handler, last message, unread, awaiting reply)
-- ---------------------------------------------------------------------------
create or replace function public.chat_desk_clients(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.is_support_staff() or not private.support_desk_department_wide() then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x.row order by x.sort_at desc nulls last, x.name) from (
      select t.name, t.sort_at, jsonb_build_object(
        'customerId', t.id, 'name', t.name, 'business', t.business, 'code', t.code, 'channel', 'RM',
        'conversationId', t.conv_id, 'lastMessageAt', t.sort_at, 'lastMessagePreview', t.preview, 'lastSenderName', t.last_sender,
        'unread', case when t.conv_id is null then 0 else private.chat_unread(t.conv_id, me, 0) end,
        'awaitingReply', coalesce(t.last_kind = 'CLIENT', false),
        'hasLogin', t.has_login, 'role', t.role, 'groupName', null,
        'rm', case when t.rm_id is null then null else jsonb_build_object('id', t.rm_id, 'name', t.rm_name) end,
        'handler', private.handling_json(t.handling_by, t.handling_at), 'shared', true) as row
      from (
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name) as business, c.customer_code as code,
               cv.id as conv_id, cv.last_message_at as sort_at, cv.last_message_preview as preview, cv.last_sender_name as last_sender,
               cv.handling_by, cv.handling_at,
               (select m.sender_kind from public.chat_messages m where m.conversation_id = cv.id and m.deleted_at is null order by m.seq desc limit 1) as last_kind,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id) as has_login,
               case when me = private.support_member_of(c.id) then 'Relationship Manager' when me = private.support_lead_of(c.id) then 'Team Lead' else 'Support desk' end as role,
               private.support_member_of(c.id) as rm_id, (select p.full_name from public.profiles p where p.id = private.support_member_of(c.id)) as rm_name
          from public.customers c
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'RM'
         where c.department_id = private.my_department_id() and c.lifecycle_stage = 'CUSTOMER'
           and private.shared_support_ok(c.id) and private.meta_done(c.id)
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
         order by cv.last_message_at desc nulls last, c.name limit 300) t) x), '[]'::jsonb);
end $$;
revoke all on function public.chat_desk_clients(text) from public, anon;
grant execute on function public.chat_desk_clients(text) to authenticated, service_role;
-- the Chat page's client tab (the server decides who has it)
CREATE OR REPLACE FUNCTION public.chat_client_tab()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me uuid := private.my_id();
  v_n integer := 0;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  v_n := coalesce(jsonb_array_length(public.chat_my_clients(null)), 0);
  -- (20270129000100) the Support desk is a client tab too: any Support employee of the department sees it while the desk is shared
  return jsonb_build_object('eligible', v_n > 0 or private.chat_client_eligible(me) or (private.is_support_staff() and private.support_desk_department_wide()), 'count', v_n);
end $function$;
revoke all on function public.chat_client_tab() from public, anon;
grant execute on function public.chat_client_tab() to authenticated, service_role;
notify pgrst, 'reload schema';
