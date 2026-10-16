-- =============================================================================
-- Client dashboard: "My Services" shows "Something went wrong".
--
-- Cause: GET /api/v1/client/services calls public.client_services(). When the database raises an error the API
-- cannot map (e.g. 42703 "column ... does not exist", 42P01 "relation ... does not exist", or PostgREST's
-- PGRST202 "function not in the schema cache"), the client sees only the generic INTERNAL message. The function
-- reads columns that come from several earlier migrations (customer_services.details / activated_at / renews_on,
-- crm_services.description, customer_onboarding.client_status). A project where one of those was not applied in
-- the SQL editor, or which still runs the first version of the function (static client_status read), fails for
-- every client - also on the Overview, which calls the same function.
--
-- Fix (idempotent, safe to rerun in the Supabase SQL editor, nothing is deleted):
--  1. Make sure every column the function reads exists (same definitions as the migrations that introduced them).
--  2. Recreate client_services() so the optional onboarding status cannot break it (a missing column OR table means
--     "Live", the same rule as before), details are always a JSON object and the active plan is looked up once.
--  3. Ask PostgREST to reload its schema cache so the API sees the function immediately.
-- Contract (shared/contracts.ts ClientService) and the Live / Setting up rule are unchanged.
-- =============================================================================

-- 1. Columns the function depends on
alter table public.customer_services add column if not exists details jsonb not null default '{}'::jsonb;
alter table public.customer_services
  add column if not exists activated_at timestamptz,
  add column if not exists renews_on date;
alter table public.crm_services add column if not exists description text check (length(description) <= 1000);

-- 2. The function (the customer always comes from the login, never from a parameter)
create or replace function public.client_services()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
  v_complete boolean := true;
  v_plan_id uuid;
  v_plan_name text;
begin
  -- A service is Live when the team activated it, or the Technical Consultant has not set a client status other
  -- than COMPLETED (an unset status counts as Live). Read dynamically: where the onboarding automations migration
  -- has not been applied there is no client status, and everything is Live.
  begin
    execute 'select coalesce(o.client_status = ''COMPLETED'' or o.stage = ''COMPLETED'', true) from public.customer_onboarding o where o.customer_id = $1'
      into v_complete using v_customer;
  exception when undefined_column or undefined_table then
    v_complete := true;
  end;
  v_complete := coalesce(v_complete, true);

  -- The customer's active monthly plan (at most one), to say which services it includes.
  select p.id, p.name into v_plan_id, v_plan_name
    from public.customer_plans cp join public.monthly_plans p on p.id = cp.plan_id
   where cp.customer_id = v_customer and cp.status = 'ACTIVE'
   order by cp.created_at desc
   limit 1;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'code', s.code, 'name', s.name, 'category', s.category, 'description', s.description,
      'purchasedAt', cs.created_at, 'activatedAt', cs.activated_at, 'renewsOn', cs.renews_on,
      'status', case when cs.activated_at is not null or v_complete then 'LIVE' else 'SETTING_UP' end,
      'plan', case when v_plan_id is not null and exists (
                select 1 from public.monthly_plan_services ps where ps.plan_id = v_plan_id and ps.service_code = s.code)
              then v_plan_name end,
      'details', case when jsonb_typeof(cs.details) = 'object' then cs.details else '{}'::jsonb end)
      order by cs.created_at, s.name)
    from public.customer_services cs join public.crm_services s on s.code = cs.service_code
   where cs.customer_id = v_customer), '[]'::jsonb);
end $$;
revoke all on function public.client_services() from public, anon;
grant execute on function public.client_services() to authenticated;

-- 3. Let the API see the (re)created function right away.
notify pgrst, 'reload schema';
