-- =============================================================================
-- The 2 migrations of "a paid invoice for each payment" and the invoice WhatsApp through the Automation Builder, in order.
-- Paste the whole file into the Supabase SQL editor and run it once. Every part is safe to run again.
-- Needs the earlier migrations (20261129000100_invoice_whatsapp.sql and 20261201000100_order_level_gst.sql) to be in place already.
-- =============================================================================

-- =============================================================================
-- A paid invoice for each payment.
--
-- What was wrong
--   Accounts could issue a second invoice only for the part of the agreed amount that no earlier invoice covered. The first invoice
--   usually took the whole agreed amount, so when the customer then paid in two parts there was nothing left to invoice and no invoice
--   could be made for the second payment ("Create Invoice" opened with no amount and the save was refused).
--
-- The rule now
--   Every verified payment of the agreed services can have its own PAID invoice for exactly that payment: the invoice total is the money
--   received (to within a paisa, never more), GST at the order's rate, dated the day of the payment, marked paid by that payment, and then
--   delivered like any paid invoice (PDF, e-mail, WhatsApp). One payment, one invoice (payment_invoices). The invoices of an order may
--   together never be worth more than the money that was verified: an invoice for a payment is refused when earlier invoices already cover
--   that money (a manual invoice for the whole agreed amount made before the payments, for example).
--   The older way is unchanged: Accounts can still create an invoice by hand and confirm its payment.
--
-- Safe to run again. Run after 20261201000100_order_level_gst.sql.
-- =============================================================================

-- 1. Which payment an invoice documents (the invoice tables themselves stay as they are: an issued invoice cannot be edited)
create table if not exists public.payment_invoices (
  payment_id uuid primary key references public.customer_payments (id) on delete restrict,
  invoice_id uuid not null unique references public.member_invoices (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create index if not exists payment_invoices_customer_idx on public.payment_invoices (customer_id);
alter table public.payment_invoices enable row level security;
revoke all on public.payment_invoices from public, anon, authenticated;

-- 2. The cap on an order's invoices: unchanged, except that an invoice made for a payment is measured against the money received
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
    if current_setting('amuwa.payment_invoice', true) = 'on' then
      -- an invoice for one payment: all the invoices together may not be worth more than the money that was verified
      if v_gross + new.total_amount > coalesce(c.amount_verified, 0) then
        raise exception 'CONFLICT: The money of this payment is already covered by the invoices issued so far (%). There is nothing more to invoice for it.',
          private.rupees(v_gross) using errcode = 'P0001';
      end if;
    elsif c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE' then
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

-- 3. Issue the paid invoice of one verified payment (idempotent: asking again returns the same invoice)
create or replace function public.accounts_issue_payment_invoice(p_payment uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pay public.customer_payments;
  c public.customers;
  inv public.member_invoices;
  existing uuid;
  pre jsonb;
  v_rate numeric;
  v_base numeric;
  v_date date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_part text;
  v_payload jsonb;
  v_res jsonb;
  v_paid_on date;
  v_cust jsonb;
  v_treat text;
  prev public.generated_invoices;
begin
  perform private.require_accounts_staff();
  select * into pay from public.customer_payments where id = p_payment;
  if pay.id is null or not private.accounts_can_invoice(pay.customer_id) then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  -- one customer at a time (the same lock the invoice function takes), then a repeated request finds the invoice that was made
  select * into c from public.customers where id = pay.customer_id for update;
  select pi.invoice_id into existing from public.payment_invoices pi where pi.payment_id = pay.id;
  if existing is not null then
    select * into inv from public.member_invoices where id = existing;
    return private.invoice_json(inv) || jsonb_build_object('replayed', true);
  end if;
  select * into pay from public.customer_payments where id = p_payment;
  if pay.status <> 'VERIFIED' then
    raise exception 'CONFLICT: Verify the payment first. The paid invoice is made for a verified payment.' using errcode = 'P0001';
  end if;
  if coalesce(c.deal_amount, 0) <= 0 then
    raise exception 'CONFLICT: This customer has no agreed amount, so no invoice can be made for the payment.' using errcode = 'P0001';
  end if;

  -- the order's GST rate (an agreement that excludes GST has it chosen once by Accounts; an older one that includes GST used 18%)
  if c.agreed_amount is not null and c.agreed_tax_basis = 'EXCLUSIVE' then
    v_rate := c.order_gst_rate;
    if v_rate is null then
      raise exception 'VALIDATION_ERROR: Choose the GST rate for this order first (on the Payment confirmation page). The invoice uses it.' using errcode = 'P0001';
    end if;
  else
    v_rate := 18;
  end if;
  -- the invoice is worth the money received, or as near below it as paise rounding allows
  v_base := private.invoice_base_for_total(pay.amount, v_rate);
  if v_base is null or v_base <= 0 then
    raise exception 'VALIDATION_ERROR: This payment is too small to invoice.' using errcode = 'P0001';
  end if;

  -- the customer's billing details, as the invoice form would fill them in
  pre := public.accounts_invoice_prefill(c.id, 'SERVICES');
  v_cust := pre -> 'customer';
  v_treat := pre ->> 'taxTreatment';
  -- what the customer record lacks, the customer's own last invoice supplies (the same billing details, nothing invented)
  if nullif(btrim(coalesce(v_cust ->> 'address', '')), '') is null or v_treat is null then
    select * into prev from public.generated_invoices g where g.customer_id = c.id order by g.issued_at desc limit 1;
    if prev.invoice_id is not null then
      if nullif(btrim(coalesce(v_cust ->> 'address', '')), '') is null then
        v_cust := v_cust || jsonb_build_object('address', prev.business_address, 'stateCode', prev.customer_state_code, 'state', prev.customer_state);
        v_treat := prev.tax_treatment;
      elsif v_treat is null then
        v_cust := v_cust || jsonb_build_object('stateCode', prev.customer_state_code, 'state', prev.customer_state);
        v_treat := prev.tax_treatment;
      end if;
    end if;
  end if;
  select string_agg(distinct l ->> 'particulars', ', ') into v_part from jsonb_array_elements(coalesce(pre -> 'lines', '[]'::jsonb)) l;
  v_part := coalesce(nullif(btrim(v_part), ''), 'Services');
  if pay.payment_type = 'PART' then
    v_part := left(v_part, 470) || ' - part payment';
  else
    v_part := left(v_part, 500);
  end if;
  v_date := least(greatest((pay.paid_at at time zone 'Asia/Kolkata')::date, date '2017-07-01'), v_today);
  v_payload := jsonb_build_object(
    'customerId', c.id, 'purpose', 'SERVICES', 'invoiceDate', v_date::text,
    'orderNumber', pre ->> 'orderNumber', 'terms', pre ->> 'terms',
    'taxTreatment', v_treat,
    'customer', v_cust,
    'lines', jsonb_build_array(jsonb_build_object('particulars', v_part, 'hsnSac', '998313', 'quantity', '1 Nos', 'serviceCode', null,
                                                  'baseAmount', v_base, 'taxRate', v_rate)));

  -- the invoice function does the checks and the saving; the flag tells the cap to measure it against the money received
  perform set_config('amuwa.payment_invoice', 'on', true);
  begin
    v_res := public.accounts_issue_invoice(p_payment, v_payload);
  exception when others then
    perform set_config('amuwa.payment_invoice', 'off', true);
    raise;
  end;
  perform set_config('amuwa.payment_invoice', 'off', true);
  select * into inv from public.member_invoices where id = (v_res ->> 'id')::uuid;
  insert into public.payment_invoices (payment_id, invoice_id, customer_id, created_by) values (pay.id, inv.id, c.id, (select private.my_id()));

  -- paid by that payment: the paid stage (PDF, e-mail, WhatsApp) follows
  v_paid_on := (pay.paid_at at time zone 'Asia/Kolkata')::date;
  update public.member_invoices set status = 'Paid', paid_at = coalesce(paid_at, now()), status_source = 'MANUAL' where id = inv.id returning * into inv;
  update public.generated_invoices
     set payment_method = pay.method, payment_reference = pay.reference,
         payment_note = 'Paid invoice for the payment received on ' || to_char(v_paid_on, 'DD Mon YYYY'),
         payment_paid_on = v_date, paid_order_confirmed = c.amount_verified
   where invoice_id = inv.id;
  perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_CONFIRMED', format('Paid invoice %s made for the payment of %s', inv.invoice_number, private.rupees(pay.amount)));
  perform private.write_audit('INVOICE_PAYMENT_CONFIRMED', 'invoice', inv.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'total', inv.amount, 'payment_id', pay.id, 'method', pay.method, 'ledger', 'CUSTOMER'));
  perform private.notify(c.owner_id, 'INVOICE_PAID', format('Paid invoice: %s', coalesce(c.company, c.name)),
    format('Accounts made the paid invoice %s (%s) for a payment of %s.', inv.invoice_number, private.rupees(inv.amount), private.rupees(pay.amount)), 'customer', c.id);
  select * into inv from public.member_invoices where id = inv.id;
  return private.invoice_json(inv) || jsonb_build_object('replayed', false);
end $$;
revoke all on function public.accounts_issue_payment_invoice(uuid) from public, anon;
grant execute on function public.accounts_issue_payment_invoice(uuid) to authenticated;

-- 4. The payments list shows which payment has which invoice
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
        'verifiedBy', (select full_name from public.profiles where id = p.verified_by), 'verifiedAt', p.verified_at,
        'invoice', case when v_accounts then (select jsonb_build_object('id', m.id, 'number', m.invoice_number, 'paid', m.status = 'Paid')
                                               from public.payment_invoices pi join public.member_invoices m on m.id = pi.invoice_id where pi.payment_id = p.id) end)
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

notify pgrst, 'reload schema';

-- =============================================================================
-- Paid invoice on WhatsApp through the WhatsApp Automation Builder webhook (the one the onboarding messages already use).
--
-- The claim function knew two modes: dry_run and live. Live hands a dispatch over only when the invoice WhatsApp settings carry an approved
-- provider template (a Wabastore rule). The Automation Builder keeps its templates on its own side, so there is nothing to approve here:
-- the new mode live_hook is "live" without the template rule. Everything else (the switch, the number check, the lease, the retry of a
-- result that was never recorded) is exactly as in live.
--
-- Safe to run again. Run after 20261129000100_invoice_whatsapp.sql.
-- =============================================================================

create or replace function public.invoice_whatsapp_claim(p_limit integer default 5, p_mode text default 'dry_run', p_lease_seconds integer default 300, p_now timestamptz default null, p_dispatch uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s public.invoice_whatsapp_settings;
  d public.invoice_whatsapp_dispatches;
  g public.generated_invoices;
  v_ids uuid[] := '{}';
  v_why text;
  v_phone text;
begin
  if p_mode not in ('dry_run', 'live', 'live_hook') then
    raise exception 'VALIDATION_ERROR: Unknown mode.' using errcode = 'P0001';
  end if;
  select * into s from public.invoice_whatsapp_settings where id;

  -- A live attempt whose result was never recorded (the server stopped) is not repeated: it might have been sent.
  update public.invoice_whatsapp_dispatches
     set status = case when p_mode in ('live', 'live_hook') then 'FAILED' else 'PENDING' end,
         detail = case when p_mode in ('live', 'live_hook') then 'The result of the last attempt was not recorded (the server stopped). It was not repeated so the customer is not sent it twice; check the provider and use "Send again".' else detail end,
         failed_at = case when p_mode in ('live', 'live_hook') then v_now else failed_at end, locked_until = null, updated_at = v_now
   where status = 'PROCESSING' and locked_until < v_now;

  for d in
    select * from public.invoice_whatsapp_dispatches x
     where x.status in ('PENDING', 'RETRY') and x.next_attempt_at <= v_now and (p_dispatch is null or x.id = p_dispatch)
     order by x.next_attempt_at, x.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 20))
     for update skip locked
  loop
    select * into g from public.generated_invoices where invoice_id = d.invoice_id;
    v_phone := private.invoice_wa_number(d.customer_id);
    v_why := case
      when g.lifecycle <> 'PAID' or g.paid_pdf_status <> 'STORED' then 'The paid invoice is not ready.'
      when v_phone is null then 'The customer has no valid WhatsApp or mobile number any more.'
      when d.dedupe_key <> format('INVWA|%s|PAID|%s', g.invoice_id, v_phone) then 'The customer''s number changed after this was requested. Send it again to the new number.'
      when not s.enabled then 'Invoice WhatsApp was switched off.'
    end;
    if v_why is not null then
      update public.invoice_whatsapp_dispatches set status = 'SKIPPED', detail = v_why, locked_until = null, updated_at = v_now where id = d.id;
      perform private.invoice_wa_log(d.id, 'SKIPPED', d.attempts, null, v_why);
      continue;
    end if;
    if p_mode = 'live' and (not s.template_approved or s.template_name is null) then
      continue; -- waits until the template is approved
    end if;
    update public.invoice_whatsapp_dispatches set status = 'PROCESSING', attempts = d.attempts + 1, locked_until = v_now + make_interval(secs => greatest(30, coalesce(p_lease_seconds, 300))), updated_at = v_now
     where id = d.id;
    perform private.invoice_wa_log(d.id, 'ATTEMPT', d.attempts + 1, null, 'Claimed (' || p_mode || ')');
    v_ids := v_ids || d.id;
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'attempts', x.attempts, 'invoiceId', g2.invoice_id, 'customerId', g2.customer_id, 'number', g2.invoice_number, 'invoiceDate', g2.invoice_date,
             'total', g2.total_amount, 'customerName', coalesce(nullif(btrim(g2.business_name), ''), g2.customer_name),
             'to', '+91' || private.invoice_wa_number(x.customer_id),
             'file', jsonb_build_object('provider', g2.paid_storage_provider, 'bucket', g2.paid_storage_bucket, 'path', g2.paid_storage_path,
                                        'sizeBytes', g2.paid_size_bytes, 'etag', g2.paid_storage_etag),
             'template', jsonb_build_object('name', s.template_name, 'language', s.template_language, 'approved', s.template_approved)) order by x.created_at)
      from public.invoice_whatsapp_dispatches x join public.generated_invoices g2 on g2.invoice_id = x.invoice_id
     where x.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.invoice_whatsapp_claim(integer, text, integer, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.invoice_whatsapp_claim(integer, text, integer, timestamptz, uuid) to service_role;

notify pgrst, 'reload schema';
