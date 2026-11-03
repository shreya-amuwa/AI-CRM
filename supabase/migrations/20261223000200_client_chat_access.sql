-- Client conversations: the assigned Team Member AND the assigned Team Member's own Team Lead reach them; the tab is always there for the people who can have clients.
--
-- WHAT WAS WRONG (read from the code)
--   * private.support_lead_of(customer) - used by private.chat_access, chat_my_clients and the unread badges - returned the hand-over Team Lead, and for a
--     customer without a hand-over record ONE Team Lead of the owner's team: `order by (p.id = c.owner_id) desc, p.created_at limit 1`. With two Team Leads on one team the
--     member's own lead could be the one that was left out, and the other lead (the earlier one) got the conversation of someone else's member.
--   * the "My clients" tab of ChatPage appeared only when chat_my_clients() returned a non-empty list; an empty list, a slow call or an error (the error was swallowed)
--     made the whole section disappear, so a Team Lead or Team Member with no customer YET (or a failed load) had no way in.
--   * assign_to_team_member checked "same team", so a lead could hand a client to another lead's member and the conversation then belonged to nobody's real lead.
-- WHAT THIS DOES (additive; no conversation, message or customer is touched)
--   1. support_lead_of: the hand-over lead, else the DIRECT lead of the customer's Team Member (20261223000100), else the old pick (a Team Lead who owns the customer).
--   2. assign_to_team_member: a Team Lead gives a client only to their own Team Members.
--   3. chat_client_tab(): the server says whether this person can have client conversations (Support Team Member / Team Lead, Meta Verifier, Technical Consultant)
--      and how many they have, so the screen shows the tab (with an empty state) for them and never hides it because a list was empty or failed.
--   4. chat_client_team / chat_escalate_client_message: an employee with access to the conversation shares a client message with the customer's Team Member,
--      Team Lead or Meta Verifier. The original conversation and message stay as they are; the person gets a notification that opens the conversation.
-- Run after 20261223000100_team_lead_ownership.sql. Safe to run again.

-- 1. The Team Lead of a customer
create or replace function private.support_lead_of(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.team_lead_id from public.customer_onboarding o where o.customer_id = p_customer and o.team_lead_id is not null),
    private.direct_lead_of(private.support_member_of(p_customer)),
    (select p.id from public.customers c join public.teams t on t.id = c.team_id and t.division = 'SUPPORT'
       join public.profiles p on p.team_id = t.id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
      where c.id = p_customer and private.support_member_of(p_customer) is not distinct from c.owner_id and c.owner_id = p.id
      limit 1))
$$;
revoke all on function private.support_lead_of(uuid) from public, anon, authenticated;

-- 2. A client goes to the lead's own member
create or replace function public.assign_to_team_member(p_customer uuid, p_member uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_lead_team uuid;
  v_name text;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not (private.is_super_admin() or o.team_lead_id = (select private.my_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if o.handover_stage not in ('TEAM_LEAD', 'TEAM_MEMBER') then
    raise exception 'CONFLICT: This customer has not been passed to a Team Lead yet.' using errcode = 'P0001';
  end if;
  select p.team_id into v_lead_team from public.profiles p
    join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
   where p.id = o.team_lead_id;
  if v_lead_team is null then
    raise exception 'CONFLICT: Only a Support Team Lead can assign this client.' using errcode = 'P0001';
  end if;
  if not (p_member = o.team_lead_id
          -- a Team Lead gives a client only to their OWN Team Members (the direct lead), not to another lead's people on the same team
          or exists (select 1 from public.profiles p where p.id = p_member and p.role = 'TEAM_MEMBER'
                      and p.status = 'ACTIVE' and p.team_id = v_lead_team and private.direct_lead_of(p.id) = o.team_lead_id)) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Member of your team.' using errcode = 'P0001';
  end if;
  if o.handover_stage = 'TEAM_MEMBER' and o.team_member_id = p_member then
    raise exception 'CONFLICT: The customer is already assigned to this person.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_MEMBER', team_member_id = p_member, assigned_to_member_at = now(),
         assigned_to_member_by = (select private.my_id()), handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  select full_name into v_name from public.profiles where id = p_member;
  perform private.log_customer_activity(p_customer, 'ASSIGNED_TO_TEAM_MEMBER',
    case when p_member = o.team_lead_id then format('Kept by Team Lead %s', v_name) else format('Assigned to %s', v_name) end
    || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_MEMBER', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_member', p_member, 'kept_by_lead', p_member = o.team_lead_id, 'note', v_note));
  perform private.notify(p_member, 'HANDOVER_TO_TEAM_MEMBER', format('New client assigned to you: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'Your Team Lead assigned this client to you.'), 'customer', p_customer);
end $$;
revoke all on function public.assign_to_team_member(uuid, uuid, text) from public, anon;
grant execute on function public.assign_to_team_member(uuid, uuid, text) to authenticated;

-- 3. Who can have client conversations (decided by the database, never by the screen)
create or replace function private.chat_client_eligible(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p left join public.teams t on t.id = p.team_id
     where p.id = p_profile and p.status = 'ACTIVE'
       and (p.is_meta_verifier or p.is_technical_consultant
            or (p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and t.division = 'SUPPORT')))
$$;
revoke all on function private.chat_client_eligible(uuid) from public, anon, authenticated;

create or replace function public.chat_client_tab()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_n integer := 0;
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  v_n := coalesce(jsonb_array_length(public.chat_my_clients(null)), 0);
  return jsonb_build_object('eligible', v_n > 0 or private.chat_client_eligible(me), 'count', v_n);
end $$;
revoke all on function public.chat_client_tab() from public, anon;
grant execute on function public.chat_client_tab() to authenticated;

-- 4. Sharing a client message with the people of that client's team
create or replace function public.chat_client_team(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  me uuid := private.my_id();
begin
  select * into c from public.chat_conversations where id = p_conversation and kind = 'CLIENT';
  if c.id is null or me is null or private.chat_access(c.id) is distinct from 'STAFF' then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', x.role) order by x.ord)
      from (select private.support_member_of(c.customer_id) as id, 'Team Member'::text as role, 1 as ord
            union all select private.support_lead_of(c.customer_id), 'Team Lead', 2
            union all select private.meta_verifier_of(c.customer_id), 'Meta Verifier', 3) x
      join public.profiles p on p.id = x.id and p.status = 'ACTIVE'
     where x.id is distinct from me), '[]'::jsonb);
end $$;
revoke all on function public.chat_client_team(uuid) from public, anon;
grant execute on function public.chat_client_team(uuid) to authenticated;

create or replace function public.chat_escalate_client_message(p_conversation uuid, p_message uuid, p_target uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.chat_conversations;
  cu public.customers;
  me public.profiles;
  m public.chat_messages;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_target_name text;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into c from public.chat_conversations where id = p_conversation and kind = 'CLIENT';
  if me.id is null or c.id is null or private.chat_access(c.id) is distinct from 'STAFF' then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  -- only the people of this client's team can be given it: its Team Member, its Team Lead, its Meta Verifier - never somebody else, never yourself
  if p_target is null or p_target = me.id or not exists (
       select 1 from jsonb_array_elements(public.chat_client_team(p_conversation)) t where (t ->> 'id')::uuid = p_target) then
    raise exception 'VALIDATION_ERROR: Choose the client''s Team Member, Team Lead or Meta Verifier.' using errcode = 'P0001';
  end if;
  if p_message is not null then
    select * into m from public.chat_messages where id = p_message and conversation_id = c.id;
    if m.id is null then
      raise exception 'NOT_FOUND: Message not found.' using errcode = 'P0001';
    end if;
  end if;
  select * into cu from public.customers where id = c.customer_id;
  select full_name into v_target_name from public.profiles where id = p_target;
  perform private.notify(p_target, 'CLIENT_MESSAGE_ESCALATED', left(format('%s shared a client message: %s', me.full_name, coalesce(cu.company, cu.name)), 200),
    left(coalesce(v_note || ' - ', '') || coalesce(left(m.body, 200), 'Open the conversation.'), 1000), 'chat', c.id);
  perform private.write_audit('CLIENT_MESSAGE_ESCALATED', 'customer', c.customer_id, cu.department_id, cu.team_id,
    jsonb_build_object('conversation', c.id, 'message', p_message, 'to', p_target));
  return jsonb_build_object('sentTo', v_target_name, 'conversationId', c.id);
end $$;
revoke all on function public.chat_escalate_client_message(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.chat_escalate_client_message(uuid, uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
