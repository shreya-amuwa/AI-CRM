-- =============================================================================
-- Leave approval in the reporting chain: Team Member -> Team Lead -> Department Head -> Operations Head -> HR.
-- Run after 20261225000100_team_lead_direct_scope.sql. Safe to run again. No leave record is changed, re-decided or deleted.
--
-- Until now (20261027000100) a request went Department Head -> HR. From here on a NEW request follows the chain of its requester's role:
--     Team Member       Team Lead -> Department Head -> Operations Head -> HR
--     Team Lead                    Department Head -> Operations Head -> HR
--     Department Head                                 Operations Head -> HR
--     Operations Head                                 Super Admin     -> HR
--     anyone else (e.g. the Super Admin)                                 HR
-- Each stage's approver is resolved from the live hierarchy when it is acted on (so a reassignment or a departure moves the pending step):
--     Team Lead        the employee's direct Team Lead (private.direct_lead_of)
--     Department Head  a Department Head authorised for the department AND the employee's function (private.head_covers)
--     Operations Head  the Operations Head accountable for that department and function (private.operations_owner_for)
--     HR               HR staff (private.is_hr_staff), never the employee and never someone who decided an earlier stage
-- A stage with nobody to decide it goes to the Super Admin (a defined exception), never approved by itself. Nobody decides their own leave.
--
-- Existing requests keep the rules they were submitted under (workflow_version 1: Department Head -> HR, the old functions); nothing is
-- marked as approved by a stage that did not exist. The Super Admin can switch new requests back to the two-step flow
-- (set_leave_workflow('TWO_STEP'), audited) - the rollback lever.
-- Leave "balance" is not stored separately: every summary counts APPROVED requests only, so a request counts once, when HR approves it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------------
alter table public.leave_requests
  add column if not exists workflow_version integer not null default 1,
  add column if not exists tl_decided_by uuid references public.profiles (id) on delete set null,
  add column if not exists tl_decided_at timestamptz,
  add column if not exists tl_note text,
  add column if not exists oh_decided_by uuid references public.profiles (id) on delete set null,
  add column if not exists oh_decided_at timestamptz,
  add column if not exists oh_note text,
  add column if not exists revision_note text;

do $$
declare c record;
begin
  -- the status list gets the new stages (the old values stay valid for the old requests)
  for c in select conname from pg_constraint
            where conrelid = 'public.leave_requests'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%PENDING_HR%'
              and conname <> 'leave_requests_status_v2_check' loop
    execute format('alter table public.leave_requests drop constraint %I', c.conname);
  end loop;
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_status_v2_check') then
    alter table public.leave_requests add constraint leave_requests_status_v2_check check (status in (
      'PENDING_TEAM_LEAD', 'PENDING_DEPARTMENT_HEAD', 'PENDING_OPERATIONS_HEAD', 'PENDING_HR', 'APPROVED', 'REVISION_REQUIRED',
      'REJECTED_BY_TEAM_LEAD', 'REJECTED_BY_DEPARTMENT_HEAD', 'REJECTED_BY_OPERATIONS_HEAD', 'REJECTED_BY_HR'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_stage_notes_check') then
    alter table public.leave_requests add constraint leave_requests_stage_notes_check
      check (coalesce(length(tl_note), 0) <= 1000 and coalesce(length(oh_note), 0) <= 1000 and coalesce(length(revision_note), 0) <= 1000);
  end if;
end $$;

-- Every step of a request, in order (who, what, when, why). Read through the leave functions only.
create table if not exists public.leave_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.leave_requests (id) on delete cascade,
  stage text not null check (stage in ('SUBMITTED', 'RESUBMITTED', 'TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'HR')),
  decision text not null check (decision in ('SUBMITTED', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED')),
  actor_id uuid references public.profiles (id) on delete set null,
  on_behalf text check (on_behalf in ('SUPER_ADMIN_EXCEPTION')),
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now()
);
create index if not exists leave_request_events_request_idx on public.leave_request_events (request_id, id);
alter table public.leave_request_events enable row level security;
revoke all on public.leave_request_events from public, anon, authenticated;

create table if not exists public.leave_settings (
  id boolean primary key default true check (id),
  workflow text not null default 'MULTI_LEVEL' check (workflow in ('MULTI_LEVEL', 'TWO_STEP')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.leave_settings (id) values (true) on conflict (id) do nothing;
alter table public.leave_settings enable row level security;
revoke all on public.leave_settings from public, anon, authenticated;

create or replace function public.set_leave_workflow(p_workflow text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before text := (select workflow from public.leave_settings where id);
  v_new text := upper(btrim(coalesce(p_workflow, '')));
begin
  perform private.require_super_admin();
  if v_new not in ('MULTI_LEVEL', 'TWO_STEP') then
    raise exception 'VALIDATION_ERROR: Choose MULTI_LEVEL or TWO_STEP.' using errcode = 'P0001';
  end if;
  update public.leave_settings set workflow = v_new, updated_by = auth.uid(), updated_at = now() where id;
  if v_before is distinct from v_new then
    perform private.write_audit('LEAVE_WORKFLOW_SET', 'leave_settings', null, null, null, jsonb_build_object('before', v_before, 'after', v_new));
  end if;
  return jsonb_build_object('workflow', v_new);
end $$;
revoke all on function public.set_leave_workflow(text) from public, anon;
grant execute on function public.set_leave_workflow(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The chain
-- ---------------------------------------------------------------------------
-- The stages a requester's leave goes through, in order.
create or replace function private.leave_stages_for(p_employee uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when p.role = 'TEAM_MEMBER' then array['TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'HR']
    when p.role = 'TEAM_HEAD' then array['DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'HR']
    when p.role = 'DEPARTMENT_HEAD' then array['OPERATIONS_HEAD', 'HR']
    else array['HR'] end
    from public.profiles p where p.id = p_employee
$$;
revoke all on function private.leave_stages_for(uuid) from public, anon, authenticated;

-- The stage after p_after (null = the first), or null when HR was the last.
create or replace function private.leave_next_stage(p_employee uuid, p_after text)
returns text language sql stable security definer set search_path = '' as $$
  select case when p_after is null then s[1]
              else s[array_position(s, p_after) + 1] end
    from (select private.leave_stages_for(p_employee) as s) x
$$;
revoke all on function private.leave_next_stage(uuid, text) from public, anon, authenticated;

-- The function (SALES / SUPPORT) of the requester: their team's, or a Department Head's side. Null = no side.
create or replace function private.leave_employee_division(p_employee uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when p.role = 'DEPARTMENT_HEAD' then p.head_division
              else (select nullif(t.division::text, 'GENERAL') from public.teams t where t.id = p.team_id) end
    from public.profiles p where p.id = p_employee
$$;
revoke all on function private.leave_employee_division(uuid) from public, anon, authenticated;

-- Who may decide this stage of this request right now (several people only for HR). Empty never happens: nobody -> the Super Admin.
create or replace function private.leave_stage_approvers(r public.leave_requests, p_stage text)
returns table (approver_id uuid, exception boolean) language plpgsql stable security definer set search_path = '' as $$
declare
  e public.profiles;
  v_ids uuid[];
begin
  select * into e from public.profiles where id = r.employee_id;
  if p_stage = 'TEAM_LEAD' then
    v_ids := array(select l.id from public.profiles l where l.id = private.direct_lead_of(e.id) and l.status = 'ACTIVE' and l.id <> e.id);
  elsif p_stage = 'DEPARTMENT_HEAD' then
    v_ids := array(select h.id from public.profiles h
                    where h.role = 'DEPARTMENT_HEAD' and not h.is_operations_head and h.status = 'ACTIVE' and h.id <> e.id
                      and private.head_covers(h.id, private.base_department(coalesce(r.department_id, e.department_id)), e.team_id)
                    order by (private.base_department(h.department_id) = private.base_department(coalesce(r.department_id, e.department_id))) desc, h.created_at);
  elsif p_stage = 'OPERATIONS_HEAD' then
    if not (e.role = 'DEPARTMENT_HEAD' and e.is_operations_head) then
      v_ids := array(select o from (select private.operations_owner_for(coalesce(r.department_id, e.department_id), private.leave_employee_division(e.id)) as o) x
                      where o is not null and o <> e.id);
    end if;
  elsif p_stage = 'HR' then
    v_ids := array(select p.id from public.profiles p join public.departments d on d.id = p.department_id
                    where d.slug = 'hr' and p.status = 'ACTIVE' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER' and p.id <> e.id
                      and p.id is distinct from r.tl_decided_by and p.id is distinct from r.dh_decided_by and p.id is distinct from r.oh_decided_by
                    order by p.created_at);
  end if;
  if coalesce(cardinality(v_ids), 0) > 0 then
    return query select x, false from unnest(v_ids) x;
    return;
  end if;
  -- the defined exception: the Super Admin decides a stage nobody else can (never the employee themselves)
  return query select s.id, true from public.profiles s
                where s.role = 'SUPER_ADMIN' and s.status = 'ACTIVE' and s.id <> e.id
                  and s.id is distinct from r.tl_decided_by and s.id is distinct from r.dh_decided_by and s.id is distinct from r.oh_decided_by
                order by s.created_at;
end $$;
revoke all on function private.leave_stage_approvers(public.leave_requests, text) from public, anon, authenticated;

create or replace function private.leave_stage_of(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case when p_status like 'PENDING\_%' then substr(p_status, 9) end
$$;
revoke all on function private.leave_stage_of(text) from public, anon, authenticated;

create or replace function private.leave_stage_label(p_stage text)
returns text language sql immutable set search_path = '' as $$
  select case p_stage when 'TEAM_LEAD' then 'Team Lead' when 'DEPARTMENT_HEAD' then 'Department Head' when 'OPERATIONS_HEAD' then 'Operations Head'
                      when 'HR' then 'HR' else p_stage end
$$;
revoke all on function private.leave_stage_label(text) from public, anon, authenticated;

-- Tell the people who decide the next stage.
create or replace function private.leave_notify_stage(r public.leave_requests)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_stage text := private.leave_stage_of(r.status);
  a record;
  v_name text := (select full_name from public.profiles where id = r.employee_id);
begin
  if v_stage is null then
    return;
  end if;
  for a in select * from private.leave_stage_approvers(r, v_stage) loop
    perform private.notify_once(a.approver_id, 'LEAVE_AWAITING_' || v_stage, 'Leave request awaiting your approval',
      format('%s requested %s leave (%s%s). Your step: %s%s.', v_name, case when r.leave_type = 'HALF_DAY' then 'half-day' else 'full-day' end,
             to_char(r.start_date, 'DD Mon YYYY'), case when r.end_date <> r.start_date then ' to ' || to_char(r.end_date, 'DD Mon YYYY') else '' end,
             private.leave_stage_label(v_stage), case when a.exception then ' (nobody else can decide it)' else '' end),
      'leave_request', r.id, format('LEAVE_%s:%s:%s:%s', v_stage, r.id, a.approver_id, r.updated_at), jsonb_build_object('employeeId', r.employee_id), 'urgent');
  end loop;
end $$;
revoke all on function private.leave_notify_stage(public.leave_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. What a request looks like on screen (the old fields stay, the chain and its timeline are added)
-- ---------------------------------------------------------------------------
create or replace function private.leave_row(r public.leave_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'employeeId', r.employee_id,
    'employeeName', (select p.full_name from public.profiles p where p.id = r.employee_id),
    'departmentName', (select d.name from public.departments d where d.id = r.department_id),
    'leaveType', r.leave_type, 'startDate', r.start_date, 'endDate', r.end_date, 'halfDayShift', r.half_day_shift,
    'days', case when r.leave_type = 'HALF_DAY' then 0.5 else
      (select count(*) from generate_series(r.start_date, r.end_date, interval '1 day') d where extract(isodow from d) <> 7) end,
    'reason', r.reason, 'status', r.status, 'createdAt', r.created_at,
    'workflowVersion', r.workflow_version,
    'stages', case when r.workflow_version >= 2 then to_jsonb(private.leave_stages_for(r.employee_id)) else '["DEPARTMENT_HEAD","HR"]'::jsonb end,
    'currentStage', private.leave_stage_of(r.status),
    'waitingFor', case when r.workflow_version >= 2 and private.leave_stage_of(r.status) is not null then
      (select coalesce(jsonb_agg(p.full_name order by p.full_name), '[]'::jsonb) from private.leave_stage_approvers(r, private.leave_stage_of(r.status)) a
         join public.profiles p on p.id = a.approver_id) end,
    'revisionNote', r.revision_note,
    'teamLead', case when r.tl_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.tl_decided_by), 'at', r.tl_decided_at, 'note', r.tl_note) end,
    'departmentHead', case when r.dh_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.dh_decided_by), 'at', r.dh_decided_at, 'note', r.dh_note) end,
    'operationsHead', case when r.oh_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.oh_decided_by), 'at', r.oh_decided_at, 'note', r.oh_note) end,
    'hr', case when r.hr_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.hr_decided_by), 'at', r.hr_decided_at, 'note', r.hr_note) end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('stage', ev.stage, 'decision', ev.decision, 'at', ev.created_at, 'note', ev.note,
                                                             'by', (select p.full_name from public.profiles p where p.id = ev.actor_id),
                                                             'onBehalf', ev.on_behalf) order by ev.id)
                            from public.leave_request_events ev where ev.request_id = r.id), '[]'::jsonb))
$$;
revoke all on function private.leave_row(public.leave_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Submitting (the same checks as before; the chain decides where it goes first)
-- ---------------------------------------------------------------------------
create or replace function public.submit_leave_request(
  p_leave_type text, p_start date, p_end date, p_half_day_shift text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_end date := coalesce(p_end, p_start);
  v_reason text := btrim(coalesce(p_reason, ''));
  r public.leave_requests;
  a uuid;
  v_first text;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if p_leave_type is null or p_leave_type not in ('FULL_DAY', 'HALF_DAY') or p_start is null then
    raise exception 'VALIDATION_ERROR: Choose the leave type and the date.' using errcode = 'P0001';
  end if;
  if p_leave_type = 'HALF_DAY' and (p_half_day_shift is null or p_half_day_shift not in ('MORNING', 'AFTERNOON')) then
    raise exception 'VALIDATION_ERROR: Choose the morning or the afternoon for a half day.' using errcode = 'P0001';
  end if;
  if p_leave_type = 'HALF_DAY' then v_end := p_start; end if;
  if v_end < p_start then
    raise exception 'VALIDATION_ERROR: The end date cannot be before the start date.' using errcode = 'P0001';
  end if;
  if v_end - p_start > 90 then
    raise exception 'VALIDATION_ERROR: A leave request can cover at most 90 days.' using errcode = 'P0001';
  end if;
  if length(v_reason) < 3 then
    raise exception 'VALIDATION_ERROR: Enter the reason for the leave.' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the reason under 1000 characters.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.leave_requests x where x.employee_id = me.id
              and x.status in ('PENDING_TEAM_LEAD', 'PENDING_DEPARTMENT_HEAD', 'PENDING_OPERATIONS_HEAD', 'PENDING_HR', 'APPROVED', 'REVISION_REQUIRED')
              and x.start_date <= v_end and x.end_date >= p_start) then
    raise exception 'CONFLICT: You already have a leave request for these dates.' using errcode = 'P0001';
  end if;

  if coalesce((select workflow from public.leave_settings where id), 'TWO_STEP') = 'TWO_STEP' then
    -- the previous two-step flow, exactly as before
    if not exists (select 1 from private.leave_stage1_ids(me.id)) then
      raise exception 'CONFLICT: There is no Department Head to review your leave yet. Contact HR.' using errcode = 'P0001';
    end if;
    insert into public.leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason)
    values (me.id, me.department_id, p_leave_type, p_start, v_end, case when p_leave_type = 'HALF_DAY' then p_half_day_shift end, v_reason)
    returning * into r;
    for a in select * from private.leave_stage1_ids(me.id) loop
      perform private.notify_once(a, 'LEAVE_AWAITING_DEPARTMENT_HEAD', 'Leave request awaiting your approval',
        format('%s requested %s leave (%s%s).', me.full_name, case when r.leave_type = 'HALF_DAY' then 'half-day' else 'full-day' end,
               to_char(r.start_date, 'DD Mon YYYY'), case when r.end_date <> r.start_date then ' to ' || to_char(r.end_date, 'DD Mon YYYY') else '' end),
        'leave_request', r.id, 'LEAVE_DH:' || r.id || ':' || a, jsonb_build_object('employeeId', me.id), 'urgent');
    end loop;
    perform private.write_audit('LEAVE_SUBMITTED', 'leave_request', r.id, me.department_id, null, jsonb_build_object('start', r.start_date, 'end', r.end_date));
    return private.leave_row(r);
  end if;

  v_first := private.leave_next_stage(me.id, null);
  insert into public.leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason, status, workflow_version)
  values (me.id, me.department_id, p_leave_type, p_start, v_end, case when p_leave_type = 'HALF_DAY' then p_half_day_shift end, v_reason,
          'PENDING_' || v_first, 2)
  returning * into r;
  if not exists (select 1 from private.leave_stage_approvers(r, v_first)) then
    raise exception 'CONFLICT: Nobody can review your leave yet. Contact HR.' using errcode = 'P0001';
  end if;
  insert into public.leave_request_events (request_id, stage, decision, actor_id) values (r.id, 'SUBMITTED', 'SUBMITTED', me.id);
  perform private.leave_notify_stage(r);
  perform private.write_audit('LEAVE_SUBMITTED', 'leave_request', r.id, me.department_id, null,
    jsonb_build_object('start', r.start_date, 'end', r.end_date, 'workflow', 'MULTI_LEVEL', 'first_stage', v_first));
  return private.leave_row(r);
end $$;
revoke all on function public.submit_leave_request(text, date, date, text, text) from public, anon;
grant execute on function public.submit_leave_request(text, date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Deciding one stage (only the current approver, in order, once)
-- ---------------------------------------------------------------------------
create or replace function public.decide_leave(p_id uuid, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  me uuid := auth.uid();
  v_decision text := upper(btrim(coalesce(p_decision, '')));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_stage text;
  v_next text;
  v_exception boolean;
  v_label text;
begin
  if me is null or not exists (select 1 from public.profiles p where p.id = me and p.status = 'ACTIVE') then
    raise exception 'FORBIDDEN: Sign in with an active account.' using errcode = '42501';
  end if;
  if v_decision not in ('APPROVE', 'REJECT', 'REVISE') then
    raise exception 'VALIDATION_ERROR: Choose approve, reject or send back for changes.' using errcode = 'P0001';
  end if;
  select * into r from public.leave_requests where id = p_id for update;     -- one decision at a time: a second click waits, then sees the new status
  if r.id is null then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';
  end if;
  if r.employee_id = me then
    raise exception 'FORBIDDEN: You cannot decide your own leave.' using errcode = '42501';
  end if;
  if r.workflow_version < 2 then
    raise exception 'CONFLICT: This request follows the earlier Department Head and HR approval.' using errcode = 'P0001';
  end if;
  v_stage := private.leave_stage_of(r.status);
  if v_stage is null then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;
  select a.exception into v_exception from private.leave_stage_approvers(r, v_stage) a where a.approver_id = me;
  if not found then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';      -- not yours to decide (or not at this stage)
  end if;
  if v_decision in ('REJECT', 'REVISE') and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give a reason.' using errcode = 'P0001';
  end if;
  if length(v_note) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 1000 characters.' using errcode = 'P0001';
  end if;
  v_label := private.leave_stage_label(v_stage);

  if v_decision = 'APPROVE' then
    v_next := private.leave_next_stage(r.employee_id, v_stage);
    update public.leave_requests set
      status = case when v_next is null then 'APPROVED' else 'PENDING_' || v_next end,
      tl_decided_by = case when v_stage = 'TEAM_LEAD' then me else tl_decided_by end, tl_decided_at = case when v_stage = 'TEAM_LEAD' then now() else tl_decided_at end,
      tl_note = case when v_stage = 'TEAM_LEAD' then v_note else tl_note end,
      dh_decided_by = case when v_stage = 'DEPARTMENT_HEAD' then me else dh_decided_by end, dh_decided_at = case when v_stage = 'DEPARTMENT_HEAD' then now() else dh_decided_at end,
      dh_note = case when v_stage = 'DEPARTMENT_HEAD' then v_note else dh_note end,
      oh_decided_by = case when v_stage = 'OPERATIONS_HEAD' then me else oh_decided_by end, oh_decided_at = case when v_stage = 'OPERATIONS_HEAD' then now() else oh_decided_at end,
      oh_note = case when v_stage = 'OPERATIONS_HEAD' then v_note else oh_note end,
      hr_decided_by = case when v_stage = 'HR' then me else hr_decided_by end, hr_decided_at = case when v_stage = 'HR' then now() else hr_decided_at end,
      hr_note = case when v_stage = 'HR' then v_note else hr_note end,
      updated_at = now()
     where id = r.id returning * into r;
  elsif v_decision = 'REJECT' then
    update public.leave_requests set status = 'REJECTED_BY_' || v_stage, updated_at = now(),
      tl_decided_by = case when v_stage = 'TEAM_LEAD' then me else tl_decided_by end, tl_decided_at = case when v_stage = 'TEAM_LEAD' then now() else tl_decided_at end,
      tl_note = case when v_stage = 'TEAM_LEAD' then v_note else tl_note end,
      dh_decided_by = case when v_stage = 'DEPARTMENT_HEAD' then me else dh_decided_by end, dh_decided_at = case when v_stage = 'DEPARTMENT_HEAD' then now() else dh_decided_at end,
      dh_note = case when v_stage = 'DEPARTMENT_HEAD' then v_note else dh_note end,
      oh_decided_by = case when v_stage = 'OPERATIONS_HEAD' then me else oh_decided_by end, oh_decided_at = case when v_stage = 'OPERATIONS_HEAD' then now() else oh_decided_at end,
      oh_note = case when v_stage = 'OPERATIONS_HEAD' then v_note else oh_note end,
      hr_decided_by = case when v_stage = 'HR' then me else hr_decided_by end, hr_decided_at = case when v_stage = 'HR' then now() else hr_decided_at end,
      hr_note = case when v_stage = 'HR' then v_note else hr_note end
     where id = r.id returning * into r;
  else
    update public.leave_requests set status = 'REVISION_REQUIRED', revision_note = v_note, updated_at = now() where id = r.id returning * into r;
  end if;

  insert into public.leave_request_events (request_id, stage, decision, actor_id, on_behalf, note)
  values (r.id, v_stage, case v_decision when 'APPROVE' then 'APPROVED' when 'REJECT' then 'REJECTED' else 'REVISION_REQUESTED' end,
          me, case when v_exception then 'SUPER_ADMIN_EXCEPTION' end, v_note);
  perform private.write_audit('LEAVE_' || v_stage || '_DECISION', 'leave_request', r.id, r.department_id, null,
    jsonb_build_object('decision', v_decision, 'exception', v_exception, 'status', r.status));

  perform private.notify_once(r.employee_id,
    case when r.status = 'APPROVED' then 'LEAVE_APPROVED' when v_decision = 'REJECT' then 'LEAVE_REJECTED' when v_decision = 'REVISE' then 'LEAVE_REVISION_REQUIRED'
         else 'LEAVE_STAGE_APPROVED' end,
    case when r.status = 'APPROVED' then 'Your leave is approved'
         when v_decision = 'REJECT' then format('Leave rejected by the %s', v_label)
         when v_decision = 'REVISE' then format('The %s asks you to change your leave request', v_label)
         else format('Leave approved by the %s', v_label) end,
    case when r.status = 'APPROVED' then 'HR gave the final approval.'
         when v_decision = 'APPROVE' then format('It now waits for the %s.', private.leave_stage_label(private.leave_stage_of(r.status)))
         else coalesce(v_note, '') end,
    'leave_request', r.id, format('LEAVE_EMP_%s:%s:%s', v_stage, r.id, v_decision), '{}'::jsonb);
  if v_decision = 'APPROVE' then
    perform private.leave_notify_stage(r);
  end if;
  return private.leave_row(r);
end $$;
revoke all on function public.decide_leave(uuid, text, text) from public, anon;
grant execute on function public.decide_leave(uuid, text, text) to authenticated;

-- The employee changes a request that was sent back; it starts the chain again (the earlier steps stay in the timeline).
create or replace function public.resubmit_leave_request(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_first text;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null or r.employee_id is distinct from auth.uid() then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'REVISION_REQUIRED' then
    raise exception 'CONFLICT: Only a request that was sent back can be changed.' using errcode = 'P0001';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 1000 then
    raise exception 'VALIDATION_ERROR: Enter the reason for the leave (3 to 1000 characters).' using errcode = 'P0001';
  end if;
  v_first := private.leave_next_stage(r.employee_id, null);
  update public.leave_requests set reason = v_reason, status = 'PENDING_' || v_first, revision_note = null,
         tl_decided_by = null, tl_decided_at = null, tl_note = null, dh_decided_by = null, dh_decided_at = null, dh_note = null,
         oh_decided_by = null, oh_decided_at = null, oh_note = null, hr_decided_by = null, hr_decided_at = null, hr_note = null, updated_at = now()
   where id = r.id returning * into r;
  insert into public.leave_request_events (request_id, stage, decision, actor_id) values (r.id, 'RESUBMITTED', 'SUBMITTED', auth.uid());
  perform private.leave_notify_stage(r);
  perform private.write_audit('LEAVE_RESUBMITTED', 'leave_request', r.id, r.department_id, null, '{}'::jsonb);
  return private.leave_row(r);
end $$;
revoke all on function public.resubmit_leave_request(uuid, text) from public, anon;
grant execute on function public.resubmit_leave_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The old entry points: a request of the new chain is decided by decide_leave (so an older screen keeps working, with the same checks)
-- ---------------------------------------------------------------------------
create or replace function private.leave_is_v2(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select workflow_version >= 2 from public.leave_requests where id = p_id), false)
$$;
revoke all on function private.leave_is_v2(uuid) from public, anon, authenticated;

-- (generated below)
create or replace function public.decide_leave_department_head(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  me public.profiles;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  h uuid;
begin
  if private.leave_is_v2(p_id) then
    return public.decide_leave(p_id, case when p_approve then 'APPROVE' else 'REJECT' end, p_note);
  end if;
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null or me.id is null or not exists (select 1 from private.leave_stage1_ids(r.employee_id) s where s = me.id) then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';
  end if;
  if r.employee_id = me.id then
    raise exception 'FORBIDDEN: You cannot decide your own leave.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING_DEPARTMENT_HEAD' then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;
  if p_approve is not true and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give a reason for rejecting the request.' using errcode = 'P0001';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'PENDING_HR' else 'REJECTED_BY_DEPARTMENT_HEAD' end,
         dh_decided_by = me.id, dh_decided_at = now(), dh_note = v_note, updated_at = now()
   where id = r.id returning * into r;

  perform private.notify_once(r.employee_id,
    case when p_approve then 'LEAVE_DEPARTMENT_HEAD_APPROVED' else 'LEAVE_DEPARTMENT_HEAD_REJECTED' end,
    case when p_approve then 'Leave approved by your Department Head' else 'Leave rejected by your Department Head' end,
    case when p_approve then 'It now waits for HR''s final approval.' else coalesce(v_note, '') end,
    'leave_request', r.id, 'LEAVE_EMP_DH:' || r.id, '{}'::jsonb);
  if p_approve then
    for h in select * from private.hr_department_member_ids() loop
      perform private.notify_once(h, 'LEAVE_AWAITING_HR', 'Leave request awaiting HR approval',
        format('%s: approved by the Department Head, now needs HR approval.', (select full_name from public.profiles where id = r.employee_id)),
        'leave_request', r.id, 'LEAVE_HR:' || r.id || ':' || h, jsonb_build_object('employeeId', r.employee_id), 'urgent');
    end loop;
  end if;
  perform private.write_audit('LEAVE_DEPARTMENT_HEAD_DECISION', 'leave_request', r.id, r.department_id, null, jsonb_build_object('approved', p_approve));
  return private.leave_row(r);
end $$;
revoke all on function public.decide_leave_department_head(uuid, boolean, text) from public, anon;
grant execute on function public.decide_leave_department_head(uuid, boolean, text) to authenticated;

create or replace function public.decide_leave_hr(p_id uuid, p_approve boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.leave_requests;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if private.leave_is_v2(p_id) then
    return public.decide_leave(p_id, case when p_approve then 'APPROVE' else 'REJECT' end, p_note);
  end if;
  if not private.is_hr_staff() then
    raise exception 'FORBIDDEN: Only HR can give the final approval.' using errcode = '42501';
  end if;
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';
  end if;
  if r.employee_id = auth.uid() then
    raise exception 'FORBIDDEN: You cannot decide your own leave.' using errcode = '42501';
  end if;
  if r.status <> 'PENDING_HR' then
    raise exception 'CONFLICT: %', case when r.status = 'PENDING_DEPARTMENT_HEAD' then 'The Department Head has not approved this request yet.'
                                        else 'This request has already been decided.' end using errcode = 'P0001';
  end if;
  if r.dh_decided_by is not distinct from auth.uid() then
    raise exception 'FORBIDDEN: The final approval must come from someone other than the Department Head who reviewed it.' using errcode = '42501';
  end if;
  if p_approve is not true and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give a reason for rejecting the request.' using errcode = 'P0001';
  end if;
  update public.leave_requests
     set status = case when p_approve then 'APPROVED' else 'REJECTED_BY_HR' end,
         hr_decided_by = auth.uid(), hr_decided_at = now(), hr_note = v_note, updated_at = now()
   where id = r.id returning * into r;

  perform private.notify_once(r.employee_id, case when p_approve then 'LEAVE_APPROVED' else 'LEAVE_REJECTED_BY_HR' end,
    case when p_approve then 'Your leave is approved' else 'Your leave was rejected by HR' end,
    case when p_approve then 'HR gave the final approval.' else coalesce(v_note, '') end,
    'leave_request', r.id, 'LEAVE_EMP_HR:' || r.id, '{}'::jsonb);
  perform private.notify_once(r.dh_decided_by, case when p_approve then 'LEAVE_APPROVED' else 'LEAVE_REJECTED_BY_HR' end,
    case when p_approve then 'Leave you approved was approved by HR' else 'Leave you approved was rejected by HR' end,
    (select full_name from public.profiles where id = r.employee_id),
    'leave_request', r.id, 'LEAVE_DH_FINAL:' || r.id, '{}'::jsonb);
  perform private.write_audit('LEAVE_HR_DECISION', 'leave_request', r.id, r.department_id, null, jsonb_build_object('approved', p_approve));
  return private.leave_row(r);
end $$;
revoke all on function public.decide_leave_hr(uuid, boolean, text) from public, anon;
grant execute on function public.decide_leave_hr(uuid, boolean, text) to authenticated;

create or replace function public.leave_requests_to_review()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_hr boolean := private.is_hr_staff();
begin
  return jsonb_build_object(
    'awaiting', coalesce((select jsonb_agg(private.leave_row(r) order by r.created_at)
        from public.leave_requests r
       where r.employee_id <> auth.uid()
         and ((r.workflow_version < 2 and r.status = 'PENDING_DEPARTMENT_HEAD' and exists (select 1 from private.leave_stage1_ids(r.employee_id) s where s = auth.uid()))
           or (r.workflow_version < 2 and r.status = 'PENDING_HR' and v_hr and r.dh_decided_by is distinct from auth.uid())
           -- the multi-level chain: the stage that waits, and only for the person who decides it now
           or (r.workflow_version >= 2 and private.leave_stage_of(r.status) is not null
               and exists (select 1 from private.leave_stage_approvers(r, private.leave_stage_of(r.status)) a where a.approver_id = auth.uid())))), '[]'::jsonb),
    'decided', coalesce((select jsonb_agg(private.leave_row(r) order by r.updated_at desc)
        from (select * from public.leave_requests x
               where x.employee_id <> auth.uid()
                 and ((x.dh_decided_by = auth.uid()) or (x.hr_decided_by = auth.uid()) or (x.tl_decided_by = auth.uid()) or (x.oh_decided_by = auth.uid())
                      or (v_hr and x.status in ('APPROVED', 'REJECTED_BY_HR', 'REJECTED_BY_DEPARTMENT_HEAD')))
               order by x.updated_at desc limit 40) r), '[]'::jsonb),
    'canReviewAsDepartmentHead', exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('DEPARTMENT_HEAD', 'SUPER_ADMIN')),
    'canReviewAsHr', v_hr,
    -- anyone who can be a stage of somebody's chain sees the review section (a Team Lead, a head, HR, the Super Admin)
    'canReview', v_hr or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'DEPARTMENT_HEAD', 'SUPER_ADMIN')));
end $$;
revoke all on function public.leave_requests_to_review() from public, anon;
grant execute on function public.leave_requests_to_review() to authenticated;

create or replace function public.leave_monthly_summary(p_month date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_start date := date_trunc('month', coalesce(p_month, private.office_today()))::date;
  v_end date := (date_trunc('month', coalesce(p_month, private.office_today())) + interval '1 month - 1 day')::date;
  v_all boolean := private.is_hr_staff();
  v_dept uuid;
  me public.profiles;
begin
  -- HR and the Super Admin see everyone; a Department Head the departments and function they head; an Operations Head the departments and
  -- function they supervise; a Team Lead their own direct members (only when leave goes through the Team Lead: the MULTI_LEVEL workflow)
  select * into me from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE';
  if not v_all and (me.id is null or me.role not in ('DEPARTMENT_HEAD', 'TEAM_HEAD')
                    or (me.role = 'TEAM_HEAD' and coalesce((select workflow from public.leave_settings where id), 'TWO_STEP') <> 'MULTI_LEVEL')) then
    raise exception 'FORBIDDEN: Not allowed.' using errcode = '42501';
  end if;
  return jsonb_build_object('month', to_char(v_start, 'YYYY-MM'), 'employees', coalesce((
    select jsonb_agg(jsonb_build_object('profileId', e.employee_id, 'halfDays', e.half_days, 'leaveDays', e.leave_days, 'records', e.records)
                     order by e.employee_id)
    from (
      select r.employee_id,
             count(*) filter (where r.leave_type = 'HALF_DAY') as half_days,
             coalesce(sum(case when r.leave_type = 'FULL_DAY' then
               (select count(*) from generate_series(greatest(r.start_date, v_start), least(r.end_date, v_end), interval '1 day') d
                 where extract(isodow from d) <> 7) else 0 end), 0)::integer as leave_days,
             jsonb_agg(jsonb_build_object('id', r.id, 'leaveType', r.leave_type, 'startDate', r.start_date, 'endDate', r.end_date,
                                          'halfDayShift', r.half_day_shift, 'reason', r.reason) order by r.start_date) as records
        from public.leave_requests r join public.profiles p on p.id = r.employee_id
       where r.status = 'APPROVED' and r.start_date <= v_end and r.end_date >= v_start
         and (v_all
              or (me.role = 'DEPARTMENT_HEAD' and not me.is_operations_head and private.head_covers(me.id, private.base_department(p.department_id), p.team_id))
              or (me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and private.scope_covers(me.id, p.department_id, private.leave_employee_division(p.id)))
              or (me.role = 'TEAM_HEAD' and private.direct_lead_of(p.id) = me.id))
       group by r.employee_id) e), '[]'::jsonb));
end $$;
revoke all on function public.leave_monthly_summary(date) from public, anon;
grant execute on function public.leave_monthly_summary(date) to authenticated;

create or replace function public.offboarding_impact(p_profile uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.profiles;
  s jsonb;
begin
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.role = 'SUPER_ADMIN' or not private.can_manage_profile(p_profile) then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  s := private.offboarding_scan(p_profile);
  return jsonb_build_object(
    'employee', jsonb_build_object('id', t.id, 'name', t.full_name, 'status', t.status, 'role', t.role, 'isMetaVerifier', t.is_meta_verifier,
                                   'isTechnicalConsultant', t.is_technical_consultant, 'department', (select d.name from public.departments d where d.id = t.department_id),
                                   'team', (select x.name from public.teams x where x.id = t.team_id)),
    'counts', jsonb_build_object('customersAsMember', jsonb_array_length(s -> 'customersAsMember'), 'customersAsLead', jsonb_array_length(s -> 'customersAsLead'),
                                 'customersAsVerifier', jsonb_array_length(s -> 'customersAsVerifier'), 'customersOwned', jsonb_array_length(s -> 'customersOwned'),
                                 'openTasks', jsonb_array_length(s -> 'openTasks'), 'directReports', jsonb_array_length(s -> 'directReports'),
                                 'reportsToReview', s -> 'reportsToReview', 'conversations', s -> 'conversations',
                                 -- leave steps this person decides now: once they are inactive the step goes to whoever the hierarchy names next
                                 -- (or the Super Admin); nothing is approved by itself
                                 'leaveApprovalsWaiting', (select count(*) from public.leave_requests r
                                    where r.workflow_version >= 2 and private.leave_stage_of(r.status) is not null
                                      and exists (select 1 from private.leave_stage_approvers(r, private.leave_stage_of(r.status)) a where a.approver_id = p_profile)),
                                 'ownLeavePending', (select count(*) from public.leave_requests r where r.employee_id = p_profile and r.status like 'PENDING\_%')),
    'needsInterimHead', t.role = 'DEPARTMENT_HEAD',
    'candidates', case when t.role = 'DEPARTMENT_HEAD' then '[]'::jsonb else private.offboarding_candidates(p_profile) end);
end $$;
revoke all on function public.offboarding_impact(uuid) from public, anon;
grant execute on function public.offboarding_impact(uuid) to authenticated;

notify pgrst, 'reload schema';
