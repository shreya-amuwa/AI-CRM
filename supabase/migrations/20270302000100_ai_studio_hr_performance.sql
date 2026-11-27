-- =============================================================================
-- AI Studio: daily report approval to HR, and HR's AI Studio Performance (docs/AI_STUDIO_HR_PERFORMANCE.md).
-- Run after 20270301000100. Additive and safe to run twice; no temporary tables; nothing is deleted; no column changes meaning.
--
-- WHAT EXISTED (reused, not duplicated): ai_studio_daily_reports (one report per person and day built from the tasks, 20270219000100), its review
--   Team Member -> their Team Lead -> Department Head (ai_studio_report_review), its history (ai_studio_report_events), the shared Performance
--   Management that already reads AI Studio's reports (20270214000100), projects / project members / tasks, and the Team Lead of a member
--   (private.direct_lead_of). A "team" in AI Studio is a Team Lead and the members who report to them.
-- WHAT THIS ADDS:
--   1. Daily Work Description (work_description): 10 to 150 real words to submit a daily report (private.word_count: words with a letter or a
--      digit, never characters). Checked by the save function AND by a trigger on every submission of a daily report. Reports that existed before
--      this migration are not held to it (description_required = false), so a returned older report can still be resubmitted; the older one-task
--      report (its own form, kept for the reports made with it) has no description field and is not held to it either.
--   2. Reject at the Team Lead's step (REJECTED_BY_TL, reason required, final: it cannot be edited or resubmitted). Return keeps its meaning
--      (correct and resubmit). Performance counts a rejected report as not approved.
--   3. Sent to HR (hr_sent_at / hr_sent_revision): set by the database, once per revision, when
--        * a Team Lead approves a Team Member's report (the Department Head's step that follows is unchanged), or
--        * the Department Head approves the report of a Team Member who has no Team Lead (that IS their approval), or
--        * a Team Lead submits their own daily report (their team report; its review by the Department Head is unchanged).
--      At commit it is recorded in ai_studio_report_hr_sends (one row per revision: the key makes it once) and shown in the report's history as
--      "Sent to HR", and the AI Studio Performance HR viewers are notified. A report that is
--      later returned / rejected stops showing as approved for HR (it keeps hr_sent_at as history).
--   4. Who sees it: ai_studio_hr_viewers - HR employees the Super Admin names (e.g. Simran Kumari), nobody by default; other HR staff do not get
--      access. The Super Admin keeps access. Every function below checks this; the tables stay closed to the browser.
--   5. Notifications: the author on submission ("submitted successfully"), the reviewer's own confirmation of a decision, the author on
--      rejection, the HR viewers on every report sent to them. Each is written once per event (the state changes once; a second click is refused).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns, statuses, history actions
-- ---------------------------------------------------------------------------
alter table public.ai_studio_daily_reports add column if not exists work_description text;
alter table public.ai_studio_daily_reports drop constraint if exists ai_studio_daily_reports_work_description_check;
alter table public.ai_studio_daily_reports add constraint ai_studio_daily_reports_work_description_check check (work_description is null or length(work_description) <= 2000);
-- reports that existed before this migration are not held to the word rule; every report made from now on is
alter table public.ai_studio_daily_reports add column if not exists description_required boolean not null default false;
alter table public.ai_studio_daily_reports alter column description_required set default true;
alter table public.ai_studio_daily_reports add column if not exists hr_sent_at timestamptz;
alter table public.ai_studio_daily_reports add column if not exists hr_sent_revision integer;
create index if not exists ai_studio_daily_reports_hr_idx on public.ai_studio_daily_reports (report_date desc) where hr_sent_at is not null;

alter table public.ai_studio_daily_reports drop constraint if exists ai_studio_daily_reports_status_check;
alter table public.ai_studio_daily_reports add constraint ai_studio_daily_reports_status_check
  check (status in ('DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'REJECTED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED'));
-- The history actions are NOT changed (an older migration that is run again re-adds its own list): a rejection is the Team Lead's RETURNED step whose
-- result is REJECTED_BY_TL, and "Sent to HR" has its own record below, shown in the report's history.
-- One row per report revision sent to HR: the primary key makes "sent once per revision" a database rule.
create table if not exists public.ai_studio_report_hr_sends (
  report_id uuid not null references public.ai_studio_daily_reports (id) on delete cascade,
  revision integer not null,
  status text not null,
  sent_at timestamptz not null default clock_timestamp(),
  primary key (report_id, revision)
);
alter table public.ai_studio_report_hr_sends enable row level security;
revoke all on public.ai_studio_report_hr_sends from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The word rule
-- ---------------------------------------------------------------------------
-- words, not characters: whitespace-separated pieces that contain at least one letter or digit ("-" or "..." alone is not a word)
create or replace function private.word_count(p text)
returns integer language sql immutable set search_path = '' as $$
  select count(*)::int from regexp_split_to_table(btrim(coalesce(p, '')), '\s+') w where w ~ '[[:alnum:]]'
$$;
revoke all on function private.word_count(text) from public, anon;
grant execute on function private.word_count(text) to authenticated, service_role;

create or replace function private.ai_studio_check_description(p text)
returns void language plpgsql immutable set search_path = '' as $$
declare
  n integer := private.word_count(p);
begin
  if n < 10 then
    raise exception 'VALIDATION_ERROR: Write at least 10 words in the daily work description (now %).', n using errcode = 'P0001';
  end if;
  if n > 150 then
    raise exception 'VALIDATION_ERROR: The daily work description can have at most 150 words (now %).', n using errcode = 'P0001';
  end if;
end $$;
revoke all on function private.ai_studio_check_description(text) from public, anon;
grant execute on function private.ai_studio_check_description(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. HR viewers of AI Studio Performance (named by the Super Admin)
-- ---------------------------------------------------------------------------
create table if not exists public.ai_studio_hr_viewers (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now()
);
alter table public.ai_studio_hr_viewers enable row level security;
revoke all on public.ai_studio_hr_viewers from public, anon, authenticated;

-- an active HR staff member named by the Super Admin (removed from HR or suspended = no access, without anybody having to remember it)
create or replace function private.ai_studio_hr_viewer_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select v.profile_id from public.ai_studio_hr_viewers v where private.is_hr_staff_profile(v.profile_id)
     and exists (select 1 from public.profiles p where p.id = v.profile_id and p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN')
$$;
revoke all on function private.ai_studio_hr_viewer_ids() from public, anon, authenticated;

create or replace function private.ai_studio_hr_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.is_super_admin() or auth.uid() in (select private.ai_studio_hr_viewer_ids()), false)
$$;
revoke all on function private.ai_studio_hr_access() from public, anon;
grant execute on function private.ai_studio_hr_access() to authenticated, service_role;

-- a notification to oneself (private.notify never notifies the actor): the confirmations of one's own actions; not repeated while unread
create or replace function private.ai_studio_self_notice(p_to uuid, p_type text, p_title text, p_body text, p_report uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (recipient_id, type, title, body, entity_type, entity_id, actor_id, data, priority)
  select p_to, p_type, p_title, coalesce(p_body, ''), 'ai_studio_report', p_report, p_to, '{}'::jsonb, 'normal'
   where p_to is not null
     and not exists (select 1 from public.notifications n where n.recipient_id = p_to and n.type = p_type and n.entity_id = p_report
                       and n.title = p_title and n.body = coalesce(p_body, '') and n.read_at is null)
$$;
revoke all on function private.ai_studio_self_notice(uuid, text, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. One trigger for every submission and decision, whichever function makes it: the word rule, "submitted" confirmation, Sent to HR
-- ---------------------------------------------------------------------------
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
create trigger ai_studio_report_flow before insert or update of status on public.ai_studio_daily_reports
  for each row execute function private.tg_ai_studio_report_flow();

-- the report was sent to HR (a new revision): its history entry and the named HR employees' notification, at the end of the transaction
create or replace function private.tg_ai_studio_report_sent()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_lead uuid := case when new.author_role = 'LEAD' then new.author_id else coalesce(new.tl_reviewed_by, new.lead_id) end;
  v_title text := case when new.author_role = 'LEAD' then format('New AI Studio Team Lead report: %s', new.author_name)
                       else format('New approved AI Studio daily report: %s', new.author_name) end;
  v_body text := format('%s · %s%s', to_char(new.report_date, 'DD Mon YYYY'), private.ai_studio_team_label(v_lead),
                        case when new.revision > 1 then format(' · revision %s', new.revision) else '' end);
  x uuid;
  v_rows integer;
begin
  insert into public.ai_studio_report_hr_sends (report_id, revision, status) values (new.id, new.revision, new.status) on conflict do nothing;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return null; end if;   -- this revision was already sent: nothing twice
  for x in select private.ai_studio_hr_viewer_ids() loop
    perform private.notify(x, case when new.author_role = 'LEAD' then 'AI_STUDIO_REPORT_TO_HR_LEAD' else 'AI_STUDIO_REPORT_TO_HR' end, v_title, v_body, 'ai_studio_report', new.id);
  end loop;
  return null;
end $$;
revoke all on function private.tg_ai_studio_report_sent() from public, anon, authenticated;
drop trigger if exists ai_studio_report_sent on public.ai_studio_daily_reports;
create constraint trigger ai_studio_report_sent after update on public.ai_studio_daily_reports
  deferrable initially deferred
  for each row when (new.hr_sent_revision is distinct from old.hr_sent_revision)
  execute function private.tg_ai_studio_report_sent();

-- ---------------------------------------------------------------------------
-- 5. Saving a daily report: copy of 20270219000100, adds p_description (marked 20270302000100); the old signature is replaced
-- ---------------------------------------------------------------------------
-- Saving a daily report (copy of 20270219000100; adds p_description, marked 20270302000100). The old signature is replaced.
drop function if exists public.ai_studio_daily_report_save(uuid, date, uuid[], text, text, text, text, text, boolean, uuid[]);
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
  if p_submit then perform private.ai_studio_check_description(v_description); end if;
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

-- ---------------------------------------------------------------------------
-- 6. Reviewing: copy of 20270106000100, adds Reject at the Team Lead's step and the reviewer's own confirmation (marked 20270302000100)
-- ---------------------------------------------------------------------------
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
       set status = case p_decision when 'APPROVE' then 'PENDING_DH_APPROVAL' when 'REJECT' then 'REJECTED_BY_TL' else 'RETURNED_BY_TL' end,
           lead_id = v_me, lead_name = v_name, tl_reviewed_by = v_me, tl_reviewed_at = now(), tl_comment = v_comment
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
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_TL_APPROVED', 'Your daily report was approved by your Team Lead',
      format('%s · %s. It now waits for the Department Head.', coalesce(pr_name, 'Daily report'), to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
    perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', r.author_name),
      format('Approved by %s · %s · %s', v_name, pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
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

-- ---------------------------------------------------------------------------
-- 7. What a report shows (copies of 20270219000100, marked 20270302000100): the description, Sent to HR, Reject; the list filters Rejected
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
    -- (20270302000100) when it reached HR's AI Studio Performance (null = not sent), and the Team Lead's approval time
    'sentToHrAt', r.hr_sent_at, 'tlReviewedAt', r.tl_reviewed_at,
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

create or replace function private.ai_studio_report_detail(r public.ai_studio_daily_reports)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_work jsonb;
begin
  if r.project_id is null then v_work := private.ai_studio_report_work_of(r); end if;
  return private.ai_studio_report_row(r) || jsonb_build_object(
    'workCompleted', r.work_completed, 'workInProgress', r.work_in_progress, 'pendingWork', r.pending_work, 'blockers', r.blockers, 'remarks', r.remarks,
    'tomorrowPlan', r.tomorrow_plan,
    'workDescription', r.work_description, 'descriptionRequired', r.description_required,
    'authorDesignation', case r.author_role when 'LEAD' then 'Team Lead' else 'Team Member' end,
    'tlComment', r.tl_comment, 'tlReviewedAt', r.tl_reviewed_at, 'tlReviewerName', (select p.full_name from public.profiles p where p.id = r.tl_reviewed_by),
    'dhComment', r.dh_comment, 'dhReviewedAt', r.dh_reviewed_at, 'dhReviewerName', (select p.full_name from public.profiles p where p.id = r.dh_reviewed_by),
    'canEdit', r.author_id = auth.uid() and r.status in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH'),
    -- (20270302000100) a Team Lead may reject a Team Member's report at their step (final; a return is for corrections)
    'canReject', r.status = 'PENDING_TL_APPROVAL' and private.ai_studio_can_review(r),
    'canReview', private.ai_studio_can_review(r),
    'canLeadEdit', r.status = 'PENDING_TL_APPROVAL' and private.ai_studio_can_review(r),
    'reviewStage', case when r.status = 'PENDING_TL_APPROVAL' then 'TEAM_LEAD' when r.status = 'PENDING_DH_APPROVAL' then 'DEPARTMENT_HEAD' end,
    'frozen', private.ai_studio_report_frozen(r),
    'work', v_work,
    'summary', case when v_work is not null then private.ai_studio_work_summary(v_work) end,
    -- (20270302000100) with "Sent to HR" (its own record), in time order
    'history', coalesce((select jsonb_agg(h.item order by h.at, h.seq) from (
        select e.created_at as at, e.seq, jsonb_build_object('id', e.id, 'action', e.action, 'stage', e.stage, 'fromStatus', e.from_status, 'toStatus', e.to_status,
                                                               'comment', e.comment, 'actorName', e.actor_name, 'actorRole', e.actor_role, 'revision', e.revision,
                                                               'createdAt', e.created_at, 'changes', e.changes) as item
          from public.ai_studio_report_events e where e.report_id = r.id
        union all
        select s.sent_at, null::bigint, jsonb_build_object('id', r.id::text || ':hr:' || s.revision, 'action', 'SENT_TO_HR', 'stage', null, 'fromStatus', null, 'toStatus', s.status,
                                       'comment', 'Sent to HR (AI Studio Performance).', 'actorName', 'AI CRM', 'actorRole', null, 'revision', s.revision,
                                       'createdAt', s.sent_at, 'changes', null)
          from public.ai_studio_report_hr_sends s where s.report_id = r.id) h), '[]'::jsonb));
end $$;
revoke all on function private.ai_studio_report_detail(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_detail(public.ai_studio_daily_reports) to authenticated, service_role;

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
  if p_status is not null and p_status not in ('DRAFT', 'SUBMITTED', 'PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'REJECTED_BY_TL', 'PENDING_DH_APPROVAL', 'RETURNED_BY_DH', 'APPROVED') then
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

-- ---------------------------------------------------------------------------
-- 8. Performance Management (copy of 20270214000100, marked): a rejected report is never counted as approved
-- ---------------------------------------------------------------------------
create or replace function private.perf2_ai_report_state(r public.ai_studio_daily_reports)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r.status = 'DRAFT' then null
    when r.status in ('RETURNED_BY_TL', 'RETURNED_BY_DH', 'REJECTED_BY_TL') then 'RETURNED'   -- (20270302000100) rejected: never counted as approved
    when r.status = 'APPROVED' then 'APPROVED'
    when r.status = 'PENDING_DH_APPROVAL' and r.tl_reviewed_at is not null then 'APPROVED'   -- the Team Lead approved it; the head's step follows
    else 'PENDING' end
$$;
revoke all on function private.perf2_ai_report_state(public.ai_studio_daily_reports) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Who may open AI Studio Performance in HR, and the Super Admin's control of it
-- ---------------------------------------------------------------------------
create or replace function public.ai_studio_hr_access_info()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_admin boolean := private.is_super_admin();
begin
  return jsonb_build_object(
    'allowed', private.ai_studio_hr_access(),
    'canManage', v_admin,
    -- the names are for the Super Admin only
    'viewers', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email,
                                         'active', p.id in (select private.ai_studio_hr_viewer_ids()), 'grantedAt', v.granted_at) order by p.full_name)
                                       from public.ai_studio_hr_viewers v join public.profiles p on p.id = v.profile_id), '[]'::jsonb) else '[]'::jsonb end,
    'candidates', case when v_admin then coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email) order by p.full_name)
                                       from public.profiles p where p.status = 'ACTIVE' and p.role <> 'SUPER_ADMIN' and private.is_hr_staff_profile(p.id)), '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.ai_studio_hr_access_info() from public, anon;
grant execute on function public.ai_studio_hr_access_info() to authenticated;

create or replace function public.ai_studio_hr_viewer_set(p_profile uuid, p_allowed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  v_rows integer;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin decides who sees AI Studio Performance in HR.' using errcode = '42501';
  end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null then raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001'; end if;
  if coalesce(p_allowed, false) then
    if t.status <> 'ACTIVE' or t.role = 'SUPER_ADMIN' or not private.is_hr_staff_profile(t.id) then
      raise exception 'VALIDATION_ERROR: Choose an active HR employee.' using errcode = 'P0001';
    end if;
    insert into public.ai_studio_hr_viewers (profile_id, granted_by) values (t.id, auth.uid()) on conflict (profile_id) do nothing;
  else
    delete from public.ai_studio_hr_viewers where profile_id = t.id;
  end if;
  get diagnostics v_rows = row_count;
  if v_rows > 0 then
    perform private.write_audit(case when p_allowed then 'AI_STUDIO_HR_VIEWER_GRANTED' else 'AI_STUDIO_HR_VIEWER_REVOKED' end, 'profile', t.id, t.department_id, t.team_id, '{}'::jsonb);
    if p_allowed then
      perform private.notify(t.id, 'AI_STUDIO_REPORT_HR_ACCESS', 'You can now open AI Studio Performance',
        'HR dashboard > AI Studio Performance: the approved AI Studio daily reports, team-wise and project-wise.', 'profile', t.id);
    end if;
  end if;
  return public.ai_studio_hr_access_info();
end $$;
revoke all on function public.ai_studio_hr_viewer_set(uuid, boolean) from public, anon;
grant execute on function public.ai_studio_hr_viewer_set(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. HR's AI Studio Performance: teams, projects, the approved member reports and the Team Lead reports of a period
-- ---------------------------------------------------------------------------
-- the tasks of a report, as HR reads them (a consolidated report: its tasks with that day's work; an older one: its project and task)
create or replace function private.ai_studio_hr_tasks(r public.ai_studio_daily_reports)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if r.project_id is null then
    return coalesce((select jsonb_agg(jsonb_build_object('taskId', w ->> 'taskId', 'title', w ->> 'title', 'projectId', w ->> 'projectId', 'projectName', w ->> 'projectName',
                                                         'status', w ->> 'status', 'progress', (w ->> 'progress')::int, 'completed', w ->> 'completedAt' is not null,
                                                         'notes', (select coalesce(jsonb_agg(e ->> 'note'), '[]'::jsonb) from jsonb_array_elements(w -> 'entries') e where e ->> 'note' is not null)))
                       from jsonb_array_elements(private.ai_studio_report_work_of(r)) w), '[]'::jsonb);
  end if;
  return jsonb_build_array(jsonb_build_object('taskId', r.task_id, 'title', coalesce((select t.title from public.ai_studio_tasks t where t.id = r.task_id), 'No specific task'),
    'projectId', r.project_id, 'projectName', (select p.name from public.ai_studio_projects p where p.id = r.project_id),
    'status', (select t.status from public.ai_studio_tasks t where t.id = r.task_id), 'progress', (select t.progress from public.ai_studio_tasks t where t.id = r.task_id),
    'completed', coalesce((select t.status = 'COMPLETED' from public.ai_studio_tasks t where t.id = r.task_id), false), 'notes', '[]'::jsonb));
end $$;
revoke all on function private.ai_studio_hr_tasks(public.ai_studio_daily_reports) from public, anon, authenticated;

create or replace function public.ai_studio_hr_performance(p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_to date := coalesce(p_to, private.ai_studio_today());
  v_from date := coalesce(p_from, coalesce(p_to, private.ai_studio_today()) - 29);
  v_dept uuid := private.ai_studio_department();
  v_members jsonb;
  v_leads jsonb;
begin
  if not private.ai_studio_hr_access() then
    raise exception 'FORBIDDEN: AI Studio Performance is open to the HR employees the Super Admin named, and to the Super Admin.' using errcode = '42501';
  end if;
  if v_from > v_to then raise exception 'VALIDATION_ERROR: The start date is after the end date.' using errcode = 'P0001'; end if;
  if v_to - v_from > 92 then raise exception 'VALIDATION_ERROR: Choose a period of at most 93 days.' using errcode = 'P0001'; end if;

  -- the Team Members' reports HR has: sent to HR and still approved (a report returned later by the Department Head is not shown as approved)
  with mr as (
    select r.* from public.ai_studio_daily_reports r
     where r.author_role = 'MEMBER' and r.hr_sent_at is not null and r.status in ('PENDING_DH_APPROVAL', 'APPROVED')
       and r.report_date between v_from and v_to
  ), x as (
    select r.*, coalesce(r.tl_reviewed_by, r.lead_id) as lead, private.ai_studio_hr_tasks(r::public.ai_studio_daily_reports) as tasks from mr r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', x.id, 'reportDate', x.report_date, 'memberId', x.author_id, 'memberName', x.author_name,
           'leadId', x.lead, 'leadName', (select l.full_name from public.profiles l where l.id = x.lead), 'teamName', private.ai_studio_team_label(x.lead),
           'tasks', x.tasks,
           'projectIds', (select coalesce(jsonb_agg(distinct t ->> 'projectId'), '[]'::jsonb) from jsonb_array_elements(x.tasks) t where t ->> 'projectId' is not null),
           'description', x.work_description, 'workCompleted', x.work_completed, 'pendingWork', x.pending_work, 'blockers', x.blockers, 'remarks', x.remarks,
           'status', x.status, 'approvalStatus', 'APPROVED',
           'approvedBy', (select p.full_name from public.profiles p where p.id = coalesce(x.tl_reviewed_by, x.dh_reviewed_by)),
           'approvedAt', coalesce(x.tl_reviewed_at, x.dh_reviewed_at), 'sentToHrAt', x.hr_sent_at, 'revision', x.revision,
           'completedTasks', (select count(*) from jsonb_array_elements(x.tasks) t where (t ->> 'completed')::boolean),
           'pendingTasks', (select count(*) from jsonb_array_elements(x.tasks) t where not (t ->> 'completed')::boolean))
         order by x.report_date desc, x.author_name), '[]'::jsonb)
    into v_members from x;

  -- the Team Leads' own reports (their team report) with their team's day built from the APPROVED member reports only
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'reportDate', r.report_date, 'leadId', r.author_id, 'leadName', r.author_name, 'teamName', private.ai_studio_team_label(r.author_id),
           'status', r.status, 'sentToHrAt', r.hr_sent_at,
           'description', r.work_description, 'workCompleted', r.work_completed, 'pendingWork', r.pending_work, 'blockers', r.blockers, 'remarks', r.remarks,
           'tasks', private.ai_studio_hr_tasks(r),
           'teamMembers', (select count(*) from public.profiles m where m.status = 'ACTIVE' and m.role = 'TEAM_MEMBER' and m.department_id = v_dept
                             and private.direct_lead_of(m.id) = r.author_id),
           'approvedMemberReports', (select count(*) from jsonb_array_elements(v_members) a where a ->> 'leadId' = r.author_id::text and a ->> 'reportDate' = r.report_date::text),
           'completedTasks', (select coalesce(sum((a ->> 'completedTasks')::int), 0) from jsonb_array_elements(v_members) a
                                where a ->> 'leadId' = r.author_id::text and a ->> 'reportDate' = r.report_date::text),
           'pendingTasks', (select coalesce(sum((a ->> 'pendingTasks')::int), 0) from jsonb_array_elements(v_members) a
                              where a ->> 'leadId' = r.author_id::text and a ->> 'reportDate' = r.report_date::text),
           'projectIds', (select coalesce(jsonb_agg(distinct t ->> 'projectId'), '[]'::jsonb) from jsonb_array_elements(private.ai_studio_hr_tasks(r)) t where t ->> 'projectId' is not null))
         order by r.report_date desc, r.author_name), '[]'::jsonb)
    into v_leads
    from public.ai_studio_daily_reports r
   where r.author_role = 'LEAD' and r.hr_sent_at is not null and r.status <> 'DRAFT' and r.report_date between v_from and v_to;

  return jsonb_build_object(
    'from', v_from, 'to', v_to,
    -- teams: every active AI Studio Team Lead with the members who report to them; members without a Team Lead form their own group
    'teams', coalesce((select jsonb_agg(t order by t ->> 'teamName') from (
        select jsonb_build_object('leadId', l.id, 'leadName', l.full_name, 'teamName', private.ai_studio_team_label(l.id),
          'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                                  from public.ai_studio_project_members pm join public.ai_studio_projects pr on pr.id = pm.project_id where pm.profile_id = l.id), '[]'::jsonb),
          'members', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name,
                         'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                                                 from public.ai_studio_project_members pm join public.ai_studio_projects pr on pr.id = pm.project_id where pm.profile_id = m.id), '[]'::jsonb))
                         order by m.full_name)
                       from public.profiles m where m.status = 'ACTIVE' and m.role = 'TEAM_MEMBER' and m.department_id = v_dept and private.direct_lead_of(m.id) = l.id), '[]'::jsonb)) as t
          from public.profiles l where l.status = 'ACTIVE' and l.role = 'TEAM_HEAD' and l.department_id = v_dept
        union all
        select jsonb_build_object('leadId', null, 'leadName', null, 'teamName', private.ai_studio_team_label(null), 'projects', '[]'::jsonb,
          'members', jsonb_agg(jsonb_build_object('id', m.id, 'name', m.full_name,
                         'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                                                 from public.ai_studio_project_members pm join public.ai_studio_projects pr on pr.id = pm.project_id where pm.profile_id = m.id), '[]'::jsonb))
                         order by m.full_name))
          from public.profiles m where m.status = 'ACTIVE' and m.role = 'TEAM_MEMBER' and m.department_id = v_dept and private.direct_lead_of(m.id) is null
        having count(*) > 0) q), '[]'::jsonb),
    -- projects: who works on each (the Team Leads on it, and every assigned member with their Team Lead)
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name, 'status', pr.status,
          'people', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', case p.role when 'TEAM_HEAD' then 'LEAD' else 'MEMBER' end,
                                   'leadId', case when p.role = 'TEAM_HEAD' then p.id else private.direct_lead_of(p.id) end) order by p.role desc, p.full_name)
                                from public.ai_studio_project_members pm join public.profiles p on p.id = pm.profile_id
                               where pm.project_id = pr.id and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')), '[]'::jsonb))
        order by pr.name) from public.ai_studio_projects pr where pr.status <> 'ARCHIVED'), '[]'::jsonb),
    'memberReports', v_members,
    'leadReports', v_leads);
end $$;
revoke all on function public.ai_studio_hr_performance(date, date) from public, anon;
grant execute on function public.ai_studio_hr_performance(date, date) to authenticated;

notify pgrst, 'reload schema';
