-- =============================================================================
-- The 6 migrations of "invoice series (GST / Amuwa per financial year)", "customer revenue report", "Department Head e-mails for payments and
-- expenses", "one expense across several departments", "Client Panel URL" and "Department Head hand-over queue", in order.
-- Paste the whole file into the Supabase SQL editor and run it once. Every part is safe to run again; nothing is deleted, no existing invoice,
-- payment, expense or audit row is changed, and nothing is sent.
--   1. 20261209000100_invoice_series.sql
--   2. 20261209000200_customer_revenue_report.sql
--   3. 20261209000300_finance_department_mail.sql
--   4. 20261209000400_expense_allocations.sql
--   5. 20261209000500_client_panel_url.sql
--   6. 20261209000600_department_head_handover_queue.sql
-- Needs the earlier migrations in place, including 20261209000100_client_onboarding_journey.sql (the hand-over function keeps its "Meta verification
-- first" check). Then deploy the app. Afterwards (see docs/ACCOUNTS_FINANCE_AND_WORKFLOW.md):
--   * configure the WhatsApp Automation Builder routes (Website Ready, Meta Verification vs Status Completed, INVOICE_PAID);
--   * open the hand-over reconciliation report (GET /api/v1/workflow/handover-reconciliation) and decide what to do with what it lists.
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000100_invoice_series.sql
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000200_customer_revenue_report.sql
-- =============================================================================
-- Accounts -> Customer-wise Revenue.
--
-- One row per customer, built from the SAME records the Business Reports already use (so the figures agree with them):
--   private.business_orders()  every order (the agreed services, an invoice-only services order, an approved add-on, a tagged renewal / add-on
--                              invoice) with the amount billed on it, its department attribution and its date;
--   private.business_ledger()  every payment, already attached to ITS order (order_key) and classed COLLECTED / PENDING / REFUNDED;
--   monthly plans Accounts activated as paid (a plan is an order that is billed and collected in one step).
-- The measures are kept apart and never relabelled:
--   purchased    what was ordered (billed on the customer's orders; GST included when the order carries GST)
--   invoiced     what the customer's NON-CANCELLED invoices add up to
--   collected    VERIFIED money received (never an invoice, never a pending payment)
--   pending      recorded but not yet verified
--   refunded     reversed
--   outstanding  per order: billed - collected (never below zero), summed - the way the Business Reports do it
-- Each payment sits on exactly one order, and each order on exactly one customer, so nothing is counted twice however many services or
-- invoices a customer has. Money in the ledger that sits on no known order is NOT added to any order: it is shown on its own as
-- "receipts without an order" so a gap in the data is visible instead of hidden.
--
-- The date range selects ORDERS by their order date; the payment figures are those of the selected orders. Department = the department the order
-- is attributed to (not the customer's current department). Service = the customer has that service.
-- Read-only, Accounts (and Super Admin) only. Safe to run again; nothing is changed.
-- =============================================================================

create or replace function public.accounts_customer_revenue(
  p_from date default null, p_to date default null, p_service text default null, p_department uuid default null,
  p_search text default null, p_sort text default 'PURCHASED', p_dir text default 'DESC', p_page integer default 1, p_page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_search text := nullif(left(lower(btrim(coalesce(p_search, ''))), 100), '');
  v_sort text := upper(coalesce(nullif(btrim(p_sort), ''), 'PURCHASED'));
  v_dir text := upper(coalesce(nullif(btrim(p_dir), ''), 'DESC'));
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v jsonb;
begin
  perform private.require_accounts_staff();
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'VALIDATION_ERROR: The end date is before the start date.' using errcode = 'P0001';
  end if;
  if v_sort not in ('PURCHASED', 'INVOICED', 'COLLECTED', 'PENDING', 'OUTSTANDING', 'ORDERS', 'NAME') then
    raise exception 'VALIDATION_ERROR: Unknown sort.' using errcode = 'P0001';
  end if;
  if v_dir not in ('ASC', 'DESC') then
    raise exception 'VALIDATION_ERROR: Unknown sort direction.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.crm_services s where s.code = p_service) then
    raise exception 'VALIDATION_ERROR: Unknown service.' using errcode = 'P0001';
  end if;
  if p_department is not null and not exists (select 1 from public.departments d where d.id = p_department) then
    raise exception 'VALIDATION_ERROR: Unknown department.' using errcode = 'P0001';
  end if;

  with ords_all as (
    select o.order_key, o.customer_id, o.order_type, o.department_id, o.billed, o.billed_at from private.business_orders() o
    union all
    select 'PLAN:' || cp.id::text, cp.customer_id, 'SUBSCRIPTION', private.revenue_department(c.department_id, 'SUPPORT'), cp.price_at_start,
           cp.started_at::timestamp at time zone 'Asia/Kolkata'
      from public.customer_plans cp join public.customers c on c.id = cp.customer_id
     where cp.payment_status = 'PAID' and cp.price_at_start > 0),
  ords as (   -- a cancelled invoice no longer counts toward its order
    select a.* from ords_all a
     where not exists (select 1 from public.generated_invoices g where a.order_key = 'INV:' || g.invoice_id::text and g.cancelled_at is not null)),
  sel as (
    select o.* from ords o
     where (p_from is null or o.billed_at >= private.business_day_start(p_from))
       and (p_to is null or o.billed_at < private.business_day_start(p_to + 1))
       and (p_department is null or o.department_id = p_department)),
  pay as (
    select l.order_key,
           coalesce(sum(l.amount) filter (where l.status = 'COLLECTED'), 0) collected,
           coalesce(sum(l.amount) filter (where l.status = 'PENDING'), 0) pending,
           coalesce(sum(l.amount) filter (where l.status = 'REFUNDED'), 0) refunded
      from private.business_ledger() l group by l.order_key),
  per_order as (
    select s.*, coalesce(p.collected, 0) collected, coalesce(p.pending, 0) pending, coalesce(p.refunded, 0) refunded,
           greatest(s.billed - coalesce(p.collected, 0), 0) outstanding,
           -- the non-cancelled invoices of THIS order
           coalesce(inv.n, 0) invoice_n, coalesce(inv.total, 0) invoice_total, coalesce(inv.gst, 0) invoice_gst
      from sel s
      left join pay p on p.order_key = s.order_key
      left join lateral (
        select count(*) n, coalesce(sum(m.amount), 0) total, coalesce(sum(g.total_gst), 0) gst
          from public.member_invoices m
          left join public.generated_invoices g on g.invoice_id = m.id
         where m.kind in ('SERVICE', 'UPLOADED', 'GENERATED') and m.status <> 'Cancelled' and g.cancelled_at is null
           and ((s.order_key like 'SALE:%' and m.customer_id = s.customer_id and m.addon_request_id is null and coalesce(g.purpose, 'SERVICES') = 'SERVICES')
             or (s.order_key like 'ADDON:%' and m.addon_request_id::text = substr(s.order_key, 7))
             or (s.order_key like 'INV:%' and m.id::text = substr(s.order_key, 5)))) inv on true),
  stray as (   -- money in the ledger that sits on no known order
    select l.customer_id, sum(l.amount) filter (where l.status = 'COLLECTED') amount
      from private.business_ledger() l
     where l.status = 'COLLECTED' and not exists (select 1 from ords_all a where a.order_key = l.order_key)
     group by l.customer_id),
  by_cust as (
    select po.customer_id,
           count(*) orders, sum(po.billed) purchased, sum(po.invoice_total) invoiced, sum(po.invoice_n) invoice_n, sum(po.invoice_gst) invoice_gst,
           sum(po.collected) collected, sum(po.pending) pending, sum(po.refunded) refunded, sum(po.outstanding) outstanding,
           max(po.billed_at) last_order_at
      from per_order po group by po.customer_id),
  base_ as (   -- customers with orders in the selection; with no date / department filter also those that only have receipts without an order
    select b.customer_id, b.orders, b.purchased, b.invoiced, b.invoice_n, b.invoice_gst, b.collected, b.pending, b.refunded, b.outstanding, b.last_order_at from by_cust b
    union all
    select st.customer_id, 0, 0, 0, 0, 0, 0, 0, 0, 0, null::timestamptz from stray st
     where p_from is null and p_to is null and p_department is null and not exists (select 1 from by_cust b where b.customer_id = st.customer_id)),
  rows_ as (
    select b.*, c.name, c.company, c.customer_code, coalesce(st.amount, 0) stray_amount,
           coalesce((select jsonb_agg(sv.name order by sv.sort_order) from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code
                      where cs.customer_id = c.id), '[]'::jsonb) services
      from base_ b
      join public.customers c on c.id = b.customer_id
      left join stray st on st.customer_id = b.customer_id
     where (p_service is null or exists (select 1 from public.customer_services cs where cs.customer_id = c.id and cs.service_code = p_service))
       and (v_search is null or lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.customer_code, '')) like '%' || v_search || '%')),
  ordered as (
    select r.*, row_number() over (order by
        case when v_dir = 'ASC' then case v_sort when 'PURCHASED' then r.purchased when 'INVOICED' then r.invoiced when 'COLLECTED' then r.collected
                  when 'PENDING' then r.pending when 'OUTSTANDING' then r.outstanding when 'ORDERS' then r.orders::numeric end end asc,
        case when v_dir = 'DESC' then case v_sort when 'PURCHASED' then r.purchased when 'INVOICED' then r.invoiced when 'COLLECTED' then r.collected
                  when 'PENDING' then r.pending when 'OUTSTANDING' then r.outstanding when 'ORDERS' then r.orders::numeric end end desc,
        case when v_sort = 'NAME' and v_dir = 'ASC' then lower(coalesce(r.company, r.name)) end asc,
        case when v_sort = 'NAME' and v_dir = 'DESC' then lower(coalesce(r.company, r.name)) end desc,
        r.customer_id) rn
      from rows_ r),
  top5 as (select * from rows_ order by purchased desc, customer_id limit 5)
  select jsonb_build_object(
    'total', (select count(*) from rows_), 'page', v_page, 'pageSize', v_size,
    'totals', (select jsonb_build_object('customers', count(*), 'orders', coalesce(sum(orders), 0), 'purchased', coalesce(sum(purchased), 0), 'invoiced', coalesce(sum(invoiced), 0),
                  'collected', coalesce(sum(collected), 0), 'pending', coalesce(sum(pending), 0), 'refunded', coalesce(sum(refunded), 0),
                  'outstanding', coalesce(sum(outstanding), 0), 'receiptsWithoutOrder', coalesce(sum(stray_amount), 0)) from rows_),
    'top', coalesce((select jsonb_agg(jsonb_build_object('customerId', t.customer_id, 'name', coalesce(t.company, t.name), 'purchased', t.purchased, 'collected', t.collected) order by t.purchased desc, t.customer_id) from top5 t), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'customerId', o.customer_id, 'code', o.customer_code, 'name', o.name, 'company', o.company, 'services', o.services,
        'orders', o.orders, 'purchased', o.purchased, 'invoiced', o.invoiced, 'invoiceCount', o.invoice_n, 'gstInvoiced', o.invoice_gst,
        'collected', o.collected, 'pending', o.pending, 'refunded', o.refunded, 'outstanding', o.outstanding,
        'receiptsWithoutOrder', o.stray_amount, 'lastOrderAt', o.last_order_at) order by o.rn)
        from ordered o where o.rn > (v_page - 1) * v_size and o.rn <= v_page * v_size), '[]'::jsonb)) into v;
  return v;
end $$;
revoke all on function public.accounts_customer_revenue(date, date, text, uuid, text, text, text, integer, integer) from public, anon;
grant execute on function public.accounts_customer_revenue(date, date, text, uuid, text, text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000300_finance_department_mail.sql
-- =============================================================================
-- E-mail to the responsible Department Head when revenue or an expense is recorded.
--
-- Events (each is a row in public.finance_mail_events, one per RECIPIENT, so every head has a status of their own):
--   PAYMENT_RECORDED   a payment was recorded and is pending verification (never described as collected)
--   PAYMENT_VERIFIED   a payment is verified (recorded and verified in one step also gives only this one)
--   EXPENSE_ADDED      an expense was recorded: one event per department that received an allocation (see migration 20261209000400)
-- Recipients: the ACTIVE Department Heads of the department, read live (role DEPARTMENT_HEAD of that department, plus heads who were given
-- access to it in department_access) with a valid address; nothing is hard-coded. No active head: a NO_RECIPIENT row (visible to Accounts, who can
-- retry once a head exists) and an in-app notice to the Super Admins as the escalation path.
-- Department of a payment = the department its ORDER is attributed to (revenue_attributions, else the revenue rule of the customer's
-- department): an original sale -> Sales, an add-on -> Support, a tagged renewal/add-on invoice -> Support. Not simply the customer's department.
--
-- How it is kept reliable
--   * The e-mail is queued by an AFTER trigger on the payment tables, in the same transaction as the payment, as plain rows: no network call is
--     made inside a financial transaction, and a failure to queue never rolls the payment back (it is caught and reported as a warning).
--   * One row per (event, recipient): a retried request or a repeated trigger cannot queue it twice.
--   * The server sends them (server/automations/financeDispatcher.ts) through the existing mail setup: claimed with SKIP LOCKED, bounded retries
--     (1, 5, 15, 60 minutes, then FAILED), a per-recipient status, a retry for Accounts, a notice to Accounts when one finally fails.
--   * What is in the e-mail: customer, reference, services, department, amount, status, time, a link to the dashboard. No payment reference, no
--     bank detail, no customer phone / e-mail. An expense mail carries ONLY that department's allocated amount.
-- Payments imported from older records (source LEGACY) send nothing. Safe to run again. Nothing is sent by running it.
-- =============================================================================

create table if not exists public.finance_mail_events (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique check (length(dedupe_key) <= 300),
  kind text not null check (kind in ('PAYMENT_RECORDED', 'PAYMENT_VERIFIED', 'EXPENSE_ADDED')),
  event_token text not null,                       -- the payment / expense this is about (to find all recipients of one event)
  department_id uuid not null references public.departments (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  recipient_id uuid references public.profiles (id) on delete set null,
  recipient_email text check (length(recipient_email) <= 254),
  recipient_name text check (length(recipient_name) <= 200),
  payload jsonb not null default '{}'::jsonb check (pg_column_size(payload) <= 4096),
  status text not null default 'QUEUED' check (status in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'NO_RECIPIENT', 'CANCELLED')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  detail text check (length(detail) <= 500),
  response_code integer,
  provider_ref text check (length(provider_ref) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists finance_mail_events_due_idx on public.finance_mail_events (next_attempt_at) where status in ('QUEUED', 'SENDING');
create index if not exists finance_mail_events_department_idx on public.finance_mail_events (department_id, created_at desc);
create index if not exists finance_mail_events_token_idx on public.finance_mail_events (event_token);
alter table public.finance_mail_events enable row level security;
revoke all on public.finance_mail_events from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who is the Department Head of a department (live)
-- ---------------------------------------------------------------------------
create or replace function private.department_head_recipients(p_department uuid, p_division text default null)
returns table (profile_id uuid, email text, full_name text)
language sql stable security definer set search_path = '' as $$
  select distinct on (lower(p.email)) p.id, lower(p.email), p.full_name
    from public.profiles p
   where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD'
     and (p.department_id = p_department
          or exists (select 1 from public.department_access a where a.profile_id = p.id and a.department_id = p_department
                      and (p_division is null or a.division = p_division)))
     -- a department can have a Sales head and a Support head: a Sales order's e-mail goes to the Sales side (and to a head who has no side).
     -- A head given access to ANOTHER department receives for the side the access was given for.
     and (p_division is null or p.head_division is null or p.head_division = p_division or p.department_id <> p_department)
     and p.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
   order by lower(p.email), p.created_at
$$;
revoke all on function private.department_head_recipients(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Queue one event for a department: one row per head, or a NO_RECIPIENT row and a notice to the Super Admins
-- ---------------------------------------------------------------------------
create or replace function private.finance_mail_queue(p_kind text, p_department uuid, p_customer uuid, p_token text, p_payload jsonb, p_division text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  n integer := 0;
  v_inserted boolean;
  v_name text;
  sa uuid;
begin
  if p_department is null then
    return 0;
  end if;
  for r in select * from private.department_head_recipients(p_department, p_division) loop
    insert into public.finance_mail_events (dedupe_key, kind, event_token, department_id, customer_id, recipient_id, recipient_email, recipient_name, payload, created_by)
    values (format('FIN|%s|%s|%s|%s', p_kind, p_token, p_department, r.profile_id), p_kind, p_token, p_department, p_customer, r.profile_id, r.email, r.full_name, p_payload, (select private.my_id()))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted then n := n + 1; end if;
  end loop;
  if n = 0 and not exists (select 1 from public.finance_mail_events e where e.kind = p_kind and e.event_token = p_token and e.department_id = p_department and e.status <> 'NO_RECIPIENT') then
    insert into public.finance_mail_events (dedupe_key, kind, event_token, department_id, customer_id, payload, status, detail, created_by)
    values (format('FIN|%s|%s|%s|NONE', p_kind, p_token, p_department), p_kind, p_token, p_department, p_customer, p_payload, 'NO_RECIPIENT',
            'The department has no active Department Head with a valid e-mail address. Nothing was sent.', (select private.my_id()))
    on conflict (dedupe_key) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted then
      select name into v_name from public.departments where id = p_department;
      for sa in select id from public.profiles where role = 'SUPER_ADMIN' and status = 'ACTIVE' loop
        perform private.notify(sa, 'FINANCE_MAIL_NO_RECIPIENT', format('No Department Head to e-mail: %s', coalesce(v_name, 'a department')),
          'A payment or expense was recorded for this department, but it has no active Department Head with a valid e-mail address. Assign one; Accounts can then send the e-mail again.',
          'department', p_department, '{}'::jsonb, 'urgent');
      end loop;
    end if;
  end if;
  return n;
end $$;
revoke all on function private.finance_mail_queue(text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Which department earns a payment (the same rule the income reports use), and a plain description of it
-- ---------------------------------------------------------------------------
create or replace function private.payment_mail_context(p_source text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid; v_amount numeric; v_status text; v_type text; v_department uuid; v_ref text; v_services text; v_division text;
  c public.customers;
begin
  if p_source = 'CP' then
    select customer_id, amount, status, payment_type into v_customer, v_amount, v_status, v_type from public.customer_payments where id = p_id;
    select * into c from public.customers where id = v_customer;
    select a.department_id, a.division into v_department, v_division from public.revenue_attributions a where a.order_key = 'SALE:' || v_customer::text;
    v_department := coalesce(v_department, private.revenue_department(c.department_id, 'SALES'));
    v_division := coalesce(v_division, 'SALES');
    v_ref := 'Order of ' || coalesce(c.customer_code, 'the customer');
    select string_agg(s.name, ', ' order by s.sort_order) into v_services
      from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = v_customer;
  elsif p_source = 'AP' then
    select p.customer_id, p.amount, p.status, 'ADDON', p.request_id into v_customer, v_amount, v_status, v_type, p_id from public.addon_payments p where p.id = p_id;
    select * into c from public.customers where id = v_customer;
    select a.department_id, a.division into v_department, v_division from public.revenue_attributions a where a.order_key = 'ADDON:' || p_id::text;
    v_department := coalesce(v_department, private.revenue_department(c.department_id, 'SUPPORT'));
    v_division := coalesce(v_division, 'SUPPORT');
    v_ref := 'Add-on of ' || coalesce(c.customer_code, 'the customer');
    select string_agg(i.name, ', ' order by i.sort_order) into v_services from public.addon_request_items i where i.request_id = p_id;
  else
    select ip.customer_id, ip.amount, ip.status, ip.payment_type, ip.invoice_id into v_customer, v_amount, v_status, v_type, p_id from public.invoice_payments ip where ip.id = p_id;
    select * into c from public.customers where id = v_customer;
    select m.invoice_number into v_ref from public.member_invoices m where m.id = p_id;
    v_ref := 'Invoice ' || coalesce(v_ref, '');
    select a.department_id, a.division into v_department, v_division from public.revenue_attributions a where a.order_key = 'INV:' || p_id::text;
    v_division := coalesce(v_division, case when exists (select 1 from public.generated_invoices g where g.invoice_id = p_id and g.purpose = 'SERVICES') then 'SALES' else 'SUPPORT' end);
    v_department := coalesce(v_department, private.revenue_department(c.department_id, v_division));
    select coalesce(s.name, 'Invoice payment') into v_services from public.invoice_business_tags t left join public.crm_services s on s.code = t.service_code where t.invoice_id = p_id;
  end if;
  return jsonb_build_object('customerId', v_customer, 'departmentId', v_department, 'division', v_division, 'status', v_status, 'amount', v_amount,
    'payload', jsonb_build_object('customer', coalesce(nullif(btrim(c.company), ''), c.name), 'customerCode', c.customer_code, 'orderRef', v_ref,
      'services', v_services, 'amount', v_amount, 'paymentType', v_type));
end $$;
revoke all on function private.payment_mail_context(text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The triggers: a payment is recorded (pending), verified, or recorded already verified
-- ---------------------------------------------------------------------------
create or replace function private.tg_finance_payment_mail()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_src text := case tg_table_name when 'customer_payments' then 'CP' when 'addon_payments' then 'AP' else 'IP' end;
  v_kind text;
  v_ctx jsonb;
  v_dept text;
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'VERIFIED' then v_kind := 'PAYMENT_VERIFIED';
      elsif new.status = 'PENDING' then v_kind := 'PAYMENT_RECORDED';
      end if;
    elsif old.status is distinct from 'VERIFIED' and new.status = 'VERIFIED' then
      v_kind := 'PAYMENT_VERIFIED';
    end if;
    if v_kind is null then return new; end if;
    if v_src = 'CP' and to_jsonb(new) ->> 'source' = 'LEGACY' then return new; end if;   -- records brought in from older systems send nothing
    v_ctx := private.payment_mail_context(v_src, new.id);
    if (v_ctx ->> 'departmentId') is null then return new; end if;
    select name into v_dept from public.departments where id = (v_ctx ->> 'departmentId')::uuid;
    perform private.finance_mail_queue(v_kind, (v_ctx ->> 'departmentId')::uuid, (v_ctx ->> 'customerId')::uuid, v_src || ':' || new.id::text,
      (v_ctx -> 'payload') || jsonb_build_object('department', v_dept, 'at', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM'),
        'verifiedAmount', case when v_kind = 'PAYMENT_VERIFIED' then new.amount end,
        'status', case when v_kind = 'PAYMENT_VERIFIED' then 'VERIFIED' else 'PENDING_VERIFICATION' end, 'division', v_ctx ->> 'division'),
      v_ctx ->> 'division');
  exception when others then
    -- the payment is the business record: telling someone about it must never undo it
    raise warning 'finance e-mail could not be queued for % %: %', tg_table_name, new.id, sqlerrm;
  end;
  return new;
end $$;
revoke all on function private.tg_finance_payment_mail() from public, anon, authenticated;

drop trigger if exists customer_payments_finance_mail on public.customer_payments;
create trigger customer_payments_finance_mail after insert or update of status on public.customer_payments for each row execute function private.tg_finance_payment_mail();
drop trigger if exists addon_payments_finance_mail on public.addon_payments;
create trigger addon_payments_finance_mail after insert or update of status on public.addon_payments for each row execute function private.tg_finance_payment_mail();
drop trigger if exists invoice_payments_finance_mail on public.invoice_payments;
create trigger invoice_payments_finance_mail after insert or update of status on public.invoice_payments for each row execute function private.tg_finance_payment_mail();

-- ---------------------------------------------------------------------------
-- The sender (service role): claim, finish
-- ---------------------------------------------------------------------------
create or replace function public.finance_mail_claim(p_limit integer default 10, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    select e.id from public.finance_mail_events e
     where ((e.status = 'QUEUED' and e.next_attempt_at <= now()) or (e.status = 'SENDING' and e.locked_until < now()))
       and (p_only_recipients is null or lower(e.recipient_email) = any (p_only_recipients))
     order by e.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;
  update public.finance_mail_events
     set status = 'SENDING', attempts = attempts + 1, locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 600), 1800))), updated_at = now()
   where id = any (v_ids);
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'attempts', e.attempts, 'to', e.recipient_email, 'toName', e.recipient_name,
                     'payload', e.payload) order by e.next_attempt_at)
                     from public.finance_mail_events e where e.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.finance_mail_claim(integer, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.finance_mail_claim(integer, text, integer, text[]) to service_role;

create or replace function public.finance_mail_finish(p_event uuid, p_outcome text, p_detail text default null, p_response_code integer default null, p_provider_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.finance_mail_events;
  v_status text;
  v_acc uuid;
  v_dept text;
begin
  if p_outcome not in ('SENT', 'SKIPPED', 'FAILED', 'RETRY') then
    raise exception 'VALIDATION_ERROR: Unknown outcome.' using errcode = 'P0001';
  end if;
  select * into e from public.finance_mail_events where id = p_event for update;
  if e.id is null or e.status <> 'SENDING' then
    raise exception 'CONFLICT: This e-mail is not being sent.' using errcode = 'P0001';
  end if;
  v_status := case when p_outcome = 'RETRY' and e.attempts >= 5 then 'FAILED' when p_outcome = 'RETRY' then 'QUEUED' else p_outcome end;
  update public.finance_mail_events
     set status = v_status, detail = left(p_detail, 500), response_code = p_response_code, provider_ref = coalesce(left(p_provider_ref, 200), provider_ref),
         locked_until = null, updated_at = now(),
         next_attempt_at = case when v_status = 'QUEUED' then now() + (array[1, 5, 15, 60])[least(greatest(e.attempts, 1), 4)] * interval '1 minute' else next_attempt_at end,
         sent_at = case when v_status = 'SENT' then now() else sent_at end
   where id = p_event returning * into e;
  if v_status = 'FAILED' then
    select name into v_dept from public.departments where id = e.department_id;
    for v_acc in select p.id from public.profiles p join public.departments d on d.id = p.department_id where p.status = 'ACTIVE' and d.slug = 'accounts' loop
      perform private.notify(v_acc, 'AUTOMATION_FAILED', format('Department e-mail not sent: %s', coalesce(v_dept, 'a department')),
        format('The e-mail about a %s to the Department Head could not be sent after %s attempts: %s. Open Finance e-mails and send it again.',
               case e.kind when 'EXPENSE_ADDED' then 'new expense' else 'payment' end, e.attempts, coalesce(left(p_detail, 300), 'unknown error')),
        'department', e.department_id, '{}'::jsonb, 'urgent');
    end loop;
  end if;
  return jsonb_build_object('id', e.id, 'status', e.status);
end $$;
revoke all on function public.finance_mail_finish(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.finance_mail_finish(uuid, text, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- Accounts: see the status of every e-mail, and send a failed / unsent one again
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_mail_list(p_status text default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  if p_status is not null and p_status not in ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'SKIPPED', 'NO_RECIPIENT', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (select status, count(*) n from public.finance_mail_events group by status) x),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'status', e.status, 'detail', e.detail, 'attempts', e.attempts, 'department', d.name, 'departmentId', e.department_id,
        'recipient', e.recipient_name, 'to', e.recipient_email, 'sentAt', e.sent_at, 'createdAt', e.created_at,
        'customer', e.payload ->> 'customer', 'amount', case when e.kind = 'EXPENSE_ADDED' then e.payload -> 'allocated' else e.payload -> 'amount' end,
        'canRetry', e.status in ('FAILED', 'SKIPPED', 'NO_RECIPIENT')) order by e.created_at desc)
        from (select * from public.finance_mail_events x where p_status is null or x.status = p_status order by x.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) e
        join public.departments d on d.id = e.department_id), '[]'::jsonb));
end $$;
revoke all on function public.accounts_finance_mail_list(text, integer) from public, anon;
grant execute on function public.accounts_finance_mail_list(text, integer) to authenticated;

create or replace function public.accounts_finance_mail_retry(p_event uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.finance_mail_events;
  n integer;
begin
  perform private.require_accounts_staff();
  select * into e from public.finance_mail_events where id = p_event for update;
  if e.id is null then
    raise exception 'NOT_FOUND: E-mail not found.' using errcode = 'P0001';
  end if;
  if e.status = 'NO_RECIPIENT' then
    -- look for a Department Head again; this row is closed once there is one
    n := private.finance_mail_queue(e.kind, e.department_id, e.customer_id, e.event_token || '#retry', e.payload, e.payload ->> 'division');
    if n = 0 then
      raise exception 'CONFLICT: The department still has no active Department Head with a valid e-mail address.' using errcode = 'P0001';
    end if;
    update public.finance_mail_events set status = 'CANCELLED', detail = 'A Department Head was found; the e-mail was queued again.', updated_at = now() where id = e.id;
    return jsonb_build_object('queued', n);
  elsif e.status in ('FAILED', 'SKIPPED') then
    update public.finance_mail_events set status = 'QUEUED', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null, updated_at = now() where id = e.id;
    return jsonb_build_object('queued', 1);
  end if;
  raise exception 'CONFLICT: Only a failed, unsent or recipient-less e-mail can be sent again.' using errcode = 'P0001';
end $$;
revoke all on function public.accounts_finance_mail_retry(uuid) from public, anon;
grant execute on function public.accounts_finance_mail_retry(uuid) to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000400_expense_allocations.sql
-- =============================================================================
-- One expense, several departments.
--
-- What was wrong
--   department_expenses had ONE department_id per row, so an expense shared by several departments had to be typed as several unrelated rows
--   (and counted as several expenses).
--
-- Now
--   * The expense is stored once (department_expenses: description, date, category, total amount, status). Who bears how much is in
--     public.expense_allocations (expense, department, amount), one row per department.
--   * The allocations of an expense ALWAYS add up to its amount: a deferred constraint trigger refuses the transaction otherwise, whatever wrote
--     it. An expense without allocations is a company-wide expense (as before).
--   * accounts_add_expense_split / accounts_update_expense_split take the whole allocation list and save it in one transaction. The server
--     recalculates the sum; a repeated request (same request id) returns the same expense. The same department twice is COMBINED into one row.
--     Amounts have at most two decimals and are above zero; departments must exist.
--   * Company totals count the expense once at its full amount; a department's totals count only its allocated part. Department Income /
--     Expense, the Accounts overview and the dashboards read the allocations.
--   * The older single-department functions keep working: the department_id column and the one-row allocation are kept in step by a trigger, and
--     editing an expense that is split through the old function is refused (it would silently drop the split).
--   * Existing expenses get their one allocation (their department, their full amount) here; company-wide ones stay without allocations.
--   * Every department that receives an allocation of a NEW manual expense gets its own e-mail (migration 20261209000300), with only its own
--     amount.
-- Safe to run again. No expense is changed or deleted.
-- =============================================================================

alter table public.department_expenses add column if not exists request_id uuid;
create unique index if not exists department_expenses_request_key on public.department_expenses (request_id) where request_id is not null;

create table if not exists public.expense_allocations (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.department_expenses (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (expense_id, department_id)
);
create index if not exists expense_allocations_department_idx on public.expense_allocations (department_id);
alter table public.expense_allocations enable row level security;
revoke all on public.expense_allocations from public, anon, authenticated;

-- the expenses that exist already: their department takes all of the amount
insert into public.expense_allocations (expense_id, department_id, amount)
select e.id, e.department_id, e.amount from public.department_expenses e
 where e.department_id is not null
   and not exists (select 1 from public.expense_allocations a where a.expense_id = e.id)
on conflict (expense_id, department_id) do nothing;

-- ---------------------------------------------------------------------------
-- The allocations always add up to the amount (checked at the end of the transaction, whoever wrote them)
-- ---------------------------------------------------------------------------
create or replace function private.check_expense_allocations_total(p_expense uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_amount numeric;
  v_sum numeric;
  v_n integer;
begin
  select amount into v_amount from public.department_expenses where id = p_expense;
  if v_amount is null then
    return;   -- the expense is gone (deleted together with its allocations)
  end if;
  select coalesce(sum(a.amount), 0), count(*) into v_sum, v_n from public.expense_allocations a where a.expense_id = p_expense;
  if v_n > 0 and v_sum <> v_amount then
    raise exception 'VALIDATION_ERROR: The department amounts (%) must add up to the expense amount (%).', v_sum, v_amount using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_expense_allocations_total(uuid) from public, anon, authenticated;
create or replace function private.tg_allocations_total()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_expense_allocations_total(coalesce(new.expense_id, old.expense_id));
  return null;
end $$;
create or replace function private.tg_expense_amount_total()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.check_expense_allocations_total(new.id);
  return null;
end $$;
revoke all on function private.tg_allocations_total() from public, anon, authenticated;
revoke all on function private.tg_expense_amount_total() from public, anon, authenticated;
drop trigger if exists expense_allocations_total on public.expense_allocations;
create constraint trigger expense_allocations_total after insert or update or delete on public.expense_allocations
  deferrable initially deferred for each row execute function private.tg_allocations_total();
drop trigger if exists department_expenses_allocations_total on public.department_expenses;
create constraint trigger department_expenses_allocations_total after update of amount on public.department_expenses
  deferrable initially deferred for each row execute function private.tg_expense_amount_total();
drop function if exists private.tg_expense_allocations_total();

-- ---------------------------------------------------------------------------
-- A single-department expense written the old way keeps its one allocation in step
-- ---------------------------------------------------------------------------
create or replace function private.tg_expense_single_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.department_id is not null then
    delete from public.expense_allocations where expense_id = new.id and department_id <> new.department_id;
    insert into public.expense_allocations (expense_id, department_id, amount) values (new.id, new.department_id, new.amount)
    on conflict (expense_id, department_id) do update set amount = excluded.amount;
  elsif tg_op = 'UPDATE' and old.department_id is not null then
    delete from public.expense_allocations where expense_id = new.id;   -- it became company-wide
  end if;
  return null;
end $$;
revoke all on function private.tg_expense_single_allocation() from public, anon, authenticated;
drop trigger if exists department_expenses_single_allocation on public.department_expenses;
create trigger department_expenses_single_allocation after insert or update of department_id, amount on public.department_expenses
  for each row execute function private.tg_expense_single_allocation();

-- ---------------------------------------------------------------------------
-- A new manual expense tells each department's head about its own part
-- ---------------------------------------------------------------------------
create or replace function private.tg_expense_allocation_mail()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  e public.department_expenses;
  v_dept text;
begin
  begin
    select * into e from public.department_expenses where id = new.expense_id;
    if e.id is null or e.source <> 'MANUAL' then return null; end if;   -- imports (sheets, files) send nothing
    select name into v_dept from public.departments where id = new.department_id;
    perform private.finance_mail_queue('EXPENSE_ADDED', new.department_id, null, e.id::text,
      jsonb_build_object('description', e.description, 'category', e.category, 'date', to_char(e.expense_date, 'DD Mon YYYY'), 'allocated', new.amount,
                         'status', e.payment_status, 'department', v_dept, 'at', to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')));
  exception when others then
    raise warning 'finance e-mail could not be queued for expense %: %', new.expense_id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function private.tg_expense_allocation_mail() from public, anon, authenticated;
drop trigger if exists expense_allocations_mail on public.expense_allocations;
create trigger expense_allocations_mail after insert on public.expense_allocations for each row execute function private.tg_expense_allocation_mail();

-- ---------------------------------------------------------------------------
-- Checking an allocation list (used by add and update)
-- ---------------------------------------------------------------------------
create or replace function private.clean_expense_allocations(p_total numeric, p_allocations jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r jsonb;
  v_dept uuid;
  v_amt numeric;
  v_map jsonb := '{}'::jsonb;
  v_sum numeric := 0;
  k text;
  v_out jsonb := '[]'::jsonb;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'VALIDATION_ERROR: Add at least one department row.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_allocations) > 30 then
    raise exception 'VALIDATION_ERROR: At most 30 department rows.' using errcode = 'P0001';
  end if;
  for r in select * from jsonb_array_elements(p_allocations) loop
    begin
      v_dept := (r ->> 'departmentId')::uuid;
      v_amt := (r ->> 'amount')::numeric;
    exception when others then
      raise exception 'VALIDATION_ERROR: Each department row needs a department and an amount.' using errcode = 'P0001';
    end;
    if v_dept is null or v_amt is null or v_amt <= 0 then
      raise exception 'VALIDATION_ERROR: Each department row needs a department and an amount above zero.' using errcode = 'P0001';
    end if;
    if v_amt <> round(v_amt, 2) then
      raise exception 'VALIDATION_ERROR: Use at most 2 decimal places in a department amount.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.departments d where d.id = v_dept) then
      raise exception 'VALIDATION_ERROR: Choose each department from the list.' using errcode = 'P0001';
    end if;
    -- the same department twice is one department
    v_map := jsonb_set(v_map, array[v_dept::text], to_jsonb(coalesce((v_map ->> v_dept::text)::numeric, 0) + v_amt));
  end loop;
  for k in select jsonb_object_keys(v_map) loop
    v_sum := v_sum + (v_map ->> k)::numeric;
    v_out := v_out || jsonb_build_array(jsonb_build_object('departmentId', k, 'amount', (v_map ->> k)::numeric));
  end loop;
  if v_sum <> p_total then
    raise exception 'VALIDATION_ERROR: The department amounts add up to % but the expense is %. They must be equal.', v_sum, p_total using errcode = 'P0001';
  end if;
  return v_out;
end $$;
revoke all on function private.clean_expense_allocations(numeric, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Add / update an expense with its allocations, in one transaction
-- ---------------------------------------------------------------------------
create or replace function public.accounts_add_expense_split(p_request uuid, p_date date, p_description text, p_category text, p_amount numeric, p_status text, p_notes text, p_allocations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_alloc jsonb;
  v_n integer;
  a jsonb;
begin
  perform private.require_accounts_staff();
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request is missing its reference.' using errcode = 'P0001';
  end if;
  -- a repeated request (a double click, a retry) is the same expense
  select id into v_id from public.department_expenses where request_id = p_request;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'replayed', true);
  end if;
  perform private.check_expense_fields(p_date, p_description, null, p_category, p_amount, p_status, p_notes);
  -- no allocation rows = a company-wide expense
  v_alloc := case when jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) = 0 then '[]'::jsonb else private.clean_expense_allocations(p_amount, p_allocations) end;
  v_n := jsonb_array_length(v_alloc);
  insert into public.department_expenses (expense_date, description, department_id, category, amount, payment_status, notes, created_by, request_id)
  values (p_date, btrim(p_description), case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end, btrim(p_category), p_amount, p_status,
          nullif(btrim(coalesce(p_notes, '')), ''), (select private.my_id()), p_request)
  returning id into v_id;
  delete from public.expense_allocations where expense_id = v_id;   -- (the single-department trigger may have made one)
  for a in select * from jsonb_array_elements(v_alloc) loop
    insert into public.expense_allocations (expense_id, department_id, amount) values (v_id, (a ->> 'departmentId')::uuid, (a ->> 'amount')::numeric);
  end loop;
  perform private.write_audit('EXPENSE_ADDED', 'expense', v_id, case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end, null,
    jsonb_build_object('amount', p_amount, 'category', p_category, 'allocations', v_alloc));
  return jsonb_build_object('id', v_id, 'replayed', false);
end $$;
revoke all on function public.accounts_add_expense_split(uuid, date, text, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.accounts_add_expense_split(uuid, date, text, text, numeric, text, text, jsonb) to authenticated;

create or replace function public.accounts_update_expense_split(p_id uuid, p_date date, p_description text, p_category text, p_amount numeric, p_status text, p_notes text, p_allocations jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.department_expenses;
  v_alloc jsonb;
  v_n integer;
  a jsonb;
begin
  perform private.require_accounts_staff();
  select * into e from public.department_expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND: Expense not found.' using errcode = 'P0001'; end if;
  if not private.can_change_expense(e.created_by) then
    raise exception 'FORBIDDEN: You can only change expenses you added.' using errcode = '42501';
  end if;
  perform private.check_expense_fields(p_date, p_description, null, p_category, p_amount, p_status, p_notes);
  v_alloc := case when jsonb_typeof(p_allocations) = 'array' and jsonb_array_length(p_allocations) = 0 then '[]'::jsonb else private.clean_expense_allocations(p_amount, p_allocations) end;
  v_n := jsonb_array_length(v_alloc);
  update public.department_expenses set expense_date = p_date, description = btrim(p_description), category = btrim(p_category), amount = p_amount,
         payment_status = p_status, notes = nullif(btrim(coalesce(p_notes, '')), ''),
         department_id = case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end
   where id = p_id;
  delete from public.expense_allocations where expense_id = p_id;
  for a in select * from jsonb_array_elements(v_alloc) loop
    insert into public.expense_allocations (expense_id, department_id, amount) values (p_id, (a ->> 'departmentId')::uuid, (a ->> 'amount')::numeric);
  end loop;
  perform private.write_audit('EXPENSE_EDITED', 'expense', p_id, case when v_n = 1 then (v_alloc -> 0 ->> 'departmentId')::uuid end, null,
    jsonb_build_object('amount', p_amount, 'was', e.amount, 'allocations', v_alloc));
end $$;
revoke all on function public.accounts_update_expense_split(uuid, date, text, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.accounts_update_expense_split(uuid, date, text, text, numeric, text, text, jsonb) to authenticated;

-- the older single-department update must not silently drop a split
create or replace function public.accounts_update_expense(p_id uuid, p_date date, p_description text, p_department uuid, p_category text, p_amount numeric, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare e public.department_expenses;
begin
  perform private.require_accounts_staff();
  select * into e from public.department_expenses where id = p_id for update;
  if e.id is null then raise exception 'NOT_FOUND: Expense not found.' using errcode = 'P0001'; end if;
  if not private.can_change_expense(e.created_by) then
    raise exception 'FORBIDDEN: You can only change expenses you added.' using errcode = '42501';
  end if;
  if (select count(*) from public.expense_allocations a where a.expense_id = p_id) > 1 then
    raise exception 'CONFLICT: This expense is split across departments. Edit it with its department amounts.' using errcode = 'P0001';
  end if;
  perform private.check_expense_fields(p_date, p_description, p_department, p_category, p_amount, p_status, p_notes);
  update public.department_expenses set expense_date = p_date, description = btrim(p_description), department_id = p_department,
         category = btrim(p_category), amount = p_amount, payment_status = p_status, notes = nullif(btrim(coalesce(p_notes, '')), '')
   where id = p_id;
  perform private.write_audit('EXPENSE_EDITED', 'expense', p_id, p_department, null, jsonb_build_object('amount', p_amount, 'was', e.amount));
end $$;
revoke all on function public.accounts_update_expense(uuid, date, text, uuid, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_update_expense(uuid, date, text, uuid, text, numeric, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- The expense list shows the allocations; a department's filter is its allocation
-- ---------------------------------------------------------------------------
create or replace function public.accounts_expenses_list(p_search text DEFAULT NULL::text, p_department uuid DEFAULT NULL::uuid, p_company_wide boolean DEFAULT false, p_category text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_sum numeric; v_pending numeric; v_items jsonb; v_categories jsonb;
begin
  perform private.require_accounts_staff();
  if p_status is not null and p_status not in ('PAID', 'PENDING') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  select count(*), coalesce(sum(coalesce((select xa.amount from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department), e.amount)), 0),
         coalesce(sum(coalesce((select xa.amount from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department), e.amount)) filter (where e.payment_status = 'PENDING'), 0)
    into v_total, v_sum, v_pending
    from public.department_expenses e
   where (p_department is null or exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department)) and (not coalesce(p_company_wide, false) or not exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id))
     and (p_category is null or lower(e.category) = lower(p_category)) and (p_status is null or e.payment_status = p_status)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
     and (v_term is null or lower(e.description) like '%' || v_term || '%' or lower(e.category) like '%' || v_term || '%' or lower(coalesce(e.notes, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by expense_date desc, created_at desc), '[]'::jsonb) into v_items from (
    select e.expense_date, e.created_at, jsonb_build_object(
      'id', e.id, 'date', e.expense_date, 'description', e.description, 'departmentId', e.department_id, 'department', coalesce(d.name, (select string_agg(xd.name, ', ' order by xd.name) from public.expense_allocations xa join public.departments xd on xd.id = xa.department_id where xa.expense_id = e.id)),
      'allocations', coalesce((select jsonb_agg(jsonb_build_object('departmentId', xa.department_id, 'department', xd.name, 'amount', xa.amount) order by xd.name)
                                 from public.expense_allocations xa join public.departments xd on xd.id = xa.department_id where xa.expense_id = e.id), '[]'::jsonb),
      'allocatedToFilter', case when p_department is null then null else (select xa.amount from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department) end,
      'category', e.category, 'amount', e.amount, 'status', e.payment_status, 'notes', e.notes, 'source', e.source,
      'createdBy', (select full_name from public.profiles where id = e.created_by),
      'canChange', private.can_change_expense(e.created_by)) as j
      from public.department_expenses e left join public.departments d on d.id = e.department_id
     where (p_department is null or exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id and xa.department_id = p_department)) and (not coalesce(p_company_wide, false) or not exists (select 1 from public.expense_allocations xa where xa.expense_id = e.id))
       and (p_category is null or lower(e.category) = lower(p_category)) and (p_status is null or e.payment_status = p_status)
       and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
       and (v_term is null or lower(e.description) like '%' || v_term || '%' or lower(e.category) like '%' || v_term || '%' or lower(coalesce(e.notes, '')) like '%' || v_term || '%')
     order by e.expense_date desc, e.created_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  select coalesce(jsonb_agg(c order by c), '[]'::jsonb) into v_categories from (select distinct category as c from public.department_expenses) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'sum', v_sum, 'pending', v_pending, 'categories', v_categories,
                            'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_expenses_list(text, uuid, boolean, text, text, date, date, integer, integer) from public, anon;
grant execute on function public.accounts_expenses_list(text, uuid, boolean, text, text, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Department totals use each department's allocated part
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_by_department()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
    left join (select a.department_id, sum(a.amount) amount, count(*) n,
                      sum(a.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.expense_allocations a join public.department_expenses e on e.id = a.expense_id
                group by a.department_id) x on x.department_id = d.id
   where d.generates_revenue;
  return v;
end $$;
revoke all on function public.accounts_finance_by_department() from public, anon;
grant execute on function public.accounts_finance_by_department() to authenticated;

-- ---------------------------------------------------------------------------
-- Finance summary: the company counts an expense once, a department only its part
-- ---------------------------------------------------------------------------
create or replace function public.accounts_finance_summary(p_department uuid DEFAULT NULL::uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_income numeric; v_income_n bigint;
  v_exp numeric; v_exp_paid numeric; v_exp_pending numeric; v_exp_n bigint;
begin
  perform private.require_accounts_staff();
  select coalesce(sum(p.amount), 0), count(*) into v_income, v_income_n
    from private.verified_income_attributed() p join public.customers c on c.id = p.customer_id
   where (p_department is null or p.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to);
  -- company-wide: every expense ONCE at its full amount. One department: only the part allocated to it.
  select coalesce(sum(x.amt), 0), coalesce(sum(x.amt) filter (where x.payment_status = 'PAID'), 0),
         coalesce(sum(x.amt) filter (where x.payment_status = 'PENDING'), 0), count(*)
    into v_exp, v_exp_paid, v_exp_pending, v_exp_n
    from (select e.payment_status, case when p_department is null then e.amount else (select a.amount from public.expense_allocations a where a.expense_id = e.id and a.department_id = p_department) end amt
            from public.department_expenses e
           where (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to)
             and (p_department is null or exists (select 1 from public.expense_allocations a where a.expense_id = e.id and a.department_id = p_department))) x;
  return jsonb_build_object('income', v_income, 'incomeCount', v_income_n, 'expenses', v_exp, 'expensesPaid', v_exp_paid,
    'expensesPending', v_exp_pending, 'expenseCount', v_exp_n, 'net', v_income - v_exp);
end $$;
revoke all on function public.accounts_finance_summary(uuid, date, date) from public, anon;
grant execute on function public.accounts_finance_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- The company overview: each department's expenses are its allocations
-- ---------------------------------------------------------------------------
create or replace function public.dashboard_company_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
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
    left join (select a.department_id, sum(a.amount) amount, sum(a.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.expense_allocations a join public.department_expenses e on e.id = a.expense_id group by a.department_id) x on x.department_id = d.id
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
end $$;
revoke all on function public.dashboard_company_overview() from public, anon;
grant execute on function public.dashboard_company_overview() to authenticated;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000500_client_panel_url.sql
-- Client Panel URL (Meta Verifier -> Client login details).
--
-- The address where the customer signs in to the panel of ONE service. It is recorded per customer AND service (customer_services.panel_url),
-- next to the account / user ID that already lives there, so a customer with two WhatsApp services can have two panels.
--
--   * Validated in the database as well as on the page and in the API: HTTPS only, a real host name (no IP address, localhost or internal name),
--     no "user:password@" part, no whitespace, at most 500 characters, and nothing that looks like a password or token anywhere in the link.
--   * The same access rule as the other panel details (the route's Meta Verifier / Technical Consultant, the Department Head of the
--     customer's department, the Super Admin). Every change is audited (service + host, never the full link) and written to the activity.
--   * Saving a URL sends nothing. Sending is a deliberate action ("E-mail the panel link"), on the existing e-mail workflow (one automation job):
--       - the same link to the same customer and service is sent once; a double click, a retry or a repeated request is a no-op;
--       - CHANGING the link makes it sendable again (the new address is a different link) and the section says "changed since it was sent";
--       - the same link can be sent again on purpose ("Send again"), once per click;
--       - a link whose e-mail failed or was skipped can simply be sent again.
--   * The customer's "Status Completed" e-mail and WhatsApp use the customer's own panel URL when there is one (otherwise the department's).
-- Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Where it is kept
-- ---------------------------------------------------------------------------
alter table public.customer_services add column if not exists panel_url text;
alter table public.customer_services drop constraint if exists customer_services_panel_url_check;
alter table public.customer_services add constraint customer_services_panel_url_check
  check (panel_url is null or (length(panel_url) <= 500 and panel_url ~ '^https://[^\s@/?#]+([/?#][^\s]*)?$'));

-- The link last queued for a customer's service: which address, who and when, and the e-mail job that carried it (for its state).
create table if not exists public.service_panel_links (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  url text not null,
  sent_at timestamptz not null default now(),
  sent_by uuid references public.profiles (id) on delete set null,
  last_job uuid references public.automation_jobs (id) on delete set null,
  primary key (customer_id, service_code)
);
alter table public.service_panel_links enable row level security;
revoke all on public.service_panel_links from public, anon, authenticated;

alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT', 'ACCOUNT_CREATED', 'PANEL_CREDENTIALS', 'PANEL_LINK'));

-- ---------------------------------------------------------------------------
-- 2. The rules of a panel URL (the page and the API apply the same ones, shared/panelUrl.ts)
-- ---------------------------------------------------------------------------
create or replace function private.clean_panel_url(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := btrim(coalesce(p, ''));
  v_rest text;
  v_auth text;
  v_tail text;
begin
  if v = '' then return null; end if;
  if length(v) > 500 then
    raise exception 'VALIDATION_ERROR: The panel URL is too long (500 characters at most).' using errcode = 'P0001';
  end if;
  if v ~ '[[:space:][:cntrl:]]' then
    raise exception 'VALIDATION_ERROR: The panel URL cannot contain spaces.' using errcode = 'P0001';
  end if;
  if v !~* '^https://' then
    raise exception 'VALIDATION_ERROR: The panel URL must start with https:// (a secure link).' using errcode = 'P0001';
  end if;
  v_rest := substr(v, 9);
  v_auth := lower(substring(v_rest from '^[^/?#]*'));
  v_tail := substr(v_rest, length(v_auth) + 1);
  if v_auth like '%@%' then
    raise exception 'VALIDATION_ERROR: The panel URL cannot contain a user name or password.' using errcode = 'P0001';
  end if;
  if v_auth !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$'
     or regexp_replace(v_auth, ':[0-9]+$', '') ~ '^[0-9.]+$'
     or regexp_replace(v_auth, ':[0-9]+$', '') ~ '\.(local|localhost|internal|lan|home|test|invalid|example)$' then
    raise exception 'VALIDATION_ERROR: Enter a public web address such as https://panel.example.com/login.' using errcode = 'P0001';
  end if;
  if v_tail ~* '(passw|pwd|secret|token|api[_-]?key|[?&;]key=|auth|session|otp|signature|[?&]sig=|credential|jwt|bearer)' then
    raise exception 'VALIDATION_ERROR: The panel URL must not carry a password, key or token. Enter the plain sign-in address.' using errcode = 'P0001';
  end if;
  return 'https://' || v_auth || v_tail;
end $$;
revoke all on function private.clean_panel_url(text) from public, anon, authenticated;
grant execute on function private.clean_panel_url(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Record or clear the panel URL of one service (sends nothing)
-- ---------------------------------------------------------------------------
create or replace function public.panel_url_set(p_customer uuid, p_service text, p_url text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_url text := private.clean_panel_url(p_url);
  v_old text;
  v_name text;
  v_host text;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select cs.panel_url into v_old from public.customer_services cs
   where cs.customer_id = p_customer and cs.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = cs.service_code and s.requires_meta_verification)
   for update;
  if not found then
    raise exception 'NOT_FOUND: That is not a WhatsApp service of this customer.' using errcode = 'P0001';
  end if;
  if v_url is not distinct from v_old then
    return jsonb_build_object('changed', false, 'panelUrl', v_url);  -- nothing changed: no write, no history
  end if;
  update public.customer_services set panel_url = v_url where customer_id = p_customer and service_code = p_service;
  select name into v_name from public.crm_services where code = p_service;
  v_host := substring(coalesce(v_url, '') from '^https://([^/?#]*)');
  perform private.log_customer_activity(p_customer, 'PANEL_URL_SAVED',
    format('Client panel URL %s for %s', case when v_url is null then 'removed' when v_old is null then 'saved' else 'changed' end, v_name));
  -- which service and which host - never the full link
  perform private.write_audit('SERVICE_PANEL_URL_SET', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('service', p_service, 'host', v_host, 'cleared', v_url is null, 'replaced', v_old is not null));
  return jsonb_build_object('changed', true, 'panelUrl', v_url);
end $$;
revoke all on function public.panel_url_set(uuid, text, text) from public, anon;
grant execute on function public.panel_url_set(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. E-mail the panel link to the customer (one automation job; a repeated or duplicate request sends nothing more)
-- ---------------------------------------------------------------------------
create or replace function public.panel_link_send(p_customer uuid, p_service text, p_request uuid, p_resend boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  cs public.customer_services;
  v_name text;
  v_email text;
  v_key text;
  v_prev text;
  v_job uuid;
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_request is null then
    raise exception 'VALIDATION_ERROR: The request id is missing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into cs from public.customer_services x
   where x.customer_id = p_customer and x.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = x.service_code and s.requires_meta_verification) for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: That is not a WhatsApp service of this customer.' using errcode = 'P0001';
  end if;
  if cs.panel_url is null then
    raise exception 'VALIDATION_ERROR: Save the panel URL first.' using errcode = 'P0001';
  end if;
  v_email := lower(btrim(coalesce(v.email, '')));
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer has no valid e-mail address on the record. Ask Accounts to correct it, then send the panel link.' using errcode = 'P0001';
  end if;
  select name into v_name from public.crm_services where code = p_service;

  -- the same link for the same customer and service is one e-mail; a failed or skipped one may be sent again, a sent one only on purpose
  v_key := format('PANELLINK|%s|%s|%s', p_customer, p_service, md5(cs.panel_url));
  select j.status into v_prev from public.automation_jobs j where j.dedupe_key = v_key;
  if v_prev in ('QUEUED', 'SENDING') or (v_prev = 'SENT' and not coalesce(p_resend, false)) then
    return jsonb_build_object('queued', false, 'replayed', true, 'reason', case when v_prev = 'SENT' then 'ALREADY_SENT' else 'IN_PROGRESS' end);
  end if;
  if v_prev is not null then
    v_key := v_key || '|' || p_request::text;
  end if;
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
  values (p_customer, 'EMAIL', 'PANEL_LINK', v_key,
          jsonb_strip_nulls(jsonb_build_object('service', p_service, 'serviceName', v_name, 'panel', cs.platform, 'panelUrl', cs.panel_url)),
          (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  if v_job is null then
    return jsonb_build_object('queued', false, 'replayed', true, 'reason', 'REPEATED_REQUEST');
  end if;
  insert into public.service_panel_links (customer_id, service_code, url, sent_at, sent_by, last_job)
  values (p_customer, p_service, cs.panel_url, now(), (select private.my_id()), v_job)
  on conflict (customer_id, service_code) do update set url = excluded.url, sent_at = now(), sent_by = excluded.sent_by, last_job = excluded.last_job;
  perform private.log_customer_activity(p_customer, 'PANEL_LINK_SENT', format('Panel link for %s e-mailed to the customer', v_name));
  perform private.write_audit('SERVICE_PANEL_LINK_SENT', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('service', p_service, 'resend', coalesce(p_resend, false)));
  return jsonb_build_object('queued', true, 'replayed', false);
end $$;
revoke all on function public.panel_link_send(uuid, text, uuid, boolean) from public, anon;
grant execute on function public.panel_link_send(uuid, text, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. What the section shows: the panel URL, and where its e-mail stands (same as before in every other respect)
-- ---------------------------------------------------------------------------
create or replace function public.panel_details_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_can boolean := private.can_manage_panel_details(p_customer);
begin
  -- readable by whoever manages it, and by the verifier's own department after the hand-over (they still need to see what was recorded)
  if not v_can and not (private.can_access_customer(p_customer)
       and exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_verifier_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'canEdit', v_can,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'platform', cs.platform, 'panelAccount', cs.panel_account,
                 'panelUrl', cs.panel_url,
                 -- the link e-mail: which address went out, when, and whether the saved URL is still that one
                 'link', (select jsonb_build_object('sentAt', l.sent_at, 'sentBy', (select full_name from public.profiles where id = l.sent_by),
                                   'current', l.url = cs.panel_url,
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = l.last_job))
                            from public.service_panel_links l where l.customer_id = cs.customer_id and l.service_code = cs.service_code),
                 -- whether a password was set for the customer and what happened to the e-mail that carried it (never the password itself)
                 'credentials', (select jsonb_build_object('setAt', pc.set_at, 'setBy', (select full_name from public.profiles where id = pc.set_by),
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = pc.last_job))
                                   from public.service_panel_credentials pc where pc.customer_id = cs.customer_id and pc.service_code = cs.service_code)) order by s.sort_order, s.code)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = p_customer and s.requires_meta_verification), '[]'::jsonb),
    -- the address the panel password and link are e-mailed to: the one on the customer record
    'customerEmail', (select nullif(btrim(c.email), '') from public.customers c where c.id = p_customer),
    'dashboardLogin', (select jsonb_build_object('email', a.email, 'createdAt', a.created_at) from public.customer_client_accounts a where a.customer_id = p_customer));
end $$;
revoke all on function public.panel_details_list(uuid) from public, anon;
grant execute on function public.panel_details_list(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The dispatcher gets the customer's panel URL with the job (same function as before, plus 'panelUrl')
-- ---------------------------------------------------------------------------
create or replace function public.automation_claim_jobs(p_channels text[], p_limit integer default 10, p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  -- an encrypted password is never kept longer than 7 days, sent or not
  update public.automation_jobs set secret = null where secret is not null and created_at < now() - interval '7 days';
  select coalesce(array_agg(id), '{}') into v_ids from (
    select j.id from public.automation_jobs j
     where j.channel = any (coalesce(p_channels, '{}'))
       and ((j.status = 'QUEUED' and j.next_attempt_at <= now())
         or (j.status = 'SENDING' and j.locked_until < now()))
     order by j.next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 10), 50))
     for update skip locked) x;

  update public.automation_jobs
     set status = 'SENDING', attempts = attempts + 1,
         locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 300), 1800)))
   where id = any (v_ids);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', j.id, 'channel', j.channel, 'stage', j.stage, 'attempts', j.attempts, 'context', j.context, 'secret', j.secret,
      'customer', jsonb_build_object(
        'id', c.id, 'name', c.name, 'company', c.company, 'email', c.email,
        'whatsapp', coalesce(nullif(btrim(c.whatsapp), ''), c.phone),
        'departmentSlug', d.slug, 'department', d.name,
        'website', private.customer_website(c.id),
        'panelUrl', (select cs.panel_url from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                      where cs.customer_id = c.id and cs.panel_url is not null order by s.sort_order, s.code limit 1),
        'loginEmail', (select a.email from public.customer_client_accounts a where a.customer_id = c.id)))
      order by j.next_attempt_at)
      from public.automation_jobs j
      join public.customers c on c.id = j.customer_id
      join public.departments d on d.id = c.department_id
     where j.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.automation_claim_jobs(text[], integer, integer) from public, anon, authenticated;
grant execute on function public.automation_claim_jobs(text[], integer, integer) to service_role;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000600_department_head_handover_queue.sql
-- Department Head "Client hand-overs": a customer the Meta Verifier sends is visible to the Department Head at once.
--
-- ROOT CAUSE (reproduced with a Support-side head in the test suite before this change: the head saw 0 of 2 handed-over customers).
-- The hand-over itself already worked: send_to_department_head() sets handover_stage = 'DEPARTMENT_HEAD', notifies the head and schedules the
-- Technical Consultant's follow-up as a separate task. But the Department Head could not READ the customer afterwards. The only policy that lets
-- a Department Head read customers (customers_select) is limited to customers whose OWNING team is of the head's own division
-- (sales_scope_team(team_id)). Customers are owned by Sales teams, and a Support-side head (the side that receives hand-overs) therefore got an
-- empty "Client hand-overs" queue: "No verified customers yet". customers_select_handover only covers the Team Lead / Team Member the customer
-- was passed to. The page text ("customers the Technical Consultant has verified ... once the Technical Consultant sends them to you") was also
-- from the old workflow.
--
-- This migration:
--   1. lets a Department Head read the customers HANDED OVER in their (active) department - every customer whose handover_stage is past the
--      verification stage - when they work on the Support side or have no side. Nothing about the verification stage changes, a Sales-side head
--      gets no new access, and nothing depends on the Technical Consultant;
--   2. sends the hand-over notice to the Support-side heads of the customer's department (including heads authorised for it through
--      department_access), falling back to every active head when the department has no Support-side head (so a hand-over is never blocked);
--   3. tells the assigned Technical Consultant, once, that a consultation follow-up exists (the follow-up itself is unchanged: one per customer,
--      created in the same transaction, with the Super Admin's delay);
--   4. shows on the customer's hand-over detail which route verified it and the state of the consultation follow-up;
--   5. adds a reconciliation report for customers caught in the old workflow and ONE explicit, audited action that creates the follow-ups that
--      are missing. Nothing is changed by running this migration.
-- It needs 20261209000100_client_onboarding_journey.sql (send_to_department_head below keeps that migration's "Meta verification first" check). Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. Visibility
-- ---------------------------------------------------------------------------
create or replace function private.customer_handed_over(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer and o.handover_stage <> 'CONSULTANT')
$$;
revoke all on function private.customer_handed_over(uuid) from public, anon;
grant execute on function private.customer_handed_over(uuid) to authenticated, service_role;

drop policy if exists customers_select_dh_handover on public.customers;
create policy customers_select_dh_handover on public.customers for select to authenticated
  using ((select private.my_role()) = 'DEPARTMENT_HEAD'
         and lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
         and department_id = (select private.my_department_id())
         and coalesce((select private.active_head_division()), 'SUPPORT') = 'SUPPORT'
         and private.customer_handed_over(id));

-- ---------------------------------------------------------------------------
-- 2. Who is told about a hand-over
-- ---------------------------------------------------------------------------
create or replace function private.handover_head_recipients(p_department uuid)
returns table (profile_id uuid)
language sql stable security definer set search_path = '' as $$
  with support as (select r.profile_id from private.department_head_recipients(p_department, 'SUPPORT') r)
  select s.profile_id from support s
  union all
  select r.profile_id from private.department_head_recipients(p_department) r where not exists (select 1 from support)
$$;
revoke all on function private.handover_head_recipients(uuid) from public, anon, authenticated;

create or replace function public.send_to_department_head(p_customer uuid, p_note text DEFAULT NULL::text)
returns void language plpgsql security definer set search_path = '' as $function$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_head uuid;
  v_count integer := 0;
  v_meta boolean;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  if o.handover_stage <> 'CONSULTANT' then
    raise exception 'CONFLICT: Already sent to the Department Head.' using errcode = 'P0001';
  end if;
  if o.returned_at is not null or o.review_state <> 'VERIFIED' then
    raise exception 'VALIDATION_ERROR: Authorize every document and detail first (including the WABA ID where it applies).' using errcode = 'P0001';
  end if;
  v_meta := private.onboarding_route(p_customer) = 'META';
  -- the Relationship Manager takes over only after Meta verification (the onboarding journey, 20261209000100): that check is kept as it was
  if private.meta_required(p_customer) and o.meta_status <> 'COMPLETED' and o.meta_completed_at is null then
    raise exception 'VALIDATION_ERROR: Complete the Meta verification first. The Relationship Manager takes over only after it.' using errcode = 'P0001';
  end if;

  -- the heads of the customer's own department (read from the customer record, never from the request)
  select count(*) into v_count from private.handover_head_recipients(v.department_id);
  if v_count = 0 then
    raise exception 'CONFLICT: This department has no active Department Head to send the customer to.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'DEPARTMENT_HEAD', stage = 'HANDOVER', to_department_head_at = now(),
         to_department_head_by = (select private.my_id()), handover_note = v_note
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_DEPARTMENT_HEAD', 'Verified and sent to the Department Head' || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_DEPARTMENT_HEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('note', v_note, 'route', case when v_meta then 'META' else 'TECHNICAL' end));
  -- the Technical Consultant's consultation is a separate task that follows some days later (a persistent follow-up; the delay is a setting).
  -- It never holds the customer back from the Department Head.
  if v_meta then
    perform private.schedule_tc_followup(p_customer, 'The Meta Verifier verified the customer and handed it over. Contact the customer for the consultation and any add-on services.');
  end if;

  for v_head in select profile_id from private.handover_head_recipients(v.department_id) loop
    perform private.notify(v_head, 'HANDOVER_TO_DEPARTMENT_HEAD', format('New client to assign: %s', coalesce(v.company, v.name)),
      coalesce(v_note, case when v_meta then 'The Meta Verifier verified everything.' else 'The Technical Consultant verified everything.' end), 'customer', p_customer);
  end loop;
  perform private.notify(v.owner_id, 'HANDOVER_TO_DEPARTMENT_HEAD', format('Verified: %s', coalesce(v.company, v.name)),
    case when v_meta then 'The Meta Verifier verified the customer and sent it to the Department Head.' else 'The Technical Consultant verified the customer and sent it to the Department Head.' end, 'customer', p_customer);
end $function$;
revoke all on function public.send_to_department_head(uuid, text) from public, anon;
grant execute on function public.send_to_department_head(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The follow-up: unchanged, plus one notice to the consultant it is assigned to (only when it is newly created)
-- ---------------------------------------------------------------------------
create or replace function private.schedule_tc_followup(p_customer uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_days integer;
  v_id uuid;
  v_to uuid;
begin
  select * into v from public.customers where id = p_customer;
  if v.id is null or v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') or v.department_id is null then
    return;
  end if;
  select w.tc_followup_delay_days into v_days from public.workflow_settings w where w.id;
  insert into public.tc_followups (customer_id, department_id, assigned_to, status, reason, eligible_at, due_at)
  values (p_customer, v.department_id, private.pick_consultant(v.department_id),
          case when v_days is null then 'AWAITING_CONFIGURATION' else 'SCHEDULED' end, left(p_reason, 500), now(),
          case when v_days is null then null else now() + make_interval(days => v_days) end)
  on conflict (customer_id) where status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE') do nothing
  returning id, assigned_to into v_id, v_to;
  if v_id is null then
    return;                                                     -- already scheduled: nothing is created or notified twice
  end if;
  perform private.log_customer_activity(p_customer, 'TC_FOLLOWUP_SCHEDULED',
    case when v_days is null then 'Technical Consultant follow-up waits for the delay to be set' else format('Technical Consultant follow-up scheduled in %s day(s)', v_days) end);
  perform private.write_audit('TC_FOLLOWUP_SCHEDULED', 'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('followup_id', v_id, 'delay_days', v_days));
  if v_to is not null then
    perform private.notify(v_to, 'TC_FOLLOWUP_SCHEDULED', format('Consultation follow-up: %s', coalesce(v.company, v.name)),
      case when v_days is null then 'The customer was verified. The follow-up will get its date when the delay is set.'
           else format('The customer was verified. Contact them for the consultation in %s day(s).', v_days) end,
      'customer', p_customer);
  end if;
end $$;
revoke all on function private.schedule_tc_followup(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. What the hand-over detail shows: the route that verified it, and the consultation follow-up (only to people who may see follow-ups)
-- ---------------------------------------------------------------------------
create or replace function public.customer_handover_info(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare
  o public.customer_onboarding;
  a public.customer_client_accounts;
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  if o.customer_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'stage', o.handover_stage,
    'route', private.onboarding_route(p_customer),
    'toDepartmentHeadAt', o.to_department_head_at,
    'sentBy', (select full_name from public.profiles where id = o.to_department_head_by),
    'teamLead', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.team_lead_id),
    'passedToTeamLeadAt', o.passed_to_team_lead_at,
    'teamMember', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = o.team_member_id),
    'assignedToMemberAt', o.assigned_to_member_at,
    'note', o.handover_note,
    'followUp', (select jsonb_build_object('status', case when f.status = 'SCHEDULED' and f.due_at <= now() then 'DUE' else f.status end, 'dueAt', f.due_at,
                                           'assignedTo', (select p.full_name from public.profiles p where p.id = f.assigned_to))
                   from public.tc_followups f
                  where f.customer_id = p_customer and private.followup_scope(f)
                  order by (f.status in ('AWAITING_CONFIGURATION', 'SCHEDULED', 'DUE')) desc, f.created_at desc limit 1),
    'clientAccount', case when a.customer_id is null then null
                          else jsonb_build_object('email', a.email, 'createdAt', a.created_at) end);
end $function$;
revoke all on function public.customer_handover_info(uuid) from public, anon;
grant execute on function public.customer_handover_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reconciliation of customers caught in the old workflow (a report; the one action below creates only what is missing)
-- ---------------------------------------------------------------------------
create or replace function public.handover_reconciliation_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_super_admin() or private.my_role() = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the Super Admin and Department Heads can see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    -- everything is authorized and Meta verification is complete, but nobody sent it on: it waits in the Meta Verifier's queue (the verifier, the Department Head or the Super Admin sends it)
    'verifiedNotSent', coalesce((
      select jsonb_agg(jsonb_build_object('customerId', c.id, 'customer', coalesce(c.company, c.name), 'department', d.name, 'sentForVerificationAt', o.forwarded_to_support_at) order by o.forwarded_to_support_at nulls last)
        from public.customers c join public.customer_onboarding o on o.customer_id = c.id join public.departments d on d.id = c.department_id
       where c.lifecycle_stage = 'ONBOARDING' and o.handover_stage = 'CONSULTANT' and o.forwarded_to_support_at is not null
         and o.review_state = 'VERIFIED' and o.returned_at is null and private.onboarding_route(c.id) = 'META'
         and (o.meta_status = 'COMPLETED' or o.meta_completed_at is not null)
         and (private.is_super_admin() or c.department_id = private.my_department_id())), '[]'::jsonb),
    -- handed over by a Meta Verifier but no consultation follow-up was ever made for it
    'handedOverWithoutFollowUp', coalesce((
      select jsonb_agg(jsonb_build_object('customerId', c.id, 'customer', coalesce(c.company, c.name), 'department', d.name, 'handedOverAt', o.to_department_head_at, 'stage', o.handover_stage) order by o.to_department_head_at nulls last)
        from public.customers c join public.customer_onboarding o on o.customer_id = c.id join public.departments d on d.id = c.department_id
       where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.handover_stage <> 'CONSULTANT' and private.onboarding_route(c.id) = 'META'
         and not exists (select 1 from public.tc_followups f where f.customer_id = c.id)
         and (private.is_super_admin() or c.department_id = private.my_department_id())), '[]'::jsonb));
end $$;
revoke all on function public.handover_reconciliation_report() from public, anon;
grant execute on function public.handover_reconciliation_report() to authenticated;

-- Creates the consultation follow-up for every customer in 'handedOverWithoutFollowUp'. Idempotent (one open follow-up per customer; a customer
-- that already has any follow-up is left alone), changes no customer, assignment or hand-over, and is audited.
create or replace function public.handover_reconcile_followups()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_n integer := 0;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can do this.' using errcode = '42501';
  end if;
  for r in
    select c.id from public.customers c join public.customer_onboarding o on o.customer_id = c.id
     where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.handover_stage <> 'CONSULTANT' and private.onboarding_route(c.id) = 'META'
       and not exists (select 1 from public.tc_followups f where f.customer_id = c.id)
  loop
    perform private.schedule_tc_followup(r.id, 'Added by reconciliation: the customer was handed over before the consultation follow-up existed.');
    v_n := v_n + 1;
  end loop;
  perform private.write_audit('HANDOVER_FOLLOWUPS_RECONCILED', 'workflow_settings', null, null, null, jsonb_build_object('customers', v_n));
  return jsonb_build_object('customers', v_n);
end $$;
revoke all on function public.handover_reconcile_followups() from public, anon;
grant execute on function public.handover_reconcile_followups() to authenticated;

notify pgrst, 'reload schema';
