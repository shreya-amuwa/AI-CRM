-- =============================================================================
-- Super Admin sub-department dashboards (Wabastore Sales and Wabastore Support).
--
--  * division_leads_overview now also returns the Potential counts the Sales
--    Team Member dashboard shows next to "Leads" (same predicates as
--    customer_pipeline_counts().potential, limited to the sub-department).
--  * division_support_overview(department, division) - Team Performance for a
--    Support sub-department from real records: customers the team added /
--    owns, tickets by status per member, tasks per member.
-- The sub-department is department id + team division, never a name. Super
-- Admin, or the Department Head of that department, only. Idempotent.
-- =============================================================================

create or replace function public.division_leads_overview(p_department_id uuid, p_division public.team_division)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_teams uuid[];
  v_members jsonb;
  v_totals jsonb;
  v_leads jsonb;
  v_potential jsonb;
begin
  if not coalesce(private.my_role() = 'SUPER_ADMIN'
                  or (private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() = p_department_id), false) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can view the team overview.' using errcode = '42501';
  end if;

  select coalesce(array_agg(t.id), '{}') into v_teams
    from public.teams t where t.department_id = p_department_id and t.division = p_division;

  select coalesce(jsonb_agg(m order by m ->> 'fullName'), '[]'::jsonb) into v_members
  from (
    select jsonb_build_object(
      'id', p.id,
      'fullName', p.full_name,
      'email', p.email,
      'role', p.role,
      'status', p.status,
      'teamId', p.team_id,
      'teamName', t.name,
      'leadsAdded', (select count(*) from public.customers c where c.created_by = p.id and c.team_id = any (v_teams)),
      'owned', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams)),
      'leads', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'),
      'new', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'NEW'),
      'contacted', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'CONTACTED'),
      'interested', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'INTERESTED'),
      'readyToBuy', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'READY_TO_BUY'),
      'potential', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'POTENTIAL'),
      'onboarding', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'ONBOARDING'),
      'customers', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'CUSTOMER'),
      'followUpsOverdue', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'
                             and c.next_follow_up_at is not null and c.next_follow_up_at < now()),
      'followUpsToday', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'
                           and c.next_follow_up_at >= current_date and c.next_follow_up_at < current_date + 1),
      'noFollowUp', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'
                       and c.next_follow_up_at is null),
      'lastLeadAt', (select max(c.created_at) from public.customers c where c.created_by = p.id and c.team_id = any (v_teams))
    ) as m
    from public.profiles p
    join public.teams t on t.id = p.team_id
    where p.team_id = any (v_teams) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.status <> 'REJECTED'
  ) s;

  select jsonb_build_object(
    'members', (select count(*) from public.profiles p
                 where p.team_id = any (v_teams) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.status = 'ACTIVE'),
    'leadsAdded', count(*),
    'leads', count(*) filter (where lifecycle_stage = 'LEAD'),
    'potential', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
    'onboarding', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
    'customers', count(*) filter (where lifecycle_stage = 'CUSTOMER'),
    'followUpsOverdue', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at is not null and next_follow_up_at < now()),
    'followUpsToday', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at >= current_date and next_follow_up_at < current_date + 1),
    'noFollowUp', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at is null))
    into v_totals
  from public.customers where team_id = any (v_teams);

  select jsonb_build_object(
    'all', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION'),
    'NEW', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'NEW'),
    'CONTACTED', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'CONTACTED'),
    'INTERESTED', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'INTERESTED'),
    'READY_TO_BUY', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'READY_TO_BUY'),
    'WITH_ACCOUNTS', count(*) filter (where payment_workflow = 'PENDING_PAYMENT_CONFIRMATION'),
    'RETURNED', count(*) filter (where payment_workflow = 'RETURNED_FROM_ACCOUNTS'))
    into v_leads
  from public.customers where team_id = any (v_teams) and lifecycle_stage = 'LEAD';

  -- Same predicates as customer_pipeline_counts().potential
  select jsonb_build_object(
    'all', count(*),
    'AWAITING', count(*) filter (where not fully_paid and amount_received = 0 and payment_due_date >= current_date),
    'PART_PAID', count(*) filter (where not fully_paid and amount_received > 0 and payment_due_date >= current_date),
    'OVERDUE', count(*) filter (where not fully_paid and payment_due_date < current_date),
    'PAID', count(*) filter (where fully_paid))
    into v_potential
  from public.customers where team_id = any (v_teams) and lifecycle_stage = 'POTENTIAL';

  return jsonb_build_object('teamIds', to_jsonb(v_teams), 'members', v_members, 'totals', v_totals, 'leads', v_leads, 'potential', v_potential);
end $$;
revoke all on function public.division_leads_overview(uuid, public.team_division) from public, anon;
grant execute on function public.division_leads_overview(uuid, public.team_division) to authenticated;

-- ---------------------------------------------------------------------------
create or replace function public.division_support_overview(p_department_id uuid, p_division public.team_division)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_teams uuid[];
  v_members jsonb;
  v_totals jsonb;
begin
  if not coalesce(private.my_role() = 'SUPER_ADMIN'
                  or (private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() = p_department_id), false) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can view the team overview.' using errcode = '42501';
  end if;

  select coalesce(array_agg(t.id), '{}') into v_teams
    from public.teams t where t.department_id = p_department_id and t.division = p_division;

  select coalesce(jsonb_agg(m order by m ->> 'fullName'), '[]'::jsonb) into v_members
  from (
    select jsonb_build_object(
      'id', p.id,
      'fullName', p.full_name,
      'email', p.email,
      'role', p.role,
      'status', p.status,
      'teamId', p.team_id,
      'teamName', t.name,
      'customersAdded', (select count(*) from public.customers c where c.created_by = p.id and c.team_id = any (v_teams)),
      'customersOwned', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams)),
      'ticketsAssigned', (select count(*) from public.support_tickets k where k.assignee_id = p.id and k.team_id = any (v_teams)),
      'ticketsOpen', (select count(*) from public.support_tickets k where k.assignee_id = p.id and k.team_id = any (v_teams) and k.status = 'OPEN'),
      'ticketsInProgress', (select count(*) from public.support_tickets k where k.assignee_id = p.id and k.team_id = any (v_teams) and k.status = 'IN_PROGRESS'),
      'ticketsWaiting', (select count(*) from public.support_tickets k where k.assignee_id = p.id and k.team_id = any (v_teams) and k.status = 'WAITING_CUSTOMER'),
      'ticketsEscalated', (select count(*) from public.support_tickets k where k.assignee_id = p.id and k.team_id = any (v_teams) and k.status = 'ESCALATED'),
      'ticketsResolved', (select count(*) from public.support_tickets k where k.assignee_id = p.id and k.team_id = any (v_teams) and k.status in ('RESOLVED', 'CLOSED')),
      'tasksPending', (select count(*) from public.work_tasks w where w.assignee_id = p.id and w.team_id = any (v_teams) and w.status in ('ASSIGNED', 'IN_PROGRESS')),
      'tasksDone', (select count(*) from public.work_tasks w where w.assignee_id = p.id and w.team_id = any (v_teams) and w.status = 'COMPLETED'),
      'lastCustomerAt', (select max(c.created_at) from public.customers c where c.created_by = p.id and c.team_id = any (v_teams))
    ) as m
    from public.profiles p
    join public.teams t on t.id = p.team_id
    where p.team_id = any (v_teams) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.status <> 'REJECTED'
  ) s;

  select jsonb_build_object(
    'members', (select count(*) from public.profiles p
                 where p.team_id = any (v_teams) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.status = 'ACTIVE'),
    'customers', (select count(*) from public.customers c where c.team_id = any (v_teams)),
    'customersActive', (select count(*) from public.customers c where c.team_id = any (v_teams) and c.status = 'ACTIVE'),
    'tickets', (select count(*) from public.support_tickets k where k.team_id = any (v_teams)),
    'open', (select count(*) from public.support_tickets k where k.team_id = any (v_teams) and k.status = 'OPEN'),
    'inProgress', (select count(*) from public.support_tickets k where k.team_id = any (v_teams) and k.status = 'IN_PROGRESS'),
    'waiting', (select count(*) from public.support_tickets k where k.team_id = any (v_teams) and k.status = 'WAITING_CUSTOMER'),
    'escalated', (select count(*) from public.support_tickets k where k.team_id = any (v_teams) and k.status = 'ESCALATED'),
    'resolved', (select count(*) from public.support_tickets k where k.team_id = any (v_teams) and k.status in ('RESOLVED', 'CLOSED')),
    'unassigned', (select count(*) from public.support_tickets k where k.team_id = any (v_teams) and k.assignee_id is null
                      and k.status not in ('RESOLVED', 'CLOSED')),
    'tasksPending', (select count(*) from public.work_tasks w where w.team_id = any (v_teams) and w.status in ('ASSIGNED', 'IN_PROGRESS')),
    'tasksDone', (select count(*) from public.work_tasks w where w.team_id = any (v_teams) and w.status = 'COMPLETED'))
    into v_totals;

  return jsonb_build_object('teamIds', to_jsonb(v_teams), 'members', v_members, 'totals', v_totals);
end $$;
revoke all on function public.division_support_overview(uuid, public.team_division) from public, anon;
grant execute on function public.division_support_overview(uuid, public.team_division) to authenticated;
