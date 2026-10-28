-- =============================================================================
-- The 3 migrations of the client balance / Sales hand-off / Meta Verifier login-details fix, in order:
--   1. Client dashboard: the outstanding balance per order (total payable incl. GST - confirmed payments), kept live by payment events
--   2. Sales sends a WhatsApp-related customer to the Meta Verifier (the screen names the recipient; Blue Tick joins the Meta route)
--   3. Meta Verifier: client login details (WhatsApp panel account / user ID; no password is ever stored)
-- Paste the whole file into the Supabase SQL editor and run it once. Every part is safe to run again; no existing client login, password,
-- invoice, payment or customer is changed. Needs the role-redesign migrations (run_these_4_migrations_roles_provisioning.sql) to be in place already.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 20261206000100_client_billing.sql
-- -----------------------------------------------------------------------------
-- Client dashboard: what the client owes, per order.
--
-- What was wrong: the client could see invoices one by one, each with its own "Paid / Pending" badge, and the order-level balance
-- only inside an invoice's detail pop-up. An order that is not fully invoiced (or whose later payments belong to the order, not to one
-- invoice) therefore showed a paid invoice and NO amount due anywhere on the dashboard.
--
-- Now client_billing() gives, for the signed-in client's own customer only, one block per order (the agreed order and each add-on order):
--   total payable (GST included, the order's own authoritative figure) - confirmed payments - payments waiting for verification = balance.
-- It reuses the figures Accounts works from (private.order_summary: customers.deal_amount, amount_verified, amount_received; and
-- the add-on request's total against its own add-on payments), so the client and Accounts can never disagree. Pending payments never reduce the balance;
-- another order's payments are never deducted; an order whose GST rate Accounts has not chosen yet is shown as "being confirmed" with no
-- invented balance. Internal notes, staff names and other customers' data are not in the answer.
--
-- The dashboard refreshes when a payment is recorded, verified, rejected or reversed, or the order total changes: each writes a keyed
-- client notification, which the open dashboard already listens to (Supabase Realtime). Safe to run again.

create or replace function public.client_billing()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  c public.customers;
  o jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_title text;
  r record;
begin
  select * into c from public.customers where id = v_customer;

  -- the agreed order
  o := private.order_summary(v_customer);
  if o is not null and (coalesce((o ->> 'totalPayable')::numeric, 0) > 0 or coalesce((o ->> 'invoicedTotal')::numeric, 0) > 0) then
    select string_agg(sv.name, ', ' order by sv.sort_order) into v_title
      from public.customer_services cs join public.crm_services sv on sv.code = cs.service_code where cs.customer_id = v_customer;
    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'key', 'ORDER', 'kind', 'ORDER', 'title', coalesce(v_title, 'Your order'),
      'gstPending', coalesce((o ->> 'gstRequired')::boolean, false),
      'gstRate', o -> 'gstRate',
      'totalPayable', (o ->> 'totalPayable')::numeric,
      'confirmed', (o ->> 'confirmed')::numeric,
      'pending', (o ->> 'pending')::numeric,
      'balance', (o ->> 'balance')::numeric,
      'state', o ->> 'state',
      'invoicedTotal', (o ->> 'invoicedTotal')::numeric,
      'notYetInvoiced', greatest((o ->> 'totalPayable')::numeric - (o ->> 'invoicedTotal')::numeric, 0),
      'invoices', coalesce((
        select jsonb_agg(jsonb_build_object('id', a ->> 'id', 'number', a ->> 'number', 'total', (a ->> 'total')::numeric,
                 'allocated', (a ->> 'allocated')::numeric, 'balance', (a ->> 'balance')::numeric, 'state', a ->> 'state',
                 'status', i.status) order by ord)
          from jsonb_array_elements(coalesce(o -> 'invoices', '[]'::jsonb)) with ordinality as t(a, ord)
          join public.member_invoices i on i.id = (a ->> 'id')::uuid), '[]'::jsonb)));
  end if;

  -- each add-on order that has been invoiced: the request's total against its own add-on payments, exactly as Accounts sees it
  -- (an uploaded add-on invoice has no generated-invoice row, so the invoice summary is not the source here)
  for r in
    select q.id, q.invoice_id, q.total,
           coalesce(sum(p.amount) filter (where p.status = 'VERIFIED'), 0) as confirmed,
           coalesce(sum(p.amount) filter (where p.status = 'PENDING'), 0) as pending
      from public.addon_requests q
      left join public.addon_payments p on p.request_id = q.id
     where q.customer_id = v_customer and q.invoice_id is not null and q.status in ('INVOICE_GENERATED', 'PAYMENT_CONFIRMED', 'IN_PROGRESS', 'COMPLETED')
     group by q.id
     order by q.created_at
  loop
    select 'Add-on services: ' || string_agg(x.name, ', ' order by x.sort_order) into v_title from public.addon_request_items x where x.request_id = r.id;
    v_orders := v_orders || jsonb_build_array(jsonb_build_object(
      'key', 'ADDON|' || r.id, 'kind', 'ADDON', 'title', coalesce(v_title, 'Add-on services'),
      'gstPending', false, 'gstRate', null,
      'totalPayable', r.total, 'confirmed', least(r.confirmed, r.total), 'pending', r.pending,
      'balance', greatest(r.total - r.confirmed, 0),
      'state', case when r.total > 0 and r.confirmed >= r.total then 'FULLY_PAID' when r.confirmed > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
      'invoicedTotal', r.total, 'notYetInvoiced', 0,
      'invoices', jsonb_build_array(jsonb_build_object('id', r.invoice_id, 'number', (select invoice_number from public.member_invoices where id = r.invoice_id),
                 'total', r.total, 'allocated', least(r.confirmed, r.total), 'balance', greatest(r.total - r.confirmed, 0),
                 'state', case when r.total > 0 and r.confirmed >= r.total then 'FULLY_PAID' when r.confirmed > 0 then 'PARTIALLY_PAID' else 'UNPAID' end,
                 'status', (select status from public.member_invoices where id = r.invoice_id)))));
  end loop;

  return jsonb_build_object(
    'orders', v_orders,
    'totals', jsonb_build_object(
      'payable', coalesce((select sum((x ->> 'totalPayable')::numeric) from jsonb_array_elements(v_orders) x where not (x ->> 'gstPending')::boolean), 0),
      'confirmed', coalesce((select sum((x ->> 'confirmed')::numeric) from jsonb_array_elements(v_orders) x where not (x ->> 'gstPending')::boolean), 0),
      'pending', coalesce((select sum((x ->> 'pending')::numeric) from jsonb_array_elements(v_orders) x), 0),
      'outstanding', coalesce((select sum((x ->> 'balance')::numeric) from jsonb_array_elements(v_orders) x where not (x ->> 'gstPending')::boolean), 0)));
end $$;
revoke all on function public.client_billing() from public, anon;
grant execute on function public.client_billing() to authenticated;

-- ---------------------------------------------------------------------------
-- The dashboard follows the money: every payment status change and every change of the order total tells the client's open page
-- (a keyed notification, once per change)
-- ---------------------------------------------------------------------------
create or replace function private.tg_client_payment_events()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'VERIFIED' and (tg_op = 'INSERT' or old.status is distinct from 'VERIFIED') then
    perform private.client_notify(new.customer_id, 'PAYMENT_VERIFIED', 'Payment verified',
      format('Accounts verified your payment of %s.', private.rupees(new.amount)), null, null, format('PAY|%s|%s', tg_table_name, new.id));
  elsif new.status = 'PENDING' and tg_op = 'INSERT' then
    perform private.client_notify(new.customer_id, 'PAYMENT_RECEIVED', 'Payment recorded',
      format('Accounts recorded your payment of %s. It counts once it is verified.', private.rupees(new.amount)), null, null, format('PAYREC|%s|%s', tg_table_name, new.id));
  elsif tg_op = 'UPDATE' and new.status in ('REJECTED', 'REVERSED') and old.status is distinct from new.status then
    perform private.client_notify(new.customer_id, 'PAYMENT_UPDATED', 'A payment was updated',
      format('Accounts updated a payment of %s. Your balance has been recalculated.', private.rupees(new.amount)), null, null,
      format('PAYUPD|%s|%s|%s', tg_table_name, new.id, new.status));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_payment_events() from public, anon, authenticated;

create or replace function private.tg_client_order_total()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deal_amount is distinct from old.deal_amount and old.deal_amount is not null then
    perform private.client_notify(new.id, 'ORDER_TOTAL_UPDATED', 'Your order total was updated',
      'Accounts confirmed the final amount payable for your order, including GST.', null, null, format('ORDTOT|%s|%s', new.id, new.deal_amount));
  end if;
  return null;
end $$;
revoke all on function private.tg_client_order_total() from public, anon, authenticated;
drop trigger if exists customers_client_order_total on public.customers;
create trigger customers_client_order_total after update on public.customers
  for each row execute function private.tg_client_order_total();

notify pgrst, 'reload schema';


-- -----------------------------------------------------------------------------
-- 20261206000200_sales_meta_verifier_handoff.sql
-- -----------------------------------------------------------------------------
-- Sales sends a WhatsApp-related customer to the Meta Verifier, and says so.
--
-- What was wrong: the routing itself already existed (crm_services.requires_meta_verification -> customer_onboarding.verification_route, a
-- route-aware review check, a Meta Verifier queue), but nothing told Sales: the button always said "Send to Technical Consultant", a repeat
-- send answered "Already sent to the Technical Consultant" for a Meta customer, and a department without a Meta Verifier was only discovered
-- AFTER the click. The standalone Blue Tick service was also not on the Meta route.
--
-- Now: onboarding_handoff_info() tells the Sales screen where this customer will go (from the same route the database enforces) and whether
-- that person exists; the send and duplicate-send messages name the right role. The route is still decided and enforced only in the database
-- (forward_to_consultant, can_review_onboarding); the screen only reads it. Safe to run again.

-- Blue Tick is verified by Meta as well (the catalogue is data: Super Admin can still switch it in Workflow settings)
update public.crm_services set requires_meta_verification = true
 where code = 'BLUE_TICK' and not requires_meta_verification
   -- unless the Super Admin has already decided it either way
   and not exists (select 1 from public.audit_logs a where a.action = 'SERVICE_META_VERIFICATION_SET' and a.metadata ->> 'code' = 'BLUE_TICK');

-- Where will this customer go, and is anybody there to receive it
create or replace function public.onboarding_handoff_info(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.customers;
  v_route text;
begin
  if not private.can_access_customer(p_id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_id;
  v_route := private.onboarding_route(p_id);
  return jsonb_build_object(
    'route', v_route,
    'recipient', case when v_route = 'META' then 'Meta Verifier' else 'Technical Consultant' end,
    'recipientAvailable', exists (
      select 1 from public.profiles p join public.teams t on t.id = p.team_id
       where p.status = 'ACTIVE' and t.division = 'SUPPORT' and p.department_id = v.department_id
         and case when v_route = 'META' then p.is_meta_verifier else p.is_technical_consultant end));
end $$;
revoke all on function public.onboarding_handoff_info(uuid) from public, anon;
grant execute on function public.onboarding_handoff_info(uuid) to authenticated;

-- Sales' send: the same checks as before; only the wording follows the route
create or replace function public.forward_onboarding_to_support(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.customers := private.lock_accessible_customer(p_id);
  o public.customer_onboarding;
  v_missing text;
  v_recipient uuid;
  v_who text := case when private.onboarding_route(p_id) = 'META' then 'Meta Verifier' else 'Technical Consultant' end;
begin
  if v.lifecycle_stage <> 'ONBOARDING' then
    raise exception 'CONFLICT: This customer is not in onboarding.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_id;
  if o.forwarded_to_support_at is not null then
    raise exception 'CONFLICT: Already sent to the %.', v_who using errcode = 'P0001';
  end if;
  if o.sent_to_accounts_at is not null and o.accounts_confirmed_at is null then
    raise exception 'CONFLICT: Already sent to Accounts. Waiting for their confirmation.' using errcode = 'P0001';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
  from private.customer_items(p_id) i
  where not exists (select 1 from public.customer_onboarding_entries e
                    where e.customer_id = p_id and e.item_code = i.code and e.status in ('SAVED', 'VERIFIED'));
  if v_missing is not null then
    raise exception 'VALIDATION_ERROR: Complete these items first: %.', v_missing using errcode = 'P0001';
  end if;

  -- Amount already confirmed (the verifier sent it back): no second round with Accounts.
  if o.accounts_confirmed_at is not null then
    perform private.forward_to_consultant(p_id, v, o.returned_at is not null);
    return;
  end if;

  update public.customer_onboarding
     set sent_to_accounts_at = now(), sent_to_accounts_by = (select private.my_id())
   where customer_id = p_id;
  perform private.log_customer_activity(p_id, 'SENT_TO_ACCOUNTS', 'Sent to Accounts to confirm the amount');
  perform private.write_audit('ONBOARDING_SENT_TO_ACCOUNTS', 'customer', p_id, v.department_id, v.team_id,
    jsonb_build_object('deal_amount', v.deal_amount, 'amount_received', v.amount_received));

  for v_recipient in
    select p.id from public.profiles p join public.departments d on d.id = p.department_id
    where p.status = 'ACTIVE' and d.slug = 'accounts'
  loop
    perform private.notify(v_recipient, 'SENT_TO_ACCOUNTS', format('Confirm the amount: %s', coalesce(v.company, v.name)),
      'Sales sent a new customer for payment confirmation.', 'customer', p_id);
  end loop;
end $$;
revoke all on function public.forward_onboarding_to_support(uuid) from public, anon;
grant execute on function public.forward_onboarding_to_support(uuid) to authenticated;

notify pgrst, 'reload schema';


-- -----------------------------------------------------------------------------
-- 20261206000300_meta_verifier_panel_details.sql
-- -----------------------------------------------------------------------------
-- Meta Verifier: the client's login details for the internal WhatsApp panel.
--
-- No new fields. The panel details of a service already have a home: customer_services.platform (which panel) and
-- customer_services.panel_account (the account / user ID on it). Until now they could only arrive through the Excel import, and the client
-- reads them in My Services. This gives the Meta Verifier (and the Technical Consultant on the other route, the Department Head and the Super
-- Admin) one place to record them for the customer's WhatsApp services, with:
--   - the same access rule as the review itself (route-aware: a Meta customer is the Meta Verifier's, not the Technical Consultant's);
--   - plain validation of an account / user ID (an e-mail or a short ID) - a field that looks like it holds a password is refused;
--   - no password column, no password in notes, activity or audit (the audit keeps WHICH service and WHAT kind of field changed, never a value);
--   - nothing else moves: no client status, no message, no automation job (the progress trigger watches other columns).
-- The Client Dashboard login itself stays Accounts' (client_account_* in migration 20261205000300); the section shows it read only.
-- Safe to run again.

-- Who may record or change the panel details of this customer
create or replace function private.can_manage_panel_details(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
     where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
       and (private.can_review_onboarding(p_customer)
            or private.my_role() = 'SUPER_ADMIN'
            or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())))
$$;
revoke all on function private.can_manage_panel_details(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_panel_details(uuid) to authenticated, service_role;

-- What the section shows: the customer's Meta-route services with their panel details, and the dashboard login (read only)
create or replace function public.panel_details_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_can boolean := private.can_manage_panel_details(p_customer);
begin
  -- readable by whoever manages it, and by the verifier's own department after the hand-over (they still need to see what was recorded)
  if not v_can and not (private.can_access_customer(p_customer)
       and exists (select 1 from public.customers c where c.id = p_customer and c.department_id = private.my_verifier_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'canEdit', v_can,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'platform', cs.platform, 'panelAccount', cs.panel_account) order by s.sort_order, s.code)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = p_customer and s.requires_meta_verification), '[]'::jsonb),
    'dashboardLogin', (select jsonb_build_object('email', a.email, 'createdAt', a.created_at) from public.customer_client_accounts a where a.customer_id = p_customer));
end $$;
revoke all on function public.panel_details_list(uuid) from public, anon;
grant execute on function public.panel_details_list(uuid) to authenticated;

-- Record the panel details of one WhatsApp service. Empty clears a value.
create or replace function public.panel_details_set(p_customer uuid, p_service text, p_platform text, p_account text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_platform text := nullif(btrim(coalesce(p_platform, '')), '');
  v_account text := nullif(btrim(coalesce(p_account, '')), '');
  v_old public.customer_services;
  v_name text;
  v_changed text[] := '{}';
begin
  if not private.can_manage_panel_details(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v_old from public.customer_services cs
   where cs.customer_id = p_customer and cs.service_code = p_service
     and exists (select 1 from public.crm_services s where s.code = cs.service_code and s.requires_meta_verification)
   for update;
  if not found then
    raise exception 'NOT_FOUND: That is not a WhatsApp service of this customer.' using errcode = 'P0001';
  end if;
  if v_platform is not null and (length(v_platform) > 120 or v_platform !~ '^[A-Za-z0-9][A-Za-z0-9 ._/()+&-]*$') then
    raise exception 'VALIDATION_ERROR: The panel name can have letters, numbers and . _ / ( ) + & - only, up to 120 characters.' using errcode = 'P0001';
  end if;
  if v_account is not null then
    -- an account / user ID: an e-mail address or a short ID. Anything that looks like a password or a "user:password" pair is refused.
    if length(v_account) < 3 or length(v_account) > 200 or v_account !~ '^[A-Za-z0-9][A-Za-z0-9._@+-]*$' then
      raise exception 'VALIDATION_ERROR: Enter the account or user ID as an e-mail address or an ID (letters, numbers and . _ @ + - only, 3 to 200 characters, no spaces).' using errcode = 'P0001';
    end if;
    if v_account ~* '(passw|pwd|secret|token)' then
      raise exception 'VALIDATION_ERROR: This is for the account or user ID only. Never type a password here.' using errcode = 'P0001';
    end if;
  end if;

  if v_platform is distinct from v_old.platform then v_changed := array_append(v_changed, 'platform'); end if;
  if v_account is distinct from v_old.panel_account then v_changed := array_append(v_changed, 'account'); end if;
  if cardinality(v_changed) = 0 then
    return;  -- nothing changed: no write, no history
  end if;
  update public.customer_services set platform = v_platform, panel_account = v_account
   where customer_id = p_customer and service_code = p_service;
  select name into v_name from public.crm_services where code = p_service;
  perform private.log_customer_activity(p_customer, 'PANEL_DETAILS_SAVED', format('Panel login details saved for %s (%s)', v_name, array_to_string(v_changed, ', ')));
  -- which service and which kind of field - never the values
  perform private.write_audit('SERVICE_PANEL_DETAILS_SET', 'customer', p_customer,
    (select department_id from public.customers where id = p_customer), (select team_id from public.customers where id = p_customer),
    jsonb_build_object('service', p_service, 'fields', to_jsonb(v_changed)));
end $$;
revoke all on function public.panel_details_set(uuid, text, text, text) from public, anon;
grant execute on function public.panel_details_set(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';

