-- =============================================================================
-- Daily and weekly reporting hierarchy (docs/REPORTING_HIERARCHY.md). Run after 20270305000100_lead_tags.sql. Additive and safe to run twice; no temp
-- tables; no report, approval or history row is deleted; no column changes meaning.
--
--                                    DAILY                                              WEEKLY
--   every department but AI Studio   Team Member -> Team Lead -> Department Head          Department Head -> Operations Head (then HR, unchanged)
--   AI Studio                        Team Member -> Team Lead -> HR (the named viewers)   Team Lead -> Department Head (the Super Admin)
--
-- 1. AI Studio daily: the Team Lead's approval of a Team Member's report is FINAL (Approved). The existing trigger sends it to HR's named viewers once
--    (ai_studio_report_hr_sends); the Department Head step after it is gone. A member without a Team Lead, and a Team Lead's own report, keep the
--    Department Head step (they have no Team Lead). Reports a Team Lead already approved that waited for the Department Head become Approved (approved at
--    the Team Lead's time); their history, approvals and HR send records are kept.
-- 2. AI Studio weekly (new, in AI Studio's own reports): a Team Lead writes one weekly team report per week (team-wise and project-wise figures from the
--    week's approved daily reports and tasks, plus completed work, pending work, achievements, challenges, remarks) for the Super Admin, who receives
--    it as AI Studio's Department Head (acknowledge, or return for revision). HR, the Operations Head and everyone else cannot read it.
-- 3. AI Studio is kept out of the normal department cycle: no Department Head -> Operations Head weekly report for AI Studio (refused, and AI Studio
--    is left out of the weekly scopes, so it is not listed as "missing an Operations Head"), and no new hierarchical work report (work_reports) for an
--    AI Studio person: AI Studio people report in AI Studio. Existing rows are untouched.
-- 4. The weekly department report (Department Head -> Operations Head) also carries pending work, achievements and challenges.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. AI Studio daily: the Team Lead's approval is final
-- ---------------------------------------------------------------------------
-- (copy of 20270302000100; changed where marked 20270306000100)
create or replace function public.ai_studio_report_review(p_report uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'HEAD', 'ADMIN']);
  v_me uuid := auth.uid();
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  r public.ai_studio_daily_reports;
  v_from text;
  v_stage text;
  v_name text;
  pr_name text;
begin
  if p_decision not in ('APPROVE', 'RETURN', 'REJECT') then raise exception 'VALIDATION_ERROR: Choose Approve, Return or Reject.' using errcode = 'P0001'; end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'VALIDATION_ERROR: The remarks can have at most 2000 characters.' using errcode = 'P0001'; end if;
  if p_decision = 'RETURN' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write the remarks the employee should act on.' using errcode = 'P0001';
  end if;
  -- (20270302000100) a rejection always says why
  if p_decision = 'REJECT' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write the reason for the rejection.' using errcode = 'P0001';
  end if;
  select * into r from public.ai_studio_daily_reports where id = p_report for update;
  if r.id is null or not private.ai_studio_can_see_report(r) then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  if r.author_id = v_me then raise exception 'FORBIDDEN: You cannot decide your own report.' using errcode = '42501'; end if;
  if not private.ai_studio_can_review(r) then
    raise exception 'CONFLICT: This report is not waiting for your decision.' using errcode = 'P0001';
  end if;
  v_from := r.status;
  if p_decision = 'REJECT' and v_from <> 'PENDING_TL_APPROVAL' then
    raise exception 'CONFLICT: Only the Team Lead rejects a report, at their step. Return it instead.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.profiles where id = v_me;
  select name into pr_name from public.ai_studio_projects where id = r.project_id;

  if v_from = 'PENDING_TL_APPROVAL' then
    v_stage := 'TEAM_LEAD';
    update public.ai_studio_daily_reports
       -- (20270306000100) the Team Lead's approval is final for a Team Member's report: Approved, and sent to HR (the trigger)
       set status = case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED_BY_TL' else 'RETURNED_BY_TL' end,
           lead_id = v_me, lead_name = v_name, tl_reviewed_by = v_me, tl_reviewed_at = now(), tl_comment = v_comment,
           approved_at = case when p_decision = 'APPROVE' then now() else approved_at end
     where id = r.id returning * into r;
  else
    v_stage := 'DEPARTMENT_HEAD';
    update public.ai_studio_daily_reports
       set status = case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED_BY_DH' end,
           dh_reviewed_by = v_me, dh_reviewed_at = now(), dh_comment = v_comment,
           approved_at = case when p_decision = 'APPROVE' then now() else null end
     where id = r.id returning * into r;
  end if;
  -- a rejection is recorded as the Team Lead's RETURNED step whose result is REJECTED_BY_TL (the history actions are unchanged)
  perform private.ai_studio_event(r, case p_decision when 'APPROVE' then 'APPROVED' else 'RETURNED' end, v_stage, v_from, v_comment);
  perform private.write_audit('AI_STUDIO_REPORT_' || case p_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'RETURNED' end, 'ai_studio_report', r.id,
                              private.ai_studio_department(), null, jsonb_build_object('stage', v_stage, 'from', v_from, 'to', r.status, 'author', r.author_id));

  -- (20270302000100) the reviewer's own confirmation (a notification to oneself is not sent by private.notify)
  perform private.ai_studio_self_notice(v_me, 'AI_STUDIO_REPORT_DECIDED',
    format('You %s %s''s daily report', case p_decision when 'APPROVE' then 'approved' when 'REJECT' then 'rejected' else 'returned' end, r.author_name),
    format('%s · %s%s', coalesce(pr_name, 'Daily report'), to_char(r.report_date, 'DD Mon YYYY'),
           case when p_decision = 'APPROVE' and r.hr_sent_at is not null and r.hr_sent_revision = r.revision then ' · sent to HR' else '' end), r.id);
  if p_decision = 'REJECT' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_REJECTED', 'Your Team Lead rejected your daily report',
      format('%s · %s: %s', coalesce(pr_name, 'Daily report'), to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
  elsif v_stage = 'TEAM_LEAD' and p_decision = 'APPROVE' then
    -- (20270306000100) final: no Department Head step follows; the report has gone to HR
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_TL_APPROVED', 'Your daily report was approved by your Team Lead',
      format('%s · %s. Approved and sent to HR.', coalesce(pr_name, 'Daily report'), to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
  elsif v_stage = 'TEAM_LEAD' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_RETURNED', 'Your Team Lead returned your daily report',
      format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
  elsif p_decision = 'APPROVE' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_APPROVED', 'Your daily report was approved',
      format('%s · %s. Final approval by the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    if r.lead_id is not null then
      perform private.notify(r.lead_id, 'AI_STUDIO_REPORT_APPROVED', format('%s''s daily report was approved', r.author_name),
        format('%s · %s · final approval by the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    end if;
  else
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_RETURNED', 'The Department Head returned your daily report',
      format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
    if r.lead_id is not null then
      perform private.notify(r.lead_id, 'AI_STUDIO_REPORT_RETURNED', format('%s''s daily report was returned by the Department Head', r.author_name),
        format('%s · %s: %s', pr_name, to_char(r.report_date, 'DD Mon YYYY'), v_comment), 'ai_studio_report', r.id);
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_review(uuid, text, text) from public, anon;
grant execute on function public.ai_studio_report_review(uuid, text, text) to authenticated;

-- the reports a Team Lead already approved that waited for the Department Head: Approved now, at the Team Lead's time (they were sent to HR already)
update public.ai_studio_daily_reports
   set status = 'APPROVED', approved_at = coalesce(approved_at, tl_reviewed_at)
 where author_role = 'MEMBER' and status = 'PENDING_DH_APPROVAL' and tl_reviewed_at is not null;

-- ---------------------------------------------------------------------------
-- 2. AI Studio weekly: Team Lead -> the Super Admin (AI Studio's Department Head)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_studio_weekly_reports (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.profiles (id) on delete cascade,
  lead_name text,
  week_start date not null check (extract(isodow from week_start) = 1),
  week_end date not null,
  status text not null default 'DRAFT' check (status in ('DRAFT', 'SUBMITTED', 'RETURNED', 'ACKNOWLEDGED')),
  completed_work text check (completed_work is null or length(completed_work) <= 4000),
  pending_work text check (pending_work is null or length(pending_work) <= 4000),
  achievements text check (achievements is null or length(achievements) <= 4000),
  challenges text check (challenges is null or length(challenges) <= 4000),
  remarks text check (remarks is null or length(remarks) <= 4000),
  stats jsonb,
  revision integer not null default 1,
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, week_start)
);
create index if not exists ai_studio_weekly_reports_week_idx on public.ai_studio_weekly_reports (week_start desc, status);
alter table public.ai_studio_weekly_reports enable row level security;
revoke all on public.ai_studio_weekly_reports from public, anon, authenticated;

create table if not exists public.ai_studio_weekly_report_events (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.ai_studio_weekly_reports (id) on delete cascade,
  action text not null check (action in ('SAVED', 'SUBMITTED', 'RESUBMITTED', 'ACKNOWLEDGED', 'RETURNED')),
  from_status text,
  to_status text not null,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  comment text,
  revision integer not null,
  created_at timestamptz not null default now()
);
create index if not exists ai_studio_weekly_report_events_report_idx on public.ai_studio_weekly_report_events (report_id, id);
alter table public.ai_studio_weekly_report_events enable row level security;
revoke all on public.ai_studio_weekly_report_events from public, anon, authenticated;

-- the Super Admins (AI Studio's Department Head) who receive the weekly reports
create or replace function private.ai_studio_weekly_receiver_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE'
$$;
revoke all on function private.ai_studio_weekly_receiver_ids() from public, anon, authenticated;

-- a Team Lead's week, from the records: team-wise (each member who reports to them) and project-wise. Only approved daily reports count as approved.
create or replace function private.ai_studio_weekly_stats(p_lead uuid, p_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz constant text := 'Asia/Kolkata';
  v_end date := p_start + 6;
  v_members jsonb;
  v_projects jsonb;
begin
  with team as (
    select m.id, m.full_name from public.profiles m
     where m.status = 'ACTIVE' and m.role = 'TEAM_MEMBER' and private.direct_lead_of(m.id) = p_lead
  ), people as (select id, full_name, false as is_lead from team union all select l.id, l.full_name, true from public.profiles l where l.id = p_lead)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'name', p.full_name, 'isLead', p.is_lead,
           'reportsSubmitted', (select count(*) from public.ai_studio_daily_reports r where r.author_id = p.id and r.status <> 'DRAFT' and r.report_date between p_start and v_end),
           'reportsApproved', (select count(*) from public.ai_studio_daily_reports r where r.author_id = p.id and r.report_date between p_start and v_end
                                 and private.perf2_ai_report_state(r) = 'APPROVED'),
           'tasksCompleted', (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status = 'COMPLETED'
                                and (t.completed_at at time zone v_tz)::date between p_start and v_end),
           'tasksPending', (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status <> 'COMPLETED'
                              and (t.created_at at time zone v_tz)::date <= v_end),
           'tasksOverdue', (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status <> 'COMPLETED'
                              and t.due_date is not null and t.due_date <= v_end and t.due_date < private.ai_studio_today()))
         order by p.is_lead desc, p.full_name), '[]'::jsonb)
    into v_members from people p;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.project_id, 'name', x.name, 'tasksCompleted', x.done, 'tasksPending', x.open, 'people', x.people) order by x.name), '[]'::jsonb)
    into v_projects
    from (select t.project_id, pr.name,
                 count(*) filter (where t.status = 'COMPLETED' and (t.completed_at at time zone v_tz)::date between p_start and v_end) as done,
                 count(*) filter (where t.status <> 'COMPLETED' and (t.created_at at time zone v_tz)::date <= v_end) as open,
                 count(distinct t.assignee_id) as people
            from public.ai_studio_tasks t join public.ai_studio_projects pr on pr.id = t.project_id
           where (t.assignee_id = p_lead or private.direct_lead_of(t.assignee_id) = p_lead)
             and ((t.status = 'COMPLETED' and (t.completed_at at time zone v_tz)::date between p_start and v_end)
                  or (t.status <> 'COMPLETED' and (t.created_at at time zone v_tz)::date <= v_end))
           group by t.project_id, pr.name) x;

  return jsonb_build_object(
    'weekStart', p_start, 'weekEnd', v_end, 'team', private.ai_studio_team_label(p_lead), 'members', v_members, 'projects', v_projects,
    'totals', jsonb_build_object(
      'members', (select count(*) from jsonb_array_elements(v_members) m where not (m ->> 'isLead')::boolean),
      'reportsSubmitted', (select coalesce(sum((m ->> 'reportsSubmitted')::int), 0) from jsonb_array_elements(v_members) m),
      'reportsApproved', (select coalesce(sum((m ->> 'reportsApproved')::int), 0) from jsonb_array_elements(v_members) m),
      'tasksCompleted', (select coalesce(sum((m ->> 'tasksCompleted')::int), 0) from jsonb_array_elements(v_members) m),
      'tasksPending', (select coalesce(sum((m ->> 'tasksPending')::int), 0) from jsonb_array_elements(v_members) m),
      'projects', jsonb_array_length(v_projects)));
end $$;
revoke all on function private.ai_studio_weekly_stats(uuid, date) from public, anon, authenticated;

create or replace function private.ai_studio_weekly_json(w public.ai_studio_weekly_reports)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', w.id, 'leadId', w.lead_id, 'leadName', coalesce(w.lead_name, (select full_name from public.profiles where id = w.lead_id)),
    'team', private.ai_studio_team_label(w.lead_id), 'weekStart', w.week_start, 'weekEnd', w.week_end, 'status', w.status,
    'completedWork', w.completed_work, 'pendingWork', w.pending_work, 'achievements', w.achievements, 'challenges', w.challenges, 'remarks', w.remarks,
    -- the figures as they were when it was submitted; a draft shows the live figures
    'stats', coalesce(w.stats, private.ai_studio_weekly_stats(w.lead_id, w.week_start)),
    'revision', w.revision, 'submittedAt', w.submitted_at, 'reviewedBy', w.reviewed_by_name, 'reviewedAt', w.reviewed_at, 'reviewComment', w.review_comment,
    'updatedAt', w.updated_at,
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'action', e.action, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                                                             'actor', e.actor_name, 'comment', e.comment, 'revision', e.revision) order by e.id)
                          from public.ai_studio_weekly_report_events e where e.report_id = w.id), '[]'::jsonb))
$$;
revoke all on function private.ai_studio_weekly_json(public.ai_studio_weekly_reports) from public, anon, authenticated;

-- may the caller read this weekly report: its Team Lead, or the Super Admin. Nobody else (not HR, not an Operations Head, not another Team Lead).
create or replace function private.ai_studio_weekly_visible(w public.ai_studio_weekly_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(w.lead_id = auth.uid() or private.is_super_admin(), false)
$$;
revoke all on function private.ai_studio_weekly_visible(public.ai_studio_weekly_reports) from public, anon, authenticated;

-- the Team Lead's week: their report (or none yet) and the live figures
create or replace function public.ai_studio_weekly_report_get(p_week_start date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  w public.ai_studio_weekly_reports;
begin
  perform private.ai_studio_require(array['LEAD']);
  perform private.week_check(p_week_start);
  select * into w from public.ai_studio_weekly_reports where lead_id = auth.uid() and week_start = p_week_start;
  return jsonb_build_object('weekStart', p_week_start, 'weekEnd', p_week_start + 6,
                            'report', case when w.id is null then null else private.ai_studio_weekly_json(w) end,
                            'liveStats', private.ai_studio_weekly_stats(auth.uid(), p_week_start));
end $$;
revoke all on function public.ai_studio_weekly_report_get(date) from public, anon;
grant execute on function public.ai_studio_weekly_report_get(date) to authenticated;

create or replace function public.ai_studio_weekly_report_save(p_week_start date, p_completed text, p_pending text, p_achievements text, p_challenges text,
                                                               p_remarks text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  w public.ai_studio_weekly_reports;
  v_from text;
  v_to text;
  x uuid;
begin
  perform private.ai_studio_require(array['LEAD']);
  perform private.week_check(p_week_start);
  if p_week_start > private.ai_studio_today() then
    raise exception 'VALIDATION_ERROR: The week has not started yet.' using errcode = 'P0001';
  end if;
  if greatest(length(coalesce(p_completed, '')), length(coalesce(p_pending, '')), length(coalesce(p_achievements, '')), length(coalesce(p_challenges, '')),
              length(coalesce(p_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep each part under 4000 characters.' using errcode = 'P0001';
  end if;
  if p_submit and length(btrim(coalesce(p_completed, ''))) < 10 then
    raise exception 'VALIDATION_ERROR: Describe the work your team completed this week (at least 10 characters) before submitting.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  insert into public.ai_studio_weekly_reports (lead_id, lead_name, week_start, week_end) values (me.id, me.full_name, p_week_start, p_week_start + 6)
  on conflict (lead_id, week_start) do nothing;
  select * into w from public.ai_studio_weekly_reports where lead_id = me.id and week_start = p_week_start for update;
  v_from := w.status;
  if v_from in ('SUBMITTED', 'ACKNOWLEDGED') then
    raise exception 'CONFLICT: This week was already submitted.' using errcode = 'P0001';
  end if;
  v_to := case when p_submit then 'SUBMITTED' else v_from end;
  update public.ai_studio_weekly_reports
     set completed_work = nullif(btrim(p_completed), ''), pending_work = nullif(btrim(p_pending), ''), achievements = nullif(btrim(p_achievements), ''),
         challenges = nullif(btrim(p_challenges), ''), remarks = nullif(btrim(p_remarks), ''), lead_name = me.full_name, status = v_to,
         revision = case when p_submit and v_from = 'RETURNED' then revision + 1 else revision end,
         -- the figures are fixed when it is submitted; a draft keeps none (it shows the live ones)
         stats = case when p_submit then private.ai_studio_weekly_stats(me.id, p_week_start) else null end,
         submitted_at = case when p_submit then now() else submitted_at end,
         reviewed_by = case when p_submit then null else reviewed_by end, reviewed_by_name = case when p_submit then null else reviewed_by_name end,
         reviewed_at = case when p_submit then null else reviewed_at end, review_comment = case when p_submit then null else review_comment end,
         updated_at = now()
   where id = w.id returning * into w;
  insert into public.ai_studio_weekly_report_events (report_id, action, from_status, to_status, actor_id, actor_name, revision)
  values (w.id, case when not p_submit then 'SAVED' when v_from = 'RETURNED' then 'RESUBMITTED' else 'SUBMITTED' end, v_from, v_to, me.id, me.full_name, w.revision);
  if p_submit then
    perform private.write_audit('AI_STUDIO_WEEKLY_REPORT_SUBMITTED', 'ai_studio_weekly_report', w.id, private.ai_studio_department(), null,
      jsonb_build_object('weekStart', w.week_start, 'revision', w.revision));
    -- the Super Admin, as AI Studio's Department Head (never HR, never an Operations Head)
    for x in select private.ai_studio_weekly_receiver_ids() loop
      perform private.notify(x, 'AI_STUDIO_WEEKLY_REPORT', format('AI Studio weekly report: %s', private.ai_studio_team_label(me.id)),
        format('%s %s the weekly report for %s to %s.', me.full_name, case when v_from = 'RETURNED' then 'resubmitted' else 'submitted' end,
               to_char(w.week_start, 'DD Mon'), to_char(w.week_end, 'DD Mon YYYY')), 'ai_studio_weekly_report', w.id);
    end loop;
  end if;
  return private.ai_studio_weekly_json(w);
end $$;
revoke all on function public.ai_studio_weekly_report_save(date, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.ai_studio_weekly_report_save(date, text, text, text, text, text, boolean) to authenticated;

-- the list: the Super Admin sees every Team Lead's submitted weeks; a Team Lead their own
create or replace function public.ai_studio_weekly_reports_list(p_week_start date default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'LEAD']);
begin
  if p_week_start is not null then perform private.week_check(p_week_start); end if;
  if p_status is not null and p_status not in ('DRAFT', 'SUBMITTED', 'RETURNED', 'ACKNOWLEDGED') then
    raise exception 'VALIDATION_ERROR: Unknown status.' using errcode = 'P0001';
  end if;
  return coalesce((select jsonb_agg(private.ai_studio_weekly_json(w) order by w.week_start desc, w.lead_name)
                     from public.ai_studio_weekly_reports w
                    where (case when v_role = 'ADMIN' then w.status <> 'DRAFT' else w.lead_id = auth.uid() end)
                      and (p_week_start is null or w.week_start = p_week_start)
                      and (p_status is null or w.status = p_status)), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_weekly_reports_list(date, text) from public, anon;
grant execute on function public.ai_studio_weekly_reports_list(date, text) to authenticated;

create or replace function public.ai_studio_weekly_report_open(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  w public.ai_studio_weekly_reports;
begin
  perform private.ai_studio_require(array['ADMIN', 'LEAD']);
  select * into w from public.ai_studio_weekly_reports where id = p_id;
  if w.id is null or not private.ai_studio_weekly_visible(w) or (w.status = 'DRAFT' and w.lead_id <> auth.uid()) then
    raise exception 'NOT_FOUND: Weekly report not found.' using errcode = 'P0002';
  end if;
  return private.ai_studio_weekly_json(w);
end $$;
revoke all on function public.ai_studio_weekly_report_open(uuid) from public, anon;
grant execute on function public.ai_studio_weekly_report_open(uuid) to authenticated;

-- the Super Admin acknowledges a week, or returns it to the Team Lead for a revision (with what to change)
create or replace function public.ai_studio_weekly_report_review(p_id uuid, p_decision text, p_comment text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  w public.ai_studio_weekly_reports;
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_to text;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin, as AI Studio''s Department Head, reviews the AI Studio weekly reports.' using errcode = '42501';
  end if;
  if p_decision not in ('ACKNOWLEDGE', 'RETURN') then raise exception 'VALIDATION_ERROR: Choose Acknowledge or Return.' using errcode = 'P0001'; end if;
  if p_decision = 'RETURN' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write what the Team Lead should change.' using errcode = 'P0001';
  end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'VALIDATION_ERROR: Keep the comment under 2000 characters.' using errcode = 'P0001'; end if;
  select * into w from public.ai_studio_weekly_reports where id = p_id for update;
  if w.id is null or w.status = 'DRAFT' then raise exception 'NOT_FOUND: Weekly report not found.' using errcode = 'P0002'; end if;
  if w.status <> 'SUBMITTED' then raise exception 'CONFLICT: This weekly report is not waiting for a review.' using errcode = 'P0001'; end if;
  select * into me from public.profiles where id = auth.uid();
  v_to := case p_decision when 'ACKNOWLEDGE' then 'ACKNOWLEDGED' else 'RETURNED' end;
  update public.ai_studio_weekly_reports
     set status = v_to, reviewed_by = me.id, reviewed_by_name = me.full_name, reviewed_at = now(), review_comment = v_comment, updated_at = now()
   where id = w.id returning * into w;
  insert into public.ai_studio_weekly_report_events (report_id, action, from_status, to_status, actor_id, actor_name, comment, revision)
  values (w.id, case p_decision when 'ACKNOWLEDGE' then 'ACKNOWLEDGED' else 'RETURNED' end, 'SUBMITTED', v_to, me.id, me.full_name, v_comment, w.revision);
  perform private.write_audit('AI_STUDIO_WEEKLY_REPORT_' || v_to, 'ai_studio_weekly_report', w.id, private.ai_studio_department(), null,
    jsonb_build_object('weekStart', w.week_start, 'revision', w.revision));
  perform private.notify(w.lead_id, case p_decision when 'ACKNOWLEDGE' then 'AI_STUDIO_WEEKLY_ACKNOWLEDGED' else 'AI_STUDIO_WEEKLY_RETURNED' end,
    case p_decision when 'ACKNOWLEDGE' then 'Your weekly report was acknowledged' else 'Your weekly report was returned for a revision' end,
    format('%s to %s%s', to_char(w.week_start, 'DD Mon'), to_char(w.week_end, 'DD Mon YYYY'), coalesce(': ' || v_comment, '')), 'ai_studio_weekly_report', w.id);
  return private.ai_studio_weekly_json(w);
end $$;
revoke all on function public.ai_studio_weekly_report_review(uuid, text, text) from public, anon;
grant execute on function public.ai_studio_weekly_report_review(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. AI Studio is not in the normal department cycle
-- ---------------------------------------------------------------------------
-- the weekly scopes (Department Head -> Operations Head) leave AI Studio out (copy of 20261230000200 + one condition): the Operations Heads' boards and the
-- Super Admin's routing review no longer list AI Studio as a department waiting for an Operations Head
create or replace function private.weekly_scopes()
returns table (department_id uuid, division text) language sql stable security definer set search_path = '' as $$
  select distinct s.department_id, o.division
    from public.profiles h
    cross join lateral private.scopes_of(h.id) s
    cross join lateral private.weekly_scope_options(s.department_id, s.division) o
   where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE'
     and s.department_id is distinct from private.ai_studio_department()   -- (20270306000100)
$$;
revoke all on function private.weekly_scopes() from public, anon, authenticated;

-- no new hierarchical work report (daily, Team Lead or Department Head) and no new weekly department package for AI Studio, whichever function writes
-- it; rows that exist are untouched (only a new row, or a draft being submitted, is refused)
create or replace function private.tg_reports_not_ai_studio()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.ai_studio_department() is null or private.base_department(new.department_id) is distinct from private.ai_studio_department() then
    return new;
  end if;
  if tg_op = 'INSERT' or (old.status in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED') and new.status not in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED')) then
    raise exception 'FORBIDDEN: AI Studio reports are written in AI Studio (daily: Team Member -> Team Lead -> HR; weekly: Team Lead -> Super Admin).' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_reports_not_ai_studio() from public, anon, authenticated;
drop trigger if exists work_reports_not_ai_studio on public.work_reports;
create trigger work_reports_not_ai_studio before insert or update of status on public.work_reports
  for each row execute function private.tg_reports_not_ai_studio();
drop trigger if exists work_report_packages_not_ai_studio on public.work_report_packages;
create trigger work_report_packages_not_ai_studio before insert or update of status on public.work_report_packages
  for each row execute function private.tg_reports_not_ai_studio();

-- ---------------------------------------------------------------------------
-- 4. The weekly department report also carries pending work, achievements and challenges
-- ---------------------------------------------------------------------------
alter table public.work_report_packages add column if not exists pending_overview text;
alter table public.work_report_packages add column if not exists achievements text;
alter table public.work_report_packages add column if not exists challenges text;

-- (copy of 20261230000200; adds the three parts)
create or replace function private.package_json(p public.work_report_packages)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when p.id is null then jsonb_build_object('status', 'NOT_SUBMITTED')
    else jsonb_build_object('id', p.id, 'status', p.status, 'title', p.title, 'assignedOverview', p.assigned_overview, 'completedOverview', p.completed_overview,
      'pendingOverview', p.pending_overview, 'achievements', p.achievements, 'challenges', p.challenges,
      'note', p.note, 'revision', p.revision, 'submittedBy', p.submitted_by_name, 'submittedAt', p.submitted_at, 'periodType', p.period_type,
      'periodStart', p.period_start, 'periodEnd', p.period_end, 'stats', p.stats, 'function', coalesce(p.division, 'ALL'),
      'ohReviewer', p.oh_reviewer_name, 'ohReviewedAt', p.oh_reviewed_at, 'ohComment', p.oh_comment,
      'sentToHrAt', p.sent_to_hr_at, 'hrCompletedAt', p.hr_completed_at,
      'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.created_at, 'actor', e.actor_name, 'action', e.action, 'fromStatus', e.from_status,
                            'toStatus', e.to_status, 'comment', e.comment, 'revision', e.revision) order by e.id)
                           from public.work_report_package_events e where e.package_id = p.id), '[]'::jsonb)) end
$$;
revoke all on function private.package_json(public.work_report_packages) from public, anon, authenticated;

-- the save (copy of 20270217000100; adds the three parts and refuses AI Studio, marked 20270306000100). The earlier seven-argument version is replaced.
drop function if exists public.work_report_weekly_save(date, text, text, text, text, boolean, text);
create or replace function public.work_report_weekly_save(
  p_week_start date, p_title text, p_assigned_overview text, p_completed_overview text, p_remarks text, p_submit boolean,
  p_division text, p_pending_overview text default null, p_achievements text default null, p_challenges text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_dept uuid;
  v_div text;
  pk public.work_report_packages;
  v_to date := p_week_start + 6;
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
  v_status text;
  v_from text;
  v_action text;
  v_oh uuid;
  v_stats jsonb;
  v_empty boolean;
  v_direct boolean;
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
  if length(coalesce(p_assigned_overview, '')) > 2000 or length(coalesce(p_completed_overview, '')) > 2000 or length(coalesce(p_remarks, '')) > 2000
     or length(coalesce(p_pending_overview, '')) > 2000 or length(coalesce(p_achievements, '')) > 2000 or length(coalesce(p_challenges, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep each summary under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select s.department_id, s.division into v_dept, v_div from private.my_weekly_scope(p_division) s;
  -- (20270306000100) AI Studio is not in the Department Head -> Operations Head cycle: its Team Leads report to the Super Admin
  if v_dept is not distinct from private.ai_studio_department() then
    raise exception 'FORBIDDEN: AI Studio weekly reports are written by its Team Leads for the Super Admin, not sent to an Operations Head.' using errcode = '42501';
  end if;
  v_empty := v_title is null and nullif(btrim(coalesce(p_assigned_overview, '')), '') is null and nullif(btrim(coalesce(p_completed_overview, '')), '') is null
             and nullif(btrim(coalesce(p_remarks, '')), '') is null and nullif(btrim(coalesce(p_pending_overview, '')), '') is null
             and nullif(btrim(coalesce(p_achievements, '')), '') is null and nullif(btrim(coalesce(p_challenges, '')), '') is null;
  if p_submit then
    if v_title is null or length(v_title) < 3 then
      raise exception 'VALIDATION_ERROR: Enter the weekly report title before submitting.' using errcode = 'P0001';
    end if;
  end if;
  -- nobody to approve it (no Operations Head for this department and function, or the assigned one is not active): it goes straight to HR
  v_direct := p_submit and not exists (select 1 from private.weekly_reviewer_ids(v_dept, v_div));
  v_stats := private.report_scope_stats(v_dept, null, p_week_start, v_to, v_div);

  select * into pk from public.work_report_packages
   where id = (private.weekly_package(v_dept, v_div, p_week_start, v_to)).id for update;
  -- a week still waiting for an Operations Head who is no longer there can be sent to HR instead of staying stuck
  if pk.id is not null and pk.status not in ('DRAFT', 'COMPILING', 'REVISION_REQUIRED') and not (v_direct and pk.status = 'PENDING_OPERATIONS_HEAD') then
    raise exception 'CONFLICT: This week was already submitted.' using errcode = 'P0001';
  end if;
  v_from := pk.status;
  v_status := case when v_direct then 'SENT_TO_HR' when p_submit then 'PENDING_OPERATIONS_HEAD' when v_empty and (pk.id is null or pk.status = 'COMPILING') then 'COMPILING'
                   when pk.status = 'REVISION_REQUIRED' then 'REVISION_REQUIRED' else 'DRAFT' end;
  if pk.id is null then
    insert into public.work_report_packages (department_id, division, period_type, period_start, period_end, title, assigned_overview, completed_overview, note,
                                             pending_overview, achievements, challenges,
                                             status, stats, submitted_by, submitted_by_name, submitted_at, sent_to_hr_at)
    values (v_dept, v_div, 'WEEKLY', p_week_start, v_to, v_title, nullif(btrim(p_assigned_overview), ''), nullif(btrim(p_completed_overview), ''), nullif(btrim(p_remarks), ''),
            nullif(btrim(p_pending_overview), ''), nullif(btrim(p_achievements), ''), nullif(btrim(p_challenges), ''),
            v_status, v_stats, me.id, me.full_name, now(), case when v_direct then now() end)
    returning * into pk;
    perform private.package_event(pk.id, case when v_status = 'COMPILING' then 'COMPILED' when v_direct then 'SENT_TO_HR_DIRECT' when p_submit then 'SUBMITTED' else 'SAVED' end, null, v_status, null, pk.revision);
  else
    update public.work_report_packages
       set title = v_title, assigned_overview = nullif(btrim(p_assigned_overview), ''), completed_overview = nullif(btrim(p_completed_overview), ''),
           note = nullif(btrim(p_remarks), ''), status = v_status,
           pending_overview = nullif(btrim(p_pending_overview), ''), achievements = nullif(btrim(p_achievements), ''), challenges = nullif(btrim(p_challenges), ''), stats = v_stats, submitted_by = me.id, submitted_by_name = me.full_name,
           -- an unsubmitted week made before this migration (whole department) becomes the head's function week
           division = coalesce(division, v_div),
           revision = case when p_submit and v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
           submitted_at = case when p_submit then now() else submitted_at end,
           sent_to_hr_at = case when v_direct then now() else sent_to_hr_at end,
           oh_reviewer_id = case when p_submit then null else oh_reviewer_id end, oh_reviewer_name = case when p_submit then null else oh_reviewer_name end,
           oh_reviewed_at = case when p_submit then null else oh_reviewed_at end, oh_comment = case when p_submit then null else oh_comment end,
           updated_at = now()
     where id = pk.id returning * into pk;
    perform private.package_event(pk.id, case when v_direct then 'SENT_TO_HR_DIRECT' when p_submit and v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' when p_submit then 'SUBMITTED' when v_status = 'COMPILING' then 'COMPILED' else 'SAVED' end,
                                  v_from, v_status, null, pk.revision);
  end if;
  if p_submit then
    v_action := case when v_from = 'REVISION_REQUIRED' then 'resubmitted' else 'submitted' end;
    if v_direct then
      for v_oh in select * from private.hr_reviewer_ids() loop
        perform private.notify(v_oh, 'REPORT_WEEKLY_SENT_TO_HR',
          format('Weekly report ready for performance review: %s%s', (select d.name from public.departments d where d.id = v_dept), coalesce(' ' || private.function_label(pk.division), '')),
          format('%s sent the weekly report for %s to %s directly to HR (no Operations Head is assigned). Review each Team Lead and Team Member.', me.full_name, to_char(p_week_start, 'DD Mon'), to_char(v_to, 'DD Mon YYYY')),
          'work_report_package', pk.id);
      end loop;
    end if;
    for v_oh in select * from private.weekly_reviewer_ids(v_dept, pk.division) loop
      perform private.notify(v_oh, 'REPORT_PACKAGE_SUBMITTED',
        format('Weekly department report: %s%s', (select d.name from public.departments d where d.id = v_dept), coalesce(' ' || private.function_label(pk.division), '')),
        format('%s %s the weekly report for %s to %s and it is waiting for your approval.', me.full_name, v_action, to_char(p_week_start, 'DD Mon'), to_char(v_to, 'DD Mon YYYY')),
        'work_report_package', pk.id);
    end loop;
    perform private.write_audit('WORK_REPORT_PACKAGE_' || upper(v_action), 'department', v_dept, v_dept, null,
      jsonb_build_object('from', p_week_start, 'to', v_to, 'revision', pk.revision, 'function', pk.division, 'sentDirectlyToHr', v_direct));
  end if;
  return private.package_json(pk);
end $$;

revoke all on function public.work_report_weekly_save(date, text, text, text, text, boolean, text, text, text, text) from public, anon;
grant execute on function public.work_report_weekly_save(date, text, text, text, text, boolean, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
