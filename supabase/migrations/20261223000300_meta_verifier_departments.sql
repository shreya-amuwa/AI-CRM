-- Meta Verifiers can verify for SEVERAL departments (one account, a home department plus the departments an Operations Head or the Super Admin adds).
--
-- WHAT EXISTED: every verifier check compared the customer's department with ONE value, private.my_verifier_department_id() (the verifier's home department):
--   can_review_onboarding, can_view_onboarding_review, the customers_select_review policy, can_correct_onboarding_item, wf_can_meta, panel_details_list, is_verifier_for
--   (who may be assigned), pick_meta_verifier (automatic assignment) and the META half of chat_my_clients. A verifier of Wabastore could not work D Talk's customers.
-- WHAT THIS ADDS (additive): table meta_verifier_departments (the EXTRA departments), private.verifier_covers / in_verifier_scope (home department + extras, only for an active
--   Meta Verifier; a Support Team Lead keeps just the home department), and every check above uses it. Scope is computed live: removing a department removes the access at once,
--   and the verifier's unfinished verifications in that department are re-picked among the eligible verifiers (or left unassigned for a head to assign), with a notification and an audit entry.
--   verifier_departments_get / verifier_departments_set (Super Admin, or the Operations Head who owns the verifier's department and every department added).
-- WHAT IT DOES NOT DO: department access is NOT Operations Head ownership. A verifier remains a Team Member: no Department Head approval, no employee management, no finance, no broad
--   customer access - only customers in their departments that go through Meta verification and are in the verification stage, exactly as before for the home department.
-- Run after 20261223000200_client_chat_access.sql. Safe to run again.

create table if not exists public.meta_verifier_departments (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (profile_id, department_id)
);
create index if not exists meta_verifier_departments_dept_idx on public.meta_verifier_departments (department_id);
alter table public.meta_verifier_departments enable row level security;
revoke all on table public.meta_verifier_departments from public, anon, authenticated;

-- the departments a person verifies for: the home department (a Support Meta Verifier or Team Lead, as before) plus the extras of an ACTIVE Meta Verifier
create or replace function private.verifier_departments_of(p_profile uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p join public.teams t on t.id = p.team_id
   where p.id = p_profile and p.status = 'ACTIVE' and t.division = 'SUPPORT' and (p.is_meta_verifier or p.role = 'TEAM_HEAD') and p.department_id is not null
  union
  select d.department_id from public.meta_verifier_departments d join public.profiles p on p.id = d.profile_id
   where d.profile_id = p_profile and p.status = 'ACTIVE' and p.is_meta_verifier
$$;
revoke all on function private.verifier_departments_of(uuid) from public, anon, authenticated;

create or replace function private.verifier_covers(p_profile uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_department is not null and exists (select 1 from private.verifier_departments_of(p_profile) x where x = p_department)
$$;
revoke all on function private.verifier_covers(uuid, uuid) from public, anon, authenticated;

create or replace function private.in_verifier_scope(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.verifier_covers(auth.uid(), p_department)
$$;
revoke all on function private.in_verifier_scope(uuid) from public, anon, authenticated;
grant execute on function private.in_verifier_scope(uuid) to authenticated, service_role;

-- who may be the verifier of a customer: a Meta Verifier who covers its department (META route), a Technical Consultant of the department (the other route)
create or replace function private.is_verifier_for(p_profile uuid, p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.profiles p on p.status = 'ACTIVE'
     where c.id = p_customer and p.id = p_profile
       and case when private.onboarding_route(p_customer) = 'META' then p.is_meta_verifier and private.verifier_covers(p.id, c.department_id)
                else p.is_technical_consultant and p.department_id = c.department_id end)
$$;
revoke all on function private.is_verifier_for(uuid, uuid) from public, anon, authenticated;

create or replace function private.pick_meta_verifier(p_customer uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.customers c
    join public.profiles p on p.status = 'ACTIVE'
   where c.id = p_customer and private.is_verifier_for(p.id, p_customer)
   order by (select count(*) from public.customer_onboarding x where x.meta_verifier_id = p.id and x.meta_status <> 'COMPLETED' and x.onboarding_completed_at is null), p.created_at, p.id
   limit 1
$$;
revoke all on function private.pick_meta_verifier(uuid) from public, anon, authenticated;

create or replace function private.can_review_onboarding(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and private.onboarding_forwarded(c.id)
      -- once handed over to the Department Head the verification is closed
      and not exists (select 1 from public.customer_onboarding o where o.customer_id = c.id and o.handover_stage <> 'CONSULTANT')
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.onboarding_route(c.id) = 'META' and private.in_verifier_scope(c.department_id))
        or (private.onboarding_route(c.id) <> 'META' and c.department_id = private.my_support_department_id())))
$$;
grant execute on function private.can_review_onboarding(uuid) to authenticated;

CREATE OR REPLACE FUNCTION private.can_view_onboarding_review(p_customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.customers c
    join public.customer_onboarding o on o.customer_id = c.id
    where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
      and o.with_consultant
      and (private.my_role() = 'SUPER_ADMIN'
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.onboarding_route(c.id) = 'META' and private.in_verifier_scope(c.department_id))
        or (c.department_id = private.my_support_department_id() and private.consult_visible(c.id))
        or private.handover_recipient(c.id)))
  or private.delivery_recipient(p_customer)
$function$;

drop policy if exists customers_select_review on public.customers;
create policy customers_select_review on public.customers for select to authenticated using (
  lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and private.onboarding_with_consultant(id)
  and ((private.onboarding_route(id) = 'META' and private.in_verifier_scope(department_id))
    or (department_id = (select private.my_support_department_id()) and private.consult_visible(id))));

CREATE OR REPLACE FUNCTION private.can_correct_onboarding_item(p_customer uuid, p_item text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p_item <> 'INVOICE'
     and private.can_review_onboarding(p_customer)
     and exists (select 1 from public.customers c where c.id = p_customer and c.lifecycle_stage = 'ONBOARDING'
                  and case when private.onboarding_route(c.id) = 'META' then private.in_verifier_scope(c.department_id) else c.department_id = private.my_support_department_id() end)
     and (exists (select 1 from private.customer_items(p_customer) i where i.code = p_item)
          or exists (select 1 from private.customer_optional_items(p_customer) i where i.code = p_item))
$function$;

create or replace function private.wf_can_meta(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c join public.customer_onboarding o on o.customer_id = c.id
     where c.id = p_customer and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER') and o.with_consultant
       and private.onboarding_route(c.id) = 'META'
       and (private.my_role() = 'SUPER_ADMIN'
         or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
         or private.in_verifier_scope(c.department_id)))
$$;
revoke all on function private.wf_can_meta(uuid) from public, anon, authenticated;

create or replace function public.panel_details_list(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_can boolean := private.can_manage_panel_details(p_customer);
begin
  -- readable by whoever manages it, and by the verifier's own department after the hand-over (they still need to see what was recorded)
  if not v_can and not (private.can_access_customer(p_customer)
       and exists (select 1 from public.customers c where c.id = p_customer and private.in_verifier_scope(c.department_id))) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'canEdit', v_can,
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'name', s.name, 'platform', cs.platform, 'panelAccount', cs.panel_account,
                 'panelUrl', cs.panel_url,
                 -- the link e-mail: which address went out, when, and whether the saved URL is still that one
                 'link', (select jsonb_build_object('sentAt', l.sent_at, 'sentBy', (select full_name from public.profiles where id = l.sent_by),
                                   'current', l.url = cs.panel_url,
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = l.last_job))
                            from public.service_panel_links l where l.customer_id = cs.customer_id and l.service_code = cs.service_code),
                 -- whether a password was set for the customer and what happened to the e-mail that carried it (never the password itself)
                 'credentials', (select jsonb_build_object('setAt', pc.set_at, 'setBy', (select full_name from public.profiles where id = pc.set_by),
                                   'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'to', j.recipient)
                                               from public.automation_jobs j where j.id = pc.last_job))
                                   from public.service_panel_credentials pc where pc.customer_id = cs.customer_id and pc.service_code = cs.service_code)) order by s.sort_order, s.code)
        from public.customer_services cs join public.crm_services s on s.code = cs.service_code
       where cs.customer_id = p_customer and s.requires_meta_verification), '[]'::jsonb),
    -- the address the panel password and link are e-mailed to: the one on the customer record
    'customerEmail', (select nullif(btrim(c.email), '') from public.customers c where c.id = p_customer),
    'dashboardLogin', (select jsonb_build_object('email', a.email, 'createdAt', a.created_at) from public.customer_client_accounts a where a.customer_id = p_customer));
end $$;
revoke all on function public.panel_details_list(uuid) from public, anon;
grant execute on function public.panel_details_list(uuid) to authenticated;

create or replace function public.meta_verifier_candidates(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.customers;
begin
  select * into c from public.customers where id = p_customer;
  if c.id is null or not (private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name) order by p.full_name)
                     from public.profiles p where private.is_verifier_for(p.id, p_customer)), '[]'::jsonb);
end $$;
revoke all on function public.meta_verifier_candidates(uuid) from public, anon;
grant execute on function public.meta_verifier_candidates(uuid) to authenticated;

create or replace function public.chat_my_clients(p_search text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := private.my_id();
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  if me is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row order by sort_at desc nulls last, name) from (
      select t.name, t.sort_at, jsonb_build_object(
        'customerId', t.id, 'name', t.name, 'business', t.business, 'code', t.code, 'channel', t.channel,
        'conversationId', t.conv_id, 'lastMessageAt', t.sort_at, 'lastMessagePreview', t.preview,
        'unread', case when t.conv_id is null then 0 else private.chat_unread(t.conv_id, me, 0) end,
        'hasLogin', t.has_login, 'role', t.role) as row
      from (
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name) as business, c.customer_code as code, 'RM'::text as channel,
               cv.id as conv_id, cv.last_message_at as sort_at, cv.last_message_preview as preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id) as has_login,
               case when me = private.support_member_of(c.id) then 'Relationship Manager' else 'Team Lead' end as role
          from public.customers c
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'RM'
         where c.department_id = private.my_department_id()
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (me = private.support_member_of(c.id) or me = private.support_lead_of(c.id))
           and private.meta_done(c.id)
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        union all
        select c.id, c.name, coalesce(nullif(btrim(c.company), ''), c.name), c.customer_code, 'META',
               cv.id, cv.last_message_at, cv.last_message_preview,
               exists (select 1 from public.customer_client_accounts ca where ca.customer_id = c.id),
               'Meta Verifier'
          from public.customers c
          join public.customer_onboarding o on o.customer_id = c.id and o.meta_verifier_id = me
          left join public.chat_conversations cv on cv.kind = 'CLIENT' and cv.customer_id = c.id and cv.channel = 'META'
         where (c.department_id = private.my_department_id() or private.verifier_covers(me, c.department_id))
           and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
           and (v_term is null or c.search_text ilike '%' || v_term || '%' or lower(coalesce(c.customer_code, '')) like '%' || v_term || '%')
        order by sort_at desc nulls last, name limit 200) t) x), '[]'::jsonb);
end $$;
revoke all on function public.chat_my_clients(text) from public, anon;
grant execute on function public.chat_my_clients(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Giving and taking departments (Super Admin, or the Operations Head who owns the verifier's department and every department added)
-- ---------------------------------------------------------------------------
create or replace function private.may_set_verifier_departments(p_profile uuid, p_departments uuid[])
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  t public.profiles;
  d uuid;
begin
  if private.is_super_admin() then
    return true;
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.department_id is null or private.my_role() <> 'DEPARTMENT_HEAD' or not exists (
       select 1 from public.profiles me where me.id = auth.uid() and me.status = 'ACTIVE' and me.is_operations_head) then
    return false;
  end if;
  if private.owner_of_department(private.base_department(t.department_id)) is distinct from auth.uid() then
    return false;
  end if;
  foreach d in array coalesce(p_departments, '{}'::uuid[]) loop
    if private.owner_of_department(private.base_department(d)) is distinct from auth.uid() then
      return false;
    end if;
  end loop;
  return true;
end $$;
revoke all on function private.may_set_verifier_departments(uuid, uuid[]) from public, anon, authenticated;

create or replace function public.verifier_departments_get(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  select * into t from public.profiles where id = p_profile;
  if t.id is null or not (p_profile = auth.uid() or private.is_super_admin() or private.may_set_verifier_departments(p_profile, '{}'::uuid[])) then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'isMetaVerifier', t.is_meta_verifier,
    'home', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = t.department_id),
    'extra', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
                         from public.meta_verifier_departments m join public.departments d on d.id = m.department_id where m.profile_id = p_profile), '[]'::jsonb),
    'canEdit', t.is_meta_verifier and private.may_set_verifier_departments(p_profile, '{}'::uuid[]));
end $$;
revoke all on function public.verifier_departments_get(uuid) from public, anon;
grant execute on function public.verifier_departments_get(uuid) to authenticated;

-- p_departments = the EXTRA departments (the home department is implicit and cannot be listed or removed here)
create or replace function public.verifier_departments_set(p_profile uuid, p_departments uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_new uuid[];
  v_old uuid[];
  v_removed uuid[];
  d uuid;
  r record;
  v_pick uuid;
  v_moved integer := 0;
begin
  select * into t from public.profiles where id = p_profile for update;
  v_new := coalesce((select array_agg(distinct x) from unnest(coalesce(p_departments, '{}'::uuid[])) x where x is distinct from t.department_id), '{}'::uuid[]);
  if t.id is null or not private.may_set_verifier_departments(p_profile, v_new) then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  if not t.is_meta_verifier or t.status <> 'ACTIVE' then
    raise exception 'VALIDATION_ERROR: Only an active Meta Verifier can verify for several departments.' using errcode = 'P0001';
  end if;
  if cardinality(v_new) > 0 and (select count(*) from public.departments x where x.id = any (v_new)) <> cardinality(v_new) then
    raise exception 'VALIDATION_ERROR: Choose existing departments.' using errcode = 'P0001';
  end if;
  select coalesce(array_agg(department_id), '{}'::uuid[]) into v_old from public.meta_verifier_departments where profile_id = p_profile;
  v_removed := coalesce((select array_agg(x) from unnest(v_old) x where not (x = any (v_new))), '{}'::uuid[]);
  delete from public.meta_verifier_departments where profile_id = p_profile and not (department_id = any (v_new));
  insert into public.meta_verifier_departments (profile_id, department_id, granted_by)
  select p_profile, x, (select private.my_id()) from unnest(v_new) x on conflict do nothing;
  -- a department taken away: that verifier's unfinished verifications there go to another eligible verifier, or wait unassigned for a head
  for r in select o.customer_id, c.department_id, coalesce(c.company, c.name) as nm
             from public.customer_onboarding o join public.customers c on c.id = o.customer_id
            where o.meta_verifier_id = p_profile and c.department_id = any (v_removed) and o.meta_status <> 'COMPLETED' and o.onboarding_completed_at is null loop
    v_pick := private.pick_meta_verifier(r.customer_id);
    update public.customer_onboarding set meta_verifier_id = v_pick,
           meta_verifier_assigned_at = case when v_pick is null then null else now() end, meta_verifier_assigned_by = null
     where customer_id = r.customer_id;
    perform private.write_audit('META_VERIFIER_REASSIGNED', 'customer', r.customer_id, r.department_id, null,
      jsonb_build_object('from', p_profile, 'to', v_pick, 'reason', 'department removed from the verifier'));
    if v_pick is not null then
      perform private.notify(v_pick, 'META_VERIFIER_ASSIGNED', format('New Meta verification: %s', r.nm), 'You are the Meta Verifier of this client.', 'customer', r.customer_id);
    end if;
    v_moved := v_moved + 1;
  end loop;
  if v_moved > 0 then
    perform private.notify(p_profile, 'META_VERIFIER_SCOPE_CHANGED', 'Your verification departments changed',
      format('%s verification%s moved to another verifier or are waiting for a head to assign.', v_moved, case when v_moved = 1 then '' else 's' end), 'profile', p_profile);
  end if;
  perform private.write_audit('META_VERIFIER_SCOPE_CHANGED', 'profile', p_profile, t.department_id, null,
    jsonb_build_object('from', v_old, 'to', v_new, 'reassigned', v_moved));
  return public.verifier_departments_get(p_profile) || jsonb_build_object('reassigned', v_moved);
end $$;
revoke all on function public.verifier_departments_set(uuid, uuid[]) from public, anon;
grant execute on function public.verifier_departments_set(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
