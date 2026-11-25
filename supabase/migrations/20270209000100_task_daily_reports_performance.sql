-- =============================================================================
-- Task daily reports and performance approval (Team Member -> Team Lead -> Department Head).
-- Run after 20270208000200_meeting_oversight_notifications.sql. Safe to run twice; nothing is deleted, no column is changed, no existing function is replaced.
--
--  1. task_daily_reports: a Team Member reports on ONE assigned task for ONE day (work done, progress, pending work, reason for delay, remarks).
--     One report per task and date. Pending -> the Team Lead approves it or returns it for correction; the member corrects and resubmits (same row,
--     revision + 1). Every step is kept in task_daily_report_history (who, when, remarks) and in the audit log.
--  2. performance_records: the performance of a Team Member (reviewed by their Team Lead) or a Team Lead (reviewed by their Department Head) for a
--     period. The figures are CALCULATED from work_tasks and the approved task daily reports (never typed in) and refreshed whenever a task or a
--     report changes; a record is Pending, Approved or Returned for correction. An approved record keeps the figures that were approved.
--     performance_record_history keeps every approval, return and resubmission with the approver, the time and the remarks.
--  3. Functions (security definer; the caller is read from auth.uid(), the browser sends no role, team or reviewer):
--       task_reports_my_tasks, task_report_submit, task_report_review, task_reports_list, task_report_get,
--       performance_overview, performance_record_review, performance_record_resubmit, performance_record_history.
--
-- Isolation (the existing hierarchy, nothing new): a Team Member sees only their own tasks and reports; a Team Lead only the people they lead
-- (private.direct_lead_of); a Department Head only the department (and function) they cover (private.head_covers); the Super Admin reads everything.
-- International and Reseller need nothing special: their Team Leads and members are ordinary profiles of their own department.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.task_daily_reports (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.work_tasks (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  reviewer_id uuid references public.profiles (id) on delete set null,
  report_date date not null,
  work_completed text not null check (length(btrim(work_completed)) between 10 and 4000),
  progress integer not null check (progress between 0 and 100),
  pending_work text check (length(pending_work) <= 2000),
  delay_reason text check (length(delay_reason) <= 2000),
  remarks text check (length(remarks) <= 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RETURNED')),
  revision integer not null default 1 check (revision >= 1),
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_remarks text check (length(review_remarks) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint task_daily_reports_one_per_task_day unique (task_id, report_date)
);
create index if not exists task_daily_reports_author_idx on public.task_daily_reports (author_id, report_date desc);
create index if not exists task_daily_reports_dept_idx on public.task_daily_reports (department_id, status, report_date desc);
create index if not exists task_daily_reports_reviewer_idx on public.task_daily_reports (reviewer_id, status) where status = 'PENDING';
drop trigger if exists task_daily_reports_set_updated_at on public.task_daily_reports;
create trigger task_daily_reports_set_updated_at before update on public.task_daily_reports
  for each row execute function public.tg_set_updated_at();

create table if not exists public.task_daily_report_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.task_daily_reports (id) on delete cascade,
  action text not null check (action in ('SUBMITTED', 'APPROVED', 'RETURNED', 'RESUBMITTED')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  from_status text,
  to_status text not null,
  remarks text,
  revision integer not null,
  created_at timestamptz not null default now()
);
create index if not exists task_daily_report_history_idx on public.task_daily_report_history (report_id, id);

create table if not exists public.performance_records (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.profiles (id) on delete cascade,
  subject_role text not null check (subject_role in ('TEAM_MEMBER', 'TEAM_HEAD')),
  department_id uuid not null references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  period_start date not null,
  period_end date not null,
  metrics jsonb not null,
  score numeric(5, 1) check (score between 0 and 100),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'RETURNED')),
  version integer not null default 1,
  generated_at timestamptz not null default now(),
  refreshed_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_remarks text check (length(review_remarks) <= 2000),
  constraint performance_records_period check (period_end >= period_start and period_end - period_start <= 366),
  constraint performance_records_one_per_period unique (subject_id, period_start, period_end)
);
create index if not exists performance_records_dept_idx on public.performance_records (department_id, status, period_start desc);

create table if not exists public.performance_record_history (
  id bigint generated always as identity primary key,
  record_id uuid not null references public.performance_records (id) on delete cascade,
  action text not null check (action in ('GENERATED', 'REFRESHED', 'APPROVED', 'RETURNED', 'RESUBMITTED')),
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  from_status text,
  to_status text not null,
  score numeric(5, 1),
  remarks text,
  created_at timestamptz not null default now()
);
create index if not exists performance_record_history_idx on public.performance_record_history (record_id, id);

-- the histories are append-only for everybody who signs in
create or replace function private.tg_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- a signed-in user can never change a history row; a report or record that is deleted still removes its history (cascade, depth > 1)
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'CONFLICT: The history cannot be changed.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_append_only() from public, anon, authenticated;
drop trigger if exists task_daily_report_history_append_only on public.task_daily_report_history;
create trigger task_daily_report_history_append_only before update or delete on public.task_daily_report_history
  for each row execute function private.tg_append_only();
drop trigger if exists performance_record_history_append_only on public.performance_record_history;
create trigger performance_record_history_append_only before update or delete on public.performance_record_history
  for each row execute function private.tg_append_only();

-- ---------------------------------------------------------------------------
-- 2. Who may see / decide (the existing hierarchy)
-- ---------------------------------------------------------------------------
-- The reviewer of a Team Member's work: their Team Lead; a member without a Team Lead (AI Studio) is reviewed by the Department Head who covers them.
create or replace function private.tdr_reviews(p_author uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_id() is not null and p_author is distinct from auth.uid() and (
    private.direct_lead_of(p_author) = auth.uid()
    or (private.direct_lead_of(p_author) is null and private.head_covers(auth.uid(), p_department, p_team)))
$$;
revoke all on function private.tdr_reviews(uuid, uuid, uuid) from public, anon, authenticated;

-- The Department Head(s) that cover a department (and the team's function): who is told when there is no Team Lead to tell.
create or replace function private.tdr_heads(p_department uuid, p_team uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select h.id from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.head_covers(h.id, p_department, p_team)
$$;
revoke all on function private.tdr_heads(uuid, uuid) from public, anon, authenticated;

-- Reading: the author, their Team Lead, the Department Head covering the department, the Super Admin.
create or replace function private.tdr_can_view(p_author uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_id() is not null and (
    p_author = auth.uid() or private.my_role() = 'SUPER_ADMIN'
    or private.direct_lead_of(p_author) = auth.uid()
    or private.head_covers(auth.uid(), p_department, p_team))
$$;
revoke all on function private.tdr_can_view(uuid, uuid, uuid) from public, anon;
grant execute on function private.tdr_can_view(uuid, uuid, uuid) to authenticated, service_role;  -- used by the row level security policies

-- A performance record: a Team Lead's is read and decided by the Department Head; a Team Member's by their Team Lead (the Department Head reads it).
create or replace function private.perf2_can_decide(p_subject uuid, p_role text, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_id() is not null and p_subject is distinct from auth.uid() and case p_role
    when 'TEAM_HEAD' then private.head_covers(auth.uid(), p_department, p_team)
    else private.tdr_reviews(p_subject, p_department, p_team) end
$$;
revoke all on function private.perf2_can_decide(uuid, text, uuid, uuid) from public, anon, authenticated;

create or replace function private.perf2_can_view(p_subject uuid, p_role text, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.my_id() is not null and (
    p_subject = auth.uid() or private.my_role() = 'SUPER_ADMIN'
    or private.head_covers(auth.uid(), p_department, p_team)
    or (p_role = 'TEAM_MEMBER' and private.direct_lead_of(p_subject) = auth.uid()))
$$;
revoke all on function private.perf2_can_view(uuid, text, uuid, uuid) from public, anon;
grant execute on function private.perf2_can_view(uuid, text, uuid, uuid) to authenticated, service_role;  -- used by the row level security policies

alter table public.task_daily_reports enable row level security;
alter table public.task_daily_report_history enable row level security;
alter table public.performance_records enable row level security;
alter table public.performance_record_history enable row level security;
revoke all on public.task_daily_reports, public.task_daily_report_history, public.performance_records, public.performance_record_history from anon, authenticated;
grant select on public.task_daily_reports, public.task_daily_report_history, public.performance_records, public.performance_record_history to authenticated;

drop policy if exists task_daily_reports_select on public.task_daily_reports;
create policy task_daily_reports_select on public.task_daily_reports for select to authenticated
  using (private.tdr_can_view(author_id, department_id, team_id));
drop policy if exists task_daily_report_history_select on public.task_daily_report_history;
create policy task_daily_report_history_select on public.task_daily_report_history for select to authenticated
  using (exists (select 1 from public.task_daily_reports r where r.id = report_id and private.tdr_can_view(r.author_id, r.department_id, r.team_id)));
drop policy if exists performance_records_select on public.performance_records;
create policy performance_records_select on public.performance_records for select to authenticated
  using (private.perf2_can_view(subject_id, subject_role, department_id, team_id));
drop policy if exists performance_record_history_select on public.performance_record_history;
create policy performance_record_history_select on public.performance_record_history for select to authenticated
  using (exists (select 1 from public.performance_records r where r.id = record_id and private.perf2_can_view(r.subject_id, r.subject_role, r.department_id, r.team_id)));

-- ---------------------------------------------------------------------------
-- 3. Task daily reports
-- ---------------------------------------------------------------------------
create or replace function private.tdr_json(r public.task_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'taskId', r.task_id, 'taskTitle', t.title, 'taskStatus', t.status, 'taskPriority', t.priority, 'taskDueDate', t.due_date,
    'authorId', r.author_id, 'author', a.full_name, 'designation', a.position,
    'departmentId', r.department_id, 'teamId', r.team_id,
    'reviewerId', coalesce(r.reviewed_by, r.reviewer_id), 'reportDate', r.report_date,
    'workCompleted', r.work_completed, 'progress', r.progress, 'pendingWork', r.pending_work, 'delayReason', r.delay_reason, 'remarks', r.remarks,
    'status', r.status, 'revision', r.revision, 'submittedAt', r.submitted_at,
    'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewRemarks', r.review_remarks,
    'canReview', r.status = 'PENDING' and private.tdr_reviews(r.author_id, r.department_id, r.team_id),
    'canEdit', r.status = 'RETURNED' and r.author_id = auth.uid())
    from public.work_tasks t, public.profiles a where t.id = r.task_id and a.id = r.author_id
$$;
revoke all on function private.tdr_json(public.task_daily_reports) from public, anon, authenticated;

create or replace function private.tdr_event(p_report uuid, p_action text, p_from text, p_to text, p_remarks text, p_revision integer)
returns void language sql security definer set search_path = '' as $$
  insert into public.task_daily_report_history (report_id, action, actor_id, actor_name, from_status, to_status, remarks, revision)
  select p_report, p_action, p.id, p.full_name, p_from, p_to, p_remarks, p_revision from public.profiles p where p.id = auth.uid()
$$;
revoke all on function private.tdr_event(uuid, text, text, text, text, integer) from public, anon, authenticated;

-- The office day (India), the same day the other performance functions use.
create or replace function private.perf2_today()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function private.perf2_today() from public, anon, authenticated;

-- The caller's own tasks to report on: the open ones and the ones completed in the last 7 days.
create or replace function public.task_reports_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_role() is distinct from 'TEAM_MEMBER' then
    raise exception 'FORBIDDEN: Task daily reports are written by team members.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'dueDate', t.due_date,
             'progress', t.progress, 'description', t.description, 'assignedAt', t.created_at,
             'lastReportDate', (select max(r.report_date) from public.task_daily_reports r where r.task_id = t.id),
             'reportedToday', exists (select 1 from public.task_daily_reports r where r.task_id = t.id and r.report_date = private.perf2_today()))
           order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc)
      from public.work_tasks t
     where t.assignee_id = auth.uid() and t.status <> 'NOT_COMPLETED'
       and (t.status <> 'COMPLETED' or t.completed_at >= now() - interval '7 days')), '[]'::jsonb);
end $$;
revoke all on function public.task_reports_my_tasks() from public, anon;
grant execute on function public.task_reports_my_tasks() to authenticated;

-- Submit (or, after a return, correct and resubmit) the report of one task for one day.
create or replace function public.task_report_submit(
  p_task uuid, p_date date, p_work text, p_progress integer, p_pending text default null, p_delay text default null, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  r public.task_daily_reports;
  v_today date := private.perf2_today();
  v_date date := coalesce(p_date, private.perf2_today());
  v_work text := btrim(coalesce(p_work, ''));
  v_pending text := nullif(btrim(coalesce(p_pending, '')), '');
  v_delay text := nullif(btrim(coalesce(p_delay, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_lead uuid;
  v_action text := 'SUBMITTED';
  v_from text;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null or me.role <> 'TEAM_MEMBER' then
    raise exception 'FORBIDDEN: Task daily reports are written by team members.' using errcode = '42501';
  end if;
  select * into t from public.work_tasks where id = p_task;
  if t.id is null or t.assignee_id <> me.id then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if v_date > v_today then
    raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001';
  end if;
  if v_date < v_today - 7 then
    raise exception 'VALIDATION_ERROR: A daily report can be written for the last 7 days only.' using errcode = 'P0001';
  end if;
  if v_date < (t.created_at at time zone 'Asia/Kolkata')::date then
    raise exception 'VALIDATION_ERROR: The task was not assigned to you on that date.' using errcode = 'P0001';
  end if;
  if t.status = 'NOT_COMPLETED' or (t.status = 'COMPLETED' and t.completed_at is not null and (t.completed_at at time zone 'Asia/Kolkata')::date < v_date) then
    raise exception 'VALIDATION_ERROR: This task is already closed on that date.' using errcode = 'P0001';
  end if;
  if length(v_work) < 10 then
    raise exception 'VALIDATION_ERROR: Describe the work completed (at least 10 characters).' using errcode = 'P0001';
  end if;
  if length(v_work) > 4000 or length(coalesce(v_pending, '')) > 2000 or length(coalesce(v_delay, '')) > 2000 or length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: One of the fields is too long.' using errcode = 'P0001';
  end if;
  if p_progress is null or p_progress < 0 or p_progress > 100 then
    raise exception 'VALIDATION_ERROR: Progress must be between 0 and 100.' using errcode = 'P0001';
  end if;
  if p_progress < 100 and v_pending is null then
    raise exception 'VALIDATION_ERROR: Say what work is still pending (the task is not finished).' using errcode = 'P0001';
  end if;
  if p_progress < 100 and t.due_date is not null and t.due_date < v_date and v_delay is null then
    raise exception 'VALIDATION_ERROR: The task is past its deadline: give the reason for the delay.' using errcode = 'P0001';
  end if;

  select * into r from public.task_daily_reports where task_id = p_task and report_date = v_date for update;
  v_lead := private.direct_lead_of(me.id);
  if r.id is null then
    begin
      insert into public.task_daily_reports (task_id, author_id, department_id, team_id, reviewer_id, report_date, work_completed, progress, pending_work, delay_reason, remarks)
      values (t.id, me.id, me.department_id, me.team_id, v_lead, v_date, v_work, p_progress, v_pending, v_delay, v_remarks)
      returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: A report for this task and date already exists.' using errcode = 'P0001';
    end;
    perform private.tdr_event(r.id, 'SUBMITTED', null, 'PENDING', null, 1);
  elsif r.status = 'RETURNED' then
    v_from := r.status;
    update public.task_daily_reports set work_completed = v_work, progress = p_progress, pending_work = v_pending, delay_reason = v_delay, remarks = v_remarks,
           status = 'PENDING', revision = revision + 1, submitted_at = now(), reviewer_id = v_lead,
           reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_remarks = null
     where id = r.id returning * into r;
    v_action := 'RESUBMITTED';
    perform private.tdr_event(r.id, 'RESUBMITTED', v_from, 'PENDING', null, r.revision);
  elsif r.status = 'APPROVED' then
    raise exception 'CONFLICT: The report for this task and date was already approved.' using errcode = 'P0001';
  else
    raise exception 'CONFLICT: A report for this task and date is already waiting for approval.' using errcode = 'P0001';
  end if;

  perform private.write_audit('TASK_REPORT_' || v_action, 'task_daily_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('task', t.id, 'reportDate', v_date, 'progress', p_progress, 'revision', r.revision));
  if v_lead is not null then
    perform private.notify_once(v_lead, 'REPORT_TASK_SUBMITTED', format('Task report from %s', me.full_name),
      format('%s · %s%% on "%s"', to_char(v_date, 'DD Mon'), p_progress, t.title), 'task_daily_report', r.id);
  else
    perform private.notify_once(h, 'REPORT_TASK_SUBMITTED', format('Task report from %s', me.full_name),
      format('%s · %s%% on "%s"', to_char(v_date, 'DD Mon'), p_progress, t.title), 'task_daily_report', r.id)
      from private.tdr_heads(me.department_id, me.team_id) h;
  end if;
  perform private.perf2_touch(me.id, v_date);
  return private.tdr_json(r);
end $$;
revoke all on function public.task_report_submit(uuid, date, text, integer, text, text, text) from public, anon;
grant execute on function public.task_report_submit(uuid, date, text, integer, text, text, text) to authenticated;

-- The Team Lead approves or returns a report. A return needs a reason; the member corrects it and resubmits.
create or replace function public.task_report_review(p_report uuid, p_decision text, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.task_daily_reports;
  v_to text;
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  t_title text;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if upper(coalesce(p_decision, '')) not in ('APPROVE', 'RETURN') then
    raise exception 'VALIDATION_ERROR: Choose Approve or Return for correction.' using errcode = 'P0001';
  end if;
  select * into r from public.task_daily_reports where id = p_report for update;
  if r.id is null or not private.tdr_can_view(r.author_id, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if not private.tdr_reviews(r.author_id, r.department_id, r.team_id) then
    raise exception 'FORBIDDEN: Only the Team Lead of this team member can decide on this report.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This report was already decided (%).', lower(r.status) using errcode = 'P0001';
  end if;
  v_to := case when upper(p_decision) = 'APPROVE' then 'APPROVED' else 'RETURNED' end;
  if v_to = 'RETURNED' and length(coalesce(v_remarks, '')) < 5 then
    raise exception 'VALIDATION_ERROR: Say what must be corrected (at least 5 characters).' using errcode = 'P0001';
  end if;
  if length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The remarks are too long.' using errcode = 'P0001';
  end if;
  update public.task_daily_reports set status = v_to, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_remarks = v_remarks
   where id = r.id returning * into r;
  perform private.tdr_event(r.id, v_to, 'PENDING', v_to, v_remarks, r.revision);
  select title into t_title from public.work_tasks where id = r.task_id;
  perform private.write_audit('TASK_REPORT_' || v_to, 'task_daily_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('task', r.task_id, 'reportDate', r.report_date, 'revision', r.revision));
  perform private.notify(r.author_id, case when v_to = 'APPROVED' then 'REPORT_TASK_APPROVED' else 'REPORT_TASK_RETURNED' end,
    case when v_to = 'APPROVED' then 'Your task report was approved' else 'Your task report was returned for correction' end,
    format('"%s" · %s%s', t_title, to_char(r.report_date, 'DD Mon'), case when v_remarks is null then '' else ' · ' || left(v_remarks, 160) end),
    'task_daily_report', r.id, '{}'::jsonb, case when v_to = 'RETURNED' then 'urgent' else 'normal' end);
  perform private.perf2_touch(r.author_id, r.report_date);
  return private.tdr_json(r);
end $$;
revoke all on function public.task_report_review(uuid, text, text) from public, anon;
grant execute on function public.task_report_review(uuid, text, text) to authenticated;

-- The list: MINE (my own reports) or TEAM (everybody I am allowed to read, never my own).
create or replace function public.task_reports_list(
  p_scope text default 'MINE', p_status text default null, p_from date default null, p_to date default null,
  p_member uuid default null, p_task uuid default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_counts jsonb;
  v_items jsonb;
  v_total integer;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if p_scope not in ('MINE', 'TEAM') then
    raise exception 'VALIDATION_ERROR: Unknown list.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('PENDING', 'APPROVED', 'RETURNED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  with scoped as materialized (
    select r.id, r.status, r.report_date, r.submitted_at from public.task_daily_reports r
     where (case p_scope when 'MINE' then r.author_id = auth.uid() else r.author_id <> auth.uid() and private.tdr_can_view(r.author_id, r.department_id, r.team_id) end)
       and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
       and (p_member is null or r.author_id = p_member) and (p_task is null or r.task_id = p_task)),
  page as (select s.* from scoped s where p_status is null or s.status = p_status order by s.report_date desc, s.submitted_at desc limit v_limit offset v_offset)
  select jsonb_build_object('pending', count(*) filter (where s.status = 'PENDING'), 'approved', count(*) filter (where s.status = 'APPROVED'),
                            'returned', count(*) filter (where s.status = 'RETURNED'), 'total', count(*)),
         count(*) filter (where p_status is null or s.status = p_status),
         (select coalesce(jsonb_agg((select private.tdr_json(x) from public.task_daily_reports x where x.id = g.id) order by g.report_date desc, g.submitted_at desc), '[]'::jsonb) from page g)
    into v_counts, v_total, v_items from scoped s;
  return jsonb_build_object('counts', v_counts, 'total', v_total, 'items', v_items);
end $$;
revoke all on function public.task_reports_list(text, text, date, date, uuid, uuid, integer, integer) from public, anon;
grant execute on function public.task_reports_list(text, text, date, date, uuid, uuid, integer, integer) to authenticated;

create or replace function public.task_report_get(p_report uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.task_daily_reports;
begin
  select * into r from public.task_daily_reports where id = p_report;
  if r.id is null or not private.tdr_can_view(r.author_id, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  return private.tdr_json(r) || jsonb_build_object('history', coalesce((
    select jsonb_agg(jsonb_build_object('action', h.action, 'by', h.actor_name, 'at', h.created_at, 'from', h.from_status, 'to', h.to_status,
                                        'remarks', h.remarks, 'revision', h.revision) order by h.id)
      from public.task_daily_report_history h where h.report_id = r.id), '[]'::jsonb));
end $$;
revoke all on function public.task_report_get(uuid) from public, anon;
grant execute on function public.task_report_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Performance figures (calculated from the task and report records)
--
-- A task belongs to a period by its deadline (or, with none, the day it was assigned), as in Performance Management.
-- Every share is NULL ("insufficient data") when there is nothing to divide; nothing is estimated and nothing is typed in.
--
-- Team Member score (weights, re-balanced over the parts that have data):
--   task completion 35 · progress 15 (completed = 100, otherwise the latest APPROVED report's progress) · on-time completion 20 ·
--   report approval 15 (approved / (approved + returned)) · reporting consistency 15 (days with an approved report / working days with an open task)
-- Team Lead score:
--   own task completion 20 · team task completion 25 · team on-time completion 15 · report review 25 (reviewed / (reviewed + waiting more than a day)) ·
--   delegation 15 (tasks received that were handed to the team or taken on by the lead / tasks received)
-- ---------------------------------------------------------------------------
create or replace function private.perf2_pct(p_num numeric, p_den numeric)
returns numeric language sql immutable set search_path = '' as $$
  select case when p_den > 0 then round(100.0 * p_num / p_den, 1) end
$$;
revoke all on function private.perf2_pct(numeric, numeric) from public, anon, authenticated;

-- the weighted score of {key, label, value, weight} parts; parts without a value are left out and the weights re-balanced
create or replace function private.perf2_score(p_parts jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select case when sum((x ->> 'weight')::numeric) filter (where x ->> 'value' is not null) > 0
              then round(sum((x ->> 'value')::numeric * (x ->> 'weight')::numeric) filter (where x ->> 'value' is not null)
                         / sum((x ->> 'weight')::numeric) filter (where x ->> 'value' is not null), 1) end
    from jsonb_array_elements(p_parts) x
$$;
revoke all on function private.perf2_score(jsonb) from public, anon, authenticated;

create or replace function private.perf2_member(p_member uuid, p_start date, p_end date, p_today date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  k record;
  g record;
  v_expected integer;
  v_approved_days integer;
  v_parts jsonb;
  v_consistency numeric;
  v_approval numeric;
  v_progress numeric;
begin
  select count(*)::int as total,
         count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < p_today))::int as pending,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date <= t.due_date)::int as on_time,
         count(*) filter (where t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null and (t.completed_at at time zone v_tz)::date > t.due_date)::int as late,
         avg(case when t.status = 'COMPLETED' then 100
                  else coalesce((select r.progress from public.task_daily_reports r where r.task_id = t.id and r.status = 'APPROVED' and r.report_date <= p_end
                                  order by r.report_date desc, r.submitted_at desc limit 1), 0) end) as avg_progress
    into k
    from public.work_tasks t
   where t.assignee_id = p_member and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as submitted, count(*) filter (where r.status = 'APPROVED')::int as approved,
         count(*) filter (where r.status = 'RETURNED')::int as returned, count(*) filter (where r.status = 'PENDING')::int as pending,
         count(distinct r.report_date) filter (where r.status = 'APPROVED')::int as approved_days
    into g from public.task_daily_reports r where r.author_id = p_member and r.report_date between p_start and p_end;

  -- the working days (not Sunday, not after today) on which the person had a task open
  select count(*)::int into v_expected
    from generate_series(p_start::timestamp, least(p_end, p_today)::timestamp, interval '1 day') d(day)
   where extract(dow from d.day) <> 0 and exists (
     select 1 from public.work_tasks t where t.assignee_id = p_member and (t.created_at at time zone v_tz)::date <= d.day::date
        and (t.status in ('ASSIGNED', 'IN_PROGRESS', 'BLOCKED') or (t.status = 'COMPLETED' and (t.completed_at at time zone v_tz)::date >= d.day::date)));
  v_approved_days := g.approved_days;
  v_consistency := case when v_expected > 0 then least(100, private.perf2_pct(v_approved_days, v_expected)) end;
  v_approval := private.perf2_pct(g.approved, g.approved + g.returned);
  v_progress := case when k.total > 0 then round(k.avg_progress, 1) end;

  v_parts := jsonb_build_array(
    jsonb_build_object('key', 'completion', 'label', 'Task completion', 'weight', 35, 'value', private.perf2_pct(k.completed, k.total)),
    jsonb_build_object('key', 'progress', 'label', 'Progress (approved reports)', 'weight', 15, 'value', v_progress),
    jsonb_build_object('key', 'onTime', 'label', 'On-time completion', 'weight', 20, 'value', private.perf2_pct(k.on_time, k.on_time + k.late)),
    jsonb_build_object('key', 'reportApproval', 'label', 'Reports approved', 'weight', 15, 'value', v_approval),
    jsonb_build_object('key', 'consistency', 'label', 'Reporting consistency', 'weight', 15, 'value', v_consistency));
  return jsonb_build_object(
    'tasks', jsonb_build_object('total', k.total, 'completed', k.completed, 'pending', k.pending, 'overdue', k.overdue, 'onTime', k.on_time, 'late', k.late),
    'completionPct', private.perf2_pct(k.completed, k.total), 'onTimePct', private.perf2_pct(k.on_time, k.on_time + k.late), 'progressPct', v_progress,
    'reports', jsonb_build_object('submitted', g.submitted, 'approved', g.approved, 'returned', g.returned, 'pending', g.pending,
        'approvalPct', v_approval, 'expectedDays', v_expected, 'approvedDays', v_approved_days, 'consistencyPct', v_consistency),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_member(uuid, date, date, date) from public, anon, authenticated;

-- A Team Lead: their own tasks, the team (the members' figures passed in), the reviews they did and how they handed the work down.
create or replace function private.perf2_lead(p_lead uuid, p_start date, p_end date, p_today date, p_members jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  own record;
  mg record;
  rv record;
  tm record;
  v_parts jsonb;
begin
  select count(*)::int as total, count(*) filter (where t.status = 'COMPLETED')::int as completed,
         count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < p_today)::int as overdue,
         count(*) filter (where t.handling = 'SELF' or exists (select 1 from public.work_tasks c where c.parent_id = t.id))::int as handled,
         count(*) filter (where exists (select 1 from public.work_tasks c where c.parent_id = t.id))::int as delegated
    into own from public.work_tasks t
   where t.assignee_id = p_lead and coalesce(t.due_date, (t.created_at at time zone v_tz)::date) between p_start and p_end;

  select count(*)::int as assigned into mg from public.work_tasks t join public.profiles m on m.id = t.assignee_id and m.role = 'TEAM_MEMBER'
   where t.assigned_by = p_lead and (t.created_at at time zone v_tz)::date between p_start and p_end;

  -- the team's reports (reviews of the members the lead leads)
  select count(*)::int as submitted, count(*) filter (where r.status = 'APPROVED')::int as approved, count(*) filter (where r.status = 'RETURNED')::int as returned,
         count(*) filter (where r.status = 'PENDING')::int as pending,
         count(*) filter (where r.status = 'PENDING' and r.submitted_at < now() - interval '1 day')::int as waiting,
         round(avg(extract(epoch from r.reviewed_at - r.submitted_at) / 3600) filter (where r.reviewed_at is not null)::numeric, 1) as avg_hours
    into rv from public.task_daily_reports r
   where r.report_date between p_start and p_end and private.direct_lead_of(r.author_id) = p_lead;

  select coalesce(sum((m ->> 'total')::int), 0)::int as total, coalesce(sum((m ->> 'completed')::int), 0)::int as completed,
         coalesce(sum((m ->> 'pending')::int), 0)::int as pending, coalesce(sum((m ->> 'overdue')::int), 0)::int as overdue,
         coalesce(sum((m ->> 'onTime')::int), 0)::int as on_time, coalesce(sum((m ->> 'late')::int), 0)::int as late,
         count(*)::int as members, round(avg((m ->> 'progress')::numeric) filter (where m ->> 'progress' is not null), 1) as progress
    into tm from (select (x -> 'tasks') || jsonb_build_object('progress', x -> 'progressPct') as m from jsonb_array_elements(p_members) x) q;

  v_parts := jsonb_build_array(
    jsonb_build_object('key', 'ownCompletion', 'label', 'Own task completion', 'weight', 20, 'value', private.perf2_pct(own.completed, own.total)),
    jsonb_build_object('key', 'teamCompletion', 'label', 'Team task completion', 'weight', 25, 'value', private.perf2_pct(tm.completed, tm.total)),
    jsonb_build_object('key', 'teamOnTime', 'label', 'Team on-time completion', 'weight', 15, 'value', private.perf2_pct(tm.on_time, tm.on_time + tm.late)),
    jsonb_build_object('key', 'reviews', 'label', 'Reports reviewed', 'weight', 25, 'value', private.perf2_pct(rv.approved + rv.returned, rv.approved + rv.returned + rv.waiting)),
    jsonb_build_object('key', 'delegation', 'label', 'Work handed down', 'weight', 15, 'value', private.perf2_pct(own.handled, own.total)));
  return jsonb_build_object(
    'own', jsonb_build_object('total', own.total, 'completed', own.completed, 'overdue', own.overdue, 'completionPct', private.perf2_pct(own.completed, own.total)),
    'team', jsonb_build_object('members', tm.members, 'total', tm.total, 'completed', tm.completed, 'pending', tm.pending, 'overdue', tm.overdue,
        'onTime', tm.on_time, 'late', tm.late, 'completionPct', private.perf2_pct(tm.completed, tm.total),
        'onTimePct', private.perf2_pct(tm.on_time, tm.on_time + tm.late), 'progressPct', tm.progress),
    'reports', jsonb_build_object('submitted', rv.submitted, 'approved', rv.approved, 'returned', rv.returned, 'pending', rv.pending, 'waitingOverOneDay', rv.waiting,
        'reviewedPct', private.perf2_pct(rv.approved + rv.returned, rv.submitted), 'avgReviewHours', rv.avg_hours),
    'management', jsonb_build_object('tasksAssignedToTeam', mg.assigned, 'tasksReceived', own.total, 'handedDown', own.delegated, 'handledOrDelegated', own.handled,
        'delegationPct', private.perf2_pct(own.handled, own.total)),
    'parts', v_parts, 'score', private.perf2_score(v_parts));
end $$;
revoke all on function private.perf2_lead(uuid, date, date, date, jsonb) from public, anon, authenticated;

-- A record has data worth keeping when the person had tasks or reports in the period.
create or replace function private.perf2_has_data(p_role text, p_metrics jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select case when p_role = 'TEAM_HEAD'
              then coalesce((p_metrics #>> '{own,total}')::int, 0) + coalesce((p_metrics #>> '{team,total}')::int, 0) + coalesce((p_metrics #>> '{reports,submitted}')::int, 0) > 0
              else coalesce((p_metrics #>> '{tasks,total}')::int, 0) + coalesce((p_metrics #>> '{reports,submitted}')::int, 0) > 0 end
$$;
revoke all on function private.perf2_has_data(text, jsonb) from public, anon, authenticated;

-- Stores the figures of one person for a period. A new record is Pending; a Pending or Returned one follows the data (a new version only when a figure
-- changed); an Approved one keeps the figures that were approved. Returns the record.
create or replace function private.perf2_store(p_subject public.profiles, p_start date, p_end date, p_metrics jsonb)
returns public.performance_records language plpgsql security definer set search_path = '' as $$
declare
  r public.performance_records;
  v_score numeric := (p_metrics ->> 'score')::numeric;
begin
  select * into r from public.performance_records where subject_id = p_subject.id and period_start = p_start and period_end = p_end for update;
  if r.id is null then
    begin
      insert into public.performance_records (subject_id, subject_role, department_id, team_id, period_start, period_end, metrics, score)
      values (p_subject.id, p_subject.role::text, p_subject.department_id, p_subject.team_id, p_start, p_end, p_metrics, v_score)
      returning * into r;
    exception when unique_violation then
      select * into r from public.performance_records where subject_id = p_subject.id and period_start = p_start and period_end = p_end;
      return r;
    end;
    insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score)
    select r.id, 'GENERATED', p.id, p.full_name, null, 'PENDING', v_score from public.profiles p where p.id = auth.uid();
    perform private.write_audit('PERFORMANCE_RECORD_CREATED', 'performance_record', r.id, r.department_id, r.team_id,
      jsonb_build_object('subject', r.subject_id, 'periodStart', p_start, 'periodEnd', p_end, 'score', v_score));
  elsif r.status <> 'APPROVED' and r.metrics is distinct from p_metrics then
    update public.performance_records set metrics = p_metrics, score = v_score, version = version + 1, refreshed_at = now(),
           team_id = p_subject.team_id where id = r.id returning * into r;
    insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score)
    select r.id, 'REFRESHED', p.id, p.full_name, r.status, r.status, v_score from public.profiles p where p.id = auth.uid();
    perform private.write_audit('PERFORMANCE_RECORD_UPDATED', 'performance_record', r.id, r.department_id, r.team_id,
      jsonb_build_object('subject', r.subject_id, 'score', v_score, 'version', r.version));
  end if;
  return r;
end $$;
revoke all on function private.perf2_store(public.profiles, date, date, jsonb) from public, anon, authenticated;

-- The members a Team Lead leads (the existing resolver).
create or replace function private.perf2_members_of(p_lead uuid)
returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select m.* from public.profiles m where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and private.direct_lead_of(m.id) = p_lead
$$;
revoke all on function private.perf2_members_of(uuid) from public, anon, authenticated;

-- A task or a report changed: the Pending / Returned records that cover that day (the person's, and their Team Lead's) follow it.
create or replace function private.perf2_touch(p_member uuid, p_day date)
returns void language plpgsql security definer set search_path = '' as $$
declare
  rec public.performance_records;
  s public.profiles;
  v_today date := private.perf2_today();
  v_members jsonb;
begin
  for rec in
    select r.* from public.performance_records r
     where r.status <> 'APPROVED' and p_day between r.period_start and r.period_end
       and (r.subject_id = p_member or (r.subject_role = 'TEAM_HEAD' and r.subject_id = private.direct_lead_of(p_member)))
  loop
    select * into s from public.profiles where id = rec.subject_id;
    if s.id is null then continue; end if;
    if rec.subject_role = 'TEAM_MEMBER' then
      perform private.perf2_store(s, rec.period_start, rec.period_end, private.perf2_member(s.id, rec.period_start, rec.period_end, v_today));
    else
      select coalesce(jsonb_agg(private.perf2_member(m.id, rec.period_start, rec.period_end, v_today)), '[]'::jsonb) into v_members from private.perf2_members_of(s.id) m;
      perform private.perf2_store(s, rec.period_start, rec.period_end, private.perf2_lead(s.id, rec.period_start, rec.period_end, v_today, v_members));
    end if;
  end loop;
end $$;
revoke all on function private.perf2_touch(uuid, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The performance overview of the caller (one function for every role)
-- ---------------------------------------------------------------------------
create or replace function private.perf2_record_json(r public.performance_records)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'status', r.status, 'version', r.version, 'score', r.score, 'generatedAt', r.generated_at, 'refreshedAt', r.refreshed_at,
    'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewRemarks', r.review_remarks,
    'canDecide', r.status = 'PENDING' and private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id),
    'canResubmit', r.status = 'RETURNED' and r.subject_id = auth.uid()) end
$$;
revoke all on function private.perf2_record_json(public.performance_records) from public, anon, authenticated;

-- one person: profile, live figures and the record (the record is created when there is data)
create or replace function private.perf2_person(p_subject public.profiles, p_start date, p_end date, p_today date, p_members jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_metrics jsonb;
  r public.performance_records;
begin
  v_metrics := case when p_subject.role = 'TEAM_HEAD' then private.perf2_lead(p_subject.id, p_start, p_end, p_today, coalesce(p_members, '[]'::jsonb))
                    else private.perf2_member(p_subject.id, p_start, p_end, p_today) end;
  if private.perf2_has_data(p_subject.role::text, v_metrics) then
    r := private.perf2_store(p_subject, p_start, p_end, v_metrics);
  else
    select * into r from public.performance_records where subject_id = p_subject.id and period_start = p_start and period_end = p_end;
  end if;
  return jsonb_build_object('id', p_subject.id, 'name', p_subject.full_name, 'designation', p_subject.position, 'role', p_subject.role,
    'teamId', p_subject.team_id, 'team', (select t.name from public.teams t where t.id = p_subject.team_id),
    'metrics', v_metrics, 'liveScore', v_metrics -> 'score', 'record', private.perf2_record_json(r));
end $$;
revoke all on function private.perf2_person(public.profiles, date, date, date, jsonb) from public, anon, authenticated;

create or replace function public.performance_overview(p_start date, p_end date, p_department uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_today date := private.perf2_today();
  v_dept uuid;
  v_dept_name text;
  lead public.profiles;
  m public.profiles;
  v_people jsonb;
  v_members jsonb;
  v_member_metrics jsonb;
  v_leads jsonb := '[]'::jsonb;
  v_unled jsonb := '[]'::jsonb;
  v_summary jsonb;
  v_lead_json jsonb;
  v_me jsonb;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null or me.role not in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Performance is not available for your role.' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most one year.' using errcode = 'P0001';
  end if;

  if me.role = 'TEAM_MEMBER' then
    return jsonb_build_object('role', 'TEAM_MEMBER', 'periodStart', p_start, 'periodEnd', p_end, 'today', v_today,
                              'me', private.perf2_person(me, p_start, p_end, v_today));
  end if;

  if me.role = 'TEAM_HEAD' then
    v_members := '[]'::jsonb; v_member_metrics := '[]'::jsonb;
    for m in select * from private.perf2_members_of(me.id) order by full_name loop
      v_people := private.perf2_person(m, p_start, p_end, v_today);
      v_members := v_members || jsonb_build_array(v_people);
      v_member_metrics := v_member_metrics || jsonb_build_array(v_people -> 'metrics');
    end loop;
    v_me := private.perf2_person(me, p_start, p_end, v_today, v_member_metrics);
    return jsonb_build_object('role', 'TEAM_HEAD', 'periodStart', p_start, 'periodEnd', p_end, 'today', v_today, 'me', v_me, 'members', v_members,
      'pendingReports', (select count(*) from public.task_daily_reports r where r.status = 'PENDING' and private.direct_lead_of(r.author_id) = me.id),
      'pendingRecords', (select count(*) from jsonb_array_elements(v_members) x where x #>> '{record,status}' = 'PENDING'));
  end if;

  -- Department Head (own department) or Super Admin (the department asked for)
  if me.role = 'SUPER_ADMIN' then
    if p_department is null then
      raise exception 'VALIDATION_ERROR: Choose a department.' using errcode = 'P0001';
    end if;
    v_dept := p_department;
  else
    v_dept := me.department_id;
  end if;
  select name into v_dept_name from public.departments where id = v_dept;
  if v_dept_name is null then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;

  for lead in select * from public.profiles l where l.department_id = v_dept and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'
                 and (me.role = 'SUPER_ADMIN' or private.head_covers(me.id, l.department_id, l.team_id)) order by l.full_name loop
    v_members := '[]'::jsonb; v_member_metrics := '[]'::jsonb;
    for m in select * from private.perf2_members_of(lead.id) order by full_name loop
      v_people := private.perf2_person(m, p_start, p_end, v_today);
      v_members := v_members || jsonb_build_array(v_people);
      v_member_metrics := v_member_metrics || jsonb_build_array(v_people -> 'metrics');
    end loop;
    v_lead_json := private.perf2_person(lead, p_start, p_end, v_today, v_member_metrics);
    v_leads := v_leads || jsonb_build_array(v_lead_json || jsonb_build_object('members', v_members));
  end loop;
  -- members nobody leads (a Department Head covers them directly)
  for m in select * from public.profiles x where x.department_id = v_dept and x.role = 'TEAM_MEMBER' and x.status = 'ACTIVE' and private.direct_lead_of(x.id) is null
              and (me.role = 'SUPER_ADMIN' or private.head_covers(me.id, x.department_id, x.team_id)) order by x.full_name loop
    v_unled := v_unled || jsonb_build_array(private.perf2_person(m, p_start, p_end, v_today));
  end loop;

  -- the department, every task counted once (a task a Team Lead split is counted through the parts)
  select jsonb_build_object(
      'total', count(*), 'completed', count(*) filter (where t.status = 'COMPLETED'),
      'pending', count(*) filter (where t.status <> 'COMPLETED' and not (t.due_date is not null and t.due_date < v_today)),
      'overdue', count(*) filter (where t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < v_today),
      'completionPct', private.perf2_pct(count(*) filter (where t.status = 'COMPLETED'), count(*)))
    into v_summary
    from public.work_tasks t
   where t.department_id = v_dept and not exists (select 1 from public.work_tasks c where c.parent_id = t.id)
     and coalesce(t.due_date, (t.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end
     and (me.role = 'SUPER_ADMIN' or private.head_covers(me.id, t.department_id, t.team_id));

  return jsonb_build_object('role', me.role, 'periodStart', p_start, 'periodEnd', p_end, 'today', v_today,
    'department', jsonb_build_object('id', v_dept, 'name', v_dept_name),
    'tasks', v_summary,
    'reports', (select jsonb_build_object('submitted', count(*), 'approved', count(*) filter (where r.status = 'APPROVED'),
                  'returned', count(*) filter (where r.status = 'RETURNED'), 'pending', count(*) filter (where r.status = 'PENDING'),
                  'approvedPct', private.perf2_pct(count(*) filter (where r.status = 'APPROVED'), count(*)))
                 from public.task_daily_reports r where r.department_id = v_dept and r.report_date between p_start and p_end
                  and private.tdr_can_view(r.author_id, r.department_id, r.team_id)),
    'leads', v_leads, 'unassignedMembers', v_unled,
    'pendingRecords', (select count(*) from jsonb_array_elements(v_leads) x where x #>> '{record,status}' = 'PENDING'));
end $$;
revoke all on function public.performance_overview(date, date, uuid) from public, anon;
grant execute on function public.performance_overview(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Approval of a performance record
-- ---------------------------------------------------------------------------
create or replace function public.performance_record_review(p_record uuid, p_decision text, p_remarks text default null, p_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.performance_records;
  v_to text;
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if upper(coalesce(p_decision, '')) not in ('APPROVE', 'RETURN') then
    raise exception 'VALIDATION_ERROR: Choose Approve or Return for correction.' using errcode = 'P0001';
  end if;
  select * into r from public.performance_records where id = p_record for update;
  if r.id is null or not private.perf2_can_view(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Performance record not found.' using errcode = 'P0001';
  end if;
  if not private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'FORBIDDEN: %', case when r.subject_role = 'TEAM_HEAD' then 'Only the Department Head approves a Team Lead''s performance.'
                                         else 'Only the Team Lead approves a team member''s performance.' end using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This performance record was already decided (%).', lower(r.status) using errcode = 'P0001';
  end if;
  if p_version is not null and p_version <> r.version then
    raise exception 'CONFLICT: The figures changed after you opened them. Reload and review again.' using errcode = 'P0001';
  end if;
  v_to := case when upper(p_decision) = 'APPROVE' then 'APPROVED' else 'RETURNED' end;
  if v_to = 'RETURNED' and length(coalesce(v_remarks, '')) < 5 then
    raise exception 'VALIDATION_ERROR: Say what must be corrected (at least 5 characters).' using errcode = 'P0001';
  end if;
  if length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The remarks are too long.' using errcode = 'P0001';
  end if;
  update public.performance_records set status = v_to, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_remarks = v_remarks
   where id = r.id returning * into r;
  insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score, remarks)
  values (r.id, v_to, me.id, me.full_name, 'PENDING', v_to, r.score, v_remarks);
  perform private.write_audit('PERFORMANCE_RECORD_' || v_to, 'performance_record', r.id, r.department_id, r.team_id,
    jsonb_build_object('subject', r.subject_id, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'score', r.score));
  perform private.notify(r.subject_id, 'REPORT_PERFORMANCE_' || v_to,
    case when v_to = 'APPROVED' then 'Your performance was approved' else 'Your performance was returned for correction' end,
    format('%s to %s%s', to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY'), case when v_remarks is null then '' else ' · ' || left(v_remarks, 160) end),
    'performance_record', r.id, '{}'::jsonb, case when v_to = 'RETURNED' then 'urgent' else 'normal' end);
  return private.perf2_record_json(r);
end $$;
revoke all on function public.performance_record_review(uuid, text, text, integer) from public, anon;
grant execute on function public.performance_record_review(uuid, text, text, integer) to authenticated;

-- The person whose record was returned corrects the work and sends it for review again (the figures are recalculated).
create or replace function public.performance_record_resubmit(p_record uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.performance_records;
  v_metrics jsonb;
  v_members jsonb;
  v_reviewer uuid;
begin
  select * into me from public.profiles where id = private.my_id();
  select * into r from public.performance_records where id = p_record for update;
  if me.id is null or r.id is null or r.subject_id <> me.id then
    raise exception 'NOT_FOUND: Performance record not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'RETURNED' then
    raise exception 'CONFLICT: Only a record returned for correction can be sent again.' using errcode = 'P0001';
  end if;
  if me.role = 'TEAM_HEAD' then
    select coalesce(jsonb_agg(private.perf2_member(x.id, r.period_start, r.period_end, private.perf2_today())), '[]'::jsonb) into v_members from private.perf2_members_of(me.id) x;
    v_metrics := private.perf2_lead(me.id, r.period_start, r.period_end, private.perf2_today(), v_members);
  else
    v_metrics := private.perf2_member(me.id, r.period_start, r.period_end, private.perf2_today());
    v_reviewer := private.direct_lead_of(me.id);
  end if;
  update public.performance_records set status = 'PENDING', metrics = v_metrics, score = (v_metrics ->> 'score')::numeric, version = version + 1, refreshed_at = now(),
         reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_remarks = null
   where id = r.id returning * into r;
  insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score)
  values (r.id, 'RESUBMITTED', me.id, me.full_name, 'RETURNED', 'PENDING', r.score);
  perform private.write_audit('PERFORMANCE_RECORD_RESUBMITTED', 'performance_record', r.id, r.department_id, r.team_id,
    jsonb_build_object('subject', r.subject_id, 'score', r.score));
  if me.role = 'TEAM_HEAD' then
    perform private.notify_once(h, 'REPORT_PERFORMANCE_PENDING', format('Performance to review: %s', me.full_name),
      format('%s to %s', to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY')), 'performance_record', r.id) from private.tdr_heads(me.department_id, me.team_id) h;
  else
    perform private.notify_once(v_reviewer, 'REPORT_PERFORMANCE_PENDING', format('Performance to review: %s', me.full_name),
      format('%s to %s', to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY')), 'performance_record', r.id);
  end if;
  return private.perf2_record_json(r);
end $$;
revoke all on function public.performance_record_resubmit(uuid) from public, anon;
grant execute on function public.performance_record_resubmit(uuid) to authenticated;

create or replace function public.performance_record_history(p_record uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.performance_records;
begin
  select * into r from public.performance_records where id = p_record;
  if r.id is null or not private.perf2_can_view(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Performance record not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('action', h.action, 'by', h.actor_name, 'at', h.created_at, 'from', h.from_status, 'to', h.to_status,
                                                       'score', h.score, 'remarks', h.remarks) order by h.id)
                     from public.performance_record_history h where h.record_id = r.id), '[]'::jsonb);
end $$;
revoke all on function public.performance_record_history(uuid) from public, anon;
grant execute on function public.performance_record_history(uuid) to authenticated;
