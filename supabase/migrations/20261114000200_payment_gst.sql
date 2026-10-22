-- GST when Accounts records a payment.
--
-- Safe to run again. Run it after 20261114000100_revenue_attribution.sql.
--
-- Until now a payment was a single amount: nothing said how much of it was GST. Accounts now types the amount BEFORE GST, chooses the
-- GST rate, and sees the final amount (what the customer actually paid). The final amount is what is recorded as received, so every
-- balance, ledger and report that reads the payment amount is unchanged. The GST is stored with the payment.
--
--   customer_payments.taxable_amount / gst_rate / gst_amount   NULL = no GST was recorded (payments from before this change, and
--                                                              orders whose agreed amount already includes GST).
--                                                              amount = taxable_amount + gst_amount.
--   GST is ON TOP of the agreed amount (Sales agrees an amount before GST; Accounts decides the GST). So the order's total payable is
--     agreed amount + the GST of the order, where the GST of the order is the larger of the GST of the invoices Accounts issued and the
--     GST recorded on payments. (The same money is not taxed twice when its invoice repeats the GST recorded on the payment.)
--   Invoices are not changed: Accounts still chooses the GST on the invoice itself.
--
-- New functions (the old ones stay, for callers that do not send a GST rate):
--   accounts_record_taxed_payment / accounts_update_taxed_payment      the same rules as before, with the GST rate
-- and these are replaced so the order's total payable follows the payments' GST:
--   private.sync_order_payable, private.sync_payment_totals, customer_payment_overview

alter table public.customer_payments
  add column if not exists taxable_amount numeric(14, 2) check (taxable_amount > 0),
  add column if not exists gst_rate numeric(5, 2) check (gst_rate >= 0 and gst_rate <= 28),
  add column if not exists gst_amount numeric(14, 2) check (gst_amount >= 0);
alter table public.customer_payments drop constraint if exists customer_payments_gst_consistent;
alter table public.customer_payments add constraint customer_payments_gst_consistent
  check ((taxable_amount is null and gst_rate is null and gst_amount is null)
         or (taxable_amount is not null and gst_rate is not null and gst_amount is not null and amount = taxable_amount + gst_amount));

-- ---------------------------------------------------------------------------
-- The total payable of an order whose agreement excludes GST: the agreed amount plus the order's GST
-- (the larger of the invoices' GST and the GST recorded on the payments), and never below what was received.
-- ---------------------------------------------------------------------------
create or replace function private.sync_order_payable(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_net numeric; v_inv_gst numeric; v_pay_gst numeric; v_new numeric;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or c.agreed_amount is null or c.agreed_tax_basis <> 'EXCLUSIVE' then
    return;
  end if;
  select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0) into v_net, v_inv_gst
    from public.generated_invoices where customer_id = c.id and payment_ledger = 'CUSTOMER';
  select coalesce(sum(gst_amount), 0) into v_pay_gst
    from public.customer_payments where customer_id = c.id and status in ('PENDING', 'VERIFIED');
  -- no GST is assumed for the part that is neither invoiced nor paid yet: Accounts decides it
  v_new := round(v_net + v_inv_gst + greatest(c.agreed_amount - v_net, 0) + greatest(v_pay_gst - v_inv_gst, 0), 2);
  -- never below what has already been received
  v_new := greatest(v_new, c.amount_received);
  if c.deal_amount is distinct from v_new then
    update public.customers set deal_amount = v_new where id = c.id;
  end if;
end $$;
revoke all on function private.sync_order_payable(uuid) from public, anon, authenticated;

-- The payments' totals, now keeping the total payable in step (raised BEFORE the received amount grows, lowered after it shrinks:
-- a customer's received amount may never exceed the total payable).
create or replace function private.sync_payment_totals(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_verified numeric;
begin
  perform private.sync_order_payable(p_customer);
  select coalesce(sum(amount) filter (where status in ('PENDING', 'VERIFIED')), 0),
         coalesce(sum(amount) filter (where status = 'VERIFIED'), 0)
    into v_recorded, v_verified
    from public.customer_payments where customer_id = p_customer;
  update public.customers set amount_received = v_recorded, amount_verified = v_verified where id = p_customer;
  update public.customer_onboarding set payment_verified = v_verified > 0 where customer_id = p_customer;
  perform private.sync_order_payable(p_customer);
  perform private.sync_invoice_payment_status(p_customer);
end $$;
revoke all on function private.sync_payment_totals(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The checks of a payment with GST. p_taxable is the amount before GST. Returns the GST and the final amount.
-- p_rate NULL = the payment records no GST (orders whose agreed amount includes GST, and callers that send no rate).
-- ---------------------------------------------------------------------------
create or replace function private.check_taxed_payment(
  v public.customers, p_exclude uuid, p_type text, p_taxable numeric, p_rate numeric, p_method text, p_reference text, p_paid_at timestamptz,
  out o_gst numeric, out o_final numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_other_pay_gst numeric;
  v_net numeric; v_inv_gst numeric;
  v_deal numeric;
  v_exclusive boolean := v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
begin
  if p_type is null or p_type not in ('PART', 'FULL') then
    raise exception 'VALIDATION_ERROR: Choose part payment or full payment.' using errcode = 'P0001';
  end if;
  if coalesce(p_taxable, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_method is null or p_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select the payment method.' using errcode = 'P0001';
  end if;
  if p_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and p_reference is null then
    raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
  end if;
  if p_paid_at > now() + interval '1 hour' then
    raise exception 'VALIDATION_ERROR: The payment date cannot be in the future.' using errcode = 'P0001';
  end if;
  if coalesce(v.deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: The agreed amount is not set for this customer.' using errcode = 'P0001';
  end if;
  if p_rate is not null and (p_rate < 0 or p_rate > 28 or p_rate <> round(p_rate, 2)) then
    raise exception 'VALIDATION_ERROR: Choose a GST rate between 0 and 28 percent.' using errcode = 'P0001';
  end if;
  if p_rate is not null and not v_exclusive then
    if p_rate > 0 then
      raise exception 'VALIDATION_ERROR: The agreed amount of this order already includes GST, so GST cannot be added on top. Record the amount received.' using errcode = 'P0001';
    end if;
  end if;

  o_gst := case when p_rate is null or not v_exclusive then 0 else round(p_taxable * p_rate / 100, 2) end;
  o_final := p_taxable + o_gst;

  select coalesce(sum(amount), 0), coalesce(sum(gst_amount), 0) into v_recorded, v_other_pay_gst
    from public.customer_payments where customer_id = v.id and status in ('PENDING', 'VERIFIED') and id is distinct from p_exclude;
  -- the total payable as it will be once this payment is recorded
  if v_exclusive then
    select coalesce(sum(subtotal), 0), coalesce(sum(total_gst), 0) into v_net, v_inv_gst
      from public.generated_invoices where customer_id = v.id and payment_ledger = 'CUSTOMER';
    v_deal := round(v_net + v_inv_gst + greatest(v.agreed_amount - v_net, 0) + greatest(v_other_pay_gst + o_gst - v_inv_gst, 0), 2);
  else
    v_deal := v.deal_amount;
  end if;
  -- whole rupees, except the payment that settles the exact balance (GST brings paise)
  if p_taxable <> trunc(p_taxable) and v_recorded + o_final <> v_deal then
    raise exception 'VALIDATION_ERROR: Enter the amount in whole rupees (no paise). Only the payment that settles the exact balance (%) can include paise.', private.rupees(v_deal - v_recorded) using errcode = 'P0001';
  end if;
  if v_recorded + o_final > v_deal then
    raise exception 'VALIDATION_ERROR: This would exceed the agreed amount. Balance still to receive: %.', private.rupees(greatest(v_deal - v_recorded, 0)) using errcode = 'P0001';
  end if;
  if p_type = 'FULL' and v_recorded + o_final <> v_deal then
    raise exception 'VALIDATION_ERROR: A full payment must settle the agreed amount (balance %). Record it as a part payment instead.', private.rupees(v_deal - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'PART' and v_recorded + o_final = v_deal then
    raise exception 'VALIDATION_ERROR: This payment settles the agreed amount. Record it as a full payment.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_taxed_payment(public.customers, uuid, text, numeric, numeric, text, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Record / edit a payment with GST (Accounts)
-- ---------------------------------------------------------------------------
create or replace function public.accounts_record_taxed_payment(
  p_customer uuid, p_type text, p_amount numeric, p_method text, p_reference text default null, p_paid_at timestamptz default null,
  p_note text default null, p_verify boolean default false, p_gst_rate numeric default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 120);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_paid timestamptz := coalesce(p_paid_at, now());
  v_request uuid;
  v_id uuid;
  v_status text := case when coalesce(p_verify, false) then 'VERIFIED' else 'PENDING' end;
  r record;
  v_taxed boolean;
begin
  if v.lifecycle_stage not in ('LEAD', 'ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Payments cannot be recorded for this customer right now.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage = 'LEAD' and v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This lead is not with Accounts.' using errcode = 'P0001';
  end if;
  select * into r from private.check_taxed_payment(v, null, p_type, p_amount, p_gst_rate, p_method, v_ref, v_paid);
  v_taxed := p_gst_rate is not null and v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
  select id into v_request from public.payment_requests where customer_id = p_customer and status = 'PENDING';

  begin
    insert into public.customer_payments (customer_id, request_id, payment_type, amount, taxable_amount, gst_rate, gst_amount, method, reference, paid_at,
                                          status, source, note, recorded_by, verified_by, verified_at)
    values (p_customer, v_request, p_type, r.o_final, case when v_taxed then p_amount end, case when v_taxed then p_gst_rate end, case when v_taxed then r.o_gst end,
            p_method, v_ref, v_paid, v_status, 'ACCOUNTS', v_note,
            (select private.my_id()), case when v_status = 'VERIFIED' then (select private.my_id()) end, case when v_status = 'VERIFIED' then now() end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CONFLICT: A payment with this reference is already recorded for this customer.' using errcode = 'P0001';
  end;
  perform private.sync_payment_totals(p_customer);
  update public.customers set accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id())) where id = p_customer;
  perform private.log_customer_activity(p_customer, case when v_status = 'VERIFIED' then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end,
    format('%s %s of %s%s %s', case p_type when 'PART' then 'Part payment' else 'Full payment' end,
           case when v_status = 'VERIFIED' then 'verified' else 'recorded (pending verification)' end, private.rupees(r.o_final),
           case when v_taxed and r.o_gst > 0 then format(' (%s + GST %s at %s%%)', private.rupees(p_amount), private.rupees(r.o_gst), p_gst_rate::text) else '' end, 'by Accounts'));
  perform private.write_audit(case when v_status = 'VERIFIED' then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end, 'customer', p_customer,
    v.department_id, v.team_id, jsonb_build_object('payment_id', v_id, 'type', p_type, 'amount', r.o_final, 'taxable', case when v_taxed then p_amount end,
      'gst_rate', case when v_taxed then p_gst_rate end, 'gst', case when v_taxed then r.o_gst end, 'method', p_method, 'reference', v_ref));
  if v_status = 'VERIFIED' then
    perform private.notify(v.owner_id, 'PAYMENT_VERIFIED', format('Payment verified: %s', coalesce(v.company, v.name)),
      format('Accounts verified %s (%s).', private.rupees(r.o_final), case p_type when 'PART' then 'part payment' else 'full payment' end), 'customer', p_customer);
  end if;
  return v_id;
end $$;
revoke all on function public.accounts_record_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, boolean, numeric) from public, anon;
grant execute on function public.accounts_record_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, boolean, numeric) to authenticated;

create or replace function public.accounts_update_taxed_payment(
  p_payment uuid, p_type text, p_amount numeric, p_method text, p_reference text default null, p_paid_at timestamptz default null,
  p_note text default null, p_gst_rate numeric default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v public.customers;
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 120);
  v_paid timestamptz;
  r record;
  v_taxed boolean;
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  v := private.lock_customer_for_accounts(p.customer_id);
  if p.status <> 'PENDING' then
    raise exception 'CONFLICT: Only a payment that is still pending can be edited.' using errcode = 'P0001';
  end if;
  v_paid := coalesce(p_paid_at, p.paid_at);
  select * into r from private.check_taxed_payment(v, p.id, p_type, p_amount, p_gst_rate, p_method, v_ref, v_paid);
  v_taxed := p_gst_rate is not null and v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
  begin
    update public.customer_payments
       set payment_type = p_type, amount = r.o_final, taxable_amount = case when v_taxed then p_amount end,
           gst_rate = case when v_taxed then p_gst_rate end, gst_amount = case when v_taxed then r.o_gst end,
           method = p_method, reference = v_ref, paid_at = v_paid, note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000)
     where id = p.id;
  exception when unique_violation then
    raise exception 'CONFLICT: A payment with this reference is already recorded for this customer.' using errcode = 'P0001';
  end;
  perform private.sync_payment_totals(p.customer_id);
  perform private.write_audit('PAYMENT_EDITED', 'customer', p.customer_id, v.department_id, v.team_id,
    jsonb_build_object('payment_id', p.id, 'amount', r.o_final, 'taxable', case when v_taxed then p_amount end, 'gst', case when v_taxed then r.o_gst end));
end $$;
revoke all on function public.accounts_update_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, numeric) from public, anon;
grant execute on function public.accounts_update_taxed_payment(uuid, text, numeric, text, text, timestamptz, text, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- The payment overview: each payment's GST split, and what the form needs
--   gst.allowed          the agreed amount excludes GST, so Accounts can add it
--   gst.onPayments       the GST recorded on pending and verified payments
--   gst.taxableBalance   what is left of the agreed amount before GST (a suggestion for a full payment; the database decides)
-- ---------------------------------------------------------------------------
create or replace function public.customer_payment_overview(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  v_accounts boolean := private.accounts_can_view(p_customer);
  v_exclusive boolean;
  v_inv_gst numeric;
  v_taxable_paid numeric;
begin
  if not (v_accounts or private.can_access_customer(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  v_exclusive := v.agreed_amount is not null and v.agreed_tax_basis = 'EXCLUSIVE';
  select coalesce(sum(total_gst), 0) into v_inv_gst from public.generated_invoices where customer_id = v.id and payment_ledger = 'CUSTOMER';
  -- a payment without a recorded GST split is taken as taxable value, less its share of the GST of the invoices
  select coalesce(sum(coalesce(p.taxable_amount, p.amount * case when v_inv_gst > 0 and v.agreed_amount > 0 then v.agreed_amount / (v.agreed_amount + v_inv_gst) else 1 end)), 0)
    into v_taxable_paid from public.customer_payments p where p.customer_id = v.id and p.status in ('PENDING', 'VERIFIED');
  return jsonb_build_object(
    'customerId', v.id,
    'workflow', v.payment_workflow,
    'dealAmount', v.deal_amount,
    'agreedAmount', coalesce(v.agreed_amount, v.deal_amount),
    'taxBasis', case when v.agreed_amount is null then 'INCLUSIVE' else v.agreed_tax_basis end,
    'gst', jsonb_build_object(
      'allowed', v_exclusive,
      'onPayments', coalesce((select sum(gst_amount) from public.customer_payments where customer_id = v.id and status in ('PENDING', 'VERIFIED')), 0),
      'taxableBalance', case when v_exclusive then greatest(round(v.agreed_amount - v_taxable_paid, 2), 0) end),
    'order', private.order_summary(v.id),
    'recorded', v.amount_received,
    'verified', v.amount_verified,
    'pending', coalesce((select sum(amount) from public.customer_payments where customer_id = v.id and status = 'PENDING'), 0),
    'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0),
    'paymentStatus', v.payment_status,
    'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = v.accounts_owner_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.payment_type, 'amount', p.amount, 'taxableAmount', p.taxable_amount, 'gstRate', p.gst_rate, 'gstAmount', p.gst_amount,
        'method', p.method, 'reference', p.reference,
        'paidAt', p.paid_at, 'status', p.status, 'source', p.source, 'note', p.note, 'statusReason', p.status_reason,
        'recordedBy', (select full_name from public.profiles where id = p.recorded_by), 'recordedAt', p.recorded_at,
        'verifiedBy', (select full_name from public.profiles where id = p.verified_by), 'verifiedAt', p.verified_at)
        order by p.paid_at desc, p.recorded_at desc)
      from public.customer_payments p where p.customer_id = v.id), '[]'::jsonb),
    'request', (select jsonb_build_object(
        'id', r.id, 'status', r.status, 'agreedAmount', r.agreed_amount, 'salesNote', r.sales_note,
        'requestedAt', r.requested_at, 'requestedBy', (select full_name from public.profiles where id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note)
      from public.payment_requests r where r.customer_id = v.id order by r.requested_at desc limit 1),
    'followUps', case when v_accounts then coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'outcome', f.outcome, 'note', f.note, 'contactedAt', f.contacted_at, 'nextFollowUpAt', f.next_follow_up_at,
        'author', (select full_name from public.profiles where id = f.author_id))
        order by f.contacted_at desc)
      from public.payment_followups f where f.customer_id = v.id), '[]'::jsonb) else null end,
    'isAccounts', v_accounts);
end $$;
revoke all on function public.customer_payment_overview(uuid) from public, anon;
grant execute on function public.customer_payment_overview(uuid) to authenticated;
