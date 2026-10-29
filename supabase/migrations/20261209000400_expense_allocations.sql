-- =============================================================================
-- One expense, several departments.
--
-- What was wrong
--   department_expenses had ONE department_id per row, so an expense shared by several departments had to be typed as several unrelated rows
--   (and counted as several expenses).
--
-- Now
--   * The expense is stored once (department_expenses: description, date, category, total amount, status). Who bears how much is in
--     public.expense_allocations (expense, department, amount), one row per department.
--   * The allocations of an expense ALWAYS add up to its amount: a deferred constraint trigger refuses the transaction otherwise, whatever wrote
--     it. An expense without allocations is a company-wide expense (as before).
--   * accounts_add_expense_split / accounts_update_expense_split take the whole allocation list and save it in one transaction. The server
--     recalculates the sum; a repeated request (same request id) returns the same expense. The same department twice is COMBINED into one row.
--     Amounts have at most two decimals and are above zero; departments must exist.
--   * Company totals count the expense once at its full amount; a department's totals count only its allocated part. Department Income /
--     Expense, the Accounts overview and the dashboards read the allocations.
--   * The older single-department functions keep working: the department_id column and the one-row allocation are kept in step by a trigger, and
--     editing an expense that is split through the old function is refused (it would silently drop the split).
--   * Existing expenses get their one allocation (their department, their full amount) here; company-wide ones stay without allocations.
--   * Every department that receives an allocation of a NEW manual expense gets its own e-mail (migration 20261209000300), with only its own
--     amount.
-- Safe to run again. No expense is changed or deleted.
-- =============================================================================

alter table public.department_expenses add column if not exists request_id uuid;
create unique index if not exists department_expenses_request_key on public.department_expenses (request_id) where request_id is not null;

create table if not exists public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.department_expenses (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (expense_id, department_id)
);
create index if not exists expense_allocations_department_idx on public.expense_allocations (department_id);
alter table public.expense_allocations enable row level security;
revoke all on public.expense_allocations from public, anon, authenticated;

-- the expenses that exist already: their department takes all of the amount
insert into public.expense_allocations (expense_id, department_id, amount)
select e.id, e.department_id, e.amount from public.department_expenses e
 where e.department_id is not null
   and not exists (select 1 from public.expense_allocations a where a.expense_id = e.id)
on conflict (expense_id, department_id) do nothing;

-- ---------------------------------------------------------------------------
-- The allocations always add up to the amount (checked at the end of the transaction, whoever wrote them)
-- ---------------------------------------------------------------------------
create or replace function private.check_expense_allocations_total(p_expense uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_amount numeric;
  v_sum numeric;
  v_n integer;
begin
  select amount into v_amount from public.department_expenses where id = p_expense;
  if v_amount is null then
    return;   -- the expense is gone (deleted together with its allocations)
  end if;
  select coalesce(sum(a.amount), 0), count(*) into v_sum, v_n from public.expense_allocations a where a.expense_id = p_expense;
  if v_n > 0 and v_sum <> v_amount then
    raise exception 'VALIDATION_ERROR: The department amounts (%) must add up to the expense amount (%).', v_sum, v_amount using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_expense_allocations_total(uuid) from public, anon, authenticated;
create or replace function private.tg_allocations_total()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_expense_allocations_total(coalesce(new.expense_id, old.expense_id));
  return null;
end $$;
create or replace function private.tg_expense_amount_total()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_expense_allocations_total(new.id);
  return null;
end $$;
revoke all on function private.tg_allocations_total() from public, anon, authenticated;
revoke all on function private.tg_expense_amount_total() from public, anon, authenticated;
drop trigger if exists expense_allocations_total on public.expense_allocations;
create constraint trigger expense_allocations_total after insert or update or delete on public.expense_allocations
  deferrable initially deferred for each row execute function private.tg_allocations_total();
drop trigger if exists department_expenses_allocations_total on public.department_expenses;
create constraint trigger department_expenses_allocations_total after update of amount on public.department_expenses
  deferrable initially deferred for each row execute function private.tg_expense_amount_total();
drop function if exists private.tg_expense_allocations_total();

-- ---------------------------------------------------------------------------
-- A single-department expense written the old way keeps its one allocation in step
-- ---------------------------------------------------------------------------
create or replace function private.tg_expense_single_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.department_id is not null then
    delete from public.expense_allocations where expense_id = new.id and department_id <> new.department_id;
    insert into public.expense_allocations (expense_id, department_id, amount) values (new.id, new.department_id, new.amount)
    on conflict (expense_id, department_id) do update set amount = excluded.amount;
  elsif tg_op = 'UPDATE' and old.department_id is not null then
    delete from public.expense_allocations where expense_id = new.id;   -- it became company-wide
  end if;
  return null;
end $$;
revoke all on function private.tg_expense_single_allocation() from public, anon, authenticated;
drop trigger if exists department_expenses_single_allocation on public.department_expenses;
create trigger department_expenses_single_allocation after insert or update of department_id, amount on public.department_expenses
  for each row execute function private.tg_expense_single_allocation();

-- ---------------------------------------------------------------------------
-- A new manual expense tells each department's head about its own part
-- ---------------------------------------------------------------------------
create or replace function private.tg_expense_allocation_mail()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  e public.department_expenses;
  v_dept text;
begin
  begin
    select * into e from public.department_expenses where id = new.expense_id;
    if e.id is null or e.source <> 'MANUAL' then return null; end if;   -- imports (sheets, files) send nothing
    select name into v_dept from public.departments where id = new.department_id;
    perform private.finance_mail_queue('EXPENSE_ADDED', new.department_id, null, e.id::text,
      jsonb_build_object('description', e.description, 'category', e.category, 'date', to_char(e.expense_date, 'DD Mon YYYY'), 'allocated', new.amount,
                         'status', e.payment_status, 'department', v_dept, 'at', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')));
  exception when others then
    raise warning 'finance e-mail could not be queued for expense %: %', new.expense_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_expense_allocation_mail() from public, anon, authenticated;
drop trigger if exists expense_allocations_mail on public.expense_allocations;
create trigger expense_allocations_mail after insert on public.expense_allocations for each row execute function private.tg_expense_allocation_mail();

-- ---------------------------------------------------------------------------
-- Checking an allocation list (used by add and update)
-- ---------------------------------------------------------------------------
create or replace function private.clean_expense_allocations(p_total numeric, p_allocations jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
  v_dept uuid;
  v_amt numeric;
  v_map jsonb := '{}'::jsonb;
  v_sum numeric := 0;
  k text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'VALIDATION_ERROR: Add at least one department row.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_allocations) > 30 then
    raise exception 'VALIDATION_ERROR: At most 30 department rows.' using errcode = 'P0001';
  end if;
  for r in select * from jsonb_array_elements(p_allocations) loop
    begin
      v_dept := (r ->> 'departmentId')::uuid;
      v_amt := (r ->> 'amount')::numeric;
    exception when others then
      raise exception 'VALIDATION_ERROR: Each department row needs a department and an amount.' using errcode = 'P0001';
    end;
    if v_dept is null or v_amt is null or v_amt <= 0 then
      raise exception 'VALIDATION_ERROR: Each department row needs a department and an amount above zero.' using errcode = 'P0001';
    end if;
    if v_amt <> round(v_amt, 2) then
      raise exception 'VALIDATION_ERROR: Use at most 2 decimal places in a department amount.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.departments d where d.id = v_dept) then
      raise exception 'VALIDATION_ERROR: Choose each department from the list.' using errcode = 'P0001';
    end if;
    -- the same department twice is one department
    v_map := jsonb_set(v_map, array[v_dept::text], to_jsonb(coalesce((v_map ->> v_dept::text)::numeric, 0) + v_amt));
  end loop;
  for k in select jsonb_object_keys(v_map) loop
    v_sum := v_sum + (v_map ->> k)::numeric;
    v_out := v_out || jsonb_build_array(jsonb_build_object('departmentId', k, 'amount', (v_map ->> k)::numeric));
  end loop;
  if v_sum <> p_total then
    raise exception 'VALIDATION_ERROR: The department amounts add up to % but the expense is %. They must be equal.', v_sum, p_total using errcode = 'P0001';
  end if;
  return v_out;
end $$;
revoke all on function private.clean_expense_allocations(numeric, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Add / update an expense with its allocations, in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.accounts_add_expense_split(p_request uuid, p_date date, p_description text, p_category text, p_amount numeric, p_status text, p_notes text, p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_alloc jsonb;
  v_n integer;
  a jsonb;
begin
  perform private.require_accounts_staff();
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request is missing its reference.' using errcode = 'P0001';
  end if;
  -- a repeated request (a double click, a retry) is the same expense
  select id into v_id from public.department_expenses where request_id = p_request;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'replayed', true);
  end if;
  perform private.check_expense_fields(p_date, p_description, null, p_category, p_amount, p_status, p_notes);
  -- no allocation rows = a company-wide expense
  v_alloc := case when jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) = 0 then '[]'::jsonb else private.clean_expense_allocations(p_amount, p_allocations) end;
  v_n := jsonb_array_length(v_alloc);
  insert into public.department_expenses (expense_date, description, department_id, category, amount, payment_status, notes, created_by, request_id)
  values (p_date, btrim(p_description), case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end, btrim(p_category), p_amount, p_status,
          nullif(btrim(coalesce(p_notes, '')), ''), (select private.my_id()), p_request)
  returning id into v_id;
  delete from public.expense_allocations where expense_id = v_id;   -- (the single-department trigger may have made one)
  for a in select * from jsonb_array_elements(v_alloc) loop
    insert into public.expense_allocations (expense_id, department_id, amount) values (v_id, (a ->> 'departmentId')::uuid, (a ->> 'amount')::numeric);
  end loop;
  perform private.write_audit('EXPENSE_ADDED', 'expense', v_id, case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end, null,
    jsonb_build_object('amount', p_amount, 'category', p_category, 'allocations', v_alloc));
  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;
revoke all on function public.accounts_add_expense_split(uuid, date, text, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.accounts_add_expense_split(uuid, date, text, text, numeric, text, text, jsonb) to authenticated;

create or replace function public.accounts_update_expense_split(p_id uuid, p_date date, p_description text, p_category text, p_amount numeric, p_status text, p_notes text, p_allocations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.department_expenses;
  v_alloc jsonb;
  v_n integer;
  a jsonb;
begin
  perform private.require_accounts_staff();
  select * into e from public.department_expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND: Expense not found.' using errcode = 'P0001'; end if;
  if not private.can_change_expense(e.created_by) then
    raise exception 'FORBIDDEN: You can only change expenses you added.' using errcode = '42501';
  end if;
  perform private.check_expense_fields(p_date, p_description, null, p_category, p_amount, p_status, p_notes);
  v_alloc := case when jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) = 0 then '[]'::jsonb else private.clean_expense_allocations(p_amount, p_allocations) end;
  v_n := jsonb_array_length(v_alloc);
  update public.department_expenses set expense_date = p_date, description = btrim(p_description), category = btrim(p_category), amount = p_amount,
         payment_status = p_status, notes = nullif(btrim(coalesce(p_notes, '')), ''),
         department_id = case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end
   where id = p_id;
  delete from public.expense_allocations where expense_id = p_id;
  for a in select * from jsonb_array_elements(v_alloc) loop
    insert into public.expense_allocations (expense_id, department_id, amount) values (p_id, (a ->> 'departmentId')::uuid, (a ->> 'amount')::numeric);
  end loop;
  perform private.write_audit('EXPENSE_EDITED', 'expense', p_id, case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end, null,
    jsonb_build_object('amount', p_amount, 'was', e.amount, 'allocations', v_alloc));
end $$;
revoke all on function public.accounts_update_expense_split(uuid, date, text, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.accounts_update_expense_split(uuid, date, text, text, numeric, text, text, jsonb) to authenticated;

-- the older single-department update must not silently drop a split
create or replace function public.accounts_update_expense(p_id uuid, p_date date, p_description text, p_department uuid, p_category text, p_amount numeric, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.department_expenses;
begin
  perform private.require_accounts_staff();
  select * into e from public.department_expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND: Expense not found.' using errcode = 'P0001'; end if;
  if not private.can_change_expense(e.created_by) then
    raise exception 'FORBIDDEN: You can only change expenses you added.' using errcode = '42501';
  end if;
  if (select count(*) from public.expense_allocations a where a.expense_id = p_id) > 1 then
    raise exception 'CONFLICT: This expense is split across departments. Edit it with its department amounts.' using errcode = 'P0001';
  end if;
  perform private.check_expense_fields(p_date, p_description, p_department, p_category, p_amount, p_status, p_notes);
  update public.department_expenses set expense_date = p_date, description = btrim(p_description), department_id = p_department,
         category = btrim(p_category), amount = p_amount, payment_status = p_status, notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_id;
  perform private.write_audit('EXPENSE_EDITED', 'expense', p_id, p_department, null, jsonb_build_object('amount', p_amount, 'was', e.amount));
end $$;
revoke all on function public.accounts_update_expense(uuid, date, text, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_update_expense(uuid, date, text, uuid, text, numeric, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The expense list shows the allocations; a department's filter is its allocation
-- ---------------------------------------------------------------------------
create or replace function public.accounts_expenses_list(p_search text DEFAULT NULL::text, p_department uuid DEFAULT NULL::uuid, p_company_wide boolean DEFAULT false, p_category text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  select count(*), coalesce(sum(coalesce((select xa.amount from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department), e.amount)), 0),
         coalesce(sum(coalesce((select xa.amount from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department), e.amount)) filter (where e.payment_status = 'PENDING'), 0)
    into v_total, v_sum, v_pending
    from public.department_expenses e
   where (p_department is null or exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department)) and (not coalesce(p_company_wide, false) or not exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id))
     and (p_category is null or lower(e.category) = lower(p_category)) and (p_status is null or e.payment_status = p_status)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
     and (v_term is null or lower(e.description) like '%' || v_term || '%' or lower(e.category) like '%' || v_term || '%' or lower(coalesce(e.notes, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by expense_date desc, created_at desc), '[]'::jsonb) into v_items from (
    select e.expense_date, e.created_at, jsonb_build_object(
      'id', e.id, 'date', e.expense_date, 'description', e.description, 'departmentId', e.department_id, 'department', coalesce(d.name, (select string_agg(xd.name, ', ' order by xd.name) from public.expense_allocations xa join public.departments xd on xd.id = xa.department_id where xa.expense_id = e.id)),
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('departmentId', xa.department_id, 'department', xd.name, 'amount', xa.amount) order by xd.name)
                                 from public.expense_allocations xa join public.departments xd on xd.id = xa.department_id where xa.expense_id = e.id), '[]'::jsonb),
      'allocatedToFilter', case when p_department is null then null else (select xa.amount from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department) end,
      'category', e.category, 'amount', e.amount, 'status', e.payment_status, 'notes', e.notes, 'source', e.source,
      'createdBy', (select full_name from public.profiles where id = e.created_by),
      'canChange', private.can_change_expense(e.created_by)) as j
      from public.department_expenses e left join public.departments d on d.id = e.department_id
     where (p_department is null or exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department)) and (not coalesce(p_company_wide, false) or not exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id))
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

-- ---------------------------------------------------------------------------
-- Department totals use each department's allocated part
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_by_department()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
    left join (select p.department_id, sum(p.amount) amount, count(*) n
                 from private.verified_income_attributed() p
                group by p.department_id) i on i.department_id = d.id
    left join (select a.department_id, sum(a.amount) amount, count(*) n,
                      sum(a.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.expense_allocations a join public.department_expenses e on e.id = a.expense_id
                group by a.department_id) x on x.department_id = d.id
   where d.generates_revenue;
  return v;
end $$;
revoke all on function public.accounts_finance_by_department() from public, anon;
grant execute on function public.accounts_finance_by_department() to authenticated;

-- ---------------------------------------------------------------------------
-- Finance summary: the company counts an expense once, a department only its part
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_summary(p_department uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_income numeric; v_income_n bigint;
  v_exp numeric; v_exp_paid numeric; v_exp_pending numeric; v_exp_n bigint;
begin
  perform private.require_accounts_staff();
  select coalesce(sum(p.amount), 0), count(*) into v_income, v_income_n
    from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
   where (p_department is null or p.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to);
  -- company-wide: every expense ONCE at its full amount. One department: only the part allocated to it.
  select coalesce(sum(x.amt), 0), coalesce(sum(x.amt) filter (where x.payment_status = 'PAID'), 0),
         coalesce(sum(x.amt) filter (where x.payment_status = 'PENDING'), 0), count(*)
    into v_exp, v_exp_paid, v_exp_pending, v_exp_n
    from (select e.payment_status, case when p_department is null then e.amount else (select a.amount from public.expense_allocations a where a.expense_id = e.id and a.department_id = p_department) end amt
            from public.department_expenses e
           where (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
             and (p_department is null or exists (select 1 from public.expense_allocations a where a.expense_id = e.id and a.department_id = p_department))) x;
  return jsonb_build_object('income', v_income, 'incomeCount', v_income_n, 'expenses', v_exp, 'expensesPaid', v_exp_paid,
    'expensesPending', v_exp_pending, 'expenseCount', v_exp_n, 'net', v_income - v_exp);
end $$;
revoke all on function public.accounts_finance_summary(uuid, date, date) from public, anon;
grant execute on function public.accounts_finance_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The company overview: each department's expenses are its allocations
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_company_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
    into v_money from private.verified_income_attributed() p;

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
    left join (select p.department_id, sum(p.amount) amount, sum(p.amount) filter (where p.paid_at::date >= v_month) this_month
                 from private.verified_income_attributed() p group by p.department_id) i on i.department_id = d.id
    left join (select a.department_id, sum(a.amount) amount, sum(a.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.expense_allocations a join public.department_expenses e on e.id = a.expense_id group by a.department_id) x on x.department_id = d.id
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

notify pgrst, 'reload schema';
