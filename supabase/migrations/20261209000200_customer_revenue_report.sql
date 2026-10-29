-- =============================================================================
-- Accounts -> Customer-wise Revenue.
--
-- One row per customer, built from the SAME records the Business Reports already use (so the figures agree with them):
--   private.business_orders()  every order (the agreed services, an invoice-only services order, an approved add-on, a tagged renewal / add-on
--                              invoice) with the amount billed on it, its department attribution and its date;
--   private.business_ledger()  every payment, already attached to ITS order (order_key) and classed COLLECTED / PENDING / REFUNDED;
--   monthly plans Accounts activated as paid (a plan is an order that is billed and collected in one step).
-- The measures are kept apart and never relabelled:
--   purchased    what was ordered (billed on the customer's orders; GST included when the order carries GST)
--   invoiced     what the customer's NON-CANCELLED invoices add up to
--   collected    VERIFIED money received (never an invoice, never a pending payment)
--   pending      recorded but not yet verified
--   refunded     reversed
--   outstanding  per order: billed - collected (never below zero), summed - the way the Business Reports do it
-- Each payment sits on exactly one order, and each order on exactly one customer, so nothing is counted twice however many services or
-- invoices a customer has. Money in the ledger that sits on no known order is NOT added to any order: it is shown on its own as
-- "receipts without an order" so a gap in the data is visible instead of hidden.
--
-- The date range selects ORDERS by their order date; the payment figures are those of the selected orders. Department = the department the order
-- is attributed to (not the customer's current department). Service = the customer has that service.
-- Read-only, Accounts (and Super Admin) only. Safe to run again; nothing is changed.
-- =============================================================================

create or replace function public.accounts_customer_revenue(
  p_from date default null, p_to date default null, p_service text default null, p_department uuid default null,
  p_search text default null, p_sort text default 'PURCHASED', p_dir text default 'DESC', p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(left(lower(btrim(coalesce(p_search, ''))), 100), '');
  v_sort text := upper(coalesce(nullif(btrim(p_sort), ''), 'PURCHASED'));
  v_dir text := upper(coalesce(nullif(btrim(p_dir), ''), 'DESC'));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v jsonb;
begin
  perform private.require_accounts_staff();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_sort not in ('PURCHASED', 'INVOICED', 'COLLECTED', 'PENDING', 'OUTSTANDING', 'ORDERS', 'NAME') then
    raise exception 'VALIDATION_ERROR: Unknown sort.' using errcode = 'P0001';
  end if;
  if v_dir not in ('ASC', 'DESC') then
    raise exception 'VALIDATION_ERROR: Unknown sort direction.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.crm_services s where s.code = p_service) then
    raise exception 'VALIDATION_ERROR: Unknown service.' using errcode = 'P0001';
  end if;
  if p_department is not null and not exists (select 1 from public.departments d where d.id = p_department) then
    raise exception 'VALIDATION_ERROR: Unknown department.' using errcode = 'P0001';
  end if;

  with ords_all as (
    select o.order_key, o.customer_id, o.order_type, o.department_id, o.billed, o.billed_at from private.business_orders() o
    union all
    select 'PLAN:' || cp.id::text, cp.customer_id, 'SUBSCRIPTION', private.revenue_department(c.department_id, 'SUPPORT'), cp.price_at_start,
           cp.started_at::timestamp at time zone 'Asia/Kolkata'
      from public.customer_plans cp join public.customers c on c.id = cp.customer_id
     where cp.payment_status = 'PAID' and cp.price_at_start > 0),
  ords as (   -- a cancelled invoice no longer counts toward its order
    select a.* from ords_all a
     where not exists (select 1 from public.generated_invoices g where a.order_key = 'INV:' || g.invoice_id::text and g.cancelled_at is not null)),
  sel as (
    select o.* from ords o
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)),
  pay as (
    select l.order_key,
           coalesce(sum(l.amount) filter (where l.status = 'COLLECTED'), 0) collected,
           coalesce(sum(l.amount) filter (where l.status = 'PENDING'), 0) pending,
           coalesce(sum(l.amount) filter (where l.status = 'REFUNDED'), 0) refunded
      from private.business_ledger() l group by l.order_key),
  per_order as (
    select s.*, coalesce(p.collected, 0) collected, coalesce(p.pending, 0) pending, coalesce(p.refunded, 0) refunded,
           greatest(s.billed - coalesce(p.collected, 0), 0) outstanding,
           -- the non-cancelled invoices of THIS order
           coalesce(inv.n, 0) invoice_n, coalesce(inv.total, 0) invoice_total, coalesce(inv.gst, 0) invoice_gst
      from sel s
      left join pay p on p.order_key = s.order_key
      left join lateral (
        select count(*) n, coalesce(sum(m.amount), 0) total, coalesce(sum(g.total_gst), 0) gst
          from public.member_invoices m
          left join public.generated_invoices g on g.invoice_id = m.id
         where m.kind in ('SERVICE', 'UPLOADED', 'GENERATED') and m.status <> 'Cancelled' and g.cancelled_at is null
           and ((s.order_key like 'SALE:%' and m.customer_id = s.customer_id and m.addon_request_id is null and coalesce(g.purpose, 'SERVICES') = 'SERVICES')
             or (s.order_key like 'ADDON:%' and m.addon_request_id::text = substr(s.order_key, 7))
             or (s.order_key like 'INV:%' and m.id::text = substr(s.order_key, 5)))) inv on true),
  stray as (   -- money in the ledger that sits on no known order
    select l.customer_id, sum(l.amount) filter (where l.status = 'COLLECTED') amount
      from private.business_ledger() l
     where l.status = 'COLLECTED' and not exists (select 1 from ords_all a where a.order_key = l.order_key)
     group by l.customer_id),
  by_cust as (
    select po.customer_id,
           count(*) orders, sum(po.billed) purchased, sum(po.invoice_total) invoiced, sum(po.invoice_n) invoice_n, sum(po.invoice_gst) invoice_gst,
           sum(po.collected) collected, sum(po.pending) pending, sum(po.refunded) refunded, sum(po.outstanding) outstanding,
           max(po.billed_at) last_order_at
      from per_order po group by po.customer_id),
  base_ as (   -- customers with orders in the selection; with no date / department filter also those that only have receipts without an order
    select b.customer_id, b.orders, b.purchased, b.invoiced, b.invoice_n, b.invoice_gst, b.collected, b.pending, b.refunded, b.outstanding, b.last_order_at from by_cust b
    union all
    select st.customer_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, null::timestamptz from stray st
     where p_from is null and p_to is null and p_department is null and not exists (select 1 from by_cust b where b.customer_id = st.customer_id)),
  rows_ as (
    select b.*, c.name, c.company, c.customer_code, coalesce(st.amount, 0) stray_amount,
           coalesce((select jsonb_agg(sv.name order by sv.sort_order) from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code
                      where cs.customer_id = c.id), '[]'::jsonb) services
      from base_ b
      join public.customers c on c.id = b.customer_id
      left join stray st on st.customer_id = b.customer_id
     where (p_service is null or exists (select 1 from public.customer_services cs where cs.customer_id = c.id and cs.service_code = p_service))
       and (v_search is null or lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.customer_code, '')) like '%' || v_search || '%')),
  ordered as (
    select r.*, row_number() over (order by
        case when v_dir = 'ASC' then case v_sort when 'PURCHASED' then r.purchased when 'INVOICED' then r.invoiced when 'COLLECTED' then r.collected
                  when 'PENDING' then r.pending when 'OUTSTANDING' then r.outstanding when 'ORDERS' then r.orders::numeric end end asc,
        case when v_dir = 'DESC' then case v_sort when 'PURCHASED' then r.purchased when 'INVOICED' then r.invoiced when 'COLLECTED' then r.collected
                  when 'PENDING' then r.pending when 'OUTSTANDING' then r.outstanding when 'ORDERS' then r.orders::numeric end end desc,
        case when v_sort = 'NAME' and v_dir = 'ASC' then lower(coalesce(r.company, r.name)) end asc,
        case when v_sort = 'NAME' and v_dir = 'DESC' then lower(coalesce(r.company, r.name)) end desc,
        r.customer_id) rn
      from rows_ r),
  top5 as (select * from rows_ order by purchased desc, customer_id limit 5)
  select jsonb_build_object(
    'total', (select count(*) from rows_), 'page', v_page, 'pageSize', v_size,
    'totals', (select jsonb_build_object('customers', count(*), 'orders', coalesce(sum(orders), 0), 'purchased', coalesce(sum(purchased), 0), 'invoiced', coalesce(sum(invoiced), 0),
                  'collected', coalesce(sum(collected), 0), 'pending', coalesce(sum(pending), 0), 'refunded', coalesce(sum(refunded), 0),
                  'outstanding', coalesce(sum(outstanding), 0), 'receiptsWithoutOrder', coalesce(sum(stray_amount), 0)) from rows_),
    'top', coalesce((select jsonb_agg(jsonb_build_object('customerId', t.customer_id, 'name', coalesce(t.company, t.name), 'purchased', t.purchased, 'collected', t.collected) order by t.purchased desc, t.customer_id) from top5 t), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'customerId', o.customer_id, 'code', o.customer_code, 'name', o.name, 'company', o.company, 'services', o.services,
        'orders', o.orders, 'purchased', o.purchased, 'invoiced', o.invoiced, 'invoiceCount', o.invoice_n, 'gstInvoiced', o.invoice_gst,
        'collected', o.collected, 'pending', o.pending, 'refunded', o.refunded, 'outstanding', o.outstanding,
        'receiptsWithoutOrder', o.stray_amount, 'lastOrderAt', o.last_order_at) order by o.rn)
        from ordered o where o.rn > (v_page - 1) * v_size and o.rn <= v_page * v_size), '[]'::jsonb)) into v;
  return v;
end $$;
revoke all on function public.accounts_customer_revenue(date, date, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.accounts_customer_revenue(date, date, text, uuid, text, text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
