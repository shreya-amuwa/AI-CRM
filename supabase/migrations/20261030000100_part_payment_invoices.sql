-- Invoices for part payments.
--
-- Accounts can issue an invoice for each part payment of the agreed services (the earlier rule allowed one invoice for them).
-- The invoices of the agreed services together may not total more than the amount agreed with Sales; each invoice is paid from
-- the customer's verified payments in the order the invoices were issued (the first invoice takes the first money).
--
-- Run after 20261029000100_service_journeys_support_balance.sql (safe to run again).

-- Cumulative cap (replaces the per-invoice check)
create or replace function private.tg_generated_invoice_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_before numeric;
begin
  select * into c from public.customers where id = new.customer_id;
  new.payment_ledger := case when new.addon_request_id is not null then 'ADDON'
                             when new.purpose = 'SERVICES' and coalesce(c.deal_amount, 0) > 0 then 'CUSTOMER'
                             else 'INVOICE' end;
  if new.payment_ledger = 'CUSTOMER' then
    select coalesce(sum(g.total_amount), 0) into v_before from public.generated_invoices g
     where g.customer_id = new.customer_id and g.payment_ledger = 'CUSTOMER';
    if v_before + new.total_amount > c.deal_amount then
      raise exception 'VALIDATION_ERROR: The invoices of the agreed services would total % but only % was agreed with Sales (already invoiced: %). Lower this invoice, or ask Sales to correct the agreed amount first.',
        private.rupees(v_before + new.total_amount), private.rupees(c.deal_amount), private.rupees(v_before) using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_ledger() from public, anon, authenticated;

-- The customer's verified payments pay the invoices of the agreed services in the order they were issued.
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
    'pending', v_pending, 'ledger', g.payment_ledger, 'payments', v_payments);
end $$;
revoke all on function private.invoice_payment_summary(uuid) from public, anon, authenticated;

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
begin
  perform private.require_accounts_staff();
  if p_customer is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_purpose not in ('SERVICES', 'ADDON', 'ADDITIONAL') then
    raise exception 'VALIDATION_ERROR: Choose what this invoice is for.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;

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
    -- An invoice can be made for each part payment: the invoices of the agreed services together may not exceed the agreed amount.
    select coalesce(sum(g.total_amount), 0) into v_invoiced from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES';
    if v_invoiced > 0 then
      v_warnings := v_warnings || to_jsonb(format('Invoices already issued for the agreed services total %s%s. This invoice, for the next payment, can cover the rest.',
        private.rupees(v_invoiced), case when coalesce(c.deal_amount, 0) > 0 then format(' of the agreed %s', private.rupees(c.deal_amount)) else '' end));
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

create or replace function public.accounts_issue_invoice(p_request uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
  c public.customers;
  r public.addon_requests;
  g public.generated_invoices;
  inv public.member_invoices;
  cu jsonb;
  v_purpose text;
  v_no text;
  v_date date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_name text; v_business text; v_address text; v_contact text; v_mobile text; v_gstin text; v_state_code text; v_state_name text;
  v_treatment text; v_default text; v_override boolean; v_reason text; v_ack boolean;
  v_terms text; v_order text; v_reverse boolean;
  v_lines jsonb;
  v_calc jsonb;
  e jsonb;
  i integer := 0;
  v_part text; v_hsn text; v_qty text; v_svc text;
  v_clean jsonb := '[]'::jsonb;
begin
  perform private.require_accounts_staff();
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request is missing its reference.' using errcode = 'P0001';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'VALIDATION_ERROR: The invoice details are missing.' using errcode = 'P0001';
  end if;
  begin
    v_customer := (p_payload ->> 'customerId')::uuid;
  exception when others then
    raise exception 'VALIDATION_ERROR: Choose the customer.' using errcode = 'P0001';
  end;
  if v_customer is null or not private.accounts_can_invoice(v_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;

  -- One customer at a time: concurrent clicks and retries are serialised, then a repeated request returns the same invoice.
  select * into c from public.customers where id = v_customer for update;
  select * into g from public.generated_invoices where request_id = p_request;
  if g.invoice_id is not null then
    if g.customer_id <> v_customer then
      raise exception 'CONFLICT: This request was already used for another customer.' using errcode = 'P0001';
    end if;
    select * into inv from public.member_invoices where id = g.invoice_id;
    return private.invoice_json(inv) || jsonb_build_object('replayed', true);
  end if;

  v_purpose := upper(coalesce(p_payload ->> 'purpose', ''));
  if v_purpose not in ('SERVICES', 'ADDON', 'ADDITIONAL') then
    raise exception 'VALIDATION_ERROR: Choose what this invoice is for.' using errcode = 'P0001';
  end if;

  -- Invoice number: blank = the next one (reserved now, atomically); typed = checked for format and uniqueness.
  v_no := nullif(btrim(coalesce(p_payload ->> 'invoiceNumber', '')), '');
  if v_no is null then
    v_no := private.next_invoice_number();
  else
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$' then
      raise exception 'VALIDATION_ERROR: The invoice number can use letters, numbers, / and - (up to 16 characters).' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.member_invoices x where lower(x.invoice_number) = lower(v_no) and x.kind <> 'MANUAL') then
      raise exception 'CONFLICT: An invoice numbered % already exists.', v_no using errcode = 'P0001';
    end if;
  end if;

  begin
    v_date := (p_payload ->> 'invoiceDate')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter a valid invoice date.' using errcode = 'P0001';
  end;
  if v_date is null or v_date > v_today or v_date < date '2017-07-01' then
    raise exception 'VALIDATION_ERROR: The invoice date cannot be in the future (and not before 1 July 2017).' using errcode = 'P0001';
  end if;

  v_order := left(coalesce(nullif(btrim(p_payload ->> 'orderNumber'), ''), 'Verbal'), 60);
  v_terms := left(coalesce(nullif(btrim(p_payload ->> 'terms'), ''), '100% Payment Against supply.'), 2000);
  v_reverse := coalesce((p_payload ->> 'reverseCharge')::boolean, false);

  -- The customer as billed
  cu := coalesce(p_payload -> 'customer', '{}'::jsonb);
  v_name := nullif(left(btrim(coalesce(cu ->> 'name', '')), 200), '');
  v_business := nullif(left(btrim(coalesce(cu ->> 'businessName', '')), 200), '');
  v_address := nullif(left(btrim(coalesce(cu ->> 'address', '')), 500), '');
  v_contact := nullif(left(btrim(coalesce(cu ->> 'contactPerson', '')), 200), '');
  v_mobile := nullif(left(btrim(coalesce(cu ->> 'contactNumber', '')), 25), '');
  v_gstin := nullif(upper(regexp_replace(coalesce(cu ->> 'gstin', ''), '\s+', '', 'g')), '');
  v_state_code := nullif(btrim(coalesce(cu ->> 'stateCode', '')), '');
  if coalesce(v_name, v_business) is null then
    raise exception 'VALIDATION_ERROR: Enter the customer or business name.' using errcode = 'P0001';
  end if;
  v_name := coalesce(v_name, v_business);
  if v_address is null then
    raise exception 'VALIDATION_ERROR: Enter the business address.' using errcode = 'P0001';
  end if;
  if v_mobile is not null and v_mobile !~ '^[0-9+()\-\s.]{5,25}$' then
    raise exception 'VALIDATION_ERROR: Enter a valid contact number.' using errcode = 'P0001';
  end if;
  if v_gstin is not null and not private.valid_gstin(v_gstin) then
    raise exception 'VALIDATION_ERROR: The GSTIN is not valid. Check it against the customer''s GST certificate.' using errcode = 'P0001';
  end if;
  select s.name into v_state_name from public.gst_states s where s.code = v_state_code;
  if v_state_name is null then
    raise exception 'VALIDATION_ERROR: Choose the customer''s state so the right tax can be applied.' using errcode = 'P0001';
  end if;

  -- Tax treatment: the default follows the states; a different choice is an explicit, explained override.
  v_default := case when v_state_code = private.company_state_code() then 'INTRA_STATE' else 'INTER_STATE' end;
  v_treatment := upper(coalesce(p_payload ->> 'taxTreatment', ''));
  if v_treatment not in ('INTRA_STATE', 'INTER_STATE') then
    raise exception 'VALIDATION_ERROR: Review and choose the tax treatment (CGST + SGST, or IGST).' using errcode = 'P0001';
  end if;
  v_override := v_treatment <> v_default;
  v_reason := nullif(left(btrim(coalesce(p_payload ->> 'taxOverrideReason', '')), 300), '');
  if v_override and length(coalesce(v_reason, '')) < 5 then
    raise exception 'VALIDATION_ERROR: The tax treatment differs from the customer''s state. Say why (at least 5 characters).' using errcode = 'P0001';
  end if;
  v_ack := coalesce((p_payload ->> 'acknowledgeStateMismatch')::boolean, false);
  if v_gstin is not null and left(v_gstin, 2) <> v_state_code and not v_ack then
    raise exception 'VALIDATION_ERROR: The GSTIN belongs to % but the invoice state is %. Verify the state, or confirm it to continue.',
      (select name from public.gst_states where code = left(v_gstin, 2)), v_state_name using errcode = 'P0001';
  end if;

  -- Purchase link
  if v_purpose = 'ADDON' then
    begin
      select * into r from public.addon_requests where id = (p_payload ->> 'addonRequestId')::uuid and customer_id = v_customer for update;
    exception when others then
      raise exception 'VALIDATION_ERROR: Choose the add-on request.' using errcode = 'P0001';
    end;
    if r.id is null then
      raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
    end if;
    if r.status <> 'APPROVED' or r.invoice_id is not null or exists (select 1 from public.member_invoices x where x.addon_request_id = r.id) then
      raise exception 'CONFLICT: This add-on request cannot take another invoice.' using errcode = 'P0001';
    end if;
  end if;

  -- Lines: text fields are cleaned and checked here; the money is recalculated here and nowhere else.
  v_lines := p_payload -> 'lines';
  if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'VALIDATION_ERROR: Add at least one service line.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_lines) > 50 then
    raise exception 'VALIDATION_ERROR: An invoice can have at most 50 lines.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(v_lines) loop
    i := i + 1;
    v_part := left(btrim(regexp_replace(coalesce(e ->> 'particulars', ''), '[\r\n\t]+', ' ', 'g')), 500);
    if length(v_part) < 2 then
      raise exception 'VALIDATION_ERROR: Line %: enter the particulars (the service description).', i using errcode = 'P0001';
    end if;
    v_hsn := coalesce(nullif(btrim(e ->> 'hsnSac'), ''), '998313');
    if v_hsn !~ '^[0-9]{4,8}$' then
      raise exception 'VALIDATION_ERROR: Line %: the HSN/SAC code is 4 to 8 digits.', i using errcode = 'P0001';
    end if;
    v_qty := left(btrim(coalesce(nullif(btrim(e ->> 'quantity'), ''), '1 Nos')), 30);
    v_svc := nullif(btrim(coalesce(e ->> 'serviceCode', '')), '');
    if v_svc is not null and not exists (select 1 from public.crm_services s where s.code = v_svc) then
      raise exception 'VALIDATION_ERROR: Line %: that service is not in the catalogue.', i using errcode = 'P0001';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('particulars', v_part, 'hsnSac', v_hsn, 'quantity', v_qty, 'serviceCode', v_svc,
                                                              'baseAmount', e -> 'baseAmount', 'taxRate', e -> 'taxRate'));
  end loop;
  v_calc := private.invoice_calc(v_clean, v_treatment);
  if (v_calc ->> 'total')::numeric <= 0 then
    raise exception 'VALIDATION_ERROR: The invoice total must be more than zero.' using errcode = 'P0001';
  end if;
  -- An add-on invoice bills what was approved: its total must match the approved request.
  if v_purpose = 'ADDON' and (v_calc ->> 'total')::numeric <> r.total then
    raise exception 'VALIDATION_ERROR: The invoice total (%) must match the approved add-on total (%).',
      private.rupees((v_calc ->> 'total')::numeric), private.rupees(r.total) using errcode = 'P0001';
  end if;

  begin
    insert into public.member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, details,
                                        customer_id, kind, department_id, subtotal, discount_total, tax_total, issued_by, issued_at, addon_request_id)
    values ((select private.my_id()), v_no, v_name, coalesce(v_business, ''), (v_calc ->> 'total')::numeric, 'Pending', v_date::text, '',
            jsonb_build_object('generated', true), c.id, 'GENERATED', c.department_id, (v_calc ->> 'subtotal')::numeric, 0,
            (v_calc ->> 'totalGst')::numeric, (select private.my_id()), now(), case when v_purpose = 'ADDON' then r.id end)
    returning * into inv;
  exception when unique_violation then
    raise exception 'CONFLICT: An invoice numbered % already exists, or this add-on request already has an invoice.', v_no using errcode = 'P0001';
  end;

  insert into public.generated_invoices (
    invoice_id, request_id, customer_id, purpose, addon_request_id, invoice_number, invoice_date, order_number,
    customer_name, business_name, business_address, contact_person, contact_number, customer_gstin, customer_state_code, customer_state,
    supplier_state_code, tax_treatment, tax_treatment_overridden, tax_override_reason, state_mismatch_acknowledged, reverse_charge, terms,
    subtotal, cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount, total_gst, total_amount, amount_in_words, tax_breakdown,
    issued_by)
  values (
    inv.id, p_request, c.id, v_purpose, case when v_purpose = 'ADDON' then r.id end, v_no, v_date, v_order,
    v_name, v_business, v_address, v_contact, v_mobile, v_gstin, v_state_code, v_state_name,
    private.company_state_code(), v_treatment, v_override, case when v_override then v_reason end, v_ack, v_reverse, v_terms,
    (v_calc ->> 'subtotal')::numeric, (v_calc ->> 'cgstRate')::numeric, (v_calc ->> 'cgst')::numeric, (v_calc ->> 'sgstRate')::numeric,
    (v_calc ->> 'sgst')::numeric, (v_calc ->> 'igstRate')::numeric, (v_calc ->> 'igst')::numeric, (v_calc ->> 'totalGst')::numeric,
    (v_calc ->> 'total')::numeric, v_calc ->> 'words', v_calc -> 'groups', (select private.my_id()));

  insert into public.generated_invoice_items (invoice_id, position, service_code, particulars, hsn_sac, tax_rate, quantity_text, base_amount, gst_amount, total_amount)
  select inv.id, (l ->> 'position')::integer, nullif(x ->> 'serviceCode', ''), x ->> 'particulars', x ->> 'hsnSac', (l ->> 'taxRate')::numeric,
         x ->> 'quantity', (l ->> 'baseAmount')::numeric, (l ->> 'gstAmount')::numeric, (l ->> 'totalAmount')::numeric
    from jsonb_array_elements(v_calc -> 'lines') with ordinality as t(l, n)
    join jsonb_array_elements(v_clean) with ordinality as u(x, n2) on u.n2 = t.n;

  if v_purpose = 'ADDON' then
    -- the approved add-on request now has its invoice: payment is next (the same step the uploaded add-on invoice takes)
    update public.addon_requests set status = 'INVOICE_GENERATED', invoice_id = inv.id where id = r.id returning * into r;
    perform private.addon_event(r.id, 'INVOICE_GENERATED', v_no);
    perform private.notify_consultant(r, 'ADDON_INVOICE_ISSUED', format('Add-on invoice: %s', coalesce(c.company, c.name)),
      format('Accounts issued invoice %s (%s). Wait for the payment confirmation before collecting documents.', v_no, private.rupees(inv.amount)));
  end if;
  perform private.log_customer_activity(c.id, 'INVOICE_ISSUED', format('Invoice %s issued by Accounts', v_no));
  perform private.write_audit('INVOICE_ISSUED', 'invoice', inv.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', v_no, 'total', inv.amount, 'kind', 'GENERATED', 'purpose', v_purpose,
                       'tax_treatment', v_treatment, 'overridden', v_override, 'request_id', p_request));
  perform private.notify(c.owner_id, 'INVOICE_ISSUED', format('Invoice issued: %s', coalesce(c.company, c.name)),
    format('Accounts issued invoice %s (%s).', v_no, private.rupees(inv.amount)), 'customer', c.id);
  return private.invoice_json(inv) || jsonb_build_object('replayed', false);
end $$;
revoke all on function public.accounts_issue_invoice(uuid, jsonb) from public, anon;
grant execute on function public.accounts_issue_invoice(uuid, jsonb) to authenticated;
