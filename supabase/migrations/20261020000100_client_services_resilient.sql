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
--  * The function no longer depends on that column: if it is missing, the onboarding stage alone decides.
--  * A service is "Live" when the team activated it, or the client's onboarding is completed (or
--    there is no onboarding to wait for); otherwise it is "Setting up". Every service the team added
--    to the customer is returned either way.
--  * The service's details (e.g. the WhatsApp API package: campaigns, messages bought / sent) are
--    returned so the client can see what was set up for them.
-- Idempotent. Nothing is deleted.
-- =============================================================================

create or replace function public.client_services()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_has_onboarding boolean;
  v_stage text;
  v_flag boolean;
  v_complete boolean := true;
begin
  select true, o.stage into v_has_onboarding, v_stage
    from public.customer_onboarding o where o.customer_id = v_customer;
  if coalesce(v_has_onboarding, false) then
    v_complete := (v_stage = 'COMPLETED');
    -- The Technical Consultant's client status (only where the automations migration has been applied).
    begin
      execute 'select client_status = ''COMPLETED'' from public.customer_onboarding where customer_id = $1' into v_flag using v_customer;
      v_complete := v_complete or coalesce(v_flag, false);
    exception when undefined_column then
      null;
    end;
  end if;

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
