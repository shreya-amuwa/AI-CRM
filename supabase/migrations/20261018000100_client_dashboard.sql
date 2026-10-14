-- =============================================================================
-- Client dashboard (the customer's own web dashboard).
--
-- A client signs in with the e-mail and password the Technical Consultant set when creating the
-- client login (Supabase Auth user -> public.customer_client_accounts -> the customer). Everything the
-- client reads or does goes through the functions below. They take NO customer id: the customer is
-- always worked out from the signed-in client's own login (auth.uid()), so a client cannot reach another
-- customer's data by changing a URL or a request. The new tables have no direct access for anyone
-- signed in (row-level security on, no grants): only these functions touch them.
--
-- Reused, not duplicated: customers, customer_services (purchased services), crm_services (catalogue),
-- member_invoices + customer_documents (Accounts' invoices and their PDFs), support_tickets +
-- support_ticket_updates (Support's ticket system), addon_requests (the add-on pricing / Accounts
-- verification / payment workflow).
-- New: client_notifications, monthly_plans (+ included services), customer_plans, plan_requests,
-- service_requests.
--
-- Additive / re-runnable. Existing records are kept.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Who is the client? (never from a parameter)
-- ---------------------------------------------------------------------------
create or replace function private.my_client_customer()
returns uuid language sql stable security definer set search_path = '' as $$
  select a.customer_id from public.customer_client_accounts a where a.auth_user_id = auth.uid()
$$;
revoke all on function private.my_client_customer() from public, anon, authenticated;

create or replace function private.require_client()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v uuid := private.my_client_customer();
begin
  if v is null then
    raise exception 'FORBIDDEN: This is available to clients only.' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function private.require_client() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Small extensions of existing tables
-- ---------------------------------------------------------------------------
-- The service catalogue can describe a service and say what it costs (all optional).
alter table public.crm_services
  add column if not exists description text check (length(description) <= 1000),
  add column if not exists starting_price numeric(12, 2) check (starting_price >= 0),
  add column if not exists price_note text check (length(price_note) <= 200),
  add column if not exists features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array');

-- A purchased service: when it went live and when it renews (both optional, set by the team).
alter table public.customer_services
  add column if not exists activated_at timestamptz,
  add column if not exists renews_on date;

-- Tickets: which service the ticket is about; updates the client may see; the client's own replies.
alter table public.support_tickets add column if not exists service_code text references public.crm_services (code);
alter table public.support_ticket_updates
  add column if not exists client_visible boolean not null default false,
  add column if not exists client_author boolean not null default false;
alter table public.support_ticket_updates drop constraint if exists support_ticket_updates_kind_check;
alter table public.support_ticket_updates add constraint support_ticket_updates_kind_check
  check (kind in ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'ESCALATED', 'NOTE', 'CLIENT_REPLY'));
create index if not exists support_tickets_service_idx on public.support_tickets (customer_id, service_code);

-- ---------------------------------------------------------------------------
-- 3. New tables
-- ---------------------------------------------------------------------------
create table if not exists public.client_notifications (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  type text not null check (length(type) between 2 and 60),
  title text not null check (length(title) between 1 and 200),
  body text check (length(body) <= 1000),
  entity_type text check (entity_type in ('invoice', 'service', 'plan', 'ticket', 'service_request', 'plan_request', 'addon')),
  entity_id uuid,
  -- the same event processed twice creates one notification
  dedupe_key text not null unique,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists client_notifications_customer_idx on public.client_notifications (customer_id, created_at desc);
create index if not exists client_notifications_unread_idx on public.client_notifications (customer_id) where read_at is null;

create table if not exists public.monthly_plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (length(btrim(name)) between 2 and 120),
  description text check (length(description) <= 1000),
  monthly_price numeric(12, 2) not null check (monthly_price >= 0),
  features jsonb not null default '[]'::jsonb check (jsonb_typeof(features) = 'array'),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.monthly_plan_services (
  plan_id uuid not null references public.monthly_plans (id) on delete cascade,
  service_code text not null references public.crm_services (code),
  primary key (plan_id, service_code)
);
-- A customer's plan. At most one is active at a time; the old ones stay as history.
create table if not exists public.customer_plans (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  plan_id uuid not null references public.monthly_plans (id) on delete restrict,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),
  started_at date not null default current_date,
  renews_on date,
  ended_at date,
  payment_status text not null default 'PENDING' check (payment_status in ('PENDING', 'PAID')),
  price_at_start numeric(12, 2) not null check (price_at_start >= 0),
  request_id uuid,
  activated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists customer_plans_one_active_key on public.customer_plans (customer_id) where status = 'ACTIVE';
create index if not exists customer_plans_customer_idx on public.customer_plans (customer_id, started_at desc);

create table if not exists public.plan_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  plan_id uuid not null references public.monthly_plans (id) on delete restrict,
  kind text not null check (kind in ('SELECT', 'UPGRADE', 'SWITCH')),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'APPROVED', 'REJECTED', 'ACTIVATED', 'CANCELLED')),
  note text check (length(note) <= 1000),
  decision_note text check (length(decision_note) <= 1000),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- one open plan request per customer
create unique index if not exists plan_requests_one_open_key on public.plan_requests (customer_id) where status in ('REQUESTED', 'APPROVED');
create index if not exists plan_requests_status_idx on public.plan_requests (status, created_at desc);

-- A client asks for another service (an add-on). It never activates anything by itself: the Technical
-- Consultant takes it into the add-on workflow (pricing, Accounts verification, payment, documents).
create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code),
  status text not null default 'REQUESTED' check (status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW', 'ACTIVATED', 'REJECTED', 'CANCELLED')),
  note text check (length(note) <= 1000),
  decision_note text check (length(decision_note) <= 1000),
  handled_by uuid references public.profiles (id) on delete set null,
  addon_request_id uuid references public.addon_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- no duplicate open request for the same service
create unique index if not exists service_requests_one_open_key on public.service_requests (customer_id, service_code)
  where status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW');
create index if not exists service_requests_customer_idx on public.service_requests (customer_id, created_at desc);

do $$
declare
  t text;
begin
  foreach t in array array['monthly_plans', 'plan_requests', 'service_requests'] loop
    execute format('drop trigger if exists %1$s_set_updated_at on public.%1$I', t);
    execute format('create trigger %1$s_set_updated_at before update on public.%1$I for each row execute function public.tg_set_updated_at()', t);
  end loop;
  -- nobody signed in reads or writes these tables directly: only the functions below
  foreach t in array array['client_notifications', 'monthly_plans', 'monthly_plan_services', 'customer_plans', 'plan_requests', 'service_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Notifications to the client (from real events, never twice)
-- ---------------------------------------------------------------------------
create or replace function private.client_notify(p_customer uuid, p_type text, p_title text, p_body text,
                                                 p_entity_type text, p_entity_id uuid, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- only customers that have a client login are notified
  if not exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer) then
    return;
  end if;
  insert into public.client_notifications (customer_id, type, title, body, entity_type, entity_id, dedupe_key)
  values (p_customer, p_type, left(p_title, 200), left(p_body, 1000), p_entity_type, p_entity_id, p_dedupe)
  on conflict (dedupe_key) do nothing;
end $$;
revoke all on function private.client_notify(uuid, text, text, text, text, uuid, text) from public, anon, authenticated;

-- Technical Consultants of the customer's department (and the salesperson) get a bell for client requests.
create or replace function private.notify_customer_team(p_customer uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v_recipient uuid;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null then
    return;
  end if;
  for v_recipient in
    select p.id from public.profiles p join public.teams t on t.id = p.team_id
     where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = c.department_id
       and (p.is_technical_consultant or p.role = 'TEAM_HEAD')
    union select c.owner_id where c.owner_id is not null
  loop
    perform private.notify(v_recipient, p_type, p_title, p_body, p_entity_type, p_entity_id);
  end loop;
end $$;
revoke all on function private.notify_customer_team(uuid, text, text, text, text, uuid) from public, anon, authenticated;

-- Invoices from Accounts, and their payment
create or replace function private.tg_client_invoice_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.customer_id is null or new.kind = 'MANUAL' then
    return null;
  end if;
  if tg_op = 'INSERT' then
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
drop trigger if exists member_invoices_client_events on public.member_invoices;
create trigger member_invoices_client_events after insert or update of status on public.member_invoices
  for each row execute function private.tg_client_invoice_events();

-- A verified payment
create or replace function private.tg_client_payment_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'VERIFIED' and (tg_op = 'INSERT' or old.status is distinct from 'VERIFIED') then
    perform private.client_notify(new.customer_id, 'PAYMENT_VERIFIED', 'Payment verified',
      format('Accounts verified your payment of %s.', private.rupees(new.amount)), null, null, format('PAY|%s|%s', tg_table_name, new.id));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_payment_events() from public, anon, authenticated;
drop trigger if exists customer_payments_client_events on public.customer_payments;
create trigger customer_payments_client_events after insert or update of status on public.customer_payments
  for each row execute function private.tg_client_payment_events();
drop trigger if exists addon_payments_client_events on public.addon_payments;
create trigger addon_payments_client_events after insert or update of status on public.addon_payments
  for each row execute function private.tg_client_payment_events();

-- Add-on requests: client-facing steps; activation of the services once everything is verified
create or replace function private.tg_client_addon_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_title text;
  v_body text;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  select case new.status
           when 'PENDING_VERIFICATION' then 'Add-on services are being reviewed'
           when 'APPROVED' then 'Your add-on services were approved'
           when 'REJECTED' then 'Your add-on request could not be approved'
           when 'INVOICE_GENERATED' then 'Invoice for your add-on services'
           when 'PAYMENT_CONFIRMED' then 'Payment for your add-on services confirmed'
           when 'COMPLETED' then 'Your add-on services are active' end,
         case new.status
           when 'PENDING_VERIFICATION' then 'Our team priced your add-on services and Accounts is verifying them.'
           when 'APPROVED' then 'Accounts approved the add-on services. Your invoice follows.'
           when 'REJECTED' then coalesce(new.decision_note, 'Please contact your relationship manager for details.')
           when 'INVOICE_GENERATED' then 'Open Invoices to view it and complete the payment as instructed by Accounts.'
           when 'PAYMENT_CONFIRMED' then 'We are now setting up your add-on services.'
           when 'COMPLETED' then 'The services are now in My Services.' end
    into v_title, v_body;
  if v_title is not null then
    perform private.client_notify(new.customer_id, 'ADDON_' || new.status, v_title, v_body, 'addon', new.id,
      format('ADDON|%s|%s|%s', new.id, new.status, new.version));
  end if;

  if new.status = 'COMPLETED' then
    -- verified and paid: the services now belong to the customer (and appear in My Services)
    insert into public.customer_services (customer_id, service_code, activated_at)
    select new.customer_id, i.service_code, now() from public.addon_request_items i
     where i.request_id = new.id and i.service_code is not null
    on conflict do nothing;
    update public.customer_services s set activated_at = coalesce(s.activated_at, now())
     where s.customer_id = new.customer_id and s.service_code in (select i.service_code from public.addon_request_items i where i.request_id = new.id);
    update public.service_requests r set status = 'ACTIVATED'
     where r.addon_request_id = new.id and r.status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW');
  elsif new.status = 'REJECTED' then
    update public.service_requests r set status = 'REJECTED', decision_note = coalesce(new.decision_note, r.decision_note)
     where r.addon_request_id = new.id and r.status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW');
  end if;
  return null;
end $$;
revoke all on function private.tg_client_addon_events() from public, anon, authenticated;
drop trigger if exists addon_requests_client_events on public.addon_requests;
create trigger addon_requests_client_events after insert or update of status on public.addon_requests
  for each row execute function private.tg_client_addon_events();

-- The consultant putting a requested service into an add-on request takes the client's request into the workflow
create or replace function private.tg_service_request_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid;
begin
  select customer_id into v_customer from public.addon_requests where id = new.request_id;
  update public.service_requests r set status = 'IN_ADDON_WORKFLOW', addon_request_id = new.request_id
   where r.customer_id = v_customer and r.service_code = new.service_code and r.status in ('REQUESTED', 'IN_REVIEW');
  return null;
end $$;
revoke all on function private.tg_service_request_link() from public, anon, authenticated;
drop trigger if exists addon_request_items_service_request_link on public.addon_request_items;
create trigger addon_request_items_service_request_link after insert on public.addon_request_items
  for each row execute function private.tg_service_request_link();

-- Requested-service decisions by the team
create or replace function private.tg_client_service_request_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  select name into v_name from public.crm_services where code = new.service_code;
  if new.status = 'IN_REVIEW' then
    perform private.client_notify(new.customer_id, 'SERVICE_REQUEST_IN_REVIEW', format('%s request is being reviewed', v_name),
      'Our team is preparing the details and price for you.', 'service_request', new.id, format('SR|%s|IN_REVIEW', new.id));
  elsif new.status = 'IN_ADDON_WORKFLOW' then
    perform private.client_notify(new.customer_id, 'SERVICE_REQUEST_IN_PROGRESS', format('%s: pricing in progress', v_name),
      'Accounts will verify the price and send you the invoice.', 'service_request', new.id, format('SR|%s|IN_ADDON_WORKFLOW', new.id));
  elsif new.status = 'REJECTED' then
    perform private.client_notify(new.customer_id, 'SERVICE_REQUEST_REJECTED', format('%s request could not be taken forward', v_name),
      coalesce(new.decision_note, 'Please contact your relationship manager for details.'), 'service_request', new.id, format('SR|%s|REJECTED', new.id));
  elsif new.status = 'ACTIVATED' then
    perform private.client_notify(new.customer_id, 'SERVICE_ACTIVATED', format('%s is now active', v_name),
      'You can see it in My Services.', 'service', null, format('SR|%s|ACTIVATED', new.id));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_service_request_events() from public, anon, authenticated;
drop trigger if exists service_requests_client_events on public.service_requests;
create trigger service_requests_client_events after update of status on public.service_requests
  for each row execute function private.tg_client_service_request_events();

-- Support's progress on a ticket (status changes and replies written for the client)
create or replace function private.tg_client_ticket_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.support_tickets;
begin
  if new.client_author or new.kind not in ('STATUS_CHANGED', 'NOTE') then
    return null;
  end if;
  if new.kind = 'NOTE' and not new.client_visible then
    return null;
  end if;
  select * into t from public.support_tickets where id = new.ticket_id;
  if new.kind = 'STATUS_CHANGED' then
    perform private.client_notify(t.customer_id, 'TICKET_STATUS', format('Ticket %s is now %s', t.ticket_no, replace(lower(new.to_status), '_', ' ')),
      t.subject, 'ticket', t.id, format('TKT|%s', new.id));
  else
    perform private.client_notify(t.customer_id, 'TICKET_REPLY', format('New reply on ticket %s', t.ticket_no),
      left(coalesce(new.note, t.subject), 300), 'ticket', t.id, format('TKT|%s', new.id));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_ticket_events() from public, anon, authenticated;
drop trigger if exists support_ticket_updates_client_events on public.support_ticket_updates;
create trigger support_ticket_updates_client_events after insert on public.support_ticket_updates
  for each row execute function private.tg_client_ticket_events();

-- Plans
create or replace function private.tg_client_plan_events()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  if tg_table_name = 'customer_plans' then
    if tg_op = 'INSERT' and new.status = 'ACTIVE' then
      select name into v_name from public.monthly_plans where id = new.plan_id;
      perform private.client_notify(new.customer_id, 'PLAN_ACTIVATED', format('Your %s plan is active', v_name),
        'See Monthly Plans for the details and the next renewal.', 'plan', new.id, format('PLAN|%s|ACTIVE', new.id));
    elsif tg_op = 'UPDATE' and new.renews_on is distinct from old.renews_on and new.status = 'ACTIVE' and new.renews_on is not null and old.renews_on is not null then
      perform private.client_notify(new.customer_id, 'PLAN_RENEWED', 'Your monthly plan was renewed',
        format('Next renewal: %s.', to_char(new.renews_on, 'DD Mon YYYY')), 'plan', new.id, format('PLAN|%s|RENEWED|%s', new.id, new.renews_on));
    end if;
  else
    if new.status is not distinct from old.status then
      return null;
    end if;
    select name into v_name from public.monthly_plans where id = new.plan_id;
    if new.status = 'APPROVED' then
      perform private.client_notify(new.customer_id, 'PLAN_REQUEST_APPROVED', format('%s plan approved', v_name),
        'Accounts approved your request. The plan starts once the payment is confirmed.', 'plan_request', new.id, format('PR|%s|APPROVED', new.id));
    elsif new.status = 'REJECTED' then
      perform private.client_notify(new.customer_id, 'PLAN_REQUEST_REJECTED', format('%s plan request not approved', v_name),
        coalesce(new.decision_note, 'Please contact your relationship manager for details.'), 'plan_request', new.id, format('PR|%s|REJECTED', new.id));
    end if;
  end if;
  return null;
end $$;
revoke all on function private.tg_client_plan_events() from public, anon, authenticated;
drop trigger if exists customer_plans_client_events on public.customer_plans;
create trigger customer_plans_client_events after insert or update of renews_on on public.customer_plans
  for each row execute function private.tg_client_plan_events();
drop trigger if exists plan_requests_client_events on public.plan_requests;
create trigger plan_requests_client_events after update of status on public.plan_requests
  for each row execute function private.tg_client_plan_events();

-- ---------------------------------------------------------------------------
-- 5. The client's own functions (no customer id parameter anywhere)
-- ---------------------------------------------------------------------------
-- Who am I? Also the check "is this login a client's?" used by the API.
create or replace function public.client_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  a public.customer_client_accounts;
begin
  select * into c from public.customers where id = v_customer;
  select * into a from public.customer_client_accounts where customer_id = v_customer;
  return jsonb_build_object(
    'customerId', c.id, 'name', c.name, 'businessName', coalesce(nullif(btrim(c.company), ''), c.name),
    'email', c.email, 'phone', c.phone, 'segment', c.segment, 'status', c.status,
    'department', (select d.name from public.departments d where d.id = c.department_id),
    'loginEmail', a.email, 'clientSince', coalesce(a.created_at, c.created_at));
end $$;

-- Purchased services
create or replace function public.client_services()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_complete boolean;
begin
  select coalesce(o.client_status = 'COMPLETED' or o.stage = 'COMPLETED', true) into v_complete
    from public.customer_onboarding o where o.customer_id = v_customer;
  v_complete := coalesce(v_complete, true);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'category', s.category, 'description', s.description,
      'purchasedAt', cs.created_at, 'activatedAt', cs.activated_at, 'renewsOn', cs.renews_on,
      'status', case when cs.activated_at is not null or v_complete then 'LIVE' else 'SETTING_UP' end,
      'plan', (select p.name from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id
                join public.monthly_plan_services ps on ps.plan_id = p.id and ps.service_code = s.code
               where cp.customer_id = v_customer and cp.status = 'ACTIVE' limit 1),
      'details', cs.details) order by cs.created_at, s.name)
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   where cs.customer_id = v_customer), '[]'::jsonb);
end $$;

-- The company catalogue, with what the client already has or has asked for
create or replace function public.client_service_catalog()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'category', s.category, 'description', s.description,
      'startingPrice', s.starting_price, 'priceNote', s.price_note, 'features', s.features,
      'owned', exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = s.code),
      'request', (select jsonb_build_object('id', r.id, 'status', r.status, 'createdAt', r.created_at, 'decisionNote', r.decision_note)
                    from public.service_requests r where r.customer_id = v_customer and r.service_code = s.code
                     and r.status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW') limit 1)
    ) order by s.sort_order, s.name)
    from public.crm_services s where s.is_active), '[]'::jsonb);
end $$;

create or replace function public.client_service_requests()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'serviceCode', r.service_code, 'serviceName', s.name, 'status', r.status,
                                        'note', r.note, 'decisionNote', r.decision_note, 'createdAt', r.created_at, 'updatedAt', r.updated_at)
                     order by r.created_at desc)
    from public.service_requests r join public.crm_services s on s.code = r.service_code where r.customer_id = v_customer), '[]'::jsonb);
end $$;

-- Ask for another service. Nothing is activated; the Technical Consultant takes it from here.
create or replace function public.client_request_service(p_service text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  s public.crm_services;
  c public.customers;
  r public.service_requests;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
begin
  select * into s from public.crm_services where code = p_service and is_active;
  if s.code is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = s.code) then
    raise exception 'CONFLICT: You already have this service.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.service_requests x where x.customer_id = v_customer and x.service_code = s.code
              and x.status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW')) then
    raise exception 'CONFLICT: You have already requested this service. We will contact you soon.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.service_requests x where x.customer_id = v_customer and x.created_at > now() - interval '1 day') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many requests today. Please try again tomorrow.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  insert into public.service_requests (customer_id, service_code, note) values (v_customer, s.code, v_note) returning * into r;
  perform private.client_notify(v_customer, 'SERVICE_REQUEST_SENT', format('%s request received', s.name),
    'Our team will review it, confirm the price with Accounts and get back to you.', 'service_request', r.id, format('SR|%s|REQUESTED', r.id));
  perform private.log_customer_activity(v_customer, 'CLIENT_SERVICE_REQUEST', format('Client asked for %s%s', s.name, coalesce(': ' || v_note, '')));
  perform private.write_audit('CLIENT_SERVICE_REQUESTED', 'customer', v_customer, c.department_id, c.team_id,
    jsonb_build_object('service', s.code, 'request_id', r.id));
  perform private.notify_customer_team(v_customer, 'CLIENT_SERVICE_REQUEST', format('Service request: %s', coalesce(c.company, c.name)),
    format('The client asked for %s. Open the customer, add it to the add-ons and set the price.', s.name), 'customer', v_customer);
  return jsonb_build_object('id', r.id, 'status', r.status, 'serviceCode', s.code, 'serviceName', s.name);
end $$;

-- A client can withdraw their own open request
create or replace function public.client_cancel_service_request(p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  update public.service_requests set status = 'CANCELLED'
   where id = p_request and customer_id = v_customer and status = 'REQUESTED';
  if not found then
    raise exception 'CONFLICT: This request can no longer be withdrawn.' using errcode = 'P0001';
  end if;
end $$;

-- Monthly plans
create or replace function private.plan_json(p public.monthly_plans)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'description', p.description, 'monthlyPrice', p.monthly_price,
    'features', p.features,
    'services', coalesce((select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name) order by s.sort_order, s.name)
                            from public.monthly_plan_services ps join public.crm_services s on s.code = ps.service_code where ps.plan_id = p.id), '[]'::jsonb))
$$;
revoke all on function private.plan_json(public.monthly_plans) from public, anon, authenticated;

create or replace function public.client_plans()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return jsonb_build_object(
    'current', (select private.plan_json(p) || jsonb_build_object('customerPlanId', cp.id, 'startedAt', cp.started_at, 'renewsOn', cp.renews_on,
                  'status', cp.status, 'paymentStatus', cp.payment_status, 'price', cp.price_at_start)
                  from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id where cp.customer_id = v_customer and cp.status = 'ACTIVE'),
    'options', coalesce((select jsonb_agg(private.plan_json(p) order by p.monthly_price, p.sort_order) from public.monthly_plans p where p.is_active), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'startedAt', cp.started_at, 'endedAt', cp.ended_at, 'status', cp.status, 'price', cp.price_at_start)
                                          order by cp.started_at desc, cp.created_at desc)
                           from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id where cp.customer_id = v_customer), '[]'::jsonb),
    'request', (select jsonb_build_object('id', r.id, 'planId', r.plan_id, 'planName', p.name, 'kind', r.kind, 'status', r.status, 'createdAt', r.created_at, 'decisionNote', r.decision_note)
                  from public.plan_requests r join public.monthly_plans p on p.id = r.plan_id where r.customer_id = v_customer and r.status in ('REQUESTED', 'APPROVED')));
end $$;

create or replace function public.client_request_plan(p_plan uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  p public.monthly_plans;
  cur public.customer_plans;
  c public.customers;
  r public.plan_requests;
  v_kind text;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
begin
  select * into p from public.monthly_plans where id = p_plan and is_active;
  if p.id is null then
    raise exception 'NOT_FOUND: Plan not found.' using errcode = 'P0001';
  end if;
  select * into cur from public.customer_plans where customer_id = v_customer and status = 'ACTIVE';
  if cur.id is not null and cur.plan_id = p.id then
    raise exception 'CONFLICT: This is already your plan.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.plan_requests x where x.customer_id = v_customer and x.status in ('REQUESTED', 'APPROVED')) then
    raise exception 'CONFLICT: You already have a plan request in progress. We will contact you soon.' using errcode = 'P0001';
  end if;
  v_kind := case when cur.id is null then 'SELECT'
                 when p.monthly_price > cur.price_at_start then 'UPGRADE' else 'SWITCH' end;
  select * into c from public.customers where id = v_customer;
  insert into public.plan_requests (customer_id, plan_id, kind, note) values (v_customer, p.id, v_kind, v_note) returning * into r;
  perform private.client_notify(v_customer, 'PLAN_REQUEST_SENT', format('%s plan request received', p.name),
    'Accounts will verify it and confirm the payment with you.', 'plan_request', r.id, format('PR|%s|REQUESTED', r.id));
  perform private.log_customer_activity(v_customer, 'CLIENT_PLAN_REQUEST', format('Client asked for the %s plan', p.name));
  perform private.write_audit('CLIENT_PLAN_REQUESTED', 'customer', v_customer, c.department_id, c.team_id, jsonb_build_object('plan', p.code, 'request_id', r.id, 'kind', v_kind));
  perform private.notify_accounts('PLAN_REQUESTED', format('Plan request: %s', coalesce(c.company, c.name)),
    format('The client asked for the %s plan (%s per month). Verify it and confirm the payment.', p.name, private.rupees(p.monthly_price)), v_customer);
  return jsonb_build_object('id', r.id, 'status', r.status, 'kind', r.kind, 'planName', p.name);
end $$;

-- Invoices from Accounts (read-only)
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
      'overdue', i.status = 'Pending' and nullif(i.due_date, '') ~ '^\d{4}-\d{2}-\d{2}$' and i.due_date::date < current_date,
      'related', case when i.addon_request_id is not null then 'Add-on services' else 'Services' end,
      'items', coalesce(i.details -> 'items', '[]'::jsonb),
      'hasFile', exists (select 1 from public.customer_documents d where d.invoice_id = i.id and d.status = 'UPLOADED')
    ) order by coalesce(i.issued_at, i.created_at) desc)
    from public.member_invoices i where i.customer_id = v_customer and i.kind <> 'MANUAL'), '[]'::jsonb);
end $$;

-- The stored PDF of one of MY invoices. The API signs a short-lived link for exactly this file.
create or replace function public.client_invoice_file(p_invoice uuid)
returns table (storage_bucket text, storage_path text, original_file_name text, mime_type text)
language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  i public.member_invoices;
  d public.customer_documents;
  c public.customers;
begin
  select * into i from public.member_invoices where id = p_invoice and customer_id = v_customer and kind <> 'MANUAL';
  if i.id is null then
    raise exception 'NOT_FOUND: Invoice not found.' using errcode = 'P0001';
  end if;
  select * into d from public.customer_documents where invoice_id = i.id and status = 'UPLOADED' order by uploaded_at desc nulls last limit 1;
  if d.id is null then
    raise exception 'NOT_FOUND: This invoice has no file yet.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  perform private.write_audit('CLIENT_INVOICE_VIEWED', 'invoice', i.id, c.department_id, c.team_id,
    jsonb_build_object('customer_id', v_customer, 'number', i.invoice_number, 'client_user', auth.uid()));
  return query select d.storage_bucket, d.storage_path, d.original_file_name, d.mime_type;
end $$;

-- Tickets
create or replace function private.client_ticket_json(t public.support_tickets)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', t.id, 'ticketNo', t.ticket_no, 'subject', t.subject, 'description', t.description, 'category', t.category,
    'priority', t.priority, 'status', t.status, 'serviceCode', t.service_code,
    'serviceName', (select s.name from public.crm_services s where s.code = t.service_code),
    'resolution', case when t.status in ('RESOLVED', 'CLOSED') then t.resolution_notes end,
    'createdAt', t.created_at, 'updatedAt', t.updated_at)
$$;
revoke all on function private.client_ticket_json(public.support_tickets) from public, anon, authenticated;

create or replace function public.client_tickets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((select jsonb_agg(private.client_ticket_json(t) order by t.created_at desc)
                     from public.support_tickets t where t.customer_id = v_customer), '[]'::jsonb);
end $$;

create or replace function public.client_ticket(p_ticket uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket and customer_id = v_customer;
  if t.id is null then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  return private.client_ticket_json(t) || jsonb_build_object('updates', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', u.id, 'at', u.created_at,
      'type', case when u.client_author then 'CLIENT' when u.kind = 'STATUS_CHANGED' then 'STATUS' else 'SUPPORT' end,
      'status', u.to_status,
      -- the opening description is the client's own message; staff notes stay internal unless written for the client
      'message', case when u.kind = 'CREATED' or u.client_author or (u.kind = 'NOTE' and u.client_visible) then u.note end)
      order by u.created_at, u.id)
      from public.support_ticket_updates u
     where u.ticket_id = t.id
       and (u.client_author or u.kind in ('CREATED', 'STATUS_CHANGED') or (u.kind = 'NOTE' and u.client_visible))), '[]'::jsonb));
end $$;

create or replace function public.client_create_ticket(p_subject text, p_description text, p_category text default 'GENERAL', p_service text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  t public.support_tickets;
  v_team uuid;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
begin
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a subject (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if v_desc is null or length(v_desc) < 5 or length(v_desc) > 4000 then
    raise exception 'VALIDATION_ERROR: Describe the problem (5 to 4000 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if p_service is not null and not exists (select 1 from public.customer_services cs where cs.customer_id = v_customer and cs.service_code = p_service) then
    raise exception 'VALIDATION_ERROR: Choose one of your own services.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.support_tickets x where x.customer_id = v_customer and x.created_at > now() - interval '1 day') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many tickets today. Please reply to an open ticket or try again tomorrow.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = v_customer;
  -- the department's Support team (the lead assigns it to a member)
  select t2.id into v_team from public.teams t2 where t2.department_id = c.department_id and t2.division = 'SUPPORT' order by t2.created_at limit 1;
  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority, service_code, created_by)
  values (v_customer, c.department_id, v_team, v_subject, v_desc, coalesce(p_category, 'GENERAL'), 'MEDIUM', p_service, null)
  returning * into t;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, note, client_author)
  values (t.id, null, 'CREATED', 'OPEN', v_desc, true);
  perform private.client_notify(v_customer, 'TICKET_CREATED', format('Ticket %s created', t.ticket_no), v_subject, 'ticket', t.id, format('TKT|created|%s', t.id));
  perform private.log_customer_activity(v_customer, 'CLIENT_TICKET', format('Client raised ticket %s: %s', t.ticket_no, v_subject));
  perform private.write_audit('CLIENT_TICKET_CREATED', 'support_ticket', t.id, c.department_id, v_team, jsonb_build_object('ticket_no', t.ticket_no, 'customer_id', v_customer));
  perform private.notify(p.id, 'TICKET_FROM_CLIENT', format('New client ticket %s: %s', t.ticket_no, v_subject), left(v_desc, 300), 'support_ticket', t.id)
    from public.profiles p where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.team_id = v_team;
  return private.client_ticket_json(t);
end $$;

create or replace function public.client_reply_ticket(p_ticket uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  t public.support_tickets;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into t from public.support_tickets where id = p_ticket and customer_id = v_customer for update;
  if t.id is null then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null or length(v_msg) > 4000 then
    raise exception 'VALIDATION_ERROR: Write your reply (up to 4000 characters).' using errcode = 'P0001';
  end if;
  if t.status = 'CLOSED' then
    raise exception 'CONFLICT: This ticket is closed. Please raise a new ticket.' using errcode = 'P0001';
  end if;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_author)
  values (t.id, null, 'CLIENT_REPLY', v_msg, true);
  -- a reply on a resolved ticket, or one waiting for the client, goes back to Support
  if t.status in ('RESOLVED', 'WAITING_CUSTOMER') then
    update public.support_tickets set status = 'OPEN', resolved_at = null where id = t.id;
    insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, client_author)
    values (t.id, null, 'STATUS_CHANGED', t.status, 'OPEN', true);
  else
    update public.support_tickets set updated_at = now() where id = t.id;
  end if;
  perform private.notify(r.id, 'TICKET_CLIENT_REPLY', format('Client replied on %s', t.ticket_no), left(v_msg, 300), 'support_ticket', t.id)
    from (select p.id from public.profiles p where p.status = 'ACTIVE' and (p.id = t.assignee_id or (p.role = 'TEAM_HEAD' and p.team_id = t.team_id))) r;
  return public.client_ticket(t.id);
end $$;

-- Notifications
create or replace function public.client_notifications(p_limit integer default 30, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return jsonb_build_object(
    'unread', (select count(*) from public.client_notifications n where n.customer_id = v_customer and n.read_at is null),
    'total', (select count(*) from public.client_notifications n where n.customer_id = v_customer),
    'items', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', n.id, 'type', n.type, 'title', n.title, 'body', n.body, 'entityType', n.entity_type,
                                  'entityId', n.entity_id, 'readAt', n.read_at, 'createdAt', n.created_at) as x
          from public.client_notifications n where n.customer_id = v_customer
         order by n.created_at desc, n.id limit greatest(1, least(coalesce(p_limit, 30), 100)) offset greatest(0, coalesce(p_offset, 0))) q), '[]'::jsonb));
end $$;

-- p_ids null = mark every notification read
create or replace function public.client_mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_n integer;
begin
  update public.client_notifications set read_at = now()
   where customer_id = v_customer and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Overview
create or replace function public.client_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_services jsonb := public.client_services();
  v_invoices jsonb := public.client_invoices();
  v_tickets jsonb := public.client_tickets();
  v_plan jsonb := public.client_plans() -> 'current';
begin
  return jsonb_build_object(
    'profile', public.client_me(),
    'services', jsonb_build_object('total', jsonb_array_length(v_services),
      'live', (select count(*) from jsonb_array_elements(v_services) s where s ->> 'status' = 'LIVE'),
      'items', (select coalesce(jsonb_agg(s), '[]'::jsonb) from (select s from jsonb_array_elements(v_services) s limit 6) q)),
    'plan', v_plan,
    'invoices', jsonb_build_object('total', jsonb_array_length(v_invoices),
      'pending', (select count(*) from jsonb_array_elements(v_invoices) i where i ->> 'status' = 'Pending'),
      'recent', (select coalesce(jsonb_agg(i), '[]'::jsonb) from (select i from jsonb_array_elements(v_invoices) i limit 4) q)),
    'tickets', jsonb_build_object('total', jsonb_array_length(v_tickets),
      'open', (select count(*) from jsonb_array_elements(v_tickets) t where t ->> 'status' not in ('RESOLVED', 'CLOSED')),
      'recent', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select t from jsonb_array_elements(v_tickets) t limit 3) q)),
    'notifications', (select jsonb_build_object('unread', count(*) filter (where n.read_at is null),
        'recent', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'body', x.body, 'readAt', x.read_at, 'createdAt', x.created_at, 'entityType', x.entity_type, 'entityId', x.entity_id))
                              from (select * from public.client_notifications where customer_id = v_customer order by created_at desc limit 4) x), '[]'::jsonb))
                        from public.client_notifications n where n.customer_id = v_customer),
    'renewals', (select coalesce(jsonb_agg(r order by r ->> 'renewsOn'), '[]'::jsonb) from (
        select jsonb_build_object('kind', 'SERVICE', 'name', s ->> 'name', 'renewsOn', s ->> 'renewsOn') as r
          from jsonb_array_elements(v_services) s where s ->> 'renewsOn' is not null and (s ->> 'renewsOn')::date >= current_date
        union all select jsonb_build_object('kind', 'PLAN', 'name', v_plan ->> 'name', 'renewsOn', v_plan ->> 'renewsOn')
          where v_plan is not null and v_plan ->> 'renewsOn' is not null and (v_plan ->> 'renewsOn')::date >= current_date) q));
end $$;

do $$
declare
  f text;
begin
  foreach f in array array['client_me()', 'client_services()', 'client_service_catalog()', 'client_service_requests()', 'client_request_service(text, text)',
    'client_cancel_service_request(uuid)', 'client_plans()', 'client_request_plan(uuid, text)', 'client_invoices()', 'client_invoice_file(uuid)',
    'client_tickets()', 'client_ticket(uuid)', 'client_create_ticket(text, text, text, text)', 'client_reply_ticket(uuid, text)',
    'client_notifications(integer, integer)', 'client_mark_notifications_read(uuid[])', 'client_overview()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Internal sides of the new workflows
-- ---------------------------------------------------------------------------
-- Support: write a reply the client can read (internal notes stay internal)
create or replace function public.reply_to_client_ticket(p_ticket uuid, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  v_msg text := left(nullif(btrim(coalesce(p_message, '')), ''), 4000);
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  if v_msg is null then
    raise exception 'VALIDATION_ERROR: Write the reply for the customer.' using errcode = 'P0001';
  end if;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, note, client_visible) values (t.id, me.id, 'NOTE', v_msg, true);
  perform private.write_audit('TICKET_REPLIED_TO_CLIENT', 'support_ticket', t.id, t.department_id, t.team_id, jsonb_build_object('ticket_no', t.ticket_no));
end $$;
revoke all on function public.reply_to_client_ticket(uuid, text) from public, anon;
grant execute on function public.reply_to_client_ticket(uuid, text) to authenticated;

-- A client who is already a customer (onboarding handed over) can still ask for extra services. The Technical
-- Consultant's add-on work (price the request, send it to Accounts) normally closes at the hand-over; while the
-- customer has an OPEN service request from the client dashboard, the consultants of that department can work on it.
create or replace function private.can_manage_addons(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_support_department_id())
          and private.can_review_onboarding(p_customer))
      or (exists (select 1 from public.customers c
                   where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
                     and (c.department_id = private.my_support_department_id()
                          or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
                          or private.my_role() = 'SUPER_ADMIN'))
          and exists (select 1 from public.service_requests r where r.customer_id = p_customer and r.status in ('REQUESTED', 'IN_REVIEW', 'IN_ADDON_WORKFLOW')))
$$;
revoke all on function private.can_manage_addons(uuid) from public, anon;
grant execute on function private.can_manage_addons(uuid) to authenticated;

-- Technical Consultant: the services the client asked for, and the decision
create or replace function public.consultant_service_requests(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_manage_addons(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'serviceCode', r.service_code, 'serviceName', s.name, 'status', r.status,
                                                       'note', r.note, 'decisionNote', r.decision_note, 'createdAt', r.created_at, 'addonRequestId', r.addon_request_id)
                                    order by r.created_at desc)
                     from public.service_requests r join public.crm_services s on s.code = r.service_code where r.customer_id = p_customer), '[]'::jsonb);
end $$;
revoke all on function public.consultant_service_requests(uuid) from public, anon;
grant execute on function public.consultant_service_requests(uuid) to authenticated;

create or replace function public.consultant_decide_service_request(p_request uuid, p_decision text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.service_requests;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v public.customers;
begin
  select * into r from public.service_requests where id = p_request for update;
  if r.id is null or not private.can_manage_addons(r.customer_id) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('IN_REVIEW', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Choose In review or Declined.' using errcode = 'P0001';
  end if;
  if r.status not in ('REQUESTED', 'IN_REVIEW') then
    raise exception 'CONFLICT: This request is already %.', lower(replace(r.status, '_', ' ')) using errcode = 'P0001';
  end if;
  if p_decision = 'REJECTED' and v_note is null then
    raise exception 'VALIDATION_ERROR: Give the client a short reason.' using errcode = 'P0001';
  end if;
  update public.service_requests set status = p_decision, decision_note = coalesce(v_note, decision_note), handled_by = private.my_id() where id = r.id;
  select * into v from public.customers where id = r.customer_id;
  perform private.write_audit('SERVICE_REQUEST_DECIDED', 'customer', r.customer_id, v.department_id, v.team_id, jsonb_build_object('request_id', r.id, 'decision', p_decision));
end $$;
revoke all on function public.consultant_decide_service_request(uuid, text, text) from public, anon;
grant execute on function public.consultant_decide_service_request(uuid, text, text) to authenticated;

-- Accounts: monthly plans and the plan requests
create or replace function public.accounts_plans()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_accounts_staff();
  return jsonb_build_object(
    'plans', coalesce((select jsonb_agg(private.plan_json(p) || jsonb_build_object('isActive', p.is_active) order by p.sort_order, p.monthly_price) from public.monthly_plans p), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'customerId', r.customer_id, 'customer', coalesce(c.company, c.name),
                    'planId', r.plan_id, 'planName', p.name, 'monthlyPrice', p.monthly_price, 'kind', r.kind, 'status', r.status, 'note', r.note,
                    'decisionNote', r.decision_note, 'createdAt', r.created_at,
                    'currentPlan', (select p2.name from public.customer_plans cp join public.monthly_plans p2 on p2.id = cp.plan_id where cp.customer_id = r.customer_id and cp.status = 'ACTIVE'))
                    order by (r.status in ('REQUESTED', 'APPROVED')) desc, r.created_at desc)
                    from public.plan_requests r join public.monthly_plans p on p.id = r.plan_id join public.customers c on c.id = r.customer_id), '[]'::jsonb));
end $$;
revoke all on function public.accounts_plans() from public, anon;
grant execute on function public.accounts_plans() to authenticated;

create or replace function public.accounts_save_plan(p_id uuid, p_code text, p_name text, p_description text, p_price numeric,
                                                     p_features text[], p_services text[], p_active boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_features jsonb := to_jsonb(coalesce(array(select btrim(f) from unnest(p_features) f where btrim(f) <> ''), '{}'::text[]));
begin
  perform private.require_accounts_staff();
  if not private.is_accounts_manager() then
    raise exception 'FORBIDDEN: Only an Accounts team lead or head can change the plans.' using errcode = '42501';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'VALIDATION_ERROR: Enter the monthly price.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.monthly_plans (code, name, description, monthly_price, features, is_active, created_by)
    values (upper(btrim(p_code)), btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_price, v_features, coalesce(p_active, true), private.my_id())
    returning id into v_id;
  else
    update public.monthly_plans set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), monthly_price = p_price,
           features = v_features, is_active = coalesce(p_active, is_active) where id = p_id returning id into v_id;
    if v_id is null then
      raise exception 'NOT_FOUND: Plan not found.' using errcode = 'P0001';
    end if;
  end if;
  delete from public.monthly_plan_services where plan_id = v_id;
  insert into public.monthly_plan_services (plan_id, service_code)
  select v_id, s.code from public.crm_services s where s.code = any (coalesce(p_services, '{}'::text[]));
  perform private.write_audit('PLAN_SAVED', 'plan', v_id, null, null, jsonb_build_object('code', p_code, 'price', p_price));
  return v_id;
exception when unique_violation then
  raise exception 'CONFLICT: A plan with this code already exists.' using errcode = 'P0001';
end $$;
revoke all on function public.accounts_save_plan(uuid, text, text, text, numeric, text[], text[], boolean) from public, anon;
grant execute on function public.accounts_save_plan(uuid, text, text, text, numeric, text[], text[], boolean) to authenticated;

-- Accounts verifies a plan request; the plan starts only once the payment is confirmed.
create or replace function public.accounts_decide_plan_request(p_request uuid, p_decision text, p_note text default null,
                                                               p_payment_confirmed boolean default false, p_renews_on date default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.plan_requests;
  p public.monthly_plans;
  c public.customers;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 1000);
  v_new uuid;
begin
  perform private.require_accounts_staff();
  select * into r from public.plan_requests where id = p_request for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  if p_decision not in ('APPROVE', 'REJECT', 'ACTIVATE') then
    raise exception 'VALIDATION_ERROR: Choose Approve, Reject or Activate.' using errcode = 'P0001';
  end if;
  select * into p from public.monthly_plans where id = r.plan_id;
  select * into c from public.customers where id = r.customer_id;
  if p_decision = 'REJECT' then
    if r.status not in ('REQUESTED', 'APPROVED') then
      raise exception 'CONFLICT: This request is already %.', lower(r.status) using errcode = 'P0001';
    end if;
    if v_note is null then
      raise exception 'VALIDATION_ERROR: Give the client a short reason.' using errcode = 'P0001';
    end if;
    update public.plan_requests set status = 'REJECTED', decision_note = v_note, decided_by = private.my_id(), decided_at = now() where id = r.id;
  else
    if r.status not in ('REQUESTED', 'APPROVED') or (p_decision = 'ACTIVATE' and r.status <> 'APPROVED' and not coalesce(p_payment_confirmed, false)) then
      raise exception 'CONFLICT: Approve the request first, then activate it once the payment is confirmed.' using errcode = 'P0001';
    end if;
    if r.status = 'REQUESTED' then
      update public.plan_requests set status = 'APPROVED', decision_note = coalesce(v_note, decision_note), decided_by = private.my_id(), decided_at = now() where id = r.id;
    end if;
    if p_decision = 'ACTIVATE' or coalesce(p_payment_confirmed, false) then
      if not coalesce(p_payment_confirmed, false) then
        raise exception 'VALIDATION_ERROR: Confirm that the payment was received before activating the plan.' using errcode = 'P0001';
      end if;
      update public.customer_plans set status = 'ENDED', ended_at = current_date where customer_id = r.customer_id and status = 'ACTIVE';
      insert into public.customer_plans (customer_id, plan_id, status, started_at, renews_on, payment_status, price_at_start, request_id, activated_by)
      values (r.customer_id, r.plan_id, 'ACTIVE', current_date, coalesce(p_renews_on, current_date + 30), 'PAID', p.monthly_price, r.id, private.my_id())
      returning id into v_new;
      update public.plan_requests set status = 'ACTIVATED', updated_at = now() where id = r.id;
    end if;
  end if;
  perform private.write_audit('PLAN_REQUEST_DECIDED', 'customer', r.customer_id, c.department_id, c.team_id,
    jsonb_build_object('request_id', r.id, 'decision', p_decision, 'plan', p.code));
end $$;
revoke all on function public.accounts_decide_plan_request(uuid, text, text, boolean, date) from public, anon;
grant execute on function public.accounts_decide_plan_request(uuid, text, text, boolean, date) to authenticated;
