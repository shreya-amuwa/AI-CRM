-- Employee offboarding and work reassignment: an impact summary first, then ONE transaction that moves the work, closes the access and audits it.
--
-- WHAT EXISTED: set_user_status(ACTIVE | SUSPENDED | REVOKED) only changed the status (and the API blocked sign-in). Customers, hand-over assignments, verifications,
-- tasks and a Team Lead's people stayed pointing at a person who no longer works here; nothing listed them and nothing moved them.
-- WHAT THIS ADDS (additive; no customer, chat, report or approval is deleted, decided or rewritten):
--   * offboarding_impact(person): read-only. Who the person is (role, department, team) and what is attached to them: customers they look after (Team Member,
--     Team Lead, verifier, owner), unfinished verifications, open tasks, people reporting to them, reports waiting for their review, ongoing client conversations,
--     and the ACTIVE colleagues who could take the work (never an automatic pick).
--   * offboard_employee(person, replacement, status, reason): the signed-in person must be allowed to manage that profile (the same rule as the status change).
--     With a replacement of the right kind the work moves to them; without one (or when the replacement is not eligible for an item) the item goes to the
--     visible Reassignment Required queue. Then the account is suspended or revoked. All in one transaction: a failure moves nothing and leaves the account as it was.
--   * reassignment_queue / reassignment_queue_list / reassignment_resolve: the queue a manager works through (Super Admin: all; a Department Head: their departments;
--     an Operations Head: the departments they own).
-- NOT done on purpose: nothing is approved on anybody's behalf, a Department Head's pending approvals are never moved to an arbitrary person (the queue and a
-- notification to the Operations Head / Super Admin say the department needs an interim head), historical ownership stays in the audit log (from -> to).
-- The API also blocks the account's sign-in, exactly as for any status change.
-- Run after 20261223000300_meta_verifier_departments.sql. Safe to run again.

create table if not exists public.reassignment_queue (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('CUSTOMER_MEMBER', 'CUSTOMER_LEAD', 'CUSTOMER_VERIFIER', 'MEMBER_LEAD', 'TASK', 'DEPARTMENT_HEAD')),
  entity_id uuid not null,
  department_id uuid references public.departments (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  from_profile uuid references public.profiles (id) on delete set null,
  label text check (length(label) <= 200),
  reason text check (length(reason) <= 500),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_to uuid references public.profiles (id) on delete set null
);
create unique index if not exists reassignment_queue_open_key on public.reassignment_queue (kind, entity_id) where resolved_at is null;
create index if not exists reassignment_queue_dept_idx on public.reassignment_queue (department_id) where resolved_at is null;
alter table public.reassignment_queue enable row level security;
revoke all on table public.reassignment_queue from public, anon, authenticated;

-- may the signed-in person see / work an item of this department?
create or replace function private.may_work_reassignment(p_department uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_super_admin()
      or (private.my_role() = 'DEPARTMENT_HEAD' and p_department is not null and p_department is not distinct from private.my_department_id())
      or (p_department is not null and private.owner_of_department(private.base_department(p_department)) = auth.uid())
$$;
revoke all on function private.may_work_reassignment(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- What is attached to a person (counts and the ids the move uses)
-- ---------------------------------------------------------------------------
create or replace function private.offboarding_scan(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'customersAsMember', (select coalesce(jsonb_agg(o.customer_id), '[]'::jsonb) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                           where o.team_member_id = p_profile and o.handover_stage = 'TEAM_MEMBER' and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')),
    'customersAsLead', (select coalesce(jsonb_agg(o.customer_id), '[]'::jsonb) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                         where o.team_lead_id = p_profile and o.handover_stage in ('TEAM_LEAD', 'TEAM_MEMBER') and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')),
    'customersAsVerifier', (select coalesce(jsonb_agg(o.customer_id), '[]'::jsonb) from public.customer_onboarding o
                             where o.meta_verifier_id = p_profile and o.meta_status <> 'COMPLETED' and o.onboarding_completed_at is null),
    'customersOwned', (select coalesce(jsonb_agg(c.id), '[]'::jsonb) from public.customers c
                        where c.owner_id = p_profile and c.lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER')),
    'openTasks', (select coalesce(jsonb_agg(t.id), '[]'::jsonb) from public.work_tasks t where t.assignee_id = p_profile and t.status <> 'COMPLETED'),
    'directReports', (select coalesce(jsonb_agg(m.id), '[]'::jsonb) from public.profiles m
                       where m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE' and m.manager_id = p_profile),
    'reportsToReview', (select count(*) from public.work_reports r where r.kind = 'MEMBER' and r.status in ('SUBMITTED', 'UNDER_REVIEW') and private.report_lead_of(r) = p_profile),
    'conversations', (select count(*) from public.chat_conversations cv
                       join public.customers c on c.id = cv.customer_id
                      where cv.kind = 'CLIENT' and c.lifecycle_stage in ('ONBOARDING', 'CUSTOMER')
                        and (private.support_member_of(c.id) = p_profile or private.support_lead_of(c.id) = p_profile or private.meta_verifier_of(c.id) = p_profile)))
$$;
revoke all on function private.offboarding_scan(uuid) from public, anon, authenticated;

-- who could take a person's work: active colleagues of the same kind (never chosen automatically)
create or replace function private.offboarding_candidates(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.full_name, 'role', case when c.is_meta_verifier then 'Meta Verifier' when c.is_technical_consultant then 'Technical Consultant'
                                                                                              when c.role = 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end) order by c.full_name), '[]'::jsonb)
    from public.profiles t join public.profiles c on c.status = 'ACTIVE' and c.id <> t.id
   where t.id = p_profile
     and ((t.role = 'TEAM_HEAD' and c.role = 'TEAM_HEAD' and c.team_id is not distinct from t.team_id)
       or (t.role = 'TEAM_MEMBER' and t.is_meta_verifier and c.role = 'TEAM_MEMBER' and c.is_meta_verifier
           and exists (select 1 from private.verifier_departments_of(t.id) d where private.verifier_covers(c.id, d)))
       or (t.role = 'TEAM_MEMBER' and t.is_technical_consultant and c.role = 'TEAM_MEMBER' and c.is_technical_consultant and c.department_id is not distinct from t.department_id)
       or (t.role = 'TEAM_MEMBER' and not t.is_meta_verifier and not t.is_technical_consultant and private.is_ordinary_member(c) and c.team_id is not distinct from t.team_id
           and private.direct_lead_of(c.id) is not distinct from private.direct_lead_of(t.id)))
$$;
revoke all on function private.offboarding_candidates(uuid) from public, anon, authenticated;

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
                                 'reportsToReview', s -> 'reportsToReview', 'conversations', s -> 'conversations'),
    'needsInterimHead', t.role = 'DEPARTMENT_HEAD',
    'candidates', case when t.role = 'DEPARTMENT_HEAD' then '[]'::jsonb else private.offboarding_candidates(p_profile) end);
end $$;
revoke all on function public.offboarding_impact(uuid) from public, anon;
grant execute on function public.offboarding_impact(uuid) to authenticated;

-- put an item in the queue (once)
create or replace function private.queue_reassignment(p_kind text, p_entity uuid, p_department uuid, p_team uuid, p_from uuid, p_label text, p_reason text)
returns void language sql security definer set search_path = '' as $$
  insert into public.reassignment_queue (kind, entity_id, department_id, team_id, from_profile, label, reason, created_by)
  values (p_kind, p_entity, p_department, p_team, p_from, left(p_label, 200), left(p_reason, 500), (select private.my_id()))
  on conflict (kind, entity_id) where resolved_at is null do nothing
$$;
revoke all on function private.queue_reassignment(text, uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The offboarding: one transaction
-- ---------------------------------------------------------------------------
create or replace function public.offboard_employee(p_profile uuid, p_replacement uuid default null, p_status text default 'REVOKED', p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  r public.profiles;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  s jsonb;
  x record;
  v_id uuid;
  v_pick uuid;
  v_moved jsonb := jsonb_build_object('customers', 0, 'verifications', 0, 'tasks', 0, 'members', 0, 'reports', 0);
  v_queued integer := 0;
  v_n integer;
  v_candidates jsonb;
begin
  select * into t from public.profiles where id = p_profile for update;
  if t.id is null or t.role = 'SUPER_ADMIN' or not private.can_manage_profile(p_profile) then
    raise exception 'NOT_FOUND: Employee not found.' using errcode = 'P0001';
  end if;
  if v_status not in ('SUSPENDED', 'REVOKED') then
    raise exception 'VALIDATION_ERROR: Choose Suspended or Revoked.' using errcode = 'P0001';
  end if;
  if t.status not in ('ACTIVE', 'SUSPENDED') then
    raise exception 'CONFLICT: This account is not active.' using errcode = 'P0001';
  end if;
  if p_replacement is not null then
    select * into r from public.profiles where id = p_replacement;
    v_candidates := private.offboarding_candidates(p_profile);
    if r.id is null or r.status <> 'ACTIVE' or not exists (select 1 from jsonb_array_elements(v_candidates) c where (c ->> 'id')::uuid = p_replacement) then
      raise exception 'VALIDATION_ERROR: Choose an active colleague who can take this work (the list in the impact summary).' using errcode = 'P0001';
    end if;
  end if;
  s := private.offboarding_scan(p_profile);

  -- 1. customers the person looks after as Team Member
  for x in select c.id, c.department_id, c.team_id, coalesce(c.company, c.name) as nm from public.customers c where c.id in (select (j)::uuid from jsonb_array_elements_text(s -> 'customersAsMember') j) loop
    if r.id is not null then
      update public.customer_onboarding set team_member_id = r.id, assigned_to_member_at = now(), assigned_to_member_by = (select private.my_id()) where customer_id = x.id;
      perform private.log_customer_activity(x.id, 'ASSIGNED_TO_TEAM_MEMBER', format('Reassigned from %s to %s (%s left)', t.full_name, r.full_name, t.full_name));
      perform private.notify(r.id, 'HANDOVER_TO_TEAM_MEMBER', format('Client reassigned to you: %s', x.nm), format('%s no longer works here; you now look after this client.', t.full_name), 'customer', x.id);
      v_moved := jsonb_set(v_moved, '{customers}', to_jsonb((v_moved ->> 'customers')::int + 1));
    else
      perform private.queue_reassignment('CUSTOMER_MEMBER', x.id, x.department_id, x.team_id, p_profile, x.nm, v_reason);
      v_queued := v_queued + 1;
    end if;
  end loop;
  -- 2. as Team Lead
  for x in select c.id, c.department_id, c.team_id, coalesce(c.company, c.name) as nm from public.customers c where c.id in (select (j)::uuid from jsonb_array_elements_text(s -> 'customersAsLead') j) loop
    if r.id is not null and r.role = 'TEAM_HEAD' then
      update public.customer_onboarding set team_lead_id = r.id where customer_id = x.id;
      perform private.log_customer_activity(x.id, 'HANDOVER', format('Team Lead changed from %s to %s', t.full_name, r.full_name));
      perform private.notify(r.id, 'HANDOVER_TO_TEAM_LEAD', format('Client reassigned to you: %s', x.nm), format('%s no longer works here; you are now the Team Lead of this client.', t.full_name), 'customer', x.id);
      v_moved := jsonb_set(v_moved, '{customers}', to_jsonb((v_moved ->> 'customers')::int + 1));
    else
      perform private.queue_reassignment('CUSTOMER_LEAD', x.id, x.department_id, x.team_id, p_profile, x.nm, v_reason);
      v_queued := v_queued + 1;
    end if;
  end loop;
  -- 3. unfinished verifications: the replacement if they may verify it, else another eligible verifier, else the queue
  for x in select c.id, c.department_id, c.team_id, coalesce(c.company, c.name) as nm from public.customers c where c.id in (select (j)::uuid from jsonb_array_elements_text(s -> 'customersAsVerifier') j) loop
    v_pick := case when r.id is not null and private.is_verifier_for(r.id, x.id) then r.id end;
    if v_pick is not null then
      update public.customer_onboarding set meta_verifier_id = v_pick, meta_verifier_assigned_at = now(), meta_verifier_assigned_by = (select private.my_id()) where customer_id = x.id;
      perform private.notify(v_pick, 'META_VERIFIER_ASSIGNED', format('New Meta verification: %s', x.nm), format('%s no longer works here; you are now the verifier of this client.', t.full_name), 'customer', x.id);
      v_moved := jsonb_set(v_moved, '{verifications}', to_jsonb((v_moved ->> 'verifications')::int + 1));
    else
      update public.customer_onboarding set meta_verifier_id = null, meta_verifier_assigned_at = null where customer_id = x.id;
      perform private.queue_reassignment('CUSTOMER_VERIFIER', x.id, x.department_id, x.team_id, p_profile, x.nm, v_reason);
      v_queued := v_queued + 1;
    end if;
  end loop;
  -- 4. the people of a Team Lead (and their pending reports with them)
  for x in select m.id, m.team_id, m.department_id, m.full_name from public.profiles m where m.id in (select (j)::uuid from jsonb_array_elements_text(s -> 'directReports') j) loop
    if r.id is not null and r.role = 'TEAM_HEAD' and r.team_id is not distinct from x.team_id then
      update public.profiles set manager_id = r.id where id = x.id;
      v_n := private.move_pending_reports_to_lead(x.id, r.id, format('%s left; the report moved to %s.', t.full_name, r.full_name));
      v_moved := jsonb_set(jsonb_set(v_moved, '{members}', to_jsonb((v_moved ->> 'members')::int + 1)), '{reports}', to_jsonb((v_moved ->> 'reports')::int + v_n));
      perform private.notify(r.id, 'TEAM_MEMBER_ASSIGNED', format('%s is now in your team', x.full_name), 'You are their Team Lead for tasks and daily reports.', 'profile', x.id);
    else
      perform private.queue_reassignment('MEMBER_LEAD', x.id, x.department_id, x.team_id, p_profile, x.full_name, v_reason);
      v_queued := v_queued + 1;
    end if;
  end loop;
  -- 5. open tasks go to the replacement (same department) or wait in the queue
  for x in select w.id, w.department_id, w.team_id, w.title from public.work_tasks w where w.id in (select (j)::uuid from jsonb_array_elements_text(s -> 'openTasks') j) loop
    if r.id is not null and r.department_id is not distinct from x.department_id then
      update public.work_tasks set assignee_id = r.id, updated_at = now() where id = x.id;
      perform private.notify(r.id, 'TASK_ASSIGNED', format('Task reassigned to you: %s', x.title), format('%s no longer works here.', t.full_name), 'work_task', x.id);
      v_moved := jsonb_set(v_moved, '{tasks}', to_jsonb((v_moved ->> 'tasks')::int + 1));
    else
      perform private.queue_reassignment('TASK', x.id, x.department_id, x.team_id, p_profile, x.title, v_reason);
      v_queued := v_queued + 1;
    end if;
  end loop;
  -- 6. a Department Head: nothing is moved to an arbitrary person; the department is queued and the Operations Head / Super Admin are told
  if t.role = 'DEPARTMENT_HEAD' then
    perform private.queue_reassignment('DEPARTMENT_HEAD', t.department_id, t.department_id, null, p_profile, (select d.name from public.departments d where d.id = t.department_id), v_reason);
    v_queued := v_queued + 1;
    v_id := private.owner_of_department(private.base_department(t.department_id));
    if v_id is not null and v_id <> p_profile then
      perform private.notify(v_id, 'DEPARTMENT_HEAD_LEFT', format('%s needs a Department Head', (select d.name from public.departments d where d.id = t.department_id)),
        format('%s no longer works here. Pending department-level approvals wait for an interim or new Department Head.', t.full_name), 'profile', p_profile);
    end if;
  end if;
  -- customers the person owns (leads, customers added by them): the owner moves to the replacement of the same team, else stays and is queued only as noted above
  if r.id is not null and r.team_id is not null then
    update public.customers set owner_id = r.id where owner_id = p_profile and team_id is not distinct from r.team_id
       and lifecycle_stage in ('LEAD', 'POTENTIAL', 'ONBOARDING', 'CUSTOMER');
  end if;

  -- the account is closed last, in the same transaction
  update public.profiles set status = v_status::public.account_status, status_reason = v_reason, status_changed_at = now(), status_changed_by = (select private.my_id()) where id = p_profile;
  perform private.write_audit('EMPLOYEE_OFFBOARDED', 'profile', p_profile, t.department_id, t.team_id,
    jsonb_build_object('status', v_status, 'replacement', p_replacement, 'moved', v_moved, 'queued', v_queued, 'counts',
      jsonb_build_object('customers', jsonb_array_length(s -> 'customersAsMember') + jsonb_array_length(s -> 'customersAsLead'), 'verifications', jsonb_array_length(s -> 'customersAsVerifier'),
                         'tasks', jsonb_array_length(s -> 'openTasks'), 'members', jsonb_array_length(s -> 'directReports'))));
  if v_queued > 0 then
    for x in select m.id from public.profiles m where m.status = 'ACTIVE' and m.id <> p_profile and (
               (m.role = 'DEPARTMENT_HEAD' and m.department_id is not distinct from t.department_id) or m.id = private.owner_of_department(private.base_department(t.department_id))) loop
      perform private.notify(x.id, 'REASSIGNMENT_REQUIRED', format('Reassignment required: %s', t.full_name), format('%s item%s waiting in the Reassignment Required queue.', v_queued, case when v_queued = 1 then ' is' else 's are' end), 'profile', p_profile);
    end loop;
  end if;
  return jsonb_build_object('status', v_status, 'moved', v_moved, 'queued', v_queued);
end $$;
revoke all on function public.offboard_employee(uuid, uuid, text, text) from public, anon;
grant execute on function public.offboard_employee(uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- The queue
-- ---------------------------------------------------------------------------
create or replace function public.reassignment_queue_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.my_id() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', q.id, 'kind', q.kind, 'entityId', q.entity_id, 'label', q.label, 'reason', q.reason, 'createdAt', q.created_at,
             'department', (select d.name from public.departments d where d.id = q.department_id), 'departmentId', q.department_id,
             'from', (select p.full_name from public.profiles p where p.id = q.from_profile)) order by q.created_at)
      from public.reassignment_queue q where q.resolved_at is null and private.may_work_reassignment(q.department_id)), '[]'::jsonb);
end $$;
revoke all on function public.reassignment_queue_list() from public, anon;
grant execute on function public.reassignment_queue_list() to authenticated;

create or replace function public.reassignment_resolve(p_item uuid, p_to uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  q public.reassignment_queue;
  r public.profiles;
  c public.customers;
begin
  select * into q from public.reassignment_queue where id = p_item and resolved_at is null for update;
  if q.id is null or not private.may_work_reassignment(q.department_id) then
    raise exception 'NOT_FOUND: Item not found.' using errcode = 'P0001';
  end if;
  if q.kind = 'DEPARTMENT_HEAD' then
    -- resolved by the Super Admin / Operations Head once the department has a head again (create or assign one first)
    if not exists (select 1 from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and h.department_id = q.department_id) then
      raise exception 'CONFLICT: The department has no active Department Head yet.' using errcode = 'P0001';
    end if;
  else
    select * into r from public.profiles where id = p_to and status = 'ACTIVE';
    if r.id is null then
      raise exception 'VALIDATION_ERROR: Choose an active colleague.' using errcode = 'P0001';
    end if;
    if q.kind in ('CUSTOMER_MEMBER', 'CUSTOMER_LEAD', 'CUSTOMER_VERIFIER') then
      select * into c from public.customers where id = q.entity_id;
      if c.id is null or c.department_id is distinct from r.department_id and not (q.kind = 'CUSTOMER_VERIFIER' and private.is_verifier_for(r.id, c.id)) then
        raise exception 'VALIDATION_ERROR: Choose a colleague of the customer''s department.' using errcode = 'P0001';
      end if;
      -- a client is looked after by the Support team: a Sales colleague of the same department is not eligible
      if q.kind in ('CUSTOMER_MEMBER', 'CUSTOMER_LEAD') and not exists (select 1 from public.teams tm where tm.id = r.team_id and tm.division = 'SUPPORT') then
        raise exception 'VALIDATION_ERROR: Choose a colleague of the Support team.' using errcode = 'P0001';
      end if;
      if q.kind = 'CUSTOMER_MEMBER' then
        if r.role <> 'TEAM_MEMBER' then raise exception 'VALIDATION_ERROR: Choose a Team Member.' using errcode = 'P0001'; end if;
        update public.customer_onboarding set team_member_id = r.id, assigned_to_member_at = now(), assigned_to_member_by = (select private.my_id()) where customer_id = c.id;
      elsif q.kind = 'CUSTOMER_LEAD' then
        if r.role <> 'TEAM_HEAD' then raise exception 'VALIDATION_ERROR: Choose a Team Lead.' using errcode = 'P0001'; end if;
        update public.customer_onboarding set team_lead_id = r.id where customer_id = c.id;
      else
        if not private.is_verifier_for(r.id, c.id) then raise exception 'VALIDATION_ERROR: Choose a verifier who covers this customer''s department.' using errcode = 'P0001'; end if;
        update public.customer_onboarding set meta_verifier_id = r.id, meta_verifier_assigned_at = now(), meta_verifier_assigned_by = (select private.my_id()) where customer_id = c.id;
      end if;
      perform private.notify(r.id, 'REASSIGNED_TO_YOU', format('Client reassigned to you: %s', coalesce(c.company, c.name)), 'A manager assigned this client to you.', 'customer', c.id);
    elsif q.kind = 'MEMBER_LEAD' then
      perform public.assign_direct_lead(q.entity_id, r.id);
    else
      update public.work_tasks set assignee_id = r.id, updated_at = now() where id = q.entity_id;
      perform private.notify(r.id, 'TASK_ASSIGNED', format('Task reassigned to you: %s', q.label), 'A manager assigned this task to you.', 'work_task', q.entity_id);
    end if;
  end if;
  update public.reassignment_queue set resolved_at = now(), resolved_by = (select private.my_id()), resolved_to = p_to where id = q.id;
  perform private.write_audit('REASSIGNMENT_RESOLVED', 'profile', coalesce(q.from_profile, q.entity_id), q.department_id, q.team_id,
    jsonb_build_object('kind', q.kind, 'entity', q.entity_id, 'to', p_to));
  return jsonb_build_object('resolved', q.id, 'to', p_to);
end $$;
revoke all on function public.reassignment_resolve(uuid, uuid) from public, anon;
grant execute on function public.reassignment_resolve(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
