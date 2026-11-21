-- =============================================================================
-- AI Studio: a deadline for every project, and the clock that counts down to it on the dashboards of the people who work on it.
-- Run after 20270118000100_amuwa_design_studio_restore.sql. Safe to run twice. Nothing is deleted; no project, task or report changes.
--
-- WHAT
--   * ai_studio_projects.deadline_at (nullable): the moment the project is due. Only the Super Admin / the AI Studio Department Head set, change or
--     clear it (ai_studio_project_save_with_deadline; the Team Lead and Team Member are refused). A Team Lead or a Team Member never can.
--   * ai_studio_projects_list() also returns deadlineAt (the project cards show it).
--   * ai_studio_deadlines() (new): the clock. The projects with a deadline that are still running (Active or On hold), soonest first, plus the server's
--     own time so every browser counts down to the same moment whatever its own clock says. The Super Admin / Department Head see every project; a
--     Team Lead and a Team Member only the projects they are on (the same rule as the project list).
--   * Setting or changing a deadline tells the Team Leads and Team Members on the project (notification AI_STUDIO_PROJECT_DEADLINE, opens Projects) and is
--     audited with the old and the new moment. Saving a project without touching its deadline changes and tells nobody.
--
-- WHY a new function (ai_studio_project_save_with_deadline) and not a changed ai_studio_project_save: "leave the deadline as it is" and "clear the deadline"
-- must be different (p_set_deadline), and a second ai_studio_project_save with more arguments would make older calls "not unique" whenever an earlier migration
-- file is run again. ai_studio_project_save is untouched and still adds and edits projects exactly as before.
-- =============================================================================

alter table public.ai_studio_projects add column if not exists deadline_at timestamptz;

-- ---------------------------------------------------------------------------
-- 1. The project list (the latest definition is in 20270105000100; this one adds deadlineAt and nothing else)
-- ---------------------------------------------------------------------------
create or replace function public.ai_studio_projects_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', pr.id, 'name', pr.name, 'description', pr.description, 'status', pr.status, 'createdAt', pr.created_at, 'deadlineAt', pr.deadline_at,
      'mine', exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name) order by l.full_name)
                           from public.ai_studio_project_members m join public.profiles l on l.id = m.profile_id
                          where m.project_id = pr.id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE'
                            and (v_role in ('ADMIN', 'HEAD') or l.id = v_me or v_role = 'MEMBER' and l.id = private.direct_lead_of(v_me))), '[]'::jsonb),
      'memberCount', (select count(*) from public.ai_studio_project_members m join public.profiles x on x.id = m.profile_id
                       where m.project_id = pr.id and x.role = 'TEAM_MEMBER' and x.status = 'ACTIVE'
                         and (v_role in ('ADMIN', 'HEAD') or v_role = 'LEAD' and private.direct_lead_of(x.id) = v_me or v_role = 'MEMBER' and x.id = v_me)),
      'tasks', (select jsonb_build_object('total', count(*), 'assigned', count(*) filter (where t.status = 'ASSIGNED'),
                         'ongoing', count(*) filter (where t.status = 'IN_PROGRESS'), 'onHold', count(*) filter (where t.status = 'ON_HOLD'),
                         'completed', count(*) filter (where t.status = 'COMPLETED'),
                         'progress', coalesce(round(avg(t.progress)), 0))
                  from public.ai_studio_tasks t where t.project_id = pr.id and private.ai_studio_can_see_task(t))
    ) order by (pr.status = 'ARCHIVED'), pr.name)
    from public.ai_studio_projects pr
   where v_role in ('ADMIN', 'HEAD')
      or exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me)), '[]'::jsonb);
end $$;
revoke all on function public.ai_studio_projects_list() from public, anon;
grant execute on function public.ai_studio_projects_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Add or edit a project WITH its deadline (Super Admin / Department Head only, as for ai_studio_project_save)
-- ---------------------------------------------------------------------------
-- A function of its own, not a changed ai_studio_project_save: two functions of one name with different arguments would make every call that
-- leaves the extra arguments out "not unique" the moment an older migration file is run again. This one checks the deadline FIRST, then lets
-- ai_studio_project_save add or edit the project, then sets the deadline: all in one transaction, so a refused deadline saves nothing.
create or replace function public.ai_studio_project_save_with_deadline(
  p_id uuid, p_name text, p_description text, p_status text, p_deadline timestamptz, p_set_deadline boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before timestamptz;
  v_when text;
  v_saved jsonb;
  v_id uuid;
  pr public.ai_studio_projects;
  m record;
begin
  perform private.ai_studio_require(array['ADMIN', 'HEAD']);
  if p_id is not null then
    select deadline_at into v_before from public.ai_studio_projects where id = p_id;
  end if;
  if p_set_deadline and p_deadline is not null then
    -- an unchanged moment is never re-checked: a project whose deadline has passed can still be renamed or closed
    if p_deadline is distinct from v_before and p_deadline <= now() then
      raise exception 'VALIDATION_ERROR: The deadline must be a time in the future.' using errcode = 'P0001';
    end if;
    if p_deadline > now() + interval '5 years' then
      raise exception 'VALIDATION_ERROR: The deadline is too far away. Choose a date within five years.' using errcode = 'P0001';
    end if;
  end if;

  v_saved := public.ai_studio_project_save(p_id, p_name, p_description, p_status);
  v_id := (v_saved ->> 'id')::uuid;
  if not p_set_deadline then
    return v_saved || jsonb_build_object('deadlineAt', (select deadline_at from public.ai_studio_projects where id = v_id));
  end if;

  update public.ai_studio_projects set deadline_at = p_deadline where id = v_id returning * into pr;
  if pr.deadline_at is distinct from v_before then
    perform private.write_audit('AI_STUDIO_PROJECT_DEADLINE', 'ai_studio_project', pr.id, private.ai_studio_department(), null,
      jsonb_build_object('name', pr.name, 'before', v_before, 'after', pr.deadline_at));
    -- the people already on the project hear about it (never the person who changed it: private.notify skips the caller)
    v_when := to_char(pr.deadline_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM') || ' IST';
    for m in
      select pm.profile_id from public.ai_studio_project_members pm join public.profiles x on x.id = pm.profile_id
       where pm.project_id = pr.id and x.status = 'ACTIVE'
    loop
      perform private.notify(m.profile_id, 'AI_STUDIO_PROJECT_DEADLINE',
        case when pr.deadline_at is null then format('Deadline removed: %s', pr.name) else format('Deadline for %s: %s', pr.name, v_when) end,
        case when pr.deadline_at is null then 'The project has no deadline now.' else 'Open Projects to see the countdown.' end,
        'ai_studio_project', pr.id);
    end loop;
  end if;
  return v_saved || jsonb_build_object('deadlineAt', pr.deadline_at);
end $$;
revoke all on function public.ai_studio_project_save_with_deadline(uuid, text, text, text, timestamptz, boolean) from public, anon;
grant execute on function public.ai_studio_project_save_with_deadline(uuid, text, text, text, timestamptz, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The clock: running projects that have a deadline, soonest (or most overdue) first, and the server's time
-- ---------------------------------------------------------------------------
create or replace function public.ai_studio_deadlines()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_role text := private.ai_studio_require(array['ADMIN', 'HEAD', 'LEAD', 'MEMBER']);
  v_me uuid := auth.uid();
begin
  return jsonb_build_object(
    'serverNow', now(),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'projectId', pr.id, 'name', pr.name, 'status', pr.status, 'deadlineAt', pr.deadline_at,
               'mine', exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me),
               'openTasks', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id and t.status <> 'COMPLETED' and private.ai_studio_can_see_task(t)),
               'myOpenTasks', (select count(*) from public.ai_studio_tasks t where t.project_id = pr.id and t.assignee_id = v_me and t.status <> 'COMPLETED'))
             order by pr.deadline_at, pr.name)
        from public.ai_studio_projects pr
       where pr.deadline_at is not null and pr.status in ('ACTIVE', 'ON_HOLD')
         and (v_role in ('ADMIN', 'HEAD')
              or exists (select 1 from public.ai_studio_project_members m where m.project_id = pr.id and m.profile_id = v_me))), '[]'::jsonb));
end $$;
revoke all on function public.ai_studio_deadlines() from public, anon;
grant execute on function public.ai_studio_deadlines() to authenticated;

notify pgrst, 'reload schema';
