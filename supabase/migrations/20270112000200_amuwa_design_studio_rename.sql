-- =============================================================================
-- One Amuwa Design Studio: the department built as "AI Design Studio" (slug 'ai-design-studio', migration 20270110000100) becomes
-- Amuwa Design Studio. It keeps everything it has: Department Head -> Team Lead -> Team Member, its dashboards (clients, notices,
-- assignments, daily reports, issues) and its one General team. It has nothing Sales or Support.
--
--   1. The old department of that name (slug 'designstudio') is retired: renamed "Amuwa Design Studio (Retired)" (department names are
--      unique). It is NOT locked and nothing in it is moved or deleted: its people keep signing in to their existing dashboards, and the
--      services it delivers keep their delivery department until the Super Admin changes them in the service settings.
--   2. The department-role rule of 20270112000100 (no Sales / Support team, side or Sales role) covers both departments.
--   3. No Department Head can be given the Sales or Support function of either department any more (Access Control), and the grants
--      already given for them are withdrawn, each one audited. The teams stay (nothing is deleted from teams or profiles).
--   4. The workspace's own refusal message says Amuwa Design Studio.
-- Safe to run again.
-- =============================================================================

-- 1. Names (the old department first: department names are unique, case-insensitive)
update public.departments
   set name = 'Amuwa Design Studio (Retired)'
 where slug = 'designstudio' and name is distinct from 'Amuwa Design Studio (Retired)';
update public.departments
   set name = 'Amuwa Design Studio',
       description = 'Client design services: client work, assignments, daily reports and issues.'
 where slug = 'ai-design-studio' and name is distinct from 'Amuwa Design Studio';

-- 2. Department Head, Team Lead and Team Member only, in both departments
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
  if v_department is null or not exists (select 1 from public.departments where id = v_department and slug in ('designstudio', 'ai-design-studio')) then
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

-- 3a. Access Control: the rule for one (department, function) pair (20261125000100 + Amuwa Design Studio)
create or replace function private.department_access_problem(p_department uuid, p_division text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  d public.departments;
  v_side public.departments;
begin
  if p_division is null or p_division not in ('SALES', 'SUPPORT') then
    return 'Choose Sales or Support.';
  end if;
  select * into d from public.departments where id = p_department;
  if d.id is null then return 'Department not found.'; end if;
  if d.slug in ('designstudio', 'ai-design-studio') then
    return format('%s has no Sales or Support function to give.', d.name);
  end if;
  if d.facet_of is not null and d.facet_division <> p_division then
    return format('%s is the %s department, so only %s can be given.', d.name, initcap(d.facet_division), initcap(d.facet_division));
  end if;
  select * into v_side from public.departments f where f.facet_of = d.id and f.facet_division = p_division;
  if v_side.id is not null then
    return format('The %s side of %s is the %s department. Give %s instead.', initcap(p_division), d.name, v_side.name, v_side.name);
  end if;
  if not exists (select 1 from public.teams x where x.department_id = coalesce(d.facet_of, d.id) and x.division::text = p_division) then
    return format('%s has no %s team, so there is nothing for this head to manage there.', d.name, initcap(p_division));
  end if;
  return null;
end $$;
revoke all on function private.department_access_problem(uuid, text) from public, anon;
grant execute on function private.department_access_problem(uuid, text) to authenticated, service_role;

-- 3b. The grants already given are withdrawn, each one in the audit log (one statement: no temporary table)
with gone as (
  delete from public.department_access a
   using public.departments d
   where d.id = a.department_id and d.slug in ('designstudio', 'ai-design-studio')
  returning a.profile_id, a.department_id, a.division
)
insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, metadata)
select null, 'DEPARTMENT_ACCESS_REVOKED', 'profile', g.profile_id, g.department_id,
       jsonb_build_object('division', g.division, 'reason', 'Amuwa Design Studio has no Sales or Support function')
  from gone g;

-- 4. The workspace's refusal (20270110000100, same body; only the department's name in the message)
create or replace function private.ads_actor()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.department_id is distinct from private.ads_dept_id() or me.role not in ('DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'FORBIDDEN: This page is for Amuwa Design Studio employees.' using errcode = '42501';
  end if;
  return me;
end $$;
