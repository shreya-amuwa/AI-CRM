-- =============================================================================
-- Amuwa Design Studio is an active department again.
--
-- Migration 20270112000200 renamed the department that has the Design Studio people (slug 'designstudio') to
-- "Amuwa Design Studio (Retired)" and the add forms refused to add anyone to it. Nothing in the database was ever locked or
-- deactivated: only the NAME said "(Retired)" (departments have no status column; is_locked is untouched). This migration:
--
--   1. gives the department built as "AI Design Studio" (slug 'ai-design-studio', its own dashboards and ads_* functions) its own
--      name back, which frees the unique name;
--   2. restores the name and description of Amuwa Design Studio (slug 'designstudio');
--   3. makes sure Amuwa Design Studio has a General team, because the add forms place new people in it (Sales / Support teams stay
--      for the people already in them);
--   4. says "AI Design Studio" in the refusal of the ads_* workspace.
--
-- Nobody is moved, deleted, locked or deactivated: profiles, teams, customers, services, assignments, reports, attendance and the
-- audit log are not touched, and no password is reset. The rule of 20270112000100 / 20270112000200 (Department Head, Team Lead and
-- Team Member only; no Sales or Support role, team or side for NEW people) stays for both departments.
-- Safe to run again.
-- =============================================================================

-- 1. AI Design Studio first (department names are unique, case-insensitive)
update public.departments
   set name = 'AI Design Studio',
       description = 'Client design services: client work, assignments, daily reports and issues.'
 where slug = 'ai-design-studio' and name is distinct from 'AI Design Studio';

-- 2. Amuwa Design Studio (the original description of the department)
update public.departments
   set name = 'Amuwa Design Studio',
       description = 'A Place Start Creative Solutions & Strategic Design Innovation'
 where slug = 'designstudio' and (name is distinct from 'Amuwa Design Studio' or description = '');

-- 3. A General team, only when it has none (a team name is unique inside a department, so an existing "General" is never duplicated)
insert into public.teams (department_id, name, division)
select d.id, 'General', 'GENERAL'::public.team_division
  from public.departments d
 where d.slug = 'designstudio'
   and not exists (select 1 from public.teams t where t.department_id = d.id and (t.division::text = 'GENERAL' or lower(t.name) = 'general'));

-- 4. The workspace's refusal (20270112000200, same body; only the department's name in the message)
create or replace function private.ads_actor()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.department_id is distinct from private.ads_dept_id() or me.role not in ('DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'FORBIDDEN: This page is for AI Design Studio employees.' using errcode = '42501';
  end if;
  return me;
end $$;
