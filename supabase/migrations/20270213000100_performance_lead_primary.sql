-- =============================================================================
-- Performance Management for Team Leads and Department Heads in every department (docs/TASK_DAILY_REPORTS_PERFORMANCE.md,
-- "Team Lead and Department Head Performance Management, every department"). Run after 20270212000100_attendance_late_after_1030.sql.
-- Safe to run twice; no temp tables; nothing is deleted and no column changes meaning.
--
--   1. The Team-Lead-first rules that 20270210000100 gave International and Reseller now apply to EVERY department:
--      * Team Members have no performance at all (they do not read, calculate, change, resubmit or approve it; they are not notified of it);
--        they submit task daily reports and see their status, as before.
--      * The Team Lead is the evaluator of their members: approving a member's performance needs a rating (1 to 5) and is refused while one of the
--        member's reports in the period is still Pending; a member's performance is not "returned" (their reports are).
--      * The Department Head approves (with a rating) or returns a Team Lead's performance and reads every member with the Team Lead's decision.
--      Kept per department: a member WITHOUT a Team Lead is still decided by the Department Head covering them outside International / Reseller
--      (AI Studio has no Team Leads); in International / Reseller they wait for a Team Lead, as before.
--      Existing member records that were "Returned for correction" (which the member can no longer resubmit) go back to Pending for their Team Lead
--      (history: REOPENED); approved records and their figures are not touched.
--   2. The Team Lead may edit a member's PENDING daily report before deciding it (task_report_reviewer_edit): what was done, progress, pending work,
--      reason for delay, remarks, with a required reason. The before/after values are kept in the report's history (EDITED) and the audit log, the
--      member is notified, and the figures follow. The member's own submission rules (validation) apply to the edited report too.
--   3. The reviewer may update the rating and remarks of an APPROVED evaluation (performance_record_update_evaluation): the Team Lead for a member,
--      the Department Head for a Team Lead. History (UPDATED, before/after), audit; a Team Lead is notified, a member is not.
--   The overview is redefined only for its leadDecidesMembers flag (true for a Team Lead; for a Department Head: members without a Team Lead wait).
--   4. performance_member_work(member, start, end): the tasks of one person in a period with the latest report on each, for the Team Lead's (and the
--      Department Head's) drill-down. Who may read it: whoever may read the person's performance (never the member themselves).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Columns and the history actions
-- ---------------------------------------------------------------------------
alter table public.task_daily_reports add column if not exists edited_by uuid references public.profiles (id) on delete set null;
alter table public.task_daily_reports add column if not exists edited_by_name text;
alter table public.task_daily_reports add column if not exists edited_at timestamptz;
alter table public.task_daily_report_history add column if not exists changes jsonb;
alter table public.performance_record_history add column if not exists changes jsonb;

alter table public.task_daily_report_history drop constraint if exists task_daily_report_history_action_check;
alter table public.task_daily_report_history add constraint task_daily_report_history_action_check
  check (action in ('SUBMITTED', 'APPROVED', 'RETURNED', 'RESUBMITTED', 'EDITED'));
alter table public.performance_record_history drop constraint if exists performance_record_history_action_check;
alter table public.performance_record_history add constraint performance_record_history_action_check
  check (action in ('GENERATED', 'REFRESHED', 'APPROVED', 'RETURNED', 'RESUBMITTED', 'UPDATED', 'REOPENED'));

-- ---------------------------------------------------------------------------
-- 1. Team-Lead-first, every department
-- ---------------------------------------------------------------------------
-- 20270210000100 asked this for the unified departments only; every caller (row level security, overview, record json, review, resubmit) uses it,
-- so the rules apply to all departments, existing and future, from here on.
create or replace function private.perf2_strict(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select true
$$;
revoke all on function private.perf2_strict(uuid) from public, anon, authenticated;

-- The reviewer of a member's report (and performance): their Team Lead. A member without a Team Lead is decided by the Department Head covering them,
-- except in International / Reseller (private.dept_is_unified), where they wait for a Team Lead (20270210000100's rule, kept). Never null.
create or replace function private.tdr_reviews(p_author uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_id() is not null and p_author is distinct from auth.uid() and (
    private.direct_lead_of(p_author) is not distinct from auth.uid()
    or (private.direct_lead_of(p_author) is null and not private.dept_is_unified(p_department) and private.head_covers(auth.uid(), p_department, p_team))), false)
$$;
revoke all on function private.tdr_reviews(uuid, uuid, uuid) from public, anon, authenticated;

-- A member's record returned under the old rules cannot be resubmitted by the member any more: back to Pending for the Team Lead (once; idempotent).
with reopened as (
  update public.performance_records r set status = 'PENDING', version = r.version + 1, refreshed_at = now()
   where r.subject_role = 'TEAM_MEMBER' and r.status = 'RETURNED'
  returning r.id, r.score
)
insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score, remarks)
select o.id, 'REOPENED', null, null, 'RETURNED', 'PENDING', o.score, 'The Team Lead now evaluates team members: back to Pending for the Team Lead.' from reopened o;

-- The overview: 20270210000100 with the flag that tells the screens who decides members (a Team Lead always decides their members; for a Department
-- Head it says whether members without a Team Lead wait for one). A Team Member is refused in every department (perf2_strict above).
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
    -- every department (20270213000100): performance is the Team Lead's; the member reports on their tasks and sees nothing of their performance
    if private.perf2_strict(me.department_id) then
      raise exception 'FORBIDDEN: Performance Management is for Team Leads and Department Heads. Submit your daily reports on your assigned tasks; your Team Lead reviews them.' using errcode = '42501';
    end if;
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
      'pendingRecords', (select count(*) from jsonb_array_elements(v_members) x where x #>> '{record,status}' = 'PENDING'),
      -- every department: the Team Lead evaluates their members
      'leadDecidesMembers', true);
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
    'pendingRecords', (select count(*) from jsonb_array_elements(v_leads) x where x #>> '{record,status}' = 'PENDING'),
    -- members WITHOUT a Team Lead: they wait for one (International / Reseller) or the Department Head decides them (every other department)
    'leadDecidesMembers', private.dept_is_unified(v_dept));
end $$;
revoke all on function public.performance_overview(date, date, uuid) from public, anon;
grant execute on function public.performance_overview(date, date, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. A report as the screens see it (20270209000100 + who edited it and whether the caller may edit it)
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
    'editedBy', r.edited_by_name, 'editedAt', r.edited_at,
    'canReview', r.status = 'PENDING' and private.tdr_reviews(r.author_id, r.department_id, r.team_id),
    'canReviewerEdit', r.status = 'PENDING' and private.tdr_reviews(r.author_id, r.department_id, r.team_id),
    'canEdit', r.status = 'RETURNED' and r.author_id = auth.uid())
    from public.work_tasks t, public.profiles a where t.id = r.task_id and a.id = r.author_id
$$;
revoke all on function private.tdr_json(public.task_daily_reports) from public, anon, authenticated;

-- 20270209000100 + each history step carries its changes (the reviewer's edit: field -> {from, to})
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
                                        'remarks', h.remarks, 'revision', h.revision, 'changes', h.changes) order by h.id)
      from public.task_daily_report_history h where h.report_id = r.id), '[]'::jsonb));
end $$;
revoke all on function public.task_report_get(uuid) from public, anon;
grant execute on function public.task_report_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The Team Lead edits a member's waiting report (then approves or returns it as before)
-- ---------------------------------------------------------------------------
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
  if p_progress < 100 and t.due_date is not null and t.due_date < r.report_date and v_delay is null then
    raise exception 'VALIDATION_ERROR: The task is past its deadline: give the reason for the delay.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_reason, '')) < 5 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Say why you changed the report (5 to 1000 characters); the team member reads it.' using errcode = 'P0001';
  end if;

  if r.work_completed is distinct from v_work then v_changes := v_changes || jsonb_build_object('workCompleted', jsonb_build_object('from', r.work_completed, 'to', v_work)); end if;
  if r.progress is distinct from p_progress then v_changes := v_changes || jsonb_build_object('progress', jsonb_build_object('from', r.progress, 'to', p_progress)); end if;
  if r.pending_work is distinct from v_pending then v_changes := v_changes || jsonb_build_object('pendingWork', jsonb_build_object('from', r.pending_work, 'to', v_pending)); end if;
  if r.delay_reason is distinct from v_delay then v_changes := v_changes || jsonb_build_object('delayReason', jsonb_build_object('from', r.delay_reason, 'to', v_delay)); end if;
  if r.remarks is distinct from v_remarks then v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', r.remarks, 'to', v_remarks)); end if;
  -- a double click or a retry with the same values changes nothing and records nothing
  if v_changes = '{}'::jsonb then
    return private.tdr_json(r);
  end if;

  update public.task_daily_reports set work_completed = v_work, progress = p_progress, pending_work = v_pending, delay_reason = v_delay, remarks = v_remarks,
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
-- 4. A record as the screens see it (20270210000100 + canUpdate: the reviewer may update an approved evaluation)
-- ---------------------------------------------------------------------------
create or replace function private.perf2_record_json(r public.performance_records)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'status', r.status, 'version', r.version, 'score', r.score, 'generatedAt', r.generated_at, 'refreshedAt', r.refreshed_at,
    'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewRemarks', r.review_remarks, 'rating', r.rating,
    'canDecide', r.status = 'PENDING' and private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id),
    -- a member cannot correct a performance record, so it is not returned to them (the reports are)
    'canReturn', r.status = 'PENDING' and private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id)
                 and not (r.subject_role = 'TEAM_MEMBER' and private.perf2_strict(r.department_id)),
    'ratingRequired', private.perf2_strict(r.department_id),
    'waitingReports', private.perf2_waiting_reports(r),
    'canUpdate', r.status = 'APPROVED' and private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id),
    'canResubmit', r.status = 'RETURNED' and r.subject_id = auth.uid() and not (r.subject_role = 'TEAM_MEMBER' and private.perf2_strict(r.department_id))) end
$$;
revoke all on function private.perf2_record_json(public.performance_records) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The reviewer updates the rating and remarks of an approved evaluation (the approved figures stay as approved)
-- ---------------------------------------------------------------------------
create or replace function public.performance_record_update_evaluation(p_record uuid, p_rating integer, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.performance_records;
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_changes jsonb := '{}'::jsonb;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'VALIDATION_ERROR: The rating is from 1 to 5.' using errcode = 'P0001';
  end if;
  if length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The remarks are too long.' using errcode = 'P0001';
  end if;
  select * into r from public.performance_records where id = p_record for update;
  if r.id is null or not private.perf2_can_view(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Performance record not found.' using errcode = 'P0001';
  end if;
  if not private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'FORBIDDEN: %', case when r.subject_role = 'TEAM_HEAD' then 'Only the Department Head evaluates a Team Lead''s performance.'
                                         else 'Only the Team Lead evaluates a team member''s performance.' end using errcode = '42501';
  end if;
  if r.status <> 'APPROVED' then
    raise exception 'CONFLICT: Only an approved evaluation can be updated; review the pending one instead.' using errcode = 'P0001';
  end if;
  if r.rating is distinct from p_rating then v_changes := v_changes || jsonb_build_object('rating', jsonb_build_object('from', r.rating, 'to', p_rating)); end if;
  if r.review_remarks is distinct from v_remarks then v_changes := v_changes || jsonb_build_object('remarks', jsonb_build_object('from', r.review_remarks, 'to', v_remarks)); end if;
  if v_changes = '{}'::jsonb then
    return private.perf2_record_json(r);  -- the same values again (a retry): nothing to record
  end if;
  update public.performance_records set rating = p_rating, review_remarks = v_remarks, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now()
   where id = r.id returning * into r;
  insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score, remarks, rating, changes)
  values (r.id, 'UPDATED', me.id, me.full_name, 'APPROVED', 'APPROVED', r.score, v_remarks, r.rating, v_changes);
  perform private.write_audit('PERFORMANCE_RECORD_EVALUATION_UPDATED', 'performance_record', r.id, r.department_id, r.team_id,
    jsonb_build_object('subject', r.subject_id, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'changes', v_changes));
  -- a Team Lead reads their own performance; a member does not, so they are not told
  if r.subject_role = 'TEAM_HEAD' then
    perform private.notify(r.subject_id, 'REPORT_PERFORMANCE_UPDATED', 'Your performance evaluation was updated',
      format('%s to %s · rating %s/5', to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY'), r.rating), 'performance_record', r.id, '{}'::jsonb, 'normal');
  end if;
  return private.perf2_record_json(r);
end $$;
revoke all on function public.performance_record_update_evaluation(uuid, integer, text) from public, anon;
grant execute on function public.performance_record_update_evaluation(uuid, integer, text) to authenticated;

-- 20270210000100 + each step's changes (an updated evaluation: rating / remarks from -> to)
create or replace function public.performance_record_history(p_record uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.performance_records;
begin
  select * into r from public.performance_records where id = p_record;
  if r.id is null or not private.perf2_can_view(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Performance record not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('action', h.action, 'by', h.actor_name, 'at', h.created_at, 'from', h.from_status, 'to', h.to_status,
                                                       'score', h.score, 'remarks', h.remarks, 'rating', h.rating, 'changes', h.changes) order by h.id)
                     from public.performance_record_history h where h.record_id = r.id), '[]'::jsonb);
end $$;
revoke all on function public.performance_record_history(uuid) from public, anon;
grant execute on function public.performance_record_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. One person's work in a period: the tasks (as performance counts them) with the latest report on each
-- ---------------------------------------------------------------------------
create or replace function public.performance_member_work(p_subject uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.profiles;
  v_today date := private.perf2_today();
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'VALIDATION_ERROR: Choose a period of at most one year.' using errcode = 'P0001';
  end if;
  select * into s from public.profiles where id = p_subject;
  -- the person themselves is refused too (a member has no performance; a Team Lead reads their own in the overview)
  if s.id is null or s.id = auth.uid() or s.role not in ('TEAM_MEMBER', 'TEAM_HEAD')
     or not private.perf2_can_view(s.id, s.role::text, s.department_id, s.team_id) then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('id', s.id, 'name', s.full_name, 'role', s.role, 'periodStart', p_start, 'periodEnd', p_end,
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority, 'dueDate', t.due_date, 'progress', t.progress,
               'assignedAt', t.created_at, 'completedAt', t.completed_at,
               'overdue', t.status <> 'COMPLETED' and t.due_date is not null and t.due_date < v_today,
               'onTime', case when t.status = 'COMPLETED' and t.completed_at is not null and t.due_date is not null
                              then (t.completed_at at time zone 'Asia/Kolkata')::date <= t.due_date end,
               'reports', (select count(*) from public.task_daily_reports x where x.task_id = t.id and x.report_date between p_start and p_end),
               'pendingReports', (select count(*) from public.task_daily_reports x where x.task_id = t.id and x.status = 'PENDING' and x.report_date between p_start and p_end),
               'lastReport', (select jsonb_build_object('id', x.id, 'reportDate', x.report_date, 'progress', x.progress, 'status', x.status)
                                from public.task_daily_reports x where x.task_id = t.id order by x.report_date desc, x.submitted_at desc limit 1))
             order by (t.status = 'COMPLETED'), t.due_date nulls last, t.created_at desc)
        from (select w.* from public.work_tasks w
               where w.assignee_id = s.id and coalesce(w.due_date, (w.created_at at time zone 'Asia/Kolkata')::date) between p_start and p_end
               order by w.due_date nulls last, w.created_at desc limit 300) t), '[]'::jsonb));
end $$;
revoke all on function public.performance_member_work(uuid, date, date) from public, anon;
grant execute on function public.performance_member_work(uuid, date, date) to authenticated;
