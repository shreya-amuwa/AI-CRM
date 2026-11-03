-- =============================================================================
-- The HR department has exactly three designations for new employees:
--
--   HR Assistant   Team Member of HR       -> the existing HR dashboard (all existing HR Assistant permissions)
--   HR Recruiter   Team Member of HR       -> the HR Recruiter dashboard
--   HR Admin Head  Department Head of HR   -> the existing HR Department Head dashboard and HR-wide permissions (private.is_hr_leadership)
--
-- "HR Admin Head" is NOT a new role system. It is the designation of the existing Department Head of the HR department, so it keeps the existing rules:
-- one head per department, created directly only by the Super Admin, and approved by the Super Admin / Operations Head when it comes through an employee
-- request. It receives no Super Admin or Operations Head permission from the designation.
--
-- The rule is enforced here, in the database, whatever screen or API call saves the designation: a generic designation (Team Member, Team Lead, Department
-- Head, Operations Head) is refused for a NEW HR employee, an HR designation is refused for any other department, and the designation must match the role.
-- Existing employee records are not changed, and saving an existing record without changing its designation is never blocked.
--
-- Safe to run again. Run after 20261222000400_service_specific_journeys.sql.
-- =============================================================================

alter table public.employee_personal_details drop constraint if exists employee_personal_details_designation_check;
alter table public.employee_personal_details add constraint employee_personal_details_designation_check
  check (designation in ('Operations Head', 'Department Head', 'Team Lead', 'Team Member', 'HR Assistant', 'HR Recruiter', 'HR Admin Head'));

-- The one rule: which designation may a person with this role have in this department? Returns the problem as text, or null when it is fine.
create or replace function private.designation_problem(p_slug text, p_role public.app_role, p_designation text, p_operations_head boolean)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_designation is null then
    return null;
  end if;
  if p_designation in ('HR Assistant', 'HR Recruiter', 'HR Admin Head') then
    if p_slug is distinct from 'hr' then
      return 'HR Assistant, HR Recruiter and HR Admin Head are designations of the HR department only.';
    end if;
    if p_designation = 'HR Admin Head' then
      if p_role is distinct from 'DEPARTMENT_HEAD' or coalesce(p_operations_head, false) then
        return 'HR Admin Head is the designation of the Department Head of the HR department.';
      end if;
    elsif p_role is distinct from 'TEAM_MEMBER' then
      return p_designation || ' is a designation of a Team Member of the HR department.';
    end if;
    return null;
  end if;
  -- Team Member, Team Lead, Department Head are not HR designations (an Operations Head homed in HR keeps its own company-wide designation)
  if p_slug = 'hr' and not coalesce(p_operations_head, false) then
    return 'Choose HR Assistant, HR Recruiter or HR Admin Head for an HR employee.';
  end if;
  return null;
end $$;
revoke all on function private.designation_problem(text, public.app_role, text, boolean) from public, anon, authenticated;

-- Called by the server BEFORE any account or request is made, so a wrong department / role / designation never leaves anything behind. An HR employee
-- must have a designation (an account without one cannot be made through the API); other departments are not asked for one here.
create or replace function public.assert_designation_allowed(p_department uuid, p_team uuid, p_role public.app_role, p_designation text, p_operations_head boolean default false)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := p_department;
  v_slug text;
  v_problem text;
begin
  if p_team is not null then
    select t.department_id into v_dept from public.teams t where t.id = p_team;
  end if;
  select slug into v_slug from public.departments where id = v_dept;
  if v_slug = 'hr' and p_designation is null and not coalesce(p_operations_head, false) then
    raise exception 'VALIDATION_ERROR: Choose HR Assistant, HR Recruiter or HR Admin Head for an HR employee.' using errcode = 'P0001';
  end if;
  v_problem := private.designation_problem(v_slug, p_role, p_designation, p_operations_head);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.assert_designation_allowed(uuid, uuid, public.app_role, text, boolean) from public, anon;
grant execute on function public.assert_designation_allowed(uuid, uuid, public.app_role, text, boolean) to authenticated;

create or replace function private.tg_designation_sets_hr_sub_role()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_slug text;
  v_problem text;
begin
  -- an unchanged designation (an existing record saved again) is not re-judged; a record with no designation is the older, undesignated kind
  if new.designation is null or (tg_op = 'UPDATE' and new.designation is not distinct from old.designation) then
    return new;
  end if;
  select * into p from public.profiles where id = new.profile_id;
  select slug into v_slug from public.departments where id = p.department_id;
  v_problem := private.designation_problem(v_slug, p.role, new.designation, p.is_operations_head);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
  if new.designation in ('HR Assistant', 'HR Recruiter', 'HR Admin Head') then
    -- HR Admin Head has no sub-role: the Department Head role of the HR department carries its leadership (nothing is granted by the designation alone)
    update public.profiles
       set hr_sub_role = case new.designation when 'HR Recruiter' then 'HR_RECRUITER' when 'HR Assistant' then 'HR_ASSISTANT' else null end,
           "position" = coalesce(nullif("position", ''), new.designation)
     where id = p.id;
  end if;
  return new;
end $$;
revoke all on function private.tg_designation_sets_hr_sub_role() from public, anon, authenticated;
drop trigger if exists employee_designation_hr_sub_role on public.employee_personal_details;
create trigger employee_designation_hr_sub_role after insert or update of designation on public.employee_personal_details
  for each row execute function private.tg_designation_sets_hr_sub_role();

-- The other direction: changing a person's role or department (a resubmitted request, a reassignment) must not leave an HR designation on someone it no
-- longer fits, for example an HR Recruiter turned into a Department Head or moved out of HR.
create or replace function private.tg_profile_keeps_hr_designation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_designation text;
  v_slug text;
  v_problem text;
begin
  if new.role is not distinct from old.role and new.department_id is not distinct from old.department_id and new.is_operations_head is not distinct from old.is_operations_head then
    return new;
  end if;
  select d.designation into v_designation from public.employee_personal_details d where d.profile_id = new.id;
  if v_designation in ('HR Assistant', 'HR Recruiter', 'HR Admin Head') then
    select slug into v_slug from public.departments where id = new.department_id;
    v_problem := private.designation_problem(v_slug, new.role, v_designation, new.is_operations_head);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_profile_keeps_hr_designation() from public, anon, authenticated;
drop trigger if exists profiles_keep_hr_designation on public.profiles;
create trigger profiles_keep_hr_designation before update of role, department_id, is_operations_head on public.profiles
  for each row execute function private.tg_profile_keeps_hr_designation();

-- Change an existing HR Team Member between HR Assistant and HR Recruiter (Super Admin / Department Head of HR; audited). The Department Head of HR
-- keeps the HR Admin Head designation and is not changed here.
create or replace function public.set_hr_sub_role(p_profile uuid, p_role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_slug text;
begin
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only the Super Admin or the Department Head of HR can change an HR designation.' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('HR_ASSISTANT', 'HR_RECRUITER') then
    raise exception 'VALIDATION_ERROR: Choose HR Assistant or HR Recruiter.' using errcode = 'P0001';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  select slug into v_slug from public.departments where id = t.department_id;
  if v_slug is distinct from 'hr' or t.role is distinct from 'TEAM_MEMBER' then
    raise exception 'VALIDATION_ERROR: HR Assistant and HR Recruiter are designations of Team Members of the HR department.' using errcode = 'P0001';
  end if;
  -- the designation record and the sub-role always agree (the trigger above keeps the profile in step)
  update public.employee_personal_details set designation = case p_role when 'HR_RECRUITER' then 'HR Recruiter' else 'HR Assistant' end, updated_at = now() where profile_id = t.id;
  update public.profiles set hr_sub_role = p_role where id = t.id returning * into t;
  perform private.write_audit('HR_SUB_ROLE_SET', 'profile', t.id, t.department_id, t.team_id, jsonb_build_object('hrSubRole', p_role));
  return jsonb_build_object('id', t.id, 'hrSubRole', t.hr_sub_role, 'defaultDashboard', t.default_dashboard);
end $$;
revoke all on function public.set_hr_sub_role(uuid, text) from public, anon;
grant execute on function public.set_hr_sub_role(uuid, text) to authenticated;

notify pgrst, 'reload schema';
