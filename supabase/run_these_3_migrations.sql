-- =============================================================================
-- The 3 migrations of the add-on verification + invoice PDF upload work, in order.
-- Paste the whole file into the Supabase SQL editor and run it once. Every part
-- is idempotent (safe to run again). Run it after run_these_4_migrations.sql.
--   1. 20261015000100_addon_verification_invoices.sql
--   2. 20261015000200_invoice_pdf_uploads.sql
--   3. 20261015000300_invoices_upload_only.sql
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261015000100_addon_verification_invoices.sql

-- =============================================================================
-- Add-on requests with Accounts verification, add-on payments, and invoices
-- issued by the Accounts department only.
--
--  1. Invoices (public.member_invoices, the existing invoice table)
--     * kind: MANUAL (created by Sales before this change, kept read-only),
--       SERVICE (original services) or ADDON (an approved add-on request)
--     * created only through Accounts functions; nobody writes the table directly
--     * readable by Accounts, by whoever may see the customer (Sales owner,
--       team head, department head, support of a post-sale customer), by the
--       Technical Consultant of the customer, and the Super Admin
--     * a SERVICE invoice fills the "Invoice" item of the onboarding checklist
--       (Sales can no longer upload, replace or delete invoice files)
--  2. addon_requests / addon_request_items / addon_request_events
--     DRAFT -> PENDING_VERIFICATION -> APPROVED -> INVOICE_GENERATED
--       -> PAYMENT_CONFIRMED -> IN_PROGRESS -> COMPLETED
--     with CHANGES_REQUESTED (back to the consultant) and REJECTED (closed).
--     One open request per customer; every step is a separate action and is
--     recorded in addon_request_events and the audit log.
--  3. addon_payments: the same record -> verify -> confirm steps Accounts uses
--     for the first payment, kept apart from the original-services ledger so a
--     pending add-on never changes the original onboarding or its payment status.
--  4. Add-on documents can be collected only after the add-on payment is
--     confirmed; the checklist comes from the paid add-on services.
--  5. Finance totals (Account Dashboard) include verified add-on payments.
-- Additive. Existing invoices, payments, documents and onboarding progress are kept.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Invoices
-- ---------------------------------------------------------------------------
alter table public.member_invoices
  add column if not exists kind text not null default 'MANUAL',
  add column if not exists department_id uuid references public.departments (id) on delete set null,
  add column if not exists subtotal numeric(14, 2),
  add column if not exists discount_total numeric(14, 2),
  add column if not exists tax_total numeric(14, 2),
  add column if not exists issued_by uuid references public.profiles (id) on delete set null,
  add column if not exists issued_at timestamptz,
  add column if not exists paid_at timestamptz,
  add column if not exists addon_request_id uuid;
do $$
begin
  alter table public.member_invoices add constraint member_invoices_kind_check check (kind in ('MANUAL', 'SERVICE', 'ADDON'));
exception when duplicate_object then null;
end $$;
create unique index if not exists member_invoices_issued_number_key on public.member_invoices (lower(invoice_number)) where kind <> 'MANUAL';
create index if not exists member_invoices_kind_idx on public.member_invoices (kind, created_at desc);

create sequence if not exists public.invoice_number_seq;

-- INV-2026-00001, never reused, never clashing with an older number.
create or replace function private.next_invoice_number()
returns text language plpgsql security definer set search_path = '' as $$
declare
  v text;
begin
  loop
    v := 'INV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.invoice_number_seq')::text, 5, '0');
    exit when not exists (select 1 from public.member_invoices where lower(invoice_number) = lower(v));
  end loop;
  return v;
end $$;
revoke all on function private.next_invoice_number() from public, anon, authenticated;

-- Writes only through the Accounts functions below (Sales keeps reading its older invoices).
revoke insert, update, delete on public.member_invoices from authenticated;
drop policy if exists member_invoices_insert on public.member_invoices;
drop policy if exists member_invoices_update on public.member_invoices;
drop policy if exists member_invoices_delete on public.member_invoices;

drop policy if exists member_invoices_select_related on public.member_invoices;
create policy member_invoices_select_related on public.member_invoices for select to authenticated
  using ((select private.is_accounts_staff())
         or (customer_id is not null and (private.can_view_customer(customer_id) or private.can_view_onboarding_review(customer_id))));

-- Customers Accounts may invoice: any customer that reached onboarding, or one Accounts already handles.
create or replace function private.accounts_can_invoice(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff() and exists (
    select 1 from public.customers c where c.id = p_customer
       and (c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') or private.accounts_can_view(c.id)))
$$;
revoke all on function private.accounts_can_invoice(uuid) from public, anon;
grant execute on function private.accounts_can_invoice(uuid) to authenticated;

-- Line items: [{ serviceCode?, name, quantity, unitPrice, discount, taxPercent }] -> normalised items and totals.
create or replace function private.price_items(p_items jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e jsonb;
  v_out jsonb := '[]'::jsonb;
  v_code text; v_name text; v_qty integer; v_price numeric; v_disc numeric; v_tax numeric;
  v_line numeric; v_line_tax numeric;
  v_sub numeric := 0; v_dsum numeric := 0; v_tsum numeric := 0;
  i integer := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'VALIDATION_ERROR: Add at least one service.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'VALIDATION_ERROR: Add at most 30 lines.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_items) loop
    i := i + 1;
    v_code := nullif(btrim(coalesce(e ->> 'serviceCode', '')), '');
    if v_code is not null then
      select s.name into v_name from public.crm_services s where s.code = v_code and s.is_active;
      if v_name is null then
        raise exception 'VALIDATION_ERROR: Line %: choose a service from the catalogue.', i using errcode = 'P0001';
      end if;
      v_name := coalesce(nullif(left(btrim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g')), 120), ''), v_name);
    else
      v_name := left(btrim(regexp_replace(coalesce(e ->> 'name', ''), '\s+', ' ', 'g')), 120);
      if length(v_name) < 2 then
        raise exception 'VALIDATION_ERROR: Line %: enter the service name.', i using errcode = 'P0001';
      end if;
    end if;
    begin
      v_qty := coalesce((e ->> 'quantity')::integer, 1);
      v_price := (e ->> 'unitPrice')::numeric;
      v_disc := coalesce((e ->> 'discount')::numeric, 0);
      v_tax := coalesce((e ->> 'taxPercent')::numeric, 0);
    exception when others then
      raise exception 'VALIDATION_ERROR: Line %: enter numbers for quantity, price, discount and tax.', i using errcode = 'P0001';
    end;
    if v_qty is null or v_qty < 1 or v_qty > 1000 then
      raise exception 'VALIDATION_ERROR: Line %: the quantity must be between 1 and 1000.', i using errcode = 'P0001';
    end if;
    if v_price is null or v_price < 0 or v_price > 100000000 or v_price <> round(v_price, 2) then
      raise exception 'VALIDATION_ERROR: Line %: enter the agreed price in rupees (up to 2 decimals).', i using errcode = 'P0001';
    end if;
    if v_disc < 0 or v_disc <> round(v_disc, 2) or v_disc > v_qty * v_price then
      raise exception 'VALIDATION_ERROR: Line %: the discount cannot be more than the line amount.', i using errcode = 'P0001';
    end if;
    if v_tax < 0 or v_tax > 100 or v_tax <> round(v_tax, 2) then
      raise exception 'VALIDATION_ERROR: Line %: the tax must be between 0 and 100 %%.', i using errcode = 'P0001';
    end if;
    v_line := v_qty * v_price - v_disc;
    v_line_tax := round(v_line * v_tax / 100, 2);
    v_sub := v_sub + v_qty * v_price;
    v_dsum := v_dsum + v_disc;
    v_tsum := v_tsum + v_line_tax;
    v_out := v_out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'serviceCode', v_code, 'name', v_name, 'quantity', v_qty, 'unitPrice', v_price, 'discount', v_disc,
      'taxPercent', v_tax, 'tax', v_line_tax, 'lineTotal', v_line + v_line_tax)));
  end loop;
  return jsonb_build_object('items', v_out, 'subtotal', v_sub, 'discount', v_dsum, 'tax', v_tsum, 'total', v_sub - v_dsum + v_tsum);
end $$;
revoke all on function private.price_items(jsonb) from public, anon, authenticated;

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
    'addonRequestId', i.addon_request_id,
    'issuedBy', (select full_name from public.profiles where id = coalesce(i.issued_by, i.owner_id)),
    'issuedAt', coalesce(i.issued_at, i.created_at), 'createdAt', i.created_at)
$$;
revoke all on function private.invoice_json(public.member_invoices) from public, anon, authenticated;

-- The SERVICE invoice is the customer's "Invoice" item in the onboarding checklist.
create or replace function private.invoice_fills_checklist(i public.member_invoices)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if i.kind <> 'SERVICE' or i.customer_id is null then
    return;
  end if;
  if not exists (select 1 from public.customer_onboarding where customer_id = i.customer_id) then
    return;
  end if;
  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, document_id, status, saved_by, saved_at)
  values (i.customer_id, 'INVOICE', format('%s · Rs. %s · issued by Accounts', i.invoice_number, to_char(i.amount, 'FM99,99,99,99,990.00')),
          null, 'SAVED', i.issued_by, now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, document_id = null, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null, review_note = case when e.status = 'REJECTED' then e.review_note end;
  perform private.refresh_onboarding_progress(i.customer_id);
end $$;
revoke all on function private.invoice_fills_checklist(public.member_invoices) from public, anon, authenticated;

-- Progress: the mandatory "Invoice" now counts when Accounts has issued the service invoice
-- (Sales no longer uploads one); invoice PDFs uploaded before this change still count.
create or replace function private.refresh_onboarding_progress(p_customer uuid)
returns void language sql security definer set search_path = '' as $$
  with items as (select code from private.customer_items(p_customer)),
  e as (
    select e.status from public.customer_onboarding_entries e
    join items i on i.code = e.item_code
    where e.customer_id = p_customer),
  ci as (select code from private.customer_consultant_items(p_customer))
  update public.customer_onboarding o set
    mandatory_saved = (
      select count(*) from public.document_types t
      where t.is_mandatory and (
        exists (select 1 from public.customer_documents d where d.customer_id = p_customer and d.document_type = t.code and d.status = 'UPLOADED')
        or (t.code = 'INVOICE' and exists (select 1 from public.member_invoices mi where mi.customer_id = p_customer and mi.kind = 'SERVICE')))),
    items_total = (select count(*) from items),
    items_saved = (select count(*) from e where status in ('SAVED', 'VERIFIED')),
    items_verified = (select count(*) from e where status = 'VERIFIED'),
    items_rejected = (select count(*) from e where status = 'REJECTED'),
    consultant_items_total = (select count(*) from ci),
    consultant_items_done = (select count(*) from public.customer_onboarding_entries x
                              join ci on ci.code = x.item_code where x.customer_id = p_customer)
  where o.customer_id = p_customer
$$;
revoke all on function private.refresh_onboarding_progress(uuid) from public, anon, authenticated;

-- Accounts: a customer's invoice for the original services.
create or replace function public.accounts_create_invoice(
  p_customer uuid, p_items jsonb, p_issue_date date default null, p_due_date date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  t jsonb;
  inv public.member_invoices;
  v_issue date := coalesce(p_issue_date, current_date);
begin
  perform private.require_accounts_staff();
  if not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if p_due_date is not null and p_due_date < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the invoice date.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 1000 characters.' using errcode = 'P0001';
  end if;
  t := private.price_items(p_items);
  if (t ->> 'total')::numeric <= 0 then
    raise exception 'VALIDATION_ERROR: The invoice total must be more than zero.' using errcode = 'P0001';
  end if;
  insert into public.member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, details,
                                      customer_id, kind, department_id, subtotal, discount_total, tax_total, issued_by, issued_at)
  values ((select private.my_id()), private.next_invoice_number(), v.name, coalesce(v.company, ''), (t ->> 'total')::numeric, 'Pending',
          v_issue::text, coalesce(p_due_date::text, ''),
          jsonb_strip_nulls(jsonb_build_object('items', t -> 'items', 'note', nullif(btrim(coalesce(p_note, '')), ''))),
          v.id, 'SERVICE', v.department_id, (t ->> 'subtotal')::numeric, (t ->> 'discount')::numeric, (t ->> 'tax')::numeric,
          (select private.my_id()), now())
  returning * into inv;
  perform private.invoice_fills_checklist(inv);
  perform private.log_customer_activity(v.id, 'INVOICE_ISSUED', format('Invoice %s issued by Accounts', inv.invoice_number));
  perform private.write_audit('INVOICE_ISSUED', 'invoice', inv.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', v.id, 'number', inv.invoice_number, 'total', inv.amount, 'kind', 'SERVICE'));
  perform private.notify(v.owner_id, 'INVOICE_ISSUED', format('Invoice issued: %s', coalesce(v.company, v.name)),
    format('Accounts issued invoice %s (%s).', inv.invoice_number, private.rupees(inv.amount)), 'customer', v.id);
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_create_invoice(uuid, jsonb, date, date, text) from public, anon;
grant execute on function public.accounts_create_invoice(uuid, jsonb, date, date, text) to authenticated;

-- Accounts marks a service / older invoice paid or pending (add-on invoices follow the add-on payment).
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
  if inv.kind = 'ADDON' then
    raise exception 'CONFLICT: An add-on invoice is marked paid when Accounts confirms the add-on payment.' using errcode = 'P0001';
  end if;
  update public.member_invoices set status = p_status, paid_at = case when p_status = 'Paid' then coalesce(paid_at, now()) end
   where id = p_invoice returning * into inv;
  perform private.write_audit('INVOICE_STATUS_CHANGED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'status', p_status));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_set_invoice_status(uuid, text) from public, anon;
grant execute on function public.accounts_set_invoice_status(uuid, text) to authenticated;

-- Accounts: every invoice, newest first.
create or replace function public.accounts_invoices(
  p_search text default null, p_kind text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_items jsonb;
begin
  perform private.require_accounts_staff();
  select count(*) into v_total from public.member_invoices i
   where (p_kind is null or i.kind = p_kind) and (p_status is null or i.status = p_status)
     and (v_term is null or lower(i.invoice_number) like '%' || v_term || '%' or lower(i.customer_name) like '%' || v_term || '%'
          or lower(coalesce(i.company, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(private.invoice_json(x) order by x.created_at desc), '[]'::jsonb) into v_items from (
    select i.* from public.member_invoices i
     where (p_kind is null or i.kind = p_kind) and (p_status is null or i.status = p_status)
       and (v_term is null or lower(i.invoice_number) like '%' || v_term || '%' or lower(i.customer_name) like '%' || v_term || '%'
            or lower(coalesce(i.company, '')) like '%' || v_term || '%')
     order by i.created_at desc limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_invoices(text, text, text, integer, integer) from public, anon;
grant execute on function public.accounts_invoices(text, text, text, integer, integer) to authenticated;

-- Accounts: customers that can be invoiced, those without a service invoice first.
create or replace function public.accounts_invoice_customers(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  perform private.require_accounts_staff();
  return coalesce((
    select jsonb_agg(j order by has_invoice, name) from (
      select c.id, coalesce(c.company, c.name) as name,
             exists (select 1 from public.member_invoices i where i.customer_id = c.id and i.kind = 'SERVICE') as has_invoice,
             jsonb_build_object('id', c.id, 'name', c.name, 'company', c.company, 'customerCode', c.customer_code,
               'department', (select name from public.departments where id = c.department_id), 'stage', c.lifecycle_stage,
               'dealAmount', c.deal_amount, 'amountVerified', c.amount_verified,
               'services', (select coalesce(jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order), '[]'::jsonb)
                              from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id),
               'hasServiceInvoice', exists (select 1 from public.member_invoices i where i.customer_id = c.id and i.kind = 'SERVICE')) as j
        from public.customers c
       where private.accounts_can_invoice(c.id)
         and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
       order by 3, 2 limit 50) t), '[]'::jsonb);
end $$;
revoke all on function public.accounts_invoice_customers(text) from public, anon;
grant execute on function public.accounts_invoice_customers(text) to authenticated;

-- Invoice files are no longer uploaded by Sales: the Invoice item is filled by Accounts.
create or replace function public.begin_document_upload(
  p_customer uuid, p_type text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_type);
  t public.document_types;
  d public.customer_documents;
  v_id uuid := gen_random_uuid();
  v_ext text;
begin
  if p_type = 'INVOICE' then
    raise exception 'FORBIDDEN: Invoices are issued by the Accounts department.' using errcode = '42501';
  end if;
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Documents are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = p_type;
  if t.code is null then
    raise exception 'VALIDATION_ERROR: Unknown document type.' using errcode = 'P0001';
  end if;
  if p_mime is null or not (p_mime = any (t.allowed_mime_types)) then
    raise exception 'VALIDATION_ERROR: This file type is not accepted for %.', t.label using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File must be smaller than %.',
      case when t.max_size_bytes < 1048576 then (t.max_size_bytes / 1024) || ' KB' else (t.max_size_bytes / 1048576) || ' MB' end using errcode = 'P0001';
  end if;
  v_ext := case p_mime
    when 'application/pdf' then 'pdf' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
    when 'text/csv' then 'csv' when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx'
    when 'audio/mpeg' then 'mp3' when 'audio/wav' then 'wav' when 'audio/mp4' then 'm4a' else 'bin' end;

  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by)
  values (v_id, p_customer, p_type, null, 'PENDING',
          format('customers/%s/%s/%s.%s', p_customer, t.storage_folder, v_id, v_ext),
          left(regexp_replace(coalesce(nullif(trim(p_file_name), ''), 'document.' || v_ext), '[\r\n\t/\\]', '_', 'g'), 255),
          p_mime, p_size, (select private.my_id()))
  returning * into d;
  return d;
end $$;
revoke all on function public.begin_document_upload(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.begin_document_upload(uuid, text, text, text, bigint) to authenticated;

create or replace function public.delete_customer_document(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
begin
  select * into d from public.customer_documents where id = p_document for update;
  if d.id is null or not private.can_access_customer(d.customer_id) or d.status not in ('UPLOADED', 'SUPERSEDED') then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.document_type = 'INVOICE' then
    raise exception 'FORBIDDEN: Invoices are kept by the Accounts department and cannot be deleted here.' using errcode = '42501';
  end if;
  v := private.lock_accessible_customer(d.customer_id);
  if v.lifecycle_stage = 'ONBOARDING' and exists (
       select 1 from public.customer_onboarding o where o.customer_id = d.customer_id and o.forwarded_to_support_at is not null)
     and d.status = 'UPLOADED' then
    raise exception 'CONFLICT: Documents are locked after forwarding to support. Upload a replacement instead.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'DELETED', deleted_at = now(), deleted_by = (select private.my_id())
   where id = p_document;
  perform private.write_audit('DOCUMENT_DELETED', 'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version));
  perform private.log_customer_activity(d.customer_id, 'DOCUMENT_DELETED',
    format('%s v%s deleted', (select label from public.document_types where code = d.document_type), d.version));
  perform private.refresh_onboarding_progress(d.customer_id);
  return d.storage_path;
end $$;
revoke all on function public.delete_customer_document(uuid) from public, anon;
grant execute on function public.delete_customer_document(uuid) to authenticated;

-- Sales cannot type a value into the Invoice item either.
create or replace function public.save_onboarding_entry(p_customer uuid, p_item text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_collect_customer(p_customer, p_item);
  i public.onboarding_items;
  v_value text := nullif(trim(coalesce(p_value, '')), '');
begin
  if p_item = 'INVOICE' then
    raise exception 'FORBIDDEN: Invoices are issued by the Accounts department.' using errcode = '42501';
  end if;
  if v.lifecycle_stage not in ('ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Details are collected once the customer is in onboarding.' using errcode = 'P0001';
  end if;
  select * into i from (select * from private.customer_items(p_customer)
                         union all select * from private.customer_optional_items(p_customer)
                         union all select * from private.customer_addon_items(p_customer)) x where x.code = p_item limit 1;
  if i.code is null then
    raise exception 'VALIDATION_ERROR: This item is not part of this customer''s onboarding.' using errcode = 'P0001';
  end if;
  if i.kind = 'FILE' then
    raise exception 'VALIDATION_ERROR: Upload a file for this item.' using errcode = 'P0001';
  end if;
  if v_value is null then
    raise exception 'VALIDATION_ERROR: Enter a value.' using errcode = 'P0001';
  end if;
  if length(v_value) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep it under 4000 characters.' using errcode = 'P0001';
  end if;
  if i.kind = 'YES_NO' and v_value not in ('YES', 'NO') then
    raise exception 'VALIDATION_ERROR: Answer yes or no.' using errcode = 'P0001';
  end if;
  if i.kind = 'AMOUNT' and v_value !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception 'VALIDATION_ERROR: Enter an amount in rupees.' using errcode = 'P0001';
  end if;
  if i.kind = 'CHOICE' and not (v_value = any (i.options)) then
    raise exception 'VALIDATION_ERROR: Choose one of the options.' using errcode = 'P0001';
  end if;

  insert into public.customer_onboarding_entries as e (customer_id, item_code, value, status, saved_by, saved_at)
  values (p_customer, p_item, v_value, 'SAVED', (select private.my_id()), now())
  on conflict (customer_id, item_code) do update
    set value = excluded.value, status = 'SAVED', saved_by = excluded.saved_by, saved_at = now(),
        reviewed_by = null, reviewed_at = null,
        review_note = case when e.status = 'REJECTED' then e.review_note end;

  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEM_SAVED', format('%s saved', i.label));
  perform private.write_audit('ONBOARDING_ITEM_SAVED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('item', p_item));
  perform private.refresh_onboarding_progress(p_customer);
end $$;
revoke all on function public.save_onboarding_entry(uuid, text, text) from public, anon;
grant execute on function public.save_onboarding_entry(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Add-on requests
-- ---------------------------------------------------------------------------
create table if not exists public.addon_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  consultant_id uuid references public.profiles (id) on delete set null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED',
                                                         'INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED')),
  notes text check (length(notes) <= 2000),
  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  tax_total numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  version integer not null default 1,
  submitted_at timestamptz,
  submitted_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete set null,
  decision_note text check (length(decision_note) <= 1000),
  invoice_id uuid references public.member_invoices (id) on delete set null,
  payment_confirmed_at timestamptz,
  payment_confirmed_by uuid references public.profiles (id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open request per customer at a time (closed = rejected or completed).
create unique index if not exists addon_requests_one_open on public.addon_requests (customer_id) where status not in ('REJECTED', 'COMPLETED');
create index if not exists addon_requests_status_idx on public.addon_requests (status, submitted_at desc);
drop trigger if exists addon_requests_set_updated_at on public.addon_requests;
create trigger addon_requests_set_updated_at before update on public.addon_requests
  for each row execute function public.tg_set_updated_at();

create table if not exists public.addon_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.addon_requests (id) on delete cascade,
  service_code text references public.crm_services (code) on delete set null,
  name text not null check (length(name) between 2 and 120),
  quantity integer not null check (quantity between 1 and 1000),
  unit_price numeric(14, 2) not null check (unit_price >= 0),
  discount numeric(14, 2) not null default 0 check (discount >= 0),
  tax_percent numeric(5, 2) not null default 0 check (tax_percent between 0 and 100),
  tax numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null,
  sort_order integer not null default 0
);
create index if not exists addon_request_items_request_idx on public.addon_request_items (request_id, sort_order);

create table if not exists public.addon_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.addon_requests (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  action text not null,
  note text check (length(note) <= 1000),
  snapshot jsonb,
  created_at timestamptz not null default now()
);
create index if not exists addon_request_events_request_idx on public.addon_request_events (request_id, created_at);

alter table public.member_invoices drop constraint if exists member_invoices_addon_request_fkey;
alter table public.member_invoices add constraint member_invoices_addon_request_fkey
  foreign key (addon_request_id) references public.addon_requests (id) on delete set null;
create unique index if not exists member_invoices_addon_request_key on public.member_invoices (addon_request_id) where addon_request_id is not null;

-- Add-on payments: same steps as the first payment, kept apart from the original-services ledger.
create table if not exists public.addon_payments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.addon_requests (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  amount numeric(14, 2) not null check (amount > 0),
  method text check (method in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  reference text check (length(reference) between 1 and 120),
  paid_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED')),
  note text check (length(note) <= 1000),
  status_reason text check (length(status_reason) <= 500),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists addon_payments_request_idx on public.addon_payments (request_id, paid_at desc);
create unique index if not exists addon_payments_reference_key on public.addon_payments (request_id, lower(reference))
  where reference is not null and status in ('PENDING', 'VERIFIED');
drop trigger if exists addon_payments_set_updated_at on public.addon_payments;
create trigger addon_payments_set_updated_at before update on public.addon_payments
  for each row execute function public.tg_set_updated_at();

alter table public.addon_requests enable row level security;
alter table public.addon_request_items enable row level security;
alter table public.addon_request_events enable row level security;
alter table public.addon_payments enable row level security;
revoke all on public.addon_requests, public.addon_request_items, public.addon_request_events, public.addon_payments from anon, authenticated;

-- The latest add-on state, on the onboarding row, for lists and Sales tracking.
alter table public.customer_onboarding add column if not exists addon_request_status text;

create or replace function private.tg_addon_request_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.customer_onboarding o
     set addon_request_status = (select r.status from public.addon_requests r where r.customer_id = new.customer_id
                                  order by (r.status not in ('REJECTED', 'COMPLETED')) desc, r.created_at desc limit 1)
   where o.customer_id = new.customer_id;
  perform private.refresh_addon_progress(new.customer_id);
  return null;
end $$;
drop trigger if exists addon_requests_status_sync on public.addon_requests;
create trigger addon_requests_status_sync after insert or update of status on public.addon_requests
  for each row execute function private.tg_addon_request_status();

-- Who works on a customer's add-ons: the Technical Consultant of its department while it is with them.
create or replace function private.can_manage_addons(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_support_department_id())
     and private.can_review_onboarding(p_customer)
$$;
revoke all on function private.can_manage_addons(uuid) from public, anon;
grant execute on function private.can_manage_addons(uuid) to authenticated;

-- Who may read a customer's add-ons: the consultants, Accounts, the salesperson and their heads, the Super Admin.
create or replace function private.can_view_addons(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff() or private.can_view_onboarding_review(p_customer) or private.can_view_customer(p_customer)
$$;
revoke all on function private.can_view_addons(uuid) from public, anon;
grant execute on function private.can_view_addons(uuid) to authenticated;

create or replace function private.addon_event(p_request uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.addon_request_events (request_id, actor_id, action, note, snapshot)
  select p_request, (select private.my_id()), p_action, left(p_note, 1000),
         jsonb_build_object('status', r.status, 'total', r.total, 'version', r.version,
           'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'unitPrice', i.unit_price,
                                                                  'discount', i.discount, 'taxPercent', i.tax_percent, 'lineTotal', i.line_total)
                                               order by i.sort_order), '[]'::jsonb)
                       from public.addon_request_items i where i.request_id = r.id))
    from public.addon_requests r where r.id = p_request;
end $$;
revoke all on function private.addon_event(uuid, text, text) from public, anon, authenticated;

create or replace function private.notify_accounts_addon(p_type text, p_title text, p_body text, p_entity uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
     where p.status = 'ACTIVE' and d.slug = 'accounts' and p.id <> coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
  loop
    perform private.notify(v_recipient, p_type, p_title, p_body, 'addon_request', p_entity);
  end loop;
end $$;
revoke all on function private.notify_accounts_addon(text, text, text, uuid) from public, anon, authenticated;

-- The consultant who submitted (or, before that, every consultant of the department).
create or replace function private.notify_consultant(r public.addon_requests, p_type text, p_title text, p_body text, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  if r.consultant_id is not null then
    perform private.notify(r.consultant_id, p_type, p_title, p_body, 'addon_request', r.id, '{}'::jsonb, p_priority);
    return;
  end if;
  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
     where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = r.department_id and p.is_technical_consultant
  loop
    perform private.notify(v_recipient, p_type, p_title, p_body, 'addon_request', r.id, '{}'::jsonb, p_priority);
  end loop;
end $$;
revoke all on function private.notify_consultant(public.addon_requests, text, text, text, text) from public, anon, authenticated;

create or replace function private.addon_request_json(r public.addon_requests, p_full boolean default true)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'customerId', r.customer_id, 'status', r.status, 'version', r.version, 'notes', r.notes,
    'customer', coalesce(c.company, c.name), 'contact', c.name, 'customerCode', c.customer_code, 'phone', c.phone,
    'department', (select name from public.departments where id = r.department_id),
    'consultant', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = r.consultant_id),
    'salesperson', (select full_name from public.profiles where id = c.owner_id),
    'originalServices', (select coalesce(jsonb_agg(s.name order by s.sort_order), '[]'::jsonb)
                           from public.customer_services cs join public.crm_services s on s.code = cs.service_code where cs.customer_id = c.id),
    'originalAmount', c.deal_amount,
    'onboardingReference', c.customer_code,
    'onboardingStartedAt', (select coalesce(o.consultant_started_at, o.accounts_confirmed_at, o.started_at) from public.customer_onboarding o where o.customer_id = c.id),
    'subtotal', r.subtotal, 'discount', r.discount_total, 'tax', r.tax_total, 'total', r.total,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'serviceCode', i.service_code, 'name', i.name, 'quantity', i.quantity,
                                                           'unitPrice', i.unit_price, 'discount', i.discount, 'taxPercent', i.tax_percent,
                                                           'tax', i.tax, 'lineTotal', i.line_total) order by i.sort_order), '[]'::jsonb)
                from public.addon_request_items i where i.request_id = r.id),
    'submittedAt', r.submitted_at, 'decidedAt', r.decided_at, 'decisionNote', r.decision_note,
    'decidedBy', (select full_name from public.profiles where id = r.decided_by),
    'invoice', (select private.invoice_json(i) from public.member_invoices i where i.id = r.invoice_id),
    'payments', case when p_full then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
                                                     'paidAt', p.paid_at, 'status', p.status, 'note', p.note, 'reason', p.status_reason,
                                                     'recordedBy', (select full_name from public.profiles where id = p.recorded_by),
                                                     'verifiedBy', (select full_name from public.profiles where id = p.verified_by),
                                                     'verifiedAt', p.verified_at) order by p.paid_at desc, p.recorded_at desc), '[]'::jsonb)
                      from public.addon_payments p where p.request_id = r.id) end,
    'paid', (select coalesce(sum(amount), 0) from public.addon_payments where request_id = r.id and status = 'VERIFIED'),
    'pendingPayments', (select coalesce(sum(amount), 0) from public.addon_payments where request_id = r.id and status = 'PENDING'),
    'paymentConfirmedAt', r.payment_confirmed_at,
    'paymentConfirmedBy', (select full_name from public.profiles where id = r.payment_confirmed_by),
    'startedAt', r.started_at, 'completedAt', r.completed_at, 'createdAt', r.created_at, 'updatedAt', r.updated_at,
    'documents', (select jsonb_build_object('total', o.addon_items_total, 'saved', o.addon_items_saved, 'verified', o.addon_items_verified,
                                            'rejected', o.addon_items_rejected) from public.customer_onboarding o where o.customer_id = r.customer_id),
    'events', case when p_full then (select coalesce(jsonb_agg(jsonb_build_object('action', e.action, 'note', e.note, 'at', e.created_at,
                                                   'by', (select full_name from public.profiles where id = e.actor_id)) order by e.created_at, e.id), '[]'::jsonb)
                    from public.addon_request_events e where e.request_id = r.id) end)
  from public.customers c where c.id = r.customer_id
$$;
revoke all on function private.addon_request_json(public.addon_requests, boolean) from public, anon, authenticated;

-- The customer's current add-on request (open one first), or null.
create or replace function public.customer_addon_request(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.addon_requests;
begin
  if not private.can_view_addons(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into r from public.addon_requests where customer_id = p_customer
   order by (status not in ('REJECTED', 'COMPLETED')) desc, created_at desc limit 1;
  if r.id is null then
    return null;
  end if;
  return private.addon_request_json(r) || jsonb_build_object('canEdit', r.status in ('DRAFT', 'CHANGES_REQUESTED') and private.can_manage_addons(p_customer));
end $$;
revoke all on function public.customer_addon_request(uuid) from public, anon;
grant execute on function public.customer_addon_request(uuid) to authenticated;

-- Technical Consultant: save the add-on services and agreed prices; optionally submit them to Accounts.
create or replace function public.consultant_save_addon_request(
  p_customer uuid, p_items jsonb, p_notes text default null, p_submit boolean default false, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  r public.addon_requests;
  t jsonb;
  e jsonb;
  n integer := 0;
begin
  if not private.can_manage_addons(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_notes, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the notes under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into r from public.addon_requests where customer_id = p_customer and status not in ('REJECTED', 'COMPLETED') for update;
  if r.id is not null and r.status not in ('DRAFT', 'CHANGES_REQUESTED') then
    raise exception 'CONFLICT: This add-on request is with Accounts (%). It can change only if Accounts asks for changes.',
      lower(replace(r.status, '_', ' ')) using errcode = 'P0001';
  end if;
  if r.id is not null and p_expected_version is not null and r.version <> p_expected_version then
    raise exception 'CONFLICT: This add-on request was changed in the meantime. Close it and open it again.' using errcode = 'P0001';
  end if;
  t := private.price_items(p_items);
  if coalesce(p_submit, false) and (t ->> 'total')::numeric <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the agreed prices before submitting.' using errcode = 'P0001';
  end if;

  if r.id is null then
    insert into public.addon_requests (customer_id, department_id, consultant_id, created_by)
    values (p_customer, v.department_id, (select private.my_id()), (select private.my_id()))
    returning * into r;
    perform private.addon_event(r.id, 'CREATED');
  end if;

  delete from public.addon_request_items where request_id = r.id;
  for e in select * from jsonb_array_elements(t -> 'items') loop
    n := n + 1;
    insert into public.addon_request_items (request_id, service_code, name, quantity, unit_price, discount, tax_percent, tax, line_total, sort_order)
    values (r.id, e ->> 'serviceCode', e ->> 'name', (e ->> 'quantity')::integer, (e ->> 'unitPrice')::numeric, (e ->> 'discount')::numeric,
            (e ->> 'taxPercent')::numeric, (e ->> 'tax')::numeric, (e ->> 'lineTotal')::numeric, n);
  end loop;

  update public.addon_requests
     set subtotal = (t ->> 'subtotal')::numeric, discount_total = (t ->> 'discount')::numeric, tax_total = (t ->> 'tax')::numeric,
         total = (t ->> 'total')::numeric, notes = nullif(btrim(coalesce(p_notes, '')), ''), version = version + 1,
         consultant_id = coalesce(consultant_id, (select private.my_id())),
         status = case when coalesce(p_submit, false) then 'PENDING_VERIFICATION' else status end,
         submitted_at = case when coalesce(p_submit, false) then now() else submitted_at end,
         submitted_by = case when coalesce(p_submit, false) then (select private.my_id()) else submitted_by end
   where id = r.id returning * into r;
  update public.customer_onboarding set addons_required = true where customer_id = p_customer;

  if coalesce(p_submit, false) then
    perform private.addon_event(r.id, 'SUBMITTED');
    perform private.log_customer_activity(p_customer, 'ADDONS_SUBMITTED', format('Add-on services (%s) submitted to Accounts for verification', private.rupees(r.total)));
    perform private.write_audit('ADDON_REQUEST_SUBMITTED', 'addon_request', r.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', p_customer, 'total', r.total, 'version', r.version));
    perform private.notify_accounts_addon('ADDON_SUBMITTED', format('Add-on request: %s', coalesce(v.company, v.name)),
      format('%s services for %s are waiting for verification.', private.rupees(r.total), coalesce(v.company, v.name)), r.id);
    perform private.notify(v.owner_id, 'ADDON_SUBMITTED', format('Add-ons for %s', coalesce(v.company, v.name)),
      'The Technical Consultant sent add-on services to Accounts for verification.', 'customer', p_customer);
  else
    perform private.addon_event(r.id, 'SAVED');
    perform private.write_audit('ADDON_REQUEST_SAVED', 'addon_request', r.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', p_customer, 'total', r.total, 'version', r.version));
  end if;
  return private.addon_request_json(r) || jsonb_build_object('canEdit', r.status in ('DRAFT', 'CHANGES_REQUESTED'));
end $$;
revoke all on function public.consultant_save_addon_request(uuid, jsonb, text, boolean, integer) from public, anon;
grant execute on function public.consultant_save_addon_request(uuid, jsonb, text, boolean, integer) to authenticated;

-- Accounts: the Business Verification queue.
create or replace function public.accounts_addon_requests(
  p_status text default null, p_search text default null, p_consultant uuid default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_items jsonb; v_counts jsonb;
begin
  perform private.require_accounts_staff();
  if p_status is not null and p_status not in ('PENDING_VERIFICATION', 'CHANGES_REQUESTED', 'REJECTED', 'APPROVED', 'INVOICE_GENERATED',
                                                'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  select count(*) into v_total from public.addon_requests r join public.customers c on c.id = r.customer_id
   where r.status <> 'DRAFT' and (p_status is null or r.status = p_status) and (p_consultant is null or r.consultant_id = p_consultant)
     and (p_from is null or r.submitted_at::date >= p_from) and (p_to is null or r.submitted_at::date <= p_to)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(private.addon_request_json(x, false) order by x.submitted_at desc nulls last), '[]'::jsonb) into v_items from (
    select r.* from public.addon_requests r join public.customers c on c.id = r.customer_id
     where r.status <> 'DRAFT' and (p_status is null or r.status = p_status) and (p_consultant is null or r.consultant_id = p_consultant)
       and (p_from is null or r.submitted_at::date >= p_from) and (p_to is null or r.submitted_at::date <= p_to)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
     order by r.submitted_at desc nulls last limit v_size offset (v_page - 1) * v_size) x;
  select jsonb_object_agg(status, n) into v_counts from (select status, count(*) n from public.addon_requests where status <> 'DRAFT' group by status) s;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', coalesce(v_counts, '{}'::jsonb),
    'consultants', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', p.id, 'fullName', p.full_name)), '[]'::jsonb)
                      from public.addon_requests r join public.profiles p on p.id = r.consultant_id where r.status <> 'DRAFT'));
end $$;
revoke all on function public.accounts_addon_requests(text, text, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.accounts_addon_requests(text, text, uuid, date, date, integer, integer) to authenticated;

create or replace function public.accounts_addon_request(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.addon_requests;
begin
  perform private.require_accounts_staff();
  select * into r from public.addon_requests where id = p_request and status <> 'DRAFT';
  if r.id is null then
    raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
  end if;
  return private.addon_request_json(r);
end $$;
revoke all on function public.accounts_addon_request(uuid) from public, anon;
grant execute on function public.accounts_addon_request(uuid) to authenticated;

-- Accounts: approve, reject (reason) or request changes (reason). Payment is never confirmed here.
create or replace function public.accounts_decide_addon_request(p_request uuid, p_decision text, p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  v public.customers;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_label text;
begin
  perform private.require_accounts_staff();
  if p_decision is null or p_decision not in ('APPROVE', 'REJECT', 'CHANGES') then
    raise exception 'VALIDATION_ERROR: Choose approve, reject or request changes.' using errcode = 'P0001';
  end if;
  if p_decision in ('REJECT', 'CHANGES') and v_note is null then
    raise exception 'VALIDATION_ERROR: Give the reason, so the consultant knows what to do.' using errcode = 'P0001';
  end if;
  select * into r from public.addon_requests where id = p_request for update;
  if r.id is null or r.status = 'DRAFT' then
    raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'PENDING_VERIFICATION' then
    raise exception 'CONFLICT: This request was already decided (%).', lower(replace(r.status, '_', ' ')) using errcode = 'P0001';
  end if;
  if p_expected_version is not null and r.version <> p_expected_version then
    raise exception 'CONFLICT: The consultant changed this request in the meantime. Open it again.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = r.customer_id;
  update public.addon_requests
     set status = case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'CHANGES_REQUESTED' end,
         decided_at = now(), decided_by = (select private.my_id()), decision_note = v_note
   where id = r.id returning * into r;
  v_label := case p_decision when 'APPROVE' then 'approved' when 'REJECT' then 'rejected' else 'returned for changes' end;
  perform private.addon_event(r.id, case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'CHANGES_REQUESTED' end, v_note);
  perform private.log_customer_activity(r.customer_id, 'ADDONS_' || upper(replace(v_label, ' ', '_')), format('Add-on request %s by Accounts', v_label) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('ADDON_REQUEST_' || case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'CHANGES_REQUESTED' end,
    'addon_request', r.id, v.department_id, v.team_id, jsonb_build_object('customer_id', r.customer_id, 'note', v_note, 'total', r.total));
  perform private.notify_consultant(r, 'ADDON_' || case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'CHANGES_REQUESTED' end,
    format('Add-ons %s: %s', v_label, coalesce(v.company, v.name)),
    case p_decision when 'APPROVE' then 'Accounts approved the add-on services. The invoice comes next.'
                    else coalesce(v_note, '') end,
    case when p_decision = 'APPROVE' then 'normal' else 'urgent' end);
  return private.addon_request_json(r);
end $$;
revoke all on function public.accounts_decide_addon_request(uuid, text, text, integer) from public, anon;
grant execute on function public.accounts_decide_addon_request(uuid, text, text, integer) to authenticated;

-- Accounts: the invoice for an approved request (once).
create or replace function public.accounts_generate_addon_invoice(p_request uuid, p_issue_date date default null, p_due_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  v public.customers;
  inv public.member_invoices;
  v_issue date := coalesce(p_issue_date, current_date);
begin
  perform private.require_accounts_staff();
  select * into r from public.addon_requests where id = p_request for update;
  if r.id is null or r.status = 'DRAFT' then
    raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
  end if;
  if r.invoice_id is not null or exists (select 1 from public.member_invoices where addon_request_id = r.id) then
    raise exception 'CONFLICT: An invoice was already generated for this request.' using errcode = 'P0001';
  end if;
  if r.status <> 'APPROVED' then
    raise exception 'CONFLICT: Only an approved add-on request can be invoiced.' using errcode = 'P0001';
  end if;
  if p_due_date is not null and p_due_date < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the invoice date.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = r.customer_id;
  insert into public.member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, details,
                                      customer_id, kind, department_id, subtotal, discount_total, tax_total, issued_by, issued_at, addon_request_id)
  values ((select private.my_id()), private.next_invoice_number(), v.name, coalesce(v.company, ''), r.total, 'Pending',
          v_issue::text, coalesce(p_due_date::text, ''),
          jsonb_build_object('items', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                         'serviceCode', i.service_code, 'name', i.name, 'quantity', i.quantity, 'unitPrice', i.unit_price,
                                         'discount', i.discount, 'taxPercent', i.tax_percent, 'tax', i.tax, 'lineTotal', i.line_total)) order by i.sort_order), '[]'::jsonb)
                                       from public.addon_request_items i where i.request_id = r.id),
                             'note', 'Add-on services'),
          v.id, 'ADDON', v.department_id, r.subtotal, r.discount_total, r.tax_total, (select private.my_id()), now(), r.id)
  returning * into inv;
  update public.addon_requests set status = 'INVOICE_GENERATED', invoice_id = inv.id where id = r.id returning * into r;
  perform private.addon_event(r.id, 'INVOICE_GENERATED', inv.invoice_number);
  perform private.log_customer_activity(v.id, 'ADDON_INVOICE_ISSUED', format('Add-on invoice %s issued by Accounts (%s)', inv.invoice_number, private.rupees(inv.amount)));
  perform private.write_audit('INVOICE_ISSUED', 'invoice', inv.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', v.id, 'number', inv.invoice_number, 'total', inv.amount, 'kind', 'ADDON', 'addon_request_id', r.id));
  perform private.notify_consultant(r, 'ADDON_INVOICE_ISSUED', format('Add-on invoice: %s', coalesce(v.company, v.name)),
    format('Accounts issued invoice %s (%s). Wait for the payment confirmation before collecting documents.', inv.invoice_number, private.rupees(inv.amount)));
  perform private.notify(v.owner_id, 'ADDON_INVOICE_ISSUED', format('Add-on invoice: %s', coalesce(v.company, v.name)),
    format('Accounts issued invoice %s (%s) for the add-on services.', inv.invoice_number, private.rupees(inv.amount)), 'customer', v.id);
  return private.addon_request_json(r);
end $$;
revoke all on function public.accounts_generate_addon_invoice(uuid, date, date) from public, anon;
grant execute on function public.accounts_generate_addon_invoice(uuid, date, date) to authenticated;

-- Add-on payment: record (pending or verified at once), verify, reject.
create or replace function public.accounts_record_addon_payment(
  p_request uuid, p_amount numeric, p_method text, p_reference text default null, p_paid_at timestamptz default null,
  p_note text default null, p_verify boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  v_open numeric;
begin
  perform private.require_accounts_staff();
  select * into r from public.addon_requests where id = p_request for update;
  if r.id is null or r.status = 'DRAFT' then
    raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'INVOICE_GENERATED' then
    raise exception 'CONFLICT: Payments are recorded once the add-on invoice is generated and until the payment is confirmed.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'VALIDATION_ERROR: Enter the amount received (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose how the customer paid.' using errcode = 'P0001';
  end if;
  if p_paid_at is not null and p_paid_at > now() + interval '1 day' then
    raise exception 'VALIDATION_ERROR: The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  select r.total - coalesce(sum(amount), 0) into v_open from public.addon_payments where request_id = r.id and status in ('PENDING', 'VERIFIED');
  if p_amount > v_open then
    raise exception 'VALIDATION_ERROR: That is more than the % still open on this invoice.', private.rupees(v_open) using errcode = 'P0001';
  end if;
  begin
    insert into public.addon_payments (request_id, customer_id, amount, method, reference, paid_at, status, note, recorded_by, verified_by, verified_at)
    values (r.id, r.customer_id, p_amount, p_method, nullif(btrim(coalesce(p_reference, '')), ''), coalesce(p_paid_at, now()),
            case when coalesce(p_verify, false) then 'VERIFIED' else 'PENDING' end, left(nullif(btrim(coalesce(p_note, '')), ''), 1000),
            (select private.my_id()), case when coalesce(p_verify, false) then (select private.my_id()) end,
            case when coalesce(p_verify, false) then now() end);
  exception when unique_violation then
    raise exception 'CONFLICT: This payment reference is already recorded for this invoice.' using errcode = 'P0001';
  end;
  perform private.addon_event(r.id, case when coalesce(p_verify, false) then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end, private.rupees(p_amount));
  perform private.write_audit('ADDON_PAYMENT_RECORDED', 'addon_request', r.id, r.department_id, null,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'verified', coalesce(p_verify, false)));
  return private.addon_request_json(r);
end $$;
revoke all on function public.accounts_record_addon_payment(uuid, numeric, text, text, timestamptz, text, boolean) from public, anon;
grant execute on function public.accounts_record_addon_payment(uuid, numeric, text, text, timestamptz, text, boolean) to authenticated;

create or replace function public.accounts_decide_addon_payment(p_payment uuid, p_decision text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.addon_payments;
  r public.addon_requests;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  perform private.require_accounts_staff();
  if p_decision is null or p_decision not in ('VERIFY', 'REJECT') then
    raise exception 'VALIDATION_ERROR: Choose verify or reject.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECT' and v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting this payment.' using errcode = 'P0001';
  end if;
  select * into p from public.addon_payments where id = p_payment for update;
  if p.id is null then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  select * into r from public.addon_requests where id = p.request_id for update;
  if p.status <> 'PENDING' then
    raise exception 'CONFLICT: This payment was already %.', lower(p.status) using errcode = 'P0001';
  end if;
  if r.status <> 'INVOICE_GENERATED' then
    raise exception 'CONFLICT: The add-on payment was already confirmed.' using errcode = 'P0001';
  end if;
  update public.addon_payments
     set status = case when p_decision = 'VERIFY' then 'VERIFIED' else 'REJECTED' end,
         status_reason = v_reason, verified_by = (select private.my_id()), verified_at = now()
   where id = p.id;
  perform private.addon_event(r.id, case when p_decision = 'VERIFY' then 'PAYMENT_VERIFIED' else 'PAYMENT_REJECTED' end,
    private.rupees(p.amount) || coalesce(' · ' || v_reason, ''));
  perform private.write_audit(case when p_decision = 'VERIFY' then 'ADDON_PAYMENT_VERIFIED' else 'ADDON_PAYMENT_REJECTED' end,
    'addon_request', r.id, r.department_id, null, jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'reason', v_reason));
  return private.addon_request_json(r);
end $$;
revoke all on function public.accounts_decide_addon_payment(uuid, text, text) from public, anon;
grant execute on function public.accounts_decide_addon_payment(uuid, text, text) to authenticated;

-- Accounts confirms the add-on payment: the whole invoice verified, nothing pending.
create or replace function public.accounts_confirm_addon_payment(p_request uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  v public.customers;
  v_paid numeric;
begin
  perform private.require_accounts_staff();
  select * into r from public.addon_requests where id = p_request for update;
  if r.id is null or r.status = 'DRAFT' then
    raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'INVOICE_GENERATED' then
    raise exception 'CONFLICT: %', case when r.status in ('PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') then 'The add-on payment is already confirmed.'
                                        else 'Generate the add-on invoice first.' end using errcode = 'P0001';
  end if;
  if exists (select 1 from public.addon_payments where request_id = r.id and status = 'PENDING') then
    raise exception 'CONFLICT: Verify or reject the pending payments first.' using errcode = 'P0001';
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.addon_payments where request_id = r.id and status = 'VERIFIED';
  if v_paid < r.total then
    raise exception 'CONFLICT: % of % is verified. The add-on payment can be confirmed once the full invoice is paid.',
      private.rupees(v_paid), private.rupees(r.total) using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = r.customer_id;
  update public.addon_requests set status = 'PAYMENT_CONFIRMED', payment_confirmed_at = now(), payment_confirmed_by = (select private.my_id())
   where id = r.id returning * into r;
  update public.member_invoices set status = 'Paid', paid_at = now() where id = r.invoice_id;
  perform private.addon_event(r.id, 'PAYMENT_CONFIRMED', left(nullif(btrim(coalesce(p_note, '')), ''), 1000));
  perform private.log_customer_activity(v.id, 'ADDON_PAYMENT_CONFIRMED', format('Add-on payment of %s confirmed by Accounts', private.rupees(v_paid)));
  perform private.write_audit('ADDON_PAYMENT_CONFIRMED', 'addon_request', r.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', v.id, 'paid', v_paid, 'invoice_id', r.invoice_id));
  perform private.notify_consultant(r, 'ADDON_PAYMENT_CONFIRMED', format('Add-on payment confirmed: %s', coalesce(v.company, v.name)),
    'Accounts confirmed the payment. You can start collecting the documents for the add-on services.');
  perform private.notify(v.owner_id, 'ADDON_PAYMENT_CONFIRMED', format('Add-on payment confirmed: %s', coalesce(v.company, v.name)),
    format('%s received for the add-on services.', private.rupees(v_paid)), 'customer', v.id);
  return private.addon_request_json(r);
end $$;
revoke all on function public.accounts_confirm_addon_payment(uuid, text) from public, anon;
grant execute on function public.accounts_confirm_addon_payment(uuid, text) to authenticated;

-- Technical Consultant: start the add-on documents (after payment), and finish the add-ons.
create or replace function public.consultant_start_addon_documents(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  v public.customers;
begin
  if not private.can_manage_addons(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into r from public.addon_requests where customer_id = p_customer and status not in ('REJECTED', 'COMPLETED') for update;
  if r.id is null then
    raise exception 'NOT_FOUND: No add-on request for this customer.' using errcode = 'P0001';
  end if;
  if r.status <> 'PAYMENT_CONFIRMED' then
    raise exception 'CONFLICT: %', case when r.status = 'IN_PROGRESS' then 'Document collection has already started.'
                                        else 'Documents for add-on services are collected after Accounts confirms the add-on payment.' end using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  update public.addon_requests set status = 'IN_PROGRESS', started_at = now() where id = r.id returning * into r;
  perform private.addon_event(r.id, 'DOCUMENTS_STARTED');
  perform private.log_customer_activity(p_customer, 'ADDON_DOCUMENTS_STARTED', 'Technical onboarding resumed for the add-on services');
  perform private.notify(v.owner_id, 'ADDON_DOCUMENTS_STARTED', format('Add-on onboarding started: %s', coalesce(v.company, v.name)),
    'The Technical Consultant started collecting the add-on documents.', 'customer', p_customer);
  return private.addon_request_json(r) || jsonb_build_object('canEdit', false);
end $$;
revoke all on function public.consultant_start_addon_documents(uuid) from public, anon;
grant execute on function public.consultant_start_addon_documents(uuid) to authenticated;

create or replace function public.consultant_complete_addons(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  o public.customer_onboarding;
  v public.customers;
begin
  if not private.can_manage_addons(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into r from public.addon_requests where customer_id = p_customer and status not in ('REJECTED', 'COMPLETED') for update;
  if r.id is null or r.status <> 'IN_PROGRESS' then
    raise exception 'CONFLICT: Start the add-on document collection first.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.addon_items_total > 0 and o.addon_items_verified < o.addon_items_total then
    raise exception 'CONFLICT: Verify every add-on document first (% of % verified).', o.addon_items_verified, o.addon_items_total using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  update public.addon_requests set status = 'COMPLETED', completed_at = now() where id = r.id returning * into r;
  perform private.addon_event(r.id, 'COMPLETED');
  perform private.log_customer_activity(p_customer, 'ADDONS_COMPLETED', 'Technical onboarding of the add-on services completed');
  perform private.notify(v.owner_id, 'ADDONS_COMPLETED', format('Add-ons completed: %s', coalesce(v.company, v.name)),
    'The Technical Consultant finished the onboarding of the add-on services.', 'customer', p_customer);
  return private.addon_request_json(r) || jsonb_build_object('canEdit', false);
end $$;
revoke all on function public.consultant_complete_addons(uuid) from public, anon;
grant execute on function public.consultant_complete_addons(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Add-on documents only for paid add-on services
-- ---------------------------------------------------------------------------
create or replace function private.customer_addon_codes(p_customer uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct i.service_code), '{}'::text[])
    from public.addon_requests r join public.addon_request_items i on i.request_id = r.id
   where r.customer_id = p_customer and r.status in ('PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED') and i.service_code is not null
$$;
revoke all on function private.customer_addon_codes(uuid) from public, anon, authenticated;

create or replace function private.can_collect_addon_item(p_customer uuid, p_item text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_manage_addons(p_customer)
     and exists (select 1 from public.addon_requests r where r.customer_id = p_customer and r.status in ('PAYMENT_CONFIRMED', 'IN_PROGRESS'))
     and exists (select 1 from private.customer_addon_items(p_customer) i where i.code = p_item)
$$;
revoke all on function private.can_collect_addon_item(uuid, text) from public, anon;
grant execute on function private.can_collect_addon_item(uuid, text) to authenticated;

-- The old one-step "Send to Add-ons" is replaced by the verified request.
drop function if exists public.consultant_send_to_addons(uuid);
-- The unpriced add-on picker is replaced by priced add-on requests (the old selections are kept on
-- customer_onboarding.addons and were turned into draft requests below).
drop function if exists public.consultant_set_addons(uuid, jsonb);
drop trigger if exists customer_onboarding_addons_progress on public.customer_onboarding;

-- Original onboarding is never blocked by add-ons.
create or replace function public.consultant_start_onboarding(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.consultant_started_at is not null then
    raise exception 'CONFLICT: This customer is already in onboarding.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding
     set consultant_started_at = now(), consultant_started_by = (select private.my_id())
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ONBOARDING_STARTED_BY_CONSULTANT', 'Sent for onboarding by the Technical Consultant');
  perform private.write_audit('CONSULTANT_ONBOARDING_STARTED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('contract_signed', o.contract_signed, 'addon_request_status', o.addon_request_status));
  perform private.notify(v.owner_id, 'ONBOARDING_STARTED', format('Onboarding started: %s', coalesce(v.company, v.name)),
    'The Technical Consultant started onboarding. They will verify the documents next.', 'customer', p_customer);
end $$;
revoke all on function public.consultant_start_onboarding(uuid) from public, anon;
grant execute on function public.consultant_start_onboarding(uuid) to authenticated;

-- Yes / No stays the consultant's answer; No is refused while a request is with Accounts or paid.
create or replace function public.consultant_set_addons_required(p_customer uuid, p_required boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.can_review_onboarding(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_required is null then
    raise exception 'VALIDATION_ERROR: Choose Yes or No.' using errcode = 'P0001';
  end if;
  if not p_required and exists (select 1 from public.addon_requests where customer_id = p_customer
                                   and status not in ('DRAFT', 'CHANGES_REQUESTED', 'REJECTED', 'COMPLETED')) then
    raise exception 'CONFLICT: An add-on request is with Accounts or already paid, so the answer cannot change to No.' using errcode = 'P0001';
  end if;
  update public.customer_onboarding set addons_required = p_required where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'ADDONS_REQUIRED_UPDATED',
    case when p_required then 'Customer needs add-on services' else 'Customer does not need add-on services' end);
end $$;
revoke all on function public.consultant_set_addons_required(uuid, boolean) from public, anon;
grant execute on function public.consultant_set_addons_required(uuid, boolean) to authenticated;

create or replace function public.onboarding_review_counts()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'all', count(*) filter (where o.consultant_started_at is not null),
    'TO_REVIEW', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'TO_REVIEW'),
    'NEEDS_FIX', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'NEEDS_FIX'),
    'VERIFIED', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'VERIFIED'),
    'AWAITING_DOCUMENTS', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'AWAITING_DOCUMENTS'),
    'WAITING_ON_SALES', count(*) filter (where o.consultant_started_at is not null and o.review_state = 'WAITING_ON_SALES'),
    'newCustomers', count(*) filter (where o.consultant_started_at is null),
    'addons', count(*) filter (where o.addon_request_status is not null and o.addon_request_status not in ('REJECTED', 'COMPLETED')))
  from public.customers c
  join public.customer_onboarding o on o.customer_id = c.id
  where c.lifecycle_stage = 'ONBOARDING' and private.can_view_onboarding_review(c.id)
$$;
revoke all on function public.onboarding_review_counts() from public, anon;
grant execute on function public.onboarding_review_counts() to authenticated;

-- Selections made before prices were required become a draft request (prices 0, nothing approved or paid).
insert into public.addon_requests (customer_id, department_id, consultant_id, status, notes, created_by)
select o.customer_id, c.department_id, o.addons_submitted_by, 'DRAFT',
       'Created from the add-ons selected before prices were required. Enter the agreed prices and submit them to Accounts.', o.addons_submitted_by
  from public.customer_onboarding o join public.customers c on c.id = o.customer_id
 where jsonb_array_length(o.addons) > 0 and (o.addons_required or o.addons_submitted_at is not null)
   and not exists (select 1 from public.addon_requests r where r.customer_id = o.customer_id);
insert into public.addon_request_items (request_id, service_code, name, quantity, unit_price, discount, tax_percent, tax, line_total, sort_order)
select r.id, nullif(a.value ->> 'code', ''), left(a.value ->> 'name', 120), 1, 0, 0, 0, 0, 0, a.ordinality
  from public.addon_requests r
  join public.customer_onboarding o on o.customer_id = r.customer_id
  cross join lateral jsonb_array_elements(o.addons) with ordinality a
 where r.status = 'DRAFT' and not exists (select 1 from public.addon_request_items i where i.request_id = r.id)
   and length(coalesce(a.value ->> 'name', '')) >= 2;
update public.customer_onboarding o
   set addon_request_status = (select r.status from public.addon_requests r where r.customer_id = o.customer_id
                                order by (r.status not in ('REJECTED', 'COMPLETED')) desc, r.created_at desc limit 1)
 where exists (select 1 from public.addon_requests r where r.customer_id = o.customer_id);
do $$
declare
  v uuid;
begin
  for v in select customer_id from public.customer_onboarding loop
    perform private.refresh_addon_progress(v);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Finance: income = verified payments of the original services and of add-ons
-- ---------------------------------------------------------------------------
create or replace function private.verified_income()
returns table (id uuid, customer_id uuid, amount numeric, paid_at timestamptz, payment_type text, method text, reference text,
               verified_by uuid, recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, p.amount, p.paid_at, p.payment_type, p.method, p.reference, p.verified_by, p.recorded_at
    from public.customer_payments p where p.status = 'VERIFIED'
  union all
  select a.id, a.customer_id, a.amount, a.paid_at, 'ADDON', a.method, a.reference, a.verified_by, a.recorded_at
    from public.addon_payments a where a.status = 'VERIFIED'
$$;
revoke all on function private.verified_income() from public, anon, authenticated;

create or replace function public.accounts_finance_summary(
  p_department uuid default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_income numeric; v_income_n bigint;
  v_exp numeric; v_exp_paid numeric; v_exp_pending numeric; v_exp_n bigint;
begin
  perform private.require_accounts_staff();
  select coalesce(sum(p.amount), 0), count(*) into v_income, v_income_n
    from private.verified_income() p join public.customers c on c.id = p.customer_id
   where (p_department is null or c.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to);
  select coalesce(sum(e.amount), 0), coalesce(sum(e.amount) filter (where e.payment_status = 'PAID'), 0),
         coalesce(sum(e.amount) filter (where e.payment_status = 'PENDING'), 0), count(*)
    into v_exp, v_exp_paid, v_exp_pending, v_exp_n
    from public.department_expenses e
   where (p_department is null or e.department_id = p_department)
     and (p_from is null or e.expense_date >= p_from) and (p_to is null or e.expense_date <= p_to);
  return jsonb_build_object('income', v_income, 'incomeCount', v_income_n, 'expenses', v_exp, 'expensesPaid', v_exp_paid,
    'expensesPending', v_exp_pending, 'expenseCount', v_exp_n, 'net', v_income - v_exp);
end $$;
revoke all on function public.accounts_finance_summary(uuid, date, date) from public, anon;
grant execute on function public.accounts_finance_summary(uuid, date, date) to authenticated;

create or replace function public.accounts_income_list(
  p_search text default null, p_department uuid default null, p_from date default null, p_to date default null,
  p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_sum numeric; v_items jsonb;
begin
  perform private.require_accounts_staff();
  select count(*), coalesce(sum(p.amount), 0) into v_total, v_sum
    from private.verified_income() p join public.customers c on c.id = p.customer_id
   where (p_department is null or c.department_id = p_department)
     and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
          or lower(coalesce(p.reference, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by paid_at desc), '[]'::jsonb) into v_items from (
    select p.paid_at, jsonb_build_object(
      'id', p.id, 'paidAt', p.paid_at, 'amount', p.amount, 'type', p.payment_type, 'method', p.method, 'reference', p.reference,
      'customerId', c.id, 'customerCode', c.customer_code, 'customer', coalesce(c.company, c.name), 'contact', c.name,
      'departmentId', c.department_id, 'department', d.name,
      'verifiedBy', (select full_name from public.profiles where id = p.verified_by)) as j
      from private.verified_income() p join public.customers c on c.id = p.customer_id
      left join public.departments d on d.id = c.department_id
     where (p_department is null or c.department_id = p_department)
       and (p_from is null or p.paid_at::date >= p_from) and (p_to is null or p.paid_at::date <= p_to)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%'
            or lower(coalesce(p.reference, '')) like '%' || v_term || '%')
     order by p.paid_at desc, p.recorded_at desc
     limit v_size offset (v_page - 1) * v_size) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'sum', v_sum, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_income_list(text, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.accounts_income_list(text, uuid, date, date, integer, integer) to authenticated;

create or replace function public.accounts_finance_trend(p_months integer default 12)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_n integer := least(greatest(coalesce(p_months, 12), 1), 36);
  v_start date := (date_trunc('month', current_date) - ((v_n - 1) || ' months')::interval)::date;
  v_months jsonb; v_categories jsonb;
begin
  perform private.require_accounts_staff();
  select coalesce(jsonb_agg(jsonb_build_object('month', m.month, 'income', coalesce(i.amount, 0), 'expenses', coalesce(x.amount, 0),
                                                'net', coalesce(i.amount, 0) - coalesce(x.amount, 0)) order by m.month), '[]'::jsonb)
    into v_months
    from generate_series(v_start::timestamp, date_trunc('month', current_date)::timestamp, interval '1 month') as m(month)
    left join (select date_trunc('month', paid_at)::date as month, sum(amount) as amount from private.verified_income() group by 1) i on i.month = m.month::date
    left join (select date_trunc('month', expense_date)::date as month, sum(amount) as amount from public.department_expenses group by 1) x on x.month = m.month::date;
  select coalesce(jsonb_agg(jsonb_build_object('category', category, 'amount', amount) order by amount desc), '[]'::jsonb) into v_categories
    from (select category, sum(amount) as amount from public.department_expenses group by category order by sum(amount) desc limit 8) t;
  return jsonb_build_object('months', v_months, 'expenseCategories', v_categories,
    'firstRecordAt', (select least((select min(paid_at) from private.verified_income()), (select min(expense_date)::timestamptz from public.department_expenses))));
end $$;
revoke all on function public.accounts_finance_trend(integer) from public, anon;
grant execute on function public.accounts_finance_trend(integer) to authenticated;

create or replace function public.accounts_finance_by_department()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    left join (select c.department_id, sum(p.amount) amount, count(*) n
                 from private.verified_income() p join public.customers c on c.id = p.customer_id
                group by c.department_id) i on i.department_id = d.id
    left join (select e.department_id, sum(e.amount) amount, count(*) n,
                      sum(e.amount) filter (where e.payment_status = 'PENDING') pending
                 from public.department_expenses e
                where e.department_id is not null
                group by e.department_id) x on x.department_id = d.id
   where d.generates_revenue;
  return v;
end $$;
revoke all on function public.accounts_finance_by_department() from public, anon;
grant execute on function public.accounts_finance_by_department() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Reading invoices (Sales, Technical Consultant, Support, heads): read-only
-- ---------------------------------------------------------------------------
create or replace function private.can_read_invoice(i public.member_invoices)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff()
      or i.owner_id = (select private.my_id())
      or (i.customer_id is not null and (private.can_view_customer(i.customer_id) or private.can_view_onboarding_review(i.customer_id)))
$$;
revoke all on function private.can_read_invoice(public.member_invoices) from public, anon, authenticated;

-- One customer's invoices.
create or replace function public.customer_invoices(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_view_addons(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.invoice_json(i) order by i.created_at desc)
                     from public.member_invoices i where i.customer_id = p_customer and private.can_read_invoice(i)), '[]'::jsonb);
end $$;
revoke all on function public.customer_invoices(uuid) from public, anon;
grant execute on function public.customer_invoices(uuid) to authenticated;

-- Every invoice the caller may see (their customers'), newest first.
create or replace function public.visible_invoices(
  p_search text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total bigint; v_items jsonb; v_sum numeric; v_paid numeric;
begin
  if (select private.my_id()) is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select count(*), coalesce(sum(i.amount), 0), coalesce(sum(i.amount) filter (where i.status = 'Paid'), 0) into v_total, v_sum, v_paid
    from public.member_invoices i
   where private.can_read_invoice(i) and (p_status is null or i.status = p_status)
     and (v_term is null or lower(i.invoice_number) like '%' || v_term || '%' or lower(i.customer_name) like '%' || v_term || '%'
          or lower(coalesce(i.company, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(private.invoice_json(x) order by x.created_at desc), '[]'::jsonb) into v_items from (
    select i.* from public.member_invoices i
     where private.can_read_invoice(i) and (p_status is null or i.status = p_status)
       and (v_term is null or lower(i.invoice_number) like '%' || v_term || '%' or lower(i.customer_name) like '%' || v_term || '%'
            or lower(coalesce(i.company, '')) like '%' || v_term || '%')
     order by i.created_at desc limit v_size offset (v_page - 1) * v_size) x;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'sum', v_sum, 'paid', v_paid);
end $$;
revoke all on function public.visible_invoices(text, text, integer, integer) from public, anon;
grant execute on function public.visible_invoices(text, text, integer, integer) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261015000200_invoice_pdf_uploads.sql

-- =============================================================================
-- Upload existing invoice PDFs (Accounts), visible to every employee who may see the customer.
--
--  * Reuses the existing pieces: member_invoices (the invoice record, new kind UPLOADED),
--    customer_documents (versioned file metadata, document type INVOICE), the private
--    customer-documents bucket, signed single-path uploads, and the audited signed-URL
--    download. No new storage system, no duplicate customer / invoice / payment records.
--  * 500 KB per PDF: document_types.max_size_bytes (checked when the upload starts and
--    again when it completes) and the storage bucket's own file_size_limit.
--  * Only Accounts staff upload or replace. Replacing keeps the old file as a SUPERSEDED version.
--  * Read access follows the customer: Accounts, the owner, team / department heads, the
--    Technical Consultant of the customer, support staff of a post-sale customer, Super Admin.
--  * An invoice record exists only once its file was stored, so a failed upload leaves nothing behind.
-- Additive and re-runnable. Existing invoices, files and onboarding progress are untouched.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. 500 KB, and the data model
-- ---------------------------------------------------------------------------
update public.document_types set max_size_bytes = 512000 where code = 'INVOICE';
update storage.buckets set file_size_limit = 512000 where id = 'customer-documents';

alter table public.member_invoices drop constraint if exists member_invoices_kind_check;
alter table public.member_invoices add constraint member_invoices_kind_check check (kind in ('MANUAL', 'SERVICE', 'ADDON', 'UPLOADED'));
-- The total of an uploaded invoice is optional (Accounts may only have the PDF at hand).
alter table public.member_invoices alter column amount drop not null;

alter table public.customer_documents
  add column if not exists invoice_id uuid references public.member_invoices (id) on delete restrict,
  add column if not exists invoice_meta jsonb check (pg_column_size(invoice_meta) <= 4096);
do $$
begin
  alter table public.customer_documents add constraint customer_documents_invoice_only
    check ((invoice_id is null and invoice_meta is null) or document_type = 'INVOICE');
exception when duplicate_object then null;
end $$;

-- One current file per (customer, type) as before, except for uploaded invoices: those are
-- one current file per invoice, so a customer can have several invoices.
drop index if exists public.customer_documents_one_current_key;
create unique index customer_documents_one_current_key
  on public.customer_documents (customer_id, document_type) where status = 'UPLOADED' and invoice_id is null;
create unique index if not exists customer_documents_one_current_invoice_key
  on public.customer_documents (invoice_id) where status = 'UPLOADED' and invoice_id is not null;
create index if not exists customer_documents_invoice_idx on public.customer_documents (invoice_id, uploaded_at desc) where invoice_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Who may do what
-- ---------------------------------------------------------------------------
-- Everyone who may see the customer may read its invoice files (not only the owner).
create or replace function private.can_read_invoice_doc(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff()
      or private.can_access_customer(p_customer)
      or private.can_view_customer(p_customer)
      or private.can_view_onboarding_review(p_customer)
$$;
revoke all on function private.can_read_invoice_doc(uuid) from public, anon;
grant execute on function private.can_read_invoice_doc(uuid) to authenticated;

-- The general document policy lets whoever sees a customer list its files. For uploaded invoices only
-- the current file is listed to them: earlier versions and unfinished uploads are for Accounts.
drop policy if exists customer_documents_select on public.customer_documents;
create policy customer_documents_select on public.customer_documents for select to authenticated
  using (status <> 'DELETED' and exists (select 1 from public.customers c where c.id = customer_id)
         and (not (document_type = 'INVOICE' and (invoice_id is not null or invoice_meta is not null))
              or status = 'UPLOADED' or (select private.is_accounts_staff())));

-- Uploading and replacing: Accounts staff only (accounts_can_invoice already requires that).
drop policy if exists customer_documents_select_invoice on public.customer_documents;
create policy customer_documents_select_invoice on public.customer_documents for select to authenticated
  using (document_type = 'INVOICE' and status in ('PENDING', 'UPLOADED', 'SUPERSEDED')
         and ((select private.is_accounts_staff())
              or (status = 'UPLOADED' and private.can_read_invoice_doc(customer_id))));

-- ---------------------------------------------------------------------------
-- 3. The invoice as every view sees it: now with its current PDF
-- ---------------------------------------------------------------------------
create or replace function private.invoice_file_json(p_invoice uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with docs as (
    select d.*, row_number() over (order by d.uploaded_at, d.version) as nth
      from public.customer_documents d
     where d.invoice_id = p_invoice and d.status in ('UPLOADED', 'SUPERSEDED')),
  cur as (select * from docs where status = 'UPLOADED')
  select (select jsonb_build_object(
            'documentId', c.id, 'fileName', c.original_file_name, 'sizeBytes', c.size_bytes, 'mimeType', c.mime_type,
            'uploadedAt', c.uploaded_at, 'uploadedBy', (select full_name from public.profiles where id = c.uploaded_by),
            'version', c.nth, 'versionCount', (select count(*) from docs),
            -- earlier versions are for Accounts only
            'versions', case when private.is_accounts_staff() then
              coalesce((select jsonb_agg(jsonb_build_object(
                'documentId', o.id, 'fileName', o.original_file_name, 'sizeBytes', o.size_bytes, 'uploadedAt', o.uploaded_at,
                'uploadedBy', (select full_name from public.profiles where id = o.uploaded_by), 'version', o.nth) order by o.nth desc)
                from docs o where o.status = 'SUPERSEDED'), '[]'::jsonb)
              else '[]'::jsonb end)
          from cur c)
$$;
revoke all on function private.invoice_file_json(uuid) from public, anon, authenticated;

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
    'addonRequestId', i.addon_request_id,
    'issuedBy', (select full_name from public.profiles where id = coalesce(i.issued_by, i.owner_id)),
    'issuedAt', coalesce(i.issued_at, i.created_at), 'createdAt', i.created_at)
$$;
revoke all on function private.invoice_json(public.member_invoices) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Validation shared by "new invoice" and "replace"
-- ---------------------------------------------------------------------------
create or replace function private.check_invoice_pdf(p_mime text, p_size bigint)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  t public.document_types;
begin
  select * into t from public.document_types where code = 'INVOICE';
  if p_mime is distinct from 'application/pdf' then
    raise exception 'VALIDATION_ERROR: Only PDF files are accepted for invoices.' using errcode = 'P0001';
  end if;
  if coalesce(p_size, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: This file is empty.' using errcode = 'P0001';
  end if;
  if p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File size exceeds the % KB limit. Please upload a smaller PDF.', t.max_size_bytes / 1024 using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_invoice_pdf(text, bigint) from public, anon, authenticated;

create or replace function private.invoice_pending_doc(p_customer uuid, p_invoice uuid, p_meta jsonb, p_file_name text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := gen_random_uuid();
  d public.customer_documents;
begin
  insert into public.customer_documents (id, customer_id, document_type, version, status, storage_path,
                                         original_file_name, mime_type, size_bytes, uploaded_by, invoice_id, invoice_meta)
  values (v_id, p_customer, 'INVOICE', null, 'PENDING',
          format('customers/%s/invoices/%s.pdf', p_customer, v_id),
          left(regexp_replace(coalesce(nullif(btrim(p_file_name), ''), 'invoice.pdf'), '[\r\n\t/\\]', '_', 'g'), 255),
          'application/pdf', p_size, (select private.my_id()), p_invoice, p_meta)
  returning * into d;
  return d;
end $$;
revoke all on function private.invoice_pending_doc(uuid, uuid, jsonb, text, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Start an upload: a new invoice for a customer, or a replacement PDF for an invoice
--    (the browser then uploads to the single signed path; the API checks the stored file;
--     complete_document_upload creates / updates the invoice record).
-- ---------------------------------------------------------------------------
create or replace function public.begin_invoice_upload(
  p_customer uuid, p_invoice_number text, p_issue_date text, p_due_date text, p_amount numeric,
  p_reference text, p_note text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  v_no text := btrim(coalesce(p_invoice_number, ''));
  v_issue date; v_due date;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_no = '' then
    raise exception 'VALIDATION_ERROR: Enter the invoice number.' using errcode = 'P0001';
  end if;
  if v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./#_-]{0,59}$' then
    raise exception 'VALIDATION_ERROR: The invoice number can use letters, numbers, spaces and - / . # _ (up to 60 characters).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.member_invoices i where lower(i.invoice_number) = lower(v_no) and i.kind <> 'MANUAL') then
    raise exception 'CONFLICT: An invoice numbered % already exists.', v_no using errcode = 'P0001';
  end if;
  begin
    v_issue := nullif(btrim(coalesce(p_issue_date, '')), '')::date;
    v_due := nullif(btrim(coalesce(p_due_date, '')), '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter valid dates.' using errcode = 'P0001';
  end;
  if v_due is not null and v_issue is not null and v_due < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the issue date.' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or round(p_amount, 2) <> p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the invoice total in rupees (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reference, '')) > 120 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: The reference or note is too long.' using errcode = 'P0001';
  end if;
  perform private.check_invoice_pdf(p_mime, p_size);
  return private.invoice_pending_doc(p_customer, null,
    jsonb_strip_nulls(jsonb_build_object('number', v_no, 'issueDate', v_issue::text, 'dueDate', v_due::text, 'amount', p_amount,
                                         'reference', nullif(btrim(coalesce(p_reference, '')), ''), 'note', nullif(btrim(coalesce(p_note, '')), ''))),
    p_file_name, p_size);
end $$;
revoke all on function public.begin_invoice_upload(uuid, text, text, text, numeric, text, text, text, text, bigint) from public, anon;
grant execute on function public.begin_invoice_upload(uuid, text, text, text, numeric, text, text, text, text, bigint) to authenticated;

create or replace function public.begin_invoice_replacement(p_invoice uuid, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null or inv.customer_id is null or not private.accounts_can_invoice(inv.customer_id) then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind <> 'UPLOADED' then
    raise exception 'CONFLICT: Only an uploaded invoice PDF can be replaced here.' using errcode = 'P0001';
  end if;
  perform private.check_invoice_pdf(p_mime, p_size);
  return private.invoice_pending_doc(inv.customer_id, inv.id, null, p_file_name, p_size);
end $$;
revoke all on function public.begin_invoice_replacement(uuid, text, text, bigint) from public, anon;
grant execute on function public.begin_invoice_replacement(uuid, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Finish / fail / open: the existing document functions, now aware of invoice files
-- ---------------------------------------------------------------------------
create or replace function public.complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  t public.document_types;
  v_replaced public.customer_documents;
  v_inv boolean;
  m jsonb;
  inv public.member_invoices;
begin
  select * into d from public.customer_documents where id = p_document for update;
  v_inv := d.id is not null and d.document_type = 'INVOICE' and (d.invoice_id is not null or d.invoice_meta is not null);
  if d.id is null or not (case when v_inv then private.accounts_can_invoice(d.customer_id)
                               else private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type) end) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File size exceeds the % KB limit. Please upload a smaller PDF.', t.max_size_bytes / 1024 using errcode = 'P0001';
  end if;
  if v_inv then
    select * into v from public.customers where id = d.customer_id for update;
  else
    v := private.lock_collect_customer(d.customer_id, d.document_type);
  end if;

  -- A new uploaded invoice gets its record only now that the file is safely stored.
  if v_inv and d.invoice_id is null then
    m := d.invoice_meta;
    begin
      insert into public.member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, details,
                                          customer_id, kind, department_id, issued_by, issued_at)
      values ((select private.my_id()), m ->> 'number', v.name, coalesce(v.company, ''), nullif(m ->> 'amount', '')::numeric, 'Pending',
              coalesce(m ->> 'issueDate', ''), coalesce(m ->> 'dueDate', ''),
              jsonb_strip_nulls(jsonb_build_object('note', m ->> 'note', 'reference', m ->> 'reference')),
              v.id, 'UPLOADED', v.department_id, (select private.my_id()), now())
      returning * into inv;
    exception when unique_violation then
      raise exception 'CONFLICT: An invoice numbered % already exists.', m ->> 'number' using errcode = 'P0001';
    end;
    update public.customer_documents set invoice_id = inv.id, invoice_meta = null where id = d.id returning * into d;
  elsif v_inv then
    select * into inv from public.member_invoices where id = d.invoice_id for update;
  end if;

  -- Only the file this one replaces: the same invoice, or (other documents) the same customer and type.
  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = d.customer_id and document_type = d.document_type and status = 'UPLOADED'
     and invoice_id is not distinct from d.invoice_id and id <> d.id
  returning * into v_replaced;

  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = d.customer_id and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  if v_inv then
    perform private.write_audit(case when v_replaced.id is null then 'INVOICE_UPLOADED' else 'INVOICE_REPLACED' end,
      'invoice', inv.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', d.customer_id, 'number', inv.invoice_number, 'document_id', d.id, 'file_name', d.original_file_name,
                         'size_bytes', p_size, 'replaced_document_id', v_replaced.id));
    perform private.log_customer_activity(d.customer_id, 'INVOICE_UPLOADED',
      format('Invoice %s PDF %s by Accounts', inv.invoice_number, case when v_replaced.id is null then 'uploaded' else 'replaced' end));
    perform private.notify(v.owner_id, 'INVOICE_UPLOADED', format('Invoice for %s', coalesce(v.company, v.name)),
      format('Accounts %s the PDF of invoice %s.', case when v_replaced.id is null then 'uploaded' else 'replaced' end, inv.invoice_number), 'customer', v.id);
  else
    perform private.write_audit(case when v_replaced.id is null then 'DOCUMENT_UPLOADED' else 'DOCUMENT_REPLACED' end,
      'customer_document', d.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version,
                         'replaced_document_id', v_replaced.id, 'size_bytes', p_size));
    perform private.log_customer_activity(d.customer_id, 'DOCUMENT_UPLOADED',
      format('%s %s (v%s)', t.label, case when v_replaced.id is null then 'uploaded' else 'replaced' end, d.version));
  end if;
  perform private.refresh_onboarding_progress(d.customer_id);
  return d;
end $$;
revoke all on function public.complete_document_upload(uuid, bigint) from public, anon;
grant execute on function public.complete_document_upload(uuid, bigint) to authenticated;

create or replace function public.fail_document_upload(p_document uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v_inv boolean;
begin
  select * into d from public.customer_documents where id = p_document for update;
  v_inv := d.id is not null and d.document_type = 'INVOICE' and (d.invoice_id is not null or d.invoice_meta is not null);
  if d.id is null or not (case when v_inv then private.accounts_can_invoice(d.customer_id)
                               else private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type) end) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  update public.customer_documents set status = 'FAILED', invoice_meta = null where id = p_document;
  return d.storage_path;
end $$;
revoke all on function public.fail_document_upload(uuid) from public, anon;
grant execute on function public.fail_document_upload(uuid) to authenticated;

-- Viewing / downloading: the person must be allowed to see the customer. Earlier versions of an
-- uploaded invoice are for Accounts only.
create or replace function public.authorize_document_access(p_document uuid, p_action text)
returns table (storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  v_ok boolean;
begin
  select * into d from public.customer_documents where id = p_document;
  if d.id is null or d.status not in ('UPLOADED', 'SUPERSEDED') then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.document_type = 'INVOICE' then
    v_ok := private.is_accounts_staff()
         or (d.status = 'UPLOADED' and private.can_read_invoice_doc(d.customer_id))
         -- files Sales uploaded before invoices moved to Accounts keep their old access
         or (d.invoice_id is null and private.can_access_customer(d.customer_id));
  else
    v_ok := private.can_access_customer(d.customer_id) or private.can_view_onboarding_review(d.customer_id);
  end if;
  if not v_ok then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = d.customer_id;
  perform private.write_audit(case when p_action = 'DOWNLOAD' then 'DOCUMENT_DOWNLOADED' else 'DOCUMENT_VIEWED' end,
    'customer_document', d.id, v.department_id, v.team_id,
    jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version, 'invoice_id', d.invoice_id));
  return query select d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;
revoke all on function public.authorize_document_access(uuid, text) from public, anon;
grant execute on function public.authorize_document_access(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Accounts can correct the details of an uploaded invoice (total, dates, reference, note)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_update_uploaded_invoice(
  p_invoice uuid, p_issue_date text, p_due_date text, p_amount numeric, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  v_issue date; v_due date;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind <> 'UPLOADED' then
    raise exception 'CONFLICT: Only an uploaded invoice can be edited here.' using errcode = 'P0001';
  end if;
  begin
    v_issue := nullif(btrim(coalesce(p_issue_date, '')), '')::date;
    v_due := nullif(btrim(coalesce(p_due_date, '')), '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter valid dates.' using errcode = 'P0001';
  end;
  if v_due is not null and v_issue is not null and v_due < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the issue date.' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or round(p_amount, 2) <> p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the invoice total in rupees (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reference, '')) > 120 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: The reference or note is too long.' using errcode = 'P0001';
  end if;
  update public.member_invoices
     set issue_date = coalesce(v_issue::text, ''), due_date = coalesce(v_due::text, ''), amount = p_amount,
         details = jsonb_strip_nulls(jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''), 'reference', nullif(btrim(coalesce(p_reference, '')), '')))
   where id = p_invoice returning * into inv;
  perform private.write_audit('INVOICE_UPDATED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'total', inv.amount));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_update_uploaded_invoice(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_update_uploaded_invoice(uuid, text, text, numeric, text, text) to authenticated;

-- One invoice (any viewer who may read it): used by the preview / download views.
create or replace function public.invoice_detail(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  inv public.member_invoices;
begin
  select * into inv from public.member_invoices where id = p_invoice;
  if inv.id is null or not private.can_read_invoice(inv) then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  return private.invoice_json(inv);
end $$;
revoke all on function public.invoice_detail(uuid) from public, anon;
grant execute on function public.invoice_detail(uuid) to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261015000300_invoices_upload_only.sql

-- =============================================================================
-- Invoices are uploaded by Accounts, never generated.
--
--  * Removes the two functions that generated an invoice (a services invoice, and an add-on
--    invoice from approved prices). Invoices that were already generated stay readable.
--  * Add-on workflow: once Accounts approves an add-on request, the accountant UPLOADS the add-on
--    invoice PDF (begin_addon_invoice_upload + the normal upload completion). The invoice record is
--    created only when the file is stored, takes its total and lines from the approved request, and
--    moves the request to INVOICE_GENERATED ("Invoice Generated"). One invoice per request.
--  * An add-on invoice is marked paid only by the add-on payment confirmation.
-- Additive / re-runnable.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. No invoice generation
-- ---------------------------------------------------------------------------
drop function if exists public.accounts_create_invoice(uuid, jsonb, date, date, text);
drop function if exists public.accounts_generate_addon_invoice(uuid, date, date);
drop function if exists private.invoice_fills_checklist(public.member_invoices);
drop function if exists private.next_invoice_number();

-- ---------------------------------------------------------------------------
-- 2. The checks every uploaded invoice goes through (number, dates, total, reference, note)
-- ---------------------------------------------------------------------------
create or replace function private.invoice_upload_meta(
  p_number text, p_issue_date text, p_due_date text, p_amount numeric, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_no text := btrim(coalesce(p_number, ''));
  v_issue date; v_due date;
begin
  if v_no = '' then
    raise exception 'VALIDATION_ERROR: Enter the invoice number.' using errcode = 'P0001';
  end if;
  if v_no !~ '^[A-Za-z0-9][A-Za-z0-9 ./#_-]{0,59}$' then
    raise exception 'VALIDATION_ERROR: The invoice number can use letters, numbers, spaces and - / . # _ (up to 60 characters).' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.member_invoices i where lower(i.invoice_number) = lower(v_no) and i.kind <> 'MANUAL') then
    raise exception 'CONFLICT: An invoice numbered % already exists.', v_no using errcode = 'P0001';
  end if;
  begin
    v_issue := nullif(btrim(coalesce(p_issue_date, '')), '')::date;
    v_due := nullif(btrim(coalesce(p_due_date, '')), '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter valid dates.' using errcode = 'P0001';
  end;
  if v_due is not null and v_issue is not null and v_due < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the issue date.' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or round(p_amount, 2) <> p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the invoice total in rupees (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reference, '')) > 120 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: The reference or note is too long.' using errcode = 'P0001';
  end if;
  return jsonb_strip_nulls(jsonb_build_object('number', v_no, 'issueDate', v_issue::text, 'dueDate', v_due::text, 'amount', p_amount,
                                              'reference', nullif(btrim(coalesce(p_reference, '')), ''), 'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;
revoke all on function private.invoice_upload_meta(text, text, text, numeric, text, text) from public, anon, authenticated;

create or replace function public.begin_invoice_upload(
  p_customer uuid, p_invoice_number text, p_issue_date text, p_due_date text, p_amount numeric,
  p_reference text, p_note text, p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  m jsonb;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_invoice(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  m := private.invoice_upload_meta(p_invoice_number, p_issue_date, p_due_date, p_amount, p_reference, p_note);
  perform private.check_invoice_pdf(p_mime, p_size);
  return private.invoice_pending_doc(p_customer, null, m, p_file_name, p_size);
end $$;
revoke all on function public.begin_invoice_upload(uuid, text, text, text, numeric, text, text, text, text, bigint) from public, anon;
grant execute on function public.begin_invoice_upload(uuid, text, text, text, numeric, text, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Add-on invoice: uploaded by Accounts once the request is approved
-- ---------------------------------------------------------------------------
create or replace function public.begin_addon_invoice_upload(
  p_request uuid, p_invoice_number text, p_issue_date text, p_due_date text, p_reference text, p_note text,
  p_file_name text, p_mime text, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  r public.addon_requests;
  m jsonb;
begin
  perform private.require_accounts_staff();
  select * into r from public.addon_requests where id = p_request for update;
  if r.id is null or r.status = 'DRAFT' or not private.accounts_can_invoice(r.customer_id) then
    raise exception 'NOT_FOUND: Add-on request not found.' using errcode = 'P0001';
  end if;
  if r.invoice_id is not null or exists (select 1 from public.member_invoices where addon_request_id = r.id) then
    raise exception 'CONFLICT: An invoice was already uploaded for this request.' using errcode = 'P0001';
  end if;
  if r.status <> 'APPROVED' then
    raise exception 'CONFLICT: Only an approved add-on request can be invoiced.' using errcode = 'P0001';
  end if;
  -- the total always comes from the approved request, never from what is typed
  m := private.invoice_upload_meta(p_invoice_number, p_issue_date, p_due_date, null, p_reference, p_note)
       || jsonb_build_object('addonRequestId', r.id);
  perform private.check_invoice_pdf(p_mime, p_size);
  return private.invoice_pending_doc(r.customer_id, null, m, p_file_name, p_size);
end $$;
revoke all on function public.begin_addon_invoice_upload(uuid, text, text, text, text, text, text, text, bigint) from public, anon;
grant execute on function public.begin_addon_invoice_upload(uuid, text, text, text, text, text, text, text, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Completion: an add-on invoice also moves its request on
-- ---------------------------------------------------------------------------
create or replace function public.complete_document_upload(p_document uuid, p_size bigint)
returns public.customer_documents language plpgsql security definer set search_path = '' as $$
declare
  d public.customer_documents;
  v public.customers;
  t public.document_types;
  v_replaced public.customer_documents;
  v_inv boolean;
  v_addon boolean := false;
  m jsonb;
  inv public.member_invoices;
  r public.addon_requests;
begin
  select * into d from public.customer_documents where id = p_document for update;
  v_inv := d.id is not null and d.document_type = 'INVOICE' and (d.invoice_id is not null or d.invoice_meta is not null);
  if d.id is null or not (case when v_inv then private.accounts_can_invoice(d.customer_id)
                               else private.can_access_customer(d.customer_id) or private.can_collect_addon_item(d.customer_id, d.document_type) end) then
    raise exception 'NOT_FOUND: Document not found.' using errcode = 'P0001';
  end if;
  if d.status <> 'PENDING' then
    raise exception 'CONFLICT: This upload was already finished.' using errcode = 'P0001';
  end if;
  select * into t from public.document_types where code = d.document_type;
  if coalesce(p_size, 0) <= 0 or p_size > t.max_size_bytes then
    raise exception 'VALIDATION_ERROR: File size exceeds the % KB limit. Please upload a smaller PDF.', t.max_size_bytes / 1024 using errcode = 'P0001';
  end if;
  if v_inv then
    select * into v from public.customers where id = d.customer_id for update;
  else
    v := private.lock_collect_customer(d.customer_id, d.document_type);
  end if;

  -- A new uploaded invoice gets its record only now that the file is safely stored.
  if v_inv and d.invoice_id is null then
    m := d.invoice_meta;
    v_addon := m ? 'addonRequestId';
    if v_addon then
      select * into r from public.addon_requests where id = (m ->> 'addonRequestId')::uuid for update;
      if r.id is null or r.status <> 'APPROVED' or r.invoice_id is not null
         or exists (select 1 from public.member_invoices where addon_request_id = r.id) then
        raise exception 'CONFLICT: This add-on request can no longer take an invoice.' using errcode = 'P0001';
      end if;
    end if;
    begin
      insert into public.member_invoices (owner_id, invoice_number, customer_name, company, amount, status, issue_date, due_date, details,
                                          customer_id, kind, department_id, subtotal, discount_total, tax_total, issued_by, issued_at, addon_request_id)
      values ((select private.my_id()), m ->> 'number', v.name, coalesce(v.company, ''),
              case when v_addon then r.total else nullif(m ->> 'amount', '')::numeric end, 'Pending',
              coalesce(m ->> 'issueDate', ''), coalesce(m ->> 'dueDate', ''),
              jsonb_strip_nulls(jsonb_build_object('note', m ->> 'note', 'reference', m ->> 'reference',
                'items', case when v_addon then (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                                         'serviceCode', i.service_code, 'name', i.name, 'quantity', i.quantity, 'unitPrice', i.unit_price,
                                         'discount', i.discount, 'taxPercent', i.tax_percent, 'tax', i.tax, 'lineTotal', i.line_total)) order by i.sort_order), '[]'::jsonb)
                                       from public.addon_request_items i where i.request_id = r.id) end)),
              v.id, 'UPLOADED', v.department_id,
              case when v_addon then r.subtotal end, case when v_addon then r.discount_total end, case when v_addon then r.tax_total end,
              (select private.my_id()), now(), case when v_addon then r.id end)
      returning * into inv;
    exception when unique_violation then
      raise exception 'CONFLICT: An invoice numbered % already exists, or this request already has an invoice.', m ->> 'number' using errcode = 'P0001';
    end;
    update public.customer_documents set invoice_id = inv.id, invoice_meta = null where id = d.id returning * into d;
  elsif v_inv then
    select * into inv from public.member_invoices where id = d.invoice_id for update;
  end if;

  -- Only the file this one replaces: the same invoice, or (other documents) the same customer and type.
  update public.customer_documents set status = 'SUPERSEDED'
   where customer_id = d.customer_id and document_type = d.document_type and status = 'UPLOADED'
     and invoice_id is not distinct from d.invoice_id and id <> d.id
  returning * into v_replaced;

  update public.customer_documents
     set status = 'UPLOADED', size_bytes = p_size, uploaded_at = now(),
         version = coalesce((select max(x.version) from public.customer_documents x
                              where x.customer_id = d.customer_id and x.document_type = d.document_type), 0) + 1
   where id = p_document returning * into d;

  if v_inv then
    perform private.write_audit(case when v_replaced.id is null then 'INVOICE_UPLOADED' else 'INVOICE_REPLACED' end,
      'invoice', inv.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', d.customer_id, 'number', inv.invoice_number, 'document_id', d.id, 'file_name', d.original_file_name,
                         'size_bytes', p_size, 'replaced_document_id', v_replaced.id, 'addon_request_id', inv.addon_request_id));
    perform private.log_customer_activity(d.customer_id, 'INVOICE_UPLOADED',
      format('Invoice %s PDF %s by Accounts', inv.invoice_number, case when v_replaced.id is null then 'uploaded' else 'replaced' end));
    if v_addon then
      -- the approved add-on request now has its invoice: payment is next
      update public.addon_requests set status = 'INVOICE_GENERATED', invoice_id = inv.id where id = r.id returning * into r;
      perform private.addon_event(r.id, 'INVOICE_GENERATED', inv.invoice_number);
      perform private.notify_consultant(r, 'ADDON_INVOICE_ISSUED', format('Add-on invoice: %s', coalesce(v.company, v.name)),
        format('Accounts uploaded invoice %s (%s). Wait for the payment confirmation before collecting documents.', inv.invoice_number, private.rupees(inv.amount)));
      perform private.notify(v.owner_id, 'ADDON_INVOICE_ISSUED', format('Add-on invoice: %s', coalesce(v.company, v.name)),
        format('Accounts uploaded invoice %s (%s) for the add-on services.', inv.invoice_number, private.rupees(inv.amount)), 'customer', v.id);
    else
      perform private.notify(v.owner_id, 'INVOICE_UPLOADED', format('Invoice for %s', coalesce(v.company, v.name)),
        format('Accounts %s the PDF of invoice %s.', case when v_replaced.id is null then 'uploaded' else 'replaced' end, inv.invoice_number), 'customer', v.id);
    end if;
  else
    perform private.write_audit(case when v_replaced.id is null then 'DOCUMENT_UPLOADED' else 'DOCUMENT_REPLACED' end,
      'customer_document', d.id, v.department_id, v.team_id,
      jsonb_build_object('customer_id', d.customer_id, 'document_type', d.document_type, 'version', d.version,
                         'replaced_document_id', v_replaced.id, 'size_bytes', p_size));
    perform private.log_customer_activity(d.customer_id, 'DOCUMENT_UPLOADED',
      format('%s %s (v%s)', t.label, case when v_replaced.id is null then 'uploaded' else 'replaced' end, d.version));
  end if;
  perform private.refresh_onboarding_progress(d.customer_id);
  return d;
end $$;
revoke all on function public.complete_document_upload(uuid, bigint) from public, anon;
grant execute on function public.complete_document_upload(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. An add-on invoice follows its request: paid only by the payment confirmation, total fixed
-- ---------------------------------------------------------------------------
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
  if inv.kind = 'ADDON' or inv.addon_request_id is not null then
    raise exception 'CONFLICT: An add-on invoice is marked paid when Accounts confirms the add-on payment.' using errcode = 'P0001';
  end if;
  update public.member_invoices set status = p_status, paid_at = case when p_status = 'Paid' then coalesce(paid_at, now()) end
   where id = p_invoice returning * into inv;
  perform private.write_audit('INVOICE_STATUS_CHANGED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'status', p_status));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_set_invoice_status(uuid, text) from public, anon;
grant execute on function public.accounts_set_invoice_status(uuid, text) to authenticated;

create or replace function public.accounts_update_uploaded_invoice(
  p_invoice uuid, p_issue_date text, p_due_date text, p_amount numeric, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  v_issue date; v_due date;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  if inv.kind <> 'UPLOADED' then
    raise exception 'CONFLICT: Only an uploaded invoice can be edited here.' using errcode = 'P0001';
  end if;
  begin
    v_issue := nullif(btrim(coalesce(p_issue_date, '')), '')::date;
    v_due := nullif(btrim(coalesce(p_due_date, '')), '')::date;
  exception when others then
    raise exception 'VALIDATION_ERROR: Enter valid dates.' using errcode = 'P0001';
  end;
  if v_due is not null and v_issue is not null and v_due < v_issue then
    raise exception 'VALIDATION_ERROR: The due date cannot be before the issue date.' using errcode = 'P0001';
  end if;
  if p_amount is not null and (p_amount < 0 or p_amount > 9999999999.99 or round(p_amount, 2) <> p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the invoice total in rupees (up to 2 decimals).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_reference, '')) > 120 or length(coalesce(p_note, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: The reference or note is too long.' using errcode = 'P0001';
  end if;
  update public.member_invoices
     set issue_date = coalesce(v_issue::text, ''), due_date = coalesce(v_due::text, ''),
         -- an add-on invoice keeps the approved total
         amount = case when inv.addon_request_id is not null then inv.amount else p_amount end,
         details = coalesce(details, '{}'::jsonb) || jsonb_build_object('note', nullif(btrim(coalesce(p_note, '')), ''), 'reference', nullif(btrim(coalesce(p_reference, '')), ''))
   where id = p_invoice returning * into inv;
  update public.member_invoices set details = jsonb_strip_nulls(details) where id = inv.id returning * into inv;
  perform private.write_audit('INVOICE_UPDATED', 'invoice', inv.id, inv.department_id, null,
    jsonb_build_object('number', inv.invoice_number, 'total', inv.amount));
  return private.invoice_json(inv);
end $$;
revoke all on function public.accounts_update_uploaded_invoice(uuid, text, text, numeric, text, text) from public, anon;
grant execute on function public.accounts_update_uploaded_invoice(uuid, text, text, numeric, text, text) to authenticated;

