-- =============================================================================
-- Workflow functions (exposed as Supabase RPC). These are the only way to
-- change authorization-related state (role, status, department, team).
-- Each one: authenticates (auth.uid()), authorises via private helpers, and
-- performs the change atomically. Audit + notifications come from triggers.
--
-- Error convention: messages start with an application error code
--   FORBIDDEN | NOT_FOUND | CONFLICT | VALIDATION_ERROR
-- which the API maps to HTTP status codes.
-- =============================================================================

-- Sign-up form options (the only function available to anonymous users).
create or replace function public.list_registration_options()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'slug', d.slug, 'name', d.name,
           'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division)
                                               order by t.division, t.name)
                              from public.teams t where t.department_id = d.id), '[]'::jsonb))
         order by d.name), '[]'::jsonb)
  from public.departments d
  where not d.is_locked
$$;

-- Pre-flight check used by the API before provisioning an auth user.
create or replace function public.assert_can_create_user(
  p_role public.app_role, p_department_id uuid default null, p_team_id uuid default null)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.actor_can_assign_role(auth.uid(), p_role, p_department_id, p_team_id) then
    raise exception 'FORBIDDEN: You are not allowed to create a % here.', replace(p_role::text, '_', ' ')
      using errcode = '42501';
  end if;
  return true;
end $$;

create or replace function public.approve_registration(
  p_request_id uuid, p_team_id uuid default null, p_note text default null)
returns public.approval_requests language plpgsql security definer set search_path = '' as $$
declare
  v_request public.approval_requests;
  v_subject public.profiles;
  v_team uuid;
  v_department uuid;
begin
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if v_request.id is null or not (v_request.subject_user_id = auth.uid() or private.can_manage_profile(v_request.subject_user_id)) then
    raise exception 'NOT_FOUND: Approval request not found.' using errcode = 'P0001';
  end if;
  if not private.can_manage_profile(v_request.subject_user_id) then
    raise exception 'FORBIDDEN: You cannot approve this request.' using errcode = '42501';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;

  select * into v_subject from public.profiles where id = v_request.subject_user_id for update;
  v_team := coalesce(p_team_id, v_subject.team_id);
  if v_team is null then
    raise exception 'VALIDATION_ERROR: Select a team for this user before approving.' using errcode = 'P0001';
  end if;
  select department_id into v_department from public.teams where id = v_team;
  if not private.actor_can_assign_role(auth.uid(), v_subject.role, v_department, v_team) then
    raise exception 'FORBIDDEN: You cannot place this user in that team.' using errcode = '42501';
  end if;

  update public.profiles
     set status = 'ACTIVE', team_id = v_team, department_id = v_department, status_reason = p_note
   where id = v_subject.id;

  update public.approval_requests
     set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), decision_note = p_note,
         team_id = v_team, department_id = v_department
   where id = v_request.id
  returning * into v_request;
  return v_request;
end $$;

create or replace function public.reject_registration(p_request_id uuid, p_reason text default null)
returns public.approval_requests language plpgsql security definer set search_path = '' as $$
declare
  v_request public.approval_requests;
begin
  select * into v_request from public.approval_requests where id = p_request_id for update;
  if v_request.id is null or not private.can_manage_profile(v_request.subject_user_id) then
    raise exception 'NOT_FOUND: Approval request not found.' using errcode = 'P0001';
  end if;
  if v_request.status <> 'PENDING' then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;

  update public.profiles set status = 'REJECTED', status_reason = left(p_reason, 500)
   where id = v_request.subject_user_id;
  update public.approval_requests
     set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = left(p_reason, 500)
   where id = v_request.id
  returning * into v_request;
  return v_request;
end $$;

-- Suspend / revoke / reinstate. PENDING accounts go through the approval workflow.
create or replace function public.set_user_status(
  p_user_id uuid, p_status public.account_status, p_reason text default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
begin
  select * into v_target from public.profiles where id = p_user_id for update;
  if v_target.id is null or not private.can_view_profile(v_target.id, v_target.role, v_target.department_id, v_target.team_id) then
    raise exception 'NOT_FOUND: User not found.' using errcode = 'P0001';
  end if;
  if not private.can_manage_profile(p_user_id) then
    raise exception 'FORBIDDEN: You cannot change this user''s access.' using errcode = '42501';
  end if;
  if p_status not in ('ACTIVE', 'SUSPENDED', 'REVOKED') or v_target.status in ('PENDING', 'REJECTED') then
    raise exception 'VALIDATION_ERROR: Use the approval workflow for pending registrations.' using errcode = 'P0001';
  end if;
  if v_target.status = p_status then
    return v_target;
  end if;

  update public.profiles set status = p_status, status_reason = left(p_reason, 500)
   where id = p_user_id returning * into v_target;
  return v_target;
end $$;

-- Change role and/or team/department of an existing user. Customers owned by
-- the user follow them to the new team.
create or replace function public.assign_user(
  p_user_id uuid, p_role public.app_role, p_department_id uuid default null, p_team_id uuid default null)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare
  v_target public.profiles;
  v_department uuid := p_department_id;
begin
  select * into v_target from public.profiles where id = p_user_id for update;
  if v_target.id is null or not private.can_view_profile(v_target.id, v_target.role, v_target.department_id, v_target.team_id) then
    raise exception 'NOT_FOUND: User not found.' using errcode = 'P0001';
  end if;
  if not private.can_manage_profile(p_user_id)
     or not private.actor_can_assign_role(auth.uid(), p_role, p_department_id, p_team_id) then
    raise exception 'FORBIDDEN: You cannot assign this role or team.' using errcode = '42501';
  end if;
  if p_team_id is not null then
    select department_id into v_department from public.teams where id = p_team_id;
  end if;
  if p_role = 'DEPARTMENT_HEAD' and exists (select 1 from public.customers where owner_id = p_user_id) then
    raise exception 'CONFLICT: Reassign this user''s customers before making them a department head.' using errcode = 'P0001';
  end if;

  update public.profiles set role = p_role, department_id = v_department, team_id = p_team_id
   where id = p_user_id returning * into v_target;

  if p_team_id is not null then
    update public.customers set team_id = p_team_id, department_id = v_department
     where owner_id = p_user_id and team_id <> p_team_id;
  end if;
  return v_target;
end $$;

-- Permanent deletion (Super Admin only). Users who still own customers must
-- have them reassigned first. Audit row is written by the profiles trigger.
create or replace function public.delete_user(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only a Super Admin can delete users.' using errcode = '42501';
  end if;
  if not private.can_manage_profile(p_user_id) then
    raise exception 'FORBIDDEN: This user cannot be deleted.' using errcode = '42501';
  end if;
  if exists (select 1 from public.customers where owner_id = p_user_id) then
    raise exception 'CONFLICT: Reassign this user''s customers before deleting them.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = p_user_id;
end $$;

-- Announcement fan-out within the sender's scope.
--   Super Admin: whole org, or one department (optionally one division)
--   Department head: own department (optionally one division)
--   Team head: own team
create or replace function public.broadcast_announcement(
  p_title text, p_body text, p_priority text default 'announcement',
  p_department_id uuid default null, p_division public.team_division default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_role public.app_role := private.my_role();
  v_department uuid := p_department_id;
  v_team uuid;
  v_count integer;
begin
  if v_role is null or v_role = 'TEAM_MEMBER' then
    raise exception 'FORBIDDEN: You cannot send announcements.' using errcode = '42501';
  end if;
  if length(coalesce(trim(p_title), '')) = 0 or length(p_title) > 200 or length(coalesce(p_body, '')) > 2000 then
    raise exception 'VALIDATION_ERROR: Title is required (max 200 chars); message max 2000 chars.' using errcode = 'P0001';
  end if;
  if p_priority not in ('normal', 'urgent', 'announcement') then
    raise exception 'VALIDATION_ERROR: Invalid priority.' using errcode = 'P0001';
  end if;

  if v_role = 'DEPARTMENT_HEAD' then
    if v_department is not null and v_department <> private.my_department_id() then
      raise exception 'FORBIDDEN: You can only message your own department.' using errcode = '42501';
    end if;
    v_department := private.my_department_id();
  elsif v_role = 'TEAM_HEAD' then
    v_team := private.my_team_id();
    v_department := null;
  end if;

  insert into public.notifications (recipient_id, type, title, body, priority, entity_type, entity_id, actor_id, data)
  select p.id, 'ANNOUNCEMENT', trim(p_title), coalesce(p_body, ''), p_priority,
         case when v_team is not null then 'team' when v_department is not null then 'department' end,
         coalesce(v_team, v_department), auth.uid(),
         jsonb_build_object('division', p_division,
                            'sender_name', (select full_name from public.profiles where id = auth.uid()),
                            'sender_department', (select d.name from public.profiles me
                                                  join public.departments d on d.id = me.department_id
                                                  where me.id = auth.uid()))
  from public.profiles p
  left join public.teams t on t.id = p.team_id
  where p.status = 'ACTIVE' and p.id <> auth.uid()
    and (v_team is null or p.team_id = v_team)
    and (v_department is null or p.department_id = v_department)
    and (p_division is null or t.division = p_division or p.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD'));
  get diagnostics v_count = row_count;

  perform private.write_audit('ANNOUNCEMENT_SENT', coalesce(case when v_team is not null then 'team' end, 'department'),
    coalesce(v_team, v_department), v_department, v_team,
    jsonb_build_object('title', p_title, 'recipients', v_count, 'division', p_division));
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- Execution grants: authenticated only (anon gets the sign-up options).
-- ---------------------------------------------------------------------------
revoke all on function public.list_registration_options() from public;
revoke all on function public.assert_can_create_user(public.app_role, uuid, uuid) from public, anon;
revoke all on function public.approve_registration(uuid, uuid, text) from public, anon;
revoke all on function public.reject_registration(uuid, text) from public, anon;
revoke all on function public.set_user_status(uuid, public.account_status, text) from public, anon;
revoke all on function public.assign_user(uuid, public.app_role, uuid, uuid) from public, anon;
revoke all on function public.delete_user(uuid) from public, anon;
revoke all on function public.broadcast_announcement(text, text, text, uuid, public.team_division) from public, anon;
revoke all on function public.tg_set_updated_at() from public, anon, authenticated;

grant execute on function public.list_registration_options() to anon, authenticated, service_role;
grant execute on function public.assert_can_create_user(public.app_role, uuid, uuid) to authenticated, service_role;
grant execute on function public.approve_registration(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.reject_registration(uuid, text) to authenticated, service_role;
grant execute on function public.set_user_status(uuid, public.account_status, text) to authenticated, service_role;
grant execute on function public.assign_user(uuid, public.app_role, uuid, uuid) to authenticated, service_role;
grant execute on function public.delete_user(uuid) to authenticated, service_role;
grant execute on function public.broadcast_announcement(text, text, text, uuid, public.team_division) to authenticated, service_role;
