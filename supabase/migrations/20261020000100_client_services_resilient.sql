-- =============================================================================
-- Client dashboard: "My Services" must always load.
--
-- Problem: client_services() read customer_onboarding.client_status. That column comes from the
-- onboarding-automations migration (20261016000100). A project that has the client dashboard
-- migration but not that one got an error ("column client_status does not exist") for EVERY client,
-- so Overview showed "!" and My Services was empty - even though the Sales team had added services
-- to the customer (customer_services).
--
-- Now:
--  * The function no longer depends on that column: if it is missing, services are simply Live.
--  * Status rule is unchanged: "Live" when the team activated the service, or the Technical Consultant has not
--    set a client status other than COMPLETED; otherwise "Setting up". Every service the team added to the
--    customer is returned either way.
--  * The service's details (e.g. the WhatsApp API package: campaigns, messages bought / sent) are
--    returned so the client can see what was set up for them.
-- Idempotent. Nothing is deleted.
-- =============================================================================

create or replace function public.client_services()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_complete boolean := true;
begin
  -- Same rule as before: a service is Live unless the Technical Consultant set a client status that is not
  -- COMPLETED (an unset status counts as Live). Where the automations migration has not been applied there
  -- is no client status, so the column is read dynamically and everything is Live.
  begin
    execute 'select coalesce(o.client_status = ''COMPLETED'' or o.stage = ''COMPLETED'', true) from public.customer_onboarding o where o.customer_id = $1'
      into v_complete using v_customer;
  exception when undefined_column then
    v_complete := true;
  end;
  v_complete := coalesce(v_complete, true);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'category', s.category, 'description', s.description,
      'purchasedAt', cs.created_at, 'activatedAt', cs.activated_at, 'renewsOn', cs.renews_on,
      'status', case when cs.activated_at is not null or v_complete then 'LIVE' else 'SETTING_UP' end,
      'plan', (select p.name from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id
                join public.monthly_plan_services ps on ps.plan_id = p.id and ps.service_code = s.code
               where cp.customer_id = v_customer and cp.status = 'ACTIVE' limit 1),
      'details', coalesce(cs.details, '{}'::jsonb)) order by cs.created_at, s.name)
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   where cs.customer_id = v_customer), '[]'::jsonb);
end $$;
revoke all on function public.client_services() from public, anon;
grant execute on function public.client_services() to authenticated;
