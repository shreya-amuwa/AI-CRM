-- =============================================================================
-- Company workflow (Super Admin): the whole company as one diagram.
--
--   company_workflow()   Super Admin only. Returns, read from the live tables:
--     * departments, their teams (sub-departments, with the Sales / Support / General division),
--       the Department Heads, Team Leads and members of each (names, roles and job titles only);
--     * the hand-offs that already exist in the CRM, each with the number of records that went through it:
--         Sales/Support -> Accounts (Send to Accounts), Accounts -> back to the team (payment confirmed / returned),
--         team -> Technical Consultant, Technical Consultant -> Department Head -> Team Lead -> Team Member,
--         team -> delivery department (services that skip the consultant), support ticket escalation,
--         Department Head -> Team Lead tasks, leave approval Department Head -> HR, add-ons -> Accounts.
--   Nothing is typed into the diagram: a new department, team, person or reassignment shows up on the next read, and a
--   hand-off is only returned when both ends exist (no consultant in a department, no consultant hand-off).
--   No e-mail, phone, password or token is returned.
-- Run after 20261112000200_paid_only_invoices.sql. Safe to run again.
-- =============================================================================

create or replace function public.company_workflow()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_accounts uuid;
  v_hr uuid;
  v_departments jsonb;
  v_teams jsonb;
  v_heads jsonb;
  v_members jsonb;
  v_handoffs jsonb := '[]'::jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can see the company workflow.' using errcode = '42501';
  end if;

  select id into v_accounts from public.departments where slug = 'accounts';
  select id into v_hr from public.departments where slug = 'hr';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name, 'category', d.category, 'description', d.description,
           'accent', d.accent_color, 'locked', d.is_locked, 'generatesRevenue', d.generates_revenue,
           'staff', (select count(*) from public.profiles p where p.department_id = d.id and p.status = 'ACTIVE'),
           'customers', (select count(*) from public.customers c where c.department_id = d.id)
         ) order by d.name), '[]'::jsonb)
    into v_departments from public.departments d;

  -- teams are the sub-departments
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'departmentId', t.department_id, 'name', t.name, 'division', t.division,
           'leadCount', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'),
           'memberCount', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER'),
           'consultantCount', (select count(*) from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.is_technical_consultant),
           'customers', (select count(*) from public.customers c where c.team_id = t.id)
         ) order by t.name), '[]'::jsonb)
    into v_teams from public.teams t;

  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'departmentId', p.department_id) order by p.full_name), '[]'::jsonb)
    into v_heads from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' and p.department_id is not null;

  -- people: name, role and title only
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'role', p.role, 'title', p.position, 'teamId', p.team_id, 'departmentId', p.department_id,
           'consultant', coalesce(p.is_technical_consultant, false)) order by p.role, p.full_name), '[]'::jsonb)
    into v_members from public.profiles p
   where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.team_id is not null;

  -- 1. Sales / Support -> Accounts: "Send to Accounts" (payment confirmation)
  if v_accounts is not null then
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'to-accounts:' || t.id, 'process', 'payment',
               'from', jsonb_build_object('kind', 'team', 'id', t.id), 'to', jsonb_build_object('kind', 'department', 'id', v_accounts),
               'label', 'Send to Accounts', 'hint', 'Payment is recorded and verified by Accounts',
               'count', coalesce(r.n, 0), 'countLabel', 'waiting for Accounts') order by t.name)
        from public.teams t
        left join (select c.team_id, count(*) n from public.payment_requests pr join public.customers c on c.id = pr.customer_id
                    where pr.status = 'PENDING' group by c.team_id) r on r.team_id = t.id
       where t.division in ('SALES', 'SUPPORT') and t.department_id <> v_accounts), '[]'::jsonb);

    -- 2. Accounts -> back to the team: payment confirmed / returned
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'from-accounts:' || t.id, 'process', 'payment',
               'from', jsonb_build_object('kind', 'department', 'id', v_accounts), 'to', jsonb_build_object('kind', 'team', 'id', t.id),
               'label', 'Confirm payment and return', 'hint', 'The same customer goes on to onboarding; or back to leads with a reason',
               'count', coalesce(r.confirmed, 0), 'countLabel', 'confirmed', 'extra', jsonb_build_object('returned', coalesce(r.returned, 0))) order by t.name)
        from public.teams t
        left join (select c.team_id,
                          count(*) filter (where c.payment_workflow = 'PAYMENT_CONFIRMED') confirmed,
                          count(*) filter (where c.payment_workflow = 'RETURNED_FROM_ACCOUNTS') returned
                     from public.customers c group by c.team_id) r on r.team_id = t.id
       where t.division in ('SALES', 'SUPPORT') and t.department_id <> v_accounts), '[]'::jsonb);

    -- 3. Technical Consultant -> Accounts: add-on (extra service) price verification and payment
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'addon:' || t.id, 'process', 'addon',
               'from', jsonb_build_object('kind', 'consultants', 'id', t.id), 'to', jsonb_build_object('kind', 'department', 'id', v_accounts),
               'label', 'Add-on to Accounts', 'hint', 'A client asked for another service: Accounts verifies the price and the payment',
               'count', coalesce(r.n, 0), 'countLabel', 'in the add-on workflow') order by t.name)
        from public.teams t
        left join (select c.department_id, count(*) n from public.service_requests sr join public.customers c on c.id = sr.customer_id
                    where sr.status = 'IN_ADDON_WORKFLOW' group by c.department_id) r on r.department_id = t.department_id
       where t.division = 'SUPPORT' and t.department_id <> v_accounts
         and exists (select 1 from public.profiles p where p.team_id = t.id and p.status = 'ACTIVE' and p.is_technical_consultant)), '[]'::jsonb);
  end if;

  -- 4. Sales / Support -> Technical Consultant (only where the department has consultants)
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'to-consultant:' || s.id || ':' || k.id, 'process', 'onboarding',
             'from', jsonb_build_object('kind', 'team', 'id', s.id), 'to', jsonb_build_object('kind', 'consultants', 'id', k.id),
             'label', 'Send to Technical Consultant', 'hint', 'Documents are saved, then reviewed and authorized by the consultant',
             'count', coalesce(r.n, 0), 'countLabel', 'with the consultant') order by s.name)
      from public.teams s
      join public.teams k on k.department_id = s.department_id and k.division = 'SUPPORT'
                         and exists (select 1 from public.profiles p where p.team_id = k.id and p.status = 'ACTIVE' and p.is_technical_consultant)
      left join (select c.team_id, count(*) n from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                  where o.with_consultant and o.handover_stage = 'CONSULTANT' group by c.team_id) r on r.team_id = s.id
     where s.division in ('SALES', 'SUPPORT') and (v_accounts is null or s.department_id <> v_accounts)), '[]'::jsonb);

  -- 5. Technical Consultant -> Department Head (client panel and login ready)
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'consultant-to-head:' || k.id, 'process', 'onboarding',
             'from', jsonb_build_object('kind', 'consultants', 'id', k.id), 'to', jsonb_build_object('kind', 'head', 'id', k.department_id),
             'label', 'Hand over to Department Head', 'hint', 'Every item is authorized and the client login exists',
             'count', coalesce(r.n, 0), 'countLabel', 'with the Department Head') order by k.name)
      from public.teams k
      left join (select c.department_id, count(*) n from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                  where o.handover_stage = 'DEPARTMENT_HEAD' group by c.department_id) r on r.department_id = k.department_id
     where k.division = 'SUPPORT'
       and exists (select 1 from public.profiles p where p.team_id = k.id and p.status = 'ACTIVE' and p.is_technical_consultant)), '[]'::jsonb);

  -- 6. Department Head -> Team Lead (customers passed on, by the team the lead is in); the lead then assigns a member
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'head-to-lead:' || x.team_id, 'process', 'onboarding',
             'from', jsonb_build_object('kind', 'head', 'id', x.department_id), 'to', jsonb_build_object('kind', 'team', 'id', x.team_id),
             'label', 'Pass to Team Lead', 'hint', 'The Team Lead assigns the customer to a Team Member',
             'count', x.n, 'countLabel', 'passed to the Team Lead', 'extra', jsonb_build_object('assignedToMember', x.assigned)) order by x.team_id)
      from (select p.department_id, p.team_id, count(*) n, count(*) filter (where o.team_member_id is not null) assigned
              from public.customer_onboarding o join public.profiles p on p.id = o.team_lead_id
             where p.team_id is not null group by p.department_id, p.team_id) x), '[]'::jsonb);

  -- 7. Delivery: services that skip the consultant go to their own department
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'delivery:' || s.id || ':' || x.dept, 'process', 'delivery',
             'from', jsonb_build_object('kind', 'team', 'id', s.id), 'to', jsonb_build_object('kind', 'department', 'id', x.dept),
             'label', 'Send to delivery department', 'hint', 'Services that need no consultant are delivered by their own department',
             'count', coalesce(r.n, 0), 'countLabel', 'sent', 'extra', jsonb_build_object('services', x.services)) order by s.name)
      from (select delivery_department_id dept, count(*) services from public.crm_services where delivery_department_id is not null group by 1) x
      join public.teams s on s.division in ('SALES', 'SUPPORT') and s.department_id <> x.dept and (v_accounts is null or s.department_id <> v_accounts)
      left join (select c.team_id, cs.delivery_department_id dept, count(*) n
                   from public.customer_services cs join public.customers c on c.id = cs.customer_id
                  where cs.sent_to_delivery_at is not null group by 1, 2) r on r.team_id = s.id and r.dept = x.dept), '[]'::jsonb);

  -- 8. Support ticket escalation: team -> Department Head
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'escalation:' || t.id, 'process', 'tickets',
             'from', jsonb_build_object('kind', 'team', 'id', t.id), 'to', jsonb_build_object('kind', 'head', 'id', t.department_id),
             'label', 'Ticket escalation', 'hint', 'A ticket moves from the member to the Team Lead, then to the Department Head',
             'count', coalesce(r.dh, 0), 'countLabel', 'open at the Department Head', 'extra', jsonb_build_object('atTeamLead', coalesce(r.tl, 0), 'open', coalesce(r.n, 0))) order by t.name)
      from public.teams t
      left join (select department_id,
                        count(*) n,
                        count(*) filter (where escalation_level = 'TL') tl,
                        count(*) filter (where escalation_level = 'DH') dh
                   from public.support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED') group by department_id) r
             on r.department_id = t.department_id
     where t.division = 'SUPPORT'), '[]'::jsonb);

  -- 9. Work tasks: Department Head -> Team Lead
  v_handoffs := v_handoffs || coalesce((
    select jsonb_agg(jsonb_build_object(
             'key', 'tasks:' || x.team_id, 'process', 'tasks',
             'from', jsonb_build_object('kind', 'head', 'id', x.department_id), 'to', jsonb_build_object('kind', 'team', 'id', x.team_id),
             'label', 'Assign task to Team Lead', 'hint', 'The lead splits it between members; updates come back up',
             'count', x.open_n, 'countLabel', 'open', 'extra', jsonb_build_object('total', x.n, 'completed', x.done)) order by x.team_id)
      from (select w.department_id, p.team_id, count(*) n,
                   count(*) filter (where w.status not in ('COMPLETED', 'NOT_COMPLETED')) open_n,
                   count(*) filter (where w.status = 'COMPLETED') done
              from public.work_tasks w join public.profiles p on p.id = w.assignee_id
             where w.parent_id is null and p.team_id is not null and p.role = 'TEAM_HEAD' group by w.department_id, p.team_id) x), '[]'::jsonb);

  -- 10. Leave: Department Head -> HR
  if v_hr is not null then
    v_handoffs := v_handoffs || coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', 'leave:' || d.id, 'process', 'leave',
               'from', jsonb_build_object('kind', 'head', 'id', d.id), 'to', jsonb_build_object('kind', 'department', 'id', v_hr),
               'label', 'Leave to HR', 'hint', 'Approved by the Department Head, then decided by HR',
               'count', coalesce(r.hr, 0), 'countLabel', 'waiting for HR', 'extra', jsonb_build_object('waitingForHead', coalesce(r.dh, 0))) order by d.name)
        from public.departments d
        left join (select department_id,
                          count(*) filter (where status = 'PENDING_HR') hr,
                          count(*) filter (where status = 'PENDING_DEPARTMENT_HEAD') dh
                     from public.leave_requests group by department_id) r on r.department_id = d.id
       where d.id <> v_hr), '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'accountsDepartmentId', v_accounts,
    'hrDepartmentId', v_hr,
    'departments', v_departments,
    'teams', v_teams,
    'heads', v_heads,
    'people', v_members,
    'handoffs', v_handoffs);
end $$;

revoke all on function public.company_workflow() from public, anon;
grant execute on function public.company_workflow() to authenticated;
