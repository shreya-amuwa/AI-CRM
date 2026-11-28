-- Recharges, part 3: the invoice for a recharge whose payment Accounts confirmed, and sending it to the customer by e-mail and WhatsApp.
-- (Builds on 20270310000100_recharge_accounts_workflow.sql. Additive: nothing is deleted or rewritten; safe to run twice.)
--
-- WHEN. Only Accounts (and the Super Admin) generate it, and only for a recharge whose payment_status is PAYMENT_RECEIVED. Generating twice returns the invoice that exists:
-- one invoice per recharge (unique), never a second number. After the payment is confirmed it can no longer be taken back, and the billing details can no longer be corrected.
-- NUMBER. Taken inside the transaction by the existing private.take_invoice_number (the same financial-year series and counter as every other CRM invoice: GST/26-27/014 style),
-- so two requests can never get the same number and a refused invoice leaves no gap. The browser never makes or sends a number, an amount or a tax figure: the invoice is
-- built here from the recharge (amount + GST as Accounts confirmed them). The tax rate is not assumed: the GST amount is what is on the recharge; a rate is only shown as
-- the arithmetic of the two. GST invoices split it CGST + SGST (customer in the company's state) or IGST (another state) from the customer's GST number.
-- NOT THE ORDER LEDGER. These invoices are kept in their own table; they do not touch member_invoices, the customer's agreed amount, part payments or income reports.
-- DELIVERY. E-mail and WhatsApp are two separate channels, each with its own record (support_recharge_deliveries): who asked, when, the outcome, the failure, the retry. Nothing is
-- sent unless an Accounts user presses Send; an outcome is SENT only when the provider accepted it (a test-mode or switched-off server records NOT_SENT, never SENT). Sending the same
-- channel again needs an explicit "send again"; a send already in progress blocks a second click. Delivery status is kept apart from the payment status.

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.support_recharge_invoices (
  id uuid primary key default gen_random_uuid(),
  recharge_id uuid not null unique references public.support_recharges (id),
  invoice_number text not null,
  invoice_type text not null check (invoice_type in ('GST', 'NON_GST')),
  invoice_date date not null,
  customer_name text not null check (length(customer_name) between 1 and 200),
  customer_email text,
  customer_phone text,
  customer_address text not null check (length(customer_address) between 5 and 500),
  customer_gstin text,
  customer_state_code text,
  customer_state text,
  supplier_state_code text,
  tax_treatment text not null check (tax_treatment in ('INTRA_STATE', 'INTER_STATE', 'NONE')),
  particulars text not null check (length(particulars) between 2 and 500),
  hsn_sac text not null check (hsn_sac ~ '^[0-9]{4,8}$'),
  taxable_amount numeric(12, 2) not null check (taxable_amount > 0),
  gst_rate numeric(6, 2) not null default 0 check (gst_rate >= 0),
  cgst_amount numeric(12, 2) not null default 0 check (cgst_amount >= 0),
  sgst_amount numeric(12, 2) not null default 0 check (sgst_amount >= 0),
  igst_amount numeric(12, 2) not null default 0 check (igst_amount >= 0),
  total_gst numeric(12, 2) not null default 0 check (total_gst >= 0),
  total_amount numeric(12, 2) not null check (total_amount > 0),
  amount_in_words text,
  payment_reference text,
  paid_on date not null,
  terms text not null,
  generated_by uuid not null references public.profiles (id),
  generated_at timestamptz not null default now(),
  pdf_status text not null default 'PENDING' check (pdf_status in ('PENDING', 'READY', 'FAILED')),
  pdf_error text check (pdf_error is null or length(pdf_error) <= 300),
  storage_provider text check (storage_provider in ('SUPABASE', 'R2')),
  storage_bucket text,
  storage_path text,
  storage_ref text,
  storage_etag text,
  size_bytes integer,
  stored_at timestamptz,
  constraint support_recharge_invoices_tax_ck check (cgst_amount + sgst_amount + igst_amount = total_gst and total_amount = taxable_amount + total_gst
    and (invoice_type = 'GST' or total_gst = 0) and (tax_treatment <> 'INTRA_STATE' or igst_amount = 0) and (tax_treatment <> 'INTER_STATE' or (cgst_amount = 0 and sgst_amount = 0)))
);
-- a number is used once, whatever its case
create unique index if not exists support_recharge_invoices_number_uq on public.support_recharge_invoices (lower(invoice_number));
create index if not exists support_recharge_invoices_date_idx on public.support_recharge_invoices (generated_at desc);
alter table public.support_recharge_invoices enable row level security;
revoke all on public.support_recharge_invoices from public, anon, authenticated;

create table if not exists public.support_recharge_deliveries (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.support_recharge_invoices (id),
  channel text not null check (channel in ('EMAIL', 'WHATSAPP')),
  status text not null default 'SENDING' check (status in ('SENDING', 'SENT', 'NOT_SENT', 'FAILED')),
  recipient text not null,
  is_resend boolean not null default false,
  requested_by uuid not null references public.profiles (id),
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  detail text check (detail is null or length(detail) <= 300),
  provider_ref text check (provider_ref is null or length(provider_ref) <= 200)
);
create index if not exists support_recharge_deliveries_invoice_idx on public.support_recharge_deliveries (invoice_id, channel, requested_at desc);
-- one send at a time per invoice and channel (a double click, two Accounts users)
create unique index if not exists support_recharge_deliveries_inflight_uq on public.support_recharge_deliveries (invoice_id, channel) where status = 'SENDING';
alter table public.support_recharge_deliveries enable row level security;
revoke all on public.support_recharge_deliveries from public, anon, authenticated;

-- private bucket for the PDFs (no browser access: the API signs short-lived links after the database allowed it)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('recharge-invoices', 'recharge-invoices', false, 5242880, array['application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The list knows the delivery queue (Invoice delivery = sent, partly sent or failed)
-- ---------------------------------------------------------------------------
create or replace function public.recharge_list(
  p_kind text default null, p_search text default null, p_payment_status text default null, p_invoice_status text default null, p_from date default null, p_to date default null,
  p_min numeric default null, p_max numeric default null, p_rm uuid default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
  v_kind text := nullif(upper(btrim(coalesce(p_kind, ''))), '');
  v_pay text := nullif(upper(btrim(coalesce(p_payment_status, ''))), '');
  v_inv text := nullif(upper(btrim(coalesce(p_invoice_status, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
  v_sum jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team and Accounts.' using errcode = '42501';
  end if;
  -- Support works one kind at a time; Accounts and the Super Admin may look at both
  if v_kind is null and v_role not in ('ACCOUNTS', 'SUPER_ADMIN') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  if v_kind is not null and v_kind not in ('PANEL', 'MESSAGE') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  if v_pay is not null and v_pay not in ('PENDING_VERIFICATION', 'PAYMENT_RECEIVED', 'PAYMENT_NOT_RECEIVED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose a valid payment status.' using errcode = 'P0001';
  end if;
  -- 'GENERATED_ANY' = an invoice exists (whatever its delivery state); 'DELIVERY_ANY' = it was sent, partly sent or failed to send
  if v_inv is not null and v_inv not in ('NOT_GENERATED', 'GENERATED', 'SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED', 'GENERATED_ANY', 'DELIVERY_ANY') then
    raise exception 'VALIDATION_ERROR: Choose a valid invoice status.' using errcode = 'P0001';
  end if;
  if v_search is not null then
    v_search := '%' || replace(replace(replace(left(v_search, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with scoped as (
    select r.* from public.support_recharges r
     where (v_kind is null or r.kind = v_kind) and private.recharge_visible(r)
       and (v_search is null or r.customer_name ilike v_search escape '\' or coalesce(r.payment_reference, '') ilike v_search escape '\' or coalesce(r.customer_email, '') ilike v_search escape '\')
       and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
       and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
       and (p_rm is null or r.rm_id = p_rm)
  )
  select jsonb_build_object(
           'totalRecharges', count(*), 'totalAmount', coalesce(sum(total_amount), 0), 'totalGst', coalesce(sum(gst_amount), 0),
           'totalNonGst', coalesce(sum(recharge_amount) filter (where billing_type = 'NON_GST'), 0),
           'pending', count(*) filter (where payment_status = 'PENDING_VERIFICATION'), 'pendingAmount', coalesce(sum(total_amount) filter (where payment_status = 'PENDING_VERIFICATION'), 0),
           'received', count(*) filter (where payment_status = 'PAYMENT_RECEIVED'), 'receivedAmount', coalesce(sum(total_amount) filter (where payment_status = 'PAYMENT_RECEIVED'), 0),
           'notReceived', count(*) filter (where payment_status = 'PAYMENT_NOT_RECEIVED'), 'rejected', count(*) filter (where payment_status = 'REJECTED'),
           'readyForInvoice', count(*) filter (where payment_status = 'PAYMENT_RECEIVED' and invoice_status = 'NOT_GENERATED'),
           'invoiced', count(*) filter (where invoice_status <> 'NOT_GENERATED'),
           'delivered', count(*) filter (where invoice_status in ('SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT')),
           'deliveryFailed', count(*) filter (where invoice_status = 'FAILED'))
    into v_sum from scoped;

  select count(*) into v_total from public.support_recharges r
   where (v_kind is null or r.kind = v_kind) and private.recharge_visible(r)
     and (v_pay is null or r.payment_status = v_pay)
     and (v_inv is null or (v_inv = 'GENERATED_ANY' and r.invoice_status <> 'NOT_GENERATED') or (v_inv = 'DELIVERY_ANY' and r.invoice_status in ('SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED')) or r.invoice_status = v_inv)
     and (v_search is null or r.customer_name ilike v_search escape '\' or coalesce(r.payment_reference, '') ilike v_search escape '\' or coalesce(r.customer_email, '') ilike v_search escape '\')
     and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
     and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
     and (p_rm is null or r.rm_id = p_rm);

  select coalesce(jsonb_agg(private.recharge_json(x) order by x.submitted_at desc, x.created_at desc), '[]'::jsonb) into v_items
    from (select r.* from public.support_recharges r
           where (v_kind is null or r.kind = v_kind) and private.recharge_visible(r)
             and (v_pay is null or r.payment_status = v_pay)
             and (v_inv is null or (v_inv = 'GENERATED_ANY' and r.invoice_status <> 'NOT_GENERATED') or (v_inv = 'DELIVERY_ANY' and r.invoice_status in ('SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED')) or r.invoice_status = v_inv)
             and (v_search is null or r.customer_name ilike v_search escape '\' or coalesce(r.payment_reference, '') ilike v_search escape '\' or coalesce(r.customer_email, '') ilike v_search escape '\')
             and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
             and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
             and (p_rm is null or r.rm_id = p_rm)
           order by r.submitted_at desc, r.created_at desc limit v_limit offset v_offset) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset, 'summary', v_sum, 'role', v_role,
                            'canCreate', v_role in ('MEMBER', 'LEAD', 'HEAD'), 'isAccounts', v_role in ('ACCOUNTS', 'SUPER_ADMIN'));
end $$;

-- ---------------------------------------------------------------------------
-- 3. The invoice, as the database builds it (the screen shows it for review; the PDF is drawn from the stored snapshot only)
-- ---------------------------------------------------------------------------
-- what the invoice would hold, and what is missing: Accounts see this before they generate
create or replace function private.recharge_invoice_plan(r public.support_recharges, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_missing text[] := '{}';
  v_treatment text;
  v_state text;
  v_hsn text := coalesce(nullif(btrim(p ->> 'hsnSac'), ''), '998313');
  v_company text := private.company_state_code();
  v_cgst numeric := 0; v_sgst numeric := 0; v_igst numeric := 0; v_rate numeric := 0;
  v_override text := nullif(upper(btrim(coalesce(p ->> 'taxTreatment', ''))), '');
begin
  if r.customer_address is null or length(btrim(r.customer_address)) < 5 then
    v_missing := v_missing || 'the customer''s billing address'::text;
  end if;
  if r.billing_type = 'GST' then
    if r.customer_gstin is null or not private.valid_gstin(r.customer_gstin) then
      v_missing := v_missing || 'the customer''s valid GST number'::text;
    else
      v_state := left(r.customer_gstin, 2);
    end if;
    if v_override is not null and v_override not in ('INTRA_STATE', 'INTER_STATE') then
      raise exception 'VALIDATION_ERROR: Choose intra-state (CGST + SGST) or inter-state (IGST).' using errcode = 'P0001';
    end if;
    v_treatment := coalesce(v_override, case when v_state = v_company then 'INTRA_STATE' else 'INTER_STATE' end);
    if v_treatment = 'INTRA_STATE' then
      v_cgst := round(r.gst_amount / 2, 2);
      v_sgst := r.gst_amount - v_cgst;
    else
      v_igst := r.gst_amount;
    end if;
    v_rate := case when r.recharge_amount > 0 then round(r.gst_amount * 100 / r.recharge_amount, 2) else 0 end;
  else
    v_treatment := 'NONE';
  end if;
  if v_hsn !~ '^[0-9]{4,8}$' then
    raise exception 'VALIDATION_ERROR: The HSN/SAC code is 4 to 8 digits.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'invoiceType', r.billing_type, 'taxTreatment', v_treatment, 'hsnSac', v_hsn, 'customerStateCode', v_state,
    'customerState', (select s.name from public.gst_states s where s.code = v_state),
    'supplierStateCode', v_company, 'taxableAmount', r.recharge_amount, 'gstRate', v_rate, 'cgstAmount', v_cgst, 'sgstAmount', v_sgst, 'igstAmount', v_igst,
    'totalGst', r.gst_amount, 'totalAmount', r.total_amount, 'missing', to_jsonb(v_missing),
    'particulars', (case r.kind when 'PANEL' then 'Panel recharge' else 'Message recharge' end) || ' (' || (case r.kind when 'PANEL' then 'PRC-' else 'MRC-' end) || lpad(r.ref_no::text, 5, '0') || ')');
end $$;

create or replace function private.recharge_delivery_json(d public.support_recharge_deliveries, p_detail boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'channel', d.channel, 'status', d.status, 'isResend', d.is_resend, 'requestedAt', d.requested_at, 'finishedAt', d.finished_at,
    'requestedByName', (select p.full_name from public.profiles p where p.id = d.requested_by))
    || case when p_detail then jsonb_build_object('recipient', d.recipient, 'detail', d.detail) else '{}'::jsonb end
$$;

-- the invoice of a recharge as the signed-in person may see it: Accounts everything; Support the number, the date, the total and each channel's state
create or replace function private.recharge_invoice_json(i public.support_recharge_invoices)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_acc boolean := coalesce(private.recharge_role() in ('ACCOUNTS', 'SUPER_ADMIN'), false);
  v_deliveries jsonb;
begin
  select coalesce(jsonb_agg(private.recharge_delivery_json(d, v_acc) order by d.requested_at desc), '[]'::jsonb) into v_deliveries
    from public.support_recharge_deliveries d where d.invoice_id = i.id;
  return jsonb_build_object('id', i.id, 'rechargeId', i.recharge_id, 'number', i.invoice_number, 'invoiceType', i.invoice_type, 'invoiceDate', i.invoice_date, 'taxableAmount', i.taxable_amount,
    'totalGst', i.total_gst, 'totalAmount', i.total_amount, 'pdfStatus', i.pdf_status, 'generatedAt', i.generated_at, 'deliveries', v_deliveries)
    || case when v_acc then jsonb_build_object('taxTreatment', i.tax_treatment, 'hsnSac', i.hsn_sac, 'particulars', i.particulars, 'gstRate', i.gst_rate, 'cgstAmount', i.cgst_amount, 'sgstAmount', i.sgst_amount,
                                               'igstAmount', i.igst_amount, 'customerName', i.customer_name, 'customerEmail', i.customer_email, 'customerPhone', i.customer_phone, 'customerAddress', i.customer_address,
                                               'customerGstin', i.customer_gstin, 'customerState', i.customer_state, 'pdfError', i.pdf_error, 'paymentReference', i.payment_reference, 'paidOn', i.paid_on,
                                               'generatedByName', (select p.full_name from public.profiles p where p.id = i.generated_by))
            else '{}'::jsonb end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Generate (Accounts only), read, and the PDF steps
-- ---------------------------------------------------------------------------
create or replace function public.recharge_invoice_prefill(p_recharge uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
begin
  perform private.require_accounts_staff();
  select * into r from public.support_recharges where id = p_recharge;
  if r.id is null then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  return private.recharge_invoice_plan(r, p) || jsonb_build_object('paymentStatus', r.payment_status, 'invoiceStatus', r.invoice_status,
    'customerName', r.customer_name, 'customerEmail', r.customer_email, 'customerPhone', r.customer_phone, 'customerAddress', r.customer_address, 'customerGstin', r.customer_gstin);
end $$;

create or replace function public.recharge_invoice_generate(p_recharge uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  i public.support_recharge_invoices;
  v_plan jsonb;
  v_no text;
  v_date date := (now() at time zone 'Asia/Kolkata')::date;
  v_missing text;
begin
  perform private.require_accounts_staff();
  select * into r from public.support_recharges where id = p_recharge for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  -- the same recharge again: the invoice that was made (never a second number)
  select * into i from public.support_recharge_invoices where recharge_id = r.id;
  if i.id is not null then
    return private.recharge_invoice_json(i) || jsonb_build_object('replayed', true);
  end if;
  if r.payment_status <> 'PAYMENT_RECEIVED' then
    raise exception 'CONFLICT: Confirm that the payment was received first. An invoice is made only for a verified payment.' using errcode = 'P0001';
  end if;
  v_plan := private.recharge_invoice_plan(r, p);
  if jsonb_array_length(v_plan -> 'missing') > 0 then
    select string_agg(x, ' and ') into v_missing from jsonb_array_elements_text(v_plan -> 'missing') x;
    raise exception 'VALIDATION_ERROR: The invoice needs %. Correct the billing details and generate it again.', v_missing using errcode = 'P0001';
  end if;
  v_no := private.take_invoice_number(r.billing_type, v_date);
  begin
    insert into public.support_recharge_invoices (recharge_id, invoice_number, invoice_type, invoice_date, customer_name, customer_email, customer_phone, customer_address, customer_gstin,
        customer_state_code, customer_state, supplier_state_code, tax_treatment, particulars, hsn_sac, taxable_amount, gst_rate, cgst_amount, sgst_amount, igst_amount, total_gst, total_amount,
        amount_in_words, payment_reference, paid_on, terms, generated_by)
    values (r.id, v_no, r.billing_type, v_date, r.customer_name, r.customer_email, r.customer_phone, btrim(r.customer_address), r.customer_gstin,
        v_plan ->> 'customerStateCode', v_plan ->> 'customerState', v_plan ->> 'supplierStateCode', v_plan ->> 'taxTreatment', v_plan ->> 'particulars', v_plan ->> 'hsnSac',
        (v_plan ->> 'taxableAmount')::numeric, (v_plan ->> 'gstRate')::numeric, (v_plan ->> 'cgstAmount')::numeric, (v_plan ->> 'sgstAmount')::numeric, (v_plan ->> 'igstAmount')::numeric,
        (v_plan ->> 'totalGst')::numeric, (v_plan ->> 'totalAmount')::numeric, private.amount_in_words((v_plan ->> 'totalAmount')::numeric), r.payment_reference,
        (coalesce(r.payment_verified_at, now()) at time zone 'Asia/Kolkata')::date, 'Paid in full. Payment received and verified by Accounts.', auth.uid())
    returning * into i;
  exception when unique_violation then
    raise exception 'CONFLICT: This recharge already has an invoice, or the invoice number % was taken. Try again.', v_no using errcode = 'P0001';
  end;
  update public.support_recharges set invoice_status = 'GENERATED', updated_by = auth.uid(), updated_at = now() where id = r.id returning * into r;
  perform private.recharge_event(r.id, 'INVOICE_GENERATED', 'NOT_GENERATED', 'GENERATED', null, jsonb_build_object('invoice', i.invoice_number, 'total', i.total_amount, 'type', i.invoice_type));
  perform private.write_audit('SUPPORT_RECHARGE_INVOICE_GENERATED', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('invoice_id', i.id, 'number', i.invoice_number, 'total', i.total_amount, 'type', i.invoice_type, 'tax_treatment', i.tax_treatment));
  perform private.recharge_notify_support(r, 'RECHARGE_INVOICE_GENERATED', 'Recharge invoice generated', format('%s: Accounts generated invoice %s (%s).', private.recharge_label(r), i.invoice_number, private.rupees(i.total_amount)));
  return private.recharge_invoice_json(i) || jsonb_build_object('replayed', false);
end $$;

create or replace function public.recharge_invoice_get(p_recharge uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  i public.support_recharge_invoices;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team and Accounts.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_recharge;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  select * into i from public.support_recharge_invoices where recharge_id = r.id;
  return case when i.id is null then null else private.recharge_invoice_json(i) end;
end $$;

-- the snapshot the PDF is drawn from (Accounts only; nothing a browser sends goes into it)
create or replace function public.recharge_invoice_snapshot(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i public.support_recharge_invoices;
  r public.support_recharges;
begin
  perform private.require_accounts_staff();
  select * into i from public.support_recharge_invoices where id = p_invoice;
  if i.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into r from public.support_recharges where id = i.recharge_id;
  return jsonb_build_object(
    'invoiceId', i.id, 'rechargeId', r.id, 'customerId', r.customer_id, 'number', i.invoice_number, 'invoiceType', i.invoice_type, 'invoiceDate', i.invoice_date,
    'orderNumber', private.recharge_label(r), 'customer', jsonb_build_object('name', i.customer_name, 'businessName', i.customer_name, 'address', i.customer_address, 'contactPerson', null,
      'contactNumber', i.customer_phone, 'gstin', i.customer_gstin, 'state', i.customer_state, 'stateCode', i.customer_state_code), 'recipientEmail', i.customer_email,
    'taxTreatment', case when i.tax_treatment = 'NONE' then 'INTRA_STATE' else i.tax_treatment end, 'taxTreatmentOverridden', false, 'reverseCharge', false, 'terms', i.terms,
    'lines', jsonb_build_array(jsonb_build_object('position', 1, 'particulars', i.particulars, 'hsnSac', i.hsn_sac, 'taxRate', i.gst_rate, 'quantity', '1 Nos', 'baseAmount', i.taxable_amount,
                                                  'gstAmount', i.total_gst, 'totalAmount', i.total_amount)),
    'totals', jsonb_build_object('subtotal', i.taxable_amount, 'cgstAmount', i.cgst_amount, 'sgstAmount', i.sgst_amount, 'igstAmount', i.igst_amount, 'totalGst', i.total_gst, 'total', i.total_amount,
                                 'inWords', i.amount_in_words, 'breakdown', case when i.total_gst > 0 then jsonb_build_array(jsonb_build_object('rate', i.gst_rate, 'base', i.taxable_amount, 'gst', i.total_gst,
                                   'cgst', i.cgst_amount, 'sgst', i.sgst_amount, 'igst', i.igst_amount)) else '[]'::jsonb end),
    'paymentSummary', jsonb_build_object('total', i.total_amount, 'confirmed', i.total_amount, 'balance', 0, 'state', 'FULLY_PAID', 'payments', jsonb_build_array(jsonb_build_object('amount', i.total_amount))),
    'issuedAt', i.generated_at, 'pdfStatus', i.pdf_status,
    'stored', case when i.pdf_status = 'READY' then jsonb_build_object('provider', i.storage_provider, 'bucket', i.storage_bucket, 'path', i.storage_path, 'sizeBytes', i.size_bytes, 'etag', i.storage_etag) else null end);
end $$;

create or replace function public.recharge_invoice_record_pdf(p_invoice uuid, p_provider text, p_bucket text, p_path text, p_ref text, p_etag text, p_size integer)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.support_recharge_invoices;
begin
  perform private.require_accounts_staff();
  select * into i from public.support_recharge_invoices where id = p_invoice for update;
  if i.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  -- one fixed object per invoice: the database accepts no other location
  if p_bucket <> 'recharge-invoices' or p_path <> format('invoices/%s/invoice.pdf', i.id) then
    raise exception 'VALIDATION_ERROR: The invoice file must be stored in its own place.' using errcode = 'P0001';
  end if;
  update public.support_recharge_invoices set pdf_status = 'READY', pdf_error = null, storage_provider = p_provider, storage_bucket = p_bucket, storage_path = p_path, storage_ref = p_ref,
         storage_etag = p_etag, size_bytes = p_size, stored_at = now() where id = i.id;
end $$;

create or replace function public.recharge_invoice_record_pdf_failure(p_invoice uuid, p_error text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  update public.support_recharge_invoices set pdf_status = 'FAILED', pdf_error = left(coalesce(p_error, 'The PDF could not be made.'), 300) where id = p_invoice and pdf_status <> 'READY';
end $$;

-- the stored PDF's place, for a short-lived link (Accounts only; opening it is written to the audit log)
create or replace function public.recharge_invoice_file(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  i public.support_recharge_invoices;
  r public.support_recharges;
begin
  perform private.require_accounts_staff();
  select * into i from public.support_recharge_invoices where id = p_invoice;
  if i.id is null or i.pdf_status <> 'READY' then
    raise exception 'NOT_FOUND: The invoice PDF is not ready.' using errcode = 'P0001';
  end if;
  select * into r from public.support_recharges where id = i.recharge_id;
  perform private.write_audit('SUPPORT_RECHARGE_INVOICE_VIEWED', 'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('invoice_id', i.id, 'number', i.invoice_number));
  return jsonb_build_object('provider', i.storage_provider, 'bucket', i.storage_bucket, 'path', i.storage_path, 'number', i.invoice_number);
end $$;

-- the customer's contact for sending (an e-mail typed wrongly can be fixed after the invoice exists; the billing details on the invoice cannot)
create or replace function public.recharge_set_contact(p_recharge uuid, p_email text, p_phone text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  i public.support_recharge_invoices;
begin
  perform private.require_accounts_staff();
  select * into r from public.support_recharges where id = p_recharge for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_note, '')) < 3 then
    raise exception 'VALIDATION_ERROR: Say what was corrected and why.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer''s e-mail address is not valid.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_phone, '')) > 40 then
    raise exception 'VALIDATION_ERROR: The phone number is too long.' using errcode = 'P0001';
  end if;
  update public.support_recharges set customer_email = v_email, customer_phone = v_phone, updated_by = auth.uid(), updated_at = now() where id = r.id returning * into r;
  update public.support_recharge_invoices set customer_email = v_email, customer_phone = v_phone where recharge_id = r.id returning * into i;
  perform private.recharge_event(r.id, 'BILLING_CORRECTED', r.payment_status, r.payment_status, v_note, jsonb_build_object('contact', true));
  perform private.write_audit('SUPPORT_RECHARGE_CONTACT_CORRECTED', 'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('has_email', v_email is not null, 'has_phone', v_phone is not null));
  return private.recharge_json(r);
end $$;

-- ---------------------------------------------------------------------------
-- 5. Delivery: begin (guards), finish (the outcome), and the status of the recharge's invoice
-- ---------------------------------------------------------------------------
create or replace function private.recharge_e164(p text)
returns text language sql immutable set search_path = '' as $$
  select case when length(d) >= 10 and right(d, 10) ~ '^[6-9][0-9]{9}$' then '+91' || right(d, 10) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;

-- Support's tracking value for the invoice: a channel counts as sent once it was sent; otherwise its latest failure counts (kept apart from the payment status)
create or replace function private.recharge_refresh_invoice_status(p_recharge uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_mail text;
  v_wa text;
  v_new text;
begin
  select case when exists (select 1 from public.support_recharge_deliveries d join public.support_recharge_invoices i on i.id = d.invoice_id where i.recharge_id = p_recharge and d.channel = 'EMAIL' and d.status = 'SENT') then 'SENT'
              else (select d.status from public.support_recharge_deliveries d join public.support_recharge_invoices i on i.id = d.invoice_id
                     where i.recharge_id = p_recharge and d.channel = 'EMAIL' and d.status = 'FAILED' order by d.requested_at desc limit 1) end,
         case when exists (select 1 from public.support_recharge_deliveries d join public.support_recharge_invoices i on i.id = d.invoice_id where i.recharge_id = p_recharge and d.channel = 'WHATSAPP' and d.status = 'SENT') then 'SENT'
              else (select d.status from public.support_recharge_deliveries d join public.support_recharge_invoices i on i.id = d.invoice_id
                     where i.recharge_id = p_recharge and d.channel = 'WHATSAPP' and d.status = 'FAILED' order by d.requested_at desc limit 1) end
    into v_mail, v_wa;
  v_new := case
    when v_mail = 'SENT' and v_wa = 'SENT' then 'SENT'
    when v_mail = 'SENT' and v_wa = 'FAILED' then 'PARTIALLY_SENT'
    when v_wa = 'SENT' and v_mail = 'FAILED' then 'PARTIALLY_SENT'
    when v_mail = 'SENT' then 'EMAIL_SENT'
    when v_wa = 'SENT' then 'WHATSAPP_SENT'
    when v_mail = 'FAILED' or v_wa = 'FAILED' then 'FAILED'
    else 'GENERATED'
  end;
  update public.support_recharges set invoice_status = v_new, updated_at = now() where id = p_recharge and invoice_status <> 'NOT_GENERATED' and invoice_status is distinct from v_new;
  return v_new;
end $$;

-- Accounts asks to send the invoice by one channel. Refused: no PDF yet, payment not confirmed, already sent (unless "send again"), a send in progress.
create or replace function public.recharge_delivery_begin(p_recharge uuid, p_channel text, p_resend boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  i public.support_recharge_invoices;
  d public.support_recharge_deliveries;
  v_ch text := upper(btrim(coalesce(p_channel, '')));
  v_to text;
  v_sent boolean;
begin
  perform private.require_accounts_staff();
  if v_ch not in ('EMAIL', 'WHATSAPP') then
    raise exception 'VALIDATION_ERROR: Choose e-mail or WhatsApp.' using errcode = 'P0001';
  end if;
  select * into r from public.support_recharges where id = p_recharge for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  select * into i from public.support_recharge_invoices where recharge_id = r.id;
  if i.id is null then
    raise exception 'CONFLICT: Generate the invoice first.' using errcode = 'P0001';
  end if;
  if r.payment_status <> 'PAYMENT_RECEIVED' then
    raise exception 'CONFLICT: The payment is not confirmed as received.' using errcode = 'P0001';
  end if;
  if i.pdf_status <> 'READY' then
    raise exception 'CONFLICT: The invoice PDF is not ready yet. Retry the PDF first.' using errcode = 'P0001';
  end if;
  v_to := case v_ch when 'EMAIL' then nullif(btrim(coalesce(i.customer_email, '')), '') else private.recharge_e164(i.customer_phone) end;
  if v_ch = 'EMAIL' and (v_to is null or v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'VALIDATION_ERROR: The customer has no valid e-mail address. Add it (Update contact) and send again.' using errcode = 'P0001';
  end if;
  if v_ch = 'WHATSAPP' and v_to is null then
    raise exception 'VALIDATION_ERROR: The customer has no valid Indian mobile number. Add it (Update contact) and send again.' using errcode = 'P0001';
  end if;
  -- a send that never finished (the server stopped) does not block the channel for ever
  update public.support_recharge_deliveries set status = 'FAILED', finished_at = now(), detail = 'The send did not finish (timed out).'
   where invoice_id = i.id and channel = v_ch and status = 'SENDING' and requested_at < now() - interval '5 minutes';
  if exists (select 1 from public.support_recharge_deliveries x where x.invoice_id = i.id and x.channel = v_ch and x.status = 'SENDING') then
    raise exception 'CONFLICT: This invoice is already being sent by % right now. Check again in a moment.', lower(v_ch) using errcode = 'P0001';
  end if;
  v_sent := exists (select 1 from public.support_recharge_deliveries x where x.invoice_id = i.id and x.channel = v_ch and x.status = 'SENT');
  if v_sent and not coalesce(p_resend, false) then
    raise exception 'CONFLICT: The invoice was already sent by %. Use "Send again" if you really want to send it once more.', lower(v_ch) using errcode = 'P0001';
  end if;
  begin
    insert into public.support_recharge_deliveries (invoice_id, channel, recipient, is_resend, requested_by) values (i.id, v_ch, v_to, v_sent, auth.uid()) returning * into d;
  exception when unique_violation then
    raise exception 'CONFLICT: This invoice is already being sent by % right now. Check again in a moment.', lower(v_ch) using errcode = 'P0001';
  end;
  return jsonb_build_object('deliveryId', d.id, 'channel', d.channel, 'to', d.recipient, 'isResend', d.is_resend, 'invoiceId', i.id, 'number', i.invoice_number, 'invoiceDate', i.invoice_date,
    'total', i.total_amount, 'customerName', i.customer_name, 'customerId', r.customer_id,
    'file', jsonb_build_object('provider', i.storage_provider, 'bucket', i.storage_bucket, 'path', i.storage_path, 'sizeBytes', i.size_bytes, 'etag', i.storage_etag));
end $$;

create or replace function public.recharge_delivery_finish(p_delivery uuid, p_outcome text, p_detail text default null, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d public.support_recharge_deliveries;
  i public.support_recharge_invoices;
  r public.support_recharges;
  v_out text := upper(btrim(coalesce(p_outcome, '')));
  v_new text;
begin
  perform private.require_accounts_staff();
  if v_out not in ('SENT', 'NOT_SENT', 'FAILED') then
    raise exception 'VALIDATION_ERROR: Unknown delivery outcome.' using errcode = 'P0001';
  end if;
  select * into d from public.support_recharge_deliveries where id = p_delivery for update;
  if d.id is null then
    raise exception 'NOT_FOUND: Delivery not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'SENDING' then
    return private.recharge_delivery_json(d, true) || jsonb_build_object('replayed', true);
  end if;
  select * into i from public.support_recharge_invoices where id = d.invoice_id;
  select * into r from public.support_recharges where id = i.recharge_id for update;
  update public.support_recharge_deliveries set status = v_out, finished_at = now(), detail = left(nullif(btrim(coalesce(p_detail, '')), ''), 300), provider_ref = left(nullif(btrim(coalesce(p_ref, '')), ''), 200)
   where id = d.id returning * into d;
  v_new := private.recharge_refresh_invoice_status(r.id);
  if v_out <> 'NOT_SENT' then
    perform private.recharge_event(r.id, case when v_out = 'SENT' and d.is_resend then 'INVOICE_RESENT' when v_out = 'SENT' and d.channel = 'EMAIL' then 'INVOICE_SENT_EMAIL'
                                              when v_out = 'SENT' then 'INVOICE_SENT_WHATSAPP' else 'INVOICE_SEND_FAILED' end,
      r.invoice_status, v_new, case when v_out <> 'SENT' then left(d.detail, 500) end, jsonb_build_object('channel', d.channel, 'outcome', v_out, 'invoice', i.invoice_number, 'resend', d.is_resend));
  end if;
  perform private.write_audit(case when v_out = 'SENT' and d.is_resend then 'SUPPORT_RECHARGE_INVOICE_RESENT' when v_out = 'SENT' and d.channel = 'EMAIL' then 'SUPPORT_RECHARGE_INVOICE_EMAILED'
                                   when v_out = 'SENT' then 'SUPPORT_RECHARGE_INVOICE_WHATSAPPED' when v_out = 'NOT_SENT' then 'SUPPORT_RECHARGE_INVOICE_NOT_SENT' else 'SUPPORT_RECHARGE_INVOICE_SEND_FAILED' end,
    'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('invoice_id', i.id, 'number', i.invoice_number, 'channel', d.channel, 'outcome', v_out));
  if v_out = 'SENT' then
    perform private.recharge_notify_support(r, 'RECHARGE_INVOICE_SENT', 'Recharge invoice sent', format('%s: invoice %s was sent to the customer by %s.', private.recharge_label(r), i.invoice_number, lower(d.channel)));
  elsif v_out = 'FAILED' then
    perform private.recharge_notify_accounts(r, 'RECHARGE_INVOICE_SEND_FAILED', 'Recharge invoice not delivered', format('%s: invoice %s could not be sent by %s. Retry from the recharge.', private.recharge_label(r), i.invoice_number, lower(d.channel)));
  end if;
  return private.recharge_delivery_json(d, true) || jsonb_build_object('replayed', false, 'invoiceStatus', v_new);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The recharge carries its invoice (what Support and Accounts see)
-- ---------------------------------------------------------------------------
create or replace function public.recharge_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  i public.support_recharge_invoices;
  v_timeline jsonb;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team and Accounts.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_id;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'from', e.from_status, 'to', e.to_status, 'note', e.note,
                                               'actorName', (select p.full_name from public.profiles p where p.id = e.actor_id)) order by e.at, e.id), '[]'::jsonb)
    into v_timeline from public.support_recharge_events e where e.recharge_id = r.id;
  select * into i from public.support_recharge_invoices where recharge_id = r.id;
  return private.recharge_json(r) || jsonb_build_object('timeline', v_timeline, 'invoice', case when i.id is null then null else private.recharge_invoice_json(i) end,
    'isAccounts', coalesce(private.recharge_role() in ('ACCOUNTS', 'SUPER_ADMIN'), false));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.recharge_invoice_plan(public.support_recharges, jsonb)', 'private.recharge_delivery_json(public.support_recharge_deliveries, boolean)',
    'private.recharge_invoice_json(public.support_recharge_invoices)', 'private.recharge_e164(text)', 'private.recharge_refresh_invoice_status(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.recharge_invoice_prefill(uuid, jsonb)', 'public.recharge_invoice_generate(uuid, jsonb)', 'public.recharge_invoice_get(uuid)', 'public.recharge_invoice_snapshot(uuid)',
    'public.recharge_invoice_record_pdf(uuid, text, text, text, text, text, integer)', 'public.recharge_invoice_record_pdf_failure(uuid, text)', 'public.recharge_invoice_file(uuid)',
    'public.recharge_set_contact(uuid, text, text, text)', 'public.recharge_delivery_begin(uuid, text, boolean)', 'public.recharge_delivery_finish(uuid, text, text, text)',
    'public.recharge_get(uuid)', 'public.recharge_list(text, text, text, text, date, date, numeric, numeric, uuid, integer, integer)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
