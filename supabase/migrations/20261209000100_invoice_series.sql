-- =============================================================================
-- Invoice numbering: GST and non-GST invoices have their own series, per financial year.
--
--   GST invoice      GST/26-27/001, GST/26-27/002 ...
--   Non-GST invoice  Amuwa/26-27/001, Amuwa/26-27/002 ...
--   From 1 April 2027 the year part becomes 27-28 and each series starts again at 001.
--
-- What was wrong
--   Every generated invoice was numbered INV-<calendar year>-<sequence> from ONE database sequence: no GST / non-GST distinction, the year
--   was the calendar year (not the Indian financial year, 1 April - 31 March), the number could be typed by the browser, and a sequence
--   leaves gaps when a transaction is rolled back (a refused invoice used up a number).
--
-- Now
--   * The invoice type (GST | NON_GST) is worked out by the database from the tax on the invoice (any tax above 0 = GST) and carried in the
--     invoice snapshot as invoiceType; an issued invoice's tax cannot change, so neither can its type.
--   * private.take_invoice_number(type, invoice date) is the only way a number is made. The financial year comes from the INVOICE DATE
--     (April-March, Asia/Kolkata business date), the counter row of (type, year) is locked while the number is taken, so two concurrent
--     requests can never get the same number, and the counter moves only if the invoice is saved (it is in the same transaction), so there
--     are no gaps. A counter is never decreased: a cancelled or deleted invoice never gives its number back.
--   * The first number of a new series continues after any number of that shape that already exists, and a number already taken by an
--     uploaded invoice is skipped, so the next number is always one that is free.
--   * accounts_issue_invoice refuses a number typed by the browser; the builder shows only a preview (private.peek_invoice_number).
--   * Numbers already issued (INV-2026-00022 ...) are untouched, as are their PDFs. The unique index on the number already exists.
--   * Rule 46 of the CGST Rules asks for a consecutive serial number of at most 16 characters, unique for a financial year, using letters,
--     numbers, hyphen and slash. Both formats fit (15 and 13 characters); a series that would pass 16 characters is refused rather than
--     truncated. Whether a "non-GST" invoice is right for a given supply (exempt / nil-rated supplies normally take a bill of supply) is a
--     question for the company's tax adviser: this migration only keeps the two series apart.
--
-- Safe to run again. Nothing is renumbered, sent or deleted.
-- =============================================================================

-- The type is not a column that could drift: it is worked out from the tax on the invoice, which can never change once issued.
alter table public.generated_invoices drop column if exists invoice_type;
create or replace function private.invoice_type_of(p_total_gst numeric)
returns text language sql immutable set search_path = '' as $$
  select case when coalesce(p_total_gst, 0) > 0 then 'GST' else 'NON_GST' end
$$;

-- one counter row per series: (type, financial year)
create table if not exists public.invoice_number_series (
  invoice_type text not null check (invoice_type in ('GST', 'NON_GST')),
  fy text not null check (fy ~ '^[0-9]{2}-[0-9]{2}$'),
  last_value integer not null check (last_value >= 0),
  updated_at timestamptz not null default now(),
  primary key (invoice_type, fy)
);
alter table public.invoice_number_series enable row level security;
revoke all on public.invoice_number_series from public, anon, authenticated;

-- the Indian financial year of a date, as it is written in the number: 2026-04-01 .. 2027-03-31 -> 26-27
create or replace function private.fy_label(p_date date)
returns text language sql immutable set search_path = '' as $$
  select case when extract(month from p_date) >= 4
              then to_char(p_date, 'YY') || '-' || to_char(p_date + interval '1 year', 'YY')
              else to_char(p_date - interval '1 year', 'YY') || '-' || to_char(p_date, 'YY') end
$$;

create or replace function private.invoice_series_prefix(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case p_type when 'GST' then 'GST' when 'NON_GST' then 'Amuwa' end
$$;

create or replace function private.invoice_number_text(p_type text, p_fy text, p_n integer)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := private.invoice_series_prefix(p_type) || '/' || p_fy || '/' || case when p_n < 1000 then lpad(p_n::text, 3, '0') else p_n::text end;  -- (lpad would cut 1000 to 100)
begin
  if length(v) > 16 then
    raise exception 'CONFLICT: The % invoice series of % is full (an invoice number can have at most 16 characters). Ask the administrator to extend it.', p_type, p_fy using errcode = 'P0001';
  end if;
  return v;
end $$;

-- the highest number of this series that already exists anywhere (older rows, uploaded invoices that carry a number of the same shape)
create or replace function private.invoice_series_existing_max(p_type text, p_fy text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(max((substring(i.invoice_number from '/([0-9]+)$'))::integer), 0)
    from public.member_invoices i
   where lower(i.invoice_number) like lower(private.invoice_series_prefix(p_type) || '/' || p_fy || '/') || '%'
     and i.invoice_number ~ ('^' || private.invoice_series_prefix(p_type) || '/' || p_fy || '/[0-9]{1,5}$')
$$;
revoke all on function private.invoice_series_existing_max(text, text) from public, anon, authenticated;

-- THE function that makes a number. Call it only inside the transaction that saves the invoice.
create or replace function private.take_invoice_number(p_type text, p_date date)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_fy text;
  v_n integer;
  v_no text;
begin
  if p_type not in ('GST', 'NON_GST') then
    raise exception 'VALIDATION_ERROR: Unknown invoice type.' using errcode = 'P0001';
  end if;
  if p_date is null then
    raise exception 'VALIDATION_ERROR: The invoice date is missing.' using errcode = 'P0001';
  end if;
  v_fy := private.fy_label(p_date);
  -- the row of this series is created (continuing after any number that already exists) or locked by the update: concurrent requests queue here
  insert into public.invoice_number_series (invoice_type, fy, last_value)
  values (p_type, v_fy, private.invoice_series_existing_max(p_type, v_fy) + 1)
  on conflict (invoice_type, fy) do update set last_value = public.invoice_number_series.last_value + 1, updated_at = now()
  returning last_value into v_n;
  loop
    v_no := private.invoice_number_text(p_type, v_fy, v_n);
    exit when not exists (select 1 from public.member_invoices x where lower(x.invoice_number) = lower(v_no));
    v_n := v_n + 1;   -- taken by something else (an uploaded invoice that was typed with this number): the next free one
    update public.invoice_number_series set last_value = v_n, updated_at = now() where invoice_type = p_type and fy = v_fy;
  end loop;
  return v_no;
end $$;
revoke all on function private.take_invoice_number(text, date) from public, anon, authenticated;

-- what the next number WOULD be (a preview for the builder; takes nothing)
create or replace function private.peek_invoice_number(p_type text, p_date date)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_fy text := private.fy_label(p_date);
  v_n integer;
  v_no text;
begin
  select coalesce((select s.last_value from public.invoice_number_series s where s.invoice_type = p_type and s.fy = v_fy),
                  private.invoice_series_existing_max(p_type, v_fy)) + 1 into v_n;
  loop
    v_no := private.invoice_number_text(p_type, v_fy, v_n);
    exit when not exists (select 1 from public.member_invoices x where lower(x.invoice_number) = lower(v_no));
    v_n := v_n + 1;
  end loop;
  return v_no;
end $$;
revoke all on function private.peek_invoice_number(text, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- accounts_issue_invoice: the number comes from the series (same function otherwise)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_issue_invoice(p_request uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_customer uuid;
  c public.customers;
  r public.addon_requests;
  g public.generated_invoices;
  inv public.member_invoices;
  cu jsonb;
  v_purpose text;
  v_no text;
  v_type text;
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

  -- The invoice number is assigned HERE, when the invoice is finalised (below), from the series of its type and financial year.
  -- A number sent by the browser is never used.
  if nullif(btrim(coalesce(p_payload ->> 'invoiceNumber', '')), '') is not null then
    raise exception 'VALIDATION_ERROR: Invoice numbers are assigned by the system when the invoice is issued. Leave the number empty.' using errcode = 'P0001';
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
  -- GST invoice: any line taxed above 0%. Non-GST invoice: every line at 0%. The number comes from the series of that type and of the
  -- financial year of the invoice date; taking it locks the series row, so two requests can never get the same number, and it is taken only
  -- now (after every check), inside the transaction that saves the invoice, so a refused invoice leaves no gap.
  v_type := case when (v_calc ->> 'totalGst')::numeric > 0 then 'GST' else 'NON_GST' end;
  v_no := private.take_invoice_number(v_type, v_date);
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

-- the builder's prefill: a preview of the next numbers, nothing is taken
create or replace function public.accounts_invoice_prefill(p_customer uuid, p_purpose text DEFAULT 'SERVICES'::text, p_addon_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  v_suggest text;
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

  -- Only a preview: the number is taken from its series when the invoice is issued. GST when a line is taxed above 0%.
  v_suggest := private.peek_invoice_number(
    case when exists (select 1 from jsonb_array_elements(coalesce(v_lines, '[]'::jsonb)) l where coalesce(nullif(l ->> 'taxRate', '')::numeric, 0) > 0)
         then 'GST' else 'NON_GST' end,
    (now() at time zone 'Asia/Kolkata')::date);

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
    'nextInvoiceNumbers', jsonb_build_object('GST', private.peek_invoice_number('GST', (now() at time zone 'Asia/Kolkata')::date),
                                             'NON_GST', private.peek_invoice_number('NON_GST', (now() at time zone 'Asia/Kolkata')::date)),
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
revoke all on function public.accounts_invoice_prefill(uuid, text, uuid) from public, anon;
grant execute on function public.accounts_invoice_prefill(uuid, text, uuid) to authenticated;

-- the invoice snapshot (PDF, e-mail, WhatsApp, screens) carries the type next to the number
create or replace function private.generated_json(p_invoice uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
  select jsonb_build_object(
    'number', g.invoice_number, 'invoiceType', private.invoice_type_of(g.total_gst), 'invoiceDate', g.invoice_date, 'orderNumber', g.order_number,
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


notify pgrst, 'reload schema';
