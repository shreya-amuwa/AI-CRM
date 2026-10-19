-- Department-wise business attribution and the Accounts Sales / Support business reports.
--
-- Safe to run again in the Supabase SQL editor. Run it after 20261103000100_order_tax_basis.sql.
--
-- What this adds (and what it deliberately does not):
--   * NO new money tables. Every figure is read from the payment records that already exist, so nothing can be counted twice:
--       customer_payments  the payments of the services Sales agreed with the customer            -> INITIAL SALE  -> Sales
--       addon_payments     the payments of approved add-on requests                              -> ADD-ON        -> Support
--       invoice_payments   payments recorded on an invoice itself:
--                            SERVICES invoice                                                    -> INITIAL SALE  -> Sales
--                            ADDON invoice                                                       -> ADD-ON        -> Support
--                            ADDITIONAL invoice tagged Renewal / Add-on by Accounts              -> RENEWAL / ADD-ON -> Support
--                            ADDITIONAL invoice nobody has tagged                                -> UNCLASSIFIED (counted in neither)
--       customer_plans     a monthly plan Accounts activated as paid                             -> SUBSCRIPTION  -> Support
--   * invoice_business_tags: the one small extension. The system has no renewal transaction of its own (only renewal DATES), so
--     Accounts says which additional invoice is a renewal (or an add-on bought outside the add-on workflow). The tag can also
--     name the Support member who asked for the invoice (an invoice request), which is how a renewal gets its responsible employee.
--   * private.business_ledger() / private.business_orders(): the single definition of every figure. The dashboards, the employee
--     tables and the transaction list all read these, so they always agree.
--   * business_report(), business_report_transactions(): the Accounts department (it already sees every department's income)
--     and the Super Admin only.
--
-- Accounting basis (unchanged, same as Accounts' income): CASH. A figure counts as collected only when its payment is VERIFIED.
-- An unpaid or pending invoice is never collected revenue; it is shown as pending / outstanding.
--   collected    verified payments (money received)
--   pending      payments recorded but not yet verified by Accounts
--   refunded     payments that were REVERSED (taken back out of collected)
--   billed       what was agreed / invoiced for the orders in the range (Sales: the agreed amount; add-on: the add-on total;
--                renewal: the invoice total)
--   outstanding  billed - collected, never below zero, for those orders as of now
-- Rejected payments are not money and appear in none of these.
--
-- Who is responsible (never guessed; blank means "not recorded", listed for review):
--   Initial sale   the Sales member who submitted the sale for payment confirmation (payment_requests.requested_by, unless Accounts
--                  sent it back); a payment
--                  Sales recorded itself falls back to whoever recorded it. The customer's CURRENT owner is never used, so
--                  reassigning a customer does not move old sales.
--   Add-on         the member who submitted the add-on request (then its creator, then its Technical Consultant)
--   Renewal        the Support member whose invoice request Accounts linked when tagging the invoice
--   Plan           not recorded by the workflow

-- ---------------------------------------------------------------------------
-- 1. Accounts tags an additional invoice as a renewal / add-on
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_business_tags (
  invoice_id uuid primary key references public.member_invoices (id) on delete cascade,
  kind text not null check (kind in ('RENEWAL', 'ADDON', 'OTHER')),
  service_code text references public.crm_services (code) on delete set null,
  invoice_request_id uuid references public.invoice_requests (id) on delete set null,
  responsible_id uuid references public.profiles (id) on delete set null,
  note text check (length(note) <= 500),
  tagged_by uuid references public.profiles (id) on delete set null,
  tagged_at timestamptz not null default now()
);
alter table public.invoice_business_tags enable row level security;
revoke all on public.invoice_business_tags from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Access: the Accounts department and the Super Admin
-- ---------------------------------------------------------------------------
create or replace function private.can_view_business_reports()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff()
$$;
revoke all on function private.can_view_business_reports() from public, anon;
grant execute on function private.can_view_business_reports() to authenticated;

create or replace function private.require_business_reports()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_business_reports() then
    raise exception 'FORBIDDEN: Only the Accounts department can see the business reports.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_business_reports() from public, anon;
grant execute on function private.require_business_reports() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The ledger: one row per payment event, classified once
-- ---------------------------------------------------------------------------
create or replace function private.business_ledger()
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  -- initial sale: the payments of the agreed services
  select 'CP:' || p.id::text, 'CUSTOMER_PAYMENT', p.id, p.customer_id, c.department_id, 'SALES'::text, 'INITIAL_SALE'::text, p.amount,
         case p.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' when 'REVERSED' then 'REFUNDED' else 'REJECTED' end,
         p.paid_at,
         coalesce(pr.requested_by, case when p.source = 'SALES' then p.recorded_by end, fr.requested_by),
         null::text, p.reference, p.method, 'SALE:' || p.customer_id::text
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.payment_requests pr on pr.id = p.request_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = p.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- add-on purchases: always Support, whichever department onboarded the customer
  select 'AP:' || a.id::text, 'ADDON_PAYMENT', a.id, a.customer_id, c.department_id, 'SUPPORT', 'ADDON', a.amount,
         case a.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' else 'REJECTED' end,
         a.paid_at, coalesce(r.submitted_by, r.created_by, r.consultant_id),
         (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = r.id),
         a.reference, a.method, 'ADDON:' || r.id::text
    from public.addon_payments a
    join public.addon_requests r on r.id = a.request_id
    join public.customers c on c.id = a.customer_id
  union all
  -- payments recorded on the invoice itself
  select 'IP:' || ip.id::text, 'INVOICE_PAYMENT', ip.id, ip.customer_id, c.department_id,
         case when g.purpose = 'SERVICES' then 'SALES' when g.purpose = 'ADDON' or t.kind in ('ADDON', 'RENEWAL') then 'SUPPORT' end,
         case when g.purpose = 'SERVICES' then 'INITIAL_SALE' when g.purpose = 'ADDON' or t.kind = 'ADDON' then 'ADDON'
              when t.kind = 'RENEWAL' then 'RENEWAL' else 'UNCLASSIFIED' end,
         ip.amount, case ip.status when 'VERIFIED' then 'COLLECTED' else 'REFUNDED' end,
         (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz,
         case when g.purpose = 'SERVICES' then fr.requested_by when g.purpose = 'ADDITIONAL' then t.responsible_id end,
         (select s.name from public.crm_services s where s.code = t.service_code), ip.reference, ip.method, 'INV:' || ip.invoice_id::text
    from public.invoice_payments ip
    join public.generated_invoices g on g.invoice_id = ip.invoice_id
    join public.customers c on c.id = ip.customer_id
    left join public.invoice_business_tags t on t.invoice_id = ip.invoice_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = ip.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- a monthly plan Accounts activated as paid
  select 'PL:' || cp.id::text, 'PLAN_ACTIVATION', cp.id, cp.customer_id, c.department_id, 'SUPPORT', 'SUBSCRIPTION', cp.price_at_start,
         'COLLECTED', cp.started_at::timestamp at time zone 'Asia/Kolkata', null::uuid,
         (select p.name from public.monthly_plans p where p.id = cp.plan_id), null::text, null::text, 'PLAN:' || cp.id::text
    from public.customer_plans cp
    join public.customers c on c.id = cp.customer_id
   where cp.payment_status = 'PAID' and cp.price_at_start > 0
$$;
revoke all on function private.business_ledger() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The orders: what was agreed / invoiced (for billed and outstanding)
-- ---------------------------------------------------------------------------
create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services Sales agreed with the customer
  select 'SALE:' || c.id::text, 'SALES'::text, 'INITIAL_SALE'::text, c.id, c.department_id, fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id))
    from public.customers c
    left join lateral (select x.requested_by, x.resolved_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, 'SALES', 'INITIAL_SALE', g.customer_id, c.department_id, fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, 'SUPPORT', 'ADDON', r.customer_id, c.department_id, coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, 'SUPPORT', case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, c.department_id,
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Filters (shared by every report, so the summary, the employee tables and the list always agree)
-- ---------------------------------------------------------------------------
create or replace function private.business_day_start(p_day date)
returns timestamptz language sql immutable set search_path = '' as $$
  select case when p_day is null then null else p_day::timestamp at time zone 'Asia/Kolkata' end
$$;

create or replace function private.business_ledger_filtered(
  p_from date, p_to date, p_department uuid, p_division text, p_employee uuid, p_type text, p_status text)
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  select l.* from private.business_ledger() l
   where (p_from is null or l.occurred_at >= private.business_day_start(p_from))
     and (p_to is null or l.occurred_at < private.business_day_start(p_to + 1))
     and (p_department is null or l.department_id = p_department)
     and (p_division is null or l.division = p_division)
     and (p_employee is null or l.employee_id = p_employee)
     and (p_type is null or l.tx_type = p_type)
     and (p_status is null or l.status = p_status)
$$;
revoke all on function private.business_ledger_filtered(date, date, uuid, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Summary report
-- ---------------------------------------------------------------------------
create or replace function public.business_report(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v jsonb;
begin
  perform private.require_business_reports();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED') then
    raise exception 'VALIDATION_ERROR: Unknown transaction type.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('COLLECTED', 'PENDING', 'REFUNDED') then
    raise exception 'VALIDATION_ERROR: Unknown payment status.' using errcode = 'P0001';
  end if;

  with l as materialized (
    select * from private.business_ledger_filtered(p_from, p_to, p_department, v_div, p_employee, v_type, v_status)
     where status <> 'REJECTED'),
  o as materialized (
    select o.*, coalesce(s.collected, 0) as collected, coalesce(s.pending, 0) as pending
      from private.business_orders() o
      left join (select order_key, sum(amount) filter (where status = 'COLLECTED') collected, sum(amount) filter (where status = 'PENDING') pending
                   from private.business_ledger() group by order_key) s on s.order_key = o.order_key
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)
       and (v_div is null or o.division = v_div)
       and (p_employee is null or o.employee_id = p_employee)
       and (v_type is null or o.order_type = v_type)),
  by_type as (
    select division, tx_type,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected, coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded, count(*) filter (where status = 'COLLECTED') n,
           count(distinct customer_id) filter (where status = 'COLLECTED') customers
      from l group by division, tx_type),
  by_emp as (
    select division, employee_id,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected, coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded, count(*) filter (where status = 'COLLECTED') n,
           count(distinct customer_id) filter (where status = 'COLLECTED') customers
      from l where division is not null group by division, employee_id),
  by_dept as (
    select department_id,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'COLLECTED'), 0) sales_collected,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'PENDING'), 0) sales_pending,
           coalesce(sum(amount) filter (where division = 'SALES' and status = 'REFUNDED'), 0) sales_refunded,
           count(*) filter (where division = 'SALES' and status = 'COLLECTED') sales_n,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'COLLECTED'), 0) support_collected,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'PENDING'), 0) support_pending,
           coalesce(sum(amount) filter (where division = 'SUPPORT' and status = 'REFUNDED'), 0) support_refunded,
           count(*) filter (where division = 'SUPPORT' and status = 'COLLECTED') support_n
      from l where division is not null group by department_id),
  ord_type as (
    select division, order_type, count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by division, order_type),
  ord_emp as (
    select division, employee_id, count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by division, employee_id)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'filters', jsonb_build_object('departmentId', p_department, 'division', v_div, 'employeeId', p_employee, 'type', v_type, 'status', v_status),
    'sections', coalesce((
      select jsonb_object_agg(lower(d.division), jsonb_build_object(
        'collected', coalesce((select sum(collected) from by_type t where t.division = d.division), 0),
        'pending', coalesce((select sum(pending) from by_type t where t.division = d.division), 0),
        'refunded', coalesce((select sum(refunded) from by_type t where t.division = d.division), 0),
        'transactions', coalesce((select sum(n) from by_type t where t.division = d.division), 0),
        'customers', (select count(distinct customer_id) from l where l.division = d.division and l.status = 'COLLECTED'),
        'billed', coalesce((select sum(billed) from ord_type t where t.division = d.division), 0),
        'outstanding', coalesce((select sum(outstanding) from ord_type t where t.division = d.division), 0),
        'orders', coalesce((select sum(orders) from ord_type t where t.division = d.division), 0),
        'byType', coalesce((select jsonb_agg(jsonb_build_object('type', t.tx_type, 'collected', t.collected, 'pending', t.pending,
                    'refunded', t.refunded, 'transactions', t.n, 'customers', t.customers,
                    'billed', coalesce(ot.billed, 0), 'outstanding', coalesce(ot.outstanding, 0)) order by t.tx_type)
                    from by_type t left join ord_type ot on ot.division = t.division and ot.order_type = t.tx_type
                   where t.division = d.division), '[]'::jsonb),
        'employees', coalesce((select jsonb_agg(jsonb_build_object('employeeId', e.employee_id, 'name', coalesce(p.full_name, 'Not recorded'),
                    'collected', e.collected, 'pending', e.pending, 'refunded', e.refunded, 'transactions', e.n, 'customers', e.customers,
                    'billed', coalesce(oe.billed, 0), 'outstanding', coalesce(oe.outstanding, 0))
                    order by e.collected desc, p.full_name nulls last)
                    from by_emp e
                    left join public.profiles p on p.id = e.employee_id
                    left join ord_emp oe on oe.division = e.division and oe.employee_id is not distinct from e.employee_id
                   where e.division = d.division), '[]'::jsonb)))
      from (values ('SALES'), ('SUPPORT')) d(division) where v_div is null or d.division = v_div), '{}'::jsonb),
    -- income by the customer's business unit (the same departments as Accounts' Department Income), split Sales / Support
    'departments', coalesce((select jsonb_agg(jsonb_build_object('departmentId', x.department_id, 'name', coalesce(d.name, 'Unknown'),
          'sales', jsonb_build_object('collected', x.sales_collected, 'pending', x.sales_pending, 'refunded', x.sales_refunded, 'transactions', x.sales_n),
          'support', jsonb_build_object('collected', x.support_collected, 'pending', x.support_pending, 'refunded', x.support_refunded, 'transactions', x.support_n),
          'collected', x.sales_collected + x.support_collected)
          order by x.sales_collected + x.support_collected desc, d.name)
        from by_dept x left join public.departments d on d.id = x.department_id), '[]'::jsonb),
    'unclassified', jsonb_build_object(
      'collected', coalesce((select sum(amount) from l where tx_type = 'UNCLASSIFIED' and status = 'COLLECTED'), 0),
      'pending', coalesce((select sum(amount) from l where tx_type = 'UNCLASSIFIED' and status = 'PENDING'), 0),
      'transactions', (select count(*) from l where tx_type = 'UNCLASSIFIED')),
    'organization', jsonb_build_object(
      'collected', coalesce((select sum(amount) from l where division is not null and status = 'COLLECTED'), 0),
      'pending', coalesce((select sum(amount) from l where division is not null and status = 'PENDING'), 0),
      'refunded', coalesce((select sum(amount) from l where division is not null and status = 'REFUNDED'), 0),
      'billed', coalesce((select sum(billed) from o), 0),
      'outstanding', coalesce((select sum(greatest(billed - collected, 0)) from o), 0)),
    'review', jsonb_build_object(
      'withoutEmployee', (select count(*) from l where division is not null and employee_id is null),
      'withoutEmployeeAmount', coalesce((select sum(amount) from l where division is not null and employee_id is null and status = 'COLLECTED'), 0),
      'unclassifiedInvoices', (select count(*) from l where tx_type = 'UNCLASSIFIED'))
  ) into v;
  return v;
end $$;
revoke all on function public.business_report(date, date, uuid, text, uuid, text, text) from public, anon;
grant execute on function public.business_report(date, date, uuid, text, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Transaction history
-- ---------------------------------------------------------------------------
create or replace function public.business_report_transactions(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_status text default null, p_search text default null,
  p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v_search text := nullif(left(lower(btrim(coalesce(p_search, ''))), 100), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v jsonb;
begin
  perform private.require_business_reports();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_div is not null and v_div not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL', 'SUBSCRIPTION', 'UNCLASSIFIED') then
    raise exception 'VALIDATION_ERROR: Unknown transaction type.' using errcode = 'P0001';
  end if;
  if v_status is not null and v_status not in ('COLLECTED', 'PENDING', 'REFUNDED') then
    raise exception 'VALIDATION_ERROR: Unknown payment status.' using errcode = 'P0001';
  end if;

  with l as (
    select x.*, c.name as customer_name, c.company as customer_company, c.customer_code, d.name as department_name, p.full_name as employee_name
      from private.business_ledger_filtered(p_from, p_to, p_department, v_div, p_employee, v_type, v_status) x
      join public.customers c on c.id = x.customer_id
      left join public.departments d on d.id = x.department_id
      left join public.profiles p on p.id = x.employee_id
     where x.status <> 'REJECTED'
       and (v_search is null or lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.customer_code, '') || ' ' ||
            coalesce(p.full_name, '') || ' ' || coalesce(x.reference, '') || ' ' || coalesce(x.service, '')) like '%' || v_search || '%')),
  page as (select * from l order by occurred_at desc, tx_key limit v_size offset (v_page - 1) * v_size)
  select jsonb_build_object(
    'total', (select count(*) from l),
    'page', v_page, 'pageSize', v_size,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'key', pg.tx_key, 'source', pg.source, 'type', pg.tx_type, 'division', pg.division, 'amount', pg.amount, 'status', pg.status,
        'occurredAt', pg.occurred_at, 'customerId', pg.customer_id, 'customerName', pg.customer_name, 'company', pg.customer_company,
        'customerCode', pg.customer_code, 'departmentId', pg.department_id, 'department', pg.department_name, 'service', pg.service,
        'employeeId', pg.employee_id, 'employeeName', pg.employee_name, 'reference', pg.reference, 'method', pg.method)
        order by pg.occurred_at desc, pg.tx_key) from page pg), '[]'::jsonb)) into v;
  return v;
end $$;
revoke all on function public.business_report_transactions(date, date, uuid, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.business_report_transactions(date, date, uuid, text, uuid, text, text, text, integer, integer) to authenticated;

-- Who can be filtered on: the people who appear in the ledger, with their department and team division.
create or replace function public.business_report_people()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_business_reports();
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'division', t.division, 'department', d.name) order by p.full_name), '[]'::jsonb)
    into v
    from public.profiles p
    left join public.teams t on t.id = p.team_id
    left join public.departments d on d.id = p.department_id
   where p.id in (select employee_id from private.business_ledger() where employee_id is not null);
  return v;
end $$;
revoke all on function public.business_report_people() from public, anon;
grant execute on function public.business_report_people() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Accounts: say what an additional invoice is
-- ---------------------------------------------------------------------------
create or replace function public.accounts_tag_invoice_business(
  p_invoice uuid, p_kind text, p_service text default null, p_invoice_request uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  v_kind text := upper(nullif(btrim(coalesce(p_kind, '')), ''));
  t public.invoice_business_tags;
  ir public.invoice_requests;
begin
  perform private.require_accounts_staff();
  if v_kind is null or v_kind not in ('RENEWAL', 'ADDON', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose Renewal, Add-on or Other.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if g.purpose <> 'ADDITIONAL' then
    raise exception 'CONFLICT: Only an additional invoice is classified here. A services invoice is the initial sale and an add-on invoice is already an add-on.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.crm_services where code = p_service) then
    raise exception 'VALIDATION_ERROR: Service not found.' using errcode = 'P0001';
  end if;
  if p_invoice_request is not null then
    select * into ir from public.invoice_requests where id = p_invoice_request for update;
    if ir.id is null or ir.customer_id <> g.customer_id then
      raise exception 'VALIDATION_ERROR: That invoice request is not for this customer.' using errcode = 'P0001';
    end if;
  end if;
  -- once money has been recorded the classification (and so the department it is credited to) is fixed; only the Super Admin may correct it
  select * into t from public.invoice_business_tags where invoice_id = p_invoice;
  if t.invoice_id is not null and not private.is_super_admin()
     and exists (select 1 from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED') then
    raise exception 'CONFLICT: Payments are already recorded on this invoice, so its classification can no longer be changed.' using errcode = 'P0001';
  end if;
  insert into public.invoice_business_tags as x (invoice_id, kind, service_code, invoice_request_id, responsible_id, note, tagged_by, tagged_at)
  values (p_invoice, v_kind, p_service, p_invoice_request, ir.requested_by, nullif(left(btrim(coalesce(p_note, '')), 500), ''), (select private.my_id()), now())
  on conflict (invoice_id) do update
     set kind = excluded.kind, service_code = excluded.service_code, invoice_request_id = excluded.invoice_request_id,
         responsible_id = excluded.responsible_id, note = excluded.note, tagged_by = excluded.tagged_by, tagged_at = excluded.tagged_at;
  if ir.id is not null and ir.status = 'REQUESTED' then
    update public.invoice_requests set status = 'RAISED' where id = ir.id;
  end if;
  perform private.write_audit('INVOICE_BUSINESS_TAGGED', 'invoice', p_invoice, null, null,
    jsonb_build_object('kind', v_kind, 'service', p_service, 'invoice_request', p_invoice_request));
  return jsonb_build_object('invoiceId', p_invoice, 'kind', v_kind, 'serviceCode', p_service, 'invoiceRequestId', p_invoice_request,
                            'responsibleId', ir.requested_by);
end $$;
revoke all on function public.accounts_tag_invoice_business(uuid, text, text, uuid, text) from public, anon;
grant execute on function public.accounts_tag_invoice_business(uuid, text, text, uuid, text) to authenticated;

-- What an invoice is tagged as, and the open Support invoice requests it could be linked to.
create or replace function public.accounts_invoice_business(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.generated_invoices;
begin
  perform private.require_accounts_staff();
  select * into g from public.generated_invoices where invoice_id = p_invoice;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'purpose', g.purpose,
    'tag', (select jsonb_build_object('kind', t.kind, 'serviceCode', t.service_code, 'invoiceRequestId', t.invoice_request_id,
                   'responsibleId', t.responsible_id, 'responsible', (select p.full_name from public.profiles p where p.id = t.responsible_id), 'note', t.note)
              from public.invoice_business_tags t where t.invoice_id = p_invoice),
    'locked', exists (select 1 from public.invoice_business_tags where invoice_id = p_invoice)
              and exists (select 1 from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED') and not private.is_super_admin(),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'requestedBy', r.requested_by,
                   'requestedByName', (select p.full_name from public.profiles p where p.id = r.requested_by),
                   'fromMonth', r.from_month, 'toMonth', r.to_month, 'note', r.note, 'createdAt', r.created_at) order by r.created_at desc)
              from public.invoice_requests r where r.customer_id = g.customer_id and r.status = 'REQUESTED'), '[]'::jsonb));
end $$;
revoke all on function public.accounts_invoice_business(uuid) from public, anon;
grant execute on function public.accounts_invoice_business(uuid) to authenticated;
