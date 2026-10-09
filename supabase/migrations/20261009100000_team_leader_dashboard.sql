-- =============================================================================
-- Team Leader dashboard: one scope, read through security-definer functions.
--
-- No new ownership fields. A customer's assignee is
--   * customers.owner_id                       for customers of the lead's team
--     (team_id follows the owner, so the owner is the lead or one of the members);
--   * customer_onboarding.team_member_id        for customers the Department
--     Head handed to the lead (team_lead_id = lead; the sales owner stays);
--     while handover_stage = 'TEAM_LEAD' the lead still has to decide.
--
-- A Team Lead's scope = customers of their team  ∪  customers handed to them.
-- Every function below derives the caller from auth.uid() (never from a
-- parameter), returns only that scope, and counts each customer once.
--
--  * team_lead_dashboard()            KPIs, member workload, alerts, recent activity
--  * team_lead_customers(...)         server-side search / filters / sort / paging
--  * team_lead_tickets(...)           tickets of the scope, server-side paging
--  * team_lead_assign_customer(c, a)  keep with me / assign to a member of my team
--  * assign_to_team_member()          a handed-over customer may now be kept by the lead
--  * read-only RLS so the lead can open tickets (and their history) of the scope;
--    editing tickets still follows update_support_ticket / assign_support_ticket.
-- Additive / idempotent. Customer creation reuses create_support_customer().
-- =============================================================================

-- The calling Team Lead (active, in a team) or nothing.
create or replace function private.current_team_lead()
returns public.profiles language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id is not null
$$;
revoke all on function private.current_team_lead() from public, anon;
grant execute on function private.current_team_lead() to authenticated;

-- The lead's scope, one row per customer, with the derived assignee.
create or replace function private.team_lead_scope(p_lead uuid)
returns table (customer_id uuid, handed boolean, assignee_id uuid, needs_decision boolean)
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.id, p.team_id from public.profiles p
    where p.id = p_lead and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id is not null
  ), handed as (
    select o.customer_id, o.handover_stage, o.team_member_id
    from me join public.customer_onboarding o on o.team_lead_id = me.id
    join public.customers c on c.id = o.customer_id
    where o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER') and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
  )
  select h.customer_id, true,
         case when h.handover_stage = 'TEAM_MEMBER' then h.team_member_id end,
         h.handover_stage = 'TEAM_LEAD'
  from handed h
  union all
  select c.id, false, c.owner_id, false
  from me join public.customers c on c.team_id = me.team_id
  where not exists (select 1 from handed h where h.customer_id = c.id)
$$;
revoke all on function private.team_lead_scope(uuid) from public, anon, authenticated;

create or replace function private.in_team_lead_scope(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles me
    join public.customers c on c.id = p_customer
    where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'TEAM_HEAD' and me.team_id is not null
      and (c.team_id = me.team_id
        or exists (select 1 from public.customer_onboarding o
                    where o.customer_id = c.id and o.team_lead_id = me.id
                      and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER'))))
$$;
revoke all on function private.in_team_lead_scope(uuid) from public, anon;
grant execute on function private.in_team_lead_scope(uuid) to authenticated;

-- Read-only: the lead can open every ticket (and its history) of their scope.
-- Writes still go through update_support_ticket / assign_support_ticket.
drop policy if exists support_tickets_select_team_lead_scope on public.support_tickets;
create policy support_tickets_select_team_lead_scope on public.support_tickets for select to authenticated
  using (private.in_team_lead_scope(customer_id));
drop policy if exists support_ticket_updates_select_team_lead_scope on public.support_ticket_updates;
create policy support_ticket_updates_select_team_lead_scope on public.support_ticket_updates for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and private.in_team_lead_scope(t.customer_id)));

create index if not exists support_tickets_customer_status_idx on public.support_tickets (customer_id, status);

-- ---------------------------------------------------------------------------
-- KPIs, workload per member, alerts and recent activity
-- ---------------------------------------------------------------------------
create or replace function public.team_lead_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_team_lead();
  v jsonb;
begin
  if me.id is null then
    raise exception 'FORBIDDEN: Only a Team Lead has this dashboard.' using errcode = '42501';
  end if;

  with s as (select * from private.team_lead_scope(me.id)),
  t as (
    select t.* from public.support_tickets t
    where t.customer_id in (select customer_id from s) or t.team_id = me.team_id
  ),
  open_t as (select * from t where t.status not in ('RESOLVED', 'CLOSED')),
  members as (
    select p.id, p.full_name from public.profiles p
    where p.team_id = me.team_id and p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE'
  )
  select jsonb_build_object(
    'lead', jsonb_build_object('id', me.id, 'fullName', me.full_name, 'teamId', me.team_id,
                               'teamName', (select name from public.teams where id = me.team_id)),
    'totals', jsonb_build_object(
      'customers', (select count(*) from s),
      'mine', (select count(*) from s where s.assignee_id = me.id),
      'team', (select count(*) from s where s.assignee_id in (select id from members)),
      'needsDecision', (select count(*) from s where s.needs_decision),
      'openTickets', (select count(*) from open_t),
      'urgentTickets', (select count(*) from open_t where open_t.priority in ('URGENT', 'HIGH') or open_t.status = 'ESCALATED')),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'fullName', m.full_name,
               'customers', (select count(*) from s where s.assignee_id = m.id),
               'openTickets', (select count(*) from open_t where open_t.assignee_id = m.id),
               'urgentTickets', (select count(*) from open_t where open_t.assignee_id = m.id
                                  and (open_t.priority in ('URGENT', 'HIGH') or open_t.status = 'ESCALATED')))
             order by m.full_name)
      from members m), '[]'::jsonb),
    'decisions', coalesce((
      select jsonb_agg(x order by x ->> 'passedAt' desc) from (
        select jsonb_build_object('id', c.id, 'name', c.name, 'company', c.company, 'code', c.customer_code,
                                  'passedAt', o.passed_to_team_lead_at) as x
        from s join public.customers c on c.id = s.customer_id
        join public.customer_onboarding o on o.customer_id = c.id
        where s.needs_decision
        order by o.passed_to_team_lead_at desc nulls last limit 5) d), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', ot.id, 'ticketNo', ot.ticket_no, 'subject', ot.subject, 'priority', ot.priority,
                                  'status', ot.status, 'updatedAt', ot.updated_at, 'customerId', ot.customer_id,
                                  'customerName', c.name) as x
        from open_t ot join public.customers c on c.id = ot.customer_id
        where ot.priority in ('URGENT', 'HIGH') or ot.status = 'ESCALATED'
        order by case ot.priority when 'URGENT' then 0 when 'HIGH' then 1 else 2 end, ot.updated_at desc
        limit 5) a), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', a.id, 'type', a.type, 'note', a.note, 'occurredAt', a.occurred_at,
                                  'customerId', c.id, 'customerName', c.name,
                                  'actorName', (select full_name from public.profiles where id = a.actor_id)) as x
        from public.customer_activities a
        join s on s.customer_id = a.customer_id
        join public.customers c on c.id = a.customer_id
        order by a.occurred_at desc limit 10) r), '[]'::jsonb)
  ) into v;
  return v;
end $$;
revoke all on function public.team_lead_dashboard() from public, anon;
grant execute on function public.team_lead_dashboard() to authenticated;

-- ---------------------------------------------------------------------------
-- Customers of the scope: search, filters, sort and paging on the server
-- ---------------------------------------------------------------------------
create or replace function public.team_lead_customers(
  p_search text default null, p_status text default null, p_assignment text default null, p_member uuid default null,
  p_sort text default 'newest', p_page integer default 1, p_page_size integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_team_lead();
  v_q text := lower(nullif(trim(coalesce(p_search, '')), ''));
  v_size integer := least(greatest(coalesce(p_page_size, 10), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total integer;
  v_items jsonb;
begin
  if me.id is null then
    raise exception 'FORBIDDEN: Only a Team Lead has this dashboard.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('ACTIVE', 'INACTIVE', 'PROSPECT') then
    raise exception 'VALIDATION_ERROR: Unknown customer status.' using errcode = 'P0001';
  end if;
  if p_assignment is not null and p_assignment not in ('MINE', 'TEAM', 'DECISION') then
    raise exception 'VALIDATION_ERROR: Unknown assignment filter.' using errcode = 'P0001';
  end if;
  if coalesce(p_sort, 'newest') not in ('newest', 'oldest', 'name', 'activity', 'tickets') then
    raise exception 'VALIDATION_ERROR: Unknown sort order.' using errcode = 'P0001';
  end if;
  if p_member is not null and not exists (
       select 1 from public.profiles where id = p_member and team_id = me.team_id and role = 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Choose a member of your team.' using errcode = 'P0001';
  end if;

  with s as (select * from private.team_lead_scope(me.id)),
  tc as (
    select t.customer_id, count(*)::int as total, (count(*) filter (where t.status not in ('RESOLVED', 'CLOSED')))::int as open
    from public.support_tickets t where t.customer_id in (select customer_id from s) group by t.customer_id
  ),
  la as (
    select a.customer_id, max(a.occurred_at) as last_at
    from public.customer_activities a where a.customer_id in (select customer_id from s) group by a.customer_id
  ),
  r as (
    select c.id, c.customer_code as code, c.name, c.company, c.email, c.phone, c.status::text as status, c.lifecycle_stage as stage,
           s.assignee_id, p.full_name as assignee_name,
           case when s.needs_decision or s.assignee_id is null then 'DECISION'
                when s.assignee_id = me.id then 'MINE' else 'TEAM' end as assignment,
           s.handed, coalesce(tc.open, 0) as open_tickets, coalesce(tc.total, 0) as total_tickets,
           la.last_at as last_activity, c.created_at
    from s
    join public.customers c on c.id = s.customer_id
    left join public.profiles p on p.id = s.assignee_id
    left join tc on tc.customer_id = c.id
    left join la on la.customer_id = c.id
    where (v_q is null or strpos(lower(concat_ws(' ', c.name, c.company, c.email, c.phone, c.customer_code)), v_q) > 0)
      and (p_status is null or c.status::text = p_status)
      and (p_member is null or s.assignee_id = p_member)
      and (p_assignment is null
           or (p_assignment = 'MINE' and s.assignee_id = me.id and not s.needs_decision)
           or (p_assignment = 'TEAM' and s.assignee_id is not null and s.assignee_id <> me.id and not s.needs_decision)
           or (p_assignment = 'DECISION' and (s.needs_decision or s.assignee_id is null)))
  )
  select (select count(*) from r),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', x.id, 'code', x.code, 'name', x.name, 'company', x.company, 'email', x.email, 'phone', x.phone,
                   'status', x.status, 'lifecycleStage', x.stage, 'assigneeId', x.assignee_id, 'assigneeName', x.assignee_name,
                   'assignment', x.assignment, 'handedOver', x.handed, 'openTickets', x.open_tickets,
                   'totalTickets', x.total_tickets, 'lastActivityAt', x.last_activity, 'createdAt', x.created_at)
                 order by x.n), '[]'::jsonb)
          from (
            select r.*, row_number() over (order by
                     case when p_sort = 'name' then lower(r.name) end asc,
                     case when p_sort = 'oldest' then r.created_at end asc,
                     case when p_sort = 'activity' then coalesce(r.last_activity, r.created_at) end desc,
                     case when p_sort = 'tickets' then r.open_tickets end desc,
                     r.created_at desc, r.id) as n
            from r) x
          where x.n > (v_page - 1) * v_size and x.n <= v_page * v_size)
    into v_total, v_items;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.team_lead_customers(text, text, text, uuid, text, integer, integer) from public, anon;
grant execute on function public.team_lead_customers(text, text, text, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Tickets of the scope (customers of the scope + the team's own tickets)
-- ---------------------------------------------------------------------------
create or replace function public.team_lead_tickets(
  p_search text default null, p_status text default 'OPEN_ONLY', p_priority text default null,
  p_customer uuid default null, p_assignee uuid default null, p_sort text default 'updated',
  p_page integer default 1, p_page_size integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.current_team_lead();
  v_q text := lower(nullif(trim(coalesce(p_search, '')), ''));
  v_size integer := least(greatest(coalesce(p_page_size, 10), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_status text := coalesce(p_status, 'OPEN_ONLY');
  v_total integer;
  v_items jsonb;
begin
  if me.id is null then
    raise exception 'FORBIDDEN: Only a Team Lead has this dashboard.' using errcode = '42501';
  end if;
  if v_status not in ('OPEN_ONLY', 'ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Unknown ticket status.' using errcode = 'P0001';
  end if;
  if p_priority is not null and p_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;
  if coalesce(p_sort, 'updated') not in ('updated', 'created', 'priority') then
    raise exception 'VALIDATION_ERROR: Unknown sort order.' using errcode = 'P0001';
  end if;

  with r as (
    select t.id, t.ticket_no, t.subject, t.category, t.priority, t.status, c.id as customer_id, c.name as customer_name,
           c.customer_code, t.assignee_id, p.full_name as assignee_name,
           -- Same rule as private.can_view_ticket for a team lead (what update_support_ticket accepts).
           (t.team_id = me.team_id or t.assignee_id = me.id or t.created_by = me.id) as manageable,
           t.created_at, t.updated_at
    from public.support_tickets t
    join public.customers c on c.id = t.customer_id
    left join public.profiles p on p.id = t.assignee_id
    where (t.customer_id in (select customer_id from private.team_lead_scope(me.id)) or t.team_id = me.team_id)
      and (v_status = 'ALL' or (v_status = 'OPEN_ONLY' and t.status not in ('RESOLVED', 'CLOSED')) or t.status = v_status)
      and (p_priority is null or t.priority = p_priority)
      and (p_customer is null or t.customer_id = p_customer)
      and (p_assignee is null or t.assignee_id = p_assignee)
      and (v_q is null or strpos(lower(concat_ws(' ', t.ticket_no, t.subject, c.name, c.customer_code)), v_q) > 0)
  )
  select (select count(*) from r),
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', x.id, 'ticketNo', x.ticket_no, 'subject', x.subject, 'category', x.category, 'priority', x.priority,
                   'status', x.status, 'customerId', x.customer_id, 'customerName', x.customer_name, 'customerCode', x.customer_code,
                   'assigneeId', x.assignee_id, 'assigneeName', x.assignee_name, 'manageable', x.manageable,
                   'createdAt', x.created_at, 'updatedAt', x.updated_at) order by x.n), '[]'::jsonb)
          from (
            select r.*, row_number() over (order by
                     case when p_sort = 'priority' then case r.priority when 'URGENT' then 0 when 'HIGH' then 1 when 'MEDIUM' then 2 else 3 end end asc,
                     case when p_sort = 'created' then r.created_at end desc,
                     r.updated_at desc, r.id) as n
            from r) x
          where x.n > (v_page - 1) * v_size and x.n <= v_page * v_size)
    into v_total, v_items;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.team_lead_tickets(text, text, text, uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.team_lead_tickets(text, text, text, uuid, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Hand-over: the lead may also keep a customer the Department Head passed on.
-- (Same as 20261008000900, plus "assign to myself".)
-- ---------------------------------------------------------------------------
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
  select team_id into v_lead_team from public.profiles where id = o.team_lead_id;
  if not (p_member = o.team_lead_id
          or exists (select 1 from public.profiles p where p.id = p_member and p.role = 'TEAM_MEMBER'
                      and p.status = 'ACTIVE' and p.team_id = v_lead_team)) then
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

-- ---------------------------------------------------------------------------
-- Change assignment: "Assign to me" or to an active member of my team.
-- Team customers change owner (the existing rule); handed-over customers change
-- the hand-over assignee (the sales owner stays). Nothing else is touched.
-- ---------------------------------------------------------------------------
create or replace function public.team_lead_assign_customer(p_customer uuid, p_assignee uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.current_team_lead();
  c public.customers;
  s record;
  new_owner public.profiles;
  old_name text;
begin
  if me.id is null then
    raise exception 'FORBIDDEN: Only a Team Lead can change assignments here.' using errcode = '42501';
  end if;
  select * into s from private.team_lead_scope(me.id) x where x.customer_id = p_customer;
  if s.customer_id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_assignee is null or not (p_assignee = me.id or exists (
       select 1 from public.profiles p where p.id = p_assignee and p.team_id = me.team_id
          and p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE')) then
    raise exception 'VALIDATION_ERROR: Choose yourself or an active member of your team.' using errcode = 'P0001';
  end if;

  if s.handed then
    perform public.assign_to_team_member(p_customer, p_assignee, null);
    return;
  end if;

  select * into c from public.customers where id = p_customer for update;
  if c.owner_id = p_assignee then
    raise exception 'CONFLICT: The customer is already assigned to this person.' using errcode = 'P0001';
  end if;
  select * into new_owner from public.profiles where id = p_assignee;
  select full_name into old_name from public.profiles where id = c.owner_id;
  -- The customers trigger re-checks the owner (active, same team) and writes the audit + notification.
  update public.customers set owner_id = p_assignee where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CUSTOMER_REASSIGNED',
    format('Assignment changed by %s: %s → %s', me.full_name, coalesce(old_name, 'unassigned'),
           case when p_assignee = me.id then format('%s (Team Lead)', new_owner.full_name) else new_owner.full_name end));
  if c.owner_id is not null and c.owner_id <> me.id then
    perform private.notify(c.owner_id, 'CUSTOMER_UNASSIGNED', format('Customer reassigned: %s', c.name),
      format('%s reassigned %s to %s.', me.full_name, c.name, new_owner.full_name), 'customer', c.id);
  end if;
end $$;
revoke all on function public.team_lead_assign_customer(uuid, uuid) from public, anon;
grant execute on function public.team_lead_assign_customer(uuid, uuid) to authenticated;
