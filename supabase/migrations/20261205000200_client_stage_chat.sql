-- Stage-based client chat: the client talks to the Meta Verifier until Meta verification is completed, then to the Relationship Manager.
--
-- Same chat tables, same functions, same rules (identity from auth.uid(), read-only tables, history kept). What is added:
--   * chat_conversations.channel: 'RM' (every existing client conversation) or 'META'. A customer has at most one conversation per channel,
--     so the Meta verification history is kept apart from the Relationship Manager's and nothing is deleted or overwritten.
--   * Who is on the other side is never chosen by the caller: the META conversation's staff side is the customer's assigned Meta Verifier,
--     the RM conversation's is the customer's Team Member / Team Lead (as before). The client only names a channel, and the database answers
--     only for a channel that is open to them at their stage.
--   * Writing is allowed only while the channel is live: META until verification is completed (also when it is rejected or documents are
--     requested), RM once verification is completed and someone is assigned. A closed channel stays readable (history).
--
-- Run after 20261205000100_client_onboarding_journey.sql. Safe to run again.

drop index if exists public.chat_conversations_client_key;
create unique index if not exists chat_conversations_client_channel_key on public.chat_conversations (customer_id, channel) where kind = 'CLIENT';

-- Is Meta verification behind this customer? (Outside the journey, not needed, or completed.)
create or replace function private.meta_done(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((private.client_facts(p_customer) ->> 'metaDone')::boolean, true)
$$;
revoke all on function private.meta_done(uuid) from public, anon, authenticated;

-- Why nobody may write in this conversation right now (null = it is live).
create or replace function private.chat_block_reason(p_conversation uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  f jsonb;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or c.kind <> 'CLIENT' then
    return null;
  end if;
  f := private.client_facts(c.customer_id);
  if c.channel = 'META' then
    if not coalesce((f ->> 'metaRequired')::boolean, false) or coalesce((f ->> 'metaDone')::boolean, false) then
      return 'Meta verification is completed. This conversation is closed; your Relationship Manager continues with you.';
    end if;
    if private.meta_verifier_of(c.customer_id) is null then
      return 'A Meta Verifier has not been assigned yet. You will be able to write as soon as one is assigned.';
    end if;
    return null;
  end if;
  if not coalesce((f ->> 'metaDone')::boolean, false) then
    return 'This chat opens after Meta verification is completed.';
  end if;
  if private.rm_of(c.customer_id) is null and private.rm_lead_of(c.customer_id) is null then
    return 'Your team has not been assigned yet. You will be able to write as soon as a Relationship Manager is assigned.';
  end if;
  return null;
end $$;
revoke all on function private.chat_block_reason(uuid) from public, anon, authenticated;

-- How the signed-in user relates to a conversation: CLIENT, STAFF (the assigned people of that channel), MEMBER (internal), REVIEWER
-- (read only) or NULL (no access at all).
create or replace function private.chat_access(p_conversation uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
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
    elsif (me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id)) and private.meta_done(c.customer_id) then
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
end $$;
revoke all on function private.chat_access(uuid) from public, anon;
grant execute on function private.chat_access(uuid) to authenticated;

-- A conversation as the signed-in person sees it.
create or replace function private.chat_conversation_json(c public.chat_conversations, p_full boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    'assigned', v_assigned,
    'lastSeq', c.last_seq, 'lastMessageAt', c.last_message_at, 'lastMessagePreview', c.last_message_preview, 'lastSenderName', c.last_sender_name,
    'unread', private.chat_unread(c.id, me, v_from), 'readSeq', v_read, 'peerReadSeq', v_peer_read, 'createdAt', c.created_at);
end $$;
revoke all on function private.chat_conversation_json(public.chat_conversations, boolean) from public, anon;

-- ---------------------------------------------------------------------------
-- Opening conversations
-- ---------------------------------------------------------------------------
drop function if exists private.chat_ensure_client_conversation(uuid);
create or replace function private.chat_ensure_client_conversation(p_customer uuid, p_channel text default 'RM')
returns public.chat_conversations language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer and channel = p_channel;
  if c.id is null then
    insert into public.chat_conversations (kind, customer_id, channel) values ('CLIENT', p_customer, p_channel)
    on conflict (customer_id, channel) where kind = 'CLIENT' do nothing;
    select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer and channel = p_channel;
  end if;
  return c;
end $$;
revoke all on function private.chat_ensure_client_conversation(uuid, text) from public, anon;

-- The client's own conversation of a channel (created on first use). The customer always comes from the login; the client can only
-- name a channel, and gets only a channel that is open at their stage. No channel: the one they should be using now.
drop function if exists public.chat_client_conversation();
create or replace function public.chat_client_conversation(p_channel text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_channel text := upper(btrim(coalesce(p_channel, '')));
  c public.chat_conversations;
begin
  if v_channel = '' then
    v_channel := case when private.meta_done(v_customer) then 'RM' else 'META' end;
  end if;
  if v_channel not in ('META', 'RM') then
    raise exception 'VALIDATION_ERROR: Unknown chat.' using errcode = 'P0001';
  end if;
  if v_channel = 'META' and not private.meta_required(v_customer) and not exists (
       select 1 from public.chat_conversations x where x.kind = 'CLIENT' and x.customer_id = v_customer and x.channel = 'META') then
    raise exception 'NOT_FOUND: There is no Meta verification chat for your services.' using errcode = 'P0001';
  end if;
  c := private.chat_ensure_client_conversation(v_customer, v_channel);
  if private.chat_access(c.id) is null then
    raise exception 'FORBIDDEN: This chat opens after Meta verification is completed.' using errcode = '42501';
  end if;
  return private.chat_conversation_json(c, true);
end $$;
revoke all on function public.chat_client_conversation(text) from public, anon;
grant execute on function public.chat_client_conversation(text) to authenticated;

-- Staff: the conversation of a customer they look after, or review (Department Head). Which channel is decided by their relation to the
-- customer unless they ask for one; the answer is NOT_FOUND for a channel they have no part in.
drop function if exists public.chat_customer_conversation(uuid);
create or replace function public.chat_customer_conversation(p_customer uuid, p_channel text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_channel text := upper(btrim(coalesce(p_channel, '')));
  c public.chat_conversations;
begin
  -- coalesce: for someone who is not assigned the comparisons are NULL, and NOT NULL would not refuse
  if me is null or p_customer is null or v_channel not in ('', 'META', 'RM')
     or not coalesce(me in (private.support_member_of(p_customer), private.support_lead_of(p_customer), private.meta_verifier_of(p_customer)) or private.chat_can_review(p_customer), false) then
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
end $$;
revoke all on function public.chat_customer_conversation(uuid, text) from public, anon;
grant execute on function public.chat_customer_conversation(uuid, text) to authenticated;

-- The customers this employee looks after: as Relationship Manager / Team Lead (RM chat) or as Meta Verifier (Meta chat).
create or replace function public.chat_my_clients(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by sort_at desc nulls last, name) from (
      select t.name, t.sort_at, jsonb_build_object(
        'customerId', t.id, 'name', t.name, 'business', t.business, 'code', t.code, 'channel', t.channel,
        'conversationId', t.conv_id, 'lastMessageAt', t.sort_at, 'lastMessagePreview', t.preview,
        'unread', case when t.conv_id is null then 0 else private.chat_unread(t.conv_id, me, 0) end,
        'hasLogin', t.has_login, 'role', t.role) as row
      from (
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name) as business, c.customer_code as code, 'RM'::text as channel,
               cv.id as conv_id, cv.last_message_at as sort_at, cv.last_message_preview as preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id) as has_login,
               case when me = private.support_member_of(c.id) then 'Relationship Manager' else 'Team Lead' end as role
          from public.customers c
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'RM'
         where c.department_id = private.my_department_id()
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (me = private.support_member_of(c.id) or me = private.support_lead_of(c.id))
           and private.meta_done(c.id)
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        union all
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name), c.customer_code, 'META',
               cv.id, cv.last_message_at, cv.last_message_preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id),
               'Meta Verifier'
          from public.customers c
          join public.customer_onboarding o on o.customer_id = c.id and o.meta_verifier_id = me
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'META'
         where c.department_id = private.my_department_id()
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        order by sort_at desc nulls last, name limit 200) t) x), '[]'::jsonb);
end $$;
revoke all on function public.chat_my_clients(text) from public, anon;
grant execute on function public.chat_my_clients(text) to authenticated;

-- Unread totals for the badges: internal chats, the employee's own clients, the review list (Department Head).
create or replace function public.chat_unread_summary()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  v_client uuid := private.my_client_customer();
  v_internal integer := 0;
  v_clients integer := 0;
  v_review integer := 0;
begin
  if v_client is not null then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients
      from public.chat_conversations c where c.kind = 'CLIENT' and c.customer_id = v_client and private.chat_access(c.id) = 'CLIENT';
    return jsonb_build_object('total', v_clients, 'internal', 0, 'clients', v_clients, 'review', 0);
  end if;
  if private.my_id() is null then
    return jsonb_build_object('total', 0, 'internal', 0, 'clients', 0, 'review', 0);
  end if;
  select coalesce(sum(private.chat_unread(m.conversation_id, me, m.visible_from_seq)), 0) into v_internal
    from public.chat_members m where m.profile_id = me and m.left_at is null;
  select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients
    from public.chat_conversations c join public.customers cu on cu.id = c.customer_id
   where c.kind = 'CLIENT' and c.last_seq > 0 and cu.department_id = private.my_department_id()
     and private.chat_access(c.id) = 'STAFF';
  if private.my_role() in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_review
      from public.chat_conversations c where c.kind = 'CLIENT' and c.last_seq > 0 and private.chat_access(c.id) = 'REVIEWER';
  end if;
  return jsonb_build_object('total', v_internal + v_clients, 'internal', v_internal, 'clients', v_clients, 'review', v_review);
end $$;
revoke all on function public.chat_unread_summary() from public, anon;
grant execute on function public.chat_unread_summary() to authenticated;

-- Sending and files: the stage decides whether the conversation is live (see chat_block_reason).
create or replace function public.chat_send_message(
  p_conversation uuid, p_body text, p_client_msg_id uuid, p_reply_to uuid default null, p_attachments uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
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
                    when me = private.support_lead_of(c.customer_id) then 'Team Lead' else 'Relationship Manager' end;
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
    end if;
    -- bells: at most one per person per "unread run" (a new one only after they have read the chat)
    if a = 'CLIENT' then
      for v_to in select x from unnest(case when c.channel = 'META' then array[private.meta_verifier_of(c.customer_id)]
                                              else array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id)] end) x where x is not null loop
        select coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = v_to), 0) into v_read;
        perform private.notify_once(v_to, 'CHAT_CLIENT_MESSAGE', format('New message from %s', coalesce(v_cust.company, v_cust.name)),
          left(v_body, 200), 'chat', c.id, format('CHAT|%s|%s', c.id, v_read));
      end loop;
    else
      perform private.client_notify(c.customer_id, 'CHAT_MESSAGE', format('New message from %s', v_name), left(v_body, 200), 'chat', c.id,
        format('CHAT|%s|%s', c.id, (select c2.client_read_seq from public.chat_conversations c2 where c2.id = c.id) ));
    end if;
  end if;
  return private.chat_message_json(v_msg);
end $$;

create or replace function public.chat_begin_upload(p_conversation uuid, p_file_name text, p_mime text, p_size bigint)
returns public.chat_attachments language plpgsql security definer set search_path = '' as $$
declare
  a text := private.chat_access(p_conversation);
  me uuid := auth.uid();
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  r public.chat_attachments;
begin
  if a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if a = 'REVIEWER' then
    raise exception 'FORBIDDEN: You can read this conversation as a reviewer, but you cannot send files in it.' using errcode = '42501';
  end if;
  if private.chat_block_reason(p_conversation) is not null then
    raise exception 'VALIDATION_ERROR: %', private.chat_block_reason(p_conversation) using errcode = 'P0001';
  end if;
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be sent. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.chat_attachments t where t.uploader_id = me and t.status = 'PENDING' and t.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'FAILED' where uploader_id = me and status = 'PENDING' and created_at < now() - interval '1 day';
  insert into public.chat_attachments (id, conversation_id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, p_conversation, me, v_name, p_mime, p_size, format('%s/%s/%s', p_conversation, v_id, private.chat_clean_name(v_name)))
  returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- The conversations follow the stage
-- ---------------------------------------------------------------------------
-- A change of the hand-over team is told to the Relationship Manager's conversation (the Meta conversation is not touched).
create or replace function private.tg_chat_team_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  v_conv uuid;
  v_team jsonb;
begin
  begin
    -- the same function serves customers (id) and customer_onboarding (customer_id)
    v_customer := (to_jsonb(new) ->> case when tg_table_name = 'customers' then 'id' else 'customer_id' end)::uuid;
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = v_customer and channel = 'RM';
    if v_conv is not null then
      v_team := private.chat_team_json(v_customer);
      perform private.chat_system_message(v_conv, format('Your assigned team was updated. Relationship Manager: %s. Team Lead: %s.',
        coalesce(v_team -> 'teamMember' ->> 'name', 'not assigned yet'), coalesce(v_team -> 'teamLead' ->> 'name', 'not assigned yet')));
    end if;
  exception when others then
    -- chat must never stop a hand-over
    raise warning 'chat: could not record the team change for customer %: %', v_customer, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_chat_team_changed() from public, anon, authenticated;

-- The Meta verification conversation records each change of the status as a line (the client sees what happened and when).
create or replace function private.tg_chat_meta_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_conv uuid;
  v_text text;
begin
  begin
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = new.customer_id and channel = 'META';
    v_text := case new.meta_status
      when 'IN_PROGRESS' then 'Meta verification is in progress.'
      when 'DOCUMENTS_REQUIRED' then 'Documents required: ' || coalesce(new.meta_feedback, 'please check your Onboarding Journey.')
      when 'REJECTED' then 'Meta verification was not approved: ' || coalesce(new.meta_feedback, 'please check your Onboarding Journey.')
      when 'COMPLETED' then 'Meta verification is completed. This conversation is now closed and kept for reference. Your Relationship Manager continues with you in the Relationship Manager chat.'
      end;
    if v_conv is not null and v_text is not null then
      perform private.chat_system_message(v_conv, v_text);
    end if;
  exception when others then
    raise warning 'chat: could not record the Meta status for customer %: %', new.customer_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_chat_meta_changed() from public, anon, authenticated;
drop trigger if exists chat_meta_changed on public.customer_onboarding;
create trigger chat_meta_changed after update on public.customer_onboarding
  for each row when (old.meta_status is distinct from new.meta_status)
  execute function private.tg_chat_meta_changed();

do $$
declare
  f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'chat\_%' loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
