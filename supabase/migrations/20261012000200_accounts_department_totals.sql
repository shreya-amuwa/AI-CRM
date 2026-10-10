-- =============================================================================
-- Department Income (Account Dashboard): earnings and expenses of EVERY
-- department in one call, using the same rules as accounts_finance_summary():
--   earnings = verified customer payments of the department's customers
--   expenses = department_expenses booked to the department (paid + pending)
-- Company-wide expenses (no department) are not given to any department.
-- Accounts staff only. Read-only, additive.
-- =============================================================================
create or replace function public.accounts_finance_by_department()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_accounts_staff();
  select coalesce(jsonb_agg(jsonb_build_object(
           'departmentId', d.id, 'name', d.name, 'slug', d.slug,
           'income', coalesce(i.amount, 0), 'incomeCount', coalesce(i.n, 0),
           'expenses', coalesce(x.amount, 0), 'expenseCount', coalesce(x.n, 0),
           'expensesPending', coalesce(x.pending, 0))
         order by d.name), '[]'::jsonb)
    into v
    from public.departments d
    left join (select c.department_id, sum(p.amount) amount, count(*) n
                 from public.customer_payments p join public.customers c on c.id = p.customer_id
                where p.status = 'VERIFIED'
                group by c.department_id) i on i.department_id = d.id
    left join (select e.department_id, sum(e.amount) amount, count(*) n,
                      sum(e.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.department_expenses e
                where e.department_id is not null
                group by e.department_id) x on x.department_id = d.id;
  return v;
end $$;
revoke all on function public.accounts_finance_by_department() from public, anon;
grant execute on function public.accounts_finance_by_department() to authenticated;
