-- =============================================================================
-- Lead conversations: every customer interaction is its own timestamped record.
--
-- Root cause of "the note I typed while creating the lead is gone": create_lead()
-- has always stored it in customers.notes, but the lead details page never read
-- or showed that column, so the salesperson only ever saw it on the list API.
--
--   lead_conversations   one row per conversation (newest = "Last conversation").
--                        Rows are never deleted; an edit changes only that row.
--   source = 'LEAD_NOTE' the note typed when the lead was created. At most one
--                        per customer, so back-filling and re-runs never duplicate.
--
-- customers.notes is kept untouched (other screens still read it). Existing
-- leads with a note get that note as their first conversation.
-- Additive / idempotent.
-- =============================================================================

create table if not exists public.lead_conversations (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  note text not null check (length(btrim(note)) between 1 and 5000),
  source text not null default 'MANUAL' check (source in ('MANUAL', 'LEAD_NOTE')),
  occurred_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  edited_by uuid references public.profiles (id) on delete set null,
  edited_at timestamptz
);
create index if not exists lead_conversations_customer_idx on public.lead_conversations (customer_id, occurred_at desc, created_at desc);
create unique index if not exists lead_conversations_initial_note_key on public.lead_conversations (customer_id) where source = 'LEAD_NOTE';

-- Read: whoever may work on the customer (hierarchy rule). Writes: functions only.
alter table public.lead_conversations enable row level security;
revoke all on public.lead_conversations from anon, authenticated;
grant select on public.lead_conversations to authenticated;
drop policy if exists lead_conversations_select on public.lead_conversations;
create policy lead_conversations_select on public.lead_conversations for select to authenticated
  using (private.can_access_customer(customer_id));

-- ---------------------------------------------------------------------------
-- Note typed on the lead form → the initial conversation (idempotent)
-- ---------------------------------------------------------------------------
create or replace function private.sync_lead_note(p_customer uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_note is null or not private.can_access_customer(p_customer) then return; end if;
  insert into public.lead_conversations (customer_id, note, source, created_by)
  values (p_customer, left(v_note, 5000), 'LEAD_NOTE', (select private.my_id()))
  on conflict (customer_id) where source = 'LEAD_NOTE' do update
    set note = excluded.note, edited_by = (select private.my_id()), edited_at = now()
    where public.lead_conversations.note is distinct from excluded.note;
end $$;
revoke all on function private.sync_lead_note(uuid, text) from public, anon;
grant execute on function private.sync_lead_note(uuid, text) to authenticated;

create or replace function public.create_lead(p_fields jsonb, p_services text[])
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid;
begin
  if coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;
  insert into public.customers (
    owner_id, lifecycle_stage, lead_status, name, company, phone, whatsapp, email, city,
    business_category, lead_source, next_follow_up_at, expected_budget, notes)
  values (
    (p_fields ->> 'ownerId')::uuid, 'LEAD', coalesce(p_fields ->> 'leadStatus', 'NEW'),
    p_fields ->> 'name', p_fields ->> 'company', p_fields ->> 'phone', p_fields ->> 'whatsapp',
    p_fields ->> 'email', p_fields ->> 'city', p_fields ->> 'businessCategory', p_fields ->> 'leadSource',
    (p_fields ->> 'nextFollowUpAt')::timestamptz, (p_fields ->> 'expectedBudget')::numeric, p_fields ->> 'notes')
  returning id into v_id;
  perform private.set_customer_services(v_id, p_services);
  insert into public.customer_activities (customer_id, type, note)
  values (v_id, 'LEAD_CREATED', 'Lead added' || coalesce(' from ' || nullif(p_fields ->> 'leadSource', ''), ''));
  perform private.sync_lead_note(v_id, p_fields ->> 'notes');
  return v_id;
end $$;

-- update_lead: unchanged, except a changed "notes" field also updates the initial conversation.
create or replace function public.update_lead(p_id uuid, p_fields jsonb, p_services text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.customers;
  v_new public.customers;
begin
  select * into v_old from public.customers where id = p_id;
  if v_old.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_services is not null and coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;

  update public.customers set
    name = case when p_fields ? 'name' then p_fields ->> 'name' else name end,
    company = case when p_fields ? 'company' then p_fields ->> 'company' else company end,
    phone = case when p_fields ? 'phone' then p_fields ->> 'phone' else phone end,
    whatsapp = case when p_fields ? 'whatsapp' then p_fields ->> 'whatsapp' else whatsapp end,
    email = case when p_fields ? 'email' then p_fields ->> 'email' else email end,
    city = case when p_fields ? 'city' then p_fields ->> 'city' else city end,
    business_category = case when p_fields ? 'businessCategory' then p_fields ->> 'businessCategory' else business_category end,
    lead_source = case when p_fields ? 'leadSource' then p_fields ->> 'leadSource' else lead_source end,
    lead_status = case when p_fields ? 'leadStatus' then p_fields ->> 'leadStatus' else lead_status end,
    next_follow_up_at = case when p_fields ? 'nextFollowUpAt' then (p_fields ->> 'nextFollowUpAt')::timestamptz else next_follow_up_at end,
    expected_budget = case when p_fields ? 'expectedBudget' then (p_fields ->> 'expectedBudget')::numeric else expected_budget end,
    notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else notes end
  where id = p_id
  returning * into v_new;
  if v_new.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;

  perform private.set_customer_services(p_id, p_services);
  if p_fields ? 'notes' then
    perform private.sync_lead_note(p_id, p_fields ->> 'notes');
  end if;
  if v_new.lead_status is distinct from v_old.lead_status then
    insert into public.customer_activities (customer_id, type, note)
    values (p_id, 'STATUS_' || v_new.lead_status, coalesce(nullif(p_fields ->> 'activityNote', ''),
            'Status changed to ' || initcap(replace(v_new.lead_status, '_', ' '))));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Add / edit a conversation
-- ---------------------------------------------------------------------------
-- Author, or a team head / department head / super admin who may work on the customer.
create or replace function private.can_edit_conversation(p_customer uuid, p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_customer(p_customer)
     and (p_author = (select private.my_id()) or (select private.my_role()) in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD'))
$$;
revoke all on function private.can_edit_conversation(uuid, uuid) from public, anon;
grant execute on function private.can_edit_conversation(uuid, uuid) to authenticated;

create or replace function public.add_lead_conversation(p_customer uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v_note is null then
    raise exception 'VALIDATION_ERROR: Write what was discussed.' using errcode = 'P0001';
  end if;
  if length(v_note) > 5000 then
    raise exception 'VALIDATION_ERROR: Keep the conversation under 5000 characters.' using errcode = 'P0001';
  end if;
  insert into public.lead_conversations (customer_id, note, source, created_by)
  values (p_customer, v_note, 'MANUAL', (select private.my_id()))
  returning id into v_id;
  perform private.log_customer_activity(p_customer, 'CONVERSATION_ADDED', left(v_note, 200));
  perform private.write_audit('CONVERSATION_ADDED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('conversation_id', v_id));
  return v_id;
end $$;
revoke all on function public.add_lead_conversation(uuid, text) from public, anon;
grant execute on function public.add_lead_conversation(uuid, text) to authenticated;

create or replace function public.update_lead_conversation(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.lead_conversations;
  v public.customers;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into c from public.lead_conversations where id = p_id for update;
  if c.id is null or not private.can_access_customer(c.customer_id) then
    raise exception 'NOT_FOUND: Conversation not found.' using errcode = 'P0001';
  end if;
  if not private.can_edit_conversation(c.customer_id, c.created_by) then
    raise exception 'FORBIDDEN: You can only edit your own conversations.' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'VALIDATION_ERROR: Write what was discussed.' using errcode = 'P0001';
  end if;
  if length(v_note) > 5000 then
    raise exception 'VALIDATION_ERROR: Keep the conversation under 5000 characters.' using errcode = 'P0001';
  end if;
  if v_note = c.note then return; end if;
  select * into v from public.customers where id = c.customer_id;
  update public.lead_conversations set note = v_note, edited_by = (select private.my_id()), edited_at = now() where id = p_id;
  -- Keep the legacy column in step for the initial note only.
  if c.source = 'LEAD_NOTE' then
    update public.customers set notes = v_note where id = c.customer_id;
  end if;
  perform private.log_customer_activity(c.customer_id, 'CONVERSATION_EDITED', left(v_note, 200));
  perform private.write_audit('CONVERSATION_EDITED', 'customer', c.customer_id, v.department_id, v.team_id,
    jsonb_build_object('conversation_id', p_id));
end $$;
revoke all on function public.update_lead_conversation(uuid, text) from public, anon;
grant execute on function public.update_lead_conversation(uuid, text) to authenticated;

-- The history for one customer, newest first, with who recorded it and whether the caller may edit it.
create or replace function public.customer_conversations(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'note', c.note,
      'source', c.source,
      'occurredAt', c.occurred_at,
      'editedAt', c.edited_at,
      'author', case when a.id is null then null else jsonb_build_object('id', a.id, 'fullName', a.full_name) end,
      'canEdit', private.can_edit_conversation(c.customer_id, c.created_by))
      order by c.occurred_at desc, c.created_at desc)
    from public.lead_conversations c
    left join public.profiles a on a.id = c.created_by
    where c.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.customer_conversations(uuid) from public, anon;
grant execute on function public.customer_conversations(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Back-fill: older leads keep their note as the first conversation (no duplicates:
-- one LEAD_NOTE per customer, enforced by the unique index above).
-- ---------------------------------------------------------------------------
insert into public.lead_conversations (customer_id, note, source, occurred_at, created_by, created_at)
select c.id, left(btrim(c.notes), 5000), 'LEAD_NOTE', c.created_at, c.owner_id, c.created_at
  from public.customers c
 where nullif(btrim(coalesce(c.notes, '')), '') is not null
   and (c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING') or c.source_lead_id is not null)
on conflict (customer_id) where source = 'LEAD_NOTE' do nothing;
