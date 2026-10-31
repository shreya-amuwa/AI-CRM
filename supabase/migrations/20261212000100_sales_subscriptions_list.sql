-- =============================================================================
-- Subscriptions list for the Sales / Business Associate dashboard (read only).
--
-- One row per service of each customer the signed-in employee may see (the same rule as the customer pages: the owner, the Team Head of the team, the
-- Department Head of the department, the Super Admin), with the plan, the duration, the subscription status, the panel creation date, the start and
-- expiry dates (empty until the panel is activated - see 20261210000200_subscription_activation.sql), the payment status of the order and whether the
-- client has a login. It reads what already exists: no table, no column, no copy of any record.
--   public.subscriptions_list(search, status, page, page_size)  -> { total, counts, page, pageSize, items[] }
-- Safe to run again. Nothing is changed in the data.
-- =============================================================================
create or replace function public.subscriptions_list(p_search text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_me uuid := (select private.my_id());
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := nullif(upper(btrim(coalesce(p_status, ''))), '');
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_today date := private.office_today();
  v_result jsonb;
begin
  if v_me is null or v_role is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if v_status is not null and v_status not in ('NOT_STARTED', 'ACTIVE', 'EXPIRED', 'PAUSED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown subscription status.' using errcode = 'P0001';
  end if;
  if v_search is not null then
    v_search := replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_');
  end if;

  with mine as (
    select c.id as customer_id, c.name, c.company, c.lifecycle_stage, c.payment_status,
           cs.service_code, s.name as service_name, cs, private.subscription_status(cs) as status,
           exists (select 1 from public.customer_client_accounts a where a.customer_id = c.id) as has_login
      from public.customers c
      join public.customer_services cs on cs.customer_id = c.id
      join public.crm_services s on s.code = cs.service_code
     where c.lifecycle_stage in ('POTENTIAL', 'ONBOARDING', 'CUSTOMER')
       and (v_role = 'SUPER_ADMIN'
         or (v_role = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
         or (v_role = 'TEAM_HEAD' and c.team_id = private.my_team_id())
         or (v_role = 'TEAM_MEMBER' and c.owner_id = v_me))
  ), found as (
    select * from mine
     where v_search is null
        or coalesce(name, '') ilike '%' || v_search || '%' escape '\'
        or coalesce(company, '') ilike '%' || v_search || '%' escape '\'
        or service_name ilike '%' || v_search || '%' escape '\'
        or coalesce((cs).plan_name, '') ilike '%' || v_search || '%' escape '\'
  ), shown as (
    select * from found where v_status is null or status = v_status
  )
  select jsonb_build_object(
    'total', (select count(*) from shown),
    'counts', jsonb_build_object(
      'all', (select count(*) from found),
      'active', (select count(*) from found where status = 'ACTIVE'),
      'notStarted', (select count(*) from found where status = 'NOT_STARTED'),
      'expired', (select count(*) from found where status = 'EXPIRED'),
      'accountsCreated', (select count(distinct customer_id) from found where has_login),
      'pendingPayments', (select count(distinct customer_id) from found where payment_status in ('NO_PAYMENT', 'PENDING_VERIFICATION', 'PARTIALLY_PAID'))),
    'page', v_page, 'pageSize', v_size,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'customerId', customer_id, 'customer', coalesce(nullif(btrim(company), ''), name), 'contact', name, 'lifecycleStage', lifecycle_stage,
        'service', service_code, 'serviceName', service_name,
        'plan', (cs).plan_name, 'durationLabel', private.duration_label((cs).duration_code, (cs).duration_months, (cs).duration_days),
        'amount', (cs).price, 'messageCredits', (cs).message_credits, 'status', status,
        'panelCreatedOn', (cs).panel_created_on, 'startedOn', (cs).started_on, 'expiresOn', (cs).renews_on,
        'daysLeft', case when (cs).started_on is not null and (cs).renews_on is not null then greatest((cs).renews_on - v_today, 0) end,
        'paymentStatus', payment_status, 'hasLogin', has_login)
        order by (status = 'ACTIVE') desc, (cs).renews_on nulls last, company, service_name)
        from (select * from shown order by (status = 'ACTIVE') desc, (cs).renews_on nulls last, company, service_name
               limit v_size offset (v_page - 1) * v_size) p), '[]'::jsonb))
    into v_result;
  return v_result;
end $$;
revoke all on function public.subscriptions_list(text, text, integer, integer) from public, anon;
grant execute on function public.subscriptions_list(text, text, integer, integer) to authenticated;

notify pgrst, 'reload schema';
