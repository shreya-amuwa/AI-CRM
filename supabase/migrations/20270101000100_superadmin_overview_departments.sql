-- =============================================================================
-- Super Admin Overview: who is absent in each department today, and each department's business in a period.
--
-- One read-only function for the Super Admin's Overview page. It adds no table and changes no data, and it reuses the calculations the
-- rest of the CRM already uses, so its figures match the screens they come from:
--
--   attendance      the same people and the same rule as HR's attendance register (hr_attendance_register): every ACTIVE employee except
--                   the Super Admin, in their base department (a facet such as WabaTalk counts with its parent). Someone who has not
--                   punched in that day (private.attendance_status = NOT_PUNCHED_IN) is ABSENT; anyone who punched in is present, whatever
--                   happened after. Approved leave covering the day is shown as "on leave". People who joined after the day are left out.
--   income          verified payments, attributed to a department exactly as Accounts' Department Income does
--                   (private.verified_income_attributed: one attribution per order, never moved by a later change of owner).
--                     departmentIncome = all of it (the Accounts Department Income total); income = the part paid in the period.
--   expenses        the department's share of each expense (expense_allocations), as Accounts' per-department view counts it, in the
--                   period by expense date. An expense split between departments is counted once, each department its own part.
--   onboarding      customers of the department whose onboarding was completed in the period (customer_onboarding.onboarding_completed_at).
--   recharges       completed plan purchases and renewals from the business ledger the Business Reports use (private.business_ledger:
--                   a paid monthly plan, or an invoice Accounts tagged as a renewal), attributed to a department the same way, in the period.
--
-- Departments are the ones that generate revenue (the list Accounts shows) for the business figures, and every department with staff for
-- attendance. Read-only: it records nothing and changes no attendance. Super Admin only. Safe to run again.
-- =============================================================================

create or replace function public.dashboard_overview_departments(p_from date default null, p_to date default null, p_attendance_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_day date := coalesce(p_attendance_date, private.office_today());
  v_from date := coalesce(p_from, date_trunc('month', private.office_today())::date);
  v_to date := coalesce(p_to, private.office_today());
  v_attendance jsonb;
  v_performance jsonb;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can see the company overview.' using errcode = '42501';
  end if;
  if v_to < v_from or v_to - v_from > 3700 then
    raise exception 'VALIDATION_ERROR: Choose a period that ends on or after its start.' using errcode = 'P0001';
  end if;
  if v_day > private.office_today() or v_day < private.office_today() - 730 then
    raise exception 'VALIDATION_ERROR: Choose an attendance date up to today (at most two years back).' using errcode = 'P0001';
  end if;

  -- who was an employee that day, and whether they punched in (the rule HR's attendance register uses)
  with staff as (
    select p.id, p.full_name, nullif(btrim(p.position), '') as position,
           private.base_department(p.department_id) as department_id,
           private.attendance_status(p.id, v_day) <> 'NOT_PUNCHED_IN' as present,
           (select l.leave_type from public.leave_requests l
             where l.employee_id = p.id and l.status = 'APPROVED' and v_day between l.start_date and l.end_date
             order by (l.leave_type = 'FULL_DAY') desc limit 1) as leave_type
      from public.profiles p
     where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN'
       and (p.created_at at time zone 'Asia/Kolkata')::date <= v_day
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'departmentId', d.id, 'name', coalesce(d.name, 'No department'), 'slug', d.slug,
           'staff', x.staff, 'present', x.present, 'absentCount', x.absent_n,
           'absent', x.absent) order by d.name nulls last), '[]'::jsonb)
    into v_attendance
    from (select s.department_id,
                 count(*) as staff,
                 count(*) filter (where s.present) as present,
                 count(*) filter (where not s.present) as absent_n,
                 coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.full_name, 'position', s.position,
                                    'onLeave', s.leave_type is not null, 'leaveType', s.leave_type)
                                    order by s.full_name) filter (where not s.present), '[]'::jsonb) as absent
            from staff s group by s.department_id) x
    left join public.departments d on d.id = x.department_id;

  -- each revenue department's business: the same sources as Accounts and the Business Reports, never mixed between departments
  select coalesce(jsonb_agg(jsonb_build_object(
           'departmentId', d.id, 'name', d.name, 'slug', d.slug,
           'departmentIncome', coalesce(ia.amount, 0), 'departmentIncomeCount', coalesce(ia.n, 0),
           'income', coalesce(ip.amount, 0), 'incomeCount', coalesce(ip.n, 0),
           'expenses', coalesce(ex.amount, 0), 'expenseCount', coalesce(ex.n, 0),
           'onboarded', coalesce(ob.n, 0),
           'recharges', coalesce(rc.n, 0), 'rechargeAmount', coalesce(rc.amount, 0))
         order by d.name), '[]'::jsonb)
    into v_performance
    from public.departments d
    left join (select v.department_id, sum(v.amount) amount, count(*) n
                 from private.verified_income_attributed() v group by v.department_id) ia on ia.department_id = d.id
    -- the period filter and the customer join are exactly accounts_finance_summary's, so a department's income here equals its
    -- income in Accounts for the same dates
    left join (select v.department_id, sum(v.amount) amount, count(*) n
                 from private.verified_income_attributed() v join public.customers c on c.id = v.customer_id
                where v.paid_at::date between v_from and v_to
                group by v.department_id) ip on ip.department_id = d.id
    left join (select a.department_id, sum(a.amount) amount, count(*) n
                 from public.expense_allocations a join public.department_expenses e on e.id = a.expense_id
                where e.expense_date between v_from and v_to
                group by a.department_id) ex on ex.department_id = d.id
    left join (select c.department_id, count(distinct c.id) n
                 from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                where o.onboarding_completed_at is not null
                  and (o.onboarding_completed_at at time zone 'Asia/Kolkata')::date between v_from and v_to
                group by c.department_id) ob on ob.department_id = d.id
    left join (select l.department_id, count(*) n, sum(l.amount) amount
                 from private.business_ledger() l
                where l.tx_type in ('SUBSCRIPTION', 'RENEWAL') and l.status = 'COLLECTED'
                  and (l.occurred_at at time zone 'Asia/Kolkata')::date between v_from and v_to
                group by l.department_id) rc on rc.department_id = d.id
   where d.generates_revenue;

  return jsonb_build_object(
    'attendanceDate', v_day,
    'attendance', v_attendance,
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'performance', v_performance,
    'generatedAt', now());
end $$;
revoke all on function public.dashboard_overview_departments(date, date, date) from public, anon;
grant execute on function public.dashboard_overview_departments(date, date, date) to authenticated;
