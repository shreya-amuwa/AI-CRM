-- =============================================================================
-- HR Recruiter: a second designation inside the HR department.
--
--  * profiles.hr_sub_role: HR_ASSISTANT or HR_RECRUITER (the same idea as the Sales sub-role of a Telecaller). It is only kept for an active-capable
--    Team Member / Team Lead of the HR department; anywhere else it is cleared. NULL means "HR Assistant": every HR employee that exists today keeps
--    the HR dashboard and what it can do.
--  * The designation chosen when an employee is created (HR Assistant / HR Recruiter, employee_personal_details.designation) sets the sub-role by
--    itself, so both ways of creating an employee (direct creation, and a request that is approved) need no extra step.
--  * A Recruiter opens the HR Recruiter dashboard (default_dashboard 'hr-recruiter'). They are NOT "HR staff" in the sense of private.is_hr_staff():
--    the HR Assistant pages (directory, leave, issues, e-mail automation, performance reviews ...) refuse them in the database, not only in the menu.
--    The Super Admin and every HR Assistant keep the access they have.
--  * private.is_hr_recruiter(), private.is_hr_leadership() and private.recruiter_require() are the gates the recruiter functions use.
--
-- Safe to run again. Nothing is deleted.
-- =============================================================================

alter table public.profiles add column if not exists hr_sub_role text;
alter table public.profiles drop constraint if exists profiles_hr_sub_role_check;
alter table public.profiles add constraint profiles_hr_sub_role_check check (hr_sub_role is null or hr_sub_role in ('HR_ASSISTANT', 'HR_RECRUITER'));

-- the two HR designations next to the four that exist
alter table public.employee_personal_details drop constraint if exists employee_personal_details_designation_check;
alter table public.employee_personal_details add constraint employee_personal_details_designation_check
  check (designation in ('Operations Head', 'Department Head', 'Team Lead', 'Team Member', 'HR Assistant', 'HR Recruiter'));

-- ---------------------------------------------------------------------------
-- 1. The dashboard the database proposes (the latest definition, plus HR Recruiter)
-- ---------------------------------------------------------------------------
create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
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
      when v_slug = 'hr' then 'hr-head'
      when new.head_division = 'SALES' and v_slug is distinct from 'accounts' then 'sales-department-head'
      else 'department-head' end
    when 'TEAM_HEAD' then case
      when v_slug = 'accounts' then 'accounts-staff'
      when v_slug = 'hr' and new.hr_sub_role = 'HR_RECRUITER' then 'hr-recruiter'
      when v_division = 'SUPPORT' then 'support-lead'
      when v_division = 'SALES' then 'sales-lead'
      else 'team-lead'
    end
    else case
      when v_slug = 'accounts' then 'accounts-staff'
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
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who is who in HR
-- ---------------------------------------------------------------------------
-- An active HR Recruiter.
create or replace function private.is_hr_recruiter()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and p.hr_sub_role = 'HR_RECRUITER' and d.slug = 'hr')
$$;
revoke all on function private.is_hr_recruiter() from public, anon;
grant execute on function private.is_hr_recruiter() to authenticated, service_role;

-- The people who may allocate vacancies and see recruitment company-wide: the Super Admin and the Department Head of HR.
create or replace function private.is_hr_leadership()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and d.slug = 'hr')
$$;
revoke all on function private.is_hr_leadership() from public, anon;
grant execute on function private.is_hr_leadership() to authenticated, service_role;

-- The HR pages that are not recruitment (directory, leave, issues, e-mail automation ...) are for HR staff WITHOUT the Recruiter designation. The
-- Super Admin and every other HR employee (HR Assistant, HR Department Head, older accounts with no designation) are unchanged.
create or replace function private.is_hr_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin() or exists (
    select 1 from public.profiles p join public.departments d on d.id = p.department_id
    where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'hr' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER')
$$;

-- HR performance reviews and the weekly reports that reach HR are an HR Assistant / HR head task, not a Recruiter's.
create or replace function private.is_hr_reviewer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'hr' and p.role <> 'SUPER_ADMIN' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER')
$$;
create or replace function private.hr_reviewer_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.departments d on d.id = p.department_id
   where p.status = 'ACTIVE' and d.slug = 'hr' and p.role <> 'SUPER_ADMIN' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER'
$$;

-- The HR team that is told about HR matters (issues, meetings, requests): not the Recruiters.
create or replace function private.notify_hr(p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb,
  p_priority text default 'normal', p_only uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_any boolean := false;
begin
  if p_only is not null then
    perform private.notify_once(p_only, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
    return;
  end if;
  for r in select p.id from public.profiles p join public.departments d on d.id = p.department_id
            where d.slug = 'hr' and p.status = 'ACTIVE' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER' loop
    v_any := true;
    perform private.notify_once(r.id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
  end loop;
  if not v_any then
    for r in select p.id from public.profiles p where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE' loop
      perform private.notify_once(r.id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
    end loop;
  end if;
end $$;

-- Every recruiter page starts here: a Recruiter, or the Super Admin / HR head who look after recruitment.
create or replace function private.recruiter_require()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_hr_recruiter() or private.is_hr_leadership()) then
    raise exception 'FORBIDDEN: Recruitment is for HR Recruiters.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.recruiter_require() from public, anon;
grant execute on function private.recruiter_require() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The designation sets the sub-role
-- ---------------------------------------------------------------------------
create or replace function private.tg_designation_sets_hr_sub_role()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  v_slug text;
begin
  if new.designation is null or new.designation not in ('HR Assistant', 'HR Recruiter') then
    return new;
  end if;
  select * into p from public.profiles where id = new.profile_id;
  select slug into v_slug from public.departments where id = p.department_id;
  if p.id is null or v_slug is distinct from 'hr' or p.role not in ('TEAM_MEMBER', 'TEAM_HEAD') then
    raise exception 'VALIDATION_ERROR: HR Assistant and HR Recruiter are designations of Team Members and Team Leads of the HR department.' using errcode = 'P0001';
  end if;
  update public.profiles set hr_sub_role = case new.designation when 'HR Recruiter' then 'HR_RECRUITER' else 'HR_ASSISTANT' end,
         "position" = coalesce(nullif("position", ''), new.designation)
   where id = p.id;
  return new;
end $$;
revoke all on function private.tg_designation_sets_hr_sub_role() from public, anon, authenticated;
drop trigger if exists employee_designation_hr_sub_role on public.employee_personal_details;
create trigger employee_designation_hr_sub_role after insert or update of designation on public.employee_personal_details
  for each row execute function private.tg_designation_sets_hr_sub_role();

-- Change an existing HR employee between HR Assistant and HR Recruiter. Only the Super Admin and the Department Head of HR; audited.
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
  if v_slug is distinct from 'hr' or t.role not in ('TEAM_MEMBER', 'TEAM_HEAD') then
    raise exception 'VALIDATION_ERROR: HR Assistant and HR Recruiter are designations of Team Members and Team Leads of the HR department.' using errcode = 'P0001';
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
