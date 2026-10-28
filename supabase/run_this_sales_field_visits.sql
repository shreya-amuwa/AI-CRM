-- Run this ONE file once in the Supabase SQL editor (safe to run again), AFTER the earlier run_this files (it needs the lead filters: run_this_lead_scope_filters.sql and run_this_lead_scope_sales_members.sql). It is the migration 20261203000100_sales_field_visits.sql.

-- =============================================================================
-- Field Visit for the Sales Telecaller, Business Associate and Sales Team Member: visits that belong to a LEAD, Department Head assignments,
-- scheduling, outcomes and a per-lead visit history. Additive: the existing live trip tracker (public.field_visits) is not touched.
--
--   lead_visit_assignments  a Sales Department Head hands a lead of their department to an employee for a visit, with a priority and instructions.
--                           It never changes who OWNS the lead (the Accounts workflow, lead ownership and every existing function stay as they are).
--                           The employee cannot change it; the head can cancel or reassign it.
--   lead_visits             one row per visit (repeated visits never overwrite each other): date, planned time, place, purpose, status
--                           (SCHEDULED, IN_PROGRESS, COMPLETED, FOLLOW_UP_REQUIRED, CANCELLED), outcome, follow-up date and the location taken when the
--                           visit started. gps_captured is true ONLY when the device sent coordinates at check-in; nothing is called "verified".
--
-- Who may use it: the people who may use the lead filters (private.lead_scope_allowed(): an active Telecaller, Business Associate or Sales Team
-- Member with no Sales role of a Sales team). They may schedule a visit only for a lead they own or that the head assigned to them. Nobody writes
-- the tables directly; every change is a function that checks who is asking. Departments never mix; Support is never involved.
-- Safe to run again.
-- =============================================================================

create or replace function private.ist_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function private.ist_today() from public, anon;
grant execute on function private.ist_today() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.lead_visit_assignments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.customers (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  assigned_to uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  priority text not null default 'NORMAL' check (priority in ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  instructions text check (instructions is null or length(instructions) <= 1000),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CANCELLED', 'REASSIGNED')),
  assigned_at timestamptz not null default now(),
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);
-- one live assignment per lead; a reassignment closes the earlier one first
create unique index if not exists lead_visit_assignments_one_active on public.lead_visit_assignments (lead_id) where status = 'ACTIVE';
create index if not exists lead_visit_assignments_assignee_idx on public.lead_visit_assignments (assigned_to, status, assigned_at desc);
create index if not exists lead_visit_assignments_lead_idx on public.lead_visit_assignments (lead_id, assigned_at desc);
create index if not exists lead_visit_assignments_by_idx on public.lead_visit_assignments (assigned_by);
create index if not exists lead_visit_assignments_dept_idx on public.lead_visit_assignments (department_id);

create table if not exists public.lead_visits (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.customers (id) on delete cascade,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  assignment_id uuid references public.lead_visit_assignments (id) on delete set null,
  -- who gave the visit: the Department Head of the assignment, otherwise the employee themselves
  assigned_by uuid references public.profiles (id) on delete set null,
  -- an optional link to a Work task (a visit stays a visit; the task stays a task)
  task_id uuid references public.work_tasks (id) on delete set null,
  visit_date date not null,
  planned_time time,
  address text check (address is null or length(address) <= 500),
  purpose text not null check (length(btrim(purpose)) between 1 and 300),
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CANCELLED')),
  notes text check (notes is null or length(notes) <= 2000),
  outcome text check (outcome is null or length(outcome) <= 2000),
  requirements text check (requirements is null or length(requirements) <= 2000),
  next_steps text check (next_steps is null or length(next_steps) <= 1000),
  next_follow_up date,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 500),
  started_at timestamptz,
  completed_at timestamptz,
  -- true only when the device sent coordinates when the visit started; never set by anything else
  gps_captured boolean not null default false,
  checkin_lat numeric(9, 6) check (checkin_lat is null or checkin_lat between -90 and 90),
  checkin_lng numeric(9, 6) check (checkin_lng is null or checkin_lng between -180 and 180),
  checkin_accuracy_m integer check (checkin_accuracy_m is null or checkin_accuracy_m between 0 and 1000000),
  checkin_at timestamptz,
  location_note text check (location_note is null or length(location_note) <= 200),
  -- sent by the browser with every create: a retry or a double click returns the first record instead of making a second
  client_request_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists lead_visits_request_idx on public.lead_visits (employee_id, client_request_id) where client_request_id is not null;
create index if not exists lead_visits_lead_idx on public.lead_visits (lead_id, visit_date desc, created_at desc);
create index if not exists lead_visits_employee_idx on public.lead_visits (employee_id, status, visit_date);
create index if not exists lead_visits_assignment_idx on public.lead_visits (assignment_id);
create index if not exists lead_visits_assigned_by_idx on public.lead_visits (assigned_by);
create index if not exists lead_visits_task_idx on public.lead_visits (task_id);

drop trigger if exists lead_visit_assignments_set_updated_at on public.lead_visit_assignments;
create trigger lead_visit_assignments_set_updated_at before update on public.lead_visit_assignments for each row execute function public.tg_set_updated_at();
drop trigger if exists lead_visits_set_updated_at on public.lead_visits;
create trigger lead_visits_set_updated_at before update on public.lead_visits for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security: read only, for the person it concerns and the people who manage them. No direct writes.
-- ---------------------------------------------------------------------------
alter table public.lead_visit_assignments enable row level security;
alter table public.lead_visits enable row level security;
revoke all on public.lead_visit_assignments, public.lead_visits from anon, authenticated;
grant select on public.lead_visit_assignments, public.lead_visits to authenticated;
drop policy if exists lead_visit_assignments_select on public.lead_visit_assignments;
create policy lead_visit_assignments_select on public.lead_visit_assignments for select to authenticated
  using (assigned_to = (select private.my_id()) or assigned_by = (select private.my_id()) or private.can_view_owner(assigned_to));
drop policy if exists lead_visits_select on public.lead_visits;
create policy lead_visits_select on public.lead_visits for select to authenticated
  using (employee_id = (select private.my_id()) or private.can_view_owner(employee_id));
do $$ begin
  alter publication supabase_realtime add table public.lead_visit_assignments;
exception when duplicate_object then null; when undefined_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.lead_visits;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Helpers
-- ---------------------------------------------------------------------------
create or replace function private.require_field_visit_user()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.lead_scope_allowed() then raise exception 'FORBIDDEN: Field Visit is for Telecallers, Business Associates and Sales Team Members.' using errcode = '42501'; end if;
end $$;
revoke all on function private.require_field_visit_user() from public, anon;
grant execute on function private.require_field_visit_user() to authenticated, service_role;

-- a lead I may schedule a visit for: one I own, or one a Department Head assigned to me; still a lead, in my department
create or replace function private.visit_lead_ok(p_lead uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
     where c.id = p_lead and c.lifecycle_stage = 'LEAD' and c.department_id = private.my_department_id()
       and (c.owner_id = private.my_id()
            or exists (select 1 from public.lead_visit_assignments a where a.lead_id = c.id and a.assigned_to = private.my_id() and a.status = 'ACTIVE')))
$$;
revoke all on function private.visit_lead_ok(uuid) from public, anon;
grant execute on function private.visit_lead_ok(uuid) to authenticated, service_role;

-- the leads of one filter of the Field Visit overview, for the caller
create or replace function private.field_visit_lead_ids(p_filter text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from (
    select s as id from private.lead_scope_ids(p_filter) s where p_filter in ('ALL', 'MINE', 'DEPARTMENT', 'TO_ACCOUNTS', 'RETURNED')
    union
    select c.id
      from public.customers c
     where p_filter in ('DH_ASSIGNED', 'VISIT_PENDING', 'VISIT_SCHEDULED', 'VISIT_COMPLETED', 'FOLLOW_UP')
       and private.lead_scope_allowed() and c.lifecycle_stage = 'LEAD'
       and (
         (p_filter = 'DH_ASSIGNED' and exists (select 1 from public.lead_visit_assignments a where a.lead_id = c.id and a.assigned_to = private.my_id() and a.status = 'ACTIVE'))
         -- a lead the head assigned for a visit and nothing has been scheduled, started or finished for it since
         or (p_filter = 'VISIT_PENDING' and exists (
               select 1 from public.lead_visit_assignments a
                where a.lead_id = c.id and a.assigned_to = private.my_id() and a.status = 'ACTIVE'
                  and not exists (select 1 from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status <> 'CANCELLED' and v.created_at >= a.assigned_at)))
         or (p_filter = 'VISIT_SCHEDULED' and exists (select 1 from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status in ('SCHEDULED', 'IN_PROGRESS')))
         or (p_filter = 'VISIT_COMPLETED' and exists (select 1 from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status = 'COMPLETED'))
         -- the latest finished visit of the lead says another visit or contact is needed
         or (p_filter = 'FOLLOW_UP' and (
               select v.status from public.lead_visits v
                where v.lead_id = c.id and v.employee_id = private.my_id() and v.status in ('COMPLETED', 'FOLLOW_UP_REQUIRED')
                order by v.completed_at desc nulls last, v.created_at desc limit 1) = 'FOLLOW_UP_REQUIRED')
       )
  ) x
$$;
revoke all on function private.field_visit_lead_ids(text) from public, anon;
grant execute on function private.field_visit_lead_ids(text) to authenticated, service_role;

create or replace function private.lead_visit_json(v public.lead_visits)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', v.id, 'leadId', v.lead_id, 'leadName', c.name, 'company', c.company, 'phone', c.phone,
    'visitDate', v.visit_date, 'plannedTime', to_char(v.planned_time, 'HH24:MI'), 'address', v.address, 'purpose', v.purpose,
    'status', v.status, 'notes', v.notes, 'outcome', v.outcome, 'requirements', v.requirements, 'nextSteps', v.next_steps,
    'nextFollowUp', v.next_follow_up, 'cancelReason', v.cancel_reason, 'startedAt', v.started_at, 'completedAt', v.completed_at,
    'gpsCaptured', v.gps_captured, 'checkinLat', v.checkin_lat, 'checkinLng', v.checkin_lng, 'checkinAccuracyM', v.checkin_accuracy_m,
    'checkinAt', v.checkin_at, 'locationNote', v.location_note,
    'assignedBy', (select p.full_name from public.profiles p where p.id = v.assigned_by), 'assignmentId', v.assignment_id,
    'employee', jsonb_build_object('id', e.id, 'fullName', e.full_name), 'taskId', v.task_id,
    'createdAt', v.created_at, 'updatedAt', v.updated_at)
  from public.customers c, public.profiles e
 where c.id = v.lead_id and e.id = v.employee_id
$$;
revoke all on function private.lead_visit_json(public.lead_visits) from public, anon;
grant execute on function private.lead_visit_json(public.lead_visits) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Department Head: who can be given a lead for a visit, and the assignment itself
-- ---------------------------------------------------------------------------
create or replace function public.sales_visit_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_sales_head();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'team', t.name,
      'role', case p.sales_sub_role when 'TELECALLER' then 'Telecaller' when 'BUSINESS_ASSOCIATE' then 'Business Associate' else 'Sales Team Member' end) order by p.full_name)
      from public.profiles p join public.teams t on t.id = p.team_id
     where p.department_id = private.my_department_id() and p.status = 'ACTIVE' and p.role = 'TEAM_MEMBER' and t.division = 'SALES'
       and (p.sales_sub_role is null or p.sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE'))), '[]'::jsonb);
end $$;
revoke all on function public.sales_visit_assignees() from public, anon;
grant execute on function public.sales_visit_assignees() to authenticated;

create or replace function public.sales_visit_assign(p_lead uuid, p_assignee uuid, p_priority text default 'NORMAL', p_instructions text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  a public.profiles;
  t public.teams;
  old public.lead_visit_assignments;
  n public.lead_visit_assignments;
  v_instr text := left(nullif(btrim(coalesce(p_instructions, '')), ''), 1000);
begin
  perform private.require_sales_head();
  if p_priority is null or p_priority not in ('LOW', 'NORMAL', 'HIGH', 'URGENT') then raise exception 'VALIDATION_ERROR: Choose a priority.' using errcode = 'P0001'; end if;
  if length(coalesce(p_instructions, '')) > 1000 then raise exception 'VALIDATION_ERROR: The instructions are too long (1,000 characters at most).' using errcode = 'P0001'; end if;
  select * into c from public.customers where id = p_lead for update;
  if c.id is null or c.lifecycle_stage <> 'LEAD' or c.department_id is distinct from private.my_department_id() or not private.sales_scope_team(c.team_id) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  select * into a from public.profiles where id = p_assignee;
  select * into t from public.teams where id = a.team_id;
  if a.id is null or a.status <> 'ACTIVE' or a.role <> 'TEAM_MEMBER' or a.department_id is distinct from c.department_id or t.division is distinct from 'SALES'
     or not (a.sales_sub_role is null or a.sales_sub_role in ('TELECALLER', 'BUSINESS_ASSOCIATE')) then
    raise exception 'VALIDATION_ERROR: Choose an active Telecaller, Business Associate or Sales Team Member of your department.' using errcode = 'P0001';
  end if;
  select * into old from public.lead_visit_assignments where lead_id = c.id and status = 'ACTIVE' for update;
  if old.id is not null then
    if old.assigned_to = a.id then
      -- the same person: only the priority and the instructions change
      update public.lead_visit_assignments set priority = p_priority, instructions = v_instr where id = old.id returning * into n;
      return jsonb_build_object('id', n.id, 'leadId', c.id, 'assignee', a.full_name, 'reassigned', false);
    end if;
    update public.lead_visit_assignments set status = 'REASSIGNED', closed_at = now() where id = old.id;
  end if;
  insert into public.lead_visit_assignments (lead_id, department_id, assigned_to, assigned_by, priority, instructions)
  values (c.id, c.department_id, a.id, private.my_id(), p_priority, v_instr) returning * into n;
  perform private.notify(a.id, 'FIELD_VISIT_ASSIGNED', format('Field visit lead: %s', coalesce(c.company, c.name)),
    format('Your Department Head assigned %s to you for a visit.%s', c.name, coalesce(' ' || v_instr, '')), 'customer', c.id);
  perform private.write_audit('FIELD_VISIT_LEAD_ASSIGNED', 'customer', c.id, c.department_id, c.team_id,
    jsonb_build_object('assignment', n.id, 'assignee', a.id, 'priority', p_priority, 'reassignedFrom', old.assigned_to));
  return jsonb_build_object('id', n.id, 'leadId', c.id, 'assignee', a.full_name, 'reassigned', old.id is not null);
end $$;
revoke all on function public.sales_visit_assign(uuid, uuid, text, text) from public, anon;
grant execute on function public.sales_visit_assign(uuid, uuid, text, text) to authenticated;

create or replace function public.sales_visit_assignment_cancel(p_lead uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  old public.lead_visit_assignments;
begin
  perform private.require_sales_head();
  select * into c from public.customers where id = p_lead;
  if c.id is null or c.department_id is distinct from private.my_department_id() or not private.sales_scope_team(c.team_id) then
    raise exception 'NOT_FOUND: Lead not found.' using errcode = 'P0001';
  end if;
  update public.lead_visit_assignments set status = 'CANCELLED', closed_at = now() where lead_id = c.id and status = 'ACTIVE' returning * into old;
  if old.id is null then raise exception 'NOT_FOUND: This lead has no field visit assignment.' using errcode = 'P0001'; end if;
  perform private.write_audit('FIELD_VISIT_ASSIGNMENT_CANCELLED', 'customer', c.id, c.department_id, c.team_id, jsonb_build_object('assignment', old.id));
  return jsonb_build_object('id', old.id, 'leadId', c.id);
end $$;
revoke all on function public.sales_visit_assignment_cancel(uuid) from public, anon;
grant execute on function public.sales_visit_assignment_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The employee's views
-- ---------------------------------------------------------------------------
create or replace function public.field_visit_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_field_visit_user();
  return jsonb_build_object(
    'totalAssigned', (select count(*) from private.field_visit_lead_ids('DH_ASSIGNED')),
    'myLeads', (select count(*) from private.lead_scope_ids('MINE')),
    'todayScheduled', (select count(*) from public.lead_visits v where v.employee_id = private.my_id() and v.status in ('SCHEDULED', 'IN_PROGRESS') and v.visit_date = private.ist_today()),
    'completed', (select count(*) from public.lead_visits v where v.employee_id = private.my_id() and v.status = 'COMPLETED'),
    'pending', (select count(*) from private.field_visit_lead_ids('VISIT_PENDING')),
    'followUps', (select count(*) from private.field_visit_lead_ids('FOLLOW_UP')),
    'filters', jsonb_build_object(
      'ALL', (select count(*) from private.field_visit_lead_ids('ALL')),
      'MINE', (select count(*) from private.field_visit_lead_ids('MINE')),
      'DEPARTMENT', (select count(*) from private.field_visit_lead_ids('DEPARTMENT')),
      'DH_ASSIGNED', (select count(*) from private.field_visit_lead_ids('DH_ASSIGNED')),
      'TO_ACCOUNTS', (select count(*) from private.field_visit_lead_ids('TO_ACCOUNTS')),
      'RETURNED', (select count(*) from private.field_visit_lead_ids('RETURNED')),
      'VISIT_PENDING', (select count(*) from private.field_visit_lead_ids('VISIT_PENDING')),
      'VISIT_SCHEDULED', (select count(*) from private.field_visit_lead_ids('VISIT_SCHEDULED')),
      'VISIT_COMPLETED', (select count(*) from private.field_visit_lead_ids('VISIT_COMPLETED')),
      'FOLLOW_UP', (select count(*) from private.field_visit_lead_ids('FOLLOW_UP'))));
end $$;
revoke all on function public.field_visit_overview() from public, anon;
grant execute on function public.field_visit_overview() to authenticated;

-- the table of the overview: one row per lead with its visit state
create or replace function public.field_visit_leads_list(
  p_filter text default 'ALL', p_search text default null, p_sort text default 'visitDate', p_page integer default 1, p_page_size integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 10), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
begin
  perform private.require_field_visit_user();
  if p_filter is null or p_filter not in ('ALL', 'MINE', 'DEPARTMENT', 'DH_ASSIGNED', 'TO_ACCOUNTS', 'RETURNED', 'VISIT_PENDING', 'VISIT_SCHEDULED', 'VISIT_COMPLETED', 'FOLLOW_UP') then
    raise exception 'VALIDATION_ERROR: Unknown filter.' using errcode = 'P0001';
  end if;
  if p_sort is null or p_sort not in ('visitDate', 'name', 'newest', 'followUp') then raise exception 'VALIDATION_ERROR: Unknown sort order.' using errcode = 'P0001'; end if;

  select count(*) into v_total
    from public.customers c
   where c.id in (select private.field_visit_lead_ids(p_filter))
     and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.lead_source, ''))) > 0);

  return jsonb_build_object('filter', p_filter, 'total', v_total, 'page', v_page, 'pageSize', v_size, 'items', coalesce((
    select jsonb_agg(x.j order by x.rn)
      from (
        select row_number() over (
                 order by (case p_sort when 'name' then lower(c.name) when 'visitDate' then open.visit_date::text
                                       when 'followUp' then coalesce(fin.next_follow_up, (c.next_follow_up_at at time zone 'Asia/Kolkata')::date)::text end) asc nulls last,
                          c.created_at desc, c.id) as rn,
               jsonb_build_object(
                 'leadId', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'leadSource', c.lead_source, 'leadStatus', c.lead_status,
                 'paymentWorkflow', c.payment_workflow, 'isMine', c.owner_id = private.my_id(),
                 'owner', jsonb_build_object('id', o.id, 'fullName', o.full_name),
                 'department', d.name,
                 'assignment', (select jsonb_build_object('id', a.id, 'assignedAt', a.assigned_at, 'priority', a.priority, 'instructions', a.instructions, 'assignedBy', ab.full_name)
                                  from public.lead_visit_assignments a left join public.profiles ab on ab.id = a.assigned_by
                                 where a.lead_id = c.id and a.assigned_to = private.my_id() and a.status = 'ACTIVE'),
                 'canVisit', private.visit_lead_ok(c.id),
                 'visitId', open.id, 'visitDate', open.visit_date, 'plannedTime', to_char(open.planned_time, 'HH24:MI'),
                 'visitStatus', coalesce(open.status, fin.status, 'NOT_PLANNED'),
                 'lastVisit', fin.visit_date,
                 'nextFollowUp', coalesce(fin.next_follow_up, (c.next_follow_up_at at time zone 'Asia/Kolkata')::date)) as j
          from public.customers c
          left join public.profiles o on o.id = c.owner_id
          left join public.departments d on d.id = c.department_id
          left join lateral (select v.* from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status in ('SCHEDULED', 'IN_PROGRESS')
                              order by v.visit_date, v.planned_time nulls last limit 1) open on true
          left join lateral (select v.* from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status in ('COMPLETED', 'FOLLOW_UP_REQUIRED')
                              order by v.visit_date desc, v.completed_at desc nulls last limit 1) fin on true
         where c.id in (select private.field_visit_lead_ids(p_filter))
           and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, '') || ' ' || coalesce(c.lead_source, ''))) > 0)
         order by rn
         limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb));
end $$;
revoke all on function public.field_visit_leads_list(text, text, text, integer, integer) from public, anon;
grant execute on function public.field_visit_leads_list(text, text, text, integer, integer) to authenticated;

-- Department Head assigned leads
create or replace function public.field_visit_assigned_list(p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
begin
  perform private.require_field_visit_user();
  select count(*) into v_total
    from public.lead_visit_assignments a join public.customers c on c.id = a.lead_id
   where a.assigned_to = private.my_id() and a.status = 'ACTIVE' and c.lifecycle_stage = 'LEAD'
     and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, ''))) > 0);
  return jsonb_build_object('total', v_total, 'page', v_page, 'pageSize', v_size, 'items', coalesce((
    select jsonb_agg(x.j order by x.at desc, x.id) from (
      select a.id, a.assigned_at as at,
             jsonb_build_object(
               'id', a.id, 'leadId', c.id, 'name', c.name, 'company', c.company, 'phone', c.phone, 'email', c.email, 'address', c.address, 'city', c.city,
               'leadSource', c.lead_source, 'leadStatus', c.lead_status, 'paymentWorkflow', c.payment_workflow,
               'services', coalesce((select string_agg(cs.name, ', ' order by cs.name) from public.customer_services s join public.crm_services cs on cs.code = s.service_code where s.customer_id = c.id), ''),
               'assignedAt', a.assigned_at, 'assignedBy', ab.full_name, 'priority', a.priority, 'instructions', a.instructions,
               'department', d.name, 'owner', jsonb_build_object('id', o.id, 'fullName', o.full_name), 'isMine', c.owner_id = private.my_id(),
               'canVisit', private.visit_lead_ok(c.id),
               'visits', (select count(*) from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.created_at >= a.assigned_at and v.status <> 'CANCELLED'),
               'openVisitId', (select v.id from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status in ('SCHEDULED', 'IN_PROGRESS') order by v.visit_date limit 1),
               'openVisitStatus', (select v.status from public.lead_visits v where v.lead_id = c.id and v.employee_id = private.my_id() and v.status in ('SCHEDULED', 'IN_PROGRESS') order by v.visit_date limit 1)) as j
        from public.lead_visit_assignments a
        join public.customers c on c.id = a.lead_id
        left join public.profiles ab on ab.id = a.assigned_by
        left join public.profiles o on o.id = c.owner_id
        left join public.departments d on d.id = c.department_id
       where a.assigned_to = private.my_id() and a.status = 'ACTIVE' and c.lifecycle_stage = 'LEAD'
         and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(c.phone, ''))) > 0)
       order by a.assigned_at desc, a.id limit v_size offset (v_page - 1) * v_size) x), '[]'::jsonb));
end $$;
revoke all on function public.field_visit_assigned_list(text, integer, integer) from public, anon;
grant execute on function public.field_visit_assigned_list(text, integer, integer) to authenticated;

-- my visits (p_scope MINE_OPEN: scheduled and in progress; HISTORY: finished or cancelled; ALL), optionally of one lead
create or replace function public.field_visit_list(
  p_scope text default 'OPEN', p_status text default null, p_lead uuid default null, p_search text default null, p_page integer default 1, p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_q text := lower(btrim(coalesce(p_search, '')));
  v_size integer := greatest(1, least(coalesce(p_page_size, 20), 100));
  v_page integer := greatest(1, coalesce(p_page, 1));
  v_total bigint;
begin
  perform private.require_field_visit_user();
  if p_scope is null or p_scope not in ('OPEN', 'HISTORY', 'ALL') then raise exception 'VALIDATION_ERROR: Unknown list.' using errcode = 'P0001'; end if;
  if p_status is not null and p_status not in ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'FOLLOW_UP_REQUIRED', 'CANCELLED') then raise exception 'VALIDATION_ERROR: Unknown visit status.' using errcode = 'P0001'; end if;
  select count(*) into v_total
    from public.lead_visits v join public.customers c on c.id = v.lead_id
   where (v.employee_id = private.my_id() or (p_lead is not null and c.owner_id = private.my_id()))
     and (p_lead is null or v.lead_id = p_lead)
     and (p_scope = 'ALL' or (p_scope = 'OPEN' and v.status in ('SCHEDULED', 'IN_PROGRESS')) or (p_scope = 'HISTORY' and v.status in ('COMPLETED', 'FOLLOW_UP_REQUIRED', 'CANCELLED')))
     and (p_status is null or v.status = p_status)
     and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(v.purpose, ''))) > 0);
  return jsonb_build_object('total', v_total, 'page', v_page, 'pageSize', v_size, 'items', coalesce((
    select jsonb_agg(private.lead_visit_json(v) order by case when p_scope = 'OPEN' then v.visit_date end asc, case when p_scope <> 'OPEN' then v.visit_date end desc, v.created_at desc, v.id)
      from (select v0.* from public.lead_visits v0 join public.customers c on c.id = v0.lead_id
             where (v0.employee_id = private.my_id() or (p_lead is not null and c.owner_id = private.my_id()))
               and (p_lead is null or v0.lead_id = p_lead)
               and (p_scope = 'ALL' or (p_scope = 'OPEN' and v0.status in ('SCHEDULED', 'IN_PROGRESS')) or (p_scope = 'HISTORY' and v0.status in ('COMPLETED', 'FOLLOW_UP_REQUIRED', 'CANCELLED')))
               and (p_status is null or v0.status = p_status)
               and (v_q = '' or position(v_q in lower(c.name || ' ' || coalesce(c.company, '') || ' ' || coalesce(v0.purpose, ''))) > 0)
             order by case when p_scope = 'OPEN' then v0.visit_date end asc, case when p_scope <> 'OPEN' then v0.visit_date end desc, v0.created_at desc, v0.id
             limit v_size offset (v_page - 1) * v_size) v), '[]'::jsonb));
end $$;
revoke all on function public.field_visit_list(text, text, uuid, text, integer, integer) from public, anon;
grant execute on function public.field_visit_list(text, text, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Scheduling and recording a visit
-- ---------------------------------------------------------------------------
create or replace function public.field_visit_schedule(
  p_lead uuid, p_date date, p_time time default null, p_address text default null, p_purpose text default null, p_notes text default null,
  p_request uuid default null, p_task uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  a public.lead_visit_assignments;
  v public.lead_visits;
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
begin
  perform private.require_field_visit_user();
  -- a retry or a double click with the same request id returns the visit that was already made
  if p_request is not null then
    select * into v from public.lead_visits where employee_id = private.my_id() and client_request_id = p_request;
    if v.id is not null then return private.lead_visit_json(v); end if;
  end if;
  if not private.visit_lead_ok(p_lead) then raise exception 'NOT_FOUND: Lead not found. You can schedule visits for your own leads and the leads your Department Head assigned to you.' using errcode = 'P0001'; end if;
  select * into c from public.customers where id = p_lead;
  if p_date is null then raise exception 'VALIDATION_ERROR: Choose the visit date.' using errcode = 'P0001'; end if;
  if p_date < private.ist_today() then raise exception 'VALIDATION_ERROR: The visit date cannot be in the past.' using errcode = 'P0001'; end if;
  if v_purpose is null then raise exception 'VALIDATION_ERROR: Enter the purpose of the visit.' using errcode = 'P0001'; end if;
  if length(v_purpose) > 300 then raise exception 'VALIDATION_ERROR: The purpose is too long (300 characters at most).' using errcode = 'P0001'; end if;
  if length(coalesce(p_address, '')) > 500 then raise exception 'VALIDATION_ERROR: The address is too long (500 characters at most).' using errcode = 'P0001'; end if;
  if length(coalesce(p_notes, '')) > 2000 then raise exception 'VALIDATION_ERROR: The notes are too long (2,000 characters at most).' using errcode = 'P0001'; end if;
  if p_task is not null and not exists (select 1 from public.work_tasks t where t.id = p_task and (t.assignee_id = private.my_id() or t.assigned_by = private.my_id())) then
    raise exception 'VALIDATION_ERROR: Choose one of your own tasks.' using errcode = 'P0001';
  end if;
  select * into a from public.lead_visit_assignments where lead_id = c.id and assigned_to = private.my_id() and status = 'ACTIVE';
  begin
    insert into public.lead_visits (lead_id, employee_id, assignment_id, assigned_by, task_id, visit_date, planned_time, address, purpose, notes, client_request_id)
    values (c.id, private.my_id(), a.id, coalesce(a.assigned_by, private.my_id()), p_task, p_date, p_time, nullif(btrim(coalesce(p_address, '')), ''), v_purpose,
            nullif(btrim(coalesce(p_notes, '')), ''), p_request)
    returning * into v;
  exception when unique_violation then
    select * into v from public.lead_visits where employee_id = private.my_id() and client_request_id = p_request;
  end;
  perform private.write_audit('FIELD_VISIT_SCHEDULED', 'customer', c.id, c.department_id, c.team_id, jsonb_build_object('visit', v.id, 'date', p_date, 'assignment', a.id));
  return private.lead_visit_json(v);
end $$;
revoke all on function public.field_visit_schedule(uuid, date, time, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.field_visit_schedule(uuid, date, time, text, text, text, uuid, uuid) to authenticated;

-- change the plan of a visit that has not started
create or replace function public.field_visit_update(p_id uuid, p_date date, p_time time default null, p_address text default null, p_purpose text default null, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits;
  v_purpose text := nullif(btrim(coalesce(p_purpose, '')), '');
begin
  perform private.require_field_visit_user();
  select * into v from public.lead_visits where id = p_id and employee_id = private.my_id() for update;
  if v.id is null then raise exception 'NOT_FOUND: Visit not found.' using errcode = 'P0001'; end if;
  if v.status <> 'SCHEDULED' then raise exception 'CONFLICT: Only a scheduled visit can be changed.' using errcode = 'P0001'; end if;
  if p_date is null or p_date < private.ist_today() then raise exception 'VALIDATION_ERROR: Choose today or a later date.' using errcode = 'P0001'; end if;
  if v_purpose is null then raise exception 'VALIDATION_ERROR: Enter the purpose of the visit.' using errcode = 'P0001'; end if;
  if length(v_purpose) > 300 or length(coalesce(p_address, '')) > 500 or length(coalesce(p_notes, '')) > 2000 then raise exception 'VALIDATION_ERROR: A text is too long.' using errcode = 'P0001'; end if;
  update public.lead_visits set visit_date = p_date, planned_time = p_time, address = nullif(btrim(coalesce(p_address, '')), ''), purpose = v_purpose,
         notes = nullif(btrim(coalesce(p_notes, '')), '') where id = v.id returning * into v;
  return private.lead_visit_json(v);
end $$;
revoke all on function public.field_visit_update(uuid, date, time, text, text, text) from public, anon;
grant execute on function public.field_visit_update(uuid, date, time, text, text, text) to authenticated;

-- start the visit (check-in). The device's position is optional: without it the visit still starts, and gps_captured stays false.
create or replace function public.field_visit_start(p_id uuid, p_lat numeric default null, p_lng numeric default null, p_accuracy integer default null, p_location_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits;
  v_gps boolean := p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180;
begin
  perform private.require_field_visit_user();
  select * into v from public.lead_visits where id = p_id and employee_id = private.my_id() for update;
  if v.id is null then raise exception 'NOT_FOUND: Visit not found.' using errcode = 'P0001'; end if;
  if v.status = 'IN_PROGRESS' then return private.lead_visit_json(v); end if; -- a double click
  if v.status <> 'SCHEDULED' then raise exception 'CONFLICT: Only a scheduled visit can be started.' using errcode = 'P0001'; end if;
  if (p_lat is not null or p_lng is not null) and not v_gps then raise exception 'VALIDATION_ERROR: The location is not valid.' using errcode = 'P0001'; end if;
  update public.lead_visits
     set status = 'IN_PROGRESS', started_at = now(), gps_captured = v_gps,
         checkin_lat = case when v_gps then round(p_lat, 6) end, checkin_lng = case when v_gps then round(p_lng, 6) end,
         checkin_accuracy_m = case when v_gps then greatest(0, p_accuracy) end, checkin_at = case when v_gps then now() end,
         location_note = case when v_gps then null else left(nullif(btrim(coalesce(p_location_note, '')), ''), 200) end
   where id = v.id returning * into v;
  return private.lead_visit_json(v);
end $$;
revoke all on function public.field_visit_start(uuid, numeric, numeric, integer, text) from public, anon;
grant execute on function public.field_visit_start(uuid, numeric, numeric, integer, text) to authenticated;

-- record the outcome: COMPLETED, or FOLLOW_UP_REQUIRED (then a follow-up date is needed)
create or replace function public.field_visit_complete(
  p_id uuid, p_status text, p_outcome text, p_notes text default null, p_requirements text default null, p_next_steps text default null, p_follow_up date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits;
  c public.customers;
  v_outcome text := nullif(btrim(coalesce(p_outcome, '')), '');
begin
  perform private.require_field_visit_user();
  select * into v from public.lead_visits where id = p_id and employee_id = private.my_id() for update;
  if v.id is null then raise exception 'NOT_FOUND: Visit not found.' using errcode = 'P0001'; end if;
  if v.status in ('COMPLETED', 'FOLLOW_UP_REQUIRED') then return private.lead_visit_json(v); end if; -- a double click
  if v.status not in ('SCHEDULED', 'IN_PROGRESS') then raise exception 'CONFLICT: This visit is already closed.' using errcode = 'P0001'; end if;
  if p_status is null or p_status not in ('COMPLETED', 'FOLLOW_UP_REQUIRED') then raise exception 'VALIDATION_ERROR: Choose Completed or Follow-up Required.' using errcode = 'P0001'; end if;
  if v_outcome is null then raise exception 'VALIDATION_ERROR: Enter the outcome of the visit.' using errcode = 'P0001'; end if;
  if p_status = 'FOLLOW_UP_REQUIRED' and p_follow_up is null then raise exception 'VALIDATION_ERROR: Enter the next follow-up date.' using errcode = 'P0001'; end if;
  if p_follow_up is not null and p_follow_up < private.ist_today() then raise exception 'VALIDATION_ERROR: The follow-up date cannot be in the past.' using errcode = 'P0001'; end if;
  if length(v_outcome) > 2000 or length(coalesce(p_notes, '')) > 2000 or length(coalesce(p_requirements, '')) > 2000 or length(coalesce(p_next_steps, '')) > 1000 then
    raise exception 'VALIDATION_ERROR: A text is too long.' using errcode = 'P0001';
  end if;
  update public.lead_visits
     set status = p_status, completed_at = now(), outcome = v_outcome, notes = coalesce(nullif(btrim(coalesce(p_notes, '')), ''), notes),
         requirements = nullif(btrim(coalesce(p_requirements, '')), ''), next_steps = nullif(btrim(coalesce(p_next_steps, '')), ''), next_follow_up = p_follow_up
   where id = v.id returning * into v;
  -- the lead's own next follow-up follows the visit (only for a lead the employee owns: an assigned lead keeps its owner's plan)
  select * into c from public.customers where id = v.lead_id;
  if p_follow_up is not null and c.owner_id = private.my_id() and c.lifecycle_stage = 'LEAD' then
    update public.customers set next_follow_up_at = (p_follow_up::timestamp at time zone 'Asia/Kolkata') where id = c.id;
  end if;
  perform private.write_audit('FIELD_VISIT_' || p_status, 'customer', c.id, c.department_id, c.team_id, jsonb_build_object('visit', v.id, 'followUp', p_follow_up, 'gps', v.gps_captured));
  return private.lead_visit_json(v);
end $$;
revoke all on function public.field_visit_complete(uuid, text, text, text, text, text, date) from public, anon;
grant execute on function public.field_visit_complete(uuid, text, text, text, text, text, date) to authenticated;

create or replace function public.field_visit_cancel(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v public.lead_visits;
begin
  perform private.require_field_visit_user();
  select * into v from public.lead_visits where id = p_id and employee_id = private.my_id() for update;
  if v.id is null then raise exception 'NOT_FOUND: Visit not found.' using errcode = 'P0001'; end if;
  if v.status = 'CANCELLED' then return private.lead_visit_json(v); end if;
  if v.status not in ('SCHEDULED', 'IN_PROGRESS') then raise exception 'CONFLICT: A finished visit cannot be cancelled.' using errcode = 'P0001'; end if;
  if length(coalesce(p_reason, '')) > 500 then raise exception 'VALIDATION_ERROR: The reason is too long (500 characters at most).' using errcode = 'P0001'; end if;
  update public.lead_visits set status = 'CANCELLED', completed_at = now(), cancel_reason = nullif(btrim(coalesce(p_reason, '')), '') where id = v.id returning * into v;
  return private.lead_visit_json(v);
end $$;
revoke all on function public.field_visit_cancel(uuid, text) from public, anon;
grant execute on function public.field_visit_cancel(uuid, text) to authenticated;
