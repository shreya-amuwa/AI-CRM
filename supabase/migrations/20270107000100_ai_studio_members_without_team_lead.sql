-- =============================================================================
-- AI Studio: a Team Member can be created, and given a project, before any Team Lead exists; the Team Lead is assigned later.
--
-- Run after 20270106000100_ai_studio_superadmin_head.sql. Safe to run twice; no record is deleted and no existing reporting line is changed.
--
-- What was found (read before changing anything):
--   * profiles.manager_id is already nullable, and ai_studio_* tables never stored a lead for a member (the lead is always private.direct_lead_of(member)).
--   * BUT direct_lead_of and the guard trigger made a member of a team with exactly ONE Team Lead belong to that lead without anyone naming them, so "assign later"
--     was impossible to tell apart from "assigned to the only lead", and the first Team Lead created would silently take every earlier member.
--   * ai_studio_project_check / ai_studio_project_assign required a Team Lead on the project, and ai_studio_report_save refused a member with no Team Lead.
--
-- What this does:
--   1. AI Studio only: a Team Member has a Team Lead only when one was named (no "only lead" shortcut) - in direct_lead_of and in the guard trigger. Members that
--      today rely on that shortcut keep their lead (it is written into manager_id first). Every other department behaves exactly as before.
--   2. The project and the Team Lead are independent: a member can be on a project with no Team Lead, or with one who is not on it.
--   3. A report from a member with no Team Lead goes straight to the Department Head (the Super Admin); the history says so. The route is fixed when a report is
--      submitted: a Team Lead assigned later does not take over reports already in, and approved or pending ones keep their history. New reports follow
--      Team Member -> Team Lead -> Department Head.
--   4. ai_studio_assign_lead(members[], lead): the Super Admin (Department Head) assigns one or many members to an active AI Studio Team Lead, all or nothing.
--   5. ai_studio_people also returns when the person was created and their joining date.
-- Nothing here grants anything to another role; other departments still get FORBIDDEN.
-- =============================================================================

-- 1a. members that rely on the "only Team Lead" shortcut today keep that lead (written down before the shortcut is removed for AI Studio)
update public.profiles m set manager_id = private.sole_team_lead(m.team_id)
 where m.role = 'TEAM_MEMBER' and m.manager_id is null and m.team_id is not null
   and m.department_id = private.ai_studio_department() and private.sole_team_lead(m.team_id) is not null;

-- 1b. the resolver: AI Studio members have a Team Lead only when one was named
create or replace function private.direct_lead_of(p_member uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when m.manager_id is not null
              then (select l.id from public.profiles l where l.id = m.manager_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.team_id is not distinct from m.team_id)
              when m.department_id is not distinct from private.ai_studio_department() then null
              else private.sole_team_lead(m.team_id) end
    from public.profiles m where m.id = p_member and m.role = 'TEAM_MEMBER' and m.team_id is not null
$$;
revoke all on function private.direct_lead_of(uuid) from public, anon, authenticated;

-- 1c. the guard trigger: no automatic lead for a new AI Studio member
create or replace function private.tg_profiles_manager_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role is distinct from 'TEAM_MEMBER' then
    new.manager_id := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id is distinct from old.team_id and new.manager_id is not distinct from old.manager_id then
    new.manager_id := null;
  end if;
  if new.manager_id is not null and not exists (
       select 1 from public.profiles l where l.id = new.manager_id and l.role = 'TEAM_HEAD' and l.team_id is not distinct from new.team_id) then
    raise exception 'VALIDATION_ERROR: A Team Member''s direct Team Lead must be a Team Lead of the same team.' using errcode = 'P0001';
  end if;
  if new.manager_id is null and new.team_id is not null and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id)
     and not exists (select 1 from public.teams t where t.id = new.team_id and t.department_id = private.ai_studio_department()) then
    new.manager_id := private.sole_team_lead(new.team_id);
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_manager_guard() from public, anon, authenticated;

-- 2. projects and Team Leads are independent
create or replace function public.ai_studio_project_assign(p_project uuid, p_profile uuid, p_assign boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
  pr public.ai_studio_projects;
  t public.profiles;
  v_lead uuid;
begin
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null then raise exception 'NOT_FOUND: Project not found.' using errcode = 'P0001'; end if;
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.status <> 'ACTIVE' or t.department_id is distinct from private.ai_studio_department() or t.role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead or Team Member of AI Studio.' using errcode = 'P0001';
  end if;
  if t.role = 'TEAM_HEAD' and v_role = 'LEAD' then
    raise exception 'FORBIDDEN: Only the Department Head can put a Team Lead on a project.' using errcode = '42501';
  end if;
  -- a Team Lead gives their own members only the projects they work on themselves
  if v_role = 'LEAD' and p_assign and not private.ai_studio_on_project(p_project, v_me) then
    raise exception 'FORBIDDEN: You can only give your Team Members the projects you are on.' using errcode = '42501';
  end if;
  if t.role = 'TEAM_MEMBER' then
    v_lead := private.direct_lead_of(t.id);
    if v_role = 'LEAD' and v_lead is distinct from v_me then
      raise exception 'FORBIDDEN: You can only assign your own Team Members.' using errcode = '42501';
    end if;
    -- the project and the Team Lead are independent: a Team Member can be on a project with no Team Lead (or one who is not on it)
  end if;
  if p_assign then
    if pr.status = 'ARCHIVED' then
      raise exception 'VALIDATION_ERROR: "%" is archived.', pr.name using errcode = 'P0001';
    end if;
    insert into public.ai_studio_project_members (project_id, profile_id, assigned_by) values (p_project, p_profile, v_me) on conflict do nothing;
    if found then
      perform private.write_audit('AI_STUDIO_PROJECT_ASSIGNED', 'ai_studio_project', p_project, t.department_id, t.team_id, jsonb_build_object('profile', t.id));
      perform private.notify(t.id, 'AI_STUDIO_PROJECT_ASSIGNED', format('You were added to %s', pr.name), 'Open Projects to see its tasks.', 'ai_studio_project', p_project);
    end if;
  else
    if exists (select 1 from public.ai_studio_tasks k where k.project_id = p_project and k.assignee_id = t.id and k.status <> 'COMPLETED') then
      raise exception 'CONFLICT: % still has open tasks in "%". Complete or move them first.', t.full_name, pr.name using errcode = 'P0001';
    end if;
    delete from public.ai_studio_project_members where project_id = p_project and profile_id = p_profile;
    if found then
      perform private.write_audit('AI_STUDIO_PROJECT_UNASSIGNED', 'ai_studio_project', p_project, t.department_id, t.team_id, jsonb_build_object('profile', t.id));
    end if;
  end if;
  return jsonb_build_object('projectId', p_project, 'profileId', p_profile, 'assigned', p_assign);
end $$;
revoke all on function public.ai_studio_project_assign(uuid, uuid, boolean) from public, anon;
grant execute on function public.ai_studio_project_assign(uuid, uuid, boolean) to authenticated;

create or replace function public.ai_studio_project_check(p_department uuid, p_role text, p_team uuid, p_projects uuid[], p_lead uuid default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_role();
  v_projects uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_projects, '{}'::uuid[])) x), '{}'::uuid[]);
  v_lead uuid := p_lead;
  -- the screens know the team, not the department: the team says which department the new person joins
  v_dept uuid := coalesce(p_department, (select t.department_id from public.teams t where t.id = p_team));
  p uuid;
begin
  if v_dept is distinct from private.ai_studio_department() then
    if cardinality(v_projects) > 0 or p_lead is not null then
      raise exception 'VALIDATION_ERROR: Projects belong to the AI Studio department only.' using errcode = 'P0001';
    end if;
    return;
  end if;
  if p_role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    if cardinality(v_projects) > 0 then
      raise exception 'VALIDATION_ERROR: Projects are given to Team Leads and Team Members.' using errcode = 'P0001';
    end if;
    return;
  end if;
  if v_role is null then raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501'; end if;
  if cardinality(v_projects) = 0 then
    raise exception 'VALIDATION_ERROR: Select a project for the AI Studio %.', case when p_role = 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end using errcode = 'P0001';
  end if;
  foreach p in array v_projects loop
    if not exists (select 1 from public.ai_studio_projects x where x.id = p and x.status <> 'ARCHIVED') then
      raise exception 'VALIDATION_ERROR: Choose a project from the list.' using errcode = 'P0001';
    end if;
  end loop;
  if p_role = 'TEAM_HEAD' then
    if v_role not in ('ADMIN', 'HEAD') then raise exception 'FORBIDDEN: Only the Department Head can add a Team Lead.' using errcode = '42501'; end if;
    return;
  end if;
  -- a Team Member: a Team Lead adds their own (and only the projects they are on); the Department Head / Super Admin may name a Team Lead or leave it for later.
  -- The Team Lead is optional and independent of the project: a member can be created before any Team Lead exists.
  if v_role = 'LEAD' then
    if v_lead is not null and v_lead <> auth.uid() then raise exception 'FORBIDDEN: A Team Lead adds Team Members to their own team.' using errcode = '42501'; end if;
    v_lead := auth.uid();
    foreach p in array v_projects loop
      if not private.ai_studio_on_project(p, v_lead) then
        raise exception 'VALIDATION_ERROR: Choose one of your own projects.' using errcode = 'P0001';
      end if;
    end loop;
  end if;
  if v_lead is not null and not exists (select 1 from public.profiles l where l.id = v_lead and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.department_id = v_dept and l.team_id is not distinct from p_team) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of the same team, or leave the Team Lead for later.' using errcode = 'P0001';
  end if;
end $$;
revoke all on function public.ai_studio_project_check(uuid, text, uuid, uuid[], uuid) from public, anon;
grant execute on function public.ai_studio_project_check(uuid, text, uuid, uuid[], uuid) to authenticated;

-- 3. reports: the route follows the Team Lead the member has when the report is submitted
create or replace function private.ai_studio_report_lead(r public.ai_studio_daily_reports)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when r.author_role <> 'MEMBER' then null
              when r.status in ('PENDING_TL_APPROVAL', 'RETURNED_BY_TL', 'DRAFT') then coalesce(private.direct_lead_of(r.author_id), r.lead_id)
              else r.lead_id end
$$;
revoke all on function private.ai_studio_report_lead(public.ai_studio_daily_reports) from public, anon;
grant execute on function private.ai_studio_report_lead(public.ai_studio_daily_reports) to authenticated, service_role;

create or replace function public.ai_studio_report_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_lead uuid := case when private.ai_studio_role() = 'MEMBER' then private.direct_lead_of(auth.uid()) end;
begin
  return jsonb_build_object(
    'role', v_role,
    'today', private.ai_studio_today(),
    'reviewer', case when v_lead is not null then (select l.full_name from public.profiles l where l.id = v_lead)
                     else (select string_agg(h.full_name, ', ' order by h.full_name) from public.profiles h where h.id in (select private.ai_studio_head_ids())) end,
    'hasReviewer', v_lead is not null or exists (select 1 from private.ai_studio_head_ids()),
    -- 'TEAM_LEAD': Team Member -> Team Lead -> Department Head; 'DIRECT': straight to the Department Head (a Team Lead's own report, or a Team Member with no Team Lead yet)
    'route', case when v_lead is not null then 'TEAM_LEAD' else 'DIRECT' end,
    'projects', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                            from public.ai_studio_project_members m join public.ai_studio_projects pr on pr.id = m.project_id
                           where m.profile_id = v_me and pr.status <> 'ARCHIVED'), '[]'::jsonb),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'projectId', t.project_id, 'title', t.title, 'status', t.status) order by t.due_date nulls last, t.created_at desc)
                         from public.ai_studio_tasks t
                        where t.assignee_id = v_me and (t.status <> 'COMPLETED' or t.completed_at > now() - interval '14 days')), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_report_context() from public, anon;
grant execute on function public.ai_studio_report_context() to authenticated;

create or replace function public.ai_studio_report_save(
  p_id uuid, p_project uuid, p_task uuid, p_date date, p_work_completed text, p_work_in_progress text, p_pending_work text, p_blockers text, p_remarks text, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
  v_completed text := nullif(btrim(coalesce(p_work_completed, '')), '');
  v_progress text := nullif(btrim(coalesce(p_work_in_progress, '')), '');
  v_pending text := nullif(btrim(coalesce(p_pending_work, '')), '');
  v_blockers text := nullif(btrim(coalesce(p_blockers, '')), '');
  v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
  me public.profiles;
  pr public.ai_studio_projects;
  tk public.ai_studio_tasks;
  r public.ai_studio_daily_reports;
  v_lead uuid;
  v_from text;
  v_action text;
begin
  select * into me from public.profiles where id = v_me;
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the report date.' using errcode = 'P0001'; end if;
  if p_date > private.ai_studio_today() then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if p_date < private.ai_studio_today() - 60 then raise exception 'VALIDATION_ERROR: A report can be written for the last 60 days only.' using errcode = 'P0001'; end if;
  if greatest(length(coalesce(v_completed, '')), length(coalesce(v_progress, '')), length(coalesce(v_pending, '')), length(coalesce(v_blockers, '')), length(coalesce(v_remarks, ''))) > 4000 then
    raise exception 'VALIDATION_ERROR: Each part of the report can have at most 4000 characters.' using errcode = 'P0001';
  end if;
  select * into pr from public.ai_studio_projects where id = p_project;
  if pr.id is null or pr.status = 'ARCHIVED' or not private.ai_studio_on_project(p_project, v_me) then
    raise exception 'VALIDATION_ERROR: Choose one of your projects.' using errcode = 'P0001';
  end if;
  if p_task is not null then
    select * into tk from public.ai_studio_tasks where id = p_task;
    if tk.id is null or tk.assignee_id <> v_me or tk.project_id <> p_project then
      raise exception 'VALIDATION_ERROR: Choose a task that was assigned to you in this project.' using errcode = 'P0001';
    end if;
  end if;
  if p_submit and v_completed is null then
    raise exception 'VALIDATION_ERROR: Describe the work completed today before you submit.' using errcode = 'P0001';
  end if;

  if p_id is null then
    if exists (select 1 from public.ai_studio_daily_reports x where x.author_id = v_me and x.report_date = p_date and x.project_id = p_project
                  and coalesce(x.task_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(p_task, '00000000-0000-0000-0000-000000000000'::uuid)) then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end if;
    begin
      insert into public.ai_studio_daily_reports (author_id, author_name, author_role, project_id, task_id, report_date, work_completed, work_in_progress, pending_work, blockers, remarks, status)
      values (v_me, me.full_name, v_role, p_project, p_task, p_date, v_completed, v_progress, v_pending, v_blockers, v_remarks, 'DRAFT') returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end;
    perform private.ai_studio_event(r, 'CREATED', null, null, null);
    v_from := 'DRAFT';
  else
    select * into r from public.ai_studio_daily_reports where id = p_id for update;
    if r.id is null or r.author_id <> v_me then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
    if r.status not in ('DRAFT', 'RETURNED_BY_TL', 'RETURNED_BY_DH') then
      raise exception 'CONFLICT: This report was already submitted and can no longer be changed.' using errcode = 'P0001';
    end if;
    begin
      update public.ai_studio_daily_reports
         set project_id = p_project, task_id = p_task, report_date = p_date, work_completed = v_completed, work_in_progress = v_progress,
             pending_work = v_pending, blockers = v_blockers, remarks = v_remarks
       where id = r.id returning * into r;
    exception when unique_violation then
      raise exception 'CONFLICT: You already have a report for this project, task and date. Open it from My Daily Reports.' using errcode = 'P0001';
    end;
    v_from := r.status;
  end if;

  if p_submit then
    -- a Team Member with a Team Lead goes through them; with none (yet) the report goes straight to the Department Head. The route is fixed when the report is
    -- submitted: a Team Lead assigned later does not take over reports that are already in.
    if v_role = 'MEMBER' then
      v_lead := private.direct_lead_of(v_me);
    end if;
    v_action := case when v_from in ('RETURNED_BY_TL', 'RETURNED_BY_DH') then 'RESUBMITTED' else 'SUBMITTED' end;
    update public.ai_studio_daily_reports
       set status = case when v_lead is not null then 'PENDING_TL_APPROVAL' else 'PENDING_DH_APPROVAL' end,
           lead_id = v_lead, lead_name = (select l.full_name from public.profiles l where l.id = v_lead),
           revision = case when v_action = 'RESUBMITTED' then revision + 1 else revision end,
           tl_reviewed_by = null, tl_reviewed_at = null, tl_comment = null, dh_reviewed_by = null, dh_reviewed_at = null, dh_comment = null,
           submitted_at = now(), approved_at = null
     where id = r.id returning * into r;
    perform private.ai_studio_event(r, v_action, null, v_from, case when v_role = 'MEMBER' and v_lead is null then 'No Team Lead is assigned: sent straight to the Department Head.' end);
    perform private.write_audit('AI_STUDIO_REPORT_' || v_action, 'ai_studio_report', r.id, me.department_id, me.team_id, jsonb_build_object('date', r.report_date, 'revision', r.revision));
    if v_lead is not null then
      perform private.notify(v_lead, 'AI_STUDIO_REPORT_SUBMITTED', format('Daily report to review: %s', me.full_name),
        format('%s · %s%s', pr.name, to_char(r.report_date, 'DD Mon YYYY'), case when v_action = 'RESUBMITTED' then ' · resubmitted' else '' end), 'ai_studio_report', r.id);
    else
      perform private.notify(h, 'AI_STUDIO_REPORT_PENDING_HEAD', format('Daily report to review: %s', me.full_name),
        format('%s · %s · %s', case when v_role = 'MEMBER' then 'No Team Lead assigned' else 'Team Lead' end, pr.name, to_char(r.report_date, 'DD Mon YYYY')), 'ai_studio_report', r.id) from private.ai_studio_head_ids() h;
    end if;
  end if;
  return private.ai_studio_report_detail(r);
end $$;
revoke all on function public.ai_studio_report_save(uuid, uuid, uuid, date, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.ai_studio_report_save(uuid, uuid, uuid, date, text, text, text, text, text, boolean) to authenticated;

-- 4. assigning Team Members to a Team Lead, one or many at once (all or nothing)
create or replace function public.ai_studio_assign_lead(p_members uuid[], p_lead uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce((select array_agg(distinct x) from unnest(coalesce(p_members, '{}'::uuid[])) x), '{}'::uuid[]);
  l public.profiles;
  m public.profiles;
  v_id uuid;
  v_assigned integer := 0;
  v_same integer := 0;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD']);
  if cardinality(v_ids) = 0 then raise exception 'VALIDATION_ERROR: Select at least one Team Member.' using errcode = 'P0001'; end if;
  if cardinality(v_ids) > 200 then raise exception 'VALIDATION_ERROR: Select at most 200 Team Members at a time.' using errcode = 'P0001'; end if;
  select * into l from public.profiles where id = p_lead;
  if l.id is null or l.role <> 'TEAM_HEAD' or l.status <> 'ACTIVE' or l.department_id is distinct from private.ai_studio_department() then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of AI Studio.' using errcode = 'P0001';
  end if;
  foreach v_id in array v_ids loop
    select * into m from public.profiles where id = v_id;
    if m.id is null or m.role <> 'TEAM_MEMBER' or m.status <> 'ACTIVE' or m.department_id is distinct from private.ai_studio_department() then
      raise exception 'NOT_FOUND: Team Member not found.' using errcode = 'P0001';
    end if;
    if m.team_id is distinct from l.team_id then
      raise exception 'VALIDATION_ERROR: % and % are not in the same team.', m.full_name, l.full_name using errcode = 'P0001';
    end if;
    if private.direct_lead_of(m.id) = l.id then
      v_same := v_same + 1;
      continue;
    end if;
    perform public.assign_direct_lead(m.id, l.id);
    perform private.notify(m.id, 'AI_STUDIO_LEAD_ASSIGNED', format('%s is now your Team Lead', l.full_name), 'Your daily reports now go to them first, then for the final approval.', null, null);
    v_assigned := v_assigned + 1;
  end loop;
  return jsonb_build_object('leadId', l.id, 'assigned', v_assigned, 'alreadyAssigned', v_same);
end $$;
revoke all on function public.ai_studio_assign_lead(uuid[], uuid) from public, anon;
grant execute on function public.ai_studio_assign_lead(uuid[], uuid) to authenticated;

-- the single-member form, kept for the older screen: the same rule, no project condition any more
create or replace function public.ai_studio_set_lead(p_member uuid, p_lead uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.ai_studio_assign_lead(array[p_member], p_lead);
end $$;
revoke all on function public.ai_studio_set_lead(uuid, uuid) from public, anon;
grant execute on function public.ai_studio_set_lead(uuid, uuid) to authenticated;

-- 5. the people list also says when each person was created / joined
create or replace function public.ai_studio_people()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD']);
  v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(row_to_json(x)::jsonb order by (x."role" = 'DEPARTMENT_HEAD') desc, (x."role" = 'TEAM_HEAD') desc, x."fullName")
      from (
        select p.id, p.full_name as "fullName", p.email, p.created_at as "createdAt",
               (select e.joining_date from public.employee_personal_details e where e.profile_id = p.id) as "joiningDate", p.role::text as "role", p."position", p.status::text as "status",
               case when p.role = 'TEAM_MEMBER' then private.direct_lead_of(p.id) end as "leadId",
               (select l.full_name from public.profiles l where l.id = case when p.role = 'TEAM_MEMBER' then private.direct_lead_of(p.id) end) as "leadName",
               coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.name) order by pr.name)
                           from public.ai_studio_project_members m join public.ai_studio_projects pr on pr.id = m.project_id where m.profile_id = p.id), '[]'::jsonb) as "projects",
               (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status <> 'COMPLETED') as "openTasks",
               (select count(*) from public.ai_studio_tasks t where t.assignee_id = p.id and t.status = 'COMPLETED') as "completedTasks"
          from public.profiles p
         where p.department_id = private.ai_studio_department() and p.status in ('ACTIVE', 'SUSPENDED')
           and (v_role in ('ADMIN', 'HEAD') or p.id = v_me or (p.role = 'TEAM_MEMBER' and private.direct_lead_of(p.id) = v_me))
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_people() from public, anon;
grant execute on function public.ai_studio_people() to authenticated;

notify pgrst, 'reload schema';
