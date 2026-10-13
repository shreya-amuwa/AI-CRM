-- =============================================================================
-- Wabastore Sales Super Admin: the whole My Leads pipeline.
--
--  * division_leads_overview now also returns the Customer onboarding counts and
--    the Part payments count of the sub-department (same predicates as
--    customer_pipeline_counts()), next to Leads and Potential.
--  * part_payments_list takes an optional department + division, so the Super
--    Admin sees the part payments of one sub-department only. The old
--    10-argument function is replaced by this one (every argument defaults, so
--    existing calls keep working).
-- Sub-department = department id + team division, never a name. Idempotent.
-- =============================================================================

drop function if exists public.part_payments_list(text, text, uuid, uuid, date, date, text, text, integer, integer);

create or replace function public.division_leads_overview(p_department_id uuid, p_division public.team_division)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_teams uuid[];
  v_members jsonb;
  v_totals jsonb;
  v_leads jsonb;
  v_potential jsonb;
  v_onboarding jsonb;
  v_part integer;
begin
  if not coalesce(private.my_role() = 'SUPER_ADMIN'
                  or (private.my_role() = 'DEPARTMENT_HEAD' and private.my_department_id() = p_department_id), false) then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head can view the team overview.' using errcode = '42501';
  end if;

  select coalesce(array_agg(t.id), '{}') into v_teams
    from public.teams t where t.department_id = p_department_id and t.division = p_division;

  select coalesce(jsonb_agg(m order by m ->> 'fullName'), '[]'::jsonb) into v_members
  from (
    select jsonb_build_object(
      'id', p.id,
      'fullName', p.full_name,
      'email', p.email,
      'role', p.role,
      'status', p.status,
      'teamId', p.team_id,
      'teamName', t.name,
      'leadsAdded', (select count(*) from public.customers c where c.created_by = p.id and c.team_id = any (v_teams)),
      'owned', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams)),
      'leads', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'),
      'new', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'NEW'),
      'contacted', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'CONTACTED'),
      'interested', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'INTERESTED'),
      'readyToBuy', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD' and c.lead_status = 'READY_TO_BUY'),
      'potential', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'POTENTIAL'),
      'onboarding', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'ONBOARDING'),
      'customers', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'CUSTOMER'),
      'followUpsOverdue', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'
                             and c.next_follow_up_at is not null and c.next_follow_up_at < now()),
      'followUpsToday', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'
                           and c.next_follow_up_at >= current_date and c.next_follow_up_at < current_date + 1),
      'noFollowUp', (select count(*) from public.customers c where c.owner_id = p.id and c.team_id = any (v_teams) and c.lifecycle_stage = 'LEAD'
                       and c.next_follow_up_at is null),
      'lastLeadAt', (select max(c.created_at) from public.customers c where c.created_by = p.id and c.team_id = any (v_teams))
    ) as m
    from public.profiles p
    join public.teams t on t.id = p.team_id
    where p.team_id = any (v_teams) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.status <> 'REJECTED'
  ) s;

  select jsonb_build_object(
    'members', (select count(*) from public.profiles p
                 where p.team_id = any (v_teams) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.status = 'ACTIVE'),
    'leadsAdded', count(*),
    'leads', count(*) filter (where lifecycle_stage = 'LEAD'),
    'potential', count(*) filter (where lifecycle_stage = 'POTENTIAL'),
    'onboarding', count(*) filter (where lifecycle_stage = 'ONBOARDING'),
    'customers', count(*) filter (where lifecycle_stage = 'CUSTOMER'),
    'followUpsOverdue', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at is not null and next_follow_up_at < now()),
    'followUpsToday', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at >= current_date and next_follow_up_at < current_date + 1),
    'noFollowUp', count(*) filter (where lifecycle_stage = 'LEAD' and next_follow_up_at is null))
    into v_totals
  from public.customers where team_id = any (v_teams);

  select jsonb_build_object(
    'all', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION'),
    'NEW', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'NEW'),
    'CONTACTED', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'CONTACTED'),
    'INTERESTED', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'INTERESTED'),
    'READY_TO_BUY', count(*) filter (where payment_workflow <> 'PENDING_PAYMENT_CONFIRMATION' and lead_status = 'READY_TO_BUY'),
    'WITH_ACCOUNTS', count(*) filter (where payment_workflow = 'PENDING_PAYMENT_CONFIRMATION'),
    'RETURNED', count(*) filter (where payment_workflow = 'RETURNED_FROM_ACCOUNTS'))
    into v_leads
  from public.customers where team_id = any (v_teams) and lifecycle_stage = 'LEAD';

  -- Same predicates as customer_pipeline_counts().potential
  select jsonb_build_object(
    'all', count(*),
    'AWAITING', count(*) filter (where not fully_paid and amount_received = 0 and payment_due_date >= current_date),
    'PART_PAID', count(*) filter (where not fully_paid and amount_received > 0 and payment_due_date >= current_date),
    'OVERDUE', count(*) filter (where not fully_paid and payment_due_date < current_date),
    'PAID', count(*) filter (where fully_paid))
    into v_potential
  from public.customers where team_id = any (v_teams) and lifecycle_stage = 'POTENTIAL';

  -- Same predicates as customer_pipeline_counts().onboarding
  select jsonb_build_object(
    'all', count(*),
    'RETURNED', count(*) filter (where returned),
    'WAITING_ON_CLIENT', count(*) filter (where not returned and saved = 0),
    'COLLECTING', count(*) filter (where not returned and saved > 0 and saved < total),
    'READY_FOR_HANDOVER', count(*) filter (where not returned and total > 0 and saved >= total),
    'GET_STARTED', count(*) filter (where get_started))
    into v_onboarding
  from (select coalesce(o.items_saved, 0) as saved, coalesce(o.items_total, 0) as total,
               o.returned_at is not null as returned, coalesce(o.get_started, false) as get_started
          from public.customers c
          left join public.customer_onboarding o on o.customer_id = c.id
         where c.team_id = any (v_teams) and c.lifecycle_stage = 'ONBOARDING') x;

  -- Same predicate as customer_pipeline_counts().partPayments
  select count(*) into v_part
    from public.customers c
   where c.team_id = any (v_teams) and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and c.payment_status = 'PARTIALLY_PAID'
     and exists (select 1 from public.customer_payments p where p.customer_id = c.id and p.status = 'VERIFIED' and p.payment_type = 'PART');

  return jsonb_build_object('teamIds', to_jsonb(v_teams), 'members', v_members, 'totals', v_totals, 'leads', v_leads, 'potential', v_potential,
                            'onboarding', v_onboarding, 'partPayments', v_part);
end $$;
revoke all on function public.division_leads_overview(uuid, public.team_division) from public, anon;
grant execute on function public.division_leads_overview(uuid, public.team_division) to authenticated;

create or replace function public.part_payments_list(
  p_status text default 'PARTIAL', p_search text default null, p_salesperson uuid default null,
  p_accounts_owner uuid default null, p_from date default null, p_to date default null,
  p_followup text default null, p_sort text default 'recent', p_page integer default 1, p_page_size integer default 20,
  p_department uuid default null, p_division text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_accounts boolean := private.is_accounts_staff();
  v_term text := nullif(lower(trim(coalesce(p_search, ''))), '');
  v_status text := coalesce(p_status, 'PARTIAL');
  v_sort text := coalesce(p_sort, 'recent');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_total integer;
  v_items jsonb;
  v_salespeople jsonb;
  v_accountants jsonb;
begin
  if v_status not in ('PARTIAL', 'PAID', 'RETURNED', 'ALL') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  if v_sort not in ('recent', 'balance', 'name', 'followUp') then
    raise exception 'VALIDATION_ERROR: Unknown sort.' using errcode = 'P0001';
  end if;
  if p_followup is not null and p_followup not in ('FOLLOW_UP_REQUIRED', 'CONTACTED', 'AWAITING_PAYMENT', 'FULLY_PAID') then
    raise exception 'VALIDATION_ERROR: Unknown follow-up status.' using errcode = 'P0001';
  end if;

  with base0 as (
    select c.id, c.customer_code, c.name, c.company, c.phone, c.email, c.lifecycle_stage, c.deal_amount, c.amount_verified,
           c.amount_received, c.payment_status, c.owner_id, c.accounts_owner_id,
           greatest(coalesce(c.deal_amount, 0) - c.amount_verified, 0) as balance,
           pp.last_paid_at, pp.last_amount, pp.n_verified, pp.last_verified_by, pp.pending_amount,
           f.next_at, f.last_at, f.last_outcome, f.n_followups,
           case when c.payment_status = 'FULLY_PAID' then 'FULLY_PAID'
                when f.last_outcome is null or f.last_outcome = 'NO_RESPONSE' or (f.next_at is not null and f.next_at <= now()) then 'FOLLOW_UP_REQUIRED'
                when f.last_outcome = 'AWAITING_PAYMENT' then 'AWAITING_PAYMENT'
                else 'CONTACTED' end as followup_status
      from public.customers c
      cross join lateral (
        select max(p.paid_at) filter (where p.status = 'VERIFIED') as last_paid_at,
               (array_agg(p.amount order by p.paid_at desc, p.recorded_at desc) filter (where p.status = 'VERIFIED'))[1] as last_amount,
               count(*) filter (where p.status = 'VERIFIED') as n_verified,
               (array_agg(p.verified_by order by p.paid_at desc, p.recorded_at desc) filter (where p.status = 'VERIFIED'))[1] as last_verified_by,
               coalesce(sum(p.amount) filter (where p.status = 'PENDING'), 0) as pending_amount,
               bool_or(p.status = 'VERIFIED' and p.payment_type = 'PART') as has_part
          from public.customer_payments p where p.customer_id = c.id) pp
      left join lateral (
        select (array_agg(f.next_follow_up_at order by f.contacted_at desc))[1] as next_at,
               max(f.contacted_at) as last_at,
               (array_agg(f.outcome order by f.contacted_at desc))[1] as last_outcome,
               count(*) as n_followups
          from public.payment_followups f where f.customer_id = c.id) f on true
     where pp.has_part
       and (v_accounts or private.can_access_customer(c.id))
       -- Super Admin / Department Head looking at one sub-department: only that division's teams.
       and (p_department is null or p_division is null or c.team_id in (
             select t.id from public.teams t where t.department_id = p_department and t.division::text = p_division))
       and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
       and (p_from is null or pp.last_paid_at >= p_from::timestamptz)
       and (p_to is null or pp.last_paid_at < (p_to + 1)::timestamptz)
  ), base as (
    select * from base0 b0
     where (p_salesperson is null or b0.owner_id = p_salesperson)
       and (p_accounts_owner is null or b0.accounts_owner_id = p_accounts_owner)
  ), filtered as (
    select * from base b
     where case v_status
             when 'PARTIAL' then b.payment_status = 'PARTIALLY_PAID' and b.lifecycle_stage not in ('LEAD', 'LOST')
             when 'PAID' then b.payment_status = 'FULLY_PAID'
             when 'RETURNED' then b.lifecycle_stage in ('LEAD', 'LOST') and b.payment_status <> 'FULLY_PAID'
             else true end
       and (p_followup is null or not v_accounts or b.followup_status = p_followup)
  )
  select (select count(*) from filtered), coalesce(jsonb_agg(row_json order by ord), '[]'::jsonb),
         -- Options for the Salesperson / Accountant filters: everyone with a part-paid customer in scope.
         (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'fullName', x.name) order by x.name), '[]'::jsonb)
            from (select distinct b.owner_id as id, (select full_name from public.profiles where id = b.owner_id) as name from base0 b) x),
         (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'fullName', x.name) order by x.name), '[]'::jsonb)
            from (select distinct b.accounts_owner_id as id, (select full_name from public.profiles where id = b.accounts_owner_id) as name
                    from base0 b where b.accounts_owner_id is not null) x)
    into v_total, v_items, v_salespeople, v_accountants
    from (
      select row_number() over (
               order by (case when v_sort = 'recent' then f.last_paid_at end) desc nulls last,
                        (case when v_sort = 'balance' then f.balance end) desc nulls last,
                        (case when v_sort = 'name' then lower(coalesce(f.company, f.name)) end) asc,
                        (case when v_sort = 'followUp' then f.next_at end) asc nulls first,
                        f.id) as ord,
             jsonb_build_object(
               'id', f.id, 'code', f.customer_code, 'name', f.name, 'company', f.company, 'phone', f.phone, 'email', f.email,
               'stage', f.lifecycle_stage,
               'onboarding', (select jsonb_build_object('stage', o.stage, 'state', o.onboarding_state, 'getStarted', o.get_started,
                                                        'paymentVerified', o.payment_verified)
                                from public.customer_onboarding o where o.customer_id = f.id),
               'services', coalesce((select jsonb_agg(s.name order by s.sort_order)
                                       from public.customer_services cs join public.crm_services s on s.code = cs.service_code
                                      where cs.customer_id = f.id), '[]'::jsonb),
               'dealAmount', f.deal_amount, 'amountVerified', f.amount_verified, 'pendingAmount', f.pending_amount,
               'balance', f.balance, 'paymentStatus', f.payment_status,
               'lastPaymentAt', f.last_paid_at, 'lastPaymentAmount', f.last_amount, 'verifiedPayments', f.n_verified,
               'verifiedBy', (select full_name from public.profiles where id = f.last_verified_by),
               'salesperson', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = f.owner_id),
               'accountsOwner', (select jsonb_build_object('id', p.id, 'fullName', p.full_name) from public.profiles p where p.id = f.accounts_owner_id),
               'followUp', case when v_accounts then jsonb_build_object(
                  'status', f.followup_status, 'lastAt', f.last_at, 'nextAt', f.next_at, 'count', f.n_followups) end) as row_json
        from (select * from filtered
               order by (case when v_sort = 'recent' then last_paid_at end) desc nulls last,
                        (case when v_sort = 'balance' then balance end) desc nulls last,
                        (case when v_sort = 'name' then lower(coalesce(company, name)) end) asc,
                        (case when v_sort = 'followUp' then next_at end) asc nulls first,
                        id
               limit v_size offset (v_page - 1) * v_size) f
    ) page;

  return jsonb_build_object('items', v_items, 'total', coalesce(v_total, 0), 'page', v_page, 'pageSize', v_size,
    'salespeople', coalesce(v_salespeople, '[]'::jsonb), 'accountants', case when v_accounts then coalesce(v_accountants, '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.part_payments_list(text, text, uuid, uuid, date, date, text, text, integer, integer, uuid, text) from public, anon;
grant execute on function public.part_payments_list(text, text, uuid, uuid, date, date, text, text, integer, integer, uuid, text) to authenticated;
