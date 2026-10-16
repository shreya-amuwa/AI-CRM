-- =============================================================================
-- HR dashboard: attendance timing, employee details, two-step leave approval, monthly leave totals,
-- de-duplicated notifications.
--
-- Until now attendance and leave data lived only in each browser (localStorage) and the "biometric" time was a
-- fixed placeholder. This adds the real records:
--
--  * attendance_records      one row per employee and office day: RM (CRM) login time and biometric punch time.
--                            RM login is recorded when the employee signs in; biometric punches arrive from the
--                            device through the API (service role only). HR reads them through hr_attendance(),
--                            which also computes the time difference in whole minutes (> 15 = discrepancy).
--  * employee_personal_details  designation, joining date, date of birth, blood group, emergency
--                            contact (readable only by the employee, HR and the Super Admin).
--  * leave_requests          Team Member -> Department Head -> HR. Every decision is enforced here, not in the UI:
--                            who may decide, in which order, never your own request, never twice.
--  * leave_monthly_summary() half days / leave days per employee for a chosen month (approved leave only).
--  * notifications           an optional dedupeKey stops the same event from notifying a person twice.
--
-- The tables are not readable or writable directly (RLS on, no grants): everything goes through the functions below.
-- Additive and idempotent. Nothing is deleted or changed in existing data.
-- =============================================================================

-- 1. Notifications: the same event never notifies the same person twice -------------------------------
create unique index if not exists notifications_dedupe_key
  on public.notifications (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey';

create or replace function private.notify_once(
  p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid,
  p_dedupe text, p_data jsonb default '{}'::jsonb, p_priority text default 'normal')
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
  select p_recipient, p_type, p_title, coalesce(p_body, ''), p_entity_type, p_entity_id,
         (select id from public.profiles where id = auth.uid()),
         coalesce(p_data, '{}'::jsonb) || jsonb_build_object('dedupeKey', p_dedupe), p_priority
   where p_recipient is not null and p_recipient is distinct from auth.uid()
  on conflict (recipient_id, (data ->> 'dedupeKey')) where data ? 'dedupeKey' do nothing
$$;
revoke all on function private.notify_once(uuid, text, text, text, text, uuid, text, jsonb, text) from public, anon, authenticated;

-- Active members of the HR department (they receive HR work).
create or replace function private.hr_department_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.departments d on d.id = p.department_id
   where d.slug = 'hr' and p.status = 'ACTIVE'
$$;
revoke all on function private.hr_department_member_ids() from public, anon, authenticated;

-- 2. Employee personal details ---------------------------------------------------------------------------
create table if not exists public.employee_personal_details (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  designation text check (designation in ('Department Head', 'Team Lead', 'Team Member')),
  joining_date date,
  date_of_birth date check (date_of_birth >= date '1900-01-01'),
  blood_group text check (blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  emergency_contact text check (emergency_contact ~ '^\+?[0-9 ()-]{7,20}$'),
  updated_at timestamptz not null default now()
);
alter table public.employee_personal_details enable row level security;
revoke all on public.employee_personal_details from anon, authenticated;

-- Every employee's details, for HR (and the Super Admin) only.
create or replace function public.hr_personal_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can view employee personal details.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact))
    from public.employee_personal_details d), '[]'::jsonb);
end $$;

-- One's own details.
create or replace function public.my_personal_details()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
      'profileId', d.profile_id, 'designation', d.designation, 'joiningDate', d.joining_date,
      'dateOfBirth', d.date_of_birth, 'bloodGroup', d.blood_group, 'emergencyContact', d.emergency_contact)
    from public.employee_personal_details d where d.profile_id = auth.uid()), 'null'::jsonb)
$$;

-- A new member created by HR: tell HR (once). Called by the API right after the account exists.
create or replace function public.notify_member_created(p_profile uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  p public.profiles;
  r uuid;
begin
  if not (private.is_hr_staff() or exists (select 1 from public.profiles m where m.id = auth.uid() and m.role in ('DEPARTMENT_HEAD', 'TEAM_HEAD'))) then
    raise exception 'FORBIDDEN: Not allowed.' using errcode = '42501';
  end if;
  select * into p from public.profiles where id = p_profile;
  if p.id is null then return; end if;
  for r in select m from private.hr_department_member_ids() m where m <> p.id loop
    perform private.notify_once(r, 'TEAM_MEMBER_CREATED', 'New team member', p.full_name || ' was added to the team.',
      'profile', p.id, 'MEMBER_CREATED:' || p.id || ':' || r, jsonb_build_object('employeeId', p.id));
  end loop;
end $$;

-- 3. Attendance ----------------------------------------------------------------------------------------------
create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  attendance_date date not null,
  rm_login_at timestamptz,
  biometric_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, attendance_date)
);
create index if not exists attendance_records_date_idx on public.attendance_records (attendance_date);
alter table public.attendance_records enable row level security;
revoke all on public.attendance_records from anon, authenticated;

-- Difference in whole minutes between the two logins (null while either is missing). Both are truncated to the
-- minute first, so the number shown and the 15-minute rule always agree.
create or replace function private.login_gap_minutes(p_rm timestamptz, p_bio timestamptz)
returns integer language sql immutable set search_path = '' as $$
  select case when p_rm is null or p_bio is null then null
              else abs((extract(epoch from (date_trunc('minute', p_bio) - date_trunc('minute', p_rm))) / 60)::integer) end
$$;

-- More than 15 minutes apart: HR hears about it once per employee and day.
create or replace function private.check_attendance_gap(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.attendance_records;
  v_gap integer;
  v_name text;
  r uuid;
begin
  select * into a from public.attendance_records where id = p_id;
  v_gap := private.login_gap_minutes(a.rm_login_at, a.biometric_login_at);
  if v_gap is null or v_gap <= 15 then return; end if;
  select full_name into v_name from public.profiles where id = a.profile_id;
  for r in select * from private.hr_department_member_ids() loop
    perform private.notify_once(r, 'ATTENDANCE_GAP', 'Login timing discrepancy',
      format('%s: RM and biometric logins are %s min apart on %s.', v_name, v_gap, to_char(a.attendance_date, 'DD Mon YYYY')),
      'attendance', a.id, 'ATT_GAP:' || a.id || ':' || r,
      jsonb_build_object('employeeId', a.profile_id, 'minutes', v_gap, 'date', a.attendance_date), 'urgent');
  end loop;
end $$;
revoke all on function private.check_attendance_gap(uuid) from public, anon, authenticated;

-- The employee signed in to the CRM: their first login of the office day is the RM login time.
create or replace function public.record_rm_login()
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid() and status = 'ACTIVE') then
    return;
  end if;
  insert into public.attendance_records as a (profile_id, attendance_date, rm_login_at)
  values (auth.uid(), private.office_today(), now())
  on conflict (profile_id, attendance_date) do update
    set rm_login_at = coalesce(a.rm_login_at, excluded.rm_login_at), updated_at = now()
  returning id into v_id;
  perform private.check_attendance_gap(v_id);
end $$;
revoke all on function public.record_rm_login() from public, anon;
grant execute on function public.record_rm_login() to authenticated;

-- A biometric device punch (called by the API with the service role): the first punch of the office day counts.
create or replace function public.record_biometric_punch(p_email text, p_punched_at timestamptz)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_profile uuid;
  v_id uuid;
begin
  select id into v_profile from public.profiles where email = lower(btrim(p_email)) and status = 'ACTIVE';
  if v_profile is null then
    return 'UNKNOWN_EMPLOYEE';
  end if;
  insert into public.attendance_records as a (profile_id, attendance_date, biometric_login_at)
  values (v_profile, (p_punched_at at time zone 'Asia/Kolkata')::date, p_punched_at)
  on conflict (profile_id, attendance_date) do update
    set biometric_login_at = least(coalesce(a.biometric_login_at, excluded.biometric_login_at), excluded.biometric_login_at), updated_at = now()
  returning id into v_id;
  perform private.check_attendance_gap(v_id);
  return 'RECORDED';
end $$;
revoke all on function public.record_biometric_punch(text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_biometric_punch(text, timestamptz) to service_role;

-- HR corrects or adds a punch by hand (the HR "manual punch" form).
create or replace function public.hr_record_punch(p_profile uuid, p_kind text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can record attendance.' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('RM', 'BIOMETRIC') or p_at is null or p_at > now() + interval '5 minutes' then
    raise exception 'VALIDATION_ERROR: Choose the punch type and a time that is not in the future.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = p_profile and status = 'ACTIVE') then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  insert into public.attendance_records as a (profile_id, attendance_date, rm_login_at, biometric_login_at)
  values (p_profile, (p_at at time zone 'Asia/Kolkata')::date,
          case when p_kind = 'RM' then p_at end, case when p_kind = 'BIOMETRIC' then p_at end)
  on conflict (profile_id, attendance_date) do update
    set rm_login_at = case when p_kind = 'RM' then excluded.rm_login_at else a.rm_login_at end,
        biometric_login_at = case when p_kind = 'BIOMETRIC' then excluded.biometric_login_at else a.biometric_login_at end,
        updated_at = now()
  returning id into v_id;
  perform private.write_audit('ATTENDANCE_PUNCH_RECORDED', 'attendance', v_id, null, null,
    jsonb_build_object('employee', p_profile, 'kind', p_kind));
  perform private.check_attendance_gap(v_id);
end $$;
revoke all on function public.hr_record_punch(uuid, text, timestamptz) from public, anon;
grant execute on function public.hr_record_punch(uuid, text, timestamptz) to authenticated;

-- Attendance of one office day, for HR (and the Super Admin).
create or replace function public.hr_attendance(p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_date date := coalesce(p_date, private.office_today());
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR staff can view attendance.' using errcode = '42501';
  end if;
  return jsonb_build_object('date', v_date, 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', a.id, 'profileId', p.id, 'name', p.full_name, 'email', p.email, 'role', p.role,
        'designation', coalesce(nullif(p.position, ''), pd.designation), 'departmentName', d.name,
        'rmLoginAt', a.rm_login_at, 'biometricLoginAt', a.biometric_login_at,
        'diffMinutes', private.login_gap_minutes(a.rm_login_at, a.biometric_login_at),
        'discrepancy', coalesce(private.login_gap_minutes(a.rm_login_at, a.biometric_login_at) > 15, false))
      order by p.full_name)
    from public.attendance_records a
    join public.profiles p on p.id = a.profile_id
    left join public.departments d on d.id = p.department_id
    left join public.employee_personal_details pd on pd.profile_id = p.id
   where a.attendance_date = v_date), '[]'::jsonb));
end $$;
revoke all on function public.hr_attendance(date) from public, anon;
grant execute on function public.hr_attendance(date) to authenticated;

-- 4. Leave requests ------------------------------------------------------------------------------------------
create table if not exists public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid references public.departments (id) on delete set null,
  leave_type text not null check (leave_type in ('FULL_DAY', 'HALF_DAY')),
  start_date date not null,
  end_date date not null,
  half_day_shift text check (half_day_shift in ('MORNING', 'AFTERNOON')),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  status text not null default 'PENDING_DEPARTMENT_HEAD' check (status in
    ('PENDING_DEPARTMENT_HEAD', 'PENDING_HR', 'APPROVED', 'REJECTED_BY_DEPARTMENT_HEAD', 'REJECTED_BY_HR')),
  dh_decided_by uuid references public.profiles (id) on delete set null,
  dh_decided_at timestamptz,
  dh_note text check (length(dh_note) <= 1000),
  hr_decided_by uuid references public.profiles (id) on delete set null,
  hr_decided_at timestamptz,
  hr_note text check (length(hr_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  check ((leave_type = 'HALF_DAY' and start_date = end_date and half_day_shift is not null)
      or (leave_type = 'FULL_DAY' and half_day_shift is null))
);
create index if not exists leave_requests_employee_idx on public.leave_requests (employee_id, start_date desc);
create index if not exists leave_requests_status_idx on public.leave_requests (status, department_id);
alter table public.leave_requests enable row level security;
revoke all on public.leave_requests from anon, authenticated;

-- Who reviews as Department Head: the active head(s) of the employee's department, never the employee. A
-- Department Head's own leave (or a department without an active head) is reviewed by the Super Admin.
create or replace function private.leave_stage1_ids(p_employee uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with e as (select id, department_id, role from public.profiles where id = p_employee),
  heads as (
    select h.id from public.profiles h, e
     where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and h.department_id = e.department_id
       and h.id <> e.id and e.role <> 'DEPARTMENT_HEAD')
  select id from heads
  union
  select s.id from public.profiles s, e
   where s.role = 'SUPER_ADMIN' and s.status = 'ACTIVE' and s.id <> e.id
     and (e.role = 'DEPARTMENT_HEAD' or not exists (select 1 from heads))
$$;
revoke all on function private.leave_stage1_ids(uuid) from public, anon, authenticated;

create or replace function private.leave_row(r public.leave_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'employeeId', r.employee_id,
    'employeeName', (select p.full_name from public.profiles p where p.id = r.employee_id),
    'departmentName', (select d.name from public.departments d where d.id = r.department_id),
    'leaveType', r.leave_type, 'startDate', r.start_date, 'endDate', r.end_date, 'halfDayShift', r.half_day_shift,
    'days', case when r.leave_type = 'HALF_DAY' then 0.5 else
      (select count(*) from generate_series(r.start_date, r.end_date, interval '1 day') d where extract(isodow from d) <> 7) end,
    'reason', r.reason, 'status', r.status, 'createdAt', r.created_at,
    'departmentHead', case when r.dh_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.dh_decided_by), 'at', r.dh_decided_at, 'note', r.dh_note) end,
    'hr', case when r.hr_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.hr_decided_by), 'at', r.hr_decided_at, 'note', r.hr_note) end)
$$;
revoke all on function private.leave_row(public.leave_requests) from public, anon, authenticated;

create or replace function public.submit_leave_request(
  p_leave_type text, p_start date, p_end date, p_half_day_shift text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_end date := coalesce(p_end, p_start);
  v_reason text := btrim(coalesce(p_reason, ''));
  r public.leave_requests;
  a uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_leave_type is null or p_leave_type not in ('FULL_DAY', 'HALF_DAY') or p_start is null then
    raise exception 'VALIDATION_ERROR: Choose the leave type and the date.' using errcode = 'P0001';
  end if;
  if p_leave_type = 'HALF_DAY' and (p_half_day_shift is null or p_half_day_shift not in ('MORNING', 'AFTERNOON')) then
    raise exception 'VALIDATION_ERROR: Choose the morning or the afternoon for a half day.' using errcode = 'P0001';
  end if;
  if p_leave_type = 'HALF_DAY' then v_end := p_start; end if;
  if v_end < p_start then
    raise exception 'VALIDATION_ERROR: The end date cannot be before the start date.' using errcode = 'P0001';
  end if;
  if v_end - p_start > 90 then
    raise exception 'VALIDATION_ERROR: A leave request can cover at most 90 days.' using errcode = 'P0001';
  end if;
  if length(v_reason) < 3 then
    raise exception 'VALIDATION_ERROR: Enter the reason for the leave.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.leave_requests x where x.employee_id = me.id
              and x.status in ('PENDING_DEPARTMENT_HEAD', 'PENDING_HR', 'APPROVED')
              and x.start_date <= v_end and x.end_date >= p_start) then
    raise exception 'CONFLICT: You already have a leave request for these dates.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from private.leave_stage1_ids(me.id)) then
    raise exception 'CONFLICT: There is no Department Head to review your leave yet. Contact HR.' using errcode = 'P0001';
  end if;

  insert into public.leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason)
  values (me.id, me.department_id, p_leave_type, p_start, v_end, case when p_leave_type = 'HALF_DAY' then p_half_day_shift end, v_reason)
  returning * into r;

  for a in select * from private.leave_stage1_ids(me.id) loop
    perform private.notify_once(a, 'LEAVE_AWAITING_DEPARTMENT_HEAD', 'Leave request awaiting your approval',
      format('%s requested %s leave (%s%s).', me.full_name, case when r.leave_type = 'HALF_DAY' then 'half-day' else 'full-day' end,
             to_char(r.start_date, 'DD Mon YYYY'), case when r.end_date <> r.start_date then ' to ' || to_char(r.end_date, 'DD Mon YYYY') else '' end),
      'leave_request', r.id, 'LEAVE_DH:' || r.id || ':' || a, jsonb_build_object('employeeId', me.id), 'urgent');
  end loop;
  perform private.write_audit('LEAVE_SUBMITTED', 'leave_request', r.id, me.department_id, null, jsonb_build_object('start', r.start_date, 'end', r.end_date));
  return private.leave_row(r);
end $$;
revoke all on function public.submit_leave_request(text, date, date, text, text) from public, anon;
grant execute on function public.submit_leave_request(text, date, date, text, text) to authenticated;

-- Step 1: the Department Head.
create or replace function public.decide_leave_department_head(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  me public.profiles;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  h uuid;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null or me.id is null or not exists (select 1 from private.leave_stage1_ids(r.employee_id) s where s = me.id) then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';
  end if;
  if r.employee_id = me.id then
    raise exception 'FORBIDDEN: You cannot decide your own leave.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING_DEPARTMENT_HEAD' then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;
  if p_approve is not true and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give a reason for rejecting the request.' using errcode = 'P0001';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'PENDING_HR' else 'REJECTED_BY_DEPARTMENT_HEAD' end,
         dh_decided_by = me.id, dh_decided_at = now(), dh_note = v_note, updated_at = now()
   where id = r.id returning * into r;

  perform private.notify_once(r.employee_id,
    case when p_approve then 'LEAVE_DEPARTMENT_HEAD_APPROVED' else 'LEAVE_DEPARTMENT_HEAD_REJECTED' end,
    case when p_approve then 'Leave approved by your Department Head' else 'Leave rejected by your Department Head' end,
    case when p_approve then 'It now waits for HR''s final approval.' else coalesce(v_note, '') end,
    'leave_request', r.id, 'LEAVE_EMP_DH:' || r.id, '{}'::jsonb);
  if p_approve then
    for h in select * from private.hr_department_member_ids() loop
      perform private.notify_once(h, 'LEAVE_AWAITING_HR', 'Leave request awaiting HR approval',
        format('%s: approved by the Department Head, now needs HR approval.', (select full_name from public.profiles where id = r.employee_id)),
        'leave_request', r.id, 'LEAVE_HR:' || r.id || ':' || h, jsonb_build_object('employeeId', r.employee_id), 'urgent');
    end loop;
  end if;
  perform private.write_audit('LEAVE_DEPARTMENT_HEAD_DECISION', 'leave_request', r.id, r.department_id, null, jsonb_build_object('approved', p_approve));
  return private.leave_row(r);
end $$;
revoke all on function public.decide_leave_department_head(uuid, boolean, text) from public, anon;
grant execute on function public.decide_leave_department_head(uuid, boolean, text) to authenticated;

-- Step 2: HR, only after the Department Head approved.
create or replace function public.decide_leave_hr(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR can give the final approval.' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';
  end if;
  if r.employee_id = auth.uid() then
    raise exception 'FORBIDDEN: You cannot decide your own leave.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING_HR' then
    raise exception 'CONFLICT: %', case when r.status = 'PENDING_DEPARTMENT_HEAD' then 'The Department Head has not approved this request yet.'
                                        else 'This request has already been decided.' end using errcode = 'P0001';
  end if;
  if r.dh_decided_by is not distinct from auth.uid() then
    raise exception 'FORBIDDEN: The final approval must come from someone other than the Department Head who reviewed it.' using errcode = '42501';
  end if;
  if p_approve is not true and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give a reason for rejecting the request.' using errcode = 'P0001';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED_BY_HR' end,
         hr_decided_by = auth.uid(), hr_decided_at = now(), hr_note = v_note, updated_at = now()
   where id = r.id returning * into r;

  perform private.notify_once(r.employee_id, case when p_approve then 'LEAVE_APPROVED' else 'LEAVE_REJECTED_BY_HR' end,
    case when p_approve then 'Your leave is approved' else 'Your leave was rejected by HR' end,
    case when p_approve then 'HR gave the final approval.' else coalesce(v_note, '') end,
    'leave_request', r.id, 'LEAVE_EMP_HR:' || r.id, '{}'::jsonb);
  perform private.notify_once(r.dh_decided_by, case when p_approve then 'LEAVE_APPROVED' else 'LEAVE_REJECTED_BY_HR' end,
    case when p_approve then 'Leave you approved was approved by HR' else 'Leave you approved was rejected by HR' end,
    (select full_name from public.profiles where id = r.employee_id),
    'leave_request', r.id, 'LEAVE_DH_FINAL:' || r.id, '{}'::jsonb);
  perform private.write_audit('LEAVE_HR_DECISION', 'leave_request', r.id, r.department_id, null, jsonb_build_object('approved', p_approve));
  return private.leave_row(r);
end $$;
revoke all on function public.decide_leave_hr(uuid, boolean, text) from public, anon;
grant execute on function public.decide_leave_hr(uuid, boolean, text) to authenticated;

-- My own requests, and what waits for me (as Department Head: my department's step 1; as HR: step 2).
create or replace function public.my_leave_requests()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_agg(private.leave_row(r) order by r.created_at desc)
                     from public.leave_requests r where r.employee_id = auth.uid()), '[]'::jsonb)
$$;
revoke all on function public.my_leave_requests() from public, anon;
grant execute on function public.my_leave_requests() to authenticated;

create or replace function public.leave_requests_to_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hr boolean := private.is_hr_staff();
begin
  return jsonb_build_object(
    'awaiting', coalesce((select jsonb_agg(private.leave_row(r) order by r.created_at)
        from public.leave_requests r
       where r.employee_id <> auth.uid()
         and ((r.status = 'PENDING_DEPARTMENT_HEAD' and exists (select 1 from private.leave_stage1_ids(r.employee_id) s where s = auth.uid()))
           or (r.status = 'PENDING_HR' and v_hr and r.dh_decided_by is distinct from auth.uid()))), '[]'::jsonb),
    'decided', coalesce((select jsonb_agg(private.leave_row(r) order by r.updated_at desc)
        from (select * from public.leave_requests x
               where x.employee_id <> auth.uid()
                 and ((x.dh_decided_by = auth.uid()) or (x.hr_decided_by = auth.uid())
                      or (v_hr and x.status in ('APPROVED', 'REJECTED_BY_HR', 'REJECTED_BY_DEPARTMENT_HEAD')))
               order by x.updated_at desc limit 40) r), '[]'::jsonb),
    'canReviewAsDepartmentHead', exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('DEPARTMENT_HEAD', 'SUPER_ADMIN')),
    'canReviewAsHr', v_hr);
end $$;
revoke all on function public.leave_requests_to_review() from public, anon;
grant execute on function public.leave_requests_to_review() to authenticated;

-- 5. Monthly half days and leave days ------------------------------------------------------------------------
-- Approved leave only. A full-day leave counts every day of the range that falls in the month, except Sundays
-- (the weekly off in the default working hours, Mon-Sat). A half day counts as one half day in the month it falls in.
-- HR and the Super Admin see everyone; a Department Head sees their own department.
create or replace function public.leave_monthly_summary(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, private.office_today()))::date;
  v_end date := (date_trunc('month', coalesce(p_month, private.office_today())) + interval '1 month - 1 day')::date;
  v_all boolean := private.is_hr_staff();
  v_dept uuid;
begin
  if not v_all then
    select p.department_id into v_dept from public.profiles p
     where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD';
    if v_dept is null then
      raise exception 'FORBIDDEN: Not allowed.' using errcode = '42501';
    end if;
  end if;
  return jsonb_build_object('month', to_char(v_start, 'YYYY-MM'), 'employees', coalesce((
    select jsonb_agg(jsonb_build_object('profileId', e.employee_id, 'halfDays', e.half_days, 'leaveDays', e.leave_days, 'records', e.records)
                     order by e.employee_id)
    from (
      select r.employee_id,
             count(*) filter (where r.leave_type = 'HALF_DAY') as half_days,
             coalesce(sum(case when r.leave_type = 'FULL_DAY' then
               (select count(*) from generate_series(greatest(r.start_date, v_start), least(r.end_date, v_end), interval '1 day') d
                 where extract(isodow from d) <> 7) else 0 end), 0)::integer as leave_days,
             jsonb_agg(jsonb_build_object('id', r.id, 'leaveType', r.leave_type, 'startDate', r.start_date, 'endDate', r.end_date,
                                          'halfDayShift', r.half_day_shift, 'reason', r.reason) order by r.start_date) as records
        from public.leave_requests r join public.profiles p on p.id = r.employee_id
       where r.status = 'APPROVED' and r.start_date <= v_end and r.end_date >= v_start
         and (v_all or p.department_id = v_dept)
       group by r.employee_id) e), '[]'::jsonb));
end $$;
revoke all on function public.leave_monthly_summary(date) from public, anon;
grant execute on function public.leave_monthly_summary(date) to authenticated;

notify pgrst, 'reload schema';
