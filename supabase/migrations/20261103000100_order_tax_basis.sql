-- One order, one financial model: the agreed amount, GST, the total payable and the balance.
--
-- ROOT CAUSE this fixes. Sales' agreed amount was stored in customers.deal_amount and treated everywhere as the total the customer
-- pays. When the agreement is BEFORE GST (the usual case: 1,20,000 + 18% GST = 1,41,600), the invoice check compared GST-inclusive
-- invoice totals with the pre-GST agreement ("would total 1,41,600 but only 1,20,000 was agreed"), and every payment / balance /
-- status rule (all of which read deal_amount) capped the order at the pre-GST figure, so the balance and the paid status were wrong.
--
-- THE MODEL (nothing is duplicated; deal_amount keeps its meaning for every existing rule):
--   customers.agreed_amount     what Sales agreed, as agreed (NULL: an older agreement, kept exactly as it was)
--   customers.agreed_tax_basis  INCLUSIVE (the agreed amount already has GST in it) or EXCLUSIVE (GST is added)
--   customers.deal_amount       the TOTAL PAYABLE including GST: the agreed amount when INCLUSIVE; when EXCLUSIVE the GST of the invoices
--                               already issued plus the agreed amount not yet invoiced with its GST at the rate of those invoices
--                               (18% until the first invoice). Payments, balances and statuses all read this.
--   total confirmed payments    customers.amount_verified (verified customer_payments only)
--   order balance               deal_amount - amount_verified
--   an invoice's own figures    unchanged (taxable subtotal, GST, total, and what the verified payments cover of it)
-- Older agreements are NOT reinterpreted: they stay INCLUSIVE. Accounts can change an agreement's basis (audited, with a reason).
--
-- Run after 20261102000100_invoice_prefill_agreed_amount.sql (it replaces that migration's accounts_invoice_prefill, keeping its
-- fill-in of the amounts and making it work on the amount before GST when the agreement excludes GST). Safe to run again.

alter table public.customers add column if not exists agreed_amount numeric(14, 2) check (agreed_amount > 0);
alter table public.customers add column if not exists agreed_tax_basis text not null default 'INCLUSIVE' check (agreed_tax_basis in ('INCLUSIVE', 'EXCLUSIVE'));

-- ---------------------------------------------------------------------------
-- The total payable of an agreement that excludes GST
-- ---------------------------------------------------------------------------
create or replace function private.sync_order_payable(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gst numeric; v_gross numeric; v_rate numeric; v_new numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0), coalesce(sum(total_amount), 0)
    into v_net, v_gst, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  -- the GST rate of what is already invoiced (18% before the first invoice) applies to what is still to invoice
  v_rate := case when v_net > 0 then v_gst / v_net else 0.18 end;
  v_new := round(v_gross + greatest(c.agreed_amount - v_net, 0) * (1 + v_rate), 2);
  -- never below what has already been received
  v_new := greatest(v_new, c.amount_received);
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

-- The whole order in one place: what was agreed, the GST, what is payable, what was confirmed, what is left.
create or replace function private.order_summary(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_gst numeric; v_gross numeric;
  v_excl boolean;
  v_payable numeric;
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
  return jsonb_build_object(
    'basis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end,
    'agreedAmount', coalesce(c.agreed_amount, c.deal_amount),
    'taxableTotal', case when v_excl then c.agreed_amount end,
    'gstTotal', case when v_excl then round(v_payable - c.agreed_amount, 2) end,
    'totalPayable', v_payable,
    'confirmed', c.amount_verified,
    'pending', greatest(c.amount_received - c.amount_verified, 0),
    'balance', greatest(v_payable - c.amount_verified, 0),
    'state', case when v_payable > 0 and c.amount_verified >= v_payable then 'FULLY_PAID' when c.amount_verified > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'invoicedTaxable', v_net, 'invoicedGst', v_gst, 'invoicedTotal', v_gross,
    -- true while part of the payable (the GST of what is not invoiced yet) is still an estimate
    'estimated', v_excl and c.agreed_amount > v_net);
end $$;
revoke all on function private.order_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invoice validation: compare like with like
-- ---------------------------------------------------------------------------
create or replace function private.tg_generated_invoice_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric;
  v_gross numeric;
begin
  select * into c from public.customers where id = new.customer_id;
  new.payment_ledger := case when new.addon_request_id is not null then 'ADDON'
                             when new.purpose = 'SERVICES' and coalesce(c.deal_amount, 0) > 0 then 'CUSTOMER'
                             else 'INVOICE' end;
  if new.payment_ledger = 'CUSTOMER' then
    select coalesce(sum(g.subtotal), 0), coalesce(sum(g.total_amount), 0) into v_net, v_gross
      from public.generated_invoices g where g.customer_id = new.customer_id and g.payment_ledger = 'CUSTOMER';
    if c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE' then
      -- the agreement excludes GST: the taxable value of all the invoices may not exceed it (the GST is added on top of it)
      if v_net + new.subtotal > c.agreed_amount then
        raise exception 'VALIDATION_ERROR: The invoices of the agreed services would total % before GST but only % was agreed with Sales, excluding GST (already invoiced: %). Lower this invoice, or ask Sales to correct the agreed amount first.',
          private.rupees(v_net + new.subtotal), private.rupees(c.agreed_amount), private.rupees(v_net) using errcode = 'P0001';
      end if;
    elsif v_gross + new.total_amount > c.deal_amount then
      -- the agreement includes GST: compare invoice totals (with GST) with it
      raise exception 'VALIDATION_ERROR: The invoices of the agreed services would total % but only % was agreed with Sales, including GST (already invoiced: %). Lower this invoice, or ask Sales to correct the agreed amount first.',
        private.rupees(v_gross + new.total_amount), private.rupees(c.deal_amount), private.rupees(v_gross) using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_ledger() from public, anon, authenticated;

-- After an invoice exists, the total payable follows it (its real GST replaces the estimate for that part of the order).
create or replace function private.tg_generated_invoice_order_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.payment_ledger = 'CUSTOMER' then
    perform private.sync_order_payable(new.customer_id);
  end if;
  return null;
end $$;
revoke all on function private.tg_generated_invoice_order_sync() from public, anon, authenticated;
drop trigger if exists generated_invoices_order_sync on public.generated_invoices;
create trigger generated_invoices_order_sync after insert on public.generated_invoices
  for each row execute function private.tg_generated_invoice_order_sync();

-- ---------------------------------------------------------------------------
-- Payments: the same cap as ever (the total payable), paise only for the payment that settles the exact balance
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.check_payment_fields(v public.customers, p_exclude uuid, p_type text, p_amount numeric, p_method text, p_reference text, p_paid_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_recorded numeric;
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
  select coalesce(sum(amount), 0) into v_recorded from public.customer_payments
   where customer_id = v.id and status in ('PENDING', 'VERIFIED') and id is distinct from p_exclude;
  -- Payments are in whole rupees, except the one that settles the exact balance (the total payable can carry paise from the GST).
  if p_amount <> trunc(p_amount) and v_recorded + p_amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: Enter the amount in whole rupees (no paise). Only the payment that settles the exact balance (%) can include paise.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if v_recorded + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: This would exceed the agreed amount. Balance still to receive: %.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'FULL' and v_recorded + p_amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: A full payment must settle the agreed amount (balance %). Record it as a part payment instead.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'PART' and v_recorded + p_amount = v.deal_amount then
    raise exception 'VALIDATION_ERROR: This payment settles the agreed amount. Record it as a full payment.' using errcode = 'P0001';
  end if;
end $function$;


-- An invoice's own figures, and the whole order next to them
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
  v_confirmed := case when g.lifecycle = 'PAID' then g.total_amount else least(v_sum, g.total_amount) end;
  return jsonb_build_object(
    'total', g.total_amount, 'confirmed', v_confirmed, 'balance', g.total_amount - v_confirmed,
    'state', case when v_confirmed >= g.total_amount then 'FULLY_PAID' when v_confirmed > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'pending', v_pending, 'ledger', g.payment_ledger, 'payments', v_payments,
    -- the whole agreed order (every invoice of the agreed services together), kept apart from this invoice's own figures
    'order', case when g.payment_ledger = 'CUSTOMER' then private.order_summary(g.customer_id) end);
end $$;
revoke all on function private.invoice_payment_summary(uuid) from public, anon, authenticated;
revoke all on function private.invoice_payment_summary(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sales: Send to Accounts records what was agreed and whether it includes GST
-- ---------------------------------------------------------------------------
drop function if exists public.send_lead_to_accounts(uuid, numeric, text);
create or replace function public.send_lead_to_accounts(p_customer uuid, p_amount numeric, p_note text default null, p_tax_basis text default 'INCLUSIVE')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_basis text := upper(coalesce(nullif(btrim(p_tax_basis), ''), 'INCLUSIVE'));
  v_request uuid;
  v_payable numeric;
begin
  if v_basis not in ('INCLUSIVE', 'EXCLUSIVE') then
    raise exception 'VALIDATION_ERROR: Say whether the agreed amount includes or excludes GST.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be sent to Accounts.' using errcode = 'P0001';
  end if;
  if v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' or exists (
       select 1 from public.payment_requests r where r.customer_id = p_customer and r.status = 'PENDING') then
    raise exception 'CONFLICT: This lead is already with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_services s where s.customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: Select at least one service before sending to Accounts.' using errcode = 'P0001';
  end if;
  if v.phone is null and v.email is null then
    raise exception 'VALIDATION_ERROR: Add a phone number or e-mail before sending to Accounts.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if v_basis = 'INCLUSIVE' and p_amount < v.amount_received then
    raise exception 'VALIDATION_ERROR: The agreed amount cannot be less than the % already recorded.', private.rupees(v.amount_received) using errcode = 'P0001';
  end if;

  insert into public.payment_requests (customer_id, agreed_amount, sales_note, requested_by)
  values (p_customer, p_amount, v_note, (select private.my_id()))
  returning id into v_request;
  -- deal_amount is what the customer has to pay in total (GST included): every payment, balance and status rule keeps reading it.
  -- agreed_amount / agreed_tax_basis keep what Sales actually agreed.
  update public.customers
     set payment_workflow = 'PENDING_PAYMENT_CONFIRMATION', deal_amount = p_amount, agreed_amount = p_amount, agreed_tax_basis = v_basis,
         lead_status = 'READY_TO_BUY'
   where id = p_customer;
  perform private.sync_order_payable(p_customer);
  select deal_amount into v_payable from public.customers where id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_ACCOUNTS',
    format('Sent to Accounts for payment confirmation (agreed %s%s)', private.rupees(p_amount), case when v_basis = 'EXCLUSIVE' then ' excluding GST' else '' end) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('PAYMENT_SENT_TO_ACCOUNTS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', v_request, 'agreed_amount', p_amount, 'tax_basis', v_basis, 'payable', v_payable, 'note', v_note));
  perform private.notify_accounts('PAYMENT_CONFIRMATION_REQUESTED', format('Confirm payment: %s', coalesce(v.company, v.name)),
    format('Sales sent a customer for payment confirmation (agreed %s%s).', private.rupees(p_amount), case when v_basis = 'EXCLUSIVE' then ' excluding GST' else '' end), p_customer);
  return v_request;
end $$;
revoke all on function public.send_lead_to_accounts(uuid, numeric, text, text) from public, anon;
grant execute on function public.send_lead_to_accounts(uuid, numeric, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- Accounts: correct the basis of an agreement (audited; older agreements are never reinterpreted silently)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_set_agreement_basis(p_customer uuid, p_basis text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_basis text := upper(coalesce(nullif(btrim(p_basis), ''), ''));
  v_reason text := nullif(left(btrim(coalesce(p_reason, '')), 500), '');
  v_agreed numeric;
  v_net numeric; v_gross numeric;
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_basis not in ('INCLUSIVE', 'EXCLUSIVE') then
    raise exception 'VALIDATION_ERROR: Say whether the agreed amount includes or excludes GST.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'VALIDATION_ERROR: Say why the agreement is being changed (at least 5 characters).' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if coalesce(c.deal_amount, 0) <= 0 then
    raise exception 'CONFLICT: No amount has been agreed for this customer yet.' using errcode = 'P0001';
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_amount), 0) into v_net, v_gross
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  v_agreed := coalesce(c.agreed_amount, c.deal_amount);
  if v_basis = coalesce(case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end, 'INCLUSIVE') then
    raise exception 'CONFLICT: The agreement already has this basis.' using errcode = 'P0001';
  end if;
  if v_basis = 'EXCLUSIVE' then
    -- the figure on record is taken to be the amount BEFORE GST
    if v_net > v_agreed then
      raise exception 'CONFLICT: The invoices already issued total % before GST, more than the amount on record (%). Correct the agreed amount first.', private.rupees(v_net), private.rupees(v_agreed) using errcode = 'P0001';
    end if;
    update public.customers set agreed_amount = v_agreed, agreed_tax_basis = 'EXCLUSIVE' where id = c.id;
    perform private.sync_order_payable(c.id);
  else
    -- the amount on record is taken to be the TOTAL including GST
    if v_agreed < greatest(c.amount_received, v_gross) then
      raise exception 'CONFLICT: The amount on record (%) is below what was already received or invoiced (%).', private.rupees(v_agreed), private.rupees(greatest(c.amount_received, v_gross)) using errcode = 'P0001';
    end if;
    update public.customers set agreed_amount = v_agreed, agreed_tax_basis = 'INCLUSIVE', deal_amount = v_agreed where id = c.id;
  end if;
  perform private.log_customer_activity(c.id, 'AGREEMENT_BASIS_CHANGED',
    format('Accounts set the agreed amount (%s) to %s GST · %s', private.rupees(v_agreed), case when v_basis = 'EXCLUSIVE' then 'excluding' else 'including' end, v_reason));
  perform private.write_audit('AGREEMENT_BASIS_CHANGED', 'customer', c.id, c.department_id, c.team_id,
    jsonb_build_object('from', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end, 'to', v_basis, 'agreed_amount', v_agreed,
                       'deal_amount_before', c.deal_amount, 'reason', v_reason));
  return private.order_summary(c.id);
end $$;
revoke all on function public.accounts_set_agreement_basis(uuid, text, text) from public, anon;
grant execute on function public.accounts_set_agreement_basis(uuid, text, text) to authenticated;

-- Agreements made before this change are not guessed at. This lists every customer who already has an invoice for the agreed services
-- under such an agreement, so Accounts can confirm each one (and use accounts_set_agreement_basis where the amount was before GST).
create or replace function public.accounts_agreement_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name), 'totalPayableOnRecord', c.deal_amount,
      'invoicedTaxable', x.net, 'invoicedTotal', x.gross, 'invoices', x.n, 'confirmedPayments', c.amount_verified,
      'note', case when x.net * 1.0 >= c.deal_amount * 0.5 then 'Invoices already cover half or more of the amount on record: check whether it was meant to be before GST.'
                   else 'Amount on record is treated as the total including GST.' end) order by c.customer_code)
      from public.customers c
      join (select customer_id, sum(subtotal) net, sum(total_amount) gross, count(*) n from public.generated_invoices
             where payment_ledger = 'CUSTOMER' group by customer_id) x on x.customer_id = c.id
     where c.agreed_amount is null), '[]'::jsonb);
end $$;
revoke all on function public.accounts_agreement_review() from public, anon;
grant execute on function public.accounts_agreement_review() to authenticated;

-- ---------------------------------------------------------------------------
-- What the screens read
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.customer_payment_overview(p_customer uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'order', private.order_summary(v.id),
    'recorded', v.amount_received,
    'verified', v.amount_verified,
    'pending', coalesce((select sum(amount) from public.customer_payments where customer_id = v.id and status = 'PENDING'), 0),
    'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0),
    'paymentStatus', v.payment_status,
    'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = v.accounts_owner_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.payment_type, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
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
end $function$;

create or replace function public.accounts_payment_requests(p_status text default 'PENDING', p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_items jsonb;
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see payment confirmations.' using errcode = '42501';
  end if;
  if coalesce(p_status, 'PENDING') not in ('PENDING', 'CONFIRMED', 'RETURNED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from public.payment_requests r join public.customers c on c.id = r.customer_id
   where r.status = coalesce(p_status, 'PENDING')
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%');

  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select coalesce(r.resolved_at, r.requested_at) as sort_at,
      jsonb_build_object(
        'requestId', r.id, 'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'email', c.email,
        'phone', c.phone, 'whatsapp', c.whatsapp, 'city', c.city, 'notes', c.notes,
        'salesperson', (select p.full_name from public.profiles p where p.id = c.owner_id),
        'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                                from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                               where cs.customer_id = c.id), '[]'::jsonb),
        'lastConversation', (select jsonb_build_object('note', l.note, 'at', l.occurred_at)
                               from public.lead_conversations l where l.customer_id = c.id order by l.occurred_at desc, l.created_at desc limit 1),
        'status', r.status, 'agreedAmount', r.agreed_amount, 'payableAmount', c.deal_amount,
        'taxBasis', case when c.agreed_amount is null then 'INCLUSIVE' else c.agreed_tax_basis end, 'salesNote', r.sales_note,
        'sentAt', r.requested_at, 'sentBy', (select full_name from public.profiles where id = r.requested_by),
        'sentFrom', (select t.division::text from public.profiles p join public.teams t on t.id = p.team_id where p.id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note,
        'amountVerified', c.amount_verified, 'amountRecorded', c.amount_received,
        'balance', greatest(coalesce(c.deal_amount, r.agreed_amount) - c.amount_verified, 0), 'paymentStatus', c.payment_status,
        'stage', c.lifecycle_stage,
        'journey', private.customer_journey(c.id),
        'clientLogin', case when exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id) then 'CREATED'
                            else coalesce((select pr.status from public.customer_client_provisioning pr where pr.customer_id = c.id), 'NOT_STARTED') end) as row_json
      from public.payment_requests r join public.customers c on c.id = r.customer_id
     where r.status = coalesce(p_status, 'PENDING')
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
     order by coalesce(r.resolved_at, r.requested_at) desc
     limit v_size offset (v_page - 1) * v_size
  ) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_payment_requests(text, text, integer, integer) from public, anon;
grant execute on function public.accounts_payment_requests(text, text, integer, integer) to authenticated;

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
    select coalesce(jsonb_agg(jsonb_build_object('serviceCode', s.code, 'particulars', s.name, 'hsnSac', '998313', 'taxRate', 18,
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
        -- the amounts are before GST: spread the balance with its GST (at the rate of the lines), so the bases add up to the balance
        v_lines := private.spread_invoice_total(v_lines, round(v_left_net * 1.18, 2));
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
    'addonTotal', r.total,
    'existingInvoices', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'number', x.invoice_number, 'kind', x.kind, 'status', x.status, 'total', x.amount)
                                    order by x.created_at desc)
                                   from (select * from public.member_invoices i where i.customer_id = c.id and i.kind <> 'MANUAL'
                                          order by i.created_at desc limit 10) x), '[]'::jsonb),
    'catalog', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category) order by s.sort_order, s.name)
                           from public.crm_services s where s.is_active), '[]'::jsonb),
    'warnings', v_warnings);
end $$;
revoke all on function public.accounts_invoice_prefill(uuid, text, uuid) from public, anon;
grant execute on function public.accounts_invoice_prefill(uuid, text, uuid) to authenticated;
