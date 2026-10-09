-- =============================================================================
-- Support Team Member dashboard.
--
--  1. profiles.default_dashboard — the dashboard a user opens, stored in the
--     database and kept in step with role / team / consultant flag by trigger
--     (Support team members → 'support-member', Sales → 'sales-member', …).
--  2. Customers: a human customer code (CUS-00001), the fields the Support
--     "Add Customer" form collects, create_support_customer() with duplicate
--     checks, and read access for Support staff to post-sale customers of
--     their department.
--  3. Tasks: tasks can be linked to a customer, gain a BLOCKED status, and a
--     Team Lead can assign a task straight to team members.
--  4. Tickets: support_tickets + support_ticket_updates (history), with
--     create / update / assign functions that enforce the hierarchy.
--  5. Invoices: member_invoices rows are linked to a customer; Support staff
--     can READ invoices of customers they may see, never write them.
-- Additive / idempotent. Run the whole file at once.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Helpers
-- ---------------------------------------------------------------------------
-- Active Support staff: a team member or team lead of a SUPPORT team.
create or replace function private.is_support_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
    where p.id = private.my_id() and p.status = 'ACTIVE'
      and p.role in ('TEAM_MEMBER', 'TEAM_HEAD') and t.division = 'SUPPORT')
$$;
grant execute on function private.is_support_staff() to authenticated;

-- A plain Support team member (not a lead): may not write invoices.
create or replace function private.is_support_team_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p join public.teams t on t.id = p.team_id
    where p.id = private.my_id() and p.role = 'TEAM_MEMBER' and t.division = 'SUPPORT')
$$;
grant execute on function private.is_support_team_member() to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Stored default dashboard
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists default_dashboard text;

create or replace function private.tg_profiles_default_dashboard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_division text;
  v_slug text;
begin
  select division into v_division from public.teams where id = new.team_id;
  select slug into v_slug from public.departments where id = new.department_id;
  new.default_dashboard := case new.role
    when 'SUPER_ADMIN' then 'super-admin'
    when 'DEPARTMENT_HEAD' then case when v_slug = 'hr' then 'hr-head' else 'department-head' end
    when 'TEAM_HEAD' then 'team-lead'
    else case
      when v_division = 'SUPPORT' and coalesce(new.is_technical_consultant, false) then 'technical-consultant'
      when v_division = 'SUPPORT' then 'support-member'
      when v_division = 'SALES' then 'sales-member'
      else 'team-member'
    end
  end;
  return new;
end $$;
revoke all on function private.tg_profiles_default_dashboard() from public, anon, authenticated;

drop trigger if exists profiles_default_dashboard on public.profiles;
create trigger profiles_default_dashboard before insert or update on public.profiles
  for each row execute function private.tg_profiles_default_dashboard();

-- Existing users get the right dashboard without any new account.
update public.profiles set updated_at = updated_at;

-- ---------------------------------------------------------------------------
-- 2. Customers
-- ---------------------------------------------------------------------------
create sequence if not exists public.customer_code_seq;
alter table public.customers
  add column if not exists customer_code text default ('CUS-' || lpad(nextval('public.customer_code_seq')::text, 5, '0')),
  add column if not exists service_interest text check (length(service_interest) <= 200),
  add column if not exists requirement text check (length(requirement) <= 3000),
  add column if not exists channel text check (length(channel) <= 40);
update public.customers set customer_code = 'CUS-' || lpad(nextval('public.customer_code_seq')::text, 5, '0')
 where customer_code is null;
alter table public.customers alter column customer_code set not null;
create unique index if not exists customers_customer_code_key on public.customers (customer_code);

-- May the caller see this customer? (mirrors the customers policies)
create or replace function private.can_view_customer(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.customers c
    where c.id = p_customer and (
      private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and c.team_id = private.my_team_id())
      or (private.my_role() = 'TEAM_MEMBER' and c.owner_id = private.my_id())
      or (private.is_support_staff() and c.department_id = private.my_department_id() and c.lifecycle_stage = 'CUSTOMER')))
$$;
grant execute on function private.can_view_customer(uuid) to authenticated;

-- Support staff also read the post-sale customers of their department.
drop policy if exists customers_select_support on public.customers;
create policy customers_select_support on public.customers for select to authenticated
  using ((select private.is_support_staff())
         and department_id = (select private.my_department_id())
         and lifecycle_stage = 'CUSTOMER');

-- Create a customer from the Support dashboard. The assigned member owns it
-- (team / department follow the owner), duplicates are refused.
create or replace function public.create_support_customer(
  p_name text, p_company text, p_phone text, p_email text, p_segment text, p_status text,
  p_service text, p_requirement text, p_channel text, p_notes text, p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  owner public.profiles;
  v_name text := trim(coalesce(p_name, ''));
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_phone text := nullif(trim(coalesce(p_phone, '')), '');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_dup public.customers;
  v_id uuid;
  v_code text;
  v_lead uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into owner from public.profiles where id = coalesce(p_assignee, me.id) and status = 'ACTIVE';
  if owner.id is null or owner.team_id is null then
    raise exception 'VALIDATION_ERROR: Choose an active team member to assign this customer to.' using errcode = 'P0001';
  end if;
  if not private.can_assign_customer_owner(owner.id) then
    raise exception 'FORBIDDEN: You cannot assign customers to this user.' using errcode = '42501';
  end if;

  if length(v_name) < 2 then
    raise exception 'VALIDATION_ERROR: Enter the customer''s full name.' using errcode = 'P0001';
  end if;
  if v_email is null and v_phone is null then
    raise exception 'VALIDATION_ERROR: Enter a phone number or an e-mail address.' using errcode = 'P0001';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: Enter a valid e-mail address.' using errcode = 'P0001';
  end if;
  if v_phone is not null and (v_phone !~ '^[0-9+()\-\s.]{5,25}$' or length(v_digits) < 7) then
    raise exception 'VALIDATION_ERROR: Enter a valid phone number (at least 7 digits).' using errcode = 'P0001';
  end if;
  if coalesce(p_segment, 'RETAIL') not in ('RETAIL', 'WHOLESALE', 'CORPORATE', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown customer type.' using errcode = 'P0001';
  end if;
  if coalesce(p_status, 'ACTIVE') not in ('ACTIVE', 'INACTIVE', 'PROSPECT') then
    raise exception 'VALIDATION_ERROR: Unknown customer status.' using errcode = 'P0001';
  end if;

  -- Duplicate check across the whole department (not only what the caller may see).
  select * into v_dup from public.customers c
   where c.department_id = owner.department_id
     and ((v_email is not null and c.email = v_email)
       or (length(v_digits) >= 7 and right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) = right(v_digits, 10)))
   limit 1;
  if v_dup.id is not null then
    if private.can_view_customer(v_dup.id) then
      raise exception 'CONFLICT: This customer already exists: % (%).', v_dup.name, v_dup.customer_code using errcode = 'P0001';
    end if;
    raise exception 'CONFLICT: A customer with this phone number or e-mail already exists in the CRM.' using errcode = 'P0001';
  end if;

  insert into public.customers (owner_id, name, company, phone, email, segment, status, notes,
                                service_interest, requirement, channel, lifecycle_stage)
  values (owner.id, v_name, nullif(trim(coalesce(p_company, '')), ''), v_phone, v_email,
          coalesce(p_segment, 'RETAIL')::public.customer_segment, coalesce(p_status, 'ACTIVE')::public.customer_status,
          nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_service, '')), ''),
          nullif(trim(coalesce(p_requirement, '')), ''), nullif(trim(coalesce(p_channel, '')), ''), 'CUSTOMER')
  returning id, customer_code into v_id, v_code;

  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (v_id, me.id, 'CUSTOMER_CREATED', format('Added by %s%s', me.full_name,
          case when owner.id <> me.id then format(' and assigned to %s', owner.full_name) else '' end));

  -- The team lead hears about customers their members add, and members about customers assigned to them.
  if owner.id <> me.id then
    perform private.notify(owner.id, 'CUSTOMER_ASSIGNED', format('Customer assigned: %s', v_name),
      format('%s (%s) was assigned to you by %s.', v_name, v_code, me.full_name), 'customer', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = owner.team_id and id <> me.id loop
    perform private.notify(v_lead, 'CUSTOMER_ADDED', format('New customer: %s', v_name),
      format('%s (%s) was added for %s.', v_name, v_code, owner.full_name), 'customer', v_id);
  end loop;
  return v_id;
end $$;
revoke all on function public.create_support_customer(text, text, text, text, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.create_support_customer(text, text, text, text, text, text, text, text, text, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tasks: customer link, BLOCKED status, lead → members directly
-- ---------------------------------------------------------------------------
alter table public.work_tasks add column if not exists customer_id uuid references public.customers (id) on delete set null;
create index if not exists work_tasks_customer_idx on public.work_tasks (customer_id) where customer_id is not null;

do $$
declare c record;
begin
  for c in select conname, conrelid::regclass as tbl from pg_constraint
            where conrelid in ('public.work_tasks'::regclass, 'public.work_task_updates'::regclass)
              and contype = 'c' and pg_get_constraintdef(oid) like '%ASSIGNED%' loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end $$;
alter table public.work_tasks add constraint work_tasks_status_check
  check (status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED'));
alter table public.work_task_updates add constraint work_task_updates_status_check
  check (status in ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED'));

create or replace function public.submit_task_update(p_task uuid, p_status text, p_progress integer, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.work_tasks;
  v_progress integer := case when p_status = 'COMPLETED' then 100 else greatest(0, least(100, coalesce(p_progress, 0))) end;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 2000);
begin
  select * into me from public.profiles where id = private.my_id();
  select * into t from public.work_tasks where id = p_task for update;
  if t.id is null or t.assignee_id is distinct from me.id then
    raise exception 'NOT_FOUND: Task not found.' using errcode = 'P0001';
  end if;
  if p_status not in ('IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED') then
    raise exception 'VALIDATION_ERROR: Choose In progress, Completed, Not completed or Blocked.' using errcode = 'P0001';
  end if;
  if p_status in ('NOT_COMPLETED', 'BLOCKED') and v_note is null then
    raise exception 'VALIDATION_ERROR: %', case p_status when 'BLOCKED' then 'Say what is blocking the task.'
      else 'Say why the task could not be completed.' end using errcode = 'P0001';
  end if;

  update public.work_tasks
     set status = p_status, progress = v_progress, last_update_note = v_note, last_update_at = now(),
         completed_at = case when p_status = 'COMPLETED' then now() else null end
   where id = t.id;
  insert into public.work_task_updates (task_id, author_id, status, progress, note)
  values (t.id, me.id, p_status, v_progress, v_note);

  perform private.write_audit('TASK_UPDATED', 'work_task', t.id, t.department_id, t.team_id,
    jsonb_build_object('status', p_status, 'progress', v_progress));
  -- The update goes to whoever assigned the task (team lead, or department head).
  perform private.notify(t.assigned_by, 'TASK_UPDATE',
    format('%s: %s', me.full_name, case p_status when 'COMPLETED' then 'completed' when 'NOT_COMPLETED' then 'could not complete'
                                      when 'BLOCKED' then 'is blocked' else format('%s%% done', v_progress) end),
    format('%s%s', t.title, coalesce(' — ' || v_note, '')), 'work_task', t.id,
    '{}'::jsonb, case when p_status in ('NOT_COMPLETED', 'BLOCKED') then 'urgent' else 'normal' end);
end $$;

-- Team Lead → Team Members: a task of the lead's own (no department-head task needed).
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
    if m.role <> 'TEAM_MEMBER' or m.status <> 'ACTIVE' or m.team_id is distinct from me.team_id then
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

-- ---------------------------------------------------------------------------
-- 4. Support tickets
-- ---------------------------------------------------------------------------
create sequence if not exists public.support_ticket_seq;

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no text not null unique default ('TKT-' || lpad(nextval('public.support_ticket_seq')::text, 6, '0')),
  customer_id uuid not null references public.customers (id) on delete cascade,
  department_id uuid not null references public.departments (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  subject text not null check (length(trim(subject)) between 3 and 200),
  description text check (length(description) <= 4000),
  category text not null default 'GENERAL'
    check (category in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER')),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status text not null default 'OPEN'
    check (status in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED')),
  assignee_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  resolution_notes text check (length(resolution_notes) <= 4000),
  escalated_at timestamptz,
  escalated_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists support_tickets_customer_idx on public.support_tickets (customer_id, created_at desc);
create index if not exists support_tickets_assignee_idx on public.support_tickets (assignee_id, status);
create index if not exists support_tickets_team_idx on public.support_tickets (team_id, status);
create index if not exists support_tickets_department_idx on public.support_tickets (department_id, status);
drop trigger if exists support_tickets_set_updated_at on public.support_tickets;
create trigger support_tickets_set_updated_at before update on public.support_tickets
  for each row execute function public.tg_set_updated_at();

create table if not exists public.support_ticket_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('CREATED', 'STATUS_CHANGED', 'ASSIGNED', 'ESCALATED', 'NOTE')),
  from_status text,
  to_status text,
  assignee_id uuid references public.profiles (id) on delete set null,
  note text check (length(note) <= 4000),
  created_at timestamptz not null default now()
);
create index if not exists support_ticket_updates_ticket_idx on public.support_ticket_updates (ticket_id, created_at);

create or replace function private.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.support_tickets t
    where t.id = p_ticket and (
      t.assignee_id = private.my_id() or t.created_by = private.my_id()
      or private.my_role() = 'SUPER_ADMIN'
      or (private.my_role() = 'DEPARTMENT_HEAD' and t.department_id = private.my_department_id())
      or (private.my_role() = 'TEAM_HEAD' and t.team_id = private.my_team_id())))
$$;
grant execute on function private.can_view_ticket(uuid) to authenticated;

alter table public.support_tickets enable row level security;
alter table public.support_ticket_updates enable row level security;
revoke all on public.support_tickets, public.support_ticket_updates from anon, authenticated;
grant select on public.support_tickets, public.support_ticket_updates to authenticated;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets for select to authenticated
  using (
    assignee_id = (select private.my_id()) or created_by = (select private.my_id())
    or (select private.my_role()) = 'SUPER_ADMIN'
    or ((select private.my_role()) = 'DEPARTMENT_HEAD' and department_id = (select private.my_department_id()))
    or ((select private.my_role()) = 'TEAM_HEAD' and team_id = (select private.my_team_id())));
drop policy if exists support_ticket_updates_select on public.support_ticket_updates;
create policy support_ticket_updates_select on public.support_ticket_updates for select to authenticated
  using (private.can_view_ticket(ticket_id));

-- May the caller put this person on a ticket?
create or replace function private.can_assign_ticket_to(p_assignee uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into a from public.profiles where id = p_assignee and status = 'ACTIVE';
  if me.id is null or a.id is null or a.team_id is null or a.role not in ('TEAM_MEMBER', 'TEAM_HEAD') then
    return false;
  end if;
  return case me.role
    when 'SUPER_ADMIN' then true
    when 'DEPARTMENT_HEAD' then a.department_id = me.department_id
    when 'TEAM_HEAD' then a.team_id = me.team_id
    when 'TEAM_MEMBER' then a.id = me.id
    else false
  end;
end $$;
grant execute on function private.can_assign_ticket_to(uuid) to authenticated;

create or replace function public.create_support_ticket(
  p_customer uuid, p_subject text, p_description text, p_category text, p_priority text, p_assignee uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.customers;
  a public.profiles;
  v_assignee uuid := p_assignee;
  v_team uuid;
  v_dept uuid;
  v_id uuid;
  v_no text;
  v_lead uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  if not private.can_view_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer;
  if length(trim(coalesce(p_subject, ''))) < 3 then
    raise exception 'VALIDATION_ERROR: Enter a ticket subject (at least 3 characters).' using errcode = 'P0001';
  end if;
  if coalesce(p_category, 'GENERAL') not in ('GENERAL', 'BILLING', 'TECHNICAL', 'ONBOARDING', 'COMPLAINT', 'SERVICE_REQUEST', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Unknown category.' using errcode = 'P0001';
  end if;
  if coalesce(p_priority, 'MEDIUM') not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Unknown priority.' using errcode = 'P0001';
  end if;

  -- Members and leads who raise a ticket own it unless a lead hands it to someone.
  if v_assignee is null and me.role in ('TEAM_MEMBER', 'TEAM_HEAD') then
    v_assignee := me.id;
  end if;
  if v_assignee is not null and not private.can_assign_ticket_to(v_assignee) then
    raise exception 'FORBIDDEN: You cannot assign tickets to this user.' using errcode = '42501';
  end if;
  if v_assignee is not null then
    select * into a from public.profiles where id = v_assignee;
    v_team := a.team_id;
    v_dept := a.department_id;
  else
    v_team := me.team_id;
    v_dept := coalesce(me.department_id, c.department_id);
  end if;

  insert into public.support_tickets (customer_id, department_id, team_id, subject, description, category, priority,
                                      assignee_id, created_by)
  values (c.id, v_dept, v_team, trim(p_subject), nullif(trim(coalesce(p_description, '')), ''),
          coalesce(p_category, 'GENERAL'), coalesce(p_priority, 'MEDIUM'), v_assignee, me.id)
  returning id, ticket_no into v_id, v_no;

  insert into public.support_ticket_updates (ticket_id, author_id, kind, to_status, assignee_id, note)
  values (v_id, me.id, 'CREATED', 'OPEN', v_assignee, nullif(trim(coalesce(p_description, '')), ''));
  insert into public.customer_activities (customer_id, actor_id, type, note)
  values (c.id, me.id, 'TICKET_OPENED', format('%s · %s', v_no, trim(p_subject)));
  perform private.write_audit('TICKET_CREATED', 'support_ticket', v_id, v_dept, v_team,
    jsonb_build_object('ticket_no', v_no, 'customer_id', c.id, 'assignee', v_assignee));

  if v_assignee is not null and v_assignee <> me.id then
    perform private.notify(v_assignee, 'TICKET_ASSIGNED', format('Ticket %s: %s', v_no, trim(p_subject)),
      format('%s · assigned by %s', c.name, me.full_name), 'support_ticket', v_id);
  end if;
  for v_lead in select id from public.profiles
                 where role = 'TEAM_HEAD' and status = 'ACTIVE' and team_id = v_team and id <> me.id loop
    perform private.notify(v_lead, 'TICKET_CREATED', format('New ticket %s: %s', v_no, trim(p_subject)),
      format('%s · %s priority', c.name, lower(coalesce(p_priority, 'MEDIUM'))), 'support_ticket', v_id);
  end loop;
  return v_id;
end $$;

create or replace function public.update_support_ticket(
  p_ticket uuid, p_status text, p_note text, p_resolution text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  v_manager boolean;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 4000);
  v_resolution text := left(nullif(trim(coalesce(p_resolution, '')), ''), 4000);
  v_changed boolean;
  v_kind text;
  v_recipient uuid;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or not private.can_view_ticket(t.id)
     or not (t.assignee_id = me.id or me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')) then
    raise exception 'NOT_FOUND: Ticket not found.' using errcode = 'P0001';
  end if;
  v_manager := me.role in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD');
  if p_status not in ('OPEN', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'ESCALATED', 'RESOLVED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Unknown ticket status.' using errcode = 'P0001';
  end if;
  if p_status = 'CLOSED' and not v_manager then
    raise exception 'FORBIDDEN: Only a team lead can close a ticket. Mark it Resolved instead.' using errcode = '42501';
  end if;
  v_changed := p_status is distinct from t.status;
  if not v_changed and v_note is null and v_resolution is null then
    raise exception 'VALIDATION_ERROR: Change the status or add a note.' using errcode = 'P0001';
  end if;
  if p_status in ('RESOLVED', 'CLOSED') and coalesce(v_resolution, t.resolution_notes) is null then
    raise exception 'VALIDATION_ERROR: Add resolution notes before resolving or closing the ticket.' using errcode = 'P0001';
  end if;

  update public.support_tickets
     set status = p_status,
         resolution_notes = coalesce(v_resolution, resolution_notes),
         resolved_at = case when p_status in ('RESOLVED', 'CLOSED') then coalesce(resolved_at, now()) else null end,
         escalated_at = case when p_status = 'ESCALATED' and v_changed then now() else escalated_at end,
         escalated_by = case when p_status = 'ESCALATED' and v_changed then me.id else escalated_by end
   where id = t.id;

  v_kind := case when p_status = 'ESCALATED' and v_changed then 'ESCALATED' when v_changed then 'STATUS_CHANGED' else 'NOTE' end;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, from_status, to_status, note)
  values (t.id, me.id, v_kind, t.status, p_status, coalesce(v_note, v_resolution));
  perform private.write_audit('TICKET_UPDATED', 'support_ticket', t.id, t.department_id, t.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from', t.status, 'to', p_status));

  -- Updates by the assignee go to the team lead (escalations also to the department head);
  -- updates by a lead / head go to the assignee.
  if t.assignee_id is not null and t.assignee_id <> me.id then
    perform private.notify(t.assignee_id, 'TICKET_UPDATE', format('Ticket %s is now %s', t.ticket_no, replace(lower(p_status), '_', ' ')),
      coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id);
  end if;
  if t.assignee_id is not distinct from me.id or not v_manager then
    for v_recipient in
      select id from public.profiles where status = 'ACTIVE' and id <> me.id and (
        (role = 'TEAM_HEAD' and team_id = t.team_id)
        or (p_status = 'ESCALATED' and v_changed and role = 'DEPARTMENT_HEAD' and department_id = t.department_id))
    loop
      perform private.notify(v_recipient, case when p_status = 'ESCALATED' and v_changed then 'TICKET_ESCALATED' else 'TICKET_UPDATE' end,
        case when p_status = 'ESCALATED' and v_changed then format('Escalated: %s %s', t.ticket_no, t.subject)
             else format('%s: %s', me.full_name, format('%s is now %s', t.ticket_no, replace(lower(p_status), '_', ' '))) end,
        coalesce(v_note, v_resolution, t.subject), 'support_ticket', t.id, '{}'::jsonb,
        case when p_status = 'ESCALATED' then 'urgent' else 'normal' end);
    end loop;
  end if;
end $$;

create or replace function public.assign_support_ticket(p_ticket uuid, p_assignee uuid, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.support_tickets;
  a public.profiles;
begin
  select * into me from public.profiles where id = private.my_id() and status = 'ACTIVE';
  select * into t from public.support_tickets where id = p_ticket for update;
  if me.id is null or t.id is null or me.role not in ('SUPER_ADMIN', 'DEPARTMENT_HEAD', 'TEAM_HEAD')
     or not private.can_view_ticket(t.id) then
    raise exception 'FORBIDDEN: Only a team lead or department head can assign tickets.' using errcode = '42501';
  end if;
  if not private.can_assign_ticket_to(p_assignee) then
    raise exception 'VALIDATION_ERROR: Choose an active member of your team.' using errcode = 'P0001';
  end if;
  select * into a from public.profiles where id = p_assignee;

  update public.support_tickets set assignee_id = a.id, team_id = a.team_id, department_id = a.department_id where id = t.id;
  insert into public.support_ticket_updates (ticket_id, author_id, kind, assignee_id, note)
  values (t.id, me.id, 'ASSIGNED', a.id, left(nullif(trim(coalesce(p_note, '')), ''), 4000));
  perform private.write_audit('TICKET_ASSIGNED', 'support_ticket', t.id, a.department_id, a.team_id,
    jsonb_build_object('ticket_no', t.ticket_no, 'from', t.assignee_id, 'to', a.id));
  perform private.notify(a.id, 'TICKET_ASSIGNED', format('Ticket %s: %s', t.ticket_no, t.subject),
    format('Assigned to you by %s', me.full_name), 'support_ticket', t.id);
  if t.assignee_id is not null and t.assignee_id <> a.id then
    perform private.notify(t.assignee_id, 'TICKET_REASSIGNED', format('Ticket %s was reassigned', t.ticket_no),
      format('Now handled by %s', a.full_name), 'support_ticket', t.id);
  end if;
end $$;

revoke all on function public.create_support_ticket(uuid, text, text, text, text, uuid) from public, anon;
revoke all on function public.update_support_ticket(uuid, text, text, text) from public, anon;
revoke all on function public.assign_support_ticket(uuid, uuid, text) from public, anon;
grant execute on function public.create_support_ticket(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.update_support_ticket(uuid, text, text, text) to authenticated;
grant execute on function public.assign_support_ticket(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Invoices: linked to customers, readable (never writable) by Support staff
-- ---------------------------------------------------------------------------
alter table public.member_invoices add column if not exists customer_id uuid references public.customers (id) on delete set null;
create index if not exists member_invoices_customer_idx on public.member_invoices (customer_id) where customer_id is not null;

-- Match an invoice to its customer by name among the owner's customers (only when unambiguous).
create or replace function private.tg_member_invoices_link_customer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer;
begin
  if new.customer_id is null then
    select min(c.id::text)::uuid, count(*) into v_id, v_count from public.customers c
     where c.owner_id = new.owner_id and lower(trim(c.name)) = lower(trim(new.customer_name));
    if v_count = 1 then
      new.customer_id := v_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.tg_member_invoices_link_customer() from public, anon, authenticated;
drop trigger if exists member_invoices_link_customer on public.member_invoices;
create trigger member_invoices_link_customer before insert or update of customer_name on public.member_invoices
  for each row execute function private.tg_member_invoices_link_customer();
update public.member_invoices set customer_name = customer_name where customer_id is null;

drop policy if exists member_invoices_select_support on public.member_invoices;
create policy member_invoices_select_support on public.member_invoices for select to authenticated
  using (customer_id is not null and (select private.is_support_staff()) and private.can_view_customer(customer_id));

-- Support team members get read-only access to finance records.
drop policy if exists member_invoices_support_no_insert on public.member_invoices;
create policy member_invoices_support_no_insert on public.member_invoices as restrictive for insert to authenticated
  with check (not (select private.is_support_team_member()));
drop policy if exists member_invoices_support_no_update on public.member_invoices;
create policy member_invoices_support_no_update on public.member_invoices as restrictive for update to authenticated
  using (not (select private.is_support_team_member()));
drop policy if exists member_invoices_support_no_delete on public.member_invoices;
create policy member_invoices_support_no_delete on public.member_invoices as restrictive for delete to authenticated
  using (not (select private.is_support_team_member()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.support_tickets;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.support_ticket_updates;
  exception when duplicate_object then null;
  end;
end $$;
