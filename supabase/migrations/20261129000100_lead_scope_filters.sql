-- =============================================================================
-- Lead filters for the Telecaller and Business Associate Lead sections:
--   All Leads | My Leads | Department Leads | To Accounts | Returned by Accounts
--
-- One place decides who sees which lead (private.lead_scope_ids); the list and the counts both read it, so a number beside a filter is
-- always the number of rows the filter shows. Additive: nothing that exists is changed, no table, column or policy is touched.
--
--   My Leads            leads I own
--   Department Leads    leads owned by the OTHER people of my department's Sales teams (read-only: editing, assigning and sending to Accounts
--                       stay with the owner, enforced by the existing functions and policies)
--   All Leads           mine + the department's
--   To Accounts         visible leads whose payment_workflow is PENDING_PAYMENT_CONFIRMATION (sent to Accounts, awaiting confirmation)
--   Returned by Accounts visible leads whose payment_workflow is RETURNED_FROM_ACCOUNTS (Accounts returned them; resubmitting is the existing
--                       "send to Accounts" action of the owner)
-- Only an active Telecaller or Business Associate of a Sales team may call these. Never another department, Support or company-wide.
-- The department's leads carry no private notes: notes are returned for my own leads only.
-- Safe to run again.
-- =============================================================================

create or replace function private.lead_scope_allowed()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
     where p.id = private.my_id() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER'
       and p.sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE') and t.division = 'SALES')
$$;
revoke all on function private.lead_scope_allowed() from public, anon;
grant execute on function private.lead_scope_allowed() to authenticated, service_role;

-- the ids of the leads of one filter, for the caller (a lead appears once whatever its related rows)
create or replace function private.lead_scope_ids(p_scope text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.id
    from public.customers c
   where c.lifecycle_stage = 'LEAD'
     and private.lead_scope_allowed()
     and (
          (p_scope in ('ALL', 'MINE', 'TO_ACCOUNTS', 'RETURNED') and c.owner_id = private.my_id())
       or (p_scope in ('ALL', 'DEPARTMENT', 'TO_ACCOUNTS', 'RETURNED')
           and c.owner_id <> private.my_id()
           and c.department_id = private.my_department_id()
           and exists (select 1 from public.teams t where t.id = c.team_id and t.department_id = c.department_id and t.division = 'SALES'))
     )
     and (p_scope <> 'TO_ACCOUNTS' or c.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION')
     and (p_scope <> 'RETURNED' or c.payment_workflow = 'RETURNED_FROM_ACCOUNTS')
$$;
revoke all on function private.lead_scope_ids(text) from public, anon;
grant execute on function private.lead_scope_ids(text) to authenticated, service_role;

-- what the Accounts workflow recorded for a lead: the latest request (who sent it, when, the agreed amount) and, when returned, who returned it,
-- when and why. Only the detail of a lead that is with Accounts or was returned by them; nothing is inferred.
create or replace function private.lead_accounts_json(p_customer uuid, p_workflow text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p_workflow in ('PENDING_PAYMENT_CONFIRMATION', 'RETURNED_FROM_ACCOUNTS') then (
    select jsonb_build_object(
      'status', r.status,
      'amount', r.agreed_amount,
      'submittedBy', sb.full_name,
      'submittedAt', r.requested_at,
      'salesNote', r.sales_note,
      'returnedBy', case when r.status = 'RETURNED' then rb.full_name end,
      'returnedAt', case when r.status = 'RETURNED' then r.resolved_at end,
      'reason', case when r.status = 'RETURNED' then r.resolution_note end)
      from public.payment_requests r
      left join public.profiles sb on sb.id = r.requested_by
      left join public.profiles rb on rb.id = r.resolved_by
     where r.customer_id = p_customer
     order by r.requested_at desc limit 1) end
$$;
revoke all on function private.lead_accounts_json(uuid, text) from public, anon;
grant execute on function private.lead_accounts_json(uuid, text) to authenticated, service_role;

create or replace function public.lead_scope_counts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.lead_scope_allowed() then raise exception 'FORBIDDEN: These lead filters are for Telecallers and Business Associates.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'all', (select count(*) from private.lead_scope_ids('ALL')),
    'mine', (select count(*) from private.lead_scope_ids('MINE')),
    'department', (select count(*) from private.lead_scope_ids('DEPARTMENT')),
    'toAccounts', (select count(*) from private.lead_scope_ids('TO_ACCOUNTS')),
    'returned', (select count(*) from private.lead_scope_ids('RETURNED')));
end $$;
revoke all on function public.lead_scope_counts() from public, anon;
grant execute on function public.lead_scope_counts() to authenticated;

drop function if exists public.lead_scope_list(text, text, text, text, integer, integer);
drop function if exists public.lead_scope_list(text, text, text, text, integer, integer, text, text);
create or replace function public.lead_scope_list(
  p_scope text, p_search text default null, p_source text default null, p_status text default null, p_page integer default 1, p_page_size integer default 20,
  p_temperature text default null, p_call_status text default null,
  p_service text default null, p_follow_from timestamptz default null, p_follow_to timestamptz default null, p_no_follow_up boolean default false, p_sort text default 'newest')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
begin
  if not private.lead_scope_allowed() then raise exception 'FORBIDDEN: These lead filters are for Telecallers and Business Associates.' using errcode = '42501'; end if;
  if p_scope is null or p_scope not in ('ALL', 'MINE', 'DEPARTMENT', 'TO_ACCOUNTS', 'RETURNED') then
    raise exception 'VALIDATION_ERROR: Unknown lead filter.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('NEW', 'CONTACTED', 'INTERESTED', 'READY_TO_BUY') then
    raise exception 'VALIDATION_ERROR: Unknown lead status.' using errcode = 'P0001';
  end if;
  if p_sort is not null and p_sort not in ('newest', 'followUp') then raise exception 'VALIDATION_ERROR: Unknown sort order.' using errcode = 'P0001'; end if;
  if p_temperature is not null and p_temperature not in ('HOT', 'WARM', 'COLD') then raise exception 'VALIDATION_ERROR: Unknown lead temperature.' using errcode = 'P0001'; end if;
  if p_call_status is not null and p_call_status not in ('PENDING', 'CONTACTED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'NOT_INTERESTED', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Unknown call status.' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from public.customers c
   where c.id in (select private.lead_scope_ids(p_scope))
     and (p_status is null or c.lead_status = p_status)
     and (p_source is null or c.lead_source = p_source)
     and (p_temperature is null or c.lead_temperature = p_temperature)
     and (p_call_status is null or c.call_status = p_call_status)
     and (p_service is null or exists (select 1 from public.customer_services sv where sv.customer_id = c.id and sv.service_code = p_service))
     and (p_follow_from is null or c.next_follow_up_at >= p_follow_from)
     and (p_follow_to is null or c.next_follow_up_at < p_follow_to)
     and (p_no_follow_up is not true or c.next_follow_up_at is null)
     and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.lead_source, ''))) > 0);

  return jsonb_build_object(
    'scope', p_scope, 'total', v_total, 'page', v_page, 'pageSize', v_size,
    'sources', coalesce((select jsonb_agg(distinct c.lead_source order by c.lead_source) from public.customers c where c.id in (select private.lead_scope_ids(p_scope)) and c.lead_source is not null), '[]'::jsonb),
    'statusCounts', coalesce((select jsonb_object_agg(s.lead_status, s.n) from (
        select c.lead_status, count(*) n from public.customers c where c.id in (select private.lead_scope_ids(p_scope)) group by c.lead_status) s), '{}'::jsonb),
    'items', coalesce((select jsonb_agg(x.j order by (case when p_sort = 'followUp' then x.fu end) asc nulls last, x.created_at desc, x.id) from (
        select c.id, c.created_at, c.next_follow_up_at as fu,
               case when c.owner_id = private.my_id() then private.telecaller_lead_json(c) else private.telecaller_lead_json(c) - 'notes' end
                 || jsonb_build_object(
                      'leadStatus', c.lead_status,
                      'paymentWorkflow', c.payment_workflow,
                      'nextFollowUpAt', c.next_follow_up_at,
                      'isMine', c.owner_id = private.my_id(),
                      'owner', jsonb_build_object('id', o.id, 'fullName', o.full_name),
                      'accounts', private.lead_accounts_json(c.id, c.payment_workflow)) as j
          from public.customers c
          left join public.profiles o on o.id = c.owner_id
         where c.id in (select private.lead_scope_ids(p_scope))
           and (p_status is null or c.lead_status = p_status)
           and (p_source is null or c.lead_source = p_source)
           and (p_temperature is null or c.lead_temperature = p_temperature)
           and (p_call_status is null or c.call_status = p_call_status)
           and (p_service is null or exists (select 1 from public.customer_services sv where sv.customer_id = c.id and sv.service_code = p_service))
           and (p_follow_from is null or c.next_follow_up_at >= p_follow_from)
           and (p_follow_to is null or c.next_follow_up_at < p_follow_to)
           and (p_no_follow_up is not true or c.next_follow_up_at is null)
           and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.email, '') || ' ' || coalesce(c.lead_source, ''))) > 0)
         order by (case when p_sort = 'followUp' then c.next_follow_up_at end) asc nulls last, c.created_at desc, c.id
         limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb));
end $$;
revoke all on function public.lead_scope_list(text, text, text, text, integer, integer, text, text, text, timestamptz, timestamptz, boolean, text) from public, anon;
grant execute on function public.lead_scope_list(text, text, text, text, integer, integer, text, text, text, timestamptz, timestamptz, boolean, text) to authenticated;
