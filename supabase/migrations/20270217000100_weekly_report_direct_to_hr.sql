-- =============================================================================
-- Weekly department report: with an Operations Head it goes through them; WITHOUT one the Department Head sends it straight to HR.
--
-- WHAT EXISTED (20261230000200): the weekly report had ONE route, Department Head -> Operations Head -> HR. When nobody was eligible (a department or
-- function without an active Operations Head) the submission was REFUSED ("the weekly report cannot be submitted"), so those departments could not report
-- to HR at all.
-- WHAT THIS CHANGES (additive; no package, event, review or approval is changed or deleted):
--   * private.weekly_reviewer_ids (unchanged) still names the Operations Head of the department AND function. Operations Head found -> as before
--     (PENDING_OPERATIONS_HEAD, only that head decides, approval sends it to HR).
--   * Nobody found (no Operations Head assigned, or the assigned one is suspended / revoked) -> the Department Head's submission goes DIRECTLY to HR: status
--     SENT_TO_HR, no Operations Head decision is recorded or invented (oh_reviewer_* stay empty), the history says "Sent directly to HR (no Operations
--     Head)", HR is notified. HR, then the Super Admin, continue exactly as for an approved week (HR reviews -> consolidated report -> Super Admin -> leaderboard).
--   * A week still waiting for an Operations Head who has since been removed or suspended is no longer stranded: the Department Head can send it to HR.
--   * private.weekly_routing_issue is now an informational message (it never blocks a submission); the Super Admin's routing review still lists
--     the scopes without an Operations Head so they can assign one.
-- NOT changed: a Department Head's own DAILY report still needs an Operations Head reviewer; the Super Admin's authority; HR's reviews.
-- Run after 20270215000100_global_search.sql. Safe to run twice.
-- =============================================================================

-- the history can say it
do $$
declare c text;
begin
  select conname into c from pg_constraint
   where conrelid = 'public.work_report_package_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%SUBMITTED_TO_SUPERADMIN%' limit 1;
  if c is not null then execute format('alter table public.work_report_package_events drop constraint %I', c); end if;
  alter table public.work_report_package_events drop constraint if exists work_report_package_events_action_check;
  alter table public.work_report_package_events add constraint work_report_package_events_action_check
    check (action in ('COMPILED', 'SAVED', 'SUBMITTED', 'RESUBMITTED', 'APPROVED', 'REVISION_REQUESTED', 'HR_STARTED', 'HR_COMPLETED', 'SUBMITTED_TO_SUPERADMIN', 'SENT_TO_HR_DIRECT'));
end $$;

-- Informational: where this week goes. Null = through an Operations Head.
create or replace function private.weekly_routing_issue(p_department uuid, p_division text)
returns text language sql stable security definer set search_path = '' as $$
  select case when exists (select 1 from private.weekly_reviewer_ids(p_department, p_division)) then null
    else format('No active Operations Head is assigned to %s%s, so this weekly report goes directly to HR. Once the Super Admin assigns one, later weeks go through them.',
                (select d.name from public.departments d where d.id = private.base_department(p_department)),
                case when p_division is null then ' (whole department)' else ' ' || private.function_label(p_division) end) end
$$;
revoke all on function private.weekly_routing_issue(uuid, text) from public, anon, authenticated;

create or replace function public.work_report_weekly_save(
  p_week_start date, p_title text, p_assigned_overview text, p_completed_overview text, p_remarks text, p_submit boolean,
  p_division text)
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
  if length(coalesce(p_assigned_overview, '')) > 2000 or length(coalesce(p_completed_overview, '')) > 2000 or length(coalesce(p_remarks, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Keep each summary under 2000 characters.' using errcode = 'P0001';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select s.department_id, s.division into v_dept, v_div from private.my_weekly_scope(p_division) s;
  v_empty := v_title is null and nullif(btrim(coalesce(p_assigned_overview, '')), '') is null and nullif(btrim(coalesce(p_completed_overview, '')), '') is null
             and nullif(btrim(coalesce(p_remarks, '')), '') is null;
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
                                             status, stats, submitted_by, submitted_by_name, submitted_at, sent_to_hr_at)
    values (v_dept, v_div, 'WEEKLY', p_week_start, v_to, v_title, nullif(btrim(p_assigned_overview), ''), nullif(btrim(p_completed_overview), ''), nullif(btrim(p_remarks), ''),
            v_status, v_stats, me.id, me.full_name, now(), case when v_direct then now() end)
    returning * into pk;
    perform private.package_event(pk.id, case when v_status = 'COMPILING' then 'COMPILED' when v_direct then 'SENT_TO_HR_DIRECT' when p_submit then 'SUBMITTED' else 'SAVED' end, null, v_status, null, pk.revision);
  else
    update public.work_report_packages
       set title = v_title, assigned_overview = nullif(btrim(p_assigned_overview), ''), completed_overview = nullif(btrim(p_completed_overview), ''),
           note = nullif(btrim(p_remarks), ''), status = v_status, stats = v_stats, submitted_by = me.id, submitted_by_name = me.full_name,
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
revoke all on function public.work_report_weekly_save(date, text, text, text, text, boolean, text) from public, anon;
grant execute on function public.work_report_weekly_save(date, text, text, text, text, boolean, text) to authenticated;

notify pgrst, 'reload schema';
