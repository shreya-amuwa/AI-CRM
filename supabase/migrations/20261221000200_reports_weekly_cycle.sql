-- =============================================================================
-- Reports: the WEEKLY management cycle.
--
--   Department Head compiles the week  ->  Operations Head approves (or asks for a revision)  ->  sent to HR  ->  HR reviews  ->  Superadmin
--
--  * The daily cycle (Team Member -> Team Lead -> Department Head) is unchanged. The weekly report of a department is a row in
--    work_report_packages (one per department and Monday-to-Sunday week). It holds the Department Head's summary (title, assigned and
--    completed task overview, remarks) and a statistics snapshot taken when it is submitted. It copies no daily report: the boxes are built
--    live from the individual reports.
--  * Statuses: DRAFT, COMPILING, PENDING_OPERATIONS_HEAD, REVISION_REQUIRED, APPROVED_BY_OPERATIONS_HEAD, SENT_TO_HR, HR_REVIEW_IN_PROGRESS,
--    HR_REVIEW_COMPLETED, SUBMITTED_TO_SUPERADMIN. An unapproved week never reaches HR: the HR functions only read SENT_TO_HR and later.
--  * Every step is kept in work_report_package_events (who, when, comment, revision). A revision keeps the earlier steps.
--  * HR staff can read the daily reports of a week the Operations Head approved (read only), so they can review each person.
--
-- Safe to run again. Run after 20261221000100_reports_standard_form.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The weekly package: statuses, summary, snapshot
-- ---------------------------------------------------------------------------
alter table public.work_report_packages
  add column if not exists title text check (length(title) <= 200),
  add column if not exists assigned_overview text check (length(assigned_overview) <= 2000),
  add column if not exists completed_overview text check (length(completed_overview) <= 2000),
  add column if not exists status text not null default 'PENDING_OPERATIONS_HEAD',
  add column if not exists revision integer not null default 1 check (revision >= 1),
  add column if not exists stats jsonb,
  add column if not exists oh_reviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists oh_reviewer_name text,
  add column if not exists oh_reviewed_at timestamptz,
  add column if not exists oh_comment text check (length(oh_comment) <= 2000),
  add column if not exists sent_to_hr_at timestamptz,
  add column if not exists hr_completed_at timestamptz;

alter table public.work_report_packages drop constraint if exists work_report_packages_status_check;
alter table public.work_report_packages add constraint work_report_packages_status_check check (status in (
  'DRAFT', 'COMPILING', 'PENDING_OPERATIONS_HEAD', 'REVISION_REQUIRED', 'APPROVED_BY_OPERATIONS_HEAD', 'SENT_TO_HR',
  'HR_REVIEW_IN_PROGRESS', 'HR_REVIEW_COMPLETED', 'SUBMITTED_TO_SUPERADMIN'));
create index if not exists work_report_packages_status_idx on public.work_report_packages (status, period_end desc);

create table if not exists public.work_report_package_events (
  id bigint generated always as identity primary key,
  package_id uuid not null references public.work_report_packages (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text not null,
  action text not null check (action in ('COMPILED', 'SAVED', 'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REVISION_REQUESTED', 'HR_STARTED', 'HR_COMPLETED', 'SUBMITTED_TO_SUPERADMIN')),
  from_status text,
  to_status text,
  comment text check (length(comment) <= 2000),
  revision integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists work_report_package_events_idx on public.work_report_package_events (package_id, id);
alter table public.work_report_package_events enable row level security;
revoke all on public.work_report_package_events from public, anon, authenticated;

create or replace function private.package_event(p_package uuid, p_action text, p_from text, p_to text, p_comment text, p_revision integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.work_report_package_events (package_id, actor_id, actor_name, action, from_status, to_status, comment, revision)
  select p_package, p.id, p.full_name, p_action, p_from, p_to, p_comment, p_revision from public.profiles p where p.id = auth.uid()
$$;
revoke all on function private.package_event(uuid, text, text, text, text, integer) from public, anon, authenticated;

-- The statuses from which a week is open to HR (the Operations Head approved it).
create or replace function private.package_hr_visible(p_status text)
returns boolean language sql immutable set search_path = '' as $$
  select p_status in ('SENT_TO_HR', 'HR_REVIEW_IN_PROGRESS', 'HR_REVIEW_COMPLETED', 'SUBMITTED_TO_SUPERADMIN')
$$;
revoke all on function private.package_hr_visible(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. HR staff
-- ---------------------------------------------------------------------------
-- An active member of the HR department (the Super Admin is not "HR staff" here: reviews are written by HR).
create or replace function private.is_hr_reviewer()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = auth.uid() and p.status = 'ACTIVE' and d.slug = 'hr' and p.role <> 'SUPER_ADMIN')
$$;
revoke all on function private.is_hr_reviewer() from public, anon;
grant execute on function private.is_hr_reviewer() to authenticated;

create or replace function private.hr_reviewer_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p join public.departments d on d.id = p.department_id
   where p.status = 'ACTIVE' and d.slug = 'hr' and p.role <> 'SUPER_ADMIN'
$$;
revoke all on function private.hr_reviewer_ids() from public, anon, authenticated;

create or replace function private.super_admin_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'
$$;
revoke all on function private.super_admin_ids() from public, anon, authenticated;

-- Is this day in a week the Operations Head approved for this department? (what HR may read)
create or replace function private.report_released_to_hr(p_department uuid, p_day date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_report_packages k
                  where k.department_id = p_department and p_day between k.period_start and k.period_end and private.package_hr_visible(k.status))
$$;
revoke all on function private.report_released_to_hr(uuid, date) from public, anon, authenticated;

-- Who may read a report:
--   the author; the Super Admin; the reviewer (any report that was submitted);
--   a Department Head (of that department and side): every submitted Team Lead and Team Member report of their teams (read only: the
--     Department Head can DECIDE on a Team Member report only once the Team Lead approved it, see report_review_stage);
--   an Operations Head of the department: every submitted report of the department's chain;
--   HR staff: the daily reports of a week the Operations Head approved (read only).
create or replace function private.can_view_report(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id = auth.uid()
      or private.report_level() = 'SUPER_ADMIN'
      or (r.status <> 'DRAFT' and (
            private.is_report_reviewer(r)
         or (r.kind in ('MEMBER', 'TEAM_LEAD') and private.head_covers(auth.uid(), r.department_id, r.team_id))
         or (private.report_level() = 'OPERATIONS_HEAD' and r.department_id in (select private.report_scope_departments()))
         or (private.is_hr_reviewer() and private.report_released_to_hr(r.department_id, r.report_date))))
$$;
revoke all on function private.can_view_report(public.work_reports) from public, anon, authenticated;

-- The Department Head's view of a Team Lead's box now includes the Team Member reports still waiting for the Team Lead (read only).
create or replace function private.team_lead_box(p_lead public.profiles, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.team_lead_box(p_lead, p_from, p_to, true)
$$;
revoke all on function private.team_lead_box(public.profiles, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The package as the screens read it
-- ---------------------------------------------------------------------------
create or replace function private.package_json(p public.work_report_packages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then jsonb_build_object('status', 'NOT_SUBMITTED')
    else jsonb_build_object('id', p.id, 'status', p.status, 'title', p.title, 'assignedOverview', p.assigned_overview, 'completedOverview', p.completed_overview,
      'note', p.note, 'revision', p.revision, 'submittedBy', p.submitted_by_name, 'submittedAt', p.submitted_at, 'periodType', p.period_type,
      'periodStart', p.period_start, 'periodEnd', p.period_end, 'stats', p.stats,
      'ohReviewer', p.oh_reviewer_name, 'ohReviewedAt', p.oh_reviewed_at, 'ohComment', p.oh_comment,
      'sentToHrAt', p.sent_to_hr_at, 'hrCompletedAt', p.hr_completed_at,
      'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'fromStatus', e.from_status,
                            'toStatus', e.to_status, 'comment', e.comment, 'revision', e.revision) order by e.id)
                           from public.work_report_package_events e where e.package_id = p.id), '[]'::jsonb)) end
$$;
revoke all on function private.package_json(public.work_report_packages) from public, anon, authenticated;

-- The signal the live screens listen to: the Operations Head and the Department Heads of the department, and HR and the Super Admin once
-- the week is open to them.
create or replace function private.tg_work_report_package_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.work_report_signals (recipient_id, report_id, event)
  select distinct u, null::uuid, 'PACKAGE'
    from (select x as u from private.report_reviewer_ids('DEPARTMENT_HEAD', new.department_id, null) x
          union
          select p.id from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = new.department_id
          union
          select h from private.hr_reviewer_ids() h where private.package_hr_visible(new.status)
          union
          select s from private.super_admin_ids() s where new.status in ('HR_REVIEW_COMPLETED', 'SUBMITTED_TO_SUPERADMIN')) s;
  return new;
end $$;
revoke all on function private.tg_work_report_package_signal() from public, anon, authenticated;

drop trigger if exists work_report_packages_signal on public.work_report_packages;
create trigger work_report_packages_signal after insert or update on public.work_report_packages
  for each row execute function private.tg_work_report_package_signal();

-- ---------------------------------------------------------------------------
-- 4. Department Head: compile, preview, save and submit the week
-- ---------------------------------------------------------------------------
create or replace function private.week_check(p_week_start date)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_week_start is null or extract(isodow from p_week_start) <> 1 then
    raise exception 'VALIDATION_ERROR: Choose a week (it starts on a Monday).' using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.week_check(date) from public, anon, authenticated;

-- The week of the Department Head's department: the saved package (if any), the statistics worked out live from the daily reports now,
-- and the day-by-day figures.
create or replace function public.work_reports_weekly(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  pk public.work_report_packages;
  v_to date := p_week_start + 6;
  v_days jsonb;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head prepares the weekly department report.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  select * into me from public.profiles where id = auth.uid();
  v_dept := private.base_department(me.department_id);
  select * into pk from public.work_report_packages where department_id = v_dept and period_start = p_week_start and period_end = v_to;
  select coalesce(jsonb_agg(jsonb_build_object('date', d.d, 'workingDay', d.working,
           'stats', case when d.d <= private.office_today() then private.report_scope_stats(v_dept, null, d.d, d.d) end) order by d.d), '[]'::jsonb) into v_days
    from (select g::date as d, exists (select 1 from public.report_settings s where s.working_days @> array[extract(isodow from g)::integer]) as working
            from generate_series(p_week_start, v_to, interval '1 day') g) d;
  return jsonb_build_object(
    'departmentId', v_dept, 'department', (select d.name from public.departments d where d.id = v_dept), 'departmentHead', me.full_name,
    'weekStart', p_week_start, 'weekEnd', v_to,
    'package', private.package_json(pk),
    'stats', private.report_scope_stats(v_dept, null, p_week_start, v_to),
    'days', v_days,
    'canEdit', pk.id is null or pk.status in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED'),
    'weeks', coalesce((select jsonb_agg(jsonb_build_object('weekStart', k.period_start, 'status', k.status) order by k.period_start desc)
                         from (select * from public.work_report_packages x where x.department_id = v_dept order by x.period_start desc limit 12) k), '[]'::jsonb));
end $$;
revoke all on function public.work_reports_weekly(date) from public, anon;
grant execute on function public.work_reports_weekly(date) to authenticated;

-- Save the week (p_submit false: a draft; the very first save without text only "compiles" it) or submit it to the Operations Head.
create or replace function public.work_report_weekly_save(
  p_week_start date, p_title text, p_assigned_overview text, p_completed_overview text, p_remarks text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  pk public.work_report_packages;
  v_to date := p_week_start + 6;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_status text;
  v_from text;
  v_action text;
  v_oh uuid;
  v_stats jsonb;
  v_empty boolean;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head prepares the weekly department report.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  if p_week_start > private.office_today() then
    raise exception 'VALIDATION_ERROR: The week has not started yet.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_title, '')) > 200 then
    raise exception 'VALIDATION_ERROR: Keep the title under 200 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(p_assigned_overview, '')) > 2000 or length(coalesce(p_completed_overview, '')) > 2000 or length(coalesce(p_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep each summary under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  v_dept := private.base_department(me.department_id);
  v_empty := v_title is null and nullif(btrim(coalesce(p_assigned_overview, '')), '') is null and nullif(btrim(coalesce(p_completed_overview, '')), '') is null
             and nullif(btrim(coalesce(p_remarks, '')), '') is null;
  if p_submit then
    if v_title is null or length(v_title) < 3 then
      raise exception 'VALIDATION_ERROR: Enter the weekly report title before submitting.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.report_reviewer_ids('DEPARTMENT_HEAD', v_dept, null)) then
      raise exception 'CONFLICT: No Operations Head manages this department yet. Ask the Super Admin to assign one.' using errcode = 'P0001';
    end if;
  end if;
  v_stats := private.report_scope_stats(v_dept, null, p_week_start, v_to);

  select * into pk from public.work_report_packages where department_id = v_dept and period_start = p_week_start and period_end = v_to for update;
  if pk.id is not null and pk.status not in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED') then
    raise exception 'CONFLICT: This week was already submitted.' using errcode = 'P0001';
  end if;
  v_from := pk.status;
  v_status := case when p_submit then 'PENDING_OPERATIONS_HEAD' when v_empty and (pk.id is null or pk.status = 'COMPILING') then 'COMPILING'
                   when pk.status = 'REVISION_REQUIRED' then 'REVISION_REQUIRED' else 'DRAFT' end;
  if pk.id is null then
    insert into public.work_report_packages (department_id, period_type, period_start, period_end, title, assigned_overview, completed_overview, note,
                                             status, stats, submitted_by, submitted_by_name, submitted_at)
    values (v_dept, 'WEEKLY', p_week_start, v_to, v_title, nullif(btrim(p_assigned_overview), ''), nullif(btrim(p_completed_overview), ''), nullif(btrim(p_remarks), ''),
            v_status, v_stats, me.id, me.full_name, now())
    returning * into pk;
    perform private.package_event(pk.id, case when v_status = 'COMPILING' then 'COMPILED' when p_submit then 'SUBMITTED' else 'SAVED' end, null, v_status, null, pk.revision);
  else
    update public.work_report_packages
       set title = v_title, assigned_overview = nullif(btrim(p_assigned_overview), ''), completed_overview = nullif(btrim(p_completed_overview), ''),
           note = nullif(btrim(p_remarks), ''), status = v_status, stats = v_stats, submitted_by = me.id, submitted_by_name = me.full_name,
           revision = case when p_submit and v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
           submitted_at = case when p_submit then now() else submitted_at end,
           oh_reviewer_id = case when p_submit then null else oh_reviewer_id end, oh_reviewer_name = case when p_submit then null else oh_reviewer_name end,
           oh_reviewed_at = case when p_submit then null else oh_reviewed_at end, oh_comment = case when p_submit then null else oh_comment end,
           updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, case when p_submit and v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' when p_submit then 'SUBMITTED' when v_status = 'COMPILING' then 'COMPILED' else 'SAVED' end,
                                  v_from, v_status, null, pk.revision);
  end if;
  if p_submit then
    v_action := case when v_from = 'REVISION_REQUIRED' then 'resubmitted' else 'submitted' end;
    for v_oh in select * from private.report_reviewer_ids('DEPARTMENT_HEAD', v_dept, null) loop
      perform private.notify(v_oh, 'REPORT_PACKAGE_SUBMITTED',
        format('Weekly department report: %s', (select d.name from public.departments d where d.id = v_dept)),
        format('%s %s the weekly report for %s to %s and it is waiting for your approval.', me.full_name, v_action, to_char(p_week_start, 'DD Mon'), to_char(v_to, 'DD Mon YYYY')),
        'work_report_package', pk.id);
    end loop;
    perform private.write_audit('WORK_REPORT_PACKAGE_' || upper(v_action), 'department', v_dept, v_dept, null,
      jsonb_build_object('from', p_week_start, 'to', v_to, 'revision', pk.revision));
  end if;
  return private.package_json(pk);
end $$;
revoke all on function public.work_report_weekly_save(date, text, text, text, text, boolean) from public, anon;
grant execute on function public.work_report_weekly_save(date, text, text, text, text, boolean) to authenticated;

-- The earlier "forward the package" call: a Monday-to-Sunday week is submitted as the weekly report; anything else is no longer a package.
create or replace function public.work_report_package_submit(p_from date, p_to date, p_period_type text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  -- who may send it is decided before anything about the request is looked at
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head forwards the department package.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <> p_from + 6 or extract(isodow from p_from) <> 1 then
    raise exception 'VALIDATION_ERROR: The department report is weekly: choose a week from Monday to Sunday.' using errcode = 'P0001';
  end if;
  return public.work_report_weekly_save(p_from, 'Weekly department report ' || to_char(p_from, 'DD Mon YYYY'), null, null, p_note, true);
end $$;
revoke all on function public.work_report_package_submit(date, date, text, text) from public, anon;
grant execute on function public.work_report_package_submit(date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Operations Head: the weekly board and the decision
-- ---------------------------------------------------------------------------
-- One box per department of the Operations Head (the Super Admin: all), for a week: the Department Head, the figures worked out from the
-- daily reports and the status of the weekly report.
create or replace function public.work_reports_weekly_board(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_to date := p_week_start + 6;
  v_rows jsonb;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the weekly department reports.' using errcode = '42501';
  end if;
  perform private.week_check(p_week_start);
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id),
      'stats', private.report_scope_stats(d.id, null, p_week_start, v_to),
      'package', private.package_json(pk)) as row_obj
      from public.departments d
      left join public.work_report_packages pk on pk.department_id = d.id and pk.period_start = p_week_start and pk.period_end = v_to
     where d.id in (select private.report_scope_departments())
  ) q;
  return jsonb_build_object('weekStart', p_week_start, 'weekEnd', v_to, 'departments', v_rows,
    'pendingApprovals', (select count(*) from public.work_report_packages k where k.status = 'PENDING_OPERATIONS_HEAD' and k.department_id in (select private.report_scope_departments())));
end $$;
revoke all on function public.work_reports_weekly_board(date) from public, anon;
grant execute on function public.work_reports_weekly_board(date) to authenticated;

-- The weekly reports waiting for the Operations Head (any week), newest first.
create or replace function public.work_reports_weekly_pending()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the weekly department reports.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('departmentId', d.id, 'department', d.name, 'package', private.package_json(k)) order by k.period_end desc, d.name)
      from public.work_report_packages k join public.departments d on d.id = k.department_id
     where k.status = 'PENDING_OPERATIONS_HEAD' and k.department_id in (select private.report_scope_departments())), '[]'::jsonb);
end $$;
revoke all on function public.work_reports_weekly_pending() from public, anon;
grant execute on function public.work_reports_weekly_pending() to authenticated;

-- Approve (it goes to HR) or ask the Department Head for a revision. The Operations Head's identity, comment and time are kept.
create or replace function public.work_report_weekly_review(p_package uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  pk public.work_report_packages;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_to uuid;
  v_dept_name text;
begin
  if private.report_level() <> 'OPERATIONS_HEAD' then
    raise exception 'FORBIDDEN: Only the Operations Head decides on the weekly department report.' using errcode = '42501';
  end if;
  if p_decision not in ('APPROVED', 'REVISION_REQUIRED') then
    raise exception 'VALIDATION_ERROR: Choose approve or request a revision.' using errcode = 'P0001';
  end if;
  if p_decision = 'REVISION_REQUIRED' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write a comment so the Department Head knows what to correct.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_comment, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep the comment under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into pk from public.work_report_packages where id = p_package for update;
  if pk.id is null or pk.department_id not in (select private.report_scope_departments()) then
    raise exception 'NOT_FOUND: Weekly report not found.' using errcode = 'P0001';
  end if;
  if pk.status <> 'PENDING_OPERATIONS_HEAD' then
    raise exception 'CONFLICT: This weekly report is not waiting for a decision.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select d.name into v_dept_name from public.departments d where d.id = pk.department_id;
  if p_decision = 'APPROVED' then
    -- approved: the statistics are taken again now, so HR reviews what the Operations Head approved
    update public.work_report_packages
       set status = 'SENT_TO_HR', oh_reviewer_id = me.id, oh_reviewer_name = me.full_name, oh_reviewed_at = now(), oh_comment = v_comment,
           sent_to_hr_at = now(), stats = private.report_scope_stats(pk.department_id, null, pk.period_start, pk.period_end), updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, 'APPROVED', 'PENDING_OPERATIONS_HEAD', 'SENT_TO_HR', v_comment, pk.revision);
    for v_to in select * from private.hr_reviewer_ids() loop
      perform private.notify(v_to, 'REPORT_WEEKLY_SENT_TO_HR', format('Weekly report ready for performance review: %s', v_dept_name),
        format('The Operations Head approved the weekly report for %s to %s. Review each Team Lead and Team Member.', to_char(pk.period_start, 'DD Mon'), to_char(pk.period_end, 'DD Mon YYYY')),
        'work_report_package', pk.id);
    end loop;
  else
    update public.work_report_packages
       set status = 'REVISION_REQUIRED', oh_reviewer_id = me.id, oh_reviewer_name = me.full_name, oh_reviewed_at = now(), oh_comment = v_comment, updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, 'REVISION_REQUESTED', 'PENDING_OPERATIONS_HEAD', 'REVISION_REQUIRED', v_comment, pk.revision);
  end if;
  -- the Department Head(s) who prepare the week
  for v_to in select p.id from public.profiles p where p.role = 'DEPARTMENT_HEAD' and not p.is_operations_head and p.status = 'ACTIVE'
                                                  and private.base_department(p.department_id) = pk.department_id loop
    perform private.notify(v_to, case p_decision when 'APPROVED' then 'REPORT_WEEKLY_APPROVED' else 'REPORT_WEEKLY_REVISION' end,
      case p_decision when 'APPROVED' then 'Weekly department report approved' else 'Revision requested on the weekly report' end,
      format('The Operations Head %s the weekly report for %s to %s.%s', case p_decision when 'APPROVED' then 'approved' else 'sent back' end,
             to_char(pk.period_start, 'DD Mon'), to_char(pk.period_end, 'DD Mon YYYY'), coalesce(' ' || left(v_comment, 300), '')),
      'work_report_package', pk.id);
  end loop;
  perform private.write_audit('WORK_REPORT_PACKAGE_' || p_decision, 'department', pk.department_id, pk.department_id, null,
    jsonb_build_object('from', pk.period_start, 'to', pk.period_end, 'revision', pk.revision, 'comment', left(v_comment, 300)));
  return private.package_json(pk);
end $$;
revoke all on function public.work_report_weekly_review(uuid, text, text) from public, anon;
grant execute on function public.work_report_weekly_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The department drill-down: reports are released to the Operations Head once the week is submitted
-- ---------------------------------------------------------------------------
create or replace function public.work_reports_operations_department(p_department uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  pk public.work_report_packages;
  v_released boolean;
  v_heads jsonb;
  v_leads jsonb;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_department not in (select private.report_scope_departments()) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select * into pk from public.work_report_packages where department_id = p_department and period_start = p_from and period_end = p_to;
  -- the Super Admin always reads; the Operations Head once the Department Head submitted the week
  v_released := (pk.id is not null and pk.status not in ('DRAFT', 'COMPILING')) or private.report_level() = 'SUPER_ADMIN';
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'designation', nullif(h."position", ''),
      'reports', case when v_released then coalesce((select jsonb_agg(private.report_json(r, true) order by r.report_date desc, r.submitted_at desc)
                         from public.work_reports r where r.kind = 'DEPARTMENT_HEAD' and r.author_id = h.id and r.status <> 'DRAFT'
                          and r.report_date between p_from and p_to), '[]'::jsonb) else '[]'::jsonb end) order by h.full_name), '[]'::jsonb) into v_heads
    from public.profiles h
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = p_department;
  select coalesce(jsonb_agg(
      case when v_released then private.team_lead_box(l, p_from, p_to, true)
           else private.team_lead_box(l, p_from, p_to, true) || jsonb_build_object('leadReports', '[]'::jsonb, 'memberReports', '[]'::jsonb) end order by l.full_name), '[]'::jsonb) into v_leads
    from public.profiles l
   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = p_department;
  return jsonb_build_object(
    'departmentId', p_department, 'department', (select d.name from public.departments d where d.id = p_department),
    'periodStart', p_from, 'periodEnd', p_to, 'package', private.package_json(pk), 'released', v_released,
    'stats', private.report_scope_stats(p_department, null, p_from, p_to),
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'periodType', x.period_type, 'periodStart', x.period_start, 'periodEnd', x.period_end,
                                                              'submittedAt', x.submitted_at, 'status', x.status) order by x.period_end desc, x.submitted_at desc)
                           from (select * from public.work_report_packages k where k.department_id = p_department and k.status not in ('DRAFT', 'COMPILING')
                                  order by k.period_end desc, k.submitted_at desc limit 10) x), '[]'::jsonb),
    'departmentHeads', v_heads, 'teamLeads', v_leads);
end $$;
revoke all on function public.work_reports_operations_department(uuid, date, date) from public, anon;
grant execute on function public.work_reports_operations_department(uuid, date, date) to authenticated;

-- The sidebar badge: the Operations Head also counts the weekly reports waiting for them
create or replace function public.work_reports_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_kind text := private.report_kind_of(private.report_level());
  me public.profiles;
  v_pending int := 0;
  v_member_pending int := 0;
  v_revision int := 0;
  v_weekly int := 0;
  v_to jsonb := '[]'::jsonb;
begin
  if v_level is null then
    raise exception 'FORBIDDEN: Reports are not available for this account.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  if v_kind is not null then
    select count(*) into v_revision from public.work_reports x where x.author_id = me.id and x.status = 'REVISION_REQUIRED';
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name) order by p.full_name), '[]'::jsonb) into v_to
      from public.profiles p where p.id in (select private.report_reviewer_ids(v_kind, private.base_department(me.department_id),
                                                case when v_kind = 'DEPARTMENT_HEAD' then null else me.team_id end));
  end if;
  if v_level = 'TEAM_LEAD' then
    select count(*) into v_pending from public.work_reports x where x.kind = 'MEMBER' and x.team_id = me.team_id and x.status in ('SUBMITTED', 'UNDER_REVIEW');
  elsif v_level = 'DEPARTMENT_HEAD' then
    select count(*) into v_pending from public.work_reports x where x.kind = 'TEAM_LEAD' and x.department_id = private.base_department(me.department_id)
       and x.status in ('SUBMITTED', 'UNDER_REVIEW') and private.head_covers(me.id, x.department_id, x.team_id);
    select count(*) into v_member_pending from public.work_reports x where x.kind = 'MEMBER' and x.department_id = private.base_department(me.department_id)
       and x.status = 'PENDING_DEPARTMENT_HEAD' and x.tl_status = 'APPROVED' and private.head_covers(me.id, x.department_id, x.team_id);
    -- a weekly report the Operations Head sent back
    select count(*) into v_weekly from public.work_report_packages k where k.department_id = private.base_department(me.department_id) and k.status = 'REVISION_REQUIRED';
  elsif v_level in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    select count(*) into v_pending from public.work_reports x where x.kind = 'DEPARTMENT_HEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')
       and x.department_id in (select private.report_scope_departments());
    select count(*) into v_weekly from public.work_report_packages k where k.status = 'PENDING_OPERATIONS_HEAD' and k.department_id in (select private.report_scope_departments());
  end if;
  return jsonb_build_object('level', v_level, 'canWrite', v_kind is not null, 'reportsTo', v_to,
    'pendingReview', v_pending + v_member_pending, 'pendingLeadReports', v_pending, 'pendingMemberApprovals', v_member_pending,
    'weeklyPending', v_weekly, 'needsRevision', v_revision, 'badge', v_pending + v_member_pending + v_revision + v_weekly,
    'team', (select t.name from public.teams t where t.id = me.team_id), 'name', me.full_name);
end $$;
revoke all on function public.work_reports_context() from public, anon;
grant execute on function public.work_reports_context() to authenticated;

notify pgrst, 'reload schema';
