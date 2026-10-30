-- =============================================================================
-- Employee issues and HR meeting requests
--
-- Team Members, Team Leads and Department Heads raise an issue or ask for a meeting from one page ("Raise an Issue"). HR sees both in two
-- separate sections ("Employee Issues", "Meeting Requests") and works them: assign, respond, ask for more information, change the status,
-- schedule / reschedule / decline / cancel / complete a meeting. Everything an employee sees is only their own; HR sees every department.
--
--   employee_issues             one row per issue (reference ISS-YYYY-00001), with the employee's details copied from their profile at submission
--   employee_meeting_requests   one row per meeting request (reference MTG-YYYY-00001); a request is NOT a meeting until HR schedules it
--   employee_case_events        the append-only history of both: submissions, assignments, status changes, responses, information requests,
--                               employee replies and HR's internal notes (visibility HR). An employee never reads an HR-only event.
--   employee_issue_attachments  optional files on an issue (private bucket; the API signs short-lived links after the database allowed them)
--
-- WHO: only an active Team Member, Team Lead or Department Head submits (not the Super Admin, not a client). HR staff (private.is_hr_staff:
-- the HR department and the Super Admin) work the cases; an HR employee never works their own case (it is left out of the HR lists and
-- refused in the HR functions). Every function checks the caller itself; the tables have row level security on, a select policy for the
-- owner / HR, and NO insert / update / delete grant: only these SECURITY DEFINER functions write.
-- NOTIFICATIONS: the existing in-app notifications (private.notify). A notification is never written twice for the same unread message, and a
-- repeated submission (same client request id) creates no second record and no second notification. Notifications carry the reference and
-- the status, never the issue text.
-- Safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create sequence if not exists public.employee_issue_ref_seq;
create sequence if not exists public.employee_meeting_ref_seq;
revoke all on sequence public.employee_issue_ref_seq, public.employee_meeting_ref_seq from public, anon, authenticated;

create table if not exists public.employee_issues (
  id uuid primary key default gen_random_uuid(),
  issue_reference text not null unique,
  -- the browser's id for one filled-in form: submitting the same form twice returns the first record
  client_request_id uuid not null,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  -- the employee's details as they were when the issue was raised (read from the profile, never typed)
  employee_name text not null,
  employee_code text not null,
  department_id uuid references public.departments (id) on delete set null,
  department_name text,
  designation text,
  title text not null check (length(btrim(title)) between 3 and 200),
  category text not null check (category in ('WORKPLACE', 'HR_POLICY', 'ATTENDANCE_LEAVE', 'SALARY_PAYROLL', 'TEAM_MANAGEMENT', 'TECHNICAL_SYSTEM', 'FACILITIES', 'OTHER')),
  description text not null check (length(btrim(description)) between 10 and 5000),
  priority text not null default 'MEDIUM' check (priority in ('LOW', 'MEDIUM', 'HIGH', 'URGENT')),
  preferred_resolution text check (preferred_resolution is null or length(preferred_resolution) <= 2000),
  status text not null default 'NEW' check (status in ('NEW', 'IN_PROGRESS', 'AWAITING_EMPLOYEE', 'RESOLVED', 'CLOSED')),
  assigned_hr_id uuid references public.profiles (id) on delete set null,
  -- HR's latest response that the employee can read
  hr_response text check (hr_response is null or length(hr_response) <= 4000),
  hr_response_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  closed_at timestamptz,
  unique (employee_id, client_request_id)
);
create index if not exists employee_issues_status_idx on public.employee_issues (status, created_at desc);
create index if not exists employee_issues_employee_idx on public.employee_issues (employee_id, created_at desc);
create index if not exists employee_issues_assignee_idx on public.employee_issues (assigned_hr_id) where assigned_hr_id is not null;
create index if not exists employee_issues_department_idx on public.employee_issues (department_id, created_at desc);
create index if not exists employee_issues_priority_idx on public.employee_issues (priority) where status not in ('RESOLVED', 'CLOSED');

create table if not exists public.employee_meeting_requests (
  id uuid primary key default gen_random_uuid(),
  meeting_reference text not null unique,
  client_request_id uuid not null,
  employee_id uuid not null references public.profiles (id) on delete cascade,
  employee_name text not null,
  employee_code text not null,
  department_id uuid references public.departments (id) on delete set null,
  department_name text,
  designation text,
  subject text not null check (length(btrim(subject)) between 3 and 200),
  category text not null check (category in ('HR_CONCERN', 'WORKPLACE_ISSUE', 'ATTENDANCE_LEAVE', 'SALARY_PAYROLL', 'MANAGEMENT', 'PERSONAL_CONFIDENTIAL', 'OTHER')),
  description text not null check (length(btrim(description)) between 10 and 5000),
  preferred_date date not null,
  preferred_time time not null,
  meeting_mode text not null check (meeting_mode in ('IN_PERSON', 'ONLINE')),
  notes text check (notes is null or length(notes) <= 2000),
  status text not null default 'PENDING' check (status in ('PENDING', 'SCHEDULED', 'ALTERNATIVE_PROPOSED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
  assigned_hr_id uuid references public.profiles (id) on delete set null,
  -- what HR confirmed
  confirmed_date date,
  confirmed_time time,
  confirmed_mode text check (confirmed_mode is null or confirmed_mode in ('IN_PERSON', 'ONLINE')),
  meeting_location text check (meeting_location is null or length(meeting_location) <= 300),
  meeting_link text check (meeting_link is null or (length(meeting_link) <= 500 and meeting_link ~ '^https://[^\s]+$')),
  instructions text check (instructions is null or length(instructions) <= 2000),
  -- an alternative HR proposed, waiting for the employee
  proposed_date date,
  proposed_time time,
  hr_response text check (hr_response is null or length(hr_response) <= 4000),
  hr_response_at timestamptz,
  decline_or_reschedule_reason text check (decline_or_reschedule_reason is null or length(decline_or_reschedule_reason) <= 2000),
  -- HR only: what was discussed and what happens next
  meeting_outcome text check (meeting_outcome is null or length(meeting_outcome) <= 4000),
  follow_up_actions text check (follow_up_actions is null or length(follow_up_actions) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (employee_id, client_request_id),
  check (status <> 'SCHEDULED' or (confirmed_date is not null and confirmed_time is not null)),
  check (status <> 'ALTERNATIVE_PROPOSED' or (proposed_date is not null and proposed_time is not null))
);
create index if not exists employee_meetings_status_idx on public.employee_meeting_requests (status, created_at desc);
create index if not exists employee_meetings_employee_idx on public.employee_meeting_requests (employee_id, created_at desc);
create index if not exists employee_meetings_assignee_idx on public.employee_meeting_requests (assigned_hr_id) where assigned_hr_id is not null;
create index if not exists employee_meetings_department_idx on public.employee_meeting_requests (department_id, created_at desc);
create index if not exists employee_meetings_date_idx on public.employee_meeting_requests (coalesce(confirmed_date, preferred_date));

create table if not exists public.employee_case_events (
  id bigint generated always as identity primary key,
  issue_id uuid references public.employee_issues (id) on delete cascade,
  meeting_id uuid references public.employee_meeting_requests (id) on delete cascade,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_name text,
  -- who acted: the employee the case belongs to, or HR
  actor_side text not null check (actor_side in ('EMPLOYEE', 'HR')),
  kind text not null check (kind in ('SUBMITTED', 'ASSIGNED', 'STATUS_CHANGED', 'RESPONSE', 'INFO_REQUESTED', 'EMPLOYEE_REPLY', 'NOTE',
    'APPROVED', 'DECLINED', 'ALTERNATIVE_PROPOSED', 'ALTERNATIVE_ACCEPTED', 'ALTERNATIVE_DECLINED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED')),
  -- EMPLOYEE: the employee sees it; HR: internal, only HR sees it
  visibility text not null check (visibility in ('EMPLOYEE', 'HR')),
  body text check (body is null or length(body) <= 4000),
  from_status text,
  to_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((issue_id is null) <> (meeting_id is null)),
  check (kind <> 'NOTE' or visibility = 'HR')
);
create index if not exists employee_case_events_issue_idx on public.employee_case_events (issue_id, id) where issue_id is not null;
create index if not exists employee_case_events_meeting_idx on public.employee_case_events (meeting_id, id) where meeting_id is not null;

create table if not exists public.employee_issue_attachments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid references public.employee_issues (id) on delete cascade,
  event_id bigint references public.employee_case_events (id) on delete set null,
  uploader_id uuid not null references public.profiles (id) on delete cascade,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 5242880),
  status text not null default 'PENDING' check (status in ('PENDING', 'READY', 'FAILED')),
  storage_bucket text not null default 'employee-issue-attachments',
  storage_path text not null,
  storage_provider text check (storage_provider in ('SUPABASE', 'R2')),
  storage_ref text,
  storage_etag text,
  created_at timestamptz not null default now()
);
create index if not exists employee_issue_attachments_issue_idx on public.employee_issue_attachments (issue_id, created_at) where issue_id is not null;
create index if not exists employee_issue_attachments_pending_idx on public.employee_issue_attachments (uploader_id, created_at) where status = 'PENDING';

drop trigger if exists employee_issues_set_updated_at on public.employee_issues;
create trigger employee_issues_set_updated_at before update on public.employee_issues for each row execute function public.tg_set_updated_at();
drop trigger if exists employee_meetings_set_updated_at on public.employee_meeting_requests;
create trigger employee_meetings_set_updated_at before update on public.employee_meeting_requests for each row execute function public.tg_set_updated_at();

-- the history is append-only: nothing edits an event
create or replace function private.tg_employee_case_events_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: The history of an issue or meeting cannot be changed.' using errcode = '42501';
end $$;
revoke all on function private.tg_employee_case_events_immutable() from public, anon, authenticated;
drop trigger if exists employee_case_events_no_update on public.employee_case_events;
create trigger employee_case_events_no_update before update on public.employee_case_events for each row execute function private.tg_employee_case_events_immutable();

-- ---------------------------------------------------------------------------
-- 2. Row level security: read-only, the owner or HR; nothing is written except by the functions below
-- ---------------------------------------------------------------------------
alter table public.employee_issues enable row level security;
alter table public.employee_meeting_requests enable row level security;
alter table public.employee_case_events enable row level security;
alter table public.employee_issue_attachments enable row level security;
revoke all on public.employee_issues, public.employee_meeting_requests, public.employee_case_events, public.employee_issue_attachments from public, anon, authenticated;
grant select on public.employee_issues, public.employee_meeting_requests, public.employee_case_events to authenticated;

-- whether the signed-in person owns the case an event belongs to
create or replace function private.employee_case_owner(p_issue uuid, p_meeting uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.employee_issues i where i.id = p_issue and i.employee_id = auth.uid())
      or exists (select 1 from public.employee_meeting_requests m where m.id = p_meeting and m.employee_id = auth.uid())
$$;
revoke all on function private.employee_case_owner(uuid, uuid) from public, anon;
grant execute on function private.employee_case_owner(uuid, uuid) to authenticated;

drop policy if exists employee_issues_select on public.employee_issues;
create policy employee_issues_select on public.employee_issues for select to authenticated
  using (employee_id = (select auth.uid()) or (select private.is_hr_staff()));
drop policy if exists employee_meetings_select on public.employee_meeting_requests;
create policy employee_meetings_select on public.employee_meeting_requests for select to authenticated
  using (employee_id = (select auth.uid()) or (select private.is_hr_staff()));
drop policy if exists employee_case_events_select on public.employee_case_events;
create policy employee_case_events_select on public.employee_case_events for select to authenticated
  using ((select private.is_hr_staff()) or (visibility = 'EMPLOYEE' and (select private.employee_case_owner(issue_id, meeting_id))));

-- private bucket for the attachments (no browser access: the API signs short-lived links after the database allowed the download)
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('employee-issue-attachments', 'employee-issue-attachments', false, 5242880,
            array['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Helpers (only reachable from the SECURITY DEFINER functions below)
-- ---------------------------------------------------------------------------
-- The employee id the HR directory shows: the HR record's id, or EMP- + the first 8 characters of the account id.
create or replace function private.employee_code_of(p_profile uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select h.id from public.hr_employees h join public.profiles p on p.id = p_profile
      where h.profile_id = p.id or (h.profile_id is null and lower(trim(coalesce(h.email, ''))) = p.email)
      order by (h.profile_id is not null) desc, h.created_at limit 1),
    'EMP-' || upper(left(p_profile::text, 8)))
$$;

create or replace function private.issue_category_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'WORKPLACE' then 'Workplace Issue' when 'HR_POLICY' then 'HR or Policy Concern' when 'ATTENDANCE_LEAVE' then 'Attendance or Leave'
    when 'SALARY_PAYROLL' then 'Salary or Payroll' when 'TEAM_MANAGEMENT' then 'Team or Management Concern' when 'TECHNICAL_SYSTEM' then 'Technical or System Issue'
    when 'FACILITIES' then 'Workplace Facilities' else 'Other' end
$$;

create or replace function private.meeting_category_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'HR_CONCERN' then 'HR Concern' when 'WORKPLACE_ISSUE' then 'Workplace Issue' when 'ATTENDANCE_LEAVE' then 'Attendance or Leave'
    when 'SALARY_PAYROLL' then 'Salary or Payroll' when 'MANAGEMENT' then 'Management Discussion' when 'PERSONAL_CONFIDENTIAL' then 'Personal or Confidential Concern'
    else 'Other' end
$$;

create or replace function private.case_status_label(p text)
returns text language sql immutable set search_path = '' as $$
  select case p when 'NEW' then 'New' when 'IN_PROGRESS' then 'In progress' when 'AWAITING_EMPLOYEE' then 'Waiting for your reply' when 'RESOLVED' then 'Resolved'
    when 'CLOSED' then 'Closed' when 'PENDING' then 'Pending' when 'SCHEDULED' then 'Scheduled' when 'ALTERNATIVE_PROPOSED' then 'Another time proposed'
    when 'DECLINED' then 'Declined' when 'CANCELLED' then 'Cancelled' when 'COMPLETED' then 'Completed' else p end
$$;

-- who the signed-in person is: an active employee who may raise cases (Team Member, Team Lead, Department Head)
create or replace function private.require_employee()
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null or me.role not in ('TEAM_MEMBER', 'TEAM_HEAD', 'DEPARTMENT_HEAD') then
    raise exception 'FORBIDDEN: Only a Team Member, Team Lead or Department Head can raise an issue or ask for a meeting.' using errcode = '42501';
  end if;
  return me;
end $$;

-- HR staff (the HR department, or the Super Admin)
create or replace function private.require_hr()
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_hr_staff() then
    raise exception 'FORBIDDEN: This page is for HR.' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- the details copied onto a case from the signed-in employee's profile
create or replace function private.employee_snapshot(p_profile uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', p.full_name, 'code', private.employee_code_of(p.id), 'departmentId', p.department_id, 'department', d.name,
    'designation', coalesce(nullif(btrim(p.position), ''), x.designation,
      case p.role when 'DEPARTMENT_HEAD' then 'Department Head' when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end))
    from public.profiles p
    left join public.departments d on d.id = p.department_id
    left join public.employee_personal_details x on x.profile_id = p.id
   where p.id = p_profile
$$;

-- one in-app notification, never twice for the same unread message
create or replace function private.notify_once(p_recipient uuid, p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid,
  p_data jsonb default '{}'::jsonb, p_priority text default 'normal')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_recipient is null or p_recipient is not distinct from auth.uid() then
    return;
  end if;
  if exists (select 1 from public.notifications n
              where n.recipient_id = p_recipient and n.type = p_type and n.entity_id is not distinct from p_entity_id
                and n.title = p_title and n.body = coalesce(p_body, '') and n.read_at is null) then
    return;
  end if;
  perform private.notify(p_recipient, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
end $$;

-- the HR team (active HR department members); when nobody is in the HR department yet, the Super Admin instead
create or replace function private.notify_hr(p_type text, p_title text, p_body text, p_entity_type text, p_entity_id uuid, p_data jsonb default '{}'::jsonb,
  p_priority text default 'normal', p_only uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_any boolean := false;
begin
  if p_only is not null then
    perform private.notify_once(p_only, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
    return;
  end if;
  for r in select p.id from public.profiles p join public.departments d on d.id = p.department_id where d.slug = 'hr' and p.status = 'ACTIVE' loop
    v_any := true;
    perform private.notify_once(r.id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
  end loop;
  if not v_any then
    for r in select p.id from public.profiles p where p.role = 'SUPER_ADMIN' and p.status = 'ACTIVE' loop
      perform private.notify_once(r.id, p_type, p_title, p_body, p_entity_type, p_entity_id, p_data, p_priority);
    end loop;
  end if;
end $$;

create or replace function private.case_event(p_issue uuid, p_meeting uuid, p_side text, p_kind text, p_visibility text, p_body text,
  p_from text default null, p_to text default null, p_meta jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_id bigint;
begin
  insert into public.employee_case_events (issue_id, meeting_id, actor_id, actor_name, actor_side, kind, visibility, body, from_status, to_status, metadata)
  values (p_issue, p_meeting, auth.uid(), (select full_name from public.profiles where id = auth.uid()), p_side, p_kind, p_visibility,
          nullif(btrim(coalesce(p_body, '')), ''), p_from, p_to, coalesce(p_meta, '{}'::jsonb))
  returning id into v_id;
  return v_id;
end $$;

create or replace function private.issue_json(r public.employee_issues, p_full boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'reference', r.issue_reference, 'title', r.title, 'category', r.category, 'priority', r.priority, 'status', r.status,
    'description', case when p_full then r.description end, 'preferredResolution', case when p_full then r.preferred_resolution end,
    'hrResponse', r.hr_response, 'hrResponseAt', r.hr_response_at,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'resolvedAt', r.resolved_at, 'closedAt', r.closed_at,
    'assignedHr', (select jsonb_build_object('id', h.id, 'name', h.full_name) from public.profiles h where h.id = r.assigned_hr_id),
    'employee', jsonb_build_object('id', r.employee_id, 'name', r.employee_name, 'employeeCode', r.employee_code, 'departmentId', r.department_id,
                                   'department', r.department_name, 'designation', r.designation))
$$;

-- p_hr: HR sees the outcome and follow-up; the employee does not
create or replace function private.meeting_json(r public.employee_meeting_requests, p_full boolean, p_hr boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'reference', r.meeting_reference, 'subject', r.subject, 'category', r.category, 'status', r.status,
    'description', case when p_full then r.description end, 'notes', case when p_full then r.notes end,
    'preferredDate', r.preferred_date, 'preferredTime', to_char(r.preferred_time, 'HH24:MI'), 'mode', r.meeting_mode,
    'confirmedDate', r.confirmed_date, 'confirmedTime', to_char(r.confirmed_time, 'HH24:MI'), 'confirmedMode', r.confirmed_mode,
    'location', r.meeting_location, 'link', r.meeting_link, 'instructions', r.instructions,
    'proposedDate', r.proposed_date, 'proposedTime', to_char(r.proposed_time, 'HH24:MI'),
    'hrResponse', r.hr_response, 'hrResponseAt', r.hr_response_at, 'reason', r.decline_or_reschedule_reason,
    'outcome', case when p_hr and p_full then r.meeting_outcome end, 'followUp', case when p_hr and p_full then r.follow_up_actions end,
    'createdAt', r.created_at, 'updatedAt', r.updated_at, 'completedAt', r.completed_at,
    'assignedHr', (select jsonb_build_object('id', h.id, 'name', h.full_name) from public.profiles h where h.id = r.assigned_hr_id),
    'employee', jsonb_build_object('id', r.employee_id, 'name', r.employee_name, 'employeeCode', r.employee_code, 'departmentId', r.department_id,
                                   'department', r.department_name, 'designation', r.designation))
$$;

create or replace function private.case_events_json(p_issue uuid, p_meeting uuid, p_hr boolean)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'visibility', e.visibility, 'side', e.actor_side, 'actorName', e.actor_name,
           'body', e.body, 'fromStatus', e.from_status, 'toStatus', e.to_status, 'createdAt', e.created_at) order by e.id), '[]'::jsonb)
    from public.employee_case_events e
   where ((p_issue is not null and e.issue_id = p_issue) or (p_meeting is not null and e.meeting_id = p_meeting))
     and (p_hr or e.visibility = 'EMPLOYEE')
$$;

create or replace function private.issue_attachments_json(p_issue uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.file_name, 'mime', a.mime_type, 'size', a.size_bytes, 'eventId', a.event_id,
           'createdAt', a.created_at) order by a.created_at, a.id), '[]'::jsonb)
    from public.employee_issue_attachments a where a.issue_id = p_issue and a.status = 'READY'
$$;

-- attaches the caller's own finished uploads to an issue (at most 5; each must be theirs, finished and not attached yet)
create or replace function private.issue_attach(p_issue uuid, p_event bigint, p_attachments uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[] := coalesce(p_attachments, '{}'::uuid[]);
  v_n integer;
begin
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(v_ids, 1) > 5 then
    raise exception 'VALIDATION_ERROR: You can attach up to 5 files at a time.' using errcode = 'P0001';
  end if;
  select count(distinct a.id) into v_n from public.employee_issue_attachments a
   where a.id = any (v_ids) and a.uploader_id = auth.uid() and a.status = 'READY' and a.issue_id is null;
  if v_n <> (select count(distinct x) from unnest(v_ids) x) then
    raise exception 'VALIDATION_ERROR: One of the files is not available any more. Please attach it again.' using errcode = 'P0001';
  end if;
  update public.employee_issue_attachments set issue_id = p_issue, event_id = p_event where id = any (v_ids);
  return v_n;
end $$;

-- escape a search term for ILIKE
create or replace function private.like_escape(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(coalesce(p, ''), '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- ---------------------------------------------------------------------------
-- 4. Issues: the employee
-- ---------------------------------------------------------------------------
create or replace function public.issue_submit(p_client_request uuid, p_title text, p_category text, p_description text, p_priority text,
  p_resolution text default null, p_attachments uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_issues;
  v_snap jsonb;
  v_event bigint;
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_res text := nullif(btrim(coalesce(p_resolution, '')), '');
begin
  if p_client_request is null then
    raise exception 'VALIDATION_ERROR: Reload the page and try again.' using errcode = 'P0001';
  end if;
  select * into r from public.employee_issues where employee_id = me.id and client_request_id = p_client_request;
  if r.id is not null then
    return private.issue_json(r, true) || jsonb_build_object('duplicate', true);
  end if;
  if length(v_title) < 3 or length(v_title) > 200 then
    raise exception 'VALIDATION_ERROR: Enter an issue title (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('WORKPLACE', 'HR_POLICY', 'ATTENDANCE_LEAVE', 'SALARY_PAYROLL', 'TEAM_MANAGEMENT', 'TECHNICAL_SYSTEM', 'FACILITIES', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose an issue category.' using errcode = 'P0001';
  end if;
  if length(v_desc) < 10 or length(v_desc) > 5000 then
    raise exception 'VALIDATION_ERROR: Describe the issue (10 to 5000 characters).' using errcode = 'P0001';
  end if;
  if p_priority is null or p_priority not in ('LOW', 'MEDIUM', 'HIGH', 'URGENT') then
    raise exception 'VALIDATION_ERROR: Choose a priority.' using errcode = 'P0001';
  end if;
  if v_res is not null and length(v_res) > 2000 then
    raise exception 'VALIDATION_ERROR: The preferred resolution is too long (2000 characters at most).' using errcode = 'P0001';
  end if;
  if (select count(*) from public.employee_issues i where i.employee_id = me.id and i.created_at > now() - interval '1 day') >= 20 then
    raise exception 'VALIDATION_ERROR: You have raised many issues today. Please wait, or add to an existing issue.' using errcode = 'P0001';
  end if;
  v_snap := private.employee_snapshot(me.id);
  begin
    insert into public.employee_issues (issue_reference, client_request_id, employee_id, employee_name, employee_code, department_id, department_name, designation,
                                        title, category, description, priority, preferred_resolution)
    values ('ISS-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.employee_issue_ref_seq')::text, 5, '0'),
            p_client_request, me.id, v_snap ->> 'name', v_snap ->> 'code', nullif(v_snap ->> 'departmentId', '')::uuid, v_snap ->> 'department', v_snap ->> 'designation',
            v_title, p_category, v_desc, p_priority, v_res)
    returning * into r;
  exception when unique_violation then
    -- the same form arrived twice at once: the first one wins
    select * into r from public.employee_issues where employee_id = me.id and client_request_id = p_client_request;
    return private.issue_json(r, true) || jsonb_build_object('duplicate', true);
  end;
  v_event := private.case_event(r.id, null, 'EMPLOYEE', 'SUBMITTED', 'EMPLOYEE', null, null, 'NEW');
  perform private.issue_attach(r.id, v_event, p_attachments);
  perform private.write_audit('EMPLOYEE_ISSUE_SUBMITTED', 'employee_issue', r.id, r.department_id, null,
    jsonb_build_object('reference', r.issue_reference, 'category', r.category, 'priority', r.priority));
  perform private.notify_hr('EMPLOYEE_ISSUE_SUBMITTED', 'New employee issue ' || r.issue_reference,
    r.employee_name || ' · ' || private.issue_category_label(r.category) || ' · ' || initcap(lower(r.priority)),
    'employee_issue', r.id, jsonb_build_object('reference', r.issue_reference), case when r.priority = 'URGENT' then 'urgent' else 'normal' end);
  return private.issue_json(r, true) || jsonb_build_object('duplicate', false);
end $$;

-- the details a form shows (and a case copies): read from the signed-in employee's own profile
create or replace function public.issue_my_details()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
begin
  return private.employee_snapshot(me.id) || jsonb_build_object('id', me.id);
end $$;

create or replace function public.issue_my_list(p_status text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with f as (
      select i.id, i.created_at from public.employee_issues i
       where i.employee_id = me.id and (p_status is null or p_status in ('', 'ALL') or i.status = p_status)),
    pg as (select id, created_at from f order by created_at desc, id desc limit v_limit offset v_off)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(private.issue_json(i, false) order by i.created_at desc, i.id desc) from public.employee_issues i join pg on pg.id = i.id), '[]'::jsonb),
      'total', (select count(*) from f), 'limit', v_limit, 'offset', v_off));
end $$;

create or replace function public.issue_my_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_issues;
begin
  select * into r from public.employee_issues where id = p_id and employee_id = me.id;
  if r.id is null then
    raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, false), 'attachments', private.issue_attachments_json(r.id));
end $$;

-- the employee answers HR (usually a request for more information), optionally with files
create or replace function public.issue_employee_reply(p_id uuid, p_message text, p_attachments uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_issues;
  v_msg text := btrim(coalesce(p_message, ''));
  v_to text;
  v_event bigint;
begin
  select * into r from public.employee_issues where id = p_id and employee_id = me.id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001';
  end if;
  if r.status = 'CLOSED' then
    raise exception 'CONFLICT: This issue is closed. Please raise a new issue.' using errcode = 'P0001';
  end if;
  if length(v_msg) < 2 or length(v_msg) > 4000 then
    raise exception 'VALIDATION_ERROR: Write your reply (up to 4000 characters).' using errcode = 'P0001';
  end if;
  -- a reply to a request for information, or a reply after the issue was marked resolved, puts it back in HR's hands
  v_to := case when r.status in ('AWAITING_EMPLOYEE', 'RESOLVED') then 'IN_PROGRESS' else r.status end;
  update public.employee_issues set status = v_to, resolved_at = case when v_to = 'IN_PROGRESS' then null else resolved_at end where id = r.id returning * into r;
  v_event := private.case_event(r.id, null, 'EMPLOYEE', 'EMPLOYEE_REPLY', 'EMPLOYEE', v_msg, null, v_to);
  perform private.issue_attach(r.id, v_event, p_attachments);
  perform private.write_audit('EMPLOYEE_ISSUE_EMPLOYEE_REPLIED', 'employee_issue', r.id, r.department_id, null, jsonb_build_object('reference', r.issue_reference, 'status', r.status));
  perform private.notify_hr('EMPLOYEE_ISSUE_REPLY', 'Reply on issue ' || r.issue_reference, r.employee_name || ' replied.', 'employee_issue', r.id,
    jsonb_build_object('reference', r.issue_reference), 'normal', r.assigned_hr_id);
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, false), 'attachments', private.issue_attachments_json(r.id));
end $$;

-- ---------------------------------------------------------------------------
-- 5. Issues: HR
-- ---------------------------------------------------------------------------
-- the HR people an issue or meeting can be assigned to
create or replace function public.issue_hr_assignees()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_hr();
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'designation',
             case p.role when 'DEPARTMENT_HEAD' then 'Department Head' when 'TEAM_HEAD' then 'Team Lead' else 'Team Member' end) order by p.full_name, p.id)
      from public.profiles p join public.departments d on d.id = p.department_id
     where d.slug = 'hr' and p.status = 'ACTIVE'), '[]'::jsonb);
end $$;

-- the departments employees raised cases from (for the filter)
create or replace function public.issue_hr_departments()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_hr();
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.name)
    from public.departments d
   where exists (select 1 from public.employee_issues i where i.department_id = d.id)
      or exists (select 1 from public.employee_meeting_requests m where m.department_id = d.id)), '[]'::jsonb);
end $$;

create or replace function public.issue_hr_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_hr();
  return (select jsonb_build_object(
    'total', count(*), 'new', count(*) filter (where status = 'NEW'), 'inProgress', count(*) filter (where status = 'IN_PROGRESS'),
    'awaiting', count(*) filter (where status = 'AWAITING_EMPLOYEE'), 'resolved', count(*) filter (where status = 'RESOLVED'),
    'closed', count(*) filter (where status = 'CLOSED'), 'urgent', count(*) filter (where priority = 'URGENT' and status not in ('RESOLVED', 'CLOSED')))
    from public.employee_issues where employee_id <> auth.uid());
end $$;

create or replace function public.issue_hr_list(p_status text default null, p_department uuid default null, p_priority text default null, p_category text default null,
  p_assignee uuid default null, p_unassigned boolean default false, p_from timestamptz default null, p_to timestamptz default null, p_search text default null,
  p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_hr();
  return (
    with f as (
      select i.id, i.created_at from public.employee_issues i
       where i.employee_id <> auth.uid()
         and (p_status is null or p_status in ('', 'ALL') or i.status = p_status)
         and (p_department is null or i.department_id = p_department)
         and (p_priority is null or p_priority in ('', 'ALL') or i.priority = p_priority)
         and (p_category is null or p_category in ('', 'ALL') or i.category = p_category)
         and (p_assignee is null or i.assigned_hr_id = p_assignee)
         and (not coalesce(p_unassigned, false) or i.assigned_hr_id is null)
         and (p_from is null or i.created_at >= p_from) and (p_to is null or i.created_at < p_to)
         and (v_q is null or i.employee_name ilike '%' || private.like_escape(v_q) || '%' or i.issue_reference ilike '%' || private.like_escape(v_q) || '%'
              or i.title ilike '%' || private.like_escape(v_q) || '%')),
    pg as (select id, created_at from f order by created_at desc, id desc limit v_limit offset v_off)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(private.issue_json(i, false) order by i.created_at desc, i.id desc) from public.employee_issues i join pg on pg.id = i.id), '[]'::jsonb),
      'total', (select count(*) from f), 'limit', v_limit, 'offset', v_off));
end $$;

create or replace function public.issue_hr_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.employee_issues;
begin
  perform private.require_hr();
  select * into r from public.employee_issues where id = p_id and employee_id <> auth.uid();
  if r.id is null then
    raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
end $$;

-- the case, for the HR functions below: HR only, never their own
create or replace function private.hr_issue_for_update(p_id uuid)
returns public.employee_issues language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues;
begin
  perform private.require_hr();
  select * into r from public.employee_issues where id = p_id and employee_id <> auth.uid() for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Issue not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.issue_hr_assign(p_id uuid, p_hr uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues := private.hr_issue_for_update(p_id);
  v_from text := r.status;
  v_name text;
begin
  if r.status = 'CLOSED' then
    raise exception 'CONFLICT: This issue is closed.' using errcode = 'P0001';
  end if;
  if p_hr is not null then
    select p.full_name into v_name from public.profiles p join public.departments d on d.id = p.department_id
     where p.id = p_hr and p.status = 'ACTIVE' and d.slug = 'hr' and p.id <> r.employee_id;
    if v_name is null then
      raise exception 'VALIDATION_ERROR: Choose a person from the HR team.' using errcode = 'P0001';
    end if;
  end if;
  if r.assigned_hr_id is not distinct from p_hr then
    return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
  end if;
  update public.employee_issues set assigned_hr_id = p_hr, status = case when p_hr is not null and status = 'NEW' then 'IN_PROGRESS' else status end where id = r.id returning * into r;
  perform private.case_event(r.id, null, 'HR', 'ASSIGNED', 'EMPLOYEE', case when p_hr is null then 'The issue is no longer assigned.' else 'Assigned to ' || v_name || '.' end,
    v_from, r.status, jsonb_build_object('assignedTo', p_hr));
  perform private.write_audit('EMPLOYEE_ISSUE_ASSIGNED', 'employee_issue', r.id, r.department_id, null,
    jsonb_build_object('reference', r.issue_reference, 'assigned_to', p_hr, 'status', r.status));
  if p_hr is not null then
    perform private.notify_once(r.employee_id, 'EMPLOYEE_ISSUE_UPDATED', 'Update on your issue ' || r.issue_reference, 'Assigned to ' || v_name || '. Status: ' || private.case_status_label(r.status),
      'employee_issue', r.id, jsonb_build_object('reference', r.issue_reference, 'status', r.status));
    perform private.notify_once(p_hr, 'EMPLOYEE_ISSUE_ASSIGNED', 'Issue assigned to you: ' || r.issue_reference,
      r.employee_name || ' · ' || private.issue_category_label(r.category) || ' · ' || initcap(lower(r.priority)), 'employee_issue', r.id,
      jsonb_build_object('reference', r.issue_reference), case when r.priority = 'URGENT' then 'urgent' else 'normal' end);
  end if;
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
end $$;

create or replace function public.issue_hr_set_status(p_id uuid, p_status text, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues := private.hr_issue_for_update(p_id);
  v_from text := r.status;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  if p_status is null or p_status not in ('NEW', 'IN_PROGRESS', 'AWAITING_EMPLOYEE', 'RESOLVED', 'CLOSED') then
    raise exception 'VALIDATION_ERROR: Choose a status.' using errcode = 'P0001';
  end if;
  if r.status = 'CLOSED' then
    raise exception 'CONFLICT: A closed issue cannot be changed. Ask the employee to raise a new one.' using errcode = 'P0001';
  end if;
  if p_status = 'NEW' then
    raise exception 'VALIDATION_ERROR: An issue that HR has opened cannot go back to New.' using errcode = 'P0001';
  end if;
  if v_msg is not null and length(v_msg) > 4000 then
    raise exception 'VALIDATION_ERROR: The message is too long (4000 characters at most).' using errcode = 'P0001';
  end if;
  if p_status = r.status and v_msg is null then
    return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
  end if;
  update public.employee_issues set
      status = p_status,
      resolved_at = case when p_status = 'RESOLVED' then coalesce(resolved_at, now()) when p_status = 'CLOSED' then coalesce(resolved_at, now()) else null end,
      closed_at = case when p_status = 'CLOSED' then now() else null end,
      hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end
    where id = r.id returning * into r;
  perform private.case_event(r.id, null, 'HR', 'STATUS_CHANGED', 'EMPLOYEE', v_msg, v_from, p_status);
  perform private.write_audit('EMPLOYEE_ISSUE_STATUS_CHANGED', 'employee_issue', r.id, r.department_id, null,
    jsonb_build_object('reference', r.issue_reference, 'from', v_from, 'to', p_status));
  perform private.notify_once(r.employee_id, 'EMPLOYEE_ISSUE_UPDATED', 'Update on your issue ' || r.issue_reference,
    'Status: ' || private.case_status_label(p_status) || case when v_msg is not null then '. HR sent a response.' else '' end,
    'employee_issue', r.id, jsonb_build_object('reference', r.issue_reference, 'status', p_status));
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
end $$;

-- a response the employee reads; with p_request_info it is a request for more information (the issue waits for the employee)
create or replace function public.issue_hr_respond(p_id uuid, p_message text, p_request_info boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues := private.hr_issue_for_update(p_id);
  v_from text := r.status;
  v_msg text := btrim(coalesce(p_message, ''));
  v_to text;
begin
  if r.status = 'CLOSED' then
    raise exception 'CONFLICT: This issue is closed.' using errcode = 'P0001';
  end if;
  if length(v_msg) < 2 or length(v_msg) > 4000 then
    raise exception 'VALIDATION_ERROR: Write the response (up to 4000 characters).' using errcode = 'P0001';
  end if;
  v_to := case when coalesce(p_request_info, false) then 'AWAITING_EMPLOYEE' when r.status = 'NEW' then 'IN_PROGRESS' else r.status end;
  update public.employee_issues set status = v_to, hr_response = v_msg, hr_response_at = now(),
         assigned_hr_id = coalesce(assigned_hr_id, (select p.id from public.profiles p join public.departments d on d.id = p.department_id where p.id = auth.uid() and d.slug = 'hr')),
         resolved_at = case when v_to = 'RESOLVED' then resolved_at else null end
   where id = r.id returning * into r;
  perform private.case_event(r.id, null, 'HR', case when coalesce(p_request_info, false) then 'INFO_REQUESTED' else 'RESPONSE' end, 'EMPLOYEE', v_msg, v_from, v_to);
  perform private.write_audit('EMPLOYEE_ISSUE_RESPONDED', 'employee_issue', r.id, r.department_id, null,
    jsonb_build_object('reference', r.issue_reference, 'info_requested', coalesce(p_request_info, false), 'status', v_to));
  perform private.notify_once(r.employee_id, 'EMPLOYEE_ISSUE_UPDATED', 'Update on your issue ' || r.issue_reference,
    case when coalesce(p_request_info, false) then 'HR needs more information from you.' else 'HR sent you a response.' end || ' Status: ' || private.case_status_label(v_to),
    'employee_issue', r.id, jsonb_build_object('reference', r.issue_reference, 'status', v_to));
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
end $$;

-- an internal note: only HR ever reads it
create or replace function public.issue_hr_note(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issues := private.hr_issue_for_update(p_id);
  v_note text := btrim(coalesce(p_note, ''));
begin
  if length(v_note) < 2 or length(v_note) > 4000 then
    raise exception 'VALIDATION_ERROR: Write the note (up to 4000 characters).' using errcode = 'P0001';
  end if;
  perform private.case_event(r.id, null, 'HR', 'NOTE', 'HR', v_note);
  return jsonb_build_object('issue', private.issue_json(r, true), 'events', private.case_events_json(r.id, null, true), 'attachments', private.issue_attachments_json(r.id));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Meeting requests: the employee
-- ---------------------------------------------------------------------------
create or replace function public.meeting_submit(p_client_request uuid, p_subject text, p_category text, p_description text, p_date date, p_time text,
  p_mode text, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_meeting_requests;
  v_snap jsonb;
  v_subject text := btrim(coalesce(p_subject, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
  v_time time;
begin
  if p_client_request is null then
    raise exception 'VALIDATION_ERROR: Reload the page and try again.' using errcode = 'P0001';
  end if;
  select * into r from public.employee_meeting_requests where employee_id = me.id and client_request_id = p_client_request;
  if r.id is not null then
    return private.meeting_json(r, true, false) || jsonb_build_object('duplicate', true);
  end if;
  if length(v_subject) < 3 or length(v_subject) > 200 then
    raise exception 'VALIDATION_ERROR: Enter a meeting subject (3 to 200 characters).' using errcode = 'P0001';
  end if;
  if p_category is null or p_category not in ('HR_CONCERN', 'WORKPLACE_ISSUE', 'ATTENDANCE_LEAVE', 'SALARY_PAYROLL', 'MANAGEMENT', 'PERSONAL_CONFIDENTIAL', 'OTHER') then
    raise exception 'VALIDATION_ERROR: Choose a meeting category.' using errcode = 'P0001';
  end if;
  if length(v_desc) < 10 or length(v_desc) > 5000 then
    raise exception 'VALIDATION_ERROR: Describe the purpose of the meeting (10 to 5000 characters).' using errcode = 'P0001';
  end if;
  if p_date is null or p_date < current_date - 1 or p_date > current_date + 365 then
    raise exception 'VALIDATION_ERROR: Choose a preferred date from today to one year ahead.' using errcode = 'P0001';
  end if;
  begin
    v_time := p_time::time;
  exception when others then
    raise exception 'VALIDATION_ERROR: Choose a preferred time.' using errcode = 'P0001';
  end;
  if p_time is null or p_time !~ '^[0-2][0-9]:[0-5][0-9]' then
    raise exception 'VALIDATION_ERROR: Choose a preferred time.' using errcode = 'P0001';
  end if;
  if p_mode is null or p_mode not in ('IN_PERSON', 'ONLINE') then
    raise exception 'VALIDATION_ERROR: Choose In Person or Online.' using errcode = 'P0001';
  end if;
  if v_notes is not null and length(v_notes) > 2000 then
    raise exception 'VALIDATION_ERROR: The notes are too long (2000 characters at most).' using errcode = 'P0001';
  end if;
  if (select count(*) from public.employee_meeting_requests m where m.employee_id = me.id and m.created_at > now() - interval '1 day') >= 10 then
    raise exception 'VALIDATION_ERROR: You have made many meeting requests today. Please wait for HR to respond.' using errcode = 'P0001';
  end if;
  v_snap := private.employee_snapshot(me.id);
  begin
    insert into public.employee_meeting_requests (meeting_reference, client_request_id, employee_id, employee_name, employee_code, department_id, department_name, designation,
                                                  subject, category, description, preferred_date, preferred_time, meeting_mode, notes)
    values ('MTG-' || to_char(now() at time zone 'utc', 'YYYY') || '-' || lpad(nextval('public.employee_meeting_ref_seq')::text, 5, '0'),
            p_client_request, me.id, v_snap ->> 'name', v_snap ->> 'code', nullif(v_snap ->> 'departmentId', '')::uuid, v_snap ->> 'department', v_snap ->> 'designation',
            v_subject, p_category, v_desc, p_date, v_time, p_mode, v_notes)
    returning * into r;
  exception when unique_violation then
    select * into r from public.employee_meeting_requests where employee_id = me.id and client_request_id = p_client_request;
    return private.meeting_json(r, true, false) || jsonb_build_object('duplicate', true);
  end;
  perform private.case_event(null, r.id, 'EMPLOYEE', 'SUBMITTED', 'EMPLOYEE', null, null, 'PENDING');
  perform private.write_audit('EMPLOYEE_MEETING_REQUESTED', 'employee_meeting', r.id, r.department_id, null,
    jsonb_build_object('reference', r.meeting_reference, 'category', r.category, 'mode', r.meeting_mode));
  perform private.notify_hr('EMPLOYEE_MEETING_REQUESTED', 'New meeting request ' || r.meeting_reference,
    r.employee_name || ' · ' || private.meeting_category_label(r.category) || ' · ' || to_char(r.preferred_date, 'DD Mon YYYY') || ' ' || to_char(r.preferred_time, 'HH24:MI'),
    'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference));
  return private.meeting_json(r, true, false) || jsonb_build_object('duplicate', false);
end $$;

create or replace function public.meeting_my_list(p_status text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
begin
  return (
    with f as (
      select m.id, m.created_at from public.employee_meeting_requests m
       where m.employee_id = me.id and (p_status is null or p_status in ('', 'ALL') or m.status = p_status)),
    pg as (select id, created_at from f order by created_at desc, id desc limit v_limit offset v_off)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(private.meeting_json(m, false, false) order by m.created_at desc, m.id desc) from public.employee_meeting_requests m join pg on pg.id = m.id), '[]'::jsonb),
      'total', (select count(*) from f), 'limit', v_limit, 'offset', v_off));
end $$;

create or replace function public.meeting_my_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_meeting_requests;
begin
  select * into r from public.employee_meeting_requests where id = p_id and employee_id = me.id;
  if r.id is null then
    raise exception 'NOT_FOUND: Meeting request not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('meeting', private.meeting_json(r, true, false), 'events', private.case_events_json(null, r.id, false));
end $$;

-- the employee withdraws their own request (or cancels a meeting that was scheduled)
create or replace function public.meeting_my_cancel(p_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_meeting_requests;
  v_from text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  select * into r from public.employee_meeting_requests where id = p_id and employee_id = me.id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Meeting request not found.' using errcode = 'P0001';
  end if;
  if r.status not in ('PENDING', 'ALTERNATIVE_PROPOSED', 'SCHEDULED') then
    raise exception 'CONFLICT: This meeting request can no longer be cancelled.' using errcode = 'P0001';
  end if;
  if v_reason is not null and length(v_reason) > 2000 then
    raise exception 'VALIDATION_ERROR: The reason is too long (2000 characters at most).' using errcode = 'P0001';
  end if;
  v_from := r.status;
  update public.employee_meeting_requests set status = 'CANCELLED', decline_or_reschedule_reason = v_reason, proposed_date = null, proposed_time = null where id = r.id returning * into r;
  perform private.case_event(null, r.id, 'EMPLOYEE', 'CANCELLED', 'EMPLOYEE', v_reason, v_from, 'CANCELLED');
  perform private.write_audit('EMPLOYEE_MEETING_CANCELLED', 'employee_meeting', r.id, r.department_id, null, jsonb_build_object('reference', r.meeting_reference, 'by', 'employee', 'from', v_from));
  perform private.notify_hr('EMPLOYEE_MEETING_REPLY', 'Meeting ' || r.meeting_reference || ' cancelled by the employee', r.employee_name || ' cancelled the request.',
    'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference), 'normal', r.assigned_hr_id);
  return jsonb_build_object('meeting', private.meeting_json(r, true, false), 'events', private.case_events_json(null, r.id, false));
end $$;

-- the employee accepts or turns down the other time HR proposed
create or replace function public.meeting_respond_alternative(p_id uuid, p_accept boolean, p_message text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  r public.employee_meeting_requests;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
begin
  select * into r from public.employee_meeting_requests where id = p_id and employee_id = me.id for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Meeting request not found.' using errcode = 'P0001';
  end if;
  if r.status <> 'ALTERNATIVE_PROPOSED' then
    raise exception 'CONFLICT: There is no proposed time to answer.' using errcode = 'P0001';
  end if;
  if v_msg is not null and length(v_msg) > 2000 then
    raise exception 'VALIDATION_ERROR: The message is too long (2000 characters at most).' using errcode = 'P0001';
  end if;
  if coalesce(p_accept, false) then
    update public.employee_meeting_requests set status = 'SCHEDULED', confirmed_date = proposed_date, confirmed_time = proposed_time,
           confirmed_mode = coalesce(confirmed_mode, meeting_mode), proposed_date = null, proposed_time = null where id = r.id returning * into r;
    perform private.case_event(null, r.id, 'EMPLOYEE', 'ALTERNATIVE_ACCEPTED', 'EMPLOYEE', v_msg, 'ALTERNATIVE_PROPOSED', 'SCHEDULED');
    perform private.notify_hr('EMPLOYEE_MEETING_REPLY', 'Meeting ' || r.meeting_reference || ' confirmed', r.employee_name || ' accepted ' || to_char(r.confirmed_date, 'DD Mon YYYY') || ' ' || to_char(r.confirmed_time, 'HH24:MI') || '.',
      'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference), 'normal', r.assigned_hr_id);
  else
    update public.employee_meeting_requests set status = 'PENDING', proposed_date = null, proposed_time = null where id = r.id returning * into r;
    perform private.case_event(null, r.id, 'EMPLOYEE', 'ALTERNATIVE_DECLINED', 'EMPLOYEE', v_msg, 'ALTERNATIVE_PROPOSED', 'PENDING');
    perform private.notify_hr('EMPLOYEE_MEETING_REPLY', 'Meeting ' || r.meeting_reference || ': proposed time declined', r.employee_name || ' cannot make the proposed time.',
      'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference), 'normal', r.assigned_hr_id);
  end if;
  perform private.write_audit('EMPLOYEE_MEETING_ALTERNATIVE_ANSWERED', 'employee_meeting', r.id, r.department_id, null,
    jsonb_build_object('reference', r.meeting_reference, 'accepted', coalesce(p_accept, false)));
  return jsonb_build_object('meeting', private.meeting_json(r, true, false), 'events', private.case_events_json(null, r.id, false));
end $$;

-- ---------------------------------------------------------------------------
-- 7. Meeting requests: HR
-- ---------------------------------------------------------------------------
create or replace function public.meeting_hr_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_hr();
  return (select jsonb_build_object(
    'total', count(*), 'pending', count(*) filter (where status in ('PENDING', 'ALTERNATIVE_PROPOSED')), 'scheduled', count(*) filter (where status = 'SCHEDULED'),
    'completed', count(*) filter (where status = 'COMPLETED'), 'declinedOrCancelled', count(*) filter (where status in ('DECLINED', 'CANCELLED')))
    from public.employee_meeting_requests where employee_id <> auth.uid());
end $$;

create or replace function public.meeting_hr_list(p_status text default null, p_department uuid default null, p_category text default null, p_assignee uuid default null,
  p_unassigned boolean default false, p_from date default null, p_to date default null, p_search text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_off integer := greatest(coalesce(p_offset, 0), 0);
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  perform private.require_hr();
  return (
    with f as (
      select m.id, m.created_at from public.employee_meeting_requests m
       where m.employee_id <> auth.uid()
         and (p_status is null or p_status in ('', 'ALL')
              or (p_status = 'PENDING' and m.status in ('PENDING', 'ALTERNATIVE_PROPOSED')) or (p_status <> 'PENDING' and m.status = p_status))
         and (p_department is null or m.department_id = p_department)
         and (p_category is null or p_category in ('', 'ALL') or m.category = p_category)
         and (p_assignee is null or m.assigned_hr_id = p_assignee)
         and (not coalesce(p_unassigned, false) or m.assigned_hr_id is null)
         and (p_from is null or coalesce(m.confirmed_date, m.preferred_date) >= p_from) and (p_to is null or coalesce(m.confirmed_date, m.preferred_date) <= p_to)
         and (v_q is null or m.employee_name ilike '%' || private.like_escape(v_q) || '%' or m.meeting_reference ilike '%' || private.like_escape(v_q) || '%'
              or m.subject ilike '%' || private.like_escape(v_q) || '%')),
    pg as (select id, created_at from f order by created_at desc, id desc limit v_limit offset v_off)
    select jsonb_build_object(
      'items', coalesce((select jsonb_agg(private.meeting_json(m, false, true) order by m.created_at desc, m.id desc) from public.employee_meeting_requests m join pg on pg.id = m.id), '[]'::jsonb),
      'total', (select count(*) from f), 'limit', v_limit, 'offset', v_off));
end $$;

create or replace function public.meeting_hr_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.employee_meeting_requests;
begin
  perform private.require_hr();
  select * into r from public.employee_meeting_requests where id = p_id and employee_id <> auth.uid();
  if r.id is null then
    raise exception 'NOT_FOUND: Meeting request not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('meeting', private.meeting_json(r, true, true), 'events', private.case_events_json(null, r.id, true));
end $$;

create or replace function private.hr_meeting_for_update(p_id uuid)
returns public.employee_meeting_requests language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_meeting_requests;
begin
  perform private.require_hr();
  select * into r from public.employee_meeting_requests where id = p_id and employee_id <> auth.uid() for update;
  if r.id is null then
    raise exception 'NOT_FOUND: Meeting request not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.meeting_hr_assign(p_id uuid, p_hr uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_meeting_requests := private.hr_meeting_for_update(p_id);
  v_name text;
begin
  if r.status in ('DECLINED', 'CANCELLED', 'COMPLETED') then
    raise exception 'CONFLICT: This meeting request is already %.', lower(private.case_status_label(r.status)) using errcode = 'P0001';
  end if;
  if p_hr is not null then
    select p.full_name into v_name from public.profiles p join public.departments d on d.id = p.department_id
     where p.id = p_hr and p.status = 'ACTIVE' and d.slug = 'hr' and p.id <> r.employee_id;
    if v_name is null then
      raise exception 'VALIDATION_ERROR: Choose a person from the HR team.' using errcode = 'P0001';
    end if;
  end if;
  if r.assigned_hr_id is not distinct from p_hr then
    return jsonb_build_object('meeting', private.meeting_json(r, true, true), 'events', private.case_events_json(null, r.id, true));
  end if;
  update public.employee_meeting_requests set assigned_hr_id = p_hr where id = r.id returning * into r;
  perform private.case_event(null, r.id, 'HR', 'ASSIGNED', 'EMPLOYEE', case when p_hr is null then 'No HR representative is assigned.' else 'HR representative: ' || v_name || '.' end,
    r.status, r.status, jsonb_build_object('assignedTo', p_hr));
  perform private.write_audit('EMPLOYEE_MEETING_ASSIGNED', 'employee_meeting', r.id, r.department_id, null, jsonb_build_object('reference', r.meeting_reference, 'assigned_to', p_hr));
  if p_hr is not null then
    perform private.notify_once(r.employee_id, 'EMPLOYEE_MEETING_UPDATED', 'Update on your meeting request ' || r.meeting_reference, 'HR representative: ' || v_name || '.',
      'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference, 'status', r.status));
    perform private.notify_once(p_hr, 'EMPLOYEE_MEETING_ASSIGNED', 'Meeting request assigned to you: ' || r.meeting_reference,
      r.employee_name || ' · ' || private.meeting_category_label(r.category), 'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference));
  end if;
  return jsonb_build_object('meeting', private.meeting_json(r, true, true), 'events', private.case_events_json(null, r.id, true));
end $$;

create or replace function public.meeting_hr_note(p_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_meeting_requests := private.hr_meeting_for_update(p_id);
  v_note text := btrim(coalesce(p_note, ''));
begin
  if length(v_note) < 2 or length(v_note) > 4000 then
    raise exception 'VALIDATION_ERROR: Write the note (up to 4000 characters).' using errcode = 'P0001';
  end if;
  perform private.case_event(null, r.id, 'HR', 'NOTE', 'HR', v_note);
  return jsonb_build_object('meeting', private.meeting_json(r, true, true), 'events', private.case_events_json(null, r.id, true));
end $$;

-- HR's decision on a meeting request. p_action:
--   APPROVE        confirm the meeting (date and time required; mode, location, link and instructions optional)
--   DECLINE        decline the request (a reason the employee reads is required)
--   PROPOSE        suggest another date and time (the employee accepts or answers)
--   RESCHEDULE     move a scheduled meeting (new date and time and a reason required)
--   CANCEL         cancel a request or a scheduled meeting (a reason is required)
--   COMPLETE       mark a scheduled meeting as held (the outcome and follow-up actions stay with HR)
create or replace function public.meeting_hr_decide(p_id uuid, p_action text, p_date date default null, p_time text default null, p_mode text default null,
  p_location text default null, p_link text default null, p_instructions text default null, p_message text default null, p_reason text default null,
  p_outcome text default null, p_follow_up text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_meeting_requests := private.hr_meeting_for_update(p_id);
  v_from text := r.status;
  v_time time;
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_loc text := nullif(btrim(coalesce(p_location, '')), '');
  v_link text := nullif(btrim(coalesce(p_link, '')), '');
  v_ins text := nullif(btrim(coalesce(p_instructions, '')), '');
  v_mode text := coalesce(nullif(p_mode, ''), r.confirmed_mode, r.meeting_mode);
  v_title text;
  v_note text;
  v_kind text;
  v_to text;
begin
  if p_action is null or p_action not in ('APPROVE', 'DECLINE', 'PROPOSE', 'RESCHEDULE', 'CANCEL', 'COMPLETE') then
    raise exception 'VALIDATION_ERROR: Choose what to do with this request.' using errcode = 'P0001';
  end if;
  if r.status in ('DECLINED', 'CANCELLED', 'COMPLETED') then
    raise exception 'CONFLICT: This meeting request is already %.', lower(private.case_status_label(r.status)) using errcode = 'P0001';
  end if;
  if v_mode not in ('IN_PERSON', 'ONLINE') then
    raise exception 'VALIDATION_ERROR: Choose In Person or Online.' using errcode = 'P0001';
  end if;
  if v_link is not null and (v_link !~ '^https://[^[:space:]]+$' or length(v_link) > 500) then
    raise exception 'VALIDATION_ERROR: The meeting link must start with https://' using errcode = 'P0001';
  end if;
  if (v_msg is not null and length(v_msg) > 4000) or (v_reason is not null and length(v_reason) > 2000) or (v_loc is not null and length(v_loc) > 300)
     or (v_ins is not null and length(v_ins) > 2000) or length(coalesce(p_outcome, '')) > 4000 or length(coalesce(p_follow_up, '')) > 4000 then
    raise exception 'VALIDATION_ERROR: One of the texts is too long.' using errcode = 'P0001';
  end if;

  if p_action in ('APPROVE', 'PROPOSE', 'RESCHEDULE') then
    if p_date is null or p_time is null or p_time !~ '^[0-2][0-9]:[0-5][0-9]' then
      raise exception 'VALIDATION_ERROR: Choose the meeting date and time.' using errcode = 'P0001';
    end if;
    begin
      v_time := p_time::time;
    exception when others then
      raise exception 'VALIDATION_ERROR: Choose the meeting date and time.' using errcode = 'P0001';
    end;
    if p_date < current_date - 1 or p_date > current_date + 730 then
      raise exception 'VALIDATION_ERROR: Choose a meeting date from today to two years ahead.' using errcode = 'P0001';
    end if;
  end if;

  if p_action = 'APPROVE' then
    if r.status not in ('PENDING', 'ALTERNATIVE_PROPOSED') then
      raise exception 'CONFLICT: Only a pending request can be approved. Use Reschedule for a scheduled meeting.' using errcode = 'P0001';
    end if;
    update public.employee_meeting_requests set status = 'SCHEDULED', confirmed_date = p_date, confirmed_time = v_time, confirmed_mode = v_mode,
           meeting_location = v_loc, meeting_link = v_link, instructions = v_ins, proposed_date = null, proposed_time = null, decline_or_reschedule_reason = null,
           hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end,
           assigned_hr_id = coalesce(assigned_hr_id, (select p.id from public.profiles p join public.departments d on d.id = p.department_id where p.id = auth.uid() and d.slug = 'hr'))
     where id = r.id returning * into r;
    v_kind := 'APPROVED'; v_to := 'SCHEDULED'; v_title := 'Your meeting is scheduled';
    v_note := to_char(r.confirmed_date, 'DD Mon YYYY') || ' at ' || to_char(r.confirmed_time, 'HH24:MI') || ' (' || case v_mode when 'ONLINE' then 'online' else 'in person' end || ')';
  elsif p_action = 'DECLINE' then
    if r.status not in ('PENDING', 'ALTERNATIVE_PROPOSED') then
      raise exception 'CONFLICT: Only a pending request can be declined. Use Cancel for a scheduled meeting.' using errcode = 'P0001';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'VALIDATION_ERROR: Give a reason for declining (the employee will read it).' using errcode = 'P0001';
    end if;
    update public.employee_meeting_requests set status = 'DECLINED', decline_or_reschedule_reason = v_reason, proposed_date = null, proposed_time = null,
           hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end
     where id = r.id returning * into r;
    v_kind := 'DECLINED'; v_to := 'DECLINED'; v_title := 'Your meeting request was declined'; v_note := v_reason;
  elsif p_action = 'PROPOSE' then
    if r.status not in ('PENDING', 'ALTERNATIVE_PROPOSED') then
      raise exception 'CONFLICT: Another time can only be proposed for a pending request.' using errcode = 'P0001';
    end if;
    update public.employee_meeting_requests set status = 'ALTERNATIVE_PROPOSED', proposed_date = p_date, proposed_time = v_time, confirmed_mode = v_mode,
           meeting_location = v_loc, meeting_link = v_link, instructions = v_ins, decline_or_reschedule_reason = v_reason,
           hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end
     where id = r.id returning * into r;
    v_kind := 'ALTERNATIVE_PROPOSED'; v_to := 'ALTERNATIVE_PROPOSED'; v_title := 'Another meeting time was proposed';
    v_note := to_char(r.proposed_date, 'DD Mon YYYY') || ' at ' || to_char(r.proposed_time, 'HH24:MI');
  elsif p_action = 'RESCHEDULE' then
    if r.status <> 'SCHEDULED' then
      raise exception 'CONFLICT: Only a scheduled meeting can be rescheduled.' using errcode = 'P0001';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'VALIDATION_ERROR: Give a reason for rescheduling (the employee will read it).' using errcode = 'P0001';
    end if;
    update public.employee_meeting_requests set confirmed_date = p_date, confirmed_time = v_time, confirmed_mode = v_mode,
           meeting_location = coalesce(v_loc, meeting_location), meeting_link = coalesce(v_link, meeting_link), instructions = coalesce(v_ins, instructions),
           decline_or_reschedule_reason = v_reason, hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end
     where id = r.id returning * into r;
    v_kind := 'RESCHEDULED'; v_to := 'SCHEDULED'; v_title := 'Your meeting was rescheduled';
    v_note := to_char(r.confirmed_date, 'DD Mon YYYY') || ' at ' || to_char(r.confirmed_time, 'HH24:MI');
  elsif p_action = 'CANCEL' then
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'VALIDATION_ERROR: Give a reason for cancelling (the employee will read it).' using errcode = 'P0001';
    end if;
    update public.employee_meeting_requests set status = 'CANCELLED', decline_or_reschedule_reason = v_reason, proposed_date = null, proposed_time = null,
           hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end
     where id = r.id returning * into r;
    v_kind := 'CANCELLED'; v_to := 'CANCELLED'; v_title := 'Your meeting was cancelled'; v_note := v_reason;
  else
    if r.status <> 'SCHEDULED' then
      raise exception 'CONFLICT: Only a scheduled meeting can be marked as completed.' using errcode = 'P0001';
    end if;
    update public.employee_meeting_requests set status = 'COMPLETED', completed_at = now(), meeting_outcome = nullif(btrim(coalesce(p_outcome, '')), ''),
           follow_up_actions = nullif(btrim(coalesce(p_follow_up, '')), ''),
           hr_response = coalesce(v_msg, hr_response), hr_response_at = case when v_msg is not null then now() else hr_response_at end
     where id = r.id returning * into r;
    v_kind := 'COMPLETED'; v_to := 'COMPLETED'; v_title := 'Your meeting was marked as completed'; v_note := null;
  end if;

  -- the employee reads the reason / message; the outcome and follow-up stay in the HR-only record
  perform private.case_event(null, r.id, 'HR', v_kind, 'EMPLOYEE',
    case when p_action = 'COMPLETE' then v_msg when p_action in ('DECLINE', 'CANCEL', 'RESCHEDULE') then concat_ws(E'\n', v_reason, v_msg) else v_msg end,
    v_from, v_to,
    case when p_action in ('APPROVE', 'RESCHEDULE') then jsonb_build_object('date', r.confirmed_date, 'time', to_char(r.confirmed_time, 'HH24:MI'))
         when p_action = 'PROPOSE' then jsonb_build_object('date', r.proposed_date, 'time', to_char(r.proposed_time, 'HH24:MI')) else '{}'::jsonb end);
  if p_action = 'COMPLETE' and (nullif(btrim(coalesce(p_outcome, '')), '') is not null or nullif(btrim(coalesce(p_follow_up, '')), '') is not null) then
    perform private.case_event(null, r.id, 'HR', 'NOTE', 'HR', concat_ws(E'\n', 'Outcome: ' || nullif(btrim(coalesce(p_outcome, '')), ''), 'Follow-up: ' || nullif(btrim(coalesce(p_follow_up, '')), '')));
  end if;
  perform private.write_audit('EMPLOYEE_MEETING_' || p_action, 'employee_meeting', r.id, r.department_id, null,
    jsonb_build_object('reference', r.meeting_reference, 'from', v_from, 'to', v_to));
  perform private.notify_once(r.employee_id, 'EMPLOYEE_MEETING_UPDATED', v_title || ': ' || r.meeting_reference, coalesce(v_note, 'Status: ' || private.case_status_label(v_to)),
    'employee_meeting', r.id, jsonb_build_object('reference', r.meeting_reference, 'status', v_to));
  return jsonb_build_object('meeting', private.meeting_json(r, true, true), 'events', private.case_events_json(null, r.id, true));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Attachments (issues): book, finish, abort, download
-- ---------------------------------------------------------------------------
create or replace function public.issue_begin_upload(p_file_name text, p_mime text, p_size bigint)
returns public.employee_issue_attachments language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles := private.require_employee();
  v_id uuid := gen_random_uuid();
  v_name text := btrim(coalesce(p_file_name, ''));
  r public.employee_issue_attachments;
begin
  if length(v_name) < 1 or length(v_name) > 200 then
    raise exception 'VALIDATION_ERROR: The file needs a name (up to 200 characters).' using errcode = 'P0001';
  end if;
  if p_mime is null or p_mime not in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'text/csv',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
    raise exception 'VALIDATION_ERROR: This file type cannot be attached. Use an image, PDF, text, CSV, Word or Excel file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.employee_issue_attachments set status = 'FAILED' where uploader_id = me.id and status = 'PENDING' and created_at < now() - interval '1 day';
  if (select count(*) from public.employee_issue_attachments a where a.uploader_id = me.id and a.status = 'PENDING' and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'VALIDATION_ERROR: Too many uploads in progress. Wait a moment and try again.' using errcode = 'P0001';
  end if;
  insert into public.employee_issue_attachments (id, uploader_id, file_name, mime_type, size_bytes, storage_path)
  values (v_id, me.id, v_name, p_mime, p_size, format('%s/%s/%s', me.id, v_id, private.chat_clean_name(v_name)))
  returning * into r;
  return r;
end $$;

create or replace function private.issue_own_pending(p_attachment uuid)
returns public.employee_issue_attachments language plpgsql stable security definer set search_path = '' as $$
declare
  r public.employee_issue_attachments;
begin
  select * into r from public.employee_issue_attachments a where a.id = p_attachment and a.status = 'PENDING' and a.uploader_id = auth.uid();
  if r.id is null then
    raise exception 'NOT_FOUND: Upload not found.' using errcode = 'P0001';
  end if;
  return r;
end $$;

create or replace function public.issue_pending_upload(p_attachment uuid)
returns public.employee_issue_attachments language sql stable security definer set search_path = '' as $$
  select * from private.issue_own_pending(p_attachment)
$$;

create or replace function public.issue_complete_upload(p_attachment uuid, p_size bigint, p_etag text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issue_attachments;
begin
  r := private.issue_own_pending(p_attachment);
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: Files can be at most 5 MB.' using errcode = 'P0001';
  end if;
  update public.employee_issue_attachments set status = 'READY', size_bytes = p_size, storage_etag = coalesce(p_etag, storage_etag) where id = r.id returning * into r;
  return jsonb_build_object('id', r.id, 'name', r.file_name, 'mime', r.mime_type, 'size', r.size_bytes);
end $$;

create or replace function public.issue_abort_upload(p_attachment uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.employee_issue_attachments a set status = 'FAILED' where a.id = p_attachment and a.status = 'PENDING' and a.uploader_id = auth.uid();
end $$;

-- one file's download: the employee who owns the issue (or who uploaded a file not attached yet), or HR; checked again every time
create or replace function public.issue_attachment_download(p_attachment uuid)
returns public.employee_issue_attachments language plpgsql security definer set search_path = '' as $$
declare
  r public.employee_issue_attachments;
  i public.employee_issues;
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in again.' using errcode = '42501';
  end if;
  select * into r from public.employee_issue_attachments a where a.id = p_attachment and a.status = 'READY';
  if r.id is null then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  if r.issue_id is null then
    if r.uploader_id <> auth.uid() then
      raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
    end if;
    return r;
  end if;
  select * into i from public.employee_issues where id = r.issue_id;
  if not (i.employee_id = auth.uid() or (private.is_hr_staff() and i.employee_id <> auth.uid())) then
    raise exception 'NOT_FOUND: File not found.' using errcode = 'P0001';
  end if;
  perform private.write_audit('EMPLOYEE_ISSUE_ATTACHMENT_DOWNLOADED', 'employee_issue', i.id, i.department_id, null,
    jsonb_build_object('attachment_id', r.id, 'reference', i.issue_reference));
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 9. Who can call what
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  -- the private helpers are only ever called from the functions above
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('employee_code_of', 'issue_category_label', 'meeting_category_label', 'case_status_label', 'require_employee', 'require_hr',
              'employee_snapshot', 'notify_once', 'notify_hr', 'case_event', 'issue_json', 'meeting_json', 'case_events_json', 'issue_attachments_json', 'issue_attach',
              'like_escape', 'hr_issue_for_update', 'hr_meeting_for_update', 'issue_own_pending') loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('issue_submit', 'issue_my_details', 'issue_my_list', 'issue_my_detail', 'issue_employee_reply', 'issue_hr_assignees', 'issue_hr_departments',
              'issue_hr_overview', 'issue_hr_list', 'issue_hr_detail', 'issue_hr_assign', 'issue_hr_set_status', 'issue_hr_respond', 'issue_hr_note',
              'meeting_submit', 'meeting_my_list', 'meeting_my_detail', 'meeting_my_cancel', 'meeting_respond_alternative', 'meeting_hr_overview', 'meeting_hr_list',
              'meeting_hr_detail', 'meeting_hr_assign', 'meeting_hr_note', 'meeting_hr_decide', 'issue_begin_upload', 'issue_pending_upload', 'issue_complete_upload',
              'issue_abort_upload', 'issue_attachment_download') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
