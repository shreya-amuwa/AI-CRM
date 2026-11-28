-- =============================================================================
-- HR dashboard upgrade, Phase 2: the attendance statement (docs/hr-dashboard-upgrade.md).
--
-- A range view of the EXISTING attendance (attendance_records, attendance_events, attendance_lunches, leave_requests, office_holidays) through the
-- shared day engine private.att_day_rows (20270312000100). Nothing is copied: every figure is computed from the stored records.
--  * attendance_statement(filters): summary cards over the WHOLE filtered set, and one page of the daily / employee summary / monthly register view.
--  * attendance_export(filters, type, offset, limit): every matching row, in pages, for the Excel / CSV file the browser builds (no file is kept on
--    the server). Each export is recorded in attendance_export_log (who, when, dates, filters, type, rows).
--  * Who: HR staff (not recruiters) and the Super Admin, every employee; Department HR, their department only. Checked here, not by the screen.
--  * Inactive / left employees are included only when HR selects them (or asks for all statuses): their history is never dropped.
--  * Biometric reconciliation: the CRM figures with the biometric employee id (employee_personal_details.biometric_id, set by HR); the biometric
--    punch columns stay empty for HR to fill from the machine's export. Nothing is imported or invented.
-- Additive and safe to run twice. Run after 20270312000100_employee_review_cycles.sql.
-- =============================================================================

alter table public.employee_personal_details add column if not exists biometric_id text check (biometric_id is null or biometric_id ~ '^[A-Za-z0-9._-]{1,40}$');
create unique index if not exists employee_personal_details_biometric_idx on public.employee_personal_details (biometric_id) where biometric_id is not null;

create table if not exists public.attendance_export_log (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  export_type text not null,
  file_format text not null check (file_format in ('XLSX', 'CSV')),
  date_from date not null,
  date_to date not null,
  filters jsonb not null default '{}'::jsonb check (pg_column_size(filters) <= 8192),
  row_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists attendance_export_log_created_idx on public.attendance_export_log (created_at desc);
alter table public.attendance_export_log enable row level security;
revoke all on public.attendance_export_log from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Who may read the statement, and whom it covers
-- ---------------------------------------------------------------------------
create or replace function private.att_statement_scope()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  -- null = every department (HR staff, Super Admin); a department id = Department HR of that department
  if private.is_hr_staff() then return null; end if;
  if private.department_hr_scope() is not null then return private.department_hr_scope(); end if;
  raise exception 'FORBIDDEN: Only HR can view and export the attendance statement.' using errcode = '42501';
end $$;
revoke all on function private.att_statement_scope() from public, anon, authenticated;

create or replace function private.att_uuid_list(p jsonb)
returns uuid[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(x::uuid), '{}') from jsonb_array_elements_text(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
   where x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;

-- The employees a filter selects (departments, teams, employees, designation, employment type, employee status, shift start), within the scope.
-- Employee status: ACTIVE (default), INACTIVE, ALL. Explicitly chosen employees are always included, whatever their status (historical records).
create or replace function private.att_statement_people(f jsonb)
returns table (profile_id uuid) language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid := private.att_statement_scope();
  v_depts uuid[] := private.att_uuid_list(f -> 'departmentIds');
  v_teams uuid[] := private.att_uuid_list(f -> 'teamIds');
  v_people uuid[] := private.att_uuid_list(f -> 'profileIds');
  v_status text := coalesce(nullif(f ->> 'employeeStatus', ''), 'ACTIVE');
  v_desig text := nullif(btrim(coalesce(f ->> 'designation', '')), '');
  v_type text := nullif(f ->> 'employmentType', '');
  v_shift text := nullif(f ->> 'shift', '');
begin
  if v_status not in ('ACTIVE', 'INACTIVE', 'ALL') then raise exception 'VALIDATION_ERROR: Unknown employee status.' using errcode = 'P0001'; end if;
  return query
  select p.id from public.profiles p
   where p.role <> 'SUPER_ADMIN' and p.status <> 'REJECTED'
     and (v_scope is null or private.base_department(p.department_id) = v_scope)
     and (cardinality(v_depts) = 0 or private.base_department(p.department_id) = any (select private.base_department(x) from unnest(v_depts) x))
     and (cardinality(v_teams) = 0 or p.team_id = any (v_teams))
     and (cardinality(v_people) = 0 or p.id = any (v_people))
     and (cardinality(v_people) > 0 or v_status = 'ALL' or (v_status = 'ACTIVE') = (p.status = 'ACTIVE'))
     and (v_desig is null or coalesce(nullif(p.position, ''), (select d.designation from public.employee_personal_details d where d.profile_id = p.id), '') ilike v_desig)
     and (v_type is null or coalesce((select h.status from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'Full-Time') = v_type)
     and (v_shift is null or to_char((select t.punch_in from private.reminder_times(p.id) t), 'HH24:MI') = v_shift);
end $$;
revoke all on function private.att_statement_people(jsonb) from public, anon, authenticated;

-- the dates (Asia/Kolkata calendar days, both included) and the day status filter
create or replace function private.att_statement_range(f jsonb, p_max_days integer)
returns daterange language plpgsql stable set search_path = '' as $$
declare
  v_from date := case when f ->> 'from' ~ '^\d{4}-\d{2}-\d{2}$' then (f ->> 'from')::date end;
  v_to date := case when f ->> 'to' ~ '^\d{4}-\d{2}-\d{2}$' then (f ->> 'to')::date end;
begin
  if v_from is null or v_to is null then raise exception 'VALIDATION_ERROR: Choose the From and To dates.' using errcode = 'P0001'; end if;
  if v_from > v_to then raise exception 'VALIDATION_ERROR: From Date must not be later than To Date.' using errcode = 'P0001'; end if;
  if v_to - v_from + 1 > p_max_days then
    raise exception 'VALIDATION_ERROR: Choose at most % days for this view.', p_max_days using errcode = 'P0001';
  end if;
  return daterange(v_from, v_to, '[]');
end $$;
revoke all on function private.att_statement_range(jsonb, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The rows: the day engine joined with the people's details
-- ---------------------------------------------------------------------------
create or replace function private.att_statement_rows(f jsonb, p_max_days integer)
returns table (profile_id uuid, day date, status text, scheduled boolean, punch_in_at timestamptz, punch_out_at timestamptz, day_start time, day_end time,
               lunch_start timestamptz, lunch_end timestamptz, break_count integer, break_minutes integer, gross_minutes integer, net_minutes integer,
               late_minutes integer, early_minutes integer, leave text, holiday text, correction text, incomplete boolean,
               employee_code text, full_name text, department text, department_id uuid, team text, designation text, employment_type text,
               account_status text, biometric_id text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_range daterange := private.att_statement_range(f, p_max_days);
  v_ids uuid[];
  v_status text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(f -> 'statuses') = 'array' then f -> 'statuses' else '[]'::jsonb end) x), '{}');
begin
  select coalesce(array_agg(x.profile_id), '{}') into v_ids from private.att_statement_people(f) x;
  return query
  select r.*, coalesce((select h.id from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'EMP-' || upper(left(p.id::text, 8))),
         p.full_name, (select d.name from public.departments d where d.id = private.base_department(p.department_id)), private.base_department(p.department_id),
         (select t.name from public.teams t where t.id = p.team_id),
         coalesce(nullif(p.position, ''), pd.designation),
         coalesce((select h.status from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'Full-Time'),
         p.status::text, pd.biometric_id
    from private.att_day_rows(lower(v_range), upper(v_range) - 1, v_ids) r
    join public.profiles p on p.id = r.profile_id
    left join public.employee_personal_details pd on pd.profile_id = p.id
   where cardinality(v_status) = 0
      or (r.status = any (v_status))
      or ('PRESENT_ANY' = any (v_status) and r.status in ('PRESENT', 'LATE', 'HALF_DAY', 'MISSING_PUNCH_OUT', 'IN_PROGRESS'))
      or ('LATE_ARRIVAL' = any (v_status) and r.late_minutes > 0 and r.punch_in_at is not null)
      or ('EARLY_DEPARTURE' = any (v_status) and r.early_minutes > 0)
      or ('DISCREPANCY' = any (v_status) and (r.status = 'MISSING_PUNCH_OUT' or r.correction = 'PENDING'));
end $$;
revoke all on function private.att_statement_rows(jsonb, integer) from public, anon, authenticated;

create or replace function private.att_row_json(r record)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return jsonb_build_object(
    'profileId', r.profile_id, 'date', r.day, 'employeeCode', r.employee_code, 'name', r.full_name, 'department', r.department, 'team', r.team,
    'designation', r.designation, 'employmentType', r.employment_type, 'accountStatus', r.account_status, 'biometricId', r.biometric_id,
    'status', r.status, 'scheduled', r.scheduled, 'shiftStart', to_char(r.day_start, 'HH24:MI'), 'shiftEnd', to_char(r.day_end, 'HH24:MI'),
    'punchIn', r.punch_in_at, 'punchOut', r.punch_out_at, 'lunchStart', r.lunch_start, 'lunchEnd', r.lunch_end, 'breaks', r.break_count,
    'breakMinutes', r.break_minutes, 'grossMinutes', r.gross_minutes, 'netMinutes', r.net_minutes, 'lateMinutes', r.late_minutes,
    'earlyMinutes', r.early_minutes, 'leave', r.leave, 'holiday', r.holiday, 'correction', r.correction, 'incomplete', r.incomplete,
    'source', case when r.punch_in_at is null then null else 'CRM' end);
end $$;
revoke all on function private.att_row_json(record) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The statement (one page of a view, summary over everything filtered)
-- ---------------------------------------------------------------------------
-- f: { from, to, departmentIds[], teamIds[], profileIds[], designation, employmentType, employeeStatus, shift, statuses[],
--      view: DAILY | SUMMARY | REGISTER, sort: date | name | department | punch_in | hours | status, dir: asc | desc, page, pageSize }
create or replace function public.attendance_statement(f jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_view text := upper(coalesce(nullif(f ->> 'view', ''), 'DAILY'));
  v_page integer := greatest(1, coalesce((f ->> 'page')::int, 1));
  v_size integer := least(200, greatest(10, coalesce((f ->> 'pageSize')::int, 50)));
  v_sort text := coalesce(nullif(f ->> 'sort', ''), 'date');
  v_desc boolean := lower(coalesce(f ->> 'dir', case when coalesce(nullif(f ->> 'sort', ''), 'date') = 'date' then 'desc' else 'asc' end)) = 'desc';
  v_max integer := case v_view when 'REGISTER' then 62 when 'SUMMARY' then 731 else 366 end;
  v_summary jsonb;
  v_rows jsonb;
  v_total integer;
begin
  perform private.att_statement_scope();
  if v_view not in ('DAILY', 'SUMMARY', 'REGISTER') then raise exception 'VALIDATION_ERROR: Unknown view.' using errcode = 'P0001'; end if;
  if v_sort not in ('date', 'name', 'department', 'punch_in', 'hours', 'status') then raise exception 'VALIDATION_ERROR: Unknown sort.' using errcode = 'P0001'; end if;

  create temp table if not exists att_stmt_tmp on commit drop as select * from private.att_statement_rows(f, v_max) limit 0;
  truncate att_stmt_tmp;
  insert into att_stmt_tmp select * from private.att_statement_rows(f, v_max);

  -- the cards: employee-days and unique employees, over everything filtered (never just the page)
  select jsonb_build_object(
      'employees', count(distinct profile_id), 'employeeDays', count(*),
      'scheduledDays', count(*) filter (where scheduled and status not in ('UPCOMING', 'NOT_STARTED')),
      'presentDays', count(*) filter (where status in ('PRESENT', 'LATE', 'MISSING_PUNCH_OUT', 'IN_PROGRESS')) + 0.5 * count(*) filter (where status = 'HALF_DAY'),
      'absentDays', count(*) filter (where status = 'ABSENT'),
      'approvedLeaveDays', count(*) filter (where status = 'APPROVED_LEAVE') + 0.5 * count(*) filter (where status = 'HALF_DAY'),
      'halfDays', count(*) filter (where status = 'HALF_DAY'),
      'lateArrivals', count(*) filter (where late_minutes > 0 and punch_in_at is not null),
      'earlyDepartures', count(*) filter (where early_minutes > 0),
      'missingPunches', count(*) filter (where status = 'MISSING_PUNCH_OUT'),
      'netMinutes', coalesce(sum(net_minutes), 0), 'breakMinutes', coalesce(sum(break_minutes), 0),
      'averageNetMinutes', coalesce(round(avg(net_minutes) filter (where net_minutes is not null)), 0))
    into v_summary from att_stmt_tmp;

  if v_view = 'DAILY' then
    select count(*) into v_total from att_stmt_tmp;
    select coalesce(jsonb_agg(private.att_row_json(x) order by x.ord), '[]'::jsonb) into v_rows from (
      select t.*, row_number() over (order by
               case when v_sort = 'date' and not v_desc then t.day end asc, case when v_sort = 'date' and v_desc then t.day end desc,
               case when v_sort = 'name' and not v_desc then t.full_name end asc, case when v_sort = 'name' and v_desc then t.full_name end desc,
               case when v_sort = 'department' and not v_desc then t.department end asc, case when v_sort = 'department' and v_desc then t.department end desc,
               case when v_sort = 'punch_in' and not v_desc then (t.punch_in_at at time zone 'Asia/Kolkata')::time end asc nulls last,
               case when v_sort = 'punch_in' and v_desc then (t.punch_in_at at time zone 'Asia/Kolkata')::time end desc nulls last,
               case when v_sort = 'hours' and not v_desc then t.net_minutes end asc nulls last, case when v_sort = 'hours' and v_desc then t.net_minutes end desc nulls last,
               case when v_sort = 'status' and not v_desc then t.status end asc, case when v_sort = 'status' and v_desc then t.status end desc,
               t.day desc, t.full_name) as ord
        from att_stmt_tmp t) x
     where x.ord > (v_page - 1) * v_size and x.ord <= v_page * v_size;
  elsif v_view = 'SUMMARY' then
    select count(distinct profile_id) into v_total from att_stmt_tmp;
    select coalesce(jsonb_agg(s.j order by s.ord), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('profileId', g.profile_id, 'employeeCode', g.employee_code, 'name', g.full_name, 'department', g.department, 'team', g.team,
               'designation', g.designation, 'employmentType', g.employment_type, 'accountStatus', g.account_status, 'biometricId', g.biometric_id,
               'scheduledDays', g.scheduled_days, 'presentDays', g.present_days, 'absentDays', g.absent_days, 'leaveDays', g.leave_days, 'halfDays', g.half_days,
               'lateArrivals', g.late, 'earlyDepartures', g.early, 'missingPunches', g.missing, 'netMinutes', g.net, 'breakMinutes', g.brk,
               'averageNetMinutes', g.avg_net) as j,
             row_number() over (order by case when v_sort = 'hours' then -g.net end, case when v_sort = 'department' then g.department end, g.full_name) as ord
        from (select t.profile_id, t.employee_code, t.full_name, t.department, t.team, t.designation, t.employment_type, t.account_status, t.biometric_id,
                     count(*) filter (where t.scheduled and t.status not in ('UPCOMING', 'NOT_STARTED')) as scheduled_days,
                     count(*) filter (where t.status in ('PRESENT', 'LATE', 'MISSING_PUNCH_OUT', 'IN_PROGRESS')) + 0.5 * count(*) filter (where t.status = 'HALF_DAY') as present_days,
                     count(*) filter (where t.status = 'ABSENT') as absent_days,
                     count(*) filter (where t.status = 'APPROVED_LEAVE') + 0.5 * count(*) filter (where t.status = 'HALF_DAY') as leave_days,
                     count(*) filter (where t.status = 'HALF_DAY') as half_days,
                     count(*) filter (where t.late_minutes > 0 and t.punch_in_at is not null) as late, count(*) filter (where t.early_minutes > 0) as early,
                     count(*) filter (where t.status = 'MISSING_PUNCH_OUT') as missing, coalesce(sum(t.net_minutes), 0) as net, coalesce(sum(t.break_minutes), 0) as brk,
                     coalesce(round(avg(t.net_minutes) filter (where t.net_minutes is not null)), 0) as avg_net
                from att_stmt_tmp t
               group by t.profile_id, t.employee_code, t.full_name, t.department, t.team, t.designation, t.employment_type, t.account_status, t.biometric_id) g) s
     where s.ord > (v_page - 1) * v_size and s.ord <= v_page * v_size;
  else
    -- the monthly register: employees as rows, the dates as columns (P, A, L, H, WO, HD, MP ...)
    select count(distinct profile_id) into v_total from att_stmt_tmp;
    select coalesce(jsonb_agg(s.j order by s.ord), '[]'::jsonb) into v_rows from (
      select jsonb_build_object('profileId', g.profile_id, 'employeeCode', g.employee_code, 'name', g.full_name, 'department', g.department,
               'days', g.days) as j, row_number() over (order by g.full_name) as ord
        from (select t.profile_id, t.employee_code, t.full_name, t.department,
                     jsonb_object_agg(t.day::text, case t.status when 'PRESENT' then 'P' when 'LATE' then 'P' when 'IN_PROGRESS' then 'P' when 'ABSENT' then 'A'
                       when 'APPROVED_LEAVE' then 'L' when 'HOLIDAY' then 'H' when 'WEEKLY_OFF' then 'WO' when 'HALF_DAY' then 'HD' when 'MISSING_PUNCH_OUT' then 'MP'
                       when 'NOT_JOINED' then '-' else '' end) as days
                from att_stmt_tmp t group by t.profile_id, t.employee_code, t.full_name, t.department) g) s
     where s.ord > (v_page - 1) * v_size and s.ord <= v_page * v_size;
  end if;

  return jsonb_build_object('from', f ->> 'from', 'to', f ->> 'to', 'view', v_view, 'timeZone', 'Asia/Kolkata', 'today', private.office_today(),
    'summary', v_summary, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'rows', v_rows);
end $$;
revoke all on function public.attendance_statement(jsonb) from public, anon;
grant execute on function public.attendance_statement(jsonb) to authenticated;

-- The filter choices (departments, teams, employees incl. inactive ones, designations, shifts) within the viewer's scope
create or replace function public.attendance_statement_options()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope uuid := private.att_statement_scope();
begin
  return jsonb_build_object(
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name) from public.departments d
                              where d.facet_of is null and (v_scope is null or d.id = v_scope)
                                and exists (select 1 from public.profiles p where private.base_department(p.department_id) = d.id and p.role <> 'SUPER_ADMIN')), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'departmentId', private.base_department(t.department_id)) order by t.name)
                         from public.teams t where v_scope is null or private.base_department(t.department_id) = v_scope), '[]'::jsonb),
    'employees', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'departmentId', private.base_department(p.department_id), 'teamId', p.team_id,
                              'active', p.status = 'ACTIVE', 'designation', coalesce(nullif(p.position, ''), pd.designation)) order by p.full_name)
                             from public.profiles p left join public.employee_personal_details pd on pd.profile_id = p.id
                            where p.role <> 'SUPER_ADMIN' and p.status <> 'REJECTED' and (v_scope is null or private.base_department(p.department_id) = v_scope)), '[]'::jsonb),
    'designations', coalesce((select jsonb_agg(distinct x) from (select coalesce(nullif(p.position, ''), pd.designation) x from public.profiles p
                               left join public.employee_personal_details pd on pd.profile_id = p.id
                              where p.role <> 'SUPER_ADMIN' and (v_scope is null or private.base_department(p.department_id) = v_scope)) y where x is not null), '[]'::jsonb),
    'shifts', coalesce((select jsonb_agg(distinct to_char(t.punch_in, 'HH24:MI')) from public.profiles p, lateral private.reminder_times(p.id) t
                          where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' and (v_scope is null or private.base_department(p.department_id) = v_scope)), '[]'::jsonb),
    'organization', 'Amuwa Corporation', 'timeZone', 'Asia/Kolkata', 'canExport', true);
end $$;
revoke all on function public.attendance_statement_options() from public, anon;
grant execute on function public.attendance_statement_options() to authenticated;

-- ---------------------------------------------------------------------------
-- The export: every matching row, in pages (the browser builds the file); the first page records the export
-- ---------------------------------------------------------------------------
-- p_type: DETAILED | SUMMARY | REGISTER | RAW_PUNCHES | RECONCILIATION; p_format: XLSX | CSV
create or replace function public.attendance_export(f jsonb, p_type text, p_format text, p_offset integer default 0, p_limit integer default 5000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_type text := upper(coalesce(p_type, ''));
  v_lim integer := least(10000, greatest(100, coalesce(p_limit, 5000)));
  v_off integer := greatest(0, coalesce(p_offset, 0));
  v_rows jsonb;
  v_total integer;
  v_range daterange;
  v_ids uuid[];
  me public.profiles;
begin
  perform private.att_statement_scope();
  if v_type not in ('DETAILED', 'SUMMARY', 'REGISTER', 'RAW_PUNCHES', 'RECONCILIATION') then raise exception 'VALIDATION_ERROR: Choose a report type.' using errcode = 'P0001'; end if;
  if upper(coalesce(p_format, '')) not in ('XLSX', 'CSV') then raise exception 'VALIDATION_ERROR: Choose Excel or CSV.' using errcode = 'P0001'; end if;
  select * into me from public.profiles where id = auth.uid();

  if v_type in ('SUMMARY', 'REGISTER') then
    -- the employee summary / register for the whole set (one row per employee); the statement view already pages them
    v_rows := public.attendance_statement(f || jsonb_build_object('view', case v_type when 'SUMMARY' then 'SUMMARY' else 'REGISTER' end, 'page', 1 + v_off / 200, 'pageSize', 200));
    v_total := (v_rows ->> 'total')::int;
    v_rows := v_rows -> 'rows';
  elsif v_type = 'RAW_PUNCHES' then
    v_range := private.att_statement_range(f, 366);
    select coalesce(array_agg(x.profile_id), '{}') into v_ids from private.att_statement_people(f) x;
    select count(*) into v_total from (
      select 1 from public.attendance_events e where e.profile_id = any (v_ids) and e.attendance_date <@ v_range
      union all
      select 1 from public.attendance_lunches l where l.profile_id = any (v_ids) and l.attendance_date <@ v_range
      union all
      select 1 from public.attendance_lunches l where l.profile_id = any (v_ids) and l.attendance_date <@ v_range and l.ended_at is not null) c;
    select coalesce(jsonb_agg(z.j order by z.at, z.k), '[]'::jsonb) into v_rows from (
      select * from (
        select jsonb_build_object('date', e.attendance_date, 'employeeCode', coalesce((select h.id from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'EMP-' || upper(left(p.id::text, 8))),
                 'name', p.full_name, 'biometricId', pd.biometric_id, 'event', e.kind, 'at', e.occurred_at, 'location', e.location_status,
                 'recordedBy', case when e.recorded_by is null then 'Employee' else (select r.full_name from public.profiles r where r.id = e.recorded_by) end, 'note', e.note) as j,
               e.occurred_at as at, e.id::text as k
          from public.attendance_events e join public.profiles p on p.id = e.profile_id left join public.employee_personal_details pd on pd.profile_id = p.id
         where e.profile_id = any (v_ids) and e.attendance_date <@ v_range
        union all
        select jsonb_build_object('date', l.attendance_date, 'employeeCode', coalesce((select h.id from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'EMP-' || upper(left(p.id::text, 8))),
                 'name', p.full_name, 'biometricId', pd.biometric_id, 'event', 'LUNCH_START', 'at', l.started_at, 'location', null, 'recordedBy', 'Employee', 'note', null),
               l.started_at, l.id::text || 's'
          from public.attendance_lunches l join public.profiles p on p.id = l.profile_id left join public.employee_personal_details pd on pd.profile_id = p.id
         where l.profile_id = any (v_ids) and l.attendance_date <@ v_range
        union all
        select jsonb_build_object('date', l.attendance_date, 'employeeCode', coalesce((select h.id from public.hr_employees h where h.profile_id = p.id order by h.created_at limit 1), 'EMP-' || upper(left(p.id::text, 8))),
                 'name', p.full_name, 'biometricId', pd.biometric_id, 'event', 'LUNCH_END', 'at', l.ended_at, 'location', null,
                 'recordedBy', case l.ended_by when 'PUNCH_OUT' then 'Ended by Punch Out' when 'HR' then 'HR' else 'Employee' end, 'note', null),
               l.ended_at, l.id::text || 'e'
          from public.attendance_lunches l join public.profiles p on p.id = l.profile_id left join public.employee_personal_details pd on pd.profile_id = p.id
         where l.profile_id = any (v_ids) and l.attendance_date <@ v_range and l.ended_at is not null) u
       order by u.at, u.k offset v_off limit v_lim) z;
  else
    -- DETAILED and RECONCILIATION: one row per employee and day
    select count(*) into v_total from private.att_statement_rows(f, 366);
    select coalesce(jsonb_agg(private.att_row_json(x) order by x.day, x.full_name), '[]'::jsonb) into v_rows
      from (select * from private.att_statement_rows(f, 366) r order by r.day, r.full_name offset v_off limit v_lim) x;
  end if;

  if v_off = 0 then
    insert into public.attendance_export_log (actor_id, export_type, file_format, date_from, date_to, filters, row_count)
    values (auth.uid(), v_type, upper(p_format), (f ->> 'from')::date, (f ->> 'to')::date, f - 'page' - 'pageSize', v_total);
    perform private.write_audit('ATTENDANCE_EXPORTED', 'attendance', null, null, null,
      jsonb_build_object('type', v_type, 'format', upper(p_format), 'from', f ->> 'from', 'to', f ->> 'to', 'rows', v_total));
  end if;
  return jsonb_build_object('type', v_type, 'total', v_total, 'offset', v_off, 'rows', v_rows, 'generatedAt', now(), 'generatedBy', me.full_name,
    'organization', 'Amuwa Corporation', 'timeZone', 'Asia/Kolkata');
end $$;
revoke all on function public.attendance_export(jsonb, text, text, integer, integer) from public, anon;
grant execute on function public.attendance_export(jsonb, text, text, integer, integer) to authenticated;

-- HR records an employee's biometric machine id (one per employee, never two employees with the same id)
create or replace function public.hr_set_biometric_id(p_profile uuid, p_biometric text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_biometric, '')), '');
begin
  if not private.is_hr_staff() then raise exception 'FORBIDDEN: Only HR can set the biometric id.' using errcode = '42501'; end if;
  if v is not null and v !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'VALIDATION_ERROR: Use letters, digits, dot, dash or underscore (40 at most).' using errcode = 'P0001'; end if;
  if v is not null and exists (select 1 from public.employee_personal_details d where d.biometric_id = v and d.profile_id <> p_profile) then
    raise exception 'CONFLICT: Another employee already has this biometric id.' using errcode = 'P0001';
  end if;
  insert into public.employee_personal_details (profile_id, biometric_id) values (p_profile, v)
  on conflict (profile_id) do update set biometric_id = excluded.biometric_id;
  perform private.write_audit('BIOMETRIC_ID_SET', 'profile', p_profile, null, null, jsonb_build_object('set', v is not null));
  return jsonb_build_object('profileId', p_profile, 'biometricId', v);
end $$;
revoke all on function public.hr_set_biometric_id(uuid, text) from public, anon;
grant execute on function public.hr_set_biometric_id(uuid, text) to authenticated;

-- the export history (HR)
create or replace function public.attendance_export_history(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.att_statement_scope();
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'by', (select p.full_name from public.profiles p where p.id = l.actor_id), 'type', l.export_type,
            'format', l.file_format, 'from', l.date_from, 'to', l.date_to, 'rows', l.row_count, 'at', l.created_at) order by l.created_at desc)
     from (select * from public.attendance_export_log x where private.is_hr_staff() or x.actor_id = auth.uid() order by x.created_at desc limit least(200, greatest(1, p_limit))) l), '[]'::jsonb);
end $$;
revoke all on function public.attendance_export_history(integer) from public, anon;
grant execute on function public.attendance_export_history(integer) to authenticated;

notify pgrst, 'reload schema';
