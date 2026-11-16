-- =============================================================================
-- AI Studio: the Super Admin is the Department Head of AI Studio (no separate Department Head account).
--
-- Run after 20270105000100_ai_studio.sql. Safe to run twice; nothing is deleted and no existing permission is removed.
--
--   * The Super Admin already manages AI Studio in the database (private.ai_studio_role() = 'ADMIN': projects, people, tasks, every report). What was missing is the
--     last step of the daily report chain, which only a Department Head could take. Now:
--         Team Member -> Team Lead -> Super Admin           (a Team Lead's own report -> Super Admin)
--     and there is no further stage after the Super Admin. The status words stay as they are ("Pending Department Head Approval" is the Super Admin's step).
--   * The people told that a report waits for the final decision are the Super Admin(s) (and a Department Head of AI Studio, if the department ever has one:
--     nothing here requires or creates one).
--   * The Super Admin's global rights are not changed; nothing is granted to any other role, and another department still gets FORBIDDEN.
-- =============================================================================

create or replace function private.ai_studio_head_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p
   where p.status = 'ACTIVE'
     and (p.role = 'SUPER_ADMIN' or (p.department_id = private.ai_studio_department() and p.role = 'DEPARTMENT_HEAD'))
$$;
revoke all on function private.ai_studio_head_ids() from public, anon;
grant execute on function private.ai_studio_head_ids() to authenticated, service_role;

create or replace function private.ai_studio_can_review(r public.ai_studio_daily_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(r.author_id is distinct from auth.uid() and case
    when r.status = 'PENDING_TL_APPROVAL' then private.ai_studio_role() = 'LEAD' and private.ai_studio_report_lead(r) = auth.uid()
    when r.status = 'PENDING_DH_APPROVAL' then private.ai_studio_role() in ('HEAD', 'ADMIN')
    else false end, false)
$$;
revoke all on function private.ai_studio_can_review(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_can_review(public.ai_studio_daily_reports) to authenticated, service_role;

-- A decision on a report that waits for the caller: the report's Team Lead (stage 1) or the Super Admin / Department Head of AI Studio (stage 2, the final one,
-- only after stage 1). Nobody decides their own report.
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
  if p_decision not in ('APPROVE', 'RETURN') then raise exception 'VALIDATION_ERROR: Choose Approve or Return.' using errcode = 'P0001'; end if;
  if v_comment is not null and length(v_comment) > 2000 then raise exception 'VALIDATION_ERROR: The remarks can have at most 2000 characters.' using errcode = 'P0001'; end if;
  if p_decision = 'RETURN' and (v_comment is null or length(v_comment) < 3) then
    raise exception 'VALIDATION_ERROR: Write the remarks the employee should act on.' using errcode = 'P0001';
  end if;
  select * into r from public.ai_studio_daily_reports where id = p_report for update;
  if r.id is null or not private.ai_studio_can_see_report(r) then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  if r.author_id = v_me then raise exception 'FORBIDDEN: You cannot decide your own report.' using errcode = '42501'; end if;
  if not private.ai_studio_can_review(r) then
    raise exception 'CONFLICT: This report is not waiting for your decision.' using errcode = 'P0001';
  end if;
  v_from := r.status;
  select full_name into v_name from public.profiles where id = v_me;
  select name into pr_name from public.ai_studio_projects where id = r.project_id;

  if v_from = 'PENDING_TL_APPROVAL' then
    v_stage := 'TEAM_LEAD';
    update public.ai_studio_daily_reports
       set status = case when p_decision = 'APPROVE' then 'PENDING_DH_APPROVAL' else 'RETURNED_BY_TL' end,
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
  perform private.ai_studio_event(r, case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED' end, v_stage, v_from, v_comment);
  perform private.write_audit('AI_STUDIO_REPORT_' || case when p_decision = 'APPROVE' then 'APPROVED' else 'RETURNED' end, 'ai_studio_report', r.id,
                              private.ai_studio_department(), null, jsonb_build_object('stage', v_stage, 'from', v_from, 'to', r.status, 'author', r.author_id));

  if v_stage = 'TEAM_LEAD' and p_decision = 'APPROVE' then
    perform private.notify(r.author_id, 'AI_STUDIO_REPORT_TL_APPROVED', 'Your daily report was approved by your Team Lead',
      format('%s · %s. It now waits for the Department Head.', pr_name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id);
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

notify pgrst, 'reload schema';
