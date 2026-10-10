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
