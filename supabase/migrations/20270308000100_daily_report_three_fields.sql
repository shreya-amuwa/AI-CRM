-- =============================================================================
-- Daily reports: three fields with word limits, every department (docs/DAILY_REPORT_FIELDS.md). Run after 20270307000100. Safe to run twice; no temp
-- tables; nothing is deleted; no column changes meaning.
--
-- The daily report of an assigned task has three fields, all optional, each with a maximum:
--   Work Completed  150 words   (task_daily_reports.work_completed / ai_studio_daily_reports.work_completed)
--   Work Pending    100 words   (pending_work)
--   Additional Note  50 words   (remarks)
-- Words are counted, not characters (private.word_count, the same rule as shared/validation.ts countWords).
--
-- Task Daily Report (Sales, Support and every department that uses work tasks): task_report_submit / task_report_reviewer_edit
--   * at least one of the three is written (a report is never empty); the 10-character minimum of Work Completed goes (the column may now be empty);
--   * progress and the reason for delay are no longer asked for: the report keeps the TASK's own progress, so Performance Management reads what it
--     read before; the "pending work is required below 100%" and "a reason is required past the deadline" rules go with those fields;
--   * an older client that still sends progress / a delay reason is accepted.
-- AI Design Studio daily report: ads_report_submit, the same three optional fields (challenges and links leave the form; older reports keep theirs).
-- AI Studio daily report (built from the picked tasks): ai_studio_daily_report_save and its trigger
--   * the Daily Work Description (20270302000100) is no longer asked for: new reports are not held to its 10-150 word rule (description_required
--     now defaults to false); reports already made keep their description;
--   * the "Additional information" section (blockers, tomorrow's plan) leaves the form; a report still needs some work: a picked task with work
--     recorded that day, or Work Completed (unchanged rule).
-- The limits are checked in the API (Zod), in the functions and, for AI Studio, by the trigger on every submission and Team Lead correction. Reports
-- made before this migration are not held to them (field_word_limits = false) unless they are submitted again.
-- Approval, review, notifications, Sent to HR and the history are unchanged.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The word limits
-- ---------------------------------------------------------------------------
create or replace function private.report_word_limits(p_completed text, p_pending text, p_note text)
returns void language plpgsql immutable set search_path = '' as $$
declare
  n integer;
begin
  n := private.word_count(p_completed);
  if n > 150 then raise exception 'VALIDATION_ERROR: Work Completed can have at most 150 words (now %).', n using errcode = 'P0001'; end if;
  n := private.word_count(p_pending);
  if n > 100 then raise exception 'VALIDATION_ERROR: Work Pending can have at most 100 words (now %).', n using errcode = 'P0001'; end if;
  n := private.word_count(p_note);
  if n > 50 then raise exception 'VALIDATION_ERROR: The Additional Note can have at most 50 words (now %).', n using errcode = 'P0001'; end if;
end $$;
revoke all on function private.report_word_limits(text, text, text) from public, anon;
grant execute on function private.report_word_limits(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Task Daily Report: Work Completed may be empty; reports made from now on are held to the limits
-- ---------------------------------------------------------------------------
alter table public.task_daily_reports drop constraint if exists task_daily_reports_work_completed_check;
alter table public.task_daily_reports alter column work_completed drop not null;
alter table public.task_daily_reports add constraint task_daily_reports_work_completed_check check (work_completed is null or length(work_completed) <= 4000);
alter table public.task_daily_reports add column if not exists field_word_limits boolean not null default false;
alter table public.task_daily_reports alter column field_word_limits set default true;

-- copy of 20270209000100, changed where marked (20270308000100)
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
  v_progress integer;
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
  -- (20270308000100) three optional fields with word limits; at least one is written (a report is never empty)
  if v_work = '' and v_pending is null and v_remarks is null then
    raise exception 'VALIDATION_ERROR: Write the work completed, the work pending or an additional note.' using errcode = 'P0001';
  end if;
  perform private.report_word_limits(v_work, v_pending, v_remarks);
  if length(v_work) > 4000 or length(coalesce(v_pending, '')) > 2000 or length(coalesce(v_delay, '')) > 2000 or length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: One of the fields is too long.' using errcode = 'P0001';
  end if;
  -- (20270308000100) the form no longer asks for progress or a reason for delay: the report keeps the task's own progress (Performance Management reads it);
  -- an older client that still sends a progress is accepted
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'VALIDATION_ERROR: Progress must be between 0 and 100.' using errcode = 'P0001';
  end if;
  v_progress := coalesce(p_progress, case when t.status = 'COMPLETED' then 100 else t.progress end);

  select * into r from public.task_daily_reports where task_id = p_task and report_date = v_date for update;
  v_lead := private.direct_lead_of(me.id);
  if r.id is null then
    begin
      insert into public.task_daily_reports (task_id, author_id, department_id, team_id, reviewer_id, report_date, work_completed, progress, pending_work, delay_reason, remarks)
      values (t.id, me.id, me.department_id, me.team_id, v_lead, v_date, nullif(v_work, ''), v_progress, v_pending, v_delay, v_remarks)
      returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: A report for this task and date already exists.' using errcode = 'P0001';
    end;
    perform private.tdr_event(r.id, 'SUBMITTED', null, 'PENDING', null, 1);
  elsif r.status = 'RETURNED' then
    v_from := r.status;
    update public.task_daily_reports set work_completed = nullif(v_work, ''), progress = v_progress, pending_work = v_pending, delay_reason = v_delay, remarks = v_remarks,
           field_word_limits = true,
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
    jsonb_build_object('task', t.id, 'reportDate', v_date, 'progress', v_progress, 'revision', r.revision));
  if v_lead is not null then
    perform private.notify_once(v_lead, 'REPORT_TASK_SUBMITTED', format('Task report from %s', me.full_name),
      format('%s · %s%% on "%s"', to_char(v_date, 'DD Mon'), v_progress, t.title), 'task_daily_report', r.id);
  else
    perform private.notify_once(h, 'REPORT_TASK_SUBMITTED', format('Task report from %s', me.full_name),
      format('%s · %s%% on "%s"', to_char(v_date, 'DD Mon'), v_progress, t.title), 'task_daily_report', r.id)
      from private.tdr_heads(me.department_id, me.team_id) h;
  end if;
  perform private.perf2_touch(me.id, v_date);
  return private.tdr_json(r);
end $$;
revoke all on function public.task_report_submit(uuid, date, text, integer, text, text, text) from public, anon;
grant execute on function public.task_report_submit(uuid, date, text, integer, text, text, text) to authenticated;

-- copy of 20270213000100, changed where marked (20270308000100)
create or replace function public.task_report_reviewer_edit(
  p_report uuid, p_work text, p_progress integer, p_pending text default null, p_delay text default null, p_remarks text default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.task_daily_reports;
  t public.work_tasks;
  v_work text := btrim(coalesce(p_work, ''));
  v_pending text := nullif(btrim(coalesce(p_pending, '')), '');
  v_delay text := nullif(btrim(coalesce(p_delay, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_changes jsonb := '{}'::jsonb;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select * into r from public.task_daily_reports where id = p_report for update;
  if r.id is null or not private.tdr_can_view(r.author_id, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if not private.tdr_reviews(r.author_id, r.department_id, r.team_id) then
    raise exception 'FORBIDDEN: Only the Team Lead of this team member can edit this report.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: Only a report waiting for your decision can be edited (this one is %).', lower(r.status) using errcode = 'P0001';
  end if;
  -- the member's own rules (task_report_submit) apply to the edited report
  select * into t from public.work_tasks where id = r.task_id;
  -- (20270308000100) the same three optional fields (one at least); the word limits apply to reports made with them
  if v_work = '' and v_pending is null and v_remarks is null then
    raise exception 'VALIDATION_ERROR: Write the work completed, the work pending or an additional note.' using errcode = 'P0001';
  end if;
  if r.field_word_limits then perform private.report_word_limits(v_work, v_pending, v_remarks); end if;
  if length(v_work) > 4000 or length(coalesce(v_pending, '')) > 2000 or length(coalesce(v_delay, '')) > 2000 or length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: One of the fields is too long.' using errcode = 'P0001';
  end if;
  -- (20270308000100) progress is no longer edited in the form: without one the report keeps its own; no reason for delay is required
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'VALIDATION_ERROR: Progress must be between 0 and 100.' using errcode = 'P0001';
  end if;
  p_progress := coalesce(p_progress, r.progress);
  if length(coalesce(v_reason, '')) < 5 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Say why you changed the report (5 to 1000 characters); the team member reads it.' using errcode = 'P0001';
  end if;

  if r.work_completed is distinct from nullif(v_work, '') then v_changes := v_changes || jsonb_build_object('workCompleted', jsonb_build_object('from', r.work_completed, 'to', nullif(v_work, ''))); end if;
  if r.progress is distinct from p_progress then v_changes := v_changes || jsonb_build_object('progress', jsonb_build_object('from', r.progress, 'to', p_progress)); end if;
  if r.pending_work is distinct from v_pending then v_changes := v_changes || jsonb_build_object('pendingWork', jsonb_build_object('from', r.pending_work, 'to', v_pending)); end if;
  if r.delay_reason is distinct from v_delay then v_changes := v_changes || jsonb_build_object('delayReason', jsonb_build_object('from', r.delay_reason, 'to', v_delay)); end if;
  if r.remarks is distinct from v_remarks then v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', r.remarks, 'to', v_remarks)); end if;
  -- a double click or a retry with the same values changes nothing and records nothing
  if v_changes = '{}'::jsonb then
    return private.tdr_json(r);
  end if;

  update public.task_daily_reports set work_completed = nullif(v_work, ''), progress = p_progress, pending_work = v_pending, delay_reason = v_delay, remarks = v_remarks,
         edited_by = me.id, edited_by_name = me.full_name, edited_at = now()
   where id = r.id returning * into r;
  insert into public.task_daily_report_history (report_id, action, actor_id, actor_name, from_status, to_status, remarks, revision, changes)
  values (r.id, 'EDITED', me.id, me.full_name, 'PENDING', 'PENDING', v_reason, r.revision, v_changes);
  perform private.write_audit('TASK_REPORT_EDITED', 'task_daily_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('task', r.task_id, 'reportDate', r.report_date, 'revision', r.revision, 'changes', v_changes, 'reason', v_reason));
  perform private.notify(r.author_id, 'REPORT_TASK_EDITED', 'Your Team Lead edited your task report',
    format('"%s" · %s · %s', t.title, to_char(r.report_date, 'DD Mon'), left(v_reason, 160)), 'task_daily_report', r.id, '{}'::jsonb, 'normal');
  perform private.perf2_touch(r.author_id, r.report_date);
  return private.tdr_json(r);
end $$;
revoke all on function public.task_report_reviewer_edit(uuid, text, integer, text, text, text, text) from public, anon;
grant execute on function public.task_report_reviewer_edit(uuid, text, integer, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. AI Studio daily report: no description asked for; the three fields' limits
-- ---------------------------------------------------------------------------
alter table public.ai_studio_daily_reports alter column description_required set default false;
alter table public.ai_studio_daily_reports add column if not exists field_word_limits boolean not null default false;
alter table public.ai_studio_daily_reports alter column field_word_limits set default true;

-- copy of 20270302000100, changed where marked (20270308000100)
create or replace function public.ai_studio_daily_report_save(
  p_id uuid, p_date date, p_tasks uuid[], p_work_completed text, p_pending_work text, p_blockers text, p_tomorrow_plan text, p_remarks text,
  p_submit boolean default false, p_expected uuid[] default null, p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_tomorrow text := nullif(btrim(coalesce(p_tomorrow_plan, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  -- (20270302000100) the Daily Work Description: 10-150 words to submit (also checked by a trigger on every submission)
  v_description text := nullif(btrim(coalesce(p_description, '')), '');
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
  if length(coalesce(v_description, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The daily work description can have at most 150 words.' using errcode = 'P0001';
  end if;
  -- (20270308000100) the form has three fields: Work Completed (150 words), Work Pending (100), Additional Note (50); the description is no longer asked for
  if p_submit then perform private.report_word_limits(v_completed, v_pending, v_remarks); end if;
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
      insert into public.ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, pending_work, blockers, tomorrow_plan, remarks, work_description, status)
      values (v_me, me.full_name, v_role, null, null, p_date, v_completed, v_pending, v_blockers, v_tomorrow, v_remarks, v_description, 'DRAFT') returning * into r;
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
         set report_date = p_date, work_completed = v_completed, pending_work = v_pending, blockers = v_blockers, tomorrow_plan = v_tomorrow, remarks = v_remarks,
             work_description = v_description
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
revoke all on function public.ai_studio_daily_report_save(uuid, date, uuid[], text, text, text, text, text, boolean, uuid[], text) from public, anon;
grant execute on function public.ai_studio_daily_report_save(uuid, date, uuid[], text, text, text, text, text, boolean, uuid[], text) to authenticated;

-- copy of 20270302000100, changed where marked (20270308000100); the trigger now also watches the three fields (a Team Lead's correction of a waiting report)
create or replace function private.tg_ai_studio_report_flow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_pending constant text[] := array['PENDING_TL_APPROVAL', 'PENDING_DH_APPROVAL'];
  v_submitted boolean := new.status = any (v_pending) and (tg_op = 'INSERT' or not (old.status = any (v_pending)));
  v_forward boolean := false;
begin
  -- the daily report (one per day, built from the tasks; project_id is null): the form everyone uses. The older one-task report has no description
  -- field (its own function and endpoint are kept for the reports made with it) and is not held to the rule.
  if v_submitted and new.description_required and new.project_id is null then
    perform private.ai_studio_check_description(new.work_description);
  end if;
  -- (20270308000100) the three fields' word limits, on a submission and on a Team Lead's correction of a waiting report
  if new.field_word_limits and new.project_id is null and new.status <> 'DRAFT'
     and (v_submitted or (tg_op = 'UPDATE' and (new.work_completed, new.pending_work, new.remarks) is distinct from (old.work_completed, old.pending_work, old.remarks))) then
    perform private.report_word_limits(new.work_completed, new.pending_work, new.remarks);
  end if;
  if tg_op = 'UPDATE' then
    if new.author_role = 'MEMBER' then
      -- the Team Lead approved it; or the Department Head approved a report that had no Team Lead step
      v_forward := (old.status = 'PENDING_TL_APPROVAL' and new.status in ('PENDING_DH_APPROVAL', 'APPROVED'))
                or (old.status = 'PENDING_DH_APPROVAL' and new.status = 'APPROVED' and new.tl_reviewed_at is null);
    else
      -- a Team Lead's own daily report is their team report: HR receives it when it is submitted
      v_forward := v_submitted;
    end if;
  end if;
  if v_submitted and auth.uid() = new.author_id then
    perform private.ai_studio_self_notice(new.author_id, 'AI_STUDIO_REPORT_SUBMITTED_OK', 'Daily report submitted successfully',
      format('%s · waiting for %s', to_char(new.report_date, 'DD Mon YYYY'),
             case when new.status = 'PENDING_TL_APPROVAL' then 'your Team Lead''s approval' else 'the Department Head''s approval' end), new.id);
  end if;
  -- once per revision: a repeated or concurrent decision cannot send it twice (the row is locked by the deciding function). The history entry and
  -- HR's notifications follow at commit (tg_ai_studio_report_sent), so the history reads "Approved", then "Sent to HR".
  if v_forward and new.hr_sent_revision is distinct from new.revision then
    new.hr_sent_at := now();
    new.hr_sent_revision := new.revision;
  end if;
  return new;
end $$;
revoke all on function private.tg_ai_studio_report_flow() from public, anon, authenticated;
drop trigger if exists ai_studio_report_flow on public.ai_studio_daily_reports;
create trigger ai_studio_report_flow before insert or update of status, work_completed, pending_work, remarks on public.ai_studio_daily_reports
  for each row execute function private.tg_ai_studio_report_flow();

-- ---------------------------------------------------------------------------
-- 4. AI Design Studio daily report: the same three optional fields (Work Completed may now be empty)
-- ---------------------------------------------------------------------------
alter table public.ads_reports drop constraint if exists ads_reports_work_completed_check;
alter table public.ads_reports alter column work_completed drop not null;
alter table public.ads_reports add constraint ads_reports_work_completed_check check (work_completed is null or length(trim(work_completed)) between 1 and 4000);

-- copy of 20270110000100, changed where marked (20270308000100)
create or replace function public.ads_report_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.ads_reports;
  v_id uuid;
  v_date date;
  v_client uuid;
  v_asg uuid;
  v_lead uuid;
  v_status text;
  v_req text := nullif(trim(coalesce(p ->> 'clientRequestId', '')), '');
begin
  me := private.ads_actor();
  if me.role = 'DEPARTMENT_HEAD' then raise exception 'FORBIDDEN: Daily reports are written by Team Leads and Team Members.' using errcode = '42501'; end if;
  begin v_date := (p ->> 'reportDate')::date; exception when others then v_date := null; end;
  if v_date is null then v_date := private.ads_today(); end if;
  if v_date > private.ads_today() then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if v_date < private.ads_today() - 60 then raise exception 'VALIDATION_ERROR: The report date cannot be more than 60 days back.' using errcode = 'P0001'; end if;
  begin v_asg := nullif(p ->> 'assignmentId', '')::uuid; exception when others then v_asg := null; end;
  begin v_client := nullif(p ->> 'clientId', '')::uuid; exception when others then v_client := null; end;
  if v_asg is not null then
    -- only your own assignment; it also names the client
    select a.client_id into v_client from public.ads_assignments a where a.id = v_asg and a.assignee_id = me.id;
    if v_client is null then raise exception 'VALIDATION_ERROR: Choose one of your own assignments.' using errcode = 'P0001'; end if;
  elsif v_client is not null and not private.ads_sees_client(me.id, me.role, v_client) then
    raise exception 'VALIDATION_ERROR: Choose one of your clients.' using errcode = 'P0001';
  end if;

  -- the Team Member's own Team Lead, else (no lead yet, or a Team Lead's own report) straight to the Department Head
  v_lead := case when me.role = 'TEAM_MEMBER' then private.direct_lead_of(me.id) end;
  v_status := case when v_lead is null then 'PENDING_DH' else 'PENDING_TL' end;

  -- (20270308000100) three optional fields with word limits (at least one written): Work Completed, Work Pending, Additional Note (remarks)
  if nullif(trim(coalesce(p ->> 'workCompleted', '')), '') is null and nullif(trim(coalesce(p ->> 'pendingWork', '')), '') is null
     and nullif(trim(coalesce(p ->> 'remarks', '')), '') is null then
    raise exception 'VALIDATION_ERROR: Write the work completed, the work pending or an additional note.' using errcode = 'P0001';
  end if;
  perform private.report_word_limits(p ->> 'workCompleted', p ->> 'pendingWork', p ->> 'remarks');

  begin v_id := nullif(p ->> 'id', '')::uuid; exception when others then v_id := null; end;
  if v_id is not null then
    -- a returned report is corrected and sent again: the old rounds stay in the history
    select * into r from public.ads_reports where id = v_id and author_id = me.id for update;
    if r.id is null then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
    if r.status <> 'RETURNED' then raise exception 'CONFLICT: Only a returned report can be edited and sent again.' using errcode = 'P0001'; end if;
    update public.ads_reports set report_date = v_date, client_id = v_client, assignment_id = v_asg,
      work_completed = private.ads_text(p, 'workCompleted', 4000, false, 'work completed today'),
      work_in_progress = private.ads_text(p, 'workInProgress', 4000, false, 'work in progress'),
      pending_work = private.ads_text(p, 'pendingWork', 4000, false, 'pending work'),
      challenges = private.ads_text(p, 'challenges', 4000, false, 'challenges'),
      remarks = private.ads_text(p, 'remarks', 2000, false, 'remarks'),
      attachments = private.ads_links(p -> 'attachments'), status = v_status, return_stage = null, revision = revision + 1, submitted_at = now()
     where id = r.id returning * into r;
    perform private.ads_log('report', r.id, 'RESUBMITTED', 'RETURNED', v_status);
  else
    if v_req is not null then
      select * into r from public.ads_reports where author_id = me.id and client_request_id = v_req;
      if r.id is not null then return private.ads_report_json(r, me.id, me.role); end if;
    end if;
    insert into public.ads_reports (department_id, author_id, report_date, client_id, assignment_id, work_completed, work_in_progress, pending_work, challenges, remarks, attachments, status, client_request_id)
    values (me.department_id, me.id, v_date, v_client, v_asg,
            private.ads_text(p, 'workCompleted', 4000, false, 'work completed today'),
            private.ads_text(p, 'workInProgress', 4000, false, 'work in progress'),
            private.ads_text(p, 'pendingWork', 4000, false, 'pending work'),
            private.ads_text(p, 'challenges', 4000, false, 'challenges'),
            private.ads_text(p, 'remarks', 2000, false, 'remarks'),
            private.ads_links(p -> 'attachments'), v_status, v_req)
    returning * into r;
    perform private.ads_log('report', r.id, 'SUBMITTED', null, v_status);
  end if;
  perform private.write_audit('ADS_REPORT_SUBMITTED', 'ads_report', r.id, me.department_id, me.team_id, jsonb_build_object('stage', v_status));
  if v_lead is not null then
    perform private.ads_notify(v_lead, 'ADS_REPORT_SUBMITTED', format('Daily report from %s', me.full_name), format('%s · waiting for your review', to_char(r.report_date, 'DD Mon YYYY')), 'ads_report', r.id, 'ads:rep:' || r.id || ':submit:' || r.revision);
  else
    perform private.ads_notify(h, 'ADS_REPORT_SUBMITTED', format('Daily report from %s', me.full_name), format('%s · waiting for your approval', to_char(r.report_date, 'DD Mon YYYY')), 'ads_report', r.id, 'ads:rep:' || r.id || ':submit:' || r.revision || ':' || h)
      from private.ads_head_ids() h;
  end if;
  return private.ads_report_json(r, me.id, me.role);
end $$;
revoke all on function public.ads_report_submit(jsonb) from public, anon;
grant execute on function public.ads_report_submit(jsonb) to authenticated;

notify pgrst, 'reload schema';
