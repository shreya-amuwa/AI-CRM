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
