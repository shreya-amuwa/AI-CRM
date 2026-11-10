-- =============================================================================
-- Part payments of one order share one invoice number (Accounts' request).
--
--   Order paid in parts:  GST/26-27/014-1 (1st part payment), GST/26-27/014-2 (2nd), GST/26-27/014-3 (the final payment) ...
--   Order paid at once:   GST/26-27/015 (unchanged)
--
--  * The first PART payment invoiced from now on takes a fresh number of the order's series (GST or non-GST, financial year of the invoice date)
--    as the order's BASE, kept in part_payment_invoice_series. Each paid invoice of that order then gets the base plus the next suffix: the later
--    part payments and the payment that settles the order. Every invoice is still a separate document with its own unique number (Rule 46:
--    unique, at most 16 characters for a GST invoice; a non-GST number may have up to 20). The base itself is never issued without a suffix.
--  * The order keeps its base when a later payment falls in the next financial year (it stays one family of numbers).
--  * A cancelled invoice never gives its number back: the payment invoiced again gets the next suffix.
--  * Nothing already issued is renumbered: an order whose part payments were invoiced before this migration starts its own base with its
--    next part payment. Manual invoices, add-on invoices and single full payments keep their ordinary numbers.
--  * The number is taken inside the same transaction as the invoice (locks on the customer and on its row here), so two requests can never
--    take the same suffix and a refused invoice leaves no gap.
--
-- Safe to run again. Nothing is deleted, renumbered or sent. Run after 20261231000300_hr_assistant_recruitment.sql.
-- =============================================================================

create table if not exists public.part_payment_invoice_series (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  base_number text not null unique check (length(base_number) between 1 and 20),
  invoice_type text not null check (invoice_type in ('GST', 'NON_GST')),
  last_suffix integer not null default 0 check (last_suffix >= 0),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.part_payment_invoice_series enable row level security;
revoke all on public.part_payment_invoice_series from public, anon, authenticated;

-- the highest number of a series: a suffixed number (GST/26-27/014-2) counts as its base (014), so a new series row never reuses a base
create or replace function private.invoice_series_existing_max(p_type text, p_fy text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(max((substring(i.invoice_number from '/([0-9]+)(-[0-9]+)?$'))::integer), 0)
    from public.member_invoices i
   where lower(i.invoice_number) like lower(private.invoice_series_prefix(p_type) || '/' || p_fy || '/') || '%'
     and i.invoice_number ~ ('^' || private.invoice_series_prefix(p_type) || '/' || p_fy || '/[0-9]{1,5}(-[0-9]+)?$')
$$;
revoke all on function private.invoice_series_existing_max(text, text) from public, anon, authenticated;

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
  -- a part payment's paid invoice: the number was decided by accounts_issue_payment_invoice_billed (the order's base + the next suffix).
  -- Honoured only inside that function (both flags are set there for the one call); the series counter is not moved.
  v_no := nullif(current_setting('amuwa.forced_invoice_number', true), '');
  if v_no is not null and current_setting('amuwa.payment_invoice', true) = 'on' then
    if exists (select 1 from public.member_invoices x where lower(x.invoice_number) = lower(v_no)) then
      raise exception 'CONFLICT: An invoice numbered % already exists.', v_no using errcode = 'P0001';
    end if;
    return v_no;
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
  ser public.part_payment_invoice_series;
  v_type text;
  v_forced text;
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

  -- Part payments of one order share one invoice number with a running suffix: GST/26-27/014-1, GST/26-27/014-2 ... The first PART payment
  -- invoiced from now on takes a fresh number of the series as the order's base; every later payment invoice of that order (part or the final
  -- full one) takes the base with the next suffix. A single full payment keeps an ordinary number. Each document still has its own number.
  ser := null;
  select * into ser from public.part_payment_invoice_series where customer_id = c.id for update;
  if ser.customer_id is null and pay.payment_type = 'PART' then
    v_type := case when v_rate > 0 then 'GST' else 'NON_GST' end;
    insert into public.part_payment_invoice_series (customer_id, base_number, invoice_type, last_suffix, created_by)
    values (c.id, private.take_invoice_number(v_type, v_date), v_type, 0, (select private.my_id()))
    returning * into ser;
  end if;
  v_forced := null;
  if ser.customer_id is not null then
    update public.part_payment_invoice_series set last_suffix = last_suffix + 1, updated_at = now() where customer_id = c.id returning * into ser;
    v_forced := ser.base_number || '-' || ser.last_suffix;
    -- a GST invoice number may have at most 16 characters (Rule 46); a non-GST one up to 20
    if length(v_forced) > (array[16, 20])[(ser.invoice_type <> 'GST')::int + 1] then
      raise exception 'CONFLICT: The invoice number % would be longer than allowed. Ask the administrator.', v_forced using errcode = 'P0001';
    end if;
  end if;

  -- the invoice function does the checks and the saving; the flag tells the cap to measure it against the money received
  perform set_config('amuwa.payment_invoice', 'on', true);
  perform set_config('amuwa.forced_invoice_number', coalesce(v_forced, ''), true);
  begin
    -- a new request each time: a payment whose invoice was cancelled is invoiced again (the payment_invoices row is what makes a repeated click idempotent)
    v_res := public.accounts_issue_invoice(gen_random_uuid(), v_payload);
  exception when others then
    perform set_config('amuwa.payment_invoice', 'off', true);
    perform set_config('amuwa.forced_invoice_number', '', true);
    raise;
  end;
  perform set_config('amuwa.payment_invoice', 'off', true);
  perform set_config('amuwa.forced_invoice_number', '', true);
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


notify pgrst, 'reload schema';
