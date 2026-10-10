-- Accounts Dashboard: which departments earn revenue.
-- Accounts, Education & Training and HR do not sell to customers, so the Income and Department Income
-- views list only departments flagged generates_revenue. The flag is data (not code), so it can be
-- changed per department later without a release. Additive and safe to re-run.

alter table public.departments add column if not exists generates_revenue boolean not null default true;

update public.departments set generates_revenue = false where slug in ('accounts', 'edutraining', 'hr');

create or replace function public.accounts_finance_departments()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug) order by d.name)
                     from public.departments d where d.generates_revenue), '[]'::jsonb);
end $$;
revoke all on function public.accounts_finance_departments() from public, anon;
grant execute on function public.accounts_finance_departments() to authenticated;
