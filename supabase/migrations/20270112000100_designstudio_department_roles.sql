-- =============================================================================
-- Amuwa Design Studio (slug 'designstudio') has only Department Head -> Team Lead -> Team Member.
--
-- No Sales or Support role may be given there: no place in a Sales / Support team (Sales Team Member, Sales Team Lead, Telecaller,
-- Business Associate and the other Sales roles, Support Team Member, Support Team Lead, Technical Consultant, Meta Verifier), no Sales role
-- (sales_sub_role) and no Sales / Support side for its Department Head (head_division). The forms offer only the three roles; this migration
-- makes the database refuse the rest, whichever screen or API call tries it:
--
--   1. private.designstudio_role_problem(...)   the one rule (null = allowed), shared by the checks below
--   2. public.assert_can_create_user             the API's check BEFORE an account is made: the clear reason, and no half-made login
--   3. private.check_employee_submission         an HR employee request for Amuwa Design Studio cannot name the Sales / Support side
--   4. trigger profiles_designstudio_roles       the last line: no profile row is ever written with such a combination (creation,
--                                                 role change, team move, Sales role), even by a path that skipped the checks above
--
-- Existing rows are not changed or deleted (nobody is moved): the trigger checks a row only when it is created or when its department,
-- team, role, side or Sales role changes, so an existing person can still be suspended, restored or edited. The Sales / Support teams of the
-- department stay (the Access Control matrix of the combined heads still uses them); only people cannot be placed in them any more.
-- Replaces two functions with the same signatures and adds one function and one trigger. Safe to run again.
-- =============================================================================

-- 1. The rule
create or replace function private.designstudio_role_problem(
  p_department uuid, p_team uuid, p_role public.app_role, p_head_division text default null, p_sales_sub_role text default null,
  p_operations_head boolean default false)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  v_department uuid := p_department;
  v_division text;
begin
  if p_team is not null then
    select department_id, division::text into v_department, v_division from public.teams where id = p_team;
    v_department := coalesce(v_department, p_department);
  end if;
  if v_department is null or not exists (select 1 from public.departments where id = v_department and slug = 'designstudio') then
    return null;
  end if;
  if v_division in ('SALES', 'SUPPORT') then
    return 'Amuwa Design Studio has no Sales or Support roles. Place the person in its General team as a Team Lead or Team Member.';
  end if;
  if p_role = 'DEPARTMENT_HEAD' and not coalesce(p_operations_head, false) and p_head_division is not null then
    return 'Amuwa Design Studio has no Sales or Support Department Head. Create its Department Head without a Sales or Support side.';
  end if;
  if p_sales_sub_role is not null then
    return 'Amuwa Design Studio has no Sales roles (Telecaller, Business Associate, ...).';
  end if;
  return null;
end $$;
revoke all on function private.designstudio_role_problem(uuid, uuid, public.app_role, text, text, boolean) from public, anon;
grant execute on function private.designstudio_role_problem(uuid, uuid, public.app_role, text, text, boolean) to authenticated, service_role;

-- 2. The check before an account is made (20261212000200 + the Amuwa Design Studio rule)
create or replace function public.assert_can_create_user(
  p_role public.app_role, p_department_id uuid default null, p_team_id uuid default null, p_head_division text default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_existing public.profiles;
  v_problem text;
begin
  if private.actor_is_hr(auth.uid()) and private.my_role() not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: HR does not create employees directly. Send an employee request: the Department Head approves it before the account is active.' using errcode = '42501';
  end if;
  -- Amuwa Design Studio: Department Head, Team Lead and Team Member only (checked first: the reason is the department, not the permission)
  v_problem := private.designstudio_role_problem(p_department_id, p_team_id, p_role, p_head_division);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
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
revoke all on function public.assert_can_create_user(public.app_role, uuid, uuid, text) from public, anon;
grant execute on function public.assert_can_create_user(public.app_role, uuid, uuid, text) to authenticated;

-- 3. An HR employee request (20261212000200 + the Amuwa Design Studio rule)
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
  -- Amuwa Design Studio has no Sales or Support side (its Operations Head request is about whole departments, so it has none either way)
  if v_dept.slug = 'designstudio' and o_division in ('SALES', 'SUPPORT') then
    raise exception 'VALIDATION_ERROR: Amuwa Design Studio has no Sales or Support roles. Choose General (or leave the side empty).' using errcode = 'P0001';
  end if;
  -- Who the creator is decides the workflow, from their own account (never from the request): HR submits and the approver decides.
  -- A Team Lead (and the Super Admin and a Department Head) add people directly, through the account form, with no request.
  if not private.actor_is_hr(v_actor.id) then
    raise exception 'FORBIDDEN: You cannot submit this employee for approval: only HR does. A Team Lead adds team members directly.' using errcode = '42501';
  end if;
  o_source := 'HR';
  o_profile_department := case when p_role = 'DEPARTMENT_HEAD' then v_dept.id else private.base_department(v_dept.id) end;
end $$;
revoke all on function private.check_employee_submission(uuid, public.app_role, boolean, uuid, text) from public, anon, authenticated;

-- 4. No profile row with a Sales / Support role in Amuwa Design Studio
create or replace function private.tg_profiles_designstudio_roles()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_problem text;
begin
  if new.status in ('REVOKED', 'REJECTED') then
    return new;
  end if;
  -- an existing person is checked only when their placement changes (nothing already saved blocks a suspension or an edit of details)
  if tg_op = 'UPDATE'
     and old.department_id is not distinct from new.department_id and old.team_id is not distinct from new.team_id
     and old.role is not distinct from new.role and old.head_division is not distinct from new.head_division
     and old.sales_sub_role is not distinct from new.sales_sub_role and old.is_operations_head is not distinct from new.is_operations_head
     and old.status not in ('REVOKED', 'REJECTED') then
    return new;
  end if;
  v_problem := private.designstudio_role_problem(new.department_id, new.team_id, new.role,
                                                 case when new.role = 'DEPARTMENT_HEAD' then new.head_division end,
                                                 new.sales_sub_role, new.is_operations_head);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_designstudio_roles() from public, anon, authenticated;

drop trigger if exists profiles_designstudio_roles on public.profiles;
create trigger profiles_designstudio_roles before insert or update on public.profiles
  for each row execute function private.tg_profiles_designstudio_roles();
