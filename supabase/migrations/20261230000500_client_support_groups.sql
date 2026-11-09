-- =============================================================================
-- Client support groups and message status (Sent / Delivered / Seen). Run after 20261230000400. Safe to run again.
--
-- CLIENT SUPPORT GROUP. The customer's Relationship Manager conversation (kind CLIENT, channel RM: the client, the assigned Support Team Member
-- and Team Lead, decided live from the assignment) becomes a named group that can also hold other explicitly authorised Support employees:
--   * the client sees it where they already chat (Client Dashboard -> Live Chat); nothing new to open, nothing moved;
--   * extra members are chat_members rows of that conversation, added / removed only by the customer's assigned Support Team Lead, a Support
--     Department Head of the customer, or the Super Admin (client_support_group_save). The client can never add anyone;
--   * an extra member must be an ACTIVE Support employee of the customer's department at every moment (checked live in private.chat_access):
--     an employee who is moved, suspended or offboarded loses access at once, like the assigned team;
--   * every membership change is posted in the conversation as a system line and written to the audit log;
--   * sending, files, replies, realtime, search and history are the existing chat functions, unchanged.
--
-- MESSAGE STATUS. chat_read_state gains last_delivered_seq next to last_read_seq (one row per person and conversation):
--   * the receiving screen acknowledges what it has RECEIVED (chat_ack_delivered) and, as before, what it has READ (chat_mark_read);
--   * a message is Sent when the server stored it, Delivered when every current recipient's device acknowledged it, Seen when every recipient
--     read it (blue). Recipients = the people who can read the conversation and were in it when the message was sent, minus the sender;
--     reviewers do not count. chat_message_receipts gives the status of one's own messages with each recipient's state.
--   * acknowledgements only move forward (greatest), so several devices, reconnects and repeated realtime events change nothing twice;
--     a recipient who is offline never acknowledges, so the message stays "Sent" for them. A deleted message has no status.
--   * this is CRM delivery only; nothing here is a WhatsApp delivery or read status.
-- =============================================================================

alter table public.chat_conversations add column if not exists group_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'chat_conversations_group_name_check') then
    alter table public.chat_conversations add constraint chat_conversations_group_name_check
      check (group_name is null or (kind = 'CLIENT' and length(btrim(group_name)) between 1 and 80));
  end if;
end $$;
alter table public.chat_read_state add column if not exists last_delivered_seq bigint not null default 0;

-- ---------------------------------------------------------------------------
-- 1. Who may be in, and who manages, a client support group
-- ---------------------------------------------------------------------------
-- An active Support employee of the customer's department (the only people who can be added, and who stay in).
create or replace function private.client_group_eligible(p_customer uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.customers c on c.id = p_customer
     where p.id = p_profile and p.status = 'ACTIVE'
       and private.base_department(p.department_id) = private.base_department(c.department_id)
       and ((p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and exists (select 1 from public.teams t where t.id = p.team_id and t.division = 'SUPPORT'))
            or (p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and coalesce(p.head_division, 'SUPPORT') = 'SUPPORT')))
$$;
revoke all on function private.client_group_eligible(uuid, uuid) from public, anon, authenticated;

-- Is this profile an explicit, still-eligible member of this client conversation?
create or replace function private.client_group_member(p_conversation uuid, p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.chat_members m join public.chat_conversations c on c.id = m.conversation_id
     where m.conversation_id = p_conversation and m.profile_id = p_profile and m.left_at is null
       and c.kind = 'CLIENT' and c.channel = 'RM' and private.client_group_eligible(c.customer_id, p_profile))
$$;
revoke all on function private.client_group_member(uuid, uuid) from public, anon, authenticated;

create or replace function private.can_manage_client_group(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_id() is not null and (
       private.my_role() = 'SUPER_ADMIN'
    or private.my_id() = private.support_lead_of(p_customer)
    or exists (select 1 from public.profiles h join public.customers c on c.id = p_customer
                where h.id = private.my_id() and h.status = 'ACTIVE' and h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head
                  and coalesce(h.head_division, 'SUPPORT') = 'SUPPORT'
                  and private.head_covers(h.id, private.base_department(c.department_id), c.team_id)))
$$;
revoke all on function private.can_manage_client_group(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 2. Access and the staff list (copies of the latest definitions; the added Support employees of a client group are let in, live)
-- ---------------------------------------------------------------------------
-- (20261209000200) + an added, still-eligible Support employee writes in the Relationship Manager conversation once it is open

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
    elsif (me = private.support_member_of(c.customer_id) or me = private.support_lead_of(c.customer_id) or private.client_group_member(c.id, me))
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
end $$;

-- (20261223000300) + the client groups the person was added to, and the group name

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
        'hasLogin', t.has_login, 'role', t.role, 'groupName', t.group_name) as row
      from (
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name) as business, c.customer_code as code, 'RM'::text as channel,
               cv.id as conv_id, cv.last_message_at as sort_at, cv.last_message_preview as preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id) as has_login,
               case when me = private.support_member_of(c.id) then 'Relationship Manager' else 'Team Lead' end as role, cv.group_name
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
               'Meta Verifier', null::text
          from public.customers c
          join public.customer_onboarding o on o.customer_id = c.id and o.meta_verifier_id = me
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'META'
         where (c.department_id = private.my_department_id() or private.verifier_covers(me, c.department_id))
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        union all
        -- a client support group this person was added to (not assigned to the customer)
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name), c.customer_code, 'RM',
               cv.id, cv.last_message_at, cv.last_message_preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id),
               'Support group', cv.group_name
          from public.chat_conversations cv
          join public.customers c on c.id = cv.customer_id
         where cv.kind = 'CLIENT' and cv.channel = 'RM' and private.client_group_member(cv.id, me)
           and me is distinct from private.support_member_of(c.id) and me is distinct from private.support_lead_of(c.id)
           and private.meta_done(c.id)
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        order by sort_at desc nulls last, name limit 200) t) x), '[]'::jsonb);
end $$;


-- ---------------------------------------------------------------------------
-- 3. The group: read and manage (name, members). Never callable by a client.
-- ---------------------------------------------------------------------------
create or replace function private.client_group_json(p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'customerId', c.id, 'business', coalesce(nullif(btrim(c.company), ''), c.name),
    'conversationId', cv.id,
    'name', coalesce(cv.group_name, coalesce(nullif(btrim(c.company), ''), c.name) || ' - Support'),
    'named', cv.group_name is not null,
    'client', jsonb_build_object('hasLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id)),
    'assigned', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', x.role) order by x.ord)
                            from (values (private.support_member_of(c.id), 'Relationship Manager', 1), (private.support_lead_of(c.id), 'Team Lead', 2)) x (pid, role, ord)
                            join public.profiles p on p.id = x.pid), '[]'::jsonb),
    'members', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'addedAt', m.joined_at,
                                  'active', private.client_group_eligible(c.id, p.id)) order by p.full_name)
                           from public.chat_members m join public.profiles p on p.id = m.profile_id
                          where m.conversation_id = cv.id and m.left_at is null), '[]'::jsonb),
    'canManage', private.can_manage_client_group(c.id),
    -- the people who may be added (only to someone who manages the group)
    'candidates', case when private.can_manage_client_group(c.id) then coalesce((
        select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', (select t.name from public.teams t where t.id = p.team_id)) order by p.full_name)
          from public.profiles p
         where private.client_group_eligible(c.id, p.id)
           and p.id is distinct from private.support_member_of(c.id) and p.id is distinct from private.support_lead_of(c.id)
           and not exists (select 1 from public.chat_members m where m.conversation_id = cv.id and m.profile_id = p.id and m.left_at is null)), '[]'::jsonb) end)
    from public.customers c
    left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'RM'
   where c.id = p_customer
$$;
revoke all on function private.client_group_json(uuid) from public, anon, authenticated;

create or replace function public.client_support_group(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cv public.chat_conversations;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into cv from public.chat_conversations where kind = 'CLIENT' and customer_id = p_customer and channel = 'RM';
  -- whoever may manage it, or whoever is in it (assigned or added)
  -- an unknown customer, or one this person neither manages nor is in, is "not found" (coalesce: an unknown answer is a no)
  if not exists (select 1 from public.customers where id = p_customer)
     or not coalesce(private.can_manage_client_group(p_customer)
                     or private.my_id() = private.support_member_of(p_customer)
                     or private.my_id() = private.support_lead_of(p_customer)
                     or (cv.id is not null and private.client_group_member(cv.id, private.my_id())), false) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return private.client_group_json(p_customer);
end $$;
revoke all on function public.client_support_group(uuid) from public, anon;
grant execute on function public.client_support_group(uuid) to authenticated;

-- Name the group and add / remove Support employees. Each change is a system line in the conversation and an audit entry.
create or replace function public.client_support_group_save(p_customer uuid, p_name text, p_add uuid[], p_remove uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  cv public.chat_conversations;
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_id uuid;
  v_who text;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into c from public.customers where id = p_customer;
  if me.id is null or c.id is null or not private.can_manage_client_group(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not private.meta_done(p_customer) or c.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: The support group opens once Meta verification is completed.' using errcode = 'P0001';
  end if;
  if v_name is not null and length(v_name) > 80 then
    raise exception 'VALIDATION_ERROR: Keep the group name under 80 characters.' using errcode = 'P0001';
  end if;
  if coalesce(cardinality(p_add), 0) + coalesce(cardinality(p_remove), 0) > 50 then
    raise exception 'VALIDATION_ERROR: Too many changes at once.' using errcode = 'P0001';
  end if;
  cv := private.chat_ensure_client_conversation(p_customer, 'RM');
  perform 1 from public.chat_conversations where id = cv.id for update;     -- one change at a time
  if v_name is not null and v_name is distinct from cv.group_name then
    update public.chat_conversations set group_name = v_name, updated_at = now() where id = cv.id;
    perform private.chat_system_message(cv.id, format('%s named the group "%s"', me.full_name, v_name));
  end if;
  foreach v_id in array coalesce(p_add, '{}'::uuid[]) loop
    if not private.client_group_eligible(p_customer, v_id) then
      raise exception 'VALIDATION_ERROR: Only active Support employees of this customer''s department can be added.' using errcode = 'P0001';
    end if;
    if v_id in (private.support_member_of(p_customer), private.support_lead_of(p_customer))
       or exists (select 1 from public.chat_members m where m.conversation_id = cv.id and m.profile_id = v_id and m.left_at is null) then
      continue;                                       -- already in the group
    end if;
    insert into public.chat_members (conversation_id, profile_id, role, joined_at, visible_from_seq, left_at, removed_by)
    values (cv.id, v_id, 'MEMBER', now(), 0, null, null)
    on conflict (conversation_id, profile_id) do update set left_at = null, removed_by = null, joined_at = now();
    select full_name into v_who from public.profiles where id = v_id;
    perform private.chat_system_message(cv.id, format('%s added %s', me.full_name, v_who));
    perform private.write_audit('CLIENT_GROUP_MEMBER_ADDED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('member', v_id, 'conversation', cv.id));
    perform private.notify(v_id, 'CLIENT_GROUP_ADDED', format('Added to the support group of %s', coalesce(nullif(btrim(c.company), ''), c.name)),
      format('%s added you to the client''s support conversation.', me.full_name), 'chat', cv.id);
  end loop;
  foreach v_id in array coalesce(p_remove, '{}'::uuid[]) loop
    update public.chat_members set left_at = now(), removed_by = me.id where conversation_id = cv.id and profile_id = v_id and left_at is null;
    if found then
      select full_name into v_who from public.profiles where id = v_id;
      perform private.chat_system_message(cv.id, format('%s removed %s', me.full_name, v_who));
      perform private.write_audit('CLIENT_GROUP_MEMBER_REMOVED', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('member', v_id, 'conversation', cv.id));
    end if;
  end loop;
  return private.client_group_json(p_customer);
end $$;
revoke all on function public.client_support_group_save(uuid, text, uuid[], uuid[]) from public, anon;
grant execute on function public.client_support_group_save(uuid, text, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Delivered / Seen
-- ---------------------------------------------------------------------------
-- The receiving device says what it has received. Only forward; anyone who can read the conversation (a reviewer's ack is ignored in counts).
create or replace function public.chat_ack_delivered(p_conversation uuid, p_seq bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  v_seq bigint;
begin
  select * into c from public.chat_conversations where id = p_conversation;
  if c.id is null or private.chat_access(p_conversation) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  v_seq := least(greatest(coalesce(p_seq, 0), 0), c.last_seq);
  insert into public.chat_read_state (conversation_id, user_id, last_delivered_seq) values (c.id, auth.uid(), v_seq)
  on conflict (conversation_id, user_id) do update
    set last_delivered_seq = greatest(public.chat_read_state.last_delivered_seq, excluded.last_delivered_seq)
  where public.chat_read_state.last_delivered_seq < excluded.last_delivered_seq;
  -- the sender's screen listens to the conversation row: touch it so "delivered" shows without a reload
  if v_seq > 0 then
    update public.chat_conversations set updated_at = clock_timestamp() where id = c.id;
  end if;
  return jsonb_build_object('deliveredSeq', v_seq);
end $$;
revoke all on function public.chat_ack_delivered(uuid, bigint) from public, anon;
grant execute on function public.chat_ack_delivered(uuid, bigint) to authenticated;

-- The people a message in this conversation is for (now): auth user ids, with a name and a label. Reviewers are never recipients.
create or replace function private.chat_recipients(p_conversation uuid)
returns table (user_id uuid, name text, label text, from_seq bigint) language sql stable security definer set search_path = '' as $$
  with c as (select * from public.chat_conversations where id = p_conversation)
  -- a client conversation: the client login, the assigned staff of its channel, the added Support employees
  select a.auth_user_id, coalesce(nullif(btrim(cu.company), ''), cu.name), 'Client', 0::bigint
    from c join public.customer_client_accounts a on a.customer_id = c.customer_id join public.customers cu on cu.id = c.customer_id
   where c.kind = 'CLIENT' and a.auth_user_id is not null
  union
  select p.id, p.full_name, x.label, 0::bigint
    from c cross join lateral (values
          (case when c.channel = 'META' then private.meta_verifier_of(c.customer_id) else private.support_member_of(c.customer_id) end,
           case when c.channel = 'META' then 'Meta Verifier' else 'Relationship Manager' end),
          (case when c.channel = 'META' then null else private.support_lead_of(c.customer_id) end, 'Team Lead')) x (pid, label)
    join public.profiles p on p.id = x.pid
   where c.kind = 'CLIENT'
  union
  select p.id, p.full_name, 'Support', m.visible_from_seq
    from c join public.chat_members m on m.conversation_id = c.id and m.left_at is null join public.profiles p on p.id = m.profile_id
   where c.kind = 'CLIENT' and private.client_group_member(c.id, p.id)
  -- a direct chat or an internal group: its current members, each from the point they could see
  union
  select p.id, p.full_name, 'Member', m.visible_from_seq
    from c join public.chat_members m on m.conversation_id = c.id and m.left_at is null join public.profiles p on p.id = m.profile_id
   where c.kind in ('DIRECT', 'GROUP')
$$;
revoke all on function private.chat_recipients(uuid) from public, anon, authenticated;

-- The status of the signed-in person's own messages (newest 200 after p_after_seq), with each recipient's state.
create or replace function public.chat_message_receipts(p_conversation uuid, p_after_seq bigint default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
begin
  if me is null or private.chat_access(p_conversation) is null then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('seq', s.seq, 'messageId', s.id, 'status', s.status, 'recipients', s.recipients) order by s.seq)
      from (
        select m.id, m.seq, r.recipients,
               case when jsonb_array_length(r.recipients) = 0 then 'SENT'
                    when r.all_seen then 'SEEN' when r.all_delivered then 'DELIVERED' else 'SENT' end as status
          from (select * from public.chat_messages x
                 where x.conversation_id = p_conversation and x.sender_id = me and x.deleted_at is null and x.seq > coalesce(p_after_seq, 0)
                 order by x.seq desc limit 200) m
          cross join lateral (
            select coalesce(jsonb_agg(jsonb_build_object('name', rc.name, 'label', rc.label,
                                        'delivered', greatest(coalesce(rs.last_delivered_seq, 0), coalesce(rs.last_read_seq, 0)) >= m.seq,
                                        'seen', coalesce(rs.last_read_seq, 0) >= m.seq) order by rc.label, rc.name), '[]'::jsonb) as recipients,
                   coalesce(bool_and(greatest(coalesce(rs.last_delivered_seq, 0), coalesce(rs.last_read_seq, 0)) >= m.seq), false) as all_delivered,
                   coalesce(bool_and(coalesce(rs.last_read_seq, 0) >= m.seq), false) as all_seen
              from private.chat_recipients(p_conversation) rc
              left join public.chat_read_state rs on rs.conversation_id = p_conversation and rs.user_id = rc.user_id
             where rc.user_id <> me and rc.from_seq < m.seq) r) s), '[]'::jsonb);
end $$;
revoke all on function public.chat_message_receipts(uuid, bigint) from public, anon;
grant execute on function public.chat_message_receipts(uuid, bigint) to authenticated;


notify pgrst, 'reload schema';
