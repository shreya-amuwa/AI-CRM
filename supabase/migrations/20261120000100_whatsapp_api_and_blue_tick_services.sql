-- =============================================================================
-- Three WhatsApp services: "WhatsApp API + Blue Tick" (as before), "WhatsApp API" and "Blue Tick".
--
-- The catalogue (crm_services) is the only list of services, so the two new ones are two new rows. They need the same documents and
-- details as the combined service, so they get exactly the checklist items the combined service has (onboarding_item_services), and a
-- customer who buys any one of them is onboarded, and automated, the same way:
--   * WHATSAPP_API_BLUE_TICK  WhatsApp API + Blue Tick   (unchanged)
--   * WHATSAPP_API            WhatsApp API               (starts with WHATSAPP_API, so it also carries the message-package details and usage)
--   * BLUE_TICK               Blue Tick                  (the verification only: no message package)
-- Nothing existing is changed: customers, leads and invoices that hold the combined service keep it.
--   - Onboarding emails / WhatsApp (private.automation_eligible): Wabastore customers with ANY of the three.
--   - Excel import: a WhatsApp usage sheet for a customer who already holds "WhatsApp API" is saved under that service instead of
--     adding the combined one next to it. (The service name "WhatsApp API" in the sheet now means the new service; "WhatsApp API + Blue Tick"
--     still means the combined one.)
-- The checklist is copied when this runs. A document later added to the combined service is added to the other two the same way (or by
-- running this file again, which only adds what is missing).
-- Run after 20261119000100_bolify_call_payload.sql. Safe to run again.
-- =============================================================================

-- 1. The two services (everything but the code, name and place in the list is copied from the combined service)
-- A service added to the catalogue is announced to every client (pop-up, bell, Department Heads told). These two are the combined service
-- the company already sells, offered on its own, so nobody is told about them: what the insert announced is removed again.
do $$
declare
  v_new text[];
  v_ann uuid[];
begin
  with ins as (
    insert into public.crm_services (code, name, category, sort_order, is_active, description, starting_price, price_note, features, requires_technical_consultant, delivery_department_id)
    select v.code, v.name, s.category, v.sort_order, s.is_active, s.description, s.starting_price, s.price_note, s.features, s.requires_technical_consultant, s.delivery_department_id
      from public.crm_services s
     cross join (values ('WHATSAPP_API', 'WhatsApp API', 11), ('BLUE_TICK', 'Blue Tick', 12)) as v(code, name, sort_order)
     where s.code = 'WHATSAPP_API_BLUE_TICK'
    on conflict (code) do nothing
    returning code)
  select coalesce(array_agg(code), '{}') into v_new from ins;
  if cardinality(v_new) > 0 then
    select coalesce(array_agg(a.id), '{}') into v_ann from public.client_announcements a where a.kind = 'NEW_SERVICE' and a.service_code = any (v_new);
    delete from public.client_notifications where dedupe_key like 'ANN|%' and split_part(dedupe_key, '|', 2)::uuid = any (v_ann);
    delete from public.notifications where entity_type = 'client_announcement' and entity_id = any (v_ann);
    delete from public.client_announcements where id = any (v_ann);
  end if;
end $$;

-- 2. The same documents and details
insert into public.onboarding_item_services (item_code, service_code)
select m.item_code, v.code
  from public.onboarding_item_services m
 cross join (values ('WHATSAPP_API'), ('BLUE_TICK')) as v(code)
 where m.service_code = 'WHATSAPP_API_BLUE_TICK'
   and exists (select 1 from public.crm_services s where s.code = v.code)
on conflict do nothing;

-- 3. The onboarding emails / WhatsApp messages (Wabastore) follow any of the three
create or replace function private.automation_eligible(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
      join public.departments d on d.id = c.department_id
     where c.id = p_customer
       and d.slug = 'wabastore'
       and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
       and exists (select 1 from public.customer_services cs
                    where cs.customer_id = c.id and cs.service_code in ('WHATSAPP_API_BLUE_TICK', 'WHATSAPP_API', 'BLUE_TICK')))
$$;
revoke all on function private.automation_eligible(uuid) from public, anon, authenticated;

-- 4. Excel import: WhatsApp usage belongs to the WhatsApp service the customer already holds
create or replace function private.import_ensure_service(p_customer uuid, p_service text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_added integer;
begin
  if exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = p_service) then
    return false;
  end if;
  -- WhatsApp usage for a customer who already holds "WhatsApp API": no second WhatsApp service is added beside it
  if p_service = 'WHATSAPP_API_BLUE_TICK'
     and exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = 'WHATSAPP_API') then
    return false;
  end if;
  insert into public.customer_services (customer_id, service_code, service_status, activated_at)
  values (p_customer, p_service, 'LIVE', now())
  on conflict (customer_id, service_code) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform private.log_customer_activity(p_customer, 'CUSTOMER_IMPORTED',
      format('Service added from the Excel import: %s (it had usage data and no row in "2 Services")', (select s.name from public.crm_services s where s.code = p_service)));
  end if;
  return v_added > 0;
end $$;
revoke all on function private.import_ensure_service(uuid, text) from public, anon, authenticated;

create or replace function private.import_save_usage(p_customer uuid, p_service text, p_kind text, p_period text, p_metrics jsonb, p_as_of date, p_valid date)
returns void language sql security definer set search_path = '' as $$
  insert into public.service_usage as u (customer_id, service_code, kind, period, metrics, as_of, valid_until, updated_by)
  values (p_customer,
          -- WhatsApp usage is kept on the WhatsApp service the customer really holds
          case when p_service = 'WHATSAPP_API_BLUE_TICK'
                    and not exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = 'WHATSAPP_API_BLUE_TICK')
                    and exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and cs.service_code = 'WHATSAPP_API')
               then 'WHATSAPP_API' else p_service end,
          p_kind, p_period, p_metrics, coalesce(p_as_of, current_date), p_valid, private.my_id())
  on conflict (customer_id, service_code, kind, period) do update
    set metrics = excluded.metrics, as_of = excluded.as_of, valid_until = coalesce(excluded.valid_until, u.valid_until),
        updated_by = excluded.updated_by, updated_at = now()
$$;
revoke all on function private.import_save_usage(uuid, text, text, text, jsonb, date, date) from public, anon, authenticated;
