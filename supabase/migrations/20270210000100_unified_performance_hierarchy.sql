-- =============================================================================
-- International and Reseller: performance is decided by the Team Lead, never by the Team Member (docs/TASK_DAILY_REPORTS_PERFORMANCE.md,
-- "International and Reseller: the strict hierarchy"). Run after 20270209000100_task_daily_reports_performance.sql. Additive and safe to run twice;
-- nothing is deleted and no column changes meaning.
--
-- 20270209000100 lets every Team Member read (My Performance) and resubmit their own performance record, and lets the Department Head decide the reports
-- of a member who has no Team Lead. For a department flagged unified_sales_support (International, Reseller) the owner asked for:
--   * Team Member: no performance at all - they do not read, calculate, modify or approve it (overview, records, history, resubmit are refused);
--     they submit task daily reports and see their status, as before.
--   * Team Lead: the only evaluator of their members. They approve or return the daily reports; they finalize a member's performance by approving
--     it with a rating (1 to 5). Only approved reports count: a member's performance cannot be approved while one of their reports in the period is
--     still waiting. A member's performance is not "returned" (the member cannot correct it): the Team Lead returns the daily reports instead.
--   * Department Head: approves or returns the Team Lead's performance, with a rating when approving; reads the members' performance and the Team
--     Lead's decision; never decides a member's report or performance (also not for a member without a Team Lead: they wait for one).
-- Every other department keeps the 20270209000100 behaviour exactly (the rating is optional there).
--
-- Also fixed, for every department: tdr_reviews, tdr_can_view and perf2_can_view could return NULL (not false) for a member without a Team Lead, and the
-- functions test `if not <check>`, which a NULL passes - so, for example, someone allowed to read a report could decide it, or a record's history could be read
-- by a colleague. The three checks now always return true or false (found by unified_performance_hierarchy_test.sql).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. The rating the reviewer gives when approving (1 = poor ... 5 = excellent), kept on the record and in its history
-- ---------------------------------------------------------------------------
alter table public.performance_records add column if not exists rating smallint;
alter table public.performance_records drop constraint if exists performance_records_rating_check;
alter table public.performance_records add constraint performance_records_rating_check check (rating is null or rating between 1 and 5);
alter table public.performance_record_history add column if not exists rating smallint;

-- A department whose Team Lead alone evaluates the members (the flag the International / Reseller rules already use, so a new such department is data).
create or replace function private.perf2_strict(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.dept_is_unified(p_department)
$$;
revoke all on function private.perf2_strict(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Who decides / reads
-- ---------------------------------------------------------------------------
-- The reviewer of a member's report (and performance): their Team Lead. The Department Head stands in for a missing Team Lead only outside the strict
-- departments; there a member without a Team Lead waits until one is named (direct_lead_of is read at decision time, so nothing is lost).
create or replace function private.tdr_reviews(p_author uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  -- always true or false (never null): the callers test `if not tdr_reviews(...)`, which a null would pass
  select coalesce(private.my_id() is not null and p_author is distinct from auth.uid() and (
    private.direct_lead_of(p_author) is not distinct from auth.uid()
    or (private.direct_lead_of(p_author) is null and not private.perf2_strict(p_department) and private.head_covers(auth.uid(), p_department, p_team))), false)
$$;
revoke all on function private.tdr_reviews(uuid, uuid, uuid) from public, anon, authenticated;

-- A strict department's Team Member does not read their own performance (row level security and every function use this).
-- Always true or false: a member without a Team Lead made `direct_lead_of(...) = auth.uid()` null, and `if ... not perf2_can_view(...)` lets a null through.
create or replace function private.perf2_can_view(p_subject uuid, p_role text, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_id() is not null and (
    (p_subject = auth.uid() and not (p_role = 'TEAM_MEMBER' and private.perf2_strict(p_department)))
    or private.my_role() = 'SUPER_ADMIN'
    or private.head_covers(auth.uid(), p_department, p_team)
    or (p_role = 'TEAM_MEMBER' and private.direct_lead_of(p_subject) is not distinct from auth.uid())), false)
$$;
revoke all on function private.perf2_can_view(uuid, text, uuid, uuid) from public, anon;
grant execute on function private.perf2_can_view(uuid, text, uuid, uuid) to authenticated, service_role;  -- used by the row level security policies

-- Reading a task report (20270209000100's rule, unchanged), made null-safe for the same reason: task_report_get / task_report_review test `not tdr_can_view(...)`.
create or replace function private.tdr_can_view(p_author uuid, p_department uuid, p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_id() is not null and (
    p_author = auth.uid() or private.my_role() = 'SUPER_ADMIN'
    or private.direct_lead_of(p_author) is not distinct from auth.uid()
    or private.head_covers(auth.uid(), p_department, p_team)), false)
$$;
revoke all on function private.tdr_can_view(uuid, uuid, uuid) from public, anon;
grant execute on function private.tdr_can_view(uuid, uuid, uuid) to authenticated, service_role;  -- used by the row level security policies

-- Reports of the member still waiting for a decision in the record's period (an approval would use unreviewed work).
create or replace function private.perf2_waiting_reports(r public.performance_records)
returns integer language sql stable security definer set search_path = '' as $$
  select case when r.subject_role = 'TEAM_MEMBER' then
    (select count(*)::int from public.task_daily_reports x where x.author_id = r.subject_id and x.status = 'PENDING' and x.report_date between r.period_start and r.period_end)
  else 0 end
$$;
revoke all on function private.perf2_waiting_reports(public.performance_records) from public, anon, authenticated;

create or replace function private.perf2_record_json(r public.performance_records)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'status', r.status, 'version', r.version, 'score', r.score, 'generatedAt', r.generated_at, 'refreshedAt', r.refreshed_at,
    'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewRemarks', r.review_remarks, 'rating', r.rating,
    'canDecide', r.status = 'PENDING' and private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id),
    -- a strict department's member cannot correct a performance record, so it is not returned to them (the reports are)
    'canReturn', r.status = 'PENDING' and private.perf2_can_decide(r.subject_id, r.subject_role, r.department_id, r.team_id)
                 and not (r.subject_role = 'TEAM_MEMBER' and private.perf2_strict(r.department_id)),
    'ratingRequired', private.perf2_strict(r.department_id),
    'waitingReports', private.perf2_waiting_reports(r),
    'canResubmit', r.status = 'RETURNED' and r.subject_id = auth.uid() and not (r.subject_role = 'TEAM_MEMBER' and private.perf2_strict(r.department_id))) end
$$;
revoke all on function private.perf2_record_json(public.performance_records) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The overview (20270209000100 + a strict department's member is refused, and the screen is told who decides members)
-- ---------------------------------------------------------------------------
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
    -- International / Reseller: performance is the Team Lead's; the member reports on their tasks and sees nothing of their performance
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
      'leadDecidesMembers', private.perf2_strict(me.department_id));
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
    -- the screen says who decides the members: their Team Lead only (strict), or the Department Head for members without one
    'leadDecidesMembers', private.perf2_strict(v_dept));
end $$;
revoke all on function public.performance_overview(date, date, uuid) from public, anon;
grant execute on function public.performance_overview(date, date, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Resubmitting a returned record: never a strict department's member (20270209000100 + one check)
-- ---------------------------------------------------------------------------
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
  if me.role = 'TEAM_MEMBER' and private.perf2_strict(r.department_id) then
    raise exception 'FORBIDDEN: Your Team Lead decides your performance. Correct the daily reports they returned instead.' using errcode = '42501';
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

-- ---------------------------------------------------------------------------
-- 5. Approving a record: the rating, and the strict department's rules (20270209000100's checks are kept as they were)
-- ---------------------------------------------------------------------------
-- The old 4-argument version is replaced by one with p_rating (default null): a call that names the four old arguments still resolves to it.
drop function if exists public.performance_record_review(uuid, text, text, integer);
create or replace function public.performance_record_review(p_record uuid, p_decision text, p_remarks text default null, p_version integer default null, p_rating integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.performance_records;
  v_to text;
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  v_strict boolean;
  v_waiting integer;
begin
  select * into me from public.profiles where id = private.my_id();
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if upper(coalesce(p_decision, '')) not in ('APPROVE', 'RETURN') then
    raise exception 'VALIDATION_ERROR: Choose Approve or Return for correction.' using errcode = 'P0001';
  end if;
  if p_rating is not null and p_rating not between 1 and 5 then
    raise exception 'VALIDATION_ERROR: The rating is from 1 to 5.' using errcode = 'P0001';
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
  v_strict := private.perf2_strict(r.department_id);
  if v_strict and r.subject_role = 'TEAM_MEMBER' and v_to = 'RETURNED' then
    raise exception 'VALIDATION_ERROR: A team member''s performance is not returned to them. Return their daily reports for correction, then approve the performance.' using errcode = 'P0001';
  end if;
  if v_to = 'RETURNED' and length(coalesce(v_remarks, '')) < 5 then
    raise exception 'VALIDATION_ERROR: Say what must be corrected (at least 5 characters).' using errcode = 'P0001';
  end if;
  if length(coalesce(v_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: The remarks are too long.' using errcode = 'P0001';
  end if;
  if v_strict and v_to = 'APPROVED' and p_rating is null then
    raise exception 'VALIDATION_ERROR: Give a rating from 1 to 5 before approving.' using errcode = 'P0001';
  end if;
  -- only approved reports finalize a member's performance: decide the waiting ones first
  v_waiting := private.perf2_waiting_reports(r);
  if v_strict and v_to = 'APPROVED' and v_waiting > 0 then
    raise exception 'CONFLICT: % daily report% of this team member % still waiting for your review in this period. Approve or return % first.',
      v_waiting, case when v_waiting = 1 then '' else 's' end, case when v_waiting = 1 then 'is' else 'are' end, case when v_waiting = 1 then 'it' else 'them' end using errcode = 'P0001';
  end if;
  update public.performance_records set status = v_to, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_remarks = v_remarks,
         rating = case when v_to = 'APPROVED' then p_rating else null end
   where id = r.id returning * into r;
  insert into public.performance_record_history (record_id, action, actor_id, actor_name, from_status, to_status, score, remarks, rating)
  values (r.id, v_to, me.id, me.full_name, 'PENDING', v_to, r.score, v_remarks, r.rating);
  perform private.write_audit('PERFORMANCE_RECORD_' || v_to, 'performance_record', r.id, r.department_id, r.team_id,
    jsonb_build_object('subject', r.subject_id, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'score', r.score, 'rating', r.rating));
  -- a strict department's member is not shown their performance, so they are not told about it either
  if not (v_strict and r.subject_role = 'TEAM_MEMBER') then
    perform private.notify(r.subject_id, 'REPORT_PERFORMANCE_' || v_to,
      case when v_to = 'APPROVED' then 'Your performance was approved' else 'Your performance was returned for correction' end,
      format('%s to %s%s', to_char(r.period_start, 'DD Mon'), to_char(r.period_end, 'DD Mon YYYY'), case when v_remarks is null then '' else ' · ' || left(v_remarks, 160) end),
      'performance_record', r.id, '{}'::jsonb, case when v_to = 'RETURNED' then 'urgent' else 'normal' end);
  end if;
  return private.perf2_record_json(r);
end $$;
revoke all on function public.performance_record_review(uuid, text, text, integer, integer) from public, anon;
grant execute on function public.performance_record_review(uuid, text, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Histories: one record's steps (with the rating), and every evaluation of one person (all periods)
-- ---------------------------------------------------------------------------
create or replace function public.performance_record_history(p_record uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.performance_records;
begin
  select * into r from public.performance_records where id = p_record;
  if r.id is null or not private.perf2_can_view(r.subject_id, r.subject_role, r.department_id, r.team_id) then
    raise exception 'NOT_FOUND: Performance record not found.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('action', h.action, 'by', h.actor_name, 'at', h.created_at, 'from', h.from_status, 'to', h.to_status,
                                                       'score', h.score, 'remarks', h.remarks, 'rating', h.rating) order by h.id)
                     from public.performance_record_history h where h.record_id = r.id), '[]'::jsonb);
end $$;
revoke all on function public.performance_record_history(uuid) from public, anon;
grant execute on function public.performance_record_history(uuid) to authenticated;

-- The evaluation history of one person: their records of every period the caller may read, newest first (the Team Lead keeps a member's history,
-- the Department Head a Team Lead's and the members'). Someone the caller may not read is "not found", whatever exists.
create or replace function public.performance_subject_history(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.profiles;
  v jsonb;
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select * into s from public.profiles where id = p_subject;
  if s.id is null or s.role not in ('TEAM_MEMBER', 'TEAM_HEAD') or not private.perf2_can_view(s.id, s.role::text, s.department_id, s.team_id) then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'periodStart', r.period_start, 'periodEnd', r.period_end, 'status', r.status, 'score', r.score, 'rating', r.rating,
           'reviewedBy', r.reviewed_by_name, 'reviewedAt', r.reviewed_at, 'reviewRemarks', r.review_remarks) order by r.period_start desc, r.period_end desc), '[]'::jsonb)
    into v
    from (select x.* from public.performance_records x
           where x.subject_id = s.id and private.perf2_can_view(x.subject_id, x.subject_role, x.department_id, x.team_id)
           order by x.period_start desc, x.period_end desc limit 104) r;
  return jsonb_build_object('id', s.id, 'name', s.full_name, 'role', s.role, 'records', v);
end $$;
revoke all on function public.performance_subject_history(uuid) from public, anon;
grant execute on function public.performance_subject_history(uuid) to authenticated;

-- an index for "every record of one person"
create index if not exists performance_records_subject_idx on public.performance_records (subject_id, period_start desc);
