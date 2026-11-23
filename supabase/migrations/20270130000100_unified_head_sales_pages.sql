-- =============================================================================
-- International and Reseller (PR 2 of 3): the Department Head's Sales pages. Run after 20270127000100_international_reseller_departments.sql.
-- Additive and safe to run twice; every existing department behaves exactly as before.
--
-- The Sales Department Head's pages (Leads, Lead Assign, Tasks, Team people, Overview, Reports) are guarded by private.require_sales_head(), which only
-- accepts a head whose side is Sales. The Department Head of a unified department has no side (both), so they were refused with "This page is for the Sales
-- Department Head" although the data rules already scope them to their own department. The guard now also accepts the Department Head of a unified
-- department; the two overview functions that read the teams of the Sales division read the department's unified team too.
-- =============================================================================
create or replace function private.require_sales_head()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_sales_head()
          or (private.my_role() = 'DEPARTMENT_HEAD' and private.dept_is_unified(private.my_department_id()))) then
    raise exception 'FORBIDDEN: This page is for the Sales Department Head.' using errcode = '42501';
  end if;
end $$;

-- public.sales_head_overview
CREATE OR REPLACE FUNCTION public.sales_head_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dept uuid := private.my_department_id();
  v_today date := private.hr_today();
  v_eod timestamptz := (private.hr_today() + 1)::timestamp at time zone 'Asia/Kolkata';
  v_out jsonb;
  v_income jsonb;
begin
  perform private.require_sales_head();
  begin
    v_income := (public.department_income_report(v_dept, null, null) -> 'byDivision' -> 'sales');
  exception when others then v_income := null;
  end;
  with b as (select * from private.sales_leads_base(v_dept)),
  staff as (select p.id, p.full_name, p.role, p.sales_sub_role, t.name team_name from public.profiles p join public.teams t on t.id = p.team_id
             where p.department_id = v_dept and (t.division = 'SALES' or private.team_unified(t.id)) and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')),
  tk as (select w.*, tm.name team_name from public.work_tasks w join public.teams tm on tm.id = w.team_id and (tm.division = 'SALES' or private.team_unified(tm.id))
          where w.department_id = v_dept and not exists (select 1 from public.work_tasks c where c.parent_id = w.id)),
  fu as (select 1 from b where not converted and follow_up is not null and follow_up < v_eod),
  tcfu as (select 1 from public.telecaller_contacts c where c.department_id = v_dept and c.call_status = 'FOLLOW_UP_REQUIRED' and c.follow_up_date is not null and c.follow_up_date <= v_today)
  select jsonb_build_object(
    'cards', jsonb_build_object(
      'totalLeads', (select count(*) from b), 'hot', (select count(*) from b where temperature = 'HOT'), 'warm', (select count(*) from b where temperature = 'WARM'),
      'cold', (select count(*) from b where temperature = 'COLD'), 'assigned', (select count(*) from b where kind = 'CUSTOMER'), 'pendingAssignment', (select count(*) from b where kind = 'INBOUND'),
      'teamMembers', (select count(*) from staff), 'tasksPending', (select count(*) from tk where status <> 'COMPLETED'), 'tasksCompleted', (select count(*) from tk where status = 'COMPLETED'),
      'followUpsDue', (select count(*) from fu) + (select count(*) from tcfu), 'converted', (select count(*) from b where converted),
      'income', case when v_income is null then null else (v_income ->> 'collected')::numeric end),
    'statusDistribution', jsonb_build_object(
      'temperature', jsonb_build_object('HOT', (select count(*) from b where temperature = 'HOT'), 'WARM', (select count(*) from b where temperature = 'WARM'), 'COLD', (select count(*) from b where temperature = 'COLD'),
                                        'NONE', (select count(*) from b where temperature is null)),
      'callStatus', coalesce((select jsonb_object_agg(coalesce(call_status, 'NONE'), n) from (select call_status, count(*) n from b group by 1) q), '{}'::jsonb)),
    'recentActivities', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('at', a.occurred_at, 'type', a.type, 'note', a.note, 'customer', c.name, 'customerId', c.id, 'by', (select p.full_name from public.profiles p where p.id = a.actor_id)) x
          from public.customer_activities a join public.customers c on c.id = a.customer_id join public.teams t on t.id = c.team_id and (t.division = 'SALES' or private.team_unified(t.id))
         where c.department_id = v_dept order by a.occurred_at desc limit 8) q), '[]'::jsonb),
    'teamActivity', coalesce((select jsonb_agg(x order by (x ->> 'leads')::int desc) from (
        select jsonb_build_object('id', s.id, 'name', s.full_name, 'role', case s.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end, 'team', s.team_name,
          'leads', (select count(*) from b where b.owner_id = s.id), 'contacted7d', (select count(*) from b where b.owner_id = s.id and b.last_contacted > now() - interval '7 days'),
          'tasksOpen', (select count(*) from tk where tk.assignee_id = s.id and tk.status <> 'COMPLETED'), 'tasksDone', (select count(*) from tk where tk.assignee_id = s.id and tk.status = 'COMPLETED')) x
          from staff s) q), '[]'::jsonb),
    'upcomingFollowUps', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', id, 'name', name, 'company', company, 'followUp', follow_up, 'assignee', owner_name, 'temperature', temperature) x
          from b where not converted and follow_up is not null order by follow_up limit 8) q), '[]'::jsonb),
    'pendingTasks', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', tk.id, 'title', tk.title, 'dueDate', tk.due_date, 'priority', tk.priority, 'status', tk.status,
          'assignee', (select p.full_name from public.profiles p where p.id = tk.assignee_id), 'overdue', tk.due_date is not null and tk.due_date < v_today) x
          from tk where tk.status <> 'COMPLETED' order by (tk.due_date < v_today) desc nulls last, tk.due_date nulls last limit 8) q), '[]'::jsonb),
    'recentSheets', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', s.id, 'fileName', s.file_name, 'mode', s.mode, 'valid', s.valid_count, 'assignedAt', s.assigned_at,
          'assignedTo', (select p.full_name from public.profiles p where p.id = s.assigned_to)) x from public.sales_lead_sheets s where s.department_id = v_dept order by s.uploaded_at desc limit 5) q), '[]'::jsonb),
    'recentConversions', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', c.id, 'name', c.name, 'company', c.company, 'stage', c.lifecycle_stage, 'at', c.stage_changed_at,
          'owner', (select p.full_name from public.profiles p where p.id = c.owner_id)) x
          from public.customers c join b on b.id = c.id::text where b.converted order by c.stage_changed_at desc limit 5) q), '[]'::jsonb),
    'highlights', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', s.id, 'name', s.full_name,
          'tasksDone', (select count(*) from tk where tk.assignee_id = s.id and tk.status = 'COMPLETED'), 'converted', (select count(*) from b where b.owner_id = s.id and b.converted)) x
          from staff s order by (select count(*) from tk where tk.assignee_id = s.id and tk.status = 'COMPLETED') + (select count(*) from b where b.owner_id = s.id and b.converted) desc, s.full_name limit 3) q), '[]'::jsonb),
    'today', v_today)
    into v_out;
  return v_out;
end $function$;

-- public.sales_head_reports
CREATE OR REPLACE FUNCTION public.sales_head_reports(p_who text, p_from date, p_to date, p_task_status text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dept uuid := private.my_department_id();
  v_today date := private.hr_today();
  v_who text := upper(coalesce(p_who, 'TEAM_MEMBER'));
  v_from date := coalesce(p_from, v_today - 29);
  v_to date := coalesce(p_to, v_today);
  v_status text := upper(nullif(btrim(coalesce(p_task_status, '')), ''));
  v_rows jsonb;
begin
  perform private.require_sales_head();
  if v_who not in ('TEAM_LEAD', 'TEAM_MEMBER') then raise exception 'VALIDATION_ERROR: Choose Team Lead or Team Member.' using errcode = 'P0001'; end if;
  if v_to < v_from then raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001'; end if;
  if v_to - v_from > 400 then raise exception 'VALIDATION_ERROR: Choose a period of at most 400 days.' using errcode = 'P0001'; end if;
  if v_status is not null and v_status not in ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE') then raise exception 'VALIDATION_ERROR: Unknown task status.' using errcode = 'P0001'; end if;
  with b as (select * from private.sales_leads_base(v_dept) where kind = 'CUSTOMER'),
  tk as (select w.* from public.work_tasks w join public.teams tm on tm.id = w.team_id and (tm.division = 'SALES' or private.team_unified(tm.id))
          where w.department_id = v_dept and not exists (select 1 from public.work_tasks c where c.parent_id = w.id)
            and coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between v_from and v_to
            and (v_status is null or case v_status when 'PENDING' then w.status = 'ASSIGNED' when 'IN_PROGRESS' then w.status = 'IN_PROGRESS' when 'COMPLETED' then w.status = 'COMPLETED'
                                                  else w.due_date is not null and w.status <> 'COMPLETED' and w.due_date < v_today end)),
  p as (select pr.id, pr.full_name, pr.role, pr.sales_sub_role, pr.team_id, t.name team_name
          from public.profiles pr join public.teams t on t.id = pr.team_id and (t.division = 'SALES' or private.team_unified(t.id))
         where pr.department_id = v_dept and pr.status = 'ACTIVE' and pr.role = case when v_who = 'TEAM_LEAD' then 'TEAM_HEAD'::public.app_role else 'TEAM_MEMBER'::public.app_role end)
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', p.team_name, 'subRole', p.sales_sub_role,
      'members', case when v_who = 'TEAM_LEAD' then (select count(*) from public.profiles m where m.team_id = p.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE') end,
      'leadsAssigned', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.assigned_at::date between v_from and v_to),
      'leadsContacted', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.last_contacted::date between v_from and v_to),
      'hot', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.temperature = 'HOT'),
      'warm', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.temperature = 'WARM'),
      'cold', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.temperature = 'COLD'),
      'followUps', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and not b.converted and (b.call_status = 'FOLLOW_UP_REQUIRED' or b.follow_up is not null)),
      'conversions', (select count(*) from b where (v_who = 'TEAM_LEAD' and b.team_name = p.team_name or v_who = 'TEAM_MEMBER' and b.owner_id = p.id) and b.converted),
      'tasksAssigned', (select count(*) from tk where (v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)),
      'tasksCompleted', (select count(*) from tk where ((v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)) and tk.status = 'COMPLETED'),
      'tasksPending', (select count(*) from tk where ((v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)) and tk.status <> 'COMPLETED'),
      'tasksOverdue', (select count(*) from tk where ((v_who = 'TEAM_LEAD' and tk.team_id = p.team_id) or (v_who = 'TEAM_MEMBER' and tk.assignee_id = p.id)) and tk.due_date is not null and tk.due_date < v_today and tk.status <> 'COMPLETED')
    ) order by p.team_name, p.full_name), '[]'::jsonb) into v_rows from p;
  return jsonb_build_object('who', v_who, 'from', v_from, 'to', v_to, 'taskStatus', v_status, 'rows', v_rows, 'today', v_today);
end $function$;

-- public.division_leads_overview: a unified department has one team that does both, so either side shows it
CREATE OR REPLACE FUNCTION public.division_leads_overview(p_department_id uuid, p_division team_division)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_teams uuid[];
  v_members jsonb;
  v_totals jsonb;
  v_leads jsonb;
  v_potential jsonb;
  v_onboarding jsonb;
  v_part integer;
begin
  if not coalesce(private.my_role() = 'SUPER_ADMIN'
                  or (private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() = p_department_id), false) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can view the team overview.' using errcode = '42501';
  end if;

  select coalesce(array_agg(t.id), '{}') into v_teams
    from public.teams t where t.department_id = p_department_id and (t.division = p_division or private.team_unified(t.id));

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

  -- Same predicates as customer_pipeline_counts().onboarding
  select jsonb_build_object(
    'all', count(*),
    'RETURNED', count(*) filter (where returned),
    'WAITING_ON_CLIENT', count(*) filter (where not returned and saved = 0),
    'COLLECTING', count(*) filter (where not returned and saved > 0 and saved < total),
    'READY_FOR_HANDOVER', count(*) filter (where not returned and total > 0 and saved >= total),
    'GET_STARTED', count(*) filter (where get_started))
    into v_onboarding
  from (select coalesce(o.items_saved, 0) as saved, coalesce(o.items_total, 0) as total,
               o.returned_at is not null as returned, coalesce(o.get_started, false) as get_started
          from public.customers c
          left join public.customer_onboarding o on o.customer_id = c.id
         where c.team_id = any (v_teams) and c.lifecycle_stage = 'ONBOARDING') x;

  -- Same predicate as customer_pipeline_counts().partPayments
  select count(*) into v_part
    from public.customers c
   where c.team_id = any (v_teams) and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and c.payment_status = 'PARTIALLY_PAID'
     and exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART');

  return jsonb_build_object('teamIds', to_jsonb(v_teams), 'members', v_members, 'totals', v_totals, 'leads', v_leads, 'potential', v_potential,
                            'onboarding', v_onboarding, 'partPayments', v_part);
end $function$;

-- public.division_support_overview: a unified department has one team that does both, so either side shows it
CREATE OR REPLACE FUNCTION public.division_support_overview(p_department_id uuid, p_division team_division)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    from public.teams t where t.department_id = p_department_id and (t.division = p_division or private.team_unified(t.id));

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
end $function$;
