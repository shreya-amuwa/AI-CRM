-- =============================================================================
-- Sales → Accounts payment confirmation, verified payments, Get Started
-- eligibility, Part Payments and the accountant's balance follow-up.
--
--   Sales ("Send to Accounts")  customers.payment_workflow = PENDING_PAYMENT_CONFIRMATION
--      │  Accounts records the payment (part / full) and verifies it
--      ├─ "Confirm payment & return to Sales"  → customer moves to Customer onboarding
--      └─ "Customer backed off"                → customer returns to My Leads → Leads
--
-- Three separate concepts, never overwriting each other:
--   payment status   customers.payment_status   (generated from the verified ledger)
--   onboarding       customer_onboarding        (documents / checklist) + get_started
--   accounts follow-up   payment_followups      (the accountant's own notes)
--
-- customer_payments is the ONLY source of money. customers.amount_received
-- (recorded: pending + verified) and customers.amount_verified (verified only)
-- are kept in step by private.sync_payment_totals(), so the existing Sales
-- screens keep working. Only an Accounts user can verify a payment.
-- Existing amounts are back-filled into the ledger: verified when Accounts had
-- already confirmed the customer, otherwise pending.
-- Additive / idempotent.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists amount_verified numeric(14, 2) not null default 0,
  add column if not exists payment_workflow text not null default 'NONE',
  add column if not exists accounts_owner_id uuid references public.profiles (id) on delete set null;

do $$
begin
  alter table public.customers add constraint customers_payment_workflow_check
    check (payment_workflow in ('NONE', 'PENDING_PAYMENT_CONFIRMATION', 'RETURNED_FROM_ACCOUNTS', 'PAYMENT_CONFIRMED'));
  alter table public.customers add constraint customers_amount_verified_check
    check (amount_verified >= 0 and amount_verified <= amount_received);
exception when duplicate_object then null;
end $$;

-- Payment status: from the verified ledger only. Pending money is never "paid".
alter table public.customers drop column if exists payment_status;
alter table public.customers
  add column payment_status text generated always as (
    case when amount_received <= 0 then 'NO_PAYMENT'
         when amount_verified <= 0 then 'PENDING_VERIFICATION'
         when deal_amount is not null and deal_amount > 0 and amount_verified >= deal_amount then 'FULLY_PAID'
         else 'PARTIALLY_PAID' end) stored;
create index if not exists customers_payment_workflow_idx on public.customers (payment_workflow) where payment_workflow <> 'NONE';
create index if not exists customers_accounts_owner_idx on public.customers (accounts_owner_id) where accounts_owner_id is not null;

alter table public.customer_onboarding
  add column if not exists payment_verified boolean not null default false;

-- Get Started: required documents/details all verified, a verified part or full
-- payment, and the customer has come through Accounts. Recalculated by the
-- database whenever any of those change (generated column).
alter table public.customer_onboarding drop column if exists get_started;
alter table public.customer_onboarding
  add column get_started boolean generated always as (
    payment_verified and accounts_confirmed_at is not null and returned_at is null
    and items_total > 0 and items_verified >= items_total) stored;

-- ---------------------------------------------------------------------------
-- 2. Tables (no direct client access: everything goes through the functions)
-- ---------------------------------------------------------------------------
create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  status text not null default 'PENDING' check (status in ('PENDING', 'CONFIRMED', 'RETURNED')),
  agreed_amount numeric(14, 2) not null check (agreed_amount > 0),
  sales_note text check (length(sales_note) <= 1000),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (length(resolution_note) <= 1000)
);
-- One open submission per customer: a double click or a second tab cannot queue it twice.
create unique index if not exists payment_requests_one_open on public.payment_requests (customer_id) where status = 'PENDING';
create index if not exists payment_requests_status_idx on public.payment_requests (status, requested_at desc);
create index if not exists payment_requests_customer_idx on public.payment_requests (customer_id, requested_at desc);

create table if not exists public.customer_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  request_id uuid references public.payment_requests (id) on delete set null,
  payment_type text not null check (payment_type in ('PART', 'FULL')),
  amount numeric(14, 2) not null check (amount > 0),
  method text check (method in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  reference text check (length(reference) between 1 and 120),
  paid_at timestamptz not null default now(),
  status text not null default 'PENDING' check (status in ('PENDING', 'VERIFIED', 'REJECTED', 'REVERSED')),
  source text not null default 'ACCOUNTS' check (source in ('ACCOUNTS', 'SALES', 'LEGACY')),
  note text check (length(note) <= 1000),
  status_reason text check (length(status_reason) <= 500),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now(),
  verified_by uuid references public.profiles (id) on delete set null,
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists customer_payments_customer_idx on public.customer_payments (customer_id, paid_at desc);
create index if not exists customer_payments_verified_idx on public.customer_payments (customer_id) where status = 'VERIFIED';
-- A transaction reference is recorded once per customer (editing or verifying never adds a second row).
create unique index if not exists customer_payments_reference_key on public.customer_payments (customer_id, lower(reference))
  where reference is not null and status in ('PENDING', 'VERIFIED');
drop trigger if exists customer_payments_set_updated_at on public.customer_payments;
create trigger customer_payments_set_updated_at before update on public.customer_payments
  for each row execute function public.tg_set_updated_at();

create table if not exists public.payment_followups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  outcome text not null check (outcome in ('CONTACTED', 'AWAITING_PAYMENT', 'NO_RESPONSE', 'OTHER')),
  note text not null check (length(btrim(note)) between 1 and 2000),
  contacted_at timestamptz not null default now(),
  next_follow_up_at timestamptz,
  author_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payment_followups_customer_idx on public.payment_followups (customer_id, contacted_at desc);
create index if not exists payment_followups_next_idx on public.payment_followups (next_follow_up_at) where next_follow_up_at is not null;

alter table public.payment_requests enable row level security;
alter table public.customer_payments enable row level security;
alter table public.payment_followups enable row level security;
revoke all on public.payment_requests, public.customer_payments, public.payment_followups from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
-- Accounts team lead / department head, or the Super Admin.
create or replace function private.is_accounts_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or exists (
    select 1 from public.profiles p join public.departments d on d.id = p.department_id
    where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'accounts' and p.role in ('TEAM_HEAD', 'DEPARTMENT_HEAD'))
$$;
revoke all on function private.is_accounts_manager() from public, anon;
grant execute on function private.is_accounts_manager() to authenticated;

-- Accounts may only touch customers that came to them: an open or past
-- submission, any payment on record, or an onboarding Accounts handled.
create or replace function private.accounts_can_view(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff() and (
    exists (select 1 from public.payment_requests r where r.customer_id = p_customer)
    or exists (select 1 from public.customer_payments p where p.customer_id = p_customer)
    or exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer
                and (o.sent_to_accounts_at is not null or o.accounts_confirmed_at is not null)))
$$;
revoke all on function private.accounts_can_view(uuid) from public, anon;
grant execute on function private.accounts_can_view(uuid) to authenticated;

-- Recomputes the customer's money from the ledger and the onboarding payment flag.
create or replace function private.sync_payment_totals(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
  v_verified numeric;
begin
  select coalesce(sum(amount) filter (where status in ('PENDING', 'VERIFIED')), 0),
         coalesce(sum(amount) filter (where status = 'VERIFIED'), 0)
    into v_recorded, v_verified
    from public.customer_payments where customer_id = p_customer;
  update public.customers set amount_received = v_recorded, amount_verified = v_verified where id = p_customer;
  update public.customer_onboarding set payment_verified = v_verified > 0 where customer_id = p_customer;
end $$;
revoke all on function private.sync_payment_totals(uuid) from public, anon, authenticated;

-- Notifies every active Accounts staff member.
create or replace function private.notify_accounts(p_type text, p_title text, p_body text, p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recipient uuid;
begin
  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
    where p.status = 'ACTIVE' and d.slug = 'accounts'
  loop
    perform private.notify(v_recipient, p_type, p_title, p_body, 'customer', p_customer);
  end loop;
end $$;
revoke all on function private.notify_accounts(text, text, text, uuid) from public, anon, authenticated;

create or replace function private.rupees(p_amount numeric)
returns text language sql immutable set search_path = '' as $$
  select '₹' || case when abs(coalesce(p_amount, 0)) < 1000000000 then to_char(coalesce(p_amount, 0), 'FM99,99,99,999')
                     else coalesce(p_amount, 0)::bigint::text end
$$;
revoke all on function private.rupees(numeric) from public, anon;
grant execute on function private.rupees(numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Back-fill the ledger from the amounts already on customers
-- ---------------------------------------------------------------------------
insert into public.customer_payments (customer_id, payment_type, amount, method, paid_at, status, source, note,
                                      recorded_by, recorded_at, verified_by, verified_at)
select c.id,
       case when c.deal_amount is not null and c.amount_received >= c.deal_amount then 'FULL' else 'PART' end,
       c.amount_received, o.payment_method, coalesce(o.started_at, c.updated_at),
       case when o.accounts_confirmed_at is not null then 'VERIFIED' else 'PENDING' end,
       'LEGACY', 'Recorded before payments were tracked individually.',
       coalesce(o.started_by, c.owner_id), coalesce(o.started_at, c.updated_at),
       case when o.accounts_confirmed_at is not null then o.accounts_confirmed_by end, o.accounts_confirmed_at
  from public.customers c
  left join public.customer_onboarding o on o.customer_id = c.id
 where c.amount_received > 0
   and not exists (select 1 from public.customer_payments p where p.customer_id = c.id);

update public.customers c set amount_verified = coalesce((
    select sum(p.amount) from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED'), 0)
 where c.amount_received > 0;
update public.customer_onboarding o set payment_verified = c.amount_verified > 0
  from public.customers c where c.id = o.customer_id and c.amount_verified > 0;

-- ---------------------------------------------------------------------------
-- 5. Existing functions, adjusted (everything else in them is unchanged)
-- ---------------------------------------------------------------------------
-- A lead that is with Accounts cannot be edited or moved by Sales.
create or replace function public.update_lead(p_id uuid, p_fields jsonb, p_services text[] default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  v_old public.customers;
  v_new public.customers;
begin
  select * into v_old from public.customers where id = p_id;
  if v_old.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_old.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This lead is with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if p_services is not null and coalesce(array_length(p_services, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Select at least one service.' using errcode = 'P0001';
  end if;

  update public.customers set
    name = case when p_fields ? 'name' then p_fields ->> 'name' else name end,
    company = case when p_fields ? 'company' then p_fields ->> 'company' else company end,
    phone = case when p_fields ? 'phone' then p_fields ->> 'phone' else phone end,
    whatsapp = case when p_fields ? 'whatsapp' then p_fields ->> 'whatsapp' else whatsapp end,
    email = case when p_fields ? 'email' then p_fields ->> 'email' else email end,
    city = case when p_fields ? 'city' then p_fields ->> 'city' else city end,
    business_category = case when p_fields ? 'businessCategory' then p_fields ->> 'businessCategory' else business_category end,
    lead_source = case when p_fields ? 'leadSource' then p_fields ->> 'leadSource' else lead_source end,
    lead_status = case when p_fields ? 'leadStatus' then p_fields ->> 'leadStatus' else lead_status end,
    next_follow_up_at = case when p_fields ? 'nextFollowUpAt' then (p_fields ->> 'nextFollowUpAt')::timestamptz else next_follow_up_at end,
    expected_budget = case when p_fields ? 'expectedBudget' then (p_fields ->> 'expectedBudget')::numeric else expected_budget end,
    notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else notes end
  where id = p_id
  returning * into v_new;
  if v_new.id is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;

  perform private.set_customer_services(p_id, p_services);
  if p_fields ? 'notes' then
    perform private.sync_lead_note(p_id, p_fields ->> 'notes');
  end if;
  if v_new.lead_status is distinct from v_old.lead_status then
    insert into public.customer_activities (customer_id, type, note)
    values (p_id, 'STATUS_' || v_new.lead_status, coalesce(nullif(p_fields ->> 'activityNote', ''),
            'Status changed to ' || initcap(replace(v_new.lead_status, '_', ' '))));
  end if;
end $$;

-- Potential: payments already on record (e.g. a lead Accounts returned) are kept, not reset to 0.
create or replace function public.move_customer_to_potential(p_id uuid, p_deal_amount numeric, p_due_date date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
begin
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be moved to Potential.' using errcode = 'P0001';
  end if;
  if v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This lead is with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if coalesce(p_deal_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the deal amount before moving to Potential.' using errcode = 'P0001';
  end if;
  if p_deal_amount <> trunc(p_deal_amount) then
    raise exception 'VALIDATION_ERROR: Enter the deal amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if p_deal_amount < v.amount_received then
    raise exception 'VALIDATION_ERROR: The deal amount cannot be less than the % already recorded.', private.rupees(v.amount_received) using errcode = 'P0001';
  end if;
  if p_due_date is null then
    raise exception 'VALIDATION_ERROR: Enter the payment due date.' using errcode = 'P0001';
  end if;
  update public.customers
     set lifecycle_stage = 'POTENTIAL', lead_status = 'READY_TO_BUY', deal_amount = p_deal_amount, payment_due_date = p_due_date
   where id = p_id;
  perform private.log_customer_activity(p_id, 'MOVED_TO_POTENTIAL',
    format('Moved to Potential · ₹%s due %s', p_deal_amount, to_char(p_due_date, 'DD Mon YYYY')));
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'LEAD', 'to', 'POTENTIAL', 'deal_amount', p_deal_amount, 'due', p_due_date));
end $$;
revoke all on function public.move_customer_to_potential(uuid, numeric, date) from public, anon;
grant execute on function public.move_customer_to_potential(uuid, numeric, date) to authenticated;

-- Sales-side payments (the existing Potential / Onboarding screens): recorded in the
-- ledger as PENDING. They count as "recorded" for Sales, but only Accounts can verify them.
create or replace function public.start_customer_onboarding(
  p_id uuid, p_amount_received numeric, p_payment_method text, p_target_handover date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  v_received numeric;
begin
  if v.lifecycle_stage <> 'POTENTIAL' then
    raise exception 'CONFLICT: Only potential customers can start onboarding.' using errcode = 'P0001';
  end if;
  if p_payment_method is null or p_payment_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Select how the customer paid.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount_received, 0) <> trunc(coalesce(p_amount_received, 0)) then
    raise exception 'VALIDATION_ERROR: Enter the amount received in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  v_received := v.amount_received + coalesce(p_amount_received, 0);
  if v_received <= 0 then
    raise exception 'VALIDATION_ERROR: Record the payment received before starting onboarding.' using errcode = 'P0001';
  end if;
  if v_received > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Amount received cannot exceed the deal amount (₹%).', v.deal_amount using errcode = 'P0001';
  end if;

  if coalesce(p_amount_received, 0) > 0 then
    insert into public.customer_payments (customer_id, payment_type, amount, method, status, source, recorded_by)
    values (p_id, case when v_received >= v.deal_amount then 'FULL' else 'PART' end, p_amount_received, p_payment_method,
            'PENDING', 'SALES', (select private.my_id()));
  end if;
  update public.customers set lifecycle_stage = 'ONBOARDING' where id = p_id;
  insert into public.customer_onboarding (customer_id, stage, payment_method, started_by, target_handover_date)
  values (p_id, 'COLLECT_REQUIREMENTS', p_payment_method, (select private.my_id()), p_target_handover)
  on conflict (customer_id) do update
    set stage = 'COLLECT_REQUIREMENTS', payment_method = excluded.payment_method,
        started_at = now(), started_by = excluded.started_by, target_handover_date = excluded.target_handover_date;
  perform private.sync_payment_totals(p_id);
  perform private.refresh_onboarding_progress(p_id);

  perform private.log_customer_activity(p_id, 'PAYMENT_CONFIRMED',
    format('Payment ₹%s recorded (%s)', v_received, replace(p_payment_method, '_', ' ')));
  perform private.log_customer_activity(p_id, 'MOVED_TO_ONBOARDING', 'Moved from Potential to Onboarding');
  perform private.write_audit('CUSTOMER_STAGE_CHANGED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('from', 'POTENTIAL', 'to', 'ONBOARDING', 'amount_received', v_received, 'method', p_payment_method));
end $$;
revoke all on function public.start_customer_onboarding(uuid, numeric, text, date) from public, anon;
grant execute on function public.start_customer_onboarding(uuid, numeric, text, date) to authenticated;

create or replace function public.record_customer_payment(p_id uuid, p_amount numeric, p_method text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
begin
  if v.lifecycle_stage not in ('POTENTIAL', 'ONBOARDING') then
    raise exception 'CONFLICT: Payments are recorded while the customer is in Potential or Onboarding.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the amount received in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if v.amount_received + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Amount received cannot exceed the deal amount (₹%).', v.deal_amount using errcode = 'P0001';
  end if;

  if v.lifecycle_stage = 'POTENTIAL' then
    -- First payment: onboarding gets started (records the payment too).
    perform public.start_customer_onboarding(p_id, p_amount, p_method, null);
    return;
  end if;

  insert into public.customer_payments (customer_id, payment_type, amount, method, status, source, recorded_by)
  values (p_id, case when v.amount_received + p_amount >= v.deal_amount then 'FULL' else 'PART' end, p_amount,
          nullif(p_method, ''), 'PENDING', 'SALES', (select private.my_id()));
  perform private.sync_payment_totals(p_id);
  perform private.log_customer_activity(p_id, 'PAYMENT_RECEIVED',
    format('₹%s recorded%s — waiting for Accounts to verify', p_amount, coalesce(' via ' || p_method, '')));
  perform private.write_audit('PAYMENT_RECORDED', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('amount', p_amount, 'method', p_method, 'total_received', v.amount_received + p_amount));
  perform private.notify_accounts('PAYMENT_TO_VERIFY', format('Verify payment: %s', coalesce(v.company, v.name)),
    format('Sales recorded %s. Please verify it.', private.rupees(p_amount)), p_id);
end $$;
revoke all on function public.record_customer_payment(uuid, numeric, text) from public, anon;
grant execute on function public.record_customer_payment(uuid, numeric, text) to authenticated;

-- The existing "confirm the amount" (onboarding-stage Send to Accounts): confirming
-- also verifies the payments Sales recorded.
create or replace function public.confirm_accounts_payment(p_customer uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can confirm payments.' using errcode = '42501';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.id is null or o.customer_id is null or o.sent_to_accounts_at is null then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if o.accounts_confirmed_at is not null then
    raise exception 'CONFLICT: This customer is already confirmed.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;

  update public.customer_payments
     set status = 'VERIFIED', verified_by = (select private.my_id()), verified_at = now()
   where customer_id = p_customer and status = 'PENDING';
  update public.customer_onboarding
     set accounts_confirmed_at = now(), accounts_confirmed_by = (select private.my_id()), accounts_note = v_note
   where customer_id = p_customer;
  perform private.sync_payment_totals(p_customer);
  update public.customers set accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id()))
   where id = p_customer and amount_verified > 0 and amount_verified < coalesce(deal_amount, 0);
  perform private.log_customer_activity(p_customer, 'ACCOUNTS_CONFIRMED',
    format('Amount confirmed by Accounts (deal ₹%s, received ₹%s)', v.deal_amount, v.amount_received) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('ACCOUNTS_CONFIRMED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('deal_amount', v.deal_amount, 'amount_received', v.amount_received, 'note', v_note));
  perform private.notify(v.owner_id, 'ACCOUNTS_CONFIRMED', format('Confirmed by Accounts: %s', coalesce(v.company, v.name)),
    'Accounts confirmed the amount. The customer went to the Technical Consultant.', 'customer', p_customer);

  perform private.forward_to_consultant(p_customer, v, false);
end $$;
revoke all on function public.confirm_accounts_payment(uuid, text) from public, anon;
grant execute on function public.confirm_accounts_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Sales: Send to Accounts
-- ---------------------------------------------------------------------------
create or replace function public.send_lead_to_accounts(p_customer uuid, p_amount numeric, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_request uuid;
begin
  if v.lifecycle_stage <> 'LEAD' then
    raise exception 'CONFLICT: Only leads can be sent to Accounts.' using errcode = 'P0001';
  end if;
  if v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' or exists (
       select 1 from public.payment_requests r where r.customer_id = p_customer and r.status = 'PENDING') then
    raise exception 'CONFLICT: This lead is already with Accounts for payment confirmation.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.customer_services s where s.customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: Select at least one service before sending to Accounts.' using errcode = 'P0001';
  end if;
  if v.phone is null and v.email is null then
    raise exception 'VALIDATION_ERROR: Add a phone number or e-mail before sending to Accounts.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the agreed amount in whole rupees (no paise).' using errcode = 'P0001';
  end if;
  if p_amount < v.amount_received then
    raise exception 'VALIDATION_ERROR: The agreed amount cannot be less than the % already recorded.', private.rupees(v.amount_received) using errcode = 'P0001';
  end if;

  insert into public.payment_requests (customer_id, agreed_amount, sales_note, requested_by)
  values (p_customer, p_amount, v_note, (select private.my_id()))
  returning id into v_request;
  update public.customers
     set payment_workflow = 'PENDING_PAYMENT_CONFIRMATION', deal_amount = p_amount, lead_status = 'READY_TO_BUY'
   where id = p_customer;
  perform private.log_customer_activity(p_customer, 'SENT_TO_ACCOUNTS',
    format('Sent to Accounts for payment confirmation (agreed %s)', private.rupees(p_amount)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('PAYMENT_SENT_TO_ACCOUNTS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', v_request, 'agreed_amount', p_amount, 'note', v_note));
  perform private.notify_accounts('PAYMENT_CONFIRMATION_REQUESTED', format('Confirm payment: %s', coalesce(v.company, v.name)),
    format('Sales sent a customer for payment confirmation (agreed %s).', private.rupees(p_amount)), p_customer);
  return v_request;
end $$;
revoke all on function public.send_lead_to_accounts(uuid, numeric, text) from public, anon;
grant execute on function public.send_lead_to_accounts(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Accounts: record / edit / verify / reject / reverse payments
-- ---------------------------------------------------------------------------
-- Loads the customer for an Accounts payment action, locked, or raises.
-- In scope: a lead with an open submission, or an onboarding customer Accounts handled.
create or replace function private.lock_customer_for_accounts(p_customer uuid)
returns public.customers language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can do this.' using errcode = '42501';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return v;
end $$;
revoke all on function private.lock_customer_for_accounts(uuid) from public, anon, authenticated;

create or replace function private.check_payment_fields(
  v public.customers, p_exclude uuid, p_type text, p_amount numeric, p_method text, p_reference text, p_paid_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_recorded numeric;
begin
  if p_type is null or p_type not in ('PART', 'FULL') then
    raise exception 'VALIDATION_ERROR: Choose part payment or full payment.' using errcode = 'P0001';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the amount received.' using errcode = 'P0001';
  end if;
  if p_amount <> trunc(p_amount) then
    raise exception 'VALIDATION_ERROR: Enter the amount in whole rupees (no paise).' using errcode = 'P0001';
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
  select coalesce(sum(amount), 0) into v_recorded from public.customer_payments
   where customer_id = v.id and status in ('PENDING', 'VERIFIED') and id is distinct from p_exclude;
  if v_recorded + p_amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: This would exceed the agreed amount. Balance still to receive: %.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'FULL' and v_recorded + p_amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: A full payment must settle the agreed amount (balance %). Record it as a part payment instead.', private.rupees(v.deal_amount - v_recorded) using errcode = 'P0001';
  end if;
  if p_type = 'PART' and v_recorded + p_amount = v.deal_amount then
    raise exception 'VALIDATION_ERROR: This payment settles the agreed amount. Record it as a full payment.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.check_payment_fields(public.customers, uuid, text, numeric, text, text, timestamptz) from public, anon, authenticated;

create or replace function public.accounts_record_payment(
  p_customer uuid, p_type text, p_amount numeric, p_method text, p_reference text default null,
  p_paid_at timestamptz default null, p_note text default null, p_verify boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 120);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_paid timestamptz := coalesce(p_paid_at, now());
  v_request uuid;
  v_id uuid;
  v_status text := case when coalesce(p_verify, false) then 'VERIFIED' else 'PENDING' end;
begin
  if v.lifecycle_stage not in ('LEAD', 'ONBOARDING', 'CUSTOMER') then
    raise exception 'CONFLICT: Payments cannot be recorded for this customer right now.' using errcode = 'P0001';
  end if;
  if v.lifecycle_stage = 'LEAD' and v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This lead is not with Accounts.' using errcode = 'P0001';
  end if;
  perform private.check_payment_fields(v, null, p_type, p_amount, p_method, v_ref, v_paid);
  select id into v_request from public.payment_requests where customer_id = p_customer and status = 'PENDING';

  begin
    insert into public.customer_payments (customer_id, request_id, payment_type, amount, method, reference, paid_at, status,
                                          source, note, recorded_by, verified_by, verified_at)
    values (p_customer, v_request, p_type, p_amount, p_method, v_ref, v_paid, v_status, 'ACCOUNTS', v_note,
            (select private.my_id()),
            case when v_status = 'VERIFIED' then (select private.my_id()) end,
            case when v_status = 'VERIFIED' then now() end)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'CONFLICT: A payment with this reference is already recorded for this customer.' using errcode = 'P0001';
  end;
  perform private.sync_payment_totals(p_customer);
  update public.customers set accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id())) where id = p_customer;
  perform private.log_customer_activity(p_customer, case when v_status = 'VERIFIED' then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end,
    format('%s %s of %s %s', case p_type when 'PART' then 'Part payment' else 'Full payment' end, case when v_status = 'VERIFIED' then 'verified' else 'recorded (pending verification)' end,
           private.rupees(p_amount), 'by Accounts'));
  perform private.write_audit(case when v_status = 'VERIFIED' then 'PAYMENT_VERIFIED' else 'PAYMENT_RECORDED' end, 'customer', p_customer,
    v.department_id, v.team_id, jsonb_build_object('payment_id', v_id, 'type', p_type, 'amount', p_amount, 'method', p_method, 'reference', v_ref));
  if v_status = 'VERIFIED' then
    perform private.notify(v.owner_id, 'PAYMENT_VERIFIED', format('Payment verified: %s', coalesce(v.company, v.name)),
      format('Accounts verified %s (%s).', private.rupees(p_amount), case p_type when 'PART' then 'part payment' else 'full payment' end), 'customer', p_customer);
  end if;
  return v_id;
end $$;
revoke all on function public.accounts_record_payment(uuid, text, numeric, text, text, timestamptz, text, boolean) from public, anon;
grant execute on function public.accounts_record_payment(uuid, text, numeric, text, text, timestamptz, text, boolean) to authenticated;

-- Edit a payment that is still pending (verified payments are never edited: reverse and re-record).
create or replace function public.accounts_update_payment(
  p_payment uuid, p_type text, p_amount numeric, p_method text, p_reference text default null,
  p_paid_at timestamptz default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v public.customers;
  v_ref text := left(nullif(btrim(coalesce(p_reference, '')), ''), 120);
  v_paid timestamptz;
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
  perform private.check_payment_fields(v, p.id, p_type, p_amount, p_method, v_ref, v_paid);
  begin
    update public.customer_payments
       set payment_type = p_type, amount = p_amount, method = p_method, reference = v_ref, paid_at = v_paid,
           note = left(nullif(btrim(coalesce(p_note, '')), ''), 1000)
     where id = p.id;
  exception when unique_violation then
    raise exception 'CONFLICT: A payment with this reference is already recorded for this customer.' using errcode = 'P0001';
  end;
  perform private.sync_payment_totals(p.customer_id);
  perform private.write_audit('PAYMENT_EDITED', 'customer', p.customer_id, v.department_id, v.team_id,
    jsonb_build_object('payment_id', p.id, 'amount', p_amount));
end $$;
revoke all on function public.accounts_update_payment(uuid, text, numeric, text, text, timestamptz, text) from public, anon;
grant execute on function public.accounts_update_payment(uuid, text, numeric, text, text, timestamptz, text) to authenticated;

create or replace function public.accounts_verify_payment(p_payment uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v public.customers;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  v := private.lock_customer_for_accounts(p.customer_id);
  if p.status <> 'PENDING' then
    raise exception 'CONFLICT: This payment is already % and cannot be verified again.', lower(p.status) using errcode = 'P0001';
  end if;
  if p.method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and p.reference is null then
    raise exception 'VALIDATION_ERROR: Add the transaction / reference number before verifying.' using errcode = 'P0001';
  end if;
  if v.amount_verified + p.amount > v.deal_amount then
    raise exception 'VALIDATION_ERROR: Verified payments would exceed the agreed amount.' using errcode = 'P0001';
  end if;
  if p.payment_type = 'FULL' and v.amount_verified + p.amount <> v.deal_amount then
    raise exception 'VALIDATION_ERROR: This is a full payment but earlier payments are not verified yet. Verify those first.' using errcode = 'P0001';
  end if;
  update public.customer_payments
     set status = 'VERIFIED', verified_by = (select private.my_id()), verified_at = now(),
         status_reason = v_note
   where id = p.id;
  perform private.sync_payment_totals(p.customer_id);
  update public.customers set accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id())) where id = p.customer_id;
  perform private.log_customer_activity(p.customer_id, 'PAYMENT_VERIFIED',
    format('%s of %s verified by Accounts', case p.payment_type when 'PART' then 'Part payment' else 'Full payment' end, private.rupees(p.amount)));
  perform private.write_audit('PAYMENT_VERIFIED', 'customer', p.customer_id, v.department_id, v.team_id,
    jsonb_build_object('payment_id', p.id, 'type', p.payment_type, 'amount', p.amount));
  perform private.notify(v.owner_id, 'PAYMENT_VERIFIED', format('Payment verified: %s', coalesce(v.company, v.name)),
    format('Accounts verified %s (%s).', private.rupees(p.amount), case p.payment_type when 'PART' then 'part payment' else 'full payment' end), 'customer', p.customer_id);
end $$;
revoke all on function public.accounts_verify_payment(uuid, text) from public, anon;
grant execute on function public.accounts_verify_payment(uuid, text) to authenticated;

create or replace function public.accounts_reject_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v public.customers;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  v := private.lock_customer_for_accounts(p.customer_id);
  if p.status <> 'PENDING' then
    raise exception 'CONFLICT: Only a pending payment can be rejected.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting this payment.' using errcode = 'P0001';
  end if;
  update public.customer_payments set status = 'REJECTED', status_reason = v_reason, verified_by = (select private.my_id()), verified_at = now()
   where id = p.id;
  perform private.sync_payment_totals(p.customer_id);
  perform private.log_customer_activity(p.customer_id, 'PAYMENT_REJECTED', format('Payment of %s rejected: %s', private.rupees(p.amount), v_reason));
  perform private.write_audit('PAYMENT_REJECTED', 'customer', p.customer_id, v.department_id, v.team_id,
    jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'reason', v_reason));
  perform private.notify(v.owner_id, 'PAYMENT_REJECTED', format('Payment rejected: %s', coalesce(v.company, v.name)), v_reason, 'customer', p.customer_id);
end $$;
revoke all on function public.accounts_reject_payment(uuid, text) from public, anon;
grant execute on function public.accounts_reject_payment(uuid, text) to authenticated;

-- A verified payment that turns out wrong (bounced cheque, refund): Accounts manager only.
create or replace function public.accounts_reverse_payment(p_payment uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.customer_payments;
  v public.customers;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
begin
  select * into p from public.customer_payments where id = p_payment for update;
  if p.id is null then
    raise exception 'NOT_FOUND: Payment not found.' using errcode = 'P0001';
  end if;
  v := private.lock_customer_for_accounts(p.customer_id);
  if not private.is_accounts_manager() then
    raise exception 'FORBIDDEN: Only an Accounts team lead or head can reverse a verified payment.' using errcode = '42501';
  end if;
  if p.status <> 'VERIFIED' then
    raise exception 'CONFLICT: Only a verified payment can be reversed.' using errcode = 'P0001';
  end if;
  if v_reason is null then
    raise exception 'VALIDATION_ERROR: Give the reason for reversing this payment.' using errcode = 'P0001';
  end if;
  update public.customer_payments set status = 'REVERSED', status_reason = v_reason where id = p.id;
  perform private.sync_payment_totals(p.customer_id);
  perform private.log_customer_activity(p.customer_id, 'PAYMENT_REVERSED', format('Verified payment of %s reversed: %s', private.rupees(p.amount), v_reason));
  perform private.write_audit('PAYMENT_REVERSED', 'customer', p.customer_id, v.department_id, v.team_id,
    jsonb_build_object('payment_id', p.id, 'amount', p.amount, 'reason', v_reason));
  perform private.notify(v.owner_id, 'PAYMENT_REVERSED', format('Payment reversed: %s', coalesce(v.company, v.name)), v_reason, 'customer', p.customer_id);
end $$;
revoke all on function public.accounts_reverse_payment(uuid, text) from public, anon;
grant execute on function public.accounts_reverse_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Accounts: confirm & return to Sales onboarding / customer backed off
-- ---------------------------------------------------------------------------
create or replace function public.accounts_confirm_and_return(p_customer uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  r public.payment_requests;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_method text;
  v_last public.customer_payments;
begin
  select * into r from public.payment_requests where customer_id = p_customer and status = 'PENDING' for update;
  if r.id is null or v.lifecycle_stage <> 'LEAD' or v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This customer is not waiting for payment confirmation.' using errcode = 'P0001';
  end if;
  if v.amount_verified <= 0 then
    raise exception 'VALIDATION_ERROR: Record and verify the payment before returning the customer to Sales.' using errcode = 'P0001';
  end if;
  select * into v_last from public.customer_payments where customer_id = p_customer and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 1;
  v_method := v_last.method;

  update public.payment_requests
     set status = 'CONFIRMED', resolved_by = (select private.my_id()), resolved_at = now(), resolution_note = v_note
   where id = r.id;
  update public.customers
     set lifecycle_stage = 'ONBOARDING', payment_workflow = 'PAYMENT_CONFIRMED',
         accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id()))
   where id = p_customer;
  insert into public.customer_onboarding (customer_id, stage, payment_method, started_by, accounts_confirmed_at, accounts_confirmed_by,
                                          accounts_note, payment_verified)
  values (p_customer, 'COLLECT_REQUIREMENTS', v_method, r.requested_by, now(), (select private.my_id()), v_note, true)
  on conflict (customer_id) do update
    set stage = 'COLLECT_REQUIREMENTS', payment_method = excluded.payment_method, started_at = now(),
        accounts_confirmed_at = now(), accounts_confirmed_by = excluded.accounts_confirmed_by,
        accounts_note = excluded.accounts_note, payment_verified = true;
  perform private.sync_payment_totals(p_customer);
  perform private.refresh_onboarding_progress(p_customer);

  perform private.log_customer_activity(p_customer, 'PAYMENT_CONFIRMED',
    format('Payment confirmed by Accounts (%s verified of %s)', private.rupees(v.amount_verified), private.rupees(v.deal_amount)) || coalesce(' · ' || v_note, ''));
  perform private.log_customer_activity(p_customer, 'MOVED_TO_ONBOARDING', 'Returned to Sales — now in Customer onboarding');
  perform private.write_audit('PAYMENT_CONFIRMED_RETURNED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', r.id, 'verified', v.amount_verified, 'agreed', v.deal_amount, 'note', v_note));
  perform private.notify(v.owner_id, 'PAYMENT_CONFIRMED', format('Payment confirmed: %s', coalesce(v.company, v.name)),
    'Accounts verified the payment. The customer is now in Customer onboarding.', 'customer', p_customer);
end $$;
revoke all on function public.accounts_confirm_and_return(uuid, text) from public, anon;
grant execute on function public.accounts_confirm_and_return(uuid, text) to authenticated;

create or replace function public.accounts_return_to_leads(p_customer uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  r public.payment_requests;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  select * into r from public.payment_requests where customer_id = p_customer and status = 'PENDING' for update;
  if r.id is null or v.lifecycle_stage <> 'LEAD' or v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This customer is not waiting for payment confirmation.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_payments where customer_id = p_customer and status = 'PENDING') then
    raise exception 'CONFLICT: Verify or reject the pending payments first, so nothing is left unaccounted for.' using errcode = 'P0001';
  end if;
  update public.payment_requests
     set status = 'RETURNED', resolved_by = (select private.my_id()), resolved_at = now(), resolution_note = v_reason
   where id = r.id;
  -- The lead, its conversations and every payment on record are kept as they are.
  update public.customers
     set payment_workflow = 'RETURNED_FROM_ACCOUNTS', lead_status = 'INTERESTED', next_follow_up_at = coalesce(next_follow_up_at, now())
   where id = p_customer;
  perform private.log_customer_activity(p_customer, 'RETURNED_FROM_ACCOUNTS',
    'Customer backed off at Accounts — returned to Leads' || coalesce(' · ' || v_reason, ''));
  perform private.write_audit('PAYMENT_RETURNED_TO_LEADS', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', r.id, 'reason', v_reason, 'verified', v.amount_verified));
  perform private.notify(v.owner_id, 'RETURNED_FROM_ACCOUNTS', format('Returned from Accounts: %s', coalesce(v.company, v.name)),
    coalesce(v_reason, 'The customer backed off. Please follow up.') ||
    case when v.amount_verified > 0 then format(' %s was already received and verified — Accounts will handle any refund.', private.rupees(v.amount_verified)) else '' end,
    'customer', p_customer);
end $$;
revoke all on function public.accounts_return_to_leads(uuid, text) from public, anon;
grant execute on function public.accounts_return_to_leads(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Accountant assignment and balance follow-ups (Accounts only)
-- ---------------------------------------------------------------------------
create or replace function public.assign_payment_owner(p_customer uuid, p_owner uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  v_me uuid := (select private.my_id());
begin
  if p_owner is not null and not exists (
       select 1 from public.profiles p join public.departments d on d.id = p.department_id
        where p.id = p_owner and p.status = 'ACTIVE' and d.slug = 'accounts') then
    raise exception 'VALIDATION_ERROR: Choose an active Accounts team member.' using errcode = 'P0001';
  end if;
  -- A team member can only take a customer for themselves (or release their own); managers assign anyone.
  if not private.is_accounts_manager() and not (p_owner is not distinct from v_me or (p_owner is null and v.accounts_owner_id = v_me)) then
    raise exception 'FORBIDDEN: Only an Accounts team lead or head can assign another accountant.' using errcode = '42501';
  end if;
  update public.customers set accounts_owner_id = p_owner where id = p_customer;
  perform private.write_audit('PAYMENT_OWNER_ASSIGNED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('accounts_owner', p_owner));
  if p_owner is not null then
    perform private.notify(p_owner, 'PAYMENT_OWNER_ASSIGNED', format('You follow up payment: %s', coalesce(v.company, v.name)),
      'You are the accountant responsible for collecting the remaining balance.', 'customer', p_customer);
  end if;
end $$;
revoke all on function public.assign_payment_owner(uuid, uuid) from public, anon;
grant execute on function public.assign_payment_owner(uuid, uuid) to authenticated;

create or replace function public.add_payment_followup(
  p_customer uuid, p_outcome text, p_note text, p_next_follow_up_at timestamptz default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id uuid;
begin
  if v.amount_verified <= 0 then
    raise exception 'CONFLICT: There is no verified payment to follow up for this customer.' using errcode = 'P0001';
  end if;
  if v.accounts_owner_id is not null and v.accounts_owner_id <> (select private.my_id()) and not private.is_accounts_manager() then
    raise exception 'FORBIDDEN: This customer is assigned to another accountant.' using errcode = '42501';
  end if;
  if p_outcome is null or p_outcome not in ('CONTACTED', 'AWAITING_PAYMENT', 'NO_RESPONSE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose the outcome of the follow-up.' using errcode = 'P0001';
  end if;
  if v_note is null then
    raise exception 'VALIDATION_ERROR: Write a note about the follow-up.' using errcode = 'P0001';
  end if;
  if length(v_note) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 2000 characters.' using errcode = 'P0001';
  end if;
  if p_next_follow_up_at is not null and p_next_follow_up_at < now() - interval '1 day' then
    raise exception 'VALIDATION_ERROR: The next follow-up date cannot be in the past.' using errcode = 'P0001';
  end if;
  insert into public.payment_followups (customer_id, outcome, note, next_follow_up_at, author_id)
  values (p_customer, p_outcome, v_note, p_next_follow_up_at, (select private.my_id()))
  returning id into v_id;
  update public.customers set accounts_owner_id = coalesce(accounts_owner_id, (select private.my_id())) where id = p_customer;
  perform private.write_audit('PAYMENT_FOLLOWUP', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('followup_id', v_id, 'outcome', p_outcome, 'next', p_next_follow_up_at));
  return v_id;
end $$;
revoke all on function public.add_payment_followup(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.add_payment_followup(uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Reads
-- ---------------------------------------------------------------------------
-- Payments, totals, the latest submission and (Accounts only) the follow-up notes for one customer.
create or replace function public.customer_payment_overview(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  v_accounts boolean := private.accounts_can_view(p_customer);
begin
  if not (v_accounts or private.can_access_customer(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  return jsonb_build_object(
    'customerId', v.id,
    'workflow', v.payment_workflow,
    'dealAmount', v.deal_amount,
    'recorded', v.amount_received,
    'verified', v.amount_verified,
    'pending', coalesce((select sum(amount) from public.customer_payments where customer_id = v.id and status = 'PENDING'), 0),
    'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0),
    'paymentStatus', v.payment_status,
    'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = v.accounts_owner_id),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'type', p.payment_type, 'amount', p.amount, 'method', p.method, 'reference', p.reference,
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

-- Accounts queue of Sales submissions.
create or replace function public.accounts_payment_requests(
  p_status text default 'PENDING', p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_items jsonb;
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see payment confirmations.' using errcode = '42501';
  end if;
  if coalesce(p_status, 'PENDING') not in ('PENDING', 'CONFIRMED', 'RETURNED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from public.payment_requests r join public.customers c on c.id = r.customer_id
   where r.status = coalesce(p_status, 'PENDING')
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%');

  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select coalesce(r.resolved_at, r.requested_at) as sort_at,
      jsonb_build_object(
        'requestId', r.id, 'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'email', c.email,
        'phone', c.phone, 'whatsapp', c.whatsapp, 'city', c.city, 'notes', c.notes,
        'salesperson', (select p.full_name from public.profiles p where p.id = c.owner_id),
        'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                                from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                               where cs.customer_id = c.id), '[]'::jsonb),
        'lastConversation', (select jsonb_build_object('note', l.note, 'at', l.occurred_at)
                               from public.lead_conversations l where l.customer_id = c.id order by l.occurred_at desc, l.created_at desc limit 1),
        'status', r.status, 'agreedAmount', r.agreed_amount, 'salesNote', r.sales_note,
        'sentAt', r.requested_at, 'sentBy', (select full_name from public.profiles where id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note,
        'amountVerified', c.amount_verified, 'amountRecorded', c.amount_received,
        'balance', greatest(r.agreed_amount - c.amount_verified, 0), 'paymentStatus', c.payment_status,
        'stage', c.lifecycle_stage) as row_json
      from public.payment_requests r join public.customers c on c.id = r.customer_id
     where r.status = coalesce(p_status, 'PENDING')
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
     order by coalesce(r.resolved_at, r.requested_at) desc
     limit v_size offset (v_page - 1) * v_size
  ) page;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.accounts_payment_requests(text, text, integer, integer) from public, anon;
grant execute on function public.accounts_payment_requests(text, text, integer, integer) to authenticated;

-- Tab / sidebar counters for Accounts.
create or replace function public.accounts_payment_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'requestsPending', (select count(*) from public.payment_requests where status = 'PENDING'),
    'onboardingPending', (select count(*) from public.customer_onboarding where sent_to_accounts_at is not null and accounts_confirmed_at is null),
    'paymentsToVerify', (select count(*) from public.customer_payments p where p.status = 'PENDING' and p.source = 'SALES'),
    'partPaymentsActive', (select count(*) from public.customers c
                            where c.payment_status = 'PARTIALLY_PAID' and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
                              and exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART')),
    'followUpsDue', (select count(*) from public.customers c
                      where c.payment_status = 'PARTIALLY_PAID' and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
                        and exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART')
                        and coalesce((select f.next_follow_up_at from public.payment_followups f where f.customer_id = c.id order by f.contacted_at desc limit 1), now()) <= now()));
end $$;
revoke all on function public.accounts_payment_counts() from public, anon;
grant execute on function public.accounts_payment_counts() to authenticated;

-- Part Payments: customers with a verified part payment. One list for both
-- departments; Sales sees only the customers it may work on and never the
-- accountant's follow-up notes.
create or replace function public.part_payments_list(
  p_status text default 'PARTIAL', p_search text default null, p_salesperson uuid default null,
  p_accounts_owner uuid default null, p_from date default null, p_to date default null,
  p_followup text default null, p_sort text default 'recent', p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_accounts boolean := private.is_accounts_staff();
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_status text := coalesce(p_status, 'PARTIAL');
  v_sort text := coalesce(p_sort, 'recent');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_items jsonb;
begin
  if v_status not in ('PARTIAL', 'PAID', 'RETURNED', 'ALL') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  if v_sort not in ('recent', 'balance', 'name', 'followUp') then
    raise exception 'VALIDATION_ERROR: Unknown sort.' using errcode = 'P0001';
  end if;
  if p_followup is not null and p_followup not in ('FOLLOW_UP_REQUIRED', 'CONTACTED', 'AWAITING_PAYMENT', 'FULLY_PAID') then
    raise exception 'VALIDATION_ERROR: Unknown follow-up status.' using errcode = 'P0001';
  end if;

  with base as (
    select c.id, c.customer_code, c.name, c.company, c.phone, c.email, c.lifecycle_stage, c.deal_amount, c.amount_verified,
           c.amount_received, c.payment_status, c.owner_id, c.accounts_owner_id,
           greatest(coalesce(c.deal_amount, 0) - c.amount_verified, 0) as balance,
           pp.last_paid_at, pp.last_amount, pp.n_verified, pp.last_verified_by, pp.pending_amount,
           f.next_at, f.last_at, f.last_outcome, f.n_followups,
           case when c.payment_status = 'FULLY_PAID' then 'FULLY_PAID'
                when f.last_outcome is null or coalesce(f.next_at, now()) <= now() or f.last_outcome = 'NO_RESPONSE' then 'FOLLOW_UP_REQUIRED'
                when f.last_outcome = 'AWAITING_PAYMENT' then 'AWAITING_PAYMENT'
                else 'CONTACTED' end as followup_status
      from public.customers c
      cross join lateral (
        select max(p.paid_at) filter (where p.status = 'VERIFIED') as last_paid_at,
               (array_agg(p.amount order by p.paid_at desc, p.recorded_at desc) filter (where p.status = 'VERIFIED'))[1] as last_amount,
               count(*) filter (where p.status = 'VERIFIED') as n_verified,
               (array_agg(p.verified_by order by p.paid_at desc, p.recorded_at desc) filter (where p.status = 'VERIFIED'))[1] as last_verified_by,
               coalesce(sum(p.amount) filter (where p.status = 'PENDING'), 0) as pending_amount,
               bool_or(p.status = 'VERIFIED' and p.payment_type = 'PART') as has_part
          from public.customer_payments p where p.customer_id = c.id) pp
      left join lateral (
        select (array_agg(f.next_follow_up_at order by f.contacted_at desc))[1] as next_at,
               max(f.contacted_at) as last_at,
               (array_agg(f.outcome order by f.contacted_at desc))[1] as last_outcome,
               count(*) as n_followups
          from public.payment_followups f where f.customer_id = c.id) f on true
     where pp.has_part
       and (v_accounts or private.can_access_customer(c.id))
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
       and (p_salesperson is null or c.owner_id = p_salesperson)
       and (p_accounts_owner is null or c.accounts_owner_id = p_accounts_owner)
       and (p_from is null or pp.last_paid_at >= p_from::timestamptz)
       and (p_to is null or pp.last_paid_at < (p_to + 1)::timestamptz)
  ), filtered as (
    select * from base b
     where case v_status
             when 'PARTIAL' then b.payment_status = 'PARTIALLY_PAID' and b.lifecycle_stage not in ('LEAD', 'LOST')
             when 'PAID' then b.payment_status = 'FULLY_PAID'
             when 'RETURNED' then b.lifecycle_stage in ('LEAD', 'LOST') and b.payment_status <> 'FULLY_PAID'
             else true end
       and (p_followup is null or not v_accounts or b.followup_status = p_followup)
  )
  select (select count(*) from filtered), coalesce(jsonb_agg(row_json order by ord), '[]'::jsonb)
    into v_total, v_items
    from (
      select row_number() over (
               order by (case when v_sort = 'recent' then f.last_paid_at end) desc nulls last,
                        (case when v_sort = 'balance' then f.balance end) desc nulls last,
                        (case when v_sort = 'name' then lower(coalesce(f.company, f.name)) end) asc,
                        (case when v_sort = 'followUp' then f.next_at end) asc nulls first,
                        f.id) as ord,
             jsonb_build_object(
               'id', f.id, 'code', f.customer_code, 'name', f.name, 'company', f.company, 'phone', f.phone, 'email', f.email,
               'stage', f.lifecycle_stage,
               'onboarding', (select jsonb_build_object('stage', o.stage, 'state', o.onboarding_state, 'getStarted', o.get_started,
                                                        'paymentVerified', o.payment_verified)
                                from public.customer_onboarding o where o.customer_id = f.id),
               'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                                       from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                                      where cs.customer_id = f.id), '[]'::jsonb),
               'dealAmount', f.deal_amount, 'amountVerified', f.amount_verified, 'pendingAmount', f.pending_amount,
               'balance', f.balance, 'paymentStatus', f.payment_status,
               'lastPaymentAt', f.last_paid_at, 'lastPaymentAmount', f.last_amount, 'verifiedPayments', f.n_verified,
               'verifiedBy', (select full_name from public.profiles where id = f.last_verified_by),
               'salesperson', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = f.owner_id),
               'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = f.accounts_owner_id),
               'followUp', case when v_accounts then jsonb_build_object(
                  'status', f.followup_status, 'lastAt', f.last_at, 'nextAt', f.next_at, 'count', f.n_followups) end) as row_json
        from (select * from filtered
               order by (case when v_sort = 'recent' then last_paid_at end) desc nulls last,
                        (case when v_sort = 'balance' then balance end) desc nulls last,
                        (case when v_sort = 'name' then lower(coalesce(company, name)) end) asc,
                        (case when v_sort = 'followUp' then next_at end) asc nulls first,
                        id
               limit v_size offset (v_page - 1) * v_size) f
    ) page;

  return jsonb_build_object('items', v_items, 'total', coalesce(v_total, 0), 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.part_payments_list(text, text, uuid, uuid, date, date, text, text, integer, integer) from public, anon;
grant execute on function public.part_payments_list(text, text, uuid, uuid, date, date, text, text, integer, integer) to authenticated;

-- Accounts team members, for the "assigned accountant" picker.
create or replace function public.accounts_team_members()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_accounts_staff() then
    raise exception 'FORBIDDEN: Only the Accounts department can see this.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name, 'role', p.role) order by p.full_name)
      from public.profiles p join public.departments d on d.id = p.department_id
     where p.status = 'ACTIVE' and d.slug = 'accounts'), '[]'::jsonb);
end $$;
revoke all on function public.accounts_team_members() from public, anon;
grant execute on function public.accounts_team_members() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Sales list counters: Leads with Accounts / returned, Get Started, Part Payments
-- ---------------------------------------------------------------------------
create or replace function public.customer_pipeline_counts()
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (
    select c.id, c.lifecycle_stage, c.lead_status, c.amount_received, c.payment_due_date, c.fully_paid, c.payment_workflow,
           c.payment_status,
           coalesce(o.items_saved, 0) as saved, coalesce(o.items_total, 0) as total,
           o.returned_at is not null as returned, coalesce(o.get_started, false) as get_started
    from public.customers c
    left join public.customer_onboarding o on o.customer_id = c.id
    where c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER')
      and private.can_access_customer(c.id)
  ), m as (select count(*) as n from public.document_types where is_mandatory)
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION'),
      'NEW', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'NEW'),
      'CONTACTED', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'CONTACTED'),
      'INTERESTED', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'INTERESTED'),
      'READY_TO_BUY', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'READY_TO_BUY'),
      'WITH_ACCOUNTS', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow = 'PENDING_PAYMENT_CONFIRMATION'),
      'RETURNED', count(*) filter (where lifecycle_stage = 'LEAD' and payment_workflow = 'RETURNED_FROM_ACCOUNTS')),
    'potential', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
      'AWAITING', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and amount_received = 0 and payment_due_date >= current_date),
      'PART_PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and amount_received > 0 and payment_due_date >= current_date),
      'OVERDUE', count(*) filter (where lifecycle_stage = 'POTENTIAL' and not fully_paid and payment_due_date < current_date),
      'PAID', count(*) filter (where lifecycle_stage = 'POTENTIAL' and fully_paid)),
    'onboarding', jsonb_build_object(
      'all', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
      'RETURNED', count(*) filter (where lifecycle_stage = 'ONBOARDING' and returned),
      'WAITING_ON_CLIENT', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and saved = 0),
      'COLLECTING', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and saved > 0 and saved < total),
      'READY_FOR_HANDOVER', count(*) filter (where lifecycle_stage = 'ONBOARDING' and not returned and total > 0 and saved >= total),
      -- Documents verified + a verified part/full payment + through Accounts (calculated by the database).
      'GET_STARTED', count(*) filter (where lifecycle_stage = 'ONBOARDING' and get_started)),
    'partPayments', count(*) filter (where lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and payment_status = 'PARTIALLY_PAID'
                      and exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART')),
    'mandatoryDocuments', (select n from m))
  from c
$$;
revoke all on function public.customer_pipeline_counts() from public, anon;
grant execute on function public.customer_pipeline_counts() to authenticated;
