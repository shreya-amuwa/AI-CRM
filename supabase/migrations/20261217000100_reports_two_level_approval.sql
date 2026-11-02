-- =============================================================================
-- Reports: two-level approval for Team Member reports, a simpler Team Member report, and live updates.
--
--   Team Member submits  ->  Team Lead approves (stage 1)  ->  Department Head approves (stage 2)  ->  Fully approved
--
--  * A Team Member report is only "APPROVED" (fully approved) after BOTH the Team Lead and the Department Head approved it.
--    Between the two it is PENDING_DEPARTMENT_HEAD. A rejection or a revision request at either stage returns it to the author;
--    the Team Lead's approval stays on record when the Department Head sends it back, and both stages repeat after the resubmission.
--  * Each stage keeps its own reviewer, time and comment on the report (tl_* and dh_* columns); every step is also kept in the
--    history (work_report_events, now with the stage). Nothing is deleted.
--  * Team Lead and Department Head individual reports keep their existing single-stage review.
--  * The Team Member report only has: title, date, assigned tasks and completed tasks. The tasks are the member's own records in
--    work_tasks (checked here, never trusted from the browser).
--  * work_report_signals: one tiny row per person affected by a change, published to Realtime, so the Reports screens refresh by
--    themselves. A person only ever receives their own rows (row level security); no report content travels through it.
--
-- Safe to run again. Run after 20261213000100_work_reports.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns: the two approval stages
-- ---------------------------------------------------------------------------
alter table public.work_reports
  add column if not exists team_lead_id uuid references public.profiles (id) on delete set null,
  add column if not exists team_lead_name text,
  add column if not exists tl_status text check (tl_status in ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED')),
  add column if not exists tl_reviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists tl_reviewer_name text,
  add column if not exists tl_reviewed_at timestamptz,
  add column if not exists tl_comment text check (length(tl_comment) <= 2000),
  add column if not exists dh_status text check (dh_status in ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED')),
  add column if not exists dh_reviewer_id uuid references public.profiles (id) on delete set null,
  add column if not exists dh_reviewer_name text,
  add column if not exists dh_reviewed_at timestamptz,
  add column if not exists dh_comment text check (length(dh_comment) <= 2000),
  -- which stage made the last decision (shown with a rejection / revision request)
  add column if not exists decision_stage text check (decision_stage in ('TEAM_LEAD', 'DEPARTMENT_HEAD'));

alter table public.work_reports drop constraint if exists work_reports_status_check;
alter table public.work_reports add constraint work_reports_status_check
  check (status in ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED'));

create index if not exists work_reports_member_stage_idx on public.work_reports (department_id, status, period_end desc) where kind = 'MEMBER';

alter table public.work_report_events
  add column if not exists stage text check (stage in ('TEAM_LEAD', 'DEPARTMENT_HEAD'));

-- Team Member reports written before the second stage existed: what the Team Lead decided stays as the stage 1 decision. A report the
-- Team Lead had approved was final until now; it now waits for the Department Head (it was never approved by one).
update public.work_reports r set
  tl_status = case r.status when 'APPROVED' then 'APPROVED' when 'REJECTED' then 'REJECTED' when 'REVISION_REQUIRED' then 'REVISION_REQUIRED' else 'PENDING' end,
  tl_reviewer_id = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.reviewed_by end,
  tl_reviewer_name = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.reviewed_by_name end,
  tl_reviewed_at = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.reviewed_at end,
  tl_comment = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.review_comment end,
  team_lead_id = coalesce(r.team_lead_id, r.reviewed_by),
  team_lead_name = coalesce(r.team_lead_name, r.reviewed_by_name),
  decision_stage = case when r.status in ('REJECTED', 'REVISION_REQUIRED') then 'TEAM_LEAD' end,
  dh_status = case when r.status = 'APPROVED' then 'PENDING' end,
  status = case when r.status = 'APPROVED' then 'PENDING_DEPARTMENT_HEAD' else r.status end
 where r.kind = 'MEMBER' and r.status <> 'DRAFT' and r.tl_status is null;

-- ---------------------------------------------------------------------------
-- 2. Live signals (Realtime)
-- ---------------------------------------------------------------------------
create table if not exists public.work_report_signals (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  report_id uuid,
  event text not null,
  created_at timestamptz not null default now()
);
create index if not exists work_report_signals_recipient_idx on public.work_report_signals (recipient_id, id desc);
create index if not exists work_report_signals_created_idx on public.work_report_signals (created_at);

alter table public.work_report_signals enable row level security;
revoke all on public.work_report_signals from public, anon, authenticated;
grant select on public.work_report_signals to authenticated;
drop policy if exists work_report_signals_select on public.work_report_signals;
create policy work_report_signals_select on public.work_report_signals for select to authenticated
  using (recipient_id = (select private.my_id()));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'work_report_signals') then
    alter publication supabase_realtime add table public.work_report_signals;
  end if;
end $$;

-- Everyone a change on this report matters to: the author, the Team Lead of the team, the Department Head(s) of the department (and
-- side) and the Operations Head who manages the department.
create or replace function private.report_audience(r public.work_reports)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.author_id where r.author_id is not null
  union
  select p.id from public.profiles p where r.kind = 'MEMBER' and r.team_id is not null and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and p.team_id = r.team_id
  union
  select p.id from public.profiles p where r.kind in ('MEMBER', 'TEAM_LEAD') and p.role = 'DEPARTMENT_HEAD' and private.head_covers(p.id, r.department_id, r.team_id)
  union
  select x from private.report_reviewer_ids('DEPARTMENT_HEAD', r.department_id, null) x
$$;
revoke all on function private.report_audience(public.work_reports) from public, anon, authenticated;

create or replace function private.tg_work_report_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'DRAFT' then
    return new;
  end if;
  -- opening a submitted report ("under review") is not news to anyone else
  if tg_op = 'UPDATE' and old.status = new.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'SUBMITTED' and new.status = 'UNDER_REVIEW' then
    return new;
  end if;
  insert into public.work_report_signals (recipient_id, report_id, event)
  select u, new.id, case when tg_op = 'INSERT' then 'SUBMITTED' else new.status end from private.report_audience(new) u;
  -- the signals only matter for a moment; keep the table small
  delete from public.work_report_signals where created_at < now() - interval '2 days';
  return new;
end $$;
revoke all on function private.tg_work_report_signal() from public, anon, authenticated;

drop trigger if exists work_reports_signal on public.work_reports;
create trigger work_reports_signal after insert or update of status on public.work_reports
  for each row execute function private.tg_work_report_signal();

-- A department package sent or updated: the Operations Head and the Department Head(s) of the department see it appear.
create or replace function private.tg_work_report_package_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.work_report_signals (recipient_id, report_id, event)
  select u, null, 'PACKAGE'
    from (select x as u from private.report_reviewer_ids('DEPARTMENT_HEAD', new.department_id, null) x
          union
          select p.id from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = new.department_id) s;
  return new;
end $$;
revoke all on function private.tg_work_report_package_signal() from public, anon, authenticated;

drop trigger if exists work_report_packages_signal on public.work_report_packages;
create trigger work_report_packages_signal after insert or update on public.work_report_packages
  for each row execute function private.tg_work_report_package_signal();

-- ---------------------------------------------------------------------------
-- 3. Who may read and who may decide
-- ---------------------------------------------------------------------------
-- A reviewer of a report. A Team Member report has two: its Team Lead (always) and the Department Head once the Team Lead approved.
-- The Super Admin reads everything but does not take part in the member approval chain.
create or replace function private.is_report_reviewer(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id is distinct from auth.uid()
     and case when r.kind = 'MEMBER' then
           exists (select 1 from private.report_reviewer_ids('MEMBER', r.department_id, r.team_id) x where x = auth.uid())
           or (r.tl_status = 'APPROVED' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         else
           private.report_level() = 'SUPER_ADMIN'
           or exists (select 1 from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) x where x = auth.uid())
         end
$$;
revoke all on function private.is_report_reviewer(public.work_reports) from public, anon, authenticated;

-- The stage the caller may decide on right now (null: none). TEAM_LEAD: the member's Team Lead, while it waits for the Team Lead.
-- DEPARTMENT_HEAD: the Department Head, once the Team Lead approved and only while it waits for the Department Head.
-- REVIEWER: a Team Lead / Department Head individual report (single stage). Nobody decides on their own report.
create or replace function private.report_review_stage(r public.work_reports)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r.author_id is not distinct from auth.uid() then null
    when r.kind = 'MEMBER' then
      case
        when r.status in ('SUBMITTED', 'UNDER_REVIEW')
             and exists (select 1 from private.report_reviewer_ids('MEMBER', r.department_id, r.team_id) x where x = auth.uid()) then 'TEAM_LEAD'
        when r.status = 'PENDING_DEPARTMENT_HEAD' and r.tl_status = 'APPROVED'
             and private.head_covers(auth.uid(), r.department_id, r.team_id) then 'DEPARTMENT_HEAD'
      end
    when r.status in ('SUBMITTED', 'UNDER_REVIEW') and private.is_report_reviewer(r) then 'REVIEWER'
  end
$$;
revoke all on function private.report_review_stage(public.work_reports) from public, anon, authenticated;

-- Who may read a report:
--   the author; the Super Admin; the reviewer (any report that was submitted);
--   a Department Head (of that department and side): Team Lead reports that were submitted and Team Member reports their Team Lead
--   APPROVED (pending, approved, rejected or sent back by the Department Head);
--   an Operations Head of the department: every submitted report of the department's chain, with its true status.
create or replace function private.can_view_report(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id = auth.uid()
      or private.report_level() = 'SUPER_ADMIN'
      or (r.status <> 'DRAFT' and (
            private.is_report_reviewer(r)
         or (r.kind = 'MEMBER' and r.tl_status = 'APPROVED' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         or (r.kind = 'TEAM_LEAD' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         or (private.report_level() = 'OPERATIONS_HEAD' and r.department_id in (select private.report_scope_departments()))))
$$;
revoke all on function private.can_view_report(public.work_reports) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Report JSON and history with the stages
-- ---------------------------------------------------------------------------
create or replace function private.report_json(r public.work_reports, p_content boolean default false)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'authorId', r.author_id, 'author', r.author_name, 'designation', r.author_designation,
    'departmentId', r.department_id, 'department', (select d.name from public.departments d where d.id = r.department_id),
    'teamId', r.team_id, 'team', (select t.name from public.teams t where t.id = r.team_id),
    'title', r.title, 'reportDate', r.report_date, 'periodType', r.period_type, 'periodStart', r.period_start, 'periodEnd', r.period_end,
    'status', r.status, 'revision', r.revision, 'submittedAt', r.submitted_at,
    'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewComment', r.review_comment,
    'createdAt', r.created_at, 'updatedAt', r.updated_at,
    'excerpt', case
      when r.kind = 'MEMBER' and jsonb_typeof(r.content -> 'assignedTasks') = 'array'
        then format('%s of %s assigned tasks completed', case when jsonb_typeof(r.content -> 'completedTasks') = 'array' then jsonb_array_length(r.content -> 'completedTasks') else 0 end,
                    jsonb_array_length(r.content -> 'assignedTasks'))
      else left(coalesce(r.content ->> 'workCompleted', r.content ->> 'departmentOverview', ''), 180) end,
    'teamLead', r.team_lead_name,
    'tlStatus', r.tl_status, 'tlReviewer', r.tl_reviewer_name, 'tlReviewedAt', r.tl_reviewed_at, 'tlComment', r.tl_comment,
    'dhStatus', r.dh_status, 'dhReviewer', r.dh_reviewer_name, 'dhReviewedAt', r.dh_reviewed_at, 'dhComment', r.dh_comment,
    'decisionStage', r.decision_stage)
    || case when p_content then jsonb_build_object('content', r.content) else '{}'::jsonb end
$$;
revoke all on function private.report_json(public.work_reports, boolean) from public, anon, authenticated;

-- A history step with the approval stage it belongs to.
create or replace function private.report_event_stage(p_report uuid, p_action text, p_from text, p_to text, p_comment text, p_revision integer, p_stage text)
returns void language sql security definer set search_path = '' as $$
  insert into public.work_report_events (report_id, actor_id, actor_name, action, from_status, to_status, comment, revision, stage)
  select p_report, p.id, p.full_name, p_action, p_from, p_to, p_comment, p_revision, p_stage
    from public.profiles p where p.id = auth.uid()
$$;
revoke all on function private.report_event_stage(uuid, text, text, text, text, integer, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The Team Member report: title, date, assigned tasks, completed tasks
-- ---------------------------------------------------------------------------
-- The caller's own tasks to pick from: the open ones and the ones completed in the last 60 days (the real records in work_tasks).
create or replace function public.work_reports_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.report_level() <> 'MEMBER' then
    raise exception 'FORBIDDEN: Task lists for reports are for team members.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'dueDate', t.due_date,
                                        'progress', t.progress, 'completedAt', t.completed_at, 'assignedAt', t.created_at)
                     order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc)
      from (select * from public.work_tasks w
             where w.assignee_id = auth.uid() and (w.status <> 'COMPLETED' or w.completed_at >= now() - interval '60 days')
             order by w.created_at desc limit 200) t), '[]'::jsonb);
end $$;
revoke all on function public.work_reports_my_tasks() from public, anon;
grant execute on function public.work_reports_my_tasks() to authenticated;

-- Checks the task lists of a Team Member report against the real task records and returns what is stored: a snapshot of each task.
--   * every assigned task must be assigned to the caller (a task never given to them is refused);
--   * every completed task must be one of the assigned tasks and must really be completed in the task records.
create or replace function private.clean_member_report(p_content jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_assigned uuid[] := '{}';
  v_completed uuid[] := '{}';
  v_item jsonb;
  v_id uuid;
  v_key text;
  v_a jsonb;
  v_c jsonb;
  v_bad text;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    return jsonb_build_object('assignedTasks', '[]'::jsonb, 'completedTasks', '[]'::jsonb);
  end if;
  foreach v_key in array array['assignedTasks', 'completedTasks'] loop
    if jsonb_typeof(p_content -> v_key) = 'array' then
      for v_item in select * from jsonb_array_elements(p_content -> v_key) loop
        begin
          v_id := case when jsonb_typeof(v_item) = 'object' then (v_item ->> 'id')::uuid else (v_item #>> '{}')::uuid end;
        exception when others then
          raise exception 'VALIDATION_ERROR: Choose the tasks from your task list.' using errcode = 'P0001';
        end;
        if v_key = 'assignedTasks' then
          if not (v_id = any(v_assigned)) then v_assigned := v_assigned || v_id; end if;
        else
          if not (v_id = any(v_completed)) then v_completed := v_completed || v_id; end if;
        end if;
      end loop;
    elsif p_content -> v_key is not null and jsonb_typeof(p_content -> v_key) <> 'null' then
      raise exception 'VALIDATION_ERROR: Choose the tasks from your task list.' using errcode = 'P0001';
    end if;
  end loop;
  if coalesce(array_length(v_assigned, 1), 0) > 100 or coalesce(array_length(v_completed, 1), 0) > 100 then
    raise exception 'VALIDATION_ERROR: Choose at most 100 tasks.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_assigned) t (id) where not exists (select 1 from public.work_tasks w where w.id = t.id and w.assignee_id = auth.uid())) then
    raise exception 'VALIDATION_ERROR: You can only report on tasks that were assigned to you.' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_completed) c (id) where not (c.id = any(v_assigned))) then
    raise exception 'VALIDATION_ERROR: A completed task must be one of your assigned tasks.' using errcode = 'P0001';
  end if;
  select w.title into v_bad from public.work_tasks w where w.id = any(v_completed) and w.status <> 'COMPLETED' order by w.title limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_ERROR: "%" is not marked completed in your tasks yet. Update the task first.', left(v_bad, 80) using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'status', w.status, 'priority', w.priority, 'dueDate', w.due_date) order by w.created_at, w.id), '[]'::jsonb)
    into v_a from public.work_tasks w where w.id = any(v_assigned);
  select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'title', w.title, 'status', w.status, 'completedAt', w.completed_at) order by w.created_at, w.id), '[]'::jsonb)
    into v_c from public.work_tasks w where w.id = any(v_completed);
  return jsonb_build_object('assignedTasks', v_a, 'completedTasks', v_c);
end $$;
revoke all on function private.clean_member_report(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Writing and submitting
-- ---------------------------------------------------------------------------
create or replace function public.work_report_save(
  p_id uuid, p_title text, p_report_date date, p_period_type text, p_period_start date, p_period_end date, p_content jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  a public.profiles;
  r public.work_reports;
  v_kind text := private.report_kind_of(private.report_level());
  v_title text := btrim(coalesce(p_title, ''));
  v_content jsonb;
  v_type text := coalesce(p_period_type, 'DAILY');
  v_start date := p_period_start;
  v_end date := p_period_end;
begin
  if v_kind is null then
    raise exception 'FORBIDDEN: Reports are written by team members, team leads and department heads.' using errcode = '42501';
  end if;
  select * into a from public.profiles where id = auth.uid();
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a report title (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if p_report_date is null then
    raise exception 'VALIDATION_ERROR: Choose the report date.' using errcode = 'P0001';
  end if;
  if v_kind = 'MEMBER' then
    -- a Team Member report is for one day: the report date (today by default; a day up to 60 days back is allowed, never a future day)
    if p_report_date > current_date + 1 then
      raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001';
    end if;
    if p_report_date < current_date - 60 then
      raise exception 'VALIDATION_ERROR: Choose a report date within the last 60 days.' using errcode = 'P0001';
    end if;
    v_type := 'DAILY';
    v_start := p_report_date;
    v_end := p_report_date;
    v_content := private.clean_member_report(p_content);
  else
    if v_start is null or v_end is null then
      raise exception 'VALIDATION_ERROR: Choose the report date and the reporting period.' using errcode = 'P0001';
    end if;
    if v_end < v_start or v_end - v_start > 366 then
      raise exception 'VALIDATION_ERROR: The reporting period must end on or after its start and be at most a year.' using errcode = 'P0001';
    end if;
    if v_type not in ('DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM') then
      raise exception 'VALIDATION_ERROR: Choose daily, weekly, monthly or a custom period.' using errcode = 'P0001';
    end if;
    v_content := private.clean_report_content(v_kind, p_content);
  end if;

  if p_id is null then
    insert into public.work_reports (kind, author_id, author_name, author_designation, department_id, team_id, title, report_date,
                                     period_type, period_start, period_end, content)
    values (v_kind, a.id, a.full_name, nullif(a."position", ''), private.base_department(a.department_id),
            case when v_kind = 'DEPARTMENT_HEAD' then null else a.team_id end,
            v_title, p_report_date, v_type, v_start, v_end, v_content)
    returning * into r;
    perform private.report_event(r.id, 'CREATED', null, 'DRAFT', null, r.revision);
  else
    select * into r from public.work_reports where id = p_id and author_id = auth.uid() for update;
    if r.id is null then
      raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
    end if;
    if r.status not in ('DRAFT', 'REVISION_REQUIRED') then
      raise exception 'CONFLICT: This report was already submitted and cannot be edited.' using errcode = 'P0001';
    end if;
    update public.work_reports
       set title = v_title, report_date = p_report_date, period_type = v_type,
           period_start = v_start, period_end = v_end, content = v_content, updated_at = now()
     where id = p_id returning * into r;
  end if;
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_save(uuid, text, date, text, date, date, jsonb) from public, anon;
grant execute on function public.work_report_save(uuid, text, date, text, date, date, jsonb) to authenticated;

create or replace function public.work_report_submit(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_from text;
  v_action text;
  v_reviewer uuid;
  v_n int := 0;
  v_lead uuid;
  v_lead_name text;
  v_content jsonb;
begin
  if private.report_kind_of(private.report_level()) is null then
    raise exception 'FORBIDDEN: Reports are written by team members, team leads and department heads.' using errcode = '42501';
  end if;
  select * into r from public.work_reports where id = p_id and author_id = auth.uid() for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if r.status not in ('DRAFT', 'REVISION_REQUIRED') then
    raise exception 'CONFLICT: This report was already submitted.' using errcode = 'P0001';
  end if;
  v_content := r.content;
  if r.kind = 'MEMBER' then
    -- the task records are checked again now: a task reopened since the draft was saved cannot be sent as completed
    v_content := private.clean_member_report(r.content);
  elsif nullif(btrim(coalesce(r.content ->> 'workCompleted', '')), '') is null or length(r.content ->> 'workCompleted') < 3 then
    raise exception 'VALIDATION_ERROR: Describe the work completed before submitting.' using errcode = 'P0001';
  end if;
  -- the reviewer must exist now, so a report is never submitted into the void
  select count(*) into v_n from private.report_reviewer_ids(r.kind, r.department_id, r.team_id);
  if v_n = 0 then
    raise exception 'CONFLICT: %', case r.kind
      when 'MEMBER' then 'You are not assigned to a Team Lead yet. Ask your Department Head to assign you, then submit again.'
      when 'TEAM_LEAD' then 'No Department Head is set for your department yet. Ask the Super Admin or HR.'
      else 'No Operations Head manages your department yet. Ask the Super Admin to assign one.' end using errcode = 'P0001';
  end if;
  if r.kind = 'MEMBER' then
    select p.id, p.full_name into v_lead, v_lead_name from public.profiles p
     where p.id in (select private.report_reviewer_ids('MEMBER', r.department_id, r.team_id)) order by p.full_name, p.id limit 1;
  end if;
  v_from := r.status;
  v_action := case when v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' else 'SUBMITTED' end;
  -- a (re)submission starts the approval again: both stages are cleared (the earlier decisions stay in the history)
  update public.work_reports
     set status = 'SUBMITTED', submitted_at = now(), updated_at = now(), content = v_content,
         revision = case when v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
         reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_comment = null,
         team_lead_id = case when kind = 'MEMBER' then v_lead else team_lead_id end,
         team_lead_name = case when kind = 'MEMBER' then v_lead_name else team_lead_name end,
         tl_status = case when kind = 'MEMBER' then 'PENDING' end, tl_reviewer_id = null, tl_reviewer_name = null, tl_reviewed_at = null, tl_comment = null,
         dh_status = null, dh_reviewer_id = null, dh_reviewer_name = null, dh_reviewed_at = null, dh_comment = null, decision_stage = null
   where id = p_id returning * into r;
  perform private.report_event_stage(r.id, v_action, v_from, 'SUBMITTED', null, r.revision, null);
  for v_reviewer in select * from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) loop
    perform private.notify(v_reviewer, case when v_action = 'RESUBMITTED' then 'REPORT_RESUBMITTED' else 'REPORT_SUBMITTED' end,
      format('%s: %s', case when v_action = 'RESUBMITTED' then 'Report resubmitted' else 'New report to review' end, r.author_name),
      format('"%s" (%s to %s) is waiting for your review.', r.title, to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY')),
      'work_report', r.id);
  end loop;
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision));
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_submit(uuid) from public, anon;
grant execute on function public.work_report_submit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reading one report
-- ---------------------------------------------------------------------------
create or replace function public.work_report_get(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_stage text;
begin
  select * into r from public.work_reports where id = p_id;
  if r.id is null or not private.can_view_report(r) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  v_stage := private.report_review_stage(r);
  -- the first stage reviewer opening a submitted report marks it "under review" (once)
  if v_stage in ('TEAM_LEAD', 'REVIEWER') and r.status = 'SUBMITTED' then
    update public.work_reports set status = 'UNDER_REVIEW', updated_at = now() where id = r.id returning * into r;
    perform private.report_event_stage(r.id, 'OPENED', 'SUBMITTED', 'UNDER_REVIEW', null, r.revision, case when v_stage = 'TEAM_LEAD' then 'TEAM_LEAD' end);
  end if;
  return private.report_json(r, true) || jsonb_build_object(
    'canEdit', r.author_id = auth.uid() and r.status in ('DRAFT', 'REVISION_REQUIRED'),
    'canReview', v_stage is not null,
    'reviewStage', case when v_stage in ('TEAM_LEAD', 'DEPARTMENT_HEAD') then v_stage end,
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'fromStatus', e.from_status,
                          'toStatus', e.to_status, 'comment', e.comment, 'revision', e.revision, 'stage', e.stage) order by e.id)
                         from public.work_report_events e where e.report_id = r.id), '[]'::jsonb));
end $$;
revoke all on function public.work_report_get(uuid) from public, anon;
grant execute on function public.work_report_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Deciding: stage 1 (Team Lead) and stage 2 (Department Head)
-- ---------------------------------------------------------------------------
create or replace function public.work_report_review(p_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  me public.profiles;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_from text;
  v_status text;
  v_action text;
  v_stage text;
  v_to uuid;
begin
  if p_decision not in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then
    raise exception 'VALIDATION_ERROR: Choose approve, reject or request a revision.' using errcode = 'P0001';
  end if;
  if p_decision <> 'APPROVED' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write a comment so the author knows what to do.' using errcode = 'P0001';
  end if;
  select * into r from public.work_reports where id = p_id for update;
  if r.id is null or not private.can_view_report(r) or not private.is_report_reviewer(r) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  -- the stage is decided by the report's own state and the caller's place in the chain, never by the request
  v_stage := private.report_review_stage(r);
  if v_stage is null then
    raise exception 'CONFLICT: This report is not waiting for a decision.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  v_from := r.status;
  v_status := case when v_stage = 'TEAM_LEAD' and p_decision = 'APPROVED' then 'PENDING_DEPARTMENT_HEAD' else p_decision end;
  v_action := case p_decision when 'APPROVED' then 'APPROVED' when 'REJECTED' then 'REJECTED' else 'REVISION_REQUESTED' end;

  if v_stage = 'TEAM_LEAD' then
    update public.work_reports
       set status = v_status, tl_status = p_decision, tl_reviewer_id = me.id, tl_reviewer_name = me.full_name, tl_reviewed_at = now(), tl_comment = left(v_comment, 2000),
           dh_status = case when p_decision = 'APPROVED' then 'PENDING' end, decision_stage = 'TEAM_LEAD',
           team_lead_id = me.id, team_lead_name = me.full_name,
           reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_comment = left(v_comment, 2000), updated_at = now()
     where id = p_id returning * into r;
  elsif v_stage = 'DEPARTMENT_HEAD' then
    update public.work_reports
       set status = v_status, dh_status = p_decision, dh_reviewer_id = me.id, dh_reviewer_name = me.full_name, dh_reviewed_at = now(), dh_comment = left(v_comment, 2000),
           decision_stage = 'DEPARTMENT_HEAD',
           reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_comment = left(v_comment, 2000), updated_at = now()
     where id = p_id returning * into r;
  else
    update public.work_reports
       set status = v_status, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_comment = left(v_comment, 2000), updated_at = now()
     where id = p_id returning * into r;
  end if;
  perform private.report_event_stage(r.id, v_action, v_from, v_status, left(v_comment, 2000), r.revision, case when v_stage in ('TEAM_LEAD', 'DEPARTMENT_HEAD') then v_stage end);

  -- the author
  perform private.notify(r.author_id,
    case when v_stage = 'TEAM_LEAD' and p_decision = 'APPROVED' then 'REPORT_TL_APPROVED'
         else case p_decision when 'APPROVED' then 'REPORT_APPROVED' when 'REJECTED' then 'REPORT_REJECTED' else 'REPORT_REVISION_REQUIRED' end end,
    case when v_stage = 'TEAM_LEAD' and p_decision = 'APPROVED' then 'Approved by your Team Lead'
         when v_stage = 'DEPARTMENT_HEAD' and p_decision = 'APPROVED' then 'Report fully approved'
         else case p_decision when 'APPROVED' then 'Report approved' when 'REJECTED' then 'Report rejected' else 'Revision requested on your report' end end,
    case when v_stage = 'TEAM_LEAD' and p_decision = 'APPROVED'
           then format('"%s" was approved by %s and is now waiting for the Department Head.', r.title, me.full_name)
         else format('"%s" was %s by %s.%s', r.title, case p_decision when 'APPROVED' then 'approved' when 'REJECTED' then 'rejected' else 'sent back for a revision' end,
                     me.full_name, coalesce(' ' || left(v_comment, 300), '')) end,
    'work_report', r.id);
  -- stage 1 approved: the Department Head(s) of the department now have it to approve
  if v_stage = 'TEAM_LEAD' and p_decision = 'APPROVED' then
    for v_to in select p.id from public.profiles p where p.role = 'DEPARTMENT_HEAD' and private.head_covers(p.id, r.department_id, r.team_id) loop
      perform private.notify(v_to, 'REPORT_PENDING_DEPARTMENT_HEAD', format('Team member report to approve: %s', r.author_name),
        format('"%s" was approved by Team Lead %s and is waiting for your approval.', r.title, me.full_name), 'work_report', r.id);
    end loop;
  end if;
  -- stage 2 decided: the Team Lead is told too
  if v_stage = 'DEPARTMENT_HEAD' and r.team_lead_id is not null then
    perform private.notify(r.team_lead_id,
      case p_decision when 'APPROVED' then 'REPORT_APPROVED' when 'REJECTED' then 'REPORT_REJECTED' else 'REPORT_REVISION_REQUIRED' end,
      case p_decision when 'APPROVED' then 'Team member report fully approved' when 'REJECTED' then 'Team member report rejected' else 'Team member report sent back' end,
      format('"%s" by %s was %s by %s.%s', r.title, r.author_name, case p_decision when 'APPROVED' then 'fully approved' when 'REJECTED' then 'rejected' else 'sent back for a revision' end,
             me.full_name, coalesce(' ' || left(v_comment, 300), '')),
      'work_report', r.id);
  end if;
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision, 'stage', v_stage, 'comment', left(v_comment, 300)));
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_review(uuid, text, text) from public, anon;
grant execute on function public.work_report_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Department Head: the Team Member reports their Team Leads approved
-- ---------------------------------------------------------------------------
create or replace function public.work_reports_member_approvals(p_status text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_dept uuid;
  v_items jsonb;
  v_counts jsonb;
begin
  if private.report_level() <> 'DEPARTMENT_HEAD' then
    raise exception 'FORBIDDEN: Only a Department Head approves Team Member reports at this stage.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUIRED', 'ALL') then
    raise exception 'VALIDATION_ERROR: Choose a valid status.' using errcode = 'P0001';
  end if;
  select private.base_department(p.department_id) into v_dept from public.profiles p where p.id = auth.uid();
  with scope as (
    select r.* from public.work_reports r
     where r.kind = 'MEMBER' and r.tl_status = 'APPROVED' and r.status <> 'DRAFT' and r.department_id = v_dept
       and private.head_covers(auth.uid(), r.department_id, r.team_id)
       and (p_from is null or r.period_end >= p_from) and (p_to is null or r.period_start <= p_to)
  )
  select
    (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select i.status, count(*) n from scope i group by i.status) s),
    (select coalesce(jsonb_agg(private.report_json(x, true) order by (x.status = 'PENDING_DEPARTMENT_HEAD') desc, x.tl_reviewed_at desc nulls last, x.id), '[]'::jsonb)
       from (select i.* from scope i
              where p_status is null or p_status = 'ALL' or i.status = p_status or (p_status = 'PENDING' and i.status = 'PENDING_DEPARTMENT_HEAD')
              order by i.tl_reviewed_at desc nulls last limit 300) x)
    into v_counts, v_items;
  return jsonb_build_object('items', v_items, 'counts', v_counts);
end $$;
revoke all on function public.work_reports_member_approvals(text, date, date) from public, anon;
grant execute on function public.work_reports_member_approvals(text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. The boxes with the two stages
-- ---------------------------------------------------------------------------
-- The counts of a team's Team Member reports in a period (optionally one member's). pending = not finished yet (either stage).
create or replace function private.member_report_counts(p_team uuid, p_author uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'submitted', count(*) filter (where r.status <> 'DRAFT'),
    'pendingTl', count(*) filter (where r.status in ('SUBMITTED', 'UNDER_REVIEW')),
    'pendingDh', count(*) filter (where r.status = 'PENDING_DEPARTMENT_HEAD'),
    'pending', count(*) filter (where r.status in ('SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD')),
    'approved', count(*) filter (where r.status = 'APPROVED'),
    'revision', count(*) filter (where r.status = 'REVISION_REQUIRED'),
    'rejected', count(*) filter (where r.status = 'REJECTED'))
  from public.work_reports r
 where r.kind = 'MEMBER' and r.team_id = p_team and (p_author is null or r.author_id = p_author) and r.period_end >= p_from and r.period_start <= p_to
$$;
revoke all on function private.member_report_counts(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.work_reports_team_box(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_members jsonb;
begin
  if private.report_level() <> 'TEAM_LEAD' then
    raise exception 'FORBIDDEN: This is the Team Lead''s team report box.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select coalesce(jsonb_agg(m order by m ->> 'name'), '[]'::jsonb) into v_members from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'designation', nullif(p."position", ''),
      'counts', private.member_report_counts(me.team_id, p.id, p_from, p_to),
      'reports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc, r.submitted_at desc)
                             from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and r.team_id = me.team_id and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb)) as m
      from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and p.team_id = me.team_id
  ) q;
  return jsonb_build_object(
    'teamId', me.team_id, 'team', (select t.name from public.teams t where t.id = me.team_id), 'teamLead', me.full_name,
    'periodStart', p_from, 'periodEnd', p_to,
    'totalMembers', jsonb_array_length(v_members), 'counts', private.member_report_counts(me.team_id, null, p_from, p_to), 'members', v_members,
    'myReports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc)
                            from public.work_reports r where r.author_id = auth.uid() and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb));
end $$;
revoke all on function public.work_reports_team_box(date, date) from public, anon;
grant execute on function public.work_reports_team_box(date, date) to authenticated;

-- One Team Lead's box. Department Head (p_all false): the lead's own reports and the member reports the Team Lead APPROVED, whatever
-- the Department Head decided since (pending, fully approved, rejected, sent back). Operations Head (p_all true): every submitted
-- member report with its true status. The counts always cover every submitted member report; nothing pending is counted as approved.
create or replace function private.team_lead_box(p_lead public.profiles, p_from date, p_to date, p_all boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leadId', p_lead.id, 'lead', p_lead.full_name, 'teamId', p_lead.team_id, 'team', (select t.name from public.teams t where t.id = p_lead.team_id),
    'totalMembers', (select count(*) from public.profiles m where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and m.team_id = p_lead.team_id),
    'counts', private.member_report_counts(p_lead.team_id, null, p_from, p_to),
    'leadReports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.period_end desc, r.submitted_at desc)
                               from public.work_reports r where r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id and r.status <> 'DRAFT'
                                and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb),
    'memberReports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.author_name, r.period_end desc)
                                 from public.work_reports r where r.kind = 'MEMBER' and r.team_id = p_lead.team_id and r.status <> 'DRAFT'
                                  and (p_all or r.tl_status = 'APPROVED')
                                  and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb),
    'leadReportStatus', (select r.status from public.work_reports r where r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id and r.status <> 'DRAFT'
                           and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
    'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r
                         where r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to
                           and ((r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id) or (r.kind = 'MEMBER' and r.team_id = p_lead.team_id))))
$$;
revoke all on function private.team_lead_box(public.profiles, date, date, boolean) from public, anon, authenticated;

-- the Department Head's view (the 3-argument form the department box already calls)
create or replace function private.team_lead_box(p_lead public.profiles, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.team_lead_box(p_lead, p_from, p_to, false)
$$;
revoke all on function private.team_lead_box(public.profiles, date, date) from public, anon, authenticated;

create or replace function public.work_reports_operations(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  if private.report_level() not in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only Operations Heads can open the company reports.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'VALIDATION_ERROR: Choose a valid reporting period.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(row_obj order by row_obj ->> 'name'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug,
      'departmentHeads', (select coalesce(jsonb_agg(h.full_name order by h.full_name), '[]'::jsonb) from public.profiles h
                           where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and private.base_department(h.department_id) = d.id),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'counts', jsonb_build_object(
        'submitted', (select count(*) from public.work_reports r where r.department_id = d.id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'memberApproved', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status = 'APPROVED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberPending', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD') and r.period_end >= p_from and r.period_start <= p_to),
        'memberPendingTl', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to),
        'memberPendingDh', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status = 'PENDING_DEPARTMENT_HEAD' and r.period_end >= p_from and r.period_start <= p_to),
        'memberRevision', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status = 'REVISION_REQUIRED' and r.period_end >= p_from and r.period_start <= p_to),
        'memberRejected', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'MEMBER' and r.status = 'REJECTED' and r.period_end >= p_from and r.period_start <= p_to),
        'teamLeadReports', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'TEAM_LEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headReports', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
        'headPending', (select count(*) from public.work_reports r where r.department_id = d.id and r.kind = 'DEPARTMENT_HEAD' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and r.period_end >= p_from and r.period_start <= p_to)),
      'headReportStatus', (select r.status from public.work_reports r where r.department_id = d.id and r.kind = 'DEPARTMENT_HEAD' and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
      'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r where r.department_id = d.id and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to),
      'package', private.package_json((select pk from public.work_report_packages pk where pk.department_id = d.id and pk.period_start = p_from and pk.period_end = p_to))
    ) as row_obj
    from public.departments d where d.id in (select private.report_scope_departments())
  ) q;
  return jsonb_build_object('periodStart', p_from, 'periodEnd', p_to, 'departments', v_rows);
end $$;
revoke all on function public.work_reports_operations(date, date) from public, anon;
grant execute on function public.work_reports_operations(date, date) to authenticated;

-- Operations Head: one department opened up: Department Head -> Team Leads -> Team Members, every member report with its true status.
-- The reports are released once the Department Head has forwarded the package for that period; before that only the counts are shown.
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
  v_released := pk.id is not null;
  select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'designation', nullif(h."position", ''),
      'reports', case when v_released then coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc, r.submitted_at desc)
                         from public.work_reports r where r.kind = 'DEPARTMENT_HEAD' and r.author_id = h.id and r.status <> 'DRAFT'
                          and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb) else '[]'::jsonb end) order by h.full_name), '[]'::jsonb) into v_heads
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
    'packages', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'periodType', x.period_type, 'periodStart', x.period_start, 'periodEnd', x.period_end, 'submittedAt', x.submitted_at) order by x.period_end desc, x.submitted_at desc)
                           from (select * from public.work_report_packages k where k.department_id = p_department order by k.period_end desc, k.submitted_at desc limit 10) x), '[]'::jsonb),
    'departmentHeads', v_heads, 'teamLeads', v_leads);
end $$;
revoke all on function public.work_reports_operations_department(uuid, date, date) from public, anon;
grant execute on function public.work_reports_operations_department(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The sidebar badge and the page header
-- ---------------------------------------------------------------------------
create or replace function public.work_reports_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_kind text := private.report_kind_of(private.report_level());
  me public.profiles;
  v_pending int := 0;
  v_member_pending int := 0;
  v_revision int := 0;
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
  elsif v_level in ('OPERATIONS_HEAD', 'SUPER_ADMIN') then
    select count(*) into v_pending from public.work_reports x where x.kind = 'DEPARTMENT_HEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')
       and x.department_id in (select private.report_scope_departments());
  end if;
  return jsonb_build_object('level', v_level, 'canWrite', v_kind is not null, 'reportsTo', v_to,
    'pendingReview', v_pending + v_member_pending, 'pendingLeadReports', v_pending, 'pendingMemberApprovals', v_member_pending,
    'needsRevision', v_revision, 'badge', v_pending + v_member_pending + v_revision,
    'team', (select t.name from public.teams t where t.id = me.team_id), 'name', me.full_name);
end $$;
revoke all on function public.work_reports_context() from public, anon;
grant execute on function public.work_reports_context() to authenticated;

notify pgrst, 'reload schema';
