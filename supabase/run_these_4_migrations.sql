-- =============================================================================
-- All 4 migrations of PR #38, in order. Paste the whole file into the Supabase
-- SQL editor and run it once. Every part is idempotent (safe to run again).
--   1. 20261012000100_accounts_finance.sql
--   2. 20261012000200_accounts_department_totals.sql
--   3. 20261013000100_accounts_revenue_departments.sql
--   4. 20261014000100_tc_notes_addons.sql
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261012000100_accounts_finance.sql

-- =============================================================================
-- Accounts finance: real expenses and company / department totals.
--
--   Income    = verified payments in the payment ledger (customer_payments), attributed to the
--               customer's department. Nothing else is counted: no sample or hard-coded figures.
--   Expenses  = department_expenses (new). A row may belong to a department or be company-wide.
--               `source` + `external_id` keep rows ready for a Google Sheet (or any other) import:
--               importing the same external id again updates the row instead of duplicating it.
--               Nothing here connects to Google Sheets; accounts_import_expenses() only accepts rows.
--   Net       = income - expenses (pending expenses are included and reported separately).
--
-- Only Accounts staff can read or write. Editing / deleting an expense: its creator or an
-- Accounts team lead / head / super admin. Additive / idempotent.
-- =============================================================================

create table if not exists public.department_expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  description text not null check (length(btrim(description)) between 1 and 300),
  department_id uuid references public.departments (id) on delete restrict,
  category text not null check (length(btrim(category)) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  payment_status text not null default 'PAID' check (payment_status in ('PAID', 'PENDING')),
  notes text check (length(notes) <= 1000),
  source text not null default 'MANUAL' check (source in ('MANUAL', 'GOOGLE_SHEET', 'IMPORT')),
  external_id text check (length(external_id) between 1 and 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists department_expenses_external_key on public.department_expenses (source, external_id) where external_id is not null;
create index if not exists department_expenses_date_idx on public.department_expenses (expense_date desc);
create index if not exists department_expenses_department_idx on public.department_expenses (department_id, expense_date desc);
drop trigger if exists department_expenses_set_updated_at on public.department_expenses;
create trigger department_expenses_set_updated_at before update on public.department_expenses
  for each row execute function public.tg_set_updated_at();
alter table public.department_expenses enable row level security;
revoke all on public.department_expenses from anon, authenticated;

create or replace function private.require_accounts_staff()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see or change finance records.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_accounts_staff() from public, anon;
grant execute on function private.require_accounts_staff() to authenticated;

-- ---------------------------------------------------------------------------
-- Totals: company-wide, or for one department; optionally for a date range.
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_summary(
  p_department uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_income numeric; v_income_n bigint;
  v_exp numeric; v_exp_paid numeric; v_exp_pending numeric; v_exp_n bigint;
begin
  perform private.require_accounts_staff();
  select coalesce(sum(p.amount), 0), count(*) into v_income, v_income_n
    from public.customer_payments p join public.customers c on c.id = p.customer_id
   where p.status = 'VERIFIED'
     and (p_department is null or c.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to);
  select coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.payment_status = 'PAID'), 0),
         coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0), count(*)
    into v_exp, v_exp_paid, v_exp_pending, v_exp_n
    from public.department_expenses e
   where (p_department is null or e.department_id = p_department)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to);
  return jsonb_build_object('income', v_income, 'incomeCount', v_income_n, 'expenses', v_exp, 'expensesPaid', v_exp_paid,
    'expensesPending', v_exp_pending, 'expenseCount', v_exp_n, 'net', v_income - v_exp);
end $$;
revoke all on function public.accounts_finance_summary(uuid, date, date) from public, anon;
grant execute on function public.accounts_finance_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Income: every verified payment.
-- ---------------------------------------------------------------------------
create or replace function public.accounts_income_list(
  p_search text default null, p_department uuid default null, p_from date default null, p_to date default null,
  p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_sum numeric; v_items jsonb;
begin
  perform private.require_accounts_staff();
  select count(*), coalesce(sum(p.amount), 0) into v_total, v_sum
    from public.customer_payments p join public.customers c on c.id = p.customer_id
   where p.status = 'VERIFIED' and (p_department is null or c.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
          or lower(coalesce(p.reference, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by paid_at desc), '[]'::jsonb) into v_items from (
    select p.paid_at, jsonb_build_object(
      'id', p.id, 'paidAt', p.paid_at, 'amount', p.amount, 'type', p.payment_type, 'method', p.method, 'reference', p.reference,
      'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name), 'contact', c.name,
      'departmentId', c.department_id, 'department', d.name,
      'verifiedBy', (select full_name from public.profiles where id = p.verified_by)) as j
      from public.customer_payments p join public.customers c on c.id = p.customer_id
      left join public.departments d on d.id = c.department_id
     where p.status = 'VERIFIED' and (p_department is null or c.department_id = p_department)
       and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
            or lower(coalesce(p.reference, '')) like '%' || v_term || '%')
     order by p.paid_at desc, p.recorded_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'sum', v_sum, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_income_list(text, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.accounts_income_list(text, uuid, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create or replace function private.check_expense_fields(
  p_date date, p_description text, p_department uuid, p_category text, p_amount numeric, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the expense date.' using errcode = 'P0001'; end if;
  if p_date > current_date + 366 then raise exception 'VALIDATION_ERROR: The expense date is too far in the future.' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null then raise exception 'VALIDATION_ERROR: Describe the expense.' using errcode = 'P0001'; end if;
  if length(p_description) > 300 then raise exception 'VALIDATION_ERROR: Keep the description under 300 characters.' using errcode = 'P0001'; end if;
  if nullif(btrim(coalesce(p_category, '')), '') is null then raise exception 'VALIDATION_ERROR: Enter the category.' using errcode = 'P0001'; end if;
  if length(p_category) > 80 then raise exception 'VALIDATION_ERROR: Keep the category under 80 characters.' using errcode = 'P0001'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'VALIDATION_ERROR: Enter the amount.' using errcode = 'P0001'; end if;
  if p_amount <> round(p_amount, 2) then raise exception 'VALIDATION_ERROR: Use at most 2 decimal places.' using errcode = 'P0001'; end if;
  if p_status is null or p_status not in ('PAID', 'PENDING') then raise exception 'VALIDATION_ERROR: Choose paid or pending.' using errcode = 'P0001'; end if;
  if length(coalesce(p_notes, '')) > 1000 then raise exception 'VALIDATION_ERROR: Keep the notes under 1000 characters.' using errcode = 'P0001'; end if;
  if p_department is not null and not exists (select 1 from public.departments where id = p_department) then
    raise exception 'VALIDATION_ERROR: Choose a department from the list.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_expense_fields(date, text, uuid, text, numeric, text, text) from public, anon, authenticated;

create or replace function private.can_change_expense(p_created_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff() and (p_created_by is not distinct from (select private.my_id()) or private.is_accounts_manager())
$$;
revoke all on function private.can_change_expense(uuid) from public, anon;
grant execute on function private.can_change_expense(uuid) to authenticated;

create or replace function public.accounts_expenses_list(
  p_search text default null, p_department uuid default null, p_company_wide boolean default false,
  p_category text default null, p_status text default null, p_from date default null, p_to date default null,
  p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_sum numeric; v_pending numeric; v_items jsonb; v_categories jsonb;
begin
  perform private.require_accounts_staff();
  if p_status is not null and p_status not in ('PAID', 'PENDING') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0)
    into v_total, v_sum, v_pending
    from public.department_expenses e
   where (p_department is null or e.department_id = p_department) and (not coalesce(p_company_wide, false) or e.department_id is null)
     and (p_category is null or lower(e.category) = lower(p_category)) and (p_status is null or e.payment_status = p_status)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
     and (v_term is null or lower(e.description) like '%' || v_term || '%' or lower(e.category) like '%' || v_term || '%' or lower(coalesce(e.notes, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by expense_date desc, created_at desc), '[]'::jsonb) into v_items from (
    select e.expense_date, e.created_at, jsonb_build_object(
      'id', e.id, 'date', e.expense_date, 'description', e.description, 'departmentId', e.department_id, 'department', d.name,
      'category', e.category, 'amount', e.amount, 'status', e.payment_status, 'notes', e.notes, 'source', e.source,
      'createdBy', (select full_name from public.profiles where id = e.created_by),
      'canChange', private.can_change_expense(e.created_by)) as j
      from public.department_expenses e left join public.departments d on d.id = e.department_id
     where (p_department is null or e.department_id = p_department) and (not coalesce(p_company_wide, false) or e.department_id is null)
       and (p_category is null or lower(e.category) = lower(p_category)) and (p_status is null or e.payment_status = p_status)
       and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
       and (v_term is null or lower(e.description) like '%' || v_term || '%' or lower(e.category) like '%' || v_term || '%' or lower(coalesce(e.notes, '')) like '%' || v_term || '%')
     order by e.expense_date desc, e.created_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_categories from (select distinct category as c from public.department_expenses) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'sum', v_sum, 'pending', v_pending, 'categories', v_categories,
                            'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_expenses_list(text, uuid, boolean, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.accounts_expenses_list(text, uuid, boolean, text, text, date, date, integer, integer) to authenticated;

create or replace function public.accounts_add_expense(
  p_date date, p_description text, p_department uuid, p_category text, p_amount numeric, p_status text default 'PAID', p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform private.require_accounts_staff();
  perform private.check_expense_fields(p_date, p_description, p_department, p_category, p_amount, p_status, p_notes);
  insert into public.department_expenses (expense_date, description, department_id, category, amount, payment_status, notes, created_by)
  values (p_date, btrim(p_description), p_department, btrim(p_category), p_amount, p_status, nullif(btrim(coalesce(p_notes, '')), ''), (select private.my_id()))
  returning id into v_id;
  perform private.write_audit('EXPENSE_ADDED', 'expense', v_id, p_department, null, jsonb_build_object('amount', p_amount, 'category', p_category));
  return v_id;
end $$;
revoke all on function public.accounts_add_expense(date, text, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_add_expense(date, text, uuid, text, numeric, text, text) to authenticated;

create or replace function public.accounts_update_expense(
  p_id uuid, p_date date, p_description text, p_department uuid, p_category text, p_amount numeric, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.department_expenses;
begin
  perform private.require_accounts_staff();
  select * into e from public.department_expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND: Expense not found.' using errcode = 'P0001'; end if;
  if not private.can_change_expense(e.created_by) then
    raise exception 'FORBIDDEN: You can only change expenses you added.' using errcode = '42501';
  end if;
  perform private.check_expense_fields(p_date, p_description, p_department, p_category, p_amount, p_status, p_notes);
  update public.department_expenses set expense_date = p_date, description = btrim(p_description), department_id = p_department,
         category = btrim(p_category), amount = p_amount, payment_status = p_status, notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_id;
  perform private.write_audit('EXPENSE_EDITED', 'expense', p_id, p_department, null, jsonb_build_object('amount', p_amount, 'was', e.amount));
end $$;
revoke all on function public.accounts_update_expense(uuid, date, text, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_update_expense(uuid, date, text, uuid, text, numeric, text, text) to authenticated;

create or replace function public.accounts_delete_expense(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.department_expenses;
begin
  perform private.require_accounts_staff();
  select * into e from public.department_expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND: Expense not found.' using errcode = 'P0001'; end if;
  if not private.can_change_expense(e.created_by) then
    raise exception 'FORBIDDEN: You can only delete expenses you added.' using errcode = '42501';
  end if;
  delete from public.department_expenses where id = p_id;
  perform private.write_audit('EXPENSE_DELETED', 'expense', p_id, e.department_id, null,
    jsonb_build_object('amount', e.amount, 'category', e.category, 'description', e.description));
end $$;
revoke all on function public.accounts_delete_expense(uuid) from public, anon;
grant execute on function public.accounts_delete_expense(uuid) to authenticated;

-- Bulk upsert for an external source (e.g. an exported Google Sheet). All-or-nothing; the same
-- (source, externalId) updates the row instead of adding a second one. Accounts manager only.
-- Each row: externalId, date, description, departmentSlug (optional), category, amount, status, notes.
create or replace function public.accounts_import_expenses(p_rows jsonb, p_source text default 'IMPORT')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i integer := 0; v_dept uuid; v_id uuid; v_ext text; v_status text;
  v_inserted integer := 0; v_updated integer := 0;
begin
  perform private.require_accounts_staff();
  if not private.is_accounts_manager() then
    raise exception 'FORBIDDEN: Only an Accounts team lead or head can import expenses.' using errcode = '42501';
  end if;
  if p_source not in ('GOOGLE_SHEET', 'IMPORT') then raise exception 'VALIDATION_ERROR: Unknown source.' using errcode = 'P0001'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'VALIDATION_ERROR: Send at least one row.' using errcode = 'P0001'; end if;
  if jsonb_array_length(p_rows) > 1000 then raise exception 'VALIDATION_ERROR: Import at most 1000 rows at a time.' using errcode = 'P0001'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_ext := nullif(btrim(r ->> 'externalId'), '');
    if v_ext is null then raise exception 'VALIDATION_ERROR: Row %: externalId is required.', i using errcode = 'P0001'; end if;
    v_dept := null;
    if nullif(btrim(coalesce(r ->> 'departmentSlug', '')), '') is not null then
      select id into v_dept from public.departments where slug = btrim(r ->> 'departmentSlug');
      if v_dept is null then raise exception 'VALIDATION_ERROR: Row %: unknown department "%".', i, r ->> 'departmentSlug' using errcode = 'P0001'; end if;
    end if;
    v_status := coalesce(nullif(r ->> 'status', ''), 'PAID');
    begin
      perform private.check_expense_fields((r ->> 'date')::date, r ->> 'description', v_dept, r ->> 'category', (r ->> 'amount')::numeric, v_status, r ->> 'notes');
    exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      raise exception 'VALIDATION_ERROR: Row %: the date or amount is not valid.', i using errcode = 'P0001';
    when others then
      raise exception 'VALIDATION_ERROR: Row %: %', i, regexp_replace(sqlerrm, '^[A-Z_]+:\s*', '') using errcode = 'P0001';
    end;
    insert into public.department_expenses (expense_date, description, department_id, category, amount, payment_status, notes, source, external_id, created_by)
    values ((r ->> 'date')::date, btrim(r ->> 'description'), v_dept, btrim(r ->> 'category'), (r ->> 'amount')::numeric, v_status,
            nullif(btrim(coalesce(r ->> 'notes', '')), ''), p_source, v_ext, (select private.my_id()))
    on conflict (source, external_id) where external_id is not null do update
      set expense_date = excluded.expense_date, description = excluded.description, department_id = excluded.department_id,
          category = excluded.category, amount = excluded.amount, payment_status = excluded.payment_status, notes = excluded.notes
    returning id into v_id;
    if (select created_at = updated_at from public.department_expenses where id = v_id) then v_inserted := v_inserted + 1; else v_updated := v_updated + 1; end if;
  end loop;
  perform private.write_audit('EXPENSES_IMPORTED', 'expense', null, null, null, jsonb_build_object('source', p_source, 'inserted', v_inserted, 'updated', v_updated));
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated);
end $$;
revoke all on function public.accounts_import_expenses(jsonb, text) from public, anon;
grant execute on function public.accounts_import_expenses(jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Overall analytics: company-wide, per month, plus the biggest expense categories.
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_trend(p_months integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_start date := (date_trunc('month', current_date) - ((v_n - 1) || ' months')::interval)::date;
  v_months jsonb; v_categories jsonb;
begin
  perform private.require_accounts_staff();
  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'income', coalesce(i.amount, 0), 'expenses', coalesce(x.amount, 0),
                                                'net', coalesce(i.amount, 0) - coalesce(x.amount, 0)) order by m.month), '[]'::jsonb)
    into v_months
    from generate_series(v_start::timestamp, date_trunc('month', current_date)::timestamp, interval '1 month') as m(month)
    left join (select date_trunc('month', paid_at)::date as month, sum(amount) as amount from public.customer_payments
                where status = 'VERIFIED' group by 1) i on i.month = m.month::date
    left join (select date_trunc('month', expense_date)::date as month, sum(amount) as amount from public.department_expenses group by 1) x on x.month = m.month::date;
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb) into v_categories
    from (select category, sum(amount) as amount from public.department_expenses group by category order by sum(amount) desc limit 8) t;
  return jsonb_build_object('months', v_months, 'expenseCategories', v_categories,
    'firstRecordAt', (select least((select min(paid_at) from public.customer_payments where status = 'VERIFIED'), (select min(expense_date)::timestamptz from public.department_expenses))));
end $$;
revoke all on function public.accounts_finance_trend(integer) from public, anon;
grant execute on function public.accounts_finance_trend(integer) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261012000200_accounts_department_totals.sql

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261013000100_accounts_revenue_departments.sql

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261014000100_tc_notes_addons.sql

-- =============================================================================
-- Technical Consultant (TC) workflow: notes, Add-ons Services, return-to-leads rule.
--
--  1. accounts_return_to_leads: refused once a payment of the customer is
--     VERIFIED (decided from the persisted payment rows, not from the UI).
--  2. consultant_notes: the TC's consultation notes (append-only history, edit
--     by the author only), readable by the TC, the Department Head of the
--     department and the Super Admin (CEO).
--  3. Add-ons Services:
--       customer_onboarding.addons_required      Yes / No answer (null = not answered)
--       customer_onboarding.addons_submitted_*   "Send to Add-ons" (once)
--       customer_onboarding.addon_items_*        document progress of the add-ons
--     The add-on checklist is built from the same service catalogue and the same
--     onboarding_items as normal onboarding; entries live in the same table, so
--     a document is collected once and keeps its history and verification.
--     The TC can collect (save / upload / replace) the items of the add-on
--     services of a customer that was sent to Add-ons; sales access is unchanged.
--  4. consultant_start_onboarding: refused while add-ons are selected but the
--     customer has not been sent to Add-ons.
--  5. onboarding_review_counts: Customers panel excludes customers sent to
--     Add-ons; 'addons' counts them.
-- Additive / idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Return to Leads is not available once money is verified
-- ---------------------------------------------------------------------------
create or replace function public.accounts_return_to_leads(p_customer uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  r public.payment_requests;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  select * into r from public.payment_requests where customer_id = p_customer and status = 'PENDING' for update;
  if r.id is null or v.lifecycle_stage <> 'LEAD' or v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This customer is not waiting for payment confirmation.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments where customer_id = p_customer and status = 'PENDING') then
    raise exception 'CONFLICT: Verify or reject the pending payments first, so nothing is left unaccounted for.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments where customer_id = p_customer and status = 'VERIFIED') then
    raise exception 'CONFLICT: A payment of this customer is already verified, so they cannot be returned to Leads. Confirm the payment and return them to Sales onboarding instead.' using errcode = 'P0001';
  end if;
  update public.payment_requests
     set status = 'RETURNED', resolved_by = (select private.my_id()), resolved_at = now(), resolution_note = v_reason
   where id = r.id;
  -- The lead, its conversations and every payment on record are kept as they are.
  update public.customers
     set payment_workflow = 'RETURNED_FROM_ACCOUNTS', lead_status = 'INTERESTED', next_follow_up_at = coalesce(next_follow_up_at, now())
   where id = p_customer;
  perform private.log_customer_activity(p_customer, 'RETURNED_FROM_ACCOUNTS',
    'Customer backed off at Accounts - returned to Leads' || coalesce(' · ' || v_reason, ''));
  perform private.write_audit('PAYMENT_RETURNED_TO_LEADS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', r.id, 'reason', v_reason, 'verified', v.amount_verified));
  perform private.notify(v.owner_id, 'RETURNED_FROM_ACCOUNTS', format('Returned from Accounts: %s', coalesce(v.company, v.name)),
    coalesce(v_reason, 'The customer backed off. Please follow up.'),
    'customer', p_customer);
end $$;
revoke all on function public.accounts_return_to_leads(uuid, text) from public, anon;
grant execute on function public.accounts_return_to_leads(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Consultation notes
-- ---------------------------------------------------------------------------
create table if not exists public.consultant_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 4000),
  -- Optional reference to the service the consultation was about.
  service_code text references public.crm_services (code) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists consultant_notes_customer_idx on public.consultant_notes (customer_id, created_at desc);
alter table public.consultant_notes enable row level security;
revoke all on public.consultant_notes from anon, authenticated;

-- Write: the Technical Consultant of the customer's department, while the customer is with the consultant.
create or replace function private.can_write_consultant_notes(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.department_id = private.my_support_department_id()
      and private.can_view_onboarding_review(p_customer))
$$;
revoke all on function private.can_write_consultant_notes(uuid) from public, anon;
grant execute on function private.can_write_consultant_notes(uuid) to authenticated;

-- Read: the same consultants, the Department Head of the department, and the Super Admin (CEO).
create or replace function private.can_read_consultant_notes(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()))
$$;
revoke all on function private.can_read_consultant_notes(uuid) from public, anon;
grant execute on function private.can_read_consultant_notes(uuid) to authenticated;

create or replace function public.consultant_notes_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_read_consultant_notes(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', n.id, 'body', n.body, 'serviceCode', n.service_code,
      'author', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = n.author_id),
      'createdAt', n.created_at, 'updatedAt', n.updated_at,
      'canEdit', n.author_id = (select private.my_id()) and private.can_write_consultant_notes(p_customer))
      order by n.created_at desc, n.id)
    from public.consultant_notes n where n.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.consultant_notes_list(uuid) from public, anon;
grant execute on function public.consultant_notes_list(uuid) to authenticated;

create or replace function public.consultant_add_note(p_customer uuid, p_body text, p_service text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_body text := btrim(coalesce(p_body, ''));
  v_service text := nullif(btrim(coalesce(p_service, '')), '');
  v_id uuid;
begin
  if not private.can_write_consultant_notes(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(v_body) < 1 then
    raise exception 'VALIDATION_ERROR: Write the note first.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 4000 characters.' using errcode = 'P0001';
  end if;
  if v_service is not null and not exists (select 1 from public.crm_services where code = v_service) then
    raise exception 'VALIDATION_ERROR: Unknown service.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  insert into public.consultant_notes (customer_id, author_id, body, service_code)
  values (p_customer, (select private.my_id()), v_body, v_service) returning id into v_id;
  perform private.write_audit('CONSULTANT_NOTE_ADDED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('note_id', v_id));
  return v_id;
end $$;
revoke all on function public.consultant_add_note(uuid, text, text) from public, anon;
grant execute on function public.consultant_add_note(uuid, text, text) to authenticated;

-- Only the author edits a note; the earlier text is kept in the audit log.
create or replace function public.consultant_update_note(p_note uuid, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  n public.consultant_notes;
  v public.customers;
  v_body text := btrim(coalesce(p_body, ''));
begin
  select * into n from public.consultant_notes where id = p_note for update;
  if n.id is null or not private.can_write_consultant_notes(n.customer_id) then
    raise exception 'NOT_FOUND: Note not found.' using errcode = 'P0001';
  end if;
  if n.author_id is distinct from (select private.my_id()) then
    raise exception 'FORBIDDEN: Only the person who wrote a note can edit it.' using errcode = 'P0001';
  end if;
  if length(v_body) < 1 then
    raise exception 'VALIDATION_ERROR: Write the note first.' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 4000 characters.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = n.customer_id;
  update public.consultant_notes set body = v_body, updated_at = now() where id = p_note;
  perform private.write_audit('CONSULTANT_NOTE_EDITED', 'customer', n.customer_id, v.department_id, v.team_id,
    jsonb_build_object('note_id', p_note, 'previous', n.body));
end $$;
revoke all on function public.consultant_update_note(uuid, text) from public, anon;
grant execute on function public.consultant_update_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Add-ons Services
-- ---------------------------------------------------------------------------
alter table public.customer_onboarding
  add column if not exists addons_required boolean,
  add column if not exists addons_submitted_at timestamptz,
  add column if not exists addons_submitted_by uuid references public.profiles (id) on delete set null,
  add column if not exists addon_items_total integer not null default 0,
  add column if not exists addon_items_saved integer not null default 0,
  add column if not exists addon_items_verified integer not null default 0,
  add column if not exists addon_items_rejected integer not null default 0;
create index if not exists customer_onboarding_addons_idx on public.customer_onboarding (addons_submitted_at) where addons_submitted_at is not null;

-- Catalogue codes of the add-on services selected for a customer (typed-by-hand add-ons have no code).
create or replace function private.customer_addon_codes(p_customer uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(a ->> 'code'), '{}'::text[])
    from public.customer_onboarding o, jsonb_array_elements(o.addons) a
   where o.customer_id = p_customer and a ->> 'code' is not null
$$;
revoke all on function private.customer_addon_codes(uuid) from public, anon, authenticated;

-- Items the TC collects for those add-on services: the same catalogue items as normal onboarding.
create or replace function private.customer_addon_items(p_customer uuid)
returns setof public.onboarding_items language sql stable security definer set search_path = '' as $$
  select i.* from public.onboarding_items i
   where i.is_active and i.filled_by = 'SALES' and not i.always_required and exists (
     select 1 from public.onboarding_item_services m
      where m.item_code = i.code and m.service_code = any (private.customer_addon_codes(p_customer)))
$$;
revoke all on function private.customer_addon_items(uuid) from public, anon, authenticated;

create or replace function private.refresh_addon_progress(p_customer uuid)
returns void language sql security definer set search_path = '' as $$
  with items as (select code, is_optional from private.customer_addon_items(p_customer)),
  e as (select i.code, i.is_optional, x.status
          from items i left join public.customer_onboarding_entries x on x.customer_id = p_customer and x.item_code = i.code)
  update public.customer_onboarding o set
    addon_items_total = (select count(*) from e where not is_optional or status is not null),
    addon_items_saved = (select count(*) from e where status in ('SAVED', 'VERIFIED')),
    addon_items_verified = (select count(*) from e where status = 'VERIFIED'),
    addon_items_rejected = (select count(*) from e where status = 'REJECTED')
  where o.customer_id = p_customer
$$;
revoke all on function private.refresh_addon_progress(uuid) from public, anon, authenticated;

create or replace function private.tg_entries_addon_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_addon_progress(coalesce(new.customer_id, old.customer_id));
  return null;
end $$;
drop trigger if exists customer_onboarding_entries_addon_progress on public.customer_onboarding_entries;
create trigger customer_onboarding_entries_addon_progress after insert or update or delete on public.customer_onboarding_entries
  for each row execute function private.tg_entries_addon_progress();

create or replace function private.tg_onboarding_addons_progress()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.refresh_addon_progress(new.customer_id);
  return null;
end $$;
drop trigger if exists customer_onboarding_addons_progress on public.customer_onboarding;
create trigger customer_onboarding_addons_progress after update of addons on public.customer_onboarding
  for each row execute function private.tg_onboarding_addons_progress();

-- Who may collect (save / upload / replace) an add-on item: the department's TC, only after the customer was sent to Add-ons.
create or replace function private.can_collect_addon_item(p_customer uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_support_department_id())
     and private.can_review_onboarding(p_customer)
     and exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.addons_submitted_at is not null)
     and exists (select 1 from private.customer_addon_items(p_customer) i where i.code = p_item)
$$;
revoke all on function private.can_collect_addon_item(uuid, text) from public, anon;
grant execute on function private.can_collect_addon_item(uuid, text) to authenticated;

create or replace function private.lock_collect_customer(p_customer uuid, p_item text)
returns public.customers language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
begin
  if private.can_access_customer(p_customer) then
    return private.lock_accessible_customer(p_customer);
  end if;
  if not private.can_collect_addon_item(p_customer, p_item) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  return v;
end $$;
revoke all on function private.lock_collect_customer(uuid, text) from public, anon, authenticated;

-- The checklist of the add-on services, in the same shape as the normal checklist.
create or replace function public.customer_addon_checklist(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_codes text[];
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  v_codes := private.customer_addon_codes(p_customer);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', i.code, 'section', i.section, 'label', i.label, 'hint', i.hint, 'kind', i.kind, 'options', i.options,
      'filledBy', i.filled_by, 'optional', i.is_optional,
      'serviceCode', (select m.service_code from public.onboarding_item_services m
                       join public.crm_services s on s.code = m.service_code
                      where m.item_code = i.code and m.service_code = any (v_codes) order by s.sort_order limit 1),
      'services', (select coalesce(jsonb_agg(m.service_code order by m.service_code), '[]'::jsonb) from public.onboarding_item_services m
                    where m.item_code = i.code and m.service_code = any (v_codes)),
      'allowedMimeTypes', t.allowed_mime_types, 'maxSizeBytes', t.max_size_bytes,
      'entry', case when e.item_code is null then null else jsonb_build_object(
        'status', e.status, 'value', e.value, 'documentId', e.document_id,
        'savedBy', (select full_name from public.profiles where id = e.saved_by), 'savedAt', e.saved_at,
        'reviewedBy', (select full_name from public.profiles where id = e.reviewed_by), 'reviewedAt', e.reviewed_at,
        'reviewNote', e.review_note) end)
      order by i.sort_order)
    from private.customer_addon_items(p_customer) i
    left join public.document_types t on t.code = i.code and i.kind = 'FILE'
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code), '[]'::jsonb);
end $$;
revoke all on function public.customer_addon_checklist(uuid) from public, anon;
grant execute on function public.customer_addon_checklist(uuid) to authenticated;

-- Saving a non-file item: also allowed for the TC on an add-on item.
create or replace function public.save_onboarding_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_item);
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Details are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into i from (select * from private.customer_items(p_customer)
                         union all select * from private.customer_optional_items(p_customer)
                         union all select * from private.customer_addon_items(p_customer)) x where x.code = p_item limit 1;
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not part of this customer''s onboarding.' using errcode = 'P0001';
  end if;
  if i.kind = 'FILE' then
    raise exception 'VALIDATION_ERROR: Upload a file for this item.' using errcode = 'P0001';
  end if;
  if v_value is null then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  if length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep it under 4000 characters.' using errcode = 'P0001';
  end if;
  if i.kind = 'YES_NO' and v_value not in ('YES', 'NO') then
    raise exception 'VALIDATION_ERROR: Answer yes or no.' using errcode = 'P0001';
  end if;
  if i.kind = 'AMOUNT' and v_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception 'VALIDATION_ERROR: Enter an amount in rupees.' using errcode = 'P0001';
  end if;
  if i.kind = 'CHOICE' and not (v_value = any (i.options)) then
    raise exception 'VALIDATION_ERROR: Choose one of the options.' using errcode = 'P0001';
  end if;

  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at)
  values (p_customer, p_item, v_value, 'SAVED', (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_note = case when e.status = 'REJECTED' then e.review_note end;

  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEM_SAVED', format('%s saved', i.label));
  perform private.write_audit('ONBOARDING_ITEM_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item));
  perform private.refresh_onboarding_progress(p_customer);
end $$;
revoke all on function public.save_onboarding_entry(uuid, text, text) from public, anon;
grant execute on function public.save_onboarding_entry(uuid, text, text) to authenticated;

-- Uploads: unchanged rules; the TC may upload the documents of an add-on item.
create or replace function public.begin_document_upload(
  p_customer uuid, p_type text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_type);
  t public.document_types;
  d public.customer_documents;
  v_id uuid := gen_random_uuid();
  v_ext text;
begin
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Documents are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = p_type;
  if t.code is null then
    raise exception 'VALIDATION_ERROR: Unknown document type.' using errcode = 'P0001';
  end if;
  if p_mime is null or not (p_mime = any (t.allowed_mime_types)) then
    raise exception 'VALIDATION_ERROR: This file type is not accepted for %.', t.label using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File must be smaller than %.',
      case when t.max_size_bytes < 1048576 then (t.max_size_bytes / 1024) || ' KB' else (t.max_size_bytes / 1048576) || ' MB' end using errcode = 'P0001';
  end if;
  v_ext := case p_mime
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'text/csv' then 'csv' when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' when 'audio/mp4' then 'm4a' else 'bin' end;

  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_customer, p_type, null, 'PENDING',
          format('customers/%s/%s/%s.%s', p_customer, t.storage_folder, v_id, v_ext),
          left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'document.' || v_ext), '[\r\n\t/\\]', '_', 'g'), 255),
          p_mime, p_size, (select private.my_id()))
  returning * into d;
  return d;
end $$;
revoke all on function public.begin_document_upload(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.begin_document_upload(uuid, text, text, text, bigint) to authenticated;

create or replace function public.complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  t public.document_types;
  v_replaced public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not (private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type)) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: Uploaded file size is not allowed.' using errcode = 'P0001';
  end if;
  v := private.lock_collect_customer(d.customer_id, d.document_type);

  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = d.customer_id and document_type = d.document_type and status = 'UPLOADED'
  returning * into v_replaced;

  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = d.customer_id and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  perform private.write_audit(
    case when d.document_type = 'INVOICE' then (case when v_replaced.id is null then 'INVOICE_UPLOADED' else 'INVOICE_REPLACED' end)
         else (case when v_replaced.id is null then 'DOCUMENT_UPLOADED' else 'DOCUMENT_REPLACED' end) end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version,
                       'replaced_document_id', v_replaced.id, 'size_bytes', p_size));
  perform private.log_customer_activity(d.customer_id, 'DOCUMENT_UPLOADED',
    format('%s %s (v%s)', t.label, case when v_replaced.id is null then 'uploaded' else 'replaced' end, d.version));
  perform private.refresh_onboarding_progress(d.customer_id);
  return d;
end $$;
revoke all on function public.complete_document_upload(uuid, bigint) from public, anon;
grant execute on function public.complete_document_upload(uuid, bigint) to authenticated;

create or replace function public.fail_document_upload(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not (private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type)) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'FAILED' where id = p_document;
  return d.storage_path;
end $$;
revoke all on function public.fail_document_upload(uuid) from public, anon;
grant execute on function public.fail_document_upload(uuid) to authenticated;

-- Yes / No: does the customer need add-on services? Saved selections are never deleted by answering No.
create or replace function public.consultant_set_addons_required(p_customer uuid, p_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_required is null then
    raise exception 'VALIDATION_ERROR: Choose Yes or No.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.addons_submitted_at is not null and not p_required then
    raise exception 'CONFLICT: This customer was already sent to Add-ons Services, so it cannot be switched back to No.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set addons_required = p_required where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ADDONS_REQUIRED_UPDATED',
    case when p_required then 'Customer needs add-on services' else 'Customer does not need add-on services' end);
end $$;
revoke all on function public.consultant_set_addons_required(uuid, boolean) from public, anon;
grant execute on function public.consultant_set_addons_required(uuid, boolean) to authenticated;

-- "Send to Add-ons": the customer joins the Add-ons Services workflow (once).
create or replace function public.consultant_send_to_addons(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.addons_submitted_at is not null then
    raise exception 'CONFLICT: This customer was already sent to Add-ons Services.' using errcode = 'P0001';
  end if;
  if o.consultant_started_at is not null then
    raise exception 'CONFLICT: This customer is already in onboarding.' using errcode = 'P0001';
  end if;
  if o.addons_required is not true then
    raise exception 'VALIDATION_ERROR: Answer Yes to "additional services" first.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(o.addons) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one add-on service.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding
     set addons_submitted_at = now(), addons_submitted_by = (select private.my_id())
   where customer_id = p_customer;
  perform private.refresh_addon_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'SENT_TO_ADDONS',
    format('Sent to Add-ons Services (%s add-on%s)', jsonb_array_length(o.addons), case when jsonb_array_length(o.addons) = 1 then '' else 's' end));
  perform private.write_audit('CONSULTANT_SENT_TO_ADDONS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('addons', o.addons));
  perform private.notify(v.owner_id, 'SENT_TO_ADDONS', format('Add-on services: %s', coalesce(v.company, v.name)),
    'The Technical Consultant is collecting the documents for the add-on services.', 'customer', p_customer);
end $$;
revoke all on function public.consultant_send_to_addons(uuid) from public, anon;
grant execute on function public.consultant_send_to_addons(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. "Send for onboarding" waits for "Send to Add-ons" when add-ons were chosen
-- ---------------------------------------------------------------------------
create or replace function public.consultant_start_onboarding(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.consultant_started_at is not null then
    raise exception 'CONFLICT: This customer is already in onboarding.' using errcode = 'P0001';
  end if;
  if coalesce(o.addons_required, false) and jsonb_array_length(o.addons) > 0 and o.addons_submitted_at is null then
    raise exception 'CONFLICT: Add-on services are selected. Use "Send to Add-ons" first.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding
     set consultant_started_at = now(), consultant_started_by = (select private.my_id())
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ONBOARDING_STARTED_BY_CONSULTANT', 'Sent for onboarding by the Technical Consultant');
  perform private.write_audit('CONSULTANT_ONBOARDING_STARTED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('contract_signed', o.contract_signed, 'addons', o.addons));
  perform private.notify(v.owner_id, 'ONBOARDING_STARTED', format('Onboarding started: %s', coalesce(v.company, v.name)),
    'The Technical Consultant started onboarding. They will verify the documents next.', 'customer', p_customer);
end $$;
revoke all on function public.consultant_start_onboarding(uuid) from public, anon;
grant execute on function public.consultant_start_onboarding(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Counts: Customers panel vs Add-ons Services
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_review_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'all', count(*) filter (where o.consultant_started_at is not null),
    'TO_REVIEW', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'TO_REVIEW'),
    'NEEDS_FIX', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'NEEDS_FIX'),
    'VERIFIED', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'VERIFIED'),
    'AWAITING_DOCUMENTS', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'AWAITING_DOCUMENTS'),
    'WAITING_ON_SALES', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'WAITING_ON_SALES'),
    'newCustomers', count(*) filter (where o.consultant_started_at is null and o.addons_submitted_at is null),
    'addons', count(*) filter (where o.addons_submitted_at is not null))
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  where c.lifecycle_stage = 'ONBOARDING' and private.can_view_onboarding_review(c.id)
$$;
revoke all on function public.onboarding_review_counts() from public, anon;
grant execute on function public.onboarding_review_counts() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Live updates: onboarding progress / add-on state reach open screens without a refresh
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.customer_onboarding;
  exception when duplicate_object then null; when undefined_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.customer_onboarding_entries;
  exception when duplicate_object then null; when undefined_object then null;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Editing the contact details: refuse a save made from a stale form
--    (p_expected = the updated_at the form was loaded with).
-- ---------------------------------------------------------------------------
drop function if exists public.consultant_update_customer(uuid, text, text, text, text);
create or replace function public.consultant_update_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_expected text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_updated timestamptz;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(v_name) < 2 then
    raise exception 'VALIDATION_ERROR: Enter the customer''s name.' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'VALIDATION_ERROR: Enter a phone number or an e-mail address.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if v_phone is not null and (v_phone !~ '^[0-9+()\-\s.]{5,25}$' or length(regexp_replace(v_phone, '\D', '', 'g')) < 7) then
    raise exception 'VALIDATION_ERROR: Enter a valid phone number (at least 7 digits).' using errcode = 'P0001';
  end if;
  select updated_at into v_updated from public.customers where id = p_customer for update;
  if p_expected is not null and v_updated is distinct from p_expected::timestamptz then
    raise exception 'CONFLICT: This customer was changed by someone else while you were editing. Close this and open it again to see the latest details.' using errcode = 'P0001';
  end if;
  begin
    update public.customers
       set name = v_name, company = nullif(trim(coalesce(p_company, '')), ''), phone = v_phone, email = v_email,
           updated_by = (select private.my_id())
     where id = p_customer;
  exception when unique_violation then
    raise exception 'CONFLICT: Another customer of this department already uses that e-mail address.' using errcode = 'P0001';
  end;
  perform private.log_customer_activity(p_customer, 'CUSTOMER_UPDATED', 'Details updated by the Technical Consultant');
end $$;
revoke all on function public.consultant_update_customer(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.consultant_update_customer(uuid, text, text, text, text, text) to authenticated;
