-- Strict Team Lead -> Team Member ownership: tasks, daily-report routing and rosters follow ONE direct lead.
--
-- WHAT WAS WRONG (reproduced from the code, read before changing anything)
--   * profiles has no "direct manager": a Team Member belongs to a TEAM (profiles.team_id) and nothing stops two active Team Leads (role TEAM_HEAD)
--     from sharing one team (the screenshot has two on the Wabastore Support team).
--   * Everything that needs "the member's Team Lead" asked "any active TEAM_HEAD with the same team_id" instead:
--       - private.report_reviewer_ids('MEMBER', ...) returned EVERY Team Lead of the team; private.is_report_reviewer and private.report_review_stage let
--         every one of them open, approve or reject the report, and work_report_submit notified every one of them;
--       - but work_report_submit stored the DISPLAYED Team Lead as "the first by name" (order by p.full_name, p.id limit 1). That is the screenshot:
--         the report says "Team Lead: Waiting (Mittal sumra)" (alphabetically first) while the history says "Opened for review (Team Lead) by
--         Renuka Parche" (a second Team Lead of the same team, also allowed to review). Display, notification and authorisation used three different rules.
--       - work_reports_inbox / work_reports_team_box / private.team_lead_box listed members and reports by team_id, so each Team Lead saw the others' people;
--       - assign_team_task and assign_task_to_members accepted any TEAM_MEMBER with the same team_id (and role alone also lets a Technical Consultant or a
--         Meta Verifier, who are TEAM_MEMBERs with a flag, appear in the "Team members" picker).
--
-- WHAT THIS DOES (additive; no row is deleted, no report is re-decided, no history is rewritten)
--   1. profiles.manager_id: the direct Team Lead of a Team Member. A guard trigger keeps it valid (an active-or-not TEAM_HEAD of the member's own team).
--      A member added by a Team Lead is theirs at once (provision_auth_user). A member of a team with exactly ONE active Team Lead is that lead's
--      (backfill, and the resolver below); a member of a team with several leads and no manager_id is "unassigned" and is listed for the Department Head.
--   2. private.direct_lead_of(member): the ONE resolver. private.report_lead_of(report): the lead recorded on the report when it was submitted (so the
--      displayed, notified and authorised person are the same), else the member's direct lead.
--   3. Reports: reviewer, stage, inbox, team box and the Department Head's boxes use that lead. Submitting needs a resolvable lead (the existing message).
--   4. Tasks: assign_team_task / assign_task_to_members accept only the caller's OWN ordinary Team Members (no Technical Consultant, no Meta Verifier,
--      nobody else's, nobody inactive) - checked in the database, so a guessed id is refused. my_team_members() feeds the picker.
--   5. assign_direct_lead(member, lead): the Super Admin or the Department Head of the team (never a Team Lead) sets or changes the direct lead; the member's
--      PENDING stage-1 reports move to the new lead with a history step and a notification. Approved / decided reports are never touched.
--   6. hierarchy_report(p_apply): a read-only impact report (default) of pending reports whose recorded lead differs from the direct lead, and of members
--      with no resolvable lead; with p_apply it corrects only the verifiable pending ones.
--
-- Run after 20261222000500_hr_department_designations.sql. Safe to run again.

-- ---------------------------------------------------------------------------
-- 1. The direct lead
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists manager_id uuid references public.profiles (id) on delete set null;
create index if not exists profiles_manager_idx on public.profiles (manager_id) where manager_id is not null;

-- an ordinary Team Member: not one of the specialist roles that are TEAM_MEMBERs with a flag
create or replace function private.is_ordinary_member(p public.profiles)
returns boolean language sql immutable set search_path = '' as $$
  select p.role = 'TEAM_MEMBER' and not coalesce(p.is_technical_consultant, false) and not coalesce(p.is_meta_verifier, false)
$$;
revoke all on function private.is_ordinary_member(public.profiles) from public, anon, authenticated;

-- the only active Team Lead of a team (null when there is none, or several: then nobody is "the" lead without being named)
create or replace function private.sole_team_lead(p_team uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select case when count(*) = 1 then (array_agg(p.id))[1] end
    from public.profiles p where p.team_id = p_team and p.role = 'TEAM_HEAD' and p.status = 'ACTIVE'
$$;
revoke all on function private.sole_team_lead(uuid) from public, anon, authenticated;

-- THE resolver: the named direct lead while that person is still an active Team Lead of the member's team, else the team's only lead, else nobody
create or replace function private.direct_lead_of(p_member uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  -- a NAMED lead who is no longer an active Team Lead of the team leaves the member unassigned (reassignment required, never an automatic pick);
  -- only a member nobody was ever named for belongs to the team's only active Team Lead
  select case when m.manager_id is not null
              then (select l.id from public.profiles l where l.id = m.manager_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.team_id is not distinct from m.team_id)
              else private.sole_team_lead(m.team_id) end
    from public.profiles m where m.id = p_member and m.role = 'TEAM_MEMBER' and m.team_id is not null
$$;
revoke all on function private.direct_lead_of(uuid) from public, anon, authenticated;

-- the lead a report belongs to: the one recorded when it was submitted while that person is still an active Team Lead of the author's team
-- (what the report shows is what is notified and what is authorised), else the author's direct lead
create or replace function private.report_lead_of(r public.work_reports)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
           (select l.id from public.profiles l where l.id = r.team_lead_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and l.team_id is not distinct from r.team_id),
           private.direct_lead_of(r.author_id))
$$;
revoke all on function private.report_lead_of(public.work_reports) from public, anon, authenticated;

-- keep manager_id valid; a member's lead is never silently carried to another team
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
  if new.manager_id is null and new.team_id is not null and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id) then
    new.manager_id := private.sole_team_lead(new.team_id);
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_manager_guard() from public, anon, authenticated;
drop trigger if exists profiles_manager_guard on public.profiles;
create trigger profiles_manager_guard before insert or update of role, team_id, manager_id on public.profiles
  for each row execute function private.tg_profiles_manager_guard();

-- existing members of a team with exactly one active Team Lead belong to that lead (nothing else is guessed)
update public.profiles m set manager_id = private.sole_team_lead(m.team_id)
 where m.role = 'TEAM_MEMBER' and m.manager_id is null and m.team_id is not null and private.sole_team_lead(m.team_id) is not null;

-- ---------------------------------------------------------------------------
-- 2. A member added by a Team Lead is that lead's: the same provisioning function as 20261218000100 plus manager_id
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.provision_auth_user(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user auth.users;
  v_meta jsonb;
  v_app jsonb;
  v_email text;
  v_name text;
  v_actor uuid;
  v_role public.app_role;
  v_department uuid;
  v_team uuid;
  v_head_division text;
  v_profile public.profiles;
  v_request public.approval_requests;
  v_ops boolean := false;
begin
  select * into v_user from auth.users where id = p_user_id;
  if v_user.id is null or exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;
  v_meta := coalesce(v_user.raw_user_meta_data, '{}'::jsonb);
  v_app := coalesce(v_user.raw_app_meta_data, '{}'::jsonb);
  v_email := lower(v_user.email);
  v_name := left(coalesce(nullif(trim(v_meta ->> 'full_name'), ''), split_part(lower(v_user.email), '@', 1)), 160);

  if v_email is null then
    raise exception 'VALIDATION_ERROR: An e-mail address is required.' using errcode = 'P0001';
  end if;

  -- 1. Bootstrap the first Super Admin
  if coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    if exists (select 1 from public.profiles where role = 'SUPER_ADMIN') then
      raise exception 'FORBIDDEN: A Super Admin already exists.' using errcode = '42501';
    end if;
    insert into public.profiles (id, email, full_name, role, status, approved_at)
    values (v_user.id, v_email, v_name, 'SUPER_ADMIN', 'ACTIVE', now()) returning * into v_profile;
    perform private.write_audit('USER_CREATED', 'profile', v_profile.id, null, null,
      jsonb_build_object('role', 'SUPER_ADMIN', 'bootstrap', true));
    return;
  end if;

  -- 1b. An employee submitted by HR (or a Team Lead): a PENDING profile and an approval request - never an active account
  if v_app ? 'request_by' then
    perform private.provision_employee_request(v_user, v_app, v_email, v_name, v_meta);
    return;
  end if;

  -- 2. Provisioned by a manager through the API
  if v_app ? 'provisioned_by' then
    v_actor := private.try_uuid(v_app ->> 'provisioned_by');
    begin
      v_role := (v_app ->> 'provisioned_role')::public.app_role;
    exception when others then
      raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
    end;
    v_team := private.try_uuid(v_app ->> 'provisioned_team_id');
    v_head_division := case when v_role = 'DEPARTMENT_HEAD' then nullif(v_app ->> 'provisioned_head_division', '') end;
    -- An Operations Head is created as one (never as a Department Head first): the Department Head rule of one head per department and side
    -- does not apply to the role, and only the Super Admin can ask for it.
    v_ops := v_role = 'DEPARTMENT_HEAD' and coalesce((v_app ->> 'provisioned_operations_head')::boolean, false);
    if v_ops then
      if not exists (select 1 from public.profiles s where s.id = v_actor and s.role = 'SUPER_ADMIN' and s.status = 'ACTIVE') then
        raise exception 'FORBIDDEN: Only the Super Admin can make an Operations Head.' using errcode = '42501';
      end if;
    end if;
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    -- a Team Member added by a Team Lead of that team is that lead's (the guard trigger sets the team's only lead for any other creator)
    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division, is_operations_head, approved_by, approved_at, manager_id)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_head_division, v_ops, v_actor, now(),
            case when v_role = 'TEAM_MEMBER' and exists (select 1 from public.profiles a where a.id = v_actor and a.role = 'TEAM_HEAD' and a.status = 'ACTIVE' and a.team_id is not distinct from v_team)
                 then v_actor end)
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
    if v_ops then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'OPERATIONS_HEAD_SET', 'profile', v_profile.id, v_department, null, jsonb_build_object('note', 'created as an Operations Head'));
    end if;
    if v_team is not null then
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TEAM_MEMBER_ADDED', 'team', v_team, v_department, v_team, jsonb_build_object('user_id', v_profile.id));
    end if;

    if coalesce((v_app ->> 'provisioned_technical_consultant')::boolean, false) then
      update public.profiles set is_technical_consultant = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_technical_consultant then
        raise exception 'VALIDATION_ERROR: A Technical Consultant must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'TECHNICAL_CONSULTANT_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    if coalesce((v_app ->> 'provisioned_meta_verifier')::boolean, false) then
      update public.profiles set is_meta_verifier = true where id = v_profile.id returning * into v_profile;
      if not v_profile.is_meta_verifier then
        raise exception 'VALIDATION_ERROR: A Meta Verifier must be a team member of a support team.' using errcode = 'P0001';
      end if;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
      values (v_actor, 'META_VERIFIER_SET', 'profile', v_profile.id,
              v_profile.department_id, v_profile.team_id, jsonb_build_object('value', true));
    end if;
    return;
  end if;

  -- 3. Self-registration → PENDING team member awaiting approval
  select d.id into v_department from public.departments d
  where d.id = private.try_uuid(v_meta ->> 'department_id') and not d.is_locked;
  select t.id into v_team from public.teams t
  where t.id = private.try_uuid(v_meta ->> 'team_id') and t.department_id = v_department;

  insert into public.profiles (id, email, full_name, role, status, department_id, team_id)
  values (v_user.id, v_email, v_name, 'TEAM_MEMBER', 'PENDING', v_department, v_team)
  returning * into v_profile;

  insert into public.approval_requests (request_type, subject_user_id, department_id, team_id)
  values ('USER_REGISTRATION', v_profile.id, v_department, v_team)
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
  values (v_profile.id, 'USER_REGISTERED', 'profile', v_profile.id, v_department, v_team,
          jsonb_build_object('approval_request_id', v_request.id));

  perform private.route_registration_request(v_request, v_profile);
end $function$;
revoke all on function private.provision_auth_user(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Reports: one lead for display, notification and authorisation
-- ---------------------------------------------------------------------------
-- the history gets one more kind of step: a pending report moved to its real Team Lead
alter table public.work_report_events drop constraint if exists work_report_events_action_check;
alter table public.work_report_events add constraint work_report_events_action_check
  check (action in ('CREATED', 'SUBMITTED', 'RESUBMITTED', 'OPENED', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'REROUTED'));

create or replace function private.is_report_reviewer(r public.work_reports)
returns boolean language sql stable security definer set search_path = '' as $$
  select r.author_id is distinct from auth.uid()
     and case when r.kind = 'MEMBER' then
           private.report_lead_of(r) is not distinct from auth.uid()
           or (r.tl_status = 'APPROVED' and private.head_covers(auth.uid(), r.department_id, r.team_id))
         else
           private.report_level() = 'SUPER_ADMIN'
           or exists (select 1 from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) x where x = auth.uid())
         end
$$;
revoke all on function private.is_report_reviewer(public.work_reports) from public, anon, authenticated;
create or replace function private.report_review_stage(r public.work_reports)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r.author_id is not distinct from auth.uid() then null
    when r.kind = 'MEMBER' then
      case
        when r.status in ('SUBMITTED', 'UNDER_REVIEW')
             and private.report_lead_of(r) is not distinct from auth.uid() then 'TEAM_LEAD'
        when r.status = 'PENDING_DEPARTMENT_HEAD' and r.tl_status = 'APPROVED'
             and private.head_covers(auth.uid(), r.department_id, r.team_id) then 'DEPARTMENT_HEAD'
      end
    when r.status in ('SUBMITTED', 'UNDER_REVIEW') and private.is_report_reviewer(r) then 'REVIEWER'
  end
$$;
revoke all on function private.report_review_stage(public.work_reports) from public, anon, authenticated;
create or replace function public.work_report_submit(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_from text;
  v_action text;
  v_reviewer uuid;
  v_n int := 0;
  v_lead uuid;
  v_lead_name text;
  v_content jsonb;
begin
  if private.report_kind_of(private.report_level()) is null then
    raise exception 'FORBIDDEN: Reports are written by team members, team leads and department heads.' using errcode = '42501';
  end if;
  select * into r from public.work_reports where id = p_id and author_id = auth.uid() for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  if r.status not in ('DRAFT', 'REVISION_REQUIRED') then
    raise exception 'CONFLICT: This report was already submitted.' using errcode = 'P0001';
  end if;
  -- the task records are checked again now: a task reopened since the draft was saved cannot be sent as completed
  v_content := private.clean_task_report(r.content, r.content);
  if jsonb_array_length(v_content -> 'assignedTasks') = 0 and nullif(btrim(coalesce(v_content ->> 'remarks', '')), '') is null then
    raise exception 'VALIDATION_ERROR: Choose your assigned tasks or write a short remark before submitting.' using errcode = 'P0001';
  end if;
  if private.report_date_taken(r.author_id, r.report_date, r.id) then
    raise exception 'CONFLICT: You already have a report for this date.' using errcode = 'P0001';
  end if;
  -- the reviewer must exist now, so a report is never submitted into the void
  -- a Team Member's report goes to THEIR Team Lead (one person: the one shown, notified and allowed to decide)
  if r.kind = 'MEMBER' then
    v_lead := private.direct_lead_of(r.author_id);
    v_n := case when v_lead is null then 0 else 1 end;
  else
    select count(*) into v_n from private.report_reviewer_ids(r.kind, r.department_id, r.team_id);
  end if;
  if v_n = 0 then
    raise exception 'CONFLICT: %', case r.kind
      when 'MEMBER' then 'You are not assigned to a Team Lead yet. Ask your Department Head to assign you, then submit again.'
      when 'TEAM_LEAD' then 'No Department Head is set for your department yet. Ask the Super Admin or HR.'
      else 'No Operations Head manages your department yet. Ask the Super Admin to assign one.' end using errcode = 'P0001';
  end if;
  if r.kind = 'MEMBER' then
    select p.full_name into v_lead_name from public.profiles p where p.id = v_lead;
  end if;
  v_from := r.status;
  v_action := case when v_from = 'REVISION_REQUIRED' then 'RESUBMITTED' else 'SUBMITTED' end;
  -- a (re)submission starts the approval again: the stages are cleared (the earlier decisions and contents stay in the history)
  update public.work_reports
     set status = 'SUBMITTED', submitted_at = now(), updated_at = now(), content = v_content,
         revision = case when v_from = 'REVISION_REQUIRED' then revision + 1 else revision end,
         reviewed_by = null, reviewed_by_name = null, reviewed_at = null, review_comment = null,
         team_lead_id = case when kind = 'MEMBER' then v_lead else team_lead_id end,
         team_lead_name = case when kind = 'MEMBER' then v_lead_name else team_lead_name end,
         tl_status = case when kind = 'MEMBER' then 'PENDING' end, tl_reviewer_id = null, tl_reviewer_name = null, tl_reviewed_at = null, tl_comment = null,
         -- a Team Lead's own report has no Team Lead stage: it waits for the Department Head
         dh_status = case when kind = 'TEAM_LEAD' then 'PENDING' end, dh_reviewer_id = null, dh_reviewer_name = null, dh_reviewed_at = null, dh_comment = null,
         decision_stage = null
   where id = p_id returning * into r;
  perform private.report_event_stage(r.id, v_action, v_from, 'SUBMITTED', null, r.revision, null);
  update public.work_report_events set content = v_content
   where id = (select max(e.id) from public.work_report_events e where e.report_id = r.id);
  for v_reviewer in
    select q.x from (select v_lead as x where r.kind = 'MEMBER'
                     union all select y from private.report_reviewer_ids(r.kind, r.department_id, r.team_id) y where r.kind <> 'MEMBER') q loop
    perform private.notify(v_reviewer, case when v_action = 'RESUBMITTED' then 'REPORT_RESUBMITTED' else 'REPORT_SUBMITTED' end,
      format('%s: %s', case when v_action = 'RESUBMITTED' then 'Report resubmitted' else 'New report to review' end, r.author_name),
      format('"%s" (%s) is waiting for your review.', r.title, to_char(r.report_date, 'DD Mon YYYY')),
      'work_report', r.id);
  end loop;
  perform private.write_audit('WORK_REPORT_' || v_action, 'work_report', r.id, r.department_id, r.team_id,
    jsonb_build_object('kind', r.kind, 'revision', r.revision));
  return private.report_json(r, true);
end $$;
revoke all on function public.work_report_submit(uuid) from public, anon;
grant execute on function public.work_report_submit(uuid) to authenticated;
create or replace function public.work_reports_inbox(p_status text default null, p_from date default null, p_to date default null, p_author uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_level text := private.report_level();
  v_team uuid := private.my_team_id();
  v_dept uuid := (select private.base_department(p.department_id) from public.profiles p where p.id = auth.uid());
  v_items jsonb;
  v_counts jsonb;
begin
  if v_level not in ('TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'SUPER_ADMIN') then
    raise exception 'FORBIDDEN: Only people who review reports can open this list.' using errcode = '42501';
  end if;
  with inbox as (
    select r.* from public.work_reports r
     where r.status <> 'DRAFT'
       and (p_from is null or r.period_end >= p_from) and (p_to is null or r.period_start <= p_to)
       and (p_author is null or r.author_id = p_author)
       and (   (v_level = 'TEAM_LEAD' and r.kind = 'MEMBER' and private.report_lead_of(r) is not distinct from auth.uid())
            or (v_level = 'DEPARTMENT_HEAD' and r.kind = 'TEAM_LEAD' and r.department_id = v_dept and private.head_covers(auth.uid(), r.department_id, r.team_id))
            or (v_level = 'OPERATIONS_HEAD' and r.kind = 'DEPARTMENT_HEAD' and r.department_id in (select private.report_scope_departments()))
            or (v_level = 'SUPER_ADMIN' and r.kind <> 'MEMBER'))
  )
  select
    (select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) from (select i.status, count(*) n from inbox i group by i.status) s),
    (select coalesce(jsonb_agg(private.report_json(x) order by (x.status in ('SUBMITTED', 'UNDER_REVIEW')) desc, x.submitted_at desc), '[]'::jsonb)
       from (select i.* from inbox i
              where p_status is null or i.status = p_status or (p_status = 'PENDING' and i.status in ('SUBMITTED', 'UNDER_REVIEW'))
              order by i.submitted_at desc limit 300) x)
    into v_counts, v_items;
  return jsonb_build_object('items', v_items, 'counts', v_counts);
end $$;
revoke all on function public.work_reports_inbox(text, date, date, uuid) from public, anon;
grant execute on function public.work_reports_inbox(text, date, date, uuid) to authenticated;

create or replace function private.member_report_counts_for_lead(p_lead uuid, p_author uuid, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'submitted', count(*) filter (where r.status <> 'DRAFT'),
    'pendingTl', count(*) filter (where r.status in ('SUBMITTED', 'UNDER_REVIEW')),
    'pendingDh', count(*) filter (where r.status = 'PENDING_DEPARTMENT_HEAD'),
    'pending', count(*) filter (where r.status in ('SUBMITTED', 'UNDER_REVIEW', 'PENDING_DEPARTMENT_HEAD')),
    'approved', count(*) filter (where r.status = 'APPROVED'),
    'revision', count(*) filter (where r.status = 'REVISION_REQUIRED'),
    'rejected', count(*) filter (where r.status = 'REJECTED'))
  from public.work_reports r
 where r.kind = 'MEMBER' and private.report_lead_of(r) = p_lead and (p_author is null or r.author_id = p_author) and r.period_end >= p_from and r.period_start <= p_to
$$;
revoke all on function private.member_report_counts_for_lead(uuid, uuid, date, date) from public, anon, authenticated;

create or replace function public.work_reports_team_box(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_members jsonb;
begin
  if private.report_level() <> 'TEAM_LEAD' then
    raise exception 'FORBIDDEN: This is the Team Lead''s team report box.' using errcode = '42501';
  end if;
  select * into me from public.profiles where id = auth.uid();
  select coalesce(jsonb_agg(m order by m ->> 'name'), '[]'::jsonb) into v_members from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'designation', nullif(p."position", ''),
      'counts', private.member_report_counts_for_lead(me.id, p.id, p_from, p_to),
      'reports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc, r.submitted_at desc)
                             from public.work_reports r where r.author_id = p.id and r.kind = 'MEMBER' and private.report_lead_of(r) is not distinct from me.id and r.status <> 'DRAFT'
                              and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb)) as m
      from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.direct_lead_of(p.id) = me.id
  ) q;
  return jsonb_build_object(
    'teamId', me.team_id, 'team', (select t.name from public.teams t where t.id = me.team_id), 'teamLead', me.full_name,
    'periodStart', p_from, 'periodEnd', p_to,
    'totalMembers', jsonb_array_length(v_members), 'counts', private.member_report_counts_for_lead(me.id, null, p_from, p_to), 'members', v_members,
    'myReports', coalesce((select jsonb_agg(private.report_json(r) order by r.period_end desc)
                            from public.work_reports r where r.author_id = auth.uid() and r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb));
end $$;
revoke all on function public.work_reports_team_box(date, date) from public, anon;
grant execute on function public.work_reports_team_box(date, date) to authenticated;
create or replace function private.team_lead_box(p_lead public.profiles, p_from date, p_to date, p_all boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'leadId', p_lead.id, 'lead', p_lead.full_name, 'teamId', p_lead.team_id, 'team', (select t.name from public.teams t where t.id = p_lead.team_id),
    'totalMembers', (select count(*) from public.profiles m where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and private.direct_lead_of(m.id) = p_lead.id),
    'counts', private.member_report_counts_for_lead(p_lead.id, null, p_from, p_to),
    'leadReports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.period_end desc, r.submitted_at desc)
                               from public.work_reports r where r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id and r.status <> 'DRAFT'
                                and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb),
    'memberReports', coalesce((select jsonb_agg(private.report_json(r, true) order by r.author_name, r.period_end desc)
                                 from public.work_reports r where r.kind = 'MEMBER' and private.report_lead_of(r) is not distinct from p_lead.id and r.status <> 'DRAFT'
                                  and (p_all or r.tl_status = 'APPROVED')
                                  and r.period_end >= p_from and r.period_start <= p_to), '[]'::jsonb),
    'leadReportStatus', (select r.status from public.work_reports r where r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id and r.status <> 'DRAFT'
                           and r.period_end >= p_from and r.period_start <= p_to order by r.submitted_at desc limit 1),
    'lastSubmittedAt', (select max(r.submitted_at) from public.work_reports r
                         where r.status <> 'DRAFT' and r.period_end >= p_from and r.period_start <= p_to
                           and ((r.kind = 'TEAM_LEAD' and r.author_id = p_lead.id) or (r.kind = 'MEMBER' and private.report_lead_of(r) is not distinct from p_lead.id))))
$$;
revoke all on function private.team_lead_box(public.profiles, date, date, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Tasks: only the caller's own ordinary Team Members
-- ---------------------------------------------------------------------------
create or replace function public.assign_team_task(
  p_title text, p_description text, p_priority text, p_due date, p_customer uuid, p_members uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  m public.profiles;
  v_id uuid;
  n integer := 0;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null or me.role <> 'TEAM_HEAD' or me.team_id is null then
    raise exception 'FORBIDDEN: Only a team lead can assign tasks to team members.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) < 2 then
    raise exception 'VALIDATION_ERROR: Enter a task title.' using errcode = 'P0001';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Choose at least one team member.' using errcode = 'P0001';
  end if;
  if p_customer is not null and not private.can_view_customer(p_customer) then
    raise exception 'VALIDATION_ERROR: Choose a customer of your team.' using errcode = 'P0001';
  end if;

  for m in select * from public.profiles where id = any (p_members) loop
    -- only the caller's OWN ordinary Team Members: not another lead's, not a Technical Consultant or a Meta Verifier, not an inactive one
    if not private.is_ordinary_member(m) or m.status <> 'ACTIVE' or private.direct_lead_of(m.id) is distinct from me.id then
      raise exception 'VALIDATION_ERROR: % is not an active member of your team.', m.full_name using errcode = 'P0001';
    end if;
    insert into public.work_tasks (department_id, team_id, customer_id, title, description, priority, due_date, assigned_by, assignee_id)
    values (me.department_id, me.team_id, p_customer, trim(p_title), nullif(trim(coalesce(p_description, '')), ''),
            coalesce(p_priority, 'MEDIUM'), p_due, me.id, m.id)
    returning id into v_id;
    n := n + 1;
    perform private.write_audit('TASK_ASSIGNED', 'work_task', v_id, me.department_id, me.team_id,
      jsonb_build_object('assignee', m.id, 'title', p_title, 'customer_id', p_customer));
    perform private.notify(m.id, 'TASK_ASSIGNED', format('New task: %s', trim(p_title)),
      format('Assigned by %s%s', me.full_name, case when p_due is null then '' else format(' · due %s', to_char(p_due, 'DD Mon')) end),
      'work_task', v_id);
  end loop;
  if n = 0 then
    raise exception 'VALIDATION_ERROR: Choose at least one team member.' using errcode = 'P0001';
  end if;
  return n;
end $$;
revoke all on function public.assign_team_task(text, text, text, date, uuid, uuid[]) from public, anon;
grant execute on function public.assign_team_task(text, text, text, date, uuid, uuid[]) to authenticated;
create or replace function public.assign_task_to_members(p_task uuid, p_members uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  m public.profiles;
  v_id uuid;
  n integer := 0;
begin
  select * into me from public.profiles where id = private.my_id();
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or t.assignee_id is distinct from me.id or me.role <> 'TEAM_HEAD' then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if t.parent_id is not null then
    raise exception 'VALIDATION_ERROR: This task is already a team member task.' using errcode = 'P0001';
  end if;
  if coalesce(array_length(p_members, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: Choose at least one team member.' using errcode = 'P0001';
  end if;

  for m in select * from public.profiles where id = any (p_members) loop
    -- only the caller's OWN ordinary Team Members: not another lead's, not a Technical Consultant or a Meta Verifier, not an inactive one
    if not private.is_ordinary_member(m) or m.status <> 'ACTIVE' or private.direct_lead_of(m.id) is distinct from me.id then
      raise exception 'VALIDATION_ERROR: % is not an active member of your team.', m.full_name using errcode = 'P0001';
    end if;
    if exists (select 1 from public.work_tasks where parent_id = t.id and assignee_id = m.id) then
      continue;
    end if;
    insert into public.work_tasks (department_id, team_id, parent_id, title, description, priority, due_date, assigned_by, assignee_id)
    values (t.department_id, me.team_id, t.id, t.title, t.description, t.priority, t.due_date, me.id, m.id)
    returning id into v_id;
    n := n + 1;
    perform private.notify(m.id, 'TASK_ASSIGNED', format('New task: %s', t.title),
      format('Assigned by %s%s', me.full_name, case when t.due_date is null then '' else format(' · due %s', to_char(t.due_date, 'DD Mon')) end),
      'work_task', v_id);
  end loop;
  if n = 0 then
    raise exception 'CONFLICT: These team members already have this task.' using errcode = 'P0001';
  end if;

  if t.status = 'ASSIGNED' then
    update public.work_tasks set status = 'IN_PROGRESS' where id = t.id;
  end if;
  perform private.write_audit('TASK_DELEGATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('members', p_members));
  return n;
end $$;
revoke all on function public.assign_task_to_members(uuid, uuid[]) from public, anon;
grant execute on function public.assign_task_to_members(uuid, uuid[]) to authenticated;

-- the Team Lead's roster for the task form (and nothing of anybody else's team)
create or replace function public.my_team_members()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.role <> 'TEAM_HEAD' then
    raise exception 'FORBIDDEN: Only a Team Lead has a team roster.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'fullName', p.full_name, 'position', nullif(p."position", ''),
                                                       'ordinary', private.is_ordinary_member(p)) order by p.full_name, p.id)
                     from public.profiles p
                    where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.direct_lead_of(p.id) = me.id), '[]'::jsonb);
end $$;
revoke all on function public.my_team_members() from public, anon;
grant execute on function public.my_team_members() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Naming or changing a member's direct lead (Super Admin, or the Department Head who looks after that team)
-- ---------------------------------------------------------------------------
create or replace function private.may_manage_team_leads(p_team uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  -- head_may_manage only looks at the department, so the role is checked here: a Team Lead of the department is not a head
  select private.is_super_admin() or (private.my_role() = 'DEPARTMENT_HEAD' and exists (
    select 1 from public.teams t where t.id = p_team and private.head_may_manage(auth.uid(), t.department_id, t.division::text)))
$$;
revoke all on function private.may_manage_team_leads(uuid) from public, anon, authenticated;

create or replace function private.move_pending_reports_to_lead(p_member uuid, p_lead uuid, p_reason text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r public.work_reports;
  v_name text;
  n integer := 0;
begin
  select full_name into v_name from public.profiles where id = p_lead;
  for r in select * from public.work_reports where author_id = p_member and kind = 'MEMBER' and status in ('SUBMITTED', 'UNDER_REVIEW')
                and team_lead_id is distinct from p_lead for update loop
    update public.work_reports set team_lead_id = p_lead, team_lead_name = v_name, status = 'SUBMITTED', updated_at = now() where id = r.id;
    insert into public.work_report_events (report_id, actor_id, actor_name, action, from_status, to_status, comment, revision, stage)
    select r.id, p.id, p.full_name, 'REROUTED', r.status, 'SUBMITTED', left(p_reason, 500), r.revision, 'TEAM_LEAD'
      from public.profiles p where p.id = auth.uid();
    perform private.notify(p_lead, 'REPORT_SUBMITTED', format('Report to review: %s', r.author_name),
      format('"%s" (%s) now waits for your review.', r.title, to_char(r.report_date, 'DD Mon YYYY')), 'work_report', r.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.move_pending_reports_to_lead(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.assign_direct_lead(p_member uuid, p_lead uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.profiles;
  l public.profiles;
  v_old uuid;
  v_moved integer;
begin
  select * into m from public.profiles where id = p_member for update;
  select * into l from public.profiles where id = p_lead;
  if m.id is null or m.role <> 'TEAM_MEMBER' or m.team_id is null or not private.may_manage_team_leads(m.team_id) then
    raise exception 'NOT_FOUND: Team Member not found.' using errcode = 'P0001';
  end if;
  if l.id is null or l.role <> 'TEAM_HEAD' or l.status <> 'ACTIVE' or l.team_id is distinct from m.team_id then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead of this member''s team.' using errcode = 'P0001';
  end if;
  v_old := private.direct_lead_of(p_member);
  update public.profiles set manager_id = p_lead where id = p_member;
  v_moved := private.move_pending_reports_to_lead(p_member, p_lead, 'The Team Member''s Team Lead changed; the report moved with them.');
  perform private.write_audit('DIRECT_LEAD_ASSIGNED', 'profile', p_member, m.department_id, m.team_id,
    jsonb_build_object('from', v_old, 'to', p_lead, 'pendingReportsMoved', v_moved));
  perform private.notify(p_lead, 'TEAM_MEMBER_ASSIGNED', format('%s is now in your team', m.full_name), 'You are their Team Lead for tasks and daily reports.', 'profile', p_member);
  return jsonb_build_object('memberId', p_member, 'leadId', p_lead, 'pendingReportsMoved', v_moved);
end $$;
revoke all on function public.assign_direct_lead(uuid, uuid) from public, anon;
grant execute on function public.assign_direct_lead(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The impact report (read-only by default) and the safe correction of pending reports
-- ---------------------------------------------------------------------------
create or replace function public.hierarchy_report(p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_unassigned jsonb;
  v_mismatch jsonb;
  v_fixed integer := 0;
  x record;
begin
  if not (private.is_super_admin() or private.my_role() = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the Super Admin or a Department Head can read the hierarchy report.' using errcode = '42501';
  end if;
  -- members with several leads on the team and none named: nobody can review their reports until a head names one
  select coalesce(jsonb_agg(jsonb_build_object('memberId', m.id, 'name', m.full_name, 'teamId', m.team_id, 'team', t.name,
           'leads', (select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name) order by l.full_name) from public.profiles l
                      where l.team_id = m.team_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE')) order by t.name, m.full_name), '[]'::jsonb)
    into v_unassigned
    from public.profiles m join public.teams t on t.id = m.team_id
   where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and private.direct_lead_of(m.id) is null and private.may_manage_team_leads(m.team_id);
  -- pending stage-1 reports whose recorded lead is not the author's direct lead
  select coalesce(jsonb_agg(jsonb_build_object('reportId', r.id, 'title', r.title, 'author', r.author_name, 'recordedLead', r.team_lead_name,
           'directLeadId', private.direct_lead_of(r.author_id), 'directLead', (select l.full_name from public.profiles l where l.id = private.direct_lead_of(r.author_id)),
           'verifiable', private.direct_lead_of(r.author_id) is not null) order by r.submitted_at), '[]'::jsonb)
    into v_mismatch
    from public.work_reports r
   where r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and private.may_manage_team_leads(r.team_id)
     and r.team_lead_id is distinct from private.direct_lead_of(r.author_id);
  if p_apply then
    for x in select r.author_id, private.direct_lead_of(r.author_id) as lead from public.work_reports r
              where r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and private.may_manage_team_leads(r.team_id)
                and private.direct_lead_of(r.author_id) is not null and r.team_lead_id is distinct from private.direct_lead_of(r.author_id)
              group by r.author_id loop
      v_fixed := v_fixed + private.move_pending_reports_to_lead(x.author_id, x.lead, 'Reviewer corrected to the Team Member''s direct Team Lead.');
    end loop;
    perform private.write_audit('HIERARCHY_REPORTS_RECONCILED', 'profile', auth.uid(), null, null, jsonb_build_object('moved', v_fixed));
  end if;
  return jsonb_build_object('unassignedMembers', v_unassigned, 'mismatchedPendingReports', v_mismatch, 'applied', p_apply, 'pendingReportsMoved', v_fixed);
end $$;
revoke all on function public.hierarchy_report(boolean) from public, anon;
grant execute on function public.hierarchy_report(boolean) to authenticated;

notify pgrst, 'reload schema';
