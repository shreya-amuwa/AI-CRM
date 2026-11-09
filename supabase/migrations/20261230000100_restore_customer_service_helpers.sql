-- =============================================================================
-- Fix: "function private.normalize_service_list(jsonb) does not exist" when saving a customer.
--
-- private.normalize_service_list and private.save_customer_services are created ONLY by 20261009400000_customer_multiple_services.sql.
-- Every later version of create_support_customer / update_support_customer (20261123000100, 20261226000100 ...) calls them, so a
-- database where 20261009400000 was never run (or was skipped when the later migrations were pasted) fails on every customer save.
--
-- This migration recreates exactly those helpers with their original bodies, and the customer_services.details column they write.
-- It is additive and safe to run twice:
--   * it does NOT redefine create_support_customer / update_support_customer (the latest versions stay as they are);
--   * it does NOT change validation: an unknown, inactive or repeated service is still refused, and service details are still checked
--     by private.normalize_service_details (20261009000200);
--   * it does NOT change any customer or service row. (20261009400000 also copied each customer's single service into customer_services
--     once; that copy is not repeated here. The diagnostic below counts customers it would concern, so the owner can decide.)
-- Run after 20261229000200. A read-only check of the live database is in supabase/diagnostics/customer_service_helpers_check.sql.
-- =============================================================================

alter table public.customer_services add column if not exists details jsonb not null default '{}'::jsonb;

-- Validate and normalise a list of services: known, active, unique, details checked (unchanged from 20261009400000).
create or replace function private.normalize_service_list(p_services jsonb)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  e jsonb;
  v_code text;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
begin
  if p_services is null or jsonb_typeof(p_services) <> 'array' then
    return '[]'::jsonb;
  end if;
  if jsonb_array_length(p_services) > 25 then
    raise exception 'VALIDATION_ERROR: Add at most 25 services to one customer.' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_services) loop
    v_code := nullif(trim(coalesce(e ->> 'serviceCode', '')), '');
    if v_code is null then
      continue;
    end if;
    if not exists (select 1 from public.crm_services where code = v_code and is_active) then
      raise exception 'VALIDATION_ERROR: Choose a service from the list.' using errcode = 'P0001';
    end if;
    if v_code = any (v_seen) then
      raise exception 'VALIDATION_ERROR: The same service is added more than once.' using errcode = 'P0001';
    end if;
    v_seen := v_seen || v_code;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'serviceCode', v_code,
      'serviceDetails', private.normalize_service_details(v_code, e -> 'serviceDetails')));
  end loop;
  return v_out;
end $$;
grant execute on function private.normalize_service_list(jsonb) to authenticated;

-- Replace a customer's services with the (already normalised) list (unchanged from 20261009400000).
create or replace function private.save_customer_services(p_customer uuid, p_list jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.customer_services cs
   where cs.customer_id = p_customer
     and cs.service_code not in (select x ->> 'serviceCode' from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x);
  insert into public.customer_services (customer_id, service_code, details)
  select p_customer, x ->> 'serviceCode', coalesce(x -> 'serviceDetails', '{}'::jsonb)
    from jsonb_array_elements(coalesce(p_list, '[]'::jsonb)) x
  on conflict (customer_id, service_code) do update set details = excluded.details;
end $$;
revoke all on function private.save_customer_services(uuid, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
