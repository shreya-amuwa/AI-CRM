-- =============================================================================
-- Tickets: Relationship Manager first, then Team Lead, then Department Head.
--
-- Extends the existing ticket system (support_tickets / support_ticket_updates);
-- nothing outside tickets changes.
--
--  1. The customer's Relationship Manager (RM) is the Team Member the customer was
--     assigned to (customer_onboarding.team_member_id). A client ticket is assigned
--     to the RM (as before). Without an RM it starts with the Team Lead, and without
--     a Team Lead with the Department Head.
--  2. SLA: ticket_sla_settings holds how long the RM, then the Team Lead, may take
--     to answer the customer (one default row, optionally one row per department;
--     changed by the Super Admin / Department Head, never hard-coded in code).
--     The clock runs while the customer waits for an answer: from the ticket or the
--     customer's latest reply until Support replies, asks the customer something
--     (Waiting for Customer) or resolves the ticket.
--  3. Escalation: escalate_overdue_tickets() moves every overdue ticket one level up
--     (RM -> Team Lead -> Department Head). Run by pg_cron when available, by the
--     server's dispatch job, and when a ticket screen opens. Staff can also escalate
--     by hand (escalate_support_ticket / the existing "Escalate" status).
--     The RM stays the assignee: the ticket, its messages and the customer never
--     change; support_ticket_escalations keeps the audit trail.
--  4. Replies: the RM is told about every customer reply, and so is the Team Lead /
--     Department Head the ticket was escalated to. A staff reply tells the RM (when
--     someone else wrote it). The same message sent twice in a row is stored once,
--     and the same ticket submitted twice is created once.
--  5. The client reads their own notifications live (Realtime, own rows only) and
--     sees their Relationship Manager and whether the ticket was escalated.
--  6. Managers watch without becoming the owner: viewing never assigns.
-- Additive / idempotent. Run the whole file at once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings and new columns
-- ---------------------------------------------------------------------------
create table if not exists public.ticket_sla_settings (
  id uuid primary key default gen_random_uuid(),
  department_id uuid references public.departments (id) on delete cascade,  -- null = the default for every department
  rm_response_minutes integer not null check (rm_response_minutes between 5 and 43200),
  tl_response_minutes integer not null check (tl_response_minutes between 5 and 43200),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
create unique index if not exists ticket_sla_settings_department_key
  on public.ticket_sla_settings (coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- The starting default (24 hours per level, the same 24-hour response promise the app already uses).
-- Change it from the Tickets page (SLA settings); re-running this file never overwrites a saved value.
insert into public.ticket_sla_settings (department_id, rm_response_minutes, tl_response_minutes)
select null, 1440, 1440
 where not exists (select 1 from public.ticket_sla_settings where department_id is null);

alter table public.ticket_sla_settings enable row level security;
revoke all on public.ticket_sla_settings from public, anon, authenticated;

alter table public.support_tickets
  add column if not exists escalation_level text not null default 'RM',
  add column if not exists escalated_to uuid references public.profiles (id) on delete set null,
  add column if not exists sla_due_at timestamptz,
  add column if not exists first_response_at timestamptz,
  add column if not exists last_client_message_at timestamptz,
  add column if not exists last_staff_reply_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles (id) on delete set null;
alter table public.support_tickets drop constraint if exists support_tickets_escalation_level_check;
alter table public.support_tickets add constraint support_tickets_escalation_level_check check (escalation_level in ('RM', 'TL', 'DH'));
create index if not exists support_tickets_sla_due_idx on public.support_tickets (sla_due_at) where sla_due_at is not null;
create index if not exists support_tickets_escalated_to_idx on public.support_tickets (escalated_to) where escalated_to is not null;

-- Existing records: escalated tickets sit with the Team Lead; who resolved a ticket comes from its history.
-- (No SLA clock is started for old tickets, so nothing escalates the moment this file runs.)
update public.support_tickets set escalation_level = 'TL' where status = 'ESCALATED' and escalation_level = 'RM';
update public.support_tickets t
   set resolved_by = (select u.author_id from public.support_ticket_updates u
                       where u.ticket_id = t.id and u.to_status in ('RESOLVED', 'CLOSED') and u.author_id is not null
                       order by u.created_at desc limit 1)
 where t.status in ('RESOLVED', 'CLOSED') and t.resolved_by is null;
update public.support_tickets t
   set last_client_message_at = (select max(u.created_at) from public.support_ticket_updates u where u.ticket_id = t.id and u.client_author and u.kind in ('CREATED', 'CLIENT_REPLY'))
 where t.created_by is null and t.last_client_message_at is null;
update public.support_tickets t
   set last_staff_reply_at = (select max(u.created_at) from public.support_ticket_updates u where u.ticket_id = t.id and u.kind = 'NOTE' and u.client_visible),
       first_response_at = (select min(u.created_at) from public.support_ticket_updates u where u.ticket_id = t.id and u.kind = 'NOTE' and u.client_visible)
 where t.created_by is null and t.last_staff_reply_at is null;

-- The audit trail of every hand-over to a higher level.
create table if not exists public.support_ticket_escalations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  from_level text not null check (from_level in ('RM', 'TL', 'DH')),
  to_level text not null check (to_level in ('RM', 'TL', 'DH')),
  from_user uuid references public.profiles (id) on delete set null,
  to_user uuid references public.profiles (id) on delete set null,
  reason text not null check (reason in ('SLA', 'MANUAL')),
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (length(note) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_escalations_ticket_idx on public.support_ticket_escalations (ticket_id, created_at);
alter table public.support_ticket_escalations enable row level security;
revoke all on public.support_ticket_escalations from public, anon, authenticated;
grant select on public.support_ticket_escalations to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who may see a ticket: as before, plus the person it was escalated to
-- ---------------------------------------------------------------------------
create or replace function private.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket and (
      t.assignee_id = private.my_id() or t.created_by = private.my_id() or t.escalated_to = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and t.team_id = private.my_team_id())))
$$;
grant execute on function private.can_view_ticket(uuid) to authenticated;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (
    assignee_id = (select private.my_id()) or created_by = (select private.my_id()) or escalated_to = (select private.my_id())
    or (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id())));

drop policy if exists support_ticket_escalations_select on public.support_ticket_escalations;
create policy support_ticket_escalations_select on public.support_ticket_escalations for select to authenticated
  using ((select private.may_work_in_support()) and private.can_view_ticket(ticket_id));

-- ---------------------------------------------------------------------------
-- 3. Helpers: SLA, the Team Lead and Department Head of a ticket
-- ---------------------------------------------------------------------------
-- Minutes the given level has to answer (null: the Department Head is the last level).
create or replace function private.ticket_sla_minutes(p_department uuid, p_level text)
returns integer language sql stable security definer set search_path = '' as $$
  select case p_level when 'RM' then s.rm_response_minutes when 'TL' then s.tl_response_minutes end
    from public.ticket_sla_settings s
   where s.department_id = p_department or s.department_id is null
   order by s.department_id is null limit 1
$$;
revoke all on function private.ticket_sla_minutes(uuid, text) from public, anon, authenticated;

create or replace function private.ticket_sla_due(p_department uuid, p_level text, p_from timestamptz default now())
returns timestamptz language sql stable security definer set search_path = '' as $$
  select p_from + make_interval(mins => m) from (select private.ticket_sla_minutes(p_department, p_level) as m) x where m is not null
$$;
revoke all on function private.ticket_sla_due(uuid, text, timestamptz) from public, anon, authenticated;

-- The Team Lead of a ticket: the lead the customer was passed to, else the lead of the ticket's team.
create or replace function private.ticket_team_lead(p_ticket uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id
    from public.support_tickets t
    join public.profiles p on p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
     and (p.id = (select o.team_lead_id from public.customer_onboarding o where o.customer_id = t.customer_id)
          or p.team_id = t.team_id
          or p.team_id = (select a.team_id from public.profiles a where a.id = t.assignee_id))
   where t.id = p_ticket
   order by (p.id = (select o.team_lead_id from public.customer_onboarding o where o.customer_id = t.customer_id)) desc,
            (p.team_id = t.team_id) desc, p.created_at, p.id
   limit 1
$$;
revoke all on function private.ticket_team_lead(uuid) from public, anon, authenticated;

create or replace function private.ticket_department_head(p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.department_id = p_department
   order by p.created_at, p.id limit 1
$$;
revoke all on function private.ticket_department_head(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. New client tickets: the SLA clock starts; no RM -> Team Lead -> Department Head
-- ---------------------------------------------------------------------------
create or replace function private.tg_support_tickets_hierarchy()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_lead uuid;
begin
  -- Only tickets the customer raised run on the response SLA (staff tickets are escalated by hand).
  if new.created_by is not null then
    return new;
  end if;
  new.last_client_message_at := coalesce(new.last_client_message_at, new.created_at, now());
  if new.assignee_id is null and new.escalation_level = 'RM' then
    select p.id into v_lead from public.profiles p
     where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
       and (p.id = (select o.team_lead_id from public.customer_onboarding o where o.customer_id = new.customer_id) or p.team_id = new.team_id)
     order by (p.id = (select o.team_lead_id from public.customer_onboarding o where o.customer_id = new.customer_id)) desc, p.created_at, p.id
     limit 1;
    if v_lead is not null then
      new.escalation_level := 'TL';
      new.escalated_to := v_lead;
    elsif private.ticket_department_head(new.department_id) is not null then
      new.escalation_level := 'DH';
      new.escalated_to := private.ticket_department_head(new.department_id);
    end if;
  end if;
  if new.status not in ('RESOLVED', 'CLOSED', 'WAITING_CUSTOMER') then
    new.sla_due_at := coalesce(new.sla_due_at, private.ticket_sla_due(new.department_id, new.escalation_level));
  end if;
  return new;
end $$;
revoke all on function private.tg_support_tickets_hierarchy() from public, anon, authenticated;
drop trigger if exists support_tickets_hierarchy on public.support_tickets;
create trigger support_tickets_hierarchy before insert on public.support_tickets
  for each row execute function private.tg_support_tickets_hierarchy();

-- ---------------------------------------------------------------------------
-- 5. The SLA clock follows the conversation (one place, whichever function wrote it)
-- ---------------------------------------------------------------------------
create or replace function private.tg_support_ticket_updates_clock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = new.ticket_id;
  if t.id is null then
    return null;
  end if;

  -- Resolved / closed: remember who did it; a reopened ticket forgets it.
  if new.kind = 'STATUS_CHANGED' and new.to_status in ('RESOLVED', 'CLOSED') and not new.client_author then
    update public.support_tickets set resolved_by = coalesce(new.author_id, resolved_by), sla_due_at = null where id = t.id;
  elsif new.kind = 'STATUS_CHANGED' and new.to_status not in ('RESOLVED', 'CLOSED') and new.from_status in ('RESOLVED', 'CLOSED') then
    update public.support_tickets set resolved_by = null where id = t.id;
  end if;

  if t.created_by is not null then
    return null;  -- staff tickets: no customer waiting, no clock
  end if;

  if new.client_author and new.kind = 'CLIENT_REPLY' then
    -- The customer is waiting again: restart the clock for whoever handles the ticket now.
    update public.support_tickets
       set last_client_message_at = new.created_at,
           sla_due_at = case when status in ('RESOLVED', 'CLOSED') then null
                             else coalesce(sla_due_at, private.ticket_sla_due(department_id, escalation_level, new.created_at)) end
     where id = t.id;
  elsif new.client_author and new.kind = 'STATUS_CHANGED' and new.to_status = 'OPEN' then
    update public.support_tickets
       set sla_due_at = coalesce(sla_due_at, private.ticket_sla_due(department_id, escalation_level, new.created_at))
     where id = t.id;
  elsif not new.client_author and new.kind = 'NOTE' and new.client_visible then
    -- Support answered the customer.
    update public.support_tickets
       set last_staff_reply_at = new.created_at, first_response_at = coalesce(first_response_at, new.created_at), sla_due_at = null
     where id = t.id;
  elsif not new.client_author and new.kind = 'STATUS_CHANGED' and new.to_status = 'WAITING_CUSTOMER' then
    update public.support_tickets set first_response_at = coalesce(first_response_at, new.created_at), sla_due_at = null where id = t.id;
  elsif not new.client_author and new.kind = 'STATUS_CHANGED' and new.to_status in ('OPEN', 'IN_PROGRESS', 'ESCALATED')
        and new.from_status in ('WAITING_CUSTOMER', 'RESOLVED', 'CLOSED')
        and t.last_client_message_at > coalesce(t.last_staff_reply_at, '-infinity'::timestamptz) then
    -- Support reopened a ticket the customer is still waiting on.
    update public.support_tickets set sla_due_at = coalesce(sla_due_at, private.ticket_sla_due(department_id, escalation_level)) where id = t.id;
  end if;
  return null;
end $$;
revoke all on function private.tg_support_ticket_updates_clock() from public, anon, authenticated;
drop trigger if exists support_ticket_updates_clock on public.support_ticket_updates;
create trigger support_ticket_updates_clock after insert on public.support_ticket_updates
  for each row execute function private.tg_support_ticket_updates_clock();

-- ---------------------------------------------------------------------------
-- 6. Escalation (one level at a time)
-- ---------------------------------------------------------------------------
-- p_actor null = the SLA job. Returns false when there is no higher level.
create or replace function private.escalate_ticket(p_ticket uuid, p_reason text, p_actor uuid, p_note text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
  c public.customers;
  v_from_user uuid;
  v_to_level text;
  v_to_user uuid;
  v_label text;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 4000);
  v_text text;
  v_recipient uuid;
begin
  select * into t from public.support_tickets where id = p_ticket for update;
  if t.id is null or t.status in ('RESOLVED', 'CLOSED') or t.escalation_level = 'DH' then
    return false;
  end if;
  select * into c from public.customers where id = t.customer_id;
  v_from_user := case when t.escalation_level = 'RM' then t.assignee_id else t.escalated_to end;

  if t.escalation_level = 'RM' then
    v_to_user := private.ticket_team_lead(t.id);
    v_to_level := case when v_to_user is not null then 'TL' else 'DH' end;
  else
    v_to_level := 'DH';
  end if;
  if v_to_level = 'DH' then
    v_to_user := private.ticket_department_head(t.department_id);
  end if;
  if v_to_user is null then
    return false;  -- nobody above: keep the ticket where it is
  end if;
  v_label := case v_to_level when 'TL' then 'Team Lead' else 'Department Head' end;
  v_text := format('Escalated to %s %s%s', v_label, (select full_name from public.profiles where id = v_to_user),
                   case when p_reason = 'SLA' then ' (no reply within the SLA)' else '' end);

  update public.support_tickets
     set escalation_level = v_to_level,
         escalated_to = v_to_user,
         status = 'ESCALATED',
         escalated_at = now(),
         escalated_by = p_actor,
         -- the next level gets its own time to answer when the customer is still waiting
         sla_due_at = case when t.created_by is null and (t.sla_due_at is not null or p_reason = 'SLA'
                                or t.last_client_message_at > coalesce(t.last_staff_reply_at, '-infinity'::timestamptz))
                           then private.ticket_sla_due(t.department_id, v_to_level) end
   where id = t.id;

  insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, assignee_id, note)
  values (t.id, p_actor, 'ESCALATED', t.status, 'ESCALATED', v_to_user, coalesce(v_text || ': ' || v_note, v_text));
  insert into public.support_ticket_escalations (ticket_id, from_level, to_level, from_user, to_user, reason, actor_id, note)
  values (t.id, t.escalation_level, v_to_level, v_from_user, v_to_user, p_reason, p_actor, v_note);
  perform private.write_audit('TICKET_ESCALATED', 'support_ticket', t.id, t.department_id, t.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from_level', t.escalation_level, 'to_level', v_to_level,
                       'from_user', v_from_user, 'to_user', v_to_user, 'reason', p_reason));

  -- The new owner (urgent), the RM and the previous level (kept informed), the Department Head (watching).
  for v_recipient in
    select distinct r from (
      select unnest(array[v_to_user, t.assignee_id, v_from_user, private.ticket_department_head(t.department_id)]) r
      union all  -- every lead of the ticket's team keeps watching it, as before
      select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id = t.team_id) x
     where r is not null and r is distinct from p_actor
  loop
    -- written directly: an SLA escalation must reach the RM even when the sweep ran from the RM's own screen
    insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
    values (v_recipient, 'TICKET_ESCALATED',
      case when v_recipient = v_to_user then format('Escalated to you: %s %s', t.ticket_no, t.subject)
           else format('Escalated: %s %s', t.ticket_no, t.subject) end,
      format('%s · %s', c.name, coalesce(v_note, v_text)), 'support_ticket', t.id, p_actor,
      jsonb_build_object('level', v_to_level, 'reason', p_reason),
      case when v_recipient = v_to_user then 'urgent' else 'normal' end);
  end loop;
  if t.created_by is null then
    perform private.client_notify(t.customer_id, 'TICKET_ESCALATED', format('Ticket %s was escalated', t.ticket_no),
      'A senior member of our team is now looking after your ticket.', 'ticket', t.id, format('TKT|esc|%s|%s', t.id, v_to_level));
  end if;
  return true;
end $$;
revoke all on function private.escalate_ticket(uuid, text, uuid, text) from public, anon, authenticated;

-- Escalate by hand: the RM (assignee), the current owner, the ticket's Team Lead, the Super Admin.
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
  if not private.escalate_ticket(t.id, 'MANUAL', me.id, p_note) then
    raise exception 'CONFLICT: There is nobody above to escalate this ticket to.' using errcode = 'P0001';
  end if;
  select * into t from public.support_tickets where id = p_ticket;
  return jsonb_build_object('id', t.id, 'escalationLevel', t.escalation_level, 'escalatedTo', t.escalated_to, 'slaDueAt', t.sla_due_at);
end $$;
revoke all on function public.escalate_support_ticket(uuid, text) from public, anon;
grant execute on function public.escalate_support_ticket(uuid, text) to authenticated;

-- Every ticket whose time is up moves one level. Safe to call any time, from anywhere:
-- it only acts on tickets that are really overdue, and two runs never escalate one ticket twice.
create or replace function public.escalate_overdue_tickets()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  n integer := 0;
begin
  if auth.uid() is not null and not exists (
       select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE'
          and (p.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') or private.is_support_staff())) then
    return 0;
  end if;
  for v_id in
    select t.id from public.support_tickets t
     where t.sla_due_at <= now() and t.escalation_level <> 'DH'
       and t.status in ('OPEN', 'IN_PROGRESS', 'ESCALATED')
     order by t.sla_due_at
     limit 200
     for update skip locked
  loop
    if private.escalate_ticket(v_id, 'SLA', null, null) then
      n := n + 1;
    else
      -- nobody above (e.g. no Department Head yet): stop the clock instead of retrying every run
      update public.support_tickets set sla_due_at = null where id = v_id;
    end if;
  end loop;
  return n;
end $$;
revoke all on function public.escalate_overdue_tickets() from public, anon;
grant execute on function public.escalate_overdue_tickets() to authenticated, service_role;

-- The existing "Escalated" status moves the ticket up the same way (and keeps the notes / notifications).
create or replace function public.update_support_ticket(
  p_ticket uuid, p_status text, p_note text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
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
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
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
        (role = 'TEAM_HEAD' and team_id = t.team_id)
        or (p_status = 'ESCALATED' and v_changed and role = 'DEPARTMENT_HEAD' and department_id = t.department_id))
    loop
      perform private.notify(v_recipient, case when p_status = 'ESCALATED' and v_changed then 'TICKET_ESCALATED' else 'TICKET_UPDATE' end,
        case when p_status = 'ESCALATED' and v_changed then format('Escalated: %s %s', t.ticket_no, t.subject)
             else format('%s: %s', me.full_name, format('%s is now %s', t.ticket_no, replace(lower(p_status), '_', ' '))) end,
        coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id, '{}'::jsonb,
        case when p_status = 'ESCALATED' then 'urgent' else 'normal' end);
    end loop;
  end if;
end $$;
revoke all on function public.update_support_ticket(uuid, text, text, text) from public, anon;
grant execute on function public.update_support_ticket(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Replies
-- ---------------------------------------------------------------------------
-- Staff reply the client reads. The same text sent again within two minutes is stored once.
create or replace function public.reply_to_client_ticket(p_ticket uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  v_msg text := left(nullif(btrim(coalesce(p_message, '')), ''), 4000);
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null then
    raise exception 'VALIDATION_ERROR: Write the reply for the customer.' using errcode = 'P0001';
  end if;
  if t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.support_ticket_updates u
              where u.ticket_id = t.id and u.author_id = me.id and u.kind = 'NOTE' and u.client_visible
                and u.note = v_msg and u.created_at > now() - interval '2 minutes') then
    return;  -- a double click / resend: already delivered
  end if;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_visible) values (t.id, me.id, 'NOTE', v_msg, true);
  update public.support_tickets set updated_at = now() where id = t.id;
  perform private.write_audit('TICKET_REPLIED_TO_CLIENT', 'support_ticket', t.id, t.department_id, t.team_id, jsonb_build_object('ticket_no', t.ticket_no));
  -- The RM stays informed when a Team Lead / Department Head answers, and the current owner when someone else does.
  for v_recipient in
    select distinct r from unnest(array[t.assignee_id, t.escalated_to]) r where r is not null and r <> me.id
  loop
    perform private.notify(v_recipient, 'TICKET_STAFF_REPLY', format('%s replied to the customer on %s', me.full_name, t.ticket_no),
      left(v_msg, 300), 'support_ticket', t.id);
  end loop;
end $$;
revoke all on function public.reply_to_client_ticket(uuid, text) from public, anon;
grant execute on function public.reply_to_client_ticket(uuid, text) to authenticated;

-- Client reply: reaches the RM, the person it was escalated to and the team lead(s). Resends are stored once.
create or replace function public.client_reply_ticket(p_ticket uuid, p_message text)
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
    raise exception 'VALIDATION_ERROR: Write your reply (up to 4000 characters).' using errcode = 'P0001';
  end if;
  if t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed. Please raise a new ticket.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.support_ticket_updates u
              where u.ticket_id = t.id and u.client_author and u.kind = 'CLIENT_REPLY'
                and u.note = v_msg and u.created_at > now() - interval '2 minutes') then
    return public.client_ticket(t.id);  -- the same message again (double click, retry): already sent
  end if;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author)
  values (t.id, null, 'CLIENT_REPLY', v_msg, true);
  -- a reply on a resolved ticket, or one waiting for the client, goes back to Support
  if t.status in ('RESOLVED', 'WAITING_CUSTOMER') then
    update public.support_tickets set status = 'OPEN', resolved_at = null where id = t.id;
    insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, client_author)
    values (t.id, null, 'STATUS_CHANGED', t.status, 'OPEN', true);
  else
    update public.support_tickets set updated_at = now() where id = t.id;
  end if;
  perform private.notify(r.id, 'TICKET_CLIENT_REPLY', format('Client replied on %s', t.ticket_no), left(v_msg, 300), 'support_ticket', t.id,
                         '{}'::jsonb, case when r.id = coalesce(t.escalated_to, t.assignee_id) then 'urgent' else 'normal' end)
    from (select p.id from public.profiles p
           where p.status = 'ACTIVE'
             and (p.id = t.assignee_id or p.id = t.escalated_to or (p.role = 'TEAM_HEAD' and p.team_id = t.team_id))) r;
  return public.client_ticket(t.id);
end $$;

-- Client: the same ticket submitted twice (double click, retry) is created once.
create or replace function public.client_create_ticket(p_subject text, p_description text, p_category text default 'GENERAL', p_service text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  t public.support_tickets;
  v_team uuid;
  v_assignee uuid;
  v_lead uuid;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a subject (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if v_desc is null or length(v_desc) < 5 or length(v_desc) > 4000 then
    raise exception 'VALIDATION_ERROR: Describe the problem (5 to 4000 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = p_service) then
    raise exception 'VALIDATION_ERROR: Choose one of your own services.' using errcode = 'P0001';
  end if;
  -- one request at a time per customer, so two identical submissions cannot both pass the check below
  perform pg_advisory_xact_lock(hashtextextended('client_ticket:' || v_customer::text, 0));
  select * into t from public.support_tickets x
   where x.customer_id = v_customer and x.created_by is null and x.subject = v_subject and x.description = v_desc
     and x.status not in ('RESOLVED', 'CLOSED') and x.created_at > now() - interval '10 minutes'
   order by x.created_at desc limit 1;
  if t.id is not null then
    return private.client_ticket_json(t);
  end if;
  if (select count(*) from public.support_tickets x where x.customer_id = v_customer and x.created_at > now() - interval '1 day') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many tickets today. Please reply to an open ticket or try again tomorrow.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select o.o_team, o.o_assignee, o.o_lead into v_team, v_assignee, v_lead from private.client_ticket_owner(v_customer) o;
  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority, service_code, created_by, assignee_id)
  values (v_customer, c.department_id, v_team, v_subject, v_desc, coalesce(p_category, 'GENERAL'), 'MEDIUM', p_service, null, v_assignee)
  returning * into t;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, note, client_author)
  values (t.id, null, 'CREATED', 'OPEN', v_desc, true);
  if v_assignee is not null then
    insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author, assignee_id)
    values (t.id, null, 'ASSIGNED', 'Assigned to ' || (select full_name from public.profiles where id = v_assignee) || ' (the client''s Relationship Manager)', false, v_assignee);
  elsif t.escalated_to is not null then
    insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author, assignee_id)
    values (t.id, null, 'ASSIGNED', format('No Relationship Manager yet: with %s %s',
              case t.escalation_level when 'TL' then 'Team Lead' else 'Department Head' end,
              (select full_name from public.profiles where id = t.escalated_to)), false, t.escalated_to);
  end if;
  perform private.client_notify(v_customer, 'TICKET_CREATED', format('Ticket %s created', t.ticket_no), v_subject, 'ticket', t.id, format('TKT|created|%s', t.id));
  perform private.log_customer_activity(v_customer, 'CLIENT_TICKET', format('Client raised ticket %s: %s', t.ticket_no, v_subject));
  perform private.write_audit('CLIENT_TICKET_CREATED', 'support_ticket', t.id, c.department_id, v_team,
    jsonb_build_object('ticket_no', t.ticket_no, 'customer_id', v_customer, 'assignee', v_assignee, 'level', t.escalation_level));
  -- the RM, their lead (or the team's leads while nobody is assigned), whoever it starts with, and the Department Head
  perform private.notify(r.id, 'TICKET_FROM_CLIENT', format('New client ticket %s: %s', t.ticket_no, v_subject), left(v_desc, 300), 'support_ticket', t.id)
    from (select v_assignee as id where v_assignee is not null
          union
          select t.escalated_to where t.escalated_to is not null
          union
          select p.id from public.profiles p
           where p.status = 'ACTIVE'
             and ((p.role = 'TEAM_HEAD' and (p.id = v_lead or (v_lead is null and p.team_id = v_team)))
                  or (p.role = 'DEPARTMENT_HEAD' and p.department_id = c.department_id))) r;
  return private.client_ticket_json(t);
end $$;

-- When the client gets their RM later, unassigned open tickets follow; one that only sat with the
-- Team Lead for lack of an RM (never escalated) goes back to the RM's level.
create or replace function private.trg_assign_client_tickets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  o record;
begin
  select * into o from private.client_ticket_owner(new.customer_id);
  if o.o_assignee is not null then
    update public.support_tickets s
       set assignee_id = o.o_assignee, team_id = coalesce(o.o_team, s.team_id), updated_at = now(),
           escalation_level = case when not exists (select 1 from public.support_ticket_escalations e where e.ticket_id = s.id) then 'RM' else s.escalation_level end,
           escalated_to = case when not exists (select 1 from public.support_ticket_escalations e where e.ticket_id = s.id) then null else s.escalated_to end,
           sla_due_at = case when s.sla_due_at is not null and not exists (select 1 from public.support_ticket_escalations e where e.ticket_id = s.id)
                             then private.ticket_sla_due(s.department_id, 'RM') else s.sla_due_at end
     where s.customer_id = new.customer_id and s.created_by is null and s.assignee_id is null
       and s.status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED');
  end if;
  return null;
end $$;
revoke all on function private.trg_assign_client_tickets() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. What the client sees: their RM, whether it was escalated, unread replies
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
    'unread', (select count(*) from public.client_notifications n
                where n.customer_id = t.customer_id and n.entity_type = 'ticket' and n.entity_id = t.id and n.read_at is null
                  and n.type in ('TICKET_REPLY', 'TICKET_STATUS', 'TICKET_ESCALATED')),
    'lastReplyAt', t.last_staff_reply_at,
    'createdAt', t.created_at, 'updatedAt', t.updated_at)
$$;
revoke all on function private.client_ticket_json(public.support_tickets) from public, anon, authenticated;

create or replace function public.client_ticket(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket and customer_id = v_customer;
  if t.id is null then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  return private.client_ticket_json(t) || jsonb_build_object('updates', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'at', u.created_at,
      'type', case when u.client_author then 'CLIENT' when u.kind in ('STATUS_CHANGED', 'ESCALATED') then 'STATUS' else 'SUPPORT' end,
      'status', u.to_status,
      -- staff notes stay internal unless written for the client
      'message', case when u.client_author or (u.kind = 'NOTE' and u.client_visible) then u.note
                      when u.kind = 'ESCALATED' then 'Escalated to a senior member of our team' end,
      'author', case when u.kind = 'NOTE' and u.client_visible then (select p.full_name from public.profiles p where p.id = u.author_id) end)
      order by u.created_at, u.id)
      from public.support_ticket_updates u
     where u.ticket_id = t.id
       -- the opening message is the ticket's description (shown once, not again as an update)
       and u.kind <> 'CREATED'
       and (u.client_author or u.kind = 'STATUS_CHANGED' or (u.kind = 'NOTE' and u.client_visible)
            or (u.kind = 'ESCALATED' and exists (select 1 from public.support_ticket_escalations e where e.ticket_id = t.id)))), '[]'::jsonb));
end $$;

-- The client opened the ticket: its notifications are read.
create or replace function public.client_ticket_seen(p_ticket uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_n integer;
begin
  if not exists (select 1 from public.support_tickets t where t.id = p_ticket and t.customer_id = v_customer) then
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
  foreach f in array array['client_ticket(uuid)', 'client_create_ticket(text, text, text, text)', 'client_reply_ticket(uuid, text)', 'client_ticket_seen(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- A client may read (only) their own notifications directly, so their dashboard hears new replies through
-- Realtime instead of asking again and again. Writes still go through the functions only.
grant execute on function private.my_client_customer() to authenticated;
grant select on public.client_notifications to authenticated;
drop policy if exists client_notifications_select_own on public.client_notifications;
create policy client_notifications_select_own on public.client_notifications for select to authenticated
  using (customer_id = (select private.my_client_customer()));

-- ---------------------------------------------------------------------------
-- 9. SLA settings (Super Admin: the default and any department; Department Head: their own department)
-- ---------------------------------------------------------------------------
create or replace function public.ticket_sla_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  s public.ticket_sla_settings;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or not (me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') or private.is_support_staff()) then
    raise exception 'FORBIDDEN: Only Support staff can see the ticket SLA.' using errcode = '42501';
  end if;
  select * into s from public.ticket_sla_settings x
   where (me.role <> 'SUPER_ADMIN' and x.department_id = me.department_id) or x.department_id is null
   order by x.department_id is null limit 1;
  return jsonb_build_object('rmMinutes', s.rm_response_minutes, 'tlMinutes', s.tl_response_minutes,
    'scope', case when s.department_id is null then 'DEFAULT' else 'DEPARTMENT' end,
    'canEdit', me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD'), 'updatedAt', s.updated_at);
end $$;
revoke all on function public.ticket_sla_settings() from public, anon;
grant execute on function public.ticket_sla_settings() to authenticated;

create or replace function public.set_ticket_sla(p_rm_minutes integer, p_tl_minutes integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Department Head or the Super Admin can change the ticket SLA.' using errcode = '42501';
  end if;
  if p_rm_minutes is null or p_tl_minutes is null or p_rm_minutes not between 5 and 43200 or p_tl_minutes not between 5 and 43200 then
    raise exception 'VALIDATION_ERROR: Each SLA must be between 5 minutes and 30 days.' using errcode = 'P0001';
  end if;
  v_dept := case when me.role = 'DEPARTMENT_HEAD' then me.department_id end;  -- the Super Admin sets the default
  update public.ticket_sla_settings set rm_response_minutes = p_rm_minutes, tl_response_minutes = p_tl_minutes, updated_by = me.id, updated_at = now()
   where department_id is not distinct from v_dept;
  if not found then
    insert into public.ticket_sla_settings (department_id, rm_response_minutes, tl_response_minutes, updated_by)
    values (v_dept, p_rm_minutes, p_tl_minutes, me.id);
  end if;
  perform private.write_audit('TICKET_SLA_CHANGED', 'ticket_sla_settings', null, v_dept, null,
    jsonb_build_object('rm_minutes', p_rm_minutes, 'tl_minutes', p_tl_minutes));
  return public.ticket_sla_settings();
end $$;
revoke all on function public.set_ticket_sla(integer, integer) from public, anon;
grant execute on function public.set_ticket_sla(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Realtime + the scheduled sweep
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.support_ticket_escalations;
  exception when duplicate_object or undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.client_notifications;
  exception when duplicate_object or undefined_object then null;
  end;
end $$;

-- With pg_cron (Supabase: Database -> Extensions), overdue tickets escalate every 5 minutes on their own.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      perform cron.unschedule('ticket-sla-escalations');
    exception when others then null;
    end;
    perform cron.schedule('ticket-sla-escalations', '*/5 * * * *', 'select public.escalate_overdue_tickets()');
  end if;
end $$;
