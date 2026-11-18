-- =============================================================================
-- AI Design Studio: a separate, client-oriented department.
--
--   Department Head -> Team Lead -> Team Member (the existing hierarchy; nothing here changes it).
--
-- * The department (slug 'ai-design-studio') is a normal row of public.departments, so it appears in the Department
--   drop-down of Add Team Member and employees are created with the existing process. It has one General team, so a
--   Team Member can be created before any Team Lead exists (profiles.manager_id stays null: the member is "unassigned"
--   and works directly with the Department Head until a Team Lead is named with assign_member_to_team_lead).
--   It is a different department from "AI Studio": nothing of AI Studio is touched.
-- * New tables: ads_clients, ads_client_notices, ads_assignments, ads_reports, ads_issues and one append-only history
--   table, ads_events. They are not shared with Sales / Support customers, tickets or work_tasks.
-- * RLS is on and no table is granted to the app roles: every read and write is a security definer function that works
--   out the caller from auth.uid() (private.ads_actor) and checks the hierarchy. The browser sends no role or team.
-- * Who is whose Team Lead is decided by the existing resolver private.direct_lead_of / private.led_by.
-- Additive and safe to run twice. Nothing is deleted or changed in existing data.
-- =============================================================================

-- 1. The department and its team ----------------------------------------------------------------------------------
insert into public.departments (slug, name, description, icon_name, accent_color, generates_revenue)
select 'ai-design-studio', 'AI Design Studio', 'Client-oriented AI design services: client work, assignments, daily reports and issues.', 'Palette', '#7C3AED', false
 where not exists (select 1 from public.departments where slug = 'ai-design-studio' or lower(name) = 'ai design studio');

insert into public.teams (department_id, name, division)
select d.id, 'General', 'GENERAL'::public.team_division
  from public.departments d
 where d.slug = 'ai-design-studio'
   and not exists (select 1 from public.teams t where t.department_id = d.id);

-- 2. Tables --------------------------------------------------------------------------------------------------------
create table if not exists public.ads_clients (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  client_name text not null check (length(trim(client_name)) between 1 and 150),
  company_name text check (length(company_name) <= 150),
  contact_person text check (length(contact_person) <= 150),
  contact_number text check (length(contact_number) <= 30),
  email text check (length(email) <= 200),
  business_address text check (length(business_address) <= 500),
  requirements text check (length(requirements) <= 4000),
  design_service text check (length(design_service) <= 200),
  work_description text check (length(work_description) <= 4000),
  remarks text check (length(remarks) <= 2000),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_by uuid not null references public.profiles (id) on delete restrict,
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- the same client is not saved twice by mistake (a double click, a retry, a colleague adding the same one)
create unique index if not exists ads_clients_no_duplicate on public.ads_clients
  (department_id, lower(trim(client_name)), lower(trim(coalesce(company_name, ''))), lower(trim(coalesce(email, ''))));
create index if not exists ads_clients_created_idx on public.ads_clients (department_id, created_at desc);

create table if not exists public.ads_client_notices (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  client_id uuid not null references public.ads_clients (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  category text not null check (category in ('NEW_INSTRUCTIONS', 'DESIGN_FEEDBACK', 'REQUIREMENT_CHANGE', 'REVISION_REQUEST', 'APPROVAL_UPDATE', 'DELIVERY_UPDATE', 'IMPORTANT')),
  description text not null check (length(trim(description)) between 1 and 4000),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  status text not null default 'OPEN' check (status in ('OPEN', 'ACKNOWLEDGED', 'RESOLVED')),
  assigned_to uuid references public.profiles (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_notices_client_idx on public.ads_client_notices (client_id, created_at desc);
create index if not exists ads_notices_dept_idx on public.ads_client_notices (department_id, created_at desc);

create table if not exists public.ads_assignments (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  client_id uuid not null references public.ads_clients (id) on delete restrict,
  -- a Team Lead's work given on to a Team Member points at the work the Team Lead received
  parent_id uuid references public.ads_assignments (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  description text check (length(description) <= 4000),
  instructions text check (length(instructions) <= 2000),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  due_date date,
  status text not null default 'ASSIGNED' check (status in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'REVISION_REQUIRED', 'COMPLETED')),
  progress integer not null default 0 check (progress between 0 and 100),
  attachments jsonb not null default '[]'::jsonb,
  assigned_by uuid not null references public.profiles (id) on delete restrict,
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_assignments_assignee_idx on public.ads_assignments (assignee_id, status);
create index if not exists ads_assignments_dept_idx on public.ads_assignments (department_id, created_at desc);
create index if not exists ads_assignments_client_idx on public.ads_assignments (client_id);
create index if not exists ads_assignments_parent_idx on public.ads_assignments (parent_id);
-- a Team Member gets a Team Lead's work once; a retry or a double click never makes a second copy
create unique index if not exists ads_assignments_one_per_member on public.ads_assignments (parent_id, assignee_id) where parent_id is not null;

create table if not exists public.ads_reports (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  author_id uuid not null references public.profiles (id) on delete restrict,
  report_date date not null,
  client_id uuid references public.ads_clients (id) on delete set null,
  assignment_id uuid references public.ads_assignments (id) on delete set null,
  work_completed text not null check (length(trim(work_completed)) between 1 and 4000),
  work_in_progress text check (length(work_in_progress) <= 4000),
  pending_work text check (length(pending_work) <= 4000),
  challenges text check (length(challenges) <= 4000),
  remarks text check (length(remarks) <= 2000),
  attachments jsonb not null default '[]'::jsonb,
  -- PENDING_TL = waiting for the Team Lead, PENDING_DH = waiting for the Department Head, APPROVED = final, RETURNED = sent back with remarks
  status text not null check (status in ('PENDING_TL', 'PENDING_DH', 'APPROVED', 'RETURNED')),
  return_stage text check (return_stage in ('TEAM_LEAD', 'DEPARTMENT_HEAD')),
  client_request_id text check (length(client_request_id) <= 80),
  revision integer not null default 1,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_reports_author_idx on public.ads_reports (author_id, report_date desc);
create index if not exists ads_reports_dept_idx on public.ads_reports (department_id, status, report_date desc);
create unique index if not exists ads_reports_request_key on public.ads_reports (author_id, client_request_id) where client_request_id is not null;

create sequence if not exists public.ads_issue_seq;
create table if not exists public.ads_issues (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete restrict,
  reference text not null unique,
  raised_by uuid not null references public.profiles (id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  category text not null check (category in ('CLIENT_REQUIREMENTS', 'WORK_ASSIGNMENT', 'DESIGN_BLOCKER', 'TECHNICAL', 'TEAM_COORDINATION', 'OTHER')),
  description text not null check (length(trim(description)) between 1 and 4000),
  client_id uuid references public.ads_clients (id) on delete set null,
  assignment_id uuid references public.ads_assignments (id) on delete set null,
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'OPEN' check (status in ('OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED')),
  -- who works the issue: the raiser's Team Lead, or the Department Head (raised by a Team Lead, no lead, or escalated)
  handler_level text not null default 'TEAM_LEAD' check (handler_level in ('TEAM_LEAD', 'DEPARTMENT_HEAD')),
  escalated_by uuid references public.profiles (id) on delete set null,
  escalated_at timestamptz,
  client_request_id text check (length(client_request_id) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ads_issues_raised_idx on public.ads_issues (raised_by, created_at desc);
create index if not exists ads_issues_dept_idx on public.ads_issues (department_id, status, created_at desc);
create unique index if not exists ads_issues_request_key on public.ads_issues (raised_by, client_request_id) where client_request_id is not null;

-- one append-only history for assignments, reports and issues (who did what, when, from what to what)
create table if not exists public.ads_events (
  id bigint generated always as identity primary key,
  entity_type text not null check (entity_type in ('assignment', 'report', 'issue', 'notice', 'client')),
  entity_id uuid not null,
  actor_id uuid references public.profiles (id) on delete set null,
  event text not null,
  from_value text,
  to_value text,
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists ads_events_entity_idx on public.ads_events (entity_type, entity_id, id);

create or replace function private.tg_ads_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: The history cannot be changed.' using errcode = '42501';
end $$;
drop trigger if exists ads_events_no_change on public.ads_events;
create trigger ads_events_no_change before update or delete on public.ads_events
  for each row execute function private.tg_ads_events_append_only();

drop trigger if exists ads_clients_set_updated_at on public.ads_clients;
create trigger ads_clients_set_updated_at before update on public.ads_clients for each row execute function public.tg_set_updated_at();
drop trigger if exists ads_notices_set_updated_at on public.ads_client_notices;
create trigger ads_notices_set_updated_at before update on public.ads_client_notices for each row execute function public.tg_set_updated_at();
drop trigger if exists ads_assignments_set_updated_at on public.ads_assignments;
create trigger ads_assignments_set_updated_at before update on public.ads_assignments for each row execute function public.tg_set_updated_at();
drop trigger if exists ads_reports_set_updated_at on public.ads_reports;
create trigger ads_reports_set_updated_at before update on public.ads_reports for each row execute function public.tg_set_updated_at();
drop trigger if exists ads_issues_set_updated_at on public.ads_issues;
create trigger ads_issues_set_updated_at before update on public.ads_issues for each row execute function public.tg_set_updated_at();

-- RLS on, nothing granted: only the functions below touch these tables
alter table public.ads_clients enable row level security;
alter table public.ads_client_notices enable row level security;
alter table public.ads_assignments enable row level security;
alter table public.ads_reports enable row level security;
alter table public.ads_issues enable row level security;
alter table public.ads_events enable row level security;
revoke all on public.ads_clients, public.ads_client_notices, public.ads_assignments, public.ads_reports, public.ads_issues, public.ads_events from public, anon, authenticated;
revoke all on sequence public.ads_issue_seq from public, anon, authenticated;

-- 3. Helpers (private: only reachable from the security definer functions below) ----------------------------------
create or replace function private.ads_dept_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.departments where slug = 'ai-design-studio'
$$;

-- The caller as an ACTIVE Department Head, Team Lead or Team Member OF AI DESIGN STUDIO. Everybody else is refused
-- (the Super Admin and every other department included): this department has no Super Admin workspace.
create or replace function private.ads_actor()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.department_id is distinct from private.ads_dept_id() or me.role not in ('DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'FORBIDDEN: This page is for AI Design Studio employees.' using errcode = '42501';
  end if;
  return me;
end $$;

create or replace function private.ads_text(p jsonb, p_key text, p_max integer, p_required boolean, p_label text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := nullif(trim(coalesce(p ->> p_key, '')), '');
begin
  if v is null and p_required then
    raise exception 'VALIDATION_ERROR: Enter the %.', p_label using errcode = 'P0001';
  end if;
  if v is not null and length(v) > p_max then
    raise exception 'VALIDATION_ERROR: The % is too long (at most % characters).', p_label, p_max using errcode = 'P0001';
  end if;
  return v;
end $$;

create or replace function private.ads_enum(p_value text, p_allowed text[], p_default text, p_label text)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := upper(nullif(trim(coalesce(p_value, '')), ''));
begin
  if v is null then return p_default; end if;
  if not (v = any (p_allowed)) then
    raise exception 'VALIDATION_ERROR: Choose a valid %.', p_label using errcode = 'P0001';
  end if;
  return v;
end $$;

-- up to 5 attachment links, http(s) only (the same rule as the work report attachments)
create or replace function private.ads_links(p jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare x jsonb; v_out jsonb := '[]'::jsonb; n integer := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  for x in select * from jsonb_array_elements(p) loop
    n := n + 1;
    if n > 5 then raise exception 'VALIDATION_ERROR: Add up to 5 attachment links.' using errcode = 'P0001'; end if;
    if jsonb_typeof(x) <> 'object' or coalesce(x ->> 'url', '') !~* '^https?://[^[:space:]]+$' or length(x ->> 'url') > 500 then
      raise exception 'VALIDATION_ERROR: An attachment link must start with http:// or https://.' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('name', left(coalesce(nullif(trim(x ->> 'name'), ''), x ->> 'url'), 120), 'url', x ->> 'url'));
  end loop;
  return v_out;
end $$;

create or replace function private.ads_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- Does a row that belongs to a person (an assignment: its assignee and assigner) belong to the caller's scope?
create or replace function private.ads_sees_row(p_me uuid, p_role public.app_role, p_person uuid, p_other uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select case p_role
    when 'DEPARTMENT_HEAD' then true
    when 'TEAM_HEAD' then p_person = p_me or p_other = p_me or (p_person is not null and private.led_by(p_me, p_person))
    else p_person = p_me
  end
$$;

create or replace function private.ads_sees_client(p_me uuid, p_role public.app_role, p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ads_clients c
     where c.id = p_client and c.department_id = private.ads_dept_id() and (
       p_role = 'DEPARTMENT_HEAD'
       or c.created_by = p_me
       or (p_role = 'TEAM_HEAD' and private.led_by(p_me, c.created_by))
       or exists (select 1 from public.ads_assignments a
                   where a.client_id = c.id and private.ads_sees_row(p_me, p_role, a.assignee_id, a.assigned_by))))
$$;

create or replace function private.ads_log(p_type text, p_id uuid, p_event text, p_from text default null, p_to text default null, p_note text default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.ads_events (entity_type, entity_id, actor_id, event, from_value, to_value, note)
  values (p_type, p_id, auth.uid(), p_event, p_from, p_to, left(p_note, 2000))
$$;

create or replace function private.ads_notify(p_to uuid, p_type text, p_title text, p_body text, p_entity text, p_id uuid, p_dedupe text)
returns void language sql security definer set search_path = '' as $$
  select private.notify_once(p_to, p_type, p_title, p_body, p_entity, p_id, p_dedupe, jsonb_build_object('module', 'ai-design-studio'))
$$;

create or replace function private.ads_head_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles where department_id = private.ads_dept_id() and role = 'DEPARTMENT_HEAD' and status = 'ACTIVE'
$$;

create or replace function private.ads_name(p uuid)
returns text language sql stable security definer set search_path = '' as $$
  select full_name from public.profiles where id = p
$$;

-- JSON builders (camelCase, what the screens read)
create or replace function private.ads_client_json(c public.ads_clients)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'clientName', c.client_name, 'companyName', c.company_name, 'contactPerson', c.contact_person,
    'contactNumber', c.contact_number, 'email', c.email, 'businessAddress', c.business_address, 'requirements', c.requirements,
    'designService', c.design_service, 'workDescription', c.work_description, 'remarks', c.remarks, 'attachments', c.attachments,
    'status', c.status, 'createdBy', c.created_by, 'createdByName', private.ads_name(c.created_by), 'createdAt', c.created_at, 'updatedAt', c.updated_at)
$$;

create or replace function private.ads_notice_json(n public.ads_client_notices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', n.id, 'clientId', n.client_id, 'clientName', (select client_name from public.ads_clients where id = n.client_id),
    'title', n.title, 'category', n.category, 'description', n.description, 'priority', n.priority, 'status', n.status,
    'assignedTo', n.assigned_to, 'assignedToName', private.ads_name(n.assigned_to),
    'createdBy', n.created_by, 'createdByName', private.ads_name(n.created_by), 'createdAt', n.created_at)
$$;

create or replace function private.ads_assignment_json(a public.ads_assignments)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', a.id, 'clientId', a.client_id, 'clientName', (select client_name from public.ads_clients where id = a.client_id),
    'parentId', a.parent_id, 'title', a.title, 'description', a.description, 'instructions', a.instructions, 'priority', a.priority,
    'dueDate', a.due_date, 'status', a.status, 'progress', a.progress, 'attachments', a.attachments,
    'assignedBy', a.assigned_by, 'assignedByName', private.ads_name(a.assigned_by),
    'assigneeId', a.assignee_id, 'assigneeName', private.ads_name(a.assignee_id),
    'assigneeRole', (select role from public.profiles where id = a.assignee_id),
    'createdAt', a.created_at, 'updatedAt', a.updated_at, 'completedAt', a.completed_at,
    'overdue', (a.due_date is not null and a.due_date < private.ads_today() and a.status <> 'COMPLETED'),
    'memberCount', (select count(*) from public.ads_assignments ch where ch.parent_id = a.id),
    'memberCompleted', (select count(*) from public.ads_assignments ch where ch.parent_id = a.id and ch.status = 'COMPLETED'))
$$;

create or replace function private.ads_events_json(p_type text, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'event', e.event, 'fromValue', e.from_value, 'toValue', e.to_value, 'note', e.note,
    'actorId', e.actor_id, 'actorName', private.ads_name(e.actor_id), 'createdAt', e.created_at) order by e.id), '[]'::jsonb)
  from public.ads_events e where e.entity_type = p_type and e.entity_id = p_id
$$;

create or replace function private.ads_report_json(r public.ads_reports, p_me uuid, p_role public.app_role)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'authorId', r.author_id, 'authorName', private.ads_name(r.author_id),
    'authorRole', (select role from public.profiles where id = r.author_id),
    'leadId', private.direct_lead_of(r.author_id), 'leadName', private.ads_name(private.direct_lead_of(r.author_id)),
    'reportDate', r.report_date, 'clientId', r.client_id, 'clientName', (select client_name from public.ads_clients where id = r.client_id),
    'assignmentId', r.assignment_id, 'assignmentTitle', (select title from public.ads_assignments where id = r.assignment_id),
    'workCompleted', r.work_completed, 'workInProgress', r.work_in_progress, 'pendingWork', r.pending_work,
    'challenges', r.challenges, 'remarks', r.remarks, 'attachments', r.attachments,
    'status', r.status, 'returnStage', r.return_stage, 'revision', r.revision, 'submittedAt', r.submitted_at, 'updatedAt', r.updated_at,
    'canReview', (
      (r.status = 'PENDING_TL' and p_role = 'TEAM_HEAD' and private.direct_lead_of(r.author_id) is not distinct from p_me)
      or (p_role = 'DEPARTMENT_HEAD' and (r.status = 'PENDING_DH' or (r.status = 'PENDING_TL' and private.direct_lead_of(r.author_id) is null)))))
$$;

create or replace function private.ads_issue_json(i public.ads_issues)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', i.id, 'reference', i.reference, 'title', i.title, 'category', i.category, 'description', i.description,
    'clientId', i.client_id, 'clientName', (select client_name from public.ads_clients where id = i.client_id),
    'assignmentId', i.assignment_id, 'assignmentTitle', (select title from public.ads_assignments where id = i.assignment_id),
    'priority', i.priority, 'attachments', i.attachments, 'status', i.status, 'handlerLevel', i.handler_level,
    'raisedBy', i.raised_by, 'raisedByName', private.ads_name(i.raised_by),
    'leadName', private.ads_name(private.direct_lead_of(i.raised_by)),
    'escalatedAt', i.escalated_at, 'createdAt', i.created_at, 'updatedAt', i.updated_at)
$$;

revoke all on function private.ads_dept_id(), private.ads_actor(), private.ads_text(jsonb, text, integer, boolean, text),
  private.ads_enum(text, text[], text, text), private.ads_links(jsonb), private.ads_today(),
  private.ads_sees_row(uuid, public.app_role, uuid, uuid), private.ads_sees_client(uuid, public.app_role, uuid),
  private.ads_log(text, uuid, text, text, text, text), private.ads_notify(uuid, text, text, text, text, uuid, text),
  private.ads_head_ids(), private.ads_name(uuid), private.ads_client_json(public.ads_clients),
  private.ads_notice_json(public.ads_client_notices), private.ads_assignment_json(public.ads_assignments),
  private.ads_events_json(text, uuid), private.ads_report_json(public.ads_reports, uuid, public.app_role),
  private.ads_issue_json(public.ads_issues) from public, anon, authenticated;

-- 4. Context and people -------------------------------------------------------------------------------------------
create or replace function public.ads_context()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_lead uuid;
begin
  me := private.ads_actor();
  if me.role = 'TEAM_MEMBER' then v_lead := private.direct_lead_of(me.id); end if;
  return jsonb_build_object('userId', me.id, 'name', me.full_name, 'role', me.role, 'departmentId', me.department_id, 'teamId', me.team_id,
    'leadId', v_lead, 'leadName', private.ads_name(v_lead), 'unassigned', (me.role = 'TEAM_MEMBER' and v_lead is null));
end $$;

-- The people the caller may give work to or filter by: the Department Head sees every Team Lead and Team Member (with each
-- member's Team Lead, or none); a Team Lead sees their own Team Members; a Team Member sees nobody.
create or replace function public.ads_people()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.ads_actor();
  if me.role = 'TEAM_MEMBER' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'leadId', l.lead, 'leadName', private.ads_name(l.lead), 'hasLead', l.lead is not null)
                     order by (p.role = 'TEAM_MEMBER'), p.full_name)
      from public.profiles p
      cross join lateral (select case when p.role = 'TEAM_MEMBER' then private.direct_lead_of(p.id) end as lead) l
     where p.department_id = me.department_id and p.status = 'ACTIVE' and p.role in ('TEAM_HEAD', 'TEAM_MEMBER')
       and (me.role = 'DEPARTMENT_HEAD' or (p.role = 'TEAM_MEMBER' and l.lead = me.id))), '[]'::jsonb);
end $$;

-- 5. Clients ------------------------------------------------------------------------------------------------------
create or replace function private.ads_client_fields(p jsonb, c public.ads_clients)
returns public.ads_clients language plpgsql immutable set search_path = '' as $$
declare r public.ads_clients := c;
begin
  if p ? 'clientName' then r.client_name := private.ads_text(p, 'clientName', 150, true, 'client name'); end if;
  if p ? 'companyName' then r.company_name := private.ads_text(p, 'companyName', 150, false, 'company name'); end if;
  if p ? 'contactPerson' then r.contact_person := private.ads_text(p, 'contactPerson', 150, false, 'contact person'); end if;
  if p ? 'contactNumber' then
    r.contact_number := private.ads_text(p, 'contactNumber', 30, false, 'contact number');
    if r.contact_number is not null and r.contact_number !~ '^[0-9+()\-[:space:]]{7,30}$' then
      raise exception 'VALIDATION_ERROR: Enter a valid contact number.' using errcode = 'P0001';
    end if;
  end if;
  if p ? 'email' then
    r.email := lower(private.ads_text(p, 'email', 200, false, 'email address'));
    if r.email is not null and r.email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      raise exception 'VALIDATION_ERROR: Enter a valid email address.' using errcode = 'P0001';
    end if;
  end if;
  if p ? 'businessAddress' then r.business_address := private.ads_text(p, 'businessAddress', 500, false, 'business address'); end if;
  if p ? 'requirements' then r.requirements := private.ads_text(p, 'requirements', 4000, false, 'client requirements'); end if;
  if p ? 'designService' then r.design_service := private.ads_text(p, 'designService', 200, false, 'design service'); end if;
  if p ? 'workDescription' then r.work_description := private.ads_text(p, 'workDescription', 4000, false, 'work description'); end if;
  if p ? 'remarks' then r.remarks := private.ads_text(p, 'remarks', 2000, false, 'remarks'); end if;
  if p ? 'attachments' then r.attachments := private.ads_links(p -> 'attachments'); end if;
  if p ? 'status' then r.status := private.ads_enum(p ->> 'status', array['ACTIVE', 'INACTIVE'], c.status, 'status'); end if;
  return r;
end $$;
revoke all on function private.ads_client_fields(jsonb, public.ads_clients) from public, anon, authenticated;

create or replace function public.ads_client_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.ads_clients;
begin
  me := private.ads_actor();
  r.id := gen_random_uuid();
  r.department_id := me.department_id;
  r.attachments := '[]'::jsonb;
  r.status := 'ACTIVE';
  r.created_by := me.id;
  r := private.ads_client_fields(coalesce(p, '{}'::jsonb), r);
  if r.client_name is null then raise exception 'VALIDATION_ERROR: Enter the client name.' using errcode = 'P0001'; end if;
  begin
    insert into public.ads_clients (id, department_id, client_name, company_name, contact_person, contact_number, email, business_address,
      requirements, design_service, work_description, remarks, attachments, status, created_by)
    values (r.id, r.department_id, r.client_name, r.company_name, r.contact_person, r.contact_number, r.email, r.business_address,
      r.requirements, r.design_service, r.work_description, r.remarks, r.attachments, r.status, me.id);
  exception when unique_violation then
    raise exception 'CONFLICT: This client is already saved (same client name, company and email).' using errcode = 'P0001';
  end;
  perform private.ads_log('client', r.id, 'CREATED');
  perform private.write_audit('ADS_CLIENT_CREATED', 'ads_client', r.id, me.department_id, me.team_id, jsonb_build_object('name', r.client_name));
  -- the Department Head hears about a new client (and the creator's Team Lead, when a member added it)
  perform private.ads_notify(h, 'ADS_CLIENT_CREATED', format('New client: %s', r.client_name), format('Added by %s', me.full_name), 'ads_client', r.id, 'ads:client:' || r.id || ':' || h)
    from private.ads_head_ids() h;
  if me.role = 'TEAM_MEMBER' then
    perform private.ads_notify(private.direct_lead_of(me.id), 'ADS_CLIENT_CREATED', format('New client: %s', r.client_name), format('Added by %s', me.full_name), 'ads_client', r.id, 'ads:client:' || r.id || ':lead');
  end if;
  return private.ads_client_json((select c from public.ads_clients c where c.id = r.id));
end $$;

create or replace function public.ads_client_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  c public.ads_clients;
  r public.ads_clients;
begin
  me := private.ads_actor();
  select * into c from public.ads_clients where id = p_id and department_id = me.department_id for update;
  if c.id is null or not private.ads_sees_client(me.id, me.role, c.id) then
    raise exception 'NOT_FOUND: Client not found.' using errcode = 'P0001';
  end if;
  -- the creator, the creator's Team Lead and the Department Head update a client; a member who only works on it does not
  if not (me.role = 'DEPARTMENT_HEAD' or c.created_by = me.id or (me.role = 'TEAM_HEAD' and private.led_by(me.id, c.created_by))) then
    raise exception 'FORBIDDEN: You can view this client but not change it.' using errcode = '42501';
  end if;
  r := private.ads_client_fields(coalesce(p, '{}'::jsonb), c);
  begin
    update public.ads_clients set client_name = r.client_name, company_name = r.company_name, contact_person = r.contact_person,
      contact_number = r.contact_number, email = r.email, business_address = r.business_address, requirements = r.requirements,
      design_service = r.design_service, work_description = r.work_description, remarks = r.remarks, attachments = r.attachments,
      status = r.status, updated_by = me.id
     where id = c.id;
  exception when unique_violation then
    raise exception 'CONFLICT: Another client already has the same client name, company and email.' using errcode = 'P0001';
  end;
  perform private.ads_log('client', c.id, 'UPDATED');
  perform private.write_audit('ADS_CLIENT_UPDATED', 'ads_client', c.id, me.department_id, me.team_id, jsonb_build_object('name', r.client_name));
  return private.ads_client_json((select x from public.ads_clients x where x.id = c.id));
end $$;

create or replace function public.ads_clients_list(p_search text default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_q text := nullif(trim(coalesce(p_search, '')), '');
begin
  me := private.ads_actor();
  return coalesce((
    select jsonb_agg(private.ads_client_json(c) order by c.created_at desc)
      from (select * from public.ads_clients c
             where c.department_id = me.department_id
               and (p_status is null or c.status = upper(p_status))
               and (v_q is null or c.client_name ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%' or coalesce(c.company_name, '') ilike '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
               and private.ads_sees_client(me.id, me.role, c.id)
             order by c.created_at desc limit 300) c), '[]'::jsonb);
end $$;

create or replace function public.ads_client_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; c public.ads_clients;
begin
  me := private.ads_actor();
  select * into c from public.ads_clients where id = p_id and department_id = me.department_id;
  if c.id is null or not private.ads_sees_client(me.id, me.role, c.id) then
    raise exception 'NOT_FOUND: Client not found.' using errcode = 'P0001';
  end if;
  return private.ads_client_json(c) || jsonb_build_object('canEdit', (me.role = 'DEPARTMENT_HEAD' or c.created_by = me.id or (me.role = 'TEAM_HEAD' and private.led_by(me.id, c.created_by))));
end $$;

-- 6. Client notices -----------------------------------------------------------------------------------------------
create or replace function public.ads_notice_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  v_client uuid;
  v_to uuid;
  n public.ads_client_notices;
  v_cname text;
  v_recipient uuid;
begin
  me := private.ads_actor();
  begin v_client := (p ->> 'clientId')::uuid; exception when others then v_client := null; end;
  if v_client is null or not private.ads_sees_client(me.id, me.role, v_client) then
    raise exception 'VALIDATION_ERROR: Choose one of your clients.' using errcode = 'P0001';
  end if;
  begin v_to := (p ->> 'assignedTo')::uuid; exception when others then v_to := null; end;
  if v_to is not null then
    -- the Department Head names anybody of the department; a Team Lead themselves or their own members; a member names nobody
    if me.role = 'TEAM_MEMBER' then v_to := null;
    elsif not exists (select 1 from public.profiles x where x.id = v_to and x.department_id = me.department_id and x.status = 'ACTIVE'
                       and (me.role = 'DEPARTMENT_HEAD' or private.led_by(me.id, x.id))) then
      raise exception 'VALIDATION_ERROR: Choose an active person of your team.' using errcode = 'P0001';
    end if;
  end if;
  insert into public.ads_client_notices (department_id, client_id, title, category, description, priority, assigned_to, created_by)
  values (me.department_id, v_client, private.ads_text(p, 'title', 200, true, 'notice title'),
          private.ads_enum(p ->> 'category', array['NEW_INSTRUCTIONS', 'DESIGN_FEEDBACK', 'REQUIREMENT_CHANGE', 'REVISION_REQUEST', 'APPROVAL_UPDATE', 'DELIVERY_UPDATE', 'IMPORTANT'], 'IMPORTANT', 'category'),
          private.ads_text(p, 'description', 4000, true, 'notice description'),
          private.ads_enum(p ->> 'priority', array['LOW', 'MEDIUM', 'HIGH', 'URGENT'], 'MEDIUM', 'priority'), v_to, me.id)
  returning * into n;
  select client_name into v_cname from public.ads_clients where id = v_client;
  perform private.ads_log('notice', n.id, 'CREATED');
  perform private.write_audit('ADS_NOTICE_CREATED', 'ads_client_notice', n.id, me.department_id, me.team_id, jsonb_build_object('client', v_client));
  -- who hears about it: the named person, the Department Head, everyone working on the client and their Team Leads
  for v_recipient in
    select x from (
      select v_to as x
      union select h from private.ads_head_ids() h
      union select a.assignee_id from public.ads_assignments a where a.client_id = v_client and a.status <> 'COMPLETED'
      union select private.direct_lead_of(a.assignee_id) from public.ads_assignments a where a.client_id = v_client and a.status <> 'COMPLETED'
      union select a.assigned_by from public.ads_assignments a where a.client_id = v_client and a.status <> 'COMPLETED') s
     where x is not null
  loop
    perform private.ads_notify(v_recipient, 'ADS_NOTICE', format('Client notice: %s', n.title), format('%s · %s', v_cname, n.priority), 'ads_notice', n.id, 'ads:notice:' || n.id || ':' || v_recipient);
  end loop;
  return private.ads_notice_json(n);
end $$;

create or replace function public.ads_notices_list(p_client uuid default null, p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.ads_actor();
  return coalesce((
    select jsonb_agg(private.ads_notice_json(n) order by n.created_at desc)
      from (select * from public.ads_client_notices n
             where n.department_id = me.department_id
               and (p_client is null or n.client_id = p_client)
               and (p_status is null or n.status = upper(p_status))
               and (n.created_by = me.id or n.assigned_to = me.id or private.ads_sees_client(me.id, me.role, n.client_id))
             order by n.created_at desc limit 300) n), '[]'::jsonb);
end $$;

create or replace function public.ads_notice_set_status(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  n public.ads_client_notices;
  v_status text := private.ads_enum(p_status, array['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], null, 'status');
begin
  me := private.ads_actor();
  if v_status is null then raise exception 'VALIDATION_ERROR: Choose a status.' using errcode = 'P0001'; end if;
  select * into n from public.ads_client_notices where id = p_id and department_id = me.department_id for update;
  if n.id is null or not (n.created_by = me.id or n.assigned_to = me.id or private.ads_sees_client(me.id, me.role, n.client_id)) then
    raise exception 'NOT_FOUND: Notice not found.' using errcode = 'P0001';
  end if;
  if not (me.role = 'DEPARTMENT_HEAD' or n.created_by = me.id or n.assigned_to = me.id or (me.role = 'TEAM_HEAD' and private.led_by(me.id, n.created_by))) then
    raise exception 'FORBIDDEN: You cannot change this notice.' using errcode = '42501';
  end if;
  if n.status <> v_status then
    update public.ads_client_notices set status = v_status where id = n.id returning * into n;
    perform private.ads_log('notice', n.id, 'STATUS', null, v_status);
    perform private.ads_notify(n.created_by, 'ADS_NOTICE', format('Notice %s: %s', lower(v_status), n.title), format('Updated by %s', me.full_name), 'ads_notice', n.id, 'ads:notice:' || n.id || ':' || v_status);
  end if;
  return private.ads_notice_json(n);
end $$;

-- 7. Assignments --------------------------------------------------------------------------------------------------
-- Is p_person a valid receiver of work from p_giver? The Department Head gives to a Team Lead, or to a Team Member who has NO
-- Team Lead; a Team Lead gives only to their own Team Members.
create or replace function private.ads_check_receiver(p_giver public.profiles, p_person uuid)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare t public.profiles;
begin
  select * into t from public.profiles where id = p_person and department_id = p_giver.department_id and status = 'ACTIVE';
  if t.id is null or t.role not in ('TEAM_HEAD', 'TEAM_MEMBER') then
    raise exception 'VALIDATION_ERROR: Choose an active Team Lead or Team Member of AI Design Studio.' using errcode = 'P0001';
  end if;
  if p_giver.role = 'DEPARTMENT_HEAD' then
    if t.role = 'TEAM_MEMBER' and private.direct_lead_of(t.id) is not null then
      raise exception 'VALIDATION_ERROR: % works under Team Lead %. Assign the work to the Team Lead.', t.full_name, private.ads_name(private.direct_lead_of(t.id)) using errcode = 'P0001';
    end if;
  elsif p_giver.role = 'TEAM_HEAD' then
    if t.role <> 'TEAM_MEMBER' or private.direct_lead_of(t.id) is distinct from p_giver.id then
      raise exception 'VALIDATION_ERROR: You can assign work only to your own Team Members.' using errcode = 'P0001';
    end if;
  else
    raise exception 'FORBIDDEN: Team Members cannot assign work.' using errcode = '42501';
  end if;
  return t;
end $$;
revoke all on function private.ads_check_receiver(public.profiles, uuid) from public, anon, authenticated;

create or replace function public.ads_assignment_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  t public.profiles;
  parent public.ads_assignments;
  a public.ads_assignments;
  v_client uuid;
  v_due date;
  v_assignee uuid;
  v_title text;
begin
  me := private.ads_actor();
  if me.role = 'TEAM_MEMBER' then raise exception 'FORBIDDEN: Team Members cannot assign work.' using errcode = '42501'; end if;
  begin v_assignee := (p ->> 'assigneeId')::uuid; exception when others then v_assignee := null; end;
  if v_assignee is null then raise exception 'VALIDATION_ERROR: Choose who receives the work.' using errcode = 'P0001'; end if;
  t := private.ads_check_receiver(me, v_assignee);
  begin v_due := nullif(p ->> 'dueDate', '')::date; exception when others then
    raise exception 'VALIDATION_ERROR: Enter a valid deadline.' using errcode = 'P0001';
  end;
  if v_due is not null and v_due < private.ads_today() then
    raise exception 'VALIDATION_ERROR: The deadline cannot be in the past.' using errcode = 'P0001';
  end if;

  if me.role = 'TEAM_HEAD' then
    -- a Team Lead passes on work the Department Head gave them
    select * into parent from public.ads_assignments where id = nullif(p ->> 'parentId', '')::uuid and assignee_id = me.id and parent_id is null for update;
    if parent.id is null then raise exception 'VALIDATION_ERROR: Choose one of the assignments you received.' using errcode = 'P0001'; end if;
    if parent.status = 'COMPLETED' then raise exception 'VALIDATION_ERROR: This assignment is already completed.' using errcode = 'P0001'; end if;
    v_client := parent.client_id;
  else
    begin v_client := (p ->> 'clientId')::uuid; exception when others then v_client := null; end;
    if v_client is null or not exists (select 1 from public.ads_clients c where c.id = v_client and c.department_id = me.department_id) then
      raise exception 'VALIDATION_ERROR: Choose a client.' using errcode = 'P0001';
    end if;
  end if;
  v_title := coalesce(private.ads_text(p, 'title', 200, false, 'assignment title'), parent.title);
  if v_title is null then raise exception 'VALIDATION_ERROR: Enter the assignment title.' using errcode = 'P0001'; end if;

  begin
    insert into public.ads_assignments (department_id, client_id, parent_id, title, description, instructions, priority, due_date, attachments, assigned_by, assignee_id)
    values (me.department_id, v_client, parent.id, v_title,
            coalesce(private.ads_text(p, 'description', 4000, false, 'description'), parent.description),
            private.ads_text(p, 'instructions', 2000, false, 'instructions'),
            private.ads_enum(p ->> 'priority', array['LOW', 'MEDIUM', 'HIGH', 'URGENT'], coalesce(parent.priority, 'MEDIUM'), 'priority'),
            coalesce(v_due, parent.due_date), private.ads_links(p -> 'attachments'), me.id, t.id)
    returning * into a;
  exception when unique_violation then
    raise exception 'CONFLICT: % already has this assignment.', t.full_name using errcode = 'P0001';
  end;
  perform private.ads_log('assignment', a.id, 'CREATED', null, t.id::text, a.instructions);
  if parent.id is not null then
    perform private.ads_log('assignment', parent.id, 'DELEGATED', null, t.id::text, null);
    if parent.status in ('ASSIGNED', 'ACCEPTED') then
      update public.ads_assignments set status = 'IN_PROGRESS' where id = parent.id;
      perform private.ads_log('assignment', parent.id, 'STATUS', parent.status, 'IN_PROGRESS', 'Work passed on to a Team Member');
    end if;
    perform private.ads_notify(parent.assigned_by, 'ADS_ASSIGNMENT_DELEGATED', format('Work passed on: %s', a.title), format('%s gave it to %s', me.full_name, t.full_name), 'ads_assignment', parent.id, 'ads:asg:' || a.id || ':delegated');
  end if;
  perform private.write_audit('ADS_ASSIGNMENT_CREATED', 'ads_assignment', a.id, me.department_id, t.team_id, jsonb_build_object('assignee', t.id, 'client', v_client));
  perform private.ads_notify(t.id, 'ADS_ASSIGNMENT', format('New assignment: %s', a.title),
    format('Assigned by %s%s', me.full_name, case when a.due_date is null then '' else format(' · due %s', to_char(a.due_date, 'DD Mon')) end), 'ads_assignment', a.id, 'ads:asg:' || a.id || ':assigned');
  return private.ads_assignment_json(a);
end $$;

create or replace function public.ads_assignments_list(p_view text default 'all', p_status text default null, p_client uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.ads_actor();
  return coalesce((
    select jsonb_agg(private.ads_assignment_json(a) order by a.due_date nulls last, a.created_at desc)
      from (select * from public.ads_assignments a
             where a.department_id = me.department_id
               and private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by)
               and (p_view = 'all' or (p_view = 'mine' and a.assignee_id = me.id) or (p_view = 'team' and a.assignee_id <> me.id))
               and (p_status is null or a.status = upper(p_status))
               and (p_client is null or a.client_id = p_client)
             order by a.due_date nulls last, a.created_at desc limit 300) a), '[]'::jsonb);
end $$;

create or replace function public.ads_assignment_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; a public.ads_assignments;
begin
  me := private.ads_actor();
  select * into a from public.ads_assignments where id = p_id and department_id = me.department_id;
  if a.id is null or not private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) then
    raise exception 'NOT_FOUND: Assignment not found.' using errcode = 'P0001';
  end if;
  return private.ads_assignment_json(a) || jsonb_build_object(
    'events', private.ads_events_json('assignment', a.id),
    'members', coalesce((select jsonb_agg(private.ads_assignment_json(ch) order by ch.created_at) from public.ads_assignments ch
                          where ch.parent_id = a.id and private.ads_sees_row(me.id, me.role, ch.assignee_id, ch.assigned_by)), '[]'::jsonb),
    'canReview', (a.assignee_id <> me.id and (a.assigned_by = me.id or me.role = 'DEPARTMENT_HEAD')),
    'canUpdateStatus', (a.assignee_id = me.id));
end $$;

create or replace function public.ads_assignment_set_status(p_id uuid, p_status text, p_progress integer default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.ads_assignments;
  v_status text := upper(nullif(trim(coalesce(p_status, '')), ''));
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 2000);
  v_progress integer;
  v_old text;
  v_other uuid;
begin
  me := private.ads_actor();
  select * into a from public.ads_assignments where id = p_id and department_id = me.department_id for update;
  if a.id is null or not private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) then
    raise exception 'NOT_FOUND: Assignment not found.' using errcode = 'P0001';
  end if;
  if v_status is null or v_status not in ('ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_REVIEW', 'REVISION_REQUIRED', 'COMPLETED') then
    raise exception 'VALIDATION_ERROR: Choose a valid status.' using errcode = 'P0001';
  end if;
  if a.status = 'COMPLETED' then raise exception 'CONFLICT: This assignment is already completed.' using errcode = 'P0001'; end if;
  if p_progress is not null and (p_progress < 0 or p_progress > 100) then
    raise exception 'VALIDATION_ERROR: Progress is between 0 and 100.' using errcode = 'P0001';
  end if;
  v_old := a.status;

  if a.assignee_id = me.id then
    -- the receiver reports their own progress; they do not approve or return their own work
    if v_status not in ('ACCEPTED', 'IN_PROGRESS', 'PENDING_REVIEW') then
      raise exception 'FORBIDDEN: You can set Accepted, In Progress or Pending Review. Completion and revisions are decided by the person who assigned the work.' using errcode = '42501';
    end if;
    v_other := a.assigned_by;
  elsif a.assigned_by = me.id or me.role = 'DEPARTMENT_HEAD' then
    if v_status not in ('REVISION_REQUIRED', 'COMPLETED') then
      raise exception 'FORBIDDEN: As the reviewer you can mark the work Completed or send it back for a revision.' using errcode = '42501';
    end if;
    if v_status = 'REVISION_REQUIRED' and v_note is null then
      raise exception 'VALIDATION_ERROR: Say what must be revised.' using errcode = 'P0001';
    end if;
    v_other := a.assignee_id;
  else
    raise exception 'FORBIDDEN: You cannot change the status of this assignment.' using errcode = '42501';
  end if;

  v_progress := case when v_status = 'COMPLETED' then 100 when v_status = 'PENDING_REVIEW' then greatest(coalesce(p_progress, a.progress), 90) else coalesce(p_progress, a.progress) end;
  update public.ads_assignments
     set status = v_status, progress = v_progress, completed_at = case when v_status = 'COMPLETED' then now() else null end
   where id = a.id returning * into a;
  perform private.ads_log('assignment', a.id, 'STATUS', v_old, v_status, v_note);
  perform private.write_audit('ADS_ASSIGNMENT_STATUS', 'ads_assignment', a.id, a.department_id, null, jsonb_build_object('from', v_old, 'to', v_status));
  perform private.ads_notify(v_other, 'ADS_ASSIGNMENT_STATUS', format('%s: %s', initcap(replace(lower(v_status), '_', ' ')), a.title), format('Updated by %s', me.full_name), 'ads_assignment', a.id, 'ads:asg:' || a.id || ':' || v_status || ':' || extract(epoch from a.updated_at)::bigint);
  return private.ads_assignment_json(a);
end $$;

-- Deadline, priority or instructions: the person who assigned the work and the Department Head
create or replace function public.ads_assignment_update(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.ads_assignments;
  v_due date;
  v_prio text;
  v_instr text;
begin
  me := private.ads_actor();
  select * into a from public.ads_assignments where id = p_id and department_id = me.department_id for update;
  if a.id is null or not private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) then
    raise exception 'NOT_FOUND: Assignment not found.' using errcode = 'P0001';
  end if;
  if not (a.assigned_by = me.id or me.role = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the person who assigned the work, or the Department Head, can change it.' using errcode = '42501';
  end if;
  if a.status = 'COMPLETED' then raise exception 'CONFLICT: This assignment is already completed.' using errcode = 'P0001'; end if;
  v_due := a.due_date;
  if p ? 'dueDate' then
    begin v_due := nullif(p ->> 'dueDate', '')::date; exception when others then
      raise exception 'VALIDATION_ERROR: Enter a valid deadline.' using errcode = 'P0001';
    end;
    if v_due is not null and v_due < private.ads_today() and v_due is distinct from a.due_date then
      raise exception 'VALIDATION_ERROR: The deadline cannot be in the past.' using errcode = 'P0001';
    end if;
  end if;
  v_prio := case when p ? 'priority' then private.ads_enum(p ->> 'priority', array['LOW', 'MEDIUM', 'HIGH', 'URGENT'], a.priority, 'priority') else a.priority end;
  v_instr := case when p ? 'instructions' then private.ads_text(p, 'instructions', 2000, false, 'instructions') else a.instructions end;
  update public.ads_assignments set due_date = v_due, priority = v_prio, instructions = v_instr where id = a.id;
  if v_due is distinct from a.due_date then
    perform private.ads_log('assignment', a.id, 'DEADLINE', a.due_date::text, v_due::text);
    perform private.ads_notify(a.assignee_id, 'ADS_ASSIGNMENT_DEADLINE', format('Deadline changed: %s', a.title), format('New deadline: %s', coalesce(to_char(v_due, 'DD Mon YYYY'), 'none')), 'ads_assignment', a.id, 'ads:asg:' || a.id || ':due:' || coalesce(v_due::text, 'none'));
  end if;
  if v_prio is distinct from a.priority then perform private.ads_log('assignment', a.id, 'PRIORITY', a.priority, v_prio); end if;
  if v_instr is distinct from a.instructions then perform private.ads_log('assignment', a.id, 'INSTRUCTIONS', null, null, v_instr); end if;
  return private.ads_assignment_json((select x from public.ads_assignments x where x.id = a.id));
end $$;

create or replace function public.ads_assignment_reassign(p_id uuid, p_assignee uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  a public.ads_assignments;
  giver public.profiles;
  t public.profiles;
  v_old uuid;
begin
  me := private.ads_actor();
  select * into a from public.ads_assignments where id = p_id and department_id = me.department_id for update;
  if a.id is null or not private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) then
    raise exception 'NOT_FOUND: Assignment not found.' using errcode = 'P0001';
  end if;
  if not (a.assigned_by = me.id or me.role = 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only the person who assigned the work, or the Department Head, can reassign it.' using errcode = '42501';
  end if;
  if a.status = 'COMPLETED' then raise exception 'CONFLICT: This assignment is already completed.' using errcode = 'P0001'; end if;
  if exists (select 1 from public.ads_assignments ch where ch.parent_id = a.id) then
    raise exception 'CONFLICT: This work was already passed on to Team Members. Reassign their parts instead.' using errcode = 'P0001';
  end if;
  -- the receiver is judged as if the original assigner gave the work (a Department Head reassigning a Team Lead's part keeps it in that lead's team)
  select * into giver from public.profiles where id = a.assigned_by;
  t := private.ads_check_receiver(giver, p_assignee);
  if t.id = a.assignee_id then raise exception 'VALIDATION_ERROR: The work is already with this person.' using errcode = 'P0001'; end if;
  v_old := a.assignee_id;
  begin
    update public.ads_assignments set assignee_id = t.id, status = 'ASSIGNED', progress = 0, completed_at = null where id = a.id returning * into a;
  exception when unique_violation then
    raise exception 'CONFLICT: % already has this assignment.', t.full_name using errcode = 'P0001';
  end;
  perform private.ads_log('assignment', a.id, 'REASSIGNED', v_old::text, t.id::text, p_note);
  perform private.write_audit('ADS_ASSIGNMENT_REASSIGNED', 'ads_assignment', a.id, a.department_id, t.team_id, jsonb_build_object('from', v_old, 'to', t.id));
  perform private.ads_notify(t.id, 'ADS_ASSIGNMENT', format('Assignment reassigned to you: %s', a.title), format('By %s', me.full_name), 'ads_assignment', a.id, 'ads:asg:' || a.id || ':reassigned:' || t.id || ':' || extract(epoch from a.updated_at)::bigint);
  perform private.ads_notify(v_old, 'ADS_ASSIGNMENT_REASSIGNED', format('Assignment reassigned: %s', a.title), format('Now with %s', t.full_name), 'ads_assignment', a.id, 'ads:asg:' || a.id || ':removed:' || v_old || ':' || extract(epoch from a.updated_at)::bigint);
  return private.ads_assignment_json(a);
end $$;

-- 8. Daily reports: Team Member -> Team Lead -> Department Head -------------------------------------------------
create or replace function public.ads_report_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.ads_reports;
  v_id uuid;
  v_date date;
  v_client uuid;
  v_asg uuid;
  v_lead uuid;
  v_status text;
  v_req text := nullif(trim(coalesce(p ->> 'clientRequestId', '')), '');
begin
  me := private.ads_actor();
  if me.role = 'DEPARTMENT_HEAD' then raise exception 'FORBIDDEN: Daily reports are written by Team Leads and Team Members.' using errcode = '42501'; end if;
  begin v_date := (p ->> 'reportDate')::date; exception when others then v_date := null; end;
  if v_date is null then v_date := private.ads_today(); end if;
  if v_date > private.ads_today() then raise exception 'VALIDATION_ERROR: The report date cannot be in the future.' using errcode = 'P0001'; end if;
  if v_date < private.ads_today() - 60 then raise exception 'VALIDATION_ERROR: The report date cannot be more than 60 days back.' using errcode = 'P0001'; end if;
  begin v_asg := nullif(p ->> 'assignmentId', '')::uuid; exception when others then v_asg := null; end;
  begin v_client := nullif(p ->> 'clientId', '')::uuid; exception when others then v_client := null; end;
  if v_asg is not null then
    -- only your own assignment; it also names the client
    select a.client_id into v_client from public.ads_assignments a where a.id = v_asg and a.assignee_id = me.id;
    if v_client is null then raise exception 'VALIDATION_ERROR: Choose one of your own assignments.' using errcode = 'P0001'; end if;
  elsif v_client is not null and not private.ads_sees_client(me.id, me.role, v_client) then
    raise exception 'VALIDATION_ERROR: Choose one of your clients.' using errcode = 'P0001';
  end if;

  -- the Team Member's own Team Lead, else (no lead yet, or a Team Lead's own report) straight to the Department Head
  v_lead := case when me.role = 'TEAM_MEMBER' then private.direct_lead_of(me.id) end;
  v_status := case when v_lead is null then 'PENDING_DH' else 'PENDING_TL' end;

  begin v_id := nullif(p ->> 'id', '')::uuid; exception when others then v_id := null; end;
  if v_id is not null then
    -- a returned report is corrected and sent again: the old rounds stay in the history
    select * into r from public.ads_reports where id = v_id and author_id = me.id for update;
    if r.id is null then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
    if r.status <> 'RETURNED' then raise exception 'CONFLICT: Only a returned report can be edited and sent again.' using errcode = 'P0001'; end if;
    update public.ads_reports set report_date = v_date, client_id = v_client, assignment_id = v_asg,
      work_completed = private.ads_text(p, 'workCompleted', 4000, true, 'work completed today'),
      work_in_progress = private.ads_text(p, 'workInProgress', 4000, false, 'work in progress'),
      pending_work = private.ads_text(p, 'pendingWork', 4000, false, 'pending work'),
      challenges = private.ads_text(p, 'challenges', 4000, false, 'challenges'),
      remarks = private.ads_text(p, 'remarks', 2000, false, 'remarks'),
      attachments = private.ads_links(p -> 'attachments'), status = v_status, return_stage = null, revision = revision + 1, submitted_at = now()
     where id = r.id returning * into r;
    perform private.ads_log('report', r.id, 'RESUBMITTED', 'RETURNED', v_status);
  else
    if v_req is not null then
      select * into r from public.ads_reports where author_id = me.id and client_request_id = v_req;
      if r.id is not null then return private.ads_report_json(r, me.id, me.role); end if;
    end if;
    insert into public.ads_reports (department_id, author_id, report_date, client_id, assignment_id, work_completed, work_in_progress, pending_work, challenges, remarks, attachments, status, client_request_id)
    values (me.department_id, me.id, v_date, v_client, v_asg,
            private.ads_text(p, 'workCompleted', 4000, true, 'work completed today'),
            private.ads_text(p, 'workInProgress', 4000, false, 'work in progress'),
            private.ads_text(p, 'pendingWork', 4000, false, 'pending work'),
            private.ads_text(p, 'challenges', 4000, false, 'challenges'),
            private.ads_text(p, 'remarks', 2000, false, 'remarks'),
            private.ads_links(p -> 'attachments'), v_status, v_req)
    returning * into r;
    perform private.ads_log('report', r.id, 'SUBMITTED', null, v_status);
  end if;
  perform private.write_audit('ADS_REPORT_SUBMITTED', 'ads_report', r.id, me.department_id, me.team_id, jsonb_build_object('stage', v_status));
  if v_lead is not null then
    perform private.ads_notify(v_lead, 'ADS_REPORT_SUBMITTED', format('Daily report from %s', me.full_name), format('%s · waiting for your review', to_char(r.report_date, 'DD Mon YYYY')), 'ads_report', r.id, 'ads:rep:' || r.id || ':submit:' || r.revision);
  else
    perform private.ads_notify(h, 'ADS_REPORT_SUBMITTED', format('Daily report from %s', me.full_name), format('%s · waiting for your approval', to_char(r.report_date, 'DD Mon YYYY')), 'ads_report', r.id, 'ads:rep:' || r.id || ':submit:' || r.revision || ':' || h)
      from private.ads_head_ids() h;
  end if;
  return private.ads_report_json(r, me.id, me.role);
end $$;

create or replace function public.ads_reports_list(p_view text default 'mine', p_status text default null, p_from date default null, p_to date default null,
                                                    p_client uuid default null, p_author uuid default null, p_lead uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.ads_actor();
  if p_view not in ('mine', 'team', 'all') then raise exception 'VALIDATION_ERROR: Unknown view.' using errcode = 'P0001'; end if;
  if p_view = 'team' and me.role = 'TEAM_MEMBER' then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(private.ads_report_json(r, me.id, me.role) order by r.report_date desc, r.submitted_at desc)
      from (select * from public.ads_reports r
             where r.department_id = me.department_id
               and (case me.role when 'DEPARTMENT_HEAD' then true when 'TEAM_HEAD' then (r.author_id = me.id or private.led_by(me.id, r.author_id)) else r.author_id = me.id end)
               and (p_view = 'all' or (p_view = 'mine' and r.author_id = me.id) or (p_view = 'team' and r.author_id <> me.id))
               and (p_status is null or r.status = upper(p_status))
               and (p_from is null or r.report_date >= p_from) and (p_to is null or r.report_date <= p_to)
               and (p_client is null or r.client_id = p_client)
               and (p_author is null or r.author_id = p_author)
               and (p_lead is null or r.author_id = p_lead or private.direct_lead_of(r.author_id) = p_lead)
             order by r.report_date desc, r.submitted_at desc limit 300) r), '[]'::jsonb);
end $$;

create or replace function public.ads_report_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; r public.ads_reports;
begin
  me := private.ads_actor();
  select * into r from public.ads_reports where id = p_id and department_id = me.department_id;
  if r.id is null or not (case me.role when 'DEPARTMENT_HEAD' then true when 'TEAM_HEAD' then (r.author_id = me.id or private.led_by(me.id, r.author_id)) else r.author_id = me.id end) then
    raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001';
  end if;
  return private.ads_report_json(r, me.id, me.role) || jsonb_build_object('events', private.ads_events_json('report', r.id));
end $$;

create or replace function public.ads_report_review(p_id uuid, p_decision text, p_remarks text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  r public.ads_reports;
  v_dec text := upper(nullif(trim(coalesce(p_decision, '')), ''));
  v_remarks text := left(nullif(trim(coalesce(p_remarks, '')), ''), 2000);
  v_stage text;
  v_lead uuid;
  v_new text;
begin
  me := private.ads_actor();
  if v_dec is null or v_dec not in ('APPROVE', 'RETURN') then raise exception 'VALIDATION_ERROR: Choose Approve or Return.' using errcode = 'P0001'; end if;
  if v_dec = 'RETURN' and v_remarks is null then raise exception 'VALIDATION_ERROR: Add remarks when you return a report.' using errcode = 'P0001'; end if;
  select * into r from public.ads_reports where id = p_id and department_id = me.department_id for update;
  if r.id is null then raise exception 'NOT_FOUND: Report not found.' using errcode = 'P0001'; end if;
  if r.author_id = me.id then raise exception 'FORBIDDEN: You cannot review your own report.' using errcode = '42501'; end if;
  v_lead := private.direct_lead_of(r.author_id);
  if r.status = 'PENDING_TL' and me.role = 'TEAM_HEAD' and v_lead = me.id then
    v_stage := 'TEAM_LEAD';
  elsif me.role = 'DEPARTMENT_HEAD' and (r.status = 'PENDING_DH' or (r.status = 'PENDING_TL' and v_lead is null)) then
    v_stage := 'DEPARTMENT_HEAD';
  else
    raise exception 'FORBIDDEN: This report is not waiting for your decision.' using errcode = '42501';
  end if;
  v_new := case when v_dec = 'RETURN' then 'RETURNED' when v_stage = 'TEAM_LEAD' then 'PENDING_DH' else 'APPROVED' end;
  update public.ads_reports set status = v_new, return_stage = case when v_dec = 'RETURN' then v_stage else null end where id = r.id returning * into r;
  perform private.ads_log('report', r.id, case when v_dec = 'RETURN' then 'RETURNED_BY_' else 'APPROVED_BY_' end || v_stage, null, v_new, v_remarks);
  perform private.write_audit('ADS_REPORT_' || v_dec, 'ads_report', r.id, r.department_id, null, jsonb_build_object('stage', v_stage));
  if v_dec = 'RETURN' then
    perform private.ads_notify(r.author_id, 'ADS_REPORT_RETURNED', 'Your daily report was returned', format('%s · %s%s', to_char(r.report_date, 'DD Mon YYYY'), me.full_name, coalesce(': ' || left(v_remarks, 120), '')), 'ads_report', r.id, 'ads:rep:' || r.id || ':ret:' || r.revision);
  elsif v_stage = 'TEAM_LEAD' then
    perform private.ads_notify(r.author_id, 'ADS_REPORT_APPROVED', 'Your report was approved by your Team Lead', format('%s · now with the Department Head', to_char(r.report_date, 'DD Mon YYYY')), 'ads_report', r.id, 'ads:rep:' || r.id || ':tl:' || r.revision);
    perform private.ads_notify(h, 'ADS_REPORT_SUBMITTED', format('Daily report from %s', private.ads_name(r.author_id)), format('%s · approved by the Team Lead, waiting for you', to_char(r.report_date, 'DD Mon YYYY')), 'ads_report', r.id, 'ads:rep:' || r.id || ':dh:' || r.revision || ':' || h)
      from private.ads_head_ids() h;
  else
    perform private.ads_notify(r.author_id, 'ADS_REPORT_APPROVED', 'Your daily report is fully approved', to_char(r.report_date, 'DD Mon YYYY'), 'ads_report', r.id, 'ads:rep:' || r.id || ':final:' || r.revision);
    perform private.ads_notify(v_lead, 'ADS_REPORT_APPROVED', format('Report approved: %s', private.ads_name(r.author_id)), to_char(r.report_date, 'DD Mon YYYY'), 'ads_report', r.id, 'ads:rep:' || r.id || ':final:' || r.revision || ':lead');
  end if;
  if v_dec = 'RETURN' and v_stage = 'DEPARTMENT_HEAD' then
    perform private.ads_notify(v_lead, 'ADS_REPORT_RETURNED', format('Report returned: %s', private.ads_name(r.author_id)), to_char(r.report_date, 'DD Mon YYYY'), 'ads_report', r.id, 'ads:rep:' || r.id || ':ret:' || r.revision || ':lead');
  end if;
  return private.ads_report_json(r, me.id, me.role);
end $$;

-- 9. Issues -------------------------------------------------------------------------------------------------------
create or replace function public.ads_issue_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  i public.ads_issues;
  v_client uuid;
  v_asg uuid;
  v_lead uuid;
  v_req text := nullif(trim(coalesce(p ->> 'clientRequestId', '')), '');
begin
  me := private.ads_actor();
  if me.role = 'DEPARTMENT_HEAD' then raise exception 'FORBIDDEN: Team Leads and Team Members raise issues.' using errcode = '42501'; end if;
  if v_req is not null then
    select * into i from public.ads_issues where raised_by = me.id and client_request_id = v_req;
    if i.id is not null then return private.ads_issue_json(i); end if;
  end if;
  begin v_client := nullif(p ->> 'clientId', '')::uuid; exception when others then v_client := null; end;
  begin v_asg := nullif(p ->> 'assignmentId', '')::uuid; exception when others then v_asg := null; end;
  if v_asg is not null then
    select a.client_id into v_client from public.ads_assignments a where a.id = v_asg and private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by);
    if v_client is null then raise exception 'VALIDATION_ERROR: Choose one of your assignments.' using errcode = 'P0001'; end if;
  elsif v_client is not null and not private.ads_sees_client(me.id, me.role, v_client) then
    raise exception 'VALIDATION_ERROR: Choose one of your clients.' using errcode = 'P0001';
  end if;
  v_lead := case when me.role = 'TEAM_MEMBER' then private.direct_lead_of(me.id) end;
  if (select count(*) from public.ads_issues where raised_by = me.id and created_at > now() - interval '1 day') >= 20 then
    raise exception 'CONFLICT: You have raised many issues today. Please wait or add to an open one.' using errcode = 'P0001';
  end if;
  insert into public.ads_issues (department_id, reference, raised_by, title, category, description, client_id, assignment_id, priority, attachments, handler_level, client_request_id)
  values (me.department_id, 'ADS-' || to_char(private.ads_today(), 'YYYY') || '-' || lpad(nextval('public.ads_issue_seq')::text, 5, '0'), me.id,
          private.ads_text(p, 'title', 200, true, 'issue title'),
          private.ads_enum(p ->> 'category', array['CLIENT_REQUIREMENTS', 'WORK_ASSIGNMENT', 'DESIGN_BLOCKER', 'TECHNICAL', 'TEAM_COORDINATION', 'OTHER'], 'OTHER', 'category'),
          private.ads_text(p, 'description', 4000, true, 'description'), v_client, v_asg,
          private.ads_enum(p ->> 'priority', array['LOW', 'MEDIUM', 'HIGH', 'URGENT'], 'MEDIUM', 'priority'), private.ads_links(p -> 'attachments'),
          case when v_lead is null then 'DEPARTMENT_HEAD' else 'TEAM_LEAD' end, v_req)
  returning * into i;
  perform private.ads_log('issue', i.id, 'CREATED', null, 'OPEN');
  perform private.write_audit('ADS_ISSUE_CREATED', 'ads_issue', i.id, me.department_id, me.team_id, jsonb_build_object('reference', i.reference, 'level', i.handler_level));
  if v_lead is not null then
    perform private.ads_notify(v_lead, 'ADS_ISSUE', format('New issue %s', i.reference), format('%s · %s', me.full_name, i.priority), 'ads_issue', i.id, 'ads:iss:' || i.id || ':new');
  else
    perform private.ads_notify(h, 'ADS_ISSUE', format('New issue %s', i.reference), format('%s · %s', me.full_name, i.priority), 'ads_issue', i.id, 'ads:iss:' || i.id || ':new:' || h) from private.ads_head_ids() h;
  end if;
  return private.ads_issue_json(i);
end $$;

create or replace function private.ads_sees_issue(me public.profiles, i public.ads_issues)
returns boolean language sql stable security definer set search_path = '' as $$
  select i.department_id = me.department_id and case me.role
    when 'DEPARTMENT_HEAD' then true
    when 'TEAM_HEAD' then i.raised_by = me.id or private.led_by(me.id, i.raised_by)
    else i.raised_by = me.id end
$$;
revoke all on function private.ads_sees_issue(public.profiles, public.ads_issues) from public, anon, authenticated;

create or replace function public.ads_issues_list(p_view text default 'mine', p_status text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles;
begin
  me := private.ads_actor();
  if p_view not in ('mine', 'team', 'all') then raise exception 'VALIDATION_ERROR: Unknown view.' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(private.ads_issue_json(i) order by i.created_at desc)
      from (select * from public.ads_issues i
             where private.ads_sees_issue(me, i)
               and (p_view = 'all' or (p_view = 'mine' and i.raised_by = me.id) or (p_view = 'team' and i.raised_by <> me.id))
               and (p_status is null or i.status = upper(p_status))
             order by i.created_at desc limit 300) i), '[]'::jsonb);
end $$;

create or replace function public.ads_issue_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare me public.profiles; i public.ads_issues; v_lead uuid;
begin
  me := private.ads_actor();
  select * into i from public.ads_issues where id = p_id;
  if i.id is null or not private.ads_sees_issue(me, i) then raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001'; end if;
  v_lead := private.direct_lead_of(i.raised_by);
  return private.ads_issue_json(i) || jsonb_build_object('events', private.ads_events_json('issue', i.id),
    'canWork', (me.role = 'DEPARTMENT_HEAD' or (me.role = 'TEAM_HEAD' and i.handler_level = 'TEAM_LEAD' and v_lead = me.id)),
    'canEscalate', (me.role = 'TEAM_HEAD' and i.handler_level = 'TEAM_LEAD' and v_lead = me.id and i.status not in ('RESOLVED', 'CLOSED')));
end $$;

-- A response and / or a status change. The raiser can reply and close; the handler (Team Lead, or the Department Head once it is
-- theirs) works the issue; the Department Head can always work it.
create or replace function public.ads_issue_update(p_id uuid, p_status text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  i public.ads_issues;
  v_status text := upper(nullif(trim(coalesce(p_status, '')), ''));
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 2000);
  v_lead uuid;
  v_handler boolean;
  v_old text;
begin
  me := private.ads_actor();
  if v_status is null and v_note is null then raise exception 'VALIDATION_ERROR: Write a response or choose a status.' using errcode = 'P0001'; end if;
  if v_status is not null and v_status not in ('OPEN', 'UNDER_REVIEW', 'IN_PROGRESS', 'RESOLVED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Choose a valid status.' using errcode = 'P0001';
  end if;
  select * into i from public.ads_issues where id = p_id for update;
  if i.id is null or not private.ads_sees_issue(me, i) then raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001'; end if;
  v_lead := private.direct_lead_of(i.raised_by);
  v_handler := me.role = 'DEPARTMENT_HEAD' or (me.role = 'TEAM_HEAD' and i.handler_level = 'TEAM_LEAD' and v_lead = me.id);
  if i.status = 'CLOSED' then raise exception 'CONFLICT: This issue is closed.' using errcode = 'P0001'; end if;
  v_old := i.status;
  if v_status is not null and v_status <> i.status then
    if v_handler then
      null;
    elsif i.raised_by = me.id and v_status = 'CLOSED' then
      null;
    else
      raise exception 'FORBIDDEN: You cannot change the status of this issue.' using errcode = '42501';
    end if;
    update public.ads_issues set status = v_status where id = i.id returning * into i;
    perform private.ads_log('issue', i.id, 'STATUS', v_old, v_status, v_note);
  elsif v_note is not null then
    if not (v_handler or i.raised_by = me.id) then raise exception 'FORBIDDEN: You cannot respond to this issue.' using errcode = '42501'; end if;
    -- a reply from the raiser on a resolved issue reopens it for review
    if i.raised_by = me.id and i.status = 'RESOLVED' then
      update public.ads_issues set status = 'UNDER_REVIEW' where id = i.id returning * into i;
      perform private.ads_log('issue', i.id, 'STATUS', 'RESOLVED', 'UNDER_REVIEW', 'Reopened by the employee');
    end if;
    perform private.ads_log('issue', i.id, 'RESPONSE', null, null, v_note);
  end if;
  if v_status is not null and v_status <> v_old and v_note is not null then
    -- the response is part of the status step above; nothing more to write
    null;
  end if;
  perform private.write_audit('ADS_ISSUE_UPDATED', 'ads_issue', i.id, i.department_id, null, jsonb_build_object('status', i.status));
  if me.id = i.raised_by then
    if i.handler_level = 'TEAM_LEAD' and v_lead is not null then
      perform private.ads_notify(v_lead, 'ADS_ISSUE', format('Issue %s updated', i.reference), format('By %s', me.full_name), 'ads_issue', i.id, 'ads:iss:' || i.id || ':up:' || extract(epoch from clock_timestamp())::bigint);
    else
      perform private.ads_notify(h, 'ADS_ISSUE', format('Issue %s updated', i.reference), format('By %s', me.full_name), 'ads_issue', i.id, 'ads:iss:' || i.id || ':up:' || extract(epoch from clock_timestamp())::bigint || ':' || h) from private.ads_head_ids() h;
    end if;
  else
    perform private.ads_notify(i.raised_by, 'ADS_ISSUE', format('Issue %s: %s', i.reference, initcap(replace(lower(i.status), '_', ' '))), format('Update from %s', me.full_name), 'ads_issue', i.id, 'ads:iss:' || i.id || ':st:' || extract(epoch from clock_timestamp())::bigint);
  end if;
  return private.ads_issue_json(i);
end $$;

create or replace function public.ads_issue_escalate(p_id uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
  i public.ads_issues;
  v_note text := left(nullif(trim(coalesce(p_note, '')), ''), 2000);
begin
  me := private.ads_actor();
  select * into i from public.ads_issues where id = p_id for update;
  if i.id is null or not private.ads_sees_issue(me, i) then raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001'; end if;
  if not (me.role = 'TEAM_HEAD' and i.handler_level = 'TEAM_LEAD' and private.direct_lead_of(i.raised_by) = me.id) then
    raise exception 'FORBIDDEN: Only the Team Lead handling this issue can escalate it.' using errcode = '42501';
  end if;
  if i.status in ('RESOLVED', 'CLOSED') then raise exception 'CONFLICT: This issue is already %.', lower(i.status) using errcode = 'P0001'; end if;
  update public.ads_issues set handler_level = 'DEPARTMENT_HEAD', escalated_by = me.id, escalated_at = now(),
         status = case when status = 'OPEN' then 'UNDER_REVIEW' else status end
   where id = i.id returning * into i;
  perform private.ads_log('issue', i.id, 'ESCALATED', 'TEAM_LEAD', 'DEPARTMENT_HEAD', v_note);
  perform private.write_audit('ADS_ISSUE_ESCALATED', 'ads_issue', i.id, i.department_id, null, jsonb_build_object('reference', i.reference));
  perform private.ads_notify(h, 'ADS_ISSUE', format('Issue %s escalated', i.reference), format('By %s', me.full_name), 'ads_issue', i.id, 'ads:iss:' || i.id || ':esc:' || h) from private.ads_head_ids() h;
  perform private.ads_notify(i.raised_by, 'ADS_ISSUE', format('Issue %s escalated to the Department Head', i.reference), format('By %s', me.full_name), 'ads_issue', i.id, 'ads:iss:' || i.id || ':esc:raiser');
  return private.ads_issue_json(i);
end $$;

-- 10. Overview (live figures for the caller's own scope) ----------------------------------------------------------
create or replace function public.ads_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
  v_today date := private.ads_today();
begin
  me := private.ads_actor();
  return jsonb_build_object(
    'clients', (select count(*) from public.ads_clients c where c.department_id = me.department_id and private.ads_sees_client(me.id, me.role, c.id)),
    'assignments', (select jsonb_build_object(
        'total', count(*), 'ongoing', count(*) filter (where a.status in ('ACCEPTED', 'IN_PROGRESS')),
        'completed', count(*) filter (where a.status = 'COMPLETED'),
        'pending', count(*) filter (where a.status in ('ASSIGNED', 'PENDING_REVIEW', 'REVISION_REQUIRED')),
        'overdue', count(*) filter (where a.status <> 'COMPLETED' and a.due_date < v_today))
      from public.ads_assignments a
      where a.department_id = me.department_id and private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by)
        and (me.role = 'DEPARTMENT_HEAD' or a.assignee_id = me.id or me.role = 'TEAM_HEAD')),
    'upcoming', coalesce((select jsonb_agg(private.ads_assignment_json(a) order by a.due_date) from (
        select * from public.ads_assignments a
         where a.department_id = me.department_id and a.status <> 'COMPLETED' and a.due_date is not null and a.due_date >= v_today
           and private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by) and (me.role = 'DEPARTMENT_HEAD' or a.assignee_id = me.id)
         order by a.due_date limit 5) a), '[]'::jsonb),
    -- Team Member: my own reports sent back, and whether today's is missing; Team Lead / Department Head: reports waiting for their decision
    'pendingReports', case when me.role = 'TEAM_MEMBER' or me.role = 'TEAM_HEAD' then
        (select count(*) from public.ads_reports r where r.author_id = me.id and r.status = 'RETURNED') else 0 end
      + case when me.role = 'TEAM_HEAD' then (select count(*) from public.ads_reports r where r.department_id = me.department_id and r.status = 'PENDING_TL' and private.direct_lead_of(r.author_id) = me.id)
             when me.role = 'DEPARTMENT_HEAD' then (select count(*) from public.ads_reports r where r.department_id = me.department_id and (r.status = 'PENDING_DH' or (r.status = 'PENDING_TL' and private.direct_lead_of(r.author_id) is null)))
             else 0 end,
    'reportToday', case when me.role = 'DEPARTMENT_HEAD' then null
                        else exists (select 1 from public.ads_reports r where r.author_id = me.id and r.report_date = v_today) end,
    'openIssues', (select count(*) from public.ads_issues i where private.ads_sees_issue(me, i) and i.status not in ('RESOLVED', 'CLOSED')),
    'notices', coalesce((select jsonb_agg(private.ads_notice_json(n) order by n.created_at desc) from (
        select * from public.ads_client_notices n
         where n.department_id = me.department_id and n.status <> 'RESOLVED'
           and (n.created_by = me.id or n.assigned_to = me.id or private.ads_sees_client(me.id, me.role, n.client_id))
         order by n.created_at desc limit 5) n), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'entityType', e.entity_type, 'entityId', e.entity_id, 'event', e.event,
          'fromValue', e.from_value, 'toValue', e.to_value, 'actorName', private.ads_name(e.actor_id), 'createdAt', e.created_at,
          'title', case e.entity_type
              when 'assignment' then (select title from public.ads_assignments where id = e.entity_id)
              when 'issue' then (select reference from public.ads_issues where id = e.entity_id)
              when 'report' then (select to_char(report_date, 'DD Mon YYYY') from public.ads_reports where id = e.entity_id)
              when 'client' then (select client_name from public.ads_clients where id = e.entity_id)
              when 'notice' then (select title from public.ads_client_notices where id = e.entity_id) end) order by e.id desc) from (
        select e.* from public.ads_events e
         where (e.entity_type = 'assignment' and exists (select 1 from public.ads_assignments a where a.id = e.entity_id and private.ads_sees_row(me.id, me.role, a.assignee_id, a.assigned_by)))
            or (e.entity_type = 'report' and exists (select 1 from public.ads_reports r where r.id = e.entity_id
                  and (case me.role when 'DEPARTMENT_HEAD' then true when 'TEAM_HEAD' then (r.author_id = me.id or private.led_by(me.id, r.author_id)) else r.author_id = me.id end)))
            or (e.entity_type = 'issue' and exists (select 1 from public.ads_issues i where i.id = e.entity_id and private.ads_sees_issue(me, i)))
            or (e.entity_type = 'client' and private.ads_sees_client(me.id, me.role, e.entity_id))
            or (e.entity_type = 'notice' and exists (select 1 from public.ads_client_notices n where n.id = e.entity_id and private.ads_sees_client(me.id, me.role, n.client_id)))
         order by e.id desc limit 10) e), '[]'::jsonb));
end $$;

-- 11. Who may call what ---------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'ads\_%' escape '\' and p.proname not in ('ads_issue_seq')
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
