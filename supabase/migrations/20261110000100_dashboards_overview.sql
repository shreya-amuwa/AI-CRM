-- Dashboards: one company-wide view for the Super Admin, one scoped view for everyone who leads people.
--
-- WHY. The Super Admin landed on a hub of department cards with no numbers, the Sales Team Lead dashboard ran on a browser-only
-- mock store, and the Department Head overview showed tasks but nothing about the customers of the department. Every figure below is
-- worked out here, from the real records, so the screens never calculate (or invent) a total of their own.
--
--   dashboard_company_overview()      Super Admin only. Company-wide: customers by stage, money, invoices, onboarding, tickets, a
--                                     row per department, the income / expense trend, what needs attention, recent activity.
--   dashboard_scope_overview(dept)    Team Lead (the team), Department Head (the department), Super Admin (all, or one department named).
--                                     The scope comes from the caller's role in the database, never from the request.
--
-- Definitions (also shown in the screens):
--   customers by stage      one row of public.customers is one record; LEAD, POTENTIAL, ONBOARDING, CUSTOMER, LOST.
--   income                  verified payments only (private.verified_income): pending and rejected payments are never income.
--   outstanding balance     customers in ONBOARDING / CUSTOMER with an agreed total payable: total payable - verified payments (never < 0).
--   invoices                public.member_invoices (every invoice once), by its Paid / Pending / Overdue status.
--   stalled onboarding      in ONBOARDING and no stage change for 14 days.
--   pending confirmation    a payment_requests row still PENDING (Sales sent it, Accounts has not confirmed).
--
-- Run after 20261108000100_chat.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- Company-wide (Super Admin)
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_company_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_month date := date_trunc('month', current_date)::date;
  v_prev date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_customers jsonb;
  v_money jsonb;
  v_invoices jsonb;
  v_onboarding jsonb;
  v_tickets jsonb;
  v_departments jsonb;
  v_alerts jsonb := '[]'::jsonb;
  v_recent jsonb;
  v_trend jsonb;
  v_pending_n bigint; v_pending_sum numeric; v_pending_old bigint;
  v_stalled bigint; v_failed_inv bigint; v_failed_login bigint; v_failed_jobs bigint; v_locked bigint;
  t jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can see the company-wide dashboard.' using errcode = '42501';
  end if;

  select jsonb_build_object(
           'total', count(*),
           'leads', count(*) filter (where lifecycle_stage = 'LEAD'),
           'potential', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
           'onboarding', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
           'customers', count(*) filter (where lifecycle_stage = 'CUSTOMER'),
           'lost', count(*) filter (where lifecycle_stage = 'LOST'))
    into v_customers from public.customers;

  select count(*), coalesce(sum(agreed_amount), 0), count(*) filter (where requested_at < now() - interval '2 days')
    into v_pending_n, v_pending_sum, v_pending_old
    from public.payment_requests where status = 'PENDING';

  select jsonb_build_object(
           'incomeThisMonth', coalesce(sum(p.amount) filter (where p.paid_at::date >= v_month), 0),
           'incomeLastMonth', coalesce(sum(p.amount) filter (where p.paid_at::date >= v_prev and p.paid_at::date < v_month), 0),
           'incomeTotal', coalesce(sum(p.amount), 0))
    into v_money from private.verified_income() p;

  v_money := v_money || (
    select jsonb_build_object(
             'expensesThisMonth', coalesce(sum(e.amount) filter (where e.expense_date >= v_month), 0),
             'expensesLastMonth', coalesce(sum(e.amount) filter (where e.expense_date >= v_prev and e.expense_date < v_month), 0),
             'expensesTotal', coalesce(sum(e.amount), 0),
             'expensesPending', coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0))
      from public.department_expenses e);

  v_money := v_money || jsonb_build_object(
    'pendingConfirmations', v_pending_n,
    'pendingConfirmationsAmount', v_pending_sum,
    'unverifiedPayments', (select count(*) from public.customer_payments where status = 'PENDING'),
    'unverifiedPaymentsAmount', (select coalesce(sum(amount), 0) from public.customer_payments where status = 'PENDING'),
    'outstandingBalance', (select coalesce(sum(greatest(c.deal_amount - c.amount_verified, 0)), 0) from public.customers c
                            where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(c.deal_amount, 0) > 0),
    'customersWithBalance', (select count(*) from public.customers c
                              where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(c.deal_amount, 0) > 0 and c.amount_verified < c.deal_amount));

  select jsonb_build_object(
           'count', count(*),
           'total', coalesce(sum(amount), 0),
           'paid', count(*) filter (where status = 'Paid'),
           'paidAmount', coalesce(sum(amount) filter (where status = 'Paid'), 0),
           'pending', count(*) filter (where status = 'Pending'),
           'pendingAmount', coalesce(sum(amount) filter (where status = 'Pending'), 0),
           'overdue', count(*) filter (where status = 'Overdue'),
           'overdueAmount', coalesce(sum(amount) filter (where status = 'Overdue'), 0))
    into v_invoices from public.member_invoices;

  select jsonb_build_object(
           'inProgress', count(*),
           'withConsultant', count(*) filter (where o.with_consultant),
           'byStage', jsonb_build_object(
             'SALES_CONSULTATION', count(*) filter (where o.stage = 'SALES_CONSULTATION'),
             'COLLECT_REQUIREMENTS', count(*) filter (where o.stage = 'COLLECT_REQUIREMENTS'),
             'SETUP', count(*) filter (where o.stage = 'SETUP'),
             'APPROVAL', count(*) filter (where o.stage = 'APPROVAL'),
             'HANDOVER', count(*) filter (where o.stage = 'HANDOVER'),
             'COMPLETED', count(*) filter (where o.stage = 'COMPLETED')),
           'itemsTotal', coalesce(sum(o.items_total), 0),
           'itemsSaved', coalesce(sum(o.items_saved), 0),
           'itemsVerified', coalesce(sum(o.items_verified), 0),
           'itemsRejected', coalesce(sum(o.items_rejected), 0))
    into v_onboarding
    from public.customers c join public.customer_onboarding o on o.customer_id = c.id
   where c.lifecycle_stage = 'ONBOARDING';

  select count(*) into v_stalled from public.customers c
   where c.lifecycle_stage = 'ONBOARDING' and c.stage_changed_at < now() - interval '14 days';

  select jsonb_build_object(
           'open', count(*),
           'escalated', count(*) filter (where status = 'ESCALATED'),
           'unassigned', count(*) filter (where assignee_id is null),
           'pastSla', count(*) filter (where sla_due_at is not null and sla_due_at < now()))
    into v_tickets from public.support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED');

  -- one row per department: every figure is a grouped sub-query joined on the department, so nothing is multiplied by a join
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'name', d.name, 'slug', d.slug, 'locked', d.is_locked, 'generatesRevenue', d.generates_revenue,
           'staff', coalesce(s.n, 0),
           'leads', coalesce(c.leads, 0), 'potential', coalesce(c.potential, 0), 'onboarding', coalesce(c.onboarding, 0),
           'customers', coalesce(c.customers, 0), 'lost', coalesce(c.lost, 0), 'records', coalesce(c.records, 0),
           'conversionPct', case when coalesce(c.records, 0) - coalesce(c.lost, 0) > 0
                                 then round(100.0 * (coalesce(c.onboarding, 0) + coalesce(c.customers, 0)) / (c.records - c.lost), 1) end,
           'income', coalesce(i.amount, 0), 'incomeThisMonth', coalesce(i.this_month, 0),
           'expenses', coalesce(x.amount, 0), 'expensesPending', coalesce(x.pending, 0),
           'outstanding', coalesce(c.outstanding, 0),
           'openTickets', coalesce(t.n, 0), 'pastSla', coalesce(t.past_sla, 0)) order by d.name), '[]'::jsonb)
    into v_departments
    from public.departments d
    left join (select department_id, count(*) n from public.profiles where status = 'ACTIVE' group by department_id) s on s.department_id = d.id
    left join (select department_id,
                      count(*) records,
                      count(*) filter (where lifecycle_stage = 'LEAD') leads,
                      count(*) filter (where lifecycle_stage = 'POTENTIAL') potential,
                      count(*) filter (where lifecycle_stage = 'ONBOARDING') onboarding,
                      count(*) filter (where lifecycle_stage = 'CUSTOMER') customers,
                      count(*) filter (where lifecycle_stage = 'LOST') lost,
                      coalesce(sum(greatest(deal_amount - amount_verified, 0)) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0), 0) outstanding
                 from public.customers group by department_id) c on c.department_id = d.id
    left join (select c2.department_id, sum(p.amount) amount, sum(p.amount) filter (where p.paid_at::date >= v_month) this_month
                 from private.verified_income() p join public.customers c2 on c2.id = p.customer_id group by c2.department_id) i on i.department_id = d.id
    left join (select department_id, sum(amount) amount, sum(amount) filter (where payment_status = 'PENDING') pending
                 from public.department_expenses where department_id is not null group by department_id) x on x.department_id = d.id
    left join (select department_id, count(*) n, count(*) filter (where sla_due_at is not null and sla_due_at < now()) past_sla
                 from public.support_tickets where status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED') group by department_id) t on t.department_id = d.id;

  select count(*) into v_failed_inv from public.generated_invoices
   where 'FAILED' in (unpaid_pdf_status, unpaid_email_status, paid_pdf_status, paid_email_status);
  select count(*) into v_failed_login from public.customer_client_provisioning where status = 'FAILED';
  select count(*) into v_failed_jobs from public.automation_jobs where status = 'FAILED' and created_at > now() - interval '7 days';
  select count(*) into v_locked from public.departments where is_locked;

  -- What needs attention: only exceptions that exist, each with its own plain definition.
  if v_pending_old > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'confirmations_late', 'severity', 'high', 'count', v_pending_old, 'page', 'overview',
      'title', 'Payment confirmations waiting more than 2 days', 'hint', 'Sent by Sales, not yet confirmed or returned by Accounts');
  end if;
  if (v_tickets ->> 'pastSla')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'tickets_sla', 'severity', 'high', 'count', (v_tickets ->> 'pastSla')::int,
      'title', 'Open tickets past their SLA', 'hint', 'Customers still waiting for a reply after the promised time');
  end if;
  if (v_tickets ->> 'escalated')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'tickets_escalated', 'severity', 'medium', 'count', (v_tickets ->> 'escalated')::int,
      'title', 'Escalated tickets', 'hint', 'Raised to a lead or head and still open');
  end if;
  if (v_tickets ->> 'unassigned')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'tickets_unassigned', 'severity', 'medium', 'count', (v_tickets ->> 'unassigned')::int,
      'title', 'Open tickets with nobody assigned', 'hint', 'No staff member owns the reply');
  end if;
  if (v_invoices ->> 'overdue')::int > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'invoices_overdue', 'severity', 'high', 'count', (v_invoices ->> 'overdue')::int,
      'title', 'Overdue invoices', 'hint', 'Invoices marked Overdue, totalling ' || private.rupees((v_invoices ->> 'overdueAmount')::numeric));
  end if;
  if v_failed_inv > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'invoice_delivery', 'severity', 'medium', 'count', v_failed_inv,
      'title', 'Invoices whose PDF or e-mail failed', 'hint', 'Accounts can retry them from the invoice');
  end if;
  if v_stalled > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'onboarding_stalled', 'severity', 'medium', 'count', v_stalled,
      'title', 'Onboarding with no progress for 14 days', 'hint', 'Customers whose stage has not changed in two weeks');
  end if;
  if v_failed_login > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'client_logins', 'severity', 'medium', 'count', v_failed_login,
      'title', 'Client logins that could not be created', 'hint', 'Accounts or the consultant must retry');
  end if;
  if v_failed_jobs > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'automation_failed', 'severity', 'low', 'count', v_failed_jobs,
      'title', 'Customer e-mails or WhatsApp messages that failed (7 days)', 'hint', 'Failed sends can be retried from the customer');
  end if;
  if (v_money ->> 'expensesPending')::numeric > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'expenses_pending', 'severity', 'low', 'count', (select count(*) from public.department_expenses where payment_status = 'PENDING'),
      'title', 'Expenses still to be paid', 'hint', private.rupees((v_money ->> 'expensesPending')::numeric) || ' recorded as pending');
  end if;
  if v_locked > 0 then
    v_alerts := v_alerts || jsonb_build_object('key', 'locked_departments', 'severity', 'low', 'count', v_locked,
      'title', 'Locked departments', 'hint', 'Their staff cannot sign in to them until unlocked');
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('at', a.occurred_at, 'type', a.type, 'note', left(coalesce(a.note, ''), 160),
             'customerId', c.id, 'customer', coalesce(c.company, c.name), 'department', d.name, 'actor', p.full_name) as x
      from public.customer_activities a
      join public.customers c on c.id = a.customer_id
      left join public.departments d on d.id = c.department_id
      left join public.profiles p on p.id = a.actor_id
     order by a.occurred_at desc limit 12) r;

  -- the same trend Accounts sees (verified income vs recorded expenses, month by month)
  t := public.accounts_finance_trend(12);

  return jsonb_build_object(
    'generatedAt', now(),
    'customers', v_customers,
    'money', v_money,
    'invoices', v_invoices,
    'onboarding', v_onboarding || jsonb_build_object('stalled', v_stalled),
    'tickets', v_tickets,
    'departments', v_departments,
    'trend', t -> 'months',
    'alerts', v_alerts,
    'recentActivity', v_recent);
end $$;
revoke all on function public.dashboard_company_overview() from public, anon;
grant execute on function public.dashboard_company_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- Scoped (Team Lead, Department Head; Super Admin for one department)
-- What is counted is decided ONCE, here, from the caller's role (never from anything the browser sends):
--   Super Admin      every record, or one department when named
--   Department Head  their department
--   Team Lead        their team
-- (the same scopes the row-level security policies give these roles on customers, tickets, tasks and people)
-- ---------------------------------------------------------------------------
create or replace function private.scope_customers(p_department uuid)
returns setof public.customers language sql stable security definer set search_path = '' as $$
  select c.* from public.customers c
   where case private.my_role()
           when 'SUPER_ADMIN' then (p_department is null or c.department_id = p_department)
           when 'DEPARTMENT_HEAD' then c.department_id = private.my_department_id()
           when 'TEAM_HEAD' then c.team_id = private.my_team_id()
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
           when 'TEAM_HEAD' then t.team_id = private.my_team_id()
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
           when 'TEAM_HEAD' then w.team_id = private.my_team_id()
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
           when 'TEAM_HEAD' then p.team_id = private.my_team_id()
           else false end
$$;
revoke all on function private.scope_people(uuid) from public, anon, authenticated;

create or replace function public.dashboard_scope_overview(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_dept uuid;
  v_team uuid;
  v_customers jsonb;
  v_pipeline jsonb;
  v_money jsonb;
  v_onboarding jsonb;
  v_tickets jsonb;
  v_tasks jsonb;
  v_members jsonb;
  v_teams jsonb;
  v_recent jsonb;
begin
  if v_role is null or v_role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD') then
    raise exception 'FORBIDDEN: This overview is for Team Leads, Department Heads and the Super Admin.' using errcode = '42501';
  end if;
  v_dept := case v_role when 'SUPER_ADMIN' then p_department else private.my_department_id() end;
  v_team := case v_role when 'TEAM_HEAD' then private.my_team_id() end;

  select jsonb_build_object(
           'total', count(*),
           'leads', count(*) filter (where lifecycle_stage = 'LEAD'),
           'potential', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
           'onboarding', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
           'customers', count(*) filter (where lifecycle_stage = 'CUSTOMER'),
           'lost', count(*) filter (where lifecycle_stage = 'LOST'))
    into v_customers from private.scope_customers(p_department) c;

  select jsonb_build_object(
           'followUpsOverdue', count(*) filter (where lifecycle_stage in ('LEAD', 'POTENTIAL') and next_follow_up_at < now()),
           'followUpsToday', count(*) filter (where lifecycle_stage in ('LEAD', 'POTENTIAL') and next_follow_up_at >= now()
                                                and (next_follow_up_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date),
           'leadsWithoutFollowUp', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at is null),
           'newLeadsThisWeek', count(*) filter (where lifecycle_stage = 'LEAD' and created_at >= now() - interval '7 days'),
           'wonThisMonth', count(*) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and stage_changed_at >= date_trunc('month', now())))
    into v_pipeline from private.scope_customers(p_department) c;

  select jsonb_build_object(
           'pendingConfirmations', (select count(*) from public.payment_requests r join private.scope_customers(p_department) c on c.id = r.customer_id where r.status = 'PENDING'),
           'unverifiedPayments', (select count(*) from public.customer_payments p join private.scope_customers(p_department) c on c.id = p.customer_id where p.status = 'PENDING'),
           'outstandingBalance', coalesce(sum(greatest(deal_amount - amount_verified, 0))
                                   filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0), 0),
           'customersWithBalance', count(*) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(deal_amount, 0) > 0 and amount_verified < deal_amount),
           'verifiedReceived', coalesce(sum(amount_verified), 0))
    into v_money from private.scope_customers(p_department) c;

  select jsonb_build_object(
           'inProgress', count(*),
           'waitingForDepartmentHead', count(*) filter (where o.handover_stage = 'DEPARTMENT_HEAD'),
           'waitingForTeamLead', count(*) filter (where o.handover_stage = 'TEAM_LEAD'),
           'withTeamMember', count(*) filter (where o.handover_stage = 'TEAM_MEMBER'),
           'itemsTotal', coalesce(sum(o.items_total), 0),
           'itemsVerified', coalesce(sum(o.items_verified), 0),
           'stalled', count(*) filter (where c.stage_changed_at < now() - interval '14 days'))
    into v_onboarding
    from private.scope_customers(p_department) c join public.customer_onboarding o on o.customer_id = c.id
   where c.lifecycle_stage = 'ONBOARDING';

  select jsonb_build_object(
           'open', count(*),
           'escalated', count(*) filter (where status = 'ESCALATED'),
           'unassigned', count(*) filter (where assignee_id is null),
           'pastSla', count(*) filter (where sla_due_at is not null and sla_due_at < now()))
    into v_tickets from private.scope_tickets(p_department) t;

  select jsonb_build_object(
           'open', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')),
           'overdue', count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') and due_date < current_date),
           'blocked', count(*) filter (where status = 'BLOCKED'),
           'completedThisWeek', count(*) filter (where status = 'COMPLETED' and completed_at >= now() - interval '7 days'))
    into v_tasks from private.scope_tasks(p_department) w;

  -- Each person once: customers they own, follow-ups, open tasks and when they last logged something.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'role', p.role, 'team', t.name, 'teamId', p.team_id,
           'leads', coalesce(c.leads, 0), 'potential', coalesce(c.potential, 0), 'onboarding', coalesce(c.onboarding, 0),
           'customers', coalesce(c.customers, 0), 'records', coalesce(c.records, 0),
           'followUpsOverdue', coalesce(c.overdue, 0),
           'openTasks', coalesce(w.open_n, 0), 'overdueTasks', coalesce(w.overdue_n, 0),
           'lastActivityAt', a.last_at) order by t.name, p.role desc, p.full_name), '[]'::jsonb)
    into v_members
    from private.scope_people(p_department) p
    join public.teams t on t.id = p.team_id
    left join (select owner_id,
                      count(*) records,
                      count(*) filter (where lifecycle_stage = 'LEAD') leads,
                      count(*) filter (where lifecycle_stage = 'POTENTIAL') potential,
                      count(*) filter (where lifecycle_stage = 'ONBOARDING') onboarding,
                      count(*) filter (where lifecycle_stage = 'CUSTOMER') customers,
                      count(*) filter (where lifecycle_stage in ('LEAD', 'POTENTIAL') and next_follow_up_at < now()) overdue
                 from private.scope_customers(p_department) where lifecycle_stage <> 'LOST' group by owner_id) c on c.owner_id = p.id
    left join (select assignee_id, count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED')) open_n,
                      count(*) filter (where status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') and due_date < current_date) overdue_n
                 from private.scope_tasks(p_department) group by assignee_id) w on w.assignee_id = p.id
    left join (select actor_id, max(occurred_at) last_at from public.customer_activities
                where customer_id in (select id from private.scope_customers(p_department)) group by actor_id) a on a.actor_id = p.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'name', t.name, 'division', t.division,
           'members', coalesce(m.n, 0), 'records', coalesce(c.records, 0), 'leads', coalesce(c.leads, 0),
           'onboarding', coalesce(c.onboarding, 0), 'customers', coalesce(c.customers, 0)) order by t.name), '[]'::jsonb)
    into v_teams
    from public.teams t
    left join (select team_id, count(*) n from private.scope_people(p_department) group by team_id) m on m.team_id = t.id
    left join (select team_id, count(*) records, count(*) filter (where lifecycle_stage = 'LEAD') leads,
                      count(*) filter (where lifecycle_stage = 'ONBOARDING') onboarding, count(*) filter (where lifecycle_stage = 'CUSTOMER') customers
                 from private.scope_customers(p_department) where lifecycle_stage <> 'LOST' group by team_id) c on c.team_id = t.id
   where (v_dept is null or t.department_id = v_dept) and (v_team is null or t.id = v_team);

  select coalesce(jsonb_agg(x order by (x ->> 'at') desc), '[]'::jsonb) into v_recent from (
    select jsonb_build_object('at', a.occurred_at, 'type', a.type, 'note', left(coalesce(a.note, ''), 160),
             'customerId', c.id, 'customer', coalesce(c.company, c.name), 'actor', p.full_name) as x
      from public.customer_activities a
      join private.scope_customers(p_department) c on c.id = a.customer_id
      left join public.profiles p on p.id = a.actor_id
     order by a.occurred_at desc limit 10) r;

  return jsonb_build_object(
    'generatedAt', now(),
    'scope', jsonb_build_object('role', v_role, 'departmentId', v_dept, 'teamId', v_team),
    'customers', v_customers, 'pipeline', v_pipeline, 'money', v_money, 'onboarding', v_onboarding,
    'tickets', v_tickets, 'tasks', v_tasks, 'members', v_members, 'teams', v_teams, 'recentActivity', v_recent);
end $$;
revoke all on function public.dashboard_scope_overview(uuid) from public, anon;
grant execute on function public.dashboard_scope_overview(uuid) to authenticated;

notify pgrst, 'reload schema';
