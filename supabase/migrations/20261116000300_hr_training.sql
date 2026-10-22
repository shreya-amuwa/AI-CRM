-- =============================================================================
-- HR Training workspace: structured three-day training programs with a report for every employee and every day.
-- Safe to run again; nothing is deleted.
--
--   hr_training_programs      a program: name, start date, the responsible HR employee. Its three days are made with it and always sit on
--                             consecutive dates from the start date (change the start date and the schedule follows).
--   hr_training_days          Day 1 Initial Training, Day 2 Practical Training, Day 3 Final Training and Assessment: the topics, the trainer
--                             and the assessment criteria are configured here (nothing about the content is hard-coded).
--   hr_training_enrollments   one employee in one program, with the overall status (Not Started / In Progress / Completed / Incomplete),
--                             the strengths, the areas to improve and, once the training is over, the consolidated report.
--                             The same employee can attend any number of programs; every enrollment stays as history.
--   hr_training_day_reports   one row per enrollment and day: attendance, topics done, tasks, assessment scores, feedback, remarks.
--
-- A day is COMPLETE only when the employee actually attended (present or late) AND something was recorded for it (a topic done, a task done
-- or an assessment score); Day 3 also needs its assessment. The date passing completes nothing. The status of an enrollment follows from that:
-- all three days complete = Completed; the program is over and not all complete = Incomplete; something recorded = In progress; else Not started.
-- HR staff (and the Super Admin) manage everything; the trainer named on a day can record that day's reports.
-- =============================================================================

create table if not exists public.hr_training_programs (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 2 and 160),
  description text check (description is null or length(description) <= 2000),
  start_date date not null,
  owner_id uuid references public.profiles(id) on delete set null,       -- the responsible HR employee (gets the pending-report reminder)
  is_cancelled boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.hr_training_days (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.hr_training_programs(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 3),
  title text not null check (length(btrim(title)) between 2 and 160),
  topics jsonb not null default '[]'::jsonb check (jsonb_typeof(topics) = 'array' and jsonb_array_length(topics) <= 30),
  trainer_name text check (trainer_name is null or length(trainer_name) <= 160),
  trainer_id uuid references public.profiles(id) on delete set null,     -- a CRM user who may record this day's reports
  criteria jsonb not null default '[]'::jsonb check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) <= 20),   -- [{"name": "...", "max": 10}]
  pass_percent integer check (pass_percent is null or pass_percent between 1 and 100),
  unique (program_id, day_no)
);

create table if not exists public.hr_training_enrollments (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.hr_training_programs(id) on delete cascade,
  employee_key text not null,                                            -- the HR employee key (a CRM profile id, or "HR:<record id>")
  profile_id uuid references public.profiles(id) on delete set null,
  employee_name text not null,
  employee_code text,
  department_name text,
  designation text,
  status text not null default 'NOT_STARTED' check (status in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE')),
  strengths text check (strengths is null or length(strengths) <= 2000),
  improvements text check (improvements is null or length(improvements) <= 2000),
  trainer_remarks text check (trainer_remarks is null or length(trainer_remarks) <= 2000),
  consolidated jsonb,
  consolidated_at timestamptz,
  enrolled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, employee_key)
);
create index if not exists hr_training_enrollments_employee_idx on public.hr_training_enrollments (employee_key, created_at desc);
create index if not exists hr_training_enrollments_status_idx on public.hr_training_enrollments (program_id, status);

create table if not exists public.hr_training_day_reports (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.hr_training_enrollments(id) on delete cascade,
  day_no integer not null check (day_no between 1 and 3),
  attendance text check (attendance in ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED')),
  topics_completed jsonb not null default '[]'::jsonb check (jsonb_typeof(topics_completed) = 'array' and jsonb_array_length(topics_completed) <= 30),
  tasks jsonb not null default '[]'::jsonb check (jsonb_typeof(tasks) = 'array' and jsonb_array_length(tasks) <= 30),        -- [{"title": "...", "done": true}]
  scores jsonb not null default '[]'::jsonb check (jsonb_typeof(scores) = 'array' and jsonb_array_length(scores) <= 20),     -- [{"criterion": "...", "score": 8, "max": 10}]
  assessment_total numeric,
  assessment_max numeric,
  assessment_result text check (assessment_result in ('PASS', 'FAIL', 'RECORDED')),
  feedback text check (feedback is null or length(feedback) <= 2000),
  trainer_remarks text check (trainer_remarks is null or length(trainer_remarks) <= 2000),
  report text check (report is null or length(report) <= 4000),
  day_completed boolean not null default false,                          -- derived by the database from attendance + what was recorded
  reported_by uuid references public.profiles(id) on delete set null,
  reported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (enrollment_id, day_no)
);

do $$ declare t text; begin
  foreach t in array array['hr_training_programs', 'hr_training_days', 'hr_training_enrollments', 'hr_training_day_reports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_hr_staff())', t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop trigger if exists hr_training_programs_set_updated_at on public.hr_training_programs;
create trigger hr_training_programs_set_updated_at before update on public.hr_training_programs for each row execute function public.tg_set_updated_at();
drop trigger if exists hr_training_enrollments_set_updated_at on public.hr_training_enrollments;
create trigger hr_training_enrollments_set_updated_at before update on public.hr_training_enrollments for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create or replace function private.training_day_date(p_program public.hr_training_programs, p_day integer)
returns date language sql immutable set search_path = '' as $$ select p_program.start_date + (p_day - 1) $$;

-- Who may record the reports of a day: HR staff, the Super Admin, and the trainer named on that day.
create or replace function private.training_can_report(p_program uuid, p_day integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_staff() or exists (select 1 from public.hr_training_days d where d.program_id = p_program and d.day_no = p_day and d.trainer_id = private.my_id())
$$;
revoke all on function private.training_can_report(uuid, integer) from public, anon;
grant execute on function private.training_can_report(uuid, integer) to authenticated, service_role;
create or replace function private.training_can_view(p_program uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_hr_staff() or exists (select 1 from public.hr_training_days d where d.program_id = p_program and d.trainer_id = private.my_id())
$$;
revoke all on function private.training_can_view(uuid) from public, anon;
grant execute on function private.training_can_view(uuid) to authenticated, service_role;

-- Is a day complete? Attended (present or late) and something recorded; Day 3 also needs its assessment.
create or replace function private.training_day_done(r public.hr_training_day_reports)
returns boolean language sql stable set search_path = '' as $$
  select r.attendance in ('PRESENT', 'LATE')
     and (jsonb_array_length(r.topics_completed) > 0 or exists (select 1 from jsonb_array_elements(r.tasks) t where (t ->> 'done')::boolean is true) or r.assessment_result is not null)
     and (r.day_no < 3 or r.assessment_result is not null)
$$;

-- The status of an enrollment, from what was actually recorded (never from the calendar alone, except that an over program that is not complete is Incomplete).
create or replace function private.training_recompute(p_enrollment uuid, p_today date default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  pr public.hr_training_programs;
  v_today date := coalesce(p_today, private.hr_today());
  v_done integer;
  v_any integer;
  v_status text;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment for update;
  if e.id is null then return null; end if;
  select * into pr from public.hr_training_programs where id = e.program_id;
  select count(*) filter (where day_completed), count(*) filter (where attendance is not null) into v_done, v_any from public.hr_training_day_reports where enrollment_id = e.id;
  v_status := case
    when v_done >= 3 then 'COMPLETED'
    when v_today > private.training_day_date(pr, 3) or pr.is_cancelled then 'INCOMPLETE'
    when v_any > 0 then 'IN_PROGRESS'
    else 'NOT_STARTED' end;
  if v_status is distinct from e.status then
    update public.hr_training_enrollments set status = v_status where id = e.id;
  end if;
  return v_status;
end $$;
revoke all on function private.training_recompute(uuid, date) from public, anon, authenticated;

-- The consolidated report of one employee's training, from the three day reports. Missing information reads as such, it is never filled in.
create or replace function private.training_consolidated(p_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  pr public.hr_training_programs;
  v_days jsonb;
  v_att integer;
  v_done integer;
  v_total numeric;
  v_max numeric;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment;
  select * into pr from public.hr_training_programs where id = e.program_id;
  select coalesce(jsonb_agg(jsonb_build_object(
            'day', d.day_no, 'title', d.title, 'date', private.training_day_date(pr, d.day_no), 'trainer', d.trainer_name,
            'attendance', r.attendance, 'completed', coalesce(r.day_completed, false),
            'topicsPlanned', jsonb_array_length(d.topics), 'topicsCompleted', coalesce(jsonb_array_length(r.topics_completed), 0),
            'tasksTotal', coalesce(jsonb_array_length(r.tasks), 0), 'tasksDone', coalesce((select count(*) from jsonb_array_elements(r.tasks) t where (t ->> 'done')::boolean is true), 0),
            'assessmentTotal', r.assessment_total, 'assessmentMax', r.assessment_max,
            'assessmentPercent', case when coalesce(r.assessment_max, 0) > 0 then round(100 * r.assessment_total / r.assessment_max, 1) end,
            'assessmentResult', r.assessment_result, 'feedback', r.feedback, 'trainerRemarks', r.trainer_remarks, 'report', r.report) order by d.day_no), '[]'::jsonb)
    into v_days
    from public.hr_training_days d left join public.hr_training_day_reports r on r.enrollment_id = e.id and r.day_no = d.day_no where d.program_id = pr.id;
  select count(*) filter (where attendance in ('PRESENT', 'LATE')), count(*) filter (where day_completed), sum(assessment_total), sum(assessment_max)
    into v_att, v_done, v_total, v_max from public.hr_training_day_reports where enrollment_id = e.id;
  return jsonb_build_object(
    'program', pr.name, 'startDate', pr.start_date, 'endDate', private.training_day_date(pr, 3), 'status', e.status,
    'daysAttended', coalesce(v_att, 0), 'daysCompleted', coalesce(v_done, 0), 'days', v_days,
    'assessmentPercent', case when coalesce(v_max, 0) > 0 then round(100 * v_total / v_max, 1) end,
    'strengths', e.strengths, 'improvements', e.improvements, 'trainerRemarks', e.trainer_remarks,
    'missing', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select format('Day %s: no attendance recorded', d.day_no) as x from public.hr_training_days d
          left join public.hr_training_day_reports r on r.enrollment_id = e.id and r.day_no = d.day_no where d.program_id = pr.id and r.attendance is null
        union all select 'Strengths and areas to improve have not been written' where coalesce(btrim(e.strengths), '') = '' and coalesce(btrim(e.improvements), '') = '') m));
end $$;
revoke all on function private.training_consolidated(uuid) from public, anon, authenticated;

create or replace function private.training_program_json(p public.hr_training_programs, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.name, 'description', p.description, 'startDate', p.start_date, 'endDate', p.start_date + 2, 'isCancelled', p.is_cancelled,
    'ownerId', p.owner_id, 'owner', (select o.full_name from public.profiles o where o.id = p.owner_id),
    'phase', case when p.is_cancelled then 'CANCELLED' when p_today < p.start_date then 'UPCOMING' when p_today > p.start_date + 2 then 'ENDED' else 'RUNNING' end,
    'enrolled', (select count(*) from public.hr_training_enrollments e where e.program_id = p.id),
    'byStatus', coalesce((select jsonb_object_agg(s.status, s.n) from (select e.status, count(*) n from public.hr_training_enrollments e where e.program_id = p.id group by e.status) s), '{}'::jsonb),
    'days', coalesce((select jsonb_agg(jsonb_build_object('dayNo', d.day_no, 'date', p.start_date + (d.day_no - 1), 'title', d.title, 'topics', d.topics, 'trainerName', d.trainer_name,
                                                          'trainerId', d.trainer_id, 'criteria', d.criteria, 'passPercent', d.pass_percent) order by d.day_no)
                        from public.hr_training_days d where d.program_id = p.id), '[]'::jsonb))
$$;
revoke all on function private.training_program_json(public.hr_training_programs, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading
-- ---------------------------------------------------------------------------
create or replace function public.hr_training_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  perform private.hr_require_staff();
  return jsonb_build_object(
    'today', v_today,
    'employeesEnrolled', (select count(distinct e.employee_key) from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id where not p.is_cancelled),
    'activePrograms', (select count(*) from public.hr_training_programs p where not p.is_cancelled and v_today between p.start_date and p.start_date + 2),
    'upcomingPrograms', (select count(*) from public.hr_training_programs p where not p.is_cancelled and p.start_date > v_today),
    'completed', (select count(*) from public.hr_training_enrollments e where e.status = 'COMPLETED'),
    'incomplete', (select count(*) from public.hr_training_enrollments e where e.status = 'INCOMPLETE'),
    'pendingTraining', (select count(*) from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id where e.status in ('NOT_STARTED', 'IN_PROGRESS') and not p.is_cancelled),
    'pendingReports', (select count(*) from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id
                         cross join generate_series(1, 3) d(n)
                        where not p.is_cancelled and p.start_date + (d.n - 1) <= v_today
                          and not exists (select 1 from public.hr_training_day_reports r where r.enrollment_id = e.id and r.day_no = d.n and r.attendance is not null)));
end $$;

create or replace function public.hr_training_programs_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date := private.hr_today();
begin
  if not (private.is_hr_staff() or exists (select 1 from public.hr_training_days d where d.trainer_id = private.my_id())) then
    raise exception 'FORBIDDEN: Only HR staff and trainers can use the training workspace.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.training_program_json(p, v_today) order by p.start_date desc, p.name)
                     from public.hr_training_programs p where private.training_can_view(p.id)), '[]'::jsonb);
end $$;

-- The employees that can be enrolled: active employees of the HR directory.
create or replace function public.hr_training_employees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('employeeKey', m.employee_key, 'name', m.full_name, 'department', m.department_name, 'code', m.employee_code,
                                    'designation', private.hr_designation(m.profile_id, m.hr_record_id)) order by m.full_name)
                     from private.hr_mail_employees() m where m.is_active), '[]'::jsonb);
end $$;

create or replace function private.training_enrollment_json(e public.hr_training_enrollments, p public.hr_training_programs, p_today date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'programId', e.program_id, 'program', p.name, 'startDate', p.start_date, 'endDate', p.start_date + 2,
    'employeeKey', e.employee_key, 'employeeName', e.employee_name, 'employeeCode', e.employee_code, 'department', e.department_name, 'designation', e.designation,
    'status', e.status, 'strengths', e.strengths, 'improvements', e.improvements, 'trainerRemarks', e.trainer_remarks,
    'consolidated', e.consolidated, 'consolidatedAt', e.consolidated_at,
    'days', (select jsonb_agg(jsonb_build_object('dayNo', g.n, 'date', p.start_date + (g.n - 1),
                'attendance', r.attendance, 'completed', coalesce(r.day_completed, false), 'reported', r.id is not null,
                'overdue', r.attendance is null and p.start_date + (g.n - 1) < p_today and not p.is_cancelled) order by g.n)
               from generate_series(1, 3) g(n) left join public.hr_training_day_reports r on r.enrollment_id = e.id and r.day_no = g.n))
$$;
revoke all on function private.training_enrollment_json(public.hr_training_enrollments, public.hr_training_programs, date) from public, anon, authenticated;

create or replace function public.hr_training_program_get(p_program uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  v_today date := private.hr_today();
begin
  select * into p from public.hr_training_programs where id = p_program;
  if p.id is null or not private.training_can_view(p.id) then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  return private.training_program_json(p, v_today) || jsonb_build_object('enrollments',
    coalesce((select jsonb_agg(private.training_enrollment_json(e, p, v_today) order by e.employee_name) from public.hr_training_enrollments e where e.program_id = p.id), '[]'::jsonb));
end $$;

-- One employee's training record in one program: the configuration of the three days and the report of each.
create or replace function public.hr_training_enrollment_get(p_enrollment uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  p public.hr_training_programs;
  v_today date := private.hr_today();
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment;
  select * into p from public.hr_training_programs where id = e.program_id;
  if e.id is null or not private.training_can_view(p.id) then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
  return private.training_enrollment_json(e, p, v_today) || jsonb_build_object(
    'programConfig', private.training_program_json(p, v_today),
    'canReport', jsonb_build_object('1', private.training_can_report(p.id, 1), '2', private.training_can_report(p.id, 2), '3', private.training_can_report(p.id, 3)),
    'reports', coalesce((select jsonb_agg(jsonb_build_object('dayNo', r.day_no, 'attendance', r.attendance, 'topicsCompleted', r.topics_completed, 'tasks', r.tasks, 'scores', r.scores,
                    'assessmentTotal', r.assessment_total, 'assessmentMax', r.assessment_max, 'assessmentResult', r.assessment_result, 'feedback', r.feedback,
                    'trainerRemarks', r.trainer_remarks, 'report', r.report, 'completed', r.day_completed, 'reportedAt', r.reported_at,
                    'reportedBy', (select a.full_name from public.profiles a where a.id = r.reported_by)) order by r.day_no)
                   from public.hr_training_day_reports r where r.enrollment_id = e.id), '[]'::jsonb),
    'preview', private.training_consolidated(e.id));
end $$;

-- Every training an employee attended (the history is never overwritten) - or all employees' records, newest first.
create or replace function public.hr_training_records(p_search text default null, p_status text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_today date := private.hr_today();
  v_total bigint;
begin
  perform private.hr_require_staff();
  if p_status is not null and p_status not in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE') then raise exception 'VALIDATION_ERROR: Unknown training status.' using errcode = 'P0001'; end if;
  select count(*) into v_total from public.hr_training_enrollments e
   where (v_q = '' or position(v_q in lower(e.employee_name)) > 0 or position(v_q in lower(coalesce(e.employee_code, ''))) > 0) and (p_status is null or e.status = p_status);
  return jsonb_build_object('total', v_total, 'items', coalesce((
    select jsonb_agg(private.training_enrollment_json(x.e, x.p, v_today) order by (x.p).start_date desc, (x.e).employee_name)
      from (select e, p from public.hr_training_enrollments e join public.hr_training_programs p on p.id = e.program_id
             where (v_q = '' or position(v_q in lower(e.employee_name)) > 0 or position(v_q in lower(coalesce(e.employee_code, ''))) > 0) and (p_status is null or e.status = p_status)
             order by p.start_date desc, e.employee_name limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------
create or replace function public.hr_training_program_save(p_id uuid, p_name text, p_description text, p_start date, p_owner uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  v_today date := private.hr_today();
  d integer;
  v_titles text[] := array['Initial Training', 'Practical Training', 'Final Training and Assessment'];
begin
  perform private.hr_require_staff();
  if length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the program name.' using errcode = 'P0001'; end if;
  if p_start is null or p_start < v_today - 366 or p_start > v_today + 730 then raise exception 'VALIDATION_ERROR: Enter a valid start date.' using errcode = 'P0001'; end if;
  if p_owner is not null and not exists (select 1 from public.profiles x join public.departments dep on dep.id = x.department_id where x.id = p_owner and dep.slug = 'hr' and x.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The responsible person must be an active HR employee.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.hr_training_programs (name, description, start_date, owner_id, created_by)
    values (btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_start, coalesce(p_owner, private.my_id()), private.my_id()) returning * into p;
    for d in 1..3 loop
      insert into public.hr_training_days (program_id, day_no, title) values (p.id, d, v_titles[d]);
    end loop;
    perform private.write_audit('TRAINING_PROGRAM_CREATED', 'hr_training_program', p.id, null, null, jsonb_build_object('name', p.name, 'start', p.start_date));
  else
    update public.hr_training_programs set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''), start_date = p_start, owner_id = coalesce(p_owner, owner_id)
     where id = p_id returning * into p;
    if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
    -- the three days follow the start date: re-check every enrollment against the new dates
    perform private.training_recompute(e.id) from public.hr_training_enrollments e where e.program_id = p.id;
  end if;
  return private.training_program_json(p, v_today);
end $$;

create or replace function public.hr_training_program_cancel(p_program uuid, p_cancel boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
begin
  perform private.hr_require_staff();
  update public.hr_training_programs set is_cancelled = coalesce(p_cancel, true) where id = p_program returning * into p;
  if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  perform private.training_recompute(e.id) from public.hr_training_enrollments e where e.program_id = p.id;
  return private.training_program_json(p, private.hr_today());
end $$;

create or replace function public.hr_training_day_save(
  p_program uuid, p_day integer, p_title text, p_topics jsonb, p_trainer_name text, p_trainer_id uuid, p_criteria jsonb, p_pass_percent integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  c jsonb;
begin
  perform private.hr_require_staff();
  select * into p from public.hr_training_programs where id = p_program;
  if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  if p_day not between 1 and 3 then raise exception 'VALIDATION_ERROR: A program has three days.' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_title, ''))) < 2 then raise exception 'VALIDATION_ERROR: Enter the title of the day.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_topics, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_topics, '[]'::jsonb)) > 30 then raise exception 'VALIDATION_ERROR: Topics must be a list of at most 30.' using errcode = 'P0001'; end if;
  if jsonb_typeof(coalesce(p_criteria, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_criteria, '[]'::jsonb)) > 20 then raise exception 'VALIDATION_ERROR: Assessment criteria must be a list of at most 20.' using errcode = 'P0001'; end if;
  for c in select * from jsonb_array_elements(coalesce(p_criteria, '[]'::jsonb)) loop
    if length(btrim(coalesce(c ->> 'name', ''))) < 1 or coalesce((c ->> 'max')::numeric, 0) <= 0 or (c ->> 'max')::numeric > 1000 then
      raise exception 'VALIDATION_ERROR: Every assessment criterion needs a name and a maximum score above 0.' using errcode = 'P0001';
    end if;
  end loop;
  if p_trainer_id is not null and not exists (select 1 from public.profiles x where x.id = p_trainer_id and x.status = 'ACTIVE') then
    raise exception 'VALIDATION_ERROR: The trainer must be an active CRM user.' using errcode = 'P0001';
  end if;
  update public.hr_training_days
     set title = btrim(p_title), topics = coalesce(p_topics, '[]'::jsonb), trainer_name = nullif(btrim(coalesce(p_trainer_name, '')), ''), trainer_id = p_trainer_id,
         criteria = coalesce(p_criteria, '[]'::jsonb), pass_percent = p_pass_percent
   where program_id = p.id and day_no = p_day;
  return private.training_program_json(p, private.hr_today());
end $$;

create or replace function public.hr_training_enroll(p_program uuid, p_employee_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  p public.hr_training_programs;
  m record;
  v_added integer := 0;
  v_missing text[] := '{}';
  k text;
begin
  perform private.hr_require_staff();
  select * into p from public.hr_training_programs where id = p_program;
  if p.id is null then raise exception 'NOT_FOUND: Training program not found.' using errcode = 'P0001'; end if;
  if p.is_cancelled then raise exception 'CONFLICT: This program is cancelled.' using errcode = 'P0001'; end if;
  if coalesce(array_length(p_employee_keys, 1), 0) = 0 then raise exception 'VALIDATION_ERROR: Choose at least one employee.' using errcode = 'P0001'; end if;
  foreach k in array p_employee_keys loop
    select * into m from private.hr_mail_employees() x where x.employee_key = k and x.is_active;
    if m.employee_key is null then v_missing := v_missing || k; continue; end if;
    insert into public.hr_training_enrollments (program_id, employee_key, profile_id, employee_name, employee_code, department_name, designation, enrolled_by)
    values (p.id, m.employee_key, m.profile_id, m.full_name, m.employee_code, m.department_name, private.hr_designation(m.profile_id, m.hr_record_id), private.my_id())
    on conflict (program_id, employee_key) do nothing;
    if found then v_added := v_added + 1; end if;
  end loop;
  perform private.write_audit('TRAINING_ENROLLED', 'hr_training_program', p.id, null, null, jsonb_build_object('added', v_added));
  return jsonb_build_object('added', v_added, 'skipped', coalesce(array_length(p_employee_keys, 1), 0) - v_added, 'unknown', to_jsonb(v_missing));
end $$;

-- Remove an enrollment made by mistake (only while nothing has been recorded for it).
create or replace function public.hr_training_unenroll(p_enrollment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.hr_require_staff();
  if exists (select 1 from public.hr_training_day_reports where enrollment_id = p_enrollment) then
    raise exception 'CONFLICT: Reports were already recorded for this employee, so the record is kept.' using errcode = 'P0001';
  end if;
  delete from public.hr_training_enrollments where id = p_enrollment;
  if not found then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
end $$;

-- Record (or correct) one day for one employee.
create or replace function public.hr_training_report_save(
  p_enrollment uuid, p_day integer, p_attendance text, p_topics_completed jsonb, p_tasks jsonb, p_scores jsonb, p_feedback text, p_trainer_remarks text, p_report text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
  p public.hr_training_programs;
  d public.hr_training_days;
  r public.hr_training_day_reports;
  s jsonb;
  v_topics jsonb := coalesce(p_topics_completed, '[]'::jsonb);
  v_tasks jsonb := coalesce(p_tasks, '[]'::jsonb);
  v_scores jsonb := '[]'::jsonb;
  v_total numeric;
  v_max numeric;
  v_result text;
  v_crit jsonb;
  v_status text;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
  select * into p from public.hr_training_programs where id = e.program_id;
  if not private.training_can_report(p.id, p_day) then raise exception 'FORBIDDEN: Only HR staff or the trainer of this day can record its report.' using errcode = '42501'; end if;
  if p.is_cancelled then raise exception 'CONFLICT: This program is cancelled.' using errcode = 'P0001'; end if;
  select * into d from public.hr_training_days where program_id = p.id and day_no = p_day;
  if d.id is null then raise exception 'VALIDATION_ERROR: A program has three days.' using errcode = 'P0001'; end if;
  if p_attendance is not null and p_attendance not in ('PRESENT', 'LATE', 'ABSENT', 'EXCUSED') then raise exception 'VALIDATION_ERROR: Choose the attendance.' using errcode = 'P0001'; end if;
  if private.training_day_date(p, p_day) > private.hr_today() then raise exception 'CONFLICT: Day % is on %: it cannot be reported before it takes place.', p_day, to_char(private.training_day_date(p, p_day), 'DD Mon YYYY') using errcode = 'P0001'; end if;
  if jsonb_typeof(v_topics) <> 'array' or jsonb_array_length(v_topics) > 30 then raise exception 'VALIDATION_ERROR: Topics must be a list.' using errcode = 'P0001'; end if;
  if jsonb_typeof(v_tasks) <> 'array' or jsonb_array_length(v_tasks) > 30 then raise exception 'VALIDATION_ERROR: Tasks must be a list.' using errcode = 'P0001'; end if;
  if p_attendance in ('ABSENT', 'EXCUSED') and (jsonb_array_length(v_topics) > 0 or exists (select 1 from jsonb_array_elements(v_tasks) t where (t ->> 'done')::boolean is true)) then
    raise exception 'VALIDATION_ERROR: An employee marked absent cannot have topics or tasks recorded as done.' using errcode = 'P0001';
  end if;

  -- scores are checked against the criteria configured for the day
  for s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    select c into v_crit from jsonb_array_elements(d.criteria) c where c ->> 'name' = s ->> 'criterion' limit 1;
    if v_crit is null then raise exception 'VALIDATION_ERROR: "%" is not an assessment criterion of this day.', s ->> 'criterion' using errcode = 'P0001'; end if;
    if (s ->> 'score') is null or (s ->> 'score')::numeric < 0 or (s ->> 'score')::numeric > (v_crit ->> 'max')::numeric then
      raise exception 'VALIDATION_ERROR: The score for "%" must be between 0 and %.', s ->> 'criterion', v_crit ->> 'max' using errcode = 'P0001';
    end if;
    v_scores := v_scores || jsonb_build_object('criterion', s ->> 'criterion', 'score', (s ->> 'score')::numeric, 'max', (v_crit ->> 'max')::numeric);
  end loop;
  if jsonb_array_length(v_scores) > 0 and p_attendance not in ('PRESENT', 'LATE') then
    raise exception 'VALIDATION_ERROR: Scores can only be recorded for an employee who attended.' using errcode = 'P0001';
  end if;
  select sum((x ->> 'score')::numeric), sum((x ->> 'max')::numeric) into v_total, v_max from jsonb_array_elements(v_scores) x;
  v_result := case when jsonb_array_length(v_scores) = 0 then null
                   when d.pass_percent is null then 'RECORDED'
                   when 100 * v_total / nullif(v_max, 0) >= d.pass_percent then 'PASS' else 'FAIL' end;

  insert into public.hr_training_day_reports (enrollment_id, day_no, attendance, topics_completed, tasks, scores, assessment_total, assessment_max, assessment_result,
                                              feedback, trainer_remarks, report, reported_by)
  values (e.id, p_day, p_attendance, v_topics, v_tasks, v_scores, v_total, v_max, v_result,
          left(nullif(btrim(coalesce(p_feedback, '')), ''), 2000), left(nullif(btrim(coalesce(p_trainer_remarks, '')), ''), 2000), left(nullif(btrim(coalesce(p_report, '')), ''), 4000), private.my_id())
  on conflict (enrollment_id, day_no) do update
     set attendance = excluded.attendance, topics_completed = excluded.topics_completed, tasks = excluded.tasks, scores = excluded.scores,
         assessment_total = excluded.assessment_total, assessment_max = excluded.assessment_max, assessment_result = excluded.assessment_result,
         feedback = excluded.feedback, trainer_remarks = excluded.trainer_remarks, report = excluded.report, reported_by = excluded.reported_by,
         reported_at = now(), updated_at = now()
  returning * into r;
  update public.hr_training_day_reports set day_completed = private.training_day_done(r) where id = r.id returning * into r;
  v_status := private.training_recompute(e.id);
  if v_status in ('COMPLETED', 'INCOMPLETE') then
    update public.hr_training_enrollments set consolidated = private.training_consolidated(e.id), consolidated_at = now() where id = e.id;
  end if;
  return jsonb_build_object('dayNo', r.day_no, 'completed', r.day_completed, 'status', v_status, 'assessmentResult', r.assessment_result);
end $$;

create or replace function public.hr_training_enrollment_review(p_enrollment uuid, p_strengths text, p_improvements text, p_remarks text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.hr_training_enrollments;
begin
  select * into e from public.hr_training_enrollments where id = p_enrollment for update;
  if e.id is null then raise exception 'NOT_FOUND: Training record not found.' using errcode = 'P0001'; end if;
  if not (private.is_hr_staff() or private.training_can_report(e.program_id, 3) or private.training_can_report(e.program_id, 1) or private.training_can_report(e.program_id, 2)) then
    raise exception 'FORBIDDEN: Only HR staff or a trainer of this program can write the review.' using errcode = '42501';
  end if;
  update public.hr_training_enrollments
     set strengths = left(nullif(btrim(coalesce(p_strengths, '')), ''), 2000), improvements = left(nullif(btrim(coalesce(p_improvements, '')), ''), 2000), trainer_remarks = left(nullif(btrim(coalesce(p_remarks, '')), ''), 2000)
   where id = e.id returning * into e;
  if e.status in ('COMPLETED', 'INCOMPLETE') then
    update public.hr_training_enrollments set consolidated = private.training_consolidated(e.id), consolidated_at = now() where id = e.id;
  end if;
  return jsonb_build_object('id', e.id, 'status', e.status);
end $$;

-- ---------------------------------------------------------------------------
-- The daily check (service role): statuses follow the calendar for programs that are over, the consolidated reports are made, and the
-- responsible HR employee is reminded of the day reports that are still missing (once per program and day).
-- ---------------------------------------------------------------------------
create or replace function public.hr_training_tick(p_today date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.hr_today());
  e record;
  p record;
  v_changed integer := 0;
  v_reports integer := 0;
  v_notified integer := 0;
  v_missing integer;
  v_status text;
begin
  if not pg_try_advisory_xact_lock(hashtext('hr_training_tick')) then return jsonb_build_object('skipped', 'Another run is in progress.'); end if;
  for e in select en.id, en.status, en.consolidated_at from public.hr_training_enrollments en join public.hr_training_programs pr on pr.id = en.program_id
            where pr.start_date + 2 >= v_today - 60 loop
    v_status := private.training_recompute(e.id, v_today);
    if v_status is distinct from e.status then v_changed := v_changed + 1; end if;
    -- the consolidated report once the training is over (completed or not)
    if v_status in ('COMPLETED', 'INCOMPLETE') and e.consolidated_at is null then
      update public.hr_training_enrollments set consolidated = private.training_consolidated(e.id), consolidated_at = now() where id = e.id;
      v_reports := v_reports + 1;
    end if;
  end loop;
  for p in select * from public.hr_training_programs where not is_cancelled and start_date <= v_today and start_date + 2 >= v_today - 7 loop
    select count(*) into v_missing from public.hr_training_enrollments en cross join generate_series(1, 3) d(n)
     where en.program_id = p.id and p.start_date + (d.n - 1) <= v_today
       and not exists (select 1 from public.hr_training_day_reports r where r.enrollment_id = en.id and r.day_no = d.n and r.attendance is not null);
    if v_missing > 0 and p.owner_id is not null then
      perform private.notify_once(p.owner_id, 'TRAINING_REPORTS_PENDING', format('Training reports pending: %s', p.name),
        format('%s day report(s) have no attendance recorded yet.', v_missing), 'hr_training_program', p.id, format('TRAINING_PENDING:%s:%s', p.id, v_today));
      v_notified := v_notified + 1;
    end if;
  end loop;
  return jsonb_build_object('day', v_today, 'statusesChanged', v_changed, 'consolidatedReports', v_reports, 'reminders', v_notified);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'hr_training_overview()', 'hr_training_programs_list()', 'hr_training_employees()', 'hr_training_program_get(uuid)', 'hr_training_enrollment_get(uuid)',
    'hr_training_records(text, text, integer, integer)', 'hr_training_program_save(uuid, text, text, date, uuid)', 'hr_training_program_cancel(uuid, boolean)',
    'hr_training_day_save(uuid, integer, text, jsonb, text, uuid, jsonb, integer)', 'hr_training_enroll(uuid, text[])', 'hr_training_unenroll(uuid)',
    'hr_training_report_save(uuid, integer, text, jsonb, jsonb, jsonb, text, text, text)', 'hr_training_enrollment_review(uuid, text, text, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.hr_training_tick(date) from public, anon, authenticated;
grant execute on function public.hr_training_tick(date) to service_role;

notify pgrst, 'reload schema';
