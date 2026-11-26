-- =============================================================================
-- 1. Tasks: a Department Head or an Operations Head may skip a level (when a Team Lead / Department Head is away) - only within their own people.
-- 2. Support customers: a Support Team Lead sees only their own and their own members' customers (the department-wide Support desk is switched off).
-- Run after 20270113000200_ai_website_onboarding.sql. Safe to run twice. No row is deleted; no task, report or customer is moved.
--
-- WHY (1). The chain was strictly one step at a time (20261230000300): Operations Head -> Department Head (assign_task_to_department_head),
-- Department Head -> Team Lead (assign_task_to_team_lead / delegate_task_to_team_lead), Team Lead -> own Team Members. When the person in the middle is
-- absent the work stops. Now:
--   * a Department Head gives a task straight to an active Team Lead OR an ordinary Team Member of a team they head (private.head_covers: their
--     department and function);
--   * an Operations Head gives a task straight to an active Team Lead or ordinary Team Member of a department and function they manage
--     (private.scopes_of), in addition to Department Heads;
--   * the Super Admin may give one to any active Team Lead / Team Member.
-- Nothing else widens: a Team Lead still gives tasks only to their OWN members (assign_team_task / delegate_task_to_members, private.direct_lead_of),
-- never to another Team Lead's members; reports still go to each member's own Team Lead. A Technical Consultant or Meta Verifier (Team Members
-- with a flag) is never offered. When a Team Member gets a task over their Team Lead's head, that Team Lead is told (they still see the task:
-- private.can_view_work_task lets a lead read their own members' tasks).
-- The task is an ordinary top-level work task (parent_id null) assigned by the head: the existing screens, updates, roll-up and operations_tasks()
-- (tasks the Operations Head gave, with their chain) show it with no other change. A Team Lead who receives one can still work on it or share it
-- with their own members (delegate_task_to_members accepts a top-level task).
--
-- WHY (2). Two Team Leads share the Wabastore "Support" team. 20261225000100 made every Team Lead rule follow the member's own lead, but kept the
-- older "Support desk" rule ON: every Support Team Lead and Team Member reads ALL customers of the department (customers_select_support,
-- private.can_access_customer), so Team Lead A saw Team Lead B's customers. The Super Admin switch for it already exists
-- (set_support_desk_department_wide); this turns it OFF. Afterwards a Support Team Lead sees their own and their own members' customers, a Team
-- Member their own, and the Department Head / Operations Head / Super Admin everything in scope, exactly like the rest of the CRM. Support can raise a
-- ticket for the customers they see. To go back: select public.set_support_desk_department_wide(true) as the Super Admin (audited).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. Who may receive a task straight from p_actor (skipping a level)
-- ---------------------------------------------------------------------------
create or replace function private.can_task_directly(p_actor uuid, p_target uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.profiles me
      join public.profiles x on x.id = p_target
     where me.id = p_actor and me.status = 'ACTIVE' and x.id <> me.id
       and x.status = 'ACTIVE' and x.team_id is not null
       and (x.role = 'TEAM_HEAD' or private.is_ordinary_member(x))
       and case
             when me.role = 'SUPER_ADMIN' then true
             -- a Department Head: a team of a department and function they head
             when me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head
               then private.head_covers(me.id, private.base_department(x.department_id), x.team_id)
             -- an Operations Head: a team of a department and function they manage
             when me.role = 'DEPARTMENT_HEAD' and me.is_operations_head
               then exists (select 1 from private.scopes_of(me.id) s
                             where s.department_id = private.base_department(x.department_id)
                               and (s.division is null
                                    or coalesce((select t.division::text from public.teams t where t.id = x.team_id), 'GENERAL') in ('GENERAL', s.division)))
             else false
           end)
$$;
revoke all on function private.can_task_directly(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1b. The people offered in the picker (Team Leads first, then each Team Member with their own Team Lead)
-- ---------------------------------------------------------------------------
create or replace function public.task_direct_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role not in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a Department Head or an Operations Head gives tasks to Team Leads and Team Members.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'name', x.full_name, 'role', x.role,
             'teamId', x.team_id, 'team', t.name, 'departmentId', private.base_department(x.department_id),
             'department', (select d.name from public.departments d where d.id = private.base_department(x.department_id)),
             'teamLeadId', case when x.role = 'TEAM_MEMBER' then private.direct_lead_of(x.id) end,
             'teamLead', case when x.role = 'TEAM_MEMBER' then (select l.full_name from public.profiles l where l.id = private.direct_lead_of(x.id)) end)
           order by case when x.role = 'TEAM_HEAD' then 0 else 1 end, t.name, x.full_name)
      from public.profiles x
      left join public.teams t on t.id = x.team_id
     where x.status = 'ACTIVE' and x.role in ('TEAM_HEAD', 'TEAM_MEMBER') and private.can_task_directly(me.id, x.id)), '[]'::jsonb);
end $$;
revoke all on function public.task_direct_assignees() from public, anon;
grant execute on function public.task_direct_assignees() to authenticated;

-- ---------------------------------------------------------------------------
-- 1c. Give the task
-- ---------------------------------------------------------------------------
create or replace function public.assign_task_direct(p_assignee uuid, p_title text, p_description text, p_priority text, p_due date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  x public.profiles;
  v_lead uuid;
  v_id uuid;
  v_div text;
  v_from text;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role not in ('DEPARTMENT_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only a Department Head or an Operations Head gives tasks to Team Leads and Team Members.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_title, ''))) < 1 or length(btrim(p_title)) > 200 then
    raise exception 'VALIDATION_ERROR: Enter the task (up to 200 characters).' using errcode = 'P0001';
  end if;
  if length(coalesce(p_description, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: Keep the details under 4000 characters.' using errcode = 'P0001';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;
  if p_due is not null and p_due < private.office_today() then
    raise exception 'VALIDATION_ERROR: The due date cannot be in the past.' using errcode = 'P0001';
  end if;
  -- checked here, not in the browser: someone outside the caller's teams is refused even with a guessed id
  if p_assignee is null or not private.can_task_directly(me.id, p_assignee) then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead or Team Member of a team you manage.' using errcode = 'P0001';
  end if;
  select * into x from public.profiles where id = p_assignee;
  select t.division::text into v_div from public.teams t where t.id = x.team_id;
  v_from := case when me.role = 'SUPER_ADMIN' then 'the Super Admin' when me.is_operations_head then 'the Operations Head' else 'the Department Head' end;

  insert into public.work_tasks (department_id, team_id, division, title, description, priority, due_date, assigned_by, assignee_id)
  values (private.base_department(x.department_id), x.team_id, case when v_div in ('SALES', 'SUPPORT') then v_div end,
          btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_priority, 'MEDIUM'), p_due, me.id, x.id)
  returning id into v_id;
  perform private.write_audit('TASK_ASSIGNED', 'work_task', v_id, private.base_department(x.department_id), x.team_id,
    jsonb_build_object('assignee', x.id, 'title', btrim(p_title), 'level', 'DIRECT',
                       'from', case when me.role = 'SUPER_ADMIN' then 'SUPER_ADMIN' when me.is_operations_head then 'OPERATIONS_HEAD' else 'DEPARTMENT_HEAD' end,
                       'to', x.role));
  perform private.notify(x.id, 'TASK_ASSIGNED', format('New task from %s: %s', v_from, btrim(p_title)),
    format('Assigned by %s%s', me.full_name, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end),
    'work_task', v_id);
  -- the member's own Team Lead is told that their member has a task from above (they can read it: it is their member's)
  if x.role = 'TEAM_MEMBER' then
    v_lead := private.direct_lead_of(x.id);
    if v_lead is not null and v_lead <> me.id then
      perform private.notify(v_lead, 'TASK_UPDATE', format('%s gave %s a task', me.full_name, x.full_name), btrim(p_title), 'work_task', v_id);
    end if;
  end if;
  return v_id;
end $$;
revoke all on function public.assign_task_direct(uuid, text, text, text, date) from public, anon;
grant execute on function public.assign_task_direct(uuid, text, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Support customers: switch the department-wide Support desk OFF (the switch and its audited setter exist since 20261225000100)
-- ---------------------------------------------------------------------------
-- Only while nobody has set it by hand: set_support_desk_department_wide records who did (updated_by), so running this file again never undoes a
-- Super Admin's later decision to turn it back on.
insert into public.access_settings (id, support_desk_department_wide) values (true, false)
on conflict (id) do update set support_desk_department_wide = false, updated_at = now()
 where public.access_settings.support_desk_department_wide and public.access_settings.updated_by is null;

notify pgrst, 'reload schema';
