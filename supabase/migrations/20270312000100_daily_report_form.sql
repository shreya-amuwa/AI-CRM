-- =============================================================================
-- One Daily Report form for every department (docs/DAILY_REPORT_FIELDS.md). Run after 20270311000100. Safe to run twice; no temp tables; nothing is
-- deleted; no column changes meaning.
--
-- Every daily report (AI Studio, the Task Daily Report of Sales / Support / every department with work tasks, AI Design Studio, and the work report of
-- the Reports menu) has the same three fields, in the same order, with the same rules:
--   Work Completed   required, 10 to 150 words
--   Work Pending     optional, at most 100 words
--   Additional Note  optional, at most 50 words   (stored as remarks)
-- 20270308000100 made all three optional; Work Completed is now required again, counted in words.
--
-- 1. private.report_word_limits (called by every submission: task_report_submit, task_report_reviewer_edit, ai_studio_daily_report_save, the AI Studio
--    report trigger and ads_report_submit) also checks Work Completed's minimum, so those functions are not copied again. The maximums alone are
--    private.report_word_max (a draft may be short).
-- 2. The work report (Reports menu): its content takes workCompleted and pendingWork (private.clean_task_report; the maximums on every save) and its
--    submission checks the three fields (work_report_submit) instead of "choose your assigned tasks or write a short remark". The task lists stay.
-- Reports made before are not changed; the rules apply when a report is submitted (again), or its text is corrected by a reviewer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The word rules
-- ---------------------------------------------------------------------------
create or replace function private.report_word_max(p_completed text, p_pending text, p_note text)
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
revoke all on function private.report_word_max(text, text, text) from public, anon;
grant execute on function private.report_word_max(text, text, text) to authenticated, service_role;

-- (copy of 20270308000100, changed where marked 20270312000100) a submitted daily report: Work Completed needs at least 10 words
create or replace function private.report_word_limits(p_completed text, p_pending text, p_note text)
returns void language plpgsql immutable set search_path = '' as $$
declare
  n integer;
begin
  perform private.report_word_max(p_completed, p_pending, p_note);
  -- (20270312000100) Work Completed is required
  n := private.word_count(p_completed);
  if n < 10 then raise exception 'VALIDATION_ERROR: Write at least 10 words in Work Completed (now %).', n using errcode = 'P0001'; end if;
end $$;
revoke all on function private.report_word_limits(text, text, text) from public, anon;
grant execute on function private.report_word_limits(text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The work report (Reports menu): the same three fields
-- ---------------------------------------------------------------------------
-- (copy of 20261221000100, changed where marked 20270312000100)
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
  v_work text;
  v_pending text;
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
  -- (20270312000100) the daily report's three fields: Work Completed, Work Pending, Additional Note (remarks), each within its word limit on every save
  -- (Work Completed's minimum is checked on submission, so a draft may be short)
  v_work := nullif(btrim(coalesce(p_content ->> 'workCompleted', '')), '');
  v_pending := nullif(btrim(coalesce(p_content ->> 'pendingWork', '')), '');
  if length(coalesce(v_work, '')) > 4000 or length(coalesce(v_pending, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep each field under 4000 characters.' using errcode = 'P0001';
  end if;
  perform private.report_word_max(v_work, v_pending, v_remarks);
  -- the sections of an older long-form report stay as they were
  if p_old is not null and jsonb_typeof(p_old) = 'object' then
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_out from jsonb_each(p_old) e (k, v)
     where k not in ('assignedTasks', 'completedTasks', 'remarks', 'workCompleted', 'pendingWork');  -- (20270312000100) the form sends these two now
  end if;
  v_out := v_out || jsonb_build_object('assignedTasks', v_a, 'completedTasks', v_c);
  if v_remarks is not null then
    v_out := v_out || jsonb_build_object('remarks', v_remarks);
  end if;
  if v_work is not null then v_out := v_out || jsonb_build_object('workCompleted', v_work); end if;      -- (20270312000100)
  if v_pending is not null then v_out := v_out || jsonb_build_object('pendingWork', v_pending); end if;
  return v_out;
end $$;
revoke all on function private.clean_task_report(jsonb, jsonb) from public, anon, authenticated;

-- (copy of 20261230000200, changed where marked 20270312000100)
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
  -- (20270312000100) every daily report has the same rule: Work Completed 10 to 150 words, Work Pending at most 100, Additional Note at most 50
  -- (it replaces "choose your assigned tasks or write a short remark")
  perform private.report_word_limits(v_content ->> 'workCompleted', v_content ->> 'pendingWork', v_content ->> 'remarks');
  if private.report_date_taken(r.author_id, r.report_date, r.id) then
    raise exception 'CONFLICT: You already have a report for this date.' using errcode = 'P0001';
  end if;
  -- the reviewer must exist now, so a report is never submitted into the void
  -- a Team Member's report goes to THEIR Team Lead (one person: the one shown, notified and allowed to decide)
  if r.kind = 'MEMBER' then
    v_lead := private.direct_lead_of(r.author_id);
    v_n := case when v_lead is null then 0 else 1 end;
  else
    select count(*) into v_n from private.report_reviewers_of(r);
  end if;
  if v_n = 0 then
    raise exception 'CONFLICT: %', case r.kind
      when 'MEMBER' then 'You are not assigned to a Team Lead yet. Ask your Department Head to assign you, then submit again.'
      when 'TEAM_LEAD' then 'No Department Head is set for your department yet. Ask the Super Admin or HR.'
      else 'No active Operations Head is assigned to your department and function yet. Ask the Super Admin to assign one under Operations Heads.' end using errcode = 'P0001';
  end if;
  if r.kind = 'MEMBER' then
    select p.full_name into v_lead_name from public.profiles p where p.id = v_lead;
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
  for v_reviewer in
    select q.x from (select v_lead as x where r.kind = 'MEMBER'
                     union all select y from private.report_reviewers_of(r) y where r.kind <> 'MEMBER') q loop
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

notify pgrst, 'reload schema';
