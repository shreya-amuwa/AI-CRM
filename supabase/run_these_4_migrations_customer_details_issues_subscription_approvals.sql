-- =============================================================================
-- The 4 migrations added by the other work on this branch after the "6 migrations" file, in order:
--   1. 20261209000700_accounts_customer_details.sql          Accounts payments and scoped customer-profile editing
--   2. 20261210000100_employee_issues_meetings.sql           employee issues and HR meeting requests
--   3. 20261210000200_subscription_activation.sql            subscription activation
--   4. 20261211000100_employee_approval_hierarchy.sql        employee approvals, Operations Heads page (operations_heads_list ...)
-- Without #4 the Super Admin's "Operations Heads" page shows "This feature needs a database update that has not been applied yet".
-- Paste the whole file into the Supabase SQL editor and run it once. Every part is safe to run again; nothing is sent.
-- Needs the earlier migrations in place (including run_these_6_migrations_accounts_finance_panel_url_handover.sql).
-- =============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261209000700_accounts_customer_details.sql
-- Narrow Accounts profile correction RPC; no new table grants or financial writes.
create or replace function public.accounts_customer_details(p_customer uuid, p_patch jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  v jsonb;
  k text;
begin
  perform private.require_accounts_staff();
  select * into c from public.customers where id = p_customer for update;
  if c.id is null or not private.accounts_can_view(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.';
  end if;
  if p_patch is not null then
    if jsonb_typeof(p_patch) <> 'object' or exists (
      select 1 from jsonb_object_keys(p_patch) x where x not in ('name','company','phone','whatsapp','email','city','address','businessCategory')) then
      raise exception 'VALIDATION_ERROR: Only customer profile fields may be edited.';
    end if;
    foreach k in array array['name','company','phone'] loop
      if nullif(btrim(p_patch->>k), '') is null then
        raise exception 'VALIDATION_ERROR: Name, business name and mobile are required.';
      end if;
    end loop;
    for k in select jsonb_object_keys(p_patch) loop
      if jsonb_typeof(p_patch->k) not in ('string','null') or length(p_patch->>k) > (case when k = 'address' then 500 when k in ('city','businessCategory') then 120 else 200 end) then
        raise exception 'VALIDATION_ERROR: Invalid profile field.';
      end if;
    end loop;
    foreach k in array array['phone','whatsapp'] loop
      if nullif(p_patch->>k,'') is not null and regexp_replace(p_patch->>k, '[^0-9]', '', 'g') !~ '^([6-9][0-9]{9}|91[6-9][0-9]{9}|0[6-9][0-9]{9})$' then
        raise exception 'VALIDATION_ERROR: Enter a valid mobile number.';
      end if;
    end loop;
    -- Reuse the established pre-login correction guard, including provisioning races.
    -- Linked authentication emails must be changed through the authentication workflow.
    if lower(coalesce(p_patch->>'email','')) is distinct from lower(coalesce(c.email,'')) then
      perform public.accounts_set_customer_email(p_customer, p_patch->>'email', 'Accounts customer details correction');
    end if;
    update public.customers set name = btrim(p_patch->>'name'), company = btrim(p_patch->>'company'),
      phone = btrim(p_patch->>'phone'), whatsapp = nullif(btrim(p_patch->>'whatsapp'),''),
      city = nullif(btrim(p_patch->>'city'),''), address = nullif(btrim(p_patch->>'address'),''),
      business_category = nullif(btrim(p_patch->>'businessCategory'),'')
      where id = p_customer;
    -- Existing customer triggers audit actor, timestamp and before/after values.
    select * into c from public.customers where id = p_customer;
  end if;
  return jsonb_build_object('name',c.name,'company',c.company,'phone',c.phone,'whatsapp',c.whatsapp,
    'email',c.email,'city',c.city,'address',c.address,'businessCategory',c.business_category,
    'hasClientLogin', exists(select 1 from public.customer_client_accounts where customer_id = p_customer));
end $$;
revoke all on function public.accounts_customer_details(uuid,jsonb) from public, anon;
grant execute on function public.accounts_customer_details(uuid,jsonb) to authenticated;
notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261210000100_employee_issues_meetings.sql
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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261210000200_subscription_activation.sql
-- =============================================================================
-- Subscription duration, activation and expiry.
--
--   Sales picks the plan and the DURATION (1 / 2 / 3 / 6 months, 1 / 2 years, or a custom number of months or days), the amount and the message
--   credits. Sales never sets a start or an expiry date. The subscription STARTS when the team confirms that the panel was created and activated:
--   the person who confirms records the actual activation date, the panel creation date and (automatically) who did it, and the database
--   calculates the expiry date from the stored duration (calendar months and years, month ends and leap years included).
--
--   Sales  -> set_subscription_terms          plan, duration, amount, message credits (while nothing has started)
--   Team   -> confirm_subscription_activation the same prerequisites as "service ready" (payment confirmed, Meta verification, Relationship Manager,
--                                             authorized documents, login) + the dates. A second request changes nothing.
--   Heads  -> correct_subscription_dates      Super Admin / Department Head / support Team Head, a reason is required, old and new dates are kept
--   Team   -> confirm_subscription_renewal    needs a VERIFIED payment of this customer; the old cycle is kept (ENDED), a new cycle starts
--                                             (continuing from the old expiry while it is still running, or from the confirmed date once it has lapsed)
--   Team   -> resend_activation_email         the panel activation e-mail is queued once when the subscription starts; this retries or repeats it
--
-- Reused, not duplicated: customer_services (started_on = the activation date, renews_on = the expiry date, plan_name, price, platform,
-- panel_url), the service-setup rules of the onboarding journey, the e-mail outbox (automation_jobs), the expiry reminders (they already follow
-- customer_services.renews_on and one event per expiry date, stage and channel), client_notifications and the audit log.
-- New: subscription_cycles (every cycle kept), subscription_history (append-only), usage_alert_settings / usage_alert_log (70/80/90/100 %).
--
-- Direct writes of these columns by a signed-in user are refused by a trigger (only the functions above write them). Existing customers and
-- services keep working: a service with no duration behaves exactly as before.
-- Run after 20261209000600_department_head_handover_queue.sql. Safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.customer_services
  add column if not exists duration_code text,
  add column if not exists duration_months integer,
  add column if not exists duration_days integer,
  add column if not exists message_credits bigint,
  add column if not exists panel_created_on date,
  add column if not exists activated_by uuid references public.profiles (id) on delete set null,
  add column if not exists activation_confirmed_at timestamptz,
  add column if not exists subscription_cycle integer not null default 0;

alter table public.customer_services drop constraint if exists customer_services_duration_check;
alter table public.customer_services add constraint customer_services_duration_check check (
  (duration_code is null and duration_months is null and duration_days is null)
  or (duration_code in ('1M', '2M', '3M', '6M', '1Y', '2Y') and duration_months is not null and duration_days is null)
  or (duration_code = 'CUSTOM' and (duration_months is null) <> (duration_days is null)));
alter table public.customer_services drop constraint if exists customer_services_duration_range_check;
alter table public.customer_services add constraint customer_services_duration_range_check check (
  (duration_months is null or duration_months between 1 and 120) and (duration_days is null or duration_days between 1 and 3650));
alter table public.customer_services drop constraint if exists customer_services_message_credits_check;
alter table public.customer_services add constraint customer_services_message_credits_check check (message_credits is null or message_credits >= 0);
alter table public.customer_services drop constraint if exists customer_services_cycle_check;
alter table public.customer_services add constraint customer_services_cycle_check check (subscription_cycle >= 0);
alter table public.customer_services drop constraint if exists customer_services_dates_order_check;
alter table public.customer_services add constraint customer_services_dates_order_check check (
  panel_created_on is null or started_on is null or panel_created_on <= started_on);

-- Every cycle of a subscription, kept: the first activation and every renewal.
create table if not exists public.subscription_cycles (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null references public.crm_services (code) on delete restrict,
  cycle_no integer not null check (cycle_no >= 1),
  kind text not null check (kind in ('INITIAL', 'RENEWAL')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ENDED')),
  plan_name text check (length(plan_name) <= 120),
  price numeric(14,2) check (price >= 0),
  duration_code text not null,
  duration_months integer,
  duration_days integer,
  message_credits bigint check (message_credits >= 0),
  panel_created_on date,
  started_on date not null,
  expires_on date not null,
  activated_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  -- (deleting a customer deletes its payments first: the cycle keeps its dates, only the link to the payment goes)
  payment_id uuid references public.customer_payments (id) on delete set null,
  ended_at timestamptz,
  primary key (customer_id, service_code, cycle_no),
  check (expires_on > started_on)
);
do $$
declare
  v text;
begin
  select conname into v from pg_constraint where conrelid = 'public.subscription_cycles'::regclass and contype = 'f'
     and confrelid = 'public.customer_payments'::regclass;
  if v is not null and not exists (select 1 from pg_constraint where conname = v and confdeltype = 'n') then
    execute format('alter table public.subscription_cycles drop constraint %I', v);
    alter table public.subscription_cycles add constraint subscription_cycles_payment_id_fkey foreign key (payment_id) references public.customer_payments (id) on delete set null;
  end if;
end $$;
create unique index if not exists subscription_cycles_payment_key on public.subscription_cycles (payment_id) where payment_id is not null;
create unique index if not exists subscription_cycles_one_active_key on public.subscription_cycles (customer_id, service_code) where status = 'ACTIVE';
alter table public.subscription_cycles enable row level security;
revoke all on public.subscription_cycles from public, anon, authenticated;

-- What was changed, by whom, with the old and new values (append-only).
create table if not exists public.subscription_history (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null,
  cycle_no integer,
  action text not null check (action in ('TERMS_SET', 'ACTIVATED', 'DATES_CORRECTED', 'RENEWED', 'EMAIL_RESENT')),
  old_values jsonb,
  new_values jsonb,
  reason text check (length(reason) <= 500),
  actor_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists subscription_history_customer_idx on public.subscription_history (customer_id, created_at desc);
alter table public.subscription_history enable row level security;
revoke all on public.subscription_history from public, anon, authenticated;

create or replace function private.tg_subscription_history_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- a customer that is deleted takes its history with it (a cascade runs inside the delete of the customer); nobody edits or removes a line directly
  if pg_trigger_depth() > 1 then
    return coalesce(old, new);
  end if;
  raise exception 'The subscription history is append-only.' using errcode = '42501';
end $$;
revoke all on function private.tg_subscription_history_append_only() from public, anon, authenticated;
drop trigger if exists subscription_history_append_only on public.subscription_history;
create trigger subscription_history_append_only before update or delete on public.subscription_history
  for each row execute function private.tg_subscription_history_append_only();

-- the panel activation e-mail is its own job kind
alter table public.automation_jobs drop constraint if exists automation_jobs_stage_check;
alter table public.automation_jobs add constraint automation_jobs_stage_check
  check (stage in ('WEBSITE_PENDING', 'UNDER_REVIEW', 'META_VERIFICATION', 'COMPLETED', 'WEBSITE_READY', 'ACCOUNTS_PAYMENT', 'ACCOUNT_CREATED', 'PANEL_CREDENTIALS',
                   'PANEL_LINK', 'SUBSCRIPTION_ACTIVATED'));

-- ---------------------------------------------------------------------------
-- 2. Nobody writes these columns directly (Sales or anyone else signed in): only the functions below do
-- ---------------------------------------------------------------------------
create or replace function private.tg_customer_services_protect_subscription()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- A signed-in user's own statement (current_user stays 'authenticated'); the security-definer functions run as their owner and pass.
  if current_user not in ('authenticated', 'anon') then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- (deleting the whole customer cascades to its services: that is the delete-customer function's business, not a user removing a service)
    if pg_trigger_depth() = 1 and (old.started_on is not null or old.subscription_cycle > 0) then
      raise exception 'CONFLICT: This subscription has started; the service cannot be removed from the customer.' using errcode = 'P0001';
    end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.started_on is not null or new.renews_on is not null or new.activated_at is not null or new.panel_created_on is not null
       or new.activated_by is not null or new.activation_confirmed_at is not null or new.duration_code is not null
       or new.duration_months is not null or new.duration_days is not null or new.message_credits is not null or new.subscription_cycle <> 0 then
      raise exception 'FORBIDDEN: Subscription dates and terms are set only through the subscription workflow.' using errcode = '42501';
    end if;
  elsif new.started_on is distinct from old.started_on or new.renews_on is distinct from old.renews_on or new.activated_at is distinct from old.activated_at
     or new.panel_created_on is distinct from old.panel_created_on or new.activated_by is distinct from old.activated_by
     or new.activation_confirmed_at is distinct from old.activation_confirmed_at or new.duration_code is distinct from old.duration_code
     or new.duration_months is distinct from old.duration_months or new.duration_days is distinct from old.duration_days
     or new.message_credits is distinct from old.message_credits or new.subscription_cycle is distinct from old.subscription_cycle then
    raise exception 'FORBIDDEN: Subscription dates and terms are set only through the subscription workflow.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_customer_services_protect_subscription() from public, anon, authenticated;
drop trigger if exists customer_services_protect_subscription on public.customer_services;
create trigger customer_services_protect_subscription before insert or update or delete on public.customer_services
  for each row execute function private.tg_customer_services_protect_subscription();

-- ---------------------------------------------------------------------------
-- 3. Date arithmetic (one place)
-- ---------------------------------------------------------------------------
-- Calendar months and years: the same day of the month later, or the last day of a shorter month (31 Jan + 1 month = 28/29 Feb;
-- 29 Feb 2028 + 1 year = 28 Feb 2029). Custom days are plain days.
create or replace function private.subscription_expiry(p_start date, p_months integer, p_days integer)
returns date language sql immutable set search_path = '' as $$
  select case when p_months is not null then (p_start + make_interval(months => p_months))::date else p_start + p_days end
$$;
revoke all on function private.subscription_expiry(date, integer, integer) from public, anon, authenticated;

create or replace function private.duration_label(p_code text, p_months integer, p_days integer)
returns text language sql immutable set search_path = '' as $$
  select case p_code
    when '1M' then '1 month' when '2M' then '2 months' when '3M' then '3 months' when '6M' then '6 months'
    when '1Y' then '1 year' when '2Y' then '2 years'
    when 'CUSTOM' then case when p_months is not null then p_months || ' month' || case when p_months = 1 then '' else 's' end
                            else p_days || ' day' || case when p_days = 1 then '' else 's' end end
    end
$$;
revoke all on function private.duration_label(text, integer, integer) from public, anon, authenticated;

-- {"durationCode": "6M"} or {"durationCode": "CUSTOM", "customMonths": 5} / {"customDays": 45}  ->  (code, months, days)
create or replace function private.parse_duration(p jsonb)
returns table (code text, months integer, days integer) language plpgsql immutable set search_path = '' as $$
declare
  v_code text := upper(btrim(coalesce(p ->> 'durationCode', '')));
  v_m integer;
  v_d integer;
begin
  if v_code not in ('1M', '2M', '3M', '6M', '1Y', '2Y', 'CUSTOM') then
    raise exception 'VALIDATION_ERROR: Choose the subscription duration (1, 2, 3 or 6 months, 1 or 2 years, or custom).' using errcode = 'P0001';
  end if;
  if v_code = 'CUSTOM' then
    begin
      v_m := nullif(btrim(coalesce(p ->> 'customMonths', '')), '')::integer;
      v_d := nullif(btrim(coalesce(p ->> 'customDays', '')), '')::integer;
    exception when others then
      raise exception 'VALIDATION_ERROR: Enter the custom duration as a whole number of months or days.' using errcode = 'P0001';
    end;
    if (v_m is null) = (v_d is null) then
      raise exception 'VALIDATION_ERROR: Enter the custom duration either in months or in days, not both.' using errcode = 'P0001';
    end if;
    if v_m is not null and v_m not between 1 and 120 then
      raise exception 'VALIDATION_ERROR: A custom duration is 1 to 120 months.' using errcode = 'P0001';
    end if;
    if v_d is not null and v_d not between 1 and 3650 then
      raise exception 'VALIDATION_ERROR: A custom duration is 1 to 3650 days.' using errcode = 'P0001';
    end if;
    return query select v_code, v_m, v_d;
  else
    return query select v_code, case v_code when '1M' then 1 when '2M' then 2 when '3M' then 3 when '6M' then 6 when '1Y' then 12 else 24 end, null::integer;
  end if;
end $$;
revoke all on function private.parse_duration(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Who may do what
-- ---------------------------------------------------------------------------
-- Does the signed-in employee work on any service of this customer (support, the hand-over team, a delivery department)?
create or replace function private.may_work_any_service(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.customer_services cs where cs.customer_id = p_customer and private.may_set_service_setup(p_customer, cs.service_code))
$$;
revoke all on function private.may_work_any_service(uuid) from public, anon, authenticated;

-- The plan / duration / amount / credits: whoever owns the customer's record (the salesperson, their Team Head, the Department Head, the Super
-- Admin), until the subscription has started.
create or replace function private.may_set_subscription_terms(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.can_access_customer(p_customer)
$$;
revoke all on function private.may_set_subscription_terms(uuid) from public, anon, authenticated;

-- Correcting a confirmed date is for the heads.
create or replace function private.may_correct_subscription(p_customer uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select private.is_super_admin()
        or (private.my_role() = 'DEPARTMENT_HEAD' and c.department_id = private.my_department_id())
        or (private.my_role() = 'TEAM_HEAD' and private.may_work_any_service(c.id))
      from public.customers c where c.id = p_customer), false)
$$;
revoke all on function private.may_correct_subscription(uuid) from public, anon, authenticated;

-- What is still missing before a service can be marked ready / a subscription can start (null = nothing). The same checks the onboarding
-- journey makes for "service ready".
create or replace function private.service_ready_problem(p_customer uuid, p_service text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  v_missing text;
begin
  if coalesce((f ->> 'applies')::boolean, false) then
    if not coalesce((f ->> 'payment')::boolean, false) then
      return 'The payment is not confirmed yet.';
    end if;
    if not coalesce((f ->> 'metaDone')::boolean, false) then
      return 'Meta verification is not completed yet.';
    end if;
    if not coalesce((f ->> 'rmDone')::boolean, false) then
      return 'The Relationship Manager is not assigned yet.';
    end if;
  end if;
  if not coalesce((f ->> 'login')::boolean, false) then
    return 'The client has no login yet.';
  end if;
  select string_agg(i.label, ', ' order by i.sort_order) into v_missing
    from private.customer_items(p_customer) i
    join public.onboarding_item_services m on m.item_code = i.code and m.service_code = p_service
    left join public.customer_onboarding_entries e on e.customer_id = p_customer and e.item_code = i.code
   where not coalesce(i.is_optional, false) and coalesce(e.status, '') <> 'VERIFIED';
  if v_missing is not null then
    return 'Authorize these first: ' || v_missing || '.';
  end if;
  return null;
end $$;
revoke all on function private.service_ready_problem(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. A service that has a duration starts through the activation, not through "ready"
--    (same function as the journey's, plus that one rule and the shared prerequisites)
-- ---------------------------------------------------------------------------
create or replace function public.set_service_setup(p_customer uuid, p_service text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  f jsonb;
  v_status text := upper(btrim(coalesce(p_status, '')));
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_problem text;
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if v_status not in ('IN_PROGRESS', 'READY') then
    raise exception 'VALIDATION_ERROR: Choose In progress or Ready.' using errcode = 'P0001';
  end if;
  if cs.setup_status = v_status then
    raise exception 'CONFLICT: This service is already %.', lower(replace(v_status, '_', ' ')) using errcode = 'P0001';
  end if;
  if cs.setup_status = 'READY' then
    if not private.is_super_admin() then
      raise exception 'CONFLICT: This service is already ready. Only the Super Admin can reopen it.' using errcode = 'P0001';
    end if;
  end if;
  f := private.client_facts(p_customer);
  if coalesce((f ->> 'applies')::boolean, false) then
    if not coalesce((f ->> 'payment')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The payment is not confirmed yet.' using errcode = 'P0001';
    end if;
    if not coalesce((f ->> 'metaDone')::boolean, false) then
      raise exception 'VALIDATION_ERROR: Meta verification is not completed yet.' using errcode = 'P0001';
    end if;
    if not coalesce((f ->> 'rmDone')::boolean, false) then
      raise exception 'VALIDATION_ERROR: The Relationship Manager is not assigned yet.' using errcode = 'P0001';
    end if;
  end if;
  if v_status = 'READY' then
    if cs.duration_code is not null and cs.started_on is null then
      raise exception 'CONFLICT: This service has a subscription. Confirm the panel activation with its dates instead: the subscription starts on the confirmed activation date.' using errcode = 'P0001';
    end if;
    v_problem := private.service_ready_problem(p_customer, p_service);
    if v_problem is not null then
      raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
    end if;
  end if;

  update public.customer_services
     set setup_status = v_status, setup_updated_at = now(), setup_updated_by = (select private.my_id()), setup_note = v_note,
         setup_completed_at = case when v_status = 'READY' then now() else null end,
         service_status = case when v_status = 'READY' then 'LIVE' else coalesce(service_status, 'SETTING_UP') end,
         activated_at = case when v_status = 'READY' then coalesce(activated_at, now()) else activated_at end
   where customer_id = p_customer and service_code = p_service;
  perform private.log_customer_activity(p_customer, 'SERVICE_SETUP', format('%s setup: %s', sv.name, lower(replace(v_status, '_', ' '))) || coalesce(' · ' || v_note, ''));
  perform private.write_audit('SERVICE_SETUP_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'from', cs.setup_status, 'to', v_status, 'note', v_note));
  perform private.client_notify(p_customer, 'SERVICE_SETUP', case when v_status = 'READY' then format('%s is ready', sv.name) else format('%s setup has started', sv.name) end,
    case when v_status = 'READY' then 'The setup is complete. You can find it under My Services.' else coalesce(v_note, 'Our team is setting it up.') end,
    'service', null, format('SETUP|%s|%s|%s|%s', p_customer, p_service, v_status, extract(epoch from now())::bigint));
  return jsonb_build_object('service', p_service, 'status', v_status, 'note', v_note);
end $$;
revoke all on function public.set_service_setup(uuid, text, text, text) from public, anon;
grant execute on function public.set_service_setup(uuid, text, text, text) to authenticated;

-- The staff may no longer type renewal dates over a subscription that has terms: those dates come from the activation, the correction or the renewal.
create or replace function public.set_customer_service_term(p_customer uuid, p_service text, p_started_on date default null, p_renews_on date default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cs public.customer_services;
  c public.customers;
begin
  if not private.may_update_support_customer(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_status is not null and p_status not in ('LIVE', 'SETTING_UP', 'PAUSED', 'EXPIRED', 'CANCELLED') then
    raise exception 'VALIDATION_ERROR: Unknown service status.' using errcode = 'P0001';
  end if;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if (p_started_on is not null or p_renews_on is not null) and (cs.duration_code is not null or cs.subscription_cycle > 0) then
    raise exception 'CONFLICT: The dates of this subscription come from its activation. Use the subscription''s "Correct dates" (with a reason) or its renewal.' using errcode = 'P0001';
  end if;
  if coalesce(p_renews_on, cs.renews_on) is not null and coalesce(p_started_on, cs.started_on) is not null
     and coalesce(p_renews_on, cs.renews_on) < coalesce(p_started_on, cs.started_on) then
    raise exception 'VALIDATION_ERROR: The expiry date is before the start date.' using errcode = 'P0001';
  end if;
  update public.customer_services
     set started_on = coalesce(p_started_on, started_on), renews_on = coalesce(p_renews_on, renews_on), service_status = coalesce(p_status, service_status)
   where customer_id = p_customer and service_code = p_service returning * into cs;
  select * into c from public.customers where id = p_customer;
  perform private.write_audit('CUSTOMER_SERVICE_TERM_CHANGED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'started_on', cs.started_on, 'renews_on', cs.renews_on, 'status', cs.service_status));
  perform private.log_customer_activity(p_customer, 'SERVICE_TERM_CHANGED',
    format('%s: starts %s, renews / expires %s, status %s', p_service, coalesce(cs.started_on::text, '-'), coalesce(cs.renews_on::text, '-'), coalesce(cs.service_status, '-')));
  return jsonb_build_object('customerId', p_customer, 'service', p_service, 'startedOn', cs.started_on, 'renewsOn', cs.renews_on, 'status', cs.service_status);
end $$;
revoke all on function public.set_customer_service_term(uuid, text, date, date, text) from public, anon;
grant execute on function public.set_customer_service_term(uuid, text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. How one subscription is shown (staff and client use the same builder)
-- ---------------------------------------------------------------------------
create or replace function private.subscription_status(cs public.customer_services)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when cs.service_status in ('PAUSED', 'CANCELLED') then cs.service_status
    when cs.started_on is not null and cs.renews_on is not null and cs.renews_on < private.office_today() then 'EXPIRED'
    when cs.started_on is not null then 'ACTIVE'
    when cs.service_status = 'EXPIRED' then 'EXPIRED'
    when cs.service_status = 'LIVE' or cs.activated_at is not null then 'ACTIVE'
    else 'NOT_STARTED' end
$$;
revoke all on function private.subscription_status(public.customer_services) from public, anon, authenticated;

create or replace function private.subscription_json(cs public.customer_services)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'service', cs.service_code, 'serviceName', s.name, 'category', s.category,
    'plan', cs.plan_name, 'amount', cs.price, 'panel', cs.platform,
    'durationCode', cs.duration_code, 'durationMonths', cs.duration_months, 'durationDays', cs.duration_days,
    'durationLabel', private.duration_label(cs.duration_code, cs.duration_months, cs.duration_days),
    'messageCredits', cs.message_credits,
    'status', private.subscription_status(cs),
    'termsComplete', cs.duration_code is not null and cs.plan_name is not null and cs.price is not null,
    'panelCreatedOn', cs.panel_created_on, 'startedOn', cs.started_on, 'expiresOn', cs.renews_on,
    'daysLeft', case when cs.started_on is not null and cs.renews_on is not null then greatest(cs.renews_on - private.office_today(), 0) end,
    'activatedAt', cs.activation_confirmed_at, 'activatedBy', (select p.full_name from public.profiles p where p.id = cs.activated_by),
    'cycle', cs.subscription_cycle)
  from public.crm_services s where s.code = cs.service_code
$$;
revoke all on function private.subscription_json(public.customer_services) from public, anon, authenticated;

-- Messages: the package (or the credits Sales entered), what the provider data says was used, and what is left.
create or replace function private.metric_num(m jsonb, k text)
returns numeric language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(m -> k) = 'number' then (m ->> k)::numeric end
$$;
revoke all on function private.metric_num(jsonb, text) from public, anon, authenticated;

create or replace function private.service_message_usage(p_customer uuid, p_service text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cs public.customer_services;
  u public.service_usage;
  v_total numeric;
  v_used numeric;
  v_reported boolean := false;
begin
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  select * into u from public.service_usage x
   where x.customer_id = p_customer and x.service_code = p_service and x.kind in ('WHATSAPP', 'RCS', 'VOICE') and x.period = ''
   order by x.updated_at desc limit 1;
  if u.id is not null then
    v_total := case u.kind when 'WHATSAPP' then nullif(coalesce(private.metric_num(u.metrics, 'packageMessages'), 0) + coalesce(private.metric_num(u.metrics, 'extraMessages'), 0), 0)
                           else private.metric_num(u.metrics, 'packageMessages') end;
    v_used := private.metric_num(u.metrics, 'sent');
    v_reported := v_used is not null;
  end if;
  v_total := coalesce(v_total, cs.message_credits);
  if v_total is null or v_total <= 0 then
    return null;
  end if;
  v_used := least(greatest(coalesce(v_used, 0), 0), v_total);
  return jsonb_build_object('total', v_total, 'used', v_used, 'remaining', v_total - v_used, 'percent', round(v_used / v_total * 100, 1),
                            'asOf', u.as_of, 'reported', v_reported);
end $$;
revoke all on function private.service_message_usage(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Sales: the plan, duration, amount and message credits of each selected service (never a date)
-- ---------------------------------------------------------------------------
create or replace function public.set_subscription_terms(p_customer uuid, p_service text, p_terms jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  d record;
  v_plan text := left(nullif(btrim(coalesce(p_terms ->> 'plan', '')), ''), 120);
  v_panel text := left(nullif(btrim(coalesce(p_terms ->> 'panel', '')), ''), 120);
  v_amount numeric;
  v_credits bigint;
  v_old jsonb;
begin
  if not private.may_set_subscription_terms(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if p_terms is null or jsonb_typeof(p_terms) <> 'object' then
    raise exception 'VALIDATION_ERROR: Enter the subscription plan, duration and amount.' using errcode = 'P0001';
  end if;
  if p_terms ?| array['startedOn', 'expiresOn', 'startDate', 'expiryDate', 'activationDate', 'panelCreatedOn'] then
    raise exception 'FORBIDDEN: The start and expiry dates are set when the panel is activated, not by Sales.' using errcode = '42501';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if cs.started_on is not null or cs.subscription_cycle > 0 then
    raise exception 'CONFLICT: This subscription has started; its terms are fixed. Use a renewal for a new term.' using errcode = 'P0001';
  end if;
  if v_plan is null then
    raise exception 'VALIDATION_ERROR: Enter the subscription plan.' using errcode = 'P0001';
  end if;
  select * into d from private.parse_duration(p_terms);
  begin
    v_amount := nullif(btrim(coalesce(p_terms ->> 'amount', '')), '')::numeric;
    v_credits := nullif(btrim(coalesce(p_terms ->> 'messageCredits', '')), '')::bigint;
  exception when others then
    raise exception 'VALIDATION_ERROR: The amount and the message credits must be numbers (credits in whole messages).' using errcode = 'P0001';
  end;
  if v_amount is null or v_amount < 0 then
    raise exception 'VALIDATION_ERROR: Enter the subscription amount.' using errcode = 'P0001';
  end if;
  if v_credits is not null and v_credits < 0 then
    raise exception 'VALIDATION_ERROR: The message credits cannot be negative.' using errcode = 'P0001';
  end if;

  v_old := private.subscription_json(cs);
  update public.customer_services
     set plan_name = v_plan, price = v_amount, platform = v_panel, message_credits = v_credits,
         duration_code = d.code, duration_months = d.months, duration_days = d.days,
         billing_cycle = private.duration_label(d.code, d.months, d.days)
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  insert into public.subscription_history (customer_id, service_code, action, old_values, new_values, actor_id)
  values (p_customer, p_service, 'TERMS_SET', v_old - 'activatedAt', private.subscription_json(cs) - 'activatedAt', (select private.my_id()));
  perform private.write_audit('SUBSCRIPTION_TERMS_SET', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'plan', v_plan, 'duration', private.duration_label(d.code, d.months, d.days), 'amount', v_amount, 'messageCredits', v_credits));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_TERMS', format('%s: %s plan, %s, %s', p_service, v_plan, private.duration_label(d.code, d.months, d.days), v_amount));
  return private.subscription_json(cs);
end $$;
revoke all on function public.set_subscription_terms(uuid, text, jsonb) from public, anon;
grant execute on function public.set_subscription_terms(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The team: confirm that the panel was created and activated. This is the moment the subscription starts.
-- ---------------------------------------------------------------------------
create or replace function private.queue_activation_email(p_customer uuid, p_service text, p_cycle integer, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job uuid;
begin
  insert into public.automation_jobs (customer_id, channel, stage, dedupe_key, context, created_by)
  values (p_customer, 'EMAIL', 'SUBSCRIPTION_ACTIVATED', p_key,
          jsonb_build_object('service', p_service, 'cycle', p_cycle), (select private.my_id()))
  on conflict (dedupe_key) do nothing
  returning id into v_job;
  return v_job;
end $$;
revoke all on function private.queue_activation_email(uuid, text, integer, text) from public, anon, authenticated;

create or replace function public.confirm_subscription_activation(
  p_customer uuid, p_service text, p_activation_date date, p_panel_created_on date default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  v_problem text;
  v_panel date;
  v_expiry date;
  v_today date := private.office_today();
  v_me uuid := (select private.my_id());
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  -- a repeated request (a double click, a retry, a second employee) changes nothing and never moves the start date
  if cs.started_on is not null or cs.subscription_cycle > 0 then
    return jsonb_build_object('alreadyActive', true, 'subscription', private.subscription_json(cs));
  end if;
  if cs.duration_code is null then
    raise exception 'VALIDATION_ERROR: The subscription duration has not been set for this service. Ask Sales to enter the plan, duration and amount first.' using errcode = 'P0001';
  end if;
  v_problem := private.service_ready_problem(p_customer, p_service);
  if v_problem is not null then
    raise exception 'VALIDATION_ERROR: %', v_problem using errcode = 'P0001';
  end if;
  if p_activation_date is null then
    raise exception 'VALIDATION_ERROR: Enter the subscription activation date.' using errcode = 'P0001';
  end if;
  if p_activation_date > v_today then
    raise exception 'VALIDATION_ERROR: The activation date cannot be in the future. Confirm it once the panel is actually active.' using errcode = 'P0001';
  end if;
  if p_activation_date < date '2020-01-01' then
    raise exception 'VALIDATION_ERROR: Enter a valid activation date.' using errcode = 'P0001';
  end if;
  v_panel := coalesce(p_panel_created_on, p_activation_date);
  if v_panel > p_activation_date then
    raise exception 'VALIDATION_ERROR: The panel creation date cannot be after the activation date.' using errcode = 'P0001';
  end if;
  v_expiry := private.subscription_expiry(p_activation_date, cs.duration_months, cs.duration_days);

  update public.customer_services
     set started_on = p_activation_date, renews_on = v_expiry, panel_created_on = v_panel, activated_by = v_me, activation_confirmed_at = now(),
         subscription_cycle = 1, setup_status = 'READY', setup_updated_at = now(), setup_updated_by = v_me, setup_note = coalesce(v_note, setup_note),
         setup_completed_at = now(), service_status = 'LIVE', activated_at = coalesce(activated_at, now())
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  insert into public.subscription_cycles (customer_id, service_code, cycle_no, kind, plan_name, price, duration_code, duration_months, duration_days,
                                          message_credits, panel_created_on, started_on, expires_on, activated_by)
  values (p_customer, p_service, 1, 'INITIAL', cs.plan_name, cs.price, cs.duration_code, cs.duration_months, cs.duration_days,
          cs.message_credits, v_panel, p_activation_date, v_expiry, v_me);
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, new_values, reason, actor_id)
  values (p_customer, p_service, 1, 'ACTIVATED', private.subscription_json(cs), v_note, v_me);
  perform private.write_audit('SUBSCRIPTION_ACTIVATED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'startedOn', p_activation_date, 'expiresOn', v_expiry, 'panelCreatedOn', v_panel,
                       'duration', private.duration_label(cs.duration_code, cs.duration_months, cs.duration_days)));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_ACTIVATED',
    format('%s: subscription started %s, expires %s', sv.name, p_activation_date, v_expiry));
  perform private.client_notify(p_customer, 'SUBSCRIPTION_ACTIVE', format('%s subscription is active', sv.name),
    format('Your subscription started on %s and runs until %s.', to_char(p_activation_date, 'DD Mon YYYY'), to_char(v_expiry, 'DD Mon YYYY')),
    'service', null, format('SUB|%s|%s|%s|START', p_customer, p_service, 1));
  -- the panel activation e-mail: queued only now, once per cycle
  perform private.queue_activation_email(p_customer, p_service, 1, format('SUBACT|%s|%s|%s', p_customer, p_service, 1));
  return jsonb_build_object('alreadyActive', false, 'subscription', private.subscription_json(cs));
end $$;
revoke all on function public.confirm_subscription_activation(uuid, text, date, date, text) from public, anon;
grant execute on function public.confirm_subscription_activation(uuid, text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The heads: correct a confirmed date (a reason is required; old and new values are kept)
-- ---------------------------------------------------------------------------
create or replace function public.correct_subscription_dates(
  p_customer uuid, p_service text, p_activation_date date, p_panel_created_on date, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 500);
  v_old jsonb;
  v_expiry date;
  v_panel date;
  v_today date := private.office_today();
begin
  if not private.may_correct_subscription(p_customer) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  if v_reason is null or length(v_reason) < 5 then
    raise exception 'VALIDATION_ERROR: Give the reason for correcting the dates (at least a few words).' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: The customer does not have this service.' using errcode = 'P0001';
  end if;
  if cs.subscription_cycle < 1 or cs.started_on is null then
    raise exception 'CONFLICT: This subscription has not started yet; confirm the activation instead.' using errcode = 'P0001';
  end if;
  if p_activation_date is null or p_activation_date > v_today or p_activation_date < date '2020-01-01' then
    raise exception 'VALIDATION_ERROR: Enter a valid activation date (not in the future).' using errcode = 'P0001';
  end if;
  v_panel := coalesce(p_panel_created_on, cs.panel_created_on, p_activation_date);
  if v_panel > p_activation_date then
    raise exception 'VALIDATION_ERROR: The panel creation date cannot be after the activation date.' using errcode = 'P0001';
  end if;
  if p_activation_date is not distinct from cs.started_on and v_panel is not distinct from cs.panel_created_on then
    raise exception 'CONFLICT: Those are the dates already recorded.' using errcode = 'P0001';
  end if;
  v_old := private.subscription_json(cs);
  v_expiry := private.subscription_expiry(p_activation_date, cs.duration_months, cs.duration_days);
  update public.customer_services
     set started_on = p_activation_date, renews_on = v_expiry, panel_created_on = v_panel
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  update public.subscription_cycles
     set started_on = p_activation_date, expires_on = v_expiry, panel_created_on = v_panel
   where customer_id = p_customer and service_code = p_service and cycle_no = cs.subscription_cycle;
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, old_values, new_values, reason, actor_id)
  values (p_customer, p_service, cs.subscription_cycle, 'DATES_CORRECTED', v_old, private.subscription_json(cs), v_reason, (select private.my_id()));
  perform private.write_audit('SUBSCRIPTION_DATES_CORRECTED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'from', jsonb_build_object('startedOn', v_old -> 'startedOn', 'expiresOn', v_old -> 'expiresOn'),
                       'to', jsonb_build_object('startedOn', p_activation_date, 'expiresOn', v_expiry), 'reason', v_reason));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_DATES_CORRECTED',
    format('%s: subscription dates corrected to %s - %s (%s)', p_service, p_activation_date, v_expiry, v_reason));
  perform private.client_notify(p_customer, 'SUBSCRIPTION_UPDATED', 'Your subscription dates were updated',
    format('Your subscription now runs from %s to %s.', to_char(p_activation_date, 'DD Mon YYYY'), to_char(v_expiry, 'DD Mon YYYY')),
    'service', null, format('SUB|%s|%s|%s|FIX|%s', p_customer, p_service, cs.subscription_cycle, extract(epoch from now())::bigint));
  return private.subscription_json(cs);
end $$;
revoke all on function public.correct_subscription_dates(uuid, text, date, date, text) from public, anon;
grant execute on function public.correct_subscription_dates(uuid, text, date, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Renewal: needs a verified payment; the old cycle is kept; a new cycle starts
--     Policy: while the subscription is still running the renewal CONTINUES from the old expiry date (no days lost, none double counted);
--     once it has lapsed it starts on the activation date the team confirms. The new expiry is calculated from that start.
-- ---------------------------------------------------------------------------
create or replace function public.confirm_subscription_renewal(
  p_customer uuid, p_service text, p_payment uuid, p_start date default null, p_terms jsonb default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  sv public.crm_services;
  pay public.customer_payments;
  d record;
  v_dcode text;
  v_dmonths integer;
  v_ddays integer;
  v_old jsonb;
  v_start date;
  v_expiry date;
  v_cycle integer;
  v_today date := private.office_today();
  v_me uuid := (select private.my_id());
  v_plan text;
  v_amount numeric;
  v_credits bigint;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  select * into sv from public.crm_services where code = p_service;
  if cs.customer_id is null then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  if cs.subscription_cycle < 1 or cs.started_on is null then
    raise exception 'CONFLICT: This subscription has not started yet; confirm the activation first.' using errcode = 'P0001';
  end if;
  if p_payment is null then
    raise exception 'VALIDATION_ERROR: Choose the verified payment that pays for this renewal.' using errcode = 'P0001';
  end if;
  select * into pay from public.customer_payments where id = p_payment and customer_id = p_customer;
  if pay.id is null or pay.status <> 'VERIFIED' then
    raise exception 'VALIDATION_ERROR: A renewal needs a payment of this customer that Accounts has verified.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.subscription_cycles x where x.payment_id = p_payment) then
    -- the same payment cannot extend the subscription twice: a repeated request changes nothing
    return jsonb_build_object('alreadyRenewed', true, 'subscription', private.subscription_json(cs));
  end if;
  if p_terms is not null and jsonb_typeof(p_terms) = 'object' and p_terms ?| array['startedOn', 'expiresOn', 'startDate', 'expiryDate'] then
    raise exception 'FORBIDDEN: The expiry date is calculated; enter only the duration.' using errcode = '42501';
  end if;
  -- the duration of the new term: the same as the last one unless the renewal names another
  if p_terms is not null and p_terms ? 'durationCode' then
    select x.code, x.months, x.days into v_dcode, v_dmonths, v_ddays from private.parse_duration(p_terms) x;
  else
    v_dcode := cs.duration_code; v_dmonths := cs.duration_months; v_ddays := cs.duration_days;
  end if;
  v_plan := coalesce(left(nullif(btrim(coalesce(p_terms ->> 'plan', '')), ''), 120), cs.plan_name);
  begin
    v_amount := coalesce(nullif(btrim(coalesce(p_terms ->> 'amount', '')), '')::numeric, cs.price);
    v_credits := coalesce(nullif(btrim(coalesce(p_terms ->> 'messageCredits', '')), '')::bigint, cs.message_credits);
  exception when others then
    raise exception 'VALIDATION_ERROR: The amount and the message credits must be numbers.' using errcode = 'P0001';
  end;
  if v_amount is not null and v_amount < 0 then
    raise exception 'VALIDATION_ERROR: The amount cannot be negative.' using errcode = 'P0001';
  end if;

  if cs.renews_on >= v_today then
    if p_start is not null and p_start <> cs.renews_on then
      raise exception 'VALIDATION_ERROR: The subscription is still running, so the renewal continues from its expiry date (%).', to_char(cs.renews_on, 'DD Mon YYYY') using errcode = 'P0001';
    end if;
    v_start := cs.renews_on;
  else
    v_start := coalesce(p_start, v_today);
    if v_start > v_today or v_start < date '2020-01-01' then
      raise exception 'VALIDATION_ERROR: Enter the date the renewed panel was activated (not in the future).' using errcode = 'P0001';
    end if;
  end if;
  v_expiry := private.subscription_expiry(v_start, v_dmonths, v_ddays);
  v_cycle := cs.subscription_cycle + 1;
  v_old := private.subscription_json(cs);

  update public.subscription_cycles set status = 'ENDED', ended_at = now()
   where customer_id = p_customer and service_code = p_service and status = 'ACTIVE';
  update public.customer_services
     set started_on = v_start, renews_on = v_expiry, subscription_cycle = v_cycle, plan_name = v_plan, price = v_amount, message_credits = v_credits,
         duration_code = v_dcode, duration_months = v_dmonths, duration_days = v_ddays, billing_cycle = private.duration_label(v_dcode, v_dmonths, v_ddays),
         panel_created_on = least(coalesce(panel_created_on, v_start), v_start),
         service_status = 'LIVE', activated_by = v_me, activation_confirmed_at = now()
   where customer_id = p_customer and service_code = p_service
   returning * into cs;
  insert into public.subscription_cycles (customer_id, service_code, cycle_no, kind, plan_name, price, duration_code, duration_months, duration_days,
                                          message_credits, panel_created_on, started_on, expires_on, activated_by, payment_id)
  values (p_customer, p_service, v_cycle, 'RENEWAL', cs.plan_name, cs.price, cs.duration_code, cs.duration_months, cs.duration_days,
          cs.message_credits, cs.panel_created_on, v_start, v_expiry, v_me, p_payment);
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, old_values, new_values, reason, actor_id)
  values (p_customer, p_service, v_cycle, 'RENEWED', v_old, private.subscription_json(cs), v_note, v_me);
  perform private.write_audit('SUBSCRIPTION_RENEWED', 'customer', p_customer, c.department_id, c.team_id,
    jsonb_build_object('service', p_service, 'cycle', v_cycle, 'startedOn', v_start, 'expiresOn', v_expiry, 'payment', p_payment));
  perform private.log_customer_activity(p_customer, 'SUBSCRIPTION_RENEWED', format('%s: renewed from %s until %s', sv.name, v_start, v_expiry));
  perform private.client_notify(p_customer, 'SUBSCRIPTION_RENEWED', format('%s subscription renewed', sv.name),
    format('Your subscription now runs from %s until %s.', to_char(v_start, 'DD Mon YYYY'), to_char(v_expiry, 'DD Mon YYYY')),
    'service', null, format('SUB|%s|%s|%s|START', p_customer, p_service, v_cycle));
  return jsonb_build_object('alreadyRenewed', false, 'subscription', private.subscription_json(cs));
end $$;
revoke all on function public.confirm_subscription_renewal(uuid, text, uuid, date, jsonb, text) from public, anon;
grant execute on function public.confirm_subscription_renewal(uuid, text, uuid, date, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. The activation e-mail: what the sender needs (read at the moment of sending), and a retry
-- ---------------------------------------------------------------------------
create or replace function public.subscription_mail_data(p_customer uuid, p_service text, p_cycle integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'serviceName', s.name, 'plan', y.plan_name, 'durationLabel', private.duration_label(y.duration_code, y.duration_months, y.duration_days),
    'startedOn', y.started_on, 'expiresOn', y.expires_on, 'messageCredits', y.message_credits, 'panel', cs.platform, 'panelUrl', cs.panel_url,
    'panelAccount', cs.panel_account,
    'hasLogin', exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer),
    'mustSetPassword', exists (select 1 from public.customer_client_accounts a where a.customer_id = p_customer and a.password_changed_at is null))
    from public.subscription_cycles y
    join public.customer_services cs on cs.customer_id = y.customer_id and cs.service_code = y.service_code
    join public.crm_services s on s.code = y.service_code
   where y.customer_id = p_customer and y.service_code = p_service and y.cycle_no = p_cycle
$$;
revoke all on function public.subscription_mail_data(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.subscription_mail_data(uuid, text, integer) to service_role;

create or replace function public.resend_activation_email(p_customer uuid, p_service text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.customers;
  cs public.customer_services;
  j public.automation_jobs;
  v_key text;
  n integer;
begin
  if not private.may_set_service_setup(p_customer, p_service) then
    raise exception 'NOT_FOUND: Service not found.' using errcode = 'P0001';
  end if;
  select * into c from public.customers where id = p_customer for update;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service for update;
  if cs.customer_id is null or cs.subscription_cycle < 1 then
    raise exception 'CONFLICT: The panel activation e-mail is sent once the subscription has started.' using errcode = 'P0001';
  end if;
  v_key := format('SUBACT|%s|%s|%s', p_customer, p_service, cs.subscription_cycle);
  select * into j from public.automation_jobs where dedupe_key = v_key or dedupe_key like v_key || '|%' order by created_at desc limit 1 for update;
  if j.id is null then
    perform private.queue_activation_email(p_customer, p_service, cs.subscription_cycle, v_key);
  elsif j.status in ('QUEUED', 'SENDING') then
    raise exception 'CONFLICT: The e-mail is already on its way.' using errcode = 'P0001';
  elsif j.status in ('FAILED', 'SKIPPED', 'CANCELLED') then
    update public.automation_jobs set status = 'QUEUED', attempts = 0, next_attempt_at = now(), locked_until = null, detail = null where id = j.id;
  elsif j.sent_at is not null and j.sent_at > now() - interval '10 minutes' then
    raise exception 'CONFLICT: The e-mail was sent a moment ago. Wait before sending it again.' using errcode = 'P0001';
  else
    select count(*) + 1 into n from public.automation_jobs where dedupe_key = v_key or dedupe_key like v_key || '|%';
    perform private.queue_activation_email(p_customer, p_service, cs.subscription_cycle, v_key || '|' || n);
  end if;
  insert into public.subscription_history (customer_id, service_code, cycle_no, action, actor_id)
  values (p_customer, p_service, cs.subscription_cycle, 'EMAIL_RESENT', (select private.my_id()));
  perform private.write_audit('SUBSCRIPTION_EMAIL_RESENT', 'customer', p_customer, c.department_id, c.team_id, jsonb_build_object('service', p_service));
  return jsonb_build_object('queued', true);
end $$;
revoke all on function public.resend_activation_email(uuid, text) from public, anon;
grant execute on function public.resend_activation_email(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. What the team sees
-- ---------------------------------------------------------------------------
create or replace function public.subscription_overview(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_terms boolean := private.may_set_subscription_terms(p_customer);
  v_correct boolean := private.may_correct_subscription(p_customer);
begin
  if not (private.can_access_customer(p_customer) or private.can_view_onboarding_review(p_customer) or private.may_work_any_service(p_customer)) then
    raise exception 'NOT_FOUND: Customer not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'services', coalesce((
      select jsonb_agg(private.subscription_json(cs) || jsonb_build_object(
        'canSetTerms', v_terms and cs.started_on is null and cs.subscription_cycle = 0,
        'canActivate', private.may_set_service_setup(p_customer, cs.service_code) and cs.started_on is null and cs.subscription_cycle = 0,
        'blocker', case when cs.started_on is not null then null
                        when cs.duration_code is null then 'The subscription duration has not been set (Sales enters the plan, duration and amount).'
                        else private.service_ready_problem(p_customer, cs.service_code) end,
        'canCorrect', v_correct and cs.subscription_cycle > 0,
        'canRenew', private.may_set_service_setup(p_customer, cs.service_code) and cs.subscription_cycle > 0,
        'messages', private.service_message_usage(p_customer, cs.service_code),
        'email', (select jsonb_build_object('status', j.status, 'detail', j.detail, 'sentAt', j.sent_at, 'attempts', j.attempts, 'recipient', j.recipient)
                    from public.automation_jobs j
                   where j.customer_id = p_customer and j.stage = 'SUBSCRIPTION_ACTIVATED' and j.context ->> 'service' = cs.service_code
                   order by j.created_at desc limit 1),
        'canResendEmail', private.may_set_service_setup(p_customer, cs.service_code) and cs.subscription_cycle > 0)
        order by cs.created_at, cs.service_code)
        from public.customer_services cs where cs.customer_id = p_customer), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('id', h.id, 'service', h.service_code, 'cycle', h.cycle_no, 'action', h.action, 'old', h.old_values, 'new', h.new_values,
                                          'reason', h.reason, 'by', (select p.full_name from public.profiles p where p.id = h.actor_id), 'at', h.created_at)
                       order by h.created_at desc)
        from (select * from public.subscription_history x where x.customer_id = p_customer order by x.created_at desc limit 40) h), '[]'::jsonb),
    'cycles', coalesce((
      select jsonb_agg(jsonb_build_object('service', y.service_code, 'cycle', y.cycle_no, 'kind', y.kind, 'status', y.status, 'plan', y.plan_name,
                                          'durationLabel', private.duration_label(y.duration_code, y.duration_months, y.duration_days),
                                          'startedOn', y.started_on, 'expiresOn', y.expires_on) order by y.service_code, y.cycle_no)
        from public.subscription_cycles y where y.customer_id = p_customer), '[]'::jsonb),
    'payments', case when private.may_work_any_service(p_customer) then coalesce((
      select jsonb_agg(jsonb_build_object('id', pm.id, 'amount', pm.amount, 'paidAt', pm.paid_at, 'method', pm.method, 'used', exists (select 1 from public.subscription_cycles y where y.payment_id = pm.id))
                       order by pm.paid_at desc)
        from public.customer_payments pm where pm.customer_id = p_customer and pm.status = 'VERIFIED'), '[]'::jsonb) else '[]'::jsonb end);
end $$;
revoke all on function public.subscription_overview(uuid) from public, anon;
grant execute on function public.subscription_overview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. What the client sees: My Subscription (read only)
-- ---------------------------------------------------------------------------
create or replace function public.client_subscriptions()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_customer uuid := private.require_client();
begin
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'service', j ->> 'service', 'serviceName', j ->> 'serviceName', 'plan', j -> 'plan', 'durationLabel', j -> 'durationLabel',
        'status', j ->> 'status', 'panelCreated', (j ->> 'panelCreatedOn') is not null, 'panelCreatedOn', j -> 'panelCreatedOn',
        'startedOn', j -> 'startedOn', 'expiresOn', j -> 'expiresOn', 'daysLeft', j -> 'daysLeft',
        'messages', private.service_message_usage(v_customer, j ->> 'service'),
        'messageCredits', j -> 'messageCredits')
      order by cs.created_at, cs.service_code)
      from public.customer_services cs, lateral (select private.subscription_json(cs) as j) x
     where cs.customer_id = v_customer), '[]'::jsonb);
end $$;
revoke all on function public.client_subscriptions() from public, anon;
grant execute on function public.client_subscriptions() to authenticated;

-- the section is always open (it is where a client sees that the subscription has not started yet)
create or replace function private.client_access(p_customer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f jsonb := private.client_facts(p_customer);
  s text;
  v_sections jsonb := '{}'::jsonb;
  v_reason text;
begin
  foreach s in array array['overview', 'journey', 'services', 'subscription', 'campaigns', 'explore', 'plans', 'calendar', 'documents', 'invoices', 'tickets', 'chat', 'notifications', 'docs'] loop
    v_reason := private.client_gate(f, s);
    v_sections := v_sections || jsonb_build_object(s, jsonb_build_object('enabled', v_reason is null, 'reason', v_reason));
  end loop;
  return jsonb_build_object('sections', v_sections);
end $$;
revoke all on function private.client_access(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. Message usage alerts: 70 / 80 / 90 / 100 % (the thresholds are settings), once per subscription cycle and threshold
-- ---------------------------------------------------------------------------
create table if not exists public.usage_alert_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default true,
  thresholds integer[] not null default array[70, 80, 90, 100],
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (cardinality(thresholds) between 1 and 8)
);
insert into public.usage_alert_settings (id) values (true) on conflict (id) do nothing;
alter table public.usage_alert_settings enable row level security;
revoke all on public.usage_alert_settings from public, anon, authenticated;

-- one row per customer, service, cycle (identified by its expiry date: a renewal or a corrected date is a new cycle) and threshold
create table if not exists public.usage_alert_log (
  customer_id uuid not null references public.customers (id) on delete cascade,
  service_code text not null,
  cycle_key text not null,
  threshold integer not null,
  percent numeric(6,1) not null,
  notified boolean not null,
  created_at timestamptz not null default now(),
  primary key (customer_id, service_code, cycle_key, threshold)
);
alter table public.usage_alert_log enable row level security;
revoke all on public.usage_alert_log from public, anon, authenticated;

create or replace function public.usage_alert_settings_get()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.usage_alert_settings;
begin
  if (select private.my_id()) is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  select * into s from public.usage_alert_settings where id;
  return jsonb_build_object('enabled', s.enabled, 'thresholds', to_jsonb(s.thresholds), 'canEdit', private.is_super_admin());
end $$;
revoke all on function public.usage_alert_settings_get() from public, anon;
grant execute on function public.usage_alert_settings_get() to authenticated;

create or replace function public.set_usage_alert_settings(p_enabled boolean, p_thresholds integer[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v integer[];
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change this.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct t order by t), '{}') into v from unnest(coalesce(p_thresholds, '{}')) t;
  if cardinality(v) not between 1 and 8 or exists (select 1 from unnest(v) t where t not between 1 and 100) then
    raise exception 'VALIDATION_ERROR: Give 1 to 8 percentages between 1 and 100.' using errcode = 'P0001';
  end if;
  update public.usage_alert_settings set enabled = coalesce(p_enabled, enabled), thresholds = v, updated_by = (select private.my_id()), updated_at = now() where id;
  perform private.write_audit('USAGE_ALERT_SETTINGS_CHANGED', 'usage_alert_settings', null, null, null, jsonb_build_object('enabled', p_enabled, 'thresholds', to_jsonb(v)));
  return public.usage_alert_settings_get();
end $$;
revoke all on function public.set_usage_alert_settings(boolean, integer[]) from public, anon;
grant execute on function public.set_usage_alert_settings(boolean, integer[]) to authenticated;

create or replace function private.evaluate_usage_alerts(p_customer uuid, p_service text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.usage_alert_settings;
  cs public.customer_services;
  sv public.crm_services;
  c public.customers;
  u jsonb;
  v_pct numeric;
  v_key text;
  v_top integer;
  t integer;
  v_to uuid;
begin
  select * into s from public.usage_alert_settings where id;
  if not s.enabled then return; end if;
  select * into cs from public.customer_services where customer_id = p_customer and service_code = p_service;
  -- no alert before the subscription has started (a service that has a duration but no activation yet)
  if cs.customer_id is null or (cs.duration_code is not null and cs.started_on is null) then return; end if;
  u := private.service_message_usage(p_customer, p_service);
  if u is null then return; end if;
  v_pct := (u ->> 'percent')::numeric;
  v_key := coalesce(cs.renews_on::text, 'open');
  for t in select x from unnest(s.thresholds) x order by x loop
    if v_pct >= t and not exists (select 1 from public.usage_alert_log l
                                   where l.customer_id = p_customer and l.service_code = p_service and l.cycle_key = v_key and l.threshold = t) then
      insert into public.usage_alert_log (customer_id, service_code, cycle_key, threshold, percent, notified) values (p_customer, p_service, v_key, t, v_pct, false)
      on conflict do nothing;
      v_top := t;
    end if;
  end loop;
  if v_top is null then return; end if;
  -- one message for the highest threshold that was just crossed (a jump from 60 % to 95 % is one alert, not three)
  update public.usage_alert_log set notified = true
   where customer_id = p_customer and service_code = p_service and cycle_key = v_key and threshold = v_top;
  select * into sv from public.crm_services where code = p_service;
  select * into c from public.customers where id = p_customer;
  perform private.client_notify(p_customer, 'USAGE_ALERT', format('%s: %s%% of your messages used', sv.name, v_top),
    format('You have used %s of %s messages (%s%%). %s message%s left. Contact us to add more before they run out.',
           to_char((u ->> 'used')::numeric, 'FM999G999G999'), to_char((u ->> 'total')::numeric, 'FM999G999G999'), v_top,
           to_char((u ->> 'remaining')::numeric, 'FM999G999G999'), case when (u ->> 'remaining')::numeric = 1 then '' else 's' end),
    'service', null, format('USAGE|%s|%s|%s|%s', p_customer, p_service, v_key, v_top));
  for v_to in select distinct x from unnest(array[c.owner_id, private.rm_of(p_customer)]) x where x is not null loop
    perform private.notify(v_to, 'USAGE_ALERT', format('Message usage %s%%: %s', v_top, coalesce(c.company, c.name)),
      format('%s has used %s%% of the %s messages.', sv.name, v_top, sv.name), 'customer', p_customer);
  end loop;
end $$;
revoke all on function private.evaluate_usage_alerts(uuid, text) from public, anon, authenticated;

create or replace function private.tg_service_usage_alerts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind in ('WHATSAPP', 'RCS', 'VOICE') and new.period = '' then
    perform private.evaluate_usage_alerts(new.customer_id, new.service_code);
  end if;
  return null;
end $$;
revoke all on function private.tg_service_usage_alerts() from public, anon, authenticated;
drop trigger if exists service_usage_alerts on public.service_usage;
create trigger service_usage_alerts after insert or update of metrics on public.service_usage
  for each row execute function private.tg_service_usage_alerts();

-- ---------------------------------------------------------------------------
-- 15. Expiry reminders: 15, 7, 3 and 1 day before and ON the expiry date, by e-mail and WhatsApp (the AI calls keep 7, 3 and 1)
--     Each reminder is one row per customer, service, expiry date, stage and channel, so it is sent once per cycle; a renewal or a corrected
--     date is a new expiry date and therefore a new set. The wording of the new stages is DRAFT until the Super Admin approves it.
-- ---------------------------------------------------------------------------
alter table public.subscription_reminders drop constraint if exists subscription_reminders_stage_check;
alter table public.subscription_reminders add constraint subscription_reminders_stage_check check (stage in (15, 7, 3, 1, 0));
alter table public.reminder_message_templates drop constraint if exists reminder_message_templates_stage_check;
alter table public.reminder_message_templates add constraint reminder_message_templates_stage_check check (stage in (15, 7, 3, 1, 0));

insert into public.reminder_message_templates (channel, stage, subject, body) values
  ('EMAIL', 15, 'Your {{service}} subscription expires in {{daysLeft}} days',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa will expire on {{expiryDate}}, which is {{daysLeft}} days from now.\n\nPlease plan your renewal so that your service continues without a break. Reply to this e-mail or contact our support team and we will help you renew.'),
  ('EMAIL', 0, 'Your {{service}} subscription expires today',
   E'Dear {{name}},\n\nYour {{service}} subscription with Amuwa expires today, {{expiryDate}}.\n\nPlease renew today to keep your service running. Reply to this e-mail or call our support team and we will help right away.'),
  ('WHATSAPP', 15, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires on {{expiryDate}} ({{daysLeft}} days). Please plan your renewal. Reply here and our team will help you.'),
  ('WHATSAPP', 0, null,
   E'Hello {{name}}, your {{service}} subscription with Amuwa expires today ({{expiryDate}}). Please renew today so your service continues. Reply here for help.')
on conflict (channel, stage) do nothing;

create or replace function public.set_reminder_message_template(p_channel text, p_stage integer, p_subject text, p_body text, p_provider_template text default null, p_approved boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_bad text;
  t public.reminder_message_templates;
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can change the reminder wording.' using errcode = '42501';
  end if;
  if p_channel not in ('EMAIL', 'WHATSAPP') or p_stage not in (15, 7, 3, 1, 0) then
    raise exception 'VALIDATION_ERROR: Choose e-mail or WhatsApp and stage 15, 7, 3, 1 or 0 (the expiry day).' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 2000 then
    raise exception 'VALIDATION_ERROR: The message must be between 1 and 2,000 characters.' using errcode = 'P0001';
  end if;
  if p_channel = 'EMAIL' and v_subject is null then
    raise exception 'VALIDATION_ERROR: An e-mail needs a subject.' using errcode = 'P0001';
  end if;
  select m[1] into v_bad from regexp_matches(coalesce(v_subject, '') || ' ' || v_body, '\{\{\s*([A-Za-z0-9_]*)\s*\}\}', 'g') as m
   where m[1] not in ('name', 'service', 'expiryDate', 'daysLeft', 'company') limit 1;
  if v_bad is not null then
    raise exception 'VALIDATION_ERROR: Unknown placeholder {{%}}. Use {{name}}, {{service}}, {{expiryDate}}, {{daysLeft}} or {{company}}.', v_bad using errcode = 'P0001';
  end if;
  insert into public.reminder_message_templates (channel, stage, subject, body, provider_template, approved, updated_by, updated_at)
  values (p_channel, p_stage, case when p_channel = 'EMAIL' then left(v_subject, 200) end, v_body, nullif(left(btrim(coalesce(p_provider_template, '')), 120), ''), coalesce(p_approved, false), auth.uid(), now())
  on conflict (channel, stage) do update
     set subject = excluded.subject, body = excluded.body, provider_template = excluded.provider_template, approved = excluded.approved, updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning * into t;
  perform private.write_audit('REMINDER_TEMPLATE_CHANGED', 'reminder_message_template', null, null, null, jsonb_build_object('channel', t.channel, 'stage', t.stage, 'approved', t.approved));
  return jsonb_build_object('channel', t.channel, 'stage', t.stage, 'approved', t.approved);
end $$;
revoke all on function public.set_reminder_message_template(text, integer, text, text, text, boolean) from public, anon;
grant execute on function public.set_reminder_message_template(text, integer, text, text, text, boolean) to authenticated;

drop function if exists public.sub_reminder_schedule(date, text[]);
create or replace function public.sub_reminder_schedule(p_today date default null, p_channels text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := coalesce(p_today, private.office_today());
  s public.reminder_call_settings;
  v_new integer := 0;
  v_cancelled integer := 0;
  v_ids uuid[];
  v_msg_ids uuid[];
begin
  select * into s from public.reminder_call_settings where id;

  -- AI calls: exactly 7, 3 and 1 day(s) before the expiry date (unchanged).
  with ins as (
    insert into public.subscription_reminders (event_key, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
     where cs.renews_on - v_today in (7, 3, 1)
       and (p_channels is null or 'CALL' = any (p_channels))
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_ids from ins;
  v_new := cardinality(v_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_ids) x;

  -- E-mail and WhatsApp: 15, 7, 3 and 1 day before the expiry date and on it. The date is customer_services.renews_on: for a subscription
  -- that is the date calculated from the confirmed activation date, never an account, invoice, payment or document date.
  with ins as (
    insert into public.subscription_reminders (event_key, channel, customer_id, service_code, expiry_date, stage, send_after, send_until)
    select 'SUBREM|' || ch.channel || '|' || cs.customer_id || '|' || cs.service_code || '|' || cs.renews_on || '|' || (cs.renews_on - v_today),
           ch.channel, cs.customer_id, cs.service_code, cs.renews_on, cs.renews_on - v_today,
           (v_today + s.window_start) at time zone 'Asia/Kolkata', (v_today + s.window_end) at time zone 'Asia/Kolkata'
      from public.customer_services cs
      join public.customers c on c.id = cs.customer_id
      cross join (select 'EMAIL' as channel where s.email_enabled union all select 'WHATSAPP' where s.whatsapp_enabled) ch
     where cs.renews_on - v_today in (15, 7, 3, 1, 0)
       and (p_channels is null or ch.channel = any (p_channels))
       and c.lifecycle_stage = 'CUSTOMER'
       and coalesce(cs.service_status, case when cs.activated_at is not null then 'LIVE' end) = 'LIVE'
    on conflict (event_key) do nothing
    returning id)
  select coalesce(array_agg(id), '{}') into v_msg_ids from ins;
  v_new := v_new + cardinality(v_msg_ids);
  perform private.sub_reminder_log(x, 'CREATED', null, null, 'Reminder scheduled for ' || v_today) from unnest(v_msg_ids) x;

  with gone as (
    update public.subscription_reminders sr
       set status = 'CANCELLED', reason = private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date), locked_until = null, updated_at = now()
     where sr.status in ('SCHEDULED', 'RETRY', 'DRY_RUN')
       and private.sub_reminder_invalid(sr.customer_id, sr.service_code, sr.expiry_date) is not null
    returning sr.id, sr.reason)
  select count(*)::int into v_cancelled from (select private.sub_reminder_log(id, 'CANCELLED', null, null, reason) from gone) g;

  insert into public.subscription_reminder_state (key, value, updated_at)
  values ('last_schedule', jsonb_build_object('ranAt', now(), 'day', v_today, 'created', v_new, 'cancelled', v_cancelled), now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object('day', v_today, 'created', v_new, 'cancelled', v_cancelled);
end $$;
revoke all on function public.sub_reminder_schedule(date, text[]) from public, anon, authenticated;
grant execute on function public.sub_reminder_schedule(date, text[]) to service_role;

notify pgrst, 'reload schema';


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>> 20261211000100_employee_approval_hierarchy.sql
-- =============================================================================
-- Multi-level employee approval, Operations Head department ownership, and Department Head team assignment.
--
-- HR (or a Team Lead, for a Team Member) submits an employee. The person exists at once as a PENDING profile that cannot sign in; the request
-- is routed to ONE accountable approver, resolved here and never taken from the caller:
--
--     requested role        approver
--     Operations Head       Super Admin
--     Department Head       the Operations Head who OWNS the department (department_operations_owner)
--     Team Lead             the respective Department Head
--     Team Member           the respective Department Head
--
-- The decision (approve + activate, or reject with a reason) is one atomic function. Nothing else can turn such a profile ACTIVE (a trigger
-- refuses it), and nothing else can change such a request's status. Approval and TEAM assignment are separate: an approved Team Member is
-- active in the department's "awaiting assignment" pool and the Department Head later assigns them under an active Team Lead
-- (assign_member_to_team_lead), which writes history and never creates an approval request.
--
-- Reused, not duplicated: approval_requests (extended), profiles, department_access (the Operations Head's department scope),
-- private.notify, private.write_audit, the provisioning trigger. Existing self-registration requests keep their own flow (source REGISTRATION).
-- Additive and safe to run again.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Shape
-- ---------------------------------------------------------------------------
alter table public.approval_requests
  add column if not exists source text not null default 'REGISTRATION',
  add column if not exists requested_role public.app_role,
  add column if not exists requested_operations_head boolean not null default false,
  add column if not exists requested_division text,
  add column if not exists submitted_by uuid references public.profiles (id) on delete set null,
  add column if not exists approver_kind text,
  add column if not exists approver_id uuid references public.profiles (id) on delete set null,
  add column if not exists attempt integer not null default 1,
  add column if not exists resubmission_of uuid references public.approval_requests (id) on delete set null,
  add column if not exists employee_code text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'approval_requests_source_check') then
    alter table public.approval_requests add constraint approval_requests_source_check check (source in ('REGISTRATION', 'HR', 'MANAGER'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_requests_division_check') then
    alter table public.approval_requests add constraint approval_requests_division_check check (requested_division is null or requested_division in ('SALES', 'SUPPORT', 'GENERAL'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approval_requests_approver_kind_check') then
    alter table public.approval_requests add constraint approval_requests_approver_kind_check check (approver_kind is null or approver_kind in ('SUPER_ADMIN', 'OPERATIONS_HEAD', 'DEPARTMENT_HEAD'));
  end if;
end $$;

create index if not exists approval_requests_employee_idx on public.approval_requests (source, status, created_at desc) where source <> 'REGISTRATION';
create index if not exists approval_requests_approver_idx on public.approval_requests (approver_id) where status = 'PENDING' and approver_id is not null;

-- "Operations Head" is a designation too
alter table public.employee_personal_details drop constraint if exists employee_personal_details_designation_check;
alter table public.employee_personal_details add constraint employee_personal_details_designation_check
  check (designation in ('Operations Head', 'Department Head', 'Team Lead', 'Team Member'));

-- Approved Team Members wait in a pool team of their department until the Department Head assigns them under a Team Lead.
alter table public.teams add column if not exists is_pool boolean not null default false;

-- One accountable Operations Head per department (the primary approver of Department Head requests).
create table if not exists public.department_operations_owner (
  department_id uuid primary key references public.departments (id) on delete cascade,
  operations_head_id uuid not null references public.profiles (id) on delete cascade,
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now()
);
create index if not exists department_operations_owner_head_idx on public.department_operations_owner (operations_head_id);
alter table public.department_operations_owner enable row level security;

-- Where a Team Member sits and who put them there (kept for ever).
create table if not exists public.team_assignments (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  from_team_id uuid references public.teams (id) on delete set null,
  to_team_id uuid references public.teams (id) on delete set null,
  lead_id uuid references public.profiles (id) on delete set null,
  department_id uuid references public.departments (id) on delete set null,
  kind text not null check (kind in ('PLACEMENT', 'ASSIGNMENT', 'REASSIGNMENT')),
  note text check (length(note) <= 500),
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists team_assignments_profile_idx on public.team_assignments (profile_id, created_at desc);
create index if not exists team_assignments_lead_idx on public.team_assignments (lead_id, created_at desc);
alter table public.team_assignments enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Who is who
-- ---------------------------------------------------------------------------
create or replace function private.actor_is_hr(p_actor uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p join public.departments d on d.id = p.department_id
                  where p.id = p_actor and p.status = 'ACTIVE' and d.slug = 'hr')
$$;
revoke all on function private.actor_is_hr(uuid) from public, anon, authenticated;

-- The accountable Operations Head of a department: the recorded owner, still an active Operations Head, whose scope still covers it.
create or replace function private.owner_of_department(p_department uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select o.operations_head_id
    from public.department_operations_owner o
    join public.profiles p on p.id = o.operations_head_id
   where o.department_id in (p_department, private.base_department(p_department))
     and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
     and exists (select 1 from private.scopes_of(p.id) s where s.department_id = private.base_department(p_department))
   order by (o.department_id = p_department) desc
   limit 1
$$;
revoke all on function private.owner_of_department(uuid) from public, anon, authenticated;

-- The pool team (approved, not yet assigned under a Team Lead) of a department and side.
create or replace function private.pool_team(p_department uuid, p_division text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_dept uuid := private.base_department(p_department);
  v_div public.team_division := coalesce(nullif(upper(p_division), ''), 'GENERAL')::public.team_division;
  v_id uuid;
begin
  select t.id into v_id from public.teams t where t.department_id = v_dept and t.is_pool and t.division = v_div;
  if v_id is null then
    insert into public.teams (department_id, name, division, is_pool)
    values (v_dept, 'Awaiting assignment (' || initcap(v_div::text) || ')', v_div, true)
    on conflict (department_id, lower(name)) do update set is_pool = true
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function private.pool_team(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Routing: who approves (decided here, from the stored request - never from the caller)
-- ---------------------------------------------------------------------------
create or replace function private.resolve_employee_approver(p_role public.app_role, p_ops boolean, p_department uuid, p_division text)
returns table (kind text, approver_id uuid) language plpgsql stable security definer set search_path = '' as $$
begin
  if p_role = 'DEPARTMENT_HEAD' and p_ops then
    return query select 'SUPER_ADMIN'::text, null::uuid;
  elsif p_role = 'DEPARTMENT_HEAD' then
    return query select 'OPERATIONS_HEAD'::text, private.owner_of_department(p_department);   -- null = nobody owns it yet: stays pending, the Super Admin is told
  else
    return query select 'DEPARTMENT_HEAD'::text,
      (select h.id from public.profiles h
        where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = private.base_department(p_department)
          and (h.head_division is null or p_division is null or p_division = 'GENERAL' or h.head_division = p_division)
        order by (h.head_division is not distinct from p_division) desc, h.created_at limit 1);
  end if;
end $$;
revoke all on function private.resolve_employee_approver(public.app_role, boolean, uuid, text) from public, anon, authenticated;

-- Is the signed-in person the right approver of this request?
create or replace function private.can_decide_employee_request(p_request uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
  me public.profiles;
  v_approver public.profiles;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if r.id is null or me.id is null or r.source = 'REGISTRATION' or r.subject_user_id = me.id then
    return false;                                     -- nobody approves their own account
  end if;
  if me.role = 'SUPER_ADMIN' then
    return true;                                      -- ultimate authority
  end if;
  if r.approver_kind = 'OPERATIONS_HEAD' then
    return me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and private.owner_of_department(r.department_id) = me.id;
  elsif r.approver_kind = 'DEPARTMENT_HEAD' then
    if me.role <> 'DEPARTMENT_HEAD' or private.base_department(me.department_id) is distinct from private.base_department(r.department_id) then
      return false;
    end if;
    if not (me.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or me.head_division = r.requested_division) then
      return false;
    end if;
    if r.approver_id is null or r.approver_id = me.id then
      return true;
    end if;
    select * into v_approver from public.profiles where id = r.approver_id;
    return v_approver.id is null or v_approver.status <> 'ACTIVE' or v_approver.role <> 'DEPARTMENT_HEAD';   -- the named head is gone: the respective head takes over
  end if;
  return false;                                       -- SUPER_ADMIN requests: only the Super Admin
end $$;
revoke all on function private.can_decide_employee_request(uuid) from public, anon, authenticated;
grant execute on function private.can_decide_employee_request(uuid) to authenticated;

-- Who may SEE a request: HR (monitoring), the Super Admin, the submitter, the approver, the owner / respective heads of the department.
create or replace function private.can_see_employee_request(p_request uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
  me public.profiles;
begin
  select * into r from public.approval_requests where id = p_request;
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if r.id is null or me.id is null or r.source = 'REGISTRATION' then
    return false;
  end if;
  return me.role = 'SUPER_ADMIN' or private.actor_is_hr(me.id) or r.submitted_by = me.id or r.approver_id = me.id or r.decided_by = me.id
      or private.can_decide_employee_request(p_request)
      or (me.role = 'DEPARTMENT_HEAD' and private.base_department(me.department_id) = private.base_department(r.department_id) and r.requested_role in ('TEAM_HEAD', 'TEAM_MEMBER'))
      or (me.role = 'DEPARTMENT_HEAD' and me.is_operations_head and r.requested_role = 'DEPARTMENT_HEAD'
          and exists (select 1 from private.scopes_of(me.id) s where s.department_id = private.base_department(r.department_id)));
end $$;
revoke all on function private.can_see_employee_request(uuid) from public, anon, authenticated;
grant execute on function private.can_see_employee_request(uuid) to authenticated;

drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (subject_user_id = (select auth.uid()) or private.can_manage_profile(subject_user_id) or private.can_see_employee_request(id));

-- A rejected account is final - except that HR may correct and resubmit an EMPLOYEE request (the switch is set only inside employee_request_resubmit).
create or replace function private.tg_profiles_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.id := old.id;
  new.created_at := old.created_at;

  if new.status is distinct from old.status then
    if not (
      (old.status = 'PENDING'   and new.status in ('ACTIVE', 'REJECTED')) or
      (old.status = 'ACTIVE'    and new.status in ('SUSPENDED', 'REVOKED')) or
      (old.status = 'SUSPENDED' and new.status in ('ACTIVE', 'REVOKED')) or
      (old.status = 'REVOKED'   and new.status = 'ACTIVE') or
      (old.status = 'REJECTED'  and new.status = 'PENDING' and coalesce(current_setting('crm.employee_resubmit', true), '') = 'on')
    ) then
      raise exception 'VALIDATION_ERROR: Cannot change account status from % to %.', old.status, new.status
        using errcode = 'P0001';
    end if;
    new.status_changed_at := now();
    new.status_changed_by := (select id from public.profiles where id = auth.uid());
    if old.status = 'PENDING' and new.status = 'ACTIVE' then
      new.approved_at := now();
      new.approved_by := new.status_changed_by;
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Nothing activates these people, or changes these requests, except the decision function
-- ---------------------------------------------------------------------------
create or replace function private.tg_approval_requests_employee_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.source <> 'REGISTRATION' and new.status is distinct from old.status
     and coalesce(current_setting('crm.employee_decision', true), '') <> 'on'
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN: An employee request is decided only through the employee approval.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_approval_requests_employee_guard() from public, anon, authenticated;
drop trigger if exists approval_requests_employee_guard on public.approval_requests;
create trigger approval_requests_employee_guard before update of status on public.approval_requests
  for each row execute function private.tg_approval_requests_employee_guard();

create or replace function private.tg_profiles_employee_activation_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'ACTIVE' and old.status in ('PENDING', 'REJECTED')
     and exists (select 1 from public.approval_requests r where r.subject_user_id = new.id and r.source <> 'REGISTRATION')
     and not exists (select 1 from public.approval_requests r where r.subject_user_id = new.id and r.source <> 'REGISTRATION' and r.status = 'APPROVED')
     and coalesce(current_setting('crm.employee_decision', true), '') <> 'on' then
    raise exception 'FORBIDDEN: This employee has no completed approval yet and cannot be activated.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.tg_profiles_employee_activation_guard() from public, anon, authenticated;
drop trigger if exists profiles_employee_activation_guard on public.profiles;
create trigger profiles_employee_activation_guard before update of status on public.profiles
  for each row execute function private.tg_profiles_employee_activation_guard();

-- ---------------------------------------------------------------------------
-- 5. What a request looks like to the screens (no password, no token, nothing that is not needed to decide)
-- ---------------------------------------------------------------------------
create or replace function private.employee_request_json(r public.approval_requests)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'source', r.source, 'attempt', r.attempt, 'resubmissionOf', r.resubmission_of,
    'requestedRole', case when r.requested_operations_head then 'OPERATIONS_HEAD' else r.requested_role::text end,
    'department', (select jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug) from public.departments d where d.id = r.department_id),
    'division', r.requested_division,
    'employee', (select jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
                    'designation', coalesce(e.designation, p.position), 'joiningDate', e.joining_date,
                    'contactNumber', coalesce(e.contact_number, p.phone), 'employeeCode', r.employee_code)
                   from public.profiles p left join public.employee_personal_details e on e.profile_id = p.id where p.id = r.subject_user_id),
    'submittedBy', (select jsonb_build_object('id', s.id, 'name', s.full_name) from public.profiles s where s.id = r.submitted_by),
    'submittedAt', r.created_at,
    'approverKind', r.approver_kind,
    'approver', (select jsonb_build_object('id', a.id, 'name', a.full_name) from public.profiles a where a.id = r.approver_id),
    -- a Department Head request nobody owns yet: it stays pending until the Super Admin names the accountable Operations Head
    'awaitingOwner', r.status = 'PENDING' and r.approver_kind = 'OPERATIONS_HEAD' and private.owner_of_department(r.department_id) is null,
    'decidedBy', (select jsonb_build_object('id', d.id, 'name', d.full_name) from public.profiles d where d.id = r.decided_by),
    'decidedAt', r.decided_at, 'decisionNote', r.decision_note,
    'canDecide', r.status = 'PENDING' and private.can_decide_employee_request(r.id))
$$;
revoke all on function private.employee_request_json(public.approval_requests) from public, anon, authenticated;

-- Tell the approver (or, when nobody owns the department yet, the Super Admin). One call per event.
create or replace function private.notify_employee_request_approver(r public.approval_requests, p_resubmitted boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_role text := case when r.requested_operations_head then 'Operations Head' else initcap(replace(lower(r.requested_role::text), '_', ' ')) end;
  v_dept text;
  v_to uuid;
  v_count integer := 0;
  v_title text;
begin
  select full_name into v_name from public.profiles where id = r.subject_user_id;
  select name into v_dept from public.departments where id = r.department_id;
  v_title := format('%s: %s (%s, %s)', case when p_resubmitted then 'Employee request sent again' else 'Employee approval needed' end, v_name, replace(v_role, 'Team Head', 'Team Lead'), coalesce(v_dept, 'no department'));

  if r.approver_kind = 'OPERATIONS_HEAD' and r.approver_id is not null then
    perform private.notify(r.approver_id, 'EMPLOYEE_APPROVAL_REQUEST', v_title, 'HR submitted a Department Head for your department. Approve or reject it.', 'approval_request', r.id, '{}'::jsonb, 'urgent');
    return;
  elsif r.approver_kind = 'OPERATIONS_HEAD' then
    for v_to in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_to, 'DEPARTMENT_OWNER_MISSING', format('%s has no Operations Head to approve its Department Head', coalesce(v_dept, 'A department')),
        format('A Department Head request for %s is waiting. Assign an Operations Head to this department (Operations Heads page).', coalesce(v_dept, 'a department')),
        'approval_request', r.id, '{}'::jsonb, 'urgent');
    end loop;
    return;
  elsif r.approver_kind = 'DEPARTMENT_HEAD' then
    for v_to in select h.id from public.profiles h
                 where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = private.base_department(r.department_id)
                   and (r.approver_id is null and (h.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or h.head_division = r.requested_division) or h.id = r.approver_id) loop
      perform private.notify(v_to, 'EMPLOYEE_APPROVAL_REQUEST', v_title, 'Approve or reject this employee for your department.', 'approval_request', r.id, '{}'::jsonb, 'urgent');
      v_count := v_count + 1;
    end loop;
  end if;
  if v_count = 0 then   -- the Super Admin decides requests of every kind, and is the fallback when no head exists
    for v_to in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_to, 'EMPLOYEE_APPROVAL_REQUEST', v_title,
        case when r.approver_kind = 'SUPER_ADMIN' then 'HR submitted an Operations Head. Approve it and choose the departments they manage.' else 'The department has no active Department Head to approve this employee.' end,
        'approval_request', r.id, '{}'::jsonb, 'urgent');
    end loop;
  end if;
end $$;
revoke all on function private.notify_employee_request_approver(public.approval_requests, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Submit: one set of rules for the first submission and for a resubmission
-- ---------------------------------------------------------------------------
-- Who may ask for which employee. HR (any role of the HR department) may submit any of the four; a Team Lead only a Team Member of their own
-- department and side. Returns where the request comes from, the side, and the department the profile belongs to.
create or replace function private.check_employee_submission(p_actor uuid, p_role public.app_role, p_ops boolean, p_department uuid, p_division text,
                                                             out o_source text, out o_division text, out o_profile_department uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor public.profiles;
  v_dept public.departments;
begin
  select * into v_actor from public.profiles where id = p_actor and status = 'ACTIVE';
  if v_actor.id is null then
    raise exception 'FORBIDDEN: Only an active HR member or Team Lead can submit an employee.' using errcode = '42501';
  end if;
  if p_role is null or p_role = 'SUPER_ADMIN' or (p_ops and p_role <> 'DEPARTMENT_HEAD') then
    raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
  end if;
  o_division := nullif(upper(coalesce(p_division, '')), '');
  if o_division is not null and o_division not in ('SALES', 'SUPPORT', 'GENERAL') then
    raise exception 'VALIDATION_ERROR: Choose Sales, Support or General.' using errcode = 'P0001';
  end if;
  select * into v_dept from public.departments where id = p_department and not is_locked;
  if v_dept.id is null then
    raise exception 'VALIDATION_ERROR: Choose the department.' using errcode = 'P0001';
  end if;
  if private.actor_is_hr(v_actor.id) then
    o_source := 'HR';
  elsif v_actor.role = 'TEAM_HEAD' and p_role = 'TEAM_MEMBER' and private.base_department(v_actor.department_id) = private.base_department(v_dept.id) then
    o_source := 'MANAGER';
    o_division := (select t.division::text from public.teams t where t.id = v_actor.team_id);
  else
    raise exception 'FORBIDDEN: You cannot submit this employee.' using errcode = '42501';
  end if;
  o_profile_department := case when p_role = 'DEPARTMENT_HEAD' then v_dept.id else private.base_department(v_dept.id) end;
end $$;
revoke all on function private.check_employee_submission(uuid, public.app_role, boolean, uuid, text) from public, anon, authenticated;

-- Called by the provisioning trigger, after the auth user exists.
create or replace function private.provision_employee_request(p_user auth.users, p_app jsonb, p_email text, p_name text, p_meta jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.try_uuid(p_app ->> 'request_by');
  v_role public.app_role;
  v_ops boolean := coalesce((p_app ->> 'request_operations_head')::boolean, false);
  v_dept uuid := private.try_uuid(p_app ->> 'request_department_id');
  v_check record;
  v_route record;
  v_profile public.profiles;
  v_request public.approval_requests;
begin
  begin
    v_role := (p_app ->> 'request_role')::public.app_role;
  exception when others then
    raise exception 'VALIDATION_ERROR: Invalid role.' using errcode = 'P0001';
  end;
  select * into v_check from private.check_employee_submission(v_actor, v_role, v_ops, v_dept, p_app ->> 'request_division');

  insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division)
  values (p_user.id, p_email, p_name, nullif(trim(p_meta ->> 'position'), ''), v_role, 'PENDING', v_check.o_profile_department, null,
          case when v_role = 'DEPARTMENT_HEAD' and v_check.o_division in ('SALES', 'SUPPORT') then v_check.o_division end)
  returning * into v_profile;

  select * into v_route from private.resolve_employee_approver(v_role, v_ops, v_dept, v_check.o_division);
  insert into public.approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_operations_head, requested_division,
                                        submitted_by, approver_kind, approver_id, employee_code)
  values ('USER_REGISTRATION', v_profile.id, v_check.o_profile_department, 'PENDING', v_check.o_source, v_role, v_ops, v_check.o_division,
          v_actor, v_route.kind, v_route.approver_id, left(nullif(trim(p_app ->> 'request_employee_code'), ''), 40))
  returning * into v_request;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, metadata)
  values (v_actor, 'EMPLOYEE_REQUEST_SUBMITTED', 'profile', v_profile.id, v_check.o_profile_department,
          jsonb_build_object('request', v_request.id, 'role', case when v_ops then 'OPERATIONS_HEAD' else v_role::text end, 'approver', v_route.kind, 'source', v_check.o_source));
  perform private.notify_employee_request_approver(v_request);
end $$;
revoke all on function private.provision_employee_request(auth.users, jsonb, text, text, jsonb) from public, anon, authenticated;

-- A rejected request is corrected and sent again: the same person, a new attempt (the earlier one stays in the history).
create or replace function public.employee_request_resubmit(p_request uuid, p_role public.app_role, p_operations_head boolean, p_department uuid,
                                                             p_division text default null, p_position text default null, p_employee_code text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  old public.approval_requests;
  v_check record;
  v_route record;
  v_new public.approval_requests;
  v_ops boolean := coalesce(p_operations_head, false);
begin
  select * into old from public.approval_requests where id = p_request for update;
  if old.id is null or old.source = 'REGISTRATION' or not private.can_see_employee_request(p_request) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  if old.status <> 'REJECTED' then
    raise exception 'CONFLICT: Only a rejected request can be sent again.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.approval_requests n where n.subject_user_id = old.subject_user_id and n.source <> 'REGISTRATION' and n.created_at > old.created_at) then
    raise exception 'CONFLICT: This request was already sent again.' using errcode = 'P0001';
  end if;
  if not (private.actor_is_hr(auth.uid()) or old.submitted_by = auth.uid()) then
    raise exception 'FORBIDDEN: Only HR or the person who submitted it can send it again.' using errcode = '42501';
  end if;
  select * into v_check from private.check_employee_submission(auth.uid(), p_role, v_ops, p_department, p_division);

  perform set_config('crm.employee_resubmit', 'on', true);
  update public.profiles
     set role = p_role, department_id = v_check.o_profile_department, team_id = null, status = 'PENDING', status_reason = null,
         position = coalesce(nullif(btrim(coalesce(p_position, '')), ''), position),
         head_division = case when p_role = 'DEPARTMENT_HEAD' and v_check.o_division in ('SALES', 'SUPPORT') then v_check.o_division end
   where id = old.subject_user_id;
  perform set_config('crm.employee_resubmit', 'off', true);

  select * into v_route from private.resolve_employee_approver(p_role, v_ops, p_department, v_check.o_division);
  insert into public.approval_requests (request_type, subject_user_id, department_id, status, source, requested_role, requested_operations_head, requested_division,
                                        submitted_by, approver_kind, approver_id, attempt, resubmission_of, employee_code)
  values ('USER_REGISTRATION', old.subject_user_id, v_check.o_profile_department, 'PENDING', v_check.o_source, p_role, v_ops, v_check.o_division,
          auth.uid(), v_route.kind, v_route.approver_id, old.attempt + 1, old.id, coalesce(left(nullif(trim(coalesce(p_employee_code, '')), ''), 40), old.employee_code))
  returning * into v_new;
  perform private.write_audit('EMPLOYEE_REQUEST_RESUBMITTED', 'profile', old.subject_user_id, v_check.o_profile_department, null,
    jsonb_build_object('request', v_new.id, 'previous', old.id, 'attempt', v_new.attempt, 'approver', v_route.kind));
  perform private.notify_employee_request_approver(v_new, true);
  return private.employee_request_json(v_new);
end $$;
revoke all on function public.employee_request_resubmit(uuid, public.app_role, boolean, uuid, text, text, text) from public, anon;
grant execute on function public.employee_request_resubmit(uuid, public.app_role, boolean, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The decision: approve + activate, or reject with a reason - one transaction
-- ---------------------------------------------------------------------------
create or replace function public.employee_request_decide(p_request uuid, p_approve boolean, p_note text default null, p_departments uuid[] default null, p_primary uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.approval_requests;
  subj public.profiles;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
  v_team uuid;
  v_dept uuid;
  v_name text;
  v_n integer := 0;
  v_title text;
  v_to uuid;
begin
  select * into r from public.approval_requests where id = p_request for update;
  if r.id is null or r.source = 'REGISTRATION' or not private.can_see_employee_request(p_request) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'VALIDATION_ERROR: Choose approve or reject.' using errcode = 'P0001';
  end if;
  if r.status <> 'PENDING' then
    raise exception 'CONFLICT: This request has already been decided.' using errcode = 'P0001';
  end if;
  if r.subject_user_id = auth.uid() then
    raise exception 'FORBIDDEN: Nobody can approve or reject their own account.' using errcode = '42501';
  end if;
  if not private.can_decide_employee_request(p_request) then
    raise exception 'FORBIDDEN: You are not the approver of this request.' using errcode = '42501';
  end if;
  if not p_approve and (v_note is null or length(v_note) < 3) then
    raise exception 'VALIDATION_ERROR: Give the reason for rejecting (at least 3 characters).' using errcode = 'P0001';
  end if;
  select * into subj from public.profiles where id = r.subject_user_id for update;
  if subj.id is null then
    raise exception 'NOT_FOUND: The employee no longer exists.' using errcode = 'P0001';
  end if;
  v_dept := private.base_department(r.department_id);
  perform set_config('crm.employee_decision', 'on', true);

  if p_approve then
    if r.requested_role = 'DEPARTMENT_HEAD' then
      if r.requested_operations_head then
        perform set_config('crm.operations_head_change', 'on', true);
        update public.profiles set status = 'ACTIVE', is_operations_head = true, approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
        perform set_config('crm.operations_head_change', 'off', true);
        if p_departments is not null and cardinality(p_departments) > 0 then
          perform private.operations_scope_apply(subj.id, p_departments, p_primary);
        end if;
      else
        update public.profiles set status = 'ACTIVE', approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
      end if;
    elsif r.requested_role = 'TEAM_HEAD' then
      -- a Team Lead leads a team of their own: made now, in their department and side
      v_name := left(subj.full_name || ' Team', 120);
      while exists (select 1 from public.teams t where t.department_id = v_dept and lower(t.name) = lower(v_name)) loop
        v_n := v_n + 1;
        v_name := left(subj.full_name, 112) || ' Team ' || (v_n + 1);
      end loop;
      insert into public.teams (department_id, name, division, created_by)
      values (v_dept, v_name, coalesce(r.requested_division, 'GENERAL')::public.team_division, auth.uid()) returning id into v_team;
      update public.profiles set status = 'ACTIVE', department_id = v_dept, team_id = v_team, approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
      insert into public.team_assignments (profile_id, to_team_id, department_id, kind, note, assigned_by) values (subj.id, v_team, v_dept, 'PLACEMENT', 'Team Lead approved', auth.uid());
    else
      -- a Team Member is approved into the department's pool and waits for the Department Head to place them under a Team Lead
      v_team := private.pool_team(v_dept, r.requested_division);
      update public.profiles set status = 'ACTIVE', department_id = v_dept, team_id = v_team, approved_by = auth.uid(), approved_at = now(), status_reason = v_note where id = subj.id;
      insert into public.team_assignments (profile_id, to_team_id, department_id, kind, note, assigned_by) values (subj.id, v_team, v_dept, 'PLACEMENT', 'Approved, awaiting a Team Lead', auth.uid());
    end if;
    update public.approval_requests set status = 'APPROVED', decided_by = auth.uid(), decided_at = now(), decision_note = v_note, team_id = v_team where id = r.id returning * into r;
    perform private.write_audit('EMPLOYEE_REQUEST_APPROVED', 'profile', subj.id, v_dept, v_team,
      jsonb_build_object('request', r.id, 'role', case when r.requested_operations_head then 'OPERATIONS_HEAD' else r.requested_role::text end, 'attempt', r.attempt));
    v_title := format('Approved: %s', subj.full_name);
    perform private.notify(r.submitted_by, 'EMPLOYEE_REQUEST_APPROVED', v_title, 'The employee is active now.', 'approval_request', r.id);
    if r.requested_role = 'TEAM_MEMBER' then
      for v_to in select h.id from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status = 'ACTIVE' and private.base_department(h.department_id) = v_dept
                     and (h.head_division is null or r.requested_division is null or r.requested_division = 'GENERAL' or h.head_division = r.requested_division) loop
        perform private.notify(v_to, 'TEAM_MEMBER_AWAITING_ASSIGNMENT', format('%s is waiting for a Team Lead', subj.full_name), 'Assign this approved Team Member under a Team Lead.', 'profile', subj.id);
      end loop;
    end if;
  else
    update public.profiles set status = 'REJECTED', status_reason = v_note where id = subj.id;
    update public.approval_requests set status = 'REJECTED', decided_by = auth.uid(), decided_at = now(), decision_note = v_note where id = r.id returning * into r;
    perform private.write_audit('EMPLOYEE_REQUEST_REJECTED', 'profile', subj.id, v_dept, null, jsonb_build_object('request', r.id, 'attempt', r.attempt));
    perform private.notify(r.submitted_by, 'EMPLOYEE_REQUEST_REJECTED', format('Rejected: %s', subj.full_name), format('Reason: %s', v_note), 'approval_request', r.id, '{}'::jsonb, 'urgent');
  end if;
  return private.employee_request_json(r);
end $$;
revoke all on function public.employee_request_decide(uuid, boolean, text, uuid[], uuid[]) from public, anon;
grant execute on function public.employee_request_decide(uuid, boolean, text, uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Lists
-- ---------------------------------------------------------------------------
create or replace function public.employee_requests_list(p_status text default null, p_to_decide boolean default false, p_limit integer default 200)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(private.employee_request_json(r) order by r.created_at desc)
      from (select * from public.approval_requests x
             where x.source <> 'REGISTRATION' and (p_status is null or x.status::text = upper(p_status))
               and private.can_see_employee_request(x.id)
               and (not coalesce(p_to_decide, false) or (x.status = 'PENDING' and private.can_decide_employee_request(x.id)))
             order by x.created_at desc limit least(greatest(coalesce(p_limit, 200), 1), 500)) r), '[]'::jsonb);
end $$;
revoke all on function public.employee_requests_list(text, boolean, integer) from public, anon;
grant execute on function public.employee_requests_list(text, boolean, integer) to authenticated;

create or replace function public.employee_request_get(p_request uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_request;
  if r.id is null or not private.can_see_employee_request(p_request) then
    raise exception 'NOT_FOUND: Request not found.' using errcode = 'P0001';
  end if;
  return private.employee_request_json(r) || jsonb_build_object('history', (
    select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'attempt', h.attempt, 'status', h.status, 'decidedAt', h.decided_at, 'decisionNote', h.decision_note,
             'decidedBy', (select d.full_name from public.profiles d where d.id = h.decided_by), 'submittedAt', h.created_at) order by h.attempt), '[]'::jsonb)
      from public.approval_requests h where h.subject_user_id = r.subject_user_id and h.source <> 'REGISTRATION'));
end $$;
revoke all on function public.employee_request_get(uuid) from public, anon;
grant execute on function public.employee_request_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. The provisioning trigger: the request branch (the rest is unchanged from 20261205000200, which added the Meta Verifier flag)
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
    v_department := coalesce((select department_id from public.teams where id = v_team),
                             private.try_uuid(v_app ->> 'provisioned_department_id'));

    if not private.actor_can_assign_role(v_actor, v_role, v_department, v_team) then
      raise exception 'FORBIDDEN: You are not allowed to create this user.' using errcode = '42501';
    end if;

    insert into public.profiles (id, email, full_name, position, role, status, department_id, team_id, head_division, approved_by, approved_at)
    values (v_user.id, v_email, v_name, nullif(trim(v_meta ->> 'position'), ''), v_role, 'ACTIVE',
            v_department, v_team, v_head_division, v_actor, now())
    returning * into v_profile;

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, team_id, metadata)
    values (v_actor, 'USER_CREATED', 'profile', v_profile.id, v_department, v_team,
            jsonb_build_object('role', v_role, 'email', v_email));
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


-- The employee request is validated in the same statement that creates the sign-in (like provisioned_by), not left to the commit.
create or replace function private.tg_handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  if v_app ? 'provisioned_by' or v_app ? 'request_by' or coalesce((v_app ->> 'bootstrap_super_admin')::boolean, false) then
    perform private.provision_auth_user(new.id);
  end if;
  return new;
end $$;
revoke all on function private.tg_handle_new_auth_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. Operations Head: department scope and the accountable owner of each department (Super Admin only)
-- ---------------------------------------------------------------------------
-- Make `p_head` the accountable Operations Head of a department, or (null) leave it without one. Pending Department Head requests follow.
create or replace function private.set_department_owner(p_department uuid, p_head uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid;
  v_name text;
  v_moved integer := 0;
  v_to uuid;
begin
  select name into v_name from public.departments where id = p_department;
  if v_name is null then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  select operations_head_id into v_old from public.department_operations_owner where department_id = p_department;
  if p_head is not null then
    if not exists (select 1 from public.profiles p where p.id = p_head and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head) then
      raise exception 'VALIDATION_ERROR: Only an active Operations Head can own a department.' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.scopes_of(p_head) s where s.department_id = private.base_department(p_department)) then
      raise exception 'VALIDATION_ERROR: Give %s to this Operations Head first; only a department they manage can be theirs to approve.', v_name using errcode = 'P0001';
    end if;
    insert into public.department_operations_owner (department_id, operations_head_id, assigned_by) values (p_department, p_head, auth.uid())
    on conflict (department_id) do update set operations_head_id = excluded.operations_head_id, assigned_by = excluded.assigned_by, assigned_at = now();
  else
    delete from public.department_operations_owner where department_id = p_department;
  end if;
  if v_old is not distinct from p_head then
    return;
  end if;
  -- Department Head requests still waiting move to the new owner; decided ones keep the approver they had
  update public.approval_requests
     set approver_id = p_head
   where status = 'PENDING' and source <> 'REGISTRATION' and approver_kind = 'OPERATIONS_HEAD' and private.base_department(department_id) = private.base_department(p_department);
  get diagnostics v_moved = row_count;
  perform private.write_audit('DEPARTMENT_OWNER_SET', 'department', p_department, p_department, null,
    jsonb_build_object('from', v_old, 'to', p_head, 'pending_requests_moved', v_moved));
  if p_head is not null then
    perform private.notify(p_head, 'DEPARTMENT_OWNER_ASSIGNED', format('You approve Department Heads of %s', v_name),
      case when v_moved > 0 then format('%s request(s) waiting for approval moved to you.', v_moved) else 'Department Head requests for it now come to you.' end, 'department', p_department);
  elsif v_moved > 0 then
    for v_to in select p.id from public.profiles p where p.status = 'ACTIVE' and p.role = 'SUPER_ADMIN' loop
      perform private.notify(v_to, 'DEPARTMENT_OWNER_MISSING', format('%s has no Operations Head to approve its Department Head', v_name),
        'A request is waiting. Assign an Operations Head to this department.', 'department', p_department, '{}'::jsonb, 'urgent');
    end loop;
  end if;
  if v_old is not null and v_old is distinct from p_head then
    perform private.notify(v_old, 'DEPARTMENT_OWNER_REMOVED', format('You no longer approve Department Heads of %s', v_name), 'The Super Admin changed who is accountable for this department.', 'department', p_department);
  end if;
end $$;
revoke all on function private.set_department_owner(uuid, uuid) from public, anon, authenticated;

-- The whole department scope of an Operations Head: the departments ticked, and which of them they approve for.
create or replace function private.operations_scope_apply(p_profile uuid, p_departments uuid[], p_primary uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
  d uuid;
  v_div text;
  v_problem text;
  v_first text;
  v_any boolean;
  v_pairs jsonb := '[]'::jsonb;
  v_before uuid[];
  v_after uuid[];
  v_home uuid;
  r record;
begin
  select * into t from public.profiles where id = p_profile;
  if t.id is null or t.role <> 'DEPARTMENT_HEAD' or t.status <> 'ACTIVE' or not t.is_operations_head then
    raise exception 'VALIDATION_ERROR: Only an active Operations Head has a department scope.' using errcode = 'P0001';
  end if;
  v_home := private.base_department(t.department_id);
  select coalesce(array_agg(distinct s.department_id), '{}') into v_before from private.scopes_of(p_profile) s;

  for d in select distinct x from unnest(coalesce(p_departments, '{}')) x loop
    v_any := false; v_first := null;
    foreach v_div in array array['SALES', 'SUPPORT'] loop
      v_problem := private.department_access_problem(d, v_div);
      if v_problem is null then
        v_pairs := v_pairs || jsonb_build_array(jsonb_build_object('departmentId', d, 'division', v_div));
        v_any := true;
      elsif v_first is null then
        v_first := v_problem;
      end if;
    end loop;
    if not v_any and private.base_department(d) is distinct from v_home then
      raise exception 'VALIDATION_ERROR: %', coalesce(v_first, 'This department cannot be assigned.') using errcode = 'P0001';
    end if;
  end loop;
  perform public.department_access_apply(p_profile, v_pairs);

  select coalesce(array_agg(distinct s.department_id), '{}') into v_after from private.scopes_of(p_profile) s;
  -- the departments the person no longer manages are no longer theirs to approve for
  for r in select o.department_id from public.department_operations_owner o where o.operations_head_id = p_profile loop
    if not (private.base_department(r.department_id) = any (v_after)) then
      perform private.set_department_owner(r.department_id, null);
    end if;
  end loop;
  if p_primary is not null then
    for d in select distinct x from unnest(p_primary) x loop
      perform private.set_department_owner(d, p_profile);
    end loop;
  end if;

  if v_before is distinct from v_after then
    perform private.write_audit('OPERATIONS_SCOPE_SET', 'profile', p_profile, t.department_id, null,
      jsonb_build_object('before', to_jsonb(v_before), 'after', to_jsonb(v_after)));
    perform private.notify(p_profile, 'OPERATIONS_SCOPE_CHANGED', 'Your departments were changed', 'The Super Admin changed the departments you manage. Your dashboard now shows the new list.', 'profile', p_profile);
  end if;
end $$;
revoke all on function private.operations_scope_apply(uuid, uuid[], uuid[]) from public, anon, authenticated;

create or replace function private.operations_head_json(p public.profiles)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status,
    'homeDepartment', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = p.department_id),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug,
                      'primary', exists (select 1 from public.department_operations_owner o where o.operations_head_id = p.id and private.base_department(o.department_id) = d.id)) order by d.name), '[]'::jsonb)
                      from public.departments d where d.id in (select s.department_id from private.scopes_of(p.id) s)),
    'pendingApprovals', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION' and r.approver_kind = 'OPERATIONS_HEAD' and r.approver_id = p.id),
    'lastLoginAt', (select max(a.created_at) from public.auth_login_attempts a where a.user_id = p.id))
$$;
revoke all on function private.operations_head_json(public.profiles) from public, anon, authenticated;

create or replace function private.require_super_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_super_admin() then
    raise exception 'FORBIDDEN: Only the Super Admin can do this.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.require_super_admin() from public, anon, authenticated;

create or replace function public.operations_heads_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return jsonb_build_object(
    'heads', (select coalesce(jsonb_agg(private.operations_head_json(p) order by p.full_name), '[]'::jsonb)
                from public.profiles p where p.role = 'DEPARTMENT_HEAD' and p.is_operations_head and p.status in ('ACTIVE', 'SUSPENDED')),
    -- departments nobody is accountable for: a Department Head request there cannot be routed
    'unowned', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name,
                  'pendingRequests', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION' and r.approver_kind = 'OPERATIONS_HEAD'
                                        and private.base_department(r.department_id) = d.id)) order by d.name), '[]'::jsonb)
                  from public.departments d
                 where d.facet_of is null and not d.is_locked and d.slug <> 'hr'
                   and not exists (select 1 from public.department_operations_owner o join public.profiles h on h.id = o.operations_head_id
                                    where private.base_department(o.department_id) = d.id and h.status = 'ACTIVE' and h.is_operations_head)),
    'departments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'slug', d.slug,
                  'owner', (select jsonb_build_object('id', h.id, 'name', h.full_name) from public.department_operations_owner o join public.profiles h on h.id = o.operations_head_id
                              where private.base_department(o.department_id) = private.base_department(d.id) limit 1)) order by d.name), '[]'::jsonb)
                  from public.departments d where not d.is_locked));
end $$;
revoke all on function public.operations_heads_list() from public, anon;
grant execute on function public.operations_heads_list() to authenticated;

create or replace function public.operations_head_scope_set(p_profile uuid, p_departments uuid[], p_primary uuid[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.profiles;
begin
  perform private.require_super_admin();
  select * into t from public.profiles where id = p_profile;
  if t.id is null then
    raise exception 'NOT_FOUND: Person not found.' using errcode = 'P0001';
  end if;
  if p_departments is not null and cardinality(p_departments) > 40 then
    raise exception 'VALIDATION_ERROR: Too many departments.' using errcode = 'P0001';
  end if;
  perform private.operations_scope_apply(p_profile, p_departments, p_primary);
  select * into t from public.profiles where id = p_profile;
  return private.operations_head_json(t);
end $$;
revoke all on function public.operations_head_scope_set(uuid, uuid[], uuid[]) from public, anon;
grant execute on function public.operations_head_scope_set(uuid, uuid[], uuid[]) to authenticated;

-- Management activity and approval history of one Operations Head (Super Admin)
create or replace function public.operations_head_activity(p_profile uuid, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'reference', a.entity_type || ':' || left(coalesce(a.entity_id::text, ''), 8),
             'department', (select d.name from public.departments d where d.id = a.department_id),
             'by', (select p.full_name from public.profiles p where p.id = a.actor_id)) order by a.created_at desc)
      from (select * from public.audit_logs x
             where (x.actor_id = p_profile and x.action in ('EMPLOYEE_REQUEST_APPROVED', 'EMPLOYEE_REQUEST_REJECTED', 'TEAM_MEMBER_ASSIGNED'))
                or (x.entity_id = p_profile and x.action in ('OPERATIONS_HEAD_SET', 'OPERATIONS_HEAD_REMOVED', 'OPERATIONS_SCOPE_SET', 'DEPARTMENT_ACCESS_GRANTED', 'DEPARTMENT_ACCESS_REVOKED', 'EMPLOYEE_REQUEST_APPROVED'))
                or (x.action = 'DEPARTMENT_OWNER_SET' and (x.metadata ->> 'to' = p_profile::text or x.metadata ->> 'from' = p_profile::text))
             order by x.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 300)) a), '[]'::jsonb);
end $$;
revoke all on function public.operations_head_activity(uuid, integer) from public, anon;
grant execute on function public.operations_head_activity(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Operations Head dashboard (only the departments the Super Admin assigned)
-- ---------------------------------------------------------------------------
create or replace function private.require_operations_head()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select p.id into v_id from public.profiles p where p.id = auth.uid() and p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head;
  if v_id is null then
    raise exception 'FORBIDDEN: This page is for Operations Heads.' using errcode = '42501';
  end if;
  return v_id;
end $$;
revoke all on function private.require_operations_head() from public, anon, authenticated;

create or replace function public.operations_dashboard()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json_obj order by (row_to_json_obj ->> 'name')), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', d.id, 'name', d.name, 'slug', d.slug,
      'accountable', private.owner_of_department(d.id) = v_me,
      'departmentHeads', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'name', h.full_name, 'email', h.email, 'status', h.status, 'side', h.head_division,
                                'lastLoginAt', (select max(a.created_at) from public.auth_login_attempts a where a.user_id = h.id)) order by h.full_name), '[]'::jsonb)
                            from public.profiles h where h.role = 'DEPARTMENT_HEAD' and h.status in ('ACTIVE', 'SUSPENDED') and private.base_department(h.department_id) = d.id),
      'teamLeads', (select count(*) from public.profiles p where p.role = 'TEAM_HEAD' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'teamMembers', (select count(*) from public.profiles p where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and private.base_department(p.department_id) = d.id),
      'awaitingAssignment', (select count(*) from public.profiles p join public.teams t on t.id = p.team_id
                              where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and t.is_pool and private.base_department(p.department_id) = d.id),
      'pendingDepartmentHeadApprovals', (select count(*) from public.approval_requests r where r.status = 'PENDING' and r.source <> 'REGISTRATION'
                                           and r.approver_kind = 'OPERATIONS_HEAD' and private.base_department(r.department_id) = d.id and private.owner_of_department(d.id) = v_me),
      'leads', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'LEAD'),
      'onboarding', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'ONBOARDING'),
      'customers', (select count(*) from public.customers c where private.base_department(c.department_id) = d.id and c.lifecycle_stage = 'CUSTOMER'),
      'awaitingDepartmentHead', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                                   where private.base_department(c.department_id) = d.id and o.handover_stage = 'DEPARTMENT_HEAD'),
      'withVerifier', (select count(*) from public.customer_onboarding o join public.customers c on c.id = o.customer_id
                         where private.base_department(c.department_id) = d.id and o.forwarded_to_support_at is not null and o.handover_stage = 'CONSULTANT')
    ) as row_to_json_obj
      from public.departments d
     where d.id in (select s.department_id from private.scopes_of(v_me) s)
  ) q;
  return jsonb_build_object(
    'departments', v_rows,
    'totals', jsonb_build_object(
      'departments', jsonb_array_length(v_rows),
      'departmentHeads', (select coalesce(sum(jsonb_array_length(x -> 'departmentHeads')), 0) from jsonb_array_elements(v_rows) x),
      'teamLeads', (select coalesce(sum((x ->> 'teamLeads')::int), 0) from jsonb_array_elements(v_rows) x),
      'teamMembers', (select coalesce(sum((x ->> 'teamMembers')::int), 0) from jsonb_array_elements(v_rows) x),
      'awaitingAssignment', (select coalesce(sum((x ->> 'awaitingAssignment')::int), 0) from jsonb_array_elements(v_rows) x),
      'pendingDepartmentHeadApprovals', (select coalesce(sum((x ->> 'pendingDepartmentHeadApprovals')::int), 0) from jsonb_array_elements(v_rows) x)));
end $$;
revoke all on function public.operations_dashboard() from public, anon;
grant execute on function public.operations_dashboard() to authenticated;

-- What the Department Heads of one assigned department did: real audit and sign-in records, nothing reconstructed from a current status.
create or replace function public.operations_department_activity(p_department uuid, p_limit integer default 60)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_dept uuid := private.base_department(p_department);
begin
  if not exists (select 1 from private.scopes_of(v_me) s where s.department_id = v_dept) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.at, 'departmentHead', x.head_name, 'department', x.dept_name, 'type', x.type, 'reference', x.reference, 'outcome', x.outcome) order by x.at desc)
      from (
        select a.created_at as at, h.full_name as head_name, (select d.name from public.departments d where d.id = v_dept) as dept_name,
               a.action as type, coalesce(a.entity_type, '') || case when a.entity_id is null then '' else ':' || left(a.entity_id::text, 8) end as reference,
               case when a.action like '%REJECTED%' then 'Rejected' when a.action like '%APPROVED%' or a.action like '%ASSIGNED%' then 'Done' when a.action like '%FAILED%' then 'Failed' else 'Recorded' end as outcome
          from public.audit_logs a
          join public.profiles h on h.id = a.actor_id
         where h.role = 'DEPARTMENT_HEAD' and private.base_department(h.department_id) = v_dept and not h.is_operations_head
           and a.action !~* '(password|token|session|secret)'
        union all
        select l.created_at, h.full_name, (select d.name from public.departments d where d.id = v_dept), 'LOGIN', 'profile:' || left(h.id::text, 8), 'Signed in'
          from public.auth_login_attempts l
          join public.profiles h on h.id = l.user_id
         where h.role = 'DEPARTMENT_HEAD' and private.base_department(h.department_id) = v_dept and not h.is_operations_head
         order by 1 desc limit least(greatest(coalesce(p_limit, 60), 1), 200)
      ) x), '[]'::jsonb);
end $$;
revoke all on function public.operations_department_activity(uuid, integer) from public, anon;
grant execute on function public.operations_department_activity(uuid, integer) to authenticated;

-- The people of one assigned department: heads, Team Leads with their teams, and who waits for a Team Lead (read only)
create or replace function public.operations_department_detail(p_department uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := private.require_operations_head();
  v_dept uuid := private.base_department(p_department);
begin
  if not exists (select 1 from private.scopes_of(v_me) s where s.department_id = v_dept) then
    raise exception 'NOT_FOUND: Department not found.' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'teamLeads', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.full_name, 'team', t.name, 'division', t.division,
                    'members', (select count(*) from public.profiles m where m.team_id = l.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE')) order by l.full_name), '[]'::jsonb)
                    from public.profiles l left join public.teams t on t.id = l.team_id
                   where l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' and private.base_department(l.department_id) = v_dept),
    'awaitingAssignment', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'approvedAt', p.approved_at) order by p.full_name), '[]'::jsonb)
                    from public.profiles p join public.teams t on t.id = p.team_id
                   where p.role = 'TEAM_MEMBER' and p.status = 'ACTIVE' and t.is_pool and private.base_department(p.department_id) = v_dept));
end $$;
revoke all on function public.operations_department_detail(uuid) from public, anon;
grant execute on function public.operations_department_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Department Head: the approved employees of the department, and assigning a Team Member under a Team Lead
-- ---------------------------------------------------------------------------
create or replace function private.assigner_department(p_department uuid default null)
returns table (department_id uuid, head_division text, is_admin boolean) language plpgsql stable security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and status = 'ACTIVE';
  if me.id is null then
    raise exception 'FORBIDDEN: Sign in first.' using errcode = '42501';
  end if;
  if me.role = 'SUPER_ADMIN' then
    if p_department is null then
      raise exception 'VALIDATION_ERROR: Choose the department.' using errcode = 'P0001';
    end if;
    return query select private.base_department(p_department), null::text, true;
  elsif me.role = 'DEPARTMENT_HEAD' then
    if p_department is not null and private.base_department(p_department) is distinct from private.base_department(me.department_id) then
      raise exception 'FORBIDDEN: You can only manage your own department.' using errcode = '42501';
    end if;
    return query select private.base_department(me.department_id), me.head_division, false;
  else
    raise exception 'FORBIDDEN: Only a Department Head can do this.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.assigner_department(uuid) from public, anon, authenticated;

create or replace function public.department_employee_directory(p_department uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v record;
begin
  select * into v from private.assigner_department(p_department);
  return jsonb_build_object(
    'department', (select jsonb_build_object('id', d.id, 'name', d.name) from public.departments d where d.id = v.department_id),
    'headDivision', v.head_division,
    'members', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', p.id, 'name', p.full_name, 'email', p.email, 'status', p.status, 'approvedAt', p.approved_at,
                  'team', jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division, 'isPool', t.is_pool),
                  'lead', (select jsonb_build_object('id', l.id, 'name', l.full_name) from public.profiles l where l.team_id = p.team_id and l.role = 'TEAM_HEAD' and l.status = 'ACTIVE' limit 1),
                  'state', case when p.status <> 'ACTIVE' then 'INACTIVE' when t.is_pool then 'AWAITING_ASSIGNMENT' else 'ASSIGNED' end,
                  'lastAssignment', (select jsonb_build_object('kind', a.kind, 'at', a.created_at, 'by', (select b.full_name from public.profiles b where b.id = a.assigned_by))
                                       from public.team_assignments a where a.profile_id = p.id order by a.created_at desc limit 1)) order by p.full_name), '[]'::jsonb)
                  from public.profiles p join public.teams t on t.id = p.team_id
                 where p.role = 'TEAM_MEMBER' and p.status in ('ACTIVE', 'SUSPENDED', 'REVOKED') and private.base_department(p.department_id) = v.department_id
                   and (v.head_division is null or t.division::text in (v.head_division, 'GENERAL'))),
    'leads', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', l.id, 'name', l.full_name, 'status', l.status, 'team', jsonb_build_object('id', t.id, 'name', t.name, 'division', t.division),
                  'members', (select count(*) from public.profiles m where m.team_id = l.team_id and m.role = 'TEAM_MEMBER' and m.status = 'ACTIVE')) order by l.full_name), '[]'::jsonb)
                from public.profiles l join public.teams t on t.id = l.team_id
               where l.role = 'TEAM_HEAD' and l.status in ('ACTIVE', 'SUSPENDED') and not t.is_pool and private.base_department(l.department_id) = v.department_id
                 and (v.head_division is null or t.division::text in (v.head_division, 'GENERAL'))));
end $$;
revoke all on function public.department_employee_directory(uuid) from public, anon;
grant execute on function public.department_employee_directory(uuid) to authenticated;

-- Put an approved Team Member under an active Team Lead of the same department. This is an assignment: it never creates an employee request.
create or replace function public.assign_member_to_team_lead(p_member uuid, p_lead uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v record;
  m public.profiles;
  l public.profiles;
  mt public.teams;
  lt public.teams;
  v_kind text;
  v_note text := left(nullif(btrim(coalesce(p_note, '')), ''), 500);
begin
  select * into v from private.assigner_department(
    (select p.department_id from public.profiles p where p.id = p_member));
  select * into m from public.profiles where id = p_member for update;
  select * into l from public.profiles where id = p_lead for update;
  if m.id is null or m.role <> 'TEAM_MEMBER' or private.base_department(m.department_id) is distinct from v.department_id then
    raise exception 'NOT_FOUND: Team Member not found in this department.' using errcode = 'P0001';
  end if;
  if m.status <> 'ACTIVE' then
    raise exception 'CONFLICT: Only an approved, active Team Member can be assigned.' using errcode = 'P0001';
  end if;
  if l.id is null or l.role <> 'TEAM_HEAD' or private.base_department(l.department_id) is distinct from v.department_id then
    raise exception 'VALIDATION_ERROR: Choose a Team Lead of this department.' using errcode = 'P0001';
  end if;
  if l.status <> 'ACTIVE' then
    raise exception 'CONFLICT: That Team Lead is not active.' using errcode = 'P0001';
  end if;
  select * into mt from public.teams where id = m.team_id;
  select * into lt from public.teams where id = l.team_id;
  if lt.id is null or lt.is_pool then
    raise exception 'VALIDATION_ERROR: That Team Lead has no team yet.' using errcode = 'P0001';
  end if;
  if m.team_id = lt.id then
    raise exception 'CONFLICT: This Team Member is already under that Team Lead.' using errcode = 'P0001';
  end if;
  if v.head_division is not null and lt.division::text not in (v.head_division, 'GENERAL') then
    raise exception 'FORBIDDEN: That team belongs to the other side of the department.' using errcode = '42501';
  end if;
  if mt.division <> 'GENERAL' and lt.division <> 'GENERAL' and mt.division <> lt.division then
    raise exception 'VALIDATION_ERROR: A % member cannot join a % team.', lower(mt.division::text), lower(lt.division::text) using errcode = 'P0001';
  end if;
  v_kind := case when mt.is_pool then 'ASSIGNMENT' else 'REASSIGNMENT' end;
  update public.profiles set team_id = lt.id where id = m.id;
  insert into public.team_assignments (profile_id, from_team_id, to_team_id, lead_id, department_id, kind, note, assigned_by)
  values (m.id, mt.id, lt.id, l.id, v.department_id, v_kind, v_note, auth.uid());
  perform private.write_audit('TEAM_MEMBER_ASSIGNED', 'profile', m.id, v.department_id, lt.id,
    jsonb_build_object('lead', l.id, 'from_team', mt.id, 'to_team', lt.id, 'kind', v_kind));
  perform private.notify(l.id, 'TEAM_MEMBER_ASSIGNED', format('%s joined your team', m.full_name), 'The Department Head assigned this Team Member to you.', 'profile', m.id);
  perform private.notify(m.id, 'TEAM_ASSIGNED', format('You are now in %s', lt.name), format('Your Team Lead is %s.', l.full_name), 'team', lt.id);
  return jsonb_build_object('memberId', m.id, 'leadId', l.id, 'teamId', lt.id, 'kind', v_kind);
end $$;
revoke all on function public.assign_member_to_team_lead(uuid, uuid, text) from public, anon;
grant execute on function public.assign_member_to_team_lead(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Who can read the new tables (writes only through the functions above)
-- ---------------------------------------------------------------------------
drop policy if exists department_operations_owner_select on public.department_operations_owner;
create policy department_operations_owner_select on public.department_operations_owner for select to authenticated using (
  private.is_super_admin() or operations_head_id = (select auth.uid()) or private.actor_is_hr((select auth.uid()))
  or exists (select 1 from public.profiles me where me.id = (select auth.uid()) and me.status = 'ACTIVE' and me.role = 'DEPARTMENT_HEAD'
              and private.base_department(me.department_id) = private.base_department(department_operations_owner.department_id)));

drop policy if exists team_assignments_select on public.team_assignments;
create policy team_assignments_select on public.team_assignments for select to authenticated using (
  profile_id = (select auth.uid()) or lead_id = (select auth.uid()) or private.can_manage_profile(profile_id) or private.is_super_admin());

revoke all on public.department_operations_owner, public.team_assignments from public, anon, authenticated;
grant select on public.department_operations_owner, public.team_assignments to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.department_operations_owner; exception when others then null; end;
  begin alter publication supabase_realtime add table public.team_assignments; exception when others then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 14. Existing data: nobody is promoted and nobody loses access
-- ---------------------------------------------------------------------------
-- A department that exactly ONE active Operations Head already covers gets that person as its accountable owner (the current responsibility,
-- written down). A department two or more cover, or none, is left for the Super Admin to decide: see supabase/review_employee_hierarchy.sql.
do $$
declare
  d record;
  v_heads uuid[];
begin
  for d in select x.id from public.departments x where x.facet_of is null and not x.is_locked loop
    if exists (select 1 from public.department_operations_owner o where o.department_id = d.id) then
      continue;
    end if;
    select coalesce(array_agg(distinct p.id), '{}') into v_heads from public.profiles p
     where p.status = 'ACTIVE' and p.role = 'DEPARTMENT_HEAD' and p.is_operations_head
       and exists (select 1 from private.scopes_of(p.id) s where s.department_id = d.id);
    if cardinality(v_heads) = 1 then
      insert into public.department_operations_owner (department_id, operations_head_id) values (d.id, v_heads[1]) on conflict do nothing;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, department_id, metadata)
      values (null, 'DEPARTMENT_OWNER_BACKFILLED', 'department', d.id, d.id, jsonb_build_object('operations_head', v_heads[1]));
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 15. A friendly refusal BEFORE the sign-in is created (the API calls this first; the trigger repeats every rule)
-- ---------------------------------------------------------------------------
create or replace function public.assert_can_submit_employee(p_email text, p_role public.app_role, p_operations_head boolean, p_department uuid, p_division text default null)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_check record;
  v_existing public.profiles;
  v_head public.profiles;
begin
  select * into v_check from private.check_employee_submission(auth.uid(), p_role, coalesce(p_operations_head, false), p_department, p_division);
  select * into v_existing from public.profiles where email = lower(btrim(p_email));
  if v_existing.id is not null then
    raise exception 'CONFLICT: % already has an account (%). %', v_existing.email, lower(v_existing.status::text),
      case when v_existing.status = 'REJECTED' then 'Send the rejected request again instead of creating a new one.' else 'Nobody is added twice.' end using errcode = 'P0001';
  end if;
  if p_role = 'DEPARTMENT_HEAD' then
    v_head := private.department_head_of(v_check.o_profile_department, null, case when v_check.o_division in ('SALES', 'SUPPORT') then v_check.o_division end);
    if v_head.id is not null then
      raise exception 'CONFLICT: This department already has a Department Head% (%).', case v_check.o_division when 'SALES' then ' for Sales' when 'SUPPORT' then ' for Support' else '' end, v_head.full_name using errcode = 'P0001';
    end if;
  end if;
end $$;
revoke all on function public.assert_can_submit_employee(text, public.app_role, boolean, uuid, text) from public, anon;
grant execute on function public.assert_can_submit_employee(text, public.app_role, boolean, uuid, text) to authenticated;
