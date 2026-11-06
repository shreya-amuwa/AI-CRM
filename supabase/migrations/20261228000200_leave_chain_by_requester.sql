-- =============================================================================
-- Leave approval: who approves depends on who asks (workflow_version 3).
-- Run after 20261225000200_leave_multi_level.sql. Safe to run again. No leave record is changed, re-decided or deleted.
--
-- A NEW request (the MULTI_LEVEL workflow) follows the chain of its requester:
--     Team Member                       Team Lead -> Department Head -> Operations Head -> HR
--     Meta Verifier                                  Department Head -> Operations Head -> HR   (no Team Lead step)
--     Team Lead                                      Department Head -> Operations Head -> HR
--     Department Head                                                   Operations Head -> HR
--     Operations Head                                                                      HR   (before: the Super Admin, then HR)
--     HR (anyone placed in the HR department)                                     Super Admin   (before: another HR person)
--     the Super Admin                                                                      HR
-- A department (and function) with NO Operations Head skips that step: the Department Head's approval goes straight to HR,
-- and a Department Head of such a department applies straight to HR.
--
-- Unchanged: each step's approver is resolved live from the hierarchy (20261225000200), a step nobody can decide goes to the Super Admin
-- (the defined exception, never approved by itself), nobody decides their own leave, and a step that is waiting is never skipped:
-- if an Operations Head leaves while their step waits, it is decided by the Super Admin as before.
-- Requests made before this migration keep the chain they were made under (workflow_version 1 or 2).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape: the Super Admin step (only for HR's own leave)
-- ---------------------------------------------------------------------------
alter table public.leave_requests
  add column if not exists sa_decided_by uuid references public.profiles (id) on delete set null,
  add column if not exists sa_decided_at timestamptz,
  add column if not exists sa_note text;

do $$
begin
  if exists (select 1 from pg_constraint where conname = 'leave_requests_status_v2_check') then
    alter table public.leave_requests drop constraint leave_requests_status_v2_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_status_v3_check') then
    alter table public.leave_requests add constraint leave_requests_status_v3_check check (status in (
      'PENDING_TEAM_LEAD', 'PENDING_DEPARTMENT_HEAD', 'PENDING_OPERATIONS_HEAD', 'PENDING_HR', 'PENDING_SUPER_ADMIN', 'APPROVED', 'REVISION_REQUIRED',
      'REJECTED_BY_TEAM_LEAD', 'REJECTED_BY_DEPARTMENT_HEAD', 'REJECTED_BY_OPERATIONS_HEAD', 'REJECTED_BY_HR', 'REJECTED_BY_SUPER_ADMIN'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_sa_note_check') then
    alter table public.leave_requests add constraint leave_requests_sa_note_check check (coalesce(length(sa_note), 0) <= 1000);
  end if;
  if exists (select 1 from pg_constraint where conname = 'leave_request_events_stage_check') then
    alter table public.leave_request_events drop constraint leave_request_events_stage_check;
  end if;
  alter table public.leave_request_events add constraint leave_request_events_stage_check
    check (stage in ('SUBMITTED', 'RESUBMITTED', 'TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'HR', 'SUPER_ADMIN'));
end $$;

-- ---------------------------------------------------------------------------
-- 2. The chain
-- ---------------------------------------------------------------------------
-- The order every chain follows (a chain is a subset of it).
create or replace function private.leave_stage_rank(p_stage text)
returns integer language sql immutable set search_path = '' as $$
  select array_position(array['TEAM_LEAD', 'DEPARTMENT_HEAD', 'OPERATIONS_HEAD', 'HR', 'SUPER_ADMIN'], p_stage)
$$;
revoke all on function private.leave_stage_rank(text) from public, anon, authenticated;

-- The Operations Head of this employee's leave: the one accountable for the department and the employee's function. A Department Head
-- who heads both functions (no function of their own) goes to the department's Operations Head of either function (Sales first).
-- Null = the department has no Operations Head for them: that step is left out of a new request's chain.
create or replace function private.leave_operations_head(p_employee uuid, p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select x.o from (
    select private.operations_owner_for(p_department, c.division) as o, c.ord
      from (select private.leave_employee_division(p_employee) as d) e
      cross join lateral (values (e.d, 1), ('SALES', 2), ('SUPPORT', 3)) as c (division, ord)
     where c.ord = 1 or e.d is null) x
   where x.o is not null and x.o <> p_employee
   order by x.ord limit 1
$$;
revoke all on function private.leave_operations_head(uuid, uuid) from public, anon, authenticated;

create or replace function private.leave_has_operations_head(p_employee uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.leave_operations_head(p_employee, p_department) is not null
$$;
revoke all on function private.leave_has_operations_head(uuid, uuid) from public, anon, authenticated;

-- The chain of a new request (workflow_version 3), from the requester as they are now.
create or replace function private.leave_stages_v3(p_employee uuid, p_department uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  e public.profiles;
  v_dept uuid;
  v_ops text[];
begin
  select * into e from public.profiles where id = p_employee;
  if e.id is null then
    return array['HR'];
  end if;
  v_dept := coalesce(p_department, e.department_id);
  v_ops := case when private.leave_has_operations_head(e.id, v_dept) then array['OPERATIONS_HEAD'] else array[]::text[] end;
  if e.role = 'SUPER_ADMIN' then
    return array['HR'];
  elsif exists (select 1 from public.departments d where d.id = e.department_id and d.slug = 'hr') then
    return array['SUPER_ADMIN'];                                         -- HR's own leave
  elsif e.role = 'DEPARTMENT_HEAD' and e.is_operations_head then
    return array['HR'];
  elsif e.role = 'DEPARTMENT_HEAD' then
    return v_ops || array['HR'];
  elsif e.role = 'TEAM_HEAD' or (e.role = 'TEAM_MEMBER' and e.is_meta_verifier) then
    return array['DEPARTMENT_HEAD'] || v_ops || array['HR'];
  elsif e.role = 'TEAM_MEMBER' then
    return array['TEAM_LEAD', 'DEPARTMENT_HEAD'] || v_ops || array['HR'];
  end if;
  return array['HR'];
end $$;
revoke all on function private.leave_stages_v3(uuid, uuid) from public, anon, authenticated;

-- The chain of a given request, by the rules it was made under. A step that waits is always shown (and decided), even if the
-- hierarchy changed since.
create or replace function private.leave_chain(r public.leave_requests)
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when r.workflow_version < 2 then array['DEPARTMENT_HEAD', 'HR']
    when r.workflow_version = 2 then private.leave_stages_for(r.employee_id)
    else (select array_agg(s order by private.leave_stage_rank(s))
            from (select unnest(private.leave_stages_v3(r.employee_id, r.department_id)) as s
                  union
                  select private.leave_stage_of(r.status) where private.leave_stage_of(r.status) is not null) x) end
$$;
revoke all on function private.leave_chain(public.leave_requests) from public, anon, authenticated;

-- The step after p_after (null = the first one), or null when p_after was the last.
create or replace function private.leave_next_for(r public.leave_requests, p_after text)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when r.workflow_version = 2 then private.leave_next_stage(r.employee_id, p_after)
    when p_after is null then (private.leave_stages_v3(r.employee_id, r.department_id))[1]
    else (select s from unnest(private.leave_stages_v3(r.employee_id, r.department_id)) s
           where private.leave_stage_rank(s) > private.leave_stage_rank(p_after) order by private.leave_stage_rank(s) limit 1) end
$$;
revoke all on function private.leave_next_for(public.leave_requests, text) from public, anon, authenticated;

-- Who may decide this step right now: as before, plus the Super Admin step of HR's own leave.
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
      v_ids := array(select o from (select private.leave_operations_head(e.id, coalesce(r.department_id, e.department_id)) as o) x where o is not null);
    end if;
  elsif p_stage = 'HR' then
    v_ids := array(select p.id from public.profiles p join public.departments d on d.id = p.department_id
                    where d.slug = 'hr' and p.status = 'ACTIVE' and coalesce(p.hr_sub_role, '') <> 'HR_RECRUITER' and p.id <> e.id
                      and p.id is distinct from r.tl_decided_by and p.id is distinct from r.dh_decided_by and p.id is distinct from r.oh_decided_by
                    order by p.created_at);
  elsif p_stage = 'SUPER_ADMIN' then
    -- HR's own leave: the Super Admin is the approver of this step (not an exception)
    v_ids := array(select s.id from public.profiles s where s.role = 'SUPER_ADMIN' and s.status = 'ACTIVE' and s.id <> e.id order by s.created_at);
  end if;
  if coalesce(cardinality(v_ids), 0) > 0 then
    return query select x, false from unnest(v_ids) x;
    return;
  end if;
  -- the defined exception: the Super Admin decides a step nobody else can (never the employee themselves)
  return query select s.id, true from public.profiles s
                where s.role = 'SUPER_ADMIN' and s.status = 'ACTIVE' and s.id <> e.id
                  and s.id is distinct from r.tl_decided_by and s.id is distinct from r.dh_decided_by and s.id is distinct from r.oh_decided_by
                order by s.created_at;
end $$;
revoke all on function private.leave_stage_approvers(public.leave_requests, text) from public, anon, authenticated;

create or replace function private.leave_stage_label(p_stage text)
returns text language sql immutable set search_path = '' as $$
  select case p_stage when 'TEAM_LEAD' then 'Team Lead' when 'DEPARTMENT_HEAD' then 'Department Head' when 'OPERATIONS_HEAD' then 'Operations Head'
                      when 'HR' then 'HR' when 'SUPER_ADMIN' then 'Super Admin' else p_stage end
$$;
revoke all on function private.leave_stage_label(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. On screen: the chain of the request, and the Super Admin's decision
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
    'stages', to_jsonb(private.leave_chain(r)),
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
    'superAdmin', case when r.sa_decided_at is null then null else jsonb_build_object(
      'name', (select p.full_name from public.profiles p where p.id = r.sa_decided_by), 'at', r.sa_decided_at, 'note', r.sa_note) end,
    'timeline', coalesce((select jsonb_agg(jsonb_build_object('stage', ev.stage, 'decision', ev.decision, 'at', ev.created_at, 'note', ev.note,
                                                             'by', (select p.full_name from public.profiles p where p.id = ev.actor_id),
                                                             'onBehalf', ev.on_behalf) order by ev.id)
                            from public.leave_request_events ev where ev.request_id = r.id), '[]'::jsonb))
$$;
revoke all on function private.leave_row(public.leave_requests) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Submitting (the same checks as before; new requests use the chain above)
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
              and x.status in ('PENDING_TEAM_LEAD', 'PENDING_DEPARTMENT_HEAD', 'PENDING_OPERATIONS_HEAD', 'PENDING_HR', 'PENDING_SUPER_ADMIN', 'APPROVED', 'REVISION_REQUIRED')
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

  v_first := (private.leave_stages_v3(me.id, me.department_id))[1];
  insert into public.leave_requests (employee_id, department_id, leave_type, start_date, end_date, half_day_shift, reason, status, workflow_version)
  values (me.id, me.department_id, p_leave_type, p_start, v_end, case when p_leave_type = 'HALF_DAY' then p_half_day_shift end, v_reason,
          'PENDING_' || v_first, 3)
  returning * into r;
  if not exists (select 1 from private.leave_stage_approvers(r, v_first)) then
    raise exception 'CONFLICT: Nobody can review your leave yet. Contact HR.' using errcode = 'P0001';
  end if;
  insert into public.leave_request_events (request_id, stage, decision, actor_id) values (r.id, 'SUBMITTED', 'SUBMITTED', me.id);
  perform private.leave_notify_stage(r);
  perform private.write_audit('LEAVE_SUBMITTED', 'leave_request', r.id, me.department_id, null,
    jsonb_build_object('start', r.start_date, 'end', r.end_date, 'workflow', 'MULTI_LEVEL', 'first_stage', v_first, 'chain', to_jsonb(private.leave_chain(r))));
  return private.leave_row(r);
end $$;
revoke all on function public.submit_leave_request(text, date, date, text, text) from public, anon;
grant execute on function public.submit_leave_request(text, date, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Deciding one step (only the current approver, in order, once)
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
  v_status text;
  v_exception boolean;
  v_label text;
  v_decided boolean;
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
    raise exception 'NOT_FOUND: Leave request not found.' using errcode = 'P0001';      -- not yours to decide (or not at this step)
  end if;
  if v_decision in ('REJECT', 'REVISE') and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give a reason.' using errcode = 'P0001';
  end if;
  if length(v_note) > 1000 then
    raise exception 'VALIDATION_ERROR: Keep the note under 1000 characters.' using errcode = 'P0001';
  end if;
  v_label := private.leave_stage_label(v_stage);

  if v_decision = 'APPROVE' then
    v_next := private.leave_next_for(r, v_stage);
    v_status := case when v_next is null then 'APPROVED' else 'PENDING_' || v_next end;
  elsif v_decision = 'REJECT' then
    v_status := 'REJECTED_BY_' || v_stage;
  else
    v_status := 'REVISION_REQUIRED';
  end if;
  v_decided := v_decision <> 'REVISE';
  update public.leave_requests set
    status = v_status, updated_at = now(),
    revision_note = case when v_decision = 'REVISE' then v_note else revision_note end,
    tl_decided_by = case when v_decided and v_stage = 'TEAM_LEAD' then me else tl_decided_by end,
    tl_decided_at = case when v_decided and v_stage = 'TEAM_LEAD' then now() else tl_decided_at end,
    tl_note = case when v_decided and v_stage = 'TEAM_LEAD' then v_note else tl_note end,
    dh_decided_by = case when v_decided and v_stage = 'DEPARTMENT_HEAD' then me else dh_decided_by end,
    dh_decided_at = case when v_decided and v_stage = 'DEPARTMENT_HEAD' then now() else dh_decided_at end,
    dh_note = case when v_decided and v_stage = 'DEPARTMENT_HEAD' then v_note else dh_note end,
    oh_decided_by = case when v_decided and v_stage = 'OPERATIONS_HEAD' then me else oh_decided_by end,
    oh_decided_at = case when v_decided and v_stage = 'OPERATIONS_HEAD' then now() else oh_decided_at end,
    oh_note = case when v_decided and v_stage = 'OPERATIONS_HEAD' then v_note else oh_note end,
    hr_decided_by = case when v_decided and v_stage = 'HR' then me else hr_decided_by end,
    hr_decided_at = case when v_decided and v_stage = 'HR' then now() else hr_decided_at end,
    hr_note = case when v_decided and v_stage = 'HR' then v_note else hr_note end,
    sa_decided_by = case when v_decided and v_stage = 'SUPER_ADMIN' then me else sa_decided_by end,
    sa_decided_at = case when v_decided and v_stage = 'SUPER_ADMIN' then now() else sa_decided_at end,
    sa_note = case when v_decided and v_stage = 'SUPER_ADMIN' then v_note else sa_note end
   where id = r.id returning * into r;

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
    case when r.status = 'APPROVED' then format('The %s gave the final approval.', v_label)
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

-- The employee changes a request that was sent back; it starts its chain again (the earlier steps stay in the timeline).
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
  v_first := private.leave_next_for(r, null);
  update public.leave_requests set reason = v_reason, status = 'PENDING_' || v_first, revision_note = null,
         tl_decided_by = null, tl_decided_at = null, tl_note = null, dh_decided_by = null, dh_decided_at = null, dh_note = null,
         oh_decided_by = null, oh_decided_at = null, oh_note = null, hr_decided_by = null, hr_decided_at = null, hr_note = null,
         sa_decided_by = null, sa_decided_at = null, sa_note = null, updated_at = now()
   where id = r.id returning * into r;
  insert into public.leave_request_events (request_id, stage, decision, actor_id) values (r.id, 'RESUBMITTED', 'SUBMITTED', auth.uid());
  perform private.leave_notify_stage(r);
  perform private.write_audit('LEAVE_RESUBMITTED', 'leave_request', r.id, r.department_id, null, '{}'::jsonb);
  return private.leave_row(r);
end $$;
revoke all on function public.resubmit_leave_request(uuid, text) from public, anon;
grant execute on function public.resubmit_leave_request(uuid, text) to authenticated;

-- The review lists: the Super Admin's own decisions are listed as decided too.
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
           -- the multi-level chain: the step that waits, and only for the person who decides it now
           or (r.workflow_version >= 2 and private.leave_stage_of(r.status) is not null
               and exists (select 1 from private.leave_stage_approvers(r, private.leave_stage_of(r.status)) a where a.approver_id = auth.uid())))), '[]'::jsonb),
    'decided', coalesce((select jsonb_agg(private.leave_row(r) order by r.updated_at desc)
        from (select * from public.leave_requests x
               where x.employee_id <> auth.uid()
                 and ((x.dh_decided_by = auth.uid()) or (x.hr_decided_by = auth.uid()) or (x.tl_decided_by = auth.uid()) or (x.oh_decided_by = auth.uid())
                      or (x.sa_decided_by = auth.uid())
                      or (v_hr and x.status in ('APPROVED', 'REJECTED_BY_HR', 'REJECTED_BY_DEPARTMENT_HEAD')))
               order by x.updated_at desc limit 40) r), '[]'::jsonb),
    'canReviewAsDepartmentHead', exists (
        select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('DEPARTMENT_HEAD', 'SUPER_ADMIN')),
    'canReviewAsHr', v_hr,
    'canReview', v_hr or exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'DEPARTMENT_HEAD', 'SUPER_ADMIN')));
end $$;
revoke all on function public.leave_requests_to_review() from public, anon;
grant execute on function public.leave_requests_to_review() to authenticated;

notify pgrst, 'reload schema';
