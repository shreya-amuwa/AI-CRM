-- Whether a service is live: the same rules as 20261205000400, but reading customer_onboarding.client_status through to_jsonb(), so the client's
-- services list still loads on a database where that column has not been added yet (the API test "services still load when
-- customer_onboarding.client_status is missing" failed intermittently because this function named the column directly). No change in behaviour
-- when the column exists. Safe to run again.
create or replace function private.client_service_state(p_customer uuid, p_service text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  sv public.crm_services;
  o public.customer_onboarding;
  c public.customers;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  if cs.customer_id is null then
    return 'SETTING_UP';
  end if;
  if cs.service_status is not null then
    return cs.service_status;
  end if;
  if cs.activated_at is not null then
    return 'LIVE';
  end if;
  select * into c from public.customers where id = p_customer;
  select * into o from public.customer_onboarding where customer_id = p_customer;
  select * into sv from public.crm_services where code = p_service;
  if c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING') then
    if sv.requires_technical_consultant and coalesce(o.verification_route, case when sv.requires_meta_verification then 'META' else 'TECHNICAL' end) = 'META'
       and (o.meta_completed_at is not null or (to_jsonb(o) ->> 'client_status') = 'COMPLETED') then
      return 'LIVE';
    end if;
    return 'SETTING_UP';
  end if;
  -- (before Phase C a WhatsApp customer was live once its status reached COMPLETED; that still holds)
  return case when coalesce((to_jsonb(o) ->> 'client_status') = 'COMPLETED' or o.stage = 'COMPLETED', true) then 'LIVE' else 'SETTING_UP' end;
end $$;
revoke all on function private.client_service_state(uuid, text) from public, anon, authenticated;
