-- Department Income -> one department: the Sales team's and the Support team's orders with their invoices.
--
-- Safe to run again in the SQL editor. Run it after 20261104000100_business_attribution_reports.sql.
--
-- business_report() / business_report_transactions() (migration 20261104) already give every figure and every payment for one
-- department (their department filter) split into Sales and Support. This adds the one thing they do not show: the ORDERS behind
-- those figures with their invoices, so Accounts can see, per customer order, what was billed, what is collected, pending and
-- outstanding, and whether the invoice is paid. It reads the same private.business_orders() / private.business_ledger(), so it can
-- never disagree with the totals, and it adds no table and no money record.
--
-- An order is: the services Sales agreed with a customer (invoiced as one or more SERVICES invoices), an approved add-on request
-- (its add-on invoice), or an additional invoice Accounts classified as a renewal / add-on. Access: the Accounts department and
-- the Super Admin (same check as the other business reports).

-- A sale that is still waiting for Accounts has no "resolved" date yet: it is dated from when it was submitted (never left undated,
-- which would also hide it from every date range).
create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services Sales agreed with the customer
  select 'SALE:' || c.id::text, 'SALES'::text, 'INITIAL_SALE'::text, c.id, c.department_id, fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, fr.requested_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id), c.created_at)
    from public.customers c
    left join lateral (select x.requested_by, x.resolved_at, x.requested_at from public.payment_requests x
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

create or replace function public.business_report_orders(
  p_from date default null, p_to date default null, p_department uuid default null, p_division text default null,
  p_employee uuid default null, p_type text default null, p_search text default null,
  p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_div text := upper(nullif(btrim(coalesce(p_division, '')), ''));
  v_type text := upper(nullif(btrim(coalesce(p_type, '')), ''));
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
  if v_type is not null and v_type not in ('INITIAL_SALE', 'ADDON', 'RENEWAL') then
    raise exception 'VALIDATION_ERROR: Unknown order type.' using errcode = 'P0001';
  end if;

  with pay as (
    select order_key,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected,
           coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending,
           coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded
      from private.business_ledger() group by order_key),
  o as (
    select o.*, coalesce(p.collected, 0) collected, coalesce(p.pending, 0) pending, coalesce(p.refunded, 0) refunded,
           greatest(o.billed - coalesce(p.collected, 0), 0) outstanding,
           c.name customer_name, c.company customer_company, c.customer_code, d.name department_name, e.full_name employee_name,
           coalesce((select jsonb_agg(jsonb_build_object('invoiceId', m.id, 'number', m.invoice_number,
                       'date', coalesce((select g.invoice_date::text from public.generated_invoices g where g.invoice_id = m.id), nullif(m.issue_date, '')),
                       'total', m.amount, 'kind', m.kind, 'paid', m.status = 'Paid') order by m.created_at, m.invoice_number)
                       from public.member_invoices m
                      where m.kind in ('SERVICE', 'UPLOADED', 'GENERATED')
                        and ((o.order_key like 'SALE:%' and m.customer_id = o.customer_id and m.addon_request_id is null
                              and not exists (select 1 from public.generated_invoices g where g.invoice_id = m.id and g.purpose <> 'SERVICES'))
                          or (o.order_key like 'ADDON:%' and m.addon_request_id::text = substr(o.order_key, 7))
                          or (o.order_key like 'INV:%' and m.id::text = substr(o.order_key, 5)))), '[]'::jsonb) invoices
      from private.business_orders() o
      left join pay p on p.order_key = o.order_key
      join public.customers c on c.id = o.customer_id
      left join public.departments d on d.id = o.department_id
      left join public.profiles e on e.id = o.employee_id
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)
       and (v_div is null or o.division = v_div)
       and (p_employee is null or o.employee_id = p_employee)
       and (v_type is null or o.order_type = v_type)
       and (v_search is null or lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.customer_code, '') || ' ' || coalesce(e.full_name, '')) like '%' || v_search || '%')),
  page as (select * from o order by billed_at desc, order_key limit v_size offset (v_page - 1) * v_size)
  select jsonb_build_object(
    'total', (select count(*) from o), 'page', v_page, 'pageSize', v_size,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'key', x.order_key, 'type', x.order_type, 'division', x.division, 'billedAt', x.billed_at, 'billed', x.billed,
        'collected', x.collected, 'pending', x.pending, 'refunded', x.refunded, 'outstanding', x.outstanding,
        'state', case when x.billed > 0 and x.collected >= x.billed then 'PAID' when x.collected > 0 then 'PARTLY_PAID' else 'UNPAID' end,
        'customerId', x.customer_id, 'customerName', x.customer_name, 'company', x.customer_company, 'customerCode', x.customer_code,
        'departmentId', x.department_id, 'department', x.department_name, 'employeeId', x.employee_id, 'employeeName', x.employee_name,
        'invoices', x.invoices) order by x.billed_at desc, x.order_key) from page x), '[]'::jsonb)) into v;
  return v;
end $$;
revoke all on function public.business_report_orders(date, date, uuid, text, uuid, text, text, integer, integer) from public, anon;
grant execute on function public.business_report_orders(date, date, uuid, text, uuid, text, text, integer, integer) to authenticated;
