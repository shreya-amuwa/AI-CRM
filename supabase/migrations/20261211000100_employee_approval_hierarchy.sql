-- =============================================================================
-- Multi-level employee approval, Operations Head department ownership, and Department Head team assignment.
--
-- HR (or a Team Lead, for a Team Member) submits an employee. The person exists at once as a PENDING profile that cannot sign in; the request
-- is routed to ONE accountable approver, resolved here and never taken from the caller:
--
--     requested role        approver
--     Operations Head       Super Admin
--     Department Head       the Operations Head who OWNS the department (department_operations_owner)
--     Team Lead             the respective Department Head
--     Team Member           the respective Department Head
--
-- The decision (approve + activate, or reject with a reason) is one atomic function. Nothing else can turn such a profile ACTIVE (a trigger
-- refuses it), and nothing else can change such a request's status. Approval and TEAM assignment are separate: an approved Team Member is
-- active in the department's "awaiting assignment" pool and the Department Head later assigns them under an active Team Lead
-- (assign_member_to_team_lead), which writes history and never creates an approval request.
--
-- Reused, not duplicated: approval_requests (extended), profiles, department_access (the Operations Head's department scope),
-- private.notify, private.write_audit, the provisioning trigger. Existing self-registration requests keep their own flow (source REGISTRATION).
-- Additive and safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------------
alter table public.approval_requests
  add column if not exists source text not null default 'REGISTRATION',
  add column if not exists requested_role public.app_role,
  add column if not exists requested_operations_head boolean not null default false,
  add column if not exists requested_division text,
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null,
  add column if not exists approver_kind text,
  add column if not exists approver_id uuid references public.profiles (id) on delete set null,
  add column if not exists attempt integer not null default 1,
  add column if not exists resubmission_of uuid references public.approval_requests (id) on delete set null,
  add column if not exists employee_code text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'approval_requests_source_check') then
    alter table public.approval_requests add constraint approval_requests_source_check check (source in ('REGISTRATION', 'HR', 'MANAGER'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_requests_division_check') then
    alter table public.approval_requests add constraint approval_requests_division_check check (requested_division is null or requested_division in ('SALES', 'SUPPORT', 'GENERAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_requests_approver_kind_check') then
    alter table public.approval_requests add constraint approval_requests_approver_kind_check check (approver_kind is null or approver_kind in ('SUPER_ADMIN', 'OPERATIONS_HEAD', 'DEPARTMENT_HEAD'));
  end if;
end $$;

create index if not exists approval_requests_employee_idx on public.approval_requests (source, status, created_at desc) where source <> 'REGISTRATION';
create index if not exists approval_requests_approver_idx on public.approval_requests (approver_id) where status = 'PENDING' and approver_id is not null;

-- "Operations Head" is a designation too
alter table public.employee_personal_details drop constraint if exists employee_personal_details_designation_check;
alter table public.employee_personal_details add constraint employee_personal_details_designation_check
  check (designation in ('Operations Head', 'Department Head', 'Team Lead', 'Team Member'));

-- Approved Team Members wait in a pool team of their department until the Department Head assigns them under a Team Lead.
alter table public.teams add column if not exists is_pool boolean not null default false;

-- One accountable Operations Head per department (the primary approver of Department Head requests).
create table if not exists public.department_operations_owner (
  department_id uuid primary key references public.departments (id) on delete cascade,
  operations_head_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);
create index if not exists department_operations_owner_head_idx on public.department_operations_owner (operations_head_id);
alter table public.department_operations_owner enable row level security;

-- Where a Team Member sits and who put them there (kept for ever).
create table if not exists public.team_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  from_team_id uuid references public.teams (id) on delete set null,
  to_team_id uuid references public.teams (id) on delete set null,
  lead_id uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  kind text not null check (kind in ('PLACEMENT', 'ASSIGNMENT', 'REASSIGNMENT')),
  note text check (length(note) <= 500),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists team_assignments_profile_idx on public.team_assignments (profile_id, created_at desc);
create index if not exists team_assignments_lead_idx on public.team_assignments (lead_id, created_at desc);
alter table public.team_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Who is who
-- ---------------------------------------------------------------------------
create or replace function private.actor_is_hr(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = p_actor and p.status = 'ACTIVE' and d.slug = 'hr')
$$;
revoke all on function private.actor_is_hr(uuid) from public, anon, authenticated;

-- The accountable Operations Head of a department: the recorded owner, still an active Operations Head, whose scope still covers it.
create or replace function private.owner_of_department(p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select o.operations_head_id
    from public.department_operations_owner o
    join public.profiles p on p.id = o.operations_head_id
   where o.department_id in (p_department, private.base_department(p_department))
     and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
     and exists (select 1 from private.scopes_of(p.id) s where s.department_id = private.base_department(p_department))
   order by (o.department_id = p_department) desc
   limit 1
$$;
revoke all on function private.owner_of_department(uuid) from public, anon, authenticated;

-- The pool team (approved, not yet assigned under a Team Lead) of a department and side.
create or replace function private.pool_team(p_department uuid, p_division text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_dept uuid := private.base_department(p_department);
  v_div public.team_division := coalesce(nullif(upper(p_division), ''), 'GENERAL')::public.team_division;
  v_id uuid;
begin
  select t.id into v_id from public.teams t where t.department_id = v_dept and t.is_pool and t.division = v_div;
  if v_id is null then
    insert into public.teams (department_id, name, division, is_pool)
    values (v_dept, 'Awaiting assignment (' || initcap(v_div::text) || ')', v_div, true)
    on conflict (department_id, lower(name)) do update set is_pool = true
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function private.pool_team(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Routing: who approves (decided here, from the stored request - never from the caller)
-- ---------------------------------------------------------------------------
create or replace function private.resolve_employee_approver(p_role public.app_role, p_ops boolean, p_department uuid, p_division text)
returns table (kind text, approver_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_role = 'DEPARTMENT_HEAD' and p_ops then
    return query select 'SUPER_ADMIN'::text, null::uuid;
  elsif p_role = 'DEPARTMENT_HEAD' then
    return query select 'OPERATIONS_HEAD'::text, private.owner_of_department(p_department);   -- null = nobody owns it yet: stays pending, the Super Admin is told
  else
    return query select 'DEPARTMENT_HEAD'::text,
      (select h.id from public.profiles h
        where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = private.base_department(p_department)
          and (h.head_division is null or p_division is null or p_division = 'GENERAL' or h.head_division = p_division)
        order by (h.head_division is not distinct from p_division) desc, h.created_at limit 1);
  end if;
end $$;
revoke all on function private.resolve_employee_approver(public.app_role, boolean, uuid, text) from public, anon, authenticated;

-- Is the signed-in person the right approver of this request?
create or replace function private.can_decide_employee_request(p_request uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
  me public.profiles;
  v_approver public.profiles;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if r.id is null or me.id is null or r.source = 'REGISTRATION' or r.subject_user_id = me.id then
    return false;                                     -- nobody approves their own account
  end if;
  if me.role = 'SUPER_ADMIN' then
    return true;                                      -- ultimate authority
  end if;
  if r.approver_kind = 'OPERATIONS_HEAD' then
    return me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and private.owner_of_department(r.department_id) = me.id;
  elsif r.approver_kind = 'DEPARTMENT_HEAD' then
    if me.role <> 'DEPARTMENT_HEAD' or private.base_department(me.department_id) is distinct from private.base_department(r.department_id) then
      return false;
    end if;
    if not (me.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or me.head_division = r.requested_division) then
      return false;
    end if;
    if r.approver_id is null or r.approver_id = me.id then
      return true;
    end if;
    select * into v_approver from public.profiles where id = r.approver_id;
    return v_approver.id is null or v_approver.status <> 'ACTIVE' or v_approver.role <> 'DEPARTMENT_HEAD';   -- the named head is gone: the respective head takes over
  end if;
  return false;                                       -- SUPER_ADMIN requests: only the Super Admin
end $$;
revoke all on function private.can_decide_employee_request(uuid) from public, anon, authenticated;
grant execute on function private.can_decide_employee_request(uuid) to authenticated;

-- Who may SEE a request: HR (monitoring), the Super Admin, the submitter, the approver, the owner / respective heads of the department.
create or replace function private.can_see_employee_request(p_request uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
  me public.profiles;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if r.id is null or me.id is null or r.source = 'REGISTRATION' then
    return false;
  end if;
  return me.role = 'SUPER_ADMIN' or private.actor_is_hr(me.id) or r.submitted_by = me.id or r.approver_id = me.id or r.decided_by = me.id
      or private.can_decide_employee_request(p_request)
      or (me.role = 'DEPARTMENT_HEAD' and private.base_department(me.department_id) = private.base_department(r.department_id) and r.requested_role in ('TEAM_HEAD', 'TEAM_MEMBER'))
      or (me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and r.requested_role = 'DEPARTMENT_HEAD'
          and exists (select 1 from private.scopes_of(me.id) s where s.department_id = private.base_department(r.department_id)));
end $$;
revoke all on function private.can_see_employee_request(uuid) from public, anon, authenticated;
grant execute on function private.can_see_employee_request(uuid) to authenticated;

drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (subject_user_id = (select auth.uid()) or private.can_manage_profile(subject_user_id) or private.can_see_employee_request(id));

-- A rejected account is final - except that HR may correct and resubmit an EMPLOYEE request (the switch is set only inside employee_request_resubmit).
create or replace function private.tg_profiles_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'PENDING'   and new.status in ('ACTIVE', 'REJECTED')) or
      (old.status = 'ACTIVE'    and new.status in ('SUSPENDED', 'REVOKED')) or
      (old.status = 'SUSPENDED' and new.status in ('ACTIVE', 'REVOKED')) or
      (old.status = 'REVOKED'   and new.status = 'ACTIVE') or
      (old.status = 'REJECTED'  and new.status = 'PENDING' and coalesce(current_setting('crm.employee_resubmit', true), '') = 'on')
    ) then
      raise exception 'VALIDATION_ERROR: Cannot change account status from % to %.', old.status, new.status
        using errcode = 'P0001';
    end if;
    new.status_changed_at := now();
    new.status_changed_by := (select id from public.profiles where id = auth.uid());
    if old.status = 'PENDING' and new.status = 'ACTIVE' then
      new.approved_at := now();
      new.approved_by := new.status_changed_by;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Nothing activates these people, or changes these requests, except the decision function
-- ---------------------------------------------------------------------------
create or replace function private.tg_approval_requests_employee_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.source <> 'REGISTRATION' and new.status is distinct from old.status
     and coalesce(current_setting('crm.employee_decision', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN: An employee request is decided only through the employee approval.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_approval_requests_employee_guard() from public, anon, authenticated;
drop trigger if exists approval_requests_employee_guard on public.approval_requests;
create trigger approval_requests_employee_guard before update of status on public.approval_requests
  for each row execute function private.tg_approval_requests_employee_guard();

create or replace function private.tg_profiles_employee_activation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ACTIVE' and old.status in ('PENDING', 'REJECTED')
     and exists (select 1 from public.approval_requests r where r.subject_user_id = new.id and r.source <> 'REGISTRATION')
     and not exists (select 1 from public.approval_requests r where r.subject_user_id = new.id and r.source <> 'REGISTRATION' and r.status = 'APPROVED')
     and coalesce(current_setting('crm.employee_decision', true), '') <> 'on' then
    raise exception 'FORBIDDEN: This employee has no completed approval yet and cannot be activated.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_employee_activation_guard() from public, anon, authenticated;
drop trigger if exists profiles_employee_activation_guard on public.profiles;
create trigger profiles_employee_activation_guard before update of status on public.profiles
  for each row execute function private.tg_profiles_employee_activation_guard();

-- ---------------------------------------------------------------------------
-- 5. What a request looks like to the screens (no password, no token, nothing that is not needed to decide)
-- ---------------------------------------------------------------------------
create or replace function private.employee_request_json(r public.approval_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'source', r.source, 'attempt', r.attempt, 'resubmissionOf', r.resubmission_of,
    'requestedRole', case when r.requested_operations_head then 'OPERATIONS_HEAD' else r.requested_role::text end,
    'department', (select jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug) from public.departments d where d.id = r.department_id),
    'division', r.requested_division,
    'employee', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
                    'designation', coalesce(e.designation, p.position), 'joiningDate', e.joining_date,
                    'contactNumber', coalesce(e.contact_number, p.phone), 'employeeCode', r.employee_code)
                   from public.profiles p left join public.employee_personal_details e on e.profile_id = p.id where p.id = r.subject_user_id),
    'submittedBy', (select jsonb_build_object('id', s.id, 'name', s.full_name) from public.profiles s where s.id = r.submitted_by),
    'submittedAt', r.created_at,
    'approverKind', r.approver_kind,
    'approver', (select jsonb_build_object('id', a.id, 'name', a.full_name) from public.profiles a where a.id = r.approver_id),
    -- a Department Head request nobody owns yet: it stays pending until the Super Admin names the accountable Operations Head
    'awaitingOwner', r.status = 'PENDING' and r.approver_kind = 'OPERATIONS_HEAD' and private.owner_of_department(r.department_id) is null,
    'decidedBy', (select jsonb_build_object('id', d.id, 'name', d.full_name) from public.profiles d where d.id = r.decided_by),
    'decidedAt', r.decided_at, 'decisionNote', r.decision_note,
    'canDecide', r.status = 'PENDING' and private.can_decide_employee_request(r.id))
$$;
revoke all on function private.employee_request_json(public.approval_requests) from public, anon, authenticated;

-- Tell the approver (or, when nobody owns the department yet, the Super Admin). One call per event.
create or replace function private.notify_employee_request_approver(r public.approval_requests, p_resubmitted boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_role text := case when r.requested_operations_head then 'Operations Head' else initcap(replace(lower(r.requested_role::text), '_', ' ')) end;
  v_dept text;
  v_to uuid;
  v_count integer := 0;
  v_title text;
begin
  select full_name into v_name from public.profiles where id = r.subject_user_id;
  select name into v_dept from public.departments where id = r.department_id;
  v_title := format('%s: %s (%s, %s)', case when p_resubmitted then 'Employee request sent again' else 'Employee approval needed' end, v_name, replace(v_role, 'Team Head', 'Team Lead'), coalesce(v_dept, 'no department'));

  if r.approver_kind = 'OPERATIONS_HEAD' and r.approver_id is not null then
    perform private.notify(r.approver_id, 'EMPLOYEE_APPROVAL_REQUEST', v_title, 'HR submitted a Department Head for your department. Approve or reject it.', 'approval_request', r.id, '{}'::jsonb, 'urgent');
    return;
  elsif r.approver_kind = 'OPERATIONS_HEAD' then
    for v_to in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_to, 'DEPARTMENT_OWNER_MISSING', format('%s has no Operations Head to approve its Department Head', coalesce(v_dept, 'A department')),
        format('A Department Head request for %s is waiting. Assign an Operations Head to this department (Operations Heads page).', coalesce(v_dept, 'a department')),
        'approval_request', r.id, '{}'::jsonb, 'urgent');
    end loop;
    return;
  elsif r.approver_kind = 'DEPARTMENT_HEAD' then
    for v_to in select h.id from public.profiles h
                 where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = private.base_department(r.department_id)
                   and (r.approver_id is null and (h.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or h.head_division = r.requested_division) or h.id = r.approver_id) loop
      perform private.notify(v_to, 'EMPLOYEE_APPROVAL_REQUEST', v_title, 'Approve or reject this employee for your department.', 'approval_request', r.id, '{}'::jsonb, 'urgent');
      v_count := v_count + 1;
    end loop;
  end if;
  if v_count = 0 then   -- the Super Admin decides requests of every kind, and is the fallback when no head exists
    for v_to in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_to, 'EMPLOYEE_APPROVAL_REQUEST', v_title,
        case when r.approver_kind = 'SUPER_ADMIN' then 'HR submitted an Operations Head. Approve it and choose the departments they manage.' else 'The department has no active Department Head to approve this employee.' end,
        'approval_request', r.id, '{}'::jsonb, 'urgent');
    end loop;
  end if;
end $$;
revoke all on function private.notify_employee_request_approver(public.approval_requests, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Submit: one set of rules for the first submission and for a resubmission
-- ---------------------------------------------------------------------------
-- Who may ask for which employee. HR (any role of the HR department) may submit any of the four; a Team Lead only a Team Member of their own
-- department and side. Returns where the request comes from, the side, and the department the profile belongs to.
create or replace function private.check_employee_submission(p_actor uuid, p_role public.app_role, p_ops boolean, p_department uuid, p_division text,
                                                             out o_source text, out o_division text, out o_profile_department uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.profiles;
  v_dept public.departments;
begin
  select * into v_actor from public.profiles where id = p_actor and status = 'ACTIVE';
  if v_actor.id is null then
    raise exception 'FORBIDDEN: Only an active HR member or Team Lead can submit an employee.' using errcode = '42501';
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
  if private.actor_is_hr(v_actor.id) then
    o_source := 'HR';
  elsif v_actor.role = 'TEAM_HEAD' and p_role = 'TEAM_MEMBER' and private.base_department(v_actor.department_id) = private.base_department(v_dept.id) then
    o_source := 'MANAGER';
    o_division := (select t.division::text from public.teams t where t.id = v_actor.team_id);
  else
    raise exception 'FORBIDDEN: You cannot submit this employee.' using errcode = '42501';
  end if;
  o_profile_department := case when p_role = 'DEPARTMENT_HEAD' then v_dept.id else private.base_department(v_dept.id) end;
end $$;
revoke all on function private.check_employee_submission(uuid, public.app_role, boolean, uuid, text) from public, anon, authenticated;

-- Called by the provisioning trigger, after the auth user exists.
create or replace function private.provision_employee_request(p_user auth.users, p_app jsonb, p_email text, p_name text, p_meta jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.try_uuid(p_app ->> 'request_by');
  v_role public.app_role;
  v_ops boolean := coalesce((p_app ->> 'request_operations_head')::boolean, false);
  v_dept uuid := private.try_uuid(p_app ->> 'request_department_id');
  v_check record;
  v_route record;
  v_profile public.profiles;
  v_request public.approval_requests;
begin
  begin
    v_role := (p_app ->> 'request_role')::public.app_role;
  exception when others then
    raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
  end;
  select * into v_check from private.check_employee_submission(v_actor, v_role, v_ops, v_dept, p_app ->> 'request_division');

  insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division)
  values (p_user.id, p_email, p_name, nullif(trim(p_meta ->> 'position'), ''), v_role, 'PENDING', v_check.o_profile_department, null,
          case when v_role = 'DEPARTMENT_HEAD' and v_check.o_division in ('SALES', 'SUPPORT') then v_check.o_division end)
  returning * into v_profile;

  select * into v_route from private.resolve_employee_approver(v_role, v_ops, v_dept, v_check.o_division);
  insert into public.approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_operations_head, requested_division,
                                        submitted_by, approver_kind, approver_id, employee_code)
  values ('USER_REGISTRATION', v_profile.id, v_check.o_profile_department, 'PENDING', v_check.o_source, v_role, v_ops, v_check.o_division,
          v_actor, v_route.kind, v_route.approver_id, left(nullif(trim(p_app ->> 'request_employee_code'), ''), 40))
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, metadata)
  values (v_actor, 'EMPLOYEE_REQUEST_SUBMITTED', 'profile', v_profile.id, v_check.o_profile_department,
          jsonb_build_object('request', v_request.id, 'role', case when v_ops then 'OPERATIONS_HEAD' else v_role::text end, 'approver', v_route.kind, 'source', v_check.o_source));
  perform private.notify_employee_request_approver(v_request);
end $$;
revoke all on function private.provision_employee_request(auth.users, jsonb, text, text, jsonb) from public, anon, authenticated;

-- A rejected request is corrected and sent again: the same person, a new attempt (the earlier one stays in the history).
create or replace function public.employee_request_resubmit(p_request uuid, p_role public.app_role, p_operations_head boolean, p_department uuid,
                                                             p_division text default null, p_position text default null, p_employee_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  old public.approval_requests;
  v_check record;
  v_route record;
  v_new public.approval_requests;
  v_ops boolean := coalesce(p_operations_head, false);
begin
  select * into old from public.approval_requests where id = p_request for update;
  if old.id is null or old.source = 'REGISTRATION' or not private.can_see_employee_request(p_request) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  if old.status <> 'REJECTED' then
    raise exception 'CONFLICT: Only a rejected request can be sent again.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.approval_requests n where n.subject_user_id = old.subject_user_id and n.source <> 'REGISTRATION' and n.created_at > old.created_at) then
    raise exception 'CONFLICT: This request was already sent again.' using errcode = 'P0001';
  end if;
  if not (private.actor_is_hr(auth.uid()) or old.submitted_by = auth.uid()) then
    raise exception 'FORBIDDEN: Only HR or the person who submitted it can send it again.' using errcode = '42501';
  end if;
  select * into v_check from private.check_employee_submission(auth.uid(), p_role, v_ops, p_department, p_division);

  perform set_config('crm.employee_resubmit', 'on', true);
  update public.profiles
     set role = p_role, department_id = v_check.o_profile_department, team_id = null, status = 'PENDING', status_reason = null,
         position = coalesce(nullif(btrim(coalesce(p_position, '')), ''), position),
         head_division = case when p_role = 'DEPARTMENT_HEAD' and v_check.o_division in ('SALES', 'SUPPORT') then v_check.o_division end
   where id = old.subject_user_id;
  perform set_config('crm.employee_resubmit', 'off', true);

  select * into v_route from private.resolve_employee_approver(p_role, v_ops, p_department, v_check.o_division);
  insert into public.approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_operations_head, requested_division,
                                        submitted_by, approver_kind, approver_id, attempt, resubmission_of, employee_code)
  values ('USER_REGISTRATION', old.subject_user_id, v_check.o_profile_department, 'PENDING', v_check.o_source, p_role, v_ops, v_check.o_division,
          auth.uid(), v_route.kind, v_route.approver_id, old.attempt + 1, old.id, coalesce(left(nullif(trim(coalesce(p_employee_code, '')), ''), 40), old.employee_code))
  returning * into v_new;
  perform private.write_audit('EMPLOYEE_REQUEST_RESUBMITTED', 'profile', old.subject_user_id, v_check.o_profile_department, null,
    jsonb_build_object('request', v_new.id, 'previous', old.id, 'attempt', v_new.attempt, 'approver', v_route.kind));
  perform private.notify_employee_request_approver(v_new, true);
  return private.employee_request_json(v_new);
end $$;
revoke all on function public.employee_request_resubmit(uuid, public.app_role, boolean, uuid, text, text, text) from public, anon;
grant execute on function public.employee_request_resubmit(uuid, public.app_role, boolean, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The decision: approve + activate, or reject with a reason - one transaction
-- ---------------------------------------------------------------------------
create or replace function public.employee_request_decide(p_request uuid, p_approve boolean, p_note text default null, p_departments uuid[] default null, p_primary uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.approval_requests;
  subj public.profiles;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_team uuid;
  v_dept uuid;
  v_name text;
  v_n integer := 0;
  v_title text;
  v_to uuid;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if r.id is null or r.source = 'REGISTRATION' or not private.can_see_employee_request(p_request) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'VALIDATION_ERROR: Choose approve or reject.' using errcode = 'P0001';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;
  if r.subject_user_id = auth.uid() then
    raise exception 'FORBIDDEN: Nobody can approve or reject their own account.' using errcode = '42501';
  end if;
  if not private.can_decide_employee_request(p_request) then
    raise exception 'FORBIDDEN: You are not the approver of this request.' using errcode = '42501';
  end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting (at least 3 characters).' using errcode = 'P0001';
  end if;
  select * into subj from public.profiles where id = r.subject_user_id for update;
  if subj.id is null then
    raise exception 'NOT_FOUND: The employee no longer exists.' using errcode = 'P0001';
  end if;
  v_dept := private.base_department(r.department_id);
  perform set_config('crm.employee_decision', 'on', true);

  if p_approve then
    if r.requested_role = 'DEPARTMENT_HEAD' then
      if r.requested_operations_head then
        perform set_config('crm.operations_head_change', 'on', true);
        update public.profiles set status = 'ACTIVE', is_operations_head = true, approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
        perform set_config('crm.operations_head_change', 'off', true);
        if p_departments is not null and cardinality(p_departments) > 0 then
          perform private.operations_scope_apply(subj.id, p_departments, p_primary);
        end if;
      else
        update public.profiles set status = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
      end if;
    elsif r.requested_role = 'TEAM_HEAD' then
      -- a Team Lead leads a team of their own: made now, in their department and side
      v_name := left(subj.full_name || ' Team', 120);
      while exists (select 1 from public.teams t where t.department_id = v_dept and lower(t.name) = lower(v_name)) loop
        v_n := v_n + 1;
        v_name := left(subj.full_name, 112) || ' Team ' || (v_n + 1);
      end loop;
      insert into public.teams (department_id, name, division, created_by)
      values (v_dept, v_name, coalesce(r.requested_division, 'GENERAL')::public.team_division, auth.uid()) returning id into v_team;
      update public.profiles set status = 'ACTIVE', department_id = v_dept, team_id = v_team, approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
      insert into public.team_assignments (profile_id, to_team_id, department_id, kind, note, assigned_by) values (subj.id, v_team, v_dept, 'PLACEMENT', 'Team Lead approved', auth.uid());
    else
      -- a Team Member is approved into the department's pool and waits for the Department Head to place them under a Team Lead
      v_team := private.pool_team(v_dept, r.requested_division);
      update public.profiles set status = 'ACTIVE', department_id = v_dept, team_id = v_team, approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
      insert into public.team_assignments (profile_id, to_team_id, department_id, kind, note, assigned_by) values (subj.id, v_team, v_dept, 'PLACEMENT', 'Approved, awaiting a Team Lead', auth.uid());
    end if;
    update public.approval_requests set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, team_id = v_team where id = r.id returning * into r;
    perform private.write_audit('EMPLOYEE_REQUEST_APPROVED', 'profile', subj.id, v_dept, v_team,
      jsonb_build_object('request', r.id, 'role', case when r.requested_operations_head then 'OPERATIONS_HEAD' else r.requested_role::text end, 'attempt', r.attempt));
    v_title := format('Approved: %s', subj.full_name);
    perform private.notify(r.submitted_by, 'EMPLOYEE_REQUEST_APPROVED', v_title, 'The employee is active now.', 'approval_request', r.id);
    if r.requested_role = 'TEAM_MEMBER' then
      for v_to in select h.id from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = v_dept
                     and (h.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or h.head_division = r.requested_division) loop
        perform private.notify(v_to, 'TEAM_MEMBER_AWAITING_ASSIGNMENT', format('%s is waiting for a Team Lead', subj.full_name), 'Assign this approved Team Member under a Team Lead.', 'profile', subj.id);
      end loop;
    end if;
  else
    update public.profiles set status = 'REJECTED', status_reason = v_note where id = subj.id;
    update public.approval_requests set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = r.id returning * into r;
    perform private.write_audit('EMPLOYEE_REQUEST_REJECTED', 'profile', subj.id, v_dept, null, jsonb_build_object('request', r.id, 'attempt', r.attempt));
    perform private.notify(r.submitted_by, 'EMPLOYEE_REQUEST_REJECTED', format('Rejected: %s', subj.full_name), format('Reason: %s', v_note), 'approval_request', r.id, '{}'::jsonb, 'urgent');
  end if;
  return private.employee_request_json(r);
end $$;
revoke all on function public.employee_request_decide(uuid, boolean, text, uuid[], uuid[]) from public, anon;
grant execute on function public.employee_request_decide(uuid, boolean, text, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Lists
-- ---------------------------------------------------------------------------
create or replace function public.employee_requests_list(p_status text default null, p_to_decide boolean default false, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.employee_request_json(r) order by r.created_at desc)
      from (select * from public.approval_requests x
             where x.source <> 'REGISTRATION' and (p_status is null or x.status::text = upper(p_status))
               and private.can_see_employee_request(x.id)
               and (not coalesce(p_to_decide, false) or (x.status = 'PENDING' and private.can_decide_employee_request(x.id)))
             order by x.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) r), '[]'::jsonb);
end $$;
revoke all on function public.employee_requests_list(text, boolean, integer) from public, anon;
grant execute on function public.employee_requests_list(text, boolean, integer) to authenticated;

create or replace function public.employee_request_get(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_request;
  if r.id is null or not private.can_see_employee_request(p_request) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  return private.employee_request_json(r) || jsonb_build_object('history', (
    select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'attempt', h.attempt, 'status', h.status, 'decidedAt', h.decided_at, 'decisionNote', h.decision_note,
             'decidedBy', (select d.full_name from public.profiles d where d.id = h.decided_by), 'submittedAt', h.created_at) order by h.attempt), '[]'::jsonb)
      from public.approval_requests h where h.subject_user_id = r.subject_user_id and h.source <> 'REGISTRATION'));
end $$;
revoke all on function public.employee_request_get(uuid) from public, anon;
grant execute on function public.employee_request_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The provisioning trigger: the request branch (the rest is unchanged from 20261205000200, which added the Meta Verifier flag)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.provision_auth_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user auth.users;
  v_meta jsonb;
  v_app jsonb;
  v_email text;
  v_name text;
  v_actor uuid;
  v_role public.app_role;
  v_department uuid;
  v_team uuid;
  v_head_division text;
  v_profile public.profiles;
  v_request public.approval_requests;
begin
  select * into v_user from auth.users where id = p_user_id;
  if v_user.id is null or exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_app := coalesce(v_user.raw_app_meta_data, '{}'::jsonb);
  v_email := lower(v_user.email);
  v_name := left(coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(lower(v_user.email), '@', 1)), 160);

  if v_email is null then
    raise exception 'VALIDATION_ERROR: An e-mail address is required.' using errcode = 'P0001';
  end if;

  -- 1. Bootstrap the first Super Admin
  if coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    if exists (select 1 from public.profiles where role = 'SUPER_ADMIN') then
      raise exception 'FORBIDDEN: A Super Admin already exists.' using errcode = '42501';
    end if;
    insert into public.profiles (id, email, full_name, role, status, approved_at)
    values (v_user.id, v_email, v_name, 'SUPER_ADMIN', 'ACTIVE', now()) returning * into v_profile;
    perform private.write_audit('USER_CREATED', 'profile', v_profile.id, null, null,
      jsonb_build_object('role', 'SUPER_ADMIN', 'bootstrap', true));
    return;
  end if;

  -- 1b. An employee submitted by HR (or a Team Lead): a PENDING profile and an approval request - never an active account
  if v_app ? 'request_by' then
    perform private.provision_employee_request(v_user, v_app, v_email, v_name, v_meta);
    return;
  end if;

  -- 2. Provisioned by a manager through the API
  if v_app ? 'provisioned_by' then
    v_actor := private.try_uuid(v_app ->> 'provisioned_by');
    begin
      v_role := (v_app ->> 'provisioned_role')::public.app_role;
    exception when others then
      raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
    end;
    v_team := private.try_uuid(v_app ->> 'provisioned_team_id');
    v_head_division := case when v_role = 'DEPARTMENT_HEAD' then nullif(v_app ->> 'provisioned_head_division', '') end;
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division, approved_by, approved_at)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_head_division, v_actor, now())
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
    if v_team is not null then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TEAM_MEMBER_ADDED', 'team', v_team, v_department, v_team, jsonb_build_object('user_id', v_profile.id));
    end if;

    if coalesce((v_app ->> 'provisioned_technical_consultant')::boolean, false) then
      update public.profiles set is_technical_consultant = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_technical_consultant then
        raise exception 'VALIDATION_ERROR: A Technical Consultant must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TECHNICAL_CONSULTANT_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    if coalesce((v_app ->> 'provisioned_meta_verifier')::boolean, false) then
      update public.profiles set is_meta_verifier = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_meta_verifier then
        raise exception 'VALIDATION_ERROR: A Meta Verifier must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'META_VERIFIER_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    return;
  end if;

  -- 3. Self-registration → PENDING team member awaiting approval
  select d.id into v_department from public.departments d
  where d.id = private.try_uuid(v_meta ->> 'department_id') and not d.is_locked;
  select t.id into v_team from public.teams t
  where t.id = private.try_uuid(v_meta ->> 'team_id') and t.department_id = v_department;

  insert into public.profiles (id, email, full_name, role, status, department_id, team_id)
  values (v_user.id, v_email, v_name, 'TEAM_MEMBER', 'PENDING', v_department, v_team)
  returning * into v_profile;

  insert into public.approval_requests (request_type, subject_user_id, department_id, team_id)
  values ('USER_REGISTRATION', v_profile.id, v_department, v_team)
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values (v_profile.id, 'USER_REGISTERED', 'profile', v_profile.id, v_department, v_team,
          jsonb_build_object('approval_request_id', v_request.id));

  perform private.route_registration_request(v_request, v_profile);
end $function$;
revoke all on function private.provision_auth_user(uuid) from public, anon, authenticated;


-- The employee request is validated in the same statement that creates the sign-in (like provisioned_by), not left to the commit.
create or replace function private.tg_handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  if v_app ? 'provisioned_by' or v_app ? 'request_by' or coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    perform private.provision_auth_user(new.id);
  end if;
  return new;
end $$;
revoke all on function private.tg_handle_new_auth_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Operations Head: department scope and the accountable owner of each department (Super Admin only)
-- ---------------------------------------------------------------------------
-- Make `p_head` the accountable Operations Head of a department, or (null) leave it without one. Pending Department Head requests follow.
create or replace function private.set_department_owner(p_department uuid, p_head uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid;
  v_name text;
  v_moved integer := 0;
  v_to uuid;
begin
  select name into v_name from public.departments where id = p_department;
  if v_name is null then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  select operations_head_id into v_old from public.department_operations_owner where department_id = p_department;
  if p_head is not null then
    if not exists (select 1 from public.profiles p where p.id = p_head and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head) then
      raise exception 'VALIDATION_ERROR: Only an active Operations Head can own a department.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.scopes_of(p_head) s where s.department_id = private.base_department(p_department)) then
      raise exception 'VALIDATION_ERROR: Give %s to this Operations Head first; only a department they manage can be theirs to approve.', v_name using errcode = 'P0001';
    end if;
    insert into public.department_operations_owner (department_id, operations_head_id, assigned_by) values (p_department, p_head, auth.uid())
    on conflict (department_id) do update set operations_head_id = excluded.operations_head_id, assigned_by = excluded.assigned_by, assigned_at = now();
  else
    delete from public.department_operations_owner where department_id = p_department;
  end if;
  if v_old is not distinct from p_head then
    return;
  end if;
  -- Department Head requests still waiting move to the new owner; decided ones keep the approver they had
  update public.approval_requests
     set approver_id = p_head
   where status = 'PENDING' and source <> 'REGISTRATION' and approver_kind = 'OPERATIONS_HEAD' and private.base_department(department_id) = private.base_department(p_department);
  get diagnostics v_moved = row_count;
  perform private.write_audit('DEPARTMENT_OWNER_SET', 'department', p_department, p_department, null,
    jsonb_build_object('from', v_old, 'to', p_head, 'pending_requests_moved', v_moved));
  if p_head is not null then
    perform private.notify(p_head, 'DEPARTMENT_OWNER_ASSIGNED', format('You approve Department Heads of %s', v_name),
      case when v_moved > 0 then format('%s request(s) waiting for approval moved to you.', v_moved) else 'Department Head requests for it now come to you.' end, 'department', p_department);
  elsif v_moved > 0 then
    for v_to in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_to, 'DEPARTMENT_OWNER_MISSING', format('%s has no Operations Head to approve its Department Head', v_name),
        'A request is waiting. Assign an Operations Head to this department.', 'department', p_department, '{}'::jsonb, 'urgent');
    end loop;
  end if;
  if v_old is not null and v_old is distinct from p_head then
    perform private.notify(v_old, 'DEPARTMENT_OWNER_REMOVED', format('You no longer approve Department Heads of %s', v_name), 'The Super Admin changed who is accountable for this department.', 'department', p_department);
  end if;
end $$;
revoke all on function private.set_department_owner(uuid, uuid) from public, anon, authenticated;

-- The whole department scope of an Operations Head: the departments ticked, and which of them they approve for.
create or replace function private.operations_scope_apply(p_profile uuid, p_departments uuid[], p_primary uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d uuid;
  v_div text;
  v_problem text;
  v_first text;
  v_any boolean;
  v_pairs jsonb := '[]'::jsonb;
  v_before uuid[];
  v_after uuid[];
  v_home uuid;
  r record;
begin
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' or not t.is_operations_head then
    raise exception 'VALIDATION_ERROR: Only an active Operations Head has a department scope.' using errcode = 'P0001';
  end if;
  v_home := private.base_department(t.department_id);
  select coalesce(array_agg(distinct s.department_id), '{}') into v_before from private.scopes_of(p_profile) s;

  for d in select distinct x from unnest(coalesce(p_departments, '{}')) x loop
    v_any := false; v_first := null;
    foreach v_div in array array['SALES', 'SUPPORT'] loop
      v_problem := private.department_access_problem(d, v_div);
      if v_problem is null then
        v_pairs := v_pairs || jsonb_build_array(jsonb_build_object('departmentId', d, 'division', v_div));
        v_any := true;
      elsif v_first is null then
        v_first := v_problem;
      end if;
    end loop;
    if not v_any and private.base_department(d) is distinct from v_home then
      raise exception 'VALIDATION_ERROR: %', coalesce(v_first, 'This department cannot be assigned.') using errcode = 'P0001';
    end if;
  end loop;
  perform public.department_access_apply(p_profile, v_pairs);

  select coalesce(array_agg(distinct s.department_id), '{}') into v_after from private.scopes_of(p_profile) s;
  -- the departments the person no longer manages are no longer theirs to approve for
  for r in select o.department_id from public.department_operations_owner o where o.operations_head_id = p_profile loop
    if not (private.base_department(r.department_id) = any (v_after)) then
      perform private.set_department_owner(r.department_id, null);
    end if;
  end loop;
  if p_primary is not null then
    for d in select distinct x from unnest(p_primary) x loop
      perform private.set_department_owner(d, p_profile);
    end loop;
  end if;

  if v_before is distinct from v_after then
    perform private.write_audit('OPERATIONS_SCOPE_SET', 'profile', p_profile, t.department_id, null,
      jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
    perform private.notify(p_profile, 'OPERATIONS_SCOPE_CHANGED', 'Your departments were changed', 'The Super Admin changed the departments you manage. Your dashboard now shows the new list.', 'profile', p_profile);
  end if;
end $$;
revoke all on function private.operations_scope_apply(uuid, uuid[], uuid[]) from public, anon, authenticated;

create or replace function private.operations_head_json(p public.profiles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
    'homeDepartment', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = p.department_id),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug,
                      'primary', exists (select 1 from public.department_operations_owner o where o.operations_head_id = p.id and private.base_department(o.department_id) = d.id)) order by d.name), '[]'::jsonb)
                      from public.departments d where d.id in (select s.department_id from private.scopes_of(p.id) s)),
    'pendingApprovals', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION' and r.approver_kind = 'OPERATIONS_HEAD' and r.approver_id = p.id),
    'lastLoginAt', (select max(a.created_at) from public.auth_login_attempts a where a.user_id = p.id))
$$;
revoke all on function private.operations_head_json(public.profiles) from public, anon, authenticated;

create or replace function private.require_super_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can do this.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_super_admin() from public, anon, authenticated;

create or replace function public.operations_heads_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return jsonb_build_object(
    'heads', (select coalesce(jsonb_agg(private.operations_head_json(p) order by p.full_name), '[]'::jsonb)
                from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.is_operations_head and p.status in ('ACTIVE', 'SUSPENDED')),
    -- departments nobody is accountable for: a Department Head request there cannot be routed
    'unowned', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name,
                  'pendingRequests', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION' and r.approver_kind = 'OPERATIONS_HEAD'
                                        and private.base_department(r.department_id) = d.id)) order by d.name), '[]'::jsonb)
                  from public.departments d
                 where d.facet_of is null and not d.is_locked and d.slug <> 'hr'
                   and not exists (select 1 from public.department_operations_owner o join public.profiles h on h.id = o.operations_head_id
                                    where private.base_department(o.department_id) = d.id and h.status = 'ACTIVE' and h.is_operations_head)),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug,
                  'owner', (select jsonb_build_object('id', h.id, 'name', h.full_name) from public.department_operations_owner o join public.profiles h on h.id = o.operations_head_id
                              where private.base_department(o.department_id) = private.base_department(d.id) limit 1)) order by d.name), '[]'::jsonb)
                  from public.departments d where not d.is_locked));
end $$;
revoke all on function public.operations_heads_list() from public, anon;
grant execute on function public.operations_heads_list() to authenticated;

create or replace function public.operations_head_scope_set(p_profile uuid, p_departments uuid[], p_primary uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  perform private.require_super_admin();
  select * into t from public.profiles where id = p_profile;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  if p_departments is not null and cardinality(p_departments) > 40 then
    raise exception 'VALIDATION_ERROR: Too many departments.' using errcode = 'P0001';
  end if;
  perform private.operations_scope_apply(p_profile, p_departments, p_primary);
  select * into t from public.profiles where id = p_profile;
  return private.operations_head_json(t);
end $$;
revoke all on function public.operations_head_scope_set(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.operations_head_scope_set(uuid, uuid[], uuid[]) to authenticated;

-- Management activity and approval history of one Operations Head (Super Admin)
create or replace function public.operations_head_activity(p_profile uuid, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'reference', a.entity_type || ':' || left(coalesce(a.entity_id::text, ''), 8),
             'department', (select d.name from public.departments d where d.id = a.department_id),
             'by', (select p.full_name from public.profiles p where p.id = a.actor_id)) order by a.created_at desc)
      from (select * from public.audit_logs x
             where (x.actor_id = p_profile and x.action in ('EMPLOYEE_REQUEST_APPROVED', 'EMPLOYEE_REQUEST_REJECTED', 'TEAM_MEMBER_ASSIGNED'))
                or (x.entity_id = p_profile and x.action in ('OPERATIONS_HEAD_SET', 'OPERATIONS_HEAD_REMOVED', 'OPERATIONS_SCOPE_SET', 'DEPARTMENT_ACCESS_GRANTED', 'DEPARTMENT_ACCESS_REVOKED', 'EMPLOYEE_REQUEST_APPROVED'))
                or (x.action = 'DEPARTMENT_OWNER_SET' and (x.metadata ->> 'to' = p_profile::text or x.metadata ->> 'from' = p_profile::text))
             order by x.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) a), '[]'::jsonb);
end $$;
revoke all on function public.operations_head_activity(uuid, integer) from public, anon;
grant execute on function public.operations_head_activity(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Operations Head dashboard (only the departments the Super Admin assigned)
-- ---------------------------------------------------------------------------
create or replace function private.require_operations_head()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select p.id into v_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head;
  if v_id is null then
    raise exception 'FORBIDDEN: This page is for Operations Heads.' using errcode = '42501';
  end if;
  return v_id;
end $$;
revoke all on function private.require_operations_head() from public, anon, authenticated;

create or replace function public.operations_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json_obj order by (row_to_json_obj ->> 'name')), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug,
      'accountable', private.owner_of_department(d.id) = v_me,
      'departmentHeads', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'email', h.email, 'status', h.status, 'side', h.head_division,
                                'lastLoginAt', (select max(a.created_at) from public.auth_login_attempts a where a.user_id = h.id)) order by h.full_name), '[]'::jsonb)
                            from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status in ('ACTIVE', 'SUSPENDED') and private.base_department(h.department_id) = d.id),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'awaitingAssignment', (select count(*) from public.profiles p join public.teams t on t.id = p.team_id
                              where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and t.is_pool and private.base_department(p.department_id) = d.id),
      'pendingDepartmentHeadApprovals', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION'
                                           and r.approver_kind = 'OPERATIONS_HEAD' and private.base_department(r.department_id) = d.id and private.owner_of_department(d.id) = v_me),
      'leads', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'LEAD'),
      'onboarding', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'ONBOARDING'),
      'customers', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'CUSTOMER'),
      'awaitingDepartmentHead', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                                   where private.base_department(c.department_id) = d.id and o.handover_stage = 'DEPARTMENT_HEAD'),
      'withVerifier', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                         where private.base_department(c.department_id) = d.id and o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT')
    ) as row_to_json_obj
      from public.departments d
     where d.id in (select s.department_id from private.scopes_of(v_me) s)
  ) q;
  return jsonb_build_object(
    'departments', v_rows,
    'totals', jsonb_build_object(
      'departments', jsonb_array_length(v_rows),
      'departmentHeads', (select coalesce(sum(jsonb_array_length(x -> 'departmentHeads')), 0) from jsonb_array_elements(v_rows) x),
      'teamLeads', (select coalesce(sum((x ->> 'teamLeads')::int), 0) from jsonb_array_elements(v_rows) x),
      'teamMembers', (select coalesce(sum((x ->> 'teamMembers')::int), 0) from jsonb_array_elements(v_rows) x),
      'awaitingAssignment', (select coalesce(sum((x ->> 'awaitingAssignment')::int), 0) from jsonb_array_elements(v_rows) x),
      'pendingDepartmentHeadApprovals', (select coalesce(sum((x ->> 'pendingDepartmentHeadApprovals')::int), 0) from jsonb_array_elements(v_rows) x)));
end $$;
revoke all on function public.operations_dashboard() from public, anon;
grant execute on function public.operations_dashboard() to authenticated;

-- What the Department Heads of one assigned department did: real audit and sign-in records, nothing reconstructed from a current status.
create or replace function public.operations_department_activity(p_department uuid, p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_dept uuid := private.base_department(p_department);
begin
  if not exists (select 1 from private.scopes_of(v_me) s where s.department_id = v_dept) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.at, 'departmentHead', x.head_name, 'department', x.dept_name, 'type', x.type, 'reference', x.reference, 'outcome', x.outcome) order by x.at desc)
      from (
        select a.created_at as at, h.full_name as head_name, (select d.name from public.departments d where d.id = v_dept) as dept_name,
               a.action as type, coalesce(a.entity_type, '') || case when a.entity_id is null then '' else ':' || left(a.entity_id::text, 8) end as reference,
               case when a.action like '%REJECTED%' then 'Rejected' when a.action like '%APPROVED%' or a.action like '%ASSIGNED%' then 'Done' when a.action like '%FAILED%' then 'Failed' else 'Recorded' end as outcome
          from public.audit_logs a
          join public.profiles h on h.id = a.actor_id
         where h.role = 'DEPARTMENT_HEAD' and private.base_department(h.department_id) = v_dept and not h.is_operations_head
           and a.action !~* '(password|token|session|secret)'
        union all
        select l.created_at, h.full_name, (select d.name from public.departments d where d.id = v_dept), 'LOGIN', 'profile:' || left(h.id::text, 8), 'Signed in'
          from public.auth_login_attempts l
          join public.profiles h on h.id = l.user_id
         where h.role = 'DEPARTMENT_HEAD' and private.base_department(h.department_id) = v_dept and not h.is_operations_head
         order by 1 desc limit least(greatest(coalesce(p_limit, 60), 1), 200)
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.operations_department_activity(uuid, integer) from public, anon;
grant execute on function public.operations_department_activity(uuid, integer) to authenticated;

-- The people of one assigned department: heads, Team Leads with their teams, and who waits for a Team Lead (read only)
create or replace function public.operations_department_detail(p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_dept uuid := private.base_department(p_department);
begin
  if not exists (select 1 from private.scopes_of(v_me) s where s.department_id = v_dept) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'teamLeads', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name, 'team', t.name, 'division', t.division,
                    'members', (select count(*) from public.profiles m where m.team_id = l.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE')) order by l.full_name), '[]'::jsonb)
                    from public.profiles l left join public.teams t on t.id = l.team_id
                   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = v_dept),
    'awaitingAssignment', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'approvedAt', p.approved_at) order by p.full_name), '[]'::jsonb)
                    from public.profiles p join public.teams t on t.id = p.team_id
                   where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and t.is_pool and private.base_department(p.department_id) = v_dept));
end $$;
revoke all on function public.operations_department_detail(uuid) from public, anon;
grant execute on function public.operations_department_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Department Head: the approved employees of the department, and assigning a Team Member under a Team Lead
-- ---------------------------------------------------------------------------
create or replace function private.assigner_department(p_department uuid default null)
returns table (department_id uuid, head_division text, is_admin boolean) language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if me.role = 'SUPER_ADMIN' then
    if p_department is null then
      raise exception 'VALIDATION_ERROR: Choose the department.' using errcode = 'P0001';
    end if;
    return query select private.base_department(p_department), null::text, true;
  elsif me.role = 'DEPARTMENT_HEAD' then
    if p_department is not null and private.base_department(p_department) is distinct from private.base_department(me.department_id) then
      raise exception 'FORBIDDEN: You can only manage your own department.' using errcode = '42501';
    end if;
    return query select private.base_department(me.department_id), me.head_division, false;
  else
    raise exception 'FORBIDDEN: Only a Department Head can do this.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.assigner_department(uuid) from public, anon, authenticated;

create or replace function public.department_employee_directory(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from private.assigner_department(p_department);
  return jsonb_build_object(
    'department', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = v.department_id),
    'headDivision', v.head_division,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status, 'approvedAt', p.approved_at,
                  'team', jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division, 'isPool', t.is_pool),
                  'lead', (select jsonb_build_object('id', l.id, 'name', l.full_name) from public.profiles l where l.team_id = p.team_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' limit 1),
                  'state', case when p.status <> 'ACTIVE' then 'INACTIVE' when t.is_pool then 'AWAITING_ASSIGNMENT' else 'ASSIGNED' end,
                  'lastAssignment', (select jsonb_build_object('kind', a.kind, 'at', a.created_at, 'by', (select b.full_name from public.profiles b where b.id = a.assigned_by))
                                       from public.team_assignments a where a.profile_id = p.id order by a.created_at desc limit 1)) order by p.full_name), '[]'::jsonb)
                  from public.profiles p join public.teams t on t.id = p.team_id
                 where p.role = 'TEAM_MEMBER' and p.status in ('ACTIVE', 'SUSPENDED', 'REVOKED') and private.base_department(p.department_id) = v.department_id
                   and (v.head_division is null or t.division::text in (v.head_division, 'GENERAL'))),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'name', l.full_name, 'status', l.status, 'team', jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division),
                  'members', (select count(*) from public.profiles m where m.team_id = l.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE')) order by l.full_name), '[]'::jsonb)
                from public.profiles l join public.teams t on t.id = l.team_id
               where l.role = 'TEAM_HEAD' and l.status in ('ACTIVE', 'SUSPENDED') and not t.is_pool and private.base_department(l.department_id) = v.department_id
                 and (v.head_division is null or t.division::text in (v.head_division, 'GENERAL'))));
end $$;
revoke all on function public.department_employee_directory(uuid) from public, anon;
grant execute on function public.department_employee_directory(uuid) to authenticated;

-- Put an approved Team Member under an active Team Lead of the same department. This is an assignment: it never creates an employee request.
create or replace function public.assign_member_to_team_lead(p_member uuid, p_lead uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  m public.profiles;
  l public.profiles;
  mt public.teams;
  lt public.teams;
  v_kind text;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  select * into v from private.assigner_department(
    (select p.department_id from public.profiles p where p.id = p_member));
  select * into m from public.profiles where id = p_member for update;
  select * into l from public.profiles where id = p_lead for update;
  if m.id is null or m.role <> 'TEAM_MEMBER' or private.base_department(m.department_id) is distinct from v.department_id then
    raise exception 'NOT_FOUND: Team Member not found in this department.' using errcode = 'P0001';
  end if;
  if m.status <> 'ACTIVE' then
    raise exception 'CONFLICT: Only an approved, active Team Member can be assigned.' using errcode = 'P0001';
  end if;
  if l.id is null or l.role <> 'TEAM_HEAD' or private.base_department(l.department_id) is distinct from v.department_id then
    raise exception 'VALIDATION_ERROR: Choose a Team Lead of this department.' using errcode = 'P0001';
  end if;
  if l.status <> 'ACTIVE' then
    raise exception 'CONFLICT: That Team Lead is not active.' using errcode = 'P0001';
  end if;
  select * into mt from public.teams where id = m.team_id;
  select * into lt from public.teams where id = l.team_id;
  if lt.id is null or lt.is_pool then
    raise exception 'VALIDATION_ERROR: That Team Lead has no team yet.' using errcode = 'P0001';
  end if;
  if m.team_id = lt.id then
    raise exception 'CONFLICT: This Team Member is already under that Team Lead.' using errcode = 'P0001';
  end if;
  if v.head_division is not null and lt.division::text not in (v.head_division, 'GENERAL') then
    raise exception 'FORBIDDEN: That team belongs to the other side of the department.' using errcode = '42501';
  end if;
  if mt.division <> 'GENERAL' and lt.division <> 'GENERAL' and mt.division <> lt.division then
    raise exception 'VALIDATION_ERROR: A % member cannot join a % team.', lower(mt.division::text), lower(lt.division::text) using errcode = 'P0001';
  end if;
  v_kind := case when mt.is_pool then 'ASSIGNMENT' else 'REASSIGNMENT' end;
  update public.profiles set team_id = lt.id where id = m.id;
  insert into public.team_assignments (profile_id, from_team_id, to_team_id, lead_id, department_id, kind, note, assigned_by)
  values (m.id, mt.id, lt.id, l.id, v.department_id, v_kind, v_note, auth.uid());
  perform private.write_audit('TEAM_MEMBER_ASSIGNED', 'profile', m.id, v.department_id, lt.id,
    jsonb_build_object('lead', l.id, 'from_team', mt.id, 'to_team', lt.id, 'kind', v_kind));
  perform private.notify(l.id, 'TEAM_MEMBER_ASSIGNED', format('%s joined your team', m.full_name), 'The Department Head assigned this Team Member to you.', 'profile', m.id);
  perform private.notify(m.id, 'TEAM_ASSIGNED', format('You are now in %s', lt.name), format('Your Team Lead is %s.', l.full_name), 'team', lt.id);
  return jsonb_build_object('memberId', m.id, 'leadId', l.id, 'teamId', lt.id, 'kind', v_kind);
end $$;
revoke all on function public.assign_member_to_team_lead(uuid, uuid, text) from public, anon;
grant execute on function public.assign_member_to_team_lead(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Who can read the new tables (writes only through the functions above)
-- ---------------------------------------------------------------------------
drop policy if exists department_operations_owner_select on public.department_operations_owner;
create policy department_operations_owner_select on public.department_operations_owner for select to authenticated using (
  private.is_super_admin() or operations_head_id = (select auth.uid()) or private.actor_is_hr((select auth.uid()))
  or exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.status = 'ACTIVE' and me.role = 'DEPARTMENT_HEAD'
              and private.base_department(me.department_id) = private.base_department(department_operations_owner.department_id)));

drop policy if exists team_assignments_select on public.team_assignments;
create policy team_assignments_select on public.team_assignments for select to authenticated using (
  profile_id = (select auth.uid()) or lead_id = (select auth.uid()) or private.can_manage_profile(profile_id) or private.is_super_admin());

revoke all on public.department_operations_owner, public.team_assignments from public, anon, authenticated;
grant select on public.department_operations_owner, public.team_assignments to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.department_operations_owner; exception when others then null; end;
  begin alter publication supabase_realtime add table public.team_assignments; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Existing data: nobody is promoted and nobody loses access
-- ---------------------------------------------------------------------------
-- A department that exactly ONE active Operations Head already covers gets that person as its accountable owner (the current responsibility,
-- written down). A department two or more cover, or none, is left for the Super Admin to decide: see supabase/review_employee_hierarchy.sql.
do $$
declare
  d record;
  v_heads uuid[];
begin
  for d in select x.id from public.departments x where x.facet_of is null and not x.is_locked loop
    if exists (select 1 from public.department_operations_owner o where o.department_id = d.id) then
      continue;
    end if;
    select coalesce(array_agg(distinct p.id), '{}') into v_heads from public.profiles p
     where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
       and exists (select 1 from private.scopes_of(p.id) s where s.department_id = d.id);
    if cardinality(v_heads) = 1 then
      insert into public.department_operations_owner (department_id, operations_head_id) values (d.id, v_heads[1]) on conflict do nothing;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, metadata)
      values (null, 'DEPARTMENT_OWNER_BACKFILLED', 'department', d.id, d.id, jsonb_build_object('operations_head', v_heads[1]));
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 15. A friendly refusal BEFORE the sign-in is created (the API calls this first; the trigger repeats every rule)
-- ---------------------------------------------------------------------------
create or replace function public.assert_can_submit_employee(p_email text, p_role public.app_role, p_operations_head boolean, p_department uuid, p_division text default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_check record;
  v_existing public.profiles;
  v_head public.profiles;
begin
  select * into v_check from private.check_employee_submission(auth.uid(), p_role, coalesce(p_operations_head, false), p_department, p_division);
  select * into v_existing from public.profiles where email = lower(btrim(p_email));
  if v_existing.id is not null then
    raise exception 'CONFLICT: % already has an account (%). %', v_existing.email, lower(v_existing.status::text),
      case when v_existing.status = 'REJECTED' then 'Send the rejected request again instead of creating a new one.' else 'Nobody is added twice.' end using errcode = 'P0001';
  end if;
  if p_role = 'DEPARTMENT_HEAD' then
    v_head := private.department_head_of(v_check.o_profile_department, null, case when v_check.o_division in ('SALES', 'SUPPORT') then v_check.o_division end);
    if v_head.id is not null then
      raise exception 'CONFLICT: This department already has a Department Head% (%).', case v_check.o_division when 'SALES' then ' for Sales' when 'SUPPORT' then ' for Support' else '' end, v_head.full_name using errcode = 'P0001';
    end if;
  end if;
end $$;
revoke all on function public.assert_can_submit_employee(text, public.app_role, boolean, uuid, text) from public, anon;
grant execute on function public.assert_can_submit_employee(text, public.app_role, boolean, uuid, text) to authenticated;
