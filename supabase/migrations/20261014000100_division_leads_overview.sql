-- =============================================================================
-- Wabastore Sales Super Admin dashboard: team performance from real records.
--
-- public.division_leads_overview(p_department_id, p_division) returns, for the
-- teams of ONE department that belong to ONE division (e.g. Wabastore + SALES):
--   * members      - every Team Lead / Team Member of those teams with the
--                    leads they added (customers.created_by), the leads they
--                    own right now by status, how many moved on to Potential /
--                    Onboarding / Customer, and follow-up progress
--   * totals       - the same numbers for the whole sub-department
--   * leads        - the tab counts the Leads screen shows (same predicates as
--                    customer_pipeline_counts(), but only for these teams)
-- The sub-department is identified by department id + team division, never by a
-- name. Only the Super Admin, or the Department Head of that department, may
-- call it. Nothing is stored; nothing is invented: every number is a count of
-- rows in public.customers / public.profiles.
-- Idempotent.
-- =============================================================================

create or replace function public.division_leads_overview(p_department_id uuid, p_division public.team_division)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_teams uuid[];
  v_members jsonb;
  v_totals jsonb;
  v_leads jsonb;
begin
  if not coalesce(private.my_role() = 'SUPER_ADMIN'
                  or (private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() = p_department_id), false) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can view the team overview.' using errcode = '42501';
  end if;

  select coalesce(array_agg(t.id), '{}') into v_teams
    from public.teams t where t.department_id = p_department_id and t.division = p_division;

  -- One row per person of those teams
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

  -- Whole sub-department
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

  -- Same predicates as customer_pipeline_counts().leads, limited to these teams
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

  return jsonb_build_object('teamIds', to_jsonb(v_teams), 'members', v_members, 'totals', v_totals, 'leads', v_leads);
end $$;
revoke all on function public.division_leads_overview(uuid, public.team_division) from public, anon;
grant execute on function public.division_leads_overview(uuid, public.team_division) to authenticated;
