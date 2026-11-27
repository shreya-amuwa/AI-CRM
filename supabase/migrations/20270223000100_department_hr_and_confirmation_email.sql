-- =============================================================================
-- 1. Department HR ("HR (Digitree)"): an HR employee whose whole HR scope is ONE business department.
-- 2. Probation confirmation: an employee becomes Confirmed only once the confirmation e-mail has really been sent.
--
-- Department HR
--  * Stored as: role TEAM_MEMBER, placed in the business department itself (Digitree) in its General team "Digitree HR",
--    designation 'Department HR', profiles.hr_sub_role = 'HR_DEPARTMENT', default_dashboard 'hr-department'.
--    The department the person is placed in IS their HR scope (profiles.department_id): there is no second scope table and nothing to keep in step.
--  * They are deliberately NOT in the HR department: every existing HR gate (private.is_hr_staff(), and the ~40 functions that check the HR
--    department directly) keeps refusing them, so no company-wide HR page, report or export opens for them. Only the functions below were
--    opened for them, each filtered to their own department in the database: the employee directory, the personal details it reads, and the
--    probation confirmations (list / read / confirm / close / retry the e-mail / overdue reminder).
--  * They are not a Department Head, so the X-Active-Department header (department switching) never applies to them.
--  * Only the Super Admin gives the designation (the API checks it before the account exists; the database refuses anyone else who is signed in).
--  * Existing HR members (HR Assistants, the HR Admin Head, e.g. Payal) are unchanged: they keep company-wide HR access, which already includes Digitree.
--
-- Probation confirmation
--  * Confirm now moves a PENDING cycle to CONFIRMING (who / when / effective date recorded) and queues the existing confirmation e-mails.
--  * The cycle becomes APPROVED (Confirmed; the HR record turns Full-Time; EMPLOYEE_CONFIRMED is audited) only when the employee's
--    CONFIRMATION_EMPLOYEE e-mail is recorded SENT (trigger on hr_email_events), whoever sent it (the immediate send after the click, or the scheduler).
--  * A failed / skipped e-mail leaves the cycle CONFIRMING, so it stays in the overdue list; hr_probation_retry_email re-queues the SAME e-mail rows
--    (unique event keys: a retry never creates a second confirmation or a second e-mail).
--  * The e-mail status is read from hr_email_events (tracked separately from the confirmation status); nothing is duplicated.
--  * hr_probation_remind_overdue: the overdue action beside Confirm. It reminds the employee's Department Head(s) and the department's HR in the CRM;
--    it never confirms anybody.
--
-- Safe to run again. Nothing is deleted. Run after 20270222000100_wallet_pin.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Department HR: values, the department's HR team
-- ---------------------------------------------------------------------------
alter table public.employee_personal_details drop constraint if exists employee_personal_details_designation_check;
alter table public.employee_personal_details add constraint employee_personal_details_designation_check
  check (designation in ('Operations Head', 'Department Head', 'Team Lead', 'Team Member', 'HR Assistant', 'HR Recruiter', 'HR Admin Head', 'Department HR'));

alter table public.profiles drop constraint if exists profiles_hr_sub_role_check;
alter table public.profiles add constraint profiles_hr_sub_role_check check (hr_sub_role is null or hr_sub_role in ('HR_ASSISTANT', 'HR_RECRUITER', 'HR_DEPARTMENT'));

-- Digitree's HR person needs a team (an active Team Member always has one). A General team keeps them out of every Sales / Support pipeline.
insert into public.teams (department_id, name, division)
select d.id, 'Digitree HR', 'GENERAL' from public.departments d where d.slug = 'digitree'
on conflict do nothing;

-- The department the signed-in user is HR for, when they are an active Department HR; otherwise null.
create or replace function private.department_hr_scope()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.department_id from public.profiles p join public.departments d on d.id = p.department_id
   where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and p.hr_sub_role = 'HR_DEPARTMENT'
     and d.slug not in ('hr', 'accounts')
$$;
revoke all on function private.department_hr_scope() from public, anon;
grant execute on function private.department_hr_scope() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The designation rule (latest definition from 20261222000500, plus Department HR)
-- ---------------------------------------------------------------------------
create or replace function private.designation_problem(p_slug text, p_role public.app_role, p_designation text, p_operations_head boolean)
returns text language plpgsql immutable set search_path = '' as $$
begin
  if p_designation is null then
    return null;
  end if;
  if p_designation = 'Department HR' then
    if p_slug is null or p_slug in ('hr', 'accounts') then
      return 'HR (department) is for an HR employee placed in one business department (for example Digitree), not in HR or Accounts.';
    end if;
    if p_role is distinct from 'TEAM_MEMBER' or coalesce(p_operations_head, false) then
      return 'HR (department) is a designation of a Team Member.';
    end if;
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
  if p_slug = 'hr' and not coalesce(p_operations_head, false) then
    return 'Choose HR Assistant, HR Recruiter or HR Admin Head for an HR employee.';
  end if;
  return null;
end $$;
revoke all on function private.designation_problem(text, public.app_role, text, boolean) from public, anon, authenticated;

-- Called by the server with the caller's JWT BEFORE any account exists. Department HR: Super Admin only, in a General team of the department.
create or replace function public.assert_designation_allowed(p_department uuid, p_team uuid, p_role public.app_role, p_designation text, p_operations_head boolean default false)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid := p_department;
  v_slug text;
  v_problem text;
  v_division text;
begin
  if p_team is not null then
    select t.department_id, t.division::text into v_dept, v_division from public.teams t where t.id = p_team;
  end if;
  select slug into v_slug from public.departments where id = v_dept;
  if v_slug = 'hr' and p_designation is null and not coalesce(p_operations_head, false) then
    raise exception 'VALIDATION_ERROR: Choose HR Assistant, HR Recruiter or HR Admin Head for an HR employee.' using errcode = 'P0001';
  end if;
  v_problem := private.designation_problem(v_slug, p_role, p_designation, p_operations_head);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
  if p_designation = 'Department HR' then
    if not private.is_super_admin() then
      raise exception 'FORBIDDEN: Only the Super Admin can create a department HR member.' using errcode = '42501';
    end if;
    if v_division is distinct from 'GENERAL' then
      raise exception 'VALIDATION_ERROR: A department HR member is placed in the department''s HR team, not in a Sales or Support team.' using errcode = 'P0001';
    end if;
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
  v_division text;
begin
  -- taking Department HR away also takes the department HR access away
  if tg_op = 'UPDATE' and old.designation = 'Department HR' and new.designation is distinct from old.designation then
    update public.profiles set hr_sub_role = null where id = new.profile_id and hr_sub_role = 'HR_DEPARTMENT';
  end if;
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
  if new.designation = 'Department HR' then
    -- a signed-in user other than the Super Admin never gives it (the server's own service-role write is checked before the account exists)
    if auth.uid() is not null and not private.is_super_admin() then
      raise exception 'FORBIDDEN: Only the Super Admin can make someone a department HR member.' using errcode = '42501';
    end if;
    select division::text into v_division from public.teams where id = p.team_id;
    if v_division is distinct from 'GENERAL' then
      raise exception 'VALIDATION_ERROR: A department HR member is placed in the department''s HR team, not in a Sales or Support team.' using errcode = 'P0001';
    end if;
    update public.profiles set hr_sub_role = 'HR_DEPARTMENT', "position" = coalesce(nullif("position", ''), 'HR') where id = p.id;
    perform private.write_audit('DEPARTMENT_HR_SET', 'profile', p.id, p.department_id, p.team_id, jsonb_build_object('departmentSlug', v_slug));
  elsif new.designation in ('HR Assistant', 'HR Recruiter', 'HR Admin Head') then
    -- HR Admin Head has no sub-role: the Department Head role of the HR department carries its leadership (nothing is granted by the designation alone)
    update public.profiles
       set hr_sub_role = case new.designation when 'HR Recruiter' then 'HR_RECRUITER' when 'HR Assistant' then 'HR_ASSISTANT' else null end,
           "position" = coalesce(nullif("position", ''), new.designation)
     where id = p.id;
  end if;
  return new;
end $$;
revoke all on function private.tg_designation_sets_hr_sub_role() from public, anon, authenticated;

-- A role / department change must not leave an HR designation on someone it no longer fits. A Department HR member's department IS their HR
-- scope, so only the Super Admin may move them to another department.
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
  if v_designation in ('HR Assistant', 'HR Recruiter', 'HR Admin Head', 'Department HR') then
    select slug into v_slug from public.departments where id = new.department_id;
    v_problem := private.designation_problem(v_slug, new.role, v_designation, new.is_operations_head);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
    if v_designation = 'Department HR' and new.department_id is distinct from old.department_id and auth.uid() is not null and not private.is_super_admin() then
      raise exception 'FORBIDDEN: Only the Super Admin can move a department HR member to another department.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_profile_keeps_hr_designation() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The dashboard (latest definition from 20270127000100, plus Department HR)
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
  -- Department HR: a Team Member in a General team of a business department (never HR / Accounts)
  if new.hr_sub_role = 'HR_DEPARTMENT' then
    if not (new.role = 'TEAM_MEMBER' and v_division = 'GENERAL' and v_slug is not null and v_slug not in ('hr', 'accounts')) then
      new.hr_sub_role := null;
    end if;
  -- an HR designation belongs to a Team Member / Team Lead of the HR department and nobody else
  elsif new.hr_sub_role is not null and not (v_slug = 'hr' and new.role in ('TEAM_MEMBER', 'TEAM_HEAD')) then
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
      when new.hr_sub_role = 'HR_DEPARTMENT' then 'hr-department'
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
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The employee directory and personal details, filtered to the department for Department HR
--    (latest definitions from 20261013000100 / 20261206000200; HR staff and the Super Admin see exactly what they saw before)
-- ---------------------------------------------------------------------------
create or replace function public.hr_employee_directory()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_members jsonb;
  v_records jsonb;
  v_departments jsonb;
  v_all boolean := private.is_hr_staff();
  v_scope uuid := case when private.is_hr_staff() then null else private.department_hr_scope() end;
begin
  if not v_all and v_scope is null then
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
      and (v_all or p.department_id = v_scope)
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
      and (v_all or d.id = v_scope)
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
    where v_all or d.id = v_scope
  ) s;

  return jsonb_build_object('employees', v_members || v_records, 'departments', v_departments);
end $$;
revoke all on function public.hr_employee_directory() from public, anon;
grant execute on function public.hr_employee_directory() to authenticated;

create or replace function public.hr_personal_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := private.is_hr_staff();
  v_scope uuid := case when private.is_hr_staff() then null else private.department_hr_scope() end;
begin
  if not v_all and v_scope is null then
    raise exception 'FORBIDDEN: Only HR staff can view employee personal details.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact,
      'contactNumber', d.contact_number))
    from public.employee_personal_details d
   where v_all or exists (select 1 from public.profiles p where p.id = d.profile_id and p.department_id = v_scope and p.role <> 'SUPER_ADMIN')), '[]'::jsonb);
end $$;
revoke all on function public.hr_personal_details() from public, anon;
grant execute on function public.hr_personal_details() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Probation confirmation: CONFIRMING until the e-mail is sent
-- ---------------------------------------------------------------------------
alter table public.hr_probation_cycles drop constraint if exists hr_probation_cycles_status_check;
alter table public.hr_probation_cycles add constraint hr_probation_cycles_status_check check (status in ('PENDING', 'CONFIRMING', 'APPROVED', 'DISMISSED'));
-- the last time somebody used the overdue reminder (shown next to the record)
alter table public.hr_probation_cycles add column if not exists overdue_reminded_at timestamptz;
create index if not exists hr_probation_cycles_department_idx on public.hr_probation_cycles (department_id, status);

-- May the signed-in user see this cycle? HR staff / Super Admin: all; Department HR: their department; the employee's Department Head: theirs.
create or replace function private.can_see_probation(p_cycle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hr_probation_cycles c where c.id = p_cycle
                   and (private.is_hr_staff() or (c.department_id is not null and c.department_id = private.department_hr_scope())))
      or private.can_confirm_probation(p_cycle)
$$;
revoke all on function private.can_see_probation(uuid) from public, anon;
grant execute on function private.can_see_probation(uuid) to authenticated, service_role;

-- May the signed-in user decide this confirmation? (latest definition from 20261107000100, plus the department's own HR) - never one's own.
create or replace function private.can_confirm_probation(p_cycle uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.hr_probation_cycles c
     where c.id = p_cycle
       and (private.is_super_admin() or (
         c.profile_id is distinct from auth.uid() and (
           exists (
             select 1 from public.profiles me join public.departments d on d.id = me.department_id
              where me.id = auth.uid() and me.status = 'ACTIVE'
                and ((d.slug = 'hr' and me.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD'))
                  or (me.role = 'DEPARTMENT_HEAD' and me.department_id = c.department_id)))
           or (c.department_id is not null and c.department_id = private.department_hr_scope()))))
  )
$$;
revoke all on function private.can_confirm_probation(uuid) from public, anon;
grant execute on function private.can_confirm_probation(uuid) to authenticated, service_role;

-- The cycle as the dashboard shows it, with the employee confirmation e-mail's own status next to the confirmation status.
create or replace function private.hr_cycle_json(c public.hr_probation_cycles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'employeeName', c.employee_name, 'employeeEmail', c.employee_email, 'employeeCode', c.employee_code,
    'department', c.department_name, 'joiningDate', c.joining_date, 'probationEnd', c.probation_end,
    'daysLeft', c.probation_end - private.hr_today(), 'status', c.status, 'effectiveDate', c.effective_date,
    'approvedAt', c.approved_at, 'approvedBy', (select a.full_name from public.profiles a where a.id = c.approved_by),
    'note', c.decision_note, 'canDecide', private.can_confirm_probation(c.id),
    -- overdue = the end date has passed and the employee is not confirmed yet (a CONFIRMING one whose e-mail is not sent stays overdue)
    'overdue', c.status in ('PENDING', 'CONFIRMING') and c.probation_end < private.hr_today(),
    'overdueRemindedAt', c.overdue_reminded_at,
    'email', (select jsonb_build_object('status', ev.status, 'error', ev.last_error, 'sentAt', ev.sent_at, 'sendAfter', ev.send_after,
                                        'attempts', ev.attempts, 'nextAttemptAt', ev.next_attempt_at)
                from public.hr_email_events ev where ev.event_key = 'CONFIRMATION_EMPLOYEE:' || c.id))
$$;
revoke all on function private.hr_cycle_json(public.hr_probation_cycles) from public, anon, authenticated;

-- The confirmation is complete: the employee's confirmation e-mail was sent. Called by the trigger below; idempotent.
create or replace function private.hr_complete_confirmation(p_cycle uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  update public.hr_probation_cycles set status = 'APPROVED', updated_at = now()
   where id = p_cycle and status = 'CONFIRMING' returning * into c;
  if c.id is null then return; end if;
  -- the HR record follows the decision (only a record that says "Training / Probation")
  update public.hr_employees set status = 'Full-Time', updated_at = now()
   where id = c.hr_record_id and status = 'Training / Probation';
  perform private.write_audit('EMPLOYEE_CONFIRMED', 'hr_probation', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'effectiveDate', c.effective_date, 'approvedBy', c.approved_by));
end $$;
revoke all on function private.hr_complete_confirmation(uuid) from public, anon, authenticated;

create or replace function private.tg_hr_confirmation_email_sent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'CONFIRMATION_EMPLOYEE' and new.status = 'SENT' and old.status is distinct from 'SENT' and new.cycle_id is not null then
    perform private.hr_complete_confirmation(new.cycle_id);
  end if;
  return new;
end $$;
revoke all on function private.tg_hr_confirmation_email_sent() from public, anon, authenticated;
drop trigger if exists hr_confirmation_email_sent on public.hr_email_events;
create trigger hr_confirmation_email_sent after update of status on public.hr_email_events
  for each row execute function private.tg_hr_confirmation_email_sent();

-- Confirm: validate, record the decision, queue the existing confirmation e-mails. The employee is NOT confirmed yet (CONFIRMING).
create or replace function public.hr_confirm_probation(p_cycle uuid, p_effective date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  me public.profiles;
  v_eff date;
  v_send timestamptz;
  r record;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the department''s HR, the employee''s Department Head or the Super Admin can confirm an employee, and nobody can confirm themselves.' using errcode = '42501';
  end if;
  if c.status = 'CONFIRMING' then
    raise exception 'CONFLICT: This confirmation is already in progress. Retry the confirmation e-mail instead.' using errcode = 'P0001';
  end if;
  if c.status <> 'PENDING' then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  v_eff := coalesce(p_effective, c.probation_end);
  if v_eff < c.joining_date or v_eff > private.hr_today() + 366 then
    raise exception 'VALIDATION_ERROR: Enter a valid confirmation effective date.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.hr_mail_employees() m where m.employee_key = c.employee_key and m.is_active) then
    raise exception 'VALIDATION_ERROR: This employee is no longer active, so they cannot be confirmed. Close the confirmation instead.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();

  update public.hr_probation_cycles
     set status = 'CONFIRMING', effective_date = v_eff, approved_by = auth.uid(), approved_at = now(),
         decision_note = nullif(left(btrim(coalesce(p_note, '')), 500), ''), updated_at = now()
   where id = c.id returning * into c;

  -- the confirmation e-mails go out once the probation period is over (not before) and only because of this decision
  v_send := greatest(now(), private.hr_nine_am(c.probation_end));
  perform private.hr_enqueue('CONFIRMATION_EMPLOYEE:' || c.id, 'CONFIRMATION_EMPLOYEE', c.employee_key, c.profile_id, c.id, c.employee_email, c.employee_name,
    jsonb_build_object('employeeName', c.employee_name, 'confirmationEffectiveDate', v_eff), private.hr_today(), v_send);
  for r in select * from private.hr_notify_recipients() n where n.email is distinct from c.employee_email loop
    perform private.hr_enqueue('CONFIRMATION_HR:' || c.id || ':' || r.email, 'CONFIRMATION_HR', c.employee_key, c.profile_id, c.id, r.email, r.name,
      jsonb_build_object('employeeName', c.employee_name, 'employeeCode', c.employee_code, 'department', coalesce(c.department_name, ''),
                         'joiningDate', c.joining_date, 'probationEndDate', c.probation_end, 'confirmationEffectiveDate', v_eff,
                         'approvalStatus', 'Approved', 'approvedBy', me.full_name),
      private.hr_today(), v_send);
  end loop;

  perform private.write_audit('EMPLOYEE_CONFIRMATION_STARTED', 'hr_probation', c.id, c.department_id, null,
    jsonb_build_object('employee', c.employee_name, 'effectiveDate', v_eff));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_confirm_probation(uuid, date, text) from public, anon;
grant execute on function public.hr_confirm_probation(uuid, date, text) to authenticated;

-- Retry the confirmation e-mail of a CONFIRMING cycle. Re-uses the same rows (no second confirmation, no second e-mail); the employee's address is
-- read again, so an address corrected in the HR record is used.
create or replace function public.hr_probation_retry_email(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  ev public.hr_email_events;
  v_email text;
  v_ok boolean;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the department''s HR, the employee''s Department Head or the Super Admin can retry a confirmation.' using errcode = '42501';
  end if;
  if c.status = 'APPROVED' then return private.hr_cycle_json(c); end if;   -- already confirmed: nothing to do (a double click)
  if c.status <> 'CONFIRMING' then
    raise exception 'CONFLICT: Confirm the employee first; there is no confirmation e-mail to retry.' using errcode = 'P0001';
  end if;

  select m.email into v_email from private.hr_mail_employees() m where m.employee_key = c.employee_key limit 1;
  v_email := nullif(lower(btrim(coalesce(v_email, c.employee_email, ''))), '');
  v_ok := coalesce(v_email, '') ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$';
  update public.hr_probation_cycles set employee_email = v_email, updated_at = now() where id = c.id returning * into c;

  select * into ev from public.hr_email_events where event_key = 'CONFIRMATION_EMPLOYEE:' || c.id for update;
  if ev.id is null then
    perform private.hr_enqueue('CONFIRMATION_EMPLOYEE:' || c.id, 'CONFIRMATION_EMPLOYEE', c.employee_key, c.profile_id, c.id, v_email, c.employee_name,
      jsonb_build_object('employeeName', c.employee_name, 'confirmationEffectiveDate', c.effective_date), private.hr_today(),
      greatest(now(), private.hr_nine_am(c.probation_end)));
  elsif ev.status = 'SENT' then
    perform private.hr_complete_confirmation(c.id);
  elsif ev.status in ('FAILED', 'SKIPPED', 'DRY_RUN', 'RETRY') then
    update public.hr_email_events
       set recipient_email = v_email, status = case when v_ok then 'PENDING' else 'SKIPPED' end, attempts = 0, next_attempt_at = now(),
           locked_until = null, last_error = case when v_ok then null else 'No valid e-mail address for the recipient.' end, updated_at = now()
     where id = ev.id;
  end if;   -- PENDING / SENDING: already on its way
  -- HR's copies that failed go again too (each one keyed per recipient)
  update public.hr_email_events set status = 'PENDING', attempts = 0, next_attempt_at = now(), locked_until = null, last_error = null, updated_at = now()
   where cycle_id = c.id and kind = 'CONFIRMATION_HR' and status in ('FAILED', 'RETRY');

  if not v_ok then
    raise exception 'VALIDATION_ERROR: % has no valid e-mail address. Add it to their HR record, then retry the confirmation e-mail.', c.employee_name using errcode = 'P0001';
  end if;
  perform private.write_audit('EMPLOYEE_CONFIRMATION_EMAIL_RETRY', 'hr_probation', c.id, c.department_id, null, jsonb_build_object('employee', c.employee_name));
  select * into c from public.hr_probation_cycles where id = c.id;
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_probation_retry_email(uuid) from public, anon;
grant execute on function public.hr_probation_retry_email(uuid) to authenticated;

-- Close without confirming (latest definition from 20261107000100). A confirmation whose e-mail could not be sent can be closed too; its unsent
-- e-mails are then dropped.
create or replace function public.hr_dismiss_probation(p_cycle uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not private.can_confirm_probation(c.id) then
    raise exception 'FORBIDDEN: Only the HR lead, the department''s HR, the employee''s Department Head or the Super Admin can close a confirmation.' using errcode = '42501';
  end if;
  if c.status not in ('PENDING', 'CONFIRMING') then raise exception 'CONFLICT: This confirmation was already decided.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_note, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Say why the confirmation is closed without e-mails (for example "confirmed earlier").' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.hr_email_events ev where ev.cycle_id = c.id and ev.kind = 'CONFIRMATION_EMPLOYEE' and ev.status = 'SENDING' and ev.locked_until > now()) then
    raise exception 'CONFLICT: The confirmation e-mail is being sent right now. Reload in a minute.' using errcode = 'P0001';
  end if;
  update public.hr_email_events
     set status = 'SKIPPED', last_error = 'The confirmation was closed.', locked_until = null, updated_at = now()
   where cycle_id = c.id and kind in ('CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR') and status in ('PENDING', 'RETRY', 'FAILED', 'DRY_RUN', 'SENDING');
  update public.hr_probation_cycles
     set status = 'DISMISSED', approved_by = auth.uid(), approved_at = now(), decision_note = left(btrim(p_note), 500), updated_at = now()
   where id = c.id returning * into c;
  perform private.write_audit('PROBATION_CLOSED', 'hr_probation', c.id, c.department_id, null, jsonb_build_object('employee', c.employee_name));
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_dismiss_probation(uuid, text) from public, anon;
grant execute on function public.hr_dismiss_probation(uuid, text) to authenticated;

-- The list (latest definition from 20261107000100): HR staff see all, Department HR their department. Undecided ones first.
create or replace function public.hr_probation_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_all boolean := private.is_hr_staff();
  v_scope uuid := case when private.is_hr_staff() then null else private.department_hr_scope() end;
begin
  if not v_all and v_scope is null then
    raise exception 'FORBIDDEN: Only HR staff can use the e-mail automation.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.hr_cycle_json(c) order by (c.status in ('PENDING', 'CONFIRMING')) desc, c.probation_end)
      from public.hr_probation_cycles c
     where (c.status in ('PENDING', 'CONFIRMING') or c.updated_at > now() - interval '90 days')
       and (v_all or c.department_id = v_scope)), '[]'::jsonb);
end $$;
revoke all on function public.hr_probation_list() from public, anon;
grant execute on function public.hr_probation_list() to authenticated;

-- One cycle (read back after an action).
create or replace function public.hr_probation_get(p_cycle uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle;
  if c.id is null or not private.can_see_probation(c.id) then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  return private.hr_cycle_json(c);
end $$;
revoke all on function public.hr_probation_get(uuid) from public, anon;
grant execute on function public.hr_probation_get(uuid) to authenticated;

-- The overdue action beside Confirm: remind the employee's Department Head(s) and the department's HR in the CRM. Never confirms anybody.
-- A reminder that is still unread is not repeated (private.notify_once).
create or replace function public.hr_probation_remind_overdue(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.hr_probation_cycles;
  r record;
  v_n integer := 0;
begin
  select * into c from public.hr_probation_cycles where id = p_cycle for update;
  if c.id is null then raise exception 'NOT_FOUND: Confirmation not found.' using errcode = 'P0001'; end if;
  if not (private.is_hr_staff() or (c.department_id is not null and c.department_id = private.department_hr_scope())) then
    raise exception 'FORBIDDEN: Only HR can send an overdue reminder.' using errcode = '42501';
  end if;
  if c.status not in ('PENDING', 'CONFIRMING') or c.probation_end >= private.hr_today() then
    raise exception 'CONFLICT: Only an overdue confirmation that is not completed can be reminded.' using errcode = 'P0001';
  end if;
  for r in select p.id from public.profiles p
            where p.status = 'ACTIVE' and p.department_id = c.department_id and p.id is distinct from c.profile_id and p.id is distinct from auth.uid()
              and (p.role = 'DEPARTMENT_HEAD' or (p.role = 'TEAM_MEMBER' and p.hr_sub_role = 'HR_DEPARTMENT')) loop
    perform private.notify_once(r.id, 'EMPLOYEE_PROBATION_OVERDUE', 'Probation confirmation overdue: ' || c.employee_name,
      c.employee_name || '''s probation ended on ' || to_char(c.probation_end, 'DD Mon YYYY') || ' and the confirmation is not completed yet.',
      'hr_probation', c.id, jsonb_build_object('cycleId', c.id, 'daysOverdue', private.hr_today() - c.probation_end), 'urgent');
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then
    raise exception 'VALIDATION_ERROR: % has no active Department Head to remind. Confirm the employee here, or close the confirmation.', coalesce(c.department_name, 'This department') using errcode = 'P0001';
  end if;
  update public.hr_probation_cycles set overdue_reminded_at = now() where id = c.id returning * into c;
  perform private.write_audit('PROBATION_OVERDUE_REMINDED', 'hr_probation', c.id, c.department_id, null, jsonb_build_object('employee', c.employee_name, 'reminded', v_n));
  return private.hr_cycle_json(c) || jsonb_build_object('reminded', v_n);
end $$;
revoke all on function public.hr_probation_remind_overdue(uuid) from public, anon;
grant execute on function public.hr_probation_remind_overdue(uuid) to authenticated;

-- The server sends one cycle's due confirmation e-mails at once after Confirm / Retry (the same claim rules as hr_email_claim).
create or replace function public.hr_email_claim_cycle(p_cycle uuid, p_mode text default 'live', p_lease_seconds integer default 600, p_only_recipients text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_ids from (
    select ev.id from public.hr_email_events ev
     where ev.cycle_id = p_cycle and ev.kind in ('CONFIRMATION_EMPLOYEE', 'CONFIRMATION_HR')
       and ev.send_after <= now()
       and (p_only_recipients is null or lower(ev.recipient_email) = any (p_only_recipients))
       and ((ev.status in ('PENDING', 'RETRY') and ev.next_attempt_at <= now())
         or (p_mode = 'live' and ev.status = 'DRY_RUN')
         or (ev.status = 'SENDING' and ev.locked_until < now()))
     order by (ev.kind = 'CONFIRMATION_EMPLOYEE') desc, ev.send_after
     limit 20
     for update skip locked) x;

  update public.hr_email_events
     set status = 'SENDING', attempts = case when status = 'DRY_RUN' then 1 else attempts + 1 end, last_attempt_at = now(), updated_at = now(),
         locked_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 1800)))
   where id = any (v_ids);

  return coalesce((
    select jsonb_agg(jsonb_build_object('id', ev.id, 'kind', ev.kind, 'attempts', ev.attempts, 'to', ev.recipient_email,
                                        'toName', ev.recipient_name, 'payload', ev.payload, 'eventDate', ev.event_date) order by ev.send_after)
      from public.hr_email_events ev where ev.id = any (v_ids)), '[]'::jsonb);
end $$;
revoke all on function public.hr_email_claim_cycle(uuid, text, integer, text[]) from public, anon, authenticated;
grant execute on function public.hr_email_claim_cycle(uuid, text, integer, text[]) to service_role;

notify pgrst, 'reload schema';
