-- =============================================================================
-- GST belongs to the ORDER, chosen once by Accounts; payments are the money actually received.
--
-- What was wrong
--   * GST was added PER PAYMENT (Record payment: "amount before GST" + a rate), so an order's total payable moved with every payment and carried
--     paise (14 + 18% = 16.52) while the screens showed whole rupees (16.52 shown as "17"), the Full payment box was filled with 16.52 and the same
--     form refused paise, and the cap was checked against figures on different bases.
--   * An invoice's GST rate was chosen line by line with no link to the order's.
--
-- The model now
--   agreed_amount        what Sales agreed, BEFORE GST (never overwritten)
--   order_gst_rate       the GST rate Accounts chose for the order (null until chosen; allowed rates: order_gst_rates). Chosen once; it is locked as soon as an
--                        invoice or a payment exists (change it only after those are rejected / reversed)
--   deal_amount          the order's TOTAL PAYABLE including GST, in WHOLE RUPEES: round(agreed + GST), the round-off is shown separately.
--                        Invoices still carry exact GST (to the paisa); the order's payable is the rounded total of them
--   payments             the actual money received (whole rupees); never carry GST; checked against the payable
--   invoices             each calculates GST on its own taxable value at the ORDER's rate (the database refuses any other rate); the sum of the taxable
--                        values may not exceed the agreed amount (unchanged); each invoice's share of the confirmed money is worked out in the order they
--                        were issued (invoice balance), next to the order's outstanding balance
--
-- Nothing stored is rewritten: older orders keep their totals and payments; accounts_gst_reconciliation() lists the ones that need a person to decide.
-- Safe to run again. Run after 20261129000100_invoice_whatsapp.sql.
-- =============================================================================

-- Amounts in messages: paise are shown when there are any (16.52 is not "17")
create or replace function private.rupees(p_amount numeric)
returns text language sql immutable set search_path = '' as $$
  select '₹' || case when abs(coalesce(p_amount, 0)) < 1000000000
                     then to_char(trunc(coalesce(p_amount, 0)), 'FM99,99,99,999')
                          || case when coalesce(p_amount, 0) <> trunc(coalesce(p_amount, 0)) then substr(to_char(abs(p_amount - trunc(p_amount)), 'FM0.00'), 2) else '' end
                     else coalesce(p_amount, 0)::bigint::text end
$$;
revoke all on function private.rupees(numeric) from public, anon;
grant execute on function private.rupees(numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Storage: the order's rate, and the rates Accounts may choose
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists order_gst_rate numeric(5, 2) check (order_gst_rate is null or (order_gst_rate >= 0 and order_gst_rate <= 28)),
  add column if not exists order_gst_set_at timestamptz,
  add column if not exists order_gst_set_by uuid references public.profiles (id) on delete set null;

create table if not exists public.order_gst_rates (
  rate numeric(5, 2) primary key check (rate >= 0 and rate <= 28),
  label text not null check (length(btrim(label)) between 1 and 40),
  is_active boolean not null default true,
  sort_order integer not null default 0
);
insert into public.order_gst_rates (rate, label, sort_order) values
  (0, 'No GST (0%)', 0), (5, '5% GST', 1), (12, '12% GST', 2), (18, '18% GST', 3), (28, '28% GST', 4)
on conflict (rate) do nothing;
alter table public.order_gst_rates enable row level security;
revoke all on public.order_gst_rates from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Is the choice still to be made? (a new order: exclusive of GST, no rate, nothing invoiced or paid under the older per-payment way)
-- ---------------------------------------------------------------------------
drop function if exists private.order_gst_required(uuid);
create or replace function private.order_gst_required(p_customer uuid, p_except_invoice uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE' and c.order_gst_rate is null
         and not exists (select 1 from public.generated_invoices g where g.customer_id = c.id and g.payment_ledger = 'CUSTOMER' and g.invoice_id is distinct from p_except_invoice)
         and not exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.gst_amount is not null and p.status in ('PENDING', 'VERIFIED'))
    from public.customers c where c.id = p_customer
$$;
revoke all on function private.order_gst_required(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The total payable of an order
-- ---------------------------------------------------------------------------
create or replace function private.sync_order_payable(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gross numeric; v_new numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_amount), 0) into v_net, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  if c.order_gst_rate is not null then
    -- invoiced: exactly what the invoices came to; not invoiced yet: the agreed amount with the order's GST; the order is payable in whole rupees
    v_new := round(v_gross + greatest(c.agreed_amount - v_net, 0) * (1 + c.order_gst_rate / 100));
  elsif exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.gst_amount is not null and p.status in ('PENDING', 'VERIFIED')) then
    return; -- GST was recorded on payments (the older way): that order's total is left exactly as it was, for a person to reconcile
  else
    -- GST not chosen yet: nothing is added; whatever was invoiced under the older invoice rules is counted as it is
    v_new := round(v_gross + greatest(c.agreed_amount - v_net, 0), 2);
  end if;
  v_new := greatest(v_new, c.amount_received); -- never below what has already been received
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

-- Each invoice's share of the verified money: the order's invoices are paid in the order they were issued.
create or replace function private.invoice_allocations(p_customer uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.invoice_id, 'number', x.invoice_number, 'taxable', x.subtotal, 'gst', x.total_gst, 'total', x.total_amount,
           'allocated', x.alloc, 'balance', x.total_amount - x.alloc,
           'state', case when x.alloc >= x.total_amount then 'FULLY_PAID' when x.alloc > 0 then 'PARTIALLY_PAID' else 'UNPAID' end) order by x.issued_at, x.invoice_id), '[]'::jsonb)
    from (select g.invoice_id, g.invoice_number, g.subtotal, g.total_gst, g.total_amount, g.issued_at,
                 least(g.total_amount, greatest(c.amount_verified - coalesce(sum(g.total_amount) over (order by g.issued_at, g.invoice_id rows between unbounded preceding and 1 preceding), 0), 0)) as alloc
            from public.generated_invoices g, public.customers c
           where c.id = p_customer and g.customer_id = c.id and g.payment_ledger = 'CUSTOMER') x
$$;
revoke all on function private.invoice_allocations(uuid) from public, anon, authenticated;

-- The whole order in one place
create or replace function private.order_summary(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gst numeric; v_gross numeric;
  v_excl boolean;
  v_payable numeric;
  v_taxable numeric; v_exact numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    return null;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0), coalesce(sum(total_amount), 0)
    into v_net, v_gst, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  v_excl := c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE';
  v_payable := coalesce(c.deal_amount, 0);
  if v_excl and c.order_gst_rate is not null then
    v_taxable := greatest(c.agreed_amount, v_net);
    v_exact := v_gross + greatest(c.agreed_amount - v_net, 0) * (1 + c.order_gst_rate / 100);
  end if;
  return jsonb_build_object(
    'basis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end,
    'agreedAmount', coalesce(c.agreed_amount, c.deal_amount),
    'taxableTotal', case when v_excl then c.agreed_amount end,
    'gstRate', case when v_excl then c.order_gst_rate end,
    'gstSelected', v_excl and c.order_gst_rate is not null,
    -- true while the rate still has to be chosen: the payable is not final and no payment or invoice can be made
    'gstRequired', private.order_gst_required(c.id),
    'gstTotal', case when v_exact is not null then round(v_exact - v_taxable, 2) when v_excl then round(v_payable - c.agreed_amount, 2) end,
    'roundOff', case when v_exact is not null then round(v_payable - v_exact, 2) end,
    'totalPayable', v_payable,
    'confirmed', c.amount_verified,
    'pending', greatest(c.amount_received - c.amount_verified, 0),
    'balance', greatest(v_payable - c.amount_verified, 0),
    'state', case when v_payable > 0 and c.amount_verified >= v_payable then 'FULLY_PAID' when c.amount_verified > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'invoicedTaxable', v_net, 'invoicedGst', v_gst, 'invoicedTotal', v_gross,
    'invoices', private.invoice_allocations(c.id),
    'estimated', false);
end $$;
revoke all on function private.order_summary(uuid) from public, anon, authenticated;

-- What the Accounts screen needs about the order's GST
create or replace function private.order_gst_json(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  v_has_inv boolean; v_has_pay boolean; v_legacy boolean;
  v_lock text;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return jsonb_build_object('applies', false);
  end if;
  v_has_inv := exists (select 1 from public.generated_invoices g where g.customer_id = c.id and g.payment_ledger = 'CUSTOMER');
  v_has_pay := exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status in ('PENDING', 'VERIFIED'));
  v_legacy := c.order_gst_rate is null and not private.order_gst_required(c.id);
  v_lock := case when v_has_inv then 'An invoice has been issued for this order, so its GST rate is fixed.'
                 when v_has_pay and c.order_gst_rate is not null then 'A payment has been recorded for this order, so its GST rate is fixed. Reject or reverse the payments to change it.' end;
  return jsonb_build_object(
    'applies', true,
    'rate', c.order_gst_rate,
    'selected', c.order_gst_rate is not null,
    'legacy', v_legacy,
    'agreedAmount', c.agreed_amount,
    'locked', v_lock is not null,
    'lockReason', v_lock,
    'setAt', c.order_gst_set_at,
    'setBy', (select full_name from public.profiles where id = c.order_gst_set_by),
    'rates', coalesce((select jsonb_agg(jsonb_build_object('rate', r.rate, 'label', r.label) order by r.sort_order, r.rate) from public.order_gst_rates r where r.is_active), '[]'::jsonb));
end $$;
revoke all on function private.order_gst_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Accounts chooses the GST rate of the order
-- ---------------------------------------------------------------------------
create or replace function public.accounts_set_order_gst(p_customer uuid, p_rate numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  v_before numeric;
  v_payable_before numeric;
  v_other_rates integer;
begin
  if v.agreed_amount is null or v.agreed_tax_basis <> 'EXCLUSIVE' then
    raise exception 'CONFLICT: The agreed amount of this order already includes GST, so no GST rate is chosen for it.' using errcode = 'P0001';
  end if;
  if p_rate is null or not exists (select 1 from public.order_gst_rates r where r.rate = p_rate and r.is_active) then
    raise exception 'VALIDATION_ERROR: Choose one of the GST rates on the list.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage not in ('LEAD', 'ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: GST cannot be chosen for this customer right now.' using errcode = 'P0001';
  end if;
  if v.order_gst_rate is not distinct from p_rate then
    return private.order_gst_json(p_customer) || jsonb_build_object('order', private.order_summary(p_customer), 'unchanged', true);
  end if;
  if v.order_gst_rate is not null and (
       exists (select 1 from public.generated_invoices g where g.customer_id = v.id and g.payment_ledger = 'CUSTOMER')
       or exists (select 1 from public.customer_payments p where p.customer_id = v.id and p.status in ('PENDING', 'VERIFIED'))) then
    raise exception 'CONFLICT: The GST rate of this order is fixed once an invoice or a payment exists. Reject or reverse the payments first.' using errcode = 'P0001';
  end if;
  -- an older order (GST on its payments or invoices): choosing a rate must agree with what is already recorded, never contradict it
  select count(distinct r) into v_other_rates from (
    select p.gst_rate as r from public.customer_payments p where p.customer_id = v.id and p.gst_rate is not null and p.status in ('PENDING', 'VERIFIED')
    union all
    select i.tax_rate from public.generated_invoice_items i join public.generated_invoices g on g.invoice_id = i.invoice_id
     where g.customer_id = v.id and g.payment_ledger = 'CUSTOMER') x
   where r is distinct from p_rate;
  if v_other_rates > 0 then
    raise exception 'CONFLICT: Payments or invoices of this order already carry a different GST rate. This order needs a person to reconcile it (see the GST reconciliation list).' using errcode = 'P0001';
  end if;
  v_before := v.order_gst_rate;
  v_payable_before := v.deal_amount;
  update public.customers set order_gst_rate = p_rate, order_gst_set_at = now(), order_gst_set_by = (select private.my_id()) where id = v.id;
  perform private.sync_order_payable(v.id);
  perform private.sync_payment_totals(v.id);
  perform private.log_customer_activity(v.id, 'ORDER_GST_SET',
    format('GST %s%% chosen for the order: %s before GST, %s payable', p_rate::text, private.rupees(v.agreed_amount), private.rupees((select deal_amount from public.customers where id = v.id))));
  perform private.write_audit('ORDER_GST_SET', 'customer', v.id, v.department_id, v.team_id,
    jsonb_build_object('rate', p_rate, 'was', v_before, 'agreed', v.agreed_amount, 'payable_was', v_payable_before, 'payable', (select deal_amount from public.customers where id = v.id)));
  return private.order_gst_json(v.id) || jsonb_build_object('order', private.order_summary(v.id));
end $$;
revoke all on function public.accounts_set_order_gst(uuid, numeric) from public, anon;
grant execute on function public.accounts_set_order_gst(uuid, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Payments: the money received, in whole rupees, checked against the payable
-- ---------------------------------------------------------------------------
-- The per-payment GST functions are retired: GST is the order's, so a payment can no longer carry it. (The columns stay, for history.)
drop function if exists public.accounts_record_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, boolean, numeric);
drop function if exists public.accounts_update_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, numeric);

create or replace function private.check_payment_fields(v public.customers, p_exclude uuid, p_type text, p_amount numeric, p_method text, p_reference text, p_paid_at timestamp with time zone)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_left numeric;
begin
  if p_type is null or p_type not in ('PART', 'FULL') then
    raise exception 'VALIDATION_ERROR: Choose part payment or full payment.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select the payment method.' using errcode = 'P0001';
  end if;
  if p_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and p_reference is null then
    raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
  end if;
  if p_paid_at > now() + interval '1 hour' then
    raise exception 'VALIDATION_ERROR: The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  if coalesce(v.deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: The agreed amount is not set for this customer.' using errcode = 'P0001';
  end if;
  if private.order_gst_required(v.id) then
    raise exception 'VALIDATION_ERROR: Choose the GST rate for this order first. The amount payable (including GST) is not known until then.' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_recorded from public.customer_payments
   where customer_id = v.id and status in ('PENDING', 'VERIFIED') and id is distinct from p_exclude;
  v_left := v.deal_amount - v_recorded;
  -- whole rupees. (Only an older order whose total still carries paise can be settled by the exact remainder.)
  if p_amount <> trunc(p_amount) and not (p_amount = v_left and v.deal_amount <> trunc(v.deal_amount)) then
    raise exception 'VALIDATION_ERROR: Enter the amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if v_recorded + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: This would exceed the total payable including GST (%). Still to receive: %.', private.rupees(v.deal_amount), private.rupees(greatest(v_left, 0)) using errcode = 'P0001';
  end if;
  if p_type = 'FULL' and v_recorded + p_amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: A full payment must settle everything still to receive (%). Record it as a part payment instead.', private.rupees(v_left) using errcode = 'P0001';
  end if;
  if p_type = 'PART' and v_recorded + p_amount = v.deal_amount then
    raise exception 'VALIDATION_ERROR: This payment settles the whole amount payable. Record it as a full payment.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_payment_fields(public.customers, uuid, text, numeric, text, text, timestamp with time zone) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Invoices use the order's rate
-- ---------------------------------------------------------------------------
create or replace function private.tg_generated_invoice_item_order_gst()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  c public.customers;
begin
  select * into g from public.generated_invoices where invoice_id = new.invoice_id;
  if g.invoice_id is null or g.payment_ledger <> 'CUSTOMER' then
    return new;
  end if;
  select * into c from public.customers where id = g.customer_id;
  if c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return new;
  end if;
  if c.order_gst_rate is not null then
    if new.tax_rate is distinct from c.order_gst_rate then
      raise exception 'VALIDATION_ERROR: The GST of this order was chosen as % percent. Every line of its invoices uses that rate (this line has % percent).', trim_scale(c.order_gst_rate)::text, trim_scale(new.tax_rate)::text using errcode = 'P0001';
    end if;
  elsif private.order_gst_required(c.id, g.invoice_id) then
    raise exception 'VALIDATION_ERROR: Choose the GST rate for this order first (on the Payment confirmation page). The invoice uses it.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_item_order_gst() from public, anon, authenticated;
drop trigger if exists generated_invoice_items_order_gst on public.generated_invoice_items;
create trigger generated_invoice_items_order_gst before insert on public.generated_invoice_items
  for each row execute function private.tg_generated_invoice_item_order_gst();

create or replace function public.accounts_invoice_prefill(p_customer uuid, p_purpose text default 'SERVICES', p_addon_request uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  r public.addon_requests;
  prev public.generated_invoices;
  v_purpose text := upper(coalesce(nullif(btrim(p_purpose), ''), 'SERVICES'));
  v_name text; v_business text; v_address text; v_contact text; v_mobile text; v_gstin text; v_state text;
  v_src_business text := 'NONE'; v_src_address text := 'NONE'; v_src_contact text := 'NONE'; v_src_mobile text := 'NONE';
  v_src_gstin text := 'NONE'; v_src_state text := 'NONE';
  v_lines jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_next bigint; v_last bigint; v_called boolean; v_suggest text;
  v_treatment text;
  v_invoiced numeric := 0;
  v_invoiced_net numeric := 0;
  v_excl boolean;
  v_left_net numeric;
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_purpose not in ('SERVICES', 'ADDON', 'ADDITIONAL') then
    raise exception 'VALIDATION_ERROR: Choose what this invoice is for.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  v_excl := c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE';

  -- Business name / address / contact / mobile: what was collected in onboarding first (the onboarding cards and the customer
  -- record are kept in step, so they normally agree), then the customer record. Nothing is invented.
  select nullif(btrim(e.value), '') into v_business from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_business is not null then v_src_business := 'ONBOARDING';
  else
    v_business := nullif(btrim(c.company), '');
    if v_business is not null then v_src_business := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_address from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'BUSINESS_ADDRESS' and e.status in ('SAVED', 'VERIFIED');
  if v_address is not null then v_src_address := 'ONBOARDING';
  else
    v_address := nullif(btrim(c.address), '');
    if v_address is not null then v_src_address := 'CUSTOMER'; end if;
  end if;
  select nullif(btrim(e.value), '') into v_contact from public.customer_onboarding_entries e
   where e.customer_id = c.id and e.item_code = 'CUSTOMER_NAME' and e.status in ('SAVED', 'VERIFIED');
  if v_contact is not null then v_src_contact := 'ONBOARDING';
  else
    v_contact := nullif(btrim(c.name), '');
    if v_contact is not null then v_src_contact := 'CUSTOMER'; end if;
  end if;
  v_name := coalesce(nullif(btrim(c.name), ''), v_contact);
  v_mobile := nullif(btrim(c.phone), '');
  if v_mobile is not null then
    v_src_mobile := 'CUSTOMER';
  else
    select nullif(btrim(e.value), '') into v_mobile from public.customer_onboarding_entries e
     where e.customer_id = c.id and e.item_code = 'CUSTOMER_MOBILE' and e.status in ('SAVED', 'VERIFIED');
    if v_mobile is not null then v_src_mobile := 'ONBOARDING'; end if;
  end if;

  -- GSTIN: there is no structured GST field on the customer, so the only structured source is the customer's own previous
  -- invoice. Otherwise it stays blank for Accounts to enter (no extraction from uploaded documents).
  select * into prev from public.generated_invoices g where g.customer_id = c.id order by g.issued_at desc limit 1;
  if prev.invoice_id is not null and prev.customer_gstin is not null then
    v_gstin := prev.customer_gstin;
    v_src_gstin := 'PREVIOUS_INVOICE';
  end if;
  -- State: the address first, then the GSTIN prefix, then the previous invoice. When two of these disagree Accounts is warned.
  v_state := private.infer_state_code(v_address);
  if v_state is not null then
    v_src_state := 'ADDRESS';
  elsif v_gstin is not null and private.valid_gstin(v_gstin) then
    v_state := left(v_gstin, 2);
    v_src_state := 'GSTIN';
  elsif prev.invoice_id is not null then
    v_state := prev.customer_state_code;
    v_src_state := 'PREVIOUS_INVOICE';
  end if;
  if v_state is not null and v_gstin is not null and private.valid_gstin(v_gstin) and left(v_gstin, 2) <> v_state then
    v_warnings := v_warnings || to_jsonb(format('The address says %s but the GSTIN starts with %s (%s). Verify the state before issuing.',
      (select name from public.gst_states where code = v_state), left(v_gstin, 2), (select name from public.gst_states where code = left(v_gstin, 2))));
  end if;
  if v_state is null then
    v_warnings := v_warnings || to_jsonb('The customer''s state could not be worked out. Choose it so the right tax is applied.'::text);
  end if;
  if v_address is null then
    v_warnings := v_warnings || to_jsonb('The customer has no business address on record. Enter it before issuing.'::text);
  end if;
  if c.email is null then
    v_warnings := v_warnings || to_jsonb('The customer has no e-mail address, so the invoice cannot be e-mailed. Add it to the customer first.'::text);
  end if;
  v_treatment := case when v_state is null then null when v_state = private.company_state_code() then 'INTRA_STATE' else 'INTER_STATE' end;

  -- The services of THIS purchase, each once.
  if v_purpose = 'SERVICES' then
    -- A new agreement carries no GST: the rate is left for Accounts to choose (null). Only an older agreement that already includes
    -- GST keeps the 18% its amounts were worked out with.
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', s.code, 'particulars', s.name, 'hsnSac', '998313', 'taxRate', case when v_excl then 0 else 18 end,
                                                  'quantity', '1 Nos', 'baseAmount', null) order by s.sort_order, s.name), '[]'::jsonb)
      into v_lines
      from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id;
    -- An invoice can be made for each part payment. When the agreement excludes GST the amounts before GST are compared with it
    -- (the GST is added on top); otherwise the invoice totals with GST are compared with the agreed amount.
    select coalesce(sum(g.subtotal), 0), coalesce(sum(g.total_amount), 0) into v_invoiced_net, v_invoiced
      from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES';
    if v_invoiced > 0 then
      v_warnings := v_warnings || to_jsonb(
        case when v_excl
             then format('Invoices already issued for the agreed services total %s before GST (%s with GST) of the agreed %s excluding GST. This invoice can cover the rest.',
                         private.rupees(v_invoiced_net), private.rupees(v_invoiced), private.rupees(c.agreed_amount))
             else format('Invoices already issued for the agreed services total %s%s. This invoice, for the next payment, can cover the rest.',
                         private.rupees(v_invoiced), case when coalesce(c.deal_amount, 0) > 0 then format(' of the agreed %s (including GST)', private.rupees(c.deal_amount)) else '' end) end);
    end if;
    -- The amount comes from this customer's own record: what Sales agreed for the services, less what has already been
    -- invoiced for them, spread over the services of the purchase (so the invoices together never pass the agreed amount).
    if v_excl then
      v_left_net := c.agreed_amount - v_invoiced_net;
      if v_left_net > 0 then
        -- the amounts are before GST: the balance is spread over the services as it is (no GST is added here)
        v_lines := private.spread_invoice_total(v_lines, v_left_net);
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s (excluding GST) has already been invoiced in full, so no amount is filled in.', private.rupees(c.agreed_amount)));
      end if;
    elsif coalesce(c.deal_amount, 0) > 0 then
      if c.deal_amount - v_invoiced > 0 then
        v_lines := private.spread_invoice_total(v_lines, c.deal_amount - v_invoiced);
      else
        v_warnings := v_warnings || to_jsonb(format('The agreed %s has already been invoiced in full, so no amount is filled in.', private.rupees(c.deal_amount)));
      end if;
    end if;
    if v_excl and c.order_gst_rate is null and private.order_gst_required(c.id) then
      v_warnings := v_warnings || to_jsonb('GST has not been chosen for this order yet. Choose the GST rate on the Payment confirmation page first: the invoice uses it.'::text);
    end if;
    if v_excl then
      -- the GST rate is the order's (chosen once by Accounts for the whole order); null until it is chosen
      select coalesce(jsonb_agg((l.line - 'taxRate') || jsonb_build_object('taxRate', c.order_gst_rate) order by l.ord), '[]'::jsonb) into v_lines
        from jsonb_array_elements(v_lines) with ordinality as l(line, ord);
    end if;
  elsif v_purpose = 'ADDON' then
    if p_addon_request is not null then
      select * into r from public.addon_requests where id = p_addon_request and customer_id = c.id;
    else
      select * into r from public.addon_requests where customer_id = c.id and status = 'APPROVED' order by created_at desc limit 1;
    end if;
    if r.id is null or r.status <> 'APPROVED' then
      raise exception 'CONFLICT: There is no approved add-on request waiting for an invoice for this customer.' using errcode = 'P0001';
    end if;
    -- the approved prices: base = quantity x unit price - discount, with the tax the request was approved with
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', i.service_code, 'particulars', i.name, 'hsnSac', '998313',
                                                  'taxRate', i.tax_percent, 'quantity', format('%s Nos', i.quantity),
                                                  'baseAmount', i.quantity * i.unit_price - i.discount) order by i.sort_order), '[]'::jsonb)
      into v_lines from public.addon_request_items i where i.request_id = r.id;
  end if;

  select last_value, is_called into v_last, v_called from public.invoice_number_seq;
  v_next := case when v_called then v_last + 1 else v_last end;
  loop
    v_suggest := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(v_next::text, 5, '0');
    exit when not exists (select 1 from public.member_invoices where lower(invoice_number) = lower(v_suggest));
    v_next := v_next + 1;
  end loop;

  return jsonb_build_object(
    'customerId', c.id, 'customerCode', c.customer_code, 'purpose', v_purpose, 'addonRequestId', r.id,
    'customer', jsonb_build_object('name', v_name, 'businessName', v_business, 'address', v_address, 'contactPerson', v_contact,
      'contactNumber', v_mobile, 'gstin', v_gstin, 'stateCode', v_state,
      'state', (select name from public.gst_states where code = v_state)),
    'sources', jsonb_build_object('businessName', v_src_business, 'address', v_src_address, 'contactPerson', v_src_contact,
      'contactNumber', v_src_mobile, 'gstin', v_src_gstin, 'state', v_src_state),
    'recipientEmail', c.email,
    'taxTreatment', v_treatment,
    'company', jsonb_build_object('name', 'Amuwa Corporation', 'stateCode', private.company_state_code(), 'gstin', private.company_gstin()),
    'suggestedInvoiceNumber', v_suggest,
    'invoiceDate', (now() at time zone 'Asia/Kolkata')::date,
    'orderNumber', 'Verbal', 'terms', '100% Payment Against supply.',
    'lines', v_lines,
    'dealAmount', c.deal_amount,
    'servicesInvoiced', (select coalesce(sum(g.total_amount), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'servicesInvoicedTaxable', (select coalesce(sum(g.subtotal), 0) from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES'),
    'agreedAmount', coalesce(c.agreed_amount, c.deal_amount),
    'agreedTaxBasis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end,
    'order', private.order_summary(c.id),
    'orderGstRate', c.order_gst_rate,
    'addonTotal', r.total,
    'existingInvoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.invoice_number, 'kind', x.kind, 'status', x.status, 'total', x.amount)
                                    order by x.created_at desc)
                                   from (select * from public.member_invoices i where i.customer_id = c.id and i.kind <> 'MANUAL'
                                          order by i.created_at desc limit 10) x), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category) order by s.sort_order, s.name)
                           from public.crm_services s where s.is_active), '[]'::jsonb),
    'warnings', v_warnings);
end $$;

-- the invoice's own figures (its share of the confirmed money) next to the whole order
create or replace function private.invoice_payment_summary(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  inv public.member_invoices;
  v_sum numeric := 0;
  v_pending numeric := 0;
  v_confirmed numeric;
  v_payments jsonb := '[]'::jsonb;
  v_prior numeric := 0;
begin
  select * into g from public.generated_invoices where invoice_id = p_invoice;
  if g.invoice_id is null then
    return null;
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  if g.payment_ledger = 'CUSTOMER' then
    select coalesce(sum(amount) filter (where status = 'VERIFIED'), 0), coalesce(sum(amount) filter (where status = 'PENDING'), 0)
      into v_sum, v_pending from public.customer_payments where customer_id = g.customer_id;
    select coalesce(sum(o.total_amount), 0) into v_prior from public.generated_invoices o
     where o.customer_id = g.customer_id and o.payment_ledger = 'CUSTOMER' and (o.issued_at, o.invoice_id) < (g.issued_at, g.invoice_id);
    v_sum := greatest(v_sum - v_prior, 0);
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_at) order by x.paid_at, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.customer_payments where customer_id = g.customer_id and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 20) x;
  elsif g.payment_ledger = 'ADDON' then
    select coalesce(sum(amount) filter (where status = 'VERIFIED'), 0), coalesce(sum(amount) filter (where status = 'PENDING'), 0)
      into v_sum, v_pending from public.addon_payments where request_id = inv.addon_request_id;
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_at) order by x.paid_at, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.addon_payments where request_id = inv.addon_request_id and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 20) x;
  else
    select coalesce(sum(amount), 0) into v_sum from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED';
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_on) order by x.paid_on, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED' order by paid_on desc, recorded_at desc limit 20) x;
  end if;
  -- The customer ledger pays the invoices in the order they were issued (what earlier invoices need is used first): this invoice's share of the
  -- verified money. (For the other ledgers a PAID invoice is settled by definition, as before.)
  v_confirmed := case when g.payment_ledger = 'CUSTOMER' then least(v_sum, g.total_amount)
                      when g.lifecycle = 'PAID' then g.total_amount else least(v_sum, g.total_amount) end;
  return jsonb_build_object(
    'total', g.total_amount, 'confirmed', v_confirmed, 'balance', g.total_amount - v_confirmed,
    'state', case when v_confirmed >= g.total_amount then 'FULLY_PAID' when v_confirmed > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'pending', v_pending, 'ledger', g.payment_ledger, 'payments', v_payments,
    -- the whole agreed order (every invoice of the agreed services together), kept apart from this invoice's own figures
    'order', case when g.payment_ledger = 'CUSTOMER' then private.order_summary(g.customer_id) end);
end $$;

-- ---------------------------------------------------------------------------
-- 7. The payment overview: the order's GST in place of a GST per payment
-- ---------------------------------------------------------------------------
create or replace function public.customer_payment_overview(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  v_accounts boolean := private.accounts_can_view(p_customer);
begin
  if not (v_accounts or private.can_access_customer(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  return jsonb_build_object(
    'customerId', v.id,
    'workflow', v.payment_workflow,
    'dealAmount', v.deal_amount,
    'agreedAmount', coalesce(v.agreed_amount, v.deal_amount),
    'taxBasis', case when v.agreed_amount is null then 'INCLUSIVE' else v.agreed_tax_basis end,
    'orderGst', private.order_gst_json(v.id),
    'order', private.order_summary(v.id),
    'recorded', v.amount_received,
    'verified', v.amount_verified,
    'pending', coalesce((select sum(amount) from public.customer_payments where customer_id = v.id and status = 'PENDING'), 0),
    'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0),
    'paymentStatus', v.payment_status,
    'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = v.accounts_owner_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.payment_type, 'amount', p.amount, 'taxableAmount', p.taxable_amount, 'gstRate', p.gst_rate, 'gstAmount', p.gst_amount,
        'method', p.method, 'reference', p.reference,
        'paidAt', p.paid_at, 'status', p.status, 'source', p.source, 'note', p.note, 'statusReason', p.status_reason,
        'recordedBy', (select full_name from public.profiles where id = p.recorded_by), 'recordedAt', p.recorded_at,
        'verifiedBy', (select full_name from public.profiles where id = p.verified_by), 'verifiedAt', p.verified_at)
        order by p.paid_at desc, p.recorded_at desc)
      from public.customer_payments p where p.customer_id = v.id), '[]'::jsonb),
    'request', (select jsonb_build_object(
        'id', r.id, 'status', r.status, 'agreedAmount', r.agreed_amount, 'salesNote', r.sales_note,
        'requestedAt', r.requested_at, 'requestedBy', (select full_name from public.profiles where id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note)
      from public.payment_requests r where r.customer_id = v.id order by r.requested_at desc limit 1),
    'followUps', case when v_accounts then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'outcome', f.outcome, 'note', f.note, 'contactedAt', f.contacted_at, 'nextFollowUpAt', f.next_follow_up_at,
        'author', (select full_name from public.profiles where id = f.author_id))
        order by f.contacted_at desc)
      from public.payment_followups f where f.customer_id = v.id), '[]'::jsonb) else null end,
    'isAccounts', v_accounts);
end $$;
revoke all on function public.customer_payment_overview(uuid) from public, anon;
grant execute on function public.customer_payment_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Orders that need a person to look at them (Accounts). Nothing is changed by this.
-- ---------------------------------------------------------------------------
create or replace function public.accounts_gst_reconciliation()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object('customerId', x.id, 'customer', x.name, 'agreed', x.agreed_amount, 'payable', x.deal_amount, 'received', x.amount_received,
             'reasons', x.reasons) order by x.name)
      from (select c.id, coalesce(nullif(c.company, ''), c.name) as name, c.agreed_amount, c.deal_amount, c.amount_received,
                   array_remove(array[
                     case when exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.gst_amount is not null) and c.order_gst_rate is null
                          then 'GST was recorded on individual payments (the older way); the order has no GST rate' end,
                     case when (select count(distinct i.tax_rate) from public.generated_invoice_items i join public.generated_invoices g on g.invoice_id = i.invoice_id
                                 where g.customer_id = c.id and g.payment_ledger = 'CUSTOMER') > 1 and c.order_gst_rate is null
                          then 'Its invoices use more than one GST rate' end,
                     case when c.agreed_tax_basis = 'EXCLUSIVE' and c.deal_amount <> trunc(c.deal_amount)
                          then 'The total payable carries paise (it is not in whole rupees)' end,
                     case when c.agreed_tax_basis = 'EXCLUSIVE' and c.order_gst_rate is not null and c.deal_amount is distinct from
                               round((select coalesce(sum(g.total_amount), 0) + greatest(c.agreed_amount - coalesce(sum(g.subtotal), 0), 0) * (1 + c.order_gst_rate / 100)
                                        from public.generated_invoices g where g.customer_id = c.id and g.payment_ledger = 'CUSTOMER'))
                          then 'The stored total payable differs from agreed amount + GST at the order rate' end,
                     case when c.amount_verified > c.deal_amount then 'More money is verified than the total payable' end
                   ], null) as reasons
              from public.customers c where c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE') x
     where cardinality(x.reasons) > 0), '[]'::jsonb);
end $$;
revoke all on function public.accounts_gst_reconciliation() from public, anon;
grant execute on function public.accounts_gst_reconciliation() to authenticated;

notify pgrst, 'reload schema';
