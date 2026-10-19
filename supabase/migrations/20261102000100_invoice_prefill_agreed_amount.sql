-- Invoice builder: the amount is filled in from the customer's own record.
--
-- Until now the invoice rows for a purchase came pre-filled with every detail except the price, so Accounts typed each amount.
-- The only amount recorded for a purchase is the one Sales agreed with the customer (customers.deal_amount, with tax) for all
-- the services together, and the invoices already issued for it are in generated_invoices. So the builder now offers, for each
-- service of THIS customer, a share of what is still to be invoiced (agreed amount - invoices already issued), worked out so that
-- the invoice total with GST is as close as possible to that balance without passing it (the cap the database enforces).
--   * The balance is split by the services' catalogue starting prices when every service has one, otherwise equally.
--   * Nothing is filled when no amount was agreed, or when it has been invoiced in full (a warning says so). Nothing is invented.
--   * Add-on invoices already come with the approved prices; additional purchases start empty. Both are unchanged.
-- Every amount stays editable and the database still recomputes the totals and enforces the cap when the invoice is issued.
-- Idempotent.

-- Largest base amount (rupees, 2 decimals) whose total with GST (GST = round(base x rate / 100, 2), as the invoice does) does not pass p_total.
create or replace function private.invoice_base_for_total(p_total numeric, p_rate numeric)
returns numeric language plpgsql immutable set search_path = '' as $$
declare
  v_target bigint := floor(p_total * 100);
  v_b bigint;
begin
  if v_target <= 0 then return 0; end if;
  v_b := floor(v_target * 100 / (100 + p_rate));
  while (v_b + 1) + round((v_b + 1) * p_rate / 100) <= v_target loop v_b := v_b + 1; end loop;
  while v_b > 0 and v_b + round(v_b * p_rate / 100) > v_target loop v_b := v_b - 1; end loop;
  return round(v_b / 100.0, 2);
end $$;
revoke all on function private.invoice_base_for_total(numeric, numeric) from public, anon, authenticated;

-- Fills "baseAmount" on each line so that the lines (with GST) add up to p_total, or as near below it as paise rounding allows.
create or replace function private.spread_invoice_total(p_lines jsonb, p_total numeric)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  n integer := coalesce(jsonb_array_length(p_lines), 0);
  v_total bigint := floor(p_total * 100);
  v_w numeric[];
  v_rate numeric[];
  v_share bigint[];
  v_base numeric[];
  v_sum_w numeric := 0;
  v_all_priced boolean := true;
  v_used bigint := 0;
  v_left bigint;
  v_line_total bigint;
  i integer;
  v_price numeric;
begin
  if n = 0 or v_total <= 0 then return p_lines; end if;
  for i in 1..n loop
    select s.starting_price into v_price from public.crm_services s where s.code = p_lines -> (i - 1) ->> 'serviceCode';
    v_w[i] := coalesce(v_price, 0);
    v_rate[i] := coalesce(nullif(p_lines -> (i - 1) ->> 'taxRate', '')::numeric, 18);
    if v_w[i] <= 0 then v_all_priced := false; end if;
  end loop;
  for i in 1..n loop
    if not v_all_priced then v_w[i] := 1; end if;
    v_sum_w := v_sum_w + v_w[i];
  end loop;
  -- each service's share of the balance, in paise (the leftover paise go to the first services)
  for i in 1..n loop
    v_share[i] := floor(v_total * v_w[i] / v_sum_w);
    v_used := v_used + v_share[i];
  end loop;
  v_left := v_total - v_used;
  i := 1;
  while v_left > 0 loop v_share[i] := v_share[i] + 1; v_left := v_left - 1; i := i % n + 1; end loop;
  -- base amounts: with GST each line stays within its share
  v_used := 0;
  for i in 1..n loop
    v_base[i] := private.invoice_base_for_total(v_share[i] / 100.0, v_rate[i]);
    v_line_total := round(v_base[i] * 100) + round(round(v_base[i] * 100) * v_rate[i] / 100);
    v_used := v_used + v_line_total;
  end loop;
  -- a service whose share is too small to carry an amount: put the whole balance on the first service instead
  for i in 1..n loop
    if v_base[i] <= 0 then
      v_base[1] := private.invoice_base_for_total(v_total / 100.0, v_rate[1]);
      for i in 2..n loop v_base[i] := null; end loop;
      v_used := -1;
      exit;
    end if;
  end loop;
  -- what paise rounding left over goes to the first line, as far as its GST allows
  if v_used >= 0 and v_total - v_used > 0 then
    v_line_total := round(v_base[1] * 100) + round(round(v_base[1] * 100) * v_rate[1] / 100);
    v_base[1] := private.invoice_base_for_total((v_line_total + (v_total - v_used)) / 100.0, v_rate[1]);
  end if;
  return (select jsonb_agg(l || jsonb_build_object('baseAmount', round(v_base[ord::integer], 2)) order by ord)
            from jsonb_array_elements(p_lines) with ordinality as t(l, ord));
end $$;
revoke all on function private.spread_invoice_total(jsonb, numeric) from public, anon, authenticated;

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
    -- The amount comes from this customer's own record: what Sales agreed for the services, less what has already been
    -- invoiced for them, spread over the services of the purchase (so the invoices together never pass the agreed amount).
    if coalesce(c.deal_amount, 0) > 0 then
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

notify pgrst, 'reload schema';
