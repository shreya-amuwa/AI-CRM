-- =============================================================================
-- Department-wise income attribution: who acquired the customer, which division (Sales / Support) earns each order, and which
-- department it belongs to - recorded ONCE per order and never rewritten by a later change of owner, team or department.
--
-- Safe to run again. Run it after 20261113000200_manual_invoice_pricing.sql. No money record is changed or duplicated: payments,
-- invoices and orders stay exactly as they are; this adds who-earns-what next to them.
--
-- WHAT WAS WRONG (found by the audit)
--   1. A customer's department mirrors the CURRENT owner (tg_customers_before_write), and every income figure grouped payments by
--      that current department, so reassigning a customer moved all of its past income to another department.
--   2. The first sale was always Sales' (customer_payments are hard-coded to Sales). A customer Support acquired (for example a
--      referral) was credited to Sales. Nothing recorded who acquired a customer.
--   3. Add-ons and monthly plans were always Support's, including those the CLIENT bought from the Client Dashboard. That rule was
--      implicit and unchangeable. It is now an explicit setting, remembered per order.
--   4. Three different calculations of "department income": Accounts' Department Income and the Super Admin dashboard (verified
--      payments by the customer's current department) and the Sales / Support business reports (by division). They are now one.
--
-- THE MODEL
--   customers.acquisition_division / acquisition_department_id / acquired_by
--                       who acquired the customer, written when the customer is created (from the owner's team) and never
--                       changed by a change of owner. NULL = not recorded (customers from before this migration). Corrected only
--                       through set_customer_acquisition() (Accounts / Super Admin, with a reason, audited).
--   revenue_attributions  one row per ORDER (the same order keys the business ledger already uses: SALE:<customer>, ADDON:<request>,
--                       INV:<invoice>, PLAN:<plan>): the division that earns it, the department it belongs to, WHY (source), the
--                       referral source, and a review flag. Written the first time money or an invoice appears for the order.
--   Sources:  ACQUISITION     first sale, division = who acquired the customer
--             DEFAULT_SALES   first sale of a customer whose acquisition was not recorded: Sales (the rule before this migration)
--             SUPPORT_ADDON   add-on sold to an existing customer through Support: Support
--             CLIENT_DASHBOARD an add-on or plan the CLIENT bought in the Client Dashboard: the division chosen by the setting
--                             revenue_attribution_settings.client_purchase_attribution (SUPPORT by default, which is what the system
--                             did silently before; SALES or ACQUISITION are the alternatives). A later change of the setting
--                             affects NEW orders only.
--             SUPPORT_INVOICE an additional invoice Accounts tagged as renewal / add-on: Support
--             LEGACY          an order that existed before this migration, frozen exactly as the old reports counted it
--             MANUAL          corrected by Accounts / Super Admin with a reason (audited)
--   needs_review        LEGACY first sales of customers that a Support member owns or created today: they were counted as Sales
--                       and might belong to Support. They are listed for reconciliation (attribution_reconciliation()), never
--                       moved automatically.
--   Delivery is separate: the department that DELIVERS a service stays crm_services.delivery_department_id /
--   customer_services.delivery_department_id. The responsible employee stays derived from the order's own records.
--
-- Cash basis (unchanged): collected = VERIFIED payments only (gross receipts, GST included). A generated invoice is never money
-- received. Pending payments, reversals (refunds) and the outstanding balance are shown separately; the taxable value and the GST
-- of an order are shown wherever its tax split is known (see order_taxable_ratio()).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who acquired the customer
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists acquisition_division text check (acquisition_division in ('SALES', 'SUPPORT')),
  add column if not exists acquisition_department_id uuid references public.departments (id) on delete set null,
  add column if not exists acquired_by uuid references public.profiles (id) on delete set null;

create or replace function private.tg_customers_acquisition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_div text;
begin
  if tg_op = 'INSERT' then
    -- the owner's team at the moment the customer is created (the team division of the person who works the lead)
    select t.division::text into v_div from public.teams t where t.id = new.team_id;
    new.acquisition_division := case when v_div in ('SALES', 'SUPPORT') then v_div end;
    new.acquisition_department_id := new.department_id;
    new.acquired_by := coalesce(new.created_by, new.owner_id);
  elsif coalesce(current_setting('app.attribution_edit', true), '') <> '1' then
    -- a change of owner, team or department never changes who acquired the customer
    new.acquisition_division := old.acquisition_division;
    -- (the two references may only become empty because the person / department they point to was deleted)
    new.acquisition_department_id := case when new.acquisition_department_id is null and not exists (select 1 from public.departments where id = old.acquisition_department_id)
                                          then null else old.acquisition_department_id end;
    new.acquired_by := case when new.acquired_by is null and not exists (select 1 from public.profiles where id = old.acquired_by)
                            then null else old.acquired_by end;
  end if;
  return new;
end $$;
revoke all on function private.tg_customers_acquisition() from public, anon, authenticated;
-- named so that it fires after customers_before_write (which sets the owner's team and department)
drop trigger if exists customers_before_write_acquisition on public.customers;
create trigger customers_before_write_acquisition before insert or update on public.customers
  for each row execute function private.tg_customers_acquisition();

-- ---------------------------------------------------------------------------
-- 2. The rule for what the client buys in the Client Dashboard (a setting, not code)
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_attribution_settings (
  id boolean primary key default true check (id),
  client_purchase_attribution text not null default 'SUPPORT' check (client_purchase_attribution in ('SUPPORT', 'ACQUISITION', 'SALES')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.revenue_attribution_settings (id) values (true) on conflict (id) do nothing;
alter table public.revenue_attribution_settings enable row level security;
revoke all on public.revenue_attribution_settings from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The attribution of each order (reached only through the functions below)
-- ---------------------------------------------------------------------------
create table if not exists public.revenue_attributions (
  order_key text primary key check (length(order_key) <= 80),
  customer_id uuid not null references public.customers (id) on delete cascade,
  division text not null check (division in ('SALES', 'SUPPORT')),
  department_id uuid references public.departments (id) on delete set null,
  source text not null check (source in ('ACQUISITION', 'DEFAULT_SALES', 'SUPPORT_ADDON', 'CLIENT_DASHBOARD', 'SUPPORT_INVOICE', 'LEGACY', 'MANUAL')),
  acquisition_division text check (acquisition_division in ('SALES', 'SUPPORT')),   -- the customer's acquisition when this was recorded
  referral_source text check (length(referral_source) <= 60),                      -- the customer's lead source when this was recorded
  needs_review boolean not null default false,
  review_note text check (length(review_note) <= 500),
  reason text check (length(reason) <= 500),                                       -- why it was corrected (MANUAL)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);
create index if not exists revenue_attributions_customer_idx on public.revenue_attributions (customer_id);
create index if not exists revenue_attributions_review_idx on public.revenue_attributions (needs_review) where needs_review;
alter table public.revenue_attributions enable row level security;
revoke all on public.revenue_attributions from public, anon, authenticated;

-- The rule: which division earns this kind of order for this customer, and why.
create or replace function private.attribution_rule(p_customer uuid, p_kind text, out o_division text, out o_source text)
language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  s public.revenue_attribution_settings;
begin
  select * into c from public.customers where id = p_customer;
  select * into s from public.revenue_attribution_settings where id;
  if p_kind = 'SALE' then
    if c.acquisition_division is not null then o_division := c.acquisition_division; o_source := 'ACQUISITION';
    else o_division := 'SALES'; o_source := 'DEFAULT_SALES'; end if;
  elsif p_kind = 'SUPPORT_ADDON' then
    o_division := 'SUPPORT'; o_source := 'SUPPORT_ADDON';
  elsif p_kind = 'SUPPORT_INVOICE' then
    o_division := 'SUPPORT'; o_source := 'SUPPORT_INVOICE';
  else  -- CLIENT_PURCHASE
    o_division := case s.client_purchase_attribution when 'SALES' then 'SALES' when 'ACQUISITION' then coalesce(c.acquisition_division, 'SALES') else 'SUPPORT' end;
    o_source := 'CLIENT_DASHBOARD';
  end if;
end $$;
revoke all on function private.attribution_rule(uuid, text) from public, anon, authenticated;

-- Records the attribution of an order the first time it is needed. Never changes an existing one.
create or replace function private.ensure_attribution(p_key text, p_customer uuid, p_kind text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  c public.customers;
begin
  if p_customer is null or exists (select 1 from public.revenue_attributions where order_key = p_key) then
    return;
  end if;
  select * into c from public.customers where id = p_customer;
  if c.id is null then return; end if;
  select * into r from private.attribution_rule(p_customer, p_kind);
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source)
  values (p_key, p_customer, r.o_division, c.department_id, r.o_source, c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''))
  on conflict (order_key) do nothing;
end $$;
revoke all on function private.ensure_attribution(text, uuid, text) from public, anon, authenticated;

-- ---- the moments an order appears
create or replace function private.tg_attr_sale()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('SALE:' || new.customer_id::text, new.customer_id, 'SALE');
  return null;
end $$;
revoke all on function private.tg_attr_sale() from public, anon, authenticated;
drop trigger if exists customer_payments_attribution on public.customer_payments;
create trigger customer_payments_attribution after insert on public.customer_payments for each row execute function private.tg_attr_sale();
drop trigger if exists payment_requests_attribution on public.payment_requests;
create trigger payment_requests_attribution after insert on public.payment_requests for each row execute function private.tg_attr_sale();

create or replace function private.tg_attr_addon_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('ADDON:' || new.id::text, new.customer_id, 'SUPPORT_ADDON');
  return null;
end $$;
revoke all on function private.tg_attr_addon_request() from public, anon, authenticated;
drop trigger if exists addon_requests_attribution on public.addon_requests;
create trigger addon_requests_attribution after insert on public.addon_requests for each row execute function private.tg_attr_addon_request();

create or replace function private.tg_attr_addon_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('ADDON:' || new.request_id::text, new.customer_id, 'SUPPORT_ADDON');
  return null;
end $$;
revoke all on function private.tg_attr_addon_payment() from public, anon, authenticated;
drop trigger if exists addon_payments_attribution on public.addon_payments;
create trigger addon_payments_attribution after insert on public.addon_payments for each row execute function private.tg_attr_addon_payment();

-- The consultant putting a service the CLIENT requested into an add-on makes it a Client Dashboard purchase (decided once,
-- while nothing has been paid for it and nobody corrected it).
create or replace function private.tg_attr_client_addon()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  if new.addon_request_id is null or new.addon_request_id is not distinct from old.addon_request_id then
    return null;
  end if;
  select * into r from private.attribution_rule(new.customer_id, 'CLIENT_PURCHASE');
  update public.revenue_attributions
     set division = r.o_division, source = 'CLIENT_DASHBOARD', updated_at = now()
   where order_key = 'ADDON:' || new.addon_request_id::text and source = 'SUPPORT_ADDON'
     and not exists (select 1 from public.addon_payments p where p.request_id = new.addon_request_id)
     and not exists (select 1 from public.generated_invoices g where g.addon_request_id = new.addon_request_id and exists
                       (select 1 from public.invoice_payments ip where ip.invoice_id = g.invoice_id));
  return null;
end $$;
revoke all on function private.tg_attr_client_addon() from public, anon, authenticated;
drop trigger if exists service_requests_attribution on public.service_requests;
create trigger service_requests_attribution after update of addon_request_id on public.service_requests for each row execute function private.tg_attr_client_addon();

create or replace function private.tg_attr_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.ensure_attribution('PLAN:' || new.id::text, new.customer_id, 'CLIENT_PURCHASE');
  return null;
end $$;
revoke all on function private.tg_attr_plan() from public, anon, authenticated;
drop trigger if exists customer_plans_attribution on public.customer_plans;
create trigger customer_plans_attribution after insert on public.customer_plans for each row execute function private.tg_attr_plan();

create or replace function private.tg_attr_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- a services invoice whose payments are recorded on the invoice is an initial-sale order of its own
  if new.purpose = 'SERVICES' and new.payment_ledger = 'INVOICE' then
    perform private.ensure_attribution('INV:' || new.invoice_id::text, new.customer_id, 'SALE');
  end if;
  return null;
end $$;
revoke all on function private.tg_attr_invoice() from public, anon, authenticated;
drop trigger if exists generated_invoices_attribution on public.generated_invoices;
create trigger generated_invoices_attribution after insert on public.generated_invoices for each row execute function private.tg_attr_invoice();

create or replace function private.tg_attr_invoice_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
begin
  select * into g from public.generated_invoices where invoice_id = new.invoice_id;
  if g.invoice_id is null then return null; end if;
  if g.purpose = 'SERVICES' then
    perform private.ensure_attribution('INV:' || g.invoice_id::text, g.customer_id, 'SALE');
  elsif g.purpose = 'ADDON' then
    perform private.ensure_attribution('INV:' || g.invoice_id::text, g.customer_id, 'SUPPORT_ADDON');
  elsif exists (select 1 from public.invoice_business_tags t where t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')) then
    perform private.ensure_attribution('INV:' || g.invoice_id::text, g.customer_id, 'SUPPORT_INVOICE');
  end if;
  return null;
end $$;
revoke all on function private.tg_attr_invoice_payment() from public, anon, authenticated;
drop trigger if exists invoice_payments_attribution on public.invoice_payments;
create trigger invoice_payments_attribution after insert on public.invoice_payments for each row execute function private.tg_attr_invoice_payment();

create or replace function private.tg_attr_invoice_tag()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
begin
  if new.kind in ('RENEWAL', 'ADDON') then
    select customer_id into v_customer from public.generated_invoices where invoice_id = new.invoice_id;
    perform private.ensure_attribution('INV:' || new.invoice_id::text, v_customer, 'SUPPORT_INVOICE');
  end if;
  return null;
end $$;
revoke all on function private.tg_attr_invoice_tag() from public, anon, authenticated;
drop trigger if exists invoice_business_tags_attribution on public.invoice_business_tags;
create trigger invoice_business_tags_attribution after insert or update of kind on public.invoice_business_tags for each row execute function private.tg_attr_invoice_tag();

-- ---------------------------------------------------------------------------
-- 4. Orders that already exist: frozen EXACTLY as the old reports counted them (nothing is moved or guessed).
--    A first sale of a customer that a Support member owns or created today may have been Support's: flagged for review.
-- ---------------------------------------------------------------------------
insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source, needs_review, review_note)
select k.order_key, k.customer_id, k.division, k.department_id, 'LEGACY', c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''),
       k.division = 'SALES' and (k.order_key like 'SALE:%' or k.order_key like 'INV:%') and exists (
         select 1 from public.profiles p join public.teams t on t.id = p.team_id
          where p.id in (c.owner_id, c.created_by) and t.division = 'SUPPORT'),
       case when k.division = 'SALES' and (k.order_key like 'SALE:%' or k.order_key like 'INV:%') and exists (
              select 1 from public.profiles p join public.teams t on t.id = p.team_id where p.id in (c.owner_id, c.created_by) and t.division = 'SUPPORT')
            then 'Counted as Sales (the rule before attribution was recorded), but a Support team member owns or created this customer. Confirm whether Support acquired it.' end
  from (select distinct on (x.order_key) x.order_key, x.customer_id, x.division, x.department_id
          from (select o.order_key, o.customer_id, o.division, o.department_id from private.business_orders() o
                union all
                select l.order_key, l.customer_id, l.division, l.department_id from private.business_ledger() l where l.division is not null) x
         order by x.order_key) k
  join public.customers c on c.id = k.customer_id
on conflict (order_key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. One definition of department income, read from the recorded attribution
-- ---------------------------------------------------------------------------
-- Verified payments with the department they were attributed to (the order's recorded department, not the customer's CURRENT one).
-- The same rows and amounts as private.verified_income() (which stays exactly as it was); only department_id is added.
-- Plan activations are not payments and are not here (as before).
create or replace function private.verified_income_attributed()
returns table (id uuid, customer_id uuid, amount numeric, paid_at timestamptz, payment_type text, method text, reference text,
               verified_by uuid, recorded_at timestamptz, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, p.amount, p.paid_at, p.payment_type, p.method, p.reference, p.verified_by, p.recorded_at,
         coalesce(a.department_id, c.department_id)
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
   where p.status = 'VERIFIED'
  union all
  select ap.id, ap.customer_id, ap.amount, ap.paid_at, 'ADDON', ap.method, ap.reference, ap.verified_by, ap.recorded_at,
         coalesce(a.department_id, c.department_id)
    from public.addon_payments ap
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || ap.request_id::text
   where ap.status = 'VERIFIED'
  union all
  select ip.id, ip.customer_id, ip.amount, (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz, ip.payment_type, ip.method, ip.reference,
         ip.recorded_by, ip.recorded_at, coalesce(a.department_id, c.department_id)
    from public.invoice_payments ip
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
   where ip.status = 'VERIFIED'
$$;
revoke all on function private.verified_income_attributed() from public, anon, authenticated;

-- The ledger: one row per payment event, classified once. Same columns as before; division and department now come from the
-- order's recorded attribution (the old rule only where nothing was recorded).
create or replace function private.business_ledger()
returns table (tx_key text, source text, source_id uuid, customer_id uuid, department_id uuid, division text, tx_type text,
               amount numeric, status text, occurred_at timestamptz, employee_id uuid, service text, reference text, method text,
               order_key text)
language sql stable security definer set search_path = '' as $$
  -- initial sale: the payments of the agreed services
  select 'CP:' || p.id::text, 'CUSTOMER_PAYMENT', p.id, p.customer_id, coalesce(a.department_id, c.department_id), coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, p.amount,
         case p.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' when 'REVERSED' then 'REFUNDED' else 'REJECTED' end,
         p.paid_at,
         coalesce(pr.requested_by, case when p.source = 'SALES' then p.recorded_by end, fr.requested_by),
         null::text, p.reference, p.method, 'SALE:' || p.customer_id::text
    from public.customer_payments p
    join public.customers c on c.id = p.customer_id
    left join public.revenue_attributions a on a.order_key = 'SALE:' || p.customer_id::text
    left join public.payment_requests pr on pr.id = p.request_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = p.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- add-on purchases
  select 'AP:' || ap.id::text, 'ADDON_PAYMENT', ap.id, ap.customer_id, coalesce(a.department_id, c.department_id), coalesce(a.division, 'SUPPORT'), 'ADDON', ap.amount,
         case ap.status when 'VERIFIED' then 'COLLECTED' when 'PENDING' then 'PENDING' else 'REJECTED' end,
         ap.paid_at, coalesce(r.submitted_by, r.created_by, r.consultant_id),
         (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = r.id),
         ap.reference, ap.method, 'ADDON:' || r.id::text
    from public.addon_payments ap
    join public.addon_requests r on r.id = ap.request_id
    join public.customers c on c.id = ap.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
  union all
  -- payments recorded on the invoice itself
  select 'IP:' || ip.id::text, 'INVOICE_PAYMENT', ip.id, ip.customer_id, coalesce(a.department_id, c.department_id),
         case when g.purpose = 'SERVICES' then coalesce(a.division, 'SALES') when g.purpose = 'ADDON' or t.kind in ('ADDON', 'RENEWAL') then coalesce(a.division, 'SUPPORT') end,
         case when g.purpose = 'SERVICES' then 'INITIAL_SALE' when g.purpose = 'ADDON' or t.kind = 'ADDON' then 'ADDON'
              when t.kind = 'RENEWAL' then 'RENEWAL' else 'UNCLASSIFIED' end,
         ip.amount, case ip.status when 'VERIFIED' then 'COLLECTED' else 'REFUNDED' end,
         (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz,
         case when g.purpose = 'SERVICES' then fr.requested_by when g.purpose = 'ADDITIONAL' then t.responsible_id end,
         (select s.name from public.crm_services s where s.code = t.service_code), ip.reference, ip.method, 'INV:' || ip.invoice_id::text
    from public.invoice_payments ip
    join public.generated_invoices g on g.invoice_id = ip.invoice_id
    join public.customers c on c.id = ip.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || ip.invoice_id::text
    left join public.invoice_business_tags t on t.invoice_id = ip.invoice_id
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = ip.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
  union all
  -- a monthly plan Accounts activated as paid
  select 'PL:' || cp.id::text, 'PLAN_ACTIVATION', cp.id, cp.customer_id, coalesce(a.department_id, c.department_id), coalesce(a.division, 'SUPPORT'), 'SUBSCRIPTION', cp.price_at_start,
         'COLLECTED', cp.started_at::timestamp at time zone 'Asia/Kolkata', null::uuid,
         (select p.name from public.monthly_plans p where p.id = cp.plan_id), null::text, null::text, 'PLAN:' || cp.id::text
    from public.customer_plans cp
    join public.customers c on c.id = cp.customer_id
    left join public.revenue_attributions a on a.order_key = 'PLAN:' || cp.id::text
   where cp.payment_status = 'PAID' and cp.price_at_start > 0
$$;
revoke all on function private.business_ledger() from public, anon, authenticated;

-- The orders: what was agreed / invoiced (for billed and outstanding). Same columns as before.
create or replace function private.business_orders()
returns table (order_key text, division text, order_type text, customer_id uuid, department_id uuid, employee_id uuid,
               billed numeric, billed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  -- the services agreed with the customer
  select 'SALE:' || c.id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE'::text, c.id, coalesce(a.department_id, c.department_id), fr.requested_by, c.deal_amount,
         coalesce(fr.resolved_at, fr.requested_at, (select min(p.recorded_at) from public.customer_payments p where p.customer_id = c.id), c.created_at)
    from public.customers c
    left join public.revenue_attributions a on a.order_key = 'SALE:' || c.id::text
    left join lateral (select x.requested_by, x.resolved_at, x.requested_at from public.payment_requests x
                        where x.customer_id = c.id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where coalesce(c.deal_amount, 0) > 0
     and (fr.requested_by is not null or exists (select 1 from public.payment_requests x where x.customer_id = c.id and x.status <> 'RETURNED')
          or exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status <> 'REJECTED'))
  union all
  -- a services invoice whose payments are recorded on the invoice (the customer has no agreed amount)
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SALES'), 'INITIAL_SALE', g.customer_id, coalesce(a.department_id, c.department_id), fr.requested_by, g.total_amount,
         g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
    left join lateral (select x.requested_by from public.payment_requests x
                        where x.customer_id = g.customer_id and x.status <> 'RETURNED' order by x.requested_at limit 1) fr on true
   where g.purpose = 'SERVICES' and g.payment_ledger = 'INVOICE'
  union all
  -- approved add-ons that were invoiced
  select 'ADDON:' || r.id::text, coalesce(a.division, 'SUPPORT'), 'ADDON', r.customer_id, coalesce(a.department_id, c.department_id), coalesce(r.submitted_by, r.created_by, r.consultant_id), r.total,
         coalesce((select g.invoice_date::timestamp at time zone 'Asia/Kolkata' from public.generated_invoices g where g.addon_request_id = r.id limit 1),
                  r.decided_at, r.submitted_at, r.created_at)
    from public.addon_requests r
    join public.customers c on c.id = r.customer_id
    left join public.revenue_attributions a on a.order_key = 'ADDON:' || r.id::text
   where r.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and r.total > 0
  union all
  -- additional invoices Accounts tagged as renewal / add-on
  select 'INV:' || g.invoice_id::text, coalesce(a.division, 'SUPPORT'), case t.kind when 'RENEWAL' then 'RENEWAL' else 'ADDON' end, g.customer_id, coalesce(a.department_id, c.department_id),
         t.responsible_id, g.total_amount, g.invoice_date::timestamp at time zone 'Asia/Kolkata'
    from public.generated_invoices g
    join public.invoice_business_tags t on t.invoice_id = g.invoice_id and t.kind in ('RENEWAL', 'ADDON')
    join public.customers c on c.id = g.customer_id
    left join public.revenue_attributions a on a.order_key = 'INV:' || g.invoice_id::text
   where g.purpose = 'ADDITIONAL'
$$;
revoke all on function private.business_orders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Every department-income figure now groups payments by the department they were ATTRIBUTED to (verified_income_attributed().department_id)
--    instead of the customer's current department. The four functions below are the existing ones with only that change.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accounts_income_list(p_search text DEFAULT NULL::text, p_department uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_sum numeric; v_items jsonb;
begin
  perform private.require_accounts_staff();
  select count(*), coalesce(sum(p.amount), 0) into v_total, v_sum
    from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
   where (p_department is null or p.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
          or lower(coalesce(p.reference, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by paid_at desc), '[]'::jsonb) into v_items from (
    select p.paid_at, jsonb_build_object(
      'id', p.id, 'paidAt', p.paid_at, 'amount', p.amount, 'type', p.payment_type, 'method', p.method, 'reference', p.reference,
      'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name), 'contact', c.name,
      'departmentId', p.department_id, 'department', d.name,
      'verifiedBy', (select full_name from public.profiles where id = p.verified_by)) as j
      from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
      left join public.departments d on d.id = p.department_id
     where (p_department is null or p.department_id = p_department)
       and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
            or lower(coalesce(p.reference, '')) like '%' || v_term || '%')
     order by p.paid_at desc, p.recorded_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'sum', v_sum, 'page', v_page, 'pageSize', v_size);
end $fn$;

CREATE OR REPLACE FUNCTION public.accounts_finance_summary(p_department uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
declare
  v_income numeric; v_income_n bigint;
  v_exp numeric; v_exp_paid numeric; v_exp_pending numeric; v_exp_n bigint;
begin
  perform private.require_accounts_staff();
  select coalesce(sum(p.amount), 0), count(*) into v_income, v_income_n
    from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
   where (p_department is null or p.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to);
  select coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.payment_status = 'PAID'), 0),
         coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0), count(*)
    into v_exp, v_exp_paid, v_exp_pending, v_exp_n
    from public.department_expenses e
   where (p_department is null or e.department_id = p_department)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to);
  return jsonb_build_object('income', v_income, 'incomeCount', v_income_n, 'expenses', v_exp, 'expensesPaid', v_exp_paid,
    'expensesPending', v_exp_pending, 'expenseCount', v_exp_n, 'net', v_income - v_exp);
end $fn$;

CREATE OR REPLACE FUNCTION public.accounts_finance_by_department()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
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
    left join (select e.department_id, sum(e.amount) amount, count(*) n,
                      sum(e.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.department_expenses e
                where e.department_id is not null
                group by e.department_id) x on x.department_id = d.id
   where d.generates_revenue;
  return v;
end $fn$;

CREATE OR REPLACE FUNCTION public.dashboard_company_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $fn$
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
    left join (select department_id, sum(amount) amount, sum(amount) filter (where payment_status = 'PENDING') pending
                 from public.department_expenses where department_id is not null group by department_id) x on x.department_id = d.id
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
end $fn$;


-- ---------------------------------------------------------------------------
-- 7. The tax split of an order (taxable value and GST), wherever it is known
-- ---------------------------------------------------------------------------
-- The share of an order's gross value that is the taxable service value (1 - GST share), or NULL when the order's tax split is not
-- recorded (an agreement that includes GST and has no invoice yet, a monthly plan). Never guessed: a NULL stays "unknown" in the reports.
--   first sale            an agreement that EXCLUDES GST: agreed amount / total payable; otherwise the invoices issued for it
--   add-on                its invoice (taxable / total), else the add-on request (total without tax / total)
--   invoice order         the invoice's own taxable subtotal / total
create or replace function private.order_taxable_ratio(p_order_key text)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
  v numeric;
  c public.customers;
begin
  if p_order_key like 'SALE:%' then
    v_id := substr(p_order_key, 6)::uuid;
    select * into c from public.customers where id = v_id;
    if c.id is null then return null; end if;
    if c.agreed_tax_basis = 'EXCLUSIVE' and coalesce(c.agreed_amount, 0) > 0 and coalesce(c.deal_amount, 0) > 0 then
      return least(1, round(c.agreed_amount / c.deal_amount, 10));
    end if;
    select sum(g.subtotal) / nullif(sum(g.total_amount), 0) into v from public.generated_invoices g where g.customer_id = v_id and g.payment_ledger = 'CUSTOMER';
  elsif p_order_key like 'ADDON:%' then
    v_id := substr(p_order_key, 7)::uuid;
    select sum(g.subtotal) / nullif(sum(g.total_amount), 0) into v from public.generated_invoices g where g.addon_request_id = v_id;
    if v is null then
      select (r.total - r.tax_total) / nullif(r.total, 0) into v from public.addon_requests r where r.id = v_id;
    end if;
  elsif p_order_key like 'INV:%' then
    v_id := substr(p_order_key, 5)::uuid;
    select g.subtotal / nullif(g.total_amount, 0) into v from public.generated_invoices g where g.invoice_id = v_id;
  end if;
  return case when v is null then null else least(1, greatest(0, round(v, 10))) end;
end $$;
revoke all on function private.order_taxable_ratio(text) from public, anon, authenticated;

create or replace function private.income_json(
  p_collected numeric, p_col_taxable numeric, p_col_known numeric, p_pending numeric, p_refunded numeric, p_payments numeric,
  p_billed numeric, p_bill_taxable numeric, p_bill_known numeric, p_outstanding numeric, p_orders numeric)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'collected', coalesce(p_collected, 0),
    'collectedTaxable', coalesce(p_col_taxable, 0),
    'collectedGst', coalesce(p_col_known, 0) - coalesce(p_col_taxable, 0),
    'collectedTaxSplitUnknown', coalesce(p_collected, 0) - coalesce(p_col_known, 0),
    'pending', coalesce(p_pending, 0),
    'refunded', coalesce(p_refunded, 0),
    'payments', coalesce(p_payments, 0),
    'billed', coalesce(p_billed, 0),
    'billedTaxable', coalesce(p_bill_taxable, 0),
    'billedGst', coalesce(p_bill_known, 0) - coalesce(p_bill_taxable, 0),
    'billedTaxSplitUnknown', coalesce(p_billed, 0) - coalesce(p_bill_known, 0),
    'outstanding', coalesce(p_outstanding, 0),
    'orders', coalesce(p_orders, 0))
$$;
revoke all on function private.income_json(numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Who may read the department income: Super Admin and Accounts (every department), a Department Head (their own)
-- ---------------------------------------------------------------------------
create or replace function private.income_scope(p_department uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if private.is_super_admin() or private.is_accounts_staff() then
    return p_department;
  end if;
  if private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() is not null then
    if p_department is not null and p_department <> private.my_department_id() then
      raise exception 'FORBIDDEN: A Department Head can see only their own department''s income.' using errcode = '42501';
    end if;
    return private.my_department_id();
  end if;
  raise exception 'FORBIDDEN: Only the Super Admin, Accounts and Department Heads can see department income.' using errcode = '42501';
end $$;
revoke all on function private.income_scope(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. The department income report
-- ---------------------------------------------------------------------------
-- collected   verified payments in the range (gross receipts, GST included), each payment counted once, in the order's division
--             and department. A generated invoice is never collected until a payment on it is verified.
-- pending     payments recorded but not yet verified.   refunded  payments that were reversed (not in collected).
-- billed      the value of the orders (what was agreed / invoiced), GST included.   outstanding  billed - collected per order, never below zero.
-- ...Taxable / ...Gst  the split of the same figures where the order's tax split is known; ...TaxSplitUnknown is the rest.
create or replace function public.department_income_report(p_department uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid := private.income_scope(p_department);
  v jsonb;
begin
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_scope is not null and not exists (select 1 from public.departments where id = v_scope) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;

  with l0 as materialized (
    select x.* from private.business_ledger() x
     where x.status <> 'REJECTED' and (v_scope is null or x.department_id = v_scope)
       and (p_from is null or x.occurred_at >= private.business_day_start(p_from))
       and (p_to is null or x.occurred_at < private.business_day_start(p_to + 1))),
  life as materialized (
    select z.order_key,
           coalesce(sum(z.amount) filter (where z.status = 'COLLECTED'), 0) collected, coalesce(sum(z.amount) filter (where z.status = 'PENDING'), 0) pending,
           coalesce(sum(z.amount) filter (where z.status = 'REFUNDED'), 0) refunded, count(*) filter (where z.status = 'COLLECTED') n_paid,
           max(z.occurred_at) filter (where z.status = 'COLLECTED') last_paid
      from private.business_ledger() z group by z.order_key),
  o0 as materialized (
    select o.* from private.business_orders() o
     where (v_scope is null or o.department_id = v_scope)
       and ((p_from is null and p_to is null)
            or ((p_from is null or o.billed_at >= private.business_day_start(p_from)) and (p_to is null or o.billed_at < private.business_day_start(p_to + 1)))
            or exists (select 1 from l0 where l0.order_key = o.order_key))),
  rt as materialized (
    select k.order_key, private.order_taxable_ratio(k.order_key) ratio
      from (select order_key from l0 union select order_key from o0) k),
  l as materialized (
    select x.*, a.source attr_source, a.acquisition_division, a.referral_source, r.ratio
      from l0 x left join public.revenue_attributions a on a.order_key = x.order_key left join rt r on r.order_key = x.order_key
     where x.division is not null),
  o as materialized (
    select x.*, a.source attr_source, a.needs_review, a.review_note, a.acquisition_division, a.referral_source, r.ratio,
           coalesce(f.collected, 0) collected, coalesce(f.pending, 0) pending, coalesce(f.refunded, 0) refunded, coalesce(f.n_paid, 0) n_paid, f.last_paid
      from o0 x left join public.revenue_attributions a on a.order_key = x.order_key left join rt r on r.order_key = x.order_key left join life f on f.order_key = x.order_key),
  la as (
    select department_id, division, coalesce(attr_source, 'UNRECORDED') source, tx_type, coalesce(service, '') service, acquisition_division, referral_source,
           coalesce(sum(amount) filter (where status = 'COLLECTED'), 0) collected,
           coalesce(sum(round(amount * ratio, 2)) filter (where status = 'COLLECTED' and ratio is not null), 0) col_taxable,
           coalesce(sum(amount) filter (where status = 'COLLECTED' and ratio is not null), 0) col_known,
           coalesce(sum(amount) filter (where status = 'PENDING'), 0) pending, coalesce(sum(amount) filter (where status = 'REFUNDED'), 0) refunded,
           count(*) filter (where status = 'COLLECTED') n
      from l group by 1, 2, 3, 4, 5, 6, 7),
  oa as (
    select department_id, division, coalesce(attr_source, 'UNRECORDED') source, order_type tx_type, acquisition_division, referral_source,
           count(*) orders, coalesce(sum(billed), 0) billed, coalesce(sum(round(billed * ratio, 2)) filter (where ratio is not null), 0) bill_taxable,
           coalesce(sum(billed) filter (where ratio is not null), 0) bill_known, coalesce(sum(greatest(billed - collected, 0)), 0) outstanding
      from o group by 1, 2, 3, 4, 5, 6)
  select jsonb_build_object(
    'scope', jsonb_build_object('departmentId', v_scope, 'name', (select name from public.departments where id = v_scope), 'from', p_from, 'to', p_to),
    'basis', 'Cash basis. Collected = verified payments (gross receipts, GST included), each counted once. A generated invoice is not money received. Pending, refunded and outstanding are separate.',
    'rule', (select client_purchase_attribution from public.revenue_attribution_settings where id),
    'totals', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
                 from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la) l1,
                      (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa) o1),
    'byDivision', coalesce((select jsonb_object_agg(lower(d.division), private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n))
                 from (values ('SALES'), ('SUPPORT')) d(division)
                 cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.division = d.division) l1
                 cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.division = d.division) o1), '{}'::jsonb),
    'byType', coalesce((select jsonb_agg(jsonb_build_object('division', t.division, 'type', t.tx_type) || private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n) order by t.division, t.tx_type)
                 from (select division, tx_type from la union select division, tx_type from oa) t
                 cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.division = t.division and la.tx_type = t.tx_type) l1
                 cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.division = t.division and oa.tx_type = t.tx_type) o1), '[]'::jsonb),
    'bySource', coalesce((select jsonb_agg(jsonb_build_object('source', s.source) || private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n) order by s.source)
                 from (select source from la union select source from oa) s
                 cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.source = s.source) l1
                 cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.source = s.source) o1), '[]'::jsonb),
    'byService', coalesce((select jsonb_agg(jsonb_build_object('service', sv.service, 'division', sv.division, 'collected', sv.c, 'pending', sv.p, 'refunded', sv.r, 'payments', sv.n) order by sv.c desc, sv.service)
                 from (select coalesce(nullif(service, ''), case tx_type when 'INITIAL_SALE' then 'Initial sale (agreed services)' when 'SUBSCRIPTION' then 'Monthly plan' else 'Other' end) service,
                              division, sum(collected) c, sum(pending) p, sum(refunded) r, sum(n) n
                         from la group by 1, 2) sv), '[]'::jsonb),
    'highlights', jsonb_build_object(
      'supportAddOns', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where division = 'SUPPORT' and tx_type = 'ADDON') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where division = 'SUPPORT' and tx_type = 'ADDON') o1),
      'supportAcquired', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION') o1),
      'supportReferrals', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la
                 where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION' and lower(coalesce(referral_source, '')) = 'referral') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa
                 where division = 'SUPPORT' and tx_type = 'INITIAL_SALE' and source = 'ACQUISITION' and lower(coalesce(referral_source, '')) = 'referral') o1),
      'clientDashboard', (select private.income_json(l1.c, l1.ct, l1.ck, l1.p, l1.r, l1.n, o1.b, o1.bt, o1.bk, o1.o, o1.n)
          from (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where source = 'CLIENT_DASHBOARD') l1,
               (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where source = 'CLIENT_DASHBOARD') o1)),
    'departments', case when v_scope is not null then '[]'::jsonb else coalesce((
        select jsonb_agg(jsonb_build_object('departmentId', dd.id, 'name', dd.name,
                 'sales', private.income_json(s1.c, s1.ct, s1.ck, s1.p, s1.r, s1.n, so.b, so.bt, so.bk, so.o, so.n),
                 'support', private.income_json(u1.c, u1.ct, u1.ck, u1.p, u1.r, u1.n, uo.b, uo.bt, uo.bk, uo.o, uo.n),
                 'collected', coalesce(s1.c, 0) + coalesce(u1.c, 0), 'outstanding', coalesce(so.o, 0) + coalesce(uo.o, 0))
                 order by coalesce(s1.c, 0) + coalesce(u1.c, 0) desc, dd.name)
          from public.departments dd
          cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.department_id = dd.id and la.division = 'SALES') s1
          cross join lateral (select sum(collected) c, sum(col_taxable) ct, sum(col_known) ck, sum(pending) p, sum(refunded) r, sum(n) n from la where la.department_id = dd.id and la.division = 'SUPPORT') u1
          cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.department_id = dd.id and oa.division = 'SALES') so
          cross join lateral (select sum(billed) b, sum(bill_taxable) bt, sum(bill_known) bk, sum(outstanding) o, sum(orders) n from oa where oa.department_id = dd.id and oa.division = 'SUPPORT') uo
         where s1.c is not null or u1.c is not null or so.o is not null or uo.o is not null or s1.p is not null or u1.p is not null), '[]'::jsonb) end,
    'orders', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'orderKey', t.order_key, 'type', t.order_type, 'division', t.division, 'source', coalesce(t.attr_source, 'UNRECORDED'), 'departmentId', t.department_id,
                 'department', dd.name, 'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name),
                 'services', case when t.order_key like 'SALE:%' then (select string_agg(s.name, ', ' order by s.sort_order) from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = t.customer_id)
                                  when t.order_key like 'ADDON:%' then (select string_agg(i.name, ', ' order by i.sort_order) from public.addon_request_items i where i.request_id = substr(t.order_key, 7)::uuid)
                                  else (select s.name from public.invoice_business_tags tg join public.crm_services s on s.code = tg.service_code where tg.invoice_id = substr(t.order_key, 5)::uuid) end,
                 'billed', coalesce(t.billed, 0), 'taxSplitKnown', t.ratio is not null,
                 'billedTaxable', case when t.ratio is not null then round(coalesce(t.billed, 0) * t.ratio, 2) end,
                 'billedGst', case when t.ratio is not null then coalesce(t.billed, 0) - round(coalesce(t.billed, 0) * t.ratio, 2) end,
                 'collected', t.collected, 'pending', t.pending, 'refunded', t.refunded, 'outstanding', greatest(coalesce(t.billed, 0) - t.collected, 0),
                 'payments', t.n_paid, 'partPaid', t.collected > 0 and coalesce(t.billed, 0) - t.collected > 0,
                 'lastPaymentAt', t.last_paid, 'billedAt', t.billed_at, 'referralSource', t.referral_source, 'acquisitionDivision', t.acquisition_division,
                 'needsReview', coalesce(t.needs_review, false), 'reviewNote', t.review_note)
                 order by coalesce(t.last_paid, t.billed_at) desc nulls last)
          from (select * from o order by coalesce(last_paid, billed_at) desc nulls last limit 200) t
          join public.customers c on c.id = t.customer_id
          left join public.departments dd on dd.id = t.department_id), '[]'::jsonb),
    'review', jsonb_build_object(
      'needsReview', (select count(*) from o where coalesce(needs_review, false)),
      'needsReviewCollected', coalesce((select sum(collected) from o where coalesce(needs_review, false)), 0),
      'unclassifiedInvoices', (select count(*) from l0 where tx_type = 'UNCLASSIFIED'),
      'unrecordedAttribution', (select count(*) from o where attr_source is null))
  ) into v;
  return v;
end $$;
revoke all on function public.department_income_report(uuid, date, date) from public, anon;
grant execute on function public.department_income_report(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Reconciliation and corrections (Accounts and the Super Admin; every change audited)
-- ---------------------------------------------------------------------------
create or replace function public.attribution_reconciliation()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can reconcile attribution.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'legacyOrders', (select count(*) from public.revenue_attributions where source = 'LEGACY'),
    'withoutAcquisition', (select count(*) from public.customers c where c.acquisition_division is null
                             and exists (select 1 from public.revenue_attributions a where a.customer_id = c.id)),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'orderKey', a.order_key, 'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name),
               'division', a.division, 'source', a.source, 'departmentId', a.department_id, 'department', d.name, 'note', a.review_note,
               'collected', coalesce((select sum(l.amount) from private.business_ledger() l where l.order_key = a.order_key and l.status = 'COLLECTED'), 0),
               'acquisitionDivision', c.acquisition_division, 'ownerDivision', (select t.division::text from public.profiles p join public.teams t on t.id = p.team_id where p.id = c.owner_id))
             order by c.customer_code)
        from public.revenue_attributions a join public.customers c on c.id = a.customer_id left join public.departments d on d.id = a.department_id
       where a.needs_review), '[]'::jsonb));
end $$;
revoke all on function public.attribution_reconciliation() from public, anon;
grant execute on function public.attribution_reconciliation() to authenticated;

-- Correct who earns one order (and the department it belongs to). Needs a reason. Existing orders are never moved any other way.
create or replace function public.set_order_attribution(p_order_key text, p_division text, p_department uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_customer uuid;
  v_dept uuid;
  old public.revenue_attributions;
  c public.customers;
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can change attribution.' using errcode = '42501';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Say why the attribution is being changed.' using errcode = 'P0001';
  end if;
  select x.customer_id into v_customer from (select order_key, customer_id from private.business_orders() union all select order_key, customer_id from private.business_ledger()) x
   where x.order_key = p_order_key limit 1;
  if v_customer is null then
    raise exception 'NOT_FOUND: Order not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  select * into old from public.revenue_attributions where order_key = p_order_key;
  v_dept := coalesce(p_department, old.department_id, c.department_id);
  if not exists (select 1 from public.departments where id = v_dept and generates_revenue) then
    raise exception 'VALIDATION_ERROR: Choose a department that earns revenue.' using errcode = 'P0001';
  end if;
  insert into public.revenue_attributions (order_key, customer_id, division, department_id, source, acquisition_division, referral_source, needs_review, reason, updated_by)
  values (p_order_key, v_customer, p_division, v_dept, 'MANUAL', c.acquisition_division, nullif(left(btrim(coalesce(c.lead_source, '')), 60), ''), false, v_reason, auth.uid())
  on conflict (order_key) do update
     set division = excluded.division, department_id = excluded.department_id, source = 'MANUAL', needs_review = false, review_note = null,
         reason = excluded.reason, updated_at = now(), updated_by = excluded.updated_by;
  perform private.write_audit('ORDER_ATTRIBUTION_CHANGED', 'customer', v_customer, c.department_id, c.team_id,
    jsonb_build_object('order', p_order_key, 'from_division', old.division, 'to_division', p_division, 'from_department', old.department_id,
                       'to_department', v_dept, 'from_source', old.source, 'reason', v_reason));
  return jsonb_build_object('orderKey', p_order_key, 'division', p_division, 'departmentId', v_dept, 'source', 'MANUAL');
end $$;
revoke all on function public.set_order_attribution(text, text, uuid, text) from public, anon;
grant execute on function public.set_order_attribution(text, text, uuid, text) to authenticated;

-- Record who acquired a customer (for customers from before this was recorded). Future orders follow it; existing orders are NOT moved
-- (use set_order_attribution for those).
create or replace function public.set_customer_acquisition(p_customer uuid, p_division text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  c public.customers;
  v_old text;
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can change who acquired a customer.' using errcode = '42501';
  end if;
  if p_division not in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Choose Sales or Support.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Say why this is being recorded.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  v_old := c.acquisition_division;
  perform set_config('app.attribution_edit', '1', true);
  update public.customers set acquisition_division = p_division, acquisition_department_id = coalesce(acquisition_department_id, department_id) where id = p_customer;
  perform set_config('app.attribution_edit', '', true);
  perform private.write_audit('CUSTOMER_ACQUISITION_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('from', v_old, 'to', p_division, 'reason', v_reason));
  return jsonb_build_object('customerId', p_customer, 'acquisitionDivision', p_division,
    'ordersToReview', (select count(*) from public.revenue_attributions a where a.customer_id = p_customer and a.source in ('LEGACY', 'DEFAULT_SALES') and a.order_key not like 'ADDON:%' and a.order_key not like 'PLAN:%'));
end $$;
revoke all on function public.set_customer_acquisition(uuid, text, text) from public, anon;
grant execute on function public.set_customer_acquisition(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The rule for Client Dashboard purchases (Super Admin changes it; Accounts may read it)
-- ---------------------------------------------------------------------------
create or replace function public.revenue_attribution_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.is_accounts_staff()) then
    raise exception 'FORBIDDEN: Only the Super Admin and Accounts can see this setting.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('clientPurchaseAttribution', client_purchase_attribution, 'updatedAt', updated_at) from public.revenue_attribution_settings where id);
end $$;
revoke all on function public.revenue_attribution_settings_get() from public, anon;
grant execute on function public.revenue_attribution_settings_get() to authenticated;

create or replace function public.set_revenue_attribution_settings(p_client_purchase text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change this setting.' using errcode = '42501';
  end if;
  if p_client_purchase not in ('SUPPORT', 'ACQUISITION', 'SALES') then
    raise exception 'VALIDATION_ERROR: Choose Support, the acquiring division, or Sales.' using errcode = 'P0001';
  end if;
  select client_purchase_attribution into v_old from public.revenue_attribution_settings where id;
  update public.revenue_attribution_settings set client_purchase_attribution = p_client_purchase, updated_by = auth.uid(), updated_at = now() where id;
  perform private.write_audit('REVENUE_ATTRIBUTION_RULE_CHANGED', 'revenue_attribution_settings', null, null, null,
    jsonb_build_object('client_purchase_from', v_old, 'client_purchase_to', p_client_purchase));
  return jsonb_build_object('clientPurchaseAttribution', p_client_purchase);
end $$;
revoke all on function public.set_revenue_attribution_settings(text) from public, anon;
grant execute on function public.set_revenue_attribution_settings(text) to authenticated;
