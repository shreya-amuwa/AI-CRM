-- Paste this whole file into the Supabase SQL editor and run it once (safe to run again).
-- A paid invoice for each payment: billing details asked once (no more "Enter the business address." dead end), cancelling an invoice made by mistake
-- (so each payment can be invoiced), and invoice WhatsApp switched on by default. Needs the migrations up to 20261206 applied already.
-- It changes no payment, invoice or total, and sends nothing. A cancellation happens only when an Accounts team lead / head does it in the app.

-- ===== 20261207000100_payment_invoice_billing_cancel_whatsapp_on.sql =====
-- =============================================================================
-- Paid invoice for each payment: billing details, cancelling a wrong invoice, invoice WhatsApp on by default.
--
-- What was wrong (found by reproducing it on a customer without an address)
--   1. "Generate invoice" on a payment built the invoice from the customer record. A customer without a billing address or state (a lead
--      made quickly) got "Enter the business address." and there was nowhere on the payment to enter it. Accounts then used "Create Invoice",
--      typed the address and made ONE invoice for the whole agreed amount. That invoice covers the money of every payment, so the next
--      "Generate invoice" was refused ("The money of this payment is already covered by the invoices issued so far").
--   2. An issued invoice cannot be edited or deleted, and there was no way to cancel one, so a wrongly made invoice blocked the payments
--      for good.
--   3. Invoice WhatsApp started switched off (and automatic sending off), so it had to be switched on by hand.
--
-- What changes
--   * accounts_payment_invoice_billing(payment): the billing details the invoice would use and which of them are missing.
--   * accounts_issue_payment_invoice_billed(payment, customer): the same function (accounts_issue_payment_invoice(payment) now calls it), with the missing details (address, state, GSTIN ...) supplied
--     together with the click. The customer record is not changed; the details go on the invoice (and the customer's later invoices find
--     them there).
--   * accounts_cancel_invoice(invoice, reason): an Accounts team lead / head (or the Super Admin) cancels an invoice of the agreed services.
--     The invoice, its files and its history stay; it is marked Cancelled, leaves the order's totals and the invoice cap, and the payment
--     it was made for can be invoiced again. Payments are not touched. Audited.
--   * A cancelled invoice is marked in the invoice details (generated_json) and is not listed for the customer (client_invoices).
--   * Invoice WhatsApp: switched on, with automatic sending, unless a person already changed the settings.
--
-- Safe to run again. Run after 20261206000400. Nothing is sent and no payment, invoice or total is changed by running it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Cancelling an invoice: storage, the rules that must still hold, the status
-- ---------------------------------------------------------------------------
alter table public.generated_invoices
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references public.profiles (id) on delete set null,
  add column if not exists cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500);

alter table public.generated_invoices drop constraint if exists generated_invoices_payment_ledger_check;
alter table public.generated_invoices add constraint generated_invoices_payment_ledger_check check (payment_ledger in ('CUSTOMER', 'ADDON', 'INVOICE', 'CANCELLED'));
alter table public.member_invoices drop constraint if exists member_invoices_status_check;
alter table public.member_invoices add constraint member_invoices_status_check check (status in ('Paid', 'Pending', 'Overdue', 'Cancelled'));

-- The issued snapshot still never changes. Only the cancel marks may be written, once, and only together with the ledger leaving the order.
create or replace function private.tg_generated_invoice_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_open text[] := array['lifecycle', 'payment_confirmed_at', 'payment_confirmed_by', 'payment_method', 'payment_reference', 'payment_note',
    'payment_paid_on', 'paid_order_confirmed', 'updated_at', 'unpaid_pdf_status', 'unpaid_pdf_error', 'unpaid_storage_provider', 'unpaid_storage_bucket',
    'unpaid_storage_path', 'unpaid_storage_ref', 'unpaid_storage_etag', 'unpaid_size_bytes', 'unpaid_stored_at', 'unpaid_email_status',
    'unpaid_email_to', 'unpaid_email_sent_at', 'unpaid_email_error', 'unpaid_email_attempts', 'unpaid_email_message_id', 'unpaid_work_until',
    'paid_pdf_status', 'paid_pdf_error', 'paid_storage_provider', 'paid_storage_bucket', 'paid_storage_path', 'paid_storage_ref',
    'paid_storage_etag', 'paid_size_bytes', 'paid_stored_at', 'paid_email_status', 'paid_email_to', 'paid_email_sent_at', 'paid_email_error',
    'paid_email_attempts', 'paid_email_message_id', 'paid_work_until', 'payment_ledger', 'cancelled_at', 'cancelled_by', 'cancel_reason'];
begin
  if tg_op = 'DELETE' then
    raise exception 'CONFLICT: An issued invoice cannot be deleted.' using errcode = 'P0001';
  end if;
  if (to_jsonb(old) - v_open) is distinct from (to_jsonb(new) - v_open) then
    raise exception 'CONFLICT: An issued invoice cannot be edited. Its number, customer, lines, tax and amounts are fixed.' using errcode = 'P0001';
  end if;
  if old.cancelled_at is not null and (new.cancelled_at is distinct from old.cancelled_at or new.cancelled_by is distinct from old.cancelled_by
                                       or new.cancel_reason is distinct from old.cancel_reason or new.payment_ledger is distinct from old.payment_ledger) then
    raise exception 'CONFLICT: A cancelled invoice cannot be changed.' using errcode = 'P0001';
  end if;
  if new.payment_ledger is distinct from old.payment_ledger
     and not (old.payment_ledger = 'CUSTOMER' and new.payment_ledger = 'CANCELLED' and old.cancelled_at is null and new.cancelled_at is not null)
     and old.payment_ledger is not null then
    raise exception 'CONFLICT: Where the payments of an issued invoice are recorded cannot be changed.' using errcode = 'P0001';
  end if;
  if old.lifecycle = 'PAID' and new.lifecycle <> 'PAID' then
    raise exception 'CONFLICT: A confirmed payment cannot be reversed here.' using errcode = 'P0001';
  end if;
  -- a stored document is never replaced by a different reference
  if old.unpaid_pdf_status = 'STORED' and (new.unpaid_storage_ref is distinct from old.unpaid_storage_ref or new.unpaid_pdf_status <> 'STORED') then
    raise exception 'CONFLICT: The stored unpaid invoice cannot be replaced.' using errcode = 'P0001';
  end if;
  if old.paid_pdf_status = 'STORED' and (new.paid_storage_ref is distinct from old.paid_storage_ref or new.paid_pdf_status <> 'STORED') then
    raise exception 'CONFLICT: The stored paid invoice cannot be replaced.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_immutable() from public, anon, authenticated;

-- The invoice row (member_invoices): a payment is never silently reversed. Paid -> Cancelled is allowed only for an invoice that carries the cancel marks.
create or replace function private.tg_member_invoice_generated_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CONFLICT: An issued invoice cannot be deleted.' using errcode = 'P0001';
  end if;
  if new.kind is distinct from old.kind or new.invoice_number is distinct from old.invoice_number
     or new.customer_id is distinct from old.customer_id or new.amount is distinct from old.amount
     or new.subtotal is distinct from old.subtotal or new.tax_total is distinct from old.tax_total
     or new.discount_total is distinct from old.discount_total or new.issue_date is distinct from old.issue_date
     or new.customer_name is distinct from old.customer_name or new.company is distinct from old.company
     or new.addon_request_id is distinct from old.addon_request_id then
    raise exception 'CONFLICT: An issued invoice cannot be edited. Its number, customer and amounts are fixed.' using errcode = 'P0001';
  end if;
  if old.status = 'Cancelled' and new.status is distinct from 'Cancelled' then
    raise exception 'CONFLICT: A cancelled invoice cannot be changed.' using errcode = 'P0001';
  end if;
  if old.status = 'Paid' and new.status is distinct from 'Paid'
     and not (new.status = 'Cancelled' and exists (select 1 from public.generated_invoices g where g.invoice_id = old.id and g.cancelled_at is not null)) then
    raise exception 'CONFLICT: A confirmed payment cannot be reversed here.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_member_invoice_generated_guard() from public, anon, authenticated;

create or replace function public.accounts_cancel_invoice(p_invoice uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  inv public.member_invoices;
  c public.customers;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_payment uuid;
begin
  perform private.require_accounts_staff();
  select * into g from public.generated_invoices where invoice_id = p_invoice;
  if g.invoice_id is null or not private.accounts_can_invoice(g.customer_id) then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if not private.is_accounts_manager() then
    raise exception 'FORBIDDEN: Only an Accounts team lead or head can cancel an invoice.' using errcode = '42501';
  end if;
  -- one customer at a time, as every invoice and payment action
  select * into c from public.customers where id = g.customer_id for update;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  select * into inv from public.member_invoices where id = p_invoice;
  if g.cancelled_at is not null then
    return private.invoice_json(inv) || jsonb_build_object('replayed', true);
  end if;
  if g.payment_ledger is distinct from 'CUSTOMER' then
    raise exception 'CONFLICT: Only an invoice of the agreed services can be cancelled here.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'VALIDATION_ERROR: Give the reason for cancelling this invoice (at least 5 characters).' using errcode = 'P0001';
  end if;

  update public.generated_invoices set payment_ledger = 'CANCELLED', cancelled_at = now(), cancelled_by = (select private.my_id()), cancel_reason = v_reason
   where invoice_id = g.invoice_id;
  update public.member_invoices set status = 'Cancelled', status_source = 'MANUAL' where id = g.invoice_id returning * into inv;
  -- the payment it was made for is free to be invoiced again
  delete from public.payment_invoices where invoice_id = g.invoice_id returning payment_id into v_payment;
  -- a message not sent yet is not sent
  update public.invoice_whatsapp_dispatches set status = 'SKIPPED', detail = 'The invoice was cancelled.', locked_until = null, updated_at = now()
   where invoice_id = g.invoice_id and status in ('PENDING', 'RETRY');
  -- the order's total follows what is still invoiced
  perform private.sync_order_payable(c.id);
  perform private.sync_payment_totals(c.id);
  perform private.log_customer_activity(c.id, 'INVOICE_CANCELLED', format('Invoice %s (%s) cancelled: %s', g.invoice_number, private.rupees(g.total_amount), v_reason));
  perform private.write_audit('INVOICE_CANCELLED', 'invoice', g.invoice_id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', g.invoice_number, 'total', g.total_amount, 'payment_id', v_payment, 'reason', v_reason));
  return private.invoice_json(inv) || jsonb_build_object('replayed', false);
end $$;
revoke all on function public.accounts_cancel_invoice(uuid, text) from public, anon;
grant execute on function public.accounts_cancel_invoice(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The billing details of a payment's invoice: what the customer record (or the customer's last invoice) supplies, what Accounts adds
-- ---------------------------------------------------------------------------
create or replace function private.payment_invoice_billing(p_customer uuid, p_pre jsonb, p_override jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_cust jsonb := coalesce(p_pre -> 'customer', '{}'::jsonb);
  v_treat text := p_pre ->> 'taxTreatment';
  o jsonb := case when p_override is not null and jsonb_typeof(p_override) = 'object' then p_override else '{}'::jsonb end;
  prev public.generated_invoices;
  k text;
  v text;
  v_state text;
  v_missing text[] := '{}';
begin
  -- what the customer record lacks, the customer's own last invoice supplies (the same billing details, nothing invented)
  if nullif(btrim(coalesce(v_cust ->> 'address', '')), '') is null or nullif(btrim(coalesce(v_cust ->> 'stateCode', '')), '') is null or v_treat is null then
    select * into prev from public.generated_invoices g where g.customer_id = p_customer and g.cancelled_at is null order by g.issued_at desc limit 1;
    if prev.invoice_id is not null then
      if nullif(btrim(coalesce(v_cust ->> 'address', '')), '') is null then
        v_cust := v_cust || jsonb_build_object('address', prev.business_address);
      end if;
      if nullif(btrim(coalesce(v_cust ->> 'stateCode', '')), '') is null or v_treat is null then
        v_cust := v_cust || jsonb_build_object('stateCode', prev.customer_state_code, 'state', prev.customer_state);
        v_treat := prev.tax_treatment;
      end if;
    end if;
  end if;
  -- what Accounts typed wins over what was found
  foreach k in array array['name', 'businessName', 'address', 'contactPerson', 'contactNumber', 'gstin', 'stateCode'] loop
    v := nullif(btrim(coalesce(o ->> k, '')), '');
    if v is not null then
      v_cust := v_cust || jsonb_build_object(k, v);
    end if;
  end loop;
  v_state := nullif(btrim(coalesce(v_cust ->> 'stateCode', '')), '');
  if v_state is not null and exists (select 1 from public.gst_states s where s.code = v_state) then
    -- the tax follows the customer's state: CGST + SGST inside the company's state, IGST outside it
    v_treat := case when v_state = private.company_state_code() then 'INTRA_STATE' else 'INTER_STATE' end;
    v_cust := v_cust || jsonb_build_object('state', (select s.name from public.gst_states s where s.code = v_state));
  else
    v_treat := null;
  end if;
  if nullif(btrim(coalesce(v_cust ->> 'address', '')), '') is null then
    v_missing := v_missing || 'address'::text;
  end if;
  if v_treat is null then
    v_missing := v_missing || 'state'::text;
  end if;
  return jsonb_build_object('customer', v_cust, 'taxTreatment', v_treat, 'missing', to_jsonb(v_missing));
end $$;
revoke all on function private.payment_invoice_billing(uuid, jsonb, jsonb) from public, anon, authenticated;

-- For the screen: before the click, what is there and what is missing
create or replace function public.accounts_payment_invoice_billing(p_payment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  pay public.customer_payments;
  pre jsonb;
begin
  perform private.require_accounts_staff();
  select * into pay from public.customer_payments where id = p_payment;
  if pay.id is null or not private.accounts_can_invoice(pay.customer_id) then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  pre := public.accounts_invoice_prefill(pay.customer_id, 'SERVICES');
  return private.payment_invoice_billing(pay.customer_id, pre, null);
end $$;
revoke all on function public.accounts_payment_invoice_billing(uuid) from public, anon;
grant execute on function public.accounts_payment_invoice_billing(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Issue the paid invoice of one verified payment (idempotent), with the billing details Accounts adds when the record lacks them
-- ---------------------------------------------------------------------------
create or replace function public.accounts_issue_payment_invoice_billed(p_payment uuid, p_customer jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  pay public.customer_payments;
  c public.customers;
  inv public.member_invoices;
  existing uuid;
  pre jsonb;
  bill jsonb;
  v_rate numeric;
  v_base numeric;
  v_date date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_part text;
  v_payload jsonb;
  v_res jsonb;
  v_paid_on date;
  v_what text;
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

  -- the customer's billing details, as the invoice form would fill them in, plus what Accounts typed with this click
  pre := public.accounts_invoice_prefill(c.id, 'SERVICES');
  bill := private.payment_invoice_billing(c.id, pre, p_customer);
  if jsonb_array_length(bill -> 'missing') > 0 then
    select string_agg(x, ' and ') into v_what from jsonb_array_elements_text(bill -> 'missing') x;
    raise exception 'VALIDATION_ERROR: The invoice needs the customer''s billing % (not on the customer record yet). Enter it and make the invoice again.', v_what
      using errcode = 'P0001';
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
    'taxTreatment', bill ->> 'taxTreatment',
    'customer', bill -> 'customer',
    'lines', jsonb_build_array(jsonb_build_object('particulars', v_part, 'hsnSac', '998313', 'quantity', '1 Nos', 'serviceCode', null,
                                                  'baseAmount', v_base, 'taxRate', v_rate)));

  -- the invoice function does the checks and the saving; the flag tells the cap to measure it against the money received
  perform set_config('amuwa.payment_invoice', 'on', true);
  begin
    -- a new request each time: a payment whose invoice was cancelled is invoiced again (the payment_invoices row is what makes a repeated click idempotent)
    v_res := public.accounts_issue_invoice(gen_random_uuid(), v_payload);
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
revoke all on function public.accounts_issue_payment_invoice_billed(uuid, jsonb) from public, anon;
grant execute on function public.accounts_issue_payment_invoice_billed(uuid, jsonb) to authenticated;

-- the one-argument function stays (callers that send no details): it is the same function with nothing added
create or replace function public.accounts_issue_payment_invoice(p_payment uuid)
returns jsonb language sql security definer set search_path = '' as $$
  select public.accounts_issue_payment_invoice_billed(p_payment, null)
$$;
revoke all on function public.accounts_issue_payment_invoice(uuid) from public, anon;
grant execute on function public.accounts_issue_payment_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. The invoice details now say whether (and why) the invoice was cancelled
-- ---------------------------------------------------------------------------
create or replace function private.generated_json(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'number', g.invoice_number, 'invoiceDate', g.invoice_date, 'orderNumber', g.order_number,
    'purpose', g.purpose, 'addonRequestId', g.addon_request_id,
    'customer', jsonb_build_object('name', g.customer_name, 'businessName', g.business_name, 'address', g.business_address,
      'contactPerson', g.contact_person, 'contactNumber', g.contact_number, 'gstin', g.customer_gstin,
      'state', g.customer_state, 'stateCode', g.customer_state_code),
    'taxTreatment', g.tax_treatment, 'taxTreatmentOverridden', g.tax_treatment_overridden, 'taxOverrideReason', g.tax_override_reason,
    'reverseCharge', g.reverse_charge, 'terms', g.terms,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('position', x.position, 'serviceCode', x.service_code, 'particulars', x.particulars,
                         'hsnSac', x.hsn_sac, 'taxRate', x.tax_rate, 'quantity', x.quantity_text, 'baseAmount', x.base_amount,
                         'gstAmount', x.gst_amount, 'totalAmount', x.total_amount) order by x.position)
                         from public.generated_invoice_items x where x.invoice_id = g.invoice_id), '[]'::jsonb),
    'totals', jsonb_build_object('subtotal', g.subtotal, 'cgstRate', g.cgst_rate, 'cgstAmount', g.cgst_amount,
      'sgstRate', g.sgst_rate, 'sgstAmount', g.sgst_amount, 'igstRate', g.igst_rate, 'igstAmount', g.igst_amount,
      'totalGst', g.total_gst, 'total', g.total_amount, 'inWords', g.amount_in_words, 'breakdown', g.tax_breakdown),
    'lifecycle', g.lifecycle, 'paidOnly', g.paid_only,
    'cancelled', case when g.cancelled_at is not null then jsonb_build_object('at', g.cancelled_at, 'by', (select full_name from public.profiles where id = g.cancelled_by), 'reason', g.cancel_reason) end,
    'paymentSummary', private.invoice_payment_summary(g.invoice_id),
    'payment', case when g.lifecycle = 'PAID' then jsonb_build_object('confirmedAt', g.payment_confirmed_at,
      'confirmedBy', (select full_name from public.profiles where id = g.payment_confirmed_by),
      'method', g.payment_method, 'reference', g.payment_reference, 'note', g.payment_note, 'paidOn', g.payment_paid_on) end,
    'unpaid', jsonb_build_object('pdfStatus', g.unpaid_pdf_status, 'pdfError', g.unpaid_pdf_error, 'sizeBytes', g.unpaid_size_bytes,
      'storedAt', g.unpaid_stored_at, 'emailStatus', g.unpaid_email_status, 'emailTo', g.unpaid_email_to, 'emailSentAt', g.unpaid_email_sent_at,
      'emailError', g.unpaid_email_error, 'emailAttempts', g.unpaid_email_attempts, 'busy', coalesce(g.unpaid_work_until > now(), false)),
    'paid', jsonb_build_object('pdfStatus', g.paid_pdf_status, 'pdfError', g.paid_pdf_error, 'sizeBytes', g.paid_size_bytes,
      'storedAt', g.paid_stored_at, 'emailStatus', g.paid_email_status, 'emailTo', g.paid_email_to, 'emailSentAt', g.paid_email_sent_at,
      'emailError', g.paid_email_error, 'emailAttempts', g.paid_email_attempts, 'busy', coalesce(g.paid_work_until > now(), false)))
  from public.generated_invoices g where g.invoice_id = p_invoice
$$;
revoke all on function private.generated_json(uuid) from public, anon, authenticated;

-- 3c. What a customer sees: a cancelled invoice is not listed (the customer's own list shows the invoices that stand)
create or replace function public.client_invoices()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'number', i.invoice_number, 'kind', i.kind,
      'issuedAt', coalesce(i.issued_at, i.created_at),
      'issueDate', nullif(i.issue_date, ''), 'dueDate', nullif(i.due_date, ''),
      'amount', i.amount, 'subtotal', i.subtotal, 'discount', i.discount_total, 'tax', i.tax_total,
      'status', i.status, 'paidAt', i.paid_at,
      -- (CASE: the cast must only run on a real date; an invoice without a due date has an empty text)
      'overdue', i.status = 'Pending' and coalesce(case when i.due_date ~ '^\d{4}-\d{2}-\d{2}$' then i.due_date::date < current_date end, false),
      'related', case when i.addon_request_id is not null then 'Add-on services' else 'Services' end,
      'items', case when g.invoice_id is not null
                    then coalesce((select jsonb_agg(jsonb_build_object('name', x.particulars, 'quantity', x.quantity_text, 'unitPrice', x.base_amount,
                                       'discount', 0, 'taxPercent', x.tax_rate, 'tax', x.gst_amount, 'lineTotal', x.total_amount) order by x.position)
                                     from public.generated_invoice_items x where x.invoice_id = g.invoice_id), '[]'::jsonb)
                    else coalesce(i.details -> 'items', '[]'::jsonb) end,
      -- a generated invoice has a file only once it is stored: the paid one after payment, the unpaid one before it
      'hasFile', case when g.invoice_id is not null then (g.paid_pdf_status = 'STORED' or (i.status <> 'Paid' and g.unpaid_pdf_status = 'STORED'))
                      else exists (select 1 from public.customer_documents d where d.invoice_id = i.id and d.status = 'UPLOADED') end,
      'generated', g.invoice_id is not null,
      'fileKind', case when g.invoice_id is null then null
                       when g.paid_pdf_status = 'STORED' then 'PAID'
                       when i.status <> 'Paid' and g.unpaid_pdf_status = 'STORED' then 'UNPAID' end,
      'paidFilePending', g.invoice_id is not null and i.status = 'Paid' and g.paid_pdf_status <> 'STORED',
      'paymentConfirmedAt', g.payment_confirmed_at,
      'taxSummary', case when g.invoice_id is not null then jsonb_build_object('cgst', g.cgst_amount, 'sgst', g.sgst_amount, 'igst', g.igst_amount) end,
      -- what has been paid and what is left, from the confirmed payments (a generated invoice only)
      'paymentSummary', case when g.invoice_id is not null then private.invoice_payment_summary(g.invoice_id) end
    ) order by coalesce(i.issued_at, i.created_at) desc)
    from public.member_invoices i
    left join public.generated_invoices g on g.invoice_id = i.id
   where i.customer_id = v_customer and i.kind <> 'MANUAL' and i.status <> 'Cancelled'
     and (g.invoice_id is null or g.unpaid_pdf_status = 'STORED' or g.paid_pdf_status = 'STORED')), '[]'::jsonb);
end $$;
revoke all on function public.client_invoices() from public, anon;
grant execute on function public.client_invoices() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Invoice WhatsApp on by default (a person's own choice, once made, is never overridden by running this again)
-- ---------------------------------------------------------------------------
alter table public.invoice_whatsapp_settings alter column enabled set default true;
alter table public.invoice_whatsapp_settings alter column auto_send set default true;
update public.invoice_whatsapp_settings set enabled = true, auto_send = true, updated_at = now() where updated_by is null and (not enabled or not auto_send);

notify pgrst, 'reload schema';
