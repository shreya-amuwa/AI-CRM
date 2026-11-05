-- =============================================================================
-- A Team Lead sees and manages ONLY their own Team Members (the direct manager), never another Team Lead's people who share the team.
-- Run after 20261224000300_task_delegation_detail.sql. Safe to run again; no row is changed, deleted or moved.
--
-- ROOT CAUSE (the Support Team Lead dashboard listing other leads' members under "Team Workload"):
--   public.team_lead_dashboard() (20261009100000) built the workload list from every ACTIVE TEAM_MEMBER whose team_id equals the lead's, and
--   private.team_lead_scope() / in_team_lead_scope() put every customer of that team_id in the lead's scope. When two or more Team Leads share
--   one team, each saw - and could count, filter, search, open tickets of and reassign - the other lead's members and customers. The same
--   "same team_id" rule was used for a Team Lead by the row-level rules on customers, tasks and tickets, can_view_customer / can_view_profile,
--   the performance reports and the overview counts. 20261223000100 introduced the authoritative relationship (profiles.manager_id, read by
--   private.direct_lead_of: the named Team Lead, or the team's ONLY active lead when nobody is named), but these places never used it.
--
-- What changes: the Team Lead branch of each of them additionally requires that the person the row belongs to (customer owner, task or ticket
-- assignee, profile) is the lead themselves or one of their direct members (private.led_by). A row with no person (an unassigned ticket of the
-- team, a customer without an owner) stays visible to the team's leads, as before. A team with ONE Team Lead sees exactly what it saw before.
-- A member nobody is named for in a team with several leads is visible to no Team Lead until the Department Head names one (hierarchy_report()
-- and the Team Lead assignment of 20261223000100) - the Department Head still sees them. Customers formally handed to a Team Lead
-- (customer_onboarding.team_lead_id) stay in that lead's scope. Team Members see colleagues under the same Team Lead only.
-- Not changed by default (a business decision, see docs/TEAM_LEAD_OWNERSHIP.md): Support staff still read the post-sale customers of their
-- department (the Support desk rule of 20261009000100); it can be switched off below.
-- =============================================================================

-- Is p_person the lead themselves, one of their direct members, or nobody (an unassigned row)?
create or replace function private.led_by(p_lead uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_person is null or p_person = p_lead or private.direct_lead_of(p_person) is not distinct from p_lead and p_lead is not null
$$;
revoke all on function private.led_by(uuid, uuid) from public, anon;
grant execute on function private.led_by(uuid, uuid) to authenticated, service_role;

-- The caller is a Team Lead and the row (its team, and the person it belongs to) is theirs.
create or replace function private.lead_sees(p_team uuid, p_person uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_team is not null and p_team = private.my_team_id() and private.led_by(private.my_id(), p_person)
$$;
revoke all on function private.lead_sees(uuid, uuid) from public, anon;
grant execute on function private.lead_sees(uuid, uuid) to authenticated, service_role;

-- The Support desk rule (20261009000100: every Support Team Lead and Team Member reads ALL post-sale customers of their department, which is
-- what lets Support raise a ticket for any customer of the department) is kept ON, unchanged, because live Support ticketing depends on it.
-- It now has a switch: the Super Admin can turn it OFF (set_support_desk_department_wide(false), audited) for strict ownership - then a Support
-- Team Member reads only their own customers and a Support Team Lead their own members' - knowing that Support can then raise tickets only for
-- those customers. Nothing is deleted either way. The Team Lead rules above apply in both cases.
create table if not exists public.access_settings (
  id boolean primary key default true check (id),
  support_desk_department_wide boolean not null default true,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.access_settings (id) values (true) on conflict (id) do nothing;
alter table public.access_settings enable row level security;
revoke all on public.access_settings from public, anon, authenticated;

create or replace function private.support_desk_department_wide()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.support_desk_department_wide from public.access_settings s where s.id), true)
$$;
revoke all on function private.support_desk_department_wide() from public, anon;
grant execute on function private.support_desk_department_wide() to authenticated, service_role;

create or replace function public.set_support_desk_department_wide(p_on boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before boolean := private.support_desk_department_wide();
begin
  perform private.require_super_admin();
  if p_on is null then
    raise exception 'VALIDATION_ERROR: Choose on or off.' using errcode = 'P0001';
  end if;
  update public.access_settings set support_desk_department_wide = p_on, updated_by = auth.uid(), updated_at = now() where id;
  if v_before is distinct from p_on then
    perform private.write_audit('SUPPORT_DESK_SCOPE_SET', 'access_settings', null, null, null, jsonb_build_object('before', v_before, 'after', p_on));
  end if;
  return jsonb_build_object('supportDeskDepartmentWide', p_on);
end $$;
revoke all on function public.set_support_desk_department_wide(boolean) from public, anon;
grant execute on function public.set_support_desk_department_wide(boolean) to authenticated;

drop policy if exists customers_select_support on public.customers;
create policy customers_select_support on public.customers for select to authenticated
  using ((select private.support_desk_department_wide())
         and (select private.is_support_staff())
         and department_id = (select private.my_department_id())
         and lifecycle_stage = 'CUSTOMER');

create or replace function private.team_lead_scope(p_lead uuid)
returns table (customer_id uuid, handed boolean, assignee_id uuid, needs_decision boolean)
language sql stable security definer set search_path = '' as $$
  with me as (
    select p.id, p.team_id from public.profiles p
    join public.teams t on t.id = p.team_id and t.division = 'SUPPORT'
    where p.id = p_lead and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
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
  from me join public.customers c on c.team_id = me.team_id and private.led_by(me.id, c.owner_id)
  where not exists (select 1 from handed h where h.customer_id = c.id)
$$;

revoke all on function private.team_lead_scope(uuid) from public, anon, authenticated;


create or replace function private.in_team_lead_scope(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles me
    join public.teams t on t.id = me.team_id and t.division = 'SUPPORT'
    join public.customers c on c.id = p_customer
    where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'TEAM_HEAD'
      and ((c.team_id = me.team_id and private.led_by(me.id, c.owner_id))
        or exists (select 1 from public.customer_onboarding o
                    where o.customer_id = c.id and o.team_lead_id = me.id
                      and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER'))))
$$;

revoke all on function private.in_team_lead_scope(uuid) from public, anon;
grant execute on function private.in_team_lead_scope(uuid) to authenticated;


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
    where t.customer_id in (select customer_id from s) or (t.team_id = me.team_id and private.led_by(me.id, t.assignee_id))
  ),
  open_t as (select * from t where t.status not in ('RESOLVED', 'CLOSED')),
  members as (
    select p.id, p.full_name from public.profiles p
    -- the lead's OWN ordinary members (direct manager), not every member who shares the team
    where p.team_id = me.team_id and p.status = 'ACTIVE' and private.is_ordinary_member(p) and private.direct_lead_of(p.id) = me.id
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
       select 1 from public.profiles where id = p_member and team_id = me.team_id and role = 'TEAM_MEMBER' and private.direct_lead_of(id) = me.id) then
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
           ((t.team_id = me.team_id and private.led_by(me.id, t.assignee_id)) or t.assignee_id = me.id or t.created_by = me.id) as manageable,
           t.created_at, t.updated_at
    from public.support_tickets t
    join public.customers c on c.id = t.customer_id
    left join public.profiles p on p.id = t.assignee_id
    where (t.customer_id in (select customer_id from private.team_lead_scope(me.id)) or (t.team_id = me.team_id and private.led_by(me.id, t.assignee_id)))
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
          and p.status = 'ACTIVE' and private.is_ordinary_member(p) and private.direct_lead_of(p.id) = me.id)) then
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


drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated
  using ((( select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((( select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role) and department_id = ( select private.my_department_id()) and private.sales_scope_team(team_id))
      or ((( select private.my_role()) = 'TEAM_HEAD'::public.app_role) and private.lead_sees(team_id, owner_id))
      or ((( select private.my_role()) = 'TEAM_MEMBER'::public.app_role) and owner_id = ( select private.my_id())));


drop policy if exists work_tasks_select on public.work_tasks;
create policy work_tasks_select on public.work_tasks for select to authenticated
  using (assignee_id = ( select private.my_id()) or assigned_by = ( select private.my_id())
      or (( select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((( select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role) and department_id = ( select private.my_department_id()) and private.sales_scope_team(team_id))
      or ((( select private.my_role()) = 'TEAM_HEAD'::public.app_role) and private.lead_sees(team_id, assignee_id)));


create or replace function private.can_view_work_task(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.work_tasks t
    where t.id = p_task and (
      t.assignee_id = private.my_id() or t.assigned_by = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id() and private.sales_scope_team(t.team_id))
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(t.team_id, t.assignee_id))))
$$;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (assignee_id = ( select private.my_id()) or created_by = ( select private.my_id()) or escalated_to = ( select private.my_id())
      or (( select private.my_role()) = 'SUPER_ADMIN'::public.app_role)
      or ((( select private.my_role()) = 'DEPARTMENT_HEAD'::public.app_role) and department_id = ( select private.my_department_id()) and private.sales_scope_team(team_id))
      or ((( select private.my_role()) = 'TEAM_HEAD'::public.app_role) and private.lead_sees(team_id, assignee_id)));


create or replace function private.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket and (
      t.assignee_id = private.my_id() or t.created_by = private.my_id() or t.escalated_to = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(t.team_id, t.assignee_id))))
$$;

grant execute on function private.can_view_ticket(uuid) to authenticated;


create or replace function private.can_view_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and (
      private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(c.team_id, c.owner_id))
      or (private.my_role() = 'TEAM_MEMBER' and c.owner_id = private.my_id())
      or (private.support_desk_department_wide() and private.is_support_staff() and c.department_id = private.my_department_id() and c.lifecycle_stage = 'CUSTOMER')))
$$;

grant execute on function private.can_view_customer(uuid) to authenticated;


create or replace function private.can_view_profile(p_id uuid, p_role public.app_role, p_department_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case
    when p_id = auth.uid() then true
    when private.my_role() = 'SUPER_ADMIN' then true
    when private.my_role() = 'DEPARTMENT_HEAD' then p_department_id = private.my_department_id() and private.sales_scope_team(p_team_id)
      -- the Support-side head of the same department is not part of the Sales head's people
      and (p_role <> 'DEPARTMENT_HEAD' or not private.is_sales_head()
           or exists (select 1 from public.profiles h where h.id = p_id and h.head_division = 'SALES'))
    -- the team's leads and the department's heads, and of the team's members only the lead's own (a Team Lead) or the colleagues under the
    -- same Team Lead (a Team Member): not another Team Lead's people, although they share the team
    when private.my_role() = 'TEAM_HEAD' then
      (p_team_id = private.my_team_id() and (p_role <> 'TEAM_MEMBER' or private.led_by(auth.uid(), p_id)))
      or (p_role = 'DEPARTMENT_HEAD' and p_department_id = private.my_department_id())
    when private.my_role() = 'TEAM_MEMBER' then
      (p_team_id = private.my_team_id() and (p_role <> 'TEAM_MEMBER' or private.direct_lead_of(p_id) = private.direct_lead_of(auth.uid())))
      or (p_role = 'DEPARTMENT_HEAD' and p_department_id = private.my_department_id())
    else false
  end
$$;

create or replace function private.perf_can_view(p_scope text, p_subject uuid, p_team uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case private.my_role()
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_department is not null and p_department = private.my_department_id()
                                and (p_subject is null or p_subject <> private.my_id())
                                and (not private.is_sales_head() or (p_scope <> 'DEPARTMENT' and private.sales_scope_team(p_team)
                                     and (p_subject is null or exists (select 1 from public.profiles s where s.id = p_subject and private.sales_scope_team(s.team_id)))))
    when 'TEAM_HEAD' then p_scope in ('MEMBER', 'TEAM') and p_team is not null and p_team = private.my_team_id()
                          and (p_subject is null or exists (select 1 from public.profiles s where s.id = p_subject and s.role = 'TEAM_MEMBER'
                                                             and private.direct_lead_of(s.id) = private.my_id()))
    else false
  end
$$;

create or replace function private.scope_customers(p_department uuid)
returns setof public.customers language sql stable security definer set search_path = '' as $$
  select c.* from public.customers c
   where case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or c.department_id = p_department)
           when 'DEPARTMENT_HEAD' then c.department_id = private.my_department_id()
           when 'TEAM_HEAD' then private.lead_sees(c.team_id, c.owner_id)
           else false end
$$;

revoke all on function private.scope_customers(uuid) from public, anon, authenticated;


create or replace function private.scope_tickets(p_department uuid)
returns setof public.support_tickets language sql stable security definer set search_path = '' as $$
  select t.* from public.support_tickets t
   where t.status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED')
     and case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or t.department_id = p_department)
           when 'DEPARTMENT_HEAD' then t.department_id = private.my_department_id()
           when 'TEAM_HEAD' then private.lead_sees(t.team_id, t.assignee_id)
           else false end
$$;

revoke all on function private.scope_tickets(uuid) from public, anon, authenticated;


create or replace function private.scope_tasks(p_department uuid)
returns setof public.work_tasks language sql stable security definer set search_path = '' as $$
  select w.* from public.work_tasks w
   where w.parent_id is null
     and case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or w.department_id = p_department)
           when 'DEPARTMENT_HEAD' then w.department_id = private.my_department_id()
           when 'TEAM_HEAD' then private.lead_sees(w.team_id, w.assignee_id)
           else false end
$$;

revoke all on function private.scope_tasks(uuid) from public, anon, authenticated;


create or replace function private.scope_people(p_department uuid)
returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p
   where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and p.team_id is not null
     and case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or p.department_id = p_department)
           when 'DEPARTMENT_HEAD' then p.department_id = private.my_department_id()
           when 'TEAM_HEAD' then p.team_id = private.my_team_id() and (p.id = private.my_id() or private.direct_lead_of(p.id) = private.my_id())
           else false end
$$;

revoke all on function private.scope_people(uuid) from public, anon, authenticated;


-- The Team Lead of a ticket: the lead the customer was handed to; else the direct Team Lead of the person working on it (the assignee, or the
-- customer's owner) when that lead is in the ticket's team; else the team's ONLY Team Lead. Never "the first lead of a team that has several" (null then: escalation goes to the
-- Department Head, as when a team has no lead).
create or replace function private.ticket_team_lead(p_ticket uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.id from public.customer_onboarding o join public.profiles p on p.id = o.team_lead_id and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
      where o.customer_id = t.customer_id),
    (select l.id from public.profiles l where l.id = private.direct_lead_of(coalesce(t.assignee_id, c.owner_id)) and l.status = 'ACTIVE' and l.team_id = t.team_id),
    (select l.id from public.profiles l where l.id = t.assignee_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'),
    private.sole_team_lead(t.team_id))
    from public.support_tickets t left join public.customers c on c.id = t.customer_id
   where t.id = p_ticket
$$;
revoke all on function private.ticket_team_lead(uuid) from public, anon, authenticated;


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
      union all  -- the lead of the person working on it keeps watching it (every lead of the team only while nobody works on it)
      select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id = t.team_id and private.led_by(p.id, t.assignee_id)) x
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
    -- the lead the customer was handed to, else the customer owner's direct Team Lead, else the team's only lead
    v_lead := coalesce(
      (select p.id from public.customer_onboarding o join public.profiles p on p.id = o.team_lead_id and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
        where o.customer_id = new.customer_id),
      (select l.id from public.profiles l where l.status = 'ACTIVE' and l.team_id = new.team_id  -- a lead of the ticket's team (not a Sales owner's lead)
          and l.id = private.direct_lead_of((select c.owner_id from public.customers c where c.id = new.customer_id))),
      private.sole_team_lead(new.team_id));
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

notify pgrst, 'reload schema';
