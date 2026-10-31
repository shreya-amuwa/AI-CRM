-- Run this ONE file once in the Supabase SQL editor (safe to run again). It is the migration 20261212000100_team_lead_direct_member_creation.sql.
-- It needs the employee approval hierarchy migration (20261211000100) and the Telecaller migration (sales sub-role) to be applied already.

-- =============================================================================
-- Who adds a team member, and how: the creator decides the workflow.
--
--   Super Admin / Department Head / Team Lead   add a person DIRECTLY (an active account at once, no approval). A Team Lead adds a Team Member
--                                                 to their own team only, and can give a Sales role (Telecaller, Business Associate, ...) to a
--                                                 member of their own Sales team.
--   HR (any HR department member except the Head) submits an EMPLOYEE REQUEST: a pending profile that cannot sign in, routed by the database to
--                                                 the approver of the role (Team Member / Team Lead -> the Department Head; Department Head ->
--                                                 the owning Operations Head; Operations Head -> the Super Admin). Unchanged.
--
-- Earlier a Team Lead's new team member was also a request to the Department Head. That path is closed: private.check_employee_submission now accepts
-- HR only (old Team Lead requests stay readable and can still be decided; nothing is deleted). HR staff also cannot create people through the direct
-- path any more (private.actor_can_assign_role / assert_can_create_user), so HR cannot go around the approval.
-- Replaces four functions with the same signatures. Safe to run again.
-- =============================================================================

-- 1. HR staff never create people directly; a Team Lead adds a Team Member of their own team
create or replace function private.actor_can_assign_role(
  p_actor uuid, p_role public.app_role, p_department_id uuid, p_team_id uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_me public.profiles;
  v_team_department uuid;
  v_team_division text;
begin
  select * into v_me from public.profiles where id = p_actor and status = 'ACTIVE';
  if v_me.id is null or p_role is null then
    return false;
  end if;

  -- Structural validity of the target placement
  if p_role = 'SUPER_ADMIN' then
    return false;                                   -- never assignable through the app
  elsif p_role = 'DEPARTMENT_HEAD' then
    if p_department_id is null or p_team_id is not null then return false; end if;
  else
    if p_team_id is null then return false; end if;
    select department_id, division::text into v_team_department, v_team_division from public.teams where id = p_team_id;
    if v_team_department is null or v_team_department is distinct from coalesce(p_department_id, v_team_department) then
      return false;
    end if;
    p_department_id := v_team_department;
  end if;

  return case v_me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then p_role in ('TEAM_HEAD', 'TEAM_MEMBER') and private.head_may_manage(p_actor, p_department_id, v_team_division)
    -- a Team Lead adds a Team Member to their own team directly (no approval); HR staff never create people directly: HR submits an employee request
    when 'TEAM_HEAD' then p_role = 'TEAM_MEMBER' and p_team_id = v_me.team_id and not private.actor_is_hr(p_actor)
    else false
  end;
end $$;

-- 2. The reason HR sees when it tries the direct path
create or replace function public.assert_can_create_user(
  p_role public.app_role, p_department_id uuid default null, p_team_id uuid default null, p_head_division text default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_existing public.profiles;
begin
  if private.actor_is_hr(auth.uid()) and private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: HR does not create employees directly. Send an employee request: the Department Head approves it before the account is active.' using errcode = '42501';
  end if;
  if not private.actor_can_assign_role(auth.uid(), p_role, p_department_id, p_team_id) then
    raise exception 'FORBIDDEN: You are not allowed to create a % here.', replace(p_role::text, '_', ' ')
      using errcode = '42501';
  end if;
  if p_head_division is not null and (p_role <> 'DEPARTMENT_HEAD' or p_head_division not in ('SALES', 'SUPPORT')) then
    raise exception 'VALIDATION_ERROR: Only a Department Head can be a Sales or Support head.' using errcode = 'P0001';
  end if;
  if p_role = 'DEPARTMENT_HEAD' then
    v_existing := private.department_head_of(p_department_id, null, p_head_division);
    if v_existing.id is not null then
      raise exception 'CONFLICT: This department already has a Department Head% (%). A department can have only one%.',
        case p_head_division when 'SALES' then ' for Sales' when 'SUPPORT' then ' for Support' else '' end, v_existing.full_name,
        case p_head_division when 'SALES' then ' Sales Department Head' when 'SUPPORT' then ' Support Department Head' else '' end
        using errcode = 'P0001';
    end if;
  end if;
  return true;
end $$;

-- 3. Only HR submits an employee request
create or replace function private.check_employee_submission(p_actor uuid, p_role public.app_role, p_ops boolean, p_department uuid, p_division text,
                                                             out o_source text, out o_division text, out o_profile_department uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.profiles;
  v_dept public.departments;
begin
  select * into v_actor from public.profiles where id = p_actor and status = 'ACTIVE';
  if v_actor.id is null then
    raise exception 'FORBIDDEN: Only an active HR member can submit an employee for approval.' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'SUPER_ADMIN' or (p_ops and p_role <> 'DEPARTMENT_HEAD') then
    raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
  end if;
  o_division := nullif(upper(coalesce(p_division, '')), '');
  if o_division is not null and o_division not in ('SALES', 'SUPPORT', 'GENERAL') then
    raise exception 'VALIDATION_ERROR: Choose Sales, Support or General.' using errcode = 'P0001';
  end if;
  select * into v_dept from public.departments where id = p_department and not is_locked;
  if v_dept.id is null then
    raise exception 'VALIDATION_ERROR: Choose the department.' using errcode = 'P0001';
  end if;
  -- Who the creator is decides the workflow, from their own account (never from the request): HR submits and the approver decides.
  -- A Team Lead (and the Super Admin and a Department Head) add people directly, through the account form, with no request.
  if not private.actor_is_hr(v_actor.id) then
    raise exception 'FORBIDDEN: You cannot submit this employee for approval: only HR does. A Team Lead adds team members directly.' using errcode = '42501';
  end if;
  o_source := 'HR';
  o_profile_department := case when p_role = 'DEPARTMENT_HEAD' then v_dept.id else private.base_department(v_dept.id) end;
end $$;

-- 4. A Team Lead gives a Sales role to a member of their own team
create or replace function public.set_sales_sub_role(p_profile uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_division text;
begin
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001'; end if;
  if not (private.my_role() = 'SUPER_ADMIN'
          or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
          or (private.my_role() = 'TEAM_HEAD' and t.role = 'TEAM_MEMBER' and t.team_id is not null
              and t.team_id = (select p.team_id from public.profiles p where p.id = private.my_id()))) then
    raise exception 'FORBIDDEN: Only the Super Admin, the Department Head or the Team Lead of the team can set a Sales role.' using errcode = '42501';
  end if;
  if p_role is not null and p_role not in ('TELECALLER', 'BUSINESS_ASSOCIATE', 'INFLUENCER', 'VISIT_SALES', 'BUSINESS_PARTNER') then
    raise exception 'VALIDATION_ERROR: Choose Telecaller, Business Associate, Influencer, Visit Sales or Business Partner.' using errcode = 'P0001';
  end if;
  select division into v_division from public.teams where id = t.team_id;
  if p_role is not null and (t.role <> 'TEAM_MEMBER' or v_division is distinct from 'SALES') then
    raise exception 'VALIDATION_ERROR: A Sales role can only be given to a Team Member of a Sales team.' using errcode = 'P0001';
  end if;
  update public.profiles set sales_sub_role = p_role where id = t.id returning * into t;
  perform private.write_audit('SALES_SUB_ROLE_SET', 'profile', t.id, t.department_id, t.team_id, jsonb_build_object('salesSubRole', p_role));
  return jsonb_build_object('id', t.id, 'salesSubRole', t.sales_sub_role, 'defaultDashboard', t.default_dashboard);
end $$;

revoke all on function private.actor_can_assign_role(uuid, public.app_role, uuid, uuid) from public, anon;
revoke all on function public.assert_can_create_user(public.app_role, uuid, uuid, text) from public, anon;
grant execute on function public.assert_can_create_user(public.app_role, uuid, uuid, text) to authenticated;
revoke all on function private.check_employee_submission(uuid, public.app_role, boolean, uuid, text) from public, anon, authenticated;
revoke all on function public.set_sales_sub_role(uuid, text) from public, anon;
grant execute on function public.set_sales_sub_role(uuid, text) to authenticated;
notify pgrst, 'reload schema';
