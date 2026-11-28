-- Recharges, part 2: the customer and its Relationship Manager (RM), GST / Non-GST billing, and Accounts verifying that the payment really arrived.
-- (Builds on 20270228000200_support_recharges.sql, which stays as it is. Additive: no row is deleted or rewritten; safe to run twice.)
--
-- RM ATTRIBUTION. A recharge is for one of the customer's records. The Relationship Manager is read from the customer's own assignment in the database
-- (private.support_member_of: the onboarding team member, else the Support owner) at the moment the recharge is created and then FROZEN on the
-- recharge (rm_id, rm_team_id). Nothing in a request names an RM, a customer's department or an owner; the person creating the recharge does not
-- decide the RM, and a later change of the customer's RM does not move recharges already made. A trigger refuses any later change of the customer,
-- the RM, the creator, the kind or the department.
-- PERFORMANCE. Panel and Message amounts and counts are read per RM ONLY from recharges whose payment Accounts confirmed (payment_status =
-- 'PAYMENT_RECEIVED'). The figures are computed from the rows each time, so verifying twice, editing or re-opening can never count a recharge twice.
-- No incentive, Wallet or payout rule is touched: there is no recharge incentive rule in the CRM, so this adds attribution and reporting only.
-- WORKFLOW. Support submits (payment_status 'PENDING_VERIFICATION') -> Accounts checks the money and marks PAYMENT_RECEIVED, PAYMENT_NOT_RECEIVED or
-- REJECTED. A screenshot is only proof for Accounts: it never marks anything received. The Team Lead / Department Head no longer verify; Accounts do.
-- Invoice status (invoice_status) is kept apart from the payment: invoices themselves come with the next migration.
-- GST. billing_type 'GST' (taxable amount + GST amount, the customer's GST number) or 'NON_GST' (amount only, no GST). The tax rate is not assumed:
-- the GST amount is what Support entered and Accounts may correct (with a reason, audited) before an invoice exists. Total = amount + GST, always.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.support_recharges
  add column if not exists customer_id uuid references public.customers (id),
  add column if not exists customer_email text,
  add column if not exists customer_phone text,
  add column if not exists customer_address text,
  add column if not exists customer_gstin text,
  add column if not exists rm_id uuid references public.profiles (id),
  add column if not exists rm_team_id uuid references public.teams (id) on delete set null,
  add column if not exists billing_type text,
  add column if not exists recharge_amount numeric(12, 2),
  add column if not exists payment_reference text,
  add column if not exists payment_status text not null default 'PENDING_VERIFICATION',
  add column if not exists payment_note text,
  add column if not exists payment_verified_by uuid references public.profiles (id),
  add column if not exists payment_verified_at timestamptz,
  add column if not exists invoice_status text not null default 'NOT_GENERATED',
  add column if not exists submitted_at timestamptz not null default now();

-- the earlier amounts: GST amount stays; the amount before GST is what was typed as "non-GST" (the old total was GST + non-GST, so no total changes)
update public.support_recharges set recharge_amount = non_gst_amount where recharge_amount is null;
update public.support_recharges set billing_type = case when gst_amount > 0 then 'GST' else 'NON_GST' end where billing_type is null;
-- a recharge Support's lead had already marked rejected stays rejected; every other earlier recharge still waits for Accounts (nothing was verified by Accounts)
update public.support_recharges set payment_status = 'REJECTED' where status = 'REJECTED' and payment_status = 'PENDING_VERIFICATION';
-- (the earlier recharges were submitted when they were created)
update public.support_recharges set submitted_at = created_at where customer_id is null and submitted_at is distinct from created_at;

alter table public.support_recharges alter column billing_type set default 'NON_GST';
alter table public.support_recharges alter column billing_type set not null;
alter table public.support_recharges alter column recharge_amount set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_recharges_billing_ck') then
    alter table public.support_recharges add constraint support_recharges_billing_ck check (billing_type in ('GST', 'NON_GST') and recharge_amount >= 0 and recharge_amount <= 100000000
      and (billing_type = 'GST' or gst_amount = 0));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_recharges_payment_status_ck') then
    alter table public.support_recharges add constraint support_recharges_payment_status_ck
      check (payment_status in ('PENDING_VERIFICATION', 'PAYMENT_RECEIVED', 'PAYMENT_NOT_RECEIVED', 'REJECTED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_recharges_invoice_status_ck') then
    alter table public.support_recharges add constraint support_recharges_invoice_status_ck
      check (invoice_status in ('NOT_GENERATED', 'GENERATED', 'SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'support_recharges_text_ck') then
    alter table public.support_recharges add constraint support_recharges_text_ck check (
      (customer_email is null or length(customer_email) <= 254) and (customer_phone is null or length(customer_phone) <= 40) and (customer_address is null or length(customer_address) <= 500)
      and (customer_gstin is null or length(customer_gstin) = 15) and (payment_reference is null or length(payment_reference) <= 100) and (payment_note is null or length(payment_note) <= 500));
  end if;
end $$;
-- the total is the amount plus GST (the earlier check said GST + non-GST; the same numbers satisfy the new one because recharge_amount was copied from non-GST)
alter table public.support_recharges drop constraint if exists support_recharges_total_ck;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'support_recharges_total2_ck') then
    alter table public.support_recharges add constraint support_recharges_total2_ck check (total_amount = recharge_amount + gst_amount);
  end if;
end $$;

create index if not exists support_recharges_customer_idx on public.support_recharges (customer_id) where customer_id is not null;
create index if not exists support_recharges_rm_idx on public.support_recharges (rm_id, kind) where rm_id is not null;
create index if not exists support_recharges_payment_idx on public.support_recharges (payment_status, invoice_status, kind);
-- a payment (transaction) reference is used once among the recharges still in play
create unique index if not exists support_recharges_payment_ref_uq on public.support_recharges (lower(btrim(payment_reference)))
  where payment_reference is not null and payment_status <> 'REJECTED';

-- ---------------------------------------------------------------------------
-- 2. What cannot change after the recharge exists: who it is for, who gets the credit, who made it
-- ---------------------------------------------------------------------------
create or replace function private.tg_support_recharges_frozen()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind or new.created_by is distinct from old.created_by or new.department_id is distinct from old.department_id
     or (old.customer_id is not null and new.customer_id is distinct from old.customer_id)
     or (old.rm_id is not null and new.rm_id is distinct from old.rm_id)
     or (old.rm_team_id is not null and new.rm_team_id is not null and new.rm_team_id is distinct from old.rm_team_id) then
    raise exception 'FORBIDDEN: The customer, the Relationship Manager and the recorder of a recharge cannot be changed.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists support_recharges_frozen on public.support_recharges;
create trigger support_recharges_frozen before update on public.support_recharges for each row execute function private.tg_support_recharges_frozen();

-- ---------------------------------------------------------------------------
-- 3. The timeline (append-only: nothing edits or removes an event)
-- ---------------------------------------------------------------------------
create table if not exists public.support_recharge_events (
  id bigint generated always as identity primary key,
  recharge_id uuid not null references public.support_recharges (id),
  at timestamptz not null default now(),
  actor_id uuid references public.profiles (id),
  action text not null check (action in ('CREATED', 'EDITED', 'RESUBMITTED', 'BILLING_CORRECTED', 'PAYMENT_RECEIVED', 'PAYMENT_NOT_RECEIVED', 'REJECTED',
    'INVOICE_GENERATED', 'INVOICE_SENT_EMAIL', 'INVOICE_SENT_WHATSAPP', 'INVOICE_RESENT', 'INVOICE_SEND_FAILED')),
  from_status text,
  to_status text,
  note text check (note is null or length(note) <= 500),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists support_recharge_events_recharge_idx on public.support_recharge_events (recharge_id, at, id);
alter table public.support_recharge_events enable row level security;
revoke all on public.support_recharge_events from public, anon, authenticated;
create or replace function private.tg_support_recharge_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: The history of a recharge cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists support_recharge_events_append_only on public.support_recharge_events;
create trigger support_recharge_events_append_only before update or delete on public.support_recharge_events for each row execute function private.tg_support_recharge_events_append_only();

create or replace function private.recharge_event(p_recharge uuid, p_action text, p_from text, p_to text, p_note text default null, p_detail jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.support_recharge_events (recharge_id, actor_id, action, from_status, to_status, note, detail)
  values (p_recharge, auth.uid(), p_action, p_from, p_to, p_note, coalesce(p_detail, '{}'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- 4. Who is who (adds Accounts) and who sees what
-- ---------------------------------------------------------------------------
create or replace function private.recharge_role()
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    return null;
  end if;
  if me.role = 'SUPER_ADMIN' then
    return 'SUPER_ADMIN';
  end if;
  -- the Accounts department (verifies the money; sees every recharge)
  if exists (select 1 from public.departments d where d.id = me.department_id and d.slug = 'accounts') then
    return 'ACCOUNTS';
  end if;
  if me.role = 'DEPARTMENT_HEAD' then
    return case when coalesce(private.active_head_division(), 'SUPPORT') = 'SUPPORT'
                 and exists (select 1 from public.teams t where t.department_id = private.my_department_id() and t.division::text = 'SUPPORT')
                then 'HEAD' end;
  end if;
  if me.role = 'TEAM_HEAD' and private.is_support_staff() then
    return 'LEAD';
  end if;
  if me.role = 'TEAM_MEMBER' and private.is_support_staff() then
    return 'MEMBER';
  end if;
  return null;
end $$;

-- may the caller read this recharge? The RM sees recharges made for their customers (by anyone), the recorder their own, a lead the team's
-- (recorded or credited), a head the department's, Accounts and the Super Admin all.
create or replace function private.recharge_visible(r public.support_recharges)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
begin
  if v_role is null then
    return false;
  end if;
  if v_role in ('SUPER_ADMIN', 'ACCOUNTS') then
    return true;
  end if;
  if v_role = 'HEAD' then
    return r.department_id = private.my_department_id();
  end if;
  if v_role = 'LEAD' then
    return r.created_by = auth.uid() or r.rm_id = auth.uid() or (r.team_id is not null and r.team_id = private.my_team_id())
           or (r.rm_team_id is not null and r.rm_team_id = private.my_team_id());
  end if;
  return r.created_by = auth.uid() or r.rm_id = auth.uid();
end $$;

-- Support's own corrections: the recorder until Accounts has the money (or after it was sent back), a lead / head of the scope until the payment is received
create or replace function private.recharge_can_edit(r public.support_recharges)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
begin
  if v_role is null or v_role in ('SUPER_ADMIN', 'ACCOUNTS') or not private.recharge_visible(r) then
    return false;
  end if;
  if r.invoice_status <> 'NOT_GENERATED' or r.payment_status = 'PAYMENT_RECEIVED' then
    return false;
  end if;
  if r.created_by = auth.uid() then
    return true;
  end if;
  return v_role in ('LEAD', 'HEAD') and r.payment_status = 'PENDING_VERIFICATION';
end $$;

-- Accounts may correct the billing details until an invoice exists
create or replace function private.recharge_can_correct(r public.support_recharges)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.recharge_role() in ('ACCOUNTS', 'SUPER_ADMIN'), false) and r.invoice_status = 'NOT_GENERATED' and r.payment_status <> 'REJECTED'
$$;

-- the decisions Accounts may take now ('RECEIVED', 'NOT_RECEIVED', 'REJECTED')
create or replace function private.recharge_verify_actions(r public.support_recharges)
returns text[] language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(private.recharge_role() in ('ACCOUNTS', 'SUPER_ADMIN'), false) is not true then
    return '{}'::text[];
  end if;
  return case r.payment_status
    when 'PENDING_VERIFICATION' then array['RECEIVED', 'NOT_RECEIVED', 'REJECTED']
    when 'PAYMENT_NOT_RECEIVED' then array['RECEIVED', 'REJECTED']
    -- received: it can be taken back only while no invoice was made for it
    when 'PAYMENT_RECEIVED' then case when r.invoice_status = 'NOT_GENERATED' then array['NOT_RECEIVED', 'REJECTED'] else '{}'::text[] end
    else '{}'::text[]
  end;
end $$;

create or replace function private.recharge_json(r public.support_recharges)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f public.support_recharge_files;
  v_by text; v_rm text; v_team text; v_ver text;
begin
  select * into f from public.support_recharge_files where id = r.screenshot_id and status = 'READY';
  select p.full_name into v_by from public.profiles p where p.id = r.created_by;
  select p.full_name into v_rm from public.profiles p where p.id = r.rm_id;
  select p.full_name into v_ver from public.profiles p where p.id = r.payment_verified_by;
  select t.name into v_team from public.teams t where t.id = r.team_id;
  return jsonb_build_object(
    'id', r.id,
    'reference', (case r.kind when 'PANEL' then 'PRC-' else 'MRC-' end) || lpad(r.ref_no::text, 5, '0'),
    'kind', r.kind,
    'customerId', r.customer_id,
    'customerName', r.customer_name,
    'customerEmail', r.customer_email,
    'customerPhone', r.customer_phone,
    'customerAddress', r.customer_address,
    'customerGstin', r.customer_gstin,
    'rmId', r.rm_id,
    'rmName', v_rm,
    'rechargeDate', r.recharge_date,
    'billingType', r.billing_type,
    'rechargeAmount', r.recharge_amount,
    'gstAmount', r.gst_amount,
    'totalAmount', r.total_amount,
    'paymentReference', r.payment_reference,
    'remarks', r.remarks,
    'supportStatus', 'SUBMITTED',
    'submittedAt', r.submitted_at,
    'paymentStatus', r.payment_status,
    'paymentNote', r.payment_note,
    'paymentVerifiedAt', r.payment_verified_at,
    'paymentVerifiedByName', v_ver,
    'invoiceStatus', r.invoice_status,
    'createdById', r.created_by,
    'createdByName', v_by,
    'teamName', v_team,
    'createdAt', r.created_at,
    'updatedAt', r.updated_at,
    'screenshot', case when f.id is null then null
                  else jsonb_build_object('id', f.id, 'name', f.file_name, 'mime', f.mime_type, 'size', f.size_bytes) end,
    'canEdit', private.recharge_can_edit(r),
    'canCorrect', private.recharge_can_correct(r),
    'verifyActions', to_jsonb(private.recharge_verify_actions(r))
  );
end $$;

-- ---------------------------------------------------------------------------
-- 5. The customer and its RM, from the database
-- ---------------------------------------------------------------------------
-- the billing address the way the invoice form fills it in: what onboarding collected, else the customer record
create or replace function private.recharge_customer_address(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(e.value), '') from public.customer_onboarding_entries e
      where e.customer_id = p_customer and e.item_code = 'BUSINESS_ADDRESS' and e.status in ('SAVED', 'VERIFIED') limit 1),
    (select nullif(btrim(c.address), '') from public.customers c where c.id = p_customer))
$$;

-- the last GST number known for the customer: an earlier recharge, else an earlier invoice
create or replace function private.recharge_last_gstin(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.customer_gstin from public.support_recharges r where r.customer_id = p_customer and r.customer_gstin is not null order by r.created_at desc limit 1),
    (select g.customer_gstin from public.generated_invoices g where g.customer_id = p_customer and g.customer_gstin is not null order by g.issued_at desc limit 1))
$$;

create or replace function private.recharge_customer_json(c public.customers)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rm uuid := private.support_member_of(c.id);
begin
  return jsonb_build_object(
    'id', c.id, 'name', c.name, 'company', c.company, 'email', c.email, 'phone', c.phone,
    'address', private.recharge_customer_address(c.id), 'gstin', private.recharge_last_gstin(c.id),
    'rmId', v_rm, 'rmName', (select p.full_name from public.profiles p where p.id = v_rm));
end $$;

-- the customers the caller may record a recharge for (search by name, company, e-mail or phone)
create or replace function public.recharge_customers(p_search text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_out jsonb;
begin
  if coalesce(private.recharge_role() in ('MEMBER', 'LEAD', 'HEAD'), false) is not true then
    raise exception 'FORBIDDEN: Recharges are recorded by the Support team.' using errcode = '42501';
  end if;
  if v_search is not null then
    v_search := '%' || replace(replace(replace(left(v_search, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  select coalesce(jsonb_agg(private.recharge_customer_json(x) order by x.name), '[]'::jsonb) into v_out
    from (select c.* from public.customers c
           where c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and private.can_view_customer(c.id)
             and (v_search is null or c.name ilike v_search escape '\' or coalesce(c.company, '') ilike v_search escape '\' or coalesce(c.email, '') ilike v_search escape '\'
                  or coalesce(c.phone, '') ilike v_search escape '\')
           order by c.name limit 25) x;
  return v_out;
end $$;

create or replace function public.recharge_customer_context(p_customer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
begin
  if coalesce(private.recharge_role() in ('MEMBER', 'LEAD', 'HEAD'), false) is not true then
    raise exception 'FORBIDDEN: Recharges are recorded by the Support team.' using errcode = '42501';
  end if;
  select * into c from public.customers where id = p_customer and lifecycle_stage in ('ONBOARDING', 'CUSTOMER');
  if c.id is null or not private.can_view_customer(c.id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return private.recharge_customer_json(c);
end $$;

-- ---------------------------------------------------------------------------
-- 6. The money, the GST and the text of a request (checked once for create, update and Accounts' correction)
-- ---------------------------------------------------------------------------
create or replace function private.recharge_clean2(p jsonb, p_gstin_default text default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_type text := upper(btrim(coalesce(p ->> 'billingType', '')));
  v_date date;
  v_amt numeric;
  v_gst numeric;
  v_total numeric;
  v_gstin text := nullif(upper(regexp_replace(coalesce(p ->> 'gstNumber', ''), '\s', '', 'g')), '');
  v_ref text := nullif(btrim(coalesce(p ->> 'paymentReference', '')), '');
  v_rem text := nullif(btrim(coalesce(p ->> 'remarks', '')), '');
begin
  if v_type not in ('GST', 'NON_GST') then
    raise exception 'VALIDATION_ERROR: Choose GST or Non-GST.' using errcode = 'P0001';
  end if;
  if p ? 'rechargeDate' then
    begin
      v_date := (p ->> 'rechargeDate')::date;
    exception when others then
      v_date := null;
    end;
    if v_date is null then
      raise exception 'VALIDATION_ERROR: Enter the recharge date.' using errcode = 'P0001';
    end if;
    if v_date > (now() at time zone 'Asia/Kolkata')::date + 1 or v_date < date '2020-01-01' then
      raise exception 'VALIDATION_ERROR: The recharge date is not valid (it cannot be in the future).' using errcode = 'P0001';
    end if;
  end if;
  begin
    v_amt := nullif(btrim(p ->> 'rechargeAmount'), '')::numeric;
    v_gst := coalesce(nullif(btrim(p ->> 'gstAmount'), '')::numeric, 0);
    v_total := nullif(btrim(p ->> 'totalAmount'), '')::numeric;
  exception when others then
    raise exception 'VALIDATION_ERROR: Amounts must be numbers.' using errcode = 'P0001';
  end;
  if v_amt is null or v_amt <= 0 then
    raise exception 'VALIDATION_ERROR: Enter the recharge amount (above zero).' using errcode = 'P0001';
  end if;
  if v_amt > 100000000 or v_gst < 0 or v_gst > 100000000 then
    raise exception 'VALIDATION_ERROR: Amounts cannot be negative or more than 10 crore.' using errcode = 'P0001';
  end if;
  if v_amt <> round(v_amt, 2) or v_gst <> round(v_gst, 2) then
    raise exception 'VALIDATION_ERROR: Amounts can have at most 2 decimal places.' using errcode = 'P0001';
  end if;
  if v_type = 'NON_GST' then
    if v_gst <> 0 then
      raise exception 'VALIDATION_ERROR: A Non-GST recharge has no GST amount.' using errcode = 'P0001';
    end if;
    v_gstin := null;
  else
    if v_gst > v_amt then
      raise exception 'VALIDATION_ERROR: The GST amount cannot be more than the recharge amount.' using errcode = 'P0001';
    end if;
    v_gstin := coalesce(v_gstin, upper(p_gstin_default));
    if v_gstin is null or not private.valid_gstin(v_gstin) then
      raise exception 'VALIDATION_ERROR: Enter the customer''s valid 15-character GST number for a GST recharge.' using errcode = 'P0001';
    end if;
  end if;
  if v_total is not null and v_total <> v_amt + v_gst then
    raise exception 'VALIDATION_ERROR: The total must equal the recharge amount plus the GST amount.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_ref, '')) > 100 then
    raise exception 'VALIDATION_ERROR: The payment reference can be at most 100 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_rem, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: Remarks can be at most 1000 characters.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('type', v_type, 'date', v_date, 'amount', v_amt, 'gst', v_gst, 'gstin', v_gstin, 'ref', v_ref, 'rem', v_rem);
end $$;

-- a payment reference may be used once among the recharges still in play
create or replace function private.recharge_check_reference(p_ref text, p_except uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_other text;
begin
  if p_ref is null then
    return;
  end if;
  select (case x.kind when 'PANEL' then 'PRC-' else 'MRC-' end) || lpad(x.ref_no::text, 5, '0') into v_other
    from public.support_recharges x
   where lower(btrim(x.payment_reference)) = lower(btrim(p_ref)) and x.payment_status <> 'REJECTED' and x.id is distinct from p_except limit 1;
  if v_other is not null then
    raise exception 'CONFLICT: This payment reference was already used for recharge %.', v_other using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Notifications
-- ---------------------------------------------------------------------------
create or replace function private.recharge_notify_accounts(r public.support_recharges, p_type text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_to uuid;
begin
  for v_to in select p.id from public.profiles p join public.departments d on d.id = p.department_id
               where d.slug = 'accounts' and p.status = 'ACTIVE' and p.id is distinct from auth.uid() loop
    perform private.notify(v_to, p_type, p_title, p_body, 'support_recharge', r.id);
  end loop;
end $$;

create or replace function private.recharge_notify_support(r public.support_recharges, p_type text, p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_to uuid;
begin
  for v_to in select distinct x from unnest(array[r.created_by, r.rm_id]) x where x is not null and x is distinct from auth.uid() loop
    perform private.notify(v_to, p_type, p_title, p_body, 'support_recharge', r.id);
  end loop;
end $$;

create or replace function private.recharge_label(r public.support_recharges)
returns text language sql stable set search_path = '' as $$
  select (case r.kind when 'PANEL' then 'Panel recharge ' else 'Message recharge ' end) || (case r.kind when 'PANEL' then 'PRC-' else 'MRC-' end) || lpad(r.ref_no::text, 5, '0')
         || ' · ' || r.customer_name
$$;

-- ---------------------------------------------------------------------------
-- 8. Create, update, Accounts' correction, Accounts' verification
-- ---------------------------------------------------------------------------
drop function if exists public.recharge_list(text, text, text, date, date, numeric, numeric, integer, integer);

create or replace function public.recharge_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_role text := private.recharge_role();
  v_kind text := upper(btrim(coalesce(p ->> 'kind', '')));
  v_req uuid := private.try_uuid(p ->> 'requestId');
  v_file uuid := private.try_uuid(p ->> 'screenshotId');
  v_customer uuid := private.try_uuid(p ->> 'customerId');
  c public.customers;
  v_rm uuid;
  v_clean jsonb;
  r public.support_recharges;
begin
  if v_role is null or v_role in ('SUPER_ADMIN', 'ACCOUNTS') then
    raise exception 'FORBIDDEN: Recharges are recorded by the Support team.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if me.department_id is null then
    raise exception 'FORBIDDEN: Your profile has no department.' using errcode = '42501';
  end if;
  if v_kind not in ('PANEL', 'MESSAGE') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  -- a double click or a retry returns the record already saved
  if v_req is not null then
    select * into r from public.support_recharges where created_by = me.id and client_request_id = v_req;
    if r.id is not null then
      return private.recharge_json(r);
    end if;
  end if;
  if v_customer is null then
    raise exception 'VALIDATION_ERROR: Choose the customer.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer and lifecycle_stage in ('ONBOARDING', 'CUSTOMER');
  if c.id is null or not private.can_view_customer(c.id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  -- the Relationship Manager is the customer's own assignment, never the person recording the recharge and never a value from the request
  v_rm := private.support_member_of(c.id);
  if v_rm is null then
    raise exception 'CONFLICT: This customer has no Relationship Manager yet. Ask your Team Lead to assign one before recording a recharge.' using errcode = 'P0001';
  end if;
  v_clean := private.recharge_clean2(p, private.recharge_last_gstin(c.id));
  if v_file is null then
    raise exception 'VALIDATION_ERROR: Upload the screenshot of the payment.' using errcode = 'P0001';
  end if;
  perform private.recharge_check_reference(v_clean ->> 'ref', null);
  perform private.recharge_take_file(v_file);
  insert into public.support_recharges (kind, department_id, team_id, created_by, client_request_id, customer_id, customer_name, customer_email, customer_phone, customer_address,
      customer_gstin, rm_id, rm_team_id, billing_type, recharge_amount, gst_amount, non_gst_amount, total_amount, recharge_date, payment_reference, remarks, screenshot_id, updated_by)
  values (v_kind, coalesce(private.my_department_id(), me.department_id), me.team_id, me.id, v_req, c.id, coalesce(nullif(btrim(c.company), ''), c.name), c.email, c.phone,
      private.recharge_customer_address(c.id), v_clean ->> 'gstin', v_rm, (select p2.team_id from public.profiles p2 where p2.id = v_rm), v_clean ->> 'type',
      (v_clean ->> 'amount')::numeric, (v_clean ->> 'gst')::numeric, case when v_clean ->> 'type' = 'NON_GST' then (v_clean ->> 'amount')::numeric else 0 end,
      (v_clean ->> 'amount')::numeric + (v_clean ->> 'gst')::numeric, (v_clean ->> 'date')::date, v_clean ->> 'ref', v_clean ->> 'rem', v_file, me.id)
  returning * into r;
  update public.support_recharge_files set recharge_id = r.id where id = v_file;
  perform private.recharge_event(r.id, 'CREATED', null, r.payment_status, null, jsonb_build_object('kind', r.kind, 'total', r.total_amount, 'billing', r.billing_type, 'rm', r.rm_id));
  perform private.write_audit('SUPPORT_RECHARGE_CREATED', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'total', r.total_amount, 'billing', r.billing_type, 'rm_id', r.rm_id, 'customer_id', r.customer_id, 'recharge_date', r.recharge_date));
  perform private.write_audit('SUPPORT_RECHARGE_SUBMITTED', 'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('to', 'ACCOUNTS'));
  perform private.recharge_notify_accounts(r, 'RECHARGE_SUBMITTED', 'Recharge to verify', format('%s (%s) was submitted for payment verification.', private.recharge_label(r), private.rupees(r.total_amount)));
  return private.recharge_json(r);
end $$;

create or replace function public.recharge_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  v_clean jsonb;
  v_file uuid := private.try_uuid(p ->> 'screenshotId');
  v_from text;
  v_to text;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_id for update;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  if not private.recharge_can_edit(r) then
    raise exception 'FORBIDDEN: This recharge can no longer be edited by you.' using errcode = '42501';
  end if;
  v_clean := private.recharge_clean2(p, r.customer_gstin);
  perform private.recharge_check_reference(v_clean ->> 'ref', r.id);
  if v_file is not null and v_file is distinct from r.screenshot_id then
    perform private.recharge_take_file(v_file);
    update public.support_recharge_files set recharge_id = r.id where id = v_file;
  else
    v_file := r.screenshot_id;
  end if;
  v_from := r.payment_status;
  -- the recorder correcting a recharge Accounts sent back submits it again
  v_to := case when r.payment_status in ('PAYMENT_NOT_RECEIVED', 'REJECTED') and r.created_by = auth.uid() then 'PENDING_VERIFICATION' else r.payment_status end;
  update public.support_recharges set
    recharge_date = coalesce((v_clean ->> 'date')::date, recharge_date), billing_type = v_clean ->> 'type', recharge_amount = (v_clean ->> 'amount')::numeric,
    gst_amount = (v_clean ->> 'gst')::numeric, non_gst_amount = case when v_clean ->> 'type' = 'NON_GST' then (v_clean ->> 'amount')::numeric else 0 end,
    total_amount = (v_clean ->> 'amount')::numeric + (v_clean ->> 'gst')::numeric, customer_gstin = v_clean ->> 'gstin', payment_reference = v_clean ->> 'ref',
    remarks = v_clean ->> 'rem', screenshot_id = v_file, payment_status = v_to,
    payment_note = case when v_to <> v_from then null else payment_note end, payment_verified_by = case when v_to <> v_from then null else payment_verified_by end,
    payment_verified_at = case when v_to <> v_from then null else payment_verified_at end, submitted_at = case when v_to <> v_from then now() else submitted_at end,
    updated_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  perform private.recharge_event(r.id, case when v_to <> v_from then 'RESUBMITTED' else 'EDITED' end, v_from, v_to, null,
    jsonb_build_object('total', r.total_amount, 'billing', r.billing_type));
  perform private.write_audit('SUPPORT_RECHARGE_UPDATED', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'total', r.total_amount, 'payment_status', r.payment_status));
  if v_to <> v_from then
    perform private.write_audit('SUPPORT_RECHARGE_SUBMITTED', 'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('to', 'ACCOUNTS', 'resubmitted', true));
    perform private.recharge_notify_accounts(r, 'RECHARGE_SUBMITTED', 'Recharge to verify again', format('%s (%s) was corrected and submitted again.', private.recharge_label(r), private.rupees(r.total_amount)));
  end if;
  return private.recharge_json(r);
end $$;

-- Accounts corrects the billing details (a reason is required; the before and after are kept) until an invoice exists
create or replace function public.recharge_accounts_correct(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  o public.support_recharges;
  v_clean jsonb;
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_email text := case when p ? 'customerEmail' then nullif(lower(btrim(coalesce(p ->> 'customerEmail', ''))), '') else null end;
  v_phone text := case when p ? 'customerPhone' then nullif(btrim(coalesce(p ->> 'customerPhone', '')), '') else null end;
  v_address text := case when p ? 'customerAddress' then nullif(btrim(coalesce(p ->> 'customerAddress', '')), '') else null end;
begin
  perform private.require_accounts_staff();
  select * into r from public.support_recharges where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  if not private.recharge_can_correct(r) then
    raise exception 'CONFLICT: The billing details can no longer be corrected (an invoice exists, or the recharge was rejected).' using errcode = 'P0001';
  end if;
  if length(coalesce(v_note, '')) < 3 then
    raise exception 'VALIDATION_ERROR: Say what was corrected and why.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: The customer''s e-mail address is not valid.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_phone, '')) > 40 or length(coalesce(v_address, '')) > 500 then
    raise exception 'VALIDATION_ERROR: The phone number or the address is too long.' using errcode = 'P0001';
  end if;
  o := r;
  v_clean := private.recharge_clean2(jsonb_build_object('billingType', coalesce(p ->> 'billingType', r.billing_type), 'rechargeAmount', coalesce(p ->> 'rechargeAmount', r.recharge_amount::text),
    'gstAmount', coalesce(p ->> 'gstAmount', r.gst_amount::text), 'gstNumber', coalesce(p ->> 'gstNumber', r.customer_gstin), 'paymentReference', case when p ? 'paymentReference' then p ->> 'paymentReference' else r.payment_reference end,
    'remarks', r.remarks), r.customer_gstin);
  perform private.recharge_check_reference(v_clean ->> 'ref', r.id);
  update public.support_recharges set
    billing_type = v_clean ->> 'type', recharge_amount = (v_clean ->> 'amount')::numeric, gst_amount = (v_clean ->> 'gst')::numeric,
    non_gst_amount = case when v_clean ->> 'type' = 'NON_GST' then (v_clean ->> 'amount')::numeric else 0 end, total_amount = (v_clean ->> 'amount')::numeric + (v_clean ->> 'gst')::numeric,
    customer_gstin = v_clean ->> 'gstin', payment_reference = v_clean ->> 'ref', customer_email = case when p ? 'customerEmail' then v_email else customer_email end,
    customer_phone = case when p ? 'customerPhone' then v_phone else customer_phone end, customer_address = case when p ? 'customerAddress' then v_address else customer_address end,
    updated_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  perform private.recharge_event(r.id, 'BILLING_CORRECTED', r.payment_status, r.payment_status, v_note,
    jsonb_build_object('before', jsonb_build_object('billing', o.billing_type, 'amount', o.recharge_amount, 'gst', o.gst_amount, 'total', o.total_amount, 'gstin', o.customer_gstin, 'email', o.customer_email),
                       'after', jsonb_build_object('billing', r.billing_type, 'amount', r.recharge_amount, 'gst', r.gst_amount, 'total', r.total_amount, 'gstin', r.customer_gstin, 'email', r.customer_email)));
  perform private.write_audit('SUPPORT_RECHARGE_BILLING_CORRECTED', 'support_recharge', r.id, r.department_id, r.team_id,
    jsonb_build_object('from_total', o.total_amount, 'to_total', r.total_amount, 'billing', r.billing_type));
  return private.recharge_json(r);
end $$;

-- Accounts: the money arrived / did not arrive / the recharge is rejected. Repeating a decision changes nothing (no second event, no second count).
create or replace function public.recharge_verify_payment(p_id uuid, p_decision text, p_note text default null, p_received_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  v_dec text := upper(btrim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_to text;
  v_action text;
  v_from text;
begin
  perform private.require_accounts_staff();
  if v_dec not in ('RECEIVED', 'NOT_RECEIVED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose Payment received, Payment not received or Reject.' using errcode = 'P0001';
  end if;
  v_to := case v_dec when 'RECEIVED' then 'PAYMENT_RECEIVED' when 'NOT_RECEIVED' then 'PAYMENT_NOT_RECEIVED' else 'REJECTED' end;
  select * into r from public.support_recharges where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  -- the same decision again: nothing to do
  if r.payment_status = v_to then
    return private.recharge_json(r) || jsonb_build_object('replayed', true);
  end if;
  if not (v_dec = any (private.recharge_verify_actions(r))) then
    if r.invoice_status <> 'NOT_GENERATED' then
      raise exception 'CONFLICT: An invoice already exists for this recharge, so its payment status can no longer be changed.' using errcode = 'P0001';
    end if;
    raise exception 'CONFLICT: This recharge cannot be moved from % to %.', r.payment_status, v_to using errcode = 'P0001';
  end if;
  if v_dec in ('NOT_RECEIVED', 'REJECTED') and length(coalesce(v_note, '')) < 3 then
    raise exception 'VALIDATION_ERROR: Say why (a short note is required).' using errcode = 'P0001';
  end if;
  if length(coalesce(v_note, '')) > 500 then
    raise exception 'VALIDATION_ERROR: The note can be at most 500 characters.' using errcode = 'P0001';
  end if;
  if v_dec = 'RECEIVED' then
    if r.customer_id is null or r.rm_id is null then
      raise exception 'CONFLICT: This recharge has no customer / Relationship Manager recorded (it was made before they were tracked). Reject it and ask Support to record it again.' using errcode = 'P0001';
    end if;
    -- the amount Accounts saw arrive must be the recharge's total (the screenshot proves nothing by itself)
    if p_received_amount is not null and p_received_amount <> r.total_amount then
      raise exception 'VALIDATION_ERROR: The amount received (%) is not the recharge total (%). Correct the billing details first, or mark the payment as not received.',
        p_received_amount, r.total_amount using errcode = 'P0001';
    end if;
  end if;
  v_from := r.payment_status;
  update public.support_recharges set payment_status = v_to, payment_note = v_note, payment_verified_by = auth.uid(), payment_verified_at = now(), updated_by = auth.uid(), updated_at = now()
   where id = r.id returning * into r;
  v_action := case v_dec when 'RECEIVED' then 'PAYMENT_RECEIVED' when 'NOT_RECEIVED' then 'PAYMENT_NOT_RECEIVED' else 'REJECTED' end;
  perform private.recharge_event(r.id, v_action, v_from, v_to, v_note, jsonb_build_object('total', r.total_amount, 'rm', r.rm_id));
  perform private.write_audit(case v_dec when 'RECEIVED' then 'SUPPORT_RECHARGE_PAYMENT_VERIFIED' when 'NOT_RECEIVED' then 'SUPPORT_RECHARGE_PAYMENT_NOT_RECEIVED' else 'SUPPORT_RECHARGE_REJECTED' end,
    'support_recharge', r.id, r.department_id, r.team_id, jsonb_build_object('kind', r.kind, 'from', v_from, 'to', v_to, 'total', r.total_amount, 'rm_id', r.rm_id));
  perform private.recharge_notify_support(r, case v_dec when 'RECEIVED' then 'RECHARGE_PAYMENT_RECEIVED' when 'NOT_RECEIVED' then 'RECHARGE_PAYMENT_NOT_RECEIVED' else 'RECHARGE_REJECTED' end,
    case v_dec when 'RECEIVED' then 'Recharge payment confirmed' when 'NOT_RECEIVED' then 'Recharge payment not received' else 'Recharge rejected' end,
    format('%s: %s%s', private.recharge_label(r), case v_dec when 'RECEIVED' then 'Accounts confirmed the payment.' when 'NOT_RECEIVED' then 'Accounts did not receive the payment.' else 'Accounts rejected it.' end,
           case when v_note is not null then ' ' || v_note else '' end));
  return private.recharge_json(r) || jsonb_build_object('replayed', false);
end $$;

-- the old Team Lead / Head status change is gone: Accounts verify the payment
create or replace function public.recharge_set_status(p_id uuid, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: The payment of a recharge is verified by Accounts.' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- 9. Read: list (Support's tracking and Accounts' verification queue), one record with its timeline, RM performance
-- ---------------------------------------------------------------------------
create or replace function public.recharge_list(
  p_kind text default null, p_search text default null, p_payment_status text default null, p_invoice_status text default null, p_from date default null, p_to date default null,
  p_min numeric default null, p_max numeric default null, p_rm uuid default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.recharge_role();
  v_kind text := nullif(upper(btrim(coalesce(p_kind, ''))), '');
  v_pay text := nullif(upper(btrim(coalesce(p_payment_status, ''))), '');
  v_inv text := nullif(upper(btrim(coalesce(p_invoice_status, ''))), '');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_items jsonb;
  v_sum jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team and Accounts.' using errcode = '42501';
  end if;
  -- Support works one kind at a time; Accounts and the Super Admin may look at both
  if v_kind is null and v_role not in ('ACCOUNTS', 'SUPER_ADMIN') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  if v_kind is not null and v_kind not in ('PANEL', 'MESSAGE') then
    raise exception 'VALIDATION_ERROR: Choose Panel Recharge or Message Recharge.' using errcode = 'P0001';
  end if;
  if v_pay is not null and v_pay not in ('PENDING_VERIFICATION', 'PAYMENT_RECEIVED', 'PAYMENT_NOT_RECEIVED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose a valid payment status.' using errcode = 'P0001';
  end if;
  -- 'GENERATED_ANY' = an invoice exists (whatever its delivery state)
  if v_inv is not null and v_inv not in ('NOT_GENERATED', 'GENERATED', 'SENT', 'EMAIL_SENT', 'WHATSAPP_SENT', 'PARTIALLY_SENT', 'FAILED', 'GENERATED_ANY') then
    raise exception 'VALIDATION_ERROR: Choose a valid invoice status.' using errcode = 'P0001';
  end if;
  if v_search is not null then
    v_search := '%' || replace(replace(replace(left(v_search, 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with scoped as (
    select r.* from public.support_recharges r
     where (v_kind is null or r.kind = v_kind) and private.recharge_visible(r)
       and (v_search is null or r.customer_name ilike v_search escape '\' or coalesce(r.payment_reference, '') ilike v_search escape '\' or coalesce(r.customer_email, '') ilike v_search escape '\')
       and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
       and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
       and (p_rm is null or r.rm_id = p_rm)
  )
  select jsonb_build_object(
           'totalRecharges', count(*), 'totalAmount', coalesce(sum(total_amount), 0), 'totalGst', coalesce(sum(gst_amount), 0),
           'totalNonGst', coalesce(sum(recharge_amount) filter (where billing_type = 'NON_GST'), 0),
           'pending', count(*) filter (where payment_status = 'PENDING_VERIFICATION'), 'pendingAmount', coalesce(sum(total_amount) filter (where payment_status = 'PENDING_VERIFICATION'), 0),
           'received', count(*) filter (where payment_status = 'PAYMENT_RECEIVED'), 'receivedAmount', coalesce(sum(total_amount) filter (where payment_status = 'PAYMENT_RECEIVED'), 0),
           'notReceived', count(*) filter (where payment_status = 'PAYMENT_NOT_RECEIVED'), 'rejected', count(*) filter (where payment_status = 'REJECTED'),
           'readyForInvoice', count(*) filter (where payment_status = 'PAYMENT_RECEIVED' and invoice_status = 'NOT_GENERATED'),
           'invoiced', count(*) filter (where invoice_status <> 'NOT_GENERATED'),
           'deliveryFailed', count(*) filter (where invoice_status = 'FAILED'))
    into v_sum from scoped;

  select count(*) into v_total from public.support_recharges r
   where (v_kind is null or r.kind = v_kind) and private.recharge_visible(r)
     and (v_pay is null or r.payment_status = v_pay)
     and (v_inv is null or (v_inv = 'GENERATED_ANY' and r.invoice_status <> 'NOT_GENERATED') or r.invoice_status = v_inv)
     and (v_search is null or r.customer_name ilike v_search escape '\' or coalesce(r.payment_reference, '') ilike v_search escape '\' or coalesce(r.customer_email, '') ilike v_search escape '\')
     and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
     and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
     and (p_rm is null or r.rm_id = p_rm);

  select coalesce(jsonb_agg(private.recharge_json(x) order by x.submitted_at desc, x.created_at desc), '[]'::jsonb) into v_items
    from (select r.* from public.support_recharges r
           where (v_kind is null or r.kind = v_kind) and private.recharge_visible(r)
             and (v_pay is null or r.payment_status = v_pay)
             and (v_inv is null or (v_inv = 'GENERATED_ANY' and r.invoice_status <> 'NOT_GENERATED') or r.invoice_status = v_inv)
             and (v_search is null or r.customer_name ilike v_search escape '\' or coalesce(r.payment_reference, '') ilike v_search escape '\' or coalesce(r.customer_email, '') ilike v_search escape '\')
             and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
             and (p_min is null or r.total_amount >= p_min) and (p_max is null or r.total_amount <= p_max)
             and (p_rm is null or r.rm_id = p_rm)
           order by r.submitted_at desc, r.created_at desc limit v_limit offset v_offset) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'limit', v_limit, 'offset', v_offset, 'summary', v_sum, 'role', v_role,
                            'canCreate', v_role in ('MEMBER', 'LEAD', 'HEAD'), 'isAccounts', v_role in ('ACCOUNTS', 'SUPER_ADMIN'));
end $$;

create or replace function public.recharge_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.support_recharges;
  v_timeline jsonb;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team and Accounts.' using errcode = '42501';
  end if;
  select * into r from public.support_recharges where id = p_id;
  if r.id is null or not private.recharge_visible(r) then
    raise exception 'NOT_FOUND: Recharge not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'from', e.from_status, 'to', e.to_status, 'note', e.note,
                                               'actorName', (select p.full_name from public.profiles p where p.id = e.actor_id)) order by e.at, e.id), '[]'::jsonb)
    into v_timeline from public.support_recharge_events e where e.recharge_id = r.id;
  return private.recharge_json(r) || jsonb_build_object('timeline', v_timeline);
end $$;

-- Verified Panel and Message recharges per Relationship Manager (only payments Accounts confirmed are counted; pending money is shown apart, never added)
create or replace function public.recharge_rm_performance(p_from date default null, p_to date default null, p_rm uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_out jsonb;
begin
  if private.recharge_role() is null then
    raise exception 'FORBIDDEN: Recharges are for the Support team and Accounts.' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t."totalAmount" desc, t."rmName"), '[]'::jsonb) into v_out from (
    select r.rm_id as "rmId", coalesce((select p.full_name from public.profiles p where p.id = r.rm_id), 'Unknown') as "rmName",
           coalesce(sum(r.total_amount) filter (where r.payment_status = 'PAYMENT_RECEIVED' and r.kind = 'PANEL'), 0) as "panelAmount",
           coalesce(sum(r.total_amount) filter (where r.payment_status = 'PAYMENT_RECEIVED' and r.kind = 'MESSAGE'), 0) as "messageAmount",
           coalesce(sum(r.total_amount) filter (where r.payment_status = 'PAYMENT_RECEIVED'), 0) as "totalAmount",
           count(*) filter (where r.payment_status = 'PAYMENT_RECEIVED' and r.kind = 'PANEL') as "panelCount",
           count(*) filter (where r.payment_status = 'PAYMENT_RECEIVED' and r.kind = 'MESSAGE') as "messageCount",
           count(*) filter (where r.payment_status = 'PAYMENT_RECEIVED') as "totalCount",
           coalesce(sum(r.total_amount) filter (where r.payment_status = 'PENDING_VERIFICATION'), 0) as "pendingAmount",
           count(*) filter (where r.payment_status = 'PENDING_VERIFICATION') as "pendingCount"
      from public.support_recharges r
     where r.rm_id is not null and private.recharge_visible(r) and (p_rm is null or r.rm_id = p_rm)
       and (p_from is null or r.recharge_date >= p_from) and (p_to is null or r.recharge_date <= p_to)
     group by r.rm_id) t;
  return v_out;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['private.tg_support_recharges_frozen()', 'private.tg_support_recharge_events_append_only()',
    'private.recharge_event(uuid, text, text, text, text, jsonb)', 'private.recharge_can_correct(public.support_recharges)',
    'private.recharge_verify_actions(public.support_recharges)', 'private.recharge_customer_address(uuid)', 'private.recharge_last_gstin(uuid)',
    'private.recharge_customer_json(public.customers)', 'private.recharge_clean2(jsonb, text)', 'private.recharge_check_reference(text, uuid)',
    'private.recharge_notify_accounts(public.support_recharges, text, text, text)', 'private.recharge_notify_support(public.support_recharges, text, text, text)',
    'private.recharge_label(public.support_recharges)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['public.recharge_customers(text)', 'public.recharge_customer_context(uuid)', 'public.recharge_accounts_correct(uuid, jsonb)',
    'public.recharge_verify_payment(uuid, text, text, numeric)', 'public.recharge_rm_performance(date, date, uuid)',
    'public.recharge_list(text, text, text, text, date, date, numeric, numeric, uuid, integer, integer)', 'public.recharge_get(uuid)',
    'public.recharge_create(jsonb)', 'public.recharge_update(uuid, jsonb)', 'public.recharge_set_status(uuid, text, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
