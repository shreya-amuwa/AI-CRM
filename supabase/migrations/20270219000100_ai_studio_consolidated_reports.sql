-- =============================================================================
-- AI Studio: one consolidated daily report per person and day, built from the work already recorded on the tasks
-- (docs/AI_STUDIO_DAILY_REPORTS.md).
--
-- The task history (ai_studio_task_updates) is the single source of truth. A report stores only REFERENCES:
--   ai_studio_daily_reports            the report's own data: date, status, review, and the person's ADDITIONAL remarks
--   ai_studio_report_tasks             (report, task)          the tasks the person picked
--   ai_studio_report_task_updates      (report, task, update)  the exact history entries the report showed when it was submitted
-- Nothing of a task (title, description, completion details, links) is copied into a report. History entries are never changed
-- (a trigger refuses it), so a submitted report keeps showing the progress and notes of the day it covers, even after the task moves on.
--
-- Links: AI Studio "attachments" are web links on the task (no files are uploaded anywhere in AI Studio, so there is no stored file to
-- duplicate). The task keeps only its current list; from now on a history entry records the task's link list whenever it CHANGES
-- (ai_studio_task_updates.links, null = unchanged), so a report can show the links as they were on its day. Older entries have no links
-- recorded: the latest entry of each task is filled with the task's current list (true at that entry, since links only change with an
-- entry); nothing earlier is guessed.
--
-- Additive and safe to run twice. Older one-project / one-task reports are left as they are and still open and work.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Links per history entry, and the history becomes write-once
-- ---------------------------------------------------------------------------
alter table public.ai_studio_task_updates add column if not exists links jsonb
  check (links is null or (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5));

-- the one-time fill (only entries without links yet): the latest entry of a task that has links
update public.ai_studio_task_updates u set links = t.attachments
  from public.ai_studio_tasks t
 where t.id = u.task_id and u.links is null and jsonb_array_length(t.attachments) > 0
   and u.seq = (select max(x.seq) from public.ai_studio_task_updates x where x.task_id = t.id)
   and not exists (select 1 from public.ai_studio_task_updates y where y.task_id = t.id and y.links is not null);

-- every new entry records the task's link list when it differs from the last recorded one (the task row is written before its entry)
create or replace function private.tg_ai_studio_update_links()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_cur jsonb;
  v_prev jsonb;
begin
  if new.links is not null then return new; end if;
  select coalesce(t.attachments, '[]'::jsonb) into v_cur from public.ai_studio_tasks t where t.id = new.task_id;
  select u.links into v_prev from public.ai_studio_task_updates u where u.task_id = new.task_id and u.links is not null order by u.seq desc limit 1;
  if v_cur is distinct from coalesce(v_prev, '[]'::jsonb) then new.links := v_cur; end if;
  return new;
end $$;
revoke all on function private.tg_ai_studio_update_links() from public, anon, authenticated;
drop trigger if exists ai_studio_task_updates_links on public.ai_studio_task_updates;
create trigger ai_studio_task_updates_links before insert on public.ai_studio_task_updates
  for each row execute function private.tg_ai_studio_update_links();

-- a history entry is never changed: a submitted report points at it and must keep showing what was recorded
create or replace function private.tg_ai_studio_update_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'CONFLICT: A task history entry cannot be changed.' using errcode = 'P0001';
end $$;
revoke all on function private.tg_ai_studio_update_immutable() from public, anon, authenticated;
drop trigger if exists ai_studio_task_updates_immutable on public.ai_studio_task_updates;
create trigger ai_studio_task_updates_immutable before update on public.ai_studio_task_updates
  for each row execute function private.tg_ai_studio_update_immutable();

-- a report entry must belong to its task: checked by the database itself (composite foreign key below)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_studio_task_updates_id_task_key') then
    alter table public.ai_studio_task_updates add constraint ai_studio_task_updates_id_task_key unique (id, task_id);
  end if;
end $$;
create index if not exists ai_studio_task_updates_author_day_idx on public.ai_studio_task_updates (author_id, created_at) where kind = 'PROGRESS';

-- ---------------------------------------------------------------------------
-- 2. The consolidated report: no project or task of its own, one per person and day
-- ---------------------------------------------------------------------------
alter table public.ai_studio_daily_reports alter column project_id drop not null;
alter table public.ai_studio_daily_reports add column if not exists tomorrow_plan text check (tomorrow_plan is null or length(tomorrow_plan) <= 4000);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ai_studio_daily_reports_kind_check') then
    alter table public.ai_studio_daily_reports add constraint ai_studio_daily_reports_kind_check check (project_id is not null or task_id is null);
  end if;
end $$;
create unique index if not exists ai_studio_daily_reports_one_per_day on public.ai_studio_daily_reports (author_id, report_date) where project_id is null;

-- an older (one-project) report stays one, and a consolidated report stays consolidated
create or replace function private.tg_ai_studio_report_kind()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (old.project_id is null) <> (new.project_id is null) then
    raise exception 'CONFLICT: This report cannot be changed into another kind of report.' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function private.tg_ai_studio_report_kind() from public, anon, authenticated;
drop trigger if exists ai_studio_daily_reports_kind on public.ai_studio_daily_reports;
create trigger ai_studio_daily_reports_kind before update on public.ai_studio_daily_reports
  for each row execute function private.tg_ai_studio_report_kind();

create table if not exists public.ai_studio_report_tasks (
  report_id uuid not null references public.ai_studio_daily_reports (id) on delete cascade,
  task_id uuid not null references public.ai_studio_tasks (id) on delete cascade,
  position smallint not null default 0,
  primary key (report_id, task_id)
);
create index if not exists ai_studio_report_tasks_task_idx on public.ai_studio_report_tasks (task_id);

create table if not exists public.ai_studio_report_task_updates (
  report_id uuid not null,
  task_id uuid not null,
  update_id uuid not null,
  primary key (report_id, update_id),
  foreign key (report_id, task_id) references public.ai_studio_report_tasks (report_id, task_id) on delete cascade,
  foreign key (update_id, task_id) references public.ai_studio_task_updates (id, task_id) on delete cascade
);
create index if not exists ai_studio_report_task_updates_update_idx on public.ai_studio_report_task_updates (update_id);

alter table public.ai_studio_report_tasks enable row level security;
alter table public.ai_studio_report_task_updates enable row level security;
revoke all on public.ai_studio_report_tasks, public.ai_studio_report_task_updates from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reading the work of a report (one query for all its tasks)
-- ---------------------------------------------------------------------------
-- a task given by a Team Lead who is not the person's own Team Lead
create or replace function private.ai_studio_cross_team(p_assigned_by uuid, p_author uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(p_assigned_by is not null and p_assigned_by <> p_author
    and p_assigned_by is distinct from private.direct_lead_of(p_author)
    and exists (select 1 from public.profiles a where a.id = p_assigned_by and a.role = 'TEAM_HEAD'), false)
$$;
revoke all on function private.ai_studio_cross_team(uuid, uuid) from public, anon;
grant execute on function private.ai_studio_cross_team(uuid, uuid) to authenticated, service_role;

-- The work on the given tasks, as it was on p_date:
--   p_frozen: the history entries the report referenced when it was submitted (ai_studio_report_task_updates)
--   otherwise: the author's own progress entries recorded on p_date (Indian time), up to now (a draft follows the task)
-- Every value comes from the task and its history; nothing is invented. A task with no entry that day says so (noUpdate).
create or replace function private.ai_studio_report_work(p_report uuid, p_author uuid, p_date date, p_tasks uuid[], p_frozen boolean, p_until timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  with sel as (
    select t.*, x.ord from unnest(coalesce(p_tasks, '{}'::uuid[])) with ordinality as x(id, ord) join public.ai_studio_tasks t on t.id = x.id
  ), ent as (
    select u.* from sel s join public.ai_studio_task_updates u on u.task_id = s.id
     where case when p_frozen then exists (select 1 from public.ai_studio_report_task_updates ru where ru.report_id = p_report and ru.update_id = u.id)
                else u.kind = 'PROGRESS' and u.author_id = p_author and (u.created_at at time zone 'Asia/Kolkata')::date = p_date and u.created_at <= p_until end
  )
  select coalesce(jsonb_agg(q.item order by q.pname, q.ord), '[]'::jsonb) from (
    select s.ord, pr.name as pname, jsonb_build_object(
      'taskId', s.id, 'title', s.title, 'description', s.description, 'priority', s.priority,
      'projectId', s.project_id, 'projectName', pr.name,
      'assignedById', s.assigned_by, 'assignedByName', b.full_name, 'assignedAt', s.created_at, 'dueDate', s.due_date,
      'crossTeam', private.ai_studio_cross_team(s.assigned_by, p_author),
      'entries', coalesce(e.entries, '[]'::jsonb),
      'noUpdate', e.entries is null,
      -- the state the day ended with (the last entry of the day, else the task's state at the end of that day)
      'status', coalesce(lst.status, st.status, 'ASSIGNED'), 'progress', coalesce(lst.progress, st.progress, 0),
      'progressBefore', bef.progress,
      'completedAt', dn.created_at,
      'links', coalesce(lk.links, '[]'::jsonb),
      'currentStatus', s.status, 'currentProgress', s.progress) as item
      from sel s
      join public.ai_studio_projects pr on pr.id = s.project_id
      left join public.profiles b on b.id = s.assigned_by
      left join lateral (select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.created_at, 'status', x.status, 'progress', x.progress, 'note', x.note) order by x.seq) as entries
                           from ent x where x.task_id = s.id) e on true
      left join lateral (select x.status, x.progress, x.seq from ent x where x.task_id = s.id order by x.seq desc limit 1) lst on true
      left join lateral (select x.created_at from ent x where x.task_id = s.id and x.status = 'COMPLETED' order by x.seq desc limit 1) dn on true
      left join lateral (select u.status, u.progress from public.ai_studio_task_updates u
                          where u.task_id = s.id and (u.created_at at time zone 'Asia/Kolkata')::date <= p_date and u.created_at <= p_until
                          order by u.seq desc limit 1) st on true
      left join lateral (select u.progress from public.ai_studio_task_updates u
                          where u.task_id = s.id and (u.created_at at time zone 'Asia/Kolkata')::date < p_date order by u.seq desc limit 1) bef on true
      -- the links in effect at the day's last entry (each list is stored once, when it changes)
      left join lateral (select u.links from public.ai_studio_task_updates u
                          where u.task_id = s.id and u.links is not null and u.seq <= lst.seq order by u.seq desc limit 1) lk on true
  ) q
$$;
revoke all on function private.ai_studio_report_work(uuid, uuid, date, uuid[], boolean, timestamptz) from public, anon;
grant execute on function private.ai_studio_report_work(uuid, uuid, date, uuid[], boolean, timestamptz) to authenticated, service_role;

create or replace function private.ai_studio_work_summary(p_work jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'projects', (select count(distinct w ->> 'projectId') from jsonb_array_elements(p_work) w),
    'tasks', jsonb_array_length(p_work),
    'completed', (select count(*) from jsonb_array_elements(p_work) w where w ->> 'completedAt' is not null),
    'inProgress', (select count(*) from jsonb_array_elements(p_work) w where w ->> 'completedAt' is null and w ->> 'status' = 'IN_PROGRESS'),
    'onHold', (select count(*) from jsonb_array_elements(p_work) w where w ->> 'completedAt' is null and w ->> 'status' = 'ON_HOLD'),
    'crossTeam', (select count(*) from jsonb_array_elements(p_work) w where (w ->> 'crossTeam')::boolean),
    'updates', (select coalesce(sum(jsonb_array_length(w -> 'entries')), 0) from jsonb_array_elements(p_work) w),
    'links', (select count(distinct l #>> '{}') from jsonb_array_elements(p_work) w, jsonb_array_elements(w -> 'links') l),
    'withoutUpdate', (select count(*) from jsonb_array_elements(p_work) w where (w ->> 'noUpdate')::boolean))
$$;
revoke all on function private.ai_studio_work_summary(jsonb) from public, anon;
grant execute on function private.ai_studio_work_summary(jsonb) to authenticated, service_role;

-- is the report's content fixed? (submitted and not sent back for changes)
create or replace function private.ai_studio_report_frozen(r public.ai_studio_daily_reports)
returns boolean language sql immutable set search_path = '' as $$
  select r.status not in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH')
$$;
revoke all on function private.ai_studio_report_frozen(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_frozen(public.ai_studio_daily_reports) to authenticated, service_role;

create or replace function private.ai_studio_report_task_ids(p_report uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(rt.task_id order by rt.position, rt.task_id), '{}'::uuid[]) from public.ai_studio_report_tasks rt where rt.report_id = p_report
$$;
revoke all on function private.ai_studio_report_task_ids(uuid) from public, anon;
grant execute on function private.ai_studio_report_task_ids(uuid) to authenticated, service_role;

create or replace function private.ai_studio_report_work_of(r public.ai_studio_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.ai_studio_report_work(r.id, r.author_id, r.report_date, private.ai_studio_report_task_ids(r.id),
                                       private.ai_studio_report_frozen(r), case when private.ai_studio_report_frozen(r) then coalesce(r.submitted_at, now()) else now() end)
$$;
revoke all on function private.ai_studio_report_work_of(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_work_of(public.ai_studio_daily_reports) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. The list row and the full report (a consolidated report has no project of its own)
-- ---------------------------------------------------------------------------
create or replace function private.ai_studio_report_row(r public.ai_studio_daily_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'authorId', r.author_id, 'authorName', r.author_name, 'authorRole', r.author_role,
    'kind', case when r.project_id is null then 'DAILY' else 'SINGLE' end,
    'projectId', r.project_id, 'projectName', pr.name, 'taskId', r.task_id, 'taskTitle', k.title,
    'reportDate', r.report_date, 'status', r.status, 'revision', r.revision,
    'leadId', private.ai_studio_report_lead(r), 'leadName', (select l.full_name from public.profiles l where l.id = private.ai_studio_report_lead(r)),
    'teamName', (select tm.name from public.profiles a join public.teams tm on tm.id = a.team_id where a.id = r.author_id),
    'submittedAt', r.submitted_at, 'approvedAt', r.approved_at, 'updatedAt', r.updated_at,
    'counts', case when r.project_id is null then (
      select jsonb_build_object(
        'projects', count(distinct t.project_id), 'tasks', count(*),
        'completed', count(*) filter (where exists (select 1 from public.ai_studio_report_task_updates ru join public.ai_studio_task_updates u on u.id = ru.update_id
                                                     where ru.report_id = r.id and ru.task_id = t.id and u.status = 'COMPLETED')),
        'crossTeam', count(*) filter (where private.ai_studio_cross_team(t.assigned_by, r.author_id)))
        from public.ai_studio_report_tasks rt join public.ai_studio_tasks t on t.id = rt.task_id where rt.report_id = r.id) end,
    'hasBlockers', nullif(btrim(coalesce(r.blockers, '')), '') is not null
                   or exists (select 1 from public.ai_studio_report_task_updates ru join public.ai_studio_task_updates u on u.id = ru.update_id
                               where ru.report_id = r.id and u.status = 'ON_HOLD'))
    from (select 1) one
    left join public.ai_studio_projects pr on pr.id = r.project_id
    left join public.ai_studio_tasks k on k.id = r.task_id
$$;
revoke all on function private.ai_studio_report_row(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_row(public.ai_studio_daily_reports) to authenticated, service_role;

-- 20270214000100's detail, plus the consolidated report's work and the author's designation (from their AI Studio role)
create or replace function private.ai_studio_report_detail(r public.ai_studio_daily_reports)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_work jsonb;
begin
  if r.project_id is null then v_work := private.ai_studio_report_work_of(r); end if;
  return private.ai_studio_report_row(r) || jsonb_build_object(
    'workCompleted', r.work_completed, 'workInProgress', r.work_in_progress, 'pendingWork', r.pending_work, 'blockers', r.blockers, 'remarks', r.remarks,
    'tomorrowPlan', r.tomorrow_plan,
    'authorDesignation', case r.author_role when 'LEAD' then 'Team Lead' else 'Team Member' end,
    'tlComment', r.tl_comment, 'tlReviewedAt', r.tl_reviewed_at, 'tlReviewerName', (select p.full_name from public.profiles p where p.id = r.tl_reviewed_by),
    'dhComment', r.dh_comment, 'dhReviewedAt', r.dh_reviewed_at, 'dhReviewerName', (select p.full_name from public.profiles p where p.id = r.dh_reviewed_by),
    'canEdit', r.author_id = auth.uid() and r.status in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH'),
    'canReview', private.ai_studio_can_review(r),
    'canLeadEdit', r.status = 'PENDING_TL_APPROVAL' and private.ai_studio_can_review(r),
    'reviewStage', case when r.status = 'PENDING_TL_APPROVAL' then 'TEAM_LEAD' when r.status = 'PENDING_DH_APPROVAL' then 'DEPARTMENT_HEAD' end,
    'frozen', private.ai_studio_report_frozen(r),
    'work', v_work,
    'summary', case when v_work is not null then private.ai_studio_work_summary(v_work) end,
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'action', e.action, 'stage', e.stage, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                                                               'comment', e.comment, 'actorName', e.actor_name, 'actorRole', e.actor_role, 'revision', e.revision,
                                                               'createdAt', e.created_at, 'changes', e.changes) order by e.seq)
                           from public.ai_studio_report_events e where e.report_id = r.id), '[]'::jsonb));
end $$;
revoke all on function private.ai_studio_report_detail(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_detail(public.ai_studio_daily_reports) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The form: which tasks can be picked for a date, and the report built from them
-- ---------------------------------------------------------------------------
-- my tasks that were open on p_date (given by then, not completed before it): open ones, ones I worked on, and ones I completed that day
create or replace function private.ai_studio_eligible_task(t public.ai_studio_tasks, p_author uuid, p_date date)
returns boolean language sql stable set search_path = '' as $$
  select t.assignee_id = p_author
     and (t.created_at at time zone 'Asia/Kolkata')::date <= p_date
     and (t.status <> 'COMPLETED' or t.completed_at is null or (t.completed_at at time zone 'Asia/Kolkata')::date >= p_date)
$$;
revoke all on function private.ai_studio_eligible_task(public.ai_studio_tasks, uuid, date) from public, anon;
grant execute on function private.ai_studio_eligible_task(public.ai_studio_tasks, uuid, date) to authenticated, service_role;

create or replace function private.ai_studio_check_date(p_date date)
returns void language plpgsql stable set search_path = '' as $$
begin
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the report date.' using errcode = 'P0001'; end if;
  if p_date > private.ai_studio_today() then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if p_date < private.ai_studio_today() - 60 then raise exception 'VALIDATION_ERROR: A report can be written for the last 60 days only.' using errcode = 'P0001'; end if;
end $$;
revoke all on function private.ai_studio_check_date(date) from public, anon;
grant execute on function private.ai_studio_check_date(date) to authenticated, service_role;

create or replace function public.ai_studio_daily_report_options(p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
begin
  perform private.ai_studio_require(array['LEAD', 'MEMBER']);
  perform private.ai_studio_check_date(p_date);
  return jsonb_build_object(
    'date', p_date,
    'existingReportId', (select r.id from public.ai_studio_daily_reports r where r.author_id = v_me and r.report_date = p_date and r.project_id is null),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'projectId', t.project_id, 'projectName', pr.name, 'status', t.status, 'progress', t.progress,
        'crossTeam', private.ai_studio_cross_team(t.assigned_by, v_me), 'assignedByName', b.full_name,
        'updatesOnDate', (select count(*) from public.ai_studio_task_updates u where u.task_id = t.id and u.kind = 'PROGRESS' and u.author_id = v_me
                             and (u.created_at at time zone 'Asia/Kolkata')::date = p_date))
        order by pr.name, (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc)
      from public.ai_studio_tasks t join public.ai_studio_projects pr on pr.id = t.project_id left join public.profiles b on b.id = t.assigned_by
      where private.ai_studio_eligible_task(t, v_me, p_date)), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_daily_report_options(date) from public, anon;
grant execute on function public.ai_studio_daily_report_options(date) to authenticated;

-- the checked, de-duplicated task list (each must be one of my tasks open on that date)
create or replace function private.ai_studio_checked_tasks(p_tasks uuid[], p_author uuid, p_date date)
returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce((select array_agg(x order by o) from (select x, min(o) as o from unnest(coalesce(p_tasks, '{}'::uuid[])) with ordinality as u(x, o) where x is not null group by x) d), '{}'::uuid[]);
begin
  if cardinality(v_ids) > 30 then raise exception 'VALIDATION_ERROR: A daily report can have at most 30 tasks.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(v_ids) x where not exists (select 1 from public.ai_studio_tasks t where t.id = x and private.ai_studio_eligible_task(t, p_author, p_date))) then
    raise exception 'VALIDATION_ERROR: Choose tasks that were assigned to you and open on the report date.' using errcode = 'P0001';
  end if;
  return v_ids;
end $$;
revoke all on function private.ai_studio_checked_tasks(uuid[], uuid, date) from public, anon;
grant execute on function private.ai_studio_checked_tasks(uuid[], uuid, date) to authenticated, service_role;

-- What the report would contain right now (the form's preview)
create or replace function public.ai_studio_daily_report_preview(p_date date, p_tasks uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  v_ids uuid[];
  v_work jsonb;
begin
  perform private.ai_studio_require(array['LEAD', 'MEMBER']);
  perform private.ai_studio_check_date(p_date);
  v_ids := private.ai_studio_checked_tasks(p_tasks, v_me, p_date);
  v_work := private.ai_studio_report_work(null, v_me, p_date, v_ids, false, now());
  return jsonb_build_object('date', p_date, 'work', v_work, 'summary', private.ai_studio_work_summary(v_work),
    'updateIds', coalesce((select jsonb_agg(e ->> 'id') from jsonb_array_elements(v_work) w, jsonb_array_elements(w -> 'entries') e), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_daily_report_preview(date, uuid[]) from public, anon;
grant execute on function public.ai_studio_daily_report_preview(date, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Save / submit the consolidated report
-- ---------------------------------------------------------------------------
-- p_expected: the history entries the person saw in the preview when they pressed Submit. If the tasks changed since, nothing is submitted:
-- the form refreshes and they confirm again, so a report never contains an entry its author did not see.
create or replace function public.ai_studio_daily_report_save(
  p_id uuid, p_date date, p_tasks uuid[], p_work_completed text, p_pending_work text, p_blockers text, p_tomorrow_plan text, p_remarks text,
  p_submit boolean default false, p_expected uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_tomorrow text := nullif(btrim(coalesce(p_tomorrow_plan, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_ids uuid[];
  v_updates uuid[];
  me public.profiles;
  r public.ai_studio_daily_reports;
  v_lead uuid;
  v_from text;
  v_action text;
  v_work jsonb;
  v_sum jsonb;
  v_body text;
begin
  select * into me from public.profiles where id = v_me;
  perform private.ai_studio_check_date(p_date);
  if greatest(length(coalesce(v_completed, '')), length(coalesce(v_pending, '')), length(coalesce(v_blockers, '')), length(coalesce(v_tomorrow, '')), length(coalesce(v_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  v_ids := private.ai_studio_checked_tasks(p_tasks, v_me, p_date);
  -- the entries the report would reference: my progress entries of that day on the chosen tasks
  select coalesce(array_agg(u.id order by u.seq), '{}'::uuid[]) into v_updates
    from public.ai_studio_task_updates u
   where u.task_id = any (v_ids) and u.kind = 'PROGRESS' and u.author_id = v_me and (u.created_at at time zone 'Asia/Kolkata')::date = p_date;
  if p_submit and v_completed is null and cardinality(v_updates) = 0 then
    raise exception 'VALIDATION_ERROR: Select a task with work recorded on this date, or describe the work you completed.' using errcode = 'P0001';
  end if;

  if p_id is null then
    if exists (select 1 from public.ai_studio_daily_reports x where x.author_id = v_me and x.report_date = p_date and x.project_id is null) then
      raise exception 'CONFLICT: You already have a daily report for %. Open it from My Daily Reports.', to_char(p_date, 'DD Mon YYYY') using errcode = 'P0001';
    end if;
    begin
      insert into public.ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, pending_work, blockers, tomorrow_plan, remarks, status)
      values (v_me, me.full_name, v_role, null, null, p_date, v_completed, v_pending, v_blockers, v_tomorrow, v_remarks, 'DRAFT') returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a daily report for %. Open it from My Daily Reports.', to_char(p_date, 'DD Mon YYYY') using errcode = 'P0001';
    end;
    perform private.ai_studio_event(r, 'CREATED', null, null, null);
    v_from := 'DRAFT';
  else
    select * into r from public.ai_studio_daily_reports where id = p_id for update;
    if r.id is null or r.author_id <> v_me then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
    if r.project_id is not null then raise exception 'CONFLICT: This is an older single-task report; edit it with its own form.' using errcode = 'P0001'; end if;
    if r.status not in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH') then
      raise exception 'CONFLICT: This report was already submitted and can no longer be changed.' using errcode = 'P0001';
    end if;
    begin
      update public.ai_studio_daily_reports
         set report_date = p_date, work_completed = v_completed, pending_work = v_pending, blockers = v_blockers, tomorrow_plan = v_tomorrow, remarks = v_remarks
       where id = r.id returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a daily report for %. Open it from My Daily Reports.', to_char(p_date, 'DD Mon YYYY') using errcode = 'P0001';
    end;
    v_from := r.status;
  end if;

  -- the chosen tasks (only references)
  delete from public.ai_studio_report_tasks where report_id = r.id and not (task_id = any (v_ids));
  insert into public.ai_studio_report_tasks (report_id, task_id, position)
  select r.id, x, o::smallint from unnest(v_ids) with ordinality as u(x, o)
  on conflict (report_id, task_id) do update set position = excluded.position;

  if p_submit then
    if p_expected is not null and not (p_expected @> v_updates and v_updates @> p_expected) then
      raise exception 'CONFLICT: Your tasks were updated while you were preparing this report. Review the refreshed report and submit again.' using errcode = 'P0001';
    end if;
    -- fix the report's content: exactly these history entries
    delete from public.ai_studio_report_task_updates where report_id = r.id;
    insert into public.ai_studio_report_task_updates (report_id, task_id, update_id)
    select r.id, u.task_id, u.id from public.ai_studio_task_updates u where u.id = any (v_updates);

    if v_role = 'MEMBER' then v_lead := private.direct_lead_of(v_me); end if;
    v_action := case when v_from in ('RETURNED_BY_TL', 'RETURNED_BY_DH') then 'RESUBMITTED' else 'SUBMITTED' end;
    update public.ai_studio_daily_reports
       set status = case when v_lead is not null then 'PENDING_TL_APPROVAL' else 'PENDING_DH_APPROVAL' end,
           lead_id = v_lead, lead_name = (select l.full_name from public.profiles l where l.id = v_lead),
           revision = case when v_action = 'RESUBMITTED' then revision + 1 else revision end,
           tl_reviewed_by = null, tl_reviewed_at = null, tl_comment = null, dh_reviewed_by = null, dh_reviewed_at = null, dh_comment = null,
           submitted_at = now(), approved_at = null
     where id = r.id returning * into r;
    perform private.ai_studio_event(r, v_action, null, v_from, case when v_role = 'MEMBER' and v_lead is null then 'No Team Lead is assigned: sent straight to the Department Head.' end);
    v_work := private.ai_studio_report_work_of(r);
    v_sum := private.ai_studio_work_summary(v_work);
    perform private.write_audit('AI_STUDIO_REPORT_' || v_action, 'ai_studio_report', r.id, me.department_id, me.team_id,
      jsonb_build_object('date', r.report_date, 'revision', r.revision, 'tasks', to_jsonb(v_ids), 'updates', to_jsonb(v_updates)));
    v_body := format('%s · %s project%s · %s task%s · %s completed%s%s', to_char(r.report_date, 'DD Mon YYYY'),
      v_sum ->> 'projects', case when (v_sum ->> 'projects')::int = 1 then '' else 's' end,
      v_sum ->> 'tasks', case when (v_sum ->> 'tasks')::int = 1 then '' else 's' end, v_sum ->> 'completed',
      case when v_blockers is not null or (v_sum ->> 'onHold')::int > 0 then ' · blockers reported' else '' end,
      case when v_action = 'RESUBMITTED' then ' · resubmitted' else '' end);
    if v_lead is not null then
      perform private.notify(v_lead, 'AI_STUDIO_REPORT_SUBMITTED', format('Daily report submitted: %s', me.full_name), v_body, 'ai_studio_report', r.id);
    else
      perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report submitted: %s', me.full_name),
        format('%s · %s', case when v_role = 'MEMBER' then 'No Team Lead assigned' else 'Team Lead' end, v_body), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_daily_report_save(uuid, date, uuid[], text, text, text, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.ai_studio_daily_report_save(uuid, date, uuid[], text, text, text, text, text, boolean, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The Team Lead's correction: a consolidated report whose tasks carry the work needs no "work completed" text
-- ---------------------------------------------------------------------------
create or replace function public.ai_studio_report_lead_edit(
  p_report uuid, p_work_completed text, p_work_in_progress text, p_pending_work text, p_blockers text, p_remarks text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  r public.ai_studio_daily_reports;
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_progress text := nullif(btrim(coalesce(p_work_in_progress, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_changes jsonb := '{}'::jsonb;
begin
  select * into r from public.ai_studio_daily_reports where id = p_report for update;
  if r.id is null or not private.ai_studio_can_see_report(r) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'PENDING_TL_APPROVAL' or not private.ai_studio_can_review(r) then
    raise exception 'FORBIDDEN: Only the Team Lead reviewing this report can edit it, while it waits for their approval.' using errcode = '42501';
  end if;
  if v_completed is null and not exists (select 1 from public.ai_studio_report_task_updates ru where ru.report_id = r.id) then
    raise exception 'VALIDATION_ERROR: Describe the work completed today.' using errcode = 'P0001';
  end if;
  if greatest(length(coalesce(v_completed, '')), length(coalesce(v_progress, '')), length(coalesce(v_pending, '')), length(coalesce(v_blockers, '')), length(coalesce(v_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_reason, '')) < 5 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Say why you changed the report (5 to 1000 characters); the team member reads it.' using errcode = 'P0001';
  end if;
  if r.work_completed is distinct from v_completed then v_changes := v_changes || jsonb_build_object('workCompleted', jsonb_build_object('from', r.work_completed, 'to', v_completed)); end if;
  if r.work_in_progress is distinct from v_progress then v_changes := v_changes || jsonb_build_object('workInProgress', jsonb_build_object('from', r.work_in_progress, 'to', v_progress)); end if;
  if r.pending_work is distinct from v_pending then v_changes := v_changes || jsonb_build_object('pendingWork', jsonb_build_object('from', r.pending_work, 'to', v_pending)); end if;
  if r.blockers is distinct from v_blockers then v_changes := v_changes || jsonb_build_object('blockers', jsonb_build_object('from', r.blockers, 'to', v_blockers)); end if;
  if r.remarks is distinct from v_remarks then v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', r.remarks, 'to', v_remarks)); end if;
  if v_changes = '{}'::jsonb then
    return private.ai_studio_report_detail(r);
  end if;
  update public.ai_studio_daily_reports set work_completed = v_completed, work_in_progress = v_progress, pending_work = v_pending, blockers = v_blockers, remarks = v_remarks
   where id = r.id returning * into r;
  insert into public.ai_studio_report_events (report_id, actor_id, actor_name, actor_role, action, stage, from_status, to_status, comment, revision, changes)
  select r.id, p.id, p.full_name, v_role, 'EDITED', 'TEAM_LEAD', r.status, r.status, v_reason, r.revision, v_changes from public.profiles p where p.id = auth.uid();
  perform private.write_audit('AI_STUDIO_REPORT_EDITED', 'ai_studio_daily_report', r.id, (select a.department_id from public.profiles a where a.id = r.author_id), null,
    jsonb_build_object('reportDate', r.report_date, 'changes', v_changes, 'reason', v_reason));
  perform private.notify(r.author_id, 'AI_STUDIO_REPORT_EDITED', 'Your Team Lead edited your daily report',
    format('%s · %s', to_char(r.report_date, 'DD Mon'), left(v_reason, 160)), 'ai_studio_report', r.id, '{}'::jsonb, 'normal');
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_lead_edit(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.ai_studio_report_lead_edit(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The report lists: project filter covers the tasks of a consolidated report; blockers and cross-team filters
-- ---------------------------------------------------------------------------
-- a new name (not another overload of ai_studio_reports_list): the API calls this one; the older name keeps working and uses it
create or replace function public.ai_studio_reports_page(
  p_view text default 'mine', p_project uuid default null, p_status text default null, p_lead uuid default null, p_author uuid default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25,
  p_blockers boolean default null, p_cross_team boolean default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_size integer := least(greatest(coalesce(p_page_size, 25), 1), 100);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_total bigint;
  v_items jsonb;
  v_counts jsonb;
begin
  if p_view not in ('mine', 'team', 'department') then raise exception 'VALIDATION_ERROR: Unknown report list.' using errcode = 'P0001'; end if;
  if p_view = 'mine' and v_role in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: You do not write daily reports.' using errcode = '42501'; end if;
  if p_view = 'team' and v_role <> 'LEAD' then raise exception 'FORBIDDEN: Team reports are for Team Leads.' using errcode = '42501'; end if;
  if p_view = 'department' and v_role not in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: Department reports are for the Department Head.' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED') then
    raise exception 'VALIDATION_ERROR: Unknown report status.' using errcode = 'P0001';
  end if;

  -- one pass over the reports in view (the CTE is computed once): counts per status ignore the status filter, so the tabs can show them
  with base as (
    select r.* from public.ai_studio_daily_reports r
     where (case p_view when 'mine' then r.author_id = v_me
                        when 'team' then r.author_role = 'MEMBER' and r.status <> 'DRAFT' and private.ai_studio_report_lead(r) = v_me
                        else r.status <> 'DRAFT' end)
       and (p_project is null or r.project_id = p_project
            or exists (select 1 from public.ai_studio_report_tasks rt join public.ai_studio_tasks t on t.id = rt.task_id where rt.report_id = r.id and t.project_id = p_project))
       and (p_lead is null or r.lead_id = p_lead or r.author_id = p_lead)
       and (p_author is null or r.author_id = p_author)
       and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
       and (p_blockers is null or p_blockers = (nullif(btrim(coalesce(r.blockers, '')), '') is not null
            or exists (select 1 from public.ai_studio_report_task_updates ru join public.ai_studio_task_updates u on u.id = ru.update_id where ru.report_id = r.id and u.status = 'ON_HOLD')))
       and (p_cross_team is null or p_cross_team = exists (select 1 from public.ai_studio_report_tasks rt join public.ai_studio_tasks t on t.id = rt.task_id
                                                            where rt.report_id = r.id and private.ai_studio_cross_team(t.assigned_by, r.author_id)))
  )
  select (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select b.status, count(*) as n from base b group by b.status) s),
         (select count(*) from base b where p_status is null or b.status = p_status),
         (select coalesce(jsonb_agg(private.ai_studio_report_row(x) order by x.report_date desc, x.updated_at desc, x.id), '[]'::jsonb)
            from public.ai_studio_daily_reports x
           where x.id in (select b.id from base b where p_status is null or b.status = p_status
                           order by b.report_date desc, b.updated_at desc, b.id limit v_size offset (v_page - 1) * v_size))
    into v_counts, v_total, v_items;
  return jsonb_build_object('items', v_items, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'counts', v_counts);
end $$;
revoke all on function public.ai_studio_reports_page(text, uuid, text, uuid, uuid, date, date, integer, integer, boolean, boolean) from public, anon;
grant execute on function public.ai_studio_reports_page(text, uuid, text, uuid, uuid, date, date, integer, integer, boolean, boolean) to authenticated;

create or replace function public.ai_studio_reports_list(
  p_view text default 'mine', p_project uuid default null, p_status text default null, p_lead uuid default null, p_author uuid default null,
  p_from date default null, p_to date default null, p_page integer default 1, p_page_size integer default 25)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.ai_studio_reports_page(p_view, p_project, p_status, p_lead, p_author, p_from, p_to, p_page, p_page_size, null, null)
$$;
revoke all on function public.ai_studio_reports_list(text, uuid, text, uuid, uuid, date, date, integer, integer) from public, anon;
grant execute on function public.ai_studio_reports_list(text, uuid, text, uuid, uuid, date, date, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. A task's own entries in daily reports (for whoever may see the task, e.g. the Team Lead who gave a cross-team task):
--    only THIS task's part of each report, never the rest of the report
-- ---------------------------------------------------------------------------
create or replace function public.ai_studio_task_reports(p_task uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.ai_studio_tasks;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  select * into t from public.ai_studio_tasks where id = p_task;
  if t.id is null or not private.ai_studio_can_see_task(t) then raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001'; end if;
  return coalesce((select jsonb_agg(x.item order by x.report_date desc, x.submitted_at desc) from (
      select r.report_date, r.submitted_at, jsonb_build_object(
        'reportId', r.id, 'reportDate', r.report_date, 'status', r.status, 'authorName', r.author_name, 'submittedAt', r.submitted_at,
        'entries', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'at', u.created_at, 'status', u.status, 'progress', u.progress, 'note', u.note) order by u.seq)
                               from public.ai_studio_report_task_updates ru join public.ai_studio_task_updates u on u.id = ru.update_id
                              where ru.report_id = r.id and ru.task_id = t.id), '[]'::jsonb),
        -- may the caller open the whole report? (the report's own rules)
        'canOpen', private.ai_studio_can_see_report(r)) as item
        from public.ai_studio_daily_reports r
       where r.status <> 'DRAFT'
         and (r.task_id = t.id or exists (select 1 from public.ai_studio_report_tasks rt where rt.report_id = r.id and rt.task_id = t.id))
       order by r.report_date desc limit 50) x), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_task_reports(uuid) from public, anon;
grant execute on function public.ai_studio_task_reports(uuid) to authenticated;

notify pgrst, 'reload schema';
