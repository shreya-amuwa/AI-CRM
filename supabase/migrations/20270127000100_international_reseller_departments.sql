-- =============================================================================
-- International and Reseller: two departments whose Department Head, Team Leads and Team Members work in Sales AND Support (PR 1: database).
-- Run after 20270126000200_notification_reliability.sql. Additive and safe to run twice: no existing department, team, person, lead,
-- customer, ticket, task or report is changed or deleted, and every existing department behaves exactly as before.
--
-- Model (one flag, no new Sales/Support tables, no duplicate people):
--   * departments.unified_sales_support = true marks a department whose people do both Sales and Support. International (slug `international`) and
--     Reseller (slug `reseller`) are created with it, each with ONE team of division GENERAL (like AI Studio). Leads, customers, tickets, tasks,
--     reports, attendance, leave, meetings and chat are the existing tables and functions; ownership, team and department rules isolate them.
--   * A department-wide rule "a team is a Sales / Support team" used to read teams.division alone. private.team_unified(team) now lets the
--     Sales-side and Support-side functions a Team Lead / Team Member of such a team needs (below) also accept a team of a unified department.
--     Each function is the latest definition with ONLY that condition widened; for every other team the result is identical.
--   * The Department Head of a unified department has no side (head_division NULL = both Sales and Support), forced by a trigger.
--   * profiles.default_dashboard: unified-head / unified-lead / unified-member for these departments (the UI of PR 2 opens one dashboard).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The flag, the two departments and their teams
-- ---------------------------------------------------------------------------
alter table public.departments add column if not exists unified_sales_support boolean not null default false;

insert into public.departments (slug, name, description, category, icon_name, accent_color, generates_revenue, unified_sales_support)
values ('international', 'International', 'International business: Sales and Support in one department.', 'Sales & Support', 'Globe', '#1D4ED8', true, true),
       ('reseller', 'Reseller', 'Reseller business: Sales and Support in one department.', 'Sales & Support', 'Store', '#0E7490', true, true)
on conflict (slug) do update set unified_sales_support = true;

insert into public.teams (department_id, name, division)
select d.id, d.name || ' Team', 'GENERAL'
  from public.departments d
 where d.slug in ('international', 'reseller') and not exists (select 1 from public.teams t where t.department_id = d.id)
on conflict do nothing;

create or replace function private.dept_is_unified(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select d.unified_sales_support from public.departments d where d.id = p_department), false)
$$;
create or replace function private.team_unified(p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select d.unified_sales_support from public.teams t join public.departments d on d.id = t.department_id where t.id = p_team), false)
$$;
revoke all on function private.dept_is_unified(uuid), private.team_unified(uuid) from public, anon;
grant execute on function private.dept_is_unified(uuid), private.team_unified(uuid) to authenticated, service_role;

-- a unified department has one kind of team: its people do both, so a Sales-only or Support-only team there would split them
create or replace function private.tg_teams_unified_division()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.division is distinct from 'GENERAL' and private.dept_is_unified(new.department_id) then
    raise exception 'VALIDATION_ERROR: % does Sales and Support together. Its teams are not split into a Sales team and a Support team.',
      (select name from public.departments where id = new.department_id) using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists teams_unified_division on public.teams;
create trigger teams_unified_division before insert or update of division, department_id on public.teams
  for each row execute function private.tg_teams_unified_division();
revoke all on function private.tg_teams_unified_division() from public, anon, authenticated;

-- the head of a unified department handles both sides: no Sales-only / Support-only head (runs before the other profile triggers by name)
create or replace function private.tg_profiles_unified_head()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role = 'DEPARTMENT_HEAD' and new.head_division is not null and private.dept_is_unified(new.department_id) then
    new.head_division := null;
  end if;
  return new;
end $$;
drop trigger if exists profiles_a_unified_head on public.profiles;
create trigger profiles_a_unified_head before insert or update of role, department_id, head_division on public.profiles
  for each row execute function private.tg_profiles_unified_head();
revoke all on function private.tg_profiles_unified_head() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The dashboard a person opens (latest definition, 20270108000100, plus the unified departments)
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
  -- AI Studio is recognised by the department itself (private.ai_studio_department), never by a role name or a team division
  v_ai boolean := new.department_id is not null and new.department_id is not distinct from private.ai_studio_department();
  -- International / Reseller: the department decides (never the team's division), Sales and Support in one dashboard
  v_unified boolean := new.department_id is not null and private.dept_is_unified(new.department_id);
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  if new.sales_sub_role is not null and (new.role is distinct from 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    new.sales_sub_role := null;
  end if;
  -- an HR designation belongs to a Team Member / Team Lead of the HR department and nobody else
  if new.hr_sub_role is not null and not (v_slug = 'hr' and new.role in ('TEAM_MEMBER', 'TEAM_HEAD')) then
    new.hr_sub_role := null;
  end if;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case
      when v_unified then 'unified-head'
      when v_slug = 'hr' then 'hr-head'
      when v_ai then 'ai-studio-head'
      when new.head_division = 'SALES' and v_slug is distinct from 'accounts' then 'sales-department-head'
      else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_unified then 'unified-lead'
      when v_slug = 'accounts' then 'accounts-staff'
      when v_ai then 'ai-studio-lead'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_unified then 'unified-member'
      when v_slug = 'accounts' then 'accounts-staff'
      when v_ai then 'ai-studio-member'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' and coalesce(new.is_meta_verifier, false) then 'meta-verifier'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' and new.sales_sub_role = 'TELECALLER' then 'telecaller'
      when v_division = 'SALES' and new.sales_sub_role = 'BUSINESS_ASSOCIATE' then 'business-associate'
      when v_division = 'SALES' and new.sales_sub_role is not null then 'sales-' || lower(replace(new.sales_sub_role, '_', '-'))
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Sales-side and Support-side functions a unified Team Lead / Team Member needs: the latest definition of each, with the one
--    condition `<team>.division = 'SALES' | 'SUPPORT'` widened by `or private.team_unified(<team>.id)`.
-- ---------------------------------------------------------------------------
-- private.is_support_staff
CREATE OR REPLACE FUNCTION private.is_support_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
    where p.id = private.my_id() and p.status = 'ACTIVE'
      and p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and (t.division = 'SUPPORT' or private.team_unified(t.id)))
$function$;

-- private.current_team_lead
CREATE OR REPLACE FUNCTION private.current_team_lead()
 RETURNS profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select p.* from public.profiles p
  join public.teams t on t.id = p.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))
  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
$function$;

-- private.team_lead_scope
CREATE OR REPLACE FUNCTION private.team_lead_scope(p_lead uuid)
 RETURNS TABLE(customer_id uuid, handed boolean, assignee_id uuid, needs_decision boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select p.id, p.team_id from public.profiles p
    join public.teams t on t.id = p.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))
    where p.id = p_lead and p.status = 'ACTIVE' and p.role = 'TEAM_HEAD'
  ), handed as (
    select o.customer_id, o.handover_stage, o.team_member_id
    from me join public.customer_onboarding o on o.team_lead_id = me.id
    join public.customers c on c.id = o.customer_id
    where o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER') and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
  )
  select h.customer_id, true,
         case when h.handover_stage = 'TEAM_MEMBER' then h.team_member_id end,
         h.handover_stage = 'TEAM_LEAD'
  from handed h
  union all
  select c.id, false, c.owner_id, false
  from me join public.customers c on c.team_id = me.team_id and private.led_by(me.id, c.owner_id)
  where not exists (select 1 from handed h where h.customer_id = c.id)
$function$;

-- private.in_team_lead_scope
CREATE OR REPLACE FUNCTION private.in_team_lead_scope(p_customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles me
    join public.teams t on t.id = me.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))
    join public.customers c on c.id = p_customer
    where me.id = auth.uid() and me.status = 'ACTIVE' and me.role = 'TEAM_HEAD'
      and ((c.team_id = me.team_id and private.led_by(me.id, c.owner_id))
        or exists (select 1 from public.customer_onboarding o
                    where o.customer_id = c.id and o.team_lead_id = me.id
                      and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER'))))
$function$;

-- public.create_support_customer
CREATE OR REPLACE FUNCTION public.create_support_customer(p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text, p_services jsonb, p_requirement text, p_channel text, p_notes text, p_assignee uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if not exists (select 1 from public.teams t where t.id = owner.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))) then
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
end $function$;

-- public.pass_to_team_lead
CREATE OR REPLACE FUNCTION public.pass_to_team_lead(p_customer uuid, p_team_lead uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
begin
  select * into v from public.customers where id = p_customer for update;
  if v.id is null or not (private.is_super_admin()
       or (private.my_role() = 'DEPARTMENT_HEAD' and v.department_id = private.my_department_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or o.handover_stage not in ('DEPARTMENT_HEAD', 'TEAM_LEAD') then
    raise exception 'CONFLICT: This customer is not waiting to be passed to a Team Lead.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p
                  join public.teams t on t.id = p.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))
                  where p.id = p_team_lead and p.role = 'TEAM_HEAD'
                    and p.status = 'ACTIVE' and p.department_id = v.department_id) then
    raise exception 'VALIDATION_ERROR: Choose an active Support Team Lead of this department.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_LEAD', team_lead_id = p_team_lead, passed_to_team_lead_at = now(),
         passed_to_team_lead_by = (select private.my_id()), team_member_id = null, assigned_to_member_at = null,
         assigned_to_member_by = null, handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  perform private.log_customer_activity(p_customer, 'PASSED_TO_TEAM_LEAD',
    format('Passed to Team Lead %s', (select full_name from public.profiles where id = p_team_lead)) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_LEAD', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_lead', p_team_lead, 'note', v_note));
  perform private.notify(p_team_lead, 'HANDOVER_TO_TEAM_LEAD', format('New client for your team: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'The Department Head passed this client to you. Keep it or assign it to a team member.'), 'customer', p_customer);
end $function$;

-- public.assign_to_team_member
CREATE OR REPLACE FUNCTION public.assign_to_team_member(p_customer uuid, p_member uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.customers;
  o public.customer_onboarding;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 1000);
  v_lead_team uuid;
  v_name text;
begin
  select * into o from public.customer_onboarding where customer_id = p_customer for update;
  if o.customer_id is null or not (private.is_super_admin() or o.team_lead_id = (select private.my_id())) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into v from public.customers where id = p_customer for update;
  if o.handover_stage not in ('TEAM_LEAD', 'TEAM_MEMBER') then
    raise exception 'CONFLICT: This customer has not been passed to a Team Lead yet.' using errcode = 'P0001';
  end if;
  select p.team_id into v_lead_team from public.profiles p
    join public.teams t on t.id = p.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))
   where p.id = o.team_lead_id;
  if v_lead_team is null then
    raise exception 'CONFLICT: Only a Support Team Lead can assign this client.' using errcode = 'P0001';
  end if;
  if not (p_member = o.team_lead_id
          -- a Team Lead gives a client only to their OWN Team Members (the direct lead), not to another lead's people on the same team
          or exists (select 1 from public.profiles p where p.id = p_member and p.role = 'TEAM_MEMBER'
                      and p.status = 'ACTIVE' and p.team_id = v_lead_team and private.direct_lead_of(p.id) = o.team_lead_id)) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Member of your team.' using errcode = 'P0001';
  end if;
  if o.handover_stage = 'TEAM_MEMBER' and o.team_member_id = p_member then
    raise exception 'CONFLICT: The customer is already assigned to this person.' using errcode = 'P0001';
  end if;

  update public.customer_onboarding
     set handover_stage = 'TEAM_MEMBER', team_member_id = p_member, assigned_to_member_at = now(),
         assigned_to_member_by = (select private.my_id()), handover_note = coalesce(v_note, handover_note)
   where customer_id = p_customer;
  select full_name into v_name from public.profiles where id = p_member;
  perform private.log_customer_activity(p_customer, 'ASSIGNED_TO_TEAM_MEMBER',
    case when p_member = o.team_lead_id then format('Kept by Team Lead %s', v_name) else format('Assigned to %s', v_name) end
    || coalesce(' · ' || v_note, ''));
  perform private.write_audit('HANDOVER_TO_TEAM_MEMBER', 'customer', p_customer, v.department_id, v.team_id,
    jsonb_build_object('team_member', p_member, 'kept_by_lead', p_member = o.team_lead_id, 'note', v_note));
  perform private.notify(p_member, 'HANDOVER_TO_TEAM_MEMBER', format('New client assigned to you: %s', coalesce(v.company, v.name)),
    coalesce(v_note, 'Your Team Lead assigned this client to you.'), 'customer', p_customer);
end $function$;

-- private.support_member_of
CREATE OR REPLACE FUNCTION private.support_member_of(p_customer uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select o.team_member_id from public.customer_onboarding o where o.customer_id = p_customer and o.team_member_id is not null),
    (select c.owner_id from public.customers c join public.teams t on t.id = c.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id)) where c.id = p_customer))
$function$;

-- private.support_lead_of
CREATE OR REPLACE FUNCTION private.support_lead_of(p_customer uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(
    (select o.team_lead_id from public.customer_onboarding o where o.customer_id = p_customer and o.team_lead_id is not null),
    private.direct_lead_of(private.support_member_of(p_customer)),
    (select p.id from public.customers c join public.teams t on t.id = c.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))
       join public.profiles p on p.team_id = t.id and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
      where c.id = p_customer and private.support_member_of(p_customer) is not distinct from c.owner_id and c.owner_id = p.id
      limit 1))
$function$;

-- private.tg_support_tickets_support_only
CREATE OR REPLACE FUNCTION private.tg_support_tickets_support_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' and not private.may_work_in_support() then
    raise exception 'FORBIDDEN: Only the Support team can raise support tickets.' using errcode = '42501';
  end if;
  if new.team_id is not null
     and not exists (select 1 from public.teams t where t.id = new.team_id and (t.division = 'SUPPORT' or private.team_unified(t.id))) then
    raise exception 'VALIDATION_ERROR: Support tickets can only be assigned to the Support team.' using errcode = 'P0001';
  end if;
  return new;
end $function$;

-- private.sales_leads_base
CREATE OR REPLACE FUNCTION private.sales_leads_base(p_dept uuid)
 RETURNS TABLE(id text, lead_code text, name text, company text, phone text, email text, source text, temperature text, call_status text, owner_id uuid, owner_name text, team_name text, assigned_at timestamp with time zone, last_contacted timestamp with time zone, follow_up timestamp with time zone, converted boolean, stage text, kind text, sheet_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id::text, c.customer_code, c.name, c.company, c.phone, c.email, c.lead_source, c.lead_temperature, c.call_status,
         c.owner_id, o.full_name, t.name, coalesce(sh.assigned_at, c.created_at),
         (select max(a.created_at) from public.customer_activities a where a.customer_id = c.id and a.type <> 'LEAD_CREATED'),
         c.next_follow_up_at, c.lifecycle_stage <> 'LEAD', c.lifecycle_stage, 'CUSTOMER', sh.file_name
    from public.customers c
    join public.teams t on t.id = c.team_id and (t.division = 'SALES' or private.team_unified(t.id))
    left join public.profiles o on o.id = c.owner_id
    left join public.sales_lead_sheets sh on sh.id = c.source_sheet_id
   where c.department_id = p_dept
     and (c.lifecycle_stage = 'LEAD'
          or (c.lifecycle_stage in ('POTENTIAL', 'ONBOARDING', 'CUSTOMER')
              and (c.source_lead_id is not null or c.source_sheet_id is not null
                   or exists (select 1 from public.customer_activities a where a.customer_id = c.id and a.type = 'LEAD_CREATED'))))
  union all
  select l.id, 'INB-' || upper(left(l.id, 6)), l.name, l.company, l.phone, l.email, l.channel, null, null,
         null::uuid, null, null, null::timestamptz, null::timestamptz, null::timestamptz, false, l.stage, 'INBOUND', null
    from public.crm_leads l
   where l.department = (select d.slug from public.departments d where d.id = p_dept) and coalesce(l.sub_department, 'sales') = 'sales'
     and l.assigned_to is null and l.converted_customer_id is null
$function$;

-- public.sales_lead_assignees
CREATE OR REPLACE FUNCTION public.sales_lead_assignees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
      'subRole', p.sales_sub_role, 'mode', case when p.sales_sub_role = 'TELECALLER' then 'TELECALLER' else 'LEADS' end,
      'openContacts', case when p.sales_sub_role = 'TELECALLER'
        then (select count(*) from public.telecaller_contacts c where c.assigned_to = p.id and c.call_status = 'PENDING') else 0 end,
      'openLeads', (select count(*) from public.customers c where c.owner_id = p.id and c.lifecycle_stage = 'LEAD'))
      order by case when p.sales_sub_role = 'TELECALLER' then 2 when p.role = 'TEAM_HEAD' then 0 else 1 end, p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.department_id = private.my_department_id() and (t.division = 'SALES' or private.team_unified(t.id))
     and (p.role = 'TEAM_HEAD' or (p.role = 'TEAM_MEMBER' and (p.sales_sub_role is null or p.sales_sub_role = 'TELECALLER')))), '[]'::jsonb);
end $function$;

-- public.sales_task_assign
CREATE OR REPLACE FUNCTION public.sales_task_assign(p_assignee uuid, p_title text, p_description text, p_priority text, p_due date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_sales_head();
  if not exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id
                  where p.id = p_assignee and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and p.department_id = private.my_department_id() and (t.division = 'SALES' or private.team_unified(t.id))) then
    raise exception 'VALIDATION_ERROR: Choose a Team Lead of a Sales team.' using errcode = 'P0001';
  end if;
  return public.assign_task_to_team_lead(p_assignee, p_title, p_description, p_priority, p_due);
end $function$;

-- public.sales_task_assignees
CREATE OR REPLACE FUNCTION public.sales_task_assignees()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', 'Team Lead') order by p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.role = 'TEAM_HEAD' and p.department_id = private.my_department_id() and (t.division = 'SALES' or private.team_unified(t.id))), '[]'::jsonb);
end $function$;

-- public.sales_tasks_list
CREATE OR REPLACE FUNCTION public.sales_tasks_list(p_filter text DEFAULT 'ALL'::text, p_search text DEFAULT NULL::text, p_assignee uuid DEFAULT NULL::uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 20)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dept uuid := private.my_department_id();
  v_today date := private.hr_today();
  v_filter text := upper(coalesce(p_filter, 'ALL'));
  v_term text := nullif(lower(btrim(coalesce(p_search, ''))), '');
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_size integer := least(greatest(coalesce(p_page_size, 20), 1), 100);
  v_out jsonb;
begin
  perform private.require_sales_head();
  if v_filter not in ('ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE') then
    raise exception 'VALIDATION_ERROR: Unknown task filter.' using errcode = 'P0001';
  end if;
  with t as (
    select w.id, w.title, w.description, w.priority, w.due_date, w.status, w.progress, w.last_update_note, w.last_update_at, w.created_at, w.parent_id,
           w.assignee_id, a.full_name assignee_name, w.assigned_by, b.full_name by_name, tm.name team_name,
           (w.due_date is not null and w.status <> 'COMPLETED' and w.due_date < v_today) overdue,
           (select count(*) from public.work_tasks c where c.parent_id = w.id) subtasks
      from public.work_tasks w
      join public.teams tm on tm.id = w.team_id and (tm.division = 'SALES' or private.team_unified(tm.id))
      join public.profiles a on a.id = w.assignee_id
      join public.profiles b on b.id = w.assigned_by
     where w.department_id = v_dept
       and (v_term is null or lower(w.title || ' ' || coalesce(w.description, '') || ' ' || a.full_name) like '%' || v_term || '%')
       and (p_assignee is null or w.assignee_id = p_assignee)),
  f as (select * from t where case v_filter when 'PENDING' then status = 'ASSIGNED' when 'IN_PROGRESS' then status = 'IN_PROGRESS' when 'COMPLETED' then status = 'COMPLETED'
                                    when 'OVERDUE' then overdue else true end),
  pg as (select * from f order by overdue desc, (status = 'COMPLETED'), due_date nulls last, created_at desc limit v_size offset (v_page - 1) * v_size)
  select jsonb_build_object('total', (select count(*) from f), 'page', v_page, 'pageSize', v_size, 'today', v_today,
    'counts', jsonb_build_object('all', (select count(*) from t), 'pending', (select count(*) from t where status = 'ASSIGNED'), 'inProgress', (select count(*) from t where status = 'IN_PROGRESS'),
       'completed', (select count(*) from t where status = 'COMPLETED'), 'overdue', (select count(*) from t where overdue)),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'description', description, 'priority', priority, 'startDate', created_at, 'dueDate', due_date,
        'status', status, 'progress', progress, 'remarks', last_update_note, 'lastUpdateAt', last_update_at, 'assigneeId', assignee_id, 'assignee', assignee_name,
        'assignedById', assigned_by, 'assignedBy', by_name, 'team', team_name, 'overdue', overdue, 'dueSoon', (due_date is not null and status <> 'COMPLETED' and due_date >= v_today and due_date <= v_today + 2),
        'level', case when parent_id is null then 'LEAD' else 'MEMBER' end, 'subtasks', subtasks)
        order by overdue desc, (status = 'COMPLETED'), due_date nulls last, created_at desc) from pg), '[]'::jsonb))
    into v_out;
  return v_out;
end $function$;

-- public.sales_team_people
CREATE OR REPLACE FUNCTION public.sales_team_people()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require_sales_head();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'name', p.full_name, 'team', t.name, 'teamId', t.id, 'role', case p.role when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end,
      'subRole', p.sales_sub_role) order by p.full_name)
    from public.profiles p join public.teams t on t.id = p.team_id
   where p.status = 'ACTIVE' and p.department_id = private.my_department_id() and (t.division = 'SALES' or private.team_unified(t.id)) and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')), '[]'::jsonb);
end $function$;

-- private.lead_scope_allowed
CREATE OR REPLACE FUNCTION private.lead_scope_allowed()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
     where p.id = private.my_id() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and (t.division = 'SALES' or private.team_unified(t.id))
       and (p.sales_sub_role is null or p.sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE')))
$function$;

-- private.lead_scope_ids
CREATE OR REPLACE FUNCTION private.lead_scope_ids(p_scope text)
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id
    from public.customers c
   where c.lifecycle_stage = 'LEAD'
     and private.lead_scope_allowed()
     and (
          (p_scope in ('ALL', 'MINE', 'TO_ACCOUNTS', 'RETURNED') and c.owner_id = private.my_id())
       or (p_scope in ('ALL', 'DEPARTMENT', 'TO_ACCOUNTS', 'RETURNED')
           and c.owner_id <> private.my_id()
           and c.department_id = private.my_department_id()
           and exists (select 1 from public.teams t where t.id = c.team_id and t.department_id = c.department_id and (t.division = 'SALES' or private.team_unified(t.id))))
     )
     and (p_scope <> 'TO_ACCOUNTS' or c.payment_workflow = 'PENDING_PAYMENT_CONFIRMATION')
     and (p_scope <> 'RETURNED' or c.payment_workflow = 'RETURNED_FROM_ACCOUNTS')
$function$;

-- private.can_upload_leads
CREATE OR REPLACE FUNCTION private.can_upload_leads()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p
      left join public.teams t on t.id = p.team_id
      left join public.departments d on d.id = p.department_id
     where p.id = private.my_id() and p.status = 'ACTIVE' and coalesce(d.slug, '') not in ('hr', 'accounts')
       and ((p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and (t.division = 'SALES' or private.team_unified(t.id)))
            or (p.role = 'DEPARTMENT_HEAD' and private.is_sales_head())))
$function$;

-- private.ba_eligible
CREATE OR REPLACE FUNCTION private.ba_eligible(p_profile uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.profiles p left join public.teams t on t.id = p.team_id
     where p.id = p_profile and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER'
       and (p.sales_sub_role = 'BUSINESS_ASSOCIATE' or (p.sales_sub_role is null and (t.division = 'SALES' or private.team_unified(t.id)))))
$function$;

-- private.in_sales_section
CREATE OR REPLACE FUNCTION private.in_sales_section()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case private.my_role()
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then not private.is_support_head()
                                and coalesce((select d.slug from public.departments d where d.id = private.my_department_id()), '') not in ('hr', 'accounts')
    when 'TEAM_HEAD' then exists (select 1 from public.profiles p join public.teams t on t.id = p.team_id where p.id = private.my_id() and (t.division = 'SALES' or private.team_unified(t.id)))
    else false
  end
$function$;

-- private.can_view_customer: the department-wide Support desk (a setting, on by default) lets every Support person read all CUSTOMER-stage customers of
-- the department. It does not apply to a unified department, whose members must see only their own customers (20270127000100).
CREATE OR REPLACE FUNCTION private.can_view_customer(p_customer uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and (
      private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and private.lead_sees(c.team_id, c.owner_id))
      or (private.my_role() = 'TEAM_MEMBER' and c.owner_id = private.my_id())
      or (private.support_desk_department_wide() and private.is_support_staff() and c.department_id = private.my_department_id() and c.lifecycle_stage = 'CUSTOMER'
            -- never in a unified department: there every person sees their own records and their Team Lead's / Head's scope only
            and not private.dept_is_unified(c.department_id))))
$function$;

-- customers_select_support (row level security): the same department-wide Support desk, as a table policy. Skipped for a unified department.
alter policy customers_select_support on public.customers using (
  (select private.support_desk_department_wide()) and (select private.is_support_staff())
  and department_id = (select private.my_department_id()) and lifecycle_stage = 'CUSTOMER'
  and not private.dept_is_unified(department_id));

-- ---------------------------------------------------------------------------
-- 4. The people already in these departments (none yet on a new database) get the right dashboard
-- ---------------------------------------------------------------------------
update public.profiles set default_dashboard = default_dashboard where department_id in (select id from public.departments where unified_sales_support);
