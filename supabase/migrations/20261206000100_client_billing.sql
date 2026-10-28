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
