-- =============================================================================
-- Department Head dashboard: department overview, team attendance, leads, customers and invoices
-- =============================================================================
-- Read-only database functions for the Department Head's own department. No table, no column and no existing policy or function is changed: every number
-- and row comes from the tables the CRM already has (profiles, attendance_records, leave_requests, customers, customer_activities, member_invoices).
--
-- Who and what each function allows
--  * Only an active DEPARTMENT_HEAD. The department is the head's own (private.my_department_id(): their profile and the scope they were granted;
--    a department id is never accepted from the browser). A head sees nothing of any other department, and the Super Admin, Accounts, HR and every other
--    role keep exactly the access they had (they are refused here, and nothing they use was touched).
--  * Attendance comes from attendance_records (the manual Punch In / Punch Out), never from CRM sign-in; leave is leave_requests that are APPROVED.
--    Punch locations are not returned.
--  * Invoices go through the existing invoice permission (private.can_read_invoice) as well as the department check. Nothing here writes: invoice
--    accounting, payments and documents stay with Accounts; opening an invoice or its PDF uses the existing invoice_detail / invoice_file_access.
-- Safe to run twice. Nothing is deleted or rewritten.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (private: not callable by signed-in users)
-- ---------------------------------------------------------------------------
-- The department of the signed-in Department Head, or a refusal for anyone else.
create or replace function private.head_dept()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.my_department_id();
begin
  if private.my_role() is distinct from 'DEPARTMENT_HEAD' or v_dept is null then
    raise exception 'FORBIDDEN: Only a Department Head can see this.' using errcode = '42501';
  end if;
  return v_dept;
end $$;

-- An ISO date stored as text ("2026-11-05") as a date; anything else is null (never an error).
create or replace function private.head_iso_date(p text)
returns date language sql immutable set search_path = '' as $$
  select case when p ~ '^\d{4}-\d{2}-\d{2}$' and substr(p, 6, 2)::int between 1 and 12 and substr(p, 9, 2)::int between 1 and 31
              then (case when to_char(p::date, 'YYYY-MM-DD') = p then p::date end) end
$$;

-- The department's people for one day, with the day's attendance: Present = a punch in on that day; On leave = an approved leave covers the day and
-- there is no punch in; Absent = neither.
create or replace function private.head_attendance_rows(p_dept uuid, p_date date)
returns table (profile_id uuid, name text, role text, designation text, team text, punch_in_at timestamptz, punch_out_at timestamptz,
               leave_id uuid, leave_type text, half_day_shift text, status text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.role::text,
         coalesce(nullif(p.position, ''), private.employee_snapshot(p.id) ->> 'designation'),
         (select t.name from public.teams t where t.id = p.team_id),
         a.punch_in_at, a.punch_out_at, l.id, l.leave_type, l.half_day_shift,
         case when a.punch_in_at is not null then 'PRESENT' when l.id is not null then 'ON_LEAVE' else 'ABSENT' end
    from public.profiles p
    left join public.attendance_records a on a.profile_id = p.id and a.attendance_date = p_date
    left join lateral (select x.id, x.leave_type, x.half_day_shift from public.leave_requests x
                        where x.employee_id = p.id and x.status = 'APPROVED' and p_date between x.start_date and x.end_date
                        order by x.created_at desc limit 1) l on true
   where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
     and private.base_department(p.department_id) = private.base_department(p_dept)
     and private.sales_scope_team(p.team_id)
$$;

-- The department's customers, under the same visibility the customers table already gives a Department Head (customers_select, customers_select_dh_handover):
-- the department's, within the head's side (Sales or Support), plus the customers handed over to a Support head. Only customers and onboarding ones forwarded
-- to Support; leads have their own list.
create or replace function private.head_customers(p_dept uuid)
returns setof public.customers language sql stable security definer set search_path = '' as $$
  select c.* from public.customers c
   where c.department_id = p_dept
     and (c.lifecycle_stage = 'CUSTOMER'
          or (c.lifecycle_stage = 'ONBOARDING' and exists (select 1 from public.customer_onboarding o where o.customer_id = c.id and o.forwarded_to_support_at is not null)))
     and (private.sales_scope_team(c.team_id)
          or (c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and coalesce(private.active_head_division(), 'SUPPORT') = 'SUPPORT' and private.customer_handed_over(c.id)))
$$;

-- The department's leads: leads, potential and lost ones, and the customers that were once a lead the CRM recorded.
create or replace function private.head_leads(p_dept uuid)
returns setof public.customers language sql stable security definer set search_path = '' as $$
  select c.* from public.customers c
   where c.department_id = p_dept and private.sales_scope_team(c.team_id)
     and (c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'LOST')
          or (c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and exists (select 1 from public.customer_activities a where a.customer_id = c.id and a.type = 'LEAD_CREATED')))
$$;

create or replace function private.head_lead_state(p_stage text, p_lead_status text)
returns text language sql immutable set search_path = '' as $$
  select case when p_stage = 'LOST' then 'LOST'
              when p_stage in ('ONBOARDING', 'CUSTOMER') then 'CONVERTED'
              when p_stage = 'POTENTIAL' or (p_stage = 'LEAD' and p_lead_status <> 'NEW') then 'IN_PROGRESS'
              else 'NEW' end
$$;

-- The department's invoices: of its customers, and only those the invoice permission already lets this person read.
create or replace function private.head_invoices(p_dept uuid)
returns setof public.member_invoices language sql stable security definer set search_path = '' as $$
  select i.* from public.member_invoices i
    join public.customers c on c.id = i.customer_id
   where c.department_id = p_dept and private.can_read_invoice(i)
$$;

revoke all on function private.head_dept() from public, anon, authenticated;
revoke all on function private.head_iso_date(text) from public, anon, authenticated;
revoke all on function private.head_attendance_rows(uuid, date) from public, anon, authenticated;
revoke all on function private.head_customers(uuid) from public, anon, authenticated;
revoke all on function private.head_leads(uuid) from public, anon, authenticated;
revoke all on function private.head_lead_state(text, text) from public, anon, authenticated;
revoke all on function private.head_invoices(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Overview: employees, today's attendance, customers, leads and invoices of the department
-- ---------------------------------------------------------------------------
create or replace function public.head_dashboard_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_today date := private.office_today();
  v_emp integer; v_present integer; v_absent integer; v_leave integer;
  v_inv jsonb; v_cust jsonb; v_leads jsonb;
begin
  select count(*), count(*) filter (where status = 'PRESENT'), count(*) filter (where status = 'ABSENT'), count(*) filter (where status = 'ON_LEAVE')
    into v_emp, v_present, v_absent, v_leave from private.head_attendance_rows(v_dept, v_today);

  select jsonb_build_object(
           'count', count(*) filter (where i.status <> 'Cancelled'),
           'amount', coalesce(sum(i.amount) filter (where i.status <> 'Cancelled'), 0),
           'paid', count(*) filter (where i.status = 'Paid'),
           'paidAmount', coalesce(sum(i.amount) filter (where i.status = 'Paid'), 0),
           'pending', count(*) filter (where i.status = 'Pending'),
           'pendingAmount', coalesce(sum(i.amount) filter (where i.status = 'Pending'), 0),
           'overdue', count(*) filter (where i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today),
           'overdueAmount', coalesce(sum(i.amount) filter (where i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today), 0))
    into v_inv from private.head_invoices(v_dept) i;

  select jsonb_build_object(
           'total', count(*), 'active', count(*) filter (where c.status = 'ACTIVE'), 'inactive', count(*) filter (where c.status = 'INACTIVE'),
           'new', count(*) filter (where c.created_at >= now() - interval '30 days'),
           'withPendingInvoices', count(*) filter (where exists (select 1 from public.member_invoices i where i.customer_id = c.id and i.status = 'Pending')))
    into v_cust from private.head_customers(v_dept) c;

  select jsonb_build_object(
           'total', count(*), 'new', count(*) filter (where s = 'NEW'), 'inProgress', count(*) filter (where s = 'IN_PROGRESS'),
           'converted', count(*) filter (where s = 'CONVERTED'), 'lost', count(*) filter (where s = 'LOST'))
    into v_leads from (select private.head_lead_state(c.lifecycle_stage, c.lead_status) as s from private.head_leads(v_dept) c) x;

  return jsonb_build_object(
    'department', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = v_dept),
    'today', v_today,
    'attendance', jsonb_build_object('employees', v_emp, 'present', v_present, 'absent', v_absent, 'onLeave', v_leave,
                    -- present out of the people who were expected to work (everyone except those on approved leave)
                    'rate', case when v_emp - v_leave > 0 then round(100.0 * v_present / (v_emp - v_leave), 1) end),
    'customers', v_cust, 'leads', v_leads, 'invoices', v_inv);
end $$;

-- ---------------------------------------------------------------------------
-- Team attendance for one day (today when no date is given)
-- ---------------------------------------------------------------------------
create or replace function public.head_attendance_list(
  p_date date default null, p_status text default null, p_search text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_today date := private.office_today();
  v_date date := coalesce(p_date, v_today);
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_emp integer; v_present integer; v_absent integer; v_leave integer; v_total integer; v_items jsonb;
begin
  if v_date > v_today or v_date < v_today - 730 then
    raise exception 'VALIDATION_ERROR: Choose a date up to today (at most two years back).' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('PRESENT', 'ABSENT', 'ON_LEAVE') then
    raise exception 'VALIDATION_ERROR: Choose Present, Absent or On leave.' using errcode = 'P0001';
  end if;
  select count(*), count(*) filter (where status = 'PRESENT'), count(*) filter (where status = 'ABSENT'), count(*) filter (where status = 'ON_LEAVE')
    into v_emp, v_present, v_absent, v_leave from private.head_attendance_rows(v_dept, v_date);
  select count(*) into v_total from private.head_attendance_rows(v_dept, v_date) r
   where (v_status is null or r.status = v_status)
     and (v_term is null or lower(r.name) like '%' || v_term || '%' or lower(coalesce(r.designation, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(x.item order by x.n), '[]'::jsonb) into v_items from (
    select lower(r.name) as n, jsonb_build_object(
             'profileId', r.profile_id, 'name', r.name, 'role', r.role, 'designation', r.designation, 'team', r.team, 'date', v_date,
             'status', r.status, 'punchIn', r.punch_in_at, 'punchOut', r.punch_out_at,
             'workedMinutes', case when r.punch_in_at is null then null
                                   when r.punch_out_at is not null then floor(extract(epoch from (r.punch_out_at - r.punch_in_at)) / 60)::integer
                                   when v_date = v_today then floor(extract(epoch from (now() - r.punch_in_at)) / 60)::integer end,
             'leave', case when r.leave_id is null then null
                           else jsonb_build_object('id', r.leave_id, 'type', r.leave_type, 'halfDayShift', r.half_day_shift) end) as item
      from private.head_attendance_rows(v_dept, v_date) r
     where (v_status is null or r.status = v_status)
       and (v_term is null or lower(r.name) like '%' || v_term || '%' or lower(coalesce(r.designation, '')) like '%' || v_term || '%')
     order by lower(r.name)
     limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object(
    'date', v_date, 'today', v_today, 'timeZone', 'Asia/Kolkata',
    'summary', jsonb_build_object('employees', v_emp, 'present', v_present, 'absent', v_absent, 'onLeave', v_leave,
                 'rate', case when v_emp - v_leave > 0 then round(100.0 * v_present / (v_emp - v_leave), 1) end),
    'total', v_total, 'items', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- Leads of the department
-- ---------------------------------------------------------------------------
create or replace function public.head_lead_list(
  p_search text default null, p_status text default null, p_source text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_source text := nullif(btrim(coalesce(p_source, '')), '');
  v_summary jsonb; v_sources jsonb; v_total integer; v_items jsonb;
begin
  if v_status is not null and v_status not in ('NEW', 'IN_PROGRESS', 'CONVERTED', 'LOST') then
    raise exception 'VALIDATION_ERROR: Choose New, In progress, Converted or Lost.' using errcode = 'P0001';
  end if;
  select jsonb_build_object('total', count(*), 'new', count(*) filter (where s = 'NEW'), 'inProgress', count(*) filter (where s = 'IN_PROGRESS'),
                            'converted', count(*) filter (where s = 'CONVERTED'), 'lost', count(*) filter (where s = 'LOST'))
    into v_summary from (select private.head_lead_state(c.lifecycle_stage, c.lead_status) as s from private.head_leads(v_dept) c) x;
  select coalesce(jsonb_agg(jsonb_build_object('source', s.src, 'count', s.n) order by s.n desc, s.src), '[]'::jsonb) into v_sources
    from (select coalesce(nullif(btrim(c.lead_source), ''), 'Not recorded') as src, count(*) as n from private.head_leads(v_dept) c group by 1) s;
  select count(*) into v_total from private.head_leads(v_dept) c
   where (v_status is null or private.head_lead_state(c.lifecycle_stage, c.lead_status) = v_status)
     and (v_source is null or coalesce(nullif(btrim(c.lead_source), ''), 'Not recorded') = v_source)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb) into v_items from (
    select c.created_at, jsonb_build_object(
             'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'phone', c.phone, 'email', c.email, 'city', c.city,
             'state', private.head_lead_state(c.lifecycle_stage, c.lead_status), 'stage', c.lifecycle_stage, 'leadStatus', c.lead_status,
             'source', nullif(btrim(c.lead_source), ''), 'nextFollowUpAt', c.next_follow_up_at, 'expectedBudget', c.expected_budget,
             'owner', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = c.owner_id),
             'services', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order), '[]'::jsonb)
                            from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id),
             'createdAt', c.created_at) as item
      from private.head_leads(v_dept) c
     where (v_status is null or private.head_lead_state(c.lifecycle_stage, c.lead_status) = v_status)
       and (v_source is null or coalesce(nullif(btrim(c.lead_source), ''), 'Not recorded') = v_source)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('summary', v_summary, 'sources', v_sources, 'total', v_total, 'items', v_items);
end $$;

-- Who the head may give a new lead to: themself, and the active Team Leads and Team Members of the department's Sales teams that the existing rule allows
-- (private.can_assign_customer_owner, the same check the customer insert makes again).
create or replace function public.head_lead_owners()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_me uuid := private.my_id();
begin
  -- leads belong to the Sales side: a head of the Support side is offered no one
  if private.active_head_division() = 'SUPPORT' then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(o.item order by o.ord, o.name)
      from (
        select 0 as ord, p.full_name as name,
               jsonb_build_object('id', p.id, 'name', p.full_name, 'team', null, 'role', 'Myself', 'designation', 'Department Head') as item
          from public.profiles p where p.id = v_me and private.can_assign_customer_owner(p.id)
        union all
        select case p.role when 'TEAM_HEAD' then 1 else 2 end, p.full_name,
               jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
                                  'designation', coalesce(nullif(p.position, ''), private.employee_snapshot(p.id) ->> 'designation'))
          from public.profiles p join public.teams t on t.id = p.team_id
         where p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.department_id = v_dept
           and (t.division is null or t.division::text = 'SALES' or private.active_head_division() is null)
           and private.can_assign_customer_owner(p.id)) o), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- Customers of the department
-- ---------------------------------------------------------------------------
create or replace function public.head_customer_list(
  p_search text default null, p_status text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_summary jsonb; v_total integer; v_items jsonb;
begin
  if v_status is not null and v_status not in ('ACTIVE', 'INACTIVE', 'PROSPECT') then
    raise exception 'VALIDATION_ERROR: Choose Active, Inactive or Prospect.' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'total', count(*), 'active', count(*) filter (where c.status = 'ACTIVE'), 'inactive', count(*) filter (where c.status = 'INACTIVE'),
           'new', count(*) filter (where c.created_at >= now() - interval '30 days'),
           'withPendingInvoices', count(*) filter (where exists (select 1 from public.member_invoices i where i.customer_id = c.id and i.status = 'Pending')))
    into v_summary from private.head_customers(v_dept) c;
  select count(*) into v_total from private.head_customers(v_dept) c
   where (v_status is null or c.status::text = v_status)
     and (v_term is null or lower(c.name) like '%' || v_term || '%' or lower(coalesce(c.company, '')) like '%' || v_term || '%'
          or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%' or c.search_text ilike '%' || v_term || '%');
  select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb) into v_items from (
    select c.created_at, jsonb_build_object(
             'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'phone', c.phone, 'email', c.email, 'city', c.city,
             'status', c.status, 'lifecycleStage', c.lifecycle_stage,
             'department', (select d.name from public.departments d where d.id = c.department_id),
             'relationshipManager', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = c.owner_id),
             'services', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order), '[]'::jsonb)
                            from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id),
             'pendingInvoices', (select count(*) from public.member_invoices i where i.customer_id = c.id and i.status = 'Pending'),
             'createdAt', c.created_at) as item
      from private.head_customers(v_dept) c
     where (v_status is null or c.status::text = v_status)
       and (v_term is null or lower(c.name) like '%' || v_term || '%' or lower(coalesce(c.company, '')) like '%' || v_term || '%'
            or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%' or c.search_text ilike '%' || v_term || '%')
     order by c.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('summary', v_summary, 'total', v_total, 'items', v_items);
end $$;

-- One customer of the department in full: profile, services, relationship manager, invoices with the payment summary, and where it came from.
create or replace function public.head_customer_detail(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  c public.customers;
  v_today date := private.office_today();
begin
  select x.* into c from private.head_customers(v_dept) x where x.id = p_customer;
  if c.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'customer', jsonb_build_object(
      'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'phone', c.phone, 'whatsapp', c.whatsapp, 'email', c.email,
      'city', c.city, 'address', c.address, 'status', c.status, 'lifecycleStage', c.lifecycle_stage, 'createdAt', c.created_at, 'customerSince', c.customer_since,
      'department', (select d.name from public.departments d where d.id = c.department_id),
      'relationshipManager', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = c.owner_id),
      'teamLead', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = private.support_lead_of(c.id)),
      'teamMember', (select jsonb_build_object('id', p.id, 'name', p.full_name) from public.profiles p where p.id = private.support_member_of(c.id)),
      'hasClientLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id)),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order), '[]'::jsonb)
                   from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id),
    'origin', jsonb_build_object(
      'leadSource', nullif(btrim(c.lead_source), ''), 'expectedBudget', c.expected_budget,
      'leadCreatedAt', (select min(a.created_at) from public.customer_activities a where a.customer_id = c.id and a.type = 'LEAD_CREATED')),
    'payments', jsonb_build_object('dealAmount', c.deal_amount, 'amountReceived', c.amount_received, 'fullyPaid', c.fully_paid),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', i.id, 'number', i.invoice_number, 'kind', i.kind, 'amount', i.amount, 'status', i.status,
                    'overdue', i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today,
                    'issueDate', coalesce(private.head_iso_date(i.issue_date), i.created_at::date), 'dueDate', private.head_iso_date(i.due_date)) order by i.created_at desc), '[]'::jsonb)
                   from private.head_invoices(v_dept) i where i.customer_id = c.id),
    'invoiceSummary', (select jsonb_build_object(
                         'count', count(*) filter (where i.status <> 'Cancelled'),
                         'invoiced', coalesce(sum(i.amount) filter (where i.status <> 'Cancelled'), 0),
                         'paid', coalesce(sum(i.amount) filter (where i.status = 'Paid'), 0),
                         'outstanding', coalesce(sum(i.amount) filter (where i.status = 'Pending'), 0))
                         from private.head_invoices(v_dept) i where i.customer_id = c.id));
end $$;

-- ---------------------------------------------------------------------------
-- Invoices of the department's customers (read only)
-- ---------------------------------------------------------------------------
-- Status: All, Paid, Pending, Overdue (a pending invoice past its due date) or Cancelled. The date range is on the invoice date.
create or replace function public.head_invoice_list(
  p_search text default null, p_status text default null, p_from date default null, p_to date default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := private.head_dept();
  v_today date := private.office_today();
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_summary jsonb; v_total integer; v_items jsonb;
begin
  if v_status is not null and v_status not in ('PAID', 'PENDING', 'OVERDUE', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Choose Paid, Pending, Overdue or Cancelled.' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'count', count(*) filter (where i.status <> 'Cancelled'), 'amount', coalesce(sum(i.amount) filter (where i.status <> 'Cancelled'), 0),
           'paid', count(*) filter (where i.status = 'Paid'), 'paidAmount', coalesce(sum(i.amount) filter (where i.status = 'Paid'), 0),
           'pending', count(*) filter (where i.status = 'Pending'), 'pendingAmount', coalesce(sum(i.amount) filter (where i.status = 'Pending'), 0),
           'overdue', count(*) filter (where i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today),
           'overdueAmount', coalesce(sum(i.amount) filter (where i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today), 0))
    into v_summary from private.head_invoices(v_dept) i;
  select count(*) into v_total from private.head_invoices(v_dept) i
   where (v_status is null or (v_status = 'PAID' and i.status = 'Paid') or (v_status = 'PENDING' and i.status = 'Pending')
          or (v_status = 'CANCELLED' and i.status = 'Cancelled') or (v_status = 'OVERDUE' and i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today))
     and (p_from is null or coalesce(private.head_iso_date(i.issue_date), i.created_at::date) >= p_from)
     and (p_to is null or coalesce(private.head_iso_date(i.issue_date), i.created_at::date) <= p_to)
     and (v_term is null or lower(i.invoice_number) like '%' || v_term || '%' or lower(i.customer_name) like '%' || v_term || '%' or lower(coalesce(i.company, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(x.item order by x.created_at desc), '[]'::jsonb) into v_items from (
    select i.created_at, jsonb_build_object(
             'id', i.id, 'number', i.invoice_number, 'kind', i.kind, 'customerId', i.customer_id,
             'customer', coalesce(nullif(i.company, ''), i.customer_name), 'contact', i.customer_name,
             'amount', i.amount, 'status', i.status,
             'overdue', i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today,
             'issueDate', coalesce(private.head_iso_date(i.issue_date), i.created_at::date), 'dueDate', private.head_iso_date(i.due_date),
             'paidAt', i.paid_at,
             'paidAmount', case when i.status = 'Paid' then i.amount else 0 end,
             'outstanding', case when i.status = 'Pending' then i.amount else 0 end,
             'services', (select coalesce(jsonb_agg(it ->> 'description'), '[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(i.details -> 'items') = 'array' then i.details -> 'items' else '[]'::jsonb end) it
                           where nullif(btrim(coalesce(it ->> 'description', '')), '') is not null),
             'hasDocument', i.kind in ('UPLOADED', 'GENERATED')) as item
      from private.head_invoices(v_dept) i
     where (v_status is null or (v_status = 'PAID' and i.status = 'Paid') or (v_status = 'PENDING' and i.status = 'Pending')
            or (v_status = 'CANCELLED' and i.status = 'Cancelled') or (v_status = 'OVERDUE' and i.status = 'Pending' and private.head_iso_date(i.due_date) < v_today))
       and (p_from is null or coalesce(private.head_iso_date(i.issue_date), i.created_at::date) >= p_from)
       and (p_to is null or coalesce(private.head_iso_date(i.issue_date), i.created_at::date) <= p_to)
       and (v_term is null or lower(i.invoice_number) like '%' || v_term || '%' or lower(i.customer_name) like '%' || v_term || '%' or lower(coalesce(i.company, '')) like '%' || v_term || '%')
     order by i.created_at desc
     limit least(greatest(coalesce(p_limit, 20), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) x;
  return jsonb_build_object('summary', v_summary, 'total', v_total, 'items', v_items);
end $$;

-- ---------------------------------------------------------------------------
-- Grants: signed-in users call these; each one refuses everyone who is not a Department Head
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.head_dashboard_overview()',
    'public.head_attendance_list(date, text, text, integer, integer)',
    'public.head_lead_list(text, text, text, integer, integer)',
    'public.head_lead_owners()',
    'public.head_customer_list(text, text, integer, integer)',
    'public.head_customer_detail(uuid)',
    'public.head_invoice_list(text, text, date, date, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
