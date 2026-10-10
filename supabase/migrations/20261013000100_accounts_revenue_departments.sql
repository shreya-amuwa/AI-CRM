-- Accounts Dashboard: which departments earn revenue.
-- Accounts, Education & Training and HR do not sell to customers, so the Income and Department Income
-- views list only departments flagged generates_revenue. The flag is data (not code), so it can be
-- changed per department later without a release. Additive and safe to re-run.
-- Runs after 20261012000200_accounts_department_totals.sql and narrows accounts_finance_by_department()
-- (one box per department, same rules as accounts_finance_summary) to those departments.

alter table public.departments add column if not exists generates_revenue boolean not null default true;

update public.departments set generates_revenue = false where slug in ('accounts', 'edutraining', 'hr');

-- An earlier draft of this file created a separate list function; the department boxes replace it.
drop function if exists public.accounts_finance_departments();

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
                group by e.department_id) x on x.department_id = d.id
   where d.generates_revenue;
  return v;
end $$;
revoke all on function public.accounts_finance_by_department() from public, anon;
grant execute on function public.accounts_finance_by_department() to authenticated;
