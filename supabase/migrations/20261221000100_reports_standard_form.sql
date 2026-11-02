-- =============================================================================
-- Reports: ONE standard report form for every level, and the Daily Department Summary.
--
--  * Team Member, Team Lead and Department Head individual reports now share the same five fields: title, report date, assigned tasks,
--    completed tasks and a short "Remarks / Work Summary" (500 characters). The tasks are the author's own records in work_tasks; the
--    database refuses a task that was not assigned to the author, and a completed task that is not completed in the task records.
--  * A report is for one day. One report per person and day (a rejected one may be replaced). Older long-form Team Lead / Department
--    Head reports stay readable; editing one keeps its old sections.
--  * A Team Lead's individual report has its own Department Head approval status (dh_*), separate from the Team Lead's approval of
--    members' reports.
--  * Every submission keeps a snapshot of the content in the history (work_report_events.content), so a revision never overwrites an earlier one.
--  * report_settings: the working days used for "reports expected" (configurable, default Monday to Saturday).
--  * work_reports_daily_summary: the Daily Department Summary, calculated from the individual reports. No report is copied.
--
-- Safe to run again. Run after 20261217000100_reports_two_level_approval.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings, columns, indexes
-- ---------------------------------------------------------------------------
create table if not exists public.report_settings (
  id boolean primary key default true check (id),
  -- ISO weekdays (1 = Monday ... 7 = Sunday) on which a daily report is expected
  working_days integer[] not null default array[1, 2, 3, 4, 5, 6],
  updated_at timestamptz not null default now()
);
insert into public.report_settings (id) values (true) on conflict (id) do nothing;
alter table public.report_settings enable row level security;
revoke all on public.report_settings from public, anon, authenticated;

alter table public.work_report_events add column if not exists content jsonb;
create index if not exists work_reports_author_date_idx on public.work_reports (author_id, report_date);
create index if not exists work_reports_department_date_idx on public.work_reports (department_id, report_date) where status <> 'DRAFT';

-- A Team Lead's report was reviewed by the Department Head until now (single stage): that decision becomes its Department Head approval.
update public.work_reports r set
  dh_status = case r.status when 'APPROVED' then 'APPROVED' when 'REJECTED' then 'REJECTED' when 'REVISION_REQUIRED' then 'REVISION_REQUIRED' else 'PENDING' end,
  dh_reviewer_id = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.reviewed_by end,
  dh_reviewer_name = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.reviewed_by_name end,
  dh_reviewed_at = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.reviewed_at end,
  dh_comment = case when r.status in ('APPROVED', 'REJECTED', 'REVISION_REQUIRED') then r.review_comment end
 where r.kind = 'TEAM_LEAD' and r.status <> 'DRAFT' and r.dh_status is null;

-- ---------------------------------------------------------------------------
-- 2. The report content: assigned tasks, completed tasks, remarks
-- ---------------------------------------------------------------------------
-- Checks the task lists against the real task records of the CALLER (the author) and returns what is stored: a snapshot of each task and the
-- short remarks. Sections written by older long-form reports (p_old) are carried over untouched.
create or replace function private.clean_task_report(p_content jsonb, p_old jsonb default null)
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
  v_remarks text;
  v_out jsonb := '{}'::jsonb;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' then
    p_content := '{}'::jsonb;
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
  v_remarks := nullif(btrim(coalesce(p_content ->> 'remarks', '')), '');
  if v_remarks is not null and length(v_remarks) > 500 then
    raise exception 'VALIDATION_ERROR: Keep the remarks under 500 characters.' using errcode = 'P0001';
  end if;
  -- the sections of an older long-form report stay as they were
  if p_old is not null and jsonb_typeof(p_old) = 'object' then
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_out from jsonb_each(p_old) e (k, v)
     where k not in ('assignedTasks', 'completedTasks', 'remarks');
  end if;
  v_out := v_out || jsonb_build_object('assignedTasks', v_a, 'completedTasks', v_c);
  if v_remarks is not null then
    v_out := v_out || jsonb_build_object('remarks', v_remarks);
  end if;
  return v_out;
end $$;
revoke all on function private.clean_task_report(jsonb, jsonb) from public, anon, authenticated;

-- the Team Member form of the earlier migration: same rules (kept so nothing that calls it breaks)
create or replace function private.clean_member_report(p_content jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select private.clean_task_report(p_content, null)
$$;
revoke all on function private.clean_member_report(jsonb) from public, anon, authenticated;

-- The caller's own tasks to pick from (Team Member, Team Lead, Department Head): the open ones and the ones completed in the last 60 days.
create or replace function public.work_reports_my_tasks()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.report_kind_of(private.report_level()) is null then
    raise exception 'FORBIDDEN: Task lists for reports are for team members, team leads and department heads.' using errcode = '42501';
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

-- One report per person and day. A rejected report does not block a new one.
create or replace function private.report_date_taken(p_author uuid, p_date date, p_except uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.work_reports r
                  where r.author_id = p_author and r.report_date = p_date and r.id is distinct from p_except and r.status not in ('REJECTED'))
$$;
revoke all on function private.report_date_taken(uuid, date, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The report as the screens read it: with the task counts and the remarks
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
    'assignedCount', case when jsonb_typeof(r.content -> 'assignedTasks') = 'array' then jsonb_array_length(r.content -> 'assignedTasks') else 0 end,
    'completedCount', case when jsonb_typeof(r.content -> 'completedTasks') = 'array' then jsonb_array_length(r.content -> 'completedTasks') else 0 end,
    'remarks', left(coalesce(r.content ->> 'remarks', ''), 500),
    'excerpt', case
      when jsonb_typeof(r.content -> 'assignedTasks') = 'array'
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

-- ---------------------------------------------------------------------------
-- 4. Writing and submitting: the same form for every level
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
  v_today date := private.office_today();
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
  -- a daily report: the report date (today by default; up to 60 days back, never a future day)
  if p_report_date > v_today + 1 then
    raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001';
  end if;
  if p_report_date < v_today - 60 then
    raise exception 'VALIDATION_ERROR: Choose a report date within the last 60 days.' using errcode = 'P0001';
  end if;

  if p_id is null then
    if private.report_date_taken(a.id, p_report_date, null) then
      raise exception 'CONFLICT: You already have a report for this date. Open it from My Reports.' using errcode = 'P0001';
    end if;
    v_content := private.clean_task_report(p_content, null);
    insert into public.work_reports (kind, author_id, author_name, author_designation, department_id, team_id, title, report_date,
                                     period_type, period_start, period_end, content)
    values (v_kind, a.id, a.full_name, nullif(a."position", ''), private.base_department(a.department_id),
            case when v_kind = 'DEPARTMENT_HEAD' then null else a.team_id end,
            v_title, p_report_date, 'DAILY', p_report_date, p_report_date, v_content)
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
    if p_report_date <> r.report_date and private.report_date_taken(a.id, p_report_date, r.id) then
      raise exception 'CONFLICT: You already have a report for this date. Open it from My Reports.' using errcode = 'P0001';
    end if;
    v_content := private.clean_task_report(p_content, r.content);
    update public.work_reports
       set title = v_title, report_date = p_report_date, period_type = 'DAILY',
           period_start = p_report_date, period_end = p_report_date, content = v_content, updated_at = now()
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
  -- the task records are checked again now: a task reopened since the draft was saved cannot be sent as completed
  v_content := private.clean_task_report(r.content, r.content);
  if jsonb_array_length(v_content -> 'assignedTasks') = 0 and nullif(btrim(coalesce(v_content ->> 'remarks', '')), '') is null then
    raise exception 'VALIDATION_ERROR: Choose your assigned tasks or write a short remark before submitting.' using errcode = 'P0001';
  end if;
  if private.report_date_taken(r.author_id, r.report_date, r.id) then
    raise exception 'CONFLICT: You already have a report for this date.' using errcode = 'P0001';
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
  -- a (re)submission starts the approval again: the stages are cleared (the earlier decisions and contents stay in the history)
  update public.work_reports
     set status = 'SUBMITTED', submitted_at = now(), updated_at = now(), content = v_content,
         revision = case when v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
         reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_comment = null,
         team_lead_id = case when kind = 'MEMBER' then v_lead else team_lead_id end,
         team_lead_name = case when kind = 'MEMBER' then v_lead_name else team_lead_name end,
         tl_status = case when kind = 'MEMBER' then 'PENDING' end, tl_reviewer_id = null, tl_reviewer_name = null, tl_reviewed_at = null, tl_comment = null,
         -- a Team Lead's own report has no Team Lead stage: it waits for the Department Head
         dh_status = case when kind = 'TEAM_LEAD' then 'PENDING' end, dh_reviewer_id = null, dh_reviewer_name = null, dh_reviewed_at = null, dh_comment = null,
         decision_stage = null
   where id = p_id returning * into r;
  perform private.report_event_stage(r.id, v_action, v_from, 'SUBMITTED', null, r.revision, null);
  update public.work_report_events set content = v_content
   where id = (select max(e.id) from public.work_report_events e where e.report_id = r.id);
  for v_reviewer in select * from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) loop
    perform private.notify(v_reviewer, case when v_action = 'RESUBMITTED' then 'REPORT_RESUBMITTED' else 'REPORT_SUBMITTED' end,
      format('%s: %s', case when v_action = 'RESUBMITTED' then 'Report resubmitted' else 'New report to review' end, r.author_name),
      format('"%s" (%s) is waiting for your review.', r.title, to_char(r.report_date, 'DD Mon YYYY')),
      'work_report', r.id);
  end loop;
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision));
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_submit(uuid) from public, anon;
grant execute on function public.work_report_submit(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Deciding: a Team Lead's report records the Department Head's approval in its own columns
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
  elsif r.kind = 'TEAM_LEAD' then
    -- the Department Head's own approval of a Team Lead's individual report
    update public.work_reports
       set status = v_status, dh_status = p_decision, dh_reviewer_id = me.id, dh_reviewer_name = me.full_name, dh_reviewed_at = now(), dh_comment = left(v_comment, 2000),
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
-- 6. Who is expected to report, and the statistics of a period (no report is copied)
-- ---------------------------------------------------------------------------
-- The people of a department a Department Head (p_head) looks after, or all of them (p_head null: Operations Head, Super Admin, HR).
create or replace function private.report_people(p_department uuid, p_head uuid)
returns table (id uuid, kind text, team_id uuid, full_name text, designation text)
language sql stable security definer set search_path = '' as $$
  select p.id, case p.role when 'TEAM_MEMBER' then 'MEMBER' when 'TEAM_HEAD' then 'TEAM_LEAD' else 'DEPARTMENT_HEAD' end,
         p.team_id, p.full_name, nullif(p."position", '')
    from public.profiles p
   where p.status = 'ACTIVE' and p.role in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD') and not p.is_operations_head
     and private.base_department(p.department_id) = p_department
     and (p_head is null
          or p.id = p_head
          or (p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and private.head_covers(p_head, p_department, p.team_id)))
$$;
revoke all on function private.report_people(uuid, uuid) from public, anon, authenticated;

-- The days on which this person was expected to report in the period: working days from the day the account started up to today, minus
-- the days of an approved full-day leave. Nobody is expected to report for a future day.
create or replace function private.report_expected_days(p_person uuid, p_from date, p_to date)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from generate_series(
           greatest(p_from, coalesce((select coalesce(pr.approved_at, pr.created_at)::date from public.profiles pr where pr.id = p_person), p_from)),
           least(p_to, private.office_today()), interval '1 day') g (d)
   where exists (select 1 from public.report_settings s where s.working_days @> array[extract(isodow from g.d)::integer])
     and not exists (select 1 from public.leave_requests l
                      where l.employee_id = p_person and l.status = 'APPROVED' and l.leave_type = 'FULL_DAY' and g.d::date between l.start_date and l.end_date)
$$;
revoke all on function private.report_expected_days(uuid, date, date) from public, anon, authenticated;

-- Report and task statistics of a department (and, for a Department Head, the teams they look after) in a period, worked out from the
-- individual reports. Used by the daily summary, the weekly package, the Operations Head overview and the HR review.
create or replace function private.report_scope_stats(p_department uuid, p_head uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_totals jsonb;
  v_teams jsonb;
  v_missing jsonb;
begin
  with ppl as (select * from private.report_people(p_department, p_head)),
  rep as (
    select r.* from public.work_reports r join ppl on ppl.id = r.author_id
     where r.status <> 'DRAFT' and r.report_date between p_from and p_to
  ),
  per as (
    select ppl.id, ppl.kind, ppl.team_id, ppl.full_name, ppl.designation,
           private.report_expected_days(ppl.id, p_from, p_to) as expected,
           (select count(*) from rep x where x.author_id = ppl.id) as submitted,
           (select count(*) from rep x where x.author_id = ppl.id and x.status = 'APPROVED') as approved,
           (select count(*) from rep x where x.author_id = ppl.id and x.kind = 'MEMBER' and x.status in ('SUBMITTED', 'UNDER_REVIEW')) as pending_tl,
           (select count(*) from rep x where x.author_id = ppl.id
               and ((x.kind = 'MEMBER' and x.status = 'PENDING_DEPARTMENT_HEAD') or (x.kind = 'TEAM_LEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')))) as pending_dh,
           (select count(*) from rep x where x.author_id = ppl.id and x.kind = 'DEPARTMENT_HEAD' and x.status in ('SUBMITTED', 'UNDER_REVIEW')) as pending_oh,
           (select count(*) from rep x where x.author_id = ppl.id and x.status = 'REVISION_REQUIRED') as revision,
           (select count(*) from rep x where x.author_id = ppl.id and x.status = 'REJECTED') as rejected,
           (select count(distinct t ->> 'id') from rep x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.content -> 'assignedTasks') = 'array' then x.content -> 'assignedTasks' else '[]'::jsonb end) t
             where x.author_id = ppl.id and t ->> 'id' is not null) as assigned,
           (select count(distinct t ->> 'id') from rep x cross join lateral jsonb_array_elements(case when jsonb_typeof(x.content -> 'completedTasks') = 'array' then x.content -> 'completedTasks' else '[]'::jsonb end) t
             where x.author_id = ppl.id and t ->> 'id' is not null) as completed
      from ppl
  )
  select
    (select jsonb_build_object(
        'members', count(*) filter (where kind = 'MEMBER'), 'teamLeads', count(*) filter (where kind = 'TEAM_LEAD'), 'departmentHeads', count(*) filter (where kind = 'DEPARTMENT_HEAD'),
        'expected', coalesce(sum(expected), 0), 'submitted', coalesce(sum(submitted), 0),
        'pendingTl', coalesce(sum(pending_tl), 0), 'pendingDh', coalesce(sum(pending_dh), 0), 'pendingOh', coalesce(sum(pending_oh), 0),
        'approved', coalesce(sum(approved), 0), 'revision', coalesce(sum(revision), 0), 'rejected', coalesce(sum(rejected), 0),
        'assignedTasks', coalesce(sum(assigned), 0), 'completedTasks', coalesce(sum(completed), 0),
        'completionRate', case when coalesce(sum(assigned), 0) > 0 then round(100.0 * sum(completed) / sum(assigned), 1) end,
        'compliance', case when coalesce(sum(expected), 0) > 0 then least(100, round(100.0 * sum(submitted) / sum(expected), 1)) end)
       from per),
    (select coalesce(jsonb_agg(t order by t ->> 'team'), '[]'::jsonb) from (
       select jsonb_build_object(
         'teamId', tm.id, 'team', tm.name,
         'lead', (select string_agg(pp.full_name, ', ' order by pp.full_name) from per pp where pp.team_id = tm.id and pp.kind = 'TEAM_LEAD'),
         'members', count(*) filter (where per.kind = 'MEMBER'),
         'expected', coalesce(sum(per.expected), 0), 'submitted', coalesce(sum(per.submitted), 0), 'approved', coalesce(sum(per.approved), 0),
         'pendingTl', coalesce(sum(per.pending_tl), 0), 'pendingDh', coalesce(sum(per.pending_dh), 0),
         'assignedTasks', coalesce(sum(per.assigned), 0), 'completedTasks', coalesce(sum(per.completed), 0),
         'completionRate', case when coalesce(sum(per.assigned), 0) > 0 then round(100.0 * sum(per.completed) / sum(per.assigned), 1) end,
         'compliance', case when coalesce(sum(per.expected), 0) > 0 then least(100, round(100.0 * sum(per.submitted) / sum(per.expected), 1)) end) as t
        from per join public.teams tm on tm.id = per.team_id
       group by tm.id, tm.name) q),
    (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'designation', designation, 'kind', kind, 'expected', expected) order by full_name), '[]'::jsonb)
       from (select * from per where expected > 0 and submitted = 0 order by full_name limit 200) m)
    into v_totals, v_teams, v_missing;
  return v_totals || jsonb_build_object('teams', v_teams, 'missing', v_missing);
end $$;
revoke all on function private.report_scope_stats(uuid, uuid, date, date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. The Daily Department Summary
-- ---------------------------------------------------------------------------
-- Department Head: their own department (the teams they look after). Operations Head / Super Admin: any department they report on.
create or replace function public.work_reports_daily_summary(p_date date default null, p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_day date := coalesce(p_date, private.office_today());
  v_dept uuid;
  v_head uuid;
  v_stats jsonb;
begin
  if v_level not in ('DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: The daily department summary is for Department Heads.' using errcode = '42501';
  end if;
  if v_day > private.office_today() + 1 or v_day < private.office_today() - 400 then
    raise exception 'VALIDATION_ERROR: Choose a valid date.' using errcode = 'P0001';
  end if;
  if v_level = 'DEPARTMENT_HEAD' then
    select private.base_department(p.department_id) into v_dept from public.profiles p where p.id = auth.uid();
    if p_department is not null and p_department <> v_dept then
      raise exception 'FORBIDDEN: You can only open your own department.' using errcode = '42501';
    end if;
    v_head := auth.uid();
  else
    v_dept := p_department;
    if v_dept is null or v_dept not in (select private.report_scope_departments()) then
      raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
    end if;
  end if;
  v_stats := private.report_scope_stats(v_dept, v_head, v_day, v_day);
  return jsonb_build_object('date', v_day, 'departmentId', v_dept, 'department', (select d.name from public.departments d where d.id = v_dept))
         || v_stats;
end $$;
revoke all on function public.work_reports_daily_summary(date, uuid) from public, anon;
grant execute on function public.work_reports_daily_summary(date, uuid) to authenticated;

notify pgrst, 'reload schema';
