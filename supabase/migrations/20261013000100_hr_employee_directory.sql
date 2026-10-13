-- =============================================================================
-- HR Dashboard: show the real members of the CRM.
--
-- Problem: the HR panel listed a hard-coded array and the legacy hr_employees
-- table only. Members created by the Super Admin (or any manager) live in
-- public.profiles, so they never appeared in HR, and approvals made by the
-- Super Admin were never reflected there.
--
-- Fix:
--  * hr_employees.profile_id links an HR record (salary, documents, training /
--    left status ...) to the CRM account it belongs to, so one person is one row.
--    Existing hr_employees rows are kept; where an account with the same e-mail
--    exists they are linked automatically.
--  * public.hr_employee_directory() returns, in one call, every CRM member
--    (profiles) merged with their HR record, plus HR-only records that have no
--    CRM account yet, plus the departments with their head and member count.
--    It is SECURITY DEFINER but gated by private.is_hr_staff() (Super Admin and
--    ACTIVE HR-department members) - the same rule that already protects
--    hr_employees - so nobody else can read it.
--  * profiles and hr_employees are published for realtime so an open HR screen
--    refreshes after a member is created / approved / changed.
-- Idempotent. No data is dropped.
-- =============================================================================

alter table public.hr_employees
  add column if not exists profile_id uuid references public.profiles (id) on delete set null;

-- one HR record per CRM account
create unique index if not exists hr_employees_profile_id_key
  on public.hr_employees (profile_id) where profile_id is not null;

-- link existing HR records to the account with the same e-mail
update public.hr_employees h
   set profile_id = p.id
  from public.profiles p
 where h.profile_id is null
   and h.email is not null
   and lower(trim(h.email)) = p.email
   and not exists (select 1 from public.hr_employees x where x.profile_id = p.id);

create or replace function public.hr_employee_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_members jsonb;
  v_records jsonb;
  v_departments jsonb;
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can view the employee directory.' using errcode = '42501';
  end if;

  -- Every CRM account except Super Admins (they own the company, they are not payroll staff)
  select coalesce(jsonb_agg(m order by m ->> 'name'), '[]'::jsonb) into v_members
  from (
    select jsonb_build_object(
      'source', 'account',
      'profileId', p.id,
      'name', p.full_name,
      'email', p.email,
      'phone', coalesce(nullif(p.phone, ''), h.phone),
      'designation', coalesce(nullif(p.position, ''), nullif(h.designation, '')),
      'role', p.role,
      'accountStatus', p.status,
      'approvalStatus', case p.status when 'PENDING' then 'PENDING' when 'REJECTED' then 'REJECTED' else 'APPROVED' end,
      'approvedAt', p.approved_at,
      'approvedBy', (select a.full_name from public.profiles a where a.id = p.approved_by),
      'createdAt', p.created_at,
      'departmentId', d.id,
      'departmentSlug', d.slug,
      'departmentName', d.name,
      'teamId', t.id,
      'teamName', t.name,
      'teamLead', (select l.full_name from public.profiles l
                    where l.team_id = p.team_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.id <> p.id
                    order by l.created_at limit 1),
      'departmentHead', (select dh.full_name from public.profiles dh
                          where dh.department_id = p.department_id and dh.role = 'DEPARTMENT_HEAD'
                            and dh.status = 'ACTIVE' and dh.id <> p.id
                          order by dh.created_at limit 1),
      'hrRecordId', h.id,
      'hrStatus', h.status,
      'joiningDate', h.joining_date,
      'monthlySalary', h.monthly_salary,
      'workingHours', h.working_hours,
      'hrData', coalesce(h.data, '{}'::jsonb)
    ) as m
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    left join public.teams t on t.id = p.team_id
    left join lateral (
      select x.* from public.hr_employees x
       where x.profile_id = p.id
          or (x.profile_id is null and lower(trim(coalesce(x.email, ''))) = p.email)
       order by (x.profile_id is not null) desc, x.created_at
       limit 1) h on true
    where p.role <> 'SUPER_ADMIN' and p.status <> 'REJECTED'
  ) s;

  -- HR-only records (added by HR directly, no CRM login) that are not linked to an account
  select coalesce(jsonb_agg(r order by r ->> 'name'), '[]'::jsonb) into v_records
  from (
    select jsonb_build_object(
      'source', 'hr_record',
      'profileId', null,
      'name', h.name,
      'email', lower(coalesce(h.email, '')),
      'phone', h.phone,
      'designation', h.designation,
      'role', null,
      'accountStatus', null,
      'approvalStatus', 'APPROVED',
      'createdAt', h.created_at,
      'departmentId', d.id,
      'departmentSlug', coalesce(d.slug, h.department_id),
      'departmentName', d.name,
      'hrRecordId', h.id,
      'hrStatus', h.status,
      'joiningDate', h.joining_date,
      'monthlySalary', h.monthly_salary,
      'workingHours', h.working_hours,
      'hrData', coalesce(h.data, '{}'::jsonb)
    ) as r
    from public.hr_employees h
    left join public.departments d on d.slug = h.department_id
    where h.profile_id is null
      and not exists (select 1 from public.profiles p
                       where p.email = lower(trim(coalesce(h.email, ''))) and p.status <> 'REJECTED')
  ) s;

  select coalesce(jsonb_agg(x order by x ->> 'name'), '[]'::jsonb) into v_departments
  from (
    select jsonb_build_object(
      'id', d.id,
      'slug', d.slug,
      'name', d.name,
      'headName', (select dh.full_name from public.profiles dh
                    where dh.department_id = d.id and dh.role = 'DEPARTMENT_HEAD' and dh.status = 'ACTIVE'
                    order by dh.created_at limit 1),
      'memberCount', (select count(*) from public.profiles m
                       where m.department_id = d.id and m.status = 'ACTIVE' and m.role <> 'SUPER_ADMIN'),
      'isLocked', d.is_locked
    ) as x
    from public.departments d
  ) s;

  return jsonb_build_object('employees', v_members || v_records, 'departments', v_departments);
end $$;
revoke all on function public.hr_employee_directory() from public, anon;
grant execute on function public.hr_employee_directory() to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: lets an open HR screen refresh when members change.
-- (RLS still decides which rows a subscriber is told about; the screen also
-- refetches on focus and on a timer, so it never depends on this alone.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
      alter publication supabase_realtime add table public.profiles;
    end if;
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hr_employees') then
      alter publication supabase_realtime add table public.hr_employees;
    end if;
  end if;
end $$;
