-- =============================================================================
-- Chat: (A) Client chat and (B) Internal employee chat (direct messages and groups).
--
-- One set of tables, one set of functions, two completely separate audiences:
--   CLIENT conversation  one per customer. Participants are decided LIVE from the customer's current assignment, never
--                        stored: the client, the customer's Team Member and Team Lead (private.support_member_of /
--                        support_lead_of). The Department Head of the customer's department (and the Super Admin) can
--                        READ it as a reviewer and can never write: the write check does not know that role.
--   DIRECT / GROUP       internal only; explicit membership (chat_members). A client can never be a member (members are
--                        profiles, and a client login has no profile).
--
-- Rules that are written down here and nowhere else:
--  * Identity comes from auth.uid(); nothing the caller sends can name a different sender.
--  * Tables are readable only through row level security (the same rule Supabase Realtime applies to each change it
--    delivers) and are NEVER writable by the API roles: every change goes through the functions below.
--  * Every message has a per-conversation sequence number (seq) assigned under a row lock, so order is stable, a
--    reconnecting screen asks for "everything after seq N", and unread counts are plain arithmetic.
--  * Sending is idempotent: the screen sends a client_msg_id; a retry or a duplicate request stores one message.
--  * History policy: a CLIENT conversation shows its whole history to the CURRENT assignees (the team changes, the
--    customer's thread stays, and the previous assignee loses access at once). A group member sees messages from
--    the moment they joined; a member who was removed or left loses the conversation entirely, including files.
--  * Read-state: chat_read_state (one row per person and conversation). "Seen" ticks use two mirrored columns on the
--    conversation (client_read_seq / staff_read_seq); reviewers never count as "staff who read it".
--  * Department Head review opens are audited (CLIENT_CHAT_REVIEWED, at most once per 30 minutes per person and chat).
--  * Not included on purpose: editing or deleting messages, voice or video, end-to-end encryption (messages are
--    protected by access control and encryption in transit and at rest, not end to end).
-- Additive / idempotent: safe to run again in the Supabase SQL editor. Nothing is deleted.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('CLIENT', 'DIRECT', 'GROUP')),
  customer_id uuid references public.customers (id) on delete cascade,
  title text check (title is null or length(btrim(title)) between 1 and 80),
  -- DIRECT only: the two profile ids, sorted, so a pair of people can only ever have one conversation
  direct_key text,
  created_by uuid,
  last_seq bigint not null default 0,
  last_message_at timestamptz,
  last_message_preview text,
  last_sender_name text,
  -- "seen" ticks of the client chat: how far the client / the assigned staff have read
  client_read_seq bigint not null default 0,
  staff_read_seq bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_conversation_shape check (
    (kind = 'CLIENT' and customer_id is not null and direct_key is null and title is null)
    or (kind = 'DIRECT' and customer_id is null and direct_key is not null and title is null)
    or (kind = 'GROUP' and customer_id is null and direct_key is null and title is not null))
);
create unique index if not exists chat_conversations_client_key on public.chat_conversations (customer_id) where kind = 'CLIENT';
create unique index if not exists chat_conversations_direct_key on public.chat_conversations (direct_key) where kind = 'DIRECT';
create index if not exists chat_conversations_activity_idx on public.chat_conversations (last_message_at desc nulls last);

create table if not exists public.chat_members (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'MEMBER' check (role in ('ADMIN', 'MEMBER')),
  joined_at timestamptz not null default now(),
  -- the member sees messages with seq greater than this (0 = everything; a member added later starts at "now")
  visible_from_seq bigint not null default 0,
  left_at timestamptz,
  removed_by uuid,
  primary key (conversation_id, profile_id)
);
create index if not exists chat_members_profile_idx on public.chat_members (profile_id) where left_at is null;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  seq bigint not null,
  -- the auth user who wrote it (a profile for staff, the client login for clients); null for system lines
  sender_id uuid,
  sender_kind text not null check (sender_kind in ('CLIENT', 'STAFF', 'SYSTEM')),
  -- names are kept as they were when the message was written
  sender_name text,
  sender_label text,
  kind text not null default 'TEXT' check (kind in ('TEXT', 'SYSTEM')),
  body text not null default '' check (length(body) <= 4000),
  reply_to uuid references public.chat_messages (id) on delete set null,
  client_msg_id uuid,
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 5),
  created_at timestamptz not null default now(),
  unique (conversation_id, seq)
);
create unique index if not exists chat_messages_client_msg_key on public.chat_messages (conversation_id, sender_id, client_msg_id) where client_msg_id is not null;
create index if not exists chat_messages_history_idx on public.chat_messages (conversation_id, seq desc);

create table if not exists public.chat_read_state (
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id uuid not null,
  last_read_seq bigint not null default 0,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

-- A file shared in a conversation. The file lives in the storage abstraction (R2 or Supabase Storage); only a reference
-- is kept here. It is PENDING until the upload is confirmed, then READY; a READY file without a message is only
-- reachable by the person who uploaded it until it is attached to a message.
create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  message_id uuid references public.chat_messages (id) on delete cascade,
  uploader_id uuid not null,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  status text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  storage_bucket text not null default 'chat-attachments',
  storage_path text not null,
  storage_provider text check (storage_provider in ('SUPABASE', 'R2')),
  storage_ref text,
  storage_etag text,
  created_at timestamptz not null default now()
);
create index if not exists chat_attachments_conversation_idx on public.chat_attachments (conversation_id, created_at desc);
create index if not exists chat_attachments_message_idx on public.chat_attachments (message_id) where message_id is not null;

-- Private bucket (no browser access: the API signs short-lived URLs after the database allowed the download).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('chat-attachments', 'chat-attachments', false, 5242880,
            array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- The client's notifications can point to the chat.
alter table public.client_notifications drop constraint if exists client_notifications_entity_type_check;
alter table public.client_notifications add constraint client_notifications_entity_type_check
  check (entity_type in ('invoice', 'service', 'plan', 'ticket', 'service_request', 'plan_request', 'addon', 'announcement', 'calendar', 'document', 'chat'));

-- ---------------------------------------------------------------------------
-- 2. Who may do what (the only place these rules are written)
-- ---------------------------------------------------------------------------
-- A Department Head of the customer's department, or the Super Admin: may READ the client conversation.
create or replace function private.chat_can_review(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_super_admin()
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
      from public.customers c where c.id = p_customer), false)
$$;
revoke all on function private.chat_can_review(uuid) from public, anon;

-- How the signed-in user relates to a conversation: CLIENT, STAFF (assigned Team Member / Team Lead), MEMBER (internal),
-- REVIEWER (read only) or NULL (no access at all). Clients and staff are told apart by their login: a client login has
-- no profile, a staff login has no client account.
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
      return case when v_client = c.customer_id then 'CLIENT' end;
    end if;
    me := private.my_id();
    if me is null then
      return null;
    end if;
    if me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id) then
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

-- The first message number this person may see (members of a group start where they joined).
create or replace function private.chat_visible_from(p_conversation uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select coalesce((select m.visible_from_seq from public.chat_members m
                    where m.conversation_id = p_conversation and m.profile_id = (select private.my_id()) and m.left_at is null), 0)
$$;
revoke all on function private.chat_visible_from(uuid) from public, anon;

create or replace function private.chat_message_visible(p_conversation uuid, p_seq bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select a is not null and (a <> 'MEMBER' or p_seq > private.chat_visible_from(p_conversation))
                     from (select private.chat_access(p_conversation) as a) x), false)
$$;
revoke all on function private.chat_message_visible(uuid, bigint) from public, anon;

-- May these two employees message each other? Every ACTIVE employee may message every other one (a client login is
-- not an employee). To restrict chat (for example to the same department) change this one function.
create or replace function private.chat_may_message(p_a uuid, p_b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_a is not null and p_b is not null and p_a <> p_b
     and (select count(*) from public.profiles p where p.id in (p_a, p_b) and p.status = 'ACTIVE') = 2
$$;
revoke all on function private.chat_may_message(uuid, uuid) from public, anon;

-- Row level security policies run as the signed-in user, so the two helpers they call must be executable by that role
-- (they are SECURITY DEFINER: they read the tables as the owner, never as the caller).
grant execute on function private.chat_access(uuid) to authenticated;
grant execute on function private.chat_message_visible(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row level security: read only, and only what the rules above allow
-- ---------------------------------------------------------------------------
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_read_state enable row level security;
alter table public.chat_attachments enable row level security;
revoke all on public.chat_conversations, public.chat_members, public.chat_messages, public.chat_read_state, public.chat_attachments from public, anon, authenticated;
grant select on public.chat_conversations, public.chat_members, public.chat_messages to authenticated;

drop policy if exists chat_conversations_read on public.chat_conversations;
create policy chat_conversations_read on public.chat_conversations for select to authenticated
  using (private.chat_access(id) is not null);

-- Members of the same conversation see each other; a person always sees their own row (so a removal reaches them live).
drop policy if exists chat_members_read on public.chat_members;
create policy chat_members_read on public.chat_members for select to authenticated
  using (profile_id = (select private.my_id()) or private.chat_access(conversation_id) = 'MEMBER');

drop policy if exists chat_messages_read on public.chat_messages;
create policy chat_messages_read on public.chat_messages for select to authenticated
  using (private.chat_message_visible(conversation_id, seq));
-- chat_read_state and chat_attachments have no policy and no grant: they are reached only through the functions.

-- ---------------------------------------------------------------------------
-- 4. Building blocks (JSON for the screens, unread counts, system lines)
-- ---------------------------------------------------------------------------
create or replace function private.chat_role_label(p_role public.app_role)
returns text language sql immutable set search_path = '' as $$
  select case p_role when 'SUPER_ADMIN' then 'Admin' when 'DEPARTMENT_HEAD' then 'Department Head'
                     when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end
$$;
revoke all on function private.chat_role_label(public.app_role) from public, anon;

create or replace function private.chat_unread(p_conversation uuid, p_user uuid, p_from bigint)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.chat_messages m
   where m.conversation_id = p_conversation and m.kind = 'TEXT' and m.sender_id is distinct from p_user
     and m.seq > greatest(coalesce((select r.last_read_seq from public.chat_read_state r where r.conversation_id = p_conversation and r.user_id = p_user), 0), coalesce(p_from, 0))
$$;
revoke all on function private.chat_unread(uuid, uuid, bigint) from public, anon;

-- A message as the screens receive it. The sender's id is not part of it (the screen only needs "mine").
create or replace function private.chat_message_json(m public.chat_messages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'conversationId', m.conversation_id, 'seq', m.seq, 'mine', m.sender_id is not distinct from auth.uid() and m.sender_id is not null,
    'senderKind', m.sender_kind, 'senderName', m.sender_name, 'senderLabel', m.sender_label, 'kind', m.kind, 'body', m.body,
    'attachments', m.attachments, 'clientMsgId', m.client_msg_id, 'createdAt', m.created_at,
    'replyTo', (select jsonb_build_object('id', r.id, 'seq', r.seq, 'senderName', r.sender_name, 'body', left(r.body, 140)) from public.chat_messages r where r.id = m.reply_to))
$$;
revoke all on function private.chat_message_json(public.chat_messages) from public, anon;

-- A line the system writes into the conversation ("Asha added Ravi"). The caller holds the conversation lock or is a trigger.
create or replace function private.chat_system_message(p_conversation uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_seq bigint;
begin
  update public.chat_conversations set last_seq = last_seq + 1, last_message_at = now(), last_message_preview = left(p_text, 160),
         last_sender_name = null, updated_at = now()
   where id = p_conversation returning last_seq into v_seq;
  if v_seq is null then
    return;
  end if;
  insert into public.chat_messages (conversation_id, seq, sender_kind, kind, body) values (p_conversation, v_seq, 'SYSTEM', 'SYSTEM', left(p_text, 500));
end $$;
revoke all on function private.chat_system_message(uuid, text) from public, anon;

-- The customer's current Team Member and Team Lead (only people who are still ACTIVE count).
create or replace function private.chat_team_json(p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'teamMember', (select jsonb_build_object('name', p.full_name, 'position', p.position) from public.profiles p where p.id = private.support_member_of(p_customer) and p.status = 'ACTIVE'),
    'teamLead', (select jsonb_build_object('name', p.full_name, 'position', p.position) from public.profiles p where p.id = private.support_lead_of(p_customer) and p.status = 'ACTIVE'))
$$;
revoke all on function private.chat_team_json(uuid) from public, anon;

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
  v_members jsonb := null;
  v_admin boolean := false;
  v_peer_read bigint := null;
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
    v_title := case when a = 'CLIENT' then 'Your Amuwa team' else v_customer ->> 'business' end;
    v_peer_read := case when a = 'CLIENT' then c.staff_read_seq else c.client_read_seq end;
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
    'id', c.id, 'kind', c.kind, 'access', a, 'canWrite', a in ('CLIENT', 'STAFF', 'MEMBER'), 'title', v_title,
    'customer', v_customer, 'team', v_team, 'members', v_members, 'isAdmin', v_admin,
    'assigned', case when c.kind = 'CLIENT' then (v_team -> 'teamMember') is not null or (v_team -> 'teamLead') is not null end,
    'lastSeq', c.last_seq, 'lastMessageAt', c.last_message_at, 'lastMessagePreview', c.last_message_preview, 'lastSenderName', c.last_sender_name,
    'unread', private.chat_unread(c.id, me, v_from), 'readSeq', v_read, 'peerReadSeq', v_peer_read, 'createdAt', c.created_at);
end $$;
revoke all on function private.chat_conversation_json(public.chat_conversations, boolean) from public, anon;

create or replace function private.chat_clean_name(p text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9._ -]', '_', 'g'), '\.{2,}', '.', 'g')
$$;
revoke all on function private.chat_clean_name(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 5. Opening conversations
-- ---------------------------------------------------------------------------
create or replace function private.chat_ensure_client_conversation(p_customer uuid)
returns public.chat_conversations language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer;
  if c.id is null then
    insert into public.chat_conversations (kind, customer_id) values ('CLIENT', p_customer)
    on conflict (customer_id) where kind = 'CLIENT' do nothing;
    select * into c from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer;
  end if;
  return c;
end $$;
revoke all on function private.chat_ensure_client_conversation(uuid) from public, anon;

-- The client's own conversation (created on first use). The customer always comes from the login.
create or replace function public.chat_client_conversation()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.chat_conversations := private.chat_ensure_client_conversation(v_customer);
begin
  return private.chat_conversation_json(c, true);
end $$;

-- Staff: the conversation of a customer they look after (their Team Member / Team Lead), or review (Department Head).
create or replace function public.chat_customer_conversation(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  c public.chat_conversations;
begin
  -- coalesce: for someone who is not assigned the comparisons are NULL, and NOT NULL would not refuse
  if me is null or p_customer is null
     or not coalesce(me = private.support_member_of(p_customer) or me = private.support_lead_of(p_customer) or private.chat_can_review(p_customer), false) then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  c := private.chat_ensure_client_conversation(p_customer);
  return private.chat_conversation_json(c, true);
end $$;

-- The customers this employee looks after (Team Member or Team Lead), with their chat.
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
      select c.name, cv.last_message_at as sort_at, jsonb_build_object(
        'customerId', c.id, 'name', c.name, 'business', coalesce(nullif(btrim(c.company), ''), c.name), 'code', c.customer_code,
        'conversationId', cv.id, 'lastMessageAt', cv.last_message_at, 'lastMessagePreview', cv.last_message_preview,
        'unread', case when cv.id is null then 0 else private.chat_unread(cv.id, me, 0) end,
        'hasLogin', exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id),
        'role', case when me = private.support_member_of(c.id) then 'Team Member' else 'Team Lead' end) as row
        from public.customers c
        left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id
       where c.department_id = private.my_department_id()
         and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
         and (me = private.support_member_of(c.id) or me = private.support_lead_of(c.id))
         and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
       order by cv.last_message_at desc nulls last, c.name limit 200) t), '[]'::jsonb);
end $$;

-- Internal conversations (direct messages and groups) of the signed-in employee, newest first.
create or replace function public.chat_internal_list(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(j order by (j ->> 'lastMessageAt') desc nulls last, (j ->> 'createdAt') desc) from (
      select private.chat_conversation_json(c, false) as j
        from public.chat_conversations c join public.chat_members m on m.conversation_id = c.id and m.profile_id = me and m.left_at is null
       where c.kind in ('DIRECT', 'GROUP')
       order by c.last_message_at desc nulls last limit 200) t
     where v_term is null or lower(coalesce(j ->> 'title', '')) like '%' || v_term || '%' or lower(coalesce(j ->> 'lastMessagePreview', '')) like '%' || v_term || '%'), '[]'::jsonb);
end $$;

-- Department Head / Super Admin: the client conversations they may review, most recently active first.
create or replace function public.chat_review_list(p_search text default null, p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_total integer;
  v_items jsonb;
begin
  if me is null or private.my_role() not in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a Department Head can review client conversations.' using errcode = '42501';
  end if;
  with scope as (
    select cv.id, cv.last_message_at from public.chat_conversations cv join public.customers c on c.id = cv.customer_id
     where cv.kind = 'CLIENT' and cv.last_seq > 0 and private.chat_can_review(c.id)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')),
  pg as (
    select s.last_message_at, s.id from scope s order by s.last_message_at desc nulls last
     limit least(greatest(coalesce(p_limit, 30), 1), 100) offset greatest(coalesce(p_offset, 0), 0))
  select (select count(*) from scope),
         coalesce((select jsonb_agg(private.chat_conversation_json(cv, false) order by pg.last_message_at desc nulls last)
                     from pg join public.chat_conversations cv on cv.id = pg.id), '[]'::jsonb)
    into v_total, v_items;
  return jsonb_build_object('total', v_total, 'items', v_items);
end $$;

-- Opening a client conversation as a reviewer is written to the audit log (at most once per 30 minutes per person and chat).
create or replace function public.chat_review_open(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  cu public.customers;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(c.id) is distinct from 'REVIEWER' then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.audit_logs l where l.actor_id = auth.uid() and l.action = 'CLIENT_CHAT_REVIEWED'
                and l.entity_id = c.id and l.created_at > now() - interval '30 minutes') then
    return;
  end if;
  select * into cu from public.customers where id = c.customer_id;
  perform private.write_audit('CLIENT_CHAT_REVIEWED', 'chat_conversation', c.id, cu.department_id, cu.team_id, jsonb_build_object('customer_id', cu.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reading and sending
-- ---------------------------------------------------------------------------
create or replace function public.chat_conversation_detail(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(c.id) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return private.chat_conversation_json(c, true);
end $$;

-- One page of history: the newest `p_limit` messages (or the ones before `p_before_seq`), or everything after `p_after_seq`
-- (what a screen asks for when it reconnects). Oldest first.
create or replace function public.chat_messages_page(p_conversation uuid, p_before_seq bigint default null, p_after_seq bigint default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  v_from bigint;
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows public.chat_messages[];
  v_more boolean := false;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_from := case when a = 'MEMBER' then private.chat_visible_from(c.id) else 0 end;
  if p_after_seq is not null then
    select coalesce(array_agg(m order by m.seq), '{}') into v_rows from (
      select * from public.chat_messages x where x.conversation_id = c.id and x.seq > greatest(p_after_seq, v_from) order by x.seq limit 200) m;
  else
    select coalesce(array_agg(m order by m.seq), '{}') into v_rows from (
      select * from public.chat_messages x where x.conversation_id = c.id and x.seq > v_from and (p_before_seq is null or x.seq < p_before_seq)
       order by x.seq desc limit v_limit) m;
    v_more := exists (select 1 from public.chat_messages x where x.conversation_id = c.id and x.seq > v_from
                         and x.seq < coalesce((select min(r.seq) from unnest(v_rows) r), 0));
  end if;
  return jsonb_build_object(
    'messages', coalesce((select jsonb_agg(private.chat_message_json(r) order by r.seq) from unnest(v_rows) r), '[]'::jsonb),
    'hasMore', v_more, 'lastSeq', c.last_seq);
end $$;

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
    if a = 'CLIENT' and not exists (select 1 from public.profiles p where p.status = 'ACTIVE' and p.id in (private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id))) then
      raise exception 'VALIDATION_ERROR: Your team has not been assigned yet. Please raise a support ticket and we will help you.' using errcode = 'P0001';
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
    v_label := case when c.kind <> 'CLIENT' then null when me = private.support_lead_of(c.customer_id) then 'Team Lead' else 'Team Member' end;
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
      for v_to in select x from unnest(array[private.support_member_of(c.customer_id), private.support_lead_of(c.customer_id)]) x where x is not null loop
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

create or replace function public.chat_mark_read(p_conversation uuid, p_seq bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  a text;
  me uuid := auth.uid();
  v_seq bigint;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  a := private.chat_access(p_conversation);
  if c.id is null or a is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_seq := least(greatest(coalesce(p_seq, c.last_seq), 0), c.last_seq);
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq) values (c.id, me, v_seq)
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq), updated_at = now();
  if c.kind = 'CLIENT' and a = 'CLIENT' then
    update public.chat_conversations set client_read_seq = v_seq where id = c.id and client_read_seq < v_seq;
    update public.client_notifications set read_at = now() where customer_id = c.customer_id and entity_type = 'chat' and entity_id = c.id and read_at is null;
  elsif c.kind = 'CLIENT' and a = 'STAFF' then
    update public.chat_conversations set staff_read_seq = v_seq where id = c.id and staff_read_seq < v_seq;
  end if;
  if a <> 'CLIENT' then
    update public.notifications set read_at = now() where recipient_id = me and entity_type = 'chat' and entity_id = c.id and read_at is null;
  end if;
  return jsonb_build_object('readSeq', (select r.last_read_seq from public.chat_read_state r where r.conversation_id = c.id and r.user_id = me));
end $$;

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
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_clients from public.chat_conversations c where c.kind = 'CLIENT' and c.customer_id = v_client;
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
     and (me = private.support_member_of(cu.id) or me = private.support_lead_of(cu.id));
  if private.my_role() in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(sum(private.chat_unread(c.id, me, 0)), 0) into v_review
      from public.chat_conversations c where c.kind = 'CLIENT' and c.last_seq > 0 and private.chat_access(c.id) = 'REVIEWER';
  end if;
  return jsonb_build_object('total', v_internal + v_clients, 'internal', v_internal, 'clients', v_clients, 'review', v_review);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Internal chat: people, direct messages, groups
-- ---------------------------------------------------------------------------
-- Find colleagues by name, position, department or team. Only what is needed to pick someone is returned.
create or replace function public.chat_directory(p_search text default null, p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'label', private.chat_role_label(p.role), 'position', p.position,
                                         'department', d.name, 'team', t.name) order by p.full_name)
      from (select * from public.profiles x where x.status = 'ACTIVE' and x.id <> me order by x.full_name limit 2000) p
      left join public.departments d on d.id = p.department_id
      left join public.teams t on t.id = p.team_id
     where private.chat_may_message(me, p.id)
       and (v_term is null or lower(p.full_name) like '%' || v_term || '%' or lower(coalesce(p."position", '')) like '%' || v_term || '%'
            or lower(coalesce(d.name, '')) like '%' || v_term || '%' or lower(coalesce(t.name, '')) like '%' || v_term || '%')
     limit least(greatest(coalesce(p_limit, 30), 1), 100)), '[]'::jsonb);
end $$;

create or replace function public.chat_open_direct(p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_key text;
  c public.chat_conversations;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.chat_may_message(me, p_profile) then
    raise exception 'VALIDATION_ERROR: You cannot start a conversation with this person.' using errcode = 'P0001';
  end if;
  v_key := least(me::text, p_profile::text) || ':' || greatest(me::text, p_profile::text);
  select * into c from public.chat_conversations where kind = 'DIRECT' and direct_key = v_key;
  if c.id is null then
    insert into public.chat_conversations (kind, direct_key, created_by) values ('DIRECT', v_key, me)
    on conflict (direct_key) where kind = 'DIRECT' do nothing;
    select * into c from public.chat_conversations where kind = 'DIRECT' and direct_key = v_key;
    insert into public.chat_members (conversation_id, profile_id, role) values (c.id, me, 'MEMBER'), (c.id, p_profile, 'MEMBER') on conflict do nothing;
  end if;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_create_group(p_title text, p_members uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_title text := btrim(coalesce(p_title, ''));
  v_ids uuid[];
  v_id uuid;
  c public.chat_conversations;
  v_names text;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if length(v_title) < 1 or length(v_title) > 80 then
    raise exception 'VALIDATION_ERROR: Give the group a name (up to 80 characters).' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_members, '{}')) x where x <> me;
  if coalesce(array_length(v_ids, 1), 0) < 1 then
    raise exception 'VALIDATION_ERROR: Add at least one other person to the group.' using errcode = 'P0001';
  end if;
  if array_length(v_ids, 1) > 99 then
    raise exception 'VALIDATION_ERROR: A group can have at most 100 people.' using errcode = 'P0001';
  end if;
  foreach v_id in array v_ids loop
    if not private.chat_may_message(me, v_id) then
      raise exception 'VALIDATION_ERROR: One of the people you picked cannot be added to a group.' using errcode = 'P0001';
    end if;
  end loop;
  insert into public.chat_conversations (kind, title, created_by) values ('GROUP', v_title, me) returning * into c;
  insert into public.chat_members (conversation_id, profile_id, role) values (c.id, me, 'ADMIN');
  insert into public.chat_members (conversation_id, profile_id, role) select c.id, x, 'MEMBER' from unnest(v_ids) x;
  select string_agg(p.full_name, ', ' order by p.full_name) into v_names from public.profiles p where p.id = any (v_ids);
  perform private.chat_system_message(c.id, format('%s created the group and added %s', (select full_name from public.profiles where id = me), v_names));
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

-- Locks the group and checks the caller may manage it (ADMIN). Returns the locked row.
create or replace function private.chat_lock_group(p_conversation uuid, p_need_admin boolean)
returns public.chat_conversations language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  me uuid := private.my_id();
begin
  select * into c from public.chat_conversations where id = p_conversation and kind = 'GROUP' for update;
  if c.id is null or me is null or not exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null) then
    raise exception 'NOT_FOUND: Group not found.' using errcode = 'P0001';
  end if;
  if p_need_admin and not exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = me and m.left_at is null and m.role = 'ADMIN') then
    raise exception 'FORBIDDEN: Only a group admin can do this.' using errcode = '42501';
  end if;
  return c;
end $$;
revoke all on function private.chat_lock_group(uuid, boolean) from public, anon;

create or replace function public.chat_group_rename(p_conversation uuid, p_title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
  v_title text := btrim(coalesce(p_title, ''));
begin
  if length(v_title) < 1 or length(v_title) > 80 then
    raise exception 'VALIDATION_ERROR: Give the group a name (up to 80 characters).' using errcode = 'P0001';
  end if;
  if v_title <> c.title then
    update public.chat_conversations set title = v_title, updated_at = now() where id = c.id;
    perform private.chat_system_message(c.id, format('%s renamed the group to "%s"', (select full_name from public.profiles where id = private.my_id()), v_title));
  end if;
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_add_members(p_conversation uuid, p_members uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
  me uuid := private.my_id();
  v_id uuid;
  v_names text[] := '{}';
  v_added integer := 0;
begin
  foreach v_id in array coalesce(p_members, '{}') loop
    if not private.chat_may_message(me, v_id) then
      raise exception 'VALIDATION_ERROR: One of the people you picked cannot be added to a group.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.chat_members m where m.conversation_id = c.id and m.profile_id = v_id and m.left_at is null) then
      continue;
    end if;
    if (select count(*) from public.chat_members m where m.conversation_id = c.id and m.left_at is null) >= 100 then
      raise exception 'VALIDATION_ERROR: A group can have at most 100 people.' using errcode = 'P0001';
    end if;
    -- a new member (or one coming back) sees the conversation from now on
    insert into public.chat_members (conversation_id, profile_id, role, visible_from_seq, joined_at)
    values (c.id, v_id, 'MEMBER', c.last_seq, now())
    on conflict (conversation_id, profile_id) do update
      set left_at = null, removed_by = null, role = 'MEMBER', visible_from_seq = excluded.visible_from_seq, joined_at = now();
    v_names := v_names || (select full_name from public.profiles where id = v_id);
    v_added := v_added + 1;
  end loop;
  if v_added > 0 then
    perform private.chat_system_message(c.id, format('%s added %s', (select full_name from public.profiles where id = me), array_to_string(v_names, ', ')));
  end if;
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_remove_member(p_conversation uuid, p_profile uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
  me uuid := private.my_id();
  m public.chat_members;
begin
  if p_profile = me then
    raise exception 'VALIDATION_ERROR: Use "Leave group" to leave a group yourself.' using errcode = 'P0001';
  end if;
  select * into m from public.chat_members where conversation_id = c.id and profile_id = p_profile and left_at is null;
  if m.profile_id is null then
    raise exception 'NOT_FOUND: That person is not in the group.' using errcode = 'P0001';
  end if;
  if m.role = 'ADMIN' then
    raise exception 'VALIDATION_ERROR: Remove their admin role first, then remove them.' using errcode = 'P0001';
  end if;
  update public.chat_members set left_at = now(), removed_by = me where conversation_id = c.id and profile_id = p_profile;
  perform private.chat_system_message(c.id, format('%s removed %s', (select full_name from public.profiles where id = me), (select full_name from public.profiles where id = p_profile)));
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_set_admin(p_conversation uuid, p_profile uuid, p_admin boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, true);
begin
  if not exists (select 1 from public.chat_members where conversation_id = c.id and profile_id = p_profile and left_at is null) then
    raise exception 'NOT_FOUND: That person is not in the group.' using errcode = 'P0001';
  end if;
  if not p_admin and (select count(*) from public.chat_members where conversation_id = c.id and left_at is null and role = 'ADMIN') <= 1
     and exists (select 1 from public.chat_members where conversation_id = c.id and profile_id = p_profile and role = 'ADMIN') then
    raise exception 'VALIDATION_ERROR: A group needs at least one admin.' using errcode = 'P0001';
  end if;
  update public.chat_members set role = case when p_admin then 'ADMIN' else 'MEMBER' end where conversation_id = c.id and profile_id = p_profile;
  select * into c from public.chat_conversations where id = c.id;
  return private.chat_conversation_json(c, true);
end $$;

create or replace function public.chat_group_leave(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations := private.chat_lock_group(p_conversation, false);
  me uuid := private.my_id();
  v_next uuid;
begin
  update public.chat_members set left_at = now() where conversation_id = c.id and profile_id = me;
  -- the group always keeps an admin: the longest-standing member takes over
  if not exists (select 1 from public.chat_members where conversation_id = c.id and left_at is null and role = 'ADMIN') then
    select profile_id into v_next from public.chat_members where conversation_id = c.id and left_at is null order by joined_at limit 1;
    if v_next is not null then
      update public.chat_members set role = 'ADMIN' where conversation_id = c.id and profile_id = v_next;
    end if;
  end if;
  perform private.chat_system_message(c.id, format('%s left the group', (select full_name from public.profiles where id = me)));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Attachments (the API issues the upload and download links after these checks)
-- ---------------------------------------------------------------------------
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

create or replace function public.chat_pending_upload(p_attachment uuid)
returns public.chat_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  r public.chat_attachments;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.uploader_id = auth.uid() and t.status = 'PENDING';
  if r.id is null or private.chat_access(r.conversation_id) is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.chat_complete_upload(p_attachment uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.chat_attachments;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.uploader_id = auth.uid() and t.status = 'PENDING';
  if r.id is null or private.chat_access(r.conversation_id) is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.chat_attachments set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag) where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.file_name, 'mime', r.mime_type, 'size', r.size_bytes);
end $$;

create or replace function public.chat_abort_upload(p_attachment uuid)
returns void language sql security definer set search_path = '' as $$
  update public.chat_attachments set status = 'FAILED' where id = p_attachment and uploader_id = auth.uid() and status = 'PENDING'
$$;

-- Current authorization on every download: whoever may read the message (or its uploader, before it is sent).
create or replace function public.chat_attachment_download(p_attachment uuid)
returns public.chat_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  r public.chat_attachments;
  m public.chat_messages;
begin
  select * into r from public.chat_attachments t where t.id = p_attachment and t.status = 'READY';
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if r.message_id is null then
    if r.uploader_id is distinct from auth.uid() or private.chat_access(r.conversation_id) is null then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  else
    select * into m from public.chat_messages where id = r.message_id;
    if not private.chat_message_visible(m.conversation_id, m.seq) then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
  end if;
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 9. The client's chat follows the customer's assignment: tell the conversation when the team changes
-- ---------------------------------------------------------------------------
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
    select id into v_conv from public.chat_conversations where kind = 'CLIENT' and customer_id = v_customer;
    if v_conv is not null then
      v_team := private.chat_team_json(v_customer);
      perform private.chat_system_message(v_conv, format('Your assigned team was updated. Team Member: %s. Team Lead: %s.',
        coalesce(v_team -> 'teamMember' ->> 'name', 'not assigned yet'), coalesce(v_team -> 'teamLead' ->> 'name', 'not assigned yet')));
    end if;
  exception when others then
    -- chat must never stop a hand-over
    raise warning 'chat: could not record the team change for customer %: %', v_customer, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_chat_team_changed() from public, anon, authenticated;
drop trigger if exists chat_team_changed_onboarding on public.customer_onboarding;
create trigger chat_team_changed_onboarding after update of team_member_id, team_lead_id on public.customer_onboarding
  for each row when (old.team_member_id is distinct from new.team_member_id or old.team_lead_id is distinct from new.team_lead_id)
  execute function private.tg_chat_team_changed();
drop trigger if exists chat_team_changed_customers on public.customers;
create trigger chat_team_changed_customers after update of owner_id on public.customers
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function private.tg_chat_team_changed();

-- ---------------------------------------------------------------------------
-- 10. Grants and Realtime
-- ---------------------------------------------------------------------------
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

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['chat_messages', 'chat_conversations', 'chat_members'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

notify pgrst, 'reload schema';
