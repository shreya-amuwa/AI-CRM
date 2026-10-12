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

-- ---------------------------------------------------------------------------
-- 2. The checks every uploaded invoice goes through (number, dates, total, reference, note).
--    The accountant only chooses the PDF: a blank number is numbered by the system (INV-YYYY-#####,
--    never reused) and a blank issue date is today. A typed number is still accepted and kept as typed.
-- ---------------------------------------------------------------------------
create sequence if not exists public.invoice_number_seq;
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

create or replace function private.invoice_upload_meta(
  p_number text, p_issue_date text, p_due_date text, p_amount numeric, p_reference text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_no text := btrim(coalesce(p_number, ''));
  v_issue date; v_due date;
begin
  if v_no = '' then
    v_no := private.next_invoice_number();
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
    v_issue := coalesce(v_issue, (now() at time zone 'Asia/Kolkata')::date);
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
    v_issue := coalesce(v_issue, (now() at time zone 'Asia/Kolkata')::date);
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
