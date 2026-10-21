-- Paid invoices only, and GST is Accounts' decision.
--
--  1. Sales no longer decides anything about GST. Send to Accounts records the agreed amount only (the basis argument is kept for
--     older callers and ignored). The system never adds GST by itself: the invoice form starts with no GST rate, Accounts chooses it
--     for every line, and the order's total payable is the agreed amount until invoices exist, then the invoices' own totals (with the
--     GST Accounts chose) plus whatever of the agreed amount is not invoiced yet (without GST). Orders made earlier are recalculated
--     the same way below (their invoices are not touched).
--  2. No unpaid invoice is made or sent: saving an invoice creates no PDF and sends no e-mail. "Confirm Payment & Send Paid Invoice"
--     creates the paid invoice (PAID stamp) and e-mails it - also when the confirmed payments cover only part of the order; what is
--     still outstanding stays on the order. A paid invoice needs money that no earlier paid invoice used. (Invoices made before this
--     migration keep their unpaid file; paid_only marks the new ones.)
--
-- Run after 20261111000100_ticket_attachments.sql (safe to run again).

alter table public.generated_invoices add column if not exists paid_only boolean not null default false;
alter table public.generated_invoices alter column paid_only set default true;
-- the confirmed payments of the order at the moment the paid invoice was made
alter table public.generated_invoices add column if not exists paid_order_confirmed numeric(14, 2);

-- An issued invoice stays fixed; only the delivery / payment columns change - now also the order's confirmed amount at the time it was paid
create or replace function private.tg_generated_invoice_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_open text[] := array['lifecycle', 'payment_confirmed_at', 'payment_confirmed_by', 'payment_method', 'payment_reference', 'payment_note',
    'payment_paid_on', 'updated_at', 'unpaid_pdf_status', 'unpaid_pdf_error', 'unpaid_storage_provider', 'unpaid_storage_bucket',
    'unpaid_storage_path', 'unpaid_storage_ref', 'unpaid_storage_etag', 'unpaid_size_bytes', 'unpaid_stored_at', 'unpaid_email_status',
    'unpaid_email_to', 'unpaid_email_sent_at', 'unpaid_email_error', 'unpaid_email_attempts', 'unpaid_email_message_id', 'unpaid_work_until',
    'paid_pdf_status', 'paid_pdf_error', 'paid_storage_provider', 'paid_storage_bucket', 'paid_storage_path', 'paid_storage_ref',
    'paid_storage_etag', 'paid_size_bytes', 'paid_stored_at', 'paid_email_status', 'paid_email_to', 'paid_email_sent_at', 'paid_email_error',
    'paid_email_attempts', 'paid_email_message_id', 'paid_work_until', 'payment_ledger', 'paid_order_confirmed'];
begin
  if tg_op = 'DELETE' then
    raise exception 'CONFLICT: An issued invoice cannot be deleted.' using errcode = 'P0001';
  end if;
  if (to_jsonb(old) - v_open) is distinct from (to_jsonb(new) - v_open) then
    raise exception 'CONFLICT: An issued invoice cannot be edited. Its number, customer, lines, tax and amounts are fixed.' using errcode = 'P0001';
  end if;
  if old.payment_ledger is not null and new.payment_ledger is distinct from old.payment_ledger then
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

-- The invoice details, now saying whether the invoice is paid-only
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


-- The total payable of an order (agreed amount, GST decided by Accounts): the invoices' totals plus the agreed amount not invoiced yet.
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
  -- no GST is assumed for the part that is not invoiced yet: Accounts decides it when it makes that invoice
  v_new := round(v_gross + greatest(c.agreed_amount - v_net, 0), 2);
  -- never below what has already been received
  v_new := greatest(v_new, c.amount_received);
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

create or replace function public.accounts_invoice_claim(p_invoice uuid, p_stage text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := upper(coalesce(p_stage, ''));
  g public.generated_invoices;
  inv public.member_invoices;
  c public.customers;
  v_pdf text; v_mail text; v_until timestamptz;
  v_snapshot jsonb;
begin
  perform private.require_accounts_staff();
  if v_stage not in ('UNPAID', 'PAID') then
    raise exception 'VALIDATION_ERROR: Choose the unpaid or the paid invoice.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  if v_stage = 'PAID' and g.lifecycle <> 'PAID' then
    raise exception 'CONFLICT: Confirm the payment first.' using errcode = 'P0001';
  end if;
  if v_stage = 'UNPAID' and g.paid_only then
    raise exception 'CONFLICT: Unpaid invoices are not sent to customers. The paid invoice is created and e-mailed when the payment is confirmed.' using errcode = 'P0001';
  end if;
  v_pdf := case when v_stage = 'UNPAID' then g.unpaid_pdf_status else g.paid_pdf_status end;
  v_mail := case when v_stage = 'UNPAID' then g.unpaid_email_status else g.paid_email_status end;
  v_until := case when v_stage = 'UNPAID' then g.unpaid_work_until else g.paid_work_until end;
  select * into c from public.customers where id = g.customer_id;
  -- `stored` (where the PDF already is, when it is) lets a retry e-mail the file that was stored instead of drawing a second one.
  -- It is for Accounts only and never part of the invoice JSON other people read.
  v_snapshot := private.generated_json(g.invoice_id) || jsonb_build_object('paymentSummary', private.invoice_payment_summary(g.invoice_id), 'invoiceId', g.invoice_id, 'customerId', g.customer_id, 'issuedAt', g.issued_at, 'stage', v_stage, 'recipientEmail', c.email,
    'stored', case when v_pdf <> 'STORED' then null
                   when v_stage = 'UNPAID' then jsonb_build_object('provider', g.unpaid_storage_provider, 'bucket', g.unpaid_storage_bucket,
                                                                    'path', g.unpaid_storage_path, 'sizeBytes', g.unpaid_size_bytes, 'etag', g.unpaid_storage_etag)
                   else jsonb_build_object('provider', g.paid_storage_provider, 'bucket', g.paid_storage_bucket,
                                           'path', g.paid_storage_path, 'sizeBytes', g.paid_size_bytes, 'etag', g.paid_storage_etag) end);

  if v_pdf = 'STORED' and v_mail = 'SENT' then
    return jsonb_build_object('claimed', false, 'reason', 'DONE', 'invoice', v_snapshot);
  end if;
  if v_until is not null and v_until > now() then
    return jsonb_build_object('claimed', false, 'reason', 'BUSY', 'invoice', v_snapshot);
  end if;
  if v_stage = 'UNPAID' then
    update public.generated_invoices set unpaid_work_until = now() + interval '3 minutes' where invoice_id = g.invoice_id;
  else
    update public.generated_invoices set paid_work_until = now() + interval '3 minutes' where invoice_id = g.invoice_id;
  end if;
  return jsonb_build_object('claimed', true, 'reason', null, 'invoice', v_snapshot);
end $$;
revoke all on function public.accounts_invoice_claim(uuid, text) from public, anon;
grant execute on function public.accounts_invoice_claim(uuid, text) to authenticated;

create or replace function public.accounts_confirm_invoice_payment(
  p_invoice uuid, p_method text default null, p_reference text default null, p_note text default null, p_paid_on date default null,
  p_amount numeric default null, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  g public.generated_invoices;
  c public.customers;
  r public.addon_requests;
  s jsonb;
  v_method text := upper(coalesce(nullif(btrim(p_method), ''), ''));
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_balance numeric;
  v_amount numeric;
  v_paid_on date;
  v_last_method text; v_last_ref text; v_last_on date;
  v_recorded boolean := false;
  v_threshold numeric;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null or inv.kind <> 'GENERATED' then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = inv.id for update;
  -- a repeated click or request: the payment was confirmed once already; nothing more is recorded
  if g.lifecycle = 'PAID' then
    return private.invoice_json(inv) || jsonb_build_object('replayed', true, 'settled', true);
  end if;
  select * into c from public.customers where id = g.customer_id for update;
  s := private.invoice_payment_summary(inv.id);
  v_balance := (s ->> 'balance')::numeric;

  if g.payment_ledger = 'INVOICE' then
    -- the same request again (a retry after a timeout): the payment is already on record
    if p_request is not null and exists (select 1 from public.invoice_payments where request_id = p_request) then
      s := private.invoice_payment_summary(inv.id);
      v_balance := (s ->> 'balance')::numeric;
    elsif v_balance > 0 or p_amount is not null then
      v_amount := coalesce(p_amount, v_balance);
      if v_amount <= 0 or v_amount <> round(v_amount, 2) then
        raise exception 'VALIDATION_ERROR: Enter the amount received in rupees (more than zero, up to 2 decimals).' using errcode = 'P0001';
      end if;
      if v_amount > v_balance then
        raise exception 'VALIDATION_ERROR: The amount is more than the balance of this invoice (%).', private.rupees(v_balance) using errcode = 'P0001';
      end if;
      if v_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
        raise exception 'VALIDATION_ERROR: Choose how the payment was received.' using errcode = 'P0001';
      end if;
      if v_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and v_ref is null then
        raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
      end if;
      v_paid_on := coalesce(p_paid_on, v_today);
      if v_paid_on > v_today or v_paid_on < g.invoice_date then
        raise exception 'VALIDATION_ERROR: The payment date cannot be in the future or before the invoice date.' using errcode = 'P0001';
      end if;
      begin
        insert into public.invoice_payments (invoice_id, customer_id, request_id, payment_type, amount, method, reference, paid_on, note, recorded_by)
        values (inv.id, g.customer_id, p_request, case when v_amount = v_balance then 'FULL' else 'PART' end, v_amount, v_method, v_ref,
                v_paid_on, v_note, (select private.my_id()));
      exception when unique_violation then
        raise exception 'CONFLICT: A payment with this reference is already recorded for this invoice.' using errcode = 'P0001';
      end;
      v_recorded := true;
      s := private.invoice_payment_summary(inv.id);
      v_balance := (s ->> 'balance')::numeric;
      perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_RECORDED',
        format('%s received for invoice %s (balance %s)', private.rupees(v_amount), inv.invoice_number, private.rupees(v_balance)));
      perform private.write_audit('INVOICE_PAYMENT_RECORDED', 'invoice', inv.id, c.department_id, c.team_id,
        jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'amount', v_amount, 'balance', v_balance, 'method', v_method, 'reference', v_ref));
    end if;
  elsif p_amount is not null then
    raise exception 'CONFLICT: The payments of this invoice are recorded in Payments (or Business Verification for an add-on). Record and verify them there, then confirm here.' using errcode = 'P0001';
  end if;

  if g.payment_ledger = 'CUSTOMER' then
    -- The agreed services: the paid invoice (with the PAID stamp) can be sent as soon as a payment of the order is verified, also
    -- when it covers only part of the order. What is still outstanding stays on the order (Payments). Each paid invoice needs
    -- money that no earlier paid invoice already used.
    select greatest(coalesce(max(o.paid_order_confirmed), 0), coalesce(sum(o.total_amount) filter (where o.paid_order_confirmed is null), 0))
      into v_threshold
      from public.generated_invoices o
     where o.customer_id = g.customer_id and o.payment_ledger = 'CUSTOMER' and o.lifecycle = 'PAID' and o.invoice_id <> g.invoice_id;
    if coalesce(c.amount_verified, 0) <= 0 then
      raise exception 'CONFLICT: No payment is confirmed yet. Record and verify the payment in Payments, then confirm it here.' using errcode = 'P0001';
    elsif c.amount_verified <= v_threshold then
      raise exception 'CONFLICT: The confirmed payments (%) are already covered by the paid invoices. Record and verify the new payment in Payments first.', private.rupees(c.amount_verified) using errcode = 'P0001';
    end if;
  elsif v_balance > 0 then
    if g.payment_ledger <> 'INVOICE' then
      raise exception 'CONFLICT: % of % is confirmed. Record and verify the remaining % in %, then confirm the payment here.',
        private.rupees((s ->> 'confirmed')::numeric), private.rupees(g.total_amount), private.rupees(v_balance),
        case when g.payment_ledger = 'ADDON' then 'Business Verification' else 'Payments' end using errcode = 'P0001';
    end if;
    -- a part payment: recorded, the invoice stays open with its balance
    perform private.notify(c.owner_id, 'INVOICE_PART_PAYMENT', format('Part payment: %s', coalesce(c.company, c.name)),
      format('%s received for invoice %s. Balance %s.', private.rupees(v_amount), inv.invoice_number, private.rupees(v_balance)), 'customer', c.id);
    select * into inv from public.member_invoices where id = p_invoice;
    return private.invoice_json(inv) || jsonb_build_object('replayed', not v_recorded, 'settled', false);
  end if;

  -- fully covered: mark paid and open the paid stage
  if inv.addon_request_id is not null then
    select * into r from public.addon_requests where id = inv.addon_request_id for update;
    if r.status = 'INVOICE_GENERATED' then
      perform public.accounts_confirm_addon_payment(r.id, v_note);
    end if;
    select * into inv from public.member_invoices where id = p_invoice;
    if inv.status <> 'Paid' then
      raise exception 'CONFLICT: The add-on payment is not confirmed yet.' using errcode = 'P0001';
    end if;
  else
    update public.member_invoices
       set status = 'Paid', paid_at = coalesce(paid_at, now()), status_source = 'MANUAL'
     where id = inv.id returning * into inv;
  end if;
  -- how the (last) payment was made, for the paid invoice: Accounts' entry, or the last verified payment on record
  if v_method = '' or not v_recorded then
    select pay.method, pay.reference, pay.paid_on into v_last_method, v_last_ref, v_last_on from (
      select method, reference, paid_at::date as paid_on, recorded_at from public.customer_payments where g.payment_ledger = 'CUSTOMER' and customer_id = g.customer_id and status = 'VERIFIED'
      union all
      select method, reference, paid_at::date, recorded_at from public.addon_payments where g.payment_ledger = 'ADDON' and request_id = inv.addon_request_id and status = 'VERIFIED'
      union all
      select method, reference, paid_on, recorded_at from public.invoice_payments where g.payment_ledger = 'INVOICE' and invoice_id = inv.id and status = 'VERIFIED'
      order by recorded_at desc limit 1) pay;
  end if;
  update public.generated_invoices
     set payment_method = coalesce(nullif(v_method, ''), v_last_method), payment_reference = coalesce(v_ref, v_last_ref), payment_note = v_note,
         payment_paid_on = coalesce(p_paid_on, v_last_on, v_today),
         paid_order_confirmed = case when g.payment_ledger = 'CUSTOMER' then c.amount_verified end
   where invoice_id = g.invoice_id;
  perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_CONFIRMED', format('Payment of invoice %s confirmed by Accounts', inv.invoice_number));
  perform private.write_audit('INVOICE_PAYMENT_CONFIRMED', 'invoice', inv.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'total', inv.amount, 'method', v_method, 'reference', v_ref, 'ledger', g.payment_ledger));
  perform private.notify(c.owner_id, 'INVOICE_PAID', format('Payment confirmed: %s', coalesce(c.company, c.name)),
    format('Accounts confirmed the payment of invoice %s (%s).', inv.invoice_number, private.rupees(inv.amount)), 'customer', c.id);
  select * into inv from public.member_invoices where id = p_invoice;
  return private.invoice_json(inv) || jsonb_build_object('replayed', false, 'settled', true);
end $$;
revoke all on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date, numeric, uuid) from public, anon;
grant execute on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date, numeric, uuid) to authenticated;

-- Sales: Send to Accounts records the agreed amount only
create or replace function public.send_lead_to_accounts(p_customer uuid, p_amount numeric, p_note text default null, p_tax_basis text default 'INCLUSIVE')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_basis text := 'EXCLUSIVE'; -- Sales never decides about GST: Accounts adds it, line by line, when it makes the invoice (p_tax_basis is ignored)
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
  -- deal_amount is what the customer has to pay in total: the agreed amount until Accounts invoices it, then the invoices' own totals
  -- (with the GST Accounts chose). Every payment, balance and status rule keeps reading it. agreed_amount keeps what Sales agreed.
  update public.customers
     set payment_workflow = 'PENDING_PAYMENT_CONFIRMATION', deal_amount = p_amount, agreed_amount = p_amount, agreed_tax_basis = v_basis,
         lead_status = 'READY_TO_BUY'
   where id = p_customer;
  perform private.sync_order_payable(p_customer);
  select deal_amount into v_payable from public.customers where id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_ACCOUNTS',
    format('Sent to Accounts for payment confirmation (agreed %s)', private.rupees(p_amount)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('PAYMENT_SENT_TO_ACCOUNTS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', v_request, 'agreed_amount', p_amount, 'tax_basis', v_basis, 'payable', v_payable, 'note', v_note));
  perform private.notify_accounts('PAYMENT_CONFIRMATION_REQUESTED', format('Confirm payment: %s', coalesce(v.company, v.name)),
    format('Sales sent a customer for payment confirmation (agreed %s).', private.rupees(p_amount)), p_customer);
  return v_request;
end $$;
revoke all on function public.send_lead_to_accounts(uuid, numeric, text, text) from public, anon;
grant execute on function public.send_lead_to_accounts(uuid, numeric, text, text) to authenticated;

-- Accounts: the invoice form starts without a GST rate
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
    if v_excl then
      -- the GST rate is Accounts' decision, line by line
      select coalesce(jsonb_agg((l.line - 'taxRate') || jsonb_build_object('taxRate', null) order by l.ord), '[]'::jsonb) into v_lines
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

-- Orders made before this migration carried an estimated 18% GST on the part not invoiced yet: recalculate them (invoices untouched).
do $$
declare r record;
begin
  for r in select id from public.customers where agreed_amount is not null and agreed_tax_basis = 'EXCLUSIVE' loop
    perform private.sync_order_payable(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
