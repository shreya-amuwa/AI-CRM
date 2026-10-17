-- =============================================================================
-- Dynamic two-stage invoices (Accounts): prefill -> issue (unpaid PDF) -> confirm payment (paid PDF).
--
-- What this adds, on top of the existing invoice model (public.member_invoices, one row per invoice, with the existing
-- numbering, audit, notification, add-on and client-dashboard functions - nothing is duplicated):
--
--  1. member_invoices.kind = 'GENERATED': an invoice built in the Accounts invoice builder. Its immutable snapshot
--     (customer, tax treatment, totals, terms) lives in public.generated_invoices and its lines, one row each, in
--     public.generated_invoice_items. The snapshot can never change once issued; payment confirmation only adds
--     the payment facts and the paid document.
--  2. Lifecycle (payment, document and e-mail state are separate, so one failing never undoes another):
--        issue -> ISSUED (unpaid)  -> unpaid PDF stored -> unpaid e-mail sent
--              -> payment confirmed -> PAID -> paid PDF stored -> paid e-mail sent
--     Each document has its own storage reference (provider, bucket, path, ref, ETag, size) and its own
--     e-mail status. A short lease per stage stops a double click or a retry from doing the same step twice.
--  3. Functions (all SECURITY DEFINER, search_path '', Accounts staff only unless said otherwise):
--        accounts_invoice_prefill        customer + the purchase's own billable services
--        accounts_issue_invoice          validate, recalculate on the server, reserve the number, persist the snapshot
--        accounts_invoice_claim          take the stage's lease and get the snapshot to draw the PDF from
--        accounts_invoice_record_pdf     remember the stored PDF (only after the upload succeeded)
--        accounts_invoice_record_email   remember the e-mail result (only after the mail server accepted it)
--        accounts_invoice_record_failure remember a failed step so it can be retried
--        accounts_invoice_release        give the lease back
--        accounts_confirm_invoice_payment  idempotent payment confirmation
--        invoice_file_access             staff download of a stored PDF (anyone who may read the invoice)
--        client_invoices / client_invoice_download   the client's own invoices; the paid PDF only once it is stored
--  4. GST state list, exact-decimal invoice maths and Indian rupee words in SQL (the browser and the PDF use the same
--     rules in shared/invoiceCalc.ts; both are tested against the same cases).
--
-- Additive and re-runnable: IF NOT EXISTS, CREATE OR REPLACE, guarded constraints. No existing row is changed
-- (existing invoices keep their kind), nothing is dropped except constraints / triggers this migration re-creates.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. GST states (reference data, closed to direct access)
-- ---------------------------------------------------------------------------
create table if not exists public.gst_states (
  code text primary key check (code ~ '^[0-9]{2}$'),
  name text not null check (length(name) between 2 and 80)
);
insert into public.gst_states (code, name) values
  ('01', 'Jammu and Kashmir'), ('02', 'Himachal Pradesh'), ('03', 'Punjab'), ('04', 'Chandigarh'), ('05', 'Uttarakhand'),
  ('06', 'Haryana'), ('07', 'Delhi'), ('08', 'Rajasthan'), ('09', 'Uttar Pradesh'), ('10', 'Bihar'), ('11', 'Sikkim'),
  ('12', 'Arunachal Pradesh'), ('13', 'Nagaland'), ('14', 'Manipur'), ('15', 'Mizoram'), ('16', 'Tripura'),
  ('17', 'Meghalaya'), ('18', 'Assam'), ('19', 'West Bengal'), ('20', 'Jharkhand'), ('21', 'Odisha'),
  ('22', 'Chhattisgarh'), ('23', 'Madhya Pradesh'), ('24', 'Gujarat'), ('26', 'Dadra and Nagar Haveli and Daman and Diu'),
  ('27', 'Maharashtra'), ('29', 'Karnataka'), ('30', 'Goa'), ('31', 'Lakshadweep'), ('32', 'Kerala'), ('33', 'Tamil Nadu'),
  ('34', 'Puducherry'), ('35', 'Andaman and Nicobar Islands'), ('36', 'Telangana'), ('37', 'Andhra Pradesh'),
  ('38', 'Ladakh'), ('97', 'Other Territory')
on conflict (code) do update set name = excluded.name;
alter table public.gst_states enable row level security;
revoke all on public.gst_states from public, anon, authenticated;

-- The company: registered in Maharashtra (27). A supply to a customer in another state is inter-state (IGST).
create or replace function private.company_state_code()
returns text language sql immutable set search_path = '' as $$ select '27'::text $$;
revoke all on function private.company_state_code() from public, anon, authenticated;
create or replace function private.company_gstin()
returns text language sql immutable set search_path = '' as $$ select '27BDCPK3585J3Z7'::text $$;
revoke all on function private.company_gstin() from public, anon, authenticated;

-- A GSTIN: 15 characters in the official layout, starting with a known state code.
create or replace function private.valid_gstin(p text)
returns boolean language sql stable set search_path = '' as $$
  select p ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' and exists (select 1 from public.gst_states s where s.code = left(p, 2))
$$;
revoke all on function private.valid_gstin(text) from public, anon, authenticated;

-- The state named in an address (the LAST one named wins: an address ends with its state). Null when none is named.
create or replace function private.infer_state_code(p_address text)
returns text language plpgsql stable set search_path = '' as $$
declare
  t text := ' ' || btrim(regexp_replace(replace(lower(coalesce(p_address, '')), '&', ' and '), '[^a-z]+', ' ', 'g')) || ' ';
  r record;
  needle text;
  p integer;
  v_at integer;
  v_best integer := 0;
  v_code text;
begin
  if btrim(t) = '' then
    return null;
  end if;
  for r in
    select s.code, s.name from public.gst_states s where s.code <> '97'
    union all
    select a.code, a.name from (values ('21', 'orissa'), ('05', 'uttaranchal'), ('34', 'pondicherry'), ('01', 'j and k'),
      ('01', 'jammu kashmir'), ('07', 'new delhi'), ('07', 'nct of delhi'), ('36', 'telengana'),
      ('35', 'andaman nicobar islands'), ('26', 'dadra and nagar haveli'), ('26', 'daman and diu')) a (code, name)
  loop
    needle := ' ' || btrim(regexp_replace(replace(lower(r.name), '&', ' and '), '[^a-z]+', ' ', 'g')) || ' ';
    p := strpos(reverse(t), reverse(needle));
    if p > 0 then
      v_at := length(t) - p - length(needle) + 2;
      if v_at > v_best then
        v_best := v_at;
        v_code := r.code;
      end if;
    end if;
  end loop;
  return v_code;
end $$;
revoke all on function private.infer_state_code(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Exact-decimal invoice maths and rupees in words (the same rules as shared/invoiceCalc.ts)
-- ---------------------------------------------------------------------------
create or replace function private.words_below_1000(n integer)
returns text language plpgsql immutable set search_path = '' as $$
declare
  ones text[] := array['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
                       'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  tens text[] := array['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  v_parts text[] := array[]::text[];
  v integer := n;
begin
  if v >= 100 then
    v_parts := v_parts || (ones[v / 100 + 1] || ' Hundred');
    v := v % 100;
  end if;
  if v >= 20 then
    v_parts := v_parts || tens[v / 10 + 1];
    v := v % 10;
  end if;
  if v > 0 then
    v_parts := v_parts || ones[v + 1];
  end if;
  return array_to_string(v_parts, ' ');
end $$;
revoke all on function private.words_below_1000(integer) from public, anon, authenticated;

create or replace function private.words_whole(n bigint)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_parts text[] := array[]::text[];
  v_crore integer := (n / 10000000)::integer;
  v_lakh integer := ((n % 10000000) / 100000)::integer;
  v_thousand integer := ((n % 100000) / 1000)::integer;
  v_rest integer := (n % 1000)::integer;
begin
  if n = 0 then
    return 'Zero';
  end if;
  if v_crore > 0 then v_parts := v_parts || (private.words_below_1000(v_crore) || ' Crore'); end if;
  if v_lakh > 0 then v_parts := v_parts || (private.words_below_1000(v_lakh) || ' Lakh'); end if;
  if v_thousand > 0 then v_parts := v_parts || (private.words_below_1000(v_thousand) || ' Thousand'); end if;
  if v_rest > 0 then v_parts := v_parts || private.words_below_1000(v_rest); end if;
  return array_to_string(v_parts, ' ');
end $$;
revoke all on function private.words_whole(bigint) from public, anon, authenticated;

-- 18880 -> 'Eighteen Thousand Eight Hundred Eighty Only/-'; 18880.50 -> '... Eighty and Fifty Paise Only/-'
create or replace function private.amount_in_words(p_amount numeric)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v_paise bigint;
  v_rupees bigint;
  v_p integer;
begin
  if p_amount is null or p_amount < 0 or p_amount > 9999999999.99 or p_amount <> round(p_amount, 2) then
    raise exception 'VALIDATION_ERROR: The amount is out of range.' using errcode = 'P0001';
  end if;
  v_paise := round(p_amount * 100)::bigint;
  v_rupees := v_paise / 100;
  v_p := (v_paise % 100)::integer;
  if v_rupees = 0 and v_p > 0 then
    return private.words_whole(v_p) || ' Paise Only/-';
  end if;
  return private.words_whole(v_rupees) || case when v_p > 0 then ' and ' || private.words_whole(v_p) || ' Paise' else '' end || ' Only/-';
end $$;
revoke all on function private.amount_in_words(numeric) from public, anon, authenticated;

-- Lines [{ baseAmount, taxRate }] + treatment -> every line's GST and total, the tax summary by rate and the totals.
--   line GST = round(base x rate / 100, 2)   (half up)      line total = base + GST
--   subtotal = sum of bases     total GST = sum of the ROUNDED line GST     final = subtotal + total GST
--   intra-state: per rate, CGST = round(GST / 2, 2) and SGST = the remainder (CGST + SGST = GST exactly); inter-state: IGST
create or replace function private.invoice_calc(p_lines jsonb, p_treatment text)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  e jsonb;
  i integer := 0;
  v_base numeric;
  v_rate numeric;
  v_gst numeric;
  v_lines jsonb := '[]'::jsonb;
  v_groups jsonb := '[]'::jsonb;
  v_sub numeric := 0;
  v_gst_sum numeric := 0;
  v_cgst numeric := 0;
  v_sgst numeric := 0;
  v_igst numeric := 0;
  v_c numeric;
  v_s numeric;
  v_n integer := 0;
  v_single numeric;
  v_total numeric;
  g record;
begin
  if p_treatment is null or p_treatment not in ('INTRA_STATE', 'INTER_STATE') then
    raise exception 'VALIDATION_ERROR: Choose the tax treatment (CGST + SGST, or IGST).' using errcode = 'P0001';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VALIDATION_ERROR: Add at least one service line.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'VALIDATION_ERROR: An invoice can have at most 50 lines.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    begin
      v_base := nullif(btrim(e ->> 'baseAmount'), '')::numeric;
      v_rate := nullif(btrim(e ->> 'taxRate'), '')::numeric;
    exception when others then
      raise exception 'VALIDATION_ERROR: Line %: enter numbers for the amount and the tax rate.', i using errcode = 'P0001';
    end;
    if v_base is null or v_base <= 0 or v_base > 9999999999.99 or v_base <> round(v_base, 2) then
      raise exception 'VALIDATION_ERROR: Line %: enter the invoice amount in rupees (more than zero, up to 2 decimals).', i using errcode = 'P0001';
    end if;
    if v_rate is null or v_rate < 0 or v_rate > 100 or v_rate <> round(v_rate, 2) then
      raise exception 'VALIDATION_ERROR: Line %: enter the tax rate as a percentage from 0 to 100 (up to 2 decimals).', i using errcode = 'P0001';
    end if;
    v_gst := round(v_base * v_rate / 100, 2);
    v_sub := v_sub + v_base;
    v_gst_sum := v_gst_sum + v_gst;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('position', i, 'baseAmount', v_base, 'taxRate', v_rate,
                                                              'gstAmount', v_gst, 'totalAmount', v_base + v_gst));
  end loop;
  v_total := v_sub + v_gst_sum;
  if v_total > 9999999999.99 then
    raise exception 'VALIDATION_ERROR: The invoice total is too large.' using errcode = 'P0001';
  end if;
  for g in
    select (l ->> 'taxRate')::numeric as rate, sum((l ->> 'baseAmount')::numeric) as base, sum((l ->> 'gstAmount')::numeric) as gst
      from jsonb_array_elements(v_lines) l group by 1 order by 1
  loop
    v_n := v_n + 1;
    v_single := g.rate;
    if p_treatment = 'INTRA_STATE' then
      v_c := round(g.gst / 2, 2);
      v_s := g.gst - v_c;
      v_cgst := v_cgst + v_c;
      v_sgst := v_sgst + v_s;
      v_groups := v_groups || jsonb_build_array(jsonb_build_object('rate', g.rate, 'base', g.base, 'gst', g.gst, 'cgst', v_c, 'sgst', v_s, 'igst', 0));
    else
      v_igst := v_igst + g.gst;
      v_groups := v_groups || jsonb_build_array(jsonb_build_object('rate', g.rate, 'base', g.base, 'gst', g.gst, 'cgst', 0, 'sgst', 0, 'igst', g.gst));
    end if;
  end loop;
  return jsonb_build_object(
    'lines', v_lines, 'subtotal', v_sub, 'totalGst', v_gst_sum, 'total', v_total, 'groups', v_groups,
    'cgst', v_cgst, 'sgst', v_sgst, 'igst', v_igst,
    -- one rate shown only when every line has the same rate; different rates are never summarised by a single misleading figure
    'cgstRate', case when p_treatment = 'INTRA_STATE' and v_n = 1 then v_single / 2 end,
    'sgstRate', case when p_treatment = 'INTRA_STATE' and v_n = 1 then v_single / 2 end,
    'igstRate', case when p_treatment = 'INTER_STATE' and v_n = 1 then v_single end,
    'words', private.amount_in_words(v_total));
end $$;
revoke all on function private.invoice_calc(jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The invoice kind and the snapshot tables
-- ---------------------------------------------------------------------------
alter table public.member_invoices drop constraint if exists member_invoices_kind_check;
alter table public.member_invoices add constraint member_invoices_kind_check check (kind in ('MANUAL', 'SERVICE', 'ADDON', 'UPLOADED', 'GENERATED'));

create table if not exists public.generated_invoices (
  invoice_id uuid primary key references public.member_invoices (id) on delete restrict,
  -- one per click of "Generate & Send Invoice": a repeated request returns the same invoice
  request_id uuid not null unique,
  customer_id uuid not null references public.customers (id) on delete restrict,
  purpose text not null check (purpose in ('SERVICES', 'ADDON', 'ADDITIONAL')),
  addon_request_id uuid references public.addon_requests (id) on delete set null,
  invoice_number text not null check (length(invoice_number) between 1 and 60),
  invoice_date date not null,
  order_number text not null default 'Verbal' check (length(btrim(order_number)) between 1 and 60),
  -- the customer as billed (a snapshot: later edits to the customer never change an issued invoice)
  customer_name text not null check (length(btrim(customer_name)) between 1 and 200),
  business_name text check (length(business_name) <= 200),
  business_address text not null check (length(btrim(business_address)) between 1 and 500),
  contact_person text check (length(contact_person) <= 200),
  contact_number text check (length(contact_number) <= 25),
  customer_gstin text check (customer_gstin is null or customer_gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  customer_state_code text not null references public.gst_states (code),
  customer_state text not null,
  supplier_state_code text not null default '27',
  tax_treatment text not null check (tax_treatment in ('INTRA_STATE', 'INTER_STATE')),
  tax_treatment_overridden boolean not null default false,
  tax_override_reason text check (length(tax_override_reason) <= 300),
  state_mismatch_acknowledged boolean not null default false,
  reverse_charge boolean not null default false,
  terms text not null check (length(btrim(terms)) between 1 and 2000),
  -- totals (exact numerics; recalculated by the database, never taken from the browser)
  subtotal numeric(14, 2) not null check (subtotal > 0),
  cgst_rate numeric(6, 3), cgst_amount numeric(14, 2) not null default 0,
  sgst_rate numeric(6, 3), sgst_amount numeric(14, 2) not null default 0,
  igst_rate numeric(6, 3), igst_amount numeric(14, 2) not null default 0,
  total_gst numeric(14, 2) not null check (total_gst >= 0),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  amount_in_words text not null,
  tax_breakdown jsonb not null check (jsonb_typeof(tax_breakdown) = 'array'),
  -- lifecycle (payment) - kept apart from the document and e-mail state below
  lifecycle text not null default 'ISSUED' check (lifecycle in ('ISSUED', 'PAID')),
  issued_at timestamptz not null default now(),
  issued_by uuid references public.profiles (id) on delete set null,
  payment_confirmed_at timestamptz,
  payment_confirmed_by uuid references public.profiles (id) on delete set null,
  payment_method text check (payment_method in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  payment_reference text check (length(payment_reference) <= 120),
  payment_note text check (length(payment_note) <= 1000),
  payment_paid_on date,
  -- stage 1: the unpaid invoice
  unpaid_pdf_status text not null default 'PENDING' check (unpaid_pdf_status in ('PENDING', 'STORED', 'FAILED')),
  unpaid_pdf_error text check (length(unpaid_pdf_error) <= 500),
  unpaid_storage_provider text check (unpaid_storage_provider in ('SUPABASE', 'R2')),
  unpaid_storage_bucket text, unpaid_storage_path text, unpaid_storage_ref text, unpaid_storage_etag text,
  unpaid_size_bytes integer check (unpaid_size_bytes > 0 and unpaid_size_bytes < 500000),
  unpaid_stored_at timestamptz,
  unpaid_email_status text not null default 'PENDING' check (unpaid_email_status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'NOT_SENT')),
  unpaid_email_to text, unpaid_email_sent_at timestamptz, unpaid_email_error text check (length(unpaid_email_error) <= 500),
  unpaid_email_attempts integer not null default 0, unpaid_email_message_id text,
  unpaid_work_until timestamptz,
  -- stage 2: the paid (stamped) invoice
  paid_pdf_status text not null default 'NOT_DUE' check (paid_pdf_status in ('NOT_DUE', 'PENDING', 'STORED', 'FAILED')),
  paid_pdf_error text check (length(paid_pdf_error) <= 500),
  paid_storage_provider text check (paid_storage_provider in ('SUPABASE', 'R2')),
  paid_storage_bucket text, paid_storage_path text, paid_storage_ref text, paid_storage_etag text,
  paid_size_bytes integer check (paid_size_bytes > 0 and paid_size_bytes < 500000),
  paid_stored_at timestamptz,
  paid_email_status text not null default 'NOT_DUE' check (paid_email_status in ('NOT_DUE', 'PENDING', 'SENDING', 'SENT', 'FAILED', 'NOT_SENT')),
  paid_email_to text, paid_email_sent_at timestamptz, paid_email_error text check (length(paid_email_error) <= 500),
  paid_email_attempts integer not null default 0, paid_email_message_id text,
  paid_work_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint generated_invoices_total_check check (total_amount = subtotal + total_gst),
  constraint generated_invoices_split_check check (cgst_amount + sgst_amount + igst_amount = total_gst),
  constraint generated_invoices_treatment_check check (
    (tax_treatment = 'INTRA_STATE' and igst_amount = 0) or (tax_treatment = 'INTER_STATE' and cgst_amount = 0 and sgst_amount = 0)),
  constraint generated_invoices_paid_check check (lifecycle = 'ISSUED' or payment_confirmed_at is not null),
  -- a document is "stored" only with a full reference; the paid document and e-mail exist only after payment
  constraint generated_invoices_unpaid_ref_check check (
    unpaid_pdf_status <> 'STORED' or (unpaid_storage_provider is not null and unpaid_storage_bucket is not null and unpaid_storage_path is not null
                                       and unpaid_storage_ref is not null and unpaid_size_bytes is not null and unpaid_stored_at is not null)),
  constraint generated_invoices_paid_ref_check check (
    paid_pdf_status <> 'STORED' or (lifecycle = 'PAID' and paid_storage_provider is not null and paid_storage_bucket is not null
                                     and paid_storage_path is not null and paid_storage_ref is not null and paid_size_bytes is not null and paid_stored_at is not null)),
  constraint generated_invoices_unpaid_mail_check check (unpaid_email_status <> 'SENT' or (unpaid_pdf_status = 'STORED' and unpaid_email_sent_at is not null)),
  constraint generated_invoices_paid_mail_check check (paid_email_status <> 'SENT' or (paid_pdf_status = 'STORED' and paid_email_sent_at is not null)),
  constraint generated_invoices_paid_stage_check check (lifecycle = 'PAID' or (paid_pdf_status = 'NOT_DUE' and paid_email_status = 'NOT_DUE'))
);
create index if not exists generated_invoices_customer_idx on public.generated_invoices (customer_id, issued_at desc);
create index if not exists generated_invoices_addon_idx on public.generated_invoices (addon_request_id) where addon_request_id is not null;
-- work still to do (a stored document whose e-mail is missing, a paid invoice without its document)
create index if not exists generated_invoices_open_idx on public.generated_invoices (issued_at)
  where unpaid_pdf_status <> 'STORED' or unpaid_email_status <> 'SENT' or (lifecycle = 'PAID' and (paid_pdf_status <> 'STORED' or paid_email_status <> 'SENT'));
drop trigger if exists generated_invoices_set_updated_at on public.generated_invoices;
create trigger generated_invoices_set_updated_at before update on public.generated_invoices
  for each row execute function public.tg_set_updated_at();

create table if not exists public.generated_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.generated_invoices (invoice_id) on delete restrict,
  position integer not null check (position >= 1),
  -- a plain copy, not a reference: renaming a catalogue service later never changes an issued invoice
  service_code text,
  particulars text not null check (length(btrim(particulars)) between 2 and 500),
  hsn_sac text not null check (hsn_sac ~ '^[0-9]{4,8}$'),
  tax_rate numeric(5, 2) not null check (tax_rate between 0 and 100),
  quantity_text text not null check (length(btrim(quantity_text)) between 1 and 30),
  base_amount numeric(14, 2) not null check (base_amount > 0),
  gst_amount numeric(14, 2) not null check (gst_amount >= 0),
  total_amount numeric(14, 2) not null,
  unique (invoice_id, position),
  constraint generated_invoice_items_gst_check check (gst_amount = round(base_amount * tax_rate / 100, 2)),
  constraint generated_invoice_items_total_check check (total_amount = base_amount + gst_amount)
);

-- Nobody signed in reads or writes these tables directly: only the functions below.
alter table public.generated_invoices enable row level security;
alter table public.generated_invoice_items enable row level security;
revoke all on public.generated_invoices from public, anon, authenticated;
revoke all on public.generated_invoice_items from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The issued snapshot never changes (also against a mistake in a later function)
-- ---------------------------------------------------------------------------
create or replace function private.tg_generated_invoice_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_open text[] := array['lifecycle', 'payment_confirmed_at', 'payment_confirmed_by', 'payment_method', 'payment_reference', 'payment_note',
    'payment_paid_on', 'updated_at', 'unpaid_pdf_status', 'unpaid_pdf_error', 'unpaid_storage_provider', 'unpaid_storage_bucket',
    'unpaid_storage_path', 'unpaid_storage_ref', 'unpaid_storage_etag', 'unpaid_size_bytes', 'unpaid_stored_at', 'unpaid_email_status',
    'unpaid_email_to', 'unpaid_email_sent_at', 'unpaid_email_error', 'unpaid_email_attempts', 'unpaid_email_message_id', 'unpaid_work_until',
    'paid_pdf_status', 'paid_pdf_error', 'paid_storage_provider', 'paid_storage_bucket', 'paid_storage_path', 'paid_storage_ref',
    'paid_storage_etag', 'paid_size_bytes', 'paid_stored_at', 'paid_email_status', 'paid_email_to', 'paid_email_sent_at', 'paid_email_error',
    'paid_email_attempts', 'paid_email_message_id', 'paid_work_until'];
begin
  if tg_op = 'DELETE' then
    raise exception 'CONFLICT: An issued invoice cannot be deleted.' using errcode = 'P0001';
  end if;
  if (to_jsonb(old) - v_open) is distinct from (to_jsonb(new) - v_open) then
    raise exception 'CONFLICT: An issued invoice cannot be edited. Its number, customer, lines, tax and amounts are fixed.' using errcode = 'P0001';
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
drop trigger if exists generated_invoices_immutable on public.generated_invoices;
create trigger generated_invoices_immutable before update or delete on public.generated_invoices
  for each row execute function private.tg_generated_invoice_immutable();

create or replace function private.tg_generated_invoice_items_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'CONFLICT: The lines of an issued invoice cannot be changed.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_generated_invoice_items_immutable() from public, anon, authenticated;
drop trigger if exists generated_invoice_items_immutable on public.generated_invoice_items;
create trigger generated_invoice_items_immutable before update or delete on public.generated_invoice_items
  for each row execute function private.tg_generated_invoice_items_immutable();

-- The invoice row itself: number, customer, amounts and dates are fixed; a payment is never silently reversed.
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
  if old.status = 'Paid' and new.status is distinct from 'Paid' then
    raise exception 'CONFLICT: A confirmed payment cannot be reversed here.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_member_invoice_generated_guard() from public, anon, authenticated;
drop trigger if exists member_invoices_generated_guard on public.member_invoices;
create trigger member_invoices_generated_guard before update or delete on public.member_invoices
  for each row when (old.kind = 'GENERATED') execute function private.tg_member_invoice_generated_guard();

-- Whichever way a generated invoice becomes Paid (the confirmation below, or the add-on payment confirmation), the
-- paid stage opens exactly once: payment recorded, paid document and e-mail due.
create or replace function private.tg_generated_invoice_paid()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.generated_invoices
     set lifecycle = 'PAID', payment_confirmed_at = coalesce(new.paid_at, now()), payment_confirmed_by = (select private.my_id()),
         paid_pdf_status = 'PENDING', paid_email_status = 'PENDING'
   where invoice_id = new.id and lifecycle = 'ISSUED';
  return null;
end $$;
revoke all on function private.tg_generated_invoice_paid() from public, anon, authenticated;
drop trigger if exists member_invoices_generated_paid on public.member_invoices;
create trigger member_invoices_generated_paid after update of status on public.member_invoices
  for each row when (new.kind = 'GENERATED' and new.status = 'Paid' and old.status is distinct from 'Paid')
  execute function private.tg_generated_invoice_paid();

-- A generated invoice reaches the client only once its PDF is stored (see accounts_invoice_record_pdf); the payment
-- confirmation still notifies as before.
create or replace function private.tg_client_invoice_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null or new.kind = 'MANUAL' then
    return null;
  end if;
  if tg_op = 'INSERT' and new.kind <> 'GENERATED' then
    perform private.client_notify(new.customer_id, 'INVOICE_ISSUED', format('New invoice %s', new.invoice_number),
      'Accounts has issued an invoice. Open Invoices to view or download it.', 'invoice', new.id, format('INV|%s|ISSUED', new.id));
  end if;
  if new.status = 'Paid' and (tg_op = 'INSERT' or old.status is distinct from 'Paid') then
    perform private.client_notify(new.customer_id, 'PAYMENT_CONFIRMED', format('Payment confirmed: invoice %s', new.invoice_number),
      'Accounts confirmed your payment. Thank you.', 'invoice', new.id, format('INV|%s|PAID', new.id));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_invoice_events() from public, anon, authenticated;

-- Who may read an invoice: Accounts, the person who issued it, and staff who may see the customer.
-- NULL-safe: the earlier version returned NULL ("unknown") for a login that is none of these - a client's - and the callers'
-- "if not can_read_invoice(...)" does not stop on NULL, so a client could read ANY invoice through invoice_detail().
create or replace function private.can_read_invoice(i public.member_invoices)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    private.is_accounts_staff()
      or i.owner_id = (select private.my_id())
      or (i.customer_id is not null and (private.can_view_customer(i.customer_id) or private.can_view_onboarding_review(i.customer_id))),
    false)
$$;
revoke all on function private.can_read_invoice(public.member_invoices) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. How a generated invoice looks to the people who may read it (no storage references, ever)
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
    'lifecycle', g.lifecycle,
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

-- The invoice as every view sees it (the existing function, with the generated invoice's details added).
create or replace function private.invoice_json(i public.member_invoices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'number', i.invoice_number, 'kind', i.kind, 'customerId', i.customer_id,
    'customer', coalesce(nullif(i.company, ''), i.customer_name), 'contact', i.customer_name,
    'customerCode', (select customer_code from public.customers where id = i.customer_id),
    'department', (select name from public.departments where id = coalesce(i.department_id, (select department_id from public.customers where id = i.customer_id))),
    'issueDate', nullif(i.issue_date, ''), 'dueDate', nullif(i.due_date, ''),
    'subtotal', coalesce(i.subtotal, i.amount), 'discount', coalesce(i.discount_total, 0), 'tax', coalesce(i.tax_total, 0), 'total', i.amount,
    'status', i.status, 'paidAt', i.paid_at, 'items', coalesce(i.details -> 'items', '[]'::jsonb), 'note', i.details ->> 'note',
    'reference', i.details ->> 'reference',
    'file', case when i.kind = 'UPLOADED' then private.invoice_file_json(i.id) end,
    'generated', case when i.kind = 'GENERATED' then private.generated_json(i.id) end,
    'addonRequestId', i.addon_request_id,
    'issuedBy', (select full_name from public.profiles where id = coalesce(i.issued_by, i.owner_id)),
    'issuedAt', coalesce(i.issued_at, i.created_at), 'createdAt', i.created_at)
$$;
revoke all on function private.invoice_json(public.member_invoices) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Prefill: the customer's details and the billable services of THE purchase being invoiced
-- ---------------------------------------------------------------------------
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
    if exists (select 1 from public.generated_invoices g where g.customer_id = c.id and g.purpose = 'SERVICES') then
      v_warnings := v_warnings || to_jsonb('An invoice for the original services was already issued. Use "Additional purchase" for anything new.'::text);
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

-- ---------------------------------------------------------------------------
-- 7. Issue the invoice (stage 1): validate, recalculate, reserve the number, persist the snapshot
-- ---------------------------------------------------------------------------
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
  elsif v_purpose = 'SERVICES' and exists (select 1 from public.generated_invoices x where x.customer_id = v_customer and x.purpose = 'SERVICES') then
    raise exception 'CONFLICT: An invoice for the original services was already issued. Use "Additional purchase" for anything new.' using errcode = 'P0001';
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

-- ---------------------------------------------------------------------------
-- 8. Each stage's work: one lease, then record what really happened
-- ---------------------------------------------------------------------------
-- Takes the stage's lease (3 minutes; a crashed run frees itself) and returns what the PDF is drawn from. claimed = false means
-- another run holds the lease ("BUSY") or the stage is complete ("DONE"): the caller must not repeat the work.
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
  v_pdf := case when v_stage = 'UNPAID' then g.unpaid_pdf_status else g.paid_pdf_status end;
  v_mail := case when v_stage = 'UNPAID' then g.unpaid_email_status else g.paid_email_status end;
  v_until := case when v_stage = 'UNPAID' then g.unpaid_work_until else g.paid_work_until end;
  select * into c from public.customers where id = g.customer_id;
  -- `stored` (where the PDF already is, when it is) lets a retry e-mail the file that was stored instead of drawing a second one.
  -- It is for Accounts only and never part of the invoice JSON other people read.
  v_snapshot := private.generated_json(g.invoice_id) || jsonb_build_object('invoiceId', g.invoice_id, 'customerId', g.customer_id, 'issuedAt', g.issued_at, 'stage', v_stage, 'recipientEmail', c.email,
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

create or replace function public.accounts_invoice_release(p_invoice uuid, p_stage text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  if upper(coalesce(p_stage, '')) = 'UNPAID' then
    update public.generated_invoices set unpaid_work_until = null where invoice_id = p_invoice;
  elsif upper(coalesce(p_stage, '')) = 'PAID' then
    update public.generated_invoices set paid_work_until = null where invoice_id = p_invoice;
  end if;
end $$;
revoke all on function public.accounts_invoice_release(uuid, text) from public, anon;
grant execute on function public.accounts_invoice_release(uuid, text) to authenticated;

-- The PDF is in storage: remember where. Only the one expected object name is accepted, and only below 500,000 bytes.
create or replace function public.accounts_invoice_record_pdf(
  p_invoice uuid, p_stage text, p_provider text, p_bucket text, p_path text, p_ref text, p_etag text, p_size integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := upper(coalesce(p_stage, ''));
  g public.generated_invoices;
  inv public.member_invoices;
  c public.customers;
  v_expected text;
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
  v_expected := format('customers/%s/invoices/%s/%s.pdf', g.customer_id, g.invoice_id, lower(v_stage));
  if p_provider not in ('SUPABASE', 'R2') or p_bucket is distinct from 'customer-documents' or p_path is distinct from v_expected
     or p_ref is null or p_ref not like '%' || p_bucket || '/' || p_path then
    raise exception 'VALIDATION_ERROR: That is not the stored invoice file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size <= 0 or p_size >= 500000 then
    raise exception 'VALIDATION_ERROR: The invoice PDF must be smaller than 500,000 bytes.' using errcode = 'P0001';
  end if;
  -- already stored: the first stored reference stays (a retry never creates a second one)
  if v_stage = 'UNPAID' and g.unpaid_pdf_status = 'STORED' then
    return private.invoice_json(inv);
  end if;
  if v_stage = 'PAID' and g.paid_pdf_status = 'STORED' then
    return private.invoice_json(inv);
  end if;
  if v_stage = 'UNPAID' then
    update public.generated_invoices set unpaid_pdf_status = 'STORED', unpaid_pdf_error = null, unpaid_storage_provider = p_provider,
        unpaid_storage_bucket = p_bucket, unpaid_storage_path = p_path, unpaid_storage_ref = p_ref, unpaid_storage_etag = p_etag,
        unpaid_size_bytes = p_size, unpaid_stored_at = now()
     where invoice_id = g.invoice_id;
  else
    update public.generated_invoices set paid_pdf_status = 'STORED', paid_pdf_error = null, paid_storage_provider = p_provider,
        paid_storage_bucket = p_bucket, paid_storage_path = p_path, paid_storage_ref = p_ref, paid_storage_etag = p_etag,
        paid_size_bytes = p_size, paid_stored_at = now()
     where invoice_id = g.invoice_id;
  end if;
  select * into c from public.customers where id = g.customer_id;
  perform private.write_audit(case when v_stage = 'UNPAID' then 'INVOICE_PDF_STORED' else 'INVOICE_PAID_PDF_STORED' end, 'invoice', g.invoice_id,
    c.department_id, c.team_id, jsonb_build_object('customer_id', c.id, 'number', g.invoice_number, 'stage', v_stage, 'provider', p_provider,
                                                    'size_bytes', p_size));
  -- the client sees the document only now that it is stored and linked to this invoice
  if v_stage = 'UNPAID' then
    perform private.client_notify(c.id, 'INVOICE_ISSUED', format('New invoice %s', g.invoice_number),
      'Accounts has issued an invoice. Open Invoices to view or download it.', 'invoice', g.invoice_id, format('INV|%s|ISSUED', g.invoice_id));
  else
    perform private.client_notify(c.id, 'INVOICE_PAID_READY', format('Your paid invoice %s is ready', g.invoice_number),
      'Your payment was confirmed. Open Invoices to view or download the paid invoice.', 'invoice', g.invoice_id, format('INV|%s|PAID_FILE', g.invoice_id));
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_invoice_record_pdf(uuid, text, text, text, text, text, text, integer) from public, anon;
grant execute on function public.accounts_invoice_record_pdf(uuid, text, text, text, text, text, text, integer) to authenticated;

-- The e-mail result. SENT only when the mail server accepted the message; NOT_SENT when nothing was sent (dry run, no address).
create or replace function public.accounts_invoice_record_email(
  p_invoice uuid, p_stage text, p_outcome text, p_to text, p_message_id text, p_detail text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := upper(coalesce(p_stage, ''));
  v_outcome text := upper(coalesce(p_outcome, ''));
  g public.generated_invoices;
  inv public.member_invoices;
  c public.customers;
  v_status text; v_mail text;
begin
  perform private.require_accounts_staff();
  if v_stage not in ('UNPAID', 'PAID') or v_outcome not in ('SENT', 'NOT_SENT', 'FAILED') then
    raise exception 'VALIDATION_ERROR: Unknown stage or outcome.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  v_status := case when v_stage = 'UNPAID' then g.unpaid_pdf_status else g.paid_pdf_status end;
  v_mail := case when v_stage = 'UNPAID' then g.unpaid_email_status else g.paid_email_status end;
  if v_mail = 'SENT' then
    return private.invoice_json(inv); -- never downgrade, never count a second delivery
  end if;
  if v_status <> 'STORED' then
    raise exception 'CONFLICT: The invoice PDF is not stored yet, so nothing can be e-mailed.' using errcode = 'P0001';
  end if;
  if v_stage = 'UNPAID' then
    update public.generated_invoices set unpaid_email_status = v_outcome, unpaid_email_to = left(p_to, 254),
        unpaid_email_sent_at = case when v_outcome = 'SENT' then now() end, unpaid_email_message_id = case when v_outcome = 'SENT' then left(p_message_id, 300) end,
        unpaid_email_error = case when v_outcome = 'SENT' then null else left(coalesce(p_detail, 'The e-mail was not sent.'), 500) end,
        unpaid_email_attempts = unpaid_email_attempts + 1, unpaid_work_until = null
     where invoice_id = g.invoice_id;
  else
    update public.generated_invoices set paid_email_status = v_outcome, paid_email_to = left(p_to, 254),
        paid_email_sent_at = case when v_outcome = 'SENT' then now() end, paid_email_message_id = case when v_outcome = 'SENT' then left(p_message_id, 300) end,
        paid_email_error = case when v_outcome = 'SENT' then null else left(coalesce(p_detail, 'The e-mail was not sent.'), 500) end,
        paid_email_attempts = paid_email_attempts + 1, paid_work_until = null
     where invoice_id = g.invoice_id;
  end if;
  select * into c from public.customers where id = g.customer_id;
  perform private.write_audit('INVOICE_EMAIL_' || v_outcome, 'invoice', g.invoice_id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', g.invoice_number, 'stage', v_stage, 'detail', left(p_detail, 200)));
  if v_outcome = 'SENT' then
    perform private.log_customer_activity(c.id, 'INVOICE_EMAILED',
      format('%s invoice %s e-mailed to the customer', case when v_stage = 'PAID' then 'Paid' else 'Unpaid' end, g.invoice_number));
  end if;
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_invoice_record_email(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.accounts_invoice_record_email(uuid, text, text, text, text, text) to authenticated;

-- A step failed: say which, free the lease, so the step can be retried (a stored PDF is never forgotten).
create or replace function public.accounts_invoice_record_failure(p_invoice uuid, p_stage text, p_step text, p_error text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := upper(coalesce(p_stage, ''));
  v_step text := upper(coalesce(p_step, ''));
  g public.generated_invoices;
  inv public.member_invoices;
begin
  perform private.require_accounts_staff();
  if v_stage not in ('UNPAID', 'PAID') or v_step not in ('PDF', 'EMAIL') then
    raise exception 'VALIDATION_ERROR: Unknown stage or step.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = p_invoice for update;
  if g.invoice_id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  if v_stage = 'UNPAID' and v_step = 'PDF' and g.unpaid_pdf_status <> 'STORED' then
    update public.generated_invoices set unpaid_pdf_status = 'FAILED', unpaid_pdf_error = left(p_error, 500), unpaid_work_until = null where invoice_id = g.invoice_id;
  elsif v_stage = 'PAID' and v_step = 'PDF' and g.paid_pdf_status <> 'STORED' then
    update public.generated_invoices set paid_pdf_status = 'FAILED', paid_pdf_error = left(p_error, 500), paid_work_until = null where invoice_id = g.invoice_id;
  elsif v_stage = 'UNPAID' and v_step = 'EMAIL' and g.unpaid_email_status <> 'SENT' then
    update public.generated_invoices set unpaid_email_status = 'FAILED', unpaid_email_error = left(p_error, 500),
        unpaid_email_attempts = unpaid_email_attempts + 1, unpaid_work_until = null where invoice_id = g.invoice_id;
  elsif v_stage = 'PAID' and v_step = 'EMAIL' and g.paid_email_status <> 'SENT' then
    update public.generated_invoices set paid_email_status = 'FAILED', paid_email_error = left(p_error, 500),
        paid_email_attempts = paid_email_attempts + 1, paid_work_until = null where invoice_id = g.invoice_id;
  end if;
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_invoice_record_failure(uuid, text, text, text) from public, anon;
grant execute on function public.accounts_invoice_record_failure(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Confirm the payment (stage 2): idempotent, never changes the issued snapshot
-- ---------------------------------------------------------------------------
create or replace function public.accounts_confirm_invoice_payment(
  p_invoice uuid, p_method text, p_reference text default null, p_note text default null, p_paid_on date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  g public.generated_invoices;
  c public.customers;
  r public.addon_requests;
  v_method text := upper(coalesce(nullif(btrim(p_method), ''), ''));
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null or inv.kind <> 'GENERATED' then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = inv.id for update;
  -- a repeated click or request: the payment was confirmed once already; nothing more is recorded
  if g.lifecycle = 'PAID' then
    return private.invoice_json(inv) || jsonb_build_object('replayed', true);
  end if;
  if v_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose how the payment was received.' using errcode = 'P0001';
  end if;
  if p_paid_on is not null and (p_paid_on > v_today or p_paid_on < g.invoice_date) then
    raise exception 'VALIDATION_ERROR: The payment date cannot be in the future or before the invoice date.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = g.customer_id for update;

  if inv.addon_request_id is not null then
    -- an add-on invoice follows the add-on payment rules: the verified payments must cover the whole invoice
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
  -- the status change opened the paid stage (see the trigger); add what Accounts recorded about the payment
  update public.generated_invoices
     set payment_method = v_method, payment_reference = v_ref, payment_note = v_note, payment_paid_on = coalesce(p_paid_on, v_today)
   where invoice_id = g.invoice_id;
  perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_CONFIRMED', format('Payment of invoice %s confirmed by Accounts', inv.invoice_number));
  perform private.write_audit('INVOICE_PAYMENT_CONFIRMED', 'invoice', inv.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'total', inv.amount, 'method', v_method, 'reference', v_ref));
  perform private.notify(c.owner_id, 'INVOICE_PAID', format('Payment confirmed: %s', coalesce(c.company, c.name)),
    format('Accounts confirmed the payment of invoice %s (%s).', inv.invoice_number, private.rupees(inv.amount)), 'customer', c.id);
  select * into inv from public.member_invoices where id = p_invoice;
  return private.invoice_json(inv) || jsonb_build_object('replayed', false);
end $$;
revoke all on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date) from public, anon;
grant execute on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date) to authenticated;

-- A generated invoice is paid only through the confirmation above (which also sends the paid invoice); the older "mark paid /
-- pending" switch stays for the other kinds.
create or replace function public.accounts_set_invoice_status(p_invoice uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
begin
  perform private.require_accounts_staff();
  if p_status is null or p_status not in ('Paid', 'Pending') then
    raise exception 'VALIDATION_ERROR: Choose paid or pending.' using errcode = 'P0001';
  end if;
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind = 'GENERATED' then
    raise exception 'CONFLICT: A generated invoice is marked paid with "Confirm Payment & Send Paid Invoice", and a confirmed payment is not reversed here.' using errcode = 'P0001';
  end if;
  if inv.kind = 'ADDON' or inv.addon_request_id is not null then
    raise exception 'CONFLICT: An add-on invoice is marked paid when Accounts confirms the add-on payment.' using errcode = 'P0001';
  end if;
  update public.member_invoices
     set status = p_status, status_source = 'MANUAL', paid_at = case when p_status = 'Paid' then coalesce(paid_at, now()) end
   where id = p_invoice returning * into inv;
  perform private.write_audit('INVOICE_STATUS_CHANGED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'status', p_status));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_set_invoice_status(uuid, text) from public, anon;
grant execute on function public.accounts_set_invoice_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Opening a stored PDF: staff who may read the invoice
-- ---------------------------------------------------------------------------
create or replace function public.invoice_file_access(p_invoice uuid, p_stage text, p_action text default 'VIEW')
returns table (storage_provider text, storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := upper(coalesce(p_stage, ''));
  inv public.member_invoices;
  g public.generated_invoices;
  c public.customers;
begin
  select * into inv from public.member_invoices where id = p_invoice;
  if inv.id is null or inv.kind <> 'GENERATED' or not private.can_read_invoice(inv) then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if v_stage not in ('UNPAID', 'PAID') then
    raise exception 'VALIDATION_ERROR: Choose the unpaid or the paid invoice.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = inv.id;
  if (v_stage = 'UNPAID' and g.unpaid_pdf_status <> 'STORED') or (v_stage = 'PAID' and g.paid_pdf_status <> 'STORED') then
    raise exception 'NOT_FOUND: This invoice file is not available yet.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = g.customer_id;
  perform private.write_audit(case when upper(coalesce(p_action, '')) = 'DOWNLOAD' then 'INVOICE_DOWNLOADED' else 'INVOICE_VIEWED' end,
    'invoice', inv.id, c.department_id, c.team_id, jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'stage', v_stage));
  if v_stage = 'UNPAID' then
    return query select g.unpaid_storage_provider, g.unpaid_storage_bucket, g.unpaid_storage_path,
                        regexp_replace(g.invoice_number, '[^A-Za-z0-9._-]+', '-', 'g') || '-invoice.pdf', 'application/pdf'::text;
  else
    return query select g.paid_storage_provider, g.paid_storage_bucket, g.paid_storage_path,
                        regexp_replace(g.invoice_number, '[^A-Za-z0-9._-]+', '-', 'g') || '-paid-invoice.pdf', 'application/pdf'::text;
  end if;
end $$;
revoke all on function public.invoice_file_access(uuid, text, text) from public, anon;
grant execute on function public.invoice_file_access(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The client's own invoices (identity from the login only; no customer id anywhere)
-- ---------------------------------------------------------------------------
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
      'taxSummary', case when g.invoice_id is not null then jsonb_build_object('cgst', g.cgst_amount, 'sgst', g.sgst_amount, 'igst', g.igst_amount) end
    ) order by coalesce(i.issued_at, i.created_at) desc)
    from public.member_invoices i
    left join public.generated_invoices g on g.invoice_id = i.id
   where i.customer_id = v_customer and i.kind <> 'MANUAL'
     and (g.invoice_id is null or g.unpaid_pdf_status = 'STORED' or g.paid_pdf_status = 'STORED')), '[]'::jsonb);
end $$;
revoke all on function public.client_invoices() from public, anon;
grant execute on function public.client_invoices() to authenticated;

-- The stored PDF of one of MY invoices (uploaded or generated), with where it lives. The API signs a short-lived link for exactly
-- this file. A generated invoice offers the paid file once paid, and only when that file is stored.
create or replace function public.client_invoice_download(p_invoice uuid)
returns table (storage_provider text, storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  i public.member_invoices;
  g public.generated_invoices;
  d public.customer_documents;
  c public.customers;
  v_stage text;
begin
  select * into i from public.member_invoices where id = p_invoice and customer_id = v_customer and kind <> 'MANUAL';
  if i.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  if i.kind = 'GENERATED' then
    select * into g from public.generated_invoices where invoice_id = i.id;
    if g.paid_pdf_status = 'STORED' then
      v_stage := 'PAID';
    elsif i.status <> 'Paid' and g.unpaid_pdf_status = 'STORED' then
      v_stage := 'UNPAID';
    elsif i.status = 'Paid' then
      raise exception 'NOT_FOUND: Your paid invoice is being prepared. Please check again in a moment.' using errcode = 'P0001';
    else
      raise exception 'NOT_FOUND: This invoice has no file yet.' using errcode = 'P0001';
    end if;
    perform private.write_audit('CLIENT_INVOICE_VIEWED', 'invoice', i.id, c.department_id, c.team_id,
      jsonb_build_object('customer_id', v_customer, 'number', i.invoice_number, 'client_user', auth.uid(), 'stage', v_stage));
    if v_stage = 'PAID' then
      return query select g.paid_storage_provider, g.paid_storage_bucket, g.paid_storage_path,
                          regexp_replace(g.invoice_number, '[^A-Za-z0-9._-]+', '-', 'g') || '-paid-invoice.pdf', 'application/pdf'::text;
    else
      return query select g.unpaid_storage_provider, g.unpaid_storage_bucket, g.unpaid_storage_path,
                          regexp_replace(g.invoice_number, '[^A-Za-z0-9._-]+', '-', 'g') || '-invoice.pdf', 'application/pdf'::text;
    end if;
    return;
  end if;
  select * into d from public.customer_documents x where x.invoice_id = i.id and x.status = 'UPLOADED' order by x.uploaded_at desc nulls last limit 1;
  if d.id is null then
    raise exception 'NOT_FOUND: This invoice has no file yet.' using errcode = 'P0001';
  end if;
  perform private.write_audit('CLIENT_INVOICE_VIEWED', 'invoice', i.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', v_customer, 'number', i.invoice_number, 'client_user', auth.uid()));
  return query select d.storage_provider, d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;
revoke all on function public.client_invoice_download(uuid) from public, anon;
grant execute on function public.client_invoice_download(uuid) to authenticated;
