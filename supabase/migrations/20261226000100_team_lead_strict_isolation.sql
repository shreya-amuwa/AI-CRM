-- =============================================================================
-- Strict Team Lead isolation, part 2: the places 20261225000100_team_lead_direct_scope.sql did not reach.
-- Run after 20261225000200_leave_multi_level.sql. Safe to run again. No row is deleted, moved or re-decided; no column is dropped.
--
-- ROOT CAUSE that remained: 20261223000100 gave every Team Member ONE direct Team Lead (profiles.manager_id, read by private.direct_lead_of) and
-- 20261225000100 used it for the lists, reports, tasks, customers and tickets. These other checks still said "a Team Lead may act on anyone of the
-- same TEAM", so when two Team Leads share a team, Team Lead A could still:
--   * edit, suspend, revoke, remove or change the role of Team Lead B's members (private.actor_can_manage_profile -> can_manage_profile);
--   * list Team Lead B's members with their metrics on the Performance page (public.performance_people);
--   * read B's members' follow-ups / workspace rows and customers through the helper checks (private.can_view_owner, private.can_access_customer,
--     private.may_update_support_customer, update_support_customer, subscriptions_list) and write B's customers (customers insert / update / delete rules);
--   * hand tickets and customers to B's members (private.can_assign_ticket_to, private.can_assign_customer_owner);
--   * read B's invoice requests and audit log lines (invoice_requests_select, audit_logs_select);
--   * message B's members with a team announcement, and receive B's members' ticket / customer / invoice / report notifications.
-- And the Department Head's "Assign to Team Lead" (assign_member_to_team_lead) moved only the TEAM: it never named the lead, refused a second lead of
-- the same team ("already under that Team Lead"), and left a member moved into a team with two leads with no lead at all. The Department Head's
-- directory and the leaderboard showed "the first Team Lead of the team by name" instead of the member's own lead.
--
-- WHAT CHANGES: each Team Lead branch above additionally requires the person the row belongs to to be the lead or one of the lead's direct members
-- (private.led_by / private.lead_sees / private.direct_lead_of from 20261223000100 and 20261225000100). A team with ONE Team Lead behaves exactly as
-- before. Department Head, Operations Head and Super Admin branches are unchanged. A member with no resolvable lead is visible to no Team Lead and
-- stays visible to the Department Head / Super Admin, who assign one with "Assign to Team Lead" (now also within the same team); a reassignment
-- moves only PENDING stage-1 reports (history kept, decided reports untouched) and is written to team_assignments and the audit log.
-- =============================================================================

-- 1. A Team Lead changes (edits, suspends, revokes, removes, re-roles) only their OWN Team Members.
-- (latest definition: 20261123000100_department_scopes.sql; only the Team Lead condition changes)
create or replace function private.actor_can_manage_profile(p_actor uuid, p_target uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_target public.profiles;
begin
  if p_actor is null or p_target is null or p_actor = p_target then
    return false;
  end if;
  select * into v_me from public.profiles where id = p_actor and status = 'ACTIVE';
  select * into v_target from public.profiles where id = p_target;
  if v_me.id is null or v_target.id is null then
    return false;
  end if;
  return case v_me.role
    when 'SUPER_ADMIN' then v_target.role <> 'SUPER_ADMIN'
    when 'DEPARTMENT_HEAD' then v_target.role in ('TEAM_HEAD', 'TEAM_MEMBER')
                                and v_target.department_id = private.scoped_department(v_me.id, v_me.department_id)
    when 'TEAM_HEAD' then v_target.role = 'TEAM_MEMBER'
                          and v_target.team_id = v_me.team_id
                          and private.direct_lead_of(v_target.id) is not distinct from v_me.id
    else false
  end;
end $$;

-- 2. Performance page: a Team Lead lists only their own Team Members.
-- (latest definition: 20261121000100_sales_department_head.sql; only the Team Lead condition changes)
create or replace function public.performance_people(p_kind text, p_start date, p_end date, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.my_role();
  v_dept uuid;
  v_team uuid := private.my_team_id();
  v_today date := private.hr_today();
  v_people jsonb;
  v_teams jsonb := '[]'::jsonb;
  v_dep jsonb;
begin
  perform private.perf_check_period(p_kind, p_start, p_end);
  if v_role = 'SUPER_ADMIN' then
    v_dept := p_department;
    if v_dept is null then raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = 'P0001'; end if;
  elsif v_role = 'DEPARTMENT_HEAD' then
    v_dept := private.my_department_id();
  elsif v_role = 'TEAM_HEAD' then
    v_dept := private.my_department_id();
  else
    raise exception 'FORBIDDEN: Performance reports are for Team Leads and Department Heads.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(x order by (x ->> 'teamName'), (x ->> 'role') desc, (x ->> 'name')), '[]'::jsonb) into v_people from (
    select jsonb_build_object('scope', 'MEMBER', 'id', p.id, 'name', p.full_name, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
             'teamId', p.team_id, 'teamName', coalesce(t.name, ''), 'position', p.position,
             'summary', private.perf_metrics('MEMBER', p.id, p.team_id, p.department_id, p_start, p_end, v_today, true),
             'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                          from public.performance_reports r where r.scope = 'MEMBER' and r.subject_id = p.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
      from public.profiles p left join public.teams t on t.id = p.team_id
     where p.status = 'ACTIVE' and p.department_id = v_dept and p.role in ('TEAM_HEAD', 'TEAM_MEMBER') and p.id <> private.my_id() and private.sales_scope_team(p.team_id)
       and (v_role <> 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and p.team_id = v_team and private.direct_lead_of(p.id) is not distinct from private.my_id()))) q;

  if v_role in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v_teams from (
      select jsonb_build_object('scope', 'TEAM', 'id', t.id, 'name', t.name,
               'lead', (select h.full_name from public.profiles h where h.team_id = t.id and h.role = 'TEAM_HEAD' and h.status = 'ACTIVE' order by h.created_at limit 1),
               'members', (select count(*) from public.profiles m where m.team_id = t.id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE'),
               'summary', private.perf_metrics('TEAM', null, t.id, t.department_id, p_start, p_end, v_today, true),
               'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                            from public.performance_reports r where r.scope = 'TEAM' and r.team_id = t.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
        from public.teams t where t.department_id = v_dept and private.sales_scope_team(t.id)) q;
    select jsonb_build_object('scope', 'DEPARTMENT', 'id', d.id, 'name', d.name,
             'summary', private.perf_metrics('DEPARTMENT', null, null, d.id, p_start, p_end, v_today, true),
             'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                          from public.performance_reports r where r.scope = 'DEPARTMENT' and r.department_id = d.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end))
      into v_dep from public.departments d where d.id = v_dept and not private.is_sales_head();   -- the whole-department report includes Support
  elsif v_role = 'TEAM_HEAD' and v_team is not null then
    -- a Team Lead reads their own team's overall report
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_teams from (
      select jsonb_build_object('scope', 'TEAM', 'id', t.id, 'name', t.name, 'lead', null,
               'members', (select count(*) from public.profiles m where m.team_id = t.id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE'),
               'summary', private.perf_metrics('TEAM', null, t.id, t.department_id, p_start, p_end, v_today, true),
               'report', (select jsonb_build_object('id', r.id, 'generatedAt', r.generated_at, 'checkedAt', r.checked_at, 'narrativeSource', r.narrative_source, 'aiStatus', r.ai_status)
                            from public.performance_reports r where r.scope = 'TEAM' and r.team_id = t.id and r.period_kind = p_kind and r.period_start = p_start and r.period_end = p_end)) as x
        from public.teams t where t.id = v_team) q;
  end if;
  return jsonb_build_object('period', jsonb_build_object('kind', p_kind, 'start', p_start, 'end', p_end), 'today', v_today,
                            'people', v_people, 'teams', v_teams, 'department', v_dep, 'role', v_role);
end $$;
revoke all on function public.performance_people(text, date, date, uuid) from public, anon;
grant execute on function public.performance_people(text, date, date, uuid) to authenticated;

-- 3a. Rows owned by a person (follow-ups, workspace items): a Team Lead reads their own and their own members' only.
-- (latest definition: 20261007000200_member_workspace.sql; only the Team Lead condition changes)
create or replace function private.can_view_owner(p_owner uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_owner = private.my_id()
    or private.my_role() = 'SUPER_ADMIN'
    or exists (
      select 1 from public.profiles p
      where p.id = p_owner
        and ((private.my_role() = 'DEPARTMENT_HEAD' and p.department_id = private.my_department_id())
          or (private.my_role() = 'TEAM_HEAD' and p.team_id = private.my_team_id() and private.led_by(private.my_id(), p.id)))
    )
$$;

-- 3b. A customer of the lead's team: for a Team Lead, only one owned by them or by one of their own members (as customers_select). A customer formally handed to a lead keeps its own, separate checks.
-- (latest definition: 20261007000300_lead_lifecycle_onboarding.sql; only the Team Lead condition changes)
create or replace function private.can_access_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(c.team_id, c.owner_id))
        or (private.my_role() = 'TEAM_MEMBER' and c.owner_id = private.my_id()))
  )
$$;
revoke all on function private.can_access_customer(uuid) from public, anon;
grant execute on function private.can_access_customer(uuid) to authenticated, service_role;

-- 3c. Updating a Support customer: a Team Lead only for their own members' customers.
-- (latest definition: 20261123000100_department_scopes.sql; only the Team Lead condition changes)
create or replace function private.may_update_support_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
      join public.profiles me on me.id = private.my_id() and me.status = 'ACTIVE'
      left join public.customer_onboarding o on o.customer_id = c.id
     where c.id = p_customer
       and c.lifecycle_stage not in ('LEAD', 'POTENTIAL', 'LOST')
       and (me.role = 'SUPER_ADMIN'
            or (me.role = 'DEPARTMENT_HEAD' and c.department_id = private.scoped_department(me.id, me.department_id))
            or c.owner_id = me.id or o.team_member_id = me.id or o.team_lead_id = me.id
            or (me.role = 'TEAM_HEAD' and c.team_id = me.team_id and private.led_by(me.id, c.owner_id))))
$$;

-- 3d. Same rule inside update_support_customer.
-- (latest definition: 20261123000100_department_scopes.sql; only the Team Lead condition changes)
create or replace function public.update_support_customer(
  p_customer uuid, p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_services jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  new_owner public.profiles;
  v_list jsonb := private.normalize_service_list(p_services);
  v_service text;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into c from public.customers where id = p_customer for update;
  if me.id is null or c.id is null or not private.can_view_customer(c.id) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if not (c.owner_id = me.id
          or me.role = 'SUPER_ADMIN'
          or (me.role = 'DEPARTMENT_HEAD' and c.department_id = private.scoped_department(me.id, me.department_id))
          or (me.role = 'TEAM_HEAD' and c.team_id = me.team_id and private.led_by(me.id, c.owner_id))) then
    raise exception 'FORBIDDEN: Only the assigned team member or their team lead can edit this customer.' using errcode = '42501';
  end if;
  v_service := v_list -> 0 ->> 'serviceCode';
  perform private.check_support_customer_fields(p_name, p_email, p_phone, p_segment, p_status, v_service);
  perform private.raise_duplicate_customer(private.find_duplicate_customer(c.department_id, p_email, p_phone, c.id));

  if p_assignee is not null and p_assignee <> c.owner_id then
    select * into new_owner from public.profiles where id = p_assignee and status = 'ACTIVE';
    if new_owner.id is null or not private.can_assign_customer_owner(new_owner.id) then
      raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
    end if;
  end if;

  update public.customers
     set name = trim(p_name),
         company = nullif(trim(coalesce(p_company, '')), ''),
         phone = nullif(trim(coalesce(p_phone, '')), ''),
         email = nullif(lower(trim(coalesce(p_email, ''))), ''),
         segment = coalesce(p_segment, 'RETAIL')::public.customer_segment,
         status = coalesce(p_status, 'ACTIVE')::public.customer_status,
         service_code = case when p_services is null then service_code else v_service end,
         service_interest = case when p_services is null then service_interest when v_service is null then null else (select name from public.crm_services where code = v_service) end,
         service_details = case when p_services is null then service_details else coalesce(v_list -> 0 -> 'serviceDetails', '{}'::jsonb) end,
         requirement = nullif(trim(coalesce(p_requirement, '')), ''),
         channel = nullif(trim(coalesce(p_channel, '')), ''),
         notes = nullif(trim(coalesce(p_notes, '')), ''),
         owner_id = coalesce(new_owner.id, owner_id)
   where id = c.id;

  if p_services is not null then
    perform private.save_customer_services(c.id, v_list);
  end if;

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'CUSTOMER_UPDATED', format('Details updated by %s%s', me.full_name,
          case when new_owner.id is not null then format('; assigned to %s', new_owner.full_name) else '' end));
  if new_owner.id is not null and new_owner.id <> me.id then
    perform private.notify(new_owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', trim(p_name)),
      format('%s (%s) was assigned to you by %s.', trim(p_name), c.customer_code, me.full_name), 'customer', c.id);
  end if;
end $$;

-- 3e. Subscriptions list: a Team Lead sees their own members' customers only.
-- (latest definition: 20261212000100_sales_subscriptions_list.sql; only the Team Lead condition changes)
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
         or (v_role = 'TEAM_HEAD' and private.lead_sees(c.team_id, c.owner_id))
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

-- 4a. A Team Lead hands a ticket only to themselves or one of their own members.
-- (latest definition: 20261123000100_department_scopes.sql; only the Team Lead condition changes)
create or replace function private.can_assign_ticket_to(p_assignee uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into a from public.profiles where id = p_assignee and status = 'ACTIVE';
  if me.id is null or a.id is null or a.team_id is null or a.role not in ('TEAM_MEMBER', 'TEAM_HEAD') then
    return false;
  end if;
  return case me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then a.department_id = private.scoped_department(me.id, me.department_id)
    when 'TEAM_HEAD' then a.team_id = me.team_id and private.led_by(me.id, a.id)
    when 'TEAM_MEMBER' then a.id = me.id
    else false
  end;
end $$;
grant execute on function private.can_assign_ticket_to(uuid) to authenticated;

-- 4b. A Team Lead makes a customer owned only by themselves or one of their own members.
-- (latest definition: 20261220000200_department_head_leads.sql; only the Team Lead condition changes)
create or replace function private.can_assign_customer_owner(p_owner uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_owner public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into v_owner from public.profiles where id = p_owner and status = 'ACTIVE';
  if v_me.id is null or v_owner.id is null or (v_owner.team_id is null and private.lead_team_of(v_owner.id) is null) then
    return false;
  end if;
  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then v_owner.department_id = private.scoped_department(v_me.id, v_me.department_id)
    when 'TEAM_HEAD' then v_owner.team_id = v_me.team_id and private.led_by(v_me.id, v_owner.id)
    when 'TEAM_MEMBER' then v_owner.id = v_me.id
    else false
  end;
end $$;

-- 5a. A Team Lead's announcement reaches their own Team Members only.
-- (latest definition: 20261123000100_department_scopes.sql; only the Team Lead condition changes)
create or replace function public.broadcast_announcement(
  p_title text, p_body text, p_priority text default 'announcement',
  p_department_id uuid default null, p_division public.team_division default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_department uuid := p_department_id;
  v_team uuid;
  v_count integer;
begin
  if v_role is null or v_role = 'TEAM_MEMBER' then
    raise exception 'FORBIDDEN: You cannot send announcements.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_title), '')) = 0 or length(p_title) > 200 or length(coalesce(p_body, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Title is required (max 200 chars); message max 2000 chars.' using errcode = 'P0001';
  end if;
  if p_priority not in ('normal', 'urgent', 'announcement') then
    raise exception 'VALIDATION_ERROR: Invalid priority.' using errcode = 'P0001';
  end if;

  if v_role = 'DEPARTMENT_HEAD' then
    if v_department is not null and v_department <> private.my_department_id() then
      raise exception 'FORBIDDEN: You can only message your own department.' using errcode = '42501';
    end if;
    v_department := private.my_department_id();
  elsif v_role = 'TEAM_HEAD' then
    v_team := private.my_team_id();
    v_department := null;
  end if;

  insert into public.notifications (recipient_id, type, title, body, priority, entity_type, entity_id, actor_id, data)
  select p.id, 'ANNOUNCEMENT', trim(p_title), coalesce(p_body, ''), p_priority,
         case when v_team is not null then 'team' when v_department is not null then 'department' end,
         coalesce(v_team, v_department), auth.uid(),
         jsonb_build_object('division', p_division,
                            'sender_name', (select full_name from public.profiles where id = auth.uid()),
                            'sender_department', (select d.name from public.profiles me
                                                  join public.departments d on d.id = private.scoped_department(me.id, me.department_id)
                                                  where me.id = auth.uid()))
  from public.profiles p
  left join public.teams t on t.id = p.team_id
  where p.status = 'ACTIVE' and p.id <> auth.uid()
    and (v_team is null or (p.team_id = v_team and private.led_by(auth.uid(), p.id)))
    and (v_department is null or p.department_id = v_department)
    and (p_division is null or t.division = p_division or p.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD'));
  get diagnostics v_count = row_count;

  perform private.write_audit('ANNOUNCEMENT_SENT', coalesce(case when v_team is not null then 'team' end, 'department'),
    coalesce(v_team, v_department), v_department, v_team,
    jsonb_build_object('title', p_title, 'recipients', v_count, 'division', p_division));
  return v_count;
end $$;
revoke all on function public.broadcast_announcement(text, text, text, uuid, public.team_division) from public, anon;
grant execute on function public.broadcast_announcement(text, text, text, uuid, public.team_division) to authenticated, service_role;

-- 5b. A new ticket is announced to the Team Lead of the person working on it (all leads of the team only for an unassigned ticket).
-- (latest definition: 20261111000100_ticket_attachments.sql; only the Team Lead condition changes)
create or replace function public.create_support_ticket(p_customer uuid, p_subject text, p_description text, p_category text, p_priority text, p_assignee uuid DEFAULT NULL::uuid, p_attachments uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.profiles;
  c public.customers;
  a public.profiles;
  v_assignee uuid := p_assignee;
  v_team uuid;
  v_dept uuid;
  v_id uuid;
  v_no text;
  v_lead uuid;
  v_upd uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if length(trim(coalesce(p_subject, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Enter a ticket subject (at least 3 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;

  -- Members and leads who raise a ticket own it unless a lead hands it to someone.
  if v_assignee is null and me.role in ('TEAM_MEMBER', 'TEAM_HEAD') then
    v_assignee := me.id;
  end if;
  if v_assignee is not null and not private.can_assign_ticket_to(v_assignee) then
    raise exception 'FORBIDDEN: You cannot assign tickets to this user.' using errcode = '42501';
  end if;
  if v_assignee is not null then
    select * into a from public.profiles where id = v_assignee;
    v_team := a.team_id;
    v_dept := a.department_id;
  else
    v_team := me.team_id;
    v_dept := coalesce(me.department_id, c.department_id);
  end if;

  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority,
                                      assignee_id, created_by)
  values (c.id, v_dept, v_team, trim(p_subject), nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_category, 'GENERAL'), coalesce(p_priority, 'MEDIUM'), v_assignee, me.id)
  returning id, ticket_no into v_id, v_no;

  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, assignee_id, note)
  values (v_id, me.id, 'CREATED', 'OPEN', v_assignee, nullif(trim(coalesce(p_description, '')), ''))
  returning id into v_upd;
  perform private.ticket_attach(v_id, v_upd, p_attachments, c.id, false);
  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'TICKET_OPENED', format('%s · %s', v_no, trim(p_subject)));
  perform private.write_audit('TICKET_CREATED', 'support_ticket', v_id, v_dept, v_team,
    jsonb_build_object('ticket_no', v_no, 'customer_id', c.id, 'assignee', v_assignee));

  if v_assignee is not null and v_assignee <> me.id then
    perform private.notify(v_assignee, 'TICKET_ASSIGNED', format('Ticket %s: %s', v_no, trim(p_subject)),
      format('%s · assigned by %s', c.name, me.full_name), 'support_ticket', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = v_team and id <> me.id and private.led_by(id, v_assignee) loop
    perform private.notify(v_lead, 'TICKET_CREATED', format('New ticket %s: %s', v_no, trim(p_subject)),
      format('%s · %s priority', c.name, lower(coalesce(p_priority, 'MEDIUM'))), 'support_ticket', v_id);
  end loop;
  return v_id;
end $function$;
revoke all on function public.create_support_ticket(uuid, text, text, text, text, uuid, uuid[]) from public, anon;
grant execute on function public.create_support_ticket(uuid, text, text, text, text, uuid, uuid[]) to authenticated;

-- 5c. A new customer is announced to the owner's own Team Lead.
-- (latest definition: 20261009400000_customer_multiple_services.sql; only the Team Lead condition changes)
create or replace function public.create_support_customer(
  p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_services jsonb, p_requirement text, p_channel text, p_notes text,
  p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  owner public.profiles;
  v_list jsonb := private.normalize_service_list(p_services);
  v_service text;
  v_id uuid;
  v_code text;
  v_name text := trim(coalesce(p_name, ''));
  v_lead uuid;
begin
  v_service := v_list -> 0 ->> 'serviceCode';
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into owner from public.profiles where id = coalesce(p_assignee, me.id) and status = 'ACTIVE';
  if owner.id is null or owner.team_id is null then
    raise exception 'VALIDATION_ERROR: Choose an active team member to assign this customer to.' using errcode = 'P0001';
  end if;
  if not private.may_work_in_support() then
    raise exception 'FORBIDDEN: Only the Support team can add customers here.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.id = owner.team_id and t.division = 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Assign the customer to a member of the Support team.' using errcode = 'P0001';
  end if;
  if not private.can_assign_customer_owner(owner.id) then
    raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
  end if;
  perform private.check_support_customer_fields(p_name, p_email, p_phone, p_segment, p_status, v_service);
  perform private.raise_duplicate_customer(private.find_duplicate_customer(owner.department_id, p_email, p_phone, null));

  insert into public.customers (owner_id, name, company, phone, email, segment, status, notes,
                                service_code, service_interest, service_details, requirement, channel, lifecycle_stage)
  values (owner.id, v_name, nullif(trim(coalesce(p_company, '')), ''), nullif(trim(coalesce(p_phone, '')), ''),
          nullif(lower(trim(coalesce(p_email, ''))), ''),
          coalesce(p_segment, 'RETAIL')::public.customer_segment, coalesce(p_status, 'ACTIVE')::public.customer_status,
          nullif(trim(coalesce(p_notes, '')), ''), v_service,
          (select name from public.crm_services where code = v_service),
          coalesce(v_list -> 0 -> 'serviceDetails', '{}'::jsonb),
          nullif(trim(coalesce(p_requirement, '')), ''), nullif(trim(coalesce(p_channel, '')), ''), 'CUSTOMER')
  returning id, customer_code into v_id, v_code;

  perform private.save_customer_services(v_id, v_list);

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (v_id, me.id, 'CUSTOMER_CREATED', format('Added by %s%s', me.full_name,
          case when owner.id <> me.id then format(' and assigned to %s', owner.full_name) else '' end));

  if owner.id <> me.id then
    perform private.notify(owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', v_name),
      format('%s (%s) was assigned to you by %s.', v_name, v_code, me.full_name), 'customer', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = owner.team_id and id <> me.id and private.led_by(id, owner.id) loop
    perform private.notify(v_lead, 'CUSTOMER_ADDED', format('New customer: %s', v_name),
      format('%s (%s) was added for %s.', v_name, v_code, owner.full_name), 'customer', v_id);
  end loop;
  return v_id;
end $$;
revoke all on function public.create_support_customer(text, text, text, text, text, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_customer(text, text, text, text, text, text, jsonb, text, text, text, uuid) to authenticated;

-- 5d. Ticket updates are announced to the Team Lead of the person working on it.
-- (latest definition: 20261025000100_ticket_hierarchy_escalation.sql; only the Team Lead condition changes)
create or replace function public.update_support_ticket(
  p_ticket uuid, p_status text, p_note text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  v_manager boolean;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 4000);
  v_resolution text := left(nullif(trim(coalesce(p_resolution, '')), ''), 4000);
  v_changed boolean;
  v_kind text;
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or t.escalated_to = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  v_manager := me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD');
  if p_status not in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Unknown ticket status.' using errcode = 'P0001';
  end if;
  if p_status = 'CLOSED' and not v_manager then
    raise exception 'FORBIDDEN: Only a team lead can close a ticket. Mark it Resolved instead.' using errcode = '42501';
  end if;
  v_changed := p_status is distinct from t.status;
  if not v_changed and v_note is null and v_resolution is null then
    raise exception 'VALIDATION_ERROR: Change the status or add a note.' using errcode = 'P0001';
  end if;
  if p_status in ('RESOLVED', 'CLOSED') and coalesce(v_resolution, t.resolution_notes) is null then
    raise exception 'VALIDATION_ERROR: Add resolution notes before resolving or closing the ticket.' using errcode = 'P0001';
  end if;

  -- Escalating hands the ticket to the next level (Team Lead, then Department Head).
  if p_status = 'ESCALATED' and v_changed and v_resolution is null and private.escalate_ticket(t.id, 'MANUAL', me.id, v_note) then
    return;
  end if;

  update public.support_tickets
     set status = p_status,
         resolution_notes = coalesce(v_resolution, resolution_notes),
         resolved_at = case when p_status in ('RESOLVED', 'CLOSED') then coalesce(resolved_at, now()) else null end,
         escalated_at = case when p_status = 'ESCALATED' and v_changed then now() else escalated_at end,
         escalated_by = case when p_status = 'ESCALATED' and v_changed then me.id else escalated_by end
   where id = t.id;

  v_kind := case when p_status = 'ESCALATED' and v_changed then 'ESCALATED' when v_changed then 'STATUS_CHANGED' else 'NOTE' end;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, note)
  values (t.id, me.id, v_kind, t.status, p_status, coalesce(v_note, v_resolution));
  perform private.write_audit('TICKET_UPDATED', 'support_ticket', t.id, t.department_id, t.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from', t.status, 'to', p_status));

  -- Updates by the assignee go to the team lead (escalations also to the department head);
  -- updates by a lead / head go to the assignee; the person it was escalated to is always told.
  if t.assignee_id is not null and t.assignee_id <> me.id then
    perform private.notify(t.assignee_id, 'TICKET_UPDATE', format('Ticket %s is now %s', t.ticket_no, replace(lower(p_status), '_', ' ')),
      coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id);
  end if;
  if t.escalated_to is not null and t.escalated_to <> me.id and t.escalated_to is distinct from t.assignee_id then
    perform private.notify(t.escalated_to, 'TICKET_UPDATE', format('%s: %s is now %s', me.full_name, t.ticket_no, replace(lower(p_status), '_', ' ')),
      coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id);
  end if;
  if t.assignee_id is not distinct from me.id or not v_manager then
    for v_recipient in
      select id from public.profiles where status = 'ACTIVE' and id <> me.id and id is distinct from t.escalated_to and (
        (role = 'TEAM_HEAD' and team_id = t.team_id and private.led_by(id, t.assignee_id))
        or (p_status = 'ESCALATED' and v_changed and role = 'DEPARTMENT_HEAD' and department_id = t.department_id))
    loop
      perform private.notify(v_recipient, case when p_status = 'ESCALATED' and v_changed then 'TICKET_ESCALATED' else 'TICKET_UPDATE' end,
        case when p_status = 'ESCALATED' and v_changed then format('Escalated: %s %s', t.ticket_no, t.subject)
             else format('%s: %s', me.full_name, format('%s is now %s', t.ticket_no, replace(lower(p_status), '_', ' '))) end,
        coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id, '{}'::jsonb,
        case when p_status = 'ESCALATED' then 'urgent' else 'normal' end);
    end loop;
  end if;
end $$;
revoke all on function public.update_support_ticket(uuid, text, text, text) from public, anon;
grant execute on function public.update_support_ticket(uuid, text, text, text) to authenticated;

-- 5e. An invoice request is announced to the requester's own Team Lead.
-- (latest definition: 20261009000200_support_customer_services_invoice_requests.sql; only the Team Lead condition changes)
create or replace function public.request_invoice(p_customer uuid, p_from date, p_to date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  v_from date := date_trunc('month', p_from)::date;
  v_to date := date_trunc('month', p_to)::date;
  v_id uuid;
  v_period text;
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null then
    raise exception 'VALIDATION_ERROR: Choose the from and to month.' using errcode = 'P0001';
  end if;
  if v_to < v_from then
    raise exception 'VALIDATION_ERROR: The "to" month must be the same as or after the "from" month.' using errcode = 'P0001';
  end if;
  if v_to > (v_from + interval '24 months')::date then
    raise exception 'VALIDATION_ERROR: An invoice request can cover at most 24 months.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;

  insert into public.invoice_requests (customer_id, department_id, team_id, requested_by, from_month, to_month, note)
  values (c.id, coalesce(me.department_id, c.department_id), me.team_id, me.id, v_from, v_to,
          left(nullif(trim(coalesce(p_note, '')), ''), 1000))
  returning id into v_id;

  v_period := case when v_from = v_to then to_char(v_from, 'Mon YYYY')
                   else format('%s – %s', to_char(v_from, 'Mon YYYY'), to_char(v_to, 'Mon YYYY')) end;
  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'INVOICE_REQUESTED', format('Invoice requested for %s%s', v_period, coalesce(' - ' || nullif(trim(coalesce(p_note, '')), ''), '')));
  perform private.write_audit('INVOICE_REQUESTED', 'invoice_request', v_id, coalesce(me.department_id, c.department_id), me.team_id,
    jsonb_build_object('customer_id', c.id, 'from', v_from, 'to', v_to));

  -- The team lead, the department head and whoever owns the customer (raises its invoices).
  for v_recipient in
    select id from public.profiles
     where status = 'ACTIVE' and id <> me.id and (
       (role = 'TEAM_HEAD' and team_id = me.team_id and private.led_by(id, me.id))
       or (role = 'DEPARTMENT_HEAD' and department_id = c.department_id)
       or id = c.owner_id)
  loop
    perform private.notify(v_recipient, 'INVOICE_REQUESTED', format('Invoice requested: %s', c.name),
      format('%s asked for an invoice for %s (%s)%s', me.full_name, v_period, c.customer_code,
             coalesce(' - ' || nullif(trim(coalesce(p_note, '')), ''), '')), 'invoice_request', v_id);
  end loop;
  return v_id;
end $$;
revoke all on function public.request_invoice(uuid, date, date, text) from public, anon;
grant execute on function public.request_invoice(uuid, date, date, text) to authenticated;

-- 5f. Report change signals reach the report's own Team Lead, not every lead of the team (who cannot open it anyway).
-- (latest definition: 20261217000100_reports_two_level_approval.sql; only the Team Lead condition changes)
create or replace function private.report_audience(r public.work_reports)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.author_id where r.author_id is not null
  union
  select private.report_lead_of(r) where r.kind = 'MEMBER' and private.report_lead_of(r) is not null
  union
  select p.id from public.profiles p where r.kind in ('MEMBER', 'TEAM_LEAD') and p.role = 'DEPARTMENT_HEAD' and private.head_covers(p.id, r.department_id, r.team_id)
  union
  select x from private.report_reviewer_ids('DEPARTMENT_HEAD', r.department_id, null) x
$$;
revoke all on function private.report_audience(public.work_reports) from public, anon, authenticated;

-- 5g. The reporting manager named in HR e-mails is the member's own Team Lead.
-- (latest definition: 20261115000100_hr_email_cards.sql; only the Team Lead condition changes)
create or replace function private.hr_reporting_manager(p_profile uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.full_name from public.profiles m where m.id = private.direct_lead_of(p_profile)),
    (select m.full_name from public.profiles me
       join public.profiles m on m.department_id = me.department_id and m.role = 'DEPARTMENT_HEAD' and m.status = 'ACTIVE' and m.id <> me.id
      where me.id = p_profile and me.department_id is not null
      order by m.created_at limit 1),
    'Not assigned')
$$;
revoke all on function private.hr_reporting_manager(uuid) from public, anon, authenticated;

-- 6. Row-level rules on tables a Team Lead can write or read directly (Department Head / Super Admin / Team Member branches unchanged).
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated
  with check (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and private.lead_sees(team_id, owner_id))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  );
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and private.lead_sees(team_id, owner_id))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  )
  with check (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and private.lead_sees(team_id, owner_id))
    or ((select private.my_role()) = 'TEAM_MEMBER' and owner_id = (select private.my_id()))
  );
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and private.lead_sees(team_id, owner_id))
  );

drop policy if exists invoice_requests_select on public.invoice_requests;
create policy invoice_requests_select on public.invoice_requests for select to authenticated
  using (
    requested_by = (select private.my_id())
    or (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and private.lead_sees(team_id, requested_by))
    or exists (select 1 from public.customers c where c.id = customer_id and c.owner_id = (select private.my_id())));

-- a Team Lead reads the audit lines of their team that were made by them or their own members and, for a line about a person, only about those
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (
    (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and private.lead_sees(team_id, actor_id)
        and (entity_type <> 'profile' or private.led_by((select private.my_id()), entity_id)))
  );

-- 7. "Assign to Team Lead" (Department Head / Super Admin) names the lead, also between two leads of the same team.
--    Same team: only the direct lead changes. Another team: team and lead change together (so a team with several leads does not leave the member
--    with none). Either way the member's PENDING stage-1 reports move to the new lead (history step, notification); decided reports are untouched;
--    the change is kept in team_assignments and the audit log. Team Leads cannot call it (assigner_department refuses them).
create or replace function public.assign_member_to_team_lead(p_member uuid, p_lead uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  m public.profiles;
  l public.profiles;
  mt public.teams;
  lt public.teams;
  v_kind text;
  v_old_lead uuid;
  v_moved integer := 0;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  select * into v from private.assigner_department(
    (select p.department_id from public.profiles p where p.id = p_member));
  select * into m from public.profiles where id = p_member for update;
  select * into l from public.profiles where id = p_lead for update;
  if m.id is null or m.role <> 'TEAM_MEMBER' or private.base_department(m.department_id) is distinct from v.department_id then
    raise exception 'NOT_FOUND: Team Member not found in this department.' using errcode = 'P0001';
  end if;
  if m.status <> 'ACTIVE' then
    raise exception 'CONFLICT: Only an approved, active Team Member can be assigned.' using errcode = 'P0001';
  end if;
  if l.id is null or l.role <> 'TEAM_HEAD' or private.base_department(l.department_id) is distinct from v.department_id then
    raise exception 'VALIDATION_ERROR: Choose a Team Lead of this department.' using errcode = 'P0001';
  end if;
  if l.status <> 'ACTIVE' then
    raise exception 'CONFLICT: That Team Lead is not active.' using errcode = 'P0001';
  end if;
  select * into mt from public.teams where id = m.team_id;
  select * into lt from public.teams where id = l.team_id;
  if lt.id is null or lt.is_pool then
    raise exception 'VALIDATION_ERROR: That Team Lead has no team yet.' using errcode = 'P0001';
  end if;
  v_old_lead := private.direct_lead_of(m.id);
  if m.team_id = lt.id and v_old_lead is not distinct from l.id then
    raise exception 'CONFLICT: This Team Member is already under that Team Lead.' using errcode = 'P0001';
  end if;
  if v.head_division is not null and lt.division::text not in (v.head_division, 'GENERAL') then
    raise exception 'FORBIDDEN: That team belongs to the other side of the department.' using errcode = '42501';
  end if;
  if mt.division <> 'GENERAL' and lt.division <> 'GENERAL' and mt.division <> lt.division then
    raise exception 'VALIDATION_ERROR: A % member cannot join a % team.', lower(mt.division::text), lower(lt.division::text) using errcode = 'P0001';
  end if;
  v_kind := case when mt.is_pool then 'ASSIGNMENT' else 'REASSIGNMENT' end;
  update public.profiles set team_id = lt.id, manager_id = l.id where id = m.id;
  v_moved := private.move_pending_reports_to_lead(m.id, l.id, 'The Team Member''s Team Lead changed; the report moved with them.');
  insert into public.team_assignments (profile_id, from_team_id, to_team_id, lead_id, department_id, kind, note, assigned_by)
  values (m.id, mt.id, lt.id, l.id, v.department_id, v_kind, v_note, auth.uid());
  perform private.write_audit('TEAM_MEMBER_ASSIGNED', 'profile', m.id, v.department_id, lt.id,
    jsonb_build_object('lead', l.id, 'from_lead', v_old_lead, 'from_team', mt.id, 'to_team', lt.id, 'kind', v_kind, 'pendingReportsMoved', v_moved));
  perform private.notify(l.id, 'TEAM_MEMBER_ASSIGNED', format('%s joined your team', m.full_name), 'The Department Head assigned this Team Member to you.', 'profile', m.id);
  perform private.notify(m.id, 'TEAM_ASSIGNED', format('You are now in %s', lt.name), format('Your Team Lead is %s.', l.full_name), 'team', lt.id);
  return jsonb_build_object('memberId', m.id, 'leadId', l.id, 'teamId', lt.id, 'kind', v_kind, 'pendingReportsMoved', v_moved);
end $$;
revoke all on function public.assign_member_to_team_lead(uuid, uuid, text) from public, anon;
grant execute on function public.assign_member_to_team_lead(uuid, uuid, text) to authenticated;

-- 8a. Department Head directory: each member's OWN Team Lead; a member with no lead (several leads, none named) is 'Awaiting a Team Lead'; lead counts are their own members.
-- (latest definition: 20261211000100_employee_approval_hierarchy.sql; only the Team Lead condition changes)
create or replace function public.department_employee_directory(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from private.assigner_department(p_department);
  return jsonb_build_object(
    'department', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = v.department_id),
    'headDivision', v.head_division,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status, 'approvedAt', p.approved_at,
                  'team', jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division, 'isPool', t.is_pool),
                  'lead', (select jsonb_build_object('id', l.id, 'name', l.full_name) from public.profiles l where l.id = private.direct_lead_of(p.id)),
                  'state', case when p.status <> 'ACTIVE' then 'INACTIVE' when t.is_pool or private.direct_lead_of(p.id) is null then 'AWAITING_ASSIGNMENT' else 'ASSIGNED' end,
                  'lastAssignment', (select jsonb_build_object('kind', a.kind, 'at', a.created_at, 'by', (select b.full_name from public.profiles b where b.id = a.assigned_by))
                                       from public.team_assignments a where a.profile_id = p.id order by a.created_at desc limit 1)) order by p.full_name), '[]'::jsonb)
                  from public.profiles p join public.teams t on t.id = p.team_id
                 where p.role = 'TEAM_MEMBER' and p.status in ('ACTIVE', 'SUSPENDED', 'REVOKED') and private.base_department(p.department_id) = v.department_id
                   and (v.head_division is null or t.division::text in (v.head_division, 'GENERAL'))),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'name', l.full_name, 'status', l.status, 'team', jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division),
                  'members', (select count(*) from public.profiles m where m.team_id = l.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and private.direct_lead_of(m.id) = l.id)) order by l.full_name), '[]'::jsonb)
                from public.profiles l join public.teams t on t.id = l.team_id
               where l.role = 'TEAM_HEAD' and l.status in ('ACTIVE', 'SUSPENDED') and not t.is_pool and private.base_department(l.department_id) = v.department_id
                 and (v.head_division is null or t.division::text in (v.head_division, 'GENERAL'))));
end $$;
revoke all on function public.department_employee_directory(uuid) from public, anon;
grant execute on function public.department_employee_directory(uuid) to authenticated;

-- 8b. Leaderboard: a member's Team Lead (shown, and the Team Lead filter) is their own lead, not the first lead of the team by name.
-- (latest definition: 20261221000400_performance_leaderboard.sql; only the Team Lead condition changes)
create or replace function private.person_score_rows(p_from date, p_to date, p_person uuid default null)
returns table (
  id uuid, full_name text, role_kind text, designation text, department_id uuid, department text, team_id uuid, team text, lead_id uuid, lead_name text,
  expected integer, submitted integer, on_time integer, approved integer, revision_requests integer, rejected integer,
  tasks integer, tasks_done integer, hr_avg numeric, hr_n integer,
  c_task numeric, c_comp numeric, c_ontime numeric, c_appr numeric, c_hr numeric, score numeric, sufficient boolean, breakdown jsonb)
language sql stable security definer set search_path = '' as $$
  with st as (select * from public.report_settings s where s.id),
  sc as (select min((x ->> 'value')::numeric) as lo, max((x ->> 'value')::numeric) as hi from public.report_settings s cross join jsonb_array_elements(s.rating_scale) x where s.id),
  ppl as (
    select p.id, p.full_name, case p.role when 'TEAM_MEMBER' then 'TEAM_MEMBER' when 'TEAM_HEAD' then 'TEAM_LEAD' else 'DEPARTMENT_HEAD' end as role_kind,
           nullif(p."position", '') as designation, private.base_department(p.department_id) as department_id, p.team_id
      from public.profiles p
     where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD') and not p.is_operations_head and p.department_id is not null
       and (p_person is null or p.id = p_person)
  ),
  rep as (
    select r.author_id, count(*)::integer as submitted, count(*) filter (where r.status = 'APPROVED')::integer as approved,
           count(*) filter (where r.status = 'REJECTED')::integer as rejected,
           count(*) filter (where r.submitted_at is not null and (r.submitted_at at time zone 'Asia/Kolkata')::date <= r.report_date + 1)::integer as on_time
      from public.work_reports r where r.status <> 'DRAFT' and r.report_date between p_from and p_to group by r.author_id
  ),
  rv as (
    select r.author_id, count(*)::integer as n from public.work_report_events e join public.work_reports r on r.id = e.report_id
     where e.action = 'REVISION_REQUESTED' and r.report_date between p_from and p_to group by r.author_id
  ),
  tk as (
    select w.assignee_id, count(*)::integer as n, count(*) filter (where w.status = 'COMPLETED')::integer as done from public.work_tasks w
     where coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between p_from and p_to group by w.assignee_id
  ),
  hr as (
    select v.subject_id, avg(v.rating) as a, count(*)::integer as n from public.hr_performance_reviews v
     where v.status = 'SUBMITTED' and v.period_start <= p_to and v.period_end >= p_from group by v.subject_id
  ),
  base as (
    select ppl.*, d.name as dept_name, t.name as team_name,
           (select l.id from public.profiles l where ppl.role_kind = 'TEAM_MEMBER' and l.id = private.direct_lead_of(ppl.id)) as lead_id,
           (select l.full_name from public.profiles l where ppl.role_kind = 'TEAM_MEMBER' and l.id = private.direct_lead_of(ppl.id)) as lead_name,
           private.report_expected_days(ppl.id, p_from, p_to) as expected,
           coalesce(rep.submitted, 0) as submitted, coalesce(rep.on_time, 0) as on_time, coalesce(rep.approved, 0) as approved,
           coalesce(rv.n, 0) as revision_requests, coalesce(rep.rejected, 0) as rejected,
           coalesce(tk.n, 0) as tasks, coalesce(tk.done, 0) as tasks_done, hr.a as hr_avg, coalesce(hr.n, 0) as hr_n
      from ppl
      join public.departments d on d.id = ppl.department_id
      left join public.teams t on t.id = ppl.team_id
      left join rep on rep.author_id = ppl.id left join rv on rv.author_id = ppl.id
      left join tk on tk.assignee_id = ppl.id left join hr on hr.subject_id = ppl.id
  ),
  comp as (
    select b.*,
      case when b.tasks >= (select min_tasks from st) then round(100.0 * b.tasks_done / b.tasks, 1) end as c_task,
      case when b.expected >= 1 then least(100, round(100.0 * b.submitted / b.expected, 1)) end as c_comp,
      case when b.submitted >= 1 then round(100.0 * b.on_time / b.submitted, 1) end as c_ontime,
      case when b.approved + b.revision_requests + b.rejected >= 1 then round(100.0 * b.approved / (b.approved + b.revision_requests + b.rejected), 1) end as c_appr,
      case when b.hr_n >= 1 and (select hi from sc) > (select lo from sc) then round(100.0 * (b.hr_avg - (select lo from sc)) / ((select hi from sc) - (select lo from sc)), 1) end as c_hr
      from base b
  )
  select c.id, c.full_name, c.role_kind, c.designation, c.department_id, c.dept_name, c.team_id, c.team_name, c.lead_id, c.lead_name,
         c.expected, c.submitted, c.on_time, c.approved, c.revision_requests, c.rejected, c.tasks, c.tasks_done, round(c.hr_avg, 2), c.hr_n,
         c.c_task, c.c_comp, c.c_ontime, c.c_appr, c.c_hr,
         (select round(sum(m.w * m.v) / nullif(sum(m.w), 0), 1) from (values
            ((select (score_weights ->> 'taskCompletion')::numeric from st), c.c_task), ((select (score_weights ->> 'compliance')::numeric from st), c.c_comp),
            ((select (score_weights ->> 'onTime')::numeric from st), c.c_ontime), ((select (score_weights ->> 'approvalQuality')::numeric from st), c.c_appr),
            ((select (score_weights ->> 'hrRating')::numeric from st), c.c_hr)) m (w, v) where m.v is not null and m.w > 0) as score,
         c.expected >= (select min_expected_reports from st)
           and (select count(*) from (values (c.c_task), (c.c_comp), (c.c_ontime), (c.c_appr), (c.c_hr)) m (v) where m.v is not null) >= 2 as sufficient,
         jsonb_build_array(
           jsonb_build_object('key', 'taskCompletion', 'label', 'Task completion', 'value', c.c_task, 'weight', (select (score_weights ->> 'taskCompletion')::numeric from st),
                              'detail', format('%s of %s tasks completed', c.tasks_done, c.tasks)),
           jsonb_build_object('key', 'compliance', 'label', 'Daily reporting compliance', 'value', c.c_comp, 'weight', (select (score_weights ->> 'compliance')::numeric from st),
                              'detail', format('%s reports for %s expected days', c.submitted, c.expected)),
           jsonb_build_object('key', 'onTime', 'label', 'On-time submission', 'value', c.c_ontime, 'weight', (select (score_weights ->> 'onTime')::numeric from st),
                              'detail', format('%s of %s sent on the day or the next day', c.on_time, c.submitted)),
           jsonb_build_object('key', 'approvalQuality', 'label', 'Approvals without revision', 'value', c.c_appr, 'weight', (select (score_weights ->> 'approvalQuality')::numeric from st),
                              'detail', format('%s approved, %s revision requests, %s rejected', c.approved, c.revision_requests, c.rejected)),
           jsonb_build_object('key', 'hrRating', 'label', 'HR review rating', 'value', c.c_hr, 'weight', (select (score_weights ->> 'hrRating')::numeric from st),
                              'detail', case when c.hr_n > 0 then format('average %s from %s review%s', round(c.hr_avg, 2), c.hr_n, case when c.hr_n = 1 then '' else 's' end) else 'no HR review in the period' end)) as breakdown
    from comp c
$$;
revoke all on function private.person_score_rows(date, date, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
