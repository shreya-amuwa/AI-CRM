-- =============================================================================
-- Chat: Delete Inbox, @mentions in groups, and message reactions. Builds on 20261108000100_chat.sql, 20261206000300_chat_deletion_and_e2ee.sql
-- and the later chat migrations; one chat system, nothing duplicated. Internal chats only (direct messages and groups): client conversations
-- are the customer's shared record and are not touched by any of this.
--
-- DELETE INBOX
--   * Clear my inbox (every employee, for themself): every direct chat and group they are in is emptied FOR THEM. Their membership row moves
--     its existing "visible from" position (the one a member added later already has) to the conversation's current end, so the earlier
--     messages, their files, unread counts and live events are gone for that person on every device; other members keep everything. The chat
--     leaves their list and comes back only when somebody writes again. Audited (CHAT_INBOX_CLEARED, counts only).
--   * Delete all internal chat history (the Super Admin only, with a typed confirmation): every message and file of every direct chat and group
--     is permanently deleted for everybody. Conversations and group memberships stay (empty, with one system line saying what happened). The
--     files are listed for the API to remove from storage. Audited (CHAT_INBOX_PURGED, counts only), and written to chat_inbox_deletions.
--
-- @MENTIONS (groups)
--   * public.chat_message_mentions: who a message tags. The sender sets them right after sending (chat_message_mention), only for their own
--     message in a GROUP, only people who are current members of that group (anyone else is refused), never themselves. This works for
--     end-to-end encrypted messages too: the server stores who is tagged, never what is said.
--   * each tagged member gets an in-app notification (entity 'chat_mention', data: conversation, message, seq) that opens the group on the message.
--
-- REACTIONS (direct messages and groups)
--   * public.chat_message_reactions: at most ONE reaction per person per message (primary key), from the six offered (👍 ❤️ 😂 😮 😢 🙏).
--     chat_message_react adds, changes (another emoji) or removes (null) it. Who may react: whoever can read the message and write in the chat.
--   * the message JSON carries the counts, whether I reacted and who reacted; the table is in the Realtime publication with the same read rule
--     as the messages, so every open screen updates without a refresh.
--
-- Additive and safe to run twice. Replaces private.chat_message_json and public.chat_internal_list (same signatures). Nothing existing is deleted
-- except by the two Delete Inbox actions themselves.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
alter table public.chat_members add column if not exists inbox_cleared_seq bigint;
alter table public.chat_members add column if not exists inbox_cleared_at timestamptz;

create table if not exists public.chat_message_mentions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);
create index if not exists chat_message_mentions_profile_idx on public.chat_message_mentions (profile_id, created_at desc);

create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages (id) on delete cascade,
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '😮', '😢', '🙏')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (message_id, profile_id)
);
create index if not exists chat_message_reactions_conversation_idx on public.chat_message_reactions (conversation_id);

-- the record of every Delete Inbox (who, when, what kind, how much): kept even when the history itself is gone
create table if not exists public.chat_inbox_deletions (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  scope text not null check (scope in ('MINE', 'ALL_INTERNAL')),
  conversations integer not null default 0,
  messages integer not null default 0,
  files integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.chat_message_mentions enable row level security;
alter table public.chat_message_reactions enable row level security;
alter table public.chat_inbox_deletions enable row level security;
revoke all on public.chat_message_mentions, public.chat_message_reactions, public.chat_inbox_deletions from public, anon, authenticated;
grant select on public.chat_message_reactions, public.chat_message_mentions to authenticated;
-- read exactly like the message itself (Realtime applies it to every change it delivers)
drop policy if exists chat_message_reactions_read on public.chat_message_reactions;
create policy chat_message_reactions_read on public.chat_message_reactions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and private.chat_message_visible(m.conversation_id, m.seq)));
drop policy if exists chat_message_mentions_read on public.chat_message_mentions;
create policy chat_message_mentions_read on public.chat_message_mentions for select to authenticated
  using (exists (select 1 from public.chat_messages m where m.id = message_id and private.chat_message_visible(m.conversation_id, m.seq)));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_message_reactions') then
    alter publication supabase_realtime add table public.chat_message_reactions;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The message as screens see it: + mentions and reactions (20261206000300 + two fields)
-- ---------------------------------------------------------------------------
create or replace function private.chat_reactions_json(p_message uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('emoji', x.emoji, 'count', x.n, 'mine', x.mine, 'people', x.people) order by x.first_at), '[]'::jsonb)
    from (select r.emoji, count(*)::int as n, bool_or(r.profile_id = auth.uid()) as mine, min(r.created_at) as first_at,
                 jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'me', p.id = auth.uid()) order by r.created_at) as people
            from public.chat_message_reactions r join public.profiles p on p.id = r.profile_id
           where r.message_id = p_message
           group by r.emoji) x
$$;

create or replace function private.chat_message_json(m public.chat_messages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', m.id, 'conversationId', m.conversation_id, 'seq', m.seq, 'mine', m.sender_id is not distinct from auth.uid() and m.sender_id is not null,
    'senderKind', m.sender_kind, 'senderName', m.sender_name, 'senderLabel', m.sender_label, 'kind', m.kind,
    'deleted', m.deleted_at is not null,
    'body', case when m.deleted_at is null then m.body else '' end,
    'attachments', case when m.deleted_at is null then m.attachments else '[]'::jsonb end,
    'clientMsgId', m.client_msg_id, 'createdAt', m.created_at,
    'encrypted', m.encrypted, 'senderId', case when m.encrypted then m.sender_id end,
    'e2ee', case when m.encrypted and m.deleted_at is null and m.e2ee is not null then jsonb_build_object(
        'v', m.e2ee -> 'v', 'sv', m.e2ee -> 'sv', 'iv', m.e2ee -> 'iv', 'ct', m.e2ee -> 'ct',
        'wrap', (select w from jsonb_array_elements(m.e2ee -> 'wraps') w where w ->> 'to' = auth.uid()::text limit 1)) end,
    'replyTo', (select jsonb_build_object('id', r.id, 'seq', r.seq, 'senderName', r.sender_name,
                  'body', case when r.deleted_at is null and not r.encrypted then left(r.body, 140) else '' end, 'deleted', r.deleted_at is not null)
                  from public.chat_messages r where r.id = m.reply_to),
    -- who this message tags (a group), so the screen highlights their names
    'mentions', case when m.deleted_at is null then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'me', p.id = auth.uid()) order by p.full_name)
                  from public.chat_message_mentions x join public.profiles p on p.id = x.profile_id where x.message_id = m.id), '[]'::jsonb) else '[]'::jsonb end,
    'reactions', case when m.deleted_at is null and m.kind = 'TEXT' then private.chat_reactions_json(m.id) else '[]'::jsonb end)
$$;
revoke all on function private.chat_message_json(public.chat_messages) from public, anon;
revoke all on function private.chat_reactions_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reactions
-- ---------------------------------------------------------------------------
create or replace function public.chat_message_react(p_message uuid, p_emoji text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  m public.chat_messages;
  c public.chat_conversations;
  v_emoji text := nullif(btrim(coalesce(p_emoji, '')), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into m from public.chat_messages where id = p_message;
  select * into c from public.chat_conversations where id = m.conversation_id;
  if m.id is null or c.id is null or not private.chat_message_visible(c.id, m.seq)
     or exists (select 1 from public.chat_message_hidden h where h.message_id = m.id and h.profile_id = me) then
    raise exception 'NOT_FOUND: Message not found.' using errcode = 'P0001';
  end if;
  if c.kind not in ('DIRECT', 'GROUP') or private.chat_access(c.id) is distinct from 'MEMBER' then
    raise exception 'FORBIDDEN: Reactions are for the members of a direct chat or a group.' using errcode = '42501';
  end if;
  if m.kind <> 'TEXT' or m.deleted_at is not null then
    raise exception 'VALIDATION_ERROR: This message cannot get a reaction.' using errcode = 'P0001';
  end if;
  if v_emoji is not null and v_emoji not in ('👍', '❤️', '😂', '😮', '😢', '🙏') then
    raise exception 'VALIDATION_ERROR: Choose one of the offered reactions.' using errcode = 'P0001';
  end if;
  if v_emoji is null then
    delete from public.chat_message_reactions where message_id = m.id and profile_id = me;
  else
    -- one reaction per person and message: a second one replaces the first (never a duplicate)
    insert into public.chat_message_reactions (message_id, conversation_id, profile_id, emoji) values (m.id, c.id, me, v_emoji)
    on conflict (message_id, profile_id) do update set emoji = excluded.emoji, updated_at = now()
      where public.chat_message_reactions.emoji is distinct from excluded.emoji;
  end if;
  return jsonb_build_object('messageId', m.id, 'reactions', private.chat_reactions_json(m.id));
end $$;

-- the reactions of the messages a screen shows (refreshed when Realtime says a reaction changed)
create or replace function public.chat_reactions_for(p_conversation uuid, p_messages uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if private.chat_access(p_conversation) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_messages, 1), 0) > 300 then
    raise exception 'VALIDATION_ERROR: Ask for at most 300 messages.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_object_agg(m.id::text, private.chat_reactions_json(m.id))
                     from public.chat_messages m
                    where m.conversation_id = p_conversation and m.id = any (coalesce(p_messages, '{}'))
                      and private.chat_message_visible(m.conversation_id, m.seq)), '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 4. @mentions in groups
-- ---------------------------------------------------------------------------
create or replace function public.chat_message_mention(p_message uuid, p_profiles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  m public.chat_messages;
  c public.chat_conversations;
  v_name text;
  v_bad uuid;
  r record;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if coalesce(array_length(p_profiles, 1), 0) = 0 then
    return jsonb_build_object('messageId', p_message, 'mentions', '[]'::jsonb);
  end if;
  if array_length(p_profiles, 1) > 50 then
    raise exception 'VALIDATION_ERROR: Tag at most 50 people in one message.' using errcode = 'P0001';
  end if;
  select * into m from public.chat_messages where id = p_message;
  select * into c from public.chat_conversations where id = m.conversation_id;
  if m.id is null or c.id is null or not private.chat_message_visible(c.id, m.seq) then
    raise exception 'NOT_FOUND: Message not found.' using errcode = 'P0001';
  end if;
  if c.kind <> 'GROUP' then
    raise exception 'VALIDATION_ERROR: People can be tagged in a group only.' using errcode = 'P0001';
  end if;
  if m.sender_id is distinct from me or m.kind <> 'TEXT' or m.deleted_at is not null then
    raise exception 'FORBIDDEN: You can tag people only in a message you sent.' using errcode = '42501';
  end if;
  if m.created_at < now() - interval '10 minutes' then
    raise exception 'VALIDATION_ERROR: People are tagged when the message is sent.' using errcode = 'P0001';
  end if;
  -- only people who are in the group now (not someone who left or was removed, not an outsider)
  select x into v_bad from unnest(p_profiles) x
   where x is distinct from me
     and not exists (select 1 from public.chat_members cm join public.profiles p on p.id = cm.profile_id and p.status = 'ACTIVE'
                      where cm.conversation_id = c.id and cm.profile_id = x and cm.left_at is null)
   limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_ERROR: You can only tag members of this group.' using errcode = 'P0001';
  end if;
  v_name := coalesce((select full_name from public.profiles where id = me), 'A colleague');
  for r in select distinct x as pid from unnest(p_profiles) x where x is distinct from me loop
    insert into public.chat_message_mentions (message_id, conversation_id, profile_id) values (m.id, c.id, r.pid)
    on conflict (message_id, profile_id) do nothing;
    if found then
      perform private.notify(r.pid, 'CHAT_MENTION', v_name || ' mentioned you in ' || coalesce(c.title, 'a group'),
        case when m.encrypted then 'Open the group to read the message.' else left(regexp_replace(m.body, '\s+', ' ', 'g'), 200) end,
        'chat_mention', c.id, jsonb_build_object('conversationId', c.id, 'messageId', m.id, 'seq', m.seq), 'normal');
    end if;
  end loop;
  return jsonb_build_object('messageId', m.id,
    'mentions', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'me', p.id = me) order by p.full_name)
                            from public.chat_message_mentions x join public.profiles p on p.id = x.profile_id where x.message_id = m.id), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Delete Inbox
-- ---------------------------------------------------------------------------
-- Clear my inbox: every direct chat and group of mine is emptied for me only (the others keep everything)
create or replace function public.chat_inbox_clear()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_convs integer;
  v_msgs integer;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select count(*)::int, coalesce(sum(greatest(c.last_seq - cm.visible_from_seq, 0)), 0)::int into v_convs, v_msgs
    from public.chat_members cm join public.chat_conversations c on c.id = cm.conversation_id
   where cm.profile_id = me and cm.left_at is null and c.kind in ('DIRECT', 'GROUP');
  update public.chat_members cm
     set visible_from_seq = greatest(cm.visible_from_seq, c.last_seq), inbox_cleared_seq = c.last_seq, inbox_cleared_at = now()
    from public.chat_conversations c
   where c.id = cm.conversation_id and cm.profile_id = me and cm.left_at is null and c.kind in ('DIRECT', 'GROUP');
  -- nothing is left unread in what was cleared
  insert into public.chat_read_state (conversation_id, user_id, last_read_seq)
  select c.id, me, c.last_seq from public.chat_members cm join public.chat_conversations c on c.id = cm.conversation_id
   where cm.profile_id = me and cm.left_at is null and c.kind in ('DIRECT', 'GROUP')
  on conflict (conversation_id, user_id) do update set last_read_seq = greatest(public.chat_read_state.last_read_seq, excluded.last_read_seq);
  insert into public.chat_inbox_deletions (actor_id, scope, conversations, messages) values (me, 'MINE', v_convs, v_msgs);
  perform private.write_audit('CHAT_INBOX_CLEARED', 'profile', me, null, null, jsonb_build_object('conversations', v_convs, 'messages', v_msgs));
  return jsonb_build_object('scope', 'MINE', 'conversations', v_convs, 'messages', v_msgs);
end $$;

-- Delete all internal chat history (the Super Admin only). p_confirm must be exactly 'DELETE ALL CHATS' (a deliberate act, also through the API).
-- Returns the stored files the API must remove; they are kept as DELETED rows (no longer linked to any message) until it confirms.
create or replace function public.chat_inbox_purge(p_confirm text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_convs integer;
  v_msgs integer;
  v_files integer;
  v_list jsonb;
  r record;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role <> 'SUPER_ADMIN' then
    raise exception 'FORBIDDEN: Only the Super Admin can delete the whole chat history.' using errcode = '42501';
  end if;
  if p_confirm is distinct from 'DELETE ALL CHATS' then
    raise exception 'VALIDATION_ERROR: Type DELETE ALL CHATS to confirm.' using errcode = 'P0001';
  end if;
  -- one purge at a time
  perform pg_advisory_xact_lock(hashtextextended('chat-inbox-purge', 0));
  select count(*)::int into v_convs from public.chat_conversations where kind in ('DIRECT', 'GROUP');
  select count(*)::int into v_msgs from public.chat_messages m join public.chat_conversations c on c.id = m.conversation_id
   where c.kind in ('DIRECT', 'GROUP') and m.kind = 'TEXT';
  -- the files: unlinked from their messages (so they survive the delete), marked deleted, listed for storage removal
  update public.chat_attachments a set status = 'DELETED', deleted_at = coalesce(a.deleted_at, now()), message_id = null
    from public.chat_conversations c
   where c.id = a.conversation_id and c.kind in ('DIRECT', 'GROUP') and (a.status <> 'DELETED' or a.message_id is not null);
  get diagnostics v_files = row_count;
  delete from public.chat_messages m using public.chat_conversations c where c.id = m.conversation_id and c.kind in ('DIRECT', 'GROUP');
  update public.chat_conversations set last_message_preview = null, last_sender_name = null, updated_at = now() where kind in ('DIRECT', 'GROUP');
  -- every conversation says what happened (the numbering continues, so open screens catch up normally)
  for r in select id from public.chat_conversations where kind in ('DIRECT', 'GROUP') loop
    perform private.chat_system_message(r.id, 'The chat history was deleted by the Super Admin.');
  end loop;
  update public.chat_members cm set inbox_cleared_seq = null
    from public.chat_conversations c where c.id = cm.conversation_id and c.kind in ('DIRECT', 'GROUP') and cm.inbox_cleared_seq is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'bucket', a.storage_bucket, 'path', a.storage_path, 'provider', a.storage_provider)), '[]'::jsonb)
    into v_list from public.chat_attachments a join public.chat_conversations c on c.id = a.conversation_id
   where c.kind in ('DIRECT', 'GROUP') and a.status = 'DELETED' and a.storage_removed_at is null;
  insert into public.chat_inbox_deletions (actor_id, scope, conversations, messages, files) values (me.id, 'ALL_INTERNAL', v_convs, v_msgs, v_files);
  perform private.write_audit('CHAT_INBOX_PURGED', 'chat', null, me.department_id, me.team_id,
    jsonb_build_object('conversations', v_convs, 'messages', v_msgs, 'files', v_files));
  return jsonb_build_object('scope', 'ALL_INTERNAL', 'conversations', v_convs, 'messages', v_msgs, 'files', v_list);
end $$;

-- the API removed purged files from storage (the Super Admin's own purge only)
create or replace function public.chat_purged_files_removed(p_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.profiles where id = private.my_id() and role = 'SUPER_ADMIN' and status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Only the Super Admin can do this.' using errcode = '42501';
  end if;
  update public.chat_attachments a set storage_removed_at = now()
    from public.chat_conversations c
   where c.id = a.conversation_id and c.kind in ('DIRECT', 'GROUP') and a.id = any (coalesce(p_ids, '{}')) and a.status = 'DELETED'
     and a.message_id is null and a.storage_removed_at is null;
end $$;

-- The chat list: a chat I cleared stays out of it until somebody writes again (20261108000100 + that one condition)
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
         and (m.inbox_cleared_seq is null or c.last_seq > m.inbox_cleared_seq)
       order by c.last_message_at desc nulls last limit 200) t
     where v_term is null or lower(coalesce(j ->> 'title', '')) like '%' || v_term || '%' or lower(coalesce(j ->> 'lastMessagePreview', '')) like '%' || v_term || '%'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['public.chat_message_react(uuid, text)', 'public.chat_reactions_for(uuid, uuid[])', 'public.chat_message_mention(uuid, uuid[])',
    'public.chat_inbox_clear()', 'public.chat_inbox_purge(text)', 'public.chat_purged_files_removed(uuid[])', 'public.chat_internal_list(text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
