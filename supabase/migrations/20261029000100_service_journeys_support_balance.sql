-- Service journeys, Support leads, Accounts client-login provisioning, delivery routing and invoice balances.
--
-- Safe to run again in the Supabase SQL editor. Run it after 20261028000100_dynamic_invoices_two_stage.sql.
--
--  1. crm_services: which services need the Technical Consultant, and which department delivers them (one shared catalogue)
--  2. private.customer_journey(): TECHNICAL / DIRECT / MIXED, derived from the services the customer bought
--  3. Accounts creates the client login for DIRECT customers (status kept, retry-safe), and may return them to Sales only once it exists
--  4. Sales verifies the documents of DIRECT customers; Technical Consultants keep verifying everything else
--  5. Sales sends each verified service to its delivery department (per service, so mixed orders are not mis-routed)
--  6. customer_journey_info(): one read of where a customer is, kept apart by concern (payment, login, documents, delivery)
--  7. The Accounts queue shows who submitted (Sales or Support), the journey and the login state
--  8. Invoice balances: one ledger per invoice, balance = total - confirmed payments applied to it; the paid invoice shows it
--
-- Nothing here changes what a Technical Consultant customer goes through.

-- ---------------------------------------------------------------------------
-- 1. Service journey configuration (on the one shared catalogue; no copies per department)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'crm_services' and column_name = 'requires_technical_consultant') then
    alter table public.crm_services
      add column requires_technical_consultant boolean not null default true,
      add column delivery_department_id uuid references public.departments (id) on delete restrict;
    -- Every service keeps the Technical Consultant journey, except the Amuwa Design Studio services, which the Design Studio delivers
    -- itself. (Seeded once, when the columns are created: an administrator's later choice is never overwritten by a re-run.)
    update public.crm_services s
       set requires_technical_consultant = false, delivery_department_id = d.id
      from public.departments d
     where d.slug = 'designstudio' and s.code like 'DS\_%' escape '\';
  end if;
end $$;
alter table public.crm_services drop constraint if exists crm_services_journey_check;
alter table public.crm_services add constraint crm_services_journey_check
  check (requires_technical_consultant or delivery_department_id is not null);

-- Super Admin only. Changing a service never moves a customer already with a Technical Consultant (see customer_journey()).
create or replace function public.set_service_journey(p_service text, p_requires_technical_consultant boolean, p_delivery_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.crm_services;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change how a service is delivered.' using errcode = '42501';
  end if;
  select * into s from public.crm_services where code = p_service for update;
  if s.code is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if p_requires_technical_consultant is null then
    raise exception 'VALIDATION_ERROR: Say whether the service needs a Technical Consultant.' using errcode = 'P0001';
  end if;
  if not p_requires_technical_consultant and p_delivery_department is null then
    raise exception 'VALIDATION_ERROR: Choose the department that delivers a service without a Technical Consultant.' using errcode = 'P0001';
  end if;
  if p_delivery_department is not null and not exists (select 1 from public.departments where id = p_delivery_department) then
    raise exception 'VALIDATION_ERROR: Department not found.' using errcode = 'P0001';
  end if;
  update public.crm_services
     set requires_technical_consultant = p_requires_technical_consultant, delivery_department_id = p_delivery_department
   where code = p_service returning * into s;
  perform private.write_audit('SERVICE_JOURNEY_CHANGED', 'service', null, null, null,
    jsonb_build_object('service', p_service, 'requires_technical_consultant', p_requires_technical_consultant, 'delivery_department_id', p_delivery_department));
  return jsonb_build_object('code', s.code, 'requiresTechnicalConsultant', s.requires_technical_consultant, 'deliveryDepartmentId', s.delivery_department_id);
end $$;
revoke all on function public.set_service_journey(text, boolean, uuid) from public, anon;
grant execute on function public.set_service_journey(text, boolean, uuid) to authenticated;

-- The catalogue with its journey settings (every signed-in staff member may read the catalogue already).
create or replace function public.service_journeys()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when (select private.my_id()) is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'category', s.category, 'isActive', s.is_active,
             'requiresTechnicalConsultant', s.requires_technical_consultant,
             'deliveryDepartmentId', s.delivery_department_id, 'deliveryDepartment', d.name) order by s.sort_order, s.code)
      from public.crm_services s left join public.departments d on d.id = s.delivery_department_id), '[]'::jsonb) end
$$;
revoke all on function public.service_journeys() from public, anon;
grant execute on function public.service_journeys() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The journey of a customer
-- ---------------------------------------------------------------------------
--   TECHNICAL  every service needs the Technical Consultant (the existing Webstore journey)
--   DIRECT     none does: Sales -> Accounts -> login -> Sales verifies documents -> delivery department
--   MIXED      some do: the whole customer follows the Technical Consultant journey (nothing is bypassed); the services that
--              do not need one can still be sent to their delivery department once their documents are verified
--   NONE       no service selected yet
-- A customer already sent to a Technical Consultant stays TECHNICAL, so changing the catalogue never moves work in flight.
create or replace function private.customer_journey(p_customer uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from public.customer_onboarding o where o.customer_id = p_customer
                  and (o.forwarded_to_support_at is not null or o.returned_at is not null or o.handover_stage <> 'CONSULTANT')) then 'TECHNICAL'
    when s.n = 0 then 'NONE'
    when s.all_tc then 'TECHNICAL'
    when not s.any_tc then 'DIRECT'
    else 'MIXED' end
  from (select count(*) as n, coalesce(bool_or(sv.requires_technical_consultant), false) as any_tc, coalesce(bool_and(sv.requires_technical_consultant), true) as all_tc
          from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code
         where cs.customer_id = p_customer) s
$$;
revoke all on function private.customer_journey(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Client login provisioning by Accounts (DIRECT customers)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_client_provisioning (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  status text not null check (status in ('PENDING', 'CREATED', 'FAILED')),
  email text check (length(email) <= 254),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text check (length(last_error) <= 300),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.customer_client_provisioning enable row level security;
revoke all on table public.customer_client_provisioning from public, anon, authenticated;

-- A login recorded by any route (the Technical Consultant's included) settles the provisioning row.
create or replace function private.tg_client_login_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.customer_client_provisioning (customer_id, status, email, attempts, requested_by, updated_at)
  values (new.customer_id, 'CREATED', new.email, 1, new.created_by, now())
  on conflict (customer_id) do update set status = 'CREATED', email = excluded.email, last_error = null, updated_at = now();
  -- the customer's row changes too, so every open list refreshes through Realtime
  update public.customers set updated_at = now() where id = new.customer_id;
  return null;
end $$;
revoke all on function private.tg_client_login_created() from public, anon, authenticated;
drop trigger if exists customer_client_accounts_provisioned on public.customer_client_accounts;
create trigger customer_client_accounts_provisioned after insert on public.customer_client_accounts
  for each row execute function private.tg_client_login_created();
-- logins that already exist
insert into public.customer_client_provisioning (customer_id, status, email, attempts, requested_by)
select a.customer_id, 'CREATED', a.email, 1, a.created_by from public.customer_client_accounts a
on conflict (customer_id) do nothing;

-- Accounts may create the login of a DIRECT customer once a payment is verified and until the customer goes to delivery.
create or replace function private.accounts_may_create_login(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_accounts_staff() and exists (
    select 1 from public.customers c
     where c.id = p_customer
       and c.amount_verified > 0
       and c.payment_workflow in ('PENDING_PAYMENT_CONFIRMATION', 'PAYMENT_CONFIRMED')
       and c.lifecycle_stage in ('LEAD', 'ONBOARDING')
       and private.customer_journey(c.id) = 'DIRECT'
       and private.accounts_can_view(c.id))
$$;
revoke all on function private.accounts_may_create_login(uuid) from public, anon, authenticated;

-- (replaces the earlier definition: the Technical Consultant's route is unchanged, Accounts is added for DIRECT customers)
create or replace function private.may_manage_client_account(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (private.can_review_onboarding(p_customer)
          and exists (select 1 from public.customers c where c.id = p_customer
                       and (private.is_super_admin() or c.department_id = private.my_support_department_id())))
      or private.accounts_may_create_login(p_customer)
$$;
-- (existing grant kept: used by row-level-security policies and invoker functions)
grant execute on function private.may_manage_client_account(uuid) to authenticated;

-- Step 1 of Accounts creating a login: check everything, mark the attempt. Two clicks at once cannot both go on: while an
-- attempt is running (under 2 minutes old) a second one is refused. The caller then creates the Supabase Auth user and records it.
create or replace function public.accounts_client_login_begin(p_customer uuid, p_email text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  pr public.customer_client_provisioning;
  v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if private.customer_journey(p_customer) <> 'DIRECT' then
    raise exception 'CONFLICT: This customer''s services go through the Technical Consultant, who creates the client login.' using errcode = 'P0001';
  end if;
  if not private.accounts_may_create_login(p_customer) then
    raise exception 'CONFLICT: Verify a payment first. The client login is created once the payment is verified, before the customer goes back to Sales.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'CONFLICT: This customer already has a login.' using errcode = 'P0001';
  end if;
  select * into pr from public.customer_client_provisioning where customer_id = p_customer for update;
  if pr.customer_id is not null and pr.status = 'PENDING' and pr.updated_at > now() - interval '2 minutes' then
    raise exception 'CONFLICT: The login is already being created. Wait a moment and refresh.' using errcode = 'P0001';
  end if;
  -- the same format / duplicate checks as the Technical Consultant's route
  perform public.assert_client_account_allowed(p_customer, v_email);
  insert into public.customer_client_provisioning (customer_id, status, email, attempts, requested_by, requested_at, updated_at)
  values (p_customer, 'PENDING', v_email, 1, (select private.my_id()), now(), now())
  on conflict (customer_id) do update
    set status = 'PENDING', email = excluded.email, attempts = public.customer_client_provisioning.attempts + 1,
        last_error = null, requested_by = excluded.requested_by, requested_at = now(), updated_at = now();
  update public.customers set updated_at = now() where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_REQUESTED', format('Accounts started creating the client login (%s)', v_email));
  return jsonb_build_object('status', 'PENDING', 'email', v_email);
end $$;
revoke all on function public.accounts_client_login_begin(uuid, text) from public, anon;
grant execute on function public.accounts_client_login_begin(uuid, text) to authenticated;

-- Step 3 when it did not work: the reason stays on the customer for the retry. (A created login is recorded by record_client_account.)
create or replace function public.accounts_client_login_failed(p_customer uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
begin
  perform private.require_accounts_staff();
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  update public.customer_client_provisioning
     set status = 'FAILED', last_error = left(coalesce(nullif(btrim(p_message), ''), 'The login could not be created.'), 300), updated_at = now()
   where customer_id = p_customer and status = 'PENDING';
  update public.customers set updated_at = now() where id = p_customer;
  perform private.log_customer_activity(p_customer, 'CLIENT_LOGIN_FAILED', 'Creating the client login failed. Accounts can try again.');
  perform private.write_audit('CLIENT_LOGIN_FAILED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('reason', left(coalesce(p_message, ''), 300)));
end $$;
revoke all on function public.accounts_client_login_failed(uuid, text) from public, anon;
grant execute on function public.accounts_client_login_failed(uuid, text) to authenticated;

-- The customer's "Invoice" checklist item is satisfied by the invoice Accounts issued for the agreed services. The invoice generator
-- (kind GENERATED) must do what the older SERVICE invoice did, otherwise the item stays empty and "Complete these items first: Invoice"
-- blocks the customer in onboarding. Never resets an entry that was already verified or sent back.
create or replace function private.generated_invoice_fills_checklist(p_customer uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  i public.member_invoices;
begin
  if not exists (select 1 from public.customer_onboarding where customer_id = p_customer) then
    return;
  end if;
  select * into g from public.generated_invoices where customer_id = p_customer and purpose = 'SERVICES' order by issued_at desc limit 1;
  if g.invoice_id is null then
    return;
  end if;
  select * into i from public.member_invoices where id = g.invoice_id;
  insert into public.customer_onboarding_entries (customer_id, item_code, value, document_id, status, saved_by, saved_at)
  values (p_customer, 'INVOICE', format('%s · Rs. %s · issued by Accounts', g.invoice_number, to_char(g.total_amount, 'FM99,99,99,99,990.00')),
          null, 'SAVED', g.issued_by, now())
  on conflict (customer_id, item_code) do nothing;
  perform private.refresh_onboarding_progress(p_customer);
end $$;
revoke all on function private.generated_invoice_fills_checklist(uuid) from public, anon, authenticated;

create or replace function private.tg_generated_invoice_checklist()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.purpose = 'SERVICES' then
    perform private.generated_invoice_fills_checklist(new.customer_id);
  end if;
  return null;
end $$;
revoke all on function private.tg_generated_invoice_checklist() from public, anon, authenticated;
drop trigger if exists generated_invoices_checklist on public.generated_invoices;
create trigger generated_invoices_checklist after insert on public.generated_invoices
  for each row execute function private.tg_generated_invoice_checklist();
-- invoices issued before the customer reached onboarding
do $$
declare
  r record;
begin
  for r in select distinct customer_id from public.generated_invoices where purpose = 'SERVICES' loop
    perform private.generated_invoice_fills_checklist(r.customer_id);
  end loop;
end $$;

-- Return to Sales (replaces the earlier function): a DIRECT customer must have its client login first.
create or replace function public.accounts_confirm_and_return(p_customer uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_customer_for_accounts(p_customer);
  r public.payment_requests;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_method text;
  v_last public.customer_payments;
  v_direct boolean := private.customer_journey(p_customer) = 'DIRECT';
begin
  select * into r from public.payment_requests where customer_id = p_customer and status = 'PENDING' for update;
  if r.id is null or v.lifecycle_stage <> 'LEAD' or v.payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' then
    raise exception 'CONFLICT: This customer is not waiting for payment confirmation.' using errcode = 'P0001';
  end if;
  if v.amount_verified <= 0 then
    raise exception 'VALIDATION_ERROR: Record and verify the payment before returning the customer to Sales.' using errcode = 'P0001';
  end if;
  if v_direct and not exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: Create the client''s dashboard login before returning the customer to Sales.' using errcode = 'P0001';
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
  perform private.generated_invoice_fills_checklist(p_customer);

  perform private.log_customer_activity(p_customer, 'PAYMENT_CONFIRMED',
    format('Payment confirmed by Accounts (%s verified of %s)', private.rupees(v.amount_verified), private.rupees(v.deal_amount)) || coalesce(' · ' || v_note, ''));
  perform private.log_customer_activity(p_customer, 'MOVED_TO_ONBOARDING',
    case when v_direct then 'Returned to Sales - the client login is ready, the documents are next' else 'Returned to Sales - now in Customer onboarding' end);
  perform private.write_audit('PAYMENT_CONFIRMED_RETURNED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('request_id', r.id, 'verified', v.amount_verified, 'agreed', v.deal_amount, 'note', v_note, 'journey', case when v_direct then 'DIRECT' end));
  perform private.notify(v.owner_id, 'PAYMENT_CONFIRMED', format('Payment confirmed: %s', coalesce(v.company, v.name)),
    case when v_direct then 'Accounts verified the payment and created the client''s login. Please verify the customer''s documents.'
         else 'Accounts verified the payment. The customer is now in Customer onboarding.' end, 'customer', p_customer);
end $$;
revoke all on function public.accounts_confirm_and_return(uuid, text) from public, anon;
grant execute on function public.accounts_confirm_and_return(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Who verifies the documents
-- ---------------------------------------------------------------------------
-- DIRECT customers: Sales (the owner, their team head, the department head, the Super Admin) once Accounts has returned the customer.
-- Everyone else keeps the Technical Consultant's review. Payment confirmation never verifies a document by itself.
create or replace function private.can_verify_direct_documents(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
     where c.id = p_customer and c.lifecycle_stage = 'ONBOARDING' and c.payment_workflow = 'PAYMENT_CONFIRMED'
       and private.customer_journey(c.id) = 'DIRECT'
       and private.can_access_customer(c.id))
$$;
revoke all on function private.can_verify_direct_documents(uuid) from public, anon, authenticated;

create or replace function public.review_onboarding_entry(p_customer uuid, p_item text, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  i public.onboarding_items;
  e public.customer_onboarding_entries;
  o public.customer_onboarding;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  v_direct boolean := private.can_verify_direct_documents(p_customer);
begin
  if not (private.can_review_onboarding(p_customer) or v_direct) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('VERIFIED', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose verify or reject.' using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Tell the sales team what needs fixing.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  select * into i from public.onboarding_items where code = p_item;
  select * into e from public.customer_onboarding_entries where customer_id = p_customer and item_code = p_item for update;
  if e.item_code is null then
    raise exception 'CONFLICT: Nothing has been saved for this item yet.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding_entries
     set status = p_decision, reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = left(v_note, 1000)
   where customer_id = p_customer and item_code = p_item;
  perform private.refresh_onboarding_progress(p_customer);

  perform private.log_customer_activity(p_customer,
    case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    case when p_decision = 'VERIFIED' then format('%s verified', i.label) else format('%s needs fixing: %s', i.label, v_note) end);
  perform private.write_audit(case when p_decision = 'VERIFIED' then 'ONBOARDING_ITEM_VERIFIED' else 'ONBOARDING_ITEM_REJECTED' end,
    'customer', p_customer, v.department_id, v.team_id, jsonb_build_object('item', p_item, 'note', v_note, 'by', case when v_direct then 'SALES' else 'CONSULTANT' end));

  select * into o from public.customer_onboarding where customer_id = p_customer;
  if p_decision = 'VERIFIED' and o.items_total > 0 and o.items_verified = o.items_total then
    perform private.notify(v.owner_id, 'ONBOARDING_VERIFIED', format('Onboarding verified: %s', coalesce(v.company, v.name)),
      case when v_direct then 'Every document and detail is verified. You can send the services to their department.'
           else 'All documents and details were verified by the technical team.' end, 'customer', p_customer);
  end if;
end $$;
revoke all on function public.review_onboarding_entry(uuid, text, text, text) from public, anon;
grant execute on function public.review_onboarding_entry(uuid, text, text, text) to authenticated;

create or replace function public.verify_all_onboarding_entries(p_customer uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  n integer;
  v_direct boolean := private.can_verify_direct_documents(p_customer);
begin
  if not (private.can_review_onboarding(p_customer) or v_direct) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  update public.customer_onboarding_entries
     set status = 'VERIFIED', reviewed_by = (select private.my_id()), reviewed_at = now(), review_note = null
   where customer_id = p_customer and status = 'SAVED'
     and item_code in (select code from private.customer_items(p_customer));
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'CONFLICT: Nothing is waiting for authorization.' using errcode = 'P0001';
  end if;
  perform private.refresh_onboarding_progress(p_customer);
  perform private.log_customer_activity(p_customer, 'ONBOARDING_ITEMS_VERIFIED', format('%s items authorized', n));
  perform private.write_audit('ONBOARDING_ITEMS_VERIFIED', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('count', n, 'by', case when v_direct then 'SALES' else 'CONSULTANT' end));
  select * into o from public.customer_onboarding where customer_id = p_customer;
  if o.items_total > 0 and o.items_verified = o.items_total then
    perform private.notify(v.owner_id, 'ONBOARDING_VERIFIED', format('Onboarding verified: %s', coalesce(v.company, v.name)),
      case when v_direct then 'Every document and detail is verified. You can send the services to their department.'
           else 'All documents and details were verified by the technical team.' end, 'customer', p_customer);
  end if;
  return n;
end $$;
revoke all on function public.verify_all_onboarding_entries(uuid) from public, anon;
grant execute on function public.verify_all_onboarding_entries(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Delivery departments: per service, so a mixed order is never sent to the wrong place
-- ---------------------------------------------------------------------------
alter table public.customer_services
  add column if not exists delivery_department_id uuid references public.departments (id) on delete restrict,
  add column if not exists sent_to_delivery_at timestamptz,
  add column if not exists sent_to_delivery_by uuid references public.profiles (id) on delete set null,
  add column if not exists delivery_note text check (length(delivery_note) <= 1000);
create index if not exists customer_services_delivery_idx on public.customer_services (delivery_department_id, sent_to_delivery_at)
  where sent_to_delivery_at is not null;

-- Staff of a department that was sent a customer's service may see that customer (and nothing else of the department's Sales).
create or replace function private.delivery_recipient(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customer_services cs
     where cs.customer_id = p_customer and cs.sent_to_delivery_at is not null
       and (private.is_super_admin() or cs.delivery_department_id = (select private.my_department_id())))
$$;
revoke all on function private.delivery_recipient(uuid) from public, anon, authenticated;
-- used by a row-level-security policy, so the signed-in role must be able to call it (like private.handover_recipient)
grant execute on function private.delivery_recipient(uuid) to authenticated;

drop policy if exists customers_select_delivery on public.customers;
create policy customers_select_delivery on public.customers for select to authenticated
  using (private.delivery_recipient(id));

-- (replaces the earlier definition: the delivery department may read the onboarding details and documents of what it was sent)
create or replace function private.can_view_onboarding_review(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and o.with_consultant
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or c.department_id = private.my_support_department_id()
        or private.handover_recipient(c.id)))
  or private.delivery_recipient(p_customer)
$$;
-- (existing grant kept: used by row-level-security policies and invoker functions)
grant execute on function private.can_view_onboarding_review(uuid) to authenticated;

create or replace function public.send_to_delivery_departments(p_customer uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_customer);
  o public.customer_onboarding;
  v_journey text := private.customer_journey(p_customer);
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_missing text;
  v_sent integer;
  v_left integer;
  v_dept uuid;
  v_head uuid;
  v_names text;
begin
  if v.lifecycle_stage <> 'ONBOARDING' or v.payment_workflow <> 'PAYMENT_CONFIRMED' then
    raise exception 'CONFLICT: This customer is not waiting to be sent to a department.' using errcode = 'P0001';
  end if;
  if v_journey not in ('DIRECT', 'MIXED') then
    raise exception 'CONFLICT: These services go through the Technical Consultant.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if v.amount_verified <= 0 then
    raise exception 'VALIDATION_ERROR: The payment is not verified yet.' using errcode = 'P0001';
  end if;
  if v_journey = 'DIRECT' and not exists (select 1 from public.customer_client_accounts where customer_id = p_customer) then
    raise exception 'VALIDATION_ERROR: The client''s dashboard login has not been created yet. Ask Accounts to create it.' using errcode = 'P0001';
  end if;
  -- every required document and detail verified (a service with none to collect has nothing to wait for)
  if o.items_rejected > 0 or (o.items_total > 0 and o.items_verified < o.items_total) then
    raise exception 'VALIDATION_ERROR: Verify every document and detail first (%/% verified).', o.items_verified, o.items_total using errcode = 'P0001';
  end if;
  select string_agg(sv.name, ', ' order by sv.sort_order) into v_missing
    from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code
   where cs.customer_id = p_customer and cs.sent_to_delivery_at is null
     and not sv.requires_technical_consultant and sv.delivery_department_id is null;
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: No delivery department is set for: %. Ask the Super Admin to set it.', v_missing using errcode = 'P0001';
  end if;

  update public.customer_services cs
     set delivery_department_id = sv.delivery_department_id, sent_to_delivery_at = now(), sent_to_delivery_by = (select private.my_id()), delivery_note = v_note
    from public.crm_services sv
   where cs.customer_id = p_customer and sv.code = cs.service_code and cs.sent_to_delivery_at is null and not sv.requires_technical_consultant;
  get diagnostics v_sent = row_count;
  if v_sent = 0 then
    raise exception 'CONFLICT: Every service that can go to a department has already been sent.' using errcode = 'P0001';
  end if;
  select count(*) into v_left from public.customer_services cs where cs.customer_id = p_customer and cs.sent_to_delivery_at is null;
  select string_agg(distinct d.name, ', ') into v_names
    from public.customer_services cs join public.departments d on d.id = cs.delivery_department_id
   where cs.customer_id = p_customer and cs.sent_to_delivery_at is not null;

  -- a DIRECT customer has nothing left to do in onboarding once every service is with its department
  if v_journey = 'DIRECT' and v_left = 0 then
    update public.customers set lifecycle_stage = 'CUSTOMER' where id = p_customer;
    update public.customer_onboarding set stage = 'COMPLETED' where customer_id = p_customer;
  else
    update public.customers set updated_at = now() where id = p_customer;
  end if;

  perform private.log_customer_activity(p_customer, 'SENT_TO_DELIVERY',
    format('Documents verified. %s service(s) sent to %s', v_sent, coalesce(v_names, 'the delivery department')) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('SENT_TO_DELIVERY', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('services_sent', v_sent, 'services_left', v_left, 'journey', v_journey, 'note', v_note));
  for v_dept in
    select distinct cs.delivery_department_id from public.customer_services cs
     where cs.customer_id = p_customer and cs.sent_to_delivery_at >= now() - interval '1 minute' and cs.delivery_department_id is not null
  loop
    for v_head in
      select p.id from public.profiles p where p.status = 'ACTIVE' and p.department_id = v_dept and p.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD')
    loop
      perform private.notify(v_head, 'SERVICE_SENT_TO_DELIVERY', format('New service to deliver: %s', coalesce(v.company, v.name)),
        'Sales verified the documents and the payment is confirmed. The customer is in your delivery queue.', 'customer', p_customer);
    end loop;
  end loop;
  return jsonb_build_object('sent', v_sent, 'remaining', v_left, 'departments', v_names);
end $$;
revoke all on function public.send_to_delivery_departments(uuid, text) from public, anon;
grant execute on function public.send_to_delivery_departments(uuid, text) to authenticated;

-- What a delivery department was sent: its own services only, with what it needs to start.
create or replace function public.delivery_queue(p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_dept uuid := (select private.my_department_id());
  v_all boolean := private.is_super_admin();
  v_total integer;
  v_items jsonb;
begin
  if (select private.my_id()) is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select count(distinct c.id) into v_total
    from public.customers c join public.customer_services cs on cs.customer_id = c.id
   where cs.sent_to_delivery_at is not null and (v_all or cs.delivery_department_id = v_dept)
     and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%');
  select coalesce(jsonb_agg(j order by sent desc), '[]'::jsonb) into v_items from (
    select max(cs.sent_to_delivery_at) as sent,
      jsonb_build_object(
        'id', c.id, 'code', c.customer_code, 'name', c.name, 'company', c.company, 'email', c.email, 'phone', c.phone, 'whatsapp', c.whatsapp,
        'city', c.city, 'address', c.address,
        'referredBy', (select p.full_name from public.profiles p where p.id = c.owner_id),
        'referredFrom', (select t.division::text from public.profiles p join public.teams t on t.id = p.team_id where p.id = c.owner_id),
        'services', jsonb_agg(jsonb_build_object('code', cs.service_code, 'name', sv.name, 'sentAt', cs.sent_to_delivery_at,
                      'sentBy', (select full_name from public.profiles where id = cs.sent_to_delivery_by), 'note', cs.delivery_note,
                      'department', d.name) order by sv.sort_order),
        'dealAmount', c.deal_amount, 'amountVerified', c.amount_verified,
        'balance', greatest(coalesce(c.deal_amount, 0) - c.amount_verified, 0), 'paymentStatus', c.payment_status,
        'clientLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id)) as j
      from public.customers c
      join public.customer_services cs on cs.customer_id = c.id
      join public.crm_services sv on sv.code = cs.service_code
      left join public.departments d on d.id = cs.delivery_department_id
     where cs.sent_to_delivery_at is not null and (v_all or cs.delivery_department_id = v_dept)
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
     group by c.id
     order by max(cs.sent_to_delivery_at) desc
     limit v_size offset (v_page - 1) * v_size) q;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size);
end $$;
revoke all on function public.delivery_queue(text, integer, integer) from public, anon;
grant execute on function public.delivery_queue(text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Where a customer is, kept apart by concern
-- ---------------------------------------------------------------------------
create or replace function public.customer_journey_info(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  o public.customer_onboarding;
  pr public.customer_client_provisioning;
  a public.customer_client_accounts;
  v_journey text;
  v_accounts boolean := private.is_accounts_staff();
  v_sent integer; v_total integer; v_unsent_direct integer;
  v_login text;
  v_step text;
  v_services jsonb;
begin
  if not (private.accounts_can_view(p_customer) or private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into pr from public.customer_client_provisioning where customer_id = p_customer;
  select * into a from public.customer_client_accounts where customer_id = p_customer;
  v_journey := private.customer_journey(p_customer);
  v_login := case when a.customer_id is not null then 'CREATED' when pr.customer_id is not null then pr.status else 'NOT_STARTED' end;
  select count(*) filter (where cs.sent_to_delivery_at is not null), count(*),
         count(*) filter (where cs.sent_to_delivery_at is null and not sv.requires_technical_consultant)
    into v_sent, v_total, v_unsent_direct
    from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code where cs.customer_id = p_customer;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', sv.code, 'name', sv.name, 'category', sv.category, 'requiresTechnicalConsultant', sv.requires_technical_consultant,
           'deliveryDepartment', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d
                                   where d.id = coalesce(cs.delivery_department_id, sv.delivery_department_id)),
           'sentToDeliveryAt', cs.sent_to_delivery_at,
           'sentToDeliveryBy', (select full_name from public.profiles where id = cs.sent_to_delivery_by)) order by sv.sort_order), '[]'::jsonb)
    into v_services
    from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code where cs.customer_id = p_customer;

  v_step := case
    when v.lifecycle_stage = 'LOST' then 'LOST'
    when v.lifecycle_stage = 'LEAD' and v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' then
      case when v.amount_verified <= 0 then 'PENDING_PAYMENT'
           when v_journey = 'DIRECT' and v_login = 'FAILED' then 'LOGIN_FAILED'
           when v_journey = 'DIRECT' and v_login = 'CREATED' then 'LOGIN_CREATED'
           when v_journey = 'DIRECT' then 'LOGIN_PENDING'
           when v.amount_verified < coalesce(v.deal_amount, 0) then 'PAYMENT_PARTIAL'
           else 'PAYMENT_CONFIRMED' end
    when v.lifecycle_stage = 'LEAD' then 'LEAD'
    when v_journey = 'DIRECT' and v.lifecycle_stage = 'ONBOARDING' then
      case when v_total > 0 and v_sent >= v_total then 'SENT_TO_DELIVERY'
           when v_sent > 0 then 'PARTLY_SENT_TO_DELIVERY'
           when o.items_rejected = 0 and o.items_verified >= o.items_total then 'DOCUMENTS_VERIFIED'
           -- Sales is still collecting what the customer has to give, or every item is in and waits to be verified (or was sent back)
           when o.items_rejected = 0 and o.items_saved < o.items_total then 'RETURNED_TO_SALES'
           else 'DOCUMENTS_PENDING' end
    when v.lifecycle_stage = 'CUSTOMER' and v_total > 0 and v_sent >= v_total then 'SENT_TO_DELIVERY'
    when v.lifecycle_stage = 'CUSTOMER' then 'CUSTOMER'
    else 'TECHNICAL_CONSULTANT' end;

  return jsonb_build_object(
    'customerId', v.id, 'journey', v_journey, 'followsTechnicalConsultant', v_journey in ('TECHNICAL', 'MIXED'),
    'step', v_step, 'lifecycleStage', v.lifecycle_stage,
    'services', v_services,
    'referrer', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'division', t.division::text, 'department', d.name)
                   from public.profiles p left join public.teams t on t.id = p.team_id left join public.departments d on d.id = p.department_id
                  where p.id = v.owner_id),
    'payment', jsonb_build_object('workflow', v.payment_workflow, 'dealAmount', v.deal_amount, 'verified', v.amount_verified,
                 'balance', greatest(coalesce(v.deal_amount, 0) - v.amount_verified, 0), 'status', v.payment_status),
    'clientLogin', jsonb_build_object('status', v_login, 'email', coalesce(a.email, pr.email), 'attempts', coalesce(pr.attempts, 0),
                 'lastError', case when v_login = 'FAILED' then pr.last_error end, 'updatedAt', coalesce(pr.updated_at, a.created_at),
                 'createdAt', a.created_at, 'createdBy', (select full_name from public.profiles where id = a.created_by)),
    'documents', jsonb_build_object('total', coalesce(o.items_total, 0), 'saved', coalesce(o.items_saved, 0), 'verified', coalesce(o.items_verified, 0),
                 'rejected', coalesce(o.items_rejected, 0)),
    'delivery', jsonb_build_object('sent', v_sent, 'total', v_total, 'unsentDirect', v_unsent_direct, 'allSent', v_total > 0 and v_sent >= v_total),
    'can', jsonb_build_object(
      'createLogin', private.accounts_may_create_login(p_customer) and v_login <> 'CREATED',
      'returnToSales', v_accounts and v.lifecycle_stage = 'LEAD' and v.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION' and v.amount_verified > 0
                       and (v_journey <> 'DIRECT' or v_login = 'CREATED'),
      'verifyDocuments', private.can_verify_direct_documents(p_customer),
      'sendToDelivery', private.can_access_customer(p_customer) and v.lifecycle_stage = 'ONBOARDING' and v.payment_workflow = 'PAYMENT_CONFIRMED'
                        and v_journey in ('DIRECT', 'MIXED') and v_unsent_direct > 0 and v.amount_verified > 0
                        and (v_journey <> 'DIRECT' or v_login = 'CREATED')
                        and coalesce(o.items_rejected, 0) = 0 and (coalesce(o.items_total, 0) = 0 or o.items_verified >= o.items_total)));
end $$;
revoke all on function public.customer_journey_info(uuid) from public, anon;
grant execute on function public.customer_journey_info(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The Accounts queue: who submitted, the journey, the login
-- ---------------------------------------------------------------------------
create or replace function public.accounts_payment_requests(p_status text default 'PENDING', p_search text default null, p_page integer default 1, p_page_size integer default 20)
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
        'sentFrom', (select t.division::text from public.profiles p join public.teams t on t.id = p.team_id where p.id = r.requested_by),
        'resolvedAt', r.resolved_at, 'resolvedBy', (select full_name from public.profiles where id = r.resolved_by),
        'resolutionNote', r.resolution_note,
        'amountVerified', c.amount_verified, 'amountRecorded', c.amount_received,
        'balance', greatest(r.agreed_amount - c.amount_verified, 0), 'paymentStatus', c.payment_status,
        'stage', c.lifecycle_stage,
        'journey', private.customer_journey(c.id),
        'clientLogin', case when exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id) then 'CREATED'
                            else coalesce((select pr.status from public.customer_client_provisioning pr where pr.customer_id = c.id), 'NOT_STARTED') end) as row_json
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

-- ---------------------------------------------------------------------------
-- 8. Invoice balances
-- ---------------------------------------------------------------------------
-- Remaining balance = invoice total - the CONFIRMED payments applied to that invoice. Pending, rejected and reversed payments never
-- count. Where an invoice's payments are recorded follows what already exists, so no money is counted twice:
--   CUSTOMER  the customer's payment ledger (customer_payments), for the invoice of the agreed services
--   ADDON     the add-on payments of the add-on request the invoice bills
--   INVOICE   payments recorded on the invoice itself (an additional invoice, or a customer with no agreed amount)
-- The balance is calculated here from those records every time it is read; the browser never supplies it.
alter table public.generated_invoices add column if not exists payment_ledger text check (payment_ledger in ('CUSTOMER', 'ADDON', 'INVOICE'));

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.member_invoices (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,
  -- one per confirmation: a repeated click or request records the payment once
  request_id uuid unique,
  payment_type text not null check (payment_type in ('PART', 'FULL')),
  amount numeric(14, 2) not null check (amount > 0),
  method text not null check (method in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER')),
  reference text check (length(reference) between 1 and 120),
  paid_on date not null,
  note text check (length(note) <= 1000),
  status text not null default 'VERIFIED' check (status in ('VERIFIED', 'REVERSED')),
  recorded_by uuid references public.profiles (id) on delete set null,
  recorded_at timestamptz not null default now()
);
create unique index if not exists invoice_payments_reference_key on public.invoice_payments (invoice_id, lower(reference))
  where reference is not null and status = 'VERIFIED';
create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id, paid_on desc);
alter table public.invoice_payments enable row level security;
revoke all on table public.invoice_payments from public, anon, authenticated;

create or replace function private.tg_generated_invoice_immutable()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_open text[] := array['lifecycle', 'payment_confirmed_at', 'payment_confirmed_by', 'payment_method', 'payment_reference', 'payment_note',
    'payment_paid_on', 'updated_at', 'unpaid_pdf_status', 'unpaid_pdf_error', 'unpaid_storage_provider', 'unpaid_storage_bucket',
    'unpaid_storage_path', 'unpaid_storage_ref', 'unpaid_storage_etag', 'unpaid_size_bytes', 'unpaid_stored_at', 'unpaid_email_status',
    'unpaid_email_to', 'unpaid_email_sent_at', 'unpaid_email_error', 'unpaid_email_attempts', 'unpaid_email_message_id', 'unpaid_work_until',
    'paid_pdf_status', 'paid_pdf_error', 'paid_storage_provider', 'paid_storage_bucket', 'paid_storage_path', 'paid_storage_ref',
    'paid_storage_etag', 'paid_size_bytes', 'paid_stored_at', 'paid_email_status', 'paid_email_to', 'paid_email_sent_at', 'paid_email_error',
    'paid_email_attempts', 'paid_email_message_id', 'paid_work_until', 'payment_ledger'];
begin
  if tg_op = 'DELETE' then
    raise exception 'CONFLICT: An issued invoice cannot be deleted.' using errcode = 'P0001';
  end if;
  if (to_jsonb(old) - v_open) is distinct from (to_jsonb(new) - v_open) then
    raise exception 'CONFLICT: An issued invoice cannot be edited. Its number, customer, lines, tax and amounts are fixed.' using errcode = 'P0001';
  end if;
  if old.payment_ledger is not null and new.payment_ledger is distinct from old.payment_ledger then
    raise exception 'CONFLICT: Where the payments of an issued invoice are recorded cannot be changed.' using errcode = 'P0001';
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

-- Where the payments of an existing generated invoice are recorded (new ones get it from the trigger below)
update public.generated_invoices g
   set payment_ledger = case when g.addon_request_id is not null then 'ADDON'
                             when g.purpose = 'SERVICES' and coalesce((select c.deal_amount from public.customers c where c.id = g.customer_id), 0) > 0 then 'CUSTOMER'
                             else 'INVOICE' end
 where g.payment_ledger is null;

create or replace function private.tg_generated_invoice_ledger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = new.customer_id;
  new.payment_ledger := case when new.addon_request_id is not null then 'ADDON'
                             when new.purpose = 'SERVICES' and coalesce(c.deal_amount, 0) > 0 then 'CUSTOMER'
                             else 'INVOICE' end;
  -- payments of the agreed services are recorded against the agreed amount: an invoice for more could never be paid in full
  if new.payment_ledger = 'CUSTOMER' and new.total_amount > c.deal_amount then
    raise exception 'VALIDATION_ERROR: The invoice total (%) is more than the amount agreed with Sales (%). Correct the invoice, or ask Sales to correct the agreed amount first.',
      private.rupees(new.total_amount), private.rupees(c.deal_amount) using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_generated_invoice_ledger() from public, anon, authenticated;
drop trigger if exists generated_invoices_ledger on public.generated_invoices;
create trigger generated_invoices_ledger before insert on public.generated_invoices
  for each row execute function private.tg_generated_invoice_ledger();

alter table public.generated_invoices alter column payment_ledger set not null;

create or replace function private.invoice_payment_summary(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  g public.generated_invoices;
  inv public.member_invoices;
  v_sum numeric := 0;
  v_pending numeric := 0;
  v_confirmed numeric;
  v_payments jsonb := '[]'::jsonb;
begin
  select * into g from public.generated_invoices where invoice_id = p_invoice;
  if g.invoice_id is null then
    return null;
  end if;
  select * into inv from public.member_invoices where id = p_invoice;
  if g.payment_ledger = 'CUSTOMER' then
    select coalesce(sum(amount) filter (where status = 'VERIFIED'), 0), coalesce(sum(amount) filter (where status = 'PENDING'), 0)
      into v_sum, v_pending from public.customer_payments where customer_id = g.customer_id;
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_at) order by x.paid_at, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.customer_payments where customer_id = g.customer_id and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 20) x;
  elsif g.payment_ledger = 'ADDON' then
    select coalesce(sum(amount) filter (where status = 'VERIFIED'), 0), coalesce(sum(amount) filter (where status = 'PENDING'), 0)
      into v_sum, v_pending from public.addon_payments where request_id = inv.addon_request_id;
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_at) order by x.paid_at, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.addon_payments where request_id = inv.addon_request_id and status = 'VERIFIED' order by paid_at desc, recorded_at desc limit 20) x;
  else
    select coalesce(sum(amount), 0) into v_sum from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED';
    select coalesce(jsonb_agg(jsonb_build_object('amount', x.amount, 'method', x.method, 'reference', x.reference, 'paidAt', x.paid_on) order by x.paid_on, x.recorded_at), '[]'::jsonb)
      into v_payments from (select * from public.invoice_payments where invoice_id = p_invoice and status = 'VERIFIED' order by paid_on desc, recorded_at desc limit 20) x;
  end if;
  -- an invoice whose payment Accounts confirmed is paid in full, whatever happens to the ledger afterwards
  v_confirmed := case when g.lifecycle = 'PAID' then g.total_amount else least(v_sum, g.total_amount) end;
  return jsonb_build_object(
    'total', g.total_amount, 'confirmed', v_confirmed, 'balance', g.total_amount - v_confirmed,
    'state', case when v_confirmed >= g.total_amount then 'FULLY_PAID' when v_confirmed > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
    'pending', v_pending, 'ledger', g.payment_ledger, 'payments', v_payments);
end $$;
revoke all on function private.invoice_payment_summary(uuid) from public, anon, authenticated;

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
revoke all on function private.generated_json(uuid) from public, anon, authenticated;

-- Payments recorded on the invoice itself count as income like every other verified payment.
create or replace function private.verified_income()
returns table (id uuid, customer_id uuid, amount numeric, paid_at timestamptz, payment_type text, method text, reference text,
               verified_by uuid, recorded_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.id, p.customer_id, p.amount, p.paid_at, p.payment_type, p.method, p.reference, p.verified_by, p.recorded_at
    from public.customer_payments p where p.status = 'VERIFIED'
  union all
  select a.id, a.customer_id, a.amount, a.paid_at, 'ADDON', a.method, a.reference, a.verified_by, a.recorded_at
    from public.addon_payments a where a.status = 'VERIFIED'
  union all
  select ip.id, ip.customer_id, ip.amount, (ip.paid_on::text || ' 12:00:00+05:30')::timestamptz, ip.payment_type, ip.method, ip.reference,
         ip.recorded_by, ip.recorded_at
    from public.invoice_payments ip where ip.status = 'VERIFIED'
$$;
revoke all on function private.verified_income() from public, anon, authenticated;

-- One paid-invoice workflow: "Confirm Payment & Send Paid Invoice". It records a part payment (an invoice that is paid on the
-- invoice itself), or confirms that the verified payments already cover the invoice, and only then marks it paid and opens the
-- paid stage (the stamped invoice and its e-mail). A repeated click or request changes nothing.
drop function if exists public.accounts_confirm_invoice_payment(uuid, text, text, text, date);
create or replace function public.accounts_confirm_invoice_payment(
  p_invoice uuid, p_method text default null, p_reference text default null, p_note text default null, p_paid_on date default null,
  p_amount numeric default null, p_request uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.member_invoices;
  g public.generated_invoices;
  c public.customers;
  r public.addon_requests;
  s jsonb;
  v_method text := upper(coalesce(nullif(btrim(p_method), ''), ''));
  v_ref text := nullif(left(btrim(coalesce(p_reference, '')), 120), '');
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_balance numeric;
  v_amount numeric;
  v_paid_on date;
  v_last_method text; v_last_ref text; v_last_on date;
  v_recorded boolean := false;
begin
  perform private.require_accounts_staff();
  select * into inv from public.member_invoices where id = p_invoice for update;
  if inv.id is null or inv.kind <> 'GENERATED' then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into g from public.generated_invoices where invoice_id = inv.id for update;
  -- a repeated click or request: the payment was confirmed once already; nothing more is recorded
  if g.lifecycle = 'PAID' then
    return private.invoice_json(inv) || jsonb_build_object('replayed', true, 'settled', true);
  end if;
  select * into c from public.customers where id = g.customer_id for update;
  s := private.invoice_payment_summary(inv.id);
  v_balance := (s ->> 'balance')::numeric;

  if g.payment_ledger = 'INVOICE' then
    -- the same request again (a retry after a timeout): the payment is already on record
    if p_request is not null and exists (select 1 from public.invoice_payments where request_id = p_request) then
      s := private.invoice_payment_summary(inv.id);
      v_balance := (s ->> 'balance')::numeric;
    elsif v_balance > 0 or p_amount is not null then
      v_amount := coalesce(p_amount, v_balance);
      if v_amount <= 0 or v_amount <> round(v_amount, 2) then
        raise exception 'VALIDATION_ERROR: Enter the amount received in rupees (more than zero, up to 2 decimals).' using errcode = 'P0001';
      end if;
      if v_amount > v_balance then
        raise exception 'VALIDATION_ERROR: The amount is more than the balance of this invoice (%).', private.rupees(v_balance) using errcode = 'P0001';
      end if;
      if v_method not in ('UPI', 'BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER') then
        raise exception 'VALIDATION_ERROR: Choose how the payment was received.' using errcode = 'P0001';
      end if;
      if v_method in ('UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE') and v_ref is null then
        raise exception 'VALIDATION_ERROR: Enter the transaction / reference number.' using errcode = 'P0001';
      end if;
      v_paid_on := coalesce(p_paid_on, v_today);
      if v_paid_on > v_today or v_paid_on < g.invoice_date then
        raise exception 'VALIDATION_ERROR: The payment date cannot be in the future or before the invoice date.' using errcode = 'P0001';
      end if;
      begin
        insert into public.invoice_payments (invoice_id, customer_id, request_id, payment_type, amount, method, reference, paid_on, note, recorded_by)
        values (inv.id, g.customer_id, p_request, case when v_amount = v_balance then 'FULL' else 'PART' end, v_amount, v_method, v_ref,
                v_paid_on, v_note, (select private.my_id()));
      exception when unique_violation then
        raise exception 'CONFLICT: A payment with this reference is already recorded for this invoice.' using errcode = 'P0001';
      end;
      v_recorded := true;
      s := private.invoice_payment_summary(inv.id);
      v_balance := (s ->> 'balance')::numeric;
      perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_RECORDED',
        format('%s received for invoice %s (balance %s)', private.rupees(v_amount), inv.invoice_number, private.rupees(v_balance)));
      perform private.write_audit('INVOICE_PAYMENT_RECORDED', 'invoice', inv.id, c.department_id, c.team_id,
        jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'amount', v_amount, 'balance', v_balance, 'method', v_method, 'reference', v_ref));
    end if;
  elsif p_amount is not null then
    raise exception 'CONFLICT: The payments of this invoice are recorded in Payments (or Business Verification for an add-on). Record and verify them there, then confirm here.' using errcode = 'P0001';
  end if;

  if v_balance > 0 then
    if g.payment_ledger <> 'INVOICE' then
      raise exception 'CONFLICT: % of % is confirmed. Record and verify the remaining % in %, then confirm the payment here.',
        private.rupees((s ->> 'confirmed')::numeric), private.rupees(g.total_amount), private.rupees(v_balance),
        case when g.payment_ledger = 'ADDON' then 'Business Verification' else 'Payments' end using errcode = 'P0001';
    end if;
    -- a part payment: recorded, the invoice stays open with its balance
    perform private.notify(c.owner_id, 'INVOICE_PART_PAYMENT', format('Part payment: %s', coalesce(c.company, c.name)),
      format('%s received for invoice %s. Balance %s.', private.rupees(v_amount), inv.invoice_number, private.rupees(v_balance)), 'customer', c.id);
    select * into inv from public.member_invoices where id = p_invoice;
    return private.invoice_json(inv) || jsonb_build_object('replayed', not v_recorded, 'settled', false);
  end if;

  -- fully covered: mark paid and open the paid stage
  if inv.addon_request_id is not null then
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
  -- how the (last) payment was made, for the paid invoice: Accounts' entry, or the last verified payment on record
  if v_method = '' or not v_recorded then
    select pay.method, pay.reference, pay.paid_on into v_last_method, v_last_ref, v_last_on from (
      select method, reference, paid_at::date as paid_on, recorded_at from public.customer_payments where g.payment_ledger = 'CUSTOMER' and customer_id = g.customer_id and status = 'VERIFIED'
      union all
      select method, reference, paid_at::date, recorded_at from public.addon_payments where g.payment_ledger = 'ADDON' and request_id = inv.addon_request_id and status = 'VERIFIED'
      union all
      select method, reference, paid_on, recorded_at from public.invoice_payments where g.payment_ledger = 'INVOICE' and invoice_id = inv.id and status = 'VERIFIED'
      order by recorded_at desc limit 1) pay;
  end if;
  update public.generated_invoices
     set payment_method = coalesce(nullif(v_method, ''), v_last_method), payment_reference = coalesce(v_ref, v_last_ref), payment_note = v_note,
         payment_paid_on = coalesce(p_paid_on, v_last_on, v_today)
   where invoice_id = g.invoice_id;
  perform private.log_customer_activity(c.id, 'INVOICE_PAYMENT_CONFIRMED', format('Payment of invoice %s confirmed by Accounts', inv.invoice_number));
  perform private.write_audit('INVOICE_PAYMENT_CONFIRMED', 'invoice', inv.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', c.id, 'number', inv.invoice_number, 'total', inv.amount, 'method', v_method, 'reference', v_ref, 'ledger', g.payment_ledger));
  perform private.notify(c.owner_id, 'INVOICE_PAID', format('Payment confirmed: %s', coalesce(c.company, c.name)),
    format('Accounts confirmed the payment of invoice %s (%s).', inv.invoice_number, private.rupees(inv.amount)), 'customer', c.id);
  select * into inv from public.member_invoices where id = p_invoice;
  return private.invoice_json(inv) || jsonb_build_object('replayed', false, 'settled', true);
end $$;
revoke all on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date, numeric, uuid) from public, anon;
grant execute on function public.accounts_confirm_invoice_payment(uuid, text, text, text, date, numeric, uuid) to authenticated;

-- What a customer sees: the same list as before, with each generated invoice's balance
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
      'taxSummary', case when g.invoice_id is not null then jsonb_build_object('cgst', g.cgst_amount, 'sgst', g.sgst_amount, 'igst', g.igst_amount) end,
      -- what has been paid and what is left, from the confirmed payments (a generated invoice only)
      'paymentSummary', case when g.invoice_id is not null then private.invoice_payment_summary(g.invoice_id) end
    ) order by coalesce(i.issued_at, i.created_at) desc)
    from public.member_invoices i
    left join public.generated_invoices g on g.invoice_id = i.id
   where i.customer_id = v_customer and i.kind <> 'MANUAL'
     and (g.invoice_id is null or g.unpaid_pdf_status = 'STORED' or g.paid_pdf_status = 'STORED')), '[]'::jsonb);
end $$;
revoke all on function public.client_invoices() from public, anon;
grant execute on function public.client_invoices() to authenticated;

-- What the stored PDF is drawn from: the issued invoice plus its payment summary
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
  v_snapshot := private.generated_json(g.invoice_id) || jsonb_build_object('paymentSummary', private.invoice_payment_summary(g.invoice_id), 'invoiceId', g.invoice_id, 'customerId', g.customer_id, 'issuedAt', g.issued_at, 'stage', v_stage, 'recipientEmail', c.email,
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
