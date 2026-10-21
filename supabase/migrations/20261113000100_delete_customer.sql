-- =============================================================================
-- Delete a customer (Super Admin, and the Department Head of the customer's department).
--
--   delete_customer(p_customer)   removes the customer and everything that hangs off it that has no value on its own:
--                                 conversations, onboarding, documents (the stored files are returned so the server can
--                                 remove them), tickets, plans, payment requests and payments that were never verified,
--                                 the client login record. It also returns the client's sign-in user id so the server
--                                 can remove that login too.
--   It REFUSES while the customer has an issued invoice or a verified (or reversed) payment: those are the company's
--   financial records, Accounts keeps them, and income reports are built from them.
--   Every deletion is audited (CUSTOMER_DELETED, by the customers table's trigger, with a snapshot of the record).
-- Run after 20261112000300_company_workflow.sql. Safe to run again.
-- =============================================================================

create or replace function public.delete_customer(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_docs jsonb;
  v_client uuid;
begin
  select * into c from public.customers where id = p_customer for update;
  if c.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not (private.is_super_admin()
          or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id is not distinct from private.my_department_id())) then
    raise exception 'FORBIDDEN: Only the Super Admin and the Department Head of the customer''s department can delete a customer.' using errcode = '42501';
  end if;

  if exists (select 1 from public.generated_invoices g where g.customer_id = c.id) then
    raise exception 'CONFLICT: This customer has an issued invoice. Invoices are kept by the Accounts department, so the customer cannot be deleted.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status in ('VERIFIED', 'REVERSED'))
     or exists (select 1 from public.addon_payments p where p.customer_id = c.id and p.status in ('VERIFIED', 'REVERSED'))
     or exists (select 1 from public.invoice_payments p where p.customer_id = c.id) then
    raise exception 'CONFLICT: This customer has a verified payment. Payments are part of the income records kept by Accounts, so the customer cannot be deleted.' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('bucket', d.storage_bucket, 'path', d.storage_path, 'provider', d.storage_provider)), '[]'::jsonb)
    into v_docs from public.customer_documents d where d.customer_id = c.id and d.storage_path is not null;
  select a.auth_user_id into v_client from public.customer_client_accounts a where a.customer_id = c.id;

  -- what never became money, then the rest (the other tables are removed with the customer)
  delete from public.payment_followups where customer_id = c.id;
  delete from public.customer_payments where customer_id = c.id;
  delete from public.addon_payments where customer_id = c.id;
  delete from public.payment_requests where customer_id = c.id;
  delete from public.customer_documents where customer_id = c.id;
  delete from public.customers where id = c.id;

  -- the customers table's own trigger writes the audit event (CUSTOMER_DELETED, with a snapshot of the record)
  return jsonb_build_object('name', coalesce(nullif(c.company, ''), c.name), 'code', c.customer_code, 'documents', v_docs, 'clientUserId', v_client);
end $$;
revoke all on function public.delete_customer(uuid) from public, anon;
grant execute on function public.delete_customer(uuid) to authenticated;
